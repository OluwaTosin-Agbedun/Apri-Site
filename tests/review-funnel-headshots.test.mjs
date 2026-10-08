import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
test("review page contains exact Chancellor copy and no phone field", () => {
  const s =
    read("src/app/review/page.tsx") + read("src/app/review/review-form.tsx")
  assert.match(s, /Review Athena Political &amp; Regulatory Intelligence/)
  assert.match(s, /Complimentary access to selected APRI publications/)
  assert.doesNotMatch(read("src/app/review/review-form.tsx"), /name="phone"/)
  assert.doesNotMatch(s, /instant access|Open Edition/i)
})
test("confirmation and subscription copy are exact", () => {
  const c = read("src/app/review/confirmed/page.tsx"),
    t = read("src/app/review/subscribe/thanks/page.tsx")
  assert.match(c, /Your email has been confirmed\./)
  assert.match(c, /We are preparing your complimentary review access\./)
  assert.match(t, /Thank you for your APRI subscription request\./)
  assert.match(
    t,
    /activated once the agreement has\s+been completed and payment confirmed\./,
  )
})
test("tokens are random, hashed, expiring and single use", () => {
  const a = read("src/app/actions/review-funnel.ts"),
    s = read("src/lib/review-security.ts")
  assert.match(s, /randomBytes\(32\)/)
  assert.match(s, /createHash\("sha256"\)/)
  assert.match(a, /interval '24 hours'/)
  assert.match(a, /consumed_at is null/)
  assert.doesNotMatch(
    read("db/migrations/20260917_review_funnel_team_images.sql"),
    /\btoken\s+text/i,
  )
})
test("public review query never selects secure URL", () => {
  const s = read("src/lib/publications.ts"),
    fn = s.slice(
      s.indexOf("getPublicReviewLibrary"),
      s.indexOf("getReviewLibrary"),
    )
  assert.doesNotMatch(fn, /secure_link_url|secureUrl/)
})
test("headshots enforce owner, mime, signature, size and safe URL", () => {
  const a = read("src/app/actions/team-images.ts"),
    l = read("src/lib/team-images.ts")
  assert.match(a, /requireOwner\(\)/)
  assert.match(l, /4\s*\*\s*1024\s*\*\s*1024/)
  assert.match(l, /image\/jpeg/)
  assert.match(l, /file contents do not match/)
  assert.match(l, /Private network URLs are not allowed/)
})
test("activation gate requires all commercial milestones", () => {
  // The action reads every milestone and hands them to activationGate before
  // any write; the gate itself is tested as behaviour in subscription-journey.test.mjs.
  const s = read("src/app/actions/review-admin.ts")
  for (const field of [
    "verified_at",
    "agreement_sent_at",
    "agreement_signed_at",
    "invoice_sent_at",
    "payment_confirmed_at",
    "subscription_starts_at",
    "subscription_ends_at",
  ])
    assert.match(s, new RegExp(field))
  const fn = s.slice(s.indexOf("export async function activateSubscriptionRequest("))
  assert.ok(fn.indexOf("activationGate(") > 0 && fn.indexOf("activationGate(") < fn.indexOf("insert into subscribers"))
  const plans = read("src/lib/subscription-journey.ts")
  const catalogue = read("src/lib/subscription-catalogue.ts")
  assert.match(catalogue, /storedName: "Professional Team Access"/)
  assert.match(catalogue, /seats: 3/)
  assert.match(plans, /maxUsers: PROFESSIONAL\.seats/)
  assert.match(plans, /if \(cleaned\.length > max\)/)
})
test("manager destination is fixed and PII is not sent to analytics", () => {
  assert.match(
    read("src/lib/review-email.ts"),
    /intelligence@athenacentre\.org/,
  )
  const all = read("src/app/actions/review-funnel.ts")
  assert.doesNotMatch(all, /@vercel\/analytics|track\(/)
})
test("Complimentary Review downloads are personalised and applied one edition at a time", () => {
  const contract = read("src/lib/papermark-dataroom-contract.ts")
  const service = read("src/lib/papermark-datarooms.ts")
  const access = read("src/app/actions/review-edition-access.ts")
  const reviewSettings = contract.slice(contract.indexOf("export function reviewLinkSettings"), contract.indexOf("export function isDocumentTargetedLink"))
  assert.match(reviewSettings, /allow_download: true/)
  assert.match(contract, /email_protected: true/)
  assert.match(contract, /email_authenticated: true/)
  assert.match(contract, /enable_watermark: true/)
  assert.match(contract, /enable_screenshot_protection: true/)
  assert.match(contract, /opacity: 0\.15/)
  assert.match(contract, /font_size: 18/)
  assert.match(contract, /APRI Complimentary Review Copy · \{\{email\}\}/)
  assert.match(service, /args\.allowList\.length === 0/)
  // Applying recipients changes the allow list only; the link is never recreated.
  const apply = access.slice(access.indexOf("export async function applyEditionRecipients"))
  const body = apply.slice(0, apply.indexOf("\n}") + 2)
  assert.match(body, /setReviewLinkAllowList/)
  assert.doesNotMatch(body, /createReviewDocumentLink|updateReviewDocumentLink/)
  assert.doesNotMatch(body, /method: ['"]POST/)
})
test("verification cannot grant access, mutate Papermark or create subscribers", () => {
  const actions = read("src/app/actions/review-funnel.ts")
  const verify = actions.slice(actions.indexOf("async function verifyReviewToken"), actions.indexOf("async function consumeReviewAccessToken"))
  assert.doesNotMatch(verify, /createReviewSession|papermark|insert into subscribers|status='active'/i)
  assert.match(read("src/app/review/verify/route.ts"), /NextResponse\.redirect/)
})
test("secure review access checks live Papermark policy for each granted edition", () => {
  const actions = read("src/app/actions/review-funnel.ts")
  const send = actions.slice(
    actions.indexOf("async function sendSecureReviewAccess"),
    actions.indexOf("export async function sendSecureReviewAccessFromForm"),
  )
  assert.match(send, /grantedEditionsForProspect\(sql, p\.email\)/)
  assert.match(send, /expectedRecipientsForEdition\(sql, edition\)/)
  assert.match(send, /verifyReviewDocumentLink/)
  assert.match(send, /expectedAllowList: expected/)
  assert.match(send, /granted\.length === 0/)
  // The pre-edition fixed-slot check is gone.
  assert.doesNotMatch(send, /complimentary_review_items|links\.length !== 3/)
})
test("repeat review requests preserve first-touch attribution", () => {
  const actions = read("src/app/actions/review-funnel.ts")
  const conflict = actions.slice(actions.indexOf("on conflict ((lower(email)))"), actions.indexOf("returning id"))
  assert.doesNotMatch(conflict, /first_utm_\w+\s*=/)
  assert.doesNotMatch(conflict, /attributed_source\s*=/)
  assert.match(conflict, /latest_utm_source=excluded\.latest_utm_source/)
})
test("activating a request never overwrites an existing active subscriber", () => {
  const actions = read("src/app/actions/review-admin.ts")
  const activate = actions.slice(actions.indexOf("export async function activateSubscriptionRequest("))
  // An active subscriber this request did not create is reported, not changed.
  assert.match(activate, /existing\.status\.toLowerCase\(\) === "active"\) \{\s*outcomes\.push\(\{\s*\.\.\.user,\s*state: "blocked"/)
  // Only an inactive, unlinked record can be taken on, and the update says so itself.
  assert.match(activate, /where id = \$\{existing\.id\}::uuid and subscription_request_id is null and lower\(status\) <> 'active'/)
  // A new record never replaces an existing one.
  assert.match(activate, /on conflict \(\(lower\(email\)\)\) do nothing/)
  // "Access Activated" only when every named person's access is ready.
  assert.match(activate, /const next = complete \? laterStatus\(status, "Access Activated"\) : status/)
})
test("migration enforces append-only events and one unused token", () => {
  const migration = read("db/migrations/20260917_review_funnel_team_images.sql")
  assert.match(migration, /begin;/)
  assert.match(migration, /commit;/)
  assert.match(migration, /review_prospect_events_no_update/)
  assert.match(migration, /review_prospect_events_no_delete/)
  assert.match(migration, /review_tokens_one_unused_per_purpose/)
  assert.match(migration, /expires_at > created_at/)
})
