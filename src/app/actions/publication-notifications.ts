"use server"
import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { requireSubscriber } from "@/lib/subscriber-dal"
import { getSql } from "@/lib/db"
import { confirmStaffPassword } from "@/lib/staff-password"
import {
  drainPublicationNotices,
  noticeSchemaReady,
  noticeRevision,
  queuePublicationNotice,
  setPublicationNotices,
  NOTICE_MIGRATION,
} from "@/lib/publication-notifications"

export type NoticeFormState = {
  ok?: boolean
  message: string
} | undefined
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function ownerReady() {
  const owner = await requireOwner()
  if (!(await noticeSchemaReady()))
    throw new Error(`Apply ${NOTICE_MIGRATION} first.`)
  return owner
}
async function password(owner: string, form: FormData) {
  return confirmStaffPassword(owner, form.get("password"))
}

export async function configurePublicationNotices(
  _previous: NoticeFormState,
  form: FormData,
): Promise<NoticeFormState> {
  const owner = await ownerReady()
  const enabled = form.get("enabled") === "yes"
  const reason = String(form.get("reason") ?? "").trim()
  if (reason.length < 10 || reason.length > 300)
    return { message: "Record the approval reason (10–300 characters)." }
  if (enabled && form.get("baselineConfirmed") !== "yes")
    return {
      message:
        "Review and confirm the starting baseline; existing released editions will not be emailed automatically.",
    }
  if (!(await password(owner.id, form)))
    return {
      message:
        "Your password could not be confirmed. Check it or try again in 15 minutes.",
    }
  await setPublicationNotices(owner.id, enabled, reason)
  revalidatePath("/admin/notifications")
  return {
    ok: true,
    message: enabled
      ? "New-release alerts enabled from the approved baseline. Sending still requires the hosting switch and a configured email provider. No historical library email was triggered."
      : "Publication emails paused. Saved jobs remain recorded.",
  }
}
export async function approvePublicationCorrection(
  _previous: NoticeFormState,
  form: FormData,
): Promise<NoticeFormState> {
  const owner = await ownerReady()
  const id = String(form.get("publicationId") ?? "")
  const version = String(form.get("version") ?? "").trim()
  const reason = String(form.get("reason") ?? "").trim()
  if (
    !uuid.test(id) ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,79}$/.test(version) ||
    reason.length < 10 ||
    reason.length > 200 ||
    form.get("approved") !== "yes"
  )
    return {
      message:
        "Choose a released edition, a version label and the reason, and confirm this is a substantive approved update.",
    }
  if (!(await password(owner.id, form)))
    return {
      message:
        "Your password could not be confirmed. Check it or try again in 15 minutes.",
    }
  const event = await queuePublicationNotice(
    id,
    owner.id,
    noticeRevision(version),
    `${version}: ${reason}`,
  )
  revalidatePath("/admin/notifications")
  return event
    ? {
        ok: true,
        message:
          "Approved update queued. Earlier unsent announcements are superseded; the worker will recheck each reader.",
      }
    : {
        message:
          "This version is already recorded, alerts are paused, or the edition is not released. No duplicate was queued.",
      }
}
export async function processPublicationNotices(): Promise<void> {
  await ownerReady()
  after(async () => {
    await drainPublicationNotices().catch(() => {})
    revalidatePath("/admin/notifications")
  })
  revalidatePath("/admin/notifications")
}
export async function retryRefusedPublicationNotice(
  _previous: NoticeFormState,
  form: FormData,
): Promise<NoticeFormState> {
  const owner = await ownerReady()
  const id = String(form.get("jobId") ?? "")
  if (!uuid.test(id)) return { message: "Choose a saved notification." }
  if (!(await password(owner.id, form)))
    return {
      message:
        "Your password could not be confirmed. Check it or try again in 15 minutes.",
    }
  const rows =
    await getSql()`with changed as (update publication_notice_jobs set state='pending',attempts=0,next_attempt_at=now(),updated_at=now()
    where id=${id}::uuid and state='failed' and outcome='rejected' returning id),
    audit as (insert into publication_notice_audit(actor_id,action,reason) select ${owner.id}::uuid,'known_refusal_retried',${id} from changed)
    select id from changed`
  revalidatePath("/admin/notifications")
  return rows.length
    ? {
        ok: true,
        message:
          "Known provider refusal queued for a new permission check. Unknown or accepted sends cannot be retried here.",
      }
    : {
        message:
          "Only a known provider refusal can be retried. Inspect uncertain sends privately in the provider dashboard.",
      }
}
export async function savePublicationEmailPreference(
  _previous: NoticeFormState,
  form: FormData,
): Promise<NoticeFormState> {
  const reader = await requireSubscriber()
  if (!(await noticeSchemaReady()))
    return {
      message:
        "Email preferences are not available until the notification migration is applied.",
    }
  const enabled = form.get("enabled") === "yes"
  await getSql()`insert into publication_notice_preferences(subscriber_id,enabled) values(${reader.id}::uuid,${enabled})
    on conflict(subscriber_id) do update set enabled=excluded.enabled,updated_at=now()`
  revalidatePath("/portal/preferences")
  return {
    ok: true,
    message: enabled
      ? "Publication emails are on for future eligible releases. Your library access is unchanged."
      : "Publication emails are off. Sign-in and essential account messages are unchanged.",
  }
}
