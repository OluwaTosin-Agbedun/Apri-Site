import 'server-only'
import { createHash } from 'node:crypto'
import { getSql } from './db'
import { getLinkDetail, isPapermarkConfigured } from './papermark'

/**
 * Verifying that every subscriber link permits exactly one address.
 *
 * The whole arrangement rests on this. Each stamped document carries one
 * person's name, and the link is allow-listed to that one person's address. A
 * second address on the link means someone opens a document bearing another
 * subscriber's name -- which is both a leak and a false attribution.
 *
 * It is checked by machine because a person cannot check it: the Papermark
 * dashboard renders the allow-list in a textarea that shows only its first line.
 * The API returns `allow_list` as an array of strings, so what is read here is
 * the real field and not something adjacent to it.
 *
 * Addresses are never stored or displayed. A finding names the link and the
 * publication, which is enough to act on; copying an address that should not be
 * on the link into our own tables would spread the problem rather than report
 * it. Where an address must be compared, it is compared as a hash.
 */

export type FindingKind =
  | 'link-missing'
  | 'allow-list-empty'
  | 'allow-list-multiple'
  | 'allow-list-mismatch'
  | 'allow-list-wildcard'
  | 'downloads-enabled'
  | 'email-verification-off'

export type VerificationSummary = {
  checked: number
  clean: number
  findings: number
  skipped: 'not-configured' | null
}

/** A stable, non-reversible form for comparing two addresses. */
function fingerprint(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

/**
 * Whether an allow-list entry is a domain pattern rather than one person.
 *
 * Papermark accepts `@example.com` to admit a whole domain. That is a single
 * entry which permits an unbounded number of readers, so it is a finding in its
 * own right and would otherwise pass a naive "exactly one entry" check.
 */
function isWildcard(entry: string): boolean {
  const value = entry.trim()
  return value.startsWith('@') || value.startsWith('*') || !value.includes('@')
}

/**
 * Reads every live link back and checks it.
 *
 * Only live rows are checked: a revoked link is meant not to work, and its
 * settings no longer matter.
 */
export async function verifyAllowLists(
  limit = 500
): Promise<VerificationSummary> {
  if (!isPapermarkConfigured()) {
    return { checked: 0, clean: 0, findings: 0, skipped: 'not-configured' }
  }

  const sql = getSql()

  const rows = (await sql`
    select pa.id as access_id, pa.papermark_link_id, pa.subscriber_id,
           pa.publication_id, s.email
    from publication_access pa
    join subscribers s on s.id = pa.subscriber_id
    where pa.revoke_state = 'live'
      and pa.papermark_link_id is not null
      and pa.papermark_link_id <> ''
    order by pa.updated_at asc
    limit ${limit}
  `) as {
    access_id: string
    papermark_link_id: string
    subscriber_id: string
    publication_id: string
    email: string
  }[]

  let clean = 0
  let findings = 0

  for (const row of rows) {
    const kinds = await checkOne(row)

    if (kinds.length === 0) {
      await resolveFindings(row.access_id, [])
      clean++
      continue
    }

    findings += kinds.length
    for (const { kind, detail } of kinds) {
      await raiseFinding({ ...row, kind, detail })
    }
    await resolveFindings(row.access_id, kinds.map((k) => k.kind))
  }

  return { checked: rows.length, clean, findings, skipped: null }
}

async function checkOne(row: {
  papermark_link_id: string
  email: string
}): Promise<{ kind: FindingKind; detail: string }[]> {
  const result = await getLinkDetail(row.papermark_link_id)

  if (!result.ok) {
    // 'failed' means we could not ask, which is not a finding about the link.
    if (result.reason === 'missing') {
      return [{ kind: 'link-missing', detail: 'Papermark has no link with this id.' }]
    }
    return []
  }

  const link = result.link
  const out: { kind: FindingKind; detail: string }[] = []

  const list = Array.isArray(link.allow_list) ? link.allow_list.filter(Boolean) : []

  if (list.length === 0) {
    out.push({
      kind: 'allow-list-empty',
      detail: 'The link permits any address. It should permit exactly one.',
    })
  } else if (list.length > 1) {
    out.push({
      kind: 'allow-list-multiple',
      // The count, never the addresses.
      detail: `The link permits ${list.length} addresses. It should permit exactly one.`,
    })
  } else if (isWildcard(list[0]!)) {
    out.push({
      kind: 'allow-list-wildcard',
      detail:
        'The single entry is a domain pattern, so it admits anyone at that domain rather than one person.',
    })
  } else if (fingerprint(list[0]!) !== fingerprint(row.email)) {
    out.push({
      kind: 'allow-list-mismatch',
      detail:
        'The permitted address is not the subscriber this copy belongs to. They would open a document carrying another name.',
    })
  }

  if (link.allow_download === true) {
    out.push({
      kind: 'downloads-enabled',
      detail: 'Downloads are enabled on this link.',
    })
  }

  // Email verification is what ties a view to a person. Without it the
  // allow-list is unenforced and attribution is guesswork.
  if (link.email_protected === false) {
    out.push({
      kind: 'email-verification-off',
      detail: 'Email verification is off, so the allow-list is not enforced.',
    })
  }

  return out
}

async function raiseFinding(args: {
  access_id: string
  subscriber_id: string
  publication_id: string
  papermark_link_id: string
  kind: FindingKind
  detail: string
}): Promise<void> {
  const sql = getSql()
  await sql`
    insert into link_findings (
      access_id, subscriber_id, publication_id, papermark_link_id, kind, detail
    ) values (
      ${args.access_id}, ${args.subscriber_id}, ${args.publication_id},
      ${args.papermark_link_id}, ${args.kind}, ${args.detail}
    )
    on conflict (access_id, kind) where resolved_at is null
    do update set last_seen_at = now(), detail = excluded.detail
  `
}

/**
 * Closes findings that no longer apply.
 *
 * A finding that has been fixed must stop showing, or the panel becomes a list
 * of things already dealt with and nobody reads it.
 */
async function resolveFindings(
  accessId: string,
  stillOpen: FindingKind[]
): Promise<void> {
  const sql = getSql()
  await sql.query(
    `update link_findings
     set resolved_at = now()
     where access_id = $1
       and resolved_at is null
       and not (kind = any($2::text[]))`,
    [accessId, stillOpen]
  )
}

export type LinkFinding = {
  id: string
  kind: FindingKind
  detail: string
  subscriberName: string
  organisation: string
  publicationCode: string | null
  publicationTitle: string
  papermarkLinkId: string
  firstSeenAt: string
  subscriberId: string
}

/**
 * Open findings, worst first.
 *
 * A mismatch outranks the rest: it means a subscriber can open a document
 * carrying somebody else's name, which is the failure the whole model exists to
 * prevent.
 */
const SEVERITY: Record<FindingKind, number> = {
  'allow-list-mismatch': 0,
  'allow-list-wildcard': 1,
  'allow-list-empty': 2,
  'allow-list-multiple': 3,
  'email-verification-off': 4,
  'downloads-enabled': 5,
  'link-missing': 6,
}

export async function getOpenFindings(): Promise<LinkFinding[]> {
  const sql = getSql()

  const rows = (await sql`
    select f.id, f.kind, f.detail, f.papermark_link_id, f.first_seen_at,
           f.subscriber_id,
           coalesce(nullif(s.full_name, ''), s.name, '(removed)') as subscriber_name,
           coalesce(s.organization, '') as organisation,
           d.code as publication_code,
           coalesce(d.title, '(removed)') as publication_title
    from link_findings f
    left join subscribers s on s.id = f.subscriber_id
    left join documents d on d.id = f.publication_id
    where f.resolved_at is null
    order by f.first_seen_at asc
  `) as {
    id: string
    kind: FindingKind
    detail: string
    papermark_link_id: string
    first_seen_at: string | Date
    subscriber_id: string | null
    subscriber_name: string
    organisation: string
    publication_code: string | null
    publication_title: string
  }[]

  return rows
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      detail: r.detail,
      subscriberName: r.subscriber_name,
      organisation: r.organisation,
      publicationCode: r.publication_code,
      publicationTitle: r.publication_title,
      papermarkLinkId: r.papermark_link_id,
      firstSeenAt: new Date(r.first_seen_at).toISOString(),
      subscriberId: r.subscriber_id ?? '',
    }))
    .sort((a, b) => (SEVERITY[a.kind] ?? 9) - (SEVERITY[b.kind] ?? 9))
}

/** Findings not yet emailed, so a run reports each one once. */
export async function getUnalertedFindings(): Promise<LinkFinding[]> {
  const open = await getOpenFindings()
  if (open.length === 0) return []

  const sql = getSql()
  const alerted = (await sql.query(
    `select id from link_findings
     where id = any($1::uuid[]) and alerted_at is not null`,
    [open.map((f) => f.id)]
  )) as { id: string }[]

  const seen = new Set(alerted.map((a) => a.id))
  return open.filter((f) => !seen.has(f.id))
}

export async function markFindingsAlerted(findings: LinkFinding[]): Promise<void> {
  if (findings.length === 0) return
  const sql = getSql()
  await sql.query(
    `update link_findings set alerted_at = now() where id = any($1::uuid[])`,
    [findings.map((f) => f.id)]
  )
}

/** Plain-language label for a finding kind. */
export function findingLabel(kind: FindingKind): string {
  switch (kind) {
    case 'allow-list-mismatch':
      return 'Link permits the wrong person'
    case 'allow-list-wildcard':
      return 'Link permits a whole domain'
    case 'allow-list-empty':
      return 'Link permits anyone'
    case 'allow-list-multiple':
      return 'Link permits more than one person'
    case 'downloads-enabled':
      return 'Downloads enabled'
    case 'email-verification-off':
      return 'Email verification off'
    case 'link-missing':
      return 'Link no longer exists'
  }
}
