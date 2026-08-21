import { redirect } from 'next/navigation'
import { getCurrentAdmin, isSetupComplete } from '@/lib/dal'
import LoginForm from './login-form'

export const metadata = { title: 'Sign in · APRI' }
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  // Before the owner account exists there is nothing to sign in to.
  if (!(await isSetupComplete())) redirect('/admin/setup')
  if (await getCurrentAdmin()) redirect('/admin')

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <h1 className="font-serif text-2xl text-foreground mb-3 tracking-tight">APRI</h1>
          <p className="text-sm text-foreground/70">
            Sign in to the intelligence platform.
          </p>
        </div>

        <LoginForm />
      </div>
    </div>
  )
}
