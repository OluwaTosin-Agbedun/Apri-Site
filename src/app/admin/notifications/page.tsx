import AdminShell from "@/components/AdminShell"
import SubmitButton from "@/components/SubmitButton"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import {
  noticeSchemaReady,
  noticeSettings,
  publicationEmailsConfigured,
  NOTICE_MIGRATION,
} from "@/lib/publication-notifications"
import { maskEmail } from "@/lib/review-email-attempts"
import { processPublicationNotices } from "@/app/actions/publication-notifications"
import {
  NotificationSettingsForm,
  CorrectionNoticeForm,
  RetryNoticeForm,
} from "./notification-forms"
export const dynamic = "force-dynamic"
export const maxDuration = 60
export const metadata = {
  title: "Publication alerts · Athena Strategic Advisory",
  robots: { index: false, follow: false },
}
const date = (v: unknown) =>
  v
    ? new Date(String(v)).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })
    : "Not recorded"
export default async function NotificationsPage() {
  const admin = await requireOwner()
  const sql = getSql()
  if (!(await noticeSchemaReady(sql)))
    return (
      <AdminShell
        admin={admin}
        current="/admin/notifications"
        title="Publication alerts"
      >
        <p>
          Apply {NOTICE_MIGRATION} to enable saved notification jobs. No emails
          are sent by this page.
        </p>
      </AdminShell>
    )
  const [settings, counts, jobs, publications, baseline] = await Promise.all([
    noticeSettings(sql),
    sql`select state,count(*)::int as n from publication_notice_jobs group by state order by state`,
    sql`select j.id,j.state,j.outcome,j.detail,j.created_at,j.accepted_at,s.email,d.title,e.kind
      from publication_notice_jobs j join subscribers s on s.id=j.subscriber_id join publication_notice_events e on e.id=j.event_id
      join documents d on d.id=e.publication_id order by j.created_at desc,j.id limit 50`,
    sql`select id,title from documents where visibility<>'OPEN' and status<>'archived'
      and (paid_release_state='released' or (paid_release_state is null and status='published')) order by edition_date desc nulls last,id limit 200`,
    sql`select (select count(*)::int from documents where visibility<>'OPEN' and status<>'archived'
      and (paid_release_state='released' or (paid_release_state is null and status='published'))) as released,
      (select count(*)::int from subscribers where client_type='subscriber' and lower(status)='active') as active,
      (select count(*)::int from publication_notice_events where state in ('pending','fanning')) as events`,
  ])
  const hostEnabled = publicationEmailsConfigured()
  const provider = Boolean(process.env.RESEND_API_KEY)
  return (
    <AdminShell
      admin={admin}
      current="/admin/notifications"
      title="Publication alerts"
      description="One saved queue for new editions and approved updates. Every send rechecks access and email preferences."
    >
      <div className="space-y-8">
        <section className="space-y-3">
          <h3 className="font-medium">Sending status</h3>
          <p className="text-sm">
            Owner setting: {settings?.enabled ? "on" : "paused"} · Hosting
            switch: {hostEnabled ? "on" : "off"} · Email provider:{" "}
            {provider ? "configured" : "not configured"}.
          </p>
          <p className="text-sm text-muted-foreground">
            Baseline: {date(settings?.baseline_at)} · Last worker check:{" "}
            {date(settings?.worker_at)} (Lagos). The hourly worker may take
            several runs for a large audience. It makes no Papermark calls.
          </p>
          <p className="text-sm">
            {counts
              .map((c) => `${String(c.state)}: ${Number(c.n)}`)
              .join(" · ") || "No notification jobs yet."}{" "}
            · Announcements awaiting preparation:{" "}
            {Number(baseline[0]?.events ?? 0)}
          </p>
          <form action={processPublicationNotices}>
            <SubmitButton
              busy="Starting…"
              disabled={!settings?.enabled || !hostEnabled || !provider}
              className="min-h-11 rounded border border-border px-4 py-2 text-sm disabled:opacity-60"
            >
              Process a bounded batch now
            </SubmitButton>
          </form>
          <p className="text-sm">
            Accepted means the email provider accepted it. Delivery is reported
            separately in Operations. Unknown means it may have been sent: check
            the provider before any follow-up.
          </p>
        </section>
        <section className="space-y-3">
          <h3 className="font-medium">Recent saved notifications</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <caption className="sr-only">
                Saved publication notifications
              </caption>
              <thead>
                <tr>
                  {["Publication", "Reader", "Outcome", "Time (Lagos)"].map(
                    (t) => (
                      <th
                        key={t}
                        scope="col"
                        className="p-2 border-b border-border"
                      >
                        {t}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={String(j.id)}>
                    <td className="p-2 border-b border-border">
                      {String(j.title)}
                      <span className="block text-xs text-muted-foreground">
                        {String(j.kind)}
                      </span>
                    </td>
                    <td className="p-2 border-b border-border">
                      {maskEmail(String(j.email))}
                    </td>
                    <td className="p-2 border-b border-border">
                      {String(j.state)}
                      {j.detail && (
                        <span className="block text-xs mt-1">
                          {String(j.detail)}
                        </span>
                      )}
                      {j.state === "failed" && j.outcome === "rejected" && (
                        <details className="mt-2">
                          <summary className="cursor-pointer">
                            Retry after correcting the known refusal
                          </summary>
                          <RetryNoticeForm jobId={String(j.id)} />
                        </details>
                      )}
                    </td>
                    <td className="p-2 border-b border-border whitespace-nowrap">
                      {date(j.accepted_at ?? j.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <details className="border border-border rounded p-5">
          <summary className="cursor-pointer font-medium">
            Approve the starting baseline or pause alerts
          </summary>
          <div className="mt-4 space-y-4">
            <p className="text-sm">
              Currently {Number(baseline[0]?.released ?? 0)} editions are
              released and {Number(baseline[0]?.active ?? 0)} subscriber records
              are active. These are starting counts, not an entitled email
              audience. Existing released editions are excluded from automatic
              first-publication alerts when you enable this setting. Counts may
              change while editors work.
            </p>
            <p className="text-sm">
              The hosting flag DATAROOM_NEW_DOCUMENT_EMAILS must also equal
              enabled. Apply the migration, verify controlled recipients and the
              sender, then approve this baseline. Pausing leaves existing jobs
              recorded.
            </p>
            <NotificationSettingsForm enabled={settings?.enabled === true} />
          </div>
        </details>
        <details className="border border-border rounded p-5">
          <summary className="cursor-pointer font-medium">
            Notify readers of a substantive approved update
          </summary>
          <div className="mt-4 space-y-4">
            <p className="text-sm">
              Normal renames, syncs and repairs send nothing. After approving a
              corrected reading copy, record one version label and reason.
              Reusing that label cannot send the update twice. Unsent older
              announcements are cancelled.
            </p>
            <CorrectionNoticeForm
              publications={publications.map((p) => ({
                id: String(p.id),
                title: String(p.title),
              }))}
            />
          </div>
        </details>
      </div>
    </AdminShell>
  )
}
