# Publication catalogue

One owner-controlled list of publication categories is used by both subscriber
libraries (Data Room and legacy), the Complimentary Review library, the public
Publications archive, the homepage review cards and Admin. It replaces the
separate lists that used to disagree (the portal showed only PLM, MIN and AIU and
hid everything else; the review side knew only MIN, AIU and PLM; the folder
classifier guessed categories from codes found anywhere in a folder path).

**A category only places and labels an edition. It never grants access.** Who may
open a paid edition is still decided by the access policy (`src/lib/access-policy.ts`):
subscription status, plan, paid periods including gaps between them, inclusive issue
dates, and Admin **Also give** / **Hide**. A Complimentary Review edition is still
open only to the readers assigned to it, once it is published.

## The categories

| Code | Section label (plural) | Card label (singular) | Default |
|---|---|---|---|
| `MIN` | Monthly Intelligence Notes | Monthly Intelligence Note | Active, 1st |
| `AIU` | Athena Intelligence Updates | Athena Intelligence Update | Active, 2nd |
| `PLM` | Political Landscape Monitor | Political Landscape Monitor | Active, 3rd |
| `AEO` | Election & Democratic Governance Monitor | Election & Democratic Governance Monitor | Active, 4th. Older name kept as an alias: Election Observatory |
| `QIB` | Quarterly Intelligence Briefs | Quarterly Intelligence Brief | Active, 5th |
| `OTHER` | Other Assigned Publications | Other assigned publication | Active, 6th |
| `BP` | Board Papers | Board Paper | Historical, inactive, last. Never deleted |

- The codes are the values stored in `documents.series` and
  `review_publication_editions.series`. They are never renamed.
- A Complimentary Review edition may use any code except `BP`.
- Code: `src/lib/publication-catalogue.ts` holds the built-in defaults, and the
  migration's seed copies them (a test checks that they match).
  `src/lib/publication-catalogue-dal.ts` lays the owner's saved edits over them.
- Subscriber search (Step 1) offers as publication types only the categories present
  among the editions the reader is permitted to see, in catalogue order.

## How an edition's category is decided

1. **The publication record's series**, when it is one of the codes. This is the
   editorial decision, so it wins.
2. Otherwise, for a Data Room document, **the folder it is filed in**, but only when an
   owner has mapped that folder. Matching is exact on the folder's normalised name:
   capitals, spaces, hyphens, underscores and a leading number such as "04 " are
   ignored, and "&" reads as "and". That is how Papermark itself writes folder paths
   (its `safeSlugify`, which uses `@sindresorhus/slugify`): the folder "Election &
   Democratic Governance Monitor" is stored as the path
   `/election-and-democratic-governance-monitor`, and the name typed in Admin gives the
   same key. In a nested path, the innermost mapped folder wins, so map a category's
   own folder, never a subfolder such as a year (Admin refuses a folder named only with
   digits).
3. **Only for a document in no folder at all:** a code at the very start of its name,
   for example "QIB-2026-Q3 …". The code must be followed by a separator, so
   "ADMIN-notes" does not count.
4. Otherwise the edition has **no category yet**. It is still listed to every reader it
   is permitted for, in a final section called **Publications awaiting a category**,
   and Admin flags it. Missing category metadata never hides permitted content.

Some consequences of these rules:

- An unmapped folder is never guessed from a code or a word inside its name. A folder
  called "Admin" is not a Monthly Intelligence Note. A document in an unmapped folder
  is not classified from its file name either.
- **Other Assigned Publications is an explicit choice.** An edition is in it only when
  its record's series is `OTHER` or its folder is mapped to `OTHER` (by default,
  `other-assigned-publications`). It is never a fallback.
- Board Intelligence Updates (`board-intelligence-updates`) is deliberately not mapped.
  An owner decides where it belongs.
- A publication record made from a synced document (Create record, Generate details)
  takes its series from the same exact mapping, never from a guess. A document in a
  folder explicitly mapped to Other Assigned Publications gets the series `OTHER` once
  the migration is applied (no series before it; its folder mapping still places it),
  and no edition code is invented for it. A document with no category gets no series.

### Default folder mappings

These come only from the Papermark folder labels and the folder slugs already seen in
the Data Rooms:

| Folder slug | Category |
|---|---|
| `monthly-intelligence-notes` | MIN |
| `monthly-intelligence-note` | MIN |
| `athena-intelligence-updates` | AIU |
| `political-landscape-monitor` | PLM |
| `election-and-democratic-governance-monitor` | AEO |
| `election-democratic-governance-monitor` | AEO |
| `election-watch` | AEO |
| `quarterly-intelligence-briefs` | QIB |
| `other-assigned-publications` | OTHER |

- `election-and-democratic-governance-monitor` is the path Papermark creates for the
  folder "Election & Democratic Governance Monitor". The "&"-dropped form is kept as
  well.
- `election-watch` is an older name. The earlier classifier's tests required it, so it
  is kept, but as a visible mapping an owner can remove, never as a hidden guess.
- Each of the six screenshot folders, at the path Papermark stores for it, is mapped
  (`tests/publication-catalogue.test.mjs` checks every one). A folder renamed or
  created with a different name needs its own mapping.

## How the libraries show it

### Subscriber libraries (both paths)

- Every permitted edition is listed, grouped by category in catalogue order.
- Every **active** category has a section and a navigation card with its count. An
  empty active category shows "No editions are currently available to you in this
  library", as before.
- An inactive category appears only when a permitted edition belongs to it.
  "Publications awaiting a category" comes last, and only when it holds something.
- The single **Latest** card is the newest permitted edition across all categories. It
  is never filtered by search.

### Complimentary Review

- The reader library, the edition lists in Admin, the edition order on the Publications
  page and the approved-reader lookup all follow the catalogue order.
- `/publications` shows one column for each category that has published editions:
  1 column on a phone, 2 from tablet width, 3 on wide screens.
- The homepage shows a card only for an edition an owner explicitly offers. Supporting
  more categories adds no card, assigns no edition and publishes nothing.
- Chancellor-approved card copy exists only for MIN, AIU and PLM. An edition in any
  other category gets no invented copy:
  - sync leaves its type, description, frequency and audience blank;
  - **Generate defaults** suggests only the edition label;
  - **publishing is refused** until the owner has entered and saved its public title
    and description, and neither may still be the approved copy of MIN, AIU or PLM
    (for example after a MIN draft is moved to QIB and saved unchanged). Saving such an
    edition says so, and the Admin card shows the same warning
    (`reviewCopyProblem` in `src/lib/review-classify.ts` is the one rule).
- Review Data Room sync proposes a draft's category from the owner's folder mapping
  first, then from the approved series names in the file name (MIN, AIU, PLM only).
  - A folder's name is no longer read for words: the earlier sync also proposed
    MIN, AIU or PLM from a folder name such as "/political-landscape-monitors". Such a
    folder now proposes nothing unless it is mapped.
  - Admin → Publication Categories lists the Review Data Room folders that no mapping
    claims, so the owner can map them. A mapping applies to paid Data Rooms too.
  - A proposal is only a draft's category. Nothing is published or assigned.

## Admin → Publication Categories (`/admin/categories`, owners only)

- **Categories:** edit the section label, the card label, the position (lower comes
  first), the active flag and other names (for reference only).
  - Deactivating a category that is in use asks for confirmation. "In use" means it
    holds publication records, review editions, folder mappings or a homepage offer.
  - Deactivating stops the category being offered for new choices. Everything already
    in it stays listed to the readers it is permitted for.
- **Folder mappings:** map a Papermark folder name to an active category, or remove a
  mapping.
  - A folder that is already mapped is never silently re-pointed: remove the mapping
    first.
  - Changes take effect on the next page view. No re-sync is needed.
- **Publications awaiting a category:** how many Data Room documents and published,
  released paid records outside Data Rooms have no category, which unmapped folders
  hold them, and a one-step form to map each folder. The form is pre-filled with the
  path's outermost folder, never a subfolder. Unmapped Review Data Room folders are
  listed too.
- **Codes cannot be created or deleted here.** Stored series values are limited by the
  database, so a new code needs a migration.
- Every action re-checks the owner role on the server, validates its input, changes
  nothing before the migration is applied, and shows the spinner while it works.
- **Data Rooms** shows each synced document's category as the portal places it, and
  flags any document whose folder is unmapped.

## Elsewhere in Admin

- **Publishing a paid edition needs its edition date**, whatever its category, and
  also when it is awaiting one: the portal lists every permitted edition by date.
- **A publication record's series** offers the owner's active categories, in catalogue
  order with the card labels, plus the record's current series if its category is now
  inactive. OTHER cannot be chosen before the migration.
- **Engagement**'s series filter lists every code in the owner's order and labels. It
  matches the series saved on the publication record or review edition. A Data Room
  document placed only by its folder mapping has no saved series and is not matched:
  give its record a series.
- **The readiness report** (`scripts/access-recovery-preview.mjs`) compares a record's
  series with its folder's category under the owner's current mapping. It does not use
  the category stored at sync time, which may still hold the old classifier's guess.

## Migration, rollback and deployment

The migration is `db/migrations/20261114_publication_catalogue.sql`. It is additive and
safe to re-run.

**What it does:**

- creates `publication_categories` and `publication_category_folders`;
- seeds them from the defaults. The folder seed runs only once, recorded in
  `app_settings` as `publication_catalogue_folders_seeded`, so a re-run never re-adds a
  mapping an owner removed;
- widens `documents_series_check` to allow `OTHER`;
- widens `review_publication_editions_series_check` to MIN, AIU, PLM, AEO, QIB and OTHER.

It changes no existing row: no series is guessed, and no grant, plan, exception,
recipient or Papermark setting changes. `db/schema.sql` mirrors the final schema. It
sets `lock_timeout = '5s'`, so a long-running transaction on `documents` makes it fail
fast instead of stalling the site. If that happens, run it again at a quieter moment.

**Before it is applied**, the built-in defaults are the catalogue and every library
works with them. In that state:

- Admin → Publication Categories says the migration is needed and changes nothing;
- `OTHER` cannot be saved as a record's series;
- a review edition can be filed only under MIN, AIU or PLM. Review sync leaves any
  other proposal unassigned instead of failing.

**Deployment order:**

1. Apply the migration to the production database.
2. Deploy.
3. Open Admin → Publication Categories, check the folder mappings and the "awaiting a
   category" counts, then map or set series where needed.

Deploying the code before the migration is safe: it degrades as described above.

**Rollback:** `db/rollback/20261114_publication_catalogue.rollback.sql`.

- It restores the earlier constraints and drops the two tables.
- It **refuses, changing nothing,** while any of these exist:
  - a record with series `OTHER`;
  - a review edition filed under AEO, QIB or OTHER;
  - a folder mapping an owner added or re-pointed;
  - a category whose labels, position, active flag or other names an owner changed.
- Reset those by hand first, or restore the Neon branch taken before the migration.
- A removed default mapping does not block the rollback.

### Read-only checks after deploying

```sql
select code, label, sort_order, active from publication_categories order by sort_order;
select folder_slug, category_code from publication_category_folders order by folder_slug;
-- Data Room documents and their folders (resolution happens in the app):
select folder_path, count(*) from papermark_dataroom_documents where is_present group by 1 order by 2 desc;
select series, count(*) from documents group by 1 order by 1;
select series, count(*) from review_publication_editions group by 1 order by 1;
```

## What subscribers and owners will notice

- **The portal order changes.** Libraries were PLM, MIN, AIU. They are now MIN, AIU,
  PLM, AEO, QIB, Other (or the order the owner sets).
- **Editions that were hidden now appear.** These are permitted editions outside the
  old three series: the two Quarterly Intelligence Briefs, the three Board Intelligence
  Updates and the document with no folder. The Board updates and the document with no
  folder appear under "Publications awaiting a category" until an owner maps the folder
  or sets a series.
- AEO's card label is now "Election & Democratic Governance Monitor" (it was "Election
  Observatory").
- The search's publication-type options are the categories the reader actually has.
- The PLM heading on the public `/publications` archive and in Admin's review edition
  groups is now "Political Landscape Monitor" (it was "Political Landscape Monitors"),
  the catalogue label that matches the Papermark folder. An owner can change it in
  Admin.
- The homepage review introduction names the categories of the editions actually
  offered, not a fixed three. With only MIN and PLM offered, it reads "Monthly
  Intelligence Note and Political Landscape Monitor".
- Review sync no longer proposes a category from words in a folder's name (see
  Complimentary Review above).
- Publishing a paid edition with no category now also needs its edition date.

## Known limits

- **Subscriber emails** label a series with the built-in labels, not owner overrides.
  This is in `src/lib/subscriber-email.ts`, which uses `seriesLabel`.
- **The retired folder-sync pipeline** (`papermark_client_documents`,
  `src/lib/papermark-contract.ts`) keeps its own anchored title classification. It no
  longer lists a library, and only labels a document in the viewer fallback.
- **The retired three-slot Complimentary Review table** (`complimentary_review_items`)
  stays limited to the three series with approved copy.
