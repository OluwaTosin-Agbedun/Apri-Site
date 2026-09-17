import Link from "next/link"

export default function SiteFooter() {
  return (
    <footer className="pt-10 border-t border-hairline text-xs text-muted-foreground">
      <div className="mb-8 max-w-3xl">
        <p className="text-sm text-foreground/70 leading-relaxed mb-4">
          Athena Political &amp; Regulatory Intelligence is a service of the
          Athena Centre for Policy and Leadership.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-7">
          <p>
            APRI:{" "}
            <a
              href="https://apri.athenacentre.org/"
              className="text-foreground hover:text-accent transition-colors"
            >
              apri.athenacentre.org
            </a>
          </p>
          <p>
            Athena Centre:{" "}
            <a
              href="https://www.athenacentre.org/"
              className="text-foreground hover:text-accent transition-colors"
            >
              www.athenacentre.org
            </a>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-border/60">
        <p>
          &copy; {new Date().getFullYear()} Athena Centre. All rights reserved.
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
