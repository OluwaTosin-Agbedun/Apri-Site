import Link from "next/link"
import SiteHeader from "@/components/SiteHeader"
import SiteFooter from "@/components/SiteFooter"
import { requireSubscriber } from "@/lib/subscriber-dal"
import { getSql } from "@/lib/db"
import { noticeSchemaReady } from "@/lib/publication-notifications"
import PreferenceForm from "./preference-form"
export const dynamic = "force-dynamic"
export const metadata = {
  title: "Publication email preferences | APRI",
  robots: { index: false, follow: false },
}
export default async function PreferencePage() {
  const reader = await requireSubscriber()
  const ready = await noticeSchemaReady()
  const [preference] = ready
    ? await getSql()`select enabled from publication_notice_preferences where subscriber_id=${reader.id}::uuid`
    : []
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className="max-w-2xl mx-auto px-6 py-16 space-y-6"
      >
        <h1 className="font-serif text-3xl">Publication emails</h1>
        <p>
          Choose whether to receive publication updates. This does not change
          your library access, sign-in emails or essential account messages.
        </p>
        {ready ? (
          <PreferenceForm enabled={preference?.enabled !== false} />
        ) : (
          <p>
            Email preferences are being prepared. Your existing access remains
            available.
          </p>
        )}
        <Link
          className="inline-flex min-h-11 items-center underline"
          href="/portal"
        >
          Return to my library
        </Link>
        <SiteFooter />
      </main>
    </div>
  )
}
