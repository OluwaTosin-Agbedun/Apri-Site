import type { MetadataRoute } from "next"
import { indexingEnabled, siteOrigin } from "@/lib/site-config"
export default function robots(): MetadataRoute.Robots {
  if (!indexingEnabled()) return { rules: { userAgent: "*", disallow: "/" } }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/portal",
        "/api/",
        "/review/library",
        "/review/verify",
        "/review/access",
        "/review/read",
        "/review/confirmed",
        "/review/subscribe",
        "/privacy",
        "/terms",
        "/publications/",
      ],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
    host: siteOrigin(),
  }
}
