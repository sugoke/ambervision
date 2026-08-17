import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '../../imports/api/products.js';
import { MarketDataCacheCollection } from '../../imports/api/marketDataCache.js';
import { SessionsCollection, SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { CurrencyNormalization } from '../../imports/utils/currencyNormalization.js';

/**
 * Data quality diagnostics.
 *
 * These surface products whose stored reference data disagrees with the market data feed.
 * A disagreement is never cosmetic: every performance figure, barrier distance and autocall
 * decision is measured against the initial level, so if the strike and the feed describe
 * different things, the product's whole valuation does too.
 */

async function validateSuperadminSession(sessionId) {
  // SECURITY: string-only — reject selector-object injection.
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionHelpers.findByToken(sessionId);
  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }
  if (user.role !== 'superadmin') {
    throw new Meteor.Error('not-authorized', 'Superadmin access required for data quality diagnostics');
  }

  return user;
}

/**
 * Close of `fullTicker` on `dateStr` (YYYY-MM-DD), or null when the feed has no bar that day.
 * Deliberately exact-date: the point is to compare like with like against the fixing date,
 * so falling back to a neighbouring day would mask the very mismatch we are looking for.
 */
async function closeOnDate(fullTicker, dateStr) {
  const cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker });
  if (!cacheDoc?.history?.length) return null;

  const record = cacheDoc.history.find(
    r => new Date(r.date).toISOString().split('T')[0] === dateStr
  );
  return record ? (record.close ?? record.adjustedClose ?? null) : null;
}

Meteor.methods({
  /**
   * List products whose contractual strike disagrees with the price feed on the trade date.
   *
   * Two causes, needing opposite fixes, and the shape of the result tells them apart:
   *   - ONE underlying diverging  -> that underlying's ticker probably points at the wrong
   *     instrument (e.g. a symbol reassigned after a rename).
   *   - ALL underlyings diverging -> `tradeDate` is probably not the real fixing date
   *     (often the value/settlement date was stored instead).
   *
   * @param {string} sessionId - superadmin session
   * @param {number} thresholdPct - percentage gap worth reporting (default 2, matching the evaluator)
   */
  async 'dataQuality.strikeFeedDivergence'(sessionId, thresholdPct = 2) {
    await validateSuperadminSession(sessionId);

    const products = await ProductsCollection.find(
      { underlyings: { $exists: true, $ne: [] } },
      { fields: { title: 1, isin: 1, tradeDate: 1, productStatus: 1, templateId: 1, underlyings: 1 } }
    ).fetchAsync();

    const findings = [];

    for (const product of products) {
      if (!product.tradeDate) continue;
      const tradeDateStr = new Date(product.tradeDate).toISOString().split('T')[0];

      const diverging = [];
      let comparable = 0;

      for (const u of product.underlyings || []) {
        const strike = u.initialPrice || u.strike;
        if (!strike || strike <= 0) continue;

        const fullTicker = u.fullTicker || u.securityData?.ticker || `${u.ticker}.US`;
        const close = await closeOnDate(fullTicker, tradeDateStr);
        if (!close || close <= 0) continue;

        comparable += 1;

        // LSE quotes in pence against a strike stated in pounds. That is a unit mismatch on
        // the same instrument, handled by CurrencyNormalization downstream, so reporting it
        // as a ~-99% divergence would bury the real findings under known noise.
        if (CurrencyNormalization.isPriceInPence(fullTicker, strike, close)) continue;

        const gapPct = (strike / close - 1) * 100;
        if (Math.abs(gapPct) > thresholdPct) {
          diverging.push({
            ticker: u.ticker,
            fullTicker,
            name: u.name,
            strike,
            closeOnTradeDate: close,
            gapPct: Number(gapPct.toFixed(2))
          });
        }
      }

      if (diverging.length === 0) continue;

      findings.push({
        productId: product._id,
        title: product.title,
        isin: product.isin,
        templateId: product.templateId,
        productStatus: product.productStatus,
        tradeDate: tradeDateStr,
        // All comparable underlyings off => suspect the date, not the tickers.
        likelyCause: diverging.length === comparable && comparable > 1
          ? 'tradeDate may not be the fixing date'
          : 'ticker may point at the wrong instrument',
        diverging
      });
    }

    findings.sort((a, b) =>
      Math.max(...b.diverging.map(d => Math.abs(d.gapPct))) -
      Math.max(...a.diverging.map(d => Math.abs(d.gapPct)))
    );

    console.log(`[dataQuality] strikeFeedDivergence: ${findings.length} product(s) above ${thresholdPct}%`);
    return { thresholdPct, productsScanned: products.length, findingCount: findings.length, findings };
  }
});
