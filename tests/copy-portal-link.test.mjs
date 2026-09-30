/**
 * "Copy portal link" on the Admin subscriber page.
 *
 * The access email a subscriber receives carries a single-use sign-in token,
 * which is a bearer credential: whoever holds the link is signed in. So the
 * button never exposes that link. It copies the stable portal sign-in page,
 * which carries no token and no identity, and it is offered only for an active
 * seat whose own access email was accepted for delivery and has not bounced.
 *
 * These tests prove:
 *  - the decision itself, run directly (src/lib/portal-link-copy.ts), including
 *    that one subscriber's page can never be unlocked by another's email;
 *  - that the copied value is token-free and identical for every subscriber;
 *  - the properties only the source can show: the page is admin-gated, reads
 *    only the record being viewed, and the button calls nothing on the server.
 *
 * Written on the assumption that an attacker can read this repository: nothing
 * here relies on a route or value being hidden.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  decidePortalLinkCopy,
  isStableSignInUrl,
} from "../src/lib/portal-link-copy.ts"
import {
  APRI_PRODUCTION_URL,
  portalSignInUrl,
  portalVerificationUrl,
} from "../src/lib/app-url.ts"

const ROOT = resolve(import.meta.dirname, "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

const PAGE = "src/app/admin/subscribers/[id]/page.tsx"
const BUTTON = "src/app/admin/subscribers/[id]/copy-portal-link.tsx"
const DECISION = "src/lib/portal-link-copy.ts"

// Fixed test identities. Not real subscribers.
const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const NOW = new Date(2026, 8, 28, 12, 0, 0)

const subject = (over = {}) => ({
  subscriberId: A,
  status: "active",
  clientType: "subscriber",
  termEnd: null,
  ...over,
})
const accepted = (over = {}) => ({
  subscriberId: A,
  resendEmailId: "test-email-a",
  sentAt: "2026-09-27T09:00:00.000Z",
  failed: false,
  ...over,
})
const decide = (over = {}) =>
  decidePortalLinkCopy({
    subscriber: subject(over.subscriber),
    accessEmail: "accessEmail" in over ? over.accessEmail : accepted(),
    signInUrl: "signInUrl" in over ? over.signInUrl : portalSignInUrl(),
    now: NOW,
  })

// ---------------------------------------------------------------------------

describe("the copied value", () => {
  it("is the stable portal sign-in page", () => {
    const u = new URL(portalSignInUrl())
    assert.equal(u.origin, new URL(APRI_PRODUCTION_URL).origin)
    assert.equal(u.protocol, "https:")
    assert.equal(u.pathname, "/portal/sign-in")
    assert.equal(u.search, "")
    assert.equal(u.hash, "")
    assert.equal(isStableSignInUrl(portalSignInUrl()), true)
  })

  it("is never the tokened link from the access email", () => {
    const tokened = portalVerificationUrl("test-token-value")
    assert.match(tokened, /\/portal\/verify\?token=/)
    assert.notEqual(portalSignInUrl(), tokened)
    assert.equal(isStableSignInUrl(tokened), false)
    assert.doesNotMatch(portalSignInUrl(), /token|verify/i)
  })

  it("is the same for every subscriber and names none of them", () => {
    const a = decide()
    const b = decidePortalLinkCopy({
      subscriber: subject({ subscriberId: B }),
      accessEmail: accepted({ subscriberId: B, resendEmailId: "test-email-b" }),
      signInUrl: portalSignInUrl(),
      now: NOW,
    })
    assert.equal(a.show, true)
    assert.equal(b.show, true)
    assert.equal(a.url, b.url)
    for (const d of [a, b]) {
      assert.equal(d.url.includes(A), false)
      assert.equal(d.url.includes(B), false)
      assert.equal(d.url.includes("@"), false)
    }
  })

  it("refuses any address where a token or credential could ride along", () => {
    const base = portalSignInUrl()
    for (const url of [
      `${base}?token=abc`,
      `${base}?email=reader%40example.org`,
      `${base}#token=abc`,
      base.replace("https://", "http://"),
      base.replace("https://", "https://user:pass@"),
      base.replace("/portal/sign-in", "/portal/verify"),
      base.replace("/portal/sign-in", "/portal/sign-in/extra"),
      "",
      "not a url",
    ]) {
      assert.equal(isStableSignInUrl(url), false, url)
      const d = decide({ signInUrl: url })
      assert.equal(d.show, false, url)
      assert.equal("url" in d, false, url)
    }
  })
})

describe("when the button is offered", () => {
  it("shows for an active seat whose own access email was accepted", () => {
    const d = decide()
    assert.deepEqual(d, { show: true, url: portalSignInUrl(), subscriberId: A })
  })

  it("never lets another subscriber's email unlock this page", () => {
    // Subscriber A's page, handed subscriber B's delivery record.
    const d = decide({ accessEmail: accepted({ subscriberId: B }) })
    assert.equal(d.show, false)
    assert.match(d.reason, /does not belong to this subscriber/)
    assert.equal("url" in d, false)
  })

  it("returns the subscriber it was decided for, and only that one", () => {
    const forA = decide()
    const forB = decidePortalLinkCopy({
      subscriber: subject({ subscriberId: B }),
      accessEmail: accepted({ subscriberId: B }),
      signInUrl: portalSignInUrl(),
      now: NOW,
    })
    assert.equal(forA.subscriberId, A)
    assert.equal(forB.subscriberId, B)
  })

  it("hides until an access email has been accepted for delivery", () => {
    assert.equal(decide({ accessEmail: null }).show, false)
    assert.equal(decide({ accessEmail: accepted({ resendEmailId: null }) }).show, false)
    assert.equal(decide({ accessEmail: accepted({ resendEmailId: "" }) }).show, false)
  })

  it("hides when that email bounced or failed", () => {
    const d = decide({ accessEmail: accepted({ failed: true }) })
    assert.equal(d.show, false)
    assert.match(d.reason, /bounced or failed/)
  })

  it("hides for any seat that is not active", () => {
    for (const status of ["pending", "suspended", "lapsed", "revoked", "", "inactive"]) {
      assert.equal(decide({ subscriber: { status } }).show, false, status)
    }
    assert.equal(decide({ subscriber: { status: "ACTIVE" } }).show, true)
  })

  it("hides once the term has ended, as the portal would refuse sign-in", () => {
    assert.equal(decide({ subscriber: { termEnd: "2026-09-27" } }).show, false)
    assert.equal(decide({ subscriber: { termEnd: new Date(2026, 8, 27) } }).show, false)
    assert.equal(decide({ subscriber: { termEnd: "not a date" } }).show, false)
    // Ending today is still current, as at sign-in.
    assert.equal(decide({ subscriber: { termEnd: new Date(2026, 8, 28) } }).show, true)
    assert.equal(decide({ subscriber: { termEnd: "2027-01-31" } }).show, true)
    assert.equal(decide({ subscriber: { termEnd: null } }).show, true)
  })

  it("hides for a record that is not a subscriber", () => {
    for (const clientType of ["briefing", "prospect", ""]) {
      assert.equal(decide({ subscriber: { clientType } }).show, false, clientType)
    }
  })
})

describe("the decision module", () => {
  const src = read(DECISION)

  it("holds no data source of its own: its only import is the pure term rule", () => {
    const imports = src.split(/\r?\n/).filter((line) => /^\s*import\s/.test(line))
    assert.deepEqual(imports, [`import { dateOnly, lagosToday } from "./subscription-term.ts"`])
    assert.doesNotMatch(read("src/lib/subscription-term.ts"), /^\s*import\s/m, "and that rule imports nothing")
  })

  it("does not build or accept a tokened link", () => {
    assert.doesNotMatch(src, /portalVerificationUrl|\/portal\/verify\?/)
  })
})

describe("the button", () => {
  const src = read(BUTTON)

  it("is a client component that calls nothing on the server", () => {
    assert.match(src, /^"use client"/)
    const imports = [...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1])
    assert.deepEqual(imports, ["react"])
    assert.doesNotMatch(src, /\bfetch\(|@\/app\/actions|useActionState|formAction|<form/)
  })

  it("copies only the URL it was given", () => {
    assert.match(src, /navigator\.clipboard\.writeText\(url\)/)
    assert.equal(src.match(/writeText\(/g).length, 1)
  })

  it("never builds a tokened link itself", () => {
    assert.doesNotMatch(src, /portalVerificationUrl|\/portal\/verify|token=/)
  })

  it("clicking it sends no email and creates no link: nothing that could is reachable", () => {
    // Its only import is React (asserted above), and nothing in it names an
    // email sender, a token issuer, a sign-in link, Papermark or a server call.
    assert.doesNotMatch(
      src,
      /resend|sendSignInLink|sendWelcome|resendSignInLink|newToken|hashToken|auth_tokens|createReviewDocumentLink|papermark|"use server"|\bfetch\(|sendBeacon/i,
    )
    const click = src.slice(src.indexOf("async function copy()"), src.indexOf("const who ="))
    // The click does one thing with the outside world: a clipboard write.
    assert.deepEqual([...click.matchAll(/await ([\w.?]+)\(/g)].map((m) => m[1]), ["navigator.clipboard.writeText"])
  })

  it("says whose link it is", () => {
    assert.match(src, /aria-label=\{`Copy portal link for \$\{who\}`\}/)
    assert.match(src, /\{subscriberName \|\| "this subscriber"\}/)
    assert.match(src, /\{subscriberEmail \?/)
  })

  it("confirms a copy only after it succeeded", () => {
    const tryBlock = src.slice(src.indexOf("try {"), src.indexOf("} catch"))
    assert.ok(
      tryBlock.indexOf("await navigator.clipboard.writeText(url)") <
        tryBlock.indexOf('setState("copied")'),
      "Copied must be set after the write resolves",
    )
    assert.match(src, /aria-live="polite"/)
    assert.match(src, /state === "copied" \? "Copied"/)
  })

  it("falls back to a selectable field when the clipboard is unavailable", () => {
    assert.match(src, /if \(!navigator\.clipboard\?\.writeText\) throw/)
    assert.match(src, /\} catch \{[\s\S]*?setState\("failed"\)/)
    assert.match(src, /state === "failed" && \(/)
    assert.match(src, /<input\s+readOnly\s+value=\{url\}/)
  })
})

describe("the subscriber page", () => {
  const src = read(PAGE)

  it("is admin-gated before anything is read", () => {
    const gate = src.indexOf("await requireAdmin()")
    assert.notEqual(gate, -1)
    assert.ok(gate < src.indexOf("getSql()"), "requireAdmin must run before any query")
    assert.ok(gate < src.indexOf("decidePortalLinkCopy("))
  })

  it("reads only the access email of the record being viewed", () => {
    const start = src.indexOf("const accessEmails")
    const query = src.slice(start, src.indexOf("`)", start))
    assert.match(query, /where e\.subscriber_id = \$\{row\.id\}::uuid/)
    assert.match(query, /e\.event_type = 'signin_email_sent'/)
    assert.match(query, /e\.resend_email_id is not null/)
    assert.match(query, /f\.subscriber_id = e\.subscriber_id/)
    assert.match(query, /f\.resend_email_id = e\.resend_email_id/)
    assert.match(query, /'email_bounced', 'email_failed'/)
    // Nothing from the request other than the already-validated record id.
    assert.doesNotMatch(query, /\$\{id\}|searchParams|params/)
  })

  it("decides for that same record", () => {
    const start = src.indexOf("decidePortalLinkCopy(")
    const call = src.slice(start, src.indexOf("signInUrl:", start))
    assert.match(call, /subscriberId: row\.id/)
    assert.match(call, /subscriberId: accessEmails\[0\]\.subscriber_id/)
    assert.match(src, /signInUrl: portalSignInUrl\(\)/)
  })

  it("renders the button only on a positive decision, labelled with this subscriber", () => {
    assert.match(
      src,
      /\{portalLink\.show && \(\s*<CopyPortalLink\s+url=\{portalLink\.url\}\s+subscriberName=\{draft\.fullName\}\s+subscriberEmail=\{row\.email\}\s*\/>\s*\)\}/,
    )
    assert.equal(src.match(/<CopyPortalLink/g).length, 1)
  })

  it("never reads sign-in tokens or builds a tokened link", () => {
    assert.doesNotMatch(src, /auth_tokens|token_hash|portalVerificationUrl|\/portal\/verify/)
  })

  it("adds no new write path", () => {
    assert.doesNotMatch(src, /\b(insert into|update subscribers|delete from)\b/i)
  })
})
