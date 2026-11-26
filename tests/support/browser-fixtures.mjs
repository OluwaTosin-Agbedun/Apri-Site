import { randomBytes, randomUUID } from "node:crypto"
import bcrypt from 'bcryptjs'
import { SignJWT } from "jose"
import { neon, neonConfig } from "@neondatabase/serverless"
import { SUBSCRIPTION_CATALOGUE } from "../../src/lib/subscription-catalogue.ts"
import { DEFAULT_CATALOGUE } from "../../src/lib/publication-catalogue.ts"
export async function seedBrowserData(database, secret) {
  neonConfig.fetchEndpoint = () => database.endpoint
  const sql = neon(database.databaseUrl)
  const [owner] =
    await sql`insert into admins(email,name,password_hash,role) values('browser-owner@example.invalid','Test Owner','unused','owner') returning id`
  const staffPassword=randomBytes(20).toString('hex')
  await sql`update admins set password_hash=${await bcrypt.hash(staffPassword,4)} where id=${owner.id}::uuid`
  // Match a deployed installation: creating an owner also closes one-time setup.
  await sql`insert into app_settings(key,value) values('setup_completed','true') on conflict(key) do nothing`
  const [workflowPublication]=await sql`insert into documents(slug,title,series,visibility,status,is_published,paid_release_state,edition_date,papermark_document_id,author_editor,covered_period_start,covered_period_end,information_cutoff,reading_time_minutes)
    values('browser-editorial-draft','Test editorial workflow','MIN','L1','draft',false,'withheld','2026-08-01','browser-workflow-pdf','Test editor','2026-07-01','2026-07-31','2026-08-01',10) returning id`
  const categories = DEFAULT_CATALOGUE.filter((c) => c.active)
  const readers = []
  for (const [i, plan] of SUBSCRIPTION_CATALOGUE.entries()) {
    const [reader] =
      await sql`insert into subscribers(name,full_name,email,organization,status,level,public_tier,term_start,term_end)
      values(${`Test Reader ${i + 1}`},${`Test Reader ${i + 1}`},${`browser-reader-${i + 1}@example.invalid`},'Invented Company','active',${plan.level},${plan.storedName},'2026-01-01','2099-12-31') returning id`
    await sql`insert into subscriber_subscription_periods(subscriber_id,starts_on,ends_on,level,source) values(${reader.id}::uuid,'2026-01-01','2099-12-31',${plan.level},'test')`
    const [session] =
      await sql`insert into subscriber_sessions(subscriber_id,method) values(${reader.id}::uuid,'code') returning id`
    readers.push({ ...reader, plan, session: session.id })
  }
  const room = "browser-test-room"
  await sql`insert into papermark_level_rooms(public_tier,papermark_dataroom_id,dataroom_name) values(${readers[1].plan.storedName},${room},'Invented test library')`
  await sql`insert into subscriber_access_reconciliations(subscriber_id,state,generation) values(${readers[1].id}::uuid,'complete',1)`
  const publications = []
  for (const [i, category] of categories.entries()) {
    const [pub] =
      await sql`insert into documents(slug,title,series,visibility,status,is_published,paid_release_state,edition_date,summary,description,papermark_document_id)
      values(${`browser-edition-${i + 1}`},${`Test ${category.singularLabel} (2026)`},${category.code},'L1','published',true,'released',${`2026-08-${String(i + 1).padStart(2, "0")}`}::date,'Public test teaser.','Saved APRI promotional description.',${`browser-pdf-${i}`}) returning id`
    for (const reader of readers) {
      await sql`insert into publication_plans(publication_id,public_tier,source) values(${pub.id}::uuid,${reader.plan.storedName},'test')`
      await sql`insert into publication_access(subscriber_id,publication_id,link_url) values(${reader.id}::uuid,${pub.id}::uuid,${`https://docs.athenacentre.org/browsercopy${i + 1}`})`
    }
    await sql`insert into papermark_dataroom_documents(papermark_dataroom_id,papermark_document_id,title,category,publication_id,version_key)
      values(${room},${`browser-pdf-${i}`},${`Test ${category.singularLabel} (2026).pdf`},${category.code},${pub.id}::uuid,'test-v1')`
    await sql`insert into papermark_subscriber_document_links(subscriber_id,papermark_document_id,papermark_link_id,link_url,assigned_email,verification_generation,last_verified_at,verification_result)
      values(${readers[1].id}::uuid,${`browser-pdf-${i}`},${`browserlink${i + 1}`},${`https://docs.athenacentre.org/browsercopy${i + 1}`},'browser-reader-2@example.invalid',1,now(),' {"state":"found"}'::jsonb)`
    publications.push(pub)
  }
  await sql`insert into app_settings(key,value) values('review_library_enabled','true'),('review_entry_mode','library') on conflict(key) do update set value=excluded.value`
  const email = "browser-review@example.invalid"
  const editions = []
  for (const [i, category] of categories.entries()) {
    const [edition] =
      await sql`insert into review_publication_editions(series,title,description,edition_date,papermark_document_id,secure_link_id,secure_link_url,secure_link_document_id,secure_link_verified_at,publication_state,recipient_mode,complimentary_featured)
      values(${category.code},${`Review ${category.singularLabel}`},'APRI review access.','2026-08-01',${`browser-review-pdf-${i}`},${`browserreview${i}`},${`https://docs.athenacentre.org/browserreview${i}`},${`browser-review-pdf-${i}`},now(),'published','edition',${i < 3}) returning id`
    await sql`insert into review_edition_recipients(edition_id,email,source) values(${edition.id}::uuid,${email},'owner')`
    editions.push(edition.id)
  }
  const [reviewSession] =
    await sql`insert into review_reader_sessions(email,method) values(${email},'code') returning id`
  const coverFixtures = [
    ["publication", publications.at(-1).id], ["publication", publications[0].id],
    ["publication", workflowPublication.id], ["review", editions[0]],
  ]
  for (const [kind, id] of coverFixtures) {
    const image = { src: `https://cover-test.public.blob.vercel-storage.com/publication-covers/${kind}/${id}/cover-fixture.png`, alt: "Cover of an invented test edition", credit: "Test Publications" }
    const value = { revision: randomUUID(), image, updatedAt: new Date().toISOString(), updatedBy: owner.id }
    await sql`insert into app_settings(key,value) values(${`publication_cover_v1:${kind}:${id}`},${JSON.stringify(value)})`
  }
  const key = new TextEncoder().encode(secret)
  const sign = (payload, expiry) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(key)
  const cookies = {
    admin: await sign({ adminId: owner.id, role: "owner" }, "8h"),
    review: await sign(
      { email, sid: reviewSession.id, aud: "review-reader" },
      "24h",
    ),
    subscribers: [],
  }
  for (const reader of readers)
    cookies.subscribers.push(
      await sign(
        {
          principalId: reader.id,
          principalType: "subscriber",
          sid: reader.session,
          aud: "subscriber",
        },
        "90d",
      ),
    )
  return {
    sql,
    readers,
    publications,
    editions,
    categories,
    cookies,
    nonce: randomBytes(8).toString("hex"),
    workflowPublication:workflowPublication.id,
    staffPassword,
  }
}
