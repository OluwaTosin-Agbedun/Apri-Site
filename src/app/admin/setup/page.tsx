import { redirect } from 'next/navigation'
import { isSetupComplete } from '@/lib/dal'
import SetupForm from './setup-form'

export const metadata = { title: 'Set up administrator · APRI' }

// Never cached: whether setup is open depends on live database state.
export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  // Server-side gate. Even with the URL, this page is unreachable once the
  // latch is set -- the check is here, not only in the proxy, because the
  // proxy is an optimisation and this is the actual boundary.
  if (await isSetupComplete()) redirect('/admin/login')

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-10">
          <p className="text-xs font-medium uppercase tracking-wider text-accent mb-3">
            One-time setup
          </p>
          <h1 className="font-serif text-2xl text-foreground mb-4 leading-tight">
            Create the owner account
          </h1>
          <p className="text-sm text-foreground/70 leading-relaxed">
            This screen is available once. After the owner account exists it
            closes permanently, and further administrators are invited from
            inside the CMS.
          </p>
        </div>

        <SetupForm />
      </div>
    </div>
  )
}
