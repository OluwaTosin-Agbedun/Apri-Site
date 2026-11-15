import type { ReactNode } from "react"

/**
 * Route loading placeholders, shown by the `loading.tsx` files while a page's
 * server work streams in.
 *
 * Rules every placeholder here keeps (tests/skeleton-loading.test.mjs):
 *
 *  - Generic shapes only. Nothing is read, so nothing can leak: no reader name
 *    or email, no publication title, count or access decision, no link. The
 *    components take no data props.
 *  - Static and side-effect free: a server component with no data, cookies,
 *    headers, Papermark, email or repair-job imports, so showing a placeholder
 *    can never start any of that work, and nothing is delayed on purpose.
 *  - One polite status announcement per placeholder. Its text never changes,
 *    so a screen reader hears it at most once. `aria-busy` marks the
 *    decorative shapes, never the status itself: on the live region it would
 *    tell a screen reader to hold the announcement back.
 *  - The gentle pulse runs only for readers who have not asked for reduced
 *    motion (`motion-safe:`); otherwise the shapes are still.
 *  - Mobile first: one column, widths as fractions with a `max-w-*` cap, the
 *    same page shells as the pages they stand in for.
 *
 * A placeholder only fills the gap while a page streams. In a browser with
 * JavaScript, the finished page replaces it whatever it says: an empty
 * library, a notice, a denial, a redirect to sign in, Next.js's not-found
 * screen or its error screen. Without JavaScript, see NO_SCRIPT_REVEAL_CSS:
 * a page that fails or is not found leaves the placeholder up, with a visible
 * notice saying the page could not be loaded.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Without JavaScript the browser cannot run React's inline swap scripts.
 * React sends each finished piece of the page as a `<div hidden id="S:n">`
 * after the placeholder, and Next.js sends its first piece, `S:0`, in the same
 * chunk as the placeholder: until the page is ready, `S:0` holds only a
 * `<template>` marking where the page will go. With scripting disabled -- and
 * only then, because a `<noscript>` is inert text otherwise, and React never
 * renders its children in the browser -- these rules:
 *
 *  - show every streamed piece;
 *  - hide the placeholder only once a piece holds real content (an element
 *    other than a `<template>`), which is when the page has arrived.
 *
 * A page that fails or calls notFound() sends no such piece: Next.js renders
 * the error or not-found screen in the browser, which needs JavaScript. The
 * placeholder then stays, with NO_SCRIPT_NOTICE above it, and the response is
 * still HTTP 200 (docs/skeleton-loading.md). A redirect arrives as a
 * `<meta http-equiv="refresh">`, which works without JavaScript after a
 * second. A browser without `:has()` drops only the hiding rule, so the
 * placeholder stays above the revealed page.
 *
 * The reveal is repeated inside Tailwind's `base` layer: Tailwind's own
 * `[hidden]{display:none!important}` lives there, and an important rule in a
 * layer outranks an unlayered one, so only a more specific rule in the same
 * layer can lift it. Streamed pieces appear in the order they arrived, which
 * can put a late piece (a form, say) below the footer: readable and usable,
 * not perfect. With JavaScript, none of this applies.
 *
 * The streamed markup is pinned by tests/skeleton-loading.test.mjs with a
 * stream shaped like Next.js's; if React ever changed it, the placeholder
 * would simply stay visible, with the notice.
 */
export const NO_SCRIPT_REVEAL_CSS =
  'div[hidden][id^="S:"]{display:block!important}' +
  '@layer base{div[hidden][id^="S:"]{display:block!important}}' +
  ':root:has(div[hidden][id^="S:"] > :not(template)) [data-page-skeleton]{display:none!important}'

/**
 * Shown only without JavaScript, above the shapes, and hidden with them once
 * the page arrives. Fixed text: it names no page, reader or publication.
 */
export const NO_SCRIPT_NOTICE = "If this page does not appear, it could not be loaded. Reload the page or go back."

/** The status announcements: fixed text, one per kind of destination. */
type LoadingLabel = "Loading page…" | "Loading your library…" | "Loading document…" | "Loading your review library…"

/** A placeholder line or block, in the site's quiet hairline grey. */
function Bar({ className }: { className: string }) {
  return <div className={`bg-hairline ${className}`} />
}

/**
 * The one announcement, the no-JavaScript rules and notice, and the decorative
 * shapes. `layout` is the page shell's own layout, applied to the element that
 * holds the shapes, so a flex shell lays out the shapes and not the wrappers.
 */
function SkeletonFrame({
  name,
  label,
  layout,
  children,
}: {
  name: string
  label: LoadingLabel
  layout: string
  children: ReactNode
}) {
  return (
    <div data-page-skeleton={name} className="bg-background">
      <p role="status" className="sr-only">
        {label}
      </p>
      <noscript>
        <style>{NO_SCRIPT_REVEAL_CSS}</style>
        <p className="border-b border-border px-6 py-3 text-center text-sm text-muted-foreground">{NO_SCRIPT_NOTICE}</p>
      </noscript>
      <div aria-busy="true" className="motion-safe:animate-pulse">
        <div aria-hidden="true" className={layout}>
          {children}
        </div>
      </div>
    </div>
  )
}

/** The public site header (SiteHeader): wordmark, navigation from xl, Menu below. */
function SiteHeaderShape() {
  return (
    <div className="border-b border-hairline bg-background">
      <div className="max-w-5xl lg:max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between gap-6 h-24">
          <div className="flex w-2/3 max-w-xs flex-col gap-2">
            <Bar className="h-5 w-16" />
            <Bar className="h-3 w-full" />
          </div>
          <div className="hidden xl:flex flex-1 items-center justify-end gap-7">
            {[0, 1, 2, 3, 4].map((item) => (
              <Bar key={item} className="h-3 w-24" />
            ))}
          </div>
          <Bar className="xl:hidden h-4 w-12" />
        </div>
      </div>
    </div>
  )
}

/** The portal's page width, as the portal pages set it. */
const PORTAL_SHELL = "w-full max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12"

/** The portal header (PortalHeader): wordmark and reader line, Sign out. */
function PortalHeaderShape() {
  return (
    <div className="border-b border-border">
      <div className={`${PORTAL_SHELL} py-5 flex items-start justify-between gap-4`}>
        <div className="min-w-0 flex-1">
          <Bar className="h-5 w-14" />
          <Bar className="mt-2 h-3 w-1/2 max-w-xs" />
        </div>
        <Bar className="h-4 w-14 shrink-0" />
      </div>
    </div>
  )
}

/** A card's text lines: label, title, two summary lines, date. */
function CardLines() {
  return (
    <>
      <Bar className="h-3 w-24" />
      <Bar className="mt-3 h-5 w-3/4" />
      <Bar className="mt-3 h-3 w-full" />
      <Bar className="mt-2 h-3 w-2/3" />
      <Bar className="mt-4 h-3 w-28" />
    </>
  )
}

/** A portal library card: text on the left, the View action beside it from sm. */
function PortalCardShape({ featured = false }: { featured?: boolean }) {
  return (
    <div className={`w-full border bg-card/30 p-5 sm:p-7 ${featured ? "border-accent/50" : "border-border"}`}>
      <div className="flex flex-col sm:flex-row sm:gap-6">
        <div className="min-w-0 flex-1">
          <CardLines />
        </div>
        <div className="mt-4 border-t border-border pt-4 sm:mt-0 sm:border-t-0 sm:pt-1">
          <Bar className="h-4 w-12" />
        </div>
      </div>
    </div>
  )
}

/** A labelled form field: label line over an empty input box. */
function FieldShape() {
  return (
    <div className="min-w-0">
      <Bar className="h-3 w-1/3" />
      <div className="mt-2 min-h-11 w-full border border-border bg-background" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placeholders, one per kind of destination
// ---------------------------------------------------------------------------

/**
 * The subscriber library (/portal): portal header, page heading, the Latest
 * card, the search area, the library shortcuts and the library sections.
 */
export function PortalLibrarySkeleton() {
  return (
    <SkeletonFrame name="portal" label="Loading your library…" layout="min-h-screen flex flex-col">
      <PortalHeaderShape />
      <div className={`flex-1 ${PORTAL_SHELL} py-10 sm:py-14`}>
        <Bar className="h-8 sm:h-9 w-1/2 max-w-xs" />
        <Bar className="mt-3 mb-8 h-4 w-2/3 max-w-sm" />

        <div className="mb-14">
          <Bar className="mb-5 h-3 w-16" />
          <PortalCardShape featured />
        </div>

        <div className="mb-10 border-y border-border py-6">
          <Bar className="h-6 sm:h-7 w-1/2 max-w-xs" />
          <Bar className="mt-3 h-3 w-full max-w-2xl" />
          <Bar className="mt-2 mb-5 h-3 w-3/4 max-w-xl" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((field) => (
              <FieldShape key={field} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
            <Bar className="h-3 w-1/2 max-w-xs" />
            <Bar className="h-3 w-20" />
          </div>
        </div>

        <div className="mb-16">
          <Bar className="mb-5 h-3 w-32" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[0, 1, 2].map((library) => (
              <div key={library} className="border border-border bg-card/20 p-5">
                <Bar className="h-3 w-10" />
                <Bar className="mt-3 h-5 w-3/4" />
                <Bar className="mt-3 h-3 w-20" />
              </div>
            ))}
          </div>
        </div>

        {[0, 1, 2].map((section) => (
          <div key={section} className="mb-16">
            <div className="mb-6 flex items-end justify-between gap-4 border-b border-border pb-4">
              <div className="min-w-0 flex-1">
                <Bar className="h-3 w-10" />
                <Bar className="mt-3 h-6 w-1/2 max-w-sm" />
              </div>
              <Bar className="h-3 w-16 shrink-0" />
            </div>
            <div className="grid grid-cols-1 gap-4">
              <PortalCardShape />
              <PortalCardShape />
            </div>
          </div>
        ))}
      </div>
    </SkeletonFrame>
  )
}

/** One subscriber document (/portal/document/…): back link, heading, the viewer. */
export function DocumentViewerSkeleton() {
  return (
    <SkeletonFrame name="document" label="Loading document…" layout="min-h-screen flex flex-col">
      <PortalHeaderShape />
      <div className={`flex-1 ${PORTAL_SHELL} py-8 sm:py-10`}>
        <Bar className="h-4 w-28" />
        <div className="mt-5 mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Bar className="h-3 w-24" />
            <Bar className="mt-3 h-8 sm:h-9 w-3/4 max-w-2xl" />
          </div>
          <Bar className="h-4 w-20 shrink-0" />
        </div>
        <div className="h-[60vh] sm:h-[calc(100dvh-14rem)] w-full border border-border bg-muted" />
      </div>
    </SkeletonFrame>
  )
}

/**
 * The Complimentary Review library (/review/library): site header, the page
 * heading with Sign out, the signed-in line and the list of publications.
 */
export function ReviewLibrarySkeleton() {
  return (
    <SkeletonFrame name="review-library" label="Loading your review library…" layout="min-h-screen">
      <SiteHeaderShape />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <div className="mb-10 sm:mb-12">
          <Bar className="h-3 w-40 max-w-full" />
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <Bar className="h-9 sm:h-10 w-3/4 max-w-md" />
            <Bar className="h-4 w-14" />
          </div>
          <Bar className="mt-4 h-3 w-full max-w-2xl" />
          <Bar className="mt-2 h-3 w-2/3 max-w-lg" />
        </div>
        <div className="divide-y divide-border border-y border-border">
          {[0, 1, 2].map((row) => (
            <div key={row} className="grid gap-4 py-7 sm:grid-cols-[1fr_auto] sm:items-center sm:py-8">
              <div className="min-w-0">
                <Bar className="h-3 w-32" />
                <Bar className="mt-3 h-7 w-3/4" />
                <Bar className="mt-2 h-3 w-1/3" />
                <Bar className="mt-4 h-3 w-full max-w-2xl" />
                <Bar className="mt-2 h-3 w-5/6 max-w-xl" />
              </div>
              <div className="h-12 w-full bg-hairline sm:w-44" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonFrame>
  )
}

/**
 * A sign-in or confirmation step: heading, introduction, one field and the
 * button, in the narrow column those pages use. `header` follows the page:
 * "compact" for the portal's own sign-in header, "site" for the public site
 * header (the Review Library sign-in).
 */
export function SignInSkeleton({ header = "compact" }: { header?: "compact" | "site" }) {
  const form = (
    <>
      <Bar className="h-8 sm:h-9 w-1/2" />
      <Bar className="mt-4 h-3 w-full" />
      <Bar className="mt-2 h-3 w-11/12" />
      <Bar className="mt-2 mb-8 h-3 w-2/3" />
      <FieldShape />
      <div className="mt-6 h-14 w-full bg-hairline" />
    </>
  )

  return (
    <SkeletonFrame name="sign-in" label="Loading page…" layout="min-h-screen flex flex-col">
      {header === "site" ? (
        <SiteHeaderShape />
      ) : (
        <div className="border-b border-border">
          <div className="max-w-md mx-auto px-6 h-20 flex items-center">
            <Bar className="h-5 w-14" />
          </div>
        </div>
      )}
      <div className="flex-1 max-w-md w-full mx-auto px-6 py-16">{form}</div>
    </SkeletonFrame>
  )
}
