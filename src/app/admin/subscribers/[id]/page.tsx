import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import AdminShell from '@/components/AdminShell'
import SubscriberForm, { type SubscriberDraft } from './subscriber-form'
import SeatActions from '../seat-actions'

export const dynamic = 'force-dynamic'

const BLANK: SubscriberDraft = {
  id: null,
  clientType: 'subscriber',
  fullName: '',
  organisation: '',
  roleTitle: '',
  email: '',
  phone: '',
  publicTier: '',
  level: '',
  seats: 1,
  termStart: '',
  termEnd: '',
  status: 'pending',
  invoiceRef: '',
  libraryLinkUrl: '',
  note: '',
}

type Row = {
  id: string
  client_type: string
  full_name: string | null
  name: string
  organization: string
  role_title: string
  email: string
  phone: string
  public_tier: string
  level: string | null
  seats: number
  term_start: string | null
  term_end: string | null
  status: string
  invoice_ref: string
  library_link_url: string | null
  note: string
  last_viewed_at: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A date column rendered into a value an <input type="date"> accepts. */
function dateInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export default async function EditSubscriberPage({
  params,
}: {
  // Next 16: params is a promise.
  params: Promise<{ id: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params

  if (id === 'new') {
    return (
      <AdminShell
        admin={admin}
        current="/admin/subscribers"
        title="New Subscriber"
        description="One row per named person. An organisation with several seats needs one row each."
      >
        <SubscriberForm draft={BLANK} />
      </AdminShell>
    )
  }

  // Reject anything that is not a uuid before it reaches the query.
  if (!UUID.test(id)) notFound()

  const sql = getSql()
  const rows = (await sql`
    select s.id, s.client_type, s.full_name, s.name, s.organization, s.role_title, s.email, s.phone,
           s.public_tier, s.level, s.seats, s.term_start, s.term_end, s.status,
           s.invoice_ref, s.library_link_url, s.note, s.last_viewed_at,
           (select count(*)::int from publication_access pa
             where pa.subscriber_id = s.id and pa.revoke_state = 'live') as live_links
    from subscribers s
    where s.id = ${id}
    limit 1
  `) as (Row & { live_links: number })[]

  const row = rows[0]
  if (!row) notFound()

  const draft: SubscriberDraft = {
    id: row.id,
    clientType: row.client_type || 'subscriber',
    fullName: row.full_name || row.name || '',
    organisation: row.organization,
    roleTitle: row.role_title,
    email: row.email,
    phone: row.phone,
    publicTier: row.public_tier,
    level: row.level ?? '',
    seats: row.seats,
    termStart: dateInput(row.term_start),
    termEnd: dateInput(row.term_end),
    status: row.status.toLowerCase(),
    invoiceRef: row.invoice_ref,
    libraryLinkUrl: row.library_link_url ?? '',
    note: row.note,
  }

  const status = row.status.toLowerCase()

  return (
    <AdminShell
      admin={admin}
      current="/admin/subscribers"
      title={draft.fullName || 'Subscriber'}
      description={
        row.last_viewed_at
          ? `Status: ${status}. Last opened their library on ${new Date(row.last_viewed_at).toLocaleDateString('en-GB')}.`
          : `Status: ${status}. Has not opened their library yet.`
      }
    >
      <div className="mb-6 border border-border bg-card/30 p-6">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-4">
          After payment
        </h3>
        <SeatActions
          id={row.id}
          status={status}
          hasLevel={Boolean(row.level)}
          hasTermEnd={Boolean(row.term_end)}
          liveLinks={Number(row.live_links ?? 0)}
        />
      </div>

      <SubscriberForm draft={draft} />
    </AdminShell>
  )
}
