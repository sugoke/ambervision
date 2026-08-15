import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

/**
 * Telekurs quotes — market data pushed from a locally live-updated Excel
 * (Telekurs.xlsx / SIX Financial) via the /api/telekurs/quotes HTTP endpoint.
 *
 * Purpose: a LAST-RESORT price fallback for instruments the EOD historical API
 * (and the other providers) do not cover — notably Japanese stocks. It is wired
 * into the market-data provider chain through `telekursProvider.js`, which reads
 * from this collection; it is NOT a discovery/search source (the Excel is a
 * hand-curated mirror of instruments already used in AmberVision).
 *
 * One document per instrument, keyed by `fullTicker` (SYMBOL.EXCHANGE, e.g.
 * "7203.TSE") — the SAME key the app uses everywhere for price routing
 * (`underlying.securityData.ticker`). Each push merges the day's bar into
 * `history`, so a daily OHLCV series accumulates over time.
 *
 * {
 *   fullTicker: "7203.TSE",   // match key (== securityData.ticker)
 *   symbol: "7203", exchange: "TSE",
 *   isin: "JP3633400001",     // reference/display only — never used for routing
 *   name: "Toyota Motor", currency: "JPY",
 *   history: [ { date, open, high, low, close, volume, adjustedClose } ], // sorted asc
 *   lastPrice: Number, lastDate: Date, lastUpdated: Date,
 *   source: "TELEKURS"
 * }
 */
export const TelekursQuotesCollection = new Mongo.Collection('telekursQuotes');

if (Meteor.isServer) {
  TelekursQuotesCollection.createIndex({ fullTicker: 1 }, { unique: true });
}

// Coerce to a finite number or null (Excel can send "", "N/A", locale strings).
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // Tolerate stray thousands separators / comma decimals from Excel locales.
  const cleaned = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Accept a JS Date, an ISO string, or a plain 'YYYY-MM-DD' and return a Date
// pinned to UTC midnight (so bars from different senders dedupe by calendar day).
function toBarDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const ymd = value.trim().slice(0, 10);
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sameDay(a, b) {
  return a.getTime() === b.getTime();
}

export const TelekursQuotesHelpers = {
  /**
   * Upsert an array of pushed rows. Each row:
   *   { ticker, isin?, name?, currency?, date, open, high, low, close, volume? }
   * `ticker` must be the exchange-qualified fullTicker (e.g. "7203.TSE").
   * Returns { upserted, skipped, errors: [{ ticker, reason }] }.
   */
  async upsertQuotes(rows) {
    if (!Array.isArray(rows)) {
      throw new Meteor.Error('invalid-payload', 'quotes must be an array');
    }

    let upserted = 0;
    let skipped = 0;
    const errors = [];

    for (const row of rows) {
      const fullTicker = (row?.ticker || '').toString().trim().toUpperCase();
      const close = toNumber(row?.close);
      const date = toBarDate(row?.date);

      // A row is only useful with a dotted ticker, a close, and a date.
      if (!fullTicker || !fullTicker.includes('.') || close === null || !date) {
        skipped += 1;
        errors.push({
          ticker: fullTicker || '(none)',
          reason: 'missing ticker(SYMBOL.EXCHANGE) / close / date'
        });
        continue;
      }

      const dotIndex = fullTicker.lastIndexOf('.');
      const symbol = fullTicker.slice(0, dotIndex);
      const exchange = fullTicker.slice(dotIndex + 1);

      // Open/high/low fall back to close when the sheet only carries a last price.
      const open = toNumber(row?.open) ?? close;
      const high = toNumber(row?.high) ?? close;
      const low = toNumber(row?.low) ?? close;
      const volume = toNumber(row?.volume) ?? 0;

      const bar = {
        date,
        open,
        high,
        low,
        close,
        volume,
        adjustedClose: close // Excel provides no adjusted series
      };

      try {
        const existing = await TelekursQuotesCollection.findOneAsync(
          { fullTicker },
          { fields: { history: 1 } }
        );

        const history = (existing?.history || []).filter(b => !sameDay(new Date(b.date), date));
        history.push(bar);
        history.sort((a, b) => new Date(a.date) - new Date(b.date));

        const latest = history[history.length - 1];

        await TelekursQuotesCollection.upsertAsync(
          { fullTicker },
          {
            $set: {
              fullTicker,
              symbol,
              exchange,
              isin: (row?.isin || '').toString().trim() || null,
              name: (row?.name || '').toString().trim() || null,
              currency: (row?.currency || '').toString().trim().toUpperCase() || null,
              history,
              lastPrice: latest.close,
              lastDate: latest.date,
              lastUpdated: new Date(),
              source: 'TELEKURS'
            }
          }
        );
        upserted += 1;
      } catch (error) {
        skipped += 1;
        errors.push({ ticker: fullTicker, reason: error.message });
      }
    }

    return { upserted, skipped, errors };
  },

  // Read the stored quote doc for a fullTicker (used by telekursProvider).
  async getQuote(fullTicker) {
    if (!fullTicker) return null;
    return TelekursQuotesCollection.findOneAsync({
      fullTicker: fullTicker.toString().trim().toUpperCase()
    });
  }
};
