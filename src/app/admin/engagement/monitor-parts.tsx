import { formatLagos } from "@/lib/engagement-metrics"
import {
  durationLabel,
  progressLabel,
  PROGRESS_UNAVAILABLE,
  type EditionActivity,
} from "@/lib/reader-monitoring-rules"

/**
 * One reader's publication activity: one row per exact edition and version,
 * compact by default, with each row's sessions and pages expandable beneath
 * it. Server-rendered; the expanding is native <details>, so no client code.
 */
export function EditionActivityTable({
  editions,
  emptyText,
  periodLabel,
}: {
  editions: EditionActivity[]
  emptyText: string
  /** Set when the figures cover a selected period rather than all time. */
  periodLabel?: string | null
}) {
  if (editions.length === 0) {
    return <p className="text-sm text-muted-foreground py-3">{emptyText}</p>
  }
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">
        {periodLabel
          ? `Viewing progress within ${periodLabel} only.`
          : "Viewing progress is cumulative: distinct pages with recorded viewing time across every session."}{" "}
        Pages viewed is evidence of pages on screen, not of reading or comprehension.
      </p>
      <div className="space-y-2">
        {editions.map((e) => (
          <details key={e.key} className="border border-border bg-card/30 group">
            <summary className="cursor-pointer list-none p-3 sm:p-4 hover:bg-black/5">
              <div className="grid gap-x-6 gap-y-2 text-sm grid-cols-2 sm:grid-cols-3 xl:grid-cols-[minmax(0,2fr)_repeat(6,minmax(0,1fr))]">
                <div className="col-span-2 sm:col-span-3 xl:col-span-1">
                  <p className="font-medium text-foreground">{e.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[e.editionLabel, e.versionNumber !== null ? `Version ${e.versionNumber}` : e.otherVersions ? "Version not yet known" : ""]
                      .filter(Boolean)
                      .join(" · ") || " "}
                  </p>
                </div>
                <Cell label="First viewed" value={formatLagos(e.firstViewedAt)} />
                <Cell label="Latest viewed" value={formatLagos(e.latestViewedAt)} />
                <Cell label="Sessions" value={String(e.sessions)} />
                <Cell
                  label="Pages viewed"
                  value={progressLabel(e.coverage)}
                  muted={!e.coverage.available}
                />
                <Cell
                  label="Viewing time"
                  value={`${durationLabel(e.viewingSeconds)}${e.viewingPartial ? " (some sessions unavailable)" : ""}`}
                  muted={e.viewingSeconds === null}
                />
                <Cell
                  label="Downloaded"
                  value={
                    e.downloads.downloaded
                      ? `Yes${e.downloads.count ? ` · ${e.downloads.count}` : ""}${e.downloads.latestAt ? ` · ${formatLagos(e.downloads.latestAt)}` : ""}`
                      : "No"
                  }
                />
              </div>
              {e.coverage.available && e.coverage.furthestPage !== null && (
                <p className="text-xs text-muted-foreground mt-2">
                  Furthest page reached: {e.coverage.furthestPage} of {e.coverage.totalPages}
                </p>
              )}
              <p className="text-xs text-accent mt-2 group-open:hidden">Show sessions and pages</p>
            </summary>
            <div className="border-t border-border p-3 sm:p-4 overflow-x-auto">
              <table className="w-full text-xs min-w-[36rem]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">Session</th>
                    <th className="py-1 pr-3 font-medium">Time</th>
                    <th className="py-1 pr-3 font-medium">Pages viewed</th>
                    <th className="py-1 pr-3 font-medium">Pages</th>
                    <th className="py-1 pr-3 font-medium">Furthest</th>
                    <th className="py-1 pr-3 font-medium">Downloaded</th>
                    <th className="py-1 font-medium">Opened through</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {e.sessionDetails.map((s, i) => (
                    <tr key={`${s.viewedAt}-${i}`}>
                      <td className="py-1.5 pr-3 tabular-nums">{formatLagos(s.viewedAt)}</td>
                      <td className="py-1.5 pr-3">{durationLabel(s.durationSeconds)}</td>
                      <td className="py-1.5 pr-3">
                        {s.pagesViewed === null || s.totalPages === null
                          ? PROGRESS_UNAVAILABLE
                          : `${s.pagesViewed} of ${s.totalPages}`}
                      </td>
                      <td className="py-1.5 pr-3">{s.pageList || "—"}</td>
                      <td className="py-1.5 pr-3">{s.furthestPage ?? "—"}</td>
                      <td className="py-1.5 pr-3">{s.downloaded ? "Yes" : "No"}</td>
                      <td className="py-1.5">{s.accessRoute}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

function Cell({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${muted ? "text-muted-foreground" : "text-foreground"}`}>{value}</p>
    </div>
  )
}

/** A small label beside a name, e.g. for an APRI administrator's own record. */
export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 inline-block text-[0.65rem] uppercase tracking-wider border border-border px-1.5 py-0.5 text-muted-foreground align-middle">
      {children}
    </span>
  )
}
