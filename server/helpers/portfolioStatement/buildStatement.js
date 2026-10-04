/**
 * Portfolio statement view-model.
 *
 * Builds everything the statement PDF shows — figures, formatted strings,
 * pagination and chart geometry — from the PMS data of a perimeter (a client,
 * or one of its accounts). The PDF page (PortfolioStatementPDF.jsx) only renders
 * the pages returned here.
 *
 * Money vocabulary used throughout:
 *   gross assets  = securities at market value + positive cash balances
 *   financing     = negative cash balances (credit lines, card, overdrafts)
 *   NAV           = gross assets + financing
 * All amounts are converted to the statement's reference currency with the
 * custodian's own rates first (holding.bankFxRates), EOD rates otherwise.
 */
import { Meteor } from 'meteor/meteor';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { BankAccountsCollection, accountHolderSelector, getAccountHolderIds, isInvestmentAccount, getClientReferenceCurrency } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';
import { UsersCollection } from '/imports/api/users';
import { SecuritiesMetadataCollection, ASSET_CLASSES, SECTORS } from '/imports/api/securitiesMetadata';
import { CurrencyRateCacheCollection } from '/imports/api/currencyCache';
import { PortfolioSnapshotsCollection, filterSnapshotsByBankStartDate, dedupeSnapshotsPerAccountDay } from '/imports/api/portfolioSnapshots';
import { classifyHolding } from '/imports/api/assetClassification';
import { buildRatesMap, isPureCashHolding } from '/imports/api/helpers/cashCalculator';
import { buildConsolidatedDailyValues } from '/imports/api/helpers/twrCalculator';
import { getFilteredClientIds } from '../../methods/rmDashboardMethods.js';
import {
  num, signed, pct, signedPct, qty, compact, dateLong, dateShort, dayMonth, monthYear,
  timestamp, currencyName, countryName
} from './format.js';
import { buildLineChart, buildBarChart } from './charts.js';

// Rows that fit on a page, by table (row heights follow the design)
// Rows that fit the 577px content area of a page (measured on rendered PDFs)
// positionsGroup: the rows a further asset class block costs on a shared page
// (its heading, column header and total line)
const ROWS = { positions: 13, positionsGroup: 4, tradesFirst: 14, tradesNext: 14, movements: 19, pnlWithChart: 7, pnlAlone: 14 };

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const isIsin = (v) => typeof v === 'string' && ISIN_PATTERN.test(v.trim().toUpperCase());

const ASSET_CLASS_LABEL = Object.fromEntries(ASSET_CLASSES.filter(a => a.value).map(a => [a.value, a.label]));
const assetClassLabel = (key) => ({ fund: 'Funds', equity: 'Equities', fixed_income: 'Fixed income', structured_product: 'Structured products' }[key]
  || ASSET_CLASS_LABEL[key] || (key ? key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Other'));
// Display order of asset classes in the statement
const CLASS_ORDER = ['equity', 'fixed_income', 'structured_product', 'fund', 'monetary_products', 'time_deposit', 'private_equity', 'private_debt', 'commodities', 'derivatives', 'other'];
const CLASS_COLORS = ['#1A2B40', '#3E5A7A', '#7D93AD', '#A9561A', '#DD772A', '#B9B2A6', '#5E6B7D', '#C9A27E', '#9AA7B6', '#4B5563', '#D9D3C8'];
const SECTOR_LABEL = Object.fromEntries(SECTORS.filter(s => s.value).map(s => [s.value, s.label]));
// Prices quoted in % of nominal
const PERCENT_PRICED = new Set(['fixed_income', 'structured_product']);

const TYPE_LABEL = {
  BUY: 'Buy', SELL: 'Sell', SUBSCRIPTION: 'Subscription', REDEMPTION: 'Redemption', DIVIDEND: 'Dividend', COUPON: 'Coupon',
  INTEREST: 'Interest', FEE: 'Fee', TAX: 'Tax', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out',
  PAYMENT_IN: 'Payment in', PAYMENT_OUT: 'Payment out', FX_TRADE: 'FX', CARD_PAYMENT: 'Card', CORPORATE_ACTION: 'Corporate action', OTHER: 'Other'
};
const ACTIVITY_GROUPS = [
  { label: 'Card payments', types: ['CARD_PAYMENT'] },
  { label: 'Payments and transfers', types: ['PAYMENT_IN', 'PAYMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT'] },
  { label: 'Dividends and coupons', types: ['DIVIDEND', 'COUPON'] },
  { label: 'Interest, fees and taxes', types: ['INTEREST', 'FEE', 'TAX'] },
  { label: 'Securities trades', types: ['BUY', 'SELL', 'SUBSCRIPTION', 'REDEMPTION'] },
  { label: 'FX', types: ['FX_TRADE'] }
];
const TRADE_TYPES = new Set(['BUY', 'SELL', 'SUBSCRIPTION', 'REDEMPTION']);
const INCOME_TYPES = new Set(['DIVIDEND', 'COUPON']);

// Bank operation fields differ by parser; the harmonised `std` block wins when present
const opAmount = (op) => (op.std ? op.std.amount : (op.netAmount != null ? op.netAmount : op.grossAmount)) || 0;
const opGross = (op) => (op.grossAmount != null ? op.grossAmount : opAmount(op));
// Same fallback as the PMS operations tab (Julius Baer books carry no currency field)
const opCurrency = (op) => op.std?.currency || op.currency || op.accountCurrency || op.operationCurrency || op.instrumentCurrency || op.portfolioCurrency || null;
const opFees = (op) => Math.abs((op.std ? op.std.fees : (op.totalFees != null ? op.totalFees : op.fees)) || 0);
const opTaxes = (op) => Math.abs((op.std ? op.std.taxes : (op.withholdingTax ?? op.tax ?? 0)) || 0);
const opPrice = (op) => (op.std ? op.std.price : (op.price != null ? op.price : op.securityPrice)) ?? null;
const opQuantity = (op) => (op.std ? op.std.quantity : op.quantity) ?? null;
const opText = (op) => op.std?.description || op.description || op.operationTypeName || op.remark || TYPE_LABEL[op.operationType] || 'Movement';

const dateKey = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
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
 * @param {Object} params
 * @param {Object} params.currentUser
 * @param {Object|null} params.viewAsFilter
 * @param {String|null} params.accountId - account tab the statement was opened on
 * @param {String|null} params.currency  - reference currency asked by the PMS
 * @param {Date} [params.now]
 */
export async function buildStatement({ currentUser, viewAsFilter = null, accountId = null, currency = null, now = new Date() }) {
  // ── Perimeter ──────────────────────────────────────────────────────────────
  const ownerIds = await getFilteredClientIds(currentUser, viewAsFilter || null);
  // One account: the viewAs account, or the account tab the report was opened on.
  // Either must belong to the perimeter (operations below are matched by account).
  const requestedAccountId = viewAsFilter?.type === 'account' ? viewAsFilter.id : accountId;
  let account = null;
  if (requestedAccountId) {
    const candidate = await BankAccountsCollection.findOneAsync(requestedAccountId);
    const holders = candidate ? [...getAccountHolderIds(candidate), candidate.userId].filter(Boolean) : [];
    if (candidate && holders.some(id => ownerIds.includes(id))) account = candidate;
    else if (viewAsFilter?.type === 'account') throw new Meteor.Error('not-authorized', 'Account outside your perimeter');
  }

  const accounts = account
    ? [account]
    : await BankAccountsCollection.find({ ...accountHolderSelector(ownerIds), isActive: true }).fetchAsync();
  const ownerSel = { $or: [{ userId: { $in: ownerIds } }, { entityId: { $in: ownerIds } }] };
  const holdings = await PMSHoldingsCollection.find({
    isActive: true, isLatest: true, ...ownerSel,
    ...(account ? { portfolioCode: account.accountNumber, bankId: account.bankId } : { portfolioCode: { $ne: 'CONSOLIDATED' } })
  }).fetchAsync();

  const codes = [...new Set([...accounts.map(a => a.accountNumber), ...holdings.map(h => h.portfolioCode)].filter(Boolean))];
  const accountByCode = new Map(accounts.map(a => [`${a.bankId}|${a.accountNumber}`, a]));
  const accountOf = (h) => accountByCode.get(`${h.bankId}|${h.portfolioCode}`) || null;

  const bankIds = [...new Set([...accounts.map(a => a.bankId), ...holdings.map(h => h.bankId)].filter(Boolean))];
  const banks = await BanksCollection.find({ _id: { $in: bankIds } }, { fields: { name: 1 } }).fetchAsync();
  const custodians = banks.map(b => b.name).filter(Boolean);
  const custodianText = custodians.length ? custodians.join(', ') : '—';

  const entities = await ClientEntitiesCollection.find({ _id: { $in: ownerIds } }).fetchAsync();
  const primaryEntity = account?.entityId ? entities.find(e => e._id === account.entityId) || entities[0] : entities[0];
  const clientName = entities.length === 1 || account
    ? (primaryEntity ? ClientEntityHelpers.getEntityDisplayName(primaryEntity) : (account?.name || viewAsFilter?.label || 'Portfolio'))
    : (viewAsFilter?.label || 'Consolidated portfolio');

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
    : now;
  const yearStart = new Date(Date.UTC(valuationDate.getUTCFullYear(), 0, 1));

  // ── Positions ──────────────────────────────────────────────────────────────
  const positions = [];
  const cashRows = [];
  for (const h of holdings) {
    const valueRef = fx.convert(h.marketValue || 0, h.portfolioCurrency || refCcy);
    if (isPureCashHolding(h)) {
      cashRows.push({ h, valueRef, account: accountOf(h) });
      continue;
    }
    const meta = metaByIsin[h.isin] || null;
    const cls = classifyHolding(h, meta);
    const costRef = fx.convert(h.costBasisPortfolioCurrency || 0, h.portfolioCurrency || refCcy);
    const pnlRef = Number.isFinite(h.unrealizedPnL) ? fx.convert(h.unrealizedPnL, h.portfolioCurrency || refCcy) : valueRef - costRef;
    positions.push({
      h, meta, assetClass: cls.assetClass === 'cash' ? 'other' : cls.assetClass,
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

  // Asset classes held, in display order
  const classes = [...new Set(positions.map(p => p.assetClass))]
    .sort((a, b) => (CLASS_ORDER.indexOf(a) === -1 ? 99 : CLASS_ORDER.indexOf(a)) - (CLASS_ORDER.indexOf(b) === -1 ? 99 : CLASS_ORDER.indexOf(b)));
  const classTotals = classes.map((key, i) => {
    const value = sum(positions.filter(p => p.assetClass === key), p => p.valueRef);
    return { key, label: assetClassLabel(key), value, color: CLASS_COLORS[i % CLASS_COLORS.length] };
  });
  const cashColor = '#DD772A';

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
  const groupShare = (keyOf, labelOf) => {
    const g = {};
    equities.forEach(p => { const k = keyOf(p); g[k] = (g[k] || 0) + p.valueRef; });
    const rows = Object.entries(g).sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 1;
    return rows.map(([k, v]) => ({ label: labelOf(k), valueText: num(v), shareText: pct(equityTotal ? v / equityTotal : 0), barPct: max ? (v / max) * 100 : 0 }));
  };
  const sectorRows = groupShare(p => p.meta?.sector || '', k => SECTOR_LABEL[k] || 'Unclassified');
  const regionRows = groupShare(
    p => (p.meta?.listingCountry && p.meta.listingCountry.length === 2 ? p.meta.listingCountry.toUpperCase() : (p.isin ? p.isin.slice(0, 2) : '')),
    k => countryName(k)
  );

  // ── Operations (year to date) ──────────────────────────────────────────────
  // Operations are matched by bank account (bank + account number), as banks
  // book them under sub-account codes ("5040241-1") and older ones carry a
  // legacy owner id only. The accounts themselves are already in scope.
  const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const accountKeys = [...new Map([...accounts.map(a => [a.bankId, a.accountNumber]), ...holdings.map(h => [h.bankId, h.portfolioCode])]
    .filter(([bankId, code]) => bankId && code)
    .map(([bankId, code]) => [`${bankId}|${code}`, { bankId, code }])).values()];
  const operationAccounts = accountKeys.map(({ bankId, code }) => ({ bankId, portfolioCode: { $regex: `^${escapeRe(String(code).split('-')[0])}(-|$)` } }));
  const operations = operationAccounts.length ? await PMSOperationsCollection.find({
    isActive: true, $or: operationAccounts, operationDate: { $gte: yearStart, $lte: new Date(valuationDate.getTime() + 86400000) }
  }, { sort: { operationDate: -1 } }).fetchAsync() : [];

  const income = operations.filter(o => INCOME_TYPES.has(o.operationType));
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

  const trades = operations.filter(o => TRADE_TYPES.has(o.operationType)).map(o => {
    const amount = opAmount(o);
    return {
      date: dateShort(o.operationDate),
      side: TYPE_LABEL[o.operationType],
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

  const cardOps = operations.filter(o => o.operationType === 'CARD_PAYMENT');
  const cardMonths = Array.from({ length: valuationDate.getUTCMonth() + 1 }, (_, m) => {
    const spent = sum(cardOps.filter(o => new Date(o.operationDate).getUTCMonth() === m), o => fx.convert(Math.abs(opAmount(o)), opCurrency(o) || refCcy));
    return { label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m], value: spent, valueText: spent ? compact(spent) : '', positive: true };
  });
  const cardTotal = sum(cardMonths, m => m.value);

  const activityCounts = ACTIVITY_GROUPS.map(g => ({ label: g.label, count: operations.filter(o => g.types.includes(o.operationType)).length }))
    .concat([{ label: 'Other', count: operations.filter(o => !ACTIVITY_GROUPS.some(g => g.types.includes(o.operationType))).length }])
    .filter(g => g.count > 0);

  // Interest and fees on borrowing, year to date
  const financingCodes = new Set(accounts.filter(a => !isInvestmentAccount(a)).map(a => String(a.accountNumber).split('-')[0]));
  const costOps = operations.filter(o => (o.operationType === 'INTEREST' && opAmount(o) < 0)
    || (o.operationType === 'FEE' && financingCodes.has(String(o.portfolioCode || '').split('-')[0])));
  const costRows = Object.values(costOps.reduce((m, o) => {
    const c = opCurrency(o) || refCcy;
    const key = `${o.operationType}|${c}`;
    if (!m[key]) m[key] = { label: o.operationType === 'INTEREST' ? `Debit interest` : 'Fees on financing accounts', ccy: c, amount: 0 };
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

  let twr = null;
  try {
    const { computeTWR } = await import('../../methods/performanceMethods.js');
    if (codes.length) {
      twr = await computeTWR({ codes, portfolioCode: account ? account.accountNumber : null, currency: refCcy, now: valuationDate, label: 'statement' });
    }
  } catch (e) {
    console.error('[STATEMENT] TWR failed:', e.message);
  }
  const PERIODS = [['1M', '1 month'], ['3M', '3 months'], ['6M', '6 months'], ['YTD', 'Year to date'], ['1Y', '1 year'], ['ALL', 'Since inception']];
  const navEnd = navSeries[navSeries.length - 1] || null;
  const periodRows = PERIODS.map(([key, label]) => {
    const p = twr?.periods?.[key];
    if (!p || !p.hasData) return null;
    // Value at the period start, or the first valuation when the history is shorter
    const start = navAt(p.startDate) || navSeries[0];
    const change = start && navEnd ? navEnd.value - start.value : null;
    return {
      key, label, fromText: `from ${dateShort(start ? start.date : p.startDate)}`, change, startDate: start ? start.date : null,
      startText: start ? num(start.value) : '—',
      changeText: change != null ? signed(change) : '—', changePositive: (change || 0) >= 0,
      twrText: p.twrFormatted || signedPct(p.twr), twrPositive: (p.twr || 0) >= 0
    };
  }).filter(Boolean);
  const monthly = (twr?.monthlyReturns || []).slice(-12);
  const monthlyChart = buildBarChart(monthly.map(m => ({
    label: m.label.slice(0, 3) + (m.isPartial ? '*' : ''), value: m.twr * 100, valueText: m.twrFormatted, positive: m.isPositive
  })), { width: 360, height: 150, tickFormat: (v) => `${v}%` });
  const yearly = (twr?.yearlyReturns || []).map(y => ({ label: y.label, twrText: y.twrFormatted, isPositive: y.isPositive, partial: y.isPartial }));

  const ytdRow = periodRows.find(r => r.key === 'YTD') || null;

  // ── Page model ─────────────────────────────────────────────────────────────
  const ccyWord = refCcy;
  const header = {
    clientName,
    valuationText: `Valuation ${dateLong(valuationDate)}`,
    currencyText: `Reference currency ${ccyWord}`
  };
  const accountCodes = [...new Set(holdings.map(h => h.portfolioCode).concat(accounts.map(a => a.accountNumber)).filter(Boolean))].sort();
  const pages = [];

  // 01 Overview
  const top5 = positions.slice(0, 5);
  pages.push({
    type: 'overview', section: '01 · Overview', title: 'Portfolio at a glance',
    caption: `${accountCodes.length > 1 ? 'Consolidated view of accounts' : 'Account'} ${accountCodes.join(', ')}${custodians.length ? `, held at ${custodianText}` : ''}`,
    navInt: num(Math.trunc(nav), 0), navDec: `.${Math.abs(nav).toFixed(2).split('.')[1]}`, navSign: nav < 0 ? '−' : '',
    ytdChangeText: ytdRow && ytdRow.change != null ? signed(ytdRow.change) : null,
    ytdChangePositive: ytdRow ? (ytdRow.change || 0) >= 0 : true,
    ytdChangeLabel: ytdRow && ytdRow.change != null ? `change since ${dateLong(ytdRow.startDate)}` : null,
    grossText: num(gross), financingText: num(financing), hasFinancing,
    positionsText: `${positions.length} position${positions.length === 1 ? '' : 's'}, ${exposure.length} currenc${exposure.length === 1 ? 'y' : 'ies'}`,
    waterfall: hasFinancing ? {
      grossText: num(gross), financingText: num(financing), navText: num(nav),
      securitiesPct: gross ? (securitiesValue / gross) * 100 : 0, cashPct: gross ? (cashValue / gross) * 100 : 0,
      navPct: gross ? Math.max(0, (nav / gross) * 100) : 0,
      legend: [
        { color: '#1A2B40', text: `Securities ${num(securitiesValue)}` },
        { color: '#DD772A', text: `Cash ${num(cashValue)}` },
        { color: '#C76A5A', text: 'Credit facilities and card' }
      ]
    } : null,
    kpis: [
      { label: 'Unrealised P&L · securities', value: signed(securitiesPnl), tone: securitiesPnl >= 0 ? 'pos' : 'neg', caption: `${signedPct(securitiesCost ? securitiesPnl / securitiesCost : 0)} over a cost of ${num(securitiesCost)}` },
      hasFinancing
        ? { label: 'Leverage', value: `${(nav > 0 ? gross / nav : 0).toFixed(2)}×`, caption: 'Gross assets over net asset value' }
        : { label: 'Cash', value: num(cashValue), caption: `${pct(weight(cashValue))} of the portfolio` },
      hasFinancing
        ? { label: 'Loan to value', value: pct(gross ? -financing / gross : 0, 1), caption: 'Financing drawn over gross assets' }
        : { label: 'Securities', value: num(securitiesValue), caption: `${positions.length} positions` },
      { label: `Income received ${valuationDate.getUTCFullYear()}`, value: num(incomeTotalRef), caption: `${incomeCount} payment${incomeCount === 1 ? '' : 's'}, net of withholding tax` }
    ],
    largest: {
      caption: `top ${top5.length} ${pct(weight(sum(top5, p => p.valueRef)))} of gross`,
      rows: top5.map(p => ({ name: p.name, shareText: pct(weight(p.valueRef)), barPct: top5[0] && top5[0].valueRef > 0 ? Math.max(0, Math.min(100, (p.valueRef / top5[0].valueRef) * 98.6)) : 0 }))
    },
    exposure: {
      rows: exposure.map(e => {
        const share = nav ? e.net / nav : 0;
        return { ccy: e.ccy, text: signedPct(share, 1).replace(/(\.\d)0?%$/, '$1%'), negative: share < 0,
          // Axis at 28% of the track: shorts extend left (28% max), longs right
          barLeftPct: share < 0 ? 28 - Math.min(28, (Math.abs(share) / maxExposure) * 70) : 28,
          barWidthPct: share < 0 ? Math.min(28, (Math.abs(share) / maxExposure) * 70) : (Math.abs(share) / maxExposure) * 70 };
      }),
      caption: shortCcys.length ? `After financing the portfolio is net short ${shortCcys.join(', ')}.` : 'Currency exposure of the assets, net of financing.'
    },
    periods: periodRows.filter(r => ['1 month', '3 months', '6 months', 'Year to date'].includes(r.label))
  });

  // 02 Allocation
  const circumference = 2 * Math.PI * 68;
  let offset = 0;
  const donut = classTotals.concat(cashValue > 0 ? [{ key: 'cash', label: 'Cash', value: cashValue, color: cashColor }] : []).map(c => {
    const len = gross ? (c.value / gross) * circumference : 0;
    const seg = { color: c.color, dash: `${len.toFixed(2)} ${circumference.toFixed(2)}`, offset: (-offset).toFixed(2) };
    offset += len;
    return seg;
  });
  pages.push({
    type: 'allocation', section: '02 · Allocation', title: 'Allocation and exposure',
    caption: `Weights in % of gross assets unless stated · Gross assets ${refCcy} ${num(gross)}`,
    compact: classTotals.length + (cashValue > 0 ? 1 : 0) > 6,
    donutSize: classTotals.length + (cashValue > 0 ? 1 : 0) > 6 ? 156 : 188,
    donut: { segments: donut, financingArc: hasFinancing ? `${((Math.min(1, -financing / gross)) * 2 * Math.PI * 86).toFixed(2)} ${(2 * Math.PI * 86).toFixed(2)}` : null, centerText: compact(gross) },
    allocationRows: classTotals.map(c => ({ label: c.label, color: c.color, valueText: num(c.value), weightText: pct(weight(c.value)) }))
      .concat(cashValue > 0 ? [{ label: 'Cash', color: cashColor, valueText: num(cashValue), weightText: pct(weight(cashValue)) }] : []),
    grossText: num(gross), hasFinancing, financingText: num(financing), financingWeight: pct(weight(financing)),
    navText: num(nav), navWeight: pct(weight(nav)),
    exposureRows: exposure.map(e => {
      const share = nav ? e.net / nav : 0;
      return {
        ccy: e.ccy, assetsText: num(e.assets), financingText: num(e.financing), financingZero: !e.financing,
        netText: num(e.net), negative: e.net < 0, shareText: `${num(share * 100, 1)}%`,
        // Bar on an axis at 18px: shorts extend left (17px max), longs right (48px max)
        barLeft: e.net < 0 ? 18 - Math.min(17, (Math.abs(share) / maxExposure) * 48) : 19,
        barWidth: e.net < 0 ? Math.min(17, (Math.abs(share) / maxExposure) * 48) : Math.min(48, (Math.abs(share) / maxExposure) * 48)
      };
    }),
    exposureTotal: { assets: num(sum(exposure, e => e.assets)), financing: num(financing), net: num(nav) },
    exposureCaption: shortCcys.length
      ? `Financing drawn in ${shortCcys.join(', ')} exceeds the assets held in ${shortCcys.length > 1 ? 'those currencies' : 'that currency'}: the portfolio is net short ${shortCcys.join(', ')}.`
      : null,
    sectors: sectorRows, regions: regionRows, hasEquities: equities.length > 0,
    equityTotalText: num(equityTotal)
  });

  // 03 Positions: one block per asset class. Classes that fit share a page; a
  // class longer than a page starts on a fresh one and continues over the next.
  const positionPages = [];
  let current = null;
  const newPositionPage = () => { current = { groups: [], used: 0 }; positionPages.push(current); return current; };
  for (const key of classes) {
    const rows = positions.filter(p => p.assetClass === key);
    const isPercent = PERCENT_PRICED.has(key);
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
      const fmtPrice = (v) => (Number.isFinite(v) && v ? (asPercent ? `${num(v * 100, 2)}%` : num(v, 2)) : '—');
      return {
        name: p.name, isin: p.isin || '', ccy: p.ccy || '',
        qty: qty(h.quantity),
        cost: fmtPrice(cost),
        price: fmtPrice(price),
        valueCcy: num(p.valueCcy), valueRef: num(p.valueRef),
        pnl: signed(p.pnlRef), pnlPct: p.costRef ? signedPct(p.pnlRef / p.costRef) : '—', pnlPositive: p.pnlRef >= 0,
        weight: pct(weight(p.valueRef))
      };
    });
    const label = assetClassLabel(key);
    const pnlText = `${signed(totalPnl)} (${signedPct(totalCost ? totalPnl / totalCost : 0)})`;
    const block = {
      key, label, isPercent,
      kpis: [
        { label: `Market value, ${refCcy}`, value: num(total) },
        { label: `Unrealised P&L, ${refCcy}`, value: pnlText, tone: totalPnl >= 0 ? 'pos' : 'neg' },
        { label: 'Positions', value: String(rows.length) }
      ],
      summaryText: `${num(total)} ${refCcy} · P&L ${pnlText} · ${rows.length} position${rows.length === 1 ? '' : 's'}`,
      total: { label: `Total ${label.toLowerCase()}`, valueRef: num(total), pnl: signed(totalPnl), pnlPct: totalCost ? signedPct(totalPnl / totalCost) : '—', pnlPositive: totalPnl >= 0, weight: pct(weight(total)) }
    };
    let remaining = display;
    let part = 0;
    while (remaining.length) {
      const shared = current && current.groups.length > 0;
      // A further block on a shared page also gives the first block its heading
      const overhead = shared ? ROWS.positionsGroup + (current.groups.length === 1 ? 1 : 0) : 0;
      const room = current ? ROWS.positions - current.used - overhead : 0;
      let take;
      if (current && !shared) take = Math.min(remaining.length, ROWS.positions);
      else if (part === 0 && remaining.length <= room) take = remaining.length;
      else { newPositionPage(); continue; }
      current.groups.push({ ...block, part, rows: remaining.slice(0, take), complete: take === remaining.length });
      current.used += take + overhead;
      remaining = remaining.slice(take);
      part += 1;
    }
  }
  positionPages.forEach((pg) => {
    const groups = pg.groups.map(g => ({
      key: g.key, isPercent: g.isPercent, rows: g.rows,
      heading: g.part > 0 ? `${g.label} (continued)` : g.label,
      summaryText: g.part === 0 ? g.summaryText : null,
      total: g.complete ? g.total : null
    }));
    const single = pg.groups.length === 1 ? pg.groups[0] : null;
    const labels = pg.groups.map(g => g.label);
    const lastGroup = pg.groups[pg.groups.length - 1];
    pages.push({
      type: 'positions', section: '03 · Positions', refCcy,
      title: single ? groups[0].heading
        : labels.length === 2 ? `${labels[0]} and ${labels[1].toLowerCase()}` : 'Other holdings',
      kpis: single && single.part === 0 ? single.kpis : null,
      showHeadings: !single,
      groups,
      footnote: lastGroup.complete
        ? `Closing prices of ${dateLong(valuationDate)} supplied by the custodian. ${refCcy} values at the custodian's exchange rates (see liquidity page). ${pg.groups.some(g => g.isPercent) ? 'Bonds and structured products priced in % of nominal. ' : ''}Sorted by market value.`
        : null
    });
  });

  // 03 Liquidity and financing
  const otherCcys = [...new Set([...positions.map(p => p.ccy), ...cashRows.map(c => c.h.currency)].filter(c => c && c !== refCcy))].sort();
  const cashLabel = (c) => c.account?.comment || c.h.securityName?.split(/\s+(?:STANDARD|DB|CR)\s+/)[0] || 'Cash account';
  pages.push({
    type: 'liquidity', section: '03 · Positions', title: 'Liquidity and financing', refCcy, hasFinancing,
    kpis: [
      { label: `Cash, ${refCcy}`, value: num(cashValue) },
      ...(hasFinancing ? [
        { label: `Financing, ${refCcy}`, value: num(financing), tone: 'neg' },
        { label: 'Loan to value', value: pct(gross ? -financing / gross : 0, 1) }
      ] : [])
    ],
    cash: {
      caption: `${assetsCash.length} account${assetsCash.length === 1 ? '' : 's'}`,
      rows: assetsCash.sort((a, b) => b.valueRef - a.valueRef).map(c => ({
        label: cashLabel(c), account: c.h.portfolioCode, ccy: c.h.currency || '', balance: num(c.h.marketValueOriginalCurrency ?? c.h.quantity),
        valueRef: num(c.valueRef), weight: pct(weight(c.valueRef))
      })),
      totalText: num(cashValue), totalWeight: pct(weight(cashValue))
    },
    financing: hasFinancing ? {
      caption: accounts.filter(a => !isInvestmentAccount(a) && a.authorizedOverdraft)
        .map(a => `${a.comment || 'Facility'} ${a.accountNumber}, limit ${a.referenceCurrency || ''} ${num(a.authorizedOverdraft, 0)}`).join(' · ') || null,
      rows: financingCash.sort((a, b) => a.valueRef - b.valueRef).map(c => ({
        label: cashLabel(c), account: c.h.portfolioCode, ccy: c.h.currency || '', balance: num(c.h.marketValueOriginalCurrency ?? c.h.quantity),
        valueRef: num(c.valueRef), weight: pct(weight(c.valueRef))
      })),
      totalText: num(financing), totalWeight: pct(weight(financing))
    } : null,
    fxRows: otherCcys.map(c => {
      const r = fx.rate(c, refCcy);
      return { ccy: c, name: currencyName(c).replace(/ \([A-Z]{3}\)$/, ''), rateText: r ? `${r.rate.toFixed(4)} ${refCcy}` : 'n/a', source: r?.source === 'custodian' ? 'custodian' : 'market' };
    }),
    fxCaption: `${dateLong(valuationDate)} · custodian rates where supplied`,
    cost: costRows.length ? {
      rows: costRows.map(r => ({ label: `${r.label}, ${r.ccy}`, amount: `${num(r.amount)} ${r.ccy}` })),
      totalText: `${num(costTotalRef)} ${refCcy}`, year: valuationDate.getUTCFullYear()
    } : null
  });

  // 04 Performance
  const navChart = buildLineChart(navSeries, { width: 600, height: 230 });
  const pnlRows = [...positions].sort((a, b) => b.pnlRef - a.pnlRef).slice(0, monthly.length ? ROWS.pnlWithChart : ROWS.pnlAlone);
  const maxPnl = Math.max(...pnlRows.map(p => Math.abs(p.pnlRef)), 1);
  pages.push({
    type: 'performance', section: '04 · Performance', title: 'Performance', refCcy,
    kpis: [
      { label: `Net asset value, ${refCcy}`, value: num(nav) },
      ...(twr?.periods?.YTD?.hasData ? [{ label: 'Time-weighted return, year to date', value: twr.periods.YTD.twrFormatted, tone: twr.periods.YTD.twr >= 0 ? 'pos' : 'neg' }] : [])
    ],
    navChart, navCaption: navSeries.length ? `${refCcy}, at each valuation date from ${dateShort(navSeries[0].date)}` : null,
    periodRows,
    monthlyChart, monthlyCaption: monthly.length ? `TWR${monthly.some(m => m.isPartial) ? ' · * partial month' : ''}` : null,
    yearly,
    pnlRows: pnlRows.map(p => ({ name: p.name, pnl: signed(p.pnlRef), pnlPct: p.costRef ? signedPct(p.pnlRef / p.costRef) : '—', positive: p.pnlRef >= 0, barPct: (Math.abs(p.pnlRef) / maxPnl) * 100 })),
    footnote: `Returns are time-weighted: deposits and withdrawals are neutralised, so they measure the investment result. ${hasFinancing && !account ? " They cover the investment accounts; credit facilities and cards are left out." : ""} Changes in ${refCcy} are the simple difference in net asset value, financing included, and include flows.${twr?.metadata?.externalFlowCount ? ` ${twr.metadata.externalFlowCount} external flows neutralised.` : ''}`
  });

  // 05 Activity (YTD), securities transactions continue on extra pages
  const tradeChunks = trades.length ? chunk(trades, ROWS.tradesFirst, ROWS.tradesNext) : [[]];
  const cardChart = cardTotal > 0 ? buildBarChart(cardMonths, { width: 320, height: 140, tickFormat: (v) => compact(v) }) : null;
  tradeChunks.forEach((rowsOnPage, i) => {
    pages.push({
      type: 'activity', section: '05 · Activity', title: i === 0 ? `Activity ${valuationDate.getUTCFullYear()}` : `Activity ${valuationDate.getUTCFullYear()} (continued)`,
      first: i === 0,
      periodText: `1 Jan to ${dayMonth(valuationDate)} ${valuationDate.getUTCFullYear()}`,
      totalCount: operations.length, counts: activityCounts,
      trades: { caption: `${trades.length} booking${trades.length === 1 ? '' : 's'}`, rows: rowsOnPage },
      income: i === 0 && incomeByCcy.length ? {
        rows: incomeByCcy.map(r => ({ ccy: r.ccy, count: String(r.count), net: num(r.net), tax: r.tax ? num(r.tax) : '0.00' })),
        totalText: num(incomeTotalRef), totalCount: String(incomeCount), refCcy
      } : null,
      card: i === 0 && cardChart ? { chart: cardChart, caption: `${cardOps.length} card payment${cardOps.length === 1 ? '' : 's'}, ${refCcy} ${num(cardTotal)} in ${valuationDate.getUTCFullYear()}` } : null
    });
  });

  // 05 Account movements of the last complete month — the valuation month when
  // the valuation falls on its last days (cards and trades are on the activity page)
  const lastDayOfMonth = new Date(Date.UTC(valuationDate.getUTCFullYear(), valuationDate.getUTCMonth() + 1, 0)).getUTCDate();
  const movementsMonthOffset = valuationDate.getUTCDate() >= lastDayOfMonth - 3 ? 0 : -1;
  const monthStart = new Date(Date.UTC(valuationDate.getUTCFullYear(), valuationDate.getUTCMonth() + movementsMonthOffset, 1));
  const monthEnd = new Date(Date.UTC(valuationDate.getUTCFullYear(), valuationDate.getUTCMonth() + movementsMonthOffset + 1, 1));
  const movements = operations
    .filter(o => new Date(o.operationDate) >= monthStart && new Date(o.operationDate) < monthEnd && o.operationType !== 'CARD_PAYMENT' && !TRADE_TYPES.has(o.operationType))
    .map(o => {
      const net = opAmount(o);
      const fees = opFees(o);
      return {
        date: dayMonth(o.operationDate), type: TYPE_LABEL[o.operationType] || 'Other',
        description: opText(o),
        account: `${o.portfolioCode}${isIsin(o.isin) ? ` · ${o.isin}` : o.isin ? ` · ref ${o.isin}` : ''}`,
        amount: signed(fees && opGross(o) !== net ? opGross(o) : net),
        fees: fees ? num(-fees) : '—', ccy: opCurrency(o) || '', net: signed(net), positive: net >= 0
      };
    });
  // No page for a month without entries (the activity page already covers the year)
  const movementChunks = movements.length ? chunk(movements, ROWS.movements, ROWS.movements) : [];
  const cardsThisMonth = cardOps.filter(o => new Date(o.operationDate) >= monthStart && new Date(o.operationDate) < monthEnd).length;
  movementChunks.forEach((rowsOnPage, i) => {
    pages.push({
      type: 'movements', section: '05 · Activity',
      title: `Account movements, ${monthYear(monthStart)}${i > 0 ? ' (continued)' : ''}`,
      rows: rowsOnPage,
      footnote: i === movementChunks.length - 1
        ? `${movements.length} entr${movements.length === 1 ? 'y' : 'ies'} shown.${cardsThisMonth ? ` The ${cardsThisMonth} card payment${cardsThisMonth === 1 ? '' : 's'} of the month are summarised on the activity page.` : ''} Full history for the year is available on request.`
        : null
    });
  });

  // 06 Notes
  const rmId = account?.relationshipManagerId || accounts.find(a => a.relationshipManagerId)?.relationshipManagerId
    || primaryEntity?.assignedUserIds?.[0] || primaryEntity?.relationshipManagerId || null;
  const rm = rmId ? await UsersCollection.findOneAsync(rmId, { fields: { profile: 1, username: 1, email: 1 } }) : null;
  pages.push({
    type: 'notes', section: '06 · Notes', title: 'Notes and disclosures',
    generatedText: `Report generated ${timestamp(now)}`,
    sourceText: `Source data: ${custodianText}, positions and movements to ${dateLong(valuationDate)}`,
    custodianText,
    valuationText: dateLong(valuationDate),
    refCcy,
    rm: rm ? {
      name: userName(rm),
      email: rm.email || (rm.username?.includes('@') ? rm.username : null),
      phone: rm.profile?.phoneNumber || null
    } : null
  });

  // Nothing held and nothing booked: the cover says so and only the notes follow
  const isEmpty = holdings.length === 0 && operations.length === 0;
  if (isEmpty) pages.splice(0, pages.length, ...pages.filter(p => p.type === 'notes'));

  // Number the pages and build the contents (cover + pages)
  const total = pages.length + 1;
  pages.forEach((p, i) => { p.pageNumber = i + 2; p.pageCount = total; });
  const firstPageOf = (section) => pages.find(p => p.section.startsWith(section))?.pageNumber;
  const contents = [
    ['01', 'Overview'], ['02', 'Allocation and exposure'], ['03', 'Positions'], ['04', 'Performance'], ['05', 'Activity'], ['06', 'Notes and disclosures']
  ].map(([n, label]) => ({ n, label, page: firstPageOf(n) })).filter(c => c.page);

  return {
    meta: { pageCount: total, empty: isEmpty, missingRates: [...fx.missing] },
    header,
    cover: {
      clientName,
      longName: clientName.length > 22,
      emptyText: isEmpty ? 'No positions or account movements in this perimeter.' : null,
      valuationText: `Valuation as of ${dateLong(valuationDate)}`,
      accounts: accountCodes,
      contents,
      reportDate: dateLong(now),
      currencyText: currencyName(refCcy),
      custodianText,
      navText: `${refCcy} ${num(nav)}`
    },
    pages
  };
}
