/** The authoritative commercial catalogue. Stored names remain stable for compatibility. */
export const SUBSCRIPTION_CATALOGUE = [
  { name: "Individual Access", storedName: "Individual Access", aliases: [], level: "L1", price: "₦2 million annually", seats: 1, agreement: "APRI Individual Subscription", plan: "Individual" },
  { name: "Professional Access", storedName: "Professional Team Access", aliases: ["Professional Access"], level: "L1", price: "₦5 million annually", seats: 3, agreement: "APRI Professional Subscription", plan: "Professional" },
  { name: "Political Monitor", storedName: "Political Monitor", aliases: [], level: "L2", price: null, seats: 1, agreement: null, plan: null },
  { name: "Executive Intelligence", storedName: "Executive Intelligence", aliases: [], level: "L3", price: null, seats: 1, agreement: null, plan: null },
  { name: "Board Intelligence", storedName: "Board Briefing", aliases: ["Board Intelligence"], level: "L4", price: null, seats: 1, agreement: null, plan: null },
] as const

export type CatalogueOffering = (typeof SUBSCRIPTION_CATALOGUE)[number]

export function subscriptionOffering(value: string): CatalogueOffering | null {
  return SUBSCRIPTION_CATALOGUE.find((item) =>
    item.name === value || item.storedName === value || (item.aliases as readonly string[]).includes(value),
  ) ?? null
}

export function subscriptionDisplayName(value: string): string {
  return subscriptionOffering(value)?.name ?? value
}
