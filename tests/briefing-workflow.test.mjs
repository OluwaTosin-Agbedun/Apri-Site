import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
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
})

test("briefing requests are service enquiries without portal activation", () => {
  const actions = read("src/app/actions/briefings.ts")
  assert.match(actions, /update briefing_requests set/)
  assert.doesNotMatch(actions, /issueBriefingToken/)
  assert.doesNotMatch(actions, /sendBriefingWelcome/)
  assert.doesNotMatch(actions, /activateBriefing/)
  assert.doesNotMatch(actions, /resendBriefingSignInLink/)
  assert.doesNotMatch(actions, /briefingPortalSchemaReady/)
  assert.doesNotMatch(actions, /normalisePapermarkUrl/)
  assert.doesNotMatch(actions, /papermarkEmbedUrl/)
})

test("briefing admin form has no portal activation controls", () => {
  const form = read("src/app/admin/briefings/[id]/briefing-form.tsx")
  assert.match(form, /if \(state\?\.ok\) router\.refresh\(\)/)
  assert.doesNotMatch(form, /activateBriefing/)
  assert.doesNotMatch(form, /resendBriefingSignInLink/)
  assert.doesNotMatch(form, /PapermarkFolderSelector/)
  assert.doesNotMatch(form, /privateLinkUrl/)
  assert.match(form, /status/)
  assert.match(form, /notes/)
})

test("briefing admin detail page has no Data Room or Papermark panels", () => {
  const page = read("src/app/admin/briefings/[id]/page.tsx")
  assert.doesNotMatch(page, /BriefingDataRoomPanel/)
  assert.doesNotMatch(page, /PapermarkConnectionPanel/)
  assert.doesNotMatch(page, /getAssignableFolders/)
  assert.doesNotMatch(page, /getDataRoomLink/)
  assert.match(page, /View and manage this briefing service request/)
})

test("public briefing form offers Virtual, In person, and Hybrid modes", () => {
  const form = read("src/app/request-briefing/briefing-form.tsx")
  assert.match(form, /Mode of Briefing/)
  assert.match(form, /Virtual/)
  assert.match(form, /In person/)
  assert.match(form, /Hybrid/)
  assert.doesNotMatch(form, /Either/)
})

test("public briefing submission does not create subscriber or portal access", () => {
  const action = read("src/app/actions/public.ts")
  const briefingSection = action.slice(
    action.indexOf("export async function requestBriefing"),
  )
  assert.doesNotMatch(briefingSection, /issueBriefingToken/)
  assert.doesNotMatch(briefingSection, /createSubscriberSession/)
  assert.doesNotMatch(briefingSection, /insert into subscribers/)
})

test("the sign-in flow does not issue tokens to briefing requesters", () => {
  const auth = read("src/app/actions/subscriber-auth.ts")
  assert.doesNotMatch(auth, /issueBriefingToken/)
  assert.doesNotMatch(auth, /sendBriefingWelcome/)
  assert.doesNotMatch(auth, /briefing_requests/)
})

test("magic-link sign-in rejects briefing tokens", () => {
  const magic = read("src/lib/magic-link.ts")
  assert.doesNotMatch(magic, /issueBriefingToken/)
  assert.doesNotMatch(magic, /createSubscriberSession\(principal\.id, "briefing"\)/)
  assert.match(magic, /principal\.type !== "subscriber"/)
  assert.match(magic, /createSubscriberSession\(subscriber\.id, "subscriber"\)/)
})

test("portal session rejects briefing principals", () => {
  assert.equal(
    portalPrincipalFromClaims({ principalId: "briefing-a", principalType: "briefing" }),
    null,
  )
  assert.deepEqual(
    portalPrincipalFromClaims({ principalId: "sub-a", principalType: "subscriber" }),
    { principalId: "sub-a", principalType: "subscriber" },
  )
})

test("briefing deletion is owner-gated and exact-email confirmed", () => {
  const actions = read("src/app/actions/briefings.ts")
  assert.match(actions, /export async function deleteBriefing/)
  assert.match(actions, /admin\.role !== "owner"/)
  assert.match(actions, /email=\$\{confirmationEmail\.trim\(\)\}/)
  assert.match(actions, /delete from briefing_requests where id=\$\{id\}/)
  assert.doesNotMatch(actions, /delete from subscribers/i)

  const control = read("src/app/admin/briefings/briefing-delete-control.tsx")
  assert.match(control, /window\.prompt/)
  assert.match(control, /confirmation !== email/)
  assert.match(control, /window\.confirm/)
  assert.match(control, /Delete briefing request/)
})

test("subscriber portal is preserved and has no briefing path", () => {
  const portal = read("src/app/portal/page.tsx")
  assert.doesNotMatch(portal, /BriefingPortal/)
  assert.doesNotMatch(portal, /principal\.type === "briefing"/)
  assert.match(portal, /requirePortalPrincipal\(\)/)
  assert.match(portal, /getLibraryFor/)
  assert.match(portal, /DataRoomGrid/)
  assert.match(portal, /LegacyDocumentGrid/)
})

test("subscriber DAL only returns subscribers, not briefing clients", () => {
  const dal = read("src/lib/subscriber-dal.ts")
  assert.doesNotMatch(dal, /CurrentBriefingClient/)
  assert.match(dal, /export async function requirePortalPrincipal\(\): Promise<CurrentSubscriber>/)
})

test("Board Intelligence Access display name is applied", () => {
  const entitlements = read("src/lib/entitlements.ts")
  assert.match(entitlements, /Board Intelligence Access/)
  assert.match(entitlements, /tierDisplayName/)

  const access = read("src/app/access/page.tsx")
  assert.match(access, /Board Intelligence Access/)
  assert.doesNotMatch(access, /title: 'Board Briefing'/)
})

test("engagement page shows only subscriber metrics", () => {
  const page = read("src/app/admin/engagement/page.tsx")
  assert.doesNotMatch(page, /Active briefing clients/)
  assert.doesNotMatch(page, /Briefings never signed in/)
  assert.doesNotMatch(page, />Briefing</)
  assert.match(page, /Active subscribers/)
})
