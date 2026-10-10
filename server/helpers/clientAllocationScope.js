import { resolveScope, allocationsSelector } from './accessScope.js';

/**
 * Allocation selector for a login: every allocation in the user's access scope,
 * under whichever owner key it was recorded with (legacy login id, client
 * entity id, or bank account).
 *
 * Thin wrapper over the access scope, kept for its call sites.
 *
 * @returns {Promise<Object|null>} Mongo selector, or null when nothing is in scope
 */
export async function clientAllocationSelector(user) {
  const scope = await resolveScope(user);
  if (scope.denied) return null;
  return allocationsSelector(scope);
}
