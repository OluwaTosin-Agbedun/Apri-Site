/**
 * Personal Papermark rooms for approved Complimentary Review readers, against
 * the test database and a MOCK Papermark that applies Papermark's own group
 * rules (from its open-source viewer): a group link admits only the group's
 * members, and opens a room document only when the group has a permission row
 * allowing it; an expired link admits nobody.
 *
 * This is not a live Papermark verification. Invented data only.
 */
import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { sql, makeTag, makeSeat, cleanup } from "./helpers.mjs"
import { createSchemaDatabase, applyMigration } from "./support/test-database.mjs"

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
const HEADERS = `
const jar = () => { globalThis.__jar ??= new Map(); return globalThis.__jar }
export async function cookies() { return { get: (n) => jar().has(n) ? { name: n, value: jar().get(n) } : undefined, set: (n, v, o = {}) => { if (o.maxAge === 0) jar().delete(n); else jar().set(n, v) }, delete: (n) => jar().delete(n) } }
export async function headers() { return new Headers() }
`
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "next/headers") return { url: `data:text/javascript,${encodeURIComponent(HEADERS)}`, shortCircuit: true }
    if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context)
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

// ---------------------------------------------------------------------------
// Mock Papermark: datarooms, groups, members, permissions, links.
// ---------------------------------------------------------------------------
const ROOM = "room_review_test"
const store = { docs: [], groups: new Map(), links: new Map(), calls: [] }
const faults = { ignoreHide: false, failPermissionsPut: false, failPatch: false, failDelete: false, reportDownloadable: false, ignoreDownloadEnable: false, ignoreLinkDownloadEnable: false, rateLimitPermissions: false }
let seq = 0
const id = (p) => `${p}_${++seq}`
const papermark = createServer(async (req, res) => {
  let raw = ""
  for await (const c of req) raw += c
  const body = raw ? JSON.parse(raw) : {}
  const url = new URL(req.url, "http://mock")
  const path = url.pathname
  store.calls.push(`${req.method} ${path}`)
  const send = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(value === undefined ? "" : JSON.stringify(value)) }
  const fail = (status) => send(status, { error: { code: "internal_server_error", message: "Mock failure." } })
  let m
  if (req.method === "GET" && path === `/v1/datarooms/${ROOM}/documents`) return send(200, { data: store.docs, next_cursor: null })
  if (req.method === "POST" && path === `/v1/datarooms/${ROOM}/groups`) {
    const g = { id: id("grp"), object: "dataroom_group", name: body.name, allow_all: body.allow_all === true, domains: body.domains ?? [], dataroom_id: ROOM, members: [], perms: new Map() }
    store.groups.set(g.id, g)
    return send(201, { ...g, members: undefined, perms: undefined })
  }
  if ((m = path.match(new RegExp(`^/v1/datarooms/${ROOM}/groups/([^/]+)$`))) && req.method === "GET") {
    const g = store.groups.get(m[1])
    return g ? send(200, { id: g.id, allow_all: g.allow_all, domains: g.domains, dataroom_id: g.dataroom_id }) : send(404, {})
  }
  if ((m = path.match(new RegExp(`^/v1/datarooms/${ROOM}/groups/([^/]+)/members$`)))) {
    const g = store.groups.get(m[1])
    if (!g) return send(404, {})
    if (req.method === "GET") return send(200, { data: g.members, next_cursor: null })
    if (req.method === "POST") {
      for (const email of body.emails) if (!g.members.some((x) => x.email === email)) g.members.push({ id: id("mem"), email })
      return send(200, { data: g.members })
    }
  }
  if ((m = path.match(new RegExp(`^/v1/datarooms/${ROOM}/groups/([^/]+)/members/([^/]+)$`))) && req.method === "DELETE") {
    const g = store.groups.get(m[1])
    g.members = g.members.filter((x) => x.id !== m[2])
    return send(200, {})
  }
  if ((m = path.match(new RegExp(`^/v1/datarooms/${ROOM}/groups/([^/]+)/permissions$`)))) {
    const g = store.groups.get(m[1])
    if (!g) return send(404, {})
    if (req.method === "PUT") {
      if (faults.rateLimitPermissions) return fail(429)
      if (faults.failPermissionsPut) return fail(500)
      // Delta semantics, as Papermark documents: entries sent are upserted.
      for (const p of body.permissions) {
        if (faults.ignoreHide && p.can_view === false && g.perms.get(p.item_id)?.can_view) continue
        g.perms.set(p.item_id, { item_id: p.item_id, item_type: p.item_type, can_view: p.can_view, can_download: faults.ignoreDownloadEnable ? false : p.can_download })
      }
      return send(200, { data: [...g.perms.values()] })
    }
    const rows = [...g.perms.values()].map((r) => (faults.reportDownloadable && !r.can_view ? { ...r, can_download: true } : r))
    return send(200, { data: rows, next_cursor: null })
  }
  if (req.method === "POST" && path === "/v1/links") {
    const l = { ...body, id: id("lnk"), url: `https://docs.example.invalid/view/${seq}` }
    store.links.set(l.id, l)
    return send(201, l)
  }
  if ((m = path.match(/^\/v1\/links\/([^/]+)$/))) {
    const l = store.links.get(m[1])
    if (!l) return send(404, {})
    if (req.method === "GET") return send(200, l)
    if (req.method === "PATCH") {
      if (faults.failPatch) return fail(500)
      if (faults.ignoreLinkDownloadEnable) delete body.allow_download
      Object.assign(l, body)
      return send(200, l)
    }
    if (req.method === "DELETE") {
      if (faults.failDelete) return fail(500)
      store.links.delete(m[1])
      return send(200, {})
    }
  }
  send(404, { error: { code: "not_found", message: `Not mocked: ${req.method} ${path}` } })
})

/** Papermark's viewer rule for a group link, from its source: what this email can open. */
function viewerSees(linkId, email) {
  const l = store.links.get(linkId)
  if (!l || (l.expires_at && new Date(l.expires_at) <= new Date())) return null
  const g = store.groups.get(l.group_id)
  if (!g || l.audience_type !== "group") return null
  const allowed = g.allow_all || g.members.some((x) => x.email === email) || g.domains.some((d) => email.endsWith(d))
  if (!allowed) return null
  return store.docs.filter((d) => g.perms.get(d.id)?.can_view).map((d) => d.document_id).sort()
}

/** The viewer also requires the link AND exact document download permission. */
function viewerDownloads(linkId, email) {
  const visible = viewerSees(linkId, email)
  const link = store.links.get(linkId)
  if (!visible || link.allow_download !== true || !link.allow_list.includes(email)) return null
  const group = store.groups.get(link.group_id)
  return store.docs.filter((d) => visible.includes(d.document_id) && group.perms.get(d.id)?.can_download).map((d) => d.document_id).sort()
}

await new Promise((ok) => papermark.listen(0, "127.0.0.1", ok))
process.env.PAPERMARK_API_BASE = `http://127.0.0.1:${papermark.address().port}`
process.env.PAPERMARK_API_TOKEN = "mock-token-not-real"
process.env.PAPERMARK_ROOM_CALLS_PER_MINUTE = "100000"
process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL
process.env.SESSION_SECRET = randomBytes(32).toString("hex")

const rooms = await import("../src/lib/review-reader-rooms.ts")
const policy = await import("../src/lib/reader-room-policy.ts")
const reader = await import("../src/lib/review-reader.ts")
const subscriberToken = await import("../src/lib/subscriber-session-token.ts")
const reviewLinks = await import("../src/lib/papermark-datarooms.ts")
const contract = await import("../src/lib/papermark-dataroom-contract.ts")

const tag = makeTag("rooms")
const A = `${tag}_ada@example.invalid`
const B = `${tag}_bola@example.invalid`
const ed = {}
const DOC = (k) => `${tag}_doc_${k}`

async function edition(key, state = "published") {
  const [row] = await sql`
    insert into review_publication_editions (series, title, edition_label, papermark_document_id, papermark_dataroom_id, secure_link_id, secure_link_url,
        secure_link_document_id, secure_link_verified_at, publication_type, description, frequency, audience, publication_state,
        is_latest, recipient_mode, complimentary_featured, edition_sort_key, withdrawal_state, withdrawal_link_id)
    values ('MIN', ${`${tag} ${key}`}, ${key}, ${DOC(key)}, ${ROOM}, ${state === "published" ? `${tag}_l_${key}` : null},
        ${state === "published" ? `https://docs.example.invalid/view/${tag}_${key}` : ""}, ${DOC(key)}, ${state === "published" ? new Date() : null},
        'Monthly Intelligence Note', 'Invented.', 'Monthly', 'Readers', ${state}, false, 'edition', false, ${key},
        ${state === "withdrawn" ? "revoking" : null}, ${state === "withdrawn" ? `${tag}_old_${key}` : null})
    returning id`
  ed[key] = row.id
  store.docs.push({ id: `dd_${key}`, object: "dataroom_document", document_id: DOC(key), document_name: key })
}
const grant = (key, email) => sql`insert into review_edition_recipients (edition_id, email, source) values (${ed[key]}::uuid, ${email}, 'owner')`
/** An APRI reader session (the reader typed APRI's one-time code); their code-free link is open only while one exists. */
const signIn = async (email, hoursAgo = 0) =>
  (await sql`insert into review_reader_sessions (email, method, created_at) values (${email}, 'code', now() - (${hoursAgo} || ' hours')::interval) returning id`)[0].id
const room = async (email) => (await sql`select * from review_reader_rooms where email = ${email}`)[0]

before(async () => {
  await sql`insert into app_settings (key, value) values ('review_library_enabled', 'true') on conflict (key) do update set value = 'true'`
  rooms.resetReaderRoomsSchemaCache()
  for (const k of ["one", "two", "three"]) await edition(k)
  await edition("withdrawnA", "withdrawn")
  await edition("withdrawnB", "withdrawn")
  // An unassigned document sitting in the room.
  store.docs.push({ id: "dd_stray", object: "dataroom_document", document_id: `${tag}_stray`, document_name: "stray" })
  for (const k of ["one", "two", "withdrawnA"]) await grant(k, A)
  await grant("three", B)
  await signIn(A)
  await signIn(B)
})
after(async () => {
  papermark.close()
  await sql`delete from review_reader_sessions where email like ${`${tag}%`}`
  await sql`delete from review_reader_room_events where email like ${`${tag}%`}`
  await sql`delete from review_reader_rooms where email like ${`${tag}%`}`
  await sql`delete from review_edition_recipients where email like ${`${tag}%`}`
  await sql`delete from review_publication_editions where title like ${`${tag}%`}`
  await cleanup(tag)
})
beforeEach(() => { for (const key of Object.keys(faults)) faults[key] = false })

describe("the rooms migration", () => {
  it("is additive and re-runs cleanly", async () => {
    const FILE = "20261009_review_reader_rooms.sql"
    const db = await createSchemaDatabase({ skipMigrations: [FILE] })
    await applyMigration(db, FILE)
    await applyMigration(db, FILE)
    const { rows } = await db.query(`select to_regclass('public.review_reader_rooms') is not null and to_regclass('public.review_reader_room_events') is not null as ok`)
    assert.equal(rows[0].ok, true)
    await db.close()
  })
})

describe("edition-link download upgrades", () => {
  const fixture = (overrides = {}) => {
    const linkId = id("edition_link")
    const link = { ...contract.reviewLinkSettings({ documentId: "test_pdf", slotKey: "MIN", allowList: [A] }), id: linkId, url: `https://docs.example.invalid/view/${linkId}`, allow_download: false, ...overrides }
    store.links.set(linkId, link)
    return link
  }
  const enable = (link, extra = {}) => reviewLinks.enableReviewDocumentDownloads({ linkId: link.id, documentId: "test_pdf", allowList: [A], ...extra })

  it("enables downloads in place while preserving the exact document, recipients, watermark and URL", async () => {
    const link = fixture()
    const before = structuredClone(link)
    const result = await enable(link)
    assert.equal(result.ok, true)
    assert.equal(result.value.url, before.url)
    assert.deepEqual(link, { ...before, allow_download: true })
  })
  it("does not trust a successful PATCH unless the GET confirms downloads", async () => {
    const link = fixture()
    faults.ignoreLinkDownloadEnable = true
    const result = await enable(link)
    assert.equal(result.ok, false)
    assert.match(result.message, /not enabled/)
    assert.equal(link.allow_download, false)
  })
  it("refuses wrong-document, wrong-recipient, missing-protection and expired links before changing anything", async () => {
    for (const changed of [
      { document_id: "different_pdf" }, { dataroom_id: ROOM }, { allow_list: [B] },
      { email_authenticated: false }, { email_protected: false }, { enable_watermark: false },
      { enable_screenshot_protection: false }, { expires_at: policy.closedAt() },
    ]) {
      const link = fixture(changed)
      const calls = store.calls.length
      const result = await enable(link)
      assert.equal(result.ok, false, JSON.stringify(changed))
      assert.equal(link.allow_download, false)
      assert.ok(!store.calls.slice(calls).some((c) => c.startsWith("PATCH")), "no mutation on refusal")
    }
  })
  it("an empty approved list makes no Papermark request", async () => {
    const link = fixture()
    const calls = store.calls.length
    assert.equal((await enable(link, { allowList: [] })).ok, false)
    assert.equal(store.calls.length, calls)
  })
  it("repeating an enabled upgrade reads back but never recreates or patches the link", async () => {
    const link = fixture({ allow_download: true })
    const calls = store.calls.length
    assert.equal((await enable(link)).ok, true)
    assert.ok(store.calls.slice(calls).every((c) => c.startsWith("GET")))
  })
  it("legacy view-only verification keeps removal and withdrawal working during rollout", async () => {
    const link = fixture()
    const args = { linkId: link.id, expectedDocumentId: "test_pdf", expectedAllowList: [A] }
    assert.equal((await reviewLinks.verifyReviewDocumentLink(args)).ok, true)
    assert.equal((await reviewLinks.verifyReviewDocumentLink({ ...args, requireDownloads: true })).ok, false)
    assert.equal((await enable(link)).ok, true)
    assert.equal((await reviewLinks.verifyReviewDocumentLink({ ...args, requireDownloads: true })).ok, true)
  })
})

describe("the room rules", () => {
  it("download permission alone is not proof that an assigned edition is viewable", () => {
    const result = policy.comparePermissions([{ item_id: "a", item_type: "dataroom_document", can_view: false, can_download: true }], ["a"])
    assert.equal(result.exact, false)
    assert.deepEqual(result.missing, ["a"])
  })
  it("a missing download permission is not accepted as a complete policy", () => {
    const result = policy.comparePermissions([{ item_id: "a", item_type: "dataroom_document", can_view: true, can_download: false }], ["a"])
    assert.equal(result.exact, false)
    assert.deepEqual(result.missingDownloads, ["a"])
  })
  it("an unassigned download or a broad folder grant is caught even with no view permission", () => {
    const result = policy.comparePermissions([
      { item_id: "a", item_type: "dataroom_document", can_view: true, can_download: true },
      { item_id: "secret", item_type: "dataroom_document", can_view: false, can_download: true },
      { item_id: "folder", item_type: "dataroom_folder", can_view: true, can_download: true },
    ], ["a"])
    assert.equal(result.exact, false)
    assert.deepEqual(result.unexpectedDownloads, ["secret"])
    assert.deepEqual(result.overExposed, ["dataroom_folder:folder", "secret"])
  })
  it("every room document gets a row, view and download only where assigned", () => {
    assert.deepEqual(policy.permissionPlan(["c", "a", "b"], ["b"]), [
      { item_id: "a", item_type: "dataroom_document", can_view: false, can_download: false },
      { item_id: "b", item_type: "dataroom_document", can_view: true, can_download: true },
      { item_id: "c", item_type: "dataroom_document", can_view: false, can_download: false },
    ])
  })
  it("a removal Papermark did not apply is caught as over-exposure", () => {
    const r = policy.comparePermissions([{ item_id: "a", item_type: "dataroom_document", can_view: true, can_download: false }], [])
    assert.deepEqual(r.overExposed, ["a"])
    assert.equal(r.exact, false)
  })
  it("a room link must be the reader's group only, email-verified, watermarked, protected and download-enabled", () => {
    const expected = { roomId: "r", groupId: "g", email: "x@example.invalid" }
    const good = { ...policy.roomLinkSettings({ roomId: "r", groupId: "g", email: "x@example.invalid" }), url: "https://docs.example.invalid/view/1" }
    assert.equal(policy.roomLinkProblem(good, expected), null)
    assert.match(policy.roomLinkProblem({ ...good, allow_download: false }, expected), /Downloads/)
    assert.match(policy.roomLinkProblem({ ...good, allow_download: undefined }, expected), /Downloads/)
    assert.equal(policy.roomLinkProblem({ ...good, allow_download: false }, expected, new Date(), { allowViewOnly: true }), null, "only the pre-upgrade check accepts a known view-only link")
    assert.match(policy.roomLinkProblem({ ...good, audience_type: "general" }, expected), /group/)
    assert.match(policy.roomLinkProblem({ ...good, email_authenticated: false }, expected), /Verified-email/)
    assert.match(policy.roomLinkProblem({ ...good, allow_list: ["x@example.invalid", "y@example.invalid"] }, expected), /allow list/)
    assert.match(policy.roomLinkProblem({ ...good, enable_screenshot_protection: false }, expected), /Screenshot/)
    assert.match(policy.roomLinkProblem({ ...good, expires_at: policy.closedAt() }, expected), /closed/)
  })
  it("a code-free link (APRI checked the email) must still be email-protected, and must always close", () => {
    const until = new Date(Date.now() + 3_600_000).toISOString()
    const expected = { roomId: "r", groupId: "g", email: "x@example.invalid", codeFree: true }
    const good = { ...policy.roomLinkSettings({ roomId: "r", groupId: "g", email: "x@example.invalid", openUntil: until }), url: "https://docs.example.invalid/view/1" }
    assert.equal(good.email_authenticated, false)
    assert.equal(good.email_protected, true)
    assert.equal(good.expires_at, until)
    assert.equal(policy.roomLinkProblem(good, expected), null)
    assert.match(policy.roomLinkProblem({ ...good, expires_at: null }, expected), /no closing time/, "never open-ended")
    assert.match(policy.roomLinkProblem({ ...good, email_protected: false }, expected), /Email protection/)
    assert.match(policy.roomLinkProblem({ ...good, email_authenticated: true }, expected), /its own code/)
    assert.match(policy.roomLinkProblem({ ...good, allow_download: false }, expected), /Downloads/)
    assert.match(policy.roomLinkProblem({ ...good, enable_watermark: false }, expected), /watermark/)
    assert.match(policy.roomLinkProblem({ ...good, allow_list: ["y@example.invalid"] }, expected), /allow list/)
    assert.equal(policy.closesAt({ expires_at: until }, until), true)
    assert.equal(policy.closesAt({ expires_at: null }, until), false)
  })
  it("Read goes to that one PDF on Papermark's per-document room route, and nothing else is accepted", () => {
    assert.equal(policy.roomDocumentUrl("https://docs.example.invalid/view/lnk_1", "dd_one"), "https://docs.example.invalid/view/lnk_1/d/dd_one")
    assert.equal(policy.roomDocumentUrl("https://read.example.invalid/apri-ada/", "cm123abc"), "https://read.example.invalid/apri-ada/d/cm123abc")
    assert.equal(policy.roomDocumentUrl("http://docs.example.invalid/view/lnk_1", "dd_one"), null, "https only")
    assert.equal(policy.roomDocumentUrl("https://docs.example.invalid/view/lnk_1?email=x", "dd_one"), null, "no query")
    assert.equal(policy.roomDocumentUrl("https://docs.example.invalid/view/lnk_1", "../../x"), null)
  })
})

describe("two readers, different editions, one room each", () => {
  it("each sees exactly their assigned published editions; withdrawn, unassigned and the other reader's stay hidden", async () => {
    const results = await rooms.prepareReaderRooms([A, B])
    assert.deepEqual(results.map((r) => r.state), ["ready", "ready"])
    const a = await room(A)
    const b = await room(B)
    assert.deepEqual(viewerSees(a.papermark_link_id, A), [DOC("one"), DOC("two")].sort())
    assert.deepEqual(viewerSees(b.papermark_link_id, B), [DOC("three")])
    assert.equal(viewerSees(a.papermark_link_id, B), null, "B is not admitted through A's link")
    assert.equal(viewerSees(b.papermark_link_id, A), null)
    const groupA = store.groups.get(a.papermark_group_id)
    assert.deepEqual(groupA.members.map((m) => m.email), [A])
    assert.equal(groupA.allow_all, false)
    assert.equal(groupA.perms.get("dd_withdrawnA").can_view, false, "a withdrawn edition assigned to A is still hidden")
    assert.equal(groupA.perms.get("dd_stray").can_view, false)
    assert.deepEqual(viewerDownloads(a.papermark_link_id, A), [DOC("one"), DOC("two")].sort())
    assert.deepEqual(viewerDownloads(b.papermark_link_id, B), [DOC("three")])
    assert.equal(viewerDownloads(a.papermark_link_id, B), null)
    assert.equal(viewerDownloads(b.papermark_link_id, A), null)
    assert.equal(groupA.perms.get("dd_withdrawnA").can_download, false)
    assert.equal(groupA.perms.get("dd_stray").can_download, false)
  })

  it("the link is created only after the permissions are read back, with every protection on", async () => {
    const a = await room(A)
    const calls = store.calls
    const firstLink = calls.indexOf("POST /v1/links")
    const permsRead = calls.findIndex((c) => c.startsWith("GET") && c.endsWith(`${a.papermark_group_id}/permissions`))
    assert.ok(permsRead !== -1 && permsRead < firstLink)
    const link = store.links.get(a.papermark_link_id)
    assert.equal(link.audience_type, "group")
    assert.equal(link.email_protected, true)
    assert.equal(link.email_authenticated, false, "APRI checked the email with its code: Papermark asks for no second code")
    assert.ok(link.expires_at && new Date(link.expires_at) > new Date(), "open while the reader is signed in")
    assert.ok(new Date(link.expires_at) <= new Date(Date.now() + 24 * 3_600_000 + 60_000), "and closes when their 24-hour session ends")
    assert.equal(link.allow_download, true)
    assert.equal(link.enable_screenshot_protection, true)
    assert.equal(link.enable_watermark, true)
    assert.match(link.watermark_config.text, /\{\{email\}\}/)
    assert.equal(link.dataroom_id, ROOM)
    assert.equal(link.document_id, undefined)
  })

  it("a new group whose permissions cannot be written gets no link at all", async () => {
    const C = `${tag}_cleo@example.invalid`
    await grant("one", C)
    faults.failPermissionsPut = true
    const [r] = await rooms.prepareReaderRooms([C])
    assert.notEqual(r.state, "ready")
    const c = await room(C)
    assert.equal(c.papermark_link_id, null)
    const g = store.groups.get(c.papermark_group_id)
    assert.equal(g.perms.size, 0, "the new group exposes nothing")
  })

  it("a recipient removal hides that edition from the reader's room", async () => {
    await sql`update review_edition_recipients set revoked_at = now() where edition_id = ${ed.two}::uuid and email = ${A}`
    await rooms.reconcileReadersForEdition(ed.two)
    const a = await room(A)
    assert.equal(a.state, "ready")
    assert.deepEqual(viewerSees(a.papermark_link_id, A), [DOC("one")])
  })

  it("a newly added room PDF stays hidden until it is published and assigned, then appears", async () => {
    store.docs.push({ id: "dd_four", object: "dataroom_document", document_id: DOC("four"), document_name: "four" })
    const a = await room(A)
    assert.deepEqual(viewerSees(a.papermark_link_id, A), [DOC("one")], "no permission row: Papermark refuses it")
    await edition("four")
    store.docs.pop() // edition() pushed it again; keep one entry
    await grant("four", A)
    await rooms.reconcileReadersForEdition(ed.four)
    assert.deepEqual(viewerSees((await room(A)).papermark_link_id, A), [DOC("one"), DOC("four")].sort())
  })

  it("withdrawing the reader's last edition closes their link", async () => {
    await sql`update review_publication_editions set publication_state = 'withdrawn', withdrawal_state = 'revoking', withdrawal_link_id = secure_link_id where id = any(${[ed.one, ed.four]}::uuid[])`
    await rooms.reconcileReadersForEdition(ed.one)
    const a = await room(A)
    assert.equal(a.state, "closed")
    assert.equal(viewerSees(a.papermark_link_id, A), null)
    await sql`update review_publication_editions set publication_state = 'published', withdrawal_state = null where id = any(${[ed.one, ed.four]}::uuid[])`
    await rooms.reconcileReadersForEdition(ed.one)
    const reopened = await room(A)
    assert.equal(reopened.state, "ready")
    assert.equal(reopened.papermark_link_id, a.papermark_link_id, "the same link, reopened")
    assert.deepEqual(viewerSees(reopened.papermark_link_id, A), [DOC("one"), DOC("four")].sort())
  })
})

describe("never reporting a removal Papermark did not confirm", () => {
  it("if Papermark keeps showing a removed edition, the reader's link is closed", async () => {
    await sql`update review_edition_recipients set revoked_at = now() where edition_id = ${ed.four}::uuid and email = ${A}`
    faults.ignoreHide = true
    const [r] = await rooms.reconcileReaders([A])
    assert.equal(r.state, "closed")
    assert.doesNotMatch(r.message, /revoked/i)
    assert.equal(viewerSees((await room(A)).papermark_link_id, A), null)
    faults.ignoreHide = false
    const [fixed] = await rooms.reconcileReaders([A])
    assert.equal(fixed.state, "ready")
    assert.deepEqual(viewerSees((await room(A)).papermark_link_id, A), [DOC("one")])
  })

  it("if Papermark reports an unassigned document as downloadable, the link is closed", async () => {
    faults.reportDownloadable = true
    const [r] = await rooms.reconcileReaders([B])
    assert.equal(r.state, "closed")
    faults.reportDownloadable = false
    assert.equal((await rooms.reconcileReaders([B]))[0].state, "ready")
  })

  it("if the link cannot be closed at all, Admin is told to remove it by hand", async () => {
    faults.ignoreHide = true
    faults.failPatch = true
    faults.failDelete = true
    await sql`update review_edition_recipients set revoked_at = now() where edition_id = ${ed.three}::uuid and email = ${B}`
    await grant("one", B)
    const [r] = await rooms.reconcileReaders([B])
    assert.equal(r.state, "failed")
    assert.match(r.message, /could NOT be closed/)
  })

  it("only a confirmed-ready room hands out its link", async () => {
    assert.equal(await rooms.readyRoomLink(B), null)
    assert.ok((await rooms.readyRoomLink(A))?.url.startsWith("https://"))
  })
})

describe("the reading entry path", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  it("the routing cookie is gone: no module can set or read it any more", () => {
    assert.equal(existsSync(new URL("../src/lib/review-room-entry.ts", import.meta.url)), false)
    assert.match(read("src/lib/review-reader.ts"), /store\.set\("apri_review_room", "", \{ \.\.\.readerCookieOptions\(\), maxAge: 0 \}\)/, "sign-out still clears an old one")
  })
  it("every way in needs an APRI session: the routing cookie can no longer reach a room", () => {
    const route = read("src/app/review/read/route.ts")
    assert.doesNotMatch(route, /readRoomHint|roomEntryFor|link_url|redirect\(entry/, "/review/read hands out nothing")
    assert.match(route, /new URL\("\/review\/library", request\.url\)/)
    for (const file of ["src/app/actions/review-reader.ts", "src/app/review/library/open/[id]/route.ts", "src/app/review/library/page.tsx"]) {
      assert.doesNotMatch(read(file), /setRoomHint|readRoomHint/, file)
    }
    const open = read("src/app/review/library/open/[id]/route.ts")
    const order = ["await currentReviewReader()", "getReviewEditionForEmail(reader.email", "readerDocumentFor(reader.email", "NextResponse.redirect(target.url"]
    for (let i = 1; i < order.length; i++) assert.ok(open.indexOf(order[i - 1]) < open.indexOf(order[i]), `${order[i - 1]} before ${order[i]}`)
    assert.doesNotMatch(read("src/app/review/library/page.tsx"), /link_url|secureUrl|papermark\.com/, "no Papermark address on the library page")
    assert.ok(!read("src/lib/review-email.ts").includes("sendReviewReadingLink"))
  })
  it('"rooms" is no longer a separate public route, and the room tools are owner-only', () => {
    const lib = read("src/lib/review-reader.ts")
    assert.match(lib, /\(row\?\.value === "library" \|\| row\?\.value === "rooms"\) && \(await reviewReaderSchemaReady\(\)\) \? "library" : "papermark"/)
    assert.doesNotMatch(lib, /reviewRoomsProof/, "no manual two-reader switch")
    const actions = read("src/app/actions/review-reader-rooms.ts")
    for (const fn of ["prepareRoomsFor", "checkAllRooms", "prepareAllApprovedRooms"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`))
      assert.ok(body.indexOf("await requireOwner()") < body.indexOf("getSql()") || body.indexOf("getSql()") === -1, fn)
    }
    assert.doesNotMatch(actions, /recordRoomsProof|withdrawRoomsProof/)
    assert.doesNotMatch(read("src/app/admin/review-library/reader-rooms-panel.tsx"), /linkUrl|Open room/, "Admin never shows a code-free link")
  })
  it("every Admin change that alters a reader's editions reconciles their room", () => {
    const access = read("src/app/actions/review-edition-access.ts")
    assert.equal((access.match(/scheduleRoomReconcile\(/g) ?? []).length, 4)
    assert.equal((read("src/app/actions/review-library.ts").match(/scheduleRoomReconcile\(/g) ?? []).length, 3)
    assert.equal((read("src/app/actions/review-withdrawal.ts").match(/scheduleRoomReconcile\(/g) ?? []).length, 2)
  })
})

describe("opening access re-checks approval and the room's editions every time", () => {
  const E = `${tag}_esi@example.invalid`
  const NOBODY = `${tag}_nobody@example.invalid`
  before(async () => {
    await edition("x1")
    await edition("x2")
    await grant("x1", E)
    await signIn(E)
  })

  it("an unapproved address gets no room and no link", async () => {
    assert.deepEqual(await rooms.roomEntryFor(NOBODY, { allowCreate: true }), { kind: "not_approved" })
    assert.equal(await room(NOBODY), undefined, "nothing is created for it")
  })

  it("an approved reader is sent only to a room showing exactly their current editions", async () => {
    const first = await rooms.roomEntryFor(E, { allowCreate: true })
    assert.equal(first.kind, "ready")
    assert.deepEqual(viewerSees((await room(E)).papermark_link_id, E), [DOC("x1")])
    await grant("x2", E)
    const second = await rooms.roomEntryFor(E, { allowCreate: true })
    assert.equal(second.kind, "ready")
    assert.deepEqual(viewerSees((await room(E)).papermark_link_id, E), [DOC("x1"), DOC("x2")].sort())
    await sql`update review_edition_recipients set revoked_at = now() where edition_id = ${ed.x1}::uuid and email = ${E} and revoked_at is null`
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "ready")
    assert.deepEqual(viewerSees((await room(E)).papermark_link_id, E), [DOC("x2")], "a removal takes effect before the next open")
  })

  const makeViewOnly = async () => {
    const r = await room(E)
    const link = store.links.get(r.papermark_link_id)
    link.allow_download = false
    for (const permission of store.groups.get(r.papermark_group_id).perms.values()) permission.can_download = false
    await sql`update review_reader_rooms set verified_editions = ${rooms.editionSetKey([ed.x2])}, state = 'ready' where email = ${E}`
    return { id: link.id, url: link.url, until: link.expires_at }
  }

  it("existing view-only rooms upgrade once in place without changing identity, expiry or the reader's code", async () => {
    const before = await makeViewOnly()
    const calls = store.calls.length
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "ready")
    const r = await room(E)
    const link = store.links.get(r.papermark_link_id)
    assert.equal(link.id, before.id)
    assert.equal(link.url, before.url)
    assert.equal(link.expires_at, before.until)
    assert.equal(link.email_authenticated, false)
    assert.deepEqual(link.allow_list, [E])
    assert.equal(link.enable_watermark, true)
    assert.equal(link.enable_screenshot_protection, true)
    assert.equal(link.allow_download, true)
    assert.deepEqual(viewerDownloads(link.id, E), [DOC("x2")])
    assert.equal(r.verified_editions, rooms.roomPolicyKey([ed.x2]))
    assert.ok(store.calls.length > calls)
    assert.ok(!store.calls.slice(calls).includes("POST /v1/links"), "no duplicate link")
    const readyCalls = store.calls.length
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "ready")
    assert.equal(store.calls.length, readyCalls, "return visits do not repeat the upgrade")
  })

  it("unconfirmed document download permissions never receive the new policy proof", async () => {
    await makeViewOnly()
    faults.ignoreDownloadEnable = true
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "unavailable")
    const r = await room(E)
    assert.notEqual(r.state, "ready")
    assert.notEqual(r.verified_editions, rooms.roomPolicyKey([ed.x2]))
    faults.ignoreDownloadEnable = false
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "ready")
  })

  it("a rate-limited upgrade retains the existing link and never claims downloads are ready", async () => {
    const old = await makeViewOnly()
    faults.rateLimitPermissions = true
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "unavailable")
    const r = await room(E)
    assert.notEqual(r.state, "ready")
    assert.equal(r.papermark_link_id, old.id)
    assert.equal(store.links.get(old.id).url, old.url)
    assert.equal(store.links.get(old.id).allow_download, false)
    assert.notEqual(r.verified_editions, rooms.roomPolicyKey([ed.x2]))
    faults.rateLimitPermissions = false
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "ready")
  })

  it("a link upgrade Papermark does not apply is not accepted as ready", async () => {
    await makeViewOnly()
    faults.ignoreLinkDownloadEnable = true
    const result = await rooms.reconcileReaderRoom(E)
    assert.equal(result.state, "closed")
    assert.match(result.message, /Downloads are not enabled/)
    assert.equal(viewerDownloads((await room(E)).papermark_link_id, E), null)
    faults.ignoreLinkDownloadEnable = false
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "ready")
  })

  it("a reader removed from every edition is not sent to their old room", async () => {
    await sql`update review_edition_recipients set revoked_at = now() where email = ${E} and revoked_at is null`
    assert.deepEqual(await rooms.roomEntryFor(E, { allowCreate: true }), { kind: "not_approved" })
  })

  it("only one reconcile per reader runs at a time", async () => {
    await grant("x1", E)
    await sql`update review_reader_rooms set lease_until = now() + interval '1 minute' where email = ${E}`
    const r = await rooms.reconcileReaderRoom(E)
    assert.equal(r.state, "updating")
    assert.deepEqual(await rooms.roomEntryFor(E, { allowCreate: true }), { kind: "preparing" })
    await sql`update review_reader_rooms set lease_until = null where email = ${E}`
  })

  it("a failed Papermark update shows a repair state, never Ready, and the reader is not sent there", async () => {
    await grant("x2", E)
    faults.failPermissionsPut = true
    const r = await rooms.reconcileReaderRoom(E)
    assert.notEqual(r.state, "ready")
    const status = (await rooms.listReaderRooms()).find((x) => x.email === E)
    assert.notEqual(status.state, "ready")
    faults.failPermissionsPut = false
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "ready", "Repair brings it back")
  })

  it("without the verification columns no room is handed out, not even one marked ready", async () => {
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "ready")
    await sql`alter table review_reader_rooms rename column verified_editions to verified_editions_hidden`
    rooms.resetReaderRoomsSchemaCache()
    try {
      assert.equal((await room(E)).state, "ready", "the row still says ready")
      assert.deepEqual(await rooms.roomEntryFor(E, { allowCreate: true }), { kind: "unavailable", reason: "rooms_not_installed" })
    } finally {
      await sql`alter table review_reader_rooms rename column verified_editions_hidden to verified_editions`
      rooms.resetReaderRoomsSchemaCache()
    }
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "ready")
  })

  it("a change to an edition still judged by the shared list reconciles every room", async () => {
    await edition("legacy")
    await sql`update review_publication_editions set recipient_mode = 'shared_legacy' where id = ${ed.legacy}::uuid`
    const all = (await sql`select count(*)::int as n from review_reader_rooms`)[0].n
    const results = await rooms.reconcileReadersForEdition(ed.legacy)
    assert.equal(results.length, all)
    await sql`update review_publication_editions set recipient_mode = 'edition', publication_state = 'draft' where id = ${ed.legacy}::uuid`
  })
})

describe("the APRI-verified library: one APRI code, then every assigned PDF opens directly", () => {
  const R = `${tag}_rhoda@example.invalid`
  const S = `${tag}_sade@example.invalid`
  const linkOf = async (email) => store.links.get((await room(email)).papermark_link_id)
  const isOpen = (l) => Boolean(l?.expires_at) && new Date(l.expires_at) > new Date()
  let rSession
  before(async () => {
    for (const k of ["r1", "r2", "r3", "r4"]) await edition(k)
    await grant("r1", R)
    await grant("r2", R)
    await grant("r3", S)
    rSession = await signIn(R)
    await signIn(S)
  })

  it("Read opens that one PDF inside the reader's own link, open only until their APRI session ends", async () => {
    const until = await reader.readerAccessUntil(R)
    assert.ok(until, "the reader holds a session")
    const d1 = await rooms.readerDocumentFor(R, ed.r1, until)
    assert.equal(d1.kind, "open")
    const r = await room(R)
    assert.equal(d1.url, `${r.link_url}/d/dd_r1`, "Papermark's per-document route inside the reader's room link")
    const link = await linkOf(R)
    assert.equal(link.email_authenticated, false, "no second (Papermark) code")
    assert.equal(link.email_protected, true)
    assert.deepEqual(link.allow_list, [R])
    assert.equal(link.allow_download, true)
    assert.equal(link.enable_watermark, true)
    assert.equal(link.enable_screenshot_protection, true)
    assert.ok(policy.closesAt(link, until), "closes exactly when the APRI session ends")
    assert.deepEqual(viewerSees(link.id, R), [DOC("r1"), DOC("r2")].sort())
  })

  it("a second PDF, and a return visit, need no new code, no new link and no Papermark call", async () => {
    const until = await reader.readerAccessUntil(R)
    const before = store.calls.length
    const d2 = await rooms.readerDocumentFor(R, ed.r2, until)
    const again = await rooms.readerDocumentFor(R, ed.r1, until)
    assert.equal(d2.kind, "open")
    assert.match(d2.url, /\/d\/dd_r2$/)
    assert.equal(again.kind, "open")
    assert.equal(store.calls.length, before, "nothing recreated, nothing re-sent")
    // Papermark's own rule (its source): the first open of a room link asks
    // for the email (no code on this link), and its room session then opens
    // every permitted document of that link until it ends.
    const link = await linkOf(R)
    let emailPrompts = 0
    const sessions = new Set()
    const open = (email, doc) => {
      if (!sessions.has(link.id + email)) {
        if (viewerSees(link.id, email) === null) return "refused"
        emailPrompts++
        sessions.add(link.id + email)
      }
      return viewerSees(link.id, email).includes(doc) ? "opened" : "refused"
    }
    assert.equal(open(R, DOC("r1")), "opened")
    assert.equal(open(R, DOC("r2")), "opened")
    assert.equal(emailPrompts, 1)
    assert.equal(open(R, DOC("r3")), "refused", "another reader's edition")
  })

  it("two readers stay isolated: neither link admits the other, and neither can open the other's edition", async () => {
    const sUntil = await reader.readerAccessUntil(S)
    assert.equal((await rooms.readerDocumentFor(S, ed.r3, sUntil)).kind, "open")
    const rLink = await linkOf(R)
    const sLink = await linkOf(S)
    assert.notEqual(rLink.id, sLink.id)
    assert.equal(viewerSees(rLink.id, S), null)
    assert.equal(viewerSees(sLink.id, R), null)
    assert.deepEqual(viewerSees(sLink.id, S), [DOC("r3")])
    assert.deepEqual(await rooms.readerDocumentFor(R, ed.r3, await reader.readerAccessUntil(R)), { kind: "not_assigned" })
    assert.deepEqual(await rooms.readerDocumentFor(R, ed.withdrawnA, await reader.readerAccessUntil(R)), { kind: "not_assigned" }, "a withdrawn edition")
    assert.equal(store.groups.get((await room(R)).papermark_group_id).perms.get("dd_stray").can_view, false, "an unassigned PDF in the room")
  })

  it("a newly assigned edition appears at once; a removed one is refused at once and hidden in Papermark", async () => {
    const until = await reader.readerAccessUntil(R)
    await grant("r4", R)
    const d4 = await rooms.readerDocumentFor(R, ed.r4, until)
    assert.equal(d4.kind, "open")
    assert.deepEqual(viewerSees((await linkOf(R)).id, R), [DOC("r1"), DOC("r2"), DOC("r4")].sort())
    await sql`update review_edition_recipients set revoked_at = now() where edition_id = ${ed.r2}::uuid and email = ${R} and revoked_at is null`
    assert.deepEqual(await rooms.readerDocumentFor(R, ed.r2, until), { kind: "not_assigned" })
    assert.equal((await rooms.readerDocumentFor(R, ed.r1, until)).kind, "open")
    assert.deepEqual(viewerSees((await linkOf(R)).id, R), [DOC("r1"), DOC("r4")].sort(), "hidden in Papermark before the next open")
    assert.deepEqual(viewerDownloads((await linkOf(R)).id, R), [DOC("r1"), DOC("r4")].sort(), "removed edition also cannot be downloaded")
  })

  it("signing out closes the reader's link; a new sign-in reopens it; another browser's session keeps it open", async () => {
    await sql`update review_reader_sessions set revoked_at = now(), revoke_reason = 'signed_out' where id = ${rSession}::uuid`
    assert.equal(await reader.readerAccessUntil(R), null)
    await rooms.narrowRoomWindow(R)
    assert.equal(isOpen(await linkOf(R)), false, "closed in Papermark")
    assert.equal(viewerSees((await linkOf(R)).id, R), null)
    assert.equal(viewerDownloads((await linkOf(R)).id, R), null, "expired/sign-out sessions cannot download")
    assert.equal((await room(R)).state, "ready", "closed for lack of a session, not broken")
    assert.equal((await room(R)).link_open_until, null)

    const older = await signIn(R, 2)
    const newer = await signIn(R)
    const until = await reader.readerAccessUntil(R)
    assert.equal((await rooms.readerDocumentFor(R, ed.r1, until)).kind, "open")
    assert.ok(isOpen(await linkOf(R)), "reopened for the new session")
    await sql`update review_reader_sessions set revoked_at = now(), revoke_reason = 'signed_out' where id = ${older}::uuid`
    await rooms.narrowRoomWindow(R)
    assert.ok(policy.closesAt(await linkOf(R), until), "the newer session keeps it open, to its own end")
    rSession = newer
  })

  it("a session older than 24 hours no longer counts", async () => {
    const T = `${tag}_tunde@example.invalid`
    await signIn(T, 25)
    assert.equal(await reader.readerAccessUntil(T), null)
  })

  it("overlapping requests: while another update runs, the reader is told it is being prepared and nothing changes", async () => {
    const until = await reader.readerAccessUntil(R)
    await sql`update review_reader_rooms set link_open_until = now() - interval '1 minute', lease_until = now() + interval '1 minute' where email = ${R}`
    const before = JSON.stringify(await linkOf(R))
    assert.deepEqual(await rooms.readerDocumentFor(R, ed.r1, until), { kind: "preparing" })
    assert.equal(JSON.stringify(await linkOf(R)), before)
    await sql`update review_reader_rooms set lease_until = null where email = ${R}`
    assert.equal((await rooms.readerDocumentFor(R, ed.r1, until)).kind, "open", "the next Read finishes it")
  })

  it("if Papermark fails while opening, the reader gets a repair notice and the link is not opened", async () => {
    const until = await reader.readerAccessUntil(R)
    const link = await linkOf(R)
    link.expires_at = policy.closedAt()
    await sql`update review_reader_rooms set link_open_until = null where email = ${R}`
    faults.failPatch = true
    assert.deepEqual(await rooms.readerDocumentFor(R, ed.r1, until), { kind: "unavailable", reason: "needs_repair" })
    assert.equal(isOpen(await linkOf(R)), false)
    faults.failPatch = false
    assert.equal((await rooms.readerDocumentFor(R, ed.r1, until)).kind, "open")
  })

  it("a link someone widened in Papermark is closed, never opened", async () => {
    const until = await reader.readerAccessUntil(R)
    const link = await linkOf(R)
    link.allow_list = [R, `${tag}_intruder@example.invalid`]
    link.expires_at = policy.closedAt()
    await sql`update review_reader_rooms set link_open_until = null where email = ${R}`
    assert.equal((await rooms.readerDocumentFor(R, ed.r1, until)).kind, "unavailable")
    assert.equal((await room(R)).state, "closed")
    assert.equal(isOpen(await linkOf(R)), false)
    link.allow_list = [R]
    assert.equal((await rooms.reconcileReaderRoom(R)).state, "ready", "Repair restores it")
  })

  it("before 20261011 is applied, the library uses each edition's own link and no room link is changed", async () => {
    await sql`alter table review_reader_rooms rename column link_open_until to link_open_until_hidden`
    rooms.resetReaderRoomsSchemaCache()
    try {
      const before = store.calls.length
      assert.deepEqual(await rooms.readerDocumentFor(R, ed.r1, new Date(Date.now() + 3_600_000).toISOString()), { kind: "legacy" })
      assert.equal(store.calls.length, before)
    } finally {
      await sql`alter table review_reader_rooms rename column link_open_until_hidden to link_open_until`
      rooms.resetReaderRoomsSchemaCache()
    }
  })
})
