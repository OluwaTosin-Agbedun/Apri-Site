/**
 * The approved Complimentary Review recipient list — parsing and validation.
 *
 * Dependency-free so the rules are tested directly. The list itself is stored
 * as a single `app_settings` row (`review_approved_recipients`), which is why
 * no new table was needed: it is one owner-managed value, read server-side
 * only, and never sent to a browser or rendered on a public page.
 */

/**
 * Deliberately conservative. Not RFC 5322 — that grammar admits addresses no
 * mail system in practice accepts, and a permissive pattern here would let a
 * typo through into a Papermark allow list, where the failure shows up as a
 * prospect who cannot open a document and nobody knowing why.
 */
const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/** One address may not exceed this; the whole list is capped separately. */
const MAX_EMAIL_LENGTH = 254

/**
 * Papermark allow lists are not unbounded, and a runaway paste should be
 * refused here rather than rejected by the provider mid-apply, which would
 * leave some links updated and others not.
 */
export const MAX_RECIPIENTS = 500

export type RecipientParseResult = {
  /** Valid, trimmed, lower-cased, de-duplicated, in first-seen order. */
  emails: string[]
  /** Entries that were not valid addresses, as the owner typed them. */
  invalid: string[]
  /** How many duplicates were collapsed. */
  duplicates: number
}

/**
 * Parses a pasted recipient list.
 *
 * Accepts newlines, commas, semicolons and tabs as separators, because an
 * owner pasting from a spreadsheet or a mail client will produce any of them.
 */
export function parseRecipients(raw: string): RecipientParseResult {
  const emails: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  let duplicates = 0

  const parts = (raw ?? '')
    .split(/[\n\r,;\t]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  for (const part of parts) {
    // Tolerate a "Name <addr@example.org>" paste by taking the bracketed part.
    const bracketed = /<([^>]+)>/.exec(part)
    const candidate = (bracketed ? bracketed[1]! : part).trim().toLowerCase()

    if (!candidate) continue

    if (candidate.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(candidate)) {
      invalid.push(part)
      continue
    }

    if (seen.has(candidate)) {
      duplicates++
      continue
    }

    seen.add(candidate)
    emails.push(candidate)
  }

  return { emails, invalid, duplicates }
}

/** Whether a single address is acceptable. */
export function isValidRecipient(value: string): boolean {
  const e = (value ?? '').trim().toLowerCase()
  return e.length > 0 && e.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(e)
}

/** Serialises the list for the `app_settings` row. One address per line. */
export function serialiseRecipients(emails: string[]): string {
  return emails.join('\n')
}

/**
 * Reads the list back out of storage.
 *
 * Re-validated on read rather than trusted: the row could have been edited by
 * hand, and an invalid address reaching a Papermark allow list is exactly what
 * this module exists to prevent.
 */
export function deserialiseRecipients(value: string | null | undefined): string[] {
  return parseRecipients(value ?? '').emails
}

/**
 * Whether link provisioning may proceed.
 *
 * Fails closed. An empty approved list means no one is authorised, and the
 * correct response to that is to refuse to mint a link — not to mint one that
 * anybody who can verify any address may open.
 */
export function canProvisionLinks(emails: string[]): boolean {
  return emails.length > 0
}
