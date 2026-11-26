/** Real settings SQL against the isolated test database; all Blob and auth calls mocked. */
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { registerHooks } from "node:module"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { join } from "node:path"
import { neon, neonConfig } from "@neondatabase/serverless"
const root = fileURLToPath(new URL("../src/", import.meta.url))
const moduleUrl = code => `data:text/javascript,${encodeURIComponent(code)}`
const state = globalThis.__coverTests = { admin: { id: randomUUID(), role: "owner" }, uploads: [], deletes: [], paths: [] }
registerHooks({ resolve(name, context, next) {
  if (name === "server-only") return { shortCircuit: true, url: moduleUrl("export {}") }
  if (name === "@/lib/dal") return { shortCircuit: true, url: moduleUrl("export async function requireAdmin(){if(!globalThis.__coverTests.admin)throw Error('sign-in required');return globalThis.__coverTests.admin}") }
  if (name === "@/lib/db" || (name === "./db" && context.parentURL?.endsWith("publication-covers.ts"))) return { shortCircuit: true, url: moduleUrl("export function getSql(){return globalThis.__coverSql}") }
  if (name === "next/cache") return { shortCircuit: true, url: moduleUrl("export function revalidatePath(path){globalThis.__coverTests.paths.push(path)}") }
  if (name === "@vercel/blob") return { shortCircuit: true, url: moduleUrl(`
    export async function put(path,file,options){
      const s=globalThis.__coverTests;
      if(s.failUpload)throw Error('provider-internal-details');
      const url='https://cover-test.public.blob.vercel-storage.com/'+path.replace(/\\.(jpg|png|webp)$/, '-test'+(s.uploads.length+1)+'.$1');
      s.uploads.push({url,path,options});if(s.afterUpload)await s.afterUpload();return {url};
    }
    export async function del(url){globalThis.__coverTests.deletes.push(url)}
  `) }
  if (name.startsWith("@/")) {
    const base = join(root, name.slice(2))
    for (const path of [base, `${base}.ts`]) if (existsSync(path)) return { shortCircuit: true, url: pathToFileURL(path).href }
  }
  if (name === "./publication-cover" && context.parentURL?.endsWith("publication-covers.ts")) return { shortCircuit: true, url: pathToFileURL(join(root, "lib/publication-cover.ts")).href }
  return next(name, context)
} })
neonConfig.fetchEndpoint = () => process.env.APRI_TEST_DB_ENDPOINT
const sql = neon(process.env.APRI_TEST_DATABASE_URL)
globalThis.__coverSql = async (strings, ...values) => {
  const result = await sql(strings, ...values)
  if (state.uncertainSave && strings.join("").includes("insert into app_settings")) throw Error("simulated lost save response")
  return result
}
process.env.BLOB_READ_WRITE_TOKEN = "invented-storage-credential"
const m = await import("../src/lib/publication-cover.ts")
const actions = await import("../src/app/actions/publication-covers.ts")
const queries = await import("../src/lib/publication-covers.ts")
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=", "base64")
const file = () => new File([PNG], "approved-cover.png", { type: "image/png" })
function form(revision = "", changes = {}) {
  const f = new FormData()
  for (const [key, value] of Object.entries({ revision, file: file(), alt: "Cover of the approved test edition", credit: "Test Publications", approved: "on", ...changes })) if (value !== null) f.set(key, value)
  return f
}
async function edition(kind = "publication") {
  const id = randomUUID()
  if (kind === "publication") await sql`insert into documents(id,slug,title,visibility,status,is_published) values(${id}::uuid,${`cover-test-${id}`},'Invented cover publication','L4','draft',false)`
  else await sql`insert into review_publication_editions(id,papermark_document_id,title,publication_state) values(${id}::uuid,${`cover-test-${id}`},'Invented review edition','draft')`
  return id
}
async function stored(kind, id) {
  const rows = await sql`select value from app_settings where key=${m.coverKey(kind, id)}`
  return rows[0] ? JSON.parse(rows[0].value) : null
}
const save = (kind, id, f = form()) => actions.savePublicationCover(kind, id, m.EMPTY_COVER_STATE, f)
const remove = (kind, id, f) => actions.removePublicationCover(kind, id, m.EMPTY_COVER_STATE, f)
beforeEach(() => {
  Object.assign(state, { admin: { id: randomUUID(), role: "owner" }, uploads: [], deletes: [], paths: [], failUpload: false, afterUpload: null, uncertainSave: false })
  process.env.BLOB_READ_WRITE_TOKEN = "invented-storage-credential"
})

test("cover files accept real image signatures and reject empty, oversized, disguised and PDF uploads", async () => {
  assert.equal(await m.validateCoverFile(file()), "image/png")
  await assert.rejects(m.validateCoverFile(new File([], "empty.png", { type: "image/png" })), /Choose a cover/)
  await assert.rejects(m.validateCoverFile(new File([new Uint8Array(m.MAX_COVER_BYTES + 1)], "large.png", { type: "image/png" })), /4 MB/)
  await assert.rejects(m.validateCoverFile(new File(["<svg>bad</svg>"], "fake.png", { type: "image/png" })), /contents/)
  await assert.rejects(m.validateCoverFile(new File([PNG], "fake.jpg", { type: "image/jpeg" })), /contents/)
  await assert.rejects(m.validateCoverFile(new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" })), /existing publication process/)
  await assert.rejects(m.validateCoverFile(new File(["<svg/>"], "cover.svg", { type: "image/svg+xml" })), /JPEG, PNG or WebP/)
})

test("uploads persist per-edition covers without changing the report, release or access", async () => {
  const id = await edition()
  assert.equal((await save("publication", id)).ok, true)
  const cover = await stored("publication", id)
  assert.equal(cover.image.alt, "Cover of the approved test edition")
  assert.equal(state.uploads[0].options.access, "public")
  assert.match(state.uploads[0].path, new RegExp(`publication-covers/publication/${id}/`))
  assert.equal(state.deletes.length, 0)
  const [record] = await sql`select status,is_published,visibility,papermark_link from documents where id=${id}::uuid`
  assert.deepEqual(record, { status: "draft", is_published: false, visibility: "L4", papermark_link: "" })
  assert.deepEqual((await queries.getPublicationCovers()).get(m.coverKey("publication", id)), cover.image)
  assert.ok(state.paths.includes("/") && state.paths.includes("/publications"))
})

test("public cover results do not include staff identity or edit revisions", async () => {
  const id = await edition()
  await save("publication", id)
  const image = (await queries.getPublicationCovers()).get(m.coverKey("publication", id))
  assert.deepEqual(Object.keys(image).sort(), ["alt", "credit", "src"])
})

test("replacing a cover keeps its record and cleans only the previous cover after saving", async () => {
  const id = await edition()
  await save("publication", id)
  const old = await stored("publication", id)
  assert.equal((await save("publication", id, form(old.revision, { credit: "Replacement credit" }))).ok, true)
  const current = await stored("publication", id)
  assert.notEqual(current.revision, old.revision)
  assert.notEqual(current.image.src, old.image.src)
  assert.deepEqual(state.deletes, [old.image.src])
  assert.equal(current.image.credit, "Replacement credit")
})

test("removing the cover stores an explicit empty image and preserves the review edition", async () => {
  const id = await edition("review")
  await save("review", id)
  const old = await stored("review", id)
  assert.equal((await remove("review", id, form(old.revision))).ok, true)
  const current = await stored("review", id)
  assert.equal(current.image, null)
  assert.notEqual(current.revision, old.revision)
  assert.deepEqual(state.deletes, [old.image.src])
  assert.equal((await queries.getPublicationCovers()).get(m.coverKey("review", id)), null)
  assert.equal((await sql`select publication_state from review_publication_editions where id=${id}::uuid`)[0].publication_state, "draft")
})

test("stale replacement and stale removal cannot overwrite a newer cover", async () => {
  const id = await edition()
  await save("publication", id)
  const expected = await stored("publication", id)
  assert.match((await save("publication", id, form())).message, /cover changed/)
  assert.match((await remove("publication", id, form())).message, /cover changed/)
  assert.deepEqual(await stored("publication", id), expected)
  assert.equal(state.uploads.length, 1)
  assert.equal(state.deletes.length, 0)
})

test("a conflicting save during upload keeps the newer record and removes only the refused upload", async () => {
  const id = await edition()
  await save("publication", id)
  const old = await stored("publication", id)
  const concurrent = { ...old, revision: randomUUID(), image: { ...old.image, src: old.image.src.replace("test1", "otheredit") } }
  state.afterUpload = () => sql`update app_settings set value=${JSON.stringify(concurrent)} where key=${m.coverKey("publication", id)}`
  const result = await save("publication", id, form(old.revision))
  assert.equal(result.ok, false)
  assert.match(result.message, /cover changed/)
  assert.deepEqual(await stored("publication", id), concurrent)
  assert.deepEqual(state.deletes, [state.uploads[1].url])
})

test("an uncertain save response never deletes the potentially committed image", async () => {
  const id = await edition()
  state.uncertainSave = true
  const result = await save("publication", id)
  assert.equal(result.ok, false)
  assert.match(result.message, /could not be confirmed/)
  assert.ok((await stored("publication", id)).image)
  assert.equal(state.deletes.length, 0)
})

test("storage failure keeps the existing cover and never exposes provider details", async () => {
  const id = await edition()
  await save("publication", id)
  const old = await stored("publication", id)
  state.failUpload = true
  const result = await save("publication", id, form(old.revision))
  assert.equal(result.ok, false)
  assert.doesNotMatch(result.message, /provider-internal/)
  assert.deepEqual(await stored("publication", id), old)
  assert.equal(state.deletes.length, 0)
})

test("missing storage configuration, missing approval and bad image descriptions refuse upload", async () => {
  const id = await edition()
  for (const change of [{ approved: null }, { alt: "" }, { credit: "x".repeat(201) }]) assert.equal((await save("publication", id, form("", change))).ok, false)
  delete process.env.BLOB_READ_WRITE_TOKEN
  assert.match((await save("publication", id)).message, /not configured/)
  assert.equal(state.uploads.length, 0)
  assert.equal(await stored("publication", id), null)
})

test("authentication and review owner checks run before any upload", async () => {
  const id = await edition("review")
  state.admin = null
  await assert.rejects(save("review", id), /sign-in required/)
  state.admin = { id: randomUUID(), role: "editor" }
  assert.match((await save("review", id)).message, /Only an owner/)
  assert.match((await remove("review", id, form())).message, /Only an owner/)
  assert.equal(state.uploads.length, 0)
})

test("unknown records and invalid targets cannot create cover records", async () => {
  for (const [kind, id] of [["publication", randomUUID()], ["review", randomUUID()], ["other", randomUUID()], ["publication", "../report"]]) assert.equal((await save(kind, id)).ok, false)
  assert.equal(state.uploads.length, 0)
})

test("URLs outside this edition's public cover prefix are never accepted or deleted", async () => {
  const id = await edition()
  const key = m.coverKey("publication", id)
  const value = { revision: randomUUID(), image: { src: "https://cover-test.public.blob.vercel-storage.com/confidential/original.pdf", alt: "Unsafe", credit: "" }, updatedAt: new Date().toISOString(), updatedBy: randomUUID() }
  assert.equal(m.readStoredCover(JSON.stringify(value), "publication", id), null)
  await sql`insert into app_settings(key,value) values(${key},${JSON.stringify(value)})`
  assert.equal((await queries.getPublicationCovers()).has(key), false)
  assert.match((await save("publication", id, form(value.revision))).message, /needs checking/)
  assert.equal(state.deletes.length, 0)
  assert.equal(state.uploads.length, 0)
})

test("upload integration never adds migrations or changes publishing and document actions", () => {
  const action = readFileSync(new URL("../src/app/actions/publication-covers.ts", import.meta.url), "utf8")
  assert.doesNotMatch(action, /update\s+(documents|review_publication_editions)|publication_access|publication_plans|papermark\//i)
  assert.match(action, /insert into app_settings/)
})
