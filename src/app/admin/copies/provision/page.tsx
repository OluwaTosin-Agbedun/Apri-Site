import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import AdminShell from '@/components/AdminShell'
import { copyNames } from '@/lib/copy-naming'
import { SERIES, isLevel, isSeriesCode } from '@/lib/entitlements'
import ProvisionForm, { type ProvisionTarget } from '../provision-form'

export const metadata = { title: 'Provision a copy · APRI' }
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The provisioning form for one subscriber and one publication.
 *
 * Both ids come from the queue row, and both are re-read here rather than
 * trusted from the query string for anything but the lookup — the names shown
 * are generated from the records, so what the operator pastes always matches
 * who the copy is for.
 */
export default async function ProvisionPage({
  searchParams,
}: {
  // Next 16: searchParams is a promise.
  searchParams: Promise<{ s?: string; p?: string }>
}) {
  const admin = await requireAdmin()
  const { s: subscriberId, p: publicationId } = await searchParams

  if (!subscriberId || !publicationId) notFound()
  if (!UUID.test(subscriberId) || !UUID.test(publicationId)) notFound()

  const sql = getSql()
  const rows = (await sql`
    select coalesce(nullif(s.full_name, ''), s.name) as full_name,
           s.organization, s.seat_no, s.level, s.seats,
           d.series, d.code, d.title, d.edition_date, d.visibility, d.is_shared_copy
    from subscribers s
    cross join documents d
    where s.id = ${subscriberId} and d.id = ${publicationId}
    limit 1
  `) as {
    full_name: string | null
    organization: string
    seat_no: number | null
    level: string | null
    seats: number
    series: string
    code: string | null
    title: string
    edition_date: string | Date | null
    visibility: string
    is_shared_copy: boolean
  }[]

  const row = rows[0]
  if (!row) notFound()
  if (!isLevel(row.level)) notFound()

  const publication = {
    series: row.series,
    code: row.code,
    title: row.title,
    editionDate: row.edition_date,
  }
  const subscriber = {
    fullName: row.full_name || '',
    organisation: row.organization,
    seatNo: row.seat_no,
  }

  const seriesName = isSeriesCode(row.series) ? SERIES[row.series] : row.title

  const target: ProvisionTarget = {
    subscriberId,
    publicationId,
    subscriberName: subscriber.fullName,
    organisation: subscriber.organisation,
    level: row.level,
    seats: Number(row.seats ?? 1),
    publicationTitle: row.title,
    names: copyNames(publication, subscriber, seriesName),
  }

  const lane =
    row.visibility === 'OPEN'
      ? 'This publication is open to all readers and needs no per-subscriber copy.'
      : row.is_shared_copy
        ? 'This publication is marked as a shared unstamped copy.'
        : null

  return (
    <AdminShell
      admin={admin}
      current="/admin/copies"
      title="Provision a copy"
      description="One stamped document, one link, one named person."
    >
      {lane ? (
        <div className="border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {lane}
        </div>
      ) : (
        <ProvisionForm target={target} />
      )}
    </AdminShell>
  )
}
