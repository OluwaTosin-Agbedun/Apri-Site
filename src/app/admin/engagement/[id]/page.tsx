import Link from "next/link"
import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/dal"
import AdminShell from "@/components/AdminShell"
import { getSubscriberTimeline, type EngagementTimelineEntry } from "@/lib/client-engagement"
import { formatLagos } from "@/lib/engagement-metrics"
import { getMonitorStatus, getSubscriberMonitorDetail } from "@/lib/reader-monitoring"
import { lagosDateRange, NO_LOGIN, NO_VISIT } from "@/lib/reader-monitoring-rules"
import { Badge, EditionActivityTable } from "../monitor-parts"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SERIES = ["MIN", "AIU", "PLM", "AEO", "QIB"]

const EVENT_LABELS: Record<string, string> = {
  signin_email_sent: "Sign-in email accepted by the email provider",
  email_delivered: "Email delivered",
  email_opened: "Email opened",
  email_clicked: "Email link clicked",
  email_bounced: "Email bounced",
  email_failed: "Email failed",
  signin_completed: "Signed in",
  portal_opened: "Opened portal",
  private_link_opened: "Opened private library link",
  document_downloaded: "Download recorded",
  publication_notification_sent: "Publication notification sent",
}

/**
 * One subscriber's publication activity -- one row per exact edition and
 * version -- with their all-time login and portal visit, and their sign-in and
 * email history kept below, collapsed.
 */
export default async function SubscriberEngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string; to?: string; series?: string; scope?: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const query = await searchParams
  const range = lagosDateRange(query.from, query.to)
  const series = SERIES.includes(query.series ?? "") ? String(query.series) : ""
  // Cumulative (all recorded sessions) by default; the selected period only when asked for.
  const periodScope = query.scope === "period" && range !== null

  const [detail, timeline, status] = await Promise.all([
    getSubscriberMonitorDetail(id, { range: periodScope ? range : null, series }),
    getSubscriberTimeline(id),
    getMonitorStatus(),
  ])
  if (!detail) notFound()
  const s = detail.subscriber
  const period = range ? (range.from === range.to ? range.from : `${range.from} to ${range.to}`) : null

  const toggle = (scope: "all" | "period") => {
    const sp = new URLSearchParams()
    if (range) {
      sp.set("from", range.from)
      sp.set("to", range.to)
    }
    if (series) sp.set("series", series)
    if (scope === "period") sp.set("scope", "period")
    return `?${sp.toString()}`
  }

  return (
    <AdminShell
      admin={admin}
      current="/admin/engagement"
      title={s.name || "Subscriber"}
      description="Publication activity from Papermark's confirmed sessions, one row per edition."
      actions={
        <Link href="/admin/engagement" className="text-sm text-foreground/60 hover:text-foreground transition-colors">
          Back to engagement
        </Link>
      }
    >
      <div className="border border-border p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
          <Info label="Email" value={s.email} extra={s.isAdministrator ? <Badge>APRI admin</Badge> : null} />
          <Info label="Level" value={s.level} />
          <Info label="Access" value={s.status.label} />
          <Info label="Term ends" value={s.termEnd ?? "—"} />
          <Info label="Last successful login" value={s.lastLoginAt ? formatLagos(s.lastLoginAt) : NO_LOGIN} />
          <Info label="Last portal visit" value={s.lastPortalVisitAt ? formatLagos(s.lastPortalVisitAt) : NO_VISIT} />
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Login and portal visit are all-time. {status.pageProgressNote ?? ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="font-serif text-lg">Publication activity{series ? ` · ${series}` : ""}</h3>
        {range && (
          <div className="flex gap-2 text-xs">
            <Link
              href={toggle("all")}
              className={`px-3 py-1.5 border ${!periodScope ? "border-accent text-accent" : "border-border text-muted-foreground"}`}
            >
              All recorded sessions
            </Link>
            <Link
              href={toggle("period")}
              className={`px-3 py-1.5 border ${periodScope ? "border-accent text-accent" : "border-border text-muted-foreground"}`}
            >
              Only {period}
            </Link>
          </div>
        )}
      </div>

      <EditionActivityTable
        editions={detail.editions}
        periodLabel={periodScope ? period : null}
        emptyText={periodScope ? "No recorded sessions in this period." : "No confirmed Papermark sessions recorded for this subscriber."}
      />
      {detail.unidentifiedSessions > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          {detail.unidentifiedSessions} session{detail.unidentifiedSessions === 1 ? "" : "s"} could not be tied to a
          document and {detail.unidentifiedSessions === 1 ? "is" : "are"} kept in Diagnostics rather than guessed.
        </p>
      )}

      <details className="mt-10 border border-border">
        <summary className="cursor-pointer p-4 text-sm font-medium hover:bg-black/5">
          Sign-in and email history ({timeline.length})
        </summary>
        <div className="border-t border-border overflow-x-auto">
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No activity recorded yet.</p>
          ) : (
            <table className="w-full text-sm min-w-[32rem]">
              <thead>
                <tr className="border-b bg-card/30 text-left">
                  <th className="p-3 font-medium">Event</th>
                  <th className="p-3 font-medium">When</th>
                  <th className="p-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((entry) => (
                  <tr key={entry.id} className="border-b">
                    <td className="p-3">{EVENT_LABELS[entry.eventType] ?? entry.eventType}</td>
                    <td className="p-3 text-xs text-muted-foreground tabular-nums">{formatLagos(entry.occurredAt)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{detailText(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted-foreground p-3">
            Showing the most recent {timeline.length} events. A download recorded here from a portal button is not a
            confirmed Papermark download; the publication table above counts confirmed downloads only.
          </p>
        </div>
      </details>
    </AdminShell>
  )
}

function Info({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words">
        {value}
        {extra}
      </p>
    </div>
  )
}

function detailText(entry: EngagementTimelineEntry): string {
  const title = typeof entry.metadata.documentTitle === "string" ? entry.metadata.documentTitle : null
  if (title) return title
  if (entry.resendEmailId) return `Resend ID: ${entry.resendEmailId.slice(0, 12)}…`
  return "—"
}
