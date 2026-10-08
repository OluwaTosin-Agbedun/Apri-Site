# Complimentary Review Library: one APRI code, then every assigned edition

Last updated 2 October 2026.

## The reader journey

1. An approved reader clicks **Access review copy** on the homepage or `/publications`. In
   library mode the card goes to `/review/library?edition=<id>`.
2. A browser without an APRI reader session is sent to `/review/library/sign-in`. The reader
   types the address their editions were issued to.
3. APRI emails **one 8-digit code**, with no link. It works once, for 15 minutes. Asking again
   sends a new code, and the old one stops working. An address may receive at most five codes
   an hour.
4. The reader types the code. That browser is then signed in for **24 hours from the code**.
   The session is a signed `apri_review_reader` cookie (HttpOnly, Secure, SameSite=Lax,
   path `/review`) backed by a `review_reader_sessions` row, so it can be revoked server-side.
   It is not extended by use.
5. They see **Your review publications**: every published edition assigned to their address,
   in MIN, AIU and PLM order. Each card shows the series, title, edition and date, a short
   description, and a **Read** button. The page contains no Papermark address.
6. **Read** (`/review/library/open/<id>`) re-checks the session and the assignment, then sends
   the browser straight to that one PDF inside the reader's personal Papermark link. There is
   no second code and no Papermark room listing on the way.
7. Opening a second or third publication, refreshing the library, or returning through the
   homepage or `/publications` within the 24 hours needs no email and no code.

The `/review` request, its email confirmation, and owner approval and assignment in Admin are
unchanged. Requesting or confirming gives no access by itself.

## Why APRI performs the only check (what hosted Papermark permits)

These facts come from Papermark's open-source code, checked against `main` (commit `ed19717`,
28 August 2026), and its public OpenAPI spec (66 operations, fetched 2 October 2026).

- **A verified session belongs to one link.** After Papermark's email code, its session cookie
  `pm_drs_<linkId>` opens every document the link permits, including by the direct
  `/view/<link>/d/<room document>` route, without asking again. It lasts a fixed 23 hours.
  No team or link setting changes that.
- **No supported API can pre-verify a reader.** Papermark has no API, viewer SSO, signed
  viewer token or "skip verification" option. `?email=` only pre-fills the form.
- **Papermark never tells APRI who passed its code.**
- **No cross-site embedding.** The session cookie is `SameSite=Strict`, so a Papermark viewer
  embedded in an APRI page cannot keep a session across PDFs.

A custom APRI library behind one code, with PDFs that open without another code, therefore
cannot also keep Papermark's own email code on. On 2 October 2026 the owner chose this design:

- APRI's single-use code verifies the reader.
- Each reader's **personal** Papermark link asks for their email only (no second code).
- That link is **open only while the reader holds an APRI session**.

Every edition's own Papermark link, which the cards use in Papermark mode, keeps Papermark's
code.

## The personal Papermark link (internal)

- **One viewer group per reader**, whose only member is their address. It never admits a whole
  domain or everyone.
- **A permission row for every document** in the Review Data Room. View is allowed only for the
  published editions assigned to that reader. Download is allowed for exactly that same set.
  Withdrawn, draft, unassigned and newly synced PDFs have explicit view and download denials,
  and Papermark refuses them. A broad folder grant is also refused during verification.
- **One group link** with these settings:
  - `email_protected` on, `email_authenticated` off;
  - an allow list of exactly that address;
  - the personalised confidential watermark, screenshot protection, and downloads on only
    after the exact per-document permissions are confirmed.
- **The link's expiry is the end of the reader's latest APRI session.** It is set when they
  first press Read in a session (three Papermark calls, once per session, read back). It is closed
  (expiry in the past) when their last session ends or they sign out. A link with no closing
  time is treated as a fault.
- **Every change counts only once Papermark's read-back confirms it.** Otherwise the link is
  closed and the room marked for repair: nothing is ever reported as removed without that
  confirmation.

### What Papermark does and does not re-check, and how APRI covers it

| Change | Papermark | APRI |
|---|---|---|
| Recipient removed from one edition | The permission row is re-checked on every document open | Library and Read refuse it at once; the room is reconciled before the next Read |
| Removed from every edition | Group membership is **not** re-checked inside an existing Papermark session. Its download-code route can even start a fresh session for an earlier viewer without re-checking it | The link is closed (its expiry set in the past); Papermark checks expiry before its session on every request |
| Edition withdrawn | Permission re-checked on every open | All rooms are reconciled; Read refuses it |
| Sign-out | Not affected | The link is closed, or shortened to the reader's other session |

### Limits of what Papermark shows and protects

- **The "Home" bar.** A document opened inside a room always has Papermark's bar, whose
  "Home" link returns to the room listing. That listing shows only the reader's own editions.
  Its look can be set through `PATCH /v1/datarooms/{id}/branding`; for example, the "Standard"
  preset hides the banner and folder tree. That is a live Papermark change for the whole
  Review Data Room, so it has not been made.
- **Watermark and screenshot protection need page images.** They are drawn only when Papermark
  has converted a PDF to page images. A PDF without them is served as the file itself, with
  neither. This is true of every Papermark link, not only these. Check in Papermark that each
  review PDF shows as pages.
- **Screenshot protection runs in the browser.** It deters capture but cannot prevent it.

## Reliability

- **One reconcile per reader at a time.** A 3-minute lease prevents overlapping requests from
  creating a second group or link. A reader who presses Read during one is told their copy is
  being prepared, and the next Read finishes it. This is not a loop: the lease expires, and
  Admin shows Repair.
- **Rooms are prepared after sign-in**, in the background, so the first Read is quick. Papermark
  calls are paced under its rate limit.
- **Failures are reported by kind**, both to the reader and in owner-only diagnostics:
  - access not assigned;
  - being prepared;
  - a problem on APRI's side (configuration or database);
  - the email provider refused the email;
  - no clear answer from the provider.
- **Diagnostics never contain a code, token, link or email body.**
- **Before migration `20261011` is applied**, Read uses each edition's own Papermark link, as
  before, and no personal link is changed.

## Migrations, in order

| Migration | Needed for |
|---|---|
| `20261008_review_reader_library.sql` | Reader codes and sessions |
| `20261009_review_reader_rooms.sql` | Personal Papermark rooms |
| `20261010_review_access_reliability.sql` | Email outcomes; confirmed edition set and per-reader lease |
| `20261011_review_reader_open_window.sql` | **New.** `link_open_until` and `room_documents`. Turns on direct, code-free Read |

Each file is additive and safe to re-run, and each has a rollback in `db/rollback/`. Before
rolling back `20261011`, close the personal links in Papermark.

Read-only check that the schema is ready:

```sql
select column_name from information_schema.columns
where table_name = 'review_reader_rooms'
  and column_name in ('verified_editions', 'lease_until', 'link_open_until', 'room_documents');
-- expect four rows
```

## Live acceptance checks still required

Use controlled test inboxes only, on the deployed site:

1. **Code receipt.** Request a code; it arrives. Try a wrong code, an expired code and a resent
   code, then sign in.
2. **Multiple PDFs.** Read two assigned publications: no second code, and Papermark asks only
   for the email, once per browser per day.
3. **Return visit.** Close and reopen the browser within 24 hours: the library opens with no
   code.
4. **Isolation.** A second test reader with different editions sees only their own.
5. **Removal and withdrawal.** Remove one edition from a reader and withdraw another: both are
   refused.
6. **Downloads.** Use Download in the secure viewer. Check the saved PDF has the reader's
   confidential watermark on each page. Another reader's, withdrawn and unassigned PDFs
   must not be downloadable, including through a copied document URL.
7. **Sign-out.** Sign out, then open the personal link directly: Papermark refuses it as
   expired.

## Download rollout (8 October 2026)

No additional migration is required. Existing `verified_editions` values acquire a policy
version only after permissions and the link have been read back. An old view-only proof
therefore triggers one reconcile on the next Read, not a request for every return visit.
The same personal link, group, watermark, approved email and session expiry are retained.
Admin can repair readers ahead of time in small batches with the existing controls.

For original per-edition links and the repair fallback, use **Enable / verify downloads**
on the edition card. This owner-only operation checks the exact document and current
recipient list first, changes only `allow_download`, and reads it back. It refuses a link
recorded as paid access, withdrawn/ignored editions, an empty or mismatched recipient list,
and missing protection. Repeating it does not recreate a link. Legacy view-only links remain
valid for recipient changes, publishing checks and withdrawal while upgrades are pending.

The library's **Read & download** button opens the exact assigned PDF; Download is inside
Papermark's viewer. There is no supported cross-origin download proxy using APRI's API token
and no raw PDF route is introduced. Papermark handles personalised PDF generation. The
existing analytics collector records provider-confirmed download events; simply opening the
viewer counts as no download.

An API failure or rate limit never writes a successful download proof. A security mismatch
or unconfirmed removal still closes the personal link. Saved copies cannot be recalled.
This change retains existing pacing; it does not implement the separately planned shared
queue for all API callers. Run live checks above with a controlled reader before rollout.
