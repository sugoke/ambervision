// Order Publications
// Handles all order-related publications with role-based access control

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { OrdersCollection, ORDER_STATUSES } from '/imports/api/orders';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';

/**
 * Validate session and get user
 * @param {String} sessionId - Session ID
 * @returns {Object|null} User object or null
 */
async function validateSessionAndGetUser(sessionId) {
  if (!sessionId) return null;

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) return null;

  return await UsersCollection.findOneAsync(session.userId);
}

/**
 * Orders publication with role-based filtering
 * - Admins/Superadmins: All orders
 * - RMs: Orders for their clients only
 * - Clients: Their own orders only (read-only)
 */
Meteor.publish('orders', async function(sessionId, filters = {}) {
  check(sessionId, Match.Maybe(String));
  check(filters, {
    status: Match.Maybe(Match.OneOf(String, [String])),
    clientId: Match.Maybe(String),
    bankId: Match.Maybe(String),
    limit: Match.Maybe(Number)
  });

  const user = await validateSessionAndGetUser(sessionId);

  if (!user) {
    return this.ready();
  }

  // Build query based on role
  const query = {};

  if (user.role === USER_ROLES.CLIENT) {
    // Clients only see their own orders
    query.clientId = user._id;
  } else if (user.role === 'rm') {
    // RMs see orders for their clients
    const rmClients = await UsersCollection.find({ rmId: user._id }).fetchAsync();
    const clientIds = rmClients.map(c => c._id);
    query.clientId = { $in: clientIds };
  }
  // Admins and superadmins see all orders (no clientId filter)

  // Apply additional filters
  if (filters.status) {
    query.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
  }

  if (filters.clientId && (user.role === 'admin' || user.role === 'superadmin' || user.role === 'rm')) {
    // Override for specific client filter (if user has permission)
    query.clientId = filters.clientId;
  }

  if (filters.bankId) {
    query.bankId = filters.bankId;
  }

  const options = {
    sort: { createdAt: -1 },
    limit: filters.limit || 100
  };

  return OrdersCollection.find(query, options);
});

/**
 * Single order publication
 */
Meteor.publish('orders.single', async function(sessionId, orderId) {
  check(sessionId, Match.Maybe(String));
  check(orderId, String);

  const user = await validateSessionAndGetUser(sessionId);

  if (!user) {
    return this.ready();
  }

  const order = await OrdersCollection.findOneAsync(orderId);

  if (!order) {
    return this.ready();
  }

  // Check access based on role
  if (user.role === USER_ROLES.CLIENT) {
    // Clients can only see their own orders
    if (order.clientId !== user._id) {
      return this.ready();
    }
  } else if (user.role === 'rm') {
    // RMs can see orders for their clients
    const client = await UsersCollection.findOneAsync(order.clientId);
    if (!client || client.rmId !== user._id) {
      return this.ready();
    }
  }
  // Admins and superadmins can see all orders

  return OrdersCollection.find({ _id: orderId });
});

/**
 * Pending orders count publication (for dashboard badge)
 */
Meteor.publish('orders.pendingCount', async function(sessionId) {
  check(sessionId, Match.Maybe(String));

  const user = await validateSessionAndGetUser(sessionId);

  if (!user) {
    return this.ready();
  }

  // Only show pending count to RMs and Admins
  if (!['rm', 'admin', 'superadmin'].includes(user.role)) {
    return this.ready();
  }

  const query = {
    status: { $in: [ORDER_STATUSES.PENDING, ORDER_STATUSES.SENT] }
  };

  // RMs only see count for their clients
  if (user.role === 'rm') {
    const rmClients = await UsersCollection.find({ rmId: user._id }).fetchAsync();
    const clientIds = rmClients.map(c => c._id);
    query.clientId = { $in: clientIds };
  }

  // Use a count-only cursor for efficiency
  const self = this;
  let count = 0;

  const initialCount = await OrdersCollection.find(query).countAsync();

  // Publish as a virtual document
  self.added('orderCounts', 'pending', { count: initialCount });

  // Watch for changes
  const handle = OrdersCollection.find(query).observeChanges({
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

  self.onStop(() => {
    handle.stop();
  });
});

/**
 * Bulk order group publication
 */
Meteor.publish('orders.bulkGroup', async function(sessionId, bulkOrderGroupId) {
  check(sessionId, Match.Maybe(String));
  check(bulkOrderGroupId, String);

  const user = await validateSessionAndGetUser(sessionId);

  if (!user) {
    return this.ready();
  }

  // Only RMs and Admins can view bulk groups
  if (!['rm', 'admin', 'superadmin'].includes(user.role)) {
    return this.ready();
  }

  const query = { bulkOrderGroupId };

  // RMs only see their clients' orders
  if (user.role === 'rm') {
    const rmClients = await UsersCollection.find({ rmId: user._id }).fetchAsync();
    const clientIds = rmClients.map(c => c._id);
    query.clientId = { $in: clientIds };
  }

  return OrdersCollection.find(query, { sort: { createdAt: 1 } });
});
