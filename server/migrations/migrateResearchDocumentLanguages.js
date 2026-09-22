/**
 * Research library documents gained language editions (Sept 2026).
 *
 * A document used to be one PDF in top-level fields (fileName, storedFileName,
 * fileSize, mimeType). It now holds one file per language under
 * `files.<language>`, so the English and French editions of the same report are
 * one library entry instead of two.
 *
 * Documents uploaded before the split are copied into the `files` map as the
 * default language edition. The file on disk is never touched, only the
 * metadata pointing at it — and the old top-level fields are deliberately LEFT
 * IN PLACE: this runs at startup, including from a developer machine against
 * the shared database, and a server still running the pre-split code reads
 * those fields to serve the PDF. They are dropped the first time the document
 * is edited on the new code (research.addVersion / removeVersion $unset them).
 *
 * Their language is an assumption — nothing in the old shape recorded it. It is
 * corrected from the Intranet by removing that version and re-uploading it
 * under the right one.
 *
 * The old `{ storedFileName: 1 }` unique index is dropped: once a document has
 * its files in the map the top-level field goes away, reading as null on every
 * such document, and a non-sparse unique index would then reject the second
 * one. Uniqueness is now enforced per language slot (sparse) where the files
 * actually live — see server/publications/researchDocuments.js.
 *
 * Idempotent: a document that already has a `files` map is never touched, and
 * the index is dropped only if it is still there, so a second run (or a restart
 * after a partial run) is a no-op.
 */

import {
  ResearchDocumentsCollection,
  RESEARCH_LANGUAGE_ORDER
} from '/imports/api/researchDocuments';

const LEGACY_INDEX_NAME = 'storedFileName_1';

// What a pre-split upload is assumed to be: the library was seeded with the
// house English editions.
const ASSUMED_LANGUAGE = RESEARCH_LANGUAGE_ORDER[0];

async function dropLegacyUniqueIndex() {
  const raw = ResearchDocumentsCollection.rawCollection();
  let indexes;
  try {
    indexes = await raw.indexes();
  } catch (error) {
    // No collection yet on a fresh database — nothing to drop.
    return;
  }
  if (!indexes.some((index) => index.name === LEGACY_INDEX_NAME)) return;

  try {
    await raw.dropIndex(LEGACY_INDEX_NAME);
    console.log(`[ResearchLanguages] Dropped legacy ${LEGACY_INDEX_NAME} index`);
  } catch (error) {
    console.error(`[ResearchLanguages] Could not drop ${LEGACY_INDEX_NAME}:`, error.message);
  }
}

export async function migrateResearchDocumentLanguages() {
  try {
    await dropLegacyUniqueIndex();

    const legacyDocs = await ResearchDocumentsCollection.find(
      { storedFileName: { $exists: true }, files: { $exists: false } },
      { fields: { fileName: 1, storedFileName: 1, fileSize: 1, mimeType: 1, uploadedBy: 1, uploadedByName: 1, uploadedAt: 1, title: 1 } }
    ).fetchAsync();

    if (legacyDocs.length === 0) return;

    for (const doc of legacyDocs) {
      await ResearchDocumentsCollection.updateAsync(doc._id, {
        $set: {
          files: {
            [ASSUMED_LANGUAGE]: {
              fileName: doc.fileName,
              storedFileName: doc.storedFileName,
              fileSize: doc.fileSize,
              mimeType: doc.mimeType || 'application/pdf',
              uploadedBy: doc.uploadedBy,
              uploadedByName: doc.uploadedByName,
              uploadedAt: doc.uploadedAt
            }
          },
          languages: [ASSUMED_LANGUAGE]
        }
      });
    }

    console.log(`[ResearchLanguages] Moved ${legacyDocs.length} research document(s) to language editions (as ${ASSUMED_LANGUAGE})`);
  } catch (error) {
    console.error('[ResearchLanguages] Migration failed:', error);
  }
}

