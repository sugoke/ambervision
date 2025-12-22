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
const ASSET_CLASS_COLORS = {
  structured_product: '#6366f1',
  equity: '#10b981',
  fixed_income: '#f59e0b',
  cash: '#64748b',
  time_deposit: '#475569',
  monetary_products: '#8b5cf6',
  commodities: '#ec4899',
  other: '#94a3b8'
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
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
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
        Meteor.callAsync('pms.getBankAccountsForPdf', { userId: pdfUserId, pdfToken }),
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

  // Enrich holdings with asset class and product info
  const enrichedHoldings = useMemo(() => {
    return filteredHoldings.map(holding => {
      const metadata = securitiesMetadataData.find(m => m.isin === holding.isin);
      const linkedProduct = productsData.find(p => p.isin === holding.isin);

      let assetClass = metadata?.assetClass || getAssetClassFromSecurityType(holding.securityType, holding.securityName);

      const productIcon = linkedProduct ? getProductTypeIcon(linkedProduct.templateId || linkedProduct.template) : null;

      return {
        ...holding,
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

  // Asset allocation data for chart
  const assetAllocationData = useMemo(() => {
    const allocation = {};
    enrichedHoldings.forEach(h => {
      const key = h.assetClass || 'other';
      if (!allocation[key]) allocation[key] = 0;
      allocation[key] += h.marketValue || 0;
    });

    const labels = [];
    const data = [];
    const colors = [];

    Object.entries(allocation).forEach(([key, value]) => {
      if (value > 0) {
        labels.push(getAssetClassLabel(key));
        data.push(value);
        colors.push(ASSET_CLASS_COLORS[key] || ASSET_CLASS_COLORS.other);
      }
    });

    return {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: colors.map(c => c),
        borderWidth: 2
      }]
    };
  }, [enrichedHoldings]);

  // Determine portfolio currency
  const portfolioCurrency = useMemo(() => {
    if (accountFilter !== 'all') {
      const account = bankAccounts.find(acc => acc._id === accountFilter);
      if (account?.referenceCurrency) return account.referenceCurrency;
    }
    return enrichedHoldings[0]?.portfolioCurrency || 'USD';
  }, [accountFilter, bankAccounts, enrichedHoldings]);

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
        <h1 style={{ color: '#1e293b', marginBottom: '1rem' }}>Portfolio Report - Loading</h1>
        <p style={{ color: '#64748b', fontSize: '1rem' }}>{loadingMessage}</p>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: '1rem' }}>
          Debug: isLoading={String(isLoading)}, validated={String(pdfAuthState.validated)}
        </p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        html, body, #react-target { background: white !important; }
        @media print {
          .pms-pdf-section { page-break-inside: avoid; }
          .pms-pdf-transactions { page-break-before: always; }
          .pms-asset-class-section { page-break-inside: avoid; }
          .pms-asset-class-section:not(:first-child) { page-break-before: always; }
        }
        @page { margin: 1cm; }
      `}</style>

      <div style={styles.container} className="pms-pdf-report report-content">
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <h1 style={styles.title}>
                <span style={{ marginRight: '0.5rem' }}>💼</span>
                Portfolio Report
              </h1>
              <div style={styles.headerMeta}>
                <span style={styles.metaItem}>Report Date: {formatDate(new Date())}</span>
                <span style={styles.metaItem}>Currency: {portfolioCurrency}</span>
                {accountFilter !== 'all' && (
                  <span style={styles.metaItem}>
                    Account: {bankAccounts.find(a => a._id === accountFilter)?.accountNumber || 'Selected'}
                  </span>
                )}
              </div>
            </div>
            <img
              src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png"
              alt="Amberlake Partners"
              style={{ height: '40px', width: 'auto', marginLeft: '1rem' }}
            />
          </div>
        </div>

        {/* Summary Section */}
        <div style={styles.section} className="pms-pdf-section">
          <h2 style={styles.sectionTitle}>Portfolio Summary</h2>
          <div style={styles.summaryGrid}>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Total Portfolio Value</div>
              <div style={styles.summaryValue}>{formatCurrency(totals.totalValue, portfolioCurrency)}</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Total Cost Basis</div>
              <div style={styles.summaryValue}>{formatCurrency(totals.totalCostBasis, portfolioCurrency)}</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Total Gain/Loss</div>
              <div style={{
                ...styles.summaryValue,
                color: totals.totalGainLoss >= 0 ? '#047857' : '#b91c1c'
              }}>
                {formatCurrency(totals.totalGainLoss, portfolioCurrency)}
                <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem' }}>
                  ({formatPercent(totals.totalGainLossPercent)})
                </span>
              </div>
            </div>
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Cash Balance</div>
              <div style={styles.summaryValue}>{formatCurrency(totals.cashBalance, portfolioCurrency)}</div>
            </div>
          </div>
        </div>

        {/* Positions Section */}
        <div style={styles.section} className="pms-pdf-section">
          <h2 style={styles.sectionTitle}>Holdings by Asset Class</h2>

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

              return (
                <tr key={holding._id || idx}>
                  {/* Name + P&L Hero Cell */}
                  <td style={{...styles.td, width: '40%'}}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', flex: 1, minWidth: 0 }}>
                        {/* Product Type Icon */}
                        {holding.productIcon && (
                          <span style={{ fontSize: '1rem', flexShrink: 0, lineHeight: 1.2 }}>{holding.productIcon}</span>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: '600', fontSize: '0.85rem' }}>{holding.securityName || holding.ticker || '-'}</div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>{holding.isin || '-'}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{
                          fontWeight: '700',
                          fontSize: '0.95rem',
                          color: gainLoss >= 0 ? '#047857' : '#b91c1c'
                        }}>
                          {gainLoss >= 0 ? '+' : ''}{formatCurrency(gainLoss, portfolioCurrency)}
                        </div>
                        <div style={{
                          fontSize: '0.75rem',
                          color: returnPct >= 0 ? '#047857' : '#b91c1c',
                          fontWeight: '500'
                        }}>
                          {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  </td>
                  {/* Value */}
                  <td style={{...styles.td, textAlign: 'right', fontWeight: '600', fontFamily: 'monospace', width: '18%'}}>
                    {formatCurrency(holding.marketValue, portfolioCurrency)}
                  </td>
                  {/* Qty */}
                  <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace', fontSize: '0.8rem', color: '#64748b', width: '14%'}}>
                    {formatNumber(holding.quantity, 0)}
                  </td>
                  {/* Avg */}
                  <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace', fontSize: '0.8rem', color: '#64748b', width: '14%'}}>
                    {isPercentagePrice
                      ? formatPercent((holding.costPrice || 0) * 100, false)
                      : formatNumber(holding.costPrice, 2)}
                  </td>
                  {/* Now */}
                  <td style={{
                    ...styles.td,
                    textAlign: 'right',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    width: '14%',
                    color: (holding.marketPrice || 0) >= (holding.costPrice || 0) ? '#047857' : '#b91c1c'
                  }}>
                    {isPercentagePrice
                      ? formatPercent((holding.marketPrice || 0) * 100, false)
                      : formatNumber(holding.marketPrice, 2)}
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
                      <div style={{ fontSize: '0.75rem', fontWeight: '400', opacity: 0.85 }}>
                        {holdings.length} position{holdings.length !== 1 ? 's' : ''} • {groupPercent.toFixed(1)}%
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '600' }}>{formatCurrency(groupTotal, portfolioCurrency)}</div>
                      <div style={{
                        fontSize: '0.8rem',
                        fontWeight: '500',
                        color: groupGainLoss >= 0 ? '#86efac' : '#fca5a5'
                      }}>
                        {groupGainLoss >= 0 ? '+' : ''}{formatCurrency(groupGainLoss, portfolioCurrency)} {groupGainLossPercent >= 0 ? '+' : ''}{groupGainLossPercent.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>

                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={{...styles.th, width: '40%'}}>Security / P&L</th>
                      <th style={{...styles.th, textAlign: 'right', width: '18%'}}>Value</th>
                      <th style={{...styles.th, textAlign: 'right', width: '14%'}}>Qty</th>
                      <th style={{...styles.th, textAlign: 'right', width: '14%'}}>Avg</th>
                      <th style={{...styles.th, textAlign: 'right', width: '14%'}}>Now</th>
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
                              <td colSpan={5} style={{ padding: 0 }}>
                                <div style={styles.subGroupHeader}>
                                  <div>
                                    <span style={{ fontWeight: '500', fontSize: '0.85rem', color: '#1e293b' }}>{subClass}</span>
                                    <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.5rem' }}>
                                      {subHoldings.length} position{subHoldings.length !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <span style={{ fontWeight: '600', fontSize: '0.85rem', color: '#1e293b' }}>
                                      {formatCurrency(subTotal, portfolioCurrency)}
                                    </span>
                                    <span style={{
                                      fontSize: '0.75rem',
                                      marginLeft: '0.5rem',
                                      color: subGainLoss >= 0 ? '#047857' : '#b91c1c',
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
                      <td style={{...styles.td, fontWeight: '700'}}>
                        {getAssetClassLabel(assetClass)} Total
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontWeight: '700', fontFamily: 'monospace'}}>
                        {formatCurrency(groupTotal, portfolioCurrency)}
                      </td>
                      <td colSpan={2} style={{...styles.td, textAlign: 'right', fontWeight: '700', fontFamily: 'monospace', color: groupGainLoss >= 0 ? '#047857' : '#b91c1c'}}>
                        {groupGainLoss >= 0 ? '+' : ''}{formatCurrency(groupGainLoss, portfolioCurrency)}
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontWeight: '700'}}>
                        {groupPercent.toFixed(1)}%
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
          <h2 style={styles.sectionTitle}>Asset Allocation</h2>
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
                    <th style={{...styles.th, textAlign: 'right'}}>Value</th>
                    <th style={{...styles.th, textAlign: 'right'}}>Allocation %</th>
                  </tr>
                </thead>
                <tbody>
                  {assetAllocationData.labels.map((label, idx) => {
                    const value = assetAllocationData.datasets[0].data[idx];
                    const percent = totals.totalValue > 0 ? (value / totals.totalValue) * 100 : 0;
                    const color = assetAllocationData.datasets[0].backgroundColor[idx];

                    return (
                      <tr key={label}>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                              width: '12px',
                              height: '12px',
                              borderRadius: '3px',
                              background: color
                            }} />
                            {label}
                          </div>
                        </td>
                        <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>
                          {formatCurrency(value, portfolioCurrency)}
                        </td>
                        <td style={{...styles.td, textAlign: 'right', fontWeight: '600'}}>
                          {percent.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Performance Section */}
        {performanceData && (
          <div style={styles.section} className="pms-pdf-section">
            <h2 style={styles.sectionTitle}>Performance Metrics</h2>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Period</th>
                  <th style={{...styles.th, textAlign: 'right'}}>Start Value</th>
                  <th style={{...styles.th, textAlign: 'right'}}>End Value</th>
                  <th style={{...styles.th, textAlign: 'right'}}>Change</th>
                  <th style={{...styles.th, textAlign: 'right'}}>Return %</th>
                </tr>
              </thead>
              <tbody>
                {['1M', '3M', '6M', 'YTD', '1Y', 'ALL'].map(period => {
                  const data = performanceData[period] || {};
                  return (
                    <tr key={period}>
                      <td style={{...styles.td, fontWeight: '600'}}>{period === 'ALL' ? 'Since Inception' : period}</td>
                      <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>
                        {formatCurrency(data.startValue, portfolioCurrency)}
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>
                        {formatCurrency(data.endValue, portfolioCurrency)}
                      </td>
                      <td style={{
                        ...styles.td,
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        color: (data.change || 0) >= 0 ? '#047857' : '#b91c1c'
                      }}>
                        {formatCurrency(data.change, portfolioCurrency)}
                      </td>
                      <td style={{...styles.td, textAlign: 'right'}}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          background: (data.returnPercent || 0) >= 0 ? '#d1fae5' : '#fee2e2',
                          color: (data.returnPercent || 0) >= 0 ? '#047857' : '#b91c1c'
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
          <h2 style={styles.sectionTitle}>
            Transactions - {new Date().getFullYear()}
            <span style={{ fontSize: '0.85rem', fontWeight: '400', marginLeft: '1rem', color: '#64748b' }}>
              ({currentYearOperations.length} transactions)
            </span>
          </h2>

          {currentYearOperations.length > 0 ? (
            <table style={{...styles.table, fontSize: '0.8rem'}}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Security</th>
                  <th style={{...styles.th, textAlign: 'right'}}>Quantity</th>
                  <th style={{...styles.th, textAlign: 'right'}}>Price</th>
                  <th style={{...styles.th, textAlign: 'right'}}>Fees</th>
                  <th style={{...styles.th, textAlign: 'right'}}>Net Amount</th>
                </tr>
              </thead>
              <tbody>
                {currentYearOperations.map((op, idx) => {
                  const typeColors = {
                    'BUY': { bg: '#dbeafe', color: '#1e40af' },
                    'SELL': { bg: '#fef3c7', color: '#b45309' },
                    'DIVIDEND': { bg: '#d1fae5', color: '#047857' },
                    'COUPON': { bg: '#d1fae5', color: '#047857' },
                    'FEE': { bg: '#fee2e2', color: '#b91c1c' }
                  };
                  const typeStyle = typeColors[op.operationType] || { bg: '#f3f4f6', color: '#374151' };

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
                          {op.operationType}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <div style={{ fontWeight: '500' }}>{op.ticker || op.instrumentName || '-'}</div>
                        {op.isin && <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{op.isin}</div>}
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>
                        {op.quantity ? formatNumber(op.quantity, 4) : '-'}
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>
                        {op.price ? formatNumber(op.price, 2) : '-'}
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>
                        {op.totalFees ? formatCurrency(op.totalFees, op.currency || portfolioCurrency) : '-'}
                      </td>
                      <td style={{...styles.td, textAlign: 'right', fontWeight: '600', fontFamily: 'monospace'}}>
                        {formatCurrency(op.netAmount || op.grossAmount, op.currency || portfolioCurrency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
              No transactions recorded for {new Date().getFullYear()}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <p>Generated by Amberlake Partners - {new Date().toLocaleString()}</p>
          <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.5rem' }}>
            This report is for informational purposes only and does not constitute investment advice.
          </p>
        </div>
      </div>
    </>
  );
};

// Styles
const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    fontSize: '10pt',
    lineHeight: 1.4,
    color: '#1e293b',
    background: 'white',
    padding: '2rem',
    maxWidth: '297mm',
    margin: '0 auto',
    minHeight: '100vh'
  },
  loading: {
    padding: '2rem',
    textAlign: 'center',
    color: '#64748b',
    background: 'white',
    minHeight: '100vh'
  },
  header: {
    borderBottom: '3px solid #1e3a5f',
    paddingBottom: '1rem',
    marginBottom: '1.5rem',
    padding: '1.5rem',
    marginTop: '-2rem',
    marginLeft: '-2rem',
    marginRight: '-2rem',
    paddingLeft: '2rem',
    paddingRight: '2rem'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#0f172a',
    margin: 0,
    display: 'flex',
    alignItems: 'center'
  },
  headerMeta: {
    display: 'flex',
    gap: '2rem',
    marginTop: '0.5rem',
    fontSize: '0.9rem',
    color: '#334155'
  },
  metaItem: {
    color: '#334155',
    fontWeight: 500
  },
  section: {
    marginBottom: '1.5rem',
    background: 'white'
  },
  sectionTitle: {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#0f172a',
    marginBottom: '0.75rem',
    borderBottom: '2px solid #1e3a5f',
    paddingBottom: '0.5rem',
    background: 'linear-gradient(90deg, #f1f5f9 0%, transparent 100%)',
    padding: '0.5rem',
    marginLeft: '-0.5rem',
    paddingLeft: '0.5rem',
    borderRadius: '4px 0 0 0'
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '1rem',
    marginBottom: '1rem'
  },
  summaryCard: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '1rem',
    textAlign: 'center'
  },
  summaryLabel: {
    fontSize: '0.75rem',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '0.5rem'
  },
  summaryValue: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#1e293b'
  },
  groupHeader: {
    background: 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)',
    color: 'white',
    padding: '0.75rem 1rem',
    borderRadius: '4px 4px 0 0',
    fontWeight: 600,
    fontSize: '0.95rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  subGroupHeader: {
    background: 'rgba(16, 185, 129, 0.08)',
    padding: '0.5rem 1rem',
    paddingLeft: '1.5rem',
    borderLeft: '3px solid rgba(16, 185, 129, 0.5)',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.85rem',
    boxShadow: '0 1px 3px rgba(30, 58, 95, 0.1)'
  },
  th: {
    background: '#f3f4f6',
    padding: '0.5rem 0.75rem',
    textAlign: 'left',
    fontWeight: 600,
    color: '#374151',
    borderBottom: '2px solid #e5e7eb',
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  td: {
    padding: '0.5rem 0.75rem',
    borderBottom: '1px solid #e5e7eb',
    color: '#1e293b',
    background: 'white'
  },
  subtotalRow: {
    background: '#f1f5f9',
    borderTop: '2px solid #cbd5e1'
  },
  footer: {
    marginTop: '2rem',
    paddingTop: '1rem',
    borderTop: '2px solid #1e3a5f',
    textAlign: 'center',
    color: '#475569',
    fontSize: '0.85rem',
    background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
    padding: '1rem',
    marginLeft: '-2rem',
    marginRight: '-2rem',
    marginBottom: '-2rem',
    paddingLeft: '2rem',
    paddingRight: '2rem'
  }
};

export default PMSReportPDF;
