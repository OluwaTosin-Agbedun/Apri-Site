# Skeleton loading

While a page's server work runs, Next.js shows that folder's `loading.tsx` placeholder and
swaps the real page in as soon as it is ready. The placeholders are in
`src/components/PageSkeleton.tsx`. They are generic grey shapes in the site's existing style,
with no data, links, names, titles or counts in them.

## Which placeholder each page shows

| Folder `loading.tsx` | Placeholder | Pages |
| --- | --- | --- |
| `src/app/portal/` | `PortalLibrarySkeleton` | `/portal`: header, Latest card, search area, library shortcuts, library sections |
| `src/app/portal/document/[id]/` | `DocumentViewerSkeleton` | One subscriber document |
| `src/app/portal/sign-in/`, `src/app/portal/verify/continue/` | `SignInSkeleton` (compact header) | Subscriber sign-in steps |
| `src/app/review/library/` | `ReviewLibrarySkeleton` | Complimentary Review library list |
| `src/app/review/library/sign-in/` | `SignInSkeleton` (site header) | Reader sign-in |

Only the subscriber portal and the Complimentary Review library have placeholders. Public
pages and the Admin console deliberately have none: a placeholder makes Next.js send
`200 OK` before the page has run, so a page under it can no longer answer with a real `404`,
`307` or `500` (see "HTTP status codes" below). A site-wide or Admin placeholder would do that
for every not-found page, sign-in redirect and error on the site, which hides real failures
from monitoring and from search engines. Adding one back is a single `loading.tsx`, if the
owner later accepts that trade-off.

A `loading.tsx` covers every page beneath its folder. The sign-in and document folders have
their own placeholders, so they never inherit the library shape.
`tests/skeleton-loading.test.mjs` checks this mapping for every page, and fails if a
`loading.tsx` appears outside `src/app/portal/` or `src/app/review/library/`. A new page
under those folders gets the placeholder of the nearest folder above it. If that shape is
wrong for the page, add a `loading.tsx` to the new folder: it must render one of the
placeholders in `PageSkeleton.tsx`. An `error.tsx` or `not-found.tsx`
may be added at any time. The tests only require that it says what happened, never a
loading placeholder.

## Rules the placeholders keep (tested)

- They are static server components. They import nothing that reads data or sessions, and
  nothing that calls Papermark, sends email or starts repair jobs. Showing one starts no work.
- There is no artificial delay. A Link prefetch of a dynamic page fetches only the
  placeholder, not the page. Checked locally: prefetching `/portal` ran no page code.
- Each one has exactly one `role="status"` with visually hidden text, which never changes, so
  it is announced once. The text is one of a fixed set: "Loading page…", "Loading your
  library…", "Loading document…" or "Loading your review library…". `aria-busy` is set on the
  decorative shapes only, never on the status: on the status it could hold the announcement
  back.
- The gentle pulse is `motion-safe:animate-pulse`, so it does not run for readers who ask for
  reduced motion.
- They are mobile first: one column below each breakpoint, fractional widths with caps, and
  no fixed pixel widths. A fixed width over 10rem, or a named container width (`w-lg`), must
  give way on phones. A wide minimum width (`min-w-96`) must be hidden on phones. There is no
  horizontal scroll at 320px.

## What still reaches the reader

A placeholder only fills the gap while a page streams. In a browser with JavaScript, every
real state still replaces it: empty library, preparation notices, ended or suspended access,
sign-in redirects, Next.js's "page could not be found" screen and its error screen (the app
has no `error.tsx` or `not-found.tsx` of its own). Checked locally: a page that threw, and an
unknown publication, both replaced the placeholder with Next.js's screen.

Without JavaScript the outcome depends on what the page does (see "No JavaScript" below): a
page that loads is shown, a redirect follows after a second, and a page that fails or is not
found leaves the placeholder up with a short notice, "If this page does not appear, it could
not be loaded. Reload the page or go back." The 404 or error screen is never shown without
JavaScript, because Next.js renders it in the browser.

## Trade-offs (built into Next.js and React, not added here)

- **HTTP status codes.** Once a placeholder has been sent, the response is already `200`
  (Next.js docs, `02-guides/streaming.md`, "The HTTP contract"). For any page under a
  placeholder:
  - a redirect (`307`) becomes a `200` with a client-side redirect; without JavaScript, a
    `<meta http-equiv="refresh">` that waits 1 second;
  - a `notFound()` (`404`) becomes a `200` with `noindex`;
  - a server failure (`500`) becomes a `200`; with JavaScript the reader sees Next.js's
    error screen.

  This is why placeholders are limited to `/portal` and `/review/library`. The local sandbox
  (`next dev`), run while a site-wide placeholder still existed, showed it for `/portal`,
  `/review/library`, `/review/read/request`, `/review/subscribe` (no plan), `/admin`,
  `/admin/setup`, an unknown `/publications/…` slug and a page that threw. With placeholders
  only on the portal and the review library, every other page keeps its real status code. No
  protected content is sent, because the redirect happens before anything renders.

  **Monitoring.** A portal or review-library page that starts failing for every reader still
  answers `200`, so alerts and uptime checks that look only at status codes on those paths
  (5xx rates, a 307 check on signed-out `/portal`) will not see it. Server errors are still
  reported to Next.js's error handler and appear in the runtime logs; alert on those instead.

  To give the signed-out `/portal` and `/review/library` a real `307` as well, the proxy can
  answer signed-out requests before the page runs. That first needs the proxy at
  `src/proxy.ts` (Next.js does not run a root `proxy.ts` when the app lives in `src/app`).
- **Minimum display.** When the placeholder has already painted, React keeps it on screen for
  about 300 ms before revealing the page (`$RT + 300` in React's reveal script). This also
  applies on client navigation, and it avoids a flash. Statically prerendered pages arrive
  whole and never show a placeholder on first load. With production prefetching, links to
  them do not show one either.
- **No JavaScript.** React swaps streamed content in with inline scripts, which do not run
  without JavaScript. React sends each finished piece of the page as a hidden
  `<div hidden id="S:n">`. Next.js sends its first piece, `S:0`, together with the
  placeholder; until the page is ready it holds only a `<template>` marking where the page
  will go. A `<noscript>` block at the top of each placeholder (inert when JavaScript runs)
  does three things:
  - it shows every streamed piece;
  - it hides the placeholder only once a piece holds real content, that is, once the page
    has arrived;
  - it shows the notice above the shapes, which is hidden along with them.

  So, without JavaScript: while the page loads, the reader sees the placeholder and the
  notice. When the page arrives, it replaces them. A redirect follows after a second. A page
  that fails or is not found leaves the placeholder and the notice on screen, still with
  HTTP 200. Pieces appear in the order they arrived, so a late piece (often a form) can appear
  below the footer. A browser without CSS `:has()` keeps the placeholder above the revealed
  page.

  The tests pin this with a stream shaped like Next.js's: early template-only piece, then the
  page or a failure. They run it through Next.js's bundled React and the project's React, and
  they also pin Tailwind's base-layer `[hidden]` rule that the reveal has to outrank. This was
  checked against real `next dev` streams in a local sandbox: a slow page, a fast page, an
  unknown publication, a page that throws, sign-in, and the signed-out portal redirect. That
  check used a no-JavaScript simulation (scripts removed, `<noscript>` unwrapped), not a
  browser with JavaScript switched off.
- **Nested layouts.** The app has no layout below the root today. A `layout.tsx` added inside a
  folder with a placeholder would stream as content of its own. Without JavaScript, it would
  then replace the placeholder before the page arrived, and stay up without the page if the
  page failed.

## Checking it

`node scripts/run-tests.mjs tests/skeleton-loading.test.mjs`. To see a placeholder in a
browser, use a local `next dev` and a slow page. With React Developer Tools you can also
suspend a boundary by hand.
