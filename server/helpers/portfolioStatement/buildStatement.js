/**
 * Portfolio statement view-model.
 *
 * Builds everything the statement PDF shows — figures, formatted strings,
 * pagination and chart geometry — from the PMS data of a perimeter (a client,
 * or one of its accounts). The PDF page (PortfolioStatementPDF.jsx) only renders
 * the pages returned here, in English or French (wording in ./i18n.js).
 *
 * Money vocabulary used throughout:
 *   gross assets  = securities at market value + positive cash balances
 *   financing     = negative cash balances (credit lines, card, overdrafts)
 *   NAV           = gross assets + financing
 * All amounts are converted to the statement's reference currency with the
 * custodian's own rates first (holding.bankFxRates), EOD rates otherwise.
 *
 * Report period: positions are valued at its end date, and the activity and
 * performance pages cover the period only (start: 1 January of the end year
 * unless given).
 */
import { Meteor } from 'meteor/meteor';
import { OPERATION_TYPES, OPERATION_CATEGORIES } from '/imports/api/constants/operationTypes';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { BankAccountsCollection, accountHolderSelector, getAccountHolderIds, isInvestmentAccount, getClientReferenceCurrency } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';
import { UsersCollection } from '/imports/api/users';
import { SecuritiesMetadataCollection, SECTORS } from '/imports/api/securitiesMetadata';
import { CurrencyRateCacheCollection } from '/imports/api/currencyCache';
import { PortfolioSnapshotsCollection, filterSnapshotsByBankStartDate, dedupeSnapshotsPerAccountDay } from '/imports/api/portfolioSnapshots';
import { classifyHolding, buildCategoryKey } from '/imports/api/assetClassification';
import { buildRatesMap, isPureCashHolding } from '/imports/api/helpers/cashCalculator';
import { buildConsolidatedDailyValues } from '/imports/api/helpers/twrCalculator';
import { STATEMENT_SECTIONS } from '/imports/constants/statementSections';
import { getFilteredClientIds } from '../../methods/rmDashboardMethods.js';
import { buildLineChart, buildBarChart } from './charts.js';
import { statementText, statementFormat } from './i18n.js';

// Rows that fit on a page, by table (row heights follow the design)
// Rows that fit the 577px content area of a page (measured on rendered PDFs)
// positionsGroup: the rows a further asset class block costs on a shared page
// (its heading, column header and total line)
const ROWS = { positions: 13, positionsGroup: 4, positionsMinStart: 4, positionsHeading: 2, tradesFirst: 14, tradesNext: 13, movements: 19, shareRows: 8, shareRowsCompact: 6, accountRows: 15, accountTable: 3, pnlWithChart: 7, pnlAlone: 14 };

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const isIsin = (v) => typeof v === 'string' && ISIN_PATTERN.test(v.trim().toUpperCase());

// Display order of asset classes in the statement
// Structured products are split by protection, as in the PMS (buildCategoryKey):
// capital guaranteed first, then partial, then conditional (barrier) protection
const SP_CATEGORY_ORDER = [
  'structured_product_capital_guaranteed',
  'structured_product_partial_guarantee',
  'structured_product_equity_linked_barrier_protected',
  'structured_product_barrier_protected'
];
const spCategoryRank = (key) => {
  const i = SP_CATEGORY_ORDER.indexOf(key);
  if (i >= 0) return i;
  return key === 'structured_product' ? 99 : 50; // other underlying types, then unclassified
};
const CLASS_ORDER = ['equity', 'fixed_income', 'structured_product', 'fund', 'monetary_products', 'time_deposit', 'private_equity', 'private_debt', 'commodities', 'derivatives', 'other'];
const CLASS_COLORS = ['#1A2B40', '#3E5A7A', '#7D93AD', '#A9561A', '#DD772A', '#B9B2A6', '#5E6B7D', '#C9A27E', '#9AA7B6', '#4B5563', '#D9D3C8'];
const SECTOR_LABEL = Object.fromEntries(SECTORS.filter(s => s.value).map(s => [s.value, s.label]));
// Liquidity beyond cash balances: the alternatives to holding cash
const LIQUID_CLASSES = new Set(['monetary_products', 'time_deposit']);
// Prices quoted in % of nominal
const PERCENT_PRICED = new Set(['fixed_income', 'structured_product']);

const ACTIVITY_GROUPS = [
  { key: 'CARD', types: ['CARD_PAYMENT'] },
  { key: 'PAYMENTS', types: ['PAYMENT_IN', 'PAYMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT'] },
  { key: 'INCOME', types: ['DIVIDEND', 'COUPON', 'OPTION_PREMIUM'] },
  { key: 'COSTS', types: ['INTEREST', 'FEE', 'TAX'] },
  { key: 'TRADES', types: ['BUY', 'SELL', 'SUBSCRIPTION', 'REDEMPTION'] },
  { key: 'FX', types: ['FX_TRADE'] }
];
const TRADE_TYPES = new Set(['BUY', 'SELL', 'SUBSCRIPTION', 'REDEMPTION']);
// The app's Income category (dividends, coupons, option premiums paid by
// structured products, interest). Interest counts only when received: debit
// interest is a cost of borrowing, shown with the financing.
const INCOME_TYPES = new Set(OPERATION_CATEGORIES.INCOME.types);
const isIncome = (op) => INCOME_TYPES.has(op.operationType)
  && (op.operationType !== OPERATION_TYPES.INTEREST || opAmount(op) > 0);

// Bank operation fields differ by parser; the harmonised `std` block wins when present
const opAmount = (op) => (op.std ? op.std.amount : (op.netAmount != null ? op.netAmount : op.grossAmount)) || 0;
const opGross = (op) => (op.grossAmount != null ? op.grossAmount : opAmount(op));
// Same fallback as the PMS operations tab (Julius Baer books carry no currency field)
const opCurrency = (op) => op.std?.currency || op.currency || op.accountCurrency || op.operationCurrency || op.instrumentCurrency || op.portfolioCurrency || null;
const opFees = (op) => Math.abs((op.std ? op.std.fees : (op.totalFees != null ? op.totalFees : op.fees)) || 0);
const opTaxes = (op) => Math.abs((op.std ? op.std.taxes : (op.withholdingTax ?? op.tax ?? 0)) || 0);
const opPrice = (op) => (op.std ? op.std.price : (op.price != null ? op.price : op.securityPrice)) ?? null;
const opQuantity = (op) => (op.std ? op.std.quantity : op.quantity) ?? null;

const DAY = 86400000;
const dateKey = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
const dayStart = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Everyone an account belongs to: holders, legacy owner and beneficial owners */
const accountPeople = (a) => [...getAccountHolderIds(a), a.userId, a.beneficialOwnerId, ...(a.beneficialOwnerIds || [])].filter(Boolean);
/** A life-insurance wrapper: held by the insurer, its name carries the policy */
const isLifeInsurance = (a) => !!a && (a.accountType === 'life_insurance' || a.accountStructure === 'life_insurance');

const chunk = (rows, first, next) => {
  const pages = [rows.slice(0, first)];
  for (let i = first; i < rows.length; i += next) pages.push(rows.slice(i, i + next));
  return pages;
};
const sum = (arr, f = (x) => x) => arr.reduce((t, x) => t + (f(x) || 0), 0);
const userName = (u) => (u ? `${u.profile?.firstName || ''} ${u.profile?.lastName || ''}`.trim() || u.username : '');

/**
 * Converter to the reference currency. A holding's values are in its ACCOUNT's
 * currency, and its bankFxRates state "units of X per 1 unit of that account
 * currency" — the custodian's own rate, so totals match the bank statement.
 */
const makeConverter = (holdings, eurRates, refCcy) => {
  const bank = {};
  for (const h of holdings) {
    if (h.portfolioCurrency && h.bankFxRates && !bank[h.portfolioCurrency]) bank[h.portfolioCurrency] = h.bankFxRates;
  }
  const missing = new Set();
  const rate = (from, to = refCcy) => {
    if (!from || from === to) return { rate: 1, source: null };
    // The rate stated in the file of an account held in the TARGET currency
    // first: that is the rate the custodian values the reference currency
    // with (CMB states EUR/USD 1.1339 in the USD account but 1.1199 in the EUR one).
    if (Number(bank[to]?.[from]) > 0) return { rate: 1 / Number(bank[to][from]), source: 'custodian' };
    if (Number(bank[from]?.[to]) > 0) return { rate: Number(bank[from][to]), source: 'custodian' };
    if (eurRates[from] > 0 && eurRates[to] > 0) return { rate: eurRates[from] / eurRates[to], source: 'market' };
    return null;
  };
  const convert = (value, from, to = refCcy) => {
    if (!value) return 0;
    const r = rate(from, to);
    if (!r) { missing.add(from); return value; }
    return value * r.rate;
  };
  return { convert, rate, missing };
};

/**
 * Holdings on record at the end of a past day, as the PMS historical view
 * shows them: the newest record per uniqueKey dated on or before that day.
 */
const holdingsAsOf = async (selector, asOf) => {
  const latestByKey = await PMSHoldingsCollection.rawCollection().aggregate([
    { $match: { $and: [selector, { isActive: true }, { snapshotDate: { $lt: new Date(dayStart(asOf).getTime() + DAY) } }] } },
    { $group: { _id: '$uniqueKey', top: { $top: { sortBy: { snapshotDate: -1, version: -1 }, output: '$$ROOT' } } } }
  ], { allowDiskUse: true }).toArray();
  return latestByKey.map(d => d.top);
};

/**
 * @param {Object} params
 * @param {Object} params.currentUser
 * @param {Object|null} params.viewAsFilter
 * @param {String|null} params.accountId - account tab the statement was opened on
 * @param {String|null} params.currency  - reference currency asked by the PMS
 * @param {String[]|null} params.sections - STATEMENT_SECTIONS keys to include (all when empty)
 * @param {String} [params.lang] - 'en' or 'fr'
 * @param {Boolean} [params.anonymous] - no client or account name, account numbers only
 * @param {String|null} [params.periodFrom] - report period start, 'YYYY-MM-DD'
 * @param {String|null} [params.periodTo] - report period end, 'YYYY-MM-DD' (latest valuation when empty)
 * @param {Date} [params.now]
 */
export async function buildStatement({
  currentUser, viewAsFilter = null, accountId = null, currency = null, sections = null,
  lang = 'en', anonymous = false, periodFrom = null, periodTo = null, now = new Date()
}) {
  const S = statementText(lang, { sectorLabels: SECTOR_LABEL });
  const F = statementFormat(lang);
  const { num, signed, pct, signedPct, qty, compact, dateLong, dateShort, dateCompact, dayMonth } = F;

  // ── Perimeter ──────────────────────────────────────────────────────────────
  const ownerIds = await getFilteredClientIds(currentUser, viewAsFilter || null);
  // One account: the viewAs account, or the account tab the report was opened on.
  // Either must belong to the perimeter (operations below are matched by account).
  const requestedAccountId = viewAsFilter?.type === 'account' ? viewAsFilter.id : accountId;
  let account = null;
  if (requestedAccountId) {
    const candidate = await BankAccountsCollection.findOneAsync(requestedAccountId);
    const holders = candidate ? accountPeople(candidate) : [];
    if (candidate && holders.some(id => ownerIds.includes(id))) account = candidate;
    else if (viewAsFilter?.type === 'account') throw new Meteor.Error('not-authorized', 'Account outside your perimeter');
  }

  // Accounts as the PMS screen resolves them: held, co-held, or beneficially
  // owned (a life-insurance wrapper is held by the insurer for the client)
  const accounts = account
    ? [account]
    : (ownerIds.length ? await BankAccountsCollection.find({
        isActive: true,
        $or: [...accountHolderSelector(ownerIds).$or, { beneficialOwnerIds: { $in: ownerIds } }, { beneficialOwnerId: { $in: ownerIds } }]
      }).fetchAsync() : []);
  // Holdings by owner, or by bank account (bank + account number, sub-account
  // codes included) for the accounts above, whoever the bank file filed them under
  const byAccount = accounts.filter(a => a.bankId && a.accountNumber)
    .map(a => ({ bankId: a.bankId, portfolioCode: { $regex: `^${escapeRe(String(a.accountNumber).split('-')[0])}(-|$)` } }));
  const holdingsSelector = account
    ? { bankId: account.bankId, portfolioCode: account.accountNumber }
    : { portfolioCode: { $ne: 'CONSOLIDATED' }, $or: [{ userId: { $in: ownerIds } }, { entityId: { $in: ownerIds } }, ...byAccount] };
  // A period ending before today values the positions as they stood that day
  const periodEnd = periodTo ? new Date(`${periodTo}T00:00:00Z`) : null;
  const historical = periodEnd && !Number.isNaN(periodEnd.getTime()) && periodEnd < dayStart(now);
  const holdings = historical
    ? await holdingsAsOf(holdingsSelector, periodEnd)
    : await PMSHoldingsCollection.find({ ...holdingsSelector, isActive: true, isLatest: true }).fetchAsync();

  const codes = [...new Set([...accounts.map(a => a.accountNumber), ...holdings.map(h => h.portfolioCode)].filter(Boolean))];
  const accountByCode = new Map(accounts.map(a => [`${a.bankId}|${a.accountNumber}`, a]));
  const accountOf = (h) => accountByCode.get(`${h.bankId}|${h.portfolioCode}`) || null;

  const bankIds = [...new Set([...accounts.map(a => a.bankId), ...holdings.map(h => h.bankId)].filter(Boolean))];
  const banks = await BanksCollection.find({ _id: { $in: bankIds } }, { fields: { name: 1 } }).fetchAsync();
  const custodians = banks.map(b => b.name).filter(Boolean);
  const custodianText = custodians.length ? custodians.join(', ') : '—';

  const entities = await ClientEntitiesCollection.find({ _id: { $in: ownerIds } }).fetchAsync();
  const primaryEntity = account?.entityId ? entities.find(e => e._id === account.entityId) || entities[0] : entities[0];

  const refCcy = currency
    || (account?.referenceCurrency)
    || (primaryEntity ? getClientReferenceCurrency(primaryEntity, accounts).currency : null)
    || holdings[0]?.portfolioCurrency || 'EUR';

  const isinList = [...new Set(holdings.map(h => h.isin).filter(isIsin))];
  const metadata = await SecuritiesMetadataCollection.find({ isin: { $in: isinList } }).fetchAsync();
  const metaByIsin = Object.fromEntries(metadata.map(m => [m.isin, m]));
  const eurRates = buildRatesMap(await CurrencyRateCacheCollection.find({}).fetchAsync());
  const fx = makeConverter(holdings, eurRates, refCcy);

  const valuationDate = holdings.length
    ? new Date(Math.max(...holdings.map(h => new Date(h.snapshotDate || h.updatedAt || now).getTime())))
    : (historical ? periodEnd : now);
  // Period: from the date asked (never after the valuation), else 1 January
  const askedStart = periodFrom ? new Date(`${periodFrom}T00:00:00Z`) : null;
  const periodStart = askedStart && !Number.isNaN(askedStart.getTime()) && askedStart <= valuationDate
    ? askedStart
    : new Date(Date.UTC(valuationDate.getUTCFullYear(), 0, 1));
  const periodStartIso = dateKey(periodStart);
  // Operations up to the end of the period's last day (the valuation day when none was asked)
  const operationsEnd = new Date(dayStart(historical ? periodEnd : (periodEnd && periodEnd > valuationDate ? periodEnd : valuationDate)).getTime() + DAY);
  const periodEndDate = new Date(operationsEnd.getTime() - DAY);
  const periodText = S.periodText(dateLong(periodStart), dateLong(periodEndDate));

  // ── Positions ──────────────────────────────────────────────────────────────
  const positions = [];
  const cashRows = [];
  for (const h of holdings) {
    const valueRef = fx.convert(h.marketValue || 0, h.portfolioCurrency || refCcy);
    if (isPureCashHolding(h)) {
      // A balance held in the reference currency is taken as booked, not converted
      // to the account's currency and back (a USD balance on a EUR account lost cents)
      const balanceRef = h.currency === refCcy && Number.isFinite(h.marketValueOriginalCurrency) ? h.marketValueOriginalCurrency : valueRef;
      cashRows.push({ h, valueRef: balanceRef, account: accountOf(h) });
      continue;
    }
    const meta = metaByIsin[h.isin] || null;
    const cls = classifyHolding(h, meta);
    const costRef = fx.convert(h.costBasisPortfolioCurrency || 0, h.portfolioCurrency || refCcy);
    const pnlRef = Number.isFinite(h.unrealizedPnL) ? fx.convert(h.unrealizedPnL, h.portfolioCurrency || refCcy) : valueRef - costRef;
    positions.push({
      h, meta, assetClass: cls.assetClass === 'cash' ? 'other' : cls.assetClass,
      categoryKey: buildCategoryKey(cls),
      name: meta?.securityName || h.displayName || h.securityName || h.isin || '—',
      isin: isIsin(h.isin) ? h.isin : null,
      ccy: h.currency || h.portfolioCurrency,
      valueRef, costRef, pnlRef,
      valueCcy: h.marketValueOriginalCurrency ?? h.marketValue
    });
  }
  positions.sort((a, b) => b.valueRef - a.valueRef);

  const assetsCash = cashRows.filter(c => c.valueRef > 0);
  const financingCash = cashRows.filter(c => c.valueRef < 0);
  const securitiesValue = sum(positions, p => p.valueRef);
  const cashValue = sum(assetsCash, c => c.valueRef);
  const financing = sum(financingCash, c => c.valueRef);
  const gross = securitiesValue + cashValue;
  const nav = gross + financing;
  const hasFinancing = financing < 0;
  const securitiesCost = sum(positions, p => p.costRef);
  const securitiesPnl = sum(positions, p => p.pnlRef);
  const weight = (v) => (gross ? v / gross : 0);
  // Liquidity = cash balances + money-market funds + term deposits; the rest is invested
  const moneyMarketValue = sum(positions.filter(p => p.assetClass === 'monetary_products'), p => p.valueRef);
  const termDepositValue = sum(positions.filter(p => p.assetClass === 'time_deposit'), p => p.valueRef);
  const liquidityValue = cashValue + moneyMarketValue + termDepositValue;
  const investedPositions = positions.filter(p => !LIQUID_CLASSES.has(p.assetClass));
  const investedValue = sum(investedPositions, p => p.valueRef);
  const liquidityParts = [['cash', cashValue], ['moneyMarket', moneyMarketValue], ['termDeposits', termDepositValue]].filter(([, v]) => v > 0);

  // Asset classes held, in display order
  const classes = [...new Set(positions.map(p => p.assetClass))]
    .sort((a, b) => (CLASS_ORDER.indexOf(a) === -1 ? 99 : CLASS_ORDER.indexOf(a)) - (CLASS_ORDER.indexOf(b) === -1 ? 99 : CLASS_ORDER.indexOf(b)));
  const classTotals = classes.filter(key => !LIQUID_CLASSES.has(key)).map((key, i) => {
    const value = sum(positions.filter(p => p.assetClass === key), p => p.valueRef);
    return { key, label: S.assetClass(key), value, color: CLASS_COLORS[i % CLASS_COLORS.length] };
  });
  const cashColor = '#DD772A';

  // Position blocks: one per asset class, structured products one per protection category
  const positionGroups = classes.flatMap(classKey => {
    const rows = positions.filter(p => p.assetClass === classKey);
    if (classKey !== 'structured_product') return [{ key: classKey, classKey, label: S.assetClass(classKey), rows }];
    const cats = [...new Set(rows.map(p => p.categoryKey))].sort((a, b) => spCategoryRank(a) - spCategoryRank(b) || a.localeCompare(b));
    return cats.map(cat => ({
      key: cat, classKey,
      label: S.spGroupLabel(cat),
      subLabel: cat === 'structured_product' ? S.unclassified : S.spCategory(cat),
      shortLabel: S.spShort[cat] || S.spCategory(cat),
      rows: rows.filter(p => p.categoryKey === cat)
    }));
  });
  // Rows of the allocation table: classes, structured-product sub-rows, cash
  const allocationRowCount = classTotals.length + positionGroups.filter(g => g.subLabel).length
    + (liquidityValue > 0 ? 1 + (liquidityParts.length > 1 ? liquidityParts.length : 0) : 0);

  // ── Currency exposure (assets net of financing, per currency) ──────────────
  const ccyMap = {};
  const addCcy = (ccy, field, v) => {
    if (!ccyMap[ccy]) ccyMap[ccy] = { assets: 0, financing: 0 };
    ccyMap[ccy][field] += v;
  };
  positions.forEach(p => addCcy(p.ccy || refCcy, 'assets', p.valueRef));
  assetsCash.forEach(c => addCcy(c.h.currency || c.h.portfolioCurrency || refCcy, 'assets', c.valueRef));
  financingCash.forEach(c => addCcy(c.h.currency || c.h.portfolioCurrency || refCcy, 'financing', c.valueRef));
  const exposure = Object.entries(ccyMap)
    .map(([ccy, v]) => ({ ccy, ...v, net: v.assets + v.financing }))
    .sort((a, b) => b.net - a.net);
  const maxExposure = Math.max(...exposure.map(e => Math.abs(nav ? e.net / nav : 0)), 0.0001);
  const shortCcys = exposure.filter(e => e.net < 0).map(e => e.ccy);

  // ── Equities by sector / region ────────────────────────────────────────────
  const equities = positions.filter(p => p.assetClass === 'equity');
  const equityTotal = sum(equities, p => p.valueRef);
  const groupShare = (keyOf, labelOf, maxRows) => {
    const g = {};
    equities.forEach(p => { const k = keyOf(p); g[k] = (g[k] || 0) + p.valueRef; });
    const rows = Object.entries(g).sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 1;
    const shown = rows.length > maxRows ? rows.slice(0, maxRows - 1) : rows;
    const rest = rows.length > maxRows ? sum(rows.slice(maxRows - 1), r => r[1]) : 0;
    const row = (label, v) => ({ label, valueText: num(v), shareText: pct(equityTotal ? v / equityTotal : 0), barPct: max ? (v / max) * 100 : 0 });
    return shown.map(([k, v]) => row(labelOf(k), v)).concat(rest ? [row(S.otherRows, rest)] : []);
  };
  // A taller allocation table (compact layout) leaves fewer rows below it
  const sectorRows = (maxRows) => groupShare(p => p.meta?.sector || '', k => S.sector(k), maxRows);
  const regionRows = (maxRows) => groupShare(
    p => (p.meta?.listingCountry && p.meta.listingCountry.length === 2 ? p.meta.listingCountry.toUpperCase() : (p.isin ? p.isin.slice(0, 2) : '')),
    k => F.countryName(k),
    maxRows
  );

  // ── Operations of the period ───────────────────────────────────────────────
  // Operations are matched by bank account (bank + account number), as banks
  // book them under sub-account codes ("5040241-1") and older ones carry a
  // legacy owner id only. The accounts themselves are already in scope.
  const accountKeys = [...new Map([...accounts.map(a => [a.bankId, a.accountNumber]), ...holdings.map(h => [h.bankId, h.portfolioCode])]
    .filter(([bankId, code]) => bankId && code)
    .map(([bankId, code]) => [`${bankId}|${code}`, { bankId, code }])).values()];
  const operationAccounts = accountKeys.map(({ bankId, code }) => ({ bankId, portfolioCode: { $regex: `^${escapeRe(String(code).split('-')[0])}(-|$)` } }));
  const operations = operationAccounts.length ? await PMSOperationsCollection.find({
    isActive: true, $or: operationAccounts, operationDate: { $gte: periodStart, $lt: operationsEnd }
  }, { sort: { operationDate: -1 } }).fetchAsync() : [];
  // Securities traded but no longer held: their names come from the reference data too
  const tradedIsins = [...new Set(operations.map(o => String(o.isin || '').toUpperCase()).filter(i => isIsin(i) && !metaByIsin[i]))];
  if (tradedIsins.length) {
    (await SecuritiesMetadataCollection.find({ isin: { $in: tradedIsins } }).fetchAsync()).forEach(m => { metaByIsin[m.isin] = m; });
  }
  const typeLabel = (t) => S.type(t) || S.type('OTHER');
  const opText = (op) => op.std?.description || op.description || op.operationTypeName || op.remark || S.type(op.operationType) || S.movement;

  const income = operations.filter(isIncome);
  const incomeByCcy = Object.values(income.reduce((m, o) => {
    const c = opCurrency(o) || refCcy;
    if (!m[c]) m[c] = { ccy: c, count: 0, net: 0, tax: 0 };
    // Signed: a reversal (negative booking) cancels the payment it corrects
    if (opAmount(o) > 0) m[c].count += 1;
    m[c].net += opAmount(o); m[c].tax += opTaxes(o);
    return m;
  }, {})).sort((a, b) => b.net - a.net);
  const incomeTotalRef = sum(incomeByCcy, r => fx.convert(r.net, r.ccy));
  const incomeCount = sum(incomeByCcy, r => r.count);

  // A cancelled trade is booked with the trade's type and the opposite amount.
  // Read from the sign only for banks booking signed amounts (a purchase debited).
  const signedTradeBanks = new Set(operations.filter(o => o.operationType === 'BUY' && opAmount(o) < 0).map(o => o.bankId));
  const isTradeReversal = (o) => o.isReversal === true || (signedTradeBanks.has(o.bankId)
    && ((o.operationType === 'BUY' && opAmount(o) > 0) || (o.operationType === 'SELL' && opAmount(o) < 0)));
  const trades = operations.filter(o => TRADE_TYPES.has(o.operationType)).map(o => {
    const amount = opAmount(o);
    return {
      date: dateCompact(o.operationDate),
      side: typeLabel(o.operationType),
      // Shown as a small second line under the side, like the ISIN under the name
      sideNote: isTradeReversal(o) ? S.reversal : '',
      security: metaByIsin[o.isin]?.securityName || o.std?.instrumentName || o.instrumentName || o.securityName || '—',
      isin: isIsin(o.isin) ? o.isin.toUpperCase() : '',
      qty: opQuantity(o) != null ? qty(opQuantity(o)) : '—',
      price: opPrice(o) != null ? num(opPrice(o), 2) : '—',
      fees: opFees(o) ? num(-opFees(o)) : '—',
      ccy: opCurrency(o) || '',
      net: signed(amount),
      isPositive: amount >= 0
    };
  });

  // Card spending per month of the period
  const cardOps = operations.filter(o => o.operationType === 'CARD_PAYMENT');
  const periodMonths = [];
  for (let m = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1)); m < operationsEnd; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    periodMonths.push(m);
  }
  const spansYears = periodMonths.length && periodMonths[0].getUTCFullYear() !== periodMonths[periodMonths.length - 1].getUTCFullYear();
  const monthKey = (d) => { const x = new Date(d); return `${x.getUTCFullYear()}-${x.getUTCMonth()}`; };
  const cardMonths = periodMonths.slice(-12).map(m => {
    const spent = sum(cardOps.filter(o => monthKey(o.operationDate) === monthKey(m)), o => fx.convert(Math.abs(opAmount(o)), opCurrency(o) || refCcy));
    const label = `${F.monthAbbr(m.getUTCMonth())}${spansYears ? ` ${String(m.getUTCFullYear()).slice(2)}` : ''}`;
    return { label, value: spent, valueText: spent ? compact(spent) : '', positive: true };
  });
  const cardTotal = sum(cardOps, o => fx.convert(Math.abs(opAmount(o)), opCurrency(o) || refCcy));

  const activityCounts = ACTIVITY_GROUPS.map(g => ({ label: S.activity[g.key], count: operations.filter(o => g.types.includes(o.operationType)).length }))
    .concat([{ label: S.activity.OTHER, count: operations.filter(o => !ACTIVITY_GROUPS.some(g => g.types.includes(o.operationType))).length }])
    .filter(g => g.count > 0);

  // Interest and fees on borrowing in the period
  const financingCodes = new Set(accounts.filter(a => !isInvestmentAccount(a)).map(a => String(a.accountNumber).split('-')[0]));
  const costOps = operations.filter(o => (o.operationType === 'INTEREST' && opAmount(o) < 0)
    || (o.operationType === 'FEE' && financingCodes.has(String(o.portfolioCode || '').split('-')[0])));
  const costRows = Object.values(costOps.reduce((m, o) => {
    const c = opCurrency(o) || refCcy;
    const key = `${o.operationType}|${c}`;
    if (!m[key]) m[key] = { label: o.operationType === 'INTEREST' ? S.debitInterest : S.financingFees, ccy: c, amount: 0 };
    m[key].amount += -Math.abs(opAmount(o));
    return m;
  }, {}));
  const costTotalRef = sum(costRows, r => fx.convert(r.amount, r.ccy));

  // ── NAV history and performance ────────────────────────────────────────────
  let navSeries = [];
  if (codes.length) {
    const snaps = dedupeSnapshotsPerAccountDay(filterSnapshotsByBankStartDate(await PortfolioSnapshotsCollection.find({
      portfolioCode: { $in: codes }, ...(account ? { bankId: account.bankId } : {}), snapshotDate: { $lte: valuationDate }
    }, { sort: { snapshotDate: 1 } }).fetchAsync()));
    const consolidated = buildConsolidatedDailyValues(snaps, (v, c) => fx.convert(v, c || refCcy));
    navSeries = (consolidated.dailyValues || []).map(d => ({ date: d.date, value: d.totalValue }));
  }
  const navAt = (when) => {
    const iso = dateKey(when);
    let best = null;
    for (const p of navSeries) { if (p.date <= iso) best = p; else break; }
    return best;
  };
  // The chart shows the period, from the last valuation at or before its start
  const navStart = navAt(periodStart);
  const periodNavSeries = navSeries.filter(p => p.date > periodStartIso || (navStart && p.date === navStart.date));

  let twr = null;
  try {
    const { computeTWR } = await import('../../methods/performanceMethods.js');
    if (codes.length) {
      twr = await computeTWR({ codes, portfolioCode: account ? account.accountNumber : null, currency: refCcy, now: valuationDate, label: 'statement', customStart: periodStart });
    }
  } catch (e) {
    console.error('[STATEMENT] TWR failed:', e.message);
  }
  // The report period first, then the standard periods that lie inside it
  const PERIODS = ['CUSTOM', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'];
  const navEnd = navSeries[navSeries.length - 1] || null;
  const seenStarts = new Set();
  const periodRows = PERIODS.map((key) => {
    const p = twr?.periods?.[key];
    if (!p || !p.hasData) return null;
    if (key !== 'CUSTOM' && p.startDate < periodStartIso) return null;
    // Returns start where the history allows it (first valuation, or start of the
    // custodian's operations history); periods reduced to the same start are shown once
    const measuredFrom = p.measuredFrom || p.startDate;
    if (seenStarts.has(measuredFrom)) return null;
    seenStarts.add(measuredFrom);
    // Value at the period start, or the first valuation when the history is shorter
    const start = navAt(measuredFrom) || navSeries[0];
    const change = start && navEnd ? navEnd.value - start.value : null;
    const shortened = key !== 'ALL' && measuredFrom > p.startDate;
    const label = key === 'CUSTOM' ? S.periodLabels.PERIOD : (shortened ? S.since(dateShort(measuredFrom)) : S.periodLabels[key]);
    return {
      key, label, shortened, fromText: S.from(dateShort(start ? start.date : p.startDate)), change, startDate: start ? start.date : null,
      startText: start ? num(start.value) : '—',
      changeText: change != null ? signed(change) : '—', changePositive: (change || 0) >= 0,
      twrText: signedPct(p.twr), twrPositive: (p.twr || 0) >= 0
    };
  }).filter(Boolean);
  const periodRow = periodRows.find(r => r.key === 'CUSTOM') || null;
  const monthly = (twr?.periodCalendar?.monthly || []).slice(-12);
  const monthlyChart = buildBarChart(monthly.map(m => ({
    label: `${F.monthAbbr(Number(m.key.slice(5, 7)) - 1)}${m.isPartial ? '*' : ''}`, value: m.twr * 100, valueText: signedPct(m.twr), positive: m.isPositive
  })), { width: 360, height: 150, tickFormat: (v) => F.pctOf(v, Number.isInteger(v) ? 0 : 1) });
  const yearly = (twr?.periodCalendar?.yearly || []).map(y => ({ label: y.label, twrText: signedPct(y.twr), isPositive: y.isPositive, partial: y.isPartial }));

  // ── Title: the client or account, or account numbers only when anonymous ────
  const accountCodes = [...new Set(holdings.map(h => h.portfolioCode).concat(accounts.map(a => a.accountNumber)).filter(Boolean))].sort();
  const namedTitle = () => {
    // A life-insurance wrapper is titled by its policy (the account's name),
    // not by the insurer that holds it: "UTMOST · Policy 2404-154427 STA"
    if (isLifeInsurance(account) && account.name) {
      const insurer = primaryEntity ? ClientEntityHelpers.getEntityDisplayName(primaryEntity) : '';
      const name = String(account.name).trim();
      return insurer && name.toUpperCase().startsWith(insurer.toUpperCase()) && name.length > insurer.length
        ? `${insurer} · ${S.policy} ${name.slice(insurer.length).trim()}`
        : name;
    }
    if (entities.length === 1 || account) {
      return primaryEntity ? ClientEntityHelpers.getEntityDisplayName(primaryEntity) : (account?.name || viewAsFilter?.label || S.titlePortfolio);
    }
    return viewAsFilter?.label || S.titleConsolidated;
  };
  const anonymousTitle = () => {
    if (account) return S.titleAccount(account.accountNumber);
    return accountCodes.length === 1 ? S.titleAccount(accountCodes[0]) : S.titleConsolidated;
  };
  const clientName = anonymous ? anonymousTitle() : namedTitle();

  // ── Page model ─────────────────────────────────────────────────────────────
  const header = {
    clientName,
    ccy: refCcy,
    valuationText: S.headerValuation(dateLong(valuationDate)),
    currencyText: S.headerCurrency(refCcy)
  };
  const sectionName = (n) => `${n} · ${S.sections[STATEMENT_SECTIONS.find(s => s.n === n).key]}`;
  const pages = [];

  // 01 Overview
  const top5 = positions.slice(0, 5);
  pages.push({
    type: 'overview', section: sectionName('01'), title: S.overviewTitle,
    caption: S.overviewCaption(accountCodes, custodians.length ? custodianText : null),
    navInt: num(Math.trunc(nav), 0), navDec: `${F.decimalSep}${Math.abs(nav).toFixed(2).split('.')[1]}`, navSign: nav < 0 ? '−' : '',
    ytdChangeText: periodRow && periodRow.change != null ? signed(periodRow.change) : null,
    ytdChangePositive: periodRow ? (periodRow.change || 0) >= 0 : true,
    ytdChangeLabel: periodRow && periodRow.change != null ? S.changeSince(dateLong(periodRow.startDate)) : null,
    grossText: num(gross), financingText: num(financing), hasFinancing,
    positionsText: S.positionsCount(positions.length, exposure.length),
    waterfall: hasFinancing ? {
      grossText: num(gross), financingText: num(financing), navText: num(nav),
      securitiesPct: gross ? (investedValue / gross) * 100 : 0, cashPct: gross ? (liquidityValue / gross) * 100 : 0,
      navPct: gross ? Math.max(0, (nav / gross) * 100) : 0,
      legend: [
        { color: '#1A2B40', text: S.legendSecurities(num(investedValue)) },
        { color: '#DD772A', text: S.legendLiquidity(num(liquidityValue)) },
        { color: '#C76A5A', text: S.legendFinancing }
      ]
    } : null,
    kpis: [
      { label: S.kpiPnl, value: signed(securitiesPnl), tone: securitiesPnl >= 0 ? 'pos' : 'neg', caption: S.kpiPnlCaption(signedPct(securitiesCost ? securitiesPnl / securitiesCost : 0), num(securitiesCost)) },
      {
        label: S.liquidity, value: num(liquidityValue),
        // The cash itself stays visible (full split on the allocation and liquidity pages)
        caption: liquidityParts.length > 1 ? S.ofWhichCash(compact(cashValue)) : S.liquidityShare(pct(weight(liquidityValue)))
      },
      { label: S.kpiSecurities, value: num(investedValue), caption: S.kpiSecuritiesCaption(investedPositions.length) },
      { label: S.kpiIncome, value: num(incomeTotalRef), caption: S.kpiIncomeCaption(incomeCount) }
    ],
    largest: {
      caption: S.largestCaption(top5.length, pct(weight(sum(top5, p => p.valueRef)))),
      rows: top5.map(p => ({ name: p.name, shareText: pct(weight(p.valueRef)), barPct: top5[0] && top5[0].valueRef > 0 ? Math.max(0, Math.min(100, (p.valueRef / top5[0].valueRef) * 98.6)) : 0 }))
    },
    exposure: {
      rows: exposure.map(e => {
        const share = nav ? e.net / nav : 0;
        return { ccy: e.ccy, text: signedPct(share, 1), negative: share < 0,
          // Axis at 28% of the track: shorts extend left (28% max), longs right
          barLeftPct: share < 0 ? 28 - Math.min(28, (Math.abs(share) / maxExposure) * 70) : 28,
          barWidthPct: share < 0 ? Math.min(28, (Math.abs(share) / maxExposure) * 70) : (Math.abs(share) / maxExposure) * 70 };
      }),
      caption: shortCcys.length ? S.exposureShort(shortCcys.join(', ')) : S.exposureLong
    },
    periods: periodRows.filter(r => ['CUSTOM', '1M', '3M', '6M', 'YTD'].includes(r.key)).slice(0, 4)
  });

  // 02 Allocation
  const circumference = 2 * Math.PI * 68;
  let offset = 0;
  const donut = classTotals.concat(liquidityValue > 0 ? [{ key: 'liquidity', label: S.liquidity, value: liquidityValue, color: cashColor }] : []).map(c => {
    const len = gross ? (c.value / gross) * circumference : 0;
    const seg = { color: c.color, dash: `${len.toFixed(2)} ${circumference.toFixed(2)}`, offset: (-offset).toFixed(2) };
    offset += len;
    return seg;
  });
  pages.push({
    type: 'allocation', section: sectionName('02'), title: S.allocationTitle,
    caption: S.allocationCaption(refCcy, num(gross)),
    compact: allocationRowCount > 5,
    donutSize: allocationRowCount > 5 ? 156 : 188,
    donut: { segments: donut, financingArc: hasFinancing ? `${((Math.min(1, -financing / gross)) * 2 * Math.PI * 86).toFixed(2)} ${(2 * Math.PI * 86).toFixed(2)}` : null, centerText: compact(gross) },
    allocationRows: classTotals.flatMap(c => {
      const row = { label: c.label, color: c.color, valueText: num(c.value), weightText: pct(weight(c.value)) };
      // Structured products: one sub-row per protection category, as in the PMS
      const subs = positionGroups.filter(g => g.classKey === c.key && g.subLabel);
      return subs.length ? [row, ...subs.map(g => {
        const v = sum(g.rows, p => p.valueRef);
        return { label: g.shortLabel, sub: true, valueText: num(v), weightText: pct(weight(v)) };
      })] : [row];
    })
      // Liquidity, with cash, money-market funds and term deposits under it
      .concat(liquidityValue > 0 ? [{ label: S.liquidity, color: cashColor, valueText: num(liquidityValue), weightText: pct(weight(liquidityValue)) }] : [])
      .concat(liquidityParts.length > 1 ? liquidityParts.map(([k, v]) => ({ label: S.liquidityRows[k], sub: true, valueText: num(v), weightText: pct(weight(v)) })) : []),
    grossText: num(gross), grossWeight: pct(1), hasFinancing, financingText: num(financing), financingWeight: pct(weight(financing)),
    navText: num(nav), navWeight: pct(weight(nav)),
    exposureRows: exposure.map(e => {
      const share = nav ? e.net / nav : 0;
      return {
        ccy: e.ccy, assetsText: num(e.assets), financingText: num(e.financing), financingZero: !e.financing,
        netText: num(e.net), negative: e.net < 0, shareText: pct(share, 1),
        // Bar on an axis at 18px: shorts extend left (17px max), longs right (48px max)
        barLeft: e.net < 0 ? 18 - Math.min(17, (Math.abs(share) / maxExposure) * 48) : 19,
        barWidth: e.net < 0 ? Math.min(17, (Math.abs(share) / maxExposure) * 48) : Math.min(48, (Math.abs(share) / maxExposure) * 48)
      };
    }),
    exposureTotal: { assets: num(sum(exposure, e => e.assets)), financing: num(financing), net: num(nav), share: pct(1, 1) },
    exposureCaption: shortCcys.length ? S.exposureCaption(shortCcys.join(', '), shortCcys.length) : null,
    sectors: sectorRows(allocationRowCount > 5 ? ROWS.shareRowsCompact : ROWS.shareRows),
    regions: regionRows(allocationRowCount > 5 ? ROWS.shareRowsCompact : ROWS.shareRows), hasEquities: equities.length > 0,
    equityTotalText: num(equityTotal)
  });

  // 03 Positions: one block per asset class. Classes that fit share a page; a
  // class longer than a page starts on a fresh one and continues over the next.
  const positionPages = [];
  let current = null;
  const newPositionPage = () => { current = { groups: [], used: 0 }; positionPages.push(current); return current; };
  for (const group of positionGroups) {
    const { key, rows } = group;
    const isPercent = PERCENT_PRICED.has(group.classKey);
    const total = sum(rows, p => p.valueRef);
    const totalCost = sum(rows, p => p.costRef);
    const totalPnl = sum(rows, p => p.pnlRef);
    const display = rows.map(p => {
      const h = p.h;
      const price = Number(h.marketPrice);
      const cost = Number(h.costPrice);
      // Parsers store percentage prices as decimals (1.0 = 100%, CLAUDE.md); the
      // holding's priceType says which, never the size of the number.
      const asPercent = h.priceType === 'percentage';
      const fmtPrice = (v) => (Number.isFinite(v) && v ? (asPercent ? F.pctOf(v * 100, 2) : num(v, 2)) : '—');
      return {
        name: p.name, isin: p.isin || '', ccy: p.ccy || '',
        qty: qty(h.quantity),
        cost: fmtPrice(cost),
        price: fmtPrice(price),
        // The day the custodian's price was struck (none stated: no date shown)
        priceDate: h.priceDate && Number.isFinite(price) && price ? dateShort(h.priceDate) : '',
        valueCcy: num(p.valueCcy), valueRef: num(p.valueRef),
        pnl: signed(p.pnlRef), pnlPct: p.costRef ? signedPct(p.pnlRef / p.costRef) : '—', pnlPositive: p.pnlRef >= 0,
        weight: pct(weight(p.valueRef))
      };
    });
    const label = group.label;
    const pnlText = `${signed(totalPnl)} (${signedPct(totalCost ? totalPnl / totalCost : 0)})`;
    const classLabel = S.assetClass(group.classKey);
    const subLabel = group.subLabel || null; // protection category of a structured-product block
    const block = {
      key, label, isPercent, classKey: group.classKey, classLabel, subLabel,
      kpis: [
        { label: S.kpiMarketValue(refCcy), value: num(total) },
        { label: S.kpiUnrealised(refCcy), value: pnlText, tone: totalPnl >= 0 ? 'pos' : 'neg' },
        { label: S.kpiPositions, value: String(rows.length) }
      ],
      summaryText: S.blockSummary(num(total), refCcy, pnlText, rows.length),
      total: { label: S.total(subLabel ? group.shortLabel : label), valueRef: num(total), pnl: signed(totalPnl), pnlPct: totalCost ? signedPct(totalPnl / totalCost) : '—', pnlPositive: totalPnl >= 0, weight: pct(weight(total)) }
    };
    let remaining = display;
    let part = 0;
    while (remaining.length) {
      const shared = current && current.groups.length > 0;
      // A further block on a shared page also gives the first block its heading
      const overhead = shared ? ROWS.positionsGroup + (current.groups.length === 1 ? 1 : 0) : 0;
      const room = current ? ROWS.positions - current.used - overhead : 0;
      let take;
      // A structured-product block alone on its page still shows its category heading
      const headingRow = !shared && subLabel ? ROWS.positionsHeading : 0;
      if (current && !shared) take = Math.min(remaining.length, ROWS.positions - headingRow);
      // A block joins a shared page when it fits there whole, or when it spans pages
      // anyway (longer than a page) and at least ROWS.positionsMinStart rows fit here
      else if (part === 0 && (remaining.length <= room || (remaining.length > ROWS.positions - 1 && room >= ROWS.positionsMinStart))) take = Math.min(remaining.length, room);
      else { newPositionPage(); continue; }
      current.groups.push({ ...block, part, rows: remaining.slice(0, take), complete: take === remaining.length });
      current.used += take + overhead + headingRow;
      remaining = remaining.slice(take);
      part += 1;
    }
  }
  positionPages.forEach((pg) => {
    // Titles name asset classes; structured-product categories are section headings
    // (with their class named too when the page mixes classes)
    const labels = [...new Set(pg.groups.map(g => g.classLabel))];
    const groups = pg.groups.map(g => ({
      key: g.key, isPercent: g.isPercent, rows: g.rows,
      heading: `${g.subLabel && labels.length === 1 ? g.subLabel : g.label}${g.part > 0 ? S.continued : ''}`,
      summaryText: g.part === 0 ? g.summaryText : null,
      total: g.complete ? g.total : null
    }));
    const single = pg.groups.length === 1 ? pg.groups[0] : null;
    const lastGroup = pg.groups[pg.groups.length - 1];
    pages.push({
      type: 'positions', section: sectionName('03'), refCcy,
      title: labels.length === 1 ? `${labels[0]}${pg.groups[0].part > 0 ? S.continued : ''}`
        : labels.length === 2 ? `${labels[0]} ${S.and} ${labels[1].toLowerCase()}` : S.otherHoldings,
      kpis: single && single.part === 0 ? single.kpis : null,
      showHeadings: !single || !!single.subLabel,
      groups,
      footnote: lastGroup.complete ? S.positionsFootnote(refCcy, pg.groups.some(g => g.isPercent)) : null
    });
  });

  // 03 Liquidity and financing
  const otherCcys = [...new Set([...positions.map(p => p.ccy), ...cashRows.map(c => c.h.currency)].filter(c => c && c !== refCcy))].sort();
  const cashLabel = (c) => c.account?.comment || c.h.securityName?.split(/\s+(?:STANDARD|DB|CR)\s+/)[0] || S.cashAccount;
  const liquidityPage = {
    type: 'liquidity', section: sectionName('03'), title: S.liquidityTitle, refCcy, hasFinancing,
    kpis: [
      { label: S.kpiLiquidityCcy(refCcy), value: num(liquidityValue) },
      ...(liquidityParts.length > 1 ? [{ label: S.kpiCashCcy(refCcy), value: num(cashValue) }] : []),
      ...(hasFinancing ? [{ label: S.kpiFinancingCcy(refCcy), value: num(financing), tone: 'neg' }] : [])
    ],
    cash: {
      caption: S.cashAccountsCount(assetsCash.length),
      rows: assetsCash.sort((a, b) => b.valueRef - a.valueRef).map(c => ({
        label: cashLabel(c), account: c.h.portfolioCode, ccy: c.h.currency || '', balance: num(c.h.marketValueOriginalCurrency ?? c.h.quantity),
        valueRef: num(c.valueRef), weight: pct(weight(c.valueRef))
      })),
      totalText: num(cashValue), totalWeight: pct(weight(cashValue))
    },
    financing: hasFinancing ? {
      caption: accounts.filter(a => !isInvestmentAccount(a) && a.authorizedOverdraft)
        .map(a => S.facilityLimit(a.comment || S.facility, a.accountNumber, a.referenceCurrency || '', num(a.authorizedOverdraft, 0))).join(' · ') || null,
      rows: financingCash.sort((a, b) => a.valueRef - b.valueRef).map(c => ({
        label: cashLabel(c), account: c.h.portfolioCode, ccy: c.h.currency || '', balance: num(c.h.marketValueOriginalCurrency ?? c.h.quantity),
        valueRef: num(c.valueRef), weight: pct(weight(c.valueRef))
      })),
      totalText: num(financing), totalWeight: pct(weight(financing))
    } : null,
    // Money-market funds and term deposits (also listed with the positions)
    liquidInstruments: moneyMarketValue + termDepositValue > 0 ? {
      rows: positions.filter(p => LIQUID_CLASSES.has(p.assetClass)).map(p => ({ name: p.name, ccy: p.ccy || '', valueRef: num(p.valueRef), weight: pct(weight(p.valueRef)) })),
      totalText: num(moneyMarketValue + termDepositValue), totalWeight: pct(weight(moneyMarketValue + termDepositValue))
    } : null,
    fxRows: otherCcys.map(c => {
      const r = fx.rate(c, refCcy);
      return { ccy: c, name: F.currencyName(c).replace(/ \([A-Z]{3}\)$/, ''), rateText: r ? `${num(r.rate, 4)} ${refCcy}` : '—', source: r?.source === 'custodian' ? 'custodian' : 'market' };
    }),
    fxCaption: S.fxCaption(dateLong(valuationDate)),
    cost: costRows.length ? {
      rows: costRows.map(r => ({ label: `${r.label}, ${r.ccy}`, amount: `${num(r.amount)} ${r.ccy}` })),
      totalText: `${num(costTotalRef)} ${refCcy}`
    } : null
  };
  // Cash accounts, then financing, fill the left column page by page (a table
  // costs ROWS.accountTable rows of headings and total); the right column and
  // the KPIs stay on the first page
  const liquidityPages = [{ ...liquidityPage, cash: null, financing: null }];
  let used = 0;
  const place = (key, table) => {
    let rows = table.rows;
    let part = 0;
    do {
      let room = ROWS.accountRows - used - ROWS.accountTable;
      if (room < Math.min(rows.length, 3)) {
        liquidityPages.push({ type: 'liquidity', section: liquidityPage.section, title: `${S.liquidityTitle}${S.continued}`, refCcy, kpis: [], cash: null, financing: null, liquidInstruments: null, fxRows: [], cost: null });
        used = 0;
        room = ROWS.accountRows - ROWS.accountTable;
      }
      const take = rows.slice(0, room);
      rows = rows.slice(take.length);
      liquidityPages[liquidityPages.length - 1][key] = { ...table, caption: part === 0 ? table.caption : '', rows: take, last: rows.length === 0 };
      used += ROWS.accountTable + take.length;
      part += 1;
    } while (rows.length);
  };
  place('cash', liquidityPage.cash);
  if (liquidityPage.financing) place('financing', liquidityPage.financing);
  pages.push(...liquidityPages);

  // 04 Performance
  const navChart = buildLineChart(periodNavSeries, { width: 600, height: 230, tickLabel: compact, monthLabel: F.monthAbbr });
  const pnlRows = [...positions].sort((a, b) => b.pnlRef - a.pnlRef).slice(0, monthly.length ? ROWS.pnlWithChart : ROWS.pnlAlone);
  const maxPnl = Math.max(...pnlRows.map(p => Math.abs(p.pnlRef)), 1);
  const customPeriod = twr?.periods?.CUSTOM;
  pages.push({
    type: 'performance', section: sectionName('04'), title: S.performanceTitle, refCcy,
    kpis: [
      { label: S.kpiNav(refCcy), value: num(nav) },
      ...(customPeriod?.hasData ? [{ label: S.kpiTwr, value: signedPct(customPeriod.twr), tone: customPeriod.twr >= 0 ? 'pos' : 'neg' }] : [])
    ],
    navChart, navCaption: periodNavSeries.length ? S.navCaption(refCcy, dateShort(periodNavSeries[0].date)) : null,
    periodRows,
    monthlyChart, monthlyCaption: monthly.length ? `TWR${monthly.some(m => m.isPartial) ? S.partialMonth : ''}` : null,
    yearly,
    pnlRows: pnlRows.map(p => ({ name: p.name, pnl: signed(p.pnlRef), pnlPct: p.costRef ? signedPct(p.pnlRef / p.costRef) : '—', positive: p.pnlRef >= 0, barPct: (Math.abs(p.pnlRef) / maxPnl) * 100 })),
    footnote: S.performanceFootnote({
      ccy: refCcy,
      financingLeftOut: hasFinancing && !account,
      flows: twr?.metadata?.externalFlowCount || 0,
      measuredFrom: periodRows.some(r => r.shortened) && twr?.periods?.ALL?.measuredFrom ? dateLong(twr.periods.ALL.measuredFrom) : null
    })
  });

  // 05 Activity of the period, securities transactions continue on extra pages
  const tradeChunks = trades.length ? chunk(trades, ROWS.tradesFirst, ROWS.tradesNext) : [[]];
  const cardChart = cardTotal > 0 ? buildBarChart(cardMonths, { width: 440, height: 180, tickFormat: (v) => compact(v) }) : null;
  tradeChunks.forEach((rowsOnPage, i) => {
    pages.push({
      type: 'activity', section: sectionName('05'), title: i === 0 ? S.activityTitle : `${S.activityTitle}${S.continued}`,
      first: i === 0,
      periodCaption: S.activityPeriod(periodText, operations.length),
      counts: activityCounts,
      trades: { caption: S.bookings(trades.length), rows: rowsOnPage }
    });
  });
  // Income and card spending on their own page, so the trades keep the full width
  if (incomeByCcy.length || cardChart) {
    pages.push({
      type: 'income', section: sectionName('05'),
      title: S.incomeTitle[incomeByCcy.length && cardChart ? 'both' : (cardChart ? 'card' : 'income')],
      income: incomeByCcy.length ? {
        rows: incomeByCcy.map(r => ({ ccy: r.ccy, count: String(r.count), net: num(r.net), tax: num(r.tax || 0) })),
        totalText: num(incomeTotalRef), totalCount: String(incomeCount), refCcy
      } : null,
      card: cardChart ? { chart: cardChart, caption: S.cardCaption(cardOps.length, refCcy, num(cardTotal)) } : null
    });
  }

  // 05 Account movements of the period's last complete month — the end month
  // when the period ends on its last days (cards and trades are on the activity page)
  const lastDayOfMonth = new Date(Date.UTC(periodEndDate.getUTCFullYear(), periodEndDate.getUTCMonth() + 1, 0)).getUTCDate();
  const movementsMonthOffset = periodEndDate.getUTCDate() >= lastDayOfMonth - 3 ? 0 : -1;
  const monthStart = new Date(Date.UTC(periodEndDate.getUTCFullYear(), periodEndDate.getUTCMonth() + movementsMonthOffset, 1));
  const monthEnd = new Date(Date.UTC(periodEndDate.getUTCFullYear(), periodEndDate.getUTCMonth() + movementsMonthOffset + 1, 1));
  const movements = operations
    .filter(o => new Date(o.operationDate) >= monthStart && new Date(o.operationDate) < monthEnd && o.operationType !== 'CARD_PAYMENT' && !TRADE_TYPES.has(o.operationType))
    .map(o => {
      const net = opAmount(o);
      const fees = opFees(o);
      return {
        date: dayMonth(o.operationDate), type: typeLabel(o.operationType),
        description: opText(o),
        account: `${o.portfolioCode}${isIsin(o.isin) ? ` · ${o.isin}` : o.isin ? ` · ${S.ref} ${o.isin}` : ''}`,
        amount: signed(fees && opGross(o) !== net ? opGross(o) : net),
        fees: fees ? num(-fees) : '—', ccy: opCurrency(o) || '', net: signed(net), positive: net >= 0
      };
    });
  // No page for a month without entries (the activity page already covers the period)
  const movementChunks = movements.length ? chunk(movements, ROWS.movements, ROWS.movements) : [];
  const cardsThisMonth = cardOps.filter(o => new Date(o.operationDate) >= monthStart && new Date(o.operationDate) < monthEnd).length;
  movementChunks.forEach((rowsOnPage, i) => {
    pages.push({
      type: 'movements', section: sectionName('05'),
      title: `${S.movementsTitle(F.monthYear(monthStart))}${i > 0 ? S.continued : ''}`,
      rows: rowsOnPage,
      footnote: i === movementChunks.length - 1 ? S.movementsFootnote(movements.length, cardsThisMonth) : null
    });
  });

  // 06 Notes
  const rmId = account?.relationshipManagerId || accounts.find(a => a.relationshipManagerId)?.relationshipManagerId
    || primaryEntity?.assignedUserIds?.[0] || primaryEntity?.relationshipManagerId || null;
  const rm = rmId ? await UsersCollection.findOneAsync(rmId, { fields: { profile: 1, username: 1, email: 1 } }) : null;
  pages.push({
    type: 'notes', section: sectionName('06'), title: S.notesTitle,
    generatedText: S.generated(F.timestamp(now)),
    definitions: S.ui.definitions(refCcy),
    notice: S.ui.notice(custodians.length ? custodianText : null),
    valuationBasis: S.ui.valuationBasisText(dateLong(valuationDate), refCcy),
    rm: rm ? {
      name: userName(rm),
      email: rm.email || (rm.username?.includes('@') ? rm.username : null),
      phone: rm.profile?.phoneNumber || null
    } : null
  });

  // Nothing held and nothing booked: the cover says so and only the notes follow
  const isEmpty = holdings.length === 0 && operations.length === 0;
  if (isEmpty) pages.splice(0, pages.length, ...pages.filter(p => p.type === 'notes'));

  // Sections left out by the user; the remaining ones are renumbered 01, 02…
  // Required sections (notes and disclosures) are always kept.
  const wanted = Array.isArray(sections) && sections.length ? new Set(sections) : null;
  const kept = STATEMENT_SECTIONS.filter(s => !wanted || s.required || wanted.has(s.key));
  const sectionNumber = new Map(kept.map((s, i) => [s.n, String(i + 1).padStart(2, '0')]));
  pages.splice(0, pages.length, ...pages.filter(p => sectionNumber.has(p.section.slice(0, 2))));
  pages.forEach((p) => {
    p.section = `${sectionNumber.get(p.section.slice(0, 2))}${p.section.slice(2)}`;
    if (p.type === 'overview') {
      p.performanceRef = sectionNumber.has('04') ? S.detailIn(sectionNumber.get('04')) : null;
    }
  });

  // Number the pages and build the contents (cover + pages)
  const total = pages.length + 1;
  pages.forEach((p, i) => { p.pageNumber = i + 2; p.pageCount = total; });
  const firstPageOf = (section) => pages.find(p => p.section.startsWith(section))?.pageNumber;
  const contents = kept
    .map(s => ({ n: sectionNumber.get(s.n), label: S.sections[s.key], page: firstPageOf(sectionNumber.get(s.n)) }))
    .filter(c => c.page);

  // Fixed labels of the page, resolved to strings (functions do not travel over DDP)
  const ui = Object.fromEntries(Object.entries(S.ui)
    .filter(([, v]) => typeof v === 'string'));
  Object.assign(ui, {
    navWithCcy: S.ui.navWithCcy(refCcy),
    valueRef: S.ui.valueRef(refCcy),
    valueComma: S.ui.valueComma(refCcy),
    againstCost: S.ui.againstCost(refCcy),
    kicker: S.kicker, confidential: S.confidential, accounts: S.accounts, contents: S.contents,
    reportDate: S.reportDate, referenceCurrency: S.referenceCurrency, custodian: S.custodian, period: S.period,
    coverNav: S.netAssetValue, address: S.address, regulated: S.regulated
  });

  return {
    meta: { pageCount: total, empty: isEmpty, missingRates: [...fx.missing], lang: S.lang, anonymous: !!anonymous },
    header,
    labels: { footer: { left: S.footerLeft, middle: S.regulated } },
    ui,
    cover: {
      clientName,
      longName: clientName.length > 22,
      emptyText: isEmpty ? S.emptyText : null,
      valuationText: S.valuationAsOf(dateLong(valuationDate)),
      accounts: accountCodes,
      contents,
      reportDate: dateLong(now),
      periodText,
      currencyText: F.currencyName(refCcy),
      custodianText,
      navText: `${refCcy} ${num(nav)}`
    },
    pages
  };
}
