import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { DataProvidersCollection } from './dataProvidersCollection';
import { MarketDataRouter } from './marketDataRouter';
import { UsersCollection } from '../users';

// Admin methods for the Data Providers dashboard + the multi-provider search
// used by SecurityAutocomplete. Auth pattern mirrors marketData.clearCache.

if (Meteor.isServer) {
  async function requireAdmin(context, sessionId) {
    const currentUser = sessionId
      ? await Meteor.callAsync('auth.getCurrentUser', sessionId)
      : (context.userId ? await UsersCollection.findOneAsync(context.userId) : null);

    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'Must be logged in');
    }
    if (currentUser.role !== 'admin' && currentUser.role !== 'superadmin') {
      throw new Meteor.Error('access-denied', 'Only administrators can manage data providers');
    }
    return currentUser;
  }

  Meteor.methods({
    async 'dataProviders.list'(sessionId = null) {
      check(sessionId, Match.OneOf(String, null, undefined));
      await requireAdmin(this, sessionId);
      return await DataProvidersCollection.find({}, { sort: { priority: 1 } }).fetchAsync();
    },

    async 'dataProviders.setEnabled'(providerId, enabled, sessionId = null) {
      check(providerId, String);
      check(enabled, Boolean);
      check(sessionId, Match.OneOf(String, null, undefined));
      await requireAdmin(this, sessionId);

      if (!enabled) {
        const enabledCount = await DataProvidersCollection.find({ enabled: true }).countAsync();
        const target = await DataProvidersCollection.findOneAsync({ providerId });
        if (target?.enabled && enabledCount <= 1) {
          throw new Meteor.Error('last-provider', 'Cannot disable the last enabled data provider');
        }
      }

      await DataProvidersCollection.updateAsync(
        { providerId },
        { $set: { enabled, updatedAt: new Date() } }
      );
      return { providerId, enabled };
    },

    async 'dataProviders.setPriority'(providerId, priority, sessionId = null) {
      check(providerId, String);
      check(priority, Number);
      check(sessionId, Match.OneOf(String, null, undefined));
      await requireAdmin(this, sessionId);

      await DataProvidersCollection.updateAsync(
        { providerId },
        { $set: { priority, updatedAt: new Date() } }
      );
      return { providerId, priority };
    },

    async 'dataProviders.setRateLimit'(providerId, rateLimit, sessionId = null) {
      check(providerId, String);
      check(rateLimit, Match.OneOf({ perMinute: Number, perDay: Number }, null));
      check(sessionId, Match.OneOf(String, null, undefined));
      await requireAdmin(this, sessionId);

      await DataProvidersCollection.updateAsync(
        { providerId },
        { $set: { rateLimit, updatedAt: new Date() } }
      );
      return { providerId, rateLimit };
    },

    async 'dataProviders.resetHealth'(providerId, sessionId = null) {
      check(providerId, String);
      check(sessionId, Match.OneOf(String, null, undefined));
      await requireAdmin(this, sessionId);

      await DataProvidersCollection.updateAsync(
        { providerId },
        {
          $set: {
            health: {
              lastSuccessAt: null,
              lastErrorAt: null,
              lastError: null,
              successCount: 0,
              errorCount: 0,
              dailyCreditsUsed: 0,
              dailyCreditsDate: null
            },
            updatedAt: new Date()
          }
        }
      );
      return { providerId };
    },

    // Probe a ticker against every enabled provider individually so the admin
    // can see exactly which provider covers it (the gap-debugging tool).
    async 'dataProviders.testTicker'(fullTicker, sessionId = null) {
      check(fullTicker, String);
      check(sessionId, Match.OneOf(String, null, undefined));
      await requireAdmin(this, sessionId);
      this.unblock();

      return await MarketDataRouter.testTicker(fullTicker.trim().toUpperCase());
    },

    // Multi-provider security search for autocomplete. Same input contract and
    // result shape as eod.searchSecurities (which remains available unchanged).
    async 'marketData.searchSecurities'(query, limit = 20) {
      if (typeof query !== 'string' || query.length < 2) {
        return [];
      }
      if (typeof limit !== 'number' || limit < 1 || limit > 50) {
        limit = 20;
      }
      this.unblock();

      return await MarketDataRouter.searchSecurities(query, limit);
    }
  });
}
