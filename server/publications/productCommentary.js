import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ProductCommentaryCollection } from '/imports/api/riskAnalysis';

/**
 * Publish the latest commentary for a specific product
 */
Meteor.publish('productCommentary', function(productId, sessionId) {
  check(productId, String);
  check(sessionId, String);

  return ProductCommentaryCollection.find(
    { productId },
    {
      sort: { generatedAt: -1 },
      limit: 1
    }
  );
});
