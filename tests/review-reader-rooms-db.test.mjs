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
const faults = { ignoreHide: false, failPermissionsPut: false, failPatch: false, failDelete: false, reportDownloadable: false }
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
      if (faults.failPermissionsPut) return fail(500)
      // Delta semantics, as Papermark documents: entries sent are upserted.
      for (const p of body.permissions) {
        if (faults.ignoreHide && p.can_view === false && g.perms.get(p.item_id)?.can_view) continue
        g.perms.set(p.item_id, { item_id: p.item_id, item_type: p.item_type, can_view: p.can_view, can_download: p.can_download })
      }
      return send(200, { data: [...g.perms.values()] })
    }
    const rows = [...g.perms.values()].map((r) => (faults.reportDownloadable && r.can_view ? { ...r, can_download: true } : r))
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

await new Promise((ok) => papermark.listen(0, "127.0.0.1", ok))
process.env.PAPERMARK_API_BASE = `http://127.0.0.1:${papermark.address().port}`
process.env.PAPERMARK_API_TOKEN = "mock-token-not-real"
process.env.PAPERMARK_ROOM_CALLS_PER_MINUTE = "100000"
process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL
process.env.SESSION_SECRET = randomBytes(32).toString("hex")

const rooms = await import("../src/lib/review-reader-rooms.ts")
const policy = await import("../src/lib/reader-room-policy.ts")
const entry = await import("../src/lib/review-room-entry.ts")
const subscriberToken = await import("../src/lib/subscriber-session-token.ts")

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
})
after(async () => {
  papermark.close()
  await sql`delete from review_reader_room_events where email like ${`${tag}%`}`
  await sql`delete from review_reader_rooms where email like ${`${tag}%`}`
  await sql`delete from review_edition_recipients where email like ${`${tag}%`}`
  await sql`delete from review_publication_editions where title like ${`${tag}%`}`
  await cleanup(tag)
})
beforeEach(() => Object.assign(faults, { ignoreHide: false, failPermissionsPut: false, failPatch: false, failDelete: false, reportDownloadable: false }))

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

describe("the room rules", () => {
  it("every room document gets a row, viewing only where assigned, download never", () => {
    assert.deepEqual(policy.permissionPlan(["c", "a", "b"], ["b"]), [
      { item_id: "a", item_type: "dataroom_document", can_view: false, can_download: false },
      { item_id: "b", item_type: "dataroom_document", can_view: true, can_download: false },
      { item_id: "c", item_type: "dataroom_document", can_view: false, can_download: false },
    ])
  })
  it("a removal Papermark did not apply is caught as over-exposure", () => {
    const r = policy.comparePermissions([{ item_id: "a", item_type: "dataroom_document", can_view: true, can_download: false }], [])
    assert.deepEqual(r.overExposed, ["a"])
    assert.equal(r.exact, false)
  })
  it("a room link must be the reader's group only, email-verified, watermarked, protected and view-only", () => {
    const expected = { roomId: "r", groupId: "g", email: "x@example.invalid" }
    const good = { ...policy.roomLinkSettings({ roomId: "r", groupId: "g", email: "x@example.invalid" }), url: "https://docs.example.invalid/view/1" }
    assert.equal(policy.roomLinkProblem(good, expected), null)
    assert.match(policy.roomLinkProblem({ ...good, allow_download: true }, expected), /Downloads/)
    assert.match(policy.roomLinkProblem({ ...good, audience_type: "general" }, expected), /group/)
    assert.match(policy.roomLinkProblem({ ...good, email_authenticated: false }, expected), /Verified-email/)
    assert.match(policy.roomLinkProblem({ ...good, allow_list: ["x@example.invalid", "y@example.invalid"] }, expected), /allow list/)
    assert.match(policy.roomLinkProblem({ ...good, enable_screenshot_protection: false }, expected), /Screenshot/)
    assert.match(policy.roomLinkProblem({ ...good, expires_at: policy.closedAt() }, expected), /closed/)
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
    assert.ok([...groupA.perms.values()].every((p) => p.can_download === false))
  })

  it("the link is created only after the permissions are read back, with every protection on", async () => {
    const a = await room(A)
    const calls = store.calls
    const firstLink = calls.indexOf("POST /v1/links")
    const permsRead = calls.findIndex((c) => c.startsWith("GET") && c.endsWith(`${a.papermark_group_id}/permissions`))
    assert.ok(permsRead !== -1 && permsRead < firstLink)
    const link = store.links.get(a.papermark_link_id)
    assert.equal(link.audience_type, "group")
    assert.equal(link.email_authenticated, true)
    assert.equal(link.allow_download, false)
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

  it("if Papermark reports downloads on, the link is closed", async () => {
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
  it("the routing cookie names a reader's room, is never a sign-in, and nothing else can stand in for it", async () => {
    globalThis.__jar = new Map()
    await entry.setRoomHint(A)
    assert.equal(await entry.readRoomHint(), A)
    const real = globalThis.__jar.get("apri_review_room")
    globalThis.__jar.set("apri_review_room", real.slice(0, -2) + "xx")
    assert.equal(await entry.readRoomHint(), null, "a tampered routing cookie is ignored")
    const subscriber = await subscriberToken.signSubscriberSession({ principalId: (await makeSeat(tag, { suffix: "s" })).id })
    globalThis.__jar.set("apri_review_room", subscriber)
    assert.equal(await entry.readRoomHint(), null, "a subscriber cookie is not a routing cookie")
    await entry.setRoomHint(A)
    await entry.clearRoomHint()
    assert.equal(await entry.readRoomHint(), null, '"Not you?" and sign-out clear it')
  })
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  it("asks for no APRI code or email, re-checks approval, and redirects only to a room confirmed for the current editions", () => {
    const route = read("src/app/review/read/route.ts")
    assert.doesNotMatch(route, /signInWithCode|signInReaderWithCode|sendReview|issueReaderSignIn/)
    assert.match(route, /const hinted = session \? null : await readRoomHint\(\)/, "a signed-in reader outranks the routing cookie")
    assert.match(route, /roomEntryFor\(email,/)
    assert.ok(route.indexOf("roomEntryFor(email,") < route.indexOf("NextResponse.redirect(entry.url"))
    assert.ok(!/review-room-entry"[\s\S]*signRoomEntry/.test(route) && !read("src/lib/review-room-entry.ts").includes("signRoomEntry"), "no emailed reading link")
    assert.ok(!read("src/lib/review-email.ts").includes("sendReviewReadingLink"))
  })
  it("the cards open rooms only once the two-reader proof is recorded", () => {
    const lib = read("src/lib/review-reader.ts")
    assert.match(lib, /\(await readerRoomsSchemaReady\(\)\) && \(await reviewRoomsProof\(\)\) \? "rooms" : "papermark"/)
    const actions = read("src/app/actions/review-reader-rooms.ts")
    for (const fn of ["prepareRoomsFor", "checkAllRooms", "prepareAllApprovedRooms", "recordRoomsProof", "withdrawRoomsProof"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`))
      assert.ok(body.indexOf("await requireOwner()") < body.indexOf("getSql()") || body.indexOf("getSql()") === -1, fn)
    }
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
  })

  it("an unapproved address gets no room and no link", async () => {
    assert.deepEqual(await rooms.roomEntryFor(NOBODY, { allowCreate: true }), { kind: "not_approved" })
    assert.equal(await room(NOBODY), undefined, "nothing is created for it")
  })

  it("an approved reader is sent only to a room showing exactly their current editions", async () => {
    const first = await rooms.roomEntryFor(E, { allowCreate: true })
    assert.equal(first.kind, "ready")
    assert.deepEqual(viewerSees((await room(E)).papermark_link_id, E), [DOC("x1")])
    // A new assignment: the stored set no longer matches, so the room is
    // brought into line before the reader is sent there.
    await grant("x2", E)
    const second = await rooms.roomEntryFor(E, { allowCreate: true })
    assert.equal(second.kind, "ready")
    assert.deepEqual(viewerSees((await room(E)).papermark_link_id, E), [DOC("x1"), DOC("x2")].sort())
    await sql`update review_edition_recipients set revoked_at = now() where edition_id = ${ed.x1}::uuid and email = ${E}`
    assert.equal((await rooms.roomEntryFor(E, { allowCreate: true })).kind, "ready")
    assert.deepEqual(viewerSees((await room(E)).papermark_link_id, E), [DOC("x2")], "a removal takes effect before the next open")
  })

  it("one Papermark code opens every assigned edition in that session; nothing else opens", async () => {
    // Papermark's own rule, from its source: a verified room session covers
    // every document the group may view, until the session ends.
    const link = (await room(E)).papermark_link_id
    let codes = 0
    const sessions = new Set()
    const open = (email, documentId) => {
      if (!sessions.has(email)) {
        if (viewerSees(link, email) === null) return "refused at the email check"
        codes++
        sessions.add(email)
      }
      return viewerSees(link, email).includes(documentId) ? "opened" : "refused"
    }
    await grant("x1", E)
    await rooms.roomEntryFor(E, { allowCreate: true })
    assert.equal(open(E, DOC("x1")), "opened")
    assert.equal(open(E, DOC("x2")), "opened")
    assert.equal(codes, 1, "one code for both editions")
    assert.equal(open(E, DOC("three")), "refused", "another reader's edition")
    assert.equal(open(E, DOC("withdrawnA")), "refused", "a withdrawn edition")
    assert.equal(open(E, `${tag}_stray`), "refused", "an unassigned PDF in the room")
    assert.equal(open(NOBODY, DOC("x1")), "refused at the email check", "an unapproved address gets no code")
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
  })
})
