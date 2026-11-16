# Migration to athenaadvisory.ng: operator checklist

Prepared 16 November 2026. Stages 1–5 are now merged; the operator has confirmed
the five new migrations were applied, the mirror was synced and the new domain
was deployed. The APRA identity update must be synced before resuming the live
checks below. Earlier merge/backup steps remain as the release/recovery record. This procedure does not claim production has already
migrated. Preserve the existing database, Papermark, approved branding and
institutional accounts. Zoho and branding redesign remain deferred.

## 1. Confirm the release and recovery point

- Source: `athenacenterpl-cmd/Apri-Site`. Stage 4 PR #41 is based on main;
  Stage 5 PR #42 is stacked on Stage 4; `feature/stage3-publishing-workflow`
  is stacked on Stage 5. Check the FINAL Stage 3 pull-request head and its
  complete CI, not an earlier green run or the existence of a branch.
- Back up Claude's uncommitted work separately. Compare it before reuse;
  never force-push a stale checkout over main or the reviewed branches.
- Record the current Vercel deployment, connected Git/mirror repository,
  source commit, database project/branch and responsible cutover owner.
- Take an available Neon recovery point/database branch. Use APRA production,
  NOT the University Tracker database. Save deployment/environment/DNS
  settings privately. Record representative subscriber ids/terms, assignment
  and release counts, and confirm old-site reader access before changes.
- Pause staff publishing during migration/deployment; readers need not be
  signed out for an additive schema update. Keep a rollback deployment ready.

Neon SQL Editor READ-ONLY inventory (no assumed migration-ledger table):

~~~sql
select current_database() as database_name,
  to_regclass('public.subscribers') as subscribers,
  to_regclass('public.review_publication_editions') as review_editions,
  to_regclass('public.publication_categories') as categories,
  to_regclass('public.publication_summaries') as summaries,
  to_regclass('public.publication_workflows') as editorial_workflow,
  to_regclass('public.admin_security') as staff_security,
  to_regclass('public.publication_notice_events') as publication_alerts;
~~~

## 2. Apply only missing reviewed migrations

Copy each COMPLETE reviewed file from the release branch into the correct
Neon SQL Editor. Confirm success before proceeding. Earlier migrations must
already be present; follow the README, not a guessed `schema_migrations` ledger.

| Order | File |
|---|---|
| 1 | `20261114_publication_catalogue.sql` |
| 2 | `20261114_publication_editorial_metadata.sql` |
| 3 | `20261115_stage3_publishing_workflow.sql` |
| 4 | `20261115_stage4_operations_security.sql` |
| 5 | `20261115_stage5_publication_notifications.sql` |

Stop on errors. Do not run partial fragments, `schema.sql` over production or
every historical backfill merely because a ledger is absent. Review/retry a
five-second lock-timeout rather than removing constraints. New migrations make
no provider calls or email sends. If the existing app role is restricted,
verify its privileges on new objects; do not swap in an owner credential to
hide a permission error.

## 3. Merge and deploy the exact combined result

1. Merge PR #41 into main.
2. Retarget PR #42 to main, inspect its diff/checks, then merge.
3. Retarget the completed Stage 3 PR to main, check the final combined result,
   then merge. Use Create a merge commit where available to preserve stack
   ancestry. Retain branches until live acceptance.
4. In the EXISTING APRA Vercel project, inspect the connected repository. If
   it deploys from a mirror, trigger that mirror's existing sync. Verify the
   deployed source includes the intended changes. Do not create an empty
   replacement project/database.
5. Leave `SITE_REDIRECTS_ENABLED` disabled initially. Preserve existing
   `SESSION_SECRET`, `CRON_SECRET`, database and provider keys.

## 4. Prove the existing APRA host first

On `https://apri.athenacentre.org`, record pass/fail with controlled readers:

- All five paid plans; current/expired/suspended accounts; January/May issue
  dates, a paid-period gap, Allow and Block; sign-in and remembered return visit.
- Actual PDF reading, correct-reader watermark and permitted downloaded PDF.
- Two review readers with different assignments: code receipt, all and only
  assigned published editions, return visit, removal/withdrawal/download/sign-out.
- New editorial draft → review → owner approval without premature release.
- One controlled correction using actual publications: first-page/every-page
  embedded notices/current link, retained original, confirmed old-link
  retirement and former first-party bookmark.
- Search/categories/summaries, Admin tools, access readiness and worker jobs.

A failure holds the cutover. Do not test by impersonating a real subscriber,
send a bulk test announcement, or treat mock-provider checks as live evidence.

## 5. Add the new domain and verify HTTPS

1. Vercel → APRA project → Settings → Domains: add `athenaadvisory.ng` and
   `www.athenaadvisory.ng` to the SAME project.
2. In the company's Go54 account, copy the EXACT DNS values Vercel displays;
   do not guess an old IP/CNAME. Preserve existing MX/TXT/mail-verification
   records, the Athena Centre root site and Papermark's document domain.
3. Wait for valid configuration and HTTPS certificates. Open the new host
   on desktop/mobile, while retaining the old APRA hostname.

## 6. Configure the new origin and test it before redirects

In Vercel PRODUCTION set `PUBLIC_SITE_URL=https://athenaadvisory.ng`; review
and update an existing `APP_URL` to the same origin. Keep the redirect flag
disabled and other secrets unchanged. REDEPLOY: environment edits do not
modify an existing deployment. Repeat the controlled reader/PDF/inbox checks
on the NEW host and compare the recorded data/terms/assignments.

Every browser needs one fresh sign-in on the new domain: unrelated-domain
cookies cannot transfer. Accounts and entitlements remain in the same database.
Remembered subscriber access then resumes; review retains its existing 24-hour
session. Never copy cookies or put tokens into cross-domain redirects.

Keep the existing verified email sender/reply mailbox unless a new sender
is separately approved and verified with SPF/DKIM/DMARC. Moving the website
does not create mailboxes or migrate inbound email.

## 7. Enable safe redirects

After new-host acceptance, set `SITE_REDIRECTS_ENABLED=enabled`, redeploy and
check old public URLs reach the SAME path on the new host via 308, plus genuine
404s, mobile navigation and private/no-store/noindex on protected routes.

Do NOT blanket-redirect the old domain through Vercel/Go54. The application
intentionally retains old `/api/` endpoints, POSTs and `/review/verify` for
pending request confirmations; other old bearer callbacks lead to a fresh
sign-in without forwarding tokens. Keep the old host while integrations use it.
No shared public or protected offline caching is introduced.

## 8. Check workers and notifications

In the SOURCE repo Settings → Secrets and variables → Actions:

- Secret `CRON_SECRET`: keep the existing matching Vercel value private.
- VARIABLE `APRA_SITE_URL`: `https://athenaadvisory.ng`.

All three workers allow only the approved old/new origins and send the secret
in the Authorization header without following redirects:

1. Run **Papermark access worker** on main. Confirm its response says
   `ok: true`, then inspect Access Health/review readiness. This also continues
   version-retirement jobs. A green setup-reminder-only run did no work.
2. Run **Operations health worker**; inspect actual problems and provider
   evidence. Alerts and destructive retention remain owner-controlled.
3. For **Publication notification worker**, first prove the sender and real
   controlled inbox receipt. Review/approve the baseline in Admin → Publication
   alerts, and enable `DATAROOM_NEW_DOCUMENT_EMAILS=enabled` for the intended
   rollout. BOTH controls are needed. Existing released editions are excluded
   from first-release announcements; rename/sync/repair sends nothing.

Accepted means provider acceptance, not delivery. Check the inbox and delivery/
bounce evidence; do not repeatedly resend an unknown outcome. These saved jobs
need no new always-on host or per-minute Vercel cron.

Review Resend/Papermark webhook destinations. Keep the working old endpoint
until the new one is proved; edit the existing subscription/signing-secret
configuration deliberately and avoid duplicate subscriptions.

## 9. Search, communication and monitoring

- Verify the new domain and exact old APRA property in Search Console, submit
  `https://athenaadvisory.ng/sitemap.xml`, inspect public canonicals/indexing and
  use the applicable Change of Address process. This needs the organisation's
  Google login; do not move the whole Athena Centre site's property.
- Keep old redirects at least a year, longer where issued links/contracts
  require. Monitor indexing, errors, delivery, access backlog and field
  performance. Lab scores do not guarantee rankings or real-user Web Vitals.
- After live checks pass, tell readers the new address, unchanged access/terms
  and one fresh sign-in. Resume staff publishing under the confirmed controls.
  Record final deployment, migration results, acceptance and responsible owner.

## Stop / rollback

If access or PDF protection fails, hold the announcement and redirect step.
Disable redirects and restore the prior application configuration/deployment
as appropriate. Keep additive tables, audit/evidence, customer data and saved
jobs; never drop used history to make rollback pass. Pause publishing during
investigation, and check old-host sign-in/callbacks. Cached permanent redirects
cannot be reversed instantly for every browser/search engine.

Supporting guides: `stage3-publishing-and-versions.md`,
`stage4-operations-security.md`, `stage5-quality-and-notifications.md` and
`athena-advisory-domain-migration.md`.

Primary references:
- https://vercel.com/docs/domains/working-with-domains/add-a-domain
- https://vercel.com/docs/environment-variables/managing-environment-variables
- https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes
