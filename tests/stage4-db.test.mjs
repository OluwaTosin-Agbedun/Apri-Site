import { before, after, test } from "node:test"
import assert from "node:assert/strict"
import { createHmac, randomBytes } from "node:crypto"
import { registerHooks } from "node:module"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { renderToStaticMarkup } from "react-dom/server"
import bcrypt from "bcryptjs"
import { neon, neonConfig } from "@neondatabase/serverless"
import { startTestDatabase } from "./support/test-database.mjs"
import { act, signIn } from "./publication-metadata-harness.mjs"
import { totp, challengeHash } from "../src/lib/admin-mfa.ts"
registerHooks({load(url,context,next){
  if(!url.startsWith("file:")||!url.endsWith(".tsx"))return next(url,context)
  return {format:"module",source:ts.transpileModule(readFileSync(fileURLToPath(url),"utf8"),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true}
}})

// Own database: forcing the global staff policy must never alter other suites.
const database=await startTestDatabase()
neonConfig.fetchEndpoint=()=>database.endpoint
neonConfig.useSecureWebSocket=false
process.env.DATABASE_URL=database.databaseUrl
const sql=neon(database.databaseUrl)
const security=await import("../src/lib/admin-security.ts")
const session=await import("../src/lib/session.ts")
const dal=await import("../src/lib/dal.ts")
const auth=await import("../src/app/actions/auth.ts")
const actions=await import("../src/app/actions/staff-security.ts")
const operations=await import("../src/lib/operations.ts")
const opsActions=await import("../src/app/actions/operations.ts")
const delivery=await import("../src/lib/email-delivery-inbox.ts")
const retention=await import("../src/lib/privacy-retention.ts")
const reviewMail=await import("../src/lib/review-email-attempts.ts")
const webhook=await import("../src/app/api/resend/webhook/route.ts")
const worker=await import("../src/app/api/cron/operations/route.ts")
const password=randomBytes(18).toString("base64url")
let owner,editor,subscriber,setup,recovery
const token=()=>globalThis.__jars.get(globalThis.__browser)?.get(security.STAFF_CHALLENGE_COOKIE)?.value
const factor=secret=>totp(secret,Math.floor(Date.now()/30_000))
async function ownerSession(){await signIn(session,owner);await session.createSession({adminId:owner,role:"owner",securityVersion:(await security.staffSecurityState(owner)).version,mfaVerified:true})}
before(async()=>{
  const hash=await bcrypt.hash(password,4)
  ;[owner,editor]=await Promise.all(["owner","editor"].map(async(role)=>(await sql`insert into admins(email,name,password_hash,role) values(${`${role}@example.invalid`},${`Test ${role}`},${hash},${role}) returning id`)[0].id))
  subscriber=(await sql`insert into subscribers(email,status,level,public_tier) values('subscriber@example.invalid','active','L1','Individual Access') returning id`)[0].id
})
after(()=>database.stop())

test("legacy staff sessions survive additive migration while owner-only actions re-read the real role",async()=>{
  await signIn(session,editor,"owner")
  assert.equal((await dal.getCurrentAdmin()).role,"editor")
  assert.equal((await act(opsActions.saveOperationsSettings,{ownerId:owner,deputyId:editor,pollHours:"30",queueHours:"6",password})).to,"/admin")
  assert.equal((await sql`select alerts_email_enabled from operations_settings`)[0].alerts_email_enabled,false)
  await signIn(session,null)
  assert.equal((await act(opsActions.saveRetentionPolicy,{bucket:"login_attempts",days:"30",reason:"Approved testing policy",password})).to,"/admin/login")
})
test("authenticator enrolment requires a password, and no full Admin session exists before its code",async()=>{
  await signIn(session,owner)
  assert.ok(!(await act(actions.beginStaffEnrollment,{password:"wrong"})).ok)
  assert.equal(token(),undefined)
  assert.equal((await act(actions.beginStaffEnrollment,{password})).to,"/admin/mfa")
  setup=await security.staffChallengeView(token())
  assert.match(setup.secret,/^[A-Z2-7]{32}$/);recovery=setup.recoveryCodes
  assert.equal(await security.completeStaffChallenge(token(),factor(setup.secret),false),null,"must confirm recovery saved")
  const oldCookie=globalThis.__jars.get(globalThis.__browser).get(session.COOKIE_NAME).value
  assert.equal((await act(actions.verifyStaffMfa,{code:factor(setup.secret),saved:"yes"})).to,"/admin")
  const current=await dal.getCurrentAdmin();assert.equal(current.id,owner)
  const stored=(await sql`select * from admin_security where admin_id=${owner}::uuid`)[0]
  assert.equal(stored.recovery_hashes.length,10);assert.ok(!JSON.stringify(stored).includes(setup.secret));assert.ok(!JSON.stringify(stored).includes(recovery[0]))
  assert.equal(token(),undefined)
  globalThis.__jars.get(globalThis.__browser).set(session.COOKIE_NAME,{value:oldCookie,options:{}})
  assert.equal(await dal.getCurrentAdmin(),null,"pre-enrolment cookie was revoked")
})
test("password login with an enrolled account requires MFA before Admin; same-step OTP cannot be reused",async()=>{
  await signIn(session,null)
  assert.equal((await act(auth.login,{email:"owner@example.invalid",password})).to,"/admin/mfa")
  assert.equal(await dal.getCurrentAdmin(),null)
  assert.equal(await security.completeStaffChallenge(token(),factor(setup.secret),false),null)
  assert.equal((await act(actions.verifyStaffMfa,{code:recovery[0]})).to,"/admin")
  assert.equal((await session.readSession()).mfaVerified,true)
})
test("a recovery code is single-use even with concurrent challenges",async()=>{
  await sql`update admin_security set challenge_issues=0,factor_attempts=0 where admin_id=${owner}::uuid`
  const one=await security.issueStaffChallenge(owner,"verify");const two=await security.issueStaffChallenge(owner,"verify")
  const results=await Promise.all([security.completeStaffChallenge(one,recovery[1],false),security.completeStaffChallenge(two,recovery[1],false)])
  assert.equal(results.filter(Boolean).length,1)
  assert.equal((await sql`select count(*)::int as n from admin_auth_challenges where token_hash in (${challengeHash(one)},${challengeHash(two)}) and consumed_at is not null`)[0].n,1)
})
test("expired, guessed and exhausted challenges cannot open a session; issue budget is atomic",async()=>{
  await sql`update admin_security set challenge_issues=0,factor_attempts=0 where admin_id=${owner}::uuid`
  const challenge=await security.issueStaffChallenge(owner,"verify")
  for(let i=0;i<5;i++)assert.equal(await security.completeStaffChallenge(challenge,"not-a-code",false),null)
  assert.equal(await security.completeStaffChallenge(challenge,recovery[2],false),null)
  const expired=await security.issueStaffChallenge(owner,"verify")
  await sql`update admin_auth_challenges set expires_at=now()-interval '1 second' where token_hash=${challengeHash(expired)}`
  assert.equal(await security.staffChallengeView(expired),null)
  assert.equal(await security.completeStaffChallenge(randomBytes(32).toString("base64url"),recovery[2],false),null)
  await sql`update admin_security set challenge_issues=0 where admin_id=${owner}::uuid`
  const issued=await Promise.all(Array.from({length:8},()=>security.issueStaffChallenge(owner,"verify")))
  assert.equal(issued.filter(Boolean).length,5)
})
test("owners cannot require MFA before active staff enrol; requirement protects new staff and blocks factor removal",async()=>{
  await assert.rejects(security.setStaffMfaPolicy(owner,true),/Every active/)
  const enrol=await security.issueStaffChallenge(editor,"enroll");const view=await security.staffChallengeView(enrol)
  assert.ok(await security.completeStaffChallenge(enrol,factor(view.secret),true))
  await security.setStaffMfaPolicy(owner,true)
  assert.equal((await security.staffSecurityState(owner)).required,true)
  assert.equal(await security.disableStaffMfa(owner,recovery[3]),false)
  const [newStaff]=await sql`insert into admins(email,name,password_hash,role) values('new@example.invalid','New staff',${await bcrypt.hash(password,4)},'editor') returning id`
  await signIn(session,null)
  assert.equal((await act(auth.login,{email:"new@example.invalid",password})).to,"/admin/mfa")
  assert.equal((await security.staffChallengeView(token())).kind,"enroll")
  assert.equal(await dal.getCurrentAdmin(),null)
  await sql`delete from admins where id=${newStaff.id}::uuid`
  await security.setStaffMfaPolicy(owner,false)
})
test("server revocation invalidates copied staff cookies and an inactive account",async()=>{
  await ownerSession();const cookie=globalThis.__jars.get(globalThis.__browser).get(session.COOKIE_NAME)
  await security.revokeStaffSessions(owner,owner)
  assert.equal(await dal.getCurrentAdmin(),null)
  globalThis.__jars.get(globalThis.__browser).set(session.COOKIE_NAME,cookie)
  assert.equal(await dal.getCurrentAdmin(),null)
  await ownerSession();await sql`update admins set is_active=false where id=${owner}::uuid`
  assert.equal(await dal.getCurrentAdmin(),null)
  await sql`update admins set is_active=true where id=${owner}::uuid`
})
test("factor removal cannot win against an enabled policy under a concurrent owner action",async()=>{
  await sql`update admin_security set factor_attempts=0,challenge_issues=0 where admin_id=${owner}::uuid`
  const results=await Promise.allSettled([security.setStaffMfaPolicy(owner,true),security.disableStaffMfa(owner,recovery[4])])
  const state=await security.staffSecurityState(owner)
  assert.ok(!state.required||state.enabled,"requiring MFA must never leave an unenrolled existing owner")
  assert.ok(results[0].status==="rejected"||results[1].value===false,"one side must refuse")
  await security.setStaffMfaPolicy(owner,false)
  if(!state.enabled){
    const challenge=await security.issueStaffChallenge(owner,"enroll");setup=await security.staffChallengeView(challenge);recovery=setup.recoveryCodes
    assert.ok(await security.completeStaffChallenge(challenge,factor(setup.secret),true))
  }
})

test("a signed early delivery report is saved, matched later, deduplicated and cannot regress review status",async()=>{
  process.env.RESEND_WEBHOOK_SECRET=randomBytes(32).toString("base64")
  const id="msg_early_review";const message="provider_early_review";const sent=new Date(Date.now()-10_000);const arrived=new Date()
  const body=JSON.stringify({type:"email.delivered",created_at:arrived.toISOString(),data:{email_id:message}})
  const timestamp=String(Math.floor(Date.now()/1000));const signature=createHmac("sha256",Buffer.from(process.env.RESEND_WEBHOOK_SECRET,"base64")).update(`${id}.${timestamp}.${body}`).digest("base64")
  const request=()=>new Request("https://test.invalid/api/resend/webhook",{method:"POST",body,headers:{"svix-id":id,"svix-timestamp":timestamp,"svix-signature":`v1,${signature}`}})
  assert.equal((await webhook.POST(request())).status,200)
  assert.equal((await sql`select applied_at from email_delivery_inbox where event_id=${id}`)[0].applied_at,null)
  await reviewMail.recordReviewEmailAttempt("library_sign_in","reader@example.invalid",{status:"accepted",providerMessageId:message})
  await sql`update email_delivery_inbox set next_attempt_at=now() where event_id=${id}`
  assert.equal(await delivery.replayDeliveryEvent(id),"applied")
  assert.equal((await webhook.POST(request())).status,200)
  assert.equal((await sql`select count(*)::int as n from email_delivery_inbox where event_id=${id}`)[0].n,1)
  await reviewMail.applyReviewEmailEvent(message,"email.sent",sent)
  const [row]=await sql`select last_event,delivered_at,last_event_at from review_email_attempts where provider_message_id=${message}`
  assert.equal(row.last_event,"delivered");assert.equal(new Date(row.delivered_at).getTime(),arrived.getTime())
  const diagnostics=await delivery.recentEmailDiagnostics()
  assert.match(diagnostics.find(r=>r.recipient==="reader@example.invalid").status,/Delivered to receiving/)
  await reviewMail.recordReviewEmailAttempt("library_sign_in","legacy@example.invalid",{status:"accepted",providerMessageId:"provider_legacy"})
  await reviewMail.applyReviewEmailEvent("provider_legacy","email.delivered",arrived)
  assert.match((await delivery.recentEmailDiagnostics()).find(r=>r.recipient==="legacy@example.invalid").status,/Delivered to receiving/,"pre-inbox delivery evidence remains visible")
})
test("unsigned and oversized webhook bodies never persist; replay waits survive interruption",async()=>{
  assert.equal((await webhook.POST(new Request("https://test.invalid",{method:"POST",body:"{}"}))).status,401)
  assert.equal((await webhook.POST(new Request("https://test.invalid",{method:"POST",body:"x".repeat(262145)}))).status,413)
  await delivery.saveVerifiedDeliveryEvent({id:"msg_pending",messageId:"provider_pending",type:"email.bounced",occurredAt:new Date()})
  await sql`update email_delivery_inbox set lease_token=gen_random_uuid(),lease_until=now()-interval '1 minute' where event_id='msg_pending'`
  assert.equal(await delivery.replayDeliveryEvent("msg_pending"),"waiting")
  assert.equal((await sql`select lease_until from email_delivery_inbox where event_id='msg_pending'`)[0].lease_until,null)
  await assert.rejects(delivery.saveVerifiedDeliveryEvent({id:"bad",messageId:"has an address@example.invalid",type:"email.delivered",occurredAt:new Date()}),/Invalid/)
})
test("subscriber delivery events keep their principal and duplicate collectors cannot count twice",async()=>{
  await sql`insert into client_engagement_events(subscriber_id,event_type,resend_email_id) values(${subscriber}::uuid,'publication_notification_sent','provider_subscriber')`
  await delivery.saveVerifiedDeliveryEvent({id:"msg_subscriber",messageId:"provider_subscriber",type:"email.delivered",occurredAt:new Date()})
  await Promise.all([delivery.replayDeliveryEvent("msg_subscriber"),delivery.replayDeliveryEvent("msg_subscriber")])
  assert.equal((await sql`select count(*)::int as n from client_engagement_events where webhook_event_id='msg_subscriber' and subscriber_id=${subscriber}::uuid`)[0].n,1)
  const noEvidence={delivered:false,bounced:false,complained:false,delayed:false,failed:false}
  assert.match(delivery.deliveryEvidenceStatus("accepted",noEvidence),/no delivery report/)
  assert.match(delivery.deliveryEvidenceStatus("unknown",noEvidence),/may have been accepted/)
})
test("unmatched historical events cannot starve newly matchable delivery reports",async()=>{
  await sql`update email_delivery_inbox set attempts=20,next_attempt_at=now()-interval '1 day' where applied_at is null`
  await delivery.saveVerifiedDeliveryEvent({id:"msg_fair_queue",messageId:"provider_subscriber",type:"email.clicked",occurredAt:new Date()})
  const result=await delivery.drainDeliveryInbox(1)
  assert.equal(result.applied,1)
  assert.ok((await sql`select applied_at from email_delivery_inbox where event_id='msg_fair_queue'`)[0].applied_at)
})

test("health checks observe saved work without provider calls and acknowledgement never resolves an issue",async()=>{
  const findings=await operations.refreshOperations()
  assert.ok(findings.some(f=>f.key==="collector_missing"));assert.ok(findings.some(f=>f.key==="incident_owner"))
  await ownerSession()
  const form=new FormData();form.set("alertKey","collector_missing");await opsActions.acknowledgeOperation(form)
  const [row]=await sql`select acknowledged_at,resolved_at from operations_alerts where alert_key='collector_missing'`
  assert.ok(row.acknowledged_at);assert.equal(row.resolved_at,null)
  await sql`insert into app_settings(key,value) values('papermark_last_poll',${JSON.stringify({at:new Date().toISOString()})}) on conflict(key) do update set value=excluded.value`
  await operations.refreshOperations()
  assert.ok((await sql`select resolved_at from operations_alerts where alert_key='collector_missing'`)[0].resolved_at)
})
test("internal alerts are off by default; concurrent workers send once and unknown outcomes never retry",async()=>{
  let calls=0
  const makeSend=()=>async()=>{calls++;return {data:{id:"operations_provider"}}}
  assert.deepEqual(await operations.sendOperationsAlerts(sql,makeSend),{accepted:0,attempted:0})
  assert.equal(calls,0)
  await sql`delete from operations_alerts`
  await sql`update operations_settings set incident_owner_id=${owner}::uuid,deputy_id=${editor}::uuid,alerts_email_enabled=true`
  await sql`insert into operations_alerts(alert_key,severity,message,notification_state) values('test_issue','attention','Test issue','pending')`
  await Promise.all([operations.sendOperationsAlerts(sql,makeSend),operations.sendOperationsAlerts(sql,makeSend)])
  assert.equal(calls,1)
  await sql`insert into operations_alerts(alert_key,severity,message,notification_state) values('uncertain_issue','attention','Uncertain issue','pending')`
  await operations.sendOperationsAlerts(sql,()=>async()=>{calls++;throw new Error("simulated network fault")})
  await operations.sendOperationsAlerts(sql,makeSend)
  assert.equal(calls,2)
  assert.equal((await sql`select notification_state from operations_alerts where alert_key='uncertain_issue'`)[0].notification_state,"unknown")
  await sql`update operations_settings set alerts_email_enabled=false`
})
test("operations worker requires the header secret, not a URL secret",async()=>{
  process.env.CRON_SECRET=randomBytes(24).toString("hex")
  assert.equal((await worker.GET(new Request(`https://test.invalid?secret=${process.env.CRON_SECRET}`))).status,401)
  assert.equal((await worker.GET(new Request("https://test.invalid",{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}}))).status,200)
})

test("retention has no defaults and cannot remove active tokens, sessions, contracts or access rules",async()=>{
  assert.equal(await retention.previewRetention(owner,"subscriber_tokens"),null)
  await sql`insert into auth_tokens(subscriber_id,token_hash,expires_at) values(${subscriber}::uuid,'old-token',now()-interval '40 days'),(${subscriber}::uuid,'live-token',now()+interval '1 day')`
  await retention.approveRetention(owner,"subscriber_tokens",30,"Approved technical credential retention")
  const preview=await retention.previewRetention(owner,"subscriber_tokens")
  assert.equal(preview.count,1)
  assert.equal(await retention.executeRetention(editor,preview.token),null,"preview is owner-bound")
  assert.equal(await retention.executeRetention(owner,preview.token+"x"),null,"signed preview cannot be altered")
  assert.equal(await retention.executeRetention(owner,preview.token),1)
  assert.equal(await retention.executeRetention(owner,preview.token),null,"replay sees changed count")
  assert.equal((await sql`select token_hash from auth_tokens where subscriber_id=${subscriber}::uuid`)[0].token_hash,"live-token")
  assert.equal((await sql`select count(*)::int as n from subscribers where id=${subscriber}::uuid`)[0].n,1)
  assert.equal(retention.isRetentionBucket("subscribers"),false)
  assert.equal(retention.isRetentionBucket("auth_tokens; drop table admins"),false)
})
test("a changed policy or concurrent deletion invalidates the cleanup preview and cleanup is bounded",async()=>{
  await retention.approveRetention(owner,"login_attempts",30,"Approved old sign-in attempt records")
  await sql`insert into login_attempts(email_key,successful,created_at) select 'old@example.invalid',false,now()-interval '40 days' from generate_series(1,1005)`
  let preview=await retention.previewRetention(owner,"login_attempts")
  await retention.approveRetention(owner,"login_attempts",60,"Updated approved period for attempts")
  assert.equal(await retention.executeRetention(owner,preview.token),null)
  await retention.approveRetention(owner,"login_attempts",30,"Restored approved period for attempts")
  preview=await retention.previewRetention(owner,"login_attempts")
  const results=await Promise.all([retention.executeRetention(owner,preview.token),retention.executeRetention(owner,preview.token)])
  assert.equal(results.filter(v=>v===1000).length,1)
  assert.equal(results.filter(v=>v===null).length,1)
  assert.equal((await sql`select count(*)::int as n from login_attempts where created_at<now()-interval '30 days'`)[0].n,5)
})
test("cleanup previews preserve Postgres microseconds instead of failing only on the real database",async()=>{
  await sql`update privacy_retention_policies set approved_at='2026-11-15T10:11:12.123456Z'::timestamptz where bucket='login_attempts'`
  const preview=await retention.previewRetention(owner,"login_attempts")
  assert.equal(preview.count,5)
  assert.equal(await retention.executeRetention(owner,preview.token),5)
})
test("the recovery comparison detects changed access rows even with the same row counts",async()=>{
  const {accessSnapshot,compareSnapshots}=await import("../scripts/verify-restored-access.mjs")
  const source=await accessSnapshot(sql)
  assert.ok(compareSnapshots(source,await accessSnapshot(sql)).every(row=>row.matches))
  await sql`update subscribers set organization='Changed restore fixture' where id=${subscriber}::uuid`
  const compared=compareSnapshots(source,await accessSnapshot(sql))
  assert.equal(compared.find(row=>row.table==="subscribers").matches,false)
  assert.equal(compared.find(row=>row.table==="subscribers").sourceCount,compared.find(row=>row.table==="subscribers").restoredCount)
})
test("staff pages enforce role checks and render diagnostics without codes, keys, raw addresses or source links",async()=>{
  const OperationsPage=(await import("../src/app/admin/operations/page.tsx")).default
  const SecurityPage=(await import("../src/app/admin/security/page.tsx")).default
  await signIn(session,null)
  await assert.rejects(OperationsPage(),e=>String(e.digest).includes("/admin/login"))
  await signIn(session,editor,"owner")
  await session.createSession({adminId:editor,role:"owner",securityVersion:(await security.staffSecurityState(editor)).version,mfaVerified:true})
  await assert.rejects(OperationsPage(),e=>String(e.digest).includes("/admin;"))
  await ownerSession()
  const operationsHtml=renderToStaticMarkup(await OperationsPage())
  assert.match(operationsHtml,/Recent email outcomes/);assert.match(operationsHtml,/Privacy and bounded cleanup/)
  assert.ok(!operationsHtml.includes(setup.secret));assert.ok(!operationsHtml.includes(recovery[0]))
  assert.ok(!operationsHtml.includes("reader@example.invalid"));assert.ok(!operationsHtml.includes("provider_subscriber"))
  const securityHtml=renderToStaticMarkup(await SecurityPage())
  assert.match(securityHtml,/Staff sign-in security/);assert.ok(!securityHtml.includes(setup.secret))
})
test("concurrent password confirmations share one persisted five-failure allowance",async()=>{
  const {confirmStaffPassword}=await import("../src/lib/staff-password.ts")
  await sql`delete from login_attempts where email_key='editor@example.invalid'`
  assert.ok((await Promise.all(Array.from({length:9},()=>confirmStaffPassword(editor,"incorrect password")))).every(v=>v===false))
  assert.equal((await sql`select count(*)::int as n from login_attempts where email_key='editor@example.invalid' and successful=false`)[0].n,5)
  assert.equal(await confirmStaffPassword(editor,password),false)
})
test("before the migration legacy staff still enter, versioned sessions fail closed and new controls stay unavailable",async()=>{
  await signIn(session,owner)
  await sql`alter table admin_auth_challenges rename to hidden_test_challenges`
  await assert.rejects(dal.getCurrentAdmin(),/schema is incomplete/,"losing one table must not reactivate an old legacy cookie")
  await sql`alter table hidden_test_challenges rename to admin_auth_challenges`
  await sql`drop table admin_auth_challenges,admin_security,admin_security_policy,operations_settings,operations_alerts,email_delivery_inbox cascade`
  await assert.rejects(dal.getCurrentAdmin(),/schema is missing after activation/)
  await sql`delete from app_settings where key='staff_security_schema_v1'`
  await signIn(session,owner)
  assert.equal((await dal.getCurrentAdmin()).id,owner)
  await session.createSession({adminId:owner,role:"owner",securityVersion:0,mfaVerified:false})
  assert.equal(await dal.getCurrentAdmin(),null)
  assert.equal(await operations.operationsReady(),false)
})
