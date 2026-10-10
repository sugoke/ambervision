import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { GenericProductsCollection, GenericProductReportsCollection } from './collections.js';

// Generic products are product master data: catalogue roles read them all,
// clients read the ones in their scope. A real session or the PDF-render token
// identifies the viewer (see server/helpers/reportViewerAuth.js).

if (Meteor.isServer) {
  Meteor.publish('genericProducts.list', async function (sessionId) {
    check(sessionId, Match.Maybe(String));
    const { getReportViewerScope, productFeedClause } = await import('../../../server/helpers/reportViewerAuth.js');
    const scope = await getReportViewerScope(sessionId);
    if (!scope) return this.ready();
    const feed = await productFeedClause(scope, '_id');
    if (!feed) return this.ready();
    return GenericProductsCollection.find(feed, { sort: { lastUpdated: -1 } });
  });

  Meteor.publish('genericProducts.byId', async function (productId, sessionId) {
    check(productId, String);
    check(sessionId, Match.Maybe(String));
    const { getProductViewerScope } = await import('../../../server/helpers/reportViewerAuth.js');
    if (!(await getProductViewerScope(sessionId, productId))) return this.ready();
    return GenericProductsCollection.find({ _id: productId });
  });

  Meteor.publish('genericProductReports.forProduct', async function (productId, sessionId) {
    check(productId, String);
    check(sessionId, Match.Maybe(String));
    const { getProductViewerScope } = await import('../../../server/helpers/reportViewerAuth.js');
    if (!(await getProductViewerScope(sessionId, productId))) return this.ready();
    return GenericProductReportsCollection.find(
      { productId },
      { sort: { createdAt: -1 }, limit: 20 }
    );
  });
}
