export const PORTAL_SERIES = ["PLM", "MIN", "AIU"] as const

export type PortalSeries = typeof PORTAL_SERIES[number]

export type DatedEdition = {
  id: string
  editionDate: string | null
}

/**
 * Publication order is editorial, never operational. Missing dates sit last;
 * equal dates use the stable database id so a later sync cannot reorder them.
 */
export function compareEditionsNewestFirst(
  a: DatedEdition,
  b: DatedEdition,
): number {
  if (a.editionDate && b.editionDate) {
    const byDate = b.editionDate.localeCompare(a.editionDate)
    if (byDate !== 0) return byDate
  } else if (a.editionDate) {
    return -1
  } else if (b.editionDate) {
    return 1
  }

  return a.id.localeCompare(b.id)
}

export function isPortalSeries(value: string | null): value is PortalSeries {
  return PORTAL_SERIES.includes(value as PortalSeries)
}

export function newestEdition<T extends DatedEdition>(
  items: readonly T[],
): T | null {
  return [...items].sort(compareEditionsNewestFirst)[0] ?? null
}

export function editionsBySeries<T extends DatedEdition & {
  series: string | null
},>(items: readonly T[]): Record<PortalSeries, T[]> {
  const grouped: Record<PortalSeries, T[]> = { PLM: [], MIN: [], AIU: [] }
  for (const item of items) {
    if (isPortalSeries(item.series)) grouped[item.series].push(item)
  }
  for (const series of PORTAL_SERIES)
    grouped[series].sort(compareEditionsNewestFirst)
  return grouped
}
