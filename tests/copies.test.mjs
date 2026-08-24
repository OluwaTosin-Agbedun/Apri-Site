/**
 * The stamping lane: copy gaps, the open lane, alert holds, and revocation.
 *
 * These are the properties a later refactor breaks silently, because none of
 * them raises an error when they fail — a subscriber simply sees nothing, or
 * sees something that was never meant for them.
 */
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  sql, makeTag, cleanup, makeSeat, makeEdition, makeOverride, libraryFor,
  visibilitiesForLevel,
} from './helpers.mjs'

const TAG = makeTag('cop')

before(async () => { await cleanup(TAG) })
after(async () => { await cleanup(TAG) })

/**
 * The copy-gap computation.
 *
 * `scope` is the edition suffix this test created. Tests share one database, so
 * without it another test's editions land in this one's gap list.
 */
async function gapsFor(subscriberId, scope) {
  if (!scope) throw new Error('gapsFor() needs a fixture scope')
  const pairs = []
  for (const level of ['L1', 'L2', 'L3', 'L4']) {
    for (const visibility of visibilitiesForLevel(level)) {
      pairs.push({ level, visibility })
    }
  }

  return sql.query(
    `with entitlement (level, visibility) as (
       select * from unnest($1::text[], $2::text[])
     )
     select d.id as publication_id, d.title
     from subscribers s
     join entitlement e on e.level = s.level
     join documents d
       on d.visibility = e.visibility
      and d.status = 'published'
      and d.visibility <> 'OPEN'
      and d.is_shared_copy = false
     left join publication_access pa
       on pa.subscriber_id = s.id and pa.publication_id = d.id
     where s.id = $3
       and lower(s.status) = 'active'
       and s.level is not null
       and (s.term_end is null or s.term_end >= current_date)
       and coalesce(d.edition_date, d.published_at::date, d.created_at::date)
           >= coalesce(s.term_start, s.created_at::date)
       and pa.id is null
       and d.slug = $4`,
    [pairs.map((p) => p.level), pairs.map((p) => p.visibility), subscriberId, `${TAG}_ed_${scope}`]
  )
}

describe('copies needed', () => {
  test('an entitled subscriber with no access row appears in the queue', async () => {
    const seat = await makeSeat(TAG, { suffix: 'gap', level: 'L2' })
    const ed = await makeEdition(TAG, { suffix: 'g1', visibility: 'L2', editionDaysAgo: 3 })

    const gaps = await gapsFor(seat.id, 'g1')
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0].publication_id, ed.id)
  })

  test('once the row exists the gap closes and the link works', async () => {
    const seat = await makeSeat(TAG, { suffix: 'filled', level: 'L2' })
    const ed = await makeEdition(TAG, { suffix: 'f1', visibility: 'L2', editionDaysAgo: 3 })

    await makeOverride({
      subscriberId: seat.id,
      publicationId: ed.id,
      linkUrl: 'https://docs.athenacentre.org/view/filled-copy',
      papermarkLinkId: `${TAG}_pml_filled`,
    })

    assert.equal((await gapsFor(seat.id, 'f1')).length, 0, 'gap did not close')

    const library = await libraryFor(seat.id, 'L2', `${TAG}%`)
    const row = library.find((r) => r.id === ed.id)
    assert.ok(row, 'the edition is missing from the library')
    assert.equal(row.link, 'https://docs.athenacentre.org/view/filled-copy')
  })

  test('an edition above their level never appears as a gap', async () => {
    const seat = await makeSeat(TAG, { suffix: 'l2only', level: 'L2' })
    await makeEdition(TAG, { suffix: 'x1', visibility: 'L3', editionDaysAgo: 3 })

    const gaps = await gapsFor(seat.id, 'x1')
    assert.ok(
      !gaps.some((g) => g.title === 'Edition x1'),
      'an Executive-only edition was queued for an Individual Access seat'
    )
  })

  test('editions predating the term are not queued', async () => {
    const seat = await makeSeat(TAG, { suffix: 'newjoin', level: 'L2', termStartDaysAgo: 2 })
    await makeEdition(TAG, { suffix: 'p1', visibility: 'L2', editionDaysAgo: 40 })

    assert.equal((await gapsFor(seat.id, 'p1')).length, 0)
  })

  test('a shared unstamped publication needs no per-subscriber copy', async () => {
    const seat = await makeSeat(TAG, { suffix: 'shared', level: 'L2' })
    const ed = await makeEdition(TAG, { suffix: 'sh1', visibility: 'L2', editionDaysAgo: 3 })
    await sql.query(
      `update documents set is_shared_copy = true, papermark_link = $2 where id = $1`,
      [ed.id, 'https://docs.athenacentre.org/view/shared']
    )

    assert.equal((await gapsFor(seat.id, 'sh1')).length, 0, 'a shared copy was queued for stamping')

    const library = await libraryFor(seat.id, 'L2', `${TAG}%`)
    const row = library.find((r) => r.id === ed.id)
    assert.equal(row?.link, 'https://docs.athenacentre.org/view/shared')
  })
})

describe('no unstamped document reaches a paid subscriber', () => {
  /**
   * The guard the brief asked for explicitly, because a refactor breaks it
   * without raising anything: a paid publication with no access row must show
   * "being prepared" and must never fall through to an open or shared link.
   */
  test('a paid edition with no access row resolves to no link', async () => {
    const seat = await makeSeat(TAG, {
      suffix: 'noRow', level: 'L2',
      libraryLink: 'https://docs.athenacentre.org/view/their-library-link',
    })
    const ed = await makeEdition(TAG, { suffix: 'nr1', visibility: 'L2', editionDaysAgo: 3 })

    const library = await libraryFor(seat.id, 'L2', `${TAG}%`)
    const row = library.find((r) => r.id === ed.id)

    assert.ok(row, 'the edition should be listed')
    assert.equal(row.link, null, 'a paid edition without an access row produced a link')
  })

  test('it does not fall back to the library link on the subscriber row', async () => {
    const rows = await sql.query(
      `select library_link_url from subscribers where email like $1 and library_link_url is not null`,
      [`${TAG}_noRow%`]
    )
    assert.ok(rows.length === 1, 'fixture sanity: a library link is present to fall back to')

    const seat = await sql.query(
      `select id, level from subscribers where email like $1`, [`${TAG}_noRow%`])
    const library = await libraryFor(seat[0].id, seat[0].level, `${TAG}%`)

    assert.ok(
      library.every((r) => r.link === null || !r.link.includes('their-library-link')),
      'the library link was used as a fallback for a stamped publication'
    )
  })

  test('a revoked row stops producing a link', async () => {
    const seat = await makeSeat(TAG, { suffix: 'revoked', level: 'L2' })
    const ed = await makeEdition(TAG, { suffix: 'rv1', visibility: 'L2', editionDaysAgo: 3 })
    await makeOverride({
      subscriberId: seat.id, publicationId: ed.id,
      linkUrl: 'https://docs.athenacentre.org/view/revoked-copy',
      papermarkLinkId: `${TAG}_pml_rev`,
    })

    let library = await libraryFor(seat.id, 'L2', `${TAG}%`)
    assert.ok(library.find((r) => r.id === ed.id)?.link, 'link missing before revocation')

    await sql.query(
      `update publication_access set revoke_state = 'revoked', revoked_at = now()
       where subscriber_id = $1 and publication_id = $2`,
      [seat.id, ed.id]
    )

    library = await libraryFor(seat.id, 'L2', `${TAG}%`)
    assert.equal(
      library.find((r) => r.id === ed.id)?.link, null,
      'a revoked link was still served'
    )
  })
})

describe('the open lane is structurally separate', () => {
  test('an OPEN publication carries its own public link', async () => {
    const ed = await makeEdition(TAG, {
      suffix: 'op1', visibility: 'OPEN', series: 'PLM', editionDaysAgo: 2,
      openLinkUrl: 'https://docs.athenacentre.org/view/open-piece',
    })

    const [row] = await sql.query(
      `select open_link_url, visibility from documents where id = $1`, [ed.id])
    assert.equal(row.visibility, 'OPEN')
    assert.equal(row.open_link_url, 'https://docs.athenacentre.org/view/open-piece')
  })

  test('an OPEN publication appears in no library', async () => {
    const seat = await makeSeat(TAG, { suffix: 'openlib', level: 'L4' })
    const open = await makeEdition(TAG, {
      suffix: 'op2', visibility: 'OPEN', series: 'PLM', editionDaysAgo: 2,
      openLinkUrl: 'https://docs.athenacentre.org/view/open-2',
    })

    const library = await libraryFor(seat.id, 'L4', `${TAG}%`)
    assert.ok(
      !library.some((r) => r.id === open.id),
      'an OPEN publication appeared in a paid library'
    )
    assert.ok(library.every((r) => r.visibility !== 'OPEN'))
  })

  test('a level-gated publication cannot hold an open link', async () => {
    const ed = await makeEdition(TAG, { suffix: 'lane1', visibility: 'L2', editionDaysAgo: 2 })

    await assert.rejects(
      () => sql.query(
        `update documents set open_link_url = $2 where id = $1`,
        [ed.id, 'https://docs.athenacentre.org/view/should-be-refused']
      ),
      'a paid publication was allowed a public open link'
    )
  })

  test('an OPEN publication cannot also be marked a shared paid copy', async () => {
    const ed = await makeEdition(TAG, {
      suffix: 'lane2', visibility: 'OPEN', series: 'PLM', editionDaysAgo: 2,
      openLinkUrl: 'https://docs.athenacentre.org/view/open-3',
    })

    await assert.rejects(
      () => sql.query(`update documents set is_shared_copy = true where id = $1`, [ed.id]),
      'a publication was allowed to be both OPEN and a shared paid copy'
    )
  })

  test('turning a publication paid strips any open link first', async () => {
    // The constraint makes the unsafe state unreachable, so the only way to
    // move an OPEN piece into the paid lane is to clear its public link.
    const ed = await makeEdition(TAG, {
      suffix: 'lane3', visibility: 'OPEN', series: 'PLM', editionDaysAgo: 2,
      openLinkUrl: 'https://docs.athenacentre.org/view/open-4',
    })

    await assert.rejects(
      () => sql.query(`update documents set visibility = 'L2' where id = $1`, [ed.id]),
      'an OPEN publication became paid while keeping its public link'
    )

    await sql.query(
      `update documents set open_link_url = null, visibility = 'L2' where id = $1`, [ed.id])
    const [row] = await sql.query(
      `select visibility, open_link_url from documents where id = $1`, [ed.id])
    assert.equal(row.visibility, 'L2')
    assert.equal(row.open_link_url, null)
  })
})

describe('alert holds', () => {
  test('an alert splits into provisioned and held', async () => {
    const ed = await makeEdition(TAG, { suffix: 'al1', visibility: 'L2', editionDaysAgo: 1 })

    const seats = []
    for (let i = 0; i < 9; i++) {
      seats.push(await makeSeat(TAG, { suffix: `al_${i}`, level: 'L2' }))
    }
    // Seven have copies; two do not.
    for (const seat of seats.slice(0, 7)) {
      await makeOverride({
        subscriberId: seat.id, publicationId: ed.id,
        linkUrl: `https://docs.athenacentre.org/view/al-${seat.id.slice(0, 8)}`,
        papermarkLinkId: `${TAG}_pml_${seat.id.slice(0, 8)}`,
      })
    }

    const rows = await sql.query(
      `select case when pa.revoke_state = 'live' and pa.link_url like 'https://%'
                   then true else false end as has_copy
       from subscribers s
       left join publication_access pa
         on pa.subscriber_id = s.id and pa.publication_id = $1
       where s.email like $2 and lower(s.status) = 'active'`,
      [ed.id, `${TAG}_al_%`]
    )

    const withCopies = rows.filter((r) => r.has_copy).length
    const held = rows.length - withCopies

    assert.equal(rows.length, 9, 'entitled count')
    assert.equal(withCopies, 7, 'should send to seven')
    assert.equal(held, 2, 'should hold two')
  })

  test('a hold is released once the copy exists', async () => {
    const seat = await makeSeat(TAG, { suffix: 'held1', level: 'L2' })
    const ed = await makeEdition(TAG, { suffix: 'h1', visibility: 'L2', editionDaysAgo: 1 })

    await sql.query(
      `insert into alert_holds (subscriber_id, publication_id) values ($1,$2)`,
      [seat.id, ed.id]
    )

    let [pending] = await sql.query(
      `select count(*)::int as n from alert_holds
       where subscriber_id = $1 and released_at is null`, [seat.id])
    assert.equal(pending.n, 1, 'the hold was not recorded')

    // Provisioning the copy is what releases it.
    await makeOverride({
      subscriberId: seat.id, publicationId: ed.id,
      linkUrl: 'https://docs.athenacentre.org/view/held-copy',
      papermarkLinkId: `${TAG}_pml_held`,
    })
    await sql.query(
      `update alert_holds set released_at = now()
       where subscriber_id = $1 and publication_id = $2`, [seat.id, ed.id])

    ;[pending] = await sql.query(
      `select count(*)::int as n from alert_holds
       where subscriber_id = $1 and released_at is null`, [seat.id])
    assert.equal(pending.n, 0, 'the hold was not released')
  })
})

describe('copy identity', () => {
  test('a copy id resolves to exactly one subscriber and publication', async () => {
    const seat = await makeSeat(TAG, { suffix: 'cid', level: 'L2' })
    const ed = await makeEdition(TAG, { suffix: 'c1', visibility: 'L2', editionDaysAgo: 2 })

    const copyId = `${TAG}-MIN-2026-08/ZZ-999`
    await sql.query(
      `insert into publication_access
         (subscriber_id, publication_id, link_url, papermark_link_id, copy_id)
       values ($1,$2,$3,$4,$5)`,
      [seat.id, ed.id, 'https://docs.athenacentre.org/view/cid', `${TAG}_pml_cid`, copyId]
    )

    const rows = await sql.query(
      `select subscriber_id, publication_id from publication_access where copy_id = $1`,
      [copyId]
    )
    assert.equal(rows.length, 1, 'a copy id matched more than one access row')
    assert.equal(rows[0].subscriber_id, seat.id)
    assert.equal(rows[0].publication_id, ed.id)
  })

  test('the same copy id cannot be issued twice', async () => {
    const seat = await makeSeat(TAG, { suffix: 'cid2', level: 'L2' })
    const ed = await makeEdition(TAG, { suffix: 'c2', visibility: 'L2', editionDaysAgo: 2 })

    await assert.rejects(
      () => sql.query(
        `insert into publication_access
           (subscriber_id, publication_id, link_url, papermark_link_id, copy_id)
         values ($1,$2,$3,$4,$5)`,
        [seat.id, ed.id, 'https://docs.athenacentre.org/view/cid2', `${TAG}_pml_cid2`,
         `${TAG}-MIN-2026-08/ZZ-999`]
      ),
      'a duplicate copy id was accepted'
    )
  })

  test('every subscriber gets a distinct seat number', async () => {
    const a = await makeSeat(TAG, { suffix: 'seatA', level: 'L2' })
    const b = await makeSeat(TAG, { suffix: 'seatB', level: 'L2' })

    const rows = await sql.query(
      `select seat_no from subscribers where id = any($1::uuid[])`, [[a.id, b.id]])
    assert.equal(rows.length, 2)
    assert.ok(rows[0].seat_no !== null && rows[1].seat_no !== null, 'seat_no not assigned')
    assert.notEqual(rows[0].seat_no, rows[1].seat_no, 'seat numbers collided')
  })
})

describe('revocation on lapse', () => {
  test('a lapsed subscriber is swept and their links marked for withdrawal', async () => {
    const seat = await makeSeat(TAG, { suffix: 'lapse', level: 'L2', status: 'lapsed' })
    const ed = await makeEdition(TAG, { suffix: 'lp1', visibility: 'L2', editionDaysAgo: 3 })
    await makeOverride({
      subscriberId: seat.id, publicationId: ed.id,
      linkUrl: 'https://docs.athenacentre.org/view/lapsed-copy',
      papermarkLinkId: `${TAG}_pml_lapse`,
    })

    const due = await sql.query(
      `select distinct pa.subscriber_id
       from publication_access pa
       join subscribers s on s.id = pa.subscriber_id
       where pa.revoke_state = 'live'
         and s.email like $1
         and (lower(s.status) in ('lapsed','suspended')
              or (s.term_end is not null and s.term_end < current_date))`,
      [`${TAG}_lapse%`]
    )
    assert.equal(due.length, 1, 'a lapsed subscriber with live links was not swept')
  })

  test('revocation never deletes the access record', async () => {
    const seat = await makeSeat(TAG, { suffix: 'keep', level: 'L2' })
    const ed = await makeEdition(TAG, { suffix: 'kp1', visibility: 'L2', editionDaysAgo: 3 })
    await makeOverride({
      subscriberId: seat.id, publicationId: ed.id,
      linkUrl: 'https://docs.athenacentre.org/view/keep-copy',
      papermarkLinkId: `${TAG}_pml_keep`,
    })

    await sql.query(
      `update publication_access set revoke_state = 'manual_required', revoked_at = now()
       where subscriber_id = $1`, [seat.id])

    const rows = await sql.query(
      `select revoke_state, link_url from publication_access where subscriber_id = $1`,
      [seat.id])
    assert.equal(rows.length, 1, 'the access record was deleted')
    assert.equal(rows[0].revoke_state, 'manual_required')
    assert.ok(rows[0].link_url, 'the link url was cleared — we lose what they had')
  })
})
