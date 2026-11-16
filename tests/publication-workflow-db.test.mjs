import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import bcrypt from 'bcryptjs'
import {neon,neonConfig} from '@neondatabase/serverless'
import {startTestDatabase} from './support/test-database.mjs'
import {fixtures,signIn,act} from './publication-metadata-harness.mjs'
const db=await startTestDatabase()
neonConfig.fetchEndpoint=()=>db.endpoint
process.env.DATABASE_URL=db.databaseUrl
const sql=neon(db.databaseUrl),fx=fixtures(sql,'workflow_test')
const workflow=await import('../src/lib/publication-workflow.ts')
const corrections=await import('../src/lib/publication-corrections.ts')
const actions=await import('../src/app/actions/publication-workflow.ts')
const documents=await import('../src/app/actions/documents.ts')
const session=await import('../src/lib/session.ts')
const access=await import('../src/lib/access-policy-dal.ts')
const versions=await import('../src/lib/publication-versions.ts')
const password=randomBytes(20).toString('hex')
let owner,owner2,editor,plan,jan,may,other,old,corrected
const actor=id=>({id,name:id===owner?'Owner one':id===owner2?'Owner two':'Editor',role:id===editor?'editor':'owner'})
const wf=(id,kind='paid')=>workflow.loadWorkflow(kind,id,sql)
async function draft(key,{date='2026-02-01',series='MIN',kind='paid'}={}){
  if(kind==='review'){
    const [r]=await sql`insert into review_publication_editions(series,title,edition_date,papermark_document_id,secure_link_id,secure_link_url,secure_link_document_id,secure_link_verified_at,publication_state,recipient_mode) values(${series},${`Review ${key}`},${date}::date,${`wf_review_${key}`},${`wf_link_${key}`},${`https://docs.example.invalid/${key}`},${`wf_review_${key}`},now(),'draft','edition') returning id`
    return r
  }
  const r=await fx.edition(key,{title:`Edition ${key}`,series,date,forTiers:[plan.tier],dataroom:plan.dataroom,status:'draft',release:'withheld'})
  await sql`update documents set papermark_document_id=${r.papermarkDocumentId},author_editor='Test research editor',covered_period_start='2026-01-01',covered_period_end='2026-01-31',information_cutoff='2026-02-01',reading_time_minutes=10 where id=${r.id}::uuid`
  return r
}
async function details(id,kind='paid',who=owner){const w=await wf(id,kind);return workflow.saveWorkflowDetails(kind,id,actor(who),w.revision,{version:'1.1',provenance:'Editorially verified official source material',author:'Test reviewer',start:'2026-01-01',end:'2026-01-31',cutoff:'2026-02-01',minutes:10,issueDate:'2026-02-01'},sql)}
async function approve(id,kind='paid'){
  let w=await wf(id,kind)
  if(!w)await workflow.startPublicationWorkflow(kind,id,actor(owner),'Start controlled editorial review for this draft',sql)
  await details(id,kind)
  w=await wf(id,kind)
  assert.equal((await workflow.transitionPublicationWorkflow(kind,id,actor(editor),w.revision,'submit','Ready for independent owner editorial review',sql)).ok,true)
  w=await wf(id,kind)
  assert.equal((await workflow.transitionPublicationWorkflow(kind,id,actor(owner),w.revision,'approve','Editorial content and PDF source reviewed by owner',sql)).ok,true)
  return wf(id,kind)
}
async function release(id){await signIn(session,owner);const form=new FormData();form.set('publicationId',id);form.set('state','released');form.append('plans',plan.tier);return documents.saveEditionAvailability(undefined,form)}
before(async()=>{
  owner=await fx.admin('owner');owner2=await fx.admin('owner');editor=await fx.admin('editor')
  await sql`update admins set password_hash=${await bcrypt.hash(password,4)} where id=any(${[owner,owner2,editor]}::uuid[])`
  plan={tier:'Individual Access',dataroom:'workflow_test_room'}
  await sql`insert into papermark_level_rooms(public_tier,papermark_dataroom_id,dataroom_name) values(${plan.tier},${plan.dataroom},'Workflow test library')`
  jan=await fx.subscriber('jan',plan.tier);may=await fx.subscriber('may',plan.tier,'2026-05-01');other=await fx.subscriber('other','A different plan')
  old=await fx.edition('old',{title:'Original February edition',date:'2026-02-01',forTiers:[plan.tier],dataroom:plan.dataroom})
  await sql`update documents set papermark_document_id=${old.papermarkDocumentId} where id=${old.id}::uuid`
  corrected=await draft('corrected')
})
after(()=>db.stop())
test('public and reader publication dates are renderable calendar-day strings, including an edition with no display label',async()=>{
  const pubs=await import('../src/lib/publications.ts')
  const {createElement}=await import('react')
  const {renderToStaticMarkup}=await import('react-dom/server')
  const paid=await draft('date-dto')
  await sql`update documents set status='published',is_published=true where id=${paid.id}::uuid`
  const review=await draft('date-dto',{kind:'review',series:'AIU'})
  const email='wf_date_dto@example.invalid'
  await sql`insert into app_settings(key,value) values('review_library_enabled','true') on conflict(key) do update set value='true'`
  await sql`update review_publication_editions set publication_state='published',complimentary_featured=true,edition_label='' where id=${review.id}::uuid`
  await sql`insert into review_edition_recipients(edition_id,email,source) values(${review.id}::uuid,${email},'owner')`
  const cards=[
    (await pubs.getPublishedPublications()).find(p=>p.id===paid.id),
    (await pubs.getPublicationBySlug(paid.slug)),
    (await pubs.getReviewLibrary())?.items.find(p=>p.id===review.id),
    (await pubs.getReviewPublicationArchive()).find(p=>p.id===review.id),
    (await pubs.getReviewLibraryForEmail(email)).find(p=>p.id===review.id),
    await pubs.getReviewEditionForEmail(email,review.id),
  ]
  for(const card of cards){
    assert.ok(card,'each configured publication read returns the expected record')
    assert.equal(card.editionDate,'2026-02-01')
    assert.equal(renderToStaticMarkup(createElement('p',null,card.editionDate)),'<p>2026-02-01</p>')
  }
})
test('existing released records and subscriber terms are unchanged; new first releases are held',async()=>{
  assert.equal((await workflow.publishingGate('paid',old.id,actor(editor),sql)).ok,true)
  assert.equal(await wf(old.id),null)
  const r=await draft('first')
  await signIn(session,owner)
  const result=await release(r.id)
  assert.equal(result.ok,undefined);assert.match(result.message,/editorial|approval/i)
  assert.equal((await sql`select paid_release_state from documents where id=${r.id}::uuid`)[0].paid_release_state,'withheld')
  assert.equal(await wf(r.id),null,'a refused release does not secretly create an editorial record')
  assert.equal((await sql`select to_char(term_start,'YYYY-MM-DD') as start from subscribers where id=${may}::uuid`)[0].start,'2026-05-01')
})
test('the server re-reads roles; anonymous and forged owner cookies cannot approve',async()=>{
  const r=await draft('roles');await workflow.startPublicationWorkflow('paid',r.id,actor(owner),'Owner starts a draft editorial record',sql);await details(r.id)
  let w=await wf(r.id);await workflow.transitionPublicationWorkflow('paid',r.id,actor(editor),w.revision,'submit','Submitted for owner editorial approval',sql);w=await wf(r.id)
  await signIn(session,editor,'owner')
  assert.equal((await act(actions.changePublicationWorkflow,{intent:'approve',revision:w.revision,reason:'Attempt with forged owner claim',password},'paid',r.id)).to,'/admin')
  await signIn(session,null)
  assert.equal((await act(actions.changePublicationWorkflow,{intent:'approve'},'paid',r.id)).to,'/admin/login')
  assert.equal((await wf(r.id)).state,'in_review')
})
test('approval needs the exact submitted content, records who decided, and never publishes or grants access',async()=>{
  const r=await draft('approve');const w=await approve(r.id)
  assert.equal(w.state,'approved');assert.equal(w.approvedHash,w.currentHash)
  const [row]=await sql`select paid_release_state,status from documents where id=${r.id}::uuid`
  assert.equal(row.paid_release_state,'withheld');assert.equal(row.status,'draft')
  assert.equal((await sql`select count(*)::int as n from papermark_subscriber_document_links where papermark_document_id=${r.papermarkDocumentId}`)[0].n,0)
  assert.equal((await sql`select actor_id from publication_workflow_events where workflow_id=${w.id}::uuid and action='approve'`)[0].actor_id,owner)
})
test('missing metadata, invalid dates and stale revisions are refused; concurrent approvals have one winner',async()=>{
  const r=await draft('missing',{series:''});await workflow.startPublicationWorkflow('paid',r.id,actor(owner),'Start draft with deliberately missing category',sql);await details(r.id)
  const w=await wf(r.id);const rejected=await workflow.transitionPublicationWorkflow('paid',r.id,actor(editor),w.revision,'submit','Try to submit an incomplete editorial record',sql)
  assert.equal(rejected.ok,false);assert.match(rejected.message,/category/i)
  const r2=await draft('concurrent');await workflow.startPublicationWorkflow('paid',r2.id,actor(owner),'Start concurrent approval proof',sql);await details(r2.id)
  let w2=await wf(r2.id);await workflow.transitionPublicationWorkflow('paid',r2.id,actor(editor),w2.revision,'submit','Ready for owner review concurrently',sql);w2=await wf(r2.id)
  const results=await Promise.all([owner,owner2].map(id=>workflow.transitionPublicationWorkflow('paid',r2.id,actor(id),w2.revision,'approve','Independently reviewed this exact draft',sql)))
  assert.equal(results.filter(r=>r.ok).length,1)
})
test('material edits clear approval; a source or tag changed after submission cannot be released',async()=>{
  const r=await draft('stale');let w=await approve(r.id)
  await sql`update documents set title='Changed after owner approval' where id=${r.id}::uuid`
  assert.equal((await wf(r.id)).state,'draft')
  assert.equal((await release(r.id)).ok,undefined)
  w=await approve(r.id)
  const tag=await fx.tag('subject','Policy');await fx.assign(r.id,tag.id)
  assert.equal((await workflow.publishingGate('paid',r.id,actor(owner),sql)).ok,false)
  await assert.rejects(sql.transaction([...workflow.releasePreconditions(sql,'paid',r.id,actor(owner),w),sql`update documents set paid_release_state='released' where id=${r.id}::uuid`]),/approved|changed/i)
  assert.equal((await sql`select paid_release_state from documents where id=${r.id}::uuid`)[0].paid_release_state,'withheld')
})
test('a real guarded release freezes its date/source/snapshot and retains append-only decisions',async()=>{
  const r=await draft('release');await approve(r.id);assert.equal((await release(r.id)).ok,true)
  const w=await wf(r.id);assert.equal(w.everPublished,true);assert.equal(w.state,'published')
  await assert.rejects(sql`update documents set edition_date='2026-05-01' where id=${r.id}::uuid`,/issue date/i)
  await assert.rejects(sql`update documents set papermark_document_id='different-master' where id=${r.id}::uuid`,/PDF source/i)
  await assert.rejects(sql`update publication_workflows set frozen_snapshot='{}'::jsonb where id=${w.id}::uuid`,/immutable/i)
  await assert.rejects(sql`delete from publication_workflow_events where workflow_id=${w.id}::uuid`,/append-only/i)
  await assert.rejects(sql`delete from documents where id=${r.id}::uuid`,/foreign key/i)
})
test('corrections require a distinct PDF and original issue date; exact inheritance is explicit and keeps Block',async()=>{
  await sql`insert into subscriber_publication_exceptions(subscriber_id,publication_id,decision,reason,administrator_id) values(${may}::uuid,${old.id}::uuid,'allow','Named permission for an earlier issue',${owner}::uuid),(${other}::uuid,${old.id}::uuid,'block','No access to this publication',${owner}::uuid)`
  await workflow.startPublicationWorkflow('paid',old.id,actor(owner),'Adopt original for exact correction preview',sql)
  await workflow.startPublicationWorkflow('paid',corrected.id,actor(owner),'Create separately identified correction draft',sql)
  let preview=await corrections.correctionPreview('paid',old.id,corrected.id,sql)
  assert.equal(preview.exceptions,2)
  await assert.rejects(corrections.prepareCorrection('paid',old.id,corrected.id,'stale',actor(owner),'Explicit correction inheritance approval',sql),/preview changed/i)
  await corrections.prepareCorrection('paid',old.id,corrected.id,preview.fingerprint,actor(owner),'Explicitly copy the exact audience to the correction',sql)
  assert.deepEqual((await sql`select subscriber_id,decision from subscriber_publication_exceptions where publication_id=${corrected.id}::uuid order by subscriber_id`),(await sql`select subscriber_id,decision from subscriber_publication_exceptions where publication_id=${old.id}::uuid order by subscriber_id`))
  const wrong=await draft('wrongdate',{date:'2026-05-01'})
  await assert.rejects(corrections.correctionPreview('paid',old.id,wrong.id,sql),/original issue date/i)
  await approve(corrected.id)
  assert.equal((await release(corrected.id)).ok,undefined,'notice and retirements must hold promotion')
})
test('one owner cannot self-verify a notice; a verified copy is selected without changing the original source history',async()=>{
  const w=await wf(old.id)
  await sql`insert into papermark_dataroom_documents(papermark_dataroom_id,papermark_document_id,title,category,version_key) values(${plan.dataroom},'wf_notice_old','Superseded original.pdf','MIN','notice-v1')`
  const proof={documentId:'wf_notice_old',sourceHash:'a'.repeat(64),noticeHash:'b'.repeat(64),pages:4,currentUrl:'https://apri.athenacentre.org/portal/publication/'+old.id}
  await corrections.recordNoticeProof('paid',old.id,actor(owner),proof,'Inspected the uploaded embedded notice proof',sql)
  let prepared=await wf(old.id)
  await assert.rejects(corrections.verifyNoticeProof('paid',old.id,actor(owner),prepared.revision,'Attempt to verify my own PDF preparation',sql),/different active owner/i)
  await corrections.verifyNoticeProof('paid',old.id,actor(owner2),prepared.revision,'Independently checked every page and personalised copy protection',sql)
  assert.equal((await wf(old.id)).noticeReady,true)
  const [frozen]=await sql`select original_source_ids from publication_workflows where id=${w.id}::uuid`
  assert.ok(frozen.original_source_ids.includes(old.papermarkDocumentId))
  assert.equal((await sql`select papermark_document_id from documents where id=${old.id}::uuid`)[0].papermark_document_id,'wf_notice_old')
  const resolved=await access.loadSubscriberAccess(jan)
  assert.equal(resolved.state,'ok');assert.equal(resolved.documents.find(d=>d.publicationId===old.id).papermarkDocumentId,'wf_notice_old')
  assert.ok(!resolved.documents.some(d=>d.papermarkDocumentId===old.papermarkDocumentId))
})
test('manual unmanaged-link evidence needs two owners; a pending check never counts as revoked',async()=>{
  const w=await wf(old.id),[job]=await sql`select id from publication_version_retirements where workflow_id=${w.id}::uuid and kind='manual'`
  await corrections.attestManualRetirement(job.id,actor(owner),'Checked Papermark and retired all unmanaged original links',sql)
  assert.equal((await sql`select state from publication_version_retirements where id=${job.id}::uuid`)[0].state,'awaiting_manual')
  await assert.rejects(corrections.attestManualRetirement(job.id,actor(owner),'Repeat my own manual provider evidence check',sql),/different owner/i)
  assert.equal((await release(corrected.id)).ok,undefined)
  await corrections.attestManualRetirement(job.id,actor(owner2),'Independently verified old raw links no longer open',sql)
  assert.equal((await sql`select confirmation_method from publication_version_retirements where id=${job.id}::uuid`)[0].confirmation_method,'two_person_manual')
})
test('a changed target audience rolls back release; the exact reviewed audience promotes to the current version',async()=>{
  await sql`delete from publication_plans where publication_id=${corrected.id}::uuid`
  assert.equal((await release(corrected.id)).ok,undefined)
  await sql`insert into publication_plans(publication_id,public_tier,source) values(${corrected.id}::uuid,${plan.tier},'admin')`
  {const w=await wf(corrected.id);await sql`select assert_publication_editorial_approval('paid',${corrected.id}::uuid,${owner}::uuid,${w.revision}::bigint)`;const result=await release(corrected.id);assert.equal(result.ok,true,result.message)}
  const w=await wf(corrected.id)
  assert.equal((await sql`select current_workflow_id from publication_families where id=${w.familyId}::uuid`)[0].current_workflow_id,w.id)
  const a=await access.loadSubscriberAccess(may)
  assert.equal(a.documents.find(d=>d.publicationId===corrected.id).decision.outcome,'allowed','inherited explicit Allow remains scoped to this reader')
  const b=await access.loadSubscriberAccess(other)
  assert.ok(!b.documents.some(d=>d.publicationId===corrected.id&&d.decision.outcome==='allowed'))
  const legacy=await access.loadLegacyPublicationAccess(other)
  assert.equal(legacy.items.find(d=>d.publicationId===corrected.id)?.decision.outcome,'excluded')
  const map=await versions.publicationVersions('paid',[old.id,corrected.id],sql)
  assert.deepEqual(versions.latestEntitledVersions([{id:old.id},{id:corrected.id}],x=>x.id,map).map(x=>x.id),[corrected.id])
  assert.deepEqual(versions.latestEntitledVersions([{id:old.id}],x=>x.id,map).map(x=>x.id),[old.id],'a version relationship cannot supply a missing entitlement')
})
test('archiving records the actual state and a re-offer returns to draft without erasing its immutable snapshot',async()=>{
  await signIn(session,owner);await documents.setDocumentStatus(corrected.id,'archived')
  assert.equal((await wf(corrected.id)).state,'archived')
  await documents.setDocumentStatus(corrected.id,'draft')
  const w=await wf(corrected.id);assert.equal(w.state,'draft');assert.equal(w.everPublished,true)
  await assert.rejects(sql`update publication_workflows set original_issue_date='2026-06-01' where id=${w.id}::uuid`,/immutable/i)
})
test('complimentary review has its own metadata and approval; a removed or unassigned reader is not inherited implicitly',async()=>{
  const r=await draft('review-new',{kind:'review'})
  await workflow.startPublicationWorkflow('review',r.id,actor(owner),'Start complimentary edition editorial record',sql)
  let w=await wf(r.id,'review')
  assert.equal((await workflow.transitionPublicationWorkflow('review',r.id,actor(owner),w.revision,'submit','Try incomplete complimentary draft submission',sql)).ok,false)
  await approve(r.id,'review')
  assert.equal((await wf(r.id,'review')).state,'approved')
  assert.equal((await sql`select publication_state from review_publication_editions where id=${r.id}::uuid`)[0].publication_state,'draft')
  assert.equal((await sql`select count(*)::int as n from review_edition_recipients where edition_id=${r.id}::uuid`)[0].n,0)
})
test('an undated existing review stays accessible and unfrozen until its owner records the original date',async()=>{
  const r=await draft('undated-review',{kind:'review'}),review=await import('../src/app/actions/review-library.ts')
  await sql`update review_publication_editions set publication_state='published',edition_date=null where id=${r.id}::uuid`
  await assert.rejects(workflow.startPublicationWorkflow('review',r.id,actor(owner),'Attempt to freeze an undated existing publication',sql),/original issue date/)
  assert.equal(await wf(r.id,'review'),null)
  await signIn(session,owner)
  const saved=await review.updateEditionDetails(r.id,{series:'MIN',editionLabel:'February 2026',editionDate:'2026-02-01',title:'Recorded original review date',publicationType:'Monthly Intelligence Note',description:'The existing approved review publication.',frequency:'Monthly',audience:'Approved readers'})
  assert.equal(saved.ok,true)
  const adopted=await workflow.startPublicationWorkflow('review',r.id,actor(owner),'Adopt after the owner verified the original issue date',sql)
  assert.equal(adopted.originalDate,'2026-02-01')
  const changed=await review.updateEditionDetails(r.id,{series:'MIN',editionLabel:'February 2026',editionDate:'2026-05-01',title:'Recorded original review date',publicationType:'Monthly Intelligence Note',description:'The existing approved review publication.',frequency:'Monthly',audience:'Approved readers'})
  assert.match(changed.message,/original issue date/)
  assert.equal((await sql`select to_char(edition_date,'YYYY-MM-DD') as date from review_publication_editions where id=${r.id}::uuid`)[0].date,'2026-02-01')
})
test('old first-party document bookmarks resolve only to this reader’s authorised notice copy',async()=>{
  const client=await import('../src/lib/papermark-client-library.ts')
  await sql`insert into papermark_subscriber_document_links(subscriber_id,papermark_document_id,papermark_link_id,link_url,assigned_email) values(${jan}::uuid,'wf_notice_old','wf_notice_jan','https://docs.example.invalid/notice-jan','workflow_test_jan@example.invalid')`
  const found=await client.getDataRoomDocumentForSubscriber(jan,old.documentRowId)
  assert.equal(found.document.papermarkDocumentId,'wf_notice_old')
  assert.equal(found.documentLinkUrl,'https://docs.example.invalid/notice-jan')
  assert.equal(await client.getDataRoomDocumentForSubscriber(other,old.documentRowId),null)
})
test('provider deletion without a confirming 404 remains pending; a later 404 confirms the job and local link together',async()=>{
  const w=await wf(old.id)
  await sql`insert into papermark_subscriber_document_links(subscriber_id,papermark_document_id,papermark_link_id,link_url) values(${jan}::uuid,${old.papermarkDocumentId},'wf_retire_old','https://docs.example.invalid/raw-old')`
  const [job]=await sql`insert into publication_version_retirements(workflow_id,link_id,identity_hash,expected_document_ids,kind,subscriber_id) values(${w.id}::uuid,'wf_retire_old','test-known-delete',${[old.papermarkDocumentId]}::text[],'paid_personal',${jan}::uuid) returning id`
  let deletes=0
  const result=await corrections.drainVersionRetirements({maxJobs:1,readLink:async()=>({state:'found',documentId:old.papermarkDocumentId,dataroomId:null,targetType:'document',expiresAt:null}),revokeLink:async()=>{deletes++;return {ok:true,value:true}}},sql)
  assert.equal(result.confirmed,0);assert.equal(deletes,1)
  assert.equal((await sql`select state from publication_version_retirements where id=${job.id}::uuid`)[0].state,'pending')
  assert.equal((await sql`select revoke_state from papermark_subscriber_document_links where papermark_link_id='wf_retire_old'`)[0].revoke_state,'live')
  await sql`update publication_version_retirements set next_attempt_at=now() where id=${job.id}::uuid`
  const confirmed=await corrections.drainVersionRetirements({maxJobs:1,readLink:async()=>({state:'gone'}),revokeLink:async()=>{throw Error('A 404 must not cause another delete')}},sql)
  assert.equal(confirmed.confirmed,1)
  assert.equal((await sql`select confirmation_method from publication_version_retirements where id=${job.id}::uuid`)[0].confirmation_method,'provider')
  assert.equal((await sql`select revoke_state from papermark_subscriber_document_links where papermark_link_id='wf_retire_old'`)[0].revoke_state,'revoked')
})
test('rate-limited reads retain a saved retry and expired leases are reclaimed without an email or new link',async()=>{
  const w=await wf(old.id),retryAt=Date.now()+3600000
  const [job]=await sql`insert into publication_version_retirements(workflow_id,link_id,identity_hash,expected_document_ids,kind,state,lease_token,lease_until) values(${w.id}::uuid,'wf_retry_old','test-rate-limit',${[old.papermarkDocumentId]}::text[],'paid_personal','running','11111111-1111-4111-8111-111111111111',now()-interval '1 minute') returning id`
  const pending=await corrections.drainVersionRetirements({maxJobs:1,readLink:async()=>({state:'unknown',message:'Provider limit; retry later',retryAt}),revokeLink:async()=>{throw Error('An unknown read cannot delete a link')}},sql)
  assert.equal(pending.waiting,1)
  const [saved]=await sql`select state,lease_token,next_attempt_at from publication_version_retirements where id=${job.id}::uuid`
  assert.equal(saved.state,'pending');assert.equal(saved.lease_token,null);assert.ok(new Date(saved.next_attempt_at).getTime()>=retryAt)
})
test('legacy history requires two owners checking the same protected copy; changing only its provider id invalidates the proof',async()=>{
  const reader=await fx.subscriber('legacy-notice','Professional Team Access')
  await sql`insert into publication_plans(publication_id,public_tier,source) values(${old.id}::uuid,'Professional Team Access','admin')`
  await sql`insert into publication_access(subscriber_id,publication_id,link_url,papermark_link_id) values(${reader}::uuid,${old.id}::uuid,'https://docs.example.invalid/legacy-notice','wf_legacy_notice')`
  const link=async()=>{const a=await access.loadLegacyPublicationAccess(reader);return a.items.find(d=>d.publicationId===old.id)?.linkUrl}
  assert.equal(await link(),null)
  await corrections.attestLegacyNoticeCopy(old.id,reader,actor(owner),'Checked this reader’s protected notice copy in the provider',sql)
  assert.equal(await link(),null)
  await assert.rejects(corrections.attestLegacyNoticeCopy(old.id,reader,actor(owner),'Attempt to independently check my own preparation',sql),/different owner/)
  await corrections.attestLegacyNoticeCopy(old.id,reader,actor(owner2),'Independently checked every notice and personal watermark on this copy',sql)
  assert.equal(await link(),'https://docs.example.invalid/legacy-notice')
  await sql`update publication_access set papermark_link_id='wf_different_notice' where subscriber_id=${reader}::uuid and publication_id=${old.id}::uuid`
  assert.equal(await link(),null)
})
test('review correction preserves exact recipients, its own latest/homepage placement and immediate recipient removal',async()=>{
  const pubs=await import('../src/lib/publications.ts')
  const source=await draft('review-original',{kind:'review'}),target=await draft('review-correction',{kind:'review'})
  const email='wf_approved@example.invalid',otherEmail='wf_other@example.invalid'
  await sql`insert into app_settings(key,value) values('review_library_enabled','true') on conflict(key) do update set value='true'`
  await sql`update review_publication_editions set publication_state='published',is_latest=true,complimentary_featured=true where id=${source.id}::uuid`
  await sql`insert into review_edition_recipients(edition_id,email,source) values(${source.id}::uuid,${email},'owner'),(${target.id}::uuid,${otherEmail},'owner')`
  await workflow.startPublicationWorkflow('review',source.id,actor(owner),'Adopt actual released review source for its correction',sql)
  await workflow.startPublicationWorkflow('review',target.id,actor(owner),'Create the separate review correction editorial record',sql)
  const preview=await corrections.correctionPreview('review',source.id,target.id,sql)
  await corrections.prepareCorrection('review',source.id,target.id,preview.fingerprint,actor(owner),'Explicitly copy only the original review recipient list',sql)
  assert.deepEqual((await sql`select email from review_edition_recipients where edition_id=${target.id}::uuid and revoked_at is null`).map(r=>r.email),[email])
  await approve(target.id,'review')
  let w=await wf(source.id,'review')
  await corrections.recordNoticeProof('review',source.id,actor(owner),{documentId:'wf_review_notice',sourceHash:'c'.repeat(64),noticeHash:'d'.repeat(64),pages:3,currentUrl:'https://apri.athenacentre.org/review/library/current/'+source.id},'Checked the uploaded review notice PDF and its personal protection',sql)
  w=await wf(source.id,'review')
  await corrections.verifyNoticeProof('review',source.id,actor(owner2),w.revision,'Independently verified every page, current link and download watermark',sql)
  w=await wf(source.id,'review')
  await corrections.drainVersionRetirements({workflowId:w.id,maxJobs:2,readLink:async()=>({state:'gone'})},sql)
  const [manual]=await sql`select id from publication_version_retirements where workflow_id=${w.id}::uuid and kind='manual'`
  await corrections.attestManualRetirement(manual.id,actor(owner),'Closed and checked the unmanaged old review raw-source links',sql)
  await corrections.attestManualRetirement(manual.id,actor(owner2),'Independently confirmed unmanaged old review links no longer open',sql)
  // The mock-provider fixture now reports an exact verified notice link.
  // No real Papermark request, email or room change occurs in this test.
  await sql`update review_publication_editions set secure_link_id='wf_review_notice_link',secure_link_url='https://docs.example.invalid/review-notice',secure_link_document_id='wf_review_notice',secure_link_verified_at=now() where id=${source.id}::uuid`
  const ready=await wf(target.id,'review')
  await sql.transaction([...workflow.releasePreconditions(sql,'review',target.id,actor(owner),ready),sql`update review_publication_editions set publication_state='published',is_latest=false where id=${target.id}::uuid`,workflow.recordWorkflowRelease(sql,'review',target.id,actor(owner),ready)])
  const [placement]=await sql`select is_latest,complimentary_featured from review_publication_editions where id=${target.id}::uuid`
  assert.equal(placement.is_latest,true);assert.equal(placement.complimentary_featured,true)
  assert.equal((await sql`select is_latest from review_publication_editions where id=${source.id}::uuid`)[0].is_latest,false)
  const permitted=await pubs.getReviewLibraryForEmail(email),index=await versions.publicationVersions('review',permitted.map(e=>e.id),sql)
  assert.deepEqual(versions.latestEntitledVersions(permitted,e=>e.id,index).map(e=>e.id),[target.id])
  assert.equal(await pubs.getReviewEditionForEmail(otherEmail,target.id),null)
  await sql`update review_edition_recipients set revoked_at=now() where edition_id=${target.id}::uuid and email=${email}`
  assert.equal(await pubs.getReviewEditionForEmail(email,target.id),null)
  assert.ok((await pubs.getReviewLibraryForEmail(email)).every(e=>e.id!==target.id))
})
