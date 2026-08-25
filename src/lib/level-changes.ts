import 'server-only'
import { getSql } from './db'
import { visibilitiesForLevel, isLevel, type Level } from './entitlements'

/**
 * What happens when a subscriber's level changes.
 *
 * Both directions have a consequence, and only one of them is automatic:
 *
 * An upgrade widens what they may read. The copies queue is computed on read,
 * so it picks the new editions up on its own -- bounded by the back-catalogue
 * boundary, so a widening does not summon years of editions at once.
 *
 * A downgrade narrows it. The library shrinks immediately, because the level
 * filter no longer matches those editions -- but the *links already issued*
 * keep working, and each one carries the reader's name. Nothing else notices
 * them, so they are marked for revocation here.
 */

export type LevelChangeOutcome = {
  direction: 'upgrade' | 'downgrade' | 'set' | 'cleared' | 'none'
  /** Links marked for withdrawal because the new level no longer covers them. */
  revocationsQueued: number
}

function rank(level: Level): number {
  return { L1: 1, L2: 2, L3: 3, L4: 4 }[level]
}

function directionOf(
  oldLevel: Level | null,
  newLevel: Level | null
): LevelChangeOutcome['direction'] {
  if (oldLevel === newLevel) return 'none'
  if (!oldLevel && newLevel) return 'set'
  if (oldLevel && !newLevel) return 'cleared'
  if (oldLevel && newLevel) {
    return rank(newLevel) > rank(oldLevel) ? 'upgrade' : 'downgrade'
  }
  return 'none'
}

/**
 * Applies the consequences of a level change and records it.
 *
 * Called after the subscriber row has been written, so the new level is already
 * in place and the queue recomputes from it.
 */
export async function applyLevelChange(args: {
  subscriberId: string
  subscriberEmail: string
  oldLevel: string | null
  newLevel: string | null
  changedById: string
  changedByName: string
}): Promise<LevelChangeOutcome> {
  const oldLevel = isLevel(args.oldLevel) ? args.oldLevel : null
  const newLevel = isLevel(args.newLevel) ? args.newLevel : null
  const direction = directionOf(oldLevel, newLevel)

  if (direction === 'none') return { direction: 'none', revocationsQueued: 0 }

  const sql = getSql()
  let revocationsQueued = 0

  // Narrowing, or removing the level entirely, leaves live links to editions
  // the subscriber may no longer read. Marked manual_required rather than
  // revoked outright: withdrawing a Papermark link is an API call that may
  // fail, and the queue is what makes sure a failure is seen rather than lost.
  if (direction === 'downgrade' || direction === 'cleared') {
    const stillAllowed = newLevel ? visibilitiesForLevel(newLevel) : []

    const affected = (await sql.query(
      `update publication_access pa
       set revoke_state = 'manual_required',
           revoked_at   = now(),
           updated_at   = now()
       from documents d
       where d.id = pa.publication_id
         and pa.subscriber_id = $1
         and pa.revoke_state = 'live'
         -- A shared or open publication is not level-gated, so a narrowing
         -- does not take it away.
         and d.is_shared_copy = false
         and d.visibility <> 'OPEN'
         and not (d.visibility = any($2::text[]))
       returning pa.id`,
      [args.subscriberId, stillAllowed]
    )) as { id: string }[]

    revocationsQueued = affected.length
  }

  // Recorded whichever way it went. A level change moves money and moves
  // access, so "who did this, and when" should not have to be reconstructed.
  await sql`
    insert into level_changes (
      subscriber_id, subscriber_email, old_level, new_level,
      direction, changed_by, changed_by_name
    ) values (
      ${args.subscriberId}, ${args.subscriberEmail}, ${oldLevel}, ${newLevel},
      ${direction}, ${args.changedById}, ${args.changedByName}
    )
  `

  return { direction, revocationsQueued }
}

export type LevelChangeRecord = {
  id: string
  subscriberEmail: string
  oldLevel: string | null
  newLevel: string | null
  direction: string
  changedByName: string
  createdAt: string
}

/** The change history for one subscriber, newest first. */
export async function getLevelHistory(
  subscriberId: string,
  limit = 10
): Promise<LevelChangeRecord[]> {
  const sql = getSql()
  const rows = (await sql`
    select id, subscriber_email, old_level, new_level, direction,
           changed_by_name, created_at
    from level_changes
    where subscriber_id = ${subscriberId}
    order by created_at desc
    limit ${limit}
  `) as {
    id: string
    subscriber_email: string
    old_level: string | null
    new_level: string | null
    direction: string
    changed_by_name: string
    created_at: string | Date
  }[]

  return rows.map((r) => ({
    id: r.id,
    subscriberEmail: r.subscriber_email,
    oldLevel: r.old_level,
    newLevel: r.new_level,
    direction: r.direction,
    changedByName: r.changed_by_name,
    createdAt: new Date(r.created_at).toISOString(),
  }))
}
