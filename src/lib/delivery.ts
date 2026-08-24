import 'server-only'

/**
 * How documents are delivered, and the one place that decides what we claim
 * about it.
 *
 * Every sentence the site or an email says about watermarking, tracking and
 * downloading comes from here. It used to be written out in five places, which
 * is how the site came to promise watermarking that was not switched on and
 * downloads that are deliberately disabled. A single source means the claim and
 * the behaviour cannot drift apart again.
 */

/**
 * Whether documents carry a per-person watermark.
 *
 * Off, because Papermark's dynamic watermark is not part of the current plan.
 * Read from the environment rather than stored in the database on purpose: it
 * describes what the provider can actually do, not an editorial preference, and
 * an admin toggle would let someone switch on a promise the plan cannot keep.
 *
 * Deliberately not NEXT_PUBLIC_ -- this module is server-only, and a client
 * bundle would read the variable as undefined and quietly claim `false`.
 *
 * To turn on: set WATERMARKING_ENABLED="true" and redeploy. Nothing else needs
 * editing; the wording and the link-minting call both follow this value.
 */
export const WATERMARKING_ENABLED = process.env.WATERMARKING_ENABLED === 'true'

/**
 * Whether readers may download rather than only view.
 *
 * A constant, not an environment variable: the decision is that documents are
 * view-only, and there is no download route or button anywhere in this
 * application. Made explicit so the copy below can state it plainly, and so
 * anyone tempted to add a download surface finds this note first.
 */
export const DOWNLOADS_ENABLED = false

/**
 * The public-facing access note, for /access and the home page.
 *
 * Says only what is true today: a named recipient, verified by email,
 * restricted to that person, logged, and view-only.
 */
export function accessNotice(): string {
  return (
    'Access is restricted to named individuals. Email verification is required ' +
    'before a document opens, every copy is individually identified to the ' +
    'person it was issued to, and every view is logged. Documents are ' +
    'view-only and must not be redistributed.'
  )
}

/** The note at the foot of a subscriber's own library. */
export function portalNotice(): string {
  const watermark = WATERMARKING_ENABLED
    ? 'Documents issued to you carry your name. '
    : ''

  return (
    watermark +
    'Your access is personal to you, verified by your email address, and every ' +
    'view is logged. Documents are view-only and licensed for your own use — ' +
    'please do not forward or redistribute them.'
  )
}

/** The one-line note in a subscriber email. */
export function emailNotice(): string {
  return WATERMARKING_ENABLED
    ? 'Issued to you as part of your APRI subscription and marked with your name. ' +
        'Your access is personal, view-only and logged; please do not forward it.'
    : 'Issued to you as part of your APRI subscription. Your access is personal to ' +
        'you, view-only and logged; please do not forward or redistribute it.'
}

/** A short label for the admin's delivery panel. */
export function deliverySummary(): {
  watermarking: 'on' | 'off'
  downloads: 'enabled' | 'disabled'
} {
  return {
    watermarking: WATERMARKING_ENABLED ? 'on' : 'off',
    downloads: DOWNLOADS_ENABLED ? 'enabled' : 'disabled',
  }
}
