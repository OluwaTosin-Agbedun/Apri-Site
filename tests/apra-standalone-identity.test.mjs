/**
 * The Chancellor's standalone-entity clarification remains in force with the
 * current Athena Strategic Advisory identity: it is not presented as a service
 * of the Athena Centre or any other organisation.
 *
 * These checks keep that true: no parent-organisation statement, link,
 * structured-data relationship or email signature line; the footer copyright
 * reads "© <year> Athena Strategic Advisory" without "All rights reserved"; and the
 * things the clarification says to keep are kept -- factual team biographies
 * and employment history, and the working contact mailbox until a verified
 * replacement is supplied.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { loadApp } from "../scripts/lib/load-app.mjs"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), "utf8")
const seo = await loadApp("lib/seo.ts")
const site = await loadApp("lib/site-config.ts")

/** Every source file under src/, as repository-relative posix paths. */
function sourceFiles(dir = join(ROOT, "src")) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [relative(ROOT, path).split(sep).join("/")] : []
  })
}

// Factual biographies may name the Athena Centre as a team member's employer.
const BIOGRAPHIES = "src/data/team.ts"

test("structured data presents Athena Strategic Advisory as a standalone organisation with no parent organisation", () => {
  const graph = seo.publicOrganisationSchema()["@graph"]
  const organisation = graph.find((node) => node["@type"] === "Organization")
  assert.ok(organisation, "an Organization node exists")
  assert.ok(organisation.url.startsWith(site.ADVISORY_SITE_ORIGIN))
  const json = JSON.stringify(graph)
  assert.doesNotMatch(json, /parentOrganization|subOrganization|memberOf|parentOf/)
  assert.doesNotMatch(json, /Athena Centre|athenacentre/i)
})

test("the footer keeps Athena Strategic Advisory's identity, address and navigation, with the corrected copyright line", () => {
  const footer = read("src/components/SiteFooter.tsx")
  assert.match(footer, /&copy; \{new Date\(\)\.getFullYear\(\)\} Athena Strategic Advisory\s*<\/p>/, "automatic year, then 'Athena Strategic Advisory' and nothing else")
  assert.doesNotMatch(footer, /All rights reserved/i)
  assert.doesNotMatch(footer, /Athena Centre|athenacentre|service of/i)
  assert.match(footer, /Athena Strategic Advisory/)
  assert.match(footer, /href=\{siteOrigin\(\)\}/, "links to the trusted Athena Strategic Advisory origin (athenaadvisory.ng)")
  for (const href of ["/team", "/terms", "/privacy"]) assert.match(footer, new RegExp(`href="${href}"`), href)
})

test("no page, component, email or metadata describes Athena Strategic Advisory as a service of, or affiliated to, another organisation", () => {
  const offending = []
  for (const file of sourceFiles()) {
    if (file === BIOGRAPHIES) continue
    // Join wrapped JSX/HTML lines so "by Athena\n  Centre" is caught too.
    const text = read(file).replace(/\s+/g, " ")
    for (const pattern of [
      // Outside factual biographies, nothing names the Athena Centre at all
      // (working mailboxes such as intelligence@athenacentre.org have no space).
      /Athena Centre/i,
      /service of (the )?Athena/i,
      /Athena Centre for Policy (and|&amp;|&) Leadership/i,
      /www\.athenacentre\.org/i,
      /parentOrganization/,
      /All rights reserved/i,
      /outside Athena Centre/i,
      />\s*Athena Centre:\s*</,
    ]) {
      if (pattern.test(text)) offending.push(`${file}: ${pattern}`)
    }
  }
  assert.deepEqual(offending, [])
})

test("the homepage About section, team introduction and privacy notice name Athena Strategic Advisory alone", () => {
  const home = read("src/app/page.tsx")
  const about = home.slice(home.indexOf('id="contact"'))
  assert.match(about, /About Athena Strategic Advisory/)
  assert.doesNotMatch(about, /Athena Centre/)
  const team = read("src/app/team/page.tsx")
  assert.doesNotMatch(team, /Athena Centre|Institutional Foundation/)
  const privacy = read("src/app/privacy/page.tsx")
  assert.match(privacy, /Athena Strategic Advisory\.\s+Last updated \{LAST_UPDATED\}/)
  assert.doesNotMatch(privacy, /Athena Centre/)
})

test("email signatures name Athena Strategic Advisory without a parent organisation", () => {
  for (const file of ["src/lib/email.ts", "src/lib/subscriber-email.ts"]) {
    const text = read(file)
    assert.match(text, /Athena Strategic Advisory/, file)
    assert.doesNotMatch(text, /Athena Centre for Policy/i, file)
  }
})

test("factual biographies and the working contact mailbox are kept", () => {
  const team = read(BIOGRAPHIES)
  assert.match(team, /Founder, Athena Centre for Policy and Leadership/, "employment history is preserved")
  assert.match(team, /Senior Research Fellow at the Athena Centre/, "employment history is preserved")
  // Kept until a verified replacement mailbox is supplied; do not invent one.
  assert.match(read("src/config.ts"), /CONTACT_EMAIL = 'intelligence@athenacentre\.org'/)
})
