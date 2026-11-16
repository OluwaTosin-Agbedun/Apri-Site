import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { loadApp } from "../scripts/lib/load-app.mjs"
import { NextRequest } from "next/server.js"
import testing from "next/dist/experimental/testing/server/middleware-testing-utils.js"
// Next 16.2 exports the matcher utility under its older middleware name.
const { unstable_doesMiddlewareMatch: doesProxyMatch } = testing
const site = await loadApp("lib/site-config.ts")
const seo = await loadApp("lib/seo.ts")
const sitemap = await loadApp("app/sitemap.ts")
const robots = await loadApp("app/robots.ts")
const llms = await loadApp("app/llms.txt/route.ts")
const { default: proxy, config } = await import("../proxy.ts")
const urls = await loadApp("lib/app-url.ts")
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const restore = { ...process.env }
test.after(() => {
  for (const key of [
    "PUBLIC_SITE_URL",
    "VERCEL_ENV",
    "SITE_REDIRECTS_ENABLED",
    "NODE_ENV",
    "APP_URL",
  ])
    if (restore[key] === undefined) delete process.env[key]
    else process.env[key] = restore[key]
})
test("the canonical origin is an exact configured HTTPS origin, never a visitor's host", () => {
  assert.equal(site.siteOrigin({}), site.ADVISORY_SITE_ORIGIN)
  assert.equal(site.siteOrigin({ PUBLIC_SITE_URL: site.LEGACY_SITE_ORIGIN }), site.LEGACY_SITE_ORIGIN, "explicit legacy origin remains available for rollback")
  for (const raw of [
    "http://athenaadvisory.ng",
    "https://attacker.invalid",
    "https://athenaadvisory.ng/x",
    "https://user@athenaadvisory.ng",
    "https://athenaadvisory.ng/?q=a",
    "https://athenaadvisory.ng#fragment",
  ])
    assert.throws(
      () => site.siteOrigin({ PUBLIC_SITE_URL: raw }),
      /approved HTTPS/,
    )
  assert.equal(
    site.siteOrigin({ PUBLIC_SITE_URL: "https://athenaadvisory.ng/" }),
    site.ADVISORY_SITE_ORIGIN,
  )
})
test("public metadata and sitemap are unique and contain only the explicit public allowlist", () => {
  process.env.NODE_ENV = "production"
  process.env.VERCEL_ENV = "production"
  delete process.env.PUBLIC_SITE_URL
  const pages = site.INDEXABLE_PATHS.map((p) => seo.publicMetadata(p))
  assert.equal(
    new Set(pages.map((p) => p.title)).size,
    site.INDEXABLE_PATHS.length,
  )
  assert.equal(
    new Set(pages.map((p) => p.description)).size,
    site.INDEXABLE_PATHS.length,
  )
  for (const [index, page] of pages.entries()) {
    assert.equal(
      page.alternates.canonical,
      new URL(site.INDEXABLE_PATHS[index], site.ADVISORY_SITE_ORIGIN).href,
    )
    assert.equal(page.robots.index, true)
    assert.equal(page.robots.follow, true)
    assert.equal(
      page.openGraph.images[0].url,
      `${site.ADVISORY_SITE_ORIGIN}/opengraph-image`,
    )
    assert.equal(page.twitter.card, "summary_large_image")
  }
  assert.deepEqual(
    sitemap.default().map((p) => p.url),
    site.INDEXABLE_PATHS.map((p) => new URL(p, site.ADVISORY_SITE_ORIGIN).href),
  )
  assert.ok(
    !sitemap.default().some((p) => /portal|admin|library|token=/.test(p.url)),
  )
  assert.ok(robots.default().rules.disallow.includes("/portal"))
})
test("preview deployments stay unindexed and never publish a public sitemap", async () => {
  process.env.VERCEL_ENV = "preview"
  assert.deepEqual(sitemap.default(), [])
  assert.equal(robots.default().rules.disallow, "/")
  assert.equal(seo.publicMetadata("/").robots.index, false)
  const text = await llms.GET().text()
  assert.doesNotMatch(text, /portal|token=|example@/)
  for (const path of site.INDEXABLE_PATHS) {
    const response = await proxy(
      new NextRequest(`${site.LEGACY_SITE_ORIGIN}${path}`),
    )
    assert.match(response.headers.get("X-Robots-Tag"), /noindex/)
  }
  process.env.VERCEL_ENV = "production"
})
test("all private routes and unknown hosts are noindex and protected responses are never publicly cached", async () => {
  for (const path of [
    "/portal",
    "/portal/preferences",
    "/review/library",
    "/review/library/open/11111111-1111-4111-8111-111111111111",
    "/admin",
    "/api/cron/publication-notifications",
  ]) {
    assert.equal(doesProxyMatch({ config, url: path }), true)
    const response = await proxy(
      new NextRequest(`${site.LEGACY_SITE_ORIGIN}${path}`),
    )
    assert.match(response.headers.get("X-Robots-Tag"), /noindex/)
    assert.match(response.headers.get("Cache-Control"), /private.*no-store/)
  }
  const hostile = await proxy(
    new NextRequest(`${site.LEGACY_SITE_ORIGIN}/`, {
      headers: { host: "attacker.invalid" },
    }),
  )
  assert.match(hostile.headers.get("X-Robots-Tag"), /noindex/)
  const publicPage = await proxy(
    new NextRequest(`${site.ADVISORY_SITE_ORIGIN}/publications`),
  )
  assert.equal(publicPage.headers.get("X-Robots-Tag"), null)
})
test("domain migration is opt-in, maps stable URLs, and strips credentials without forwarding cross-domain POSTs or callbacks", async () => {
  const env = {
    PUBLIC_SITE_URL: site.ADVISORY_SITE_ORIGIN,
    SITE_REDIRECTS_ENABLED: "enabled",
  }
  assert.equal(
    site.migrationDestination(
      new URL(`${site.LEGACY_SITE_ORIGIN}/publications`),
      "GET",
      {},
    ),
    null,
  )
  assert.equal(
    site.migrationDestination(
      new URL(`${site.LEGACY_SITE_ORIGIN}/publications?series=MIN`),
      "GET",
      env,
    ).href,
    `${site.ADVISORY_SITE_ORIGIN}/publications?series=MIN`,
  )
  for (const path of [
    "/api/resend/webhook",
    "/api/papermark/webhook",
    "/api/cron/papermark-work",
  ])
    assert.equal(
      site.migrationDestination(
        new URL(`${site.LEGACY_SITE_ORIGIN}${path}`),
        "GET",
        env,
      ),
      null,
    )
  assert.equal(
    site.migrationDestination(
      new URL(`${site.LEGACY_SITE_ORIGIN}/review`),
      "POST",
      env,
    ),
    null,
  )
  for (const [path, target] of [
    ["/portal/verify?token=private", "/portal/sign-in"],
    ["/review/access?token=private", "/review/library/sign-in"],

    ["/admin/login?code=private&next=https://attacker.invalid", "/admin/login"],
  ]) {
    assert.equal(
      site.migrationDestination(
        new URL(site.LEGACY_SITE_ORIGIN + path),
        "GET",
        env,
      ).href,
      site.ADVISORY_SITE_ORIGIN + target,
    )
  }
  assert.equal(site.migrationDestination(new URL(`${site.LEGACY_SITE_ORIGIN}/review/verify?token=private`), "GET", env), null, "existing request-confirmation links are verified on their original host, never forwarded")
  Object.assign(process.env, env)
  const response = await proxy(
    new NextRequest(`${site.LEGACY_SITE_ORIGIN}/publications`),
  )
  assert.equal(response.status, 308)
  assert.equal(
    response.headers.get("location"),
    `${site.ADVISORY_SITE_ORIGIN}/publications`,
  )
  process.env.APP_URL = site.LEGACY_SITE_ORIGIN
  assert.equal(
    urls.emailOrigin(),
    site.ADVISORY_SITE_ORIGIN,
    "new trusted config wins over a stale APP_URL",
  )
  assert.equal(
    urls.portalSignInUrl(),
    `${site.ADVISORY_SITE_ORIGIN}/portal/sign-in`,
  )
  assert.ok(
    urls
      .portalVerificationUrl("invented-token")
      .startsWith(site.ADVISORY_SITE_ORIGIN),
  )
  delete process.env.PUBLIC_SITE_URL
  delete process.env.SITE_REDIRECTS_ENABLED
  delete process.env.APP_URL
})
test("structured data and llms.txt describe public information only and escape script terminators", async () => {
  assert.doesNotMatch(
    seo.safeJsonLd({ text: "</script><script>&\u2028\u2029" }),
    /[<>&\u2028\u2029]/,
  )
  const graph = seo.publicOrganisationSchema()["@graph"]
  assert.deepEqual(
    graph.map((p) => p["@type"]),
    ["Organization", "WebSite"],
  )
  assert.ok(graph.every((p) => p.url.startsWith(site.ADVISORY_SITE_ORIGIN)))
  const response = llms.GET()
  assert.match(response.headers.get("content-type"), /text\/plain/)
  const content = await response.text()
  assert.match(content, /grants no permission/)
  assert.doesNotMatch(
    content,
    /https?:\/\/[^\s)]+\/(?:portal|admin|review\/library)/,
  )
})
test("the existing OPEN-publication redirect has a real page anchor; no root loading boundary masks 404s", () => {
  assert.match(
    read("src/app/publications/[slug]/page.tsx"),
    /redirect\('\/publications#review-publications'\)/,
  )
  assert.match(
    read("src/app/publications/page.tsx"),
    /id="review-publications"/,
  )
  assert.throws(() => read("src/app/loading.tsx"), /ENOENT/)
})
