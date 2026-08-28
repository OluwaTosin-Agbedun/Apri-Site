import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { portalVerificationUrl } from "../src/lib/app-url.ts"
import { hashToken, storedTokenFailureReason } from "../src/lib/magic-token.ts"
import { portalPrincipalFromClaims } from "../src/lib/portal-session-claims.ts"
import { subscriberLibraryEmbedUrl } from "../src/lib/papermark-embed.ts"

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("subscriber email links always use the canonical production verification route", () => {
  const url = portalVerificationUrl("safe-test-token")
  assert.equal(
    url,
    "https://apri.athenacentre.org/portal/verify?token=safe-test-token",
  )
  assert.doesNotMatch(url, /localhost|vercel\.app/i)
  assert.match(
    read("src/lib/subscriber-email.ts"),
    /portalVerificationUrl\(args\.token\)/,
  )
})

test("raw one-time tokens are hashed consistently before database storage", () => {
  const raw = "safe-test-token-that-is-never-emailed"
  const hash = hashToken(raw)
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(hashToken(raw), hash)
  assert.notEqual(hash, raw)

  const source = read("src/lib/magic-link.ts")
  assert.match(
    source,
    /insert into auth_tokens \(subscriber_id, token_hash, expires_at\)/,
  )
  assert.match(source, /consumed_at is null/)
  assert.match(source, /expires_at\s*>\s*now\(\)/)
})

test("invalid, expired and already-used token states are classified without secrets", () => {
  const now = new Date("2030-01-01T12:00:00Z")
  assert.equal(storedTokenFailureReason(null, now), "invalid")
  assert.equal(
    storedTokenFailureReason(
      { consumed_at: "2030-01-01T11:00:00Z", expires_at: "2030-01-01T13:00:00Z" },
      now,
    ),
    "used",
  )
  assert.equal(
    storedTokenFailureReason(
      { consumed_at: null, expires_at: "2030-01-01T11:59:59Z" },
      now,
    ),
    "expired",
  )
  assert.equal(
    storedTokenFailureReason(
      { consumed_at: null, expires_at: "2030-01-01T12:15:00Z" },
      now,
    ),
    "invalid",
  )
})

test("subscriber sessions preserve principal identity and reject malformed claims", () => {
  assert.deepEqual(
    portalPrincipalFromClaims({
      principalId: "subscriber-a",
      principalType: "subscriber",
    }),
    {
      principalId: "subscriber-a",
      principalType: "subscriber",
    },
  )
  assert.deepEqual(
    portalPrincipalFromClaims({ subscriberId: "legacy-subscriber" }),
    {
      principalId: "legacy-subscriber",
      principalType: "subscriber",
    },
  )
  assert.equal(
    portalPrincipalFromClaims({
      principalId: "subscriber-a",
      principalType: "admin",
    }),
    null,
  )

  const source = read("src/lib/subscriber-session.ts")
  assert.match(source, /httpOnly: true/)
  assert.match(source, /secure: process\.env\.NODE_ENV === "production"/)
  assert.match(source, /sameSite: "lax"/)
  assert.match(source, /path: "\/"/)
})

test("activation persists Active before issuing and emailing a one-time token", () => {
  const source = read("src/app/actions/subscribers.ts")
  const activated = source.indexOf("set status = 'active'")
  const issued = source.indexOf("issueToken(id)", activated)
  const emailed = source.indexOf("sendWelcome", issued)
  assert.ok(activated >= 0)
  assert.ok(issued > activated)
  assert.ok(emailed > issued)
  assert.match(source, /public_tier/)
  assert.match(source, /term_end/)
  assert.match(source, /library_link_url/)
})

test("verification redirects successful sessions to the portal and exposes clear failure states", () => {
  const route = read("src/app/portal/verify/route.ts")
  const page = read("src/app/portal/sign-in/page.tsx")
  assert.match(
    route,
    /NextResponse\.redirect\(new URL\(["']\/portal["'], request\.url\)\)/,
  )
  for (const reason of [
    "invalid",
    "expired",
    "used",
    "inactive",
    "subscription-expired",
  ]) {
    assert.match(page, new RegExp(reason))
  }
})

test("portal access is bound to the authenticated active subscriber and never falls back to Masters", () => {
  assert.equal(
    subscriberLibraryEmbedUrl({
      authenticatedSubscriberId: "subscriber-a",
      subscriberId: "subscriber-a",
      status: "active",
      termEnd: "2099-12-31",
      libraryLinkUrl: "https://docs.athenacentre.org/view/private-a",
    }),
    "https://docs.athenacentre.org/view/private-a?embed=1",
  )
  assert.equal(
    subscriberLibraryEmbedUrl({
      authenticatedSubscriberId: "subscriber-b",
      subscriberId: "subscriber-a",
      status: "active",
      termEnd: "2099-12-31",
      libraryLinkUrl: "https://docs.athenacentre.org/view/private-a",
    }),
    null,
  )
  for (const unsafe of [
    {
      status: "pending",
      termEnd: "2099-12-31",
      link: "https://docs.athenacentre.org/view/private-a",
    },
    {
      status: "active",
      termEnd: "2020-01-01",
      link: "https://docs.athenacentre.org/view/private-a",
    },
    {
      status: "active",
      termEnd: "2099-12-31",
      link: "https://docs.athenacentre.org/00-masters",
    },
  ]) {
    assert.equal(
      subscriberLibraryEmbedUrl({
        authenticatedSubscriberId: "subscriber-a",
        subscriberId: "subscriber-a",
        status: unsafe.status,
        termEnd: unsafe.termEnd,
        libraryLinkUrl: unsafe.link,
      }),
      null,
    )
  }

  const portal = read("src/app/portal/page.tsx")
  // The library is the page now. The button that used to send a subscriber off
  // to find it has gone, and nothing falls back to a shared Masters link.
  assert.doesNotMatch(portal, /Open Private Library/)
  assert.match(portal, /getSyncedClientDocuments/)
  assert.doesNotMatch(portal, /00 Masters/i)
})
