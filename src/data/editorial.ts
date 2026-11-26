/** Portable public editorial content. Add only material cleared for publication. */
export const INSIGHT_STREAMS = [
  { id: "political-landscape-monitor", title: "Political Landscape Monitor", attribution: "Athena Election Observatory", description: "Monthly assessments of Nigeria's political, democratic and electoral environment." },
  { id: "election-matters", title: "Election Matters", attribution: "Athena Election Observatory", description: "Electoral developments, institutional assessments and evidence-based analysis." },
  { id: "africa-watch", title: "Africa Watch", attribution: "Africa and Comparative Perspectives", description: "Country assessments across Africa and relevant international comparators, including Brazil, São Tomé and Príncipe, and Morocco." },
  { id: "ositainsight", title: "OsitaInsight", attribution: "ClearPath Media", description: "Selected video perspectives on policy, regulation, institutions and Nigeria's political economy." },
] as const

export type EditorialVisual = { src: string; alt: string; credit: string }
export type OpenInsight = {
  id: string
  stream: (typeof INSIGHT_STREAMS)[number]["id"]
  title: string
  date: string
  description: string
  attribution: string
  href: string
  visual: EditorialVisual
  approved: boolean
}
export type ClientEngagement = {
  id: string
  title: string
  description: string
  briefingType: "Board Political & Regulatory Risk Briefing" | "Strategy & Retreat Briefing"
  approved: boolean
}

// Awaiting the team's approved public links, visuals and engagement descriptions.
// Never substitute a protected original, an email-gated review edition or a draft.
export const OPEN_INSIGHTS: readonly OpenInsight[] = []
export const CLIENT_ENGAGEMENTS: readonly ClientEngagement[] = []
export const PUBLICATION_VISUALS: Readonly<Record<string, EditorialVisual>> = {}
