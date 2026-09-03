type PubRow = {
  title: string
  series: string
  product_line: string
  frequency: string
  summary: string
  description: string
}

type ReviewCard = {
  publicationType: string
  description: string
  frequency: string
  audience: string
  /**
   * The Chancellor-approved publication title, where one has been set.
   *
   * Held here so the admin can offer it, but never written automatically: the
   * title lives on the publication record (documents.title), not on the review
   * card, and overwriting a publication's title as a side effect of a card
   * prefill would change what every other surface calls it.
   */
  approvedTitle?: string
}

/** The approved title for a fixed slot, if one has been set. */
export function approvedTitleForSlot(slotKey: string): string | null {
  return APPROVED_CARDS[slotKey]?.approvedTitle ?? null
}

const APPROVED_CARDS: Record<string, ReviewCard> = {
  MIN: {
    publicationType: 'Monthly Intelligence Note',
    description:
      'A monthly assessment of Nigeria’s political, regulatory and political-economy operating environment, highlighting significant developments, implications and issues organisations should monitor when making strategic and operating decisions.',
    frequency: 'Monthly',
    audience: 'APRI subscribers and prospective readers',
  },
  AIU: {
    publicationType: 'Periodic Focused Briefing',
    description:
      'A focused intelligence update issued when a significant political, regulatory, electoral, institutional or operating-risk development occurs between regular monthly publications.',
    frequency: 'As developments require',
    audience: 'APRI subscribers and prospective readers',
  },
  PLM: {
    publicationType: 'ATHENA ELECTION OBSERVATORY',
    description:
      'A monthly monitoring publication from the Athena Election Observatory covering Nigeria’s democratic, electoral and political landscape. The Political Landscape Monitor is made available to APRI subscribers as part of their subscription.',
    frequency: 'Monthly',
    audience: 'APRI subscribers and prospective readers',
    approvedTitle: 'Athena Political Landscape Monitor | Issue 01 | July 2026',
  },
}

const SERIES_TEMPLATES: Record<string, ReviewCard> = {
  QIB: {
    publicationType: 'Quarterly Intelligence Brief',
    description: 'A strategic quarterly review of the political, economic and security environment.',
    frequency: 'Quarterly',
    audience: 'APRI subscribers and prospective readers',
  },
  AEO: {
    publicationType: 'Election & Democratic Governance Monitor',
    description: 'Analysis of electoral and democratic governance developments and their implications.',
    frequency: 'Event-driven',
    audience: 'APRI subscribers and prospective readers',
  },
}

export function prefillReviewCard(pub: PubRow): ReviewCard {
  const approved = APPROVED_CARDS[pub.series]
  if (approved) return approved

  const template = SERIES_TEMPLATES[pub.series]
  if (template) return template

  return {
    publicationType: pub.product_line || 'Publication',
    description: pub.description || pub.summary || '',
    frequency: pub.frequency || '',
    audience: 'APRI subscribers and prospective readers',
  }
}
