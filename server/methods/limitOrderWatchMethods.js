/**
 * Limit order watch: on-demand run from the order book ("Check prices now").
 * The same check runs every 15 minutes in market hours (server/cron/jobs.js).
 */
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { checkLiveLimitOrders, indicativePrice, LimitOrderWatchPermissions } from '../helpers/limitOrderWatch.js';
import { OrdersCollection } from '../../imports/api/orders.js';

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
  },

  // Indicative price now for the four-eyes review (right security? where is the market?)
  async 'orders.getIndicativePrice'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    const session = await SessionHelpers.findByToken(sessionId);
    const user = session ? await UsersCollection.findOneAsync(session.userId) : null;
    if (!user || !LimitOrderWatchPermissions.canRun(user)) {
      throw new Meteor.Error('not-authorized', 'Not allowed');
    }
    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) throw new Meteor.Error('not-found', 'Order not found');
    this.unblock();
    try {
      return await indicativePrice(order);
    } catch (error) {
      return { found: false, issue: error.reason || error.message };
    }
  }
});
