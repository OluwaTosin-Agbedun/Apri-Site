/**
 * README.md is the project's shared record and is updated with every change.
 * These checks catch the omissions that are easy to miss: a new migration, a
 * new document or a new environment variable that the README does not list.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"

const root = new URL("../", import.meta.url)
const readme = readFileSync(new URL("README.md", root), "utf8")

test("every migration is listed in the README, in order", () => {
  const files = readdirSync(new URL("db/migrations/", root)).filter((f) => f.endsWith(".sql")).sort()
  const missing = files.filter((f) => !readme.includes(f))
  assert.deepEqual(missing, [], "add these migrations to the README's migration table")
  const positions = files.map((f) => readme.indexOf(f))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "the README lists migrations in filename order")
})

test("every document in docs/ is linked from the README", () => {
  const docs = readdirSync(new URL("docs/", root)).filter((f) => f.endsWith(".md"))
  assert.deepEqual(docs.filter((f) => !readme.includes(`docs/${f}`)), [])
})

test("every environment variable in .env.example is described in the README", () => {
  const example = readFileSync(new URL(".env.example", root), "utf8")
  const names = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1])
  assert.ok(names.length > 5)
  assert.deepEqual(names.filter((n) => !readme.includes(n)), [], "add these variables to the README")
})

test("the README says when it was last updated and holds no credential", () => {
  assert.match(readme, /Last updated \*\*\d{1,2} [A-Z][a-z]+ \d{4}\*\*/)
  assert.doesNotMatch(readme, /postgres(ql)?:\/\/[^\s`]+@|re_[A-Za-z0-9]{20,}|BEGIN (RSA |EC )?PRIVATE KEY/)
})
