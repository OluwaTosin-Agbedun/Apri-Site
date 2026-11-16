import { NextResponse } from "next/server"
import { principalForResendEmail, recordClientEvent, alreadyRecordedSent, type EngagementEventType } from "@/lib/client-engagement"
import { verifyResendWebhook } from "@/lib/resend-webhook"
import { applyReviewEmailEvent } from "@/lib/review-email-attempts"
import { DELIVERY_EVENT_TYPES, deliveryInboxReady, replayDeliveryEvent, saveVerifiedDeliveryEvent, type DeliveryEventType } from "@/lib/email-delivery-inbox"

const TYPES: Record<string, EngagementEventType> = {
  "email.sent":"signin_email_sent", "email.delivered":"email_delivered",
  "email.opened":"email_opened", "email.clicked":"email_clicked",
  "email.bounced":"email_bounced", "email.failed":"email_failed",
}

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 262144) return NextResponse.json({error:"Payload too large."},{status:413})
  const reader=request.body?.getReader()
  const chunks:Uint8Array[]=[]
  let size=0
  if (reader) {
    while (true) {
      const chunk=await reader.read()
      if (chunk.done) break
      size+=chunk.value.byteLength
      if (size>262144) { await reader.cancel(); return NextResponse.json({error:"Payload too large."},{status:413}) }
      chunks.push(chunk.value)
    }
  }
  let body:string
  try { body=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)) }
  catch { return NextResponse.json({error:"Invalid payload."},{status:400}) }
  const verified = verifyResendWebhook(body, {
    id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, process.env.RESEND_WEBHOOK_SECRET)
  if (!verified) return NextResponse.json({error:"Invalid webhook signature."},{status:401})
  let event: {type?:string;created_at?:string;data?:{email_id?:string}}
  try { event = JSON.parse(body); if (!event||typeof event!=="object"||Array.isArray(event)) throw new Error("Invalid payload") }
  catch { return NextResponse.json({error:"Invalid payload."},{status:400}) }
  const type = event.type ? TYPES[event.type] : undefined
  const emailId = event.data?.email_id
  if (emailId!==undefined && (typeof emailId!=="string"||!/^[A-Za-z0-9_-]{1,200}$/.test(emailId))) return NextResponse.json({error:"Invalid message id."},{status:400})
  const occurredAt = event.created_at ? new Date(event.created_at) : new Date()
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now()+300_000) return NextResponse.json({error:"Invalid event time."},{status:400})
  if (emailId && event.type && DELIVERY_EVENT_TYPES.includes(event.type as DeliveryEventType) && await deliveryInboxReady()) {
    try {
      await saveVerifiedDeliveryEvent({id:request.headers.get("svix-id") ?? "",messageId:emailId,type:event.type as DeliveryEventType,occurredAt})
      await replayDeliveryEvent(request.headers.get("svix-id") ?? "")
      return NextResponse.json({ok:true})
    } catch {
      // A retryable failure, never a success that discards delivery evidence.
      return NextResponse.json({error:"Delivery evidence could not be saved."},{status:503})
    }
  }
  // A Complimentary Review email: its delivery evidence goes to the owner-only
  // review email record (delivered, bounced, complained, delayed), never to a
  // subscriber.
  if (emailId && event.type && (await applyReviewEmailEvent(emailId, event.type, occurredAt))) {
    return NextResponse.json({ok:true})
  }
  if (!type || !emailId) return NextResponse.json({ok:true})
  const principal = await principalForResendEmail(emailId)
  // The welcome carries no sign-in link: its "sent" event is not a sign-in email.
  if (principal?.welcome && type === "signin_email_sent") return NextResponse.json({ok:true})
  // A sign-in email is recorded when the provider accepts it; the provider's
  // own "sent" event for it would be the same email a second time.
  if (type === "signin_email_sent" && principal && (await alreadyRecordedSent(emailId))) {
    return NextResponse.json({ok:true})
  }
  if (principal) await recordClientEvent({type:principal.type,id:principal.id},type,{resendEmailId:emailId,
    webhookEventId:request.headers.get("svix-id")!,occurredAt:event.created_at?new Date(event.created_at):new Date()})
  return NextResponse.json({ok:true})
}
