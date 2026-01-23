/**
 * Currency Normalization Utilities
 *
 * Handles the GBp (British Pence) vs GBP (British Pounds) conversion issue.
 * UK stocks listed on the London Stock Exchange (LSE) are quoted in pence,
 * not pounds. 100 pence = 1 pound.
 */

export const CurrencyNormalization = {
  /**
   * Check if a price appears to be in British pence (GBp) vs pounds (GBP)
   * LSE stocks are quoted in pence, but strike prices may be in pounds
   *
   * @param {string} ticker - Full ticker (e.g., "BA.LSE", "RR.L")
   * @param {number} strikePrice - Strike/reference price (assumed to be in GBP)
   * @param {number} currentPrice - Current market price (may be in GBp)
   * @returns {boolean} - True if price appears to be in pence
   */
  isPriceInPence(ticker, strikePrice, currentPrice) {
    if (!ticker) return false;
    if (!strikePrice || strikePrice <= 0) return false;
    if (!currentPrice || currentPrice <= 0) return false;

    // Extract exchange from ticker (e.g., "BA.LSE" -> "LSE", "RR.L" -> "L")
    const parts = ticker.split('.');
    const exchange = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';

    // Check if LSE exchange (both .LSE and .L are used)
    if (exchange !== 'LSE' && exchange !== 'L') {
      return false;
    }

    // Validate with ratio check - if current price >> strike by 50x+,
    // it's almost certainly in pence vs pounds
    const ratio = currentPrice / strikePrice;
    return ratio > 50;
  },

  /**
   * Normalize a price to GBP if it appears to be in pence
   * @param {number} price - The price to normalize
   * @param {number} referencePrice - Strike/initial price for comparison
   * @param {string} ticker - Full ticker (e.g., "BA.LSE")
   * @returns {number} - Normalized price in GBP
   */
  normalizePriceToGBP(price, referencePrice, ticker) {
    if (this.isPriceInPence(ticker, referencePrice, price)) {
      console.log(`[GBp->GBP] Converting ${ticker}: ${price} pence -> ${price / 100} GBP`);
      return price / 100;
    }
    return price;
  },

  /**
   * Normalize an array of historical prices
   * Uses the first valid close price to determine if conversion is needed
   *
   * @param {Array} history - Array of price records with close, adjustedClose, etc.
   * @param {number} referencePrice - Strike/initial price for comparison
   * @param {string} ticker - Full ticker (e.g., "BA.LSE")
   * @returns {Array} - Normalized history array
   */
  normalizeHistoricalPrices(history, referencePrice, ticker) {
    if (!history || history.length === 0) return history;

    // Find first valid close price to check
    const firstValidRecord = history.find(r => r.close > 0 || r.adjustedClose > 0);
    if (!firstValidRecord) return history;

    const testPrice = firstValidRecord.adjustedClose || firstValidRecord.close;

    if (!this.isPriceInPence(ticker, referencePrice, testPrice)) {
      return history;
    }

    console.log(`[GBp->GBP] Normalizing ${history.length} historical prices for ${ticker}`);
    return history.map(record => ({
      ...record,
      close: record.close ? record.close / 100 : record.close,
      adjustedClose: record.adjustedClose ? record.adjustedClose / 100 : record.adjustedClose,
      open: record.open ? record.open / 100 : record.open,
      high: record.high ? record.high / 100 : record.high,
      low: record.low ? record.low / 100 : record.low
    }));
  },

  /**
   * Check if a ticker is from the London Stock Exchange
   * @param {string} ticker - Full ticker (e.g., "BA.LSE", "RR.L")
   * @returns {boolean} - True if LSE ticker
   */
  isLSETicker(ticker) {
    if (!ticker) return false;
    const parts = ticker.split('.');
    const exchange = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : '';
    return exchange === 'LSE' || exchange === 'L';
  }
};

export default CurrencyNormalization;
