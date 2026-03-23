import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import Modal from './common/Modal.jsx';
import ActionButton from './common/ActionButton.jsx';
import { ASSET_TYPES, PRICE_TYPES, TRADE_MODES, FX_SUBTYPES, VALIDITY_TYPES, TERM_DEPOSIT_TENORS, EMAIL_TRACE_TYPES, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, ORDER_SOURCE_TYPES, OrderFormatters } from '/imports/api/orders';

const FX_CURRENCIES = [
  'USD', 'EUR', 'CHF', 'GBP', 'JPY', 'ILS',
  'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK',
  'SGD', 'HKD', 'CNH', 'ZAR', 'TRY', 'MXN', 'BRL'
];

/**
 * OrderModal - Multi-step wizard for creating buy/sell orders
 *
 * Steps:
 * 1. Account Selection - Select client and bank account (or pre-filled)
 * 2. Security - Search and select security (or pre-filled from PMS)
 * 3. Order Details - Quantity, price type, limit price
 * 4. Review - Review and confirm order
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether modal is open
 * @param {Function} props.onClose - Close handler
 * @param {string} props.mode - 'buy' or 'sell'
 * @param {Object} props.prefillData - Pre-filled data from PMS position
 * @param {Array} props.clients - List of clients (for admin/RM)
 * @param {Function} props.onOrderCreated - Callback when order is created
 * @param {Object} props.user - Current user object
 * @param {boolean} props.bulkMode - Enable bulk order mode
 */
const OrderModal = ({
  isOpen,
  onClose,
  mode: initialMode = 'buy',
  prefillData = null,
  clients = [],
  onOrderCreated,
  user,
  bulkMode = false
}) => {
  // Inject spinner keyframes once
  useEffect(() => {
    if (!document.getElementById('orderModalSpinStyle')) {
      const style = document.createElement('style');
      style.id = 'orderModalSpinStyle';
      style.textContent = '@keyframes orderModalSpin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }
  }, []);

  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Buy/Sell mode (now selected in step 2)
  const [mode, setMode] = useState(initialMode);

  // Holdings for sell mode
  const [accountHoldings, setAccountHoldings] = useState([]);
  const [isLoadingHoldings, setIsLoadingHoldings] = useState(false);
  const [holdingSearchQuery, setHoldingSearchQuery] = useState('');
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [sellManualSearch, setSellManualSearch] = useState(false);

  // Cash balance for buy mode
  const [cashBalance, setCashBalance] = useState(null);
  const [isLoadingCash, setIsLoadingCash] = useState(false);

  // Indicative price (fetched from holding or EOD)
  const [indicativePrice, setIndicativePrice] = useState(null);
  const [indicativePriceCurrency, setIndicativePriceCurrency] = useState(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);

  // Step 1: Security
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSecurity, setSelectedSecurity] = useState(null);
  const [assetType, setAssetType] = useState(ASSET_TYPES.EQUITY);
  const [manualEntryMode, setManualEntryMode] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualIsin, setManualIsin] = useState('');
  const [manualCurrency, setManualCurrency] = useState('EUR');

  // Step 2: Order Details
  const [quantity, setQuantity] = useState('');
  const [priceType, setPriceType] = useState(PRICE_TYPES.MARKET);
  const [limitPrice, setLimitPrice] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [notes, setNotes] = useState('');
  const [broker, setBroker] = useState('');
  const [settlementCurrency, setSettlementCurrency] = useState('');
  const [underlyings, setUnderlyings] = useState('');

  // Stop price for stop loss / stop limit orders
  const [stopPrice, setStopPrice] = useState('');

  // Validity for non-market orders
  const [validityType, setValidityType] = useState(VALIDITY_TYPES.DAY);
  const [validityDate, setValidityDate] = useState('');

  // Attached Take Profit / Stop Loss legs (creates linked orders)
  const [showAttachedOrders, setShowAttachedOrders] = useState(false);
  const [attachedTakeProfit, setAttachedTakeProfit] = useState('');
  const [attachedStopLoss, setAttachedStopLoss] = useState('');

  // Capital protected toggle (for structured products allocation classification)
  const [capitalProtected, setCapitalProtected] = useState(false);

  // Allocation compliance check
  const [allocationCheck, setAllocationCheck] = useState(null);
  const [isCheckingAllocation, setIsCheckingAllocation] = useState(false);
  const [allocationJustification, setAllocationJustification] = useState('');

  // FX-specific
  const [fxSubtype, setFxSubtype] = useState(FX_SUBTYPES.SPOT);
  const [fxBuyCurrency, setFxBuyCurrency] = useState('');
  const [fxSellCurrency, setFxSellCurrency] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [fxForwardDate, setFxForwardDate] = useState('');
  const [fxValueDate, setFxValueDate] = useState(() => {
    // Default T+2 business days for FX spot
    const d = new Date();
    let bd = 0;
    while (bd < 2) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) bd++;
    }
    return d.toISOString().split('T')[0];
  });
  const [fxAmountCurrency, setFxAmountCurrency] = useState('buy'); // 'buy' or 'sell'
  const [stopLossPrice, setStopLossPrice] = useState('');
  const [takeProfitPrice, setTakeProfitPrice] = useState('');
  const [fxSpotRate, setFxSpotRate] = useState(null);
  const [fxSpotLoading, setFxSpotLoading] = useState(false);
  const [fxWarnings, setFxWarnings] = useState([]);

  // Term Deposit-specific
  const [depositTenor, setDepositTenor] = useState('');
  const [depositCurrency, setDepositCurrency] = useState('EUR');
  const [depositAction, setDepositAction] = useState('increase'); // 'increase' or 'decrease'

  // Step 3: Account Selection
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [clientBankAccounts, setClientBankAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [availableClients, setAvailableClients] = useState([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);

  // Bulk mode state
  const [isBulkMode, setIsBulkMode] = useState(bulkMode);
  const [bulkOrders, setBulkOrders] = useState([{ clientId: '', bankAccountId: '', quantity: '' }]);
  const [bulkAccountsMap, setBulkAccountsMap] = useState({});
  const [bulkAccountsLoading, setBulkAccountsLoading] = useState({});

  // Client order email attachments (single file for single mode, array for bulk)
  const [clientOrderFile, setClientOrderFile] = useState(null);
  const [clientOrderFiles, setClientOrderFiles] = useState([]);

  // Order source: email (default) or phone
  const [orderSource, setOrderSource] = useState(ORDER_SOURCE_TYPES.EMAIL);
  const [phoneCallTime, setPhoneCallTime] = useState(() => {
    // Default to current datetime in local format for datetime-local input
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });

  const searchTimeoutRef = useRef(null);
  const getSessionId = () => localStorage.getItem('sessionId');

  // Check if the form has any user input
  const isFormDirty = () => {
    if (currentStep > 1) return true;
    if (selectedSecurity) return true;
    if (searchQuery || manualName || manualIsin) return true;
    if (quantity || limitPrice || notes || broker) return true;
    if (selectedClientId || selectedBankAccountId) return true;
    if (fxBuyCurrency || fxSellCurrency || fxRate) return true;
    if (clientOrderFile) return true;
    return false;
  };

  // Always show confirmation when trying to close the order modal
  const handleClose = () => {
    setShowCloseConfirm(true);
  };

  const confirmClose = () => {
    setShowCloseConfirm(false);
    onClose();
  };

  // Fetch clients when modal opens
  useEffect(() => {
    if (isOpen) {
      loadClients();
    }
  }, [isOpen]);

  const loadClients = async () => {
    setIsLoadingClients(true);
    try {
      const sessionId = getSessionId();
      const clientsList = await Meteor.callAsync('users.getClients', { sessionId });
      setAvailableClients(clientsList || []);
    } catch (err) {
      console.error('Error loading clients:', err);
      setAvailableClients([]);
    } finally {
      setIsLoadingClients(false);
    }
  };

  // Track whether user has manually edited estimated value
  const [estimatedValueManuallyEdited, setEstimatedValueManuallyEdited] = useState(false);

  // Fetch FX spot rate when both currencies are selected
  useEffect(() => {
    if (assetType !== ASSET_TYPES.FX || !fxBuyCurrency || !fxSellCurrency) {
      setFxSpotRate(null);
      return;
    }
    const pair = `${fxBuyCurrency}${fxSellCurrency}.FOREX`;
    setFxSpotLoading(true);
    Meteor.callAsync('currencyCache.getRates', [pair])
      .then(result => {
        if (result?.success && result.rates[pair]) {
          setFxSpotRate(result.rates[pair]);
        } else {
          setFxSpotRate(null);
        }
      })
      .catch(err => {
        console.error('Error fetching FX spot rate:', err);
        setFxSpotRate(null);
      })
      .finally(() => setFxSpotLoading(false));
  }, [assetType, fxBuyCurrency, fxSellCurrency]);

  // Validate FX price coherence whenever spot, limit, SL, TP or mode change
  useEffect(() => {
    if (assetType !== ASSET_TYPES.FX || !fxSpotRate) {
      setFxWarnings([]);
      return;
    }
    const warnings = [];
    const spot = fxSpotRate;
    const limit = limitPrice ? parseFloat(limitPrice) : null;
    const sl = stopLossPrice ? parseFloat(stopLossPrice) : null;
    const tp = takeProfitPrice ? parseFloat(takeProfitPrice) : null;
    const isBuy = mode === 'buy';

    // For a BUY order on pair BUY_CCY/SELL_CCY:
    //   Limit should be below spot (you want to buy cheaper)
    //   Stop Loss should be below spot (if rate drops, cut losses)
    //   Take Profit should be above spot (if rate rises, take gains)
    // For a SELL order it's the opposite

    if (limit) {
      if (isBuy && limit > spot * 1.001) {
        warnings.push(`Limit (${limit.toFixed(6)}) is above spot (${spot.toFixed(6)}) — for a buy order, limit is typically below spot to get a better entry`);
      } else if (!isBuy && limit < spot * 0.999) {
        warnings.push(`Limit (${limit.toFixed(6)}) is below spot (${spot.toFixed(6)}) — for a sell order, limit is typically above spot to get a better exit`);
      }
    }

    if (sl) {
      if (isBuy && sl > spot) {
        warnings.push(`Stop Loss (${sl.toFixed(6)}) is above spot (${spot.toFixed(6)}) — for a buy order, stop loss should be below spot`);
      } else if (!isBuy && sl < spot) {
        warnings.push(`Stop Loss (${sl.toFixed(6)}) is below spot (${spot.toFixed(6)}) — for a sell order, stop loss should be above spot`);
      }
    }

    if (tp) {
      if (isBuy && tp < spot) {
        warnings.push(`Take Profit (${tp.toFixed(6)}) is below spot (${spot.toFixed(6)}) — for a buy order, take profit should be above spot`);
      } else if (!isBuy && tp > spot) {
        warnings.push(`Take Profit (${tp.toFixed(6)}) is above spot (${spot.toFixed(6)}) — for a sell order, take profit should be below spot`);
      }
    }

    if (sl && tp && sl === tp) {
      warnings.push('Stop Loss and Take Profit are the same value');
    }

    if (isBuy && sl && tp && sl >= tp) {
      warnings.push('Stop Loss should be below Take Profit for a buy order');
    } else if (!isBuy && sl && tp && sl <= tp) {
      warnings.push('Stop Loss should be above Take Profit for a sell order');
    }

    if (limit && sl) {
      if (isBuy && sl > limit) {
        warnings.push('Stop Loss is above Limit Price — stop loss should be below your entry for a buy');
      } else if (!isBuy && sl < limit) {
        warnings.push('Stop Loss is below Limit Price — stop loss should be above your entry for a sell');
      }
    }

    setFxWarnings(warnings);
  }, [assetType, fxSpotRate, limitPrice, stopLossPrice, takeProfitPrice, mode]);

  // Initialize from prefill data
  useEffect(() => {
    if (prefillData && isOpen) {
      setSelectedSecurity({
        isin: prefillData.isin,
        name: prefillData.securityName,
        currency: prefillData.currency
      });
      setAssetType(prefillData.assetType || ASSET_TYPES.STRUCTURED_PRODUCT);
      setSearchQuery(prefillData.securityName || '');

      if (prefillData.clientId) {
        setSelectedClientId(prefillData.clientId);
      }
      if (prefillData.bankAccountId) {
        setSelectedBankAccountId(prefillData.bankAccountId);
      }
      if (prefillData.quantity && mode === 'sell') {
        // For sell, show available quantity
        setQuantity(prefillData.quantity.toString());
      }
      if (prefillData.bankName) {
        setBroker(prefillData.bankName);
      }
      if (prefillData.currency) {
        setSettlementCurrency(prefillData.currency);
      }
      setEstimatedValueManuallyEdited(false);
    }
  }, [prefillData, isOpen, mode]);

  // Auto-calculate estimated value from quantity and price
  useEffect(() => {
    if (estimatedValueManuallyEdited) return;

    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) {
      setEstimatedValue('');
      return;
    }

    if (priceType === PRICE_TYPES.LIMIT) {
      const price = parseFloat(limitPrice);
      if (price && price > 0) {
        const isPercentage = assetType === ASSET_TYPES.STRUCTURED_PRODUCT || assetType === ASSET_TYPES.BOND;
        const value = isPercentage ? qty * price / 100 : qty * price;
        setEstimatedValue(value.toFixed(2));
      }
    } else if (indicativePrice && indicativePrice > 0) {
      // Use indicative price from holding or EOD
      const isPercentage = assetType === ASSET_TYPES.STRUCTURED_PRODUCT || assetType === ASSET_TYPES.BOND;
      const value = isPercentage ? qty * indicativePrice : qty * indicativePrice;
      setEstimatedValue(value.toFixed(2));
    } else if (prefillData?.marketPrice && prefillData.marketPrice > 0) {
      const isPercentage = prefillData?.priceType === 'percentage';
      const value = isPercentage ? qty * prefillData.marketPrice : qty * prefillData.marketPrice;
      setEstimatedValue(value.toFixed(2));
    }
  }, [quantity, priceType, limitPrice, prefillData, estimatedValueManuallyEdited, indicativePrice, assetType]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(1);
      setError(null);
      setSearchQuery('');
      setSearchResults([]);
      setSelectedSecurity(null);
      setAssetType(ASSET_TYPES.EQUITY);
      setManualEntryMode(false);
      setManualName('');
      setManualIsin('');
      setManualCurrency('EUR');
      setQuantity('');
      setPriceType(PRICE_TYPES.MARKET);
      setLimitPrice('');
      setStopPrice('');
      setValidityType(VALIDITY_TYPES.DAY);
      setValidityDate('');
      setShowAttachedOrders(false);
      setAttachedTakeProfit('');
      setAttachedStopLoss('');
      setEstimatedValue('');
      setNotes('');
      setBroker('');
      setSettlementCurrency('');
      setUnderlyings('');
      setSelectedClientId('');
      setSelectedBankAccountId('');
      setClientBankAccounts([]);
      setIsBulkMode(bulkMode);
      setBulkOrders([{ clientId: '', bankAccountId: '', quantity: '' }]);
      setBulkAccountsMap({});
      setBulkAccountsLoading({});
      setEstimatedValueManuallyEdited(false);
      // Reset FX fields
      setFxSubtype(FX_SUBTYPES.SPOT);
      setFxBuyCurrency('');
      setFxSellCurrency('');
      setFxRate('');
      setFxForwardDate('');
      // Reset value date to T+2 business days
      const d = new Date();
      let bd = 0;
      while (bd < 2) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) bd++;
      }
      setFxValueDate(d.toISOString().split('T')[0]);
      setFxAmountCurrency('buy');
      setStopLossPrice('');
      setTakeProfitPrice('');
      setFxSpotRate(null);
      setFxSpotLoading(false);
      setFxWarnings([]);
      // Reset Term Deposit fields
      setDepositTenor('');
      setDepositCurrency('EUR');
      setDepositAction('increase');
      // Reset client order attachments
      setClientOrderFile(null);
      setClientOrderFiles([]);
      // Reset price data
      setIndicativePrice(null);
      setIndicativePriceCurrency(null);
      setIsLoadingPrice(false);
      // Reset mode and account data
      setMode(initialMode);
      setAccountHoldings([]);
      setIsLoadingHoldings(false);
      setHoldingSearchQuery('');
      setSelectedHolding(null);
      setSellManualSearch(false);
      setCashBalance(null);
      setIsLoadingCash(false);
    }
  }, [isOpen]);

  // Search for securities
  useEffect(() => {
    if (searchQuery.length < 2 || selectedSecurity) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const sessionId = getSessionId();
        // Search in securities metadata (which includes products, equities, etc.)
        const results = await Meteor.callAsync('securities.search', { query: searchQuery, limit: 15, assetType }, sessionId);
        setSearchResults(results || []);
      } catch (err) {
        console.error('Error searching securities:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, selectedSecurity, assetType]);

  // Load bank accounts when client is selected
  useEffect(() => {
    if (selectedClientId) {
      // Pass the prefilled bank account ID if we have prefillData
      const prefilledBankAccountId = prefillData?.clientId === selectedClientId ? prefillData?.bankAccountId : null;
      loadClientBankAccounts(selectedClientId, prefilledBankAccountId);
    } else {
      setClientBankAccounts([]);
      setSelectedBankAccountId('');
    }
  }, [selectedClientId]);

  const loadClientBankAccounts = async (clientId, prefilledBankAccountId = null) => {
    setIsLoadingAccounts(true);
    try {
      const sessionId = getSessionId();
      const accounts = await Meteor.callAsync('bankAccounts.getForClient', { clientId }, sessionId);
      setClientBankAccounts(accounts || []);

      // If we have a prefilled bank account ID and it's in the list, use it
      if (prefilledBankAccountId && accounts?.some(a => a._id === prefilledBankAccountId)) {
        setSelectedBankAccountId(prefilledBankAccountId);
      } else if (accounts && accounts.length > 0 && !selectedBankAccountId) {
        // Otherwise, auto-select the first account if nothing selected
        setSelectedBankAccountId(accounts[0]._id);
      }
    } catch (err) {
      console.error('Error loading bank accounts:', err);
      setClientBankAccounts([]);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  // Load bank accounts for a bulk row
  const loadBulkRowAccounts = async (index, clientId) => {
    if (!clientId) {
      setBulkAccountsMap(prev => { const n = { ...prev }; delete n[index]; return n; });
      return;
    }
    setBulkAccountsLoading(prev => ({ ...prev, [index]: true }));
    try {
      const sessionId = getSessionId();
      const accounts = await Meteor.callAsync('bankAccounts.getForClient', { clientId }, sessionId);
      setBulkAccountsMap(prev => ({ ...prev, [index]: accounts || [] }));
      // Auto-select first account
      if (accounts && accounts.length > 0) {
        setBulkOrders(prev => {
          const updated = [...prev];
          if (updated[index]) updated[index] = { ...updated[index], bankAccountId: accounts[0]._id };
          return updated;
        });
      }
    } catch (err) {
      console.error('Error loading bulk row accounts:', err);
      setBulkAccountsMap(prev => ({ ...prev, [index]: [] }));
    } finally {
      setBulkAccountsLoading(prev => ({ ...prev, [index]: false }));
    }
  };

  // Load holdings and cash when bank account changes
  const loadAccountData = async (clientId, bankAccountId) => {
    if (!clientId || !bankAccountId) return;
    const sessionId = getSessionId();

    // Load holdings for sell mode
    setIsLoadingHoldings(true);
    try {
      const holdings = await Meteor.callAsync('orders.getAccountHoldings', { clientId, bankAccountId }, sessionId);
      setAccountHoldings(holdings || []);
    } catch (err) {
      console.error('Error loading holdings:', err);
      setAccountHoldings([]);
    } finally {
      setIsLoadingHoldings(false);
    }

    // Load cash balance for buy mode
    setIsLoadingCash(true);
    try {
      const cash = await Meteor.callAsync('orders.getAccountCashBalance', { clientId, bankAccountId }, sessionId);
      setCashBalance(cash);
    } catch (err) {
      console.error('Error loading cash balance:', err);
      setCashBalance(null);
    } finally {
      setIsLoadingCash(false);
    }
  };

  // Reload account data when bank account selection changes
  useEffect(() => {
    if (selectedClientId && selectedBankAccountId) {
      loadAccountData(selectedClientId, selectedBankAccountId);
    } else {
      setAccountHoldings([]);
      setCashBalance(null);
    }
  }, [selectedClientId, selectedBankAccountId]);

  // Fetch real-time price from EOD for a ticker
  const fetchEodPrice = async (ticker) => {
    if (!ticker) return;
    setIsLoadingPrice(true);
    try {
      const result = await Meteor.callAsync('eod.getRealTimePrice', ticker);
      if (result?.close) {
        setIndicativePrice(result.close);
        setEstimatedValueManuallyEdited(false);
      }
    } catch (err) {
      console.warn('Could not fetch EOD price:', err.message);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  // Look up Ambervision product data by ISIN to enrich order fields
  const enrichFromProduct = async (isin) => {
    if (!isin) return;
    try {
      const sessionId = getSessionId();
      const product = await Meteor.callAsync('orders.getProductByIsin', { isin }, sessionId);
      if (product) {
        if (product.issuer) setBroker(product.issuer);
        if (product.currency) setSettlementCurrency(product.currency);
        if (product.currency) setIndicativePriceCurrency(product.currency);
      }
    } catch (err) {
      console.warn('Could not look up product:', err.message);
    }
  };

  const handleSecuritySelect = (security) => {
    setSelectedSecurity(security);
    setSearchQuery(security.name || security.ticker || security.isin);
    setSearchResults([]);

    // Auto-detect asset type
    if (security.assetClass) {
      const assetClassMap = {
        'equity': ASSET_TYPES.EQUITY,
        'bond': ASSET_TYPES.BOND,
        'structured_product': ASSET_TYPES.STRUCTURED_PRODUCT,
        'fund': ASSET_TYPES.FUND,
        'etf': ASSET_TYPES.ETF,
        'fx': ASSET_TYPES.FX
      };
      setAssetType(assetClassMap[security.assetClass] || ASSET_TYPES.OTHER);
    }

    // Set currency
    setIndicativePriceCurrency(security.currency || null);
    if (security.currency) setSettlementCurrency(security.currency);

    // Auto-fill from Ambervision product data (structured products)
    if (security.source === 'product') {
      if (security.issuer) setBroker(security.issuer);
      if (security.denomination) setQuantity(String(security.denomination));
    } else {
      // For any non-product source, try to enrich from Ambervision by ISIN
      if (security.isin && security.isin.length >= 10) {
        enrichFromProduct(security.isin);
      }
    }

    // Fetch EOD price for market instruments
    if ((security.source === 'eod' || security.source === 'metadata') && security.ticker) {
      fetchEodPrice(security.ticker);
    } else if (security.source !== 'product') {
      setIndicativePrice(null);
    }
  };

  const clearSecuritySelection = () => {
    setSelectedSecurity(null);
    setSearchQuery('');
    setSearchResults([]);
    setManualEntryMode(false);
    setManualName('');
    setManualIsin('');
    setManualCurrency('EUR');
  };

  const validateStep = (step) => {
    setError(null);

    switch (step) {
      case 1: // Account Selection (now first)
        if (isBulkMode) {
          const validOrders = bulkOrders.filter(o => o.clientId && o.bankAccountId);
          if (validOrders.length === 0) {
            setError('Please add at least one account with client and bank account selected');
            return false;
          }
          // Check for incomplete rows (client selected but no account)
          const incompleteRows = bulkOrders.filter(o => o.clientId && !o.bankAccountId);
          if (incompleteRows.length > 0) {
            setError('Some rows have a client selected but no bank account. Please complete or remove them.');
            return false;
          }
          // Check for quantity on each row
          const missingQty = validOrders.filter(o => !o.quantity || parseFloat(o.quantity) <= 0);
          if (missingQty.length > 0) {
            setError('Please enter a valid quantity for each account');
            return false;
          }
          // Block duplicate client+account pairs
          const dupes = getBulkDuplicates();
          if (dupes.size > 0) {
            setError('Duplicate client + account pairs detected. Please remove duplicates before continuing.');
            return false;
          }
        } else {
          if (!selectedClientId) {
            setError('Please select a client');
            return false;
          }
          if (!selectedBankAccountId) {
            setError('Please select a bank account');
            return false;
          }
        }
        return true;

      case 2: // Security
        if (assetType === ASSET_TYPES.FX) {
          if (!fxBuyCurrency || !fxSellCurrency) {
            setError('Please enter both buy and sell currencies');
            return false;
          }
          if (fxBuyCurrency === fxSellCurrency) {
            setError('Buy and sell currencies must be different');
            return false;
          }
          return true;
        }
        if (assetType === ASSET_TYPES.TERM_DEPOSIT) {
          if (!depositCurrency) {
            setError('Please select a deposit currency');
            return false;
          }
          if (!depositTenor) {
            setError('Please select a tenor');
            return false;
          }
          return true;
        }
        if (!selectedSecurity || !selectedSecurity.isin) {
          setError('Please select a security with a valid ISIN');
          return false;
        }
        return true;

      case 3: // Order Details
        if (!isBulkMode && (!quantity || parseFloat(quantity) <= 0)) {
          setError(assetType === ASSET_TYPES.FX ? 'Please enter a valid amount' : assetType === ASSET_TYPES.TERM_DEPOSIT ? 'Please enter a valid amount' : 'Please enter a valid quantity');
          return false;
        }
        if (assetType !== ASSET_TYPES.FX && priceType === PRICE_TYPES.LIMIT && (!limitPrice || parseFloat(limitPrice) <= 0)) {
          setError('Please enter a valid limit price');
          return false;
        }
        if (priceType === PRICE_TYPES.STOP_LOSS && (!stopPrice || parseFloat(stopPrice) <= 0)) {
          setError('Please enter a valid stop price');
          return false;
        }
        if (priceType === PRICE_TYPES.STOP_LIMIT) {
          if (!stopPrice || parseFloat(stopPrice) <= 0) {
            setError('Please enter a valid stop price');
            return false;
          }
          if (!limitPrice || parseFloat(limitPrice) <= 0) {
            setError('Please enter a valid limit price');
            return false;
          }
        }
        if (validityType === VALIDITY_TYPES.GTD && priceType !== PRICE_TYPES.MARKET && !validityDate) {
          setError('Please select a validity date');
          return false;
        }
        return true;

      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (validateStep(currentStep)) {
      // Run allocation check when moving to review step (step 3→4) for buy orders
      if (currentStep === 3 && mode === 'buy' && !isBulkMode) {
        const ev = parseFloat(estimatedValue);
        if (ev && selectedBankAccountId && selectedClientId) {
          setIsCheckingAllocation(true);
          try {
            const result = await Meteor.callAsync('orders.checkAllocationImpact', {
              bankAccountId: selectedBankAccountId,
              clientId: selectedClientId,
              assetType,
              estimatedValue: ev,
              orderType: mode,
              capitalProtected: assetType === ASSET_TYPES.STRUCTURED_PRODUCT ? capitalProtected : undefined,
              sessionId: getSessionId()
            });
            setAllocationCheck(result);
          } catch (err) {
            console.error('Allocation check failed:', err);
            setAllocationCheck(null);
          }
          setIsCheckingAllocation(false);
        } else {
          setAllocationCheck(null);
        }
      }
      setCurrentStep(prev => Math.min(prev + 1, 4));
    }
  };

  const handleBack = () => {
    setError(null);
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    if (!validateStep(1) || !validateStep(2) || !validateStep(3)) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const sessionId = getSessionId();
      const selectedAccount = clientBankAccounts.find(a => a._id === selectedBankAccountId);

      if (isBulkMode) {
        // Create bulk orders - shared quantity across all accounts
        const validOrders = bulkOrders.filter(o => o.clientId && o.bankAccountId);

        // Determine ISIN and security name based on asset type (same logic as single mode)
        let bulkIsin, bulkSecurityName, bulkCurrency;
        if (assetType === ASSET_TYPES.FX) {
          bulkIsin = 'FX';
          const subtypeLabel = fxSubtype === FX_SUBTYPES.FORWARD ? 'Forward' : 'Spot';
          bulkSecurityName = `FX ${subtypeLabel} ${fxBuyCurrency}/${fxSellCurrency}`;
          bulkCurrency = fxBuyCurrency || 'USD';
        } else if (assetType === ASSET_TYPES.TERM_DEPOSIT) {
          bulkIsin = 'TD';
          const tenorLabel = TERM_DEPOSIT_TENORS.find(t => t.value === depositTenor)?.label || depositTenor;
          bulkSecurityName = `Term Deposit ${depositCurrency} ${tenorLabel}`;
          bulkCurrency = depositCurrency || 'EUR';
        } else {
          bulkIsin = selectedSecurity.isin;
          bulkSecurityName = selectedSecurity.name || selectedSecurity.ticker;
          bulkCurrency = selectedSecurity.currency || 'USD';
        }

        const bulkOrderData = {
          orderType: mode,
          isin: bulkIsin,
          securityName: bulkSecurityName,
          assetType,
          currency: bulkCurrency,
          priceType,
          orders: validOrders.map(o => {
            const rowAccounts = bulkAccountsMap[bulkOrders.indexOf(o)] || [];
            const account = rowAccounts.find(a => a._id === o.bankAccountId);
            const orderItem = {
              clientId: o.clientId,
              bankAccountId: o.bankAccountId,
              quantity: parseFloat(o.quantity)
            };
            if (account?.accountNumber) {
              orderItem.portfolioCode = account.accountNumber;
            }
            return orderItem;
          })
        };

        // Add optional fields only if they have values
        if ((priceType === PRICE_TYPES.LIMIT || priceType === PRICE_TYPES.STOP_LIMIT) && limitPrice) {
          bulkOrderData.limitPrice = parseFloat(limitPrice);
        }
        if (notes && notes.trim()) {
          bulkOrderData.notes = notes.trim();
        }
        if (broker && broker.trim()) {
          bulkOrderData.broker = broker.trim();
        }
        if (settlementCurrency && settlementCurrency.trim()) {
          bulkOrderData.settlementCurrency = settlementCurrency.trim().toUpperCase();
        }
        if (underlyings && underlyings.trim()) {
          bulkOrderData.underlyings = underlyings.trim();
        }

        // Order source (email or phone)
        bulkOrderData.orderSource = orderSource;
        if (orderSource === ORDER_SOURCE_TYPES.PHONE && phoneCallTime) {
          bulkOrderData.phoneCallTime = phoneCallTime;
        }

        const result = await Meteor.callAsync('orders.createBulk', {
          bulkOrderData,
          sessionId
        });

        // Upload email attachments to all created orders
        if (clientOrderFiles.length > 0 && result?.createdOrders?.length > 0) {
          for (const file of clientOrderFiles) {
            try {
              const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              // Attach to each created order in the group
              for (const created of result.createdOrders) {
                const orderId = created?.orderId || created?._id;
                if (orderId) {
                  await Meteor.callAsync('orders.uploadEmailTrace', {
                    orderId,
                    traceType: EMAIL_TRACE_TYPES.CLIENT_ORDER,
                    fileName: file.name,
                    base64Data: base64,
                    mimeType: file.type || 'application/octet-stream',
                    sessionId
                  });
                }
              }
            } catch (uploadErr) {
              console.error('Error uploading bulk email attachment:', uploadErr);
            }
          }
        }

        onOrderCreated?.(result);
      } else {
        // Create single order
        // Determine ISIN and security name based on asset type
        let orderIsin, orderSecurityName, orderCurrency;
        if (assetType === ASSET_TYPES.FX) {
          orderIsin = 'FX';
          const subtypeLabel = fxSubtype === FX_SUBTYPES.FORWARD ? 'Forward' : 'Spot';
          orderSecurityName = `FX ${subtypeLabel} ${fxBuyCurrency}/${fxSellCurrency}`;
          orderCurrency = fxBuyCurrency || 'USD';
        } else if (assetType === ASSET_TYPES.TERM_DEPOSIT) {
          orderIsin = 'TD';
          const tenorLabel = TERM_DEPOSIT_TENORS.find(t => t.value === depositTenor)?.label || depositTenor;
          orderSecurityName = `Term Deposit ${depositCurrency} ${tenorLabel}`;
          orderCurrency = depositCurrency || 'EUR';
        } else {
          orderIsin = selectedSecurity.isin;
          orderSecurityName = selectedSecurity.name || selectedSecurity.ticker;
          orderCurrency = selectedSecurity.currency || 'USD';
        }

        // Note: Match.Maybe accepts undefined but NOT null, so we use undefined for optional fields
        // For term deposits, the depositAction determines buy/sell
        const effectiveOrderType = assetType === ASSET_TYPES.TERM_DEPOSIT
          ? (depositAction === 'decrease' ? 'sell' : 'buy')
          : mode;
        const orderData = {
          orderType: effectiveOrderType,
          isin: orderIsin,
          securityName: orderSecurityName,
          assetType,
          currency: orderCurrency,
          quantity: parseFloat(quantity),
          priceType,
          clientId: selectedClientId,
          bankAccountId: selectedBankAccountId
        };

        // Add optional fields only if they have values (undefined is accepted by Match.Maybe, null is not)
        if ((priceType === PRICE_TYPES.LIMIT || priceType === PRICE_TYPES.STOP_LIMIT) && limitPrice) {
          orderData.limitPrice = parseFloat(limitPrice);
        }
        if ((priceType === PRICE_TYPES.STOP_LOSS || priceType === PRICE_TYPES.STOP_LIMIT) && stopPrice) {
          orderData.stopPrice = parseFloat(stopPrice);
        }
        if (estimatedValue) {
          orderData.estimatedValue = parseFloat(estimatedValue);
        }
        if (selectedAccount?.accountNumber) {
          orderData.portfolioCode = selectedAccount.accountNumber;
        }
        if (mode === 'sell' && (prefillData?.holdingId || selectedHolding?._id)) {
          orderData.sourceHoldingId = String(prefillData?.holdingId || selectedHolding._id);
        }
        if (notes && notes.trim()) {
          orderData.notes = notes.trim();
        }
        if (broker && broker.trim()) {
          orderData.broker = broker.trim();
        }
        if (settlementCurrency && settlementCurrency.trim()) {
          orderData.settlementCurrency = settlementCurrency.trim().toUpperCase();
        }
        if (underlyings && underlyings.trim()) {
          orderData.underlyings = underlyings.trim();
        }
        // FX-specific fields
        if (assetType === ASSET_TYPES.FX) {
          orderData.fxSubtype = fxSubtype;
          orderData.fxPair = `${fxBuyCurrency}/${fxSellCurrency}`;
          orderData.fxBuyCurrency = fxBuyCurrency;
          orderData.fxSellCurrency = fxSellCurrency;
          orderData.fxAmountCurrency = fxAmountCurrency === 'buy' ? fxBuyCurrency : fxSellCurrency;
          if (fxRate) orderData.fxRate = parseFloat(fxRate);
          if (limitPrice) orderData.limitPrice = parseFloat(limitPrice);
          // FX TP/SL create linked orders
          if (takeProfitPrice) orderData.attachedTakeProfit = parseFloat(takeProfitPrice);
          if (stopLossPrice) orderData.attachedStopLoss = parseFloat(stopLossPrice);
          if (fxForwardDate) orderData.fxForwardDate = fxForwardDate;
          if (fxValueDate) orderData.fxValueDate = fxValueDate;
          // For FX, set priceType based on which levels are set
          if (limitPrice) {
            orderData.priceType = PRICE_TYPES.LIMIT;
          }
        }
        // Term Deposit-specific fields
        if (assetType === ASSET_TYPES.TERM_DEPOSIT) {
          orderData.depositTenor = depositTenor;
          orderData.depositCurrency = depositCurrency;
          orderData.depositAction = depositAction;
        }
        // Capital protected flag for structured products
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT && capitalProtected) {
          orderData.capitalProtected = true;
        }
        orderData.tradeMode = TRADE_MODES.INDIVIDUAL;

        // Order source (email or phone)
        orderData.orderSource = orderSource;
        if (orderSource === ORDER_SOURCE_TYPES.PHONE && phoneCallTime) {
          orderData.phoneCallTime = phoneCallTime;
        }

        // Add validity for non-market orders
        if (priceType !== PRICE_TYPES.MARKET && assetType !== ASSET_TYPES.TERM_DEPOSIT) {
          orderData.validityType = validityType;
          if (validityType === VALIDITY_TYPES.GTD && validityDate) {
            orderData.validityDate = validityDate;
          }
        }

        // Add attached TP/SL info so server creates linked orders
        if (attachedTakeProfit) {
          orderData.attachedTakeProfit = parseFloat(attachedTakeProfit);
        }
        if (attachedStopLoss) {
          orderData.attachedStopLoss = parseFloat(attachedStopLoss);
        }

        // Add allocation justification if breaches exist
        if (allocationCheck?.hasBreaches && allocationJustification.trim()) {
          orderData.allocationJustification = allocationJustification.trim();
        }

        const result = await Meteor.callAsync('orders.create', {
          orderData,
          sessionId
        });

        // Upload client order email attachment if provided
        if (clientOrderFile && result?.orderId) {
          try {
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result.split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(clientOrderFile);
            });
            await Meteor.callAsync('orders.uploadEmailTrace', {
              orderId: result.orderId,
              traceType: EMAIL_TRACE_TYPES.CLIENT_ORDER,
              fileName: clientOrderFile.name,
              base64Data: base64,
              mimeType: clientOrderFile.type || 'application/octet-stream',
              sessionId
            });
          } catch (uploadErr) {
            console.error('Error uploading client order email:', uploadErr);
            // Don't block order creation if attachment upload fails
          }
        }

        onOrderCreated?.(result);
      }

      onClose();
    } catch (err) {
      console.error('Error creating order:', err);
      setError(err.reason || err.message || 'Failed to create order');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Bulk order management
  const addBulkOrder = () => {
    setBulkOrders([...bulkOrders, { clientId: '', bankAccountId: '', quantity: '' }]);
  };

  const removeBulkOrder = (index) => {
    if (bulkOrders.length > 1) {
      const newOrders = bulkOrders.filter((_, i) => i !== index);
      setBulkOrders(newOrders);
      // Re-index bulkAccountsMap
      const newMap = {};
      let newIdx = 0;
      for (let i = 0; i < bulkOrders.length; i++) {
        if (i !== index) {
          newMap[newIdx] = bulkAccountsMap[i] || [];
          newIdx++;
        }
      }
      setBulkAccountsMap(newMap);
    }
  };

  const updateBulkOrder = (index, field, value) => {
    const updated = [...bulkOrders];
    updated[index] = { ...updated[index], [field]: value };
    setBulkOrders(updated);
    // When client changes, load accounts for that row
    if (field === 'clientId') {
      updated[index].bankAccountId = '';
      setBulkOrders([...updated]);
      loadBulkRowAccounts(index, value);
    }
  };

  // Format account display text with type info
  const formatAccountLabel = (account) => {
    if (!account) return 'N/A';
    const parts = [account.bankName, account.accountNumber];
    if (account.accountType && account.accountType !== 'personal') parts.push(`[${account.accountType}]`);
    if (account.accountStructure && account.accountStructure !== 'direct') parts.push(`[${account.accountStructure.replace('_', ' ')}]`);
    if (account.comment) parts.push(`- ${account.comment}`);
    if (account.lifeInsuranceCompany) parts.push(`via ${account.lifeInsuranceCompany}`);
    if (account.beneficiary) parts.push(`[${account.beneficiary}]`);
    parts.push(`(${account.referenceCurrency})`);
    return parts.join(' ');
  };

  // Check for duplicate client+account pairs in bulk mode
  const getBulkDuplicates = () => {
    const seen = new Set();
    const dupes = new Set();
    bulkOrders.forEach((o, i) => {
      if (o.clientId && o.bankAccountId) {
        const key = `${o.clientId}:${o.bankAccountId}`;
        if (seen.has(key)) dupes.add(i);
        seen.add(key);
      }
    });
    return dupes;
  };

  // Styles
  const styles = {
    stepIndicator: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '24px',
      padding: '0 16px'
    },
    stepItem: (isActive, isComplete) => ({
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      opacity: isActive ? 1 : 0.5
    }),
    stepNumber: (isActive, isComplete) => ({
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px',
      fontWeight: '600',
      background: isComplete ? 'var(--success-color)' : isActive ? 'var(--accent-color)' : 'var(--bg-secondary)',
      color: isComplete || isActive ? 'white' : 'var(--text-secondary)'
    }),
    stepLabel: {
      fontSize: '13px',
      fontWeight: '500',
      color: 'var(--text-primary)'
    },
    stepConnector: {
      flex: 1,
      height: '2px',
      background: 'var(--border-color)',
      margin: '0 16px',
      alignSelf: 'center'
    },
    formGroup: {
      marginBottom: '16px'
    },
    label: {
      display: 'block',
      marginBottom: '6px',
      fontSize: '13px',
      fontWeight: '500',
      color: 'var(--text-secondary)'
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: '14px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none'
    },
    select: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: '14px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none',
      cursor: 'pointer'
    },
    textarea: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: '14px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none',
      minHeight: '80px',
      resize: 'vertical'
    },
    searchResults: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-color)',
      borderRadius: '0 0 6px 6px',
      maxHeight: '300px',
      overflowY: 'auto',
      zIndex: 100,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
    },
    searchResultItem: {
      padding: '10px 12px',
      borderBottom: '1px solid var(--border-color)',
      cursor: 'pointer',
      transition: 'background 0.15s'
    },
    selectedSecurity: {
      padding: '12px',
      background: 'var(--bg-secondary)',
      borderRadius: '6px',
      border: '1px solid var(--border-color)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    error: {
      padding: '12px',
      background: 'rgba(239, 68, 68, 0.1)',
      border: '1px solid var(--danger-color)',
      borderRadius: '6px',
      color: 'var(--danger-color)',
      fontSize: '13px',
      marginBottom: '16px'
    },
    reviewSection: {
      background: 'var(--bg-secondary)',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '16px'
    },
    reviewTitle: {
      fontSize: '14px',
      fontWeight: '600',
      color: 'var(--text-primary)',
      marginBottom: '12px'
    },
    reviewRow: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid var(--border-color)'
    },
    reviewLabel: {
      color: 'var(--text-secondary)',
      fontSize: '13px'
    },
    reviewValue: {
      fontWeight: '500',
      color: 'var(--text-primary)',
      fontSize: '13px'
    },
    orderTypeBadge: (type) => ({
      display: 'inline-block',
      padding: '4px 12px',
      borderRadius: '4px',
      fontWeight: '600',
      fontSize: '12px',
      textTransform: 'uppercase',
      background: type === 'buy' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
      color: type === 'buy' ? '#10b981' : '#ef4444'
    }),
    row: {
      display: 'flex',
      gap: '16px'
    },
    col: {
      flex: 1
    }
  };

  const steps = ['Account', 'Order Type', 'Details', 'Review'];

  const renderStepIndicator = () => (
    <div style={styles.stepIndicator}>
      {steps.map((step, index) => (
        <React.Fragment key={step}>
          <div style={styles.stepItem(currentStep === index + 1, currentStep > index + 1)}>
            <div style={styles.stepNumber(currentStep === index + 1, currentStep > index + 1)}>
              {currentStep > index + 1 ? '✓' : index + 1}
            </div>
            <span style={styles.stepLabel}>{step}</span>
          </div>
          {index < steps.length - 1 && <div style={styles.stepConnector} />}
        </React.Fragment>
      ))}
    </div>
  );

  const renderStep1 = () => (
    <div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Asset Type</label>
        <select
          style={styles.select}
          value={assetType}
          onChange={(e) => {
            setAssetType(e.target.value);
            // Clear security selection when switching to FX/TD
            if (e.target.value === ASSET_TYPES.FX || e.target.value === ASSET_TYPES.TERM_DEPOSIT) {
              setSelectedSecurity(null);
              setSearchQuery('');
              setSearchResults([]);
            }
          }}
        >
          <option value={ASSET_TYPES.EQUITY}>Equity</option>
          <option value={ASSET_TYPES.BOND}>Bond</option>
          <option value={ASSET_TYPES.STRUCTURED_PRODUCT}>Structured Product</option>
          <option value={ASSET_TYPES.FUND}>Fund</option>
          <option value={ASSET_TYPES.ETF}>ETF</option>
          <option value={ASSET_TYPES.FX}>FX</option>
          <option value={ASSET_TYPES.TERM_DEPOSIT}>Term Deposit</option>
          <option value={ASSET_TYPES.OTHER}>Other</option>
        </select>
      </div>

      {assetType !== ASSET_TYPES.FX && assetType !== ASSET_TYPES.TERM_DEPOSIT && (
      <div style={styles.formGroup}>
        <label style={styles.label}>Search Security</label>
        {selectedSecurity ? (
          <div style={styles.selectedSecurity}>
            <div>
              <div style={{ fontWeight: '500' }}>{selectedSecurity.name || selectedSecurity.ticker}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {selectedSecurity.isin} {selectedSecurity.currency && `| ${selectedSecurity.currency}`}
              </div>
            </div>
            <ActionButton variant="secondary" size="small" onClick={clearSecuritySelection}>
              Change
            </ActionButton>
          </div>
        ) : manualEntryMode ? (
          /* Manual entry form - stable, stays visible until user confirms or cancels */
          <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                Enter security details manually
              </div>
              <ActionButton variant="secondary" size="small" onClick={() => {
                setManualEntryMode(false);
                setManualName('');
                setManualIsin('');
                setManualCurrency('EUR');
              }}>
                Back to search
              </ActionButton>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Security Name *</label>
              <input
                type="text"
                style={styles.input}
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="e.g. Phoenix Autocallable on TSLA/AAPL"
                autoFocus
              />
            </div>
            <div style={styles.row}>
              <div style={styles.col}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>ISIN *</label>
                  <input
                    type="text"
                    style={styles.input}
                    value={manualIsin}
                    onChange={(e) => setManualIsin(e.target.value.toUpperCase())}
                    placeholder="e.g. CH1234567890"
                    maxLength={20}
                  />
                </div>
              </div>
              <div style={{ flex: '0 0 120px' }}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Currency *</label>
                  <input
                    type="text"
                    style={styles.input}
                    value={manualCurrency}
                    onChange={(e) => setManualCurrency(e.target.value.toUpperCase().slice(0, 3))}
                    placeholder="EUR"
                    maxLength={3}
                  />
                </div>
              </div>
            </div>
            <ActionButton
              variant="primary"
              size="small"
              onClick={() => {
                if (manualName.trim() && manualIsin.trim() && manualCurrency.trim()) {
                  setSelectedSecurity({
                    isin: manualIsin.trim(),
                    name: manualName.trim(),
                    currency: manualCurrency.trim()
                  });
                  setManualEntryMode(false);
                }
              }}
              disabled={!manualName.trim() || !manualIsin.trim() || !manualCurrency.trim()}
              style={{ marginTop: '4px' }}
            >
              Confirm Security
            </ActionButton>
          </div>
        ) : (
          /* Search mode */
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              style={styles.input}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, ISIN, or ticker..."
            />
            {isSearching && (
              <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                  width: '18px', height: '18px',
                  border: '2px solid var(--border-color)',
                  borderTopColor: 'var(--accent-color)',
                  borderRadius: '50%',
                  animation: 'orderModalSpin 0.6s linear infinite'
                }} />
              </div>
            )}
            {searchResults.length > 0 && (
              <div style={styles.searchResults}>
                {searchResults.map((result, idx) => (
                  <div
                    key={result._id || idx}
                    style={styles.searchResultItem}
                    onClick={() => handleSecuritySelect(result)}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: '500' }}>{result.name || result.ticker}</div>
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontWeight: '500',
                        background: result.source === 'product' ? 'rgba(99, 102, 241, 0.15)' : result.source === 'eod' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                        color: result.source === 'product' ? '#6366f1' : result.source === 'eod' ? '#f59e0b' : '#6b7280'
                      }}>
                        {result.source === 'product' ? 'Ambervision' : result.source === 'eod' ? 'EOD' : result.source === 'metadata' ? 'Local' : 'PMS'}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {result.isin} {result.ticker && result.ticker !== result.isin ? `| ${result.ticker}` : ''} {result.exchange && `| ${result.exchange}`} {result.currency && `| ${result.currency}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* No results message */}
            {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
              <div style={{
                marginTop: '8px',
                padding: '10px 12px',
                background: 'var(--bg-secondary)',
                borderRadius: '6px',
                fontSize: '13px',
                color: 'var(--text-secondary)'
              }}>
                No results found for "{searchQuery}"
              </div>
            )}
            {/* Always-visible manual entry link */}
            <div
              style={{
                marginTop: '8px',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              onClick={() => {
                setManualEntryMode(true);
                setManualName(searchQuery);
                setSearchQuery('');
                setSearchResults([]);
              }}
            >
              <span style={{ fontSize: '14px' }}>+</span> New security not in the system? <span style={{ color: 'var(--accent-primary)', fontWeight: '500' }}>Enter manually</span>
            </div>
          </div>
        )}
      </div>
      )}

      {/* FX-specific form */}
      {assetType === ASSET_TYPES.FX && (
        <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px' }}>
            FX Transaction Details
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>FX Type</label>
            <select
              style={styles.select}
              value={fxSubtype}
              onChange={(e) => setFxSubtype(e.target.value)}
            >
              <option value={FX_SUBTYPES.SPOT}>Spot</option>
              <option value={FX_SUBTYPES.FORWARD}>Forward</option>
            </select>
          </div>
          <div style={styles.row}>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Buy Currency *</label>
                <select
                  style={styles.select}
                  value={fxBuyCurrency}
                  onChange={(e) => setFxBuyCurrency(e.target.value)}
                >
                  <option value="">Select currency...</option>
                  {FX_CURRENCIES.filter(ccy => ccy !== fxSellCurrency).map(ccy => (
                    <option key={ccy} value={ccy}>{ccy}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Sell Currency *</label>
                <select
                  style={styles.select}
                  value={fxSellCurrency}
                  onChange={(e) => setFxSellCurrency(e.target.value)}
                >
                  <option value="">Select currency...</option>
                  {FX_CURRENCIES.filter(ccy => ccy !== fxBuyCurrency).map(ccy => (
                    <option key={ccy} value={ccy}>{ccy}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          {fxBuyCurrency && fxSellCurrency && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Pair: <strong>{fxBuyCurrency}/{fxSellCurrency}</strong>
            </div>
          )}
        </div>
      )}

      {/* Term Deposit-specific form */}
      {assetType === ASSET_TYPES.TERM_DEPOSIT && (
        <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px' }}>
            Term Deposit Details
          </div>
          {/* Action toggle: Increase or Decrease */}
          <div style={{ display: 'flex', gap: '0', marginBottom: '12px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
            <button
              type="button"
              onClick={() => setDepositAction('increase')}
              style={{
                flex: 1, padding: '8px 12px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600',
                background: depositAction === 'increase' ? '#10b981' : 'var(--bg-primary)',
                color: depositAction === 'increase' ? '#fff' : 'var(--text-secondary)',
                transition: 'all 0.15s ease'
              }}
            >
              Increase
            </button>
            <button
              type="button"
              onClick={() => setDepositAction('decrease')}
              style={{
                flex: 1, padding: '8px 12px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600',
                borderLeft: '1px solid var(--border-color)',
                background: depositAction === 'decrease' ? '#ef4444' : 'var(--bg-primary)',
                color: depositAction === 'decrease' ? '#fff' : 'var(--text-secondary)',
                transition: 'all 0.15s ease'
              }}
            >
              Decrease
            </button>
          </div>
          <div style={styles.row}>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Deposit Currency *</label>
                <select
                  style={styles.select}
                  value={depositCurrency}
                  onChange={(e) => setDepositCurrency(e.target.value)}
                >
                  {FX_CURRENCIES.map(ccy => (
                    <option key={ccy} value={ccy}>{ccy}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Tenor *</label>
                <select
                  style={styles.select}
                  value={depositTenor}
                  onChange={(e) => setDepositTenor(e.target.value)}
                >
                  <option value="">Select tenor...</option>
                  {TERM_DEPOSIT_TENORS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          {depositCurrency && depositTenor && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {depositAction === 'decrease' ? 'Will decrease' : 'Will increase'}: <strong>Term Deposit {depositCurrency} {TERM_DEPOSIT_TENORS.find(t => t.value === depositTenor)?.label || depositTenor}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const getCurrencyForDisplay = () => {
    if (assetType === ASSET_TYPES.FX) return fxBuyCurrency || 'USD';
    if (assetType === ASSET_TYPES.TERM_DEPOSIT) return depositCurrency || 'EUR';
    return selectedSecurity?.currency || 'USD';
  };

  const renderStep2 = () => (
    <div>
      {/* FX-specific Step 2 */}
      {assetType === ASSET_TYPES.FX ? (
        <>
          {/* Amount + currency side */}
          <div style={styles.row}>
            <div style={{ flex: 2 }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Amount</label>
                <input
                  type="number"
                  style={styles.input}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Enter amount"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>In Currency</label>
                <select
                  style={styles.select}
                  value={fxAmountCurrency}
                  onChange={(e) => setFxAmountCurrency(e.target.value)}
                >
                  <option value="buy">{fxBuyCurrency || 'Buy'}</option>
                  <option value="sell">{fxSellCurrency || 'Sell'}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Pair display with spot rate */}
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px', padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                {mode === 'buy' ? 'Buy' : 'Sell'} <strong>{fxBuyCurrency}/{fxSellCurrency}</strong>
                {fxSubtype === FX_SUBTYPES.FORWARD ? ' Forward' : ' Spot'}
                {quantity ? ` — ${parseFloat(quantity).toLocaleString()} ${fxAmountCurrency === 'buy' ? fxBuyCurrency : fxSellCurrency}` : ''}
              </span>
              <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                {fxSpotLoading ? 'Loading...' : fxSpotRate ? `Spot: ${fxSpotRate.toFixed(6)}` : ''}
              </span>
            </div>
          </div>

          {/* Limit, Stop Loss, Take Profit */}
          <div style={styles.row}>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Limit Price (Optional)</label>
                <input
                  type="number"
                  style={styles.input}
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="Limit rate"
                  min="0"
                  step="0.000001"
                />
              </div>
            </div>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Stop Loss (Optional)</label>
                <input
                  type="number"
                  style={styles.input}
                  value={stopLossPrice}
                  onChange={(e) => setStopLossPrice(e.target.value)}
                  placeholder="Stop loss rate"
                  min="0"
                  step="0.000001"
                />
              </div>
            </div>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Take Profit (Optional)</label>
                <input
                  type="number"
                  style={styles.input}
                  value={takeProfitPrice}
                  onChange={(e) => setTakeProfitPrice(e.target.value)}
                  placeholder="Take profit rate"
                  min="0"
                  step="0.000001"
                />
              </div>
            </div>
          </div>

          {/* FX coherence warnings */}
          {fxWarnings.length > 0 && (
            <div style={{
              padding: '10px 12px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '6px',
              marginBottom: '12px'
            }}>
              {fxWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: '12px', color: '#f59e0b', marginBottom: i < fxWarnings.length - 1 ? '4px' : 0 }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}

          {/* Value Date / Forward Date */}
          <div style={styles.row}>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Value Date (Optional)</label>
                <input
                  type="date"
                  style={styles.input}
                  value={fxValueDate}
                  onChange={(e) => setFxValueDate(e.target.value)}
                />
              </div>
            </div>
            {fxSubtype === FX_SUBTYPES.FORWARD && (
              <div style={styles.col}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Forward Date</label>
                  <input
                    type="date"
                    style={styles.input}
                    value={fxForwardDate}
                    onChange={(e) => setFxForwardDate(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Indicative price info */}
          {(indicativePrice || isLoadingPrice) && assetType !== ASSET_TYPES.TERM_DEPOSIT && (
            <div style={{
              padding: '8px 12px',
              background: 'var(--bg-secondary)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              marginBottom: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '13px'
            }}>
              <span style={{ color: 'var(--text-secondary)' }}>Indicative Price</span>
              {isLoadingPrice ? (
                <span style={{ color: 'var(--text-secondary)' }}>Fetching...</span>
              ) : (
                <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                  {indicativePriceCurrency || ''} {indicativePrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </span>
              )}
            </div>
          )}

          {/* Quantity first */}
          <div style={styles.row}>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  {assetType === ASSET_TYPES.TERM_DEPOSIT ? 'Amount' : 'Quantity'}
                  {mode === 'sell' && selectedHolding?.quantity && ` (Max: ${selectedHolding.quantity.toLocaleString()})`}
                  {mode === 'sell' && !selectedHolding && prefillData?.quantity && ` (Max: ${prefillData.quantity})`}
                </label>
                <input
                  type="number"
                  style={styles.input}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder={assetType === ASSET_TYPES.TERM_DEPOSIT ? 'Enter amount' : 'Enter quantity'}
                  min="0"
                  step={assetType === ASSET_TYPES.TERM_DEPOSIT ? '0.01' : '1'}
                />
              </div>
            </div>
          </div>

          {/* Cash sufficiency check for BUY equity/ETF orders */}
          {mode === 'buy' && (assetType === ASSET_TYPES.EQUITY || assetType === ASSET_TYPES.ETF) && cashBalance?.cashPositions?.length > 0 && (() => {
            const secCurrency = selectedSecurity?.currency || prefillData?.currency || settlementCurrency || '';
            const cashInCurrency = cashBalance.cashPositions.find(p => p.currency === secCurrency);
            const price = priceType === PRICE_TYPES.LIMIT && limitPrice ? parseFloat(limitPrice) : indicativePrice;
            const maxShares = cashInCurrency && price && price > 0 ? Math.floor(cashInCurrency.amount / price) : null;
            const qty = parseFloat(quantity) || 0;
            const estCost = qty > 0 && price ? qty * price : 0;
            const exceeds = cashInCurrency && estCost > cashInCurrency.amount;

            return cashInCurrency || secCurrency ? (
              <div style={{
                padding: '10px 14px',
                background: exceeds ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                borderRadius: '8px',
                border: `1px solid ${exceeds ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                marginBottom: '12px',
                fontSize: '13px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: maxShares ? '4px' : 0 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Cash in {secCurrency}</span>
                  <span style={{ fontWeight: '600', color: cashInCurrency ? (exceeds ? '#ef4444' : '#10b981') : 'var(--text-secondary)' }}>
                    {cashInCurrency ? cashInCurrency.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'No balance'}
                  </span>
                </div>
                {maxShares !== null && maxShares > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Max shares at {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {secCurrency}
                    </span>
                    <span
                      style={{ fontWeight: '600', color: 'var(--accent-color)', cursor: 'pointer' }}
                      title="Click to fill quantity"
                      onClick={() => setQuantity(String(maxShares))}
                    >
                      {maxShares.toLocaleString()}
                    </span>
                  </div>
                )}
                {exceeds && qty > 0 && (
                  <div style={{ marginTop: '4px', color: '#ef4444', fontSize: '12px', fontWeight: '500' }}>
                    Estimated cost {secCurrency} {estCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} exceeds available cash
                  </div>
                )}
              </div>
            ) : null;
          })()}

          {/* Order type selector */}
          {assetType !== ASSET_TYPES.TERM_DEPOSIT && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Order Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: (assetType === ASSET_TYPES.EQUITY || assetType === ASSET_TYPES.ETF) ? '1fr 1fr 1fr 1fr' : '1fr 1fr', gap: '6px' }}>
                {[
                  { value: PRICE_TYPES.MARKET, label: 'Market' },
                  { value: PRICE_TYPES.LIMIT, label: 'Limit' },
                  ...((assetType === ASSET_TYPES.EQUITY || assetType === ASSET_TYPES.ETF) ? [
                    { value: PRICE_TYPES.STOP_LOSS, label: 'Stop Loss' },
                    { value: PRICE_TYPES.STOP_LIMIT, label: 'Stop Limit' }
                  ] : [])
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setPriceType(opt.value); if (opt.value === PRICE_TYPES.MARKET) { setLimitPrice(''); setStopPrice(''); } }}
                    style={{
                      padding: '8px 4px',
                      borderRadius: '6px',
                      border: `2px solid ${priceType === opt.value ? 'var(--accent-color)' : 'var(--border-color)'}`,
                      background: priceType === opt.value ? 'rgba(102, 126, 234, 0.1)' : 'var(--bg-secondary)',
                      color: priceType === opt.value ? 'var(--accent-color)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '12px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Price fields based on order type */}
          {priceType === PRICE_TYPES.LIMIT && assetType !== ASSET_TYPES.TERM_DEPOSIT && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Limit Price ({getCurrencyForDisplay()})</label>
              <input
                type="number"
                style={styles.input}
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder={mode === 'buy' ? 'Maximum price to buy' : 'Minimum price to sell'}
                min="0"
                step="0.01"
              />
            </div>
          )}

          {priceType === PRICE_TYPES.STOP_LOSS && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Stop Price ({getCurrencyForDisplay()})</label>
              <input
                type="number"
                style={styles.input}
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                placeholder="Trigger price — executes at market when reached"
                min="0"
                step="0.01"
              />
            </div>
          )}

          {priceType === PRICE_TYPES.STOP_LIMIT && (
            <div style={styles.row}>
              <div style={styles.col}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Stop Price ({getCurrencyForDisplay()})</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={stopPrice}
                    onChange={(e) => setStopPrice(e.target.value)}
                    placeholder="Trigger price"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
              <div style={styles.col}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Limit Price ({getCurrencyForDisplay()})</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    placeholder="Max execution price"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Validity for non-market orders */}
          {priceType !== PRICE_TYPES.MARKET && assetType !== ASSET_TYPES.TERM_DEPOSIT && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Validity</label>
              <div style={{ display: 'grid', gridTemplateColumns: validityType === VALIDITY_TYPES.GTD ? '1fr 1fr 1fr 2fr' : '1fr 1fr 1fr', gap: '6px', alignItems: 'start' }}>
                {[
                  { value: VALIDITY_TYPES.DAY, label: 'Day' },
                  { value: VALIDITY_TYPES.GTC, label: 'Good Till Canceled' },
                  { value: VALIDITY_TYPES.GTD, label: 'Good Till Date' }
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setValidityType(opt.value); if (opt.value !== VALIDITY_TYPES.GTD) setValidityDate(''); }}
                    style={{
                      padding: '8px 4px',
                      borderRadius: '6px',
                      border: `2px solid ${validityType === opt.value ? 'var(--accent-color)' : 'var(--border-color)'}`,
                      background: validityType === opt.value ? 'rgba(102, 126, 234, 0.1)' : 'var(--bg-secondary)',
                      color: validityType === opt.value ? 'var(--accent-color)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '11px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
                {validityType === VALIDITY_TYPES.GTD && (
                  <input
                    type="date"
                    style={styles.input}
                    value={validityDate}
                    onChange={(e) => setValidityDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                  />
                )}
              </div>
            </div>
          )}

          {/* Attached Take Profit / Stop Loss legs - only for equities, ETFs, FX with market/limit orders */}
          {(assetType === ASSET_TYPES.EQUITY || assetType === ASSET_TYPES.ETF || assetType === ASSET_TYPES.FX) && priceType !== PRICE_TYPES.STOP_LOSS && priceType !== PRICE_TYPES.STOP_LIMIT && (
            <div style={{
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              marginBottom: '12px',
              overflow: 'hidden'
            }}>
              <div
                onClick={() => setShowAttachedOrders(prev => !prev)}
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  userSelect: 'none'
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  Attached Orders (Optional)
                  {(attachedTakeProfit || attachedStopLoss) && (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: '#10b981', fontWeight: '500' }}>
                      {[attachedTakeProfit && 'TP', attachedStopLoss && 'SL'].filter(Boolean).join(' + ')} set
                    </span>
                  )}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', transition: 'transform 0.2s', transform: showAttachedOrders ? 'rotate(180deg)' : 'rotate(0)' }}>
                  ▼
                </span>
              </div>
              {showAttachedOrders && (
                <div style={{ padding: '0 12px 12px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Creates linked orders with the same reference. Each can be edited separately.
                  </div>
                  <div style={styles.row}>
                    <div style={styles.col}>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Take Profit ({getCurrencyForDisplay()})</label>
                        <input
                          type="number"
                          style={styles.input}
                          value={attachedTakeProfit}
                          onChange={(e) => setAttachedTakeProfit(e.target.value)}
                          placeholder="Target price"
                          min="0"
                          step="0.01"
                        />
                      </div>
                    </div>
                    <div style={styles.col}>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Stop Loss ({getCurrencyForDisplay()})</label>
                        <input
                          type="number"
                          style={styles.input}
                          value={attachedStopLoss}
                          onChange={(e) => setAttachedStopLoss(e.target.value)}
                          placeholder="Protection price"
                          min="0"
                          step="0.01"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {assetType !== ASSET_TYPES.TERM_DEPOSIT && assetType !== ASSET_TYPES.FX && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Estimated Value ({getCurrencyForDisplay()}){!indicativePrice && !prefillData?.marketPrice ? ' - Optional' : ''}</label>
          <input
            type="number"
            style={styles.input}
            value={estimatedValue}
            onChange={(e) => {
              setEstimatedValue(e.target.value);
              setEstimatedValueManuallyEdited(true);
            }}
            placeholder="Enter estimated value"
            min="0"
            step="0.01"
          />
        </div>
      )}

      {/* Capital Protected toggle for structured products */}
      {assetType === ASSET_TYPES.STRUCTURED_PRODUCT && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: capitalProtected ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-secondary)',
          borderRadius: '8px',
          border: `1px solid ${capitalProtected ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)'}`,
          marginBottom: '12px',
          cursor: 'pointer',
          transition: 'all 0.15s ease'
        }} onClick={() => setCapitalProtected(!capitalProtected)}>
          <div>
            <span style={{ fontSize: '13px', fontWeight: '600', color: capitalProtected ? '#10b981' : 'var(--text-primary)' }}>
              Capital Protected
            </span>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              Counts as Bonds for profile allocation (otherwise Equities)
            </div>
          </div>
          <div style={{
            width: '36px',
            height: '20px',
            borderRadius: '10px',
            background: capitalProtected ? '#10b981' : 'var(--border-color)',
            position: 'relative',
            transition: 'background 0.2s ease',
            flexShrink: 0
          }}>
            <div style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: 'white',
              position: 'absolute',
              top: '2px',
              left: capitalProtected ? '18px' : '2px',
              transition: 'left 0.2s ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
            }} />
          </div>
        </div>
      )}

      {assetType !== ASSET_TYPES.FX && assetType !== ASSET_TYPES.TERM_DEPOSIT && (
        <>
          <div style={styles.row}>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Broker / Issuer (Optional)</label>
                <input
                  type="text"
                  style={styles.input}
                  value={broker}
                  onChange={(e) => setBroker(e.target.value)}
                  placeholder="e.g. Marex, EDR..."
                />
              </div>
            </div>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Settlement Currency (Optional)</label>
                <input
                  type="text"
                  style={styles.input}
                  value={settlementCurrency}
                  onChange={(e) => setSettlementCurrency(e.target.value)}
                  placeholder="e.g. EUR, USD..."
                  maxLength={3}
                />
              </div>
            </div>
          </div>

        </>
      )}

      <div style={styles.formGroup}>
        <label style={styles.label}>Notes (Optional)</label>
        <textarea
          style={styles.textarea}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add any special instructions or notes..."
        />
      </div>

      {/* Order Source Toggle + Client Order Attachment / Phone Call */}
      <div style={styles.formGroup}>
        <label style={styles.label}>Client Instruction Source</label>
        <div style={{ display: 'flex', gap: '0', marginBottom: '10px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
          {[
            { value: ORDER_SOURCE_TYPES.EMAIL, label: 'Email', icon: '📧' },
            { value: ORDER_SOURCE_TYPES.PHONE, label: 'Phone', icon: '📞' }
          ].map(({ value, label, icon }) => (
            <button
              key={value}
              type="button"
              style={{
                flex: 1, padding: '8px 12px', border: 'none',
                background: orderSource === value ? 'var(--accent-color)' : 'var(--bg-secondary)',
                color: orderSource === value ? '#fff' : 'var(--text-secondary)',
                fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s'
              }}
              onClick={() => setOrderSource(value)}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {orderSource === ORDER_SOURCE_TYPES.PHONE ? (
          <div style={{
            padding: '12px', borderRadius: '8px',
            background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.2)'
          }}>
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#3b82f6', display: 'block', marginBottom: '6px' }}>
              Call received at
            </label>
            <input
              type="datetime-local"
              value={phoneCallTime}
              onChange={(e) => setPhoneCallTime(e.target.value)}
              style={{
                ...styles.input,
                marginBottom: '0'
              }}
            />
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
              Use the Notes field above for call details if needed
            </div>
          </div>
        ) : (
          <>
            <label style={{ ...styles.label, marginBottom: '6px' }}>
              {isBulkMode ? `Client Order Emails (${clientOrderFiles.length} attached)` : 'Client Order Email (Optional)'}
            </label>

            {/* Show existing files for bulk mode */}
            {isBulkMode && clientOrderFiles.length > 0 && (
              <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {clientOrderFiles.map((file, idx) => (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 10px', background: 'rgba(16, 185, 129, 0.05)',
                    border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '6px'
                  }}>
                    <span style={{ fontSize: '14px' }}>📎</span>
                    <span style={{ fontSize: '12px', fontWeight: '500', color: '#10b981', flex: 1 }}>{file.name}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      ({(file.size / 1024).toFixed(0)} KB)
                    </span>
                    <button
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '13px', padding: '2px 6px' }}
                      onClick={() => setClientOrderFiles(prev => prev.filter((_, i) => i !== idx))}
                      title="Remove file"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Show single file for non-bulk mode */}
            {!isBulkMode && clientOrderFile && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
                padding: '8px 12px', background: 'rgba(16, 185, 129, 0.05)',
                border: '2px solid #10b981', borderRadius: '8px'
              }}>
                <span style={{ fontSize: '16px' }}>📎</span>
                <span style={{ fontSize: '13px', fontWeight: '600', color: '#10b981', flex: 1 }}>{clientOrderFile.name}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  ({(clientOrderFile.size / 1024).toFixed(0)} KB)
                </span>
                <button
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '2px 6px' }}
                  onClick={() => setClientOrderFile(null)}
                  title="Remove file"
                >
                  x
                </button>
              </div>
            )}

            {/* Drop zone / file picker — always shown for bulk (to add more), shown when no file for single */}
            {(isBulkMode || !clientOrderFile) && (
              <div
                style={{
                  border: '2px dashed var(--border-color)',
                  borderRadius: '8px',
                  padding: isBulkMode && clientOrderFiles.length > 0 ? '10px' : '16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: 'var(--bg-secondary)',
                  transition: 'border-color 0.15s, background 0.15s'
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const droppedFiles = Array.from(e.dataTransfer.files);
                  const validFiles = [];
                  for (const file of droppedFiles) {
                    const ext = '.' + file.name.split('.').pop().toLowerCase();
                    if (!EMAIL_TRACE_ACCEPTED_TYPES.includes(ext)) {
                      setError(`File type ${ext} not accepted. Use: ${EMAIL_TRACE_ACCEPTED_TYPES.join(', ')}`);
                      return;
                    }
                    if (file.size > EMAIL_TRACE_MAX_SIZE) {
                      setError(`${file.name} exceeds maximum size of 15MB`);
                      return;
                    }
                    validFiles.push(file);
                  }
                  if (validFiles.length > 0) {
                    if (isBulkMode) {
                      setClientOrderFiles(prev => [...prev, ...validFiles]);
                    } else {
                      setClientOrderFile(validFiles[0]);
                    }
                    setError(null);
                  }
                }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = EMAIL_TRACE_ACCEPTED_TYPES.join(',');
                  if (isBulkMode) input.multiple = true;
                  input.onchange = (e) => {
                    const selectedFiles = Array.from(e.target.files);
                    for (const file of selectedFiles) {
                      if (file.size > EMAIL_TRACE_MAX_SIZE) {
                        setError(`${file.name} exceeds maximum size of 15MB`);
                        return;
                      }
                    }
                    if (selectedFiles.length > 0) {
                      if (isBulkMode) {
                        setClientOrderFiles(prev => [...prev, ...selectedFiles]);
                      } else {
                        setClientOrderFile(selectedFiles[0]);
                      }
                      setError(null);
                    }
                  };
                  input.click();
                }}
              >
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  {isBulkMode
                    ? (clientOrderFiles.length > 0 ? '+ Add more client emails' : 'Drop client order emails here, or click to browse')
                    : 'Drop client order email here, or click to browse'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  .msg, .eml, .pdf — Visible to validators for four-eyes check
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  const renderStep3 = () => {
    const bulkDuplicates = isBulkMode ? getBulkDuplicates() : new Set();

    return (
      <div>
        {/* Multi-account toggle */}
        {!prefillData?.clientId && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: isBulkMode ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-secondary)',
            borderRadius: '8px',
            border: `1px solid ${isBulkMode ? 'rgba(99, 102, 241, 0.3)' : 'var(--border-color)'}`,
            marginBottom: '16px',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }} onClick={() => {
            const next = !isBulkMode;
            setIsBulkMode(next);
            if (!next) {
              setBulkOrders([{ clientId: '', bankAccountId: '', quantity: '' }]);
              setBulkAccountsMap({});
              setBulkAccountsLoading({});
              setClientOrderFiles([]);
            }
          }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: isBulkMode ? '#6366f1' : 'var(--text-primary)' }}>
              Multi-account order
            </span>
            <div style={{
              width: '36px',
              height: '20px',
              borderRadius: '10px',
              background: isBulkMode ? '#6366f1' : 'var(--border-color)',
              position: 'relative',
              transition: 'background 0.2s ease'
            }}>
              <div style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: 'white',
                position: 'absolute',
                top: '2px',
                left: isBulkMode ? '18px' : '2px',
                transition: 'left 0.2s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
              }} />
            </div>
          </div>
        )}

        {!isBulkMode ? (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>Client</label>
              {isLoadingClients ? (
                <div style={{ padding: '10px', color: 'var(--text-secondary)' }}>Loading clients...</div>
              ) : (
                <select
                  style={styles.select}
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  disabled={!!prefillData?.clientId}
                >
                  <option value="">Select a client...</option>
                  {availableClients.map(client => {
                    const isCompany = client.profile?.clientType === 'company';
                    const name = isCompany && client.profile?.companyName
                      ? client.profile.companyName
                      : `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || client.username;
                    return (
                      <option key={client._id} value={client._id}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Bank Account</label>
              {isLoadingAccounts ? (
                <div style={{ padding: '10px', color: 'var(--text-secondary)' }}>Loading accounts...</div>
              ) : (
                <select
                  style={styles.select}
                  value={selectedBankAccountId}
                  onChange={(e) => setSelectedBankAccountId(e.target.value)}
                  disabled={!selectedClientId || !!prefillData?.bankAccountId}
                >
                  <option value="">Select a bank account...</option>
                  {clientBankAccounts.map(account => (
                    <option key={account._id} value={account._id}>{formatAccountLabel(account)}</option>
                  ))}
                </select>
              )}
            </div>
          </>
        ) : (
          /* Bulk Mode */
          <div>
            {bulkOrders.map((order, index) => {
              const rowAccounts = bulkAccountsMap[index] || [];
              const isLoadingRow = bulkAccountsLoading[index] || false;
              const isDuplicate = bulkDuplicates.has(index);

              return (
                <div key={index} style={{
                  padding: '12px',
                  background: isDuplicate ? 'rgba(245, 158, 11, 0.06)' : 'var(--bg-secondary)',
                  borderRadius: '6px',
                  marginBottom: '8px',
                  border: `1px solid ${isDuplicate ? 'rgba(245, 158, 11, 0.4)' : 'var(--border-color)'}`
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: '500', fontSize: '12px', color: 'var(--text-secondary)' }}>Account #{index + 1}</span>
                    {bulkOrders.length > 1 && (
                      <button
                        onClick={() => removeBulkOrder(index)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--danger-color)',
                          cursor: 'pointer',
                          fontSize: '16px',
                          padding: '0 4px',
                          lineHeight: '1'
                        }}
                      >
                        x
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 2 }}>
                      <select
                        style={styles.select}
                        value={order.clientId}
                        onChange={(e) => updateBulkOrder(index, 'clientId', e.target.value)}
                      >
                        <option value="">Select client...</option>
                        {availableClients.map(client => {
                          const isCompany = client.profile?.clientType === 'company';
                          const name = isCompany && client.profile?.companyName
                            ? client.profile.companyName
                            : `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || client.username;
                          return (
                            <option key={client._id} value={client._id}>
                              {name}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div style={{ flex: 3 }}>
                      {isLoadingRow ? (
                        <div style={{ padding: '10px', color: 'var(--text-secondary)', fontSize: '13px' }}>Loading...</div>
                      ) : (
                        <select
                          style={styles.select}
                          value={order.bankAccountId}
                          onChange={(e) => updateBulkOrder(index, 'bankAccountId', e.target.value)}
                          disabled={!order.clientId}
                        >
                          <option value="">Select account...</option>
                          {rowAccounts.map(account => (
                            <option key={account._id} value={account._id}>
                              {formatAccountLabel(account)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <input
                        type="number"
                        style={styles.input}
                        value={order.quantity}
                        onChange={(e) => updateBulkOrder(index, 'quantity', e.target.value)}
                        placeholder="Qty"
                        min="0"
                        step="1"
                      />
                    </div>
                  </div>
                  {isDuplicate && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#f59e0b' }}>
                      Duplicate client + account pair
                    </div>
                  )}
                </div>
              );
            })}

            <div
              onClick={addBulkOrder}
              style={{
                padding: '10px',
                textAlign: 'center',
                borderRadius: '6px',
                border: '1px dashed var(--border-color)',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'var(--accent-color)',
                fontWeight: '500',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              + Add Account
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderStep4 = () => {
    const selectedClient = availableClients.find(c => c._id === selectedClientId);
    const selectedAccount = clientBankAccounts.find(a => a._id === selectedBankAccountId);

    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <span style={styles.orderTypeBadge(assetType === ASSET_TYPES.TERM_DEPOSIT && depositAction === 'decrease' ? 'sell' : mode)}>
            {assetType === ASSET_TYPES.TERM_DEPOSIT
              ? (depositAction === 'increase' ? 'INCREASE' : 'DECREASE') + ' TERM DEPOSIT'
              : mode.toUpperCase() + ' ORDER'}
          </span>
        </div>

        {/* Allocation compliance warning */}
        {isCheckingAllocation && (
          <div style={{
            padding: '12px 16px', marginBottom: '16px', borderRadius: '8px',
            background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.3)',
            fontSize: '13px', color: '#6366f1', textAlign: 'center'
          }}>
            Checking investment profile compliance...
          </div>
        )}
        {allocationCheck?.hasProfile && (
          <div style={{
            padding: '14px 16px', marginBottom: '16px', borderRadius: '8px',
            background: allocationCheck.hasBreaches ? 'rgba(245, 158, 11, 0.08)' : 'rgba(99, 102, 241, 0.05)',
            border: `1px solid ${allocationCheck.hasBreaches ? 'rgba(245, 158, 11, 0.3)' : 'rgba(99, 102, 241, 0.15)'}`
          }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: allocationCheck.hasBreaches ? '#f59e0b' : 'var(--text-primary)', marginBottom: '10px' }}>
              {allocationCheck.hasBreaches ? 'Investment Profile Warning' : 'Allocation Impact'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { key: 'cash', label: 'Cash', icon: '💵', color: '#3b82f6' },
                { key: 'bonds', label: 'Bonds', icon: '📄', color: '#10b981' },
                { key: 'equities', label: 'Equities', icon: '📈', color: '#f59e0b' },
                { key: 'alternative', label: 'Alternative', icon: '🎯', color: '#8b5cf6' },
              ].map(item => {
                const current = allocationCheck.currentAllocation?.[item.key] ?? 0;
                const projected = allocationCheck.projectedAllocation?.[item.key] ?? current;
                const limitKey = 'max' + item.key.charAt(0).toUpperCase() + item.key.slice(1);
                const max = allocationCheck.profileLimits?.[limitKey] ?? null;
                const isOverLimit = max !== null && projected > max;
                const isAffected = item.key === allocationCheck.orderCategory;
                const showProjected = isAffected && Math.abs(projected - current) > 0.05;

                return (
                  <div key={item.key} style={{
                    padding: '4px 6px',
                    borderRadius: '6px',
                    background: isAffected ? 'rgba(99, 102, 241, 0.06)' : 'transparent',
                    border: isAffected ? '1px solid rgba(99, 102, 241, 0.15)' : '1px solid transparent'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>{item.icon}</span> {item.label}
                        {isAffected && <span style={{ fontSize: '10px', color: '#6366f1', fontWeight: '600', marginLeft: '4px' }}>affected</span>}
                      </span>
                      <span style={{
                        color: isOverLimit ? '#ef4444' : 'var(--text-primary)',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}>
                        {showProjected ? (
                          <>
                            {current.toFixed(1)}% → <span style={{ color: isOverLimit ? '#ef4444' : item.color }}>{projected.toFixed(1)}%</span>
                          </>
                        ) : (
                          <>{current.toFixed(1)}%</>
                        )}
                        {max !== null && <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}> / {max}%</span>}
                        {isOverLimit && <span style={{ marginLeft: '4px' }}>⚠️</span>}
                      </span>
                    </div>
                    <div style={{
                      position: 'relative',
                      height: '16px',
                      background: 'rgba(128, 128, 128, 0.1)',
                      borderRadius: '8px',
                      overflow: 'hidden'
                    }}>
                      {/* Limit indicator line */}
                      {max !== null && (
                        <div style={{
                          position: 'absolute',
                          left: `${max}%`,
                          top: 0,
                          bottom: 0,
                          width: '2px',
                          background: 'rgba(128, 128, 128, 0.4)',
                          zIndex: 3
                        }} />
                      )}
                      {/* Current allocation bar */}
                      <div style={{
                        position: 'absolute',
                        left: 0, top: 0, bottom: 0,
                        width: `${Math.min(current, 100)}%`,
                        background: isOverLimit
                          ? 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
                          : `linear-gradient(90deg, ${item.color} 0%, ${item.color}dd 100%)`,
                        borderRadius: '8px',
                        transition: 'width 0.3s ease',
                        zIndex: 1
                      }} />
                      {/* Projected extension bar (only for affected category) */}
                      {showProjected && projected > current && (
                        <div style={{
                          position: 'absolute',
                          left: `${Math.min(current, 100)}%`,
                          top: 0, bottom: 0,
                          width: `${Math.min(projected - current, 100 - current)}%`,
                          background: isOverLimit
                            ? 'repeating-linear-gradient(90deg, rgba(239, 68, 68, 0.4) 0px, rgba(239, 68, 68, 0.4) 3px, rgba(239, 68, 68, 0.2) 3px, rgba(239, 68, 68, 0.2) 6px)'
                            : `repeating-linear-gradient(90deg, ${item.color}66 0px, ${item.color}66 3px, ${item.color}33 3px, ${item.color}33 6px)`,
                          borderRadius: '0 8px 8px 0',
                          transition: 'width 0.3s ease',
                          zIndex: 1
                        }} />
                      )}
                      {/* Projected reduction bar (sell orders - show gap) */}
                      {showProjected && projected < current && (
                        <div style={{
                          position: 'absolute',
                          left: `${Math.min(projected, 100)}%`,
                          top: 0, bottom: 0,
                          width: `${Math.min(current - projected, 100)}%`,
                          background: `repeating-linear-gradient(90deg, ${item.color}33 0px, ${item.color}33 3px, transparent 3px, transparent 6px)`,
                          borderRadius: '0 8px 8px 0',
                          transition: 'width 0.3s ease',
                          zIndex: 2
                        }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {allocationCheck.hasBreaches && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '8px' }}>
                  This order can still proceed. The warning will be recorded on the order.
                </div>
                <textarea
                  value={allocationJustification}
                  onChange={e => setAllocationJustification(e.target.value)}
                  placeholder="Justification for exceeding allocation limits..."
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    background: 'rgba(245, 158, 11, 0.04)',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                    resize: 'vertical',
                    outline: 'none',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box'
                  }}
                  onFocus={e => e.target.style.borderColor = 'rgba(245, 158, 11, 0.6)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(245, 158, 11, 0.3)'}
                />
              </div>
            )}
          </div>
        )}

        <div style={styles.reviewSection}>
          <div style={styles.reviewTitle}>
            {assetType === ASSET_TYPES.FX ? 'FX Details' : assetType === ASSET_TYPES.TERM_DEPOSIT ? 'Term Deposit Details' : 'Security Details'}
          </div>
          {assetType === ASSET_TYPES.FX ? (
            <>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Description</span>
                <span style={styles.reviewValue}>FX {fxSubtype === FX_SUBTYPES.FORWARD ? 'Forward' : 'Spot'} {fxBuyCurrency}/{fxSellCurrency}</span>
              </div>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Amount</span>
                <span style={styles.reviewValue}>{parseFloat(quantity).toLocaleString()} {fxAmountCurrency === 'buy' ? fxBuyCurrency : fxSellCurrency}</span>
              </div>
              {fxSpotRate && (
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Indicative Spot</span>
                  <span style={styles.reviewValue}>{fxSpotRate.toFixed(6)}</span>
                </div>
              )}
              {limitPrice && (
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Limit Price</span>
                  <span style={styles.reviewValue}>{limitPrice}</span>
                </div>
              )}
              {stopLossPrice && (
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Stop Loss</span>
                  <span style={styles.reviewValue}>{stopLossPrice}</span>
                </div>
              )}
              {takeProfitPrice && (
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Take Profit</span>
                  <span style={styles.reviewValue}>{takeProfitPrice}</span>
                </div>
              )}
              {fxValueDate && (
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Value Date</span>
                  <span style={styles.reviewValue}>{fxValueDate}</span>
                </div>
              )}
              {fxSubtype === FX_SUBTYPES.FORWARD && fxForwardDate && (
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Forward Date</span>
                  <span style={styles.reviewValue}>{fxForwardDate}</span>
                </div>
              )}
              {fxWarnings.length > 0 && (
                <div style={{ marginTop: '12px', padding: '10px 12px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '6px' }}>
                  {fxWarnings.map((w, i) => (
                    <div key={i} style={{ fontSize: '12px', color: '#f59e0b', marginBottom: i < fxWarnings.length - 1 ? '4px' : 0 }}>
                      ⚠ {w}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : assetType === ASSET_TYPES.TERM_DEPOSIT ? (
            <>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Action</span>
                <span style={{
                  ...styles.reviewValue,
                  fontWeight: '600',
                  color: depositAction === 'increase' ? '#10b981' : '#ef4444'
                }}>
                  {depositAction === 'increase' ? 'Increase' : 'Decrease'}
                </span>
              </div>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Description</span>
                <span style={styles.reviewValue}>Term Deposit {depositCurrency} {TERM_DEPOSIT_TENORS.find(t => t.value === depositTenor)?.label || depositTenor}</span>
              </div>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Currency</span>
                <span style={styles.reviewValue}>{depositCurrency}</span>
              </div>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Tenor</span>
                <span style={styles.reviewValue}>{TERM_DEPOSIT_TENORS.find(t => t.value === depositTenor)?.label || depositTenor}</span>
              </div>
            </>
          ) : (
            <>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Security</span>
                <span style={styles.reviewValue}>{selectedSecurity?.name}</span>
              </div>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>ISIN</span>
                <span style={styles.reviewValue}>{selectedSecurity?.isin}</span>
              </div>
            </>
          )}
          <div style={styles.reviewRow}>
            <span style={styles.reviewLabel}>Asset Type</span>
            <span style={styles.reviewValue}>{OrderFormatters.getAssetTypeLabel(assetType)}</span>
          </div>
          <div style={styles.reviewRow}>
            <span style={styles.reviewLabel}>Currency</span>
            <span style={styles.reviewValue}>{getCurrencyForDisplay()}</span>
          </div>
        </div>

        <div style={styles.reviewSection}>
          <div style={styles.reviewTitle}>Order Details</div>
          {!isBulkMode && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>{assetType === ASSET_TYPES.TERM_DEPOSIT ? 'Amount' : 'Quantity'}</span>
              <span style={styles.reviewValue}>{OrderFormatters.formatQuantity(parseFloat(quantity) || 0)}</span>
            </div>
          )}
          {assetType !== ASSET_TYPES.TERM_DEPOSIT && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Price Type</span>
              <span style={styles.reviewValue}>{OrderFormatters.getPriceTypeLabel(priceType)}</span>
            </div>
          )}
          {(priceType === PRICE_TYPES.STOP_LOSS || priceType === PRICE_TYPES.STOP_LIMIT) && stopPrice && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Stop Price</span>
              <span style={styles.reviewValue}>{OrderFormatters.formatWithCurrency(parseFloat(stopPrice) || 0, getCurrencyForDisplay())}</span>
            </div>
          )}
          {(priceType === PRICE_TYPES.LIMIT || priceType === PRICE_TYPES.STOP_LIMIT) && limitPrice && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Limit Price</span>
              <span style={styles.reviewValue}>{OrderFormatters.formatWithCurrency(parseFloat(limitPrice) || 0, getCurrencyForDisplay())}</span>
            </div>
          )}
          {estimatedValue && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Estimated Value</span>
              <span style={styles.reviewValue}>{OrderFormatters.formatWithCurrency(parseFloat(estimatedValue) || 0, getCurrencyForDisplay())}</span>
            </div>
          )}
          {broker && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Broker / Issuer</span>
              <span style={styles.reviewValue}>{broker}</span>
            </div>
          )}
          {settlementCurrency && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Settlement Currency</span>
              <span style={styles.reviewValue}>{settlementCurrency.toUpperCase()}</span>
            </div>
          )}
          {priceType !== PRICE_TYPES.MARKET && assetType !== ASSET_TYPES.TERM_DEPOSIT && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Validity</span>
              <span style={styles.reviewValue}>
                {validityType === VALIDITY_TYPES.GTC ? 'Good Till Canceled' : validityType === VALIDITY_TYPES.GTD ? `Good Till ${validityDate || 'Date'}` : 'Day Order'}
              </span>
            </div>
          )}
        </div>

        {(attachedTakeProfit || attachedStopLoss) && (
          <div style={styles.reviewSection}>
            <div style={styles.reviewTitle}>Linked Orders</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Separate orders will be created with the same reference number
            </div>
            {attachedTakeProfit && (
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Take Profit</span>
                <span style={{ ...styles.reviewValue, color: '#10b981', fontWeight: '600' }}>
                  {OrderFormatters.formatWithCurrency(parseFloat(attachedTakeProfit), getCurrencyForDisplay())}
                </span>
              </div>
            )}
            {attachedStopLoss && (
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Stop Loss</span>
                <span style={{ ...styles.reviewValue, color: '#ef4444', fontWeight: '600' }}>
                  {OrderFormatters.formatWithCurrency(parseFloat(attachedStopLoss), getCurrencyForDisplay())}
                </span>
              </div>
            )}
          </div>
        )}

        {isBulkMode ? (
          <div style={styles.reviewSection}>
            <div style={styles.reviewTitle}>Accounts ({bulkOrders.filter(o => o.clientId && o.bankAccountId).length})</div>
            {bulkOrders.filter(o => o.clientId && o.bankAccountId).map((order, idx) => {
              const client = availableClients.find(c => c._id === order.clientId);
              const accounts = bulkAccountsMap[bulkOrders.indexOf(order)] || [];
              const account = accounts.find(a => a._id === order.bankAccountId);
              const clientName = client
                ? (client.profile?.clientType === 'company' && client.profile?.companyName
                  ? client.profile.companyName
                  : `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || client.username)
                : 'N/A';
              return (
                <div key={idx} style={{
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)', flex: '0 0 auto' }}>
                    {clientName}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {account ? `${account.bankName} - ${account.accountNumber}` : 'N/A'}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', flex: '0 0 auto' }}>
                    {OrderFormatters.formatQuantity(parseFloat(order.quantity) || 0)}
                  </span>
                </div>
              );
            })}
            <div style={{
              padding: '8px 0', marginTop: '4px',
              display: 'flex', justifyContent: 'space-between',
              fontWeight: '600', fontSize: '13px', color: 'var(--text-primary)'
            }}>
              <span>Total</span>
              <span>{OrderFormatters.formatQuantity(
                bulkOrders.filter(o => o.clientId && o.bankAccountId).reduce((sum, o) => sum + (parseFloat(o.quantity) || 0), 0)
              )}</span>
            </div>
          </div>
        ) : (
          <div style={styles.reviewSection}>
            <div style={styles.reviewTitle}>Account Information</div>
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Client</span>
              <span style={styles.reviewValue}>
                {selectedClient ? `${selectedClient.profile?.firstName} ${selectedClient.profile?.lastName}` : 'N/A'}
              </span>
            </div>
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Bank</span>
              <span style={styles.reviewValue}>{selectedAccount?.bankName || 'N/A'}</span>
            </div>
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Account</span>
              <span style={styles.reviewValue}>{selectedAccount?.accountNumber || 'N/A'}</span>
            </div>
          </div>
        )}

        {notes && (
          <div style={styles.reviewSection}>
            <div style={styles.reviewTitle}>Notes</div>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>{notes}</p>
          </div>
        )}

        {/* Client instruction source in review */}
        {orderSource === ORDER_SOURCE_TYPES.PHONE && (
          <div style={styles.reviewSection}>
            <div style={styles.reviewTitle}>Client Instruction</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '3px 10px', borderRadius: '12px',
                background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6',
                fontSize: '12px', fontWeight: '600'
              }}>
                📞 Phone Order
              </span>
              {phoneCallTime && (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Call at {new Date(phoneCallTime).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )}
        {orderSource === ORDER_SOURCE_TYPES.EMAIL && isBulkMode && clientOrderFiles.length > 0 && (
          <div style={styles.reviewSection}>
            <div style={styles.reviewTitle}>Client Order Emails ({clientOrderFiles.length})</div>
            {clientOrderFiles.map((file, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)', padding: '4px 0' }}>
                <span>📎</span>
                <span>{file.name}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  ({(file.size / 1024).toFixed(0)} KB)
                </span>
              </div>
            ))}
          </div>
        )}
        {orderSource === ORDER_SOURCE_TYPES.EMAIL && !isBulkMode && clientOrderFile && (
          <div style={styles.reviewSection}>
            <div style={styles.reviewTitle}>Client Order Email</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <span>📎</span>
              <span>{clientOrderFile.name}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                ({(clientOrderFile.size / 1024).toFixed(0)} KB)
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Step 2: Buy/Sell selection + Security
  const renderStepOrderType = () => {
    const filteredHoldings = accountHoldings.filter(h => {
      if (!holdingSearchQuery) return true;
      const q = holdingSearchQuery.toLowerCase();
      return (h.securityName || '').toLowerCase().includes(q) || (h.isin || '').toLowerCase().includes(q);
    });

    const selectedAccount = clientBankAccounts.find(a => a._id === selectedBankAccountId);

    return (
      <div>
        {/* Buy/Sell Toggle */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Order Type</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { setMode('buy'); setSelectedHolding(null); setSelectedSecurity(null); setSearchQuery(''); setQuantity(''); setSellManualSearch(false); }}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '8px',
                border: `2px solid ${mode === 'buy' ? '#10b981' : 'var(--border-color)'}`,
                background: mode === 'buy' ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-secondary)',
                color: mode === 'buy' ? '#10b981' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '15px',
                transition: 'all 0.2s ease'
              }}
            >
              BUY
            </button>
            <button
              onClick={() => { setMode('sell'); setSelectedHolding(null); setSelectedSecurity(null); setSearchQuery(''); setQuantity(''); setSellManualSearch(false); }}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '8px',
                border: `2px solid ${mode === 'sell' ? '#ef4444' : 'var(--border-color)'}`,
                background: mode === 'sell' ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-secondary)',
                color: mode === 'sell' ? '#ef4444' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '15px',
                transition: 'all 0.2s ease'
              }}
            >
              SELL
            </button>
          </div>
        </div>

        {/* Cash Balance (buy mode) - show all currencies */}
        {mode === 'buy' && (
          <div style={{
            padding: '10px 14px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: cashBalance?.cashPositions?.length > 0 ? '8px' : '0' }}>Cash Available</div>
            {isLoadingCash ? (
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Loading...</span>
            ) : cashBalance?.cashPositions?.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {cashBalance.cashPositions.map((pos, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{pos.currency}</span>
                    <span style={{
                      fontWeight: '600',
                      color: pos.amount >= 0 ? '#10b981' : '#ef4444',
                      fontSize: '13px'
                    }}>
                      {pos.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>N/A</span>
            )}
          </div>
        )}

        {/* Security Selection */}
        {mode === 'sell' && !sellManualSearch && !isBulkMode ? (
          /* SELL: Pick from existing holdings */
          <div style={styles.formGroup}>
            <label style={styles.label}>Select Holding to Sell</label>
            {selectedHolding || selectedSecurity ? (
              <div style={styles.selectedSecurity}>
                <div>
                  <div style={{ fontWeight: '500' }}>{selectedHolding?.securityName || selectedSecurity?.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {selectedHolding?.isin || selectedSecurity?.isin}
                    {selectedHolding ? ` | Qty: ${selectedHolding.quantity?.toLocaleString()}` : ''}
                    {` | ${selectedHolding?.currency || selectedSecurity?.currency || ''}`}
                  </div>
                </div>
                <ActionButton variant="secondary" size="small" onClick={() => {
                  setSelectedHolding(null);
                  setSelectedSecurity(null);
                  setSearchQuery('');
                  setQuantity('');
                  setHoldingSearchQuery('');
                }}>
                  Change
                </ActionButton>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  style={styles.input}
                  value={holdingSearchQuery}
                  onChange={(e) => setHoldingSearchQuery(e.target.value)}
                  placeholder="Search holdings by name or ISIN..."
                  autoFocus
                />
                {isLoadingHoldings ? (
                  <div style={{ padding: '12px', color: 'var(--text-secondary)', fontSize: '13px' }}>Loading holdings...</div>
                ) : filteredHoldings.length === 0 ? (
                  <div style={{ padding: '12px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {accountHoldings.length === 0 ? 'No holdings found for this account' : 'No matching holdings'}
                  </div>
                ) : (
                  <div style={{
                    maxHeight: '240px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    marginTop: '4px'
                  }}>
                    {filteredHoldings.map(holding => (
                      <div
                        key={holding._id}
                        onClick={() => {
                          setSelectedHolding(holding);
                          setSelectedSecurity({
                            isin: holding.isin,
                            name: holding.securityName,
                            currency: holding.currency
                          });
                          setSearchQuery(holding.securityName);
                          setQuantity(String(holding.quantity || ''));
                          setHoldingSearchQuery('');
                          // Set price and currency from holding
                          if (holding.marketPrice) {
                            setIndicativePrice(holding.marketPrice);
                          }
                          setIndicativePriceCurrency(holding.currency || null);
                          setSettlementCurrency(holding.currency || '');
                          setEstimatedValueManuallyEdited(false);
                          // Enrich from Ambervision product (issuer, etc.)
                          if (holding.isin) {
                            enrichFromProduct(holding.isin);
                          }
                          // Auto-detect asset type
                          if (holding.assetClass) {
                            const classMap = { equity: ASSET_TYPES.EQUITY, bond: ASSET_TYPES.BOND, structured_product: ASSET_TYPES.STRUCTURED_PRODUCT, fund: ASSET_TYPES.FUND, etf: ASSET_TYPES.ETF };
                            setAssetType(classMap[holding.assetClass] || ASSET_TYPES.OTHER);
                          }
                        }}
                        style={{
                          padding: '10px 12px',
                          cursor: 'pointer',
                          borderBottom: '1px solid var(--border-color)',
                          transition: 'background 0.15s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ fontWeight: '500', fontSize: '13px' }}>{holding.securityName}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{holding.isin}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            Qty: {holding.quantity?.toLocaleString()} | {holding.currency} {holding.marketValue?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Manual entry link for sell */}
                <div style={{ marginTop: '8px' }}>
                  <span
                    style={{ fontSize: '12px', color: 'var(--accent-color)', cursor: 'pointer' }}
                    onClick={() => setSellManualSearch(true)}
                  >
                    + Holding not listed? Enter manually or search
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* BUY or SELL manual search: security search */
          <div>
            {mode === 'sell' && sellManualSearch && (
              <div style={{ marginBottom: '12px' }}>
                <span
                  style={{ fontSize: '12px', color: 'var(--accent-color)', cursor: 'pointer' }}
                  onClick={() => { setSellManualSearch(false); setSelectedSecurity(null); setSearchQuery(''); }}
                >
                  ← Back to holdings list
                </span>
              </div>
            )}
            {renderStep1()}
          </div>
        )}
      </div>
    );
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1: return renderStep3(); // Account selection
      case 2: return renderStepOrderType(); // Buy/Sell + Security
      case 3: return renderStep2(); // Details
      case 4: return renderStep4(); // Review
      default: return null;
    }
  };

  const footer = (
    <>
      {currentStep > 1 && (
        <ActionButton variant="secondary" onClick={handleBack} disabled={isSubmitting}>
          Back
        </ActionButton>
      )}
      <div style={{ flex: 1 }} />
      <ActionButton variant="secondary" onClick={handleClose} disabled={isSubmitting}>
        Cancel
      </ActionButton>
      {currentStep < 4 ? (
        <ActionButton variant="primary" onClick={handleNext}>
          Continue
        </ActionButton>
      ) : (
        <ActionButton
          variant={(assetType === ASSET_TYPES.TERM_DEPOSIT ? depositAction === 'increase' : mode === 'buy') ? 'success' : 'danger'}
          onClick={handleSubmit}
          loading={isSubmitting}
        >
          {isSubmitting ? 'Creating...' : isBulkMode
            ? `Confirm ${bulkOrders.filter(o => o.clientId && o.bankAccountId).length} Orders`
            : `Confirm ${assetType === ASSET_TYPES.TERM_DEPOSIT ? (depositAction === 'increase' ? 'INCREASE' : 'DECREASE') : mode.toUpperCase()}`}
        </ActionButton>
      )}
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isBulkMode ? (currentStep >= 2 ? `Bulk ${mode === 'buy' ? 'Buy' : 'Sell'} Order` : 'Bulk Order') : (currentStep >= 2 ? `${mode === 'buy' ? 'Buy' : 'Sell'} Order` : 'New Order')}
      size={isBulkMode ? 'large' : 'medium'}
      footer={footer}
    >
      {renderStepIndicator()}

      {error && (
        <div style={styles.error}>{error}</div>
      )}

      {renderCurrentStep()}

      {showCloseConfirm && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '12px',
          zIndex: 10
        }}>
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '1.5rem',
            maxWidth: '360px',
            width: '90%',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Discard order?</div>
            <p style={{ color: 'var(--text-secondary)', margin: '0 0 1.25rem 0', fontSize: '0.9rem' }}>
              You have unsaved changes. Are you sure you want to close this form?
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <ActionButton variant="secondary" onClick={() => setShowCloseConfirm(false)}>
                Continue editing
              </ActionButton>
              <ActionButton variant="danger" onClick={confirmClose}>
                Discard
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default OrderModal;
