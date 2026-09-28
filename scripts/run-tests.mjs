#!/usr/bin/env node
/**
 * Runs the test suite, with the integration tests against an isolated test
 * database built from the repository's current schema.
 *
 *   pnpm test                              # every test file
 *   pnpm test tests/copies.test.mjs        # just the files named
 *   pnpm test --test-reporter=tap          # "--" options go to node --test
 *
 * The database lives in memory for the length of the run (see
 * tests/support/test-database.mjs). The tests are started with no production
 * credential in their environment, so nothing they do can reach a real
 * database or a real Papermark, Resend or Blob account.
 */
import { spawn } from 'node:child_process'
import { startTestDatabase } from '../tests/support/test-database.mjs'

/** Anything that could point a test at a real service is removed. */
const PRODUCTION_KEYS = /^(DATABASE_URL|POSTGRES|PG[A-Z]*$|NEON|PAPERMARK|RESEND|SESSION_SECRET|CRON_SECRET|BLOB_|VERCEL_)/

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !PRODUCTION_KEYS.test(key)))

const args = process.argv.slice(2)
const options = args.filter((arg) => arg.startsWith('--'))
const files = args.filter((arg) => !arg.startsWith('--'))
const database = await startTestDatabase()

const child = spawn(process.execPath, ['--test', ...options, ...(files.length ? files : ['tests/*.test.mjs'])], {
  stdio: 'inherit',
  env: {
    ...env,
    APRI_TEST_DATABASE_URL: database.databaseUrl,
    APRI_TEST_DB_ENDPOINT: database.endpoint,
  },
})

const code = await new Promise((done) => {
  child.on('exit', (status, signal) => done(status ?? (signal ? 1 : 0)))
  child.on('error', () => done(1))
})
await database.stop()
process.exit(code)
