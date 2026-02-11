import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import Modal from './common/Modal.jsx';
import ActionButton from './common/ActionButton.jsx';
import { ASSET_TYPES, PRICE_TYPES, TRADE_MODES, OrderFormatters } from '/imports/api/orders';

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

  // Step 2: Order Details
  const [quantity, setQuantity] = useState('');
  const [priceType, setPriceType] = useState(PRICE_TYPES.MARKET);
  const [limitPrice, setLimitPrice] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [notes, setNotes] = useState('');
  const [broker, setBroker] = useState('');
  const [settlementCurrency, setSettlementCurrency] = useState('');
  const [underlyings, setUnderlyings] = useState('');

  // Step 3: Account Selection
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [clientBankAccounts, setClientBankAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [availableClients, setAvailableClients] = useState([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);

  // Bulk mode state
  const [bulkOrders, setBulkOrders] = useState([{ clientId: '', bankAccountId: '', quantity: '', estimatedValue: '' }]);

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
    }
  }, [prefillData, isOpen, mode]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(1);
      setError(null);
      setSearchQuery('');
      setSearchResults([]);
      setSelectedSecurity(null);
      setAssetType(ASSET_TYPES.EQUITY);
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
  };

  const clearSecuritySelection = () => {
    setSelectedSecurity(null);
    setSearchQuery('');
    setSearchResults([]);
  };

  const validateStep = (step) => {
    setError(null);

    switch (step) {
      case 1: // Security
        if (!selectedSecurity || !selectedSecurity.isin) {
          setError('Please select a security with a valid ISIN');
          return false;
        }
        return true;

      case 2: // Order Details
        if (!quantity || parseFloat(quantity) <= 0) {
          setError('Please enter a valid quantity');
          return false;
        }
        if (priceType === PRICE_TYPES.LIMIT && (!limitPrice || parseFloat(limitPrice) <= 0)) {
          setError('Please enter a valid limit price');
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
              orderItem.sourceHoldingId = prefillData.holdingId;
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
        // Note: Match.Maybe accepts undefined but NOT null, so we use undefined for optional fields
        const orderData = {
          orderType: mode,
          isin: selectedSecurity.isin,
          securityName: selectedSecurity.name || selectedSecurity.ticker,
          assetType,
          currency: selectedSecurity.currency || 'USD',
          quantity: parseFloat(quantity),
          priceType,
          clientId: selectedClientId,
          bankAccountId: selectedBankAccountId
        };

        // Add optional fields only if they have values (undefined is accepted by Match.Maybe, null is not)
        if (priceType === PRICE_TYPES.LIMIT && limitPrice) {
          orderData.limitPrice = parseFloat(limitPrice);
        }
        if (estimatedValue) {
          orderData.estimatedValue = parseFloat(estimatedValue);
        }
        if (selectedAccount?.accountNumber) {
          orderData.portfolioCode = selectedAccount.accountNumber;
        }
        if (mode === 'sell' && prefillData?.holdingId) {
          orderData.sourceHoldingId = prefillData.holdingId;
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
        orderData.tradeMode = TRADE_MODES.INDIVIDUAL;

        const result = await Meteor.callAsync('orders.create', {
          orderData,
          sessionId
        });

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
        ) : (
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
          </div>
        )}
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Asset Type</label>
        <select
          style={styles.select}
          value={assetType}
          onChange={(e) => setAssetType(e.target.value)}
        >
          <option value={ASSET_TYPES.EQUITY}>Equity</option>
          <option value={ASSET_TYPES.BOND}>Bond</option>
          <option value={ASSET_TYPES.STRUCTURED_PRODUCT}>Structured Product</option>
          <option value={ASSET_TYPES.FUND}>Fund</option>
          <option value={ASSET_TYPES.ETF}>ETF</option>
          <option value={ASSET_TYPES.FX}>FX</option>
          <option value={ASSET_TYPES.OTHER}>Other</option>
        </select>
      </div>

      {/* Manual ISIN entry if no security found */}
      {!selectedSecurity && searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
        <div style={{ ...styles.formGroup, background: 'var(--bg-secondary)', padding: '12px', borderRadius: '6px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Security not found? Enter details manually:
          </div>
          <div style={styles.row}>
            <div style={styles.col}>
              <label style={styles.label}>ISIN</label>
              <input
                type="text"
                style={styles.input}
                placeholder="Enter ISIN"
                onChange={(e) => {
                  if (e.target.value.length >= 12) {
                    setSelectedSecurity({
                      isin: e.target.value.toUpperCase(),
                      name: searchQuery,
                      currency: 'USD'
                    });
                  }
                }}
              />
            </div>
            <div style={styles.col}>
              <label style={styles.label}>Currency</label>
              <select
                style={styles.select}
                onChange={(e) => {
                  if (selectedSecurity) {
                    setSelectedSecurity({ ...selectedSecurity, currency: e.target.value });
                  }
                }}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CHF">CHF</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderStep2 = () => (
    <div>
      <div style={styles.row}>
        <div style={styles.col}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Quantity {mode === 'sell' && prefillData?.quantity && `(Max: ${prefillData.quantity})`}</label>
            <input
              type="number"
              style={styles.input}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Enter quantity"
              min="0"
              step="1"
            />
          </div>
        </div>
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
      </div>

      {priceType === PRICE_TYPES.LIMIT && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Limit Price ({selectedSecurity?.currency || 'USD'})</label>
          <input
            type="number"
            style={styles.input}
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            placeholder="Enter limit price"
            min="0"
            step="0.01"
          />
        </div>
      )}

      <div style={styles.formGroup}>
        <label style={styles.label}>Estimated Value ({selectedSecurity?.currency || 'USD'}) - Optional</label>
        <input
          type="number"
          style={styles.input}
          value={estimatedValue}
          onChange={(e) => setEstimatedValue(e.target.value)}
          placeholder="Enter estimated value"
          min="0"
          step="0.01"
        />
      </div>

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

      <div style={styles.formGroup}>
        <label style={styles.label}>Notes (Optional)</label>
        <textarea
          style={styles.textarea}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add any special instructions or notes..."
        />
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
          <span style={styles.orderTypeBadge(mode)}>{mode.toUpperCase()} ORDER</span>
        </div>

        <div style={styles.reviewSection}>
          <div style={styles.reviewTitle}>Security Details</div>
          <div style={styles.reviewRow}>
            <span style={styles.reviewLabel}>Security</span>
            <span style={styles.reviewValue}>{selectedSecurity?.name}</span>
          </div>
          <div style={styles.reviewRow}>
            <span style={styles.reviewLabel}>ISIN</span>
            <span style={styles.reviewValue}>{selectedSecurity?.isin}</span>
          </div>
          <div style={styles.reviewRow}>
            <span style={styles.reviewLabel}>Asset Type</span>
            <span style={styles.reviewValue}>{OrderFormatters.getAssetTypeLabel(assetType)}</span>
          </div>
          <div style={styles.reviewRow}>
            <span style={styles.reviewLabel}>Currency</span>
            <span style={styles.reviewValue}>{selectedSecurity?.currency || 'USD'}</span>
          </div>
        </div>

        <div style={styles.reviewSection}>
          <div style={styles.reviewTitle}>Order Details</div>
          <div style={styles.reviewRow}>
            <span style={styles.reviewLabel}>Quantity</span>
            <span style={styles.reviewValue}>{OrderFormatters.formatQuantity(parseFloat(quantity) || 0)}</span>
          </div>
          <div style={styles.reviewRow}>
            <span style={styles.reviewLabel}>Price Type</span>
            <span style={styles.reviewValue}>{priceType === PRICE_TYPES.MARKET ? 'Market' : 'Limit'}</span>
          </div>
          {priceType === PRICE_TYPES.LIMIT && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Limit Price</span>
              <span style={styles.reviewValue}>{OrderFormatters.formatWithCurrency(parseFloat(limitPrice) || 0, selectedSecurity?.currency || 'USD')}</span>
            </div>
          )}
          {estimatedValue && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Estimated Value</span>
              <span style={styles.reviewValue}>{OrderFormatters.formatWithCurrency(parseFloat(estimatedValue) || 0, selectedSecurity?.currency || 'USD')}</span>
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
          variant={mode === 'buy' ? 'success' : 'danger'}
          onClick={handleSubmit}
          loading={isSubmitting}
        >
          {isSubmitting ? 'Creating...' : `Confirm ${mode.toUpperCase()}`}
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
