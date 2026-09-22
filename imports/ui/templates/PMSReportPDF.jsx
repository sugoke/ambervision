import React, { useEffect, useState, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';
import { PMSHoldingsCollection } from '../../api/pmsHoldings';
import { PMSOperationsCollection } from '../../api/pmsOperations';
import { BankAccountsCollection } from '../../api/bankAccounts';
import { BanksCollection } from '../../api/banks';
import { ProductsCollection } from '../../api/products';
import { SecuritiesMetadataCollection, getAssetClassLabel } from '../../api/securitiesMetadata';
import HoldingPriceChart from '../components/HoldingPriceChart.jsx';

// Register Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend);

/**
 * PMS Report PDF Template
 *
 * Comprehensive portfolio report including:
 * - Summary metrics
 * - All positions grouped by asset class
 * - Asset allocation with doughnut chart
 * - Performance metrics (all periods)
 * - Current year transactions
 *
 * Styling follows documented standards for consistency.
 */

// Asset class colors for chart
// Allocation chart series. The brand guide rules out bright or neon colour, so
// this is a muted sequence led by navy, with the warm accents drawn from the
// amber/bronze end of the palette. Chosen to stay distinguishable in greyscale.
const ASSET_CLASS_COLORS = {
  structured_product: '#1B2A4A',
  equity: '#14724F',
  fixed_income: '#8A5F0B',
  cash: '#767C88',
  time_deposit: '#4A6785',
  monetary_products: '#6E8B7E',
  commodities: '#A9683A',
  other: '#8C8579'
};

// Helper functions
const getCurrencySymbol = (currencyCode) => {
  const symbols = {
    'USD': '$', 'EUR': '€', 'GBP': '£', 'CHF': 'CHF', 'JPY': '¥'
  };
  return symbols[currencyCode] || currencyCode || '$';
};

const formatCurrency = (value, currency = 'USD') => {
  if (value == null || isNaN(value)) return '-';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch (e) {
    // Intl throws RangeError on anything that isn't a well-formed ISO 4217 code. Per-position
    // currencies come straight from bank files, so one odd code must not blank the whole report.
    return `${formatNumber(value, 2)} ${currency || ''}`.trim();
  }
};

const formatNumber = (value, decimals = 2) => {
  if (value == null || isNaN(value)) return '-';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
};

const formatPercent = (value, showSign = true) => {
  if (value == null || isNaN(value)) return '-';
  const sign = showSign && value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

// Percentage carrying its own sign, without the "-0.00%" a tiny negative would round to.
const formatSignedPercent = (value, decimals = 2) => {
  if (value == null || isNaN(value)) return '-';
  const rounded = Number(value.toFixed(decimals));
  return `${(rounded === 0 ? 0 : rounded).toFixed(decimals)}%`;
};

const formatDate = (date) => {
  if (!date) return '-';
  const d = new Date(date);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const getAssetClassFromSecurityType = (securityType, securityName = '') => {
  const type = String(securityType || '').trim().toUpperCase();
  const name = (securityName || '').toLowerCase();

  if (type === '1' || type === 'EQUITY' || type === 'STOCK') return 'equity';
  if (type === '2' || type === 'BOND' || name.includes('bond')) return 'fixed_income';
  if (type === '4' || type === 'CASH') return 'cash';
  if (type === 'TERM_DEPOSIT' || type === 'TIME_DEPOSIT') return 'time_deposit';
  if (name.includes('money market')) return 'monetary_products';
  if (name.includes('gold') || name.includes('commodity')) return 'commodities';
  if (name.includes('autocallable') || name.includes('barrier') || name.includes('certificate')) return 'structured_product';

  return 'structured_product';
};

// Bank operation parsers do not agree on field names for the same concept: the security name
// arrives as `securityName` (CMB Monaco, Julius Baer, SG Monaco) or `instrumentName` (Andbank,
// CFM, EDR), the unit price as `price` or `securityPrice`, the fees as `fees` or `totalFees`.
// Reading only one spelling each left three transaction columns permanently blank.
const getOperationPrice = (op) => (op.price != null ? op.price : (op.securityPrice != null ? op.securityPrice : null));
const getOperationFees = (op) => (op.totalFees != null ? op.totalFees : (op.fees != null ? op.fees : null));

// A real ISIN is 2 letters + 9 alphanumerics + a check digit. Banks put internal account and
// position codes (e.g. "62060") in the same field, and printing those under an "ISIN" heading
// presents an account reference as a security identifier.
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const isIsin = (value) => typeof value === 'string' && ISIN_PATTERN.test(value.trim().toUpperCase());

/**
 * Best available description of what a transaction was, with the identifier beneath it.
 * Cash movements carry no security at all, so they fall back to the bank's booking text.
 */
const getOperationName = (op, metadataByIsin = {}) => {
  const isin = op.isin && isIsin(op.isin) ? op.isin.trim().toUpperCase() : null;
  const primary = op.securityName
    || op.instrumentName
    || (isin ? metadataByIsin[isin]?.securityName : null)
    || op.description
    || op.operationTypeName
    || op.ticker
    || (isin ? isin : null)
    || 'Cash movement';

  let secondary = null;
  if (isin && primary !== isin) {
    secondary = isin;
  } else if (!isin && op.isin) {
    // Not an ISIN — label it as what it actually is so it isn't mistaken for a security.
    secondary = `Ref. ${op.isin}`;
  }
  return { primary, secondary };
};

// "PAYMENT_OUT" -> "Payment out"
const formatOperationType = (type) => {
  if (!type) return '—';
  const words = String(type).replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Helper function to get product type icon based on template ID
const getProductTypeIcon = (templateId) => {
  if (!templateId) return null;

  const iconMap = {
    'phoenix_autocallable': '🦅',
    'orion_memory': '⭐',
    'himalaya': '🏔️',
    'shark_note': '🦈',
    'participation_note': '📈',
    'reverse_convertible': '🔄',
    'reverse_convertible_bond': '🔄'
  };

  return iconMap[templateId] || '📊';
};

const PMSReportPDF = () => {
  console.log('[PMSReportPDF] Component rendering...');

  const [isReady, setIsReady] = useState(false);
  const [performanceData, setPerformanceData] = useState(null);
  const [performanceLoading, setPerformanceLoading] = useState(true);

  // PDF mode detection and authentication
  const [pdfAuthState, setPdfAuthState] = useState({ validated: false, error: null });
  const [currentSessionId, setCurrentSessionId] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null
  );

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isPDFMode = urlParams?.get('pdfToken') != null;
  const pdfToken = urlParams?.get('pdfToken');
  const pdfUserId = urlParams?.get('userId');
  const accountFilter = urlParams?.get('account') || 'all';

  // Parse viewAsFilter from URL if present (used for client/account filtering)
  const viewAsFilterParam = urlParams?.get('viewAsFilter');
  const viewAsFilter = viewAsFilterParam ? (() => {
    try {
      return JSON.parse(decodeURIComponent(viewAsFilterParam));
    } catch (e) {
      console.error('[PMSReportPDF] Error parsing viewAsFilter:', e);
      return null;
    }
  })() : null;

  console.log('[PMSReportPDF] URL params - accountFilter:', accountFilter, 'viewAsFilter:', viewAsFilter);

  // Validate PDF token if in PDF mode
  useEffect(() => {
    if (isPDFMode && pdfToken && pdfUserId) {
      console.log('[PMSReportPDF] Validating PDF authentication token...');
      Meteor.call('pdf.validateToken', pdfUserId, pdfToken, (error, result) => {
        if (error || !result.valid) {
          console.error('[PMSReportPDF] Token validation failed:', error?.reason || result?.reason);
          setPdfAuthState({ validated: false, error: error?.reason || result?.reason || 'Invalid token' });
        } else {
          console.log('[PMSReportPDF] PDF token validated successfully');
          setPdfAuthState({ validated: true, error: null });

          const tempSessionId = `pdf-temp-${pdfToken}`;
          localStorage.setItem('sessionId', tempSessionId);
          localStorage.setItem('pdfTempSession', 'true');
          setCurrentSessionId(tempSessionId);
        }
      });
    }

    return () => {
      if (localStorage.getItem('pdfTempSession') === 'true') {
        localStorage.removeItem('sessionId');
        localStorage.removeItem('pdfTempSession');
        setCurrentSessionId(null);
      }
    };
  }, [isPDFMode, pdfToken, pdfUserId]);

  // Set PDF mode on body and force white background
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.setAttribute('data-pdf-mode', 'true');
      document.body.style.cssText = 'background: white !important; background-color: white !important; min-height: 100vh;';
      document.documentElement.style.cssText = 'background: white !important; background-color: white !important;';

      const pdfStyleId = 'pdf-white-override';
      if (!document.getElementById(pdfStyleId)) {
        const style = document.createElement('style');
        style.id = pdfStyleId;
        style.textContent = `
          html, body, #react-target, .main-content, .App {
            background: white !important;
            background-color: white !important;
          }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        `;
        document.head.appendChild(style);
      }
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.removeAttribute('data-pdf-mode');
        document.body.style.cssText = '';
        document.documentElement.style.cssText = '';
        const pdfStyle = document.getElementById('pdf-white-override');
        if (pdfStyle) pdfStyle.remove();
      }
    };
  }, []);

  // For PDF mode, fetch data via methods instead of subscriptions
  const [pdfData, setPdfData] = useState({
    holdings: [],
    operations: [],
    bankAccounts: [],
    products: [],
    securitiesMetadata: [],
    loaded: false
  });

  // Fetch data for PDF mode using methods
  useEffect(() => {
    if (isPDFMode && pdfAuthState.validated && pdfUserId) {
      console.log('[PMSReportPDF] Fetching data for PDF via methods, viewAsFilter:', viewAsFilter);

      // Fetch all data in parallel using methods - pass viewAsFilter for proper perimeter filtering
      Promise.all([
        Meteor.callAsync('pms.getHoldingsForPdf', { userId: pdfUserId, pdfToken, viewAsFilter }),
        Meteor.callAsync('pms.getOperationsForPdf', { userId: pdfUserId, pdfToken, viewAsFilter }),
        Meteor.callAsync('pms.getBankAccountsForPdf', { userId: pdfUserId, pdfToken, viewAsFilter }),
        Meteor.callAsync('pms.getProductsForPdf', { userId: pdfUserId, pdfToken }),
        Meteor.callAsync('pms.getSecuritiesMetadataForPdf', { userId: pdfUserId, pdfToken })
      ]).then(([holdingsResult, operationsResult, accountsResult, productsResult, metadataResult]) => {
        console.log('[PMSReportPDF] PDF data fetched:', {
          holdings: holdingsResult?.length || 0,
          operations: operationsResult?.length || 0,
          accounts: accountsResult?.length || 0,
          products: productsResult?.length || 0,
          metadata: metadataResult?.length || 0
        });
        setPdfData({
          holdings: holdingsResult || [],
          operations: operationsResult || [],
          bankAccounts: accountsResult || [],
          products: productsResult || [],
          securitiesMetadata: metadataResult || [],
          loaded: true
        });
      }).catch(err => {
        console.error('[PMSReportPDF] Error fetching PDF data:', err);
        setPdfData(prev => ({ ...prev, loaded: true }));
      });
    }
  }, [isPDFMode, pdfAuthState.validated, pdfUserId, pdfToken, viewAsFilter]);

  // For non-PDF mode, use regular subscriptions
  const { holdings: subHoldings, operations: subOperations, bankAccounts: subBankAccounts, banks, products, securitiesMetadata, isSubLoading } = useTracker(() => {
    if (isPDFMode) {
      // In PDF mode, return empty - we use method data instead
      return { holdings: [], operations: [], bankAccounts: [], banks: [], products: [], securitiesMetadata: [], isSubLoading: false };
    }

    const sessionId = currentSessionId;
    const holdingsSub = Meteor.subscribe('pmsHoldings', { sessionId, latestOnly: true });
    const operationsSub = Meteor.subscribe('pmsOperations', sessionId);
    const accountsSub = Meteor.subscribe('userBankAccounts', sessionId);
    const banksSub = Meteor.subscribe('banks', sessionId);
    const productsSub = Meteor.subscribe('products.all', sessionId);
    const metadataSub = Meteor.subscribe('securitiesMetadata', sessionId);

    return {
      holdings: PMSHoldingsCollection.find({ isLatest: true }).fetch(),
      operations: PMSOperationsCollection.find({}).fetch(),
      bankAccounts: BankAccountsCollection.find({}).fetch(),
      banks: BanksCollection.find({}).fetch(),
      products: ProductsCollection.find({}).fetch(),
      securitiesMetadata: SecuritiesMetadataCollection.find({}).fetch(),
      isSubLoading: !holdingsSub.ready() || !operationsSub.ready() || !accountsSub.ready()
    };
  }, [currentSessionId, isPDFMode]);

  // Use PDF data or subscription data depending on mode
  const holdings = isPDFMode ? pdfData.holdings : subHoldings;
  const operations = isPDFMode ? pdfData.operations : subOperations;
  const bankAccounts = isPDFMode ? pdfData.bankAccounts : subBankAccounts;
  const productsData = isPDFMode ? pdfData.products : products;
  const securitiesMetadataData = isPDFMode ? pdfData.securitiesMetadata : securitiesMetadata;
  const isLoading = isPDFMode ? !pdfData.loaded : isSubLoading;

  // Fetch performance data
  useEffect(() => {
    if (!isLoading && holdings.length > 0) {
      setPerformanceLoading(true);

      if (isPDFMode && pdfAuthState.validated && pdfUserId) {
        // Use PDF-specific method with viewAsFilter for proper perimeter
        Meteor.callAsync('pms.getPerformanceForPdf', { userId: pdfUserId, pdfToken, viewAsFilter })
          .then(result => {
            if (result) {
              setPerformanceData(result);
            }
            setPerformanceLoading(false);
          })
          .catch(err => {
            console.error('[PMSReportPDF] Error fetching performance:', err);
            setPerformanceLoading(false);
          });
      } else {
        // Use regular session-based method
        Meteor.call('performance.getPeriods', { sessionId: currentSessionId }, (error, result) => {
          if (!error && result) {
            setPerformanceData(result);
          }
          setPerformanceLoading(false);
        });
      }
    }
  }, [isLoading, holdings.length, currentSessionId, isPDFMode, pdfAuthState.validated, pdfUserId, pdfToken, viewAsFilter]);

  // Filter holdings and operations by account
  const filteredHoldings = useMemo(() => {
    if (accountFilter === 'all') return holdings;
    const account = bankAccounts.find(acc => acc._id === accountFilter);
    if (!account) return holdings;
    return holdings.filter(h => h.portfolioCode === account.accountNumber && h.bankName === account.bankId);
  }, [holdings, bankAccounts, accountFilter]);

  // Filter operations to current year only
  const currentYearOperations = useMemo(() => {
    const currentYear = new Date().getFullYear();
    let filtered = operations.filter(op => {
      const opDate = new Date(op.operationDate);
      return opDate.getFullYear() === currentYear;
    });

    if (accountFilter !== 'all') {
      const account = bankAccounts.find(acc => acc._id === accountFilter);
      if (account) {
        filtered = filtered.filter(op => op.portfolioCode === account.accountNumber && op.bankName === account.bankId);
      }
    }

    return filtered.sort((a, b) => new Date(b.operationDate) - new Date(a.operationDate));
  }, [operations, bankAccounts, accountFilter]);

  // Canonical security names by ISIN, for naming transactions whose own record has no name.
  const metadataByIsin = useMemo(() => {
    const map = {};
    securitiesMetadataData.forEach(m => {
      if (m.isin) map[String(m.isin).toUpperCase()] = m;
    });
    return map;
  }, [securitiesMetadataData]);

  // Only show the price and fees columns when the source files actually carry them — some banks
  // report neither, and an all-dashes column reads as missing data rather than as not applicable.
  const opsHavePrice = useMemo(
    () => currentYearOperations.some(op => getOperationPrice(op) != null),
    [currentYearOperations]
  );
  const opsHaveFees = useMemo(
    () => currentYearOperations.some(op => getOperationFees(op)),
    [currentYearOperations]
  );

  // Enrich holdings with asset class and product info
  const enrichedHoldings = useMemo(() => {
    return filteredHoldings.map(holding => {
      // Guard on a truthy ISIN. `find(m => m.isin === holding.isin)` matches the first
      // metadata/product row whose own isin is null/undefined for EVERY ISIN-less holding
      // (cash accounts, FX legs), stamping them all with the same unrelated name, icon and
      // asset class — which is why four different cash accounts printed as one name.
      const metadata = holding.isin ? securitiesMetadataData.find(m => m.isin === holding.isin) : null;
      const linkedProduct = holding.isin ? productsData.find(p => p.isin === holding.isin) : null;

      let assetClass = metadata?.assetClass || getAssetClassFromSecurityType(holding.securityType, holding.securityName);

      const productIcon = linkedProduct ? getProductTypeIcon(linkedProduct.templateId || linkedProduct.template) : null;

      return {
        ...holding,
        // Harmonize the name across banks: prefer the canonical name (stored on
        // the holding as displayName, or from Securities Base metadata) over the
        // raw bank-provided name so the same ISIN reads consistently.
        securityName: holding.displayName || metadata?.securityName || holding.securityName,
        assetClass,
        assetClassLabel: getAssetClassLabel(assetClass),
        linkedProduct,
        productIcon
      };
    });
  }, [filteredHoldings, securitiesMetadataData, productsData]);

  // Group holdings by asset class with sub-groups
  const holdingsByAssetClass = useMemo(() => {
    const groups = {};
    enrichedHoldings.forEach(holding => {
      const key = holding.assetClass || 'other';
      if (!groups[key]) {
        groups[key] = {
          holdings: [],
          subGroups: {}
        };
      }

      // Determine sub-group based on asset class
      let subClass = 'Other';
      if (key === 'structured_product') {
        subClass = holding.productType || holding.structuredProductType || 'Other';
      } else if (key === 'equity' || key === 'fixed_income') {
        subClass = holding.assetSubClass || 'Other';
      }

      if (!groups[key].subGroups[subClass]) {
        groups[key].subGroups[subClass] = [];
      }
      groups[key].subGroups[subClass].push(holding);
      groups[key].holdings.push(holding);
    });

    // Sort groups by predefined order
    const sortOrder = ['structured_product', 'equity', 'fixed_income', 'cash', 'monetary_products', 'commodities', 'other'];
    const sorted = {};
    sortOrder.forEach(key => {
      if (groups[key]) sorted[key] = groups[key];
    });

    return sorted;
  }, [enrichedHoldings]);

  // Calculate totals
  const totals = useMemo(() => {
    let totalValue = 0;
    let totalCostBasis = 0;
    let cashBalance = 0;

    enrichedHoldings.forEach(h => {
      const value = h.marketValue || 0;
      const cost = h.costBasisPortfolioCurrency || 0;

      totalValue += value;
      totalCostBasis += cost;

      if (h.assetClass === 'cash') {
        cashBalance += value;
      }
    });

    const totalGainLoss = totalValue - totalCostBasis;
    const totalGainLossPercent = totalCostBasis > 0 ? (totalGainLoss / totalCostBasis) * 100 : 0;

    return { totalValue, totalCostBasis, totalGainLoss, totalGainLossPercent, cashBalance };
  }, [enrichedHoldings]);

  // Asset allocation rows for the table. Every non-zero class is listed, including classes with
  // a negative total (an overdrawn cash account) — dropping those left the table summing to
  // something other than 100% with no explanation of the gap.
  const assetAllocationRows = useMemo(() => {
    const allocation = {};
    enrichedHoldings.forEach(h => {
      const key = h.assetClass || 'other';
      if (!allocation[key]) allocation[key] = 0;
      allocation[key] += h.marketValue || 0;
    });

    return Object.entries(allocation)
      .filter(([, value]) => value !== 0)
      .map(([key, value]) => ({
        key,
        label: getAssetClassLabel(key),
        value,
        color: ASSET_CLASS_COLORS[key] || ASSET_CLASS_COLORS.other,
        percent: totals.totalValue !== 0 ? (value / totals.totalValue) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value);
  }, [enrichedHoldings, totals.totalValue]);

  // Chart data — a doughnut can only render positive slices, so negative classes are listed in
  // the table only (flagged there via the footnote).
  const assetAllocationData = useMemo(() => {
    const positive = assetAllocationRows.filter(r => r.value > 0);
    return {
      labels: positive.map(r => r.label),
      datasets: [{
        data: positive.map(r => r.value),
        backgroundColor: positive.map(r => r.color),
        borderColor: positive.map(r => r.color),
        borderWidth: 2
      }]
    };
  }, [assetAllocationRows]);

  // Determine the report's reference currency — the currency every converted figure is in.
  //
  // The parser stores each holding's `marketValue` in that holding's own portfolioCurrency, so
  // when all holdings agree, that currency IS what the figures are denominated in and nothing
  // may override it. account.referenceCurrency is independent metadata that can be stale or
  // self-contradictory (e.g. account 302894.001 says EUR while its holdings are stored in USD);
  // trusting it there would only relabel USD amounts with a € sign.
  const { portfolioCurrency, holdingsCurrencies } = useMemo(() => {
    const currencies = [...new Set(
      enrichedHoldings.filter(h => h.portfolioCurrency).map(h => h.portfolioCurrency)
    )];
    if (currencies.length === 1) {
      return { portfolioCurrency: currencies[0], holdingsCurrencies: currencies };
    }
    const account = accountFilter !== 'all'
      ? bankAccounts.find(acc => acc._id === accountFilter)
      : null;
    return {
      portfolioCurrency: account?.referenceCurrency || enrichedHoldings[0]?.portfolioCurrency || 'USD',
      holdingsCurrencies: currencies
    };
  }, [accountFilter, bankAccounts, enrichedHoldings]);
  const portfolioHasMixedCurrencies = holdingsCurrencies.length > 1;

  // Valuation date of the positions. Distinct from the report date: holdings come from the
  // last bank file received, which on a Monday morning is still Friday's snapshot.
  const asOfDate = useMemo(() => {
    const dates = enrichedHoldings
      .map(h => h.snapshotDate && new Date(h.snapshotDate))
      .filter(d => d && !isNaN(d));
    return dates.length > 0 ? new Date(Math.max(...dates)) : null;
  }, [enrichedHoldings]);

  // Who/what this report covers. The "View as" label carries the holder name, and the
  // holdings carry the portfolio codes actually included in the figures.
  const scopeLabel = useMemo(() => {
    const codes = [...new Set(enrichedHoldings.map(h => h.portfolioCode).filter(Boolean))].sort();
    const codeLabel = codes.length === 0
      ? null
      : codes.length <= 3
        ? codes.join(', ')
        : `${codes.length} accounts`;
    const named = viewAsFilter?.label
      || bankAccounts.find(a => a._id === accountFilter)?.accountNumber
      || null;
    // Avoid "302894.001 (302894.001)" when the label already is the account number.
    if (named && codeLabel && !named.includes(codeLabel)) return `${named} (${codeLabel})`;
    return named || codeLabel || 'All accounts';
  }, [enrichedHoldings, viewAsFilter, bankAccounts, accountFilter]);

  // Signal PDF readiness
  useEffect(() => {
    if (!isLoading && enrichedHoldings.length > 0 && !performanceLoading) {
      setTimeout(() => {
        setIsReady(true);
        if (typeof document !== 'undefined') {
          document.body.setAttribute('data-pdf-ready', 'true');
        }
      }, 2000);
    }
  }, [isLoading, enrichedHoldings.length, performanceLoading]);

  // Debug logging
  console.log('[PMSReportPDF] State:', {
    isLoading,
    pdfAuthValidated: pdfAuthState.validated,
    pdfAuthError: pdfAuthState.error,
    isPDFMode,
    pdfToken: pdfToken ? 'present' : 'missing',
    pdfUserId,
    holdingsCount: holdings?.length || 0,
    enrichedCount: enrichedHoldings?.length || 0
  });

  // Loading state - must include report-content class for PDF detection
  if (isLoading || !pdfAuthState.validated) {
    const loadingMessage = pdfAuthState.error
      ? `Authentication failed: ${pdfAuthState.error}`
      : !pdfAuthState.validated
        ? `Authenticating PDF session... (token: ${pdfToken ? 'present' : 'MISSING'}, userId: ${pdfUserId || 'MISSING'})`
        : 'Loading portfolio data...';

    console.log('[PMSReportPDF] Loading state:', loadingMessage);

    return (
      <div id="pdf-loading-state" className="report-content" style={{
        ...styles.loading,
        background: 'white',
        minHeight: '100vh',
        padding: '2rem'
      }}>
        <h1 style={{ color: '#2D2D2D', marginBottom: '1rem' }}>Portfolio Report - Loading</h1>
        <p style={{ color: '#767C88', fontSize: '1rem' }}>{loadingMessage}</p>
        <p style={{ color: '#767C88', fontSize: '0.875rem', marginTop: '1rem' }}>
          Debug: isLoading={String(isLoading)}, validated={String(pdfAuthState.validated)}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Poppins is the brand face. Served from our own /public so it survives
          the production CSP, which allows font-src 'self' only — a Google Fonts
          import would be blocked and silently fall back to a system face. */}
      <link rel="stylesheet" href="/fonts/poppins.css" />
      <style>{`
        html, body, #react-target { background: white !important; }

        /* Short amber tick under each section rule. Drawn in CSS so it needs no
           extra element and cannot be dropped by the print stylesheet. */
        .pms-section-title::after {
          content: '';
          position: absolute;
          left: 0;
          bottom: -1px;
          width: 40px;
          height: 2px;
          background: #D4842A;
        }

        /* Banding the rows is what makes a wide financial table readable across
           the page. Kept to the warm paper tint so it survives greyscale. */
        .pms-pdf-report tbody tr:nth-child(even) { background: #F8F6F1; }

        .pms-stat-band > div:first-child { border-left: none; }

        @media print {
          .pms-pdf-section { page-break-inside: avoid; }
          .pms-pdf-transactions { page-break-before: always; }
          .pms-asset-class-section { page-break-inside: avoid; }
          .pms-asset-class-section:not(:first-child) { page-break-before: always; }
          /* A table running past a page break repeats its navy header, so no
             column is ever read without its label. */
          .pms-pdf-report thead { display: table-header-group; }
          .pms-pdf-report tr { page-break-inside: avoid; }
        }
        @page { margin: 1cm; }
      `}</style>

      <div style={styles.container} className="pms-pdf-report report-content">
        {/* Masthead: the portfolio is the headline, the document type the
            eyebrow above it. Logo right, amber rule beneath, then the facts
            that qualify every figure in the report. */}
        <div style={styles.header}>
          <div style={{ minWidth: 0 }}>
            <div style={styles.eyebrow}>Portfolio Report</div>
            <h1 style={styles.title}>{scopeLabel}</h1>
          </div>
          <img
            src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png"
            alt="Amberlake Partners"
            style={styles.logo}
          />
        </div>
        <div style={styles.mastheadRule} />

        <div style={styles.headerMeta}>
          <div style={styles.metaItem}>
            <span style={styles.metaLabel}>Report date</span>
            <span style={styles.metaValue}>{formatDate(new Date())}</span>
          </div>
          {asOfDate && (
            <div style={styles.metaItem}>
              <span style={styles.metaLabel}>Positions as of</span>
              <span style={styles.metaValue}>{formatDate(asOfDate)}</span>
            </div>
          )}
          <div style={styles.metaItem}>
            <span style={styles.metaLabel}>Reference currency</span>
            <span style={styles.metaValue}>{portfolioCurrency}</span>
          </div>
          {portfolioHasMixedCurrencies && (
            <div style={styles.headerWarning}>
              This perimeter holds positions valued in more than one reference currency
              ({holdingsCurrencies.join(', ')}). Totals below add those values together and
              are shown as {portfolioCurrency} for reference only.
            </div>
          )}
        </div>

        {/* Summary Section */}
        <div style={styles.section} className="pms-pdf-section">
          <h2 style={styles.sectionTitle} className="pms-section-title">Portfolio Summary</h2>
          <div style={styles.summaryGrid} className="pms-stat-band">
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Total Portfolio Value</div>
              <div style={styles.summaryValueLead}>{formatCurrency(totals.totalValue, portfolioCurrency)}</div>
              <div style={styles.summaryHint}>securities + cash, in {portfolioCurrency}</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Total Cost Basis</div>
              <div style={styles.summaryValue}>{formatCurrency(totals.totalCostBasis, portfolioCurrency)}</div>
              <div style={styles.summaryHint}>what the positions were bought for</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Unrealised Gain/Loss</div>
              <div style={{
                ...styles.summaryValue,
                color: totals.totalGainLoss >= 0 ? '#14724F' : '#B03C2F'
              }}>
                {formatCurrency(totals.totalGainLoss, portfolioCurrency)}
                <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem' }}>
                  ({formatPercent(totals.totalGainLossPercent)})
                </span>
              </div>
              <div style={styles.summaryHint}>current value vs. cost basis</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Cash Balance</div>
              <div style={styles.summaryValue}>{formatCurrency(totals.cashBalance, portfolioCurrency)}</div>
              <div style={styles.summaryHint}>all currency accounts, converted</div>
            </div>
          </div>
        </div>

        {/* Positions Section */}
        <div style={styles.section} className="pms-pdf-section">
          <h2 style={styles.sectionTitle} className="pms-section-title">Holdings by Asset Class</h2>
          <p style={styles.sectionNote}>
            <strong>Ccy</strong> is the currency the position trades in; prices and the first
            Market Value column are in that currency. The second Market Value column, Unrealised
            P&amp;L and every total are converted to the reference currency
            (<strong>{portfolioCurrency}</strong>) at the rate supplied by the bank.
            P&amp;L is unrealised and measured against average purchase cost; for cash accounts,
            which have no purchase cost, it is the currency translation difference.
            <strong> Weight</strong> is the position as a percentage of total portfolio value.
          </p>

          {Object.entries(holdingsByAssetClass).map(([assetClass, group], index) => {
            const holdings = group.holdings;
            const groupTotal = holdings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
            const groupCost = holdings.reduce((sum, h) => sum + (h.costBasisPortfolioCurrency || 0), 0);
            const groupGainLoss = groupTotal - groupCost;
            const groupGainLossPercent = groupCost > 0 ? (groupGainLoss / groupCost) * 100 : 0;
            const groupPercent = totals.totalValue > 0 ? (groupTotal / totals.totalValue) * 100 : 0;
            const hasSubGroups = Object.keys(group.subGroups).length > 1;

            // Render a position row
            const renderPositionRow = (holding, idx) => {
              const gainLoss = (holding.marketValue || 0) - (holding.costBasisPortfolioCurrency || 0);
              const returnPct = holding.costBasisPortfolioCurrency > 0
                ? (gainLoss / holding.costBasisPortfolioCurrency) * 100
                : 0;
              const isPercentagePrice = holding.priceType === 'percentage';
              // Cash carries a constant 1.00 placeholder price from the parsers. Printing that as
              // a purchase price and a market price implies a valuation that doesn't exist.
              const isCash = holding.assetClass === 'cash';
              const localCurrency = holding.currency || portfolioCurrency;
              // marketValue is in the reference currency; marketValueOriginalCurrency is the
              // bank's figure in the security's own currency. They're equal by definition when
              // the two currencies match, so falling back is safe only in that case.
              const localValue = holding.marketValueOriginalCurrency != null
                ? holding.marketValueOriginalCurrency
                : (localCurrency === portfolioCurrency ? holding.marketValue : null);
              const weight = totals.totalValue > 0
                ? ((holding.marketValue || 0) / totals.totalValue) * 100
                : null;
              const formatPrice = (price) => isPercentagePrice
                ? formatPercent((price || 0) * 100, false)
                : formatNumber(price, 2);

              return (
                <tr key={holding._id || idx}>
                  {/* Security */}
                  <td style={{...styles.td, width: '23%'}}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', minWidth: 0 }}>
                      {holding.productIcon && (
                        <span style={{ fontSize: '1rem', flexShrink: 0, lineHeight: 1.2 }}>{holding.productIcon}</span>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: '600', fontSize: '0.85rem' }}>{holding.securityName || holding.ticker || '-'}</div>
                        <div style={{ fontSize: '0.68rem', color: '#767C88', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.01em' }}>
                          {holding.isin || (isCash ? 'Cash account' : '-')}
                          {holding.isin && !isPDFMode && (
                            <HoldingPriceChart
                              isin={holding.isin}
                              securityName={holding.securityName || holding.ticker}
                              sessionId={currentSessionId}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  {/* Currency of the position */}
                  <td style={{...styles.td, textAlign: 'center', fontSize: '0.8rem', width: '5%'}}>
                    {localCurrency}
                  </td>
                  {/* Quantity — units held, or the balance for a cash account */}
                  <td style={{...styles.td, textAlign: 'right', fontSize: '0.8rem', width: '9%'}}>
                    {formatNumber(holding.quantity, isCash ? 2 : 0)}
                  </td>
                  {/* Average purchase price, per unit, in the position's currency */}
                  <td style={{...styles.td, textAlign: 'right', fontSize: '0.8rem', color: '#767C88', width: '9%'}}>
                    {isCash ? '—' : formatPrice(holding.costPrice)}
                  </td>
                  {/* Market price, per unit, in the position's currency */}
                  <td style={{...styles.td, textAlign: 'right', fontSize: '0.8rem', width: '10%'}}>
                    {isCash ? '—' : (
                      <>
                        {/* Neutral on purpose. Colouring the price against cost
                            put a green figure next to a red P&L on the same row
                            whenever the two scales disagreed, and the P&L column
                            already states the direction without ambiguity. */}
                        <div style={{ color: BRAND.ink }}>
                          {formatPrice(holding.marketPrice)}
                        </div>
                        {holding.priceDate && (
                          <div style={{ fontSize: '0.65rem', color: '#767C88' }}>{formatDate(holding.priceDate)}</div>
                        )}
                      </>
                    )}
                  </td>
                  {/* Market value in the position's own currency */}
                  <td style={{...styles.td, textAlign: 'right', fontSize: '0.8rem', color: '#3D424D', width: '12%'}}>
                    {localValue != null ? formatCurrency(localValue, localCurrency) : '—'}
                  </td>
                  {/* Market value converted to the report's reference currency */}
                  <td style={{...styles.td, textAlign: 'right', fontWeight: '600', width: '12%'}}>
                    {formatCurrency(holding.marketValue, portfolioCurrency)}
                  </td>
                  {/* Unrealised P&L in the reference currency */}
                  <td style={{...styles.td, textAlign: 'right', width: '13%'}}>
                    <div style={{ fontWeight: '700', fontSize: '0.85rem', color: gainLoss >= 0 ? '#14724F' : '#B03C2F' }}>
                      {gainLoss >= 0 ? '+' : ''}{formatCurrency(gainLoss, portfolioCurrency)}
                    </div>
                    {/* A cash account has no purchase cost, so a return percentage against the
                        parsers' 1.00 placeholder would be meaningless — the amount is the
                        currency translation difference and stands on its own. */}
                    {!isCash && (
                      <div style={{ fontSize: '0.72rem', fontWeight: '500', color: returnPct >= 0 ? '#14724F' : '#B03C2F' }}>
                        {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
                      </div>
                    )}
                  </td>
                  {/* Weight in the total portfolio */}
                  <td style={{...styles.td, textAlign: 'right', fontSize: '0.8rem', color: '#3D424D', width: '7%'}}>
                    {weight != null ? formatSignedPercent(weight) : '—'}
                  </td>
                </tr>
              );
            };

            return (
              <div
                key={assetClass}
                className="pms-asset-class-section"
                style={{
                  marginBottom: '1.5rem',
                  pageBreakBefore: index > 0 ? 'always' : 'auto'
                }}
              >
                {/* Asset Class Header */}
                <div style={styles.groupHeader}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div>
                      <div style={{ fontWeight: '600' }}>{getAssetClassLabel(assetClass)}</div>
                      <div style={{ fontSize: '0.62rem', fontWeight: '400', color: '#E8D5A3', letterSpacing: '0.04em', marginTop: '0.1rem' }}>
                        {holdings.length} position{holdings.length !== 1 ? 's' : ''} · {groupPercent.toFixed(1)}%
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '600', fontSize: '0.85rem', letterSpacing: 'normal', textTransform: 'none' }}>{formatCurrency(groupTotal, portfolioCurrency)}</div>
                      <div style={{
                        letterSpacing: 'normal',
                        textTransform: 'none',
                        fontSize: '0.7rem',
                        fontWeight: '500',
                        color: groupGainLoss >= 0 ? '#8CC9AE' : '#E0A39B'
                      }}>
                        {groupGainLoss >= 0 ? '+' : ''}{formatCurrency(groupGainLoss, portfolioCurrency)} {groupGainLossPercent >= 0 ? '+' : ''}{groupGainLossPercent.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>

                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={{...styles.th, width: '23%'}}>
                        Security<div style={styles.thHint}>name / ISIN</div>
                      </th>
                      <th style={{...styles.th, textAlign: 'center', width: '5%'}}>
                        Ccy<div style={styles.thHint}>traded in</div>
                      </th>
                      <th style={{...styles.th, textAlign: 'right', width: '9%'}}>
                        Quantity<div style={styles.thHint}>units held</div>
                      </th>
                      <th style={{...styles.th, textAlign: 'right', width: '9%'}}>
                        Avg Cost<div style={styles.thHint}>per unit, in Ccy</div>
                      </th>
                      <th style={{...styles.th, textAlign: 'right', width: '10%'}}>
                        Market Price<div style={styles.thHint}>per unit, in Ccy</div>
                      </th>
                      <th style={{...styles.th, textAlign: 'right', width: '12%'}}>
                        Market Value<div style={styles.thHint}>in Ccy</div>
                      </th>
                      <th style={{...styles.th, textAlign: 'right', width: '12%'}}>
                        Market Value<div style={styles.thHint}>in {portfolioCurrency}</div>
                      </th>
                      <th style={{...styles.th, textAlign: 'right', width: '13%'}}>
                        Unrealised P&L<div style={styles.thHint}>in {portfolioCurrency}, vs cost</div>
                      </th>
                      <th style={{...styles.th, textAlign: 'right', width: '7%'}}>
                        Weight<div style={styles.thHint}>% of total</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {hasSubGroups ? (
                      // Render with sub-groups
                      Object.entries(group.subGroups).map(([subClass, subHoldings]) => {
                        const subTotal = subHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
                        const subCost = subHoldings.reduce((sum, h) => sum + (h.costBasisPortfolioCurrency || 0), 0);
                        const subGainLoss = subTotal - subCost;

                        return (
                          <React.Fragment key={subClass}>
                            {/* Sub-group Header Row */}
                            <tr>
                              <td colSpan={9} style={{ padding: 0 }}>
                                <div style={styles.subGroupHeader}>
                                  <div>
                                    <span style={{ fontWeight: '500', fontSize: '0.85rem', color: '#2D2D2D' }}>{subClass}</span>
                                    <span style={{ fontSize: '0.75rem', color: '#767C88', marginLeft: '0.5rem' }}>
                                      {subHoldings.length} position{subHoldings.length !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <span style={{ fontWeight: '600', fontSize: '0.85rem', color: '#2D2D2D' }}>
                                      {formatCurrency(subTotal, portfolioCurrency)}
                                    </span>
                                    <span style={{
                                      fontSize: '0.75rem',
                                      marginLeft: '0.5rem',
                                      color: subGainLoss >= 0 ? '#14724F' : '#B03C2F',
                                      fontWeight: '500'
                                    }}>
                                      {subGainLoss >= 0 ? '+' : ''}{formatCurrency(subGainLoss, portfolioCurrency)}
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                            {/* Sub-group Positions */}
                            {subHoldings.map((holding, idx) => renderPositionRow(holding, `${subClass}-${idx}`))}
                          </React.Fragment>
                        );
                      })
                    ) : (
                      // Render flat list
                      holdings.map((holding, idx) => renderPositionRow(holding, idx))
                    )}
                    {/* Subtotal row */}
                    <tr style={styles.subtotalRow}>
                      <td colSpan={6} style={{...styles.td, fontWeight: '700'}}>
                        {getAssetClassLabel(assetClass)} Total
                        <span style={{ fontWeight: '400', fontSize: '0.75rem', color: '#767C88', marginLeft: '0.5rem' }}>
                          ({holdings.length} position{holdings.length !== 1 ? 's' : ''})
                        </span>
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontWeight: '700'}}>
                        {formatCurrency(groupTotal, portfolioCurrency)}
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontWeight: '700', color: groupGainLoss >= 0 ? '#14724F' : '#B03C2F'}}>
                        {groupGainLoss >= 0 ? '+' : ''}{formatCurrency(groupGainLoss, portfolioCurrency)}
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontWeight: '700'}}>
                        {formatSignedPercent(groupPercent)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        {/* Asset Allocation Section */}
        <div style={{...styles.section, pageBreakBefore: 'always'}} className="pms-pdf-section">
          <h2 style={styles.sectionTitle} className="pms-section-title">Asset Allocation</h2>
          <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
            <div style={{ width: '300px', height: '300px' }}>
              <Doughnut
                data={assetAllocationData}
                options={{
                  responsive: true,
                  maintainAspectRatio: true,
                  plugins: {
                    legend: { display: false }
                  }
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Asset Class</th>
                    <th style={{...styles.th, textAlign: 'right'}}>
                      Value<div style={styles.thHint}>in {portfolioCurrency}</div>
                    </th>
                    <th style={{...styles.th, textAlign: 'right'}}>
                      Allocation<div style={styles.thHint}>% of total</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {assetAllocationRows.map(row => (
                    <tr key={row.key}>
                      <td style={styles.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '3px',
                            background: row.color
                          }} />
                          {row.label}
                        </div>
                      </td>
                      <td style={{...styles.td, textAlign: 'right'}}>
                        {formatCurrency(row.value, portfolioCurrency)}
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontWeight: '600'}}>
                        {formatSignedPercent(row.percent)}
                      </td>
                    </tr>
                  ))}
                  <tr style={styles.subtotalRow}>
                    <td style={{...styles.td, fontWeight: '700'}}>Total Portfolio Value</td>
                    <td style={{...styles.td, textAlign: 'right', fontWeight: '700'}}>
                      {formatCurrency(totals.totalValue, portfolioCurrency)}
                    </td>
                    <td style={{...styles.td, textAlign: 'right', fontWeight: '700'}}>
                      100.00%
                    </td>
                  </tr>
                </tbody>
              </table>
              {assetAllocationRows.some(r => r.value < 0) && (
                <p style={styles.sectionNote}>
                  Classes with a negative total (an overdrawn cash account or credit line) are
                  listed above but cannot be drawn as a slice, so the chart shows positive classes only.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Performance Section */}
        {performanceData && (
          <div style={styles.section} className="pms-pdf-section">
            <h2 style={styles.sectionTitle} className="pms-section-title">Performance Metrics</h2>
            <p style={styles.sectionNote}>
              Each period compares the portfolio's total value at the start and end of the period,
              in {portfolioCurrency}. <strong>Return</strong> is the change divided by the start
              value; it is not adjusted for money paid in or withdrawn during the period, so it
              will differ from a cash-flow-weighted return (IRR) where deposits or withdrawals occurred.
            </p>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Period</th>
                  <th style={{...styles.th, textAlign: 'right'}}>
                    Start Value<div style={styles.thHint}>in {portfolioCurrency}</div>
                  </th>
                  <th style={{...styles.th, textAlign: 'right'}}>
                    End Value<div style={styles.thHint}>in {portfolioCurrency}</div>
                  </th>
                  <th style={{...styles.th, textAlign: 'right'}}>
                    Change<div style={styles.thHint}>end − start</div>
                  </th>
                  <th style={{...styles.th, textAlign: 'right'}}>
                    Return<div style={styles.thHint}>change ÷ start</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {['1M', '3M', '6M', 'YTD', '1Y', 'ALL'].map(period => {
                  const data = performanceData[period] || {};
                  return (
                    <tr key={period}>
                      <td style={{...styles.td, fontWeight: '600'}}>{period === 'ALL' ? 'Since Inception' : period}</td>
                      <td style={{...styles.td, textAlign: 'right'}}>
                        {formatCurrency(data.startValue, portfolioCurrency)}
                      </td>
                      <td style={{...styles.td, textAlign: 'right'}}>
                        {formatCurrency(data.endValue, portfolioCurrency)}
                      </td>
                      <td style={{
                        ...styles.td,
                        textAlign: 'right',
                                                color: (data.change || 0) >= 0 ? '#14724F' : '#B03C2F'
                      }}>
                        {formatCurrency(data.change, portfolioCurrency)}
                      </td>
                      <td style={{...styles.td, textAlign: 'right'}}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          background: (data.returnPercent || 0) >= 0 ? '#E8F1EC' : '#F6E9E7',
                          color: (data.returnPercent || 0) >= 0 ? '#14724F' : '#B03C2F'
                        }}>
                          {formatPercent(data.returnPercent || 0)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Transactions Section - Current Year */}
        <div style={{...styles.section, pageBreakBefore: 'always'}} className="pms-pdf-section pms-pdf-transactions">
          <h2 style={styles.sectionTitle} className="pms-section-title">
            Transactions - {new Date().getFullYear()}
            <span style={{ fontSize: '0.85rem', fontWeight: '400', marginLeft: '1rem', color: '#767C88' }}>
              ({currentYearOperations.length} transactions)
            </span>
          </h2>

          <p style={styles.sectionNote}>
            Amounts are in the currency the transaction settled in, which is not always the
            reference currency. A negative net amount left the account, a positive one came in.
          </p>

          {currentYearOperations.length > 0 ? (
            <table style={{...styles.table, fontSize: '0.8rem'}}>
              <thead>
                <tr>
                  <th style={styles.th}>
                    Date<div style={styles.thHint}>booked</div>
                  </th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>
                    Security / Description<div style={styles.thHint}>name / ISIN</div>
                  </th>
                  <th style={{...styles.th, textAlign: 'right'}}>
                    Quantity<div style={styles.thHint}>units, or amount for cash</div>
                  </th>
                  {opsHavePrice && (
                    <th style={{...styles.th, textAlign: 'right'}}>
                      Price<div style={styles.thHint}>per unit</div>
                    </th>
                  )}
                  {opsHaveFees && (
                    <th style={{...styles.th, textAlign: 'right'}}>
                      Fees<div style={styles.thHint}>charged</div>
                    </th>
                  )}
                  <th style={{...styles.th, textAlign: 'center'}}>
                    Ccy<div style={styles.thHint}>settled in</div>
                  </th>
                  <th style={{...styles.th, textAlign: 'right'}}>
                    Net Amount<div style={styles.thHint}>after fees, in Ccy</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentYearOperations.map((op, idx) => {
                  const typeColors = {
                    'BUY': { bg: '#EAEFF6', color: '#1B2A4A' },
                    'SELL': { bg: '#F7EEDF', color: '#8A5F0B' },
                    'DIVIDEND': { bg: '#E8F1EC', color: '#14724F' },
                    'COUPON': { bg: '#E8F1EC', color: '#14724F' },
                    'FEE': { bg: '#F6E9E7', color: '#B03C2F' }
                  };
                  const typeStyle = typeColors[op.operationType] || { bg: '#F1EDE2', color: '#3D424D' };

                  const name = getOperationName(op, metadataByIsin);
                  const price = getOperationPrice(op);
                  const fees = getOperationFees(op);
                  const opCurrency = op.currency || portfolioCurrency;

                  return (
                    <tr key={op._id || idx}>
                      <td style={styles.td}>{formatDate(op.operationDate)}</td>
                      <td style={styles.td}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: '600',
                          background: typeStyle.bg,
                          color: typeStyle.color
                        }}>
                          {formatOperationType(op.operationType)}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <div style={{ fontWeight: '500' }}>{name.primary}</div>
                        {name.secondary && (
                          <div style={{ fontSize: '0.7rem', color: '#767C88' }}>{name.secondary}</div>
                        )}
                      </td>
                      <td style={{...styles.td, textAlign: 'right'}}>
                        {op.quantity ? formatNumber(op.quantity, Number.isInteger(op.quantity) ? 0 : 2) : '—'}
                      </td>
                      {opsHavePrice && (
                        <td style={{...styles.td, textAlign: 'right'}}>
                          {price != null ? formatNumber(price, 2) : '—'}
                        </td>
                      )}
                      {opsHaveFees && (
                        <td style={{...styles.td, textAlign: 'right'}}>
                          {fees ? formatCurrency(fees, opCurrency) : '—'}
                        </td>
                      )}
                      <td style={{...styles.td, textAlign: 'center'}}>
                        {opCurrency}
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontWeight: '600'}}>
                        {formatCurrency(op.netAmount != null ? op.netAmount : op.grossAmount, opCurrency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#767C88' }}>
              No transactions recorded for {new Date().getFullYear()}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <div>
            <div style={styles.footerBrand}>Amberlake Partners SAM · Confidential</div>
            <div>38 Boulevard des Moulins, MC 98000 Monaco · amberlakepartners.com</div>
            <div>SEC Registered · CCAF Regulated</div>
          </div>
          <div style={{ textAlign: 'right', maxWidth: '58ch' }}>
            <div>Generated {new Date().toLocaleString()}</div>
            <div style={{ marginTop: '0.2rem' }}>
              This report is provided for informational purposes only and does not constitute
              investment advice. Valuations are supplied by the custodian banks.
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

// Styles
// ── Amberlake document design system ────────────────────────────────────────
// Deep navy ink, amber accent, warm-white paper — the palette from the brand
// guide, in the muted register the rest of the app uses. Nothing here is
// decorative for its own sake: on paper, gradients and drop shadows read as
// noise and cost ink, so the hierarchy is carried by type, rule weight and
// whitespace instead.
const BRAND = {
  navy: '#1B2A4A',        // headings, table header rows
  navyMid: '#33405C',     // secondary headings
  amber: '#D4842A',       // accent rules, key figures
  amberDeep: '#8A5F0B',   // accent text that must hold contrast on white
  gold: '#E8D5A3',        // hairlines and micro-labels on navy
  paper: '#FFFFFF',
  warmWhite: '#F8F6F1',   // zebra rows, stat band, callouts
  warmTint: '#FBF9F3',
  ink: '#2D2D2D',         // body text
  inkSoft: '#3D424D',
  inkMuted: '#767C88',    // labels, hints
  rule: '#DCD6C7',        // structural borders
  ruleLight: '#ECE7DB',   // row separators
  gain: '#14724F',
  loss: '#B03C2F'
};

const FONT_STACK = "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Figures only line up in a column when the digits share a width. Without this
// a table of currency amounts reads as ragged no matter how it is aligned.
const NUMERIC = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1' };

// Micro-label: the small uppercase caption above a value. Tracked out, because
// uppercase at this size closes up and becomes hard to read.
const MICRO_LABEL = {
  fontSize: '0.56rem',
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: BRAND.inkMuted
};

const styles = {
  container: {
    fontFamily: FONT_STACK,
    fontSize: '9.5pt',
    lineHeight: 1.45,
    color: BRAND.ink,
    background: BRAND.paper,
    padding: '0 2rem 2rem',
    maxWidth: '297mm',
    margin: '0 auto',
    minHeight: '100vh',
    ...NUMERIC
  },
  loading: {
    fontFamily: FONT_STACK,
    padding: '2rem',
    textAlign: 'center',
    color: BRAND.inkMuted,
    background: BRAND.paper,
    minHeight: '100vh'
  },

  // ── Masthead ──────────────────────────────────────────────────────────────
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '2rem',
    paddingTop: '1.5rem',
    paddingBottom: '0.75rem'
  },
  eyebrow: {
    ...MICRO_LABEL,
    letterSpacing: '0.18em',
    color: BRAND.amberDeep,
    marginBottom: '0.3rem'
  },
  title: {
    fontSize: '1.55rem',
    fontWeight: 600,
    color: BRAND.navy,
    margin: 0,
    lineHeight: 1.15,
    letterSpacing: '-0.01em'
  },
  logo: {
    height: '38px',
    width: 'auto',
    flexShrink: 0
  },
  // The one piece of colour at the top of the page. Thin, full width, amber.
  mastheadRule: {
    height: '2px',
    background: BRAND.amber
  },
  headerMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: '2.75rem',
    rowGap: '0.6rem',
    paddingTop: '0.85rem',
    paddingBottom: '1.1rem',
    borderBottom: `1px solid ${BRAND.ruleLight}`,
    marginBottom: '1.5rem'
  },
  metaItem: {
    display: 'block'
  },
  metaLabel: {
    ...MICRO_LABEL,
    display: 'block',
    marginBottom: '0.1rem'
  },
  metaValue: {
    fontSize: '0.8rem',
    fontWeight: 500,
    color: BRAND.navy,
    ...NUMERIC
  },
  headerWarning: {
    width: '100%',
    marginTop: '0.35rem',
    padding: '0.5rem 0.75rem',
    background: BRAND.warmWhite,
    borderLeft: `2px solid ${BRAND.amber}`,
    fontSize: '0.66rem',
    lineHeight: 1.5,
    color: BRAND.inkSoft
  },

  // ── Sections ──────────────────────────────────────────────────────────────
  section: {
    marginBottom: '1.7rem',
    background: BRAND.paper
  },
  // The short amber tick under the rule is drawn by .pms-section-title::after,
  // so it survives the print stylesheet without an extra wrapper element.
  sectionTitle: {
    fontSize: '0.92rem',
    fontWeight: 600,
    color: BRAND.navy,
    margin: '0 0 0.75rem 0',
    paddingBottom: '0.45rem',
    borderBottom: `1px solid ${BRAND.rule}`,
    position: 'relative'
  },
  sectionNote: {
    fontSize: '0.62rem',
    color: BRAND.inkMuted,
    lineHeight: 1.6,
    margin: '0 0 0.9rem 0',
    padding: '0 0 0 0.7rem',
    borderLeft: `1px solid ${BRAND.gold}`,
    maxWidth: '150ch'
  },

  // ── Summary band ──────────────────────────────────────────────────────────
  // One bordered band divided into cells, rather than four floating boxes:
  // fewer edges on the page, and the figures line up as a single row.
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: '1.35fr 1fr 1fr 1fr',
    border: `1px solid ${BRAND.rule}`,
    background: BRAND.warmTint
  },
  summaryCard: {
    padding: '0.85rem 1rem',
    borderLeft: `1px solid ${BRAND.ruleLight}`
  },
  summaryLabel: {
    ...MICRO_LABEL,
    marginBottom: '0.4rem'
  },
  summaryValue: {
    fontSize: '1.05rem',
    fontWeight: 600,
    color: BRAND.navy,
    lineHeight: 1.2,
    ...NUMERIC
  },
  // The headline figure of the whole report.
  summaryValueLead: {
    fontSize: '1.5rem',
    fontWeight: 600,
    color: BRAND.navy,
    lineHeight: 1.15,
    letterSpacing: '-0.01em',
    ...NUMERIC
  },
  summaryHint: {
    fontSize: '0.6rem',
    color: BRAND.inkMuted,
    marginTop: '0.35rem',
    lineHeight: 1.4
  },

  // ── Holdings groups ───────────────────────────────────────────────────────
  groupHeader: {
    background: BRAND.navy,
    color: BRAND.paper,
    padding: '0.6rem 0.85rem',
    fontWeight: 600,
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.1em'
  },
  subGroupHeader: {
    background: BRAND.warmWhite,
    padding: '0.45rem 0.85rem',
    borderLeft: `2px solid ${BRAND.gold}`,
    borderBottom: `1px solid ${BRAND.ruleLight}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },

  // ── Tables ────────────────────────────────────────────────────────────────
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.72rem',
    ...NUMERIC
  },
  th: {
    background: BRAND.navy,
    padding: '0.5rem 0.55rem',
    textAlign: 'left',
    fontWeight: 600,
    color: BRAND.paper,
    fontSize: '0.58rem',
    textTransform: 'uppercase',
    letterSpacing: '0.09em',
    verticalAlign: 'bottom',
    lineHeight: 1.3
  },
  // Unit / basis of the column, so no figure in the table is ambiguous about
  // what it measures. Gold rather than white so it reads as secondary on navy.
  thHint: {
    fontWeight: 400,
    fontSize: '0.54rem',
    textTransform: 'none',
    letterSpacing: 0,
    color: BRAND.gold,
    marginTop: '0.1rem'
  },
  td: {
    padding: '0.42rem 0.55rem',
    borderBottom: `1px solid ${BRAND.ruleLight}`,
    color: BRAND.ink,
    background: 'transparent'
  },
  subtotalRow: {
    background: BRAND.warmWhite,
    borderTop: `1.5px solid ${BRAND.amber}`,
    fontWeight: 600
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    marginTop: '2rem',
    paddingTop: '0.8rem',
    borderTop: `1px solid ${BRAND.rule}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '2.5rem',
    fontSize: '0.62rem',
    color: BRAND.inkMuted,
    lineHeight: 1.55
  },
  footerBrand: {
    fontWeight: 600,
    color: BRAND.navy,
    letterSpacing: '0.02em'
  }
};

export default PMSReportPDF;
