import { EODApiHelpers } from '/imports/api/eodApi';

/**
 * Stock Split Adjustment Module
 *
 * Computes cumulative split factors for underlyings so that static strike prices
 * from product inception can be compared against split-adjusted market prices.
 *
 * Design decisions:
 * - No DB mutation: products keep original strike; adjustment is on-the-fly
 * - 24h in-memory cache keyed by fullTicker to minimize API calls
 * - Graceful fallback: any error returns factor 1.0 (unadjusted)
 */

// In-memory cache: fullTicker → { splits, factor, fetchedAt }
const splitCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Compute cumulative split factor for all splits AFTER a reference date.
 * A 3:1 split after inception means the old strike must be divided by 3
 * to match current adjusted prices.
 *
 * @param {Array} splits - Array of { date, ratio } from EOD API
 * @param {Date|string} fromDate - Reference date (product inception)
 * @returns {number} - Cumulative factor (>= 1 for forward splits, < 1 for reverse)
 */
export function computeCumulativeSplitFactor(splits, fromDate) {
  if (!splits || splits.length === 0) return 1.0;

  const refDate = new Date(fromDate);
  if (isNaN(refDate.getTime())) return 1.0;

  const refStr = refDate.toISOString().split('T')[0];

  let factor = 1.0;
  for (const split of splits) {
    // Only count splits that occurred AFTER the reference date
    if (split.date > refStr) {
      factor *= split.ratio;
    }
  }

  return factor;
}

/**
 * Get split-adjusted strike for an underlying asset.
 * Main entry point used by evaluators.
 *
 * @param {Object} underlying - The underlying object from the product
 * @param {Object} product - The product (for inception date)
 * @returns {Promise<{ adjustedStrike: number, factor: number, splits: Array }>}
 */
export async function getSplitAdjustedStrike(underlying, product) {
  const rawStrike = underlying.strike
    || underlying.initialPrice
    || underlying.strikePrice
    || underlying.securityData?.tradeDatePrice?.price
    || underlying.securityData?.tradeDatePrice?.close
    || 0;

  if (!rawStrike || rawStrike === 0) {
    return { adjustedStrike: rawStrike, factor: 1.0, splits: [] };
  }

  try {
    // Determine full ticker
    const fullTicker = underlying.securityData?.ticker
      || underlying.securityData?.fullTicker
      || (underlying.ticker ? `${underlying.ticker}.US` : null);

    if (!fullTicker) {
      return { adjustedStrike: rawStrike, factor: 1.0, splits: [] };
    }

    // Determine inception date
    const inceptionDate = product.tradeDate
      || product.initialDate
      || product.valueDate;

    if (!inceptionDate) {
      return { adjustedStrike: rawStrike, factor: 1.0, splits: [] };
    }

    // Check cache
    const now = Date.now();
    const cached = splitCache.get(fullTicker);
    if (cached && (now - cached.fetchedAt) < CACHE_TTL) {
      const factor = computeCumulativeSplitFactor(cached.splits, inceptionDate);
      if (factor !== 1.0) {
        console.log(`[SplitAdjust] ${fullTicker}: strike ${rawStrike} / factor ${factor} = ${rawStrike / factor} (cached)`);
      }
      return {
        adjustedStrike: factor !== 1.0 ? rawStrike / factor : rawStrike,
        factor,
        splits: cached.splits.filter(s => s.date > new Date(inceptionDate).toISOString().split('T')[0])
      };
    }

    // Fetch splits from API (from inception to today)
    const splits = await EODApiHelpers.getStockSplits(fullTicker, new Date(inceptionDate), new Date());

    // Cache the result
    splitCache.set(fullTicker, {
      splits,
      fetchedAt: now
    });

    const factor = computeCumulativeSplitFactor(splits, inceptionDate);

    if (factor !== 1.0) {
      console.log(`[SplitAdjust] ${fullTicker}: ${splits.length} split(s) detected since ${new Date(inceptionDate).toISOString().split('T')[0]}, factor=${factor}, strike ${rawStrike} → ${rawStrike / factor}`);
    }

    return {
      adjustedStrike: factor !== 1.0 ? rawStrike / factor : rawStrike,
      factor,
      splits: splits.filter(s => s.date > new Date(inceptionDate).toISOString().split('T')[0])
    };
  } catch (error) {
    console.warn(`[SplitAdjust] Error adjusting strike for ${underlying.ticker}:`, error.message);
    return { adjustedStrike: rawStrike, factor: 1.0, splits: [] };
  }
}

/**
 * Clear the split cache (for testing or manual refresh)
 */
export function clearSplitCache() {
  splitCache.clear();
}
