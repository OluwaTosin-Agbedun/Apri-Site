"use server"

import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import type { FormState } from "@/lib/definitions"
import {
  MAX_FOLDER_SLUG_LENGTH,
  categoryLabel,
  isCatalogueCode,
  validateCategoryEdit,
  validateFolderInput,
} from "@/lib/publication-catalogue"
import {
  CATALOGUE_MIGRATION,
  catalogueSchemaReady,
  catalogueUsage,
  inUse,
  loadPublicationCatalogue,
  type CatalogueSql,
} from "@/lib/publication-catalogue-dal"

/**
 * Admin -> Publication Categories. Owner only: every action re-checks the
 * owner's account on the server (requireOwner re-reads the role from the
 * database), validates what it is given and changes nothing until the
 * catalogue migration has been applied. Codes are never created or deleted
 * here; a category is placement and labelling only, never access.
 */

const MIGRATION_NEEDED = `This needs the database migration db/migrations/${CATALOGUE_MIGRATION} first. Nothing was changed.`
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function refresh() {
  revalidatePath("/admin/categories")
  revalidatePath("/admin/datarooms")
  revalidatePath("/admin/review-library")
  revalidatePath("/portal")
  revalidatePath("/publications")
  revalidatePath("/")
}

function db(): CatalogueSql {
  return getSql() as unknown as CatalogueSql
}

const text = (formData: FormData, name: string) => {
  const v = formData.get(name)
  return typeof v === "string" ? v : ""
}

/** Saves one category's labels, position, active flag and other names. */
export async function savePublicationCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireOwner()
  const parsed = validateCategoryEdit({
    code: text(formData, "code"),
    label: text(formData, "label"),
    singularLabel: text(formData, "singularLabel"),
    sortOrder: text(formData, "sortOrder"),
    active: formData.get("active") === "on",
    aliases: text(formData, "aliases"),
  })
  if (!parsed.ok) return { message: parsed.message, errors: { [parsed.field]: [parsed.message] } }
  const value = parsed.value
  const sql = db()
  if (!(await catalogueSchemaReady(sql, { fresh: true }))) return { message: MIGRATION_NEEDED }

  // Deactivating a category something still uses needs an explicit
  // confirmation. Nothing in it is hidden or moved either way: an inactive
  // category is simply not offered for new choices.
  const current = (await sql`select active from publication_categories where code = ${value.code}`) as { active: boolean }[]
  const wasActive = current[0] ? current[0].active === true : true
  if (wasActive && !value.active) {
    const usage = (await catalogueUsage(sql)).get(value.code)
    if (inUse(usage) && formData.get("confirmDeactivate") !== "yes") {
      const parts = [
        usage!.publications && `${usage!.publications} publication record${usage!.publications === 1 ? "" : "s"}`,
        usage!.reviewEditions && `${usage!.reviewEditions} Complimentary Review edition${usage!.reviewEditions === 1 ? "" : "s"}`,
        usage!.featured && `${usage!.featured} homepage offer${usage!.featured === 1 ? "" : "s"}`,
        usage!.folders && `${usage!.folders} folder mapping${usage!.folders === 1 ? "" : "s"}`,
      ].filter(Boolean)
      const message =
        `${value.label} is in use (${parts.join(", ")}). Deactivating it stops it being offered for new choices; ` +
        "everything already in it stays listed to the readers it is permitted for. Tick the confirmation and save again to deactivate. Nothing was changed."
      return { message, errors: { confirmDeactivate: [message] } }
    }
  }

  await sql`
    insert into publication_categories (code, label, singular_label, sort_order, active, aliases)
    values (${value.code}, ${value.label}, ${value.singularLabel}, ${value.sortOrder}, ${value.active}, ${value.aliases}::text[])
    on conflict (code) do update set
      label = excluded.label,
      singular_label = excluded.singular_label,
      sort_order = excluded.sort_order,
      active = excluded.active,
      aliases = excluded.aliases,
      updated_at = now()
  `
  refresh()
  return { ok: true, message: `${value.label} saved.` }
}

/** Maps one Papermark folder to a category. An existing mapping is never silently re-pointed. */
export async function addFolderMapping(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireOwner()
  const folder = validateFolderInput(text(formData, "folder"))
  if (!folder.ok) return { message: folder.message, errors: { folder: [folder.message] } }
  const code = text(formData, "code")
  if (!isCatalogueCode(code)) return { message: "Choose a category.", errors: { code: ["Choose a category."] } }
  const sql = db()
  if (!(await catalogueSchemaReady(sql, { fresh: true }))) return { message: MIGRATION_NEEDED }

  const catalogue = await loadPublicationCatalogue(sql, { fresh: true })
  const category = catalogue.categories.find((c) => c.code === code)
  if (!category?.active) {
    return { message: `${categoryLabel(code, catalogue.categories)} is inactive. Activate it first, or choose another category.`, errors: { code: ["Inactive category."] } }
  }
  const existing = (await sql`
    select category_code from publication_category_folders where folder_slug = ${folder.value}
  `) as { category_code: string }[]
  if (existing[0]) {
    const label = categoryLabel(existing[0].category_code, catalogue.categories)
    return existing[0].category_code === code
      ? { ok: true, message: `"${folder.value}" is already mapped to ${label}.` }
      : { message: `"${folder.value}" is already mapped to ${label}. Remove that mapping first if it should move.`, errors: { folder: ["Already mapped."] } }
  }
  await sql`
    insert into publication_category_folders (folder_slug, category_code)
    values (${folder.value}, ${code})
    on conflict (folder_slug) do nothing
  `
  refresh()
  return {
    ok: true,
    message: `Documents in the folder "${folder.value}" now show under ${category.label}, unless their publication record has its own series. Access is unchanged.`,
  }
}

/** Removes one folder mapping. Documents in that folder stay listed, under their record's series or "Publications awaiting a category". */
export async function removeFolderMapping(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireOwner()
  const slug = text(formData, "folderSlug")
  if (!slug || slug.length > MAX_FOLDER_SLUG_LENGTH || !SLUG.test(slug)) return { message: "Unknown folder mapping." }
  const sql = db()
  if (!(await catalogueSchemaReady(sql, { fresh: true }))) return { message: MIGRATION_NEEDED }
  const removed = (await sql`
    delete from publication_category_folders where folder_slug = ${slug} returning category_code
  `) as { category_code: string }[]
  if (!removed[0]) return { message: "That folder mapping no longer exists." }
  refresh()
  return {
    ok: true,
    message: `"${slug}" is no longer mapped. Its documents stay listed to the readers they are permitted for, under their record's series or "Publications awaiting a category".`,
  }
}
