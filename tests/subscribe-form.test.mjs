import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { seatsForSubscriptionRequest } from '../src/lib/entitlements.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Individual Access submits without seats and always resolves to one', () => {
  assert.equal(seatsForSubscriptionRequest('Individual Access', null), 1)
  assert.equal(seatsForSubscriptionRequest('Individual Access', ''), 1)
  assert.equal(seatsForSubscriptionRequest('Individual Access', '25'), 1)
})

test('multi-seat access requires and saves a valid count', () => {
  assert.equal(seatsForSubscriptionRequest('Professional Team Access', null), null)
  assert.equal(seatsForSubscriptionRequest('Professional Team Access', ''), null)
  assert.equal(seatsForSubscriptionRequest('Professional Team Access', '12'), 12)
  assert.equal(seatsForSubscriptionRequest('Professional Team Access', '501'), null)
})

test('the form hides seats until a non-Individual level and clears stale seats', () => {
  const source = read('src/app/access-form.tsx')
  assert.match(source, /subscriptionLevel && subscriptionLevel !== 'Individual Access'/)
  assert.match(source, /if \(value === 'Individual Access' \|\| !value\) setSeats\(''\)/)
  assert.ok(source.indexOf('Subscription access level') < source.indexOf('How many people need access?'))
})

test('subscription requests remain pending subscriber records, never briefings', () => {
  const source = read('src/app/actions/public.ts')
  const start = source.indexOf('export async function requestAccess')
  const end = source.indexOf('export async function requestBriefing')
  const subscriptionAction = source.slice(start, end)
  assert.match(subscriptionAction, /insert into subscribers/)
  assert.match(subscriptionAction, /update subscribers set/)
  assert.match(subscriptionAction, /status = 'Pending'/)
  assert.doesNotMatch(subscriptionAction, /insert into briefing_requests/)
  assert.match(subscriptionAction, /sendAccessRequestConfirmation/)
  assert.match(subscriptionAction, /sendAccessRequestNotification/)
})

// ---------------------------------------------------------------------------
// Seat handling in requestAccess
//
// A merge left two derivations of the same seat number in this action, the
// second one referring to a variable that no longer existed, and the deployment
// build stopped there. These tests hold the shape that replaced it: one
// submitted value, one enforced value, and that enforced value everywhere
// afterwards.
// ---------------------------------------------------------------------------

const publicSource = read('src/app/actions/public.ts')
const requestAccessBody = publicSource.slice(
  publicSource.indexOf('export async function requestAccess'),
  publicSource.indexOf('export async function requestBriefing')
)

test('the subscription action declares one seat value under one name', () => {
  // The name the build died on. Gone, not redeclared.
  assert.doesNotMatch(publicSource, /enforcedSeats/)

  const declarations =
    requestAccessBody.match(/\bconst (?:seats|seatCount|effectiveSeats)\b/g) ?? []
  assert.deepEqual(declarations, ['const seatCount'])
})

test('every seat written or emailed is the enforced value', () => {
  // The insert, the update and the management notice all take the same name.
  assert.match(requestAccessBody, /\$\{seatCount\}, \$\{note\}, 'Pending'/)
  assert.match(requestAccessBody, /seats = \$\{seatCount\}/)
  assert.match(requestAccessBody, /seats: seatCount/)

  // And nothing else reaches a seat column or a seat field. Comments are
  // dropped first, since this file explains the rule in prose as well.
  const code = requestAccessBody
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')

  const seatUses = code.match(/\bseats *[:=] *[^,\n]+/g) ?? []
  assert.ok(seatUses.length >= 3, 'the seat writes have moved or been renamed')
  for (const use of seatUses) {
    assert.match(use, /seatCount/, `a seat value not taken from seatCount: ${use}`)
  }
})

test('an unusable seat count is refused before any database call', () => {
  const guard = requestAccessBody.indexOf('if (seatCount === null)')
  const firstQuery = requestAccessBody.indexOf('getSql()')

  assert.ok(guard > -1, 'the null guard has gone')
  assert.ok(
    guard < firstQuery,
    'a request with no usable seat count must return a form error before it reaches PostgreSQL'
  )
})

test('no hostile seat input resolves to anything but a whole number or a refusal', () => {
  const hostile = [
    null,
    '',
    ' ',
    'NaN',
    'undefined',
    'null',
    '0',
    '-1',
    '1.5',
    '1e3',
    '501',
    '9999999999',
    'Infinity',
    '2; drop table subscribers',
  ]

  for (const value of hostile) {
    // Individual Access ignores whatever was sent, so a request posted straight
    // at the action with fifty seats on it still stores one.
    assert.equal(seatsForSubscriptionRequest('Individual Access', value), 1)

    const teamSeats = seatsForSubscriptionRequest('Professional Team Access', value)
    if (teamSeats !== null) {
      assert.ok(Number.isInteger(teamSeats), `${value} produced a non-integer`)
      assert.ok(teamSeats >= 1 && teamSeats <= 500, `${value} produced ${teamSeats}`)
    }
  }

  // A level nobody selected is a level error, not a seat error.
  assert.equal(seatsForSubscriptionRequest('', '5'), null)
})

test('the admin subscriber form and its page agree on what a draft carries', () => {
  const form = read('src/app/admin/subscribers/[id]/subscriber-form.tsx')
  const page = read('src/app/admin/subscribers/[id]/page.tsx')

  // Declared once, and used both for the read-only input and the note under it.
  assert.match(form, /const isIndividual = publicTier === "Individual Access"/)
  assert.equal((form.match(/publicTier === "Individual Access"/g) ?? []).length, 1)

  // The internal level follows from the public tier on the server, so no draft
  // carries one -- even though the row it is built from has one.
  const between = (text, from, to) =>
    text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)))

  const draftType = between(form, 'export type SubscriberDraft', 'const field')
  const blankDraft = between(page, 'const BLANK: SubscriberDraft', 'type Row')
  const rowDraft = between(page, 'const draft: SubscriberDraft', 'const room = await')

  for (const block of [draftType, blankDraft, rowDraft]) {
    assert.ok(block.length > 0, 'a block moved; this test is reading nothing')
    assert.doesNotMatch(block, /\blevel\b/)
  }

  // Read from the record rather than assumed from the where clause.
  assert.match(page, /s\.client_type/)
  assert.match(page, /client_type: string/)
})
