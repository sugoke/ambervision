import { Meteor } from 'meteor/meteor';

import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection } from '/imports/api/users';
import { ResearchDocumentsCollection, canReadResearch } from '/imports/api/researchDocuments';

if (Meteor.isServer) {
  Meteor.startup(() => {
    ResearchDocumentsCollection.createIndex({ category: 1, documentDate: -1 });
    ResearchDocumentsCollection.createIndex({ 'security.ticker': 1, documentDate: -1 });
    ResearchDocumentsCollection.createIndex({ storedFileName: 1 }, { unique: true });
  });
}

/**
 * The whole research library, for any non-client role. Filtering and search
 * happen client-side — the library is a few hundred PDFs at most.
 */
Meteor.publish('research.list', async function (sessionId) {
  // SECURITY: string-only — a selector object would match the first live session.
  if (typeof sessionId !== 'string' || sessionId.length === 0) return this.ready();

  const session = await SessionHelpers.validateSession(sessionId);
  if (!session) return this.ready();
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!canReadResearch(user)) return this.ready();

  return ResearchDocumentsCollection.find({}, {
    sort: { documentDate: -1, uploadedAt: -1 },
    limit: 2000
  });
});
