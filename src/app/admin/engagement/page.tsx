import Link from "next/link"
import { requireAdmin } from "@/lib/dal"
import AdminShell from "@/components/AdminShell"
import { PUBLIC_TIER_NAMES, tierDisplayName } from "@/lib/entitlements"
import { getDiagnostics } from "@/lib/engagement-analytics"
import { formatLagos, formatMetric, DISPLAY_TIME_ZONE } from "@/lib/engagement-metrics"
import {
  getMonitorStatus,
  listReviewReaders,
  listSubscriberReaders,
  type MonitorFilters,
} from "@/lib/reader-monitoring"
import { readMonitorFilters, NO_LOGIN, NO_VISIT, type DateRange } from "@/lib/reader-monitoring-rules"
import { EngagementMaintenance, ReaderSearch } from "./engagement-client"
import { Badge, EditionActivityTable } from "./monitor-parts"

export const metadata = { title: "Engagement · APRI" }
export const dynamic = "force-dynamic"

type Params = {
  tab?: string
  from?: string
  to?: string
  level?: string
  status?: string
  series?: string
}

const TABS = [
  { key: "subscribers", label: "Subscribers" },
  { key: "review", label: "Complimentary Review" },
] as const

const STATUSES = [
  { value: "", label: "Any status" },
  { value: "active", label: "Active" },
  { value: "term_ended", label: "Active, term ended" },
  { value: "pending", label: "Pending" },
  { value: "lapsed", label: "Lapsed" },
  { value: "suspended", label: "Suspended" },
  { value: "declined", label: "Declined" },
]

const SERIES = ["", "MIN", "AIU", "PLM", "AEO", "QIB"]

/** Keeps only known values, so nothing from the address bar reaches a query unchecked. */
function readFilters(params: Params): { filters: MonitorFilters; rangeInvalid: boolean } {
  return readMonitorFilters(params, PUBLIC_TIER_NAMES)
}

function periodText(range: DateRange | null): string | null {
  return range ? (range.from === range.to ? range.from : `${range.from} to ${range.to}`) : null
}

export default async function EngagementPage({ searchParams }: { searchParams: Promise<Params> }) {
  const admin = await requireAdmin()
  const params = await searchParams
  const tab = TABS.find((t) => t.key === params.tab)?.key ?? "subscribers"
  const { filters, rangeInvalid } = readFilters(params)
  const status = await getMonitorStatus()

  return (
    <AdminShell
      admin={admin}
      current="/admin/engagement"
      title="Engagement"
      description="Who is reading what: subscribers and Complimentary Review readers, one row per publication edition, from Papermark's confirmed sessions."
    >
      <div className="flex flex-wrap gap-1 border-b border-border mb-6">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`?${new URLSearchParams({ tab: t.key }).toString()}`}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <FilterBar tab={tab} filters={filters} />
      {rangeInvalid && (
        <p className="text-sm text-amber-800 mb-4">
          That date range is not valid (the end must be on or after the start), so all-time activity is shown.
        </p>
      )}
      <SyncLine status={status} />

      {tab === "subscribers" ? <SubscribersTab filters={filters} /> : <ReviewTab filters={filters} />}

      <DiagnosticsSection />

      <p className="text-xs text-muted-foreground mt-10 pt-6 border-t border-border">
        All times are shown in {DISPLAY_TIME_ZONE}. A selected period includes the whole of its end day.
      </p>
    </AdminShell>
  )
}

function FilterBar({ tab, filters }: { tab: string; filters: MonitorFilters }) {
  const input = "border border-border bg-background px-3 py-2 text-sm w-full"
  return (
    <form method="get" className="border border-border bg-card/30 p-4 mb-4">
      <input type="hidden" name="tab" value={tab} />
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs text-muted-foreground w-full sm:w-44">
          From
          <input type="date" name="from" defaultValue={filters.range?.from ?? ""} className={input} />
        </label>
        <label className="text-xs text-muted-foreground w-full sm:w-44">
          To (inclusive)
          <input type="date" name="to" defaultValue={filters.range?.to ?? ""} className={input} />
        </label>
        {tab === "subscribers" ? (
          <label className="text-xs text-muted-foreground w-full sm:w-44">
            Level
            <select name="level" defaultValue={filters.level} className={input}>
              <option value="">Any level</option>
              {PUBLIC_TIER_NAMES.map((t) => (
                <option key={t} value={t}>
                  {tierDisplayName(t)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-xs text-muted-foreground w-full sm:w-44">
          Series
          <select name="series" defaultValue={filters.series} className={input}>
            {SERIES.map((s) => (
              <option key={s || "all"} value={s}>
                {s || "Any series"}
              </option>
            ))}
          </select>
        </label>
        {tab === "subscribers" && (
          <label className="text-xs text-muted-foreground w-full sm:w-44">
            Status
            <select name="status" defaultValue={filters.status} className={input}>
              {STATUSES.map((s) => (
                <option key={s.value || "any"} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex gap-3 items-center">
          <button type="submit" className="bg-foreground text-background px-4 py-2 text-sm font-medium cursor-pointer">
            Apply
          </button>
          <Link href={`?tab=${tab}`} className="text-sm text-muted-foreground hover:text-foreground">
            Clear
          </Link>
        </div>
      </div>
    </form>
  )
}

function SyncLine({ status }: { status: Awaited<ReturnType<typeof getMonitorStatus>> }) {
  return (
    <div className="text-xs text-muted-foreground mb-6 space-y-1">
      <p>
        Last Papermark sync: {status.lastPollAt ? formatLagos(status.lastPollAt) : "never"}
        {" · "}Last webhook: {status.lastWebhookAt ? formatLagos(status.lastWebhookAt) : "none received"}
      </p>
      {status.pageProgressNote && <p className="text-amber-800">{status.pageProgressNote}</p>}
      {status.capability && (
        <p className="text-amber-800">
          Papermark analytics limitation{status.capability.at ? ` (${formatLagos(status.capability.at)})` : ""}:{" "}
          {status.capability.message}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

async function SubscribersTab({ filters }: { filters: MonitorFilters }) {
  const rows = await listSubscriberReaders(filters)
  const period = periodText(filters.range)
  const detailQuery = new URLSearchParams()
  if (filters.range) {
    detailQuery.set("from", filters.range.from)
    detailQuery.set("to", filters.range.to)
  }
  if (filters.series) detailQuery.set("series", filters.series)
  const qs = detailQuery.toString()

  return (
    <section>
      <p className="text-sm text-muted-foreground mb-3">
        {rows.length} subscriber{rows.length === 1 ? "" : "s"}, including those with no recorded activity. Last login
        and last portal visit are all-time; sessions and editions cover {period ?? "all time"}.
      </p>
      <ReaderSearch />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-border p-4">No subscriber matches these filters.</p>
      ) : (
        <div className="border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[52rem]">
            <thead className="bg-card/50 text-left">
              <tr className="border-b border-border">
                <th className="p-3 font-medium">Subscriber</th>
                <th className="p-3 font-medium">Level</th>
                <th className="p-3 font-medium">Access</th>
                <th className="p-3 font-medium">Last successful login</th>
                <th className="p-3 font-medium">Last portal visit</th>
                <th className="p-3 font-medium">Sessions{period ? " (period)" : ""}</th>
                <th className="p-3 font-medium">Editions{period ? " (period)" : ""}</th>
                <th className="p-3 font-medium">Last viewed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-black/5 align-top" data-reader-search={`${r.name} ${r.email}`.toLowerCase()}>
                  <td className="p-3">
                    <Link
                      href={`/admin/engagement/${r.id}${qs ? `?${qs}` : ""}`}
                      className="text-foreground hover:text-accent font-medium"
                    >
                      {r.name || r.email}
                    </Link>
                    {r.isAdministrator && <Badge>APRI admin</Badge>}
                    <span className="block text-xs text-muted-foreground">{r.email}</span>
                  </td>
                  <td className="p-3 text-xs">{r.level}</td>
                  <td className="p-3 text-xs">{r.status.label}</td>
                  <td className="p-3 text-xs tabular-nums">{r.lastLoginAt ? formatLagos(r.lastLoginAt) : NO_LOGIN}</td>
                  <td className="p-3 text-xs tabular-nums">
                    {r.lastPortalVisitAt ? formatLagos(r.lastPortalVisitAt) : NO_VISIT}
                  </td>
                  <td className="p-3 tabular-nums">{r.sessions}</td>
                  <td className="p-3 tabular-nums">{r.editions}</td>
                  <td className="p-3 text-xs tabular-nums">{r.lastViewedAt ? formatLagos(r.lastViewedAt) : "No views recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-3 max-w-3xl">
        A login is a successful sign-in from an emailed link. A portal visit is an authenticated page load of the
        library; a returning subscriber with a saved session can have a recent visit and an older login. Opening an
        email, clicking a link that fails, or reading a document is neither.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Complimentary Review
// ---------------------------------------------------------------------------

async function ReviewTab({ filters }: { filters: MonitorFilters }) {
  const rows = await listReviewReaders(filters)
  const period = periodText(filters.range)
  return (
    <section>
      <p className="text-sm text-muted-foreground mb-3">
        {rows.length} review reader{rows.length === 1 ? "" : "s"}: approved recipients, verified requesters and anyone
        Papermark recorded on a review link, including those with no recorded views. Review editions are opened directly
        through their Papermark link, which verifies the reader&rsquo;s email; there is no APRI login for them.
        Activity covers {period ?? "all time"}.
      </p>
      <ReaderSearch />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-border p-4">No review reader matches these filters.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const active = r.assignments.filter((a) => a.state === "active")
            const removed = r.assignments.filter((a) => a.state === "removed")
            return (
              <details key={r.key} className="border border-border" data-reader-search={`${r.name ?? ""} ${r.email}`.toLowerCase()}>
                <summary className="cursor-pointer list-none p-3 sm:p-4 hover:bg-black/5">
                  <div className="grid gap-x-6 gap-y-2 text-sm grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
                    <div className="col-span-2 lg:col-span-1">
                      <p className="font-medium text-foreground">
                        {r.name ?? r.email}
                        {r.isAdministrator && <Badge>APRI admin</Badge>}
                      </p>
                      {r.name && <p className="text-xs text-muted-foreground">{r.email}</p>}
                      <p className="text-xs text-muted-foreground">{r.verified ? "Email verified with APRI" : "Not a verified requester"}</p>
                    </div>
                    <Summary label="Approved editions" value={`${active.length}${removed.length ? ` (+${removed.length} removed)` : ""}`} />
                    <Summary label={`Sessions${period ? " (period)" : ""}`} value={String(r.sessions)} />
                    <Summary label="Editions opened" value={String(r.editions.length)} />
                    <Summary label="Last viewed" value={r.lastViewedAt ? formatLagos(r.lastViewedAt) : "No views recorded"} />
                  </div>
                </summary>
                <div className="border-t border-border p-3 sm:p-4 space-y-4">
                  <EditionActivityTable
                    editions={r.editions}
                    periodLabel={period}
                    emptyText={period ? "No recorded sessions in this period." : "No recorded sessions."}
                  />
                  {r.assignments.length > 0 && (
                    <div className="overflow-x-auto">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Assigned editions</p>
                      <table className="w-full text-xs min-w-[32rem]">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="py-1 pr-3 font-medium">Edition</th>
                            <th className="py-1 pr-3 font-medium">Approval</th>
                            <th className="py-1 pr-3 font-medium">Edition state</th>
                            <th className="py-1 font-medium">Opened</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {r.assignments.map((a, i) => {
                            const opened = r.editions.some((e) => e.editionKey === a.editionKey)
                            return (
                              <tr key={`${a.editionKey}-${i}`}>
                                <td className="py-1.5 pr-3">{a.title}</td>
                                <td className="py-1.5 pr-3">
                                  {a.state === "active"
                                    ? a.via === "shared_list"
                                      ? "Approved (shared list)"
                                      : `Approved${a.grantedAt ? ` ${formatLagos(a.grantedAt)}` : ""}`
                                    : `Removed${a.removedAt ? ` ${formatLagos(a.removedAt)}` : ""}`}
                                </td>
                                <td className="py-1.5 pr-3 capitalize">{a.editionState}</td>
                                <td className="py-1.5">{opened ? "Yes" : "No recorded views"}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </details>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-3 max-w-3xl">
        Review activity is kept separate from subscriber activity, even for someone who is both. A withdrawn edition or a
        removed approval keeps its recorded history.
      </p>
    </section>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="tabular-nums text-foreground">{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diagnostics (collapsed)
// ---------------------------------------------------------------------------

async function DiagnosticsSection() {
  const d = await getDiagnostics()
  const items: [string, string][] = [
    ["Webhook secret configured", d.webhookConfigured ? "Yes" : "No"],
    ["Last webhook received", d.lastWebhookAt ? formatLagos(d.lastWebhookAt) : "None"],
    ["Last poll", d.lastPollAt ? formatLagos(d.lastPollAt) : "Never"],
    ["Failed webhook events", String(d.failedWebhookEvents)],
    ["Unmatched views (kept, not guessed)", String(d.unmatchedViewsAllTime)],
    ["Unknown link ids", String(d.unknownLinkIds)],
    ["Sessions with recorded time", formatMetric(d.enrichmentCoveragePct, (n) => `${Math.round(n)}%`)],
    ["Sessions awaiting analytics", String(d.viewsAwaitingEnrichment)],
    ["Rows with missing attribution", String(d.repairableRows)],
  ]
  return (
    <details className="mt-10 border border-border">
      <summary className="cursor-pointer p-4 text-sm font-medium hover:bg-black/5">Diagnostics and maintenance</summary>
      <div className="border-t border-border p-4 space-y-6">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {items.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-border py-1">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        {d.lastPollSummary && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Last poll detail</p>
            <dl className="grid gap-x-8 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(d.lastPollSummary)
                .filter(([k]) => k !== "at")
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{k.replace(/([A-Z])/g, " $1")}</dt>
                    <dd className="tabular-nums">{String(v)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        )}
        <EngagementMaintenance />
        <WebsiteAnalyticsNote />
      </div>
    </details>
  )
}

function WebsiteAnalyticsNote() {
  return (
    <div className="border border-border bg-card/30 p-6">
      <h3 className="font-serif text-lg text-foreground mb-3">Whole-website traffic</h3>
      <p className="text-sm text-foreground/70 leading-relaxed mb-3 max-w-3xl">
        Website visitors, page views, top pages, referrers, countries and devices
        are in <span className="font-medium text-foreground">Vercel &rarr; Analytics</span>{" "}
        for this project. They are not shown here.
      </p>
      <p className="text-sm text-foreground/70 leading-relaxed max-w-3xl">
        Those figures are{" "}
        <span className="font-medium text-foreground">anonymous, sampled estimates</span>{" "}
        of public traffic. The numbers on this page are individually verified
        readers confirmed by Papermark. The two count different things and must
        never be combined or compared as if they were the same measure.
      </p>
      <p className="text-xs text-muted-foreground mt-3 leading-relaxed max-w-3xl">
        Admin, API, portal and authentication routes are excluded from Vercel
        Analytics, and no email address, subscriber id, token or Papermark URL is
        ever sent to it.
      </p>
    </div>
  )
}
