import Link from "next/link"
import SiteHeader from "@/components/SiteHeader"
import SiteFooter from "@/components/SiteFooter"
export default function NotFound() {
  return <div className="min-h-screen bg-background"><SiteHeader /><main id="main-content" tabIndex={-1} className="max-w-3xl mx-auto px-6 py-20 space-y-6">
    <h1 className="font-serif text-3xl">Page not found</h1><p>The address may have changed or the page may no longer be available.</p>
    <div className="flex flex-wrap gap-4"><Link href="/" className="btn-primary">Go to homepage</Link><Link href="/publications" className="btn-secondary">Browse publications</Link></div><SiteFooter />
  </main></div>
}
