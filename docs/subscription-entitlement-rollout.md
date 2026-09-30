# Subscription edition entitlement rollout

1. Confirm the deployment database already has `20260828_papermark_datarooms.sql`, `20260830_subscriber_document_links.sql`, `20260930_subscription_activation.sql`, and `20261001_subscriber_onboarding_messages.sql`; apply only whichever of those prerequisites is recorded as unapplied.
2. Apply `20261003_subscription_edition_entitlements.sql` **before** deploying this application version. The previous application ignores its additive tables, so old-code/new-schema is compatible. New-code/old-schema fails closed in the portal and disables Admin edition controls, but activation is intentionally blocked; this is a recovery mode, not the normal deployment order.
3. Deploy the application. The migration only backfills rows that have both agreed dates and a recognised level; it neither invents dates nor grants undated publications.
4. Run `node scripts/subscription-access-rollout-report.mjs` with a read-only database credential. Save and review the JSON for every subscriber.
5. In **Admin → Subscribers**, correct missing editorial edition dates and add/confirm paid periods. Never infer a start date from payment, upload or link timestamps. Review Professional records with more than three negotiated seats rather than removing anyone.
6. Review each subscriber's proposed additions/removals and missing/ambiguous rows. Use a per-publication Allow only for an agreed exception and record the reason; use Block to override otherwise automatic access.
7. Reconcile one test subscriber first with **Reconcile and verify Papermark access**. Confirm its excluded exact-document URLs and old room URL return gone, allowed links work, and another subscriber plus Complimentary Review links are unchanged. A `pending` or `failed` state is not complete; correct the reported problem and retry.
8. Reconcile remaining subscribers in batches, retry failures, and re-run the report until no affected old URL remains. Do not enable the retired unrestricted room-link route.

The migration and report do not call Papermark, send mail, revoke links, or deploy anything.
