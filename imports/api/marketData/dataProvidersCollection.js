import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

/**
 * Data provider configuration — one document per market data provider.
 *
 * {
 *   providerId: String,        // 'EOD' | 'TELEKURS' | ... (unique index)
 *   name: String,
 *   enabled: Boolean,          // dashboard toggle
 *   priority: Number,          // 1 = tried first
 *   capabilities: { equity, etf, index, fx, bond, search },
 *   rateLimit: { perMinute: Number, perDay: Number } | null,
 *   hasApiKey: Boolean,        // recomputed from Meteor.settings on every boot —
 *                              // API keys themselves NEVER touch the database
 *   health: {
 *     lastSuccessAt: Date, lastErrorAt: Date, lastError: String,
 *     successCount: Number, errorCount: Number,
 *     dailyCreditsUsed: Number, dailyCreditsDate: String   // 'YYYY-MM-DD' UTC
 *   },
 *   createdAt: Date, updatedAt: Date
 * }
 */
export const DataProvidersCollection =
  (typeof window !== 'undefined' && window.DataProvidersCollection) ||
  new Mongo.Collection('dataProviders');

if (typeof window !== 'undefined') {
  window.DataProvidersCollection = DataProvidersCollection;
}

const EMPTY_HEALTH = {
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  successCount: 0,
  errorCount: 0,
  dailyCreditsUsed: 0,
  dailyCreditsDate: null
};

// Seed/refresh provider docs on startup. $setOnInsert preserves admin choices
// (enabled / priority / rateLimit) across restarts; $set keeps derived fields
// (hasApiKey, capabilities) in sync with the code and settings.json.
const SEED_PROVIDERS = () => [
  {
    providerId: 'EOD',
    name: 'EOD Historical Data',
    hasApiKey: true, // eodApi.js ships a built-in fallback token
    capabilities: { equity: true, etf: true, index: true, fx: true, bond: true, search: true },
    defaults: { enabled: true, priority: 1, rateLimit: null }
  },
  {
    providerId: 'TELEKURS',
    name: 'Telekurs (Excel)',
    hasApiKey: true, // DB-backed reads need no key — always eligible as last resort
    // Last-resort fallback: serves prices pushed from Telekurs.xlsx for tickers
    // EOD lacks (e.g. Japanese stocks). Not a search source.
    capabilities: { equity: true, etf: true, index: false, fx: false, bond: false, search: false },
    defaults: {
      enabled: true,
      priority: 2, // tried after EOD
      rateLimit: null
    }
  }
];

export async function seedDataProviders() {
  const seeds = SEED_PROVIDERS();
  for (const seed of seeds) {
    await DataProvidersCollection.upsertAsync(
      { providerId: seed.providerId },
      {
        $set: {
          name: seed.name,
          hasApiKey: seed.hasApiKey,
          capabilities: seed.capabilities,
          updatedAt: new Date()
        },
        $setOnInsert: {
          enabled: seed.defaults.enabled,
          priority: seed.defaults.priority,
          rateLimit: seed.defaults.rateLimit,
          health: EMPTY_HEALTH,
          createdAt: new Date()
        }
      }
    );
  }

  // Self-heal: drop any provider docs no longer in the code (e.g. FMP, JQUANTS
  // after they were removed) so the dashboard and router stay in sync.
  const validIds = seeds.map(s => s.providerId);
  const removed = await DataProvidersCollection.removeAsync({ providerId: { $nin: validIds } });
  if (removed) {
    console.log(`[DataProviders] Removed ${removed} obsolete provider doc(s) not in the seed`);
  }
  console.log('[DataProviders] Seeded provider configuration');
}

// Fire-and-forget health bookkeeping called by the router after each attempt.
export async function recordProviderHealth(providerId, ok, errorMessage = null) {
  const update = ok
    ? { $set: { 'health.lastSuccessAt': new Date() }, $inc: { 'health.successCount': 1 } }
    : {
        $set: { 'health.lastErrorAt': new Date(), 'health.lastError': errorMessage },
        $inc: { 'health.errorCount': 1 }
      };
  try {
    await DataProvidersCollection.updateAsync({ providerId }, update);
  } catch (e) {
    console.error(`[DataProviders] Failed to record health for ${providerId}:`, e.message);
  }
}

// Daily credit usage mirrored from the in-memory rate limiter for the dashboard.
export async function recordCreditsUsed(providerId, dailyCreditsUsed, dailyCreditsDate) {
  try {
    await DataProvidersCollection.updateAsync(
      { providerId },
      { $set: { 'health.dailyCreditsUsed': dailyCreditsUsed, 'health.dailyCreditsDate': dailyCreditsDate } }
    );
  } catch (e) {
    // non-critical
  }
}
