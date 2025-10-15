import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection } from '/imports/api/users';
import { ProductsCollection } from '/imports/api/products';
import { PhoenixEvaluator } from '/imports/api/evaluators/phoenixEvaluator';
import { OrionEvaluator } from '/imports/api/evaluators/orionEvaluator';
import { HimalayaEvaluator } from '/imports/api/evaluators/himalayaEvaluator';
import { SharkNoteEvaluator } from '/imports/api/evaluators/sharkNoteEvaluator';
import { ParticipationNoteEvaluator } from '/imports/api/evaluators/participationNoteEvaluator';
import { PhoenixChartBuilder } from '/imports/api/chartBuilders/phoenixChartBuilder';
import { OrionChartBuilder } from '/imports/api/chartBuilders/orionChartBuilder';
import { HimalayaChartBuilder } from '/imports/api/chartBuilders/himalayaChartBuilder';
import { SharkNoteChartBuilder } from '/imports/api/chartBuilders/sharkNoteChartBuilder';
import { ParticipationNoteChartBuilder } from '/imports/api/chartBuilders/participationNoteChartBuilder';

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

  // Publications
  Meteor.publish('templateReports.forProduct', function(productId) {
    check(productId, String);
    
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
      
      const templateId = detectTemplateId(productData);
      
      // Get template-specific report builder
      const reportBuilder = TemplateReportHelpers.getTemplateReportBuilder(templateId);
      
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

      const report = {
        productId: productData._id,
        productIsin: productData.isin,
        productName: productData.title || productData.productName || 'Unknown Product',
        templateId: templateId,

        evaluationDate: new Date(),
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
      const removedCount = await TemplateReportsCollection.removeAsync({ productId: productData._id });
      if (removedCount > 0) {
      }
      
      const reportId = await TemplateReportsCollection.insertAsync(report);

      // Update product status based on template results
      if (templateResults.currentStatus && templateResults.currentStatus.productStatus) {
        const productUpdateFields = {
          productStatus: templateResults.currentStatus.productStatus,
          statusDetails: templateResults.currentStatus.statusDetails || {},
          lastEvaluationDate: new Date(),
          updatedAt: new Date(),
          updatedBy: user._id
        };

        await ProductsCollection.updateAsync(
          { _id: productData._id },
          { $set: productUpdateFields }
        );

        console.log(`[templateReports.create] Updated product ${productData._id} status to: ${templateResults.currentStatus.productStatus}`);
      }

      return reportId;
    },

    /**
     * Generate a new template report and process events/notifications
     * This is the main method called by cron jobs and manual re-evaluation
     *
     * @param {Object} productData - Full product object
     * @param {String} triggeredBy - Who triggered the evaluation ('system-cron', 'manual', userId)
     * @returns {String} - Report ID
     */
    async 'templateReports.generate'(productData, triggeredBy = 'system') {
      check(productData, Object);
      check(triggeredBy, String);

      console.log(`[templateReports.generate] Generating report for ${productData._id}, triggered by: ${triggeredBy}`);

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
      if (triggeredBy === 'system-cron' || triggeredBy === 'system') {
        // Find or create a system user session
        const systemUser = await UsersCollection.findOneAsync({ role: 'superadmin' });
        if (!systemUser) {
          throw new Meteor.Error('system-error', 'No superadmin user found for system evaluation');
        }

        // Create a temporary session for system operations
        const { SessionsCollection } = await import('./sessions.js');
        const existingSession = await SessionsCollection.findOneAsync({ userId: systemUser._id });

        if (existingSession) {
          sessionId = existingSession._id;
        } else {
          sessionId = await SessionsCollection.insertAsync({
            userId: systemUser._id,
            createdAt: new Date(),
            lastActivityAt: new Date(),
            ipAddress: 'system',
            userAgent: 'cron-job'
          });
        }
      } else {
        // For manual triggers, triggeredBy should be a sessionId
        sessionId = triggeredBy;
      }

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
        await NotificationService.processEvents(productData, events, triggeredBy);
        console.log(`[templateReports.generate] Notifications processed`);
      }

      return reportId;
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
 
