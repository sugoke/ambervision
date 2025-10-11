import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ProductsCollection } from './products';
import { MarketDataCacheCollection } from './marketDataCache';

/**
 * UnderlyingsAnalysis Collection
 * Stores pre-computed analysis of underlyings for Phoenix products
 * ONE document that contains the complete analysis, updated on-demand
 */
export const UnderlyingsAnalysisCollection = new Mongo.Collection('underlyingsAnalysis');

if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Generate and store underlyings analysis for live Phoenix products
     * All users can read the same cached result
     */
    async 'underlyingsAnalysis.generate'() {
      console.log('[UnderlyingsAnalysis] Starting generation...');

      const startTime = Date.now();

      // Get all live Phoenix products
      const products = await ProductsCollection.find({
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

      console.log(`[UnderlyingsAnalysis] Found ${products.length} live Phoenix products`);

      // Get all market data
      const marketDataCache = await MarketDataCacheCollection.find({}).fetchAsync();
      const marketDataMap = {};
      marketDataCache.forEach(item => {
        marketDataMap[item.fullTicker] = item;
        marketDataMap[item.symbol] = item;
      });

      console.log(`[UnderlyingsAnalysis] Loaded ${marketDataCache.length} market data entries`);

      // Extract and process underlyings - create one row per underlying-product combination
      const underlyingsArray = [];

      for (const product of products) {
        const productUnderlyings = product.underlyings || [];

        // Fallback: extract from payoffStructure for older products
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

        // Check for capital protection at product level
        const hasProtection = product.structureParams?.protectionBarrierLevel > 0 ||
                             product.structureParams?.protectionBarrier > 0 ||
                             (product.structure?.maturity || product.payoffStructure || []).some(
                               item => item.type === 'barrier' && item.barrier_type === 'protection'
                             );

        // Extract protection barrier level
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

        // Create a row for each underlying in this product
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

          // Get market data
          const currentMarketData = marketDataMap[fullTicker] ||
                                   marketDataMap[underlying.ticker] ||
                                   marketDataMap[symbol];
          const currentPrice = currentMarketData?.cache?.latestPrice ||
                              currentMarketData?.price ||
                              0;
          const hasMarketData = !!currentMarketData;
          const lastUpdate = currentMarketData?.cache?.latestDate ||
                            currentMarketData?.lastUpdated ||
                            currentMarketData?.timestamp;

          // Calculate performance for THIS specific product-underlying combination
          const initialPrice = strikePrice || currentPrice;
          const performance = initialPrice > 0 ? ((currentPrice - initialPrice) / initialPrice * 100) : 0;

          // Calculate days to final observation
          const daysToFinalObservation = finalObservation
            ? Math.ceil((new Date(finalObservation) - new Date()) / (1000 * 60 * 60 * 24))
            : 0;

          // Calculate distance to barrier for this product
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

          // Add row for this underlying-product combination
          underlyingsArray.push({
            // Underlying info
            symbol,
            fullTicker,
            ticker: fullTicker,
            name,
            exchange,
            type: underlying.type || 'Stock',

            // Product info
            productId: product._id,
            productTitle: product.title,
            productIsin: product.isin,
            tradeDate,
            finalObservation,
            weight: underlying.weight || 100,

            // Market data (formatted)
            currentPrice,
            currentPriceFormatted: currentPrice > 0 ? currentPrice.toFixed(2) : null,
            initialPrice,
            initialPriceFormatted: initialPrice > 0 ? initialPrice.toFixed(2) : null,
            hasMarketData,
            lastUpdate,
            lastUpdateFormatted: lastUpdate ? new Date(lastUpdate).toLocaleString() : null,

            // Performance (formatted)
            performance,
            performanceFormatted: performance !== 0
              ? `${performance >= 0 ? '+' : ''}${performance.toFixed(2)}%`
              : '0.00%',
            performanceColor: performance > 0 ? '#10b981' : performance < 0 ? '#ef4444' : '#6b7280',

            // Dates
            daysToFinalObservation,
            daysToFinalObservationFormatted: daysToFinalObservation < 0
              ? `${daysToFinalObservation} (expired)`
              : `${daysToFinalObservation}`,

            // Protection
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

            // Chart data (pre-computed)
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
            bubbleSize: 8 // Fixed size since each row is one product
          });
        }
      }

      console.log(`[UnderlyingsAnalysis] Created ${underlyingsArray.length} underlying-product rows from ${products.length} products`);

      const processingTime = Date.now() - startTime;

      // Create the analysis document
      const analysisDoc = {
        _id: 'phoenix_live_underlyings', // Fixed ID for single document
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
        generatedAt: new Date(),
        generatedAtFormatted: new Date().toLocaleString(),
        processingTimeMs: processingTime,
        version: '2.0.0'
      };

      // Upsert the analysis document (replace existing)
      await UnderlyingsAnalysisCollection.upsertAsync(
        { _id: 'phoenix_live_underlyings' },
        { $set: analysisDoc }
      );

      console.log(`[UnderlyingsAnalysis] Stored analysis in database`);

      return {
        success: true,
        underlyingsCount: underlyingsArray.length,
        productsCount: products.length,
        processingTimeMs: processingTime,
        generatedAt: analysisDoc.generatedAt
      };
    }
  });
}
