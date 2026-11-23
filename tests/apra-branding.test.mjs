import { test } from "node:test"
import assert from "node:assert/strict"
import { BRAND_NAME, currentBrandCopy } from "../src/lib/brand.ts"
import { editionCode, copyId } from "../src/lib/copy-naming.ts"
import { EMPTY_LIBRARY_FILTERS, searchLibrary } from "../src/lib/library-search.ts"

test("saved promotional copy presents the current identity without changing its source", () => {
  const saved = "Athena Political and Regulatory Intelligence serves APRI readers. Contact APRI."
  assert.equal(currentBrandCopy(saved), `${BRAND_NAME} serves ${BRAND_NAME} readers. Contact ${BRAND_NAME}.`)
  assert.equal(saved, "Athena Political and Regulatory Intelligence serves APRI readers. Contact APRI.")
  assert.equal(currentBrandCopy("Athena Political &amp; Regulatory\nIntelligence"), BRAND_NAME)
  assert.equal(currentBrandCopy("April intelligence and regulatory analysis"), "April intelligence and regulatory analysis")
})

test("presentation does not rewrite mailboxes, old links or historical edition identifiers", () => {
  const text = "briefings@apri.athenacentre.org https://apri.athenacentre.org/portal APRI-MIN-2026-08"
  assert.equal(currentBrandCopy(text), text)
  assert.equal(currentBrandCopy("APRI-managed access; APRI's subscribers"), `${BRAND_NAME}-managed access; ${BRAND_NAME}'s subscribers`)
})

test("old and new edition prefixes resolve to the same existing short code and copy identity", () => {
  const publication = { series: "MIN", code: "APRI-MIN-2026-08", title: "Historical publication", editionDate: null }
  const subscriber = { fullName: "Adaeze Okonkwo", organisation: "Test organisation", seatNo: 14 }
  assert.equal(editionCode(publication), "MIN-2026-08")
  assert.equal(editionCode({ ...publication, code: "APRA-MIN-2026-08" }), "MIN-2026-08")
  assert.equal(copyId(publication, subscriber), copyId({ ...publication, code: "APRA-MIN-2026-08" }, subscriber))
})

test("the current name finds saved promotional text while retaining the original record", () => {
  const saved = { id: "permitted", series: "MIN", title: "An assigned note", editionDate: "2026-08-01", description: "An APRI subscriber publication" }
  const found = searchLibrary([saved], { ...EMPTY_LIBRARY_FILTERS, query: "Athena" })
  assert.deepEqual(found.entries.map(entry => entry.id), ["permitted"])
  assert.equal(saved.description, "An APRI subscriber publication")
})

test("the leaked editorial instruction is removed from saved promotional copy only", () => {
  const saved = "A monthly monitoring report. Although public-facing, it should appear here as part of the broader monthly intelligence bouquet available to APRA readers."
  assert.equal(currentBrandCopy(saved), "A monthly monitoring report.")
  assert.match(saved, /Although public-facing/)
})
