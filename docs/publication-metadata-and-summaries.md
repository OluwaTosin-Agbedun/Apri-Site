# Publication metadata, tags and protected summaries

Each publication record (a row of `documents`, edited in **Admin → Documents → a
record**) can carry three kinds of editorial information beyond its title, series
and edition date:

1. **Reader details**: author/editor, the period the edition covers, its
   information cut-off and its reading time.
2. **Tags** from a controlled vocabulary of subjects, sectors and geography.
3. A **protected summary**: What changed; Why it matters; Implications and
   relevant risks/scenarios; What to watch next; optionally a source date and an
   uncertainty note.

All three are optional, entered by people, and shown only to subscribers who may
already read the edition. **None of them ever decides who may read an edition:**
that is still the access policy (`src/lib/access-policy.ts`). An edition with none
of them is listed, searched and opened exactly as before.

Migration: `db/migrations/20261114_publication_editorial_metadata.sql` (rollback in
`db/rollback/`).

## What each field means, and where it comes from

| Field | Stored in | Meaning |
|---|---|---|
| Category / family | `documents.series` (existing) | The publication catalogue code (see [`publication-catalogue.md`](publication-catalogue.md)), including `OTHER`. Unchanged by this work. |
| Title | `documents.title` + `portal_title_override` (existing) | Unchanged: subscribers see the Papermark file name unless an editor ticks the title override. |
| Editorial issue date | `documents.edition_date` (existing) | Unchanged: the date search filters and access terms use. |
| Author / editor | `documents.author_editor` (new, optional) | Free text, one line, up to 200 characters. |
| Covered period | `documents.covered_period_start`, `covered_period_end` (new, optional) | Both or neither; the end on or after the start (a single day is allowed). |
| Information cut-off | `documents.information_cutoff` (new, optional) | The date the edition's information runs to. |
| Reading time | `documents.reading_time_minutes` (new, optional) | Whole minutes from 1 to 600, **as an editor judges it**. The site never estimates or computes it. |
| Subjects, sectors, geography | `publication_tags`, `publication_tag_assignments` (new) | Chosen from the controlled vocabulary. |
| Protected summary | `publication_summaries` (new) | One per publication: the saved text, a revision number and the copy an owner approved. |

`documents.coverage_areas` (the public detail page's bullet list) means something
different and is **left exactly as it is**: it is not converted into tags, and tags
are not written into it. The public description and one-line summary
(`documents.description`, `documents.summary`) stay the public teasers; the
protected summary is separate and never appears in them.

## Admin

### The publication editor (owners and editors)

Below the record form are two new panels:

- **Reader details and tags.** Author/editor, covered period, information cut-off,
  reading time, and a tick box per tag, grouped by subjects, sectors and geography.
  **Save reader details** saves all of them together (with the progress spinner).
  If another administrator saved this record's details or tags after the page was
  opened, the save is refused ("changed by someone else ... Reload the page") and
  writes nothing, so it never silently removes their tag or value; reload and make
  the change again. Renaming or retiring a tag does not count as a change here.
  (The check runs just before the write; it is not a lock, so two saves in the same
  instant can still both pass it.)
  A small form adds a new tag to the vocabulary without leaving the page. A retired
  tag already on the record is shown "(retired)": it can be removed but not added
  again.
- **Protected summary for subscribers**, with its status (No summary / Draft /
  Approved / Changed since approval) and who saved or approved it and when.
  - **Save draft** (any administrator). Drafts are never shown to subscribers.
  - **Approve for subscribers** (owners only). It approves the text as saved, at
    the revision the owner was shown, and only when the four main fields are
    written. Text changed in the form must be saved as a draft first, so approval
    is always a separate, explicit owner action covering text the owner has seen.
  - **Withdraw approval** (owners only) takes an approved summary down and keeps the
    text as a draft.
  - Saving text that differs from the approved text removes the approval at once
    (the editor is warned before saving). Subscribers see nothing until an owner
    approves the new text.

Saving details or tags, and saving, approving or withdrawing a summary, never
publishes an edition, switches it On, changes a plan, exception, recipient,
Papermark link or setting, or sends anything.

For an Open (public) edition both panels say that it is never in the subscriber
library, so nothing there is shown to anyone.

### Admin → Publication Tags (`/admin/tags`)

The controlled vocabulary.

- **Owners and editors** can add a subject, sector or geography. Labels are unique
  within each kind whatever their capitals ("Lagos" and "LAGOS" are one tag); use
  one consistent label per idea.
- **Only owners** can:
  - **Rename** a tag: the label changes on every publication carrying it;
  - **Retire** a tag: it is no longer offered for new assignments, but it stays on
    the publications already carrying it (and in those readers' filters) until an
    editor removes it there;
  - **Restore** a retired tag;
  - **Delete** a tag that no publication carries (a typo, say). A tag in use can
    only be retired: the database refuses to delete it.

Every action re-checks the administrator and their role in the database (never the
cookie's claim), validates its input and uses bound parameters only.

## What subscribers see

On both library paths (Data Room and legacy), for each edition the access policy
lists for them:

- a line of facts, each shown **only when entered**: Reading time, Covers (the
  covered period), Information to (the cut-off), Author/editor, and the edition's
  subjects, sectors and geography;
- a **Summary** disclosure (closed by default, works without JavaScript) holding
  the approved summary's fields and its source date, **only when an owner's
  approved copy equals the saved text**.

An edition with none of these looks exactly as before.

### Search

Subscriber search (Step 1) is extended, not replaced:

- **Subject**, **Sector** and **Geography** filters appear only when the reader's
  permitted editions carry tags of that kind, and offer only those labels. A
  label carried only by another plan's or a hidden edition never appears.
- They combine (AND) with keywords, publication type and the inclusive issue-date
  range; counts and **Clear filters** cover them.
- Keywords also search the approved summary text the reader may see (never a
  draft), but not tag or type names, which have their own filters.
- It is still local filtering in the browser over the list the server rendered: no
  Papermark request, no PDF fetch, no URL, browser storage or analytics. Each
  search record holds display fields only: title, description, type, issue date,
  tag labels and approved summary text. Never a link, Papermark id, tag id, another
  reader's data or reading activity.

## Safeguards

- **Drafts never leave Admin.** Readers' summaries come from one query
  (`approvedSummaries` in `src/lib/publication-summaries.ts`) that returns only the
  approved copy, and only while it still equals the saved text. The saved (possibly
  draft) text is never selected for a reader. Only the summary modules, the two
  library loaders and the Admin editor read `publication_summaries` (a test checks
  this).
- **Only entitled readers.** Details and summaries are loaded for the editions the
  access policy has already listed for the signed-in subscriber, on both paths
  (`src/lib/papermark-client-library.ts`, `src/lib/subscriber-dal.ts`), and are
  rendered into that reader's own page only. "Listed" is the policy's delivery
  (`src/lib/access-policy-dal.ts`):
  - **open** (allowed, with a live link) and **preparing** (allowed, link not ready
    yet): shown, because the policy allows the reader this edition;
  - **preserved** (the decision is unresolved, for example term dates to correct or
    no plan ticked yet, but a link issued earlier is kept open): shown, because the
    reader can already open the whole document, so its approved summary tells them
    nothing the edition does not;
  - **hidden** (excluded, or unresolved with no earlier link): never loaded, never
    shown.

  If the owners decide undecided editions should show no summary even with an
  earlier link, filter the two loaders' lists to delivery `open`/`preparing`; the
  test "undecided editions" in `tests/publication-summaries-db.test.mjs` pins the
  current rule.
- **Nowhere public.** Public pages, Complimentary Review pages, page metadata,
  structured data, sitemaps, notification and alert emails, and logs carry no
  protected text (alerts still use the public one-line teaser).
- **Concurrency.** Every summary write is a compare-and-set on the revision the
  editor was shown, and bumps it. Of an edit and an approval racing, two edits, or
  two approvals, exactly one succeeds; the other is told to reload and writes
  nothing. The approved copy is built in SQL from the stored row, so an approval
  can never carry text from the request.
- **Papermark sync keeps all of it.** Synchronisation fills only blank public
  fields of a record and never writes the new columns or tables: a renamed,
  re-versioned, removed and re-added file, linking, creating-or-reusing records and
  "generate missing details" all leave metadata, tags and summaries unchanged
  (tested). The record form's own save writes only its own columns.
- **Failure is decoration-only.** If the details cannot be read, readers get their
  library without them; listing and opening never depend on them.
- **Deleting a record keeps written summaries.** Admin's Delete (owners only,
  for a record nothing uses) is also refused while the record holds a protected
  summary with any text, draft or approved: "used by a protected summary ...
  Archive it instead." To delete such a record deliberately, clear the summary's
  fields in the editor and save (that also takes down any approval), then delete.
  Reader details and tag assignments are not protected this way: they are deleted
  with the record (tags stay in the vocabulary).

## Before the migration

Everything works as before: no details, tags or summaries are shown, search shows
no tag filters, and opening editions is unaffected. The editor's two panels and
Admin → Publication Tags say:

> Author/editor, covered period, information cut-off, reading time,
> subject/sector/geography tags and protected summaries need migration
> db/migrations/20261114_publication_editorial_metadata.sql.

Every save refuses with that message and writes nothing.

## Migration and rollback

`20261114_publication_editorial_metadata.sql` (after
`20261114_publication_catalogue.sql` in filename order; it does not depend on it):

- adds the five optional `documents` columns with their checks;
- creates `publication_tags`, `publication_tag_assignments` (an assigned tag cannot
  be deleted) and `publication_summaries`;
- is additive and idempotent (safe to re-run); backfills nothing, changes no
  existing row, grant, plan, exception, recipient, link or setting;
- sets a 5-second lock timeout: if it fails on a lock, re-run it.

The rollback (`db/rollback/20261114_publication_editorial_metadata.rollback.sql`)
is not a migration. Deploy the previous code first. It refuses, and changes
nothing, while any summary (draft or approved), any tag, any tag assignment or any
of the five metadata values exists, naming which; export and clear them
deliberately first. It can be re-run.

## Operating guidance

1. Apply the migration, then deploy (or deploy first: the site works until it is
   applied).
2. In **Admin → Publication Tags**, agree and add the starting vocabulary (a short
   list of subjects, sectors and geographies). Nothing is seeded.
3. Fill in reader details and tags per edition as editions are prepared. Leave a
   field empty rather than guess: empty fields are simply not shown.
4. Editors draft summaries; an owner reads the saved text and presses **Approve for
   subscribers**. Any later edit takes the summary down until it is approved again.
5. Check a subscriber view (or the sandbox) after the first approvals.

## Code

- `src/lib/publication-metadata.ts`: rules (validation, formatting, approved-copy
  reading), no database.
- `src/lib/publication-metadata-dal.ts`: readiness check, reader details loader,
  editor panel, vocabulary.
- `src/lib/publication-summaries.ts`: summary storage, compare-and-set writes,
  approved-only reader query.
- `src/app/actions/publication-metadata.ts`, `src/app/actions/publication-summaries.ts`:
  server actions.
- `src/app/admin/documents/[id]/publication-details-form.tsx`, `summary-form.tsx`,
  `src/app/admin/tags/`: Admin.
- `src/components/PublicationReaderDetails.tsx`: the subscriber card's facts and
  summary.
- `src/lib/library-search.ts`, `src/components/LibrarySearch.tsx`: tag filters and
  summary keywords.

## Tests

`tests/publication-metadata*.test.mjs`, `tests/publication-summaries*.test.mjs`,
`tests/library-tag-filters*.test.mjs` (see the README's "Tests and checks").
