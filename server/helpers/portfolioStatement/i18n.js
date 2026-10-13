/**
 * Portfolio statement wording, English and French. buildStatement takes every
 * label and sentence from here, and the PDF page takes its fixed labels from
 * `ui` (sent with the statement), so the page itself holds no text.
 */
import { formatterFor, currencyName as currencyNameEn, countryName as countryNameEn } from '../reportKit/format.js';
import { getGranularCategoryLabel } from '/imports/api/securitiesMetadata';

const MINUS = '−';

/** Number and date helpers of the statement in one language */
export const statementFormat = (lang) => {
  const F = formatterFor(lang);
  const fr = F.lang === 'fr';
  const decimalSep = fr ? ',' : '.';
  let currencyNames = null;
  let regionNames = null;
  try {
    currencyNames = new Intl.DisplayNames([F.lang], { type: 'currency' });
    regionNames = new Intl.DisplayNames([F.lang], { type: 'region' });
  } catch (e) { /* older runtime: English names */ }
  return {
    ...F,
    decimalSep,
    /** Ratio (0.379) → "37.90%" / "37,90 %" */
    pct: (ratio, decimals = 2) => (Number.isFinite(ratio) ? F.pctOf(ratio * 100, decimals) : '—'),
    signedPct: (ratio, decimals = 2) => (Number.isFinite(ratio) ? F.signedPctOf(ratio * 100, decimals) : '—'),
    /** Quantity without trailing zeros */
    qty: (value) => {
      if (!Number.isFinite(value)) return '—';
      const decimals = Number.isInteger(value) ? 0 : Math.min(4, (String(value).split('.')[1] || '').length);
      return F.num(value, decimals);
    },
    /** 6,326,574 → "6.33M" / "6,33 M" */
    compact: (value) => {
      if (!Number.isFinite(value)) return '—';
      const abs = Math.abs(value);
      const sign = value < 0 ? MINUS : '';
      const unit = (n, d, u) => `${sign}${n.toFixed(d).replace('.', decimalSep)}${fr ? ' ' : ''}${u}`;
      if (abs >= 1e9) return unit(abs / 1e9, 2, fr ? 'Md' : 'B');
      if (abs >= 1e6) return unit(abs / 1e6, 2, 'M');
      if (abs >= 1e3) return unit(abs / 1e3, 1, fr ? 'k' : 'K');
      return `${sign}${abs.toFixed(0)}`;
    },
    /** September 2026 / septembre 2026 */
    monthYear: (d) => {
      const x = d instanceof Date ? d : new Date(d);
      const long = F.dateLong(x).split(' ');
      return `${long[1]} ${long[2]}`;
    },
    /** USD → "US Dollar (USD)" / "dollar des États-Unis (USD)" */
    currencyName: (code) => {
      if (!code) return '—';
      if (!fr) return currencyNameEn(code);
      const name = currencyNames?.of(code);
      return name && name !== code ? `${name.replace(/^./, c => c.toUpperCase())} (${code})` : code;
    },
    countryName: (code) => {
      if (!fr) return countryNameEn(code);
      if (!code) return 'Non classé';
      if (code === 'XS' || code === 'EU') return 'International';
      const name = regionNames?.of(code);
      return name && name !== code ? name : code;
    }
  };
};

// ── Fixed vocabularies ───────────────────────────────────────────────────────

const ASSET_CLASS = {
  en: { fund: 'Funds', equity: 'Equities', fixed_income: 'Fixed income', structured_product: 'Structured products', monetary_products: 'Money market funds', time_deposit: 'Term deposits', private_equity: 'Private equity', private_debt: 'Private debt', commodities: 'Commodities', derivatives: 'Derivatives', cash: 'Cash', other: 'Other' },
  fr: { fund: 'Fonds', equity: 'Actions', fixed_income: 'Obligations', structured_product: 'Produits structurés', monetary_products: 'Fonds monétaires', time_deposit: 'Dépôts à terme', private_equity: 'Private equity', private_debt: 'Dette privée', commodities: 'Matières premières', derivatives: 'Dérivés', cash: 'Espèces', other: 'Autres' }
};

const SECTOR = {
  en: null, // SECTORS labels of the app
  fr: { technology: 'Technologie', financials: 'Finance', healthcare: 'Santé', consumer_discretionary: 'Consommation discrétionnaire', industrials: 'Industrie', energy: 'Énergie', materials: 'Matériaux', consumer_staples: 'Consommation de base', utilities: 'Services aux collectivités', real_estate: 'Immobilier', communication_services: 'Services de communication' }
};

// Structured-product categories (buildCategoryKey): underlying + protection
const SP_UNDERLYING_FR = { equity_linked: 'Actions', fixed_income_linked: 'Taux', credit_linked: 'Crédit', commodities_linked: 'Matières premières', other: 'Autre' };
const SP_PROTECTION_FR = {
  capital_guaranteed_100: 'Capital garanti à 100 %', capital_guaranteed: 'Capital garanti à 100 %',
  capital_guaranteed_partial: 'Garantie partielle', partial_guarantee: 'Garantie partielle',
  capital_protected_conditional: 'Protection conditionnelle', barrier_protected: 'Protection conditionnelle',
  other_protection: 'Autre protection', other: 'Non classé'
};
const spCategoryLabelFr = (key) => {
  const suffix = String(key).replace(/^structured_product_?/, '');
  if (!suffix) return 'Non classé';
  for (const uk of Object.keys(SP_UNDERLYING_FR)) {
    if (suffix.startsWith(`${uk}_`)) {
      const pk = suffix.slice(uk.length + 1);
      return `${SP_UNDERLYING_FR[uk]} - ${SP_PROTECTION_FR[pk] || pk.replace(/_/g, ' ')}`;
    }
  }
  return SP_UNDERLYING_FR[suffix] || SP_PROTECTION_FR[suffix] || suffix.replace(/_/g, ' ');
};

const TYPE = {
  en: {
    BUY: 'Buy', SELL: 'Sell', SUBSCRIPTION: 'Subscription', REDEMPTION: 'Redemption', DIVIDEND: 'Dividend', COUPON: 'Coupon',
    INTEREST: 'Interest', FEE: 'Fee', TAX: 'Tax', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out',
    PAYMENT_IN: 'Payment in', PAYMENT_OUT: 'Payment out', FX_TRADE: 'FX', CARD_PAYMENT: 'Card', CORPORATE_ACTION: 'Corporate action', OTHER: 'Other',
    OPTION_PREMIUM: 'Option premium', DEPOSIT_PLACEMENT: 'Deposit placed', DEPOSIT_MATURITY: 'Deposit matured'
  },
  fr: {
    BUY: 'Achat', SELL: 'Vente', SUBSCRIPTION: 'Souscription', REDEMPTION: 'Remboursement', DIVIDEND: 'Dividende', COUPON: 'Coupon',
    INTEREST: 'Intérêts', FEE: 'Frais', TAX: 'Impôt', TRANSFER_IN: 'Transfert entrant', TRANSFER_OUT: 'Transfert sortant',
    PAYMENT_IN: 'Paiement reçu', PAYMENT_OUT: 'Paiement émis', FX_TRADE: 'Change', CARD_PAYMENT: 'Carte', CORPORATE_ACTION: 'Opération sur titres', OTHER: 'Autre',
    OPTION_PREMIUM: 'Prime d’option', DEPOSIT_PLACEMENT: 'Dépôt placé', DEPOSIT_MATURITY: 'Dépôt échu'
  }
};

const ACTIVITY = {
  en: { CARD: 'Card payments', PAYMENTS: 'Payments and transfers', INCOME: 'Dividends and coupons', COSTS: 'Interest, fees and taxes', TRADES: 'Securities trades', FX: 'FX', OTHER: 'Other' },
  fr: { CARD: 'Paiements par carte', PAYMENTS: 'Paiements et transferts', INCOME: 'Dividendes et coupons', COSTS: 'Intérêts, frais et impôts', TRADES: 'Transactions sur titres', FX: 'Change', OTHER: 'Autres' }
};

const SECTIONS = {
  en: { overview: 'Overview', allocation: 'Allocation and exposure', positions: 'Positions', performance: 'Performance', activity: 'Activity', notes: 'Notes and disclosures' },
  fr: { overview: 'Vue d’ensemble', allocation: 'Répartition et exposition', positions: 'Positions', performance: 'Performance', activity: 'Activité', notes: 'Notes et informations' }
};

const plural = (n, one, many) => (n === 1 ? one : many);

// ── Sentences ────────────────────────────────────────────────────────────────

const EN = {
  // Cover and running header/footer
  kicker: 'Portfolio statement',
  confidential: 'Private and confidential',
  accounts: 'Accounts',
  contents: 'Contents',
  reportDate: 'Report date',
  referenceCurrency: 'Reference currency',
  custodian: 'Custodian',
  period: 'Period',
  netAssetValue: 'Net asset value',
  address: 'Amberlake Partners SAM · 38 Boulevard des Moulins, MC 98000 Monaco · amberlakepartners.com',
  regulated: 'CCAF regulated · SEC registered',
  footerLeft: 'Amberlake Partners SAM · Private and confidential',
  valuationAsOf: (d) => `Valuation as of ${d}`,
  headerValuation: (d) => `Valuation ${d}`,
  headerCurrency: (c) => `Reference currency ${c}`,
  periodText: (a, b) => `${a} to ${b}`,
  emptyText: 'No positions or account movements in this perimeter.',
  titlePortfolio: 'Portfolio',
  titleConsolidated: 'Consolidated portfolio',
  titleAccount: (n) => `Account ${n}`,
  policy: 'Policy',

  // 01 Overview
  overviewTitle: 'Summary',
  overviewCaption: (codes, custodian) => `${codes.length > 1 ? 'Consolidated view of accounts' : 'Account'} ${codes.join(', ')}${custodian ? `, held at ${custodian}` : ''}`,
  changeSince: (d) => `change since ${d}`,
  positionsCount: (p, c) => `${p} ${plural(p, 'position', 'positions')}, ${c} ${plural(c, 'currency', 'currencies')}`,
  legendSecurities: (v) => `Securities ${v}`,
  legendLiquidity: (v) => `Liquidity ${v}`,
  legendFinancing: 'Credit facilities and card',
  kpiPnl: 'Unrealised P&L · securities',
  kpiPnlCaption: (p, c) => `${p} over a cost of ${c}`,
  // Liquidity: cash balances plus money-market funds and term deposits
  liquidity: 'Liquidity',
  ofWhichCash: (v) => `of which cash ${v}`,
  liquidityShare: (p) => `${p} of the portfolio`,
  liquidityRows: { cash: 'Cash', moneyMarket: 'Money market funds', termDeposits: 'Term deposits' },
  kpiSecurities: 'Securities',
  kpiSecuritiesCaption: (n) => `${n} ${plural(n, 'position', 'positions')}`,
  kpiIncome: 'Income received',
  kpiIncomeCaption: (n) => `${n} ${plural(n, 'payment', 'payments')}, net of withholding tax`,
  largestCaption: (n, p) => `top ${n} ${p} of gross`,
  exposureShort: (c) => `After financing the portfolio is net short ${c}.`,
  exposureLong: 'Currency exposure of the assets, net of financing.',
  periodLabels: { '1M': '1 month', '3M': '3 months', '6M': '6 months', YTD: 'Year to date', '1Y': '1 year', ALL: 'Since inception', PERIOD: 'Report period' },
  since: (d) => `Since ${d}`,
  from: (d) => `from ${d}`,
  detailIn: (n) => `Detail in section ${n}.`,

  // 02 Allocation
  allocationTitle: 'Allocation and exposure',
  allocationCaption: (c, v) => `Weights in % of gross assets unless stated · Gross assets ${c} ${v}`,
  exposureCaption: (c, n) => `Financing drawn in ${c} exceeds the assets held in ${n > 1 ? 'those currencies' : 'that currency'}: the portfolio is net short ${c}.`,
  unclassified: 'Unclassified',
  spUnclassified: 'Structured products, unclassified',
  spShort: { structured_product_capital_guaranteed: '100% guaranteed', structured_product_partial_guarantee: 'Partial guarantee', structured_product_equity_linked_barrier_protected: 'Conditional (barrier)', structured_product_barrier_protected: 'Conditional (barrier)', structured_product: 'Unclassified' },

  // 03 Positions
  continued: ' (continued)',
  and: 'and',
  otherHoldings: 'Other holdings',
  kpiMarketValue: (c) => `Market value, ${c}`,
  kpiUnrealised: (c) => `Unrealised P&L, ${c}`,
  kpiPositions: 'Positions',
  blockSummary: (v, c, p, n) => `${v} ${c} · P&L ${p} · ${n} ${plural(n, 'position', 'positions')}`,
  total: (l) => `Total ${l.toLowerCase()}`,
  positionsFootnote: (c, pct) => `Prices supplied by the custodian, dated under each price. ${c} values at the custodian's exchange rates (see liquidity page). ${pct ? 'Bonds and structured products priced in % of nominal. ' : ''}Sorted by market value.`,

  // Liquidity
  liquidityTitle: 'Liquidity and financing',
  kpiLiquidityCcy: (c) => `Liquidity, ${c}`,
  kpiCashCcy: (c) => `Cash, ${c}`,
  kpiFinancingCcy: (c) => `Financing, ${c}`,
  cashAccountsCount: (n) => `${n} ${plural(n, 'account', 'accounts')}`,
  cashAccount: 'Cash account',
  facility: 'Facility',
  facilityLimit: (name, n, c, v) => `${name} ${n}, limit ${c} ${v}`,
  fxCaption: (d) => `${d} · custodian rates where supplied`,
  debitInterest: 'Debit interest',
  financingFees: 'Fees on financing accounts',

  // 04 Performance
  performanceTitle: 'Performance',
  kpiNav: (c) => `Net asset value, ${c}`,
  kpiTwr: 'Time-weighted return, report period',
  navCaption: (c, d) => `${c}, at each valuation date from ${d}`,
  partialMonth: ' · * partial month',
  performanceFootnote: ({ ccy, financingLeftOut, flows, measuredFrom }) => `Returns are time-weighted: deposits and withdrawals are neutralised, so they measure the investment result.${financingLeftOut ? ' They cover the investment accounts; credit facilities and cards are left out.' : ''} Changes in ${ccy} are the simple difference in net asset value, financing included, and include flows.${flows ? ` ${flows} external ${plural(flows, 'flow', 'flows')} neutralised.` : ''}${measuredFrom ? ` Returns are measured from ${measuredFrom}, the first date with both valuations and the custodian's record of deposits and withdrawals.` : ''}`,

  // 05 Activity
  activityTitle: 'Activity',
  activityPeriod: (p, n) => `Period ${p} · ${n} ${plural(n, 'transaction', 'transactions')}`,
  bookings: (n) => `${n} ${plural(n, 'booking', 'bookings')}`,
  reversal: (side) => `${side} reversal`,
  cardCaption: (n, c, v) => `${n} card ${plural(n, 'payment', 'payments')}, ${c} ${v} in the period`,
  movementsTitle: (m) => `Account movements, ${m}`,
  movementsFootnote: (n, cards) => `${n} ${plural(n, 'entry', 'entries')} shown.${cards ? ` The ${cards} card ${plural(cards, 'payment', 'payments')} of the month ${plural(cards, 'is', 'are')} summarised on the activity page.` : ''} Full history for the period is available on request.`,
  movement: 'Movement',
  ref: 'ref',

  // 06 Notes
  notesTitle: 'Notes and disclosures',
  generated: (t) => `Report generated ${t}`
};

const FR = {
  kicker: 'Relevé de portefeuille',
  confidential: 'Privé et confidentiel',
  accounts: 'Comptes',
  contents: 'Sommaire',
  reportDate: 'Date du rapport',
  referenceCurrency: 'Devise de référence',
  custodian: 'Dépositaire',
  period: 'Période',
  netAssetValue: 'Actif net',
  address: 'Amberlake Partners SAM · 38 Boulevard des Moulins, MC 98000 Monaco · amberlakepartners.com',
  regulated: 'Agréé CCAF · Enregistré SEC',
  footerLeft: 'Amberlake Partners SAM · Privé et confidentiel',
  valuationAsOf: (d) => `Valorisation au ${d}`,
  headerValuation: (d) => `Valorisation au ${d}`,
  headerCurrency: (c) => `Devise de référence ${c}`,
  periodText: (a, b) => `du ${a} au ${b}`,
  emptyText: 'Aucune position ni aucun mouvement sur ce périmètre.',
  titlePortfolio: 'Portefeuille',
  titleConsolidated: 'Portefeuille consolidé',
  titleAccount: (n) => `Compte ${n}`,
  policy: 'Contrat',

  overviewTitle: 'Synthèse',
  overviewCaption: (codes, custodian) => `${codes.length > 1 ? 'Vue consolidée des comptes' : 'Compte'} ${codes.join(', ')}${custodian ? `, détenu${codes.length > 1 ? 's' : ''} chez ${custodian}` : ''}`,
  changeSince: (d) => `variation depuis le ${d}`,
  positionsCount: (p, c) => `${p} position${p > 1 ? 's' : ''}, ${c} devise${c > 1 ? 's' : ''}`,
  legendSecurities: (v) => `Titres ${v}`,
  legendLiquidity: (v) => `Liquidités ${v}`,
  legendFinancing: 'Facilités de crédit et carte',
  kpiPnl: 'P&L latent · titres',
  kpiPnlCaption: (p, c) => `${p} pour un coût de ${c}`,
  liquidity: 'Liquidités',
  ofWhichCash: (v) => `dont espèces ${v}`,
  liquidityShare: (p) => `${p} du portefeuille`,
  liquidityRows: { cash: 'Espèces', moneyMarket: 'Fonds monétaires', termDeposits: 'Dépôts à terme' },
  kpiSecurities: 'Titres',
  kpiSecuritiesCaption: (n) => `${n} position${n > 1 ? 's' : ''}`,
  kpiIncome: 'Revenus perçus',
  kpiIncomeCaption: (n) => `${n} paiement${n > 1 ? 's' : ''}, nets de retenue à la source`,
  largestCaption: (n, p) => `${n} premières ${p} des actifs bruts`,
  exposureShort: (c) => `Après financement, le portefeuille est vendeur net de ${c}.`,
  exposureLong: 'Exposition par devise des actifs, nette du financement.',
  periodLabels: { '1M': '1 mois', '3M': '3 mois', '6M': '6 mois', YTD: 'Depuis le début de l’année', '1Y': '1 an', ALL: 'Depuis l’origine', PERIOD: 'Période du rapport' },
  since: (d) => `Depuis le ${d}`,
  from: (d) => `depuis le ${d}`,
  detailIn: (n) => `Détail en section ${n}.`,

  allocationTitle: 'Répartition et exposition',
  allocationCaption: (c, v) => `Poids en % des actifs bruts sauf mention contraire · Actifs bruts ${c} ${v}`,
  exposureCaption: (c, n) => `Le financement tiré en ${c} dépasse les actifs détenus dans ${n > 1 ? 'ces devises' : 'cette devise'} : le portefeuille est vendeur net de ${c}.`,
  unclassified: 'Non classé',
  spUnclassified: 'Produits structurés, non classés',
  spShort: { structured_product_capital_guaranteed: 'Garantis à 100 %', structured_product_partial_guarantee: 'Garantie partielle', structured_product_equity_linked_barrier_protected: 'Conditionnels (barrière)', structured_product_barrier_protected: 'Conditionnels (barrière)', structured_product: 'Non classés' },

  continued: ' (suite)',
  and: 'et',
  otherHoldings: 'Autres avoirs',
  kpiMarketValue: (c) => `Valeur de marché, ${c}`,
  kpiUnrealised: (c) => `P&L latent, ${c}`,
  kpiPositions: 'Positions',
  blockSummary: (v, c, p, n) => `${v} ${c} · P&L ${p} · ${n} position${n > 1 ? 's' : ''}`,
  total: (l) => `Total ${l.toLowerCase()}`,
  positionsFootnote: (c, pct) => `Cours fournis par le dépositaire, datés sous chaque cours. Valeurs en ${c} aux taux de change du dépositaire (voir page liquidités). ${pct ? 'Obligations et produits structurés cotés en % du nominal. ' : ''}Classement par valeur de marché.`,

  liquidityTitle: 'Liquidités et financement',
  kpiLiquidityCcy: (c) => `Liquidités, ${c}`,
  kpiCashCcy: (c) => `Espèces, ${c}`,
  kpiFinancingCcy: (c) => `Financement, ${c}`,
  cashAccountsCount: (n) => `${n} compte${n > 1 ? 's' : ''}`,
  cashAccount: 'Compte espèces',
  facility: 'Facilité',
  facilityLimit: (name, n, c, v) => `${name} ${n}, limite ${c} ${v}`,
  fxCaption: (d) => `${d} · taux du dépositaire lorsqu’ils sont fournis`,
  debitInterest: 'Intérêts débiteurs',
  financingFees: 'Frais sur comptes de financement',

  performanceTitle: 'Performance',
  kpiNav: (c) => `Actif net, ${c}`,
  kpiTwr: 'Rendement pondéré dans le temps, période du rapport',
  navCaption: (c, d) => `${c}, à chaque date de valorisation depuis le ${d}`,
  partialMonth: ' · * mois partiel',
  performanceFootnote: ({ ccy, financingLeftOut, flows, measuredFrom }) => `Les rendements sont pondérés dans le temps : les dépôts et retraits sont neutralisés, ils mesurent donc le résultat des investissements.${financingLeftOut ? ' Ils portent sur les comptes d’investissement ; les facilités de crédit et les cartes en sont exclues.' : ''} Les variations en ${ccy} sont la simple différence d’actif net, financement compris, et incluent les flux.${flows ? ` ${flows} flux externe${flows > 1 ? 's' : ''} neutralisé${flows > 1 ? 's' : ''}.` : ''}${measuredFrom ? ` Les rendements sont mesurés depuis le ${measuredFrom}, première date disposant à la fois des valorisations et de l’historique des dépôts et retraits du dépositaire.` : ''}`,

  activityTitle: 'Activité',
  activityPeriod: (p, n) => `Période ${p} · ${n} opération${n > 1 ? 's' : ''}`,
  bookings: (n) => `${n} écriture${n > 1 ? 's' : ''}`,
  reversal: (side) => `${side} (annulation)`,
  cardCaption: (n, c, v) => `${n} paiement${n > 1 ? 's' : ''} par carte, ${c} ${v} sur la période`,
  movementsTitle: (m) => `Mouvements de compte, ${m}`,
  movementsFootnote: (n, cards) => `${n} écriture${n > 1 ? 's' : ''} affichée${n > 1 ? 's' : ''}.${cards ? ` ${cards > 1 ? `Les ${cards} paiements par carte du mois sont résumés` : 'Le paiement par carte du mois est résumé'} sur la page activité.` : ''} L’historique complet de la période est disponible sur demande.`,
  movement: 'Mouvement',
  ref: 'réf.',

  notesTitle: 'Notes et informations',
  generated: (t) => `Rapport généré le ${t}`
};

// Fixed labels of the PDF page
const UI = {
  en: {
    navWithCcy: (c) => `Net asset value · ${c}`,
    grossAssets: 'Gross assets', financingDrawn: 'Financing drawn', positions: 'Positions',
    waterfallTitle: 'From gross assets to net asset value', lessFinancing: 'Less financing', netAssetValue: 'Net asset value',
    largestPositions: 'Largest positions', netCurrencyExposure: 'Net currency exposure', pctOfNav: '% of NAV',
    performance: 'Performance', changeTwr: 'Change · TWR', changeNote: 'Change in NAV includes flows; the return is time-weighted.',
    assetAllocation: 'Asset allocation', grossAssetsLower: 'gross assets', assetClass: 'Asset class', value: 'Value', weight: 'Weight',
    financing: 'Financing', currencyExposure: 'Currency exposure', ccy: 'Ccy', assets: 'Assets', net: 'Net', netPctNav: 'Net, % of NAV', total: 'Total',
    equitiesBySector: 'Equities by sector', pctOfEquities: '% of equities', equitiesByRegion: 'Equities by region', pctOfEquitiesCountry: '% of equities · issuer country',
    security: 'Security', isin: 'ISIN', nominal: 'Nominal', quantity: 'Quantity', avgCost: 'Avg cost', price: 'Price', priceDate: 'Date', valueInCcy: 'Value in ccy',
    valueRef: (c) => `Value ${c}`, unrealisedPnl: 'Unrealised P&L', pnlPct: 'P&L %',
    account: 'Account', accountNo: 'Account no.', balanceInCcy: 'Balance, in ccy', valueComma: (c) => `Value, ${c}`, pctOfGross: '% of gross',
    cashAccounts: 'Cash accounts', totalCash: 'Total cash', totalFinancing: 'Total financing', fxApplied: 'Exchange rates applied',
    liquidInstruments: 'Money market funds and term deposits', totalLiquidInstruments: 'Total',
    costOfFinancing: 'Cost of financing', debitedToDate: 'debited in the period', totalPeriodEnd: 'Total, at period-end rates',
    noHistory: 'Not enough valuation history yet.', changeByPeriod: 'Change by period', periodCol: 'Period', startValue: 'Start value', change: 'Change', twr: 'TWR',
    monthlyPerformance: 'Monthly performance', unrealisedByPosition: 'Unrealised result by position', againstCost: (c) => `${c}, against average cost`,
    securitiesTransactions: 'Securities transactions', noTrades: 'No securities transactions in this period.',
    date: 'Date', side: 'Side', qty: 'Qty', fees: 'Fees', netAmount: 'Net amount',
    incomeReceived: 'Income received', incomeCaption: 'dividends, coupons and interest, net', count: 'No.', netReceived: 'Net received', taxWithheld: 'Tax withheld',
    incomeNote: 'Total converted at period-end exchange rates.', cardSpending: 'Card spending', perMonth: 'per month',
    movementsCaption1: 'Cash and credit account entries other than card payments and trades', movementsCaption2: 'Amounts in the currency of the account',
    noMovements: 'No account movements this month.', type: 'Type', description: 'Description', amount: 'Amount',
    howToRead: 'How to read this statement', importantNotice: 'Important notice', valuationBasis: 'Valuation basis',
    regulatoryInformation: 'Regulatory information', yourContact: 'Your contact',
    regulatoryLine: 'Amberlake Partners SAM · CCAF regulated · SEC registered',
    definitions: (ref) => [
      ['Gross assets', 'Securities at market value plus credit balances on cash accounts, before borrowing.'],
      ['Financing', 'Debit balances on credit facilities, cards and current accounts. Shown as negative values.'],
      ['Net asset value', 'Gross assets less financing: the client\'s equity in the portfolio and the base for "% of NAV" figures.'],
      ['Liquidity', 'Cash balances plus money-market funds and term deposits, the alternatives to holding cash.'],
      ['Weight', 'Market value as a percentage of gross assets, unless a table states otherwise.'],
      ['Price date', 'The date at which the price shown was valid, as supplied by the custodian.'],
      ['Unrealised P&L', `Market value less average cost, in ${ref} at period-end rates. Includes the currency effect on non-${ref} positions.`],
      ['Time-weighted return', 'Return of the investments between two dates, with deposits and withdrawals neutralised and periods chain-linked. Credit and card accounts are not part of it.'],
      ['Change', 'Difference in net asset value between two valuation dates. Includes deposits and withdrawals.'],
      ['Currency exposure', 'Assets net of financing in each currency. Negative means borrowing exceeds assets held in that currency.']
    ],
    notice: (custodian) => [
      'This statement is a consolidated view prepared by Amberlake Partners SAM for information purposes only. It is not an official record of the client\'s assets.',
      `The only official and legally binding records are the statements, valuations and transaction advices issued directly by the custodian bank${custodian ? `, ${custodian}` : ''}. In the event of any discrepancy between this document and the custodian's statements, the custodian's statements prevail. Clients are invited to compare the two and to report any difference to their relationship manager within 30 days of receipt.`,
      'Amberlake Partners does not hold client assets. The figures reproduced here are taken from data transmitted by the custodian and have not been independently audited. Amberlake Partners accepts no liability for errors or omissions in the data received, nor for decisions taken on the basis of this document.',
      'Past performance is not a reliable indicator of future results. The value of investments and the income from them can fall as well as rise, and the use of borrowing amplifies both gains and losses. Nothing in this statement constitutes investment, legal or tax advice, nor an offer or solicitation to buy or sell any financial instrument.'
    ],
    valuationBasisText: (date, ref) => `Securities are valued at the latest prices supplied by the custodian up to ${date}; the date of each price is shown under it. Positions in other currencies are converted to ${ref} at the custodian's closing rates of the same day where supplied, market rates otherwise. Cash is stated at nominal value. Average cost is the custodian's weighted average purchase price.`
  },
  fr: {
    navWithCcy: (c) => `Actif net · ${c}`,
    grossAssets: 'Actifs bruts', financingDrawn: 'Financement tiré', positions: 'Positions',
    waterfallTitle: 'Des actifs bruts à l’actif net', lessFinancing: 'Moins le financement', netAssetValue: 'Actif net',
    largestPositions: 'Principales positions', netCurrencyExposure: 'Exposition nette par devise', pctOfNav: '% de l’actif net',
    performance: 'Performance', changeTwr: 'Variation · TWR', changeNote: 'La variation de l’actif net inclut les flux ; le rendement est pondéré dans le temps.',
    assetAllocation: 'Répartition par classe d’actifs', grossAssetsLower: 'actifs bruts', assetClass: 'Classe d’actifs', value: 'Valeur', weight: 'Poids',
    financing: 'Financement', currencyExposure: 'Exposition par devise', ccy: 'Dev.', assets: 'Actifs', net: 'Net', netPctNav: 'Net, % actif net', total: 'Total',
    equitiesBySector: 'Actions par secteur', pctOfEquities: '% des actions', equitiesByRegion: 'Actions par région', pctOfEquitiesCountry: '% des actions · pays de l’émetteur',
    security: 'Titre', isin: 'ISIN', nominal: 'Nominal', quantity: 'Quantité', avgCost: 'Coût moyen', price: 'Cours', priceDate: 'Date', valueInCcy: 'Valeur en devise',
    valueRef: (c) => `Valeur ${c}`, unrealisedPnl: 'P&L latent', pnlPct: 'P&L %',
    account: 'Compte', accountNo: 'N° de compte', balanceInCcy: 'Solde en devise', valueComma: (c) => `Valeur, ${c}`, pctOfGross: '% actifs bruts',
    cashAccounts: 'Comptes espèces', totalCash: 'Total espèces', totalFinancing: 'Total financement', fxApplied: 'Taux de change appliqués',
    liquidInstruments: 'Fonds monétaires et dépôts à terme', totalLiquidInstruments: 'Total',
    costOfFinancing: 'Coût du financement', debitedToDate: 'débité sur la période', totalPeriodEnd: 'Total, aux taux de fin de période',
    noHistory: 'Historique de valorisation encore insuffisant.', changeByPeriod: 'Variation par période', periodCol: 'Période', startValue: 'Valeur initiale', change: 'Variation', twr: 'TWR',
    monthlyPerformance: 'Performance mensuelle', unrealisedByPosition: 'Résultat latent par position', againstCost: (c) => `${c}, par rapport au coût moyen`,
    securitiesTransactions: 'Transactions sur titres', noTrades: 'Aucune transaction sur titres sur la période.',
    date: 'Date', side: 'Sens', qty: 'Qté', fees: 'Frais', netAmount: 'Montant net',
    incomeReceived: 'Revenus perçus', incomeCaption: 'dividendes, coupons et intérêts, nets', count: 'Nb', netReceived: 'Net perçu', taxWithheld: 'Retenue à la source',
    incomeNote: 'Total converti aux taux de change de fin de période.', cardSpending: 'Dépenses par carte', perMonth: 'par mois',
    movementsCaption1: 'Écritures des comptes espèces et de crédit, hors paiements par carte et transactions sur titres', movementsCaption2: 'Montants dans la devise du compte',
    noMovements: 'Aucun mouvement de compte ce mois-ci.', type: 'Type', description: 'Libellé', amount: 'Montant',
    howToRead: 'Comment lire ce relevé', importantNotice: 'Avertissement important', valuationBasis: 'Base de valorisation',
    regulatoryInformation: 'Informations réglementaires', yourContact: 'Votre contact',
    regulatoryLine: 'Amberlake Partners SAM · Agréé CCAF · Enregistré SEC',
    definitions: (ref) => [
      ['Actifs bruts', 'Titres à leur valeur de marché plus les soldes créditeurs des comptes espèces, avant emprunt.'],
      ['Financement', 'Soldes débiteurs des facilités de crédit, des cartes et des comptes courants. Présentés en valeurs négatives.'],
      ['Actif net', 'Actifs bruts moins le financement : les fonds propres du client dans le portefeuille et la base des chiffres « % de l’actif net ».'],
      ['Liquidités', 'Soldes en espèces plus fonds monétaires et dépôts à terme, les alternatives à la détention d’espèces.'],
      ['Poids', 'Valeur de marché en pourcentage des actifs bruts, sauf mention contraire dans le tableau.'],
      ['Date de cours', 'Date à laquelle le cours indiqué était valable, telle que transmise par le dépositaire.'],
      ['P&L latent', `Valeur de marché moins coût moyen, en ${ref} aux taux de fin de période. Inclut l’effet de change sur les positions hors ${ref}.`],
      ['Rendement pondéré dans le temps', 'Rendement des investissements entre deux dates, dépôts et retraits neutralisés et périodes chaînées. Les comptes de crédit et les cartes n’en font pas partie.'],
      ['Variation', 'Différence d’actif net entre deux dates de valorisation. Inclut les dépôts et les retraits.'],
      ['Exposition par devise', 'Actifs nets du financement dans chaque devise. Une valeur négative signifie que l’emprunt dépasse les actifs détenus dans cette devise.']
    ],
    notice: (custodian) => [
      'Ce relevé est une vue consolidée préparée par Amberlake Partners SAM à titre purement informatif. Il ne constitue pas un relevé officiel des avoirs du client.',
      `Les seuls relevés officiels et juridiquement contraignants sont les relevés, valorisations et avis d’opéré émis directement par la banque dépositaire${custodian ? `, ${custodian}` : ''}. En cas de divergence entre ce document et les relevés du dépositaire, ces derniers prévalent. Les clients sont invités à comparer les deux documents et à signaler toute différence à leur gestionnaire dans les 30 jours suivant leur réception.`,
      'Amberlake Partners ne détient pas d’avoirs pour le compte de ses clients. Les chiffres reproduits ici proviennent des données transmises par le dépositaire et n’ont pas fait l’objet d’un audit indépendant. Amberlake Partners décline toute responsabilité pour les erreurs ou omissions dans les données reçues, ainsi que pour les décisions prises sur la base de ce document.',
      'Les performances passées ne préjugent pas des performances futures. La valeur des investissements et les revenus qui en découlent peuvent baisser comme augmenter, et le recours à l’emprunt amplifie les gains comme les pertes. Rien dans ce relevé ne constitue un conseil en investissement, juridique ou fiscal, ni une offre ou une sollicitation d’achat ou de vente d’un instrument financier.'
    ],
    valuationBasisText: (date, ref) => `Les titres sont valorisés aux derniers cours fournis par le dépositaire jusqu’au ${date} ; la date de chaque cours figure sous celui-ci. Les positions dans d’autres devises sont converties en ${ref} aux taux de clôture du dépositaire du même jour lorsqu’ils sont fournis, aux taux de marché sinon. Les liquidités sont indiquées à leur valeur nominale. Le coût moyen est le prix d’achat moyen pondéré du dépositaire.`
  }
};

/** Everything the statement says, in one language */
export const statementText = (lang, { sectorLabels = {} } = {}) => {
  const L = lang === 'fr' ? 'fr' : 'en';
  const S = L === 'fr' ? FR : EN;
  return {
    ...S,
    lang: L,
    assetClass: (key) => ASSET_CLASS[L][key] || (key ? key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : ASSET_CLASS[L].other),
    sector: (key) => (L === 'fr' ? SECTOR.fr[key] : sectorLabels[key]) || S.unclassified,
    spCategory: (key) => (L === 'fr' ? spCategoryLabelFr(key) : getGranularCategoryLabel(key)),
    spGroupLabel: (key) => (key === 'structured_product' ? S.spUnclassified : `${ASSET_CLASS[L].structured_product} · ${L === 'fr' ? spCategoryLabelFr(key) : getGranularCategoryLabel(key)}`),
    type: (t) => TYPE[L][t],
    activity: ACTIVITY[L],
    sections: SECTIONS[L],
    ui: UI[L]
  };
};
