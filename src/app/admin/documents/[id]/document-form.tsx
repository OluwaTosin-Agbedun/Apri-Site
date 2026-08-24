'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { saveDocument } from '@/app/actions/documents'
import { PUBLICATION_SECTIONS } from '@/lib/sections'
import { SERIES, SERIES_CODES, visibilityLabel, VISIBILITIES } from '@/lib/entitlements'
import type { FormState } from '@/lib/definitions'

export type DocumentDraft = {
  id: string | null
  slug: string
  sectionLabel: string
  kicker: string
  title: string
  strapline: string
  productLine: string
  description: string
  frequency: string
  audience: string
  attribution: string
  ctaLabel: string
  ctaMode: string
  coverageAreas: string
  code: string
  series: string
  summary: string
  editionDate: string
  visibility: string
  openLinkUrl: string
  pageCount: string
  papermarkLink: string
  sortOrder: number
  status: string
}

const field =
  'w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent'
const label =
  'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2'

export default function DocumentForm({ draft }: { draft: DocumentDraft }) {
  const action = saveDocument.bind(null, draft.id)
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    undefined
  )

  const err = (name: string) =>
    state?.errors?.[name] ? (
      <p className="mt-2 text-xs text-red-700">{state.errors[name][0]}</p>
    ) : null

  return (
    <form action={formAction} className="border border-border bg-card/30 p-8 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="title" className={label}>Title</label>
          <input id="title" name="title" defaultValue={draft.title} required className={field} />
          {err('title')}
        </div>
        <div>
          <label htmlFor="slug" className={label}>Web address (slug)</label>
          <input id="slug" name="slug" defaultValue={draft.slug} required className={field} />
          {err('slug')}
        </div>
        <div>
          <label htmlFor="kicker" className={label}>Subtitle / issue</label>
          <input id="kicker" name="kicker" defaultValue={draft.kicker} className={field} placeholder="Monthly Intelligence Note · August 2026" />
          {err('kicker')}
        </div>
        <div>
          <label htmlFor="strapline" className={label}>Strapline</label>
          <input id="strapline" name="strapline" defaultValue={draft.strapline} className={field} />
          {err('strapline')}
        </div>
        <div>
          <label htmlFor="sectionLabel" className={label}>Category</label>
          <select id="sectionLabel" name="sectionLabel" defaultValue={draft.sectionLabel} className={field}>
            <option value="">Unassigned</option>
            {PUBLICATION_SECTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {err('sectionLabel')}
        </div>
        <div>
          <label htmlFor="productLine" className={label}>Product line</label>
          <input id="productLine" name="productLine" defaultValue={draft.productLine} className={field} placeholder="Monthly Intelligence Note" />
          {err('productLine')}
        </div>
        <div>
          <label htmlFor="frequency" className={label}>Frequency</label>
          <input id="frequency" name="frequency" defaultValue={draft.frequency} className={field} />
          {err('frequency')}
        </div>
        <div>
          <label htmlFor="sortOrder" className={label}>Display order</label>
          <input id="sortOrder" name="sortOrder" type="number" min={0} defaultValue={draft.sortOrder} className={field} />
          {err('sortOrder')}
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">
          This edition
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label htmlFor="series" className={label}>Series</label>
            <select id="series" name="series" defaultValue={draft.series} className={field}>
              <option value="">Unassigned</option>
              {SERIES_CODES.map((code) => (
                <option key={code} value={code}>{SERIES[code]}</option>
              ))}
            </select>
            {err('series')}
          </div>
          <div>
            <label htmlFor="code" className={label}>Edition code</label>
            <input id="code" name="code" defaultValue={draft.code} className={field} placeholder="APRI-MIN-2026-08" />
            <p className="mt-2 text-xs text-muted-foreground">
              Must be unique. Leave blank if this edition has no code yet.
            </p>
            {err('code')}
          </div>
          <div>
            <label htmlFor="editionDate" className={label}>Edition date</label>
            <input id="editionDate" name="editionDate" type="date" defaultValue={draft.editionDate} className={field} />
            <p className="mt-2 text-xs text-muted-foreground">
              Orders the subscriber library, newest first.
            </p>
            {err('editionDate')}
          </div>
          <div>
            <label htmlFor="pageCount" className={label}>Pages</label>
            <input id="pageCount" name="pageCount" type="number" min={1} defaultValue={draft.pageCount} className={field} />
            {err('pageCount')}
          </div>
        </div>

        <div className="mt-6">
          <label htmlFor="summary" className={label}>One-line summary</label>
          <textarea id="summary" name="summary" rows={2} defaultValue={draft.summary} className={field} />
          <p className="mt-2 text-xs text-muted-foreground">
            Shown under the title in the subscriber library and in the alert email.
          </p>
          {err('summary')}
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <h3 className="text-xs font-medium uppercase tracking-wider text-accent mb-5">
          Who may read it
        </h3>

        <div>
          <label htmlFor="visibility" className={label}>Audience</label>
          <select id="visibility" name="visibility" defaultValue={draft.visibility || 'L4'} className={field}>
            {/*
              VISIBILITIES is OPEN then L1..L4, so the order is never
              alphabetical. Labels come from the shared lookup rather than the
              public accessBadge wording, which is written for visitors.
            */}
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {visibilityLabel(v)}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            A subscriber sees every edition at or below their own level. Open editions are
            public and never appear in a paid library.
          </p>
          {err('visibility')}
        </div>

        <div className="mt-6">
          <label htmlFor="openLinkUrl" className={label}>
            Public link (open editions only)
          </label>
          <input
            id="openLinkUrl"
            name="openLinkUrl"
            type="url"
            defaultValue={draft.openLinkUrl}
            className={field}
            placeholder="https://www.papermark.com/view/…"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            The email-gated Papermark link used when the audience is Open. Required before
            an open edition can be published. Leave blank for subscriber editions.
          </p>
          {err('openLinkUrl')}
        </div>
      </div>

      <div>
        <label htmlFor="description" className={label}>Description</label>
        <textarea id="description" name="description" rows={4} defaultValue={draft.description} className={field} />
        {err('description')}
      </div>

      <div>
        <label htmlFor="audience" className={label}>Audience</label>
        <textarea id="audience" name="audience" rows={2} defaultValue={draft.audience} className={field} />
        {err('audience')}
      </div>

      <div>
        <label htmlFor="coverageAreas" className={label}>Coverage areas</label>
        <textarea id="coverageAreas" name="coverageAreas" rows={5} defaultValue={draft.coverageAreas} className={field} placeholder={"One area per line, e.g.\nPolitical Events & Developments\nRegulatory & Policy Shifts"} />
        <p className="mt-2 text-xs text-muted-foreground">
          One area per line. Shown as a bullet list on the publication detail page.
        </p>
        {err('coverageAreas')}
      </div>

      <div>
        <label htmlFor="attribution" className={label}>Attribution note</label>
        <input id="attribution" name="attribution" defaultValue={draft.attribution} className={field} placeholder="An Athena Election Observatory publication included in APRI subscriber access." />
        {err('attribution')}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2 border-t border-border">
        <div>
          <label htmlFor="ctaLabel" className={label}>Button text</label>
          <input id="ctaLabel" name="ctaLabel" defaultValue={draft.ctaLabel} required className={field} />
          {err('ctaLabel')}
        </div>
        <div>
          <label htmlFor="ctaMode" className={label}>Button behaviour</label>
          <select id="ctaMode" name="ctaMode" defaultValue={draft.ctaMode} className={field}>
            <option value="link">Open the secure link</option>
            <option value="request">Send to Subscription Access</option>
          </select>
          {err('ctaMode')}
        </div>
      </div>

      <div>
        <label htmlFor="papermarkLink" className={label}>
          Reference link (internal)
        </label>
        <input id="papermarkLink" name="papermarkLink" type="url" defaultValue={draft.papermarkLink} className={field} placeholder="https://www.papermark.com/view/…" />
        <p className="mt-2 text-xs text-muted-foreground">
          Kept for reference and for the Papermark sync. Never shown on the public site:
          subscribers open editions through the link on their own record, and open editions
          use the public link above.
        </p>
        {err('papermarkLink')}
      </div>

      {state?.message && (
        <p
          className={`text-sm p-3 border ${
            state.ok
              ? 'text-foreground border-border bg-accent/5'
              : 'text-red-700 border-red-200 bg-red-50'
          }`}
        >
          {state.message}
        </p>
      )}

      <div className="flex justify-end gap-4 pt-4 border-t border-border">
        <Link
          href="/admin/documents"
          className="px-4 py-2 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
        >
          Back
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-white px-6 py-2 text-sm font-medium tracking-wide hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
