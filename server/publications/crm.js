// CRM Publications
// Handles all CRM-related publications (clients, meetings, documents, activities)

import { check } from 'meteor/check';
// import { InvestorProfilesCollection } from '/imports/api/investorProfiles'; // Commented out - module doesn't exist
import { UsersCollection, USER_ROLES } from '/imports/api/users';

Meteor.publish('clientDocuments', function(clientId) {
  check(clientId, String);
  if (!this.userId) return this.ready();

  const { ClientDocumentsCollection } = require('/imports/api/clientDocuments');
  return ClientDocumentsCollection.find({ clientId: clientId });
});

Meteor.publish('clientMeetings', function(clientId) {
  check(clientId, String);
  if (!this.userId) return this.ready();

  const { ClientMeetingsCollection } = require('/imports/api/clientMeetings');
  return ClientMeetingsCollection.find({ clientId: clientId });
});

Meteor.publish('clientActivities', function(clientId, limit = 50) {
  check(clientId, String);
  check(limit, Number);
  if (!this.userId) return this.ready();

  const { ClientActivitiesCollection } = require('/imports/api/clientActivities');
  return ClientActivitiesCollection.find(
    { clientId: clientId },
    { sort: { actualDate: -1, createdAt: -1 }, limit: limit }
  );
});

// Publish investor profiles (admin only) - COMMENTED OUT - InvestorProfilesCollection doesn't exist
// Meteor.publish('investorProfiles', async function() {
//   const user = await UsersCollection.findOneAsync(this.userId);
//   if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
//     return this.ready();
//   }
//   return InvestorProfilesCollection.find({}, { sort: { createdAt: -1 } });
// });






