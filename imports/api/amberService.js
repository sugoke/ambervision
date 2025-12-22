import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { check, Match } from 'meteor/check';
import { ProductsCollection } from './products';
import { AllocationsCollection } from './allocations';
import { UsersCollection, USER_ROLES } from './users';
import { AmberConversationsCollection } from './amberConversations';
import { ReportsCollection } from './reports';
import { TemplateReportsCollection } from './templateReports';
import { EquityHoldingsCollection } from './equityHoldings';
import { MarketDataCacheCollection } from './marketDataCache';
import { UnderlyingPricesCollection } from './underlyingPrices';
import { UnderlyingsAnalysisCollection } from './underlyingsAnalysis';

// Anthropic API configuration
const ANTHROPIC_API_KEY = Meteor.settings.private?.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-3-5-haiku-20241022';

// Cache duration (5 minutes as per Anthropic docs)
const CACHE_DURATION_MS = 5 * 60 * 1000;

if (Meteor.isServer) {
  /**
   * Amber AI Service
   *
   * Core service for managing conversations with Amber AI assistant.
   * Uses Anthropic prompt caching for cost-effective context management.
   */
  export const AmberService = {
    /**
     * Build context data for a user based on their role and access permissions
     */
    async buildUserContext(userId) {
      const user = await UsersCollection.findOneAsync(userId);
      if (!user) {
        throw new Meteor.Error('user-not-found', 'User not found');
      }

      const context = {
        user: {
          role: user.role,
          email: user.email,
          firstName: user.profile?.firstName || '',
          lastName: user.profile?.lastName || '',
          preferredLanguage: user.profile?.preferredLanguage || 'en'
        },
        timestamp: new Date().toISOString(),
        products: [],
        allocations: [],
        underlyingPrices: [],
        underlyingsAnalysis: null,
        upcomingObservations: [],
        equityHoldings: [],
        recentNotifications: []
      };

      // Get products based on role
      let products = [];
      let productIds = [];

      if (user.role === USER_ROLES.SUPERADMIN || user.role === USER_ROLES.ADMIN) {
        // Admin sees all products
        products = await ProductsCollection.find({}, { limit: 1000 }).fetchAsync();
        context.dataScope = 'admin';

        // Get all allocations for admin context
        const allocations = await AllocationsCollection.find({}, { limit: 5000 }).fetchAsync();
        context.allocations = allocations.map(a => ({
          productId: a.productId,
          clientId: a.clientId,
          notional: a.notional,
          quantity: a.quantity
        }));

        // Get underlying prices
        const underlyingPrices = await UnderlyingPricesCollection.find({}, {
          limit: 1000,
          sort: { date: -1 }
        }).fetchAsync();
        context.underlyingPrices = underlyingPrices.map(p => ({
          ticker: p.ticker,
          date: p.date,
          close: p.close
        }));

        // Get underlyings analysis (live analysis data)
        const underlyingsAnalysis = await UnderlyingsAnalysisCollection.findOneAsync({
          _id: 'phoenix_live_underlyings'
        });
        if (underlyingsAnalysis) {
          context.underlyingsAnalysis = {
            lastUpdate: underlyingsAnalysis.lastUpdate,
            underlyingCount: underlyingsAnalysis.underlyings?.length || 0,
            underlyings: underlyingsAnalysis.underlyings?.map(u => ({
              ticker: u.ticker,
              name: u.name,
              currentPrice: u.currentPrice,
              performance: u.performance,
              distanceToBarrier: u.distanceToBarrier
            })) || []
          };
        }
      } else if (user.role === USER_ROLES.RELATIONSHIP_MANAGER) {
        // RM sees products of assigned clients
        const assignedClients = await UsersCollection.find({
          role: USER_ROLES.CLIENT,
          relationshipManagerId: user._id
        }).fetchAsync();

        const clientIds = assignedClients.map(c => c._id);
        const allocations = await AllocationsCollection.find({
          clientId: { $in: clientIds }
        }).fetchAsync();

        productIds = [...new Set(allocations.map(a => a.productId))];
        products = await ProductsCollection.find({
          _id: { $in: productIds }
        }).fetchAsync();

        context.dataScope = 'rm';
        context.clientCount = clientIds.length;

        // Get allocations for RM's clients
        context.allocations = allocations.map(a => ({
          productId: a.productId,
          clientId: a.clientId,
          notional: a.notional,
          quantity: a.quantity
        }));

        // Get underlying prices for RM's products
        const underlyingTickers = products.flatMap(p =>
          (p.underlyings || []).map(u => u.ticker)
        ).filter(Boolean);

        if (underlyingTickers.length > 0) {
          const underlyingPrices = await UnderlyingPricesCollection.find({
            ticker: { $in: underlyingTickers }
          }, {
            limit: 1000,
            sort: { date: -1 }
          }).fetchAsync();
          context.underlyingPrices = underlyingPrices.map(p => ({
            ticker: p.ticker,
            date: p.date,
            close: p.close
          }));
        }

        // Get underlyings analysis (live analysis data)
        const underlyingsAnalysis = await UnderlyingsAnalysisCollection.findOneAsync({
          _id: 'phoenix_live_underlyings'
        });
        if (underlyingsAnalysis) {
          // Filter to only underlyings in RM's products
          const relevantUnderlyings = underlyingsAnalysis.underlyings?.filter(u =>
            underlyingTickers.includes(u.ticker)
          ) || [];

          context.underlyingsAnalysis = {
            lastUpdate: underlyingsAnalysis.lastUpdate,
            underlyingCount: relevantUnderlyings.length,
            underlyings: relevantUnderlyings.map(u => ({
              ticker: u.ticker,
              name: u.name,
              currentPrice: u.currentPrice,
              performance: u.performance,
              distanceToBarrier: u.distanceToBarrier
            }))
          };
        }
      } else if (user.role === USER_ROLES.CLIENT) {
        // Client sees only their allocated products
        const allocations = await AllocationsCollection.find({
          clientId: user._id
        }).fetchAsync();

        productIds = [...new Set(allocations.map(a => a.productId))];
        products = await ProductsCollection.find({
          _id: { $in: productIds }
        }).fetchAsync();

        context.dataScope = 'client';

        // Get equity holdings for client
        const equityHoldings = await EquityHoldingsCollection.find({
          userId: user._id
        }).fetchAsync();

        context.equityHoldings = equityHoldings.map(holding => ({
          ticker: holding.ticker,
          companyName: holding.companyName,
          quantity: holding.quantity,
          currentValue: holding.currentValue,
          totalReturn: holding.totalReturn,
          totalReturnPercent: holding.totalReturnPercent
        }));
      }

      // Summarize products (minimal data to reduce token count)
      context.products = products.map(p => ({
        id: p._id,
        isin: p.isin,
        title: p.title || p.productName,
        issuer: p.issuer,
        type: p.templateId || p.type,
        currency: p.currency,
        tradeDate: p.tradeDate,
        maturityDate: p.maturity || p.maturityDate,
        underlyings: p.underlyings?.map(u => ({
          ticker: u.ticker,
          name: u.name
        })) || [],
        status: this._determineProductStatus(p)
      }));

      // Get upcoming observations (next 90 days)
      const now = new Date();
      const futureDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

      for (const product of products) {
        if (product.observationSchedule && Array.isArray(product.observationSchedule)) {
          const upcoming = product.observationSchedule.filter(obs => {
            const obsDate = new Date(obs.observationDate);
            return obsDate >= now && obsDate <= futureDate;
          });

          if (upcoming.length > 0) {
            context.upcomingObservations.push({
              productId: product._id,
              productTitle: product.title || product.productName,
              observations: upcoming.map(obs => ({
                date: obs.observationDate,
                type: obs.isCallable ? 'Autocall & Coupon' : 'Coupon Only',
                autocallLevel: obs.autocallLevel
              }))
            });
          }
        }
      }

      context.productCount = products.length;
      context.observationCount = context.upcomingObservations.reduce((sum, p) => sum + p.observations.length, 0);

      return context;
    },

    /**
     * Determine product status
     */
    _determineProductStatus(product) {
      const now = new Date();
      const maturityDate = product.maturity || product.maturityDate;

      if (maturityDate && new Date(maturityDate) < now) {
        return 'matured';
      }

      if (product.finalObservation || product.finalObservationDate) {
        const finalObsDate = new Date(product.finalObservation || product.finalObservationDate);
        if (finalObsDate < now) {
          return 'matured';
        }
      }

      return 'live';
    },

    /**
     * TOOL: Get full product details including barriers, coupons, structure
     */
    async getProductDetails(productId, userId) {
      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) {
        return { error: 'Product not found' };
      }

      // Verify user has access to this product
      const user = await UsersCollection.findOneAsync(userId);
      if (!user) {
        return { error: 'User not found' };
      }

      // Check access permissions
      if (user.role === USER_ROLES.CLIENT) {
        const allocation = await AllocationsCollection.findOneAsync({
          clientId: userId,
          productId: productId
        });
        if (!allocation) {
          return { error: 'Access denied - product not allocated to user' };
        }
      }

      // Return full product structure
      return {
        id: product._id,
        isin: product.isin,
        title: product.title || product.productName,
        issuer: product.issuer,
        type: product.templateId || product.type,
        currency: product.currency,
        notional: product.notional,
        tradeDate: product.tradeDate,
        maturityDate: product.maturity || product.maturityDate,
        finalObservation: product.finalObservation || product.finalObservationDate,

        // Underlyings with full details
        underlyings: product.underlyings?.map(u => ({
          ticker: u.ticker,
          name: u.name,
          isin: u.isin,
          weight: u.weight,
          initialPrice: u.initialPrice,
          strikePrice: u.strikePrice,
          currency: u.currency
        })) || [],

        // Barriers and protection
        protection: {
          hasProtection: product.protectionBarrier != null,
          protectionLevel: product.protectionBarrier,
          protectionType: product.protectionType,
          gearing: product.gearing || 1
        },

        // Autocall features
        autocall: {
          isAutocallable: product.isAutocallable || false,
          autocallBarrier: product.autocallBarrier,
          autocallSchedule: product.autocallSchedule
        },

        // Coupons
        coupons: {
          couponRate: product.couponRate,
          couponBarrier: product.couponBarrier,
          couponFrequency: product.couponFrequency,
          hasMemory: product.hasMemoryCoupon || false
        },

        // Observation schedule
        observationSchedule: product.observationSchedule || [],

        // Product components (drag-and-drop structure)
        components: product.components || [],

        // Additional features
        features: {
          hasCapitalProtection: product.hasCapitalProtection,
          hasCouponMemory: product.hasMemoryCoupon,
          isWorstOf: product.basketType === 'worst-of',
          isPhoenix: product.templateId?.includes('phoenix'),
          isSharkNote: product.templateId?.includes('shark')
        }
      };
    },

    /**
     * TOOL: Get product report with current calculations and scenarios
     */
    async getProductReport(productId, userId) {
      // Try template report first (for products created from templates)
      let report = await TemplateReportsCollection.findOneAsync({ productId });
      let isTemplateReport = !!report;

      // Fallback to regular reports
      if (!report) {
        report = await ReportsCollection.findOneAsync({ productId });
      }

      if (!report) {
        return { error: 'Report not found - product may not have been evaluated yet' };
      }

      // Verify user has access
      const user = await UsersCollection.findOneAsync(userId);
      if (user.role === USER_ROLES.CLIENT) {
        const allocation = await AllocationsCollection.findOneAsync({
          clientId: userId,
          productId: productId
        });
        if (!allocation) {
          return { error: 'Access denied' };
        }
      }

      // Extract data based on report type
      let underlyings, status, basketPerformance, redemption, structure;

      if (isTemplateReport) {
        // Template report structure: data is in templateResults
        const results = report.templateResults || {};
        underlyings = results.underlyings || [];
        status = results.currentStatus || {};
        basketPerformance = results.basketPerformance || {};
        redemption = results.redemption || {};

        // Different templates store structure differently
        structure = results.phoenixStructure ||
                   results.orionStructure ||
                   results.himalayaStructure ||
                   results.sharkNoteStructure ||
                   results.participationStructure ||
                   results.reverseConvertibleStructure ||
                   {};
      } else {
        // Legacy report structure: data is at top level
        underlyings = report.underlyings || [];
        status = {
          hasMatured: report.hasMatured,
          daysToMaturity: report.daysToMaturity,
          productStatus: report.productStatus
        };
        basketPerformance = { current: report.basketPerformance };
        redemption = report.redemption || {};
        structure = {};
      }

      return {
        productId: report.productId,
        productName: report.productName || report.productIsin,
        templateId: report.templateId,
        evaluationDate: report.evaluationDate || status.evaluationDate,

        // Current status
        status: {
          hasMatured: status.hasMatured,
          daysToMaturity: status.daysToMaturity,
          daysToMaturityText: status.daysToMaturityText,
          productStatus: status.productStatus,
          evaluationDateFormatted: status.evaluationDateFormatted
        },

        // Current pricing and performance (from underlyings)
        underlyings: underlyings.map(u => ({
          ticker: u.ticker,
          name: u.name,
          initialPrice: u.initialPrice,
          initialPriceFormatted: u.initialPriceFormatted,
          currentPrice: u.currentPrice,
          currentPriceFormatted: u.currentPriceFormatted,
          performance: u.performance,
          performanceFormatted: u.performanceFormatted,
          isPositive: u.isPositive,
          priceDate: u.priceDate,
          priceDateFormatted: u.priceDateFormatted,
          priceLevelLabel: u.priceLevelLabel,
          distanceToBarrier: u.distanceToBarrier,
          distanceToBarrierFormatted: u.distanceToBarrierFormatted,
          barrierStatus: u.barrierStatus,
          barrierStatusText: u.barrierStatusText,
          isWorstPerforming: u.isWorstPerforming
        })),

        // Basket performance (worst-of)
        basketPerformance: {
          current: basketPerformance.current,
          currentFormatted: basketPerformance.currentFormatted,
          isPositive: basketPerformance.isPositive
        },

        // Product structure (barriers, coupons, etc.)
        structure: {
          capitalProtectionBarrier: structure.capitalProtectionBarrier,
          capitalProtectionBarrierFormatted: structure.capitalProtectionBarrierFormatted,
          autocallBarrier: structure.autocallBarrier,
          autocallBarrierFormatted: structure.autocallBarrierFormatted,
          couponRate: structure.couponRate,
          couponRateFormatted: structure.couponRateFormatted,
          couponBarrier: structure.couponBarrier,
          couponBarrierFormatted: structure.couponBarrierFormatted,
          hasMemory: structure.hasMemory,
          upperBarrier: structure.upperBarrier,
          rebateValue: structure.rebateValue,
          floorLevel: structure.floorLevel,
          participationRate: structure.participationRate,
          gearingFactor: structure.gearingFactor,
          gearingFactorFormatted: structure.gearingFactorFormatted
        },

        // Redemption/payoff information
        redemption: {
          capitalComponent: redemption.capitalComponent,
          capitalComponentFormatted: redemption.capitalComponentFormatted,
          coupon: redemption.coupon,
          couponFormatted: redemption.couponFormatted,
          totalValue: redemption.totalValue,
          totalValueFormatted: redemption.totalValueFormatted,
          barrierBreached: redemption.barrierBreached,
          capitalExplanation: redemption.capitalExplanation,
          formula: redemption.formula
        },

        // Legacy fields for backward compatibility
        indicativeMaturityValue: report.indicativeMaturityValue,
        payoffScenarios: report.payoffScenarios,
        couponHistory: report.couponHistory,
        upcomingCoupons: report.upcomingCoupons,
        barrierStatus: report.barrierStatus,
        nextObservation: report.nextObservation
      };
    },

    /**
     * TOOL: Get observation history (past and future)
     */
    async getObservationHistory(productId, userId) {
      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) {
        return { error: 'Product not found' };
      }

      // Verify access
      const user = await UsersCollection.findOneAsync(userId);
      if (user.role === USER_ROLES.CLIENT) {
        const allocation = await AllocationsCollection.findOneAsync({
          clientId: userId,
          productId: productId
        });
        if (!allocation) {
          return { error: 'Access denied' };
        }
      }

      const now = new Date();
      const schedule = product.observationSchedule || [];

      return {
        productId: product._id,
        productTitle: product.title || product.productName,
        totalObservations: schedule.length,

        past: schedule
          .filter(obs => new Date(obs.observationDate) < now)
          .map(obs => ({
            date: obs.observationDate,
            type: obs.isCallable ? 'Autocall & Coupon' : 'Coupon Only',
            autocallLevel: obs.autocallLevel,
            couponLevel: obs.couponLevel,
            result: obs.result || 'pending'
          })),

        upcoming: schedule
          .filter(obs => new Date(obs.observationDate) >= now)
          .map(obs => ({
            date: obs.observationDate,
            type: obs.isCallable ? 'Autocall & Coupon' : 'Coupon Only',
            autocallLevel: obs.autocallLevel,
            couponLevel: obs.couponLevel
          }))
      };
    },

    /**
     * TOOL: Get current market prices for underlying tickers
     */
    async getUnderlyingPrices(tickers) {
      if (!Array.isArray(tickers) || tickers.length === 0) {
        return { error: 'Invalid tickers array' };
      }

      const prices = await MarketDataCacheCollection.find({
        ticker: { $in: tickers }
      }).fetchAsync();

      return prices.map(p => ({
        ticker: p.ticker,
        price: p.price,
        currency: p.currency,
        lastUpdate: p.lastUpdate,
        source: p.source
      }));
    },

    /**
     * Define tools available to Amber
     */
    _getToolDefinitions() {
      return [
        {
          name: 'get_product_details',
          description: 'Get complete product details including barriers, coupons, protection levels, observation schedule, and structure. Use this when user asks about specific product features, payoff mechanics, or technical details.',
          input_schema: {
            type: 'object',
            properties: {
              product_id: {
                type: 'string',
                description: 'The MongoDB _id of the product'
              }
            },
            required: ['product_id']
          }
        },
        {
          name: 'get_product_report',
          description: 'Get latest report with current market prices, performance calculations, indicative maturity values, payoff scenarios, and barrier status. Use this when user asks about current value, returns, or market performance.',
          input_schema: {
            type: 'object',
            properties: {
              product_id: {
                type: 'string',
                description: 'The MongoDB _id of the product'
              }
            },
            required: ['product_id']
          }
        },
        {
          name: 'get_observation_history',
          description: 'Get complete observation history (past and future dates) with autocall and coupon levels. Use when user asks about observation dates, past events, or upcoming milestones.',
          input_schema: {
            type: 'object',
            properties: {
              product_id: {
                type: 'string',
                description: 'The MongoDB _id of the product'
              }
            },
            required: ['product_id']
          }
        },
        {
          name: 'get_underlying_prices',
          description: 'Get current market prices for specific underlying tickers. Use when user asks about current stock/index prices.',
          input_schema: {
            type: 'object',
            properties: {
              tickers: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of ticker symbols (e.g., ["AAPL", "TSLA"])'
              }
            },
            required: ['tickers']
          }
        }
      ];
    },

    /**
     * Build system prompt for Amber
     */
    _buildSystemPrompt(contextData) {
      const { user, dataScope, productCount, observationCount } = contextData;

      return `You are Amber, the AI assistant for Ambervision - a structured products investment platform.

**Your Role:**
You help users understand their structured product portfolio, answer questions about observations, payoffs, and provide insights into their investments.

**Current User:**
- Name: ${user.firstName} ${user.lastName}
- Role: ${user.role}
- Email: ${user.email}
- Access Scope: ${dataScope} (${productCount} products visible)

**Capabilities:**
- Explain structured product mechanics (autocallables, reverse convertibles, Phoenix, Shark Notes, etc.)
- Summarize upcoming observations and payment dates
- Describe payoff scenarios and capital protection mechanisms
- Provide insights on portfolio diversification and risk
- Answer questions about specific products by ISIN or name
- Fetch detailed product information, reports, and market data on-demand using available tools

**Available Tools:**
You have access to tools that fetch detailed information:
- get_product_details: Full product structure (barriers, coupons, protection, observation schedule)
- get_product_report: Latest market data, performance, indicative values, scenarios
- get_observation_history: Complete past and future observation schedule
- get_underlying_prices: Current market prices for stocks/indices

**Guidelines:**
- Be professional yet friendly and approachable
- Explain complex financial concepts in clear, simple terms
- When discussing payoffs, always mention that these are indicative and subject to market conditions
- Never provide investment advice or recommendations
- If asked about features outside your knowledge (market predictions, specific trades), politely redirect
- Use the user's preferred language: ${user.preferredLanguage}
- **IMPORTANT**: When user asks about specific product details, ALWAYS use tools to fetch accurate real-time data

**Important:**
- You have access to ${productCount} products in this user's scope
- ${observationCount} upcoming observations in the next 90 days
- Always reference specific products by their ISIN or title when discussing details
- Use tools to get detailed information rather than making assumptions`;
    },

    /**
     * Call Anthropic API with prompt caching and tool support
     */
    async callAnthropicAPI(contextData, conversationHistory, userMessage, userId) {
      if (!ANTHROPIC_API_KEY) {
        throw new Meteor.Error('anthropic-config-error', 'Anthropic API key not configured');
      }

      const systemPrompt = this._buildSystemPrompt(contextData);
      const tools = this._getToolDefinitions();

      try {
        console.log('[Amber] Calling Anthropic API with prompt caching and tools...');

        let messages = [
          ...conversationHistory,
          {
            role: 'user',
            content: userMessage
          }
        ];

        let totalUsage = {
          input: 0,
          output: 0,
          cached: 0,
          cacheCreation: 0
        };

        // Tool calling loop (max 5 iterations to prevent infinite loops)
        let iterationCount = 0;
        const MAX_ITERATIONS = 5;

        while (iterationCount < MAX_ITERATIONS) {
          iterationCount++;

          const response = await HTTP.post(ANTHROPIC_API_URL, {
            headers: {
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'prompt-caching-2024-07-31',
              'content-type': 'application/json'
            },
            data: {
              model: ANTHROPIC_MODEL,
              max_tokens: 4000,
              tools: tools,
              system: [
                {
                  type: 'text',
                  text: systemPrompt,
                  cache_control: { type: 'ephemeral' }
                },
                {
                  type: 'text',
                  text: `**Portfolio Context:**\n\n${JSON.stringify(contextData, null, 2)}`,
                  cache_control: { type: 'ephemeral' }
                }
              ],
              messages: messages
            }
          });

          const usage = response.data.usage || {};
          totalUsage.input += usage.input_tokens || 0;
          totalUsage.output += usage.output_tokens || 0;
          totalUsage.cached += usage.cache_read_input_tokens || 0;
          totalUsage.cacheCreation += usage.cache_creation_input_tokens || 0;

          console.log(`[Amber] API call ${iterationCount} - Token usage:`, {
            input: usage.input_tokens || 0,
            output: usage.output_tokens || 0,
            cached: usage.cache_read_input_tokens || 0,
            stop_reason: response.data.stop_reason
          });

          // Check stop reason
          if (response.data.stop_reason === 'end_turn') {
            // Final response - extract text
            const textContent = response.data.content
              .filter(block => block.type === 'text')
              .map(block => block.text)
              .join('\n');

            return {
              content: textContent,
              usage: totalUsage
            };
          } else if (response.data.stop_reason === 'tool_use') {
            // Extract tool calls and text
            const assistantMessage = { role: 'assistant', content: response.data.content };
            messages.push(assistantMessage);

            // Execute tools
            const toolResults = [];
            for (const block of response.data.content) {
              if (block.type === 'tool_use') {
                console.log(`[Amber] Executing tool: ${block.name}`, block.input);

                let result;
                try {
                  switch (block.name) {
                    case 'get_product_details':
                      result = await this.getProductDetails(block.input.product_id, userId);
                      break;
                    case 'get_product_report':
                      result = await this.getProductReport(block.input.product_id, userId);
                      break;
                    case 'get_observation_history':
                      result = await this.getObservationHistory(block.input.product_id, userId);
                      break;
                    case 'get_underlying_prices':
                      result = await this.getUnderlyingPrices(block.input.tickers);
                      break;
                    default:
                      result = { error: 'Unknown tool' };
                  }
                } catch (error) {
                  result = { error: error.message };
                }

                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify(result)
                });
              }
            }

            // Add tool results to conversation
            messages.push({
              role: 'user',
              content: toolResults
            });

            // Continue loop to get final response
          } else {
            // Unexpected stop reason
            throw new Error(`Unexpected stop_reason: ${response.data.stop_reason}`);
          }
        }

        throw new Error('Max tool calling iterations reached');
      } catch (error) {
        console.error('[Amber] Anthropic API error:', error);

        if (error.response) {
          const status = error.response.statusCode;
          const message = error.response.data?.error?.message || 'Unknown error';

          if (status === 401) {
            throw new Meteor.Error('anthropic-auth-failed', 'Invalid Anthropic API key');
          } else if (status === 429) {
            throw new Meteor.Error('anthropic-rate-limit', 'API rate limit exceeded');
          } else {
            throw new Meteor.Error('anthropic-api-error', `API error: ${message}`);
          }
        }

        throw new Meteor.Error('anthropic-call-failed', `Failed to call API: ${error.message}`);
      }
    },

    /**
     * Process chat message and return response
     */
    async chat(userId, message, sessionId) {
      check(userId, String);
      check(message, String);
      check(sessionId, Match.Maybe(String));

      const user = await UsersCollection.findOneAsync(userId);
      if (!user) {
        throw new Meteor.Error('user-not-found', 'User not found');
      }

      // Generate session ID if not provided
      const actualSessionId = sessionId || `amber-${userId}-${Date.now()}`;

      // Find or create conversation
      let conversation = await AmberConversationsCollection.findOneAsync({
        sessionId: actualSessionId,
        userId: userId
      });

      const now = new Date();
      let needsContextRefresh = false;

      if (!conversation) {
        // Create new conversation
        conversation = {
          userId: userId,
          sessionId: actualSessionId,
          messages: [],
          contextSummary: {
            productCount: 0,
            dataScope: user.role,
            lastCacheRefresh: null,
            contextTokens: 0
          },
          metadata: {
            userRole: user.role,
            userEmail: user.email,
            userName: `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim()
          },
          status: 'active',
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 30 days
        };

        const conversationId = await AmberConversationsCollection.insertAsync(conversation);
        conversation._id = conversationId;
        needsContextRefresh = true;
      } else {
        // Check if cache needs refresh (older than 5 minutes)
        if (!conversation.contextSummary.lastCacheRefresh ||
            (now - conversation.contextSummary.lastCacheRefresh) > CACHE_DURATION_MS) {
          needsContextRefresh = true;
        }
      }

      // Build or reuse context
      let contextData;
      if (needsContextRefresh) {
        console.log('[Amber] Building fresh context for user:', userId);
        contextData = await this.buildUserContext(userId);
      } else {
        console.log('[Amber] Using cached context for user:', userId);
        // In practice, context would be stored, but for simplicity we rebuild
        // In production, store context in conversation document
        contextData = await this.buildUserContext(userId);
      }

      // Prepare conversation history (exclude user message being sent)
      const conversationHistory = conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Call Anthropic API with tool support
      const apiResponse = await this.callAnthropicAPI(
        contextData,
        conversationHistory,
        message,
        userId
      );

      // Add user message
      const userMessageObj = {
        _id: `msg-${Date.now()}-user`,
        role: 'user',
        content: message,
        timestamp: now,
        tokens: {
          input: apiResponse.usage.input,
          output: 0,
          cached: 0
        }
      };

      // Add assistant response
      const assistantMessageObj = {
        _id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: apiResponse.content,
        timestamp: new Date(),
        tokens: {
          input: 0,
          output: apiResponse.usage.output,
          cached: apiResponse.usage.cached
        }
      };

      // Update conversation
      await AmberConversationsCollection.updateAsync(conversation._id, {
        $push: {
          messages: {
            $each: [userMessageObj, assistantMessageObj]
          }
        },
        $set: {
          updatedAt: new Date(),
          'contextSummary.lastCacheRefresh': needsContextRefresh ? now : conversation.contextSummary.lastCacheRefresh,
          'contextSummary.productCount': contextData.productCount,
          'contextSummary.contextTokens': apiResponse.usage.input + (apiResponse.usage.cacheCreation || 0)
        }
      });

      return {
        sessionId: actualSessionId,
        message: apiResponse.content,
        usage: apiResponse.usage,
        conversationId: conversation._id
      };
    }
  };

  // Meteor methods
  Meteor.methods({
    /**
     * Send a message to Amber and get a response
     */
    async 'amber.chat'(message, conversationId, authSessionId) {
      check(message, String);
      check(conversationId, Match.Maybe(String));
      check(authSessionId, String);

      // Validate session and get user
      const { SessionHelpers } = require('./sessions');
      const session = await SessionHelpers.validateSession(authSessionId);
      const userId = session.userId;

      return await AmberService.chat(userId, message, conversationId);
    },

    /**
     * Archive a conversation
     */
    async 'amber.archiveConversation'(conversationId, authSessionId) {
      check(conversationId, String);
      check(authSessionId, String);

      // Validate session and get user
      const { SessionHelpers } = require('./sessions');
      const session = await SessionHelpers.validateSession(authSessionId);
      const userId = session.userId;

      return await AmberConversationsCollection.updateAsync(
        {
          sessionId: conversationId,
          userId: userId
        },
        {
          $set: {
            status: 'archived',
            updatedAt: new Date()
          }
        }
      );
    },

    /**
     * Get conversation by session ID
     */
    async 'amber.getConversation'(conversationId, authSessionId) {
      check(conversationId, String);
      check(authSessionId, String);

      // Validate session and get user
      const { SessionHelpers } = require('./sessions');
      const session = await SessionHelpers.validateSession(authSessionId);
      const userId = session.userId;

      return await AmberConversationsCollection.findOneAsync({
        sessionId: conversationId,
        userId: userId
      });
    }
  });
}
