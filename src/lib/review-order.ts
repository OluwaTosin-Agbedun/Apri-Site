/**
 * Moving one review edition up or down within its series, as a list of ids.
 * Dependency-free so it is tested directly (tests/review-order.test.mjs).
 */
export function moveInOrder(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const order = [...ids]
  const at = order.indexOf(id)
  if (at < 0) return order
  const to = direction === "up" ? at - 1 : at + 1
  if (to < 0 || to >= order.length) return order
  ;[order[at], order[to]] = [order[to]!, order[at]!]
  return order
}

/** SQL order for review editions within a series: an owner's order first, then the default. */
export const REVIEW_DISPLAY_ORDER = `(to_jsonb(e) ->> 'display_position')::int asc nulls last`
