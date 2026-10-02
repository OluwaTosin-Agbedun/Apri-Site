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
| `/publications`, `/publications/[slug]` | Publications, and the Review Publication Archive (ordered from Admin) |
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
- **Access rules** live in one policy (`src/lib/access-policy.ts`):
  - **Term:** an edition is permitted when it is released ("On") for the subscriber's plan and
    its edition date falls within their paid term. Terms are counted in Africa/Lagos calendar
    days, inclusive.
  - **Exceptions:** Admin can **Also give** or **Hide** individual editions per subscriber.
  - **Never locked out by the library:** a current subscription is never shown "access ended"
    because of a library problem. Missing links read as "being prepared".
- **Notices:** suspended, ended, not-yet-started and term-missing states each have their own
  notice.

### Complimentary Review (prospects and approved readers)

1. **Request.** A prospect requests at `/review`, confirms their email, and an owner approves
   them in Admin → Review Requests.
2. **Recipients.** Each edition has its own recipient list (Admin → Review Library → edition
   recipients). Withdrawn and draft editions are never offered.
3. **How readers open editions.** Where the public cards lead is controlled by an owner in
   **Admin → Review Library → Where public review cards lead**. It is reversible.

   | Option | What happens |
   |---|---|
   | **Papermark links** (default) | Each card opens that edition's own Papermark link. Papermark asks for an email code per edition. |
   | **APRI Review Library** | Readers verify once on APRI (`/review/library/sign-in`). They see only their assigned editions, re-checked on every open. Papermark still asks per edition. |
   | **Personal Papermark rooms** (the intended normal route) | The card goes to `/review/read`. An unknown browser enters the approved email once on APRI. APRI sends no email and asks for no code. APRI re-checks approval and that the reader's room shows exactly their current editions, then redirects to their personal Papermark room. **Papermark** emails one code, which the reader pastes into Papermark's screen. That code opens all their assigned published editions on that browser for Papermark's ~23-hour session. Downloads are off. Available only after an owner records the controlled two-reader test. |

4. **Downloads.** Complimentary Review downloads are **disabled**. A proposal to allow them is
   on hold.

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
| Review editions (per edition) | One document link per edition | That edition's recipients as allow list, email code, `{{email}}` watermark, screenshot protection, downloads off |
| Review rooms (per reader) | A group in the Review Data Room plus one group link | The reader is the only member; a permission row for every room document (view only where assigned, download never); email code; watermark; screenshot protection |

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

- The review cookie is separate from the subscriber cookie. Neither opens the other's pages.
  - `apri_review_reader` is used for the remembered library.
  - `apri_review_room` is used for routing to a personal room.
- The personal-room entry path (`/review/read`) asks for no APRI code and sends no APRI email:
  Papermark performs the email check.
  - `apri_review_room` (90 days) only remembers which room a browser goes to. It is never a
    sign-in.
  - A signed-in Review Library reader outranks it, and sign-out or **Not you?** clears it.
  - An unapproved address is told that a request or confirmation is not approval. Requests are
    rate-limited per network and per address.

### Admin

- Individual owner and editor accounts, with an 8-hour session (`apri_session`).
- The first visit to `/admin` with no accounts offers one-time setup.

---

## Admin

| Page | What it is for |
|---|---|
| Overview | Metrics and recent activity |
| Subscribers | Seats, activation (prepares the library, then sends onboarding), term and paid periods, **Document access** per edition (Also give / Hide), **Prepare library access**, signed-in browsers and **Sign out of all browsers** |
| Access Health | Every subscriber's reconciliation state |
| Documents | Publication records; **Who gets this edition** (plans, On/Off) |
| Data Rooms | Map each plan to its Papermark Data Room |
| Review Library | Daily view: a short list of problems only when a real one exists (missing settings or migrations, an edition whose readers are not yet applied to Papermark, rooms needing repair, refused emails), checked on the server each time; editions grouped MIN / AIU / PLM with status, homepage offer, approved-reader count and access health (sync, details, readers with Select all / Unselect all and preview, prepare secure access, publish, offer, withdraw, re-offer, history, order); **Approved readers** (find an email, see exactly what it can open, add or remove per edition, with apply and read-back to Papermark); **Personal rooms** status with **Repair**. **Advanced / Diagnostics**: where the cards lead, the two-reader test and proof, review email delivery records, the address book, library switch and Data Room. |
| Review Requests | Verified prospects, approvals, subscription processing |
| Engagement | Who is reading what (subscribers and review readers), per edition |
| Briefings, Copies, Team, Administrators | Briefing requests, issued copies, team portraits, accounts |

Every server action authorises itself (`requireAdmin()` or `requireOwner()`), whatever the page
shows. Buttons show a spinner while they work.

---

## Code map

```
proxy.ts                     Next 16 proxy: optimistic admin gate; renews subscriber sessions
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
  papermark*.ts                Papermark client and contracts
  view-attribution.ts, papermark-collector.ts             engagement attribution and polling
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
  push to `main`.

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
| `APP_URL` | Optional. The origin used in review emails when set (for a sandbox). Unset, review and subscriber emails both use `https://apri.athenacentre.org` |
| `PAPERMARK_API_TOKEN` | Papermark API (server-only) |
| `PAPERMARK_API_BASE` | Optional, for self-hosted Papermark |
| `PAPERMARK_CUSTOM_DOMAIN` | Optional verified custom domain for links |
| `PAPERMARK_WEBHOOK_SECRET` | Verifies Papermark webhooks (the webhook answers 503 without it) |
| `PAPERMARK_OPEN_EDITIONS_FOLDER_ID`, `PAPERMARK_OPEN_FOLDER_ID` | Public Open Editions folders |
| `PAPERMARK_SUBSCRIBERS_FOLDER_ID`, `PAPERMARK_BRIEFINGS_FOLDER_ID` | Client folder roots |
| `PAPERMARK_ROOM_CALLS_PER_MINUTE` | Optional pacing for reader-room calls (default 50) |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Email sending and delivery events |
| `RESEND_FROM_EMAIL`, `SUBSCRIBER_FROM_EMAIL`, `BRIEFING_FROM_EMAIL`, `BRIEFING_MANAGER_EMAIL` | Senders and the briefing manager |
| `REVIEW_FROM_EMAIL` | Optional verified sender for review emails; otherwise they use the subscriber sender |
| `CRON_SECRET` | Authorises `/api/cron/*` (they answer 503 without it) |
| `BLOB_READ_WRITE_TOKEN` | Team portrait uploads |
| `WATERMARKING_ENABLED` | Whether watermarking is claimed and requested |
| `NEXT_PUBLIC_SUBSCRIBER_PORTAL_ENABLED` | Shows a header sign-in link (a public flag, never a secret) |

---

## Database and migrations

- **A new database:** `pnpm db:migrate` applies `db/schema.sql`.
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

A read-only check on 2 October 2026 found every migration through `20261009` applied in
production; `20261010` is new and must be applied before relying on review email diagnostics
and room routing checks (code works without it). Verification queries are in each feature's
document under `docs/`.

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

**Scripts** (`scripts/`):

| Script | Use |
|---|---|
| `run-tests.mjs` | The test runner |
| `check-secrets.mjs`, `install-hooks.mjs` | Secret scan and its pre-commit hook |
| `migrate.mjs`, `seed.mjs` | Schema and seed for a database |
| `access-recovery-preview.mjs` | Read-only preview of subscriber access; `--apply-release` backfill |
| `reconcile-subscriber-document-links.mjs` | Batch reconciliation of personal links (dry run by default) |
| `subscription-access-rollout-report.mjs` | Every subscriber's access state, with no link ids |

---

## Current status and what still needs a live check

Last updated **2 October 2026**.

**Fixed (2 October):** every review email failed on the live site. The /review
confirmation, the Admin access email and the reader sign-in email all required `APP_URL`,
which the live deployment does not set, and threw before anything was sent. Subscriber
emails never read it, so they kept arriving. Review emails now use the same production
origin unless `APP_URL` names another. Evidence (read-only, counts only): after the new code
was deployed, four reader sign-in requests from the network that had earlier requested a sign-in for an
approved address left no sign-in token and no email attempt. The new code reads the origin
before it creates a token, so the failure came before the database step and before any send.

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
- **The personal Papermark rooms** two-reader test. It needs a Papermark API token and two test
  inboxes. Steps are in [`docs/review-reader-library.md`](docs/review-reader-library.md).
- **Which Vercel project serves the domain** has not been confirmed from this repository.

- **Code delivery to a real inbox.** Papermark sends the reading code, and its delivery cannot be
  read from APRI. APRI-sent review emails are now recorded (accepted, refused or unknown), and
  delivery is shown only from Resend events.

**On hold:** Complimentary Review downloads.

---

## Further documentation

- [`docs/subscriber-sign-in.md`](docs/subscriber-sign-in.md): the sign-in incident, root cause,
  fix and live acceptance test.
- [`docs/review-reader-library.md`](docs/review-reader-library.md): the Review Library, what
  Papermark permits, personal rooms, code frequency, rollout and live test.
- [`docs/subscriber-access-recovery.md`](docs/subscriber-access-recovery.md): the paid access
  incident, the access rule, migration order and recovery.
- [`docs/subscription-entitlement-rollout.md`](docs/subscription-entitlement-rollout.md): the
  earlier entitlement rollout (it points to the recovery document).
- `AGENTS.md` / `CLAUDE.md`: instructions for coding assistants working in this repository.
