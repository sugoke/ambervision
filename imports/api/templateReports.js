import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection } from '/imports/api/users';
import { ProductsCollection } from '/imports/api/products';
import { PhoenixEvaluator } from '/imports/api/evaluators/phoenixEvaluator';
import { OrionEvaluator } from '/imports/api/evaluators/orionEvaluator';
import { HimalayaEvaluator } from '/imports/api/evaluators/himalayaEvaluator';
import { SharkNoteEvaluator } from '/imports/api/evaluators/sharkNoteEvaluator';
import { ParticipationNoteEvaluator } from '/imports/api/evaluators/participationNoteEvaluator';
import { ReverseConvertibleEvaluator } from '/imports/api/evaluators/reverseConvertibleEvaluator';
import { ReverseConvertibleBondEvaluator } from '/imports/api/evaluators/reverseConvertibleBondEvaluator';
import { PhoenixChartBuilder } from '/imports/api/chartBuilders/phoenixChartBuilder';
import { OrionChartBuilder } from '/imports/api/chartBuilders/orionChartBuilder';
import { HimalayaChartBuilder } from '/imports/api/chartBuilders/himalayaChartBuilder';
import { SharkNoteChartBuilder } from '/imports/api/chartBuilders/sharkNoteChartBuilder';
import { ParticipationNoteChartBuilder } from '/imports/api/chartBuilders/participationNoteChartBuilder';
import { ReverseConvertibleChartBuilder } from '/imports/api/chartBuilders/reverseConvertibleChartBuilder';
import { ReverseConvertibleBondChartBuilder } from '/imports/api/chartBuilders/reverseConvertibleBondChartBuilder';
import { ProcessingIssueCollector } from '/imports/api/processingIssueCollector';

/**
 * Template-based Reports Collection
 * 
 * New simplified report system for template-based products.
 * Each report represents one evaluation of a product at a specific date.
 * 
 * DOCUMENT STRUCTURE:
 * {
 *   _id: ObjectId,
 *   
 *   // Product Reference
 *   productId: String,           // Reference to products collection
 *   productIsin: String,         // Product ISIN
 *   productName: String,         // Product display name
 *   templateId: String,          // Which template was used (phoenix_autocallable, etc.)
 *   
 *   // Evaluation Context
 *   evaluationDate: Date,        // When this evaluation was run
 *   evaluatedBy: String,         // User ID who triggered the evaluation
 *   
 *   // Template-specific Results
 *   templateResults: Object,     // Results specific to the template type
 *   
 *   // Basic Product Data (static at evaluation time)
 *   staticData: {
 *     isin: String,
 *     name: String,
 *     currency: String,
 *     tradeDate: Date,
 *     maturityDate: Date,
 *     notional: Number
 *   },
 *   
 *   // Audit
 *   createdAt: Date,
 *   version: String              // Template report version
 * }
 */

export const TemplateReportsCollection = new Mongo.Collection('templateReports');

// Server-side methods and publications
if (Meteor.isServer) {
  // Validate session and get user helper
  const validateSessionAndGetUser = async (sessionId) => {
    if (!sessionId) {
      throw new Meteor.Error('not-authorized', 'Session ID required');
    }
    
    const session = await SessionHelpers.validateSession(sessionId);
    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid or expired session');
    }
    
    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }

    return user;
  };

  /**
   * Helper to update product processing issue status
   * Called after report generation to persist issue information
   *
   * @param {string} productId - Product ID to update
   * @param {ProcessingIssueCollector} issueCollector - The issue collector with results
   */
  const updateProductProcessingStatus = async (productId, issueCollector) => {
    if (!productId || !issueCollector) return;

    const summary = issueCollector.getSummary();

    const updateFields = {
      processingStatus: summary.processingStatus,
      processingIssues: summary.processingIssues,
      hasProcessingWarnings: summary.hasProcessingWarnings,
      hasProcessingErrors: summary.hasProcessingErrors,
      lastEvaluationDate: new Date()
    };

    // If successful, also update lastSuccessfulEvaluation
    if (summary.processingStatus === 'success') {
      updateFields.lastSuccessfulEvaluation = new Date();
      // Clear any previous issues on success
      updateFields.processingIssues = [];
    }

    try {
      await ProductsCollection.updateAsync(
        { _id: productId },
        { $set: updateFields }
      );

      if (summary.hasProcessingErrors || summary.hasProcessingWarnings) {
        console.log(`[templateReports] Updated processing status for ${productId}: ${summary.processingStatus} (${summary.errorCount} errors, ${summary.warningCount} warnings)`);
      }
    } catch (error) {
      console.error(`[templateReports] Failed to update processing status for ${productId}:`, error);
    }
  };

  // Publications
  Meteor.publish('templateReports.forProduct', function(productId) {
    check(productId, String);

    console.log(`[templateReports publication] Subscribed to reports for product: ${productId}`);

    return TemplateReportsCollection.find(
      { productId },
      {
        sort: { createdAt: -1 },
        limit: 50 // Keep last 50 evaluations
      }
    );
  });

  // Methods
  Meteor.methods({
    /**
     * Create a new template-based evaluation report
     */
    async 'templateReports.create'(productData, sessionId) {
      check(productData, Object);
      check(sessionId, String);

      const user = await validateSessionAndGetUser(sessionId);

      // Create issue collector to track processing issues
      const issueCollector = new ProcessingIssueCollector(productData._id);

      const templateId = detectTemplateId(productData);

      // Get template-specific report builder
      const reportBuilder = TemplateReportHelpers.getTemplateReportBuilder(templateId);

      // HIMALAYA-SPECIFIC: Normalize tickers before evaluation
      if (templateId === 'himalaya' && productData.underlyings) {
        console.log('🔧 HIMALAYA: Normalizing tickers before evaluation');
        for (const underlying of productData.underlyings) {
          const originalTicker = underlying.ticker;
          // Normalize ticker to include .US suffix for US tickers
          if (!originalTicker.includes('.')) {
            underlying.ticker = `${originalTicker}.US`;
            if (!underlying.securityData) underlying.securityData = {};
            underlying.securityData.ticker = `${originalTicker}.US`;
            console.log(`  ✅ Normalized ${originalTicker} → ${underlying.ticker}`);
          }
        }
      }

      // Run template-specific evaluation
      const templateResults = await reportBuilder.generateReport(productData, {
        evaluationDate: new Date(),
        evaluatedBy: user._id
      });

      // Generate chart data if chart builder is available
      try {
        const chartBuilder = TemplateReportHelpers.getTemplateChartBuilder(templateId);
        console.log('📊 Chart builder for', templateId, ':', !!chartBuilder);

        if (chartBuilder) {
          const chartData = await chartBuilder.generateChartData(productData, templateResults);
          console.log('📊 Chart data generated:', {
            templateId,
            hasData: !!chartData,
            type: chartData?.type,
            datasetCount: chartData?.data?.datasets?.length,
            metadata: chartData?.metadata
          });

          if (chartData) {
            // Store chart data in database
            const { ChartDataCollection } = await import('./chartData.js');
            await Meteor.callAsync('chartData.upsert', productData._id, chartData);
            console.log('📊 Chart data stored for product:', productData._id);

            // Add chart reference to template results
            templateResults.chartData = {
              available: true,
              type: chartData.metadata?.chartType || 'performance_chart',
              productId: productData._id
            };
          } else {
            console.log('⚠️ Chart builder returned null for', templateId);
            templateResults.chartData = {
              available: false,
              reason: 'Chart builder not implemented'
            };
          }
        } else {
          console.log('⚠️ No chart builder found for', templateId);
        }
      } catch (chartError) {
        console.error('❌ Error generating chart data:', chartError);
        templateResults.chartData = {
          available: false,
          error: chartError.message
        };
        // Add chart generation issue
        issueCollector.addIssue('CHART_GENERATION_FAILED', {
          error: chartError.message
        });
      }

      // DEBUG: Log underlyings with news before saving to database
      if (templateResults.underlyings) {
        console.log('📰 [templateReports.create] Underlyings before DB save:', templateResults.underlyings.map(u => ({
          ticker: u.ticker,
          hasNews: !!u.news,
          newsCount: u.news?.length || 0,
          newsTitle: u.news?.[0]?.title
        })));
      }

      const evaluationDate = new Date();
      const report = {
        productId: productData._id,
        productIsin: productData.isin,
        productName: productData.title || productData.productName || 'Unknown Product',
        templateId: templateId,

        evaluationDate: evaluationDate,
        evaluationDateFormatted: evaluationDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }),
        evaluatedBy: user._id,

        // Template-specific results from the evaluator
        templateResults: templateResults,

        // Static data snapshot
        staticData: {
          isin: productData.isin,
          name: productData.title || productData.productName || 'Unknown Product',
          currency: productData.currency || 'USD',
          tradeDate: productData.tradeDate ? new Date(productData.tradeDate) : null,
          maturityDate: productData.maturity || productData.maturityDate ?
            new Date(productData.maturity || productData.maturityDate) : null,
          notional: productData.notional || 100
        },

        createdAt: new Date(),
        version: '1.0.0'
      };

      // Remove old reports for this product (keep only latest)
      try {
        const removedCount = await TemplateReportsCollection.removeAsync({ productId: productData._id });
        console.log(`[templateReports.create] Removed ${removedCount} old reports for product ${productData._id}`);
      } catch (removeError) {
        console.error(`[templateReports.create] ❌ Error removing old reports:`, removeError);
        // Continue anyway - this shouldn't block report creation
      }

      console.log(`[templateReports.create] Inserting new report for product ${productData._id}`);
      console.log(`[templateReports.create] Report keys:`, Object.keys(report));
      console.log(`[templateReports.create] Report size:`, JSON.stringify(report).length, 'bytes');

      let reportId;
      try {
        reportId = await TemplateReportsCollection.insertAsync(report);
        console.log(`[templateReports.create] ✅ Report inserted successfully with ID: ${reportId}`);

        // Immediately verify the report exists in database
        const verifyReport = await TemplateReportsCollection.findOneAsync(reportId);
        if (verifyReport) {
          console.log(`[templateReports.create] ✅ Verified report exists in DB with ID: ${reportId}`);
          console.log(`[templateReports.create] ✅ Report productId: ${verifyReport.productId}, templateId: ${verifyReport.templateId}`);
        } else {
          console.error(`[templateReports.create] ❌ WARNING: Report was inserted but cannot be found immediately after!`);
        }
      } catch (insertError) {
        console.error(`[templateReports.create] ❌ Error inserting report:`, insertError);
        console.error(`[templateReports.create] ❌ Error details:`, {
          message: insertError.message,
          stack: insertError.stack,
          name: insertError.name
        });
        // Add report insertion issue
        issueCollector.addIssue('REPORT_INSERTION_FAILED', {
          context: { error: insertError.message }
        });
        // Update product processing status even on failure
        await updateProductProcessingStatus(productData._id, issueCollector);
        throw new Meteor.Error('report-insertion-failed', 'Failed to insert report into database', insertError.message);
      }

      // Update product status and title based on template results
      if (templateResults.currentStatus && templateResults.currentStatus.productStatus) {
        const productUpdateFields = {
          productStatus: templateResults.currentStatus.productStatus,
          statusDetails: templateResults.currentStatus.statusDetails || {},
          lastEvaluationDate: new Date(),
          updatedAt: new Date(),
          updatedBy: user._id
        };

        // Update product title if generatedProductName is available
        if (templateResults.generatedProductName) {
          productUpdateFields.title = templateResults.generatedProductName;
          console.log(`[templateReports.create] Updating product title to: ${templateResults.generatedProductName}`);
        }

        await ProductsCollection.updateAsync(
          { _id: productData._id },
          { $set: productUpdateFields }
        );

        console.log(`[templateReports.create] Updated product ${productData._id} status to: ${templateResults.currentStatus.productStatus}`);
      }

      // Update product processing status (track any issues from evaluation)
      await updateProductProcessingStatus(productData._id, issueCollector);

      return reportId;
    },

    /**
     * Generate a new template report and process events/notifications
     * This is the main method called by cron jobs and manual re-evaluation
     *
     * @param {Object} productData - Full product object
     * @param {String} triggeredBy - Who triggered the evaluation ('system-cron', 'manual', userId)
     * @param {String} cronJobRunId - Optional ID for cron job run (for batching notifications)
     * @returns {String} - Report ID
     */
    async 'templateReports.generate'(productData, triggeredBy = 'system', cronJobRunId = null) {
      check(productData, Object);
      check(triggeredBy, String);
      check(cronJobRunId, Match.Maybe(String));

      console.log(`[templateReports.generate] Generating report for ${productData._id}, triggered by: ${triggeredBy}`);

      try {
        // 1. Get previous report for event comparison
        const previousReport = await TemplateReportsCollection.findOneAsync(
          { productId: productData._id },
          { sort: { createdAt: -1 } }
        );

        if (previousReport) {
          console.log(`[templateReports.generate] Found previous report from ${previousReport.createdAt}`);
        } else {
          console.log(`[templateReports.generate] No previous report found (first evaluation)`);
        }

        // 2. Generate new report
        // For system-triggered evaluations, use a system session
        let sessionId;
        if (triggeredBy === 'system-cron' || triggeredBy === 'system' || triggeredBy === 'batch-process') {
          // Find or create a system user session
          const systemUser = await UsersCollection.findOneAsync({ role: 'superadmin' });
          if (!systemUser) {
            throw new Meteor.Error('system-error', 'No superadmin user found for system evaluation');
          }

          console.log(`[templateReports.generate] Found superadmin user: ${systemUser.email}`);

          // Check for existing valid session
          const { SessionsCollection } = await import('./sessions.js');
          const existingSession = await SessionsCollection.findOneAsync({
            userId: systemUser._id,
            isActive: true,
            expiresAt: { $gt: new Date() }
          });

          if (existingSession) {
            // FIXED: Use sessionId field, not _id
            sessionId = existingSession.sessionId;
            console.log(`[templateReports.generate] Reusing existing session: ${sessionId}`);
          } else {
            // FIXED: Use SessionHelpers.createSession to create proper session with all required fields
            const sessionData = await SessionHelpers.createSession(
              systemUser._id,
              true, // rememberMe = true for long-lived system session
              'cron-job', // userAgent
              'system' // ipAddress
            );
            sessionId = sessionData.sessionId;
            console.log(`[templateReports.generate] Created new system session: ${sessionId}`);
          }
        } else {
          // For manual triggers, triggeredBy should be a sessionId
          sessionId = triggeredBy;
        }

        console.log(`[templateReports.generate] Using sessionId: ${sessionId}`);

        const reportId = await Meteor.callAsync('templateReports.create', productData, sessionId);
        const currentReport = await TemplateReportsCollection.findOneAsync(reportId);

        console.log(`[templateReports.generate] New report created: ${reportId}`);

        // 3. Detect events by comparing reports
        const { EventDetector } = await import('./eventDetector.js');
        const events = EventDetector.detectEvents(previousReport, currentReport, productData);

        if (events && events.length > 0) {
          console.log(`[templateReports.generate] Detected ${events.length} events:`, events.map(e => e.type));
        } else {
          console.log(`[templateReports.generate] No events detected`);
        }

        // 4. Process notifications
        if (events && events.length > 0) {
          const { NotificationService } = await import('./notificationService.js');
          await NotificationService.processEvents(productData, events, triggeredBy, cronJobRunId);
          console.log(`[templateReports.generate] Notifications processed${cronJobRunId ? ` for cron run ${cronJobRunId}` : ''}`);
        }

        return reportId;

      } catch (error) {
        console.error(`[templateReports.generate] ❌ ERROR generating report for ${productData._id}:`, {
          productId: productData._id,
          triggeredBy,
          errorMessage: error.message,
          errorStack: error.stack,
          errorName: error.name
        });

        // Update product with error status for unhandled exceptions
        const errorCollector = new ProcessingIssueCollector(productData._id);
        errorCollector.addIssue('EVALUATION_ERROR', {
          error: error.message,
          context: { stack: error.stack }
        });
        await updateProductProcessingStatus(productData._id, errorCollector);

        throw error;
      }
    },

    /**
     * Get latest report for a product
     */
    async 'templateReports.getLatest'(productId) {
      check(productId, String);
      
      return await TemplateReportsCollection.findOneAsync(
        { productId },
        { sort: { createdAt: -1 } }
      );
    },

    /**
     * Delete all reports for a product
     */
    async 'templateReports.deleteForProduct'(productId, sessionId) {
      check(productId, String);
      check(sessionId, String);
      
      const user = await validateSessionAndGetUser(sessionId);
      
      // Only allow admins to delete reports
      if (user.role !== 'admin' && user.role !== 'superadmin') {
        throw new Meteor.Error('not-authorized', 'Only admins can delete reports');
      }
      
      const result = await TemplateReportsCollection.removeAsync({ productId });
      
      return result;
    }
  });

  /**
   * Helper to detect which template a product is using
   */
  const detectTemplateId = function(productData) {
    // IMPORTANT: Check product name for Himalaya FIRST (highest priority)
    // Then check structural indicators
    // Finally fallback to explicit template fields

    console.log('[detectTemplateId] Detecting template for product:', productData._id);

    const payoffStructure = productData.payoffStructure || [];
    const structure = productData.structure || {};
    const structureParams = productData.structureParameters || {};

    // Look for Himalaya indicators in product name/title (HIGHEST PRIORITY)
    const productName = (productData.title || productData.productName || '').toLowerCase();
    const isHimalayaByName = productName.includes('himalaya');

    if (isHimalayaByName) {
      console.log('[detectTemplateId] ✅ Detected HIMALAYA by name');
      return 'himalaya';
    }

    // Additional Himalaya structural indicators
    const hasFloor = structureParams.floor !== undefined || structureParams.floorLevel !== undefined;
    const observationSchedule = productData.observationSchedule || [];
    const hasObservationSchedule = observationSchedule.length > 0;

    if (hasFloor && hasObservationSchedule && !structureParams.couponRate) {
      console.log('[detectTemplateId] ✅ Detected HIMALAYA by structure (has floor + observation schedule without coupon)');
      return 'himalaya';
    }

    // Check explicit template fields (medium priority)
    if (productData.templateId) {
      console.log('[detectTemplateId] ✅ Using explicit templateId:', productData.templateId);
      return productData.templateId;
    }

    if (productData.template) {
      console.log('[detectTemplateId] ✅ Using explicit template:', productData.template);
      return productData.template;
    }

    // Look for Shark Note indicators (upper barrier + floor + NO observation schedule)
    const hasUpperBarrier = structureParams.upperBarrier || structure.upperBarrier;
    const hasRebate = structureParams.rebateValue || structure.rebateValue;
    const hasFloorLevel = structureParams.floorLevel || structure.floorLevel || structureParams.floor || structure.floor;

    // Shark Note: upper barrier > 100, rebate value, floor level, NO observation schedule
    if (hasUpperBarrier && hasUpperBarrier > 100 && hasRebate && hasFloorLevel && !hasObservationSchedule) {
      console.log('[detectTemplateId] ✅ Detected SHARK NOTE (upperBarrier > 100, rebate, floor, no observation schedule)');
      return 'shark_note';
    }

    // Orion products have upperBarrier >= 100 or rebate value present WITH observation schedule
    if ((hasUpperBarrier && hasUpperBarrier >= 100) || hasRebate) {
      console.log('[detectTemplateId] ✅ Detected ORION (upperBarrier >= 100 or rebate present)');
      return 'orion_memory';
    }

    // Look for Reverse Convertible indicators
    // Characteristics: guaranteed coupon, capital protection barrier, no autocall, simple maturity structure
    const isReverseConvertibleByName = productName.includes('reverse convertible');
    const hasCapitalProtectionBarrier = structureParams.capitalProtectionBarrier ||
                                        structureParams.protectionBarrier ||
                                        structureParams.protectionBarrierLevel;
    const hasCouponRate = structureParams.couponRate || structure.couponRate;

    if (isReverseConvertibleByName || (hasCapitalProtectionBarrier && hasCouponRate && !hasObservationSchedule && !hasUpperBarrier && !hasAutocall)) {
      console.log('[detectTemplateId] ✅ Detected REVERSE CONVERTIBLE (capital protection + coupon, no autocall)');
      return 'reverse_convertible';
    }

    // Look for Phoenix Autocallable indicators
    const hasAutocall = payoffStructure.some(item =>
      item.type === 'action' &&
      (item.value?.toLowerCase().includes('autocall') || item.value?.toLowerCase().includes('memory'))
    );

    const hasBarrier = payoffStructure.some(item =>
      item.type === 'barrier' &&
      item.barrier_type === 'protection'
    );

    if (hasAutocall && hasBarrier) {
      console.log('[detectTemplateId] ✅ Detected PHOENIX (has autocall and barrier)');
      return 'phoenix_autocallable';
    }

    // Default fallback
    console.log('[detectTemplateId] ⚠️ No template detected, using unknown_template');
    return 'unknown_template';
  };

  // Create indexes
  Meteor.startup(() => {
    try {
      TemplateReportsCollection.createIndex({ productId: 1, createdAt: -1 });
      TemplateReportsCollection.createIndex({ templateId: 1 });
      TemplateReportsCollection.createIndex({ evaluationDate: -1 });
      TemplateReportsCollection.createIndex({ productIsin: 1 });
    } catch (error) {
    }
  });
}

/**
 * Template Registry
 * Central configuration for all template types
 */
const TEMPLATE_REGISTRY = {
  phoenix_autocallable: {
    evaluator: PhoenixEvaluator,
    chartBuilder: PhoenixChartBuilder,
    uiComponent: 'PhoenixReport'
  },
  orion_memory: {
    evaluator: OrionEvaluator,
    chartBuilder: OrionChartBuilder,
    uiComponent: 'OrionReport'
  },
  himalaya: {
    evaluator: HimalayaEvaluator,
    chartBuilder: HimalayaChartBuilder,
    uiComponent: 'HimalayaReport'
  },
  shark_note: {
    evaluator: SharkNoteEvaluator,
    chartBuilder: SharkNoteChartBuilder,
    uiComponent: 'SharkNoteReport'
  },
  participation_note: {
    evaluator: ParticipationNoteEvaluator,
    chartBuilder: ParticipationNoteChartBuilder,
    uiComponent: 'ParticipationNoteReport'
  },
  reverse_convertible: {
    evaluator: ReverseConvertibleEvaluator,
    chartBuilder: ReverseConvertibleChartBuilder,
    uiComponent: 'ReverseConvertibleReport'
  },
  reverse_convertible_bond: {
    evaluator: ReverseConvertibleBondEvaluator,
    chartBuilder: ReverseConvertibleBondChartBuilder,
    uiComponent: 'ReverseConvertibleBondReport'
  },
  // Future templates can be added here
};

/**
 * Template Report Helpers
 */
export const TemplateReportHelpers = {
  /**
   * Get template-specific report generator
   */
  getTemplateReportBuilder(templateId) {
    const template = TEMPLATE_REGISTRY[templateId];
    return template ? template.evaluator : DefaultReportBuilder;
  },

  /**
   * Get template-specific chart builder
   */
  getTemplateChartBuilder(templateId) {
    const template = TEMPLATE_REGISTRY[templateId];
    return template ? template.chartBuilder : null;
  },

  /**
   * Get template UI component name
   */
  getTemplateUIComponent(templateId) {
    const template = TEMPLATE_REGISTRY[templateId];
    return template ? template.uiComponent : 'DefaultReport';
  }
};

/**
 * Default Report Builder
 * Fallback for unknown or unimplemented templates
 */
const DefaultReportBuilder = {
  async generateReport(product, context) {
    return {
      templateType: 'unknown',
      templateVersion: '1.0.0',
      currentStatus: {
        productStatus: 'unknown',
        evaluationDate: new Date()
      },
      message: 'Template not implemented yet'
    };
  }
};
 
