/**
 * Applies db/schema.sql to the database in DATABASE_URL.
 *
 * Every statement is `create ... if not exists`, so running this repeatedly is
 * safe and non-destructive. It never drops anything.
 *
 *   pnpm run db:migrate
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { neon } from '@neondatabase/serverless'
import 'dotenv/config'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '..', 'db', 'schema.sql')

const url = process.env.DATABASE_URL
if (!url) {
  console.error(
    '\n  DATABASE_URL is not set.\n\n' +
      '  Put your Neon connection string in .env.local:\n' +
      '    DATABASE_URL="postgresql://...neon.tech/...?sslmode=require"\n'
  )
  process.exit(1)
}

const sql = neon(url)
const schema = readFileSync(schemaPath, 'utf8')

// Split on semicolons at end-of-line, ignoring those inside comments.
const statements = schema
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

console.log(`Applying ${statements.length} statements from db/schema.sql …`)

let applied = 0
for (const statement of statements) {
  const label = statement.replace(/\s+/g, ' ').slice(0, 72)
  try {
    await sql.query(statement)
    applied++
    console.log(`  ok   ${label}`)
  } catch (error) {
    console.error(`  FAIL ${label}`)
    console.error(`       ${error.message}`)
    process.exit(1)
  }
}

const [{ count }] = await sql`select count(*)::int as count from admins`
const setup = await sql`select 1 from app_settings where key = 'setup_completed'`

console.log(`\n${applied} statements applied.`)
console.log(`Administrators: ${count}`)
console.log(
  setup.length > 0
    ? 'One-time setup: already completed (/admin/setup is closed).'
    : 'One-time setup: still open — visit /admin to create the owner account.'
)
