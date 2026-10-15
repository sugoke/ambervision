import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ProductsCollection } from './products';
import { MarketDataCacheCollection } from './marketDataCache';
import { AllocationsCollection } from './allocations';
import { ClientEntityHelpers } from './clientEntities';
import { AthenaEvaluationHelpers } from './evaluators/athenaEvaluationHelpers';

/**
 * UnderlyingsAnalysis Collection
 * Stores pre-computed analysis of underlyings for barrier-protected products
 * (Phoenix, Athena, reverse convertibles, bonus certificates...; capital-guaranteed
 * products left out)
 * ONE document that contains the complete analysis, updated on-demand
 */
export const UnderlyingsAnalysisCollection = new Mongo.Collection('underlyingsAnalysis');

/**
 * Walk the history array (sorted ascending) backwards and return the close
 * on or before asOfDate. Falls back to { price: 0, lastUpdate: null } when no
 * data exists at or before that date.
 */
function priceAsOf(marketDataDoc, asOfDate) {
  if (!marketDataDoc?.history?.length) return { price: 0, lastUpdate: null };
  const target = asOfDate.getTime();
  for (let i = marketDataDoc.history.length - 1; i >= 0; i--) {
    const entry = marketDataDoc.history[i];
    const entryDate = entry.date instanceof Date ? entry.date : new Date(entry.date);
    if (entryDate.getTime() <= target) {
      return { price: entry.close, lastUpdate: entryDate };
    }
  }
  return { price: 0, lastUpdate: null };
}

export function isProductLiveAsOf(product, asOfDate) {
  const trade = product.tradeDate ? new Date(product.tradeDate) : null;
  const finalObs = (product.finalObservation || product.finalObservationDate)
    ? new Date(product.finalObservation || product.finalObservationDate)
    : null;
  const redeemed = product.redeemedAt ? new Date(product.redeemedAt) : null;

  if (trade && trade > asOfDate) return false;
  if (finalObs && finalObs < asOfDate) return false;
  if (redeemed && redeemed <= asOfDate) return false;
  return true;
}

function isAllocationOpenAsOf(allocation, asOfDate) {
  const allocated = allocation.allocatedAt ? new Date(allocation.allocatedAt) : null;
  if (allocated && allocated > asOfDate) return false;

  if (allocation.redeemedAt) {
    const redeemed = new Date(allocation.redeemedAt);
    if (redeemed <= asOfDate) return false;
  }

  if (allocation.status === 'cancelled') {
    const cancelledAt = allocation.lastModifiedAt ? new Date(allocation.lastModifiedAt) : null;
    if (!cancelledAt || cancelledAt <= asOfDate) return false;
  }

  return true;
}

/** Nominal invested per productId, summed over the given allocations. */
export function nominalByProductFrom(allocations) {
  const nominalByProduct = {};
  allocations.forEach(allocation => {
    if (!nominalByProduct[allocation.productId]) {
      nominalByProduct[allocation.productId] = 0;
    }
    nominalByProduct[allocation.productId] += allocation.nominalInvested || 0;
  });
  return nominalByProduct;
}

/**
 * Set productNotional and bubbleSize on each row from the given nominals.
 * Bubble sizes are scaled over the products present in the rows, so a scoped
 * set of rows is sized against its own notionals, never the firm's.
 */
export function applyNotionalSizing(rows, nominalByProduct) {
  const productIds = [...new Set(rows.map(r => r.productId))];
  const notionalAmounts = productIds
    .map(id => nominalByProduct[id] || 0)
    .filter(n => n > 0);

  const minNotional = notionalAmounts.length > 0 ? Math.min(...notionalAmounts) : 0;
  const maxNotional = notionalAmounts.length > 0 ? Math.max(...notionalAmounts) : 0;

  return rows.map(row => {
    const productNotional = nominalByProduct[row.productId] || 0;
    let bubbleSize = 8;
    if (maxNotional > minNotional && productNotional > 0) {
      const normalizedValue = (productNotional - minNotional) / (maxNotional - minNotional);
      bubbleSize = 5 + (normalizedValue * 15);
    }
    return { ...row, bubbleSize, productNotional };
  });
}

/** Summary counts for a set of analysis rows. */
export function summarizeUnderlyings(rows) {
  return {
    totalRows: rows.length,
    totalProducts: new Set(rows.map(u => u.productId)).size,
    uniqueUnderlyings: new Set(rows.map(u => u.symbol)).size,
    positivePerformance: rows.filter(u => u.performance > 0).length,
    negativePerformance: rows.filter(u => u.performance < 0).length,
    withProtection: rows.filter(u => u.hasProtection).length,
    belowBarrier: rows.filter(u => u.distanceToBarrier != null && u.distanceToBarrier < 0).length,
    warningZone: rows.filter(u => u.distanceToBarrier != null && u.distanceToBarrier >= 0 && u.distanceToBarrier < 10).length,
    safeZone: rows.filter(u => u.distanceToBarrier != null && u.distanceToBarrier >= 10).length
  };
}

const isPhoenix = (product) =>
  product.templateId === 'phoenix_autocallable' || product.template === 'phoenix_autocallable';

const positiveNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** True when the product carries a capital guarantee / protection level (Orion, participation notes, shark, Himalaya floor, twin win with CP). */
export function isCapitalGuaranteed(product) {
  const sp = product.structureParams || {};
  return [sp.capitalGuaranteed, sp.capitalGuarantee, sp.capitalProtection, sp.floor]
    .some(v => v === true || positiveNumber(v) != null);
}

/**
 * Level (% of initial) below which the capital is at risk, whatever the template
 * stores it as: Phoenix / reverse convertibles (protectionBarrierLevel), bonus
 * certificates (barrierLevel), twin win (lowerBarrier), Athena (final payoff
 * tiers), or a protection barrier item in the drag-and-drop structure.
 */
export function protectionBarrierOf(product) {
  const sp = product.structureParams || {};
  const direct = positiveNumber(sp.protectionBarrierLevel) ??
                 positiveNumber(sp.protectionBarrier) ??
                 positiveNumber(sp.barrierLevel) ??
                 positiveNumber(sp.lowerBarrier);
  if (direct != null) return direct;

  if (Array.isArray(sp.finalPayoffTiers) && sp.finalPayoffTiers.length > 0) {
    const level = AthenaEvaluationHelpers.capitalAtRiskLevel(sp.finalPayoffTiers);
    if (positiveNumber(level) != null) return level;
  }

  const item = (product.structure?.maturity || product.payoffStructure || []).find(
    i => i.type === 'barrier' && i.barrier_type === 'protection'
  );
  return item ? positiveNumber(item.barrier_level ?? item.level) : null;
}

/** Products the underlyings page follows: barrier-protected payoffs, capital-guaranteed ones left out. */
export function isBarrierProtectedProduct(product) {
  if (isCapitalGuaranteed(product)) return false;
  return isPhoenix(product) || protectionBarrierOf(product) != null;
}

/**
 * Live products, or the products live at a past date.
 */
export async function liveProducts(asOfDate = null) {
  if (asOfDate) {
    const allProducts = await ProductsCollection.find({}).fetchAsync();
    return allProducts.filter(p => isProductLiveAsOf(p, asOfDate));
  }
  return ProductsCollection.find({
    $or: [
      { status: { $in: ['live', 'Live', 'active', 'Active'] } },
      { productStatus: { $in: ['live', 'Live', 'active', 'Active'] } }
    ]
  }).fetchAsync();
}

/**
 * Client positions in the given products, from the bank files: the current
 * positions, or the positions on record at the end of asOfDate. A product
 * flagged live can be sold out of every account, held only by the demo client,
 * or never booked; none of those is a client exposure.
 * @param {Array} products - candidate products (_id, isin)
 * @param {Object|null} holdingsFilter - owner selector (a viewer's scope);
 *   null means every client, archived and demo clients left out
 * @param {Date|null} asOfDate
 * @returns {Promise<Map>} productId -> [{ quantity, costPrice }]
 */
export async function clientPositionsByProduct(products, holdingsFilter = null, asOfDate = null) {
  const byProduct = new Map();
  if (products.length === 0) return byProduct;

  const { PMSHoldingsCollection } = await import('./pmsHoldings');
  const owner = holdingsFilter || await ClientEntityHelpers.archivedHoldingsSelector();
  const productIdByIsin = new Map(products.filter(p => p.isin).map(p => [p.isin.toUpperCase(), p._id]));
  const ids = new Set(products.map(p => p._id));
  const inProducts = {
    $or: [
      { isin: { $in: [...productIdByIsin.keys()] } },
      { linkedProductId: { $in: [...ids] } }
    ]
  };

  let rows;
  if (asOfDate) {
    const { dropCarriedForward, endOfDay } = await import('../../server/helpers/holdingsAsOf.js');
    const dayEnd = endOfDay(asOfDate);
    const base = { $and: [owner, { isActive: true }] };
    const latestByKey = await PMSHoldingsCollection.rawCollection().aggregate([
      { $match: { $and: [owner, { isActive: true }, inProducts, { snapshotDate: { $lt: dayEnd } }] } },
      {
        $group: {
          _id: '$uniqueKey',
          top: {
            $top: {
              sortBy: { snapshotDate: -1, version: -1 },
              output: {
                uniqueKey: '$uniqueKey', bankId: '$bankId', portfolioCode: '$portfolioCode', snapshotDate: '$snapshotDate',
                clientCode: '$clientCode', entityId: '$entityId', userId: '$userId',
                isin: '$isin', linkedProductId: '$linkedProductId', quantity: '$quantity', costPrice: '$costPrice'
              }
            }
          }
        }
      }
    ], { allowDiskUse: true }).toArray();
    rows = await dropCarriedForward(latestByKey.map(d => d.top), dayEnd, base);
  } else {
    rows = await PMSHoldingsCollection.find(
      { $and: [owner, { isActive: true, isLatest: true }, inProducts] },
      { fields: { isin: 1, linkedProductId: 1, quantity: 1, costPrice: 1, portfolioCode: 1 } }
    ).fetchAsync();
  }

  for (const h of rows) {
    // Roll-up copies repeat the per-account positions
    if (h.portfolioCode === 'CONSOLIDATED' || !(h.quantity > 0)) continue;
    const productId = ids.has(h.linkedProductId) ? h.linkedProductId : productIdByIsin.get((h.isin || '').toUpperCase());
    if (!productId) continue;
    if (!byProduct.has(productId)) byProduct.set(productId, []);
    byProduct.get(productId).push({ quantity: h.quantity, costPrice: h.costPrice });
  }
  return byProduct;
}

/**
 * Initial level of each underlying as the product's latest evaluation resolved
 * it (stock splits and bonus shares adjusted, pence/pound scale checked), keyed
 * by product id then by full ticker and by ticker.
 */
async function resolvedInitialPrices(productIds) {
  const { TemplateReportsCollection } = await import('./templateReports');
  const rows = await TemplateReportsCollection.rawCollection().aggregate([
    { $match: { productId: { $in: productIds } } },
    {
      $group: {
        _id: '$productId',
        underlyings: {
          $top: {
            sortBy: { createdAt: -1 },
            output: {
              $map: {
                input: { $ifNull: ['$templateResults.underlyings', []] },
                as: 'u',
                in: { ticker: '$$u.ticker', fullTicker: '$$u.fullTicker', initialPrice: '$$u.initialPrice' }
              }
            }
          }
        }
      }
    }
  ], { allowDiskUse: true }).toArray();

  const byProduct = new Map();
  for (const r of rows) {
    const levels = new Map();
    for (const u of r.underlyings || []) {
      if (!(u.initialPrice > 0)) continue;
      if (u.fullTicker && !levels.has(u.fullTicker)) levels.set(u.fullTicker, u.initialPrice);
      if (u.ticker && !levels.has(u.ticker)) levels.set(u.ticker, u.initialPrice);
    }
    byProduct.set(r._id, levels);
  }
  return byProduct;
}

/**
 * Build the complete underlyings analysis document.
 * @param {Date|null} asOfDate - null/undefined means live (today). A Date triggers
 *   historical mode: products filtered by date, allocations filtered by date,
 *   prices read from MarketDataCacheCollection.history at or before asOfDate.
 * Only products clients hold in their bank positions are analysed (at the
 * date, in historical mode). Performance runs from the initial level the
 * product's evaluation resolved (split-adjusted) to the latest close.
 * @param {Object} [options]
 * @param {Object|null} [options.allocationsFilter] - extra allocations selector
 *   (a viewer's scope); notionals count those allocations only.
 * @param {Object|null} [options.holdingsFilter] - holdings owner selector (the
 *   same scope); only products held under it are analysed.
 * @returns {Promise<Object>} analysis doc (without _id)
 */
export async function buildUnderlyingsAnalysis(asOfDate = null, { allocationsFilter = null, holdingsFilter = null } = {}) {
  const isHistorical = asOfDate instanceof Date;
  const effectiveDate = isHistorical ? asOfDate : new Date();
  const mode = isHistorical ? `as-of ${asOfDate.toISOString().slice(0, 10)}` : 'live';

  console.log(`[UnderlyingsAnalysis] Starting generation (${mode})...`);
  const startTime = Date.now();

  const barrierProducts = (await liveProducts(isHistorical ? asOfDate : null)).filter(isBarrierProtectedProduct);
  const positions = await clientPositionsByProduct(barrierProducts, holdingsFilter, isHistorical ? asOfDate : null);
  const products = barrierProducts.filter(p => positions.has(p._id));
  const initialLevels = await resolvedInitialPrices(products.map(p => p._id));

  console.log(`[UnderlyingsAnalysis] ${products.length} of ${barrierProducts.length} barrier-protected products held in client positions (${mode})`);

  const marketDataCache = await MarketDataCacheCollection.find({}).fetchAsync();
  const marketDataMap = {};
  marketDataCache.forEach(item => {
    marketDataMap[item.fullTicker] = item;
    marketDataMap[item.symbol] = item;
  });

  console.log(`[UnderlyingsAnalysis] Loaded ${marketDataCache.length} market data entries`);

  // Exclude allocations of archived (closed-relationship) clients from exposure analysis
  const archivedAllocExclusion = await ClientEntityHelpers.archivedAllocationsSelector();
  const excludeArchived = (sel) => {
    const clauses = [sel];
    if (archivedAllocExclusion.$nor) clauses.push(archivedAllocExclusion);
    if (allocationsFilter) clauses.push(allocationsFilter);
    return clauses.length === 1 ? sel : { $and: clauses };
  };

  let allocations;
  if (isHistorical) {
    const allAllocs = await AllocationsCollection.find(excludeArchived({})).fetchAsync();
    allocations = allAllocs.filter(a => isAllocationOpenAsOf(a, asOfDate));
  } else {
    allocations = await AllocationsCollection.find(excludeArchived({ status: 'active' })).fetchAsync();
  }

  const nominalByProduct = nominalByProductFrom(allocations);

  console.log(`[UnderlyingsAnalysis] Loaded ${allocations.length} allocations (${mode})`);

  const underlyingsArray = [];

  for (const product of products) {
    const productUnderlyings = product.underlyings || [];

    if (productUnderlyings.length === 0 && product.payoffStructure) {
      const items = product.payoffStructure || [];
      items.forEach(item => {
        if (item.type === 'underlying') {
          if (item.isBasket && item.selectedSecurities) {
            item.selectedSecurities.forEach(security => {
              productUnderlyings.push({
                symbol: security.symbol,
                name: security.name || security.symbol,
                exchange: security.exchange,
                type: security.type || 'Stock',
                strikePrice: parseFloat(security.strikePrice) || null,
                weight: parseFloat(security.weight) || (100 / item.selectedSecurities.length)
              });
            });
          } else if (item.selectedSecurity) {
            const security = item.selectedSecurity;
            productUnderlyings.push({
              symbol: security.symbol,
              name: security.name || security.symbol,
              exchange: security.exchange,
              type: security.type || 'Stock',
              strikePrice: parseFloat(item.strikePrice) || null,
              weight: 100
            });
          }
        }
      });
    }

    const protectionBarrierLevel = protectionBarrierOf(product);
    const hasProtection = protectionBarrierLevel != null;

    for (const underlying of productUnderlyings) {
      const fullTicker = underlying.securityData?.ticker ||
                        underlying.fullTicker ||
                        (underlying.ticker && underlying.ticker.includes('.') ? underlying.ticker : null) ||
                        (underlying.symbol && underlying.exchange ? `${underlying.symbol}.${underlying.exchange}` : null);

      const symbol = underlying.symbol || underlying.ticker || underlying.securityData?.symbol;
      const name = underlying.name || underlying.securityData?.name || symbol;
      const exchange = underlying.securityData?.exchange || underlying.exchange;
      const levels = initialLevels.get(product._id);
      const strikePrice = levels?.get(fullTicker) || levels?.get(underlying.ticker) || levels?.get(symbol) ||
                          positiveNumber(underlying.strike) || positiveNumber(underlying.strikePrice);
      const tradeDate = product.tradeDate;
      const finalObservation = product.finalObservation || product.finalObservationDate;

      const currentMarketData = marketDataMap[fullTicker] ||
                               marketDataMap[underlying.ticker] ||
                               marketDataMap[symbol];

      let currentPrice;
      let lastUpdate;
      let hasMarketData;

      if (isHistorical) {
        const { price, lastUpdate: histDate } = priceAsOf(currentMarketData, asOfDate);
        currentPrice = price;
        lastUpdate = histDate;
        hasMarketData = price > 0;
      } else {
        currentPrice = currentMarketData?.cache?.latestPrice ||
                      currentMarketData?.price ||
                      0;
        hasMarketData = currentPrice > 0;
        lastUpdate = currentMarketData?.cache?.latestDate ||
                    currentMarketData?.lastUpdated ||
                    currentMarketData?.timestamp;
      }

      // No close or no initial level: no performance, rather than -100% or 0%
      const initialPrice = strikePrice || null;
      const performance = hasMarketData && initialPrice > 0 ? ((currentPrice - initialPrice) / initialPrice * 100) : null;
      if (!(initialPrice > 0)) hasMarketData = false;

      const daysToFinalObservation = finalObservation
        ? Math.ceil((new Date(finalObservation) - effectiveDate) / (1000 * 60 * 60 * 24))
        : 0;

      let distanceToBarrier = null;
      let riskZone = 'none';
      let riskZoneLabel = performance == null ? 'No Price' : 'No Barrier';

      if (protectionBarrierLevel != null && performance != null) {
        distanceToBarrier = performance - (protectionBarrierLevel - 100);

        if (distanceToBarrier < 0) {
          riskZone = 'danger';
          riskZoneLabel = 'Below Barrier';
        } else if (distanceToBarrier < 10) {
          riskZone = 'warning';
          riskZoneLabel = 'Warning Zone';
        } else {
          riskZone = 'safe';
          riskZoneLabel = 'Safe';
        }
      }

      underlyingsArray.push({
        symbol,
        fullTicker,
        ticker: fullTicker,
        name,
        exchange,
        type: underlying.type || 'Stock',

        productId: product._id,
        productTitle: product.title,
        productIsin: product.isin,
        productCurrency: product.currency || 'USD',
        tradeDate,
        finalObservation,
        weight: underlying.weight || 100,

        currentPrice,
        currentPriceFormatted: currentPrice > 0 ? currentPrice.toFixed(2) : null,
        initialPrice,
        initialPriceFormatted: initialPrice > 0 ? initialPrice.toFixed(2) : null,
        hasMarketData,
        lastUpdate,
        lastUpdateFormatted: lastUpdate ? new Date(lastUpdate).toLocaleString() : null,

        performance,
        performanceFormatted: performance == null
          ? null
          : `${performance > 0 ? '+' : ''}${performance.toFixed(2)}%`,
        performanceColor: performance > 0 ? '#10b981' : performance < 0 ? '#ef4444' : '#6b7280',

        daysToFinalObservation,
        daysToFinalObservationFormatted: daysToFinalObservation < 0
          ? `${daysToFinalObservation} (expired)`
          : `${daysToFinalObservation}`,

        hasProtection,
        protectionBarrierLevel,
        distanceToBarrier,
        distanceToBarrierFormatted: distanceToBarrier != null
          ? `${distanceToBarrier >= 0 ? '+' : ''}${distanceToBarrier.toFixed(1)}%`
          : null,
        distanceToBarrierColor: distanceToBarrier != null
          ? (distanceToBarrier < 0 ? '#ef4444' : distanceToBarrier < 10 ? '#f97316' : '#10b981')
          : null,
        riskZone,
        riskZoneLabel,

        bubbleColor: distanceToBarrier != null
          ? (distanceToBarrier < 0 ? 'rgba(239, 68, 68, 0.6)' :
             distanceToBarrier < 10 ? 'rgba(249, 115, 22, 0.6)' :
             'rgba(16, 185, 129, 0.6)')
          : null,
        bubbleBorderColor: distanceToBarrier != null
          ? (distanceToBarrier < 0 ? 'rgba(239, 68, 68, 1)' :
             distanceToBarrier < 10 ? 'rgba(249, 115, 22, 1)' :
             'rgba(16, 185, 129, 1)')
          : null
      });
    }
  }

  console.log(`[UnderlyingsAnalysis] Created ${underlyingsArray.length} underlying-product rows from ${products.length} products`);

  const processingTime = Date.now() - startTime;

  const rows = applyNotionalSizing(underlyingsArray, nominalByProduct);

  return {
    underlyings: rows,
    summary: { ...summarizeUnderlyings(rows), totalProducts: products.length },
    asOfDate: isHistorical ? asOfDate : null,
    asOfDateFormatted: isHistorical ? asOfDate.toISOString().slice(0, 10) : null,
    isHistorical,
    generatedAt: new Date(),
    generatedAtFormatted: new Date().toLocaleString(),
    processingTimeMs: processingTime,
    version: '2.2.0'
  };
}

/**
 * Rebuild and store the firm-wide live analysis (server only): the Refresh
 * button, and nightly after the product re-evaluation so prices and positions
 * stay current.
 */
export async function refreshLiveUnderlyingsAnalysis() {
  const doc = await buildUnderlyingsAnalysis(null);
  await UnderlyingsAnalysisCollection.upsertAsync(
    { _id: 'phoenix_live_underlyings' },
    { $set: { ...doc, _id: 'phoenix_live_underlyings' } }
  );
  console.log('[UnderlyingsAnalysis] Stored live analysis in database');
  return doc;
}

if (Meteor.isServer) {
  /**
   * The stored live analysis is firm-wide notional per product and ISIN. Any
   * staff member may rebuild it (the result is only ever read through the
   * viewer's scope); reads go through server/helpers/underlyingsScope.js, which
   * hands see-all roles the firm-wide view and everyone else their perimeter.
   */
  const sessionAuth = () => import('../../server/helpers/sessionAuth.js');

  Meteor.methods({
    /**
     * Generate and store underlyings analysis for live barrier-protected products.
     * Every viewer reads the same cached result, filtered to their scope.
     */
    async 'underlyingsAnalysis.generate'(sessionId = null) {
      check(sessionId, Match.Maybe(String));
      const { requireRole } = await sessionAuth();
      const { STAFF_ROLES, isSeeAll } = await import('../../server/helpers/accessPolicy.js');
      const user = await requireRole(sessionId, STAFF_ROLES);

      const doc = await refreshLiveUnderlyingsAnalysis();

      // Firm-wide counts only for see-all roles
      return {
        success: true,
        ...(isSeeAll(user) ? {
          underlyingsCount: doc.summary.totalRows,
          productsCount: doc.summary.totalProducts
        } : {}),
        processingTimeMs: doc.processingTimeMs,
        generatedAt: doc.generatedAt
      };
    },

    /**
     * Build the analysis as of a specific past date, within the caller's scope,
     * and return it directly. Does NOT persist — computed on demand.
     */
    async 'underlyingsAnalysis.generateAsOf'(asOfDate, sessionId = null) {
      check(asOfDate, Date);
      check(sessionId, Match.Maybe(String));
      const { requireSession } = await sessionAuth();
      const user = await requireSession(sessionId);

      if (asOfDate.getTime() > Date.now()) {
        throw new Meteor.Error('invalid-date', 'asOfDate cannot be in the future');
      }
      const { underlyingsAnalysisForUser } = await import('../../server/helpers/underlyingsScope.js');
      return await underlyingsAnalysisForUser(user, asOfDate);
    }
  });
}
