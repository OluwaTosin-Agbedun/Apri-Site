/**
 * The engagement flag, and the rules that stop it crying wolf.
 *
 * A false flag is worse than no flag: it opens a renewal conversation on bad
 * data. Each rule below exists because without it a perfectly engaged
 * subscriber would be reported as silent.
 */
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  sql, makeTag, cleanup, makeSeat, makeEdition, makeView,
  visibilitiesForLevel, asDateParam, REGULAR_SERIES,
} from './helpers.mjs'

const TAG = makeTag('eng')
const WINDOW = 2

/**
 * The engagement calculation as src/lib/engagement.ts implements it.
 *
 * `scope` narrows the edition pool to one test's own fixtures. Every test in
 * this file shares a database, so without it the editions created by an earlier
 * test fall inside a later test's window and the assertions measure the wrong
 * thing.
 */
async function evaluate(subscriberId, scope) {
  if (!scope) throw new Error('evaluate() needs a fixture scope')

  const [s] = await sql.query(
    `select level, seats, term_start, status from subscribers where id = $1`,
    [subscriberId]
  )
  if (!s) return { missing: true }
  if (s.status.toLowerCase() !== 'active') return { skipped: 'not-active' }
  if (!s.level) return { considered: 0, opened: 0, flagged: false }

  const editions = await sql.query(
    `select d.id from documents d
     where d.status = 'published'
       and d.visibility = any($1::text[])
       and d.series = any($2::text[])
       and d.slug like $5
       and ($3::date is null
            or coalesce(d.edition_date, d.published_at::date, d.created_at::date) >= $3::date)
     order by coalesce(d.edition_date, d.published_at::date, d.created_at::date) desc,
              d.created_at desc
     limit $4`,
    [visibilitiesForLevel(s.level), REGULAR_SERIES, asDateParam(s.term_start), WINDOW,
     `${TAG}_ed_${scope}%`]
  )

  let opened = 0
  if (editions.length) {
    const [o] = await sql.query(
      `select count(distinct publication_id)::int as n from document_views
       where subscriber_id = $1 and publication_id = any($2::uuid[])`,
      [subscriberId, editions.map((e) => e.id)]
    )
    opened = o.n
  }

  const enough = editions.length >= WINDOW
  return { considered: editions.length, opened, flagged: enough && opened === 0 }
}

/**
 * The 90-day opens figure shown beside the flag.
 *
 * OPEN publications are excluded: they are public reading, left out of
 * entitlement everywhere else, so counting them would let a subscriber who
 * opens only free material read as engaged.
 */
async function opens90(subscriberId) {
  const [row] = await sql.query(
    `select count(*) filter (where v.viewed_at > now() - interval '90 days')::int as n
     from document_views v
     join documents d on d.id = v.publication_id
     where v.subscriber_id = $1
       and d.visibility <> 'OPEN'`,
    [subscriberId]
  )
  return row.n
}

before(async () => { await cleanup(TAG) })
after(async () => { await cleanup(TAG) })

describe('the flag fires when it should', () => {
  test('a seat that opened none of the last N editions is flagged', async () => {
    const seat = await makeSeat(TAG, { suffix: 'silent', level: 'L2' })
    await makeEdition(TAG, { suffix: 's1', visibility: 'L2', editionDaysAgo: 10 })
    await makeEdition(TAG, { suffix: 's2', visibility: 'L2', editionDaysAgo: 30 })

    const r = await evaluate(seat.id, 's')
    assert.equal(r.considered, 2)
    assert.equal(r.opened, 0)
    assert.equal(r.flagged, true)
  })

  test('a seat that opened them is not flagged', async () => {
    const seat = await makeSeat(TAG, { suffix: 'reader', level: 'L2' })
    const e1 = await makeEdition(TAG, { suffix: 'r1', visibility: 'L2', editionDaysAgo: 10 })
    const e2 = await makeEdition(TAG, { suffix: 'r2', visibility: 'L2', editionDaysAgo: 30 })
    await makeView(TAG, { suffix: 'r1', subscriberId: seat.id, publicationId: e1.id })
    await makeView(TAG, { suffix: 'r2', subscriberId: seat.id, publicationId: e2.id })

    const r = await evaluate(seat.id, 'r')
    assert.equal(r.opened, 2)
    assert.equal(r.flagged, false)
  })
})

describe('rules that prevent false alarms', () => {
  test('editions published before term_start are not counted', async () => {
    // Joined 5 days ago; both editions are older than that.
    const seat = await makeSeat(TAG, {
      suffix: 'new', level: 'L2', termStartDaysAgo: 5,
    })
    await makeEdition(TAG, { suffix: 'n1', visibility: 'L2', editionDaysAgo: 20 })
    await makeEdition(TAG, { suffix: 'n2', visibility: 'L2', editionDaysAgo: 40 })

    const r = await evaluate(seat.id, 'n')
    assert.equal(r.considered, 0, 'editions predating the term were counted')
    assert.equal(r.flagged, false, 'a new subscriber was flagged for editions they never had')
  })

  test('a seat with fewer than N entitled editions is never flagged', async () => {
    const seat = await makeSeat(TAG, { suffix: 'thin', level: 'L1' })
    await makeEdition(TAG, { suffix: 't1', visibility: 'L1', series: 'PLM', editionDaysAgo: 10 })

    const r = await evaluate(seat.id, 't')
    assert.equal(r.considered, 1)
    assert.equal(r.flagged, false, 'flagged on a single edition, which proves nothing')
  })

  test('board papers are excluded from the window', async () => {
    const seat = await makeSeat(TAG, { suffix: 'board', level: 'L4' })
    await makeEdition(TAG, { suffix: 'b1', visibility: 'L4', series: 'BP', editionDaysAgo: 5 })
    await makeEdition(TAG, { suffix: 'b2', visibility: 'L4', series: 'BP', editionDaysAgo: 7 })
    await makeEdition(TAG, { suffix: 'b3', visibility: 'L2', series: 'MIN', editionDaysAgo: 10 })
    await makeEdition(TAG, { suffix: 'b4', visibility: 'L2', series: 'AIU', editionDaysAgo: 12 })

    const r = await evaluate(seat.id, 'b')
    assert.equal(r.considered, 2, 'the window should hold the two regular editions')

    const ids = await sql.query(
      `select series from documents where slug like $1 and series = 'BP'`, [`${TAG}%`])
    assert.ok(ids.length >= 2, 'fixture sanity: board papers exist')
  })

  test('opening only a board paper does not clear the flag', async () => {
    const seat = await makeSeat(TAG, { suffix: 'bponly', level: 'L4' })
    const bp = await makeEdition(TAG, { suffix: 'p1', visibility: 'L4', series: 'BP', editionDaysAgo: 3 })
    await makeEdition(TAG, { suffix: 'p2', visibility: 'L2', series: 'MIN', editionDaysAgo: 10 })
    await makeEdition(TAG, { suffix: 'p3', visibility: 'L2', series: 'AIU', editionDaysAgo: 12 })
    await makeView(TAG, { suffix: 'bp', subscriberId: seat.id, publicationId: bp.id })

    const r = await evaluate(seat.id, 'p')
    assert.equal(r.flagged, true, 'a board-paper view was allowed to count as engagement')
  })

  test('lapsed and suspended seats are excluded entirely', async () => {
    for (const status of ['lapsed', 'suspended']) {
      const seat = await makeSeat(TAG, { suffix: `x_${status}`, status })
      const r = await evaluate(seat.id, 'none')
      assert.equal(r.skipped, 'not-active', `a ${status} seat was evaluated`)
    }
  })

  test('an OPEN publication is never part of the window', async () => {
    const seat = await makeSeat(TAG, { suffix: 'openwin', level: 'L2' })
    await makeEdition(TAG, {
      suffix: 'o1', visibility: 'OPEN', series: 'PLM', editionDaysAgo: 2,
      openLinkUrl: 'https://www.papermark.com/view/free',
    })
    await makeEdition(TAG, { suffix: 'o2', visibility: 'L2', series: 'MIN', editionDaysAgo: 10 })

    const r = await evaluate(seat.id, 'o')
    assert.equal(r.considered, 1, 'an OPEN edition was counted as entitled')
  })
})

describe('the 90-day opens figure', () => {
  /**
   * The audit flagged this: the figure counts every stored view for the
   * subscriber, including views of OPEN publications. OPEN pieces are public
   * reading and are excluded from entitlement everywhere else, so counting them
   * here overstates engagement — a subscriber who reads only the free monitor
   * can look active while never opening a paid edition.
   */
  test('views of OPEN publications are excluded from the 90-day count', async () => {
    const seat = await makeSeat(TAG, { suffix: 'freerider', level: 'L2' })
    const open = await makeEdition(TAG, {
      suffix: 'f1', visibility: 'OPEN', series: 'PLM', editionDaysAgo: 5,
      openLinkUrl: 'https://www.papermark.com/view/free2',
    })
    await makeView(TAG, { suffix: 'f1', subscriberId: seat.id, publicationId: open.id, daysAgo: 2 })

    assert.equal(
      await opens90(seat.id), 0,
      'an OPEN publication view was counted toward paid engagement'
    )
  })

  test('views of entitled editions are counted', async () => {
    const seat = await makeSeat(TAG, { suffix: 'paid', level: 'L2' })
    const paid = await makeEdition(TAG, { suffix: 'q1', visibility: 'L2', series: 'MIN', editionDaysAgo: 5 })
    await makeView(TAG, { suffix: 'q1', subscriberId: seat.id, publicationId: paid.id, daysAgo: 2 })

    assert.equal(await opens90(seat.id), 1)
  })

  test('views older than 90 days are not counted', async () => {
    const seat = await makeSeat(TAG, { suffix: 'stale', level: 'L2', termStartDaysAgo: 400 })
    const ed = await makeEdition(TAG, { suffix: 'z1', visibility: 'L2', series: 'MIN', editionDaysAgo: 200 })
    await makeView(TAG, { suffix: 'z1', subscriberId: seat.id, publicationId: ed.id, daysAgo: 120 })

    assert.equal(await opens90(seat.id), 0)
  })
})
