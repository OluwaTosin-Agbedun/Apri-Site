"use server"

import { after } from "next/server"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { enforceReviewRateLimit } from "@/lib/review-security"
import { sendReviewLibrarySignIn, ReviewEmailNotSent } from "@/lib/review-email"
import { recordReviewEmailAttempt } from "@/lib/review-email-attempts"
import type { FormState } from "@/lib/definitions"
import {
  normaliseReaderEmail,
  reviewEntryMode,
  reviewReaderSchemaReady,
  readerHasEditions,
  issueReaderSignIn,
  spendReaderSignIn,
  signInReaderWithCode,
  destroyReaderSession,
  readerCodeAttemptsExceeded,
  recordReaderCodeFailure,
  hashToken,
} from "@/lib/review-reader"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** After signing in: the library, with the edition the reader chose marked. */
function destination(edition: unknown): string {
  const id = String(edition ?? "")
  return UUID.test(id) ? `/review/library?edition=${id}` : "/review/library"
}

const NOT_ASSIGNED =
  "No Complimentary Review publications are assigned to that address. Requesting a review, or confirming your email, does not give access by itself: APRI approves each reader. If you were approved under a different address, use that one."
const APRI_SIDE = "Sign-in is unavailable just now because of a problem on APRI's side, not with your address. Please try again later."

/** Five sign-in emails an hour to any one address, whoever asks. */
async function addressLimitReached(email: string): Promise<boolean> {
  const sql = getSql()
  const identity = hashToken(`signin:${email}`)
  const [{ n }] = (await sql`
    select count(*)::int as n from review_rate_limits
    where action = 'review_library_code_sent' and identity_hash = ${identity} and created_at > now() - interval '1 hour'
  `) as { n: number }[]
  if (n >= 5) return true
  await sql`insert into review_rate_limits (action, identity_hash) values ('review_library_code_sent', ${identity})`
  return false
}

/**
 * Step 1 of the reader sign-in: emails ONE code (no link) to an address that
 * is assigned at least one published edition. Asking again sends a new code
 * and the earlier one stops working.
 *
 * Every failure says which kind it is: access not assigned, a problem on
 * APRI's side (configuration or database), the email provider refusing the
 * email, or no clear answer from the provider. Diagnostics go to the owner's
 * email record; the reader never sees a provider message.
 *
 * Telling an unassigned address so reveals that one address's status to
 * whoever typed it; limits per network and per address stop a list being
 * worked through.
 */
export async function requestReviewLibrarySignIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = normaliseReaderEmail(formData.get("email"))
  if (!email) return { message: "Enter a valid email address." }
  if (!(await reviewReaderSchemaReady())) return { message: APRI_SIDE }
  try {
    await enforceReviewRateLimit("review_library_signin", 8)
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Too many attempts. Please try again later." }
  }
  let code: string
  let issued: string
  try {
    if (!(await readerHasEditions(email))) return { message: NOT_ASSIGNED }
    if (await addressLimitReached(email)) {
      return { message: "Several codes have already been sent to this address in the last hour. Use the latest one, or try again later." }
    }
    ;({ id: issued, code } = await issueReaderSignIn(email))
  } catch {
    await recordReviewEmailAttempt("library_sign_in", email, {
      status: "not_configured",
      message: "the sign-in code could not be prepared (database or SESSION_SECRET problem); nothing was sent",
    })
    return { message: APRI_SIDE }
  }
  try {
    await sendReviewLibrarySignIn(email, code)
  } catch (error) {
    // Whatever happened, the code from THIS attempt was not handed to the
    // provider, so it is spent and can never be used later.
    try {
      await spendReaderSignIn(issued)
    } catch {}
    if (error instanceof ReviewEmailNotSent) {
      if (error.outcome.status === "unknown") {
        return { message: "We could not confirm that the code was sent. Please ask for a new code in a minute; the code from this attempt will not work." }
      }
      if (error.outcome.status === "rejected") {
        return { message: "Our email provider did not accept the sign-in email, so no code was sent. Check the address, or try again later." }
      }
      return { message: "Sign-in emails cannot be sent at the moment because of a configuration problem on APRI's side. Please try again later." }
    }
    return { message: APRI_SIDE }
  }
  return {
    ok: true,
    message:
      "A sign-in code is on its way to that address. It works once, for 15 minutes. If it has not arrived within a few minutes, check spam or junk, then ask for a new code.",
  }
}

/** Step 2: the code from the email signs THIS browser in for 24 hours. */
export async function reviewLibrarySignInWithCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = normaliseReaderEmail(formData.get("email"))
  if (!email) return { message: "Enter the email address the code was sent to." }
  try {
    await enforceReviewRateLimit("review_library_code", 20)
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Too many attempts. Please try again later." }
  }
  if (await readerCodeAttemptsExceeded(email)) {
    return { message: "Too many wrong codes were tried for this address in the last hour. Please wait an hour, then ask for a new code." }
  }
  const result = await signInReaderWithCode(email, String(formData.get("code") ?? ""))
  if (!result.ok) {
    if (result.reason === "session_failed") return { message: "Your code was right, but signing in could not be finished. Try the same code again in a minute." }
    if (result.reason === "no_editions") return { message: NOT_ASSIGNED }
    await recordReaderCodeFailure(email)
    return { message: "That code did not work. Use the code from your latest APRI sign-in email; each code works once, for 15 minutes. You can ask for a new code." }
  }
  // Prepare the reader's personal room now, so their first Read is quick.
  try {
    after(async () => {
      try {
        const { reconcileReaderRoom, openWindowReady } = await import("@/lib/review-reader-rooms")
        if (await openWindowReady()) await reconcileReaderRoom(email, { create: true })
      } catch {}
    })
  } catch {
    // Outside a request: the first Read prepares it instead.
  }
  redirect(destination(formData.get("edition")))
}

export async function reviewLibrarySignOut(): Promise<void> {
  await destroyReaderSession()
  redirect("/review/library/sign-in?signed_out=1")
}

/**
 * Owner only: where the public Complimentary Review cards on the homepage and
 * /publications lead. "papermark" keeps each edition's own Papermark link (a
 * Papermark code per edition); "library" sends readers to the APRI Review
 * Library (one APRI code, then every assigned edition). Reversible.
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
  // Read back what is now in effect, so the message can never disagree with
  // the setting shown after a refresh.
  const effective = await reviewEntryMode()
  if (effective !== mode) return { message: `Not in effect: the cards still lead to ${ENTRY_MODE_LABEL[effective]}. Check the migrations.` }
  return { ok: true, message: `Saved. Public review cards now lead to ${ENTRY_MODE_LABEL[effective]}.` }
}

const ENTRY_MODE_LABEL = {
  papermark: "each edition's own Papermark link (a Papermark code per edition)",
  library: "the APRI Review Library (one APRI code, then every assigned edition)",
} as const
