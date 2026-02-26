import { Meteor } from 'meteor/meteor';
import { ManualPriceTrackersCollection } from '../../imports/api/manualPriceTrackers.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';

Meteor.publish('manualPriceTrackers', async function (sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return this.ready();
  }

  try {
    const session = await SessionsCollection.findOneAsync({
      sessionId,
      isActive: true
    });

    if (!session) {
      return this.ready();
    }

    const user = await UsersCollection.findOneAsync(session.userId);

    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return this.ready();
    }

    return ManualPriceTrackersCollection.find({}, {
      sort: { name: 1 }
    });
  } catch (error) {
    console.error('[manualPriceTrackers] Publication error:', error.message);
    return this.ready();
  }
});
