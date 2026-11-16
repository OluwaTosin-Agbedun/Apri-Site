# Stage 5 — quality checks and publication alerts

Date: 15 November 2026. Branch: `feature/stage5-quality-migration`.

This work retains Papermark, the existing designs and fonts, the subscription
catalogue, paid periods, individual Allow/Block decisions and the separate
subscriber and Complimentary Review sign-ins. Branding, Zoho and replacement
PDF technology are outside this change. Domain cutover has not been performed.

## Why subscribers missed new-publication emails

The earlier automatic sender looked only at files first seen in the preceding
hour. A link prepared after a rate limit or a later repair fell outside that
window. Sync and notify also wrote notification rows without actually sending
them. Some old sends recorded no provider message id, making delivery evidence
impossible to correlate. A title-dependent version fingerprint could confuse a
rename with a substantive update.

The replacement records announcements and recipient jobs in Neon. It has no
one-hour expiry and makes **no Papermark calls**. The existing access worker
continues to prepare links under its shared provider budget. The email worker
waits for that saved verification, checks the same access policy as the portal,
then checks again immediately before claiming the send.

## Normal publication workflow

1. Upload/sync the PDF and complete its publication record, plan assignments
   and editorial date. An upload or draft alone sends nothing.
2. Approve its paid release through the existing publication controls. Once
   alerts have an approved baseline, the first paid release creates one saved
   announcement, even if the editorial record is still a draft used for paid
   distribution. This deliberately preserves the separate paid-release rule.
3. The worker prepares recipient jobs for current subscribers who existed
   before that announcement, applies the shared edition-date/plan/exception
   policy and waits where metadata or a personal copy is unresolved.
4. A ready recipient receives an email with the public teaser and **Open my
   library**, leading to the authenticated `/portal`. It contains no Papermark
   bearer link, protected summary, original PDF or other reader's identity.
5. Admin → Publication Alerts shows pending, held, accepted, failed, unknown
   and cancelled outcomes. Accepted means the provider took the message;
   delivered requires separate delivery evidence. Stage 4's Operations page
   provides those diagnostics once that branch is integrated.

A newly activated person is served by the existing two-message onboarding.
The announcement worker does not backfill earlier release events for newly
created seats or seats whose welcome tracking started after the event.

An individually approved historical edition remains possible through Allow.
An expired or suspended subscription remains blocked. Unresolved access is
held for a later check rather than described as expired or successfully sent.

### Substantive corrected publications

After the revised copy is approved and ready, an owner can open **Notify readers
of a substantive approved update**, choose the released edition, enter one
version label and reason, confirm it and enter their own current password.
This queues an update and cancels older unsent announcements for that edition.
Reusing the version label cannot create another event. Renames, syncs, analytics
polls, repairs and re-offering the same first edition do not send another alert.

This explicit step avoids guessing a PDF change from a title or provider
timestamp. Any later Stage 3 version-management controls must retain this
approval and event identity when integrated.

### Preferences and retry rules

- `/portal/preferences` changes only that signed-in subscriber's publication
  emails. It cannot modify another subscriber or stop sign-in/onboarding mail.
- Permission and preference changes before send cancel or hold the job.
  An email already handed to the provider cannot be recalled; its library link
  still enforces current permissions when opened.
- A known temporary rate-limit refusal retries with backoff, at most three
  automatic attempts. An owner may retry a known refusal after correcting it.
- A timeout, provider fault or interrupted sending lease is **unknown**. The
  system never automatically resends it or calls it delivered. Inspect provider
  evidence privately before deciding on a separate communication.
- Job ids give stable provider idempotency keys; an approved public-body change
  gives the payload a distinct fingerprint only on a known-refusal retry.
  Accepted and unknown jobs are never retried automatically.
- Event and job leases prevent overlapping workers from sending the same job.
  A final compare-and-set detects changed policy inputs. Provider acceptance
  and the existing engagement event are recorded together with the message id.

## Rollout — sending stays off by default

1. Review and merge the intended Stage 3, 4 and 5 commits together. Re-run CI
   on the exact combined result. Do not overlay older uncommitted SEO/search
   work or stale PR #40 changes on top of the current libraries.
2. Apply `db/migrations/20261115_stage5_publication_notifications.sql` after
   the preceding migrations. It is additive and idempotent. It creates no
   email audience or provider calls and defaults to disabled. Existing reader
   routes continue working before it is applied.
3. Deploy the intended code through the normal source/mirror process. The
   migration should precede enabling the worker; deployment is not proof of
   inbox delivery or live Papermark behaviour.
4. First verify a controlled test deployment with isolated subscribers and
   approved test inboxes. Confirm first release, delayed link, a Block, an
   expired term, preference off, one approved correction and a double worker.
   Confirm both provider acceptance and actual inbox receipt. Do not release a
   dummy edition to real paid audiences for this test.
5. Verify the production sender and `RESEND_API_KEY`. To enable production
   sending, set `DATAROOM_NEW_DOCUMENT_EMAILS=enabled` and redeploy; then an
   owner reviews the counts in Publication Alerts, records the approval reason,
   confirms the baseline and enters their own password. Both gates are needed.
   Existing released editions are baselined without automatic emails. Re-enabling
   also baselines editions released while paused; older saved jobs remain.
6. In the **source repository**, the existing `CRON_SECRET` must match Vercel.
   Run Actions → Publication notification worker once and inspect the JSON
   result. A Setup reminder means it did not process work. No new secret is
   required. The mirror workflow is not used to run this worker.
7. The worker runs hourly at minute 31 (GitHub schedules can be delayed). Each
   run fans out up to 20 candidate subscribers for one announcement and sends
   up to 10 due jobs within a 45-second processing budget. Admin's **Process a
   bounded batch now** can advance the same saved queue. Held jobs retry after
   15 minutes when a worker runs. Large audiences take several runs; this is
   explicitly reported rather than promised as instant delivery.
8. The source preferred repository variable `APRA_SITE_URL` (legacy `APRI_SITE_URL` remains supported), if set, must be exactly
   `https://apri.athenacentre.org` or `https://athenaadvisory.ng`. Curl does not
   follow redirects with the worker's secret. Leave the default until the
   domain cutover is approved.

Pause from the owner setting or hosting flag to stop future attempts. In-flight
provider requests cannot be unsent. Keep jobs/history during application
rollback. The SQL rollback refuses after any baseline, preference, event or
audit record has been used; it is intended only for an unused feature.

Read-only checks (no addresses or personalised links):

```sql
select enabled, baseline_at, worker_at from publication_notice_settings;
select state, count(*) from publication_notice_events group by state;
select state, count(*) from publication_notice_jobs group by state;
select count(*) as accepted_without_id from publication_notice_jobs
where state='accepted' and provider_message_id is null;
```

## SEO check record

Status refers to repository and isolated production tests, not a claim that
the current deployed site has changed. CI's browser report is separate evidence.

| Check | Previous status | Action taken | Current status | Manual action required |
|---|---|---|---|---|
| 1. Sitemap | No sitemap route | Explicit public-page allowlist; previews empty; no private editions or fake modification dates | Unit/HTTP checks | Submit on the final domain in Search Console |
| 2. Robots | No robots route | Public navigation allowed; private paths disallowed; preview deny-all | Unit/HTTP checks | Verify deployed response on each host |
| 3. Indexing | Root noindex inherited by public pages | Public metadata opts in; private pages stay noindex; unknown/preview hosts receive noindex headers | Unit/HTTP checks | URL Inspection after deployment |
| 4. Canonicals | Missing explicit canonicals | One validated configured HTTPS origin and path per public page | Unit/HTTP checks | Update only at approved cutover |
| 5. Titles | Scattered, incomplete social metadata | Unique page titles, approved visible wording retained | Unit/HTTP checks | Editorial review if brand copy changes |
| 6. Descriptions | Scattered defaults | Unique public descriptions, no protected summaries | Unit/HTTP checks | Editorial approval for future copy |
| 7. Primary H1 | Existing public headings | One H1 checked on each public information page | HTTP/browser checks | Review future page additions |
| 8. Heading order | Services skipped H2 before H3 | Added an accessible section heading without changing visible design | Browser audit | Manual screen-reader pass |
| 9. Image alternatives | Existing portrait alt text | Preserved meaningful names, explicit decorative handling; missing-alt checks | Browser audit | Check future uploads and meaningful images |
| 10. Structured data | No site graph | Safe Organization/WebSite JSON-LD using established current identity only | Unit/HTTP checks | Rich Results/schema validation on final domain; no invented ratings |
| 11. Internal links | Broken OPEN-detail anchor | Redirect now reaches existing `review-publications`; standard navigation retained | HTTP crawl of public links/anchors | Check real editorial records after deployment |
| 12. Broken links | No repeatable production crawl | HTTP crawl of seeded internal pages/anchors; external public references listed for manual verification | Internal checks; external sites NOT VERIFIED | Verify Athena Centre and any editor-supplied URLs; never crawl signed private links |
| 13. Images | Portraits used raw img | Sized Next Image with responsive sizes, quality 90 and AVIF/WebP for approved Blob uploads | Build/browser checks | Visual comparison on real portraits; arbitrary external URLs remain browser-direct |
| 14. Core Web Vitals | No acceptance runner | Production mobile lab LCP/CLS and interaction-duration sample; performance budgets | Browser CI evidence required | Field LCP/INP/CLS after sufficient traffic; lab is not field INP |
| 15. Mobile | No repeatable cross-width check | 375/768/1440 public-page checks; subscriber plans, review and owner screen | Browser CI evidence required | Real iOS/Android and keyboard/screen-reader pass |
| 16. HTTPS/mixed content | Vercel TLS and HSTS existed | Preserved security headers; allowlisted HTTPS canonical; mixed-resource checks | Local HTTP/unit checks; live TLS NOT VERIFIED | Domain verification, TLS and HTTP→HTTPS proof in Vercel |
| 17. Slugs/redirects | Existing URLs have value | Preserved slugs; opt-in same-path 308 host migration; tokens never forwarded | Unit/HTTP checks | Approve cutover and verify production mapping |
| 18. Sharing | No complete first-party social image | 1200×630 first-party OG image and page-specific Open Graph/Twitter metadata | Build/unit checks | Inspect sharing preview after final deployment |
| 19. Search Console | No explicit verification option | Optional validated `GOOGLE_SITE_VERIFICATION`; sitemap/robots/canonicals ready | Code ready; account NOT VERIFIED | Owner login, DNS/property verification, sitemap submission and URL Inspection |
| 20. llms.txt | Absent | Public navigation aid only; explicit private boundaries; no discovery promise | Unit/HTTP checks | Optional editorial review; no ranking/security guarantee |

Legal pages and individual publication detail records intentionally remain
noindex pending policy approval. Existing request-confirmation links at `/review/verify` continue to verify on
the original host during migration, with no cross-domain token forwarding.

Private PDFs, signed URLs, reader email
addresses, engagement and protected summaries are absent from public discovery
outputs. Robots is a crawl preference, not an access-control mechanism.

## Existing-functionality impact

The production dependency audit also identified published fixes missing from
the original lockfile. This branch updates Next/eslint-config-next to 16.4.6,
the Blob SDK to 2.9.0 and Zod to 4.6.7. Targeted same-major transitive overrides
raise source-map-js to 1.2.2 and remaining Zod 4 copies to 4.6.7. The Blob API
continues to use explicit public access and unique headshot names; institutional
storage and existing image URLs are unchanged. ESLint remains on the compatible
9.x line required by the current React/accessibility plugins. The full tests
and build must pass after these updates; dependency audit is evidence about
known package advisories, not proof that every possible vulnerability is absent.

| Area | Behaviour after this change | Compatibility/limit |
|---|---|---|
| Subscriber sign-in | Existing server sessions and codes retained; renewal proxy now discovered in `src/` | No cookie transfer between unrelated domains |
| Request proxy | Root implementation is called by a statically configured `src/proxy.ts` entry point | Production tests found root proxy was not discovered beside `src/app`; optimistic Admin checks, renewal and new indexing/migration headers now actually execute |
| Paid access and downloads | Existing shared policy and Papermark viewer unchanged | No new room-wide URL or entitlement bypass |
| Complimentary Review | Existing approval, assigned editions, one-code session and current download policy retained | Publication alert queue is paid-subscriber only |
| Sync and notify | Renamed Sync and check alerts; reports queued/held/paused honestly | It no longer writes a false "sent" row or sends inline |
| Manual publish alert | Uses the same durable event, queued rather than immediate | Requires approved baseline; same first event cannot duplicate |
| New-release emails | Durable, access-checked jobs replace first-hour sweep | Default paused; explicit enablement required |
| Corrected-edition emails | Explicit owner-approved version/reason | No guess from filename, title or Papermark timestamp |
| Search/summaries/categories | Existing restricted data and all configured categories retained | Integration tests must be rerun against final Stage 3 commits |
| Fonts and branding | Existing fonts, logo/copy and brass decoration retained | Small brass text uses a darker accessible text variant |
| Public URLs | Stable paths retained | Cutover switches remain disabled |
| Loading/errors | Existing route-local loading stays; viewer retry remounts safely; genuine 404 retained | No root streaming boundary that turns missing pages into HTTP 200 |

## Repeatable verification

`pnpm test`, `pnpm exec next typegen`, `pnpm exec tsc --noEmit`, `pnpm lint`,
`pnpm build`, `pnpm check:secrets --all`, `pnpm audit --prod` and
`pnpm check:browser` are the relevant checks. The last command requires a normal
Chromium environment (`pnpm exec playwright install --with-deps chromium`).
It refuses real `.env` files, strips inherited provider credentials, creates an
in-memory database, seeds invented records, builds the production app and blocks
external provider traffic. It checks public pages at three widths, each paid
plan, review assignments, keyboard navigation, preference saving, axe WCAG A/AA
rules and lab responsiveness. Output is under ignored `browser-results/`.

`node scripts/check-browser.mjs --http-only` runs only the production HTTP
checks when a local browser cannot start. It explicitly reports browser,
accessibility and performance as NOT VERIFIED. CI runs the complete command;
an automated audit alone does not certify WCAG 2.2 AA or inbox delivery.

No real subscriber was emailed, no live PDF permissions were changed, and no
production migration, deployment, DNS update or indexing submission is part of
the implementation test run. Use controlled live acceptance before enablement.
