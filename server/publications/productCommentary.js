import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ProductCommentaryCollection } from '/imports/api/riskAnalysis';
import { getSessionOrPdfUser } from '../helpers/sessionAuth.js';
import { resolveScope, isProductInScope } from '../helpers/accessScope.js';

/**
 * Latest commentary for a product the viewer may see. Also serves the PDF
 * renderer (`pdf-temp-<token>` in place of a session id).
 */
Meteor.publish('productCommentary', async function(productId, sessionId) {
  check(productId, String);
  check(sessionId, Match.Maybe(String));

  const user = await getSessionOrPdfUser({ sessionId });
  if (!user) return this.ready();

  const scope = await resolveScope(user);
  if (!(await isProductInScope(scope, productId))) return this.ready();

  return ProductCommentaryCollection.find({ productId }, { sort: { generatedAt: -1 }, limit: 1 });
});
