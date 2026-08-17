import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { GenericProductsCollection, GenericProductReportsCollection } from './collections.js';

// SECURITY: these were published to any DDP connection, leaking the generic-product
// catalog and reports. Require a real session or a valid PDF-render token.
async function requireViewer(sessionId, self) {
  const { isAuthorizedReportViewer } = await import('../../../server/helpers/reportViewerAuth.js');
  return isAuthorizedReportViewer(sessionId);
}

if (Meteor.isServer) {
  Meteor.publish('genericProducts.list', async function (sessionId) {
    check(sessionId, Match.Maybe(String));
    if (!(await requireViewer(sessionId))) return this.ready();
    return GenericProductsCollection.find({}, { sort: { lastUpdated: -1 } });
  });

  Meteor.publish('genericProducts.byId', async function (productId, sessionId) {
    check(productId, String);
    check(sessionId, Match.Maybe(String));
    if (!(await requireViewer(sessionId))) return this.ready();
    return GenericProductsCollection.find({ _id: productId });
  });

  Meteor.publish('genericProductReports.forProduct', async function (productId, sessionId) {
    check(productId, String);
    check(sessionId, Match.Maybe(String));
    if (!(await requireViewer(sessionId))) return this.ready();
    return GenericProductReportsCollection.find(
      { productId },
      { sort: { createdAt: -1 }, limit: 20 }
    );
  });
}
