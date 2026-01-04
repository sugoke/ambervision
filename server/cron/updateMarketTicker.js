import { Meteor } from 'meteor/meteor';
import { TickerCacheHelpers } from '/imports/api/tickerCache';
import { ProductsCollection } from '/imports/api/products';
import { SessionsCollection } from '/imports/api/sessions';
import { CronJobLogHelpers } from '/imports/api/cronJobLogs';
import { normalizeExchangeForEOD } from '/imports/utils/tickerUtils';

/**
 * Market Ticker Price Update Job
 *
 * Runs every 15 minutes (conditionally based on user activity)
 * Fetches prices for base securities + product underlyings
 * Stores in TickerPriceCacheCollection for reactive display
 */

// Track last update time globally
let lastUpdateTime = null;

// Base securities to always track (major indices, forex, crypto)
const BASE_SECURITIES = [
  'GSPC.INDX',      // S&P 500
  'IXIC.INDX',      // Nasdaq
  'N225.INDX',      // Nikkei 225
  'STOXX50E.INDX',  // Eurostoxx 50
  'FCHI.INDX',      // CAC 40
  'GDAXI.INDX',     // DAX
  'EURUSD.FOREX',   // EUR/USD
  'BTC-USD.CC'      // Bitcoin
];

/**
 * Check if there was recent user activity
 * @param {number} minutes - Activity window in minutes
 * @returns {Promise<boolean>} True if there are active sessions
 */
async function hasRecentActivity(minutes = 30) {
  try {
    // First check: Are there ANY active Meteor WebSocket connections?
    // WebSocket connections close when browser closes - accurate check
    const activeConnections = Meteor.server.sessions?.size || 0;
    if (activeConnections === 0) {
      console.log('[MarketTicker] No active WebSocket connections - skipping');
      return false;
    }

    // Second check: Recent session activity (existing logic for extra safety)
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);
    const count = await SessionsCollection.find({
      lastUsed: { $gt: cutoffTime },
      isActive: true
    }).countAsync();

    return count > 0;
  } catch (error) {
    console.error('[MarketTicker] Error checking activity:', error);
    // On error, assume there is activity (fail-safe)
    return true;
  }
}

/**
 * Get all tickers that need updating
 * Combines base securities with underlyings from all products
 * @returns {Promise<string[]>} Array of normalized ticker symbols
 */
async function getAllTickersToUpdate() {
  const tickersSet = new Set(BASE_SECURITIES);

  try {
    // Get all products with their underlyings
    const products = await ProductsCollection.find({}, {
      fields: {
        underlyings: 1,
        payoffStructure: 1
      }
    }).fetchAsync();

    console.log(`[MarketTicker] Scanning ${products.length} products for underlyings`);

    products.forEach(product => {
      // Extract from underlyings array
      if (product.underlyings && Array.isArray(product.underlyings)) {
        product.underlyings.forEach(underlying => {
          // Try multiple possible ticker locations
          let ticker = null;

          if (underlying.securityData?.ticker) {
            ticker = underlying.securityData.ticker;
          } else if (underlying.ticker) {
            ticker = underlying.ticker;
          } else if (underlying.symbol) {
            ticker = underlying.symbol;
          }

          // Only add if it has exchange suffix (e.g., AAPL.US)
          if (ticker && ticker.includes('.')) {
            // Normalize exchange suffix for EOD API compatibility
            const normalized = normalizeExchangeForEOD(ticker);
            tickersSet.add(normalized);
          }
        });
      }

      // Extract from payoffStructure (for drag-and-drop products)
      if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
        product.payoffStructure.forEach(component => {
          if (component.type === 'underlying' && component.securityData?.ticker) {
            const ticker = component.securityData.ticker;
            if (ticker && ticker.includes('.')) {
              const normalized = normalizeExchangeForEOD(ticker);
              tickersSet.add(normalized);
            }
          }
        });
      }
    });

    const tickers = Array.from(tickersSet);
    console.log(`[MarketTicker] Found ${tickers.length} unique tickers to update`);
    console.log(`[MarketTicker] Tickers:`, tickers.join(', '));

    return tickers;

  } catch (error) {
    console.error('[MarketTicker] Error extracting tickers from products:', error);
    // On error, return at least base securities
    return BASE_SECURITIES;
  }
}

/**
 * Update market ticker prices
 * Fetches prices from EOD API and caches in database
 * @returns {Promise<object>} Results object with statistics
 */
export async function updateMarketTickerPrices() {
  const logId = await CronJobLogHelpers.startJob('marketTickerUpdate', 'cron');
  console.log('[MarketTicker] Price update started');

  try {
    // Get all tickers that need updating
    const tickers = await getAllTickersToUpdate();

    if (tickers.length === 0) {
      console.log('[MarketTicker] No tickers to update');
      await CronJobLogHelpers.completeJob(logId, {
        tickersProcessed: 0,
        message: 'No tickers found'
      });
      return { success: true, tickersProcessed: 0 };
    }

    console.log(`[MarketTicker] Fetching prices for ${tickers.length} tickers`);

    // Use existing TickerCacheHelpers to fetch and cache prices
    const results = await TickerCacheHelpers.refreshTickerPrices(tickers);

    // Update last update time
    lastUpdateTime = Date.now();

    // Log completion with statistics
    await CronJobLogHelpers.completeJob(logId, {
      tickersProcessed: tickers.length,
      tickersCached: results.cached,
      tickersFetched: results.fetched,
      tickersFailed: results.failed,
      totalPrices: results.prices.size
    });

    console.log(`[MarketTicker] Price update completed:`);
    console.log(`  - Total tickers: ${tickers.length}`);
    console.log(`  - Cached: ${results.cached}`);
    console.log(`  - Fetched: ${results.fetched}`);
    console.log(`  - Failed: ${results.failed}`);
    console.log(`  - Prices stored: ${results.prices.size}`);

    return {
      success: true,
      tickersProcessed: tickers.length,
      cached: results.cached,
      fetched: results.fetched,
      failed: results.failed
    };

  } catch (error) {
    console.error('[MarketTicker] Price update failed:', error);
    await CronJobLogHelpers.failJob(logId, error);
    throw error;
  }
}

/**
 * Conditional update - only runs if there's recent activity
 * @param {number} activityWindow - Activity window in minutes (default: 30)
 * @returns {Promise<object>} Results object or skip notification
 */
export async function conditionalUpdate(activityWindow = 30) {
  const hasActivity = await hasRecentActivity(activityWindow);

  if (hasActivity) {
    console.log(`[MarketTicker] Recent activity detected (within ${activityWindow} min) - updating prices`);
    return await updateMarketTickerPrices();
  } else {
    console.log(`[MarketTicker] No activity in last ${activityWindow} minutes - skipping update`);
    return {
      skipped: true,
      reason: `No user activity in last ${activityWindow} minutes`
    };
  }
}

/**
 * Get the timestamp of the last update
 * @returns {number|null} Timestamp in milliseconds, or null if never updated
 */
export function getLastUpdateTime() {
  return lastUpdateTime;
}

/**
 * Check if ticker data is stale
 * @param {number} thresholdMinutes - Staleness threshold in minutes (default: 15)
 * @returns {boolean} True if data is stale or never updated
 */
export function isDataStale(thresholdMinutes = 15) {
  if (!lastUpdateTime) {
    return true; // Never updated
  }

  const thresholdMs = thresholdMinutes * 60 * 1000;
  const age = Date.now() - lastUpdateTime;

  return age > thresholdMs;
}
