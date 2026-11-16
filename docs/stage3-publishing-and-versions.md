# Editorial review, corrections and history

Prepared 16 November 2026. Migration: `20261115_stage3_publishing_workflow.sql`.

## What changes

New releases require Draft → In review → Approved → Published. Editors can
prepare/submit; owners approve/release. The saved content/source fingerprint
and revision are rechecked in the release transaction. A material draft edit
clears approval; later source/tag drift also holds release until re-reviewed.

Editorial approval, paid On/Off/plan availability, public listing and
Complimentary Review assignments remain separate. A paid library still uses
the shared term/period/level/Allow/Block policy, including released draft
records. A category, family or search result grants nothing. Approval sends
no email and does not assign or activate anyone.

The migration backfills/adopts/approves nothing and changes no reader, PDF,
link, recipient or release. Existing live records retain their current access.
An owner can explicitly adopt one for history without inventing an earlier
approval/release time. Known synced source-version keys are fingerprinted too;
protected file bytes are not claimed to have been fetched by the API. The
adopted snapshot, source ids and original issue
date are immutable; history is append-only. Archive rather than delete it.
Before adopting an existing undated release, record its actual original issue
date in the publication's existing details form. Adoption refuses a missing
date; recording it does not change the review recipients or publish a draft.

## Publish a new issue

1. Upload privately in Papermark and sync the appropriate room. Open the
   publication record under Data Rooms, or Editorial review on its Review
   Library card. A different monthly issue is a new publication, not a correction.
2. Start its editorial record with a reason. Complete title, category, issue
   date, PDF source id, author/editor, covered period, cut-off, reading time,
   version and provenance. The source field uploads nothing and accepts an id,
   not a share URL. Paid details/tags retain their existing editor.
3. Submit. An owner checks the actual PDF/details and approves with password
   confirmation. Approval alone leaves the edition unreleased.
4. For paid access, choose plans and switch On. For review access, choose/apply
   recipients, prepare/verify secure access and publish as latest or historical.
   Public visibility remains a separate choice.
5. Check readiness and a controlled reader. Existing personal-link jobs verify
   access before reporting ready. Protected summaries retain their separate
   owner approval; no summary text is auto-approved or copied to corrections.

## Correct the same issue

1. Retain the original master. Upload a distinct corrected PDF and create its
   separate draft record with the SAME category, audience level and original
   issue date. Give the corrected draft its own version label.
2. On the earlier version's workflow panel, preview the corrected draft id.
   An owner confirms the fingerprint, exact audience counts, reason/password.
   This replaces the target draft's plan/exception or recipient list with the
   exact source list, including Blocks. It copies no term/session/personal link.
   Changed content or lists make the preview stale and abort the transaction.
3. Complete the corrected draft's review. Release remains held until the
   earlier PDF has a verified notice copy and old raw links are retired.
4. Use the earlier version's displayed current-edition URL to create a notice
   copy from an authorised local master (replace the example UUID):

~~~sh
node scripts/prepare-superseded-pdf.mjs \
  --input /private/original.pdf \
  --output /private/superseded.pdf \
  --current-url https://athenaadvisory.ng/portal/publication/RECORD_UUID \
  --version 1.0
~~~

   Review URLs use `/review/library/current/RECORD_UUID`. Both approved site
   origins work; the URL contains no token/query. Inspect the PDF and adjacent
   `.proof.json`. The tool embeds a first-page notice and every-page footer,
   with clickable first-party links and an embedded, OFL-licensed notice font
   (assets/pdf-notice; website fonts are unchanged). It retains page objects, text, links and
   rotation, expands the page bands and clips the original crop so hidden
   content cannot emerge. Input/output must differ and existing files are not
   overwritten. Forms/signatures/active content/unsupported or tiny pages are
   refused; no silent flattening. Limits: 100 MB and 2,000 pages.
5. Upload the separate notice PDF privately to Papermark; keep the original
   master private. For a paid room, upload into that library and sync. Record
   the notice document id, source/output hashes, page count and inspection.
   This tool adds superseded notices, not a replacement personal watermark.
6. A DIFFERENT active owner independently checks the exact uploaded file,
   first page/every footer/current link, readability and personal watermark /
   permitted-download protection. Only that confirmation selects the notice
   source. Original ids/date/snapshot are retained.
7. Re-prepare secure access to the notice copy. Saved jobs retire known old
   raw links using the existing shared Papermark budget. DELETE success alone
   is insufficient: only a confirming 404 is provider-confirmed. Unknown/limit
   responses retain a retry; no pending job is described as revoked.
8. Legacy/unmanaged raw links need two separately recorded manual checks.
   Those are labelled manual, not API confirmations. For legacy history,
   provision the new personal notice copy under Copies, then have two owners
   check that exact copy. A changed URL/provider id or notice hash invalidates
   its proof. Existing downloaded files cannot be recalled or retroactively marked.
9. Keep the workflow page open to resume two small jobs and refresh every
   15 seconds while automatic work is pending, or use its bounded-check
   button. The existing hourly access worker is the unattended backstop.
10. Once every check is confirmed, release the approved correction normally.
    Approval, exact inherited audience and retirement are checked transactionally;
    its release form cannot silently widen the inherited plan list. A review
    correction inherits its family's homepage/latest placement, without
    changing unrelated issues or their deliberate homepage offers.

Only already permitted, previously released versions enter history. Primary
routes select the latest version available under that reader's access. Former
paid document bookmarks resolve to the permitted notice/current family, never
the old raw personal link. Review assignments are checked on every open;
requesting `history=1` does not bypass them.

## Effects and practical limits

| Trigger | Effect |
|---|---|
| Deploy/apply migration | No bulk adoption, reader sign-out, provider change or email |
| First release of new draft | Complete metadata and owner editorial approval required |
| Approve draft | Nothing released; no reader assignment or email |
| Verify notice source | Older copies may be held while secure access/retirement finishes |
| Retire review room links | Existing queue rebuilds affected rooms; unrelated known maps excluded, legacy unknown maps closed conservatively |
| Correction with alerts enabled | One correction event; older unsent family announcements cancelled; accepted/in-flight/unknown outcomes retained honestly |
| Rename/sync/repair/notice preparation | No publication email |
| Previously downloaded PDF | Cannot be recalled; notices govern newly served copies |
| Used workflow deletion/rollback | Refused to preserve history; archive or application rollback |

The read-mostly integration cannot upload or inspect protected PDF bytes. The
file/hash checks and unmanaged-link checks are explicit human evidence, not
an API claim. Operators must control out-of-band Papermark sharing/overwrites;
do not overwrite original or notice document ids with another file. These
limits are independent of the domain move. Current branding, Papermark,
subscription activation, review codes/sessions and download policy remain.
Zoho, a replacement reader service and new circulation/summary policies remain
separate decisions. No real provider calls belong in automated tests.

## Verification and recovery

Schema/upgrade/rerun/rollback tests cover unchanged customer/release data.
Behavioural tests cover actual roles, stale/concurrent approval, paid terms and
Blocks, exact inheritance, notice proof, old bookmarks, provider confirmation,
leases/retries and legacy-copy proof. PDF tests inspect byte streams and four
rotations. Production-browser checks use invented data for the real Admin
review form and the existing reader journeys. Real PDFs in Papermark, personal
watermarks/downloads and inbox receipt still require controlled live acceptance.

Apply after `20261114_publication_editorial_metadata.sql`, before Stage 4/5.
No Stage 4/5 table is required when applying it. Prefer application rollback
with additive schema/history retained. The destructive rollback
`db/rollback/20261115_stage3_publishing_workflow.rollback.sql` refuses after
any workflow/family/history exists. It precedes destructive rollback of the
earlier metadata migration; never drop history to force rollback to pass.
