import Link from "next/link"
import { requireAdmin } from "@/lib/dal"
import AdminShell from "@/components/AdminShell"
import { tierDisplayName } from "@/lib/entitlements"
import {
  getOverviewMetrics,
  getPublicationRows,
  getReaderRows,
  getDiagnostics,
} from "@/lib/engagement-analytics"
import {
  resolveWindow,
  formatLagos,
  formatMetric,
  NOT_APPLICABLE_LABEL,
  UNAVAILABLE_LABEL,
  WINDOW_PRESETS,
  DISPLAY_TIME_ZONE,
} from "@/lib/engagement-metrics"
import { EngagementMaintenance, ReaderTypeFilter } from "./engagement-client"

export const metadata = { title: "Engagement · APRI" }
export const dynamic = "force-dynamic"

type Params = {
  tab?: string
  window?: string
  from?: string
  to?: string
  reader?: string
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "publications", label: "Publications" },
  { key: "readers", label: "Readers" },
  { key: "diagnostics", label: "Diagnostics" },
] as const

export default async function EngagementPage({
  searchParams,
}: {
  searchParams: Promise<Params>
}) {
  const admin = await requireAdmin()
  const params = await searchParams

  const tab = TABS.find((t) => t.key === params.tab)?.key ?? "overview"

  // One window object, passed to every query on the page. This is what stops
  // the old dashboard's fault of mixing lifetime and 30-day figures in one row.
  const window = resolveWindow({
    preset: params.window ?? "30d",
    from: params.from,
    to: params.to,
  })

  return (
    <AdminShell
      admin={admin}
      current="/admin/engagement"
      title="Engagement"
      description="Confirmed document engagement from Papermark, and publication access clicks recorded by APRI. The two are measured separately and are never combined."
    >
      <TabBar tab={tab} params={params} />

      {tab !== "diagnostics" && <WindowBar window={window} tab={tab} params={params} />}

      {tab === "overview" && <OverviewTab window={window} />}
      {tab === "publications" && <PublicationsTab window={window} />}
      {tab === "readers" && <ReadersTab window={window} readerFilter={params.reader ?? ""} params={params} />}
      {tab === "diagnostics" && <DiagnosticsTab />}

      <p className="text-xs text-muted-foreground mt-10 pt-6 border-t border-border">
        All times shown in {DISPLAY_TIME_ZONE}. Timestamps are stored in UTC.
      </p>
    </AdminShell>
  )
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function TabBar({ tab, params }: { tab: string; params: Params }) {
  const qs = (key: string) => {
    const sp = new URLSearchParams()
    sp.set("tab", key)
    if (params.window) sp.set("window", params.window)
    if (params.from) sp.set("from", params.from)
    if (params.to) sp.set("to", params.to)
    return `?${sp.toString()}`
  }

  return (
    <div className="flex flex-wrap gap-1 border-b border-border mb-8">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={qs(t.key)}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === t.key
              ? "border-accent text-accent"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}

function WindowBar({
  window,
  tab,
  params,
}: {
  window: ReturnType<typeof resolveWindow>
  tab: string
  params: Params
}) {
  const link = (preset: string) => {
    const sp = new URLSearchParams()
    sp.set("tab", tab)
    sp.set("window", preset)
    return `?${sp.toString()}`
  }

  return (
    <div className="border border-border bg-card/30 p-4 mb-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Period
        </span>
        {WINDOW_PRESETS.map((p) => (
          <Link
            key={p.value}
            href={link(p.value)}
            className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
              window.preset === p.value
                ? "border-accent text-accent bg-accent/5"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </Link>
        ))}

        <form method="get" className="flex items-end gap-2 ml-auto flex-wrap">
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="window" value="custom" />
          <div>
            <label className="block text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-1">
              From
            </label>
            <input
              type="date"
              name="from"
              defaultValue={params.from ?? ""}
              className="border border-border bg-background px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="block text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-1">
              To
            </label>
            <input
              type="date"
              name="to"
              defaultValue={params.to ?? ""}
              className="border border-border bg-background px-2 py-1 text-xs"
            />
          </div>
          <button
            type="submit"
            className="border border-border px-3 py-1.5 text-xs hover:bg-black/5 transition-colors cursor-pointer"
          >
            Apply
          </button>
        </form>
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        Showing {formatLagos(window.fromIso)} to {formatLagos(window.toIso)}
        {window.preset !== "custom" && <> &middot; last {window.days} days</>}
      </p>
    </div>
  )
}

function Metric({
  label,
  value,
  note,
  tone = "default",
}: {
  label: string
  value: string | number
  note?: string
  tone?: "default" | "warn" | "muted"
}) {
  const colour =
    tone === "warn"
      ? "text-amber-700"
      : tone === "muted"
        ? "text-foreground/60"
        : "text-foreground"

  return (
    <div className="border border-border p-5 bg-card/30">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
        {label}
      </p>
      <p className={`text-3xl font-serif ${colour}`}>{value}</p>
      {note && <p className="text-[0.7rem] text-muted-foreground mt-2 leading-snug">{note}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

async function OverviewTab({ window }: { window: ReturnType<typeof resolveWindow> }) {
  const m = await getOverviewMetrics(window)

  return (
    <>
      <p className="text-xs text-muted-foreground mb-6">
        Data since:{" "}
        <span className="font-medium text-foreground">
          {m.dataSince ? formatLagos(m.dataSince) : "click tracking has not recorded an event yet"}
        </span>
        . Papermark view and download history predates click tracking; clicks are
        only counted from deployment onward and are never backfilled.
      </p>

      <h3 className="font-serif text-lg text-foreground mb-4">Confirmed by Papermark</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Metric
          label="Unique paid readers"
          value={m.uniquePaidReaders}
          note="Distinct subscribers with a confirmed view in this period."
        />
        <Metric
          label="Complimentary Review readers"
          value={m.uniqueProspectReaders}
          note="Distinct verified prospect addresses. Not subscribers."
        />
        <Metric
          label="View sessions"
          value={m.viewSessions}
          note="Distinct Papermark view ids. Not a row count."
        />
        <Metric
          label="Download events"
          value={m.downloadEvents}
          note="Every confirmed download, including repeats by one reader."
        />
        <Metric
          label="Unique downloaders"
          value={m.uniqueDownloaders}
          note="Distinct subscriber or verified prospect address."
        />
        <Metric
          label="Unmatched views"
          value={m.unmatchedViews}
          note="Kept, never guessed. See Diagnostics."
          tone={m.unmatchedViews > 0 ? "warn" : "default"}
        />
      </div>

      <h3 className="font-serif text-lg text-foreground mb-2">Recorded by APRI</h3>
      <p className="text-xs text-muted-foreground mb-4 max-w-3xl">
        A click means a reader pressed a publication button on this site. It does
        not mean the document was opened &mdash; only Papermark can confirm that.
        These figures are deliberately kept apart from the view sessions above and
        must not be added to them.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Metric label="Publication access clicks" value={m.accessClicks} note="Unique click events." />
        <Metric label="Unique clickers" value={m.uniqueClickers} note="Distinct anonymous visitors." />
      </div>

      <h3 className="font-serif text-lg text-foreground mb-4">Subscriptions</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Metric
          label="Active subscribers"
          value={m.activeSubscribers}
          note="Current state, not a figure for this period."
          tone="muted"
        />
        <Metric
          label="Not opened recent editions"
          value={m.dormantSubscribers}
          note="Active subscribers with no confirmed view in this period."
          tone={m.dormantSubscribers > 0 ? "warn" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <Metric
          label="Last webhook received"
          value={m.lastWebhookAt ? formatLagos(m.lastWebhookAt) : UNAVAILABLE_LABEL}
        />
        <Metric
          label="Last successful poll"
          value={m.lastPollAt ? formatLagos(m.lastPollAt) : UNAVAILABLE_LABEL}
        />
      </div>

      <WebsiteAnalyticsNote />
    </>
  )
}

/**
 * The Vercel note.
 *
 * Placed here rather than in Diagnostics because the risk it guards against is
 * a reader of this page adding an anonymous visitor estimate to a verified
 * reader count and believing the total.
 */
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

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

async function PublicationsTab({ window }: { window: ReturnType<typeof resolveWindow> }) {
  const rows = await getPublicationRows(window)

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No publication activity in this period.
      </p>
    )
  }

  const audienceLabel = (a: string) =>
    a === "complimentary_review" ? "Complimentary Review" : a === "briefing" ? "Briefing" : "Paid"

  return (
    <div className="border border-border bg-card/30 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-black/5 text-foreground/70">
          <tr>
            <th className="font-medium p-3">Publication</th>
            <th className="font-medium p-3">Type</th>
            <th className="font-medium p-3">Audience</th>
            <th className="font-medium p-3">Edition</th>
            <th className="font-medium p-3 text-right">Eligible</th>
            <th className="font-medium p-3 text-right">Clicks</th>
            <th className="font-medium p-3 text-right">Readers</th>
            <th className="font-medium p-3 text-right">Sessions</th>
            <th className="font-medium p-3 text-right">Repeat</th>
            <th className="font-medium p-3 text-right">Downloads</th>
            <th className="font-medium p-3 text-right">Downloaders</th>
            <th className="font-medium p-3 text-right">Avg time</th>
            <th className="font-medium p-3 text-right">Completion</th>
            <th className="font-medium p-3">Last activity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={`${r.publicationId ?? r.slotKey ?? i}`} className="hover:bg-black/5 transition-colors">
              <td className="p-3 text-foreground max-w-xs">
                <span className="block truncate" title={r.title}>{r.title}</span>
                {r.slotKey && (
                  <span className="text-[0.65rem] text-accent">Slot {r.slotKey}</span>
                )}
              </td>
              <td className="p-3 text-foreground/70 text-xs">{r.publicationType || r.series || "—"}</td>
              <td className="p-3 text-xs">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[0.65rem] font-medium ${
                    r.audience === "complimentary_review"
                      ? "bg-blue-50 text-blue-700"
                      : r.audience === "briefing"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-accent/10 text-accent"
                  }`}
                >
                  {audienceLabel(r.audience)}
                </span>
              </td>
              <td className="p-3 text-foreground/70 text-xs">
                {r.editionDate ? formatLagos(r.editionDate) : "—"}
              </td>
              <td className="p-3 text-right text-xs text-foreground/70">
                {/* A prospect publication has no eligibility, and says so
                    rather than reporting zero eligible readers. */}
                {r.eligibleSubscribers === null ? (
                  <span className="text-muted-foreground">{NOT_APPLICABLE_LABEL}</span>
                ) : (
                  r.eligibleSubscribers
                )}
              </td>
              <td className="p-3 text-right">{r.accessClicks}</td>
              <td className="p-3 text-right font-medium">{r.uniqueReaders}</td>
              <td className="p-3 text-right">{r.viewSessions}</td>
              <td className="p-3 text-right text-foreground/70">{r.repeatSessions}</td>
              <td className="p-3 text-right">{r.downloadEvents}</td>
              <td className="p-3 text-right text-foreground/70">{r.uniqueDownloaders}</td>
              <td className="p-3 text-right text-xs">
                {formatMetric(r.averageEngagedTime, (n) => `${Math.round(n)}s`)}
              </td>
              <td className="p-3 text-right text-xs">
                {formatMetric(r.completionPct, (n) => `${Math.round(n)}%`)}
              </td>
              <td className="p-3 text-foreground/70 text-xs">
                {r.lastActivity ? formatLagos(r.lastActivity) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

async function ReadersTab({
  window,
  readerFilter,
  params,
}: {
  window: ReturnType<typeof resolveWindow>
  readerFilter: string
  params: Params
}) {
  const all = await getReaderRows(window)
  const rows = readerFilter ? all.filter((r) => r.readerType === readerFilter) : all

  const typeLabel = (t: string) =>
    t === "complimentary_review"
      ? "Complimentary Review"
      : t === "subscriber"
        ? "Subscriber"
        : t === "briefing"
          ? "Briefing"
          : "Unknown"

  return (
    <>
      <ReaderTypeFilter current={readerFilter} params={params} counts={{
        all: all.length,
        subscriber: all.filter((r) => r.readerType === "subscriber").length,
        complimentary_review: all.filter((r) => r.readerType === "complimentary_review").length,
        briefing: all.filter((r) => r.readerType === "briefing").length,
        unknown: all.filter((r) => r.readerType === "unknown").length,
      }} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No readers in this period.</p>
      ) : (
        <div className="border border-border bg-card/30 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-3">Name</th>
                <th className="font-medium p-3">Verified email</th>
                <th className="font-medium p-3">Reader type</th>
                <th className="font-medium p-3">Level</th>
                <th className="font-medium p-3 text-right">Documents</th>
                <th className="font-medium p-3 text-right">Sessions</th>
                <th className="font-medium p-3 text-right">Downloads</th>
                <th className="font-medium p-3 text-right">Read</th>
                <th className="font-medium p-3">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr
                  key={r.readerKey}
                  className={`hover:bg-black/5 transition-colors ${
                    r.readerType === "complimentary_review" ? "bg-blue-50/30" : ""
                  }`}
                >
                  <td className="p-3 text-foreground">
                    {/* A Complimentary Review reader holds no subscriber
                        record, so no name is invented for them -- and there is
                        no detail page to link to either. */}
                    {r.name ? (
                      r.subscriberId ? (
                        <Link
                          href={`/admin/engagement/${r.subscriberId}`}
                          className="text-accent hover:text-accent-hover transition-colors"
                        >
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )
                    ) : (
                      <span className="text-muted-foreground text-xs">No subscriber record</span>
                    )}
                  </td>
                  <td className="p-3 text-foreground/70 text-xs">{r.email ?? "—"}</td>
                  <td className="p-3 text-xs">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[0.65rem] font-medium ${
                        r.readerType === "complimentary_review"
                          ? "bg-blue-100 text-blue-800"
                          : r.readerType === "subscriber"
                            ? "bg-accent/10 text-accent"
                            : r.readerType === "briefing"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-black/5 text-muted-foreground"
                      }`}
                    >
                      {typeLabel(r.readerType)}
                    </span>
                  </td>
                  <td className="p-3 text-foreground/70 text-xs">
                    {r.subscriptionLevel ? tierDisplayName(r.subscriptionLevel) : NOT_APPLICABLE_LABEL}
                  </td>
                  <td className="p-3 text-right">{r.documentsOpened}</td>
                  <td className="p-3 text-right">{r.viewSessions}</td>
                  <td className="p-3 text-right">{r.downloadEvents}</td>
                  <td className="p-3 text-right text-xs">
                    {formatMetric(r.averageCompletion, (n) =>
                      n >= 90 ? "Read" : `Partial ${Math.round(n)}%`,
                    )}
                  </td>
                  <td className="p-3 text-foreground/70 text-xs">
                    {r.lastActivity ? formatLagos(r.lastActivity) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

async function DiagnosticsTab() {
  const d = await getDiagnostics()

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <Metric
          label="Webhook configured"
          value={d.webhookConfigured ? "Yes" : "No"}
          note={
            d.webhookConfigured
              ? "A signing secret is set. Its value is never displayed or logged."
              : "No signing secret is set, so the endpoint refuses every delivery. Set it in the Vercel environment settings."
          }
          tone={d.webhookConfigured ? "default" : "warn"}
        />
        <Metric
          label="Last webhook received"
          value={d.lastWebhookAt ? formatLagos(d.lastWebhookAt) : UNAVAILABLE_LABEL}
        />
        <Metric
          label="Last successful poll"
          value={d.lastPollAt ? formatLagos(d.lastPollAt) : UNAVAILABLE_LABEL}
        />
        <Metric
          label="Failed webhook events"
          value={d.failedWebhookEvents}
          note="Recorded as failed, not processed, so Papermark retries them."
          tone={d.failedWebhookEvents > 0 ? "warn" : "default"}
        />
        <Metric
          label="Unmatched views (all time)"
          value={d.unmatchedViewsAllTime}
          note="Kept rather than guessed at."
          tone={d.unmatchedViewsAllTime > 0 ? "warn" : "default"}
        />
        <Metric
          label="Unknown link ids"
          value={d.unknownLinkIds}
          note="Views on a link APRI has no record of."
          tone={d.unknownLinkIds > 0 ? "warn" : "default"}
        />
        <Metric
          label="Duration / completion coverage"
          value={formatMetric(d.enrichmentCoveragePct, (n) => `${Math.round(n)}%`)}
          note="Share of views with duration data from Papermark."
        />
        <Metric
          label="Awaiting enrichment"
          value={d.viewsAwaitingEnrichment}
          note="Picked up in bounded batches by each poll; resumes across runs."
        />
        <Metric
          label="Rows with missing attribution"
          value={d.repairableRows}
          note="Candidates for the repair below."
          tone={d.repairableRows > 0 ? "warn" : "default"}
        />
      </div>

      {d.lastPollSummary && (
        <div className="border border-border bg-card/30 p-5 mb-8">
          <h4 className="text-sm font-medium text-foreground mb-3">Last poll detail</h4>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            {Object.entries(d.lastPollSummary)
              .filter(([k]) => k !== "at")
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground uppercase tracking-wider text-[0.65rem]">
                    {k.replace(/([A-Z])/g, " $1")}
                  </dt>
                  <dd className="text-foreground font-medium mt-1">{String(v)}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}

      <EngagementMaintenance />
    </>
  )
}
