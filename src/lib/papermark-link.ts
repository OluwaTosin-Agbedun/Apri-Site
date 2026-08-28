import { normalisePapermarkUrl, papermarkEmbedUrl } from "./papermark-embed"

export type PapermarkLinkType = "Single document" | "Multi-file" | "Data Room" | "Unverified"

export function inspectPapermarkShareLink(
  value: string | null | undefined,
  customDomain?: string | null,
): { url: string; host: string; type: PapermarkLinkType } | null {
  if (!value) return null
  const url = normalisePapermarkUrl(value)
  if (!papermarkEmbedUrl(url, customDomain)) return null
  const parsed = new URL(url)
  const path = parsed.pathname.toLowerCase()
  const type: PapermarkLinkType =
    /data[-_]?room|\/room\//.test(path) ? "Data Room"
      : /multi|dataroom|\/view\/[^/]+\/files/.test(path) ? "Multi-file"
        : "Unverified"
  return { url, host: parsed.hostname, type }
}
