import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import Modal from './common/Modal.jsx';
import ActionButton from './common/ActionButton.jsx';
import { ASSET_TYPES, PRICE_TYPES, TRADE_MODES, FX_SUBTYPES, TERM_DEPOSIT_TENORS, EMAIL_TRACE_TYPES, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, OrderFormatters } from '/imports/api/orders';

const FX_CURRENCIES = [
  'USD', 'EUR', 'CHF', 'GBP', 'JPY', 'ILS',
  'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK',
  'SGD', 'HKD', 'CNH', 'ZAR', 'TRY', 'MXN', 'BRL'
];

/**
 * OrderModal - Multi-step wizard for creating buy/sell orders
 *
 * Steps:
 * 1. Security - Search and select security (or pre-filled from PMS)
 * 2. Order Details - Quantity, price type, limit price
 * 3. Account Selection - Select client and bank account (or pre-filled)
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
  mode = 'buy',
  prefillData = null,
  clients = [],
  onOrderCreated,
  user,
  bulkMode = false
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

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

  // FX-specific
  const [fxSubtype, setFxSubtype] = useState(FX_SUBTYPES.SPOT);
  const [fxBuyCurrency, setFxBuyCurrency] = useState('');
  const [fxSellCurrency, setFxSellCurrency] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [fxForwardDate, setFxForwardDate] = useState('');
  const [fxValueDate, setFxValueDate] = useState('');
  const [fxAmountCurrency, setFxAmountCurrency] = useState('buy'); // 'buy' or 'sell'
  const [stopLossPrice, setStopLossPrice] = useState('');
  const [takeProfitPrice, setTakeProfitPrice] = useState('');

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
  const [bulkOrders, setBulkOrders] = useState([{ clientId: '', bankAccountId: '', quantity: '', estimatedValue: '' }]);

  // Client order email attachment
  const [clientOrderFile, setClientOrderFile] = useState(null);

  const searchTimeoutRef = useRef(null);
  const getSessionId = () => localStorage.getItem('sessionId');

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
        const isPercentage = prefillData?.priceType === 'percentage';
        const value = isPercentage ? qty * price / 100 : qty * price;
        setEstimatedValue(value.toFixed(2));
      }
    } else if (prefillData?.marketPrice && prefillData.marketPrice > 0) {
      const isPercentage = prefillData?.priceType === 'percentage';
      const value = isPercentage ? qty * prefillData.marketPrice : qty * prefillData.marketPrice;
      setEstimatedValue(value.toFixed(2));
    }
  }, [quantity, priceType, limitPrice, prefillData, estimatedValueManuallyEdited]);

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
      setEstimatedValue('');
      setNotes('');
      setBroker('');
      setSettlementCurrency('');
      setUnderlyings('');
      setSelectedClientId('');
      setSelectedBankAccountId('');
      setClientBankAccounts([]);
      setBulkOrders([{ clientId: '', bankAccountId: '', quantity: '', estimatedValue: '' }]);
      setEstimatedValueManuallyEdited(false);
      // Reset FX fields
      setFxSubtype(FX_SUBTYPES.SPOT);
      setFxBuyCurrency('');
      setFxSellCurrency('');
      setFxRate('');
      setFxForwardDate('');
      setFxValueDate('');
      setFxAmountCurrency('buy');
      setStopLossPrice('');
      setTakeProfitPrice('');
      // Reset Term Deposit fields
      setDepositTenor('');
      setDepositCurrency('EUR');
      setDepositAction('increase');
      // Reset client order attachment
      setClientOrderFile(null);
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
        const results = await Meteor.callAsync('securities.search', { query: searchQuery, limit: 15 }, sessionId);
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
  }, [searchQuery, selectedSecurity]);

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

    // Auto-fill Step 2 fields from product data (structured products from Ambervision)
    if (security.source === 'product') {
      if (security.issuer) setBroker(security.issuer);
      if (security.currency) setSettlementCurrency(security.currency);
      if (security.underlyings) setUnderlyings(security.underlyings);
      if (security.denomination) setQuantity(String(security.denomination));
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
      case 1: // Security
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

      case 2: // Order Details
        if (!quantity || parseFloat(quantity) <= 0) {
          setError(assetType === ASSET_TYPES.FX ? 'Please enter a valid amount' : assetType === ASSET_TYPES.TERM_DEPOSIT ? 'Please enter a valid amount' : 'Please enter a valid quantity');
          return false;
        }
        if (assetType !== ASSET_TYPES.FX && priceType !== PRICE_TYPES.MARKET && (!limitPrice || parseFloat(limitPrice) <= 0)) {
          setError(`Please enter a valid ${OrderFormatters.getPriceTypeLabel(priceType).toLowerCase()} price`);
          return false;
        }
        return true;

      case 3: // Account Selection
        if (bulkMode) {
          const validOrders = bulkOrders.filter(o => o.clientId && o.bankAccountId && o.quantity);
          if (validOrders.length === 0) {
            setError('Please add at least one order with client, account, and quantity');
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

      default:
        return true;
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, 4));
    }
  };

  const handleBack = () => {
    setError(null);
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    if (!validateStep(3)) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const sessionId = getSessionId();
      const selectedAccount = clientBankAccounts.find(a => a._id === selectedBankAccountId);

      if (bulkMode) {
        // Create bulk orders
        // Note: Match.Maybe accepts undefined but NOT null, so we build objects conditionally
        const validOrders = bulkOrders.filter(o => o.clientId && o.bankAccountId && o.quantity);

        const bulkOrderData = {
          orderType: mode,
          isin: selectedSecurity.isin,
          securityName: selectedSecurity.name || selectedSecurity.ticker,
          assetType,
          currency: selectedSecurity.currency || 'USD',
          priceType,
          orders: validOrders.map(o => {
            const orderItem = {
              clientId: o.clientId,
              bankAccountId: o.bankAccountId,
              quantity: parseFloat(o.quantity)
            };
            if (o.estimatedValue) {
              orderItem.estimatedValue = parseFloat(o.estimatedValue);
            }
            if (mode === 'sell' && prefillData?.holdingId) {
              orderItem.sourceHoldingId = String(prefillData.holdingId);
            }
            if (o.portfolioCode) {
              orderItem.portfolioCode = o.portfolioCode;
            }
            return orderItem;
          })
        };

        // Add optional fields only if they have values
        if (priceType === PRICE_TYPES.LIMIT && limitPrice) {
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

        const result = await Meteor.callAsync('orders.createBulk', {
          bulkOrderData,
          sessionId
        });

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
        if (priceType !== PRICE_TYPES.MARKET && limitPrice) {
          orderData.limitPrice = parseFloat(limitPrice);
        }
        if (estimatedValue) {
          orderData.estimatedValue = parseFloat(estimatedValue);
        }
        if (selectedAccount?.accountNumber) {
          orderData.portfolioCode = selectedAccount.accountNumber;
        }
        if (mode === 'sell' && prefillData?.holdingId) {
          orderData.sourceHoldingId = String(prefillData.holdingId);
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
          if (stopLossPrice) orderData.stopLossPrice = parseFloat(stopLossPrice);
          if (takeProfitPrice) orderData.takeProfitPrice = parseFloat(takeProfitPrice);
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
        orderData.tradeMode = TRADE_MODES.INDIVIDUAL;

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
    setBulkOrders([...bulkOrders, { clientId: '', bankAccountId: '', quantity: '', estimatedValue: '' }]);
  };

  const removeBulkOrder = (index) => {
    if (bulkOrders.length > 1) {
      setBulkOrders(bulkOrders.filter((_, i) => i !== index));
    }
  };

  const updateBulkOrder = (index, field, value) => {
    const updated = [...bulkOrders];
    updated[index][field] = value;
    setBulkOrders(updated);
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

  const steps = ['Security', 'Details', 'Account', 'Review'];

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
              <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}>
                Loading...
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
                    <div style={{ fontWeight: '500' }}>{result.name || result.ticker}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {result.isin} {result.exchange && `| ${result.exchange}`} {result.currency && `| ${result.currency}`}
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

          {/* Pair display */}
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
            {mode === 'buy' ? 'Buy' : 'Sell'} <strong>{fxBuyCurrency}/{fxSellCurrency}</strong>
            {fxSubtype === FX_SUBTYPES.FORWARD ? ' Forward' : ' Spot'}
            {quantity ? ` — ${parseFloat(quantity).toLocaleString()} ${fxAmountCurrency === 'buy' ? fxBuyCurrency : fxSellCurrency}` : ''}
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
          {/* Non-FX: standard quantity + price type */}
          <div style={styles.row}>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  {assetType === ASSET_TYPES.TERM_DEPOSIT ? 'Amount' : 'Quantity'}
                  {mode === 'sell' && prefillData?.quantity && ` (Max: ${prefillData.quantity})`}
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
            {assetType !== ASSET_TYPES.TERM_DEPOSIT && (
              <div style={styles.col}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Price Type</label>
                  <select
                    style={styles.select}
                    value={priceType}
                    onChange={(e) => setPriceType(e.target.value)}
                  >
                    <option value={PRICE_TYPES.MARKET}>Market</option>
                    <option value={PRICE_TYPES.LIMIT}>Limit</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {priceType !== PRICE_TYPES.MARKET && assetType !== ASSET_TYPES.TERM_DEPOSIT && (
            <div style={styles.formGroup}>
              <label style={styles.label}>{OrderFormatters.getPriceTypeLabel(priceType)} Price ({getCurrencyForDisplay()})</label>
              <input
                type="number"
                style={styles.input}
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder={`Enter ${OrderFormatters.getPriceTypeLabel(priceType).toLowerCase()} price`}
                min="0"
                step="0.01"
              />
            </div>
          )}
        </>
      )}

      {assetType !== ASSET_TYPES.TERM_DEPOSIT && assetType !== ASSET_TYPES.FX && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Estimated Value ({getCurrencyForDisplay()}){prefillData?.marketPrice ? '' : ' - Optional'}</label>
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

          <div style={styles.formGroup}>
            <label style={styles.label}>Underlyings (Optional)</label>
            <input
              type="text"
              style={styles.input}
              value={underlyings}
              onChange={(e) => setUnderlyings(e.target.value)}
              placeholder="e.g. TSLA/AAPL/MSFT"
            />
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

      {/* Client Order Email Attachment */}
      <div style={styles.formGroup}>
        <label style={styles.label}>Client Order Email (Optional)</label>
        <div
          style={{
            border: clientOrderFile ? '2px solid #10b981' : '2px dashed var(--border-color)',
            borderRadius: '8px',
            padding: '16px',
            textAlign: 'center',
            cursor: 'pointer',
            background: clientOrderFile ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-secondary)',
            transition: 'border-color 0.15s, background 0.15s'
          }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const file = e.dataTransfer.files[0];
            if (file) {
              const ext = '.' + file.name.split('.').pop().toLowerCase();
              if (!EMAIL_TRACE_ACCEPTED_TYPES.includes(ext)) {
                setError(`File type ${ext} not accepted. Use: ${EMAIL_TRACE_ACCEPTED_TYPES.join(', ')}`);
                return;
              }
              if (file.size > EMAIL_TRACE_MAX_SIZE) {
                setError('File exceeds maximum size of 15MB');
                return;
              }
              setClientOrderFile(file);
              setError(null);
            }
          }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = EMAIL_TRACE_ACCEPTED_TYPES.join(',');
            input.onchange = (e) => {
              const file = e.target.files[0];
              if (file) {
                if (file.size > EMAIL_TRACE_MAX_SIZE) {
                  setError('File exceeds maximum size of 15MB');
                  return;
                }
                setClientOrderFile(file);
                setError(null);
              }
            };
            input.click();
          }}
        >
          {clientOrderFile ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>📎</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#10b981' }}>{clientOrderFile.name}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                ({(clientOrderFile.size / 1024).toFixed(0)} KB)
              </span>
              <button
                style={{
                  background: 'none', border: 'none', color: '#ef4444',
                  cursor: 'pointer', fontSize: '14px', padding: '2px 6px'
                }}
                onClick={(e) => { e.stopPropagation(); setClientOrderFile(null); }}
                title="Remove file"
              >
                ✕
              </button>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Drop client order email here, or click to browse
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                .msg, .eml, .pdf — Visible to validators for four-eyes check
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div>
      {!bulkMode ? (
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
                {availableClients.map(client => (
                  <option key={client._id} value={client._id}>
                    {client.profile?.firstName} {client.profile?.lastName} ({client.username})
                  </option>
                ))}
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
                  <option key={account._id} value={account._id}>
                    {account.bankName} - {account.accountNumber} ({account.referenceCurrency})
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      ) : (
        /* Bulk Mode */
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontWeight: '500' }}>Orders ({bulkOrders.length})</span>
            <ActionButton variant="secondary" size="small" onClick={addBulkOrder}>
              + Add Order
            </ActionButton>
          </div>

          {bulkOrders.map((order, index) => (
            <div key={index} style={{
              padding: '12px',
              background: 'var(--bg-secondary)',
              borderRadius: '6px',
              marginBottom: '12px',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontWeight: '500', fontSize: '13px' }}>Order #{index + 1}</span>
                {bulkOrders.length > 1 && (
                  <button
                    onClick={() => removeBulkOrder(index)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--danger-color)',
                      cursor: 'pointer',
                      fontSize: '16px'
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              <div style={styles.row}>
                <div style={styles.col}>
                  <select
                    style={styles.select}
                    value={order.clientId}
                    onChange={(e) => updateBulkOrder(index, 'clientId', e.target.value)}
                  >
                    <option value="">Select client...</option>
                    {availableClients.map(client => (
                      <option key={client._id} value={client._id}>
                        {client.profile?.firstName} {client.profile?.lastName}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={styles.col}>
                  <input
                    type="number"
                    style={styles.input}
                    value={order.quantity}
                    onChange={(e) => updateBulkOrder(index, 'quantity', e.target.value)}
                    placeholder="Quantity"
                    min="0"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

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
          <div style={styles.reviewRow}>
            <span style={styles.reviewLabel}>{assetType === ASSET_TYPES.TERM_DEPOSIT ? 'Amount' : 'Quantity'}</span>
            <span style={styles.reviewValue}>{OrderFormatters.formatQuantity(parseFloat(quantity) || 0)}</span>
          </div>
          {assetType !== ASSET_TYPES.TERM_DEPOSIT && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Price Type</span>
              <span style={styles.reviewValue}>{OrderFormatters.getPriceTypeLabel(priceType)}</span>
            </div>
          )}
          {priceType !== PRICE_TYPES.MARKET && assetType !== ASSET_TYPES.TERM_DEPOSIT && limitPrice && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>{OrderFormatters.getPriceTypeLabel(priceType)} Price</span>
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
          {underlyings && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Underlyings</span>
              <span style={styles.reviewValue}>{underlyings}</span>
            </div>
          )}
        </div>

        {!bulkMode && (
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

        {clientOrderFile && (
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

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
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
      <ActionButton variant="secondary" onClick={onClose} disabled={isSubmitting}>
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
          {isSubmitting ? 'Creating...' : `Confirm ${assetType === ASSET_TYPES.TERM_DEPOSIT ? (depositAction === 'increase' ? 'INCREASE' : 'DECREASE') : mode.toUpperCase()}`}
        </ActionButton>
      )}
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${mode === 'buy' ? 'Buy' : 'Sell'} Order`}
      size="medium"
      footer={footer}
    >
      {renderStepIndicator()}

      {error && (
        <div style={styles.error}>{error}</div>
      )}

      {renderCurrentStep()}
    </Modal>
  );
};

export default OrderModal;
