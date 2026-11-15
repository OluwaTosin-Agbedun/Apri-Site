import {
  SUMMARY_TEXT_FIELDS,
  TAG_KINDS,
  TAG_KIND_LABELS,
  coveredPeriodLabel,
  formatDay,
  hasReaderFacts,
  readingTimeLabel,
  type ReaderPublicationDetails,
  type SummaryText,
} from "@/lib/publication-metadata"

/**
 * What an editor stated about a permitted edition, on its subscriber card:
 * reading time, covered period, information cut-off, author/editor and tags.
 * Each line appears only when that value was entered: nothing is computed,
 * estimated or filled in, and a card with none of them is unchanged.
 *
 * It receives only the reader details the library loaders build for editions
 * the access policy already lists (src/lib/publication-metadata-dal.ts).
 */
export function PublicationFacts({ details }: { details: ReaderPublicationDetails | null | undefined }) {
  if (!details || !hasReaderFacts(details)) return null
  const facts: [string, string][] = []
  if (details.readingMinutes) facts.push(["Reading time", readingTimeLabel(details.readingMinutes)])
  if (details.coveredPeriod) {
    const period = coveredPeriodLabel(details.coveredPeriod.start, details.coveredPeriod.end)
    if (period) facts.push(["Covers", period])
  }
  if (details.informationCutoff) {
    const cutoff = formatDay(details.informationCutoff)
    if (cutoff) facts.push(["Information to", cutoff])
  }
  if (details.authorEditor) facts.push(["Author/editor", details.authorEditor])
  for (const kind of TAG_KINDS) {
    if (details.tags[kind].length) facts.push([TAG_KIND_LABELS[kind].plural, details.tags[kind].join(", ")])
  }
  if (!facts.length) return null
  return (
    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
      {facts.map(([label, value]) => (
        <div key={label} className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 font-medium text-foreground/70">{label}:</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * An edition's owner-approved protected summary, as a disclosure on its card.
 * It receives only the approved copy (the loaders return nothing else), so a
 * draft, edited text or approval details can never render here. Native
 * <details>: works without JavaScript and is announced as expandable.
 */
export function ProtectedSummary({
  summary,
  open = false,
  attached = false,
}: {
  summary: SummaryText | null | undefined
  /** Shown expanded (the Latest card). */
  open?: boolean
  /** A panel joined to the card above it (legacy rows, which are links themselves). */
  attached?: boolean
}) {
  if (!summary) return null
  const rows = SUMMARY_TEXT_FIELDS.filter((field) => summary[field.key])
  const source = formatDay(summary.sourceDate)
  return (
    <details
      open={open}
      className={
        attached
          ? "group border border-t-0 border-border bg-card/30 px-5 sm:px-6 pb-5 pt-3"
          : "group mt-4 border-t border-border pt-3"
      }
    >
      <summary className="inline-flex min-h-11 cursor-pointer select-none items-center gap-2 text-xs font-medium uppercase tracking-wider text-accent hover:text-accent-hover transition-colors">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
          &rsaquo;
        </span>
        Summary
      </summary>
      <dl className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-x-8">
        {rows.map((field) => (
          <div key={field.key} className="min-w-0">
            <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{field.label}</dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-foreground/75 whitespace-pre-line break-words">{summary[field.key]}</dd>
          </div>
        ))}
      </dl>
      {source && <p className="mt-4 text-xs text-muted-foreground">Source date: {source}</p>}
    </details>
  )
}
