# APRI — Athena Political & Regulatory Intelligence

The website, subscriber library and Complimentary Review service for **Athena Political &
Regulatory Intelligence (APRI)**. APRI publishes independent political, regulatory and
political-economy intelligence on Nigeria.

- **Live site:** <https://apri.athenacentre.org>, hosted on Vercel.
- **Repository:** `athenacenterpl-cmd/Apri-Site`. `main` deploys.
- **Stack:**
  - Next.js 16 (App Router, server actions) and React 19;
  - Tailwind CSS 4;
  - Neon Postgres (`@neondatabase/serverless`);
  - Papermark (secure document viewing);
  - Resend (email);
  - Vercel Blob (team images).

> **Keeping this file current.** This README is updated in the same commit as every change to
> the project: new pages, Admin controls, environment variables, migrations, scripts, docs and
> rollout steps. `tests/readme.test.mjs` fails if a migration in `db/migrations/` or a document in
> `docs/` is missing from it.

---

## Contents

1. [What the site does](#what-the-site-does)
2. [Subscription plans](#subscription-plans)
3. [How documents are delivered (Papermark)](#how-documents-are-delivered-papermark)
4. [Sign-in and sessions](#sign-in-and-sessions)
5. [Admin](#admin)
6. [Code map](#code-map)
7. [Security model](#security-model)
8. [Running locally](#running-locally)
9. [Environment variables](#environment-variables)
10. [Database and migrations](#database-and-migrations)
11. [Tests and checks](#tests-and-checks)
12. [Deployment and rollout](#deployment-and-rollout)
13. [Scheduled jobs and operational scripts](#scheduled-jobs-and-operational-scripts)
14. [Current status and what still needs a live check](#current-status-and-what-still-needs-a-live-check)
15. [Further documentation](#further-documentation)

---

## What the site does

### Public site

| Path | Purpose |
|---|---|
| `/` | Homepage: services, featured Complimentary Review editions, **Access Subscriber Library** |
| `/publications`, `/publications/[slug]` | Publications, and the Review Publication Archive (ordered from Admin; one column per category with published editions) |
| `/services`, `/team` | Services, and the team page (owner-managed portraits) |
| `/access` | Subscription access requests (Individual / Professional) |
| `/request-briefing` | Request a briefing; notifies the briefing manager |
| `/review` | New prospects request a Complimentary Review; email confirmation, then manual approval |
| `/review/subscribe` | Subscription request from a review reader |
| `/privacy`, `/terms` | Legal pages |

### Paid subscriber portal (`/portal`)

- **Sign-in** at `/portal/sign-in`. The email carries both a one-time link and an 8-digit code;
  see [Sign-in and sessions](#sign-in-and-sessions).
- **Libraries:**
  - The **Data Room library** is used when the subscriber's plan has a Papermark Data Room
    mapped. Each permitted edition opens through the subscriber's own exact-document Papermark
    link, watermarked with their name.
  - The **legacy library** is used for plans with no Data Room.
  - Both list **every permitted edition**, grouped by the
    [publication catalogue](#publication-catalogue) in its order, each category with its card
    and count. An edition with no category is still listed, last, under **Publications awaiting
    a category**. The single **Latest** card is the newest permitted edition across every
    category. A category only places and labels an edition: it never grants access.
- **Viewing inside APRI.** Papermark lets another site frame only its `/embed` page
  (`/view/<link>/embed`, or `/<slug>/embed` on a custom domain). Other viewer addresses send
  `X-Frame-Options`, so browsers refuse them in a frame.
  - `src/lib/papermark-embed.ts` builds that `/embed` address (`papermarkEmbedUrl`) and checks
    stored links separately (`papermarkShareUrl`).
  - A link with no `/embed` page opens in its own tab. **Open in a new tab** always uses the
    share link itself.
  - Inside the frame Papermark may ask the reader to confirm their email again after a reload:
    its session cookie is `SameSite=Strict`, so it is not kept in a frame on papermark.com.
  - Until 2 October 2026 the portal added `?embed=1`, which is not a Papermark option, so those
    frames were refused.
- **Access rules** live in one policy (`src/lib/access-policy.ts`):
  - **Term:** an edition is permitted when it is released ("On") for the subscriber's plan and
    its edition date falls within their paid term. Terms are counted in Africa/Lagos calendar
    days, inclusive.
  - **Exceptions:** Admin can **Also give** or **Hide** individual editions per subscriber.
  - **Never locked out by the library:** a current subscription is never shown "access ended"
    because of a library problem. Missing links read as "being prepared".
- **Notices:** suspended, ended, not-yet-started and term-missing states each have their own
  notice.
- **Search.** Both subscriber library paths can search the editions the subscriber is already
  permitted to see.
  - **Filters:** keywords, publication type (only the categories the reader has), and an
    inclusive issue-date range using either or both dates. The filters combine.
  - **Feedback:** matching counts, **Clear filters**, a no-results message, and plain messages
    for an impossible or reversed date range.
  - **Coverage:** titles, existing descriptions and the approved protected summary the reader
    may see, not PDF contents. **Subject**, **Sector** and **Geography** filters (from the
    editions' tags) appear only when the reader's permitted editions carry tags of that kind,
    offering only those labels.
  - **Dates:** filters use editorial issue dates, never upload or sync timestamps. An undated
    edition is listed when no date is set, and excluded once a date range is applied.
  - **Latest:** the single Latest card stays above the archive and is never filtered.
  - **Privacy and access:** filtering runs in the browser over the list the server already
    rendered (`src/lib/library-search.ts`, `src/components/LibrarySearch.tsx`). It makes no
    Papermark or database calls, and keeps search terms out of URLs, browser storage and
    analytics. Only display fields (title, description, type, issue date, tag labels and approved
    summary text) are passed for searching, never links, Papermark ids or unapproved text.
    Opening a document still checks current access on the server.
  - Tag filters and summaries need the editorial metadata migration (see
    [Database and migrations](#database-and-migrations)); without it, search works as before.
- **Reader details, tags and summaries.** Each permitted edition's card shows the details an
  editor entered (reading time, covered period, information cut-off, author/editor, tags), only
  when present, and the owner-approved summary in a closed **Summary** disclosure: what changed,
  why it matters, implications and risks, what to watch, and an optional source date and
  uncertainty. Drafts and edited-but-unapproved text never reach a reader, a public or review
  page, metadata, an email or a search record. See
  [`docs/publication-metadata-and-summaries.md`](docs/publication-metadata-and-summaries.md).

### Complimentary Review (prospects and approved readers)

1. **Request.** A prospect requests at `/review`, confirms their email, and an owner approves
   them in Admin → Review Requests.
2. **Recipients.** Each edition has its own recipient list (Admin → Review Library → edition
   recipients). Withdrawn and draft editions are never offered. Editions may be in any catalogue
   category except BP. Nothing is auto-assigned, auto-published or auto-offered, and approved
   card copy exists only for MIN, AIU and PLM: an edition in any other category needs the
   owner's own title and description before it can be published.
3. **How readers open editions.** Where the public cards lead is controlled by an owner in
   **Admin → Review Library → Where public review cards lead**. It is reversible.

   | Option | What happens |
   |---|---|
   | **Papermark links** (default) | Each card opens that edition's own Papermark link. Papermark asks for an email code per edition. |
   | **APRI Review Library** (the intended normal route) | The card goes to `/review/library`. A browser that is not signed in enters the approved email; APRI emails **one code** (no link). After it, the reader sees a clean APRI list of every published edition assigned to them, for **24 hours** on that browser. **Read** re-checks the assignment and opens that PDF directly inside the reader's personal Papermark link, which admits only their address and asks for no second code. The link is open only while they are signed in. Before migration `20261011` is applied, Read uses each edition's own link (Papermark code per edition). |

   Why APRI, not Papermark, checks the email: hosted Papermark has no supported way to accept a
   reader APRI verified or to report one it verified, its verified session is per link (23
   hours), and its session cookie is `SameSite=Strict`, so it cannot be embedded. The owner
   chose this design on 2 October 2026. Details and evidence:
   [`docs/review-reader-library.md`](docs/review-reader-library.md). `/review/read` now only
   redirects to the library.

4. **Downloads.** Approved readers may download their assigned published editions from
   Papermark's secure viewer. Saved PDFs carry the personal confidential watermark. Personal
   reader rooms verify document and link download permissions on their first open after this
   update (or an Admin repair), retaining the same link. For an existing edition's original
   link, use **Enable / verify downloads** on its Admin edition card. A failed verification is
   never reported as ready. Downloads remain confidential and may not be redistributed; a
   copy already saved cannot be taken back by withdrawing an edition.

### Publication catalogue

One owner-controlled list of categories (`src/lib/publication-catalogue.ts`, edited in
**Admin → Publication Categories**) drives both subscriber libraries, Complimentary Review, the
Publications archive, the homepage review cards and Admin.

| Code | Label | Notes |
|---|---|---|
| MIN | Monthly Intelligence Notes | |
| AIU | Athena Intelligence Updates | |
| PLM | Political Landscape Monitor | |
| AEO | Election & Democratic Governance Monitor | Formerly "Election Observatory" (kept as another name) |
| QIB | Quarterly Intelligence Briefs | |
| OTHER | Other Assigned Publications | Only an explicit choice, never a fallback |
| BP | Board Papers | Historical, inactive |

- **Placement.** A Data Room document is placed by its publication record's series; else its
  Papermark folder, matched **exactly** against the owner's folder mappings; else (only for a
  document in no folder) a code at the start of its name; else it is **awaiting a category**.
  An unmapped folder is never guessed. Papermark spells "&" as "and" in folder paths.
- **Owners** edit labels, card labels, order, the active flag and other names, and add or
  remove folder mappings. Codes cannot be created there: a new code needs a migration.
- **Never access.** A category or folder never grants access: the access policy and each
  review edition's own readers decide.

Details, the default folder mappings and the decisions behind them:
[`docs/publication-catalogue.md`](docs/publication-catalogue.md).

### Loading placeholders

While the subscriber portal (`/portal`, a document, the sign-in steps) or the Complimentary
Review library (`/review/library` and its sign-in) does its server work, Next.js shows a
placeholder of generic grey shapes in the page's own layout (`src/components/PageSkeleton.tsx`
and each folder's `loading.tsx`).

- No data, names, titles, links or counts; showing one starts no work and adds no delay.
- One visually hidden "Loading…" status; the pulse stops for reduced motion; one column on
  phones.
- Every real state still replaces it: empty library, notices, redirects, not-found and errors.
  Without JavaScript the page replaces it once it arrives; a failed page leaves a short notice.
- **Public pages and the Admin console have no placeholder, on purpose.** A streamed
  placeholder makes the response `200 OK` before the page runs, so pages under it lose real
  `404`, `307` and `500` status codes. Keeping placeholders to the portal and review library
  keeps real status codes everywhere else. Monitor portal and review-library failures through
  runtime error logs, not status codes.

Details and trade-offs: [`docs/skeleton-loading.md`](docs/skeleton-loading.md).

---

## Subscription plans

The catalogue is in `src/lib/subscription-catalogue.ts`:

| Plan (shown) | Stored name | Level | Seats | Price |
|---|---|---|---|---|
| Individual Access | Individual Access | L1 | 1 | ₦2 million annually |
| Professional Access | Professional Team Access | L1 | 3 | ₦5 million annually |
| Political Monitor | Political Monitor | L2 | 1 | — |
| Executive Intelligence | Executive Intelligence | L3 | 1 | — |
| Board Intelligence | Board Briefing | L4 | 1 | — |

**Who gets an edition:** in **Admin → Documents → (edition) → Who gets this edition**, tick the
plans and set the edition On or Off.

---

## How documents are delivered (Papermark)

All Papermark calls run server-side through `src/lib/papermark.ts`, which is the only place the
API token is attached.

| Use | Papermark object | Restrictions |
|---|---|---|
| Paid editions | One exact-document link per subscriber per edition | Their email as allow list, their name in the watermark, downloads per plan policy |
| Review editions (per edition) | One document link per edition | That edition's recipients as allow list, email code, `{{email}}` watermark, screenshot protection, personalised downloads after verified upgrade |
| Review rooms (per reader) | A group in the Review Data Room plus one group link | The reader is the only member; a permission row for every room document (view and download only where assigned); email code; watermark; screenshot protection |

**Engagement:** views come from the Papermark poll (daily) and the webhook. They are attributed
per reader and edition, and appear in **Admin → Engagement**.

**Papermark facts the design relies on** (from its open-source code):

- Email verification is per link and lasts 23 hours.
- A room session (`pm_drs_<linkId>`) lasts 23 hours and is tied to the browser.
- A group link refuses any document without a permission row.

---

## Sign-in and sessions

### Subscribers

The full write-up is in [`docs/subscriber-sign-in.md`](docs/subscriber-sign-in.md).

- **The sign-in email.** It holds a link and an 8-digit code.
  - The **code** signs in whichever browser it is typed into. This fixed subscribers being asked
    for email on every visit when their mail app opened links in its own browser.
  - The **link** signs in at once only in the browser that asked for it. Anywhere else (a mail
    app's browser, or a scanner), it asks for a **Continue** click and nothing is spent until
    then.
- **The session cookie.** `apri_subscriber` is `Secure`, `HttpOnly` and `SameSite=Lax`, with a
  90-day life renewed once a day with use, up to a year.
- **Recorded sessions.** Each is a row in `subscriber_sessions`:
  - **Sign out** ends it on the server;
  - Admin → subscriber → **Sign out of all browsers** ends them all.
- **Every protected request** re-checks the session record, status and term.

### Review readers

- The review cookie (`apri_review_reader`) is separate from the subscriber cookie. Neither
  opens the other's pages.
- One 8-digit code by email (no link, and not in the subject line, so lock-screen previews do
  not show it): single-use, 15 minutes, five tries per code, five codes per address per hour; a
  new code replaces the last (issued in one transaction, so overlapping requests leave one live
  code). Ten wrong codes in an hour pause that address for an hour.
- The session lasts **24 hours from the code**, is recorded server-side and is revocable. Sign-out
  ends it and closes the reader's personal Papermark link.
- An unassigned address is told plainly that a request or confirmation is not approval.
  Requests are rate-limited per network and per address.
- The older routing cookie (`apri_review_room`) is no longer set and grants nothing.

### Admin

- Individual owner and editor accounts, with an 8-hour session (`apri_session`).
- The first visit to `/admin` with no accounts offers one-time setup.
- **Staff Security:** optional authenticator enrolment, one-use recovery codes,
  server-checked session revocation, and an owner-controlled requirement once
  active staff have enrolled. Reader sign-ins are unchanged. Keep `SESSION_SECRET`
  securely backed up: it also encrypts staff factors. Rollout and recovery:
  [`docs/stage4-operations-security.md`](docs/stage4-operations-security.md).

---

## Admin

| Page | What it is for |
|---|---|
| Overview | Metrics and recent activity |
| Subscribers | Seats, activation (prepares the library, then sends onboarding), term and paid periods, **Document access** per edition (Also give / Hide), **Prepare library access**, signed-in browsers and **Sign out of all browsers** |
| Access Health | Every subscriber's reconciliation state |
| Documents | Publication records; **Who gets this edition** (plans, On/Off); **Reader details and tags** (a save made from a page opened before someone else's save is refused: reload and repeat it); **Protected summary for subscribers** (drafted by any administrator, approved or withdrawn by owners; editing approved text takes it down until re-approved). A record that anything uses, or that holds a written protected summary, is never deleted: archive it instead |
| Publication Tags | The subject, sector and geography vocabulary: add (owners and editors); rename, retire, restore, delete unused (owners) |
| Data Rooms | Map each plan to its Papermark Data Room; shows each document's category as the portal places it and flags unmapped folders |
| Publication Categories | The one publication catalogue: labels, card labels, order, active flag, other names, Papermark folder mappings, and what is awaiting a category, with unmapped paid and Review Data Room folders (owner only) |
| Review Library | Daily view: a short list of problems only when a real one exists (missing settings or migrations, an edition whose readers are not yet applied to Papermark, rooms needing repair, refused emails), checked on the server each time; editions grouped by catalogue category with status, homepage offer, approved-reader count and access health (sync, details, readers with Select all / Unselect all and preview, prepare secure access, publish, offer, withdraw, re-offer, history, order); **Approved readers** (find an email, see exactly what it can open, add or remove per edition, with apply and read-back to Papermark); **Personal rooms** status with **Repair**. **Advanced / Diagnostics**: where the cards lead, personal reader access (when each reader's link closes, check and repair; never the link itself), review email delivery records, the address book, library switch and Data Room. |
| Review Requests | Verified prospects, approvals, subscription processing |
| Engagement | Who is reading what (subscribers and review readers), per edition |
| Briefings, Copies, Team, Administrators | Briefing requests, issued copies, team portraits, accounts |

Every server action authorises itself (`requireAdmin()` or `requireOwner()`), whatever the page
shows. Buttons show a spinner while they work.

---

## Code map

```
src/proxy.ts                 Next 16-discovered proxy beside src/app; calls the tested root proxy.ts implementation
proxy.ts                     Shared request policy: optimistic admin gate, session renewal, indexing and opt-in migration
src/app/                     Routes (public site, /portal, /review, /admin, /api)
src/app/actions/             Server actions — each authorises itself
src/lib/                     Server logic (server-only), including:
  access-policy.ts             the one paid access rule (pure)
  access-policy-dal.ts         loads a subscriber's documents and decisions
  subscriber-access-reconciliation.ts  creates/repairs/withdraws personal links (leased, fenced)
  subscription-term.ts         Lagos-day term rules (pure)
  magic-link.ts, magic-token.ts, subscriber-session*.ts   subscriber sign-in and sessions
  review-reader.ts             remembered Review Library sessions
  review-reader-rooms.ts, reader-room-policy.ts           personal Papermark rooms
  publications.ts              public and per-email review edition queries
  publication-catalogue.ts     the one category catalogue and placement rules (pure)
  publication-catalogue-dal.ts the owner's catalogue from the database (defaults before 20261114)
  publication-metadata.ts      reader details, tag and protected-summary rules (pure)
  publication-metadata-dal.ts  reader details loader, editor panel, tag vocabulary
  publication-summaries.ts     protected summaries: compare-and-set writes, approved-only reads
  papermark*.ts                Papermark client and contracts
  view-attribution.ts, papermark-collector.ts             engagement attribution and polling
src/components/PageSkeleton.tsx  loading placeholders for /portal and /review/library (no data)
db/schema.sql                Full schema for a new database
db/migrations/               Additive, idempotent migrations for existing databases
db/rollback/                 One rollback per migration
scripts/                     Tests runner, secret scan, migrations, operational tools
tests/                       Unit, source-guard and database tests (in-memory Postgres)
docs/                        Design notes, incident write-ups and rollout guides
```

---

## Security model

The rules are written for an attacker who can read this whole repository:

- **No secrets in the code or the browser.**
  - No secret, key or token is committed, and none reaches client code.
  - Secrets live only in Vercel environment variables and a local, git-ignored `.env.local`.
  - Nothing secret is prefixed `NEXT_PUBLIC_`.
- **Server-side checks.** Authorisation happens on the server for every request and action, and
  every external input is validated at the boundary.
- **Tokens and codes:**
  - one-time links and codes are random, stored only as hashes, single-use and expiring;
  - sign-in codes are stored as keyed hashes;
  - sessions are signed with `SESSION_SECRET`.
- **Fail closed:**
  - never send Papermark an empty allow list;
  - never treat an unconfirmed Papermark removal as revoked (close the link instead);
  - never use a broad Data Room link for review readers.
- **Personal data:**
  - no personal data in logs, analytics, URLs or bundles;
  - tests use invented data only.
- **Before every commit**, run the type check, tests, production build, the secret scan
  (`pnpm check:secrets`) and a scan of the built client bundle. CI runs the first four on every
  push to `main`; Stage 5 adds ESLint and isolated production browser checks to pull requests.

---

## Running locally

Prerequisites: Node 24 and pnpm 10.

```bash
pnpm install
cp .env.example .env.local      # then fill in values (never commit .env.local)
pnpm db:migrate                 # applies db/schema.sql to DATABASE_URL (idempotent)
pnpm db:seed                    # optional: the initial publications
pnpm dev                        # http://localhost:3001
node scripts/install-hooks.mjs  # once per clone: pre-commit secret scan
```

Use a development database, not production. Without Papermark or Resend keys, links aren't
created and emails aren't sent.

---

## Environment variables

Names only: values belong in Vercel and `.env.local`. See `.env.example` for notes on each.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `SESSION_SECRET` | Signs all sessions and keys sign-in codes (32+ characters) |
| `APP_URL` | Legacy/sandbox email origin fallback. `PUBLIC_SITE_URL`, when set, takes precedence; otherwise subscriber links default to the existing production host |
| `PUBLIC_SITE_URL` | Trusted public origin for metadata, sitemap and first-party emails: only `https://apri.athenacentre.org` or `https://athenaadvisory.ng`; unset keeps the existing domain |
| `SITE_REDIRECTS_ENABLED` | Default disabled. Only `enabled` plus the new trusted origin activates safe GET/HEAD domain redirects; no cross-domain API/POST/token forwarding |
| `GOOGLE_SITE_VERIFICATION` | Optional public Search Console verification token; owner login and sitemap submission remain manual |
| `DATAROOM_NEW_DOCUMENT_EMAILS` | Default disabled. `enabled` permits publication sending only after an owner separately approves a baseline in Publication Alerts; migration and configured Resend sender also required |
| `PAPERMARK_API_TOKEN` | Papermark API (server-only) |
| `PAPERMARK_API_BASE` | Optional, for self-hosted Papermark |
| `PAPERMARK_CUSTOM_DOMAIN` | Optional verified custom domain for links |
| `PAPERMARK_WEBHOOK_SECRET` | Verifies Papermark webhooks (the webhook answers 503 without it) |
| `PAPERMARK_OPEN_EDITIONS_FOLDER_ID`, `PAPERMARK_OPEN_FOLDER_ID` | Public Open Editions folders |
| `PAPERMARK_SUBSCRIBERS_FOLDER_ID`, `PAPERMARK_BRIEFINGS_FOLDER_ID` | Client folder roots |
| `PAPERMARK_CALLS_PER_MINUTE` | Shared token budget for all calls; default and maximum 45/minute. Requires `20261012`. |
| `PAPERMARK_ANALYTICS_CALLS_PER_MINUTE` | Additional analytics budget; default and maximum 10/minute. |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Email sending and delivery events |
| `RESEND_FROM_EMAIL`, `SUBSCRIBER_FROM_EMAIL`, `BRIEFING_FROM_EMAIL`, `BRIEFING_MANAGER_EMAIL` | Senders and the briefing manager |
| `REVIEW_FROM_EMAIL` | Optional verified sender for review emails; otherwise they use the subscriber sender |
| `CRON_SECRET` | Authorises `/api/cron/*` (they answer 503 without it) |
| `BLOB_READ_WRITE_TOKEN` | Team portrait uploads |
| `WATERMARKING_ENABLED` | Whether watermarking is claimed and requested |
| `NEXT_PUBLIC_SUBSCRIBER_PORTAL_ENABLED` | Shows a header sign-in link (a public flag, never a secret) |

---

## Database and migrations

- **A new database:** `pnpm db:migrate` applies `db/schema.sql`. It splits the file into
  statements the way psql does (`scripts/lib/sql-statements.mjs`), so a semicolon inside a
  comment, a quoted string or a `do $$ ... $$` block does not cut a statement in two;
  `tests/schema-fresh-install.test.mjs` applies the whole schema to an empty database. (Until
  15 November 2026 a stray `);` in the schema and a naive split stopped a fresh install part-way.)
- **An existing database:** apply new files from `db/migrations/` **in filename order**, before or
  with the deploy that needs them. Every migration is additive and safe to re-run, and each has a
  rollback in `db/rollback/`. Code checks whether newer migrations are present and keeps the
  previous behaviour until they are.

| # | Migration | What it adds |
|---|---|---|
| 1 | `20260826_briefing_portal.sql` | Briefing portal tables |
| 2 | `20260827_client_engagement.sql` | Engagement events for subscribers and briefing clients |
| 3 | `20260828_engagement_dashboard.sql` | Engagement dashboard event types and notification baseline |
| 4 | `20260828_papermark_client_folders.sql` | Per-client Papermark folders and synced links |
| 5 | `20260828_papermark_datarooms.sql` | Papermark Data Rooms and room links |
| 6 | `20260829_editorial_link.sql` | Links Data Room documents to publication records |
| 7 | `20260829_notification_safety_baseline.sql` | Notification-safety baseline guard |
| 8 | `20260830_subscriber_document_links.sql` | Per-subscriber, per-document Papermark links |
| 9 | `20260902_complimentary_review_library.sql` | Complimentary Review Library, phase 1 |
| 10 | `20260902_review_library_fixed_slots.sql` | Fixed review slots with secure links |
| 11 | `20260902_review_sync.sql` | Review Data Room synchronisation |
| 12 | `20260903_publication_engagement_accuracy.sql` | Accurate publication engagement |
| 13 | `20260903_review_secure_link_provisioning.sql` | API-provisioned secure review links |
| 14 | `20260917_review_funnel_team_images.sql` | Review request funnel and team images |
| 15 | `20260922_versioned_review_publications.sql` | Versioned review editions |
| 16 | `20260923_review_publication_edition_workflow.sql` | Edition workflow (publish, latest, history) |
| 17 | `20260928_review_edition_recipients.sql` | Per-edition review recipients |
| 18 | `20260929_review_edition_withdrawal.sql` | Withdrawing editions; featured edition per series |
| 19 | `20260930_portal_title_override.sql` | Portal title override flag |
| 20 | `20260930_subscription_activation.sql` | Links activated subscribers to their requests |
| 21 | `20261001_subscriber_onboarding_messages.sql` | Tracked onboarding emails |
| 22 | `20261002_engagement_page_progress.sql` | Page-level viewing evidence |
| 23 | `20261003_subscription_edition_entitlements.sql` | Paid periods and per-person exceptions |
| 24 | `20261004_paid_release_and_access_health.sql` | Paid release On/Off, audit events, access health |
| 25 | `20261005_publication_plans.sql` | Which plans receive each edition |
| 26 | `20261006_review_edition_display_order.sql` | Order of review editions on the Publications page |
| 27 | `20261007_subscriber_sign_in_sessions.sql` | Sign-in codes, asking-browser marker, recorded subscriber sessions |
| 28 | `20261008_review_reader_library.sql` | Remembered Review Library sign-in, sessions, reader events |
| 29 | `20261009_review_reader_rooms.sql` | Personal Papermark rooms per reader |
| 30 | `20261010_review_access_reliability.sql` | Owner-only review email outcomes and delivery events; room routing columns (confirmed edition set, per-reader lease) |
| 31 | `20261011_review_reader_open_window.sql` | When each reader's personal Papermark link closes, and which room document is each edition: turns on direct, code-free Read |
| 32 | `20261012_papermark_work_queue.sql` | Shared Papermark pacing, saved reader repair jobs, owned leases and resumable paid verification |
| 33 | `20261114_publication_catalogue.sql` | One publication catalogue: owner-edited category labels, order and active flag, exact Papermark folder mappings (seeded once from the defaults); `documents.series` may be OTHER; review editions may use any catalogue code but BP. Changes no existing row. Sets a 5-second lock timeout: if it fails on a lock, re-run it |
| 34 | `20261114_publication_editorial_metadata.sql` | Optional reader details on publication records (author/editor, covered period, information cut-off, reading time), the subject/sector/geography tag vocabulary and assignments (an assigned tag cannot be deleted), and approved protected summaries with revisions. Additive, no backfill. Sets a 5-second lock timeout: if it fails on a lock, re-run it |
| 35 | `20261115_stage3_publishing_workflow.sql` | Explicit editorial review, immutable released snapshots, correction families and exact audience inheritance, embedded notice proof and honest saved raw-link retirement. No migration backfill, provider mutation or email. |
| 36 | `20261115_stage4_operations_security.sql` | Staff authenticator/session-version controls, durable signed delivery evidence, owner-only operations/incident records and explicitly approved bounded retention. No emails, cleanup or provider mutations on migration. Rollback refuses after use. |
| 37 | `20261115_stage5_publication_notifications.sql` | Disabled-by-default durable release/update events, leased per-subscriber email jobs, publication email preferences and approval audit; first-release capture is transactional and no historical email is sent by the migration |

A read-only check on 2 October 2026 found every migration through `20261010` applied in
production. `20261011` is new: until it is applied, the library sends readers to each edition's
own Papermark link (a Papermark code per edition) and no personal link is changed. Verification
queries are in each feature's document under `docs/`.

Before `20261114_publication_catalogue.sql` is applied, the site uses the built-in catalogue:
owner edits, series OTHER and review editions outside MIN/AIU/PLM wait for it. Its rollback
(`db/rollback/20261114_publication_catalogue.rollback.sql`) refuses, changing nothing, while a
record has series OTHER, a review edition is in AEO, QIB or OTHER, or an owner has edited a
category or mapping; it is safe to run twice.

`20261114_publication_editorial_metadata.sql` sorts after the catalogue migration and does not
depend on it. Before it is applied, both libraries list, open and search as before and the
Admin panels say the migration is needed. Its rollback refuses, changing nothing, while any
summary, tag, tag assignment or reader-detail value exists; it can be re-run.

---

## Tests and checks

```bash
pnpm test                         # all tests, against an in-memory Postgres (PGlite)
pnpm test tests/<file>.test.mjs   # one file
npx tsc --noEmit -p .             # type check
pnpm build                        # production build (webpack)
pnpm check:secrets                # staged changes; --all for every tracked file
```

- **The test database.** `scripts/run-tests.mjs` builds a fresh database from `db/schema.sql`
  and the migrations. It strips any production credential from the environment, so tests cannot
  reach a real database, Papermark or Resend.
- **Papermark in tests.** Behaviour is tested against local mock servers, which is not live
  verification.
- **Subscriber search:**
  - `tests/library-search.test.mjs` covers the filter rules;
  - `library-search-db.test.mjs` uses the real access loaders: January versus May terms,
    individual Allow/Block, another plan's editions and both library paths;
  - `library-search-form.test.mjs` covers the rendered controls and where search terms may go.
- **Publication catalogue:**
  - `tests/publication-catalogue.test.mjs`: defaults, owner overrides, exact folder mapping
    (including Papermark's stored folder paths), placement order, sections, search types,
    validation, review rules, and guards against hard-coded series lists;
  - `publication-catalogue-db.test.mjs`: all six categories plus "awaiting a category" on both
    library paths with the real loaders (January–March and May-onward periods, Allow and Block,
    another plan), the single Latest, review readers in different categories, no
    auto-assignment, owner-only Admin actions and the review copy rule;
  - `publication-catalogue-migration.test.mjs`: fresh seed, an upgrade with representative data
    that changes no row, safe re-runs that keep owner edits, every rollback guard and a re-runnable
    rollback.
- **Reader details, tags and summaries:**
  - `tests/publication-metadata.test.mjs` (rules and card rendering) and
    `publication-metadata-db.test.mjs` (saving through the real actions, a stale save refused
    without losing another editor's tag, tag permissions, retire-not-delete, what readers see on
    both paths, details never decide access);
  - `publication-summaries-db.test.mjs`: draft, approve, edit-invalidates, withdraw, forged
    owner cookie, concurrency (edit versus approve, two edits, two approvals, and an approval or
    withdrawal at a revision that has moved on refused by the statement itself), approved copy
    only and only to entitled readers, and a record with a written summary is not deleted;
    `publication-summaries-leak-db.test.mjs`: no protected text in email bodies;
  - `publication-metadata-sync-db.test.mjs`: every Data Room sync path keeps details, tags and
    summaries;
  - `publication-metadata-migration.test.mjs` and `publication-metadata-premigration-db.test.mjs`:
    fresh, upgrade, every rollback guard on an upgraded database holding real saved details, tags
    and summaries, and the site before the migration;
  - `library-tag-filters.test.mjs` and `library-tag-filters-db.test.mjs`: tag filters, and
    options and counts only from each reader's permitted editions.
- **Loading placeholders:** `tests/skeleton-loading.test.mjs` covers rendering and
  accessibility, reduced motion and phone layout, source guards (no data, session, Papermark or
  email imports), which placeholder each page shows, that no `loading.tsx` exists outside the
  portal and review library, and a stream shaped like Next.js's, with and without JavaScript.
- **Fresh install:** `tests/schema-fresh-install.test.mjs` checks the SQL splitter and applies every
  statement of `db/schema.sql` to an empty database, twice.
- **CI** (`.github/workflows/ci.yml`) runs the secret scan, type check, tests and build on every
  push to `main` and on pull requests.

---

## Deployment and rollout

1. **Order.** Apply any new migrations (above) to the production database, then push to `main`;
   Vercel deploys.
2. **Rollout switches.** New behaviour waits for its migration and, where it changes what
   readers see, for an owner to switch it on in Admin:
   - The **sign-in code and recorded sessions** start working once `20261007` is applied.
   - **Where public review cards lead** stays on Papermark links until an owner changes it.
   - **Personal Papermark rooms** stay off until an owner records the controlled two-reader test.
     See [`docs/review-reader-library.md`](docs/review-reader-library.md).
   - **Publication catalogue:** after applying `20261114_publication_catalogue.sql` and
     deploying, an owner opens **Admin → Publication Categories**, checks the folder mappings and
     the "awaiting a category" counts, and decides where the `board-intelligence-updates` folder
     belongs (it is deliberately unmapped). Review Data Room folders that are not mapped are
     listed there too.
   - **Reader details, tags and summaries:** apply `20261114_publication_editorial_metadata.sql`
     after the catalogue migration. Nothing is seeded: owners and editors agree the starting
     tag vocabulary in **Admin → Publication Tags**, editors draft summaries, and an owner
     approves each one. Nothing is shown to readers until it is entered and, for summaries,
     approved.
3. **Pushing to GitHub.** Use the plain HTTPS remote. Credentials come from the operating
   system's credential manager, never a token in the URL.

---

## Scheduled jobs and operational scripts

**Vercel crons** (`vercel.json`):

| Job | Schedule | What it does |
|---|---|---|
| `/api/cron/papermark-views` | Daily 03:00 UTC | Polls Papermark views and downloads |
| `/api/cron/dataroom-sync` | Daily 04:00 UTC | Syncs Data Room documents |
| `/api/cron/engagement-digest` | Mondays 07:00 UTC | Weekly engagement digest |

**Saved access jobs:** `/api/cron/papermark-work` resumes bounded reader and subscriber
repairs and accepts `CRON_SECRET` only in the Authorization header. Admin repairs save work
before responding; the Review Library refreshes every 15 seconds while waiting. Existing
verified access survives an unchanged maintenance check that hits a temporary limit.

On Vercel Hobby, `.github/workflows/papermark-worker.yml` in the **source repository**
provides an hourly unattended retry, plus manual **Run workflow**. After deploying the
route, configure its repository `CRON_SECRET` secret from the existing Vercel value.
It uses GitHub Actions minutes. No per-minute Vercel cron is added, so Hobby deployment
remains supported. Daily Data Room sync is also a retry opportunity. Scheduled Actions
can be delayed; the saved jobs and leases remain recoverable. See
[`docs/papermark-repair-stability.md`](docs/papermark-repair-stability.md) for exact steps.

**Publication email jobs:** `/api/cron/publication-notifications` uses the same header-only
`CRON_SECRET`, an owner baseline and `DATAROOM_NEW_DOCUMENT_EMAILS=enabled`. The source
workflow `.github/workflows/publication-notifications.yml` runs hourly at minute 31; the
optional repository variable `APRI_SITE_URL` selects an approved old/new origin. It never
follows redirects with the secret. It checks up to 20 candidate subscribers for one event
and sends up to 10 due jobs per run. Admin → Publication Alerts can advance the same bounded
queue. See [Stage 5 rollout](docs/stage5-quality-and-notifications.md).

**Scripts** (`scripts/`):

| Script | Use |
|---|---|
| `run-tests.mjs` | The test runner |
| `check-browser.mjs` | Isolated production build, public HTTP/anchor checks, desktop/mobile keyboard and axe checks, five paid plans, review assignment removal and lab responsiveness; no live services |
| `check-secrets.mjs`, `install-hooks.mjs` | Secret scan and its pre-commit hook |
| `migrate.mjs`, `seed.mjs` | Schema and seed for a database (`lib/sql-statements.mjs` splits SQL as psql does; the test database uses it too) |
| `access-recovery-preview.mjs` | Read-only preview of subscriber access; `--apply-release` backfill |
| `reconcile-subscriber-document-links.mjs` | Batch reconciliation of personal links (dry run by default) |
| `subscription-access-rollout-report.mjs` | Every subscriber's access state, with no link ids |
| `verify-restored-access.mjs` | Read-only comparison of frozen source/restored access tables; set `RECOVERY_SOURCE_DATABASE_URL` and `RECOVERY_RESTORED_DATABASE_URL` privately with read-only credentials. Counts and match results only; no provider or PDF verification. |

**Operations:** `/api/cron/operations` matches saved signed delivery events,
checks database health evidence and sends bounded internal alerts only after
owner opt-in. The source `.github/workflows/operations-worker.yml` runs hourly
with the existing `CRON_SECRET`; no new Vercel cron is added. **Admin → Operations**
has masked email diagnostics, incident owner/deputy, evidence references and
retention previews. No deletion runs automatically and no Papermark call is made
by these health checks. See the Stage 4 guide below for limits and rollout.

---

## Current status and what still needs a live check

Last updated **16 November 2026**.

**Stage 4:** staff authenticator enrolment and server-side revocation, durable
delivery-event replay, owner-only Operations, incident contacts and bounded
owner-approved cleanup. No reader permissions are changed; alert emails default
off and no retention period/deletion is seeded. New security/delivery/retention
tests, the fresh/upgrade/rollback test, and rendered staff-page checks use isolated
data. Live authenticator usability, real email delivery and a real Neon recovery
rehearsal still need controlled acceptance. Rollout and limitations are in
[`docs/stage4-operations-security.md`](docs/stage4-operations-security.md).

**Stage 5 (separate branch):** durable subscriber publication alerts replace the first-hour
new-file sweep and the old Sync and notify ledger. Existing releases are baselined without
a historical email blast; new releases and explicitly approved corrections use saved jobs,
current permissions and preferences, confirmed personal access and actual provider outcomes.
No email sends merely because this code or migration is deployed.

Public metadata, sitemap, robots, sharing image and a restrained llms.txt are added; private
content stays noindex/no-store. Existing paths/design/fonts remain. `src/proxy.ts` makes
Next actually discover the request policy beside `src/app`. The new domain and permanent
redirects are prepared but off. A domain move requires one fresh sign-in on the new domain;
browser cookies cannot transfer between unrelated domains.

Local combined validation: 2,642 tests, 2,640 pass, 0 fail and the same two pre-existing
wording todos; lint/type-check/production build and the public HTTP/anchor crawl pass.
The send claim also checks the current Lagos day to catch a term ending between
policy evaluation and provider submission, and a changed saved provider confirmation
invalidates an older ready decision even when its generation is unchanged. The production dependency audit reports zero known vulnerabilities after the supported
Next.js/Blob/Zod and transitive security updates. Browser CI evidence is recorded separately. The first browser pass found and corrected
brass-button contrast, the mobile menu accessible name and inline link identification;
CI saves invented-data reports and screenshots for seven days.
The complete browser run also checks the labelled team portrait placeholders as images.
The recipient-removal browser check waits for the resolved library after reload;
the loading skeleton is not mistaken for a finished, empty library.

This Stage 5 branch is stacked on Stage 4 for combined verification; Stage 4 remains
a separate pull request. Integrate the final Stage 3 changes and test the exact result
before launch. Browser checks run on an invented-data production build in CI;
real inbox receipt, real Papermark/watermarks, Search Console and field Core Web Vitals need
controlled live acceptance. See the [rollout and impact tables](docs/stage5-quality-and-notifications.md)
and [domain migration plan](docs/athena-advisory-domain-migration.md).

**Loading placeholders (Stage 2):** the portal and the Complimentary Review library show a
data-free placeholder while their server work runs. Public pages and Admin deliberately have
none, so they keep real `404`, `307` and `500` responses. Checked locally (`next dev`, invented
data, mock Papermark), not on the deployed site; a production build's prefetching and a real
screen reader are not yet checked.

**Publication catalogue (Stage 2):** one owner-controlled catalogue of six active categories
(plus BP, inactive) replaces the three-category assumptions. Visible changes once deployed:
- the portal library order changes from PLM, MIN, AIU to MIN, AIU, PLM, AEO, QIB, Other;
- permitted QIB editions, and permitted editions with no category, become visible (they were
  hidden before);
- AEO reads "Election & Democratic Governance Monitor" instead of "Election Observatory";
- the PLM heading on `/publications` and in Admin reads "Political Landscape Monitor";
- the homepage review intro names the categories actually offered;
- review sync no longer guesses a category from words in a folder's name;
- publishing a paid edition with no category now also needs its edition date.

Tested locally with invented data, an in-memory database and no Papermark; not verified live.

**Reader details, tags and approved summaries (Stage 2):** optional reader details and
controlled subject/sector/geography tags per edition, tag filters in search over permitted
editions only, and protected summaries that editors draft and owners approve (enforced on the
server, compare-and-set revisions, editing takes approved text down). Tested locally with
invented data, an in-memory database, a mock Papermark and no email; not verified live.

**Subscriber archive search:** keyword, publication-type and inclusive issue-date filters
are available in both subscriber library paths. Papermark delivery, the Latest card,
subscription periods and individual exceptions are retained. This is the first functional
scope increment; branding, Zoho integration and the domain cutover are deferred. Local
verification uses invented records, not production subscribers.

**Papermark repair stability:** apply `20261012_papermark_work_queue.sql` before deploying
this change. All API helpers share pacing across instances after that migration. Temporary
429/network/5xx delays use saved retries rather than false repair failures; jobs are
coalesced per reader, fenced by generation and owned lease, and interrupted paid batches
reuse verified reads within the same input generation for up to 15 minutes. New Admin
changes invalidate that generation. Approved review downloads, 24-hour reader sessions,
subscriber sessions, entitlement rules and onboarding email gates remain in force.
Development checks use invented data and a mock Papermark, not the live provider.

**Fixed (2 October):** every review email failed on the live site. The /review
confirmation, the Admin access email and the reader sign-in email all required `APP_URL`,
which the live deployment does not set, and threw before anything was sent. Subscriber
emails never read it, so they kept arriving. Review emails now use the same production
origin unless the trusted `PUBLIC_SITE_URL` or legacy sandbox `APP_URL` names another. Evidence (read-only, counts only): after the new code
was deployed, four reader sign-in requests from the network that had earlier requested a sign-in for an
approved address left no sign-in token and no email attempt. The new code reads the origin
before it creates a token, so the failure came before the database step and before any send.

**New (2 October), not yet verified live:**
- The one-code Review Library: one APRI code, a 24-hour session, and direct Read into each
  reader's personal Papermark link, which asks for no second code and is open only while they
  are signed in.
- It needs migration `20261011_review_reader_open_window.sql`. Until that is applied, Read
  uses each edition's own Papermark link.
- The manual two-reader test switch in Admin is gone. Isolation is proven by tests and by
  Papermark read-back on every change. The live checks are listed below.

**Live:**
- the plan-based paid access;
- one-click Admin access controls;
- review edition ordering;
- subscriber sign-in with codes and recorded sessions;
- the remembered Review Library.

**Verified locally** in a production build with invented data and a mock Papermark: the
subscriber sign-in fix across every plan, both library paths, sign-out, suspension, ended term
and a different browser.

**Still needs a live check on the deployed site:**
- **The subscriber return journey** with controlled test subscribers on each plan. Steps are in
  [`docs/subscriber-sign-in.md`](docs/subscriber-sign-in.md).
- **The one-code Review Library** on the deployed site, after migration `20261011` is applied:
  code receipt, wrong, expired and resent codes, two PDFs with no second code, a return visit,
  two isolated readers, removal, withdrawal, downloads and sign-out. Steps are in
  [`docs/review-reader-library.md`](docs/review-reader-library.md).
- **Which Vercel project serves the domain** has not been confirmed from this repository.

- **Code delivery to a real inbox.** APRI now sends the reader's one code. Each send is
  recorded (accepted, refused or unknown), and delivery is shown only from Resend events.

**Complimentary Review download rollout:** no new migration, environment variable or bulk
Papermark job is added. Existing one-code sign-in, 24-hour session, reader assignments,
withdrawal, and paid subscriber settings are unchanged. Personal rooms upgrade in place on
first open; pre-repair a few readers at a time if needed. Rate-limited upgrades remain
unconfirmed and can be retried; the existing process-local pacing is not a shared job queue.
Original edition links can be upgraded individually with **Enable / verify downloads**.
Use Papermark's own Download control: APRI does not expose or proxy an unwatermarked source
PDF, and a Read click is not recorded as a completed download. Live watermarked file
generation and delivery still require a controlled Papermark download check; automated
coverage uses the isolated database and a mock provider.

---

## Further documentation

- [`docs/subscriber-sign-in.md`](docs/subscriber-sign-in.md): the sign-in incident, root cause,
  fix and live acceptance test.
- [`docs/papermark-repair-stability.md`](docs/papermark-repair-stability.md): durable repairs, shared pacing, Hobby worker setup and recovery checks.
- [`docs/review-reader-library.md`](docs/review-reader-library.md): the one-code Review Library,
  what hosted Papermark permits and why APRI performs the check, the personal links, migrations
  and the live acceptance checks.
- [`docs/subscriber-access-recovery.md`](docs/subscriber-access-recovery.md): the paid access
  incident, the access rule, migration order and recovery.
- [`docs/subscription-entitlement-rollout.md`](docs/subscription-entitlement-rollout.md): the
  earlier entitlement rollout (it points to the recovery document).
- [`docs/publication-catalogue.md`](docs/publication-catalogue.md): the publication catalogue,
  default folder mappings, placement rules, Admin controls, migration and rollback.
- [`docs/publication-metadata-and-summaries.md`](docs/publication-metadata-and-summaries.md):
  reader details, the tag vocabulary, tag filters, and the draft/approve rules for protected
  summaries.
- [`docs/skeleton-loading.md`](docs/skeleton-loading.md): the portal and review-library
  loading placeholders, why public and Admin pages have none, and the no-JavaScript behaviour.
- [`docs/stage4-operations-security.md`](docs/stage4-operations-security.md): staff
  security, delivery races, health alerts, owner-approved retention, migration,
  backup/restore responsibilities and manual acceptance checks.
- `AGENTS.md` / `CLAUDE.md`: instructions for coding assistants working in this repository.

- [Stage 5 quality and notifications](docs/stage5-quality-and-notifications.md): alert enablement, worker, SEO checks, compatibility impacts and repeatable acceptance.
- [Athena Advisory domain migration](docs/athena-advisory-domain-migration.md): preserved data, safe redirects, fresh sign-in, email/provider settings, rollback and manual launch checks.


## Stage 3 editorial release and migration checklist

New draft releases require an editorial record, complete source/details, submission and
owner approval, rechecked transactionally. Existing live editions remain available without
bulk adoption or fabricated historic approvals. Corrections use distinct PDFs and the original
issue date, explicit fingerprinted audience inheritance, immutable master history, embedded
superseded notices and honest saved retirement checks. Existing search, categories, summaries,
sessions, entitlement policy, Papermark pacing and download settings remain in place.

Read [the publishing and correction guide](docs/stage3-publishing-and-versions.md) before
preparing a correction. The PDF notice CLI embeds the licensed font in `assets/pdf-notice` (license included)
and creates a separate file; website fonts are unchanged. Papermark upload and
independent file/watermark inspection are explicit manual steps, not claimed API proof.
Previously downloaded copies cannot be recalled. No new circulation or summary-coverage
policy is chosen. Used history cannot be destructively rolled back.

Use [the detailed morning migration checklist](docs/morning-migration-runbook.md) for merge
order, correct Neon project/migrations, source/mirror deployment, DNS, Vercel origins, reader
checks, workers, Search Console and rollback. All three source workflows now accept the same
allowlisted repository variable `APRI_SITE_URL` (old origin by default) and the existing
`CRON_SECRET`; they do not follow redirects with that secret. A new domain requires one
fresh sign-in per browser; it does not change accounts or subscription terms. Branding and
Zoho remain deferred. No live migration, DNS cutover or provider test is implied by code checks.

Database-backed publication and review dates are converted to calendar-day strings before
rendering. This preserves the stored day when the database driver returns a local-midnight
Date and prevents the public archive from failing when an edition has no display label.
The regression test exercises the real database driver and public/assigned-reader reads.
Browser audits set and assert their actual viewport before each page, including the
Admin editorial flow at 375 px and the approved state at 1440 px.
