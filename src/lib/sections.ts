/**
 * Publication sections, in the display order given by the brief.
 *
 * Deliberately NOT in lib/publications.ts: that module is `server-only`, and
 * the CMS form is a client component that needs this list for its category
 * dropdown. Keeping the constant here lets both sides import it.
 */
export const PUBLICATION_SECTIONS = [
  'Periodic Briefings',
  'Monthly Intelligence',
  'Quarterly Outlook',
  'Election & Democratic Governance Monitor',
] as const

export type PublicationSection = (typeof PUBLICATION_SECTIONS)[number]
