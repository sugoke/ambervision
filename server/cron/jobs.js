import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import cron from 'node-cron';
import pLimit from 'p-limit';
import { CronJobLogHelpers, CronJobLogsCollection } from '/imports/api/cronJobLogs';
import { MarketDataHelpers } from '/imports/api/marketDataCache';
import { ProductsCollection } from '/imports/api/products';
import { BankConnectionsCollection } from '/imports/api/bankConnections';
import { conditionalUpdate, updateMarketTickerPrices } from './updateMarketTicker';
import { EmailService } from '/imports/api/emailService';
import { NotificationsCollection } from '/imports/api/notifications';
import { checkDataFreshness, formatDataDate } from '/imports/api/helpers/dataFreshness.js';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings.js';
import { PortfolioSnapshotsCollection, PortfolioSnapshotHelpers } from '/imports/api/portfolioSnapshots.js';
import { PMSOperationsCollection } from '/imports/api/pmsOperations.js';
import { BanksCollection } from '/imports/api/banks.js';
import { UsersCollection, USER_ROLES } from '/imports/api/users.js';
import { DashboardMetricsHelpers } from '/imports/api/dashboardMetrics.js';
import { yieldToEventLoop } from '/imports/utils/asyncHelpers.js';

/**
 * Cron Jobs Configuration
 *
 * Scheduled jobs for automated system maintenance (Europe/Zurich timezone - CET/CEST):
 * 1. Market Data Refresh - Daily at 00:00 CET (midnight) - Skip weekends & holidays
 * 2. Product Re-evaluation - Daily at 00:30 CET (30 min after data refresh) - Skip weekends & holidays
 * 3. Market Ticker Update - Every 15 minutes (conditional on user activity) - Skip weekends & holidays
 * 4. Bank File Sync - Daily at 07:30 CET Mon-Fri (all banks) - Skip weekends
 * 5. CMB File Sync - Daily at 09:00 CET Mon-Fri (CMB only - uploads files later than other banks) - Skip weekends
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
  bankFileSync: null,
  cmbFileSync: null  // CMB-specific sync (runs later due to late file uploads)
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
    schedule: '30 7 * * 1-5', // 07:30 CET Mon-Fri (skip weekends)
    lastFinishedAt: null,
    nextScheduledRun: null
  },
  cmbFileSync: {
    name: 'cmbFileSync',
    schedule: '0 9 * * 1-5', // 09:00 CET Mon-Fri (skip weekends, CMB uploads files later than other banks)
    lastFinishedAt: null,
    nextScheduledRun: null
  }
};

/**
 * Initialize lastFinishedAt from database logs
 * This ensures dashboard shows correct "Last Run" even after server restart
 */
async function initializeScheduleInfoFromLogs() {
  const jobNames = Object.keys(scheduleInfo);

  for (const jobName of jobNames) {
    // Find the most recent completed log for this job (success or error)
    const lastLog = await CronJobLogsCollection.findOneAsync(
      { jobName, status: { $in: ['success', 'error'] } },
      { sort: { endTime: -1 } }
    );

    if (lastLog && lastLog.endTime) {
      scheduleInfo[jobName].lastFinishedAt = lastLog.endTime;
      console.log(`[CRON] Restored lastFinishedAt for ${jobName}: ${lastLog.endTime.toISOString()}`);
    }
  }
}

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
 * Create consolidated holdings for all users
 * Merges holdings with same ISIN across all accounts for each user
 * Stored with portfolioCode='CONSOLIDATED' for easy filtering in UI
 */
async function createConsolidatedHoldings() {
  console.log('[CRON] Creating consolidated holdings...');

  try {
    // Get all unique userIds that have latest holdings (excluding existing CONSOLIDATED)
    const usersWithHoldings = await PMSHoldingsCollection.rawCollection().distinct('userId', {
      isLatest: true,
      portfolioCode: { $ne: 'CONSOLIDATED' }
    });

    console.log(`[CRON] Found ${usersWithHoldings.length} users with holdings to consolidate`);

    let totalConsolidated = 0;

    for (let i = 0; i < usersWithHoldings.length; i++) {
      await yieldToEventLoop(i, 5);
      const userId = usersWithHoldings[i];
      if (!userId) continue;

      // Get all latest holdings for this user (excluding CONSOLIDATED)
      const holdings = await PMSHoldingsCollection.find({
        userId,
        isLatest: true,
        portfolioCode: { $ne: 'CONSOLIDATED' }
      }).fetchAsync();

      if (holdings.length === 0) continue;

      // Find the most recent snapshotDate among all holdings
      const latestSnapshotDate = holdings.reduce((latest, h) => {
        if (!latest || (h.snapshotDate && h.snapshotDate > latest)) {
          return h.snapshotDate;
        }
        return latest;
      }, null);

      // Group by ISIN/ticker (merge same securities across accounts)
      const consolidated = {};

      holdings.forEach(pos => {
        // Key by ISIN if available, otherwise ticker, otherwise securityName
        const key = pos.isin || pos.ticker || pos.securityName;
        if (!key) return; // Skip positions without identifier

        if (!consolidated[key]) {
          // First occurrence - clone the position as base
          consolidated[key] = {
            ...pos,
            _id: undefined, // Will be generated on insert
            portfolioCode: 'CONSOLIDATED',
            accountNumber: 'CONSOLIDATED',
            originalPortfolioCode: 'CONSOLIDATED',
            quantity: 0,
            marketValue: 0,
            marketValueOriginalCurrency: 0,
            bookValue: 0,
            costBasisOriginalCurrency: 0,
            costBasisPortfolioCurrency: 0,
            unrealizedPnL: 0,
            sourceAccounts: [],
            snapshotDate: latestSnapshotDate,
            processedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }

        // Accumulate values
        consolidated[key].quantity += pos.quantity || 0;
        consolidated[key].marketValue += pos.marketValue || 0;
        consolidated[key].marketValueOriginalCurrency += pos.marketValueOriginalCurrency || 0;
        consolidated[key].bookValue += pos.bookValue || 0;
        consolidated[key].costBasisOriginalCurrency += pos.costBasisOriginalCurrency || 0;
        consolidated[key].costBasisPortfolioCurrency += pos.costBasisPortfolioCurrency || 0;
        consolidated[key].unrealizedPnL += pos.unrealizedPnL || 0;
        consolidated[key].sourceAccounts.push(pos.portfolioCode);
      });

      // Calculate unrealizedPnLPercent for consolidated positions
      Object.values(consolidated).forEach(pos => {
        if (pos.costBasisPortfolioCurrency && pos.costBasisPortfolioCurrency !== 0) {
          pos.unrealizedPnLPercent = ((pos.marketValue - pos.costBasisPortfolioCurrency) / Math.abs(pos.costBasisPortfolioCurrency)) * 100;
        } else {
          pos.unrealizedPnLPercent = 0;
        }
      });

      // Mark existing CONSOLIDATED holdings as not latest
      await PMSHoldingsCollection.updateAsync(
        { userId, portfolioCode: 'CONSOLIDATED', isLatest: true },
        { $set: { isLatest: false, replacedAt: new Date() } },
        { multi: true }
      );

      // Insert new consolidated holdings via bulkWrite for efficiency
      const consolidatedPositions = Object.values(consolidated);
      if (consolidatedPositions.length > 0) {
        const bulkOps = consolidatedPositions.map(pos => {
          pos.uniqueKey = `CONSOLIDATED_${userId}_${pos.isin || pos.ticker || pos.securityName}`;
          return { insertOne: { document: pos } };
        });
        await PMSHoldingsCollection.rawCollection().bulkWrite(bulkOps, { ordered: false });
      }

      totalConsolidated += consolidatedPositions.length;
    }

    console.log(`[CRON] Created ${totalConsolidated} consolidated holdings for ${usersWithHoldings.length} users`);
    return { success: true, usersProcessed: usersWithHoldings.length, holdingsCreated: totalConsolidated };

  } catch (error) {
    console.error('[CRON] Error creating consolidated holdings:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * JOB 4: Bank File Sync & PMS Processing
 * Runs daily at 07:30 CET
 * For SFTP connections: Downloads bank files and processes for PMS
 * For Local connections: Skips download (files already uploaded by bank), processes directly
 */
async function bankFileSyncJob(triggerSource = 'cron', options = {}) {
  const { forceReprocess = false } = options;

  // Note: No weekend check - bank files may arrive any day

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
      connectionsSucceeded: 0,  // Now only counts fresh data
      connectionsFailed: 0,
      connectionsWithStaleData: 0,  // Processed successfully but data is stale
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
        error: null,
        freshness: null  // Will be populated after processing
      };

      try {
        // Step 1: Check for new files (downloads for SFTP, detects unprocessed for local)
        const downloadResult = await Meteor.callAsync(
          'bankConnections.downloadAllFiles',
          { connectionId: connection._id, sessionId: 'system-cron' }
        );

        if (downloadResult.success) {
          results.filesDownloaded += downloadResult.newFiles?.length || 0;
          connectionFileDetails.downloadedFiles = downloadResult.newFiles || [];
          connectionFileDetails.skippedFiles = downloadResult.skippedFiles || [];
          connectionFileDetails.failedFiles = downloadResult.failedFiles || [];
          const action = connection.connectionType === 'local' ? 'Detected' : 'Downloaded';
          console.log(`[CRON] ${action} ${downloadResult.newFiles?.length || 0} new files for ${connection.connectionName}: ${(downloadResult.newFiles || []).join(', ') || 'none'}`);
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
          { connectionId: connection._id, sessionId: 'system-cron', forceReprocess }
        );

        if (processResult.success) {
          const posCount = processResult.positions?.newRecords || 0;
          const opCount = processResult.operations?.newRecords || 0;
          results.positionsProcessed += posCount;
          results.operationsProcessed += opCount;

          connectionFileDetails.positionsFile = processResult.positions?.filename || null;
          connectionFileDetails.positionsProcessed = posCount;
          connectionFileDetails.operationsFile = processResult.operations?.filename || null;
          connectionFileDetails.operationsProcessed = opCount;
          connectionFileDetails.success = true;

          // Check data freshness for this connection
          // Note: connection.bankId is the BanksCollection._id, not connection._id
          const latestHolding = await PMSHoldingsCollection.findOneAsync(
            { bankId: connection.bankId, isLatest: true },
            { sort: { snapshotDate: -1 }, fields: { snapshotDate: 1, fileDate: 1 } }
          );

          const dataDate = latestHolding?.snapshotDate || latestHolding?.fileDate;
          const freshnessResult = checkDataFreshness(dataDate);

          connectionFileDetails.freshness = {
            status: freshnessResult.status,
            dataDate: dataDate,
            formattedDate: formatDataDate(dataDate),
            businessDaysOld: freshnessResult.businessDaysOld,
            message: freshnessResult.message
          };

          // Only count as succeeded if data is fresh
          if (freshnessResult.status === 'fresh') {
            results.connectionsSucceeded++;
            console.log(`[CRON] ✓ ${connection.connectionName}: ${posCount} positions, data is fresh (${formatDataDate(dataDate)})`);
          } else {
            results.connectionsWithStaleData++;
            console.log(`[CRON] ⚠ ${connection.connectionName}: ${posCount} positions, but data is ${freshnessResult.message} (${formatDataDate(dataDate)})`);
          }
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
    const staleWarning = results.connectionsWithStaleData > 0 ? ` (${results.connectionsWithStaleData} with stale data)` : '';
    console.log(`[CRON] Bank File Sync completed: ${results.connectionsSucceeded}/${results.connectionsProcessed} fresh${staleWarning}`);

    // Create consolidated holdings for all users (merge same securities across accounts)
    try {
      const consolidationResult = await createConsolidatedHoldings();
      results.consolidation = consolidationResult;
    } catch (consolidationError) {
      console.error('[CRON] Consolidation error:', consolidationError.message);
      results.consolidation = { success: false, error: consolidationError.message };
    }

    // Regenerate today's snapshots after all connections processed
    // This ensures snapshots reflect all banks that synced in this batch
    try {
      const snapshotResult = await regenerateTodaySnapshots();
      results.snapshotRegeneration = snapshotResult;
    } catch (snapshotError) {
      console.error('[CRON] Failed to regenerate today snapshots:', snapshotError.message);
      results.snapshotRegeneration = { success: false, error: snapshotError.message };
    }

    // Send bank sync completion email with notifications
    try {
      // Collect notifications generated during this sync (within the last 10 minutes)
      const syncStartTime = new Date(Date.now() - 10 * 60 * 1000);
      const syncNotifications = await NotificationsCollection.find({
        createdAt: { $gte: syncStartTime },
        eventType: { $in: ['unauthorized_overdraft', 'allocation_breach', 'unknown_structured_product', 'auto_allocation_created', 'price_override'] }
      }).fetchAsync();

      await EmailService.sendBankSyncCompletionEmail(
        'mf@amberlakepartners.com',
        results,
        syncNotifications
      );
      console.log(`[CRON] Bank sync completion email sent with ${syncNotifications.length} notifications`);
    } catch (emailError) {
      // Don't fail the job if email fails, just log the error
      console.error('[CRON] Failed to send bank sync completion email:', emailError.message);
    }

    return { success: true, ...results };

  } catch (error) {
    console.error('[CRON] Bank File Sync failed:', error);
    await CronJobLogHelpers.failJob(logId, error);
    throw error;
  }
}

/**
 * CMB-specific Bank File Sync Job
 *
 * CMB Monaco uploads their files later than other banks (typically after 08:00 CET).
 * This job runs at 09:00 CET to catch CMB files that weren't available during the main sync.
 * Only processes the CMB connection, skips all others.
 */
async function cmbFileSyncJob(triggerSource = 'cron') {
  const logId = await CronJobLogHelpers.startJob('cmbFileSync', triggerSource);
  console.log(`[CRON] CMB File Sync started (triggered by: ${triggerSource})`);

  try {
    // Find the active CMB connection
    const cmbConnection = await BankConnectionsCollection.findOneAsync({
      connectionName: 'CMB',
      isActive: true
    });

    if (!cmbConnection) {
      console.log('[CRON] CMB File Sync: No active CMB connection found, skipping');
      await CronJobLogHelpers.completeJob(logId, { skipped: true, reason: 'No active CMB connection' });
      return { success: true, skipped: true };
    }

    const results = {
      triggerSource,
      connectionsProcessed: 1,
      connectionsSucceeded: 0,  // Now only counts fresh data
      connectionsFailed: 0,
      connectionsWithStaleData: 0,  // Processed successfully but data is stale
      filesDownloaded: 0,
      positionsProcessed: 0,
      operationsProcessed: 0,
      errors: [],
      fileDetails: []
    };

    const connectionFileDetails = {
      connectionId: cmbConnection._id,
      connectionName: cmbConnection.connectionName,
      connectionType: cmbConnection.connectionType,
      downloadedFiles: [],
      skippedFiles: [],
      failedFiles: [],
      positionsFile: null,
      positionsProcessed: 0,
      operationsFile: null,
      operationsProcessed: 0,
      success: false,
      error: null,
      freshness: null  // Will be populated after processing
    };

    try {
      // Step 1: Download files from CMB SFTP
      const downloadResult = await Meteor.callAsync(
        'bankConnections.downloadAllFiles',
        { connectionId: cmbConnection._id, sessionId: 'system-cron' }
      );

      if (downloadResult.success) {
        results.filesDownloaded += downloadResult.newFiles?.length || 0;
        connectionFileDetails.downloadedFiles = downloadResult.newFiles || [];
        connectionFileDetails.skippedFiles = downloadResult.skippedFiles || [];
        connectionFileDetails.failedFiles = downloadResult.failedFiles || [];
        console.log(`[CRON-CMB] Downloaded ${downloadResult.newFiles?.length || 0} new files: ${(downloadResult.newFiles || []).join(', ') || 'none'}`);
      }

      // Step 2: Process any missing dates
      const { missingDates } = await Meteor.callAsync('bankPositions.getMissingDates', {
        connectionId: cmbConnection._id,
        sessionId: 'system-cron'
      });

      if (missingDates.length > 0) {
        console.log(`[CRON-CMB] Processing ${missingDates.length} unprocessed dates...`);
        await Meteor.callAsync('bankPositions.processMissingDates', {
          connectionId: cmbConnection._id,
          sessionId: 'system-cron',
          maxDates: 999
        });
      }

      // Step 3: Process latest files
      const processResult = await Meteor.callAsync(
        'bankPositions.processLatest',
        { connectionId: cmbConnection._id, sessionId: 'system-cron' }
      );

      if (processResult.success) {
        const posCount = processResult.positions?.newRecords || 0;
        const opCount = processResult.operations?.newRecords || 0;
        results.positionsProcessed += posCount;
        results.operationsProcessed += opCount;

        connectionFileDetails.positionsFile = processResult.positions?.filename || null;
        connectionFileDetails.positionsProcessed = posCount;
        connectionFileDetails.operationsFile = processResult.operations?.filename || null;
        connectionFileDetails.operationsProcessed = opCount;
        connectionFileDetails.success = true;

        // Check data freshness for CMB connection
        // Note: cmbConnection.bankId is the BanksCollection._id, not cmbConnection._id
        const latestHolding = await PMSHoldingsCollection.findOneAsync(
          { bankId: cmbConnection.bankId, isLatest: true },
          { sort: { snapshotDate: -1 }, fields: { snapshotDate: 1, fileDate: 1 } }
        );

        const dataDate = latestHolding?.snapshotDate || latestHolding?.fileDate;
        const freshnessResult = checkDataFreshness(dataDate);

        connectionFileDetails.freshness = {
          status: freshnessResult.status,
          dataDate: dataDate,
          formattedDate: formatDataDate(dataDate),
          businessDaysOld: freshnessResult.businessDaysOld,
          message: freshnessResult.message
        };

        // Only count as succeeded if data is fresh
        if (freshnessResult.status === 'fresh') {
          results.connectionsSucceeded++;
          console.log(`[CRON-CMB] ✓ CMB: ${posCount} positions, data is fresh (${formatDataDate(dataDate)})`);
        } else {
          results.connectionsWithStaleData++;
          console.log(`[CRON-CMB] ⚠ CMB: ${posCount} positions, but data is ${freshnessResult.message} (${formatDataDate(dataDate)})`);
        }
      }

    } catch (error) {
      results.connectionsFailed++;
      connectionFileDetails.error = error.message;
      results.errors.push({
        connectionId: cmbConnection._id,
        connectionName: 'CMB',
        error: error.message
      });
      console.error(`[CRON-CMB] ✗ CMB: ${error.message}`);
    }

    results.fileDetails.push(connectionFileDetails);

    // Add freshness status for all OTHER active connections (so email shows complete picture)
    try {
      const allConnections = await BankConnectionsCollection.find({ isActive: true }).fetchAsync();

      for (const conn of allConnections) {
        // Skip CMB - already in results
        if (conn._id === cmbConnection._id) continue;

        // Get latest holding date for this connection
        const latestHolding = await PMSHoldingsCollection.findOneAsync(
          { bankId: conn.bankId, isLatest: true },
          { sort: { snapshotDate: -1 }, fields: { snapshotDate: 1, fileDate: 1 } }
        );

        const dataDate = latestHolding?.snapshotDate || latestHolding?.fileDate;
        const freshnessResult = checkDataFreshness(dataDate);

        // Add to fileDetails with no files processed (just freshness info)
        results.fileDetails.push({
          connectionId: conn._id,
          connectionName: conn.connectionName,
          connectionType: conn.connectionType,
          downloadedFiles: [],
          skippedFiles: [],
          positionsProcessed: 0,
          success: true,
          freshness: {
            status: freshnessResult.status,
            dataDate,
            formattedDate: formatDataDate(dataDate),
            businessDaysOld: freshnessResult.businessDaysOld,
            message: freshnessResult.message
          }
        });

        // Update counts
        results.connectionsProcessed++;
        if (freshnessResult.status === 'fresh') {
          results.connectionsSucceeded++;
        } else {
          results.connectionsWithStaleData++;
        }
      }
      console.log(`[CRON-CMB] Added freshness for ${allConnections.length - 1} other connections`);
    } catch (otherConnError) {
      console.error('[CRON-CMB] Error fetching other connections freshness:', otherConnError.message);
    }

    // Update schedule info
    scheduleInfo.cmbFileSync.lastFinishedAt = new Date();
    scheduleInfo.cmbFileSync.nextScheduledRun = getNextRunTime(scheduleInfo.cmbFileSync.schedule);

    // Log completion
    await CronJobLogHelpers.completeJob(logId, results);
    const staleWarning = results.connectionsWithStaleData > 0 ? ` (${results.connectionsWithStaleData} stale)` : '';
    console.log(`[CRON] CMB File Sync completed: ${results.connectionsSucceeded}/${results.connectionsProcessed} fresh${staleWarning}`);

    // Update consolidated holdings after CMB processing
    if (results.positionsProcessed > 0) {
      try {
        const consolidationResult = await createConsolidatedHoldings();
        results.consolidation = consolidationResult;
      } catch (consolidationError) {
        console.error('[CRON-CMB] Consolidation error:', consolidationError.message);
        results.consolidation = { success: false, error: consolidationError.message };
      }
    }

    // Send email notification if new files were processed
    if (results.filesDownloaded > 0 || results.positionsProcessed > 0) {
      try {
        await EmailService.sendBankSyncCompletionEmail(
          'mf@amberlakepartners.com',
          results,
          [] // No notifications for CMB-only sync
        );
        console.log('[CRON-CMB] CMB sync completion email sent');
      } catch (emailError) {
        console.error('[CRON-CMB] Failed to send email:', emailError.message);
      }
    }

    // After CMB sync (last bank to sync), regenerate today's snapshots from final holdings
    // This ensures snapshots reflect ALL banks, not just those that synced in the first batch
    try {
      const snapshotResult = await regenerateTodaySnapshots();
      results.snapshotRegeneration = snapshotResult;
    } catch (snapshotError) {
      console.error('[CRON-CMB] Failed to regenerate today snapshots:', snapshotError.message);
      results.snapshotRegeneration = { success: false, error: snapshotError.message };
    }

    // After snapshot regeneration, compute dashboard metrics for fast loading
    try {
      const metricsResult = await computeDashboardMetrics();
      results.dashboardMetrics = metricsResult;
    } catch (metricsError) {
      console.error('[CRON-CMB] Failed to compute dashboard metrics:', metricsError.message);
      results.dashboardMetrics = { success: false, error: metricsError.message };
    }

    return { success: true, ...results };

  } catch (error) {
    console.error('[CRON] CMB File Sync failed:', error);
    await CronJobLogHelpers.failJob(logId, error);
    throw error;
  }
}

/**
 * Regenerate today's portfolio snapshots from current PMSHoldings
 *
 * Called after all bank syncs complete (end of CMB sync at 09:00+).
 * Rebuilds snapshots for today using the final, complete holdings data
 * so that no partial-sync data causes dips in the AUM chart.
 */
async function regenerateTodaySnapshots() {
  console.log('[CRON] Regenerating today\'s snapshots from final holdings...');

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Get all active bank connections
  const connections = await BankConnectionsCollection.find({ isActive: true }).fetchAsync();

  // Pre-fetch transfer operations for all users (reused across all snapshots)
  const transferOpsCache = await PMSOperationsCollection.find({
    operationType: 'TRANSFER',
    operationCategory: 'CASH'
  }).fetchAsync();

  let regenerated = 0;
  let errors = 0;

  for (let ci = 0; ci < connections.length; ci++) {
    await yieldToEventLoop(ci, 5);
    const connection = connections[ci];
    try {
      const bank = await BanksCollection.findOneAsync(connection.bankId);
      if (!bank) continue;

      // Get today's latest holdings for this bank
      const holdings = await PMSHoldingsCollection.find({
        bankId: connection.bankId,
        isLatest: true,
        isActive: true
      }).fetchAsync();

      if (holdings.length === 0) continue;

      // Group by userId + portfolioCode
      const portfolioGroups = {};
      for (const h of holdings) {
        if (!h.userId) continue;
        const key = `${h.userId}__${h.portfolioCode || 'UNKNOWN'}`;
        if (!portfolioGroups[key]) {
          portfolioGroups[key] = {
            userId: h.userId,
            portfolioCode: h.portfolioCode || 'UNKNOWN',
            accountNumber: h.accountNumber || null,
            positions: []
          };
        }
        portfolioGroups[key].positions.push(h);
      }

      // Create/update snapshot for each portfolio
      const groupValues = Object.values(portfolioGroups);
      for (let gi = 0; gi < groupValues.length; gi++) {
        await yieldToEventLoop(gi, 10);
        const group = groupValues[gi];
        try {
          await PortfolioSnapshotHelpers.createSnapshot({
            userId: group.userId,
            bankId: connection.bankId,
            bankName: bank.name,
            connectionId: connection._id,
            portfolioCode: group.portfolioCode,
            accountNumber: group.accountNumber,
            snapshotDate: today,
            fileDate: today,
            sourceFile: 'regenerated_post_sync',
            holdings: group.positions,
            transferOpsCache
          });
          regenerated++;
        } catch (err) {
          errors++;
          console.error(`[CRON] Snapshot error for ${group.portfolioCode}: ${err.message}`);
        }
      }
    } catch (connError) {
      errors++;
      console.error(`[CRON] Connection error ${connection._id}: ${connError.message}`);
    }
  }

  console.log(`[CRON] Snapshot regeneration complete: ${regenerated} updated, ${errors} errors`);
  return { success: true, regenerated, errors };
}

/**
 * Compute and cache dashboard AUM metrics
 *
 * Pre-computes AUM summary and WTD history for fast dashboard loading.
 * Called after CMB sync completes to ensure all bank data is processed.
 *
 * Metrics computed:
 * - Total AUM in EUR
 * - Previous day AUM (from snapshots)
 * - Day-over-day change (amount and percent)
 * - WTD history (last 7 days)
 */
async function computeDashboardMetrics() {
  console.log('[CRON] Computing dashboard metrics...');

  try {
    // Asset classes to include in AUM (matches rmDashboardMethods.getPortfolioSummary)
    const aumAssetClasses = [
      'cash', 'equity', 'fixed_income', 'structured_product',
      'time_deposit', 'monetary_products', 'commodities',
      'private_equity', 'private_debt', 'etf', 'fund'
    ];

    // Step 1: Calculate current total AUM from latest holdings (exclude CONSOLIDATED to avoid double-counting)
    const allHoldings = await PMSHoldingsCollection.find({
      isActive: true,
      isLatest: true,
      marketValue: { $exists: true, $gt: 0 },
      portfolioCode: { $ne: 'CONSOLIDATED' },
      $or: [
        { assetClass: { $in: aumAssetClasses } },
        { assetClass: null },
        { assetClass: { $exists: false } }
      ]
    }).fetchAsync();

    const totalAUMInEUR = allHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);

    // Track current portfolios for comparison
    const currentPortfolioKeys = new Set();
    allHoldings.forEach(h => {
      const key = `${h.portfolioCode || 'unknown'}|${h.bankId || 'unknown'}`;
      currentPortfolioKeys.add(key);
    });

    console.log(`[CRON] Dashboard metrics - Current AUM: ${totalAUMInEUR.toLocaleString('en-US', { maximumFractionDigits: 0 })} EUR`);

    // Step 2: Calculate day-over-day change from yesterday's snapshots
    let previousDayAUM = null;
    let aumChange = 0;
    let aumChangePercent = 0;

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);

    const yesterdaySnapshots = await PortfolioSnapshotsCollection.find({
      snapshotDate: yesterday,
      totalAccountValue: { $gt: 0 },
      portfolioCode: { $ne: 'CONSOLIDATED' }
    }).fetchAsync();

    if (yesterdaySnapshots.length > 0) {
      // Build set of portfolios that have yesterday's snapshots
      const snapshotPortfolioKeys = new Set(
        yesterdaySnapshots.map(s => `${s.portfolioCode}|${s.bankId}`)
      );

      // Find portfolios that exist in BOTH current holdings AND yesterday's snapshots
      const matchedPortfolioKeys = [...currentPortfolioKeys].filter(key => snapshotPortfolioKeys.has(key));

      if (matchedPortfolioKeys.length > 0) {
        // Calculate previous AUM from matched snapshots
        const matchedSnapshots = yesterdaySnapshots.filter(s => {
          const key = `${s.portfolioCode}|${s.bankId}`;
          return matchedPortfolioKeys.includes(key);
        });
        previousDayAUM = matchedSnapshots.reduce((sum, s) => sum + (s.totalAccountValue || 0), 0);

        // Calculate current AUM for matched portfolios only (apples-to-apples)
        const matchedCurrentAUM = allHoldings
          .filter(h => {
            const key = `${h.portfolioCode || 'unknown'}|${h.bankId || 'unknown'}`;
            return matchedPortfolioKeys.includes(key);
          })
          .reduce((sum, h) => sum + (h.marketValue || 0), 0);

        aumChange = matchedCurrentAUM - previousDayAUM;
        aumChangePercent = previousDayAUM > 0 ? (aumChange / previousDayAUM) * 100 : 0;

        console.log(`[CRON] Dashboard metrics - Previous AUM: ${previousDayAUM.toLocaleString('en-US', { maximumFractionDigits: 0 })} EUR (${matchedPortfolioKeys.length} portfolios)`);
        console.log(`[CRON] Dashboard metrics - AUM Change: ${aumChange >= 0 ? '+' : ''}${aumChange.toLocaleString('en-US', { maximumFractionDigits: 0 })} EUR (${aumChangePercent.toFixed(2)}%)`);
      }
    }

    // Step 3: Build WTD history (last 7 days)
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);

    // Exclude CONSOLIDATED snapshots to avoid double-counting with individual portfolio snapshots
    const wtdSnapshots = await PortfolioSnapshotsCollection.find({
      snapshotDate: { $gte: startDate, $lte: endDate },
      portfolioCode: { $ne: 'CONSOLIDATED' }
    }, {
      sort: { snapshotDate: 1 }
    }).fetchAsync();

    // Aggregate snapshots by date (skip weekends - incomplete data causes chart dips)
    const dateMap = new Map();
    for (const snapshot of wtdSnapshots) {
      const dayOfWeek = snapshot.snapshotDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip Saturday/Sunday

      const dateKey = snapshot.snapshotDate.toISOString().split('T')[0];
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { date: snapshot.snapshotDate, totalAccountValue: 0, portfolioCount: 0 });
      }
      const entry = dateMap.get(dateKey);
      entry.totalAccountValue += (snapshot.totalAccountValue || 0);
      entry.portfolioCount += 1;
    }

    // Filter out days with incomplete portfolio coverage, then sort
    const allEntries = Array.from(dateMap.values());
    const maxPortfolioCount = Math.max(...allEntries.map(e => e.portfolioCount));
    const minThreshold = Math.floor(maxPortfolioCount * 0.8);

    const wtdHistory = allEntries
      .filter(e => e.portfolioCount >= minThreshold)
      .sort((a, b) => a.date - b.date)
      .map(s => ({ date: s.date, value: s.totalAccountValue }));

    // Add/update today's entry with live AUM
    const todayKey = new Date().toISOString().split('T')[0];
    const existingTodayIndex = wtdHistory.findIndex(
      s => s.date.toISOString().split('T')[0] === todayKey
    );

    if (existingTodayIndex >= 0) {
      wtdHistory[existingTodayIndex].value = totalAUMInEUR;
    } else {
      wtdHistory.push({ date: new Date(), value: totalAUMInEUR });
    }

    // Step 4: Get client count for metadata
    const clientCount = await UsersCollection.find({ role: USER_ROLES.CLIENT }).countAsync();

    // Step 5: Save to cache
    await DashboardMetricsHelpers.saveMetrics({
      metricType: 'aum_summary',
      scope: 'global',
      totalAUM: totalAUMInEUR,
      previousDayAUM,
      aumChange,
      aumChangePercent,
      wtdHistory,
      portfolioCount: currentPortfolioKeys.size,
      clientCount,
      snapshotDate: new Date()
    });

    console.log(`[CRON] Dashboard metrics computed and cached successfully`);

    return {
      success: true,
      totalAUM: totalAUMInEUR,
      previousDayAUM,
      aumChange,
      aumChangePercent,
      wtdHistoryDays: wtdHistory.length,
      portfolioCount: currentPortfolioKeys.size,
      clientCount
    };

  } catch (error) {
    console.error('[CRON] Error computing dashboard metrics:', error.message);
    return { success: false, error: error.message };
  }
}

export async function initializeCronJobs() {
  console.log('Initializing cron jobs...');

  // Restore lastFinishedAt from database logs (survives server restarts)
  await initializeScheduleInfoFromLogs();

  // Calculate initial next run times
  scheduleInfo.marketDataRefresh.nextScheduledRun = getNextRunTime(scheduleInfo.marketDataRefresh.schedule);
  scheduleInfo.productRevaluation.nextScheduledRun = getNextRunTime(scheduleInfo.productRevaluation.schedule);
  scheduleInfo.marketTickerUpdate.nextScheduledRun = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
  scheduleInfo.bankFileSync.nextScheduledRun = getNextRunTime(scheduleInfo.bankFileSync.schedule);
  scheduleInfo.cmbFileSync.nextScheduledRun = getNextRunTime(scheduleInfo.cmbFileSync.schedule);

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

  // Schedule Bank File Sync - Daily at 07:30 CET Mon-Fri (skip weekends)
  cronJobs.bankFileSync = cron.schedule('30 7 * * 1-5', Meteor.bindEnvironment(async () => {
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

  console.log('✓ Bank File Sync scheduled for 07:30 CET Mon-Fri (skip weekends)');

  // Schedule CMB File Sync - Daily at 09:00 CET Mon-Fri (skip weekends, CMB uploads files later than other banks)
  cronJobs.cmbFileSync = cron.schedule('0 9 * * 1-5', Meteor.bindEnvironment(async () => {
    console.log('[CRON] ========================================');
    console.log('[CRON] CMB File Sync CRON trigger fired at:', new Date().toISOString());
    console.log('[CRON] ========================================');
    try {
      await cmbFileSyncJob();
    } catch (error) {
      console.error('[CRON] CMB File Sync job error:', error);
    }
  }), {
    scheduled: true,
    timezone: "Europe/Zurich"
  });

  console.log('✓ CMB File Sync scheduled for 09:00 CET Mon-Fri (skip weekends)');

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
      this.unblock();

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
      this.unblock();

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
     * @param {String} sessionId - User session ID
     * @param {Object} options - Optional parameters
     * @param {Boolean} options.forceReprocess - If true, deletes existing records for latest date and reprocesses
     */
    async 'cronJobs.triggerBankFileSync'(sessionId, options = {}) {
      check(sessionId, String);
      check(options, Match.Maybe(Object));
      this.unblock();

      const { forceReprocess = false } = options;

      // Authenticate user - only superadmin
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || currentUser.role !== 'superadmin') {
        throw new Meteor.Error('access-denied', 'Superadmin privileges required');
      }

      console.log(`[MANUAL] Bank File Sync triggered by ${currentUser.email}${forceReprocess ? ' (FORCE REPROCESS)' : ''}`);

      try {
        const result = await bankFileSyncJob('manual', { forceReprocess });
        return { success: true, result };
      } catch (error) {
        throw new Meteor.Error('job-execution-failed', error.message);
      }
    },

    /**
     * Manually trigger dashboard metrics computation
     * Pre-computes AUM metrics for fast dashboard loading
     */
    async 'cronJobs.triggerDashboardMetrics'(sessionId) {
      check(sessionId, String);
      this.unblock();

      // Authenticate user - only superadmin
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || currentUser.role !== 'superadmin') {
        throw new Meteor.Error('access-denied', 'Superadmin privileges required');
      }

      console.log(`[MANUAL] Dashboard Metrics computation triggered by ${currentUser.email}`);

      try {
        const result = await computeDashboardMetrics();
        return { success: true, result };
      } catch (error) {
        throw new Meteor.Error('job-execution-failed', error.message);
      }
    },

    /**
     * Get dashboard metrics cache status
     */
    async 'cronJobs.getDashboardMetricsStatus'(sessionId) {
      check(sessionId, String);

      // Authenticate user
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
        throw new Meteor.Error('access-denied', 'Admin privileges required');
      }

      const stats = await DashboardMetricsHelpers.getCacheStats();
      const cached = await DashboardMetricsHelpers.getMetrics('global', 'aum_summary');

      return {
        cacheStats: stats,
        currentMetrics: cached ? {
          totalAUM: cached.totalAUM,
          aumChange: cached.aumChange,
          aumChangePercent: cached.aumChangePercent,
          portfolioCount: cached.portfolioCount,
          computedAt: cached.computedAt,
          expiresAt: cached.expiresAt
        } : null
      };
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
        },
        {
          name: scheduleInfo.cmbFileSync.name,
          nextScheduledRun: scheduleInfo.cmbFileSync.nextScheduledRun,
          lastFinishedAt: scheduleInfo.cmbFileSync.lastFinishedAt
        }
      ];
    }
  });
}
