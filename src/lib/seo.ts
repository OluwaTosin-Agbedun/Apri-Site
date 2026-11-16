import type { Metadata } from "next"
import {
  INDEXABLE_PATHS,
  indexingEnabled,
  isIndexablePath,
  siteOrigin,
} from "./site-config"

export const SITE_NAME = "Athena Political & Regulatory Intelligence (APRI)"
export const SITE_DESCRIPTION =
  "Independent political, regulatory and political-economy intelligence for organisations operating, investing and making strategic decisions in Nigeria."
export const SHARE_ALT =
  "Athena Political & Regulatory Intelligence — independent intelligence for decision-makers"
export const PAGE_INFORMATION: Record<typeof INDEXABLE_PATHS[number], {
  title: string
  description: string
}> = {
  "/": { title: SITE_NAME, description: SITE_DESCRIPTION },
  "/publications": {
    title: `Publications | ${SITE_NAME}`,
    description:
      "Explore APRI publications and analytical products for subscribers, authorised readers and prospective subscribers using the complimentary review library.",
  },
  "/services": {
    title: `Services & Briefings | ${SITE_NAME}`,
    description:
      "Private political and regulatory intelligence briefings for boards, executives, diplomatic missions and institutional decision-makers.",
  },
  "/team": {
    title: `Our Intelligence Team | ${SITE_NAME}`,
    description:
      "Meet the people behind APRI and learn how our independent political, regulatory and political-economy intelligence is produced and reviewed.",
  },
  "/access": {
    title: `Subscription Access | ${SITE_NAME}`,
    description:
      "Subscription levels for APRI political, regulatory and political-economy intelligence, including the quarterly Subscriber Intelligence Briefing.",
  },
  "/review": {
    title: "Complimentary Review | APRI",
    description:
      "Request complimentary review access to a confidential selection of APRI publications. Access requires email confirmation and approval.",
  },
  "/request-briefing": {
    title: `Request a Briefing | ${SITE_NAME}`,
    description:
      "Request a private political and regulatory intelligence briefing from APRI.",
  },
}
export function publicMetadata(path: typeof INDEXABLE_PATHS[number]): Metadata {
  const info = PAGE_INFORMATION[path]
  const origin = siteOrigin()
  const canonical = new URL(path, origin).href
  return {
    ...info,
    metadataBase: new URL(origin),
    alternates: { canonical },
    robots: { index: indexingEnabled() && isIndexablePath(path), follow: true },
    openGraph: {
      ...info,
      type: "website",
      url: canonical,
      siteName: SITE_NAME,
      locale: "en_NG",
      images: [
        {
          url: `${origin}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: SHARE_ALT,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      ...info,
      images: [`${origin}/opengraph-image`],
    },
  }
}
export function publicOrganisationSchema() {
  const origin = siteOrigin()
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organisation`,
        name: SITE_NAME,
        url: origin,
        parentOrganization: {
          "@type": "Organization",
          name: "Athena Centre for Policy and Leadership",
          url: "https://www.athenacentre.org/",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: origin,
        name: SITE_NAME,
        inLanguage: "en-NG",
        publisher: { "@id": `${origin}/#organisation` },
      },
    ],
  }
}
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}
