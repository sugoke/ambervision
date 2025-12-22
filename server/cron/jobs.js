import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import cron from 'node-cron';
import pLimit from 'p-limit';
import { CronJobLogHelpers, CronJobLogsCollection } from '/imports/api/cronJobLogs';
import { MarketDataHelpers } from '/imports/api/marketDataCache';
import { ProductsCollection } from '/imports/api/products';
import { BankConnectionsCollection } from '/imports/api/bankConnections';
import { conditionalUpdate, updateMarketTickerPrices } from './updateMarketTicker';

/**
 * Cron Jobs Configuration
 *
 * Scheduled jobs for automated system maintenance (Europe/Zurich timezone - CET/CEST):
 * 1. Market Data Refresh - Daily at 00:00 CET (midnight) - Skip weekends & holidays
 * 2. Product Re-evaluation - Daily at 00:30 CET (30 min after data refresh) - Skip weekends & holidays
 * 3. Market Ticker Update - Every 15 minutes (conditional on user activity) - Skip weekends & holidays
 */

/**
 * List of Swiss holidays and major market closure dates (YYYY-MM-DD format)
 * Update this list annually for new year's holidays
 */
const MARKET_HOLIDAYS = [
  // 2025 Swiss holidays
  '2025-01-01', // New Year's Day
  '2025-01-02', // New Year's Day observed
  '2025-04-18', // Good Friday
  '2025-04-21', // Easter Monday
  '2025-05-01', // Labour Day
  '2025-05-29', // Ascension Day
  '2025-06-09', // Whit Monday
  '2025-08-01', // Swiss National Day
  '2025-12-25', // Christmas Day
  '2025-12-26', // Boxing Day

  // 2026 Swiss holidays (add more as needed)
  '2026-01-01', // New Year's Day
  '2026-01-02', // New Year's Day observed
  '2026-04-03', // Good Friday
  '2026-04-06', // Easter Monday
  '2026-05-01', // Labour Day
  '2026-05-14', // Ascension Day
  '2026-05-25', // Whit Monday
  '2026-08-01', // Swiss National Day (Saturday)
  '2026-12-25', // Christmas Day
  '2026-12-26', // Boxing Day (Saturday)
];

/**
 * Check if current date is a weekend or holiday
 * Uses Europe/Zurich timezone to match cron job schedule
 * @returns {object} { isNonTradingDay: boolean, reason: string }
 */
function isWeekendOrHoliday() {
  // Get current date in Europe/Zurich timezone
  const now = new Date();
  const zurichDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
  const dayOfWeek = zurichDate.getDay(); // 0 = Sunday, 6 = Saturday

  // Check for weekend
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    const dayName = dayOfWeek === 0 ? 'Sunday' : 'Saturday';
    return {
      isNonTradingDay: true,
      reason: `Weekend (${dayName})`
    };
  }

  // Check for holiday (format date as YYYY-MM-DD in Zurich timezone)
  const year = zurichDate.getFullYear();
  const month = String(zurichDate.getMonth() + 1).padStart(2, '0');
  const day = String(zurichDate.getDate()).padStart(2, '0');
  const dateString = `${year}-${month}-${day}`;

  if (MARKET_HOLIDAYS.includes(dateString)) {
    return {
      isNonTradingDay: true,
      reason: `Market holiday (${dateString})`
    };
  }

  return { isNonTradingDay: false, reason: null };
}

// Store job instances for tracking
let cronJobs = {
  marketDataRefresh: null,
  productRevaluation: null,
  marketTickerUpdate: null,
  bankFileSync: null
};

// Store next run times for the dashboard
let scheduleInfo = {
  marketDataRefresh: {
    name: 'marketDataRefresh',
    schedule: '0 0 * * *', // Midnight CET daily
    lastFinishedAt: null,
    nextScheduledRun: null
  },
  productRevaluation: {
    name: 'productRevaluation',
    schedule: '30 0 * * *', // 00:30 CET daily (30 min after data refresh)
    lastFinishedAt: null,
    nextScheduledRun: null
  },
  marketTickerUpdate: {
    name: 'marketTickerUpdate',
    schedule: '*/15 * * * *', // Every 15 minutes (conditional on activity)
    lastFinishedAt: null,
    nextScheduledRun: null
  },
  bankFileSync: {
    name: 'bankFileSync',
    schedule: '30 7 * * *', // 07:30 CET daily (French time)
    lastFinishedAt: null,
    nextScheduledRun: null
  }
};

/**
 * Calculate next scheduled run time based on cron expression
 * Properly handles Europe/Zurich timezone
 */
function getNextRunTime(cronExpression) {
  // Get current time in Europe/Zurich timezone
  const nowUTC = new Date();
  const nowInZurich = new Date(nowUTC.toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));

  // Parse cron expression (format: "minute hour * * *")
  const parts = cronExpression.split(' ');
  const minute = parts[0];
  const hour = parts[1];

  // Handle special patterns like */15 (every 15 minutes)
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.substring(2));
    const currentMinute = nowInZurich.getMinutes();
    const nextMinute = Math.ceil((currentMinute + 1) / interval) * interval;

    const next = new Date(nowInZurich);
    if (nextMinute >= 60) {
      next.setHours(next.getHours() + 1);
      next.setMinutes(nextMinute - 60, 0, 0);
    } else {
      next.setMinutes(nextMinute, 0, 0);
    }

    // Convert back to UTC for display
    const zurichTimeStr = next.toLocaleString('en-US', { timeZone: 'Europe/Zurich' });
    return new Date(zurichTimeStr + ' GMT+0100'); // CET offset
  }

  // Handle fixed time patterns (e.g., "0 0 * * *" or "30 0 * * *")
  const targetHour = parseInt(hour);
  const targetMinute = parseInt(minute);

  const next = new Date(nowInZurich);
  next.setHours(targetHour, targetMinute, 0, 0);

  // If time has passed today in Zurich timezone, schedule for tomorrow
  if (next <= nowInZurich) {
    next.setDate(next.getDate() + 1);
  }

  // Convert the Zurich time back to a Date object that represents the correct moment
  // Get the time string in Zurich timezone
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, '0');
  const day = String(next.getDate()).padStart(2, '0');
  const hourStr = String(next.getHours()).padStart(2, '0');
  const minStr = String(next.getMinutes()).padStart(2, '0');

  // Create ISO string for Zurich time and parse it
  const zurichTimeStr = `${year}-${month}-${day}T${hourStr}:${minStr}:00`;

  // Get the UTC equivalent of this Zurich time
  const utcTime = new Date(new Date(zurichTimeStr + 'Z').getTime() - (60 * 60 * 1000)); // Subtract 1 hour for CET

  return utcTime;
}

/**
 * JOB 1: Market Data Refresh
 * Runs daily at 00:00 CET (midnight European time)
 * Fetches latest market data for all product underlyings
 * Skips execution on weekends and holidays
 */
async function marketDataRefreshJob() {
  // Check if today is a weekend or holiday
  const tradingDayCheck = isWeekendOrHoliday();
  if (tradingDayCheck.isNonTradingDay) {
    console.log(`[CRON] Market Data Refresh skipped: ${tradingDayCheck.reason}`);

    // Update next run time for dashboard
    scheduleInfo.marketDataRefresh.nextScheduledRun = getNextRunTime(scheduleInfo.marketDataRefresh.schedule);

    return {
      skipped: true,
      reason: tradingDayCheck.reason,
      message: 'Job skipped due to non-trading day'
    };
  }

  const logId = await CronJobLogHelpers.startJob('marketDataRefresh', 'cron');
  console.log('[CRON] Market Data Refresh started');

  try {
    // Call the existing marketData.refreshCache method (single source of truth)
    const result = await Meteor.callAsync('marketData.refreshCache', {}, 'system-cron');

    // Update schedule info
    scheduleInfo.marketDataRefresh.lastFinishedAt = new Date();
    scheduleInfo.marketDataRefresh.nextScheduledRun = getNextRunTime(scheduleInfo.marketDataRefresh.schedule);

    // Extract stats from the result
    const tickersProcessed = result.details?.length || 0;
    const tickersSucceeded = result.details?.filter(d => !d.error).length || 0;
    const tickersFailed = result.summary?.errors || 0;
    const dataPointsFetched = result.summary?.cached || 0;

    // Log completion with detailed stats
    await CronJobLogHelpers.completeJob(logId, {
      tickersProcessed,
      tickersSucceeded,
      tickersFailed,
      dataPointsFetched,
      errors: result.details?.filter(d => d.error).map(d => ({
        ticker: d.fullTicker,
        error: d.error
      }))
    });

    console.log(`[CRON] Market Data Refresh completed: ${tickersSucceeded}/${tickersProcessed} tickers`);
    return result;

  } catch (error) {
    console.error('[CRON] Market Data Refresh failed:', error);
    await CronJobLogHelpers.failJob(logId, error);
    throw error;
  }
}

/**
 * JOB 2: Product Re-evaluation
 * Runs daily at 00:30 CET (30 minutes after market data refresh)
 * Re-evaluates all live products with latest market data
 * Skips execution on weekends and holidays
 * Sends daily summary email with all notifications
 */
async function productRevaluationJob(options = {}) {
  const { bypassWeekendCheck = false } = options;

  // Check if today is a weekend or holiday (unless bypassed for manual triggers)
  if (!bypassWeekendCheck) {
    const tradingDayCheck = isWeekendOrHoliday();
    if (tradingDayCheck.isNonTradingDay) {
      console.log(`[CRON] Product Re-evaluation skipped: ${tradingDayCheck.reason}`);

      // Update next run time for dashboard
      scheduleInfo.productRevaluation.nextScheduledRun = getNextRunTime(scheduleInfo.productRevaluation.schedule);

      // Log the skipped execution so it appears in the dashboard
      const logId = await CronJobLogHelpers.startJob('productRevaluation', 'cron');
      await CronJobLogHelpers.completeJob(logId, {
        skipped: true,
        skipReason: tradingDayCheck.reason,
        productsProcessed: 0,
        productsSucceeded: 0,
        productsFailed: 0
      });

      return {
        skipped: true,
        reason: tradingDayCheck.reason,
        message: 'Job skipped due to non-trading day'
      };
    }
  }

  const logId = await CronJobLogHelpers.startJob('productRevaluation', bypassWeekendCheck ? 'manual' : 'cron');
  console.log('[CRON] Product Re-evaluation started');

  // Generate unique ID for this cron job run (for batching notifications)
  const cronJobRunId = `cron-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  console.log(`[CRON] Cron job run ID: ${cronJobRunId}`);

  try {
    // Find ALL products for re-evaluation
    // Price updates are needed for all products regardless of status
    // The product status is already stored in the product object
    const allProducts = await ProductsCollection.find({}).fetchAsync();

    console.log(`[CRON] Found ${allProducts.length} products to re-evaluate`);

    // Get failed tickers from most recent market data refresh
    let failedTickersSet = new Set();
    try {
      const recentMarketDataLog = await CronJobLogsCollection.findOneAsync(
        { jobName: 'marketDataRefresh', status: 'success' },
        { sort: { startTime: -1 } }
      );

      if (recentMarketDataLog?.details?.errors) {
        recentMarketDataLog.details.errors.forEach(err => {
          if (err.ticker) failedTickersSet.add(err.ticker);
        });
        if (failedTickersSet.size > 0) {
          console.log(`[CRON] Found ${failedTickersSet.size} failed tickers from market data refresh: ${Array.from(failedTickersSet).join(', ')}`);
        }
      }
    } catch (e) {
      console.warn('[CRON] Could not retrieve failed tickers from market data refresh:', e.message);
    }

    let succeeded = 0;
    let failed = 0;
    let productsWithStaleData = 0;
    const errors = [];
    const durations = [];

    // Configurable concurrency limit for parallel processing (default: 3)
    const CONCURRENCY_LIMIT = Meteor.settings.private?.PRODUCT_EVAL_CONCURRENCY || 3;
    const limit = pLimit(CONCURRENCY_LIMIT);

    console.log(`[CRON] Processing ${allProducts.length} products with concurrency: ${CONCURRENCY_LIMIT}`);

    await Promise.all(allProducts.map(product =>
      limit(async () => {
        const startTime = Date.now();
        try {
          // Generate report for product (with cronJobRunId for notification batching)
          await Meteor.callAsync('templateReports.generate', product, 'system-cron', cronJobRunId);

          const duration = Date.now() - startTime;
          durations.push(duration);
          succeeded++;

          // Check if product uses any failed tickers
          let hasStaleData = false;
          if (failedTickersSet.size > 0 && product.underlyings) {
            for (const underlying of product.underlyings) {
              const ticker = underlying.securityData?.ticker || underlying.ticker;
              if (ticker && failedTickersSet.has(ticker)) {
                hasStaleData = true;
                break;
              }
            }
          }

          if (hasStaleData) {
            productsWithStaleData++;
            console.log(`[CRON] ⚠ ${product.title} (${product._id}): ${duration}ms [STALE DATA - uses failed ticker]`);
          } else {
            console.log(`[CRON] ✓ ${product.title} (${product._id}): ${duration}ms`);
          }
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
      })
    ));

    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    // Send daily summary email with all notifications from this cron run
    console.log('[CRON] Collecting notifications for daily summary email...');
    const { NotificationService } = await import('/imports/api/notificationService.js');
    const { EmailService } = await import('/imports/api/emailService.js');
    const { NotificationHelpers } = await import('/imports/api/notifications.js');

    const notifications = await NotificationService.getNotificationsForCronRun(cronJobRunId);

    if (notifications.length > 0) {
      console.log(`[CRON] Found ${notifications.length} notifications to send`);

      // Check if daily digest is enabled in settings (disabled by default until email provider configured)
      const dailyDigestEnabled = Meteor.settings.private?.DAILY_DIGEST_ENABLED === true;
      const testEmail = Meteor.settings.private?.DAILY_DIGEST_TEST_EMAIL;

      if (!dailyDigestEnabled) {
        console.log('[CRON] Daily digest email is disabled in settings');
      } else {
        // Send daily summary email
        const recipientEmail = testEmail || 'noreply@example.com';

        if (testEmail) {
          console.log(`[CRON] Sending daily digest to test email: ${testEmail}`);
        } else {
          console.log('[CRON] No test email configured, sending to configured recipient');
        }

        const emailResult = await EmailService.sendDailySummaryEmail(notifications, recipientEmail);

        if (emailResult.success) {
          console.log(`[CRON] Daily summary email sent successfully to ${recipientEmail}`);

          // Mark all notifications as sent
          const { NotificationsCollection } = await import('/imports/api/notifications.js');
          const notificationIds = notifications.map(n => n._id);

          await NotificationsCollection.updateAsync(
            { _id: { $in: notificationIds } },
            {
              $set: {
                emailSentAt: new Date(),
                emailStatus: 'sent'
              }
            },
            { multi: true }
          );

          console.log(`[CRON] Marked ${notificationIds.length} notifications as sent`);
        } else {
          console.error(`[CRON] Failed to send daily summary email:`, emailResult.error);
        }
      }
    } else {
      console.log('[CRON] No notifications to send');
    }

    // Count products with processing issues after evaluation
    const productsWithErrors = await ProductsCollection.find({ hasProcessingErrors: true }).countAsync();
    const productsWithWarnings = await ProductsCollection.find({
      hasProcessingWarnings: true,
      hasProcessingErrors: { $ne: true }
    }).countAsync();

    if (productsWithErrors > 0 || productsWithWarnings > 0) {
      console.log(`[CRON] Processing issues summary: ${productsWithErrors} products with errors, ${productsWithWarnings} products with warnings only`);
    }
    if (productsWithStaleData > 0) {
      console.log(`[CRON] Stale data summary: ${productsWithStaleData} products evaluated with failed market data tickers`);
    }

    // Update schedule info
    scheduleInfo.productRevaluation.lastFinishedAt = new Date();
    scheduleInfo.productRevaluation.nextScheduledRun = getNextRunTime(scheduleInfo.productRevaluation.schedule);

    // Log completion
    await CronJobLogHelpers.completeJob(logId, {
      productsProcessed: allProducts.length,
      productsSucceeded: succeeded,
      productsFailed: failed,
      productsWithStaleData,
      productsWithErrors,
      productsWithWarnings,
      avgDuration,
      notificationsSent: notifications.length,
      errors: errors.length > 0 ? errors : undefined
    });

    console.log(`[CRON] Product Re-evaluation completed: ${succeeded}/${allProducts.length} products${productsWithStaleData > 0 ? ` (${productsWithStaleData} with stale data)` : ''}, ${notifications.length} notifications sent`);
    return {
      success: true,
      productsProcessed: allProducts.length,
      succeeded,
      failed,
      productsWithStaleData,
      productsWithErrors,
      productsWithWarnings,
      avgDuration,
      notificationsSent: notifications.length
    };

  } catch (error) {
    console.error('[CRON] Product Re-evaluation failed:', error);
    await CronJobLogHelpers.failJob(logId, error);
    throw error;
  }
}

/**
 * JOB 4: Bank File Sync & PMS Processing
 * Runs daily at 03:00 CET
 * For SFTP connections: Downloads bank files and processes for PMS
 * For Local connections: Skips download (files already uploaded by bank), processes directly
 * Skips execution on weekends and holidays
 */
async function bankFileSyncJob(triggerSource = 'cron') {
  // Check if today is a weekend or holiday
  const tradingDayCheck = isWeekendOrHoliday();
  if (tradingDayCheck.isNonTradingDay) {
    console.log(`[CRON] Bank File Sync skipped: ${tradingDayCheck.reason}`);
    scheduleInfo.bankFileSync.nextScheduledRun = getNextRunTime(scheduleInfo.bankFileSync.schedule);
    return { skipped: true, reason: tradingDayCheck.reason };
  }

  const logId = await CronJobLogHelpers.startJob('bankFileSync', triggerSource);
  console.log(`[CRON] Bank File Sync started (triggered by: ${triggerSource})`);

  try {
    // Get all active bank connections (sorted by creation date to ensure consistent processing order)
    const connections = await BankConnectionsCollection.find({
      isActive: true
    }, { sort: { createdAt: 1 } }).fetchAsync();

    console.log(`[CRON] Found ${connections.length} active bank connections`);

    const results = {
      triggerSource,
      connectionsProcessed: 0,
      connectionsSucceeded: 0,
      connectionsFailed: 0,
      filesDownloaded: 0,
      positionsProcessed: 0,
      operationsProcessed: 0,
      errors: [],
      fileDetails: []  // Per-connection file details with filenames
    };

    // Process each connection
    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      console.log(`[CRON] Processing ${i + 1}/${connections.length}: ${connection.connectionName}`);
      results.connectionsProcessed++;

      // Track file details for this connection
      const connectionFileDetails = {
        connectionId: connection._id,
        connectionName: connection.connectionName,
        connectionType: connection.connectionType,
        downloadedFiles: [],
        skippedFiles: [],
        failedFiles: [],
        positionsFile: null,
        positionsProcessed: 0,
        operationsFile: null,
        operationsProcessed: 0,
        success: false,
        error: null
      };

      try {
        // Step 1: Download files (SFTP only, skip for local connections)
        if (connection.connectionType !== 'local') {
          const downloadResult = await Meteor.callAsync(
            'bankConnections.downloadAllFiles',
            { connectionId: connection._id, sessionId: 'system-cron' }
          );

          if (downloadResult.success) {
            results.filesDownloaded += downloadResult.newFiles?.length || 0;
            connectionFileDetails.downloadedFiles = downloadResult.newFiles || [];
            connectionFileDetails.skippedFiles = downloadResult.skippedFiles || [];
            connectionFileDetails.failedFiles = downloadResult.failedFiles || [];
            console.log(`[CRON] Downloaded ${downloadResult.newFiles?.length || 0} new files for ${connection.connectionName}: ${(downloadResult.newFiles || []).join(', ') || 'none'}`);
          }
        } else {
          console.log(`[CRON] Skipping download for local connection: ${connection.connectionName} (files already in bankfiles/${connection.localFolderName})`);
        }

        // Step 2: Process ALL missing dates FIRST in chronological order
        // This ensures historical dates are processed before today's date
        const { missingDates } = await Meteor.callAsync('bankPositions.getMissingDates', {
          connectionId: connection._id,
          sessionId: 'system-cron'
        });

        if (missingDates.length > 0) {
          console.log(`[CRON] Processing ${missingDates.length} unprocessed dates for ${connection.connectionName} in chronological order...`);

          // Process ALL missing dates with no limit - chronological order (oldest first)
          const catchupResult = await Meteor.callAsync('bankPositions.processMissingDates', {
            connectionId: connection._id,
            sessionId: 'system-cron',
            maxDates: 999  // No practical limit - process all
          });

          console.log(`[CRON] Processed ${catchupResult.processedCount} historical dates for ${connection.connectionName}`);

          // Track catch-up results
          if (!results.catchupDetails) results.catchupDetails = [];
          results.catchupDetails.push({
            connectionId: connection._id,
            connectionName: connection.connectionName,
            processed: catchupResult.processedCount,
            failed: catchupResult.failedCount
          });
        }

        // Step 3: Process latest files (positions + operations)
        // This will be a quick check - if today is already processed, it will just verify
        // Note: bankPositions.processLatest handles BOTH positions and operations
        const processResult = await Meteor.callAsync(
          'bankPositions.processLatest',
          { connectionId: connection._id, sessionId: 'system-cron' }
        );

        if (processResult.success) {
          const posCount = processResult.positions?.newRecords || 0;
          const opCount = processResult.operations?.newRecords || 0;
          results.positionsProcessed += posCount;
          results.operationsProcessed += opCount;
          results.connectionsSucceeded++;

          connectionFileDetails.positionsFile = processResult.positions?.filename || null;
          connectionFileDetails.positionsProcessed = posCount;
          connectionFileDetails.operationsFile = processResult.operations?.filename || null;
          connectionFileDetails.operationsProcessed = opCount;
          connectionFileDetails.success = true;

          console.log(`[CRON] ✓ ${connection.connectionName}: ${posCount} positions from ${processResult.positions?.filename || 'unknown'}, ${opCount} operations`);
        }

        // Step 4: Regenerate any missing portfolio snapshots
        // This repairs gaps in the performance chart where PMSHoldings exists but no snapshot was created
        try {
          const snapshotResult = await Meteor.callAsync('bankPositions.regenerateMissingSnapshots', {
            connectionId: connection._id,
            sessionId: 'system-cron',
            maxDates: 999  // No practical limit - regenerate all missing
          });

          if (snapshotResult.regenerated > 0) {
            console.log(`[CRON] Regenerated ${snapshotResult.regenerated} missing snapshots for ${connection.connectionName}`);
          }
        } catch (snapshotError) {
          // Don't fail the whole job if snapshot regeneration fails
          console.error(`[CRON] Snapshot regeneration error for ${connection.connectionName}: ${snapshotError.message}`);
        }

      } catch (error) {
        results.connectionsFailed++;
        connectionFileDetails.error = error.message;
        results.errors.push({
          connectionId: connection._id,
          connectionName: connection.connectionName,
          error: error.message
        });
        console.error(`[CRON] ✗ ${connection.connectionName}: ${error.message}`);
        // Continue with next connection (don't throw)
      }

      // Add this connection's file details to results
      results.fileDetails.push(connectionFileDetails);
    }

    // Note: Catch-up logic is now integrated into the per-connection processing loop above
    // Missing dates are processed BEFORE the latest file to ensure chronological order
    if (results.catchupDetails && results.catchupDetails.length > 0) {
      const totalCatchup = results.catchupDetails.reduce((sum, d) => sum + (d.processed || 0), 0);
      console.log(`[CRON] Historical dates processed: ${totalCatchup} across ${results.catchupDetails.length} connections`);
    }

    // Update schedule info
    scheduleInfo.bankFileSync.lastFinishedAt = new Date();
    scheduleInfo.bankFileSync.nextScheduledRun = getNextRunTime(scheduleInfo.bankFileSync.schedule);

    // Log completion
    await CronJobLogHelpers.completeJob(logId, results);
    console.log(`[CRON] Bank File Sync completed: ${results.connectionsSucceeded}/${results.connectionsProcessed} connections`);

    return { success: true, ...results };

  } catch (error) {
    console.error('[CRON] Bank File Sync failed:', error);
    await CronJobLogHelpers.failJob(logId, error);
    throw error;
  }
}

export function initializeCronJobs() {
  console.log('Initializing cron jobs...');

  // Calculate initial next run times
  scheduleInfo.marketDataRefresh.nextScheduledRun = getNextRunTime(scheduleInfo.marketDataRefresh.schedule);
  scheduleInfo.productRevaluation.nextScheduledRun = getNextRunTime(scheduleInfo.productRevaluation.schedule);
  scheduleInfo.marketTickerUpdate.nextScheduledRun = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
  scheduleInfo.bankFileSync.nextScheduledRun = getNextRunTime(scheduleInfo.bankFileSync.schedule);

  // Schedule Market Data Refresh - Daily at midnight CET
  cronJobs.marketDataRefresh = cron.schedule('0 0 * * *', Meteor.bindEnvironment(async () => {
    try {
      await marketDataRefreshJob();
    } catch (error) {
      console.error('[CRON] Market Data Refresh job error:', error);
    }
  }), {
    scheduled: true,
    timezone: "Europe/Zurich" // Central European Time (CET/CEST)
  });

  console.log('✓ Market Data Refresh scheduled for midnight (00:00 CET) daily');

  // Schedule Product Re-evaluation - Daily at 00:30 CET (after data refresh)
  cronJobs.productRevaluation = cron.schedule('30 0 * * *', Meteor.bindEnvironment(async () => {
    try {
      await productRevaluationJob();
    } catch (error) {
      console.error('[CRON] Product Re-evaluation job error:', error);
    }
  }), {
    scheduled: true,
    timezone: "Europe/Zurich" // Central European Time (CET/CEST)
  });

  console.log('✓ Product Re-evaluation scheduled for 00:30 CET daily (30 min after data refresh)');

  // Schedule Market Ticker Update - Every 15 minutes (conditional on activity)
  cronJobs.marketTickerUpdate = cron.schedule('*/15 * * * *', Meteor.bindEnvironment(async () => {
    try {
      // Check if today is a weekend or holiday
      const tradingDayCheck = isWeekendOrHoliday();
      if (tradingDayCheck.isNonTradingDay) {
        // Skip silently without logging every 15 minutes
        scheduleInfo.marketTickerUpdate.nextScheduledRun = new Date(Date.now() + 15 * 60 * 1000);
        return;
      }

      const result = await conditionalUpdate(30); // Check for activity in last 30 minutes

      if (!result.skipped) {
        scheduleInfo.marketTickerUpdate.lastFinishedAt = new Date();
      }

      scheduleInfo.marketTickerUpdate.nextScheduledRun = new Date(Date.now() + 15 * 60 * 1000);
    } catch (error) {
      console.error('[CRON] Market Ticker Update job error:', error);
    }
  }), {
    scheduled: true,
    timezone: "Europe/Zurich" // Central European Time (CET/CEST)
  });

  console.log('✓ Market Ticker Update scheduled every 15 minutes (conditional on activity)');

  // Schedule Bank File Sync - Daily at 07:30 CET (French time)
  cronJobs.bankFileSync = cron.schedule('30 7 * * *', Meteor.bindEnvironment(async () => {
    console.log('[CRON] ========================================');
    console.log('[CRON] Bank File Sync CRON trigger fired at:', new Date().toISOString());
    console.log('[CRON] ========================================');
    try {
      await bankFileSyncJob();
    } catch (error) {
      console.error('[CRON] Bank File Sync job error:', error);
    }
  }), {
    scheduled: true,
    timezone: "Europe/Zurich"
  });

  console.log('✓ Bank File Sync scheduled for 07:30 CET daily (French time)');

  console.log('✓ Cron jobs initialized and started');
  console.log('✓ All jobs configured for Europe/Zurich timezone (CET/CEST)');
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
        // Bypass weekend check for manual triggers - superadmin explicitly wants to run it
        const result = await productRevaluationJob({ bypassWeekendCheck: true });
        return { success: true, result };
      } catch (error) {
        throw new Meteor.Error('job-execution-failed', error.message);
      }
    },

    /**
     * Manually trigger market ticker update
     */
    async 'cronJobs.triggerMarketTickerUpdate'(sessionId) {
      check(sessionId, String);

      // Authenticate user - only superadmin
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || currentUser.role !== 'superadmin') {
        throw new Meteor.Error('access-denied', 'Superadmin privileges required');
      }

      console.log(`[MANUAL] Market Ticker Update triggered by ${currentUser.email}`);

      try {
        const result = await updateMarketTickerPrices();
        scheduleInfo.marketTickerUpdate.lastFinishedAt = new Date();
        return { success: true, result };
      } catch (error) {
        throw new Meteor.Error('job-execution-failed', error.message);
      }
    },

    /**
     * Manually trigger bank file sync
     */
    async 'cronJobs.triggerBankFileSync'(sessionId) {
      check(sessionId, String);

      // Authenticate user - only superadmin
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || currentUser.role !== 'superadmin') {
        throw new Meteor.Error('access-denied', 'Superadmin privileges required');
      }

      console.log(`[MANUAL] Bank File Sync triggered by ${currentUser.email}`);

      try {
        const result = await bankFileSyncJob('manual');
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
        },
        {
          name: scheduleInfo.marketTickerUpdate.name,
          nextScheduledRun: scheduleInfo.marketTickerUpdate.nextScheduledRun,
          lastFinishedAt: scheduleInfo.marketTickerUpdate.lastFinishedAt
        },
        {
          name: scheduleInfo.bankFileSync.name,
          nextScheduledRun: scheduleInfo.bankFileSync.nextScheduledRun,
          lastFinishedAt: scheduleInfo.bankFileSync.lastFinishedAt
        }
      ];
    }
  });
}
