"use server"

import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { enforceReviewRateLimit } from "@/lib/review-security"
import { sendReviewLibrarySignIn } from "@/lib/review-email"
import type { FormState } from "@/lib/definitions"
import {
  READER_PENDING_COOKIE,
  READER_LINK_COOKIE,
  readerShortCookieOptions,
  normaliseReaderEmail,
  reviewReaderSchemaReady,
  readerHasEditions,
  issueReaderSignIn,
  signInReaderWithCode,
  signInReaderWithToken,
  destroyReaderSession,
  readerCodeAttemptsExceeded,
  recordReaderCodeFailure,
  hashToken,
} from "@/lib/review-reader"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NEUTRAL: FormState = {
  ok: true,
  message: "If that address has Complimentary Review editions, a sign-in email is on its way. Please check your inbox.",
}

/** After signing in: the edition the reader was going to, or the library. */
function destination(edition: unknown): string {
  const id = String(edition ?? "")
  return UUID.test(id) ? `/review/library/open/${id}` : "/review/library"
}

function siteUrl(): string {
  const value = process.env.APP_URL
  if (!value) throw new Error("APP_URL is not configured")
  return value.replace(/\/$/, "")
}

/**
 * Asks for a Review Library sign-in email. The same answer whether or not the
 * address is approved, so the form never reveals who is on a list. Only an
 * address assigned at least one published edition is emailed.
 */
export async function requestReviewLibrarySignIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = normaliseReaderEmail(formData.get("email"))
  if (!email) return { message: "Enter a valid email address." }
  if (!(await reviewReaderSchemaReady())) return { message: "The Review Library sign-in is not available yet. Use the link in your review access email." }
  try {
    await enforceReviewRateLimit("review_library_signin", 8)
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Too many attempts. Please try again later." }
  }
  const pending = randomBytes(32).toString("base64url")
  ;(await cookies()).set(READER_PENDING_COOKIE, pending, readerShortCookieOptions())
  if (await readerHasEditions(email)) {
    try {
      const { token, code } = await issueReaderSignIn(email, hashToken(pending))
      const edition = String(formData.get("edition") ?? "")
      const next = UUID.test(edition) ? `&edition=${edition}` : ""
      await sendReviewLibrarySignIn(email, `${siteUrl()}/review/library/verify?token=${encodeURIComponent(token)}${next}`, code)
    } catch {
      // The neutral answer stands; the reader can ask again.
    }
  }
  return NEUTRAL
}

/** Signs THIS browser in with the code from the email. */
export async function reviewLibrarySignInWithCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = normaliseReaderEmail(formData.get("email"))
  if (!email) return { message: "Enter the email address the code was sent to." }
  try {
    await enforceReviewRateLimit("review_library_code", 20)
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Too many attempts. Please try again later." }
  }
  if (await readerCodeAttemptsExceeded(email)) {
    return { message: "Too many codes were tried for this address. Use the link in your latest email, or try again tomorrow." }
  }
  const result = await signInReaderWithCode(email, String(formData.get("code") ?? ""))
  if (!result.ok) {
    if (result.reason === "session_failed") return { message: "Your code was right, but signing in could not be finished. Try the same code again in a minute." }
    if (result.reason === "no_editions") return { message: "No Complimentary Review editions are assigned to this address at the moment." }
    await recordReaderCodeFailure(email)
    return { message: "That code did not work. Check it is from your latest APRI Review Library email, sent in the last 15 minutes." }
  }
  ;(await cookies()).set(READER_PENDING_COOKIE, "", { ...readerShortCookieOptions(), maxAge: 0 })
  redirect(destination(formData.get("edition")))
}

/** The confirming click for a link opened in a browser that did not ask for it. */
export async function reviewLibraryContinueHere(formData: FormData): Promise<void> {
  const store = await cookies()
  const token = store.get(READER_LINK_COOKIE)?.value ?? ""
  store.set(READER_LINK_COOKIE, "", { ...readerShortCookieOptions(), maxAge: 0 })
  const result = token ? await signInReaderWithToken(token) : ({ ok: false, reason: "invalid" } as const)
  if (!result.ok) {
    if (result.reason === "session_failed") {
      store.set(READER_LINK_COOKIE, token, readerShortCookieOptions())
      redirect("/review/library/verify/continue?retry=1")
    }
    redirect(`/review/library/sign-in?reason=${result.reason}`)
  }
  redirect(destination(formData.get("edition")))
}

export async function reviewLibrarySignOut(): Promise<void> {
  await destroyReaderSession()
  redirect("/review/library/sign-in?signed_out=1")
}

/**
 * Owner only: where the public Complimentary Review cards on the homepage and
 * /publications lead. "papermark" keeps today's direct links; "library" sends
 * readers through the remembered Review Library. Reversible at any time.
 */
export async function setReviewEntryMode(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireOwner()
  const mode = String(formData.get("mode") ?? "")
  if (mode !== "papermark" && mode !== "library") return { message: "Choose where the cards lead." }
  if (mode === "library" && !(await reviewReaderSchemaReady())) {
    return { message: "Apply 20261008_review_reader_library.sql first; until then the cards keep their direct links." }
  }
  await getSql()`
    insert into app_settings (key, value) values ('review_entry_mode', ${mode})
    on conflict (key) do update set value = excluded.value
  `
  revalidatePath("/")
  revalidatePath("/publications")
  revalidatePath("/admin/review-library")
  return {
    ok: true,
    message: mode === "library"
      ? "Saved: public cards now open the APRI Review Library. Approved readers sign in once per browser; anyone else is offered the request form."
      : "Saved: public cards link straight to each edition's Papermark link again.",
  }
}
