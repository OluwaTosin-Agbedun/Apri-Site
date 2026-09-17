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
