import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClientEntitiesCollection, ENTITY_STATUSES, ENTITY_TYPES } from '../../imports/api/clientEntities.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { AllocationsCollection } from '../../imports/api/allocations.js';
import { PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { ProductsCollection } from '../../imports/api/products.js';
import { SessionsCollection, SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';

/**
 * Demo client seeding.
 *
 * Creates one fictional client with a ~30M diversified portfolio, reachable only by
 * typing "demo" into the View As picker. Every document written carries `isDemo: true`,
 * which is what the central exclusion in ClientEntityHelpers keys on to keep this money
 * out of AUM, dashboards, alerts, contacts and product holder lists — and what
 * `demo.reset` keys on to remove it again cleanly.
 *
 * Ids are fixed rather than generated so re-running is a no-op update instead of a
 * second portfolio: seeding must be idempotent.
 */

const DEMO_ENTITY_ID = 'demoClientEntity01';
const DEMO_BANK_ID = 'demoBankFictional1';
const DEMO_ACCOUNT_ID = 'demoBankAccount001';
const DEMO_PORTFOLIO_CODE = 'DEMO-001';
const DEMO_ACCOUNT_NUMBER = 'DEMO-001';
const PORTFOLIO_CURRENCY = 'EUR';

// Units of each currency per 1 EUR. Fixed rather than fetched: a demo must look the same
// every time it is shown, and must not depend on a live FX call at seed time.
const FX_PER_EUR = { EUR: 1, USD: 1.08, CHF: 0.95, GBP: 0.85 };

const toEur = (localAmount, currency) => localAmount / (FX_PER_EUR[currency] || 1);

/**
 * Cash and securities lines, expressed as a target EUR value so the sleeve totals land
 * where intended; quantity is then derived from the local price. `price`/`costPrice` are
 * per share in `currency`.
 */
const SECURITY_LINES = [
  // --- Equities: 10.5M (35%) ---
  { cls: 'equity', isin: 'US0378331005', ticker: 'AAPL', name: 'Apple Inc', ccy: 'USD', price: 305.26, costPrice: 214.80, targetEur: 1_500_000 },
  { cls: 'equity', isin: 'US5949181045', ticker: 'MSFT', name: 'Microsoft Corp', ccy: 'USD', price: 496.88, costPrice: 402.10, targetEur: 1_400_000 },
  { cls: 'equity', isin: 'US02079K3059', ticker: 'GOOGL', name: 'Alphabet Inc Class A', ccy: 'USD', price: 346.36, costPrice: 301.55, targetEur: 1_200_000 },
  { cls: 'equity', isin: 'NL0000235190', ticker: 'AIR', name: 'Airbus SE', ccy: 'EUR', price: 212.90, costPrice: 156.73, targetEur: 1_100_000 },
  { cls: 'equity', isin: 'FR0000121014', ticker: 'MC', name: 'LVMH Moet Hennessy Louis Vuitton', ccy: 'EUR', price: 645.20, costPrice: 712.40, targetEur: 1_000_000 },
  { cls: 'equity', isin: 'DE0007164600', ticker: 'SAP', name: 'SAP SE', ccy: 'EUR', price: 248.35, costPrice: 189.20, targetEur: 1_000_000 },
  { cls: 'equity', isin: 'CH0012032048', ticker: 'ROG', name: 'Roche Holding AG', ccy: 'CHF', price: 331.80, costPrice: 288.15, targetEur: 950_000 },
  { cls: 'equity', isin: 'CH0038863350', ticker: 'NESN', name: 'Nestle SA', ccy: 'CHF', price: 84.62, costPrice: 96.30, targetEur: 850_000 },
  { cls: 'equity', isin: 'GB00B63H8491', ticker: 'RR', name: 'Rolls-Royce Holdings PLC', ccy: 'GBP', price: 15.25, costPrice: 9.84, targetEur: 800_000 },
  { cls: 'equity', isin: 'US67066G1040', ticker: 'NVDA', name: 'NVIDIA Corp', ccy: 'USD', price: 187.44, costPrice: 121.60, targetEur: 700_000 },

  // --- Fixed income: 4.5M (15%). Bonds quote as a percentage of nominal, stored decimal. ---
  { cls: 'fixed_income', isin: 'DE0001102614', ticker: 'DBR 2.6 08/34', name: 'Bundesrepublik Deutschland 2.6% 2034', ccy: 'EUR', price: 0.9820, costPrice: 0.9615, targetEur: 1_200_000, pct: true },
  { cls: 'fixed_income', isin: 'FR0014009O62', ticker: 'OAT 3.0 05/33', name: 'France OAT 3.0% 2033', ccy: 'EUR', price: 1.0135, costPrice: 0.9940, targetEur: 1_000_000, pct: true },
  { cls: 'fixed_income', isin: 'XS2434891219', ticker: 'NESNVX 0.875', name: 'Nestle Finance 0.875% 2031', ccy: 'EUR', price: 0.8945, costPrice: 0.9210, targetEur: 900_000, pct: true },
  { cls: 'fixed_income', isin: 'US912828YS36', ticker: 'T 2.75 08/32', name: 'US Treasury Note 2.75% 2032', ccy: 'USD', price: 0.9455, costPrice: 0.9120, targetEur: 800_000, pct: true },
  { cls: 'fixed_income', isin: 'XS2010029663', ticker: 'ENELIM 1.875', name: 'Enel Finance 1.875% 2030', ccy: 'EUR', price: 0.9310, costPrice: 0.9480, targetEur: 600_000, pct: true },

  // --- Funds: 3.0M (10%) ---
  { cls: 'fund', isin: 'IE00B4L5Y983', ticker: 'IWDA', name: 'iShares Core MSCI World UCITS ETF', ccy: 'USD', price: 118.42, costPrice: 92.15, targetEur: 1_100_000 },
  { cls: 'fund', isin: 'LU0690375182', ticker: 'CARMIG', name: 'Carmignac Patrimoine A EUR', ccy: 'EUR', price: 742.60, costPrice: 705.30, targetEur: 800_000 },
  { cls: 'fund', isin: 'IE00B5BMR087', ticker: 'CSPX', name: 'iShares Core S&P 500 UCITS ETF', ccy: 'USD', price: 682.14, costPrice: 521.80, targetEur: 650_000 },
  { cls: 'fund', isin: 'LU0171307068', ticker: 'BGFWGF', name: 'BlackRock Global Funds World Gold A2', ccy: 'USD', price: 41.87, costPrice: 34.90, targetEur: 450_000 }
];

// Cash: 3.0M (10%). Amounts are in the account's own currency.
const CASH_LINES = [
  { ccy: 'EUR', amountLocal: 1_600_000, name: 'Current Account DEMO EUR' },
  { ccy: 'USD', amountLocal: 1_080_000, name: 'Current Account DEMO USD' },
  { ccy: 'CHF', amountLocal: 380_000, name: 'Current Account DEMO CHF' }
];

/**
 * Structured products: 9.0M (30%). These are ALLOCATIONS onto real live catalog
 * products, which is what makes the Schedule and Underlyings views show genuine
 * evaluated content (observation dates, underlying exposure) instead of empty panels.
 * The demo is hidden from those products' own holder lists by the central exclusion.
 * Matched by ISIN at seed time so a missing product is skipped rather than fatal.
 */
const STRUCTURED_LINES = [
  { isin: 'XS3440599267', nominal: 1_800_000, price: 1.0245, costPrice: 1.0000 },
  { isin: 'CH1559716019', nominal: 1_700_000, price: 0.9865, costPrice: 1.0000 },
  { isin: 'CH1566097676', nominal: 1_600_000, price: 1.0120, costPrice: 1.0000 },
  { isin: 'CH1555851026', nominal: 1_500_000, price: 0.9740, costPrice: 1.0000 },
  { isin: 'CH1533650615', nominal: 1_400_000, price: 1.0580, costPrice: 1.0000 },
  { isin: 'CH1540951766', nominal: 1_000_000, price: 0.9955, costPrice: 1.0000 }
];

async function validateSuperadminSession(sessionId) {
  // SECURITY: string-only — reject selector-object injection.
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Meteor.Error('not-authorized', 'Session required');

  const session = await SessionHelpers.findByToken(sessionId);
  if (!session) throw new Meteor.Error('not-authorized', 'Invalid session');

  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) throw new Meteor.Error('not-authorized', 'User not found');
  if (user.role !== 'superadmin') {
    throw new Meteor.Error('not-authorized', 'Superadmin access required to manage demo data');
  }
  return user;
}

/** Stable per-line key so re-seeding updates rows instead of appending new ones. */
const uniqueKeyFor = (suffix) => `DEMO::${DEMO_PORTFOLIO_CODE}::${suffix}`;

function baseHolding(snapshotDate) {
  return {
    isDemo: true,
    entityId: DEMO_ENTITY_ID,
    // Deliberately NO userId: the demo is entity-only, which also keeps it out of the
    // consolidation cron (it iterates distinct('userId')).
    bankId: DEMO_BANK_ID,
    bankName: 'Demo Bank',
    portfolioCode: DEMO_PORTFOLIO_CODE,
    accountNumber: DEMO_ACCOUNT_NUMBER,
    portfolioCurrency: PORTFOLIO_CURRENCY,
    snapshotDate,
    dataDate: snapshotDate,
    fileDate: snapshotDate,
    priceDate: snapshotDate,
    processingDate: new Date(),
    processedAt: new Date(),
    isActive: true,
    isLatest: true,
    version: 1,
    sourceFile: 'demo-seed'
  };
}

/** Build every holding document for the demo portfolio. */
async function buildHoldings(snapshotDate) {
  const docs = [];

  for (const line of SECURITY_LINES) {
    const localTarget = line.targetEur * (FX_PER_EUR[line.ccy] || 1);
    // Bonds/notes quote in percent of nominal (stored decimal), so "quantity" is nominal.
    const quantity = line.pct
      ? Math.round(localTarget / line.price / 1000) * 1000
      : Math.max(1, Math.round(localTarget / line.price));

    const marketValueLocal = quantity * line.price;
    const costBasisLocal = quantity * line.costPrice;
    const marketValue = toEur(marketValueLocal, line.ccy);
    const costBasis = toEur(costBasisLocal, line.ccy);

    docs.push({
      ...baseHolding(snapshotDate),
      uniqueKey: uniqueKeyFor(line.isin),
      isin: line.isin,
      ticker: line.ticker,
      securityName: line.name,
      securityType: line.cls === 'fixed_income' ? 'BOND' : line.cls === 'fund' ? 'FUND' : 'EQUITY',
      assetClass: line.cls,
      priceType: line.pct ? 'percentage' : 'absolute',
      quantity,
      currency: line.ccy,
      marketPrice: line.price,
      costPrice: line.costPrice,
      marketValueOriginalCurrency: marketValueLocal,
      marketValue,
      costBasisOriginalCurrency: costBasisLocal,
      costBasisPortfolioCurrency: costBasis,
      unrealizedPnL: marketValue - costBasis,
      unrealizedPnLPercent: costBasis > 0 ? ((marketValue - costBasis) / costBasis) * 100 : 0
    });
  }

  for (const cash of CASH_LINES) {
    const marketValue = toEur(cash.amountLocal, cash.ccy);
    docs.push({
      ...baseHolding(snapshotDate),
      uniqueKey: uniqueKeyFor(`CASH-${cash.ccy}`),
      isin: null,
      ticker: null,
      securityName: cash.name,
      securityType: 'CASH',
      assetClass: 'cash',
      priceType: 'absolute',
      quantity: cash.amountLocal,
      currency: cash.ccy,
      marketPrice: null,
      costPrice: 1,
      marketValueOriginalCurrency: cash.amountLocal,
      marketValue,
      costBasisOriginalCurrency: cash.amountLocal,
      costBasisPortfolioCurrency: marketValue,
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0
    });
  }

  // Structured products, matched to real catalog products by ISIN.
  const isins = STRUCTURED_LINES.map(s => s.isin);
  const products = await ProductsCollection.find(
    { isin: { $in: isins } },
    { fields: { _id: 1, isin: 1, title: 1, currency: 1 } }
  ).fetchAsync();
  const productByIsin = Object.fromEntries(products.map(p => [p.isin, p]));

  const structured = [];
  for (const line of STRUCTURED_LINES) {
    const product = productByIsin[line.isin];
    if (!product) {
      console.warn(`[demo] Skipping structured line ${line.isin} — no matching product in the catalog`);
      continue;
    }
    const ccy = product.currency || PORTFOLIO_CURRENCY;
    const marketValueLocal = line.nominal * line.price;
    const costBasisLocal = line.nominal * line.costPrice;
    const marketValue = toEur(marketValueLocal, ccy);
    const costBasis = toEur(costBasisLocal, ccy);

    docs.push({
      ...baseHolding(snapshotDate),
      uniqueKey: uniqueKeyFor(line.isin),
      isin: line.isin,
      ticker: line.isin,
      securityName: product.title,
      securityType: 'STRUCTURED_PRODUCT',
      assetClass: 'structured_product',
      priceType: 'percentage',
      quantity: line.nominal,
      currency: ccy,
      marketPrice: line.price,
      costPrice: line.costPrice,
      marketValueOriginalCurrency: marketValueLocal,
      marketValue,
      costBasisOriginalCurrency: costBasisLocal,
      costBasisPortfolioCurrency: costBasis,
      unrealizedPnL: marketValue - costBasis,
      unrealizedPnLPercent: costBasis > 0 ? ((marketValue - costBasis) / costBasis) * 100 : 0,
      // Lets the Underlyings "currently held" resolution find this product directly.
      linkedProductId: product._id,
      linkingStatus: 'linked',
      linkedAt: new Date()
    });

    structured.push({ product, line, marketValue });
  }

  return { docs, structured };
}

/**
 * Twelve month-end snapshots ending today, so the performance panel has something to
 * draw. The path is deterministic (a fixed shape, not random) so the demo tells the
 * same story every time it is shown.
 */
function buildSnapshots(totalValue, totalCostBasis, cashBalance, positionCount) {
  // Gentle upward drift with two drawdowns, oldest → newest, ending at 1.0 = today.
  const shape = [0.868, 0.882, 0.901, 0.888, 0.915, 0.934, 0.921, 0.947, 0.962, 0.955, 0.981, 1.0];
  const today = new Date();
  const snapshots = [];

  shape.forEach((factor, i) => {
    const date = new Date(today);
    date.setMonth(date.getMonth() - (shape.length - 1 - i));
    date.setHours(0, 0, 0, 0);

    const value = totalValue * factor;
    const cost = totalCostBasis * (0.94 + 0.06 * (i / (shape.length - 1)));

    snapshots.push({
      _id: `demoSnapshot${String(i).padStart(2, '0')}`,
      isDemo: true,
      entityId: DEMO_ENTITY_ID,
      bankId: DEMO_BANK_ID,
      bankName: 'Demo Bank',
      portfolioCode: DEMO_PORTFOLIO_CODE,
      accountNumber: DEMO_ACCOUNT_NUMBER,
      snapshotDate: date,
      fileDate: date,
      processingDate: new Date(),
      sourceFile: 'demo-seed',
      totalMarketValue: value,
      totalCostBasis: cost,
      totalCapitalInvested: cost,
      unrealizedPnL: value - cost,
      unrealizedPnLPercent: cost > 0 ? ((value - cost) / cost) * 100 : 0,
      cashBalance: cashBalance * factor,
      totalAccountValue: value,
      positionCount,
      currency: PORTFOLIO_CURRENCY,
      hasMixedCurrencies: true,
      version: 1
    });
  });

  return snapshots;
}

Meteor.methods({
  /**
   * Create (or refresh) the demo client and its portfolio. Idempotent.
   */
  async 'demo.seed'(sessionId) {
    check(sessionId, String);
    const user = await validateSuperadminSession(sessionId);

    const now = new Date();
    const snapshotDate = new Date();
    snapshotDate.setHours(0, 0, 0, 0);

    // 1. Bank — fictional, so a demo account number can never be claimed by a real
    //    bank-file import or reconciliation run.
    await BanksCollection.upsertAsync(
      { _id: DEMO_BANK_ID },
      {
        $set: {
          name: 'Demo Bank',
          city: 'Geneva',
          country: 'Switzerland',
          countryCode: 'CH',
          isActive: true,
          isDemo: true,
          updatedAt: now,
          updatedBy: user._id
        },
        $setOnInsert: { createdAt: now, createdBy: user._id }
      }
    );

    // 2. Entity — stays status 'active' and isActive so the View As picker and every
    //    scope-resolution branch treat it as an ordinary client. `isDemo` is what hides it.
    await ClientEntitiesCollection.upsertAsync(
      { _id: DEMO_ENTITY_ID },
      {
        $set: {
          type: ENTITY_TYPES.PHYSICAL_PERSON,
          profile: {
            firstName: 'Demo',
            lastName: 'Portfolio',
            email: 'demo@example.invalid'
          },
          status: ENTITY_STATUSES.ACTIVE,
          isActive: true,
          isDemo: true,
          referenceCurrency: PORTFOLIO_CURRENCY,
          relationshipManagerId: null,
          assignedUserIds: [],
          stakeholders: [],
          updatedAt: now
        },
        $setOnInsert: { createdAt: now, createdBy: user._id }
      }
    );

    // 3. Bank account
    await BankAccountsCollection.upsertAsync(
      { _id: DEMO_ACCOUNT_ID },
      {
        $set: {
          entityId: DEMO_ENTITY_ID,
          bankId: DEMO_BANK_ID,
          accountNumber: DEMO_ACCOUNT_NUMBER,
          referenceCurrency: PORTFOLIO_CURRENCY,
          accountType: 'personal',
          accountStructure: 'direct',
          comment: 'Investments',
          isActive: true,
          isDemo: true,
          updatedAt: now
        },
        $setOnInsert: { createdAt: now }
      }
    );

    // 4. Holdings — upserted on uniqueKey. A changed key format plus a re-run is exactly
    //    what doubled every position in the PMS historical view once before.
    const { docs, structured } = await buildHoldings(snapshotDate);
    for (const doc of docs) {
      const { uniqueKey, ...rest } = doc;
      await PMSHoldingsCollection.upsertAsync(
        { uniqueKey },
        { $set: { ...rest, uniqueKey, updatedAt: now }, $setOnInsert: { createdAt: now } }
      );
    }

    // Drop any line from a previous seed that is no longer part of the model portfolio.
    await PMSHoldingsCollection.removeAsync({
      isDemo: true,
      uniqueKey: { $nin: docs.map(d => d.uniqueKey) }
    });

    // 5. Allocations onto the real catalog products.
    for (const { product, line } of structured) {
      await AllocationsCollection.upsertAsync(
        { productId: product._id, clientId: DEMO_ENTITY_ID },
        {
          $set: {
            isDemo: true,
            bankAccountId: DEMO_ACCOUNT_ID,
            nominalInvested: line.nominal,
            purchasePrice: line.costPrice,
            status: 'active',
            allocatedBy: user._id
          },
          $setOnInsert: { allocatedAt: now }
        }
      );
    }

    // 6. Snapshots for the performance panel.
    const totalValue = docs.reduce((s, d) => s + (d.marketValue || 0), 0);
    const totalCostBasis = docs.reduce((s, d) => s + (d.costBasisPortfolioCurrency || 0), 0);
    const cashBalance = docs.filter(d => d.assetClass === 'cash').reduce((s, d) => s + d.marketValue, 0);

    for (const snap of buildSnapshots(totalValue, totalCostBasis, cashBalance, docs.length)) {
      const { _id, ...rest } = snap;
      await PortfolioSnapshotsCollection.upsertAsync(
        { _id },
        { $set: { ...rest, updatedAt: now }, $setOnInsert: { createdAt: now } }
      );
    }

    const byClass = docs.reduce((acc, d) => {
      acc[d.assetClass] = (acc[d.assetClass] || 0) + d.marketValue;
      return acc;
    }, {});

    console.log(`[demo] Seeded demo client: ${docs.length} holdings, ${structured.length} allocations, total ${Math.round(totalValue).toLocaleString()} EUR`);

    return {
      entityId: DEMO_ENTITY_ID,
      holdings: docs.length,
      allocations: structured.length,
      snapshots: 12,
      totalValueEUR: Math.round(totalValue),
      byAssetClass: Object.fromEntries(
        Object.entries(byClass).map(([k, v]) => [k, Math.round(v)])
      )
    };
  },

  /**
   * Remove every demo document. Keys on `isDemo: true`, which only the seeder sets.
   */
  async 'demo.reset'(sessionId) {
    check(sessionId, String);
    await validateSuperadminSession(sessionId);

    const removed = {
      holdings: await PMSHoldingsCollection.removeAsync({ isDemo: true }),
      allocations: await AllocationsCollection.removeAsync({ isDemo: true }),
      snapshots: await PortfolioSnapshotsCollection.removeAsync({ isDemo: true }),
      bankAccounts: await BankAccountsCollection.removeAsync({ isDemo: true }),
      entities: await ClientEntitiesCollection.removeAsync({ isDemo: true }),
      banks: await BanksCollection.removeAsync({ isDemo: true })
    };

    console.log('[demo] Reset demo client:', JSON.stringify(removed));
    return removed;
  }
});
