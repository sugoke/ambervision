import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { PortfolioReviewsCollection } from './portfolioReviews';
import { PMSHoldingsCollection } from './pmsHoldings';
import { TemplateReportsCollection } from './templateReports';
import { ProductCommentaryCollection } from './riskAnalysis';
import { MarketDataCacheCollection } from './marketDataCache';
import { CurrencyRateCacheCollection } from './currencyCache';
import { AccountProfilesCollection, aggregateToFourCategories } from './accountProfiles';
import { BankAccountsCollection } from './bankAccounts';
import { EODApiHelpers } from './eodApi';
import {
  calculateCashForHoldings,
  buildRatesMap,
  extractBankFxRates,
  mergeRatesMaps,
  convertToEUR
} from './helpers/cashCalculator';

// Anthropic API configuration
const ANTHROPIC_API_KEY = Meteor.settings.private?.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

// Brave Search API configuration
const BRAVE_SEARCH_API_KEY = Meteor.settings.private?.BRAVE_SEARCH_API_KEY;
const BRAVE_SEARCH_API_URL = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Call Brave Search API
 * @param {string} query - Search query
 * @param {number} count - Number of results (max 20)
 * @returns {Promise<Array>} - Array of { title, url, description, age }
 */
async function callBraveSearch(query, count = 5) {
  if (!BRAVE_SEARCH_API_KEY) {
    console.warn('[PortfolioReview] Brave Search API key not configured, skipping');
    return [];
  }

  try {
    const response = await HTTP.get(BRAVE_SEARCH_API_URL, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_SEARCH_API_KEY
      },
      params: {
        q: query,
        count: Math.min(count, 20),
        freshness: 'pw', // past week
        text_decorations: false,
        search_lang: 'en'
      },
      timeout: 10000
    });

    const results = response.data?.web?.results || [];
    return results.map(r => ({
      title: r.title || '',
      url: r.url || '',
      description: r.description || '',
      age: r.age || ''
    }));
  } catch (error) {
    console.warn(`[PortfolioReview] Brave Search failed for "${query}":`, error.message);
    return [];
  }
}

/**
 * Gather news context via Brave Search API for macro, underlyings, and key themes.
 * Runs multiple targeted searches in parallel for speed.
 * @returns {Object} { macroNews, underlyingNews, sectorNews }
 */
async function gatherBraveNewsContext(groupedHoldings, spReports, fxExposure) {
  const searches = [];

  // 1. Macro market news
  searches.push(
    callBraveSearch('global financial markets today stocks bonds outlook', 5)
      .then(results => ({ key: 'macro_markets', results }))
  );

  // 2. Central bank / rates news
  searches.push(
    callBraveSearch('ECB Federal Reserve interest rates decision 2026', 3)
      .then(results => ({ key: 'central_banks', results }))
  );

  // 3. News for equity holdings with significant moves (>15% unrealized P&L)
  const significantEquities = [...(groupedHoldings.equities || [])]
    .filter(h => Math.abs(h._unrealizedPnLPercent || 0) > 15)
    .sort((a, b) => Math.abs(b._unrealizedPnLPercent || 0) - Math.abs(a._unrealizedPnLPercent || 0))
    .slice(0, 8);

  // Also include top equities by weight if they aren't already covered
  const coveredIds = new Set(significantEquities.map(h => h._id));
  const topByWeight = [...(groupedHoldings.equities || [])]
    .filter(h => !coveredIds.has(h._id))
    .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
    .slice(0, Math.max(0, 5 - significantEquities.length));

  for (const h of [...significantEquities, ...topByWeight]) {
    const name = h.securityName || '';
    const ticker = h.ticker || '';
    const searchTerm = ticker.split('.')[0] || name.split(' ')[0];
    if (searchTerm && searchTerm.length > 1) {
      const pnl = h._unrealizedPnLPercent || 0;
      const direction = pnl < -15 ? 'drop decline' : pnl > 15 ? 'rally surge' : '';
      searches.push(
        callBraveSearch(`${searchTerm} stock news ${direction} analyst outlook`.trim(), 3)
          .then(results => ({ key: `equity_${h._id}`, ticker: searchTerm, results }))
      );
    }
  }

  // 3b. News for bonds/funds with significant moves (>10% unrealized P&L)
  const allOtherHoldings = [
    ...(groupedHoldings.bonds || []),
    ...(groupedHoldings.funds || []),
    ...(groupedHoldings.other || [])
  ].filter(h => Math.abs(h._unrealizedPnLPercent || 0) > 10);

  const significantOthers = allOtherHoldings
    .sort((a, b) => Math.abs(b._unrealizedPnLPercent || 0) - Math.abs(a._unrealizedPnLPercent || 0))
    .slice(0, 5);

  for (const h of significantOthers) {
    const name = h.securityName || '';
    const isin = h.isin || '';
    // Use ISIN or security name for search since bonds/funds may not have tickers
    const searchTerm = (h.ticker ? h.ticker.split('.')[0] : '') || name.split(/[\s(]+/)[0];
    if (searchTerm && searchTerm.length > 2) {
      searches.push(
        callBraveSearch(`${searchTerm} ${isin ? isin : ''} news outlook`.trim(), 3)
          .then(results => ({ key: `other_${h._id}`, name: searchTerm, results }))
      );
    }
  }

  // 4. News for SP underlyings with significant moves (especially underperformers)
  const underlyingMovers = {};
  for (const report of Object.values(spReports)) {
    if (!report?.templateResults?.underlyings) continue;
    for (const u of report.templateResults.underlyings) {
      const ticker = u.ticker || (u.fullTicker ? u.fullTicker.split('.')[0] : null);
      if (!ticker) continue;
      const perf = u.performance || 0;
      const absPerf = Math.abs(perf);
      // Lower threshold: any underlying with >5% absolute move is worth searching
      if (absPerf > 5 && (!underlyingMovers[ticker] || absPerf > underlyingMovers[ticker].absPerf)) {
        underlyingMovers[ticker] = { ticker, name: u.name || ticker, performance: perf, absPerf };
      }
    }
  }

  // Prioritize underperformers first, then biggest absolute movers
  const allMovers = Object.values(underlyingMovers)
    .sort((a, b) => {
      // Underperformers first (most negative), then by absolute performance
      if (a.performance < -10 && b.performance >= -10) return -1;
      if (b.performance < -10 && a.performance >= -10) return 1;
      return b.absPerf - a.absPerf;
    })
    .slice(0, 10);

  for (const mover of allMovers) {
    // Directional search queries: different for underperformers vs outperformers
    let query;
    if (mover.performance < -10) {
      // Underperformer: search for reasons for decline + analyst outlook/forecast
      query = `${mover.name} ${mover.ticker} stock decline drop reason why analyst forecast outlook 2026`;
    } else if (mover.performance > 20) {
      // Strong outperformer: search for what's driving the rally + whether it continues
      query = `${mover.name} ${mover.ticker} stock rally reason analyst price target outlook`;
    } else {
      // Moderate mover: general news + analyst view
      query = `${mover.name} ${mover.ticker} stock news analyst outlook forecast`;
    }
    searches.push(
      callBraveSearch(query, mover.absPerf > 15 ? 5 : 3)
        .then(results => ({ key: `sp_underlying_${mover.ticker}`, ticker: mover.ticker, performance: mover.performance, results }))
    );
  }

  // 5. FX news for major non-EUR exposures
  const majorFxExposures = (fxExposure || []).filter(e => e.currency !== 'EUR' && e.percentOfTotal > 10);
  for (const fx of majorFxExposures.slice(0, 2)) {
    searches.push(
      callBraveSearch(`EUR ${fx.currency} exchange rate forecast outlook`, 3)
        .then(results => ({ key: `fx_${fx.currency}`, currency: fx.currency, results }))
    );
  }

  // Execute all searches in parallel
  const allResults = await Promise.all(searches);

  // Organize results
  const braveNews = {
    macroNews: [],
    centralBankNews: [],
    equityNews: {},
    spUnderlyingNews: {},
    holdingNews: {},  // News for any holding by _id (bonds, funds, other)
    fxNews: {}
  };

  for (const result of allResults) {
    if (result.key === 'macro_markets') {
      braveNews.macroNews = result.results;
    } else if (result.key === 'central_banks') {
      braveNews.centralBankNews = result.results;
    } else if (result.key.startsWith('equity_')) {
      const holdingId = result.key.replace('equity_', '');
      braveNews.equityNews[holdingId] = { ticker: result.ticker, articles: result.results };
    } else if (result.key.startsWith('sp_underlying_')) {
      const ticker = result.key.replace('sp_underlying_', '');
      braveNews.spUnderlyingNews[ticker] = result.results;
    } else if (result.key.startsWith('other_')) {
      const holdingId = result.key.replace('other_', '');
      braveNews.holdingNews[holdingId] = { name: result.name, articles: result.results };
    } else if (result.key.startsWith('fx_')) {
      const currency = result.key.replace('fx_', '');
      braveNews.fxNews[currency] = result.results;
    }
  }

  const totalArticles = braveNews.macroNews.length + braveNews.centralBankNews.length +
    Object.values(braveNews.equityNews).reduce((s, e) => s + e.articles.length, 0) +
    Object.values(braveNews.spUnderlyingNews).reduce((s, a) => s + a.length, 0) +
    Object.values(braveNews.holdingNews).reduce((s, e) => s + e.articles.length, 0) +
    Object.values(braveNews.fxNews).reduce((s, a) => s + a.length, 0);

  console.log(`[PortfolioReview] Brave Search gathered ${totalArticles} articles across ${searches.length} queries`);
  return braveNews;
}

/**
 * Format Brave search results into a concise text block for AI prompts
 */
function formatBraveResults(results, maxItems = 5) {
  if (!results || results.length === 0) return '';
  return results.slice(0, maxItems).map(r => {
    const age = r.age ? ` (${r.age})` : '';
    return `- ${r.title}${age}: ${r.description}`;
  }).join('\n');
}

/**
 * Call Anthropic Claude API
 * @param {string} prompt - The prompt to send
 * @param {number} maxTokens - Max tokens for response
 * @param {Object} options - Additional options (tools, etc.)
 * @returns {Promise<string>} - Claude's response text
 */
async function callAnthropicAPI(prompt, maxTokens = 2000, options = {}) {
  if (!ANTHROPIC_API_KEY) {
    throw new Meteor.Error('anthropic-config-error', 'Anthropic API key not configured');
  }

  try {
    const THINKING_BUDGET = 1024;
    // max_tokens must be > budget_tokens; it covers both thinking + response
    const totalMaxTokens = THINKING_BUDGET + maxTokens;

    const requestData = {
      model: ANTHROPIC_MODEL,
      max_tokens: totalMaxTokens,
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET }
    };

    const headers = {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    };

    // Add web search tool if requested
    if (options.useWebSearch) {
      requestData.tools = [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3
      }];
      headers['anthropic-beta'] = 'web-search-2025-03-05';
    }

    console.log(`[PortfolioReview] API call: maxTokens=${totalMaxTokens}, thinking=${THINKING_BUDGET}, webSearch=${!!options.useWebSearch}`);

    const response = await HTTP.post(ANTHROPIC_API_URL, {
      headers,
      data: requestData,
      timeout: 180000 // 3 minute timeout for web search calls
    });

    if (response.data && response.data.content && response.data.content.length > 0) {
      let textContent = response.data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      // Strip HTML citation tags from web search responses (e.g. <cite index="25-19">...</cite>)
      textContent = textContent.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, '');
      // Also strip any other stray HTML tags that web search may inject
      textContent = textContent.replace(/<\/?[a-z][^>]*>/gi, '');

      return textContent;
    }

    throw new Error('Invalid response from Anthropic API');
  } catch (error) {
    if (error.response) {
      const status = error.response.statusCode;
      const body = error.response.data || {};
      const message = body.error?.message || JSON.stringify(body).substring(0, 200);
      console.error(`[PortfolioReview] API error ${status}:`, message);
      if (status === 401) throw new Meteor.Error('anthropic-auth-failed', 'Invalid API key');
      if (status === 429) throw new Meteor.Error('anthropic-rate-limit', 'Rate limit exceeded');
      throw new Meteor.Error('anthropic-api-error', `API error (${status}): ${message}`);
    }
    console.error('[PortfolioReview] API call failed:', error.message);
    throw new Meteor.Error('anthropic-call-failed', `Failed to call API: ${error.message}`);
  }
}

/**
 * Update review progress reactively
 */
async function updateProgress(reviewId, step, label, completedSections, extra = {}) {
  // Check if review was cancelled before continuing
  const review = await PortfolioReviewsCollection.findOneAsync(reviewId, { fields: { status: 1 } });
  if (review && review.status === 'cancelled') {
    throw new Meteor.Error('review-cancelled', 'Review generation was cancelled');
  }

  await PortfolioReviewsCollection.updateAsync(reviewId, {
    $set: {
      'progress.currentStep': step,
      'progress.currentStepLabel': label,
      'progress.completedSections': completedSections,
      ...Object.keys(extra).reduce((acc, key) => {
        acc[`progress.${key}`] = extra[key];
        return acc;
      }, {})
    }
  });
}

// ============================================================================
// DATA GATHERING PHASE
// ============================================================================

/**
 * Gather all holdings filtered by account/viewAs
 */
async function gatherHoldings(accountFilter, viewAsFilter) {
  const query = { isLatest: true, isActive: { $ne: false } };

  // Filter by viewAs (client or account scope)
  if (viewAsFilter && viewAsFilter.id) {
    if (viewAsFilter.type === 'client') {
      // Filter holdings to this client's userId
      query.userId = viewAsFilter.id;
    } else if (viewAsFilter.type === 'account') {
      // Filter to a specific bank account
      const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
      if (bankAccount) {
        query.userId = bankAccount.userId;
        if (bankAccount.accountNumber) query.portfolioCode = bankAccount.accountNumber;
        if (bankAccount.bankId) query.bankId = bankAccount.bankId;
      }
    }
  }

  // Further filter by specific account tab if not consolidated
  if (accountFilter && accountFilter !== 'consolidated') {
    const bankAccount = await BankAccountsCollection.findOneAsync(accountFilter);
    if (bankAccount) {
      if (bankAccount.accountNumber) query.portfolioCode = bankAccount.accountNumber;
      if (bankAccount.bankId) query.bankId = bankAccount.bankId;
    }
  }

  let holdings = await PMSHoldingsCollection.find(query).fetchAsync();

  // Apply the same consolidated logic as the PMS UI:
  // When consolidated, prefer pre-aggregated CONSOLIDATED holdings (avoids double counting)
  // When a specific account, exclude CONSOLIDATED holdings
  if (!accountFilter || accountFilter === 'consolidated') {
    const consolidatedHoldings = holdings.filter(h => h.portfolioCode === 'CONSOLIDATED');
    if (consolidatedHoldings.length > 0) {
      holdings = consolidatedHoldings;
    } else {
      // Fallback: use individual account holdings (exclude any CONSOLIDATED)
      holdings = holdings.filter(h => h.portfolioCode !== 'CONSOLIDATED');
    }
  } else {
    // Specific account: exclude consolidated
    holdings = holdings.filter(h => h.portfolioCode !== 'CONSOLIDATED');
  }

  // Group by asset type
  const grouped = {
    equities: [],
    bonds: [],
    structuredProducts: [],
    funds: [],
    cash: [],
    other: []
  };

  for (const h of holdings) {
    const ac = (h.assetClass || '').toLowerCase();
    const st = (h.securityType || '').toLowerCase();

    if (ac === 'cash' || st === 'cash' || ac === 'time_deposit' || ac === 'monetary_products') {
      grouped.cash.push(h);
    } else if (ac === 'equity' || ac === 'stock' || st === 'equity' || st === 'stock') {
      grouped.equities.push(h);
    } else if (ac === 'fixed_income' || ac === 'bond' || st === 'bond' || ac === 'convertible') {
      grouped.bonds.push(h);
    } else if (ac.includes('structured_product') || st.includes('structured')) {
      grouped.structuredProducts.push(h);
    } else if (ac === 'fund' || ac === 'etf' || st === 'fund' || st === 'etf' || ac === 'hedge_fund' || ac === 'private_equity') {
      grouped.funds.push(h);
    } else {
      grouped.other.push(h);
    }
  }

  return { all: holdings, grouped };
}

/**
 * Gather structured product report data for linked holdings
 */
async function gatherStructuredProductData(holdings) {
  const spHoldings = holdings.filter(h => h.linkedProductId);
  if (spHoldings.length === 0) return {};

  const productIds = [...new Set(spHoldings.map(h => h.linkedProductId))];
  const reports = {};

  for (const productId of productIds) {
    const report = await TemplateReportsCollection.findOneAsync(
      { productId },
      { sort: { createdAt: -1 } }
    );
    if (report) {
      reports[productId] = report;
    }

    // Also check for recent commentary (< 7 days old)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const commentary = await ProductCommentaryCollection.findOneAsync(
      { productId, generatedAt: { $gte: sevenDaysAgo } },
      { sort: { generatedAt: -1 } }
    );
    if (commentary) {
      reports[productId] = reports[productId] || {};
      reports[productId]._commentary = commentary.commentary;
    }
  }

  return reports;
}

/**
 * Gather market data for equity holdings from MarketDataCache
 */
async function gatherMarketData(equityHoldings) {
  const marketData = {};

  for (const h of equityHoldings) {
    const ticker = h.ticker || h.isin;
    if (!ticker) continue;

    // Try to find in MarketDataCacheCollection
    const cacheDoc = await MarketDataCacheCollection.findOneAsync({
      $or: [
        { fullTicker: ticker },
        { symbol: ticker.split('.')[0] }
      ]
    });

    if (cacheDoc && cacheDoc.cache) {
      marketData[h._id] = {
        latestPrice: cacheDoc.cache.latestPrice,
        sma20: cacheDoc.cache.sma20,
        sma50: cacheDoc.cache.sma50,
        sma200: cacheDoc.cache.sma200,
        high52Week: cacheDoc.cache.high52Week,
        low52Week: cacheDoc.cache.low52Week,
        latestDate: cacheDoc.cache.latestDate
      };
    }
  }

  return marketData;
}

/**
 * Fetch news for top equity holdings
 */
async function gatherEquityNews(equityHoldings) {
  // Take top 10 by market value for news fetching
  const topHoldings = [...equityHoldings]
    .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
    .slice(0, 10);

  const news = {};

  for (const h of topHoldings) {
    const ticker = h.ticker || '';
    const parts = ticker.split('.');
    const symbol = parts[0];
    const exchange = parts[1] || null;

    if (!symbol) continue;

    try {
      const articles = await EODApiHelpers.getSecurityNews(symbol, exchange, 3);
      if (articles && articles.length > 0) {
        news[h._id] = articles;
      }
    } catch (err) {
      console.warn(`[PortfolioReview] Failed to fetch news for ${symbol}:`, err.message);
    }
  }

  return news;
}

/**
 * Gather allocation profile data
 */
async function gatherAllocationData(holdings, accountFilter, viewAsFilter) {
  // Build granular breakdown by asset class with structured product protection types
  // Must match the same logic as PMS fourCategoryAllocation for consistency
  const breakdown = {};
  let totalValue = 0;

  for (const h of holdings) {
    let categoryKey = (h.assetClass || 'other').toLowerCase();
    const mv = h.marketValue || 0;

    if (categoryKey === 'structured_product') {
      const protectionType = h.structuredProductProtectionType;
      const underlyingType = h.structuredProductUnderlyingType || 'equity_linked';
      if (protectionType === 'capital_guaranteed_100') {
        categoryKey = 'structured_product_capital_guaranteed';
      } else if (protectionType === 'capital_guaranteed_partial') {
        categoryKey = 'structured_product_partial_guarantee';
      } else if (protectionType === 'capital_protected_conditional') {
        // Equity-linked barrier protected → equities (still has equity risk)
        // Non-equity barrier protected → bonds
        if (underlyingType === 'equity_linked') {
          categoryKey = 'structured_product_equity_linked_barrier_protected';
        } else {
          categoryKey = 'structured_product_barrier_protected';
        }
      } else if (h.structuredProductUnderlyingType) {
        categoryKey = `structured_product_${h.structuredProductUnderlyingType}`;
      }
    }

    breakdown[categoryKey] = (breakdown[categoryKey] || 0) + mv;
    totalValue += mv;
  }

  const currentAllocation = aggregateToFourCategories(breakdown, totalValue);

  // Get account profile (profiles are keyed by bankAccountId which is the BankAccountsCollection _id)
  let profile = null;
  if (accountFilter && accountFilter !== 'consolidated') {
    // Specific account selected - look up directly by bankAccountId
    profile = await AccountProfilesCollection.findOneAsync({ bankAccountId: accountFilter });
  } else if (viewAsFilter?.type === 'client') {
    // Consolidated view for a client - find any profile for their accounts
    const clientAccounts = await BankAccountsCollection.find({ userId: viewAsFilter.id }).fetchAsync();
    const accountIds = clientAccounts.map(a => a._id);
    if (accountIds.length > 0) {
      profile = await AccountProfilesCollection.findOneAsync({ bankAccountId: { $in: accountIds } });
    }
  }

  // Calculate breaches
  const breaches = [];
  if (profile) {
    const checks = [
      { category: 'cash', current: currentAllocation.cash, limit: profile.maxCash },
      { category: 'bonds', current: currentAllocation.bonds, limit: profile.maxBonds },
      { category: 'equities', current: currentAllocation.equities, limit: profile.maxEquities },
      { category: 'alternative', current: currentAllocation.alternative, limit: profile.maxAlternative }
    ];

    for (const check of checks) {
      if (check.limit && check.current > check.limit) {
        breaches.push({
          category: check.category,
          current: check.current,
          limit: check.limit,
          excess: check.current - check.limit
        });
      }
    }
  }

  return {
    currentAllocation,
    totalValue,
    profileLimits: profile ? {
      maxCash: profile.maxCash,
      maxBonds: profile.maxBonds,
      maxEquities: profile.maxEquities,
      maxAlternative: profile.maxAlternative,
      profileName: profile.profileName || profile.name || 'Custom'
    } : null,
    breaches
  };
}

/**
 * Gather cash data using existing cashCalculator
 */
async function gatherCashData(holdings) {
  // Get currency rates
  const currencyRates = await CurrencyRateCacheCollection.find({}).fetchAsync();
  const eodRatesMap = buildRatesMap(currencyRates);
  const bankRatesMap = extractBankFxRates(holdings);
  const ratesMap = mergeRatesMaps(eodRatesMap, bankRatesMap);

  const cashResult = calculateCashForHoldings(holdings, ratesMap);

  return {
    pureCashEUR: cashResult.pureCashEUR,
    totalCashEquivalentEUR: cashResult.totalCashEquivalentEUR,
    cashByCurrency: cashResult.cashByCurrency || {},
    pureCashBreakdown: cashResult.pureCashBreakdown || [],
    allCashBreakdown: cashResult.allCashBreakdown || [],
    ratesMap
  };
}

/**
 * Gather events from template reports' observation analysis (last 30 days + next 30 days)
 * Events come from templateResults.observationAnalysis.observations in templateReports,
 * plus maturity dates from staticData.maturityDate.
 */
function gatherEventsFromReports(spReports, holdings) {
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const pastEvents = [];
  const upcomingEvents = [];

  // Build ISIN lookup from holdings
  const isinByProductId = {};
  for (const h of holdings) {
    if (h.linkedProductId && h.isin) {
      isinByProductId[h.linkedProductId] = h.isin;
    }
  }

  for (const [productId, report] of Object.entries(spReports)) {
    if (!report || !report.templateResults) continue;

    const productName = report.productName || 'Unknown Product';
    const productIsin = report.productIsin || isinByProductId[productId] || '';
    const observations = report.templateResults?.observationAnalysis?.observations || [];

    for (const obs of observations) {
      const obsDate = new Date(obs.observationDate);
      if (isNaN(obsDate.getTime())) continue;
      if (obsDate < thirtyDaysAgo || obsDate > thirtyDaysFromNow) continue;

      const daysFromNow = Math.ceil((obsDate - now) / (1000 * 60 * 60 * 24));

      // Build description from observation data
      let description = obs.observationType || 'Observation';
      const details = {};

      if (obs.couponPaid && obs.couponPaid > 0) {
        description += ` - Coupon ${obs.couponPaidFormatted || obs.couponPaid + '%'}`;
        details.couponPaid = obs.couponPaid;
      }
      if (obs.autocalled) {
        description += ' - AUTOCALLED';
        details.autocalled = true;
      }
      if (obs.isFinal) {
        description += ' (Final)';
        details.isFinal = true;
      }
      if (obs.paymentDate) {
        details.paymentDate = obs.paymentDate;
      }

      const entry = {
        productName,
        productIsin,
        eventType: obs.observationType || 'observation',
        eventDate: obsDate,
        description,
        details,
        daysUntil: daysFromNow,
        status: obs.status || (obsDate < now ? 'completed' : 'upcoming')
      };

      if (obsDate < now) {
        pastEvents.push(entry);
      } else {
        upcomingEvents.push(entry);
      }
    }

    // Also check maturity date
    const maturityDate = report.staticData?.maturityDate ? new Date(report.staticData.maturityDate) : null;
    if (maturityDate && !isNaN(maturityDate.getTime()) &&
        maturityDate >= thirtyDaysAgo && maturityDate <= thirtyDaysFromNow) {
      const daysFromNow = Math.ceil((maturityDate - now) / (1000 * 60 * 60 * 24));
      const entry = {
        productName,
        productIsin,
        eventType: 'maturity',
        eventDate: maturityDate,
        description: 'Maturity / Redemption',
        details: { maturity: true },
        daysUntil: daysFromNow,
        status: maturityDate < now ? 'completed' : 'upcoming'
      };
      if (maturityDate < now) {
        pastEvents.push(entry);
      } else {
        upcomingEvents.push(entry);
      }
    }
  }

  // Sort: past by most recent first, upcoming by soonest first
  pastEvents.sort((a, b) => b.eventDate - a.eventDate);
  upcomingEvents.sort((a, b) => a.eventDate - b.eventDate);
  return { past: pastEvents, upcoming: upcomingEvents };
}

/**
 * Gather news for the biggest-moving SP underlyings.
 * Extracts unique tickers from SP reports, ranks by absolute performance, fetches news for top movers.
 */
async function gatherSPUnderlyingNews(spReports) {
  const tickerPerformance = {};

  for (const report of Object.values(spReports)) {
    if (!report?.templateResults?.underlyings) continue;
    for (const u of report.templateResults.underlyings) {
      const shortTicker = u.ticker || (u.fullTicker ? u.fullTicker.split('.')[0] : null);
      if (!shortTicker) continue;
      const perf = Math.abs(u.performance || 0);
      // Keep the biggest absolute move per ticker (keyed by short ticker for matching)
      if (!tickerPerformance[shortTicker] || perf > tickerPerformance[shortTicker].absPerf) {
        tickerPerformance[shortTicker] = {
          ticker: shortTicker,
          fullTicker: u.fullTicker,
          name: u.name,
          performance: u.performance,
          absPerf: perf,
          performanceFormatted: u.performanceFormatted
        };
      }
    }
  }

  // Sort by absolute performance, take top 8 biggest movers
  const topMovers = Object.values(tickerPerformance)
    .sort((a, b) => b.absPerf - a.absPerf)
    .slice(0, 8);

  const news = {};
  for (const mover of topMovers) {
    const parts = (mover.fullTicker || mover.ticker).split('.');
    const symbol = parts[0];
    const exchange = parts[1] || null;
    if (!symbol) continue;

    try {
      const articles = await EODApiHelpers.getSecurityNews(symbol, exchange, 2);
      if (articles && articles.length > 0) {
        // Key by short ticker (e.g. "AMAT") to match buildPositionContext lookups
        news[mover.ticker] = {
          articles: articles.map(a => ({ title: a.title, date: a.date, snippet: (a.content || '').substring(0, 200) })),
          name: mover.name,
          performance: mover.performance,
          performanceFormatted: mover.performanceFormatted
        };
      }
    } catch (err) {
      console.warn(`[PortfolioReview] Failed to fetch SP underlying news for ${symbol}:`, err.message);
    }
  }

  console.log(`[PortfolioReview] SP underlying news gathered for ${Object.keys(news).length} tickers:`, Object.keys(news).join(', '));
  return news;
}

/**
 * Gather recently redeemed products (matured/autocalled/called) and possible upcoming redemptions.
 * Returns { recentRedemptions, possibleRedemptions }.
 */
async function gatherRedemptionData(spReports, holdings, viewAsFilter) {
  const recentRedemptions = [];
  const possibleRedemptions = [];
  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  // Build holding lookup for market value context (from active holdings)
  const holdingByProductId = {};
  for (const h of holdings) {
    if (h.linkedProductId) holdingByProductId[h.linkedProductId] = h;
  }

  // ALSO fetch inactive holdings with linked products for recently redeemed products
  // These are products that were autocalled/matured/called and removed from the active portfolio
  const inactiveQuery = { isLatest: true, isActive: false, linkedProductId: { $exists: true, $ne: null } };
  if (viewAsFilter?.id) {
    if (viewAsFilter.type === 'client') {
      inactiveQuery.userId = viewAsFilter.id;
    }
  }
  const inactiveHoldings = await PMSHoldingsCollection.find(inactiveQuery).fetchAsync();
  console.log(`[PortfolioReview] Found ${inactiveHoldings.length} inactive holdings with linked products`);

  // Fetch template reports for inactive holdings (these are the redeemed products)
  const inactiveProductIds = [...new Set(inactiveHoldings.map(h => h.linkedProductId))];
  const seenProductIds = new Set(Object.keys(spReports));

  for (const productId of inactiveProductIds) {
    if (seenProductIds.has(productId)) continue; // Already in spReports
    const report = await TemplateReportsCollection.findOneAsync(
      { productId },
      { sort: { createdAt: -1 } }
    );
    if (report?.templateResults) {
      const tr = report.templateResults;
      const status = tr.currentStatus || {};
      if (status.hasMatured || status.hasAutocalled || status.isCalled) {
        // This is a redeemed product not in active holdings - add to spReports temporarily
        spReports[productId] = report;
        // Also add inactive holding to lookup
        const inactiveH = inactiveHoldings.find(h => h.linkedProductId === productId);
        if (inactiveH) holdingByProductId[productId] = inactiveH;
      }
    }
  }

  for (const [productId, report] of Object.entries(spReports)) {
    if (!report?.templateResults) continue;
    const tr = report.templateResults;
    const status = tr.currentStatus || {};
    const structure = tr.phoenixStructure || tr.orionStructure || tr.participationStructure || {};
    const holding = holdingByProductId[productId];
    const imv = tr.indicativeMaturityValue;

    const productInfo = {
      productName: report.productName || 'Unknown',
      productIsin: report.productIsin || '',
      templateId: report.templateId || '',
      notional: holding?.quantity || 0,
      marketValue: holding?.marketValue || 0,
      currency: holding?.currency || report.staticData?.currency || 'EUR'
    };

    // Recently redeemed: matured, autocalled, or called
    if (status.hasMatured || status.hasAutocalled || status.isCalled) {
      let redemptionType = 'matured';
      let redemptionDate = null;
      let redemptionDetails = '';

      if (status.hasAutocalled) {
        redemptionType = 'autocalled';
        // Check statusDetails first (has structured autocall date info)
        if (status.statusDetails?.autocallDate) {
          redemptionDate = status.statusDetails.autocallDate;
          redemptionDetails = `Autocalled (${status.statusDetails.autocallDateFormatted || new Date(status.statusDetails.autocallDate).toLocaleDateString('en-GB')})`;
        } else {
          const oa = tr.observationAnalysis;
          if (oa?.callDateFormatted) {
            redemptionDate = oa.callDate || oa.callDateFormatted;
            redemptionDetails = `Autocalled at observation (${oa.callDateFormatted})`;
          }
        }
      } else if (status.isCalled) {
        redemptionType = 'called';
        if (status.statusDetails?.callDate) {
          redemptionDate = status.statusDetails.callDate;
          redemptionDetails = `Called by issuer at ${status.statusDetails.callPriceFormatted || '100%'}`;
        }
      } else {
        redemptionDate = report.staticData?.maturityDate;
        redemptionDetails = 'Reached maturity';
      }

      recentRedemptions.push({
        ...productInfo,
        redemptionType,
        redemptionDate: redemptionDate ? new Date(redemptionDate) : null,
        redemptionDetails,
        totalReturn: imv?.totalValueFormatted || null,
        couponsEarned: tr.observationAnalysis?.totalCouponsEarnedFormatted || null
      });
    }

    // Possible upcoming redemptions: next autocall observation within 30 days
    if (!status.hasMatured && !status.hasAutocalled && !status.isCalled) {
      const oa = tr.observationAnalysis;
      if (oa?.nextObservation) {
        const nextObs = new Date(oa.nextObservation);
        if (nextObs >= now && nextObs <= thirtyDaysFromNow) {
          // Check if autocall is possible
          const isAutocallable = structure.autocallBarrier != null;
          const underlyings = tr.underlyings || [];
          const worstPerf = underlyings.length > 0
            ? Math.min(...underlyings.map(u => u.performance || 0))
            : null;

          // For autocallable products, estimate likelihood based on current levels
          let autocallLikelihood = 'unknown';
          if (isAutocallable && worstPerf != null) {
            const autocallLevel = structure.autocallBarrier;
            const currentWorstLevel = 100 + worstPerf; // performance is relative to initial
            if (currentWorstLevel >= autocallLevel) {
              autocallLikelihood = 'likely';
            } else if (currentWorstLevel >= autocallLevel - 5) {
              autocallLikelihood = 'possible';
            } else {
              autocallLikelihood = 'unlikely';
            }
          }

          possibleRedemptions.push({
            ...productInfo,
            nextObservationDate: nextObs,
            observationType: 'autocall',
            autocallBarrier: structure.autocallBarrier,
            currentWorstPerformance: worstPerf,
            autocallLikelihood,
            couponsEarned: oa.totalCouponsEarnedFormatted || null,
            remainingObservations: oa.remainingObservations
          });
        }
      }

      // Also check maturity within 30 days
      const maturityDate = report.staticData?.maturityDate ? new Date(report.staticData.maturityDate) : null;
      if (maturityDate && maturityDate >= now && maturityDate <= thirtyDaysFromNow) {
        possibleRedemptions.push({
          ...productInfo,
          nextObservationDate: maturityDate,
          observationType: 'maturity',
          totalReturn: imv?.totalValueFormatted || null,
          capitalOutcome: imv?.capitalExplanation || null
        });
      }
    }
  }

  // Sort by date
  recentRedemptions.sort((a, b) => (b.redemptionDate || 0) - (a.redemptionDate || 0));
  possibleRedemptions.sort((a, b) => a.nextObservationDate - b.nextObservationDate);

  console.log(`[PortfolioReview] Redemptions: ${recentRedemptions.length} recent, ${possibleRedemptions.length} possible`);
  return { recentRedemptions, possibleRedemptions };
}

/**
 * Gather FX exposure breakdown
 */
function gatherFxExposure(holdings, ratesMap) {
  const exposure = {};

  for (const h of holdings) {
    const currency = h.currency || h.portfolioCurrency || 'EUR';
    const mv = h.marketValue || 0;
    const eurValue = convertToEUR(mv, h.portfolioCurrency || currency, ratesMap);

    if (!exposure[currency]) {
      exposure[currency] = { valueEUR: 0, positionCount: 0 };
    }
    exposure[currency].valueEUR += eurValue;
    exposure[currency].positionCount += 1;
  }

  const totalEUR = Object.values(exposure).reduce((sum, e) => sum + e.valueEUR, 0);

  return Object.entries(exposure)
    .map(([currency, data]) => ({
      currency,
      valueEUR: data.valueEUR,
      percentOfTotal: totalEUR > 0 ? (data.valueEUR / totalEUR) * 100 : 0,
      positionCount: data.positionCount
    }))
    .sort((a, b) => b.valueEUR - a.valueEUR);
}

// ============================================================================
// AI GENERATION PHASE
// ============================================================================

/**
 * Generate Macro Analysis with web search
 */
async function generateMacroAnalysis(data, language) {
  const langInstruction = language === 'fr'
    ? '\n\nLANGUAGE: Write the ENTIRE analysis in FRENCH (Français).'
    : '';

  // Build news context from Brave Search
  const braveNews = data.braveNews || {};
  let newsContext = '';
  if (braveNews.macroNews?.length > 0 || braveNews.centralBankNews?.length > 0) {
    newsContext = '\nRECENT MARKET NEWS (from Brave Search - use these as factual references):\n';
    if (braveNews.macroNews?.length > 0) {
      newsContext += 'Market Updates:\n' + formatBraveResults(braveNews.macroNews, 5) + '\n';
    }
    if (braveNews.centralBankNews?.length > 0) {
      newsContext += 'Central Bank / Rates:\n' + formatBraveResults(braveNews.centralBankNews, 3) + '\n';
    }
  }

  const prompt = `You are a senior investment strategist at a private bank preparing a macro market overview for a client portfolio review meeting.

PORTFOLIO CONTEXT:
- Total portfolio value: EUR ${(data.totalValueEUR || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
- Number of positions: ${data.positionCount}
- Asset allocation: Cash ${data.allocation?.cash?.toFixed(1) || 0}%, Bonds ${data.allocation?.bonds?.toFixed(1) || 0}%, Equities ${data.allocation?.equities?.toFixed(1) || 0}%, Alternative ${data.allocation?.alternative?.toFixed(1) || 0}%
- Key currency exposures: ${data.topCurrencies || 'EUR-based'}
${newsContext}
TASK:
Write a concise macro market overview (3-4 paragraphs, 300-500 words) covering:

1. **Global Market Environment**: Current state of global equity and fixed income markets, key trends
2. **Key Risks & Opportunities**: Major macro factors (interest rates, inflation, geopolitics) affecting the portfolio
3. **Regional Focus**: Focus on markets/regions relevant to the portfolio's holdings
4. **Outlook**: Brief forward-looking perspective

Use the recent news provided above as factual references to provide specific, up-to-date commentary. Also use web search to complement with additional current market data. Reference specific indices, rates, or events with dates.

TONE: Professional, balanced, institutional quality. Similar to JP Morgan Private Banking quarterly outlook.
${langInstruction}

Write the macro analysis now:`;

  try {
    return await callAnthropicAPI(prompt, 3000, { useWebSearch: true });
  } catch (error) {
    console.error('[PortfolioReview] Macro analysis failed:', error.message);
    return language === 'fr'
      ? 'Analyse macro temporairement indisponible.'
      : 'Macro analysis temporarily unavailable.';
  }
}

/**
 * Generate position analyses in batches
 */
async function generatePositionAnalyses(groupedHoldings, spReports, marketData, equityNews, spUnderlyingNews, braveNews, language) {
  const langInstruction = language === 'fr'
    ? '\nLANGUAGE: Write ALL commentary in FRENCH (Français).'
    : '';

  const analyses = [];

  // Helper to build position context
  function buildPositionContext(holding, type) {
    const h = holding;
    let context = `- ${h.securityName || 'Unknown'} (${h.isin || 'N/A'})
  Type: ${type}
  Currency: ${h.currency || 'EUR'}
  Market Value: ${(h.marketValue || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ${h.portfolioCurrency || h.currency || 'EUR'}
  Weight: ${h._weightPercent?.toFixed(2) || 'N/A'}%
  Cost Basis: ${(h.costBasisPortfolioCurrency || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ${h.portfolioCurrency || 'EUR'}
  Unrealized P&L: ${h._unrealizedPnLPercent?.toFixed(2) || 'N/A'}%`;

    // Add structured product data from template report
    if (type === 'Structured Product' && h.linkedProductId && spReports[h.linkedProductId]) {
      const report = spReports[h.linkedProductId];
      const tr = report.templateResults || {};
      const underlyings = tr.underlyings || [];
      const status = tr.currentStatus || {};

      // Product structure info (varies by template type)
      const structure = tr.phoenixStructure || tr.orionStructure || tr.participationStructure || {};
      const templateId = report.templateId || '';

      context += `\n  Template: ${templateId}`;
      context += `\n  Product Status: ${status.productStatus || 'active'}`;
      if (status.hasMatured) context += ' (MATURED)';
      if (status.hasAutocalled) context += ' (AUTOCALLED)';
      if (status.isCalled) context += ` (CALLED by issuer${status.statusDetails?.callPriceFormatted ? ' at ' + status.statusDetails.callPriceFormatted : ''})`;
      context += `\n  Days to Maturity: ${status.daysToMaturityText || 'N/A'}`;

      // Capital protection / barrier structure
      if (structure.capitalGuaranteed) {
        context += `\n  CAPITAL GUARANTEED: ${structure.capitalGuaranteed}%`;
      }
      if (structure.protectionBarrier) {
        context += `\n  Protection Barrier: ${structure.protectionBarrier}%`;
      }
      if (structure.autocallBarrier) {
        context += `\n  Autocall Barrier: ${structure.autocallBarrier}%`;
      }
      if (structure.upperBarrier) {
        context += `\n  Upper Barrier / Cap: ${structure.upperBarrier}% (gains capped above this level)`;
      }
      if (structure.couponRate) {
        context += `\n  Coupon Rate: ${structure.couponRate}% per period`;
      }
      if (structure.memoryCoupon) {
        context += `\n  Memory Coupon: Yes (missed coupons can be recovered)`;
      }
      if (structure.participationRate) {
        context += `\n  Participation Rate: ${structure.participationRateFormatted || structure.participationRate + '%'}`;
      }
      if (structure.rebate) {
        context += `\n  Rebate: ${structure.rebate}%`;
      }

      // Underlyings with performance and barrier distances
      if (underlyings.length > 0) {
        context += '\n  Underlyings:';
        for (const u of underlyings) {
          let uLine = `\n    ${u.ticker || u.symbol}: ${u.performanceFormatted || (u.performance?.toFixed(2) + '%') || 'N/A'}`;
          if (u.distanceToBarrierFormatted) {
            uLine += `, Distance to Barrier: ${u.distanceToBarrierFormatted} (${u.barrierStatusText || ''})`;
          }
          if (u.isWorstPerforming) uLine += ' [WORST OF]';
          context += uLine;
        }
      }

      // Observation analysis
      if (tr.observationAnalysis) {
        const oa = tr.observationAnalysis;
        context += `\n  Coupons Earned: ${oa.totalCouponsEarnedFormatted || (oa.totalCouponsEarned?.toFixed(2) + '%') || '0%'}`;
        if (oa.totalMemoryCoupons > 0) {
          context += `\n  Memory Coupons Pending: ${oa.totalMemoryCouponsFormatted || oa.totalMemoryCoupons + '%'}`;
        }
        context += `\n  Observations: ${(oa.totalObservations - (oa.remainingObservations || 0))}/${oa.totalObservations} completed, ${oa.remainingObservations || 0} remaining`;
        if (oa.nextObservation) {
          context += `\n  Next Observation: ${new Date(oa.nextObservation).toLocaleDateString('en-GB')}`;
        }
      }

      // Indicative maturity value
      const imv = tr.indicativeMaturityValue;
      if (imv) {
        context += `\n  Indicative Maturity Value: ${imv.totalValueFormatted || imv.totalValue?.toFixed(2) + '%' || 'N/A'}`;
        if (imv.capitalExplanation) {
          context += `\n  Capital Outcome: ${imv.capitalExplanation}`;
        }
      }

      // Existing AI commentary (already product-specific)
      if (report._commentary) {
        context += `\n  AI PRODUCT REPORT (use this as primary source for commentary):\n  ${report._commentary.substring(0, 500)}`;
      }

      // Add news for big-moving underlyings
      if (underlyings.length > 0) {
        const bigMoverNews = [];
        for (const u of underlyings) {
          const ticker = u.ticker || u.symbol;
          if (ticker && spUnderlyingNews[ticker] && Math.abs(u.performance || 0) > 10) {
            const newsData = spUnderlyingNews[ticker];
            bigMoverNews.push({ ticker, articles: newsData.articles });
          }
        }
        if (bigMoverNews.length > 0) {
          context += '\n  NEWS ON BIG MOVERS (use this to explain performance drivers):';
          for (const { ticker, articles } of bigMoverNews) {
            articles.slice(0, 2).forEach((article, i) => {
              const date = article.date ? new Date(article.date).toLocaleDateString() : 'Recent';
              context += `\n    ${ticker} [${date}]: ${article.title}`;
              if (article.snippet) {
                context += `\n      Summary: ${article.snippet}`;
              }
            });
          }
        }
      }
    }

    // Add equity market data
    if (type === 'Equity' && marketData[h._id]) {
      const md = marketData[h._id];
      context += `\n  SMA20: ${md.sma20?.toFixed(2) || 'N/A'}, SMA50: ${md.sma50?.toFixed(2) || 'N/A'}, SMA200: ${md.sma200?.toFixed(2) || 'N/A'}`;
      context += `\n  52W High: ${md.high52Week?.toFixed(2) || 'N/A'}, 52W Low: ${md.low52Week?.toFixed(2) || 'N/A'}`;
    }

    // Add equity news (EOD API)
    if (type === 'Equity' && equityNews[h._id]) {
      context += '\n  Recent News:';
      equityNews[h._id].slice(0, 2).forEach((article, i) => {
        const date = article.date ? new Date(article.date).toLocaleDateString() : 'Recent';
        context += `\n    ${i + 1}. [${date}] ${article.title}`;
        if (article.content) {
          context += `\n       ${article.content.substring(0, 200)}`;
        }
      });
    }

    // Add Brave Search news for equities
    if (type === 'Equity' && braveNews?.equityNews?.[h._id]) {
      const braveEquity = braveNews.equityNews[h._id];
      if (braveEquity.articles.length > 0) {
        context += '\n  Web Search News (Brave):';
        braveEquity.articles.slice(0, 3).forEach(a => {
          const age = a.age ? ` (${a.age})` : '';
          context += `\n    - ${a.title}${age}: ${a.description}`;
        });
      }
    }

    // Add Brave Search news for SP underlyings (detailed - include descriptions for analyst views/reasons)
    if (type === 'Structured Product' && braveNews?.spUnderlyingNews) {
      const spUnderlyings = spReports[h.linkedProductId]?.templateResults?.underlyings || [];
      const braveUnderlyingContext = [];
      for (const u of spUnderlyings) {
        const ticker = u.ticker || (u.fullTicker ? u.fullTicker.split('.')[0] : null);
        if (ticker && braveNews.spUnderlyingNews[ticker]?.length > 0) {
          braveUnderlyingContext.push({
            ticker,
            name: u.name || ticker,
            performance: u.performance,
            articles: braveNews.spUnderlyingNews[ticker]
          });
        }
      }
      if (braveUnderlyingContext.length > 0) {
        context += '\n  WEB SEARCH — UNDERLYING NEWS & ANALYST VIEWS (use this to explain performance and outlook):';
        for (const { ticker, name, performance, articles } of braveUnderlyingContext) {
          const perfStr = performance != null ? ` [perf: ${performance > 0 ? '+' : ''}${performance.toFixed(1)}%]` : '';
          context += `\n    ${name} (${ticker})${perfStr}:`;
          articles.slice(0, 3).forEach(a => {
            const age = a.age ? ` (${a.age})` : '';
            context += `\n      - ${a.title}${age}`;
            if (a.description) {
              context += `\n        ${a.description}`;
            }
          });
        }
      }
    }

    // Add bond data
    if (type === 'Bond') {
      if (h.maturityDate) context += `\n  Maturity: ${new Date(h.maturityDate).toLocaleDateString()}`;
      if (h.couponRate) context += `\n  Coupon: ${h.couponRate}%`;
    }

    // Add Brave news for any non-equity holding with significant move (bonds, funds, other)
    if (type !== 'Equity' && type !== 'Structured Product' && braveNews?.holdingNews?.[h._id]) {
      const holdingNewsData = braveNews.holdingNews[h._id];
      if (holdingNewsData.articles.length > 0) {
        context += '\n  Web Search News (significant move detected):';
        holdingNewsData.articles.slice(0, 3).forEach(a => {
          const age = a.age ? ` (${a.age})` : '';
          context += `\n    - ${a.title}${age}: ${a.description}`;
        });
      }
    }

    // Flag significant move for any position type
    const pnlPercent = h._unrealizedPnLPercent || 0;
    if (Math.abs(pnlPercent) > 15) {
      context += `\n  *** SIGNIFICANT MOVE: ${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(1)}% unrealized P&L — explain what drove this move using available news ***`;
    }

    return context;
  }

  // Process all position types
  const typeMap = [
    ['Structured Product', groupedHoldings.structuredProducts],
    ['Equity', groupedHoldings.equities],
    ['Bond', groupedHoldings.bonds],
    ['Fund', groupedHoldings.funds],
    ['Other', groupedHoldings.other]
  ];

  for (const [typeName, holdingsList] of typeMap) {
    if (!holdingsList || holdingsList.length === 0) continue;

    // Process in batches of 5
    for (let i = 0; i < holdingsList.length; i += 5) {
      const batch = holdingsList.slice(i, i + 5);
      const positionsContext = batch.map(h => buildPositionContext(h, typeName)).join('\n\n');

      // Build type-specific prompt guidance
      let typeGuidance = '';
      let needsWebSearch = false;

      if (typeName === 'Structured Product') {
        // Check if any position in this batch has underlyings with significant moves
        const significantUnderlyings = [];
        for (const h of batch) {
          const report = spReports[h.linkedProductId || h._id];
          if (report?.templateResults?.underlyings) {
            for (const u of report.templateResults.underlyings) {
              const perf = u.performance || 0;
              if (Math.abs(perf) > 10) {
                const direction = perf < 0 ? 'DOWN' : 'UP';
                significantUnderlyings.push(`${u.ticker || u.name} ${direction} ${u.performanceFormatted || (perf.toFixed(1) + '%')}`);
                needsWebSearch = true;
              }
            }
          }
        }

        typeGuidance = `
STRUCTURED PRODUCT ANALYSIS RULES (CRITICAL):
- If an "AI PRODUCT REPORT" is provided, use it as your primary source. Summarize its key points concisely.
- CAPITAL GUARANTEED products: Focus on the upside scenario and return potential. Do NOT express worry about underlying performance drops - capital is protected. Mention the guarantee clearly.
- Products with UPPER BARRIER / CAP: Do NOT highlight that an underlying is performing strongly above the cap. Instead note that gains are capped at that level and the current position relative to the cap.
- For PHOENIX/AUTOCALLABLE products: Focus on barrier distances, coupon status (earned vs memory), autocall likelihood, and worst-of dynamics.
- For PARTICIPATION NOTES: Focus on participation rate, basket performance, and redemption outlook.
- Always mention: product status (live/matured/called/autocalled), key barrier levels, coupon income earned, and indicative maturity value.
- Frame the commentary around what matters for the client: capital safety, income received, and expected outcome at maturity.

UNDERLYING PERFORMANCE ANALYSIS (CRITICAL):
When "WEB SEARCH — UNDERLYING NEWS & ANALYST VIEWS" is provided for a structured product, you MUST:
1. For UNDERPERFORMING underlyings (negative performance): Explain WHY the stock dropped using the news provided — identify the key driver (earnings miss, sector downturn, regulatory issue, macro headwind, etc.). Then state the analyst consensus/outlook/price target if available. The client needs to understand if this is temporary or structural.
2. For OUTPERFORMING underlyings (strong positive performance): Briefly explain what drove the rally (AI demand, earnings beat, sector tailwind, etc.) and whether the product benefits (autocall likelihood, participation upside).
3. Always connect the underlying's situation back to the product's payoff: barrier distances, capital protection, coupon triggers.
${significantUnderlyings.length > 0 ? `
UNDERLYINGS WITH SIGNIFICANT MOVES IN THIS BATCH: ${significantUnderlyings.join(', ')}
The client expects a clear explanation for each of these moves — not just "the stock is down X%", but WHY and what the forward outlook is.
` : ''}`;
      } else if (typeName === 'Equity') {
        // For equities with significant moves (up or down), enable web search
        const bigMovers = batch.filter(h => Math.abs(h._unrealizedPnLPercent || 0) > 15);
        if (bigMovers.length > 0) {
          needsWebSearch = true;
          const moverDescriptions = bigMovers.map(h => {
            const pnl = h._unrealizedPnLPercent || 0;
            return `${h.securityName} (${pnl > 0 ? '+' : ''}${pnl.toFixed(1)}%)`;
          }).join(', ');
          typeGuidance = `
SIGNIFICANT MOVERS IN THIS BATCH: ${moverDescriptions}
IMPORTANT: For positions with significant moves, use the "Web Search News" provided and/or web search to:
1. Explain the KEY DRIVER behind the move (earnings, sector rotation, macro event, company news)
2. Provide the current analyst consensus or outlook
The client expects their advisor to know WHY positions moved significantly.
`;
        }
      } else {
        // For bonds, funds, other - check for significant moves too
        const bigMovers = batch.filter(h => Math.abs(h._unrealizedPnLPercent || 0) > 10);
        if (bigMovers.length > 0) {
          needsWebSearch = true;
          typeGuidance = `
IMPORTANT: Some positions in this batch have significant unrealized P&L. When "Web Search News" or "*** SIGNIFICANT MOVE ***" is flagged for a position, explain what likely drove the move using the news context provided. The client expects the advisor to understand and explain notable movements.
`;
        }
      }

      const prompt = `You are a senior wealth advisor preparing insightful position commentaries for a client portfolio review meeting. Your goal is to help the client understand each position's situation clearly.

POSITIONS (${typeName}):
${positionsContext}
${typeGuidance}
TASK:
For EACH position above, write an insightful commentary (2-4 sentences, 50-100 words) covering:
${typeName === 'Structured Product'
  ? `- Product structure and capital protection status
- Barrier distances and coupon/income status
- For EACH underlying with a significant move (>10% up or down): you MUST explain the REASON for the move using the web search news provided. Name the specific catalyst (e.g. "earnings miss", "AI capex concerns", "regulatory headwind", "strong Q3 revenue growth"). Then mention analyst outlook or price targets if available from the news.
- Connect underlying performance to product payoff: is the barrier at risk? Will the product autocall? Are coupons being paid?
- Expected outcome and any action needed`
  : `- Current performance assessment
- Key factors driving the position (news, technicals, macro context)
- Any noteworthy risk or opportunity`}

Format your response as a JSON array with objects containing:
- "isin": the position ISIN
- "commentary": the commentary text

TONE RULES (CRITICAL):
- Professional, factual, constructive. Write as a trusted advisor who is on top of the situation.
- NEVER use alarmist or catastrophic language. Even for positions with losses, frame the situation constructively.
- For losing positions: acknowledge the situation factually, explain the drivers, then focus on the outlook, recovery potential, or protective features.
- Use language like "remains under pressure" not "has collapsed"; "performance headwind" not "crisis"; "monitoring closely" not "alarming".
- The advisor should come across as knowledgeable and proactive - they understand why things happened and have a view on what's ahead.
- When news context is available, reference it to show awareness of market developments.
${langInstruction}

Write the commentaries now as a JSON array:`;

      try {
        const response = await callAnthropicAPI(prompt, needsWebSearch ? 3000 : 2000, needsWebSearch ? { useWebSearch: true } : {});

        // Parse JSON response
        let parsed = [];
        try {
          const jsonMatch = response.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          }
        } catch (parseErr) {
          console.warn('[PortfolioReview] Failed to parse position batch JSON, using raw text');
        }

        for (const h of batch) {
          const matchedCommentary = parsed.find(p => p.isin === h.isin);
          analyses.push({
            holdingId: h._id,
            isin: h.isin || '',
            securityName: h.securityName || 'Unknown',
            securityType: typeName.toUpperCase().replace(/ /g, '_'),
            assetClass: h.assetClass || 'other',
            currency: h.currency || 'EUR',
            marketValueEUR: h._marketValueEUR || h.marketValue || 0,
            weightPercent: h._weightPercent || 0,
            unrealizedPnLPercent: h._unrealizedPnLPercent || 0,
            commentary: matchedCommentary?.commentary || 'Commentary not available for this position.',
            analysisData: {
              marketData: marketData[h._id] || null,
              hasReport: !!(h.linkedProductId && spReports[h.linkedProductId]),
              hasNews: !!(equityNews[h._id])
            }
          });
        }
      } catch (error) {
        console.error(`[PortfolioReview] Position batch analysis failed:`, error.message);
        // Add positions with fallback commentary
        for (const h of batch) {
          analyses.push({
            holdingId: h._id,
            isin: h.isin || '',
            securityName: h.securityName || 'Unknown',
            securityType: typeName.toUpperCase().replace(/ /g, '_'),
            assetClass: h.assetClass || 'other',
            currency: h.currency || 'EUR',
            marketValueEUR: h._marketValueEUR || h.marketValue || 0,
            weightPercent: h._weightPercent || 0,
            unrealizedPnLPercent: h._unrealizedPnLPercent || 0,
            commentary: 'Commentary temporarily unavailable.',
            analysisData: {}
          });
        }
      }
    }
  }

  return analyses;
}

/**
 * Generate allocation analysis
 */
async function generateAllocationAnalysis(allocationData, language) {
  const langInstruction = language === 'fr'
    ? '\nLANGUAGE: Write in FRENCH (Français).'
    : '';

  const { currentAllocation, profileLimits, breaches } = allocationData;

  let profileContext = 'No risk profile defined for this account.';
  if (profileLimits) {
    profileContext = `Risk Profile: ${profileLimits.profileName}
Limits: Cash max ${profileLimits.maxCash}%, Bonds max ${profileLimits.maxBonds}%, Equities max ${profileLimits.maxEquities}%, Alternative max ${profileLimits.maxAlternative}%`;
  }

  let breachContext = 'No allocation breaches detected.';
  if (breaches.length > 0) {
    breachContext = 'BREACHES DETECTED:\n' + breaches.map(b =>
      `- ${b.category}: ${b.current.toFixed(1)}% (limit: ${b.limit}%, excess: ${b.excess.toFixed(1)}%)`
    ).join('\n');
  }

  const prompt = `You are a portfolio compliance officer reviewing asset allocation against investment policy limits.

CURRENT ALLOCATION:
- Cash: ${currentAllocation.cash.toFixed(1)}%
- Bonds: ${currentAllocation.bonds.toFixed(1)}%
- Equities: ${currentAllocation.equities.toFixed(1)}%
- Alternative: ${currentAllocation.alternative.toFixed(1)}%

${profileContext}

${breachContext}

TASK:
Write a concise allocation assessment (2-3 paragraphs, 150-250 words) covering:
1. Overall allocation balance and fit with profile
2. Any breaches requiring attention and remediation suggestions
3. Whether rebalancing is warranted
${langInstruction}

Write the assessment now:`;

  try {
    return await callAnthropicAPI(prompt, 1500);
  } catch (error) {
    console.error('[PortfolioReview] Allocation analysis failed:', error.message);
    return language === 'fr'
      ? 'Analyse d\'allocation temporairement indisponible.'
      : 'Allocation analysis temporarily unavailable.';
  }
}

/**
 * Generate FX analysis
 */
async function generateFxAnalysis(fxExposure, braveNews, language) {
  const langInstruction = language === 'fr'
    ? '\nLANGUAGE: Write in FRENCH (Français).'
    : '';

  const exposureText = fxExposure
    .map(e => `- ${e.currency}: EUR ${e.valueEUR.toLocaleString('en-US', { maximumFractionDigits: 0 })} (${e.percentOfTotal.toFixed(1)}%, ${e.positionCount} positions)`)
    .join('\n');

  // Add Brave FX news context
  let fxNewsContext = '';
  if (braveNews?.fxNews && Object.keys(braveNews.fxNews).length > 0) {
    fxNewsContext = '\nRECENT FX NEWS (from web search):\n';
    for (const [currency, articles] of Object.entries(braveNews.fxNews)) {
      if (articles.length > 0) {
        fxNewsContext += `EUR/${currency}:\n` + formatBraveResults(articles, 3) + '\n';
      }
    }
  }

  const prompt = `You are an FX strategist reviewing currency exposure for a private banking client.

CURRENCY EXPOSURE:
${exposureText}
${fxNewsContext}
TASK:
Write a brief FX assessment (2-3 paragraphs, 150-200 words) covering:
1. Concentration risks (any single currency over 30% besides EUR)
2. Hedging considerations for major non-EUR exposures
3. Current FX market outlook for the main currency pairs${fxNewsContext ? ' (use the recent news above for current context)' : ''}
${langInstruction}

Write the FX assessment now:`;

  try {
    return await callAnthropicAPI(prompt, 1500);
  } catch (error) {
    console.error('[PortfolioReview] FX analysis failed:', error.message);
    return language === 'fr'
      ? 'Analyse FX temporairement indisponible.'
      : 'FX analysis temporarily unavailable.';
  }
}

/**
 * Generate events schedule summary
 */
async function generateEventsScheduleSummary(eventsData, redemptionData, language) {
  const langInstruction = language === 'fr'
    ? '\nLANGUAGE: Write in FRENCH (Français).'
    : '';

  const { past, upcoming } = eventsData;
  const { recentRedemptions, possibleRedemptions } = redemptionData;

  if (past.length === 0 && upcoming.length === 0 && recentRedemptions.length === 0 && possibleRedemptions.length === 0) {
    return language === 'fr'
      ? 'Aucun événement de produit structuré dans les 30 derniers ou prochains jours.'
      : 'No structured product events in the last or next 30 days.';
  }

  let eventsText = '';

  // Recently redeemed products
  if (recentRedemptions.length > 0) {
    eventsText += 'RECENTLY REDEEMED PRODUCTS:\n';
    eventsText += recentRedemptions.map(r =>
      `- ${r.productName} (${r.productIsin}): ${r.redemptionDetails}${r.totalReturn ? ', Total return: ' + r.totalReturn : ''}${r.couponsEarned ? ', Coupons earned: ' + r.couponsEarned : ''}`
    ).join('\n');
    eventsText += '\n\n';
  }

  // Possible upcoming redemptions
  if (possibleRedemptions.length > 0) {
    eventsText += 'POSSIBLE UPCOMING REDEMPTIONS (next 30 days):\n';
    eventsText += possibleRedemptions.map(r => {
      if (r.observationType === 'maturity') {
        return `- ${r.productName} (${r.productIsin}): Maturity on ${r.nextObservationDate.toLocaleDateString('en-GB')}${r.totalReturn ? ', Expected return: ' + r.totalReturn : ''}`;
      }
      return `- ${r.productName} (${r.productIsin}): Autocall observation on ${r.nextObservationDate.toLocaleDateString('en-GB')}, Autocall level: ${r.autocallBarrier}%, Current worst: ${r.currentWorstPerformance?.toFixed(1)}%, Likelihood: ${r.autocallLikelihood}`;
    }).join('\n');
    eventsText += '\n\n';
  }

  // Recent observation events
  if (past.length > 0) {
    eventsText += 'RECENT OBSERVATION EVENTS (last 30 days):\n';
    eventsText += past.map(e =>
      `- ${e.productName} (${e.productIsin}): ${e.description || e.eventType} on ${e.eventDate.toLocaleDateString('en-GB')} (${Math.abs(e.daysUntil)} days ago)`
    ).join('\n');
    eventsText += '\n\n';
  }

  // Upcoming observation events
  if (upcoming.length > 0) {
    eventsText += 'UPCOMING OBSERVATION EVENTS (next 30 days):\n';
    eventsText += upcoming.map(e =>
      `- ${e.productName} (${e.productIsin}): ${e.description || e.eventType} on ${e.eventDate.toLocaleDateString('en-GB')} (in ${e.daysUntil} days)`
    ).join('\n');
  }

  const prompt = `You are a structured products specialist summarizing recent and upcoming events for a client meeting.

${eventsText}

TASK:
Write an events summary (4-5 paragraphs, 300-500 words) covering:
1. Products recently redeemed (matured, autocalled, or called by issuer) - highlight the outcome for the client
2. Products that may redeem in the next 30 days - discuss autocall likelihood based on current levels
3. Recent observation events - coupon payments received, observation results
4. Upcoming observation dates the client should be aware of
5. Any actions or reinvestment decisions needed based on upcoming maturities or redemptions
${langInstruction}

Write the events summary now:`;

  try {
    return await callAnthropicAPI(prompt, 2000);
  } catch (error) {
    console.error('[PortfolioReview] Events summary failed:', error.message);
    return language === 'fr'
      ? 'Résumé des événements temporairement indisponible.'
      : 'Events summary temporarily unavailable.';
  }
}

/**
 * Generate cash analysis
 */
async function generateCashAnalysis(cashData, totalPortfolioValue, language) {
  const langInstruction = language === 'fr'
    ? '\nLANGUAGE: Write in FRENCH (Français).'
    : '';

  const cashPercent = totalPortfolioValue > 0
    ? (cashData.pureCashEUR / totalPortfolioValue) * 100
    : 0;

  const currencyBreakdown = Object.entries(cashData.cashByCurrency || {})
    .map(([ccy, val]) => `- ${ccy}: ${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
    .join('\n') || 'No cash breakdown available';

  const prompt = `You are a wealth manager assessing cash positioning for portfolio optimization.

CASH POSITION:
- Pure Cash: EUR ${cashData.pureCashEUR.toLocaleString('en-US', { maximumFractionDigits: 0 })}
- Cash + Equivalents: EUR ${cashData.totalCashEquivalentEUR.toLocaleString('en-US', { maximumFractionDigits: 0 })}
- Cash as % of Portfolio: ${cashPercent.toFixed(1)}%
- Total Portfolio Value: EUR ${totalPortfolioValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}

CASH BY CURRENCY:
${currencyBreakdown}

TASK:
Write a cash position assessment (2-3 paragraphs, 150-250 words) covering:
1. Whether cash levels are appropriate (typically 3-10% is normal)
2. Cash deployment opportunities given current market conditions
3. Any idle cash that could be put to work
${langInstruction}

Write the cash assessment now:`;

  try {
    return await callAnthropicAPI(prompt, 1500);
  } catch (error) {
    console.error('[PortfolioReview] Cash analysis failed:', error.message);
    return language === 'fr'
      ? 'Analyse de trésorerie temporairement indisponible.'
      : 'Cash analysis temporarily unavailable.';
  }
}

/**
 * Generate investment recommendations with web search for current context
 */
async function generateRecommendations(allSections, data, language) {
  const langInstruction = language === 'fr'
    ? '\n\nLANGUAGE: Write ALL recommendations in FRENCH (Français).'
    : '';

  // Build summary of all prior sections
  const sectionSummaries = [];

  if (allSections.macro) {
    sectionSummaries.push(`MACRO CONTEXT:\n${allSections.macro.substring(0, 500)}`);
  }
  if (allSections.allocation) {
    sectionSummaries.push(`ALLOCATION STATUS:\nCash: ${data.allocation?.cash?.toFixed(1)}%, Bonds: ${data.allocation?.bonds?.toFixed(1)}%, Equities: ${data.allocation?.equities?.toFixed(1)}%, Alternative: ${data.allocation?.alternative?.toFixed(1)}%`);
    if (allSections.allocationBreaches?.length > 0) {
      sectionSummaries.push(`BREACHES: ${allSections.allocationBreaches.map(b => `${b.category} excess ${b.excess.toFixed(1)}%`).join(', ')}`);
    }
  }
  if (allSections.cashPercent !== undefined) {
    sectionSummaries.push(`CASH LEVEL: ${allSections.cashPercent.toFixed(1)}% of portfolio (EUR ${allSections.pureCashEUR?.toLocaleString('en-US', { maximumFractionDigits: 0 })})`);
  }
  if (allSections.eventCount > 0) {
    sectionSummaries.push(`STRUCTURED PRODUCT EVENTS: ${allSections.eventCount} observation events in the last/next 30 days`);
  }
  if (allSections.recentRedemptions?.length > 0) {
    sectionSummaries.push(`RECENTLY REDEEMED:\n${allSections.recentRedemptions.join('\n')}`);
  }
  if (allSections.possibleRedemptions?.length > 0) {
    sectionSummaries.push(`POSSIBLE UPCOMING REDEMPTIONS:\n${allSections.possibleRedemptions.join('\n')}`);
  }

  // Add Brave macro news for recommendations context
  const braveNews = data.braveNews || {};
  let newsContext = '';
  if (braveNews.macroNews?.length > 0) {
    newsContext = '\nCURRENT MARKET CONTEXT (from Brave Search):\n' + formatBraveResults(braveNews.macroNews, 4) + '\n';
  }
  if (braveNews.centralBankNews?.length > 0) {
    newsContext += 'Central Bank Updates:\n' + formatBraveResults(braveNews.centralBankNews, 3) + '\n';
  }

  const prompt = `You are a senior private banker preparing actionable investment recommendations for a client portfolio review meeting.

PORTFOLIO OVERVIEW:
- Total Value: EUR ${(data.totalValueEUR || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
- Positions: ${data.positionCount}

${sectionSummaries.join('\n\n')}
${newsContext}
TOP HOLDINGS BY WEIGHT:
${(data.topHoldings || []).map(h => `- ${h.name}: ${h.weight?.toFixed(1)}% (${h.type})`).join('\n')}

TASK:
Write 4-6 specific, actionable investment recommendations (400-600 words total) structured as:

1. **Priority Actions**: Immediate items requiring attention (breaches, excessive risk)
2. **Portfolio Optimization**: Rebalancing suggestions, sector tilts, yield enhancement
3. **New Opportunities**: Ideas aligned with current market conditions and client profile
4. **Risk Management**: Hedging, diversification, or protection strategies to consider

Each recommendation should be specific (mentioning asset classes, regions, or strategies) rather than generic.

TONE: Confident, professional, action-oriented. Like a JP Morgan Private Banking investment letter.
- Frame recommendations constructively - the advisor is proactive and has a clear plan.
- Never make the advisor or previous investment decisions look bad. Focus on forward-looking opportunities.
- For positions with losses: frame as "opportunities to optimize" or "monitor for recovery", not as past mistakes.
${langInstruction}

Write the recommendations now:`;

  try {
    return await callAnthropicAPI(prompt, 3000, { useWebSearch: true });
  } catch (error) {
    console.error('[PortfolioReview] Recommendations generation failed:', error.message);
    return language === 'fr'
      ? 'Recommandations temporairement indisponibles.'
      : 'Recommendations temporarily unavailable.';
  }
}

/**
 * Final consistency check - reviews all generated sections for factual inconsistencies
 * and corrects them before delivering the report.
 */
async function runConsistencyCheck(reviewId, allGeneratedContent, factualData, language) {
  const langInstruction = language === 'fr'
    ? '\nLANGUAGE: Write ALL corrections in FRENCH (Français). Return corrected text in French.'
    : '';

  // Build a factual reference from the actual data
  const factualReference = [];

  // Redemption data facts
  if (factualData.recentRedemptions?.length > 0) {
    factualReference.push('REDEMPTION FACTS (from actual data):');
    for (const r of factualData.recentRedemptions) {
      let fact = `- ${r.productName} (${r.productIsin}): ${r.redemptionType}`;
      if (r.redemptionDetails) fact += `, ${r.redemptionDetails}`;
      if (r.totalReturn) fact += `, Total return value: ${r.totalReturn}`;
      if (r.couponsEarned) fact += `, Coupons earned: ${r.couponsEarned}`;
      fact += `, Notional: ${r.notional}, Market value: ${r.marketValue} ${r.currency}`;
      factualReference.push(fact);
    }
  }

  // Allocation facts
  if (factualData.allocation) {
    factualReference.push(`\nALLOCATION FACTS: Cash ${factualData.allocation.cash?.toFixed(1)}%, Bonds ${factualData.allocation.bonds?.toFixed(1)}%, Equities ${factualData.allocation.equities?.toFixed(1)}%, Alternative ${factualData.allocation.alternative?.toFixed(1)}%`);
  }

  // Cash facts
  if (factualData.cashData) {
    factualReference.push(`CASH FACTS: Pure cash EUR ${factualData.cashData.pureCashEUR?.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  }

  // Portfolio facts
  factualReference.push(`PORTFOLIO FACTS: Total value EUR ${factualData.totalValueEUR?.toLocaleString('en-US', { maximumFractionDigits: 0 })}, ${factualData.positionCount} positions`);

  // Position-level facts from SP reports
  if (factualData.spReportFacts?.length > 0) {
    factualReference.push('\nPOSITION FACTS (from actual report data):');
    factualReference.push(...factualData.spReportFacts);
  }

  const prompt = `You are a senior compliance editor performing a final quality check on a portfolio review report before it is delivered to a client. Your job is to find and fix any factual inconsistencies, mathematical errors, or contradictions.

FACTUAL REFERENCE DATA (these are the CORRECT numbers from the system):
${factualReference.join('\n')}

GENERATED REPORT SECTIONS TO CHECK:

=== EVENTS / REDEMPTIONS SECTION ===
${allGeneratedContent.events || 'N/A'}

=== ALLOCATION SECTION ===
${allGeneratedContent.allocation || 'N/A'}

=== CASH SECTION ===
${allGeneratedContent.cash || 'N/A'}

=== MACRO SECTION ===
${allGeneratedContent.macro || 'N/A'}

=== RECOMMENDATIONS ===
${allGeneratedContent.recommendations || 'N/A'}

=== POSITION COMMENTARIES ===
${allGeneratedContent.positions || 'N/A'}

TASK:
1. Compare every numerical claim in the report against the factual reference data above
2. Check for mathematical impossibilities (e.g., a product redeemed at 110% cannot have a 124% total return unless coupons account for the difference - verify)
3. Check for contradictions between sections
4. Check that allocation percentages mentioned match the factual data
5. Check that redemption descriptions match the actual data (redemption type, amounts, coupons)

Return your response as a JSON object with this format:
{
  "hasIssues": true/false,
  "corrections": [
    {
      "section": "events" | "allocation" | "cash" | "macro" | "recommendations" | "positions",
      "original": "the problematic sentence or paragraph",
      "corrected": "the corrected version",
      "reason": "brief explanation of what was wrong"
    }
  ]
}

If no issues are found, return: {"hasIssues": false, "corrections": []}
${langInstruction}

Perform the consistency check now:`;

  try {
    const response = await callAnthropicAPI(prompt, 3000);

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[PortfolioReview] Consistency check returned no JSON, assuming clean');
      return { hasIssues: false, corrections: [] };
    }

    const result = JSON.parse(jsonMatch[0]);
    console.log(`[PortfolioReview] Consistency check: ${result.hasIssues ? result.corrections.length + ' issues found' : 'clean'}`);
    return result;
  } catch (error) {
    console.warn('[PortfolioReview] Consistency check failed, proceeding without corrections:', error.message);
    return { hasIssues: false, corrections: [] };
  }
}

/**
 * Apply corrections from consistency check to the stored review sections
 */
async function applyCorrections(reviewId, corrections) {
  for (const correction of corrections) {
    const { section, original, corrected } = correction;
    if (!original || !corrected || !section) continue;

    // Handle position commentaries (stored in array)
    if (section === 'positions') {
      const review = await PortfolioReviewsCollection.findOneAsync(reviewId, { fields: { positionAnalyses: 1 } });
      if (!review?.positionAnalyses) continue;

      for (let i = 0; i < review.positionAnalyses.length; i++) {
        const pos = review.positionAnalyses[i];
        if (pos.commentary && pos.commentary.includes(original)) {
          const updatedCommentary = pos.commentary.replace(original, corrected);
          await PortfolioReviewsCollection.updateAsync(reviewId, {
            $set: { [`positionAnalyses.${i}.commentary`]: updatedCommentary }
          });
          console.log(`[PortfolioReview] Applied correction to position ${pos.name}: "${correction.reason}"`);
          break;
        }
      }
      continue;
    }

    // Map section names to DB field paths
    const fieldMap = {
      'events': 'eventsSchedule.content',
      'allocation': 'allocationAnalysis.content',
      'cash': 'cashAnalysis.content',
      'macro': 'macroAnalysis.content',
      'recommendations': 'recommendations.content'
    };

    const fieldPath = fieldMap[section];
    if (!fieldPath) continue;

    // Fetch current content and apply the correction
    const review = await PortfolioReviewsCollection.findOneAsync(reviewId, { fields: { [fieldPath]: 1 } });
    if (!review) continue;

    // Navigate to the nested field
    const parts = fieldPath.split('.');
    let currentContent = review;
    for (const part of parts) {
      currentContent = currentContent?.[part];
    }

    if (typeof currentContent === 'string' && currentContent.includes(original)) {
      const updatedContent = currentContent.replace(original, corrected);
      await PortfolioReviewsCollection.updateAsync(reviewId, {
        $set: { [fieldPath]: updatedContent }
      });
      console.log(`[PortfolioReview] Applied correction to ${section}: "${correction.reason}"`);
    }
  }
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

/**
 * Main portfolio review generation function.
 * Runs in background after method returns reviewId.
 */
export async function generatePortfolioReview(reviewId, accountFilter, viewAsFilter, language, userId) {
  const startTime = Date.now();

  try {
    console.log(`[PortfolioReview] Starting generation for review ${reviewId}`);

    // ========================================
    // PHASE 1: GATHER ALL DATA
    // ========================================
    await updateProgress(reviewId, 'gathering_data',
      language === 'fr' ? '0/8 Collecte des données du portefeuille...' : '0/8 Gathering portfolio data...', 0);

    const { all: allHoldings, grouped } = await gatherHoldings(accountFilter, viewAsFilter);
    console.log(`[PortfolioReview] Gathered ${allHoldings.length} holdings`);

    if (allHoldings.length === 0) {
      await PortfolioReviewsCollection.updateAsync(reviewId, {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
          portfolioSnapshot: { totalValueEUR: 0, positionCount: 0, accountCount: 0 },
          macroAnalysis: { content: language === 'fr' ? 'Aucune position trouvée dans ce portefeuille.' : 'No positions found in this portfolio.', generatedAt: new Date() },
          recommendations: { content: language === 'fr' ? 'Aucune recommandation - portefeuille vide.' : 'No recommendations - empty portfolio.', generatedAt: new Date() }
        }
      });
      return;
    }

    // Calculate total value and weights
    let totalValueEUR = 0;
    let totalCostBasisEUR = 0;
    const accountSet = new Set();

    for (const h of allHoldings) {
      const mv = h.marketValue || 0;
      totalValueEUR += mv;
      totalCostBasisEUR += h.costBasisPortfolioCurrency || 0;
      if (h.portfolioCode) accountSet.add(h.portfolioCode);
    }

    // Set weight percentages on holdings for use in prompts
    for (const h of allHoldings) {
      h._weightPercent = totalValueEUR > 0 ? ((h.marketValue || 0) / totalValueEUR) * 100 : 0;
      h._marketValueEUR = h.marketValue || 0;
      const cost = h.costBasisPortfolioCurrency || 0;
      h._unrealizedPnLPercent = cost > 0 ? (((h.marketValue || 0) - cost) / cost) * 100 : 0;
    }

    const portfolioSnapshot = {
      totalValueEUR,
      totalCostBasisEUR,
      unrealizedPnLEUR: totalValueEUR - totalCostBasisEUR,
      positionCount: allHoldings.length,
      accountCount: accountSet.size,
      dataDate: new Date()
    };

    await PortfolioReviewsCollection.updateAsync(reviewId, {
      $set: {
        portfolioSnapshot,
        'progress.totalPositions': allHoldings.length
      }
    });

    // Gather supplementary data in parallel
    await updateProgress(reviewId, 'gathering_supplementary',
      language === 'fr' ? '0/8 Collecte des données de marché...' : '0/8 Gathering market data...', 0);

    const [spReports, marketData, equityNews, allocationData, cashData] = await Promise.all([
      gatherStructuredProductData(allHoldings),
      gatherMarketData(grouped.equities),
      gatherEquityNews(grouped.equities),
      gatherAllocationData(allHoldings, accountFilter, viewAsFilter),
      gatherCashData(allHoldings)
    ]);

    // Extract events and redemption data from template reports (needs spReports to be ready)
    const eventsData = gatherEventsFromReports(spReports, allHoldings);
    const redemptionData = await gatherRedemptionData(spReports, allHoldings, viewAsFilter);

    // Fetch news for biggest-moving SP underlyings, FX exposure, and Brave news in parallel
    const fxExposureSync = gatherFxExposure(allHoldings, cashData.ratesMap);
    const [spUnderlyingNews, braveNews] = await Promise.all([
      gatherSPUnderlyingNews(spReports),
      gatherBraveNewsContext(grouped, spReports, fxExposureSync)
    ]);
    const fxExposure = fxExposureSync;

    // Top currencies for macro context
    const topCurrencies = fxExposure
      .filter(e => e.percentOfTotal > 5)
      .map(e => `${e.currency} (${e.percentOfTotal.toFixed(0)}%)`)
      .join(', ');

    // Top holdings for recommendations context
    const topHoldings = [...allHoldings]
      .sort((a, b) => (b._weightPercent || 0) - (a._weightPercent || 0))
      .slice(0, 10)
      .map(h => ({
        name: h.securityName || 'Unknown',
        weight: h._weightPercent,
        type: h.assetClass || h.securityType || 'other'
      }));

    // Shared data object for AI calls
    const sharedData = {
      totalValueEUR,
      positionCount: allHoldings.length,
      allocation: allocationData.currentAllocation,
      topCurrencies,
      topHoldings,
      braveNews
    };

    // ========================================
    // PHASE 2: AI GENERATION (sequential with progress updates)
    // completedSections matches the step number in the label for consistency
    // ========================================

    // Section 1: Macro Analysis
    await updateProgress(reviewId, 'macro_analysis',
      language === 'fr' ? '1/8 Analyse macro-économique...' : '1/8 Analyzing macro environment...', 1);

    const macroContent = await generateMacroAnalysis(sharedData, language);
    await PortfolioReviewsCollection.updateAsync(reviewId, {
      $set: { macroAnalysis: { content: macroContent, generatedAt: new Date() } }
    });

    // Section 2: Position Analyses
    await updateProgress(reviewId, 'position_analysis',
      language === 'fr' ? '2/8 Analyse des positions...' : '2/8 Analyzing positions...', 2);

    const positionAnalyses = await generatePositionAnalyses(
      grouped, spReports, marketData, equityNews, spUnderlyingNews, braveNews, language
    );
    await PortfolioReviewsCollection.updateAsync(reviewId, {
      $set: {
        positionAnalyses,
        'progress.positionsAnalyzed': positionAnalyses.length
      }
    });

    // Section 3: Allocation Analysis
    await updateProgress(reviewId, 'allocation_analysis',
      language === 'fr' ? '3/8 Vérification de l\'allocation...' : '3/8 Checking allocation compliance...', 3);

    const allocationContent = await generateAllocationAnalysis(allocationData, language);
    await PortfolioReviewsCollection.updateAsync(reviewId, {
      $set: {
        allocationAnalysis: {
          content: allocationContent,
          currentAllocation: allocationData.currentAllocation,
          profileLimits: allocationData.profileLimits,
          breaches: allocationData.breaches
        }
      }
    });

    // Section 4: FX Analysis
    await updateProgress(reviewId, 'fx_analysis',
      language === 'fr' ? '4/8 Analyse des devises...' : '4/8 Analyzing FX exposure...', 4);

    const fxContent = await generateFxAnalysis(fxExposure, braveNews, language);
    await PortfolioReviewsCollection.updateAsync(reviewId, {
      $set: {
        fxAnalysis: {
          content: fxContent,
          exposureByCurrency: fxExposure
        }
      }
    });

    // Section 5: Events Schedule
    await updateProgress(reviewId, 'events_schedule',
      language === 'fr' ? '5/8 Résumé des événements...' : '5/8 Summarizing events...', 5);

    const eventsContent = await generateEventsScheduleSummary(eventsData, redemptionData, language);
    await PortfolioReviewsCollection.updateAsync(reviewId, {
      $set: {
        eventsSchedule: {
          content: eventsContent,
          upcomingEvents: eventsData.upcoming,
          recentEvents: eventsData.past,
          recentRedemptions: redemptionData.recentRedemptions,
          possibleRedemptions: redemptionData.possibleRedemptions
        }
      }
    });

    // Section 6: Cash Analysis
    await updateProgress(reviewId, 'cash_analysis',
      language === 'fr' ? '6/8 Analyse de la trésorerie...' : '6/8 Analyzing cash position...', 6);

    const cashPercent = totalValueEUR > 0 ? (cashData.pureCashEUR / totalValueEUR) * 100 : 0;
    const cashContent = await generateCashAnalysis(cashData, totalValueEUR, language);
    await PortfolioReviewsCollection.updateAsync(reviewId, {
      $set: {
        cashAnalysis: {
          content: cashContent,
          pureCashEUR: cashData.pureCashEUR,
          totalCashEquivalentEUR: cashData.totalCashEquivalentEUR,
          cashAsPercentOfPortfolio: cashPercent,
          cashByCurrency: cashData.cashByCurrency
        }
      }
    });

    // Section 7: Recommendations
    await updateProgress(reviewId, 'recommendations',
      language === 'fr' ? '7/8 Génération des recommandations...' : '7/8 Generating recommendations...', 7);

    const recommendationsContent = await generateRecommendations(
      {
        macro: macroContent,
        allocation: allocationContent,
        allocationBreaches: allocationData.breaches,
        cashPercent,
        pureCashEUR: cashData.pureCashEUR,
        eventCount: eventsData.past.length + eventsData.upcoming.length,
        recentRedemptions: redemptionData.recentRedemptions.map(r => `${r.productName}: ${r.redemptionDetails}`),
        possibleRedemptions: redemptionData.possibleRedemptions.map(r => `${r.productName}: ${r.observationType} on ${r.nextObservationDate.toLocaleDateString('en-GB')} (${r.autocallLikelihood || 'maturity'})`)
      },
      sharedData,
      language
    );
    await PortfolioReviewsCollection.updateAsync(reviewId, {
      $set: { recommendations: { content: recommendationsContent, generatedAt: new Date() } }
    });

    // Section 8: Consistency Check (final quality pass)
    await updateProgress(reviewId, 'consistency_check',
      language === 'fr' ? '8/8 Vérification de cohérence...' : '8/8 Running consistency check...', 8);

    // Build position commentaries summary for consistency check
    const positionCommentaries = positionAnalyses
      .filter(p => p.commentary && p.commentary !== 'Commentary not available for this position.')
      .map(p => `${p.name} (${p.isin}): ${p.commentary}`)
      .join('\n\n');

    // Build position-level factual reference from SP reports
    const spReportFacts = Object.values(spReports).map(report => {
      const tr = report.templateReport || {};
      const imv = report.intrinsicMarketValue;
      const status = tr.status || {};
      const oa = tr.observationAnalysis;
      const facts = [`${report.staticData?.productName || 'Unknown'} (${report.staticData?.isin || '?'})`];
      if (status.hasMatured) facts.push('Status: matured');
      if (status.hasAutocalled) facts.push('Status: autocalled');
      if (imv?.totalValueFormatted) facts.push(`Total value: ${imv.totalValueFormatted}`);
      if (oa?.totalCouponsEarnedFormatted) facts.push(`Coupons earned: ${oa.totalCouponsEarnedFormatted}`);
      if (oa?.totalCouponsCount != null) facts.push(`Coupon count: ${oa.totalCouponsCount}`);
      if (imv?.capitalExplanation) facts.push(`Capital: ${imv.capitalExplanation}`);
      const underlyings = tr.underlyings || [];
      for (const u of underlyings) {
        if (u.performanceFormatted) facts.push(`${u.name || u.ticker}: perf ${u.performanceFormatted}`);
      }
      return `- ${facts.join(', ')}`;
    }).filter(f => f.length > 20);

    const consistencyResult = await runConsistencyCheck(
      reviewId,
      {
        events: eventsContent,
        allocation: allocationContent,
        cash: cashContent,
        macro: macroContent,
        recommendations: recommendationsContent,
        positions: positionCommentaries
      },
      {
        recentRedemptions: redemptionData.recentRedemptions,
        possibleRedemptions: redemptionData.possibleRedemptions,
        allocation: allocationData.currentAllocation,
        cashData,
        totalValueEUR,
        positionCount: allHoldings.length,
        spReportFacts
      },
      language
    );

    if (consistencyResult.hasIssues && consistencyResult.corrections?.length > 0) {
      await applyCorrections(reviewId, consistencyResult.corrections);
      console.log(`[PortfolioReview] Applied ${consistencyResult.corrections.length} consistency corrections`);
    }

    // ========================================
    // PHASE 3: COMPLETE
    // ========================================
    const processingTimeMs = Date.now() - startTime;
    await PortfolioReviewsCollection.updateAsync(reviewId, {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        processingTimeMs,
        'progress.currentStep': 'completed',
        'progress.currentStepLabel': language === 'fr' ? 'Revue terminée' : 'Review complete',
        'progress.completedSections': 8
      }
    });

    console.log(`[PortfolioReview] Review ${reviewId} completed in ${(processingTimeMs / 1000).toFixed(1)}s`);

  } catch (error) {
    // Don't overwrite cancelled status
    if (error.error === 'review-cancelled') {
      console.log(`[PortfolioReview] Review ${reviewId} was cancelled by user`);
      return;
    }

    console.error(`[PortfolioReview] Generation failed for ${reviewId}:`, error);
    const processingTimeMs = Date.now() - startTime;
    await PortfolioReviewsCollection.updateAsync(reviewId, {
      $set: {
        status: 'failed',
        completedAt: new Date(),
        processingTimeMs,
        'progress.currentStep': 'failed',
        'progress.currentStepLabel': `Error: ${error.message}`
      }
    });
    throw error;
  }
}
