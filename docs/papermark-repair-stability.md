# Papermark repair stability

This release addresses repeated "Needs repair" after a successful repair. It does not
remove email verification or make a reader's 24-hour session permanent.

## What caused it

- A process-local reader-room limiter did not include other API helpers or other Vercel
  instances. Papermark budgets the token, so simultaneous jobs could exceed its limit.
- Reconciliation saved "updating", then judged that saved state after a transient error.
  Previously ready access could become "failed" solely because a check was interrupted.
- Bulk work lived only inside `after()`. A serverless timeout could abandon remaining readers.
- Unchanged groups were rewritten. A failed shared document listing was repeated for each reader.
- A missing assigned PDF could produce a partial "ready" proof that never matched the reader's
  full assignment, causing another reconciliation on every open.

## Result

All Papermark fetches share one database-backed token clock (default 45 requests/minute),
with a separate, stricter analytics clock. Provider resets and Retry-After delays are saved
and respected. Short waits are bounded; longer waits become persisted retry jobs.

One reader has one job. Duplicate Repair clicks coalesce; an actual input change advances
its generation. The worker renews an owned lease and fences stale work. A known returned
link ID is saved before read-back, so a rate-limited verification does not create another
link. An unchanged maintenance check preserves matching verified access on temporary
failure. Changed assignments are not declared ready without complete provider verification.
Missing PDFs and incorrect protections remain actionable faults, rather than endless retries.

Member and permission writes occur only for actual differences. Normal reads of a matching
ready room make no room-reconciliation API calls. Opening a new 24-hour session may still
require a small verified expiry update. Paid repairs reuse verified reads for the same input
generation for at most 15 minutes, allowing an interrupted batch to resume; new Admin changes
invalidate them. Temporary limits leave existing paid links intact and record a pending retry.
The worker never activates a subscriber or sends onboarding/publication email.

## Deployment: source repository, Neon, mirror

1. Pause Claude's competing limiter/queue work. Preserve its unfinished SEO/search work.
   Once this PR is merged, have Claude update from main and use this queue rather than
   introducing another limiter, job table or migration.
2. Review the PR and its CI checks. In Neon, create a backup branch of the production database.
3. In the PR, open `db/migrations/20261012_papermark_work_queue.sql`. Copy the **whole file**
   into Neon SQL Editor on the production database and run it once. Existing migrations
   through `20261011` must already be applied. The migration is additive and rerunnable;
   it makes no Papermark requests, changes no recipient assignments and sends no email.
   Failed/updating/closed reader records are queued for verification, not declared repaired.
4. Merge the source PR into `athenacenterpl-cmd/Apri-Site` main.
5. In the Vercel mirror repository, run its existing **Sync from first repo / Sync from main**
   workflow. Wait for a successful sync and Vercel deployment of the merged commit.
6. Keep the existing Vercel `CRON_SECRET`. In the **source** repository, open Settings →
   Secrets and variables → Actions → New repository secret. Name it `CRON_SECRET` and
   copy the existing value from Vercel. Do not put it in chat, code, a URL or workflow logs.
7. Source repository → Actions → **Papermark access worker** → **Run workflow** → main.
   Its successful result contains counts only. It also runs hourly, at minute 17 UTC.
   The mirror does not copy source workflows; the worker calls the deployed site directly.
8. Admin → Review Library: saved jobs show Checking access / Waiting — retry scheduled.
   While that page is open it refreshes every 15 seconds and starts bounded worker slices.
   Wait for the confirmed Ready result; duplicate Repair clicks do not help.
9. Repeat Run workflow if you want faster unattended draining of a large initial backlog.
   A slice handles at most two readers and one due paid subscriber. The same shared budget
   applies to overlapping manual runs and normal API use.

Hobby permits only daily Vercel cron schedules. No per-minute Vercel schedule is added.
The hourly GitHub worker uses the source repository's Actions allowance; check Actions
usage if the repository is private. Without its secret, the workflow skips calls: repairs
resume during Review Library visits and daily sync, but hourly unattended recovery is not
configured. Vercel Pro could instead schedule the same authenticated route every minute.

## Checks after deployment

Use a controlled approved reader and a controlled subscriber first:

- Repair the reader once. Confirm Ready, then Check again with unchanged assignments:
  the URL/group identity stays the same and the access remains usable.
- Read two assigned PDFs in the same signed-in browser; downloads and watermark still work.
- Return within the same 24-hour session. No new APRI code or manual repair is expected.
- Add/remove an assignment on the test reader. The current APRI assignment is enforced on
  every open; the job remains pending until Papermark confirms its permissions.
- A withdrawal/removal that Papermark cannot confirm is not described as complete. Its
  existing external link may remain usable until Papermark closes it. An urgent failure
  explicitly names the manual link-removal task in the owner-only interface; the job retries.
- Confirm the test subscriber still opens entitled documents and cannot open excluded ones.
- Confirm the worker result and queue counts improve rather than restarting the same readers.

Read-only Neon checks (no email addresses or link URLs):

```sql
select state, count(*) from review_reader_room_jobs group by state order by state;
select state, count(*) from review_reader_rooms group by state order by state;
select state, count(*) from subscriber_access_reconciliations group by state order by state;
select count(*) as active_cooldowns from papermark_api_budgets where cooldown_until > now();
```

A real missing PDF, wrong watermark, broad group grant, rejected token or unknown creation
outcome still needs owner attention. If a POST timed out without returning an ID, inspect
Papermark and record the correct existing object before clearing `uncertain_creation`;
never blindly create another link. A routine 24-hour expiry is not a damaged room.

This release is verified locally with an isolated PostgreSQL engine and a mock provider.
Live provider delivery/permission behaviour must be confirmed after deployment; passing
local tests is not proof that a production Papermark token has the required scopes.
