import { inspectPapermarkShareLink } from "@/lib/papermark-link"

export default function PapermarkConnectionPanel({
  link,
  updatedAt,
}: {
  link: string | null
  updatedAt: string | null
}) {
  const info = inspectPapermarkShareLink(link, process.env.PAPERMARK_CUSTOM_DOMAIN)
  return (
    <aside className="border border-border bg-card/30 p-5 mt-6">
      <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-4">Papermark connection</h3>
      <dl className="grid sm:grid-cols-2 gap-3 text-sm">
        <div><dt className="text-muted-foreground">Private link saved</dt><dd>{link ? "Yes" : "No"}</dd></div>
        <div><dt className="text-muted-foreground">Link type</dt><dd>{info?.type ?? "Unverified"}</dd></div>
        <div><dt className="text-muted-foreground">Link host</dt><dd>{info?.host ?? "—"}</dd></div>
        <div><dt className="text-muted-foreground">Last link update</dt><dd>{updatedAt ? new Date(updatedAt).toLocaleString("en-GB") : "—"}</dd></div>
      </dl>
      {info ? <a href={info.url} target="_blank" rel="noreferrer" className="inline-block mt-4 text-sm text-accent">Open share link</a>
        : <p className="mt-4 text-sm text-red-700">No valid private share link is saved.</p>}
    </aside>
  )
}
