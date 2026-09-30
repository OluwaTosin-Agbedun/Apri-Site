/**
 * Individual and Professional subscriptions -- the server paths.
 *
 * What these check: both entry points reach a working form with the right
 * plan; a request never grants anything; identity comes from the session or
 * the email given, never an id the client sends; activation is gated on the
 * server on every path; and retries create nothing twice.
 */

import { describe, it, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

function body(src, name) {
  const start = src.search(new RegExp(`(export )?async function ${name}\\(`))
  assert.notEqual(start, -1, `${name} must exist`)
  const rest = src.slice(start)
  const end = rest.search(/\n\}[ \t]*(\r?\n|$)/)
  assert.notEqual(end, -1)
  return rest.slice(0, end + 2)
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel))
    else out.push(rel)
  }
  return out
}

const FUNNEL = "src/app/actions/review-funnel.ts"
const ADMIN = "src/app/actions/review-admin.ts"
const ACTIVATION = "src/lib/subscriber-activation.ts"

describe("Subscription Access shows the two plans", () => {
  const page = read("src/app/access/page.tsx")

  it("with their prices, limits and request buttons, which select the plan in the existing form", () => {
    assert.match(page, /<section id="plans"/)
    assert.match(page, /SUBSCRIPTION_LEVELS\.map/)
    assert.match(page, /href=\{`\/access\?level=\$\{encodeURIComponent\(storedName\)\}\$\{utmQuery\}#subscribe`\}/)
    assert.match(page, /Request Access/)
    assert.doesNotMatch(page, /Subscription Plans/)
    assert.match(page, /\["source", "medium", "campaign", "term", "content"\]/)
    assert.match(page, /<AccessForm defaultLevel=\{defaultLevel\} utm=\{utm\} \/>/)
  })

  it("keeps the other levels and their enquiry form, without inventing prices for them", () => {
    assert.match(page, /"Political Monitor",\s*"Executive Intelligence",\s*"Board Briefing"/)
    assert.match(page, /href=\{`\/access\?level=\$\{encodeURIComponent\(storedName\)\}\$\{utmQuery\}#subscribe`\}/)
    assert.doesNotMatch(page, /₦/, "prices come only from the two plans")
    assert.doesNotMatch(read("src/lib/entitlements.ts"), /₦/)
  })

  it("the existing form becomes the plan request for Individual and Professional, and stays an enquiry otherwise", () => {
    const form = read("src/app/access-form.tsx")
    assert.match(form, /const plan = Object\.values\(PLANS\)\.find\(\(p\) => p\.tier === subscriptionLevel\) \?\? null/)
    assert.match(form, /const action = plan \? planAction : enquiryAction/)
    assert.match(form, /useActionState\(submitPublicSubscriptionRequest, \{\}\)/)
    assert.match(form, /useActionState\(requestAccess, undefined\)/)
    for (const field of ["phone", "legalName", "billingEmail", "billingAddress", "cityState", "country", "taxReference", "source", "plan"]) {
      assert.match(form, new RegExp(`name="${field}"`), field)
    }
    assert.match(form, /Array\.from\(\{ length: plan\.maxUsers \}/)
    assert.match(form, /No card details are collected/)
  })

  it("the old enquiry path refuses the two plans, so they cannot bypass the agreement and payment gate", () => {
    const fn = body(read("src/app/actions/public.ts"), "requestAccess")
    const refusal = fn.indexOf('requestedTier === "Individual Access" || requestedTier === "Professional Team Access"')
    assert.ok(refusal > 0 && refusal < fn.indexOf("insert into subscribers"))
  })

  it("both forms reach the same subscription request workflow", () => {
    const funnel = read(FUNNEL)
    const pub = body(funnel, "submitPublicSubscriptionRequest")
    const rev = body(funnel, "submitSubscriptionRequest")
    for (const fn of [pub, rev]) assert.match(fn, /insert into review_subscription_requests/)
    // The /access form's own field names are read as well.
    assert.match(pub, /either\("fullName", "name", 120\)/)
    assert.match(pub, /either\("organisation", "organization", 160\)/)
    assert.match(pub, /formData\.get\("acceptedTerms"\) !== "on"/)
    assert.match(pub, /Object\.values\(PLANS\)\.find\(\(p\) => p\.tier === level\)/)
  })

  it("keeps signing in separate from requesting a subscription", () => {
    assert.match(page, /href="\/portal\/sign-in"/)
  })

  it("the Review Library keeps the same two plans after its publication listings", () => {
    const library = read("src/app/review/library/page.tsx")
    assert.ok(library.indexOf("Request Individual Access") > library.indexOf("editions.map("))
    assert.match(library, /Individual Access — ₦2 million annually/)
    assert.match(library, /Professional Access — ₦5 million annually/)
    assert.match(library, /Up to 3 named authorised subscribers/)
  })

  it("/review stays the complimentary review request, with no plan cards", () => {
    assert.doesNotMatch(read("src/app/review/page.tsx"), /₦|plan=Individual|plan=Professional/)
  })
})

describe("the request form", () => {
  const page = read("src/app/review/subscribe/page.tsx")
  const form = read("src/app/review/subscribe/subscription-form.tsx")

  it("serves visitors without a review session instead of redirecting them", () => {
    assert.doesNotMatch(page, /redirect\("\/review"\)/)
    assert.match(page, /\{prospectId \? \(\s*<SubscriptionForm mode="review"/)
    assert.match(page, /<SubscriptionForm mode="public" plan=\{plan\} utm=\{utm\} \/>/)
    // An unknown plan goes to the page that lists both, never round in a loop.
    assert.match(page, /if \(!plan\) redirect\("\/access#plans"\)/)
  })

  it("has the plan selected and collects contracting, billing and up to three named users", () => {
    assert.match(form, /<input type="hidden" name="plan" value=\{plan\} \/>/)
    for (const field of ["phone", "legalName", "billingEmail", "billingAddress", "cityState", "country", "taxReference"]) {
      assert.match(form, new RegExp(`name="${field}"`))
    }
    assert.match(form, /Array\.from\(\{ length: details\.maxUsers \}/)
    assert.match(form, /name=\{`userName\$\{i\}`\}/)
    assert.match(form, /name=\{`userEmail\$\{i\}`\}/)
  })

  it("asks a public visitor who they are, and never takes card details", () => {
    for (const field of ["fullName", "email", "role", "userType", "source", "website", "referrerHost"]) {
      assert.match(form, new RegExp(`name="${field}"`))
    }
    assert.match(form, /No card details are collected/)
    assert.doesNotMatch(form, /card(Number|number)|cvv|cvc|expiry/i)
  })

  it("thanks the requester in the agreed words", () => {
    const thanks = read("src/app/review/subscribe/thanks/page.tsx").replace(/\s+/g, " ")
    assert.match(thanks, /Thank you for your APRI subscription request\./)
    assert.match(
      thanks,
      /We will send your subscription agreement and payment details shortly\. Your secure subscriber access will be activated once the agreement has been completed and payment confirmed\./,
    )
  })
})

describe("a request grants nothing", () => {
  const funnel = read(FUNNEL)
  const review = body(funnel, "submitSubscriptionRequest")
  const pub = body(funnel, "submitPublicSubscriptionRequest")

  it("neither submission creates a subscriber, a sign-in, a link or an active status", () => {
    for (const fn of [review, pub]) {
      assert.doesNotMatch(fn, /insert into subscribers|issueToken|createReviewSession|status\s*=\s*'active'|papermark|activateSubscriberRecord/i)
    }
  })

  it("no payment gateway or checkout exists anywhere in the application", () => {
    for (const file of walk("src").filter((f) => /\.(ts|tsx)$/.test(f))) {
      assert.doesNotMatch(read(file), /stripe|paystack|flutterwave|checkout\.session|payment_intent/i, file)
    }
    const pkg = JSON.parse(read("package.json"))
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      assert.doesNotMatch(dep, /stripe|paystack|flutterwave/i)
    }
  })
})

describe("identity is never taken from the client", () => {
  const funnel = read(FUNNEL)

  it("a Review Library request is accepted only for the prospect holding the session", () => {
    const fn = body(funnel, "submitSubscriptionRequest")
    assert.match(fn, /if \(\(await session\(\)\) !== prospectId\)\s*return \{ message: "Your review session has expired\." \}/)
    assert.ok(fn.indexOf("session()") < fn.indexOf("getSql()"))
  })

  it("a public request is matched by the email given, never by an id in the form", () => {
    const fn = body(funnel, "submitPublicSubscriptionRequest")
    assert.doesNotMatch(fn, /formData\.get\("(prospectId|prospect|subscriberId|id)"\)/)
    assert.match(fn, /on conflict \(\(lower\(email\)\)\) do nothing/)
    assert.match(fn, /select id from review_prospects where lower\(email\)=\$\{email\} limit 1/)
  })

  it("an existing prospect keeps their details and first-touch attribution", () => {
    const fn = body(funnel, "submitPublicSubscriptionRequest")
    const update = fn.slice(fn.indexOf("update review_prospects set latest_utm_source"), fn.indexOf("} else {"))
    assert.doesNotMatch(update, /first_utm|full_name|attributed_source|self_reported_source/)
  })

  it("a public request counts only once the requester confirms the address", () => {
    const fn = body(funnel, "submitPublicSubscriptionRequest")
    assert.match(fn, /'access_page'\)\s*on conflict\(prospect_id\) do nothing/)
    assert.match(fn, /sendSubscriptionConfirmation\(email, fullName/)
    const verify = body(funnel, "verifyReviewToken")
    assert.match(verify, /update review_subscription_requests set requester_confirmed_at=coalesce\(requester_confirmed_at,now\(\)\)/)
    assert.match(read("src/lib/subscription-schema.ts"), /if \(r\.submitted_via === 'access_page'\) return Boolean\(r\.requester_confirmed_at\)/)
  })

  it("confirming an email never moves a prospect backwards", () => {
    const verify = body(funnel, "verifyReviewToken")
    assert.match(verify, /set status = case when p\.status = 'Review Requested' then 'Email Verified' else p\.status end/)
  })

  it("repeat submissions create nothing twice and resend nothing", () => {
    const fn = body(funnel, "submitPublicSubscriptionRequest")
    assert.ok(fn.indexOf("if (inserted[0]) {") < fn.indexOf("sendRequestEmails("))
    assert.match(body(funnel, "submitSubscriptionRequest"), /\/\/ A repeat submission changes nothing and sends nothing\.\s*if \(inserted\[0\]\)/)
  })

  it("a mail failure never loses a stored request", () => {
    const fn = body(funnel, "sendRequestEmails")
    assert.match(fn, /try \{[\s\S]*sendSubscriptionMessages[\s\S]*\} catch \{[\s\S]*confirmation_email_failed/)
  })

  it("the public path is rate-limited and has a honeypot", () => {
    const fn = body(funnel, "submitPublicSubscriptionRequest")
    assert.match(fn, /enforceReviewRateLimit\("subscription_request_public", 4\)/)
    assert.ok(fn.indexOf('formData.get("website")') < fn.indexOf("getSql()"))
  })
})

describe("activation is gated on the server, on every path", () => {
  it("the shared activation holds a request's subscribers to the gate before changing anything", () => {
    const fn = body(read(ACTIVATION), "activateSubscriberRecord")
    const gate = fn.indexOf("gate = await acquisitionGate(sql, row)")
    assert.ok(gate > 0 && gate < fn.indexOf("set status = 'active'"))
    assert.match(fn, /if \(gate && !gate\.ok\) \{\s*return blocked\(/)
    const acquisition = body(read(ACTIVATION), "acquisitionGate")
    assert.match(acquisition, /join review_subscription_requests r on r\.id = s\.subscription_request_id/)
    assert.match(acquisition, /LEGACY_REQUEST_NOTE\.exec/, "records prepared before the link column are gated too")
    assert.match(acquisition, /This person listed as a named subscriber on the request/)
  })

  it("the Subscribers page Activate button uses that same function", () => {
    assert.match(body(read("src/app/actions/subscribers.ts"), "activateSubscriber"), /activateSubscriberRecord\(/)
  })

  it("request activation: owner only, migration checked, gate before any write", () => {
    const fn = body(read(ADMIN), "activateSubscriptionRequest")
    assert.match(fn, /const admin = await requireOwner\(\)/)
    assert.ok(fn.indexOf("subscriptionActivationReady(sql, { fresh: true })") < fn.indexOf("activationGate("))
    assert.ok(fn.indexOf("if (!gate.ok)") < fn.indexOf("insert into subscribers"))
  })

  it("each named person gets their own record, at the plan's tier and level", () => {
    const fn = body(read(ADMIN), "activateSubscriptionRequest")
    assert.match(fn, /const tier = PLANS\[gate\.plan\]\.tier/)
    assert.match(fn, /const level = levelForPublicTier\(tier\)/)
    assert.match(fn, /for \(const user of gate\.users\)/)
    assert.match(fn, /'pending', \$\{invoiceRef\}, \$\{requestId\}::uuid/)
  })

  it("each person's emails are tracked on their own record, and completion needs access and both emails", () => {
    const fn = body(read(ADMIN), "activateSubscriptionRequest")
    assert.match(fn, /const result = await activateSubscriberRecord\(\{ subscriberId, admin, onboardingOwed: welcomedBefore\.length === 0 \}\)/)
    // The old flow's welcome events are only read, to tell who is still owed onboarding; none is written.
    assert.doesNotMatch(fn, /insert into review_prospect_events[^`]*subscriber_welcomed/)
    assert.doesNotMatch(fn, /welcome: /, "no request-level welcome flag that could be set without a send")
    assert.match(fn, /if \(result\.state === "activated" && activationDone\(result\)\)/)
    assert.match(fn, /state: "emails_pending", reason: result\.onboarding\.message/)
    assert.match(fn, /result\.state === "access_not_ready"/)
    assert.match(fn, /const complete = activationComplete\(outcomes, gate\.users\.length\)/)
    assert.match(fn, /if \(complete\) \{\s*await sql`\s*update review_subscription_requests\s*set activated_at = coalesce\(activated_at, now\(\)\)/)
    assert.match(fn, /return \{ ok: complete, message: summary \}/)
  })

  it("never throws a redacted error at the owner: every refusal is a message", () => {
    for (const name of ["activateSubscriptionRequest", "saveCommercialMilestones"]) {
      assert.doesNotMatch(body(read(ADMIN), name), /throw new Error/)
    }
  })
})

describe("recording milestones", () => {
  const fn = body(read(ADMIN), "saveCommercialMilestones")

  it("owner only; a blank field keeps what is recorded, including the term", () => {
    assert.match(fn, /const admin = await requireOwner\(\)/)
    assert.match(fn, /date\("termStart", "Subscription start", true\) \?\? day\(before\.subscription_starts_at\)/)
    assert.match(fn, /date\("paymentConfirmed", "Payment confirmed"\) \?\? day\(before\.payment_confirmed_at\)/)
  })

  it("keeps the order: sent before signed, invoice before payment, nothing in the future", () => {
    assert.match(fn, /if \(signed && !sent\)/)
    assert.match(fn, /if \(paid && !invoice\)/)
    assert.match(fn, /cannot be in the future/)
  })

  it("writes every milestone to the append-only history, and never activates", () => {
    for (const event of ["agreement_sent", "agreement_signed", "invoice_issued", "payment_confirmed"]) {
      assert.match(fn, new RegExp(`event: "${event}"`))
    }
    assert.match(fn, /insert into review_prospect_events/)
    assert.doesNotMatch(fn, /Access Activated|insert into subscribers|activateSubscriberRecord/)
  })
})

describe("the Admin screen", () => {
  const page = read("src/app/admin/review-requests/[id]/page.tsx")
  const screen = read("src/app/admin/review-requests/[id]/subscription-processing.tsx")

  it("is owner only and shows the same gate the action enforces", () => {
    assert.match(page, /const admin = await requireOwner\(\)/)
    assert.match(page, /const gate = activationGate\(/)
    assert.match(screen, /Still needed before activation/)
  })

  it("shows recorded dates and references, the source attribution and each named person", () => {
    for (const label of ["Agreement sent", "Agreement signed", "Invoice issued", "Payment confirmed", "Lead source", "UTM (first / latest)", "Named subscribers"]) {
      assert.ok(screen.includes(label), label)
    }
    assert.match(page, /agreementSent: day\(r\.agreement_sent_at\)/, "recorded dates are shown, not blanked")
    assert.match(screen, /DocuSign envelope or manual/)
  })
})

test("the activation migration is additive and gated", () => {
  const sql = read("db/migrations/20260930_subscription_activation.sql").replace(/--.*$/gm, "")
  assert.match(sql, /add column if not exists subscription_request_id uuid\s+references review_subscription_requests \(id\) on delete restrict/)
  assert.match(sql, /add column if not exists submitted_via text not null default 'review_library'/)
  assert.match(sql, /check \(submitted_via in \('review_library', 'access_page'\)\)/)
  assert.match(sql, /add column if not exists requester_confirmed_at timestamptz/)
  assert.doesNotMatch(sql, /update subscribers|delete from/)
})
