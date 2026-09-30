import "server-only"
import { getSql } from "./db"
import { planSubscriberAccess, type AccessPlan } from "./subscriber-access-reconciliation"

/**
 * Read-only reports on subscriber access and paid publication readiness, for
 * the rollout report, the production recovery preview and the batch repair
 * tool. Everything comes from the same access policy enforcement uses.
 *
 * Never includes a link, a link id or a URL: a Papermark link id is the
 * secure part of a document's address. Titles, dates, counts and reasons only.
 */

export type SubscriberInventory = {
  id: string
  name: string
  /** Masked: enough to recognise, not to copy. */
  email: string
  status: string
  publicTier: string | null
  level: string | null
  seats: number
  termStart: string | null
  termEnd: string | null
  periods: number
  plan: AccessPlan
  notes: string[]
}

function mask(email: string): string {
  const [user, domain] = email.split("@")
  if (!domain) return "***"
  return `${user.slice(0, 2)}***@${domain}`
}

/** Every subscriber, including those with nothing published and no paid-period history. */
export async function subscriberInventory(options: { ids?: string[]; limit?: number; offset?: number } = {}): Promise<SubscriberInventory[]> {
  const sql = getSql()
  const limit = Math.min(Math.max(options.limit ?? 1000, 1), 5000)
  const offset = Math.max(options.offset ?? 0, 0)
  const rows = (options.ids?.length
    ? await sql`
        select s.id, coalesce(nullif(s.full_name, ''), s.name, '') as name, s.email, s.status, s.public_tier, s.level, s.seats,
               to_char(s.term_start, 'YYYY-MM-DD') as term_start, to_char(s.term_end, 'YYYY-MM-DD') as term_end,
               (select count(*)::int from subscriber_subscription_periods p where p.subscriber_id = s.id and (to_jsonb(p) ->> 'voided_at') is null) as periods
        from subscribers s
        where s.client_type = 'subscriber' and s.id = any(${options.ids}::uuid[])
        order by s.id`
    : await sql`
        select s.id, coalesce(nullif(s.full_name, ''), s.name, '') as name, s.email, s.status, s.public_tier, s.level, s.seats,
               to_char(s.term_start, 'YYYY-MM-DD') as term_start, to_char(s.term_end, 'YYYY-MM-DD') as term_end,
               (select count(*)::int from subscriber_subscription_periods p where p.subscriber_id = s.id and (to_jsonb(p) ->> 'voided_at') is null) as periods
        from subscribers s
        where s.client_type = 'subscriber'
        order by s.id
        limit ${limit} offset ${offset}`) as {
    id: string; name: string; email: string; status: string; public_tier: string | null; level: string | null; seats: number
    term_start: string | null; term_end: string | null; periods: number
  }[]

  const out: SubscriberInventory[] = []
  for (const r of rows) {
    const plan = await planSubscriberAccess(r.id)
    const notes: string[] = []
    if (Number(r.periods) === 0) notes.push("No paid periods recorded: every edition is undecided until the agreed term is added.")
    if (r.public_tier === "Professional Team Access" && Number(r.seats) > 3) notes.push("Negotiated Professional arrangement above the new-plan seat limit: review, do not remove users.")
    if (plan.state === "ok" && plan.counts.unresolved > 0) notes.push(`${plan.counts.unresolved} document(s) await a release decision or publication details.`)
    if (plan.state === "ok" && plan.orphans > 0) notes.push(`${plan.orphans} live link(s) to documents no longer in their Data Room would be withdrawn.`)
    out.push({
      id: r.id,
      name: r.name,
      email: mask(r.email),
      status: r.status.toLowerCase(),
      publicTier: r.public_tier,
      level: r.level,
      seats: Number(r.seats),
      termStart: r.term_start,
      termEnd: r.term_end,
      periods: Number(r.periods),
      plan,
      notes,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Paid publication readiness
// ---------------------------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]

/** A month named in a file title, as 1-12, or null. Used only to flag, never to set a date. */
export function monthNamedInTitle(title: string): number | null {
  const lower = title.toLowerCase()
  for (let i = 0; i < MONTHS.length; i++) {
    const full = MONTHS[i]!
    if (new RegExp(`\\b${full}\\b`).test(lower) || new RegExp(`\\b${full.slice(0, 3)}\\b`).test(lower)) return i + 1
  }
  return null
}

export type PublicationReadiness = {
  publicationId: string
  title: string
  fileTitles: string[]
  series: string | null
  editionDate: string | null
  visibility: string | null
  editorialStatus: string
  explicitRelease: string | null
  /** Plans ticked for the edition (stored names). */
  plans: string[]
  /** Paid Data Rooms (mapped to a level) that hold the document. */
  paidRooms: number
  /** Subscribers who were issued a personal link to it at any time. */
  subscribersIssued: number
  /** Subscribers with a live personal link to it now. */
  subscribersLive: number
  /** Views of it recorded for paid subscribers. */
  paidViews: number
  flags: string[]
  /** Evidence it was already delivered to paid subscribers, while undecided: a backfill candidate. */
  backfillCandidate: boolean
}

export async function publicationReadiness(): Promise<PublicationReadiness[]> {
  const sql = getSql()
  const rows = (await sql`
    select d.id, d.title, d.series, to_char(d.edition_date, 'YYYY-MM-DD') as edition_date, d.visibility, d.status,
           to_jsonb(d) ->> 'paid_release_state' as explicit_release,
           coalesce(array_agg(distinct dd.title) filter (where dd.title is not null), '{}') as file_titles,
           count(distinct dd.papermark_dataroom_id) filter (where lr.papermark_dataroom_id is not null)::int as paid_rooms,
           coalesce(array_agg(distinct dd.category) filter (where dd.category is not null), '{}') as categories,
           (select count(distinct dl.subscriber_id)::int from papermark_subscriber_document_links dl
              where dl.papermark_document_id in (select x.papermark_document_id from papermark_dataroom_documents x where x.publication_id = d.id)) as issued,
           (select count(distinct dl.subscriber_id)::int from papermark_subscriber_document_links dl
              where dl.revoke_state = 'live'
                and dl.papermark_document_id in (select x.papermark_document_id from papermark_dataroom_documents x where x.publication_id = d.id)) as live,
           (select count(*)::int from document_views v join subscribers s on s.id = v.subscriber_id
              where s.client_type = 'subscriber'
                and (v.publication_id = d.id or v.papermark_document_id in (select x.papermark_document_id from papermark_dataroom_documents x where x.publication_id = d.id))) as paid_views
    from documents d
    join papermark_dataroom_documents dd on dd.publication_id = d.id and dd.is_present = true
    left join papermark_level_rooms lr on lr.papermark_dataroom_id = dd.papermark_dataroom_id
    where d.visibility <> 'OPEN'
    group by d.id
    order by d.edition_date desc nulls first, d.title
  `) as {
    id: string; title: string; series: string | null; edition_date: string | null; visibility: string | null; status: string
    explicit_release: string | null; file_titles: string[]; paid_rooms: number; categories: string[]
    issued: number; live: number; paid_views: number
  }[]

  const { publicationPlansReady } = await import("./access-policy-dal")
  const plansBy = new Map<string, string[]>()
  if (rows.length && (await publicationPlansReady(sql))) {
    const planRows = (await sql`select publication_id, public_tier from publication_plans where publication_id = any(${rows.map((r) => r.id)}::uuid[])`) as { publication_id: string; public_tier: string }[]
    for (const pr of planRows) plansBy.set(pr.publication_id, [...(plansBy.get(pr.publication_id) ?? []), pr.public_tier])
  }

  return rows.map((r) => {
    const flags: string[] = []
    const plans = plansBy.get(r.id) ?? []
    if (plans.length === 0) flags.push("No plan ticked: no subscriber can receive it until at least one plan is ticked.")
    if (!r.edition_date) flags.push("No edition date: enter it from the edition itself; it is never guessed.")
    if (!r.series) flags.push("No series.")
    const categories = (r.categories ?? []).filter((c) => c && c !== "OTHER")
    if (r.series && categories.length > 0 && !categories.includes(r.series)) {
      flags.push(`Series ${r.series} differs from the Data Room folder category (${categories.join(", ")}).`)
    }
    if (r.edition_date) {
      const month = Number(r.edition_date.slice(5, 7))
      for (const t of r.file_titles ?? []) {
        const named = monthNamedInTitle(t)
        if (named && named !== month) {
          flags.push(`File "${t}" names ${MONTHS[named - 1]} but the edition date is ${r.edition_date}: check which is right.`)
          break
        }
      }
    }
    if (r.paid_rooms === 0) flags.push("Not in any plan's Data Room.")
    const undecided = !r.explicit_release && r.status !== "published" && r.status !== "archived"
    return {
      publicationId: r.id,
      title: r.title,
      fileTitles: r.file_titles ?? [],
      series: r.series,
      editionDate: r.edition_date,
      visibility: r.visibility,
      editorialStatus: r.status,
      explicitRelease: r.explicit_release,
      plans,
      paidRooms: r.paid_rooms,
      subscribersIssued: r.issued,
      subscribersLive: r.live,
      paidViews: r.paid_views,
      flags,
      backfillCandidate: undecided && r.paid_rooms > 0 && (r.issued > 0 || r.paid_views > 0),
    }
  })
}
