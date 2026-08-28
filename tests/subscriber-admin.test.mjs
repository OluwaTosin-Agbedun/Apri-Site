import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalisePapermarkUrl, papermarkEmbedUrl } from '../src/lib/papermark-embed.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('subscriber counts consistently exclude briefing and engagement clients', () => {
  const dashboard = read('src/app/admin/page.tsx')
  const subscribers = read('src/app/admin/subscribers/page.tsx')
  assert.match(dashboard, /from subscribers where client_type='subscriber'/)
  assert.match(subscribers, /from subscribers where client_type='subscriber'/)
  assert.match(subscribers, /from subscribers s\s+where s\.client_type = 'subscriber'/)
})

test('subscriber detail loads only subscriber records and keeps the New subscriber path', () => {
  const detail = read('src/app/admin/subscribers/[id]/page.tsx')
  const list = read('src/app/admin/subscribers/page.tsx')
  assert.match(detail, /where s\.id = \$\{id\} and s\.client_type = 'subscriber'/)
  assert.doesNotMatch(detail, /GrantDocument|Grant a document/)
  assert.match(list, /href="\/admin\/subscribers\/new"/)
})

test('admin displays one access-level field, read-only status and enforced Individual seats', () => {
  const form = read('src/app/admin/subscribers/[id]/subscriber-form.tsx')
  const actions = read('src/app/actions/subscribers.ts')
  assert.match(form, /Subscription access level/)
  assert.doesNotMatch(form, /Access level \(internal\)|Tier \(as named publicly\)/)
  assert.doesNotMatch(form, /name="status"/)
  // Read-only for Individual Access. The condition is named once and used both
  // for the input and for the note beneath it -- a merge had left those two
  // disagreeing, one written inline and one referring to a name that had gone.
  assert.match(form, /const isIndividual = publicTier === "Individual Access"/)
  assert.match(form, /readOnly=\{isIndividual\}/)
  assert.match(actions, /d\.publicTier === "Individual Access" \? 1 : d\.seats/)
  assert.doesNotMatch(actions, /status = \$\{d\.status\}/)
})

test('Papermark and APRI custom-domain links are normalized and validated', () => {
  assert.equal(normalisePapermarkUrl('docs.athenacentre.org/client/a'), 'https://docs.athenacentre.org/client/a')
  assert.ok(papermarkEmbedUrl('https://docs.athenacentre.org/client/a'))
  assert.ok(papermarkEmbedUrl('https://www.papermark.com/view/client-a'))
  assert.equal(papermarkEmbedUrl('https://example.com/client-a'), null)
})

test('activation reports each exact missing requirement', () => {
  const action = read('src/app/actions/subscribers.ts')
  const controls = read('src/app/admin/subscribers/seat-actions.tsx')
  assert.match(action, /Set Subscription access level before activating/)
  assert.match(action, /Set a term end date before activating/)
  assert.match(action, /unique private Papermark library link before activating/)
  assert.match(controls, /Set Subscription access level first/)
  assert.match(controls, /Set a term end date first/)
  assert.match(controls, /Set the unique private Papermark library link first/)
})

test('deletion is owner-authorized, exact-email confirmed and subscriber-scoped', () => {
  const action = read('src/app/actions/subscribers.ts')
  const controls = read('src/app/admin/subscribers/seat-actions.tsx')
  assert.match(action, /admin\.role !== "owner"/)
  assert.match(action, /lower\(email\) = \$\{confirmationEmail\.trim\(\)\.toLowerCase\(\)\}/)
  assert.match(action, /client_type = 'subscriber'/)
  assert.doesNotMatch(action.slice(action.indexOf('export async function deleteSubscriber'), action.indexOf('export async function resendSignInLink')), /briefing_requests|delete from documents/)
  assert.match(controls, /window\.prompt/)
  assert.match(controls, /Final warning/)
  assert.match(controls, /\/admin\/subscribers\?deleted=1/)
  const schema = read('db/schema.sql')
  assert.match(schema, /auth_tokens[\s\S]*subscriber_id uuid[\s\S]*references subscribers \(id\) on delete cascade/)
  assert.match(schema, /publication_access[\s\S]*subscriber_id[\s\S]*references subscribers \(id\) on delete cascade/)
})
