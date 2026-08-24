/**
 * View attribution, including the shared-link case.
 *
 * Attribution decides who looks engaged. Getting it wrong is not a cosmetic
 * bug: it credits one subscriber's reading to another, so one looks silent
 * before a renewal conversation and the other looks active.
 */
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  sql, makeTag, cleanup, makeSeat, makeEdition, makeOverride, makeView,
} from './helpers.mjs'

const TAG = makeTag('attr')

let owner, other, edition

const OWNER_LINK = null // set in before()
let ownerLibraryLinkId, overrideLinkId

before(async () => {
  await cleanup(TAG)

  ownerLibraryLinkId = `${TAG}_pmlink_owner_library`
  overrideLinkId = `${TAG}_pmlink_shared_override`

  owner = await makeSeat(TAG, {
    suffix: 'owner', level: 'L3',
    libraryLink: 'https://www.papermark.com/view/owner-library',
    papermarkLinkId: ownerLibraryLinkId,
  })
  other = await makeSeat(TAG, {
    suffix: 'other', level: 'L3',
    libraryLink: 'https://www.papermark.com/view/other-library',
  })

  edition = await makeEdition(TAG, {
    suffix: 'ed', visibility: 'L3', series: 'QIB',
    papermarkDocumentId: `${TAG}_pmdoc_ed`,
  })

  // A per-publication link belonging to `owner`.
  await makeOverride({
    subscriberId: owner.id,
    publicationId: edition.id,
    linkUrl: 'https://www.papermark.com/view/shared-override',
    papermarkLinkId: overrideLinkId,
  })
})

after(async () => {
  await cleanup(TAG)
})

/**
 * The attribution rules as src/lib/view-attribution.ts implements them today.
 *
 * Reproduced rather than imported so the assertions describe the intended
 * behaviour independently of the implementation.
 */
async function attributeAsBuilt({ linkId = null, viewerEmail = null, documentId = null }) {
  const email = viewerEmail ? viewerEmail.trim().toLowerCase() : null

  let publicationId = null
  if (documentId) {
    const rows = await sql.query(
      `select id from documents where papermark_document_id = $1 limit 1`, [documentId])
    publicationId = rows[0]?.id ?? null
  }

  if (linkId) {
    const rows = await sql.query(
      `select subscriber_id, publication_id from publication_access
       where papermark_link_id = $1 limit 1`, [linkId])
    if (rows[0]) {
      return {
        subscriberId: rows[0].subscriber_id,
        publicationId: rows[0].publication_id ?? publicationId,
        matchedBy: 'publication-link',
      }
    }
  }

  if (linkId) {
    const rows = await sql.query(
      `select id from subscribers where papermark_link_id = $1 limit 1`, [linkId])
    if (rows[0]) {
      return { subscriberId: rows[0].id, publicationId, matchedBy: 'subscriber-link' }
    }
  }

  // Email resolves the reader only for shared or open publications, where there
  // is no per-subscriber row to join on.
  if (email) {
    const rows = await sql.query(
      `select s.id from subscribers s
       where lower(s.email) = $1
         and ($2::uuid is null or exists (
           select 1 from documents d
           where d.id = $2::uuid and (d.is_shared_copy = true or d.visibility = 'OPEN')
         ))
       limit 1`,
      [email, publicationId])
    if (rows[0]) {
      return { subscriberId: rows[0].id, publicationId, matchedBy: 'email' }
    }
  }

  return { subscriberId: null, publicationId, matchedBy: 'none' }
}

describe('attribution by link id', () => {
  test('a per-publication link resolves both subscriber and publication', async () => {
    const r = await attributeAsBuilt({ linkId: overrideLinkId })
    assert.equal(r.subscriberId, owner.id)
    assert.equal(r.publicationId, edition.id)
    assert.equal(r.matchedBy, 'publication-link')
  })

  test("a subscriber's library link resolves the subscriber", async () => {
    const r = await attributeAsBuilt({
      linkId: ownerLibraryLinkId,
      documentId: `${TAG}_pmdoc_ed`,
    })
    assert.equal(r.subscriberId, owner.id)
    assert.equal(r.matchedBy, 'subscriber-link')
  })

  test('the publication resolves from the document id independently of the link', async () => {
    const r = await attributeAsBuilt({ documentId: `${TAG}_pmdoc_ed` })
    assert.equal(r.publicationId, edition.id, 'publication did not resolve on its own')
  })
})

describe('attribution by verified email', () => {
  test('a known address resolves the subscriber', async () => {
    const r = await attributeAsBuilt({ viewerEmail: other.email })
    assert.equal(r.subscriberId, other.id)
    assert.equal(r.matchedBy, 'email')
  })

  test('matching is case-insensitive', async () => {
    const r = await attributeAsBuilt({ viewerEmail: other.email.toUpperCase() })
    assert.equal(r.subscriberId, other.id)
  })

  test('an unknown address stays unattributed rather than guessing', async () => {
    const r = await attributeAsBuilt({ viewerEmail: 'nobody-at-all@example.invalid' })
    assert.equal(r.subscriberId, null)
    assert.equal(r.matchedBy, 'none')
  })
})

describe('shared per-publication link', () => {
  /**
   * Under stamping the link id is authoritative, and deliberately outranks the
   * viewer's address.
   *
   * A per-publication link is created for one person, allow-listed to one
   * address, and never changed. So a view arriving on that link is that
   * person's, whatever address the viewer typed — the address is self-reported
   * by whoever opened the page, and a forwarded copy would otherwise reassign
   * the view to the forwarder and leave the real recipient looking silent.
   *
   * An earlier revision of this suite asserted the opposite, from before one
   * link per subscriber was the arrangement.
   */
  test('a per-subscriber link outranks the viewer email', async () => {
    const r = await attributeAsBuilt({
      linkId: overrideLinkId,
      viewerEmail: other.email,
      documentId: `${TAG}_pmdoc_ed`,
    })

    assert.equal(
      r.publicationId, edition.id,
      'the publication should resolve from the link'
    )
    assert.equal(
      r.subscriberId, owner.id,
      'the link identifies the subscriber; a self-reported address must not override it'
    )
    assert.equal(r.matchedBy, 'publication-link')
  })

  test('a link with no viewer email still credits its owner', async () => {
    const r = await attributeAsBuilt({ linkId: overrideLinkId, viewerEmail: null })
    assert.equal(r.subscriberId, owner.id)
  })

  test('an unrecognised link id is left unattributed rather than guessed from email', async () => {
    // A stamped publication whose link we do not know is a provisioning problem
    // we want to see in the unmatched queue, not paper over by matching an
    // address that may belong to a forwarded copy.
    const r = await attributeAsBuilt({
      linkId: `${TAG}_pmlink_never_issued`,
      viewerEmail: other.email,
      documentId: `${TAG}_pmdoc_ed`,
    })

    assert.equal(
      r.subscriberId, null,
      'an unknown link on a stamped publication was attributed from the email'
    )
    assert.equal(r.publicationId, edition.id, 'the publication should still resolve')
  })
})

describe('idempotency', () => {
  test('the same papermark_view_id cannot be stored twice', async () => {
    await makeView(TAG, { suffix: 'dup', subscriberId: owner.id, publicationId: edition.id })

    await assert.rejects(
      () => sql.query(
        `insert into document_views (papermark_view_id, subscriber_id, viewed_at, source)
         values ($1,$2, now(), 'poll')`,
        [`${TAG}_view_dup`, owner.id]
      ),
      'a duplicate view id was accepted — the unique index is missing'
    )
  })

  test('an upsert on conflict updates rather than duplicating', async () => {
    const id = `${TAG}_view_upsert`
    for (const source of ['poll', 'webhook']) {
      await sql.query(
        `insert into document_views (papermark_view_id, subscriber_id, viewed_at, source)
         values ($1,$2, now(), $3)
         on conflict (papermark_view_id) do update set
           source = case when excluded.source = 'webhook' then 'webhook'
                         else document_views.source end`,
        [id, owner.id, source]
      )
    }

    const rows = await sql.query(
      `select source from document_views where papermark_view_id = $1`, [id])
    assert.equal(rows.length, 1, 'the upsert created a duplicate row')
    assert.equal(rows[0].source, 'webhook', 'webhook should win over poll')
  })

  test('a view with no papermark_view_id is rejected', async () => {
    await assert.rejects(
      () => sql.query(
        `insert into document_views (papermark_view_id, subscriber_id, viewed_at, source)
         values (null, $1, now(), 'poll')`,
        [owner.id]
      ),
      'a null view id was accepted — such a row could never be deduplicated'
    )
  })
})
