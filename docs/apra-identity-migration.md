# APRA identity and domain migration

Updated 16 November 2026. The approved current name is **Athena Political &
Regulatory Advisory (APRA)** and the public origin is **https://athenaadvisory.ng**.
This identity update precedes final live subscriber/review acceptance, worker
configuration and activation of old-host redirects. Fonts, colours and layout
are retained. Papermark remains the document provider; Zoho is deferred.

## Coverage

The website header, homepage/About, shared footer, team copy, services,
subscription presentation, enquiry forms, privacy/terms, public metadata,
structured data, llms.txt and generated social image use the new identity.
Subscriber sign-in/code/continue screens, all plan libraries, preferences,
document/denied/preparing states and Admin labels use APRA. Review requests,
confirmation, code entry, assigned libraries and access notices do likewise.
New emails use APRA subjects/display names and updated full-name signatures.
New provider link labels, edition codes and watermark text use APRA.

Saved promotional descriptions are presented with current platform naming;
their source records are not rewritten. Publication titles and approved
protected summaries retain their exact editorial text. Previously issued PDFs,
agreements, audit records, received emails and downloaded copies are historical
records and are not rewritten or recalled.

The wordmarks and social preview are rendered from editable text; the only
bundled binary asset is the licensed PDF-notice font. There is no bundled
image/logo containing the former name to replace.

## Intentional compatibility references

| Reference retained | Reason |
|---|---|
| Old host in `site-config.ts`, proxy and superseded-PDF allowlists | Old URLs, callbacks, notices and token-safe redirects must remain recognised; it is not the current public address |
| `APRI_PRODUCTION_URL` export | Deprecated historical-origin export; current links use `siteOrigin()` and `APRA_PRODUCTION_URL` identifies the current origin |
| `apri_*` cookies and existing token/crypto contexts | Existing sessions, sign-in codes, encrypted staff factors and recovery hashes remain valid |
| Existing worker concurrency groups and idempotency identifiers | Overlapping workers and retries retain their established identity |
| `APRI_SITE_URL` | Backward-compatible Actions variable; `APRA_SITE_URL` is preferred when the operator configures workers |
| Existing verified sender-address fallbacks | Renaming the display name does not verify or create a new mailbox; configured sender addresses keep precedence |
| Legacy agreement-type identifiers | Database validation and existing signed records retain their stable identifiers; Admin presents APRA wording through the display formatter |
| Internal host-set and test-harness identifiers | These are not display labels and retain their existing runtime/test contract |
| Historical `APRI-…` edition codes and migration/test fixtures | Existing editions and copy identifiers remain recognisable; the formatter accepts both old and new prefixes |
| Source/mirror repository names, Vercel project and provider IDs | These identify the existing deployment and accounts; they are not public brand labels |
| Former name in the display formatter | Matches saved promotional wording to display the current name without altering the underlying record |

No database migration, historical backfill, new access grant, provider batch,
email send or session rotation is required by this identity update. Existing
provider links receive current labels/watermarks only through their normal
verified preparation/repair path; there is no bulk provider rewrite.

## Deployment and remaining acceptance

1. Merge the checked identity branch into source `main`.
2. The operator runs **Sync from first repo** in
   `OluwaTosin-Agbedun/Apri-Site`. The agent does not trigger mirror sync.
3. Confirm the existing `apri-site-r3kn` Vercel project deploys the resulting
   mirror commit to Production and reaches Ready.
4. Keep `PUBLIC_SITE_URL` and `APP_URL` set to `https://athenaadvisory.ng`.
   Keep `SITE_REDIRECTS_ENABLED=disabled` during controlled live acceptance.
5. Check public/mobile pages, the About/footer address, page titles and social
   preview; then subscriber and Review Library sign-in, actual inbox receipt,
   assigned PDFs, current watermarks/downloads and return visits.
6. At the worker configuration step set source Actions variable
   `APRA_SITE_URL=https://athenaadvisory.ng`. Existing `APRI_SITE_URL` is a
   fallback; an unset pair retains the old worker origin until that step.
   Preserve `CRON_SECRET`; inspect actual worker JSON, not only a green run.
7. Enable publication emails only after controlled inbox proof and an approved
   no-backfill baseline. Preserve the existing two sending gates.
8. After acceptance, enable safe application redirects and verify old public
   URLs, old sign-in callbacks, no loops and protected no-store/noindex. Keep
   the old domain attached and preserve working provider callbacks.

Repository/browser checks use invented data and provider mocks. Passing them
does not establish live inbox delivery, provider watermark rendering, an actual
database restore, Search Console verification or field Core Web Vitals. Those
checks remain explicit migration/handover items.
