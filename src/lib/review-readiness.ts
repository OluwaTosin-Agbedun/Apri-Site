import "server-only"
import { getSql } from "./db"
import { recipientListHash } from "./edition-recipients"

/**
 * Server readiness for Complimentary Review reading, checked on the server
 * each time an owner opens Admin -> Review Library, instead of a permanent
 * setup banner. Only a genuine problem is reported, each with what to do.
 *
 * Read-only. Names a setting or a migration file, never a value, address,
 * code, token or link.
 */

export type ReadinessProblem = {
  key: string
  /** "blocker": readers cannot get in. "attention": something to repair. */
  level: "blocker" | "attention"
  message: string
}

export type ReadinessEnv = Partial<Record<"SESSION_SECRET" | "RESEND_API_KEY" | "RESEND_WEBHOOK_SECRET" | "PAPERMARK_API_TOKEN" | "PAPERMARK_API_KEY", string>>

/** The configuration checks, pure so each one is tested directly. */
export function configurationProblems(env: ReadinessEnv): ReadinessProblem[] {
  const out: ReadinessProblem[] = []
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    out.push({ key: "session_secret", level: "blocker", message: "Reader sign-in cannot work: SESSION_SECRET is missing or shorter than 32 characters on this deployment." })
  }
  if (!env.RESEND_API_KEY) {
    out.push({ key: "email_key", level: "blocker", message: "Review emails cannot be sent: RESEND_API_KEY is not set on this deployment." })
  }
  if (!env.PAPERMARK_API_TOKEN && !env.PAPERMARK_API_KEY) {
    out.push({ key: "papermark_token", level: "blocker", message: "Papermark is not connected: PAPERMARK_API_TOKEN is not set on this deployment." })
  }
  if (env.RESEND_API_KEY && !env.RESEND_WEBHOOK_SECRET) {
    out.push({ key: "email_reports", level: "attention", message: "Delivery reports are off: without RESEND_WEBHOOK_SECRET an email can only ever show as accepted, never delivered or bounced." })
  }
  return out
}

/** Tables and columns the reading journey needs, with the migration that adds them. */
const SCHEMA: { migration: string; table: string; columns: string[] }[] = [
  { migration: "20261008_review_reader_library.sql", table: "review_reader_tokens", columns: ["code_hash", "code_attempts", "binding_hash"] },
  { migration: "20261008_review_reader_library.sql", table: "review_reader_sessions", columns: [] },
  { migration: "20261009_review_reader_rooms.sql", table: "review_reader_rooms", columns: [] },
  { migration: "20261010_review_access_reliability.sql", table: "review_reader_rooms", columns: ["verified_editions", "lease_until"] },
  { migration: "20261010_review_access_reliability.sql", table: "review_email_attempts", columns: [] },
]

export async function schemaProblems(): Promise<ReadinessProblem[]> {
  const sql = getSql()
  const rows = (await sql`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
      and table_name in ('review_reader_tokens', 'review_reader_sessions', 'review_reader_rooms', 'review_email_attempts')
  `) as { table_name: string; column_name: string }[]
  const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`))
  const tables = new Set(rows.map((r) => r.table_name))
  const missing = new Set<string>()
  for (const s of SCHEMA) {
    if (!tables.has(s.table) || s.columns.some((c) => !have.has(`${s.table}.${c}`))) missing.add(s.migration)
  }
  return [...missing].sort().map((m) => ({
    key: `migration:${m}`,
    level: "blocker" as const,
    message: `Database migration db/migrations/${m} is not applied, so part of reader access is switched off.`,
  }))
}

const SERIES_ORDER = ["MIN", "AIU", "PLM"]

/** Published editions whose Papermark link does not carry the reader list APRI holds. */
export async function editionProblems(): Promise<ReadinessProblem[]> {
  const sql = getSql()
  const rows = (await sql`
    select e.id, e.series, e.edition_label, e.recipient_mode, e.recipients_verified_hash,
           (e.secure_link_id is not null and e.secure_link_verified_at is not null
              and e.secure_link_document_id = e.papermark_document_id) as link_ok,
           coalesce((select array_agg(r.email) from review_edition_recipients r
                     where r.edition_id = e.id and r.revoked_at is null), array[]::text[]) as active
    from review_publication_editions e
    where e.publication_state = 'published'
  `) as { id: string; series: string | null; edition_label: string; recipient_mode: string; recipients_verified_hash: string | null; link_ok: boolean; active: string[] }[]
  const name = (r: (typeof rows)[number]) => `${r.series ?? "Edition"} · ${r.edition_label}`
  const out: ReadinessProblem[] = []
  for (const r of rows.sort((a, b) => SERIES_ORDER.indexOf(a.series ?? "") - SERIES_ORDER.indexOf(b.series ?? ""))) {
    if (!r.link_ok) {
      out.push({ key: `edition_link:${r.id}`, level: "attention", message: `${name(r)} is published but has no verified Papermark link, so no reader can open it. Prepare its secure link.` })
    } else if (r.recipient_mode === "edition" && r.recipients_verified_hash !== recipientListHash(r.active)) {
      out.push({ key: `edition_sync:${r.id}`, level: "attention", message: `${name(r)}: its reader list changed in APRI but has not been applied to Papermark. Open the edition and use Preview, then Apply.` })
    }
  }
  return out
}

/** Reader rooms that are not ready, or whose preparation stopped part-way. */
export async function roomProblems(): Promise<ReadinessProblem[]> {
  const sql = getSql()
  const [exists] = (await sql`select to_regclass('public.review_reader_rooms') is not null as ok`) as { ok: boolean }[]
  if (!exists?.ok) return []
  const [row] = (await sql`
    select count(*) filter (where state in ('failed', 'closed'))::int as broken,
           count(*) filter (where state = 'updating' and updated_at < now() - interval '5 minutes')::int as stuck
    from review_reader_rooms
  `) as { broken: number; stuck: number }[]
  const out: ReadinessProblem[] = []
  const n = (row?.broken ?? 0) + (row?.stuck ?? 0)
  if (n > 0) {
    out.push({ key: "rooms", level: "attention", message: `${n} reader room${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} repair. Use Repair under Reader access below.` })
  }
  return out
}

/** Review emails the provider refused, or that were not sent, in the last day. */
export async function emailProblems(): Promise<ReadinessProblem[]> {
  const sql = getSql()
  const [exists] = (await sql`select to_regclass('public.review_email_attempts') is not null as ok`) as { ok: boolean }[]
  if (!exists?.ok) return []
  const [row] = (await sql`
    select count(*)::int as n, (array_agg(detail order by created_at desc))[1] as latest
    from review_email_attempts
    where outcome in ('rejected', 'not_configured') and created_at > now() - interval '24 hours'
  `) as { n: number; latest: string | null }[]
  if (!row || row.n === 0) return []
  return [{
    key: "email_refused",
    level: "attention",
    message: `${row.n} review email${row.n === 1 ? " was" : "s were"} not sent in the last day. Latest reason: ${row.latest ?? "none given"}. Details are under Advanced.`,
  }]
}

/** Every genuine problem, blockers first. Each check fails on its own: one broken check never hides the rest. */
export async function reviewReadiness(env: ReadinessEnv = process.env as ReadinessEnv): Promise<ReadinessProblem[]> {
  const parts = await Promise.all([
    Promise.resolve(configurationProblems(env)),
    schemaProblems().catch(() => [{ key: "schema", level: "blocker" as const, message: "The database could not be checked just now." }]),
    editionProblems().catch(() => []),
    roomProblems().catch(() => []),
    emailProblems().catch(() => []),
  ])
  const all = parts.flat()
  return [...all.filter((p) => p.level === "blocker"), ...all.filter((p) => p.level !== "blocker")]
}
