import { CurrencyRateCacheCollection } from '/imports/api/currencyCache';

/**
 * Canonical FX helpers for server-side AUM aggregations.
 *
 * pmsHoldings.marketValue and portfolioSnapshots.totalAccountValue are stored
 * in each PORTFOLIO's reference currency (holdings.portfolioCurrency /
 * snapshot.currency) — never assume EUR when summing across portfolios.
 * (rmDashboardMethods.js keeps identical local copies; keep them in sync.)
 */

export function buildRatesMap(currencyRates) {
  const map = new Map();
  currencyRates.forEach(r => {
    if (r.rate) {
      map.set(r.pair, r.rate);
    }
  });
  return map;
}

export function convertToEUR(amount, fromCurrency, ratesMap) {
  if (!amount) return 0;
  if (fromCurrency === 'EUR') return amount;

  // Try direct EUR pair first (e.g., EURILS.FOREX)
  const directPair = `EUR${fromCurrency}.FOREX`;
  if (ratesMap.has(directPair)) {
    // EUR/XXX rate means 1 EUR = rate XXX, so EUR = amount / rate
    return amount / ratesMap.get(directPair);
  }

  // Try inverse pair (e.g., XXXEUR.FOREX) - less common
  const inversePair = `${fromCurrency}EUR.FOREX`;
  if (ratesMap.has(inversePair)) {
    return amount * ratesMap.get(inversePair);
  }

  // Convert via USD as intermediate
  let amountUSD;
  if (fromCurrency === 'USD') {
    amountUSD = amount;
  } else {
    // Try XXX/USD pair (e.g., GBPUSD.FOREX)
    const toUsdPair = `${fromCurrency}USD.FOREX`;
    if (ratesMap.has(toUsdPair)) {
      amountUSD = amount * ratesMap.get(toUsdPair);
    } else {
      // Try inverse USD/XXX pair (e.g., USDCHF.FOREX)
      const fromUsdPair = `USD${fromCurrency}.FOREX`;
      if (ratesMap.has(fromUsdPair)) {
        amountUSD = amount / ratesMap.get(fromUsdPair);
      } else {
        // Unknown currency - return as-is with warning
        console.warn(`[CashMonitoring] No FX rate for ${fromCurrency}, using amount as-is`);
        return amount;
      }
    }
  }

  // Convert USD to EUR using EURUSD rate
  const eurUsdRate = ratesMap.get('EURUSD.FOREX');
  if (!eurUsdRate) {
    console.warn('[CashMonitoring] No EURUSD rate available');
    return amountUSD;
  }

  // EURUSD = 1 EUR in USD, so EUR = USD / rate
  return amountUSD / eurUsdRate;
}

export async function buildEURRatesMap() {
  const currencyRates = await CurrencyRateCacheCollection.find({}).fetchAsync();
  return buildRatesMap(currencyRates);
}


/**
 * Aggregate portfolio snapshots into one EUR total per weekday.
 *
 * - Converts each snapshot by its own currency (portfolios are not all EUR).
 * - Skips weekends (banks do not report; partial data causes fake dips).
 * - Fills INTERIOR gaps: when a portfolio has no snapshot on a day but has one
 *   both before and after in the window (a late/missed bank file), its last
 *   known value is carried forward. Days before a portfolio's first snapshot
 *   or after its last are NOT filled, so newly funded or closed accounts
 *   still enter/leave the curve honestly.
 *
 * Returns [{ date, totalAccountValue, portfolioCount }] sorted by date, where
 * portfolioCount is the number of portfolios with a REAL snapshot that day.
 */
export function aggregateSnapshotsByDay(snapshots, ratesMap) {
  // Per-portfolio series: key -> Map(dayKey -> valueEUR)
  const perPortfolio = new Map();
  const dayDates = new Map(); // dayKey -> Date

  for (const snapshot of snapshots) {
    const dayOfWeek = snapshot.snapshotDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dayKey = snapshot.snapshotDate.toISOString().split('T')[0];
    if (!dayDates.has(dayKey)) dayDates.set(dayKey, snapshot.snapshotDate);

    const key = `${snapshot.portfolioCode || 'unknown'}|${snapshot.bankId || 'unknown'}`;
    if (!perPortfolio.has(key)) perPortfolio.set(key, new Map());
    const series = perPortfolio.get(key);
    const valueEUR = convertToEUR(snapshot.totalAccountValue || 0, snapshot.portfolioCurrency || 'EUR', ratesMap);
    // A portfolio normally has one snapshot per day; if duplicates exist, last wins
    series.set(dayKey, valueEUR);
  }

  const sortedDays = [...dayDates.keys()].sort();

  // Pre-compute each portfolio's first/last day present (gap-fill boundaries)
  const bounds = new Map();
  for (const [key, series] of perPortfolio) {
    const days = [...series.keys()].sort();
    bounds.set(key, { first: days[0], last: days[days.length - 1] });
  }

  const results = [];
  const lastKnown = new Map(); // key -> last real value seen while walking days
  for (const dayKey of sortedDays) {
    let total = 0;
    let realCount = 0;
    for (const [key, series] of perPortfolio) {
      const { first, last } = bounds.get(key);
      if (series.has(dayKey)) {
        const v = series.get(dayKey);
        lastKnown.set(key, v);
        total += v;
        realCount += 1;
      } else if (dayKey > first && dayKey < last && lastKnown.has(key)) {
        // interior gap — carry the last known value forward
        total += lastKnown.get(key);
      }
    }
    results.push({ date: dayDates.get(dayKey), totalAccountValue: total, portfolioCount: realCount });
  }

  return results;
}
