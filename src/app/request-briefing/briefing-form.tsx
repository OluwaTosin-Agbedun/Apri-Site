'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { requestBriefing } from '@/app/actions/public'

const BRIEFING_TYPES = [
  'Board Political & Regulatory Risk Briefing',
  'Executive Political & Regulatory Briefing',
  'Strategy & Retreat Briefing',
  'Sector Political & Regulatory Risk Briefing',
  'Rapid Intelligence Briefing',
  'Not sure / request guidance',
]

const SECTORS = [
  'Financial services',
  'Telecoms and digital infrastructure',
  'Energy and power',
  'Oil and gas',
  'Manufacturing and consumer goods',
  'Infrastructure and government contracting',
  'Technology, data and digital regulation',
  'Other',
]

const field =
  'w-full border border-border bg-background p-3 text-sm focus:outline-none focus:border-accent'
const label =
  'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2'

export default function BriefingForm({ initialType }: { initialType?: string }) {
  const [state, action, pending] = useActionState(requestBriefing, undefined)

  if (state?.ok) {
    return (
      <div className="border border-border bg-accent/5 p-8 max-w-2xl">
        <p className="font-serif text-xl text-foreground mb-3">Request Received</p>
        <p className="text-sm text-foreground/80 leading-relaxed mb-8">{state.message}</p>
        <Link
          href="/services"
          className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover transition-colors"
        >
          Back to Services &amp; Briefings <span className="ml-2 opacity-70">&rarr;</span>
        </Link>
      </div>
    )
  }

  const err = (name: string) =>
    state?.errors?.[name] ? (
      <p className="mt-2 text-xs text-red-700">{state.errors[name][0]}</p>
    ) : null

  const defaultType =
    initialType && BRIEFING_TYPES.includes(initialType) ? initialType : ''

  return (
    <form action={action} className="border border-border bg-card/30 p-8 sm:p-10 max-w-2xl space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="name" className={label}>Name</label>
          <input id="name" name="name" type="text" required autoComplete="name" className={field} />
          {err('name')}
        </div>
        <div>
          <label htmlFor="organization" className={label}>Organisation</label>
          <input id="organization" name="organization" type="text" required autoComplete="organization" className={field} />
          {err('organization')}
        </div>
        <div>
          <label htmlFor="roleTitle" className={label}>Role / title</label>
          <input id="roleTitle" name="roleTitle" type="text" autoComplete="organization-title" className={field} />
          {err('roleTitle')}
        </div>
        <div>
          <label htmlFor="email" className={label}>Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" className={field} />
          {err('email')}
        </div>
        <div>
          <label htmlFor="phone" className={label}>Phone number</label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" className={field} />
          {err('phone')}
        </div>
        <div>
          <label htmlFor="audienceSize" className={label}>Audience size</label>
          <input id="audienceSize" name="audienceSize" type="text" className={field} />
          {err('audienceSize')}
        </div>
      </div>

      <div>
        <label htmlFor="briefingType" className={label}>Type of briefing requested</label>
        <select id="briefingType" name="briefingType" defaultValue={defaultType} className={field}>
          <option value="">Select a briefing…</option>
          {BRIEFING_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {err('briefingType')}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="format" className={label}>Mode of Briefing</label>
          <select id="format" name="format" className={field} defaultValue="">
            <option value="">Select…</option>
            <option value="Virtual">Virtual</option>
            <option value="In person">In person</option>
            <option value="Hybrid">Hybrid</option>
          </select>
          {err('format')}
        </div>
        <div>
          <label htmlFor="timeline" className={label}>Preferred date or timeline</label>
          <input id="timeline" name="timeline" type="text" className={field} />
          {err('timeline')}
        </div>
        <div>
          <label htmlFor="sector" className={label}>Sector</label>
          <select id="sector" name="sector" className={field} defaultValue="">
            <option value="">Select…</option>
            {SECTORS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {err('sector')}
        </div>
        <div>
          <label htmlFor="location" className={label}>Location, if in person</label>
          <input id="location" name="location" type="text" className={field} />
          {err('location')}
        </div>
      </div>

      <div>
        <label htmlFor="description" className={label}>
          Brief description of the issue or session
        </label>
        <textarea id="description" name="description" rows={5} className={field} />
        {err('description')}
      </div>

      {/*
        Sits above the button and gates it. The links open in a new tab so a
        reader can check the terms without losing what they have typed.
      */}
      <div className="pt-2">
        <label htmlFor="acceptedTerms" className="flex items-start gap-3 cursor-pointer">
          <input
            id="acceptedTerms"
            name="acceptedTerms"
            type="checkbox"
            value="on"
            required
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent cursor-pointer"
          />
          <span className="text-xs text-foreground/80 leading-relaxed">
            I accept the{' '}
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:text-accent-hover transition-colors"
            >
              terms of use
            </a>{' '}
            and the{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:text-accent-hover transition-colors"
            >
              privacy notice
            </a>
            .
          </span>
        </label>
        {err('acceptedTerms')}
      </div>

      {state?.message && !state.ok && (
        <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-3">
          {state.message}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="bg-foreground text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-foreground/90 disabled:opacity-50 transition-colors cursor-pointer"
        >
          {pending ? 'Submitting…' : 'Request a Briefing'}
        </button>
      </div>
    </form>
  )
}
