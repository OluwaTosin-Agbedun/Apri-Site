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
