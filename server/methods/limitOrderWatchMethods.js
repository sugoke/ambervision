/**
 * Limit order watch: on-demand run from the order book ("Check prices now").
 * The same check runs every 15 minutes in market hours (server/cron/jobs.js).
 */
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { checkLiveLimitOrders, LimitOrderWatchPermissions } from '../helpers/limitOrderWatch.js';

Meteor.methods({
  async 'orders.checkLimitLevels'({ sessionId, dryRun = false }) {
    check(sessionId, String);
    const session = await SessionHelpers.findByToken(sessionId);
    const user = session ? await UsersCollection.findOneAsync(session.userId) : null;
    if (!user || !LimitOrderWatchPermissions.canRun(user)) {
      throw new Meteor.Error('not-authorized', 'Not allowed to run the limit order check');
    }
    this.unblock();
    return checkLiveLimitOrders({ dryRun: dryRun === true });
  }
});
