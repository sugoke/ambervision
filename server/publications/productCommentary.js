import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ProductCommentaryCollection } from '/imports/api/riskAnalysis';

/**
 * Publish the latest commentary for a specific product
 */
Meteor.publish('productCommentary', async function(productId, sessionId) {
  check(productId, String);
  check(sessionId, Match.Maybe(String));

  // SECURITY: previously type-checked the session but never validated it — any string
  // received the data. Require a real session or a valid PDF-render token.
  const { isAuthorizedReportViewer } = await import('../helpers/reportViewerAuth.js');
  if (!(await isAuthorizedReportViewer(sessionId))) return this.ready();

  return ProductCommentaryCollection.find(
    { productId },
    {
      sort: { generatedAt: -1 },
      limit: 1
    }
  );
});
