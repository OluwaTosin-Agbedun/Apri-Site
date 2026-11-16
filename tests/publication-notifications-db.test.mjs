import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { neon, neonConfig } from "@neondatabase/serverless"
import { startTestDatabase } from "./support/test-database.mjs"
import { fixtures, act, signIn } from "./publication-metadata-harness.mjs"
const db = await startTestDatabase()
neonConfig.fetchEndpoint = () => db.endpoint
process.env.DATABASE_URL = db.databaseUrl
const sql = neon(db.databaseUrl)
const fx = fixtures(sql, "notice_test")
const notices = await import("../src/lib/publication-notifications.ts")
const actions = await import("../src/app/actions/publication-notifications.ts")
const session = await import("../src/lib/session.ts")
const worker = await import(
  "../src/app/api/cron/publication-notifications/route.ts"
)
const password = randomBytes(18).toString("base64url")
const sent = []
const send = async (alert, key) => {
  sent.push({ alert, key })
  return {
    status: "accepted",
    providerMessageId: `provider-notice-${sent.length}`,
  }
}
const drain = (extra) =>
  notices.drainPublicationNotices({ sql, send, paceMs: 0, ...extra })
let owner,
  editor,
  legacy,
  room,
  jan,
  may,
  blocked,
  roomReader,
  otherReader,
  pub,
  old
const due = async () => {
  await sql`update publication_notice_events set next_attempt_at=now() where state in ('pending','fanning')`
  await sql`update publication_notice_jobs set next_attempt_at=now() where state in ('pending','held','failed')`
}
const jobState = async (subscriber, id = pub.id) =>
  (
    await sql`select j.* from publication_notice_jobs j join publication_notice_events e on e.id=j.event_id where j.subscriber_id=${subscriber}::uuid and e.publication_id=${id}::uuid order by e.created_at desc,e.id desc limit 1`
  )[0]
before(async () => {
  owner = await fx.admin("owner")
  editor = await fx.admin("editor")
  const hash = await bcrypt.hash(password, 4)
  await sql`update admins set password_hash=${hash} where id=any(${[owner, editor]}::uuid[])`
  legacy = await fx.plan("legacy", { room: false })
  room = await fx.plan("room")
  const other = await fx.plan("other", { room: false })
  jan = await fx.subscriber("jan", legacy.tier, "2026-01-01")
  may = await fx.subscriber("may", legacy.tier, "2026-05-01")
  blocked = await fx.subscriber("blocked", legacy.tier, "2026-01-01")
  roomReader = await fx.subscriber("room", room.tier, "2026-01-01")
  otherReader = await fx.subscriber("other", other.tier, "2026-01-01")
  old = await fx.edition("old", {
    title: "Existing released edition",
    date: "2026-02-01",
    forTiers: [legacy.tier],
  })
  pub = await fx.edition("new", {
    title: "New edition (2026)",
    series: "QIB",
    date: "2026-02-01",
    status: "draft",
    release: "withheld",
    forTiers: [legacy.tier, room.tier],
    dataroom: room.dataroom,
    summary: "Public teaser only.",
  })
  for (const id of [jan, may, blocked, otherReader])
    await sql`insert into publication_access(subscriber_id,publication_id,link_url) values(${id}::uuid,${pub.id}::uuid,'https://docs.example.invalid/owned-test-copy')`
  await sql`insert into subscriber_publication_exceptions(subscriber_id,publication_id,decision,reason,administrator_id) values(${blocked}::uuid,${pub.id}::uuid,'block','A named block for the test',${owner}::uuid)`
})
after(() => db.stop())
test("new notifications have no sending or historical baseline enabled by deployment", async () => {
  assert.equal((await notices.noticeSettings(sql)).enabled, false)
  assert.equal(
    (await sql`select count(*)::int as n from publication_notice_events`)[0].n,
    0,
  )
  assert.equal((await drain()).reason, "sending_paused")
  assert.equal(sent.length, 0)
})
test("only a real owner with password and baseline confirmation can start alerts", async () => {
  const form = {
    enabled: "yes",
    reason: "Approved controlled notification test baseline",
    password,
    baselineConfirmed: "yes",
  }
  await signIn(session, editor, "owner")
  assert.equal(
    (await act(actions.configurePublicationNotices, form)).to,
    "/admin",
  )
  await signIn(session, owner)
  assert.ok(
    !(
      await act(actions.configurePublicationNotices, {
        ...form,
        password: randomBytes(18).toString("base64url"),
      })
    ).ok,
  )
  assert.ok(
    !(
      await act(actions.configurePublicationNotices, {
        ...form,
        baselineConfirmed: "",
      })
    ).ok,
  )
  assert.equal((await act(actions.configurePublicationNotices, form)).ok, true)
  assert.equal(
    (await sql`select count(*)::int as n from publication_notice_events`)[0].n,
    0,
  )
  assert.equal(
    (
      await sql`select baseline from publication_notice_seen where publication_id=${old.id}::uuid`
    )[0].baseline,
    true,
  )
  assert.equal(
    (await drain()).reason,
    "sending_paused",
    "environment flag is a separate gate",
  )
  process.env.DATAROOM_NEW_DOCUMENT_EMAILS = "enabled"
})
test("first paid release is captured once; uploads, title edits and re-offering do not create extra events", async () => {
  await sql`update documents set title='A harmless rename',updated_at=now() where id=${old.id}::uuid`
  await sql`update documents set paid_release_state='released' where id=${pub.id}::uuid`
  await sql`update documents set paid_release_state='released',status='draft',title='New edition (2026)' where id=${pub.id}::uuid`
  await sql`update documents set paid_release_state='withheld' where id=${pub.id}::uuid`
  await sql`update documents set paid_release_state='released' where id=${pub.id}::uuid`
  assert.equal(
    (
      await sql`select count(*)::int as n from publication_notice_events where publication_id=${pub.id}::uuid`
    )[0].n,
    1,
  )
  assert.equal(sent.length, 0)
})
test("a January reader can be notified of February; May, blocked and other-plan readers cannot", async () => {
  assert.equal(
    (await notices.notificationEligibility(jan, pub.id, sql)).state,
    "ready",
  )
  for (const id of [may, blocked, otherReader])
    assert.equal(
      (await notices.notificationEligibility(id, pub.id, sql)).state,
      "excluded",
    )
  assert.equal(
    (await notices.notificationEligibility(roomReader, pub.id, sql)).state,
    "held",
    "a room assignment is not a personal confirmed link",
  )
  await due()
  const result = await drain()
  assert.equal(result.accepted, 1)
  assert.equal(sent[0].alert.email, "notice_test_jan@example.invalid")
  assert.equal(sent[0].alert.linkUrl, null)
  assert.equal((await jobState(roomReader)).state, "held")
  for (const id of [may, blocked, otherReader])
    assert.equal(await jobState(id), undefined)
})
test("concurrent workers cannot send an accepted notification again, and save its provider ID for diagnostics", async () => {
  const before = sent.length
  await due()
  await Promise.all([drain(), drain()])
  assert.equal(sent.length, before)
  const job = await jobState(jan)
  assert.equal(job.state, "accepted")
  assert.ok(job.provider_message_id)
  assert.equal(
    (
      await sql`select count(*)::int as n from client_engagement_events where resend_email_id=${job.provider_message_id} and event_type='publication_notification_sent'`
    )[0].n,
    1,
  )
})
test("a delayed personal link is notified after the old one-hour window, without a Papermark API call", async () => {
  await sql`update papermark_dataroom_documents set first_seen_at=now()-interval '10 days' where id=${pub.documentRowId}::uuid`
  await sql`insert into subscriber_access_reconciliations(subscriber_id,state,generation) values(${roomReader}::uuid,'complete',1)`
  await sql`insert into papermark_subscriber_document_links(subscriber_id,papermark_document_id,papermark_link_id,link_url,assigned_email,verification_generation,verification_result,last_verified_at)
    values(${roomReader}::uuid,${pub.papermarkDocumentId},'notice_test_link','https://docs.example.invalid/reader-copy','notice_test_room@example.invalid',1,'{"state":"found"}'::jsonb,now())`
  await due()
  const result = await drain()
  assert.equal(result.accepted, 1)
  assert.equal((await jobState(roomReader)).state, "accepted")
  assert.equal(
    sent.at(-1).alert.title,
    "New edition (2026)",
    "same title resolver as the portal",
  )
})
test("a first-publication event cannot be duplicated; an approved correction needs an explicit distinct version", async () => {
  assert.equal(
    await notices.queuePublicationNotice(
      pub.id,
      owner,
      "first",
      "Try the same published edition again",
      sql,
    ),
    null,
  )
  const revision = notices.noticeRevision("Revision 2")
  const results = await Promise.all([
    notices.queuePublicationNotice(
      pub.id,
      owner,
      revision,
      "Substantive approved correction version two",
      sql,
    ),
    notices.queuePublicationNotice(
      pub.id,
      owner,
      revision,
      "Substantive approved correction version two",
      sql,
    ),
  ])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(
    (
      await sql`select count(*)::int as n from publication_notice_events where publication_id=${pub.id}::uuid and state<>'cancelled'`
    )[0].n,
    1,
  )
  await due()
  await notices.fanoutNotices(sql)
})
test("new Block and a paused preference take effect between queue preparation and sending", async () => {
  await sql`insert into subscriber_publication_exceptions(subscriber_id,publication_id,decision,reason,administrator_id) values(${roomReader}::uuid,${pub.id}::uuid,'block','Blocked after queue preparation',${owner}::uuid)`
  await sql`insert into publication_notice_preferences(subscriber_id,enabled) values(${jan}::uuid,false)`
  const before = sent.length
  await due()
  await drain()
  assert.equal(sent.length, before)
  assert.equal((await jobState(jan)).state, "cancelled")
  assert.equal((await jobState(roomReader)).state, "cancelled")
  await sql`delete from subscriber_publication_exceptions where subscriber_id=${roomReader}::uuid and publication_id=${pub.id}::uuid`
  await sql`update publication_notice_preferences set enabled=true where subscriber_id=${jan}::uuid`
})
test("unknown provider outcomes and interrupted sending leases never automatically resend", async () => {
  await notices.queuePublicationNotice(
    pub.id,
    owner,
    notices.noticeRevision("Revision 3"),
    "Another substantive correction for uncertainty test",
    sql,
  )
  await due()
  let attempts = 0
  await drain({
    send: async () => {
      attempts++
      return {
        status: "unknown",
        message: "Simulated timeout; may have been accepted",
      }
    },
  })
  assert.ok(attempts >= 1)
  const original = attempts
  await sql`update publication_notice_jobs set next_attempt_at=now()-interval '2 days' where state='unknown'`
  await drain({
    send: async () => {
      attempts++
      return { status: "accepted", providerMessageId: "must-not-send" }
    },
  })
  assert.equal(attempts, original)
  const [event] =
    await sql`select id from publication_notice_events where revision_key=${notices.noticeRevision("Revision 3")}`
  await sql`update publication_notice_jobs set state='sending',lease_token=gen_random_uuid(),lease_until=now()-interval '1 minute' where subscriber_id=${jan}::uuid and event_id=${event.id}::uuid`
  await drain()
  assert.equal((await jobState(jan)).state, "unknown")
})
test("withdrawal, subscription expiry and Allow/Block follow the current shared access policy", async () => {
  await sql`insert into subscriber_publication_exceptions(subscriber_id,publication_id,decision,reason,administrator_id) values(${may}::uuid,${pub.id}::uuid,'allow','An individually approved historical issue',${owner}::uuid)`
  assert.equal(
    (await notices.notificationEligibility(may, pub.id, sql)).state,
    "ready",
  )
  await sql`update subscribers set term_end='2026-01-31' where id=${may}::uuid`
  assert.equal(
    (await notices.notificationEligibility(may, pub.id, sql)).state,
    "excluded",
    "Allow never reactivates an expired subscription",
  )
  await sql`update documents set paid_release_state='withheld' where id=${pub.id}::uuid`
  assert.equal(
    (await notices.notificationEligibility(jan, pub.id, sql)).state,
    "excluded",
  )
  await due()
  assert.equal((await drain()).accepted, 0)
  await sql`update documents set paid_release_state='released' where id=${pub.id}::uuid`
})
test("the final access fence detects an entitlement change even before reconciliation finishes", async () => {
  const ready = await notices.notificationEligibility(jan, pub.id, sql)
  assert.equal(ready.state, "ready")
  await sql`insert into subscriber_publication_exceptions(subscriber_id,publication_id,decision,reason,administrator_id) values(${jan}::uuid,${pub.id}::uuid,'block','Concurrent exact-change test',${owner}::uuid)`
  const [changed] =
    await sql`select publication_notice_access_fence(${jan}::uuid,${pub.id}::uuid) as fence`
  assert.notEqual(changed.fence, ready.fence)
  await sql`delete from subscriber_publication_exceptions where subscriber_id=${jan}::uuid and publication_id=${pub.id}::uuid`
})
test("the claim rechecks the Lagos day even if midnight passes after policy evaluation", async () => {
  await notices.queuePublicationNotice(pub.id, owner, notices.noticeRevision("Midnight-proof"), "Approved proof of the final term boundary", sql)
  await due()
  await notices.fanoutNotices(sql)
  let claims=0,sends=0
  const nextDay=async(strings,...values)=>{
    if(strings.join("").includes("state='sending',attempts=")){
      claims++
      // Move only the SQL claim's clock past these terms. Policy inputs and
      // their fingerprint do not change, just as at the midnight boundary.
      const future=strings.map(part=>part.replaceAll("(now() at time zone 'Africa/Lagos')::date", "'2100-01-01'::date"))
      return sql(future,...values)
    }
    return sql(strings,...values)
  }
  await notices.drainPublicationNotices({sql:nextDay,paceMs:0,send:async()=>{sends++;return {status:"accepted",providerMessageId:"unexpected-midnight-send"}}})
  assert.ok(claims>0)
  assert.equal(sends,0)
})
test("the notification cron accepts the header secret and rejects a URL secret", async () => {
  process.env.CRON_SECRET = randomBytes(24).toString("hex")
  assert.equal(
    (
      await worker.GET(
        new Request(`https://test.invalid?secret=${process.env.CRON_SECRET}`),
      )
    ).status,
    401,
  )
  const headers = { authorization: `Bearer ${process.env.CRON_SECRET}` }
  const unavailable = await worker.GET(
    new Request("https://test.invalid", { headers }),
  )
  assert.equal(
    unavailable.status,
    503,
    "no provider is configured in this isolated test",
  )
  assert.equal((await unavailable.json()).reason, "email_not_configured")
  await notices.setPublicationNotices(
    owner,
    false,
    "Paused after the controlled test",
    sql,
  )
  const paused = await worker.GET(
    new Request("https://test.invalid", { headers }),
  )
  assert.equal(paused.status, 200)
  assert.equal((await paused.json()).reason, "sending_paused")
  await notices.setPublicationNotices(
    owner,
    true,
    "Resume controlled tests from the same baseline",
    sql,
  )
})
test("a provider rate limit is safely retried, but an accepted result is never retried", async () => {
  await notices.queuePublicationNotice(
    pub.id,
    owner,
    notices.noticeRevision("Rate-limit proof"),
    "Approved retry behaviour verification",
    sql,
  )
  await due()
  const keys = []
  const result = await drain({
    send: async (_alert, key) => {
      keys.push(key)
      return {
        status: "rejected",
        message: "Simulated provider rate limit",
        retryable: true,
      }
    },
  })
  assert.equal(result.accepted, 0)
  assert.equal((await jobState(jan)).state, "failed")
  await due()
  const accepted = await drain({
    send: async (_alert, key) => {
      keys.push(key)
      return { status: "accepted", providerMessageId: `retry-proof-${key}` }
    },
  })
  assert.equal(accepted.accepted, 2)
  assert.equal(
    keys.filter((k) => k === keys[0]).length,
    2,
    "same job identity is used after a known refusal",
  )
  await due()
  assert.equal((await drain()).accepted, 0)
})
test("a new subscriber or one onboarded after the announcement gets no historical alert", async () => {
  const event = await notices.queuePublicationNotice(
    pub.id,
    owner,
    notices.noticeRevision("New-seat proof"),
    "Approved verification of announcement audience",
    sql,
  )
  const fresh = await fx.subscriber("fresh", legacy.tier)
  const later = await fx.subscriber("later", legacy.tier)
  await sql`update subscribers set created_at=now()-interval '2 days' where id=${later}::uuid`
  await sql`insert into subscriber_onboarding_messages(subscriber_id,kind) values(${later}::uuid,'welcome')`
  for (const id of [fresh, later])
    await sql`insert into publication_access(subscriber_id,publication_id,link_url) values(${id}::uuid,${pub.id}::uuid,'https://docs.example.invalid/new-reader')`
  await due()
  await notices.fanoutNotices(sql)
  for (const id of [fresh, later])
    assert.equal(
      (
        await sql`select id from publication_notice_jobs where event_id=${event}::uuid and subscriber_id=${id}::uuid`
      ).length,
      0,
    )
})
test("the final compare-and-set refuses an access change immediately before sending", async () => {
  const event = await notices.queuePublicationNotice(
    pub.id,
    owner,
    notices.noticeRevision("CAS-proof"),
    "Approved verification of concurrent access changes",
    sql,
  )
  await due()
  await notices.fanoutNotices(sql)
  let changed = false
  const recipients = []
  const guarded = async (strings, ...values) => {
    if (!changed && strings.join("").includes("state='sending',attempts=")) {
      changed = true
      await sql`insert into subscriber_publication_exceptions(subscriber_id,publication_id,decision,reason,administrator_id) values(${jan}::uuid,${pub.id}::uuid,'block','Access changed immediately before send',${owner}::uuid)`
    }
    return sql(strings, ...values)
  }
  await notices.drainPublicationNotices({
    sql: guarded,
    paceMs: 0,
    send: async (alert, key) => {
      recipients.push(alert.email)
      return { status: "accepted", providerMessageId: `cas-proof-${key}` }
    },
  })
  assert.ok(changed)
  assert.ok(!recipients.includes("notice_test_jan@example.invalid"))
  const [job] =
    await sql`select state from publication_notice_jobs where event_id=${event}::uuid and subscriber_id=${jan}::uuid`
  assert.notEqual(job.state, "accepted")
  await sql`delete from subscriber_publication_exceptions where subscriber_id=${jan}::uuid and publication_id=${pub.id}::uuid`
})

test("a changed saved provider confirmation invalidates an earlier ready decision",async()=>{
  const before=await notices.notificationEligibility(roomReader,pub.id,sql)
  assert.equal(before.state,"ready")
  await sql`update papermark_subscriber_document_links set verification_result='{"state":"mismatch"}'::jsonb where subscriber_id=${roomReader}::uuid`
  const [changed]=await sql`select publication_notice_access_fence(${roomReader}::uuid,${pub.id}::uuid) as fence`
  assert.notEqual(changed.fence,before.fence)
  assert.equal((await notices.notificationEligibility(roomReader,pub.id,sql)).state,"held")
  await sql`update papermark_subscriber_document_links set verification_result='{"state":"found"}'::jsonb where subscriber_id=${roomReader}::uuid`
})
