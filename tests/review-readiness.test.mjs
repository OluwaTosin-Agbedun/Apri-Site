/**
 * Reader-access readiness: the real server checks that replace the permanent
 * Admin setup banner, and the email origin whose absence stopped every review
 * email on the live deployment. Invented values only.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    let base = null
    if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2))
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.includes("/src/")) {
      base = join(dirname(fileURLToPath(context.parentURL)), specifier)
    }
    if (base && !/\.[cm]?[jt]sx?$/.test(base)) {
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
})

const { emailOrigin, APRI_PRODUCTION_URL } = await import("../src/lib/app-url.ts")
const { configurationProblems } = await import("../src/lib/review-readiness.ts")
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("review emails no longer depend on APP_URL: unset or malformed means the production site", () => {
  const saved = process.env.APP_URL
  try {
    delete process.env.APP_URL
    assert.equal(emailOrigin(), APRI_PRODUCTION_URL)
    process.env.APP_URL = "not a url"
    assert.equal(emailOrigin(), APRI_PRODUCTION_URL)
    process.env.APP_URL = "javascript:alert(1)"
    assert.equal(emailOrigin(), APRI_PRODUCTION_URL, "only http(s) origins")
    process.env.APP_URL = "https://preview.example.invalid/some/path/"
    assert.equal(emailOrigin(), "https://preview.example.invalid", "an origin, never a path")
  } finally {
    if (saved === undefined) delete process.env.APP_URL
    else process.env.APP_URL = saved
  }
})

test("no review email path throws for a missing APP_URL any more", () => {
  for (const file of ["src/app/actions/review-funnel.ts", "src/app/actions/review-admin.ts", "src/app/actions/review-reader.ts"]) {
    const source = read(file)
    assert.doesNotMatch(source, /APP_URL is not configured/, file)
    assert.doesNotMatch(source, /process\.env\.APP_URL/, file)
  }
})

const GOOD = {
  SESSION_SECRET: "s".repeat(40),
  RESEND_API_KEY: "test-key",
  RESEND_WEBHOOK_SECRET: "test-webhook",
  PAPERMARK_API_TOKEN: "test-token",
}

test("a fully configured deployment reports nothing", () => {
  assert.deepEqual(configurationProblems(GOOD), [])
})

test("each missing setting is reported by name, never by value", () => {
  const keys = (env) => configurationProblems(env).map((p) => p.key)
  assert.deepEqual(keys({ ...GOOD, SESSION_SECRET: "short" }), ["session_secret"])
  assert.deepEqual(keys({ ...GOOD, RESEND_API_KEY: "" }), ["email_key"], "no delivery-report warning without a key at all")
  assert.deepEqual(keys({ ...GOOD, PAPERMARK_API_TOKEN: undefined }), ["papermark_token"])
  assert.deepEqual(keys({ ...GOOD, PAPERMARK_API_TOKEN: undefined, PAPERMARK_API_KEY: "legacy" }), [])
  assert.deepEqual(keys({ ...GOOD, RESEND_WEBHOOK_SECRET: undefined }), ["email_reports"])
  const all = configurationProblems({})
  assert.ok(all.every((p) => !p.message.includes("test-")), "no value is ever echoed")
  assert.deepEqual(all.filter((p) => p.level === "blocker").map((p) => p.key), ["session_secret", "email_key", "papermark_token"])
})

test("Admin shows a short status only for a real problem: the permanent setup banner is gone", () => {
  const page = read("src/app/admin/review-library/page.tsx")
  assert.doesNotMatch(page, /One setup task/)
  assert.doesNotMatch(page, /amber-50/, "no yellow panel on the normal view")
  assert.match(page, /problems\.length > 0 &&/)
})
