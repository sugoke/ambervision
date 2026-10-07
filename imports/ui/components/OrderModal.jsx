import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { Random } from 'meteor/random';
import Modal from './common/Modal.jsx';
import ActionButton from './common/ActionButton.jsx';
import { ASSET_TYPES, PRICE_TYPES, TRADE_MODES, FX_SUBTYPES, VALIDITY_TYPES, TERM_DEPOSIT_TENORS, EMAIL_TRACE_TYPES, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, ORDER_SOURCE_TYPES, EXECUTION_TYPES, EXECUTION_TYPE_LABELS, FUND_QUANTITY_MODES, OPTION_TYPES, DEFAULT_OPTION_CONTRACT_SIZE, OrderFormatters, assetTypeForAssetClass, quotesPriceAsPercent, computeShortCallCoverage } from '/imports/api/orders';
import { IssuersCollection } from '/imports/api/issuers';
import FormattedNumberInput from './FormattedNumberInput.jsx';
import { getAuthorizedEmails, accountAllowsOrders } from '/imports/api/bankAccounts';
import AccountAutocomplete from './AccountAutocomplete.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useGraphConnection } from '../hooks/useGraphConnection.js';
import MailPickerModal from './MailPickerModal.jsx';

// Main tradable currencies, ordered by importance. Used for every currency
// dropdown in the new-order flow (FX legs, deposit, settlement, manual entry).
const MAIN_CURRENCIES = [
  'USD', 'EUR', 'CHF', 'GBP', 'JPY', 'ILS', 'CAD', 'AUD', 'NZD', 'SEK'
];

/**
 * Read a File into a creation attachment ({ traceType, fileName, base64Data, mimeType }).
 * Order evidence is sent inside the create call rather than uploaded afterwards, so an
 * order is never queued for four-eyes validation without the email it came from.
 */
const readAttachment = (file, traceType, defaultMimeType = 'application/octet-stream') =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      traceType,
      fileName: file.name,
      base64Data: reader.result.split(',')[1],
      mimeType: file.type || defaultMimeType
    });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });

/**
 * One row of a multi-account order. Each client carries their own instruction:
 * `traceFileKey` points into the modal's file registry (so two accounts of the
 * same owner can share one email), and the phone fields override the block
 * defaults when the instruction came by phone.
 */
const emptyBulkRow = () => ({
  clientId: '', bankAccountId: '', quantity: '', accountLabel: '',
  traceFileKey: null, phoneCallTime: '', phoneCallLine: ''
});

// Resolve a clientId to its row in the client list. An order may be filed under
// a legacy user id that has since been absorbed by a client entity, so the row's
// linkedClientIds are matched too - otherwise those orders render as "N/A".
const findClientById = (clients, clientId) => {
  if (!clientId) return undefined;
  return clients.find(c => c._id === clientId)
    || clients.find(c => Array.isArray(c.linkedClientIds) && c.linkedClientIds.includes(clientId));
};

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

  const isMobile = useIsMobile();
  const graphConnection = useGraphConnection();
  // 'single' | 'bulk' | 'issuer' — the order does not exist yet here, so the picker runs in
  // file mode and hands back a File for the existing attachment state.
  const [outlookPicker, setOutlookPicker] = useState(null);

  /**
   * Collapse a multi-column form grid to a single column on a phone. Two-column
   * groupings of short related fields (a value and its currency) stay side by side
   * when explicitly asked to, since splitting those costs more than it gains.
   */
  const gridCols = (desktop, mobile = '1fr') => (isMobile ? mobile : desktop);

  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Account autocomplete display labels
  const [selectedAccountLabel, setSelectedAccountLabel] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState('');

  // Buy/Sell mode (now selected in step 2)
  const [mode, setMode] = useState(initialMode);

  // Holdings for sell mode
  const [accountHoldings, setAccountHoldings] = useState([]);
  const [isLoadingHoldings, setIsLoadingHoldings] = useState(false);
  const [holdingSearchQuery, setHoldingSearchQuery] = useState('');
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [sellManualSearch, setSellManualSearch] = useState(false);
  // Force-override: allow sell orders without a source holding (used when the bank-side
  // accounting is wrong and the holding does not appear in PMS).
  const [forceWithoutSourceHolding, setForceWithoutSourceHolding] = useState(false);

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
  // For fund orders only: whether `quantity` is a number of units or a
  // nominal cash amount (subscription/redemption value).
  const [fundQuantityMode, setFundQuantityMode] = useState(FUND_QUANTITY_MODES.UNITS);
  const [priceType, setPriceType] = useState(PRICE_TYPES.MARKET);
  const [limitPrice, setLimitPrice] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [notes, setNotes] = useState('');
  const [bankComment, setBankComment] = useState('');
  const [broker, setBroker] = useState('');
  const [issuerId, setIssuerId] = useState('');
  const [termsheetFile, setTermsheetFile] = useState(null);
  // Term sheet already stored against this ISIN's product, if any. Structured
  // products in the system were created from their term sheet, so re-uploading
  // the same PDF to place an order is busywork — the stored copy is offered
  // instead and its bytes are pulled at submit time. { filename, sizeBytes, ... }
  const [productTermsheet, setProductTermsheet] = useState(null);
  const [settlementCurrency, setSettlementCurrency] = useState('');
  const [underlyings, setUnderlyings] = useState('');

  // Subscribe to active issuers (used for the structured-product issuer dropdown)
  const issuersSub = useMemo(() => Meteor.subscribe('issuers'), []);
  const issuers = useTracker(() => {
    if (!issuersSub.ready()) return [];
    return IssuersCollection.find({ active: true }, { sort: { name: 1 } }).fetch();
  }, [issuersSub.ready()]);

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

  // Listed option-specific. The underlying comes from the normal security
  // search (it is a real equity); everything below describes the contract
  // written on it, because there is no option feed to look it up in.
  const [optionType, setOptionType] = useState(OPTION_TYPES.CALL);
  const [optionStrike, setOptionStrike] = useState('');
  const [optionExpiry, setOptionExpiry] = useState('');
  const [optionContractSize, setOptionContractSize] = useState(String(DEFAULT_OPTION_CONTRACT_SIZE));
  const [optionExchange, setOptionExchange] = useState('');
  // The EOD chain for the underlying (US listings only), or {available:false}.
  // When it loads, strike and expiry become pickers and the contract carries
  // its OCC symbol and the end-of-day quote the desk saw.
  const [optionChain, setOptionChain] = useState(null);
  const [isLoadingChain, setIsLoadingChain] = useState(false);
  const [optionManualEntry, setOptionManualEntry] = useState(false);
  const [optionContractSymbol, setOptionContractSymbol] = useState('');
  const [optionQuote, setOptionQuote] = useState(null);
  // Short-call cover. Previewed locally against the holdings already loaded for
  // this account, then confirmed once by the server before the review step so
  // contracts already written by other live orders are counted too.
  const [coverageCheck, setCoverageCheck] = useState(null);
  const [isCheckingCoverage, setIsCheckingCoverage] = useState(false);
  const [coverageJustification, setCoverageJustification] = useState('');

  // Step 3: Account Selection
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [clientBankAccounts, setClientBankAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [availableClients, setAvailableClients] = useState([]);
  const [isLoadingClients, setIsLoadingClients] = useState(false);

  // Bulk mode state
  const [isBulkMode, setIsBulkMode] = useState(bulkMode);
  const [bulkOrders, setBulkOrders] = useState([emptyBulkRow()]);
  const [bulkAccountsMap, setBulkAccountsMap] = useState({});
  const [bulkAccountsLoading, setBulkAccountsLoading] = useState({});
  const [bulkCashBalances, setBulkCashBalances] = useState({});
  // Client instruction files of a multi-account order, keyed so a row references
  // a file by key rather than by position (rows can be removed; keys survive).
  const [bulkTraceFiles, setBulkTraceFiles] = useState({});  // { key: File }

  // Client order email attachment (single mode)
  const [clientOrderFile, setClientOrderFile] = useState(null);
  // Structured products: the order as sent to the issuer, so the validator can
  // check the ticket against what was actually agreed with the counterparty.
  const [issuerOrderFile, setIssuerOrderFile] = useState(null);
  // Creator attests they will attach the client order later (mobile / technical-issue bypass).
  // Validator must then tick a paired attestation in the four-eyes review.
  const [deferAttachment, setDeferAttachment] = useState(false);

  // Order source: email (default) or phone
  const [orderSource, setOrderSource] = useState(ORDER_SOURCE_TYPES.EMAIL);
  // Execution type follows the asset type until the user picks one: a
  // structured product is agreed with the issuer before the ticket is written,
  // so it is pre-executed; everything else still has to be worked.
  const [executionType, setExecutionType] = useState(EXECUTION_TYPES.TO_EXECUTE);
  const [executionTypeTouched, setExecutionTypeTouched] = useState(false);
  const [phoneCallTime, setPhoneCallTime] = useState(() => {
    // Default to current datetime in local format for datetime-local input
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });
  const [phoneCallLine, setPhoneCallLine] = useState(user?.profile?.phoneNumber || '');

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
    if (issuerOrderFile) return true;
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

  // The modal instance is mounted while closed, so the Buy/Sell the caller asked
  // for only arrives on open. An order raised from a position already knows its
  // account: go straight to the order step.
  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode);
    if (prefillData?.clientId && prefillData?.bankAccountId && !bulkMode) {
      setCurrentStep(2);
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
        const raw = result?.success ? result.rates?.[pair] : null;
        const numeric = raw != null && typeof raw === 'object' ? Number(raw.rate ?? raw.value ?? raw.price) : Number(raw);
        setFxSpotRate(Number.isFinite(numeric) ? numeric : null);
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
    const spot = Number(fxSpotRate);
    if (!Number.isFinite(spot)) {
      setFxWarnings([]);
      return;
    }
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
        warnings.push(`Limit (${limit.toFixed(4)}) is above spot (${spot.toFixed(4)}) — for a buy order, limit is typically below spot to get a better entry`);
      } else if (!isBuy && limit < spot * 0.999) {
        warnings.push(`Limit (${limit.toFixed(4)}) is below spot (${spot.toFixed(4)}) — for a sell order, limit is typically above spot to get a better exit`);
      }
    }

    if (sl) {
      if (isBuy && sl > spot) {
        warnings.push(`Stop Loss (${sl.toFixed(4)}) is above spot (${spot.toFixed(4)}) — for a buy order, stop loss should be below spot`);
      } else if (!isBuy && sl < spot) {
        warnings.push(`Stop Loss (${sl.toFixed(4)}) is below spot (${spot.toFixed(4)}) — for a sell order, stop loss should be above spot`);
      }
    }

    if (tp) {
      if (isBuy && tp < spot) {
        warnings.push(`Take Profit (${tp.toFixed(4)}) is below spot (${spot.toFixed(4)}) — for a buy order, take profit should be above spot`);
      } else if (!isBuy && tp > spot) {
        warnings.push(`Take Profit (${tp.toFixed(4)}) is above spot (${spot.toFixed(4)}) — for a sell order, take profit should be below spot`);
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

      // Term deposit direction comes from depositAction, not the buy/sell mode
      if (prefillData.assetType === ASSET_TYPES.TERM_DEPOSIT) {
        setDepositAction(mode === 'sell' ? 'decrease' : 'increase');
      }

      if (prefillData.clientId) {
        setSelectedClientId(prefillData.clientId);
      }
      if (prefillData.bankAccountId) {
        setSelectedBankAccountId(prefillData.bankAccountId);
      }
      if (prefillData.clientName || prefillData.bankName) {
        setSelectedAccountLabel(`${prefillData.clientName || ''} — ${prefillData.bankName || ''} ${prefillData.accountNumber || ''}`.trim());
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

  // Structured product: hide Order Type / Validity, force LIMIT internally, default price to 100%
  useEffect(() => {
    if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT) {
      setPriceType(PRICE_TYPES.LIMIT);
      setLimitPrice(prev => (prev && prev !== '' ? prev : '100'));
      setValidityType(VALIDITY_TYPES.DAY);
      setValidityDate('');
    }
  }, [assetType]);

  // Sum of the nominals typed on the block's rows - the quantity a bulk order
  // trades, where a single order has `quantity`.
  const bulkTotalQuantity = bulkOrders
    .filter(o => o.clientId && o.bankAccountId)
    .reduce((sum, o) => sum + (parseFloat(o.quantity) || 0), 0);

  /**
   * What the order is worth on the numbers currently entered, or null when they
   * do not say. Kept separate from the field's state so it can be offered back
   * after someone has typed over it — see the hint under Estimated Value.
   */
  const computedEstimatedValue = useMemo(() => {
    const qty = isBulkMode ? bulkTotalQuantity : parseFloat(quantity);
    if (!qty || qty <= 0) return null;

    const isOption = assetType === ASSET_TYPES.OPTION;
    // An option premium is quoted per share, so the consideration is
    // premium x contracts x contract size. Without the multiplier 200 contracts
    // at 2.50 reads as 500 instead of 50,000 - and that figure feeds the
    // allocation check, the cash-exceeded test and the order ticket.
    const multiplier = isOption ? (parseFloat(optionContractSize) || DEFAULT_OPTION_CONTRACT_SIZE) : 1;
    // A structured product or bond is quoted as a percentage of par: 750,000
    // nominal at 100.65 is 754,875, not 750,000.
    const isPercentage = quotesPriceAsPercent(assetType);

    if (priceType === PRICE_TYPES.LIMIT) {
      const price = parseFloat(limitPrice);
      if (price && price > 0) {
        return (isPercentage ? qty * price / 100 : qty * price * multiplier).toFixed(2);
      }
      return null;
    }
    if (isOption && optionQuote?.mid > 0) {
      // Market order on a chain contract: the end-of-day mid is the best
      // reference we have for the premium.
      return (qty * optionQuote.mid * multiplier).toFixed(2);
    }
    if (indicativePrice && indicativePrice > 0 && !isOption) {
      // Use indicative price from holding or EOD. Skipped for options: the
      // indicative price is the UNDERLYING's, and pricing a premium at the
      // underlying's level would be wrong by orders of magnitude.
      return (qty * indicativePrice).toFixed(2);
    }
    if (prefillData?.marketPrice && prefillData.marketPrice > 0 && !isOption) {
      return (qty * prefillData.marketPrice).toFixed(2);
    }
    return null;
  }, [quantity, isBulkMode, bulkTotalQuantity, priceType, limitPrice, prefillData, indicativePrice, assetType, optionContractSize, optionQuote]);

  // "Amount to convert": size a units order from an amount in the price's
  // currency (e.g. invest EUR 1,000,000 in a fund ordered in units). Uses the
  // same price as the estimate — the limit when one is set, otherwise the last
  // indicative price — and rounds DOWN so the order never exceeds the amount.
  const [amountToConvert, setAmountToConvert] = useState('');
  const isFundUnits = assetType === ASSET_TYPES.FUND && fundQuantityMode !== FUND_QUANTITY_MODES.NOMINAL;
  const canConvertAmountToUnits = !isBulkMode
    && (isFundUnits || assetType === ASSET_TYPES.EQUITY || assetType === ASSET_TYPES.ETF);
  const conversionPrice = priceType === PRICE_TYPES.LIMIT && parseFloat(limitPrice) > 0
    ? parseFloat(limitPrice)
    : (indicativePrice > 0 ? indicativePrice : (prefillData?.marketPrice > 0 ? prefillData.marketPrice : null));
  const conversionPriceSource = priceType === PRICE_TYPES.LIMIT && parseFloat(limitPrice) > 0 ? 'limit price' : 'last indicative price';
  const unitDecimals = isFundUnits ? 4 : 0; // matches the units field's precision
  const unitsForAmount = (amount) => {
    const amt = parseFloat(amount);
    if (!(amt > 0) || !(conversionPrice > 0)) return null;
    const factor = 10 ** unitDecimals;
    return Math.floor((amt / conversionPrice) * factor) / factor;
  };
  // Re-derive the units when the price moves (limit typed, price loaded)
  useEffect(() => {
    if (!canConvertAmountToUnits || !amountToConvert) return;
    const units = unitsForAmount(amountToConvert);
    if (units !== null) setQuantity(String(units));
  }, [conversionPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the field on the computed value until someone types their own.
  useEffect(() => {
    if (estimatedValueManuallyEdited) return;
    const qty = isBulkMode ? bulkTotalQuantity : parseFloat(quantity);
    if (!qty || qty <= 0) {
      setEstimatedValue('');
      return;
    }
    if (computedEstimatedValue !== null) setEstimatedValue(computedEstimatedValue);
  }, [computedEstimatedValue, estimatedValueManuallyEdited, quantity, isBulkMode, bulkTotalQuantity]);

  // Default the execution type from the asset type, until the desk overrides it.
  useEffect(() => {
    if (executionTypeTouched) return;
    setExecutionType(assetType === ASSET_TYPES.STRUCTURED_PRODUCT
      ? EXECUTION_TYPES.PRE_EXECUTED
      : EXECUTION_TYPES.TO_EXECUTE);
  }, [assetType, executionTypeTouched]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setExecutionType(EXECUTION_TYPES.TO_EXECUTE);
      setExecutionTypeTouched(false);
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
      setCapitalProtected(false);
      setNotes('');
      setBankComment('');
      setBroker('');
      setSettlementCurrency('');
      setUnderlyings('');
      setSelectedClientId('');
      setSelectedBankAccountId('');
      setSelectedAccountLabel('');
      setSelectedEntityId('');
      setClientBankAccounts([]);
      setIsBulkMode(bulkMode);
      setBulkOrders([emptyBulkRow()]);
      setBulkAccountsMap({});
      setBulkAccountsLoading({});
      setBulkTraceFiles({});
      setIssuerOrderFile(null);
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
      // Reset listed option fields
      setOptionType(OPTION_TYPES.CALL);
      setOptionStrike('');
      setOptionExpiry('');
      setOptionContractSize(String(DEFAULT_OPTION_CONTRACT_SIZE));
      setOptionExchange('');
      setOptionChain(null);
      setIsLoadingChain(false);
      setOptionManualEntry(false);
      setOptionContractSymbol('');
      setOptionQuote(null);
      setCoverageCheck(null);
      setIsCheckingCoverage(false);
      setCoverageJustification('');
      // Reset client order attachments
      setClientOrderFile(null);
      setBulkTraceFiles({});
      setDeferAttachment(false);
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
      setForceWithoutSourceHolding(false);
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
        // For an option the search targets its UNDERLYING, which is an
        // ordinary equity. Passing 'option' through would match neither of
        // securities.search's hardcoded buckets, so it would skip the EOD and
        // product sources and return almost nothing.
        const searchAssetType = assetType === ASSET_TYPES.OPTION ? ASSET_TYPES.EQUITY : assetType;
        const results = await Meteor.callAsync('securities.search', { query: searchQuery, limit: 15, assetType: searchAssetType }, sessionId);
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

  // Look up the term sheet already stored against the selected structured
  // product, so a document the app already holds doesn't have to be uploaded
  // again to place an order. Metadata only here; the bytes are fetched on submit.
  useEffect(() => {
    const isin = selectedSecurity?.isin || prefillData?.isin;
    if (!isOpen || assetType !== ASSET_TYPES.STRUCTURED_PRODUCT || mode === 'sell' || !isin) {
      setProductTermsheet(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const found = await Meteor.callAsync('products.getTermSheetByIsin', isin, getSessionId(), false);
        if (!cancelled) setProductTermsheet(found || null);
      } catch (err) {
        // Not being able to look it up just means the desk uploads the PDF.
        console.error('Error looking up stored term sheet:', err);
        if (!cancelled) setProductTermsheet(null);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, assetType, mode, selectedSecurity?.isin, prefillData?.isin]);

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

  // Selling from a PMS position: that position is the source holding. Matched
  // once per opening so "Change" can still clear it.
  const prefillHoldingMatchedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      prefillHoldingMatchedRef.current = false;
      return;
    }
    if (prefillHoldingMatchedRef.current || mode !== 'sell' || !prefillData?.isin) return;
    if (!accountHoldings.length) return;
    prefillHoldingMatchedRef.current = true;
    const holding = accountHoldings.find(h => String(h._id) === prefillData.holdingId)
      || accountHoldings.find(h => h.isin === prefillData.isin);
    if (!holding) return;
    setSelectedHolding(holding);
    setQuantity(String(holding.quantity || ''));
    if (holding.marketPrice) setIndicativePrice(holding.marketPrice);
    setIndicativePriceCurrency(holding.currency || null);
  }, [isOpen, mode, accountHoldings, prefillData]);

  // Reload account data when bank account selection changes
  useEffect(() => {
    if (selectedClientId && selectedBankAccountId) {
      loadAccountData(selectedClientId, selectedBankAccountId);
    } else {
      setAccountHoldings([]);
      setCashBalance(null);
    }
  }, [selectedClientId, selectedBankAccountId]);

  // Load cash balances for all bulk rows when reviewing accounts from Step 2 onward (any mode)
  useEffect(() => {
    if (!isBulkMode || currentStep < 2) return;
    const validOrders = bulkOrders.filter(o => o.clientId && o.bankAccountId);
    validOrders.forEach(async (order) => {
      const key = `${order.clientId}_${order.bankAccountId}`;
      if (bulkCashBalances[key]) return;
      try {
        const sessionId = getSessionId();
        const cash = await Meteor.callAsync('orders.getAccountCashBalance', { clientId: order.clientId, bankAccountId: order.bankAccountId }, sessionId);
        setBulkCashBalances(prev => ({ ...prev, [key]: cash }));
      } catch (err) {
        console.error('Error loading bulk cash balance:', err);
      }
    });
  }, [isBulkMode, currentStep, bulkOrders.map(o => `${o.clientId}_${o.bankAccountId}`).join('|')]);

  // Load holdings for each bulk row (used for the Positions Available panel in bulk sell mode)
  const [bulkAccountHoldings, setBulkAccountHoldings] = useState({});
  useEffect(() => {
    if (!isBulkMode || currentStep < 2 || mode !== 'sell' || assetType === ASSET_TYPES.FX || assetType === ASSET_TYPES.TERM_DEPOSIT) return;
    const validOrders = bulkOrders.filter(o => o.clientId && o.bankAccountId);
    validOrders.forEach(async (order) => {
      const key = `${order.clientId}_${order.bankAccountId}`;
      if (bulkAccountHoldings[key]) return;
      try {
        const sessionId = getSessionId();
        const holdings = await Meteor.callAsync('orders.getAccountHoldings', { clientId: order.clientId, bankAccountId: order.bankAccountId }, sessionId);
        setBulkAccountHoldings(prev => ({ ...prev, [key]: holdings || [] }));
      } catch (err) {
        console.error('Error loading bulk holdings:', err);
      }
    });
  }, [isBulkMode, currentStep, mode, assetType, bulkOrders.map(o => `${o.clientId}_${o.bankAccountId}`).join('|')]);

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

  // Load the option chain whenever the underlying changes on an option order.
  // A typed contract is always allowed; the chain just makes the common case
  // (a US name) a pick instead of a transcription.
  useEffect(() => {
    if (assetType !== ASSET_TYPES.OPTION || !selectedSecurity) {
      setOptionChain(null);
      return;
    }
    let cancelled = false;
    setIsLoadingChain(true);
    setOptionChain(null);
    setOptionContractSymbol('');
    setOptionQuote(null);
    (async () => {
      try {
        const chain = await Meteor.callAsync('orders.getOptionChain', {
          underlyingTicker: selectedSecurity.ticker || undefined,
          underlyingIsin: selectedSecurity.isin || undefined,
          sessionId: getSessionId()
        });
        if (cancelled) return;
        setOptionChain(chain || { available: false, reason: 'No option feed' });
        // Fall back to typing when there is nothing to pick from.
        setOptionManualEntry(!(chain && chain.available));
      } catch (err) {
        if (cancelled) return;
        console.warn('Option chain unavailable:', err.message);
        setOptionChain({ available: false, reason: err.reason || 'Option feed unavailable' });
        setOptionManualEntry(true);
      } finally {
        if (!cancelled) setIsLoadingChain(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assetType, selectedSecurity?.isin, selectedSecurity?.ticker]);

  // Contracts of the loaded chain for the current side + expiry, sorted by strike.
  const chainContractsForExpiry = (expiry, type = optionType) => {
    if (!optionChain?.available || !expiry) return [];
    const e = optionChain.expirations.find(x => x.expirationDate === expiry);
    if (!e) return [];
    return type === OPTION_TYPES.PUT ? e.puts : e.calls;
  };

  // Pick one contract from the chain: strike, symbol, quote and size in one go,
  // so the four can never disagree with each other.
  const applyChainContract = (contract) => {
    if (!contract) {
      setOptionContractSymbol('');
      setOptionQuote(null);
      return;
    }
    setOptionStrike(String(contract.strike));
    setOptionContractSymbol(contract.contractName || '');
    setOptionQuote({
      bid: contract.bid, ask: contract.ask, last: contract.last, mid: contract.mid,
      impliedVolatility: contract.impliedVolatility, delta: contract.delta,
      openInterest: contract.openInterest, updatedAt: contract.updatedAt || null, source: 'eod'
    });
    if (contract.contractSize) setOptionContractSize(String(contract.contractSize));
    if (!optionExchange) setOptionExchange('US');
  };

  // Currency the security is quoted in. Never guessed: when the search result carries no
  // currency (e.g. a metadata-only hit), fall back to the price/settlement currency the
  // form resolved (from the product record), and block the order if none is known.
  const resolveSecurityCurrency = () =>
    selectedSecurity?.currency || indicativePriceCurrency || settlementCurrency || null;

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
        if (product.currency) {
          setSelectedSecurity(prev => (prev && !prev.currency ? { ...prev, currency: product.currency } : prev));
        }
        if (typeof product.capitalProtected === 'boolean') setCapitalProtected(product.capitalProtected);
      }
    } catch (err) {
      console.warn('Could not look up product:', err.message);
    }
  };

  const handleSecuritySelect = (security) => {
    setSelectedSecurity(security);
    setSearchQuery(security.name || security.ticker || security.isin);
    setSearchResults([]);

    // Auto-detect asset type - except for an option, where the security being
    // picked is the UNDERLYING (an equity). Letting it retype the order would
    // turn the option into an equity sell the moment the underlying is chosen,
    // hide the contract block, and bring the position picker back.
    if (security.assetClass && assetType !== ASSET_TYPES.OPTION) {
      setAssetType(assetTypeForAssetClass(security.assetClass));
    }

    // Set currency
    setIndicativePriceCurrency(security.currency || null);
    if (security.currency) setSettlementCurrency(security.currency);

    // Auto-fill from Ambervision product data (structured products)
    if (security.source === 'product') {
      if (security.issuer) setBroker(security.issuer);
      if (security.denomination) setQuantity(String(security.denomination));
      // A known note tells us whether its capital is guaranteed; the toggle
      // stays editable for the cases the record cannot decide.
      if (typeof security.capitalProtected === 'boolean') setCapitalProtected(security.capitalProtected);
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

  // Check if the order exceeds available cash (for buy equity/ETF orders)
  const isCashExceeded = (() => {
    if (mode !== 'buy' || (assetType !== ASSET_TYPES.EQUITY && assetType !== ASSET_TYPES.ETF)) return false;
    if (!cashBalance?.cashPositions?.length) return false;
    const secCurrency = selectedSecurity?.currency || prefillData?.currency || settlementCurrency || '';
    const cashInCurrency = cashBalance.cashPositions.find(p => p.currency === secCurrency);
    if (!cashInCurrency) return false;
    const price = priceType === PRICE_TYPES.LIMIT && limitPrice ? parseFloat(limitPrice) : indicativePrice;
    const qty = parseFloat(quantity) || 0;
    const estCost = qty > 0 && price ? qty * price : 0;
    return estCost > cashInCurrency.amount;
  })();

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
          // A prefilled account bypasses the picker's view-only guard
          const selectedAccount = clientBankAccounts.find(a => a._id === selectedBankAccountId);
          if (selectedAccount && !accountAllowsOrders(selectedAccount)) {
            setError('This account is view only: we have no power of attorney to place orders on it.');
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
          setError(assetType === ASSET_TYPES.OPTION
            ? 'Pick the underlying first: type its name, ISIN or ticker in the Underlying box and choose it from the list. The strike, expiry and contract size appear once it is chosen.'
            : 'Please select a security with a valid ISIN');
          return false;
        }
        if (assetType !== ASSET_TYPES.OPTION && !resolveSecurityCurrency()) {
          setError('The currency of this security is unknown. Please choose the settlement currency.');
          return false;
        }
        if (assetType === ASSET_TYPES.OPTION) {
          if (!optionType) {
            setError('Please choose Call or Put');
            return false;
          }
          if (!optionStrike || parseFloat(optionStrike) <= 0) {
            setError('Please enter a strike price');
            return false;
          }
          if (!optionExpiry) {
            setError('Please enter an expiry date');
            return false;
          }
          // An expiry in the past is always a typo, and the whole order would be
          // meaningless - worth stopping at entry rather than at the bank.
          const expiry = new Date(optionExpiry);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (isNaN(expiry.getTime()) || expiry < today) {
            setError('Expiry must be today or later');
            return false;
          }
          if (!optionContractSize || parseFloat(optionContractSize) <= 0) {
            setError('Please enter the contract size (shares per contract)');
            return false;
          }
        }
        return true;

      case 3: // Order Details
        if (!isBulkMode && (!quantity || parseFloat(quantity) <= 0)) {
          setError(assetType === ASSET_TYPES.FX ? 'Please enter a valid amount'
            : assetType === ASSET_TYPES.TERM_DEPOSIT ? 'Please enter a valid amount'
            : assetType === ASSET_TYPES.OPTION ? 'Please enter the number of contracts'
            : 'Please enter a valid quantity');
          return false;
        }
        // Contracts are indivisible.
        if (!isBulkMode && assetType === ASSET_TYPES.OPTION && !Number.isInteger(parseFloat(quantity))) {
          setError('Contracts must be a whole number');
          return false;
        }
        if (isBulkMode) {
          const validOrders = bulkOrders.filter(o => o.clientId && o.bankAccountId);
          const missingQty = validOrders.filter(o => !o.quantity || parseFloat(o.quantity) <= 0);
          if (missingQty.length > 0) {
            setError('Please enter a valid quantity for each account');
            return false;
          }
        }
        // A limit order must carry its limit. Structured products are the one
        // exception: the price "% of par" is optional and, left empty, the order
        // goes to the bank at market (indicative price) — never as a limit
        // without a limit.
        if (assetType !== ASSET_TYPES.STRUCTURED_PRODUCT
          && priceType === PRICE_TYPES.LIMIT
          && (!limitPrice || parseFloat(limitPrice) <= 0)) {
          setError(assetType === ASSET_TYPES.FX ? 'Please enter the limit rate' : 'Please enter a valid limit price');
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
        if (isCashExceeded && !notes.trim()) {
          setError('Order exceeds available cash. Please add a note justifying this order.');
          return false;
        }
        // Structured product BUY orders require an issuer and a termsheet PDF.
        // Sell orders don't need it again — the termsheet was already attached at purchase
        // and lives on the original buy order / product record.
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT && mode !== 'sell') {
          if (!issuerId) {
            setError('Please select the counterparty for this structured product.');
            return false;
          }
          // A term sheet already on file for this ISIN satisfies the requirement —
          // it is the same document, and it is attached to the order for real
          // below, so the order's evidence trail is identical either way.
          if (!termsheetFile && !productTermsheet) {
            setError('Please attach the termsheet PDF for this structured product.');
            return false;
          }
        }
        // Structured products are agreed with the issuer before the ticket is
        // written: the order sent to the issuer is part of the four-eyes evidence.
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT && !issuerOrderFile) {
          setError('Please attach the order sent to the issuer for this structured product.');
          return false;
        }
        // Client instruction is mandatory (email attachment or phone confirmation).
        // Single-order mode allows a defer-attach attestation when a file can't be
        // attached now (mobile/technical issue); bulk mode still requires real files.
        if (orderSource === ORDER_SOURCE_TYPES.EMAIL) {
          if (isBulkMode) {
            // Every client needs their own instruction on file.
            const missing = validBulkRows()
              .filter(({ row }) => !row.traceFileKey || !bulkTraceFiles[row.traceFileKey])
              .map(({ row }) => bulkRowClientName(row));
            if (missing.length > 0) {
              setError(`Missing client instruction for: ${missing.join(', ')}`);
              return false;
            }
          } else if (!clientOrderFile && !deferAttachment) {
            setError('Please attach the client order email, switch to phone confirmation, or tick "I have the client order and will attach it later"');
            return false;
          }
        } else if (orderSource === ORDER_SOURCE_TYPES.PHONE) {
          if (isBulkMode) {
            const missing = validBulkRows()
              .filter(({ row }) => !rowPhoneCallTime(row))
              .map(({ row }) => bulkRowClientName(row));
            if (missing.length > 0) {
              setError(`Missing call time for: ${missing.join(', ')}`);
              return false;
            }
          } else if (!phoneCallTime) {
            setError('Please enter the phone call date/time');
            return false;
          }
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
              capitalProtected: assetType === ASSET_TYPES.STRUCTURED_PRODUCT && mode === 'buy' ? capitalProtected : undefined,
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

      // Confirm short-call cover with the server on the way to review. The local
      // preview can only see this account's holdings; only the server knows how
      // many contracts other live orders have already written against them.
      if (currentStep === 3 && !isBulkMode
        && assetType === ASSET_TYPES.OPTION
        && optionType === OPTION_TYPES.CALL
        && mode === 'sell'
        && selectedSecurity?.isin && selectedClientId && selectedBankAccountId
        && parseFloat(quantity) > 0) {
        setIsCheckingCoverage(true);
        try {
          const result = await Meteor.callAsync('orders.checkShortCallCoverage', {
            clientId: selectedClientId,
            bankAccountId: selectedBankAccountId,
            underlyingIsin: selectedSecurity.isin,
            underlyingName: selectedSecurity.name || selectedSecurity.ticker || undefined,
            contracts: parseFloat(quantity),
            contractSize: parseFloat(optionContractSize) || DEFAULT_OPTION_CONTRACT_SIZE,
            sessionId: getSessionId()
          });
          setCoverageCheck(result);
        } catch (err) {
          // Cover flags, it never blocks - fall back to the local preview.
          console.error('Coverage check failed:', err);
          setCoverageCheck(null);
        }
        setIsCheckingCoverage(false);
      } else if (currentStep === 3) {
        setCoverageCheck(null);
      }

      setCurrentStep(prev => Math.min(prev + 1, 4));
    }
  };

  const handleBack = () => {
    setError(null);
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  /**
   * The initial-termsheet attachment for a structured-product order: the file
   * the user picked, or the copy already stored against the product. Either way
   * the order gets its own evidence file — the stored copy is fetched, not
   * referenced, so deleting it later can't hollow out the order's trace.
   */
  /** Validate and keep the issuer-order evidence file (same rules as the client instruction). */
  const acceptIssuerOrderFile = (file) => {
    if (!file) return;
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!EMAIL_TRACE_ACCEPTED_TYPES.includes(ext)) {
      setError(`File type ${ext} not accepted. Use: ${EMAIL_TRACE_ACCEPTED_TYPES.join(', ')}`);
      return;
    }
    if (file.size > EMAIL_TRACE_MAX_SIZE) {
      setError(`${file.name} exceeds maximum size of 15MB`);
      return;
    }
    setIssuerOrderFile(file);
    setError(null);
  };

  const buildTermsheetAttachment = async () => {
    if (termsheetFile) {
      return readAttachment(termsheetFile, EMAIL_TRACE_TYPES.INITIAL_TERMSHEET, 'application/pdf');
    }
    if (!productTermsheet) return null;

    const isin = selectedSecurity?.isin || prefillData?.isin;
    const stored = await Meteor.callAsync('products.getTermSheetByIsin', isin, getSessionId(), true);
    if (!stored?.base64Data) {
      throw new Error('The stored term sheet could not be read. Please attach the PDF.');
    }
    return {
      traceType: EMAIL_TRACE_TYPES.INITIAL_TERMSHEET,
      fileName: stored.filename,
      base64Data: stored.base64Data,
      mimeType: 'application/pdf'
    };
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
        } else if (assetType === ASSET_TYPES.OPTION) {
          // A listed contract has no tradeable ISIN, so the order carries the
          // 'OPT' marker and the underlying travels in its own fields.
          bulkIsin = 'OPT';
          bulkSecurityName = buildOptionContractName();
          bulkCurrency = selectedSecurity.currency || 'USD';
        } else {
          bulkIsin = selectedSecurity.isin;
          bulkSecurityName = selectedSecurity.name || selectedSecurity.ticker;
          bulkCurrency = resolveSecurityCurrency();
        }

        // Evidence travels with the create call so no order in the block is queued
        // for validation before its files exist. Only the termsheet is shared by
        // the block; each client's instruction is theirs alone and is referenced
        // by key from their row, so a file covering two accounts travels once.
        const sharedAttachments = [];
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT) {
          const termsheetAttachment = await buildTermsheetAttachment();
          if (termsheetAttachment) sharedAttachments.push(termsheetAttachment);
          // One order to the issuer covers the whole block
          if (issuerOrderFile) sharedAttachments.push(await readAttachment(issuerOrderFile, EMAIL_TRACE_TYPES.ORDER_TO_ISSUER));
        }

        const isPhone = orderSource === ORDER_SOURCE_TYPES.PHONE;
        const referencedKeys = isPhone
          ? []
          : [...new Set(validOrders.map(o => o.traceFileKey).filter(k => k && bulkTraceFiles[k]))];
        const clientOrderFilesPayload = await Promise.all(referencedKeys.map(async (key) => {
          const read = await readAttachment(bulkTraceFiles[key], EMAIL_TRACE_TYPES.CLIENT_ORDER);
          return { key, fileName: read.fileName, base64Data: read.base64Data, mimeType: read.mimeType };
        }));

        const bulkRows = validOrders.map((o) => {
          const rowIdx = bulkOrders.indexOf(o);
          const rowAccounts = bulkAccountsMap[rowIdx] || [];
          const account = rowAccounts.find(a => a._id === o.bankAccountId);
          const orderItem = {
            clientId: o.clientId,
            entityId: o.entityId || null,
            bankAccountId: o.bankAccountId,
            quantity: parseFloat(o.quantity)
          };
          if (account?.accountNumber) {
            orderItem.portfolioCode = account.accountNumber;
          }
          if (isPhone) {
            if (o.phoneCallTime) orderItem.phoneCallTime = o.phoneCallTime;
            if (o.phoneCallLine) orderItem.phoneCallLine = o.phoneCallLine.trim();
          } else if (o.traceFileKey) {
            orderItem.clientOrderFileKey = o.traceFileKey;
          }
          return orderItem;
        });

        const bulkOrderData = {
          orderType: mode,
          isin: bulkIsin,
          securityName: bulkSecurityName,
          assetType,
          currency: bulkCurrency,
          priceType,
          orders: bulkRows
        };

        // Add optional fields only if they have values
        if ((priceType === PRICE_TYPES.LIMIT || priceType === PRICE_TYPES.STOP_LIMIT) && limitPrice) {
          bulkOrderData.limitPrice = parseFloat(limitPrice);
        }
        if ((priceType === PRICE_TYPES.STOP_LOSS || priceType === PRICE_TYPES.STOP_LIMIT) && stopPrice) {
          bulkOrderData.stopPrice = parseFloat(stopPrice);
        }
        // No price on a structured product: at market, not a limit without a limit
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT && !(parseFloat(limitPrice) > 0)) {
          bulkOrderData.priceType = PRICE_TYPES.MARKET;
          delete bulkOrderData.limitPrice;
        }
        // Block consideration; the server prorates it onto each row by nominal
        if (mode === 'buy' && parseFloat(estimatedValue) > 0) {
          bulkOrderData.estimatedValue = parseFloat(estimatedValue);
        }
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT && mode === 'buy' && capitalProtected) {
          bulkOrderData.capitalProtected = true;
        }
        if (notes && notes.trim()) {
          bulkOrderData.notes = notes.trim();
        }
        if (bankComment && bankComment.trim()) {
          bulkOrderData.bankComment = bankComment.trim();
        }
        if (broker && broker.trim()) {
          bulkOrderData.broker = broker.trim();
        }
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT && issuerId) {
          bulkOrderData.issuerId = issuerId;
          const selectedIssuer = issuers.find(i => i._id === issuerId);
          if (selectedIssuer) {
            bulkOrderData.broker = selectedIssuer.name;
          }
        }
        if (settlementCurrency && settlementCurrency.trim()) {
          bulkOrderData.settlementCurrency = settlementCurrency.trim().toUpperCase();
        }
        if (underlyings && underlyings.trim()) {
          bulkOrderData.underlyings = underlyings.trim();
        }
        // Listed option contract
        if (assetType === ASSET_TYPES.OPTION) {
          bulkOrderData.optionType = optionType;
          bulkOrderData.optionStrike = parseFloat(optionStrike);
          bulkOrderData.optionExpiry = optionExpiry;
          bulkOrderData.optionContractSize = parseFloat(optionContractSize) || DEFAULT_OPTION_CONTRACT_SIZE;
          bulkOrderData.optionUnderlyingIsin = selectedSecurity.isin;
          bulkOrderData.optionUnderlyingName = selectedSecurity.name || selectedSecurity.ticker || '';
          if (selectedSecurity.ticker) bulkOrderData.optionUnderlyingTicker = selectedSecurity.ticker;
          if (optionExchange && optionExchange.trim()) bulkOrderData.optionExchange = optionExchange.trim();
          // Only when picked from the chain - a typed contract has neither.
          if (!optionManualEntry && optionContractSymbol) {
            bulkOrderData.optionContractSymbol = optionContractSymbol;
            if (optionQuote) bulkOrderData.optionQuoteAtEntry = optionQuote;
          }
        }

        if (assetType === ASSET_TYPES.FUND) {
          bulkOrderData.fundQuantityMode = fundQuantityMode;
        }

        // Validity for non-market orders (FX limit orders too)
        if (((priceType !== PRICE_TYPES.MARKET) || (assetType === ASSET_TYPES.FX && limitPrice)) && assetType !== ASSET_TYPES.TERM_DEPOSIT) {
          bulkOrderData.validityType = validityType;
          if (validityType === VALIDITY_TYPES.GTD && validityDate) {
            bulkOrderData.validityDate = validityDate;
          }
        }

        // Order source (email or phone)
        bulkOrderData.orderSource = orderSource;
        bulkOrderData.executionType = executionType;
        if (orderSource === ORDER_SOURCE_TYPES.PHONE) {
          if (phoneCallTime) bulkOrderData.phoneCallTime = phoneCallTime;
          if (phoneCallLine) bulkOrderData.phoneCallLine = phoneCallLine.trim();
        }

        const result = await Meteor.callAsync('orders.createBulk', {
          bulkOrderData,
          ...(sharedAttachments.length > 0 ? { attachments: sharedAttachments } : {}),
          ...(clientOrderFilesPayload.length > 0 ? { clientOrderFiles: clientOrderFilesPayload } : {}),
          sessionId
        });

        // Rows can fail individually (rejected attachment, position check, …). That
        // used to pass unnoticed — the modal closed as if the whole block had been
        // created. Report it and stay open; any rows that did succeed are listed.
        if (result?.totalErrors > 0) {
          const failures = (result.errors || []).map(e => (
            `${validOrders[e.index]?.accountLabel || `row ${e.index + 1}`}: ${e.error}`
          ));
          if (result.totalCreated > 0) onOrderCreated?.(result);
          setError(`${result.totalCreated} of ${result.totalCreated + result.totalErrors} orders created. Failed — ${failures.join(' | ')}`);
          return;
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
        } else if (assetType === ASSET_TYPES.OPTION) {
          // A listed contract has no tradeable ISIN, so the order carries the
          // 'OPT' marker and the underlying travels in its own fields.
          orderIsin = 'OPT';
          orderSecurityName = buildOptionContractName();
          orderCurrency = selectedSecurity.currency || 'USD';
        } else {
          orderIsin = selectedSecurity.isin;
          orderSecurityName = selectedSecurity.name || selectedSecurity.ticker;
          orderCurrency = resolveSecurityCurrency();
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
        // No price on a structured product: at market, not a limit without a limit
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT && !(parseFloat(limitPrice) > 0)) {
          orderData.priceType = PRICE_TYPES.MARKET;
          delete orderData.limitPrice;
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
        if (mode === 'sell' && !orderData.sourceHoldingId && forceWithoutSourceHolding) {
          orderData.forceWithoutSourceHolding = true;
        }
        if (notes && notes.trim()) {
          orderData.notes = notes.trim();
        }
        if (bankComment && bankComment.trim()) {
          orderData.bankComment = bankComment.trim();
        }
        if (broker && broker.trim()) {
          orderData.broker = broker.trim();
        }
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT && issuerId) {
          orderData.issuerId = issuerId;
          // Mirror issuer name into broker for display continuity in lists/PDFs
          const selectedIssuer = issuers.find(i => i._id === issuerId);
          if (selectedIssuer) {
            orderData.broker = selectedIssuer.name;
          }
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
          // For FX, the price type follows the rate: a limit rate makes it a
          // limit order, no rate a market order (never a limit without a limit)
          if (parseFloat(limitPrice) > 0) {
            orderData.priceType = PRICE_TYPES.LIMIT;
          } else {
            orderData.priceType = PRICE_TYPES.MARKET;
            delete orderData.limitPrice;
          }
        }
        // Term Deposit-specific fields
        if (assetType === ASSET_TYPES.TERM_DEPOSIT) {
          orderData.depositTenor = depositTenor;
          orderData.depositCurrency = depositCurrency;
          orderData.depositAction = depositAction;
        }
        // Listed option contract
        if (assetType === ASSET_TYPES.OPTION) {
          orderData.optionType = optionType;
          orderData.optionStrike = parseFloat(optionStrike);
          orderData.optionExpiry = optionExpiry;
          orderData.optionContractSize = parseFloat(optionContractSize) || DEFAULT_OPTION_CONTRACT_SIZE;
          orderData.optionUnderlyingIsin = selectedSecurity.isin;
          orderData.optionUnderlyingName = selectedSecurity.name || selectedSecurity.ticker || '';
          if (selectedSecurity.ticker) orderData.optionUnderlyingTicker = selectedSecurity.ticker;
          if (optionExchange && optionExchange.trim()) orderData.optionExchange = optionExchange.trim();
          // Only when picked from the chain - a typed contract has neither.
          if (!optionManualEntry && optionContractSymbol) {
            orderData.optionContractSymbol = optionContractSymbol;
            if (optionQuote) orderData.optionQuoteAtEntry = optionQuote;
          }
        }
        // The desk's reason for writing a call the position doesn't cover.
        // Optional by design - the order is flagged either way and the
        // validator decides.
        if (assetType === ASSET_TYPES.OPTION && coverageJustification && coverageJustification.trim()) {
          orderData.coverageJustification = coverageJustification.trim();
        }
        // Capital protected flag for structured products
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT && mode === 'buy' && capitalProtected) {
          orderData.capitalProtected = true;
        }
        // Fund quantity mode (units vs nominal cash amount)
        if (assetType === ASSET_TYPES.FUND) {
          orderData.fundQuantityMode = fundQuantityMode;
        }
        orderData.tradeMode = TRADE_MODES.INDIVIDUAL;

        // Order source (email or phone)
        orderData.orderSource = orderSource;
        orderData.executionType = executionType;
        if (orderSource === ORDER_SOURCE_TYPES.PHONE) {
          if (phoneCallTime) orderData.phoneCallTime = phoneCallTime;
          if (phoneCallLine) orderData.phoneCallLine = phoneCallLine.trim();
        }
        // Creator opted to attach the client-order trace later (no file at submit time)
        if (orderSource === ORDER_SOURCE_TYPES.EMAIL && deferAttachment && !clientOrderFile) {
          orderData.clientOrderDeferred = true;
        }

        // Add validity for non-market orders (FX limit orders too — FX gates on limitPrice)
        if (((priceType !== PRICE_TYPES.MARKET) || (assetType === ASSET_TYPES.FX && limitPrice)) && assetType !== ASSET_TYPES.TERM_DEPOSIT) {
          orderData.validityType = validityType;
          if (validityType === VALIDITY_TYPES.GTD && validityDate) {
            orderData.validityDate = validityDate;
          }
        }

        // Add attached TP/SL info so server creates linked orders (not on a sale)
        const attachesLegs = mode === 'buy' || assetType === ASSET_TYPES.FX;
        if (attachesLegs && attachedTakeProfit) {
          orderData.attachedTakeProfit = parseFloat(attachedTakeProfit);
        }
        if (attachesLegs && attachedStopLoss) {
          orderData.attachedStopLoss = parseFloat(attachedStopLoss);
        }

        // Add allocation justification if breaches exist
        if (allocationCheck?.hasBreaches && allocationJustification.trim()) {
          orderData.allocationJustification = allocationJustification.trim();
        }

        // Read the evidence first and hand it to orders.create: the order is then
        // inserted with its traces already attached, so it cannot show up for
        // validation (or notify the validators) before its files exist.
        const attachments = [];
        if (clientOrderFile) {
          attachments.push(await readAttachment(clientOrderFile, EMAIL_TRACE_TYPES.CLIENT_ORDER));
        }
        if (assetType === ASSET_TYPES.STRUCTURED_PRODUCT) {
          const termsheetAttachment = await buildTermsheetAttachment();
          if (termsheetAttachment) attachments.push(termsheetAttachment);
          if (issuerOrderFile) attachments.push(await readAttachment(issuerOrderFile, EMAIL_TRACE_TYPES.ORDER_TO_ISSUER));
        }

        const result = await Meteor.callAsync('orders.create', {
          orderData,
          ...(attachments.length > 0 ? { attachments } : {}),
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
    setBulkOrders([...bulkOrders, emptyBulkRow()]);
  };

  // ---- Per-client instruction registry (multi-account orders) ----

  /** Display name of the client on a bulk row, matching the account picker. */
  const bulkRowClientName = (row) => {
    const client = findClientById(availableClients, row.clientId);
    if (!client) return row.accountLabel || 'N/A';
    return client.profile?.clientType === 'company' && client.profile?.companyName
      ? client.profile.companyName
      : `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || client.username;
  };

  /** Rows that name a client and an account, with their original index kept. */
  const validBulkRows = () => bulkOrders
    .map((row, origIdx) => ({ row, origIdx }))
    .filter(({ row }) => row.clientId && row.bankAccountId);

  /** Validate and register files; returns the keys of the ones accepted. */
  const addTraceFiles = (files) => {
    const accepted = [];
    for (const file of files) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!EMAIL_TRACE_ACCEPTED_TYPES.includes(ext)) {
        setError(`File type ${ext} not accepted. Use: ${EMAIL_TRACE_ACCEPTED_TYPES.join(', ')}`);
        return [];
      }
      if (file.size > EMAIL_TRACE_MAX_SIZE) {
        setError(`${file.name} exceeds maximum size of 15MB`);
        return [];
      }
      accepted.push({ key: Random.id(), file });
    }
    if (accepted.length > 0) {
      setBulkTraceFiles(prev => {
        const next = { ...prev };
        accepted.forEach(({ key, file }) => { next[key] = file; });
        return next;
      });
      setError(null);
    }
    return accepted.map(a => a.key);
  };

  const assignTraceFile = (origIdx, key) => {
    setBulkOrders(prev => prev.map((row, i) => (i === origIdx ? { ...row, traceFileKey: key || null } : row)));
  };

  /** Drop a file and detach it from every row that pointed at it. */
  const removeTraceFile = (key) => {
    setBulkTraceFiles(prev => { const next = { ...prev }; delete next[key]; return next; });
    setBulkOrders(prev => prev.map(row => (row.traceFileKey === key ? { ...row, traceFileKey: null } : row)));
  };

  const applyTraceFileToUnassigned = (key) => {
    setBulkOrders(prev => prev.map(row => (
      row.clientId && row.bankAccountId && !row.traceFileKey ? { ...row, traceFileKey: key } : row
    )));
  };

  const traceFileUsageCount = (key) => bulkOrders.filter(r => r.clientId && r.bankAccountId && r.traceFileKey === key).length;

  /** Copy the block-level phone defaults onto every row. */
  const applyPhoneToAllRows = () => {
    setBulkOrders(prev => prev.map(row => ({ ...row, phoneCallTime, phoneCallLine })));
  };

  /** Effective phone instruction of a row: its own value, else the block default. */
  const rowPhoneCallTime = (row) => row.phoneCallTime || phoneCallTime;
  const rowPhoneCallLine = (row) => row.phoneCallLine || phoneCallLine;

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
      alignItems: 'center',
      justifyContent: 'space-between',
      // Aligned with the form content below (no extra side padding), with a
      // little air between the header rule and the step chips
      margin: isMobile ? '4px 0 20px' : '4px 0 28px',
      padding: 0
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
      margin: isMobile ? '0 6px' : '0 16px',
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
    // iOS Safari auto-zooms the page when a focused control's font is under 16px,
    // which on this form left the field off-screen and the layout stuck zoomed.
    // 16px on mobile is a functional requirement, not a style preference.
    input: {
      width: '100%',
      padding: isMobile ? '12px 14px' : '10px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: isMobile ? '16px' : '14px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none'
    },
    select: {
      width: '100%',
      padding: isMobile ? '12px 14px' : '10px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: isMobile ? '16px' : '14px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none',
      cursor: 'pointer'
    },
    textarea: {
      width: '100%',
      padding: isMobile ? '12px 14px' : '10px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: isMobile ? '16px' : '14px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none',
      minHeight: '80px',
      resize: 'vertical'
    },
    searchResults: {
      position: 'absolute',
      // Desktop opens upward (the field sits low in a short dialog). In the mobile
      // sheet the field is near the top, where opening upward would be clipped.
      ...(isMobile
        ? { top: '100%', borderRadius: '0 0 6px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }
        : { bottom: '100%', borderRadius: '6px 6px 0 0', boxShadow: '0 -4px 12px rgba(0,0,0,0.15)' }),
      left: 0,
      right: 0,
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-color)',
      maxHeight: isMobile ? '45vh' : '300px',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      zIndex: 100
    },
    searchResultItem: {
      // Taller rows so a fingertip can pick one security out of a list.
      padding: isMobile ? '14px 12px' : '10px 12px',
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
      color: type === 'buy' ? 'var(--gain-color)' : 'var(--loss-color)'
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

  const renderStepIndicator = () => {
    // On a phone there is no room for four labels plus connectors, so only the
    // current step is named — enough to know where you are and how far is left.
    if (isMobile) {
      return (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            {steps.map((step, index) => (
              <div
                key={step}
                style={{
                  flex: 1,
                  height: '4px',
                  borderRadius: '2px',
                  background: currentStep > index + 1
                    ? 'var(--success-color)'
                    : currentStep === index + 1
                      ? 'var(--accent-color)'
                      : 'var(--border-color)'
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)' }}>
              STEP {currentStep} OF {steps.length}
            </span>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
              {steps[currentStep - 1]}
            </span>
          </div>
        </div>
      );
    }

    return (
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
  };

  const renderStep1 = () => (
    <div>
      {assetType !== ASSET_TYPES.FX && assetType !== ASSET_TYPES.TERM_DEPOSIT && (
      <div style={styles.formGroup}>
        <label style={styles.label}>
          {assetType === ASSET_TYPES.OPTION ? 'Underlying' : 'Search Security'}
        </label>
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
                  <select
                    style={styles.select}
                    value={manualCurrency}
                    onChange={(e) => setManualCurrency(e.target.value)}
                  >
                    {MAIN_CURRENCIES.map(ccy => (
                      <option key={ccy} value={ccy}>{ccy}</option>
                    ))}
                  </select>
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
                        color: result.source === 'product' ? '#6366f1' : result.source === 'eod' ? 'var(--warning-color)' : '#6b7280'
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
                  {MAIN_CURRENCIES.filter(ccy => ccy !== fxSellCurrency).map(ccy => (
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
                  {MAIN_CURRENCIES.filter(ccy => ccy !== fxBuyCurrency).map(ccy => (
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
                background: depositAction === 'increase' ? 'var(--gain-color)' : 'var(--bg-primary)',
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
                background: depositAction === 'decrease' ? 'var(--loss-color)' : 'var(--bg-primary)',
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
                  {MAIN_CURRENCIES.map(ccy => (
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

      {/* Listed option contract. The underlying is picked with the normal
          security search above. For a US name the EOD chain turns strike and
          expiry into pickers and pins the OCC symbol; anything else (Eurex,
          Euronext...) is typed, exactly as before. */}
      {assetType === ASSET_TYPES.OPTION && selectedSecurity && (
        <div style={{ marginTop: '16px', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px', gap: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
              Option Contract
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>
              {isLoadingChain
                ? 'Loading option chain...'
                : optionChain?.available
                  ? <>
                      Chain: <strong>{optionChain.symbol}</strong>
                      {optionChain.underlyingAsOf ? ` · EOD ${optionChain.underlyingAsOf}` : ''}
                      {' · '}
                      <span
                        style={{ color: 'var(--accent-color)', cursor: 'pointer' }}
                        onClick={() => {
                          const next = !optionManualEntry;
                          setOptionManualEntry(next);
                          if (next) { setOptionContractSymbol(''); setOptionQuote(null); }
                        }}
                      >
                        {optionManualEntry ? 'Pick from chain' : 'Enter manually'}
                      </span>
                    </>
                  : (optionChain?.reason || 'No option feed - enter the contract')}
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={styles.label}>Type *</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { value: OPTION_TYPES.CALL, label: 'Call' },
                { value: OPTION_TYPES.PUT, label: 'Put' }
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setOptionType(opt.value);
                    if (optionChain?.available && !optionManualEntry && optionExpiry && optionStrike) {
                      // Same strike on the other side, if it exists.
                      const match = chainContractsForExpiry(optionExpiry, opt.value)
                        .find(c => c.strike === parseFloat(optionStrike));
                      applyChainContract(match || null);
                      if (!match) setOptionStrike('');
                    }
                  }}
                  style={{
                    flex: 1, padding: '9px', borderRadius: '6px', cursor: 'pointer',
                    fontSize: '0.88rem', fontWeight: '600',
                    border: optionType === opt.value ? 'none' : '1px solid var(--border-color)',
                    background: optionType === opt.value ? 'var(--accent-color)' : 'var(--bg-primary)',
                    color: optionType === opt.value ? 'white' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {optionChain?.available && !optionManualEntry ? (
            <div style={styles.row}>
              <div style={styles.col}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Expiry *</label>
                  <select
                    style={styles.select}
                    value={optionExpiry}
                    onChange={(e) => {
                      const expiry = e.target.value;
                      setOptionExpiry(expiry);
                      // Keep the strike if the new expiry lists it; otherwise
                      // clear it rather than carry a strike that isn't listed.
                      const match = chainContractsForExpiry(expiry).find(c => c.strike === parseFloat(optionStrike));
                      applyChainContract(match || null);
                      if (!match) setOptionStrike('');
                    }}
                  >
                    <option value="">Select expiry...</option>
                    {optionChain.expirations.map(e => (
                      <option key={e.expirationDate} value={e.expirationDate}>
                        {new Date(e.expirationDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {e.optionsCount ? ` (${e.optionsCount} contracts)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={styles.col}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Strike *</label>
                  <select
                    style={styles.select}
                    value={optionStrike}
                    disabled={!optionExpiry}
                    onChange={(e) => {
                      const strike = parseFloat(e.target.value);
                      const match = chainContractsForExpiry(optionExpiry).find(c => c.strike === strike);
                      if (match) applyChainContract(match); else { setOptionStrike(e.target.value); applyChainContract(null); }
                    }}
                  >
                    <option value="">{optionExpiry ? 'Select strike...' : 'Pick an expiry first'}</option>
                    {chainContractsForExpiry(optionExpiry).map(c => (
                      <option key={c.contractName} value={String(c.strike)}>
                        {c.strike}
                        {c.mid != null ? ` — ${c.bid ?? '-'} / ${c.ask ?? '-'}` : ''}
                        {c.inTheMoney ? ' · ITM' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ) : (
          <div style={styles.row}>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Strike *</label>
                <FormattedNumberInput
                  style={styles.input}
                  value={optionStrike}
                  onChange={(e) => setOptionStrike(e.target.value)}
                  placeholder="e.g. 60"
                  maxDecimals={4}
                />
              </div>
            </div>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Expiry *</label>
                <input
                  type="date"
                  style={styles.input}
                  value={optionExpiry}
                  onChange={(e) => setOptionExpiry(e.target.value)}
                />
              </div>
            </div>
          </div>
          )}

          {/* The end-of-day quote for the picked contract. A reference for the
              desk and the validator, not an executable price. */}
          {!optionManualEntry && optionQuote && optionContractSymbol && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '8px',
              padding: '10px 12px', marginBottom: '12px', borderRadius: '6px',
              background: 'var(--bg-primary)', border: '1px solid var(--border-color)'
            }}>
              {[
                { label: 'Bid / Ask', value: (optionQuote.bid != null && optionQuote.ask != null) ? `${optionQuote.bid} / ${optionQuote.ask}` : '—' },
                { label: 'Last', value: optionQuote.last != null && optionQuote.last > 0 ? optionQuote.last : '—' },
                { label: 'IV', value: optionQuote.impliedVolatility != null ? `${Number(optionQuote.impliedVolatility).toFixed(1)}%` : '—' },
                { label: 'Delta', value: optionQuote.delta != null ? Number(optionQuote.delta).toFixed(2) : '—' },
                { label: 'Open Int.', value: optionQuote.openInterest != null ? Number(optionQuote.openInterest).toLocaleString('en-US') : '—' }
              ].map(cell => (
                <div key={cell.label}>
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{cell.label}</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{cell.value}</div>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                <span style={{ fontFamily: 'monospace' }}>{optionContractSymbol}</span>
                {optionQuote.updatedAt ? ` · end-of-day quote as of ${optionQuote.updatedAt}` : ' · end-of-day quote'}
              </div>
            </div>
          )}

          <div style={styles.row}>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Contract Size</label>
                <FormattedNumberInput
                  style={styles.input}
                  value={optionContractSize}
                  onChange={(e) => setOptionContractSize(e.target.value)}
                  placeholder={String(DEFAULT_OPTION_CONTRACT_SIZE)}
                  maxDecimals={0}
                />
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                  Shares per contract
                </div>
              </div>
            </div>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Exchange</label>
                <input
                  type="text"
                  style={styles.input}
                  value={optionExchange}
                  onChange={(e) => setOptionExchange(e.target.value)}
                  placeholder="e.g. EUREX (optional)"
                />
              </div>
            </div>
          </div>

          {optionStrike && optionExpiry && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Contract: <strong>{buildOptionContractName()}</strong>
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

  // The contract, written the way the desk says it. Mirrors
  // optionContractDescription() on the order so the name shown before
  // submitting is the name that gets stored.
  const buildOptionContractName = () => {
    const underlying = selectedSecurity?.name || selectedSecurity?.ticker || '';
    const parts = [underlying, (optionType || '').toUpperCase()];
    if (optionStrike) parts.push(String(optionStrike));
    if (optionExpiry) {
      parts.push(new Date(optionExpiry).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric'
      }));
    }
    const size = parseFloat(optionContractSize);
    if (size && size !== DEFAULT_OPTION_CONTRACT_SIZE) parts.push(`x${size}`);
    return parts.filter(Boolean).join(' ');
  };

  // Shares this order would have to deliver if assigned.
  const optionShareEquivalent = (() => {
    const contracts = parseFloat(quantity);
    const size = parseFloat(optionContractSize) || DEFAULT_OPTION_CONTRACT_SIZE;
    return contracts > 0 ? contracts * size : 0;
  })();

  const isWritingCall = assetType === ASSET_TYPES.OPTION
    && optionType === OPTION_TYPES.CALL
    && mode === 'sell';

  // Local preview of the cover, against the holdings already loaded for this
  // account. It cannot see contracts written by other live orders, so the
  // server is asked once before the review step; until then this keeps the
  // panel responsive without a round trip per keystroke.
  const coveragePreview = (() => {
    if (!isWritingCall || !selectedSecurity?.isin || !(parseFloat(quantity) > 0)) return null;
    return computeShortCallCoverage({
      contracts: parseFloat(quantity),
      contractSize: parseFloat(optionContractSize) || DEFAULT_OPTION_CONTRACT_SIZE,
      underlyingIsin: selectedSecurity.isin,
      holdings: accountHoldings
    });
  })();

  // The server's answer wins once we have it - only it knows about the
  // contracts other live orders have already committed.
  const effectiveCoverage = coverageCheck || coveragePreview;

  const renderStep2 = () => (
    <div>
      {/* FX-specific Step 2 */}
      {assetType === ASSET_TYPES.FX ? (
        <>
          {/* Available cash balances — tap one to use it as the amount */}
          {isLoadingCash ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Loading cash balances…
            </div>
          ) : cashBalance?.cashPositions?.length > 0 && (
            <div style={{
              padding: '12px 14px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              marginBottom: '16px'
            }}>
              <div style={{
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--text-muted)',
                fontWeight: '600',
                marginBottom: '8px'
              }}>
                Available cash — tap a balance to use it
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {cashBalance.cashPositions.map((p) => {
                  const side = p.currency === fxSellCurrency ? 'sell'
                    : p.currency === fxBuyCurrency ? 'buy' : null;
                  const usable = side !== null && p.amount > 0;
                  return (
                    <button
                      key={p.currency}
                      type="button"
                      disabled={!usable}
                      onClick={() => {
                        if (!usable) return;
                        setFxAmountCurrency(side);
                        setQuantity(p.amount.toFixed(2));
                      }}
                      title={usable
                        ? `Use the full ${p.currency} balance as the amount`
                        : (side === null ? 'Not part of this currency pair' : 'No positive balance')}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '6px',
                        border: `1px solid ${usable ? 'var(--accent-color)' : 'var(--border-color)'}`,
                        background: usable
                          ? 'color-mix(in srgb, var(--accent-color) 8%, transparent)'
                          : 'transparent',
                        color: p.amount < 0
                          ? 'var(--loss-color)'
                          : (usable ? 'var(--text-primary)' : 'var(--text-muted)'),
                        cursor: usable ? 'pointer' : 'default',
                        fontSize: '12px',
                        fontWeight: '600',
                        fontVariantNumeric: 'tabular-nums'
                      }}
                    >
                      {p.currency} {p.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Amount + currency side */}
          <div style={styles.row}>
            <div style={{ flex: 2 }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Amount
                  {(() => {
                    // Full position for FX: the account's entire cash balance in
                    // the SELL currency (that's the position being converted)
                    const sellBalance = fxSellCurrency
                      ? cashBalance?.cashPositions?.find(p => p.currency === fxSellCurrency)
                      : null;
                    if (!sellBalance || !(sellBalance.amount > 0)) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setFxAmountCurrency('sell');
                          setQuantity(sellBalance.amount.toFixed(2));
                        }}
                        title={`Sell the full ${fxSellCurrency} balance`}
                        style={{
                          marginLeft: '8px',
                          padding: '3px 10px',
                          borderRadius: '6px',
                          border: '1px solid var(--accent-color)',
                          background: 'color-mix(in srgb, var(--accent-color) 10%, transparent)',
                          color: 'var(--accent-color)',
                          cursor: 'pointer',
                          fontWeight: '600',
                          fontSize: '12px'
                        }}
                      >
                        Full position
                      </button>
                    );
                  })()}
                </label>
                <FormattedNumberInput
                  style={styles.input}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Enter amount"
                  maxDecimals={2}
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
                <strong>Buy {fxBuyCurrency || '—'} / Sell {fxSellCurrency || '—'}</strong>
                {fxSubtype === FX_SUBTYPES.FORWARD ? ' Forward' : ' Spot'}
                {quantity ? ` — ${parseFloat(quantity).toLocaleString('en-US')} ${fxAmountCurrency === 'buy' ? fxBuyCurrency : fxSellCurrency}` : ''}
              </span>
              <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                {fxSpotLoading ? 'Loading...' : Number.isFinite(Number(fxSpotRate)) ? `Spot: ${Number(fxSpotRate).toFixed(4)}` : ''}
              </span>
            </div>
          </div>

          {/* Limit, Stop Loss, Take Profit */}
          <div style={styles.row}>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Limit Price (Optional)</label>
                <FormattedNumberInput
                  style={styles.input}
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="Limit rate"
                  maxDecimals={6}
                />
              </div>
            </div>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Stop Loss (Optional)</label>
                <FormattedNumberInput
                  style={styles.input}
                  value={stopLossPrice}
                  onChange={(e) => setStopLossPrice(e.target.value)}
                  placeholder="Stop loss rate"
                  maxDecimals={6}
                />
              </div>
            </div>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Take Profit (Optional)</label>
                <FormattedNumberInput
                  style={styles.input}
                  value={takeProfitPrice}
                  onChange={(e) => setTakeProfitPrice(e.target.value)}
                  placeholder="Take profit rate"
                  maxDecimals={6}
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
                <div key={i} style={{ fontSize: '12px', color: 'var(--warning-color)', marginBottom: i < fxWarnings.length - 1 ? '4px' : 0 }}>
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
              <span style={{ color: 'var(--text-secondary)' }}>
                {assetType === ASSET_TYPES.OPTION ? 'Underlying Spot' : 'Indicative Price'}
              </span>
              {isLoadingPrice ? (
                <span style={{ color: 'var(--text-secondary)' }}>Fetching...</span>
              ) : (
                <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                  {indicativePriceCurrency || ''} {indicativePrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </span>
              )}
            </div>
          )}

          {/* Quantity — single input or per-account grid for bulk */}
          {isBulkMode ? (
            <div style={styles.formGroup}>
              <label style={styles.label}>{assetType === ASSET_TYPES.STRUCTURED_PRODUCT ? 'Nominal per Account' : assetType === ASSET_TYPES.FUND ? (fundQuantityMode === FUND_QUANTITY_MODES.NOMINAL ? 'Nominal Amount per Account' : 'Units per Account') : 'Quantity per Account'}</label>
              {assetType === ASSET_TYPES.FUND && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                  {[
                    { value: FUND_QUANTITY_MODES.UNITS, label: 'Units' },
                    { value: FUND_QUANTITY_MODES.NOMINAL, label: 'Nominal' }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setFundQuantityMode(opt.value);
                        setBulkOrders(prev => prev.map(o => ({ ...o, quantity: '' })));
                      }}
                      style={{
                        padding: '8px 4px',
                        borderRadius: '6px',
                        border: `1px solid ${fundQuantityMode === opt.value ? 'var(--accent-color)' : 'var(--border-color)'}`,
                        background: fundQuantityMode === opt.value ? 'var(--accent-color)' : 'transparent',
                        color: fundQuantityMode === opt.value ? '#fff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {bulkOrders.filter(o => o.clientId && o.bankAccountId).map((order, idx) => {
                const origIdx = bulkOrders.indexOf(order);
                const client = findClientById(availableClients, order.clientId);
                const accounts = bulkAccountsMap[origIdx] || [];
                const account = accounts.find(a => a._id === order.bankAccountId);
                const clientName = client
                  ? (client.profile?.clientType === 'company' && client.profile?.companyName
                    ? client.profile.companyName
                    : `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || client.username)
                  : 'N/A';

                // Cash check per row
                const cashKey = `${order.clientId}_${order.bankAccountId}`;
                const rowCash = bulkCashBalances[cashKey];
                const secCurrency = selectedSecurity?.currency || prefillData?.currency || settlementCurrency || '';
                const rowCashInCcy = rowCash?.cashPositions?.find(p => p.currency === secCurrency);
                const price = priceType === PRICE_TYPES.LIMIT && limitPrice ? parseFloat(limitPrice) : indicativePrice;
                const rowQty = parseFloat(order.quantity) || 0;
                const rowEstCost = rowQty > 0 && price ? rowQty * price : 0;
                const rowExceeds = rowCashInCcy && rowEstCost > rowCashInCcy.amount;
                const rowMaxShares = rowCashInCcy && price && price > 0 ? Math.floor(rowCashInCcy.amount / price) : null;

                return (
                  <div key={origIdx} style={{ marginBottom: '8px', padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: '8px', border: `1px solid ${rowExceeds ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-color)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                      <span style={{ flex: 2, fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {clientName}
                      </span>
                      <span style={{ flex: 2, fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {account ? `${account.bankName} - ${account.accountNumber}` : ''}
                      </span>
                      <div style={{ flex: 1 }}>
                        <FormattedNumberInput
                          style={{ ...styles.input, padding: '7px 10px' }}
                          value={order.quantity}
                          onChange={(e) => updateBulkOrder(origIdx, 'quantity', e.target.value)}
                          placeholder={assetType === ASSET_TYPES.FUND ? (fundQuantityMode === FUND_QUANTITY_MODES.NOMINAL ? 'Amount' : 'Units') : assetType === ASSET_TYPES.OPTION ? 'Contracts' : 'Qty'}
                          maxDecimals={
                            assetType === ASSET_TYPES.TERM_DEPOSIT ? 2
                            : assetType === ASSET_TYPES.FUND ? (fundQuantityMode === FUND_QUANTITY_MODES.NOMINAL ? 2 : 4)
                            : 0
                          }
                        />
                      </div>
                    </div>
                    {/* Cash check */}
                    {mode === 'buy' && (assetType === ASSET_TYPES.EQUITY || assetType === ASSET_TYPES.ETF) && rowCashInCcy && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Cash {secCurrency}: <span style={{ fontWeight: '600', color: rowExceeds ? 'var(--loss-color)' : 'var(--gain-color)' }}>{rowCashInCcy.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                        {rowMaxShares !== null && rowMaxShares > 0 && (
                          <span style={{ color: 'var(--accent-color)', cursor: 'pointer' }} onClick={() => updateBulkOrder(origIdx, 'quantity', String(rowMaxShares))}>Max: {rowMaxShares.toLocaleString('en-US')}</span>
                        )}
                        {rowExceeds && rowQty > 0 && (
                          <span style={{ color: 'var(--loss-color)', fontWeight: '500' }}>Exceeds cash</span>
                        )}
                      </div>
                    )}
                    {/* Full-position autofill per row (sell mode). Holding quantities are
                        in units, so hide it when a fund order is entered as nominal. */}
                    {mode === 'sell'
                      && !(assetType === ASSET_TYPES.FUND && fundQuantityMode === FUND_QUANTITY_MODES.NOMINAL)
                      && (() => {
                        const rowIsin = selectedSecurity?.isin || prefillData?.isin;
                        const rowHolding = rowIsin
                          ? (bulkAccountHoldings[cashKey] || []).find(h => h.isin === rowIsin)
                          : null;
                        if (!rowHolding?.quantity) return null;
                        return (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '11px', marginBottom: '4px' }}>
                            <span
                              style={{ color: 'var(--accent-color)', cursor: 'pointer' }}
                              title="Fill with the full position quantity"
                              onClick={() => updateBulkOrder(origIdx, 'quantity', String(rowHolding.quantity))}
                            >
                              Full position: {rowHolding.quantity.toLocaleString('en-US')}
                            </span>
                          </div>
                        );
                      })()}
                  </div>
                );
              })}
              {bulkOrders.filter(o => o.clientId && o.bankAccountId).length > 1 && (
                <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Total: {bulkTotalQuantity.toLocaleString('en-US')}
                </div>
              )}
            </div>
          ) : (
            <div style={styles.row}>
              <div style={styles.col}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    {assetType === ASSET_TYPES.TERM_DEPOSIT
                      ? 'Amount'
                      : assetType === ASSET_TYPES.STRUCTURED_PRODUCT
                        ? 'Nominal'
                        : assetType === ASSET_TYPES.OPTION
                          ? 'Contracts'
                          : assetType === ASSET_TYPES.FUND
                            ? (fundQuantityMode === FUND_QUANTITY_MODES.NOMINAL ? 'Nominal Amount' : 'Units')
                            : 'Quantity'}
                    {mode === 'sell' && selectedHolding?.quantity && ` (Max: ${selectedHolding.quantity.toLocaleString('en-US')})`}
                    {mode === 'sell' && !selectedHolding && prefillData?.quantity && ` (Max: ${prefillData.quantity})`}
                    {(() => {
                      // Full-position autofill for sell orders. Holding quantities are in
                      // units, so hide it when a fund order is entered as a nominal amount.
                      const fullQty = mode === 'sell'
                        && !(assetType === ASSET_TYPES.FUND && fundQuantityMode === FUND_QUANTITY_MODES.NOMINAL)
                        && (selectedHolding?.quantity || prefillData?.quantity);
                      if (!fullQty) return null;
                      return (
                        <button
                          type="button"
                          onClick={() => setQuantity(String(fullQty))}
                          title="Fill with the full position quantity"
                          style={{
                            marginLeft: '8px',
                            padding: '3px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--accent-color)',
                            background: 'color-mix(in srgb, var(--accent-color) 10%, transparent)',
                            color: 'var(--accent-color)',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '12px'
                          }}
                        >
                          Full position
                        </button>
                      );
                    })()}
                  </label>
                  {assetType === ASSET_TYPES.FUND && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                      {[
                        { value: FUND_QUANTITY_MODES.UNITS, label: 'Units' },
                        { value: FUND_QUANTITY_MODES.NOMINAL, label: 'Nominal' }
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { setFundQuantityMode(opt.value); setQuantity(''); setAmountToConvert(''); }}
                          style={{
                            padding: '8px 4px',
                            borderRadius: '6px',
                            border: `1px solid ${fundQuantityMode === opt.value ? 'var(--accent-color)' : 'var(--border-color)'}`,
                            background: fundQuantityMode === opt.value ? 'var(--accent-color)' : 'transparent',
                            color: fundQuantityMode === opt.value ? '#fff' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600'
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <FormattedNumberInput
                    style={styles.input}
                    value={quantity}
                    onChange={(e) => { setQuantity(e.target.value); setAmountToConvert(''); }}
                    placeholder={
                      assetType === ASSET_TYPES.TERM_DEPOSIT
                        ? 'Enter amount'
                        : assetType === ASSET_TYPES.STRUCTURED_PRODUCT
                          ? 'Enter nominal'
                          : assetType === ASSET_TYPES.OPTION
                            ? 'Number of contracts'
                          : assetType === ASSET_TYPES.FUND
                            ? (fundQuantityMode === FUND_QUANTITY_MODES.NOMINAL ? 'Enter amount' : 'Enter units')
                            : 'Enter quantity'
                    }
                    maxDecimals={
                      assetType === ASSET_TYPES.TERM_DEPOSIT ? 2
                      : assetType === ASSET_TYPES.FUND ? (fundQuantityMode === FUND_QUANTITY_MODES.NOMINAL ? 2 : 4)
                      : 0
                    }
                  />
                  {/* Size the units from an amount: units = amount ÷ price, rounded down */}
                  {canConvertAmountToUnits && (
                    <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '6px', border: '1px dashed var(--border-color)', background: 'var(--bg-secondary)' }}>
                      <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        Or enter an amount ({getCurrencyForDisplay() || 'price currency'}) to compute the units
                      </label>
                      <FormattedNumberInput
                        style={styles.input}
                        value={amountToConvert}
                        onChange={(e) => {
                          const value = e.target.value;
                          setAmountToConvert(value);
                          const units = unitsForAmount(value);
                          if (units !== null) setQuantity(String(units));
                          else if (!value.trim()) setQuantity('');
                        }}
                        placeholder={conversionPrice > 0 ? 'e.g. 1,000,000' : 'Waiting for a price…'}
                        disabled={!(conversionPrice > 0)}
                        maxDecimals={2}
                      />
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {!(conversionPrice > 0)
                          ? 'No price available yet — enter a limit price, or the units directly.'
                          : unitsForAmount(amountToConvert) !== null
                            ? <>
                                = <strong>{unitsForAmount(amountToConvert).toLocaleString('en-US', { maximumFractionDigits: unitDecimals })} units</strong>
                                {' '}at {getCurrencyForDisplay()} {conversionPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })} ({conversionPriceSource}), rounded down
                              </>
                            : `Uses the ${conversionPriceSource}: ${getCurrencyForDisplay()} ${conversionPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}`}
                      </div>
                    </div>
                  )}
                  {assetType === ASSET_TYPES.OPTION && optionShareEquivalent > 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {parseFloat(quantity).toLocaleString('en-US')} contracts × {(parseFloat(optionContractSize) || DEFAULT_OPTION_CONTRACT_SIZE).toLocaleString('en-US')} = <strong>{optionShareEquivalent.toLocaleString('en-US')} shares</strong>
                      {selectedSecurity?.name ? ` of ${selectedSecurity.name}` : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

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
                  <span style={{ fontWeight: '600', color: cashInCurrency ? (exceeds ? 'var(--loss-color)' : 'var(--gain-color)') : 'var(--text-secondary)' }}>
                    {cashInCurrency ? cashInCurrency.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'No balance'}
                  </span>
                </div>
                {maxShares !== null && maxShares > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Max shares at {price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {secCurrency}
                    </span>
                    <span
                      style={{ fontWeight: '600', color: 'var(--accent-color)', cursor: 'pointer' }}
                      title="Click to fill quantity"
                      onClick={() => setQuantity(String(maxShares))}
                    >
                      {maxShares.toLocaleString('en-US')}
                    </span>
                  </div>
                )}
                {exceeds && qty > 0 && (() => {
                  // Short on cash is not the same as short on money: say so when
                  // the shortfall is covered by a money market fund or a deposit.
                  const nearCash = cashBalance?.nearCashPositions?.find(p => p.currency === secCurrency);
                  return (
                    <div style={{ marginTop: '4px', color: 'var(--loss-color)', fontSize: '12px', fontWeight: '500' }}>
                      Estimated cost {secCurrency} {estCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} exceeds available cash
                      {nearCash && nearCash.amount > 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontWeight: '400' }}>
                          {' '}— {secCurrency} {nearCash.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sits in money market &amp; deposits, which must be sold first
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : null;
          })()}

          {/* Order type selector */}
          {assetType !== ASSET_TYPES.TERM_DEPOSIT && assetType !== ASSET_TYPES.STRUCTURED_PRODUCT && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Order Type</label>
              {/* Four price types across a phone screen leave ~80px each, too narrow for
                  "Stop Limit" — they wrap to a 2x2 grid instead. */}
              <div style={{ display: 'grid', gridTemplateColumns: gridCols((assetType === ASSET_TYPES.EQUITY || assetType === ASSET_TYPES.ETF) ? '1fr 1fr 1fr 1fr' : '1fr 1fr', '1fr 1fr'), gap: '6px' }}>
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
              <label style={styles.label}>
                {assetType === ASSET_TYPES.STRUCTURED_PRODUCT
                  ? 'Price (% of par) — optional'
                  : assetType === ASSET_TYPES.OPTION
                    ? `Premium (${getCurrencyForDisplay()} per share)`
                    : `Limit Price (${getCurrencyForDisplay()})`}
              </label>
              <FormattedNumberInput
                style={styles.input}
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder={
                  assetType === ASSET_TYPES.STRUCTURED_PRODUCT
                    ? '100'
                    : assetType === ASSET_TYPES.OPTION
                      ? (optionQuote?.mid > 0
                          ? `${mode === 'buy' ? 'Max to pay' : 'Min to receive'} — EOD mid ${Number(optionQuote.mid).toFixed(2)}`
                          : (mode === 'buy' ? 'Maximum premium to pay' : 'Minimum premium to receive'))
                    : mode === 'buy' ? 'Maximum price to buy' : 'Minimum price to sell'
                }
                maxDecimals={2}
              />
            </div>
          )}

          {priceType === PRICE_TYPES.STOP_LOSS && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Stop Price ({getCurrencyForDisplay()})</label>
              <FormattedNumberInput
                style={styles.input}
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                placeholder="Trigger price — executes at market when reached"
                maxDecimals={2}
              />
            </div>
          )}

          {priceType === PRICE_TYPES.STOP_LIMIT && (
            <div style={styles.row}>
              <div style={styles.col}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Stop Price ({getCurrencyForDisplay()})</label>
                  <FormattedNumberInput
                    style={styles.input}
                    value={stopPrice}
                    onChange={(e) => setStopPrice(e.target.value)}
                    placeholder="Trigger price"
                    maxDecimals={2}
                  />
                </div>
              </div>
              <div style={styles.col}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Limit Price ({getCurrencyForDisplay()})</label>
                  <FormattedNumberInput
                    style={styles.input}
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    placeholder="Max execution price"
                    maxDecimals={2}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Validity for non-market orders (FX uses its own limit input, so gate on limitPrice too) */}
          {((priceType !== PRICE_TYPES.MARKET) || (assetType === ASSET_TYPES.FX && limitPrice)) && assetType !== ASSET_TYPES.TERM_DEPOSIT && assetType !== ASSET_TYPES.STRUCTURED_PRODUCT && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Validity</label>
              <div style={{ display: 'grid', gridTemplateColumns: gridCols(validityType === VALIDITY_TYPES.GTD ? '1fr 1fr 1fr 2fr' : '1fr 1fr 1fr'), gap: '6px', alignItems: 'start' }}>
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

          {/* Attached Take Profit / Stop Loss legs - equities/ETFs bought (they protect the position
              being opened; a sale closes it, so there is nothing to attach) and FX, with market/limit orders */}
          {(((assetType === ASSET_TYPES.EQUITY || assetType === ASSET_TYPES.ETF) && mode === 'buy') || assetType === ASSET_TYPES.FX) && priceType !== PRICE_TYPES.STOP_LOSS && priceType !== PRICE_TYPES.STOP_LIMIT && (
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
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--gain-color)', fontWeight: '500' }}>
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
                        <FormattedNumberInput
                          style={styles.input}
                          value={attachedTakeProfit}
                          onChange={(e) => setAttachedTakeProfit(e.target.value)}
                          placeholder="Target price"
                          maxDecimals={2}
                        />
                      </div>
                    </div>
                    <div style={styles.col}>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Stop Loss ({getCurrencyForDisplay()})</label>
                        <FormattedNumberInput
                          style={styles.input}
                          value={attachedStopLoss}
                          onChange={(e) => setAttachedStopLoss(e.target.value)}
                          placeholder="Protection price"
                          maxDecimals={2}
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
          <FormattedNumberInput
            style={styles.input}
            value={estimatedValue}
            onChange={(e) => {
              setEstimatedValue(e.target.value);
              // Emptying the field hands control back to the calculation, so a
              // typed-over estimate is not a one-way door.
              setEstimatedValueManuallyEdited(e.target.value.trim() !== '');
            }}
            placeholder="Enter estimated value"
            maxDecimals={2}
          />
          {/* Once it has been typed over, the field stops following the nominal
              and the price — which looks exactly like "the amount is not
              updating". Say what the numbers give and offer it back. */}
          {estimatedValueManuallyEdited
            && computedEstimatedValue !== null
            && parseFloat(computedEstimatedValue) !== parseFloat(estimatedValue || '0') && (
            <div style={{ marginTop: '5px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
              {quotesPriceAsPercent(assetType) && parseFloat(limitPrice) > 0
                ? `${OrderFormatters.formatQuantity(parseFloat(isBulkMode ? bulkTotalQuantity : quantity) || 0)} × ${limitPrice}% = `
                : 'From the quantity and price: '}
              <span
                onClick={() => { setEstimatedValue(computedEstimatedValue); setEstimatedValueManuallyEdited(false); }}
                style={{ color: 'var(--accent-color)', cursor: 'pointer', fontWeight: 600 }}
                title="Use this value"
              >
                {Number(computedEstimatedValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {getCurrencyForDisplay()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Capital Protected toggle for structured products - buy side only: it
          classifies a new position for profile allocation, which a sell does not need */}
      {assetType === ASSET_TYPES.STRUCTURED_PRODUCT && mode === 'buy' && (
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
            <span style={{ fontSize: '13px', fontWeight: '600', color: capitalProtected ? 'var(--gain-color)' : 'var(--text-primary)' }}>
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
            background: capitalProtected ? 'var(--gain-color)' : 'var(--border-color)',
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
                {assetType === ASSET_TYPES.STRUCTURED_PRODUCT ? (
                  <>
                    <label style={styles.label}>Counterparty *</label>
                    <select
                      style={styles.input}
                      value={issuerId}
                      onChange={(e) => setIssuerId(e.target.value)}
                      required
                    >
                      <option value="">— Select counterparty —</option>
                      {issuers.map(iss => (
                        <option key={iss._id} value={iss._id}>
                          {iss.name}{iss.code ? ` (${iss.code})` : ''}
                        </option>
                      ))}
                    </select>
                    {/* Counterparty coordinates — read from the issuer record and stored on the order */}
                    {(() => {
                      if (!issuerId) return null;
                      const iss = issuers.find(i => i._id === issuerId);
                      if (!iss) return null;
                      const hasContact = iss.contactName || iss.contactEmail || iss.contactPhone;
                      return (
                        <div style={{
                          marginTop: '6px', padding: '8px 10px', borderRadius: '6px',
                          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                          fontSize: '12px', lineHeight: '1.5'
                        }}>
                          <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '4px' }}>
                            Counterparty Contact
                          </div>
                          {hasContact ? (
                            <>
                              {iss.contactName && <div style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{iss.contactName}</div>}
                              {iss.contactEmail && <div><a href={`mailto:${iss.contactEmail}`} style={{ color: 'var(--accent-color)', textDecoration: 'none' }}>{iss.contactEmail}</a></div>}
                              {iss.contactPhone && <div><a href={`tel:${iss.contactPhone.replace(/\s/g, '')}`} style={{ color: 'var(--accent-color)', textDecoration: 'none' }}>{iss.contactPhone}</a></div>}
                            </>
                          ) : (
                            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              No contact details on file — add them in Issuer Management.
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <>
                    <label style={styles.label}>Broker / Issuer (Optional)</label>
                    <input
                      type="text"
                      style={styles.input}
                      value={broker}
                      onChange={(e) => setBroker(e.target.value)}
                      placeholder="e.g. Marex, EDR..."
                    />
                  </>
                )}
              </div>
            </div>
            <div style={styles.col}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Settlement Currency (Optional)</label>
                <select
                  style={styles.select}
                  value={settlementCurrency}
                  onChange={(e) => setSettlementCurrency(e.target.value)}
                >
                  <option value="">—</option>
                  {/* Include a security-derived currency outside the main list so a prefilled value isn't silently lost */}
                  {(settlementCurrency && !MAIN_CURRENCIES.includes(settlementCurrency)
                    ? [settlementCurrency, ...MAIN_CURRENCIES]
                    : MAIN_CURRENCIES).map(ccy => (
                    <option key={ccy} value={ccy}>{ccy}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {assetType === ASSET_TYPES.STRUCTURED_PRODUCT && mode !== 'sell' && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Termsheet (PDF) *</label>
              {(() => {
                const validateAndSetTermsheet = (f) => {
                  if (!f) { setTermsheetFile(null); return; }
                  if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
                    setError('Termsheet must be a PDF.');
                    setTermsheetFile(null);
                    return;
                  }
                  if (f.size > 15 * 1024 * 1024) {
                    setError('Termsheet must be smaller than 15MB.');
                    setTermsheetFile(null);
                    return;
                  }
                  setError(null);
                  setTermsheetFile(f);
                };
                return termsheetFile ? (
                  <div style={{
                    border: '2px solid var(--gain-color)',
                    background: 'rgba(16, 185, 129, 0.08)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '18px' }}>📄</span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--gain-color)', flex: 1, wordBreak: 'break-all' }}>
                      {termsheetFile.name}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      ({(termsheetFile.size / 1024).toFixed(0)} KB)
                    </span>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: 'var(--loss-color)', cursor: 'pointer', fontSize: '14px', padding: '2px 6px' }}
                      onClick={() => setTermsheetFile(null)}
                      title="Remove file"
                    >
                      x
                    </button>
                  </div>
                ) : productTermsheet ? (
                  <div style={{
                    border: '2px solid var(--info-color)',
                    background: 'rgba(14, 165, 233, 0.08)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '18px' }}>📋</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--info-color)', wordBreak: 'break-all' }}>
                        {productTermsheet.filename}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Already on file for this product ({(productTermsheet.sizeBytes / 1024).toFixed(0)} KB) — it will be attached to this order
                      </div>
                    </div>
                    <button
                      type="button"
                      style={{
                        background: 'none', border: '1px solid var(--border-color)', borderRadius: '4px',
                        color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '11px', padding: '4px 8px', flexShrink: 0
                      }}
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'application/pdf';
                        input.onchange = (e) => validateAndSetTermsheet(e.target.files?.[0]);
                        input.click();
                      }}
                      title="Attach a different PDF for this order"
                    >
                      Replace
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      border: '2px dashed var(--border-color)',
                      borderRadius: '8px',
                      padding: '16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: 'var(--bg-secondary)',
                      transition: 'border-color 0.15s, background 0.15s'
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.style.borderColor = '#0ea5e9';
                      e.currentTarget.style.background = 'rgba(14, 165, 233, 0.08)';
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'var(--bg-secondary)';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'var(--bg-secondary)';
                      const f = e.dataTransfer.files?.[0];
                      validateAndSetTermsheet(f);
                    }}
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'application/pdf';
                      input.onchange = (e) => {
                        const f = e.target.files?.[0];
                        validateAndSetTermsheet(f);
                      };
                      input.click();
                    }}
                  >
                    <div style={{ fontSize: '24px', marginBottom: '4px' }}>📄</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      Drop termsheet PDF here, or click to browse
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      PDF only — max 15MB
                    </div>
                  </div>
                );
              })()}
              <div style={{ marginTop: '6px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                The termsheet will be attached to the order email sent to the bank.
              </div>
            </div>
          )}

        </>
      )}

      <div style={styles.formGroup}>
        <label style={styles.label}>
          {isCashExceeded ? <span style={{ color: 'var(--loss-color)' }}>Notes (Required — order exceeds available cash)</span> : 'Notes (Optional)'}
        </label>
        <textarea
          style={{ ...styles.textarea, ...(isCashExceeded && !notes.trim() ? { borderColor: 'var(--loss-color)' } : {}) }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={isCashExceeded ? 'Please justify why this order exceeds available cash...' : 'Add any special instructions or notes...'}
        />
      </div>

      <div style={styles.formGroup}>
        <label style={styles.label}>Comment for Bank (Optional)</label>
        <textarea
          style={{ ...styles.textarea, minHeight: '50px' }}
          value={bankComment}
          onChange={(e) => setBankComment(e.target.value)}
          placeholder="This comment will appear on the order PDF sent to the bank..."
        />
      </div>

      {/* Order Source Toggle + Client Order Attachment / Phone Call */}
      <div style={styles.formGroup}>
        <label style={styles.label}>Client Instruction Source *</label>
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
              onClick={() => {
                setOrderSource(value);
                // Clear the other source's data when switching. The bulk file
                // registry is kept: a mis-click must not throw away uploads.
                if (value === ORDER_SOURCE_TYPES.PHONE) {
                  setClientOrderFile(null);
                  setDeferAttachment(false);
                } else {
                  setPhoneCallTime('');
                }
              }}
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
            <div style={{ display: 'grid', gridTemplateColumns: gridCols('1fr 1fr'), gap: '10px', marginBottom: '6px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--info-color)', display: 'block', marginBottom: '6px' }}>
                  {isBulkMode ? 'Default call time' : 'Call received at'}
                </label>
                <input
                  type="datetime-local"
                  value={phoneCallTime}
                  onChange={(e) => setPhoneCallTime(e.target.value)}
                  style={{ ...styles.input, marginBottom: '0' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--info-color)', display: 'block', marginBottom: '6px' }}>
                  {isBulkMode ? 'Default phone line' : 'Phone line'}
                </label>
                <input
                  type="tel"
                  value={phoneCallLine}
                  onChange={(e) => setPhoneCallLine(e.target.value)}
                  placeholder="e.g. +377 97 98 00 00"
                  style={{ ...styles.input, marginBottom: '0' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
              <span>Phone line is saved to your profile for future orders</span>
              {isBulkMode && (
                <button
                  type="button"
                  onClick={applyPhoneToAllRows}
                  style={{ background: 'none', border: '1px solid var(--info-color)', color: 'var(--info-color)', borderRadius: '6px', padding: '3px 8px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
                >
                  Apply to all clients
                </button>
              )}
            </div>

            {/* One call per client: each row records when and on which line the
                instruction was taken. Empty fields fall back to the defaults above. */}
            {isBulkMode && validBulkRows().length > 0 && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {validBulkRows().map(({ row, origIdx }) => {
                  const account = (bulkAccountsMap[origIdx] || []).find(a => a._id === row.bankAccountId);
                  return (
                    <div key={origIdx} style={{ padding: '8px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', fontSize: '12px' }}>
                        <span style={{ flex: 2, fontWeight: '600', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bulkRowClientName(row)}</span>
                        <span style={{ flex: 2, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account ? `${account.bankName} - ${account.accountNumber}` : row.accountLabel}</span>
                        <span style={{ flex: 1, textAlign: 'right', color: 'var(--text-muted)' }}>{row.quantity ? parseFloat(row.quantity).toLocaleString('en-US') : ''}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: gridCols('1fr 1fr'), gap: '8px' }}>
                        <input
                          type="datetime-local"
                          value={rowPhoneCallTime(row)}
                          onChange={(e) => updateBulkOrder(origIdx, 'phoneCallTime', e.target.value)}
                          style={{ ...styles.input, marginBottom: '0', padding: '6px 8px', fontSize: '12px' }}
                        />
                        <input
                          type="tel"
                          value={rowPhoneCallLine(row)}
                          onChange={(e) => updateBulkOrder(origIdx, 'phoneCallLine', e.target.value)}
                          placeholder="Phone line"
                          style={{ ...styles.input, marginBottom: '0', padding: '6px 8px', fontSize: '12px' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : isBulkMode ? (
          <>
            {/* Multi-account order: each client has their own instruction. Files
                are uploaded once into a registry and assigned per row, so one
                email covering two accounts of the same owner is picked twice. */}
            {(() => {
              const registryKeys = Object.keys(bulkTraceFiles);
              const rows = validBulkRows();
              const assignedCount = rows.filter(({ row }) => row.traceFileKey && bulkTraceFiles[row.traceFileKey]).length;
              const pickFiles = (multiple, onKeys) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = EMAIL_TRACE_ACCEPTED_TYPES.join(',');
                input.multiple = multiple;
                input.onchange = (e) => {
                  const keys = addTraceFiles(Array.from(e.target.files || []));
                  if (keys.length > 0) onKeys?.(keys);
                };
                input.click();
              };
              return (
                <>
                  <label style={{ ...styles.label, marginBottom: '6px' }}>
                    Client instruction files ({registryKeys.length})
                  </label>

                  {registryKeys.length > 0 && (
                    <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {registryKeys.map((key) => {
                        const file = bulkTraceFiles[key];
                        const used = traceFileUsageCount(key);
                        return (
                          <div key={key} style={{
                            display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
                            padding: '6px 10px',
                            background: used > 0 ? 'rgba(16, 185, 129, 0.05)' : 'rgba(245, 158, 11, 0.06)',
                            border: `1px solid ${used > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.35)'}`,
                            borderRadius: '6px'
                          }}>
                            <span style={{ fontSize: '14px' }}>📎</span>
                            <span style={{ fontSize: '12px', fontWeight: '500', color: used > 0 ? 'var(--gain-color)' : 'var(--warning-color)', flex: 1, minWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({(file.size / 1024).toFixed(0)} KB)</span>
                            <span style={{ fontSize: '11px', color: used > 0 ? 'var(--text-muted)' : 'var(--warning-color)' }}>
                              {used > 0 ? `used by ${used} client${used > 1 ? 's' : ''}` : 'not assigned'}
                            </span>
                            {rows.some(({ row }) => !row.traceFileKey) && (
                              <button
                                type="button"
                                onClick={() => applyTraceFileToUnassigned(key)}
                                style={{ background: 'none', border: '1px solid var(--accent-color)', color: 'var(--accent-color)', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
                              >
                                Use for all unassigned
                              </button>
                            )}
                            <button
                              type="button"
                              style={{ background: 'none', border: 'none', color: 'var(--loss-color)', cursor: 'pointer', fontSize: '13px', padding: '2px 6px' }}
                              onClick={() => removeTraceFile(key)}
                              title="Remove file"
                            >
                              x
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div
                    style={{
                      border: '2px dashed var(--border-color)',
                      borderRadius: '8px',
                      padding: registryKeys.length > 0 ? '10px' : '16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: 'var(--bg-secondary)',
                      transition: 'border-color 0.15s, background 0.15s'
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.style.borderColor = 'var(--gain-color)';
                      e.currentTarget.style.background = 'rgba(16, 185, 129, 0.05)';
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'var(--bg-secondary)';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'var(--bg-secondary)';
                      let droppedFiles = Array.from(e.dataTransfer.files || []);
                      if (droppedFiles.length === 0 && e.dataTransfer.items) {
                        droppedFiles = Array.from(e.dataTransfer.items)
                          .filter(item => item.kind === 'file')
                          .map(item => item.getAsFile())
                          .filter(Boolean);
                      }
                      if (droppedFiles.length === 0) {
                        setError('No file received. Dragging directly from Outlook is not supported by the browser — first drag the email to your desktop (this saves it as a .msg file), then drop that file here, or click to browse.');
                        return;
                      }
                      addTraceFiles(droppedFiles);
                    }}
                    onClick={() => pickFiles(true)}
                  >
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      {registryKeys.length > 0 ? '+ Add more client instruction files' : 'Drop the client instruction emails here, or click to browse'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      .msg, .eml, .pdf — then assign one to each client below
                    </div>
                    {graphConnection.connected && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setOutlookPicker('bulk'); }}
                        style={{
                          marginTop: '8px', padding: '4px 14px', fontSize: '11px', fontWeight: 500,
                          border: '1px solid #0ea5e9', borderRadius: '4px',
                          background: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9', cursor: 'pointer'
                        }}
                      >
                        Pick from Outlook
                      </button>
                    )}
                  </div>

                  {/* One instruction per client */}
                  {rows.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>Instruction per client</span>
                        <span style={{ fontSize: '11px', fontWeight: '600', color: assignedCount === rows.length ? 'var(--gain-color)' : 'var(--warning-color)' }}>
                          {assignedCount} of {rows.length} client{rows.length > 1 ? 's' : ''} covered
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {rows.map(({ row, origIdx }) => {
                          const account = (bulkAccountsMap[origIdx] || []).find(a => a._id === row.bankAccountId);
                          const covered = !!(row.traceFileKey && bulkTraceFiles[row.traceFileKey]);
                          return (
                            <div key={origIdx} style={{
                              display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                              padding: '8px 10px', background: 'var(--bg-primary)',
                              border: '1px solid var(--border-color)',
                              borderLeft: `3px solid ${covered ? 'var(--gain-color)' : 'var(--loss-color)'}`,
                              borderRadius: '8px'
                            }}>
                              <div style={{ flex: 2, minWidth: '140px', overflow: 'hidden' }}>
                                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bulkRowClientName(row)}</div>
                                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {account ? `${account.bankName} - ${account.accountNumber}` : row.accountLabel}
                                  {row.quantity ? ` · ${parseFloat(row.quantity).toLocaleString('en-US')}` : ''}
                                </div>
                              </div>
                              <select
                                value={row.traceFileKey && bulkTraceFiles[row.traceFileKey] ? row.traceFileKey : ''}
                                onChange={(e) => {
                                  if (e.target.value === '__browse__') {
                                    pickFiles(false, (keys) => assignTraceFile(origIdx, keys[0]));
                                    return;
                                  }
                                  assignTraceFile(origIdx, e.target.value || null);
                                }}
                                style={{ ...styles.input, marginBottom: '0', flex: 3, minWidth: '180px', padding: '6px 8px', fontSize: '12px' }}
                              >
                                <option value="">— select instruction —</option>
                                {registryKeys.map((key) => (
                                  <option key={key} value={key}>{bulkTraceFiles[key].name}</option>
                                ))}
                                <option value="__browse__">+ Browse for a file…</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </>
        ) : (
          <>
            <label style={{ ...styles.label, marginBottom: '6px' }}>
              Client Order Email *
            </label>

            {/* Show the attached file */}
            {!isBulkMode && clientOrderFile && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
                padding: '8px 12px', background: 'rgba(16, 185, 129, 0.05)',
                border: '2px solid var(--gain-color)', borderRadius: '8px'
              }}>
                <span style={{ fontSize: '16px' }}>📎</span>
                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--gain-color)', flex: 1 }}>{clientOrderFile.name}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  ({(clientOrderFile.size / 1024).toFixed(0)} KB)
                </span>
                <button
                  style={{ background: 'none', border: 'none', color: 'var(--loss-color)', cursor: 'pointer', fontSize: '14px', padding: '2px 6px' }}
                  onClick={() => setClientOrderFile(null)}
                  title="Remove file"
                >
                  x
                </button>
              </div>
            )}

            {/* Drop zone / file picker — shown while no file is attached */}
            {!clientOrderFile && (
              <div
                style={{
                  border: '2px dashed var(--border-color)',
                  borderRadius: '8px',
                  padding: '16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: 'var(--bg-secondary)',
                  transition: 'border-color 0.15s, background 0.15s'
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.style.borderColor = 'var(--gain-color)';
                  e.currentTarget.style.background = 'rgba(16, 185, 129, 0.05)';
                }}
                onDragLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.background = 'var(--bg-secondary)';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.background = 'var(--bg-secondary)';

                  // Collect files from dataTransfer.files, falling back to .items
                  // (some drag sources only populate one of the two)
                  let droppedFiles = Array.from(e.dataTransfer.files || []);
                  if (droppedFiles.length === 0 && e.dataTransfer.items) {
                    droppedFiles = Array.from(e.dataTransfer.items)
                      .filter(item => item.kind === 'file')
                      .map(item => item.getAsFile())
                      .filter(Boolean);
                  }

                  // Dragging an email straight from Outlook doesn't hand the browser a real
                  // file — explain instead of failing silently
                  if (droppedFiles.length === 0) {
                    setError('No file received. Dragging directly from Outlook is not supported by the browser — first drag the email to your desktop (this saves it as a .msg file), then drop that file here, or click to browse.');
                    return;
                  }

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
                    setClientOrderFile(validFiles[0]);
                    setError(null);
                  }
                }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = EMAIL_TRACE_ACCEPTED_TYPES.join(',');
                  input.onchange = (e) => {
                    const selectedFiles = Array.from(e.target.files);
                    for (const file of selectedFiles) {
                      if (file.size > EMAIL_TRACE_MAX_SIZE) {
                        setError(`${file.name} exceeds maximum size of 15MB`);
                        return;
                      }
                    }
                    if (selectedFiles.length > 0) {
                      setClientOrderFile(selectedFiles[0]);
                      setError(null);
                    }
                  };
                  input.click();
                }}
              >
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Drop client order email here, or click to browse
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  .msg, .eml, .pdf — Visible to validators for four-eyes check
                </div>
                {graphConnection.connected && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOutlookPicker('single'); }}
                    style={{
                      marginTop: '8px', padding: '4px 14px', fontSize: '11px', fontWeight: 500,
                      border: '1px solid #0ea5e9', borderRadius: '4px',
                      background: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9', cursor: 'pointer'
                    }}
                  >
                    Pick from Outlook
                  </button>
                )}
              </div>
            )}

            {/* Defer-attach attestation: lets the creator submit without a file
                when uploading is impractical (mobile, technical issue). Bulk mode
                always requires real files and never shows this. */}
            {!isBulkMode && !clientOrderFile && (
              <div style={{
                marginTop: '10px',
                padding: '10px 12px',
                background: deferAttachment ? 'rgba(249, 115, 22, 0.08)' : 'var(--bg-secondary)',
                border: `1px solid ${deferAttachment ? '#f97316' : 'var(--border-color)'}`,
                borderRadius: '8px'
              }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={deferAttachment}
                    onChange={(e) => setDeferAttachment(e.target.checked)}
                    style={{ marginTop: '2px', cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: deferAttachment ? '#f97316' : 'var(--text-primary)' }}>
                      I have the client order and I will attach it later
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      You take responsibility for ensuring the original client instruction is attached to this order. The validator will see this and confirm they checked the source.
                    </div>
                  </div>
                </label>
              </div>
            )}
          </>
        )}
      </div>

      {assetType === ASSET_TYPES.STRUCTURED_PRODUCT && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Order to Issuer *</label>
          {issuerOrderFile ? (
            <div style={{
              border: '2px solid var(--gain-color)', background: 'rgba(16, 185, 129, 0.08)',
              borderRadius: '8px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <span style={{ fontSize: '18px' }}>🏦</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--gain-color)', flex: 1, wordBreak: 'break-all' }}>{issuerOrderFile.name}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({(issuerOrderFile.size / 1024).toFixed(0)} KB)</span>
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'var(--loss-color)', cursor: 'pointer', fontSize: '14px', padding: '2px 6px' }}
                onClick={() => setIssuerOrderFile(null)}
                title="Remove file"
              >
                x
              </button>
            </div>
          ) : (
            <div
              style={{
                border: '2px dashed var(--border-color)', borderRadius: '8px', padding: '16px',
                textAlign: 'center', cursor: 'pointer', background: 'var(--bg-secondary)'
              }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files?.[0];
                if (!file) {
                  setError('No file received. Dragging directly from Outlook is not supported by the browser — first drag the email to your desktop, then drop that file here, or click to browse.');
                  return;
                }
                acceptIssuerOrderFile(file);
              }}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = EMAIL_TRACE_ACCEPTED_TYPES.join(',');
                input.onchange = (e) => acceptIssuerOrderFile(e.target.files?.[0]);
                input.click();
              }}
            >
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Drop the order sent to the issuer here, or click to browse
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                .msg, .eml, .pdf — Visible to validators for four-eyes check
              </div>
              {graphConnection.connected && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setOutlookPicker('issuer'); }}
                  style={{
                    marginTop: '8px', padding: '4px 14px', fontSize: '11px', fontWeight: 500,
                    border: '1px solid #0ea5e9', borderRadius: '4px',
                    background: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9', cursor: 'pointer'
                  }}
                >
                  Pick from Outlook
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Execution Type Toggle */}
      <div style={styles.formGroup}>
        <label style={styles.label}>Execution Type</label>
        <div style={{ display: 'flex', gap: '0', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
          {[
            { value: EXECUTION_TYPES.TO_EXECUTE, label: 'To Be Executed' },
            { value: EXECUTION_TYPES.PRE_EXECUTED, label: 'Pre-Executed' }
          ].map(({ value, label }) => (
            <button
              key={value}
              type="button"
              style={{
                flex: 1, padding: '8px 12px', border: 'none',
                background: executionType === value ? 'var(--accent-color)' : 'var(--bg-secondary)',
                color: executionType === value ? '#fff' : 'var(--text-secondary)',
                fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s'
              }}
              onClick={() => { setExecutionType(value); setExecutionTypeTouched(true); }}
            >
              {label}
            </button>
          ))}
        </div>
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
            padding: '14px 16px',
            background: isBulkMode ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-secondary)',
            borderRadius: '8px',
            border: `1px solid ${isBulkMode ? 'rgba(99, 102, 241, 0.3)' : 'var(--border-color)'}`,
            marginBottom: '20px',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }} onClick={() => {
            const next = !isBulkMode;
            setIsBulkMode(next);
            if (!next) {
              setBulkOrders([emptyBulkRow()]);
              setBulkAccountsMap({});
              setBulkAccountsLoading({});
              setBulkTraceFiles({});
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
          <div style={{ ...styles.formGroup, marginBottom: 0 }}>
            <label style={styles.label}>Client & Account</label>
            <AccountAutocomplete
              ordersOnly
              value={selectedAccountLabel}
              disabled={!!(prefillData?.clientId && prefillData?.bankAccountId)}
              onSelect={({ clientId, entityId, bankAccountId, accountLabel }) => {
                setSelectedClientId(clientId || entityId);
                setSelectedEntityId(entityId);
                setSelectedBankAccountId(bankAccountId);
                setSelectedAccountLabel(accountLabel);
              }}
            />
          </div>
        ) : (
          /* Bulk Mode */
          <div>
            {bulkOrders.map((order, index) => {
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
                  <AccountAutocomplete
                    ordersOnly
                    value={order.accountLabel || ''}
                    onSelect={({ clientId, entityId, bankAccountId, accountLabel }) => {
                      // Set all fields at once to avoid the clientId change handler resetting bankAccountId
                      const updated = [...bulkOrders];
                      updated[index] = {
                        ...updated[index],
                        clientId: clientId || entityId || '',
                        entityId: entityId || '',
                        bankAccountId,
                        accountLabel
                      };
                      setBulkOrders(updated);
                    }}
                  />
                  {isDuplicate && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--warning-color)' }}>
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
    const selectedClient = findClientById(availableClients, selectedClientId);
    const selectedAccount = clientBankAccounts.find(a => a._id === selectedBankAccountId);

    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <span style={styles.orderTypeBadge(assetType === ASSET_TYPES.TERM_DEPOSIT && depositAction === 'decrease' ? 'sell' : mode)}>
            {assetType === ASSET_TYPES.TERM_DEPOSIT
              ? (depositAction === 'increase' ? 'INCREASE' : 'DECREASE') + ' TERM DEPOSIT'
              : assetType === ASSET_TYPES.FX
                ? `FX ${fxSubtype === FX_SUBTYPES.FORWARD ? 'FORWARD' : 'SPOT'} — BUY ${fxBuyCurrency || '—'} / SELL ${fxSellCurrency || '—'}`
                : mode.toUpperCase() + ' ORDER'}
          </span>
          <div style={{
            marginTop: '8px',
            fontSize: '12px',
            fontWeight: '600',
            color: executionType === EXECUTION_TYPES.PRE_EXECUTED ? 'var(--warning-color)' : 'var(--text-secondary)',
          }}>
            {EXECUTION_TYPE_LABELS[executionType]}
          </div>
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
        {/* Short-call cover. Never blocks: it states the position plainly and
            lets the desk add a reason, and the four-eyes validator decides. */}
        {isCheckingCoverage && (
          <div style={{
            padding: '12px 16px', marginBottom: '16px', borderRadius: '8px',
            background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.3)',
            fontSize: '13px', color: '#6366f1', textAlign: 'center'
          }}>
            Checking cover against the position...
          </div>
        )}
        {!isCheckingCoverage && isWritingCall && effectiveCoverage && (() => {
          const covered = effectiveCoverage.isCovered;
          const accent = covered ? 'var(--gain-color)' : 'var(--warning-color)';
          const fmt = (n) => Number(n || 0).toLocaleString('en-US');
          return (
            <div style={{
              padding: '14px 16px', marginBottom: '16px', borderRadius: '8px',
              background: covered ? 'rgba(16, 185, 129, 0.06)' : 'rgba(245, 158, 11, 0.08)',
              border: `1px solid ${covered ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.35)'}`
            }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: accent, marginBottom: '10px' }}>
                {covered ? 'Covered call' : 'Uncovered short call'}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                {[
                  { label: 'To deliver', value: fmt(effectiveCoverage.requiredShares) },
                  { label: 'Held', value: fmt(effectiveCoverage.heldShares) },
                  ...(effectiveCoverage.committedShares
                    ? [{ label: 'Already written', value: fmt(effectiveCoverage.committedShares) }]
                    : []),
                  { label: covered ? 'Still available' : 'Short by',
                    value: fmt(covered ? effectiveCoverage.availableShares - effectiveCoverage.requiredShares : effectiveCoverage.shortfallShares),
                    accent: !covered }
                ].map(cell => (
                  <div key={cell.label} style={{ padding: '8px 10px', background: 'var(--bg-primary)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{cell.label}</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: '700', color: cell.accent ? accent : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {cell.value}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                {parseFloat(quantity) || 0} contracts x {parseFloat(optionContractSize) || DEFAULT_OPTION_CONTRACT_SIZE} shares
                {effectiveCoverage.underlyingName ? ` of ${effectiveCoverage.underlyingName}` : ''}, in this account
                {effectiveCoverage.committedOrderRefs?.length
                  ? ` - already written by ${effectiveCoverage.committedOrderRefs.join(', ')}`
                  : ''}
              </div>

              {!covered && (
                <div style={{ marginTop: '12px' }}>
                  <label style={{ ...styles.label, color: accent }}>Reason (optional)</label>
                  <textarea
                    style={{ ...styles.textarea, minHeight: '54px' }}
                    value={coverageJustification}
                    onChange={(e) => setCoverageJustification(e.target.value)}
                    placeholder="Why is this being written uncovered? Shown to the validator."
                  />
                </div>
              )}
            </div>
          );
        })()}
        {allocationCheck?.hasProfile && (
          <div style={{
            padding: '14px 16px', marginBottom: '16px', borderRadius: '8px',
            background: allocationCheck.hasBreaches ? 'rgba(245, 158, 11, 0.08)' : 'rgba(99, 102, 241, 0.05)',
            border: `1px solid ${allocationCheck.hasBreaches ? 'rgba(245, 158, 11, 0.3)' : 'rgba(99, 102, 241, 0.15)'}`
          }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: allocationCheck.hasBreaches ? 'var(--warning-color)' : 'var(--text-primary)', marginBottom: '10px' }}>
              {allocationCheck.hasBreaches
                ? `Investment Profile Warning${allocationCheck.profileName ? ` — ${allocationCheck.profileName}` : ''}`
                : `Allocation Impact${allocationCheck.profileName ? ` — ${allocationCheck.profileName}` : ''}`}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { key: 'cash', label: 'Cash', icon: '💵', color: 'var(--info-color)' },
                { key: 'bonds', label: 'Bonds', icon: '📄', color: 'var(--gain-color)' },
                { key: 'equities', label: 'Equities', icon: '📈', color: 'var(--warning-color)' },
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
                        color: isOverLimit ? 'var(--loss-color)' : 'var(--text-primary)',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}>
                        {showProjected ? (
                          <>
                            {current.toFixed(1)}% → <span style={{ color: isOverLimit ? 'var(--loss-color)' : item.color }}>{projected.toFixed(1)}%</span>
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
                          ? 'linear-gradient(90deg, var(--loss-color) 0%, #dc2626 100%)'
                          : `linear-gradient(90deg, ${item.color} 0%, color-mix(in srgb, ${item.color} 87%, transparent) 100%)`,
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
                            : `repeating-linear-gradient(90deg, color-mix(in srgb, ${item.color} 40%, transparent) 0px, color-mix(in srgb, ${item.color} 40%, transparent) 3px, color-mix(in srgb, ${item.color} 20%, transparent) 3px, color-mix(in srgb, ${item.color} 20%, transparent) 6px)`,
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
                          background: `repeating-linear-gradient(90deg, color-mix(in srgb, ${item.color} 20%, transparent) 0px, color-mix(in srgb, ${item.color} 20%, transparent) 3px, transparent 3px, transparent 6px)`,
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
                <span style={styles.reviewValue}>{parseFloat(quantity).toLocaleString('en-US')} {fxAmountCurrency === 'buy' ? fxBuyCurrency : fxSellCurrency}</span>
              </div>
              {Number.isFinite(Number(fxSpotRate)) && (
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Indicative Spot</span>
                  <span style={styles.reviewValue}>{Number(fxSpotRate).toFixed(4)}</span>
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
                    <div key={i} style={{ fontSize: '12px', color: 'var(--warning-color)', marginBottom: i < fxWarnings.length - 1 ? '4px' : 0 }}>
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
                  color: depositAction === 'increase' ? 'var(--gain-color)' : 'var(--loss-color)'
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
            assetType === ASSET_TYPES.OPTION ? (
            <>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Contract</span>
                <span style={{ ...styles.reviewValue, fontWeight: '600' }}>{buildOptionContractName()}</span>
              </div>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Underlying</span>
                <span style={styles.reviewValue}>{selectedSecurity?.name}{selectedSecurity?.isin ? ` (${selectedSecurity.isin})` : ''}</span>
              </div>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Call / Put</span>
                <span style={styles.reviewValue}>{(optionType || '').toUpperCase()}</span>
              </div>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Strike</span>
                <span style={styles.reviewValue}>{optionStrike}</span>
              </div>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Expiry</span>
                <span style={styles.reviewValue}>{optionExpiry ? new Date(optionExpiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</span>
              </div>
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Contract Size</span>
                <span style={styles.reviewValue}>
                  {(parseFloat(optionContractSize) || DEFAULT_OPTION_CONTRACT_SIZE).toLocaleString('en-US')} shares
                  {optionShareEquivalent > 0 ? ` (${optionShareEquivalent.toLocaleString('en-US')} in total)` : ''}
                </span>
              </div>
              {optionExchange && optionExchange.trim() && (
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Exchange</span>
                  <span style={styles.reviewValue}>{optionExchange.trim()}</span>
                </div>
              )}
              {!optionManualEntry && optionContractSymbol && (
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Contract Symbol</span>
                  <span style={{ ...styles.reviewValue, fontFamily: 'monospace' }}>{optionContractSymbol}</span>
                </div>
              )}
              {!optionManualEntry && optionQuote && (optionQuote.bid != null || optionQuote.last > 0) && (
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Reference Premium</span>
                  <span style={styles.reviewValue}>
                    {optionQuote.bid != null && optionQuote.ask != null ? `${optionQuote.bid} / ${optionQuote.ask}` : `last ${optionQuote.last}`}
                    {optionQuote.impliedVolatility != null ? ` · IV ${Number(optionQuote.impliedVolatility).toFixed(1)}%` : ''}
                    {optionQuote.updatedAt ? ` · EOD ${optionQuote.updatedAt}` : ''}
                  </span>
                </div>
              )}
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
          ))}
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
              <span style={styles.reviewLabel}>{assetType === ASSET_TYPES.TERM_DEPOSIT ? 'Amount' : assetType === ASSET_TYPES.STRUCTURED_PRODUCT ? 'Nominal' : assetType === ASSET_TYPES.OPTION ? 'Contracts' : assetType === ASSET_TYPES.FUND ? (fundQuantityMode === FUND_QUANTITY_MODES.NOMINAL ? 'Nominal Amount' : 'Units') : 'Quantity'}</span>
              <span style={styles.reviewValue}>{OrderFormatters.formatQuantity(parseFloat(quantity) || 0)}</span>
            </div>
          )}
          {assetType !== ASSET_TYPES.TERM_DEPOSIT && assetType !== ASSET_TYPES.STRUCTURED_PRODUCT && (
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
              <span style={styles.reviewLabel}>{assetType === ASSET_TYPES.STRUCTURED_PRODUCT ? 'Price' : assetType === ASSET_TYPES.OPTION ? 'Premium (per share)' : 'Limit Price'}</span>
              <span style={styles.reviewValue}>
                {assetType === ASSET_TYPES.STRUCTURED_PRODUCT
                  ? `${parseFloat(limitPrice) || 0}%`
                  : OrderFormatters.formatWithCurrency(parseFloat(limitPrice) || 0, getCurrencyForDisplay())}
              </span>
            </div>
          )}
          {estimatedValue && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Estimated Value</span>
              <span style={styles.reviewValue}>{OrderFormatters.formatWithCurrency(parseFloat(estimatedValue) || 0, getCurrencyForDisplay())}</span>
            </div>
          )}
          {assetType === ASSET_TYPES.STRUCTURED_PRODUCT && issuerId && (() => {
            const iss = issuers.find(i => i._id === issuerId);
            if (!iss) return null;
            const contact = [iss.contactName, iss.contactEmail, iss.contactPhone].filter(Boolean).join(' · ');
            return (
              <>
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Counterparty</span>
                  <span style={styles.reviewValue}>{iss.name}{iss.code ? ` (${iss.code})` : ''}</span>
                </div>
                <div style={styles.reviewRow}>
                  <span style={styles.reviewLabel}>Counterparty Contact</span>
                  <span style={styles.reviewValue}>{contact || 'None on file'}</span>
                </div>
              </>
            );
          })()}
          {broker && assetType !== ASSET_TYPES.STRUCTURED_PRODUCT && (
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
          {((priceType !== PRICE_TYPES.MARKET) || (assetType === ASSET_TYPES.FX && limitPrice)) && assetType !== ASSET_TYPES.TERM_DEPOSIT && assetType !== ASSET_TYPES.STRUCTURED_PRODUCT && (
            <div style={styles.reviewRow}>
              <span style={styles.reviewLabel}>Validity</span>
              <span style={styles.reviewValue}>
                {validityType === VALIDITY_TYPES.GTC ? 'Good Till Canceled' : validityType === VALIDITY_TYPES.GTD ? `Good Till ${validityDate || 'Date'}` : 'Day Order'}
              </span>
            </div>
          )}
        </div>

        {(attachedTakeProfit || attachedStopLoss) && (mode === 'buy' || assetType === ASSET_TYPES.FX) && (
          <div style={styles.reviewSection}>
            <div style={styles.reviewTitle}>Linked Orders</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Separate orders will be created with the same reference number
            </div>
            {attachedTakeProfit && (
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Take Profit</span>
                <span style={{ ...styles.reviewValue, color: 'var(--gain-color)', fontWeight: '600' }}>
                  {OrderFormatters.formatWithCurrency(parseFloat(attachedTakeProfit), getCurrencyForDisplay())}
                </span>
              </div>
            )}
            {attachedStopLoss && (
              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Stop Loss</span>
                <span style={{ ...styles.reviewValue, color: 'var(--loss-color)', fontWeight: '600' }}>
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
              const client = findClientById(availableClients, order.clientId);
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
              <span style={styles.reviewLabel}>Account</span>
              <span style={styles.reviewValue}>
                {selectedAccountLabel || (selectedClient ? `${selectedClient.profile?.firstName} ${selectedClient.profile?.lastName}` : 'N/A')}
              </span>
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
                background: 'rgba(59, 130, 246, 0.1)', color: 'var(--info-color)',
                fontSize: '12px', fontWeight: '600'
              }}>
                📞 Phone Order
              </span>
              {phoneCallTime && (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Call at {new Date(phoneCallTime).toLocaleString()}
                </span>
              )}
              {phoneCallLine && (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Line: {phoneCallLine}
                </span>
              )}
            </div>
          </div>
        )}
        {isBulkMode && validBulkRows().length > 0 && (
          <div style={styles.reviewSection}>
            <div style={styles.reviewTitle}>
              {orderSource === ORDER_SOURCE_TYPES.PHONE ? 'Phone instruction per client' : 'Client instruction per client'}
            </div>
            {validBulkRows().map(({ row, origIdx }) => {
              const account = (bulkAccountsMap[origIdx] || []).find(a => a._id === row.bankAccountId);
              const file = row.traceFileKey ? bulkTraceFiles[row.traceFileKey] : null;
              return (
                <div key={origIdx} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12px', padding: '5px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <span style={{ flex: 2, minWidth: '120px', fontWeight: '600', color: 'var(--text-primary)' }}>{bulkRowClientName(row)}</span>
                  <span style={{ flex: 2, minWidth: '120px', color: 'var(--text-secondary)' }}>
                    {account ? `${account.bankName} - ${account.accountNumber}` : row.accountLabel}
                  </span>
                  <span style={{ flex: 3, minWidth: '160px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {orderSource === ORDER_SOURCE_TYPES.PHONE ? (
                      <>
                        <span>📞</span>
                        <span>{rowPhoneCallTime(row) ? new Date(rowPhoneCallTime(row)).toLocaleString() : 'No call time'}</span>
                        {rowPhoneCallLine(row) && <span style={{ color: 'var(--text-muted)' }}>· {rowPhoneCallLine(row)}</span>}
                      </>
                    ) : file ? (
                      <>
                        <span>📎</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({(file.size / 1024).toFixed(0)} KB)</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--loss-color)', fontWeight: '600' }}>No instruction attached</span>
                    )}
                  </span>
                </div>
              );
            })}
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
    // Only offer positions matching the selected asset type — selling a fund
    // shouldn't list structured products.
    const typeHoldings = accountHoldings.filter(h => assetTypeForAssetClass(h.assetClass) === assetType);
    // Does selling this asset type mean selling an existing position?
    //
    // For equities, funds and the rest, yes: the sell side starts from a holding
    // in the book. FX and term deposits aren't positions at all. A listed option
    // is the third case: selling one WRITES the contract - it is a sale to open,
    // and nothing exists in the book to pick from. Showing those desks a
    // "Positions Available / No Option positions available" panel asks them for
    // something that cannot exist. Cover on a short call is checked separately,
    // against the UNDERLYING, and it flags rather than blocks.
    const sellsFromPosition = assetType !== ASSET_TYPES.FX
      && assetType !== ASSET_TYPES.TERM_DEPOSIT
      && assetType !== ASSET_TYPES.OPTION;
    const filteredHoldings = typeHoldings.filter(h => {
      if (!holdingSearchQuery) return true;
      const q = holdingSearchQuery.toLowerCase();
      return (h.securityName || '').toLowerCase().includes(q) || (h.isin || '').toLowerCase().includes(q);
    });

    const selectedAccount = clientBankAccounts.find(a => a._id === selectedBankAccountId);

    return (
      <div>
        {/* Asset Type */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Asset Type</label>
          <select
            style={styles.select}
            value={assetType}
            onChange={(e) => {
              setAssetType(e.target.value);
              setError(null);
              if (e.target.value === ASSET_TYPES.FX || e.target.value === ASSET_TYPES.TERM_DEPOSIT) {
                setSelectedHolding(null);
                setSelectedSecurity(null);
                setSearchQuery('');
                setSearchResults([]);
                setHoldingSearchQuery('');
              }
              // FX direction is encoded by fxBuyCurrency/fxSellCurrency; pin mode='buy' as a neutral default
              if (e.target.value === ASSET_TYPES.FX) {
                setMode('buy');
                setSellManualSearch(false);
              }
              // Term deposit direction is encoded by depositAction (increase/decrease);
              // carry over the buy/sell intent then pin mode='buy' as a neutral default
              if (e.target.value === ASSET_TYPES.TERM_DEPOSIT) {
                setDepositAction(mode === 'sell' ? 'decrease' : 'increase');
                setMode('buy');
                setSellManualSearch(false);
              }
              // Options keep the buy/sell intent — direction is real — but never
              // carry a source holding: the contract is opened by this order, and
              // a holding left over from an equity sell would be sent as the
              // position being closed.
              if (e.target.value === ASSET_TYPES.OPTION) {
                setSelectedHolding(null);
                setSellManualSearch(false);
                setForceWithoutSourceHolding(false);
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
            <option value={ASSET_TYPES.OPTION}>Listed Option</option>
            <option value={ASSET_TYPES.OTHER}>Other</option>
          </select>
        </div>

        {/* Buy/Sell Toggle — hidden for FX (direction encoded by currency pair) and
            Term Deposits (direction encoded by the Increase/Decrease toggle) */}
        {assetType !== ASSET_TYPES.FX && assetType !== ASSET_TYPES.TERM_DEPOSIT && (
        <div style={styles.formGroup}>
          <label style={styles.label}>Order Type</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { setMode('buy'); setSelectedHolding(null); setSelectedSecurity(null); setSearchQuery(''); setQuantity(''); setSellManualSearch(false); }}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '8px',
                border: `2px solid ${mode === 'buy' ? 'var(--gain-color)' : 'var(--border-color)'}`,
                background: mode === 'buy' ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-secondary)',
                color: mode === 'buy' ? 'var(--gain-color)' : 'var(--text-secondary)',
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
                border: `2px solid ${mode === 'sell' ? 'var(--loss-color)' : 'var(--border-color)'}`,
                background: mode === 'sell' ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-secondary)',
                color: mode === 'sell' ? 'var(--loss-color)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '15px',
                transition: 'all 0.2s ease'
              }}
            >
              SELL
            </button>
          </div>
          {assetType === ASSET_TYPES.OPTION && (
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px' }}>
              {mode === 'sell'
                ? 'Selling writes the contract — there is no existing position to pick. Cover on a short call is checked against the underlying below.'
                : 'Buying pays the premium and opens the contract.'}
            </div>
          )}
        </div>
        )}

        {/* Cash Balance - show for buy, and for FX/Term Deposit in either mode */}
        {(mode === 'buy' || assetType === ASSET_TYPES.FX || assetType === ASSET_TYPES.TERM_DEPOSIT) && !isBulkMode && (
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
                      color: pos.amount >= 0 ? 'var(--gain-color)' : 'var(--loss-color)',
                      fontSize: '13px'
                    }}>
                      {pos.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>N/A</span>
            )}

            {/* Money market funds and term deposits: liquidity the client holds,
                but it settles nothing until it is sold. Listed under its own
                heading so the cash figures above still reconcile with the PMS. */}
            {!isLoadingCash && cashBalance?.nearCashPositions?.length > 0 && (
              <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--border-color)' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Money market &amp; deposits <span style={{ fontStyle: 'italic' }}>— sell to settle</span>
                </div>
                {cashBalance.nearCashPositions.map((pos, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={pos.names?.join(', ') || pos.currency}>
                      {pos.currency}{pos.name ? ` · ${pos.name}` : ''}
                    </span>
                    <span style={{ fontWeight: '600', color: 'var(--text-secondary)', fontSize: '13px', whiteSpace: 'nowrap' }}>
                      {pos.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bulk mode: per-account cash / positions summary */}
        {isBulkMode && bulkOrders.some(o => o.clientId && o.bankAccountId) && (() => {
          const validBulkOrders = bulkOrders.filter(o => o.clientId && o.bankAccountId);
          const showCash = mode === 'buy' || assetType === ASSET_TYPES.FX || assetType === ASSET_TYPES.TERM_DEPOSIT;
          const showPositions = mode === 'sell' && assetType !== ASSET_TYPES.FX && assetType !== ASSET_TYPES.TERM_DEPOSIT;
          if (!showCash && !showPositions) return null;
          return (
            <div style={{
              padding: '10px 14px',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {showCash ? 'Cash Available per Account' : 'Positions Available per Account'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '320px', overflowY: 'auto' }}>
                {validBulkOrders.map(o => {
                  const key = `${o.clientId}_${o.bankAccountId}`;
                  const cash = bulkCashBalances[key];
                  const holdings = bulkAccountHoldings[key]
                    && bulkAccountHoldings[key].filter(h => assetTypeForAssetClass(h.assetClass) === assetType);
                  return (
                    <div key={key} style={{ paddingBottom: '8px', borderBottom: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.accountLabel || `${o.clientId} / ${o.bankAccountId}`}
                      </div>
                      {showCash ? (
                        !cash ? (
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Loading...</span>
                        ) : cash.cashPositions?.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {cash.cashPositions.map((pos, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{pos.currency}</span>
                                <span style={{ fontWeight: '600', color: pos.amount >= 0 ? 'var(--gain-color)' : 'var(--loss-color)', fontSize: '12px' }}>
                                  {pos.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>N/A</span>
                        )
                      ) : (
                        !holdings ? (
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Loading...</span>
                        ) : holdings.length === 0 ? (
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No positions</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {holdings.slice(0, 20).map(h => (
                              <div key={h._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                  {h.securityName} <span style={{ opacity: 0.7 }}>({h.isin})</span>
                                </span>
                                <span style={{ fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap' }}>
                                  {h.quantity?.toLocaleString('en-US')} · {h.currency} {h.marketValue?.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                </span>
                              </div>
                            ))}
                            {holdings.length > 20 && (
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>+ {holdings.length - 20} more</span>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Positions Available (sell mode) - mirror the Cash Available panel */}
        {mode === 'sell' && !isBulkMode && sellsFromPosition && !(selectedHolding || selectedSecurity) && (
          <div style={{
            padding: '10px 14px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: typeHoldings.length > 0 ? '8px' : '0' }}>
              Positions Available
            </div>
            {isLoadingHoldings ? (
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Loading...</span>
            ) : typeHoldings.length === 0 ? (
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>No {OrderFormatters.getAssetTypeLabel(assetType)} positions available</span>
            ) : (
              <>
                {typeHoldings.length > 6 && (
                  <input
                    type="text"
                    style={{ ...styles.input, marginBottom: '8px', fontSize: '13px', padding: '6px 10px' }}
                    value={holdingSearchQuery}
                    onChange={(e) => setHoldingSearchQuery(e.target.value)}
                    placeholder="Filter positions..."
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '280px', overflowY: 'auto' }}>
                  {filteredHoldings.length === 0 ? (
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>No matching positions</span>
                  ) : filteredHoldings.map(holding => (
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
                        if (holding.marketPrice) {
                          setIndicativePrice(holding.marketPrice);
                        }
                        setIndicativePriceCurrency(holding.currency || null);
                        setSettlementCurrency(holding.currency || '');
                        setEstimatedValueManuallyEdited(false);
                        if (holding.isin) {
                          enrichFromProduct(holding.isin);
                        }
                        if (holding.assetClass) {
                          setAssetType(assetTypeForAssetClass(holding.assetClass));
                        }
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ minWidth: 0, flex: 1, paddingRight: '8px' }}>
                        <div style={{ fontSize: '13px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{holding.securityName}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{holding.isin}</div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: '13px', fontWeight: '600' }}>
                          Qty: {holding.quantity?.toLocaleString('en-US')}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {holding.currency} {holding.marketValue?.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Selected security display (both modes) */}
        {(selectedHolding || selectedSecurity) && mode === 'sell' && !isBulkMode && sellsFromPosition && (
          <div style={styles.formGroup}>
            <label style={styles.label}>Selected Position</label>
            <div style={styles.selectedSecurity}>
              <div>
                <div style={{ fontWeight: '500' }}>{selectedHolding?.securityName || selectedSecurity?.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {selectedHolding?.isin || selectedSecurity?.isin}
                  {selectedHolding ? ` | Qty: ${selectedHolding.quantity?.toLocaleString('en-US')}` : ''}
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
          </div>
        )}

        {/* Security search (buy mode, bulk mode, FX/TD forms, or sell manual search).
            In sell manual mode, once a security is picked the "Selected Position" panel
            above already shows it with a Change button — don't render the search step's
            duplicate "Search Security" card. */}
        {(mode === 'buy' || isBulkMode || !sellsFromPosition
          || (sellManualSearch && !(selectedHolding || selectedSecurity))) && renderStep1()}

        {/* Sell manual-entry escape hatch */}
        {mode === 'sell' && !sellManualSearch && !isBulkMode && sellsFromPosition && !(selectedHolding || selectedSecurity) && (
          <div style={{ marginTop: '-8px' }}>
            <span
              style={{ fontSize: '12px', color: 'var(--accent-color)', cursor: 'pointer' }}
              onClick={() => setSellManualSearch(true)}
            >
              + Holding not listed? Enter manually or search
            </span>
          </div>
        )}
        {mode === 'sell' && sellManualSearch && (
          <div style={{ marginTop: '8px' }}>
            <span
              style={{ fontSize: '12px', color: 'var(--accent-color)', cursor: 'pointer' }}
              onClick={() => { setSellManualSearch(false); setSelectedSecurity(null); setSearchQuery(''); setForceWithoutSourceHolding(false); }}
            >
              ← Back to positions list
            </span>
          </div>
        )}

        {/* Force-override: allow sell without a source holding (bank-side discrepancy) */}
        {mode === 'sell' && !isBulkMode && !selectedHolding && sellsFromPosition && (sellManualSearch || selectedSecurity) && (
          <div style={{
            marginTop: '12px',
            padding: '10px 12px',
            background: forceWithoutSourceHolding ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-secondary)',
            border: `1px solid ${forceWithoutSourceHolding ? 'var(--loss-color)' : 'var(--border-color)'}`,
            borderRadius: '8px'
          }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={forceWithoutSourceHolding}
                onChange={(e) => setForceWithoutSourceHolding(e.target.checked)}
                style={{ marginTop: '2px', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: '12px', fontWeight: '600', color: forceWithoutSourceHolding ? 'var(--loss-color)' : 'var(--text-primary)' }}>
                  Force sell without source holding
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Use when the position is not in PMS (bank-side accounting discrepancy). The sell order will be created without the standard quantity check.
                </div>
              </div>
            </label>
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

  const confirmVariant = (assetType === ASSET_TYPES.TERM_DEPOSIT
    ? depositAction === 'increase'
    : assetType === ASSET_TYPES.FX ? true : mode === 'buy') ? 'success' : 'danger';

  const confirmLabel = isSubmitting ? 'Creating...' : isBulkMode
    ? `Confirm ${bulkOrders.filter(o => o.clientId && o.bankAccountId).length} Orders`
    : `Confirm ${assetType === ASSET_TYPES.TERM_DEPOSIT ? (depositAction === 'increase' ? 'INCREASE' : 'DECREASE') : assetType === ASSET_TYPES.FX ? 'FX ORDER' : mode.toUpperCase()}`;

  // 'large' clears the ~44px minimum touch target; 'medium' renders ~32px tall.
  const mobileBtnSize = isMobile ? 'large' : 'medium';

  const primaryAction = currentStep < 4 ? (
    <ActionButton variant="primary" onClick={handleNext} fullWidth={isMobile} size={mobileBtnSize}>
      Continue
    </ActionButton>
  ) : (
    <ActionButton
      variant={confirmVariant}
      onClick={handleSubmit}
      loading={isSubmitting}
      fullWidth={isMobile}
      size={mobileBtnSize}
    >
      {confirmLabel}
    </ActionButton>
  );

  // Mobile: the action you almost always want gets a full-width row of its own under
  // the thumb; Back/Cancel share a smaller row beneath it. Three buttons crammed into
  // one 360px row left every target too narrow to hit reliably.
  const footer = isMobile ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
      {primaryAction}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {currentStep > 1 && (
          <ActionButton variant="secondary" onClick={handleBack} disabled={isSubmitting} fullWidth size="large">
            Back
          </ActionButton>
        )}
        <ActionButton variant="secondary" onClick={handleClose} disabled={isSubmitting} fullWidth size="large">
          Cancel
        </ActionButton>
      </div>
    </div>
  ) : (
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
      {primaryAction}
    </>
  );

  return (
    <>
    <MailPickerModal
      open={Boolean(outlookPicker)}
      onClose={() => setOutlookPicker(null)}
      heading={outlookPicker === 'issuer' ? 'Pick the order sent to the issuer' : 'Pick the client instruction from Outlook'}
      // The order to the issuer is a mail we sent, and it names the product.
      defaultFolder={outlookPicker === 'issuer' ? 'sentitems' : 'inbox'}
      defaultQuery={outlookPicker === 'issuer' ? (selectedSecurity?.isin || prefillData?.isin || '') : ''}
      // The client instruction comes from an address authorized on the account,
      // so open filtered on it. Bulk rows span several accounts: no single sender.
      defaultFromFilter={outlookPicker === 'single'
        ? (getAuthorizedEmails(clientBankAccounts.find(a => a._id === selectedBankAccountId))[0] || '')
        : ''}
      onPickFile={(file) => {
        if (outlookPicker === 'bulk') addTraceFiles([file]);
        else if (outlookPicker === 'issuer') setIssuerOrderFile(file);
        else setClientOrderFile(file);
        setError(null);
        setOutlookPicker(null);
      }}
    />
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      // A stray click outside must not interrupt an order being entered; close
      // only via the close button, Cancel or Esc (all confirm first)
      closeOnOverlayClick={false}
      title={
        currentStep < 2
          ? (isBulkMode ? 'Bulk Order' : 'New Order')
          : assetType === ASSET_TYPES.FX
            ? (isBulkMode ? 'Bulk FX Order' : 'FX Order')
            : assetType === ASSET_TYPES.TERM_DEPOSIT
              ? `${isBulkMode ? 'Bulk ' : ''}Term Deposit — ${depositAction === 'decrease' ? 'Decrease' : 'Increase'}`
              : `${isBulkMode ? 'Bulk ' : ''}${mode === 'buy' ? 'Buy' : 'Sell'} Order`
      }
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
    </>
  );
};

export default OrderModal;
