import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

/**
 * The four publication sections, in the display order specified by the
 * publication brief. Home renders sections in exactly this order.
 */
export const PUBLICATION_SECTIONS = [
  'Periodic Briefings',
  'Monthly Intelligence',
  'Quarterly Outlook',
  'Election & Democratic Governance Monitor'
] as const;

export type PublicationSection = (typeof PUBLICATION_SECTIONS)[number];

/**
 * How a publication is accessed.
 *  - 'secure-document' opens the secure Papermark link.
 *  - 'request'          routes the reader to the access request form instead,
 *                       because the product is released on approval.
 */
export type AccessMode = 'secure-document' | 'request';

export type DocumentItem = {
  id: string;
  /** Section heading this publication sits under on the website. */
  section: PublicationSection;
  /** Sort position within its section. */
  order: number;
  /** Publication name, e.g. "Nigeria Political & Regulatory Environment". */
  title: string;
  /** Product line, e.g. "Monthly Intelligence Note". */
  productLine: string;
  /** Current edition reference, e.g. "August 2026" or "Issue No. 1 · July 2026". */
  edition: string;
  /** Subject line of the current edition, where the product carries one. */
  editionTitle?: string;
  description: string;
  frequency: string;
  audience: string;
  /** Call-to-action wording, which differs per publication. */
  ctaLabel: string;
  /** Attribution note, e.g. the Athena Election Observatory line. */
  attribution?: string;
  accessMode: AccessMode;
  papermarkLink: string;
  createdAt: string;
};

export type SubscriberItem = {
  id: string;
  name: string;
  organization: string;
  email: string;
  status: 'Active' | 'Pending';
  createdAt: string;
};

/** Briefing types offered on the Services & Briefings page. */
export const BRIEFING_TYPES = [
  'Board Political & Regulatory Risk Briefing',
  'Executive Political & Regulatory Briefing',
  'Strategy & Retreat Briefing',
  'Sector Political & Regulatory Risk Briefing',
  'Rapid Intelligence Briefing',
  'Not sure / request guidance'
] as const;

export type BriefingType = (typeof BRIEFING_TYPES)[number];

export const BRIEFING_FORMATS = ['Virtual', 'In person', 'Either'] as const;

export type BriefingFormat = (typeof BRIEFING_FORMATS)[number];

export type BriefingRequestItem = {
  id: string;
  name: string;
  organization: string;
  role: string;
  email: string;
  phone: string;
  briefingType: BriefingType | '';
  preferredFormat: BriefingFormat | '';
  timeline: string;
  sector: string;
  issueDescription: string;
  audienceSize: string;
  location: string;
  status: 'New' | 'In review' | 'Scheduled' | 'Closed';
  createdAt: string;
};

type AppContextType = {
  documents: DocumentItem[];
  setDocuments: React.Dispatch<React.SetStateAction<DocumentItem[]>>;
  subscribers: SubscriberItem[];
  setSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  briefingRequests: BriefingRequestItem[];
  setBriefingRequests: React.Dispatch<React.SetStateAction<BriefingRequestItem[]>>;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

const SEED_TIME = '2026-08-01T00:00:00.000Z';

const initialDocuments: DocumentItem[] = [
  {
    id: 'athena-intelligence-update',
    section: 'Periodic Briefings',
    order: 1,
    title: 'Athena Intelligence Update',
    productLine: 'Periodic Focused Briefing',
    edition: '001-2026',
    editionTitle: 'Osun 2026: What the Result Tells Us About 2027',
    description:
      "Athena Intelligence Updates are periodic focused briefings issued when a material political, regulatory, electoral, legal, institutional or operating-risk development requires timely interpretation. They are shorter than the Monthly Intelligence Note and are designed to explain what changed, why it matters, and what executives should watch next.",
    frequency: 'Periodic, issued as needed',
    audience:
      'Executives, boards, risk teams, investors, strategy teams and government relations teams',
    ctaLabel: 'Access Secure Note',
    accessMode: 'secure-document',
    papermarkLink: 'https://www.papermark.com/view/cmt0fr2ks003yl804ms1f56su',
    createdAt: SEED_TIME
  },
  {
    id: 'nigeria-political-regulatory-environment',
    section: 'Monthly Intelligence',
    order: 1,
    title: 'Nigeria Political & Regulatory Environment',
    productLine: 'Monthly Intelligence Note',
    edition: 'August 2026',
    description:
      "A confidential monthly intelligence note on Nigeria’s political, regulatory and political economy operating environment. The Monthly Intelligence Note tracks political power, regulatory direction, policy implementation, sector exposure, state-level operating risk, public sentiment, fiscal pressure and forward-looking business-risk signals.",
    frequency: 'Monthly',
    audience:
      'CEOs, boards, strategy teams, risk officers, government relations teams, investors and regulated businesses',
    ctaLabel: 'Access Secure Note',
    accessMode: 'secure-document',
    papermarkLink: 'https://www.papermark.com/view/cmt0fpp1x00dkjn042ua17kcx',
    createdAt: SEED_TIME
  },
  {
    id: 'nigeria-political-regulatory-outlook',
    section: 'Quarterly Outlook',
    order: 1,
    title: 'Nigeria Political & Regulatory Outlook',
    productLine: 'Quarterly Intelligence Brief',
    edition: 'Q3 2026',
    description:
      "A broader 90–180 day outlook on Nigeria’s political, regulatory and political economy environment. The Quarterly Intelligence Brief is designed for boards and senior executives who need a forward-looking assessment of policy direction, political risk, regulatory trajectory, institutional behaviour, sector exposure and scenario risks.",
    frequency: 'Quarterly',
    audience:
      'Boards, board risk committees, CEOs, investment committees, strategy teams, investors and regulated businesses',
    ctaLabel: 'Request Access',
    accessMode: 'request',
    papermarkLink: '',
    createdAt: SEED_TIME
  },
  {
    id: 'political-landscape-monitor',
    section: 'Election & Democratic Governance Monitor',
    order: 1,
    title: 'Political Landscape Monitor',
    productLine: 'AEO Monthly Strategic Assessment',
    edition: 'Issue No. 1 · July 2026',
    editionTitle: "Monitoring Nigeria’s Democratic and Electoral Landscape",
    description:
      "The Political Landscape Monitor is produced by the Athena Election Observatory and included in APRI subscriber access. It provides a monthly strategic assessment of Nigeria’s democratic, electoral and political landscape, tracking political parties, INEC, constitutional institutions, democratic stability, electoral reform and information integrity.",
    frequency: 'Monthly',
    audience:
      'APRI subscribers, democratic governance stakeholders, election observers, diplomats, policy actors, civil society, media and political-risk teams',
    ctaLabel: 'Access Secure Monitor',
    attribution:
      'An Athena Election Observatory publication included in APRI subscriber access.',
    accessMode: 'secure-document',
    papermarkLink: '',
    createdAt: SEED_TIME
  }
];

/**
 * Reads persisted state, falling back to the supplied seed. The storage keys are
 * versioned: the publication model gained section, edition and CTA fields, so
 * older payloads cannot be reused and are deliberately not migrated.
 */
function loadPersisted<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<DocumentItem[]>(() =>
    loadPersisted('apri_documents_v3', initialDocuments)
  );

  const [subscribers, setSubscribers] = useState<SubscriberItem[]>(() =>
    loadPersisted<SubscriberItem[]>('apri_subscribers_v3', [])
  );

  const [briefingRequests, setBriefingRequests] = useState<BriefingRequestItem[]>(() =>
    loadPersisted<BriefingRequestItem[]>('apri_briefing_requests_v1', [])
  );

  useEffect(() => {
    localStorage.setItem('apri_documents_v3', JSON.stringify(documents));
  }, [documents]);

  useEffect(() => {
    localStorage.setItem('apri_subscribers_v3', JSON.stringify(subscribers));
  }, [subscribers]);

  useEffect(() => {
    localStorage.setItem('apri_briefing_requests_v1', JSON.stringify(briefingRequests));
  }, [briefingRequests]);

  return (
    <AppContext.Provider
      value={{
        documents,
        setDocuments,
        subscribers,
        setSubscribers,
        briefingRequests,
        setBriefingRequests
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within an AppProvider');
  return context;
}
