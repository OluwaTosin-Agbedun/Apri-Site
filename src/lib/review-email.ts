import "server-only"
import { Resend } from "resend"

const MANAGER = "intelligence@athenacentre.org"
const from = process.env.RESEND_FROM_EMAIL || "intelligence@athenacentre.org"
const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  )

async function send(message: Parameters<Resend["emails"]["send"]>[0]) {
  if (!process.env.RESEND_API_KEY) throw new Error("Resend is not configured")
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
    message,
  )
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export function sendReviewVerification(
  email: string,
  name: string,
  url: string,
) {
  return send({
    from: `APRI <${from}>`,
    to: email,
    subject: "Confirm your APRI review request",
    html: `<p>Dear ${esc(name)},</p><p>Please confirm your email before APRI prepares secure access.</p><p><a href="${esc(url)}">Confirm Email</a></p>`,
  })
}
export function sendReviewManagerNotification(d: {
  name: string
  email: string
  organisation: string
  role: string
  userType: string
  source: string
  utm: string
  when: string
  url: string
}) {
  return send({
    from: `APRI System <${from}>`,
    to: MANAGER,
    replyTo: d.email,
    subject: `Verified APRI review request: ${d.name}`,
    html: `<h1>Verified review request</h1><p>Name: ${esc(d.name)}</p><p>Verified email: ${esc(d.email)}</p><p>Organisation: ${esc(d.organisation)}</p><p>Role: ${esc(d.role)}</p><p>User type: ${esc(d.userType)}</p><p>Lead source: ${esc(d.source)}</p><p>UTM: ${esc(d.utm)}</p><p>Verified: ${esc(d.when)} (Africa/Lagos)</p><p><a href="${esc(d.url)}">Open prospect record</a></p>`,
  })
}
export function sendReviewAccess(email: string, name: string, url: string) {
  return send({
    from: `APRI <${from}>`,
    to: email,
    subject: "Your APRI Complimentary Review access",
    html: `<p>Dear ${esc(name)},</p><p><a href="${esc(url)}">Access APRI Review Library</a></p><p>Access is personal, confidential and not for redistribution.</p>`,
  })
}
/**
 * Asks someone who requested a subscription from the public Subscription
 * Access page to confirm the address it was made with. Until they do, the
 * request cannot be activated: anyone could have typed their address.
 */
export function sendSubscriptionConfirmation(email: string, name: string, url: string) {
  return send({
    from: `APRI <${from}>`,
    to: email,
    subject: "Confirm your APRI subscription request",
    html: `<p>Dear ${esc(name)},</p><p>Please confirm your email address so APRI can prepare your subscription agreement and payment details.</p><p><a href="${esc(url)}">Confirm Email</a></p><p>If you did not request an APRI subscription, you can ignore this email.</p>`,
  })
}
export function sendSubscriptionMessages(d: {
  email: string
  name: string
  plan: string
  adminUrl: string
}) {
  return Promise.all([
    send({
      from: `APRI <${from}>`,
      to: d.email,
      subject: "Your APRI subscription request",
      html: `<p>Thank you for your APRI subscription request.</p><p>We will send your subscription agreement and payment details shortly. Your secure subscriber access will be activated once the agreement has been completed and payment confirmed.</p>`,
    }),
    send({
      from: `APRI System <${from}>`,
      to: MANAGER,
      replyTo: d.email,
      subject: `APRI ${d.plan} subscription request: ${d.name}`,
      html: `<p>${esc(d.name)} requested ${esc(d.plan)} Access.</p><p><a href="${esc(d.adminUrl)}">Open prospect record</a></p>`,
    }),
  ])
}

/**
 * The remembered Review Library's sign-in email: a link, and a code that signs
 * in whichever browser it is typed into (an email app may open the link in a
 * browser of its own). Sent only to an address assigned at least one
 * published edition, and only when that reader asks.
 */
export function sendReviewLibrarySignIn(email: string, url: string, code: string) {
  const spaced = `${code.slice(0, 4)} ${code.slice(4)}`
  return send({
    from: `APRI <${from}>`,
    to: email,
    subject: "Sign in to your APRI Review Library",
    html: `<p>Use the link below to open the APRI Complimentary Review Library on this browser. It works once and expires in 15 minutes.</p>
<p><a href="${esc(url)}">Open my Review Library</a></p>
<p>Reading on a different browser or device? On the Review Library sign-in page there, enter your email address and this code:</p>
<p style="font-family:'Courier New',Courier,monospace;font-size:24px;letter-spacing:4px;">${esc(spaced)}</p>
<p>Access is personal, confidential and not for redistribution. If you did not ask for this, you can ignore it.</p>`,
  })
}

/**
 * An approved reader's personal reading link. One click opens their own
 * Papermark room, where Papermark asks for its one-time code; every edition
 * assigned to them is then open for Papermark's session on that browser.
 */
export function sendReviewReadingLink(email: string, url: string) {
  return send({
    from: `APRI <${from}>`,
    to: email,
    subject: "Your APRI Complimentary Review Library",
    html: `<p>Use the link below to open your APRI Complimentary Review Library. It shows every edition issued to you.</p>
<p><a href="${esc(url)}">Open my Review Library</a></p>
<p>APRI's secure viewer will email you a one-time code to confirm your address. One code opens all your editions on that browser for about a day; after that, or on another browser or device, it asks for a fresh code.</p>
<p>This link is personal to you and works for 30 days. Access is confidential and not for redistribution.</p>`,
  })
}
