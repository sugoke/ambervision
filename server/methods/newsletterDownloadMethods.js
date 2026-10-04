/**
 * Newsletter downloads. Files live in the private store (documentStorage
 * getNewslettersDir) and are served by the /newsletters handler in
 * server/main.js only with a short-lived capability token minted here, after
 * the same role check the 'newsletters' publication applies.
 */

import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection } from '/imports/api/users';
import { NewslettersCollection, NEWSLETTER_URL_PREFIX, SAFE_NEWSLETTER_FILENAME } from '/imports/api/newsletters';
import { issueDocumentToken } from '../documentAccess.js';

Meteor.methods({
  async 'newsletters.getDownloadUrl'(sessionId, newsletterId) {
    check(sessionId, String);
    check(newsletterId, String);

    const session = await SessionHelpers.findByToken(sessionId);
    if (!session?.userId) throw new Meteor.Error('not-authorized', 'You must be logged in');
    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user) throw new Meteor.Error('not-authorized', 'User not found');

    const newsletter = await NewslettersCollection.findOneAsync(newsletterId);
    if (!newsletter) throw new Meteor.Error('not-found', 'Newsletter not found');

    const roles = newsletter.visibleToRoles || [];
    if (roles.length > 0 && !roles.includes(user.role)) {
      throw new Meteor.Error('not-authorized', 'This newsletter is not available to you');
    }
    if (!SAFE_NEWSLETTER_FILENAME.test(newsletter.uniqueFilename || '')) {
      throw new Meteor.Error('internal', 'Stored filename is invalid');
    }

    const publicPath = `${NEWSLETTER_URL_PREFIX}/${newsletter.uniqueFilename}`;
    const token = await issueDocumentToken(publicPath, user._id);
    return { url: `${publicPath}?dl=${token}` };
  }
});
