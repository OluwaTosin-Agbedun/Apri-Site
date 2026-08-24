'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { provisionCopy } from '@/app/actions/copies'
import { levelLabel } from '@/lib/entitlements'
import type { Level } from '@/lib/entitlements'
import type { FormState } from '@/lib/definitions'

export type ProvisionTarget = {
  subscriberId: string
  publicationId: string
  subscriberName: string
  organisation: string
  level: Level
  seats: number
  publicationTitle: string
  /** Generated names, computed on the server from both records. */
  names: {
    documentName: string
    linkName: string
    fileName: string
    copyId: string
  }
}

const field =
  'w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent'
const label =
  'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2'

/** A generated value the operator copies rather than types. */
function CopyField({ name, value }: { name: string; value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div>
      <span className={label}>{name}</span>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 border border-border bg-background p-3 text-xs text-foreground/80 break-all">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="shrink-0 border border-border px-3 text-xs font-medium text-foreground/70 hover:border-accent hover:text-foreground transition-colors cursor-pointer"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export default function ProvisionForm({ target }: { target: ProvisionTarget }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    provisionCopy,
    undefined
  )

  if (state?.ok) {
    return (
      <div className="border border-border bg-accent/5 p-8">
        <p className="font-serif text-foreground text-lg mb-2">Copy recorded</p>
        <p className="text-sm text-foreground/80 mb-6">{state.message}</p>
        <Link
          href="/admin/copies"
          className="inline-flex items-center bg-foreground text-background px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-foreground/90 transition-colors"
        >
          Back to the queue
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-8">
      {/*
        Who and what, stated first and large. A row saved against the wrong
        subscriber sends someone a document with another person's name stamped
        inside it, so the identity is the most prominent thing on the page.
      */}
      <div className="border-2 border-accent/40 bg-accent/5 p-6">
        <p className="text-xs font-medium uppercase tracking-wider text-accent mb-3">
          Provisioning for
        </p>
        <p className="font-serif text-2xl text-foreground leading-tight">
          {target.subscriberName || '(no name on record)'}
        </p>
        <p className="text-sm text-foreground/70 mt-1">
          {[target.organisation, levelLabel(target.level, target.seats)]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="font-serif text-lg text-foreground mt-4 pt-4 border-t border-accent/20">
          {target.names.documentName}
        </p>
      </div>

      <input type="hidden" name="subscriberId" value={target.subscriberId} />
      <input type="hidden" name="publicationId" value={target.publicationId} />

      <div className="border border-border bg-card/30 p-6 space-y-5">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-1">
            Step 1 — stamp and upload
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Stamp the PDF with these exact values, save it under this file name, upload it
            to Papermark, then create a link named as below and allow-listed to this one
            address. One address, set once — a second would show this subscriber another
            subscriber&rsquo;s name.
          </p>
        </div>

        <CopyField name="Copy ID (goes in the footer)" value={target.names.copyId} />
        <CopyField name="File name" value={target.names.fileName} />
        <CopyField name="Papermark link name" value={target.names.linkName} />
      </div>

      <div className="border border-border bg-card/30 p-6 space-y-5">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-1">
            Step 2 — record the link
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Set the custom domain on the link in Papermark before pasting it. A
            papermark.com address is refused here because it changes later and breaks
            silently.
          </p>
        </div>

        <div>
          <label htmlFor="linkUrl" className={label}>
            Link URL
          </label>
          <input
            id="linkUrl"
            name="linkUrl"
            type="url"
            required
            placeholder="https://docs.athenacentre.org/view/…"
            className={field}
          />
        </div>

        <div>
          <label htmlFor="papermarkLinkId" className={label}>
            Papermark link ID
          </label>
          <input
            id="papermarkLinkId"
            name="papermarkLinkId"
            type="text"
            required
            placeholder="cmt0fr2ks003yl804ms1f56su"
            className={field}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Needed to withdraw this link automatically when their term ends.
          </p>
        </div>
      </div>

      {state?.message && !state.ok && (
        <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-4 leading-relaxed">
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-4">
        <Link
          href="/admin/copies"
          className="px-4 py-2.5 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white px-6 py-2.5 text-sm font-medium tracking-wide hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
        >
          {pending ? 'Saving…' : 'Save copy'}
        </button>
      </div>
    </form>
  )
}
