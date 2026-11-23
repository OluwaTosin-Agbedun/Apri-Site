import AdminShell from "@/components/AdminShell"
import { requireAdmin } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { EDITORIAL_METADATA_PENDING, TAG_KINDS, TAG_KIND_LABELS, formatDay } from "@/lib/publication-metadata"
import { loadTagVocabulary, type VocabularyTag } from "@/lib/publication-metadata-dal"
import { AddTagForm, DeleteTagForm, RenameTagForm, TagStateForm } from "./tag-forms"

export const dynamic = "force-dynamic"
export const metadata = { title: "Publication Tags · Athena Strategic Advisory", robots: { index: false, follow: false } }

/**
 * The controlled vocabulary of subjects, sectors and geography that editors
 * assign to publications (in each publication's editor). Owners and editors
 * may add tags; only owners may rename, retire, restore or delete one, and a
 * tag any publication carries can only be retired, never deleted. Every
 * action re-checks the role on the server.
 */
export default async function PublicationTagsPage() {
  const admin = await requireAdmin()
  const owner = admin.role === "owner"
  let vocabulary: { ready: boolean; tags: VocabularyTag[] } | null = null
  try {
    vocabulary = await loadTagVocabulary(getSql())
  } catch {
    vocabulary = null
  }

  return (
    <AdminShell
      admin={admin}
      current="/admin/tags"
      title="Publication Tags"
      description="The subjects, sectors and geography editors can assign to publications. Subscribers can filter their own library by the tags on editions they may read."
    >
      {vocabulary === null ? (
        <p role="status" className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">The tags could not be loaded just now. Reload the page to try again.</p>
      ) : !vocabulary.ready ? (
        <p role="status" className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">{EDITORIAL_METADATA_PENDING}</p>
      ) : (
        <>
          <section className="mb-8 border border-border bg-card/30 p-6">
            <h2 className="font-serif text-xl mb-1">Add a tag</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
              Use one consistent label per idea (for example &ldquo;Electricity&rdquo;, not also &ldquo;Power sector&rdquo;). Labels are
              unique within each kind, whatever their capitals.
            </p>
            <AddTagForm />
          </section>

          <p className="mb-6 text-xs text-muted-foreground max-w-3xl">
            {owner
              ? "Renaming changes the label on every publication that carries the tag. Retiring stops it being added to more publications; it stays on those that already carry it (and in their readers' filters) until removed there. Only a tag no publication carries can be deleted."
              : "Only an owner can rename, retire or delete a tag. Ask an owner if a label is wrong."}
          </p>

          {TAG_KINDS.map((kind) => {
            const tags = vocabulary.tags.filter((t) => t.kind === kind)
            return (
              <section key={kind} className="mb-8 border border-border bg-card/30 p-6" aria-labelledby={`tags-${kind}`}>
                <h2 id={`tags-${kind}`} className="font-serif text-xl mb-4">{TAG_KIND_LABELS[kind].plural}</h2>
                {tags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {tags.map((tag) => (
                      <li key={tag.id} className="py-3 flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-6">
                        <div className="min-w-0 lg:w-1/3">
                          <p className="text-sm font-medium text-foreground break-words">
                            {tag.label}
                            {!tag.active && <span className="ml-2 border border-border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wider text-muted-foreground">Retired</span>}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {tag.publications === 1 ? "1 publication" : `${tag.publications} publications`}
                            {tag.createdBy ? ` · added by ${tag.createdBy}` : ""}
                            {!tag.active && tag.retiredAt ? ` · retired${tag.retiredBy ? ` by ${tag.retiredBy}` : ""} on ${formatDay(tag.retiredAt.slice(0, 10))}` : ""}
                          </p>
                        </div>
                        {owner && (
                          <div className="flex flex-wrap items-start gap-3">
                            <RenameTagForm id={tag.id} label={tag.label} />
                            <TagStateForm id={tag.id} active={tag.active} label={tag.label} />
                            {tag.publications === 0 && <DeleteTagForm id={tag.id} label={tag.label} />}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </>
      )}
    </AdminShell>
  )
}
