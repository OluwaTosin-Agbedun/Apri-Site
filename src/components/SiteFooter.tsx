import Link from 'next/link'

export default function SiteFooter() {
  return (
    <footer className="pt-8 border-t border-border/40 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p>&copy; {new Date().getFullYear()} Athena Centre. All rights reserved.</p>

        <nav className="flex items-center gap-5">
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms of use
          </Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy
          </Link>
          <span className="w-2 h-2 bg-accent/40 rounded-full" aria-hidden="true" />
        </nav>
      </div>
    </footer>
  )
}
