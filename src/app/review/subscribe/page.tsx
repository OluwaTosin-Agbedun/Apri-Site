import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { readReviewSession } from "@/lib/review-security"
import SiteHeader from "@/components/SiteHeader"
import { PLANS, parsePlan } from "@/lib/subscription-journey"
import SubscriptionForm from "./subscription-form"
export const metadata: Metadata = {
  title: "Subscription request | APRI",
  robots: { index: false, follow: false },
}

/**
 * The request form for Individual and Professional Access.
 *
 * Reached from the Review Library by a prospect with a review session, and
 * from the public Subscription Access page by anyone. A visitor without a
 * session is shown the same form with their own contact details added --
 * never redirected to the review pages. An unknown plan goes back to
 * Subscription Access, which lists both.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const one = (key: string) => {
    const v = params[key]
    return (Array.isArray(v) ? v[0] : v)?.slice(0, 120) ?? ""
  }
  const plan = parsePlan(one("plan"))
  if (!plan) redirect("/access#plans")
  const prospectId = await readReviewSession()
  const utm = {
    source: one("utm_source"),
    medium: one("utm_medium"),
    campaign: one("utm_campaign"),
    term: one("utm_term"),
    content: one("utm_content"),
  }
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-6 py-20">
        <h1 className="font-serif text-4xl mb-4">Request {PLANS[plan].label}</h1>
        <p className="text-foreground/70 mb-10">
          Provide the contracting details APRI needs to prepare your agreement
          and invoice.
        </p>
        {prospectId ? (
          <SubscriptionForm mode="review" prospectId={prospectId} plan={plan} />
        ) : (
          <SubscriptionForm mode="public" plan={plan} utm={utm} />
        )}
      </main>
    </div>
  )
}
