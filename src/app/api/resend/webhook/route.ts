import { NextResponse } from "next/server"
import { principalForResendEmail, recordClientEvent, type EngagementEventType } from "@/lib/client-engagement"
import { verifyResendWebhook } from "@/lib/resend-webhook"

const TYPES: Record<string, EngagementEventType> = {
  "email.sent":"signin_email_sent", "email.delivered":"email_delivered",
  "email.opened":"email_opened", "email.clicked":"email_clicked",
  "email.bounced":"email_bounced", "email.failed":"email_failed",
}

export async function POST(request: Request) {
  const body = await request.text()
  const verified = verifyResendWebhook(body, {
    id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  }, process.env.RESEND_WEBHOOK_SECRET)
  if (!verified) return NextResponse.json({error:"Invalid webhook signature."},{status:401})
  let event: {type?:string;created_at?:string;data?:{email_id?:string}}
  try { event = JSON.parse(body) } catch { return NextResponse.json({error:"Invalid payload."},{status:400}) }
  const type = event.type ? TYPES[event.type] : undefined
  const emailId = event.data?.email_id
  if (!type || !emailId) return NextResponse.json({ok:true})
  const principal = await principalForResendEmail(emailId)
  if (principal) await recordClientEvent(principal,type,{resendEmailId:emailId,
    webhookEventId:request.headers.get("svix-id")!,occurredAt:event.created_at?new Date(event.created_at):new Date()})
  return NextResponse.json({ok:true})
}
