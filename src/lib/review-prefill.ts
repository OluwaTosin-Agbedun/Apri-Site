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
    publicationType: 'Monthly Strategic Assessment',
    description:
      'A monthly monitoring product covering Nigeria’s democratic, electoral and political landscape. Although public-facing, it should appear here as part of the broader monthly intelligence bouquet available to APRI readers.',
    frequency: 'Monthly',
    audience: 'APRI subscribers and prospective readers',
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
