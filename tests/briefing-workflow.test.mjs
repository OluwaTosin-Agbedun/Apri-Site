import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { portalVerificationUrl } from "../src/lib/app-url.ts"
import { portalPrincipalFromClaims } from "../src/lib/portal-session-claims.ts"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("briefing detail awaits Next 16 params and loads only briefing_requests", () => {
  const page = read("src/app/admin/briefings/[id]/page.tsx")
  assert.match(page, /params: Promise<\{ id: string \}>/)
  assert.match(page, /const \{ id \} = await params/)
  assert.match(page, /UUID\.test\(id\)/)
  assert.match(page, /from briefing_requests where id=/)
  assert.doesNotMatch(page, /from subscribers/)
  assert.match(page, /null::text as private_link_url/)
})

test("briefing save remains separate and refreshes its detail and list", () => {
  const actions = read("src/app/actions/briefings.ts")
  assert.match(actions, /update briefing_requests set/)
  assert.match(actions, /private_link_url=/)
  assert.match(actions, /revalidatePath\(`\/admin\/briefings\/\$\{id\}`\)/)
  assert.doesNotMatch(actions, /insert into subscribers/i)

  const form = read("src/app/admin/briefings/[id]/briefing-form.tsx")
  assert.match(form, /if \(state\?\.ok\) router\.refresh\(\)/)
  assert.match(form, /\[state, router\]/)
  assert.doesNotMatch(form, /subscription|seats|term_end/i)
})

test("activation marks only the briefing active before issuing its token and email", () => {
  const actions = read("src/app/actions/briefings.ts")
  const active = actions.indexOf("update briefing_requests set status='Active'")
  const token = actions.indexOf("issueBriefingToken(id)", active)
  const email = actions.indexOf("sendBriefingWelcome", token)
  assert.ok(active >= 0)
  assert.ok(token > active)
  assert.ok(email > token)
  assert.equal(
    portalVerificationUrl("briefing-test-token"),
    "https://apri.athenacentre.org/portal/verify?token=briefing-test-token",
  )
})

test("briefing and subscriber tokens and sessions cannot cross principals", () => {
  const magic = read("src/lib/magic-link.ts")
  const migration = read("db/migrations/20260826_briefing_portal.sql")
  assert.match(magic, /briefing_request_id,token_hash/)
  assert.match(magic, /principal\.type === "briefing"/)
  assert.match(magic, /createSubscriberSession\(principal\.id, "briefing"\)/)
  assert.match(magic, /createSubscriberSession\(subscriber\.id, "subscriber"\)/)
  assert.match(migration, /auth_tokens_one_principal_check/)
  assert.match(migration, /subscriber_id is not null and briefing_request_id is null/)
  assert.deepEqual(
    portalPrincipalFromClaims({ principalId: "briefing-a", principalType: "briefing" }),
    { principalId: "briefing-a", principalType: "briefing" },
  )
})

test("briefing deletion is owner-gated, exact-email confirmed, and principal scoped", () => {
  const actions = read("src/app/actions/briefings.ts")
  assert.match(actions, /export async function deleteBriefing/)
  assert.match(actions, /admin\.role !== "owner"/)
  assert.match(actions, /email=\$\{confirmationEmail\.trim\(\)\}/)
  assert.match(actions, /delete from briefing_requests where id=\$\{id\}/)
  assert.doesNotMatch(actions, /delete from subscribers/i)
  assert.doesNotMatch(actions, /delete from publications/i)
  assert.match(
    read("db/migrations/20260826_briefing_portal.sql"),
    /references briefing_requests\(id\)\s+on delete cascade/,
    /references briefing_requests\(id\) on delete cascade/,
  )

  const control = read("src/app/admin/briefings/briefing-delete-control.tsx")
  assert.match(control, /window\.prompt/)
  assert.match(control, /confirmation !== email/)
  assert.match(control, /window\.confirm/)
  assert.match(control, /Papermark access must be revoked separately/)
})

test("deleting a briefing invalidates an existing briefing session on its next portal read", () => {
  const dal = read("src/lib/subscriber-dal.ts")
  assert.match(dal, /from briefing_requests where id = \$\{session\.principalId\}/)
  assert.match(dal, /if \(!row\) redirect\("\/portal\/sign-in"\)/)
})
