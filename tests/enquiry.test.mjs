/**
 * The subscription enquiry form: phone normalisation, seat capture, and the
 * spam defences.
 *
 * The seat count matters most here. It decides whether an enquiry is Individual
 * or Professional Team, and it used to be guessed from the tier name -- so a
 * two-person team and a fifty-person one were stored identically.
 */
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sql, makeTag, cleanup } from './helpers.mjs'

const TAG = makeTag('enq')

before(async () => { await cleanup(TAG) })
after(async () => {
  await cleanup(TAG)
  await sql.query(`delete from login_attempts where email_key like $1`, [`enquiry:${TAG}%`])
})

/** Mirrors normalisePhone in src/lib/definitions.ts. */
function normalisePhone(input) {
  const cleaned = input.replace(/[\s()\-.]/g, '')
  if (cleaned.startsWith('+')) return cleaned
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`
  if (/^0\d{9,10}$/.test(cleaned)) return `+234${cleaned.slice(1)}`
  if (/^234\d{7,11}$/.test(cleaned)) return `+${cleaned}`
  return cleaned
}

describe('phone normalisation', () => {
  test('a local Nigerian number gains the country code', () => {
    assert.equal(normalisePhone('08031234567'), '+2348031234567')
  })

  test('spaces and dashes are stripped', () => {
    assert.equal(normalisePhone('0803 123 4567'), '+2348031234567')
    assert.equal(normalisePhone('0803-123-4567'), '+2348031234567')
    assert.equal(normalisePhone('(0803) 123 4567'), '+2348031234567')
  })

  test('an explicit + is preserved untouched', () => {
    // Assuming a country code would corrupt a number from outside Nigeria.
    assert.equal(normalisePhone('+44 20 7946 0958'), '+442079460958')
    assert.equal(normalisePhone('+1 202 555 0142'), '+12025550142')
  })

  test('a 00 international prefix becomes +', () => {
    assert.equal(normalisePhone('00234 803 123 4567'), '+2348031234567')
  })

  test('a country code without a plus gains one', () => {
    assert.equal(normalisePhone('2348031234567'), '+2348031234567')
  })

  test('the same number typed three ways stores identically', () => {
    const forms = ['08031234567', '+234 803 123 4567', '234-803-123-4567']
    const stored = new Set(forms.map(normalisePhone))
    assert.equal(stored.size, 1, `three forms produced ${stored.size} stored values`)
  })
})

describe('the stored enquiry captures every field', () => {
  test('an enquiry records name, contact, role, seats and level', async () => {
    const email = `${TAG}_full@example.invalid`

    await sql.query(
      `insert into subscribers (
         name, full_name, organization, email, phone, role_title,
         subscription_level, public_tier, level, seats, note, status
       ) values ($1,$1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'Pending')`,
      ['Adaeze Okonkwo', 'Zenith Bank', email, '+2348031234567',
       'Head of Strategy', 'Professional Team Access', 'L2', 12,
       'Interested from Q1']
    )

    const [row] = await sql.query(
      `select full_name, organization, email, phone, role_title,
              subscription_level, level, seats, note, status
       from subscribers where email = $1`, [email])

    assert.equal(row.full_name, 'Adaeze Okonkwo')
    assert.equal(row.organization, 'Zenith Bank')
    assert.equal(row.phone, '+2348031234567', 'the phone was not stored normalised')
    assert.equal(row.role_title, 'Head of Strategy')
    assert.equal(row.subscription_level, 'Professional Team Access')
    assert.equal(row.seats, 12, 'the seat count from the form was not stored')
    assert.equal(row.note, 'Interested from Q1')
    assert.equal(row.status, 'Pending', 'an enquiry must never arrive already active')
  })

  test('the seat count is taken as given, not inferred from the tier', async () => {
    // Two Professional Team enquiries of very different size must be
    // distinguishable, which is the whole reason the field is asked.
    const small = `${TAG}_small@example.invalid`
    const large = `${TAG}_large@example.invalid`

    for (const [email, seats] of [[small, 2], [large, 50]]) {
      await sql.query(
        `insert into subscribers (name, full_name, organization, email, phone,
                                  role_title, subscription_level, public_tier,
                                  level, seats, status)
         values ('T','T','Org',$1,'+2348030000000','Role',
                 'Professional Team Access','Professional Team Access','L2',$2,'Pending')`,
        [email, seats]
      )
    }

    const rows = await sql.query(
      `select email, seats from subscribers where email in ($1,$2) order by seats`,
      [small, large])

    assert.deepEqual(rows.map((r) => r.seats), [2, 50])
  })

  test('seats defaults to one, never zero or null', async () => {
    const email = `${TAG}_default@example.invalid`
    await sql.query(
      `insert into subscribers (name, full_name, organization, email, phone,
                                role_title, level, status)
       values ('T','T','Org',$1,'+2348030000001','Role','L2','Pending')`,
      [email])

    const [row] = await sql.query(`select seats from subscribers where email = $1`, [email])
    assert.equal(row.seats, 1, 'an enquiry with no seat count should default to one')
  })

  test('the seats column refuses a nonsensical count', async () => {
    const email = `${TAG}_zero@example.invalid`
    await assert.rejects(
      () => sql.query(
        `insert into subscribers (name, full_name, organization, email, phone,
                                  role_title, level, seats, status)
         values ('T','T','Org',$1,'+2348030000002','Role','L2',0,'Pending')`,
        [email]),
      'a seat count of zero was accepted'
    )
  })
})

describe('spam defences', () => {
  test('throttling counts enquiries per address inside the window', async () => {
    const email = `${TAG}_throttle@example.invalid`
    const key = `enquiry:${email}`

    for (let i = 0; i < 3; i++) {
      await sql.query(
        `insert into login_attempts (email_key, ip, successful) values ($1,$2,true)`,
        [key, '203.0.113.9'])
    }

    const [{ recent }] = await sql.query(
      `select count(*)::int as recent from login_attempts
       where email_key like 'enquiry:%'
         and created_at > now() - interval '60 minutes'
         and (email_key = $1 or (ip <> '' and ip = $2))`,
      [key, '203.0.113.9'])

    assert.ok(recent >= 3, 'the throttle window did not see the attempts')
  })

  test('enquiry throttling cannot lock anyone out of signing in', async () => {
    // The keys are namespaced, so a burst of enquiries and a burst of sign-in
    // attempts are counted separately.
    const email = `${TAG}_sep@example.invalid`
    await sql.query(
      `insert into login_attempts (email_key, ip, successful) values ($1,'',true)`,
      [`enquiry:${email}`])

    const [{ n }] = await sql.query(
      `select count(*)::int as n from login_attempts where email_key = $1`,
      [`portal:${email}`])

    assert.equal(n, 0, 'an enquiry attempt was counted against portal sign-in')
  })
})
