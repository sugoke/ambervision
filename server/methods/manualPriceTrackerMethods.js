import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ManualPriceTrackersCollection, ManualPriceTrackerHelpers } from '../../imports/api/manualPriceTrackers.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { scrapePrice } from '../../imports/api/priceScraperService.js';

/**
 * Validate session and ensure user is admin
 */
async function validateAdminSession(sessionId) {
  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  if (user.role !== 'admin' && user.role !== 'superadmin') {
    throw new Meteor.Error('not-authorized', 'Admin access required');
  }

  return user;
}

Meteor.methods({
  /**
   * Add a new price tracker
   */
  async 'manualPriceTrackers.add'({ isin, name, url, currency, sessionId }) {
    check(isin, String);
    check(name, String);
    check(url, String);
    check(currency, String);
    check(sessionId, String);

    await validateAdminSession(sessionId);

    console.log(`[PRICE_TRACKER] Adding tracker: ${name} (${isin})`);

    try {
      const id = await ManualPriceTrackerHelpers.addTracker({ isin, name, url, currency });
      return { success: true, id };
    } catch (error) {
      console.error(`[PRICE_TRACKER] Error adding tracker: ${error.message}`);
      throw new Meteor.Error('add-failed', error.message);
    }
  },

  /**
   * Update an existing tracker
   */
  async 'manualPriceTrackers.update'({ id, name, url, currency, sessionId }) {
    check(id, String);
    check(sessionId, String);

    await validateAdminSession(sessionId);

    console.log(`[PRICE_TRACKER] Updating tracker: ${id}`);

    try {
      await ManualPriceTrackerHelpers.updateTracker(id, { name, url, currency });
      return { success: true };
    } catch (error) {
      console.error(`[PRICE_TRACKER] Error updating tracker: ${error.message}`);
      throw new Meteor.Error('update-failed', error.message);
    }
  },

  /**
   * Remove a tracker
   */
  async 'manualPriceTrackers.remove'({ id, sessionId }) {
    check(id, String);
    check(sessionId, String);

    await validateAdminSession(sessionId);

    console.log(`[PRICE_TRACKER] Removing tracker: ${id}`);

    try {
      await ManualPriceTrackerHelpers.removeTracker(id);
      return { success: true };
    } catch (error) {
      console.error(`[PRICE_TRACKER] Error removing tracker: ${error.message}`);
      throw new Meteor.Error('remove-failed', error.message);
    }
  },

  /**
   * Scrape price for a single tracker
   */
  async 'manualPriceTrackers.scrape'({ id, sessionId }) {
    check(id, String);
    check(sessionId, String);

    await validateAdminSession(sessionId);

    const tracker = await ManualPriceTrackersCollection.findOneAsync(id);
    if (!tracker) {
      throw new Meteor.Error('not-found', 'Tracker not found');
    }

    console.log(`[PRICE_TRACKER] Scraping: ${tracker.name} (${tracker.isin})`);

    try {
      const result = await scrapePrice(tracker.url, tracker.name, tracker.currency);
      await ManualPriceTrackerHelpers.recordPrice(id, result.price);
      console.log(`[PRICE_TRACKER] Success: ${tracker.name} = ${result.price} ${tracker.currency}`);
      return { success: true, price: result.price, confidence: result.confidence };
    } catch (error) {
      const errorMsg = error.reason || error.message || 'Unknown error';
      console.error(`[PRICE_TRACKER] Scrape failed for ${tracker.name}: ${errorMsg}`);
      await ManualPriceTrackerHelpers.recordScrapeError(id, errorMsg);
      throw new Meteor.Error('scrape-failed', errorMsg);
    }
  },

  /**
   * Scrape all active trackers sequentially
   */
  async 'manualPriceTrackers.scrapeAll'({ sessionId }) {
    check(sessionId, String);

    await validateAdminSession(sessionId);

    const trackers = await ManualPriceTrackerHelpers.getActiveTrackers();
    console.log(`[PRICE_TRACKER] Scraping all ${trackers.length} active trackers`);

    const results = { success: 0, failed: 0, errors: [] };

    for (const tracker of trackers) {
      try {
        const result = await scrapePrice(tracker.url, tracker.name, tracker.currency);
        await ManualPriceTrackerHelpers.recordPrice(tracker._id, result.price);
        results.success++;
        console.log(`[PRICE_TRACKER] OK: ${tracker.name} = ${result.price} ${tracker.currency}`);
      } catch (error) {
        const errorMsg = error.reason || error.message || 'Unknown error';
        results.failed++;
        results.errors.push({ name: tracker.name, isin: tracker.isin, error: errorMsg });
        await ManualPriceTrackerHelpers.recordScrapeError(tracker._id, errorMsg);
        console.error(`[PRICE_TRACKER] FAIL: ${tracker.name}: ${errorMsg}`);
      }
    }

    console.log(`[PRICE_TRACKER] Scrape all complete: ${results.success} success, ${results.failed} failed`);
    return results;
  }
});
