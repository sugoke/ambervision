import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { EquityHoldingsCollection } from '/imports/api/equityHoldings';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { MarketDataHelpers } from '/imports/api/marketDataCache';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { useViewAs } from './ViewAsContext.jsx';
import AddStockModal from './components/AddStockModal.jsx';

// Local UI debug toggle (set to true only when needed)
const DEBUG_UI = false;

// Utility function to format numbers with spaces as thousand separators
const formatNumber = (value, decimals = 2) => {
  // Handle null, undefined, NaN, and invalid values
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
    return '0.00';
  }
  
  const numValue = typeof value === 'number' ? value : parseFloat(value);
  
  // Check if parseFloat resulted in NaN
  if (Number.isNaN(numValue)) {
    return '0.00';
  }
  
  // Format with spaces as thousand separators but keep decimal point
  return numValue.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).replace(/,/g, ' ');
};

// Currency conversion helper for UI display with proper guardrails
const convertForDisplay = (amount, fromCurrency, toCurrency, rates) => {
  if (fromCurrency === toCurrency) return amount;
  if (!amount || amount === 0) return amount;
  if (!rates) return null; // Signal FX unavailable
  
  // Base currency is USD for EOD API rates
  const baseCurrency = 'USD';
  
  // Get conversion rates
  let rateFrom, rateTo;
  
  if (fromCurrency === baseCurrency) {
    rateFrom = 1;
  } else if (fromCurrency === 'EUR' && rates['EURUSD.FOREX']) {
    rateFrom = rates['EURUSD.FOREX']; // EUR to USD rate
  } else {
    return null; // Unsupported currency
  }
  
  if (toCurrency === baseCurrency) {
    rateTo = 1;
  } else if (toCurrency === 'EUR' && rates['EURUSD.FOREX']) {
    rateTo = rates['EURUSD.FOREX']; // EUR to USD rate
  } else {
    return null; // Unsupported currency
  }
  
  if (!rateFrom || !rateTo) return null;
  
  // Convert: amount / rateFrom * rateTo
  // For USD to EUR: amount / 1 * (1/EURUSD) = amount / EURUSD
  // For EUR to USD: amount / EURUSD * 1 = amount * EURUSD
  if (fromCurrency === 'USD' && toCurrency === 'EUR') {
    return amount / rateTo;
  } else if (fromCurrency === 'EUR' && toCurrency === 'USD') {
    return amount * rateFrom;
  }
  
  return null;
};

// Get the true original currency based on stock exchange/symbol
const getStockNativeCurrency = (holding) => {
  const symbol = holding.symbol || '';
  const exchange = holding.exchange || '';
  const fullTicker = holding.fullTicker || '';
  
  // European exchanges - EUR currency
  if (exchange.includes('PA') || exchange.includes('PARIS') || fullTicker.includes('.PA')) {
    return 'EUR'; // Euronext Paris (L'Oréal)
  }
  if (exchange.includes('AS') || exchange.includes('AMSTERDAM') || fullTicker.includes('.AS')) {
    return 'EUR'; // Euronext Amsterdam
  }
  if (exchange.includes('BR') || exchange.includes('BRUSSELS') || fullTicker.includes('.BR')) {
    return 'EUR'; // Euronext Brussels
  }
  if (exchange.includes('MI') || exchange.includes('MILAN') || fullTicker.includes('.MI')) {
    return 'EUR'; // Milan
  }
  if (exchange.includes('DE') || exchange.includes('XETRA') || fullTicker.includes('.DE') || fullTicker.includes('.XETRA')) {
    return 'EUR'; // German exchanges
  }
  if (exchange.includes('MA') || exchange.includes('MADRID') || fullTicker.includes('.MA')) {
    return 'EUR'; // Madrid
  }
  
  // UK exchanges - GBP currency  
  if (exchange.includes('L') || exchange.includes('LONDON') || fullTicker.includes('.L')) {
    return 'GBP'; // London Stock Exchange
  }
  
  // US exchanges - USD currency
  if (exchange.includes('NASDAQ') || exchange.includes('NYSE') || exchange.includes('US') || 
      fullTicker.includes('.NASDAQ') || fullTicker.includes('.NYSE')) {
    return 'USD';
  }
  
  // Default fallback to USD for unknown exchanges
  return 'USD';
};

// Get the true original currency and values for a holding
const getOriginalCurrencyData = (holding, exchangeRates = null) => {
  // Determine the stock's native currency
  const stockNativeCurrency = getStockNativeCurrency(holding);
  
  // Debug logging for L'Oréal
  if (false && DEBUG_UI && (holding.symbol === 'OR' || holding.companyName?.includes('Oreal'))) {
    // Disabled debug logging to prevent console spam
    console.log('🔍 L\'Oréal currency detection:', {
      symbol: holding.symbol,
      exchange: holding.exchange,
      fullTicker: holding.fullTicker,
      detectedCurrency: stockNativeCurrency,
      currentDbCurrency: holding.currency,
      originalDbCurrency: holding.originalCurrency,
      currentPrice: holding.currentPrice,
      originalPrice: holding.originalPrice
    });
  }
  
  // Prefer stock's native currency, but fall back to DB currency when FX conversion is unavailable
  let originalCurrency = stockNativeCurrency;
  
  // For prices, try to get the correct original values
  let originalPrice = holding.currentPrice;
  let originalAveragePrice = holding.averagePrice;
  
  // If the database currency doesn't match detected currency, we may need to convert
  const dbCurrency = holding.currency || 'USD';
  if (dbCurrency !== originalCurrency) {
    if (DEBUG_UI) {
      // console.log(`⚠️ Currency mismatch for ${holding.symbol}: DB has ${dbCurrency}, should be ${originalCurrency}`);
      // console.log(`🔄 Attempting conversion for ${holding.symbol}:`, {
      //   currentPrice: holding.currentPrice,
      //   averagePrice: holding.averagePrice,
      //   fromCurrency: dbCurrency,
      //   toCurrency: originalCurrency,
      //   exchangeRates: exchangeRates
      // });
    }
    
    const convertedPrice = convertForDisplay(holding.currentPrice, dbCurrency, originalCurrency, exchangeRates);
    const convertedAvgPrice = convertForDisplay(holding.averagePrice, dbCurrency, originalCurrency, exchangeRates);
    
    if (DEBUG_UI) {
      // console.log(`📊 Conversion results:`, {
      //   convertedPrice,
      //   convertedAvgPrice
      // });
    }
    
    if (convertedPrice !== null && convertedAvgPrice !== null) {
      originalPrice = convertedPrice;
      originalAveragePrice = convertedAvgPrice;
      if (DEBUG_UI) {
        // console.log(`✅ Converted ${holding.symbol} prices from ${dbCurrency} to ${originalCurrency}:`, {
        //   currentPrice: `${holding.currentPrice} ${dbCurrency} → ${originalPrice.toFixed(2)} ${originalCurrency}`,
        //   averagePrice: `${holding.averagePrice} ${dbCurrency} → ${originalAveragePrice.toFixed(2)} ${originalCurrency}`
        // });
      }
    } else {
      // No FX available between DB currency and detected native currency; fall back to DB currency to avoid mixing currencies
      originalCurrency = dbCurrency;
      originalPrice = holding.currentPrice;
      originalAveragePrice = holding.averagePrice;
      if (DEBUG_UI) {
        // console.log(`❌ FX unavailable for ${dbCurrency} → ${stockNativeCurrency}. Falling back to DB currency ${dbCurrency}.`);
      }
    }
  }
  
  // If we have originalPrice stored and it matches our detected currency, use it
  if (holding.originalPrice && holding.originalCurrency === originalCurrency) {
    originalPrice = holding.originalPrice;
    if (DEBUG_UI) {
      // console.log(`✅ Using stored original price for ${holding.symbol}: ${originalPrice} ${originalCurrency}`);
    }
  }
  
  // Calculate original values based on original prices
  const originalCurrentValue = holding.quantity * originalPrice;
  const originalTotalCost = holding.quantity * originalAveragePrice;
  const originalTotalReturn = originalCurrentValue - originalTotalCost;
  
  return {
    currency: originalCurrency,
    currentPrice: originalPrice,
    averagePrice: originalAveragePrice,
    currentValue: originalCurrentValue,
    totalCost: originalTotalCost,
    totalReturn: originalTotalReturn,
    totalReturnPercent: originalTotalCost > 0.01 ? (originalTotalReturn / originalTotalCost) * 100 : 0
  };
};

// Format currency values with FX conversion or fallback
const formatCurrencyValue = (amount, fromCurrency, toCurrency, rates) => {
  if (fromCurrency === toCurrency) {
    return `${fromCurrency} ${formatNumber(amount)}`;
  }
  
  const convertedAmount = convertForDisplay(amount, fromCurrency, toCurrency, rates);
  
  if (convertedAmount === null) {
    return `${fromCurrency} ${formatNumber(amount)} (FX unavailable)`;
  }
  
  return `${toCurrency} ${formatNumber(convertedAmount)}`;
};

// Utility function to format date/time for price updates in the user's timezone
const formatPriceUpdateTime = (date) => {
  if (!date) return '';
  const priceDate = new Date(date);

  // Use user's locale and timezone
  const locale = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-US';
  const userTimeZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch (_) {
      return undefined;
    }
  })();

  return priceDate.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: userTimeZone
  });
};

// Company Logo Component with fallback handling
const CompanyLogo = ({ logoData, symbol, companyName, size = 40 }) => {
  const [currentLogoIndex, setCurrentLogoIndex] = React.useState(0);
  const [hasError, setHasError] = React.useState(false);

  const logoSources = logoData?.all || [
    `https://financialmodelingprep.com/image-stock/${symbol}.png`
  ];

  const handleImageError = () => {
    if (currentLogoIndex < logoSources.length - 1) {
      setCurrentLogoIndex(prev => prev + 1);
      setHasError(false);
    } else {
      setHasError(true);
    }
  };

  const handleImageLoad = () => {
    setHasError(false);
  };

  if (hasError || !logoSources[currentLogoIndex]) {
    // Fallback to initials
    const initials = companyName
      .split(' ')
      .slice(0, 2)
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase();

    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '8px',
          backgroundColor: 'var(--positive-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: size * 0.4,
          fontWeight: '600',
          flexShrink: 0
        }}
      >
        {initials || symbol.charAt(0)}
      </div>
    );
  }

  return (
    <img
      src={logoSources[currentLogoIndex]}
      alt={`${companyName} logo`}
      onError={handleImageError}
      onLoad={handleImageLoad}
      style={{
        width: size,
        height: size,
        borderRadius: '8px',
        backgroundColor: 'var(--bg-tertiary)',
        objectFit: 'contain',
        flexShrink: 0,
        padding: '2px'
      }}
    />
  );
};

const DirectEquitiesView = ({ user }) => {
  const { viewAsFilter } = useViewAs();
  const [isAddStockModalOpen, setIsAddStockModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
  const [lastPriceUpdate, setLastPriceUpdate] = useState(null);
  const [collapsedAccounts, setCollapsedAccounts] = useState(new Set()); // Track collapsed accounts
  const [confirmRemoveHolding, setConfirmRemoveHolding] = useState(null); // { holdingId, holdingName }
  const [selectedStock, setSelectedStock] = useState(null); // Stock details modal
  const [stockDetails, setStockDetails] = useState(null); // Stock performance data
  const [modifyHolding, setModifyHolding] = useState(null); // Modify holding modal
  const [selectedBankAccount, setSelectedBankAccount] = useState(null); // Currently selected bank account for detailed view
  const [exchangeRates, setExchangeRates] = useState(null); // Currency exchange rates for UI conversion
  const [ratesLoading, setRatesLoading] = useState(true); // Loading state for rates
  const [previousClosePrices, setPreviousClosePrices] = useState({}); // Store previous close prices by symbol
  
  // CSV Upload state
  const [isCsvUploadModalOpen, setIsCsvUploadModalOpen] = useState(false);
  const [csvUploadLoading, setCsvUploadLoading] = useState(false);
  const [csvUploadResult, setCsvUploadResult] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [csvPreviewData, setCsvPreviewData] = useState(null);
  const [csvSelectedBankAccountId, setCsvSelectedBankAccountId] = useState(null);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  const [isTablet, setIsTablet] = useState(typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      const tablet = window.innerWidth >= 768 && window.innerWidth < 1024;
      setIsMobile(mobile);
      setIsTablet(tablet);
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize CSV bank account selection when modal opens
  useEffect(() => {
    if (isCsvUploadModalOpen && !csvSelectedBankAccountId) {
      setCsvSelectedBankAccountId(getTargetBankAccountId());
    }
  }, [isCsvUploadModalOpen]);

  // Get session ID for API calls
  const getSessionId = () => localStorage.getItem('sessionId');

  // Toggle account collapse state
  const toggleAccountCollapse = (bankAccountId) => {
    setCollapsedAccounts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bankAccountId)) {
        newSet.delete(bankAccountId);
      } else {
        newSet.add(bankAccountId);
      }
      return newSet;
    });
  };

  // Get user's bank accounts and holdings
  const { bankAccounts, holdings, allHoldings, isDataReady, users } = useTracker(() => {
    const sessionId = getSessionId();
    // console.log('DirectEquitiesView: Subscribing to userBankAccounts with sessionId:', sessionId);

    // Only subscribe to userBankAccounts with proper session
    const bankAccountsHandle = Meteor.subscribe('userBankAccounts', sessionId);

    // Subscribe to equity holdings with viewAsFilter
    // Publication will handle filtering based on role and viewAsFilter
    const holdingsHandle = Meteor.subscribe('equityHoldings', sessionId, viewAsFilter);

    // For admins and RMs, also subscribe to user data for ownership display
    const usersHandle = (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN || user.role === USER_ROLES.RELATIONSHIP_MANAGER) ?
      Meteor.subscribe('customUsers') : null;

    // Get accessible bank accounts based on role
    // Check what's in the local collection
    const allLocalAccounts = BankAccountsCollection.find({}).fetch();
    console.log('DirectEquitiesView: ALL accounts in local collection:', allLocalAccounts.length, allLocalAccounts.map(a => ({
      id: a._id,
      accountNumber: a.accountNumber,
      isActive: a.isActive
    })));

    const bankAccounts = BankAccountsCollection.find({ isActive: true }, {
      sort: { createdAt: -1 }
    }).fetch();

    console.log('DirectEquitiesView: Found ACTIVE bank accounts:', bankAccounts.length, bankAccounts);
    console.log('DirectEquitiesView: Bank account details:', bankAccounts.map(acc => ({
      id: acc._id,
      accountNumber: acc.accountNumber,
      userId: acc.userId,
      currency: acc.currency,
      isActive: acc.isActive
    })));

    // Get holdings - publication filters based on viewAsFilter and role
    const holdings = EquityHoldingsCollection.find({}, { sort: { currentValue: -1 } }).fetch();

    // For admins: allHoldings is same as holdings (publication handles filtering)
    // For clients: holdings only contains their own holdings
    const allHoldings = holdings;

    // Get user data for bank account ownership display
    const users = UsersCollection.find({}).fetch();

    const isDataReady = bankAccountsHandle.ready() && holdingsHandle.ready() && (!usersHandle || usersHandle.ready());

    console.log('DirectEquitiesView: Subscription status:', {
      bankAccountsReady: bankAccountsHandle.ready(),
      holdingsReady: holdingsHandle.ready(),
      usersReady: !usersHandle || usersHandle.ready(),
      isDataReady,
      viewAsFilter,
      user: { id: user._id, username: user.username, role: user.role }
    });

    return {
      bankAccounts,
      holdings,
      allHoldings,
      users,
      isDataReady
    };
  }, [viewAsFilter, user.role]);

  // Mark as loaded once data is ready
  useEffect(() => {
    if (isDataReady) {
      setIsLoading(false);
    }
  }, [isDataReady]);

  // Initialize all accounts as collapsed by default
  useEffect(() => {
    if (bankAccounts && bankAccounts.length > 0) {
      const allAccountIds = new Set(bankAccounts.map(account => account._id));
      setCollapsedAccounts(allAccountIds);
    }
  }, [bankAccounts.length]); // Only run when number of accounts changes

  // Fetch exchange rates for currency conversion
  useEffect(() => {
    const fetchExchangeRates = async () => {
      try {
        setRatesLoading(true);
        // console.log('Fetching exchange rates for UI currency conversion...');
        
        const result = await Meteor.callAsync('currencyCache.getMainRates');
        // console.log('Exchange rates response:', result);
        
        if (result && result.success && result.rates) {
          setExchangeRates(result.rates);
          // console.log('Exchange rates loaded:', result.rates);
          
          if (result.rates['EURUSD.FOREX']) {
            // console.log(`EURUSD rate: 1 EUR = ${result.rates['EURUSD.FOREX']} USD`);
          }
        } else {
          console.error('Failed to get exchange rates:', result);
          setExchangeRates({});
        }
      } catch (error) {
        console.error('Error fetching exchange rates:', error);
        setExchangeRates({});
      } finally {
        setRatesLoading(false);
      }
    };

    fetchExchangeRates();
    
    // Refresh rates every 15 minutes
    const interval = setInterval(fetchExchangeRates, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);


  // Helper to get target bank account ID from viewAsFilter or holdings
  const getTargetBankAccountId = () => {
    // If viewAsFilter is set to a specific account, use that
    if (viewAsFilter && viewAsFilter.type === 'account') {
      return viewAsFilter.id;
    }

    // If viewAsFilter is set to a client, get their first account
    if (viewAsFilter && viewAsFilter.type === 'client') {
      const clientAccounts = bankAccounts.filter(acc => acc.userId === viewAsFilter.id);
      if (clientAccounts.length > 0) {
        return clientAccounts[0]._id;
      }
    }

    // If no filter and user is client/RM, use their first account
    if (!viewAsFilter && (user.role === USER_ROLES.CLIENT || user.role === USER_ROLES.RELATIONSHIP_MANAGER)) {
      if (bankAccounts.length > 0) {
        return bankAccounts[0]._id;
      }
    }

    // For admins with no filter, use the first available account
    if (bankAccounts.length > 0) {
      return bankAccounts[0]._id;
    }

    return null;
  };

  // Enrich bank accounts with owner display names for admin/RM users
  const enrichedBankAccounts = bankAccounts.map(account => {
    const isAdmin = user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN;
    const isCurrentUser = account.userId === user._id;

    let ownerDisplayName = null;
    if (isAdmin && !isCurrentUser) {
      const accountOwner = users.find(u => u._id === account.userId);
      ownerDisplayName = accountOwner ? (accountOwner.profile?.name || accountOwner.username || 'Unknown User') : 'Unknown User';
    }

    return {
      ...account,
      ownerDisplayName
    };
  });

  const handleAddStock = () => {
    setIsAddStockModalOpen(true);
  };

  const handleStockAdded = async (stockData, transactionData, bankAccountId) => {
    try {
      const sessionId = getSessionId();
      console.log('DirectEquitiesView: Attempting to add stock with:', {
        bankAccountId,
        stockData,
        transactionData,
        sessionId
      });

      const result = await Meteor.callAsync('equityHoldings.add',
        bankAccountId,
        stockData,
        transactionData,
        sessionId
      );
      console.log('DirectEquitiesView: Stock added successfully, result:', result);
      setIsAddStockModalOpen(false);
      // Force a small delay to allow subscription to update
      setTimeout(() => {
        // Refresh price data
        updatePrices();
      }, 500);
    } catch (error) {
      console.error('Error adding stock - Full error details:', {
        message: error.message,
        reason: error.reason,
        error: error.error,
        details: error.details,
        stack: error.stack
      });
      alert('Failed to add stock: ' + (error.reason || error.message || 'Unknown error'));
    }
  };

  const updatePrices = async () => {
    const targetBankAccountId = getTargetBankAccountId();
    if (!targetBankAccountId || isUpdatingPrices) return;

    setIsUpdatingPrices(true);
    try {
      const sessionId = getSessionId();

      // Debug: Check currency rates and test conversion
      console.log('🔍 Debugging currency conversion...');
      console.log('Target bank account ID:', targetBankAccountId);

      try {
        // Check what currency rates are available
        const currencyCheck = await Meteor.callAsync('debug.checkCurrencyRates');
        console.log('💰 Currency cache status:', currencyCheck);

        // Test a simple USD->EUR conversion
        const testConversion = await Meteor.callAsync('debug.testCurrencyConversion', 100, 'USD', 'EUR');
        console.log('🔄 Test conversion 100 USD->EUR:', testConversion);

        // Force refresh currency cache if needed
        if (!currencyCheck.allCachedPairs || currencyCheck.allCachedPairs.length === 0) {
          // console.log('⚠️ No currency rates found, forcing refresh...');
          await Meteor.callAsync('debug.refreshCurrencyCache');
        }
      } catch (debugError) {
        console.warn('Debug currency check failed:', debugError);
      }

      await Meteor.callAsync('equityHoldings.updatePrices', targetBankAccountId, sessionId);
      setLastPriceUpdate(new Date());
    } catch (error) {
      console.error('Error updating prices:', error);
    } finally {
      setIsUpdatingPrices(false);
    }
  };

  const updateAllPrices = async () => {
    if (isUpdatingPrices) return;
    
    setIsUpdatingPrices(true);
    try {
      const sessionId = getSessionId();
      
      // Optimized batch approach: get all unique tickers and update in one call
      const uniqueTickers = [...new Set(allHoldings.map(h => h.fullTicker).filter(Boolean))];
      
      if (uniqueTickers.length > 0) {
        console.log(`Updating ${uniqueTickers.length} unique tickers across all accounts`);
        
        // Use batch price update for all accounts at once
        await Meteor.callAsync('equityHoldings.batchUpdateAllPrices', uniqueTickers, sessionId);
      } else {
        console.log('No tickers found to update');
      }
      
      setLastPriceUpdate(new Date());

      // Force UI refresh after successful price update
      setTimeout(() => {
        console.log('🔄 Forcing UI refresh after currency conversion...');
        // UI will auto-refresh via reactive subscriptions
      }, 1500);
      
    } catch (error) {
      console.error('Error updating all prices:', error);
      
      // Fallback to the old method if batch update fails
      console.log('Falling back to sequential updates...');
      try {
        const accountsWithHoldings = bankAccounts.filter(account => {
          const accountHoldings = allHoldings.filter(h => h.bankAccountId === account._id);
          return accountHoldings.length > 0;
        });
        
        for (const account of accountsWithHoldings) {
          await Meteor.callAsync('equityHoldings.updatePrices', account._id, sessionId);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        setLastPriceUpdate(new Date());
      } catch (fallbackError) {
        console.error('Fallback update also failed:', fallbackError);
      }
    } finally {
      setIsUpdatingPrices(false);
    }
  };

  const fixBankAccountCurrencies = async () => {
    try {
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('debug.fixBankAccountCurrencies', sessionId);
      console.log('🔧 BANK ACCOUNT CURRENCY FIX RESULTS:');
      console.log(result);
      
      alert(`✅ Fixed bank account currencies!\n\n${result.message}\n\nUpdates made:\n${result.updates.map(u => `• ${u.accountNumber}: ${u.from} → ${u.to}`).join('\n')}\n\nNow update prices to see currency conversion in action!`);
    } catch (error) {
      console.error('Error fixing bank account currencies:', error);
      alert('Error fixing bank account currencies: ' + error.message);
    }
  };

  // Test currency conversion
  const testCurrencyConversion = async () => {
    try {
      console.log('🧪 Testing currency conversion...');
      
      // Test USD to EUR conversion with a sample amount
      const testResult1 = await Meteor.callAsync('debug.testCurrencyConversion', 100, 'USD', 'EUR');
      console.log('USD -> EUR Test:', testResult1);
      
      // Test EUR to USD conversion
      const testResult2 = await Meteor.callAsync('debug.testCurrencyConversion', 100, 'EUR', 'USD');
      console.log('EUR -> USD Test:', testResult2);
      
      // Refresh currency rates using existing method
      const refreshResult = await Meteor.callAsync('currencyCache.refresh');
      // console.log('Currency rates refresh:', refreshResult);
      
      // Test with actual Alcoa amount
      console.log('Testing with actual Alcoa amount (8354.37)...');
      const alcoaTest = await Meteor.callAsync('debug.testCurrencyConversion', 8354.37, 'USD', 'EUR');
      console.log('Alcoa test result:', alcoaTest);
      
      alert(`Currency Conversion Tests:
      
USD to EUR: ${testResult1.success ? testResult1.result.toFixed(4) : 'FAILED'}
EUR to USD: ${testResult2.success ? testResult2.result.toFixed(4) : 'FAILED'}
Alcoa (8354.37): ${alcoaTest.success ? alcoaTest.result.toFixed(2) + ' EUR' : 'FAILED'}

Check console for detailed results.`);
      
    } catch (error) {
      console.error('Error testing currency conversion:', error);
      alert('Error testing currency conversion: ' + error.message);
    }
  };

  // Debug specific EUR account Alcoa issue
  const debugEURAccountAlcoa = async () => {
    try {
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('debug.checkEURAccountAlcoa', sessionId);
      console.log('🔍 EUR Account Alcoa Debug Results:', result);
      
      if (result.error) {
        if (result.alcoaFoundIn) {
          const foundInfo = result.alcoaFoundIn.map(info => 
            `${info.accountNumber} (${info.currency}): ${info.currentValue.toFixed(2)} ${info.currency} [stock currency: ${info.holdingCurrency}]`
          ).join('\n');
          
          alert(`${result.error}

But Alcoa was found in these accounts:
${foundInfo}

The EUR and USD amounts you see might be from different accounts, not a conversion issue!`);
        } else {
          alert('Error: ' + result.error);
        }
        return;
      }
      
      const msg = `EUR Account Debug Results:
      
Account: ${result.eurAccount.number} (${result.eurAccount.currency})
Holding Currency: ${result.holding.currency}
Current Price: ${result.holding.currentPrice}
Current Value: ${result.holding.currentValue}
Test Conversion: ${result.testConversion.input} → ${result.testConversion.output.toFixed(2)}
Conversion Working: ${result.testConversion.worked}

Issue: ${result.issue.currenciesMatch ? 'Currencies match - no conversion happening!' : 'Currencies different - should convert'}

Check console for detailed logs.`;
      
      alert(msg);
      
    } catch (error) {
      console.error('Error debugging EUR account:', error);
      alert('Error: ' + error.message);
    }
  };

  // Fix EUR account conversion  
  const fixEURAccountConversion = async () => {
    try {
      const sessionId = getSessionId();
      console.log('🔧 Fixing EUR account conversion...');
      
      const result = await Meteor.callAsync('debug.fixEURAccountConversion', sessionId);
      console.log('Fix results:', result);
      
      if (!result.success) {
        alert('Error fixing EUR conversion: ' + result.error);
        return;
      }
      
      const workingAccounts = result.results.filter(r => r.conversionWorked);
      const failedAccounts = result.results.filter(r => !r.conversionWorked && !r.error);
      const errorAccounts = result.results.filter(r => r.error);
      
      let message = `EUR Account Conversion Fix Results:

${result.message}

✅ Working: ${workingAccounts.length} accounts
❌ Failed: ${failedAccounts.length} accounts  
🚨 Errors: ${errorAccounts.length} accounts`;

      if (workingAccounts.length > 0) {
        message += '\n\n✅ Successfully converted:';
        workingAccounts.forEach(acc => {
          message += `\n${acc.accountNumber}: ${acc.symbols.join(', ')}`;
        });
      }

      message += '\n\nRefresh to see converted EUR values!';
      alert(message);
      
    } catch (error) {
      console.error('Error fixing EUR conversion:', error);
      alert('Error: ' + error.message);
    }
  };

  // Direct database fix for currency issue
  const fixCurrencyDataIssue = async () => {
    try {
      const sessionId = getSessionId();
      console.log('🔧 Fixing currency data issue directly...');
      
      const result = await Meteor.callAsync('debug.fixCurrencyDataIssue', sessionId);
      console.log('Direct fix results:', result);
      
      if (!result.success) {
        alert('Error fixing currency data: ' + result.error);
        return;
      }
      
      let message = `Direct Currency Data Fix Results:

${result.message}

✅ Successful fixes: ${result.summary.successful}
❌ Failed fixes: ${result.summary.failed}`;

      if (result.fixes.length > 0) {
        message += '\n\nFixed holdings:';
        result.fixes.forEach(fix => {
          if (fix.success) {
            message += `\n✅ ${fix.symbol}: ${fix.before.value.toFixed(2)} → ${fix.after.value.toFixed(2)} (rate: ${fix.after.conversionRate?.toFixed(4)})`;
          } else {
            message += `\n❌ ${fix.symbol}: ${fix.error || 'Conversion failed'}`;
          }
        });
      }

      message += '\n\nRefresh page to see corrected values!';
      alert(message);
      
    } catch (error) {
      console.error('Error with direct currency fix:', error);
      alert('Error: ' + error.message);
    }
  };

  // SIMPLE FORCE FIX - Just fix it!
  const simpleForceFixCurrency = async () => {
    if (!confirm('This will directly fix the EUR/USD conversion issue by converting 8354.37 USD to ~7172 EUR. Continue?')) {
      return;
    }
    
    try {
      const sessionId = getSessionId();
      console.log('🚨 Applying simple force fix...');
      
      const result = await Meteor.callAsync('debug.simpleForceFixCurrency', sessionId);
      console.log('Simple force fix results:', result);
      
      if (!result.success) {
        alert('Error with simple fix: ' + result.error);
        return;
      }
      
      let message = `Simple Force Fix Applied!

${result.message}
Exchange rate used: ${result.rate}

Fixed holdings:`;

      result.fixes.forEach(fix => {
        message += `\n• ${fix.symbol} (${fix.account}): ${fix.before.toFixed(2)} → ${fix.after.toFixed(2)} EUR`;
      });

      message += '\n\nRefresh the page to see the corrected EUR values!';
      alert(message);
      
    } catch (error) {
      console.error('Error with simple force fix:', error);
      alert('Error: ' + error.message);
    }
  };

  const debugCurrencyIssue = async () => {
    try {
      const sessionId = getSessionId();
      const diagnosis = await Meteor.callAsync('debug.diagnoseCurrencyIssue', sessionId);
      console.log('🔍 CURRENCY DIAGNOSIS RESULTS:');
      console.log('============================');
      console.log('Bank Accounts:', diagnosis.bankAccounts);
      // console.log('Holdings by Account:', diagnosis.holdingsByAccount);
      console.log('Currency Rates:', diagnosis.currencyRates);
      console.log('Analysis:', diagnosis.analysis);
      
      // Check for TTE currency issue specifically
      diagnosis.holdingsByAccount.forEach(accountData => {
        accountData.holdings.forEach(holding => {
          if (holding.symbol === 'TTE') {
            console.log('🏛️ TTE CURRENCY DETAILS:');
            console.log(`Symbol: ${holding.symbol}`);
            console.log(`Stock Currency: ${holding.stockCurrency}`);
            console.log(`Original Currency: ${holding.originalCurrency}`);
            console.log(`Account Reference Currency: ${accountData.account.referenceCurrency}`);
            console.log(`Current Price: ${holding.currentPrice}`);
            console.log(`Original Price: ${holding.originalPrice}`);
            console.log(`Conversion Rate: ${holding.conversionRate}`);
          }
        });
      });
      
      // Show results in alert for quick review
      const summary = `
CURRENCY DIAGNOSIS:
• Bank Accounts: ${diagnosis.bankAccounts.length} accounts
• Currencies: ${diagnosis.analysis.uniqueCurrencies.join(', ')} ${diagnosis.analysis.multipleCurrencies ? '✅' : '❌ (All same!)'}
• Values: ${diagnosis.analysis.uniqueValues.length} unique values ${diagnosis.analysis.identicalValues ? '❌ (All identical!)' : '✅'}
• Currency Rates: ${diagnosis.currencyRates.length} cached rates
• Expired Rates: ${diagnosis.currencyRates.filter(r => r.isExpired).length}

Check browser console for TTE currency details.`;
      
      alert(summary);
    } catch (error) {
      console.error('Error diagnosing currency issue:', error);
      alert('Error diagnosing currency issue: ' + error.message);
    }
  };

  const handleModifyHolding = (holding) => {
    setModifyHolding({
      ...holding,
      newQuantity: holding.quantity,
      newAveragePrice: holding.averagePrice,
      action: 'modify' // 'modify', 'add', or 'sell'
    });
  };

  const closeModifyModal = () => {
    setModifyHolding(null);
  };

  const handleModifySubmit = async () => {
    try {
      const sessionId = getSessionId();
      const { _id, newQuantity, newAveragePrice, action, quantity: currentQuantity, averagePrice: currentPrice } = modifyHolding;
      
      if (action === 'modify') {
        // Update the holding with new quantity and/or price
        await Meteor.callAsync('equityHoldings.updatePosition', _id, {
          quantity: parseFloat(newQuantity),
          averagePrice: parseFloat(newAveragePrice)
        }, sessionId);
      } else if (action === 'add') {
        // Add more shares
        const additionalShares = parseFloat(newQuantity) - currentQuantity;
        if (additionalShares > 0) {
          await Meteor.callAsync('equityHoldings.addShares', _id, additionalShares, parseFloat(newAveragePrice), sessionId);
        }
      } else if (action === 'sell') {
        // Sell shares
        const sharesToSell = currentQuantity - parseFloat(newQuantity);
        if (sharesToSell > 0) {
          await Meteor.callAsync('equityHoldings.sellShares', _id, sharesToSell, parseFloat(newAveragePrice), 0, new Date(), '', sessionId);
        }
      }
      
      setModifyHolding(null);
    } catch (error) {
      console.error('Error modifying holding:', error);
      alert('Failed to modify holding: ' + error.message);
    }
  };

  const handleRemoveHolding = async (holdingId) => {
    // Find the holding to get its name
    const holding = allHoldings.find(h => h._id === holdingId) || holdings.find(h => h._id === holdingId);
    const holdingName = holding?.symbol || 'this holding';
    
    setConfirmRemoveHolding({ holdingId, holdingName });
  };

  const confirmRemoveHoldingAction = async () => {
    try {
      const sessionId = getSessionId();
      
      console.log('Attempting to remove holding:', {
        holdingId: confirmRemoveHolding.holdingId,
        holdingName: confirmRemoveHolding.holdingName,
        sessionId: sessionId
      });
      
      // Double-check the holding still exists
      const holdingExists = allHoldings.find(h => h._id === confirmRemoveHolding.holdingId) || 
                           holdings.find(h => h._id === confirmRemoveHolding.holdingId);
      
      if (!holdingExists) {
        console.error('Holding not found in current data:', confirmRemoveHolding.holdingId);
        alert('This holding has already been removed or does not exist.');
        setConfirmRemoveHolding(null);
        return;
      }
      
      await Meteor.callAsync('equityHoldings.remove', confirmRemoveHolding.holdingId, sessionId);
      console.log('Successfully removed holding:', confirmRemoveHolding.holdingId);
      setConfirmRemoveHolding(null);
    } catch (error) {
      console.error('Error removing holding:', error);
      alert('Failed to remove holding: ' + (error.reason || error.message));
    }
  };

  const cancelRemoveHolding = () => {
    setConfirmRemoveHolding(null);
  };

  const handleStockClick = async (holding) => {
    console.log('Opening stock details for:', holding.symbol);
    setSelectedStock(holding);
    setStockDetails(null); // Reset previous data
    
    try {
      const sessionId = getSessionId();
      const symbol = holding.symbol;
      const apiExchange = holding.exchange === 'NASDAQ' || holding.exchange === 'NYSE' || holding.exchange === 'AMEX' ? 'US' : holding.exchange;
      
      // Calculate date ranges for historical data
      const today = new Date();
      const yearStart = new Date(today.getFullYear(), 0, 1); // Jan 1 of current year
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1); // First day of current month
      const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
      
      // Use single comprehensive API call to get all stock data at once
      const stockDataResult = await Promise.allSettled([
        Meteor.callAsync('eod.getStockDetails', {
          symbol,
          exchange: apiExchange,
          companyName: holding.companyName,
          includeRealTime: true,
          includeNews: true,
          newsLimit: 5,
          historicalDates: [
            { type: 'ytd', date: yearStart.toISOString().split('T')[0] },
            { type: 'mtd', date: monthStart.toISOString().split('T')[0] },
            { type: 'oneYear', date: oneYearAgo.toISOString().split('T')[0] }
          ]
        })
      ]);
      
      let realTimeData = null;
      let newsData = [];
      let logoData = null;
      let ytdResult = { status: 'rejected' };
      let mtdResult = { status: 'rejected' };
      let oneYearResult = { status: 'rejected' };
      
      // Extract data from comprehensive response or fallback to current method
      if (stockDataResult[0].status === 'fulfilled' && stockDataResult[0].value) {
        const stockData = stockDataResult[0].value;
        realTimeData = stockData.realTime;
        newsData = stockData.news || [];
        logoData = stockData.logo;
        
        if (stockData.historical) {
          ytdResult = { status: 'fulfilled', value: stockData.historical.ytd };
          mtdResult = { status: 'fulfilled', value: stockData.historical.mtd };
          oneYearResult = { status: 'fulfilled', value: stockData.historical.oneYear };
        }
      } else {
        // Fallback to original method if comprehensive API is not available
        console.log('Comprehensive stock data API not available, using fallback method');
        
        // Get real-time data and news
        const [realTimeResult, newsResult] = await Promise.allSettled([
          Meteor.callAsync('eod.getRealTimePrice', symbol, apiExchange),
          Meteor.callAsync('eod.getSecurityNews', symbol, apiExchange, 5)
        ]);
        
        // Get historical prices for performance calculations
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        const [ytdRes, mtdRes, oneYearRes, yesterdayRes] = await Promise.allSettled([
          Meteor.callAsync('eod.getEndOfDayPrice', symbol, apiExchange, yearStart.toISOString().split('T')[0]),
          Meteor.callAsync('eod.getEndOfDayPrice', symbol, apiExchange, monthStart.toISOString().split('T')[0]),
          Meteor.callAsync('eod.getEndOfDayPrice', symbol, apiExchange, oneYearAgo.toISOString().split('T')[0]),
          Meteor.callAsync('eod.getEndOfDayPrice', symbol, apiExchange, yesterdayStr)
        ]);
        
        realTimeData = realTimeResult.status === 'fulfilled' ? realTimeResult.value : null;
        newsData = newsResult.status === 'fulfilled' ? newsResult.value : [];
        ytdResult = ytdRes;
        mtdResult = mtdRes;
        oneYearResult = oneYearRes;
        const yesterdayResult = yesterdayRes;
        
        // Generate logo data for fallback
        logoData = {
          primary: `https://financialmodelingprep.com/image-stock/${symbol}.png`,
          fallbacks: []
        };
      }
      
      const currentPrice = realTimeData?.close || holding.currentPrice || 0;
      
      // Calculate stock performance metrics
      const stockPerformance = {
        currentPrice,
        currency: holding.currency || 'USD',
        
        // Day performance - use EOD API change data directly
        dayChange: (() => {
          // First priority: Use API provided change value if available
          if (realTimeData?.change !== undefined && realTimeData.change !== null) {
            return realTimeData.change;
          }
          
          const currentPrice = currentPriceNumber || 0;
          
          // Second priority: Check server-calculated day change from holding
          if (holding.dayChange !== undefined && holding.dayChange !== null) {
            const quantity = holding.quantity || 0;
            if (quantity > 0) {
              return holding.dayChange / quantity; // Per share change
            }
            return holding.dayChange; // Already per share
          }
          
          // Third priority: Calculate from previous close price
          const previousClose = realTimeData?.previousClose || holding.previousClosePrice;
          if (currentPrice > 0 && previousClose > 0) {
            return currentPrice - previousClose;
          }
          
          // Try to find any previous price field in the API response
          const possiblePreviousFields = [
            'previous_close', 'prev_close', 'close_yesterday',
            'yesterday_close', 'last_close', 'previous', 'open'
          ];
          
          for (const field of possiblePreviousFields) {
            if (realTimeData && realTimeData[field] && realTimeData[field] > 0) {
              const previousPrice = realTimeData[field];
              if (currentPrice > 0) {
                return currentPrice - previousPrice;
              }
              break;
            }
          }
          
          // Last resort: return 0 (no change data available)
          return 0;
        })(),
        dayChangePercent: (() => {
          // Use API provided change percentage if available
          if (realTimeData?.change_p && realTimeData.change_p !== 0) {
            return realTimeData.change_p;
          }
          
          // Calculate percentage using same logic as dayChange above
          const dayChangeValue = stockPerformance.dayChange;
          const currentPrice = currentPriceNumber || 0;
          
          if (dayChangeValue !== 0 && currentPrice > 0) {
            const previousPrice = currentPrice - dayChangeValue;
            if (previousPrice > 0) {
              return (dayChangeValue / previousPrice) * 100;
            }
          }
          
          return 0;
        })(),
        
        // YTD performance
        ytdStartPrice: ytdResult.status === 'fulfilled' ? ytdResult.value?.close : null,
        ytdChange: null,
        ytdChangePercent: null,
        
        // MTD performance  
        mtdStartPrice: mtdResult.status === 'fulfilled' ? mtdResult.value?.close : null,
        mtdChange: null,
        mtdChangePercent: null,
        
        // 1 Year performance
        oneYearStartPrice: oneYearResult.status === 'fulfilled' ? oneYearResult.value?.close : null,
        oneYearChange: null,
        oneYearChangePercent: null,
        
        // 52-week range from real-time data (if available)
        week52High: realTimeData?.high || null,
        week52Low: realTimeData?.low || null,
        
        // Portfolio context (user's position)
        userPosition: {
          shares: holding.quantity || 0,
          avgPrice: holding.averagePrice || 0,
          totalCost: holding.totalCost || 0,
          currentValue: holding.currentValue || 0,
          totalReturn: holding.totalReturn || 0,
          // Calculate day change correctly from stock price movement
          dayChange: (() => {
            const quantity = holding.quantity || 0;
            const stockDayChange = stockPerformance.dayChange || 0; // Per share change from above
            return quantity * stockDayChange;
          })(),
          returnPercent: (() => {
            // Calculate percentage using fundamental values to avoid corrupted totalCost
            const quantity = holding.quantity || 0;
            const purchasePrice = holding.averagePrice || 0;
            const currentPrice = currentPriceNumber;
            
            if (quantity > 0 && purchasePrice > 0 && currentPrice > 0) {
              const totalCostCalc = quantity * purchasePrice;
              const currentValueCalc = quantity * currentPrice;
              const percent = ((currentValueCalc - totalCostCalc) / totalCostCalc) * 100;
              console.log(`[DEBUG] ${holding.symbol}: qty=${quantity}, purchasePrice=${purchasePrice}, currentPrice=${currentPrice}, percent=${percent}`);
              return Number.isFinite(percent) ? percent : 0;
            }
            return 0;
          })(),
          totalReturnPercent: (() => {
            // Calculate percentage using fundamental values to avoid corrupted totalCost
            const quantity = holding.quantity || 0;
            const purchasePrice = holding.averagePrice || 0;
            const currentPrice = currentPriceNumber;
            
            if (quantity > 0 && purchasePrice > 0 && currentPrice > 0) {
              const totalCostCalc = quantity * purchasePrice;
              const currentValueCalc = quantity * currentPrice;
              const percent = ((currentValueCalc - totalCostCalc) / totalCostCalc) * 100;
              return Number.isFinite(percent) ? percent : 0;
            }
            return 0;
          })()
        }
      };
      
      // Calculate performance metrics
      if (stockPerformance.ytdStartPrice && currentPrice > 0) {
        stockPerformance.ytdChange = currentPrice - stockPerformance.ytdStartPrice;
        stockPerformance.ytdChangePercent = (stockPerformance.ytdChange / stockPerformance.ytdStartPrice) * 100;
      }
      
      if (stockPerformance.mtdStartPrice && currentPrice > 0) {
        stockPerformance.mtdChange = currentPrice - stockPerformance.mtdStartPrice;
        stockPerformance.mtdChangePercent = (stockPerformance.mtdChange / stockPerformance.mtdStartPrice) * 100;
      }
      
      if (stockPerformance.oneYearStartPrice && currentPrice > 0) {
        stockPerformance.oneYearChange = currentPrice - stockPerformance.oneYearStartPrice;
        stockPerformance.oneYearChangePercent = (stockPerformance.oneYearChange / stockPerformance.oneYearStartPrice) * 100;
      }
      
      setStockDetails({
        stockPerformance,
        realTimeData: realTimeData,
        news: newsData,
        logo: logoData,
        lastUpdated: new Date()
      });
      
    } catch (error) {
      console.error('Error fetching stock details:', error);
      setStockDetails({
        stockPerformance: null,
        realTimeData: null,
        news: [],
        error: error.message,
        lastUpdated: new Date()
      });
    }
  };

  const closeStockModal = () => {
    setSelectedStock(null);
    setStockDetails(null);
  };

  const handleSellShares = async (holdingId, quantity, price) => {
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('equityHoldings.sellShares', holdingId, quantity, price, 0, new Date(), '', sessionId);
    } catch (error) {
      console.error('Error selling shares:', error);
      alert('Failed to sell shares: ' + error.message);
    }
  };

  // Auto-refresh prices every 15 minutes and trigger initial update
  useEffect(() => {
    if (!user) return;

    // Initial price update when component loads or user/accounts change
    const initialUpdate = () => {
      if (user.role === 'admin' || user.role === 'superadmin') {
        updateAllPrices();
      } else {
        updatePrices();
      }
    };

    // Trigger initial update after a short delay
    const initialTimeout = setTimeout(initialUpdate, 1000);

    // Set up periodic updates every 15 minutes
    const interval = setInterval(() => {
      if (user.role === 'admin' || user.role === 'superadmin') {
        updateAllPrices();
      } else {
        updatePrices();
      }
    }, 15 * 60 * 1000); // 15 minutes

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [user, viewAsFilter, bankAccounts, allHoldings]);

  // Calculate summary statistics for selected bank account (values already stored in account reference currency)
  const summary = holdings.reduce((acc, h) => {
    const currentValue = Number.isFinite(h.currentValue) ? h.currentValue : 0;
    const totalCost = Number.isFinite(h.totalCost) ? h.totalCost : 0;
    
    // Use the stored dayChange from database (calculated from EOD API's change/change_p)
    // This shows the last session's performance whether market is open or closed
    const dayChange = (() => {
      // First try to use the stored dayChange value from database
      if (h.dayChange !== undefined && h.dayChange !== null) {
        return h.dayChange;
      }
      
      // Fallback calculation if database value is not available
      const quantity = h.quantity || 0;
      const currentPrice = h.currentPrice || 0;
      
      // Try to get previous close from multiple sources (same as row calculation)
      let previousClose = h.previousClose || 
                         previousClosePrices[h.symbol] || 
                         null;
      
      // Check if we have cached price data as fallback
      if (!previousClose && h.priceData) {
        previousClose = h.priceData.previousClose || 
                       h.priceData.previous_close ||
                       h.priceData.prev_close ||
                       h.priceData.open;
      }
      
      // Calculate day change if we have both current and previous prices
      if (currentPrice > 0 && previousClose > 0) {
        const priceChange = currentPrice - previousClose;
        return priceChange * quantity; // Total P&L change for this holding
      }
      
      return 0;
    })();
    
    const totalReturn = Number.isFinite(h.totalReturn)
      ? h.totalReturn
      : (Number.isFinite(h.currentValue) && Number.isFinite(h.totalCost)) ? (h.currentValue - h.totalCost) : 0;

    acc.totalValue += currentValue;
    acc.totalCost += totalCost;
    acc.dayChange += dayChange;
    acc.totalReturn += totalReturn;
    return acc;
  }, { totalValue: 0, totalCost: 0, dayChange: 0, totalReturn: 0 });

  const totalReturnPercent = (() => {
    // Calculate based on actual current vs original cost to avoid corrupted totalCost
    const originalCost = summary.totalValue - summary.totalReturn;
    return (originalCost > 0.01 && Number.isFinite(summary.totalReturn)) ? 
      (summary.totalReturn / originalCost) * 100 : 0;
  })();
  const dayChangePercent = summary.totalValue > 0 ? (summary.dayChange / (summary.totalValue - summary.dayChange)) * 100 : 0;

  // Calculate admin overview statistics (all portfolios) in a single currency (USD)
  const adminOverview = (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN) ? 
    allHoldings.reduce((acc, holding) => {
      const original = getOriginalCurrencyData(holding, exchangeRates);
      const toCurrency = 'USD';

      // Current value and total cost in USD
      const cv = convertForDisplay(original.currentValue || 0, original.currency, toCurrency, exchangeRates);
      const tc = convertForDisplay(original.totalCost || 0, original.currency, toCurrency, exchangeRates);

      const currentValue = (cv === null || Number.isNaN(cv)) ? (original.currency === 'USD' ? (original.currentValue || 0) : 0) : cv;
      const totalCost = (tc === null || Number.isNaN(tc)) ? (original.currency === 'USD' ? (original.totalCost || 0) : 0) : tc;
      const totalReturn = currentValue - totalCost;

      // Previous close based day change: quantity * (price - previousClose)
      // Use fetched previous close prices from EOD API
      let prevCloseNative = holding.previousClose || holding.originalPreviousClose || previousClosePrices[holding.symbol] || null;
      
      // Day change calculation for holding
      
      const dayChangeNative = (prevCloseNative && original.currentPrice) ? (original.currentPrice - prevCloseNative) * holding.quantity : 0;
      const dayChangeUSD = convertForDisplay(dayChangeNative, original.currency, toCurrency, exchangeRates) || 0;
      
      // Day change calculated

      acc.totalValue += currentValue;
      acc.totalCost += totalCost;
      acc.dayChange += dayChangeUSD;
      acc.totalReturn += totalReturn;
      acc.holdingsCount++;
      return acc;
    }, { 
      totalValue: 0, 
      totalCost: 0, 
      dayChange: 0, 
      totalReturn: 0, 
      holdingsCount: 0,
      currencyWarning: null
    }) : null;

  const adminOverviewReturnPercent = adminOverview && adminOverview.totalCost > 0.01 ? 
    (adminOverview.totalReturn / adminOverview.totalCost) * 100 : 0;
  // Compute Day Change as currentValue - previousCloseValue across holdings (USD)
  const adminOverviewDayChangePercent = adminOverview && adminOverview.totalValue > 0 ? 
    (adminOverview.dayChange / (adminOverview.totalValue - adminOverview.dayChange)) * 100 : 0;

  // Debug logs to verify totals (print once)
  const loggedAdminRef = useRef(false);
  useEffect(() => {
    if (!adminOverview || loggedAdminRef.current) return;
    loggedAdminRef.current = true;
    try {
      console.log('[AdminOverview] USD totals:', {
        totalValue: adminOverview.totalValue,
        totalCost: adminOverview.totalCost,
        totalReturn: adminOverview.totalReturn,
        dayChange: adminOverview.dayChange,
        holdingsCount: adminOverview.holdingsCount
      });
      const byCurrency = allHoldings.reduce((acc, h) => {
        const c = h.currency || 'USD';
        if (!acc[c]) acc[c] = { totalValue: 0, totalCost: 0, totalReturn: 0, dayChange: 0, count: 0 };
        acc[c].totalValue += Number.isFinite(h.currentValue) ? h.currentValue : 0;
        acc[c].totalCost += Number.isFinite(h.totalCost) ? h.totalCost : 0;
        acc[c].totalReturn += Number.isFinite(h.totalReturn) ? h.totalReturn : 0;
        acc[c].dayChange += Number.isFinite(h.dayChange) ? h.dayChange : 0;
        acc[c].count += 1;
        return acc;
      }, {});
      console.log('[AdminOverview] Raw sums by account reference currency (no FX):', byCurrency);
    } catch (e) {
      console.warn('AdminOverview debug logging failed:', e);
    }
  }, [adminOverview, allHoldings]);

  // Fetch previous close prices for day change calculation
  useEffect(() => {
    if (!allHoldings || allHoldings.length === 0) return;
    
    const fetchPreviousClosePrices = async () => {
      try {
        const sessionId = getSessionId();
        
        // Get the last trading day (not just yesterday, accounts for weekends/holidays)
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        // If it's Monday, go back to Friday
        if (today.getDay() === 1) {
          yesterday.setDate(yesterday.getDate() - 2);
        }
        // If it's Sunday, go back to Friday
        else if (today.getDay() === 0) {
          yesterday.setDate(yesterday.getDate() - 2);
        }
        
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        console.log('Fetching previous close prices for day change calculation (date: ' + yesterdayStr + ')...');
        
        const promises = allHoldings.map(async (holding) => {
          try {
            // First check if we already have previousClose from the holding data
            if (holding.previousClosePrice && holding.previousClosePrice > 0) {
              console.log(`Using stored previousClose for ${holding.symbol}: ${holding.previousClosePrice}`);
              return { symbol: holding.symbol, previousClose: holding.previousClosePrice };
            }
            
            const symbol = holding.symbol;
            const apiExchange = holding.exchange === 'NASDAQ' || holding.exchange === 'NYSE' || holding.exchange === 'AMEX' ? 'US' : holding.exchange;
            
            const yesterdayPrice = await Meteor.callAsync('eod.getEndOfDayPrice', symbol, apiExchange, yesterdayStr);
            
            if (yesterdayPrice && yesterdayPrice.close) {
              console.log(`Got previous close for ${symbol}: ${yesterdayPrice.close}`);
              return { symbol, previousClose: yesterdayPrice.close };
            }
          } catch (error) {
            console.warn(`Failed to get previous close for ${holding.symbol}:`, error.message);
          }
          return { symbol: holding.symbol, previousClose: null };
        });
        
        const results = await Promise.allSettled(promises);
        const pricesMap = {};
        
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value) {
            pricesMap[result.value.symbol] = result.value.previousClose;
          }
        });
        
        console.log('Previous close prices fetched:', pricesMap);
        setPreviousClosePrices(pricesMap);
        
      } catch (error) {
        console.error('Error fetching previous close prices:', error);
      }
    };
    
    // Only fetch if we don't have prices yet
    if (Object.keys(previousClosePrices).length === 0) {
      fetchPreviousClosePrices();
    }
  }, [allHoldings, previousClosePrices]);

  // Group all holdings by bank account for admin view
  const holdingsByAccount = (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN) ? 
    allHoldings.reduce((acc, holding) => {
      if (!acc[holding.bankAccountId]) {
        acc[holding.bankAccountId] = [];
      }
      acc[holding.bankAccountId].push(holding);
      return acc;
    }, {}) : {};

  if (isLoading || ratesLoading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '400px',
        color: 'var(--text-primary)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            fontSize: '2rem', 
            marginBottom: '1rem',
            animation: 'spin 1s linear infinite'
          }}>📈</div>
          <p>{ratesLoading ? 'Loading exchange rates...' : 'Loading your equity holdings...'}</p>
        </div>
      </div>
    );
  }

  // CSV Upload functions
  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    const data = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Detect separator - check if line contains semicolon or comma
      let separator = ',';
      if (line.includes(';') && !line.includes(',')) {
        separator = ';';
      } else if (line.includes(';') && line.includes(',')) {
        // If both exist, prefer semicolon if it appears before comma
        const semicolonIndex = line.indexOf(';');
        const commaIndex = line.indexOf(',');
        if (semicolonIndex < commaIndex) {
          separator = ';';
        }
      }
      
      // Split by detected separator
      const values = line.split(separator).map(val => val.trim().replace(/^["']|["']$/g, ''));
      
      if (values.length >= 4) {
        // Handle European decimal format (comma as decimal separator)
        let quantity = values[1];
        let purchasePrice = values[3];
        
        if (separator === ';') {
          // European format: semicolon separator with comma as decimal
          if (quantity.includes(',')) {
            quantity = quantity.replace(',', '.');
          }
          if (purchasePrice.includes(',')) {
            purchasePrice = purchasePrice.replace(',', '.');
          }
        }
        
        data.push({
          isin: values[0],
          quantity: parseFloat(quantity) || 0,
          currency: values[2] || 'USD',
          purchasePrice: parseFloat(purchasePrice) || 0,
          totalValue: (parseFloat(quantity) || 0) * (parseFloat(purchasePrice) || 0)
        });
      }
    }
    
    return data;
  };

  const handleCsvFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setCsvUploadResult({
        success: false,
        error: 'Please select a CSV file'
      });
      return;
    }

    setCsvFile(file);
    setCsvUploadResult(null);

    try {
      const text = await file.text();
      const csvData = parseCSV(text);
      
      if (csvData.length === 0) {
        setCsvUploadResult({
          success: false,
          error: 'No valid data found in CSV file'
        });
        setCsvPreviewData(null);
        return;
      }

      setCsvPreviewData(csvData.slice(0, 10)); // Preview first 10 rows
    } catch (error) {
      console.error('CSV processing error:', error);
      setCsvUploadResult({
        success: false,
        error: 'Failed to process file: ' + error.message
      });
      setCsvPreviewData(null);
    }
  };

  const handleCsvUpload = async () => {
    if (!csvFile || !csvSelectedBankAccountId) {
      setCsvUploadResult({
        success: false,
        error: 'Please select a CSV file and bank account'
      });
      return;
    }

    setCsvUploadLoading(true);
    setCsvUploadResult(null);

    try {
      const text = await csvFile.text();
      const csvData = parseCSV(text);

      if (csvData.length === 0) {
        setCsvUploadResult({
          success: false,
          error: 'No valid data found in CSV file'
        });
        setCsvUploadLoading(false);
        return;
      }

      console.log('Uploading CSV holdings data:', csvData);

      // Upload to server
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('equityHoldings.uploadCsv',
        csvSelectedBankAccountId,
        csvData,
        sessionId
      );
      
      console.log('CSV upload result:', result);
      setCsvUploadResult(result);
      
      if (result.success) {
        // Close modal and refresh data after successful upload
        setTimeout(() => {
          setIsCsvUploadModalOpen(false);
          setCsvFile(null);
          setCsvPreviewData(null);
          setCsvUploadResult(null);
          setCsvSelectedBankAccountId(null);
          updatePrices(); // Refresh price data
        }, 2000);
      }

    } catch (error) {
      console.error('CSV upload error:', error);
      setCsvUploadResult({
        success: false,
        error: error.message || 'Upload failed'
      });
    } finally {
      setCsvUploadLoading(false);
    }
  };

  const handleCreateTestData = async () => {
    try {
      console.log('Creating test data...');
      const sessionId = getSessionId();
      console.log('Session ID:', sessionId);
      
      const result = await Meteor.callAsync('admin.createTestData', sessionId);
      console.log('Test data creation result:', result);
      
      alert(result.message);
      
      // Force data refresh without page reload
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      
    } catch (error) {
      console.error('Error creating test data:', error);
      console.error('Error details:', error.reason, error.message, error.error);
      alert('Failed to create test data: ' + (error.reason || error.message || 'Unknown error'));
    }
  };

  const handleCreateMyBankAccount = async () => {
    try {
      console.log('Creating my bank account...');
      const sessionId = getSessionId();
      
      const result = await Meteor.callAsync('admin.createMyBankAccount', sessionId);
      console.log('Bank account creation result:', result);
      
      alert(result.message);
      
      // Force data refresh
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      
    } catch (error) {
      console.error('Error creating bank account:', error);
      alert('Failed to create bank account: ' + (error.reason || error.message || 'Unknown error'));
    }
  };

  const handleDebugBankAccounts = async () => {
    try {
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('admin.debugBankAccounts', sessionId);
      console.log('Debug result:', result);
      alert(`Debug complete: ${result.allCount} total accounts, ${result.activeCount} active, ${result.userCount} yours. Check console for details.`);
    } catch (error) {
      console.error('Error debugging bank accounts:', error);
      alert('Debug failed: ' + (error.reason || error.message || 'Unknown error'));
    }
  };

  if (bankAccounts.length === 0) {
    const isAdmin = user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN;
    
    return (
      <div style={{
        padding: '2rem',
        textAlign: 'center',
        color: 'var(--text-primary)'
      }}>
        <h2>No Bank Accounts Found</h2>
        <p>You need to have at least one bank account to manage equity holdings.</p>
        
        {isAdmin ? (
          <div style={{ marginTop: '2rem' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              As an administrator, you can create sample data to test the equity holdings functionality.
            </p>
            <button
              onClick={handleCreateMyBankAccount}
              style={{
                padding: '1rem 2rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: 'var(--positive-color)',
                color: 'white',
                fontSize: '1rem',
                cursor: 'pointer',
                marginRight: '1rem'
              }}
            >
              🏦 Create My Account
            </button>
            <button
              onClick={handleCreateTestData}
              style={{
                padding: '1rem 2rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#FF9800',
                color: 'white',
                fontSize: '1rem',
                cursor: 'pointer',
                marginRight: '1rem'
              }}
            >
              🧪 Create Test Data
            </button>
            <button
              onClick={handleDebugBankAccounts}
              style={{
                padding: '1rem 2rem',
                borderRadius: '8px',
                border: '1px solid #FF9800',
                backgroundColor: 'transparent',
                color: '#FF9800',
                fontSize: '1rem',
                cursor: 'pointer'
              }}
            >
              🔍 Debug
            </button>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
              <strong>Create My Account:</strong> Creates a bank account for you only<br/>
              <strong>Create Test Data:</strong> Creates sample accounts and holdings for all users
            </p>
          </div>
        ) : (
          <p>Please contact your administrator to set up a bank account.</p>
        )}
      </div>
    );
  }

  return (
    <div style={{
      padding: isMobile ? '0.75rem' : '1rem',
      minHeight: '100vh',
      backgroundColor: 'var(--bg-primary)',
      color: 'var(--text-primary)'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'center',
        marginBottom: '1rem',
        gap: isMobile ? '1rem' : '0.5rem'
      }}>
        <div>
          <h1 style={{
            margin: 0,
            fontSize: isMobile ? '1.5rem' : '1.8rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span style={{ fontSize: isMobile ? '2rem' : '2.5rem' }}>📊</span>
            <span style={{
              background: 'linear-gradient(135deg, #FF9800 0%, #F57C00 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              Direct Equities
            </span>
          </h1>
          <p style={{
            margin: '0.25rem 0 0 0',
            fontSize: isMobile ? '0.85rem' : '0.95rem',
            color: 'var(--text-muted)'
          }}>
            Equity holdings management per bank account
            {user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN ? 
              ' • Admin View: All accounts' : 
              user.role === USER_ROLES.RELATIONSHIP_MANAGER ? 
                ' • RM View: Your clients\' accounts' : 
                ' • Your personal accounts'
            }
          </p>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? '0.75rem' : '1rem',
          alignItems: isMobile ? 'stretch' : 'center',
          width: isMobile ? '100%' : 'auto'
        }}>
          {/* Action Buttons */}
          <button
            onClick={handleAddStock}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#FF9800',
              color: 'white',
              fontSize: isMobile ? '0.9rem' : '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              minHeight: '44px'
            }}
          >
            📈 Add Stock
          </button>

          <button
            onClick={() => setIsCsvUploadModalOpen(true)}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#4CAF50',
              color: 'white',
              fontSize: isMobile ? '0.9rem' : '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              minHeight: '44px'
            }}
          >
            📁 Upload CSV
          </button>
        </div>
      </div>

      {/* Price Update Status */}
      {lastPriceUpdate && (
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          padding: '0.5rem 0.75rem',
          borderRadius: '8px',
          marginBottom: '2rem',
          fontSize: '0.9rem',
          color: 'var(--text-muted)',
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          flexWrap: 'wrap'
        }}>
          <span>
            Last updated: {lastPriceUpdate.toLocaleTimeString()}
          </span>
          <span style={{
            fontSize: '0.8rem',
            color: 'var(--success-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem'
          }}>
            🔄 Auto-refresh: Every 15 minutes
          </span>
        </div>
      )}

      {/* Admin Overview - All Portfolios Summary */}
      {(user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN) && adminOverview && (
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem',
          border: '2px solid #FF9800'
        }}>
          <h2 style={{ 
            margin: '0 0 1rem 0', 
            fontSize: '1.4rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            🏦 All Portfolios Overview
            <span style={{ 
              fontSize: '0.9rem', 
              backgroundColor: '#FF9800',
              color: 'white',
              padding: '0.25rem 0.75rem',
              borderRadius: '12px',
              fontWeight: 'normal'
            }}>
              Admin View
            </span>
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : (isTablet ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(200px, 1fr))'),
            gap: '1rem',
            marginBottom: '2rem'
          }}>
            <div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Total Value (All Accounts)
              </div>
                              <div style={{ fontSize: '1.3rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                  USD {formatNumber(adminOverview.totalValue)}
                </div>
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Total Return
              </div>
                              <div style={{ 
                  fontSize: '1.3rem', 
                  fontWeight: '600', 
                  color: adminOverview.totalReturn >= 0 ? 'var(--positive-color)' : '#FF9800' 
                }}>
                  USD {formatNumber(adminOverview.totalReturn)}
                  <span style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                    ({formatNumber(adminOverviewReturnPercent)}%)
                  </span>
                </div>
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Day Change
              </div>
                              <div style={{ 
                  fontSize: '1.3rem', 
                  fontWeight: '600', 
                  color: adminOverview.dayChange >= 0 ? 'var(--positive-color)' : '#FF9800' 
                }}>
                  USD {formatNumber(adminOverview.dayChange)}
                  <span style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                    ({formatNumber(adminOverviewDayChangePercent)}%)
                  </span>
                </div>
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Total Holdings
              </div>
              <div style={{ fontSize: '1.3rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                {adminOverview.holdingsCount} stocks
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Active Accounts
              </div>
              <div style={{ fontSize: '1.3rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                {Object.keys(holdingsByAccount).length} accounts
              </div>
            </div>
          </div>

          {/* All Holdings Breakdown by Account */}
          {Object.keys(holdingsByAccount).length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1.3rem' }}>Holdings by Account</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ 
                  width: '100%', 
                  borderCollapse: 'collapse',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                }}>
                  <thead>
                    <tr style={{ 
                      backgroundColor: 'var(--bg-primary)',
                      borderBottom: '2px solid var(--border-color)' 
                    }}>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'left',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)'
                      }}>Symbol</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'left',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        width: '20%',
                        maxWidth: '200px'
                      }}>Company</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)'
                      }}>Shares</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        minWidth: '120px'
                      }}>Purchase Price</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        minWidth: '120px'
                      }}>Current Price</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        minWidth: '120px'
                      }}>Market Value</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)'
                      }}>Total Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(holdingsByAccount).flatMap(([bankAccountId, accountHoldings]) => {
                      const bankAccount = bankAccounts.find(acc => acc._id === bankAccountId);
                      // Try to find the user by exact match first, then by string conversion
                      let owner = users.find(u => u._id === bankAccount?.userId);
                      if (!owner && bankAccount?.userId) {
                        // Try finding by string conversion (handles ObjectId vs string mismatches)
                        const userIdStr = String(bankAccount.userId);
                        owner = users.find(u => String(u._id) === userIdStr);
                      }
                      
                      let ownerName;
                      if (owner?.profile) {
                        ownerName = `${owner.profile.firstName || ''} ${owner.profile.lastName || ''}`.trim() || 
                                   owner.username || owner.email;
                      } else if (owner?.username || owner?.email) {
                        ownerName = owner.username || owner.email;
                      } else if (bankAccount?.userId) {
                        // Still no user found - show ID for debugging
                        const userIdStr = String(bankAccount.userId);
                        ownerName = `User ID: ${userIdStr.substring(0, 8)}...`;
                      } else {
                        ownerName = 'No Owner';
                      }
                      
                      // Calculate account totals for collapsed view
                      const accountSummary = accountHoldings.reduce((acc, holding) => {
                        // Values in DB are already in the account reference currency
                        const currentValue = Number.isFinite(holding.currentValue) ? holding.currentValue : 0;
                        const totalReturn = Number.isFinite(holding.totalReturn)
                          ? holding.totalReturn
                          : (Number.isFinite(holding.currentValue) && Number.isFinite(holding.totalCost)) ? (holding.currentValue - holding.totalCost) : 0;

                        // Use the stored dayChange from database (calculated from EOD API's change/change_p)
                        const dayChange = (() => {
                          // First try to use the stored dayChange value from database
                          if (holding.dayChange !== undefined && holding.dayChange !== null) {
                            return holding.dayChange;
                          }
                          
                          // Fallback calculation if database value is not available
                          const quantity = holding.quantity || 0;
                          const currentPrice = holding.currentPrice || 0;
                          
                          // Try to get previous close from multiple sources
                          let previousClose = holding.previousClose || 
                                             previousClosePrices[holding.symbol] || 
                                             null;
                          
                          // Check if we have cached price data as fallback
                          if (!previousClose && holding.priceData) {
                            previousClose = holding.priceData.previousClose || 
                                           holding.priceData.previous_close ||
                                           holding.priceData.prev_close ||
                                           holding.priceData.open;
                          }
                          
                          // Calculate day change if we have both current and previous prices
                          if (currentPrice > 0 && previousClose > 0) {
                            const priceChange = currentPrice - previousClose;
                            return priceChange * quantity; // Total P&L change for this holding
                          }
                          
                          return 0;
                        })();

                        const totalCost = Number.isFinite(holding.totalCost) ? holding.totalCost : 0;

                        acc.totalValue += currentValue;
                        acc.totalCost += totalCost;
                        acc.totalReturn += totalReturn;
                        acc.dayChange += dayChange;
                        acc.holdingsCount++;

                        return acc;
                      }, { totalValue: 0, totalCost: 0, totalReturn: 0, dayChange: 0, holdingsCount: 0 });
                      
                      return accountHoldings.map((holding, index) => [
                        // Account header row (only for first account or when starting new account)
                        ...(index === 0 ? [
                          <tr key={`${bankAccountId}-header`} style={{ 
                            backgroundColor: 'var(--bg-primary)',
                            borderBottom: '2px solid var(--border-color)',
                            fontWeight: '600'
                          }}>
                            {/* Account header cells to align with table columns */}
                            <td style={{ padding: '0.5rem', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <button
                                  onClick={() => toggleAccountCollapse(bankAccountId)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    color: 'var(--text-primary)',
                                    padding: '0.25rem',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    minWidth: '24px',
                                    height: '24px'
                                  }}
                                  title={collapsedAccounts.has(bankAccountId) ? 'Expand account' : 'Collapse account'}
                                >
                                  {collapsedAccounts.has(bankAccountId) ? '▶️' : '🔽'}
                                </button>
                                <div>
                                  <div style={{ fontWeight: '600' }}>{bankAccount?.accountNumber}</div>
                                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    {bankAccount?.referenceCurrency}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                              <div>{ownerName}</div>
                              {collapsedAccounts.has(bankAccountId) && (
                                <div style={{ fontSize: '0.8rem' }}>
                                  {accountSummary.holdingsCount} stock{accountSummary.holdingsCount !== 1 ? 's' : ''}
                                </div>
                              )}
                            </td>
                            <td></td> {/* Shares column */}
                            <td></td> {/* Purchase Price column */}
                            <td></td> {/* Current Price column */}
                            <td style={{ 
                              padding: '0.5rem', 
                              textAlign: 'right',
                              fontFamily: 'monospace',
                              fontSize: '0.9rem'
                            }}>
                              {/* Market Value only */}
                              <div style={{ 
                                color: 'var(--text-primary)',
                                fontWeight: '600'
                              }}>
                                {bankAccount?.referenceCurrency} {formatNumber(accountSummary.totalValue)}
                              </div>
                            </td>
                            <td style={{ 
                              padding: '0.5rem', 
                              textAlign: 'right',
                              fontFamily: 'monospace',
                              fontSize: '0.9rem'
                            }}>
                              {/* Total Return for account */}
                              <div>
                                <div style={{ 
                                  color: accountSummary.totalReturn >= 0 ? 'var(--positive-color)' : '#FF9800',
                                  fontWeight: '600'
                                }}>
                                  {bankAccount?.referenceCurrency} {formatNumber(accountSummary.totalReturn)}
                                </div>
                                <div style={{ 
                                  fontSize: '0.8rem',
                                  color: accountSummary.totalReturn >= 0 ? 'var(--positive-color)' : '#FF9800',
                                  opacity: 0.8
                                }}>
                                  ({accountSummary.totalReturn >= 0 ? '+' : ''}{ (() => {
                                    // Calculate percentage based on original cost vs current value
                                    const percentCalc = accountSummary.totalValue > 0 && (accountSummary.totalValue - accountSummary.totalReturn) > 0.01 ? 
                                      (accountSummary.totalReturn / (accountSummary.totalValue - accountSummary.totalReturn)) * 100 : 0;
                                    return formatNumber(Number.isFinite(percentCalc) ? percentCalc : 0);
                                  })() }%)
                                </div>
                              </div>
                            </td>
                          </tr>
                        ] : []),
                        // Stock row (conditionally rendered based on collapse state)
                        ...(!collapsedAccounts.has(bankAccountId) ? [
                        <tr 
                          key={holding._id} 
                          onClick={() => handleStockClick(holding)}
                          style={{ 
                            borderBottom: '1px solid var(--border-color)',
                            cursor: 'pointer'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <td style={{ padding: '0.5rem', paddingLeft: '1rem' }}>
                            <div style={{ fontWeight: '600' }}>{holding.symbol}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              {holding.exchange}
                            </div>
                          </td>
                          <td style={{ padding: '0.5rem' }}>
                            <div style={{ fontSize: '0.8rem' }}>{holding.companyName}</div>
                            {holding.sector && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                {holding.sector}
                              </div>
                            )}
                          </td>
                          <td style={{ 
                            padding: '1rem', 
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem'
                          }}>
                            {formatNumber(holding.quantity, 0)}
                          </td>
                          <td style={{ 
                            padding: '1rem', 
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem'
                          }}>
                            {(() => { const d = getOriginalCurrencyData(holding, exchangeRates); return (
                              <>
                                <div style={{ fontWeight: '600' }}>
                                  {d.currency} {formatNumber(d.averagePrice)}
                                </div>
                                {d.currency !== bankAccount.referenceCurrency && (
                                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                                    {formatCurrencyValue(d.averagePrice, d.currency, bankAccount.referenceCurrency, exchangeRates)}
                                  </div>
                                )}
                              </>
                            ); })()}
                          </td>
                          <td style={{ 
                            padding: '1rem', 
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem'
                          }}>
                            {(() => { const d = getOriginalCurrencyData(holding, exchangeRates); return (
                              <>
                                <div style={{ fontWeight: '600' }}>
                                  {d.currency} {formatNumber(d.currentPrice)}
                                </div>
                                {d.currency !== bankAccount.referenceCurrency && (
                                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                                    {formatCurrencyValue(d.currentPrice, d.currency, bankAccount.referenceCurrency, exchangeRates)}
                                  </div>
                                )}
                                {holding.lastPriceUpdate && (
                                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                    {formatPriceUpdateTime(holding.lastPriceUpdate, holding)}
                                  </div>
                                )}
                              </>
                            ); })()}
                          </td>
                          <td style={{ 
                            padding: '1rem', 
                            textAlign: 'right', 
                            fontWeight: '600',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem'
                          }}>
                            {(() => { const d = getOriginalCurrencyData(holding, exchangeRates); return (
                              <>
                                <div style={{ fontWeight: '600' }}>
                                  {d.currency} {formatNumber(d.currentValue)}
                                </div>
                                {d.currency !== bankAccount.referenceCurrency && (
                                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                                    {formatCurrencyValue(d.currentValue, d.currency, bankAccount.referenceCurrency, exchangeRates)}
                                  </div>
                                )}
                              </>
                            ); })()}
                          </td>
                          <td style={{ 
                            padding: '1rem', 
                            textAlign: 'right', 
                            color: (holding.totalReturn || 0) >= 0 ? 'var(--positive-color)' : '#FF9800',
                            fontWeight: '600',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem'
                          }}>
                            <div>
                              {bankAccount.referenceCurrency} {formatNumber(holding.totalReturn)}
                            </div>
                            <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                              ({formatNumber(holding.totalReturnPercent)}%)
                            </div>
                          </td>
                        </tr>
                        ] : []) // End conditional rendering for collapsed accounts
                      ]);
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedBankAccount && (
        <>
          {/* Section Divider for Admin Users */}
          {(user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN) && adminOverview && (
            <div style={{
              textAlign: 'center',
              margin: '2rem 0',
              padding: '1rem',
              borderTop: '2px dashed var(--border-color)',
              borderBottom: '2px dashed var(--border-color)',
              color: 'var(--text-muted)',
              fontSize: '1.1rem'
            }}>
              👇 Individual Account Details
            </div>
          )}

          {/* Account Summary */}
          <div style={{
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '12px',
            padding: '2rem',
            marginBottom: '2rem',
            border: '1px solid var(--border-color)'
          }}>
            <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '1.5rem' }}>
              Account: {selectedBankAccount.accountNumber} ({selectedBankAccount.referenceCurrency})
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : (isTablet ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(200px, 1fr))'),
              gap: isMobile ? '1rem' : '1.5rem'
            }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  Total Value
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                  {selectedBankAccount.referenceCurrency} {formatNumber(summary.totalValue)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  Total Return
                </div>
                <div style={{ 
                  fontSize: '1.3rem', 
                  fontWeight: '600', 
                  color: summary.totalReturn >= 0 ? 'var(--positive-color)' : '#FF9800' 
                }}>
                  {selectedBankAccount.referenceCurrency} {formatNumber(summary.totalReturn)} 
                  <span style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                    ({formatNumber(totalReturnPercent)}%)
                  </span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  Day Change
                </div>
                <div style={{ 
                  fontSize: '1.3rem', 
                  fontWeight: '600', 
                  color: summary.dayChange >= 0 ? 'var(--positive-color)' : '#FF9800' 
                }}>
                  {selectedBankAccount.referenceCurrency} {formatNumber(summary.dayChange)}
                  <span style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                    ({formatNumber(dayChangePercent)}%)
                  </span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  Holdings
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                  {holdings.length} stocks
                </div>
              </div>
            </div>
          </div>

          {/* Holdings Table */}
          {holdings.length > 0 ? (
            <div style={{
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: '12px',
              padding: '2rem',
              border: '1px solid var(--border-color)'
            }}>
              <h3 style={{ margin: '0 0 1.5rem 0' }}>Holdings</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ 
                  width: '100%', 
                  borderCollapse: 'collapse',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '8px',
                  overflow: 'hidden'
                }}>
                  <thead>
                    <tr style={{ 
                      backgroundColor: 'var(--bg-primary)',
                      borderBottom: '2px solid var(--border-color)' 
                    }}>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'left',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)'
                      }}>Symbol</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'left',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        width: '20%',
                        maxWidth: '200px'
                      }}>Company</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)'
                      }}>Shares</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        minWidth: '120px'
                      }}>Purchase Price</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        minWidth: '120px'
                      }}>Current Price</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        minWidth: '120px'
                      }}>Market Value</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)'
                      }}>Day Change</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'right',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)'
                      }}>Total Return</th>
                      <th style={{ 
                        padding: '0.75rem 0.5rem', 
                        textAlign: 'center',
                        fontWeight: '600',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)'
                      }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map(holding => (
                      <tr 
                        key={holding._id}
                        onClick={() => handleStockClick(holding)}
                        style={{ 
                          borderBottom: '1px solid var(--border-color)',
                          cursor: 'pointer'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <td style={{ padding: '1rem' }}>
                          <div style={{ fontWeight: '600' }}>{holding.symbol}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {holding.exchange}
                          </div>
                        </td>
                        <td style={{ 
                          padding: '1rem',
                          maxWidth: '200px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          <div style={{ 
                            fontSize: '0.9rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }} title={holding.companyName}>
                            {holding.companyName}
                          </div>
                          {holding.sector && (
                            <div style={{ 
                              fontSize: '0.8rem', 
                              color: 'var(--text-muted)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {holding.sector}
                            </div>
                          )}
                        </td>
                        <td style={{ 
                          padding: '1rem', 
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontSize: '0.95rem'
                        }}>
                          {formatNumber(holding.quantity, 0)}
                        </td>
                        <td style={{ 
                          padding: '1rem', 
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontSize: '0.95rem',
                          minWidth: '120px',
                          whiteSpace: 'nowrap'
                        }}>
                          {(() => {
                            const originalData = getOriginalCurrencyData(holding, exchangeRates);
                            return (
                              <div style={{ fontWeight: '600' }}>
                                {originalData.currency} {formatNumber(originalData.averagePrice)}
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ 
                          padding: '1rem', 
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontSize: '0.95rem',
                          minWidth: '120px',
                          whiteSpace: 'nowrap'
                        }}>
                          {(() => {
                            const originalData = getOriginalCurrencyData(holding, exchangeRates);
                            return (
                              <div style={{ fontWeight: '600' }} title={holding.lastPriceUpdate ? formatPriceUpdateTime(holding.lastPriceUpdate, holding) : ''}>
                                {originalData.currency} {formatNumber(originalData.currentPrice)}
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ 
                          padding: '1rem', 
                          textAlign: 'right', 
                          fontWeight: '600',
                          fontFamily: 'monospace',
                          fontSize: '0.95rem',
                          minWidth: '120px',
                          whiteSpace: 'nowrap'
                        }}>
                          <div style={{ fontWeight: '600' }}>
                            {selectedBankAccount.referenceCurrency} {formatNumber(holding.currentValue || 0)}
                          </div>
                        </td>
                        <td style={{ 
                          padding: '1rem', 
                          textAlign: 'right',
                          fontWeight: '600',
                          fontFamily: 'monospace',
                          fontSize: '0.95rem'
                        }}>
                          {(() => {
                            // Use the dayChange and dayChangePercent stored in the database
                            // These are calculated from EOD API's change/change_p fields which show
                            // the last session's performance (whether market is open or closed)
                            let dayChangeValue = holding.dayChange || 0;
                            let dayChangePercent = holding.dayChangePercent || 0;
                            
                            // Fallback calculation if database values are not available
                            if (dayChangeValue === 0 && holding.quantity && holding.currentPrice) {
                              const quantity = holding.quantity || 0;
                              const currentPrice = holding.currentPrice || 0;
                              
                              // Try to get previous close from multiple sources
                              let previousClose = holding.previousClose || 
                                                previousClosePrices[holding.symbol] || 
                                                null;
                              
                              // Check if we have cached price data as fallback
                              if (!previousClose && holding.priceData) {
                                previousClose = holding.priceData.previousClose || 
                                               holding.priceData.previous_close ||
                                               holding.priceData.prev_close ||
                                               holding.priceData.open;
                              }
                              
                              if (currentPrice > 0 && previousClose > 0) {
                                const priceChange = currentPrice - previousClose;
                                dayChangeValue = priceChange * quantity; // Total P&L change
                                dayChangePercent = (priceChange / previousClose) * 100;
                              }
                            }
                            
                            return (
                              <div style={{ color: dayChangeValue >= 0 ? 'var(--positive-color)' : '#FF9800' }}>
                                <div style={{ fontWeight: '600', fontSize: '1rem' }}>
                                  {dayChangePercent >= 0 ? '+' : ''}{formatNumber(dayChangePercent)}%
                                </div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                                  {selectedBankAccount.referenceCurrency} {formatNumber(dayChangeValue)}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ 
                          padding: '1rem', 
                          textAlign: 'right', 
                          color: (holding.totalReturn || ((holding.currentValue||0) - (holding.totalCost||0))) >= 0 ? 'var(--positive-color)' : '#FF9800',
                          fontWeight: '600',
                          fontFamily: 'monospace',
                          fontSize: '0.95rem',
                          minWidth: '140px',
                          whiteSpace: 'nowrap'
                        }}>
                          {(() => {
                            const totalReturn = Number.isFinite(holding.totalReturn) ? holding.totalReturn : ((holding.currentValue || 0) - (holding.totalCost || 0));
                            const percent = (Number.isFinite(holding.totalCost) && holding.totalCost > 0.01) ? (totalReturn / holding.totalCost) * 100 : 0;
                            return (
                              <div style={{ fontWeight: '600' }}>
                                {selectedBankAccount.referenceCurrency} {formatNumber(totalReturn)}
                                <span style={{ fontSize: '0.85rem', marginLeft: '0.5rem', opacity: 0.9 }}>
                                  ({formatNumber(percent)}%)
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleModifyHolding(holding);
                              }}
                              style={{
                                padding: '0.35rem 0.75rem',
                                border: '1px solid var(--positive-color)',
                                backgroundColor: 'transparent',
                                color: 'var(--positive-color)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                fontWeight: '500'
                              }}
                            >
                              Modify
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveHolding(holding._id);
                              }}
                              style={{
                                padding: '0.35rem 0.5rem',
                                border: '1px solid #FF9800',
                                backgroundColor: 'transparent',
                                color: '#FF9800',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.8rem'
                              }}
                            >
                              ×
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: '12px',
              padding: '3rem',
              textAlign: 'center',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📈</div>
              <h3 style={{ margin: '0 0 1rem 0' }}>No Holdings Yet</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
                Start building your equity portfolio by adding your first stock.
              </p>
              <button
                onClick={handleAddStock}
                style={{
                  padding: '1rem 2rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--accent-color)',
                  color: 'white',
                  fontSize: '1rem',
                  cursor: 'pointer'
                }}
              >
                Add Your First Stock
              </button>
            </div>
          )}
        </>
      )}

      {/* Add Stock Modal */}
      {isAddStockModalOpen && (
        <AddStockModal
          isOpen={isAddStockModalOpen}
          onClose={() => setIsAddStockModalOpen(false)}
          onStockAdded={handleStockAdded}
          bankAccounts={enrichedBankAccounts}
          initialBankAccountId={getTargetBankAccountId()}
        />
      )}

      {/* CSV Upload Modal */}
      {isCsvUploadModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg-primary)',
            borderRadius: '12px',
            padding: '2rem',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflowY: 'auto',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1.5rem'
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '1.2rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                📁 Upload Equity Holdings CSV
              </h3>
              <button
                onClick={() => {
                  setIsCsvUploadModalOpen(false);
                  setCsvFile(null);
                  setCsvPreviewData(null);
                  setCsvUploadResult(null);
                  setCsvSelectedBankAccountId(null);
                }}
                style={{
                  border: 'none',
                  background: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '0.25rem'
                }}
              >
                ×
              </button>
            </div>

            {/* Bank Account Selection */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '0.9rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                🏦 Target Bank Account *
              </label>
              <select
                value={csvSelectedBankAccountId || ''}
                onChange={(e) => setCsvSelectedBankAccountId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '2px solid var(--accent-color)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
                required
              >
                <option value="" disabled>Select a bank account...</option>
                {enrichedBankAccounts.map(account => (
                  <option key={account._id} value={account._id}>
                    Account {account.accountNumber} • {account.referenceCurrency}
                    {account.ownerDisplayName ? ` • ${account.ownerDisplayName}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Instructions */}
            <div style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '1.5rem'
            }}>
              <h4 style={{
                margin: '0 0 0.75rem 0',
                fontSize: '0.9rem',
                fontWeight: '600',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span style={{ color: 'var(--accent-color)' }}>ℹ️</span>
                CSV Format Requirements
              </h4>
              <ul style={{
                margin: 0,
                paddingLeft: '1.5rem',
                color: 'var(--text-secondary)',
                fontSize: '0.85rem',
                lineHeight: '1.6'
              }}>
                <li>Column 1: ISIN code (e.g., US0378331005)</li>
                <li>Column 2: Quantity (number of shares)</li>
                <li>Column 3: Currency (e.g., USD, EUR, GBP)</li>
                <li>Column 4: Purchase price per share</li>
                <li style={{ marginTop: '0.5rem' }}>Supported formats:</li>
                <ul style={{ marginTop: '0.25rem' }}>
                  <li>US format: <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>US0378331005,100,USD,150.25</code></li>
                  <li>European format: <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>US0378331005;100;USD;150,25</code></li>
                </ul>
              </ul>
            </div>

            {/* File Input */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '0.9rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Select CSV File
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleCsvFileChange}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            {/* Preview Data */}
            {csvPreviewData && csvPreviewData.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{
                  margin: '0 0 0.75rem 0',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  Preview ({csvPreviewData.length} row{csvPreviewData.length !== 1 ? 's' : ''})
                </h4>
                <div style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.8rem'
                  }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                        <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>ISIN</th>
                        <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '1px solid var(--border-color)' }}>Quantity</th>
                        <th style={{ padding: '0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>Currency</th>
                        <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '1px solid var(--border-color)' }}>Price</th>
                        <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '1px solid var(--border-color)' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreviewData.map((row, index) => (
                        <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>{row.isin}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatNumber(row.quantity, 0)}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'center' }}>{row.currency}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatNumber(row.purchasePrice)}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatNumber(row.totalValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Upload Result */}
            {csvUploadResult && (
              <div style={{
                marginBottom: '1.5rem',
                padding: '0.75rem',
                borderRadius: '8px',
                fontSize: '0.875rem',
                background: csvUploadResult.success 
                  ? 'rgba(40, 167, 69, 0.1)' 
                  : 'rgba(220, 53, 69, 0.1)',
                border: `1px solid ${csvUploadResult.success 
                  ? 'rgba(40, 167, 69, 0.3)' 
                  : 'rgba(220, 53, 69, 0.3)'}`,
                color: csvUploadResult.success 
                  ? 'var(--positive-color)' 
                  : 'var(--danger-color)'
              }}>
                {csvUploadResult.success ? (
                  <div>
                    <div style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
                      ✅ {csvUploadResult.message}
                    </div>
                    {csvUploadResult.stats && (
                      <div style={{ fontSize: '0.8rem' }}>
                        Processed: {csvUploadResult.stats.processed} | 
                        Added: {csvUploadResult.stats.added} | 
                        Updated: {csvUploadResult.stats.updated} | 
                        Errors: {csvUploadResult.stats.errors}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: '600' }}>❌ {csvUploadResult.error}</div>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => {
                  setIsCsvUploadModalOpen(false);
                  setCsvFile(null);
                  setCsvPreviewData(null);
                  setCsvUploadResult(null);
                  setCsvSelectedBankAccountId(null);
                }}
                style={{
                  padding: '0.75rem 1.5rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCsvUpload}
                disabled={!csvFile || !csvSelectedBankAccountId || csvUploadLoading}
                style={{
                  padding: '0.75rem 1.5rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: (!csvFile || !csvSelectedBankAccountId || csvUploadLoading)
                    ? 'var(--text-muted)'
                    : '#4CAF50',
                  color: 'white',
                  fontSize: '0.9rem',
                  cursor: (!csvFile || !csvSelectedBankAccountId || csvUploadLoading)
                    ? 'not-allowed'
                    : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                {csvUploadLoading ? (
                  <>
                    <span style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid transparent',
                      borderTop: '2px solid white',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }}></span>
                    Uploading...
                  </>
                ) : (
                  <>📤 Upload Holdings</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmRemoveHolding && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={cancelRemoveHolding}
        >
          <div 
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '2rem',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{
              color: 'var(--text-primary)',
              marginTop: 0,
              marginBottom: '1rem',
              fontSize: '1.2rem',
              fontWeight: '600'
            }}>
              Confirm Removal
            </h3>
            
            <p style={{
              color: 'var(--text-secondary)',
              marginBottom: '1.5rem',
              lineHeight: '1.5'
            }}>
              Are you sure you want to remove <strong style={{ color: 'var(--text-primary)' }}>
                {confirmRemoveHolding.holdingName}
              </strong> from your portfolio? This action cannot be undone.
            </p>
            
            <div style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={cancelRemoveHolding}
                style={{
                  padding: '0.75rem 1.5rem',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.target.style.backgroundColor = 'var(--bg-tertiary)';
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = 'var(--bg-secondary)';
                }}
              >
                Cancel
              </button>
              
              <button
                onClick={confirmRemoveHoldingAction}
                style={{
                  padding: '0.75rem 1.5rem',
                  border: '1px solid #f44336',
                  backgroundColor: '#f44336',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.target.style.backgroundColor = '#d32f2f';
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = '#f44336';
                }}
              >
                Remove Holding
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Details Modal */}
      {selectedStock && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}
          onClick={closeStockModal}
        >
          <div 
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '2rem',
              maxWidth: '800px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '2rem',
              borderBottom: '1px solid var(--border-color)',
              paddingBottom: '1rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <CompanyLogo 
                  logoData={stockDetails?.logo}
                  symbol={selectedStock.symbol}
                  companyName={selectedStock.companyName}
                  size={60}
                />
                <div>
                  <h2 style={{
                    color: 'var(--text-primary)',
                    margin: 0,
                    fontSize: '1.5rem',
                    fontWeight: '600'
                  }}>
                    {selectedStock.symbol} - {selectedStock.companyName}
                  </h2>
                  <div style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.9rem',
                    marginTop: '0.5rem'
                  }}>
                    {selectedStock.exchange} • {selectedStock.sector}
                  </div>
                </div>
              </div>
              <button
                onClick={closeStockModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '0.5rem'
                }}
              >
                ×
              </button>
            </div>

            {/* Loading State */}
            {!stockDetails && (
              <div style={{
                textAlign: 'center',
                padding: '2rem',
                color: 'var(--text-muted)'
              }}>
                Loading stock details...
              </div>
            )}

            {/* Stock Details Content */}
            {stockDetails && (
              <div style={{ display: 'grid', gap: '2rem' }}>
                {/* Stock Performance Metrics */}
                <div>
                  <h3 style={{
                    color: 'var(--text-primary)',
                    fontSize: '1.2rem',
                    marginBottom: '1rem'
                  }}>Stock Performance</h3>
                  
                  {/* Current Price Section */}
                  <div style={{
                    backgroundColor: 'var(--bg-secondary)',
                    padding: '1.5rem',
                    borderRadius: '8px',
                    marginBottom: '1rem'
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Current Price</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {stockDetails.stockPerformance.currency} {formatNumber(stockDetails.stockPerformance.currentPrice)}
                      </div>
                    </div>
                  </div>

                  {/* Performance Table */}
                  <div style={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '8px',
                    overflow: 'hidden'
                  }}>
                    <table style={{ 
                      width: '100%', 
                      borderCollapse: 'collapse'
                    }}>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ 
                            padding: '1rem', 
                            fontSize: '0.9rem', 
                            color: 'var(--text-muted)',
                            width: '40%'
                          }}>Day Change</td>
                          <td style={{ 
                            padding: '1rem', 
                            textAlign: 'right',
                            fontSize: '1.1rem',
                            fontWeight: '600',
                            color: stockDetails.stockPerformance.dayChange >= 0 ? 'var(--positive-color)' : '#FF9800'
                          }}>
                            {stockDetails.stockPerformance.dayChange >= 0 ? '+' : ''}{formatNumber(stockDetails.stockPerformance.dayChange)}
                            <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem' }}>
                              ({stockDetails.stockPerformance.dayChangePercent >= 0 ? '+' : ''}{formatNumber(stockDetails.stockPerformance.dayChangePercent)}%)
                            </span>
                          </td>
                        </tr>
                        {stockDetails.stockPerformance.ytdChange !== null && (
                          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ 
                              padding: '1rem', 
                              fontSize: '0.9rem', 
                              color: 'var(--text-muted)'
                            }}>YTD Performance</td>
                            <td style={{ 
                              padding: '1rem', 
                              textAlign: 'right',
                              fontSize: '1.1rem',
                              fontWeight: '600',
                              color: stockDetails.stockPerformance.ytdChange >= 0 ? 'var(--positive-color)' : '#FF9800'
                            }}>
                              {stockDetails.stockPerformance.ytdChange >= 0 ? '+' : ''}{formatNumber(stockDetails.stockPerformance.ytdChange)}
                              <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem' }}>
                                ({stockDetails.stockPerformance.ytdChangePercent >= 0 ? '+' : ''}{formatNumber(stockDetails.stockPerformance.ytdChangePercent)}%)
                              </span>
                            </td>
                          </tr>
                        )}
                        {stockDetails.stockPerformance.mtdChange !== null && (
                          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ 
                              padding: '1rem', 
                              fontSize: '0.9rem', 
                              color: 'var(--text-muted)'
                            }}>Month Performance</td>
                            <td style={{ 
                              padding: '1rem', 
                              textAlign: 'right',
                              fontSize: '1.1rem',
                              fontWeight: '600',
                              color: stockDetails.stockPerformance.mtdChange >= 0 ? 'var(--positive-color)' : '#FF9800'
                            }}>
                              {stockDetails.stockPerformance.mtdChange >= 0 ? '+' : ''}{formatNumber(stockDetails.stockPerformance.mtdChange)}
                              <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem' }}>
                                ({stockDetails.stockPerformance.mtdChangePercent >= 0 ? '+' : ''}{formatNumber(stockDetails.stockPerformance.mtdChangePercent)}%)
                              </span>
                            </td>
                          </tr>
                        )}
                        {stockDetails.stockPerformance.oneYearChange !== null && (
                          <tr>
                            <td style={{ 
                              padding: '1rem', 
                              fontSize: '0.9rem', 
                              color: 'var(--text-muted)'
                            }}>1-Year Performance</td>
                            <td style={{ 
                              padding: '1rem', 
                              textAlign: 'right',
                              fontSize: '1.1rem',
                              fontWeight: '600',
                              color: stockDetails.stockPerformance.oneYearChange >= 0 ? 'var(--positive-color)' : '#FF9800'
                            }}>
                              {stockDetails.stockPerformance.oneYearChange >= 0 ? '+' : ''}{formatNumber(stockDetails.stockPerformance.oneYearChange)}
                              <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem' }}>
                                ({stockDetails.stockPerformance.oneYearChangePercent >= 0 ? '+' : ''}{formatNumber(stockDetails.stockPerformance.oneYearChangePercent)}%)
                              </span>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* User's Position */}
                <div>
                  <h3 style={{
                    color: 'var(--text-primary)',
                    fontSize: '1.2rem',
                    marginBottom: '1rem'
                  }}>Your Position</h3>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr' : (isTablet ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(180px, 1fr))'),
                    gap: '1rem',
                    backgroundColor: 'var(--bg-secondary)',
                    padding: isMobile ? '1rem' : '1.5rem',
                    borderRadius: '8px'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Shares Owned</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {formatNumber(stockDetails.stockPerformance.userPosition.shares, 0)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Avg Purchase Price</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {selectedBankAccount.referenceCurrency} {formatNumber(stockDetails.stockPerformance.userPosition.avgPrice)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Total Invested</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {selectedBankAccount.referenceCurrency} {formatNumber(stockDetails.stockPerformance.userPosition.totalCost)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Current Value</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {selectedBankAccount.referenceCurrency} {formatNumber(stockDetails.stockPerformance.userPosition.currentValue)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Your Return</div>
                      <div style={{ 
                        fontSize: '1.2rem', 
                        fontWeight: '600',
                        color: stockDetails.stockPerformance.userPosition.totalReturn >= 0 ? 'var(--positive-color)' : '#FF9800'
                      }}>
                        {stockDetails.stockPerformance.userPosition.totalReturn >= 0 ? '+' : ''}{formatNumber(stockDetails.stockPerformance.userPosition.totalReturn)}
                        <span style={{ fontSize: '0.9rem', marginLeft: '0.5rem' }}>
                          ({stockDetails.stockPerformance.userPosition.returnPercent >= 0 ? '+' : ''}{formatNumber(stockDetails.stockPerformance.userPosition.returnPercent)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Transaction History */}
                {selectedStock.transactions && selectedStock.transactions.length > 0 && (
                  <div>
                    <h3 style={{
                      color: 'var(--text-primary)',
                      fontSize: '1.2rem',
                      marginBottom: '1rem'
                    }}>Transaction History</h3>
                    <div style={{
                      backgroundColor: 'var(--bg-secondary)',
                      borderRadius: '8px',
                      overflow: 'hidden'
                    }}>
                      <table style={{ 
                        width: '100%', 
                        borderCollapse: 'collapse'
                      }}>
                        <thead>
                          <tr style={{ 
                            backgroundColor: 'var(--bg-primary)',
                            borderBottom: '2px solid var(--border-color)' 
                          }}>
                            <th style={{ 
                              padding: '0.75rem', 
                              textAlign: 'left',
                              fontWeight: '600',
                              fontSize: '0.8rem',
                              color: 'var(--text-secondary)'
                            }}>Date</th>
                            <th style={{ 
                              padding: '0.75rem', 
                              textAlign: 'left',
                              fontWeight: '600',
                              fontSize: '0.8rem',
                              color: 'var(--text-secondary)'
                            }}>Type</th>
                            <th style={{ 
                              padding: '0.75rem', 
                              textAlign: 'right',
                              fontWeight: '600',
                              fontSize: '0.8rem',
                              color: 'var(--text-secondary)'
                            }}>Shares</th>
                            <th style={{ 
                              padding: '0.75rem', 
                              textAlign: 'right',
                              fontWeight: '600',
                              fontSize: '0.8rem',
                              color: 'var(--text-secondary)'
                            }}>Price</th>
                            <th style={{ 
                              padding: '0.75rem', 
                              textAlign: 'right',
                              fontWeight: '600',
                              fontSize: '0.8rem',
                              color: 'var(--text-secondary)'
                            }}>Amount</th>
                            <th style={{ 
                              padding: '0.75rem', 
                              textAlign: 'right',
                              fontWeight: '600',
                              fontSize: '0.8rem',
                              color: 'var(--text-secondary)'
                            }}>Fees</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedStock.transactions
                            .sort((a, b) => new Date(b.date) - new Date(a.date))
                            .map((transaction, index) => (
                            <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ 
                                padding: '0.75rem', 
                                fontSize: '0.9rem', 
                                color: 'var(--text-primary)'
                              }}>
                                {new Date(transaction.date).toLocaleDateString()}
                              </td>
                              <td style={{ 
                                padding: '0.75rem', 
                                fontSize: '0.9rem'
                              }}>
                                <span style={{
                                  backgroundColor: transaction.type === 'BUY' ? '#E3F2FD' : '#FFF3E0',
                                  color: transaction.type === 'BUY' ? '#1976D2' : '#F57C00',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '12px',
                                  fontSize: '0.8rem',
                                  fontWeight: '500'
                                }}>
                                  {transaction.type}
                                </span>
                              </td>
                              <td style={{ 
                                padding: '0.75rem', 
                                textAlign: 'right',
                                fontSize: '0.9rem',
                                color: 'var(--text-primary)',
                                fontFamily: 'monospace'
                              }}>
                                {Math.abs(transaction.quantity)}
                              </td>
                              <td style={{ 
                                padding: '0.75rem', 
                                textAlign: 'right',
                                fontSize: '0.9rem',
                                color: 'var(--text-primary)',
                                fontFamily: 'monospace'
                              }}>
                                {selectedStock.currency} {formatNumber(transaction.price)}
                              </td>
                              <td style={{ 
                                padding: '0.75rem', 
                                textAlign: 'right',
                                fontSize: '0.9rem',
                                color: 'var(--text-primary)',
                                fontFamily: 'monospace',
                                fontWeight: '600'
                              }}>
                                {selectedStock.currency} {formatNumber(transaction.amount)}
                              </td>
                              <td style={{ 
                                padding: '0.75rem', 
                                textAlign: 'right',
                                fontSize: '0.9rem',
                                color: 'var(--text-muted)',
                                fontFamily: 'monospace'
                              }}>
                                {transaction.fees > 0 ? `${selectedStock.currency} ${formatNumber(transaction.fees)}` : '--'}
                              </td>
                              {transaction.notes && (
                                <td style={{ 
                                  padding: '0.75rem', 
                                  fontSize: '0.8rem',
                                  color: 'var(--text-muted)',
                                  fontStyle: 'italic'
                                }}>
                                  {transaction.notes}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Real-time Market Data */}
                {stockDetails.realTimeData && (
                  <div>
                    <h3 style={{
                      color: 'var(--text-primary)',
                      fontSize: '1.2rem',
                      marginBottom: '1rem'
                    }}>Market Data</h3>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: isMobile ? '1fr' : (isTablet ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(150px, 1fr))'),
                      gap: '1rem',
                      backgroundColor: 'var(--bg-secondary)',
                      padding: isMobile ? '1rem' : '1.5rem',
                      borderRadius: '8px'
                    }}>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Open</div>
                        <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {stockDetails.stockPerformance.currency} {formatNumber(stockDetails.realTimeData.open)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>High</div>
                        <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--positive-color)' }}>
                          {stockDetails.stockPerformance.currency} {formatNumber(stockDetails.realTimeData.high)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Low</div>
                        <div style={{ fontSize: '1rem', fontWeight: '600', color: '#FF9800' }}>
                          {stockDetails.stockPerformance.currency} {formatNumber(stockDetails.realTimeData.low)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Volume</div>
                        <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {formatNumber(stockDetails.realTimeData.volume, 0)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Previous Close</div>
                        <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {stockDetails.stockPerformance.currency} {formatNumber(stockDetails.realTimeData.previousClose)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Recent News */}
                {stockDetails.news && stockDetails.news.length > 0 && (
                  <div>
                    <h3 style={{
                      color: 'var(--text-primary)',
                      fontSize: '1.2rem',
                      marginBottom: '1rem'
                    }}>Recent News</h3>
                    <div style={{
                      backgroundColor: 'var(--bg-secondary)',
                      borderRadius: '8px',
                      padding: '1.5rem'
                    }}>
                      {stockDetails.news.slice(0, 3).map((article, index) => (
                        <div key={index} style={{
                          marginBottom: index < 2 ? '1rem' : 0,
                          paddingBottom: index < 2 ? '1rem' : 0,
                          borderBottom: index < 2 ? '1px solid var(--border-color)' : 'none'
                        }}>
                          <div style={{
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            color: 'var(--text-primary)',
                            marginBottom: '0.5rem',
                            lineHeight: '1.4'
                          }}>
                            {article.title}
                          </div>
                          <div style={{
                            fontSize: '0.8rem',
                            color: 'var(--text-muted)',
                            lineHeight: '1.5'
                          }}>
                            {article.content ? article.content.substring(0, 200) + '...' : 'No preview available'}
                          </div>
                          <div style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-muted)',
                            marginTop: '0.5rem'
                          }}>
                            {new Date(article.date).toLocaleDateString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error State */}
                {stockDetails.error && (
                  <div style={{
                    backgroundColor: '#FFE0D6',
                    color: '#D84315',
                    padding: '1rem',
                    borderRadius: '8px',
                    fontSize: '0.9rem'
                  }}>
                    Unable to load additional stock data: {stockDetails.error}
                  </div>
                )}

                {/* Last Updated */}
                <div style={{
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  borderTop: '1px solid var(--border-color)',
                  paddingTop: '1rem'
                }}>
                  Last updated: {stockDetails.lastUpdated.toLocaleString()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modify Holding Modal */}
      {modifyHolding && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={closeModifyModal}
        >
          <div 
            style={{
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '2rem',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{
              color: 'var(--text-primary)',
              marginTop: 0,
              marginBottom: '1.5rem',
              fontSize: '1.3rem',
              fontWeight: '600'
            }}>
              Modify Position: {modifyHolding.symbol}
            </h3>
            
            <div style={{
              marginBottom: '1.5rem',
              padding: '1rem',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: '6px',
              fontSize: '0.9rem',
              color: 'var(--text-secondary)'
            }}>
              <div><strong>Current:</strong> {formatNumber(modifyHolding.quantity, 0)} shares @ {selectedBankAccount.referenceCurrency} {formatNumber(modifyHolding.averagePrice)}</div>
              <div><strong>Value:</strong> {selectedBankAccount.referenceCurrency} {formatNumber(modifyHolding.currentValue)}</div>
            </div>

            {/* Action Type Selector */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                fontWeight: '500'
              }}>Action:</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {['modify', 'add', 'sell'].map(action => (
                  <button
                    key={action}
                    onClick={() => setModifyHolding({...modifyHolding, action})}
                    style={{
                      padding: '0.5rem 1rem',
                      border: `1px solid ${modifyHolding.action === action ? 'var(--positive-color)' : 'var(--border-color)'}`,
                      backgroundColor: modifyHolding.action === action ? 'var(--positive-color)' : 'transparent',
                      color: modifyHolding.action === action ? 'white' : 'var(--text-primary)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      textTransform: 'capitalize'
                    }}
                  >
                    {action === 'modify' ? 'Update' : action === 'add' ? 'Buy More' : 'Sell'}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity Input */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                fontWeight: '500'
              }}>
                {modifyHolding.action === 'add' ? 'Total Shares (Current + New)' : 
                 modifyHolding.action === 'sell' ? 'Remaining Shares' : 'New Quantity'}:
              </label>
              <input
                type="number"
                value={modifyHolding.newQuantity}
                onChange={(e) => setModifyHolding({...modifyHolding, newQuantity: e.target.value})}
                min="0"
                step="1"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '1rem'
                }}
              />
            </div>

            {/* Price Input */}
            <div style={{ marginBottom: '2rem' }}>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                fontWeight: '500'
              }}>
                {modifyHolding.action === 'add' ? 'Purchase Price' : 
                 modifyHolding.action === 'sell' ? 'Sale Price' : 'Average Price'}:
              </label>
              <input
                type="number"
                value={modifyHolding.newAveragePrice}
                onChange={(e) => setModifyHolding({...modifyHolding, newAveragePrice: e.target.value})}
                min="0"
                step="0.01"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '1rem'
                }}
              />
            </div>

            {/* Action Buttons */}
            <div style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={closeModifyModal}
                style={{
                  padding: '0.75rem 1.5rem',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '500'
                }}
              >
                Cancel
              </button>
              
              <button
                onClick={handleModifySubmit}
                style={{
                  padding: '0.75rem 1.5rem',
                  border: '1px solid var(--positive-color)',
                  backgroundColor: 'var(--positive-color)',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '500'
                }}
              >
                {modifyHolding.action === 'add' ? 'Buy More' : 
                 modifyHolding.action === 'sell' ? 'Sell Shares' : 'Update Position'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DirectEquitiesView;