import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/dal"

export const dynamic = "force-dynamic"

/** The legacy per-document Copies queue is retained in the database for audit only. */
export default async function CopiesPage() {
  await requireAdmin()
  redirect("/admin/engagement")
}
