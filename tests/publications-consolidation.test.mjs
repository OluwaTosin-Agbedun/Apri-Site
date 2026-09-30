/**
 * Publication management consolidated under Data Rooms: the separate top-level
 * Publications item is gone, while every record, route, mapping and paid
 * portal read stays exactly as it was. Invented data only.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { sql, makeTag, makeEdition, cleanup } from "./helpers.mjs"

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
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
process.env.DATABASE_URL = process.env.APRI_TEST_DATABASE_URL
const dal = await import("../src/lib/dataroom-dal.ts")

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const tag = makeTag("pubcons")
const ROOM = `${tag}_room`
let paid, open, legacy
const rows = []

before(async () => {
  paid = await makeEdition(tag, { suffix: "paid", series: "MIN", papermarkDocumentId: `${tag}_doc_paid` })
  open = await makeEdition(tag, { suffix: "open", series: "MIN", visibility: "OPEN", openLinkUrl: "https://example.invalid/open" })
  legacy = await makeEdition(tag, { suffix: "legacy", series: "PLM" })
  const [a] = await sql`
    insert into papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id, title, category, num_pages, publication_id, version_key)
    values (${ROOM}, ${`${tag}_doc_paid`}, ${"Athena Monthly Intelligence Note — Test.pdf"}, 'MIN', 12, ${paid.id}::uuid, 'v1') returning id`
  const [b] = await sql`
    insert into papermark_dataroom_documents (papermark_dataroom_id, papermark_document_id, title, category, num_pages, version_key)
    values (${ROOM}, ${`${tag}_doc_unlinked`}, 'Unlinked.pdf', 'AIU', 8, 'v1') returning id`
  rows.push(a.id, b.id)
})

after(async () => {
  await sql`delete from papermark_dataroom_documents where papermark_dataroom_id = ${ROOM}`
  await cleanup(tag)
})

describe("navigation", () => {
  const shell = read("src/components/AdminShell.tsx")
  it("has no separate top-level Publications item", () => {
    assert.doesNotMatch(shell, /\{ href: '\/admin\/documents', label: 'Publications' \}/)
  })
  it("keeps every other item as it was", () => {
    for (const [href, label] of [
      ["/admin", "Dashboard"],
      ["/admin/subscribers", "Subscribers"],
      ["/admin/engagement", "Engagement"],
      ["/admin/briefings", "Briefing Requests"],
      ["/admin/datarooms", "Data Rooms"],
    ]) {
      assert.ok(shell.includes(`{ href: '${href}', label: '${label}' }`), `${label} is still in the navigation`)
    }
    assert.match(shell, /label: 'Review Library'/)
  })
})

describe("the record editor stays reachable at its URLs", () => {
  it("keeps /admin/documents, /admin/documents/new and /admin/documents/[id]", () => {
    for (const f of ["src/app/admin/documents/page.tsx", "src/app/admin/documents/[id]/page.tsx", "src/app/admin/documents/[id]/document-form.tsx"]) {
      assert.ok(existsSync(fileURLToPath(new URL(`../${f}`, import.meta.url))), `${f} still exists`)
    }
    assert.match(read("src/app/admin/documents/[id]/page.tsx"), /if \(id === 'new'\)/)
  })
  it("places the record pages under Data Rooms", () => {
    assert.match(read("src/app/admin/documents/page.tsx"), /current="\/admin\/datarooms"/)
    assert.equal((read("src/app/admin/documents/[id]/page.tsx").match(/current="\/admin\/datarooms"/g) ?? []).length, 2)
  })
  it("is linked from Data Rooms and, for every admin, from the Dashboard", () => {
    const rooms = read("src/app/admin/datarooms/page.tsx")
    assert.match(rooms, /href="\/admin\/documents\/new"/)
    assert.match(rooms, /href="\/admin\/documents"/)
    assert.match(rooms, /Edit publication details/)
    assert.match(read("src/app/admin/page.tsx"), /Manage publication records →/)
  })
  it("keeps editors' access: the record pages still only require an admin", () => {
    assert.match(read("src/app/admin/documents/page.tsx"), /await requireAdmin\(\)/)
    assert.match(read("src/app/admin/documents/[id]/page.tsx"), /await requireAdmin\(\)/)
  })
})

describe("records are never lost in the move", () => {
  const actions = read("src/app/actions/documents.ts")
  it("refuses to delete a record that a Data Room document, review slot, access record or reading history uses", () => {
    const fn = actions.slice(actions.indexOf("export async function deleteDocument"), actions.indexOf("export async function saveDocument"))
    for (const table of ["papermark_dataroom_documents", "complimentary_review_items", "publication_access", "document_views", "document_download_events"]) {
      assert.ok(fn.includes(table), `${table} is checked before delete`)
    }
    assert.match(fn, /Archive it instead/)
    assert.ok(fn.indexOf("Archive it instead") < fn.indexOf("delete from documents"))
    assert.match(fn, /admin\.role !== 'owner'/)
  })
  it("validates every record id before it reaches a query", () => {
    assert.match(actions.slice(actions.indexOf("export async function setDocumentStatus")), /if \(!UUID\.test\(id\)\) return \{ message: 'Unknown publication\.' \}/)
    assert.match(actions, /if \(id !== null && !UUID\.test\(id\)\) return \{ message: 'Unknown publication\.' \}/)
  })
  it("leaves public review publishing and withdrawal in the Review Library", () => {
    assert.doesNotMatch(read("src/app/admin/datarooms/page.tsx"), /EditionWithdrawalPanel|publishEdition/)
    assert.match(read("src/app/admin/documents/page.tsx"), /Review Library/)
  })
})

describe("Data Rooms shows what the paid portal uses", () => {
  it("each linked document's series, edition date and portal title, and flags what is missing", async () => {
    const docs = await dal.getSyncedDocumentsForRoom(ROOM)
    const linked = docs.find((d) => d.publicationId === paid.id)
    assert.equal(linked.series, "MIN")
    assert.match(linked.editionDate, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(linked.portalTitle, "Athena Monthly Intelligence Note — Test", "the synced name, as subscribers see it")
    const unlinked = docs.find((d) => !d.publicationId)
    assert.deepEqual(unlinked.missingFields, ["Linked publication"])
    await sql`update documents set series = '' where id = ${paid.id}::uuid`
    const again = (await dal.getSyncedDocumentsForRoom(ROOM)).find((d) => d.publicationId === paid.id)
    assert.ok(again.missingFields.includes("Series"))
    await sql`update documents set series = 'MIN' where id = ${paid.id}::uuid`
  })

  it("lists the records no Data Room document links to, so legacy items stay manageable", async () => {
    const outside = await dal.getRecordsOutsideDataRooms()
    const ids = outside.map((r) => r.id)
    assert.ok(ids.includes(legacy.id))
    assert.ok(ids.includes(open.id))
    assert.ok(!ids.includes(paid.id), "a record in a Data Room is managed from its room row")
  })

  it("links a Data Room document only to an existing, paid record", async () => {
    assert.equal(await dal.linkPublicationToDocument(rows[1], open.id), false, "an open record cannot back a paid document")
    assert.equal(await dal.linkPublicationToDocument(rows[1], "00000000-0000-4000-8000-000000000000"), false)
    assert.equal(await dal.linkPublicationToDocument(rows[1], legacy.id), true)
    await sql`update papermark_dataroom_documents set publication_id = null where id = ${rows[1]}::uuid`
  })
})

describe("the paid portals read the same records as before", () => {
  it("the Data Room portal still takes series, edition date and the title override from the record", () => {
    const lib = read("src/lib/papermark-client-library.ts")
    assert.match(lib, /left join documents d on d\.id = dd\.publication_id/)
    assert.match(lib, /order by d\.edition_date desc nulls last/)
    assert.match(lib, /portal_title_override = true/)
  })
  it("the legacy portal still lists published, entitled records", () => {
    const dal = read("src/lib/subscriber-dal.ts")
    assert.match(dal, /d\.status\s*=\s*'published'/)
    assert.match(dal, /visibility <> 'OPEN'/)
  })
})
