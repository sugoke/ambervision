import React, { useState, useEffect, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { Mongo } from 'meteor/mongo';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import { useTheme } from './ThemeContext.jsx';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { ProductsCollection } from '/imports/api/products';
import { AllocationsCollection } from '/imports/api/allocations';
import { AccountProfilesCollection, aggregateToFourCategories, PROFILE_TEMPLATES } from '/imports/api/accountProfiles';
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
import PortfolioReviewsList from './components/PortfolioReviewsList.jsx';
import PortfolioReviewModal from './components/PortfolioReviewModal.jsx';
import { DataFreshnessPanel } from './components/DataFreshnessIndicator.jsx';
import { checkDataFreshness } from '/imports/api/helpers/dataFreshness.js';
import * as XLSX from 'xlsx';

// Local collection for snapshot dates (synthetic collection from publication)
const PMSHoldingsSnapshotDatesCollection = new Mongo.Collection('pmsHoldingsSnapshotDates');
import * as CountryFlags from 'country-flag-icons/react/3x2';
import { Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
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
    'reverse_convertible_bond': '🔄'
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

// Helper function to get currency symbol from currency code
const getCurrencySymbol = (currencyCode) => {
  const symbols = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'CHF': 'CHF',
    'JPY': '¥',
    'CNY': '¥',
    'CAD': 'C$',
    'AUD': 'A$',
    'NZD': 'NZ$',
    'HKD': 'HK$',
    'SGD': 'S$',
    'SEK': 'kr',
    'NOK': 'kr',
    'DKK': 'kr',
    'INR': '₹',
    'RUB': '₽',
    'BRL': 'R$',
    'ZAR': 'R',
    'MXN': 'Mex$',
    'KRW': '₩',
    'TRY': '₺',
    'PLN': 'zł'
  };
  return symbols[currencyCode] || currencyCode || '$';
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

// Helper function to get currency flag component
const getCurrencyFlag = (currencyCode) => {
  // Map currency codes to ISO 3166-1 alpha-2 country codes
  const countryCodeMap = {
    'USD': 'US',
    'EUR': 'EU',
    'GBP': 'GB',
    'CHF': 'CH',
    'JPY': 'JP',
    'CNY': 'CN',
    'CAD': 'CA',
    'AUD': 'AU',
    'NZD': 'NZ',
    'HKD': 'HK',
    'SGD': 'SG',
    'SEK': 'SE',
    'NOK': 'NO',
    'DKK': 'DK',
    'INR': 'IN',
    'RUB': 'RU',
    'BRL': 'BR',
    'ZAR': 'ZA',
    'MXN': 'MX',
    'KRW': 'KR',
    'TRY': 'TR',
    'PLN': 'PL',
    'CZK': 'CZ',
    'HUF': 'HU',
    'RON': 'RO',
    'BGN': 'BG',
    'HRK': 'HR',
    'ILS': 'IL',
    'THB': 'TH',
    'MYR': 'MY',
    'IDR': 'ID',
    'PHP': 'PH',
    'TWD': 'TW',
    'VND': 'VN',
    'AED': 'AE',
    'SAR': 'SA',
    'QAR': 'QA',
    'KWD': 'KW',
    'BHD': 'BH',
    'OMR': 'OM',
    'EGP': 'EG',
    'MAD': 'MA',
    'TND': 'TN',
    'NGN': 'NG',
    'KES': 'KE',
    'GHS': 'GH',
    'ARS': 'AR',
    'CLP': 'CL',
    'COP': 'CO',
    'PEN': 'PE',
    'UYU': 'UY',
    'VEF': 'VE',
    'ISK': 'IS',
    'UAH': 'UA'
  };

  const countryCode = countryCodeMap[currencyCode] || currencyCode;
  const FlagComponent = CountryFlags[countryCode];

  // Return flag component if found, otherwise return null
  return FlagComponent || null
};

// Helper function to format currency value
const formatCurrency = (value, currencyCode, options = {}) => {
  const symbol = getCurrencySymbol(currencyCode);
  const formattedValue = value.toLocaleString('en-US', {
    minimumFractionDigits: options.decimals !== undefined ? options.decimals : 2,
    maximumFractionDigits: options.decimals !== undefined ? options.decimals : 2
  });

  // For symbols that should appear after the value
  if (['kr', 'zł'].includes(symbol)) {
    return `${formattedValue} ${symbol}`;
  }

  return `${symbol} ${formattedValue}`;
};

// Smart price formatter - uses priceType from bank data to determine format
const formatPrice = (value, currencyCode, priceType) => {
  if (!value && value !== 0) return '-';

  // If priceType is percentage, format as percentage
  // Values are stored as decimals (0.9840 = 98.40%, 1.07 = 107%)
  // Always multiply by 100 for display
  if (priceType === 'percentage') {
    const formattedValue = (value * 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${formattedValue}%`;
  }

  // Otherwise format as absolute currency
  return formatCurrency(value, currencyCode);
};

const PortfolioManagementSystem = ({ user }) => {
  const { theme } = useTheme();
  const { viewAsFilter } = useViewAs();
  const [activeTab, setActiveTab] = useState('positions');
  const [sortBy, setSortBy] = useState('marketValue'); // Default sort by market value
  const [sortDirection, setSortDirection] = useState('desc');
  const [filterAssetClass, setFilterAssetClass] = useState('all');
  const [expandedSections, setExpandedSections] = useState({});
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Handle window resize for mobile detection
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Transactions filters and sorting
  const [txSortBy, setTxSortBy] = useState('date'); // Default sort by date
  const [txSortDirection, setTxSortDirection] = useState('desc');
  const [filterTxType, setFilterTxType] = useState('all');
  const [filterTxCategory, setFilterTxCategory] = useState('all');

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
  const [assetAllocation, setAssetAllocation] = useState(null);
  const [structuredProductHierarchy, setStructuredProductHierarchy] = useState({
    hasData: false,
    level1: [],
    level2: [],
    totalStructuredValue: 0
  });
  const [currencyAllocation, setCurrencyAllocation] = useState(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState('1Y');

  // Refresh key for forcing re-subscription after file processing (Meteor 3 async publication workaround)
  const [refreshKey, setRefreshKey] = useState(0);

  // Notification alerts from notifications collection
  const [notificationAlerts, setNotificationAlerts] = useState([]);
  const [notificationAlertsLoading, setNotificationAlertsLoading] = useState(false);

  // Order modal state
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderModalMode, setOrderModalMode] = useState('buy'); // 'buy' or 'sell'
  const [orderPrefillData, setOrderPrefillData] = useState(null);

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
    const productsHandle = Meteor.subscribe('products.all');
    const allocationsHandle = Meteor.subscribe('allAllocations', sessionId, viewAsFilter);
    const metadataHandle = Meteor.subscribe('securitiesMetadata', sessionId, {});

    if (!handle.ready() || !productsHandle.ready() || !allocationsHandle.ready() || !metadataHandle.ready()) {
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
        // ISIN exists but not classified - mark as uncategorized
        assetClass = 'other';
        assetSubClass = '';
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

      // Use product name if linked, otherwise use security name from bank
      const displayName = linkedProduct?.title || holding.securityName || 'Unknown Security';
      const productIcon = linkedProduct ? getProductTypeIcon(linkedProduct.templateId || linkedProduct.template) : null;

      return {
        id: holding._id,
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
        bankId: holding.bankId,
        bankName: holding.bankName,
        portfolioCode: holding.portfolioCode,
        dataDate: holding.dataDate,
        linkedProduct: linkedProduct,
        productTags: productTags,
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

    // Transform operations to match UI structure
    const transformedOperations = rawOperations.map((op) => ({
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
      sourceFile: op.sourceFile
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

    // Build query - filter by selected client's userId if viewAsFilter is set
    const query = { isActive: true };
    if (viewAsFilter && viewAsFilter.type === 'client' && viewAsFilter.id) {
      query.userId = viewAsFilter.id;
    }

    const accounts = BankAccountsCollection.find(query, { sort: { accountNumber: 1 } }).fetch();
    const banks = BanksCollection.find({ isActive: true }).fetch();

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
  }, [viewAsFilter]);

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
  // 'consolidated' shows pre-aggregated holdings with portfolioCode='CONSOLIDATED'
  // Specific accounts filter by account number and bank
  const filteredHoldings = useMemo(() => {
    if (activeAccountTab === 'consolidated') {
      // Try consolidated holdings first (pre-computed by CRON job)
      const consolidatedHoldings = dummyPositions.filter(pos => pos.portfolioCode === 'CONSOLIDATED');
      // Fallback: if no consolidated holdings exist yet, show all non-consolidated
      if (consolidatedHoldings.length === 0) {
        return dummyPositions.filter(pos => pos.portfolioCode !== 'CONSOLIDATED');
      }
      return consolidatedHoldings;
    }

    // Find the selected account tab details
    const selectedTab = accountTabs.find(tab => tab.id === activeAccountTab);
    if (!selectedTab || !selectedTab.accountNumber) {
      // Fallback: show all positions if account not found
      return dummyPositions.filter(pos => pos.portfolioCode !== 'CONSOLIDATED');
    }

    return dummyPositions.filter(pos =>
      pos.portfolioCode === selectedTab.accountNumber &&
      pos.bankId === selectedTab.bankId &&
      pos.portfolioCode !== 'CONSOLIDATED'
    );
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
  const displayPositions = filteredHoldings;
  const displayTransactions = filteredOperations;

  // Calculate 4-category allocation for risk profile comparison
  const fourCategoryAllocation = useMemo(() => {
    if (!filteredHoldings || filteredHoldings.length === 0) {
      return { cash: 0, bonds: 0, equities: 0, alternative: 0, total: 0 };
    }

    // Build granular asset class breakdown by value
    // For structured products, use protection type to distinguish capital-protected (bonds) from equity-linked (equities)
    const breakdown = {};
    let total = 0;

    filteredHoldings.forEach(holding => {
      let categoryKey = holding.assetClass || 'other';
      const marketValue = holding.marketValue || 0;

      if (categoryKey === 'structured_product') {
        const protectionType = holding.structuredProductProtectionType;
        const underlyingType = holding.structuredProductUnderlyingType || 'equity_linked';
        if (protectionType === 'capital_guaranteed_100') {
          categoryKey = 'structured_product_capital_guaranteed';
        } else if (protectionType === 'capital_guaranteed_partial') {
          categoryKey = 'structured_product_partial_guarantee';
        } else if (protectionType === 'capital_protected_conditional') {
          // Equity-linked barrier protected → equities (still has equity risk)
          // Non-equity barrier protected → bonds
          if (underlyingType === 'equity_linked') {
            categoryKey = 'structured_product_equity_linked_barrier_protected';
          } else {
            categoryKey = 'structured_product_barrier_protected';
          }
        } else if (holding.structuredProductUnderlyingType) {
          categoryKey = `structured_product_${holding.structuredProductUnderlyingType}`;
        }
      }

      breakdown[categoryKey] = (breakdown[categoryKey] || 0) + marketValue;
      total += marketValue;
    });

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

  // Calculate total cash from all currencies (using PTF_MKT_VAL for portfolio currency)
  // Note: Negative cash (credit lines/overdrafts) should not reduce the total - only count positive cash
  const totalCashValue = cashPositions.reduce((sum, pos) => {
    const value = pos.marketValue || 0;
    return sum + Math.max(0, value); // Cap negative cash at 0 (credit lines don't reduce totals)
  }, 0);

  // Total portfolio value includes both cash and non-cash positions (all in portfolio currency)
  const totalPortfolioValue = totalNonCashPortfolioValue + totalCashValue;
  const totalGainLoss = totalNonCashGainLoss; // Gain/loss only applies to non-cash positions

  // Determine portfolio reference currency
  // Priority: 1) viewAsFilter currency, 2) Selected account's reference currency, 3) Holdings' portfolioCurrency, 4) Most common bank account currency, 5) USD default
  let portfolioCurrency = 'USD';
  let portfolioHasMixedCurrencies = false;

  // Helper function to get most common portfolioCurrency from holdings
  const getHoldingsPortfolioCurrency = () => {
    const holdingsWithCurrency = dummyPositions.filter(p => p.portfolioCurrency);
    if (holdingsWithCurrency.length > 0) {
      const currencyCounts = holdingsWithCurrency.reduce((acc, p) => {
        acc[p.portfolioCurrency] = (acc[p.portfolioCurrency] || 0) + 1;
        return acc;
      }, {});
      return Object.keys(currencyCounts).reduce((a, b) =>
        currencyCounts[a] > currencyCounts[b] ? a : b, null);
    }
    return null;
  };

  // Determine portfolio currency - Priority order:
  // 1. Selected account tab's referenceCurrency (when specific account selected)
  // 2. Client's profile.referenceCurrency (when client selected via viewAs)
  // 3. Most common bank account referenceCurrency
  // 4. Fall back to USD

  if (activeAccountTab !== 'consolidated') {
    // Priority 1: Use the selected account tab's reference currency
    const selectedAccount = bankAccounts.find(acc => acc._id === activeAccountTab);
    if (selectedAccount && selectedAccount.referenceCurrency) {
      portfolioCurrency = selectedAccount.referenceCurrency;
    }
  } else if (viewAsFilter && viewAsFilter.type === 'client') {
    // Priority 2: Client's profile.referenceCurrency
    const clientCurrency = viewAsFilter.data?.profile?.referenceCurrency || viewAsFilter.data?.referenceCurrency;
    if (clientCurrency) {
      portfolioCurrency = clientCurrency;
    } else if (bankAccounts.length > 0) {
      // Fall back to most common bank account currency for this client
      const refCurrencyCounts = bankAccounts.reduce((counts, acc) => {
        const curr = acc.referenceCurrency || 'EUR';
        counts[curr] = (counts[curr] || 0) + 1;
        return counts;
      }, {});
      portfolioCurrency = Object.keys(refCurrencyCounts).reduce((a, b) =>
        refCurrencyCounts[a] > refCurrencyCounts[b] ? a : b, 'EUR'
      );
    }
  } else if (bankAccounts.length > 0) {
    // Priority 3: Most common bank account reference currency
    const refCurrencyCounts = bankAccounts.reduce((counts, acc) => {
      const curr = acc.referenceCurrency || 'EUR';
      counts[curr] = (counts[curr] || 0) + 1;
      return counts;
    }, {});
    portfolioCurrency = Object.keys(refCurrencyCounts).reduce((a, b) =>
      refCurrencyCounts[a] > refCurrencyCounts[b] ? a : b, 'EUR'
    );
  }

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
    else if ((assetClass === 'equity' || assetClass === 'fixed_income') && position.assetSubClass) {
      const subClass = position.assetSubClass;
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
      setExpandedSections({ ...expandedSections, ...initial });
    }
  };

  // Initialize when groupedPositions changes (data loads)
  React.useEffect(() => {
    if (Object.keys(groupedPositions).length > 0) {
      initializeExpandedSections();
    }
  }, [Object.keys(groupedPositions).join(',')]);

  // Export holdings to Excel
  const exportToExcel = () => {
    // Combine all holdings (cash + non-cash sorted positions) for export
    const allHoldings = [...cashPositions, ...sortedPositions];

    const data = allHoldings.map(h => ({
      'Name': h.name || '',
      'ISIN': h.isin || '',
      'Ticker': h.ticker || '',
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
      'Currency': h.currency || '',
      'Portfolio Currency': h.portfolioCurrency || portfolioCurrency || '',
      'Bank': h.bankName || '',
      'Portfolio Code': h.portfolioCode || '',
      'Price Date': h.priceDate ? new Date(h.priceDate).toLocaleDateString() : '',
      'Data Date': h.dataDate ? new Date(h.dataDate).toLocaleDateString() : ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
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
  }, [viewAsFilter, activeAccountTab]);

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
            portfolioCode
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
    if (activeTab === 'performance' && selectedTimeRange !== lastFetchedRange && !chartLoading) {
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
            portfolioCode
          });
          console.log('[PMS] getChartData result:', { hasData: chart?.hasData, snapshotCount: chart?.snapshots?.length || 0 });

          setChartData(chart);
          setLastFetchedRange(selectedTimeRange);
        } catch (error) {
          console.error('[PMS] Error fetching chart data:', error);
          setChartData({ hasData: false });
        } finally {
          setChartLoading(false);
        }
      };

      fetchChartData();
    }
  }, [activeTab, selectedTimeRange, lastFetchedRange, chartLoading, viewAsFilter, activeAccountTab, accountTabs]);

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
    setExpandedSections(prev => ({
      ...prev,
      [assetClass]: !prev[assetClass]
    }));
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
      holdingId: position.holdingId || position.id,
      clientId: clientId,
      bankAccountId: position.bankAccountId,
      bankId: position.bankId
    });
    setOrderModalOpen(true);
  };

  const handleOrderCreated = (result) => {
    console.log('[PMS] Order created:', result);
    // Could show a success toast or notification here
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
    <div style={{ padding: '1.5rem' }}>
      {/* Data Freshness Indicator */}
      {mostRecentDataDate && (
        <div style={{
          padding: '0.75rem 1.25rem',
          marginBottom: '1.5rem',
          background: theme === 'light'
            ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.03) 100%)'
            : 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)',
          borderRadius: '8px',
          borderLeft: '3px solid #3b82f6',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          fontSize: '0.875rem',
          color: 'var(--text-secondary)'
        }}>
          <span style={{ fontSize: '1.1rem' }}>📅</span>
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>Data as of:</strong>{' '}
            {mostRecentDataDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </span>
        </div>
      )}

      {/* Simple Portfolio Header */}
      <div style={{
        padding: '1.5rem',
        marginBottom: '1rem'
      }}>
        <span style={{
          fontSize: '1.125rem',
          color: 'var(--text-secondary)'
        }}>
          Total Portfolio Value:{' '}
        </span>
        <span style={{
          fontSize: '1.5rem',
          fontWeight: '600',
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums'
        }}>
          {formatCurrency(totalPortfolioValue, portfolioCurrency)}
        </span>
      </div>

      {/* Secondary Stats Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem',
        padding: '0 1.5rem'
      }}>
        <div style={{
          padding: '1rem 1.25rem',
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
            Cash Balance
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#3b82f6', fontVariantNumeric: 'tabular-nums' }}>
            {Object.keys(cashByCurrency).length === 1
              ? formatCurrency(totalCashValue, Object.keys(cashByCurrency)[0])
              : Object.keys(cashByCurrency).length > 1
              ? formatCurrency(totalCashValue, portfolioCurrency)
              : formatCurrency(0, portfolioCurrency)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {Object.keys(cashByCurrency).length === 0 ? 'No cash' :
             Object.keys(cashByCurrency).length === 1 ? 'Available' :
             `${Object.keys(cashByCurrency).length} currencies`}
          </div>
        </div>
        <div style={{
          padding: '1rem 1.25rem',
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
            Invested Value
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(totalNonCashPortfolioValue, portfolioCurrency)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {nonCashPositions.length} position{nonCashPositions.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div style={{
          padding: '1rem 1.25rem',
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
            Total Cost Basis
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {formatCurrency(totalCostBasis, portfolioCurrency)}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Original investment
          </div>
        </div>
      </div>

      {/* Cash Table */}
      {Object.keys(cashByCurrency).length > 0 && (
        <LiquidGlassCard style={{
          background: theme === 'light' ? '#6b7280' : '#0f172a',
          backdropFilter: 'none',
          marginBottom: '2rem'
        }}>
          <div style={{ padding: '1.5rem' }}>
            <h3 style={{
              margin: '0 0 1.5rem 0',
              fontSize: '1.25rem',
              fontWeight: '400',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>💵</span>
              Cash Balances
            </h3>

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
                    background: theme === 'light'
                      ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.04) 100%)'
                      : 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%)'
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
                      color: '#3b82f6',
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
                      color: '#3b82f6',
                      fontSize: '1.1rem'
                    }}>
                      {formatCurrency(totalCashPortfolioValue, portfolioCurrency)}
                    </td>
                    <td style={{ padding: '1rem' }}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </LiquidGlassCard>
      )}

      {/* FX Forwards Table */}
      {Object.keys(fxForwardsByCurrency).length > 0 && (
        <LiquidGlassCard style={{
          background: theme === 'light' ? '#6b7280' : '#0f172a',
          backdropFilter: 'none',
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
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Currency</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Value Date</th>
                    <th style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: 'var(--text-secondary)' }}>Amount</th>
                    <th style={{ padding: '1rem', textAlign: 'right', fontWeight: '600', color: 'var(--text-secondary)' }}>Portfolio Value ({portfolioCurrency})</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Account</th>
                  </tr>
                </thead>
                <tbody>
                  {fxForwardPositions.map((fx, index) => (
                    <tr
                      key={fx.id || index}
                      style={{
                        borderBottom: index < fxForwardPositions.length - 1 ? '1px solid var(--border-color)' : 'none',
                        transition: 'background 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <td style={{ padding: '1rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                        {fx.ticker || fx.name || 'FX Forward'}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-primary)' }}>
                        {fx.currency}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {fx.bankSpecificData?.instrumentDates?.endDate
                          ? new Date(fx.bankSpecificData.instrumentDates.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                          : 'N/A'}
                      </td>
                      <td style={{
                        padding: '1rem',
                        textAlign: 'right',
                        fontWeight: '600',
                        fontFamily: "'JetBrains Mono', monospace",
                        color: (fx.marketValueOriginalCurrency || fx.marketValue || 0) >= 0 ? '#10b981' : '#ef4444'
                      }}>
                        {formatCurrency(fx.marketValueOriginalCurrency || fx.marketValue || 0, fx.currency)}
                      </td>
                      <td style={{
                        padding: '1rem',
                        textAlign: 'right',
                        fontWeight: '600',
                        fontFamily: "'JetBrains Mono', monospace",
                        color: '#3b82f6'
                      }}>
                        {formatCurrency(fx.marketValue || 0, portfolioCurrency)}
                      </td>
                      <td style={{
                        padding: '1rem',
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem'
                      }}>
                        {fx.portfolioCode || fx.accountNumber || 'N/A'}
                      </td>
                    </tr>
                  ))}
                  {/* Total Row */}
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
                      Total FX Forwards ({fxForwardPositions.length})
                    </td>
                    <td style={{ padding: '1rem' }}></td>
                    <td style={{ padding: '1rem' }}></td>
                    <td style={{ padding: '1rem' }}></td>
                    <td style={{
                      padding: '1rem',
                      textAlign: 'right',
                      fontWeight: '700',
                      color: '#3b82f6',
                      fontSize: '1.1rem'
                    }}>
                      {formatCurrency(totalFxForwardPortfolioValue, portfolioCurrency)}
                    </td>
                    <td style={{ padding: '1rem' }}></td>
                  </tr>
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
                e.currentTarget.style.borderColor = '#10b981';
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
                          <div style={{ fontWeight: '500', color: 'var(--text-primary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {position.linkedProduct ? (
                              <a
                                href={`/report/${position.linkedProduct._id}`}
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                                onMouseEnter={(e) => e.currentTarget.style.color = '#3b82f6'}
                                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                              >
                                {position.name}
                              </a>
                            ) : position.name}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            {position.isin || 'N/A'}
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
                          color: position.gainLoss >= 0 ? '#10b981' : '#ef4444',
                          lineHeight: '1.2'
                        }}>
                          {position.gainLoss >= 0 ? '+' : ''}{formatCurrency(position.gainLoss, portfolioCurrency)}
                        </div>
                        <div style={{
                          fontSize: '0.75rem',
                          fontWeight: '500',
                          fontVariantNumeric: 'tabular-nums',
                          color: position.gainLossPercent >= 0 ? '#10b981' : '#ef4444',
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
                              color: '#10b981',
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
                              color: '#ef4444',
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
                        color: position.currentPrice >= position.avgPrice ? '#10b981' : '#ef4444',
                        fontSize: '0.8rem',
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                        {formatPrice(position.currentPrice, position.currency, position.priceType)}
                      </div>
                      <div style={{
                        fontSize: '0.65rem',
                        fontVariantNumeric: 'tabular-nums',
                        color: position.currentPrice >= position.avgPrice ? '#10b981' : '#ef4444'
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

                      {/* Buy/Sell Buttons - Only for RM/Admin */}
                      {['rm', 'admin', 'superadmin'].includes(user?.role) && (
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                              color: '#10b981',
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
                              color: '#ef4444',
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
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                      <div>
                        <div style={{ fontWeight: '500', color: 'var(--text-primary)', fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                          {assetClass.replace(/_/g, ' ')}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {subtotal.count} position{subtotal.count !== 1 ? 's' : ''} • {subtotal.percentage.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem', fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(subtotal.marketValue, portfolioCurrency)}
                      </div>
                      <div style={{
                        fontSize: '0.8rem',
                        fontWeight: '500',
                        color: subtotal.gainLoss >= 0 ? '#10b981' : '#ef4444',
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
                  <div style={{
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
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '0.625rem 1rem',
                              paddingLeft: '1.5rem',
                              background: theme === 'light' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.08)',
                              borderBottom: '1px solid var(--border-color)',
                              borderLeft: '3px solid rgba(16, 185, 129, 0.4)',
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                {isLevel1Expanded ? '▼' : '▶'}
                              </span>
                              <div>
                                <div style={{ fontWeight: '500', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                  {getUnderlyingTypeLabel(underlyingType)}
                                </div>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                  {level1Total.count} position{level1Total.count !== 1 ? 's' : ''}
                                </div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>
                                {formatCurrency(level1Total.marketValue, portfolioCurrency)}
                              </div>
                              <div style={{
                                fontSize: '0.75rem',
                                color: level1Total.gainLoss >= 0 ? '#10b981' : '#ef4444',
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
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.5rem 1rem',
                                    paddingLeft: '2.5rem',
                                    background: theme === 'light' ? 'rgba(59, 130, 246, 0.03)' : 'rgba(59, 130, 246, 0.05)',
                                    borderBottom: '1px solid var(--border-color)',
                                    borderLeft: '3px solid rgba(59, 130, 246, 0.3)',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                      {isLevel2Expanded ? '▼' : '▶'}
                                    </span>
                                    <div>
                                      <div style={{ fontWeight: '500', color: 'var(--text-primary)', fontSize: '0.8rem' }}>
                                        {getProtectionTypeLabel(protectionType)}
                                      </div>
                                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                                        {level2Total.count} position{level2Total.count !== 1 ? 's' : ''}
                                      </div>
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontWeight: '500', color: 'var(--text-primary)', fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>
                                      {formatCurrency(level2Total.marketValue, portfolioCurrency)}
                                    </div>
                                    <div style={{
                                      fontSize: '0.7rem',
                                      color: level2Total.gainLoss >= 0 ? '#10b981' : '#ef4444',
                                      fontVariantNumeric: 'tabular-nums'
                                    }}>
                                      {level2Total.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(level2Total.gainLoss), portfolioCurrency)}
                                    </div>
                                  </div>
                                </div>

                                {/* Level 2 Positions */}
                                {isLevel2Expanded && (
                                  <div style={{ paddingLeft: '1.5rem' }}>
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
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '0.625rem 1rem',
                              paddingLeft: '1.5rem',
                              background: theme === 'light' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.08)',
                              borderBottom: '1px solid var(--border-color)',
                              borderLeft: '3px solid rgba(16, 185, 129, 0.4)',
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                {isSubExpanded ? '▼' : '▶'}
                              </span>
                              <div>
                                <div style={{ fontWeight: '500', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                  {subClass === 'direct_equity' ? 'Direct'
                                    : subClass === 'equity_fund' ? 'Funds'
                                    : subClass === 'direct_bond' ? 'Direct'
                                    : subClass === 'fixed_income_fund' ? 'Funds'
                                    : subClass}
                                </div>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                  {subTotal.count} position{subTotal.count !== 1 ? 's' : ''}
                                </div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>
                                {formatCurrency(subTotal.marketValue, portfolioCurrency)}
                              </div>
                              <div style={{
                                fontSize: '0.75rem',
                                color: subTotal.gainLoss >= 0 ? '#10b981' : '#ef4444',
                                fontVariantNumeric: 'tabular-nums'
                              }}>
                                {subTotal.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(subTotal.gainLoss), portfolioCurrency)}
                              </div>
                            </div>
                          </div>

                          {/* Sub-Group Positions - Indented */}
                          {isSubExpanded && (
                            <div style={{ paddingLeft: '1rem' }}>
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

  const renderTransactionsSection = () => (
    <div style={{ padding: '1.5rem' }}>
      <LiquidGlassCard style={{
        background: theme === 'light'
          ? '#6b7280'
          : '#0f172a',
        backdropFilter: 'none'
      }}>
        <div style={{ padding: '1.5rem' }}>
          <h3 style={{
            margin: '0 0 1.5rem 0',
            fontSize: '1.25rem',
            fontWeight: '400',
            color: 'var(--text-primary)'
          }}>
            Transaction History ({displayTransactions.length})
          </h3>

          {isLoadingOperations ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              Loading transactions...
            </div>
          ) : displayTransactions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              No transactions found
            </div>
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
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '400', color: 'var(--text-muted)' }}>Date</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '400', color: 'var(--text-muted)' }}>Type</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '400', color: 'var(--text-muted)' }}>Category</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '400', color: 'var(--text-muted)' }}>Security</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '400', color: 'var(--text-muted)' }}>Quantity</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '400', color: 'var(--text-muted)' }}>Price</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '400', color: 'var(--text-muted)' }}>Fees</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '400', color: 'var(--text-muted)' }}>Net Amount</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '400', color: 'var(--text-muted)' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {displayTransactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      transition: 'background 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = theme === 'light' ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.02)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>
                      {new Date(transaction.date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        background: transaction.type === 'BUY'
                          ? 'rgba(16, 185, 129, 0.1)'
                          : transaction.type === 'SELL'
                          ? 'rgba(239, 68, 68, 0.1)'
                          : transaction.type === 'DIVIDEND' || transaction.type === 'COUPON'
                          ? 'rgba(59, 130, 246, 0.1)'
                          : transaction.type === 'FEE'
                          ? 'rgba(245, 158, 11, 0.1)'
                          : 'rgba(139, 92, 246, 0.1)',
                        color: transaction.type === 'BUY'
                          ? '#10b981'
                          : transaction.type === 'SELL'
                          ? '#ef4444'
                          : transaction.type === 'DIVIDEND' || transaction.type === 'COUPON'
                          ? '#3b82f6'
                          : transaction.type === 'FEE'
                          ? '#f59e0b'
                          : '#8b5cf6',
                        fontWeight: '400',
                        fontSize: '0.75rem'
                      }}>
                        {transaction.type}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {transaction.category || 'N/A'}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <div style={{ color: 'var(--accent-color)', fontSize: '0.85rem', fontWeight: '400' }}>
                        {transaction.ticker}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {transaction.instrumentName}
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)' }}>
                      {transaction.quantity !== 0 ? transaction.quantity.toLocaleString() : '-'}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)' }}>
                      {transaction.price !== 0 ? `${transaction.currency} ${transaction.price.toFixed(2)}` : '-'}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {transaction.totalFees !== 0 ? `${transaction.currency} ${transaction.totalFees.toFixed(2)}` : '-'}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)', fontWeight: '400' }}>
                      {transaction.currency} {transaction.netAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {transaction.subtypeName || transaction.remark || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </LiquidGlassCard>
    </div>
  );

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
      return period.twr >= 0 ? '#10b981' : '#ef4444';
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
              background: theme === 'light' ? '#6b7280' : '#0f172a',
              backdropFilter: 'none'
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
        background: theme === 'light' ? '#6b7280' : '#0f172a',
        backdropFilter: 'none'
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

      {/* Portfolio Value Over Time (Absolute) */}
      <LiquidGlassCard style={{
        marginTop: '1rem',
        background: theme === 'light' ? '#6b7280' : '#0f172a',
        backdropFilter: 'none'
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
                            label += formatCurrency(context.parsed.y, portfolioCurrency);
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
                          return formatCurrency(value, portfolioCurrency);
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
        background: theme === 'light' ? '#6b7280' : '#0f172a',
        backdropFilter: 'none'
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
                        backgroundColor: [
                          '#10b981', // Green - Structured Products
                          '#3b82f6', // Blue - Equities
                          '#f59e0b', // Orange - Direct Bonds
                          '#8b5cf6', // Purple - Cash
                          '#ec4899', // Pink - Other
                          '#06b6d4', // Cyan - Additional
                          '#f97316'  // Red-Orange - Additional
                        ],
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
                    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
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
          background: theme === 'light' ? '#6b7280' : '#0f172a',
          backdropFilter: 'none'
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
                    'equity_linked': '#3b82f6',
                    'fixed_income_linked': '#f59e0b',
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
                          borderLeft: `2px solid ${color}80`,
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
        background: theme === 'light' ? '#6b7280' : '#0f172a',
        backdropFilter: 'none'
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
                            'EUR': '#3b82f6',  // Blue
                            'USD': '#10b981',  // Green
                            'CHF': '#ef4444',  // Red
                            'GBP': '#8b5cf6',  // Purple
                            'JPY': '#f59e0b',  // Orange
                            'AUD': '#06b6d4',  // Cyan
                            'CAD': '#ec4899',  // Pink
                            'HKD': '#14b8a6',  // Teal
                            'SGD': '#f97316',  // Orange-Red
                            'CNY': '#dc2626',  // Dark Red
                            'SEK': '#0891b2',  // Dark Cyan
                            'NOK': '#7c3aed',  // Violet
                            'DKK': '#db2777'   // Pink-Red
                          };
                          const defaultColors = ['#64748b', '#475569', '#94a3b8', '#6b7280', '#4b5563'];
                          return currencyColors[c.name] || defaultColors[idx % defaultColors.length];
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
                      'EUR': '#3b82f6',
                      'USD': '#10b981',
                      'CHF': '#ef4444',
                      'GBP': '#8b5cf6',
                      'JPY': '#f59e0b',
                      'AUD': '#06b6d4',
                      'CAD': '#ec4899',
                      'HKD': '#14b8a6',
                      'SGD': '#f97316',
                      'CNY': '#dc2626',
                      'SEK': '#0891b2',
                      'NOK': '#7c3aed',
                      'DKK': '#db2777'
                    };
                    const defaultColors = ['#64748b', '#475569', '#94a3b8', '#6b7280', '#4b5563'];
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

      {/* TWR Performance Summary Table */}
      <LiquidGlassCard style={{
        marginTop: '1rem',
        background: theme === 'light' ? '#6b7280' : '#0f172a',
        backdropFilter: 'none'
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
                          color: isPositive ? '#10b981' : '#ef4444'
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
                  borderLeft: `4px solid ${notification.eventType === 'critical_alert' ? '#ef4444' : '#f59e0b'}`
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
                          color: notification.eventType === 'critical_alert' ? '#ef4444' : '#f59e0b',
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
              color: '#ef4444'
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
              borderLeft: '4px solid #ef4444'
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
                    color: '#ef4444',
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
                          color: data.balanceOriginal < 0 ? '#ef4444' : 'var(--text-primary)',
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
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'flex-start',
          gap: isMobile ? '1rem' : '0',
          marginBottom: '1rem'
        }}>
          {/* Title and PDF button */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap'
          }}>
            <h1 style={{
              margin: 0,
              fontSize: isMobile ? '1.5rem' : '2rem',
              fontWeight: '700',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span style={{ fontSize: isMobile ? '1.5rem' : '2rem' }}>💼</span>
              {isMobile ? 'PMS' : 'Portfolio Management System'}
            </h1>
            {/* PDF Report Download Button - Next to title */}
            <PDFDownloadButton
              reportId={activeAccountTab}
              reportType="pms"
              filename={`Portfolio_Report_${new Date().toISOString().split('T')[0]}`}
              title="Report PDF"
              options={{
                viewAsFilter: viewAsFilter ? JSON.stringify(viewAsFilter) : null,
                accountFilter: activeAccountTab
              }}
              style={{
                padding: '0.5rem 0.75rem',
                background: 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: '600',
                boxShadow: '0 2px 8px rgba(30, 58, 95, 0.25)'
              }}
            />
          </div>

          {/* Date and Account Filters */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            alignItems: isMobile ? 'stretch' : 'flex-end'
          }}>
            {!isMobile && (
              <label style={{
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-muted)'
              }}>
                Portfolio Date:
              </label>
            )}
            {/* Date selector - stacked on mobile */}
            <div style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              gap: '0.5rem',
              alignItems: isMobile ? 'stretch' : 'center'
            }}>
              <select
                value={selectedDate || 'latest'}
                onChange={(e) => setSelectedDate(e.target.value === 'latest' ? null : e.target.value)}
                style={{
                  padding: isMobile ? '0.625rem 0.75rem' : '0.75rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: isMobile ? '0.875rem' : '0.95rem',
                  cursor: 'pointer',
                  minWidth: isMobile ? 'auto' : '200px',
                  fontWeight: '500',
                  transition: 'all 0.2s ease'
                }}
              >
                <option value="latest">Latest (Today)</option>
                {availableDates.map(date => {
                  // Convert Date objects to ISO strings for proper value handling
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
              {/* "or" and date picker row */}
              <div style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                ...(isMobile && { justifyContent: 'space-between' })
              }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>or</span>
                <input
                  type="date"
                  value={selectedDate ? new Date(selectedDate).toISOString().split('T')[0] : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      // Convert to ISO string format matching the dropdown values
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
                    padding: isMobile ? '0.5rem 0.625rem' : '0.75rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: isMobile ? '0.8rem' : '0.95rem',
                    cursor: 'pointer',
                    fontWeight: '500',
                    transition: 'all 0.2s ease',
                    flex: isMobile ? 1 : 'none'
                  }}
                  title="Pick a specific date"
                />
                {selectedDate && (
                  <button
                    onClick={() => setSelectedDate(null)}
                    style={{
                      padding: isMobile ? '0.5rem 0.625rem' : '0.75rem 1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--accent-color)',
                      fontSize: isMobile ? '0.75rem' : '0.875rem',
                      cursor: 'pointer',
                      fontWeight: '600',
                      transition: 'all 0.2s ease',
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
                color: '#f59e0b',
                fontStyle: 'italic',
                fontWeight: '600'
              }}>
                ⚠️ Viewing historical snapshot
              </div>
            )}
          </div>
        </div>

        {/* Portfolio Review Button + Language Picker + Progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
          <div style={{ position: 'relative', display: 'inline-flex' }}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setReviewLangPickerOpen(false); }}
            tabIndex={-1}
          >
            <button
              onClick={() => !reviewGenerating && setReviewLangPickerOpen(!reviewLangPickerOpen)}
              disabled={reviewGenerating}
              style={{
                padding: '0.5rem 0.75rem',
                background: reviewGenerating
                  ? 'linear-gradient(135deg, #6b7280 0%, #9ca3af 100%)'
                  : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: reviewGenerating ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                boxShadow: '0 2px 8px rgba(79, 70, 229, 0.25)',
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
                left: 0,
                marginTop: '4px',
                background: theme === 'dark' ? '#1f2937' : '#fff',
                border: `1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'}`,
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 50,
                overflow: 'hidden',
                minWidth: '120px'
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
                      padding: '0.5rem 0.75rem',
                      background: 'none',
                      border: 'none',
                      textAlign: 'left',
                      fontSize: '0.8rem',
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
          {reviewGenerating && reviewProgress && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap'
            }}>
              <div style={{
                width: '60px',
                height: '4px',
                background: 'var(--border-color, #e5e7eb)',
                borderRadius: '2px',
                overflow: 'hidden'
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
              fontSize: '0.75rem',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}>
              <span>Failed: {reviewError}</span>
              <button
                onClick={() => setReviewError(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  padding: '0 2px'
                }}
              >&times;</button>
            </div>
          )}
        </div>
      </div>

      {/* Historical Data Banner */}
      {selectedDate && (
        <div style={{
          padding: '0.75rem 1rem',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%)',
          border: '2px solid #f59e0b',
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
              color: '#f59e0b'
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
              background: '#f59e0b',
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
              e.currentTarget.style.background = '#f59e0b';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(245, 158, 11, 0.25)';
            }}
          >
            ↻ Return to Latest Portfolio
          </button>
        </div>
      )}

      {/* Data Freshness Panel - Show when viewing latest data, scoped to visible banks */}
      {!selectedDate && holdings.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <DataFreshnessPanel
            sessionId={typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null}
            userId={user?._id || viewAsFilter}
            showWarning={true}
            compact={false}
            visibleBankIds={visibleBankIds}
          />
        </div>
      )}

      {/* Account Tab Layer - Show when viewing a specific client via viewAsFilter and they have multiple accounts */}
      {viewAsFilter && accountTabs.length > 1 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '1rem',
          padding: '0.5rem',
          background: theme === 'light'
            ? 'rgba(255, 255, 255, 0.6)'
            : 'rgba(30, 41, 59, 0.4)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)'
        }}>
          {accountTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveAccountTab(tab.id)}
              style={{
                padding: '0.5rem 0.875rem',
                background: activeAccountTab === tab.id
                  ? 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)'
                  : 'transparent',
                color: activeAccountTab === tab.id ? 'white' : 'var(--text-secondary)',
                border: activeAccountTab === tab.id ? 'none' : '1px solid var(--border-color)',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.8rem',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '0.15rem',
                whiteSpace: 'nowrap',
                boxShadow: activeAccountTab === tab.id ? '0 2px 6px rgba(30, 58, 95, 0.3)' : 'none'
              }}
              onMouseEnter={(e) => {
                if (activeAccountTab !== tab.id) {
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                  e.currentTarget.style.borderColor = 'var(--accent-color)';
                }
              }}
              onMouseLeave={(e) => {
                if (activeAccountTab !== tab.id) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.9rem' }}>{tab.icon}</span>
                <span>{tab.label}</span>
              </div>
              {tab.caption && (
                <span style={{
                  fontSize: '0.65rem',
                  fontWeight: '400',
                  opacity: 0.7,
                  fontStyle: 'italic',
                  paddingLeft: '1.25rem'
                }}>
                  {tab.caption}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Investor Profile & Risk Bar - Always visible when a client is selected */}
      {viewAsFilter && (() => {
        // Detect profile name for selected account or all accounts on consolidated
        const getProfileName = (profile) => {
          if (!profile) return null;
          const match = Object.entries(PROFILE_TEMPLATES).find(([, tpl]) =>
            tpl.maxCash === profile.maxCash &&
            tpl.maxBonds === profile.maxBonds &&
            tpl.maxEquities === profile.maxEquities &&
            tpl.maxAlternative === profile.maxAlternative
          );
          return match ? match[1].name : 'Custom';
        };

        let profileLabel = null;
        if (activeAccountTab === 'consolidated') {
          // Show all unique profile names across accounts
          const names = [...new Set(accountProfiles.map(p => getProfileName(p)).filter(Boolean))];
          if (names.length > 0) profileLabel = names.join(' / ');
        } else {
          profileLabel = getProfileName(selectedAccountProfile);
        }

        const riskLevel = viewAsFilter?.data?.profile?.kyc?.riskLevel;
        const showRisk = user?.role !== 'client' && riskLevel;

        if (!profileLabel && !showRisk) return null;

        const riskConfig = {
          low: { label: 'Low Risk', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)' },
          medium: { label: 'Medium Risk', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)' },
          high: { label: 'High Risk', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.3)' }
        };

        return (
          <div style={{
            marginBottom: '0.75rem',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            flexWrap: 'wrap',
            background: theme === 'light' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(30, 41, 59, 0.5)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)'
          }}>
            {profileLabel && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Investor Profile:</span>
                <span style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  padding: '2px 10px',
                  borderRadius: '4px',
                  background: 'rgba(59, 130, 246, 0.1)',
                  color: '#3b82f6',
                  border: '1px solid rgba(59, 130, 246, 0.2)'
                }}>
                  {profileLabel}
                </span>
              </div>
            )}
            {showRisk && (() => {
              const cfg = riskConfig[riskLevel] || riskConfig.medium;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Risk Matrix:</span>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    padding: '2px 10px',
                    borderRadius: '4px',
                    background: cfg.bg,
                    color: cfg.color,
                    border: `1px solid ${cfg.border}`
                  }}>
                    {cfg.label}
                  </span>
                </div>
              );
            })()}
          </div>
        );
      })()}

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
          <h4 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: '13px', fontWeight: '600' }}>
            Current vs Maximum Allocation
          </h4>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {[
              { key: 'cash', label: 'Cash', icon: '💵', max: selectedAccountProfile?.maxCash ?? null, current: fourCategoryAllocation.cash, color: '#3b82f6', tooltip: 'Cash • Term Deposits • Monetary Products • Money Market Funds' },
              { key: 'bonds', label: 'Bonds', icon: '📄', max: selectedAccountProfile?.maxBonds ?? null, current: fourCategoryAllocation.bonds, color: '#10b981', tooltip: 'Fixed-Income Bonds • Convertible Bonds • Bond Funds • Capital-Guaranteed Structured Products' },
              { key: 'equities', label: 'Equities', icon: '📈', max: selectedAccountProfile?.maxEquities ?? null, current: fourCategoryAllocation.equities, color: '#f59e0b', tooltip: 'Equities & Stocks • Equity Funds • Equity-Linked Structured Products (without capital protection)' },
              { key: 'alternative', label: 'Alternative', icon: '🎯', max: selectedAccountProfile?.maxAlternative ?? null, current: fourCategoryAllocation.alternative, color: '#8b5cf6', tooltip: 'Private Equity • Private Debt • Commodities • Real Estate • Hedge Funds • Derivatives • Other' }
            ].map(item => {
              const hasProfile = item.max !== null;
              const isOverLimit = hasProfile && item.current > item.max;

              return (
                <div key={item.key} style={{ flex: '1 1 140px', minWidth: '120px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span
                      style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'help' }}
                      title={item.tooltip}
                    >
                      <span>{item.icon}</span> {item.label}
                    </span>
                    <span style={{
                      color: isOverLimit ? '#ef4444' : 'var(--text-primary)',
                      fontSize: '12px',
                      fontWeight: '600'
                    }}>
                      {item.current.toFixed(1)}%{hasProfile ? ` / ${item.max}%` : ''}
                      {isOverLimit && <span style={{ marginLeft: '4px' }}>⚠️</span>}
                    </span>
                  </div>
                  <div style={{
                    position: 'relative',
                    height: '16px',
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
                        ? 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
                        : `linear-gradient(90deg, ${item.color} 0%, ${item.color}dd 100%)`,
                      borderRadius: '8px',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
          {!selectedAccountProfile && (
            <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: '11px', textAlign: 'center' }}>
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
                padding: '0.6rem 1rem',
                background: activeTab === tab.id
                  ? 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)'
                  : 'transparent',
                color: activeTab === tab.id ? 'white' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.85rem',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                flex: '1 1 auto',
                minWidth: 'fit-content',
                boxShadow: activeTab === tab.id ? '0 2px 8px rgba(0, 123, 255, 0.3)' : 'none'
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab.id) {
                  e.target.style.background = 'var(--bg-tertiary)';
                  e.target.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab.id) {
                  e.target.style.background = 'transparent';
                  e.target.style.color = 'var(--text-secondary)';
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

      {/* Order Modal */}
      <OrderModal
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
