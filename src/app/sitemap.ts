import type { MetadataRoute } from "next"
import { INDEXABLE_PATHS, indexingEnabled, siteOrigin } from "@/lib/site-config"
export default function sitemap(): MetadataRoute.Sitemap {
  if (!indexingEnabled()) return []
  return INDEXABLE_PATHS.map((path) => ({
    url: new URL(path, siteOrigin()).href,
  }))
}
