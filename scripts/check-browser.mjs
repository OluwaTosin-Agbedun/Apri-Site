#!/usr/bin/env node
/** Production-build acceptance on invented data only. No provider credentials. */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { request as httpRequest } from "node:http"
import { mkdir, readFile, writeFile, access } from "node:fs/promises"
import { createWriteStream } from "node:fs"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { chromium } from "playwright"
import { startTestDatabase } from "../tests/support/test-database.mjs"
import { seedBrowserData } from "../tests/support/browser-fixtures.mjs"
const root = resolve(import.meta.dirname, "..")
const output = resolve(root, "browser-results")
await mkdir(output, { recursive: true })
for (const name of [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
]) {
  let exists = false
  try {
    await access(resolve(root, name))
    exists = true
  } catch {}
  if (exists)
    throw new Error(
      `Run browser checks in a clean checkout without ${name}; real credentials must never enter test processes.`,
    )
}
const isolated = await startTestDatabase()
const secret = randomBytes(32).toString("hex")
let fixtures
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(DATABASE_URL|POSTGRES|PG[A-Z]*$|NEON|PAPERMARK|RESEND|SESSION_SECRET|CRON_SECRET|BLOB_|VERCEL_|APP_URL|PUBLIC_SITE_URL|SITE_REDIRECTS_ENABLED|NODE_OPTIONS|DATAROOM_NEW_DOCUMENT_EMAILS)/.test(
        key,
      ) && !/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key),
  ),
)
Object.assign(env, {
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: isolated.databaseUrl,
  APRI_TEST_DB_ENDPOINT: isolated.endpoint,
  SESSION_SECRET: secret,
  PUBLIC_SITE_URL: "https://athenaadvisory.ng",
  NODE_OPTIONS: `--import ${fileURLToPath(new URL("../tests/support/browser-preload.mjs", import.meta.url))}`,
})
const report = {
  http: [],
  browser: [],
  identity: [],
  accessibility: [],
  performance: [],
  limitations: [
    "Invented data and isolated database; no real Papermark or Resend calls.",
    "Lab measurements are not real-user Core Web Vitals or a WCAG conformance certificate.",
  ],
}
let server, browser
async function command(args, name) {
  const log = createWriteStream(resolve(output, `${name}.log`))
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  const code = await new Promise((ok, no) => {
    child.once("error", no)
    child.once("exit", (code) => ok(code))
  })
  log.end()
  assert.equal(code, 0, `${name} failed; inspect browser-results/${name}.log`)
}
async function port() {
  const s = createServer()
  await new Promise((ok) => s.listen(0, "127.0.0.1", ok))
  const value = s.address().port
  await new Promise((ok) => s.close(ok))
  return value
}
const number = await port()
const origin = `http://127.0.0.1:${number}`
async function request(path, options = {}) {
  // Native HTTP preserves an explicit Host header; Node's fetch intentionally
  // replaces it with the loopback URL's host and cannot test canonical-host policy.
  return new Promise((ok,no)=>{
    const req=httpRequest(origin+path, {method:options.method??"GET",headers:options.headers??{}},res=>{
      const chunks=[];res.on("data",chunk=>chunks.push(chunk));res.on("end",()=>{
        const headers=new Headers();for(const [key,value]of Object.entries(res.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(", "):value)
        ok(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}))
      })
    });req.once("error",no);req.end(options.body)
  })
}
const record = (name) => {
  report.http.push({ name, status: "PASS" })
  console.log(`HTTP PASS: ${name}`)
}
try {
  fixtures = await seedBrowserData(isolated, secret)
  await command(
    ["node_modules/next/dist/bin/next", "build", "--webpack"],
    "production-build",
  )
  const log = createWriteStream(resolve(output, "server.log"))
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(number),
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  )
  server.stdout.pipe(log)
  server.stderr.pipe(log)
  let ready = false
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) break
    try {
      if ((await request("/")).status === 200) {
        ready = true
        break
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 250))
  }
  assert.ok(
    ready,
    "Local production server did not start; inspect browser-results/server.log",
  )
  const publicPaths = [
    "/",
    "/publications",
    "/services",
    "/team",
    "/access",
    "/review",
    "/request-briefing",
  ]
  const titles = [],
    descriptions = []
  const internal = new Set()
  for (const path of publicPaths) {
    const response = await request(path, {
      headers: { host: "athenaadvisory.ng" },
    })
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, path)
    assert.ok(
      html.includes(
        `rel="canonical" href="https://athenaadvisory.ng${
          path === "/" ? "" : path
        }"`,
      ),
      `Canonical missing: ${path}`,
    )
    assert.doesNotMatch(response.headers.get("x-robots-tag") ?? "", /noindex/)
    titles.push(html.match(/<title>([^<]+)<\/title>/)?.[1])
    descriptions.push(html.match(/name="description" content="([^"]+)"/)?.[1])
    assert.doesNotMatch(html, /(?:src|href)="http:\/\//)
    for (const [, href] of html.matchAll(/href="([^"#][^"]*)"/g))
      if (
        href.startsWith("/") &&
        !href.startsWith("//") &&
        !href.startsWith("/_next")
      )
        internal.add(href.replaceAll("&amp;", "&"))
    record(`Public SEO and HTTP status ${path}`)
  }
  assert.equal(new Set(titles).size, publicPaths.length)
  assert.equal(new Set(descriptions).size, publicPaths.length)
  const social = await request("/opengraph-image")
  assert.equal(social.status, 200)
  assert.match(social.headers.get("content-type"), /image\/png/)
  await writeFile(resolve(output, "apra-social-preview.png"), Buffer.from(await social.arrayBuffer()))
  record("Athena Strategic Advisory social preview generated")
  for (const href of internal) {
    const target = new URL(href, origin)
    const response = await request(target.pathname + target.search)
    assert.ok(
      response.status < 400,
      `Broken internal link ${target.pathname} (${response.status})`,
    )
    if (target.hash && response.status === 200) {
      const html = await response.text()
      assert.ok(
        html.includes(`id="${decodeURIComponent(target.hash.slice(1))}"`),
        `Missing anchor ${target.pathname}${target.hash}`,
      )
    }
  }
  record(`Internal links and anchors (${internal.size})`)
  const sitemap = await request("/sitemap.xml")
  const xml = await sitemap.text()
  assert.equal((xml.match(/<loc>/g) ?? []).length, publicPaths.length)
  assert.doesNotMatch(xml, /portal|admin|token=|library/)
  record("Sitemap allowlist")
  assert.match(
    await (await request("/robots.txt")).text(),
    /Disallow: \/portal/,
  )
  record("Robots boundary")
  const missing = await request("/this-page-is-not-real")
  assert.equal(missing.status, 404)
  record("Genuine 404 status")
  const detail = await request(`/publications/browser-edition-1`)
  assert.equal(detail.status, 200)
  assert.match(detail.headers.get("x-robots-tag"), /noindex/)
  record("Publication details excluded from search")
  for (const path of ["/portal", "/review/library", "/admin/notifications"]) {
    const response = await request(path)
    if (response.status === 200) {
      // Route-local skeletons can flush before Next emits a redirect. The
      // response must contain a sign-in redirect and no private reader data.
      const html = await response.text()
      assert.match(html, /NEXT_REDIRECT/)
      assert.match(html, /sign-in|admin\/login/)
      assert.doesNotMatch(html, /Test Reader|browser-reader-|browser-review@/)
    } else assert.ok([303, 307].includes(response.status), path)
    assert.match(response.headers.get("cache-control"), /private.*no-store/)
    assert.match(response.headers.get("x-robots-tag"), /noindex/)
  }
  record("Private journeys refuse missing sessions and are never shared-cached")
  if (process.argv.includes("--http-only")) {
    report.limitations.push(
      "Browser, keyboard, visual, accessibility and performance checks were not run in HTTP-only mode.",
    )
    console.log("HTTP-only checks complete; browser checks NOT VERIFIED")
  } else {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.APRI_CHROMIUM_PATH
        ? { executablePath: process.env.APRI_CHROMIUM_PATH }
        : {}),
    })
    const axe = await readFile(
      resolve(root, "node_modules/axe-core/axe.min.js"),
      "utf8",
    )
    const blocked = []
    async function context(width, cookie) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      })
      if (cookie)
        await context.addCookies([
          {
            name: cookie.name,
            value: cookie.value,
            url: origin,
            httpOnly: true,
            sameSite: "Lax",
          },
        ])
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url())
        if (url.origin === origin) return route.continue()
        if (url.hostname === "docs.athenacentre.org")
          return route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><html lang='en'><head><title>Test viewer</title></head><body><h1>Invented protected viewer</h1></body></html>",
          })
        // Vercel's optional public analytics are intentionally absent locally.
        blocked.push(url.origin)
        return route.abort()
      })
      return context
    }
    async function audit(page, path, width, label) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(origin + path)
      await page.waitForLoadState("networkidle")
      const errors = await page.evaluate(() => ({
        viewportWidth: innerWidth,
        h1: document.querySelectorAll("h1").length,
        main: document.querySelectorAll("main").length,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        images: [...document.images].filter((img) => !img.hasAttribute("alt"))
          .length,
      }))
      const visibleText = await page.locator("body").innerText()
      assert.doesNotMatch(visibleText, /\bAPRI\b|Athena\s+Political\s+(?:&|and)\s+Regulatory\s+Intelligence/i, `${label}: former platform name remains visible`)
      assert.match(await page.title(), /Athena Strategic Advisory/, `${label}: current identity missing from title`)
      const links = await page.locator('a[href^="http"]').evaluateAll(nodes => nodes.map(node => node.href))
      assert.ok(!links.some(href => new URL(href).hostname === "apri.athenacentre.org"), `${label}: old website link remains`)
      report.identity.push({ label, width, status: "PASS" })
      assert.deepEqual(
        errors,
        { viewportWidth: width, h1: 1, main: 1, overflow: false, images: 0 },
        `${label} at ${width}px`,
      )
      await page.addScriptTag({ content: axe })
      const results = await page.evaluate(() =>
        window.axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
          },
        }),
      )
      report.accessibility.push({
        path,
        width,
        label,
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({target:n.target,html:n.html,reason:n.failureSummary})),
        })),
      })
      await page.screenshot({
        path: resolve(output, `${label}-${width}.png`),
        fullPage: true,
      })
      const status=results.violations.length?"FAIL":"PASS"
      report.browser.push({ label, width, status })
      console.log(`Browser ${status}: ${label} at ${width}px`)
    }
    for (const width of [375, 768, 1440]) {
      const ctx = await context(width)
      const page = await ctx.newPage()
      for (const path of publicPaths)
        await audit(page, path, width, path === "/" ? "home" : path.slice(1))
      await page.goto(origin + "/")
      await page.keyboard.press("Tab")
      assert.equal(
        await page.locator(":focus").textContent(),
        "Skip to main content",
      )
      await page.keyboard.press("Enter")
      assert.equal(
        await page.locator(":focus").getAttribute("id"),
        "main-content",
      )
      if (width < 1280) {
        const menu = page.getByRole("button", { name: /^(Menu|Close navigation menu)$/ })
        await menu.click()
        assert.equal(await menu.getAttribute("aria-expanded"), "true")
        await page
          .getByRole("navigation", { name: "Mobile navigation" })
          .getByRole("link")
          .first()
          .focus()
        await page.keyboard.press("Escape")
        assert.equal(await menu.getAttribute("aria-expanded"), "false")
        assert.equal(
          await menu.evaluate((e) => e === document.activeElement),
          true,
        )
      }
      await ctx.close()
    }
    const anonymous = await context(375)
    const signIn = await anonymous.newPage()
    for (const path of ["/portal/sign-in", "/review/library/sign-in", "/admin/login"]) {
      await audit(signIn, path, 375, path.replaceAll("/", "-").slice(1))
      assert.equal(new URL(signIn.url()).pathname, path, "Sign-in audit must reach the requested screen")
    }
    await anonymous.close()
    for (const [index, value] of fixtures.cookies.subscribers.entries()) {
      const width = index % 2 ? 375 : 1440
      const ctx = await context(width, { name: "apri_subscriber", value })
      const page = await ctx.newPage()
      await audit(page, "/portal", width, `subscriber-${index + 1}`)
      assert.match(await page.textContent("body"), /Test Reader/)
      if (index === 0) {
        await audit(page, `/portal/publication/${fixtures.publications[0].id}`, 375, "subscriber-document")
        await page.goto(origin + "/portal")
        await page.getByRole("searchbox").waitFor()
      }
      const search = page.getByRole("searchbox")
      await search.fill("unlikely-no-matches-query")
      assert.match(await page.textContent("main"), /No publications match/i)
      await page.getByRole("button", { name: "Clear filters" }).click()
      assert.equal(await search.inputValue(), "")
      await audit(
        page,
        "/portal/preferences",
        width,
        `preferences-${index + 1}`,
      )
      await page.getByRole("checkbox").uncheck()
      await page.getByRole("button", { name: /Save/ }).click()
      await page.getByRole("status").waitFor()
      assert.equal(
        (
          await fixtures.sql`select enabled from publication_notice_preferences where subscriber_id=${fixtures.readers[index].id}::uuid`
        )[0].enabled,
        false,
      )
      await ctx.close()
    }
    const reviewContext = await context(375, {
      name: "apri_review_reader",
      value: fixtures.cookies.review,
    })
    const review = await reviewContext.newPage()
    await audit(review, "/review/library", 375, "review-library")
    assert.equal(
      await review.getByRole("link", { name: /Read/ }).count(),
      fixtures.categories.length,
    )
    const removed = fixtures.editions[0]
    await fixtures.sql`update review_edition_recipients set revoked_at=now() where edition_id=${removed}::uuid`
    await review.reload()
    // App Router can finish navigation while its generic loading skeleton is
    // still on screen. Check the resolved library, not that transient shell.
    await review.getByRole("heading", { name: "Your review publications", exact: true }).waitFor()
    assert.equal(
      await review.getByRole("link", { name: /Read/ }).count(),
      fixtures.categories.length - 1,
    )
    await reviewContext.close()
    assert.equal((await fixtures.sql`select description from documents where id=${fixtures.publications[0].id}::uuid`)[0].description, "Saved APRI promotional description.", "branding presentation does not rewrite the source publication record")
    const adminContext = await context(1440, {
      name: "apri_session",
      value: fixtures.cookies.admin,
    })
    const admin = await adminContext.newPage()
    await audit(admin, "/admin/notifications", 1440, "admin-notifications")
    await audit(admin,`/admin/documents/${fixtures.workflowPublication}`,375,'admin-editorial-start')
    await admin.getByLabel('Reason or review decision',{exact:true}).fill('Start the controlled editorial browser acceptance record')
    await admin.getByRole('button',{name:'Start editorial record',exact:true}).click()
    await admin.getByText('Draft version details',{exact:true}).waitFor()
    await admin.getByLabel('Version label',{exact:true}).fill('1.0')
    await admin.getByLabel('Source / provenance',{exact:true}).fill('Official sources checked in this invented-data browser acceptance')
    await admin.getByRole('button',{name:'Save draft details',exact:true}).click()
    await admin.getByRole('status').filter({hasText:'Draft details saved'}).waitFor()
    await admin.getByLabel('Reason or review decision',{exact:true}).fill('Ready for owner approval of this exact PDF and editorial metadata')
    await admin.getByRole('button',{name:'Submit for review',exact:true}).click()
    await admin.getByRole('status').filter({hasText:'Submitted for editorial review'}).waitFor()
    await admin.getByLabel('Reason or review decision',{exact:true}).fill('Owner independently checked the exact publication source and metadata')
    await admin.getByLabel('Confirm your password',{exact:true}).fill(fixtures.staffPassword)
    await admin.getByRole('button',{name:'Approve editorial review',exact:true}).click()
    await admin.getByRole('status').filter({hasText:'Editorial review approved'}).waitFor()
    assert.equal((await fixtures.sql`select state from publication_workflows where document_id=${fixtures.workflowPublication}::uuid`)[0].state,'approved')
    assert.equal((await fixtures.sql`select paid_release_state from documents where id=${fixtures.workflowPublication}::uuid`)[0].paid_release_state,'withheld','editorial approval alone does not release reader access')
    await audit(admin,`/admin/documents/${fixtures.workflowPublication}`,1440,'admin-editorial-approved')
    await adminContext.close()
    const performanceContext = await context(375)
    const performancePage = await performanceContext.newPage()
    await performancePage.addInitScript(() => {
      window.__measurements = { lcp: 0, cls: 0, events: [] }
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          window.__measurements.lcp = e.startTime
      }).observe({ type: "largest-contentful-paint", buffered: true })
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (!e.hadRecentInput) window.__measurements.cls += e.value
      }).observe({ type: "layout-shift", buffered: true })
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (e.interactionId) window.__measurements.events.push(e.duration)
      }).observe({ type: "event", durationThreshold: 16, buffered: true })
    })
    await performancePage.goto(origin + "/")
    await performancePage.waitForLoadState("networkidle")
    await performancePage
      .getByRole("button", { name: "Menu",exact:true })
      .click()
    await performancePage.keyboard.press("Escape")
    const measured = await performancePage.evaluate(() => window.__measurements)
    report.performance.push({
      page: "/",
      viewport: 375,
      ...measured,
      interactionNote:
        "Observed click/Escape durations are a lab responsiveness sample; field INP remains NOT VERIFIED.",
    })
    assert.ok(
      measured.lcp > 0 && measured.lcp <= 2500,
      `Lab LCP ${measured.lcp}`,
    )
    assert.ok(measured.cls <= 0.1, `Lab CLS ${measured.cls}`)
    assert.ok(
      measured.events.every((d) => d <= 200),
      `Lab interactions ${measured.events}`,
    )
    await performanceContext.close()
    assert.deepEqual(blocked, [], "Unexpected external browser request")
    assert.deepEqual(report.accessibility.filter(result=>result.violations.length>0),[],"Accessibility findings must be fixed; see the saved report")
  }
  report.status = process.argv.includes("--http-only")
    ? "HTTP PASS; BROWSER NOT VERIFIED"
    : "PASS"
} catch (error) {
  report.status = "FAIL"
  report.error = String(error)
  process.exitCode = 1
  console.error(String(error))
} finally {
  await browser?.close().catch(() => {})
  if (server) {
    server.kill("SIGTERM")
    await new Promise((ok) => {
      if (server.exitCode !== null) return ok()
      server.once("exit", ok)
      setTimeout(() => {
        server.kill("SIGKILL")
        ok()
      }, 5000).unref()
    })
  }
  await isolated.stop()
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2),
  )
}
