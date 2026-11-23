import { indexingEnabled, siteOrigin } from "@/lib/site-config"
export function GET() {
  const origin = siteOrigin()
  const text = indexingEnabled()
    ? `# Athena Strategic Advisory\n\n> Independent political, regulatory and political-economy intelligence on Nigeria.\n\n## Public information\n- [Publications](${origin}/publications): Public descriptions and complimentary-review information.\n- [Services and briefings](${origin}/services): Advisory briefing information.\n- [Intelligence team](${origin}/team): The research team and analytical approach.\n- [Subscription access](${origin}/access): Subscription information and requests.\n\n## Access boundaries\nSubscriber and approved-review libraries are private. This file grants no permission to retrieve protected PDFs, summaries, personal links, recipient information or reader activity. It is a public navigation aid, not a security mechanism or indexing promise.\n`
    : `# Athena Strategic Advisory preview\n\nThis deployment is not intended for discovery.\n`
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
