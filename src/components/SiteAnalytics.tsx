"use client"

import { Analytics } from "@vercel/analytics/next"
import { sanitizeBeacon } from "@/lib/analytics-privacy"

/**
 * Vercel Web Analytics for anonymous, site-wide traffic.
 *
 * Deliberately limited to what Vercel is good for: page views, referrers,
 * countries and devices, for the public pages. Those figures are sampled,
 * anonymous estimates and are reported in the admin under their own heading,
 * never added to Papermark's verified reader counts.
 *
 * No custom events are sent. Custom events need a Pro plan and the project is
 * on Hobby — but the better reason is that APRI publication engagement belongs
 * in Neon, where it can be tied to a verified reader and audited, rather than in
 * a third-party analytics product.
 *
 * The exclusion and sanitisation rules live in `@/lib/analytics-privacy` so
 * they can be tested without rendering anything.
 */
export default function SiteAnalytics() {
  return <Analytics beforeSend={sanitizeBeacon} />
}
