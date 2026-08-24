/**
 * Shared fixtures for the integration tests.
 *
 * These run against the real database in DATABASE_URL. Every row a test creates
 * is prefixed with a per-file tag and removed afterwards, so a failed run cannot
 * leave data behind that a later run would trip over.
 *
 * Run with:  pnpm test
 */
import { neon } from '@neondatabase/serverless'
import { createHash, randomBytes } from 'node:crypto'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Run the tests with: node --env-file=.env.local --test tests/'
  )
}

export const sql = neon(process.env.DATABASE_URL)

// ---------------------------------------------------------------------------
// The production rules, imported by value rather than reimplemented.
//
// These mirror src/lib/entitlements.ts. Kept as literals here on purpose: a
// test that imported the module under test would pass even if the rule itself
// were wrong, because both sides would change together.
// ---------------------------------------------------------------------------

export const LEVELS = ['L1', 'L2', 'L3', 'L4']
export const REGULAR_SERIES = ['PLM', 'AEO', 'AIU', 'MIN', 'QIB']

const RANK = { L1: 1, L2: 2, L3: 3, L4: 4 }

/** Which visibilities a level may read. Never includes OPEN. */
export function visibilitiesForLevel(level) {
  return LEVELS.filter((v) => RANK[v] <= RANK[level])
}

/** A date column bound as a parameter must be a plain YYYY-MM-DD string. */
export function asDateParam(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function makeTag(name) {
  // Random suffix so two runs, or two files, cannot collide.
  return `t_${name}_${randomBytes(4).toString('hex')}`
}

export async function cleanup(tag) {
  await sql.query(
    `delete from document_views
     where papermark_view_id like $1
        or subscriber_id in (select id from subscribers where email like $1)`,
    [`${tag}%`]
  )
  await sql.query(
    `delete from publication_access
     where subscriber_id in (select id from subscribers where email like $1)`,
    [`${tag}%`]
  )
  await sql.query(`delete from auth_tokens
     where subscriber_id in (select id from subscribers where email like $1)`,
    [`${tag}%`])
  await sql.query(`delete from subscribers where email like $1`, [`${tag}%`])
  await sql.query(`delete from documents where slug like $1`, [`${tag}%`])
}

/**
 * Creates a subscriber seat.
 *
 * termStartDaysAgo / termEndDaysAhead are relative so a fixture cannot silently
 * expire as the calendar moves.
 */
export async function makeSeat(tag, {
  suffix,
  level = 'L2',
  status = 'active',
  seats = 1,
  termStartDaysAgo = 200,
  termEndDaysAhead = 90,
  libraryLink = null,
  papermarkLinkId = null,
}) {
  const email = `${tag}_${suffix}@example.invalid`
  const [row] = await sql.query(
    `insert into subscribers (
       full_name, name, email, level, public_tier, status, seats,
       term_start, term_end, library_link_url, papermark_link_id, organization
     ) values ($1,$1,$2,$3,'Test Tier',$4,$5,
               current_date - $6::int, current_date + $7::int,
               $8,$9,'Test Org')
     returning id`,
    [`Seat ${suffix}`, email, level, status, seats,
     termStartDaysAgo, termEndDaysAhead, libraryLink, papermarkLinkId]
  )
  return { id: row.id, email, level, seats }
}

/** Creates a published edition. */
export async function makeEdition(tag, {
  suffix,
  series = 'MIN',
  visibility = 'L2',
  status = 'published',
  editionDaysAgo = 10,
  papermarkDocumentId = null,
  openLinkUrl = null,
}) {
  const [row] = await sql.query(
    `insert into documents (
       slug, title, series, visibility, status, is_published,
       edition_date, summary, cta_label, papermark_document_id, open_link_url
     ) values ($1,$2,$3,$4,$5,$6, current_date - $7::int, 'test','Read',$8,$9)
     returning id`,
    [`${tag}_ed_${suffix}`, `Edition ${suffix}`, series, visibility, status,
     status === 'published', editionDaysAgo, papermarkDocumentId, openLinkUrl]
  )
  return { id: row.id, visibility, series }
}

/** Records a view, as the collectors would. */
export async function makeView(tag, {
  suffix,
  subscriberId = null,
  publicationId = null,
  papermarkLinkId = null,
  viewerEmail = null,
  daysAgo = 1,
  source = 'poll',
}) {
  const [row] = await sql.query(
    `insert into document_views (
       papermark_view_id, subscriber_id, publication_id, papermark_link_id,
       viewer_email, viewed_at, source
     ) values ($1,$2,$3,$4,$5, now() - ($6::int || ' days')::interval, $7)
     returning id`,
    [`${tag}_view_${suffix}`, subscriberId, publicationId, papermarkLinkId,
     viewerEmail, daysAgo, source]
  )
  return row.id
}

/** A per-publication link override. */
export async function makeOverride({ subscriberId, publicationId, linkUrl, papermarkLinkId = null }) {
  await sql.query(
    `insert into publication_access (subscriber_id, publication_id, link_url, papermark_link_id)
     values ($1,$2,$3,$4)
     on conflict (subscriber_id, publication_id)
     do update set link_url = excluded.link_url,
                   papermark_link_id = excluded.papermark_link_id`,
    [subscriberId, publicationId, linkUrl, papermarkLinkId]
  )
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

// ---------------------------------------------------------------------------
// The queries under test, as the application issues them
// ---------------------------------------------------------------------------

/**
 * The portal's library query, verbatim in shape from src/lib/subscriber-dal.ts.
 *
 * Takes an explicit subscriberId to make the isolation tests meaningful: the
 * point is that passing A's id can never surface B's rows.
 */
export async function libraryFor(subscriberId, level, slugPrefix = null) {
  if (!level) return []

  // Mirrors src/lib/subscriber-dal.ts. Resolution is a live publication_access
  // row, or a shared link only where the publication is explicitly flagged as
  // one. There is deliberately no fallback to the subscriber's library link:
  // every stamped copy carries one person's name, so a fallback would
  // eventually hand someone a document marked for somebody else.
  return sql.query(
    `select d.id, d.title, d.visibility, d.is_shared_copy,
            case
              when pa.revoke_state = 'live' and pa.link_url like 'https://%'
                then pa.link_url
              when d.is_shared_copy and d.papermark_link like 'https://%'
                then d.papermark_link
              else null
            end as link
     from documents d
     left join publication_access pa
       on pa.publication_id = d.id and pa.subscriber_id = $1
     where d.status = 'published'
       and d.visibility <> 'OPEN'
       and d.visibility = any($2::text[])
       -- Test files run in parallel against one database, so a file that does
       -- not narrow to its own fixtures will see another file's editions.
       and ($3::text is null or d.slug like $3)
     order by coalesce(d.edition_date, d.created_at::date) desc`,
    [subscriberId, visibilitiesForLevel(level), slugPrefix]
  )
}

/** Whether a seat may sign in at all. */
export async function canSignIn(subscriberId) {
  const [row] = await sql.query(
    `select status, (term_end is null or term_end >= current_date) as term_current
     from subscribers where id = $1`,
    [subscriberId]
  )
  if (!row) return false
  return row.status.toLowerCase() === 'active' && row.term_current === true
}
