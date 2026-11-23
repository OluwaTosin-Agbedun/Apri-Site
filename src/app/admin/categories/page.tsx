import Link from "next/link"
import AdminShell from "@/components/AdminShell"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { categoryLabel } from "@/lib/publication-catalogue"
import {
  CATALOGUE_MIGRATION,
  catalogueUsage,
  getPublicationCatalogue,
  inUse,
  unassignedOverview,
  type CatalogueSql,
  type CategoryUsage,
  type UnassignedOverview,
} from "@/lib/publication-catalogue-dal"
import { AddFolderForm, CategoryForm, RemoveFolderButton } from "./categories-forms"

export const dynamic = "force-dynamic"
export const metadata = { title: "Publication Categories · Athena Strategic Advisory", robots: { index: false, follow: false } }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The folder offered for mapping from an unmapped path: its outermost folder.
 * The innermost mapped folder wins in every path, so mapping a subfolder such
 * as "2026" or "archive" would capture it under every other category too.
 */
function outermostFolder(path: string): string {
  return path.split("/").find(Boolean) ?? path
}

function describeUsage(u: CategoryUsage | undefined): string {
  if (!u || !inUse(u)) return "Not in use"
  return [
    u.publications && plural(u.publications, "publication record"),
    u.reviewEditions && plural(u.reviewEditions, "review edition"),
    u.featured && plural(u.featured, "homepage offer"),
    u.folders && plural(u.folders, "folder"),
  ]
    .filter(Boolean)
    .join(" · ")
}

/**
 * The one publication catalogue, for owners: labels, order and the active
 * flag of every category, which Papermark folders file documents into which
 * category, and what has no category yet. Placement and labels only -- who
 * may open an edition is never decided here.
 */
export default async function PublicationCategoriesPage() {
  const admin = await requireOwner()
  const catalogue = await getPublicationCatalogue({ fresh: true })
  const sql = getSql() as unknown as CatalogueSql
  let usage = new Map<string, CategoryUsage>()
  let unassigned: UnassignedOverview | null = null
  try {
    usage = await catalogueUsage(sql)
  } catch {
    // Counts are guidance; the page still works without them.
  }
  try {
    unassigned = await unassignedOverview(sql, catalogue)
  } catch {
    unassigned = null
  }
  const editable = catalogue.migrated && !catalogue.degraded
  const activeCategories = catalogue.categories.filter((c) => c.active).map((c) => ({ code: c.code, label: c.label }))

  return (
    <AdminShell
      admin={admin}
      current="/admin/categories"
      title="Publication Categories"
      description="One catalogue for subscriber libraries, Complimentary Review and Admin: names, order, and which Papermark folders file documents into which category."
    >
      {!catalogue.migrated && (
        <section className="mb-8 border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-900" role="status">
          <h3 className="font-serif text-lg mb-2">Database migration required</h3>
          <p>
            The built-in catalogue below is in use, but nothing can be changed until the migration{" "}
            <code>db/migrations/{CATALOGUE_MIGRATION}</code> has been applied. Until then, Other Assigned Publications cannot be
            stored as a series and Complimentary Review editions can be filed only under MIN, AIU or PLM.
          </p>
        </section>
      )}
      {catalogue.degraded && (
        <section className="mb-8 border border-red-200 bg-red-50 p-5 text-sm text-red-900" role="alert">
          The catalogue could not be read just now, so the built-in defaults are shown and nothing can be changed. Try again shortly.
        </section>
      )}

      <section className="mb-10 border border-border p-5 text-sm leading-relaxed max-w-4xl">
        <ul className="list-disc pl-5 space-y-1 text-foreground/80">
          <li>A category only places and labels an edition. Who may open it is decided by the subscription rules and Admin exceptions (or, for Complimentary Review, the edition&apos;s own readers), never by its category or folder.</li>
          <li>Category codes cannot be created or deleted here. Stored series values are limited by the database, so a new code needs a database migration.</li>
          <li>Deactivating a category stops it being offered for new choices. Anything already in it stays listed to the readers it is permitted for.</li>
          <li>Adding a category never adds a homepage card or assigns an edition to anyone: a homepage card appears only for an edition an owner offers.</li>
        </ul>
      </section>

      <h3 className="font-serif text-xl mb-4">Categories, in order</h3>
      <div className="space-y-4 mb-12">
        {catalogue.categories.map((c) => (
          <CategoryForm
            key={c.code}
            disabled={!editable}
            category={{
              code: c.code,
              label: c.label,
              singularLabel: c.singularLabel,
              sortOrder: c.sortOrder,
              active: c.active,
              aliases: [...c.aliases],
              usage: describeUsage(usage.get(c.code)),
              inUse: inUse(usage.get(c.code)),
            }}
          />
        ))}
      </div>

      <h3 className="font-serif text-xl mb-2">Papermark folder mappings</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
        A Data Room document is placed by its publication record&apos;s series first. Without one, the folder it is filed in decides,
        matched exactly on the folder&apos;s name (capitals, spaces, hyphens and a leading number are ignored, and &ldquo;&amp;&rdquo; reads as
        &ldquo;and&rdquo;, as in Papermark&apos;s own folder paths). A folder that is not listed here is never guessed: its documents show
        under &ldquo;Publications awaiting a category&rdquo;. Map a category&apos;s own folder, not a subfolder such as a year: the
        innermost mapped folder wins in every path.
      </p>
      <div className="border border-border bg-card/30 overflow-x-auto mb-4">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-black/5 text-foreground/70">
            <tr>
              <th className="font-medium p-3">Folder</th>
              <th className="font-medium p-3">Category</th>
              <th className="font-medium p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {catalogue.folders.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-3 text-muted-foreground">
                  No folders are mapped. Every document without a series shows under &ldquo;Publications awaiting a category&rdquo;.
                </td>
              </tr>
            ) : (
              catalogue.folders.map((f) => (
                <tr key={f.folderSlug}>
                  <td className="p-3 font-mono text-xs break-all">{f.folderSlug}</td>
                  <td className="p-3">{categoryLabel(f.code, catalogue.categories)}</td>
                  <td className="p-3 text-right">
                    <RemoveFolderButton folderSlug={f.folderSlug} disabled={!editable} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="border border-border bg-card/30 p-4 sm:p-5 mb-12">
        <AddFolderForm categories={activeCategories} disabled={!editable} />
      </div>

      <h3 className="font-serif text-xl mb-2">Publications awaiting a category</h3>
      {unassigned === null ? (
        <p className="text-sm text-muted-foreground mb-10">These counts could not be read just now.</p>
      ) : (
        <div className="mb-10 space-y-4">
          <p className="text-sm text-foreground/80 max-w-3xl">
            {plural(unassigned.documents, "Data Room document")} and {plural(unassigned.records, "published paid record")} outside Data
            Rooms have no category. Any of them a reader is permitted to open is listed to that reader under &ldquo;Publications
            awaiting a category&rdquo;; a draft, or a Data Room document with no published record, is shown to nobody. Give the record
            a series (<Link href="/admin/datarooms" className="text-accent hover:text-accent-hover">Data Rooms</Link>), or map its
            folder below.
          </p>
          {unassigned.folders.length > 0 && (
            <div className="border border-border bg-card/30 divide-y divide-border">
              {unassigned.folders.map((f) => (
                <div key={f.folder} className="p-4 space-y-3">
                  <p className="text-sm">
                    <span className="font-mono text-xs break-all">{f.folder}</span>{" "}
                    <span className="text-muted-foreground">· {plural(f.documents, "document")} not mapped</span>
                  </p>
                  <AddFolderForm categories={activeCategories} disabled={!editable} folder={outermostFolder(f.folder)} />
                </div>
              ))}
            </div>
          )}
          {unassigned.reviewFolders.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-foreground/80 max-w-3xl">
                Complimentary Review Data Room folders no mapping claims. Review sync proposes a category for a new draft from its
                folder mapping, then from the approved series names in its file name; a draft in one of these folders whose name
                does not say gets no proposal. A mapping here applies to paid Data Rooms too.
              </p>
              <div className="border border-border bg-card/30 divide-y divide-border">
                {unassigned.reviewFolders.map((f) => (
                  <div key={`review-${f.folder}`} className="p-4 space-y-3">
                    <p className="text-sm">
                      <span className="font-mono text-xs break-all">{f.folder}</span>{" "}
                      <span className="text-muted-foreground">· {plural(f.documents, "review document")} not mapped</span>
                    </p>
                    <AddFolderForm categories={activeCategories} disabled={!editable} folder={outermostFolder(f.folder)} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </AdminShell>
  )
}
