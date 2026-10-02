"use server"

import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
import { enforceReviewRateLimit } from "@/lib/review-security"
import { sendReviewLibrarySignIn } from "@/lib/review-email"
import { emailOrigin } from "@/lib/app-url"
import type { FormState } from "@/lib/definitions"
import {
  READER_PENDING_COOKIE,
  READER_LINK_COOKIE,
  readerShortCookieOptions,
  normaliseReaderEmail,
  reviewEntryMode,
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

const siteUrl = emailOrigin

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
      const base = siteUrl()
      const { token, code } = await issueReaderSignIn(email, hashToken(pending))
      const edition = String(formData.get("edition") ?? "")
      const next = UUID.test(edition) ? `&edition=${edition}` : ""
      await sendReviewLibrarySignIn(email, `${base}/review/library/verify?token=${encodeURIComponent(token)}${next}`, code)
    } catch {
      // The email was NOT handed to the provider (or was refused). Saying it
      // is on its way would be false; the attempt is in the owner's
      // diagnostics.
      return { message: "We could not send the sign-in email just now. Please try again in a few minutes." }
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
  if (mode !== "papermark" && mode !== "library" && mode !== "rooms") return { message: "Choose where the cards lead." }
  if (mode === "library" && !(await reviewReaderSchemaReady())) {
    return { message: "Apply 20261008_review_reader_library.sql first; until then the cards keep their direct links." }
  }
  if (mode === "rooms") {
    const { readerRoomsSchemaReady } = await import("@/lib/review-reader-rooms")
    const { reviewRoomsProof } = await import("@/lib/review-reader")
    if (!(await readerRoomsSchemaReady())) return { message: "Apply 20261009_review_reader_rooms.sql first." }
    if (!(await reviewRoomsProof())) {
      return { message: "Record the controlled two-reader Papermark test below first. Until then the cards keep their current links." }
    }
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
  if (effective !== mode) {
    return { message: `Not in effect: the cards still lead to ${ENTRY_MODE_LABEL[effective]}. ${mode === "rooms" ? "Personal rooms need their migration and the recorded two-reader test." : "Check the migrations."}` }
  }
  return { ok: true, message: `Saved. Public review cards now lead to ${ENTRY_MODE_LABEL[effective]}.` }
}

const ENTRY_MODE_LABEL = {
  papermark: "each edition's own Papermark link",
  library: "the APRI Review Library (APRI sign-in, then a Papermark code per edition)",
  rooms: "each approved reader's personal Papermark room (one Papermark code)",
} as const

const NOT_APPROVED_MESSAGE =
  "No Complimentary Review editions are assigned to that address yet. Requesting a review, or confirming your email, does not give access by itself: APRI approves each reader."

/**
 * The reading entry for a browser APRI does not recognise yet: the reader
 * types the address their editions were issued to, and -- if, and only if,
 * that exact address is assigned at least one published edition -- goes
 * straight on to their personal Papermark room, where Papermark sends its
 * one code to that address. APRI sends no email and asks for no code.
 *
 * The routing cookie set here is not a sign-in: it only remembers which room
 * this browser goes to. Anyone who types someone else's address reaches a
 * Papermark screen that sends its code to that person, not to them.
 *
 * An address that is not approved is told so, which reveals that one
 * address's status to whoever typed it; rate limits per network and per
 * address stop the list being worked through.
 */
export async function openReviewLibrary(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = normaliseReaderEmail(formData.get("email"))
  if (!email) return { message: "Enter the email address your review editions were issued to." }
  try {
    await enforceReviewRateLimit("review_open_library", 12)
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Too many attempts. Please try again later." }
  }
  const sql = getSql()
  const identity = hashToken(`open:${email}`)
  const [{ n }] = (await sql`
    select count(*)::int as n from review_rate_limits
    where action = 'review_open_email' and identity_hash = ${identity} and created_at > now() - interval '1 hour'
  `) as { n: number }[]
  if (n >= 10) return { message: "Too many attempts for this address. Please try again later." }
  await sql`insert into review_rate_limits (action, identity_hash) values ('review_open_email', ${identity})`
  if (!(await readerHasEditions(email))) return { message: NOT_APPROVED_MESSAGE }
  const { setRoomHint } = await import("@/lib/review-room-entry")
  await setRoomHint(email)
  redirect("/review/read")
}

/** "Not you?": this browser forgets which reader it routes to. */
export async function forgetReviewReader(): Promise<void> {
  const { clearRoomHint } = await import("@/lib/review-room-entry")
  await clearRoomHint()
  redirect("/review/read/request")
}
