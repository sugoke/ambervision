import React, { useState, useEffect } from 'react';
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
    'monetary_products': 6
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

  return `${symbol}${formattedValue}`;
};

// Smart price formatter - uses priceType from bank data to determine format
const formatPrice = (value, currencyCode, priceType) => {
  if (!value && value !== 0) return '-';

  // If priceType is percentage, format as percentage
  if (priceType === 'percentage') {
    const formattedValue = value.toLocaleString('en-US', {
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
  const [filterSector, setFilterSector] = useState('all');
  const [expandedSections, setExpandedSections] = useState({});

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
  const [assetAllocation, setAssetAllocation] = useState(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState('1Y');

  // Fetch real holdings data from database
  const { holdings, isLoading } = useTracker(() => {
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

      return {
        id: holding._id,
        ticker: holding.ticker || holding.isin || 'N/A',
        name: holding.securityName || 'Unknown Security',
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
  }, [viewAsFilter, selectedDate]);

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
        // Always categorize structured products by protection type, never by underlying
        if (protectionType === 'capital_guaranteed_100') {
          categoryKey = 'structured_product_capital_guaranteed';
        } else if (protectionType === 'capital_guaranteed_partial') {
          categoryKey = 'structured_product_partial_guarantee';
        } else if (protectionType === 'capital_protected_conditional') {
          categoryKey = 'structured_product_barrier_protected';
        } else if (protectionType === 'other_protection') {
          categoryKey = 'structured_product_other_protection';
        } else {
          // No protection type defined - generic structured product
          categoryKey = 'structured_product';
        }
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

  // Separate cash and non-cash positions
  const cashPositions = displayPositions.filter(pos => pos.assetClass === 'cash');
  const nonCashPositions = displayPositions.filter(pos => pos.assetClass !== 'cash');

  // Group cash by currency
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
    acc[curr].totalValue += (pos.marketValueOriginalCurrency || pos.marketValue || 0);
    acc[curr].totalPortfolioValue += (pos.marketValueNoAccruedInterest || pos.marketValue || 0);
    acc[curr].positions.push(pos);
    return acc;
  }, {});

  // Calculate total cash in portfolio currency
  const totalCashPortfolioValue = Object.values(cashByCurrency).reduce((sum, cash) => sum + cash.totalPortfolioValue, 0);

  // Filter non-cash positions
  const filteredPositions = nonCashPositions.filter(pos => {
    if (filterAssetClass !== 'all' && pos.assetClass !== filterAssetClass) return false;
    if (filterSector !== 'all' && pos.sector !== filterSector) return false;
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
  const totalCashValue = cashPositions.reduce((sum, pos) => sum + (pos.marketValue || 0), 0);

  // Total portfolio value includes both cash and non-cash positions (all in portfolio currency)
  const totalPortfolioValue = totalNonCashPortfolioValue + totalCashValue;
  const totalGainLoss = totalNonCashGainLoss; // Gain/loss only applies to non-cash positions

  // Determine portfolio reference currency
  // Priority: 1) Selected account's reference currency, 2) Most common currency in holdings, 3) USD default
  let portfolioCurrency = 'USD';
  let portfolioHasMixedCurrencies = false;

  if (selectedAccountId !== 'all') {
    // Use the selected account's reference currency
    const selectedAccount = bankAccounts.find(acc => acc._id === selectedAccountId);
    if (selectedAccount && selectedAccount.referenceCurrency) {
      portfolioCurrency = selectedAccount.referenceCurrency;
    }
  } else {
    // Use the most common bank account reference currency
    if (bankAccounts.length > 0) {
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

  // Get unique asset classes and sectors for filters (exclude Cash)
  const assetClasses = [...new Set(nonCashPositions.map(p => p.assetClass))];
  const sectors = [...new Set(nonCashPositions.map(p => p.sector))];

  // Group positions by asset class, then by sub-classifications
  const groupedPositions = sortedPositions.reduce((groups, position) => {
    const assetClass = position.assetClass;
    if (!groups[assetClass]) {
      groups[assetClass] = {
        positions: [],
        subGroups: {},
        protectionGroups: {}, // For structured products: group by protection type
        underlyingGroups: {}  // For structured products: group by underlying type
      };
    }

    // For structured products, create hierarchical grouping
    if (assetClass === 'structured_product') {
      // Group by underlying type (equity linked, fixed income linked, etc.)
      const underlyingType = position.structuredProductUnderlyingType || 'other';
      if (!groups[assetClass].underlyingGroups[underlyingType]) {
        groups[assetClass].underlyingGroups[underlyingType] = {
          positions: [],
          protectionSubGroups: {}
        };
      }

      // Within underlying type, group by protection type
      const protectionType = position.structuredProductProtectionType || 'other_protection';
      if (!groups[assetClass].underlyingGroups[underlyingType].protectionSubGroups[protectionType]) {
        groups[assetClass].underlyingGroups[underlyingType].protectionSubGroups[protectionType] = [];
      }
      groups[assetClass].underlyingGroups[underlyingType].protectionSubGroups[protectionType].push(position);
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

    // For structured products, also flatten underlying and protection groups
    if (assetClass === 'structured_product') {
      Object.values(group.underlyingGroups).forEach(underlyingGroup => {
        Object.values(underlyingGroup.protectionSubGroups).forEach(protectionPositions => {
          allPositions.push(...protectionPositions);
        });
      });
    }

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

  // Initialize all sections as expanded on first load
  const initializeExpandedSections = () => {
    const initial = {};
    Object.keys(groupedPositions).forEach(assetClass => {
      if (!(assetClass in expandedSections)) {
        initial[assetClass] = true;
      }

      // Also initialize sub-asset class sections for structured products
      const group = groupedPositions[assetClass];
      if (group.subGroups && Object.keys(group.subGroups).length > 0) {
        Object.keys(group.subGroups).forEach(subClass => {
          const subSectionKey = `${assetClass}_${subClass}`;
          if (!(subSectionKey in expandedSections)) {
            initial[subSectionKey] = true;
          }
        });
      }
    });
    if (Object.keys(initial).length > 0) {
      setExpandedSections({ ...expandedSections, ...initial });
    }
  };

  // Initialize on mount
  React.useEffect(() => {
    initializeExpandedSections();
  }, []);

  // Reset performance data when viewAsFilter changes
  React.useEffect(() => {
    if (activeTab === 'performance') {
      setPerformancePeriods(null);
      setChartData(null);
    }
  }, [viewAsFilter]);

  // Fetch performance data when Performance tab becomes active
  React.useEffect(() => {
    if (activeTab === 'performance' && !performancePeriods && !performanceLoading) {
      const fetchPerformanceData = async () => {
        setPerformanceLoading(true);
        const sessionId = localStorage.getItem('sessionId');

        // Guard: Don't call methods without session
        if (!sessionId) {
          console.error('[PMS] No sessionId found, skipping performance fetch');
          setPerformanceLoading(false);
          setPerformancePeriods({});
          setChartData({ hasData: false });
          // Asset allocation is now calculated from holdings, not from server
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

          // Fetch chart data for last year
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

          console.log('[PMS] Calling performance.getChartData...', { startDate: oneYearAgo, endDate: new Date() });
          const chart = await Meteor.callAsync('performance.getChartData', {
            sessionId,
            startDate: oneYearAgo,
            endDate: new Date(),
            viewAsFilter
          });
          console.log('[PMS] getChartData SUCCESS');

          setChartData(chart);

          // Asset allocation is now calculated directly from holdings

        } catch (error) {
          console.error('[PMS] Error fetching performance data:', error);
          // Set empty data to prevent infinite retry loop
          setPerformancePeriods({});
          setChartData({ hasData: false });
        } finally {
          setPerformanceLoading(false);
        }
      };

      fetchPerformanceData();
    }
  }, [activeTab, performancePeriods, performanceLoading, viewAsFilter]);

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

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2rem'
      }}>
        {/* Summary Cards */}
        <LiquidGlassCard style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%)',
          borderLeft: '4px solid #10b981'
        }}>
          <div style={{ padding: '1.5rem' }}>
            <div style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Total Portfolio Value
            </div>
            <div style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#10b981',
              marginBottom: '0.25rem'
            }}>
              {formatCurrency(totalPortfolioValue, portfolioCurrency)}
              {portfolioHasMixedCurrencies && (
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }} title="Portfolio contains mixed currencies">*</span>
              )}
            </div>
            <div style={{
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span style={{ color: totalGainLossPercent >= 0 ? '#10b981' : '#ef4444' }}>
                {totalGainLossPercent >= 0 ? '↑' : '↓'} {Math.abs(totalGainLossPercent).toFixed(2)}%
              </span>
              <span>since inception</span>
            </div>
          </div>
        </LiquidGlassCard>

        <LiquidGlassCard style={{
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.05) 100%)',
          borderLeft: '4px solid #3b82f6'
        }}>
          <div style={{ padding: '1.5rem' }}>
            <div style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Cash Balance
            </div>
            <div style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#3b82f6',
              marginBottom: '0.25rem'
            }}>
              {Object.keys(cashByCurrency).length === 1
                ? formatCurrency(totalCashValue, Object.keys(cashByCurrency)[0])
                : Object.keys(cashByCurrency).length > 1
                ? `${formatCurrency(totalCashValue, portfolioCurrency)}*`
                : formatCurrency(0, portfolioCurrency)}
            </div>
            <div style={{
              fontSize: '0.875rem',
              color: 'var(--text-secondary)'
            }}>
              {Object.keys(cashByCurrency).length === 0 ? 'No cash positions' :
               Object.keys(cashByCurrency).length === 1 ? 'Available for investment' :
               `${Object.keys(cashByCurrency).length} currencies`}
            </div>
          </div>
        </LiquidGlassCard>
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
                        {cash.positions.map(p => p.portfolioCode).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
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

      {/* Positions Table */}
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
            Current Positions
          </h3>

          {/* Filters and Sort Controls */}
          <div style={{
            display: 'flex',
            gap: '1rem',
            marginBottom: '1.5rem',
            flexWrap: 'wrap',
            alignItems: 'center'
          }}>
            {/* Asset Class Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-muted)'
              }}>
                Asset Class:
              </label>
              <select
                value={filterAssetClass}
                onChange={(e) => setFilterAssetClass(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All Classes</option>
                {assetClasses.map(ac => (
                  <option key={ac} value={ac}>{ac}</option>
                ))}
              </select>
            </div>

            {/* Sector Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-muted)'
              }}>
                Sector:
              </label>
              <select
                value={filterSector}
                onChange={(e) => setFilterSector(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All Sectors</option>
                {sectors.map(sector => (
                  <option key={sector} value={sector}>{sector}</option>
                ))}
              </select>
            </div>

            {/* Clear Filters */}
            {(filterAssetClass !== 'all' || filterSector !== 'all') && (
              <button
                onClick={() => {
                  setFilterAssetClass('all');
                  setFilterSector('all');
                }}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  fontWeight: '600',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--bg-secondary)';
                  e.target.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--bg-tertiary)';
                  e.target.style.color = 'var(--text-secondary)';
                }}
              >
                Clear Filters
              </button>
            )}

            {/* Results Count */}
            <div style={{
              marginLeft: 'auto',
              fontSize: '0.875rem',
              color: 'var(--text-muted)'
            }}>
              Showing {sortedPositions.length} of {nonCashPositions.length} positions (excl. cash)
            </div>
          </div>

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
                    paddingLeft: '2.5rem',
                    textAlign: 'left',
                    fontWeight: '500',
                    color: 'var(--text-muted)',
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Asset Class
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: '500',
                    color: 'var(--text-muted)',
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Proportion
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: '500',
                    color: 'var(--text-muted)',
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Size
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: '500',
                    color: 'var(--text-muted)',
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Cost
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: '500',
                    color: 'var(--text-muted)',
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Variation
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'right',
                    fontWeight: '500',
                    color: 'var(--text-muted)',
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Performance
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(groupedPositions).sort((a, b) => getAssetClassSortOrder(a) - getAssetClassSortOrder(b)).map((assetClass) => {
                  const group = groupedPositions[assetClass];
                  const subtotal = assetClassSubtotals[assetClass];
                  const isExpanded = expandedSections[assetClass];
                  const hasSubGroups = Object.keys(group.subGroups).length > 0;

                  return (
                    <React.Fragment key={assetClass}>
                      {/* Asset Class Header Row */}
                      <tr
                        onClick={() => toggleSection(assetClass)}
                        style={{
                          background: theme === 'light'
                            ? 'linear-gradient(135deg, rgba(0, 123, 255, 0.08) 0%, rgba(0, 123, 255, 0.04) 100%)'
                            : 'linear-gradient(135deg, rgba(0, 123, 255, 0.15) 0%, rgba(0, 123, 255, 0.08) 100%)',
                          borderTop: '2px solid var(--border-color)',
                          borderBottom: '2px solid var(--border-color)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = theme === 'light'
                            ? 'linear-gradient(135deg, rgba(0, 123, 255, 0.12) 0%, rgba(0, 123, 255, 0.06) 100%)'
                            : 'linear-gradient(135deg, rgba(0, 123, 255, 0.2) 0%, rgba(0, 123, 255, 0.12) 100%)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = theme === 'light'
                            ? 'linear-gradient(135deg, rgba(0, 123, 255, 0.08) 0%, rgba(0, 123, 255, 0.04) 100%)'
                            : 'linear-gradient(135deg, rgba(0, 123, 255, 0.15) 0%, rgba(0, 123, 255, 0.08) 100%)';
                        }}
                      >
                        <td style={{ padding: '1rem', paddingLeft: '2.5rem', fontWeight: '400', color: 'var(--text-primary)', fontSize: '1rem' }}>
                          <span style={{ marginRight: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                            {isExpanded ? '▼' : '▶'}
                          </span>
                          {assetClass}
                          <span style={{
                            marginLeft: '0.75rem',
                            fontSize: '0.875rem',
                            color: 'var(--text-muted)',
                            fontWeight: '500'
                          }}>
                            ({subtotal.count} position{subtotal.count !== 1 ? 's' : ''})
                          </span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'right', fontWeight: '400', color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                          {subtotal.percentage.toFixed(2)}%
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'right', fontWeight: '400', color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                          {formatCurrency(subtotal.marketValue, portfolioCurrency)}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'right', fontWeight: '400', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                          {formatCurrency(subtotal.costBasis, portfolioCurrency)}
                        </td>
                        <td style={{
                          padding: '1rem',
                          textAlign: 'right',
                          fontWeight: '400',
                          fontSize: '0.875rem',
                          color: subtotal.gainLoss >= 0 ? '#10b981' : '#ef4444'
                        }}>
                          {subtotal.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(subtotal.gainLoss), portfolioCurrency)}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'right' }}>
                          <span style={{
                            padding: '0.35rem 0.65rem',
                            borderRadius: '4px',
                            background: subtotal.gainLossPercent >= 0
                              ? 'rgba(16, 185, 129, 0.15)'
                              : 'rgba(239, 68, 68, 0.15)',
                            color: subtotal.gainLossPercent >= 0 ? '#10b981' : '#ef4444',
                            fontWeight: '400',
                            fontSize: '0.875rem'
                          }}>
                            {subtotal.gainLossPercent >= 0 ? '+' : ''}{subtotal.gainLossPercent.toFixed(2)}%
                          </span>
                        </td>
                      </tr>

                      {/* Render Sub-Asset Classes for Structured Products */}
                      {isExpanded && hasSubGroups && Object.keys(group.subGroups).map((subClass) => {
                        const subPositions = group.subGroups[subClass];
                        const subTotal = subtotal.subTotals[subClass];
                        const subSectionKey = `${assetClass}_${subClass}`;
                        const isSubExpanded = expandedSections[subSectionKey];

                        return (
                          <React.Fragment key={subSectionKey}>
                            {/* Sub-Asset Class Header Row */}
                            <tr
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSection(subSectionKey);
                              }}
                              style={{
                                background: theme === 'light'
                                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.04) 100%)'
                                  : 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0.06) 100%)',
                                borderTop: '1px solid var(--border-color)',
                                borderBottom: '1px solid var(--border-color)',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = theme === 'light'
                                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0.06) 100%)'
                                  : 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.08) 100%)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = theme === 'light'
                                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.04) 100%)'
                                  : 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0.06) 100%)';
                              }}
                            >
                              <td style={{ padding: '0.75rem', paddingLeft: '3.5rem', fontWeight: '400', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                                <span style={{ marginRight: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {isSubExpanded ? '▼' : '▶'}
                                </span>
                                {subClass}
                                <span style={{
                                  marginLeft: '0.5rem',
                                  fontSize: '0.75rem',
                                  color: 'var(--text-muted)',
                                  fontWeight: '400'
                                }}>
                                  ({subTotal.count} position{subTotal.count !== 1 ? 's' : ''})
                                </span>
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '400', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                {subTotal.percentage.toFixed(2)}%
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '400', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                {formatCurrency(subTotal.marketValue, portfolioCurrency)}
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '400', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                {formatCurrency(subTotal.costBasis, portfolioCurrency)}
                              </td>
                              <td style={{
                                padding: '0.75rem',
                                textAlign: 'right',
                                fontWeight: '400',
                                fontSize: '0.85rem',
                                color: subTotal.gainLoss >= 0 ? '#10b981' : '#ef4444'
                              }}>
                                {subTotal.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(subTotal.gainLoss), portfolioCurrency)}
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                <span style={{
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '4px',
                                  background: subTotal.gainLossPercent >= 0
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : 'rgba(239, 68, 68, 0.15)',
                                  color: subTotal.gainLossPercent >= 0 ? '#10b981' : '#ef4444',
                                  fontWeight: '400',
                                  fontSize: '0.75rem'
                                }}>
                                  {subTotal.gainLossPercent >= 0 ? '+' : ''}{subTotal.gainLossPercent.toFixed(2)}%
                                </span>
                              </td>
                            </tr>

                            {/* Thin Column Header Ribbon for Sub-Asset Class */}
                            {isSubExpanded && (
                              <tr style={{
                                background: theme === 'light' ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)',
                                borderBottom: '1px solid var(--border-color)',
                                height: '2rem'
                              }}>
                                <th style={{ padding: '0.25rem 0.75rem', paddingLeft: '4rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'left' }}>ISIN</th>
                                <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'left' }}>Name</th>
                                <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Quantity</th>
                                <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'center' }}>Currency</th>
                                <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Avg Price</th>
                                <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Current Price</th>
                                <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Market Value</th>
                                <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Portfolio Value</th>
                                <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Total Cost</th>
                                <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Gain/Loss</th>
                                <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Return %</th>
                              </tr>
                            )}

                            {/* Individual Positions within Sub-Asset Class */}
                            {isSubExpanded && subPositions.map((position) => (
                              <tr
                                key={position.id}
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
                                <td style={{ padding: '0.75rem', paddingLeft: '4rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                                  {position.linkedProduct ? (
                                    <a
                                      href={`/report/${position.linkedProduct._id}`}
                                      style={{
                                        color: '#3b82f6',
                                        cursor: 'pointer',
                                        textDecoration: 'none',
                                        transition: 'all 0.2s ease',
                                        display: 'inline-block',
                                        padding: '0.5rem',
                                        margin: '-0.5rem',
                                        touchAction: 'manipulation',
                                        WebkitTapHighlightColor: 'rgba(59, 130, 246, 0.2)'
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.textDecoration = 'underline';
                                        e.currentTarget.style.color = '#60a5fa';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.textDecoration = 'none';
                                        e.currentTarget.style.color = '#3b82f6';
                                      }}
                                      title={`View ${position.linkedProduct.productName || 'product'} report`}
                                    >
                                      {position.isin}
                                    </a>
                                  ) : (
                                    <span style={{ color: 'var(--text-secondary)' }}>
                                      {position.isin || 'N/A'}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '0.75rem', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{position.name}</td>
                                <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                  {position.quantity.toLocaleString()}
                                </td>
                                <td style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-primary)' }}>
                                  <span style={{
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '4px',
                                    background: 'var(--bg-tertiary)',
                                    fontSize: '0.7rem',
                                    fontWeight: '400'
                                  }}>
                                    {position.currency}
                                  </span>
                                </td>
                                <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                  {formatPrice(position.avgPrice, position.currency, position.priceType)}
                                </td>
                                <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)', fontWeight: '400', fontSize: '0.85rem' }}>
                                  {formatPrice(position.currentPrice, position.currency, position.priceType)}
                                </td>
                                <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)', fontWeight: '400', fontSize: '0.85rem' }}>
                                  {formatCurrency(position.marketValueOriginalCurrency || position.marketValue, position.currency)}
                                </td>
                                <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: '400', fontSize: '0.85rem' }}>
                                  {formatCurrency(position.marketValue, portfolioCurrency)}
                                </td>
                                <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                  {formatCurrency(position.costBasis, portfolioCurrency)}
                                  {position.currency !== portfolioCurrency && position.costBasisOriginalCurrency && (
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                      {formatCurrency(position.costBasisOriginalCurrency, position.currency)}
                                    </div>
                                  )}
                                </td>
                                <td style={{
                                  padding: '0.75rem',
                                  textAlign: 'right',
                                  color: position.gainLoss >= 0 ? '#10b981' : '#ef4444',
                                  fontWeight: '400',
                                  fontSize: '0.85rem'
                                }}>
                                  {position.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(position.gainLoss), portfolioCurrency)}
                                </td>
                                <td style={{
                                  padding: '0.75rem',
                                  textAlign: 'right',
                                  fontWeight: '400'
                                }}>
                                  <span style={{
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '4px',
                                    background: position.gainLossPercent >= 0
                                      ? 'rgba(16, 185, 129, 0.1)'
                                      : 'rgba(239, 68, 68, 0.1)',
                                    color: position.gainLossPercent >= 0 ? '#10b981' : '#ef4444',
                                    fontSize: '0.75rem'
                                  }}>
                                    {position.gainLossPercent >= 0 ? '+' : ''}{position.gainLossPercent.toFixed(2)}%
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}

                      {/* Structured Products - Hierarchical Groups */}
                      {isExpanded && assetClass === 'structured_product' && group.underlyingGroups &&
                        Object.keys(group.underlyingGroups).map((underlyingType) => {
                          const underlyingGroup = group.underlyingGroups[underlyingType];

                          return Object.keys(underlyingGroup.protectionSubGroups).map((protectionType) => {
                            const positions = underlyingGroup.protectionSubGroups[protectionType];
                            const subSectionKey = `${assetClass}_${underlyingType}_${protectionType}`;
                            const isSubExpanded = expandedSections[subSectionKey];

                            // Calculate subtotals for this protection type group
                            const subMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
                            const subCostBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
                            const subGainLoss = subMarketValue - subCostBasis;
                            const subGainLossPercent = subCostBasis !== 0 ? ((subMarketValue - subCostBasis) / subCostBasis) * 100 : 0;

                            return (
                              <React.Fragment key={subSectionKey}>
                                {/* Protection Type Sub-Header Row */}
                                <tr
                                  onClick={(e) => { e.stopPropagation(); toggleSection(subSectionKey); }}
                                  style={{
                                    cursor: 'pointer',
                                    background: theme === 'light' ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)',
                                    borderTop: '1px solid var(--border-color)'
                                  }}
                                >
                                  <td style={{ padding: '0.75rem', paddingLeft: '2rem' }}>
                                    <span style={{ marginRight: '0.5rem', fontSize: '0.8rem' }}>
                                      {isSubExpanded ? '▼' : '▶'}
                                    </span>
                                    <span style={{ fontWeight: '500', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                      {getProtectionTypeLabel(protectionType)}
                                    </span>
                                  </td>
                                  <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {getUnderlyingTypeLabel(underlyingType)}
                                  </td>
                                  <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {positions.length} {positions.length === 1 ? 'position' : 'positions'}
                                  </td>
                                  <td></td>
                                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: '500', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                    {formatCurrency(subMarketValue, portfolioCurrency)}
                                  </td>
                                  <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    {formatCurrency(subCostBasis, portfolioCurrency)}
                                  </td>
                                  <td style={{ padding: '0.75rem', textAlign: 'right', color: subGainLoss >= 0 ? '#10b981' : '#ef4444', fontSize: '0.85rem' }}>
                                    {subGainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(subGainLoss), portfolioCurrency)}
                                  </td>
                                  <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                    <span style={{
                                      padding: '0.25rem 0.5rem',
                                      borderRadius: '4px',
                                      background: subGainLossPercent >= 0
                                        ? 'rgba(16, 185, 129, 0.1)'
                                        : 'rgba(239, 68, 68, 0.1)',
                                      color: subGainLossPercent >= 0 ? '#10b981' : '#ef4444',
                                      fontSize: '0.75rem'
                                    }}>
                                      {subGainLossPercent >= 0 ? '+' : ''}{subGainLossPercent.toFixed(2)}%
                                    </span>
                                  </td>
                                </tr>

                                {/* Thin Column Header Ribbon for Structured Products */}
                                {isSubExpanded && (
                                  <tr style={{
                                    background: theme === 'light' ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)',
                                    borderBottom: '1px solid var(--border-color)',
                                    height: '2rem'
                                  }}>
                                    <th style={{ padding: '0.25rem 0.75rem', paddingLeft: '3.5rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'left' }}>ISIN</th>
                                    <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'left' }}>Name</th>
                                    <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Quantity</th>
                                    <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Avg Price</th>
                                    <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Current Price</th>
                                    <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Market Value</th>
                                    <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Portfolio Value</th>
                                    <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Total Cost</th>
                                    <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Gain/Loss</th>
                                    <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Return %</th>
                                  </tr>
                                )}

                                {/* Individual Position Rows */}
                                {isSubExpanded && positions.map((position) => (
                                  <tr
                                    key={position.id}
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
                                    <td style={{ padding: '0.75rem', paddingLeft: '3.5rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                                      {position.linkedProduct ? (
                                        <a
                                          href={`/report/${position.linkedProduct._id}`}
                                          style={{
                                            color: '#3b82f6',
                                            cursor: 'pointer',
                                            textDecoration: 'none',
                                            transition: 'all 0.2s ease',
                                            display: 'inline-block',
                                            padding: '0.5rem',
                                            margin: '-0.5rem',
                                            touchAction: 'manipulation',
                                            WebkitTapHighlightColor: 'rgba(59, 130, 246, 0.2)'
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.textDecoration = 'underline';
                                            e.currentTarget.style.color = '#60a5fa';
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.textDecoration = 'none';
                                            e.currentTarget.style.color = '#3b82f6';
                                          }}
                                          title={`View ${position.linkedProduct.productName || 'product'} report`}
                                        >
                                          {position.isin}
                                        </a>
                                      ) : (
                                        <span style={{ color: 'var(--text-secondary)' }}>
                                          {position.isin || 'N/A'}
                                        </span>
                                      )}
                                    </td>
                                    <td style={{ padding: '0.75rem', color: 'var(--text-primary)' }}>{position.name}</td>
                                    <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)' }}>
                                      {position.quantity.toLocaleString()}
                                      <span style={{
                                        marginLeft: '0.5rem',
                                        padding: '0.25rem 0.5rem',
                                        borderRadius: '4px',
                                        background: 'var(--bg-tertiary)',
                                        fontSize: '0.7rem',
                                        fontWeight: '400'
                                      }}>
                                        {position.currency}
                                      </span>
                                    </td>
                                    <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                      {formatPrice(position.avgPrice, position.currency, position.priceType)}
                                    </td>
                                    <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)', fontWeight: '400', fontSize: '0.85rem' }}>
                                      {formatPrice(position.currentPrice, position.currency, position.priceType)}
                                    </td>
                                    <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)', fontWeight: '400', fontSize: '0.85rem' }}>
                                      {formatCurrency(position.marketValueOriginalCurrency || position.marketValue, position.currency)}
                                    </td>
                                    <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: '400', fontSize: '0.85rem' }}>
                                      {formatCurrency(position.marketValue, portfolioCurrency)}
                                    </td>
                                    <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                      {formatCurrency(position.costBasis, portfolioCurrency)}
                                      {position.currency !== portfolioCurrency && position.costBasisOriginalCurrency && (
                                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                          {formatCurrency(position.costBasisOriginalCurrency, position.currency)}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{
                                      padding: '0.75rem',
                                      textAlign: 'right',
                                      color: position.gainLoss >= 0 ? '#10b981' : '#ef4444',
                                      fontWeight: '400',
                                      fontSize: '0.85rem'
                                    }}>
                                      {position.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(position.gainLoss), portfolioCurrency)}
                                    </td>
                                    <td style={{
                                      padding: '0.75rem',
                                      textAlign: 'right',
                                      fontWeight: '400'
                                    }}>
                                      <span style={{
                                        padding: '0.25rem 0.5rem',
                                        borderRadius: '4px',
                                        background: position.gainLossPercent >= 0
                                          ? 'rgba(16, 185, 129, 0.1)'
                                          : 'rgba(239, 68, 68, 0.1)',
                                        color: position.gainLossPercent >= 0 ? '#10b981' : '#ef4444',
                                        fontSize: '0.75rem'
                                      }}>
                                        {position.gainLossPercent >= 0 ? '+' : ''}{position.gainLossPercent.toFixed(2)}%
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </React.Fragment>
                            );
                          });
                        })
                      }

                      {/* Thin Column Header Ribbon for Direct Positions */}
                      {isExpanded && group.positions.length > 0 && (
                        <tr style={{
                          background: theme === 'light' ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.03)',
                          borderBottom: '1px solid var(--border-color)',
                          height: '2rem'
                        }}>
                          <th style={{ padding: '0.25rem 0.75rem', paddingLeft: '2.5rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'left' }}>ISIN</th>
                          <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'left' }}>Name</th>
                          <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Quantity</th>
                          <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'center' }}>Currency</th>
                          <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Avg Price</th>
                          <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Current Price</th>
                          <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Market Value</th>
                          <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Portfolio Value</th>
                          <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Total Cost</th>
                          <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Gain/Loss</th>
                          <th style={{ padding: '0.25rem 0.75rem', fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)', textAlign: 'right' }}>Return %</th>
                        </tr>
                      )}

                      {/* Direct Positions (not in sub-groups) */}
                      {isExpanded && group.positions.map((position) => (
                        <tr
                          key={position.id}
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
                          <td style={{ padding: '0.75rem', paddingLeft: '2.5rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                            {position.linkedProduct ? (
                              <a
                                href={`/report/${position.linkedProduct._id}`}
                                style={{
                                  color: '#3b82f6',
                                  cursor: 'pointer',
                                  textDecoration: 'none',
                                  transition: 'all 0.2s ease',
                                  display: 'inline-block',
                                  padding: '0.5rem',
                                  margin: '-0.5rem',
                                  touchAction: 'manipulation',
                                  WebkitTapHighlightColor: 'rgba(59, 130, 246, 0.2)'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.textDecoration = 'underline';
                                  e.currentTarget.style.color = '#60a5fa';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.textDecoration = 'none';
                                  e.currentTarget.style.color = '#3b82f6';
                                }}
                                title={`View ${position.linkedProduct.productName || 'product'} report`}
                              >
                                {position.isin}
                              </a>
                            ) : (
                              <span style={{ color: 'var(--text-secondary)' }}>
                                {position.isin || 'N/A'}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.75rem', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{position.name}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                            {position.quantity.toLocaleString()}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-primary)' }}>
                            <span style={{
                              padding: '0.25rem 0.5rem',
                              borderRadius: '4px',
                              background: 'var(--bg-tertiary)',
                              fontSize: '0.75rem',
                              fontWeight: '400'
                            }}>
                              {position.currency}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {formatPrice(position.avgPrice, position.currency, position.priceType)}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)', fontWeight: '400' }}>
                            {formatPrice(position.currentPrice, position.currency, position.priceType)}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)', fontWeight: '400' }}>
                            {formatCurrency(position.marketValueOriginalCurrency || position.marketValue, position.currency)}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: '400' }}>
                            {formatCurrency(position.marketValue, portfolioCurrency)}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {formatCurrency(position.costBasis, portfolioCurrency)}
                            {position.currency !== portfolioCurrency && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                {formatCurrency(position.costBasis, position.currency)}
                              </div>
                            )}
                          </td>
                          <td style={{
                            padding: '0.75rem',
                            textAlign: 'right',
                            color: position.gainLoss >= 0 ? '#10b981' : '#ef4444',
                            fontWeight: '400'
                          }}>
                            {position.gainLoss >= 0 ? '+' : ''}{formatCurrency(Math.abs(position.gainLoss), portfolioCurrency)}
                          </td>
                          <td style={{
                            padding: '0.75rem',
                            textAlign: 'right',
                            fontWeight: '400'
                          }}>
                            <span style={{
                              padding: '0.25rem 0.5rem',
                              borderRadius: '4px',
                              background: position.gainLossPercent >= 0
                                ? 'rgba(16, 185, 129, 0.1)'
                                : 'rgba(239, 68, 68, 0.1)',
                              color: position.gainLossPercent >= 0 ? '#10b981' : '#ef4444'
                            }}>
                              {position.gainLossPercent >= 0 ? '+' : ''}{position.gainLossPercent.toFixed(2)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </LiquidGlassCard>
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
          {chartData && chartData.hasData ? (
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
      const bank = BanksCollection.findOne({ _id: alert.bankId });

      return {
        ...alert,
        bankName: bank?.name || 'Unknown Bank',
        accountNumber: account?.accountNumber || alert.portfolioCode,
        accountType: account?.accountType || 'N/A',
        accountStructure: account?.accountStructure || 'N/A',
        referenceCurrency: account?.referenceCurrency || 'EUR'
      };
    });

    // Empty state
    if (enrichedAlerts.length === 0) {
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
                No Negative Cash Balances
              </h3>
              <p style={{
                margin: '0',
                fontSize: '0.95rem',
                color: 'var(--text-muted)'
              }}>
                All accounts in your perimeter have positive or zero cash balances.
              </p>
            </div>
          </LiquidGlassCard>
        </div>
      );
    }

    // Display alerts
    return (
      <div style={{ padding: '1.5rem' }}>
        {/* Summary Header */}
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
              margin: '0 0 0.5rem 0',
              fontSize: '2rem',
              fontWeight: '700',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span style={{ fontSize: '2rem' }}>📈</span>
              Portfolio Management System
            </h1>
            <p style={{
              margin: 0,
              fontSize: '1rem',
              color: 'var(--text-secondary)'
            }}>
              Track and manage your investment portfolio
            </p>
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

            {/* Account Filter Dropdown */}
            {bankAccounts.length > 0 && (
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
                  View Account:
                </label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  disabled={isLoadingAccounts}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    minWidth: '250px',
                    fontWeight: '500',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <option value="all">All Accounts (Aggregated)</option>
                  {bankAccounts.map(account => (
                    <option key={account._id} value={account._id}>
                      {account.accountNumber} - {account.bankCountryCode}
                    </option>
                  ))}
                </select>
                {selectedAccountId !== 'all' && (
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    fontStyle: 'italic'
                  }}>
                    Showing single account data
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Historical Data Banner */}
      {selectedDate && (
        <div style={{
          padding: '1.25rem 1.5rem',
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%)',
          border: '2px solid #f59e0b',
          borderRadius: '12px',
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{
              fontSize: '2rem',
              lineHeight: '1'
            }}>
              📅
            </div>
            <div>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: '700',
                color: '#f59e0b',
                marginBottom: '0.25rem'
              }}>
                Viewing Historical Portfolio
              </div>
              <div style={{
                fontSize: '0.95rem',
                color: 'var(--text-secondary)'
              }}>
                You are viewing portfolio as of{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {new Date(selectedDate).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </strong>
                . This is a snapshot from your bank file on that date.
              </div>
            </div>
          </div>
          <button
            onClick={() => setSelectedDate(null)}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              background: '#f59e0b',
              color: 'white',
              fontSize: '0.95rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(245, 158, 11, 0.25)'
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
