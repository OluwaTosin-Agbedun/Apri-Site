import Link from "next/link"
import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/dal"
import AdminShell from "@/components/AdminShell"
import { getSubscriberForEngagement, getSubscriberTimeline, type EngagementTimelineEntry } from "@/lib/client-engagement"
import { tierDisplayName } from "@/lib/entitlements"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const EVENT_LABELS: Record<string, string> = {
  signin_email_sent: "Sign-in email sent",
  email_delivered: "Email delivered",
  email_opened: "Email opened",
  email_clicked: "Email link clicked",
  email_bounced: "Email bounced",
  email_failed: "Email failed",
  signin_completed: "Signed in",
  portal_opened: "Opened portal",
  private_link_opened: "Opened private library link",
  document_downloaded: "Downloaded a document",
  publication_notification_sent: "Publication notification sent",
}

export default async function SubscriberEngagementPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params

  if (!UUID.test(id)) notFound()

  const subscriber = await getSubscriberForEngagement(id)
  if (!subscriber) notFound()

  const timeline = await getSubscriberTimeline(id)

  return (
    <AdminShell
      admin={admin}
      current="/admin/engagement"
      title={subscriber.name || "Subscriber"}
      description="Engagement detail and activity timeline."
      actions={
        <Link
          href="/admin/engagement"
          className="text-sm text-foreground/60 hover:text-foreground transition-colors"
        >
          Back to engagement
        </Link>
      }
    >
      {/* Subscriber info */}
      <div className="border border-border rounded-sm p-4 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="mt-0.5">{subscriber.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Level</p>
            <p className="mt-0.5">{tierDisplayName(subscriber.publicTier) || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="mt-0.5">
              <span className={`text-xs px-1.5 py-0.5 rounded ${subscriber.status.toLowerCase() === "active" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                {subscriber.status}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Term</p>
            <p className="mt-0.5 text-xs">
              {subscriber.termStart ? fmtDate(subscriber.termStart) : "—"}
              {" — "}
              {subscriber.termEnd ? fmtDate(subscriber.termEnd) : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Activity timeline */}
      <h3 className="font-serif text-lg mb-3">Activity timeline</h3>

      {timeline.length === 0 && (
        <p className="text-sm text-muted-foreground p-4 border border-border rounded-sm">No activity recorded yet.</p>
      )}

      {timeline.length > 0 && (
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-card/30 text-left">
                <th className="p-3 font-medium">Event</th>
                <th className="p-3 font-medium">Date</th>
                <th className="p-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((entry) => (
                <tr key={entry.id} className="border-b">
                  <td className="p-3">
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${eventColor(entry.eventType)}`} />
                    {EVENT_LABELS[entry.eventType] ?? entry.eventType}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground tabular-nums">{fmtDateTime(entry.occurredAt)}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {detailText(entry)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-3">Showing the most recent {timeline.length} events.</p>
    </AdminShell>
  )
}

function detailText(entry: EngagementTimelineEntry): string {
  const title = typeof entry.metadata.documentTitle === 'string' ? entry.metadata.documentTitle : null
  if (title) return title
  if (entry.resendEmailId) return `Resend ID: ${entry.resendEmailId.slice(0, 12)}…`
  return "—"
}

function eventColor(type: string): string {
  if (type === "signin_completed" || type === "portal_opened") return "bg-green-500"
  if (type.includes("failed") || type.includes("bounced")) return "bg-red-500"
  if (type.includes("email")) return "bg-blue-400"
  if (type.includes("download")) return "bg-purple-500"
  return "bg-gray-400"
}

function fmtDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function fmtDateTime(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}
