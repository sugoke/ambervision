import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ProductsCollection } from './products';
import { MarketDataCacheCollection } from './marketDataCache';
import { AllocationsCollection } from './allocations';

/**
 * UnderlyingsAnalysis Collection
 * Stores pre-computed analysis of underlyings for Phoenix products
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

function isProductLiveAsOf(product, asOfDate) {
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

/**
 * Build the complete underlyings analysis document.
 * @param {Date|null} asOfDate - null/undefined means live (today). A Date triggers
 *   historical mode: products filtered by date, allocations filtered by date,
 *   prices read from MarketDataCacheCollection.history at or before asOfDate.
 * @returns {Promise<Object>} analysis doc (without _id)
 */
export async function buildUnderlyingsAnalysis(asOfDate = null) {
  const isHistorical = asOfDate instanceof Date;
  const effectiveDate = isHistorical ? asOfDate : new Date();
  const mode = isHistorical ? `as-of ${asOfDate.toISOString().slice(0, 10)}` : 'live';

  console.log(`[UnderlyingsAnalysis] Starting generation (${mode})...`);
  const startTime = Date.now();

  let products;
  if (isHistorical) {
    const allPhoenix = await ProductsCollection.find({
      $or: [
        { template: 'phoenix_autocallable' },
        { templateId: 'phoenix_autocallable' }
      ]
    }).fetchAsync();
    products = allPhoenix.filter(p => isProductLiveAsOf(p, asOfDate));
  } else {
    products = await ProductsCollection.find({
      $and: [
        {
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
        },
        {
          $or: [
            { template: 'phoenix_autocallable' },
            { templateId: 'phoenix_autocallable' }
          ]
        }
      ]
    }).fetchAsync();
  }

  console.log(`[UnderlyingsAnalysis] Found ${products.length} Phoenix products (${mode})`);

  const marketDataCache = await MarketDataCacheCollection.find({}).fetchAsync();
  const marketDataMap = {};
  marketDataCache.forEach(item => {
    marketDataMap[item.fullTicker] = item;
    marketDataMap[item.symbol] = item;
  });

  console.log(`[UnderlyingsAnalysis] Loaded ${marketDataCache.length} market data entries`);

  let allocations;
  if (isHistorical) {
    const allAllocs = await AllocationsCollection.find({}).fetchAsync();
    allocations = allAllocs.filter(a => isAllocationOpenAsOf(a, asOfDate));
  } else {
    allocations = await AllocationsCollection.find({ status: 'active' }).fetchAsync();
  }

  const nominalByProduct = {};
  allocations.forEach(allocation => {
    if (!nominalByProduct[allocation.productId]) {
      nominalByProduct[allocation.productId] = 0;
    }
    nominalByProduct[allocation.productId] += allocation.nominalInvested || 0;
  });

  console.log(`[UnderlyingsAnalysis] Loaded ${allocations.length} allocations (${mode})`);

  const notionalAmounts = products
    .map(p => nominalByProduct[p._id] || 0)
    .filter(n => n > 0);

  const minNotional = notionalAmounts.length > 0 ? Math.min(...notionalAmounts) : 0;
  const maxNotional = notionalAmounts.length > 0 ? Math.max(...notionalAmounts) : 0;

  console.log(`[UnderlyingsAnalysis] Investment range: ${minNotional.toLocaleString()} - ${maxNotional.toLocaleString()}`);

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

    const hasProtection = product.structureParams?.protectionBarrierLevel > 0 ||
                         product.structureParams?.protectionBarrier > 0 ||
                         (product.structure?.maturity || product.payoffStructure || []).some(
                           item => item.type === 'barrier' && item.barrier_type === 'protection'
                         );

    let protectionBarrierLevel = null;
    if (product.structureParams?.protectionBarrierLevel) {
      protectionBarrierLevel = product.structureParams.protectionBarrierLevel;
    } else if (product.structureParams?.protectionBarrier) {
      protectionBarrierLevel = product.structureParams.protectionBarrier;
    } else {
      const protectionBarrier = (product.structure?.maturity || product.payoffStructure || []).find(
        item => item.type === 'barrier' && item.barrier_type === 'protection'
      );
      if (protectionBarrier) {
        protectionBarrierLevel = protectionBarrier.barrier_level || protectionBarrier.level;
      }
    }

    const productNotional = nominalByProduct[product._id] || 0;
    let bubbleSize = 8;
    if (maxNotional > minNotional && productNotional > 0) {
      const normalizedValue = (productNotional - minNotional) / (maxNotional - minNotional);
      bubbleSize = 5 + (normalizedValue * 15);
    }

    for (const underlying of productUnderlyings) {
      const fullTicker = underlying.securityData?.ticker ||
                        underlying.fullTicker ||
                        (underlying.ticker && underlying.ticker.includes('.') ? underlying.ticker : null) ||
                        (underlying.symbol && underlying.exchange ? `${underlying.symbol}.${underlying.exchange}` : null);

      const symbol = underlying.symbol || underlying.ticker || underlying.securityData?.symbol;
      const name = underlying.name || underlying.securityData?.name || symbol;
      const exchange = underlying.securityData?.exchange || underlying.exchange;
      const strikePrice = underlying.strike || underlying.strikePrice;
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
        hasMarketData = !!currentMarketData;
        lastUpdate = currentMarketData?.cache?.latestDate ||
                    currentMarketData?.lastUpdated ||
                    currentMarketData?.timestamp;
      }

      const initialPrice = strikePrice || currentPrice;
      const performance = initialPrice > 0 ? ((currentPrice - initialPrice) / initialPrice * 100) : 0;

      const daysToFinalObservation = finalObservation
        ? Math.ceil((new Date(finalObservation) - effectiveDate) / (1000 * 60 * 60 * 24))
        : 0;

      let distanceToBarrier = null;
      let riskZone = 'none';
      let riskZoneLabel = 'No Barrier';

      if (protectionBarrierLevel != null && initialPrice > 0) {
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
        performanceFormatted: performance !== 0
          ? `${performance >= 0 ? '+' : ''}${performance.toFixed(2)}%`
          : '0.00%',
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
          : null,
        bubbleSize: bubbleSize,
        productNotional: productNotional
      });
    }
  }

  console.log(`[UnderlyingsAnalysis] Created ${underlyingsArray.length} underlying-product rows from ${products.length} products`);

  const processingTime = Date.now() - startTime;

  return {
    underlyings: underlyingsArray,
    summary: {
      totalRows: underlyingsArray.length,
      totalProducts: products.length,
      uniqueUnderlyings: new Set(underlyingsArray.map(u => u.symbol)).size,
      positivePerformance: underlyingsArray.filter(u => u.performance > 0).length,
      negativePerformance: underlyingsArray.filter(u => u.performance < 0).length,
      withProtection: underlyingsArray.filter(u => u.hasProtection).length,
      belowBarrier: underlyingsArray.filter(u => u.distanceToBarrier != null && u.distanceToBarrier < 0).length,
      warningZone: underlyingsArray.filter(u => u.distanceToBarrier != null && u.distanceToBarrier >= 0 && u.distanceToBarrier < 10).length,
      safeZone: underlyingsArray.filter(u => u.distanceToBarrier != null && u.distanceToBarrier >= 10).length
    },
    asOfDate: isHistorical ? asOfDate : null,
    asOfDateFormatted: isHistorical ? asOfDate.toISOString().slice(0, 10) : null,
    isHistorical,
    generatedAt: new Date(),
    generatedAtFormatted: new Date().toLocaleString(),
    processingTimeMs: processingTime,
    version: '2.1.0'
  };
}

if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Generate and store underlyings analysis for live Phoenix products.
     * All users can read the same cached result.
     */
    async 'underlyingsAnalysis.generate'() {
      const doc = await buildUnderlyingsAnalysis(null);

      await UnderlyingsAnalysisCollection.upsertAsync(
        { _id: 'phoenix_live_underlyings' },
        { $set: { ...doc, _id: 'phoenix_live_underlyings' } }
      );

      console.log('[UnderlyingsAnalysis] Stored live analysis in database');

      return {
        success: true,
        underlyingsCount: doc.summary.totalRows,
        productsCount: doc.summary.totalProducts,
        processingTimeMs: doc.processingTimeMs,
        generatedAt: doc.generatedAt
      };
    },

    /**
     * Build the analysis as of a specific past date and return it directly.
     * Does NOT persist — historical results are computed on demand.
     */
    async 'underlyingsAnalysis.generateAsOf'(asOfDate) {
      check(asOfDate, Date);
      if (asOfDate.getTime() > Date.now()) {
        throw new Meteor.Error('invalid-date', 'asOfDate cannot be in the future');
      }
      return await buildUnderlyingsAnalysis(asOfDate);
    }
  });
}
