import type { BriefingType } from '../context/AppContext';

export type ServiceItem = {
  id: string;
  /** Service name, e.g. "Board Political & Regulatory Risk Briefing". */
  title: string;
  /** Product line descriptor shown above the title. */
  kind: string;
  /** Who the briefing is designed for. */
  designedFor: string;
  /** What the briefing provides. */
  body: string;
  /** Heading for the supporting list, which differs per service. */
  listLabel: string;
  listItems: string[];
  format: string;
  delivery: string;
  ctaLabel: string;
  /** Preselects the briefing type on the request form. */
  briefingType: BriefingType;
};

/** The five services, in the page order specified by the brief. */
export const SERVICES: ServiceItem[] = [
  {
    id: 'board',
    title: 'Board Political & Regulatory Risk Briefing',
    kind: 'Board-level briefing / bespoke paper',
    designedFor:
      'Designed for boards, board risk committees, investment committees, group CEOs, major shareholders and parent-company leadership.',
    body:
      "This briefing provides a board-level assessment of Nigeria’s political, regulatory and political economy outlook, with emphasis on enterprise risk, capital allocation, regulatory exposure, 2027 scenario planning, institutional behaviour and sector-specific vulnerabilities.",
    listLabel: 'Typical use cases',
    listItems: [
      'Board retreat',
      'Board risk committee session',
      'Annual strategy review',
      'Investment committee review',
      'Parent-company country risk briefing'
    ],
    format: 'Bespoke paper and private presentation',
    delivery: 'Virtual or in person',
    ctaLabel: 'Request a Board Briefing',
    briefingType: 'Board Political & Regulatory Risk Briefing'
  },
  {
    id: 'executive',
    title: 'Executive Political & Regulatory Briefing',
    kind: 'Senior management briefing',
    designedFor:
      'Designed for CEOs, executive committees, country directors, strategy teams, risk officers, government relations teams and regulated businesses.',
    body:
      'This briefing translates political and regulatory developments into management-level implications for operating plans, stakeholder strategy, compliance exposure, market positioning and 30–180 day decision-making.',
    listLabel: 'Typical use cases',
    listItems: [
      'Executive committee briefing',
      'Country leadership meeting',
      'Strategy review',
      'Regulatory-risk session',
      'Government relations planning session'
    ],
    format: 'Private briefing and Q&A',
    delivery: 'Usually virtual; in-person available by request',
    ctaLabel: 'Request an Executive Briefing',
    briefingType: 'Executive Political & Regulatory Briefing'
  },
  {
    id: 'retreat',
    title: 'Strategy & Retreat Briefing',
    kind: 'Political and regulatory environment session for company retreats',
    designedFor:
      'Designed for companies holding board retreats, management retreats, annual planning sessions or strategy offsites.',
    body:
      'This session provides a structured view of the external political, regulatory and political economy environment, helping leadership teams understand the risks, pressures and policy signals likely to affect business planning.',
    listLabel: 'Typical themes',
    listItems: [
      "Nigeria’s political and regulatory outlook",
      '2027 transition and business risk',
      'Reform timing and policy execution',
      'Sector-specific regulatory exposure',
      'State-level operating risk',
      'Public sentiment, fiscal pressure and policy sustainability'
    ],
    format: 'Presentation and moderated Q&A',
    delivery: 'Virtual or in person',
    ctaLabel: 'Request a Retreat Briefing',
    briefingType: 'Strategy & Retreat Briefing'
  },
  {
    id: 'sector',
    title: 'Sector Political & Regulatory Risk Briefing',
    kind: 'Sector-specific intelligence session',
    designedFor:
      'Designed for organisations that require a focused briefing on how political power, regulators, policy implementation and institutional behaviour affect a specific sector.',
    body: 'Available sector lenses may include:',
    listLabel: 'Sector lenses',
    listItems: [
      'Financial services',
      'Telecoms and digital infrastructure',
      'Energy and power',
      'Oil and gas',
      'Manufacturing and consumer goods',
      'Infrastructure and government contracting',
      'Technology, data and digital regulation'
    ],
    format: 'Sector briefing note and presentation',
    delivery: 'Virtual or in person',
    ctaLabel: 'Request a Sector Briefing',
    briefingType: 'Sector Political & Regulatory Risk Briefing'
  },
  {
    id: 'rapid',
    title: 'Rapid Intelligence Briefing',
    kind: 'Timely briefing on urgent political or regulatory developments',
    designedFor:
      'Designed for situations where a major political, regulatory, judicial, electoral or institutional development requires quick interpretation for senior leadership.',
    body:
      'This briefing helps organisations understand what changed, why it matters, what is still uncertain and what should be watched next.',
    listLabel: 'Typical triggers',
    listItems: [
      'Major regulatory decision',
      'Election or court ruling',
      'Fiscal or monetary policy shift',
      'Major legislative development',
      'Political transition or cabinet change',
      'Sector-specific enforcement action'
    ],
    format: 'Short briefing and Q&A',
    delivery: 'Virtual by default',
    ctaLabel: 'Request a Rapid Briefing',
    briefingType: 'Rapid Intelligence Briefing'
  }
];

/** Sector options offered on the request form, drawn from the sector lenses. */
export const SECTOR_OPTIONS = SERVICES.find((s) => s.id === 'sector')!.listItems;
