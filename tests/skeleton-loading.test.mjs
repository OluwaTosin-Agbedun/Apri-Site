/**
 * Route loading placeholders (src/components/PageSkeleton.tsx and every
 * src/app/** /loading.tsx), rendered with React's server renderer from their
 * own source: one status announcement, generic shapes only, still for readers
 * who ask for reduced motion, mobile-first layout, nothing imported that could
 * read data or start work, the right placeholder for each kind of page, and --
 * with React's real streaming renderer, in a stream shaped like Next.js's --
 * what a reader without JavaScript is left with when a page arrives, fails or
 * is not found.
 *
 * No database, no network, no browser. The timing of a real Next.js stream
 * (and its HTTP status codes) was checked by hand in a local sandbox; see
 * docs/skeleton-loading.md.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { registerHooks, createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import ts from "typescript"
import { createElement, Suspense } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const SRC = join(ROOT, "src")
const APP = join(SRC, "app")
const read = (p) => readFileSync(join(ROOT, p), "utf8")
const posix = (p) => p.split(sep).join("/")
/** Source without its comments, so explanations of what code never does are not mistaken for code. */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const base = join(SRC, specifier.slice(2))
      for (const candidate of [`${base}.tsx`, `${base}.ts`, base]) {
        if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, context)
    const path = fileURLToPath(url)
    const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    return { format: "module", source: outputText, shortCircuit: true }
  },
})

// ---------------------------------------------------------------------------
// The files under test
// ---------------------------------------------------------------------------

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, found)
    else found.push(path)
  }
  return found
}

const appFiles = walk(APP)
const loadingFiles = appFiles.filter((f) => /[\\/]loading\.(tsx|ts|jsx|js)$/.test(f)).map((f) => posix(relative(ROOT, f))).sort()
const pageFiles = appFiles.filter((f) => /[\\/]page\.(tsx|ts|jsx|js)$/.test(f))

/**
 * The loading files this stage adds, and the placeholder each must show.
 *
 * Only the subscriber portal and the Complimentary Review library stream a
 * placeholder. Once a loading boundary streams, Next.js has already sent
 * 200 OK, so a page under it can no longer answer 404, 307 or 500
 * (node_modules/next/dist/docs/01-app/02-guides/streaming.md, "The HTTP
 * contract"). A site-wide or Admin boundary would turn real not-found pages,
 * sign-in redirects and errors into 200 responses for the whole site.
 */
const EXPECTED_LOADING = {
  "src/app/portal/loading.tsx": "<PortalLibrarySkeleton />",
  "src/app/portal/sign-in/loading.tsx": '<SignInSkeleton header="compact" />',
  "src/app/portal/verify/continue/loading.tsx": '<SignInSkeleton header="compact" />',
  "src/app/portal/document/[id]/loading.tsx": "<DocumentViewerSkeleton />",
  "src/app/review/library/loading.tsx": "<ReviewLibrarySkeleton />",
  "src/app/review/library/sign-in/loading.tsx": '<SignInSkeleton header="site" />',
}

/** Where a loading boundary may sit: the portal and the Review Library only. */
const ALLOWED_BOUNDARY_ROOTS = ["src/app/portal/", "src/app/review/library/"]

/** The placeholders the module exports, and the marker each renders. */
const PLACEHOLDERS = {
  PortalLibrarySkeleton: "portal",
  DocumentViewerSkeleton: "document",
  ReviewLibrarySkeleton: "review-library",
  SignInSkeleton: "sign-in",
}

/** The only status announcements a placeholder may make: fixed text, no data. */
const STATUS_LABELS = ["Loading page…", "Loading your library…", "Loading document…", "Loading your review library…"]

const skeletons = await import("../src/components/PageSkeleton.tsx")
const loadingModules = Object.fromEntries(
  await Promise.all(loadingFiles.map(async (file) => [file, await import(pathToFileURL(join(ROOT, file)).href)])),
)
const rendered = Object.fromEntries(loadingFiles.map((file) => [file, renderToStaticMarkup(createElement(loadingModules[file].default))]))
const marker = (file) => rendered[file].match(/data-page-skeleton="([a-z-]+)"/)?.[1]

/** Every class attribute in a piece of markup, split into tokens. */
const classAttributes = (html) => [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(/\s+/).filter(Boolean))
/** The markup with the status announcement and the no-JavaScript block taken out. */
const shapesOnly = (html) => html.replace(/<p role="status"[^>]*>[^<]*<\/p>/, "").replace(/<noscript>[\s\S]*?<\/noscript>/g, "")

/**
 * Every module a source file loads: static imports with or without bindings
 * (one line or several), bare side-effect imports and re-exports. Dynamic
 * import() and require() are checked separately.
 */
const moduleSpecifiers = (source) =>
  [...withoutComments(source).matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2])

// Values a placeholder must never show. Invented, in the shapes real data has.
const FORBIDDEN_TEXT = [/@/, /https?:/i, /papermark/i, /\bpl_|\bdoc_|\broom_/i, /Monthly Intelligence Note|Athena Intelligence Update|Political Landscape Monitor/i, /\bMIN\b|\bAIU\b|\bPLM\b/, /\d{4}-\d{2}-\d{2}/, /Signed in as|Access until|documents? issued/i]

/** The exact no-JavaScript block every placeholder carries. */
const NO_SCRIPT_BLOCK =
  `<noscript><style>${skeletons.NO_SCRIPT_REVEAL_CSS}</style>` +
  `<p class="border-b border-border px-6 py-3 text-center text-sm text-muted-foreground">${skeletons.NO_SCRIPT_NOTICE}</p></noscript>`

describe("the loading files", () => {
  it("include each one this stage adds, each showing the placeholder made for its pages", () => {
    for (const [file, element] of Object.entries(EXPECTED_LOADING)) {
      assert.ok(loadingFiles.includes(file), `${file} exists`)
      assert.ok(read(file).includes(`return ${element}`), `${file} should render ${element}`)
    }
  })

  it("each render one of the placeholders, including any added later", () => {
    for (const file of loadingFiles) {
      const used = read(file).match(/return <([A-Za-z]+)[ />]/)?.[1]
      assert.ok(used in PLACEHOLDERS, `${file} renders a placeholder from @/components/PageSkeleton (found ${used})`)
      assert.equal(marker(file), PLACEHOLDERS[used], `${file} shows the ${used} shape`)
    }
  })

  it("are static server components: no directive, no async work, no parameters, one import from the placeholder module", () => {
    for (const file of loadingFiles) {
      const source = read(file)
      const code = withoutComments(source)
      assert.deepEqual(moduleSpecifiers(source), ["@/components/PageSkeleton"], `${file} loads only the placeholder module`)
      assert.match(code, /^import \{ [A-Za-z]+Skeleton \} from "@\/components\/PageSkeleton"$/m, `${file} imports one placeholder by name`)
      assert.doesNotMatch(code, /\bimport\s*\(|\brequire\s*\(/, `${file} loads nothing at run time`)
      assert.doesNotMatch(code, /["']use (client|server)["']/, `${file} has no directive`)
      assert.doesNotMatch(code, /\basync\b|\bawait\b|\bfetch\s*\(|\bcookies\s*\(|\bheaders\s*\(|setTimeout|\bcatch\b/, `${file} does no work`)
      assert.match(code, /export default function Loading\(\)/, `${file} takes no parameters`)
      assert.equal(loadingModules[file].default.length, 0)
      assert.deepEqual(Object.keys(loadingModules[file]), ["default"], `${file} exports only the component`)
    }
  })
})

describe("the placeholder module's source", () => {
  const source = read("src/components/PageSkeleton.tsx")
  // The code itself, without the comments that explain what it never does.
  const code = withoutComments(source)

  it("imports nothing but React's types: no data, session, Papermark, email or repair-job module can run", () => {
    assert.deepEqual(moduleSpecifiers(source), ["react"])
    assert.match(code, /^import type \{ ReactNode \} from "react"$/m)
    assert.doesNotMatch(code, /\brequire\s*\(|\bimport\s*\(/)
  })

  it("is a server component that does no work and reads nothing", () => {
    assert.doesNotMatch(code, /["']use (client|server)["']/)
    assert.doesNotMatch(code, /\basync\b|\bawait\b|\bfetch\s*\(|cookies\(|headers\(|searchParams|params\b|process\.env|setTimeout|setInterval|useEffect|useState|localStorage|sessionStorage|document\.|window\./)
    assert.doesNotMatch(code, /@\/lib|@\/app|next\/|server-only|papermark|resend|getSql|neon/i)
  })

  it("has no inline style, no image and no link", () => {
    assert.doesNotMatch(code, /style=\{/)
    assert.doesNotMatch(code, /<img|<Image|<a\s|<Link|href=/)
  })

  it("exports only layout-level props: the sign-in placeholder's header choice", () => {
    for (const name of ["PortalLibrarySkeleton", "DocumentViewerSkeleton", "ReviewLibrarySkeleton"]) {
      assert.match(source, new RegExp(`export function ${name}\\(\\)`), `${name} takes no props`)
    }
    assert.match(source, /export function SignInSkeleton\(\{ header = "compact" \}: \{ header\?: "compact" \| "site" \}\)/)
    assert.equal(skeletons.default, undefined, "no default placeholder: each boundary names its shape")
    assert.equal(skeletons.PublicPageSkeleton, undefined, "no public-page placeholder")
    assert.equal(skeletons.AdminSkeleton, undefined, "no admin placeholder")
  })

  it("types the status label as the fixed set of announcements", () => {
    const union = source.match(/type LoadingLabel = ([^\n]+)/)?.[1]
    assert.ok(union, "LoadingLabel is declared")
    assert.deepEqual(union.split(" | ").map((s) => JSON.parse(s)), STATUS_LABELS)
    assert.match(source, /label: LoadingLabel/)
  })

  it("keeps the no-JavaScript notice fixed and free of data", () => {
    assert.equal(typeof skeletons.NO_SCRIPT_NOTICE, "string")
    assert.match(skeletons.NO_SCRIPT_NOTICE, /could not be loaded/)
    for (const pattern of FORBIDDEN_TEXT) assert.doesNotMatch(skeletons.NO_SCRIPT_NOTICE, pattern)
  })
})

describe("each placeholder as rendered", () => {
  for (const file of loadingFiles) {
    describe(file, () => {
      const html = rendered[file]

      it("announces loading exactly once, politely, in fixed visually hidden text with no data", () => {
        const statuses = [...html.matchAll(/role="status"/g)]
        assert.equal(statuses.length, 1)
        const label = html.match(/<p role="status" class="sr-only">([^<]*)<\/p>/)?.[1]
        assert.ok(STATUS_LABELS.includes(label), `status text "${label}" is one of the fixed announcements`)
        for (const pattern of FORBIDDEN_TEXT) assert.doesNotMatch(label, pattern)
        assert.doesNotMatch(html, /role="alert"|aria-live="assertive"/)
        // The status text is fixed: nothing in the placeholder changes it.
        assert.doesNotMatch(html, /aria-live=/)
      })

      it("marks only the decorative shapes busy and hides them from assistive technology", () => {
        assert.match(html, /<div aria-busy="true" class="motion-safe:animate-pulse"><div aria-hidden="true" class="min-h-screen[^"]*">/)
        // The status is not inside the busy region, which would hold it back.
        const status = html.indexOf('role="status"')
        const busy = html.indexOf('aria-busy="true"')
        assert.ok(status > -1 && busy > status)
        assert.equal([...html.matchAll(/aria-busy="true"/g)].length, 1)
      })

      it("shows no words and no data: generic shapes only", () => {
        const shapes = shapesOnly(html)
        const text = shapes.replace(/<[^>]+>/g, "").trim()
        assert.equal(text, "", "no visible text at all")
        for (const pattern of FORBIDDEN_TEXT) assert.doesNotMatch(shapes, pattern)
        assert.doesNotMatch(html, /<a\s|<img|<input|<button|<form|<select|<textarea|<iframe|href=|src=/)
        assert.doesNotMatch(html, /\bdata-(?!page-skeleton)[a-z-]+=/, "no data attributes besides the placeholder marker")
      })

      it("is still for readers who ask for reduced motion: the only animation is motion-safe", () => {
        for (const tokens of classAttributes(html)) {
          for (const token of tokens) {
            if (/(^|:)animate-/.test(token)) assert.equal(token, "motion-safe:animate-pulse", `unexpected animation ${token}`)
            assert.doesNotMatch(token, /(^|:)(transition|duration-|ease-|delay-)/, `no transitions: ${token}`)
          }
        }
        assert.doesNotMatch(html, /@keyframes|animation:|transition:/)
      })

      it("is mobile first: one column before a breakpoint, no fixed widths a phone cannot hold, no inline styles", () => {
        assert.doesNotMatch(html, /style="/)
        // Tailwind's named container widths start at 16rem (3xs), wider than
        // a 320px phone allows once the gutters are taken off.
        const NAMED_WIDTH = /^(3xs|2xs|xs|sm|md|lg|xl|[2-7]xl|screen)$/
        for (const tokens of classAttributes(html)) {
          const givesWay = tokens.includes("max-w-full") || tokens.includes("hidden")
          for (const token of tokens) {
            assert.doesNotMatch(token, /^(min-)?(w|size)-\[/, `no arbitrary widths: ${token}`)
            if (/\d+px/.test(token)) assert.match(token, /^max-w-\[\d+px\]$/, `pixels only as a maximum width: ${token}`)
            const columns = token.match(/^grid-cols-(\d+)$/)
            if (columns) assert.equal(columns[1], "1", `unprefixed grids are one column: ${token}`)
            // A wide fixed width (over 10rem) must give way on a narrow
            // screen. A minimum width cannot be capped by max-w-full, so a
            // wide one must be hidden on phones.
            const fixed = token.match(/^(min-w|w|size)-(.+)$/)
            if (!fixed) continue
            const [, property, value] = fixed
            const wide = (/^\d+(\.\d+)?$/.test(value) && Number(value) > 40) || NAMED_WIDTH.test(value)
            if (!wide) continue
            if (property === "min-w") assert.ok(tokens.includes("hidden"), `${token} forces its width on phones`)
            else assert.ok(givesWay, `${token} needs max-w-full or to be hidden on phones`)
          }
        }
        assert.match(html, /^<div data-page-skeleton="[a-z-]+" class="bg-background">/)
        // The page shell's layout sits on the element holding the shapes, so
        // a flex shell (portal, sign-in) lays out the shapes themselves.
        const shell = html.match(/<div aria-hidden="true" class="([^"]*)">/)[1].split(" ")
        assert.equal(shell[0], "min-h-screen")
        const outerShell = html.match(/^<div data-page-skeleton="[a-z-]+" class="([^"]*)">/)[1]
        assert.doesNotMatch(outerShell, /\bflex\b|\bgrid\b/, "the wrappers never carry the page layout")
      })

      it("carries the no-JavaScript rules and notice in one <noscript>, above the shapes, inside the placeholder", () => {
        const noscripts = [...html.matchAll(/<noscript>[\s\S]*?<\/noscript>/g)].map((m) => m[0])
        assert.deepEqual(noscripts, [NO_SCRIPT_BLOCK])
        // Above the shapes, so a reader without JavaScript sees the notice at
        // the top; inside the placeholder, so it is hidden with it.
        assert.ok(html.indexOf("<noscript>") < html.indexOf('aria-busy="true"'))
        assert.ok(html.endsWith("</div>") && html.indexOf("<noscript>") > html.indexOf("data-page-skeleton"))
      })
    })
  }

  it("gives each kind of destination its own shape", () => {
    assert.equal(marker("src/app/portal/loading.tsx"), "portal")
    assert.equal(marker("src/app/portal/document/[id]/loading.tsx"), "document")
    assert.equal(marker("src/app/review/library/loading.tsx"), "review-library")
    for (const file of ["src/app/portal/sign-in/loading.tsx", "src/app/review/library/sign-in/loading.tsx"]) {
      assert.equal(marker(file), "sign-in")
    }
  })

  it("matches the broad layout of the subscriber library: header, Latest card, search area, library shortcuts, sections", () => {
    const html = rendered["src/app/portal/loading.tsx"]
    assert.match(html, /border-b border-border/, "portal header")
    assert.match(html, /border-accent\/50/, "the featured Latest card")
    assert.match(html, /grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4/, "the four search fields")
    assert.match(html, /grid grid-cols-1 gap-3 md:grid-cols-3/, "the library shortcuts")
    assert.equal([...html.matchAll(/class="mb-16"/g)].length, 4, "the shortcuts and three library sections")
    assert.match(html, /max-w-\[1800px\] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12/, "the portal's page width and gutters")
  })

  it("matches the Review Library list: one column on phones, the action beside each entry from sm", () => {
    const html = rendered["src/app/review/library/loading.tsx"]
    assert.equal([...html.matchAll(/sm:grid-cols-\[1fr_auto\]/g)].length, 3)
    assert.match(html, /divide-y divide-border border-y border-border/)
    assert.match(html, /h-12 w-full bg-hairline sm:w-44/, "full-width action on phones")
  })

})

describe("which placeholder each page shows", () => {
  /** The nearest loading file above a page, as Next.js nests them. */
  function nearestLoading(page) {
    for (let dir = dirname(page); dir.startsWith(APP); dir = dirname(dir)) {
      const candidate = join(dir, "loading.tsx")
      if (existsSync(candidate)) return posix(relative(ROOT, candidate))
    }
    return null
  }
  /** The shape a page shows while it streams, from the placeholder as rendered. */
  const shown = (page) => marker(nearestLoading(page))

  it("places boundaries only under the portal and the Review Library, so every other page keeps real 404, 307 and 500 responses", () => {
    for (const file of loadingFiles) {
      assert.ok(ALLOWED_BOUNDARY_ROOTS.some((root) => file.startsWith(root)), `${file} would turn real status codes into 200 for the pages under it`)
    }
    for (const page of pageFiles) {
      const rel = posix(relative(ROOT, page))
      const covered = ALLOWED_BOUNDARY_ROOTS.some((root) => rel.startsWith(root))
      assert.equal(Boolean(nearestLoading(page)), covered, rel)
    }
  })

  it("leaves public pages and the admin console without a placeholder", () => {
    for (const page of ["src/app/page.tsx", "src/app/publications/page.tsx", "src/app/access/page.tsx", "src/app/review/page.tsx", "src/app/admin/page.tsx", "src/app/admin/login/page.tsx"]) {
      assert.equal(nearestLoading(join(ROOT, page)), null, page)
    }
  })

  it("never shows the library shape on a sign-in step", () => {
    for (const page of ["src/app/portal/sign-in/page.tsx", "src/app/portal/verify/continue/page.tsx", "src/app/review/library/sign-in/page.tsx"]) {
      assert.equal(shown(join(ROOT, page)), "sign-in", page)
    }
  })

  it("shows the library, document and Review Library shapes where they belong", () => {
    assert.equal(shown(join(ROOT, "src/app/portal/page.tsx")), "portal")
    assert.equal(shown(join(ROOT, "src/app/portal/document/[id]/page.tsx")), "document")
    assert.equal(shown(join(ROOT, "src/app/review/library/page.tsx")), "review-library")
  })

  it("error and not-found boundaries, if any are added, are real messages and never a loading placeholder", () => {
    // None exist today (Next.js's built-in error and not-found screens are
    // used). One added later must say what happened, not keep loading.
    const boundaries = appFiles.filter((f) => /[\\/](error|global-error|not-found|forbidden|unauthorized|template)\.(tsx|ts|jsx|js)$/.test(f))
    for (const file of boundaries) {
      const source = readFileSync(file, "utf8")
      const name = posix(relative(ROOT, file))
      assert.ok(!moduleSpecifiers(source).includes("@/components/PageSkeleton"), `${name} is not a placeholder`)
      assert.doesNotMatch(source, /Skeleton|Loading[^"'`<]*…|aria-busy/, `${name} does not show a loading state`)
    }
  })
})

// ---------------------------------------------------------------------------
// Streaming, and what a reader without JavaScript is left with
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

/**
 * The streamed pieces in a document -- React's `<div hidden id="S:n">` -- with
 * the tag names of each one's direct child elements.
 */
function streamedPieces(html) {
  const pieces = []
  for (const open of html.matchAll(/<div hidden id="(S:[^"]+)">/g)) {
    const tags = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g
    tags.lastIndex = open.index + open[0].length
    const children = []
    let depth = 0
    for (let tag; (tag = tags.exec(html)); ) {
      if (tag[0].startsWith("<!--")) continue
      const [, closing, rawName, attributes] = tag
      const name = rawName.toLowerCase()
      if (closing) {
        if (depth === 0) break
        depth--
        continue
      }
      if (depth === 0) children.push(name)
      if (!VOID_ELEMENTS.has(name) && !attributes.trim().endsWith("/")) depth++
    }
    pieces.push({ id: open[1], children })
  }
  return pieces
}

/**
 * Whether, with scripting disabled, NO_SCRIPT_REVEAL_CSS hides the
 * placeholder in this document: some streamed piece has a direct child element
 * other than a <template>. This is the hiding rule's `:has()` argument, which
 * the first test below pins, so the two cannot drift apart.
 */
const noScriptHidesPlaceholder = (html) => streamedPieces(html).some((piece) => piece.children.some((child) => child !== "template"))

/** What Next.js sent with the shell in the local sandbox, before the page was ready. */
const NEXT_EARLY_PIECE = '<div hidden id="S:0"><template id="P:1"></template><!--$--><!--/$--></div>'

describe("without JavaScript", () => {
  it("the placeholder is hidden only by a streamed piece with real content, never by Next.js's early piece", () => {
    const rules = skeletons.NO_SCRIPT_REVEAL_CSS
    assert.match(rules, /^div\[hidden\]\[id\^="S:"\]\{display:block!important\}/, "every streamed piece is shown")
    // Tailwind's preflight hides [hidden] with !important inside its base
    // layer, which outranks any unlayered rule: the reveal must be repeated
    // there, more specifically, to win.
    assert.match(rules, /@layer base\{div\[hidden\]\[id\^="S:"\]\{display:block!important\}\}/)
    const hiding = [...rules.matchAll(/([^{}]*)\{display:none!important\}/g)].map((m) => m[1])
    assert.deepEqual(hiding, [':root:has(div[hidden][id^="S:"] > :not(template)) [data-page-skeleton]'], "the only hiding rule")

    assert.equal(noScriptHidesPlaceholder(NEXT_EARLY_PIECE), false, "Next.js's early piece holds only a template")
    assert.equal(noScriptHidesPlaceholder(`${NEXT_EARLY_PIECE}<div hidden id="S:1"><main>Invented page</main></div>`), true)
    assert.equal(noScriptHidesPlaceholder('<div hidden id="S:1"><br/><p>Invented</p></div>'), true)
    assert.equal(noScriptHidesPlaceholder('<div hidden=""><!--$--><!--/$--></div>'), false, "Next.js's unnamed hidden div is not a streamed piece")
  })

  it("the reveal outranks Tailwind's own [hidden] rule: same base layer, more specific selector", () => {
    // The site imports Tailwind whole (src/app/globals.css), whose base layer
    // hides [hidden] with !important. If that rule moved layer or gained
    // specificity, the no-JavaScript reveal would need revisiting.
    assert.match(read("src/app/globals.css"), /^@import 'tailwindcss';/m)
    const tailwind = readFileSync(createRequire(join(ROOT, "package.json")).resolve("tailwindcss/index.css"), "utf8")
    const base = tailwind.slice(tailwind.indexOf("@layer base {"))
    assert.match(base.slice(0, base.indexOf("@layer utilities")), /\[hidden\]:where\(:not\(\[hidden="until-found"\]\)\) \{\s*display: none !important;/)
  })
})

describe("with React's streaming renderer, in a stream shaped like Next.js's", () => {
  // The renderers Next.js runs (its bundled copy) and the project's own.
  const require = createRequire(join(ROOT, "package.json"))
  const renderers = [
    ["Next.js's bundled React", require("next/dist/compiled/react"), require("next/dist/compiled/react-dom/server.edge")],
    ["the project's React", { createElement, Suspense }, require("react-dom/server.edge")],
  ]

  /**
   * Streams a page under a placeholder, as Next.js nests a page under its
   * folder's loading.tsx: the page beside an already-finished boundary, which
   * makes React send the boundary's first piece (S:0, a template where the
   * page will go) before the page is ready -- exactly what the sandbox showed
   * Next.js sending with the shell. Returns what had arrived before the page
   * was ready and the whole document.
   */
  async function stream(React, Server, Placeholder, outcome) {
    let release
    const ready = new Promise((ok) => (release = ok))
    async function Page() {
      await ready
      if (outcome === "fail") throw new Error("invented failure")
      return React.createElement("main", null, "Invented page")
    }
    const tree = React.createElement("html", null, React.createElement("body", null,
      React.createElement(React.Suspense, { fallback: React.createElement(Placeholder) },
        React.createElement(Page),
        React.createElement(React.Suspense, { fallback: null }, null))))
    const errors = []
    const body = await Server.renderToReadableStream(tree, { onError: (error) => { errors.push(error.message) } })
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let early = ""
    try {
      // Everything sent before the page is ready: the shell with the
      // placeholder, then the boundary's first piece.
      const arrived = (async () => {
        while (!(early.includes("<!--/$-->") && /<div hidden id="S:0">[\s\S]*?<\/div>/.test(early))) {
          const { done, value } = await reader.read()
          assert.equal(done, false, "the shell and the first piece arrive before the page")
          early += decoder.decode(value, { stream: true })
        }
      })()
      let timer
      await Promise.race([arrived, new Promise((_, fail) => { timer = setTimeout(() => fail(new Error("the first piece never arrived")), 2000) })])
      clearTimeout(timer)
    } finally {
      release()
    }
    let html = early
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
    }
    return { early, html, errors }
  }

  for (const [label, React, Server] of renderers) {
    it(`${label}: before the page is ready, the placeholder shows -- with or without JavaScript`, async () => {
      const { early } = await stream(React, Server, skeletons.PortalLibrarySkeleton, "ok")
      assert.match(early, /data-page-skeleton="portal"/)
      assert.equal([...early.matchAll(/role="status"/g)].length, 1)
      assert.ok(early.includes(NO_SCRIPT_BLOCK), "the no-JavaScript rules and notice arrive with the placeholder")
      assert.doesNotMatch(early, /Invented page/)
      // Next.js's early piece is there, holding only a template...
      assert.deepEqual(streamedPieces(early), [{ id: "S:0", children: ["template"] }])
      // ...and it does not hide the placeholder.
      assert.equal(noScriptHidesPlaceholder(early), false, "without JavaScript the placeholder stays while the page loads")
    })

    it(`${label}: when the page arrives, the no-JavaScript rules show it and hide the placeholder`, async () => {
      const { html, errors } = await stream(React, Server, skeletons.PortalLibrarySkeleton, "ok")
      assert.deepEqual(errors, [])
      const page = streamedPieces(html).find((piece) => piece.children.includes("main"))
      assert.ok(page, "the page arrives in a streamed piece")
      assert.ok(page.id.startsWith("S:"), `piece ${page.id} matches div[hidden][id^="S:"]`)
      assert.match(html, new RegExp(`<div hidden id="${page.id}"><main>Invented page</main></div>`))
      assert.equal(noScriptHidesPlaceholder(html), true)
    })

    it(`${label}: when the page fails, the error is reported; with JavaScript React renders the boundary in the browser; without it the placeholder stays with its notice, never a blank page`, async () => {
      const { html, errors } = await stream(React, Server, skeletons.PortalLibrarySkeleton, "fail")
      assert.deepEqual(errors, ["invented failure"], "the failure is reported to the server's error handler")
      // With JavaScript: React's client-render instruction, which hands the
      // boundary to the browser, where the error reaches Next.js's handling.
      assert.match(html, /\$RX/)
      // Without JavaScript: no piece with content arrives, so the placeholder
      // is not hidden, and the notice says the page could not be loaded.
      assert.doesNotMatch(html, /Invented page/)
      assert.equal(noScriptHidesPlaceholder(html), false)
      assert.match(html, /data-page-skeleton="portal"/)
      assert.ok(html.includes(skeletons.NO_SCRIPT_NOTICE))
    })
  }
})
