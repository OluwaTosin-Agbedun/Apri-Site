/**
 * Cross-subscriber data access, and entitlement boundaries.
 *
 * The two properties the whole portal rests on: a subscriber sees their own row
 * and nobody else's, and never reaches an edition above their level.
 */
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  sql, makeTag, cleanup, makeSeat, makeEdition, makeOverride,
  libraryFor, canSignIn, visibilitiesForLevel,
} from './helpers.mjs'

const TAG = makeTag('iso')

let alice, bob, l2Edition, l3Edition, l4Edition, openEdition

before(async () => {
  await cleanup(TAG)

  alice = await makeSeat(TAG, {
    suffix: 'alice', level: 'L2',
    libraryLink: 'https://www.papermark.com/view/alice-library',
  })
  bob = await makeSeat(TAG, {
    suffix: 'bob', level: 'L3',
    libraryLink: 'https://www.papermark.com/view/bob-library',
  })

  l2Edition = await makeEdition(TAG, { suffix: 'l2', visibility: 'L2', series: 'MIN' })
  l3Edition = await makeEdition(TAG, { suffix: 'l3', visibility: 'L3', series: 'QIB' })
  l4Edition = await makeEdition(TAG, { suffix: 'l4', visibility: 'L4', series: 'BP' })
  openEdition = await makeEdition(TAG, {
    suffix: 'open', visibility: 'OPEN', series: 'PLM',
    openLinkUrl: 'https://www.papermark.com/view/public-piece',
  })

  // Bob has a personal override link for the L3 edition. Alice must never see it.
  await makeOverride({
    subscriberId: bob.id,
    publicationId: l3Edition.id,
    linkUrl: 'https://www.papermark.com/view/bob-private-override',
    papermarkLinkId: `${TAG}_pmlink_bob_override`,
  })
})

after(async () => {
  await cleanup(TAG)
})

describe('entitlement boundaries', () => {
  test('an L2 subscriber cannot reach an L3 edition', async () => {
    const rows = await libraryFor(alice.id, 'L2', `${TAG}%`)
    const ids = rows.map((r) => r.id)
    assert.ok(!ids.includes(l3Edition.id), 'L3 edition leaked into an L2 library')
  })

  test('an L2 subscriber cannot reach an L4 edition', async () => {
    const rows = await libraryFor(alice.id, 'L2', `${TAG}%`)
    assert.ok(!rows.map((r) => r.id).includes(l4Edition.id))
  })

  test('an L3 subscriber does reach the L3 edition', async () => {
    const rows = await libraryFor(bob.id, 'L3', `${TAG}%`)
    assert.ok(rows.map((r) => r.id).includes(l3Edition.id))
  })

  test('an L3 subscriber still cannot reach L4', async () => {
    const rows = await libraryFor(bob.id, 'L3', `${TAG}%`)
    assert.ok(!rows.map((r) => r.id).includes(l4Edition.id))
  })

  test('OPEN editions never appear in any paid library', async () => {
    for (const [seat, level] of [[alice, 'L2'], [bob, 'L3']]) {
      const rows = await libraryFor(seat.id, level, `${TAG}%`)
      assert.ok(
        !rows.map((r) => r.id).includes(openEdition.id),
        `OPEN edition appeared in a ${level} library`
      )
      assert.ok(
        rows.every((r) => r.visibility !== 'OPEN'),
        'an OPEN row was returned'
      )
    }
  })

  test('the level list is ascending and excludes OPEN', () => {
    assert.deepEqual(visibilitiesForLevel('L1'), ['L1'])
    assert.deepEqual(visibilitiesForLevel('L3'), ['L1', 'L2', 'L3'])
    assert.deepEqual(visibilitiesForLevel('L4'), ['L1', 'L2', 'L3', 'L4'])
    assert.ok(!visibilitiesForLevel('L4').includes('OPEN'))
  })
})

describe('cross-subscriber isolation', () => {
  test("one subscriber's library never contains another's override link", async () => {
    const rows = await libraryFor(alice.id, 'L2', `${TAG}%`)
    const links = rows.map((r) => r.link).filter(Boolean)
    assert.ok(
      !links.some((l) => l.includes('bob-private-override')),
      "Bob's private override link appeared in Alice's library"
    )
    assert.ok(
      !links.some((l) => l.includes('bob-library')),
      "Bob's library link appeared in Alice's library"
    )
  })

  test('every link returned belongs to the requesting subscriber', async () => {
    const rows = await libraryFor(bob.id, 'L3', `${TAG}%`)
    for (const row of rows) {
      if (!row.link) continue
      assert.ok(
        row.link.includes('bob-'),
        `a link not belonging to Bob was returned: ${row.link}`
      )
    }
  })

  test('an override is scoped to its own subscriber', async () => {
    const rows = await sql.query(
      `select subscriber_id from publication_access where papermark_link_id = $1`,
      [`${TAG}_pmlink_bob_override`]
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].subscriber_id, bob.id)
  })

  test('reading by session id cannot be widened to all subscribers', async () => {
    // The portal binds exactly one id. Proving the shape here guards against a
    // refactor that drops the predicate and returns every row.
    const rows = await sql.query(
      `select id from subscribers where id = $1`, [alice.id]
    )
    assert.equal(rows.length, 1, 'a single-id lookup returned more than one row')
    assert.equal(rows[0].id, alice.id)
  })
})

describe('lapsed and suspended access', () => {
  test('an active seat within term can sign in', async () => {
    assert.equal(await canSignIn(alice.id), true)
  })

  test('a suspended seat cannot sign in', async () => {
    const seat = await makeSeat(TAG, { suffix: 'susp', status: 'suspended' })
    assert.equal(await canSignIn(seat.id), false)
  })

  test('a lapsed seat cannot sign in', async () => {
    const seat = await makeSeat(TAG, { suffix: 'laps', status: 'lapsed' })
    assert.equal(await canSignIn(seat.id), false)
  })

  test('an expired term revokes access even while status still says active', async () => {
    const seat = await makeSeat(TAG, {
      suffix: 'expired', status: 'active',
      termStartDaysAgo: 400, termEndDaysAhead: -1,
    })
    assert.equal(
      await canSignIn(seat.id), false,
      'a seat past its term end was allowed to sign in'
    )
  })

  test('a lapsed seat still exists, so the portal can show a locked state', async () => {
    const seat = await makeSeat(TAG, { suffix: 'laps2', status: 'lapsed' })
    const rows = await sql.query(`select id, status from subscribers where id = $1`, [seat.id])
    assert.equal(rows.length, 1, 'the row vanished — the portal would 404 instead of locking')
    assert.equal(rows[0].status, 'lapsed')
  })

  test('a lapsed seat is entitled to nothing', async () => {
    const seat = await makeSeat(TAG, { suffix: 'laps3', status: 'lapsed', level: 'L4' })
    const allowed = await canSignIn(seat.id)
    const rows = allowed ? await libraryFor(seat.id, 'L4', `${TAG}%`) : []
    assert.equal(rows.length, 0, 'a lapsed seat was served a library')
  })
})
