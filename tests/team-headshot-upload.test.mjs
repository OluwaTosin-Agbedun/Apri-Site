import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const library = read("src/lib/team-images.ts")
const actions = read("src/app/actions/team-images.ts")
const form = read("src/app/admin/team/team-image-form.tsx")
const page = read("src/app/admin/team/page.tsx")

test("headshot uploads use the official public Vercel Blob API", () => {
  assert.match(library, /import \{ del, put \} from "@vercel\/blob"/)
  assert.match(library, /put\(`team\/\$\{key\}/)
  assert.match(library, /access: "public"/)
  assert.match(library, /addRandomSuffix: true/)
  assert.match(library, /contentType,/)
  assert.doesNotMatch(
    library,
    /blob\.vercel-storage\.com|x-api-version|authorization:/i,
  )
})

test("team image Server Actions export only async functions", () => {
  assert.doesNotMatch(
    actions,
    /^export (?!async function\b)(?:function|const|let|var|class)\b/m,
  )
})

test("JPEG, PNG and WebP are signature checked with a 4 MB limit", () => {
  assert.match(library, /MAX_HEADSHOT_BYTES = 4 \* 1024 \* 1024/)
  for (const type of ["image/jpeg", "image/png", "image/webp"])
    assert.match(library, new RegExp(type.replace("/", "\\/")))
  assert.match(library, /0xff && bytes\[1\] === 0xd8/)
  assert.match(library, /0x89, 0x50, 0x4e, 0x47/)
  assert.match(library, /"RIFF"/)
  assert.match(library, /actual !== file\.type/)
  assert.match(form, /maximum 4 MB/i)
})

test("Blob failures return an inline result and disable repeat submissions", () => {
  assert.match(actions, /TeamImageUploadError/)
  assert.match(actions, /status: "error"/)
  assert.match(form, /role="status"/)
  assert.match(form, /useFormStatus\(\)/)
  assert.match(form, /disabled=\{pending\}/)
  assert.match(
    library,
    /The image could not be uploaded\. Verify the APRI Blob store connection or use a public HTTPS image URL\./,
  )
})

test("external HTTPS images are validated and stored without Blob upload", () => {
  const external = library.slice(
    library.indexOf("export async function importHeadshot"),
    library.indexOf("export async function deleteHeadshotBlob"),
  )
  assert.match(external, /safeHttpsUrl/)
  assert.match(external, /assertPublicHost/)
  assert.match(external, /detectedType\(bytes\)/)
  assert.match(external, /url: url\.toString\(\)/)
  assert.doesNotMatch(external, /putBlob|\bput\(/)
  assert.match(actions, /result\.blob \? result\.url : null/)
})

test("replacement and removal clean up only database-recorded Blob URLs after saving", () => {
  assert.match(library, /await del\(url\)/)
  assert.ok(
    actions.indexOf("await sql`insert into team_member_images") <
      actions.indexOf("await deleteHeadshotBlob(previous[0].blob_url)"),
  )
  assert.ok(
    actions.indexOf("await sql`update team_member_images") <
      actions.lastIndexOf("await deleteHeadshotBlob(previous[0].blob_url)"),
  )
  assert.match(actions, /select blob_url from team_member_images/)
  assert.doesNotMatch(actions, /deleteHeadshotBlob\(result\.url\)/)
})

test("headshot actions remain owner-only and Blob credentials remain server-side", () => {
  assert.equal(actions.match(/await requireOwner\(\)/g)?.length, 2)
  assert.match(library, /^import "server-only"/)
  assert.doesNotMatch(form, /BLOB_READ_WRITE_TOKEN|authorization|@vercel\/blob/)
  assert.doesNotMatch(page, /authorization|@vercel\/blob/)
})
