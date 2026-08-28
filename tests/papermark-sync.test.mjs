import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DOCUMENTS_FOLDER_PARAM,
  FOLDERS_PARENT_PARAM,
  classifySyncedDocument,
  describePapermarkFailure,
  isNewSince,
  papermarkExpiresAt,
  sectionTypeLabel,
  summariseSync,
} from '../src/lib/papermark-contract.ts'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// The 422
// ---------------------------------------------------------------------------

test('the documents folder filter uses the name Papermark actually documents', () => {
  // GET /v1/documents takes folderId; GET /v1/folders takes parent_id. Sending
  // folder_id to the documents endpoint is what produced "Papermark returned
  // 422" while a perfectly valid folder took the blame.
  assert.equal(DOCUMENTS_FOLDER_PARAM, 'folderId')
  assert.equal(FOLDERS_PARENT_PARAM, 'parent_id')

  const client = read('src/lib/papermark.ts')
  assert.doesNotMatch(client, /\/v1\/documents\?folder_id=/)
  assert.match(client, /DOCUMENTS_FOLDER_PARAM/)
})

test('a date-only term end becomes a complete ISO date-time at the end of that day', () => {
  const result = papermarkExpiresAt('2026-12-31')
  assert.equal(result.ok, true)
  assert.equal(result.value, '2026-12-31T23:59:59.999Z')

  // The last day of the term is included, not cut off at midnight.
  assert.ok(new Date(result.value) > new Date('2026-12-31T00:00:00.000Z'))
})

test('no expiry is sent as null, which the schema permits, and never as undefined', () => {
  for (const empty of [null, undefined, '', '   ']) {
    const result = papermarkExpiresAt(empty)
    assert.equal(result.ok, true)
    assert.equal(result.value, null)
    assert.notEqual(result.value, undefined)
  }
})

test('an unreadable term end is refused rather than sent to Papermark', () => {
  for (const bad of ['not a date', '31/12/2026', new Date('nonsense')]) {
    const result = papermarkExpiresAt(bad)
    assert.equal(result.ok, false, `${String(bad)} should have been refused`)
    assert.equal('value' in result, false)
    assert.match(result.reason, /date/i)
  }
})

test('a full timestamp passes through as a valid ISO date-time', () => {
  const result = papermarkExpiresAt('2026-06-01T09:30:00.000Z')
  assert.equal(result.ok, true)
  assert.equal(result.value, '2026-06-01T09:30:00.000Z')
  assert.equal(Number.isNaN(new Date(result.value).getTime()), false)
})

// ---------------------------------------------------------------------------
// Reading Papermark's error back
// ---------------------------------------------------------------------------

const EXPIRY_422 = {
  error: {
    code: 'unprocessable_entity',
    message: 'Invalid request body.',
    doc_url: 'https://www.papermark.com/docs/api/errors#unprocessable_entity',
    details: { formErrors: [], fieldErrors: { expires_at: ['Invalid datetime'] } },
  },
}

test('a 422 about the expiry is explained in words an administrator can act on', () => {
  const failure = describePapermarkFailure(422, EXPIRY_422)
  assert.equal(failure.status, 422)
  assert.equal(failure.code, 'unprocessable_entity')
  assert.deepEqual(failure.fieldErrors.expires_at, ['Invalid datetime'])
  assert.equal(
    failure.message,
    'Papermark rejected the link expiry date. The subscriber term end must be converted to a complete date and time.',
  )
})

test('other 422 field errors are named rather than flattened to a status code', () => {
  const failure = describePapermarkFailure(422, {
    error: { code: 'unprocessable_entity', details: { fieldErrors: { allow_list: ['Invalid email'] } } },
  })
  assert.match(failure.message, /allow_list/)
  assert.match(failure.message, /Invalid email/)
  assert.doesNotMatch(failure.message, /^Papermark returned 422/)
})

test('a missing scope is reported as 403 and never folded into 422', () => {
  const failure = describePapermarkFailure(403, { error: { code: 'forbidden' } })
  assert.equal(failure.status, 403)
  assert.match(failure.message, /not permitted/i)
  assert.doesNotMatch(failure.message, /422/)

  const unauthorised = describePapermarkFailure(401, {})
  assert.match(unauthorised.message, /token/i)
})

test('nothing secret is ever repeated back out of an error body', () => {
  const failure = describePapermarkFailure(422, {
    error: {
      code: 'unprocessable_entity',
      details: {
        fieldErrors: {
          // A field name that is not a plain identifier, and explanations that
          // quote a URL or a credential, are dropped rather than displayed.
          'Authorization: Bearer pmk_live_secret': ['nope'],
          allow_list: [
            'See https://docs.athenacentre.org/view/private-token-here',
            'Bearer pmk_live_abc123',
            'api_key rejected',
            'Invalid email',
          ],
        },
      },
    },
  })

  const rendered = JSON.stringify(failure)
  assert.doesNotMatch(rendered, /pmk_live/)
  assert.doesNotMatch(rendered, /Bearer /)
  assert.doesNotMatch(rendered, /https?:\/\//)
  assert.deepEqual(failure.fieldErrors.allow_list, ['Invalid email'])
})

test('an error body that is missing or unparseable still yields a usable sentence', () => {
  for (const body of [null, undefined, 'not json', {}, { error: 'oops' }]) {
    const failure = describePapermarkFailure(500, body)
    assert.equal(typeof failure.message, 'string')
    assert.ok(failure.message.length > 0)
  }
  assert.match(describePapermarkFailure(422, null).message, /named no field/)
})

// ---------------------------------------------------------------------------
// Save, then sync
// ---------------------------------------------------------------------------

const syncAction = read('src/app/actions/papermark-client-library.ts')

test('the folder is saved before the sync reads it', () => {
  const body = syncAction.slice(syncAction.indexOf('export async function saveFolderAndSyncLibrary'))

  const saved = body.indexOf('set papermark_folder_id=')
  const listed = body.indexOf('listDocumentsInFolder(')
  assert.ok(saved > -1, 'the folder is no longer saved by this action')
  assert.ok(listed > -1, 'the action no longer lists documents')
  assert.ok(saved < listed, 'the folder must be written before the documents are read')
})

test('the sync reads the folder just selected, never the one previously saved', () => {
  const body = syncAction.slice(syncAction.indexOf('export async function saveFolderAndSyncLibrary'))

  // Documents come from the argument, not from the row read at the start.
  assert.match(body, /listDocumentsInFolder\(selectedFolderId\)/)
  assert.doesNotMatch(body, /listDocumentsInFolder\((?:client|existing)\.papermark_folder_id\)/)

  // And the selection is validated against the configured root before it is
  // written, so an id from anywhere else cannot reach the record.
  const validated = body.indexOf('allowed.some((folder) => folder.id === selectedFolderId)')
  assert.ok(validated > -1 && validated < body.indexOf('set papermark_folder_id='))
})

test('an empty folder reports itself and destroys nothing', () => {
  const body = syncAction.slice(syncAction.indexOf('export async function saveFolderAndSyncLibrary'))
  const emptyBranch = body.slice(
    body.indexOf('if (documents.length === 0)'),
    body.indexOf('// Resolve every link before writing anything.'),
  )

  assert.match(emptyBranch, /ok: true/)
  assert.doesNotMatch(emptyBranch, /delete from/)

  const message = summariseSync({ found: 0, reused: 0, created: 0, synced: 0 })
  assert.match(message, /no documents/i)
  assert.match(message, /untouched/i)
})

test('a partial external failure leaves the last working library in place', () => {
  const body = syncAction.slice(syncAction.indexOf('export async function saveFolderAndSyncLibrary'))

  // Every link is resolved before the first write, and the bail-out on a failed
  // link happens inside that loop -- so a failure halfway through cannot have
  // written or deleted anything.
  const resolveLoop = body.indexOf('for (const document of documents)')
  const bailOut = body.indexOf('if (!link.ok) return { message: link.message }')
  const firstWrite = body.indexOf('insert into papermark_client_documents')
  const firstDelete = body.indexOf('delete from papermark_client_documents')

  assert.ok(resolveLoop < bailOut, 'the bail-out is no longer inside the resolve loop')
  assert.ok(bailOut < firstWrite, 'a failed link must return before anything is written')
  assert.ok(firstWrite < firstDelete, 'stale rows must only go once the replacement is in')
})

test('an existing exact-email link is reused instead of a second one being created', () => {
  const client = read('src/lib/papermark.ts')
  const ensure = client.slice(
    client.indexOf('export async function ensurePrivateDocumentLink'),
    client.indexOf('export async function listLinks'),
  )

  assert.match(ensure, /email_protected/)
  assert.match(ensure, /allow\.length === 1/)
  assert.match(ensure, /allow\[0\]\?\.toLowerCase\(\) === args\.email\.toLowerCase\(\)/)
  assert.match(ensure, /reused: true/)
})

test('the sync reports what it found, reused, created and stored', () => {
  const message = summariseSync({ found: 7, reused: 5, created: 2, synced: 7 })
  assert.match(message, /7 documents found/)
  assert.match(message, /5 existing links reused/)
  assert.match(message, /2 new links created/)
  assert.match(message, /7 documents synchronised/)

  assert.match(
    summariseSync({ found: 1, reused: 1, created: 0, synced: 1 }),
    /1 document found, 1 existing link reused, 0 new links created/,
  )
})

test('the expiry conversion is applied to the link, not left to Papermark', () => {
  const client = read('src/lib/papermark.ts')
  const mint = client.slice(client.indexOf('export async function mintSubscriberLink'))

  assert.match(mint, /papermarkExpiresAt\(args\.expiresAt \?\? null\)/)
  assert.match(mint, /expires_at: expiry\.value/)
  assert.match(mint, /reason: 'invalid-expiry'/)

  // The field names the API declares, spelled exactly.
  for (const field of [
    'document_id',
    'name',
    'expires_at',
    'email_protected',
    'email_authenticated',
    'allow_download',
    'allow_list',
    'enable_screenshot_protection',
  ]) {
    assert.match(mint, new RegExp(`\\b${field}\\b`), `${field} is not sent under that name`)
  }

  // The subscriber's term end reaches the link builder.
  assert.match(syncAction, /expiresAt: existing\.term_end/)
})

test('a Data Rooms feature is never sent from the Business-plan sync', () => {
  const client = read('src/lib/papermark.ts')
  const sync = read('src/app/actions/papermark-client-library.ts')
  for (const source of [client, sync]) {
    assert.doesNotMatch(source, /dataroom_id|\/v1\/datarooms|audience_type|group_id/)
  }
})

// ---------------------------------------------------------------------------
// Classifying and badging
// ---------------------------------------------------------------------------

test('Monthly Intelligence Notes are grouped by an anchored code, not a substring', () => {
  assert.equal(classifySyncedDocument('MIN-2026-03 Nigeria Outlook'), 'MIN')
  assert.equal(classifySyncedDocument('min-2026-03 lower case'), 'MIN')
  assert.equal(classifySyncedDocument('MIN_2026_03 underscore'), 'MIN')

  // Not a Monthly Intelligence Note, and an unanchored search would say it was.
  assert.equal(classifySyncedDocument('ADMIN-notes.pdf'), 'OTHER')
  assert.equal(classifySyncedDocument('Determining MIN-thresholds'), 'OTHER')
  assert.equal(classifySyncedDocument('MINUTES of the board'), 'OTHER')
})

test('Athena Intelligence Updates group the same way', () => {
  assert.equal(classifySyncedDocument('AIU-2026-01 Regulatory Shift'), 'AIU')
  assert.equal(classifySyncedDocument('aiu 2026 spaced'), 'AIU')
  assert.equal(classifySyncedDocument('Gaiu-something'), 'OTHER')
})

test('an unrecognised document is kept rather than lost', () => {
  for (const title of ['Board Paper 2026.pdf', '', 'Q1 review', 'QIB-2026-01']) {
    assert.equal(classifySyncedDocument(title), 'OTHER')
  }
  assert.equal(sectionTypeLabel('OTHER'), 'Publication')
  assert.equal(sectionTypeLabel('MIN'), 'Monthly Intelligence Note')
  assert.equal(sectionTypeLabel('AIU'), 'Athena Intelligence Update')
})

test('a badge needs both a change and a previous visit to compare it against', () => {
  const changed = '2026-08-20T10:00:00.000Z'

  assert.equal(isNewSince(changed, '2026-08-19T10:00:00.000Z'), true)
  assert.equal(isNewSince(changed, '2026-08-21T10:00:00.000Z'), false)

  // A first visit marks nothing: everything would be new, which is no signal.
  assert.equal(isNewSince(changed, null), false)
  assert.equal(isNewSince(null, '2026-08-19T10:00:00.000Z'), false)
  assert.equal(isNewSince('nonsense', '2026-08-19T10:00:00.000Z'), false)
})

test('re-reading the portal does not keep relabelling the same documents', () => {
  const library = read('src/lib/papermark-client-library.ts')
  const portal = read('src/app/portal/page.tsx')

  // The comparison point excludes the visit currently being recorded, so the
  // answer is the same on a refresh.
  assert.match(library, /occurred_at < now\(\) - interval '30 minutes'/)

  // And it is read before the current visit is written.
  const readVisit = portal.indexOf('getPreviousPortalVisit(principal)')
  const recordVisit = portal.indexOf('"portal_opened"')
  assert.ok(readVisit > -1 && readVisit < recordVisit)

  // A sync of an unchanged folder must not move the timestamp the badge reads.
  assert.match(
    syncAction,
    /synced_at=case\s*\n\s*when papermark_client_documents\.title is distinct from excluded\.title/,
  )
})
