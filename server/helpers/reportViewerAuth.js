// Viewer resolution for product-level feeds (evaluation reports, chart data,
// schedules, commentary, generic products).
//
// Two legitimate callers exist:
//   1. A normal logged-in user — a real hashed session token.
//   2. The headless PDF renderer — which cannot hold a real session and instead
//      passes `pdf-temp-<pdfToken>`, a short-lived capability minted by
//      pdf.generateReport for the user who asked for the PDF.
//
// The token identifies the user; the user's access scope decides which
// products they may read (catalogue roles: all; clients: held products only).
import { getSessionOrPdfUser } from './sessionAuth.js';
import { resolveScope, isProductInScope, productIdsInScope } from './accessScope.js';

/** Scope of the viewer behind a session or PDF token, or null. */
export async function getReportViewerScope(sessionId) {
  const user = await getSessionOrPdfUser({ sessionId });
  if (!user) return null;
  const scope = await resolveScope(user);
  return scope.denied ? null : scope;
}

/** Scope of the viewer when they may read `productId`, else null. */
export async function getProductViewerScope(sessionId, productId) {
  const scope = await getReportViewerScope(sessionId);
  if (!scope) return null;
  return (await isProductInScope(scope, productId)) ? scope : null;
}

/**
 * Selector clause limiting a product-keyed collection to the viewer's
 * products: `{}` for catalogue roles, `{ productId: { $in } }` for clients,
 * null when nothing is visible.
 */
export async function productFeedClause(scope, field = 'productId') {
  const ids = await productIdsInScope(scope);
  if (ids === null) return {};
  if (ids.size === 0) return null;
  return { [field]: { $in: [...ids] } };
}

/** @deprecated kept for callers that only need "is anyone authenticated" */
export async function isAuthorizedReportViewer(sessionId) {
  return !!(await getReportViewerScope(sessionId));
}
