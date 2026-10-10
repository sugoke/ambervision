// Holdings scope helper
//
// "Which products are currently HELD" for a user + View As scope, using actual
// bank holdings (PMSHoldings) as the source of truth. Used to hide sold/matured
// products from the Underlyings and Schedule sections.
//
// Thin wrapper over the access scope (server/helpers/accessScope.js), which is
// the single implementation of the owner rules.

import { parseViewAsOrNull } from '/imports/utils/viewAs';
import { resolveScope, holdingsSelector, heldProductIds } from './accessScope.js';

/**
 * PMSHoldings selector for the given user and View As filter, or null when the
 * scope resolves to nothing.
 */
export async function buildHoldingsScopeSelector({ currentUser, viewAsFilter }) {
  if (!currentUser) return null;
  const scope = await resolveScope(currentUser, parseViewAsOrNull(viewAsFilter));
  if (scope.denied) return null;
  return holdingsSelector(scope);
}

/**
 * The Products._id currently HELD within the given scope.
 * @returns {Promise<Set<string>>}
 */
export async function getHeldProductIdsForScope({ currentUser, viewAsFilter }) {
  if (!currentUser) return new Set();
  const scope = await resolveScope(currentUser, parseViewAsOrNull(viewAsFilter));
  if (scope.denied) return new Set();
  return heldProductIds(scope);
}
