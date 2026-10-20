/**
 * The demo client's VIRTUAL model portfolio.
 *
 * A second account on the demo client ("DEMO-MODEL") holding a typical Amberlake
 * allocation, bought once at real market prices and revalued every day from the
 * prices the banks report on the same instruments in real client accounts. It
 * exists to show prospects, and to track, how such a portfolio actually performs.
 *
 *   1/3  Phoenix autocallables
 *   1/3  capital-guaranteed notes (Orion memory notes, 100% participation notes)
 *   1/3  alternatives: NCM Enhanced Physical Gold, KKR Private Markets (K-PRIME),
 *        Haussmann (Notz Stucki fund of hedge funds) — equal thirds
 *
 * Every instrument is one the firm's clients really hold, so a reference price
 * is always available: the newest priced record of that ISIN in a real (non-demo)
 * account, with the bank's own EUR conversion. Nothing is made up: when an ISIN
 * has no fresh real price (position sold everywhere, product redeemed), the last
 * known price is kept and the position is flagged stale in the job result.
 *
 * Launch (once): sizes each position from the nominal, writes the book
 * (quantities, cost prices, inception date) to `demoModelPortfolios`, then
 * refreshes. Refresh (daily, after the bank files): writes a new version of every
 * holding row for the day and the day's portfolio snapshot, so the PMS, the
 * performance panel and the TWR read it like any other account. Re-running on
 * the same day updates that day in place.
 *
 * Known simplification: coupons and early redemptions of the structured products
 * are not booked as cash; the position carries the bank price until the product
 * leaves the real accounts.
 */

import { Mongo } from 'meteor/mongo';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PortfolioSnapshotsCollection, PortfolioSnapshotHelpers } from '/imports/api/portfolioSnapshots';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { AllocationsCollection } from '/imports/api/allocations';
import { ProductsCollection } from '/imports/api/products';
import { CurrencyRateCacheCollection } from '/imports/api/currencyCache';

export const DemoModelPortfoliosCollection = new Mongo.Collection('demoModelPortfolios');

export const DEMO_ENTITY_ID = 'demoClientEntity01';
export const DEMO_BANK_ID = 'demoBankFictional1';
export const MODEL_ACCOUNT_ID = 'demoBankAccount002';
export const MODEL_PORTFOLIO_CODE = 'DEMO-MODEL';
export const MODEL_BOOK_ID = 'default';
export const DEFAULT_NOMINAL_EUR = 10_000_000;
const PORTFOLIO_CURRENCY = 'EUR';
const SOURCE = 'demo-model';
const DEFAULT_DENOMINATION = 1000;

/**
 * The model: three equal sleeves, equal weights inside each sleeve. ISINs are
 * instruments held in real client accounts on the launch date (October 2026).
 */
export const MODEL_SLEEVES = [
  {
    key: 'phoenix',
    label: 'Phoenix autocallables',
    weight: 1 / 3,
    isins: [
      'CH1559716019', // KO/OR/CARL-B Phoenix — Vontobel, 05/2028
      'CH1555851026', // ABBV/JNJ Phoenix — BIL, 05/2028
      'CH1566093790', // NOVN/AZN/RO Phoenix — UBS, 05/2028
      'XS3508902205', // BP/FANG/TTE Phoenix — BNP Paribas, 10/2028
      'CH1602694551', // BHP/RIO/GLEN Phoenix — Société Générale, 09/2028
      'XS3183507444', // PYPL/SAP Phoenix — BNP Paribas, 11/2027
      'CH1559716001', // ALV/G/CS Phoenix — Vontobel, 05/2028
      'CH1601887107'  // NDX/DJI/GSPC Phoenix — BIL, 09/2028
    ]
  },
  {
    key: 'capital_guaranteed',
    label: 'Capital-guaranteed notes',
    weight: 1 / 3,
    isins: [
      'XS2732673368', // ASML/AVGO +3 Orion — BNP Paribas, 09/2028, 100% CG
      'XS3178893569', // SAF/HO +4 Orion — Barclays, 09/2028, 100% CG
      'XS3074527402', // FORTUM/EXC +7 Orion — BNP Paribas, 08/2028, 100% CG
      'XS3011506444', // BA/RHM +5 Orion — Société Générale, 03/2028, 100% CG
      'XS3111145903', // RHM/HO +8 Orion — Barclays, 09/2028, 100% CG
      'CH1533650615', // SAN/KGX/RHM/RIO/UCG Participation Note — BIL, 10/2027, 100% CG
      'XS3199485627'  // ADS/ITX/PNDORA Participation Note 129% — BNP Paribas, 12/2028, 100% CG
    ]
  },
  {
    key: 'alternatives',
    label: 'Gold, private equity, hedge funds',
    weight: 1 / 3,
    isins: [
      'CH1139325968', // NCM Alternative Assets — NCM Enhanced Physical Gold (USD)
      'XD1429691706', // KKR Private Markets Equity Fund — K-PRIME (EUR)
      'LU1129548993'  // Haussmann SCA SICAV-SIF — Notz Stucki fund of hedge funds (EUR)
    ]
  }
];

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's calendar day in Paris, as a UTC-midnight Date (how snapshots are keyed). */
export function todayUTC(now = new Date()) {
  const iso = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  return new Date(`${iso}T00:00:00Z`);
}

/** EUR target of every position: sleeve weight × nominal, split equally. */
export function positionTargets(nominalEUR, sleeves = MODEL_SLEEVES) {
  const targets = [];
  for (const sleeve of sleeves) {
    const perPosition = (nominalEUR * sleeve.weight) / sleeve.isins.length;
    for (const isin of sleeve.isins) targets.push({ isin, sleeve: sleeve.key, targetEUR: perPosition });
  }
  return targets;
}

/**
 * Quantity bought for a target in EUR. Percentage-quoted instruments (notes,
 * bonds) are bought in whole denominations; funds and shares in units to three
 * decimals, as the banks report them.
 */
export function sizePosition({ targetEUR, price, eurPerLocal, priceType, denomination = DEFAULT_DENOMINATION }) {
  if (!(price > 0) || !(eurPerLocal > 0)) return 0;
  const targetLocal = targetEUR / eurPerLocal;
  if (priceType === 'percentage') {
    const lot = denomination > 0 ? denomination : DEFAULT_DENOMINATION;
    return Math.max(lot, Math.round(targetLocal / price / lot) * lot);
  }
  return round(targetLocal / price, 3);
}

/**
 * The reference price of an ISIN from real holdings rows: the newest priced row
 * (by priceDate, then snapshotDate). The EUR factor comes from the bank's own
 * conversion on that row when it has one.
 * @param {Array} rows  pmsHoldings rows of one ISIN (any account, non-demo)
 * @returns {object|null} { price, priceType, priceDate, currency, eurPerLocal, securityName, displayName, securityType, assetClass, ticker, sourcePortfolioCode }
 */
export function pickReferencePrice(rows) {
  const priced = (rows || []).filter(r => r && r.marketPrice > 0 && r.isActive !== false);
  if (priced.length === 0) return null;
  const time = (d) => (d ? new Date(d).getTime() : 0);
  priced.sort((a, b) => (time(b.priceDate) - time(a.priceDate)) || (time(b.snapshotDate) - time(a.snapshotDate)));
  const ref = priced[0];
  const currency = ref.currency || PORTFOLIO_CURRENCY;
  let eurPerLocal = null;
  if (currency === PORTFOLIO_CURRENCY) eurPerLocal = 1;
  else if (ref.marketValue > 0 && ref.marketValueOriginalCurrency > 0) {
    eurPerLocal = ref.marketValue / ref.marketValueOriginalCurrency;
  }
  return {
    price: ref.marketPrice,
    priceType: ref.priceType || (ref.marketPrice < 5 && ['STRUCTURED_PRODUCT', 'BOND'].includes(ref.securityType) ? 'percentage' : 'absolute'),
    priceDate: ref.priceDate || ref.snapshotDate || null,
    currency,
    eurPerLocal,
    securityName: ref.securityName || null,
    displayName: ref.displayName || null,
    securityType: ref.securityType || null,
    assetClass: ref.assetClass || null,
    ticker: ref.ticker || null,
    sourcePortfolioCode: ref.portfolioCode || null,
    // Classification the import put on the real row (capital-guaranteed bucket etc.)
    structuredProductProtectionType: ref.structuredProductProtectionType || null,
    structuredProductUnderlyingType: ref.structuredProductUnderlyingType || null
  };
}

/** EUR per unit of `currency` from the FX cache, or null. */
async function eurPerLocalFromCache(currency) {
  if (currency === PORTFOLIO_CURRENCY) return 1;
  const direct = await CurrencyRateCacheCollection.findOneAsync({ pair: `${currency}EUR.FOREX` }, { sort: { timestamp: -1 } });
  if (direct?.rate > 0) return direct.rate;
  const inverse = await CurrencyRateCacheCollection.findOneAsync({ pair: `EUR${currency}.FOREX` }, { sort: { timestamp: -1 } });
  if (inverse?.rate > 0) return 1 / inverse.rate;
  return null;
}

/** Reference prices for a set of ISINs, from real accounts. */
async function loadReferencePrices(isins) {
  const rows = await PMSHoldingsCollection.find(
    { isin: { $in: isins }, isLatest: true, isActive: { $ne: false }, isDemo: { $ne: true }, portfolioCode: { $ne: 'CONSOLIDATED' } },
    { fields: {
      isin: 1, marketPrice: 1, priceType: 1, priceDate: 1, snapshotDate: 1, currency: 1, marketValue: 1,
      marketValueOriginalCurrency: 1, securityName: 1, displayName: 1, securityType: 1, assetClass: 1, ticker: 1,
      portfolioCode: 1, isActive: 1, structuredProductProtectionType: 1, structuredProductUnderlyingType: 1
    } }
  ).fetchAsync();
  const byIsin = new Map();
  for (const r of rows) {
    if (!byIsin.has(r.isin)) byIsin.set(r.isin, []);
    byIsin.get(r.isin).push(r);
  }
  const refs = new Map();
  for (const isin of isins) {
    const ref = pickReferencePrice(byIsin.get(isin) || []);
    if (ref && !ref.eurPerLocal) ref.eurPerLocal = await eurPerLocalFromCache(ref.currency);
    refs.set(isin, ref);
  }
  return refs;
}

async function ensureModelAccount(now) {
  const entity = await ClientEntitiesCollection.findOneAsync(DEMO_ENTITY_ID, { fields: { _id: 1 } });
  if (!entity) throw new Error('The demo client does not exist — run demo.seed first');
  await BankAccountsCollection.upsertAsync(
    { _id: MODEL_ACCOUNT_ID },
    {
      $set: {
        entityId: DEMO_ENTITY_ID,
        bankId: DEMO_BANK_ID,
        accountNumber: MODEL_PORTFOLIO_CODE,
        referenceCurrency: PORTFOLIO_CURRENCY,
        accountType: 'personal',
        accountStructure: 'direct',
        name: 'Model portfolio',
        // "Investments": the purpose the performance code reads to treat an account as
        // an investment account (anything but credit / spending)
        comment: 'Investments — virtual model portfolio: 1/3 Phoenix, 1/3 capital guaranteed, 1/3 gold / private equity / hedge funds',
        isActive: true,
        isDemo: true,
        updatedAt: now
      },
      $setOnInsert: { createdAt: now }
    }
  );
}

export async function getModelBook() {
  return DemoModelPortfoliosCollection.findOneAsync(MODEL_BOOK_ID);
}

/**
 * Buy the model once at today's real prices and record the book.
 * @returns {object} the book, plus the positions that could not be priced
 */
export async function launchDemoModelPortfolio({ nominalEUR = DEFAULT_NOMINAL_EUR, now = new Date(), sleeves = MODEL_SLEEVES } = {}) {
  const existing = await getModelBook();
  if (existing) throw new Error(`The model portfolio was already launched on ${existing.inceptionDate?.toISOString?.().slice(0, 10)}; reset it first`);

  await ensureModelAccount(now);
  const targets = positionTargets(nominalEUR, sleeves);
  const isins = targets.map(t => t.isin);
  const refs = await loadReferencePrices(isins);
  const products = await ProductsCollection.find({ isin: { $in: isins } }, { fields: { isin: 1, denomination: 1 } }).fetchAsync();
  const denominationByIsin = Object.fromEntries(products.map(p => [p.isin, Number(p.denomination) || DEFAULT_DENOMINATION]));

  const positions = [];
  const unpriced = [];
  let investedEUR = 0;
  for (const t of targets) {
    const ref = refs.get(t.isin);
    if (!ref || !ref.eurPerLocal) { unpriced.push(t.isin); continue; }
    const quantity = sizePosition({
      targetEUR: t.targetEUR, price: ref.price, eurPerLocal: ref.eurPerLocal,
      priceType: ref.priceType, denomination: denominationByIsin[t.isin]
    });
    const costLocal = quantity * ref.price;
    const costEUR = costLocal * ref.eurPerLocal;
    investedEUR += costEUR;
    positions.push({
      isin: t.isin, sleeve: t.sleeve, targetEUR: round(t.targetEUR),
      quantity, costPrice: ref.price, priceType: ref.priceType, currency: ref.currency,
      costEurPerLocal: ref.eurPerLocal, costEUR: round(costEUR), boughtAtPriceDate: ref.priceDate
    });
  }

  const inceptionDate = todayUTC(now);
  const book = {
    _id: MODEL_BOOK_ID,
    nominalEUR,
    inceptionDate,
    positions,
    cashEUR: round(nominalEUR - investedEUR),
    sleeves: sleeves.map(s => ({ key: s.key, label: s.label, weight: s.weight, isins: s.isins })),
    createdAt: now,
    updatedAt: now
  };
  await DemoModelPortfoliosCollection.insertAsync(book);
  console.log(`[demo-model] Launched: ${positions.length} positions, EUR ${Math.round(investedEUR).toLocaleString()} invested, EUR ${Math.round(book.cashEUR).toLocaleString()} cash${unpriced.length ? `, unpriced: ${unpriced.join(', ')}` : ''}`);
  return { ...book, unpriced };
}

/** Replace the current version of one holding row for the day (same day: in place). */
async function writeHoldingVersion(doc, now) {
  const current = await PMSHoldingsCollection.findOneAsync({ uniqueKey: doc.uniqueKey, isLatest: true }, { fields: { _id: 1, snapshotDate: 1, version: 1 } });
  if (current && new Date(current.snapshotDate).getTime() === doc.snapshotDate.getTime()) {
    await PMSHoldingsCollection.updateAsync(current._id, { $set: { ...doc, version: current.version || 1, updatedAt: now } });
    return 'updated';
  }
  if (current) {
    await PMSHoldingsCollection.updateAsync(
      { uniqueKey: doc.uniqueKey, isLatest: true },
      { $set: { isLatest: false, replacedAt: now, updatedAt: now } },
      { multi: true }
    );
  }
  await PMSHoldingsCollection.insertAsync({ ...doc, version: (current?.version || 0) + 1, createdAt: now, updatedAt: now });
  return 'inserted';
}

/**
 * Revalue the model at the latest real prices and write the day's holdings and
 * snapshot. Launches the model first when it has not been launched yet.
 */
export async function refreshDemoModelPortfolio({ now = new Date(), nominalEUR = DEFAULT_NOMINAL_EUR, sleeves = MODEL_SLEEVES } = {}) {
  let book = await getModelBook();
  let launched = false;
  if (!book) {
    book = await launchDemoModelPortfolio({ nominalEUR, now, sleeves });
    launched = true;
  }
  await ensureModelAccount(now);

  const snapshotDate = todayUTC(now);
  const isins = book.positions.map(p => p.isin);
  const refs = await loadReferencePrices(isins);
  const products = await ProductsCollection.find({ isin: { $in: isins } }, { fields: { isin: 1, title: 1, templateId: 1 } }).fetchAsync();
  const productByIsin = Object.fromEntries(products.map(p => [p.isin, p]));
  const lastRows = await PMSHoldingsCollection.find(
    { portfolioCode: MODEL_PORTFOLIO_CODE, isLatest: true },
    { fields: { isin: 1, marketPrice: 1, priceDate: 1, marketValue: 1, marketValueOriginalCurrency: 1, securityName: 1, displayName: 1, securityType: 1, assetClass: 1, ticker: 1 } }
  ).fetchAsync();
  const lastByIsin = Object.fromEntries(lastRows.filter(r => r.isin).map(r => [r.isin, r]));

  const base = {
    isDemo: true,
    entityId: DEMO_ENTITY_ID,
    bankId: DEMO_BANK_ID,
    bankName: 'Demo Bank',
    portfolioCode: MODEL_PORTFOLIO_CODE,
    accountNumber: MODEL_PORTFOLIO_CODE,
    portfolioCurrency: PORTFOLIO_CURRENCY,
    snapshotDate,
    dataDate: snapshotDate,
    fileDate: snapshotDate,
    processingDate: now,
    processedAt: now,
    isActive: true,
    isLatest: true,
    sourceFile: SOURCE
  };

  const docs = [];
  const stale = [];
  for (const p of book.positions) {
    const ref = refs.get(p.isin);
    const last = lastByIsin[p.isin];
    let price, priceDate, eurPerLocal, descriptive;
    if (ref && ref.eurPerLocal) {
      price = ref.price; priceDate = ref.priceDate; eurPerLocal = ref.eurPerLocal; descriptive = ref;
    } else if (last) {
      // No fresh real price: carry the last known one, flagged
      price = last.marketPrice; priceDate = last.priceDate; descriptive = last;
      eurPerLocal = last.marketValueOriginalCurrency > 0 ? last.marketValue / last.marketValueOriginalCurrency : p.costEurPerLocal;
      stale.push(p.isin);
    } else {
      price = p.costPrice; priceDate = p.boughtAtPriceDate; eurPerLocal = p.costEurPerLocal; descriptive = ref || {};
      stale.push(p.isin);
    }
    const product = productByIsin[p.isin];
    const marketValueLocal = p.quantity * price;
    const marketValue = marketValueLocal * eurPerLocal;
    const costLocal = p.quantity * p.costPrice;
    const costEUR = costLocal * p.costEurPerLocal;
    const isStructured = !!product || descriptive.securityType === 'STRUCTURED_PRODUCT';
    docs.push({
      ...base,
      uniqueKey: `DEMO::${MODEL_PORTFOLIO_CODE}::${p.isin}`,
      isin: p.isin,
      ticker: descriptive.ticker || p.isin,
      securityName: product?.title || descriptive.securityName || p.isin,
      displayName: product?.title || descriptive.displayName || descriptive.securityName || p.isin,
      securityType: isStructured ? 'STRUCTURED_PRODUCT' : (descriptive.securityType || 'FUND'),
      assetClass: isStructured ? 'structured_product' : (descriptive.assetClass || 'fund'),
      priceType: p.priceType,
      quantity: p.quantity,
      balance: p.quantity,
      currency: p.currency,
      marketPrice: price,
      priceDate: priceDate || snapshotDate,
      costPrice: p.costPrice,
      marketValueOriginalCurrency: round(marketValueLocal),
      marketValue: round(marketValue),
      marketValuePortfolioCurrency: round(marketValue),
      costBasisOriginalCurrency: round(costLocal),
      costBasisPortfolioCurrency: round(costEUR),
      unrealizedPnL: round(marketValue - costEUR),
      unrealizedPnLPercent: costEUR > 0 ? round(((marketValue - costEUR) / costEUR) * 100, 4) : 0,
      modelSleeve: p.sleeve,
      structuredProductProtectionType: descriptive.structuredProductProtectionType || (p.sleeve === 'capital_guaranteed' ? 'capital_guaranteed_100' : (isStructured ? 'conditional' : '')),
      structuredProductUnderlyingType: descriptive.structuredProductUnderlyingType || '',
      priceStale: stale.includes(p.isin),
      priceSourcePortfolioCode: descriptive.sourcePortfolioCode || null,
      ...(product ? { linkedProductId: product._id, linkingStatus: 'linked', linkedAt: now } : { linkedProductId: null, linkingStatus: 'unlinked' })
    });
  }

  // Residual cash from the launch, in EUR, never moves (no flows are simulated)
  docs.push({
    ...base,
    uniqueKey: `DEMO::${MODEL_PORTFOLIO_CODE}::CASH-EUR`,
    isin: null,
    ticker: null,
    securityName: 'Current Account MODEL EUR',
    displayName: 'Current Account MODEL EUR',
    securityType: 'CASH',
    assetClass: 'cash',
    priceType: 'absolute',
    quantity: book.cashEUR,
    balance: book.cashEUR,
    currency: PORTFOLIO_CURRENCY,
    marketPrice: null,
    priceDate: snapshotDate,
    costPrice: 1,
    marketValueOriginalCurrency: book.cashEUR,
    marketValue: book.cashEUR,
    marketValuePortfolioCurrency: book.cashEUR,
    costBasisOriginalCurrency: book.cashEUR,
    costBasisPortfolioCurrency: book.cashEUR,
    unrealizedPnL: 0,
    unrealizedPnLPercent: 0
  });

  const written = { inserted: 0, updated: 0 };
  for (const doc of docs) written[await writeHoldingVersion(doc, now)]++;

  // Allocations onto the real catalog products, keyed per account so the main
  // demo account's allocations on the same products are left alone
  for (const doc of docs) {
    if (!doc.linkedProductId) continue;
    const p = book.positions.find(x => x.isin === doc.isin);
    // Allocations quote the purchase price in percent (allocations.js), holdings in decimal
    const purchasePrice = p.priceType === 'percentage' ? round(p.costPrice * 100, 4) : p.costPrice;
    await AllocationsCollection.upsertAsync(
      { productId: doc.linkedProductId, clientId: DEMO_ENTITY_ID, bankAccountId: MODEL_ACCOUNT_ID },
      {
        $set: {
          isDemo: true, entityId: DEMO_ENTITY_ID, isin: p.isin, bankId: DEMO_BANK_ID, portfolioCode: MODEL_PORTFOLIO_CODE,
          nominalInvested: p.quantity, purchasePrice, status: 'active', source: 'manual', allocatedBy: 'system', updatedAt: now
        },
        $setOnInsert: { allocatedAt: book.inceptionDate || now, createdAt: now }
      }
    );
  }

  // The day's snapshot (one per day, updated in place on a re-run)
  const investments = docs.filter(d => d.assetClass !== 'cash');
  const totalMarketValue = investments.reduce((s, d) => s + d.marketValue, 0);
  const totalCostBasis = investments.reduce((s, d) => s + d.costBasisPortfolioCurrency, 0);
  const cashBalance = book.cashEUR;
  const assetClassBreakdown = await PortfolioSnapshotHelpers.buildAssetClassBreakdown(docs);
  const snapshot = {
    isDemo: true,
    entityId: DEMO_ENTITY_ID,
    bankId: DEMO_BANK_ID,
    bankName: 'Demo Bank',
    portfolioCode: MODEL_PORTFOLIO_CODE,
    accountNumber: MODEL_PORTFOLIO_CODE,
    snapshotDate,
    fileDate: snapshotDate,
    processingDate: now,
    sourceFile: SOURCE,
    totalMarketValue: round(totalMarketValue),
    totalCostBasis: round(totalCostBasis),
    totalCapitalInvested: book.nominalEUR,
    unrealizedPnL: round(totalMarketValue - totalCostBasis),
    unrealizedPnLPercent: totalCostBasis > 0 ? round(((totalMarketValue - totalCostBasis) / totalCostBasis) * 100, 4) : 0,
    cashBalance,
    totalAccountValue: round(totalMarketValue + cashBalance),
    positionCount: investments.length,
    currency: PORTFOLIO_CURRENCY,
    portfolioCurrency: PORTFOLIO_CURRENCY,
    hasMixedCurrencies: new Set(docs.map(d => d.currency)).size > 1,
    assetClassBreakdown,
    version: 1,
    updatedAt: now
  };
  await PortfolioSnapshotsCollection.upsertAsync(
    { portfolioCode: MODEL_PORTFOLIO_CODE, snapshotDate },
    { $set: snapshot, $setOnInsert: { createdAt: now } }
  );
  await DemoModelPortfoliosCollection.updateAsync(MODEL_BOOK_ID, {
    $set: { lastRefreshedAt: now, lastSnapshotDate: snapshotDate, lastTotalAccountValue: snapshot.totalAccountValue, lastStaleIsins: stale, updatedAt: now }
  });

  const result = {
    launched,
    date: snapshotDate.toISOString().slice(0, 10),
    positions: investments.length,
    totalAccountValue: snapshot.totalAccountValue,
    performanceSinceInceptionPct: book.nominalEUR > 0 ? round(((snapshot.totalAccountValue - book.nominalEUR) / book.nominalEUR) * 100, 4) : 0,
    rowsInserted: written.inserted,
    rowsUpdated: written.updated,
    stalePrices: stale,
    daysSinceInception: Math.round((snapshotDate - new Date(book.inceptionDate)) / DAY_MS)
  };
  console.log(`[demo-model] ${result.date}: EUR ${Math.round(result.totalAccountValue).toLocaleString()} (${result.performanceSinceInceptionPct >= 0 ? '+' : ''}${result.performanceSinceInceptionPct}% since inception)${stale.length ? `, stale prices: ${stale.join(', ')}` : ''}`);
  return result;
}

/** Remove the model portfolio entirely (book, holdings, snapshots, allocations, account). */
export async function resetDemoModelPortfolio() {
  return {
    holdings: await PMSHoldingsCollection.removeAsync({ portfolioCode: MODEL_PORTFOLIO_CODE, isDemo: true }),
    snapshots: await PortfolioSnapshotsCollection.removeAsync({ portfolioCode: MODEL_PORTFOLIO_CODE, isDemo: true }),
    allocations: await AllocationsCollection.removeAsync({ bankAccountId: MODEL_ACCOUNT_ID, isDemo: true }),
    bankAccounts: await BankAccountsCollection.removeAsync({ _id: MODEL_ACCOUNT_ID }),
    book: await DemoModelPortfoliosCollection.removeAsync({ _id: MODEL_BOOK_ID })
  };
}
