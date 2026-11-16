# Athena Advisory domain migration — prepared, not executed

Date: 15 November 2026. Target: `https://athenaadvisory.ng`.

The approved public brand/legal copy and visual identity must be settled
separately. This code does not substitute legal names, branding or Zoho
integration. It retains the current website and Papermark. Do not let a domain
switch become an unreviewed publication or security-policy change.

## Preserved data and service dependencies

| Component | Required action | What must be proved |
|---|---|---|
| Institutional ownership | Athena company Go54/domain and Vercel accounts retain administrative control | Named administrators and recovery contacts confirmed |
| Neon | Keep the existing production database and credentials; no re-import of subscribers | Subscriber ids, paid periods, plan assignments, exceptions, review recipients and publication/version history match before/after |
| Vercel | Add and verify new domain, DNS and TLS; retain old domain | Both hosts serve intended deployment; HTTPS redirect/HSTS; no mixed content |
| First-party URL configuration | Build with `PUBLIC_SITE_URL=https://athenaadvisory.ng`; update any old `APP_URL` | Canonicals, sitemap, social metadata and newly issued email links use the approved origin |
| Email | Retain existing verified sender until a new sender/domain is approved and verified | SPF, DKIM, DMARC, reply mailbox, Resend acceptance and actual inbox receipt; changing website origin does not move mailboxes |
| Papermark | Keep team, document ids, reader groups, personal links and current watermark/download settings | Named readers open only assigned PDFs; permitted downloads remain personalised; no original/unmarked file exposure |
| Protected browser state | Require a fresh subscriber/review sign-in on new domain | No unrelated-domain cookie transfer, no copied auth cookies or tokens in redirects |
| Old email links | Retain old host; safe redirect to fresh sign-in for bearer-token routes | Old token/code never appears in a new-domain URL or referrer; clear first sign-in instructions in customer communication |
| APIs/webhooks | Keep old `/api/` endpoints during transition; separately update provider destinations | Resend/Papermark signatures, delivery correlation and replay safety work on selected endpoints; POSTs are not redirected across domains |
| Workers | Review Vercel cron plus source GitHub workflows | Existing shared access worker stays ready; publication worker uses approved repository `APRI_SITE_URL` variable and matching CRON_SECRET; old API host retained until any worker URLs are changed and proved |
| Search Console | Verify old and new properties; submit new sitemap and inspect public URLs | Correct public index/noindex, canonicals, redirects and indexing coverage; change-of-address process where applicable |
| Customer communication | Explain new address and one fresh sign-in on the new domain | Existing subscriptions/expiry dates and review assignment rules unchanged; no claim that all browsers can retain their old cookies |

Do not publish email DNS records or database credentials in tickets or this
repository. Do not change the signing key merely to change the domain: it would
invalidate existing sessions unnecessarily. Keep the existing access-repair
queue and Papermark budgets throughout the transition.

## Launch sequence

1. Confirm the exact combined Stage 3/4/5 commits and required additive
   migrations, backup/restore evidence, owner/incident responsibility and
   a rollback deployment. Verify data inventory before changes.
2. Add the new domain to the existing Vercel project, obtain verified DNS/TLS,
   and test a controlled deployment using the intended code. Keep the old
   domain and existing sender working. `SITE_REDIRECTS_ENABLED` stays disabled.
3. Confirm native website journeys, current Papermark embeds, personalised
   downloads/watermarks, code delivery and permission removal with controlled
   readers. Check every plan and January/May dates, Allow and Block.
4. At the approved window, update `PUBLIC_SITE_URL`, review `APP_URL`, rebuild
   and set `SITE_REDIRECTS_ENABLED=enabled`. Normal GET/HEAD URLs on the old
   domain (and the new www alias) return a permanent 308 to the same path on
   `https://athenaadvisory.ng`. Stable slugs are retained. Sensitive query keys
   are discarded; old sign-in callback paths lead to fresh sign-in. APIs and
   POSTs remain on their existing endpoint. The old `/review/verify` callback
   also stays on its original host so pending review requests can confirm
   their address against the same database without forwarding the token.
5. Test public redirects, protected cache headers, new email URLs and fresh
   sign-in before announcing. Update approved provider callback URLs and
   worker origins deliberately; never follow a redirect while sending a
   CRON_SECRET. Do not remove the old API host prematurely.
6. Update approved customer/public references and Search Console. Monitor
   errors, indexing, delivery, access backlog and performance. Retain the old
   domain and useful URL redirects for at least a year (longer where existing
   contracts or published links require it).

### Rollback

Disable the redirect flag and restore the previous application configuration
and deployment. Keep the existing database, additive migrations, events and
worker jobs; do not undo reader assignments or erase notification history.
Check old-host sign-in and provider callbacks again. Permanent redirects may
already be cached by clients/search engines, so rollback cannot guarantee
instant reversal everywhere. This is why cutover remains an explicit final
approval after the complete reader/migration demonstration.

## Manual acceptance record

Record the deployment sha, test time, controlled test accounts (privately),
actual inbox receipt, exact current publication filenames and pass/fail for:

- Paid and review code flows, repeat visit, sign-out and removal.
- All plan/date exceptions, download rights and each-page watermark identity.
- Existing public slugs, 404s, fragment links and redirect maps.
- Approved-domain TLS, indexable public metadata, robots/sitemap and noindex
  protected pages, private/no-store caching and no protected offline cache.
- Resend/Papermark webhooks and worker continuation without a rate-limit storm.
- Keyboard, zoom, screen-reader, iOS/Android and measured performance.

Real-user targets are LCP ≤2.5 seconds, INP ≤200 ms and CLS ≤0.1, assessed at
the 75th percentile once enough field data exists. Local lab checks help find
regressions; they cannot guarantee Google rankings or all real-user devices.

Primary references:

- Google site moves: https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes
- Google robots/noindex: https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- Core Web Vitals: https://web.dev/articles/vitals
- Resend idempotency limits: https://resend.com/docs/dashboard/emails/idempotency-keys
