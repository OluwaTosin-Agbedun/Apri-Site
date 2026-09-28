import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import AdminShell from "@/components/AdminShell"
import { getReachMonths } from "@/lib/provisioning"
import SubscriberForm, { type SubscriberDraft } from "./subscriber-form"
import SeatActions from "../seat-actions"
import DataRoomPanel from "@/components/DataRoomPanel"
import { resolveDataRoom, getDataRoomLink } from "@/lib/dataroom-dal"
import { portalSignInUrl } from "@/lib/app-url"
import { decidePortalLinkCopy } from "@/lib/portal-link-copy"
import CopyPortalLink from "./copy-portal-link"

export const dynamic = "force-dynamic"

const BLANK: SubscriberDraft = {
  id: null,
  clientType: "subscriber",
  fullName: "",
  organisation: "",
  roleTitle: "",
  email: "",
  phone: "",
  publicTier: "",
  seats: 1,
  termStart: "",
  termEnd: "",
  status: "pending",
  invoiceRef: "",
  libraryLinkUrl: "",
  note: "",
  papermarkFolderId: "",
  librarySyncedAt: null,
}

type Row = {
  id: string
  full_name: string | null
  name: string
  organization: string
  role_title: string
  email: string
  phone: string
  client_type: string
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
  updated_at: string | null
  library_link_updated_at: string | null
  papermark_folder_id: string | null
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function dateInput(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toISOString().slice(0, 10)
}

export default async function EditSubscriberPage({
  params,
  // Next 16: params is a promise.
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params

  if (id === "new") {
    return (
      <AdminShell
        admin={admin}
        current="/admin/subscribers"
        title="New Subscriber"
        description="Add one named subscriber manually. Individual Access is always one seat."
      >
        <SubscriberForm draft={BLANK} />
      </AdminShell>
    )
  }

  if (!UUID.test(id)) notFound()

  const sql = getSql()
  const rows = (await sql`
    select s.id, s.full_name, s.name, s.organization, s.role_title, s.email, s.phone,
           s.client_type, s.public_tier, s.level, s.seats, s.term_start, s.term_end, s.status,
           s.invoice_ref, s.library_link_url, s.papermark_folder_id, s.note, s.last_viewed_at, s.updated_at, s.library_link_updated_at,
           (select count(*)::int from publication_access pa
             where pa.subscriber_id = s.id and pa.revoke_state = 'live') as live_links,
           (select max(synced_at) from papermark_client_documents pcd
             where pcd.subscriber_id = s.id) as library_synced_at
    from subscribers s
    where s.id = ${id} and s.client_type = 'subscriber'
    limit 1
  `) as (Row & { live_links: number; library_synced_at: string | Date | null })[]

  const row = rows[0]
  if (!row) notFound()

  const reachMonths = await getReachMonths()

  // Published editions this person could be granted, and whether they already
  // hold a live copy. Board papers included: an engagement client's paper is
  // usually one of these.
  const draft: SubscriberDraft = {
    id: row.id,
    clientType: row.client_type || "subscriber",
    fullName: row.full_name || row.name || "",
    organisation: row.organization,
    roleTitle: row.role_title,
    email: row.email,
    phone: row.phone,
    publicTier: row.public_tier,
    seats: row.seats,
    termStart: dateInput(row.term_start),
    termEnd: dateInput(row.term_end),
    status: row.status.toLowerCase(),
    invoiceRef: row.invoice_ref,
    libraryLinkUrl: row.library_link_url ?? "",
    note: row.note,
    papermarkFolderId: row.papermark_folder_id ?? "",
    librarySyncedAt: row.library_synced_at
      ? new Date(row.library_synced_at).toISOString()
      : null,
  }

  const room = await resolveDataRoom({
    subscriberId: row.id,
    publicTier: row.public_tier,
  })
  const drLink = room
    ? await getDataRoomLink({ subscriberId: row.id, dataroomId: room.dataroomId })
    : null

  const status = row.status.toLowerCase()

  // This subscriber's own latest access email that Resend accepted, and
  // whether it later bounced. Filtered by this record's id only, so another
  // subscriber's delivery can never unlock the button here.
  const accessEmails = (await sql`
    select e.subscriber_id, e.resend_email_id, e.occurred_at,
           exists (
             select 1 from client_engagement_events f
             where f.subscriber_id = e.subscriber_id
               and f.resend_email_id = e.resend_email_id
               and f.event_type in ('email_bounced', 'email_failed')
           ) as failed
    from client_engagement_events e
    where e.subscriber_id = ${row.id}::uuid
      and e.event_type = 'signin_email_sent'
      and e.resend_email_id is not null
    order by e.occurred_at desc
    limit 1
  `) as {
    subscriber_id: string
    resend_email_id: string | null
    occurred_at: string | null
    failed: boolean
  }[]
  const portalLink = decidePortalLinkCopy({
    subscriber: {
      subscriberId: row.id,
      status,
      clientType: row.client_type,
      termEnd: row.term_end,
    },
    accessEmail: accessEmails[0]
      ? {
          subscriberId: accessEmails[0].subscriber_id,
          resendEmailId: accessEmails[0].resend_email_id,
          sentAt: accessEmails[0].occurred_at,
          failed: accessEmails[0].failed === true,
        }
      : null,
    signInUrl: portalSignInUrl(),
  })

  return (
    <AdminShell
      admin={admin}
      current="/admin/subscribers"
      title={draft.fullName || "Subscriber"}
      description={
        row.last_viewed_at
          ? `Status: ${status}. Last opened their library on ${new Date(row.last_viewed_at).toLocaleDateString("en-GB")}.`
          : `Status: ${status}. Has not opened their library yet.`
      }
    >
      <div className="mb-6 border border-border bg-card/30 p-6">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-4">
          Activation
        </h3>
        <SeatActions
          id={row.id}
          email={row.email}
          status={status}
          hasLevel={Boolean(row.public_tier && row.level)}
          hasTermEnd={Boolean(row.term_end)}
          liveLinks={Number(row.live_links ?? 0)}
        />
        {portalLink.show && (
          <CopyPortalLink
            url={portalLink.url}
            subscriberName={draft.fullName}
            subscriberEmail={row.email}
          />
        )}
        <p className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground leading-relaxed max-w-xl">
          Entitlement reaches back {reachMonths} month
          {reachMonths === 1 ? "" : "s"} from today
          {row.term_start
            ? `, or to ${new Date(row.term_start).toLocaleDateString("en-GB")} if that is later.`
            : ", or to their term start if that is later."}{" "}
          Editions published before that are not owed and will not appear in
          Copies needed.
        </p>
      </div>

      <DataRoomPanel
        subscriberId={row.id}
        dataroomName={room?.dataroomName ?? null}
        dataroomId={room?.dataroomId ?? null}
        link={drLink ? {
          id: drLink.id,
          linkUrl: drLink.linkUrl,
          assignedName: drLink.assignedName,
          assignedEmail: drLink.assignedEmail,
          allowDownload: drLink.allowDownload,
          revokeState: drLink.revokeState,
          createdAt: drLink.createdAt,
          totalViews: drLink.totalViews,
          uniqueViewers: drLink.uniqueViewers,
          lastActivityAt: drLink.lastActivityAt,
        } : null}
      />

      <SubscriberForm draft={draft} />
    </AdminShell>
  )
}
