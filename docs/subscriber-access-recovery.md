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

## The rule (from 20261005 onwards)

**An edition appears in a subscriber's portal when it is switched On, ticked for their plan, and dated within their
term.** Two individual adjustments sit on top: **Also give** (for example a back issue promised at sign-up) and
**Hide**, which always wins. Levels (L1–L4) and paid-period entries no longer need managing: plan ticks replace levels,
and the term on the subscriber's record is what counts (earlier terms are kept automatically after a renewal).

Papermark rooms are storage. A file uploaded to a plan's room ticks that plan on its edition automatically; you can
tick more plans (or untick one) on the edition. The same edition in several rooms counts once.

## Migrations and deployment order

Already applied (do not re-run): `20260930_portal_title_override.sql`, `20260930_subscription_activation.sql`,
`20261001_subscriber_onboarding_messages.sql`, `20261002_engagement_page_progress.sql`,
`20261003_subscription_edition_entitlements.sql` (confirm each is recorded as applied; apply only one that is not).

1. Apply **`db/migrations/20261004_paid_release_and_access_health.sql`**, then
   **`db/migrations/20261005_publication_plans.sql`** (both additive and idempotent). 20261005 ticks each edition's plans
   from the rooms it is in (records in no room from their old level) and keeps, as a visible "kept from before" Also give,
   every edition a subscriber can open today that the new rule would not give them. No link, term or account changes.
2. Deploy the application.
3. Rollbacks: `db/rollback/20261005_publication_plans.rollback.sql`, then `db/rollback/20261004_…`.

## Recovering and tidying, in stages

1. **Preview, read-only:** `node scripts/access-recovery-preview.mjs` (read-only credential). It lists every subscriber
   and every edition with checks (no plan ticked, no date, series/folder mismatch, a month in the file name that disagrees
   with the date) and the **switch-on candidates**: editions not switched on yet but already delivered.
2. **Fix details:** enter missing dates from the editions themselves; check flagged ones.
3. **Switch editions On:** on each publication record under **Who gets this edition**, check the plan ticks and choose
   **On**, with a reason; or, after review, `node scripts/access-recovery-preview.mjs --apply-release <ids> --reason "<why>"
   --admin-email <you>`.
4. **Controlled test:** `node scripts/reconcile-subscriber-document-links.mjs --subscriber <id>` (dry run), review, apply
   with the printed `--plan` fingerprint; confirm in the portal. Then batches (`--limit 25 --offset …`).

Nobody is reactivated, renewed, re-dated, duplicated or re-sent onboarding by any of this, and no email is sent.

## Admin guide

**Who gets this edition** (publication record): tick the plans that receive it and choose **On**, **Off** or **Not
decided yet**, with a reason. On shows it to every subscriber on those plans whose term covers its date. Off removes it.
Not decided yet gives nothing new and takes nothing away. Turning an edition On never makes it public.

**A subscriber's term** (subscriber record): their start and end date. A renewal is a new end date. They get editions
dated within their term, so someone starting on 30 September does not get a 1 September edition unless you choose
**Also give** for it.

**Also give / Hide** (subscriber page → Document access, per edition): for one person only, always with a reason.
**Automatic** removes the adjustment.

**Repair document links** recalculates and verifies one subscriber, and never emails. **Access Health** shows everyone.
