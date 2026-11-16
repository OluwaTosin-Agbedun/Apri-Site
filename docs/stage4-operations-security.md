# Stage 4 — staff security, delivery evidence and operations

Date: 15 November 2026. These controls supplement the existing subscriber and
Complimentary Review access systems. They do not change reader entitlements,
publication approvals, download rights or Papermark permissions.

## Deployment order

1. Keep the existing production `SESSION_SECRET` securely backed up in Athena's
   approved secret store. Do not rotate it as part of this rollout: it now also
   encrypts staff authenticator keys, with purpose-specific derived keys.
2. Take a Neon recovery point/branch and confirm the available retention window
   in the actual plan. This change does not buy or configure backups.
3. Apply `db/migrations/20261115_stage4_operations_security.sql`, after the
   existing migrations. It is additive, re-runnable and has a five-second lock
   timeout. Nothing is deleted, emailed or changed at Papermark.
4. Deploy the tested branch after integrating Stages 3 and 5. Before the
   migration, existing sign-in works and the new pages explain what is missing.
5. In Admin → Staff Security, enrol each staff account separately. Use an
   authenticator app's manual setup key (time-based, six digits, 30 seconds),
   save the ten recovery codes privately, and confirm with a current code.
   Setup revokes older staff sessions. Enrol at least two owners so recovery
   does not depend on one person's phone.
6. Only after every active staff member has enrolled should an owner enable
   the staff authenticator requirement. A newly invited staff member then
   completes password-proven enrolment before entering Admin. Subscriber and
   review sign-ins remain separate.
7. In Admin → Operations, select an active incident owner and a different
   deputy. Review the default poll/job warning thresholds (30 and six hours).
   Internal alert emails are **off** until an owner explicitly enables them
   with their password. Confirm the existing verified Resend sender first.
8. The source repository's **Operations health worker** workflow runs hourly
   and supports manual dispatch. It uses the same repository `CRON_SECRET` as
   Vercel and the existing access worker. No additional secret or per-minute
   Vercel cron is required. Deploy the route and migration before running it.
   A green **Setup reminder** does not mean processing ran. The HTTP response
   is counts only; confirm `ok: true` and the completion time in Admin.
9. Keep the source workflow URL current when the domain migrates. Stage 5 owns
   migration preparation; this branch makes no DNS or sender-domain changes.

## Staff security behaviour

Authenticator secrets are AES-256-GCM encrypted and bound to the staff account.
Recovery codes are keyed hashes; the temporary, password-proven setup challenge
contains them encrypted until setup completes or the challenge expires. They
are never put in email, logs, URLs or public pages. Do not send screenshots of
the setup page. No external QR-code service receives the secret.

Password success creates only a five-minute opaque HttpOnly challenge when a
factor is enrolled/required. There are five challenge issues per account per
15 minutes, five attempts per challenge, and five enrolled-factor checks per
15 minutes across challenges and factor removal. A time step and a recovery
code can each be consumed only once, including concurrent requests. The clock
tolerance is one 30-second step either side; keep server/device clocks correct.

Every protected staff action re-reads the active account, current database role,
security version and factor requirement. **Sign out existing browsers** advances
that version and invalidates copied older cookies. An owner can revoke another
staff member's sessions after confirming their own password. Ordinary Sign out
continues to clear the current browser's cookie; use the explicit revocation
control if a cookie or device may have been copied or lost.

Disabling one's own factor requires the password and a fresh factor/recovery
code, is unavailable while the global requirement is on, and revokes older
sessions. Policy changes and factor removal serialize on the same database row.
There is no password-only owner override of a lost authenticator. Use a saved
recovery code. If all owners lose both, use an approved, audited database recovery
procedure with institutional account access; do not weaken the public login.

Rotating `SESSION_SECRET` without a separate authenticator re-enrolment/key
migration plan makes encrypted factors unreadable as well as ending reader
sessions. Losing the key is a recovery incident. Store it separately from the
database backup, with institutional access and an agreed recovery procedure.

## Delivery evidence and reporting

The signed Resend webhook saves minimal evidence before attempting attribution.
It keeps provider event/message IDs, type, timestamps and processing state, not
the payload, recipient address, code or email body. Events arriving before the
message ID is saved remain pending and are replayed by the operations worker or
the owner's **Check health and match delivery reports** action. Leases recover
interrupted replay; new/less-tried events take priority and unmatched events
back off, so old unknown messages cannot starve fresh evidence. A shared Resend
account may also report messages from another application; unmatched does not
by itself mean an APRA email failed. Event IDs prevent duplicate engagement counts. Older events
do not overwrite a newer review-email status.

Admin → Operations shows masked recent review and subscriber outcomes. Accepted
means Resend accepted the request. Delivered means the receiving mail server
accepted it, not that it reached the main inbox or was read. Spam complaints,
bounces, unknown results and delays remain distinct. No email/Papermark lookup
is made when opening this page. Legacy messages lacking provider evidence
remain unknown; this change does not invent historical delivery records.

The existing Engagement subscriber/review tabs and weekly digest definitions
are retained. This branch does not change counts to include staff, interpret a
click as a download, or present page coverage as comprehension. Stage 5 owns new
subscriber publication alerts; it should reuse this delivery evidence instead
of adding another webhook ledger.

## Service health and internal alerts

Checks observe database evidence: analytics-poll freshness, old/failed saved
access work, unmatched delivery events, unsettled onboarding results, staff
enrolment, incident ownership, agreed retention and recorded backup/restore
checks. A health-page visit neither repairs readers nor calls Papermark.

Health checks use an expiring fenced lease; delivery matching and sends are
bounded. The worker aims to finish within 45 seconds. A stopped run leaves saved
work for the next run. GitHub schedules can be delayed and serverless execution
is not guaranteed; monitor the worker completion time and GitHub failures.

Alerts persist and are resolved only when their observation clears. An
acknowledgement records responsibility; it is not a resolution. Internal email
is opt-in, at most two alerts per run, once per incident generation. Known
temporary provider refusals have bounded hourly retries. An unknown response or
an expired send lease is never automatically resent, because the message may
already have been accepted. Inspect the provider privately before taking a
manual follow-up action. These are staff alerts, not customer notifications.

If Vercel, Neon or this worker itself is down it cannot reliably alert about
its own outage. Assign the incident owner to watch GitHub/Vercel/Neon service
notifications or use an independent uptime monitor. This branch does not create
or claim external monitoring.

## Privacy and retention

There are **no seeded retention periods and no scheduled deletion**. An owner
must approve each period/reason with their current password. The UI permits only
old sign-in attempts, expired subscriber/briefing tokens, expired review-reader
codes, expired staff challenges and already matched webhook evidence. Periods
are bounded to 7–3650 days; those bounds are technical safeguards, not legal
advice or a recommended retention period.

Cleanup first produces a signed, owner-bound 15-minute count/cutoff preview.
Confirmation requires a fresh password and explicit checkbox. A policy change,
changed count, tampered token or other owner invalidates the preview. The
database serializes same-policy cleanups and records counts, with at most 1,000
deletions per run. Active credentials/sessions, subscriptions, agreements,
publication files, entitlements, editorial records and audit trails are never
selectable. A zero-count preview may be confirmed without deleting anything.

Deleting matched webhook evidence reduces the detailed delivery evidence
available in this dashboard; existing attributed engagement/review status
records remain. Agree the reporting retention before selecting this bucket.

Athena must still agree and document retention/access/erasure responsibilities
for contracts, reader identities, publication activity, source files, backups
and provider-held data. Those broader policies are not silently decided or
implemented as automatic deletions here. A data-subject request needs a reviewed
cross-provider process, including contractual/legal retention exceptions.

## Backup, recovery and incident ownership

The owner/deputy coordinate incidents and record private evidence references.
Admin checkpoints are staff declarations; clicking **Record** does not create
or test a backup. Agree RPO, RTO, backup retention, restore-test frequency,
escalation contacts and who can approve a production restoration.

Before launch, rehearse on isolated Neon branches:

1. Freeze a source recovery point and restore it to a different branch. Keep
   restored cron jobs, email sends and Papermark mutations disabled.
2. Supply read-only `RECOVERY_SOURCE_DATABASE_URL` and
   `RECOVERY_RESTORED_DATABASE_URL` through the local secure environment, never
   as command-line arguments or committed files. Run
   `node scripts/verify-restored-access.mjs`. It compares critical access-table
   counts and row fingerprints in read-only repeatable-read transactions, with
   a 15-second statement limit. Output contains only table names/counts and
   MATCH/MISMATCH, not rows, hashes, private URLs or credentials.
3. A match is database consistency evidence only. Test login, assigned access,
   current versions, withdrawal and permitted watermarked downloads with test
   readers. Inventory external PDF storage, Papermark groups/links and email
   state separately: a database restore does not roll providers back.
4. Reconcile carefully before resuming sends/jobs: restoring an older database
   can reintroduce consumed codes, revoked sessions or previously sent message
   jobs. Revoke restored sessions/tokens and review idempotency/cutoffs under the
   incident plan. Do not run restored background jobs against live providers.
5. Record elapsed recovery time and the actual evidence privately; then record
   its reference/result in Admin. Obtain production restore approval separately.

`db/rollback/20261115_stage4_operations_security.rollback.sql` is only for an
unused migration. It refuses if security, policy or operational evidence has
been used, preventing loss of revocation state or audit history. Roll forward
after enrolment/use; do not deploy old code that ignores MFA/session versions.

## Verification and remaining live checks

Automated tests use isolated PostgreSQL, invented staff/readers and mock email
responses. They cover RFC OTP vectors, encryption/tampering, challenge/recovery
replay, server role checks, staff revocation, early/out-of-order delivery events,
bounded sends, worker authorisation, retention and migration/rollback guards.
The restore script is tested against a disposable database, not a real Neon
recovery. No production migration, bulk email or provider permission change is
made by development tests.

After integration, test with controlled staff accounts in the deployed browser:
authenticator enrolment, recovery-code login, requirement rollout, copied-cookie
revocation, owner/editor boundaries, the hourly worker, real verified Resend
events, screen reader/keyboard/mobile use, and the isolated Neon restore drill.
Production MFA usability, provider inbox delivery and recovery targets cannot
be certified by unit tests. Keep these marked unverified until performed.
