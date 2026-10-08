import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createSchemaDatabase, applyMigration } from "./support/test-database.mjs"
import { sql, makeTag } from './helpers.mjs'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true }
  let base
  if (specifier.startsWith('./') && context.parentURL?.includes('/src/')) base = join(dirname(fileURLToPath(context.parentURL)), specifier)
  if (base && existsSync(`${base}.ts`)) return { url: pathToFileURL(`${base}.ts`).href, shortCircuit: true }
  return next(specifier, context)
}})
process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL
process.env.PAPERMARK_API_BASE = 'http://127.0.0.1:39741'
const budget = await import('../src/lib/papermark-budget.ts')
const tag = makeTag('budget')
const tokens = []
const token = (name) => { const t = `${tag}-${name}`; tokens.push(t); return t }
const bucket = (t, scope = 'all') => `${createHash('sha256').update(t).digest('hex')}:${scope}`
after(async () => { for (const t of tokens) await sql`delete from papermark_api_budgets where bucket like ${`${createHash('sha256').update(t).digest('hex')}:%`}` })

test('independent callers atomically share one token budget, including mixed API paths', async () => {
  process.env.PAPERMARK_CALLS_PER_MINUTE = '1'
  const t = token('concurrent')
  const second = await import('../src/lib/papermark-budget.ts?independent-instance=1')
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => (i % 2 ? second : budget).waitPapermarkBudget(t, i % 3 ? '/v1/links' : '/v1/datarooms', 0)))
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter((r) => r.status === 'rejected').length, 11)
  const [row] = await sql`select next_slot_at from papermark_api_budgets where bucket = ${bucket(t)}`
  assert.ok(new Date(row.next_slot_at).getTime() > Date.now() + 50_000)
})
test('denied calls do not reserve future slots or postpone an existing reset', async () => {
  const t = token('no-reservations')
  await budget.waitPapermarkBudget(t, '/v1/links', 0)
  const [before] = await sql`select next_slot_at from papermark_api_budgets where bucket = ${bucket(t)}`
  await Promise.allSettled(Array.from({ length: 10 }, () => budget.waitPapermarkBudget(t, '/v1/links', 0)))
  const [after] = await sql`select next_slot_at from papermark_api_budgets where bucket = ${bucket(t)}`
  assert.equal(String(after.next_slot_at), String(before.next_slot_at))
})
test('provider reset and Retry-After are persisted across callers and only extend a cooldown', async () => {
  const t = token('reset')
  const reset = Math.ceil(Date.now() / 1000) + 90
  const until = await budget.observePapermarkResponse(t, '/v1/links', new Response('{}', { status: 429, headers: { 'X-RateLimit-Reset': String(reset), 'Retry-After': '30' } }))
  assert.ok(until >= reset * 1000)
  await assert.rejects(budget.waitPapermarkBudget(t, '/v1/datarooms', 0), (error) => error.retryAt >= reset * 1000)
  await budget.observePapermarkResponse(t, '/v1/links', new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }))
  const [row] = await sql`select cooldown_until from papermark_api_budgets where bucket = ${bucket(t)}`
  assert.ok(new Date(row.cooldown_until).getTime() >= until)
})
test('analytics has a tighter bucket as well as sharing the main token allowance', async () => {
  process.env.PAPERMARK_CALLS_PER_MINUTE = '100000'
  process.env.PAPERMARK_ANALYTICS_CALLS_PER_MINUTE = '1'
  const t = token('analytics')
  await budget.waitPapermarkBudget(t, '/v1/analytics/views/first', 0)
  await assert.rejects(budget.waitPapermarkBudget(t, '/v1/analytics/views/second', 0))
  await budget.waitPapermarkBudget(t, '/v1/links/repair', 0)
  const rows = await sql`select bucket from papermark_api_budgets where bucket like ${`${createHash('sha256').update(t).digest('hex')}:%`}`
  assert.equal(rows.length, 2)
})
test('real API hosts cannot accelerate the production budget through environment values', () => {
  const original = process.env.PAPERMARK_API_BASE
  process.env.PAPERMARK_API_BASE = 'https://api.papermark.com'
  process.env.PAPERMARK_CALLS_PER_MINUTE = '100000'
  process.env.PAPERMARK_ANALYTICS_CALLS_PER_MINUTE = '100000'
  assert.equal(budget.papermarkCallInterval(), Math.ceil(60000 / 45))
  assert.equal(budget.papermarkCallInterval(true), 6000)
  process.env.PAPERMARK_API_BASE = original
})
test('missing/invalid reset headers use a bounded fallback, and HTTP dates are honoured', () => {
  const now = Date.now()
  assert.ok(budget.papermarkResetAt(new Headers(), now) >= now + 60000)
  const later = new Date(now + 120000).toUTCString()
  assert.ok(budget.papermarkResetAt(new Headers({ 'retry-after': later }), now) >= Date.parse(later))
})

test('unavailable coordination storage never falls back to uncoordinated API calls', async () => {
  const failingDatabase = registerHooks({ resolve(specifier, context, next) {
    if (specifier === './db' && context.parentURL?.includes('storage-unavailable')) {
      return { url: 'data:text/javascript,export function getSql() { throw new Error("Coordination storage unavailable") }', shortCircuit: true }
    }
    return next(specifier, context)
  } })
  try {
    const isolated = await import('../src/lib/papermark-budget.ts?storage-unavailable=1')
    await assert.rejects(isolated.waitPapermarkBudget(token('storage-failure'), '/v1/links', 0), /Coordination storage unavailable/)
  } finally { failingDatabase.deregister() }
})


test('the additive migration preserves working readers and safely queues existing failures, even on rerun', async () => {
  const file = '20261012_papermark_work_queue.sql'
  const db = await createSchemaDatabase({ skipMigrations: [file] })
  try {
    await db.query("insert into review_reader_rooms (email, papermark_dataroom_id, state, papermark_link_id, link_url) values ('ready@example.invalid', 'mock-room', 'ready', 'existing-link', 'https://docs.example.invalid/view/existing'), ('failed@example.invalid', 'mock-room', 'failed', null, null)")
    await applyMigration(db, file); await applyMigration(db, file)
    const ready = (await db.query("select state, papermark_link_id, link_url from review_reader_rooms where email = 'ready@example.invalid'")).rows[0]
    assert.deepEqual(ready, { state: 'ready', papermark_link_id: 'existing-link', link_url: 'https://docs.example.invalid/view/existing' })
    assert.equal((await db.query('select count(*)::int as n from review_reader_room_jobs')).rows[0].n, 1)
    assert.equal((await db.query('select count(*)::int as n from papermark_api_budgets')).rows[0].n, 0)
  } finally { await db.close() }
})
