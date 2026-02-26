import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const ManualPriceTrackersCollection = new Mongo.Collection('manualPriceTrackers');

// Create indexes on server
if (Meteor.isServer) {
  Meteor.startup(async () => {
    await ManualPriceTrackersCollection.createIndexAsync({ isin: 1 }, { unique: true });
    await ManualPriceTrackersCollection.createIndexAsync({ isActive: 1 });
    await ManualPriceTrackersCollection.createIndexAsync({ name: 1 });
  });
}

export const ManualPriceTrackerHelpers = {
  async addTracker({ isin, name, url, currency }) {
    const existing = await ManualPriceTrackersCollection.findOneAsync({ isin });
    if (existing) {
      throw new Meteor.Error('duplicate-isin', `Tracker for ISIN ${isin} already exists`);
    }

    const now = new Date();
    return await ManualPriceTrackersCollection.insertAsync({
      isin,
      name,
      url,
      currency: currency || 'EUR',
      latestPrice: null,
      lastScrapedAt: null,
      lastScrapeError: null,
      priceHistory: [],
      isActive: true,
      createdAt: now,
      updatedAt: now
    });
  },

  async updateTracker(id, { name, url, currency }) {
    const updateFields = { updatedAt: new Date() };
    if (name !== undefined) updateFields.name = name;
    if (url !== undefined) updateFields.url = url;
    if (currency !== undefined) updateFields.currency = currency;

    return await ManualPriceTrackersCollection.updateAsync(id, {
      $set: updateFields
    });
  },

  async removeTracker(id) {
    return await ManualPriceTrackersCollection.removeAsync(id);
  },

  async recordPrice(id, price) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const now = new Date();

    const tracker = await ManualPriceTrackersCollection.findOneAsync(id);
    if (!tracker) {
      throw new Meteor.Error('not-found', 'Tracker not found');
    }

    // Deduplicate by date - remove existing entry for today if any
    const filteredHistory = (tracker.priceHistory || []).filter(h => h.date !== today);
    filteredHistory.push({ date: today, price, scrapedAt: now });

    // Sort by date descending
    filteredHistory.sort((a, b) => b.date.localeCompare(a.date));

    return await ManualPriceTrackersCollection.updateAsync(id, {
      $set: {
        latestPrice: price,
        lastScrapedAt: now,
        lastScrapeError: null,
        priceHistory: filteredHistory,
        updatedAt: now
      }
    });
  },

  async recordScrapeError(id, errorMessage) {
    return await ManualPriceTrackersCollection.updateAsync(id, {
      $set: {
        lastScrapeError: errorMessage,
        updatedAt: new Date()
      }
    });
  },

  async getActiveTrackers() {
    return await ManualPriceTrackersCollection.find(
      { isActive: true },
      { sort: { name: 1 } }
    ).fetchAsync();
  }
};
