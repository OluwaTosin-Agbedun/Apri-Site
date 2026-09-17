import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { readReviewSession } from "@/lib/review-security"
import SiteHeader from "@/components/SiteHeader"
import SubscriptionForm from "./subscription-form"
export const metadata: Metadata = {
  title: "Subscription request | APRI",
  robots: { index: false, follow: false },
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>
}) {
  const id = await readReviewSession()
  if (!id) redirect("/review")
  const raw = (await searchParams).plan
  const plan = raw === "Individual" || raw === "Professional" ? raw : null
  if (!plan) redirect("/review/library")
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-6 py-20">
        <h1 className="font-serif text-4xl mb-4">Request {plan} Access</h1>
        <p className="text-foreground/70 mb-10">
          Provide the contracting details APRI needs to prepare your agreement
          and invoice.
        </p>
        <SubscriptionForm prospectId={id} plan={plan} />
      </main>
    </div>
  )
}
