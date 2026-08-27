import Link from 'next/link'
import { requireAdmin } from '@/lib/dal'
import { getSql } from '@/lib/db'
import AdminShell from '@/components/AdminShell'
import { seriesLabel, visibilityBadge, isVisibility } from '@/lib/entitlements'
import SyncPanel from './sync-panel'
import RowActions from './row-actions'

export const metadata = { title: 'Publications · APRI' }
export const dynamic = 'force-dynamic'

type Row = {
  id: string
  title: string
  kicker: string
  section_label: string
  status: string
  cta_mode: string
  visibility: string
  open_link_url: string | null
  series: string
  edition_date: string | null
  papermark_link: string
  papermark_document_id: string | null
  sort_order: number
  published_at: string | null
}

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-accent/10 text-accent',
  draft: 'bg-muted text-muted-foreground border border-border',
  archived: 'bg-black/5 text-foreground/40 border border-border',
}

export default async function AdminDocumentsPage() {
  const admin = await requireAdmin()
  const sql = getSql()

  const documents = (await sql`
    select id, title, kicker, section_label, status, cta_mode,
           visibility, open_link_url, series, edition_date,
           papermark_link, papermark_document_id, sort_order, published_at
    from documents
    order by sort_order asc, created_at desc
  `) as Row[]

  const [autoSync] = (await sql`
    select value from app_settings where key = 'papermark_auto_sync' limit 1
  `) as { value: string }[]

  return (
    <AdminShell
      admin={admin}
      current="/admin/documents"
      title="Publications"
      description="Manage open public editions. Only Open items that you publish appear on the public Publications page."
      actions={
        <Link
          href="/admin/documents/new"
          className="bg-foreground text-background px-4 py-2 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors shrink-0"
        >
          New Publication
        </Link>
      }
    >
      <SyncPanel />

      <div className="border border-border bg-card/30">
        {documents.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No publications yet. Use &ldquo;Fetch from Papermark&rdquo; above, or add one
            manually.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-4">Title</th>
                <th className="font-medium p-4">Series</th>
                <th className="font-medium p-4">Audience</th>
                <th className="font-medium p-4">Status</th>
                <th className="font-medium p-4">Link</th>
                <th className="font-medium p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-black/5 transition-colors align-top">
                  <td className="p-4">
                    <p className="font-medium text-foreground">{doc.title}</p>
                    {doc.kicker && (
                      <p className="text-xs text-foreground/50 mt-1">{doc.kicker}</p>
                    )}
                    {doc.papermark_document_id && (
                      <p className="text-xs text-accent/70 mt-1">From Papermark</p>
                    )}
                  </td>
                  <td className="p-4 text-foreground/70">
                    {doc.series ? seriesLabel(doc.series) : doc.section_label || '—'}
                    {doc.edition_date && (
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {new Date(doc.edition_date).toLocaleDateString('en-GB')}
                      </span>
                    )}
                  </td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        doc.visibility === 'OPEN'
                          ? 'bg-accent/10 text-accent'
                          : 'bg-muted text-muted-foreground border border-border'
                      }`}
                    >
                      {isVisibility(doc.visibility)
                        ? visibilityBadge(doc.visibility)
                        : doc.visibility}
                    </span>
                  </td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                        STATUS_BADGE[doc.status] ?? STATUS_BADGE.draft
                      }`}
                    >
                      {doc.status}
                    </span>
                  </td>
                  <td className="p-4">
                    {doc.visibility === 'OPEN' ? (
                      doc.open_link_url ? (
                        <a
                          href={doc.open_link_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-foreground hover:text-accent transition-colors"
                        >
                          Preview &rarr;
                        </a>
                      ) : (
                        <span className="text-xs text-red-700">Public link missing</span>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Via subscriber link
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    <RowActions
                      id={doc.id}
                      status={doc.status}
                      visibility={doc.visibility}
                      title={doc.title}
                      canDelete={admin.role === 'owner'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Auto-sync is{' '}
        <span className="font-medium">
          {autoSync?.value === 'true' ? 'enabled' : 'disabled'}
        </span>
        . It ships disabled; publications update only when you press Fetch.
      </p>
    </AdminShell>
  )
}
