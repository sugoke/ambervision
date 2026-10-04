import React, { useState, useEffect, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { Mongo } from 'meteor/mongo';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import { useTheme } from './ThemeContext.jsx';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { BankAccountsCollection, getClientReferenceCurrency } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { ProductsCollection } from '/imports/api/products';
import { AllocationsCollection } from '/imports/api/allocations';
import { AccountProfilesCollection, aggregateToFourCategories, getProfileName } from '/imports/api/accountProfiles';
import { buildAssetClassBreakdown } from '/imports/api/assetClassification';
import { useViewAs } from './ViewAsContext.jsx';
import {
  getAssetClassLabel,
  getGranularCategoryLabel,
  SecuritiesMetadataCollection,
  buildHierarchicalStructuredProductBreakdown,
  getUnderlyingTypeLabel,
  getProtectionTypeLabel as getProtectionTypeLabelFromMetadata
} from '/imports/api/securitiesMetadata';
import {
  SECURITY_TYPES,
  ASSET_CLASSES,
  getAssetClassFromSecurityType as getAssetClassFromSecurityTypeBase,
  getAssetSubClass as getAssetSubClassBase
} from '/imports/api/constants/instrumentTypes';
import PDFDownloadButton from './components/PDFDownloadButton.jsx';
import NestedDoughnutChart from './components/NestedDoughnutChart.jsx';
import OrderModal from './components/OrderModal.jsx';
import SecurityClassificationModal from './components/SecurityClassificationModal.jsx';
import PortfolioReviewsList from './components/PortfolioReviewsList.jsx';
import PortfolioReviewModal from './components/PortfolioReviewModal.jsx';
import { DataFreshnessPanel } from './components/DataFreshnessIndicator.jsx';
import { checkDataFreshness } from '/imports/api/helpers/dataFreshness.js';
import HoldingPriceChart from './components/HoldingPriceChart.jsx';
import PositionCardMobile from './components/pms/PositionCardMobile.jsx';
import { getCurrencySymbol, getCurrencyFlag, formatCurrency, formatPrice } from './components/pms/pmsFormatters.js';
import { resolveChartColor, resolveChartColors } from '/imports/utils/chartColors.js';
import CashBalanceCardsMobile from './components/pms/CashBalanceCardsMobile.jsx';
import TransactionsSection from './components/pms/TransactionsSection.jsx';
import { getOperationCategory, getOperationTypeLabel } from '/imports/api/constants/operationTypes';
import * as XLSX from 'xlsx';

// Local collection for snapshot dates (synthetic collection from publication)
const PMSHoldingsSnapshotDatesCollection = new Mongo.Collection('pmsHoldingsSnapshotDates');
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Helper function to get structured product protection type from product tags
const getStructuredProductProtectionType = (tags) => {
  if (!tags || tags.length === 0) {
    return 'other_protection';
  }

  // Priority-based classification based on capital protection tags
  if (tags.includes('Total Capital Guarantee')) {
    return 'capital_guaranteed_100';
  }

  // Check for conditional guarantee with percentage
  const conditionalGuarantee = tags.find(tag => tag.startsWith('Conditional Guarantee'));
  if (conditionalGuarantee) {
    return 'capital_protected_conditional';
  }

  if (tags.includes('Capital Protection Barrier') || tags.includes('Capital Protected')) {
    return 'capital_protected_conditional';
  }

  // Check for partial guarantee
  if (tags.includes('Partial Capital Guarantee')) {
    return 'capital_guaranteed_partial';
  }

  // Default for structured products
  return 'other_protection';
};

// Helper function to get structured product underlying type from product or holding
const getStructuredProductUnderlyingType = (product, securityName = '') => {
  const name = (securityName || '').toLowerCase();

  // Check security name for hints
  if (name.includes('commodity') || name.includes('gold') || name.includes('silver') || name.includes('oil')) {
    return 'commodities_linked';
  }
  if (name.includes('credit') || name.includes('cds') || name.includes('default')) {
    return 'credit_linked';
  }
  if (name.includes('bond') || name.includes('fixed income') || name.includes('note')) {
    return 'fixed_income_linked';
  }

  // Default to equity linked (most common)
  return 'equity_linked';
};

// Helper function to get display label for protection type
const getProtectionTypeLabel = (protectionType) => {
  const labels = {
    'capital_guaranteed_100': '100% Capital Guaranteed',
    'capital_guaranteed_partial': 'Capital Partially Guaranteed',
    'capital_protected_conditional': 'Capital Protected Conditionally',
    'other_protection': 'Others'
  };
  return labels[protectionType] || 'Others';
};

// Helper function to get display label for structured product subclass
// Handles both underlying types (equity_linked) and protection types (capital_guaranteed_100)
const getStructuredProductSubclassLabel = (subClass) => {
  // Underlying type labels
  const underlyingLabels = {
    'equity_linked': 'Equity Linked',
    'fixed_income_linked': 'Fixed Income Linked',
    'credit_linked': 'Credit Linked',
    'commodities_linked': 'Commodities Linked'
  };

  // Protection type labels
  const protectionLabels = {
    'capital_guaranteed_100': '100% Capital Guaranteed',
    'capital_guaranteed_partial': 'Capital Partially Guaranteed',
    'capital_protected_conditional': 'Capital Protected Conditionally',
    'other_protection': 'Others'
  };

  return underlyingLabels[subClass] || protectionLabels[subClass] || 'Other';
};

// Helper function to get product type icon based on template ID
const getProductTypeIcon = (templateId) => {
  if (!templateId) return '📊';

  const iconMap = {
    'phoenix_autocallable': '🦅',
    'orion_memory': '⭐',
    'himalaya': '🏔️',
    'shark_note': '🦈',
    'participation_note': '📈',
    'reverse_convertible': '🔄',
    'reverse_convertible_bond': '📜'
  };

  return iconMap[templateId] || '📊';
};

// Helper function to determine asset class from security type
// Uses centralized mapping from instrumentTypes.js with additional name-based fallback
const getAssetClassFromSecurityType = (securityType, securityName = '', productTags = null) => {
  const type = String(securityType || '').trim().toUpperCase();
  const name = (securityName || '').toLowerCase();

  // First try the standardized mapping from central constants
  // This handles all standard SECURITY_TYPES values
  const baseResult = getAssetClassFromSecurityTypeBase(type, securityName);

  // If we got a valid result that's not 'other', use it
  if (baseResult && baseResult !== ASSET_CLASSES.OTHER) {
    return baseResult;
  }

  // Legacy numeric codes from some banks
  if (type === '1') return ASSET_CLASSES.EQUITY;
  if (type === '2') return ASSET_CLASSES.FIXED_INCOME;
  if (type === '4') return ASSET_CLASSES.CASH;

  // Name-based fallback for unclassified securities
  if (name.includes('bond') || name.includes('treasury')) {
    return ASSET_CLASSES.FIXED_INCOME;
  }
  if (name.includes('money market') || name.includes('t-bill') || name.includes('commercial paper')) {
    return ASSET_CLASSES.MONETARY_PRODUCTS;
  }
  if (name.includes('gold') || name.includes('silver') || name.includes('commodity') || name.includes('metal') || name.includes('oil')) {
    return ASSET_CLASSES.COMMODITIES;
  }
  if (name.includes('capital guaranteed') || name.includes('cap.prot') || name.includes('capital protection')) {
    return ASSET_CLASSES.STRUCTURED_PRODUCT;
  }
  if (name.includes('autocallable') || name.includes('barrier') || name.includes('certificate') || name.includes('cert.')) {
    return ASSET_CLASSES.STRUCTURED_PRODUCT;
  }

  // Default to structured_product for unknown types
  return ASSET_CLASSES.STRUCTURED_PRODUCT;
};

// Helper function to get asset sub-class
// Uses centralized mapping from instrumentTypes.js
const getAssetSubClass = (assetClass, securityType, securityName = '', productTags = null) => {
  // First try the standardized mapping from central constants
  const baseResult = getAssetSubClassBase(assetClass, securityType, securityName);

  // If we got a valid result, use it
  if (baseResult) {
    return baseResult;
  }

  // Additional name-based fallback for edge cases
  const name = (securityName || '').toLowerCase();

  if (assetClass === ASSET_CLASSES.EQUITY) {
    if (name.includes('fund') || name.includes('etf')) {
      return 'equity_fund';
    }
    return 'direct_equity';
  }

  if (assetClass === ASSET_CLASSES.FIXED_INCOME) {
    if (name.includes('fund')) {
      return 'fixed_income_fund';
    }
    return 'direct_bond';
  }

  return '';
};

// Helper function to get display label for asset sub-class
const getAssetSubClassLabel = (subClass) => {
  const labels = {
    'direct_equity': 'Direct',
    'equity_fund': 'Funds',
    'direct_bond': 'Direct',
    'fixed_income_fund': 'Funds'
  };
  return labels[subClass] || subClass;
};

// Helper function to define asset class display order
const getAssetClassSortOrder = (assetClass) => {
  const sortOrder = {
    'structured_product': 1,
    'equity': 2,
    'fixed_income': 3,
    'private_equity': 4,
    'commodity': 5,
    'monetary_products': 6,
    'cash': 7,
    'time_deposit': 8
  };
  return sortOrder[assetClass] || 999; // Unknown asset classes go to the end
};

const PortfolioManagementSystem = ({ user, onOpenProductReport }) => {
  const { theme } = useTheme();
  const { viewAsFilter } = useViewAs();
  const [activeTab, setActiveTab] = useState('positions');
  const [sortBy, setSortBy] = useState('marketValue'); // Default sort by market value
  const [sortDirection, setSortDirection] = useState('desc');
  const [filterAssetClass, setFilterAssetClass] = useState('all');
  const [expandedSections, setExpandedSections] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pms_expandedSections')) || {}; } catch { return {}; }
  });
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  // Handle window resize for mobile detection (debounced - this page re-renders a lot)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let timeoutId = null;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => setIsMobile(window.innerWidth < 768), 150);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);


  // Account tab layer - Consolidated or specific account
  const [activeAccountTab, setActiveAccountTab] = useState('consolidated');

  // Historical date selector - null means "latest"
  const [selectedDate, setSelectedDate] = useState(null);
  const [availableDates, setAvailableDates] = useState([]);

  // Performance data
  const [performancePeriods, setPerformancePeriods] = useState(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [chartData, setChartData] = useState(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [lastFetchedRange, setLastFetchedRange] = useState(null);
  const [twrData, setTwrData] = useState(null);
  // Per-line WTD/MTD/YTD performance keyed by holding uniqueKey (computed server-side)
  const [holdingPerfByKey, setHoldingPerfByKey] = useState({});
  const [assetAllocation, setAssetAllocation] = useState(null);
  const [structuredProductHierarchy, setStructuredProductHierarchy] = useState({
    hasData: false,
    level1: [],
    level2: [],
    totalStructuredValue: 0
  });
  const [currencyAllocation, setCurrencyAllocation] = useState(null);
  const [issuerAllocation, setIssuerAllocation] = useState(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState('1Y');
  // Performance tab: calendar return bars, per month or per year
  const [calendarMode, setCalendarMode] = useState('monthly');

  // Refresh key for forcing re-subscription after file processing (Meteor 3 async publication workaround)
  const [refreshKey, setRefreshKey] = useState(0);

  // Notification alerts from notifications collection
  const [notificationAlerts, setNotificationAlerts] = useState([]);
  const [notificationAlertsLoading, setNotificationAlertsLoading] = useState(false);

  // Order modal state
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderModalMode, setOrderModalMode] = useState('buy'); // 'buy' or 'sell'
  const [orderPrefillData, setOrderPrefillData] = useState(null);
  // Bumped each time the modal closes so the next open gets a fresh OrderModal
  // instance — prevents the previous order's termsheet / client email file from
  // sticking around when placing several structured-product orders in a row.
  const [orderModalKey, setOrderModalKey] = React.useState(0);
  React.useEffect(() => {
    if (!orderModalOpen) setOrderModalKey(k => k + 1);
  }, [orderModalOpen]);

  // Reclassify modal state
  const [showClassifyModal, setShowClassifyModal] = useState(false);
  const [classifyTarget, setClassifyTarget] = useState(null);

  // Active orders for positions (to show indicators)
  const [activeOrders, setActiveOrders] = useState([]);

  // Portfolio Review state
  const [portfolioReviewModalId, setPortfolioReviewModalId] = useState(null);
  const [reviewToastVisible, setReviewToastVisible] = useState(false);
  const [reviewToastId, setReviewToastId] = useState(null);
  const [reviewGenerating, setReviewGenerating] = useState(false);
  const [reviewProgress, setReviewProgress] = useState(null); // { currentStepLabel, completedSections, totalSections }
  const [reviewError, setReviewError] = useState(null);
  const [reviewsListKey, setReviewsListKey] = useState(0); // force re-fetch of reviews list
  const [reviewLangPickerOpen, setReviewLangPickerOpen] = useState(false); // language picker dropdown

  // FX deal lifecycle state
  const [fxSpotRates, setFxSpotRates] = useState({}); // { 'ILSEUR': 0.265, ... }
  const [showClosedLifecycles, setShowClosedLifecycles] = useState(false);
  const [expandedLifecycleIds, setExpandedLifecycleIds] = useState(new Set());
  const toggleLifecycleExpansion = (id) => {
    setExpandedLifecycleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Listen for refresh events from file processing
  useEffect(() => {
    const handleRefresh = (event) => {
      console.log('[PMS] Refresh triggered by file processing:', event.detail);
      setRefreshKey(prev => prev + 1);
    };

    window.addEventListener('pmsHoldingsRefresh', handleRefresh);
    return () => window.removeEventListener('pmsHoldingsRefresh', handleRefresh);
  }, []);

  // Fetch notification alerts (critical_alert, warning_alert) for the alerts tab
  useEffect(() => {
    const fetchNotificationAlerts = async () => {
      const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
      if (!sessionId) return;

      try {
        setNotificationAlertsLoading(true);
        const result = await Meteor.callAsync('notifications.getAll', {
          eventType: { $in: ['critical_alert', 'warning_alert'] },
          limit: 50
        }, sessionId);

        let alerts = result.notifications || [];

        // Filter by viewAsFilter if active
        if (viewAsFilter) {
          if (viewAsFilter.type === 'client') {
            // Filter alerts for the selected client
            // Check: alert belongs to client (metadata.clientId) OR client is in sentToUsers
            alerts = alerts.filter(alert =>
              alert.metadata?.clientId === viewAsFilter.id ||
              (alert.sentToUsers && alert.sentToUsers.includes(viewAsFilter.id))
            );
          } else if (viewAsFilter.type === 'account') {
            // Filter alerts for the selected account
            // portfolioCode in metadata is the account number
            const accountNumber = viewAsFilter.data?.accountNumber;
            alerts = alerts.filter(alert =>
              alert.metadata?.portfolioCode === accountNumber
            );
          }
        }

        setNotificationAlerts(alerts);
      } catch (error) {
        console.error('[PMS] Error fetching notification alerts:', error);
        setNotificationAlerts([]);
      } finally {
        setNotificationAlertsLoading(false);
      }
    };

    fetchNotificationAlerts();
    // Re-fetch when refreshKey or viewAsFilter changes
  }, [refreshKey, viewAsFilter]);

  // Fetch active orders for positions (pending, sent status)
  useEffect(() => {
    const fetchActiveOrders = async () => {
      const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
      if (!sessionId) return;

      // Only fetch orders for users who can place orders
      if (!['rm', 'admin', 'superadmin'].includes(user?.role)) {
        return;
      }

      try {
        const filters = {
          status: ['pending', 'sent'] // Only active orders
        };

        // If viewing a specific client, filter by that client
        if (viewAsFilter?.type === 'client') {
          filters.clientId = viewAsFilter.id;
        }

        const result = await Meteor.callAsync('orders.list', {
          filters,
          pagination: { limit: 100 },
          sessionId
        });

        setActiveOrders(result.orders || []);
      } catch (error) {
        console.error('[PMS] Error fetching active orders:', error);
        setActiveOrders([]);
      }
    };

    fetchActiveOrders();
  }, [refreshKey, viewAsFilter, user?.role, orderModalOpen]); // Re-fetch when order modal closes (new order created)

  // Poll review status while generating
  useEffect(() => {
    if (!reviewGenerating || !reviewToastId) return;

    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) return;

    const pollInterval = setInterval(() => {
      Meteor.callAsync('portfolioReview.getReview', reviewToastId, sessionId)
        .then(review => {
          if (!review) return;

          // Update progress display
          if (review.progress) {
            setReviewProgress({
              currentStepLabel: review.progress.currentStepLabel,
              completedSections: review.progress.completedSections || 0,
              totalSections: review.progress.totalSections || 7
            });
          }

          if (review.status === 'completed') {
            clearInterval(pollInterval);
            setReviewGenerating(false);
            setReviewProgress(null);
            setReviewError(null);
            setReviewToastVisible(true);
            setReviewsListKey(prev => prev + 1); // refresh reviews list
            setTimeout(() => setReviewToastVisible(false), 15000);
          } else if (review.status === 'failed') {
            clearInterval(pollInterval);
            setReviewGenerating(false);
            setReviewProgress(null);
            setReviewError(review.progress?.currentStepLabel || 'Generation failed');
            setReviewsListKey(prev => prev + 1);
            setTimeout(() => setReviewError(null), 10000);
          }
        })
        .catch(err => {
          console.error('[PMS] Error polling review status:', err);
        });
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [reviewGenerating, reviewToastId]);

  // Fetch real holdings data from database
  const { holdings, isLoading } = useTracker(() => {
    // refreshKey changes will cause this tracker to re-run and re-subscribe
    const _ = refreshKey;

    const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
    // When viewing a historical date, pass asOfDate to publication
    // When viewing latest (selectedDate is null), pass latestOnly = true
    const latestOnly = !selectedDate; // If no date selected, show latest only
    const asOfDate = selectedDate ? new Date(selectedDate) : null;
    const handle = Meteor.subscribe('pmsHoldings', sessionId, viewAsFilter, latestOnly, asOfDate);
    // Products the positions link to (icon, title, report). products.all needs the
    // session to know the user is staff: without it the server published nothing,
    // and positions were only linked when another page had loaded the products
    // first. Clients get the products of their own perimeter from 'products'.
    const productsHandle = Meteor.subscribe('products.all', sessionId);
    const scopedProductsHandle = Meteor.subscribe('products', sessionId, viewAsFilter);
    const allocationsHandle = Meteor.subscribe('allAllocations', sessionId, viewAsFilter);
    const metadataHandle = Meteor.subscribe('securitiesMetadata', sessionId, {});

    if (!handle.ready() || !productsHandle.ready() || !scopedProductsHandle.ready() || !allocationsHandle.ready() || !metadataHandle.ready()) {
      return { holdings: [], isLoading: true };
    }

    // Fetch all holdings - publication already filters by date/latest on server
    const rawHoldings = PMSHoldingsCollection.find({}, { sort: { securityName: 1 } }).fetch();

    // Build a map of ISIN -> Product for quick lookup
    const productsByIsin = {};
    ProductsCollection.find({}).fetch().forEach(product => {
      if (product.isin) {
        productsByIsin[product.isin.toUpperCase()] = product;
      }
    });

    // Build a map of ISIN -> SecuritiesMetadata for asset class lookup
    const metadataByIsin = {};
    SecuritiesMetadataCollection.find({}).fetch().forEach(metadata => {
      if (metadata.isin) {
        metadataByIsin[metadata.isin.toUpperCase()] = metadata;
      }
    });

    // PMS shows ALL bank holdings - no filtering by allocations
    // Bank holdings are the source of truth from bank files
    // Allocations are a separate internal tracking system
    const filteredHoldings = rawHoldings; // No filtering - show everything from bank


    // Transform holdings to match our table structure
    const transformedHoldings = filteredHoldings.map((holding) => {
      // Use pre-calculated cost basis from parser (NO calculations in UI!)
      const costBasisPortfolioCurrency = holding.costBasisPortfolioCurrency || 0;
      const costBasisOriginalCurrency = holding.costBasisOriginalCurrency || 0;

      // Use pre-calculated P&L values from parser
      const unrealizedPnL = holding.unrealizedPnL !== null && holding.unrealizedPnL !== undefined
        ? holding.unrealizedPnL
        : 0;
      const unrealizedPnLPercent = holding.unrealizedPnLPercent !== null && holding.unrealizedPnLPercent !== undefined
        ? holding.unrealizedPnLPercent
        : 0;

      // Link to product if ISIN exists
      const linkedProduct = holding.isin ? productsByIsin[holding.isin.toUpperCase()] : null;
      const productTags = linkedProduct?.tags || null;

      // Check linking status from holding
      const isLinked = holding.linkedProductId != null;
      const linkingStatus = holding.linkingStatus || 'unlinked';

      // Look up security metadata for asset class classification
      const metadata = holding.isin ? metadataByIsin[holding.isin.toUpperCase()] : null;

      // Determine asset class: prioritize SecuritiesMetadata, then fallback to heuristic
      let assetClass;
      let assetSubClass;

      if (metadata && metadata.assetClass) {
        // Use classified metadata from Securities Base
        assetClass = metadata.assetClass;
        assetSubClass = metadata.assetSubClass || '';
      } else if (holding.isin) {
        // ISIN exists but not classified in metadata - use holding's own assetClass if available
        assetClass = holding.assetClass || getAssetClassFromSecurityType(holding.securityType, holding.securityName, productTags) || 'other';
        assetSubClass = holding.assetSubClass || getAssetSubClass(assetClass, holding.securityType, holding.securityName, productTags) || '';
      } else {
        // No ISIN - use heuristic for things like cash
        assetClass = getAssetClassFromSecurityType(holding.securityType, holding.securityName, productTags);
        assetSubClass = getAssetSubClass(assetClass, holding.securityType, holding.securityName, productTags);
      }

      // For structured products, get additional classification
      // Prioritize metadata, then fallback to product tags
      const structuredProductProtectionType = assetClass === 'structured_product'
        ? (metadata?.structuredProductProtectionType || (productTags ? getStructuredProductProtectionType(productTags) : null))
        : null;
      const structuredProductUnderlyingType = assetClass === 'structured_product'
        ? (metadata?.structuredProductUnderlyingType || getStructuredProductUnderlyingType(linkedProduct, holding.securityName))
        : null;

      // Use product name if linked, otherwise the harmonized security name.
      // The same ISIN can arrive from different banks under different names, so
      // prefer the canonical name from Securities Base: `metadata.securityName`
      // (live for admin/RM), then `holding.displayName` (server-stored copy that
      // also reaches client-role users), then the bank's raw name.
      const displayName = linkedProduct?.title
        || metadata?.securityName
        || holding.displayName
        || holding.securityName
        || 'Unknown Security';
      const productIcon = linkedProduct ? getProductTypeIcon(linkedProduct.templateId || linkedProduct.template) : null;

      return {
        id: holding._id,
        // Stable identity across snapshots (SHA256 of bank|portfolio|isin|...).
        // Used to look up per-line period performance (WTD/MTD/YTD).
        uniqueKey: holding.uniqueKey,
        ticker: holding.ticker || holding.isin || 'N/A',
        name: displayName,
        productIcon: productIcon, // Icon to display for structured products
        quantity: holding.quantity || 0,
        avgPrice: holding.costPrice || 0,
        currentPrice: holding.marketPrice || 0,
        priceDate: holding.priceDate || null,
        marketValue: holding.marketValue || 0,
        marketValueOriginalCurrency: holding.marketValueOriginalCurrency,
        marketValueNoAccruedInterest: holding.marketValueNoAccruedInterest,
        costBasis: costBasisPortfolioCurrency,
        costBasisOriginalCurrency: costBasisOriginalCurrency,
        gainLoss: unrealizedPnL,
        gainLossPercent: unrealizedPnLPercent,
        sector: metadata?.sector || holding.bankSpecificData?.sector?.name || 'Unknown',
        assetClass: assetClass,
        assetSubClass: assetSubClass,
        structuredProductProtectionType: structuredProductProtectionType,
        structuredProductUnderlyingType: structuredProductUnderlyingType,
        currency: holding.currency || 'USD',
        portfolioCurrency: holding.portfolioCurrency || null,  // Add portfolioCurrency from holding for fallback
        priceType: holding.priceType || 'absolute',
        isin: holding.isin,
        securityType: holding.securityType || null,
        // Maturity is stored inconsistently across bank parsers: Julius Baer / EDR / CFM
        // write it to bankSpecificData.instrumentDates.endDate, while CMB Monaco and Andbank
        // write it to bankSpecificData.maturityDate. Read both so term deposits, bonds, etc.
        // show their maturity regardless of source bank.
        maturityDate: holding.bankSpecificData?.instrumentDates?.endDate
          || holding.bankSpecificData?.maturityDate
          || null,
        tradeDate: holding.bankSpecificData?.instrumentDates?.beginDate || null,
        valueDate: holding.bankSpecificData?.instrumentDates?.endDate
          || holding.bankSpecificData?.maturityDate
          || null,
        // Some banks (notably EDR) place term deposits on auto-rolling / call terms
        // and never report a forward maturity date. depositTerm.type ('rolling' | 'call')
        // is set by the EDR term-deposit enrichment so the UI can show a meaningful
        // label instead of "N/A" for these. null for everything else.
        depositTerm: holding.bankSpecificData?.depositTerm || null,
        fxNotional: holding.bankSpecificData?.notional || null,
        fxLeg: holding.bankSpecificData?.fxLeg || null,
        // POES CAT_DETAIL = signed foreign-currency notional. This is the
        // authoritative deal size from the bank's positions file. Repeats on
        // both legs of a deal in the raw CSV — we only trust it on the foreign
        // leg (the one with non-zero BALANCE_POSITION). Used to recover the
        // correct sign+amount when the legacy MFRX enrichment mis-labeled
        // foreign vs base for USD-paired deals.
        catDetail: holding.bankSpecificData?.catDetail || null,
        balanceOriginal: holding.bankSpecificData?.balanceOriginal || null,
        bankId: holding.bankId,
        bankName: holding.bankName,
        portfolioCode: holding.portfolioCode,
        dataDate: holding.dataDate,
        linkedProduct: linkedProduct,
        productTags: productTags,
        // Issuer of the structured product (from SecuritiesMetadata, with
        // fallback to the linked product's issuer when classification hasn't
        // been done yet). Used to compute the issuer-concentration chart.
        issuer: metadata?.issuer
          || linkedProduct?.issuer
          || linkedProduct?.issuerName
          || null,
        // Linking information
        isLinked: isLinked,
        linkingStatus: linkingStatus,
        linkedProductId: holding.linkedProductId,
        linkedAllocationId: holding.linkedAllocationId
      };
    });

    return { holdings: transformedHoldings, isLoading: false };
  }, [viewAsFilter, selectedDate, refreshKey]);

  // Memoize visible bank IDs for freshness panel (avoids recalculating on every render)
  const visibleBankIds = useMemo(() => {
    return [...new Set(holdings.map(h => h.bankId).filter(Boolean))];
  }, [holdings]);

  const dummyPositions = holdings;

  // Fetch operations/transactions from database
  const { operations, isLoadingOperations } = useTracker(() => {
    const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
    const handle = Meteor.subscribe('pmsOperations', sessionId, viewAsFilter);

    if (!handle.ready()) {
      return { operations: [], isLoadingOperations: true };
    }

    const rawOperations = PMSOperationsCollection.find({}, { sort: { operationDate: -1 } }).fetch();

    // Harmonized view of each operation (written by the bank parsers). Records stored
    // before parsers wrote it get the same shape from their raw fields.
    const standardOf = (op) => {
      const std = op.std || {
        type: op.operationType,
        category: getOperationCategory(op.operationType),
        label: getOperationTypeLabel(op.operationType),
        description: op.description || op.remark || op.text || op.operationTypeName || null,
        instrumentName: op.securityName || op.instrumentName || null,
        isin: op.isin || null,
        quantity: op.quantity || null,
        price: op.price || null,
        amount: op.netAmount ?? op.grossAmount ?? 0,
        currency: op.currency || op.operationCurrency || op.instrumentCurrency || op.portfolioCurrency || null,
        cashImpact: true,
        fees: op.totalFees || op.fees || null,
        bankTypeCode: op.operationCode || op.originalOperationType || null,
        bankTypeLabel: op.operationTypeName || op.operationTypeLabel || null,
        reference: op.operationId || null
      };
      // Some banks (CFM) do not name the security in their transaction file
      if (!std.instrumentName && std.isin) {
        const metadata = SecuritiesMetadataCollection.findOne({ isin: std.isin.toUpperCase() });
        if (metadata?.securityName) return { ...std, instrumentName: metadata.securityName };
      }
      return std;
    };

    // Transform operations to match UI structure
    const transformedOperations = rawOperations.map((op) => ({
      std: standardOf(op),
      bankLabel: op.bankName || null,
      id: op._id,
      date: op.operationDate,
      valueDate: op.valueDate,
      inputDate: op.inputDate,
      type: op.operationType, // BUY, SELL, DIVIDEND, COUPON, FEE, TRANSFER, etc.
      typeName: op.operationTypeName,
      subtypeName: op.operationSubtypeName,
      ticker: op.ticker || op.isin || 'N/A',
      isin: op.isin,
      instrumentName: op.instrumentName,
      instrumentType: op.instrumentType,
      category: op.operationCategory, // EQUITY, BOND, CASH, etc.
      quantity: op.quantity || 0,
      price: op.price || 0,
      grossAmount: op.grossAmount || 0,
      netAmount: op.netAmount || 0,
      totalFees: op.totalFees || 0,
      bankCommission: op.bankCommission || 0,
      brokerFee: op.brokerFee || 0,
      tax: op.tax || 0,
      otherFee: op.otherFee || 0,
      currency: op.instrumentCurrency || op.portfolioCurrency || 'EUR',
      portfolioCode: op.portfolioCode,
      account: op.account,
      counterparty: op.counterparty,
      market: op.market,
      remark: op.remark,
      bankName: op.bankId,
      sourceFile: op.sourceFile,
      // FX-specific fields (used by fxDealLifecycles derivation)
      operationNumber: op.operationNumber,
      amount: op.amount,
      fxRate: op.fxRate,
      operationCurrency: op.operationCurrency,
      settlementCurrency: op.settlementCurrency,
      baseCurrency: op.baseCurrency,
      direction: op.direction
    }));

    return { operations: transformedOperations, isLoadingOperations: false };
  }, [viewAsFilter]);

  // Fetch user's bank accounts for account filter dropdown
  // Filtered by selected client when viewAsFilter is set
  const { bankAccounts, accountProfiles, isLoadingAccounts } = useTracker(() => {
    const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
    const accountsHandle = Meteor.subscribe('userBankAccounts', sessionId, viewAsFilter);
    const banksHandle = Meteor.subscribe('banks');
    const profilesHandle = Meteor.subscribe('accountProfiles', sessionId, viewAsFilter?.id);

    if (!accountsHandle.ready() || !banksHandle.ready()) {
      return { bankAccounts: [], accountProfiles: [], isLoadingAccounts: true };
    }

    // Build query - filter by entity or client when viewAsFilter is set
    const query = { isActive: true };
    if (viewAsFilter && viewAsFilter.id) {
      if (viewAsFilter.type === 'entity') {
        // Show accounts owned by this entity OR where entity is a beneficial owner
        query.$or = [
          { entityId: viewAsFilter.id },
          { beneficialOwnerIds: viewAsFilter.id },
          { beneficialOwnerId: viewAsFilter.id }
        ];
      } else if (viewAsFilter.type === 'account') {
        // Single account selected
        query._id = viewAsFilter.id;
      } else if (viewAsFilter.type === 'client') {
        query.userId = viewAsFilter.id;
      }
    }

    const accounts = BankAccountsCollection.find(query, { sort: { accountNumber: 1 } }).fetch();
    const banks = BanksCollection.find({ isActive: true }).fetch();

    // The account list omits the KYC risk assessment; staff get it for the
    // owner in view through 'bankAccounts.details', which merges it into the
    // same documents. The publication refuses clients server-side too.
    if (viewAsFilter?.id && user?.role && user.role !== 'client') {
      const ownerId = viewAsFilter.type === 'account'
        ? (accounts[0]?.entityId || accounts[0]?.userId)
        : viewAsFilter.id;
      if (ownerId) Meteor.subscribe('bankAccounts.details', sessionId, ownerId);
    }

    // Get account profiles for these accounts
    const accountIds = accounts.map(a => a._id);
    const profiles = AccountProfilesCollection.find({ bankAccountId: { $in: accountIds } }).fetch();

    // Enrich accounts with bank info (name, country code)
    const enrichedAccounts = accounts.map(account => {
      const bank = banks.find(b => b._id === account.bankId);
      return {
        ...account,
        bankCountryCode: bank?.countryCode || 'N/A',
        bankName: bank?.name || bank?.shortName || 'Unknown Bank',
        bankShortName: bank?.shortName || bank?.name || 'Unknown'
      };
    });

    return { bankAccounts: enrichedAccounts, accountProfiles: profiles, isLoadingAccounts: false };
  }, [viewAsFilter, user?.role]);

  // Account description order (for tab sorting) and icons
  const ACCOUNT_DESCRIPTION_CONFIG = {
    'Investments': { icon: '📈', order: 1 },
    'Spending': { icon: '💰', order: 2 },
    'Credit line': { icon: '💳', order: 3 },
    'Credit card': { icon: '💳', order: 4 }
  };

  // Build account tabs from BankAccounts
  const accountTabs = useMemo(() => {
    if (!bankAccounts.length) return [{ id: 'consolidated', label: 'Consolidated', icon: '📊' }];

    // Sort by comment/description (Investments first, then Spending, Credit line, Credit card)
    const sortedAccounts = [...bankAccounts].sort((a, b) => {
      const orderA = ACCOUNT_DESCRIPTION_CONFIG[a.comment]?.order || 99;
      const orderB = ACCOUNT_DESCRIPTION_CONFIG[b.comment]?.order || 99;
      return orderA - orderB;
    });

    return [
      { id: 'consolidated', label: 'Consolidated', caption: null, icon: '📊' },
      ...sortedAccounts.map(acc => {
        const descConfig = ACCOUNT_DESCRIPTION_CONFIG[acc.comment] || { icon: '📁', order: 99 };

        return {
          id: acc._id,
          label: `${acc.bankShortName} - ${acc.accountNumber}`,
          caption: acc.comment || null,
          icon: descConfig.icon,
          accountNumber: acc.accountNumber,
          bankId: acc.bankId,
          accountType: acc.accountType
        };
      })
    ];
  }, [bankAccounts]);

  const dummyTransactions = operations;

  // Filter holdings by active account tab
  // 'consolidated' aggregates the per-account holdings (source of truth)
  // Specific accounts filter by account number and bank
  const filteredHoldings = useMemo(() => {
    if (activeAccountTab === 'consolidated') {
      // Aggregate per-account holdings and EXCLUDE the pre-aggregated CONSOLIDATED
      // roll-up rows. The CRON-built CONSOLIDATED copy double-counts duplicate bank
      // records (e.g. "Andbank" vs "Andbank Monaco") and can drift from the per-account
      // data (e.g. CMB Monaco), so the per-account rows are the single source of truth —
      // this matches the home dashboard's Total AUM methodology.
      return dummyPositions.filter(pos => pos.portfolioCode !== 'CONSOLIDATED');
    }

    // Find the selected account tab details
    const selectedTab = accountTabs.find(tab => tab.id === activeAccountTab);
    if (!selectedTab || !selectedTab.accountNumber) {
      // Fallback: show all positions if account not found
      return dummyPositions.filter(pos => pos.portfolioCode !== 'CONSOLIDATED');
    }

    // Match portfolioCode using base account number with startsWith
    // Handles: "5040241" matches "5040241", "5040241-1", "5040241200001" (JB long format)
    const baseAccountNumber = selectedTab.accountNumber.split('-')[0];

    return dummyPositions.filter(pos => {
      const portfolioCode = pos.portfolioCode || '';
      return portfolioCode !== 'CONSOLIDATED' &&
        portfolioCode.startsWith(baseAccountNumber) &&
        pos.bankId === selectedTab.bankId;
    });
  }, [dummyPositions, activeAccountTab, accountTabs]);

  // Filter operations by active account tab
  const filteredOperations = useMemo(() => {
    if (activeAccountTab === 'consolidated') {
      // For consolidated view, show all operations (operations don't consolidate)
      return dummyTransactions;
    }

    const selectedTab = accountTabs.find(tab => tab.id === activeAccountTab);
    if (!selectedTab || !selectedTab.accountNumber) {
      return dummyTransactions;
    }

    // Match portfolioCode using base account number with startsWith
    // Handles: "5040241" matches "5040241", "5040241-1", "5040241200001" (JB long format)
    // Note: op.bankName contains the bankId (see transform at line 690)
    const baseAccountNumber = selectedTab.accountNumber.split('-')[0];

    return dummyTransactions.filter(op => {
      const portfolioCode = op.portfolioCode || '';
      return portfolioCode.startsWith(baseAccountNumber) && op.bankName === selectedTab.bankId;
    });
  }, [dummyTransactions, activeAccountTab, accountTabs]);

  // Use filtered data for display
  const displayPositionsRaw = filteredHoldings;
  const displayTransactions = filteredOperations;

  // Currency picked in the header to view the portfolio in, overriding the
  // resolved reference currency below. Reset whenever the scope changes.
  const [displayCurrencyOverride, setDisplayCurrencyOverride] = useState(null);
  useEffect(() => { setDisplayCurrencyOverride(null); }, [viewAsFilter?.type, viewAsFilter?.id]);

  // Determine portfolio reference currency
  // Priority: 1) Holdings' portfolioCurrency, 2) Scope's reference currency (account tab or
  // viewAs account/client/entity), 3) Most common bank account currency, 4) USD default
  let portfolioCurrency = 'USD';
  let portfolioHasMixedCurrencies = false;

  // The currency marketValue is actually denominated in. The parser converts each holding's
  // marketValue into the holding's portfolioCurrency, so THAT is the only currency guaranteed to
  // match the numbers we display. account.referenceCurrency is independent metadata that can be
  // stale, duplicated, or self-contradictory (e.g. account 302894.001 says EUR while its holdings
  // are stored in USD), so it must never override the currency the values are actually in.
  const holdingsCurrencySet = new Set(
    dummyPositions.filter(p => p.portfolioCurrency).map(p => p.portfolioCurrency)
  );
  portfolioHasMixedCurrencies = holdingsCurrencySet.size > 1;
  // When every holding shares one portfolioCurrency, that currency IS what marketValue is stored in.
  const unanimousHoldingsCurrency = holdingsCurrencySet.size === 1 ? [...holdingsCurrencySet][0] : null;

  // Determine portfolio currency - Priority order:
  // 1. Holdings' portfolioCurrency (the currency marketValue is denominated in) — authoritative
  // 2. The scope's own referenceCurrency (selected account tab, or the account/client/entity
  //    picked in the "View as" filter) — only reachable when there are no holdings to read
  // 3. Most common bank account referenceCurrency
  // 4. Fall back to USD
  //
  // Priority 1 must be checked BEFORE any branching on the current scope: whatever narrows the
  // view — account tab, viewAs account, viewAs client/entity — the numbers rendered are still
  // `marketValue`, so a disagreeing referenceCurrency would only relabel them (that is how a
  // viewAs-account scope on 302894.001 printed USD amounts behind a € sign).
  const mostCommonAccountCurrency = () => {
    if (bankAccounts.length === 0) return null;
    const refCurrencyCounts = bankAccounts.reduce((counts, acc) => {
      const curr = acc.referenceCurrency || 'EUR';
      counts[curr] = (counts[curr] || 0) + 1;
      return counts;
    }, {});
    return Object.keys(refCurrencyCounts).reduce((a, b) =>
      refCurrencyCounts[a] > refCurrencyCounts[b] ? a : b, 'EUR'
    );
  };

  if (unanimousHoldingsCurrency) {
    // Priority 1: the currency the displayed values are actually denominated in.
    portfolioCurrency = unanimousHoldingsCurrency;
  } else if (activeAccountTab !== 'consolidated') {
    // Priority 2: the selected account tab's reference currency.
    const selectedAccount = bankAccounts.find(acc => acc._id === activeAccountTab);
    if (selectedAccount && selectedAccount.referenceCurrency) {
      portfolioCurrency = selectedAccount.referenceCurrency;
    }
  } else if (viewAsFilter && viewAsFilter.type === 'account') {
    // Priority 2: the single account picked in the "View as" filter.
    if (viewAsFilter.data?.referenceCurrency) {
      portfolioCurrency = viewAsFilter.data.referenceCurrency;
    } else {
      portfolioCurrency = mostCommonAccountCurrency() || portfolioCurrency;
    }
  } else if (viewAsFilter && (viewAsFilter.type === 'client' || viewAsFilter.type === 'entity')) {
    // Priority 2: the client's reference currency - the currency of its
    // investment accounts, the client setting only breaking a tie (same rule as
    // the client file), then priority 3.
    const clientCurrency = viewAsFilter.data
      ? getClientReferenceCurrency(viewAsFilter.data, bankAccounts).currency
      : null;
    portfolioCurrency = clientCurrency || mostCommonAccountCurrency() || portfolioCurrency;
  } else {
    // Priority 3: Most common bank account reference currency
    portfolioCurrency = mostCommonAccountCurrency() || portfolioCurrency;
  }

  // No view-as filter and no specific account tab → this is the user's own consolidated
  // view, which should match the home dashboard's Total AUM. Use the logged-in user's
  // preferred display currency (set in My Profile). With a filter active, the priority
  // logic above already resolved the correct portfolio currency, so leave it untouched.
  if (!viewAsFilter && activeAccountTab === 'consolidated' && user?.profile?.preferredCurrency) {
    portfolioCurrency = user.profile.preferredCurrency;
  }

  // The scope's own currency, before any currency picked in the header
  const naturalPortfolioCurrency = portfolioCurrency;
  if (displayCurrencyOverride) {
    // Every value is converted to it at spot (toDisplayCurrency below)
    portfolioCurrency = displayCurrencyOverride;
  }

  // Cross rates for mixed-currency scopes: a holding stores marketValue in its own
  // portfolioCurrency, so any holding whose currency differs from the display
  // currency (e.g. USD sub-account 302894.001 under an EUR client) needs a spot
  // rate before its values can be labeled with `portfolioCurrency`.
  useEffect(() => {
    const needed = new Set();
    for (const p of displayPositionsRaw) {
      if (p.portfolioCurrency && p.portfolioCurrency !== portfolioCurrency) {
        needed.add(`${p.portfolioCurrency}${portfolioCurrency}`);
      }
    }
    const missing = [...needed].filter(pair => !(pair in fxSpotRates));
    if (missing.length === 0) return;
    Meteor.callAsync('currencyCache.getRates', missing.map(p => `${p}.FOREX`))
      .then(result => {
        if (!result?.success || !result.rates) return;
        setFxSpotRates(prev => {
          const next = { ...prev };
          for (const pair of missing) {
            const raw = result.rates[`${pair}.FOREX`];
            const numeric = raw != null && typeof raw === 'object'
              ? Number(raw.rate ?? raw.value ?? raw.price)
              : Number(raw);
            if (Number.isFinite(numeric)) next[pair] = numeric;
          }
          return next;
        });
      })
      .catch(err => console.warn('[PMS] Failed to fetch cross-currency rates:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioCurrency, displayPositionsRaw.map(p => p.portfolioCurrency).join(',')]);

  // Express a holding-level value in the display currency. Falls back to the raw
  // value while the spot rate is still loading (re-renders once it arrives).
  const toDisplayCurrency = (value, holdingCurrency) => {
    if (!value) return value || 0;
    if (!holdingCurrency || holdingCurrency === portfolioCurrency) return value;
    const direct = fxSpotRates[`${holdingCurrency}${portfolioCurrency}`];
    if (direct > 0) return value * direct;
    const inverse = fxSpotRates[`${portfolioCurrency}${holdingCurrency}`];
    if (inverse > 0) return value / inverse;
    return value;
  };

  // All portfolio-currency-denominated fields converted ONCE at the source, so
  // every downstream consumer (cash table, totals, position rows, allocations)
  // shows coherent numbers behind the `portfolioCurrency` label. Original-currency
  // fields (marketValueOriginalCurrency, currency) are untouched.
  const displayPositions = displayPositionsRaw.map(p => {
    if (!p.portfolioCurrency || p.portfolioCurrency === portfolioCurrency) return p;
    // A cash balance already denominated in the display currency needs no FX at
    // all — its original-currency value IS the display value, exactly (a spot
    // round-trip would drift it away from the printed balance).
    const exactOriginal = p.assetClass === 'cash'
      && p.currency === portfolioCurrency
      && Number.isFinite(p.marketValueOriginalCurrency);
    return {
      ...p,
      marketValue: exactOriginal
        ? p.marketValueOriginalCurrency
        : toDisplayCurrency(p.marketValue, p.portfolioCurrency),
      marketValueNoAccruedInterest: exactOriginal
        ? p.marketValueOriginalCurrency
        : (p.marketValueNoAccruedInterest != null
          ? toDisplayCurrency(p.marketValueNoAccruedInterest, p.portfolioCurrency)
          : p.marketValueNoAccruedInterest),
      costBasis: p.costBasis != null ? toDisplayCurrency(p.costBasis, p.portfolioCurrency) : p.costBasis,
      gainLoss: p.gainLoss != null ? toDisplayCurrency(p.gainLoss, p.portfolioCurrency) : p.gainLoss,
      unrealizedPnL: p.unrealizedPnL != null ? toDisplayCurrency(p.unrealizedPnL, p.portfolioCurrency) : p.unrealizedPnL
    };
  });

  // Calculate 4-category allocation for risk profile comparison
  const fourCategoryAllocation = useMemo(() => {
    if (!filteredHoldings || filteredHoldings.length === 0) {
      return { cash: 0, bonds: 0, equities: 0, alternative: 0, total: 0 };
    }

    // Granular breakdown via the shared classifier (assetClassification.js) so
    // this screen, the snapshot builder, the portfolio review and the pre-trade
    // check all bucket a position the same way.
    const { breakdown, totalValue: total } = buildAssetClassBreakdown(filteredHoldings);

    const categories = aggregateToFourCategories(breakdown, total);
    return { ...categories, total };
  }, [filteredHoldings]);

  // Get risk profile for the selected account
  const selectedAccountProfile = useMemo(() => {
    if (activeAccountTab === 'consolidated' || !activeAccountTab) {
      return null;
    }
    return accountProfiles.find(p => p.bankAccountId === activeAccountTab);
  }, [activeAccountTab, accountProfiles]);

  // Calculate asset allocation from filtered holdings (with sub-asset classes)
  React.useEffect(() => {
    if (!filteredHoldings || filteredHoldings.length === 0) {
      setAssetAllocation({ hasData: false });
      return;
    }

    // Group holdings by granular category and calculate totals
    const granularCategoryTotals = {};
    let totalValue = 0;

    filteredHoldings.forEach(holding => {
      const assetClass = holding.assetClass || 'other';
      const assetSubClass = holding.assetSubClass;
      const protectionType = holding.structuredProductProtectionType;
      const underlyingType = holding.structuredProductUnderlyingType;
      const marketValue = holding.marketValue || 0;

      // Build granular category key (same logic as in portfolioSnapshots.js)
      let categoryKey = assetClass;

      if (assetClass === 'structured_product') {
        // Categorize by Underlying Type + Protection Type (e.g., "Equity Linked - 100% Capital Guaranteed")
        const underlying = underlyingType || 'other';
        const protection = protectionType || 'other';
        categoryKey = `structured_product_${underlying}_${protection}`;
      } else if (assetClass === 'equity' && assetSubClass) {
        categoryKey = `equity_${assetSubClass}`;
      } else if (assetClass === 'fixed_income' && assetSubClass) {
        categoryKey = `fixed_income_${assetSubClass}`;
      }
      // For cash, commodities, other: use base class as key

      if (!granularCategoryTotals[categoryKey]) {
        granularCategoryTotals[categoryKey] = 0;
      }
      granularCategoryTotals[categoryKey] += marketValue;
      totalValue += marketValue;
    });

    // Convert to array format for chart
    const assetClasses = Object.entries(granularCategoryTotals).map(([categoryKey, value]) => ({
      name: getGranularCategoryLabel(categoryKey),
      value: value,
      percentage: totalValue > 0 ? (value / totalValue) * 100 : 0
    }));

    // Sort by value descending
    assetClasses.sort((a, b) => b.value - a.value);

    setAssetAllocation({
      hasData: assetClasses.length > 0 && totalValue > 0,
      assetClasses: assetClasses,
      totalValue: totalValue,
      snapshotDate: selectedDate || new Date()
    });
  }, [filteredHoldings, selectedDate]);

  // Calculate hierarchical structured product breakdown for nested chart
  React.useEffect(() => {
    if (!filteredHoldings || filteredHoldings.length === 0) {
      setStructuredProductHierarchy({
        hasData: false,
        level1: [],
        level2: [],
        totalStructuredValue: 0
      });
      return;
    }

    // Filter to structured products only
    const structuredHoldings = filteredHoldings.filter(h => h.assetClass === 'structured_product');

    if (structuredHoldings.length === 0) {
      setStructuredProductHierarchy({
        hasData: false,
        level1: [],
        level2: [],
        totalStructuredValue: 0
      });
      return;
    }

    // Build hierarchical grouping using helper function
    const { level1Totals, level2Totals } = buildHierarchicalStructuredProductBreakdown(structuredHoldings);

    const totalStructuredValue = Object.values(level1Totals).reduce((a, b) => a + b, 0);

    // Convert Level 1 to array format
    const level1Data = Object.entries(level1Totals)
      .map(([type, value]) => ({
        key: type,
        name: getUnderlyingTypeLabel(type),
        value,
        percentage: totalStructuredValue > 0 ? (value / totalStructuredValue) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value);

    // Convert Level 2 to array format with parent reference
    const level2Data = Object.entries(level2Totals)
      .map(([key, data]) => ({
        key,
        name: getProtectionTypeLabelFromMetadata(data.type),
        value: data.value,
        parent: data.parent,
        type: data.type,
        percentage: totalStructuredValue > 0 ? (data.value / totalStructuredValue) * 100 : 0
      }))
      .sort((a, b) => {
        // Sort by parent first (keep together), then by value within parent
        const parentIdxA = level1Data.findIndex(l => l.key === a.parent);
        const parentIdxB = level1Data.findIndex(l => l.key === b.parent);
        if (parentIdxA !== parentIdxB) {
          return parentIdxA - parentIdxB;
        }
        return b.value - a.value;
      });

    setStructuredProductHierarchy({
      hasData: true,
      level1: level1Data,
      level2: level2Data,
      totalStructuredValue
    });
  }, [filteredHoldings]);

  // Calculate currency allocation from filtered holdings
  React.useEffect(() => {
    if (!filteredHoldings || filteredHoldings.length === 0) {
      setCurrencyAllocation({ hasData: false });
      return;
    }

    // Group holdings by currency and calculate totals
    const currencyTotals = {};
    let totalValue = 0;

    filteredHoldings.forEach(holding => {
      const currency = holding.currency || 'UNKNOWN';
      const marketValue = holding.marketValue || 0;

      if (!currencyTotals[currency]) {
        currencyTotals[currency] = 0;
      }
      currencyTotals[currency] += marketValue;
      totalValue += marketValue;
    });

    // Convert to array format for chart
    const currencies = Object.entries(currencyTotals).map(([currency, value]) => ({
      name: currency,
      value: value,
      percentage: totalValue > 0 ? (value / totalValue) * 100 : 0
    }));

    // Sort by value descending
    currencies.sort((a, b) => b.value - a.value);

    setCurrencyAllocation({
      hasData: currencies.length > 0 && totalValue > 0,
      currencies: currencies,
      totalValue: totalValue,
      snapshotDate: selectedDate || new Date()
    });
  }, [filteredHoldings, selectedDate]);

  // Issuer allocation across STRUCTURED PRODUCTS only — proportion of each
  // issuer in the structured-product sub-portfolio by marketValue.
  React.useEffect(() => {
    if (!filteredHoldings || filteredHoldings.length === 0) {
      setIssuerAllocation({ hasData: false });
      return;
    }

    // Normalize issuer names so legal-entity variants collapse:
    //   "BNP Paribas Issuance B.V." → "BNP Paribas"
    //   "Société Générale (undefined)" / "SG Issuer SA" → "Société Générale"
    //   "Banque Internationale à Luxembourg SA" / "BIL (undefined)" → "BIL"
    // Canonical aliases come first; everything else gets generic cleanup.
    const normalizeIssuer = (raw) => {
      if (!raw) return 'Unclassified';
      let s = String(raw).trim();
      if (!s) return 'Unclassified';
      // Drop "(undefined)" markers from incomplete classifications.
      s = s.replace(/\s*\(undefined\)\s*$/i, '').trim();
      if (!s) return 'Unclassified';

      const canonical = [
        { match: /\b(bnp\s*paribas|bnpp)\b/i, name: 'BNP Paribas' },
        { match: /(soci[ée]t[ée]\s*g[ée]n[ée]rale|sg\s+issuer|sg\s+paris|\bsgss\b|^sg\s|^sg$)/i, name: 'Société Générale' },
        { match: /(banque\s+internationale\s+(à|a)\s+luxembourg|\bbil\b)/i, name: 'BIL' },
        { match: /\b(julius\s*baer|baer\s+capital)\b/i, name: 'Julius Baer' },
        { match: /\bbarclays\b/i, name: 'Barclays' },
        { match: /\bvontobel\b/i, name: 'Vontobel' },
        { match: /\bmarex\b/i, name: 'Marex' },
        { match: /\bcredit\s+suisse\b/i, name: 'Credit Suisse' },
        { match: /\bgoldman\s+sachs\b/i, name: 'Goldman Sachs' },
        { match: /\bmorgan\s+stanley\b/i, name: 'Morgan Stanley' },
        { match: /\bj\.?p\.?\s*morgan\b/i, name: 'JP Morgan' },
        { match: /\b(ubs)\b/i, name: 'UBS' },
        { match: /\b(citi(group)?|citibank)\b/i, name: 'Citi' },
        { match: /\bhsbc\b/i, name: 'HSBC' },
        { match: /\bdeutsche\s+bank\b/i, name: 'Deutsche Bank' },
        { match: /\bnatixis\b/i, name: 'Natixis' },
        { match: /\b(unicredit)\b/i, name: 'UniCredit' },
        { match: /\bleonteq\b/i, name: 'Leonteq' }
      ];
      for (const c of canonical) if (c.match.test(s)) return c.name;

      // Generic cleanup of legal-entity suffixes / issuance vehicles.
      s = s.replace(/\s+Issuance(\s+B\.?V\.?)?\b/gi, '').trim();
      s = s.replace(/\s+Issuer\b.*$/i, '').trim();
      s = s.replace(/\s+(S\.?A\.?|N\.?V\.?|B\.?V\.?|A\.?G\.?|GmbH|Ltd|LLC|LLP|Inc|PLC|Corp(oration)?|Holdings?)\b\.?/gi, '').trim();
      return s || 'Unclassified';
    };

    const spHoldings = filteredHoldings.filter(h => h.assetClass === 'structured_product');
    const issuerTotals = {};
    let totalValue = 0;
    for (const h of spHoldings) {
      const name = normalizeIssuer(h.issuer);
      const mv = h.marketValue || 0;
      if (mv === 0) continue;
      issuerTotals[name] = (issuerTotals[name] || 0) + mv;
      totalValue += mv;
    }
    const issuers = Object.entries(issuerTotals).map(([name, value]) => ({
      name,
      value,
      percentage: totalValue > 0 ? (value / totalValue) * 100 : 0
    }));
    issuers.sort((a, b) => b.value - a.value);
    setIssuerAllocation({
      hasData: issuers.length > 0 && totalValue > 0,
      issuers,
      totalValue,
      snapshotDate: selectedDate || new Date()
    });
  }, [filteredHoldings, selectedDate]);

  // Separate cash, FX forwards, and other positions
  // For consolidated view, exclude credit lines and credit cards from cash calculations
  const cashPositions = displayPositions.filter(pos => {
    if (pos.assetClass !== 'cash') return false;
    // In consolidated view, exclude credit lines and credit cards
    if (activeAccountTab === 'consolidated') {
      const account = bankAccounts.find(acc =>
        acc.accountNumber === pos.portfolioCode && acc.bankId === pos.bankId
      );
      if (account?.comment === 'Credit line' || account?.comment === 'Credit card') {
        return false;
      }
    }
    return true;
  });
  const fxForwardPositions = displayPositions.filter(pos => pos.assetClass === 'fx_forward');
  const nonCashPositions = displayPositions.filter(pos => pos.assetClass !== 'cash' && pos.assetClass !== 'fx_forward');

  // Group FX forward legs by deal (ticker = e.g. "FX0335795") so each forward
  // shows as a single row with both currency legs side-by-side.
  const fxForwardDeals = (() => {
    const groups = new Map();
    for (const leg of fxForwardPositions) {
      const dealId = leg.ticker || leg.id;
      if (!groups.has(dealId)) groups.set(dealId, []);
      groups.get(dealId).push(leg);
    }
    return Array.from(groups, ([dealId, legs]) => {
      const totalPortfolioValue = legs.reduce((s, l) => s + (l.marketValue || 0), 0);
      const dealSign = totalPortfolioValue >= 0 ? 1 : -1;
      // Identify foreign vs base leg explicitly via fxLeg (set by the CFM POES
      // parser fix). Fall back to "any leg with a notional" for older imports.
      const foreignLeg = legs.find(l => l.fxLeg === 'foreign') || null;
      const baseLeg = legs.find(l => l.fxLeg === 'base') || null;
      const legWithNotional = foreignLeg || legs.find(l => l.fxNotional?.foreignAmount) || legs[0] || {};
      const legWithDates = legs.find(l => l.tradeDate || l.valueDate) || legs[0] || {};
      const fNotional = foreignLeg?.fxNotional || legWithNotional.fxNotional || null;

      // Identify the TRUE foreign vs base leg from POES, independently of
      // whatever the operation columns (or legacy enrichment) labelled. CFM
      // POES convention: the foreign leg carries the deal's mark-to-market
      // (non-zero BALANCE_POSITION / BALANCE_PERF), the base leg's BALANCE_*
      // is zero. After the new POES parser fix, the base leg has zero
      // marketValue. Under the LEGACY (buggy) parser, the base leg's
      // marketValue was stamped to CAT_DETAIL (orders of magnitude larger
      // than the true MTM). In both cases the LEGITIMATE foreign leg has the
      // SMALLER non-zero |marketValueOriginalCurrency|.
      const mtmCandidates = legs.filter(l => Math.abs(l.marketValueOriginalCurrency || 0) > 0);
      const trueForeignLeg = foreignLeg
        || (mtmCandidates.length > 0
            ? mtmCandidates.reduce((min, l) =>
                Math.abs(l.marketValueOriginalCurrency) < Math.abs(min.marketValueOriginalCurrency) ? l : min)
            : legs[0]);
      const trueBaseLeg = baseLeg
        || legs.find(l => l !== trueForeignLeg)
        || null;

      // Direction sign comes from the TRUE foreign leg's MTM sign — POES
      // stores it consistently with CAT_DETAIL (positive = bought foreign).
      const directionSign = trueForeignLeg
        ? ((trueForeignLeg.marketValueOriginalCurrency
            || trueForeignLeg.quantity
            || trueForeignLeg.marketValue
            || 0) >= 0 ? 1 : -1)
        : 1;

      // Override foreignCurrency/baseCurrency from the actual leg currencies
      // (POES truth), overriding any mislabel from the operation columns.
      const trueForeignCurrency = trueForeignLeg?.currency || fNotional?.foreignCurrency || null;
      const trueBaseCurrency = trueBaseLeg?.currency
        || (fNotional?.baseCurrency && fNotional.baseCurrency !== trueForeignCurrency
            ? fNotional.baseCurrency : null);

      // Foreign notional: PRIMARILY from POES CAT_DETAIL on the true foreign
      // leg (signed, authoritative — this is what CFM reports as the deal
      // size on the bank statement). Falls back to the legacy MFRX-derived
      // foreignAmount only if CAT_DETAIL isn't available.
      const poesCatDetail = trueForeignLeg?.catDetail != null
        ? trueForeignLeg.catDetail
        : null;
      const rawForeignAmt = poesCatDetail != null ? poesCatDetail : fNotional?.foreignAmount;
      const signedForeignAmount = rawForeignAmt != null
        ? directionSign * Math.abs(rawForeignAmt)
        : null;

      // Base notional: prefer fNotional.baseAmount when its labelling matches
      // ours; otherwise leave null and let the renderer derive it from the
      // entry rate (foreignAmount / fxRate) or today's spot.
      const enrichmentBaseMatchesUs = fNotional?.baseCurrency === trueBaseCurrency;
      const rawBaseAmt = enrichmentBaseMatchesUs ? fNotional?.baseAmount : null;
      const signedBaseAmount = rawBaseAmt != null
        ? -directionSign * Math.abs(rawBaseAmt)
        : null;

      const notional = fNotional ? {
        foreignAmount: signedForeignAmount,
        foreignCurrency: trueForeignCurrency,
        baseAmount: signedBaseAmount,
        baseCurrency: trueBaseCurrency,
        fxRate: fNotional.fxRate ?? null
      } : null;
      // P&L (unrealized) for the deal = the foreign leg's marketValue, which
      // is BALANCE_PERF from POES — the EUR-equivalent of the deal's current
      // MTM. For an FX forward (zero-value at trade), this is effectively the
      // unrealized P&L. Avoids the rate-convention pitfalls (CFM always quotes
      // fxRate as "ILS per other", but operation columns mis-label foreign vs
      // base for USD-paired deals).
      //
      // Leg-selection rules (in priority order):
      //   1) Holding with `fxLeg === 'foreign'` (set by the new POES parser
      //      fix — always authoritative when present).
      //   2) Fallback: smallest-absolute non-zero marketValue among legs.
      //      The MTM (BALANCE_PERF) is many orders of magnitude smaller than
      //      the notional, so this picks the legitimate foreign leg even
      //      when the legacy-corrupted base leg also has a non-zero
      //      marketValue stamped to CAT_DETAIL.
      let mtmLeg = foreignLeg;
      if (!mtmLeg) {
        const candidates = legs.filter(l => (l.marketValue || 0) !== 0);
        mtmLeg = candidates.length > 0
          ? candidates.reduce((min, l) => Math.abs(l.marketValue) < Math.abs(min.marketValue) ? l : min)
          : (legs[0] || null);
      }
      const mtmPortfolio = mtmLeg ? (mtmLeg.marketValue || 0) : 0;
      return {
        dealId,
        sign: dealSign,
        tradeDate: legWithDates.tradeDate || null,
        valueDate: legWithDates.valueDate || null,
        portfolioCode: legWithNotional.portfolioCode || legs[0]?.portfolioCode || null,
        accountNumber: legWithNotional.accountNumber || legs[0]?.accountNumber || null,
        totalPortfolioValue,
        mtmPortfolio,
        notional,
        foreignLeg,
        baseLeg,
        legs
      };
    });
  })();

  // Derive FX deal lifecycles from PMS operations
  //
  // CFM emits one FX_TRADE operation per currency *leg*; the operationNumber is
  // "FX0335795.001" / "FX0335795.002" — same base deal id, different leg suffix.
  // For lifecycle pairing we want one canonical record per *deal* (open or close
  // or roll), so we collapse leg-suffix duplicates and pick the foreign-currency
  // leg (the one that carries notional+fxRate; `operationCurrency` differs from
  // `settlementCurrency`).
  //
  // After collapsing, we pair an opening deal D1 with a closing deal D2 when:
  //   - same portfolioCode + currency pair
  //   - foreignAmount signs cancel (opposite directions)
  //   - magnitudes within tolerance (absorb swap-point accruals)
  // A swap roll = on the same trade date, a close+open pair on the same pair
  // and magnitude → that 3rd-trade pattern the user described.
  const fxDealLifecyclesRaw = (() => {
    const fxOps = (operations || []).filter(op =>
      op.type === 'FX_TRADE' && op.operationNumber
    );
    if (fxOps.length === 0) return [];

    // Collapse by base deal id, pick the foreign-leg row (has fxRate + currency mismatch)
    const baseDealId = (opNumber) => (opNumber || '').split('.')[0];
    const dealMap = new Map(); // baseId -> chosen op row
    for (const op of fxOps) {
      const id = baseDealId(op.operationNumber);
      if (!id) continue;
      const prev = dealMap.get(id);
      const isForeignLeg =
        op.operationCurrency && op.settlementCurrency
        && op.operationCurrency !== op.settlementCurrency
        && op.fxRate;
      if (!prev || (isForeignLeg && !(
        prev.operationCurrency && prev.settlementCurrency
        && prev.operationCurrency !== prev.settlementCurrency
        && prev.fxRate
      ))) {
        dealMap.set(id, op);
      }
    }

    // Canonicalize: one deal record per group, with signed foreign amount.
    // direction: ACHAT (buy foreign) → positive foreign; VENTE (sell) → negative.
    const deals = [];
    for (const [id, op] of dealMap.entries()) {
      const dir = (op.direction || '').toUpperCase();
      const sign = dir.includes('VENTE') || dir.includes('SELL') ? -1 : 1;
      const foreignAmount = Math.abs(op.amount || 0) * sign;
      const foreignCurrency = op.operationCurrency || null;
      const baseCurrency = op.settlementCurrency || op.baseCurrency || null;
      const fxRate = op.fxRate || null;
      const baseAmount = fxRate ? -foreignAmount / fxRate : null; // base side is opposite
      const tradeTime = op.date ? new Date(op.date).getTime() : 0;
      deals.push({
        dealId: id,
        tradeDate: op.date || null,
        tradeTime,
        valueDate: op.valueDate || null,
        portfolioCode: op.portfolioCode || null,
        foreignCurrency,
        foreignAmount,
        baseCurrency,
        baseAmount,
        fxRate,
        rawOp: op
      });
    }
    deals.sort((a, b) => a.tradeTime - b.tradeTime);

    // Pair opens with closes within (portfolioCode, currency pair).
    // currency pair is order-insensitive: ILS/EUR == EUR/ILS.
    const pairKey = (d) => {
      const ccys = [d.foreignCurrency || '?', d.baseCurrency || '?'].sort().join('|');
      return `${d.portfolioCode || '?'}|${ccys}`;
    };
    const byPair = new Map();
    for (const d of deals) {
      const k = pairKey(d);
      if (!byPair.has(k)) byPair.set(k, []);
      byPair.get(k).push(d);
    }

    // Greedy pair matcher: for each list (already chronological), walk forward
    // and pair each unmatched deal D with the earliest later deal D' whose
    // foreignAmount magnitude matches and sign is opposite.
    const isOffsetting = (d1, d2) => {
      if (Math.sign(d1.foreignAmount) === Math.sign(d2.foreignAmount)) return false;
      const a = Math.abs(d1.foreignAmount);
      const b = Math.abs(d2.foreignAmount);
      const tol = Math.max(1, 0.0001 * Math.max(a, b)); // 1 unit or 1bp of notional
      return Math.abs(a - b) <= tol;
    };

    // closeOf[dealId] = dealId of the close trade (if any)
    const closeOf = new Map();
    const closeOfBy = new Map(); // reverse: closeId -> openId
    for (const list of byPair.values()) {
      const available = list.map((d, i) => ({ d, i, used: false }));
      for (let i = 0; i < available.length; i++) {
        if (available[i].used) continue;
        const d1 = available[i].d;
        for (let j = i + 1; j < available.length; j++) {
          if (available[j].used) continue;
          const d2 = available[j].d;
          if (isOffsetting(d1, d2)) {
            closeOf.set(d1.dealId, d2.dealId);
            closeOfBy.set(d2.dealId, d1.dealId);
            available[i].used = true;
            available[j].used = true;
            break;
          }
        }
      }
    }

    // Detect swap rolls: a closing deal C and an opening deal O on the SAME
    // trade date, same pair, same magnitude but C is offsetting (already paired
    // to a prior open) — O extends the position with a later maturity. We mark
    // (C, O) as a roll pair.
    const dealById = new Map(deals.map(d => [d.dealId, d]));
    const rollPartner = new Map(); // closeId -> openId (same-date roll)
    for (const [closeId, openId] of closeOfBy.entries()) {
      const closeD = dealById.get(closeId);
      const originalOpen = dealById.get(openId);
      if (!closeD || !originalOpen) continue;
      // Look for an opening deal O on the same date as closeD, in the same pair,
      // with magnitude ≈ |closeD.foreignAmount|, that is NOT itself paired as a
      // close (it stays open or is closed in the future).
      const sameDate = (a, b) => {
        if (!a || !b) return false;
        const da = new Date(a); const db = new Date(b);
        return da.getFullYear() === db.getFullYear()
          && da.getMonth() === db.getMonth()
          && da.getDate() === db.getDate();
      };
      const k = pairKey(closeD);
      for (const candidate of (byPair.get(k) || [])) {
        if (candidate.dealId === closeId) continue;
        if (!sameDate(candidate.tradeDate, closeD.tradeDate)) continue;
        if (closeOfBy.has(candidate.dealId)) continue; // candidate is itself a close
        if (Math.sign(candidate.foreignAmount) !== Math.sign(originalOpen.foreignAmount)) continue;
        const mag = Math.abs(candidate.foreignAmount);
        const ref = Math.abs(closeD.foreignAmount);
        const tol = Math.max(1, 0.0005 * Math.max(mag, ref)); // a bit looser: 5bp for swap pts
        if (Math.abs(mag - ref) <= tol) {
          rollPartner.set(closeId, candidate.dealId);
          break;
        }
      }
    }

    // Build lifecycles: starting from each "open" deal (one that is NOT a close
    // of another deal), walk forward through rolls until we reach a final close
    // (or the chain ends at an unclosed open).
    const lifecycles = [];
    const consumed = new Set();
    for (const d of deals) {
      if (consumed.has(d.dealId)) continue;
      if (closeOfBy.has(d.dealId)) continue; // skip closes — they're attached to opens
      // Skip openings reached via roll (they'll be picked up walking from the parent)
      // We detect those as: there exists some close C where rollPartner(C) === d.dealId
      const reachedByRoll = [...rollPartner.values()].includes(d.dealId);
      if (reachedByRoll) continue;

      const legs = [];
      let current = d;
      let realizedBase = 0;
      while (current) {
        legs.push({ ...current, role: legs.length === 0 ? 'open' : 'roll-open' });
        consumed.add(current.dealId);
        const closeId = closeOf.get(current.dealId);
        if (!closeId) break;
        const closeD = dealById.get(closeId);
        if (!closeD) break;
        const rollOpenId = rollPartner.get(closeId);
        if (rollOpenId) {
          // Roll: close + new open on the same date, contributes realized P&L
          legs.push({ ...closeD, role: 'roll-close' });
          consumed.add(closeD.dealId);
          // realized P&L (base currency) on this roll segment:
          // (closeRate - openRate) × openForeignAmount, sign-aware.
          if (current.fxRate && closeD.fxRate && current.foreignAmount) {
            const openBase = current.foreignAmount / current.fxRate;
            const closeBase = -current.foreignAmount / closeD.fxRate;
            realizedBase += openBase + closeBase;
          }
          const nextOpen = dealById.get(rollOpenId);
          if (!nextOpen) break;
          current = nextOpen;
        } else {
          // Final close
          legs.push({ ...closeD, role: 'close' });
          consumed.add(closeD.dealId);
          if (current.fxRate && closeD.fxRate && current.foreignAmount) {
            const openBase = current.foreignAmount / current.fxRate;
            const closeBase = -current.foreignAmount / closeD.fxRate;
            realizedBase += openBase + closeBase;
          }
          current = null;
          break;
        }
      }

      // Determine status: closed = chain ended with 'close' leg; rolled = ≥1
      // roll segment; open = no close at all.
      const hasClose = legs.some(l => l.role === 'close');
      const hasRoll = legs.some(l => l.role === 'roll-open' || l.role === 'roll-close');
      const status = hasClose ? 'closed' : (hasRoll ? 'rolled' : 'open');
      const currentLeg = legs.filter(l => l.role === 'open' || l.role === 'roll-open').pop() || legs[0];

      // Unrealized P&L for open/rolled lifecycles: mark the current open leg to
      // today's spot rate.
      //   - CFM operation fxRate convention: foreign-per-base (e.g. 3.7050 ILS/EUR)
      //   - EOD spot ticker `${foreign}${base}.FOREX` convention: base-per-foreign
      //     (e.g. ILSEUR.FOREX = 0.2949 EUR per ILS)
      //   So entry value (in base) = foreignAmount / fxRate
      //      mark  value (in base) = foreignAmount * spot
      //   P&L (gain when mark > entry) = mark - entry
      let unrealizedBase = null;
      if (status !== 'closed' && currentLeg && currentLeg.fxRate
          && currentLeg.foreignCurrency && currentLeg.baseCurrency) {
        const spotKey = `${currentLeg.foreignCurrency}${currentLeg.baseCurrency}`;
        const spot = fxSpotRates[spotKey];
        if (spot && spot > 0) {
          const entryBase = currentLeg.foreignAmount / currentLeg.fxRate;
          const markBase  = currentLeg.foreignAmount * spot;
          unrealizedBase  = markBase - entryBase;
        }
      }

      // Per-lifecycle P&L is computed here in baseCurrency only. Conversion to
      // the displayed portfolioCurrency happens after `portfolioCurrency` is
      // resolved further down in the component body — see fxDealLifecycles
      // (augmented) just below the portfolioCurrency declaration.
      const baseCcy = currentLeg?.baseCurrency || legs[0]?.baseCurrency || null;
      const realizedBaseValue = hasClose || hasRoll ? realizedBase : null;

      lifecycles.push({
        lifecycleId: legs[0].dealId,
        status,
        legs,
        currentLeg,
        firstLeg: legs[0],
        realizedPnLBase: realizedBaseValue,
        unrealizedPnLBase: unrealizedBase,
        baseCurrency: baseCcy,
        portfolioCode: legs[0].portfolioCode
      });
    }
    return lifecycles;
  })();

  // Spot-rate fetch + portfolio-currency augmentation of fxDealLifecyclesRaw
  // both live after `portfolioCurrency` is declared (search for "Spot rates for FX deal lifecycles" below).

  // Group FX forwards by currency
  const fxForwardsByCurrency = fxForwardPositions.reduce((acc, pos) => {
    const curr = pos.currency || 'UNKNOWN';
    if (!acc[curr]) {
      acc[curr] = {
        currency: curr,
        totalValue: 0,
        totalPortfolioValue: 0,
        positions: []
      };
    }
    acc[curr].totalValue += (pos.marketValueOriginalCurrency || pos.marketValue || 0);
    acc[curr].totalPortfolioValue += (pos.marketValueNoAccruedInterest || pos.marketValue || 0);
    acc[curr].positions.push(pos);
    return acc;
  }, {});

  // Calculate total FX forwards in portfolio currency
  const totalFxForwardPortfolioValue = Object.values(fxForwardsByCurrency).reduce((sum, fx) => sum + fx.totalPortfolioValue, 0);

  // Group cash by currency
  // Note: Show actual values including negatives (credit line usage) for display
  // The overall portfolio total caps negatives at 0 separately
  const cashByCurrency = cashPositions.reduce((acc, pos) => {
    const curr = pos.currency || 'UNKNOWN';
    if (!acc[curr]) {
      acc[curr] = {
        currency: curr,
        totalValue: 0,
        totalPortfolioValue: 0,
        positions: []
      };
    }
    // Balance uses original currency (POS_MKT_VAL), portfolio value uses EUR (PTF_MKT_VAL)
    const originalValue = pos.marketValueOriginalCurrency || pos.marketValue || 0;
    const portfolioValue = pos.marketValueNoAccruedInterest || pos.marketValue || 0;
    // Show actual values including negatives (credit line utilization visible)
    acc[curr].totalValue += originalValue;
    acc[curr].totalPortfolioValue += portfolioValue;
    acc[curr].positions.push(pos);
    return acc;
  }, {});

  // Calculate total cash in portfolio currency for display (includes negatives)
  const totalCashPortfolioValue = Object.values(cashByCurrency).reduce((sum, cash) => sum + cash.totalPortfolioValue, 0);

  // Filter non-cash positions
  const filteredPositions = nonCashPositions.filter(pos => {
    if (filterAssetClass !== 'all' && pos.assetClass !== filterAssetClass) return false;
    return true;
  });

  // Sort positions
  const sortedPositions = [...filteredPositions].sort((a, b) => {
    let aValue = a[sortBy];
    let bValue = b[sortBy];

    if (sortBy === 'ticker' || sortBy === 'name') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
      return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    }

    return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
  });

  // Calculate portfolio values for non-cash positions (using PTF_MKT_VAL for portfolio currency)
  const totalNonCashPortfolioValue = nonCashPositions.reduce((sum, pos) => sum + (pos.marketValue || 0), 0);
  const totalCostBasis = nonCashPositions.reduce((sum, pos) => sum + (pos.costBasis || 0), 0);
  const totalNonCashGainLoss = totalNonCashPortfolioValue - totalCostBasis;
  const totalGainLossPercent = totalCostBasis > 0 ? ((totalNonCashGainLoss / totalCostBasis) * 100) : 0;

  // Calculate total cash from all currencies (using PTF_MKT_VAL for portfolio currency).
  // Negative cash is NETTED, exactly as on the bank statement: a debit balance
  // (e.g. purchases booked before their value date, an overdraft) reduces the
  // total. Credit-line / card / spending accounts are excluded at ACCOUNT level
  // (bankAccounts.comment) by the AUM code, so no cash floor is needed here —
  // flooring at 0 showed a 1.9M portfolio that was really 1.5M once the −0.4M
  // pending settlement debit was counted, and put the headline on a different
  // basis from the snapshots used for the day change (fake +26.67%).
  const totalCashValue = cashPositions.reduce((sum, pos) => sum + (pos.marketValue || 0), 0);

  // Total portfolio value = instruments + deposits (non-cash) + net cash + the
  // mark-to-market value of FX forwards. All figures are in portfolio currency
  // (PTF_MKT_VAL). This matches portfolioSnapshots.totalAccountValue.
  const totalPortfolioValue = totalNonCashPortfolioValue + totalCashValue + totalFxForwardPortfolioValue;
  const totalGainLoss = totalNonCashGainLoss; // Gain/loss only applies to non-cash positions

  // NOTE: portfolioCurrency is resolved much earlier (right after displayPositionsRaw),
  // because position values are converted into the display currency at the source —
  // see the "Determine portfolio reference currency" block above the position splits.

  // One-day variation of the headline total, in currency. Resolved server-side
  // against each portfolio's OWN previous valuation date, so a Monday compares
  // against Friday and a bank whose file hasn't landed drops out of the
  // comparison rather than reading as a crash.
  const [dayVariation, setDayVariation] = useState(null);

  // The portfolios actually on screen, so the comparison matches the figure.
  const variationKeys = useMemo(() => {
    const seen = new Set();
    const keys = [];
    for (const pos of displayPositionsRaw) {
      if (!pos.bankId || !pos.portfolioCode || pos.portfolioCode === 'CONSOLIDATED') continue;
      const k = `${pos.bankId}|${pos.portfolioCode}`;
      if (seen.has(k)) continue;
      seen.add(k);
      keys.push({ bankId: pos.bankId, portfolioCode: pos.portfolioCode });
    }
    return keys;
  }, [displayPositionsRaw]);

  const variationKeysSignature = variationKeys.map(k => `${k.bankId}|${k.portfolioCode}`).sort().join(',');

  useEffect(() => {
    let cancelled = false;
    // Holdings stream in batch by batch, so the key set churns while the
    // subscription settles. Firing per batch queued dozens of copies of a
    // multi-second query against each other and nothing ever landed — wait for
    // the data to be ready, then debounce the last change.
    if (isLoading || !variationKeys.length || !portfolioCurrency) { setDayVariation(null); return; }
    const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
    if (!sessionId) { setDayVariation(null); return; }

    const timer = setTimeout(() => {
      Meteor.callAsync('pms.getDayVariation', {
        sessionId,
        portfolioKeys: variationKeys,
        currency: portfolioCurrency,
        asOfDate: selectedDate ? new Date(selectedDate) : null
      })
        .then(result => { if (!cancelled) setDayVariation(result || null); })
        .catch(err => {
          // A missing comparison is not worth an error surface - just show nothing.
          console.error('[PMS] Day variation unavailable:', err);
          if (!cancelled) setDayVariation(null);
        });
    }, 600);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [isLoading, variationKeysSignature, portfolioCurrency, selectedDate, refreshKey]);

  // Spot rates for FX deal lifecycles: fetch (a) foreign→base for mark-to-market
  // on every open leg and (b) base→portfolioCurrency to express per-row P&L in
  // the displayed currency. Both depend on `portfolioCurrency`, so this effect
  // is declared after the portfolio currency is resolved.
  useEffect(() => {
    const pairs = new Set();
    for (const lc of fxDealLifecyclesRaw) {
      if (lc.status !== 'closed') {
        const f = lc.currentLeg?.foreignCurrency;
        const b = lc.currentLeg?.baseCurrency;
        if (f && b && f !== b) pairs.add(`${f}${b}`);
      }
      const base = lc.baseCurrency;
      if (base && portfolioCurrency && base !== portfolioCurrency) {
        pairs.add(`${base}${portfolioCurrency}`);
      }
    }
    // Also fetch the POES-derived (foreign,base) pairs for each FX-forward
    // holding. POES is authoritative for the deal's actual currency pair —
    // operation columns can mis-label USD-paired deals, so the lifecycle pairs
    // alone aren't enough.
    for (const deal of fxForwardDeals) {
      const f = deal?.notional?.foreignCurrency;
      const b = deal?.notional?.baseCurrency;
      if (f && b && f !== b) pairs.add(`${f}${b}`);
      if (b && portfolioCurrency && b !== portfolioCurrency) {
        pairs.add(`${b}${portfolioCurrency}`);
      }
    }
    const missing = [...pairs].filter(p => !(p in fxSpotRates));
    if (missing.length === 0) return;
    const forexKeys = missing.map(p => `${p}.FOREX`);
    Meteor.callAsync('currencyCache.getRates', forexKeys)
      .then(result => {
        if (!result?.success || !result.rates) return;
        const next = { ...fxSpotRates };
        for (const fk of forexKeys) {
          const raw = result.rates[fk];
          const numeric = raw != null && typeof raw === 'object'
            ? Number(raw.rate ?? raw.value ?? raw.price)
            : Number(raw);
          if (Number.isFinite(numeric)) {
            next[fk.replace('.FOREX', '')] = numeric;
          }
        }
        setFxSpotRates(next);
      })
      .catch(err => console.warn('[PMS] Failed to fetch FX spot rates:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fxDealLifecyclesRaw.map(l => `${l.currentLeg?.foreignCurrency}${l.currentLeg?.baseCurrency}|${l.baseCurrency}`).join(','),
    fxForwardDeals.map(d => `${d?.notional?.foreignCurrency}${d?.notional?.baseCurrency}`).join(','),
    portfolioCurrency
  ]);

  // Augment each lifecycle with realized/unrealized P&L already converted to the
  // displayed portfolioCurrency, so per-row cells and totals are coherent across
  // EUR-, ILS-, and USD-base deals.
  const fxDealLifecycles = fxDealLifecyclesRaw.map(lc => {
    const baseCcy = lc.baseCurrency;
    const toPortfolio = (amountBase) => {
      if (amountBase == null || !baseCcy || !portfolioCurrency) return null;
      if (baseCcy === portfolioCurrency) return amountBase;
      // EOD ticker `${baseCcy}${portfolioCurrency}.FOREX` is portfolio-per-base.
      const conv = fxSpotRates[`${baseCcy}${portfolioCurrency}`];
      return conv && conv > 0 ? amountBase * conv : null;
    };
    const realizedPortfolio = toPortfolio(lc.realizedPnLBase);
    const unrealizedPortfolio = toPortfolio(lc.unrealizedPnLBase);
    const pnLPortfolio = realizedPortfolio == null && unrealizedPortfolio == null
      ? null
      : (realizedPortfolio || 0) + (unrealizedPortfolio || 0);
    return { ...lc, realizedPnLPortfolio: realizedPortfolio, unrealizedPnLPortfolio: unrealizedPortfolio, pnLPortfolio };
  });

  // Check if portfolio has mixed instrument currencies
  const instrumentCurrencyCounts = dummyPositions.reduce((counts, p) => {
    counts[p.currency] = (counts[p.currency] || 0) + 1;
    return counts;
  }, {});
  portfolioHasMixedCurrencies = Object.keys(instrumentCurrencyCounts).length > 1;

  // Get unique asset classes for filters (exclude Cash)
  const assetClasses = [...new Set(nonCashPositions.map(p => p.assetClass))];

  // Group positions by asset class, then by sub-classifications
  const groupedPositions = sortedPositions.reduce((groups, position) => {
    const assetClass = position.assetClass;
    if (!groups[assetClass]) {
      groups[assetClass] = {
        positions: [],
        subGroups: {}
      };
    }

    // For structured products, group by underlying type -> protection type (two-level hierarchy)
    if (assetClass === 'structured_product') {
      const underlyingType = position.structuredProductUnderlyingType || 'other';
      const protectionType = position.structuredProductProtectionType || 'other';

      // Initialize level 1 (underlying type) if needed
      if (!groups[assetClass].subGroups[underlyingType]) {
        groups[assetClass].subGroups[underlyingType] = {
          positions: [],
          subGroups: {}
        };
      }

      // Initialize level 2 (protection type) and add position
      if (!groups[assetClass].subGroups[underlyingType].subGroups[protectionType]) {
        groups[assetClass].subGroups[underlyingType].subGroups[protectionType] = [];
      }
      groups[assetClass].subGroups[underlyingType].subGroups[protectionType].push(position);
    }
    // For equity and fixed income, group by sub-class (direct vs funds)
    else if (assetClass === 'equity' || assetClass === 'fixed_income') {
      const subClass = position.assetSubClass || (assetClass === 'equity' ? 'Common Stock' : 'Direct');
      if (!groups[assetClass].subGroups[subClass]) {
        groups[assetClass].subGroups[subClass] = [];
      }
      groups[assetClass].subGroups[subClass].push(position);
    }
    // For other asset classes, no sub-grouping
    else {
      groups[assetClass].positions.push(position);
    }

    return groups;
  }, {});

  // Sort positions alphabetically by name within each leaf group
  const sortByName = (a, b) => (a.name || '').localeCompare(b.name || '');
  Object.values(groupedPositions).forEach(group => {
    group.positions.sort(sortByName);
    Object.values(group.subGroups).forEach(subGroup => {
      if (Array.isArray(subGroup)) {
        // Simple structure (equity/fixed_income subClass)
        subGroup.sort(sortByName);
      } else {
        // Nested structure (structured products: underlyingType -> protectionType)
        subGroup.positions?.sort(sortByName);
        Object.values(subGroup.subGroups || {}).forEach(level2Positions => {
          if (Array.isArray(level2Positions)) level2Positions.sort(sortByName);
        });
      }
    });
  });

  // Helper function to calculate totals for a list of positions
  const calculatePositionsTotals = (positions) => {
    const marketValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    const costBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
    const gainLoss = marketValue - costBasis;
    const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
    const percentage = totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : 0;

    const currencyCounts = positions.reduce((counts, p) => {
      counts[p.currency] = (counts[p.currency] || 0) + 1;
      return counts;
    }, {});
    const dominantCurrency = Object.keys(currencyCounts).length > 0
      ? Object.keys(currencyCounts).reduce((a, b) => currencyCounts[a] > currencyCounts[b] ? a : b, 'USD')
      : 'USD';

    return {
      marketValue,
      costBasis,
      gainLoss,
      gainLossPercent,
      percentage,
      count: positions.length,
      currency: dominantCurrency,
      hasMixedCurrencies: Object.keys(currencyCounts).length > 1
    };
  };

  // Calculate subtotals for each asset class and sub-asset class
  const assetClassSubtotals = Object.keys(groupedPositions).reduce((totals, assetClass) => {
    const group = groupedPositions[assetClass];

    // Collect all positions from all sub-groups (handling nested structure for structured products)
    let allPositions = [...group.positions];

    if (assetClass === 'structured_product') {
      // Nested structure: subGroups[underlyingType].subGroups[protectionType] = [positions]
      Object.values(group.subGroups).forEach(level1Group => {
        allPositions = allPositions.concat(level1Group.positions || []);
        Object.values(level1Group.subGroups || {}).forEach(level2Positions => {
          allPositions = allPositions.concat(level2Positions);
        });
      });
    } else {
      // Simple structure: subGroups[subClass] = [positions]
      allPositions = allPositions.concat(Object.values(group.subGroups).flat());
    }

    totals[assetClass] = calculatePositionsTotals(allPositions);

    // Calculate subtotals for sub-asset classes
    if (Object.keys(group.subGroups).length > 0) {
      if (assetClass === 'structured_product') {
        // Nested subtotals for structured products (level 1: underlying type)
        totals[assetClass].subTotals = Object.keys(group.subGroups).reduce((subTotals, underlyingType) => {
          const level1Group = group.subGroups[underlyingType];

          // Collect all positions in this underlying type
          let level1Positions = [...(level1Group.positions || [])];
          Object.values(level1Group.subGroups || {}).forEach(level2Positions => {
            level1Positions = level1Positions.concat(level2Positions);
          });

          subTotals[underlyingType] = calculatePositionsTotals(level1Positions);

          // Calculate level 2 subtotals (protection type)
          if (Object.keys(level1Group.subGroups || {}).length > 0) {
            subTotals[underlyingType].subTotals = Object.keys(level1Group.subGroups).reduce((level2Totals, protectionType) => {
              const level2Positions = level1Group.subGroups[protectionType];
              level2Totals[protectionType] = calculatePositionsTotals(level2Positions);
              return level2Totals;
            }, {});
          }

          return subTotals;
        }, {});
      } else {
        // Simple subtotals for other asset classes
        totals[assetClass].subTotals = Object.keys(group.subGroups).reduce((subTotals, subClass) => {
          const subPositions = group.subGroups[subClass];
          subTotals[subClass] = calculatePositionsTotals(subPositions);
          return subTotals;
        }, {});
      }
    }

    return totals;
  }, {});

  // Initialize all sections as collapsed on first load
  const initializeExpandedSections = () => {
    const initial = {};
    Object.keys(groupedPositions).forEach(assetClass => {
      if (!(assetClass in expandedSections)) {
        initial[assetClass] = false; // Start collapsed
      }

      // Also initialize sub-asset class sections
      const group = groupedPositions[assetClass];
      if (group.subGroups && Object.keys(group.subGroups).length > 0) {
        Object.keys(group.subGroups).forEach(subClass => {
          const subSectionKey = `${assetClass}_${subClass}`;
          if (!(subSectionKey in expandedSections)) {
            initial[subSectionKey] = false; // Start collapsed
          }

          // For structured products, also initialize level 2 (protection type) sections
          if (assetClass === 'structured_product') {
            const level1Group = group.subGroups[subClass];
            if (level1Group.subGroups && Object.keys(level1Group.subGroups).length > 0) {
              Object.keys(level1Group.subGroups).forEach(protectionType => {
                const level2Key = `${assetClass}_${subClass}_${protectionType}`;
                if (!(level2Key in expandedSections)) {
                  initial[level2Key] = false; // Start collapsed
                }
              });
            }
          }
        });
      }
    });
    if (Object.keys(initial).length > 0) {
      const merged = { ...expandedSections, ...initial };
      setExpandedSections(merged);
      try { localStorage.setItem('pms_expandedSections', JSON.stringify(merged)); } catch {}
    }
  };

  // Initialize when groupedPositions changes (data loads)
  React.useEffect(() => {
    if (Object.keys(groupedPositions).length > 0) {
      initializeExpandedSections();
    }
  }, [Object.keys(groupedPositions).join(',')]);

  // Export holdings to Excel
  const exportToExcel = async () => {
    // Combine all holdings (cash + non-cash sorted positions) for export
    const allHoldings = [...cashPositions, ...sortedPositions];

    // Per-booking-portfolio totals (sum of marketValue grouped by portfolioCode + currency).
    // marketValue is already in the holding's portfolioCurrency; within one portfolioCode
    // all holdings share one portfolioCurrency, so this sum is currency-consistent.
    const portfolioTotals = allHoldings.reduce((acc, h) => {
      const code = h.portfolioCode || '';
      const ccy = h.portfolioCurrency || portfolioCurrency || '';
      const key = `${code}|${ccy}`;
      acc[key] = (acc[key] || 0) + (h.marketValue || 0);
      return acc;
    }, {});

    const productIds = [...new Set(
      allHoldings.map(h => h.linkedProductId).filter(Boolean)
    )];

    let enrichmentByProductId = {};
    if (productIds.length > 0) {
      try {
        const sessionId = localStorage.getItem('sessionId');
        enrichmentByProductId = await Meteor.callAsync(
          'templateReports.getExportFieldsForProducts',
          productIds,
          sessionId
        );
      } catch (err) {
        console.error('[exportToExcel] Failed to load report enrichment:', err);
      }
    }

    const cashFromPercent = (qty, percent) => {
      if (percent === null || percent === undefined || !Number.isFinite(percent)) return '';
      return (qty || 0) * percent / 100;
    };

    // Per-line WTD/MTD/YTD performance. Reuse the map already loaded into state;
    // fall back to fetching it (mirrors the product-enrichment call above) so the
    // export is complete even if the user clicks before the background load lands.
    let perfByKey = holdingPerfByKey;
    if (!perfByKey || Object.keys(perfByKey).length === 0) {
      try {
        const sessionId = localStorage.getItem('sessionId');
        perfByKey = await Meteor.callAsync('performance.getHoldingPeriodPerformance', {
          sessionId,
          holdings: allHoldings.filter(h => h.uniqueKey).map(h => ({
            uniqueKey: h.uniqueKey,
            portfolioCode: h.portfolioCode || '',
            portfolioCurrency: h.portfolioCurrency || portfolioCurrency || '',
            currentPrice: h.currentPrice || 0,
            currentValue: h.marketValue || 0
          })),
          asOfDate: selectedDate ? new Date(selectedDate) : null
        }) || {};
      } catch (err) {
        console.error('[exportToExcel] Failed to load per-line period performance:', err);
        perfByKey = {};
      }
    }

    // Blank when the position had no snapshot before the period start.
    const perfCell = (v) => (v === null || v === undefined || !Number.isFinite(v)) ? '' : Number(v.toFixed(2));

    const TEMPLATE_LABELS = {
      phoenix_autocallable: 'Phoenix',
      orion_memory: 'Orion',
      himalaya: 'Himalaya',
      shark_note: 'Shark Note',
      participation_note: 'Participation Note',
      reverse_convertible: 'Reverse Convertible',
      reverse_convertible_bond: 'Reverse Convertible Bond'
    };

    const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Build a portfolio-name lookup keyed by `${accountNumber}|${bankId}` so each
    // holding can be labelled with the human-readable account name (or a sensible
    // fallback) on its export row.
    const portfolioNameByKey = bankAccounts.reduce((acc, ba) => {
      const key = `${ba.accountNumber || ''}|${ba.bankId || ''}`;
      const fallback = `${ba.bankShortName || ''}${ba.bankShortName && ba.accountNumber ? ' - ' : ''}${ba.accountNumber || ''}`.trim();
      acc[key] = ba.name || ba.comment || fallback;
      return acc;
    }, {});

    const data = allHoldings.map(h => {
      const enrichment = h.linkedProductId ? enrichmentByProductId[h.linkedProductId] : null;
      const minPct = enrichment?.minGuaranteedPercent ?? null;
      const capPct = enrichment?.capitalReturnPercent ?? null;
      const indPct = enrichment?.indicativeMaturityValuePercent ?? null;
      const cpnPct = enrichment?.totalCouponsEarnedPercent ?? null;
      const minCash = cashFromPercent(h.quantity, minPct);
      const indCash = cashFromPercent(h.quantity, indPct);
      const indPnL = (indCash !== '' && h.costBasis !== undefined && h.costBasis !== null)
        ? indCash - h.costBasis
        : '';

      const productType = enrichment?.templateId
        ? (TEMPLATE_LABELS[enrichment.templateId] || titleCase(enrichment.templateId))
        : (h.assetClass ? titleCase(h.assetClass) : '');

      const portfolioKey = `${h.portfolioCode || ''}|${h.portfolioCurrency || portfolioCurrency || ''}`;
      const portfolioTotal = portfolioTotals[portfolioKey] || 0;
      const weightInPortfolio = portfolioTotal > 0
        ? (h.marketValue || 0) / portfolioTotal * 100
        : '';

      const perf = h.uniqueKey ? perfByKey[h.uniqueKey] : null;

      return {
        'Name': h.name || '',
        'ISIN': h.isin || '',
        'Ticker': h.ticker || '',
        'Product Type': productType,
        'Asset Class': h.assetClass ? h.assetClass.replace(/_/g, ' ') : '',
        'Sub Class': h.assetSubClass ? h.assetSubClass.replace(/_/g, ' ') : '',
        'Quantity': h.quantity || 0,
        'Avg Price': h.avgPrice || 0,
        'Current Price': h.currentPrice || 0,
        'Price Type': h.priceType || '',
        'Cost Basis': h.costBasis || 0,
        'Market Value': h.marketValue || 0,
        'Gain/Loss': h.gainLoss || 0,
        'Gain/Loss %': h.gainLossPercent || 0,
        'WTD %': perfCell(perf?.wtd?.returnPercent),
        'WTD Contribution %': perfCell(perf?.wtd?.contributionPercent),
        'MTD %': perfCell(perf?.mtd?.returnPercent),
        'MTD Contribution %': perfCell(perf?.mtd?.contributionPercent),
        'YTD %': perfCell(perf?.ytd?.returnPercent),
        'YTD Contribution %': perfCell(perf?.ytd?.contributionPercent),
        'Min Guaranteed (% of par)': minPct ?? '',
        'Capital Return (% of par)': capPct ?? '',
        'Indicative Maturity Value (% of par)': indPct ?? '',
        'Total Coupons Earned (% of par)': cpnPct ?? '',
        'Min Guaranteed Cash': minCash,
        'Indicative Maturity Cash Value': indCash,
        'Indicative P&L if Matured Today': indPnL,
        'Currency': h.currency || '',
        'Portfolio Currency': h.portfolioCurrency || portfolioCurrency || '',
        'Bank': h.bankName || '',
        'Portfolio': portfolioNameByKey[`${h.portfolioCode || ''}|${h.bankId || ''}`] || '',
        'Portfolio Code': h.portfolioCode || '',
        'Weight in Portfolio %': weightInPortfolio,
        'Price Date': h.priceDate ? new Date(h.priceDate).toLocaleDateString() : '',
        'Data Date': h.dataDate ? new Date(h.dataDate).toLocaleDateString() : ''
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);

    // Apply number formats + column widths. SheetJS community honors cell number
    // formats (cell.z) and !cols; numeric cells auto-right-align in Excel while
    // text left-aligns, so alignment follows from the values being real numbers.
    // Percent columns hold percent-valued numbers (e.g. 12.34), so we use a
    // literal-"%" format ('0.00"%"') that does NOT multiply by 100.
    const PCT_FMT = '0.00"%"';
    const CCY_FMT = '#,##0.00';
    const PRICE_FMT = '#,##0.0000';
    const QTY_FMT = '#,##0.####';
    const formatByHeader = {
      'Quantity': QTY_FMT,
      'Avg Price': PRICE_FMT,
      'Current Price': PRICE_FMT,
      'Cost Basis': CCY_FMT,
      'Market Value': CCY_FMT,
      'Gain/Loss': CCY_FMT,
      'Gain/Loss %': PCT_FMT,
      'WTD %': PCT_FMT,
      'WTD Contribution %': PCT_FMT,
      'MTD %': PCT_FMT,
      'MTD Contribution %': PCT_FMT,
      'YTD %': PCT_FMT,
      'YTD Contribution %': PCT_FMT,
      'Min Guaranteed (% of par)': PCT_FMT,
      'Capital Return (% of par)': PCT_FMT,
      'Indicative Maturity Value (% of par)': PCT_FMT,
      'Total Coupons Earned (% of par)': PCT_FMT,
      'Min Guaranteed Cash': CCY_FMT,
      'Indicative Maturity Cash Value': CCY_FMT,
      'Indicative P&L if Matured Today': CCY_FMT,
      'Weight in Portfolio %': PCT_FMT
    };

    const range = XLSX.utils.decode_range(ws['!ref']);
    const headerToCol = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell && cell.v != null) headerToCol[String(cell.v)] = c;
    }
    for (const [header, fmt] of Object.entries(formatByHeader)) {
      const c = headerToCol[header];
      if (c == null) continue;
      for (let r = 1; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.t === 'n') cell.z = fmt;
      }
    }

    // Column widths from header length (Name/Portfolio wider), capped.
    ws['!cols'] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      const header = cell && cell.v != null ? String(cell.v) : '';
      let wch = Math.max(header.length + 2, 12);
      if (header === 'Name' || header === 'Portfolio') wch = 30;
      ws['!cols'].push({ wch: Math.min(wch, 40) });
    }

    // Header autofilter dropdowns across the full range.
    ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Holdings');

    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `portfolio-holdings-${dateStr}.xlsx`);
  };

  // Reset performance data when viewAsFilter or account tab changes
  // Must reset unconditionally so data refreshes when returning to performance tab
  React.useEffect(() => {
    setPerformancePeriods(null);
    setChartData(null);
    setLastFetchedRange(null);
    setTwrData(null);
    setHoldingPerfByKey({});
  }, [viewAsFilter, activeAccountTab]);

  // The time-weighted return is computed in the display currency
  React.useEffect(() => { setTwrData(null); }, [portfolioCurrency]);

  // Compute per-line WTD/MTD/YTD performance once holdings load.
  // The server does all the math (no calculations in the UI); we pass the
  // current holdings we already received (uniqueKey + current price/value) and
  // it returns a map keyed by uniqueKey. selectedDate sets the period end so a
  // historical view stays consistent.
  React.useEffect(() => {
    const withKeys = holdings.filter(h => h.uniqueKey);
    if (withKeys.length === 0) {
      setHoldingPerfByKey({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sessionId = localStorage.getItem('sessionId');
        const payload = withKeys.map(h => ({
          uniqueKey: h.uniqueKey,
          portfolioCode: h.portfolioCode || '',
          portfolioCurrency: h.portfolioCurrency || portfolioCurrency || '',
          currentPrice: h.currentPrice || 0,
          currentValue: h.marketValue || 0
        }));
        const map = await Meteor.callAsync('performance.getHoldingPeriodPerformance', {
          sessionId,
          holdings: payload,
          asOfDate: selectedDate ? new Date(selectedDate) : null
        });
        if (!cancelled) setHoldingPerfByKey(map || {});
      } catch (err) {
        console.error('[PMS] Failed to load per-line period performance:', err);
        if (!cancelled) setHoldingPerfByKey({});
      }
    })();
    return () => { cancelled = true; };
  }, [holdings, selectedDate]);

  // Reset account tab when viewAsFilter changes
  // If viewAsFilter has selectedAccountId, auto-select that specific account tab
  React.useEffect(() => {
    if (viewAsFilter?.selectedAccountId) {
      // Find matching tab by the selected account ID
      const matchingTab = accountTabs.find(tab => tab.id === viewAsFilter.selectedAccountId);
      if (matchingTab) {
        setActiveAccountTab(matchingTab.id);
      } else {
        // Account tab not found yet (may still be loading), default to consolidated
        setActiveAccountTab('consolidated');
      }
    } else {
      // No specific account selected - show consolidated view
      setActiveAccountTab('consolidated');
    }
  }, [viewAsFilter, accountTabs]);

  // Helper function to calculate start date based on time range
  const getStartDateForRange = (range) => {
    const now = new Date();
    const startDate = new Date();

    switch (range) {
      case '1M':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case '3M':
        startDate.setMonth(now.getMonth() - 3);
        break;
      case '6M':
        startDate.setMonth(now.getMonth() - 6);
        break;
      case 'YTD':
        startDate.setMonth(0);
        startDate.setDate(1);
        break;
      case '1Y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'ALL':
        startDate.setFullYear(now.getFullYear() - 10); // 10 years back for "ALL"
        break;
      default:
        startDate.setFullYear(now.getFullYear() - 1);
    }

    return startDate;
  };

  // Fetch TWR performance data when Performance tab becomes active (only once)
  React.useEffect(() => {
    if (activeTab === 'performance' && !twrData && !performanceLoading) {
      const fetchTWRData = async () => {
        setPerformanceLoading(true);
        const sessionId = localStorage.getItem('sessionId');

        // Guard: Don't call methods without session
        if (!sessionId) {
          console.error('[PMS] No sessionId found, skipping TWR fetch');
          setPerformanceLoading(false);
          setTwrData({ hasData: false });
          return;
        }

        try {
          // If a specific account tab is selected, pass its accountNumber as portfolioCode
          const selectedTab = accountTabs.find(tab => tab.id === activeAccountTab);
          const portfolioCode = activeAccountTab !== 'consolidated' && selectedTab?.accountNumber
            ? selectedTab.accountNumber
            : null;
          console.log('[PMS] Calling performance.calculateTWR...', { portfolioCode, activeAccountTab });
          const result = await Meteor.callAsync('performance.calculateTWR', {
            sessionId,
            viewAsFilter,
            portfolioCode,
            currency: portfolioCurrency
          });
          console.log('[PMS] calculateTWR SUCCESS', { hasData: result?.hasData, periods: result?.periods ? Object.keys(result.periods) : [] });

          setTwrData(result);
          // Also set performancePeriods for backward compatibility with any other code
          setPerformancePeriods(result?.periods || {});
        } catch (error) {
          console.error('[PMS] Error fetching TWR data:', error);
          setTwrData({ hasData: false });
          setPerformancePeriods({});
        } finally {
          setPerformanceLoading(false);
        }
      };

      fetchTWRData();
    }
  }, [activeTab, twrData, performanceLoading, viewAsFilter, activeAccountTab, accountTabs]);

  // Fetch chart data when Performance tab is active and time range changes
  React.useEffect(() => {
    if (activeTab === 'performance' && `${selectedTimeRange}|${portfolioCurrency}` !== lastFetchedRange && !chartLoading) {
      const fetchChartData = async () => {
        setChartLoading(true);
        const sessionId = localStorage.getItem('sessionId');

        // Guard: Don't call methods without session
        if (!sessionId) {
          console.error('[PMS] No sessionId found, skipping chart fetch');
          setChartLoading(false);
          setChartData({ hasData: false });
          return;
        }

        try {
          const startDate = getStartDateForRange(selectedTimeRange);
          const endDate = new Date();
          // If a specific account tab is selected, pass its accountNumber as portfolioCode
          const selectedTab = accountTabs.find(tab => tab.id === activeAccountTab);
          const portfolioCode = activeAccountTab !== 'consolidated' && selectedTab?.accountNumber
            ? selectedTab.accountNumber
            : null;

          console.log('[PMS] Calling performance.getChartData...', {
            range: selectedTimeRange,
            startDate,
            endDate,
            portfolioCode,
            viewAsFilter: viewAsFilter ? { type: viewAsFilter.type, id: viewAsFilter.id, label: viewAsFilter.label } : null
          });

          const chart = await Meteor.callAsync('performance.getChartData', {
            sessionId,
            startDate,
            endDate,
            viewAsFilter,
            portfolioCode,
            currency: portfolioCurrency
          });
          console.log('[PMS] getChartData result:', { hasData: chart?.hasData, snapshotCount: chart?.snapshots?.length || 0 });

          setChartData(chart);
          setLastFetchedRange(`${selectedTimeRange}|${portfolioCurrency}`);
        } catch (error) {
          console.error('[PMS] Error fetching chart data:', error);
          setChartData({ hasData: false });
        } finally {
          setChartLoading(false);
        }
      };

      fetchChartData();
    }
  }, [activeTab, selectedTimeRange, lastFetchedRange, chartLoading, viewAsFilter, activeAccountTab, accountTabs, portfolioCurrency]);

  // Subscribe to available snapshot dates from PMSHoldings
  const { snapshotDates } = useTracker(() => {
    const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
    const handle = Meteor.subscribe('pmsHoldings.snapshotDates', sessionId, viewAsFilter);

    if (!handle.ready()) {
      return { snapshotDates: [] };
    }

    // Fetch snapshot dates from synthetic collection
    const dateList = PMSHoldingsSnapshotDatesCollection.find({}, { sort: { date: -1 } }).fetch()
      .map(doc => doc.date)
      .filter(date => date); // Filter out null/undefined

    return { snapshotDates: dateList };
  }, [viewAsFilter]);

  // Update availableDates when snapshotDates change
  useEffect(() => {
    setAvailableDates(snapshotDates);
  }, [snapshotDates]);

  const toggleSection = (assetClass) => {
    setExpandedSections(prev => {
      const next = { ...prev, [assetClass]: !prev[assetClass] };
      try { localStorage.setItem('pms_expandedSections', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const tabs = [
    { id: 'positions', label: 'Positions', icon: '📊' },
    { id: 'transactions', label: 'Transactions', icon: '💱' },
    { id: 'performance', label: 'Performance', icon: '📈' },
    { id: 'alerts', label: 'Alerts', icon: '⚠️' },
    { id: 'reviews', label: 'Reviews', icon: '📋' }
  ];

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  };

  // Open order modal for Buy/Sell
  const openOrderModal = (mode, position) => {
    // Only allow RM, Admin, and Superadmin to place orders
    if (!['rm', 'admin', 'superadmin'].includes(user?.role)) {
      return;
    }

    // Determine client ID: from position data, viewAsFilter, or current user
    const clientId = position.userId || viewAsFilter?.id || user?._id;

    setOrderModalMode(mode);
    setOrderPrefillData({
      isin: position.isin,
      securityName: position.name,
      currency: position.currency || portfolioCurrency,
      assetType: position.assetClass === 'equity' ? 'equity' :
                 position.assetClass === 'bond' ? 'bond' :
                 position.assetClass === 'structured_product' ? 'structured_product' :
                 position.assetClass === 'fund' ? 'fund' : 'other',
      quantity: position.quantity,
      holdingId: String(position.holdingId || position.id || ''),
      clientId: clientId,
      bankAccountId: position.bankAccountId,
      bankId: position.bankId,
      marketPrice: position.currentPrice || position.marketPrice || 0,
      marketValue: position.marketValue || 0,
      bankName: position.bankName || '',
      priceType: position.priceType || 'absolute'
    });
    setOrderModalOpen(true);
  };

  const handleOrderCreated = (result) => {
    console.log('[PMS] Order created:', result);
    // Could show a success toast or notification here
  };

  // Reclassify a position's security
  const handleReclassify = (position) => {
    const existingMetadata = SecuritiesMetadataCollection.findOne({ isin: position.isin });
    const securityData = {
      isin: position.isin,
      securityName: existingMetadata?.securityName || position.name || '',
      assetClass: existingMetadata?.assetClass || position.assetClass || '',
      assetSubClass: existingMetadata?.assetSubClass || position.assetSubClass || '',
      structuredProductType: existingMetadata?.structuredProductType || '',
      structuredProductUnderlyingType: existingMetadata?.structuredProductUnderlyingType || '',
      structuredProductProtectionType: existingMetadata?.structuredProductProtectionType || '',
      capitalGuaranteed100: existingMetadata?.capitalGuaranteed100 || false,
      capitalGuaranteedPartial: existingMetadata?.capitalGuaranteedPartial || false,
      guaranteedLevel: existingMetadata?.guaranteedLevel || '',
      barrierProtected: existingMetadata?.barrierProtected || false,
      barrierLevel: existingMetadata?.barrierLevel || '',
      currency: existingMetadata?.currency || position.currency || '',
      listingExchange: existingMetadata?.listingExchange || '',
      listingCountry: existingMetadata?.listingCountry || '',
      sector: existingMetadata?.sector || '',
      industry: existingMetadata?.industry || '',
      issuer: existingMetadata?.issuer || '',
      productType: existingMetadata?.productType || '',
      maturityDate: existingMetadata?.maturityDate || '',
      couponRate: existingMetadata?.couponRate || '',
      notes: existingMetadata?.notes || ''
    };
    setClassifyTarget(securityData);
    setShowClassifyModal(true);
  };

  const handleSaveClassification = async (classificationData) => {
    const sessionId = localStorage.getItem('sessionId');
    try {
      await Meteor.callAsync('securitiesMetadata.upsert', {
        isin: classifyTarget.isin,
        classificationData,
        sessionId
      });
      setShowClassifyModal(false);
      setClassifyTarget(null);
    } catch (error) {
      console.error('[PMS] Classification save error:', error);
      throw error;
    }
  };

  // Removed handleIsinClick - using native anchor navigation instead

  // Portfolio Review generation handler
  const handleGeneratePortfolioReview = (language = 'en') => {
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) return;
    if (reviewGenerating) return; // prevent double-click

    setReviewGenerating(true);
    setReviewError(null);
    setReviewProgress({ currentStepLabel: 'Starting...', completedSections: 0, totalSections: 7 });

    Meteor.callAsync('portfolioReview.generate', sessionId, activeAccountTab, viewAsFilter, language)
      .then(result => {
        console.log('[PMS] Portfolio review generation started:', result.reviewId);
        setReviewToastId(result.reviewId);
        setReviewsListKey(prev => prev + 1); // refresh list to show "generating" entry
      })
      .catch(err => {
        console.error('[PMS] Portfolio review generation failed:', err);
        setReviewGenerating(false);
        setReviewProgress(null);
        setReviewError(err.reason || err.message || 'Failed to start generation');
        setTimeout(() => setReviewError(null), 10000);
      });
  };

  // Render Reviews tab content
  const renderReviewsSection = () => {
    return (
      <div style={{ padding: '1rem 0' }}>
        <PortfolioReviewsList
          viewAsFilter={viewAsFilter}
          accountFilter={activeAccountTab}
          onOpenReview={(reviewId) => setPortfolioReviewModalId(reviewId)}
          onGenerateNew={(language) => handleGeneratePortfolioReview(language)}
          refreshKey={reviewsListKey}
          isGenerating={reviewGenerating}
          onCancelGeneration={() => setReviewGenerating(false)}
        />
      </div>
    );
  };

  const renderPositionsSection = () => {
    // Loading state
    if (isLoading) {
      return (
        <div style={{ padding: '1.5rem' }}>
          <LiquidGlassCard>
            <div style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              color: 'var(--text-muted)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>⏳</div>
              <h3 style={{
                margin: '0 0 0.5rem 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem'
              }}>
                Loading Holdings...
              </h3>
            </div>
          </LiquidGlassCard>
        </div>
      );
    }

    // Empty state
    if (!isLoading && displayPositions.length === 0) {
      return (
        <div style={{ padding: '1.5rem' }}>
          <LiquidGlassCard>
            <div style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              color: 'var(--text-muted)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📊</div>
              <h3 style={{
                margin: '0 0 0.5rem 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem'
              }}>
                No Holdings Found
              </h3>
              <p style={{
                margin: 0,
                fontSize: '0.875rem'
              }}>
                No portfolio holdings data available
              </p>
            </div>
          </LiquidGlassCard>
        </div>
      );
    }

    // Get the most recent data date from holdings
    const mostRecentDataDate = holdings.length > 0
      ? holdings.reduce((latest, h) => {
          const holdingDate = h.dataDate instanceof Date ? h.dataDate : (h.dataDate ? new Date(h.dataDate) : null);
          if (!holdingDate) return latest;
          if (!latest) return holdingDate;
          return holdingDate > latest ? holdingDate : latest;
        }, null)
      : null;

    return (
    <div style={{ padding: isMobile ? '0.75rem' : '1.5rem' }}>
      {/* Data Freshness Indicator */}
      {mostRecentDataDate && (
        <div style={{
          padding: isMobile ? '0.875rem 1rem' : '0.75rem 1.25rem',
          marginBottom: isMobile ? '1rem' : '1.5rem',
          background: theme === 'light'
            ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.03) 100%)'
            : 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)',
          borderRadius: '8px',
          borderLeft: '3px solid var(--info-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          fontSize: isMobile ? '0.9375rem' : '0.875rem',
          color: 'var(--text-secondary)'
        }}>
          <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>📅</span>
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>Data as of:</strong>{' '}
            {mostRecentDataDate.toLocaleDateString('en-US', isMobile
              ? { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }
              : { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </div>
      )}

      {/* Simple Portfolio Header - label above the figure on mobile so the
          amount gets the full width and never wraps mid-number */}
      <div style={{
        padding: isMobile ? '0.25rem 0.25rem 0' : '1.5rem',
        marginBottom: '1rem'
      }}>
        <span style={{
          display: 'block',
          fontSize: '11.5px',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: '6px'
        }}>
          Total portfolio value · {portfolioCurrency}
        </span>
        <span style={{
          display: 'block',
          fontFamily: 'var(--font-serif)',
          fontSize: isMobile ? 'clamp(30px, 9vw, 40px)' : 'clamp(38px, 5vw, 54px)',
          fontWeight: '500',
          letterSpacing: '-0.5px',
          lineHeight: 1.05,
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap'
        }}>
          {formatCurrency(totalPortfolioValue, portfolioCurrency)}
        </span>

        {/* One-day variation, in currency. The date is spelled out because
            "1 day" means the previous valuation, which on a Monday is Friday. */}
        {dayVariation && (() => {
          const up = dayVariation.change >= 0;
          const colour = dayVariation.change === 0
            ? 'var(--text-muted)'
            : up ? 'var(--gain-color)' : 'var(--loss-color)';
          // Bank files carry the previous day's close, so the figure itself is
          // dated too: "Wed 30/09 vs Tue 29/09" rather than a bare "vs Tue 29/09"
          // that reads as today compared with two days ago.
          const dayLabel = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
          const prevLabel = dayVariation.currentDate
            ? `${dayLabel(dayVariation.currentDate)} vs ${dayLabel(dayVariation.previousDate)}`
            : `vs ${dayLabel(dayVariation.previousDate)}`;
          const partial = dayVariation.comparedPortfolios < dayVariation.totalPortfolios;
          return (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
              marginTop: '8px', fontVariantNumeric: 'tabular-nums'
            }}>
              <span style={{ fontSize: isMobile ? '0.95rem' : '1.05rem', fontWeight: '600', color: colour }}>
                {up ? '+' : '\u2212'}{formatCurrency(Math.abs(dayVariation.change), portfolioCurrency)}
              </span>
              <span style={{
                fontSize: '0.8rem', fontWeight: '600', padding: '2px 8px', borderRadius: '10px',
                background: `color-mix(in srgb, ${colour} 10%, transparent)`, color: colour
              }}>
                {up ? '+' : '\u2212'}{Math.abs(dayVariation.changePercent).toFixed(2)}%
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {prevLabel}
              </span>
              {partial && (
                <span
                  title={`${dayVariation.comparedPortfolios} of ${dayVariation.totalPortfolios} accounts compared \u2014 the others have no earlier valuation, so they are excluded from both sides`}
                  style={{
                    fontSize: '0.72rem', fontWeight: '600', padding: '2px 8px', borderRadius: '10px',
                    background: 'color-mix(in srgb, var(--warning-color) 12%, transparent)', color: 'var(--warning-color)'
                  }}>
                  {dayVariation.comparedPortfolios}/{dayVariation.totalPortfolios} accounts
                </span>
              )}
            </div>
          );
        })()}
      </div>

      {/* Cash Table */}
      {Object.keys(cashByCurrency).length > 0 && (
        <LiquidGlassCard style={{ marginBottom: '2rem' }}>
          <div style={{ padding: isMobile ? '1rem' : '1.5rem' }}>
            <h3 style={{
              margin: isMobile ? '0 0 1rem 0' : '0 0 1.5rem 0',
              fontSize: isMobile ? '1.125rem' : '1.25rem',
              fontWeight: isMobile ? '600' : '400',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>💵</span>
              Cash Balances
            </h3>

            {isMobile ? (
              <CashBalanceCardsMobile
                cashByCurrency={cashByCurrency}
                portfolioCurrency={portfolioCurrency}
                totalCashPortfolioValue={totalCashPortfolioValue}
                theme={theme}
              />
            ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.875rem'
              }}>
                <thead>
                  <tr style={{
                    borderBottom: '2px solid var(--border-color)',
                    background: theme === 'light' ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.02)'
                  }}>
                    <th style={{
                      padding: '0.75rem',
                      textAlign: 'left',
                      fontWeight: '400',
                      color: 'var(--text-muted)'
                    }}>
                      Currency
                    </th>
                    <th style={{
                      padding: '0.75rem',
                      textAlign: 'right',
                      fontWeight: '400',
                      color: 'var(--text-muted)'
                    }}>
                      Balance
                    </th>
                    <th style={{
                      padding: '0.75rem',
                      textAlign: 'right',
                      fontWeight: '400',
                      color: 'var(--text-muted)'
                    }}>
                      Portfolio Value ({portfolioCurrency})
                    </th>
                    <th style={{
                      padding: '0.75rem',
                      textAlign: 'left',
                      fontWeight: '400',
                      color: 'var(--text-muted)'
                    }}>
                      Account
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(cashByCurrency).map((cash, index) => (
                    <tr
                      key={cash.currency}
                      style={{
                        borderBottom: index < Object.values(cashByCurrency).length - 1 ? '1px solid var(--border-color)' : 'none',
                        transition: 'background 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = theme === 'light' ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.02)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <td style={{ padding: '0.75rem' }}>
                        {/* Flag plus the ISO code: a flag alone is ambiguous (EUR) */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          {(() => {
                            const FlagComponent = getCurrencyFlag(cash.currency);
                            return FlagComponent ? (
                              <FlagComponent
                                style={{
                                  width: '2.5rem',
                                  height: 'auto',
                                  display: 'block',
                                  borderRadius: '2px'
                                }}
                              />
                            ) : (
                              <span style={{
                                fontSize: '2rem',
                                lineHeight: '1',
                                fontWeight: '300'
                              }}>
                                {getCurrencySymbol(cash.currency)}
                              </span>
                            );
                          })()}
                          <span style={{ fontWeight: '600', color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
                            {cash.currency}
                          </span>
                        </div>
                      </td>
                      <td style={{
                        padding: '0.75rem',
                        textAlign: 'right',
                        color: 'var(--text-primary)',
                        fontWeight: '600',
                        fontSize: '1rem'
                      }}>
                        {formatCurrency(cash.totalValue, cash.currency)}
                      </td>
                      <td style={{
                        padding: '0.75rem',
                        textAlign: 'right',
                        color: 'var(--text-secondary)',
                        fontWeight: '500',
                        fontSize: '0.95rem'
                      }}>
                        {formatCurrency(cash.totalPortfolioValue, portfolioCurrency)}
                      </td>
                      <td style={{
                        padding: '0.75rem',
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem'
                      }}>
                        {(() => {
                          const uniqueAccounts = cash.positions.map(p => p.portfolioCode).filter((v, i, a) => a.indexOf(v) === i);
                          const accountCount = uniqueAccounts.length;
                          if (accountCount <= 2) {
                            return uniqueAccounts.join(', ');
                          }
                          return (
                            <span
                              title={uniqueAccounts.join('\n')}
                              style={{ cursor: 'help', borderBottom: '1px dashed var(--text-muted)' }}
                            >
                              {accountCount} accounts
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                  <tr style={{
                    borderTop: '2px solid var(--border-color)',
                    background: 'color-mix(in srgb, var(--accent-color) 10%, transparent)'
                  }}>
                    <td style={{
                      padding: '1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      fontSize: '0.95rem'
                    }}>
                      Total Cash ({Object.keys(cashByCurrency).length} {Object.keys(cashByCurrency).length === 1 ? 'currency' : 'currencies'})
                    </td>
                    <td style={{
                      padding: '1rem',
                      textAlign: 'right',
                      fontWeight: '700',
                      color: 'var(--info-color)',
                      fontSize: '1.1rem'
                    }}>
                      {Object.keys(cashByCurrency).length === 1
                        ? formatCurrency(Object.values(cashByCurrency)[0].totalValue, Object.values(cashByCurrency)[0].currency)
                        : 'Multiple currencies'}
                    </td>
                    <td style={{
                      padding: '1rem',
                      textAlign: 'right',
                      fontWeight: '700',
                      color: 'var(--info-color)',
                      fontSize: '1.1rem'
                    }}>
                      {formatCurrency(totalCashPortfolioValue, portfolioCurrency)}
                    </td>
                    <td style={{ padding: '1rem' }}></td>
                  </tr>
                </tbody>
              </table>
            </div>
            )}
          </div>
        </LiquidGlassCard>
      )}

      {/* FX Forwards Table */}
      {Object.keys(fxForwardsByCurrency).length > 0 && (
        <LiquidGlassCard style={{
                    marginTop: '1rem'
        }}>
          <div style={{ padding: '1.5rem' }}>
            <h3 style={{
              margin: '0 0 1rem 0',
              fontSize: '1.25rem',
              fontWeight: '400',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>📊</span>
              FX Forwards
            </h3>

            {/* Aggregate realized pair P&L: only matched buy-sell pairs in
                each group contribute. Single open trades and same-direction
                groups have no P&L. */}
            {(() => {
              // Group deals by (currency pair, value date, portfolio).
              const groupKey = (d) => {
                const f = d?.notional?.foreignCurrency || d?.foreignLeg?.currency || '?';
                const b = d?.notional?.baseCurrency    || d?.baseLeg?.currency    || '?';
                const pair = [f, b].sort().join('/');
                const vd = d.valueDate ? new Date(d.valueDate).toISOString().slice(0, 10) : 'no-value-date';
                const pc = d.portfolioCode || d.accountNumber || '?';
                return `${pair}|${vd}|${pc}`;
              };
              const agg = new Map(); // key → { buyAmt, buyW, sellAmt, sellW, baseCcy }
              for (const d of fxForwardDeals) {
                const k = groupKey(d);
                const f = d?.notional?.foreignAmount;
                const rate = d?.notional?.fxRate;
                if (f == null || !rate || rate <= 0) continue;
                if (!agg.has(k)) agg.set(k, { buyAmt: 0, buyW: 0, sellAmt: 0, sellW: 0, baseCcy: d?.notional?.baseCurrency });
                const e = agg.get(k);
                const abs = Math.abs(f);
                if (f > 0) { e.buyAmt += abs; e.buyW += rate * abs; }
                else { e.sellAmt += abs; e.sellW += rate * abs; }
              }
              let totalMtm = 0; // (kept variable name to minimise churn — semantics: total realized pair P&L in portfolioCurrency)
              for (const [, e] of agg) {
                const matched = Math.min(e.buyAmt, e.sellAmt);
                if (matched <= 0) continue;
                const avgBuy = e.buyW / e.buyAmt;
                const avgSell = e.sellW / e.sellAmt;
                if (!avgBuy || !avgSell) continue;
                const pnlBase = matched * (1 / avgSell - 1 / avgBuy);
                if (e.baseCcy === portfolioCurrency) {
                  totalMtm += pnlBase;
                } else {
                  const conv = fxSpotRates[`${e.baseCcy}${portfolioCurrency}`];
                  if (conv && conv > 0) totalMtm += pnlBase * conv;
                }
              }
              // Realized P&L from MFRX-tracked closed lifecycles (legacy path).
              const totalRealized = fxDealLifecycles.reduce((s, l) => s + (l.realizedPnLPortfolio || 0), 0);
              const closedCount = fxDealLifecycles.filter(l => l.status === 'closed').length;
              return (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <span title="Sum of P&L across all paired trades (groups of ≥2 trades sharing currency pair + value date). Singles don't have a P&L.">
                      Pair P&L: <strong style={{ color: totalMtm >= 0 ? 'var(--gain-color)' : 'var(--loss-color)' }}>{formatCurrency(totalMtm, portfolioCurrency)}</strong>
                    </span>
                    {closedCount > 0 && (
                      <span title="Realized P&L from round-trip pairs (open trade offset by a closing trade).">
                        Realized P&L: <strong style={{ color: totalRealized >= 0 ? 'var(--gain-color)' : 'var(--loss-color)' }}>{formatCurrency(totalRealized, portfolioCurrency)}</strong>
                      </span>
                    )}
                  </div>
                  {closedCount > 0 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      <input
                        type="checkbox"
                        checked={showClosedLifecycles}
                        onChange={(e) => setShowClosedLifecycles(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      Show closed ({closedCount})
                    </label>
                  )}
                </div>
              );
            })()}

            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.95rem'
              }}>
                <thead>
                  <tr style={{
                    borderBottom: '2px solid var(--border-color)',
                    background: 'var(--bg-tertiary)'
                  }}>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Reference</th>
                    <th style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: 'var(--text-secondary)' }}>Bought</th>
                    <th style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: 'var(--text-secondary)' }}>Sold</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Trade Date</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Value Date</th>
                    <th style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: 'var(--text-secondary)' }}>Entry Rate</th>
                    <th style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: 'var(--text-secondary)' }}>Current Rate</th>
                    <th
                      title="P&L expressed in the bought currency (the leg you're long)."
                      style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: 'var(--text-secondary)' }}
                    >P&L (bought)</th>
                    <th
                      title="P&L (mark-to-market) in the portfolio currency."
                      style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: 'var(--text-secondary)' }}
                    >P&L ({portfolioCurrency})</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Account</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Build a lookup of lifecycles by every dealId they touch, so a
                    // holding row can be matched to a lifecycle regardless of which
                    // leg's dealId the bank stamped on the position.
                    const lifecycleByDealId = new Map();
                    for (const lc of fxDealLifecycles) {
                      for (const leg of lc.legs) lifecycleByDealId.set(leg.dealId, lc);
                    }
                    // Rows = holdings-deals enriched with lifecycle, then optionally
                    // append historical closed lifecycles (no holding row) when toggled.
                    const merged = fxForwardDeals.map(deal => ({
                      kind: 'holding',
                      deal,
                      lifecycle: lifecycleByDealId.get(deal.dealId) || null
                    }));
                    if (showClosedLifecycles) {
                      const seenLifecycleIds = new Set(
                        merged.map(r => r.lifecycle?.lifecycleId).filter(Boolean)
                      );
                      for (const lc of fxDealLifecycles) {
                        if (lc.status === 'closed' && !seenLifecycleIds.has(lc.lifecycleId)) {
                          merged.push({ kind: 'history', deal: null, lifecycle: lc });
                        }
                      }
                    }
                    // Compute trade-pair grouping (same currency pair + same
                    // value date + same portfolio). Group ≥2 trades together
                    // so they render adjacent in the table and the user sees
                    // their combined MTM inline.
                    const groupKeyOf = (row) => {
                      const d = row.deal;
                      if (!d) return `__history_${row.lifecycle?.lifecycleId}`;
                      const f = d?.notional?.foreignCurrency || d?.foreignLeg?.currency || '?';
                      const b = d?.notional?.baseCurrency    || d?.baseLeg?.currency    || '?';
                      const pair = [f, b].sort().join('/');
                      const vd = d.valueDate ? new Date(d.valueDate).toISOString().slice(0, 10) : 'no-value-date';
                      const pc = d.portfolioCode || d.accountNumber || '?';
                      return `${pair}|${vd}|${pc}`;
                    };
                    const groupCounts = new Map();
                    const groupMtm = new Map();
                    // Per-group buy/sell aggregates for realized-pair P&L:
                    //   - buyAmt / sellAmt: total foreign notional bought/sold
                    //   - buyW / sellW: notional-weighted sum of entry rates
                    //   → average buy/sell rate = weighted / amt
                    //   → realized P&L (base ccy) = matched × (1/avgSell − 1/avgBuy)
                    const groupAgg = new Map();
                    for (const r of merged) {
                      const k = groupKeyOf(r);
                      groupCounts.set(k, (groupCounts.get(k) || 0) + 1);
                      groupMtm.set(k, (groupMtm.get(k) || 0) + (r.deal?.mtmPortfolio || 0));
                      const d = r.deal;
                      const f = d?.notional?.foreignAmount;
                      const rate = d?.notional?.fxRate;
                      const baseCcy = d?.notional?.baseCurrency;
                      if (f == null || !rate || rate <= 0) continue;
                      if (!groupAgg.has(k)) {
                        groupAgg.set(k, { buyAmt: 0, buyW: 0, sellAmt: 0, sellW: 0, baseCurrency: baseCcy });
                      }
                      const e = groupAgg.get(k);
                      const abs = Math.abs(f);
                      if (f > 0) { e.buyAmt += abs; e.buyW += rate * abs; }
                      else { e.sellAmt += abs; e.sellW += rate * abs; }
                    }
                    const groupRealized = new Map();
                    for (const [k, e] of groupAgg) {
                      const matched = Math.min(e.buyAmt, e.sellAmt);
                      if (matched <= 0) { groupRealized.set(k, null); continue; }
                      const avgBuy = e.buyW / e.buyAmt;
                      const avgSell = e.sellW / e.sellAmt;
                      if (!avgBuy || !avgSell) { groupRealized.set(k, null); continue; }
                      // P&L in BASE currency. Convention: rate is foreign-per-base
                      // (ILS per EUR / ILS per USD). For 1 unit of foreign:
                      //   cost basis (when bought): 1/avgBuy base
                      //   proceeds (when sold):    1/avgSell base
                      //   profit per foreign unit: (1/avgSell − 1/avgBuy)
                      // Sold at a smaller rate than bought (fewer foreign per base
                      // = foreign got more expensive) ⇒ positive P&L.
                      const pnlBase = matched * (1 / avgSell - 1 / avgBuy);
                      groupRealized.set(k, { amount: pnlBase, baseCurrency: e.baseCurrency, matched });
                    }
                    // Assign each group a distinct accent colour for the left
                    // band. Only groups with ≥2 members get colour; singletons
                    // get no band.
                    const groupColors = ['#0ea5e9', '#a855f7', 'var(--warning-color)', 'var(--gain-color)', 'var(--loss-color)', '#22d3ee'];
                    const colorByGroup = new Map();
                    let colorIdx = 0;
                    for (const [k, count] of groupCounts) {
                      if (count >= 2) {
                        colorByGroup.set(k, groupColors[colorIdx % groupColors.length]);
                        colorIdx += 1;
                      }
                    }
                    // Sort merged rows by (currency pair, trade date, dealId).
                    // Pair groups (same currency-pair + value-date) stay
                    // adjacent because all rows in a group share the pair
                    // and typically the value date too.
                    const pairOf = (r) => {
                      const d = r.deal;
                      if (!d) return '~__history__';
                      const f = d?.notional?.foreignCurrency || d?.foreignLeg?.currency || '?';
                      const b = d?.notional?.baseCurrency    || d?.baseLeg?.currency    || '?';
                      return [f, b].sort().join('/');
                    };
                    const tradeTimeOf = (r) => {
                      const td = r.deal?.tradeDate || r.lifecycle?.firstLeg?.tradeDate;
                      return td ? new Date(td).getTime() : Number.MAX_SAFE_INTEGER;
                    };
                    merged.sort((a, b) => {
                      const pa = pairOf(a);
                      const pb = pairOf(b);
                      if (pa !== pb) return pa.localeCompare(pb);
                      const ta = tradeTimeOf(a);
                      const tb = tradeTimeOf(b);
                      if (ta !== tb) return ta - tb;
                      return (a.deal?.dealId || '').localeCompare(b.deal?.dealId || '');
                    });
                    // Annotate each row with its group info so the renderer
                    // doesn't recompute. Also flag the LAST row of each group
                    // so we can render the combined P&L exactly once per group
                    // (an individual open trade has no realized P&L; only the
                    // group as a whole — once paired/closed — does).
                    for (let i = 0; i < merged.length; i++) {
                      const r = merged[i];
                      const k = groupKeyOf(r);
                      const next = merged[i + 1];
                      r._groupKey = k;
                      r._groupCount = groupCounts.get(k) || 1;
                      r._groupMtm = groupMtm.get(k) || 0;
                      r._groupRealized = groupRealized.get(k) || null;
                      r._groupColor = colorByGroup.get(k) || null;
                      r._isGroupLast = !next || groupKeyOf(next) !== k;
                    }
                    return merged;
                  })().map((row, index, arr) => {
                    const deal = row.deal;
                    const lifecycle = row.lifecycle;
                    const boughtCellStyle = {
                      padding: '1rem',
                      textAlign: 'right',
                      fontWeight: '600',
                      fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--gain-color)'
                    };
                    const soldCellStyle = {
                      padding: '1rem',
                      textAlign: 'right',
                      fontWeight: '600',
                      fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--loss-color)'
                    };

                    // Source for leg display:
                    // - holding rows: prefer holding notional, fall back to per-leg MTM
                    // - history rows: use the lifecycle's first leg amounts
                    let leg1 = null, leg2 = null;
                    let tradeDate = null, valueDate = null;
                    let portfolioValue = null;
                    let accountLabel = null;
                    let dealIdLabel = '';
                    let unenriched = false;

                    if (row.kind === 'holding') {
                      // POES is the AUTHORITATIVE source for the deal's foreign
                      // and base currencies AND the direction sign of
                      // foreignAmount. The lifecycle (built from MFRX columns)
                      // can mis-label USD-paired deals (CFM stores
                      // operationCurrency inconsistently across deals), so we
                      // ONLY borrow the entry rate from the lifecycle — never
                      // its currency labels or signed amounts.
                      const lcLeg = lifecycle?.currentLeg;
                      const n = deal.notional;
                      const foreignSigned = n && n.foreignAmount != null
                        ? n.foreignAmount
                        : (lcLeg?.foreignAmount ?? null);
                      const foreignCurrency = (n && n.foreignCurrency)
                        || lcLeg?.foreignCurrency
                        || null;
                      const baseCurrency = (n && n.baseCurrency)
                        || lcLeg?.baseCurrency
                        || null;
                      // Base amount: prefer the operation-derived entry rate
                      // (foreignAmount / entryRate, CFM convention "foreign per
                      // base"). When no entry rate is available (deal missing
                      // from MFRX), fall back to today's spot rate so the user
                      // still sees an approximate base amount instead of "—".
                      let baseSigned = null;
                      const lcEntryRate = lcLeg?.fxRate || null;
                      if (foreignSigned != null && lcEntryRate) {
                        baseSigned = -foreignSigned / lcEntryRate;
                      } else if (foreignSigned != null && foreignCurrency && baseCurrency) {
                        // EOD `${foreign}${base}.FOREX` returns base-per-foreign.
                        const spotBasePerForeign = fxSpotRates[`${foreignCurrency}${baseCurrency}`];
                        if (spotBasePerForeign && spotBasePerForeign > 0) {
                          baseSigned = -foreignSigned * spotBasePerForeign;
                        }
                      }
                      // Route the two legs to Bought (positive amount) and Sold
                      // (negative amount) columns. An FX forward has exactly one
                      // bought + one sold side. Display absolute values — the
                      // "Sold" column header already implies direction.
                      const foreignLegOut = foreignSigned != null
                        ? { currency: foreignCurrency, amount: foreignSigned }
                        : (foreignCurrency ? { currency: foreignCurrency, amount: null } : null);
                      const baseLegOut = baseCurrency
                        ? { currency: baseCurrency, amount: baseSigned }
                        : null;
                      // Pick the bought leg: the one whose amount is positive.
                      // When one of the two amounts is unknown (null), default
                      // foreign → Bought to keep ordering stable.
                      if (foreignLegOut?.amount != null && baseLegOut?.amount != null) {
                        if (foreignLegOut.amount >= 0) {
                          leg1 = foreignLegOut;
                          leg2 = baseLegOut;
                        } else {
                          leg1 = baseLegOut;
                          leg2 = foreignLegOut;
                        }
                      } else {
                        leg1 = foreignLegOut;
                        leg2 = baseLegOut;
                      }
                      tradeDate = deal.tradeDate;
                      valueDate = deal.valueDate;
                      portfolioValue = deal.totalPortfolioValue;
                      accountLabel = deal.portfolioCode || deal.accountNumber || 'N/A';
                      dealIdLabel = deal.dealId;
                      // "Unenriched": foreign notional missing entirely (legacy
                      // holding parsed before the POES fix; re-import to clear).
                      unenriched = !(n && n.foreignAmount != null);
                    } else {
                      // history row: render the closed lifecycle from operation data
                      const firstLeg = lifecycle.firstLeg;
                      leg1 = firstLeg ? { currency: firstLeg.foreignCurrency, amount: firstLeg.foreignAmount } : null;
                      leg2 = firstLeg ? { currency: firstLeg.baseCurrency, amount: firstLeg.baseAmount } : null;
                      tradeDate = firstLeg?.tradeDate || null;
                      valueDate = firstLeg?.valueDate || null;
                      portfolioValue = null; // no current holding
                      accountLabel = lifecycle.portfolioCode || 'N/A';
                      dealIdLabel = lifecycle.lifecycleId;
                    }

                    // Status badge + rate columns from lifecycle
                    const status = lifecycle?.status || (unenriched ? 'unenriched' : 'open');
                    const rollCount = lifecycle ? lifecycle.legs.filter(l => l.role === 'roll-open').length : 0;
                    const statusBadge = (() => {
                      if (status === 'closed') return { label: 'Closed', color: 'var(--text-muted)', bg: 'rgba(107, 114, 128, 0.15)' };
                      if (status === 'rolled') return { label: `Rolled (${rollCount})`, color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.15)' };
                      if (status === 'unenriched') return { label: 'Unenriched', color: 'var(--warning-color)', bg: 'rgba(245, 158, 11, 0.15)' };
                      return { label: 'Open', color: 'var(--gain-color)', bg: 'rgba(16, 185, 129, 0.15)' };
                    })();

                    // Entry rate priority:
                    //   1) lifecycle firstLeg.fxRate (from MFRX operation)
                    //   2) deal.notional.fxRate (set by parser-side enrichment
                    //      or by manualEnrichment for deals without MFRX)
                    const entryRate = (lifecycle?.firstLeg?.fxRate)
                      || (deal?.notional?.fxRate)
                      || null;
                    const poesForeignCcy = deal?.notional?.foreignCurrency || lifecycle?.currentLeg?.foreignCurrency || null;
                    const poesBaseCcy    = deal?.notional?.baseCurrency    || lifecycle?.currentLeg?.baseCurrency    || null;
                    let currentRate = null;
                    let currentRateLabel = null;
                    if (lifecycle?.status === 'closed') {
                      const closeLeg = lifecycle.legs.filter(l => l.role === 'close').pop();
                      currentRate = closeLeg?.fxRate || null;
                      currentRateLabel = closeLeg?.tradeDate ? `Closed ${new Date(closeLeg.tradeDate).toLocaleDateString('en-GB')}` : 'Closed';
                    } else if (poesForeignCcy && poesBaseCcy) {
                      // EOD's `${foreign}${base}.FOREX` returns base-per-foreign
                      // (e.g. ILSEUR.FOREX = 0.2949 EUR per ILS). CFM always
                      // quotes entry rate as "ILS per other currency" (3.6,
                      // 3.7050, 3.0950, ...). To keep the column internally
                      // consistent we want to show the spot in the same
                      // direction:
                      //   - If entry rate is known: match its direction.
                      //   - Otherwise: invert when rawSpot < 1 (typical
                      //     signature of an inverse-quoted rate, e.g. 0.2949
                      //     → 1/0.2949 = 3.391).
                      const rawSpot = fxSpotRates[`${poesForeignCcy}${poesBaseCcy}`] || null;
                      if (rawSpot && entryRate) {
                        const sameDirection = (entryRate >= 1 && rawSpot >= 1) || (entryRate < 1 && rawSpot < 1);
                        currentRate = sameDirection ? rawSpot : (1 / rawSpot);
                      } else if (rawSpot && rawSpot > 0 && rawSpot < 1) {
                        currentRate = 1 / rawSpot;
                      } else {
                        currentRate = rawSpot;
                      }
                      currentRateLabel = currentRate ? 'Today\'s spot' : 'Loading…';
                    }

                    // P&L = foreign leg's marketValue from POES (BALANCE_PERF,
                    // the EUR-equivalent of the deal's current MTM). For an FX
                    // forward this IS the unrealized P&L. Robust across EUR/ILS
                    // and USD/ILS deals because POES reports the MTM directly,
                    // no rate-convention math required.
                    const pnLBase = (deal && deal.mtmPortfolio != null) ? deal.mtmPortfolio : null;
                    const hasPnL = pnLBase != null;

                    // MTM in the bought currency: use POES BALANCE_POSITION on
                    // the foreign leg when the bought side IS the foreign leg
                    // (its marketValueOriginalCurrency is the MTM in its own
                    // currency). Otherwise convert mtmPortfolio (EUR) → bought
                    // currency via today's spot rate.
                    const boughtCcy = leg1?.currency || null;
                    let mtmInBoughtCcy = null;
                    if (boughtCcy && deal) {
                      if (boughtCcy === portfolioCurrency) {
                        mtmInBoughtCcy = pnLBase;
                      } else if (deal.foreignLeg
                          && deal.foreignLeg.currency === boughtCcy
                          && deal.foreignLeg.marketValueOriginalCurrency != null
                          && deal.foreignLeg.marketValueOriginalCurrency !== 0) {
                        mtmInBoughtCcy = deal.foreignLeg.marketValueOriginalCurrency;
                      } else if (pnLBase != null) {
                        // Convert EUR MTM into bought currency:
                        //   spot[`${boughtCcy}${portfolioCurrency}`] = portfolio per bought
                        //   MTM_bought = MTM_eur / (portfolio per bought)
                        // The display layer already inverts spot < 1 to "ILS
                        // per EUR" form, but here we want the EOD raw direction
                        // (base-per-foreign), so read fxSpotRates directly.
                        const portfolioPerBought = fxSpotRates[`${boughtCcy}${portfolioCurrency}`];
                        if (portfolioPerBought && portfolioPerBought > 0) {
                          mtmInBoughtCcy = pnLBase / portfolioPerBought;
                        }
                      }
                    }

                    const renderLeg = (leg) => {
                      if (!leg) return '—';
                      // Bought/Sold columns: the column header already encodes
                      // direction, so display absolute values without sign.
                      if (leg.amount == null) return `${leg.currency || ''} —`.trim();
                      const absAmount = Math.abs(leg.amount);
                      return `${leg.currency} ${formatCurrency(absAmount, leg.currency).replace(/^[^\d-]+/, '').trim()}`;
                    };
                    const fmtDate = (d) => d
                      ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : 'N/A';

                    const expandable = lifecycle && lifecycle.legs.length > 1;
                    const expanded = lifecycle && expandedLifecycleIds.has(lifecycle.lifecycleId);
                    const rowKey = `${row.kind}-${dealIdLabel}-${index}`;

                    // Trade-pair grouping visuals: rows in a ≥2-trade group get
                    // a colored left band so the eye can track which trades
                    // belong together. The first row of a group also gets a
                    // tighter top divider to visually separate groups.
                    const groupColor = row._groupColor;
                    const isGrouped = (row._groupCount || 1) >= 2;
                    const prevRow = index > 0 ? arr[index - 1] : null;
                    const isGroupStart = isGrouped && (!prevRow || prevRow._groupKey !== row._groupKey);
                    const rowBg = isGroupStart ? 'var(--bg-secondary)' : 'transparent';
                    return (
                      <React.Fragment key={rowKey}>
                        <tr
                          style={{
                            borderBottom: index < arr.length - 1 ? '1px solid var(--border-color)' : 'none',
                            borderTop: isGroupStart ? '2px solid var(--border-color)' : undefined,
                            borderLeft: groupColor ? `4px solid ${groupColor}` : '4px solid transparent',
                            background: rowBg,
                            transition: 'background 0.2s ease',
                            cursor: expandable ? 'pointer' : 'default'
                          }}
                          onClick={() => expandable && toggleLifecycleExpansion(lifecycle.lifecycleId)}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = rowBg; }}
                        >
                          <td style={{ padding: '1rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              {expandable && (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
                              )}
                              <span>{dealIdLabel}</span>
                              <span style={{
                                fontSize: '0.7rem', fontWeight: '600',
                                padding: '2px 6px', borderRadius: '4px',
                                color: statusBadge.color, background: statusBadge.bg
                              }}>
                                {statusBadge.label}
                              </span>
                              {isGrouped && (
                                <span
                                  title={`Tied with ${row._groupCount - 1} other trade(s) on the same currency pair + value date`}
                                  style={{
                                    fontSize: '0.7rem', fontWeight: '600',
                                    padding: '2px 6px', borderRadius: '4px',
                                    color: groupColor, background: `color-mix(in srgb, ${groupColor} 22%, transparent)`
                                  }}
                                >
                                  🔗 Pair ({row._groupCount})
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={boughtCellStyle}>
                            {renderLeg(leg1)}
                          </td>
                          <td style={soldCellStyle}>
                            {renderLeg(leg2)}
                          </td>
                          <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                            {fmtDate(tradeDate)}
                          </td>
                          <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                            {fmtDate(valueDate)}
                          </td>
                          <td style={{ padding: '1rem', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                            {entryRate ? entryRate.toFixed(4) : '—'}
                          </td>
                          <td
                            title={currentRateLabel || ''}
                            style={{ padding: '1rem', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}
                          >
                            {currentRate ? currentRate.toFixed(4) : '—'}
                          </td>
                          {/* P&L = realized P&L of matched buy-sell pairs in
                              the group. A single open trade alone has no P&L.
                              A group of same-direction trades (all buys or all
                              sells) also has no realized P&L. Only when the
                              group has BOTH buys and sells does the matched
                              portion (min total) generate a realized P&L. */}
                          {(() => {
                            const realized = row._groupRealized;
                            const showGroupPnL = isGrouped && row._isGroupLast && realized && realized.amount != null;
                            // Realized P&L in base currency.
                            const pnlBase = realized?.amount ?? null;
                            const baseCcy = realized?.baseCurrency;
                            // Convert base → portfolio currency for the EUR column.
                            let pnlPortfolio = null;
                            if (showGroupPnL && pnlBase != null && baseCcy) {
                              if (baseCcy === portfolioCurrency) {
                                pnlPortfolio = pnlBase;
                              } else {
                                const portfolioPerBase = fxSpotRates[`${baseCcy}${portfolioCurrency}`];
                                if (portfolioPerBase && portfolioPerBase > 0) {
                                  pnlPortfolio = pnlBase * portfolioPerBase;
                                }
                              }
                            }
                            // P&L in the bought-currency column: convert base→bought.
                            let pnlBought = null;
                            if (showGroupPnL && pnlBase != null && baseCcy && boughtCcy) {
                              if (boughtCcy === baseCcy) {
                                pnlBought = pnlBase;
                              } else if (pnlPortfolio != null) {
                                const portfolioPerBought = boughtCcy === portfolioCurrency
                                  ? 1
                                  : fxSpotRates[`${boughtCcy}${portfolioCurrency}`];
                                if (portfolioPerBought && portfolioPerBought > 0) {
                                  pnlBought = pnlPortfolio / portfolioPerBought;
                                }
                              }
                            }
                            const pnlColor = (pnlBase || 0) >= 0 ? 'var(--gain-color)' : 'var(--loss-color)';
                            return (
                              <>
                                <td style={{
                                  padding: '1rem',
                                  textAlign: 'right',
                                  fontWeight: '600',
                                  fontFamily: "'JetBrains Mono', monospace",
                                  color: showGroupPnL && pnlBought != null ? pnlColor : 'var(--text-muted)'
                                }}>
                                  {showGroupPnL && pnlBought != null && boughtCcy
                                    ? `${boughtCcy} ${formatCurrency(pnlBought, boughtCcy).replace(/^[^\d-]+/, '').trim()}`
                                    : '—'}
                                </td>
                                <td style={{
                                  padding: '1rem',
                                  textAlign: 'right',
                                  fontWeight: '600',
                                  fontFamily: "'JetBrains Mono', monospace",
                                  color: showGroupPnL && pnlPortfolio != null ? pnlColor : 'var(--text-muted)'
                                }}>
                                  {showGroupPnL && pnlPortfolio != null
                                    ? formatCurrency(pnlPortfolio, portfolioCurrency)
                                    : '—'}
                                </td>
                              </>
                            );
                          })()}
                          <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            {accountLabel}
                          </td>
                        </tr>
                        {expanded && lifecycle && (
                          <tr style={{ background: 'var(--bg-tertiary)' }}>
                            <td colSpan={10} style={{ padding: '0.75rem 1rem 1rem 2.5rem' }}>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Lifecycle ({lifecycle.legs.length} legs)
                              </div>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead>
                                  <tr style={{ color: 'var(--text-muted)' }}>
                                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: '500' }}>Deal</th>
                                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: '500' }}>Role</th>
                                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: '500' }}>Trade Date</th>
                                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: '500' }}>Value Date</th>
                                    <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: '500' }}>Notional</th>
                                    <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: '500' }}>Rate</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lifecycle.legs.map(leg => {
                                    const roleLabel = {
                                      'open': 'Open',
                                      'roll-close': 'Roll-close',
                                      'roll-open': 'Roll-open',
                                      'close': 'Close'
                                    }[leg.role] || leg.role;
                                    return (
                                      <tr key={leg.dealId + '-' + leg.role} style={{ color: 'var(--text-primary)' }}>
                                        <td style={{ padding: '4px 8px', fontFamily: "'JetBrains Mono', monospace" }}>{leg.dealId}</td>
                                        <td style={{ padding: '4px 8px' }}>{roleLabel}</td>
                                        <td style={{ padding: '4px 8px', fontFamily: "'JetBrains Mono', monospace" }}>{fmtDate(leg.tradeDate)}</td>
                                        <td style={{ padding: '4px 8px', fontFamily: "'JetBrains Mono', monospace" }}>{fmtDate(leg.valueDate)}</td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                                          {leg.foreignCurrency} {formatCurrency(leg.foreignAmount, leg.foreignCurrency).replace(/^[^\d-]+/, '').trim()}
                                        </td>
                                        <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                                          {leg.fxRate ? leg.fxRate.toFixed(4) : '—'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {/* Total Row */}
                  {(() => {
                    // Mirror the header strip: sum realized pair P&L across
                    // (pair, value-date, portfolio) groups where matched
                    // buy-sell volume > 0.
                    const groupKey = (d) => {
                      const f = d?.notional?.foreignCurrency || d?.foreignLeg?.currency || '?';
                      const b = d?.notional?.baseCurrency    || d?.baseLeg?.currency    || '?';
                      const pair = [f, b].sort().join('/');
                      const vd = d.valueDate ? new Date(d.valueDate).toISOString().slice(0, 10) : 'no-value-date';
                      const pc = d.portfolioCode || d.accountNumber || '?';
                      return `${pair}|${vd}|${pc}`;
                    };
                    const agg = new Map();
                    for (const d of fxForwardDeals) {
                      const k = groupKey(d);
                      const f = d?.notional?.foreignAmount;
                      const rate = d?.notional?.fxRate;
                      if (f == null || !rate || rate <= 0) continue;
                      if (!agg.has(k)) agg.set(k, { buyAmt: 0, buyW: 0, sellAmt: 0, sellW: 0, baseCcy: d?.notional?.baseCurrency });
                      const e = agg.get(k);
                      const abs = Math.abs(f);
                      if (f > 0) { e.buyAmt += abs; e.buyW += rate * abs; }
                      else { e.sellAmt += abs; e.sellW += rate * abs; }
                    }
                    let totalMtm = 0;
                    for (const [, e] of agg) {
                      const matched = Math.min(e.buyAmt, e.sellAmt);
                      if (matched <= 0) continue;
                      const avgBuy = e.buyW / e.buyAmt;
                      const avgSell = e.sellW / e.sellAmt;
                      if (!avgBuy || !avgSell) continue;
                      const pnlBase = matched * (1 / avgSell - 1 / avgBuy);
                      if (e.baseCcy === portfolioCurrency) {
                        totalMtm += pnlBase;
                      } else {
                        const conv = fxSpotRates[`${e.baseCcy}${portfolioCurrency}`];
                        if (conv && conv > 0) totalMtm += pnlBase * conv;
                      }
                    }
                    const totalRealized = fxDealLifecycles.reduce((s, l) => s + (l.realizedPnLPortfolio || 0), 0);
                    const netPnL = totalRealized + totalMtm;
                    return (
                      <tr style={{
                        borderTop: '2px solid var(--border-color)',
                        background: 'var(--bg-tertiary)'
                      }}>
                        <td style={{
                          padding: '1rem',
                          fontWeight: '700',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem'
                        }}>
                          Total FX Forwards ({fxForwardDeals.length})
                        </td>
                        <td style={{ padding: '1rem' }}></td>
                        <td style={{ padding: '1rem' }}></td>
                        <td style={{ padding: '1rem' }}></td>
                        <td style={{ padding: '1rem' }}></td>
                        <td style={{ padding: '1rem' }}></td>
                        <td style={{ padding: '1rem' }}></td>
                        <td style={{ padding: '1rem' }}></td>
                        <td style={{
                          padding: '1rem',
                          textAlign: 'right',
                          fontWeight: '700',
                          color: netPnL >= 0 ? 'var(--gain-color)' : 'var(--loss-color)',
                          fontSize: '1.1rem'
                        }}>
                          {formatCurrency(netPnL, portfolioCurrency)}
                        </td>
                        <td style={{ padding: '1rem' }}></td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>

          </div>
        </LiquidGlassCard>
      )}

      {/* Positions - Card Based Layout */}
      <div style={{ marginTop: '1rem' }}>
        {/* Header and Controls */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <h3 style={{
            margin: 0,
            fontSize: '1.125rem',
            fontWeight: '500',
            color: 'var(--text-primary)'
          }}>
            Current Positions
          </h3>

          <div style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
            flexWrap: 'wrap'
          }}>
            {/* Sorting Controls */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'var(--bg-secondary)',
              padding: '0.25rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)'
            }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '0.5rem' }}>Sort:</span>
              {[
                { key: 'marketValue', label: 'Value' },
                { key: 'gainLoss', label: 'P&L €' },
                { key: 'gainLossPercent', label: 'P&L %' },
                { key: 'name', label: 'Name' }
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    if (sortBy === key) {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy(key);
                      setSortDirection('desc');
                    }
                  }}
                  style={{
                    padding: '0.375rem 0.625rem',
                    borderRadius: '4px',
                    border: 'none',
                    background: sortBy === key ? 'var(--bg-tertiary)' : 'transparent',
                    color: sortBy === key ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: '0.75rem',
                    fontWeight: sortBy === key ? '600' : '400',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {label} {sortBy === key && (sortDirection === 'desc' ? '↓' : '↑')}
                </button>
              ))}
            </div>

            {/* Asset Class Filter */}
            <select
              value={filterAssetClass}
              onChange={(e) => setFilterAssetClass(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '0.75rem',
                cursor: 'pointer'
              }}
            >
              <option value="all">All Classes</option>
              {assetClasses.map(ac => (
                <option key={ac} value={ac}>{ac.replace(/_/g, ' ')}</option>
              ))}
            </select>

            {/* Results Count */}
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {sortedPositions.length} positions
            </span>

            {/* Export to Excel Button */}
            <button
              onClick={exportToExcel}
              title="Export to Excel"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '0.75rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-tertiary)';
                e.currentTarget.style.borderColor = 'var(--gain-color)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-secondary)';
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Excel
            </button>
          </div>
        </div>

        {/* Grouped Positions Container */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {Object.keys(groupedPositions).sort((a, b) => getAssetClassSortOrder(a) - getAssetClassSortOrder(b)).map((assetClass) => {
            const group = groupedPositions[assetClass];
            const subtotal = assetClassSubtotals[assetClass];
            const isExpanded = expandedSections[assetClass];
            const hasSubGroups = Object.keys(group.subGroups).length > 0;

            // Compact position row renderer with P&L dominant layout
            const renderPositionRow = (position, isLast = false) => {
              const positionKey = `pos_${position.id}`;
              const isPositionExpanded = expandedSections[positionKey];

              // Check data freshness for this position
              const positionFreshness = checkDataFreshness(position.dataDate);
              const isStale = positionFreshness.status === 'stale' || positionFreshness.status === 'old';

              // Find active orders for this position (by ISIN and optionally portfolioCode)
              const positionOrders = activeOrders.filter(order =>
                order.isin === position.isin &&
                (!position.portfolioCode || order.portfolioCode === position.portfolioCode)
              );
              const buyOrders = positionOrders.filter(o => o.orderType === 'buy');
              const sellOrders = positionOrders.filter(o => o.orderType === 'sell');
              const totalBuyQty = buyOrders.reduce((sum, o) => sum + (o.quantity || 0), 0);
              const totalSellQty = sellOrders.reduce((sum, o) => sum + (o.quantity || 0), 0);

              // On phones the 700px-wide table row is unreadable - render a
              // tap-to-expand card instead (same data, no horizontal scroll).
              if (isMobile) {
                return (
                  <PositionCardMobile
                    key={position.id}
                    position={position}
                    isExpanded={isPositionExpanded}
                    onToggle={() => toggleSection(positionKey)}
                    portfolioCurrency={portfolioCurrency}
                    totalPortfolioValue={totalPortfolioValue}
                    linePerf={position.uniqueKey ? holdingPerfByKey[position.uniqueKey] : null}
                    isStale={isStale}
                    positionFreshness={positionFreshness}
                    totalBuyQty={totalBuyQty}
                    totalSellQty={totalSellQty}
                    buyOrderCount={buyOrders.length}
                    sellOrderCount={sellOrders.length}
                    theme={theme}
                    userRole={user?.role}
                    onBuy={(p) => openOrderModal('buy', p)}
                    onSell={(p) => openOrderModal('sell', p)}
                    onReclassify={handleReclassify}
                    onOpenReport={onOpenProductReport}
                  />
                );
              }

              return (
                <div key={position.id}>
                  {/* Main Row - P&L Dominant Layout with horizontal scroll on mobile */}
                  <div style={{
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    borderBottom: (isLast && !isPositionExpanded) ? 'none' : '1px solid var(--border-color)'
                  }}>
                    <div
                      onClick={() => toggleSection(positionKey)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(280px, 2fr) minmax(120px, 1fr) repeat(3, minmax(80px, 0.8fr))',
                        alignItems: 'center',
                        padding: '0.75rem 1rem',
                        minWidth: '700px', // Ensure minimum width for mobile scroll
                        transition: 'background 0.15s ease',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                    {/* HERO ZONE: Name + P&L together */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', paddingRight: '1rem' }}>
                      {/* Product Icon + Name + ISIN */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: '1' }}>
                        {/* Product Type Icon for linked products */}
                        {position.productIcon && (
                          <span style={{ fontSize: '1.2rem', flexShrink: 0 }} title={position.linkedProduct?.templateId || 'Structured Product'}>
                            {position.productIcon}
                          </span>
                        )}
                        <div style={{ minWidth: 0, flex: '1' }}>
                          <div style={{ fontWeight: '500', color: 'var(--text-primary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', minWidth: 0 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                            {position.linkedProduct ? (
                              <a
                                href={`/report/${position.linkedProduct._id}`}
                                onClick={(e) => {
                                  // In-app when the host provides navigation, so the
                                  // PMS stays mounted behind the report and its back
                                  // button returns to this list. The href stays for
                                  // middle-click / "open in new tab".
                                  if (onOpenProductReport && !e.metaKey && !e.ctrlKey && e.button === 0) {
                                    e.preventDefault();
                                    onOpenProductReport(position.linkedProduct._id);
                                  }
                                  e.stopPropagation();
                                }}
                                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--info-color)'}
                                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                              >
                                {position.name}
                              </a>
                            ) : position.name}
                            </span>
                            {/* Visible way into the product report (the name link only shows on hover) */}
                            {position.linkedProduct && onOpenProductReport && (
                              <button
                                type="button"
                                title="Open the product report"
                                aria-label={`Open the product report for ${position.name}`}
                                onClick={(e) => { e.stopPropagation(); onOpenProductReport(position.linkedProduct._id); }}
                                style={{
                                  flex: 'none',
                                  marginLeft: '0.4rem',
                                  padding: '0.05rem 0.45rem',
                                  fontSize: '0.68rem',
                                  lineHeight: '1.2rem',
                                  verticalAlign: 'middle',
                                  color: 'var(--info-color)',
                                  background: 'rgba(59, 130, 246, 0.12)',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                📄 Report
                              </button>
                            )}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            {position.isin
                              || (position.maturityDate
                                ? `Matures ${new Date(position.maturityDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
                                : position.securityType === 'TERM_DEPOSIT'
                                  ? (position.depositTerm?.type === 'call' ? 'Call deposit' : 'Rolling deposit')
                                  : 'N/A')}
                            {position.isin && (
                              <HoldingPriceChart
                                isin={position.isin}
                                securityName={position.name}
                                sessionId={localStorage.getItem('sessionId')}
                              />
                            )}
                            {isStale && (
                              <span
                                title={`Data is ${positionFreshness.businessDaysOld} business day(s) old`}
                                style={{ cursor: 'help', fontSize: '0.8rem' }}
                              >
                                ⚠️
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* P&L - DOMINANT */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>P&L</div>
                        <div style={{
                          fontSize: '1.1rem',
                          fontWeight: '700',
                          fontVariantNumeric: 'tabular-nums',
                          color: position.gainLoss >= 0 ? 'var(--gain-color)' : 'var(--loss-color)',
                          lineHeight: '1.2'
                        }}>
                          {position.gainLoss >= 0 ? '+' : ''}{formatCurrency(position.gainLoss, portfolioCurrency)}
                        </div>
                        <div style={{
                          fontSize: '0.75rem',
                          fontWeight: '500',
                          fontVariantNumeric: 'tabular-nums',
                          color: position.gainLossPercent >= 0 ? 'var(--gain-color)' : 'var(--loss-color)',
                          opacity: 0.85
                        }}>
                          {position.gainLossPercent >= 0 ? '+' : ''}{position.gainLossPercent.toFixed(2)}%
                        </div>
                      </div>
                    </div>

                    {/* Portfolio Value + Position Weight */}
                    <div style={{ textAlign: 'right', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Value</div>
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(position.marketValue, portfolioCurrency)}
                      </div>
                      {/* Value in original currency if different */}
                      {position.currency && position.currency !== portfolioCurrency && position.marketValueOriginalCurrency && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                          {formatCurrency(position.marketValueOriginalCurrency, position.currency)}
                        </div>
                      )}
                      {/* Position weight as % of total portfolio */}
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {totalPortfolioValue > 0 ? ((position.marketValue / totalPortfolioValue) * 100).toFixed(2) : '0.00'}% of portfolio
                      </div>
                    </div>

                    {/* Quantity - Tertiary */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Qty</div>
                      <div style={{ fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        {position.quantity.toLocaleString()}
                        {/* Order indicators */}
                        {totalBuyQty > 0 && (
                          <span
                            title={`Buy order: +${totalBuyQty.toLocaleString()} (${buyOrders.length} order${buyOrders.length > 1 ? 's' : ''})`}
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: '600',
                              color: 'var(--gain-color)',
                              background: 'rgba(16, 185, 129, 0.15)',
                              padding: '1px 4px',
                              borderRadius: '3px'
                            }}
                          >
                            +{totalBuyQty.toLocaleString()}
                          </span>
                        )}
                        {totalSellQty > 0 && (
                          <span
                            title={`Sell order: -${totalSellQty.toLocaleString()} (${sellOrders.length} order${sellOrders.length > 1 ? 's' : ''})`}
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: '600',
                              color: 'var(--loss-color)',
                              background: 'rgba(239, 68, 68, 0.15)',
                              padding: '1px 4px',
                              borderRadius: '3px'
                            }}
                          >
                            -{totalSellQty.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {position.costBasis != null ? formatCurrency(position.costBasis, portfolioCurrency) :
                         position.costBasisOriginalCurrency != null ? formatCurrency(position.costBasisOriginalCurrency, position.currency) : ''}
                      </div>
                    </div>

                    {/* Avg Price - Tertiary */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Avg Purch Price</div>
                      <div style={{ fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{formatPrice(position.avgPrice, position.currency, position.priceType)}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {position.costBasis != null && totalPortfolioValue > 0
                          ? `${((position.costBasis / totalPortfolioValue) * 100).toFixed(1)}% invested`
                          : ''}
                      </div>
                    </div>

                    {/* Current Price - Tertiary with color hint */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                        {position.priceDate ? new Date(position.priceDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Last Price'}
                      </div>
                      <div style={{
                        color: position.currentPrice >= position.avgPrice ? 'var(--gain-color)' : 'var(--loss-color)',
                        fontSize: '0.8rem',
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                        {formatPrice(position.currentPrice, position.currency, position.priceType)}
                      </div>
                      <div style={{
                        fontSize: '0.65rem',
                        fontVariantNumeric: 'tabular-nums',
                        color: position.currentPrice >= position.avgPrice ? 'var(--gain-color)' : 'var(--loss-color)'
                      }}>
                        {position.avgPrice > 0
                          ? `${position.currentPrice >= position.avgPrice ? '+' : ''}${(((position.currentPrice - position.avgPrice) / position.avgPrice) * 100).toFixed(1)}%`
                          : ''}
                      </div>
                    </div>
                    </div>
                  </div>

                  {/* Expandable Details Panel */}
                  {isPositionExpanded && (
                    <div style={{
                      padding: '0.75rem 1rem',
                      background: theme === 'light' ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)',
                      borderBottom: isLast ? 'none' : '1px solid var(--border-color)',
                      display: 'flex',
                      gap: '2rem',
                      paddingLeft: '2rem'
                    }}>
                      <div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Market Value ({position.currency})</div>
                        <div style={{ fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>
                          {formatCurrency(position.marketValueOriginalCurrency || position.marketValue, position.currency)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Total Cost</div>
                        <div style={{ fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>
                          {position.costBasis != null ? formatCurrency(position.costBasis, portfolioCurrency) :
                           position.costBasisOriginalCurrency != null ? formatCurrency(position.costBasisOriginalCurrency, position.currency) :
                           'N/A'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Account</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          {position.bankName || 'N/A'}
                        </div>
                      </div>

                      {/* Period performance (WTD/MTD/YTD): mark-to-market price return
                          + this line's contribution to the portfolio's period return.
                          All values pre-computed server-side; '—' when the position had
                          no snapshot before the period start. */}
                      {(() => {
                        const linePerf = position.uniqueKey ? holdingPerfByKey[position.uniqueKey] : null;
                        const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v))
                          ? '—'
                          : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
                        const pctColor = (v) => (v === null || v === undefined || !Number.isFinite(v))
                          ? 'var(--text-muted)'
                          : (v >= 0 ? 'var(--gain-color)' : 'var(--loss-color)');
                        return ['wtd', 'mtd', 'ytd'].map((key) => {
                          const p = linePerf ? linePerf[key] : null;
                          return (
                            <div key={key}>
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{key.toUpperCase()}</div>
                              <div style={{ fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums', color: pctColor(p?.returnPercent) }}>
                                {fmtPct(p?.returnPercent)}
                              </div>
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                                Contrib {fmtPct(p?.contributionPercent)}
                              </div>
                            </div>
                          );
                        });
                      })()}

                      {/* Position actions - Buy/Sell for RM/Admin, Reclassify for Admin/Compliance */}
                      {['rm', 'admin', 'superadmin', 'compliance'].includes(user?.role) && (
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {['rm', 'admin', 'superadmin'].includes(user?.role) && (
                          <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openOrderModal('buy', position);
                            }}
                            style={{
                              padding: '6px 16px',
                              borderRadius: '6px',
                              border: 'none',
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: 'var(--gain-color)',
                              fontSize: '0.8rem',
                              fontWeight: '600',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(16, 185, 129, 0.25)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)';
                            }}
                          >
                            Buy More
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openOrderModal('sell', position);
                            }}
                            style={{
                              padding: '6px 16px',
                              borderRadius: '6px',
                              border: 'none',
                              background: 'rgba(239, 68, 68, 0.15)',
                              color: 'var(--loss-color)',
                              fontSize: '0.8rem',
                              fontWeight: '600',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                            }}
                          >
                            Sell
                          </button>
                          </>
                          )}
                          {/* Reclassify Button - Admin/Superadmin/Compliance only */}
                          {['admin', 'superadmin', 'compliance'].includes(user?.role) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReclassify(position);
                              }}
                              style={{
                                padding: '6px 16px',
                                borderRadius: '6px',
                                border: 'none',
                                background: 'rgba(139, 92, 246, 0.15)',
                                color: '#8b5cf6',
                                fontSize: '0.8rem',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(139, 92, 246, 0.25)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)';
                              }}
                            >
                              Reclassify
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            return (
              <div key={assetClass}>
                {/* Asset Class Header */}
                <div
                  onClick={() => toggleSection(assetClass)}
                  style={{
                    background: theme === 'light'
                      ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%)'
                      : 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: isMobile ? '1rem' : '0.75rem 1rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    // On phones the value + P&L string is too wide to sit beside
                    // the title, so stack them instead of clipping.
                    flexDirection: isMobile ? 'column' : 'row',
                    justifyContent: 'space-between',
                    alignItems: isMobile ? 'stretch' : 'center',
                    gap: '0.5rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                      <span style={{ fontSize: isMobile ? '0.9rem' : '0.8rem', color: 'var(--text-muted)' }}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: isMobile ? '600' : '500', color: 'var(--text-primary)', fontSize: isMobile ? '1.0625rem' : '0.95rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                          {assetClass.replace(/_/g, ' ')}
                        </div>
                        <div style={{ fontSize: isMobile ? '0.8125rem' : '0.7rem', color: isMobile ? 'var(--text-secondary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {subtotal.count} position{subtotal.count !== 1 ? 's' : ''} • {subtotal.percentage.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 0, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: isMobile ? '1.125rem' : '1rem', fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(subtotal.marketValue, portfolioCurrency)}
                      </div>
                      <div style={{
                        fontSize: isMobile ? '0.875rem' : '0.8rem',
                        fontWeight: '500',
                        color: subtotal.gainLoss >= 0 ? 'var(--gain-color)' : 'var(--loss-color)',
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                        {subtotal.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(subtotal.gainLoss), portfolioCurrency)}
                        <span style={{ marginLeft: '0.375rem' }}>
                          {subtotal.gainLossPercent >= 0 ? '+' : ''}{subtotal.gainLossPercent.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div style={isMobile ? {
                    // Mobile: cards are self-contained, so drop the outer frame
                    // and let each position read as a discrete block.
                    marginTop: '0.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem'
                  } : {
                    marginTop: '0.5rem',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)'
                  }}>
                    {/* Sub-Groups */}
                    {hasSubGroups && assetClass === 'structured_product' && Object.keys(group.subGroups).map((underlyingType, subIdx) => {
                      // Structured products have nested structure: underlyingType -> protectionType
                      const level1Group = group.subGroups[underlyingType];
                      const level1Total = subtotal.subTotals[underlyingType];
                      const level1Key = `${assetClass}_${underlyingType}`;
                      const isLevel1Expanded = expandedSections[level1Key];

                      return (
                        <div key={level1Key}>
                          {/* Level 1 Header - Underlying Type (e.g., Equity Linked) */}
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSection(level1Key);
                            }}
                            style={{
                              display: 'flex',
                              flexDirection: isMobile ? 'column' : 'row',
                              justifyContent: 'space-between',
                              alignItems: isMobile ? 'stretch' : 'center',
                              gap: '0.5rem',
                              padding: isMobile ? '0.875rem 1rem' : '0.625rem 1rem',
                              paddingLeft: isMobile ? '0.875rem' : '1.5rem',
                              background: theme === 'light' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.08)',
                              borderBottom: isMobile ? 'none' : '1px solid var(--border-color)',
                              border: isMobile ? '1px solid var(--border-color)' : undefined,
                              borderRadius: isMobile ? '8px' : undefined,
                              borderLeft: '3px solid rgba(16, 185, 129, 0.4)',
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                              <span style={{ fontSize: isMobile ? '0.85rem' : '0.7rem', color: 'var(--text-muted)' }}>
                                {isLevel1Expanded ? '▼' : '▶'}
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: isMobile ? '600' : '500', color: 'var(--text-primary)', fontSize: isMobile ? '1rem' : '0.85rem' }}>
                                  {getUnderlyingTypeLabel(underlyingType)}
                                </div>
                                <div style={{ fontSize: isMobile ? '0.8125rem' : '0.65rem', color: isMobile ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                                  {level1Total.count} position{level1Total.count !== 1 ? 's' : ''}
                                </div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', minWidth: 0, flexShrink: 0, whiteSpace: 'nowrap' }}>
                              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: isMobile ? '1.0625rem' : '0.9rem', fontVariantNumeric: 'tabular-nums' }}>
                                {formatCurrency(level1Total.marketValue, portfolioCurrency)}
                              </div>
                              <div style={{
                                fontSize: isMobile ? '0.875rem' : '0.75rem',
                                color: level1Total.gainLoss >= 0 ? 'var(--gain-color)' : 'var(--loss-color)',
                                fontVariantNumeric: 'tabular-nums'
                              }}>
                                {level1Total.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(level1Total.gainLoss), portfolioCurrency)}
                              </div>
                            </div>
                          </div>

                          {/* Level 2 - Protection Types within this Underlying Type */}
                          {isLevel1Expanded && Object.keys(level1Group.subGroups || {}).map((protectionType, level2Idx) => {
                            const level2Positions = level1Group.subGroups[protectionType];
                            const level2Total = level1Total.subTotals?.[protectionType];
                            const level2Key = `${assetClass}_${underlyingType}_${protectionType}`;
                            const isLevel2Expanded = expandedSections[level2Key];

                            if (!level2Total) return null;

                            return (
                              <div key={level2Key}>
                                {/* Level 2 Header - Protection Type (e.g., 100% Capital Guaranteed) */}
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSection(level2Key);
                                  }}
                                  style={{
                                    display: 'flex',
                                    flexDirection: isMobile ? 'column' : 'row',
                                    justifyContent: 'space-between',
                                    alignItems: isMobile ? 'stretch' : 'center',
                                    gap: '0.5rem',
                                    padding: isMobile ? '0.75rem 1rem' : '0.5rem 1rem',
                                    paddingLeft: isMobile ? '0.75rem' : '2.5rem',
                                    background: theme === 'light' ? 'rgba(59, 130, 246, 0.03)' : 'rgba(59, 130, 246, 0.05)',
                                    borderBottom: isMobile ? 'none' : '1px solid var(--border-color)',
                                    border: isMobile ? '1px solid var(--border-color)' : undefined,
                                    borderRadius: isMobile ? '8px' : undefined,
                                    margin: isMobile ? '0.5rem 0 0 0.5rem' : undefined,
                                    borderLeft: '3px solid rgba(59, 130, 246, 0.3)',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                                    <span style={{ fontSize: isMobile ? '0.8rem' : '0.65rem', color: 'var(--text-muted)' }}>
                                      {isLevel2Expanded ? '▼' : '▶'}
                                    </span>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontWeight: isMobile ? '600' : '500', color: 'var(--text-primary)', fontSize: isMobile ? '0.9375rem' : '0.8rem' }}>
                                        {getProtectionTypeLabel(protectionType)}
                                      </div>
                                      <div style={{ fontSize: isMobile ? '0.8125rem' : '0.6rem', color: isMobile ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                                        {level2Total.count} position{level2Total.count !== 1 ? 's' : ''}
                                      </div>
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'right', minWidth: 0, flexShrink: 0, whiteSpace: 'nowrap' }}>
                                    <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: isMobile ? '1rem' : '0.85rem', fontVariantNumeric: 'tabular-nums' }}>
                                      {formatCurrency(level2Total.marketValue, portfolioCurrency)}
                                    </div>
                                    <div style={{
                                      fontSize: isMobile ? '0.875rem' : '0.7rem',
                                      color: level2Total.gainLoss >= 0 ? 'var(--gain-color)' : 'var(--loss-color)',
                                      fontVariantNumeric: 'tabular-nums'
                                    }}>
                                      {level2Total.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(level2Total.gainLoss), portfolioCurrency)}
                                    </div>
                                  </div>
                                </div>

                                {/* Level 2 Positions */}
                                {isLevel2Expanded && (
                                  <div style={isMobile
                                    ? { paddingLeft: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }
                                    : { paddingLeft: '1.5rem' }}>
                                    {level2Positions.map((pos, idx) => renderPositionRow(pos, idx === level2Positions.length - 1))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}

                    {/* Sub-Groups for non-structured products (equity, fixed income) */}
                    {hasSubGroups && assetClass !== 'structured_product' && Object.keys(group.subGroups).map((subClass, subIdx) => {
                      const subPositions = group.subGroups[subClass];
                      const subTotal = subtotal.subTotals[subClass];
                      const subSectionKey = `${assetClass}_${subClass}`;
                      const isSubExpanded = expandedSections[subSectionKey];

                      return (
                        <div key={subSectionKey}>
                          {/* Sub-Group Header - Indented for hierarchy */}
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSection(subSectionKey);
                            }}
                            style={{
                              display: 'flex',
                              flexDirection: isMobile ? 'column' : 'row',
                              justifyContent: 'space-between',
                              alignItems: isMobile ? 'stretch' : 'center',
                              gap: '0.5rem',
                              padding: isMobile ? '0.875rem 1rem' : '0.625rem 1rem',
                              paddingLeft: isMobile ? '0.875rem' : '1.5rem',
                              background: theme === 'light' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.08)',
                              borderBottom: isMobile ? 'none' : '1px solid var(--border-color)',
                              border: isMobile ? '1px solid var(--border-color)' : undefined,
                              borderRadius: isMobile ? '8px' : undefined,
                              borderLeft: '3px solid rgba(16, 185, 129, 0.4)',
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                              <span style={{ fontSize: isMobile ? '0.85rem' : '0.7rem', color: 'var(--text-muted)' }}>
                                {isSubExpanded ? '▼' : '▶'}
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: isMobile ? '600' : '500', color: 'var(--text-primary)', fontSize: isMobile ? '1rem' : '0.85rem' }}>
                                  {subClass === 'direct_equity' ? 'Direct'
                                    : subClass === 'equity_fund' ? 'Funds'
                                    : subClass === 'direct_bond' ? 'Direct'
                                    : subClass === 'fixed_income_fund' ? 'Funds'
                                    : subClass}
                                </div>
                                <div style={{ fontSize: isMobile ? '0.8125rem' : '0.65rem', color: isMobile ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                                  {subTotal.count} position{subTotal.count !== 1 ? 's' : ''}
                                </div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', minWidth: 0, flexShrink: 0, whiteSpace: 'nowrap' }}>
                              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: isMobile ? '1.0625rem' : '0.9rem', fontVariantNumeric: 'tabular-nums' }}>
                                {formatCurrency(subTotal.marketValue, portfolioCurrency)}
                              </div>
                              <div style={{
                                fontSize: isMobile ? '0.875rem' : '0.75rem',
                                color: subTotal.gainLoss >= 0 ? 'var(--gain-color)' : 'var(--loss-color)',
                                fontVariantNumeric: 'tabular-nums'
                              }}>
                                {subTotal.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(subTotal.gainLoss), portfolioCurrency)}
                              </div>
                            </div>
                          </div>

                          {/* Sub-Group Positions - Indented */}
                          {isSubExpanded && (
                            <div style={isMobile
                              ? { paddingLeft: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }
                              : { paddingLeft: '1rem' }}>
                              {subPositions.map((pos, idx) => renderPositionRow(pos, idx === subPositions.length - 1))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Direct Positions (not in sub-groups) */}
                    {group.positions.map((pos, idx) => renderPositionRow(pos, idx === group.positions.length - 1 && !hasSubGroups))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    );
  };

  const renderTransactionsSection = () => {
    const accountFor = (op) => bankAccounts.find(acc => acc.bankId === op.bankName
      && acc.accountNumber && String(op.portfolioCode || '').startsWith(acc.accountNumber.split('-')[0]));
    return (
      <TransactionsSection
        operations={displayTransactions}
        isLoading={isLoadingOperations}
        isMobile={isMobile}
        theme={theme}
        bankNameFor={(op) => accountFor(op)?.bankName || op.bankLabel || ''}
        accountLabelFor={(op) => {
          const acc = accountFor(op);
          return acc ? `${acc.accountNumber}${acc.comment ? ` · ${acc.comment}` : ''}` : (op.portfolioCode || '');
        }}
        exportName="transactions"
      />
    );
  };

  const renderPerformanceSection = () => {
    // Loading state
    if (performanceLoading) {
      return (
        <div style={{ padding: '1.5rem' }}>
          <LiquidGlassCard>
            <div style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              color: 'var(--text-muted)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>⏳</div>
              <h3 style={{
                margin: '0 0 0.5rem 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem'
              }}>
                Loading Performance Data...
              </h3>
            </div>
          </LiquidGlassCard>
        </div>
      );
    }

    // TWR period definitions for metric cards
    const twrPeriodCards = [
      { key: '1M', label: '1 Month TWR' },
      { key: '3M', label: '3 Month TWR' },
      { key: '6M', label: '6 Month TWR' },
      { key: 'YTD', label: 'YTD TWR' },
      { key: '1Y', label: '1 Year TWR' },
      { key: 'ALL', label: 'Since Inception TWR' }
    ];

    // Get color from pre-computed TWR value
    const getTwrColor = (period) => {
      if (!period || !period.hasData) return 'var(--text-muted)';
      return period.twr >= 0 ? 'var(--gain-color)' : 'var(--loss-color)';
    };

    return (
    <div style={{ padding: '1rem' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        {/* TWR Performance Metrics */}
        {twrPeriodCards.map(({ key, label }) => {
          const period = twrData?.periods?.[key];
          return (
            <LiquidGlassCard key={key} style={{
            }}>
              <div style={{ padding: '1rem' }}>
                <div style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem',
                  fontWeight: '400'
                }}>
                  {label}
                </div>
                <div style={{
                  fontSize: '1.5rem',
                  fontWeight: '400',
                  color: getTwrColor(period)
                }}>
                  {period?.hasData ? period.twrFormatted : 'N/A'}
                </div>
                {key === 'ALL' && period?.isAnnualized && period?.twrAnnualizedFormatted && (
                  <div style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    marginTop: '0.25rem'
                  }}>
                    {period.twrAnnualizedFormatted}
                  </div>
                )}
              </div>
            </LiquidGlassCard>
          );
        })}
      </div>

      {/* TWR Performance Chart */}
      <LiquidGlassCard style={{
      }}>
        <div style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
            <h3 style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: '400',
              color: 'var(--text-primary)'
            }}>
              TWR Performance (Rebased to 100)
            </h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {['1M', '3M', '6M', 'YTD', '1Y', 'ALL'].map(range => (
                <button
                  key={range}
                  onClick={() => setSelectedTimeRange(range)}
                  style={{
                    padding: '0.4rem 0.75rem',
                    background: selectedTimeRange === range
                      ? 'var(--accent-color)'
                      : theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
                    color: selectedTimeRange === range ? '#ffffff' : 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                    fontWeight: '500',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          {(() => {
            // Filter TWR chart data based on selected time range
            const twrChart = twrData?.chartData;
            if (!twrChart || !twrChart.labels || twrChart.labels.length === 0) {
              return (
                <div style={{
                  textAlign: 'center',
                  padding: '4rem 2rem',
                  color: 'var(--text-muted)',
                  background: theme === 'light' ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.02)',
                  borderRadius: '8px',
                  border: '2px dashed var(--border-color)'
                }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📈</div>
                  <h3 style={{
                    margin: '0 0 0.5rem 0',
                    color: 'var(--text-secondary)',
                    fontSize: '1.1rem'
                  }}>
                    No Historical Data
                  </h3>
                  <p style={{
                    margin: 0,
                    fontSize: '0.875rem'
                  }}>
                    {viewAsFilter
                      ? `No performance data found for ${viewAsFilter.label || 'selected filter'}. Try clearing the filter or selecting a different client.`
                      : 'Performance history will appear here once you process bank files'}
                  </p>
                </div>
              );
            }

            // Slice chart data to selected time range
            const rangeStartDate = getStartDateForRange(selectedTimeRange);
            const rangeStartStr = rangeStartDate.toISOString().split('T')[0];
            let startIdx = 0;
            if (selectedTimeRange !== 'ALL') {
              for (let i = 0; i < twrChart.labels.length; i++) {
                if (twrChart.labels[i] >= rangeStartStr) {
                  startIdx = i;
                  break;
                }
              }
            }

            const filteredLabels = twrChart.labels.slice(startIdx);
            const filteredData = twrChart.datasets[0].data.slice(startIdx);

            return (
              <div style={{ height: '300px' }}>
                <Line
                  data={{
                    labels: filteredLabels,
                    datasets: [{
                      ...twrChart.datasets[0],
                      data: filteredData
                    }]
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                      mode: 'index',
                      intersect: false,
                    },
                    plugins: {
                      legend: {
                        display: true,
                        position: 'top',
                        labels: {
                          color: theme === 'light' ? '#374151' : '#d1d5db',
                          font: { size: 12 }
                        }
                      },
                      tooltip: {
                        backgroundColor: theme === 'light' ? '#ffffff' : '#1f2937',
                        titleColor: theme === 'light' ? '#111827' : '#f9fafb',
                        bodyColor: theme === 'light' ? '#374151' : '#d1d5db',
                        borderColor: theme === 'light' ? '#e5e7eb' : '#374151',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                          label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                              label += context.parsed.y.toFixed(2);
                            }
                            return label;
                          }
                        }
                      }
                    },
                    scales: {
                      x: {
                        grid: {
                          color: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'
                        },
                        ticks: {
                          color: theme === 'light' ? '#6b7280' : '#9ca3af',
                          maxRotation: 45,
                          minRotation: 0
                        }
                      },
                      y: {
                        beginAtZero: false,
                        grace: '5%',
                        grid: {
                          color: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'
                        },
                        ticks: {
                          color: theme === 'light' ? '#6b7280' : '#9ca3af',
                          callback: function(value) {
                            return value.toFixed(1);
                          }
                        }
                      }
                    }
                  }}
                />
              </div>
            );
          })()}
        </div>
      </LiquidGlassCard>

      {/* TWR Performance Summary Table */}
      <LiquidGlassCard style={{
        marginTop: '1rem',
      }}>
        <div style={{ padding: '1rem' }}>
          <h3 style={{
            margin: '0 0 1rem 0',
            fontSize: '1.1rem',
            fontWeight: '400',
            color: 'var(--text-primary)'
          }}>
            TWR Performance Summary
          </h3>
          {twrData?.hasData && twrData?.periods ? (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600' }}>Period</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: '600' }}>Start Date</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: '600' }}>End Date</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: '600' }}>Data Points</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: '600' }}>TWR</th>
                  </tr>
                </thead>
                <tbody>
                  {['1M', '3M', '6M', 'YTD', '1Y', 'ALL'].map(periodKey => {
                    const period = twrData.periods[periodKey];
                    if (!period || !period.hasData) return null;
                    const periodLabels = {
                      '1M': '1 Month',
                      '3M': '3 Months',
                      '6M': '6 Months',
                      'YTD': 'Year to Date',
                      '1Y': '1 Year',
                      'ALL': 'Since Inception'
                    };
                    const isPositive = period.twr >= 0;

                    return (
                      <tr key={periodKey} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.75rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {periodLabels[periodKey] || periodKey}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                          {period.startDate || 'N/A'}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                          {period.endDate || 'N/A'}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {period.dataPoints || 0}
                        </td>
                        <td style={{
                          padding: '0.75rem',
                          textAlign: 'right',
                          fontWeight: '700',
                          fontSize: '1rem',
                          color: isPositive ? 'var(--gain-color)' : 'var(--loss-color)'
                        }}>
                          {period.twrFormatted}
                          {periodKey === 'ALL' && period.isAnnualized && period.twrAnnualizedFormatted && (
                            <div style={{ fontSize: '0.7rem', fontWeight: '400', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                              {period.twrAnnualizedFormatted}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {twrData.metadata && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Data from {twrData.metadata.firstSnapshotDate} to {twrData.metadata.lastSnapshotDate} | {twrData.metadata.externalFlowCount} external flows detected
                  {twrData.metadata.currency ? ` | in ${twrData.metadata.currency}` : ''}
                  {twrData.metadata.excludedAccounts?.length > 0 && (
                    <div style={{ marginTop: '0.2rem' }}>
                      Investment accounts only — excluded: {twrData.metadata.excludedAccounts.map(a => `${a.accountNumber}${a.comment ? ` (${a.comment})` : ''}`).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '2rem',
              color: 'var(--text-muted)',
              fontSize: '0.875rem'
            }}>
              No TWR performance data available
            </div>
          )}
        </div>
      </LiquidGlassCard>

      {/* Monthly & yearly performance (time-weighted, from the server's computeTWR) */}
      {twrData?.calendarCharts?.monthly?.labels?.length > 0 && (() => {
        const chart = twrData.calendarCharts[calendarMode];
        const yearRows = twrData.yearlyReturns || [];
        const monthByKey = Object.fromEntries((twrData.monthlyReturns || []).map(m => [m.key, m]));
        const monthCols = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
        const monthHeads = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const gridColor = theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
        const tickColor = theme === 'light' ? '#6b7280' : '#9ca3af';
        const cellColor = (row) => (!row ? 'var(--text-muted)' : row.isPositive ? 'var(--gain-color)' : 'var(--loss-color)');
        const cell = { padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
        return (
          <LiquidGlassCard style={{ marginTop: '1rem' }}>
            <div style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '400', color: 'var(--text-primary)' }}>
                  {calendarMode === 'monthly' ? 'Monthly' : 'Yearly'} Performance (time-weighted)
                </h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {[{ key: 'monthly', label: 'Monthly' }, { key: 'yearly', label: 'Yearly' }].map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setCalendarMode(opt.key)}
                      style={{
                        padding: '0.4rem 0.75rem',
                        background: calendarMode === opt.key
                          ? 'var(--accent-color)'
                          : theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
                        color: calendarMode === opt.key ? '#ffffff' : 'var(--text-secondary)',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.7rem',
                        fontWeight: '500'
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Many months scroll sideways instead of squeezing the bars */}
              <div style={{ overflowX: 'auto' }}>
                <div style={{ height: '280px', minWidth: calendarMode === 'monthly' ? `${chart.labels.length * 34}px` : undefined }}>
                  <Bar
                    data={{ labels: chart.labels, datasets: chart.datasets }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          backgroundColor: theme === 'light' ? '#ffffff' : '#1f2937',
                          titleColor: theme === 'light' ? '#111827' : '#f9fafb',
                          bodyColor: theme === 'light' ? '#374151' : '#d1d5db',
                          borderColor: theme === 'light' ? '#e5e7eb' : '#374151',
                          borderWidth: 1,
                          padding: 10,
                          callbacks: {
                            label: (ctx) => {
                              const t = chart.tooltips?.[ctx.dataIndex];
                              return t ? [`TWR ${t.value}${t.partial ? ' (partial period)' : ''}`, t.range] : '';
                            }
                          }
                        }
                      },
                      scales: {
                        x: { grid: { display: false }, ticks: { color: tickColor, maxRotation: 45, minRotation: 0 } },
                        y: {
                          grace: '10%',
                          grid: { color: gridColor },
                          ticks: { color: tickColor, callback: (value) => `${value}%` }
                        }
                      }
                    }}
                  />
                </div>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                Return net of deposits and withdrawals, in {twrData.metadata?.currency || portfolioCurrency}. * partial period (first valuation inside it, or still running).
              </div>

              {/* Year × month table of the same pre-formatted figures */}
              <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr>
                      <th style={{ ...cell, textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Year</th>
                      {monthHeads.map(h => <th key={h} style={{ ...cell, color: 'var(--text-secondary)', fontWeight: 600 }}>{h}</th>)}
                      <th style={{ ...cell, color: 'var(--text-primary)', fontWeight: 700 }}>Year</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...yearRows].reverse().map(y => (
                      <tr key={y.key}>
                        <td style={{ ...cell, textAlign: 'left', fontWeight: 600, color: 'var(--text-primary)' }}>{y.key}</td>
                        {monthCols.map(mm => {
                          const m = monthByKey[`${y.key}-${mm}`];
                          return (
                            <td key={mm} style={{ ...cell, color: cellColor(m) }} title={m?.rangeText || ''}>
                              {m ? `${m.twrFormatted}${m.isPartial ? '*' : ''}` : '–'}
                            </td>
                          );
                        })}
                        <td style={{ ...cell, fontWeight: 700, color: cellColor(y) }} title={y.rangeText}>
                          {y.twrFormatted}{y.isPartial ? '*' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </LiquidGlassCard>
        );
      })()}

      {/* Portfolio Value Over Time (Absolute) */}
      <LiquidGlassCard style={{
        marginTop: '1rem',
      }}>
        <div style={{ padding: '1rem' }}>
          <h3 style={{
            margin: '0 0 1rem 0',
            fontSize: '1.1rem',
            fontWeight: '400',
            color: 'var(--text-primary)'
          }}>
            Portfolio Value Over Time
          </h3>
          {!chartLoading && chartData?.convertedAtSpot && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '-0.5rem 0 0.75rem' }}>
              Shown in {chartData.valueCurrency}, converted from the accounts' currencies at current spot rates
            </div>
          )}
          {chartLoading ? (
            <div style={{
              height: '300px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏳</div>
                <div>Loading chart data...</div>
              </div>
            </div>
          ) : chartData && chartData.hasData ? (
            <div style={{ height: '300px' }}>
              <Line
                data={{
                  labels: chartData.labels || [],
                  datasets: chartData.datasets || []
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: {
                    mode: 'index',
                    intersect: false,
                  },
                  plugins: {
                    legend: {
                      display: true,
                      position: 'top',
                      labels: {
                        color: theme === 'light' ? '#374151' : '#d1d5db',
                        font: { size: 12 }
                      }
                    },
                    tooltip: {
                      backgroundColor: theme === 'light' ? '#ffffff' : '#1f2937',
                      titleColor: theme === 'light' ? '#111827' : '#f9fafb',
                      bodyColor: theme === 'light' ? '#374151' : '#d1d5db',
                      borderColor: theme === 'light' ? '#e5e7eb' : '#374151',
                      borderWidth: 1,
                      padding: 12,
                      callbacks: {
                        label: function(context) {
                          let label = context.dataset.label || '';
                          if (label) label += ': ';
                          if (context.parsed.y !== null) {
                            label += formatCurrency(context.parsed.y, chartData.valueCurrency || portfolioCurrency);
                          }
                          return label;
                        }
                      }
                    }
                  },
                  scales: {
                    x: {
                      grid: {
                        color: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'
                      },
                      ticks: {
                        color: theme === 'light' ? '#6b7280' : '#9ca3af',
                        maxRotation: 45,
                        minRotation: 0
                      }
                    },
                    y: {
                      beginAtZero: false,
                      grace: '5%',
                      grid: {
                        color: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'
                      },
                      ticks: {
                        color: theme === 'light' ? '#6b7280' : '#9ca3af',
                        callback: function(value) {
                          return formatCurrency(value, chartData.valueCurrency || portfolioCurrency);
                        }
                      }
                    }
                  }
                }}
              />
            </div>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '2rem',
              color: 'var(--text-muted)',
              fontSize: '0.875rem'
            }}>
              No portfolio value data available
            </div>
          )}
        </div>
      </LiquidGlassCard>

      {/* Asset Allocation */}
      <LiquidGlassCard style={{
        marginTop: '1rem',
      }}>
        <div style={{ padding: '1rem' }}>
          <h3 style={{
            margin: '0 0 1rem 0',
            fontSize: '1.1rem',
            fontWeight: '400',
            color: 'var(--text-primary)'
          }}>
            Asset Allocation
          </h3>
          {assetAllocation && assetAllocation.hasData ? (
            <div>
              <div style={{ marginBottom: '1.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                As of {new Date(assetAllocation.snapshotDate).toLocaleDateString()}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
                gap: '1.5rem',
                alignItems: 'start'
              }}>
                {/* Doughnut Chart */}
                <div style={{ maxWidth: '350px', margin: '0 auto', width: '100%' }}>
                  <Doughnut
                    data={{
                      labels: assetAllocation.assetClasses.map(ac => ac.name),
                      datasets: [{
                        data: assetAllocation.assetClasses.map(ac => ac.value),
                        // Canvas cannot resolve CSS variables — resolve to computed values
                        backgroundColor: resolveChartColors([
                          'var(--gain-color)', // Green - Structured Products
                          'var(--info-color)', // Blue - Equities
                          'var(--warning-color)', // Orange - Direct Bonds
                          '#8b5cf6', // Purple - Cash
                          '#ec4899', // Pink - Other
                          '#06b6d4', // Cyan - Additional
                          '#f97316'  // Red-Orange - Additional
                        ]),
                        borderColor: theme === 'light' ? '#ffffff' : '#111827',
                        borderWidth: 2
                      }]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: true,
                      plugins: {
                        legend: {
                          display: false
                        },
                        tooltip: {
                          backgroundColor: theme === 'light' ? '#ffffff' : '#1f2937',
                          titleColor: theme === 'light' ? '#111827' : '#f9fafb',
                          bodyColor: theme === 'light' ? '#374151' : '#d1d5db',
                          borderColor: theme === 'light' ? '#e5e7eb' : '#374151',
                          borderWidth: 1,
                          padding: 12,
                          callbacks: {
                            label: function(context) {
                              const label = context.label || '';
                              const value = context.parsed || 0;
                              const percentage = ((value / assetAllocation.totalValue) * 100).toFixed(1);
                              return `${label}: ${formatCurrency(value, portfolioCurrency)} (${percentage}%)`;
                            }
                          }
                        }
                      }
                    }}
                  />
                </div>

                {/* Legend / List */}
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {assetAllocation.assetClasses.map((assetClass, idx) => {
                    const colors = ['var(--gain-color)', 'var(--info-color)', 'var(--warning-color)', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
                    return (
                      <div key={idx} style={{
                        padding: '0.6rem',
                        background: 'var(--bg-tertiary)',
                        borderRadius: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderLeft: `3px solid ${colors[idx % colors.length]}`
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.8rem', marginBottom: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {assetClass.name}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                            {formatCurrency(assetClass.value, portfolioCurrency)}
                          </div>
                        </div>
                        <div style={{
                          fontSize: '0.9rem',
                          fontWeight: '700',
                          color: colors[idx % colors.length],
                          marginLeft: '0.5rem',
                          flexShrink: 0
                        }}>
                          {assetClass.percentage.toFixed(1)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              color: 'var(--text-muted)',
              background: theme === 'light' ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              border: '2px dashed var(--border-color)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>🥧</div>
              <h3 style={{
                margin: '0 0 0.5rem 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem'
              }}>
                No Asset Allocation Data
              </h3>
              <p style={{
                margin: 0,
                fontSize: '0.875rem'
              }}>
                Asset allocation will appear here once you process bank files
              </p>
            </div>
          )}
        </div>
      </LiquidGlassCard>

      {/* Structured Products Breakdown - Hierarchical View */}
      {structuredProductHierarchy.hasData && (
        <LiquidGlassCard style={{
          marginTop: '1rem',
        }}>
          <div style={{ padding: '1rem' }}>
            <h3 style={{
              margin: '0 0 1rem 0',
              fontSize: '1.1rem',
              fontWeight: '400',
              color: 'var(--text-primary)'
            }}>
              Structured Products Breakdown
            </h3>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
              gap: '1.5rem',
              alignItems: 'start'
            }}>
              {/* Nested Doughnut Chart */}
              <div style={{ maxWidth: '350px', margin: '0 auto', width: '100%' }}>
                <NestedDoughnutChart
                  level1Data={structuredProductHierarchy.level1}
                  level2Data={structuredProductHierarchy.level2}
                  theme={theme}
                  formatCurrency={formatCurrency}
                  currency={portfolioCurrency}
                  totalValue={structuredProductHierarchy.totalStructuredValue}
                />
              </div>

              {/* Hierarchical Legend */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {structuredProductHierarchy.level1.map((level1Item) => {
                  const level1Colors = {
                    'equity_linked': 'var(--info-color)',
                    'fixed_income_linked': 'var(--warning-color)',
                    'credit_linked': '#8b5cf6',
                    'commodities_linked': '#ec4899',
                    'other': '#64748b'
                  };
                  const color = level1Colors[level1Item.key] || '#64748b';
                  const childItems = structuredProductHierarchy.level2.filter(l2 => l2.parent === level1Item.key);

                  return (
                    <div key={level1Item.key}>
                      {/* Level 1 Header (Underlying Type) */}
                      <div style={{
                        padding: '0.6rem',
                        background: 'var(--bg-tertiary)',
                        borderRadius: '6px',
                        borderLeft: `4px solid ${color}`,
                        marginBottom: '0.25rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                            {level1Item.name}
                          </div>
                          <div style={{ fontSize: '0.9rem', fontWeight: '700', color }}>
                            {level1Item.percentage.toFixed(1)}%
                          </div>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                          {formatCurrency(level1Item.value, portfolioCurrency)}
                        </div>
                      </div>

                      {/* Level 2 Children (Protection Types - indented) */}
                      {childItems.map((level2Item) => (
                        <div key={level2Item.key} style={{
                          padding: '0.4rem 0.6rem',
                          marginLeft: '1rem',
                          background: 'var(--bg-secondary)',
                          borderRadius: '4px',
                          borderLeft: `2px solid color-mix(in srgb, ${color} 80%, transparent)`,
                          marginBottom: '0.15rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {level2Item.name}
                          </div>
                          <div style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)' }}>
                            {level2Item.percentage.toFixed(1)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </LiquidGlassCard>
      )}

      {/* Currency Allocation */}
      <LiquidGlassCard style={{
        marginTop: '1rem',
      }}>
        <div style={{ padding: '1rem' }}>
          <h3 style={{
            margin: '0 0 1rem 0',
            fontSize: '1.1rem',
            fontWeight: '400',
            color: 'var(--text-primary)'
          }}>
            Currency Allocation
          </h3>
          {currencyAllocation && currencyAllocation.hasData ? (
            <div>
              <div style={{ marginBottom: '1.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                As of {new Date(currencyAllocation.snapshotDate).toLocaleDateString()}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
                gap: '1.5rem',
                alignItems: 'start'
              }}>
                {/* Doughnut Chart */}
                <div style={{ maxWidth: '350px', margin: '0 auto', width: '100%' }}>
                  <Doughnut
                    data={{
                      labels: currencyAllocation.currencies.map(c => c.name),
                      datasets: [{
                        data: currencyAllocation.currencies.map(c => c.value),
                        backgroundColor: currencyAllocation.currencies.map((c, idx) => {
                          const currencyColors = {
                            'EUR': 'var(--info-color)',  // Blue
                            'USD': 'var(--gain-color)',  // Green
                            'CHF': 'var(--loss-color)',  // Red
                            'GBP': '#8b5cf6',  // Purple
                            'JPY': 'var(--warning-color)',  // Orange
                            'AUD': '#06b6d4',  // Cyan
                            'CAD': '#ec4899',  // Pink
                            'HKD': '#14b8a6',  // Teal
                            'SGD': '#f97316',  // Orange-Red
                            'CNY': '#dc2626',  // Dark Red
                            'SEK': '#0891b2',  // Dark Cyan
                            'NOK': '#7c3aed',  // Violet
                            'DKK': '#db2777'   // Pink-Red
                          };
                          const defaultColors = ['#64748b', '#475569', 'var(--neutral-color)', '#6b7280', '#4b5563'];
                          // Canvas cannot resolve CSS variables — resolve to computed values
                          return resolveChartColor(currencyColors[c.name] || defaultColors[idx % defaultColors.length]);
                        }),
                        borderColor: theme === 'light' ? '#ffffff' : '#111827',
                        borderWidth: 2
                      }]
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: true,
                      plugins: {
                        legend: {
                          display: false
                        },
                        tooltip: {
                          backgroundColor: theme === 'light' ? '#ffffff' : '#1f2937',
                          titleColor: theme === 'light' ? '#111827' : '#f9fafb',
                          bodyColor: theme === 'light' ? '#374151' : '#d1d5db',
                          borderColor: theme === 'light' ? '#e5e7eb' : '#374151',
                          borderWidth: 1,
                          padding: 12,
                          callbacks: {
                            label: function(context) {
                              const label = context.label || '';
                              const value = context.parsed || 0;
                              const percentage = ((value / currencyAllocation.totalValue) * 100).toFixed(1);
                              return `${label}: ${formatCurrency(value, portfolioCurrency)} (${percentage}%)`;
                            }
                          }
                        }
                      }
                    }}
                  />
                </div>

                {/* Legend / List */}
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {currencyAllocation.currencies.map((currency, idx) => {
                    const currencyColors = {
                      'EUR': 'var(--info-color)',
                      'USD': 'var(--gain-color)',
                      'CHF': 'var(--loss-color)',
                      'GBP': '#8b5cf6',
                      'JPY': 'var(--warning-color)',
                      'AUD': '#06b6d4',
                      'CAD': '#ec4899',
                      'HKD': '#14b8a6',
                      'SGD': '#f97316',
                      'CNY': '#dc2626',
                      'SEK': '#0891b2',
                      'NOK': '#7c3aed',
                      'DKK': '#db2777'
                    };
                    const defaultColors = ['#64748b', '#475569', 'var(--neutral-color)', '#6b7280', '#4b5563'];
                    const color = currencyColors[currency.name] || defaultColors[idx % defaultColors.length];
                    return (
                      <div key={idx} style={{
                        padding: '0.6rem',
                        background: 'var(--bg-tertiary)',
                        borderRadius: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderLeft: `3px solid ${color}`
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.8rem', marginBottom: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {currency.name}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                            {formatCurrency(currency.value, portfolioCurrency)}
                          </div>
                        </div>
                        <div style={{
                          fontSize: '0.9rem',
                          fontWeight: '700',
                          color: color,
                          marginLeft: '0.5rem',
                          flexShrink: 0
                        }}>
                          {currency.percentage.toFixed(1)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              color: 'var(--text-muted)',
              background: theme === 'light' ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              border: '2px dashed var(--border-color)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>💱</div>
              <h3 style={{
                margin: '0 0 0.5rem 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem'
              }}>
                No Currency Data
              </h3>
              <p style={{
                margin: 0,
                fontSize: '0.875rem'
              }}>
                Currency allocation will appear here once you process bank files
              </p>
            </div>
          )}
        </div>
      </LiquidGlassCard>

      {/* Issuer Allocation (Structured Products) */}
      {issuerAllocation && issuerAllocation.hasData && (
        <LiquidGlassCard style={{
          marginTop: '1rem',
        }}>
          <div style={{ padding: '1rem' }}>
            <h3 style={{
              margin: '0 0 1rem 0',
              fontSize: '1.1rem',
              fontWeight: '400',
              color: 'var(--text-primary)'
            }}>
              Issuer Allocation <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '400' }}>(Structured Products)</span>
            </h3>
            <div style={{ marginBottom: '1.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              {issuerAllocation.issuers.length} issuer{issuerAllocation.issuers.length > 1 ? 's' : ''} · Total {formatCurrency(issuerAllocation.totalValue, portfolioCurrency)}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
              gap: '1.5rem',
              alignItems: 'start'
            }}>
              {/* Doughnut Chart */}
              <div style={{ maxWidth: '350px', margin: '0 auto', width: '100%' }}>
                {(() => {
                  // Consistent palette + stable color per issuer based on a
                  // simple hash so the same issuer keeps the same colour
                  // across renders even when ordering changes.
                  const palette = [
                    'var(--info-color)', 'var(--gain-color)', 'var(--warning-color)', '#8b5cf6', 'var(--loss-color)',
                    '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#a855f7',
                    '#0891b2', '#dc2626', '#7c3aed', '#db2777', '#64748b'
                  ];
                  const colorFor = (name) => {
                    let h = 0;
                    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
                    return palette[h % palette.length];
                  };
                  return (
                    <Doughnut
                      data={{
                        labels: issuerAllocation.issuers.map(i => i.name),
                        datasets: [{
                          data: issuerAllocation.issuers.map(i => i.value),
                          // Canvas cannot resolve CSS variables — resolve to computed values
                          backgroundColor: issuerAllocation.issuers.map(i => resolveChartColor(colorFor(i.name))),
                          borderColor: theme === 'light' ? '#ffffff' : '#111827',
                          borderWidth: 2
                        }]
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                          legend: { display: false },
                          tooltip: {
                            callbacks: {
                              label: (ctx) => {
                                const value = ctx.parsed;
                                const pct = ((value / issuerAllocation.totalValue) * 100).toFixed(1);
                                return `${ctx.label}: ${formatCurrency(value, portfolioCurrency)} (${pct}%)`;
                              }
                            }
                          }
                        }
                      }}
                    />
                  );
                })()}
              </div>

              {/* Legend / breakdown list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {(() => {
                  const palette = [
                    'var(--info-color)', 'var(--gain-color)', 'var(--warning-color)', '#8b5cf6', 'var(--loss-color)',
                    '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#a855f7',
                    '#0891b2', '#dc2626', '#7c3aed', '#db2777', '#64748b'
                  ];
                  const colorFor = (name) => {
                    let h = 0;
                    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
                    return palette[h % palette.length];
                  };
                  return issuerAllocation.issuers.map(issuer => {
                    const color = colorFor(issuer.name);
                    return (
                      <div
                        key={issuer.name}
                        style={{
                          display: 'flex', alignItems: 'center',
                          padding: '0.5rem 0.75rem',
                          background: theme === 'light' ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.04)',
                          borderRadius: '6px',
                          borderLeft: `4px solid ${color}`,
                          gap: '0.75rem'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontWeight: '600',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                          }}>
                            {issuer.name}
                          </div>
                          <div style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            color: 'var(--text-muted)',
                            fontSize: '0.78rem'
                          }}>
                            {formatCurrency(issuer.value, portfolioCurrency)}
                          </div>
                        </div>
                        <div style={{
                          fontSize: '0.9rem',
                          fontWeight: '700',
                          color: color,
                          flexShrink: 0
                        }}>
                          {issuer.percentage.toFixed(1)}%
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </LiquidGlassCard>
      )}
    </div>
    );
  };

  const renderAlertsSection = () => {
    // Loading state
    if (isLoading || notificationAlertsLoading) {
      return (
        <div style={{ padding: '1.5rem' }}>
          <LiquidGlassCard>
            <div style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              color: 'var(--text-muted)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>⏳</div>
              <h3 style={{
                margin: '0 0 0.5rem 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem'
              }}>
                Loading Alerts...
              </h3>
            </div>
          </LiquidGlassCard>
        </div>
      );
    }

    // Get cash positions only
    const cashPositions = filteredHoldings.filter(pos => pos.assetClass === 'cash');

    // Group cash positions by account (userId + portfolioCode + bankId)
    const accountCashBalances = {};

    cashPositions.forEach(pos => {
      const accountKey = `${pos.userId}|${pos.portfolioCode}|${pos.bankId}`;

      if (!accountCashBalances[accountKey]) {
        accountCashBalances[accountKey] = {
          userId: pos.userId,
          portfolioCode: pos.portfolioCode,
          bankId: pos.bankId,
          bankName: pos.bankName,  // Store bankName from the holding record
          userName: pos.userName || 'Unknown',
          totalBalance: 0, // in portfolio currency
          currencies: {},
          lastUpdate: pos.snapshotDate || pos.fileDate || new Date()
        };
      }

      // Add to total balance (in portfolio currency)
      const balanceValue = pos.marketValue || 0;
      accountCashBalances[accountKey].totalBalance += balanceValue;

      // Track per-currency balances
      const currency = pos.currency || 'UNKNOWN';
      if (!accountCashBalances[accountKey].currencies[currency]) {
        accountCashBalances[accountKey].currencies[currency] = {
          balance: 0,
          balanceOriginal: 0
        };
      }
      accountCashBalances[accountKey].currencies[currency].balance += balanceValue;
      accountCashBalances[accountKey].currencies[currency].balanceOriginal += (pos.marketValueOriginalCurrency || balanceValue);
    });

    // Filter for negative balances only
    const negativeBalances = Object.values(accountCashBalances)
      .filter(account => account.totalBalance < 0)
      .sort((a, b) => a.totalBalance - b.totalBalance); // Most negative first

    // Enrich with bank and account details
    const enrichedAlerts = negativeBalances.map(alert => {
      const account = bankAccounts.find(acc =>
        acc.userId === alert.userId &&
        acc.accountNumber === alert.portfolioCode &&
        acc.bankId === alert.bankId
      );
      // Use bankName from holdings first (stored during parsing), fallback to BanksCollection lookup
      const bank = BanksCollection.findOne({ _id: alert.bankId });

      return {
        ...alert,
        bankName: alert.bankName || bank?.name || 'Unknown Bank',
        accountNumber: account?.accountNumber || alert.portfolioCode,
        accountType: account?.accountType || 'N/A',
        accountStructure: account?.accountStructure || 'N/A',
        referenceCurrency: account?.referenceCurrency || 'EUR'
      };
    });

    // Empty state - check both notification alerts and cash balance alerts
    if (enrichedAlerts.length === 0 && notificationAlerts.length === 0) {
      return (
        <div style={{ padding: '1.5rem' }}>
          <LiquidGlassCard>
            <div style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              color: 'var(--text-muted)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>✅</div>
              <h3 style={{
                margin: '0 0 0.5rem 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem'
              }}>
                No Alerts
              </h3>
              <p style={{
                margin: '0',
                fontSize: '0.95rem',
                color: 'var(--text-muted)'
              }}>
                All accounts in your perimeter have no active alerts.
              </p>
            </div>
          </LiquidGlassCard>
        </div>
      );
    }

    // Display alerts
    return (
      <div style={{ padding: '1.5rem' }}>
        {/* Notification-based Alerts */}
        {notificationAlerts.length > 0 && (
          <>
            <LiquidGlassCard style={{ marginBottom: '1.5rem' }}>
              <div style={{
                padding: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem'
              }}>
                <div style={{
                  fontSize: '3rem',
                  lineHeight: '1'
                }}>
                  🚨
                </div>
                <div style={{ flex: 1 }}>
                  <h2 style={{
                    margin: '0 0 0.5rem 0',
                    fontSize: '1.5rem',
                    color: 'var(--text-primary)'
                  }}>
                    System Alerts
                  </h2>
                  <p style={{
                    margin: '0',
                    fontSize: '0.95rem',
                    color: 'var(--text-secondary)'
                  }}>
                    {notificationAlerts.length} active alert{notificationAlerts.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </LiquidGlassCard>

            {/* Notification Alert Cards */}
            {notificationAlerts.map((notification, index) => (
              <LiquidGlassCard key={notification._id || index} style={{ marginBottom: '1rem' }}>
                <div style={{
                  padding: '1.5rem',
                  borderLeft: `4px solid ${notification.eventType === 'critical_alert' ? 'var(--loss-color)' : 'var(--warning-color)'}`
                }}>
                  {/* Header Row */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '0.75rem'
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        marginBottom: '0.5rem'
                      }}>
                        <span style={{
                          fontSize: '1.2rem',
                          fontWeight: '700',
                          color: 'var(--text-primary)'
                        }}>
                          {notification.title || notification.productName || 'Alert'}
                        </span>
                        <span style={{
                          fontSize: '0.75rem',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          backgroundColor: notification.eventType === 'critical_alert' ? '#fef2f2' : '#fffbeb',
                          color: notification.eventType === 'critical_alert' ? 'var(--loss-color)' : 'var(--warning-color)',
                          fontWeight: '600',
                          textTransform: 'uppercase'
                        }}>
                          {notification.eventType === 'critical_alert' ? 'Critical' : 'Warning'}
                        </span>
                      </div>
                      <p style={{
                        margin: '0',
                        fontSize: '0.95rem',
                        color: 'var(--text-secondary)',
                        lineHeight: '1.5'
                      }}>
                        {notification.message || notification.summary || ''}
                      </p>
                    </div>
                  </div>

                  {/* Footer with date */}
                  <div style={{
                    marginTop: '0.75rem',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)'
                  }}>
                    {new Date(notification.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </LiquidGlassCard>
            ))}
          </>
        )}

        {/* Cash Balance Alerts - Summary Header */}
        {enrichedAlerts.length > 0 && (
          <>
        <LiquidGlassCard style={{ marginBottom: '1.5rem' }}>
          <div style={{
            padding: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <div style={{
              fontSize: '3rem',
              lineHeight: '1'
            }}>
              ⚠️
            </div>
            <div style={{ flex: 1 }}>
              <h2 style={{
                margin: '0 0 0.5rem 0',
                fontSize: '1.5rem',
                color: 'var(--text-primary)'
              }}>
                Negative Cash Balance Alerts
              </h2>
              <p style={{
                margin: '0',
                fontSize: '0.95rem',
                color: 'var(--text-secondary)'
              }}>
                {enrichedAlerts.length} account{enrichedAlerts.length !== 1 ? 's' : ''} with negative cash balance
              </p>
            </div>
            <div style={{
              textAlign: 'right',
              fontSize: '2rem',
              fontWeight: '700',
              color: 'var(--loss-color)'
            }}>
              {enrichedAlerts.reduce((sum, alert) => sum + alert.totalBalance, 0).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </div>
          </div>
        </LiquidGlassCard>

        {/* Alert Cards */}
        {enrichedAlerts.map((alert, index) => (
          <LiquidGlassCard key={index} style={{ marginBottom: '1rem' }}>
            <div style={{
              padding: '1.5rem',
              borderLeft: '4px solid var(--loss-color)'
            }}>
              {/* Header Row */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '1rem'
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '1.2rem',
                    fontWeight: '700',
                    color: 'var(--text-primary)',
                    marginBottom: '0.5rem'
                  }}>
                    {alert.userName}
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '1.5rem',
                    flexWrap: 'wrap',
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)'
                  }}>
                    <div>
                      <span style={{ fontWeight: '600' }}>Bank:</span>{' '}
                      {alert.bankName}
                    </div>
                    <div>
                      <span style={{ fontWeight: '600' }}>Account:</span>{' '}
                      {alert.accountNumber}
                    </div>
                    <div>
                      <span style={{ fontWeight: '600' }}>Portfolio Code:</span>{' '}
                      {alert.portfolioCode}
                    </div>
                  </div>
                </div>
                <div style={{
                  textAlign: 'right',
                  paddingLeft: '1rem'
                }}>
                  <div style={{
                    fontSize: '1.8rem',
                    fontWeight: '700',
                    color: 'var(--loss-color)',
                    marginBottom: '0.25rem'
                  }}>
                    {alert.totalBalance.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </div>
                  <div style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)'
                  }}>
                    {alert.referenceCurrency}
                  </div>
                </div>
              </div>

              {/* Currency Breakdown */}
              {Object.keys(alert.currencies).length > 1 && (
                <div style={{
                  marginTop: '1rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid var(--border-color)'
                }}>
                  <div style={{
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    marginBottom: '0.75rem'
                  }}>
                    Currency Breakdown:
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '1.5rem',
                    flexWrap: 'wrap'
                  }}>
                    {Object.entries(alert.currencies).map(([currency, data]) => (
                      <div key={currency} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.9rem'
                      }}>
                        <span style={{
                          fontWeight: '600',
                          color: 'var(--text-secondary)'
                        }}>
                          {currency}:
                        </span>
                        <span style={{
                          color: data.balanceOriginal < 0 ? 'var(--loss-color)' : 'var(--text-primary)',
                          fontWeight: data.balanceOriginal < 0 ? '600' : '400'
                        }}>
                          {data.balanceOriginal.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Last Update */}
              <div style={{
                marginTop: '1rem',
                fontSize: '0.8rem',
                color: 'var(--text-muted)'
              }}>
                Last updated: {new Date(alert.lastUpdate).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric'
                })}
              </div>
            </div>
          </LiquidGlassCard>
        ))}
          </>
        )}
      </div>
    );
  };

  return (
    <div style={{
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '2rem 1rem'
    }}>
      {/* ── Portfolio header card ────────────────────────────────────────
          One surface, three bands, instead of five separate strips each
          holding a small left-aligned chip. Every band reads the same way:
          information on the left, the control that changes it on the right. */}
      {(() => {
        const bandPadding = isMobile ? '0.875rem 1rem' : '0.875rem 1.25rem';

        const eyebrowStyle = {
          fontSize: '0.75rem',
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          marginBottom: '0.4rem'
        };

        const bandStyle = (isFirst = false) => ({
          padding: bandPadding,
          // The right-hand navigation rail is position:fixed at z-index 1001 and
          // floats over page content. Reserve a gutter on desktop so a band's
          // right-aligned controls can never end up underneath it.
          paddingRight: isMobile ? '1rem' : '4.5rem',
          borderTop: isFirst ? 'none' : '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'center',
          gap: isMobile ? '0.875rem' : '1.5rem',
          flexWrap: 'wrap'
        });

        const chipStyle = (color, bg, border) => ({
          fontSize: '0.8125rem',
          fontWeight: '600',
          padding: '0.25rem 0.625rem',
          borderRadius: '6px',
          background: bg,
          color,
          border: `1px solid ${border}`,
          whiteSpace: 'nowrap'
        });

        // ── Band 2: which accounts are in view + how fresh the data is
        const showAccountTabs = (viewAsFilter || user?.role === 'client') && accountTabs.length > 1;
        const showFreshness = !selectedDate && holdings.length > 0;
        const showScopeBand = showAccountTabs || showFreshness;

        // ── Band 3: mandate attributes + the actions that act on this view
        // getProfileName (accountProfiles.js) prefers the saved profileName —
        // the one the contact screen shows — and only falls back to matching
        // the limits against the templates.
        let profileLabel = null;
        if (viewAsFilter) {
          if (activeAccountTab === 'consolidated') {
            const names = [...new Set(accountProfiles.map(p => getProfileName(p)).filter(Boolean))];
            if (names.length > 0) profileLabel = names.join(' / ');
          } else {
            profileLabel = getProfileName(selectedAccountProfile);
          }
        }

        // KYC risk is assessed per bank account (kycRiskScore, see
        // bankAccounts.js); the business-relationship level is the stored
        // verdict. Consolidated shows the riskiest assessed account. The data
        // only reaches staff browsers ('bankAccounts.details'), and the chip is
        // hidden from clients as well.
        const RISK_ORDER = ['low', 'medium', 'high'];
        const riskLevelOf = (account) => account?.kycRiskScore?.businessRelationship?.riskLevel || null;
        const riskLevel = activeAccountTab === 'consolidated'
          ? bankAccounts.map(riskLevelOf).filter(Boolean)
            .sort((a, b) => RISK_ORDER.indexOf(b) - RISK_ORDER.indexOf(a))[0] || null
          : riskLevelOf(bankAccounts.find(a => a._id === activeAccountTab));
        const showRisk = viewAsFilter && user?.role !== 'client' && riskLevel;
        const riskConfig = {
          low: { label: 'Low Risk', color: 'var(--gain-color)', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)' },
          medium: { label: 'Medium Risk', color: 'var(--warning-color)', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)' },
          high: { label: 'High Risk', color: 'var(--loss-color)', bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.3)' }
        };
        const riskCfg = riskConfig[riskLevel] || riskConfig.medium;

        return (
          <div style={{
            marginBottom: '1.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            overflow: 'visible'
          }}>

            {/* ── Band 1: identity + as-of date ─────────────────────── */}
            <div style={bandStyle(true)}>
              <div style={{ minWidth: 0 }}>
                <h1 style={{
                  margin: 0,
                  fontFamily: 'var(--font-serif)',
                  fontSize: isMobile ? '1.5rem' : '1.875rem',
                  fontWeight: '500',
                  letterSpacing: '0.2px',
                  color: 'var(--text-primary)',
                  lineHeight: '1.15',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {viewAsFilter?.label || (isMobile ? 'Portfolio' : 'Portfolio Management')}
                </h1>
                <div style={{
                  marginTop: '4px',
                  fontSize: '0.8125rem',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden'
                }}>
                  <span style={{
                    width: '7px', height: '7px', borderRadius: '50%', flex: 'none',
                    background: 'var(--gain-color)',
                    boxShadow: '0 0 0 3px color-mix(in srgb, var(--gain-color) 18%, transparent)'
                  }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedDate
                      ? `Snapshot of ${new Date(selectedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : 'Prices as of latest bank files'}
                  </span>
                </div>
              </div>

              {/* On a phone the date picker is dead weight at the top of the
                  screen - it is "Latest (Today)" almost always. Show it only
                  when a past date is actually in effect, so the "↻ Latest"
                  escape hatch can never become unreachable. */}
              {(!isMobile || selectedDate) && (
              <div style={{ minWidth: 0 }}>
                <div style={{ ...eyebrowStyle, textAlign: isMobile ? 'left' : 'right' }}>
                  Portfolio date
                </div>
                <div style={{
                  display: 'flex',
                  flexDirection: isMobile ? 'column' : 'row',
                  gap: '0.5rem',
                  alignItems: isMobile ? 'stretch' : 'center',
                  justifyContent: isMobile ? 'flex-start' : 'flex-end'
                }}>
                  <select
                    value={selectedDate || 'latest'}
                    onChange={(e) => setSelectedDate(e.target.value === 'latest' ? null : e.target.value)}
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.875rem',
                      cursor: 'pointer',
                      minWidth: isMobile ? 'auto' : '180px',
                      fontWeight: '500'
                    }}
                  >
                    <option value="latest">Latest (Today)</option>
                    {availableDates.map(date => {
                      const isoDate = date instanceof Date ? date.toISOString() : (typeof date === 'string' ? date : String(date));
                      return (
                        <option key={isoDate} value={isoDate}>
                          {new Date(date).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })}
                        </option>
                      );
                    })}
                  </select>
                  <div style={{
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'center',
                    ...(isMobile && { justifyContent: 'space-between' })
                  }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>or</span>
                    <input
                      type="date"
                      value={selectedDate ? new Date(selectedDate).toISOString().split('T')[0] : ''}
                      onChange={(e) => {
                        if (e.target.value) {
                          const date = new Date(e.target.value);
                          date.setUTCHours(0, 0, 0, 0);
                          setSelectedDate(date.toISOString());
                        } else {
                          setSelectedDate(null);
                        }
                      }}
                      max={(() => {
                        const today = new Date();
                        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                      })()}
                      style={{
                        padding: '0.5rem 0.75rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: '0.875rem',
                        cursor: 'pointer',
                        fontWeight: '500',
                        flex: isMobile ? 1 : 'none'
                      }}
                      title="Pick a specific date"
                    />
                    {selectedDate && (
                      <button
                        onClick={() => setSelectedDate(null)}
                        style={{
                          padding: '0.5rem 0.75rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-primary)',
                          color: 'var(--warning-color)',
                          fontSize: '0.8125rem',
                          cursor: 'pointer',
                          fontWeight: '600',
                          whiteSpace: 'nowrap'
                        }}
                        title="Return to latest portfolio view"
                      >
                        ↻ Latest
                      </button>
                    )}
                  </div>
                </div>
                {selectedDate && (
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'var(--warning-color)',
                    fontWeight: '600',
                    marginTop: '0.4rem',
                    textAlign: isMobile ? 'left' : 'right'
                  }}>
                    ⚠️ Viewing historical snapshot
                  </div>
                )}
              </div>
              )}
            </div>

            {/* ── Band 2: scope + data status ───────────────────────── */}
            {showScopeBand && (
              <div style={bandStyle()}>
                {showAccountTabs && (
                  <div style={{ minWidth: 0 }}>
                    <div style={eyebrowStyle}>Viewing</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {accountTabs.map((tab) => {
                        const isActive = activeAccountTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            onClick={() => setActiveAccountTab(tab.id)}
                            style={{
                              // Full-width rows on a phone: a bigger, easier target
                              flex: isMobile ? '1 1 100%' : '0 0 auto',
                              padding: isMobile ? '0.625rem 0.875rem' : '0.5625rem 0.875rem',
                              // Proposal account chips: quiet panel, amber hairline + amber
                              // label when selected — the amber IS the selection signal.
                              background: isActive
                                ? 'color-mix(in srgb, var(--accent-color) 10%, var(--bg-secondary))'
                                : 'var(--bg-secondary)',
                              color: isActive ? 'var(--accent-color)' : 'var(--text-secondary)',
                              border: `1px solid ${isActive ? 'var(--accent-color)' : 'var(--border-color)'}`,
                              borderRadius: '10px',
                              cursor: 'pointer',
                              fontWeight: '600',
                              fontSize: '0.8125rem',
                              transition: 'all 0.16s ease',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-start',
                              gap: '0.1rem',
                              textAlign: 'left'
                            }}
                            onMouseEnter={(e) => {
                              if (!isActive) e.currentTarget.style.borderColor = 'var(--text-muted)';
                            }}
                            onMouseLeave={(e) => {
                              if (!isActive) e.currentTarget.style.borderColor = 'var(--border-color)';
                            }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: '0.9rem' }}>{tab.icon}</span>
                              <span>{tab.label}</span>
                            </span>
                            {tab.caption && (
                              <span style={{
                                fontSize: '0.75rem',
                                fontWeight: '400',
                                opacity: 0.75,
                                whiteSpace: 'nowrap'
                              }}>
                                {tab.caption}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {showFreshness && (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...eyebrowStyle, textAlign: isMobile ? 'left' : 'right' }}>
                      Data status
                    </div>
                    <div style={{ display: 'flex', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
                      <DataFreshnessPanel
                        sessionId={typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null}
                        userId={user?._id || viewAsFilter}
                        showWarning={true}
                        compact={false}
                        visibleBankIds={visibleBankIds}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Band 3: mandate + actions ─────────────────────────── */}
            <div style={bandStyle()}>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', minWidth: 0 }}>
                {profileLabel && (
                  <div>
                    <div style={eyebrowStyle}>Investor profile</div>
                    <span style={chipStyle('var(--info-color)', 'rgba(59, 130, 246, 0.1)', 'rgba(59, 130, 246, 0.25)')}>
                      {profileLabel}
                    </span>
                  </div>
                )}
                {showRisk && (
                  <div>
                    <div style={eyebrowStyle}>Risk profile</div>
                    <span style={chipStyle(riskCfg.color, riskCfg.bg, riskCfg.border)}>
                      {riskCfg.label}
                    </span>
                  </div>
                )}
                <div>
                  <div style={eyebrowStyle}>Reference currency</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <select
                      value={portfolioCurrency}
                      onChange={(e) => setDisplayCurrencyOverride(e.target.value === naturalPortfolioCurrency ? null : e.target.value)}
                      title="View this portfolio in another currency (converted at current spot rates)"
                      style={{
                        padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)',
                        background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
                      }}
                    >
                      {[...new Set([naturalPortfolioCurrency, 'EUR', 'USD', 'CHF', 'GBP', ...displayPositionsRaw.map(p => p.portfolioCurrency).filter(Boolean)])]
                        .map(ccy => <option key={ccy} value={ccy}>{ccy}{ccy === naturalPortfolioCurrency ? ' (default)' : ''}</option>)}
                    </select>
                    {displayCurrencyOverride && (
                      <button
                        type="button"
                        onClick={() => setDisplayCurrencyOverride(null)}
                        title={`Back to ${naturalPortfolioCurrency}`}
                        style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: 0 }}
                      >
                        ↺ {naturalPortfolioCurrency}
                      </button>
                    )}
                  </div>
                  {displayCurrencyOverride && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>Converted at current spot rates</div>
                  )}
                </div>
              </div>

              <div style={{
                display: isMobile ? 'grid' : 'flex',
                gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
                alignItems: 'center',
                gap: '0.5rem',
                flexWrap: 'wrap',
                justifyContent: 'flex-end'
              }}>
                <div style={{ display: 'grid', minWidth: 0 }}>
                  <PDFDownloadButton
                    // Its wrapper is inline-block by default, which shrink-wraps
                    // the button; go block on mobile so it fills the grid cell.
                    wrapperStyle={isMobile ? { display: 'block' } : undefined}
                    reportId={activeAccountTab}
                    reportType="pms"
                    filename={`Portfolio_Report_${new Date().toISOString().split('T')[0]}`}
                    title="Report PDF"
                    options={{
                      viewAsFilter: viewAsFilter ? JSON.stringify(viewAsFilter) : null,
                      accountFilter: activeAccountTab,
                      currency: portfolioCurrency
                    }}
                    style={{
                      padding: '0.5rem 0.875rem',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '9px',
                      fontSize: '0.8125rem',
                      fontWeight: '600',
                      width: isMobile ? '100%' : 'auto',
                      justifyContent: 'center'
                    }}
                  />
                </div>

                <div
                  style={{ position: 'relative', display: 'flex', minWidth: 0 }}
                  onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setReviewLangPickerOpen(false); }}
                  tabIndex={-1}
                >
                  <button
                    onClick={() => !reviewGenerating && setReviewLangPickerOpen(!reviewLangPickerOpen)}
                    disabled={reviewGenerating}
                    style={{
                      padding: '0.5rem 0.875rem',
                      background: reviewGenerating
                        ? 'var(--bg-tertiary)'
                        : 'var(--accent-color)',
                      color: reviewGenerating ? 'var(--text-muted)' : 'var(--accent-contrast)',
                      border: '1px solid var(--accent-color)',
                      borderRadius: '9px',
                      fontSize: '0.8125rem',
                      fontWeight: '600',
                      cursor: reviewGenerating ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      width: isMobile ? '100%' : 'auto',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {reviewGenerating ? 'Generating...' : 'Portfolio Review ▾'}
                  </button>
                  {reviewLangPickerOpen && !reviewGenerating && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: '4px',
                      background: theme === 'dark' ? '#1f2937' : '#fff',
                      border: `1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'}`,
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      zIndex: 50,
                      overflow: 'hidden',
                      minWidth: '140px'
                    }}>
                      {[{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }].map(lang => (
                        <button
                          key={lang.code}
                          onClick={() => {
                            setReviewLangPickerOpen(false);
                            handleGeneratePortfolioReview(lang.code);
                          }}
                          style={{
                            display: 'block',
                            width: '100%',
                            padding: '0.625rem 0.875rem',
                            background: 'none',
                            border: 'none',
                            textAlign: 'left',
                            fontSize: '0.8125rem',
                            color: theme === 'dark' ? '#e5e7eb' : '#1e293b',
                            cursor: 'pointer'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = theme === 'dark' ? 'rgba(255,255,255,0.1)' : '#f3f4f6'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Review progress / error - full width under the actions band */}
            {(reviewGenerating && reviewProgress) && (
              <div style={{
                padding: `0 ${isMobile ? '1rem' : '1.25rem'} 0.875rem`,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.8125rem',
                color: 'var(--text-secondary)'
              }}>
                <div style={{
                  width: '80px',
                  height: '4px',
                  background: 'var(--border-color, #e5e7eb)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                  flexShrink: 0
                }}>
                  <div style={{
                    width: `${((reviewProgress.completedSections || 0) / (reviewProgress.totalSections || 7)) * 100}%`,
                    height: '100%',
                    background: '#6366f1',
                    borderRadius: '2px',
                    transition: 'width 0.5s ease'
                  }} />
                </div>
                <span>{reviewProgress.currentStepLabel}</span>
              </div>
            )}
            {reviewError && (
              <div style={{
                padding: `0 ${isMobile ? '1rem' : '1.25rem'} 0.875rem`,
                fontSize: '0.8125rem',
                color: 'var(--loss-color)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}>
                <span>Portfolio review failed: {reviewError}</span>
                <button
                  onClick={() => setReviewError(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--loss-color)',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    padding: '0 2px'
                  }}
                >&times;</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Historical Data Banner */}
      {selectedDate && (
        <div style={{
          padding: '0.75rem 1rem',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%)',
          border: '2px solid var(--warning-color)',
          borderRadius: '12px',
          marginBottom: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem' }}>📅</span>
            <span style={{
              fontSize: '0.95rem',
              fontWeight: '600',
              color: 'var(--warning-color)'
            }}>
              Historical Portfolio:
            </span>
            <span style={{
              fontSize: '0.95rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              {new Date(selectedDate).toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
              })}
            </span>
          </div>
          <button
            onClick={() => setSelectedDate(null)}
            style={{
              padding: '0.6rem 1rem',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--warning-color)',
              color: 'white',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(245, 158, 11, 0.25)',
              width: '100%'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#d97706';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.35)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--warning-color)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(245, 158, 11, 0.25)';
            }}
          >
            ↻ Return to Latest Portfolio
          </button>
        </div>
      )}

      {/* Allocation Bar - Show when a specific account is selected (not Consolidated) */}
      {viewAsFilter && activeAccountTab !== 'consolidated' && fourCategoryAllocation.total > 0 && (
        <div style={{
          marginBottom: '1rem',
          padding: '1rem',
          background: theme === 'light'
            ? 'rgba(255, 255, 255, 0.7)'
            : 'rgba(30, 41, 59, 0.5)',
          borderRadius: '10px',
          border: '1px solid var(--border-color)'
        }}>
          <h4 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: isMobile ? '0.9375rem' : '13px', fontWeight: '600' }}>
            Current vs Maximum Allocation
          </h4>
          {/* Grid, not wrapping flex: there are exactly four categories, so a
              fixed track count keeps every cell the same width. Wrapping flex
              left a ragged last row and squeezed cells whose value string then
              wrapped, knocking the bars out of alignment. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, minmax(0, 1fr))',
            gap: isMobile ? '0.875rem' : '1rem'
          }}>
            {[
              { key: 'cash', label: 'Cash', icon: '💵', max: selectedAccountProfile?.maxCash ?? null, current: fourCategoryAllocation.cash, color: 'var(--info-color)', tooltip: 'Cash • Term Deposits • Monetary Products • Money Market Funds' },
              { key: 'bonds', label: 'Bonds', icon: '📄', max: selectedAccountProfile?.maxBonds ?? null, current: fourCategoryAllocation.bonds, color: 'var(--gain-color)', tooltip: 'Fixed-Income Bonds • Convertible Bonds • Bond Funds • Capital-Guaranteed Structured Products' },
              { key: 'equities', label: 'Equities', icon: '📈', max: selectedAccountProfile?.maxEquities ?? null, current: fourCategoryAllocation.equities, color: 'var(--warning-color)', tooltip: 'Equities & Stocks • Equity Funds • Equity-Linked Structured Products (without capital protection)' },
              { key: 'alternative', label: 'Alternative', icon: '🎯', max: selectedAccountProfile?.maxAlternative ?? null, current: fourCategoryAllocation.alternative, color: '#8b5cf6', tooltip: 'Private Equity • Private Debt • Commodities • Real Estate • Hedge Funds • Derivatives • Other' }
            ].map(item => {
              const hasProfile = item.max !== null;
              const isOverLimit = hasProfile && item.current > item.max;

              return (
                <div key={item.key} style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', marginBottom: '4px' }}>
                    <span
                      style={{
                        color: 'var(--text-secondary)',
                        fontSize: isMobile ? '0.875rem' : '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'help',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                      title={item.tooltip}
                    >
                      <span>{item.icon}</span> {item.label}
                    </span>
                    <span style={{
                      color: isOverLimit ? 'var(--loss-color)' : 'var(--text-primary)',
                      fontSize: isMobile ? '0.875rem' : '12px',
                      fontWeight: '600',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                      flexShrink: 0
                    }}>
                      {item.current.toFixed(1)}%{hasProfile ? ` / ${item.max}%` : ''}
                      {isOverLimit && <span style={{ marginLeft: '4px' }}>⚠️</span>}
                    </span>
                  </div>
                  <div style={{
                    position: 'relative',
                    height: isMobile ? '18px' : '16px',
                    background: theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    overflow: 'hidden'
                  }}>
                    {/* Max limit indicator - only show if profile exists */}
                    {hasProfile && (
                      <div style={{
                        position: 'absolute',
                        left: `${item.max}%`,
                        top: 0,
                        bottom: 0,
                        width: '2px',
                        background: theme === 'light' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',
                        zIndex: 2
                      }} />
                    )}
                    {/* Current allocation bar */}
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${Math.min(item.current, 100)}%`,
                      background: isOverLimit
                        ? 'linear-gradient(90deg, var(--loss-color) 0%, #dc2626 100%)'
                        : `linear-gradient(90deg, ${item.color} 0%, color-mix(in srgb, ${item.color} 87%, transparent) 100%)`,
                      borderRadius: '8px',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
          {!selectedAccountProfile && (
            <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: isMobile ? '0.8125rem' : '11px', textAlign: 'center' }}>
              Set a profile to see limit comparisons
            </p>
          )}
        </div>
      )}

      {/* Tab Navigation */}
      <LiquidGlassCard style={{ marginBottom: '2rem' }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          padding: '0.75rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                // Proposal view-tab: quiet label with a 2px amber underline when
                // active — the amber is the signal, not a filled block.
                padding: '0.7rem 1rem',
                background: 'transparent',
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                border: 'none',
                borderBottom: activeTab === tab.id
                  ? '2px solid var(--accent-color)'
                  : '2px solid transparent',
                borderRadius: 0,
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.85rem',
                letterSpacing: '0.2px',
                transition: 'color 0.16s ease, border-color 0.16s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                flex: '1 1 auto',
                minWidth: 'fit-content',
                justifyContent: 'center'
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.color = 'var(--text-muted)';
                }
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'positions' && renderPositionsSection()}
          {activeTab === 'transactions' && renderTransactionsSection()}
          {activeTab === 'performance' && renderPerformanceSection()}
          {activeTab === 'alerts' && renderAlertsSection()}
          {activeTab === 'reviews' && renderReviewsSection()}
        </div>
      </LiquidGlassCard>

      {/* Portfolio Review Toast Notification */}
      {reviewToastVisible && reviewToastId && (
        <div
          style={{
            position: 'fixed',
            bottom: '2rem',
            right: '2rem',
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            color: 'white',
            padding: '1rem 1.5rem',
            borderRadius: '12px',
            boxShadow: '0 8px 30px rgba(79, 70, 229, 0.4)',
            zIndex: 9999,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            fontSize: '0.9rem',
            fontWeight: '500',
            animation: 'slideUp 0.3s ease-out'
          }}
          onClick={() => {
            setPortfolioReviewModalId(reviewToastId);
            setReviewToastVisible(false);
          }}
        >
          <span style={{ fontSize: '1.2rem' }}>📋</span>
          <div>
            <div style={{ fontWeight: '600' }}>Portfolio Review Ready</div>
            <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>Click to view</div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setReviewToastVisible(false);
            }}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              borderRadius: '50%',
              width: '24px',
              height: '24px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.8rem',
              marginLeft: '0.5rem'
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Portfolio Review Modal */}
      {portfolioReviewModalId && (
        <PortfolioReviewModal
          reviewId={portfolioReviewModalId}
          onClose={() => setPortfolioReviewModalId(null)}
        />
      )}

      {/* Toast animation */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {/* Reclassify Modal */}
      {showClassifyModal && classifyTarget && (
        <SecurityClassificationModal
          security={classifyTarget}
          onSave={handleSaveClassification}
          onClose={() => {
            setShowClassifyModal(false);
            setClassifyTarget(null);
          }}
        />
      )}

      {/* Order Modal */}
      <OrderModal
        key={orderModalKey}
        isOpen={orderModalOpen}
        onClose={() => {
          setOrderModalOpen(false);
          setOrderPrefillData(null);
        }}
        mode={orderModalMode}
        prefillData={orderPrefillData}
        clients={[]} // Will be populated by the modal via server call
        onOrderCreated={handleOrderCreated}
        user={user}
      />
    </div>
  );
};

export default PortfolioManagementSystem;
