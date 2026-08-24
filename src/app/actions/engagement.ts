'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/dal'
import { setEngagementWindow } from '@/lib/engagement'
import type { FormState } from '@/lib/definitions'

/**
 * Changes how many recent editions the flag considers.
 *
 * Admin-gated like everything else touching engagement data. The value is
 * clamped in setEngagementWindow, so a crafted POST cannot store a window that
 * would make the query pathological.
 */
export async function updateEngagementWindow(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin()

  const raw = formData.get('window')
  const parsed = Number.parseInt(typeof raw === 'string' ? raw : '', 10)

  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 12) {
    return { message: 'Choose a number between 1 and 12.' }
  }

  await setEngagementWindow(parsed)
  revalidatePath('/admin/engagement')

  return {
    ok: true,
    message: `Now flagging subscribers who have opened none of the last ${parsed} editions.`,
  }
}
