/**
 * MCP scope helper — thin adapter over the app-wide access scope.
 *
 * The MCP server and the web app share one authority for "which client data
 * may this user see" (server/helpers/accessScope.js). This module keeps the
 * MCP-specific conventions on top of it:
 *   - an out-of-scope `entityId` throws (tools surface the message), where
 *     publications return nothing;
 *   - the per-user 'CONSOLIDATED' roll-up rows are always excluded, because
 *     every MCP consumer aggregates and those rows double-count;
 *   - the returned shape carries `clientIds` (= ownerIds) and `entityIds: null`
 *     for an unnarrowed admin, which is what the tools were written against.
 */

import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';
import { buildEntityOrUserFilter } from '/imports/utils/entityResolver';
import {
  resolveScope, holdingsSelector, snapshotsSelector, operationsSelector
} from '/server/helpers/accessScope.js';

export async function resolveMcpScope(user, { entityId = null } = {}) {
  if (!user) throw new Error('resolveMcpScope: user required');

  const viewAs = entityId ? { type: 'entity', id: entityId } : null;
  const scope = await resolveScope(user, viewAs, { excludeConsolidated: true });

  if (scope.denied && entityId) {
    // Keep the explicit messages the tools and Amber relay to the caller.
    const entity = await ClientEntitiesCollection.findOneAsync(entityId, { fields: { status: 1 } });
    if (!entity) throw new Error(`Entity ${entityId} not found`);
    if (ClientEntityHelpers.isEntityArchived(entity)) throw new Error(`Entity ${entityId} is archived`);
    throw new Error(`Entity ${entityId} is not in your access scope`);
  }

  return {
    ...scope,
    entityIds: scope.isAdmin ? null : scope.entityIds,
    clientIds: scope.ownerIds
  };
}

/** Scope filter for PMSHoldings (archived hidden, roll-ups excluded). */
export async function buildHoldingScopeFilter(scope) {
  return holdingsSelector(scope, { excludeConsolidated: true });
}

/** Scope filter for PortfolioSnapshots (roll-ups excluded; archived stay in history). */
export async function buildSnapshotScopeFilter(scope) {
  return snapshotsSelector(scope, { excludeConsolidated: true });
}

/** Scope filter for PMSOperations (transactions). */
export async function buildOperationsScopeFilter(scope) {
  return operationsSelector(scope);
}

/**
 * AND an archived-client exclusion onto an allocations query so closed relationships
 * never contribute to product visibility, exposure, or risk aggregations.
 */
export async function applyArchivedAllocationExclusion(query) {
  const exclusion = await ClientEntityHelpers.archivedAllocationsSelector();
  return exclusion.$nor ? { $and: [query, exclusion] } : query;
}

/**
 * Simple entityId/userId filter (no bankId path). Used where the target
 * collection has no bankId/portfolioCode fields (e.g. EquityHoldings is
 * keyed by bankAccountId instead).
 */
export function buildSimpleEntityOrUserFilter(scope) {
  if (scope.isAdmin) return {};
  return buildEntityOrUserFilter(scope.entityIds || [], scope.userIds || []);
}
