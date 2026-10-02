/**
 * Papermark only lets other sites frame its /embed page, which it serves with
 * `frame-ancestors *`; every other viewer address sends X-Frame-Options
 * (SAMEORIGIN or DENY). Checked on the live hosts on 2 October 2026 with
 * made-up link ids. The portal used to frame `<share link>?embed=1`, which is
 * not a Papermark option, so those frames were refused. Invented links only.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { papermarkEmbedUrl, papermarkShareUrl, papermarkDocumentEmbedUrl } from "../src/lib/papermark-embed.ts"

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("a papermark.com document link is framed through its /embed page, never ?embed=1", () => {
  assert.equal(papermarkEmbedUrl("https://app.papermark.com/view/cmabc123"), "https://app.papermark.com/view/cmabc123/embed")
  assert.equal(papermarkEmbedUrl("https://www.papermark.com/view/cmabc123/"), "https://www.papermark.com/view/cmabc123/embed")
  assert.equal(papermarkEmbedUrl("https://app.papermark.com/view/cmabc123/embed"), "https://app.papermark.com/view/cmabc123/embed", "already an embed")
  assert.equal(papermarkEmbedUrl("https://app.papermark.com/view/cmabc123?embed=1"), "https://app.papermark.com/view/cmabc123/embed", "a stale ?embed=1 is dropped")
  for (const value of ["https://app.papermark.com/view/a", "https://docs.athenacentre.org/a"]) {
    assert.doesNotMatch(papermarkEmbedUrl(value) ?? "", /[?&]embed=/, value)
  }
})

test("a custom-domain link is framed through /<slug>/embed, keeping its query", () => {
  assert.equal(papermarkEmbedUrl("https://docs.athenacentre.org/apri-min-may"), "https://docs.athenacentre.org/apri-min-may/embed")
  assert.equal(
    papermarkEmbedUrl("https://read.example.invalid/apri-min?email=required", "read.example.invalid"),
    "https://read.example.invalid/apri-min/embed?email=required",
  )
})

test("shapes Papermark has no /embed page for get no frame, but still open in their own tab", () => {
  for (const value of [
    "https://app.papermark.com/view/cmabc123/d/cmdoc456", // a document inside a room
    "https://app.papermark.com/data-room/abc",
    "https://docs.athenacentre.org/client/a", // a custom domain serves one slug per link
  ]) {
    assert.equal(papermarkEmbedUrl(value), null, value)
    assert.ok(papermarkShareUrl(value), value)
  }
})

test("unsafe and unrelated links are refused for both the frame and the tab", () => {
  for (const value of [
    "javascript:alert(1)",
    "http://app.papermark.com/view/cmabc123",
    "https://user:pw@app.papermark.com/view/cmabc123",
    "https://example.com/view/cmabc123",
    "https://evil.papermark.com/view/cmabc123",
    "https://app.papermark.com/dashboard",
    "https://docs.athenacentre.org/00-masters",
    "https://app.papermark.com/view/abc%3Cscript%3E",
  ]) {
    assert.equal(papermarkEmbedUrl(value), null, value)
  }
  assert.equal(papermarkShareUrl("https://example.com/view/cmabc123"), null)
  assert.equal(papermarkShareUrl("https://app.papermark.com/view/cmabc123?embed=1"), "https://app.papermark.com/view/cmabc123")
})

test("the per-document link builder already uses the /embed page", () => {
  assert.equal(papermarkDocumentEmbedUrl("cmabc123"), "https://app.papermark.com/view/cmabc123/embed")
})

test("the portal frames the /embed address and opens the share link itself in a new tab", () => {
  const page = read("src/app/portal/document/[id]/page.tsx")
  assert.match(page, /const embedUrl = papermarkEmbedUrl\(/)
  assert.match(page, /const openUrl = papermarkShareUrl\(document\.shareUrl/)
  assert.match(page, /href=\{openUrl\}/)
  assert.doesNotMatch(page, /href=\{embedUrl\}/, "the tab never opens the embed page")
  assert.doesNotMatch(read("src/lib/papermark-embed.ts"), /searchParams\.set\('embed'/)
})

test("stored-link checks still validate the link itself, not whether it can be framed", () => {
  for (const file of ["src/app/actions/subscribers.ts", "src/lib/subscriber-activation.ts", "src/lib/papermark-link.ts"]) {
    const source = read(file)
    assert.match(source, /papermarkShareUrl\(/, file)
    assert.doesNotMatch(source, /papermarkEmbedUrl\(/, file)
  }
})
