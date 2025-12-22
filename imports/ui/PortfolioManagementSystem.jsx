import React, { useState, useEffect } from 'react';
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
import { useViewAs } from './ViewAsContext.jsx';
import { getAssetClassLabel, getGranularCategoryLabel, SecuritiesMetadataCollection } from '/imports/api/securitiesMetadata';
import PDFDownloadButton from './components/PDFDownloadButton.jsx';

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

// Helper function to get display label for underlying type
const getUnderlyingTypeLabel = (underlyingType) => {
  const labels = {
    'equity_linked': 'Equity Linked',
    'fixed_income_linked': 'Fixed Income Linked',
    'credit_linked': 'Credit Linked',
    'commodities_linked': 'Commodities Linked'
  };
  return labels[underlyingType] || 'Not Specified';
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
const getAssetClassFromSecurityType = (securityType, securityName = '', productTags = null) => {
  const type = String(securityType || '').trim().toUpperCase();
  const name = (securityName || '').toLowerCase();

  // Map security types to new asset class structure
  if (type === '1' || type === 'EQUITY' || type === 'STOCK') {
    return 'equity';
  }
  if (type === '2' || type === 'BOND' || name.includes('bond') || name.includes('treasury')) {
    return 'fixed_income';
  }
  if (type === '4' || type === 'CASH') {
    return 'cash';
  }
  if (type === 'TERM_DEPOSIT' || type === 'TIME_DEPOSIT') {
    return 'time_deposit';
  }
  if (type === 'FX_FORWARD') {
    return 'fx_forward';
  }
  if (name.includes('money market') || name.includes('t-bill') || name.includes('commercial paper')) {
    return 'monetary_products';
  }
  if (name.includes('gold') || name.includes('silver') || name.includes('commodity') || name.includes('metal') || name.includes('oil')) {
    return 'commodities';
  }
  if (name.includes('capital guaranteed') || name.includes('cap.prot') || name.includes('capital protection')) {
    return 'structured_product';
  }
  if (name.includes('autocallable') || name.includes('barrier') || name.includes('certificate') || name.includes('cert.')) {
    return 'structured_product';
  }

  // Default to structured_product for unknown types
  return 'structured_product';
};

// Helper function to get asset sub-class
const getAssetSubClass = (assetClass, securityType, securityName = '', productTags = null) => {
  const name = (securityName || '').toLowerCase();

  if (assetClass === 'equity') {
    if (name.includes('fund') || name.includes('etf')) {
      return 'equity_fund';
    }
    return 'direct_equity';
  }

  if (assetClass === 'fixed_income') {
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

  // Account view filter
  const [selectedAccountId, setSelectedAccountId] = useState('all'); // 'all' or specific account ID

  // Historical date selector - null means "latest"
  const [selectedDate, setSelectedDate] = useState(null);
  const [availableDates, setAvailableDates] = useState([]);

  // Performance data
  const [performancePeriods, setPerformancePeriods] = useState(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [chartData, setChartData] = useState(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [lastFetchedRange, setLastFetchedRange] = useState(null);
  const [assetAllocation, setAssetAllocation] = useState(null);
  const [currencyAllocation, setCurrencyAllocation] = useState(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState('1Y');

  // Refresh key for forcing re-subscription after file processing (Meteor 3 async publication workaround)
  const [refreshKey, setRefreshKey] = useState(0);

  // Notification alerts from notifications collection
  const [notificationAlerts, setNotificationAlerts] = useState([]);
  const [notificationAlertsLoading, setNotificationAlertsLoading] = useState(false);

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
            alerts = alerts.filter(alert =>
              alert.userId === viewAsFilter.id ||
              (alert.sentToUsers && alert.sentToUsers.includes(viewAsFilter.id))
            );
          } else if (viewAsFilter.type === 'account') {
            // Filter alerts for the selected account
            const accountNumber = viewAsFilter.data?.accountNumber;
            const accountUserId = viewAsFilter.data?.userId;
            alerts = alerts.filter(alert =>
              (alert.metadata?.accountNumber === accountNumber) ||
              (alert.userId === accountUserId && !alert.metadata?.accountNumber)
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
    console.log(`[PMS] Total holdings from bank: ${rawHoldings.length}`);

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
  const { bankAccounts, isLoadingAccounts } = useTracker(() => {
    const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
    const accountsHandle = Meteor.subscribe('userBankAccounts', sessionId);
    const banksHandle = Meteor.subscribe('banks');

    if (!accountsHandle.ready() || !banksHandle.ready()) {
      return { bankAccounts: [], isLoadingAccounts: true };
    }

    const accounts = BankAccountsCollection.find({ isActive: true }, { sort: { accountNumber: 1 } }).fetch();
    const banks = BanksCollection.find({ isActive: true }).fetch();

    // Enrich accounts with bank country code
    const enrichedAccounts = accounts.map(account => {
      const bank = banks.find(b => b._id === account.bankId);
      return {
        ...account,
        bankCountryCode: bank?.countryCode || 'N/A'
      };
    });

    return { bankAccounts: enrichedAccounts, isLoadingAccounts: false };
  }, []);

  const dummyTransactions = operations;

  // Filter holdings and operations by selected account (if not 'all')
  const filteredHoldings = selectedAccountId === 'all'
    ? dummyPositions
    : dummyPositions.filter(pos => {
        const selectedAccount = bankAccounts.find(acc => acc._id === selectedAccountId);
        if (!selectedAccount) return false;
        return pos.portfolioCode === selectedAccount.accountNumber && pos.bankName === selectedAccount.bankId;
      });

  const filteredOperations = selectedAccountId === 'all'
    ? dummyTransactions
    : dummyTransactions.filter(op => {
        const selectedAccount = bankAccounts.find(acc => acc._id === selectedAccountId);
        if (!selectedAccount) return false;
        return op.portfolioCode === selectedAccount.accountNumber && op.bankName === selectedAccount.bankId;
      });

  // Use filtered data for display
  const displayPositions = filteredHoldings;
  const displayTransactions = filteredOperations;

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
  const cashPositions = displayPositions.filter(pos => pos.assetClass === 'cash');
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

  // If viewAsFilter is active, prioritize the selected client/account currency
  if (viewAsFilter) {
    if (viewAsFilter.type === 'account' && viewAsFilter.data?.referenceCurrency) {
      portfolioCurrency = viewAsFilter.data.referenceCurrency;
    } else if (viewAsFilter.type === 'client' && viewAsFilter.data?.reportingCurrency) {
      portfolioCurrency = viewAsFilter.data.reportingCurrency;
    } else {
      // viewAsFilter is active but missing currency - try to get from holdings
      const holdingsCurrency = getHoldingsPortfolioCurrency();
      if (holdingsCurrency) {
        portfolioCurrency = holdingsCurrency;
      }
    }
  } else if (selectedAccountId !== 'all') {
    // Use the selected account's reference currency
    const selectedAccount = bankAccounts.find(acc => acc._id === selectedAccountId);
    if (selectedAccount && selectedAccount.referenceCurrency) {
      portfolioCurrency = selectedAccount.referenceCurrency;
    } else {
      // Account selected but no referenceCurrency - try holdings
      const holdingsCurrency = getHoldingsPortfolioCurrency();
      if (holdingsCurrency) {
        portfolioCurrency = holdingsCurrency;
      }
    }
  } else {
    // No filter, no specific account - try holdings first, then bank accounts
    const holdingsCurrency = getHoldingsPortfolioCurrency();
    if (holdingsCurrency) {
      portfolioCurrency = holdingsCurrency;
    } else if (bankAccounts.length > 0) {
      // Fall back to most common bank account reference currency
      const refCurrencyCounts = bankAccounts.reduce((counts, acc) => {
        const curr = acc.referenceCurrency || 'USD';
        counts[curr] = (counts[curr] || 0) + 1;
        return counts;
      }, {});
      portfolioCurrency = Object.keys(refCurrencyCounts).reduce((a, b) =>
        refCurrencyCounts[a] > refCurrencyCounts[b] ? a : b, 'USD'
      );
    }
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

    // For structured products, group by product type (Phoenix, Autocallable, etc.)
    if (assetClass === 'structured_product') {
      const subClass = position.productType || position.structuredProductType || 'Other';
      if (!groups[assetClass].subGroups[subClass]) {
        groups[assetClass].subGroups[subClass] = [];
      }
      groups[assetClass].subGroups[subClass].push(position);
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

  // Calculate subtotals for each asset class and sub-asset class
  const assetClassSubtotals = Object.keys(groupedPositions).reduce((totals, assetClass) => {
    const group = groupedPositions[assetClass];

    // Collect all positions from all sub-groups
    const allPositions = [
      ...group.positions,
      ...Object.values(group.subGroups).flat()
    ];

    const marketValue = allPositions.reduce((sum, p) => sum + p.marketValue, 0);
    const costBasis = allPositions.reduce((sum, p) => sum + p.costBasis, 0);
    const gainLoss = marketValue - costBasis;
    const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
    const percentage = totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : 0;

    // Determine dominant currency (most common in this asset class)
    const currencyCounts = allPositions.reduce((counts, p) => {
      counts[p.currency] = (counts[p.currency] || 0) + 1;
      return counts;
    }, {});
    const dominantCurrency = Object.keys(currencyCounts).reduce((a, b) =>
      currencyCounts[a] > currencyCounts[b] ? a : b, 'USD'
    );
    const hasMixedCurrencies = Object.keys(currencyCounts).length > 1;

    totals[assetClass] = {
      marketValue,
      costBasis,
      gainLoss,
      gainLossPercent,
      percentage,
      count: allPositions.length,
      currency: dominantCurrency,
      hasMixedCurrencies
    };

    // Calculate subtotals for sub-asset classes
    if (Object.keys(group.subGroups).length > 0) {
      totals[assetClass].subTotals = Object.keys(group.subGroups).reduce((subTotals, subClass) => {
        const subPositions = group.subGroups[subClass];
        const subMarketValue = subPositions.reduce((sum, p) => sum + p.marketValue, 0);
        const subCostBasis = subPositions.reduce((sum, p) => sum + p.costBasis, 0);
        const subGainLoss = subMarketValue - subCostBasis;
        const subGainLossPercent = subCostBasis > 0 ? (subGainLoss / subCostBasis) * 100 : 0;
        const subPercentage = totalPortfolioValue > 0 ? (subMarketValue / totalPortfolioValue) * 100 : 0;

        const subCurrencyCounts = subPositions.reduce((counts, p) => {
          counts[p.currency] = (counts[p.currency] || 0) + 1;
          return counts;
        }, {});
        const subDominantCurrency = Object.keys(subCurrencyCounts).reduce((a, b) =>
          subCurrencyCounts[a] > subCurrencyCounts[b] ? a : b, 'USD'
        );

        subTotals[subClass] = {
          marketValue: subMarketValue,
          costBasis: subCostBasis,
          gainLoss: subGainLoss,
          gainLossPercent: subGainLossPercent,
          percentage: subPercentage,
          count: subPositions.length,
          currency: subDominantCurrency,
          hasMixedCurrencies: Object.keys(subCurrencyCounts).length > 1
        };
        return subTotals;
      }, {});
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

  // Reset performance data when viewAsFilter changes
  React.useEffect(() => {
    if (activeTab === 'performance') {
      setPerformancePeriods(null);
      setChartData(null);
      setLastFetchedRange(null); // Reset so chart refetches with new filter
    }
  }, [viewAsFilter]);

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

  // Fetch performance periods when Performance tab becomes active (only once)
  React.useEffect(() => {
    if (activeTab === 'performance' && !performancePeriods && !performanceLoading) {
      const fetchPerformancePeriods = async () => {
        setPerformanceLoading(true);
        const sessionId = localStorage.getItem('sessionId');

        // Guard: Don't call methods without session
        if (!sessionId) {
          console.error('[PMS] No sessionId found, skipping performance fetch');
          setPerformanceLoading(false);
          setPerformancePeriods({});
          return;
        }

        try {
          // Fetch period performance (1M, 3M, YTD, etc.)
          console.log('[PMS] Calling performance.getPeriods...');
          const periods = await Meteor.callAsync('performance.getPeriods', {
            sessionId,
            viewAsFilter
            // portfolioCode omitted = all portfolios aggregated
          });
          console.log('[PMS] getPeriods SUCCESS');

          setPerformancePeriods(periods);
        } catch (error) {
          console.error('[PMS] Error fetching performance periods:', error);
          setPerformancePeriods({});
        } finally {
          setPerformanceLoading(false);
        }
      };

      fetchPerformancePeriods();
    }
  }, [activeTab, performancePeriods, performanceLoading, viewAsFilter]);

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

          console.log('[PMS] Calling performance.getChartData...', {
            range: selectedTimeRange,
            startDate,
            endDate
          });

          const chart = await Meteor.callAsync('performance.getChartData', {
            sessionId,
            startDate,
            endDate,
            viewAsFilter
          });
          console.log('[PMS] getChartData SUCCESS for range:', selectedTimeRange);

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
  }, [activeTab, selectedTimeRange, lastFetchedRange, chartLoading, viewAsFilter]);

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
    { id: 'alerts', label: 'Alerts', icon: '⚠️' }
  ];

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  };

  // Removed handleIsinClick - using native anchor navigation instead

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
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            {position.isin || 'N/A'}
                          </div>
                        </div>
                      </div>
                      {/* P&L - DOMINANT */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
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

                    {/* Portfolio Value - Secondary emphasis */}
                    <div style={{ textAlign: 'right', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Value</div>
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(position.marketValue, portfolioCurrency)}
                      </div>
                    </div>

                    {/* Quantity - Tertiary */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Qty</div>
                      <div style={{ fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{position.quantity.toLocaleString()}</div>
                    </div>

                    {/* Avg Price - Tertiary */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Avg</div>
                      <div style={{ fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{formatPrice(position.avgPrice, position.currency, position.priceType)}</div>
                    </div>

                    {/* Current Price - Tertiary with color hint */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Now</div>
                      <div style={{
                        color: position.currentPrice >= position.avgPrice ? '#10b981' : '#ef4444',
                        fontSize: '0.8rem',
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                        {formatPrice(position.currentPrice, position.currency, position.priceType)}
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
                    {hasSubGroups && Object.keys(group.subGroups).map((subClass, subIdx) => {
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
                                  {subClass}
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

    // Helper to format performance value
    const formatPerformance = (period) => {
      if (!period || !period.hasData) {
        return { value: 'N/A', color: 'var(--text-muted)' };
      }
      const value = period.returnPercent;
      const formatted = `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
      const color = value >= 0 ? '#10b981' : '#ef4444';
      return { value: formatted, color };
    };

    return (
    <div style={{ padding: '1rem' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        {/* Performance Metrics */}
        <LiquidGlassCard style={{
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
              1 Month Return
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '400',
              color: formatPerformance(performancePeriods?.['1M']).color
            }}>
              {formatPerformance(performancePeriods?.['1M']).value}
            </div>
          </div>
        </LiquidGlassCard>

        <LiquidGlassCard style={{
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
              3 Month Return
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '400',
              color: formatPerformance(performancePeriods?.['3M']).color
            }}>
              {formatPerformance(performancePeriods?.['3M']).value}
            </div>
          </div>
        </LiquidGlassCard>

        <LiquidGlassCard style={{
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
              YTD Return
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '400',
              color: formatPerformance(performancePeriods?.YTD).color
            }}>
              {formatPerformance(performancePeriods?.YTD).value}
            </div>
          </div>
        </LiquidGlassCard>

        <LiquidGlassCard style={{
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
              All Time Return
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '400',
              color: formatPerformance(performancePeriods?.ALL).color
            }}>
              {formatPerformance(performancePeriods?.ALL).value}
            </div>
          </div>
        </LiquidGlassCard>
      </div>

      {/* Performance Chart */}
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
              Portfolio Value Over Time
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
                <div>Loading {selectedTimeRange} data...</div>
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
                          if (label) {
                            label += ': ';
                          }
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
                      beginAtZero: false, // Dynamic scaling based on data
                      grace: '5%', // Add 5% padding above and below data range
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
                Performance history will appear here once you process bank files
              </p>
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

      {/* Performance Metrics Table */}
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
            Performance Summary by Period
          </h3>
          {performancePeriods ? (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600' }}>Period</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: '600' }}>Start Date</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: '600' }}>End Date</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: '600' }}>Start Value</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: '600' }}>End Value</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: '600' }}>Change</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: '600' }}>Return %</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(performancePeriods).map(([periodKey, period]) => {
                    if (!period || !period.hasData) return null;
                    const periodLabels = {
                      '1M': '1 Month',
                      '3M': '3 Months',
                      '6M': '6 Months',
                      'YTD': 'Year to Date',
                      '1Y': '1 Year',
                      'ALL': 'Since Inception'
                    };
                    const returnValue = period.returnAmount || 0;
                    const returnPercent = period.returnPercent || 0;
                    const isPositive = returnPercent >= 0;

                    return (
                      <tr key={periodKey} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.75rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {periodLabels[periodKey] || periodKey}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                          {period.startDate ? new Date(period.startDate).toLocaleDateString() : 'N/A'}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                          {period.endDate ? new Date(period.endDate).toLocaleDateString() : 'N/A'}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {formatCurrency(period.startValue || 0, portfolioCurrency)}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {formatCurrency(period.endValue || 0, portfolioCurrency)}
                        </td>
                        <td style={{
                          padding: '0.75rem',
                          textAlign: 'right',
                          fontWeight: '600',
                          color: isPositive ? '#10b981' : '#ef4444'
                        }}>
                          {isPositive ? '+' : ''}{formatCurrency(returnValue, portfolioCurrency)}
                        </td>
                        <td style={{
                          padding: '0.75rem',
                          textAlign: 'right',
                          fontWeight: '700',
                          fontSize: '1rem',
                          color: isPositive ? '#10b981' : '#ef4444'
                        }}>
                          {isPositive ? '+' : ''}{returnPercent.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '2rem',
              color: 'var(--text-muted)',
              fontSize: '0.875rem'
            }}>
              No performance data available
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: isMobile ? '1.5rem' : '2rem',
              fontWeight: '700',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span style={{ fontSize: isMobile ? '1.5rem' : '2rem' }}>💼</span>
              {isMobile ? 'PMS' : 'Portfolio Management System'}
            </h1>
            {/* PDF Report Download Button - Next to title */}
            <PDFDownloadButton
              reportId={selectedAccountId}
              reportType="pms"
              filename={`Portfolio_Report_${new Date().toISOString().split('T')[0]}`}
              title="Report PDF"
              options={{
                viewAsFilter: viewAsFilter ? JSON.stringify(viewAsFilter) : null,
                accountFilter: selectedAccountId
              }}
              style={{
                marginTop: '0.75rem',
                padding: '0.6rem 1rem',
                background: 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: '600',
                boxShadow: '0 2px 8px rgba(30, 58, 95, 0.25)'
              }}
            />
          </div>

          {/* Date and Account Filters */}
          <div style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'flex-start'
          }}>
            {/* Historical Date Selector */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              alignItems: 'flex-end'
            }}>
              <label style={{
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-muted)'
              }}>
                Portfolio Date:
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select
                  value={selectedDate || 'latest'}
                  onChange={(e) => setSelectedDate(e.target.value === 'latest' ? null : e.target.value)}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    minWidth: '200px',
                    fontWeight: '500',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <option value="latest">📅 Latest (Today)</option>
                  {availableDates.map(date => (
                    <option key={date} value={date}>
                      {new Date(date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </option>
                  ))}
                </select>
                {selectedDate && (
                  <button
                    onClick={() => setSelectedDate(null)}
                    style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--accent-color)',
                      fontSize: '0.875rem',
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
        </div>
      </LiquidGlassCard>
    </div>
  );
};

export default PortfolioManagementSystem;
