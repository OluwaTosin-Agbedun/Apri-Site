/**
 * An isolated test database for the integration tests.
 *
 * A real PostgreSQL engine (PGlite, in process) built from the repository's
 * current schema -- db/schema.sql and then every migration -- with no data
 * in it but what each test creates. It is served on a loopback port using
 * Neon's HTTP query protocol, so the tests keep using the same
 * @neondatabase/serverless driver the application uses, and every value is
 * parsed by that driver exactly as it is in production.
 *
 * It never reads or writes a real database, and never sees a production
 * credential. scripts/run-tests.mjs starts it for the length of a test run.
 */
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const ROOT = resolve(import.meta.dirname, '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/**
 * Two statements in db/schema.sql cannot run here, and are the only ones
 * allowed to fail:
 *  - `create extension pgcrypto`: not bundled with PGlite, and not needed --
 *    gen_random_uuid() is built into PostgreSQL 13 and later;
 *  - a stray ");" on its own (a known defect in schema.sql, reported
 *    separately). Anything else that fails stops the run.
 */
const TOLERATED = [/^create extension if not exists pgcrypto;$/, /^\);$/]

function schemaStatements() {
  const statements = []
  let current = ''
  let inDollar = false
  for (const line of read('db/schema.sql').split(/\r?\n/)) {
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar
    current += line + '\n'
    if (!inDollar && /;\s*(--.*)?$/.test(line)) {
      statements.push(current)
      current = ''
    }
  }
  if (current.trim()) statements.push(current)
  return statements
}

/**
 * A fresh in-memory database at the repository's schema, for tests that need
 * their own -- an upgrade test builds one without the newest migrations,
 * seeds it, then applies them. `skipMigrations` names files to leave out.
 */
export async function createSchemaDatabase({ skipMigrations = [] } = {}) {
  const db = new PGlite()
  await db.exec(`set timezone = 'UTC'`)
  await buildSchema(db, { skipMigrations })
  return db
}

/** Applies one migration file as a psql-style script would. */
export async function applyMigration(db, file) {
  await db.exec(read(`db/migrations/${file}`))
}

async function buildSchema(db, { skipMigrations = [] } = {}) {
  for (const statement of schemaStatements()) {
    const code = statement.replace(/--.*$/gm, '').trim()
    if (!code) continue
    try {
      await db.exec(statement)
    } catch (error) {
      await db.exec('rollback').catch(() => {})
      if (!TOLERATED.some((re) => re.test(code))) {
        throw new Error(`db/schema.sql: "${code.slice(0, 80)}" failed: ${error.message}`)
      }
    }
  }

  // Every migration, retried until all have applied: filename order alone is
  // not a working order (a migration can need a table from one that sorts
  // after it), so each pass applies what it can.
  let pending = readdirSync(join(ROOT, 'db/migrations'))
    .filter((f) => f.endsWith('.sql') && !skipMigrations.includes(f))
    .sort()
  while (pending.length) {
    const failed = []
    let lastError = ''
    for (const file of pending) {
      try {
        await db.exec(read(`db/migrations/${file}`))
      } catch (error) {
        await db.exec('rollback').catch(() => {})
        failed.push(file)
        lastError = `${file}: ${error.message}`
      }
    }
    if (failed.length === pending.length) {
      throw new Error(`These migrations could not be applied: ${failed.join(', ')} (${lastError})`)
    }
    pending = failed
  }
}

// For Neon's protocol every value must go back as the raw text PostgreSQL
// sent, for the driver to parse. PGlite would otherwise parse many types
// itself -- arrays included -- so every type the database knows is mapped to
// "leave as text". Filled once the schema exists.
let RAW = {}
// The driver also sends every parameter as text (a boolean arrives as
// 'true'), and PostgreSQL casts it -- so parameters go through as text too,
// rather than through PGlite's own conversions, which expect JS values.
let TEXT_PARAMS = {}

async function rawTextForEveryType(db) {
  const rows = (await db.query('select oid::int as oid from pg_type')).rows
  RAW = Object.fromEntries(rows.map((r) => [r.oid, (v) => v]))
  TEXT_PARAMS = Object.fromEntries(rows.map((r) => [r.oid, (v) => (typeof v === 'string' ? v : String(v))]))
}

const ERROR_FIELDS = [
  'severity', 'code', 'detail', 'hint', 'position', 'internalPosition', 'internalQuery',
  'where', 'schema', 'table', 'column', 'dataType', 'constraint', 'file', 'line', 'routine',
]

async function execute(db, { query, params }) {
  const result = await db.query(query, params ?? [], {
    rowMode: 'array',
    parsers: RAW,
    serializers: TEXT_PARAMS,
  })
  return {
    command: '',
    rowCount: result.affectedRows ?? result.rows.length,
    fields: result.fields.map((f) => ({
      name: f.name,
      dataTypeID: f.dataTypeID,
      tableID: 0,
      columnID: 0,
      dataTypeSize: -1,
      dataTypeModifier: -1,
      format: 'text',
    })),
    rows: result.rows.map((row) => row.map((v) => (v === null || v === undefined ? null : String(v)))),
    rowAsArray: true,
  }
}

/**
 * Starts the database and its endpoint. Resolves once the schema is built.
 */
export async function startTestDatabase() {
  const db = new PGlite()
  // Neon databases run in UTC unless told otherwise.
  await db.exec(`set timezone = 'UTC'`)
  await buildSchema(db)
  await rawTextForEveryType(db)

  // One connection: requests are handled strictly one at a time.
  let queue = Promise.resolve()
  const serialised = (task) => {
    const run = queue.then(task, task)
    queue = run.catch(() => {})
    return run
  }

  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/sql')) {
      res.writeHead(404).end()
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      serialised(async () => {
        let payload
        try {
          payload = JSON.parse(body)
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'Invalid JSON.' }))
          return
        }
        try {
          let out
          if (Array.isArray(payload.queries)) {
            const results = []
            await db.transaction(async (tx) => {
              for (const q of payload.queries) results.push(await execute(tx, q))
            })
            out = { results }
          } else {
            out = await execute(db, payload)
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out))
        } catch (error) {
          await db.exec('rollback').catch(() => {})
          const failure = { message: error?.message ?? String(error) }
          for (const field of ERROR_FIELDS) if (error?.[field] !== undefined) failure[field] = error[field]
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify(failure))
        }
      })
    })
  })

  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const { port } = server.address()
  return {
    endpoint: `http://127.0.0.1:${port}/sql`,
    // Never resolvable: if the endpoint override were ever lost, the driver
    // would fail to connect rather than reach a real database. No password:
    // the driver needs only a user, host and database name, and this database
    // has no authentication to give one to.
    databaseUrl: 'postgresql://apri_test@isolated-test-database.invalid/apri_test',
    async stop() {
      // The driver keeps connections alive; end them so the server can close.
      server.closeAllConnections()
      await new Promise((ok) => server.close(() => ok()))
      await queue
      await db.close()
    },
  }
}
