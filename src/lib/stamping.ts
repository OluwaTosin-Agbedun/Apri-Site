import 'server-only'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

/**
 * Stamping a subscriber's identity into a PDF.
 *
 * Papermark's dynamic watermark is not on our plan, so the name goes into the
 * file before upload. That makes one document and one link per subscriber per
 * publication, each allow-listed to that one address.
 *
 * Deliberately not a cover sheet. A cover page is the first thing anyone
 * removes before forwarding, which would leave an unmarked document in
 * circulation. The mark is on every page instead.
 */

export type StampSubject = {
  fullName: string
  organisation: string
  /**
   * The copy id, e.g. MIN-2026-08/AO-014.
   *
   * Stamped beside the name so a document found in the wrong hands resolves
   * back to exactly one access row, even if the name has been obscured.
   */
  copyId?: string | null
}

export type StampPublication = {
  /** Edition code, e.g. APRI-MIN-2026-08. Falls back to the title. */
  code: string | null
  title: string
}

/**
 * Returns a stamped copy of the PDF.
 *
 * Two marks per page: a footer naming the reader, their organisation and the
 * edition, and a faint diagonal across the page. The diagonal survives a
 * screenshot or a photograph of the screen, which the footer alone does not.
 *
 * The input buffer is never mutated -- pdf-lib parses into a new document -- so
 * one source PDF can be stamped for many subscribers in a loop.
 */
export async function stampPdfForSubscriber(
  pdfBuffer: Uint8Array | ArrayBuffer,
  subscriber: StampSubject,
  publication: StampPublication
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBuffer, {
    // A publication may legitimately be produced with restrictive metadata;
    // refusing to stamp it would be worse than honouring our own edit.
    ignoreEncryption: true,
  })

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const edition = publication.code || publication.title

  const footer = [
    subscriber.fullName,
    subscriber.organisation,
    edition,
    subscriber.copyId,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('  ·  ')

  const diagonal = [subscriber.fullName, subscriber.copyId || edition]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('  ·  ')

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize()

    // Footer: small, dark enough to survive a photocopy, low enough not to
    // cover the content area of a normally-margined document.
    const footerSize = 7
    const footerWidth = font.widthOfTextAtSize(footer, footerSize)
    page.drawText(footer, {
      x: Math.max(12, (width - footerWidth) / 2),
      y: 14,
      size: footerSize,
      font,
      color: rgb(0.42, 0.42, 0.42),
    })

    // Diagonal: faint enough to read through, present enough to identify the
    // recipient in a photograph. Drawn from the lower-left corner at 45°, so
    // its length scales with the page rather than being clipped on a small one.
    if (diagonal) {
      const diagonalSize = Math.max(18, Math.min(46, width / 16))
      const textWidth = font.widthOfTextAtSize(diagonal, diagonalSize)
      const centreOffset = textWidth / 2

      page.drawText(diagonal, {
        x: width / 2 - centreOffset * 0.71 - 10,
        y: height / 2 - centreOffset * 0.71,
        size: diagonalSize,
        font,
        color: rgb(0.55, 0.55, 0.55),
        opacity: 0.12,
        rotate: degrees(45),
      })
    }
  }

  return pdf.save()
}

/** Whether a buffer looks like a PDF at all, before we try to parse it. */
export function looksLikePdf(buffer: Uint8Array): boolean {
  // %PDF-
  return (
    buffer.length > 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  )
}
