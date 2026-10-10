// Order Publications
//
// The order book is a desk tool: every staff role in ORDER_BOOK_ROLES sees the
// whole firm's orders. A client sees its own orders only (resolved through the
// access scope, so entity-keyed and legacy-keyed orders both show). Any other
// role sees nothing.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { OrdersCollection, ORDER_STATUSES } from '/imports/api/orders';
import { USER_ROLES } from '/imports/api/users';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { ORDER_BOOK_ROLES } from '../helpers/accessPolicy.js';
import { resolveScope, ordersSelector, IMPOSSIBLE } from '../helpers/accessScope.js';

/**
 * The owner clause for this viewer: `{}` for the order book, the client's own
 * scope for a client, IMPOSSIBLE for everyone else.
 */
async function viewerOrdersClause(user) {
  if (ORDER_BOOK_ROLES.includes(user.role)) return {};
  if (user.role === USER_ROLES.CLIENT) return ordersSelector(await resolveScope(user));
  return { $and: [IMPOSSIBLE] };
}

async function publishCursor(pub, cursor) {
  const handle = await cursor.observeChanges({
    added(id, fields) { pub.added('orders', id, fields); },
    changed(id, fields) { pub.changed('orders', id, fields); },
    removed(id) { pub.removed('orders', id); }
  });
  pub.ready();
  pub.onStop(() => handle.stop());
}

/**
 * Orders list with optional filters.
 */
Meteor.publish('orders', async function(sessionId, filters = {}) {
  check(sessionId, Match.Maybe(String));
  check(filters, {
    status: Match.Maybe(Match.OneOf(String, [String])),
    clientId: Match.Maybe(String),
    bankId: Match.Maybe(String),
    priceType: Match.Maybe(Match.OneOf(String, [String])),
    limit: Match.Maybe(Number)
  });

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const clauses = [await viewerOrdersClause(user)];
  const extra = {};

  if (filters.status) {
    extra.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
  }
  // The client picker is a staff filter; a client's perimeter is already fixed above.
  if (filters.clientId && ORDER_BOOK_ROLES.includes(user.role)) {
    extra.clientId = filters.clientId;
  }
  if (filters.bankId) extra.bankId = filters.bankId;
  if (filters.priceType) {
    extra.priceType = Array.isArray(filters.priceType) ? { $in: filters.priceType } : filters.priceType;
  }
  clauses.push(extra);

  const cursor = OrdersCollection.find({ $and: clauses }, {
    sort: { createdAt: -1 },
    limit: Math.min(filters.limit || 100, 1000)
  });
  await publishCursor(this, cursor);
});

/**
 * Single order publication
 */
Meteor.publish('orders.single', async function(sessionId, orderId) {
  check(sessionId, Match.Maybe(String));
  check(orderId, String);

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const cursor = OrdersCollection.find({ $and: [await viewerOrdersClause(user), { _id: orderId }] });
  await publishCursor(this, cursor);
});

/**
 * Live trace / status fields for a set of order ids already on screen.
 *
 * The order book loads its page through the orders.list METHOD (one-shot), so
 * a trace attached from the detail modal in another tab, by a colleague, or by
 * any other client left the "Traces" badge stale until the page was reloaded
 * (2026-00137 showed 3/4 with four traces on file). Subscribing to just the
 * visible ids keeps those badges reactive without publishing whole orders.
 */
Meteor.publish('orders.liveTraces', async function(sessionId, orderIds) {
  check(sessionId, Match.Maybe(String));
  check(orderIds, [String]);

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const ids = [...new Set(orderIds)].slice(0, 500);
  if (ids.length === 0) return this.ready();

  const cursor = OrdersCollection.find(
    { $and: [await viewerOrdersClause(user), { _id: { $in: ids } }] },
    { fields: { emailTraces: 1, status: 1, termsheetStatus: 1, clientOrderDeferred: 1, updatedAt: 1 } }
  );
  await publishCursor(this, cursor);
});

/**
 * Pending orders count publication (for dashboard badge) — order-book staff only.
 */
Meteor.publish('orders.pendingCount', async function(sessionId) {
  check(sessionId, Match.Maybe(String));

  const user = await getSessionUser(sessionId);
  if (!user || !ORDER_BOOK_ROLES.includes(user.role)) return this.ready();

  const query = {
    status: { $in: [ORDER_STATUSES.PENDING_VALIDATION, ORDER_STATUSES.PENDING, ORDER_STATUSES.TRANSMITTED, ORDER_STATUSES.SENT] }
  };

  const self = this;
  let count = 0;
  const initialCount = await OrdersCollection.find(query).countAsync();
  self.added('orderCounts', 'pending', { count: initialCount });

  const handle = await OrdersCollection.find(query).observeChanges({
    added: () => {
      count++;
      self.changed('orderCounts', 'pending', { count: initialCount + count });
    },
    removed: () => {
      count--;
      self.changed('orderCounts', 'pending', { count: initialCount + count });
    }
  });

  self.ready();
  self.onStop(() => handle.stop());
});

/**
 * Bulk order group publication — order-book staff only (compliance validates
 * in the four-eyes blotter, so it needs the group too).
 */
Meteor.publish('orders.bulkGroup', async function(sessionId, bulkOrderGroupId) {
  check(sessionId, Match.Maybe(String));
  check(bulkOrderGroupId, String);

  const user = await getSessionUser(sessionId);
  if (!user || !ORDER_BOOK_ROLES.includes(user.role)) return this.ready();

  return OrdersCollection.find({ bulkOrderGroupId }, { sort: { createdAt: 1 } });
});
