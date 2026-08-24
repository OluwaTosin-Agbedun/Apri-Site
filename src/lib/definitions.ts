import * as z from 'zod'
import { SERIES_CODES, VISIBILITIES } from './entitlements'

/**
 * Every value that crosses the trust boundary is narrowed here before it
 * reaches a query. Lengths are capped so an attacker cannot post megabytes of
 * text into a column and turn the CMS into a storage bill.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .pipe(z.email({ error: 'Enter a valid email address.' }))

const password = z
  .string()
  .min(12, { error: 'Use at least 12 characters.' })
  .max(200, { error: 'That password is too long.' })
  .regex(/[a-z]/, { error: 'Include a lower-case letter.' })
  .regex(/[A-Z]/, { error: 'Include an upper-case letter.' })
  .regex(/[0-9]/, { error: 'Include a number.' })

export const SetupSchema = z
  .object({
    name: z.string().trim().min(2, { error: 'Enter your full name.' }).max(120),
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    error: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

export const LoginSchema = z.object({
  // Deliberately loose: login must not leak which addresses are valid, and
  // strict rules here would reject a legitimate legacy address.
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
})

export const InviteAdminSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  password,
  role: z.enum(['owner', 'editor']),
})

export const SubscriberSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter your full name.' }).max(160),
  organization: z.string().trim().min(1, { error: 'Enter your organisation.' }).max(200),
  email,
  // Required, per the brief: a phone number is how we reach a board member
  // within one business day.
  phone: z
    .string()
    .trim()
    .min(7, { error: 'Enter a phone number we can reach you on.' })
    .max(40),
  roleTitle: z.string().trim().max(160).default(''),
  // The public tier name the visitor chose. The internal level is derived from
  // it on the server, never accepted from the form.
  subscriptionLevel: z.string().trim().max(120).default(''),
  note: z.string().trim().max(600).default(''),
})

export const DocumentSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, { error: 'Use lower-case letters, numbers and hyphens only.' }),
  sectionLabel: z.string().trim().max(120).default(''),
  kicker: z.string().trim().max(200).default(''),
  title: z.string().trim().min(1, { error: 'A title is required.' }).max(250),
  strapline: z.string().trim().max(250).default(''),
  productLine: z.string().trim().max(160).default(''),
  description: z.string().trim().max(2000).default(''),
  frequency: z.string().trim().max(120).default(''),
  audience: z.string().trim().max(600).default(''),
  attribution: z.string().trim().max(400).default(''),
  ctaLabel: z.string().trim().min(1).max(80),
  ctaMode: z.enum(['link', 'request']),
  // Rejects javascript: and data: URLs, which would otherwise be a stored-XSS
  // vector the moment an admin pasted one into the link field.
  papermarkLink: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .max(500)
        .pipe(z.url({ protocol: /^https$/, error: 'Must be an https:// URL.' })),
    ])
    .default(''),
  coverageAreas: z.string().trim().max(4000).default(''),
  // Edition identity and audience.
  code: z.string().trim().max(60).default(''),
  series: z.enum(SERIES_CODES as [string, ...string[]]).or(z.literal('')).default(''),
  summary: z.string().trim().max(600).default(''),
  editionDate: z.union([z.literal(''), z.string().trim().max(10)]).default(''),
  // Who may read it. Validated against the literal list, never trusted from the
  // form, because this value alone decides whether a paid document is public.
  visibility: z.enum(VISIBILITIES).default('L4'),
  openLinkUrl: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .max(500)
        .pipe(z.url({ protocol: /^https$/, error: 'Must be an https:// URL.' })),
    ])
    .default(''),
  pageCount: z
    .union([z.literal(''), z.coerce.number().int().min(1).max(2000)])
    .default(''),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isPublished: z.coerce.boolean().default(true),
})

export const BriefingRequestSchema = z.object({
  name: z.string().trim().min(1, { error: 'Enter your full name.' }).max(160),
  organization: z.string().trim().min(1, { error: 'Enter your organisation.' }).max(200),
  roleTitle: z.string().trim().max(160).default(''),
  email,
  phone: z.string().trim().max(60).default(''),
  briefingType: z.string().trim().max(120).default(''),
  format: z.string().trim().max(60).default(''),
  timeline: z.string().trim().max(160).default(''),
  sector: z.string().trim().max(160).default(''),
  description: z.string().trim().max(4000).default(''),
  audienceSize: z.string().trim().max(60).default(''),
  location: z.string().trim().max(200).default(''),
})

export type FormState =
  | { errors?: Record<string, string[]>; message?: string; ok?: boolean }
  | undefined

/**
 * Collapses a ZodError into { fieldName: [messages] } for form rendering.
 *
 * Zod v4 types issue.path as PropertyKey[], which can include symbols, so the
 * first segment is narrowed rather than cast. Anything unusable is grouped
 * under '_' instead of being dropped silently.
 */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const head = issue.path[0]
    const key =
      typeof head === 'string' || typeof head === 'number' ? String(head) : '_'
    ;(out[key] ??= []).push(issue.message)
  }
  return out
}
