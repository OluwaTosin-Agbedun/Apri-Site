'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/dal'
import { verifyAllowLists } from '@/lib/link-verification'
import type { FormState } from '@/lib/definitions'

/**
 * Runs the allow-list verification on demand.
 *
 * Admin-gated. The same function the daily job calls, so an on-demand run and a
 * scheduled one cannot disagree about what counts as a finding.
 */
export async function runLinkVerification(): Promise<FormState> {
  await requireAdmin()

  const summary = await verifyAllowLists()

  revalidatePath('/admin')
  revalidatePath('/admin/copies')
  revalidatePath('/admin/subscribers')

  if (summary.skipped === 'not-configured') {
    return {
      message:
        'No Papermark API token set, so links cannot be read back. Add PAPERMARK_API_TOKEN to check them.',
    }
  }

  if (summary.checked === 0) {
    return { ok: true, message: 'No live links to check yet.' }
  }

  if (summary.findings === 0) {
    return {
      ok: true,
      message: `${summary.checked} link${summary.checked === 1 ? '' : 's'} checked, all permitting exactly one address.`,
    }
  }

  return {
    message: `${summary.checked} checked — ${summary.findings} finding${summary.findings === 1 ? '' : 's'}. See above.`,
  }
}
