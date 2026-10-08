/**
 * A paid subscriber's personal document links -- the decisions, with no
 * database or network in the way.
 *
 * Every card in a subscriber's portal library opens through a Papermark link
 * that targets that one document and is issued to that one subscriber: named
 * for them, watermarked with their email and expiring with their subscription.
 * The Data Room link cannot open a single document in the viewer, so a room
 * link issued without these leaves cards that open to "Document viewer
 * unavailable" -- which is what activation and Data Room sync did, because
 * neither prepared any.
 *
 * So every path that gives a subscriber a room, or gives a room a document,
 * runs `preparePersonalLinks` before it reports success or sends email:
 *
 *  - a document with no stored link gets one;
 *  - a stored link is checked with Papermark when the caller asks (`verify`),
 *    because a row saying "live" is not proof that the link works. Papermark
 *    may have revoked it, it may open another document, or it may expire before
 *    the subscription does. A revoked or misdirected link is replaced and a
 *    wrong expiry corrected; anything Papermark cannot confirm is reported as
 *    unconfirmed, never as ready;
 *  - a link minted but not recorded is withdrawn again, so no working link is
 *    left behind that nothing tracks or revokes.
 *
 * A replacement is only ever made on positive evidence: a 404 from Papermark,
 * or a link that Papermark says opens something else. A failed read changes
 * nothing, so a network fault or a misconfigured token can never cause stored
 * links to be retired.
 *
 * Dependency-free so every rule is tested directly: the service
 * (src/lib/document-links.ts) supplies the reads and writes.
 */

export type RoomDocument = {
  papermarkDocumentId: string
  /** How an administrator knows the document: its Papermark filename. */
  title: string
}

export type StoredLink = {
  rowId: string
  papermarkDocumentId: string
  papermarkLinkId: string
  expiresAt: string | Date | null
  /**
   * What the link was issued with, as recorded: checked against what
   * Papermark reports, never changed by a repair. Absent for older callers.
   */
  issued?: IssuedSettings
}

export type IssuedSettings = {
  allowDownload: boolean
  screenshotProtection: boolean
  /** The address the watermark names: the person the link was issued to. */
  email: string
}

/** Security settings Papermark reported; undefined where it did not say. */
export type ReportedSettings = {
  allowDownload?: boolean
  watermark?: boolean
  watermarkText?: string
  screenshotProtection?: boolean
}

/** What Papermark reported for one stored link. */
export type PapermarkLinkRead =
  | {
      state: "found"
      documentId: string | null
      dataroomId: string | null
      targetType: string | null
      /** Undefined when Papermark did not report an expiry at all. */
      expiresAt: string | null | undefined
      settings?: ReportedSettings
    }
  /** A 404. Papermark revokes a link by soft-deleting it, so this means revoked or deleted. */
  | { state: "gone" }
  /** Any other failure. Never taken as proof either way. */
  | { state: "unknown"; message: string; retryAt?: number }

export type MintResult = { ok: true; linkId: string; url: string } | { ok: false; message: string; retryAt?: number }

export type PersonalLinkDeps = {
  /** Every document the subscriber's library lists: the room's present documents. */
  documents: readonly RoomDocument[]
  /** The subscriber's live link rows. */
  stored: readonly StoredLink[]
  create(document: RoomDocument): Promise<MintResult>
  /** Records a minted link. Resolves to null when a live row already exists for the document. */
  save(document: RoomDocument, minted: { linkId: string; url: string }): Promise<string | null>
  /** Withdraws one link in Papermark. A link that has already gone counts as withdrawn. */
  withdraw(linkId: string): Promise<{ ok: true } | { ok: false; message: string; retryAt?: number }>
  /** Marks one stored row revoked. */
  retire(rowId: string): Promise<void>
  read(linkId: string): Promise<PapermarkLinkRead>
  /** Re-applies the subscription's expiry to one stored link. */
  correctExpiry(link: StoredLink): Promise<{ ok: true } | { ok: false; message: string; retryAt?: number }>
}

/**
 * Whether a link's security settings still match what it was issued with.
 *
 * "wrong" when the watermark names someone else -- the link is not this
 * subscriber's -- and "changed" when download, watermarking or screenshot
 * protection differ from what was issued. A changed setting is reported, not
 * corrected: the download and watermark policy is an editorial decision this
 * repair does not make. Only what Papermark reported is judged.
 */
export function settingsVerdict(
  reported: ReportedSettings | undefined,
  issued: IssuedSettings | undefined,
): { verdict: "ok" } | { verdict: "wrong"; problem: string } | { verdict: "changed"; problem: string } {
  if (!reported || !issued) return { verdict: "ok" }
  const email = issued.email.trim().toLowerCase()
  if (email && typeof reported.watermarkText === "string" && !reported.watermarkText.toLowerCase().includes(email)) {
    return { verdict: "wrong", problem: "carries a watermark naming someone else" }
  }
  const changed: string[] = []
  if (reported.watermark === false) changed.push("watermarking is off")
  if (typeof reported.allowDownload === "boolean" && reported.allowDownload !== issued.allowDownload) {
    changed.push(reported.allowDownload ? "downloads are on" : "downloads are off")
  }
  if (reported.screenshotProtection === false && issued.screenshotProtection) changed.push("screenshot protection is off")
  return changed.length ? { verdict: "changed", problem: `settings differ from those issued (${changed.join(", ")})` } : { verdict: "ok" }
}

export type PersonalLinkOptions = {
  /**
   * Check every stored link with Papermark. Without it, a stored row counts as
   * prepared -- enough to hold back a notification until the link exists --
   * but is never reported as confirmed.
   */
  verify: boolean
  /** The subscription's last day as YYYY-MM-DD, or null when it has none. */
  termEndDate: string | null
  /**
   * Read every newly created link back from Papermark before counting it as
   * ready: that it exists and opens this exact document.
   */
  confirmCreated?: boolean
}

export type DocumentResult =
  | { document: RoomDocument; status: "created" }
  /** Checked with Papermark on this run: it opens this document and expires with the subscription. */
  | { document: RoomDocument; status: "confirmed" }
  /** A stored link that was not checked with Papermark on this run. */
  | { document: RoomDocument; status: "stored" }
  | { document: RoomDocument; status: "repaired"; repair: string }
  | { document: RoomDocument; status: "failed"; reason: string; retryAt?: number }
  /** A stored link Papermark could not be asked about. Not counted as ready. */
  | { document: RoomDocument; status: "unconfirmed"; reason: string; retryAt?: number }

export type PersonalLinkReport = {
  results: DocumentResult[]
  total: number
  ready: number
  created: number
  confirmed: number
  stored: number
  repaired: number
  failed: number
  unconfirmed: number
  /** Links minted by this run that could not be recorded or withdrawn. */
  strays: number
  /** Every document has a link that was created, confirmed, repaired or stored. */
  complete: boolean
}

const DAY = 86_400_000

/**
 * Whether a link's expiry fails the rule that it ends with the subscription.
 *
 * Tolerant by a day either side of the term's last day: links created from the
 * stored term end expire at the start of that day and links renewed from the
 * form at its end, and both are correct. What this catches is a renewal that
 * never reached Papermark, or a link that would outlive the subscription.
 */
export function expiryProblem(
  expiresAt: string | Date | null | undefined,
  termEndDate: string | null,
): string | null {
  if (!termEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(termEndDate)) return null
  const lastDay = Date.parse(`${termEndDate}T00:00:00.000Z`)
  if (Number.isNaN(lastDay)) return null
  if (expiresAt === undefined) return null
  if (expiresAt === null || expiresAt === "") return "never expires, although the subscription does"
  const at = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt)
  if (Number.isNaN(at)) return "has an expiry Papermark could not report as a date"
  if (at < lastDay - DAY) return "expires before the subscription ends"
  if (at >= lastDay + 2 * DAY) return "stays open after the subscription ends"
  return null
}

/**
 * What a found link opens, judged only on what Papermark actually said.
 *
 * A link that names a Data Room, a non-document target or another document is
 * wrong. A link that names no document at all is unclear rather than wrong:
 * nothing is withdrawn on an absence of evidence.
 */
function targetVerdict(
  read: Extract<PapermarkLinkRead, { state: "found" }>,
  papermarkDocumentId: string,
): { verdict: "ok" } | { verdict: "wrong"; problem: string } | { verdict: "unclear" } {
  if (read.dataroomId) return { verdict: "wrong", problem: "opens a whole Data Room rather than this document" }
  if (read.targetType && read.targetType.toLowerCase() !== "document") {
    return { verdict: "wrong", problem: "is not a single-document link" }
  }
  if (read.documentId && read.documentId !== papermarkDocumentId) {
    return { verdict: "wrong", problem: "opens a different document" }
  }
  if (!read.documentId) return { verdict: "unclear" }
  return { verdict: "ok" }
}

async function settle<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await run() }
  } catch {
    return { ok: false }
  }
}

/**
 * Prepares a link for every document the subscriber's library lists.
 *
 * Never throws: a failure is recorded against its document and the run moves
 * on, so the caller always gets the whole picture -- which documents are ready
 * and why each of the others is not.
 */
export async function preparePersonalLinks(
  deps: PersonalLinkDeps,
  options: PersonalLinkOptions,
): Promise<PersonalLinkReport> {
  const storedByDocument = new Map<string, StoredLink>()
  for (const link of deps.stored) {
    if (!storedByDocument.has(link.papermarkDocumentId)) storedByDocument.set(link.papermarkDocumentId, link)
  }

  let strays = 0

  async function withdraw(linkId: string): Promise<{ ok: true } | { ok: false; message: string; retryAt?: number }> {
    const outcome = await settle(() => deps.withdraw(linkId))
    if (!outcome.ok) return { ok: false, message: "Papermark could not be reached." }
    return outcome.value
  }

  /** Records a freshly minted link, or withdraws it again if it cannot be recorded. */
  async function record(
    document: RoomDocument,
    minted: { linkId: string; url: string },
  ): Promise<"recorded" | "already" | "unrecorded"> {
    const saved = await settle(() => deps.save(document, minted))
    if (saved.ok && saved.value) return "recorded"
    // Not recorded -- a database fault, or another run recorded a link first.
    // Either way this one is withdrawn: a working link nothing tracks would
    // never be revoked when the subscription ends.
    const withdrawn = await withdraw(minted.linkId)
    if (!withdrawn.ok) strays++
    return saved.ok ? "already" : "unrecorded"
  }

  async function issue(document: RoomDocument): Promise<DocumentResult> {
    const minted = await settle(() => deps.create(document))
    if (!minted.ok) return { document, status: "failed", reason: "Papermark could not be reached." }
    if (!minted.value.ok) return { document, status: "failed", reason: minted.value.message, ...(minted.value.retryAt ? { retryAt: minted.value.retryAt } : {}) }
    const recorded = await record(document, minted.value)
    if (recorded === "already") return { document, status: "stored" }
    if (recorded !== "recorded") {
      return { document, status: "failed", reason: "The new link could not be recorded, so it was withdrawn again." }
    }
    if (!options.confirmCreated) return { document, status: "created" }
    // A created link counts only once Papermark confirms it opens this document.
    const read = await settle(() => deps.read(minted.value.ok ? minted.value.linkId : ""))
    if (!read.ok || read.value.state === "unknown") {
      return { document, status: "unconfirmed", reason: "The new link was created, but Papermark could not confirm it yet.", ...(read.ok && read.value.state === "unknown" && read.value.retryAt ? { retryAt: read.value.retryAt } : {}) }
    }
    if (read.value.state === "gone") {
      return { document, status: "failed", reason: "The new link was created, but Papermark no longer reports it." }
    }
    const target = targetVerdict(read.value, document.papermarkDocumentId)
    if (target.verdict !== "ok") {
      return { document, status: "unconfirmed", reason: target.verdict === "wrong" ? `The new link ${target.problem}.` : "Papermark did not say which document the new link opens." }
    }
    return { document, status: "created" }
  }

  async function correct(document: RoomDocument, link: StoredLink, problem: string): Promise<DocumentResult> {
    const outcome = await settle(() => deps.correctExpiry(link))
    if (outcome.ok && outcome.value.ok) {
      return { document, status: "repaired", repair: `Expiry corrected: the link ${problem}.` }
    }
    const message = outcome.ok && !outcome.value.ok ? outcome.value.message : "Papermark could not be reached."
    return {
      document,
      status: "failed",
      reason: `The stored link ${problem}, and its expiry could not be corrected: ${message}`,
      ...(outcome.ok && !outcome.value.ok && outcome.value.retryAt ? { retryAt: outcome.value.retryAt } : {}),
    }
  }

  /**
   * Replaces a stored link Papermark reports as revoked.
   *
   * The replacement is minted before the old row is retired, so if Papermark
   * refuses it the stored row is left exactly as it was. The old link is
   * withdrawn as well: Papermark already reports it gone, so normally that
   * changes nothing, but if the report were ever wrong it is what stops a
   * working link surviving without a record.
   */
  async function replaceRevoked(document: RoomDocument, link: StoredLink): Promise<DocumentResult> {
    const problem = "had been revoked in Papermark"
    const minted = await settle(() => deps.create(document))
    if (!minted.ok || !minted.value.ok) {
      const message = minted.ok && !minted.value.ok ? minted.value.message : "Papermark could not be reached."
      return { document, status: "failed", reason: `The stored link ${problem}. A replacement could not be created: ${message}` }
    }
    const old = await withdraw(link.papermarkLinkId)
    if (!old.ok) {
      const withdrawn = await withdraw(minted.value.linkId)
      if (!withdrawn.ok) strays++
      return {
        document,
        status: "failed",
        reason: `The stored link ${problem}, but it could not be confirmed as withdrawn: ${old.message}`,
      }
    }
    const retired = await settle(() => deps.retire(link.rowId))
    if (!retired.ok) {
      const withdrawn = await withdraw(minted.value.linkId)
      if (!withdrawn.ok) strays++
      return { document, status: "failed", reason: `The stored link ${problem}, and its record could not be updated.` }
    }
    const recorded = await record(document, minted.value)
    if (recorded === "unrecorded") {
      return { document, status: "failed", reason: `The stored link ${problem}. Its replacement could not be recorded.` }
    }
    return { document, status: "repaired", repair: `Replaced: the stored link ${problem}.` }
  }

  /**
   * Replaces a stored link that Papermark says opens something else.
   *
   * That link is withdrawn first: it is a working link issued to this
   * subscriber that must not outlive its record. If it cannot be withdrawn,
   * its row is kept so it stays tracked, and nothing new is minted.
   */
  async function replaceMisdirected(document: RoomDocument, link: StoredLink, problem: string): Promise<DocumentResult> {
    const withdrawn = await withdraw(link.papermarkLinkId)
    if (!withdrawn.ok) {
      return { document, status: "failed", reason: `The stored link ${problem}, and it could not be withdrawn: ${withdrawn.message}` }
    }
    const retired = await settle(() => deps.retire(link.rowId))
    if (!retired.ok) {
      return { document, status: "failed", reason: `The stored link ${problem}. It was withdrawn, but its record could not be updated.` }
    }
    const replacement = await issue(document)
    if (replacement.status === "failed") {
      return { document, status: "failed", reason: `The stored link ${problem} and was withdrawn. A replacement could not be created: ${replacement.reason}` }
    }
    return { document, status: "repaired", repair: `Replaced: the stored link ${problem}.` }
  }

  const results: DocumentResult[] = []
  const seen = new Set<string>()

  for (const document of deps.documents) {
    const id = document.papermarkDocumentId
    if (!id || seen.has(id)) continue
    seen.add(id)

    const link = storedByDocument.get(id)
    if (!link) {
      results.push(await issue(document))
      continue
    }

    if (!options.verify) {
      // What the database records is checked even without Papermark: a renewal
      // that never reached Papermark leaves the old expiry on the row.
      const problem = expiryProblem(link.expiresAt, options.termEndDate)
      results.push(problem ? await correct(document, link, problem) : { document, status: "stored" })
      continue
    }

    const read = await settle(() => deps.read(link.papermarkLinkId))
    if (!read.ok) {
      results.push({ document, status: "unconfirmed", reason: "Papermark could not be reached." })
      continue
    }
    const state = read.value
    if (state.state === "unknown") {
      results.push({ document, status: "unconfirmed", reason: state.message, ...(state.retryAt ? { retryAt: state.retryAt } : {}) })
      continue
    }
    if (state.state === "gone") {
      results.push(await replaceRevoked(document, link))
      continue
    }

    const target = targetVerdict(state, id)
    if (target.verdict === "wrong") {
      results.push(await replaceMisdirected(document, link, target.problem))
      continue
    }
    const settings = settingsVerdict(state.settings, link.issued)
    if (settings.verdict === "wrong") {
      // Issued to someone else's identity: withdrawn and replaced, like a link
      // that opens the wrong document.
      results.push(await replaceMisdirected(document, link, settings.problem))
      continue
    }
    if (settings.verdict === "changed") {
      results.push({ document, status: "unconfirmed", reason: `The stored link's ${settings.problem}. Review it in Papermark.` })
      continue
    }
    if (target.verdict === "unclear") {
      results.push({
        document,
        status: "unconfirmed",
        reason: "Papermark did not say which document the stored link opens.",
      })
      continue
    }

    const problem = expiryProblem(state.expiresAt, options.termEndDate)
    results.push(problem ? await correct(document, link, problem) : { document, status: "confirmed" })
  }

  return summarise(results, strays)
}

function summarise(results: DocumentResult[], strays: number): PersonalLinkReport {
  const count = (status: DocumentResult["status"]) => results.filter((r) => r.status === status).length
  const created = count("created")
  const confirmed = count("confirmed")
  const stored = count("stored")
  const repaired = count("repaired")
  const failed = count("failed")
  const unconfirmed = count("unconfirmed")
  const ready = created + confirmed + stored + repaired
  return {
    results,
    total: results.length,
    ready,
    created,
    confirmed,
    stored,
    repaired,
    failed,
    unconfirmed,
    strays,
    complete: failed === 0 && unconfirmed === 0,
  }
}

/** One report merged from several subscribers' reports, for a room-wide action. */
export function combineReports(reports: readonly PersonalLinkReport[]): PersonalLinkReport {
  const results = reports.flatMap((r) => r.results)
  return summarise(results, reports.reduce((sum, r) => sum + r.strays, 0))
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function quoted(title: string): string {
  const clean = title.trim() || "Untitled document"
  return `“${clean.length > 90 ? `${clean.slice(0, 87)}...` : clean}”`
}

/**
 * The administrator's account of one subscriber's links.
 *
 * Names each document that is not ready and why, so the message says what to
 * fix. Built from titles and reasons only: a link's id and URL open the
 * document, so neither ever appears here.
 */
export function describePersonalLinks(report: PersonalLinkReport): string {
  if (report.total === 0) {
    return "The Data Room has no documents yet, so no personal document links were needed."
  }

  const done = [
    report.created ? `${report.created} created` : null,
    report.repaired ? `${report.repaired} repaired` : null,
    report.confirmed ? `${report.confirmed} confirmed with Papermark` : null,
    report.stored ? `${report.stored} already prepared` : null,
  ].filter(Boolean)

  const stray =
    report.strays > 0
      ? ` ${plural(report.strays, "extra link")} could not be withdrawn in Papermark; remove ${
          report.strays === 1 ? "it" : "them"
        } there by name.`
      : ""

  if (report.complete) {
    const all =
      report.total === 1 ? "The personal document link is ready" : `All ${report.total} personal document links are ready`
    return `${all} (${done.join(", ")}).${stray}`
  }

  const notReady = report.results.filter(
    (r): r is Extract<DocumentResult, { status: "failed" | "unconfirmed" }> =>
      r.status === "failed" || r.status === "unconfirmed",
  )
  const shown = notReady
    .slice(0, 3)
    .map((r) => `${quoted(r.document.title)}: ${r.reason}`)
    .join(" ")
  const more = notReady.length > 3 ? ` And ${notReady.length - 3} more.` : ""
  return `${report.ready} of ${plural(report.total, "personal document link")} ready. Not ready: ${shown}${more}${stray}`
}
