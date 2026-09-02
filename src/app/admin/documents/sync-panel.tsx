'use client'

import Link from 'next/link'

export default function SyncPanel() {
  return (
    <div className="border border-border bg-card/30 p-6 mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-serif text-lg text-foreground mb-2">
            Complimentary Review Library
          </h3>
          <p className="text-sm text-foreground/70 max-w-xl leading-relaxed">
            Complimentary review documents are managed through the Review Library.
            Use the Review Library page to sync documents from the Papermark Data
            Room, map files to review cards, and approve new editions.
          </p>
        </div>
        <Link
          href="/admin/review-library"
          className="bg-foreground text-background px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors shrink-0"
        >
          Sync Complimentary Review Library
        </Link>
      </div>
    </div>
  )
}
