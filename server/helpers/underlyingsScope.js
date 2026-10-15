/**
 * Underlyings analysis for one viewer.
 *
 * See-all roles read the firm-wide analysis as stored. Everyone else (RM,
 * assistant, client) reads the same rows restricted to their own perimeter,
 * with notionals and bubble sizes recomputed from their own allocations, so a
 * scoped view never carries the firm's amounts.
 */
import { AllocationsCollection } from '/imports/api/allocations';
import {
  UnderlyingsAnalysisCollection,
  buildUnderlyingsAnalysis,
  nominalByProductFrom,
  applyNotionalSizing,
  summarizeUnderlyings
} from '/imports/api/underlyingsAnalysis';
import { resolveScope, allocationsSelector, holdingsSelector, heldProductIds } from './accessScope.js';

export const LIVE_ANALYSIS_ID = 'phoenix_live_underlyings';

/** Live analysis doc restricted to the products the scope currently holds. */
export async function scopeLiveAnalysis(analysis, scope) {
  if (!analysis) return null;
  if (scope.isAdmin) return analysis;

  const held = scope.denied ? new Set() : await heldProductIds(scope);
  const allocations = scope.denied ? [] : await AllocationsCollection.find(
    { $and: [await allocationsSelector(scope), { status: 'active' }] },
    { fields: { productId: 1, nominalInvested: 1 } }
  ).fetchAsync();

  const rows = applyNotionalSizing(
    (analysis.underlyings || []).filter(u => held.has(String(u.productId))),
    nominalByProductFrom(allocations)
  );
  return { ...analysis, underlyings: rows, summary: summarizeUnderlyings(rows) };
}

/**
 * The analysis this user may read: live (asOfDate null) or as of a past date.
 * Historical scoped views follow the positions on record at that date.
 */
export async function underlyingsAnalysisForUser(user, asOfDate = null) {
  const scope = await resolveScope(user);
  if (asOfDate) {
    if (scope.isAdmin) return buildUnderlyingsAnalysis(asOfDate);
    if (scope.denied) return null;
    return buildUnderlyingsAnalysis(asOfDate, {
      allocationsFilter: await allocationsSelector(scope),
      holdingsFilter: await holdingsSelector(scope)
    });
  }
  const live = await UnderlyingsAnalysisCollection.findOneAsync({ _id: LIVE_ANALYSIS_ID });
  return scopeLiveAnalysis(live, scope);
}
