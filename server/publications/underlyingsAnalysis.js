import { Meteor } from 'meteor/meteor';
import { UnderlyingsAnalysisCollection } from '/imports/api/underlyingsAnalysis';

/**
 * Publish the Phoenix underlyings analysis
 * Single document containing all pre-computed data
 */
Meteor.publish('phoenixUnderlyingsAnalysis', function() {
  // Return the analysis document (public data, all users can access)
  return UnderlyingsAnalysisCollection.find({ _id: 'phoenix_live_underlyings' });
});
