import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import cron from 'node-cron';
import { CronJobLogHelpers } from '/imports/api/cronJobLogs';
import { MarketDataHelpers } from '/imports/api/marketDataCache';
import { ProductsCollection } from '/imports/api/products';

/**
 * Cron Jobs Configuration
 *
 * Scheduled jobs for automated system maintenance:
 * 1. Market Data Refresh - Fetches latest market data for all products
 * 2. Product Re-evaluation - Re-evaluates all live (non-matured) products
 */

// Store job instances for tracking
let cronJobs = {
  marketDataRefresh: null,
  productRevaluation: null
};

// Store next run times for the dashboard
let scheduleInfo = {
  marketDataRefresh: {
    name: 'marketDataRefresh',
    schedule: '0 2 * * *', // 2:00 AM daily
    lastFinishedAt: null,
    nextScheduledRun: null
  },
  productRevaluation: {
    name: 'productRevaluation',
    schedule: '0 3 * * *', // 3:00 AM daily
    lastFinishedAt: null,
    nextScheduledRun: null
  }
};

/**
 * Calculate next scheduled run time based on cron expression
 */
function getNextRunTime(cronExpression) {
  const now = new Date();
  const [minute, hour] = cronExpression.split(' ');

  const next = new Date(now);
  next.setHours(parseInt(hour), parseInt(minute), 0, 0);

  // If time has passed today, schedule for tomorrow
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

/**
 * JOB 1: Market Data Refresh
 * Runs daily at 2:00 AM
 * Fetches latest market data for all product underlyings
 */
async function marketDataRefreshJob() {
  const logId = await CronJobLogHelpers.startJob('marketDataRefresh', 'cron');
  console.log('[CRON] Market Data Refresh started');

  try {
    // Get all unique tickers from products
    const products = await ProductsCollection.find({}, {
      fields: {
        underlyings: 1,
        payoffStructure: 1,
        structure: 1,
        baskets: 1,
        tradeDate: 1,
        valueDate: 1
      }
    }).fetchAsync();

    const uniqueTickers = new Set();
    const tickerDates = new Map();

    // Extract tickers from products
    products.forEach(product => {
      let productDate = null;
      if (product.tradeDate) {
        productDate = new Date(product.tradeDate);
      } else if (product.valueDate) {
        productDate = new Date(product.valueDate);
      }

      // Extract from underlyings
      if (product.underlyings && Array.isArray(product.underlyings)) {
        product.underlyings.forEach(underlying => {
          const ticker = underlying.fullTicker || underlying.ticker ||
            (underlying.securityData && underlying.securityData.ticker);
          if (ticker && ticker.includes('.')) {
            uniqueTickers.add(ticker);
            if (productDate) {
              const currentDate = tickerDates.get(ticker);
              if (!currentDate || productDate < currentDate) {
                tickerDates.set(ticker, productDate);
              }
            }
          }
        });
      }

      // Extract from payoffStructure
      if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
        product.payoffStructure.forEach(component => {
          if (component.type === 'underlying' && component.securityData) {
            const ticker = component.securityData.ticker;
            if (ticker) {
              uniqueTickers.add(ticker);
              if (productDate) {
                const currentDate = tickerDates.get(ticker);
                if (!currentDate || productDate < currentDate) {
                  tickerDates.set(ticker, productDate);
                }
              }
            }
          }
        });
      }
    });

    const tickersArray = Array.from(uniqueTickers);
    console.log(`[CRON] Found ${tickersArray.length} unique tickers to refresh`);

    // Refresh market data for each ticker
    let succeeded = 0;
    let failed = 0;
    let totalDataPoints = 0;
    const errors = [];

    for (const ticker of tickersArray) {
      try {
        const earliestDate = tickerDates.get(ticker);
        const fromDate = earliestDate
          ? new Date(earliestDate.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days before
          : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago

        const result = await MarketDataHelpers.fetchAndCacheHistoricalData(
          ticker,
          fromDate,
          new Date() // to today
        );

        succeeded++;
        totalDataPoints += result.cached || 0;
        console.log(`[CRON] ✓ ${ticker}: ${result.cached} data points`);
      } catch (error) {
        failed++;
        errors.push({ ticker, error: error.message });
        console.error(`[CRON] ✗ ${ticker}: ${error.message}`);
      }
    }

    // Update schedule info
    scheduleInfo.marketDataRefresh.lastFinishedAt = new Date();
    scheduleInfo.marketDataRefresh.nextScheduledRun = getNextRunTime(scheduleInfo.marketDataRefresh.schedule);

    // Log completion
    await CronJobLogHelpers.completeJob(logId, {
      tickersProcessed: tickersArray.length,
      tickersSucceeded: succeeded,
      tickersFailed: failed,
      dataPointsFetched: totalDataPoints,
      errors: errors.length > 0 ? errors : undefined
    });

    console.log(`[CRON] Market Data Refresh completed: ${succeeded}/${tickersArray.length} tickers`);
    return {
      success: true,
      tickersProcessed: tickersArray.length,
      succeeded,
      failed
    };

  } catch (error) {
    console.error('[CRON] Market Data Refresh failed:', error);
    await CronJobLogHelpers.failJob(logId, error);
    throw error;
  }
}

/**
 * JOB 2: Product Re-evaluation
 * Runs daily at 3:00 AM (after market data refresh)
 * Re-evaluates all live products with latest market data
 */
async function productRevaluationJob() {
  const logId = await CronJobLogHelpers.startJob('productRevaluation', 'cron');
  console.log('[CRON] Product Re-evaluation started');

  try {
    // Find all live products (not yet matured)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const liveProducts = await ProductsCollection.find({
      $or: [
        { maturityDate: { $exists: true, $gte: today } },
        { finalObservation: { $exists: true, $gte: today } },
        { maturity: { $exists: true, $gte: today } }
      ]
    }).fetchAsync();

    console.log(`[CRON] Found ${liveProducts.length} live products to re-evaluate`);

    let succeeded = 0;
    let failed = 0;
    const errors = [];
    const durations = [];

    for (const product of liveProducts) {
      const startTime = Date.now();
      try {
        // Generate report for product
        await Meteor.callAsync('templateReports.generate', product, 'system-cron');

        const duration = Date.now() - startTime;
        durations.push(duration);
        succeeded++;

        console.log(`[CRON] ✓ ${product.title} (${product._id}): ${duration}ms`);
      } catch (error) {
        const duration = Date.now() - startTime;
        failed++;
        errors.push({
          productId: product._id,
          title: product.title,
          error: error.message
        });
        console.error(`[CRON] ✗ ${product.title} (${product._id}): ${error.message}`);
      }
    }

    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    // Update schedule info
    scheduleInfo.productRevaluation.lastFinishedAt = new Date();
    scheduleInfo.productRevaluation.nextScheduledRun = getNextRunTime(scheduleInfo.productRevaluation.schedule);

    // Log completion
    await CronJobLogHelpers.completeJob(logId, {
      productsProcessed: liveProducts.length,
      productsSucceeded: succeeded,
      productsFailed: failed,
      avgDuration,
      errors: errors.length > 0 ? errors : undefined
    });

    console.log(`[CRON] Product Re-evaluation completed: ${succeeded}/${liveProducts.length} products`);
    return {
      success: true,
      productsProcessed: liveProducts.length,
      succeeded,
      failed,
      avgDuration
    };

  } catch (error) {
    console.error('[CRON] Product Re-evaluation failed:', error);
    await CronJobLogHelpers.failJob(logId, error);
    throw error;
  }
}

export function initializeCronJobs() {
  console.log('Initializing cron jobs...');

  // Calculate initial next run times
  scheduleInfo.marketDataRefresh.nextScheduledRun = getNextRunTime(scheduleInfo.marketDataRefresh.schedule);
  scheduleInfo.productRevaluation.nextScheduledRun = getNextRunTime(scheduleInfo.productRevaluation.schedule);

  // Schedule Market Data Refresh - Daily at 2:00 AM
  cronJobs.marketDataRefresh = cron.schedule('0 2 * * *', async () => {
    try {
      await marketDataRefreshJob();
    } catch (error) {
      console.error('[CRON] Market Data Refresh job error:', error);
    }
  }, {
    scheduled: true,
    timezone: "America/New_York" // Adjust to your timezone
  });

  console.log('✓ Market Data Refresh scheduled for 2:00 AM daily');

  // Schedule Product Re-evaluation - Daily at 3:00 AM
  cronJobs.productRevaluation = cron.schedule('0 3 * * *', async () => {
    try {
      await productRevaluationJob();
    } catch (error) {
      console.error('[CRON] Product Re-evaluation job error:', error);
    }
  }, {
    scheduled: true,
    timezone: "America/New_York" // Adjust to your timezone
  });

  console.log('✓ Product Re-evaluation scheduled for 3:00 AM daily');
  console.log('✓ Cron jobs initialized and started');
}

/**
 * Meteor methods for manual job triggering and schedule info
 */
if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Manually trigger market data refresh
     */
    async 'cronJobs.triggerMarketDataRefresh'(sessionId) {
      check(sessionId, String);

      // Authenticate user - only superadmin
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || currentUser.role !== 'superadmin') {
        throw new Meteor.Error('access-denied', 'Superadmin privileges required');
      }

      console.log(`[MANUAL] Market Data Refresh triggered by ${currentUser.email}`);

      try {
        const result = await marketDataRefreshJob();
        return { success: true, result };
      } catch (error) {
        throw new Meteor.Error('job-execution-failed', error.message);
      }
    },

    /**
     * Manually trigger product re-evaluation
     */
    async 'cronJobs.triggerProductRevaluation'(sessionId) {
      check(sessionId, String);

      // Authenticate user - only superadmin
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || currentUser.role !== 'superadmin') {
        throw new Meteor.Error('access-denied', 'Superadmin privileges required');
      }

      console.log(`[MANUAL] Product Re-evaluation triggered by ${currentUser.email}`);

      try {
        const result = await productRevaluationJob();
        return { success: true, result };
      } catch (error) {
        throw new Meteor.Error('job-execution-failed', error.message);
      }
    },

    /**
     * Get next scheduled run times for all jobs
     */
    async 'cronJobs.getSchedule'(sessionId) {
      check(sessionId, String);

      // Authenticate user
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
        throw new Meteor.Error('access-denied', 'Admin privileges required');
      }

      return [
        {
          name: scheduleInfo.marketDataRefresh.name,
          nextScheduledRun: scheduleInfo.marketDataRefresh.nextScheduledRun,
          lastFinishedAt: scheduleInfo.marketDataRefresh.lastFinishedAt
        },
        {
          name: scheduleInfo.productRevaluation.name,
          nextScheduledRun: scheduleInfo.productRevaluation.nextScheduledRun,
          lastFinishedAt: scheduleInfo.productRevaluation.lastFinishedAt
        }
      ];
    }
  });
}
