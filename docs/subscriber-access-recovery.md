# Subscriber access: incident, fix and recovery

## What went wrong (introduced in d004268 and bce8d3c, 30 September 2026)

1. **Every current subscriber was shown "Your access has ended".** The portal compared term dates with today's date
   string, but the query returned PostgreSQL `date` columns, which the Neon driver turns into JavaScript `Date` objects.
   A `Date` compared with `"2026-09-30"` is always false. Fixed in `9d0909b` (already on `main`).
2. **Nothing was released to paid subscribers.** The new eligibility required `documents.status = 'published'`, but
   the records behind Data Room editions are drafts; paid delivery had never depended on that status.
3. **Reconciliation removed what the portal needed.** It retired each subscriber's unrestricted room link, while the
   portal, sync, the webhook and the level-wide repair only reached subscribers who still held one.
4. **An empty result counted as success.** Missing term start, paid periods, schema or metadata produced "no
   eligible documents", which activation and reconciliation reported as ready, then revoked room links.
5. **Admin could not see or fix it.** Counts covered every room document rather than permitted ones, the publication
   list was blank when nothing was published, and repair ignored its own result.

## What the fix does

- **One access policy** (`src/lib/access-policy.ts`) decides, for every document: *allowed*, *excluded* (confirmed:
  ended or suspended subscription, Block, withheld, above level, outside every paid period) or *unresolved* (no
  release decision, no edition date, no publication record, no paid-period history, term dates to fix). The portal,
  viewer, download, legacy library, activation, renewal, level change, sync, webhook, notifications, Admin and the
  scripts all use it.
- **Unresolved is never a "no".** Nothing new is issued for it, and a link issued earlier stays open.
- **Paid release is its own decision**, separate from editorial status and from Complimentary Review. Until an
  administrator decides, a published record counts as released, an archived one as withheld, a draft as undecided.
- **The room is the subscriber's assignment**, not a share link. No unrestricted room link is created any more; an old
  one is retired only once every permitted document is verified and nothing is undecided.
- **One reconciliation** (`src/lib/subscriber-access-reconciliation.ts`) issues, verifies, repairs and withdraws links:
  one run per subscriber (a lease), links recorded only while the decision the run started from still stands (checked in
  the same statement as the insert), new links read back from Papermark, stored links checked for document, expiry,
  identity and security settings (reported, never changed), results and retries recorded. It never sends email.
- **The portal separates the questions**: sign-in, then the subscription (renewal only for an ended one), then the
  library ("being prepared", "no editions yet", "temporarily unavailable").

## Migrations and deployment order

Already applied (do not re-run): `20260930_portal_title_override.sql`, `20260930_subscription_activation.sql`,
`20261001_subscriber_onboarding_messages.sql`, `20261002_engagement_page_progress.sql`,
`20261003_subscription_edition_entitlements.sql` (confirm each is recorded as applied; apply only one that is not).

1. Apply **`db/migrations/20261004_paid_release_and_access_health.sql`** (additive, idempotent; changes no row, grants
   nothing). Rollback: `db/rollback/20261004_paid_release_and_access_health.rollback.sql`.
2. Deploy the application.
3. Without step 1 the portal still works (published counts as released), but repair, activation and the new Admin
   controls report that the migration is pending and change nothing.

## Recovering existing subscribers, in stages

1. **Preview, read-only.** With a read-only credential:
   `node scripts/access-recovery-preview.mjs` (or `--json`). It lists every subscriber (expected, linked, missing,
   excluded, undecided, links to be withdrawn), every paid publication record in a Data Room with checks (missing dates,
   series/folder mismatch, a month in the file name that disagrees with the edition date), and the **release backfill
   candidates**: undecided records already delivered to paid subscribers (links issued or paid views recorded).
2. **Fix the records.** Enter missing edition dates from the editions themselves (never from a file name). Check the
   flagged ones (for example a PLM file named July with a March date). Add missing paid periods from the agreed terms.
3. **Release what was already delivered.** After review:
   `node scripts/access-recovery-preview.mjs --apply-release <ids> --reason "<why>" --admin-email <you>`, or use
   **Release to paid subscribers** on each publication record. This changes no link.
4. **Controlled test.** Pick one test subscriber (for example the approved test account). Dry run:
   `node scripts/reconcile-subscriber-document-links.mjs --subscriber <id>`. Review, then apply with the printed
   `--plan` fingerprint. Confirm in the portal that they sign in, see their permitted editions and open them, and that
   their old room link no longer opens. Check another subscriber and Complimentary Review links are unchanged.
5. **Batches.** Dry run `--limit 25 --offset 0`, review, apply with its fingerprint; continue with the next offset.
   Failures are retried with backoff and shown on **Subscribers → Access Health**. No email is sent at any point.

Nobody is reactivated, renewed, re-dated, duplicated or re-sent onboarding by any of this.

## Admin guide

**Paid periods** (Subscribers → subscriber → Document access). A period is the dates a subscriber paid for, at a level.
An edition is covered when its edition date is inside a period at or above its level. Add a renewal as a new period;
leave an unpaid gap empty. If a period was entered by mistake, **void** it with a reason: it stops granting anything but
stays in the history. Never change agreed term dates to give someone an edition.

**Publication release** (the publication record page). *Released* issues the edition to every subscriber whose periods
cover it; *Withheld* withdraws their links; *Undecided* issues nothing new and takes nothing away. Releasing never makes
a paid PDF public and is independent of the Complimentary Review.

**Individual exceptions** (Document access, per publication). *Allow* gives one subscriber an edition outside their
periods, for example a back issue agreed at sign-up (someone starting on 30 September does not otherwise receive the
1 September edition). It still needs a current subscription, the right level and their own library. *Block* removes one
edition from one subscriber and always wins. *Automatic* removes the exception. Each change records who and why, then
reconciles at once and shows the result.

**Repair document links** recalculates, creates, repairs, withdraws and verifies, and never emails. **Access Health**
shows every subscriber's counts and last result.
