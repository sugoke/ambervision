/**
 * Keeps the two term-sheet entry points in sync.
 *
 * A structured product's term sheet reaches the app twice:
 *   1. Product side  — uploaded to create the product (term-sheet extraction) or
 *      later on the product report. Stored in the flat term-sheet store and
 *      referenced by `product.termSheet`, which is what the report's Term Sheet
 *      button opens.
 *   2. Order side    — attached when the order is placed (initial termsheet, sent
 *      to the bank with the order) and again when the client returns it signed.
 *      Stored as an order email trace under <fichier_central>/orders/<orderId>/,
 *      which only the order book can read.
 *
 * They are genuinely different records — the order's copy is compliance evidence
 * tied to one order and must never be mutated, while the product's copy is the
 * reference document for everyone looking at that ISIN. But when an order's
 * termsheet arrives for an ISIN whose product has none, the product report was
 * left with a dead Term Sheet button even though the PDF was already in the
 * building. This promotes a copy across, respecting source precedence
 * (see TERMSHEET_SOURCES): a signed copy supersedes anything, a preliminary
 * copy from an order only fills a gap.
 */

import { ProductsCollection } from '/imports/api/products.js';
import {
  TERMSHEET_SOURCES,
  buildTermsheetFilename,
  termsheetUrl,
  termsheetFilenameFromUrl,
  writeTermsheetFile,
  deleteTermsheetFile,
  termsheetSourceWins
} from '/imports/api/documentStorage.js';

/**
 * Copy an order's termsheet PDF into the product term-sheet store.
 *
 * Non-blocking by contract: an order must never fail because the product-side
 * copy could not be written, so every failure is logged and swallowed.
 *
 * @param {Object}  params
 * @param {String}  params.isin            ISIN the order was placed on
 * @param {String}  params.fileName        original filename, for display only
 * @param {String}  params.base64Data      the file contents
 * @param {String}  params.source          one of TERMSHEET_SOURCES
 * @param {String}  params.userId          who supplied it
 * @returns {Promise<Boolean>} whether the product's term sheet was updated
 */
export async function promoteOrderTermsheetToProduct({ isin, fileName, base64Data, source, userId }) {
  try {
    if (!isin || !base64Data) return false;

    // Only PDFs: the store is served as application/pdf, and termsheet evidence
    // may legitimately be an .eml or .msg (the email that carried it).
    if (!String(fileName || '').toLowerCase().endsWith('.pdf')) return false;

    const product = await ProductsCollection.findOneAsync({ isin });
    if (!product) return false;

    if (!termsheetSourceWins(product.termSheet, source)) return false;

    const filename = buildTermsheetFilename(product);

    // A product whose title changed since its last term sheet keeps an orphan
    // file behind under the old name.
    const previousFilename = termsheetFilenameFromUrl(product.termSheet?.url);
    if (previousFilename && previousFilename !== filename) {
      deleteTermsheetFile(previousFilename);
    }

    writeTermsheetFile(filename, Buffer.from(base64Data, 'base64'));

    await ProductsCollection.updateAsync(product._id, {
      $set: {
        termSheet: {
          url: termsheetUrl(filename),
          filename,
          originalFilename: fileName,
          uploadedAt: new Date(),
          uploadedBy: userId,
          source
        }
      }
    });

    console.log(`[TermSheet] Promoted ${source} termsheet for ${isin} to product ${product._id} (${filename})`);
    return true;
  } catch (error) {
    console.error(`[TermSheet] Failed to promote order termsheet for ${isin}:`, error);
    return false;
  }
}

export { TERMSHEET_SOURCES };
