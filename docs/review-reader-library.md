# Complimentary Review: one remembered library for approved readers

## What changes for readers

- Approved readers sign in once per browser at `/review/library/sign-in`, using the email address
  their editions were issued to. They receive a link and an 8-digit code, the same design as the
  subscriber fix.
- After that, `/review/library` opens on that browser with no email step, for 90 days.
- The library lists **all and only** the published editions assigned to that email. This uses
  the existing per-edition recipient lists, and the rule is checked on every visit.
- Each edition opens through `/review/library/open/{id}`. That route checks again, at the moment
  of opening, that the email is still one of that edition's recipients and that the edition is
  still published with a verified exact-document link.
  - Only then does it redirect to that edition's existing Papermark link.
  - A guessed id, a withdrawn or draft edition, or another reader's edition all get the same
    "not available" answer.
  - The library page itself never carries a Papermark URL.
- Existing approved readers need no new request. Their assignments are keyed by email.
  - An access link that Admin already sent (`/review/access?token=…`) now also opens the
    remembered library.
- A visitor who is not approved is pointed to the existing request process at `/review`.
- This is separate from paid sign-in:
  - its own cookie (`apri_review_reader`, path `/review`, audience `review-reader`), sessions and
    tables;
  - a subscriber cookie never opens it, and its cookie never opens the portal.
- Signing out ends the session on the server too.

## What Papermark actually permits

This comes from Papermark's open-source code and its public API spec.

- Papermark's email verification is **per link** and lasts **23 hours**:
  - the verification token is keyed `link-verification:{linkId}:{teamId}:{email}`;
  - the viewing session cookie is `pm_drs_{linkId}` or `pm_ls_{linkId}`.
- Today each edition has its own document link. So Papermark asks a reader to confirm their email
  by one-time code **once per edition, and again after 23 hours**. An APRI session cannot remove
  that challenge, and APRI does not claim to. The library tells readers so.
- The only Papermark mechanism that gives one verification across several PDFs is a **Data Room
  link**: one Papermark session per link covers every document visible through it.
  - The public API supports a per-reader Data Room link with **per-link document permissions**:
    `POST /v1/links` with `dataroom_id`, then `PUT /v1/links/{id}/permissions`.
  - Such a link can keep the allow list, `email_authenticated`, the watermark, screenshot
    protection and `allow_download` (download is allowed or blocked per document).
  - Papermark's own documentation is ambiguous on one fail-open point. A link with no
    permission entries is described both as "viewers see the full dataroom" and as "hides every
    item".
- The live **Review Data Room holds 5 editions**: 3 published and **2 withdrawn**, the August
  2026 Monthly Intelligence Note update and Political Landscape Monitor Issue 01 (read-only
  check).
  - A room-level link without per-link permissions would therefore expose withdrawn PDFs.
  - It has **not** been used.
- Not proven: one Papermark verification across a reader's assigned editions, with the
  watermark, recipient restriction, screenshot protection and engagement records intact.
  - Proving it needs live Papermark changes: new per-reader links for two controlled test
    readers with different edition sets.
  - It also needs mailboxes to receive Papermark's codes.
  - It was not attempted, because live Papermark permissions must not change without your
    decision.

## Decision needed before switching the public cards

| Option | Reader experience | Risk |
|---|---|---|
| A. Keep per-edition links (as built) | APRI remembers the reader; Papermark asks for a code once per edition per day | None new: every existing restriction stays |
| B. Per-reader Data Room link with per-link permissions | One Papermark code per day across all of a reader's editions | New live links; the empty-permissions behaviour must be proven fail-closed; withdrawn PDFs must be removed from the room or excluded on every link; recipient changes must update each reader's link |
| C. Drop Papermark's email code (`email_authenticated: false`) | No Papermark challenge | Weakens security: a forwarded Papermark URL plus the reader's address would open it. Not recommended |

## Rollout (reversible)

1. Deploy the code. Nothing changes publicly: the cards still link straight to Papermark.
2. Apply `db/migrations/20261008_review_reader_library.sql` (additive). Check it with:

   ```sql
   select to_regclass('public.review_reader_sessions'),
          to_regclass('public.review_reader_tokens'),
          to_regclass('public.review_reader_events');
   ```

3. Test with two controlled reader addresses assigned different editions:
   - each sees only its own editions at `/review/library`;
   - removing a recipient or withdrawing an edition hides it at once;
   - a closed and reopened browser returns without an email.
4. Only then, in **Admin → Review Library → Where public review cards lead**, choose **APRI
   Review Library**. Choose **Papermark links** to switch back at any time.

Rollback: set the cards back to Papermark links, then
`db/rollback/20261008_review_reader_library.rollback.sql`.

## Unchanged

- The `/review` request form, its verification, Admin notification and manual approval.
- Publication management, per-edition recipients and withdrawal.
- Papermark links and their settings.
- Direct-link click tracking (`review_access_clicked`).
- The paid subscriber journey.

New library visits and edition opens are recorded per reader and edition in
`review_reader_events`, for Engagement.

---

# Personal Papermark rooms: one code for all of a reader's editions

Built after the decision above. It is off until the controlled test passes.

## How it works

For each approved reader, APRI creates and confirms the following in the existing Review Data
Room. It reuses the PDFs already there and uploads nothing.

1. **A viewer group.**
   - Its only member is the reader's approved email.
   - It admits no domain and is never "allow all".
2. **A permission row for every document in the room.**
   - Each published edition assigned to the reader is viewable.
   - Everything else is hidden: withdrawn editions, unassigned editions and newly added PDFs.
   - Download is never allowed.
   - Papermark refuses any document whose group permission is missing, so a new group shows
     nothing until rows exist.
3. **One group link, created only after the permissions are read back and match exactly.**
   - Email-authenticated, with the reader as its only allowed address.
   - The personalised Complimentary Review watermark.
   - Screenshot protection.
   - Downloads off.

Rooms are updated automatically when an owner:

- changes an edition's recipients;
- adopts recipients;
- grants a prospect editions;
- publishes, withdraws or re-offers an edition;
- edits the shared list.

Only readers who already have a room are touched, after the response. Admin's **Check all
rooms** re-checks every room, and opening a room re-checks it if the last check was over 6
hours ago.

**When Papermark doesn't confirm a change:**

- If a removal cannot be confirmed, or Papermark reports a download or another protection
  wrong, that reader's link is **closed**: its expiry is set in the past and the URL is kept for
  repair. Access is never reported as revoked until Papermark confirms it.
- If the link cannot be closed either, the room shows **Needs repair** with the link id to
  remove by hand.

### Reading entry, with no APRI code and no APRI email (current)

This supersedes the emailed reading link described in the next section, which has been removed.

1. A card leads to `/review/read`.
2. If the browser is not known, the reader enters the approved email once
   (`/review/read/request`). An unapproved address is told that a request or a confirmed email
   is not approval. Requests are rate-limited per network and per address.
3. On every visit APRI re-checks approval and that the reader's room shows exactly the editions
   assigned now (`review_reader_rooms.verified_editions`). If either has changed, the room is
   reconciled with Papermark first. Only one reconcile runs per reader at a time
   (`lease_until`).
4. APRI redirects to the reader's personal Papermark room. **Papermark** emails one code to that
   address, and the reader pastes it into Papermark's screen.

### Earlier design: the emailed reading link (removed)

1. A reader's **personal reading link** is emailed on request from `/review/read/request`. The
   response is the same whatever address is entered. Readers already in the remembered library
   can also use it.
2. One click opens their room. **Papermark asks for its one-time code.**
3. That browser is remembered, so the public cards go straight to their room next time.

APRI only routes the reader here. The email check is Papermark's: a forwarded link still needs a
code sent to the reader's own inbox.

## How often Papermark asks for a fresh code

From Papermark's own code, its room session lasts **23 hours** and is tied to the browser. So a
reader enters one code, and it opens all their editions on that browser for about a day. A fresh
code is needed:

- the next day;
- on another browser or device;
- after clearing cookies;
- possibly after a browser update.

Access is not permanent.

## Migrations, in order

1. `20261007_subscriber_sign_in_sessions.sql`
2. `20261008_review_reader_library.sql`
3. `20261009_review_reader_rooms.sql`

All three are additive and none of them changes Papermark. Check the third with:

```sql
select to_regclass('public.review_reader_rooms'), to_regclass('public.review_reader_room_events');
```

## Controlled live test (required before the public cards change)

1. Deploy, apply the migrations, and keep the public cards on **Papermark links**.
2. In Admin → Review Library → Edition recipients, assign two test addresses you control to
   **different** editions.
3. In **Personal Papermark rooms**, enter both addresses and press **Prepare rooms**. Each
   result should read "Ready: N editions visible, M hidden, downloads off".
4. Open each **Open room** link in its own private window. For each reader, confirm all of the
   following:
   - Papermark asks for **one** code.
   - Every assigned PDF opens without another code.
   - The other reader's PDFs and the withdrawn PDFs are not listed and cannot be opened.
   - There is no download control.
   - The watermark shows that reader's email.
5. Remove one recipient and assign a different edition. Press **Check all rooms**, reload each
   room, and confirm the removed PDF is gone and the new one appears.
6. Tick the checks and press **Record test as passed**.
7. Only then, under **Where public review cards lead**, choose **Personal Papermark rooms**.
   Press **Prepare all approved readers**; at Papermark's ~50 calls a minute, 35 readers take a
   few minutes, so run it again for any room not yet ready.

**To reverse:** choose **Papermark links**, or **Withdraw the test result**. Existing rooms stay
in place, and you can close them in Papermark.
