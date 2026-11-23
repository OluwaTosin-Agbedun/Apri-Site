import Link from "next/link"
import { siteOrigin } from "@/lib/site-config"

export default function SiteFooter() {
  return (
    <footer className="pt-10 border-t border-hairline text-xs text-muted-foreground">
      <div className="mb-8 max-w-3xl">
        <p>
          Athena Strategic Advisory<br />Political &amp; Regulatory Intelligence<br />{" "}
          <a
            href={siteOrigin()}
            className="text-foreground hover:text-accent transition-colors"
          >
            {new URL(siteOrigin()).hostname}
          </a>
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-border/60">
        <p>
          &copy; {new Date().getFullYear()} Athena Strategic Advisory
        </p>

        <nav
          className="flex flex-wrap items-center gap-5"
          aria-label="Footer navigation"
        >
          <Link
            href="/team"
            className="hover:text-foreground transition-colors"
          >
            Our Intelligence Team
          </Link>
          <Link
            href="/terms"
            className="hover:text-foreground transition-colors"
          >
            Terms of use
          </Link>
          <Link
            href="/privacy"
            className="hover:text-foreground transition-colors"
          >
            Privacy
          </Link>
          <span
            className="w-2 h-2 bg-accent/40 rounded-full"
            aria-hidden="true"
          />
        </nav>
      </div>
    </footer>
  )
}
