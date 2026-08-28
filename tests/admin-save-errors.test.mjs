import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { normalisePapermarkUrl, papermarkEmbedUrl } from "../src/lib/papermark-embed.ts"
import { seatsForSubscriptionRequest } from "../src/lib/entitlements.ts"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("subscriber Save derives entitlement, enforces Individual seats and validates dates", () => {
  const source = read("src/app/actions/subscribers.ts")
  assert.match(source, /levelForPublicTier\(d\.publicTier\)/)
  assert.match(source, /d\.publicTier === "Individual Access" \? 1 : d\.seats/)
  assert.match(source, /isRealIsoDate/)
  assert.match(source, /term_start = \$\{termStart\}::date/)
  assert.match(source, /term_end = \$\{termEnd\}::date/)
  assert.doesNotMatch(source, /status = \$\{d\.status\}/)
  assert.equal(seatsForSubscriptionRequest("Individual Access", "99"), 1)
})

test("subscriber Save accepts and normalises APRI and custom Papermark domains", () => {
  assert.equal(
    normalisePapermarkUrl("docs.athenacentre.org/view/private-test"),
    "https://docs.athenacentre.org/view/private-test",
  )
  assert.ok(
    papermarkEmbedUrl(
      "https://library.example.org/private-test",
      "library.example.org",
    ),
  )
})

test("subscriber Save and activation turn expected storage errors into form messages", () => {
  const source = read("src/app/actions/subscribers.ts")
  assert.match(source, /The subscriber could not be saved/)
  assert.match(source, /Subscriber storage is temporarily unavailable/)
  assert.match(source, /Activation checks could not be completed/)
  assert.match(source, /The subscriber was not fully activated/)
  assert.match(source, /returning id/)

  const form = read("src/app/admin/subscribers/[id]/subscriber-form.tsx")
  assert.match(form, /\[state, router\]/)
  assert.match(form, /state\?\.message/)
})

test("briefing Save normalises links and returns friendly storage failures", () => {
  const source = read("src/app/actions/briefings.ts")
  assert.match(source, /normalisePapermarkUrl/)
  assert.match(source, /The briefing request could not be saved/)
  assert.match(source, /Briefing storage is temporarily unavailable/)
  assert.match(source, /The briefing was not fully activated/)
  assert.doesNotMatch(source, /insert into subscribers/i)

  const form = read("src/app/admin/briefings/[id]/briefing-form.tsx")
  assert.match(form, /name="privateLinkUrl" type="text"/)
  assert.match(form, /HTTPS is added automatically/)
})

test("email callbacks and successful verification share one production route", () => {
  const email = read("src/lib/subscriber-email.ts")
  const appUrl = read("src/lib/app-url.ts")
  const verify = read("src/app/portal/verify/route.ts")
  assert.match(email, /portalVerificationUrl\(args\.token\)/)
  assert.match(appUrl, /https:\/\/apri\.athenacentre\.org/)
  assert.doesNotMatch(appUrl, /localhost|vercel\.app/)
  assert.match(verify, /new URL\("\/portal", request\.url\)/)
})
