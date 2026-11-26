# Athena public editorial publishing

The existing Admin publishing and named-reader workflows remain in place. This
guide covers the public presentation added during the interim website work.

## Who supplies and approves material

| Material | Responsible team | Required before publication |
| --- | --- | --- |
| Monthly Note, Intelligence Updates, Quarterly Outlook | Intelligence and Publications | Approved public title, issue/date, coverage period, teaser and actual cover |
| Political Landscape Monitor and Election Matters | Athena Election Observatory | Approved freely public edition/link, date, visual and AEO attribution |
| Africa Watch | Research / Intelligence | Approved country assessment, including comparator designation where relevant, date, summary and visual |
| OsitaInsight | Media / ClearPath Media | Selected public video URL, actual thumbnail, date, short description and ClearPath attribution |
| Selected Client Engagements | Intelligence team and engagement lead | Reviewed anonymised description and permission to publish; no identifying client details or confidential findings |
| Final website entry and review | Webmaster / Desmond | Correct links, approval, attribution, desktop/mobile presentation |

## Existing editions

1. Continue uploading, syncing, verifying and publishing editions through the
   existing Admin controls. The new layout grants no access and publishes no PDF.
2. The homepage displays up to three published subscriber teasers and up to three
   review editions that the owner explicitly offered, ordered by recorded issue
   date. Undated records retain their saved order; no date is inferred from a name.
3. Review access still follows the saved library/Papermark setting and each
   edition's approved reader list. All remaining editions are accessible through
   **All publications** and the review archive. A shorter homepage does not
   withdraw or revoke anything.
4. Public summaries use the existing promotional descriptions. Protected reader
   summaries and unmarked originals are never used as homepage content.

## Covers, Open Insights and client engagements

Publication covers are now maintained in Admin. There is no new database table or
migration. Each edition's cover uses its own existing settings record, separate
from the report PDF, its reader list and its secure link.

1. For a subscriber publication, open **Dashboard → Manage publication records**
   (or **Data Rooms → Edit publication details**), choose the saved edition and
   find **Publication cover**. Save a new publication record before adding a cover.
2. For a complimentary edition, open **Review Library**, find the edition and
   its **Publication cover** section. This remains owner-only.
3. Choose the actual approved JPEG, PNG or WebP cover, no larger than 4 MB.
   Check the preview, add a short image description and an optional image credit,
   confirm public-display approval and click **Upload cover** or **Replace cover**.
4. The cover appears on that edition's existing homepage listing, public archive
   and subscriber publication detail page, when those entries are already published.
   A draft stays a draft. **Remove cover** removes the image only.
5. Refresh if another editor changed the cover. A failed upload leaves the current
   cover in place. Uploads need the same public image Blob connection as team
   portraits; do not change a confidential report store to public.

The publication and review records have separate covers; reuse the approved image
by uploading it to each relevant edition. Admin cannot yet edit Open Insights or
client engagements. The webmaster maintains those in `src/data/editorial.ts`:

- `PUBLICATION_VISUALS`: optional existing source-based homepage fallbacks. An
  uploaded Admin cover takes precedence. Use approved public image assets only;
  never point an image at a report's protected original.
- `OPEN_INSIGHTS`: add a title, real date, short description, source institution,
  publicly accessible `href`, actual visual and credit, and the matching stream
  ID. Set `approved: true` only after editorial approval. Unapproved entries are
  not rendered. The four stream IDs are defined in the same file.
- `CLIENT_ENGAGEMENTS`: add only the approved anonymised title and description,
  its existing briefing request type and `approved: true` after review. Do not
  invent an analytical approach, deliverable or outcome. Without approved entries
  the homepage omits this section rather than publishing placeholders.

Open Insights lives at `/open-insights`. The homepage links directly to its four
streams. AEO and ClearPath outputs retain their own attribution. Do not make an
email-gated PLM review copy freely public by moving its link into this collection.

The content objects contain plain fields, dates, identifiers and links, allowing
the team to transfer them to Epinox without changing reader permissions. Download
or retain the approved source visuals and their usage permissions alongside the
editorial originals; public images must have durable URLs.

## Final check and today's remaining inputs

- Verify title, date, issue/coverage period, summary, institution, visual credit,
  approval and destination for every item.
- Confirm a public item is genuinely approved for unrestricted circulation.
- Check each briefing request preselects the intended service, and existing readers
  can still reach their assigned libraries without submitting a new application.
- Review desktop and mobile before the user's manual hosting sync.

As at 26 November 2026, approved covers, public edition/video links and final
engagement-description approval are still required from the responsible teams.
The site introduces the streams without fabricated stories, covers or results.
Zoho templates, mailing groups and distribution continue as a separate workstream.
