import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { HTTP } from 'meteor/http';
import { UnderlyingsAnalysisCollection, buildUnderlyingsAnalysis, isProductLiveAsOf } from './underlyingsAnalysis';
import { EODApiHelpers } from './eodApi';
import { ReportsCollection } from './reports';
import { TemplateReportsCollection } from './templateReports';
import { ProductsCollection } from './products';
import { PMSHoldingsCollection } from './pmsHoldings';
import { ProductPricesCollection } from './productPrices';

/**
 * Risk Analysis Reports Collection
 * Stores AI-generated risk analysis reports for underlyings below protection barriers
 */
export const RiskAnalysisReportsCollection = new Mongo.Collection('riskAnalysisReports');

/**
 * Product Commentary Collection
 * Stores AI-generated investment advisor commentary for individual products
 */
export const ProductCommentaryCollection = new Mongo.Collection('productCommentary');

// Anthropic API configuration
const ANTHROPIC_API_KEY = Meteor.settings.private?.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-5';

if (Meteor.isServer) {
  /**
   * Call Anthropic Claude API with web search capability
   * @param {string} prompt - The prompt to send to Claude
   * @param {number} maxTokens - Maximum tokens for response
   * @returns {Promise<string>} - Claude's response text
   */
  async function callAnthropicAPI(prompt, maxTokens = 2000) {
    if (!ANTHROPIC_API_KEY) {
      throw new Meteor.Error('anthropic-config-error', 'Anthropic API key not configured in settings.json');
    }

    try {
      console.log('[RiskAnalysis] Calling Anthropic API...');

      const response = await HTTP.post(ANTHROPIC_API_URL, {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        data: {
          model: ANTHROPIC_MODEL,
          // Sonnet 5 thinks adaptively (budget_tokens is rejected); max_tokens
          // covers thinking + response, so add headroom above the response size.
          max_tokens: maxTokens + 2048,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          thinking: {
            type: 'adaptive'
          }
        }
      });

      if (response.data && response.data.content && response.data.content.length > 0) {
        // Extract text from response (filter out thinking blocks)
        const textContent = response.data.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');

        return textContent;
      }

      throw new Error('Invalid response from Anthropic API');
    } catch (error) {
      console.error('[RiskAnalysis] Anthropic API error:', error);

      if (error.response) {
        const status = error.response.statusCode;
        const message = error.response.data?.error?.message || 'Unknown error';

        if (status === 401) {
          throw new Meteor.Error('anthropic-auth-failed', 'Invalid Anthropic API key');
        } else if (status === 429) {
          throw new Meteor.Error('anthropic-rate-limit', 'Anthropic API rate limit exceeded');
        } else {
          throw new Meteor.Error('anthropic-api-error', `Anthropic API error: ${message}`);
        }
      }

      throw new Meteor.Error('anthropic-call-failed', `Failed to call Anthropic API: ${error.message}`);
    }
  }

  /**
   * Generate risk analysis for a single at-risk underlying
   * @param {Object} underlying - Underlying data from analysis collection
   * @param {string} language - Language for analysis ('en' or 'fr')
   * @returns {Promise<Object>} - Analysis result with AI-generated text
   */
  async function analyzeUnderlyingRisk(underlying, language = 'en') {
    const {
      symbol,
      name,
      currentPrice,
      initialPrice,
      performance,
      protectionBarrierLevel,
      distanceToBarrier,
      daysToFinalObservation,
      productTitle,
      productIsin,
      exchange
    } = underlying;

    // Determine risk level based on distance to barrier
    let riskLevel = 'moderate';
    if (distanceToBarrier < -5) {
      riskLevel = 'critical';
    } else if (distanceToBarrier < 0) {
      riskLevel = 'high';
    }

    // Calculate what price would breach the barrier
    const barrierPrice = initialPrice * (1 + (protectionBarrierLevel - 100) / 100);
    const priceToBarrier = currentPrice - barrierPrice;
    const percentToBarrier = (priceToBarrier / currentPrice) * 100;

    // Fetch recent news from EOD API
    let newsSection = '';
    try {
      console.log(`[RiskAnalysis] Fetching news for ${symbol}...`);
      const newsArticles = await EODApiHelpers.getSecurityNews(symbol, exchange, 5);

      if (newsArticles && newsArticles.length > 0) {
        newsSection = '\nRECENT NEWS (from EOD Historical Data):\n';
        newsArticles.forEach((article, idx) => {
          const date = article.date ? new Date(article.date).toLocaleDateString() : 'Recent';
          newsSection += `\n${idx + 1}. [${date}] ${article.title}\n`;
          if (article.content) {
            // Truncate long content to first 200 chars
            const content = article.content.length > 200
              ? article.content.substring(0, 200) + '...'
              : article.content;
            newsSection += `   ${content}\n`;
          }
          if (article.sentiment) {
            newsSection += `   Sentiment: ${article.sentiment}\n`;
          }
        });
        newsSection += '\n';
      } else {
        newsSection = '\nRECENT NEWS: No recent news available from data provider.\n\n';
      }
    } catch (error) {
      console.warn(`[RiskAnalysis] Failed to fetch news for ${symbol}:`, error.message);
      newsSection = '\nRECENT NEWS: Unable to fetch news data.\n\n';
    }

    // Build detailed prompt for Claude
    const prompt = `You are a professional financial analyst preparing a risk assessment for structured products held across multiple client portfolios. Your analysis will be read by risk officers and senior management.

IMPORTANT - BARRIER TERMINOLOGY EXPLANATION:
- A "70% protection barrier" means the stock can drop to 70% of its initial strike price before breaching (i.e., a maximum 30% decline is protected)
- "Distance to Barrier" shows how far the current price is from the barrier level:
  - NEGATIVE distance (e.g., -5.2%) means the stock is ALREADY BELOW the barrier by that amount
  - POSITIVE distance (e.g., +10%) means the stock still has that much cushion before reaching the barrier

UNDERLYING DETAILS:
- Company: ${name} (${symbol})
- Current Price: ${currentPrice.toFixed(2)}
- Initial Strike Price: ${initialPrice.toFixed(2)}
- Current Performance: ${performance >= 0 ? '+' : ''}${performance.toFixed(2)}% (from initial strike)
- Protection Barrier Level: ${protectionBarrierLevel}% of initial (barrier is breached when stock drops below ${protectionBarrierLevel}% of strike)
- Barrier Price: ${barrierPrice.toFixed(2)} (the actual price level at which barrier is breached)
- Distance to Barrier: ${distanceToBarrier >= 0 ? '+' : ''}${distanceToBarrier.toFixed(1)}% ${distanceToBarrier < 0 ? '(ALREADY BELOW BARRIER)' : '(still above barrier)'}
- Days to Final Observation: ${daysToFinalObservation} days (${(daysToFinalObservation / 365).toFixed(1)} years)
- Affected Product: ${productTitle} (${productIsin})
${newsSection}
TASK:
Write a concise risk analysis of 2-3 short paragraphs (180-260 words total). Cover, in flowing prose:
- Where the underlying stands relative to the barrier (in percentage and absolute price terms) and whether the margin is narrow or substantial
- The key factors explaining the performance, drawing on the news above with specific events and dates when available (or general sector context if no news)
- Whether the ${daysToFinalObservation} days remaining leave room for recovery, and the protection features that support patience until maturity

WRITING STYLE - VERY IMPORTANT:
- Write like an experienced human analyst jotting a note for a colleague: plain flowing prose, natural transitions, varied sentence length
- NO markdown of any kind: no headings, no bold (**), no bullet points, no numbered lists, no section labels
- Do not announce the structure ("In this first paragraph...", "In conclusion...") and avoid formulaic filler ("It is important to note", "In today's dynamic market environment")
- Tone: professional, objective, but cautiously optimistic; acknowledge real risks while noting the protection mechanisms
- Use specific data points and dates from the news provided; avoid jargon
- Do NOT make specific price predictions
${language === 'fr' ? `
LANGUAGE: Write the ENTIRE analysis in FRENCH (Français). All text must be in French.` : ''}
Write the analysis now:`;

    try {
      console.log(`[RiskAnalysis] Analyzing ${symbol} (${name})...`);

      const analysisText = await callAnthropicAPI(prompt, 3500);

      console.log(`[RiskAnalysis] Analysis complete for ${symbol}`);

      return {
        symbol,
        companyName: name,
        currentPrice,
        strikePrice: initialPrice,
        performance,
        barrierLevel: protectionBarrierLevel,
        barrierPrice,
        distanceToBarrier,
        daysRemaining: daysToFinalObservation,
        riskLevel,
        analysis: analysisText,
        generatedAt: new Date()
      };
    } catch (error) {
      console.error(`[RiskAnalysis] Failed to analyze ${symbol}:`, error);

      // Return partial result with error
      return {
        symbol,
        companyName: name,
        currentPrice,
        strikePrice: initialPrice,
        performance,
        barrierLevel: protectionBarrierLevel,
        barrierPrice,
        distanceToBarrier,
        daysRemaining: daysToFinalObservation,
        riskLevel,
        analysis: `Analysis unavailable: ${error.message}`,
        error: error.message,
        generatedAt: new Date()
      };
    }
  }

  /**
   * Normalize a product price to percent-of-par.
   * Some legacy productPrices records are stored in decimal format (0.9571 = 95.71%)
   * while most are percent-of-par (95.71). A live product quoted below 5% of par is
   * implausible, so values under 5 are treated as decimal format.
   */
  function normalizePctOfPar(price) {
    if (price == null) return null;
    return price > 0 && price < 5 ? price * 100 : price;
  }

  /**
   * Get the latest bank price per ISIN from productPrices.
   * @param {Array<string>} isins - Uppercase ISINs
   * @param {Date|null} asOfDate - Only consider prices on or before this date
   * @returns {Promise<Map>} - Map of isin -> { price, priceDate, currency }
   */
  async function getLatestBankPrices(isins, asOfDate = null) {
    if (isins.length === 0) return new Map();

    const match = { isin: { $in: isins }, isActive: true };
    if (asOfDate) match.priceDate = { $lte: asOfDate };

    const rows = await ProductPricesCollection.rawCollection().aggregate([
      { $match: match },
      { $sort: { priceDate: -1, uploadDate: -1 } },
      {
        $group: {
          _id: '$isin',
          price: { $first: '$price' },
          priceDate: { $first: '$priceDate' },
          currency: { $first: '$currency' }
        }
      }
    ]).toArray();

    return new Map(rows.map(r => [r._id, r]));
  }

  /**
   * Compute the cost baseline per product from PMS holdings (what clients actually
   * paid), since not all products are issued at par. costPrice is stored in
   * normalized decimal format (1.0 = 100%); the returned baseline is percent-of-par.
   * Uses isLatest holdings even in as-of mode: cost price is an acquisition cost and
   * essentially static, so the latest snapshot is a valid baseline for any date.
   * @param {Array<string>} productIds
   * @returns {Promise<Map>} - Map of productId -> baseline in percent-of-par (e.g. 95.71)
   */
  async function getCostBaselines(productIds) {
    if (productIds.length === 0) return new Map();

    const holdings = await PMSHoldingsCollection.find(
      { linkedProductId: { $in: productIds }, isLatest: true, isActive: true },
      { fields: { linkedProductId: 1, costPrice: 1, portfolioCode: 1 } }
    ).fetchAsync();

    const costsByProduct = new Map();
    for (const h of holdings) {
      // Exclude pre-aggregated roll-up copies to avoid double counting
      if (h.portfolioCode === 'CONSOLIDATED') continue;
      if (!(h.costPrice > 0)) continue;
      if (!costsByProduct.has(h.linkedProductId)) costsByProduct.set(h.linkedProductId, []);
      costsByProduct.get(h.linkedProductId).push(h.costPrice);
    }

    const baselines = new Map();
    for (const [productId, costs] of costsByProduct) {
      const avgCost = costs.reduce((sum, c) => sum + c, 0) / costs.length;
      baselines.set(productId, avgCost * 100);
    }
    return baselines;
  }

  /**
   * Generate an explanation for a declining underlying of a product that lost
   * significant value since launch. Lighter sibling of analyzeUnderlyingRisk:
   * works without barrier data (non-Phoenix templates) and focuses on explaining
   * the decline rather than barrier mechanics.
   * @param {Object} underlying - { symbol, name, exchange, performance, currentPrice,
   *   initialPrice, protectionBarrierLevel?, distanceToBarrier?, productTitle,
   *   productIsin, productLossPercent }
   * @param {string} language - 'en' or 'fr'
   * @returns {Promise<Object>} - { symbol, companyName, currentPrice, performance, analysis }
   */
  async function analyzeDecliningUnderlying(underlying, language = 'en') {
    const {
      symbol,
      name,
      exchange,
      performance,
      currentPrice,
      initialPrice,
      protectionBarrierLevel,
      distanceToBarrier,
      productTitle,
      productIsin,
      productLossPercent
    } = underlying;

    // Fetch recent news from EOD API
    let newsSection = '';
    try {
      console.log(`[RiskAnalysis] Fetching news for ${symbol}...`);
      const newsArticles = await EODApiHelpers.getSecurityNews(symbol, exchange, 5);

      if (newsArticles && newsArticles.length > 0) {
        newsSection = '\nRECENT NEWS (from EOD Historical Data):\n';
        newsArticles.forEach((article, idx) => {
          const date = article.date ? new Date(article.date).toLocaleDateString() : 'Recent';
          newsSection += `\n${idx + 1}. [${date}] ${article.title}\n`;
          if (article.content) {
            const content = article.content.length > 200
              ? article.content.substring(0, 200) + '...'
              : article.content;
            newsSection += `   ${content}\n`;
          }
          if (article.sentiment) {
            newsSection += `   Sentiment: ${article.sentiment}\n`;
          }
        });
        newsSection += '\n';
      } else {
        newsSection = '\nRECENT NEWS: No recent news available from data provider.\n\n';
      }
    } catch (error) {
      console.warn(`[RiskAnalysis] Failed to fetch news for ${symbol}:`, error.message);
      newsSection = '\nRECENT NEWS: Unable to fetch news data.\n\n';
    }

    const barrierSection = (protectionBarrierLevel != null && distanceToBarrier != null)
      ? `- Protection Barrier Level: ${protectionBarrierLevel}% of initial strike
- Distance to Barrier: ${distanceToBarrier >= 0 ? '+' : ''}${distanceToBarrier.toFixed(1)}% ${distanceToBarrier < 0 ? '(ALREADY BELOW BARRIER)' : '(still above barrier)'}
`
      : '';

    const prompt = `You are a professional financial analyst explaining why a structured product has lost value since launch. Your analysis will be read by risk officers and senior management.

CONTEXT:
The product "${productTitle}" (${productIsin}) has lost ${Math.abs(productLossPercent).toFixed(1)}% of its value since launch. The underlying below is one of the decliners driving that loss.

UNDERLYING DETAILS:
- Company: ${name} (${symbol})
${currentPrice != null ? `- Current Price: ${currentPrice.toFixed(2)}\n` : ''}${initialPrice != null ? `- Initial Strike Price: ${initialPrice.toFixed(2)}\n` : ''}- Performance Since Initial Strike: ${performance.toFixed(2)}%
${barrierSection}${newsSection}
TASK:
Write a concise analysis of 2 short paragraphs (100-180 words total). Cover, in flowing prose:
- The key factors explaining the decline, drawing on the news above with specific events and dates when available (or general sector context if no news)
- A balanced view of recovery considerations, noting relevant positive factors without minimizing the risks

WRITING STYLE - VERY IMPORTANT:
- Write like an experienced human analyst jotting a note for a colleague: plain flowing prose, natural transitions, varied sentence length
- NO markdown of any kind: no headings, no bold (**), no bullet points, no numbered lists, no section labels
- Do not announce the structure ("In this first paragraph...", "In conclusion...") and avoid formulaic filler ("It is important to note", "In today's dynamic market environment")
- Tone: professional, objective, but cautiously optimistic
- Use specific data points and dates from the news provided; avoid jargon
- Do NOT make specific price predictions
${language === 'fr' ? `
LANGUAGE: Write the ENTIRE analysis in FRENCH (Français). All text must be in French.` : ''}
Write the analysis now:`;

    try {
      console.log(`[RiskAnalysis] Analyzing declining underlying ${symbol} (${name})...`);
      const analysisText = await callAnthropicAPI(prompt, 3500);
      console.log(`[RiskAnalysis] Declining-underlying analysis complete for ${symbol}`);

      return {
        symbol,
        companyName: name,
        currentPrice,
        performance,
        analysis: analysisText,
        generatedAt: new Date()
      };
    } catch (error) {
      console.error(`[RiskAnalysis] Failed to analyze declining underlying ${symbol}:`, error);
      return {
        symbol,
        companyName: name,
        currentPrice,
        performance,
        analysis: `Analysis unavailable: ${error.message}`,
        error: error.message,
        generatedAt: new Date()
      };
    }
  }

  /**
   * Build the "products down >=15% since launch" section of the risk report.
   * Flags every live product (any template) whose latest bank price is at least
   * 15% below the clients' average cost (fallback: par), then attaches an
   * explanation comment to each declining underlying. Comments are generated
   * once per unique symbol across the whole report and copied everywhere else.
   * @param {Object} params - { asOfDate, analysisData, language, commentBySymbol }
   *   commentBySymbol: Map of symbol -> analysis text, seeded from the at-risk
   *   analyses; this function adds newly generated comments to it.
   * @returns {Promise<Array>} - productsDownSinceLaunch entries, worst loss first
   */
  async function buildProductsDownSinceLaunch({ asOfDate, analysisData, language, commentBySymbol }) {
    const LOSS_THRESHOLD = -15;

    // 1. Live products, all templates
    let products;
    if (asOfDate) {
      const allProducts = await ProductsCollection.find({}).fetchAsync();
      products = allProducts.filter(p => isProductLiveAsOf(p, asOfDate));
    } else {
      products = await ProductsCollection.find({
        $or: [
          { status: 'live' },
          { status: 'Live' },
          { status: 'active' },
          { status: 'Active' },
          { productStatus: 'live' },
          { productStatus: 'Live' },
          { productStatus: 'active' },
          { productStatus: 'Active' }
        ]
      }).fetchAsync();
    }

    // 2. Latest bank prices + cost baselines
    const isins = [...new Set(products.map(p => p.isin && p.isin.toUpperCase()).filter(Boolean))];
    const priceMap = await getLatestBankPrices(isins, asOfDate);
    const baselines = await getCostBaselines(products.map(p => p._id));

    // 3. Flag products down >= 15% vs their cost baseline
    let skippedNoPrice = 0;
    const flagged = [];
    for (const product of products) {
      const isin = product.isin && product.isin.toUpperCase();
      const priceRecord = isin ? priceMap.get(isin) : null;
      if (!priceRecord) {
        skippedNoPrice++;
        continue;
      }

      const latestPrice = normalizePctOfPar(priceRecord.price);
      const baselineCost = baselines.get(product._id) || 100;
      const lossPercent = (latestPrice / baselineCost - 1) * 100;
      if (lossPercent > LOSS_THRESHOLD) continue;

      flagged.push({
        product,
        entry: {
          productId: product._id,
          productTitle: product.title || product.name || isin,
          productIsin: isin,
          currency: product.currency || priceRecord.currency || null,
          template: product.template || product.templateId || null,
          latestPrice,
          priceDate: priceRecord.priceDate,
          baselineCost,
          baselineSource: baselines.has(product._id) ? 'pms_holdings' : 'default_100',
          lossPercent
        }
      });
    }

    if (skippedNoPrice > 0) {
      console.log(`[RiskAnalysis] Products-down check: ${skippedNoPrice} live products skipped (no ISIN or no bank price)`);
    }
    console.log(`[RiskAnalysis] Products-down check: ${flagged.length} of ${products.length} live products down ${Math.abs(LOSS_THRESHOLD)}%+ since launch`);

    // 4. Gather declining underlyings per flagged product
    for (const { product, entry } of flagged) {
      let underlyings = [];
      let underlyingsSource = 'none';

      // (a) Rows already computed for the underlyings analysis (Phoenix products),
      //     correct for both live and as-of mode
      const analysisRows = (analysisData?.underlyings || []).filter(u => u.productId === product._id);
      if (analysisRows.length > 0) {
        underlyingsSource = 'underlyingsAnalysis';
        underlyings = analysisRows.map(u => ({
          symbol: u.symbol,
          name: u.name,
          exchange: u.exchange || null,
          performance: u.performance,
          currentPrice: u.currentPrice ?? null,
          initialPrice: u.initialPrice ?? null,
          protectionBarrierLevel: u.protectionBarrierLevel ?? null,
          distanceToBarrier: u.distanceToBarrier ?? null
        }));
      } else {
        // (b) Latest evaluation report (any template exposes templateResults.underlyings)
        const templateReport = await TemplateReportsCollection.findOneAsync(
          { productId: product._id },
          { sort: { createdAt: -1 } }
        );
        const reportUnderlyings = templateReport?.templateResults?.underlyings || [];
        if (reportUnderlyings.length > 0) {
          underlyingsSource = 'templateReport';
          if (asOfDate) entry.dataAsOfCaveat = true; // report data is latest-known, not as-of
          underlyings = reportUnderlyings.map(u => {
            const fullTicker = u.fullTicker || u.ticker || '';
            return {
              symbol: (u.ticker || fullTicker).split('.')[0],
              name: u.name || u.ticker || fullTicker,
              exchange: fullTicker.includes('.') ? fullTicker.split('.')[1] : null,
              performance: u.performance ?? null,
              currentPrice: u.currentPrice ?? null,
              initialPrice: u.initialPrice ?? u.strike ?? null,
              protectionBarrierLevel: null,
              distanceToBarrier: null
            };
          });
        }
      }

      entry.underlyingsSource = underlyingsSource;
      if (underlyingsSource === 'none') {
        entry.underlyingsDataUnavailable = true;
        entry.underlyings = [];
        continue;
      }

      const declining = underlyings.filter(u => u.symbol && u.performance != null && u.performance < 0);
      if (declining.length === 0) {
        entry.note = 'no-declining-underlyings';
        entry.underlyings = [];
        continue;
      }

      entry.underlyings = declining;
    }

    // 5. Generate one comment per unique symbol not already analyzed elsewhere
    const pendingBySymbol = new Map();
    for (const { entry } of flagged) {
      for (const u of entry.underlyings || []) {
        if (!commentBySymbol.has(u.symbol) && !pendingBySymbol.has(u.symbol)) {
          pendingBySymbol.set(u.symbol, {
            ...u,
            productTitle: entry.productTitle,
            productIsin: entry.productIsin,
            productLossPercent: entry.lossPercent
          });
        }
      }
    }

    if (pendingBySymbol.size > 0) {
      console.log(`[RiskAnalysis] Generating ${pendingBySymbol.size} new declining-underlying comments (others copied)`);
      const newAnalyses = await Promise.all(
        [...pendingBySymbol.values()].map(u => analyzeDecliningUnderlying(u, language))
      );
      for (const a of newAnalyses) {
        commentBySymbol.set(a.symbol, a.analysis);
      }
    }

    // 6. Attach comments (first generation site is the pending one; everything else is a copy)
    const firstUseConsumed = new Set();
    for (const { entry } of flagged) {
      entry.underlyings = (entry.underlyings || []).map(u => {
        const generatedHere = pendingBySymbol.has(u.symbol) && !firstUseConsumed.has(u.symbol);
        if (generatedHere) firstUseConsumed.add(u.symbol);
        return {
          symbol: u.symbol,
          name: u.name,
          performance: u.performance,
          currentPrice: u.currentPrice,
          initialPrice: u.initialPrice,
          analysis: commentBySymbol.get(u.symbol) || 'Analysis unavailable',
          reused: !generatedHere
        };
      });
    }

    return flagged
      .map(f => f.entry)
      .sort((a, b) => a.lossPercent - b.lossPercent);
  }

  /**
   * Generate executive summary for the entire risk report
   * @param {Array} analyses - Array of individual stock analyses
   * @param {string} language - Language for summary ('en' or 'fr')
   * @returns {Promise<Object>} - Executive summary
   */
  async function generateExecutiveSummary(analyses, language = 'en') {
    // Calculate summary statistics
    const totalAtRisk = analyses.length;
    const criticalCount = analyses.filter(a => a.riskLevel === 'critical').length;
    const highCount = analyses.filter(a => a.riskLevel === 'high').length;
    const averageDistance = analyses.reduce((sum, a) => sum + a.distanceToBarrier, 0) / totalAtRisk;
    const averageDaysRemaining = analyses.reduce((sum, a) => sum + a.daysRemaining, 0) / totalAtRisk;

    // Prepare data for Claude
    const analysesData = analyses.map(a => ({
      symbol: a.symbol,
      company: a.companyName,
      distanceToBarrier: a.distanceToBarrier.toFixed(1),
      daysRemaining: a.daysRemaining,
      riskLevel: a.riskLevel
    }));

    const prompt = `You are a Chief Risk Officer preparing an executive summary for senior management about at-risk positions across multiple client portfolios holding structured products.

IMPORTANT CONTEXT - BARRIER TERMINOLOGY:
- A "70% protection barrier" means the stock can drop to 70% of its initial price (a 30% decline) before breaching
- A "-5% distance to barrier" means the stock is currently 5% BELOW the barrier level (already breached)
- A "+10% distance to barrier" means the stock is currently 10% ABOVE the barrier (still safe, with 10% cushion)

RISK OVERVIEW ACROSS ALL PORTFOLIOS:
- Underlyings Currently Below Their Protection Barriers: ${totalAtRisk} (out of many more underlyings in the portfolio that are performing above their barriers)
- Critical Risk (>5% below barrier): ${criticalCount}
- High Risk (0-5% below barrier): ${highCount}
- Moderate Risk: ${totalAtRisk - criticalCount - highCount}
- Average Distance to Barrier: ${averageDistance >= 0 ? '+' : ''}${averageDistance.toFixed(1)}%
- Average Days to Final Observation: ${averageDaysRemaining} days

NOTE: This report only includes underlyings that are CURRENTLY below their protection barriers. The majority of underlyings across the portfolio are performing above their barriers and are not included in this risk report.

AT-RISK POSITIONS:
${JSON.stringify(analysesData, null, 2)}

TASK:
Write an executive summary of 2-3 short paragraphs (150-250 words) covering:
- Overall assessment of risk level for the AT-RISK positions (not the entire portfolio)
- Be clear that these ${totalAtRisk} underlyings represent only the problematic positions, not the entire portfolio
- The most concerning positions (critical/high risk) and any common factors across them
- Mitigating factors (time remaining, protection features, recovery potential)

WRITING STYLE - VERY IMPORTANT:
- Write like an experienced human risk officer: plain flowing prose, natural transitions, varied sentence length
- NO markdown of any kind: no headings, no bold (**), no bullet points, no numbered lists, no section labels
- Do not announce the structure and avoid formulaic filler ("It is important to note", "In today's dynamic market environment")
- Keep tone professional, balanced, and cautiously optimistic
${language === 'fr' ? `
LANGUAGE: Write the ENTIRE summary in FRENCH (Français). All text must be in French.` : ''}
Write the summary now:`;

    try {
      console.log('[RiskAnalysis] Generating executive summary...');

      const executiveSummary = await callAnthropicAPI(prompt, 3000);

      console.log('[RiskAnalysis] Executive summary generated');

      return {
        executiveSummary
      };
    } catch (error) {
      console.error('[RiskAnalysis] Failed to generate executive summary:', error);

      return {
        executiveSummary: `Executive summary unavailable due to error: ${error.message}`
      };
    }
  }

  Meteor.methods({
    /**
     * Generate comprehensive risk analysis report for all underlyings below protection barriers
     * @param {string} sessionId - User session ID for authentication
     * @param {string} language - Language for report ('en' or 'fr')
     * @returns {Promise<Object>} - Generated report with ID
     */
    async 'riskAnalysis.generate'(sessionId, language = 'en', asOfDate = null) {
      check(sessionId, String);
      check(language, String);
      check(asOfDate, Match.Maybe(Date));

      if (asOfDate && asOfDate.getTime() > Date.now()) {
        throw new Meteor.Error('invalid-date', 'asOfDate cannot be in the future');
      }

      console.log(`[RiskAnalysis] Starting risk analysis generation${asOfDate ? ` as of ${asOfDate.toISOString().slice(0, 10)}` : ''}...`);
      const startTime = Date.now();

      const analysisData = asOfDate
        ? await buildUnderlyingsAnalysis(asOfDate)
        : await UnderlyingsAnalysisCollection.findOneAsync({ _id: 'phoenix_live_underlyings' });

      if (!analysisData) {
        throw new Meteor.Error('no-analysis-data', 'No underlyings analysis found. Please refresh the analysis first.');
      }

      // Filter for underlyings below protection barriers
      const atRiskUnderlyings = analysisData.underlyings.filter(u =>
        u.distanceToBarrier != null &&
        u.distanceToBarrier < 0 && // Only include stocks below barrier (negative distance)
        u.hasMarketData
      );

      console.log(`[RiskAnalysis] Found ${atRiskUnderlyings.length} at-risk underlyings`);

      // If no at-risk underlyings, generate a positive portfolio health report.
      // Products can still be down 15%+ since launch without any barrier breach,
      // so the products-down section is computed on this path too.
      if (atRiskUnderlyings.length === 0) {
        const productsDownSinceLaunch = await buildProductsDownSinceLaunch({
          asOfDate,
          analysisData,
          language,
          commentBySymbol: new Map()
        });

        const executiveSummary = productsDownSinceLaunch.length > 0
          ? `All underlyings are currently performing above their protection barriers, indicating no immediate barrier risks to your structured products.\n\nHowever, ${productsDownSinceLaunch.length} product${productsDownSinceLaunch.length > 1 ? 's have' : ' has'} lost 15% or more of value since launch. See the "Products Down 15%+ Since Launch" section below for details on the underlyings driving these losses.`
          : 'Your portfolio is currently in excellent health. All underlyings are performing above their protection barriers, indicating no immediate risks to your structured products.\n\nThis is a positive indicator that your investment strategy is working well. Continue to monitor your positions regularly for any market changes.';

        const healthReport = {
          generatedAt: new Date(),
          generatedBy: this.userId,
          asOfDate: asOfDate || null,
          language,
          summary: {
            totalAtRisk: 0,
            uniqueUnderlyings: 0,
            criticalRisk: 0,
            highRisk: 0,
            moderateRisk: 0,
            averageDistanceToBarrier: 0,
            averageDaysRemaining: 0,
            productsDown15: productsDownSinceLaunch.length
          },
          analyses: [],
          executiveSummary,
          impactedProducts: [],
          productsDownSinceLaunch,
          totalProducts: analysisData.underlyings.length,
          generationTime: 0
        };

        const reportId = await RiskAnalysisReportsCollection.insertAsync(healthReport);
        console.log('[RiskAnalysis] Portfolio health report generated successfully');

        return {
          reportId,
          atRiskCount: 0,
          generationTime: 0
        };
      }

      // Group by unique underlying symbol (same stock may appear in multiple products)
      const uniqueUnderlyings = [];
      const seenSymbols = new Set();

      for (const underlying of atRiskUnderlyings) {
        if (!seenSymbols.has(underlying.symbol)) {
          seenSymbols.add(underlying.symbol);

          // Find all products with this underlying
          const products = atRiskUnderlyings
            .filter(u => u.symbol === underlying.symbol)
            .map(u => ({
              productId: u.productId,
              productTitle: u.productTitle,
              productIsin: u.productIsin,
              productCurrency: u.productCurrency,
              currentPrice: u.currentPrice,
              currentPriceFormatted: u.currentPriceFormatted,
              performance: u.performance,
              performanceFormatted: u.performanceFormatted,
              distanceToBarrier: u.distanceToBarrier,
              daysRemaining: u.daysToFinalObservation
            }));

          uniqueUnderlyings.push({
            ...underlying,
            products
          });
        }
      }

      console.log(`[RiskAnalysis] Analyzing ${uniqueUnderlyings.length} unique underlyings across ${atRiskUnderlyings.length} product positions in ${language}`);

      // Analyze each unique underlying in parallel
      const analysisPromises = uniqueUnderlyings.map(u => analyzeUnderlyingRisk(u, language));
      const analyses = await Promise.all(analysisPromises);

      console.log('[RiskAnalysis] Individual analyses complete');

      // Build the "products down 15%+ since launch" section, reusing the
      // at-risk comments for underlyings already analyzed above
      const commentBySymbol = new Map(analyses.map(a => [a.symbol, a.analysis]));
      const productsDownSinceLaunch = await buildProductsDownSinceLaunch({
        asOfDate,
        analysisData,
        language,
        commentBySymbol
      });

      // Generate executive summary
      const { executiveSummary } = await generateExecutiveSummary(analyses, language);

      // Aggregate impacted products
      const allProducts = [];
      const productMap = new Map();

      for (const analysis of analyses) {
        if (analysis.products) {
          for (const product of analysis.products) {
            if (!productMap.has(product.productId)) {
              productMap.set(product.productId, {
                productId: product.productId,
                productTitle: product.productTitle,
                productIsin: product.productIsin,
                atRiskUnderlyings: [],
                worstDistance: product.distanceToBarrier,
                daysRemaining: product.daysRemaining
              });
            }

            const productInfo = productMap.get(product.productId);
            productInfo.atRiskUnderlyings.push({
              symbol: analysis.symbol,
              companyName: analysis.companyName,
              distanceToBarrier: product.distanceToBarrier,
              riskLevel: analysis.riskLevel
            });

            // Track worst distance
            if (product.distanceToBarrier < productInfo.worstDistance) {
              productInfo.worstDistance = product.distanceToBarrier;
            }
          }
        }
      }

      const impactedProducts = Array.from(productMap.values());

      // Calculate summary statistics
      const summary = {
        totalAtRisk: atRiskUnderlyings.length,
        uniqueUnderlyings: uniqueUnderlyings.length,
        criticalRisk: analyses.filter(a => a.riskLevel === 'critical').length,
        highRisk: analyses.filter(a => a.riskLevel === 'high').length,
        moderateRisk: analyses.filter(a => a.riskLevel === 'moderate').length,
        averageDistanceToBarrier: analyses.reduce((sum, a) => sum + a.distanceToBarrier, 0) / analyses.length,
        averageDaysRemaining: analyses.reduce((sum, a) => sum + a.daysRemaining, 0) / analyses.length,
        productsDown15: productsDownSinceLaunch.length
      };

      // Create report document
      const report = {
        generatedAt: new Date(),
        generatedBy: this.userId,
        asOfDate: asOfDate || null,
        language, // Store language for reference
        summary,
        analyses: analyses.map(a => ({
          ...a,
          products: uniqueUnderlyings.find(u => u.symbol === a.symbol)?.products || []
        })),
        executiveSummary,
        impactedProducts: impactedProducts.sort((a, b) => a.worstDistance - b.worstDistance), // Sort by worst distance
        productsDownSinceLaunch,
        processingTimeMs: Date.now() - startTime,
        version: '1.1.0'
      };

      // Save to database
      const reportId = await RiskAnalysisReportsCollection.insertAsync(report);

      console.log(`[RiskAnalysis] Report generated successfully in ${report.processingTimeMs}ms, ID: ${reportId}`);

      return {
        success: true,
        reportId,
        summary,
        processingTimeMs: report.processingTimeMs
      };
    },

    /**
     * Get a risk analysis report by ID
     * @param {string} reportId - Report ID
     * @param {string} sessionId - User session ID
     * @returns {Promise<Object>} - Report document
     */
    async 'riskAnalysis.getReport'(reportId, sessionId) {
      check(reportId, String);
      check(sessionId, String);

      const report = await RiskAnalysisReportsCollection.findOneAsync(reportId);

      if (!report) {
        throw new Meteor.Error('report-not-found', 'Risk analysis report not found');
      }

      return report;
    },

    /**
     * Get all risk analysis reports (latest first)
     * @param {string} sessionId - User session ID
     * @param {number} limit - Maximum number of reports to return
     * @returns {Promise<Array>} - Array of reports
     */
    async 'riskAnalysis.listReports'(sessionId, limit = 10) {
      check(sessionId, String);
      check(limit, Number);

      const reports = await RiskAnalysisReportsCollection.find(
        {},
        {
          sort: { generatedAt: -1 },
          limit: Math.min(limit, 50),
          fields: {
            _id: 1,
            generatedAt: 1,
            generatedBy: 1,
            summary: 1,
            processingTimeMs: 1
          }
        }
      ).fetchAsync();

      return reports;
    },

    /**
     * Generate AI investment commentary for a specific product
     * @param {string} productId - Product ID
     * @param {string} sessionId - User session ID
     * @returns {Promise<Object>} - Generated commentary with ID
     */
    async 'productCommentary.generate'(productId, sessionId) {
      check(productId, String);
      check(sessionId, String);

      console.log(`[ProductCommentary] Generating commentary for product ${productId}...`);
      const startTime = Date.now();

      // Get the latest report for this product (using new TemplateReportsCollection)
      const report = await TemplateReportsCollection.findOneAsync(
        { productId },
        { sort: { createdAt: -1 } }
      );

      if (!report) {
        throw new Meteor.Error('report-not-found', 'No evaluation report found for this product. Please run an evaluation first.');
      }

      // Extract key product information from report (new TemplateReportsCollection structure)
      const title = report.productName || report.staticData?.name || 'Unknown Product';
      const isin = report.productIsin || report.staticData?.isin || 'Unknown';
      const currency = report.staticData?.currency || 'USD';
      const tradeDate = report.staticData?.tradeDate;
      const maturity = report.staticData?.maturityDate;
      const finalObservation = report.templateResults?.currentStatus?.finalObservation || report.staticData?.finalObservation;
      const templateResults = report.templateResults || {};

      const underlyings = templateResults?.underlyings || [];
      const phoenixParams = templateResults?.phoenixStructure || templateResults?.productParameters || {};
      const observationAnalysis = templateResults?.observationAnalysis || null;
      const currentStatus = templateResults?.currentStatus || {};
      const status = currentStatus?.productStatus || 'unknown';
      const payoffSummary = templateResults?.payoffSummary || null;

      // Determine product type and mechanism
      let productType = 'Structured Product';
      let mechanism = '';

      if (phoenixParams && (phoenixParams.autocallBarrier || phoenixParams.protectionBarrier)) {
        productType = 'Phoenix Autocallable';
        mechanism = `This is a Phoenix Autocallable product (worst-of basket structure) with the following parameters:
- Autocall Barrier: ${phoenixParams.autocallBarrier}%
- Protection Barrier: ${phoenixParams.protectionBarrier}%
- Coupon Rate: ${phoenixParams.couponRate}% per observation
- Observation Frequency: ${phoenixParams.observationFrequency || 'quarterly'}
- Memory Coupon: ${phoenixParams.memoryCoupon ? 'Yes - unpaid coupons accumulate' : 'No'}
- Memory Autocall: ${phoenixParams.memoryAutocall ? 'Yes - individual underlying flags' : 'No - all must be above simultaneously'}

WORST-OF MECHANICS: At maturity, if ANY underlying is below the ${phoenixParams.protectionBarrier}% protection barrier, the investor receives exposure to the WORST-PERFORMING underlying's loss. This is not averaged or collective - each underlying's position matters individually.`;
      }

      // Build detailed underlyings summary with barrier distances
      let underlyingsSummary = '';
      if (underlyings && underlyings.length > 0) {
        underlyingsSummary = '\n\nUNDERLYINGS PERFORMANCE & BARRIER POSITIONS:\n';
        for (const underlying of underlyings) {
          const perf = underlying.performance || 0;
          const name = underlying.name || underlying.companyName || 'Unknown';
          const ticker = underlying.ticker || underlying.symbol || 'N/A';
          const distanceToBarrier = underlying.distanceToBarrier || 0;
          const barrierStatus = underlying.barrierStatusText || 'Unknown';
          const isWorst = underlying.isWorstPerforming ? ' [WORST PERFORMER]' : '';

          underlyingsSummary += `\n${ticker} (${name})${isWorst}:\n`;
          underlyingsSummary += `  - Current Performance: ${perf >= 0 ? '+' : ''}${perf.toFixed(2)}%\n`;
          underlyingsSummary += `  - Distance to Protection Barrier: ${distanceToBarrier >= 0 ? '+' : ''}${distanceToBarrier.toFixed(1)}%\n`;
          underlyingsSummary += `  - Status: ${barrierStatus}\n`;

          if (phoenixParams.memoryAutocall && underlying.hasMemoryAutocallFlag) {
            underlyingsSummary += `  - Memory Autocall Flag: Yes (flagged on ${underlying.memoryAutocallFlaggedDateFormatted})\n`;
          }
        }
      }

      // Build observation history summary
      let observationSummary = '';
      if (observationAnalysis) {
        const {
          totalCouponsEarned,
          totalMemoryCoupons,
          totalObservations,
          remainingObservations,
          isEarlyAutocall,
          callDateFormatted,
          observations
        } = observationAnalysis;

        observationSummary = `\n\nOBSERVATION HISTORY:\n`;
        observationSummary += `- Total Observations: ${totalObservations}\n`;
        observationSummary += `- Completed Observations: ${totalObservations - remainingObservations}\n`;
        observationSummary += `- Remaining Observations: ${remainingObservations}\n`;
        observationSummary += `- Coupons Paid: ${totalCouponsEarned.toFixed(1)}%\n`;

        if (phoenixParams.memoryCoupon && totalMemoryCoupons > 0) {
          observationSummary += `- Coupons In Memory: ${totalMemoryCoupons.toFixed(1)}% (unpaid, will be paid at next coupon event or maturity)\n`;
        }

        if (isEarlyAutocall) {
          observationSummary += `- PRODUCT STATUS: Early Autocall on ${callDateFormatted}\n`;
        }

        // Add recent observation details
        const recentObs = observations?.filter(o => o.hasOccurred).slice(-3) || [];
        if (recentObs.length > 0) {
          observationSummary += `\nRecent Observations:\n`;
          recentObs.forEach(obs => {
            observationSummary += `  ${obs.observationDateFormatted}: `;
            if (obs.basketLevel !== null) {
              observationSummary += `Basket ${obs.basketLevelFormatted}`;
              if (obs.couponPaid > 0) {
                observationSummary += `, Coupon Paid: ${obs.couponPaidFormatted}`;
              } else if (obs.memoryCouponAdded) {
                observationSummary += `, Coupon to Memory: ${obs.couponAmountFormatted}`;
              } else {
                observationSummary += `, No Coupon`;
              }
            } else {
              observationSummary += `Data unavailable`;
            }
            observationSummary += `\n`;
          });
        }
      }

      // Build time and maturity information
      let timeInformation = '';
      if (currentStatus) {
        const { daysToMaturity, daysToMaturityText, hasMatured, evaluationDateFormatted } = currentStatus;

        timeInformation = `\n\nTIME & MATURITY:\n`;
        timeInformation += `- Current Date: ${evaluationDateFormatted}\n`;
        timeInformation += `- Trade Date: ${tradeDate ? new Date(tradeDate).toLocaleDateString() : 'Unknown'}\n`;
        timeInformation += `- Final Observation: ${finalObservation ? new Date(finalObservation).toLocaleDateString() : 'Unknown'}\n`;
        timeInformation += `- Maturity Date: ${maturity ? new Date(maturity).toLocaleDateString() : 'Unknown'}\n`;
        timeInformation += `- Days to Maturity: ${daysToMaturityText}\n`;
        timeInformation += `- Product Status: ${hasMatured ? 'MATURED' : 'ACTIVE'}\n`;
      }

      // Fetch news for all underlyings
      let newsSection = '';
      try {
        console.log(`[ProductCommentary] Fetching news for ${underlyings.length} underlyings...`);

        const newsPromises = underlyings.map(async (underlying) => {
          const ticker = underlying.ticker || underlying.symbol || '';
          const parts = ticker.split('.');
          const symbol = parts[0];
          const exchange = parts[1] || null;

          return {
            ticker: ticker,
            news: await EODApiHelpers.getSecurityNews(symbol, exchange, 3)
          };
        });

        const allNews = await Promise.all(newsPromises);

        if (allNews.some(n => n.news && n.news.length > 0)) {
          newsSection = '\nRECENT NEWS:\n';
          allNews.forEach(({ ticker, news }) => {
            if (news && news.length > 0) {
              newsSection += `\n${ticker}:\n`;
              news.forEach((article, idx) => {
                const date = article.date ? new Date(article.date).toLocaleDateString() : 'Recent';
                newsSection += `  ${idx + 1}. [${date}] ${article.title}\n`;
              });
            }
          });
          newsSection += '\n';
        }
      } catch (error) {
        console.warn(`[ProductCommentary] Failed to fetch news:`, error.message);
        newsSection = '\nRECENT NEWS: Unable to fetch news data.\n\n';
      }

      // Get payoff summary if available
      let payoffInfo = '';
      if (payoffSummary) {
        payoffInfo = `\nCURRENT PAYOFF EVALUATION:\n${JSON.stringify(payoffSummary, null, 2)}\n`;
      }

      // Build AI prompt
      const prompt = `You are writing a factual investment commentary about a structured product for client documentation.

PRODUCT INFORMATION:
- Product Name: ${title}
- ISIN: ${isin}
- Type: ${productType}
- Currency: ${currency}

PRODUCT STRUCTURE & MECHANISM:
${mechanism}
${underlyingsSummary}${observationSummary}${timeInformation}${newsSection}

CRITICAL WORST-OF MECHANICS REMINDER:
In this worst-of basket structure, at maturity (${maturity}), the capital protection barrier is ${phoenixParams.protectionBarrier}%. If ANY single underlying is below this barrier at the final observation, the investor is exposed to the loss of the WORST-PERFORMING underlying. This is not an average or collective calculation - each underlying's individual performance relative to the barrier determines the outcome. One underlying breaching the barrier is sufficient to trigger loss exposure, regardless of how the other underlyings perform.

TASK:
Write a direct, factual commentary (3-4 paragraphs, 300-400 words) that objectively describes the current state of the product:

1. **Product Structure & Payoff History** (1 paragraph):
   - Describe the product type, barriers (autocall and protection levels), and coupon structure
   - Explicitly explain the worst-of mechanics and what happens if any underlying breaches the protection barrier at maturity
   - State how many coupons have been paid so far (use the exact percentage from observation history)
   - If memory coupons exist, state how many are accumulated in memory and that they will be paid at the next coupon event or maturity
   - Mention the observation frequency and how many observations remain

2. **Current Underlying Performance & Barrier Analysis** (1-2 paragraphs):
   - For EACH underlying, state its current performance and distance to the protection barrier
   - Identify which underlying is the worst performer and its specific distance to the barrier (this is critical in a worst-of structure)
   - Explain that this worst performer determines the capital outcome at maturity
   - Reference relevant news events affecting each underlying with specific dates when available
   - For underlyings near or below the barrier, note their specific risk status
   - If memory autocall flags exist for any underlying, mention which ones have been flagged and when

3. **Time Horizon & Product Status** (1 paragraph):
   - State the exact number of days to maturity (use the formatted text provided)
   - Note whether the product has matured or is still active
   - If active, state when the next observation date is
   - If the product has already autocalled early, state when this occurred
   - Provide context on whether remaining time is substantial or the product is approaching its conclusion

TONE & STYLE:
- Factual and observational, not advisory
- Direct statements about the product state, not recommendations
- Avoid phrases like "we recommend", "our view", "should consider", "it is advisable"
- Write as a commentary on the current state, not as advice or an email
- Use third-person or impersonal voice ("The product shows...", "Performance has been...", "The underlying has...")
- Professional but straightforward
- Acknowledge both positive and negative aspects objectively
- Do NOT make recommendations or give investment advice

Write the commentary now:`;

      try {
        const commentary = await callAnthropicAPI(prompt, 4000);

        // Save commentary to database
        const commentaryDoc = {
          productId,
          title,
          isin,
          commentary,
          generatedAt: new Date(),
          generatedBy: this.userId,
          processingTimeMs: Date.now() - startTime,
          version: '1.0.0'
        };

        const commentaryId = await ProductCommentaryCollection.insertAsync(commentaryDoc);

        console.log(`[ProductCommentary] Commentary generated successfully in ${commentaryDoc.processingTimeMs}ms, ID: ${commentaryId}`);

        return {
          success: true,
          commentaryId,
          commentary,
          processingTimeMs: commentaryDoc.processingTimeMs
        };
      } catch (error) {
        console.error('[ProductCommentary] Failed to generate commentary:', error);
        throw new Meteor.Error('commentary-generation-failed', `Failed to generate commentary: ${error.message}`);
      }
    },

    /**
     * Get the latest commentary for a product
     * @param {string} productId - Product ID
     * @param {string} sessionId - User session ID
     * @returns {Promise<Object>} - Latest commentary document
     */
    async 'productCommentary.getLatest'(productId, sessionId) {
      check(productId, String);
      check(sessionId, String);

      const commentary = await ProductCommentaryCollection.findOneAsync(
        { productId },
        { sort: { generatedAt: -1 } }
      );

      return commentary || null;
    }
  });
}
