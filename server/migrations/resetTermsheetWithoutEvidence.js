/**
 * Migration: Reset termsheet status for orders that don't have evidence on file.
 *
 * Forward termsheet transitions (sent / signed) now require uploading the email
 * (.eml/.msg) or signed PDF as evidence, stored in emailTraces with traceType
 * 'termsheet_sent' / 'termsheet_signed'. Orders that were set to sent / signed
 * before this requirement existed are reset to 'none' so the user is forced to
 * re-mark them with proper evidence.
 *
 * Idempotent: orders that already have matching evidence are left untouched, and
 * orders reset by this migration won't match the query on subsequent runs.
 */

import { OrdersCollection } from '../../imports/api/orders.js';

export async function resetTermsheetWithoutEvidence() {
  const now = new Date();

  const sentResult = await OrdersCollection.updateManyAsync(
    {
      termsheetStatus: 'sent',
      'emailTraces.traceType': { $ne: 'termsheet_sent' }
    },
    {
      $set: {
        termsheetStatus: 'none',
        termsheetUpdatedBy: 'system-migration',
        termsheetUpdatedAt: now,
        updatedAt: now
      }
    }
  );

  const signedResult = await OrdersCollection.updateManyAsync(
    {
      termsheetStatus: 'signed',
      'emailTraces.traceType': { $ne: 'termsheet_signed' }
    },
    {
      $set: {
        termsheetStatus: 'none',
        termsheetUpdatedBy: 'system-migration',
        termsheetUpdatedAt: now,
        updatedAt: now
      }
    }
  );

  const sentCount = sentResult?.modifiedCount ?? sentResult ?? 0;
  const signedCount = signedResult?.modifiedCount ?? signedResult ?? 0;
  const total = sentCount + signedCount;

  if (total > 0) {
    console.log(`📄 [MIGRATION] Reset ${total} order(s) without termsheet evidence (${sentCount} sent, ${signedCount} signed)`);
  }

  return { sentCount, signedCount, total };
}
