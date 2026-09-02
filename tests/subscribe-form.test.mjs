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

// ---------------------------------------------------------------------------
// Work-email validation for non-Individual tiers
// ---------------------------------------------------------------------------

import {
  requiresWorkEmail,
  isPersonalEmail,
  WORK_EMAIL_MESSAGE,
} from '../src/lib/entitlements.ts'

test('Individual Access does not require a work email', () => {
  assert.equal(requiresWorkEmail('Individual Access'), false)
})

test('every non-Individual tier requires a work email', () => {
  for (const tier of [
    'Professional Team Access',
    'Political Monitor',
    'Executive Intelligence',
    'Board Briefing',
  ]) {
    assert.equal(requiresWorkEmail(tier), true, `${tier} should require work email`)
  }
})

test('an unrecognised tier name does not require a work email', () => {
  assert.equal(requiresWorkEmail(''), false)
  assert.equal(requiresWorkEmail('Nonexistent Tier'), false)
})

test('known personal email providers are blocked', () => {
  const blocked = [
    'user@gmail.com',
    'user@outlook.com',
    'user@hotmail.com',
    'user@live.com',
    'user@yahoo.com',
    'user@icloud.com',
    'user@aol.com',
    'user@proton.me',
    'user@protonmail.com',
    'user@gmx.com',
    'user@gmx.net',
    'user@mail.com',
    'user@yandex.com',
    'user@yandex.ru',
  ]
  for (const addr of blocked) {
    assert.equal(isPersonalEmail(addr), true, `${addr} should be blocked`)
  }
})

test('disposable email providers are blocked', () => {
  const disposable = [
    'x@mailinator.com',
    'x@guerrillamail.com',
    'x@tempmail.com',
    'x@throwaway.email',
    'x@yopmail.com',
    'x@maildrop.cc',
    'x@trashmail.com',
    'x@10minutemail.com',
  ]
  for (const addr of disposable) {
    assert.equal(isPersonalEmail(addr), true, `${addr} should be blocked`)
  }
})

test('company / custom domain emails are accepted', () => {
  const accepted = [
    'ceo@acme.com',
    'analyst@shell.com.ng',
    'team@bigcorp.org',
    'jane@ministry.gov.ng',
    'info@consultancy.co.uk',
    'user@workspace.company.com',
  ]
  for (const addr of accepted) {
    assert.equal(isPersonalEmail(addr), false, `${addr} should be accepted`)
  }
})

test('handles uppercase, whitespace and plus aliases', () => {
  assert.equal(isPersonalEmail('  User@GMAIL.COM  '), true)
  assert.equal(isPersonalEmail('name+test@gmail.com'), true)
  assert.equal(isPersonalEmail('NAME+TAG@Yahoo.COM'), true)
  assert.equal(isPersonalEmail('  CTO@BigCorp.com  '), false)
})

test('does not block all .com or .org or .ng domains', () => {
  assert.equal(isPersonalEmail('x@company.com'), false)
  assert.equal(isPersonalEmail('x@charity.org'), false)
  assert.equal(isPersonalEmail('x@firm.ng'), false)
  assert.equal(isPersonalEmail('x@oil.com.ng'), false)
})

test('the work-email error message is the one the user should see', () => {
  assert.equal(
    WORK_EMAIL_MESSAGE,
    'Please use your official company or organisation email address for this access level.'
  )
})

test('the server action enforces work email before database insert', () => {
  const source = read('src/app/actions/public.ts')
  const start = source.indexOf('export async function requestAccess')
  const end = source.indexOf('export async function requestBriefing')
  const action = source.slice(start, end)

  assert.match(action, /requiresWorkEmail\(subscriptionLevel\)/)
  assert.match(action, /isPersonalEmail\(email\)/)
  assert.match(action, /WORK_EMAIL_MESSAGE/)

  const check = action.indexOf('requiresWorkEmail')
  const insert = action.indexOf('insert into subscribers')
  assert.ok(check > 0, 'work-email check not found')
  assert.ok(insert > 0, 'insert not found')
  assert.ok(check < insert, 'work-email check must come before the database insert')
})

test('the client form validates email domain before submission', () => {
  const form = read('src/app/access-form.tsx')
  assert.match(form, /requiresWorkEmail/)
  assert.match(form, /isPersonalEmail/)
  assert.match(form, /emailDomainError/)
  assert.match(form, /onSubmit=\{handleSubmit\}/)
  assert.match(form, /event\.preventDefault\(\)/)
})
