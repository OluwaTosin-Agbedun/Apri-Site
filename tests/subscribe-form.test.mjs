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
