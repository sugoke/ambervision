import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import Modal from './components/common/Modal.jsx';
import ActionButton from './components/common/ActionButton.jsx';
import OrderModal from './components/OrderModal.jsx';
import ValidationBlotter from './components/ValidationBlotter.jsx';
import { useTheme } from './ThemeContext.jsx';
import * as XLSX from 'xlsx';
import { OrdersCollection, ORDER_STATUSES, EMAIL_TRACE_TYPES, EMAIL_TRACE_LABELS, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, TERMSHEET_EVIDENCE_TYPES, TERMSHEET_TRACE_TYPES, ASSET_TYPES, PRICE_TYPES, TERMSHEET_STATUSES, OrderFormatters, OrderHelpers, getOrderHealthCheck, HEALTH_FILTER_ANY, getTraceCompleteness, isTerminalOrderStatus, EXECUTION_TYPES, EXECUTION_TYPE_LABELS } from '/imports/api/orders';
import { BanksCollection } from '/imports/api/banks';
import { IssuersCollection } from '/imports/api/issuers';
import { UsersCollection } from '/imports/api/users';
import FormattedNumberInput from './components/FormattedNumberInput.jsx';
import { useIsMobile } from './hooks/useIsMobile.js';
import { useOrderEmailDelivery } from './hooks/useOrderEmailDelivery.js';
import { useGraphConnection } from './hooks/useGraphConnection.js';
import MailPickerModal from './components/MailPickerModal.jsx';

/**
 * OrderBook - Main component for managing orders
 *
 * Features:
 * - List all orders with filtering
 * - Order detail view
 * - Cancel, resend email, mark as executed actions
 * - New order creation
 * - Bulk order grouping display
 */

/**
 * Inline-editable Exec Price cell for the blotter.
 * - Read-only for orders not in executed / partially_executed state.
 * - Click to enter a value; Enter saves, Esc cancels, blur saves.
 * - Format: % for structured products and bonds, currency for others.
 * - On save, calls `orders.setExecutedPrice` which logs to the audit trail.
 */
const InlineExecPriceCell = ({ order, onSaved }) => {
  // Term deposits have no execution price, so the cell is never editable for them.
  const editable = (order.status === ORDER_STATUSES.EXECUTED || order.status === ORDER_STATUSES.PARTIALLY_EXECUTED)
    && order.assetType !== ASSET_TYPES.TERM_DEPOSIT;
  const quotesAsPercent = order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT || order.assetType === ASSET_TYPES.BOND;
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const startEdit = () => {
    if (!editable) return;
    setValue(order.executedPrice != null ? String(order.executedPrice) : '');
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setValue('');
  };

  const save = async () => {
    if (saving) return;
    const cleaned = value.replace(',', '.').replace(/[^\d.\-]/g, '');
    const parsed = parseFloat(cleaned);
    if (isNaN(parsed) || parsed < 0) { cancel(); return; }
    if (order.executedPrice != null && parsed === order.executedPrice) { cancel(); return; }
    setSaving(true);
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('orders.setExecutedPrice', {
        orderId: order._id,
        executedPrice: parsed,
        sessionId
      });
      setEditing(false);
      setValue('');
      if (onSaved) onSaved();
    } catch (err) {
      alert('Failed to save exec price: ' + (err.reason || err.message));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            else if (e.key === 'Escape') cancel();
          }}
          onBlur={save}
          disabled={saving}
          style={{
            width: '78px',
            padding: '3px 6px',
            fontSize: '12px',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--accent-color)',
            borderRadius: '3px'
          }}
        />
        {quotesAsPercent && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>%</span>}
      </div>
    );
  }

  if (order.executedPriceFormatted) {
    return (
      <span
        style={{
          fontSize: '12px',
          fontWeight: '500',
          cursor: editable ? 'pointer' : 'default',
          padding: '2px 4px',
          borderRadius: '3px',
          borderBottom: editable ? '1px dotted var(--text-muted)' : 'none'
        }}
        onClick={editable ? startEdit : undefined}
        title={editable ? 'Click to edit' : undefined}
      >
        {order.executedPriceFormatted}
      </span>
    );
  }

  return (
    <span
      style={{
        fontSize: '11px',
        color: editable ? 'var(--accent-color)' : 'var(--text-muted)',
        cursor: editable ? 'pointer' : 'default',
        textDecoration: editable ? 'underline dotted' : 'none'
      }}
      onClick={editable ? startEdit : undefined}
      title={editable ? 'Click to set execution price' : undefined}
    >
      {editable ? '+ Set price' : '-'}
    </span>
  );
};

const OrderBook = ({ user }) => {
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const getSessionId = () => localStorage.getItem('sessionId');
  // With a mailbox connected the mail is sent from the app on any device; without
  // one, desktop gets the .eml draft and phones the Outlook hand-off (see the hook).
  const { deliverOrderEmail, orderEmailSheet, orderSendPreview, graphConnected } = useOrderEmailDelivery();
  // Outlook picker: augments the drop zones, never replaces them. When no
  // mailbox is connected the button is simply absent and drag-and-drop stands.
  const graphConnection = useGraphConnection();
  const [mailPicker, setMailPicker] = useState(null); // { orderId, traceType, fixedMessages?, heading?, emptyText? }
  const [checkingReplies, setCheckingReplies] = useState(false);
  // Picker in FILE mode, for the two zones that hold a File rather than writing
  // straight to the order: the limit-change instruction and termsheet evidence.
  const [filePicker, setFilePicker] = useState(null);

  // State
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [totalOrders, setTotalOrders] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [bankFilter, setBankFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [validatorFilter, setValidatorFilter] = useState('all');
  const [missingTermsheetFilter, setMissingTermsheetFilter] = useState(false);
  // Health-check filter chosen from the summary bar: null (off),
  // HEALTH_FILTER_ANY (every incomplete order) or one missing-item name.
  const [healthFilter, setHealthFilter] = useState(null);
  // Completeness counts for the whole filtered book, from orders.list — NOT
  // derived from the loaded page, which only ever holds `pageSize` rows.
  const [healthStats, setHealthStats] = useState(null);
  const [validators, setValidators] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState(-1);

  // Modals
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [executeModalOpen, setExecuteModalOpen] = useState(false);
  const [newOrderModalOpen, setNewOrderModalOpen] = useState(false);
  // Bumped each time the modal closes so the next open gets a fresh OrderModal
  // instance — prevents the previous order's termsheet / client email file from
  // sticking around when placing several structured-product orders in a row.
  const [newOrderModalKey, setNewOrderModalKey] = useState(0);
  useEffect(() => {
    if (!newOrderModalOpen) setNewOrderModalKey(k => k + 1);
  }, [newOrderModalOpen]);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');

  // Edit form state
  const [editQuantity, setEditQuantity] = useState('');
  const [editPriceType, setEditPriceType] = useState('market');
  const [editLimitPrice, setEditLimitPrice] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Limit modification modal
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [limitPriceType, setLimitPriceType] = useState('limit');
  const [limitNewPrice, setLimitNewPrice] = useState('');
  const [limitNewStopLoss, setLimitNewStopLoss] = useState('');
  const [limitNewTakeProfit, setLimitNewTakeProfit] = useState('');
  const [limitReason, setLimitReason] = useState('');
  const [limitInstructionFile, setLimitInstructionFile] = useState(null);

  // Force settle modal
  const [forceSettleOrder, setForceSettleOrder] = useState(null);
  const [forceSettleReason, setForceSettleReason] = useState('');

  // Execution form
  const [executedQuantity, setExecutedQuantity] = useState('');
  const [executedPrice, setExecutedPrice] = useState('');
  const [executionDate, setExecutionDate] = useState(new Date().toISOString().split('T')[0]);

  // Action states
  const [isActioning, setIsActioning] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Loading states for row actions
  const [loadingPDF, setLoadingPDF] = useState(null); // orderId currently generating PDF
  const [loadingAuditPDF, setLoadingAuditPDF] = useState(null); // orderId currently generating audit trail PDF
  const [loadingEmail, setLoadingEmail] = useState(null); // orderId currently sending email

  // Trace states
  const [uploadingTrace, setUploadingTrace] = useState(null); // traceType currently uploading
  const [traceError, setTraceError] = useState(null);
  const [tracePhoneForms, setTracePhoneForms] = useState({}); // { [traceType]: { callTime, caller, callee, notes } }

  // Termsheet evidence modal state
  const [termsheetEvidenceModal, setTermsheetEvidenceModal] = useState(null); // { orderId, targetStatus } | null
  const [termsheetEvidenceFile, setTermsheetEvidenceFile] = useState(null);
  const [termsheetEvidenceError, setTermsheetEvidenceError] = useState(null);
  const [termsheetEvidenceUploading, setTermsheetEvidenceUploading] = useState(false);

  // Booking check results (keyed by orderId)
  const [bookingResults, setBookingResults] = useState({});

  // Clients for new order modal
  const [clients, setClients] = useState([]);

  // Subscribe to banks for filter dropdown, and to issuers so structured-product
  // orders created before issuer coordinates were snapshotted can still resolve them.
  const { banks, issuers } = useTracker(() => {
    Meteor.subscribe('banks');
    Meteor.subscribe('issuers');
    return {
      banks: BanksCollection.find({ isActive: true }).fetch(),
      issuers: IssuersCollection.find().fetch()
    };
  }, []);

  /**
   * Issuer coordinates for an order: the snapshot stored on the order at creation
   * wins; the live issuer record is the fallback for older orders.
   */
  const getIssuerCoordinates = (order) => {
    if (!order) return null;
    const snap = order.issuerContact;
    if (snap && (snap.name || snap.email || snap.phone)) {
      return {
        issuerName: order.issuerName || order.broker || '',
        name: snap.name || null,
        email: snap.email || null,
        phone: snap.phone || null
      };
    }
    if (!order.issuerId) return null;
    const iss = issuers.find(i => i._id === order.issuerId);
    if (!iss) return null;
    return {
      issuerName: iss.name || '',
      name: iss.contactName || null,
      email: iss.contactEmail || null,
      phone: iss.contactPhone || null
    };
  };

  // Load orders on filter changes
  useEffect(() => {
    loadOrders();
  }, [statusFilter, bankFilter, clientFilter, validatorFilter, missingTermsheetFilter, healthFilter, searchQuery, dateFrom, dateTo, currentPage, sortField, sortOrder]);

  // Load clients for new order modal
  useEffect(() => {
    const loadClients = async () => {
      try {
        const sessionId = getSessionId();
        const result = await Meteor.callAsync('users.getClients', { sessionId });
        setClients(result || []);
      } catch (err) {
        console.error('Error loading clients:', err);
      }
    };
    loadClients();
  }, []);

  // Load distinct validators for the validator filter dropdown
  useEffect(() => {
    const loadValidators = async () => {
      try {
        const sessionId = getSessionId();
        const result = await Meteor.callAsync('orders.distinctValidators', { sessionId });
        setValidators(result || []);
      } catch (err) {
        console.error('Error loading validators:', err);
      }
    };
    loadValidators();
  }, []);

  // Build the active filter set from the current UI state. Shared by the
  // paginated table load and the (unpaginated) Excel export so both respect
  // the same status/bank/client/validator/search/date-range selection.
  const buildFilters = () => {
    const filters = {};

    if (statusFilter !== 'all') {
      filters.status = statusFilter;
    }
    if (bankFilter !== 'all') {
      filters.bankId = bankFilter;
    }
    if (clientFilter !== 'all') {
      filters.clientId = clientFilter;
    }
    if (validatorFilter !== 'all') {
      filters.validatedByName = validatorFilter;
    }
    if (missingTermsheetFilter) {
      filters.missingTermsheet = true;
    }
    if (healthFilter) {
      filters.healthMissing = healthFilter;
    }
    if (searchQuery) {
      filters.search = searchQuery;
    }
    if (dateFrom) {
      filters.dateFrom = new Date(dateFrom);
    }
    if (dateTo) {
      filters.dateTo = new Date(dateTo + 'T23:59:59');
    }

    return filters;
  };

  // Live overlay for the loaded page. orders.list is a one-shot method call, so
  // a trace attached from the detail modal in another tab, by a colleague, or
  // by any other client left the "Traces" badge stale until the next reload
  // (2026-00137 showed 3/4 with four traces on file). Subscribe to just the
  // visible ids and merge the reactive trace fields over the loaded rows.
  const liveOrderIdsKey = orders.map(o => o._id).join(',');
  const liveById = useTracker(() => {
    const ids = liveOrderIdsKey ? liveOrderIdsKey.split(',') : [];
    if (ids.length === 0) return {};
    const sessionId = getSessionId();
    if (!sessionId) return {};
    Meteor.subscribe('orders.liveTraces', sessionId, ids);
    const map = {};
    OrdersCollection.find(
      { _id: { $in: ids } },
      { fields: { emailTraces: 1, clientOrderDeferred: 1 } }
    ).forEach(doc => { map[doc._id] = doc; });
    return map;
  }, [liveOrderIdsKey]);
  const displayOrders = useMemo(() => orders.map(o => {
    const live = liveById[o._id];
    if (!live || !Array.isArray(live.emailTraces)) return o;
    return {
      ...o,
      emailTraces: live.emailTraces,
      clientOrderDeferred: live.clientOrderDeferred ?? o.clientOrderDeferred
    };
  }), [orders, liveById]);

  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const sessionId = getSessionId();
      const filters = buildFilters();

      const result = await Meteor.callAsync('orders.list', {
        filters,
        pagination: {
          limit: pageSize,
          skip: (currentPage - 1) * pageSize,
          sortField,
          sortOrder
        },
        sessionId
      });

      // Harmonize the security name across banks: the same ISIN can have been
      // stored under different bank-provided names. When a canonical name has
      // been set in Securities Base it is propagated to `displayName`; prefer it
      // so the whole order book (rows, detail panels, export) reads consistently.
      // For structured products we manage, the Ambervision product title
      // (orders.list attaches `productTitle` by ISIN) wins over both: the desk
      // types a short label like "Ph+", the product record has the real name.
      // The typed label is kept as `orderSecurityName` for the row tooltip.
      const loadedOrders = (result.orders || []).map(order => {
        const name = order.productTitle || order.displayName || order.securityName;
        if (!name || name === order.securityName) return order;
        return { ...order, securityName: name, orderSecurityName: order.securityName };
      });
      setOrders(loadedOrders);
      setTotalOrders(result.total || 0);
      // Whole-set completeness counts (the server computes them ignoring the
      // health filter, so the banner does not move when its chips are clicked).
      setHealthStats(result.healthStats || null);

      // Batch check booking status for all non-cancelled orders (including executed)
      const checkableIds = loadedOrders
        .filter(o => o.status !== ORDER_STATUSES.CANCELLED)
        .map(o => o._id);
      if (checkableIds.length > 0) {
        try {
          const bookings = await Meteor.callAsync('orders.batchCheckBooking', {
            orderIds: checkableIds,
            sessionId
          });
          setBookingResults(prev => ({ ...prev, ...bookings }));
        } catch (bookingErr) {
          console.error('Error checking bookings:', bookingErr);
        }
      }
    } catch (err) {
      console.error('Error loading orders:', err);
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      const sessionId = getSessionId();

      // Fetch ALL orders matching the current filters (respecting the date
      // range), not just the visible page. skip: 0 with a very high limit
      // pulls the full result set in one call, sorted like the table.
      const result = await Meteor.callAsync('orders.list', {
        filters: buildFilters(),
        pagination: {
          limit: 100000,
          skip: 0,
          sortField,
          sortOrder
        },
        sessionId
      });

      const exportOrders = result.orders || [];
      if (!exportOrders.length) {
        setIsExporting(false);
        return;
      }

      // Booking status is only pre-fetched for the visible page, so resolve it
      // for the full export set (fall back to whatever is already cached).
      let exportBookings = bookingResults;
      const checkableIds = exportOrders
        .filter(o => o.status !== ORDER_STATUSES.CANCELLED)
        .map(o => o._id);
      if (checkableIds.length > 0) {
        try {
          const bookings = await Meteor.callAsync('orders.batchCheckBooking', {
            orderIds: checkableIds,
            sessionId
          });
          exportBookings = { ...bookingResults, ...bookings };
        } catch (bookingErr) {
          console.error('Error checking bookings for export:', bookingErr);
        }
      }

      const data = exportOrders.map(order => {
        const health = getOrderHealthCheck(order);
        const traceCompleteness = getTraceCompleteness(order);

        return {
        'Reference': order.orderReference || '',
        'Date': order.createdAtFormatted || '',
        'Status': order.effectiveStatusLabel || order.statusLabel || order.status || '',
        'Booked': exportBookings[order._id] ? 'Yes' : '-',
        'Ind/Bloc': order.tradeModeLabel || '',
        'WA': order.wealthAmbassadorFormatted || '',
        'Account #': order.accountNumber || '',
        'Account Name': order.accountName || '',
        'Bank': order.bankName || '',
        'Type': order.orderTypeLabel || '',
        'Security': order.securityName || '',
        'ISIN': order.isin || '',
        'Asset': order.assetTypeLabel || '',
        'Currency': order.currency || '',
        'Quantity': order.quantity || '',
        'Unit': order.quantityUnitLabel || '',
        'Underlying': order.optionUnderlyingFormatted || '',
        'Underlying ISIN': order.optionUnderlyingIsin || '',
        'C/P': order.optionTypeLabel || '',
        'Strike': order.optionStrikeFormatted || '',
        'Expiry': order.optionExpiryFormatted || '',
        'Multiplier': order.optionContractSizeFormatted || '',
        'Covered': order.coverageCheckFormatted
          ? (order.coverageCheckFormatted.isCovered ? 'Yes' : 'No')
          : '',
        'Price Type': order.priceTypeLabel || '',
        'Limit Price': order.limitPrice || '',
        'Stop Loss': order.stopLossPrice || '',
        'Take Profit': order.takeProfitPrice || '',
        'Exec Price': order.executedPrice || '',
        'Broker': order.broker || '',
        'Settl. Ccy': order.settlementCurrency || '',
        'Termsheet': order.termsheetLabel || '',
        'Traces': traceCompleteness.label,
        'Health': health.max > 0 ? health.label : '-',
        'Missing': health.missing.join(', '),
        'Validated By': order.validatedByName || '',
        'Validated At': order.validatedAtFormatted || '',
        'Notes': order.notes || '',
        'Created By': order.createdByName || '',
      };
    });

      const ws = XLSX.utils.json_to_sheet(data);

      // Auto-size columns
      const colWidths = Object.keys(data[0]).map(key => ({
        wch: Math.max(key.length, ...data.map(row => String(row[key] || '').length)).toString().length > 40
          ? 40
          : Math.max(key.length + 2, ...data.map(row => String(row[key] || '').length + 2))
      }));
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');

      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `order-book-${dateStr}.xlsx`);
    } catch (err) {
      console.error('Error exporting orders:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleForceSettle = async () => {
    if (!forceSettleOrder) return;
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.forceSettle', { orderId: forceSettleOrder._id || forceSettleOrder.order?._id, reason: forceSettleReason.trim() || null, sessionId });
      setForceSettleOrder(null);
      setForceSettleReason('');
      loadOrders();
      // Refresh detail modal if open
      if (selectedOrder && detailModalOpen) {
        const updated = await Meteor.callAsync('orders.get', { orderId: selectedOrder.order._id, sessionId });
        setSelectedOrder(updated);
      }
    } catch (err) {
      alert(err.reason || err.message || 'Failed to force settle');
    }
  };

  /**
   * The mail that went to the bank is already in the sender's Sent Items, so
   * the "order to bank" trace does not need anyone to drag it back in: ask the
   * server to find and file it. Silent by design — nothing found is the normal
   * case for an order that was never mailed, and the drop zone stays as it was.
   */
  const autoAttachOrderToBank = useCallback(async (orderId) => {
    if (!graphConnected || !orderId) return;
    try {
      const result = await Meteor.callAsync('orders.autoAttachOrderToBank', {
        orderId,
        sessionId: getSessionId()
      });
      if (result?.attached) {
        const refreshed = await Meteor.callAsync('orders.get', { orderId, sessionId: getSessionId() });
        setSelectedOrder(refreshed);
        loadOrders();
      }
    } catch (err) {
      console.warn('[OrderBook] Auto-attach of the bank mail failed:', err.reason || err.message);
    }
  }, [graphConnected]);

  const handleViewDetails = async (order) => {
    try {
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('orders.get', { orderId: order._id, sessionId });
      setSelectedOrder(result);
      setTraceError(null);
      setDetailModalOpen(true);

      // No order-to-bank trace on file: try to pull the sent mail in by itself.
      const hasOrderToBank = (result?.order?.emailTraces || [])
        .some(t => t.traceType === EMAIL_TRACE_TYPES.ORDER_TO_BANK);
      if (!hasOrderToBank) autoAttachOrderToBank(order._id);

      // Fetch booking status for this order if not already loaded
      if (!bookingResults[order._id] && order.status !== ORDER_STATUSES.CANCELLED) {
        try {
          const bookings = await Meteor.callAsync('orders.batchCheckBooking', {
            orderIds: [order._id],
            sessionId
          });
          setBookingResults(prev => ({ ...prev, ...bookings }));
        } catch (bookingErr) {
          console.error('Error checking booking:', bookingErr);
        }
      }
    } catch (err) {
      console.error('Error loading order details:', err);
    }
  };

  const handleCancel = async () => {
    if (!selectedOrder) return;

    setIsActioning(true);
    setActionError(null);

    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.cancel', {
        orderId: selectedOrder.order._id,
        reason: cancellationReason,
        sessionId
      });

      setCancelModalOpen(false);
      setCancellationReason('');
      setSelectedOrder(null);
      loadOrders();
    } catch (err) {
      setActionError(err.reason || err.message);
    } finally {
      setIsActioning(false);
    }
  };

  const handleMarkExecuted = async () => {
    if (!selectedOrder) return;

    setIsActioning(true);
    setActionError(null);

    try {
      const sessionId = getSessionId();
      const execData = {
        executedQuantity: parseFloat(executedQuantity),
      };
      if (executedPrice) execData.executedPrice = parseFloat(executedPrice);
      if (executionDate) execData.executionDate = new Date(executionDate);

      await Meteor.callAsync('orders.markExecuted', {
        orderId: selectedOrder.order._id,
        executionData: execData,
        sessionId
      });

      setExecuteModalOpen(false);
      setExecutedQuantity('');
      setExecutedPrice('');
      setSelectedOrder(null);
      loadOrders();
    } catch (err) {
      setActionError(err.reason || err.message);
    } finally {
      setIsActioning(false);
    }
  };

  const handleGeneratePDF = async (order) => {
    setLoadingPDF(order._id);
    try {
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('orders.generatePDF', { orderId: order._id, sessionId });

      // Convert base64 to blob and download
      const byteCharacters = atob(result.pdfData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${order.orderReference}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Failed to generate PDF: ' + (err.reason || err.message));
    } finally {
      setLoadingPDF(null);
    }
  };

  const handleGenerateAuditTrail = async (order) => {
    setLoadingAuditPDF(order._id);
    try {
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('orders.generateAuditTrailPDF', { orderId: order._id, sessionId });

      const byteCharacters = atob(result.pdfData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${order.orderReference}_audit_trail.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating Audit Trail PDF:', err);
      alert('Failed to generate Audit Trail PDF: ' + (err.reason || err.message));
    } finally {
      setLoadingAuditPDF(null);
    }
  };

  /**
   * Pull the bank's replies to this order's thread and hand them to the picker
   * for the user to confirm. Nothing is attached automatically: a bank
   * confirmation advances the order to EXECUTED, and a reply is as often a
   * question as a confirmation.
   */
  const handleCheckReplies = async (order) => {
    setCheckingReplies(true);
    setTraceError(null);
    try {
      const result = await Meteor.callAsync('orders.checkGraphReplies', {
        orderId: order._id,
        sessionId: localStorage.getItem('sessionId')
      });
      if (!result.replies?.length) {
        setTraceError('No reply from the bank has arrived in this thread yet.');
        return;
      }
      setMailPicker({
        orderId: order._id,
        traceType: EMAIL_TRACE_TYPES.BANK_CONFIRMATION,
        fixedMessages: result.replies,
        heading: `Replies on ${order.orderReference}`,
        emptyText: 'No reply from the bank has arrived in this thread yet.'
      });
    } catch (err) {
      setTraceError(err.reason || err.message || 'Could not check for replies');
    } finally {
      setCheckingReplies(false);
    }
  };

  const handleSendEmail = async (order) => {
    setLoadingEmail(order._id);
    try {
      const sessionId = getSessionId();

      // Get PDF + email data from server
      const result = await Meteor.callAsync('orders.prepareEmail', { orderId: order._id, sessionId });

      // Desktop: .eml with PDF (and termsheet if present) attached, opens as a prefilled Outlook draft.
      // Phone: PDF saved to Files + Outlook compose deep link, since iOS cannot open a .eml as a draft.
      if (result.success && result.pdfData && result.emailData) {
        // With a connected mailbox the preview modal surfaces the missing
        // recipient inline and lets it be typed, so the alert would be noise.
        if (!result.emailData.to && !graphConnected) {
          alert(`No desk email is configured at ${result.emailData.bankName || 'this bank'} for ${order.assetTypeLabel || result.emailData.assetType || 'this asset type'} orders. The draft will open with an empty recipient — add the address in Bank Management.`);
        }
        deliverOrderEmail({
          orderReference: result.orderReference || order.orderReference,
          emailData: result.emailData,
          pdfData: result.pdfData,
          termsheet: result.termsheet
        }, { orderId: order._id });
      }
    } catch (err) {
      console.error('Error preparing email:', err);
      alert('Failed to prepare email: ' + (err.reason || err.message));
    } finally {
      setLoadingEmail(null);
    }
  };

  const handleOrderCreated = (result) => {
    setNewOrderModalOpen(false);
    loadOrders();
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 1 ? -1 : 1);
    } else {
      setSortField(field);
      setSortOrder(-1);
    }
    setCurrentPage(1);
  };

  const SortableHeader = ({ field, label, title }) => {
    const isActive = sortField === field;
    const arrow = isActive ? (sortOrder === 1 ? ' ▲' : ' ▼') : '';
    return (
      <th
        style={{ ...styles.th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
        title={title || `Sort by ${label}`}
        onClick={() => handleSort(field)}
      >
        {label}{isActive && <span style={{ opacity: 0.7, fontSize: '10px' }}>{arrow}</span>}
      </th>
    );
  };

  // Termsheet status handler - cycles: none -> sent -> signed -> none.
  // Forward transitions (none -> sent, sent -> signed) require an evidence file
  // and open the upload modal. The revert path (signed -> none) calls the server
  // directly without a modal.
  const requestTermsheetAdvance = (order) => {
    if (order.assetType !== ASSET_TYPES.STRUCTURED_PRODUCT) return;

    const cycle = [TERMSHEET_STATUSES.NONE, TERMSHEET_STATUSES.SENT, TERMSHEET_STATUSES.SIGNED];
    const currentIdx = cycle.indexOf(order.termsheetStatus || TERMSHEET_STATUSES.NONE);
    const nextStatus = cycle[(currentIdx + 1) % cycle.length];

    if (nextStatus === TERMSHEET_STATUSES.NONE) {
      // Revert path — no evidence required, server keeps trace files
      (async () => {
        try {
          const sessionId = getSessionId();
          await Meteor.callAsync('orders.updateTermsheetStatus', {
            orderId: order._id,
            termsheetStatus: nextStatus,
            sessionId
          });
          if (selectedOrder?.order?._id === order._id) {
            const result = await Meteor.callAsync('orders.get', { orderId: order._id, sessionId });
            setSelectedOrder(result);
          }
          loadOrders();
        } catch (err) {
          console.error('Error reverting termsheet status:', err);
        }
      })();
      return;
    }

    // Forward path — open modal to collect evidence. Existing termsheet files are
    // passed along so the modal can show / replace / delete what was already uploaded.
    setTermsheetEvidenceFile(null);
    setTermsheetEvidenceError(null);
    setTermsheetEvidenceUploading(false);
    setTermsheetEvidenceModal({
      orderId: order._id,
      targetStatus: nextStatus,
      existingTraces: (order.emailTraces || []).filter(t =>
        TERMSHEET_TRACE_TYPES.has(t.traceType) && t.traceMode !== 'phone')
    });
  };

  // Delete a termsheet file from within the evidence modal (keeps modal state in sync)
  const handleDeleteEvidenceTrace = async (traceId) => {
    if (!termsheetEvidenceModal) return;
    const { orderId } = termsheetEvidenceModal;
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.deleteEmailTrace', { orderId, traceId, sessionId });
      setTermsheetEvidenceModal(prev => prev
        ? { ...prev, existingTraces: (prev.existingTraces || []).filter(t => t._id !== traceId) }
        : prev);
      if (selectedOrder?.order?._id === orderId) {
        const result = await Meteor.callAsync('orders.get', { orderId, sessionId });
        setSelectedOrder(result);
      }
      loadOrders();
    } catch (err) {
      console.error('Error deleting termsheet evidence:', err);
      setTermsheetEvidenceError(err.reason || err.message);
    }
  };

  const submitTermsheetEvidence = async () => {
    if (!termsheetEvidenceModal) return;
    const { orderId, targetStatus } = termsheetEvidenceModal;
    const file = termsheetEvidenceFile;

    if (!file) {
      setTermsheetEvidenceError('Please select a file.');
      return;
    }

    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!TERMSHEET_EVIDENCE_TYPES.includes(ext)) {
      setTermsheetEvidenceError(`File type ${ext} is not accepted. Use: ${TERMSHEET_EVIDENCE_TYPES.join(', ')}`);
      return;
    }
    if (file.size > EMAIL_TRACE_MAX_SIZE) {
      setTermsheetEvidenceError('File exceeds 15MB limit.');
      return;
    }

    setTermsheetEvidenceUploading(true);
    setTermsheetEvidenceError(null);

    try {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const sessionId = getSessionId();
      await Meteor.callAsync('orders.advanceTermsheetWithEvidence', {
        orderId,
        targetStatus,
        fileName: file.name,
        base64Data,
        mimeType: file.type || 'application/octet-stream',
        sessionId
      });

      if (selectedOrder?.order?._id === orderId) {
        const result = await Meteor.callAsync('orders.get', { orderId, sessionId });
        setSelectedOrder(result);
      }
      loadOrders();
      setTermsheetEvidenceModal(null);
      setTermsheetEvidenceFile(null);
    } catch (err) {
      console.error('Error advancing termsheet status:', err);
      setTermsheetEvidenceError(err.reason || err.message);
    } finally {
      setTermsheetEvidenceUploading(false);
    }
  };

  // Email trace handlers
  const handleTraceFile = async (file, traceType, orderId) => {
    setTraceError(null);

    // Validate extension
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!EMAIL_TRACE_ACCEPTED_TYPES.includes(ext)) {
      setTraceError(`File type ${ext} not accepted. Use: ${EMAIL_TRACE_ACCEPTED_TYPES.join(', ')}`);
      return;
    }

    // Validate size
    if (file.size > EMAIL_TRACE_MAX_SIZE) {
      setTraceError('File exceeds 15MB limit');
      return;
    }

    setUploadingTrace(traceType);

    try {
      // Convert to base64
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const sessionId = getSessionId();
      await Meteor.callAsync('orders.uploadEmailTrace', {
        orderId,
        traceType,
        fileName: file.name,
        base64Data,
        mimeType: file.type || 'application/octet-stream',
        sessionId
      });

      // Refresh order details and list (status may have changed)
      const result = await Meteor.callAsync('orders.get', { orderId, sessionId });
      setSelectedOrder(result);
      loadOrders();
    } catch (err) {
      console.error('Error uploading trace:', err);
      setTraceError(err.reason || err.message);
    } finally {
      setUploadingTrace(null);
    }
  };

  // Signed termsheet upload from the trace tile — linked to the TS status indicator:
  // stores the file as signed evidence and advances termsheetStatus to "signed".
  const handleSignedTermsheetUpload = async (file, orderId) => {
    setTraceError(null);
    if (!file) return;

    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!TERMSHEET_EVIDENCE_TYPES.includes(ext)) {
      setTraceError(`File type ${ext} not accepted for the signed termsheet. Use: ${TERMSHEET_EVIDENCE_TYPES.join(', ')}`);
      return;
    }
    if (file.size > EMAIL_TRACE_MAX_SIZE) {
      setTraceError('File exceeds 15MB limit');
      return;
    }

    setUploadingTrace(EMAIL_TRACE_TYPES.TERMSHEET);
    try {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const sessionId = getSessionId();
      await Meteor.callAsync('orders.advanceTermsheetWithEvidence', {
        orderId,
        targetStatus: TERMSHEET_STATUSES.SIGNED,
        fileName: file.name,
        base64Data,
        mimeType: file.type || 'application/octet-stream',
        sessionId
      });

      // Refresh order details and list (termsheet status advanced to signed)
      const result = await Meteor.callAsync('orders.get', { orderId, sessionId });
      setSelectedOrder(result);
      loadOrders();
    } catch (err) {
      console.error('Error uploading signed termsheet:', err);
      setTraceError(err.reason || err.message);
    } finally {
      setUploadingTrace(null);
    }
  };

  const handleDeleteTrace = async (orderId, traceId) => {
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.deleteEmailTrace', { orderId, traceId, sessionId });

      // Refresh order details and list (status may have reverted)
      const result = await Meteor.callAsync('orders.get', { orderId, sessionId });
      setSelectedOrder(result);
      loadOrders();
    } catch (err) {
      console.error('Error deleting trace:', err);
      setTraceError(err.reason || err.message);
    }
  };

  const handleDownloadTrace = async (orderId, traceId, fileName) => {
    try {
      const sessionId = getSessionId();
      const url = await Meteor.callAsync('orders.getEmailTraceUrl', { orderId, traceId, sessionId });
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Error downloading trace:', err);
    }
  };

  const handleSavePhoneTrace = async (traceType, orderId) => {
    const form = tracePhoneForms[traceType];
    if (!form?.callTime || !form?.caller || !form?.callee) {
      setTraceError('Please fill in call time, caller, and callee.');
      return;
    }
    try {
      setUploadingTrace(traceType);
      setTraceError(null);
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.savePhoneTrace', {
        orderId,
        traceType,
        phoneCallTime: new Date(form.callTime).toISOString(),
        phoneCaller: form.caller,
        phoneCallee: form.callee,
        phoneNotes: form.notes || '',
        sessionId
      });
      // Refresh order details and list (status may have changed)
      const result = await Meteor.callAsync('orders.get', { orderId, sessionId });
      setSelectedOrder(result);
      loadOrders();
      setTracePhoneForms(prev => {
        const next = { ...prev };
        delete next[traceType];
        return next;
      });
    } catch (err) {
      console.error('Error saving phone trace:', err);
      setTraceError(err.reason || err.message);
    } finally {
      setUploadingTrace(null);
    }
  };

  const handleDropTrace = async (e, traceType, orderId) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.style.borderColor = 'var(--border-color)';
    e.currentTarget.style.background = 'var(--bg-primary)';
    setTraceError(null);

    // Method 1: Check dataTransfer.files (standard file drops from file explorer)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleTraceFile(e.dataTransfer.files[0], traceType, orderId);
      return;
    }

    // Method 2: Check dataTransfer.items (Outlook drag sometimes provides files here)
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      for (const item of e.dataTransfer.items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            handleTraceFile(file, traceType, orderId);
            return;
          }
        }
      }

      // Check for HTML content (some Outlook versions provide this on drag)
      for (const item of e.dataTransfer.items) {
        if (item.kind === 'string' && item.type === 'text/html') {
          item.getAsString(async (htmlContent) => {
            if (htmlContent && htmlContent.length > 50) {
              setUploadingTrace(traceType);
              try {
                const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Email Trace</title></head><body>${htmlContent}</body></html>`;
                const base64Data = btoa(unescape(encodeURIComponent(fullHtml)));
                const fileName = `${EMAIL_TRACE_LABELS[traceType].replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.html`;
                const sessionId = getSessionId();
                await Meteor.callAsync('orders.uploadEmailTrace', {
                  orderId, traceType, fileName, base64Data,
                  mimeType: 'text/html', sessionId
                });
                const result = await Meteor.callAsync('orders.get', { orderId, sessionId });
                setSelectedOrder(result);
                loadOrders();
              } catch (err) {
                setTraceError(err.reason || err.message);
              } finally {
                setUploadingTrace(null);
              }
            }
          });
          return;
        }
      }
    }

    // Nothing received
    setTraceError(
      'No file received from Outlook. Drag the email from Outlook to your Desktop first (creates a .msg file), then drag the .msg file here.'
    );
  };

  const openEditModal = (order) => {
    setSelectedOrder({ order });
    setEditQuantity(order.quantity?.toString() || '');
    setEditPriceType(order.priceType || 'market');
    setEditLimitPrice(order.limitPrice?.toString() || '');
    setEditNotes(order.notes || '');
    setEditModalOpen(true);
  };

  const openLimitModal = (order) => {
    setSelectedOrder({ order });
    setLimitPriceType(order.priceType || 'limit');
    setLimitNewPrice(order.limitPrice?.toString() || '');
    setLimitNewStopLoss(order.stopLossPrice?.toString() || '');
    setLimitNewTakeProfit(order.takeProfitPrice?.toString() || '');
    setLimitReason('');
    setLimitInstructionFile(null);
    setLimitModalOpen(true);
  };

  const handleUpdateLimit = async () => {
    if (!selectedOrder) return;

    if (!limitInstructionFile) {
      setActionError('Client instruction email is required for modifications');
      return;
    }

    setIsActioning(true);
    setActionError(null);

    try {
      const sessionId = getSessionId();

      // Read file as base64
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(limitInstructionFile);
      });

      const data = {
        orderId: selectedOrder.order._id,
        priceType: limitPriceType,
        sessionId,
        clientInstructionFile: {
          fileName: limitInstructionFile.name,
          base64Data: fileData,
          mimeType: limitInstructionFile.type || 'application/octet-stream'
        }
      };
      if (limitPriceType !== 'market' && limitNewPrice) {
        data.limitPrice = parseFloat(limitNewPrice);
      }
      if (limitNewStopLoss) {
        data.stopLossPrice = parseFloat(limitNewStopLoss);
      }
      if (limitNewTakeProfit) {
        data.takeProfitPrice = parseFloat(limitNewTakeProfit);
      }
      if (limitReason && limitReason.trim()) {
        data.reason = limitReason.trim();
      }

      await Meteor.callAsync('orders.updateLimit', data);

      setLimitModalOpen(false);
      setSelectedOrder(null);
      loadOrders();
      setBlotterRefreshKey(k => k + 1);
    } catch (err) {
      setActionError(err.reason || err.message);
    } finally {
      setIsActioning(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedOrder) return;

    setIsActioning(true);
    setActionError(null);

    try {
      const sessionId = getSessionId();
      const updateData = {
        quantity: parseFloat(editQuantity),
        priceType: editPriceType,
        notes: editNotes || undefined
      };

      if (editPriceType !== 'market' && editLimitPrice) {
        updateData.limitPrice = parseFloat(editLimitPrice);
      }

      await Meteor.callAsync('orders.update', {
        orderId: selectedOrder.order._id,
        updateData,
        sessionId
      });

      setEditModalOpen(false);
      setSelectedOrder(null);
      loadOrders();
    } catch (err) {
      setActionError(err.reason || err.message);
    } finally {
      setIsActioning(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedOrder) return;

    setIsActioning(true);
    setActionError(null);

    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.delete', {
        orderId: selectedOrder.order._id,
        sessionId
      });

      setDeleteModalOpen(false);
      setSelectedOrder(null);
      loadOrders();
    } catch (err) {
      setActionError(err.reason || err.message);
    } finally {
      setIsActioning(false);
    }
  };

  const handleReject = async () => {
    if (!selectedOrder || !rejectReason.trim()) return;

    setIsActioning(true);
    setActionError(null);

    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.rejectValidation', {
        orderId: selectedOrder.order._id,
        reason: rejectReason.trim(),
        sessionId
      });

      setRejectModalOpen(false);
      setRejectReason('');
      setSelectedOrder(null);
      loadOrders();
    } catch (err) {
      setActionError(err.reason || err.message);
    } finally {
      setIsActioning(false);
    }
  };

  // Styles
  const styles = {
    container: {
      padding: isMobile ? '0.75rem' : '1.5rem'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: isMobile ? 'stretch' : 'center',
      flexDirection: isMobile ? 'column' : 'row',
      marginBottom: isMobile ? '1rem' : '1.5rem',
      flexWrap: 'wrap',
      gap: isMobile ? '0.75rem' : '1rem'
    },
    title: {
      fontSize: isMobile ? '1.25rem' : '1.5rem',
      fontWeight: '600',
      color: 'var(--text-primary)',
      margin: 0
    },
    filters: {
      display: isMobile ? 'grid' : 'flex',
      gridTemplateColumns: isMobile ? '1fr' : undefined,
      flexWrap: 'wrap',
      gap: '12px',
      marginBottom: isMobile ? '1rem' : '1.5rem',
      alignItems: isMobile ? 'stretch' : 'center'
    },
    filterGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    },
    filterLabel: {
      fontSize: '11px',
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px'
    },
    // 16px on mobile: below that, iOS Safari zooms the page when a field takes focus.
    input: {
      padding: isMobile ? '11px 12px' : '8px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: isMobile ? '16px' : '13px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none',
      width: isMobile ? '100%' : undefined,
      minWidth: isMobile ? 0 : '150px',
      boxSizing: 'border-box'
    },
    select: {
      padding: isMobile ? '11px 12px' : '8px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: isMobile ? '16px' : '13px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none',
      cursor: 'pointer',
      width: isMobile ? '100%' : undefined,
      minWidth: isMobile ? 0 : '120px',
      boxSizing: 'border-box'
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse'
    },
    th: {
      textAlign: 'left',
      padding: '12px 16px',
      background: 'var(--bg-secondary)',
      borderBottom: '2px solid var(--border-color)',
      fontSize: '12px',
      fontWeight: '600',
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      position: 'sticky',
      top: 0,
      zIndex: 1
    },
    td: {
      padding: '12px 16px',
      borderBottom: '1px solid var(--border-color)',
      fontSize: '13px',
      color: 'var(--text-primary)'
    },
    statusBadge: (status) => ({
      display: 'inline-block',
      padding: '4px 10px',
      borderRadius: '12px',
      fontSize: '11px',
      fontWeight: '600',
      background: `${OrderFormatters.getStatusColor(status)}20`,
      color: OrderFormatters.getStatusColor(status)
    }),
    orderTypeBadge: (type) => ({
      display: 'inline-block',
      padding: '3px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: '600',
      textTransform: 'uppercase',
      background: type === 'buy' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
      color: type === 'buy' ? 'var(--gain-color)' : 'var(--loss-color)'
    }),
    actionButton: {
      padding: '4px 8px',
      border: 'none',
      borderRadius: '4px',
      fontSize: '12px',
      cursor: 'pointer',
      background: 'var(--bg-secondary)',
      color: 'var(--text-secondary)',
      transition: 'all 0.15s'
    },
    pagination: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexDirection: isMobile ? 'column' : 'row',
      gap: isMobile ? '0.5rem' : 0,
      marginTop: '1rem',
      padding: '0.5rem 0'
    },
    pageInfo: {
      fontSize: '13px',
      color: 'var(--text-secondary)'
    },
    pageButtons: {
      display: 'flex',
      gap: '8px',
      width: isMobile ? '100%' : undefined
    },
    emptyState: {
      textAlign: 'center',
      padding: '3rem',
      color: 'var(--text-secondary)'
    },
    // Order-detail modal. Rows carry a hairline on TOP (not bottom) so the first
    // row's line doubles as the separator under the section title and the last
    // row doesn't leave a stray divider before the next section's eyebrow.
    detailSection: {
      marginBottom: '24px'
    },
    detailTitle: {
      fontSize: '11px',
      fontWeight: '600',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      marginBottom: '2px',
      paddingBottom: '6px'
    },
    detailRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: '16px',
      padding: '7px 0',
      borderTop: '1px solid var(--border-color)'
    },
    detailLabel: {
      color: 'var(--text-secondary)',
      fontSize: '13px',
      flexShrink: 0,
      whiteSpace: 'nowrap'
    },
    detailValue: {
      fontWeight: '500',
      color: 'var(--text-primary)',
      fontSize: '13px',
      textAlign: 'right',
      minWidth: 0,
      overflowWrap: 'anywhere'
    }
  };

  const totalPages = Math.ceil(totalOrders / pageSize);

  /**
   * Order-detail action buttons (PDF, Email, Modify, Mark Executed, Delete, ...).
   * 'small' is a ~27px target — too small to hit confidently on a phone, and these
   * sit next to each other, so a mis-tap can mean deleting instead of executing.
   */
  const detailBtnSize = isMobile ? 'medium' : 'small';

  /**
   * Mobile order card.
   *
   * The blotter's 19 columns cannot be read on a phone — horizontally scrolling a
   * table to find the status of a reference is unusable. Each order becomes a card
   * carrying what you need to triage it (reference, status, side, security, account,
   * size) with the full record one tap away in the existing detail modal.
   */
  const renderOrderCard = (order) => {
    const statusColor = order.effectiveStatusColor || OrderFormatters.getStatusColor(order.status);
    const traceCompleteness = getTraceCompleteness(order);
    const traceColor = traceCompleteness.color;
    // Options store the placeholder ISIN 'OPT'; show the contract instead.
    const secondaryId = order.assetType === ASSET_TYPES.FX
      ? (order.fxPairFormatted || 'FX')
      : order.assetType === ASSET_TYPES.TERM_DEPOSIT
        ? (order.depositTenorLabel || 'TD')
        : order.assetType === ASSET_TYPES.OPTION
          ? (order.optionContractDescription || 'Option')
          : order.isin;

    return (
      <div
        key={order._id}
        onClick={() => handleViewDetails(order)}
        style={{
          padding: '12px',
          borderRadius: '10px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderLeft: `3px solid ${statusColor}`,
          cursor: 'pointer'
        }}
      >
        {/* Reference + status */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontFamily: 'monospace', fontWeight: '600', fontSize: '13px', color: 'var(--text-primary)' }}>
            {order.orderReference}
          </span>
          <span style={{
            flexShrink: 0,
            padding: '3px 9px',
            borderRadius: '12px',
            fontSize: '10px',
            fontWeight: '700',
            textTransform: 'uppercase',
            background: `color-mix(in srgb, ${statusColor} 13%, transparent)`,
            color: statusColor
          }}>
            {order.effectiveStatusLabel || order.statusLabel}
          </span>
        </div>

        {/* Side + security */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '2px' }}>
          <span style={styles.orderTypeBadge(order.orderType)}>{OrderFormatters.orderDirectionLabel(order)}</span>
          <span style={{
            fontWeight: '600',
            fontSize: '14px',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {order.securityName}
          </span>
        </div>
        {secondaryId && (
          <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)', marginBottom: '8px' }}>
            {secondaryId}
          </div>
        )}

        {/* Size, account, date */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', fontSize: '12px' }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Qty </span>
            <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{order.quantityFormatted}</span>
            {order.quantityUnitLabel ? <span style={{ color: 'var(--text-muted)' }}> {order.quantityUnitLabel}</span> : null}
            {order.currency && <span style={{ color: 'var(--text-muted)' }}> {order.currency}</span>}
          </div>
          <div style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
            {order.createdAtFormatted}
          </div>
          <div style={{
            gridColumn: '1 / -1',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {order.accountNumber}{order.accountName ? ` · ${order.accountName}` : ''}
          </div>
          <div style={{
            gridColumn: '1 / -1',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {order.bankName}
          </div>
        </div>

        {/* Footer badges: who validated, evidence completeness */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '10px', fontWeight: '600', color: traceColor,
            padding: '2px 7px', borderRadius: '10px', background: `color-mix(in srgb, ${traceColor} 15%, transparent)`
          }}>
            Traces {traceCompleteness.label}
          </span>
          {order.tradeMode === 'block' && (
            <span style={{
              fontSize: '10px', fontWeight: '600', color: '#8b5cf6',
              padding: '2px 7px', borderRadius: '10px', background: 'rgba(139,92,246,0.12)'
            }}>
              {order.tradeModeLabel || 'Block'}
            </span>
          )}
          {order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT && order.orderType === 'buy' && (
            <span style={{
              fontSize: '10px', fontWeight: '600',
              color: order.termsheetColor || '#6b7280',
              padding: '2px 7px', borderRadius: '10px',
              background: `${order.termsheetColor || '#6b7280'}15`
            }}>
              TS: {order.termsheetLabel || 'None'}
            </span>
          )}
          {order.validatedByName && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              ✓ {order.validatedByName}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {orderEmailSheet}
      {orderSendPreview}
      <MailPickerModal
        open={Boolean(mailPicker)}
        orderId={mailPicker?.orderId}
        traceType={mailPicker?.traceType}
        fixedMessages={mailPicker?.fixedMessages || null}
        heading={mailPicker?.heading || 'Attach from Outlook'}
        emptyText={mailPicker?.emptyText || 'No messages match these filters.'}
        // The order reference is in the subject of every mail we send for an
        // order, and replies keep it, so searching on it puts the right mail
        // first. It replaces the sender filter for the bank's reply: ANDed
        // with the desk address, a confirmation sent from a trader's own
        // mailbox would be filtered out. The client's order predates the
        // reference, so that picker opens unfiltered.
        defaultQuery={
          [
            EMAIL_TRACE_TYPES.ORDER_TO_BANK,
            EMAIL_TRACE_TYPES.ORDER_TO_ISSUER,
            EMAIL_TRACE_TYPES.BANK_CONFIRMATION
          ].includes(mailPicker?.traceType)
            ? (selectedOrder?.order?.orderReference || '')
            : ''
        }
        // The order to the bank and the order from the client sit in opposite
        // folders: one we sent, one we received.
        defaultFolder={
          mailPicker?.traceType === EMAIL_TRACE_TYPES.ORDER_TO_BANK
            || mailPicker?.traceType === EMAIL_TRACE_TYPES.ORDER_TO_ISSUER
            ? 'sentitems'
            : 'inbox'
        }
        onClose={() => setMailPicker(null)}
        onAttached={async () => {
          setMailPicker(null);
          setTraceError(null);
          // The detail modal holds a one-shot copy of the order, so the tile
          // stayed empty until it was closed and reopened. Re-read it — the
          // same refresh the drag-and-drop upload path already does, since a
          // trace can also advance the order's status.
          const orderId = mailPicker?.orderId || selectedOrder?.order?._id;
          if (!orderId) return;
          try {
            const refreshed = await Meteor.callAsync('orders.get', { orderId, sessionId: getSessionId() });
            setSelectedOrder(refreshed);
            loadOrders();
          } catch (err) {
            console.error('Error refreshing order after attaching from Outlook:', err);
          }
        }}
      />
      <MailPickerModal
        open={Boolean(filePicker)}
        heading="Pick from Outlook"
        onClose={() => setFilePicker(null)}
        onPickFile={(file) => {
          if (filePicker === 'limitInstruction') {
            setLimitInstructionFile(file);
            setActionError(null);
          } else if (filePicker?.kind === 'signedTermsheet') {
            handleSignedTermsheetUpload(file, filePicker.orderId);
          }
          setFilePicker(null);
        }}
      />
      <LiquidGlassCard>
        <div style={{ padding: '1.5rem' }}>
          {/* Header */}
          <div style={styles.header}>
            <h1 style={styles.title}>Order Book</h1>
            <ActionButton
              variant="primary"
              size={isMobile ? 'large' : 'medium'}
              fullWidth={isMobile}
              onClick={() => setNewOrderModalOpen(true)}
            >
              + New Order
            </ActionButton>
          </div>

          {/* Filters (collapsible) */}
          {(() => {
            const activeCount =
              (searchQuery ? 1 : 0) +
              (statusFilter !== 'all' ? 1 : 0) +
              (bankFilter !== 'all' ? 1 : 0) +
              (clientFilter !== 'all' ? 1 : 0) +
              (validatorFilter !== 'all' ? 1 : 0) +
              (dateFrom ? 1 : 0) +
              (dateTo ? 1 : 0);
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 12px', marginBottom: filtersExpanded ? '8px' : '12px',
                borderRadius: '8px', background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)', cursor: 'pointer'
              }} onClick={() => setFiltersExpanded(v => !v)}>
                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                  {filtersExpanded ? '▾' : '▸'} Search & Filters
                </span>
                {activeCount > 0 && (
                  <span style={{
                    fontSize: '11px', fontWeight: '700', color: '#fff',
                    background: 'var(--info-color)', padding: '2px 8px', borderRadius: '10px'
                  }}>
                    {activeCount} active
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
                  {filtersExpanded ? 'Click to collapse' : 'Click to expand'}
                </span>
              </div>
            );
          })()}
          {filtersExpanded && (
          <div style={styles.filters}>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Search</span>
              <input
                type="text"
                style={{ ...styles.input, minWidth: '200px' }}
                placeholder="Reference, ISIN, or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Status</span>
              <select
                style={styles.select}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value={ORDER_STATUSES.PENDING_VALIDATION}>Pending Validation</option>
                <option value={ORDER_STATUSES.PENDING}>Pending</option>
                <option value={ORDER_STATUSES.SENT}>Sent</option>
                <option value={ORDER_STATUSES.EXECUTED}>Executed</option>
                <option value={ORDER_STATUSES.PARTIALLY_EXECUTED}>Partially Executed</option>
                <option value={ORDER_STATUSES.CANCELLED}>Cancelled</option>
              </select>
            </div>

            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Bank</span>
              <select
                style={styles.select}
                value={bankFilter}
                onChange={(e) => setBankFilter(e.target.value)}
              >
                <option value="all">All Banks</option>
                {banks.map(bank => (
                  <option key={bank._id} value={bank._id}>{bank.name}</option>
                ))}
              </select>
            </div>

            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Client</span>
              <select
                style={styles.select}
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
              >
                <option value="all">All Clients</option>
                {clients
                  .sort((a, b) => (a.displayName || '').toLowerCase().localeCompare((b.displayName || '').toLowerCase()))
                  .map(c => (
                    <option key={c._id} value={c._id}>
                      {c.displayName}
                    </option>
                  ))
                }
              </select>
            </div>

            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Validator</span>
              <select
                style={styles.select}
                value={validatorFilter}
                onChange={(e) => setValidatorFilter(e.target.value)}
              >
                <option value="all">All Validators</option>
                {validators.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>From</span>
              <input
                type="date"
                style={styles.input}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>To</span>
              <input
                type="date"
                style={styles.input}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              <ActionButton
                variant="secondary"
                size="small"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                  setBankFilter('all');
                  setClientFilter('all');
                  setValidatorFilter('all');
                  setMissingTermsheetFilter(false);
                  setDateFrom('');
                  setDateTo('');
                }}
              >
                Clear Filters
              </ActionButton>
              <ActionButton
                variant="secondary"
                size="small"
                onClick={handleExportExcel}
                disabled={!totalOrders || isExporting}
              >
                {isExporting ? 'Exporting…' : 'Export Excel'}
              </ActionButton>
            </div>
          </div>
          )}

          {/* Validation Blotter (four-eyes principle) */}
          <ValidationBlotter user={user} onOrderUpdate={loadOrders} />

          {/* Health Check Summary — desktop only. It is a back-office triage aid: on a
              phone the badges wrap into several rows and push the orders themselves off
              the first screen, and the per-order state is already on each card. */}
          {!isMobile && !isLoading && (orders.length > 0 || healthFilter) && (() => {
            const toggleHealthFilter = (value) => {
              setHealthFilter(prev => (prev === value ? null : value));
              setCurrentPage(1);
            };
            // Server counts cover the whole filtered book; the page-derived
            // fallback only matters if an older server answers without them.
            const stats = healthStats || displayOrders.reduce((acc, o) => {
              const h = getOrderHealthCheck(o);
              if (h.max > 0 && h.score < h.max) {
                acc.incomplete++;
                h.missing.forEach(m => { acc.missingCounts[m] = (acc.missingCounts[m] || 0) + 1; });
              }
              if (h.max > 0 && h.score === h.max) acc.complete++;
              return acc;
            }, { incomplete: 0, complete: 0, missingCounts: {} });

            const missingCounts = stats.missingCounts || {};
            const topMissing = Object.entries(missingCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);
            // The active chip always stays on screen, even when it falls out of
            // the top five — it is how you switch the filter back off.
            if (healthFilter && healthFilter !== HEALTH_FILTER_ANY && !topMissing.some(([name]) => name === healthFilter)) {
              topMissing.push([healthFilter, missingCounts[healthFilter] || 0]);
            }

            // With a filter on, every row shown is incomplete by construction, so
            // the bar stays in its warning colour even when the page is empty.
            const isAllGood = stats.incomplete === 0 && !healthFilter;
            const trackable = stats.complete + stats.incomplete;
            const barColor = isAllGood ? 'var(--gain-color)' : 'var(--warning-color)';
            const chipStyle = (active) => ({
              padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
              background: active ? barColor : `color-mix(in srgb, ${barColor} 18%, transparent)`,
              color: active ? 'white' : barColor,
              border: `1px solid color-mix(in srgb, ${barColor} ${active ? '100%' : '30%'}, transparent)`,
              cursor: 'pointer', fontFamily: 'inherit', lineHeight: 'inherit'
            });

            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 12px',
                marginBottom: '10px', borderRadius: '8px', fontSize: '12px',
                background: `color-mix(in srgb, ${barColor} 15%, transparent)`, border: `1px solid color-mix(in srgb, ${barColor} 40%, transparent)`,
                flexWrap: 'wrap'
              }}>
                {!isAllGood && (
                  <span style={{ fontSize: '14px', flexShrink: 0 }}>&#9888;</span>
                )}
                <span style={{
                  fontWeight: '700', fontSize: '12px', color: barColor,
                  padding: '2px 8px', borderRadius: '10px',
                  background: `color-mix(in srgb, ${barColor} 25%, transparent)`, flexShrink: 0
                }}>
                  {stats.complete}/{trackable}
                </span>
                {isAllGood ? (
                  <span style={{ fontWeight: '600', color: barColor, fontSize: '12px' }}>All orders complete</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleHealthFilter(HEALTH_FILTER_ANY)}
                    title={healthFilter === HEALTH_FILTER_ANY ? 'Showing incomplete orders only - click to show all' : 'Show only orders with missing items'}
                    style={{
                      ...chipStyle(healthFilter === HEALTH_FILTER_ANY),
                      fontSize: '12px', padding: '2px 8px',
                      background: healthFilter === HEALTH_FILTER_ANY ? barColor : 'transparent',
                      border: healthFilter === HEALTH_FILTER_ANY ? `1px solid ${barColor}` : '1px solid transparent'
                    }}
                  >
                    {healthFilter && healthFilter !== HEALTH_FILTER_ANY && !missingCounts[healthFilter]
                      ? `No orders missing "${healthFilter}"`
                      : `${stats.incomplete} order${stats.incomplete !== 1 ? 's' : ''} missing items`}
                  </button>
                )}
                {topMissing.map(([name, count]) => {
                  const active = healthFilter === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleHealthFilter(name)}
                      title={active ? `Showing orders missing "${name}" - click to show all` : `Show only orders missing "${name}"`}
                      style={chipStyle(active)}
                    >
                      {name}: {count}
                    </button>
                  );
                })}
                {healthFilter && (
                  <button
                    type="button"
                    onClick={() => { setHealthFilter(null); setCurrentPage(1); }}
                    style={{ ...chipStyle(false), marginLeft: 'auto', background: 'transparent' }}
                  >
                    Clear filter
                  </button>
                )}
              </div>
            );
          })()}

          {/* Orders Table */}
          {isLoading ? (
            <div style={styles.emptyState}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>Loading...</div>
            </div>
          ) : orders.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.3 }}>📋</div>
              <div style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No orders found</div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Create your first order or adjust the filters
              </div>
              {missingTermsheetFilter && (
                <div style={{ marginTop: '1rem' }}>
                  <ActionButton
                    variant="secondary"
                    size="small"
                    onClick={() => { setMissingTermsheetFilter(false); setCurrentPage(1); }}
                  >
                    Clear termsheet filter
                  </ActionButton>
                </div>
              )}
              {healthFilter && (
                <div style={{ marginTop: '1rem' }}>
                  <ActionButton
                    variant="secondary"
                    size="small"
                    onClick={() => { setHealthFilter(null); setCurrentPage(1); }}
                  >
                    Clear missing-items filter
                  </ActionButton>
                </div>
              )}
            </div>
          ) : (
            <>
              {isMobile ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {displayOrders.map(renderOrderCard)}
                </div>
              ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <SortableHeader field="orderReference" label="Reference" />
                      <SortableHeader field="createdAt" label="Date" />
                      <SortableHeader field="status" label="Status" />
                      <SortableHeader field="wealthAdvisor" label="WA" />
                      <SortableHeader field="validatedByName" label="Validator" />
                      <SortableHeader field="accountNumber" label="Account #" />
                      <SortableHeader field="accountName" label="Account Name" />
                      <SortableHeader field="bankName" label="Bank" />
                      <SortableHeader field="orderType" label="Type" />
                      <SortableHeader field="securityName" label="Security" />
                      <SortableHeader field="assetType" label="Asset" />
                      <SortableHeader field="currency" label="Ccy" />
                      <SortableHeader field="quantity" label="Qty" />
                      <SortableHeader field="executedPrice" label="Exec Price" />
                      <SortableHeader field="broker" label="Broker" />
                      <SortableHeader field="settlementCurrency" label="Settl. Ccy" />
                      <th
                        style={{
                          ...styles.th,
                          cursor: 'pointer',
                          userSelect: 'none',
                          whiteSpace: 'nowrap',
                          color: missingTermsheetFilter ? 'var(--warning-color)' : styles.th.color
                        }}
                        title={missingTermsheetFilter
                          ? 'Showing only structured products with a missing termsheet — click to show all'
                          : 'Termsheet — click to show only structured products with a missing termsheet'}
                        onClick={() => { setMissingTermsheetFilter(v => !v); setCurrentPage(1); }}
                      >
                        TS{missingTermsheetFilter && <span style={{ fontSize: '10px' }}> ●</span>}
                      </th>
                      <SortableHeader field="bulkOrderGroupId" label="Ind/Bloc" />
                      <th style={styles.th}>Traces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayOrders.map((order, idx) => {
                      const rowBg = idx % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)';
                      return (
                      <tr
                        key={order._id}
                        style={{ cursor: 'pointer', background: rowBg }}
                        onClick={() => handleViewDetails(order)}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary, var(--bg-secondary))'}
                        onMouseLeave={(e) => e.currentTarget.style.background = rowBg}
                      >
                        <td style={styles.td}>
                          <span style={{ fontFamily: 'monospace', fontWeight: '500' }}>
                            {order.orderReference}
                          </span>
                          {order.bulkOrderGroupId && (
                            <span style={{
                              marginLeft: '6px',
                              fontSize: '10px',
                              padding: '2px 6px',
                              background: 'var(--bg-secondary)',
                              borderRadius: '4px',
                              color: 'var(--text-muted)'
                            }}>
                              BULK
                            </span>
                          )}
                        </td>
                        <td style={styles.td} title={order.createdAtFull}>{order.createdAtFormatted}</td>
                        <td style={styles.td} onClick={order.canForceSettle ? (e) => e.stopPropagation() : undefined}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '4px 10px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: '600',
                              background: `${order.effectiveStatusColor || OrderFormatters.getStatusColor(order.status)}20`,
                              color: order.effectiveStatusColor || OrderFormatters.getStatusColor(order.status),
                              cursor: order.canForceSettle ? 'pointer' : 'default',
                              textDecoration: order.canForceSettle ? 'underline dotted' : 'none'
                            }}
                            title={
                              order.settlementStatus === 'forced'
                                ? `Forced${order.settlementForcedReason ? ': ' + order.settlementForcedReason : ''}`
                                : order.settlementStatus === 'settled' && order.settlementConfirmedAt
                                  ? `Confirmed ${new Date(order.settlementConfirmedAt).toLocaleDateString()}`
                                  : order.canForceSettle
                                    ? 'Click to force settle'
                                    : undefined
                            }
                            onClick={order.canForceSettle
                              ? () => setForceSettleOrder({ _id: order._id, orderReference: order.orderReference, securityName: order.securityName })
                              : undefined}
                          >
                            {order.effectiveStatusLabel || order.statusLabel}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                            {order.wealthAmbassadorFormatted || ''}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span
                            title={order.validatedByName ? `Validated by ${order.validatedByName}${order.validatedAtFormatted ? ` on ${order.validatedAtFormatted}` : ''}` : ''}
                            style={{ fontSize: '12px', fontWeight: '500', color: order.validatedByName ? 'var(--text-secondary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}
                          >
                            {order.validatedByName || '—'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <div style={{ fontWeight: '500', whiteSpace: 'nowrap' }}>{order.accountNumber}</div>
                        </td>
                        <td style={styles.td}>
                          <div
                            title={order.accountName}
                            style={{
                              fontSize: '12px',
                              color: 'var(--text-secondary)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '160px'
                            }}
                          >
                            {order.accountName || ''}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <div
                            title={order.bankName}
                            style={{
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '140px'
                            }}
                          >
                            {order.bankName}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <span style={styles.orderTypeBadge(order.orderType)}>
                            {OrderFormatters.orderDirectionLabel(order)}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <div
                            title={order.orderSecurityName && order.orderSecurityName !== order.securityName
                              ? `${order.securityName}\nEntered on the order as “${order.orderSecurityName}”`
                              : order.securityName}
                            style={{ fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}
                          >{order.securityName}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            {order.assetType === ASSET_TYPES.FX ? (order.fxPairFormatted || 'FX') :
                             order.assetType === ASSET_TYPES.TERM_DEPOSIT ? (order.depositTenorLabel || 'TD') :
                             order.assetType === ASSET_TYPES.OPTION ? (order.optionContractDescription || 'Option') :
                             order.isin}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {order.assetTypeLabel || ''}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontSize: '12px' }}>{order.currency || ''}</span>
                        </td>
                        <td style={styles.td}>
                          {order.quantityFormatted}
                          {order.quantityUnitLabel ? <span style={{ color: 'var(--text-muted)' }}> {order.quantityUnitLabel}</span> : null}
                        </td>
                        <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                          <InlineExecPriceCell
                            order={order}
                            onSaved={loadOrders}
                          />
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {order.broker || ''}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontSize: '12px' }}>{order.settlementCurrency || ''}</span>
                        </td>
                        <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                          {order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT && order.orderType === 'buy' ? (
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: '600',
                                color: order.termsheetColor || '#6b7280',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                background: `${order.termsheetColor || '#6b7280'}15`,
                                cursor: 'pointer',
                                userSelect: 'none'
                              }}
                              onClick={(e) => { e.stopPropagation(); requestTermsheetAdvance(order); }}
                              title={order.termsheetUpdatedByFormatted
                                ? `${order.termsheetUpdatedByFormatted} — ${order.termsheetUpdatedAtFormatted}\nClick to cycle: None → Sent → Signed (file required)`
                                : 'Click to cycle: None → Sent → Signed (file required)'}
                            >
                              {order.termsheetLabel || 'None'}
                            </span>
                          ) : (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: '500',
                            color: order.tradeMode === 'block' ? '#8b5cf6' : 'var(--text-secondary)'
                          }}>
                            {order.tradeModeLabel || 'Ind.'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {(() => {
                            const traces = order.emailTraces || [];
                            const traceCompleteness = getTraceCompleteness(order);
                            const color = traceCompleteness.color;
                            const hasClientOrderTrace = traces.some(t => t.traceType === EMAIL_TRACE_TYPES.CLIENT_ORDER);
                            // A terminal order (cancelled/rejected) is never waiting on a
                            // deferred client order — it will never be attached.
                            const showDeferred = order.clientOrderDeferred && !hasClientOrderTrace && !traceCompleteness.isTerminal;
                            return (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{
                                  fontSize: '11px',
                                  fontWeight: '600',
                                  color,
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  background: `color-mix(in srgb, ${color} 15%, transparent)`
                                }}>
                                  {traceCompleteness.label}
                                </span>
                                {showDeferred && (
                                  <span
                                    title={`Client order will be attached later by ${order.clientOrderDeferred.byName || 'creator'}`}
                                    style={{
                                      fontSize: '11px',
                                      color: '#f97316',
                                      padding: '2px 6px',
                                      borderRadius: '10px',
                                      background: 'rgba(249, 115, 22, 0.12)',
                                      border: '1px solid rgba(249, 115, 22, 0.35)'
                                    }}
                                  >⏳</span>
                                )}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
              )}

              {/* Pagination */}
              <div style={styles.pagination}>
                <span style={styles.pageInfo}>
                  Showing {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, totalOrders)} of {totalOrders}
                </span>
                <div style={styles.pageButtons}>
                  <ActionButton
                    variant="secondary"
                    size={isMobile ? 'large' : 'small'}
                    fullWidth={isMobile}
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  >
                    Previous
                  </ActionButton>
                  <ActionButton
                    variant="secondary"
                    size={isMobile ? 'large' : 'small'}
                    fullWidth={isMobile}
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(p => p + 1)}
                  >
                    Next
                  </ActionButton>
                </div>
              </div>
            </>
          )}
        </div>
      </LiquidGlassCard>

      {/* Order Detail Modal */}
      <Modal
        isOpen={detailModalOpen}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedOrder(null);
        }}
        title={selectedOrder?.order?.orderReference ? `Order ${selectedOrder.order.orderReference}` : 'Order Details'}
        size="medium"
        footer={selectedOrder && (
          <>
            {/* PDF / Audit Trail exports are desktop-only — not useful on a phone */}
            {!isMobile && (
              <>
                <ActionButton
                  variant="secondary"
                  size={detailBtnSize}
                  disabled={loadingPDF === selectedOrder.order._id || selectedOrder.order.status === ORDER_STATUSES.PENDING_VALIDATION}
                  onClick={() => handleGeneratePDF(selectedOrder.order)}
                >
                  {loadingPDF === selectedOrder.order._id ? '...' : 'PDF'}
                </ActionButton>
                <ActionButton
                  variant="secondary"
                  size={detailBtnSize}
                  disabled={loadingAuditPDF === selectedOrder.order._id}
                  onClick={() => handleGenerateAuditTrail(selectedOrder.order)}
                >
                  {loadingAuditPDF === selectedOrder.order._id ? '...' : 'Audit Trail'}
                </ActionButton>
              </>
            )}
            {selectedOrder.order.status !== ORDER_STATUSES.CANCELLED &&
             selectedOrder.order.status !== ORDER_STATUSES.EXECUTED && (
              <>
                {selectedOrder.order.status !== ORDER_STATUSES.PENDING_VALIDATION && (
                  <ActionButton
                    variant="secondary"
                    size={detailBtnSize}
                    disabled={loadingEmail === selectedOrder.order._id}
                    onClick={() => handleSendEmail(selectedOrder.order)}
                  >
                    {loadingEmail === selectedOrder.order._id ? '...' : 'Email'}
                  </ActionButton>
                )}
                {(selectedOrder.order.status === ORDER_STATUSES.PENDING || selectedOrder.order.status === ORDER_STATUSES.SENT) && (
                  <ActionButton
                    variant="secondary"
                    size={detailBtnSize}
                    onClick={() => {
                      setDetailModalOpen(false);
                      openLimitModal(selectedOrder.order);
                    }}
                    style={{ color: 'var(--warning-color)' }}
                  >
                    Modify
                  </ActionButton>
                )}
                {selectedOrder.order.status !== ORDER_STATUSES.PENDING_VALIDATION && (() => {
                  const needsTermsheet = selectedOrder.order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT
                    && selectedOrder.order.orderType === 'buy'
                    && selectedOrder.order.termsheetStatus !== TERMSHEET_STATUSES.SIGNED;
                  return (
                    <ActionButton
                      variant="success"
                      size={detailBtnSize}
                      disabled={needsTermsheet}
                      title={needsTermsheet ? 'Upload the final signed termsheet before marking this structured product as executed' : undefined}
                      onClick={() => {
                        setDetailModalOpen(false);
                        setExecutedQuantity(selectedOrder.order.quantity?.toString() || '');
                        setExecuteModalOpen(true);
                      }}
                    >
                      Mark Executed
                    </ActionButton>
                  );
                })()}
                {selectedOrder.order.status === ORDER_STATUSES.PENDING && (
                  <ActionButton
                    variant="danger"
                    size={detailBtnSize}
                    onClick={() => {
                      setDetailModalOpen(false);
                      setRejectReason('');
                      setRejectModalOpen(true);
                    }}
                  >
                    Reject
                  </ActionButton>
                )}
                {(selectedOrder.order.status === ORDER_STATUSES.PENDING || selectedOrder.order.status === ORDER_STATUSES.PENDING_VALIDATION) && (
                  <ActionButton
                    variant="danger"
                    size={detailBtnSize}
                    onClick={() => {
                      setDetailModalOpen(false);
                      setDeleteModalOpen(true);
                    }}
                  >
                    Delete
                  </ActionButton>
                )}
              </>
            )}
            <ActionButton variant="secondary" size={detailBtnSize} onClick={() => setDetailModalOpen(false)}>
              Close
            </ActionButton>
          </>
        )}
      >
        {selectedOrder && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
              <span style={styles.orderTypeBadge(selectedOrder.order.orderType)}>
                {OrderFormatters.orderDirectionLabel(selectedOrder.order)}
              </span>
              <span style={styles.statusBadge(selectedOrder.order.status)}>
                {selectedOrder.order.statusLabel}
              </span>
            </div>

            <div style={styles.detailSection}>
              <div style={styles.detailTitle}>Security Details</div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Security</span>
                <span style={styles.detailValue}>{selectedOrder.order.securityName}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>ISIN</span>
                <span style={styles.detailValue}>{selectedOrder.order.isin}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Asset Type</span>
                <span style={styles.detailValue}>{selectedOrder.order.assetTypeLabel}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Currency</span>
                <span style={styles.detailValue}>{selectedOrder.order.currency}</span>
              </div>
              {selectedOrder.order.broker && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Broker / Issuer</span>
                  <span style={styles.detailValue}>{selectedOrder.order.broker}</span>
                </div>
              )}
              {(() => {
                const coords = getIssuerCoordinates(selectedOrder.order);
                if (!coords) return null;
                const hasContact = coords.name || coords.email || coords.phone;
                return (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Issuer Contact</span>
                    <span style={{ ...styles.detailValue, textAlign: 'right' }}>
                      {hasContact ? (
                        <>
                          {coords.name && <div>{coords.name}</div>}
                          {coords.email && (
                            <div><a href={`mailto:${coords.email}`} style={{ color: 'var(--accent-color)', textDecoration: 'none' }}>{coords.email}</a></div>
                          )}
                          {coords.phone && (
                            <div><a href={`tel:${coords.phone.replace(/\s/g, '')}`} style={{ color: 'var(--accent-color)', textDecoration: 'none' }}>{coords.phone}</a></div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: '400' }}>None on file</span>
                      )}
                    </span>
                  </div>
                );
              })()}
              {selectedOrder.order.underlyings && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Underlyings</span>
                  <span style={styles.detailValue}>{selectedOrder.order.underlyings}</span>
                </div>
              )}
              {/* FX-specific details */}
              {selectedOrder.order.assetType === ASSET_TYPES.FX && selectedOrder.order.fxPairFormatted && (
                <>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>FX Pair</span>
                    <span style={styles.detailValue}>{selectedOrder.order.fxPairFormatted}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>FX Type</span>
                    <span style={styles.detailValue}>{selectedOrder.order.fxSubtypeLabel || 'Spot'}</span>
                  </div>
                  {selectedOrder.order.fxAmountCurrencyFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Amount Currency</span>
                      <span style={styles.detailValue}>{selectedOrder.order.fxAmountCurrencyFormatted}</span>
                    </div>
                  )}
                  {selectedOrder.order.fxRateFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Rate</span>
                      <span style={styles.detailValue}>{selectedOrder.order.fxRateFormatted}</span>
                    </div>
                  )}
                  {selectedOrder.order.limitPriceFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Limit Price</span>
                      <span style={styles.detailValue}>{selectedOrder.order.limitPriceFormatted}</span>
                    </div>
                  )}
                  {selectedOrder.order.stopLossPriceFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Stop Loss</span>
                      <span style={styles.detailValue}>{selectedOrder.order.stopLossPriceFormatted}</span>
                    </div>
                  )}
                  {selectedOrder.order.takeProfitPriceFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Take Profit</span>
                      <span style={styles.detailValue}>{selectedOrder.order.takeProfitPriceFormatted}</span>
                    </div>
                  )}
                  {selectedOrder.order.fxValueDateFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Value Date</span>
                      <span style={styles.detailValue}>{selectedOrder.order.fxValueDateFormatted}</span>
                    </div>
                  )}
                  {selectedOrder.order.fxForwardDateFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Forward Date</span>
                      <span style={styles.detailValue}>{selectedOrder.order.fxForwardDateFormatted}</span>
                    </div>
                  )}
                </>
              )}
              {/* Term Deposit-specific details */}
              {selectedOrder.order.assetType === ASSET_TYPES.TERM_DEPOSIT && (
                <>
                  {selectedOrder.order.depositAction && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Action</span>
                      <span style={{
                        ...styles.detailValue,
                        fontWeight: '600',
                        color: selectedOrder.order.depositAction === 'increase' ? 'var(--gain-color)' : 'var(--loss-color)'
                      }}>
                        {selectedOrder.order.depositAction === 'increase' ? 'Increase' : 'Decrease'}
                      </span>
                    </div>
                  )}
                  {selectedOrder.order.depositCurrency && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Deposit Currency</span>
                      <span style={styles.detailValue}>{selectedOrder.order.depositCurrency}</span>
                    </div>
                  )}
                  {selectedOrder.order.depositTenorLabel && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Tenor</span>
                      <span style={styles.detailValue}>{selectedOrder.order.depositTenorLabel}</span>
                    </div>
                  )}
                  {selectedOrder.order.depositMaturityDateFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Maturity Date</span>
                      <span style={styles.detailValue}>{selectedOrder.order.depositMaturityDateFormatted}</span>
                    </div>
                  )}
                </>
              )}
              {/* Listed option contract. Each row is driven by its own field, not
                  by assetType: reclassifyByIsin can retype an order 'option'
                  with no contract details behind it. */}
              {selectedOrder.order.assetType === ASSET_TYPES.OPTION && (
                <>
                  {selectedOrder.order.optionUnderlyingFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Underlying</span>
                      <span style={styles.detailValue}>
                        {selectedOrder.order.optionUnderlyingFormatted}
                        {selectedOrder.order.optionUnderlyingIsin ? ` (${selectedOrder.order.optionUnderlyingIsin})` : ''}
                      </span>
                    </div>
                  )}
                  {selectedOrder.order.optionTypeLabel && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Call / Put</span>
                      <span style={styles.detailValue}>{selectedOrder.order.optionTypeLabel}</span>
                    </div>
                  )}
                  {selectedOrder.order.optionStrikeFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Strike</span>
                      <span style={styles.detailValue}>{selectedOrder.order.optionStrikeFormatted}</span>
                    </div>
                  )}
                  {selectedOrder.order.optionExpiryFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Expiry</span>
                      <span style={styles.detailValue}>{selectedOrder.order.optionExpiryFormatted}</span>
                    </div>
                  )}
                  {selectedOrder.order.optionContractSizeFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Contract Size</span>
                      <span style={styles.detailValue}>
                        {selectedOrder.order.optionContractSizeFormatted} shares
                        {selectedOrder.order.optionShareEquivalentFormatted
                          ? ` (${selectedOrder.order.optionShareEquivalentFormatted} in total)`
                          : ''}
                      </span>
                    </div>
                  )}
                  {selectedOrder.order.optionExchangeFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Exchange</span>
                      <span style={styles.detailValue}>{selectedOrder.order.optionExchangeFormatted}</span>
                    </div>
                  )}
                  {selectedOrder.order.optionContractSymbol && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Contract Symbol</span>
                      <span style={{ ...styles.detailValue, fontFamily: 'monospace' }}>{selectedOrder.order.optionContractSymbol}</span>
                    </div>
                  )}
                  {selectedOrder.order.optionQuoteAtEntryFormatted && (
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Reference Premium</span>
                      <span style={styles.detailValue}>
                        {selectedOrder.order.optionQuoteAtEntryFormatted.bidAskFormatted || selectedOrder.order.optionQuoteAtEntryFormatted.last || '—'}
                        {selectedOrder.order.optionQuoteAtEntryFormatted.impliedVolatilityFormatted ? ` · IV ${selectedOrder.order.optionQuoteAtEntryFormatted.impliedVolatilityFormatted}` : ''}
                        {selectedOrder.order.optionQuoteAtEntryFormatted.updatedAt ? ` · EOD ${selectedOrder.order.optionQuoteAtEntryFormatted.updatedAt}` : ''}
                      </span>
                    </div>
                  )}
                </>
              )}
              {/* Cover as it stood when the order was entered. This is the audit
                  record, not a live number - the validator's blotter recomputes. */}
              {selectedOrder.order.coverageCheckFormatted && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Cover at entry</span>
                  <span style={{
                    ...styles.detailValue,
                    fontWeight: '600',
                    color: selectedOrder.order.coverageCheckFormatted.isCovered ? 'var(--gain-color)' : 'var(--warning-color)'
                  }}>
                    {selectedOrder.order.coverageCheckFormatted.isCovered
                      ? `Covered — ${selectedOrder.order.coverageCheckFormatted.heldSharesFormatted} held`
                      : `Uncovered — short by ${selectedOrder.order.coverageCheckFormatted.shortfallSharesFormatted}`}
                    {selectedOrder.order.coverageCheckFormatted.holdingsAsOfFormatted
                      ? ` (positions as of ${selectedOrder.order.coverageCheckFormatted.holdingsAsOfFormatted})`
                      : ''}
                  </span>
                </div>
              )}
              {selectedOrder.order.coverageCheckFormatted?.justification && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Reason given</span>
                  <span style={styles.detailValue}>{selectedOrder.order.coverageCheckFormatted.justification}</span>
                </div>
              )}
              {selectedOrder.order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT && selectedOrder.order.orderType === 'buy' && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Termsheet</span>
                  <span style={styles.detailValue}>
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        color: selectedOrder.order.termsheetColor || '#6b7280',
                        padding: '3px 10px',
                        borderRadius: '10px',
                        background: `${selectedOrder.order.termsheetColor || '#6b7280'}15`,
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}
                      onClick={() => requestTermsheetAdvance(selectedOrder.order)}
                      title={selectedOrder.order.termsheetUpdatedByFormatted
                        ? `${selectedOrder.order.termsheetUpdatedByFormatted} — ${selectedOrder.order.termsheetUpdatedAtFormatted}\nClick to cycle: None → Sent → Signed (file required)`
                        : 'Click to cycle: None → Sent → Signed (file required)'}
                    >
                      {selectedOrder.order.termsheetLabel || 'None'}
                    </span>
                    {selectedOrder.order.termsheetUpdatedByFormatted && (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                        by {selectedOrder.order.termsheetUpdatedByFormatted}, {selectedOrder.order.termsheetUpdatedAtFormatted}
                      </span>
                    )}
                  </span>
                </div>
              )}
              {selectedOrder.order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT &&
                (selectedOrder.order.termsheetSentTrace || selectedOrder.order.termsheetSignedTrace) && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Evidence</span>
                  <span style={{ ...styles.detailValue, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {[
                      { label: 'Sent', trace: selectedOrder.order.termsheetSentTrace },
                      { label: 'Signed', trace: selectedOrder.order.termsheetSignedTrace }
                    ].filter(item => item.trace).map(item => (
                      <span key={item.label} style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        <strong style={{ color: 'var(--text-primary)' }}>{item.label}:</strong>{' '}
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            handleDownloadTrace(selectedOrder.order._id, item.trace._id, item.trace.fileName);
                          }}
                          style={{ color: '#0ea5e9', textDecoration: 'underline' }}
                        >
                          {item.trace.fileName}
                        </a>
                        {' '}— uploaded {OrderFormatters.formatDateTime(item.trace.uploadedAt)}
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>

            <div style={styles.detailSection}>
              <div style={styles.detailTitle}>Order Details</div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>
                  {selectedOrder.order.quantityUnitLabel === 'contracts' ? 'Contracts' : 'Quantity'}
                </span>
                <span style={styles.detailValue}>
                  {selectedOrder.order.quantityFormatted}
                  {selectedOrder.order.optionShareEquivalentFormatted
                    ? ` (${selectedOrder.order.optionShareEquivalentFormatted} shares)`
                    : ''}
                </span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Execution</span>
                <span style={{
                  ...styles.detailValue,
                  fontWeight: selectedOrder.order.executionType === EXECUTION_TYPES.PRE_EXECUTED ? '700' : undefined,
                  color: selectedOrder.order.executionType === EXECUTION_TYPES.PRE_EXECUTED ? 'var(--warning-color)' : undefined
                }}>
                  {EXECUTION_TYPE_LABELS[selectedOrder.order.executionType] || EXECUTION_TYPE_LABELS[EXECUTION_TYPES.TO_EXECUTE]}
                </span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Price Type</span>
                <span style={styles.detailValue}>{selectedOrder.order.priceTypeLabel}</span>
              </div>
              {selectedOrder.order.limitPrice && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Limit Price</span>
                  <span style={styles.detailValue}>{selectedOrder.order.limitPriceFormatted}</span>
                </div>
              )}
              {selectedOrder.order.estimatedValue && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Estimated Value</span>
                  <span style={styles.detailValue}>{selectedOrder.order.estimatedValueFormatted}</span>
                </div>
              )}
              {selectedOrder.order.settlementCurrency && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Settlement Currency</span>
                  <span style={styles.detailValue}>{selectedOrder.order.settlementCurrency}</span>
                </div>
              )}
              {selectedOrder.order.executedQuantity > 0 && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Executed Quantity</span>
                  <span style={styles.detailValue}>{selectedOrder.order.executedQuantityFormatted}</span>
                </div>
              )}
              {selectedOrder.order.executedPriceFormatted && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Executed Price</span>
                  <span style={styles.detailValue}>{selectedOrder.order.executedPriceFormatted}</span>
                </div>
              )}
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Trade Mode</span>
                <span style={styles.detailValue}>{selectedOrder.order.tradeModeLabel || 'Individual'}</span>
              </div>
            </div>

            <div style={styles.detailSection}>
              <div style={styles.detailTitle}>Account Information</div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Client</span>
                <span style={styles.detailValue}>
                  {selectedOrder.client ? (selectedOrder.client.companyName || `${selectedOrder.client.firstName || ''} ${selectedOrder.client.lastName || ''}`.trim() || 'N/A') : (selectedOrder.order?.clientName || 'N/A')}
                </span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Bank</span>
                <span style={styles.detailValue}>{selectedOrder.bank?.name || 'N/A'}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Account</span>
                <span style={styles.detailValue}>{selectedOrder.bankAccount?.accountNumber || 'N/A'}</span>
              </div>
              {selectedOrder.order.wealthAmbassador && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Wealth Ambassador</span>
                  <span style={styles.detailValue}>{selectedOrder.order.createdByName || selectedOrder.order.wealthAmbassador}</span>
                </div>
              )}
            </div>


            {selectedOrder.order.sentAt && (
              <div style={styles.detailSection}>
                <div style={styles.detailTitle}>Email Status</div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Sent At</span>
                  <span style={styles.detailValue}>{selectedOrder.order.sentAtFormatted}</span>
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Sent To</span>
                  <span style={styles.detailValue}>{selectedOrder.order.sentTo}</span>
                </div>
              </div>
            )}

            {/* Settlement Status */}
            {selectedOrder.order.settlementStatus && (
              <div style={styles.detailSection}>
                <div style={styles.detailTitle}>Settlement</div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Status</span>
                  <span style={{ ...styles.detailValue, fontWeight: '600', color: selectedOrder.order.settlementStatus === 'settled' ? 'var(--gain-color)' : selectedOrder.order.settlementStatus === 'forced' ? '#6366f1' : 'var(--warning-color)' }}>
                    {selectedOrder.order.settlementStatus === 'settled' ? 'Settled' : selectedOrder.order.settlementStatus === 'forced' ? 'Forced' : 'Pending'}
                  </span>
                </div>
                {selectedOrder.order.settlementConfirmedAt && (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Confirmed</span>
                    <span style={styles.detailValue}>{new Date(selectedOrder.order.settlementConfirmedAt).toLocaleString()}</span>
                  </div>
                )}
                {selectedOrder.order.settlementForcedReason && (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Reason</span>
                    <span style={styles.detailValue}>{selectedOrder.order.settlementForcedReason}</span>
                  </div>
                )}
              </div>
            )}
            {selectedOrder.order.canForceSettle && (
              <div style={{ marginTop: '-8px', marginBottom: '24px' }}>
                <button
                  onClick={() => setForceSettleOrder({ _id: selectedOrder.order._id, orderReference: selectedOrder.order.orderReference, securityName: selectedOrder.order.securityName })}
                  style={{ padding: '8px 16px', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '6px', color: '#6366f1', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                >
                  Force Settle
                </button>
              </div>
            )}

            {/* Audit Trail — desktop-only */}
            {!isMobile && (
            <div style={styles.detailSection}>
              <div style={styles.detailTitle}>Audit Trail</div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Placed By</span>
                <span style={styles.detailValue}>{selectedOrder.order.createdByName || 'Unknown'}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Placed At</span>
                <span style={styles.detailValue}>{selectedOrder.order.createdAtFull}</span>
              </div>
              {selectedOrder.order.validatedByName && (
                <>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Validated By</span>
                    <span style={styles.detailValue}>{selectedOrder.order.validatedByName}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Validated At</span>
                    <span style={styles.detailValue}>{selectedOrder.order.validatedAtFormatted}</span>
                  </div>
                </>
              )}
              {selectedOrder.order.executedPriceHistoryFormatted && selectedOrder.order.executedPriceHistoryFormatted.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>
                    Execution Price Updates
                  </div>
                  {/* Scrolls itself rather than widening the sheet, as the sibling
                      Limit Modification History table already does. */}
                  <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}>Date</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}>Previous</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}>New</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}>By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.order.executedPriceHistoryFormatted.map((entry, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '6px 8px', fontSize: '11px' }}>{entry.changedAtFormatted}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px' }}>{entry.previousPriceFormatted || '—'}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px', fontWeight: '600', color: 'var(--text-primary)' }}>{entry.newPriceFormatted || '—'}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px' }}>{entry.changedByName || 'Unknown'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Rejection Info */}
            {selectedOrder.order.rejectedByName && (
              <div style={styles.detailSection}>
                <div style={{ ...styles.detailTitle, color: 'var(--loss-color)' }}>Rejection</div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Rejected By</span>
                  <span style={styles.detailValue}>{selectedOrder.order.rejectedByName}</span>
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Rejected At</span>
                  <span style={styles.detailValue}>{selectedOrder.order.rejectedAtFormatted}</span>
                </div>
                {selectedOrder.order.rejectionReason && (
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Reason</span>
                    <span style={styles.detailValue}>{selectedOrder.order.rejectionReason}</span>
                  </div>
                )}
              </div>
            )}

            {/* Limit History */}
            {selectedOrder.order.limitHistoryFormatted && selectedOrder.order.limitHistoryFormatted.length > 0 && (
              <div style={styles.detailSection}>
                <div style={styles.detailTitle}>Limit Modification History</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}>Date</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}>Prev Type</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}>Prev Price</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}>By</th>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', fontSize: '11px' }}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.order.limitHistoryFormatted.map((entry, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '6px 8px', fontSize: '11px' }}>{entry.changedAtFormatted}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px' }}>{entry.priceTypeLabel}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px' }}>{entry.price != null ? OrderFormatters.formatWithCurrency(entry.price, selectedOrder.order.currency) : 'N/A'}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px' }}>{entry.changedByName || 'Unknown'}</td>
                          <td style={{ padding: '6px 8px', fontSize: '11px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.reason || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* PMS Booking Section */}
            {(() => {
              const booking = bookingResults[selectedOrder.order._id];
              if (!booking || booking.bookingStatus === 'none') {
                if (selectedOrder.order.status !== ORDER_STATUSES.CANCELLED) {
                  return (
                    <div style={styles.detailSection}>
                      <div style={styles.detailTitle}>PMS Booking</div>
                      <div style={{ padding: '12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
                        No matching operation found in PMS
                      </div>
                    </div>
                  );
                }
                return null;
              }
              const op = booking.matchedOperation;
              const color = OrderFormatters.getBookingStatusColor(booking.bookingStatus);
              const label = OrderFormatters.getBookingStatusLabel(booking.bookingStatus);
              return (
                <div style={styles.detailSection}>
                  <div style={styles.detailTitle}>PMS Booking</div>
                  <div style={{ marginBottom: '10px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '4px 12px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: '600',
                      background: `color-mix(in srgb, ${color} 13%, transparent)`,
                      color
                    }}>
                      {label} {booking.confidence === 'exact_match' ? '(exact match)' : booking.confidence === 'close_match' ? '(close match)' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    {booking.reason}
                  </div>
                  {op && (
                    <>
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>Operation Date</span>
                        <span style={styles.detailValue}>{op.operationDate ? new Date(op.operationDate).toLocaleDateString('en-GB') : 'N/A'}</span>
                      </div>
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>Quantity</span>
                        <span style={styles.detailValue}>{op.quantity ? Math.abs(op.quantity).toLocaleString('en-US') : 'N/A'}</span>
                      </div>
                      {op.price != null && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Price</span>
                          <span style={styles.detailValue}>{Number(op.price).toFixed(4)}</span>
                        </div>
                      )}
                      {op.grossAmount != null && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Gross Amount</span>
                          <span style={styles.detailValue}>{op.grossAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {op.operationCode && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Bank Reference</span>
                          <span style={{ ...styles.detailValue, fontFamily: 'monospace', fontSize: '12px' }}>{op.operationCode}</span>
                        </div>
                      )}
                      {op.instrumentName && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Instrument</span>
                          <span style={styles.detailValue}>{op.instrumentName}</span>
                        </div>
                      )}
                      {op.remark && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Remark</span>
                          <span style={{ ...styles.detailValue, fontSize: '12px', maxWidth: '300px', textAlign: 'right' }}>{op.remark}</span>
                        </div>
                      )}
                    </>
                  )}
                  {selectedOrder.order.status !== ORDER_STATUSES.EXECUTED && (
                    <div style={{ marginTop: '12px' }}>
                      <button
                        style={{
                          padding: '6px 14px',
                          fontSize: '12px',
                          fontWeight: '500',
                          border: '1px solid var(--gain-color)',
                          borderRadius: '6px',
                          background: 'rgba(16, 185, 129, 0.1)',
                          color: 'var(--gain-color)',
                          cursor: 'pointer'
                        }}
                        onClick={async () => {
                          setDetailModalOpen(false);
                          setExecutedQuantity(Math.abs(op?.quantity || selectedOrder.order.quantity)?.toString() || '');
                          if (op?.price) setExecutedPrice(op.price.toString());
                          if (op?.operationDate) setExecutionDate(new Date(op.operationDate).toISOString().split('T')[0]);
                          setExecuteModalOpen(true);
                        }}
                      >
                        Mark as Executed from PMS Match
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Traces Section — a terminal order (rejected / cancelled) never proceeds,
                so we don't ask for any evidence: an incomplete trace set is the normal
                end state (the trade is typically re-entered on a fresh order). We still
                surface traces captured before it died (read-only), but hide the section
                entirely when there are none. */}
            {(() => {
            // Traces show on every device. This section used to be desktop-only
            // because it is built around drag and drop — but what a phone mostly
            // needs is to SEE the evidence on file, download it, and attach from
            // Outlook, all of which work fine on touch. Only the drop zone is
            // meaningless there, so it is worded as a tap instead.
            const isTerminal = isTerminalOrderStatus(selectedOrder.order.status);
            const existingTraces = selectedOrder.order.emailTraces || [];
            if (isTerminal && existingTraces.length === 0) return null;
            return (
            <div style={styles.detailSection}>
              <div style={styles.detailTitle}>Traces</div>
              {/* Side by side on a desktop, one per row on a phone: three
                  200px-minimum tiles on a 390px screen would each be a column
                  of broken words. */}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row' }}>
                {Object.values(EMAIL_TRACE_TYPES)
                  .filter(traceType => {
                    const isStructuredProduct = selectedOrder.order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT;
                    // Sell orders never require a termsheet.
                    const needsTermsheet = isStructuredProduct && selectedOrder.order.orderType === 'buy';
                    // Legacy split tiles — replaced by the unified TERMSHEET tile.
                    if (traceType === EMAIL_TRACE_TYPES.TERMSHEET_SENT) return false;
                    if (traceType === EMAIL_TRACE_TYPES.TERMSHEET_SIGNED) return false;
                    // Terminal orders: only show tiles for traces already captured — never
                    // render an empty dropzone prompting for evidence on a dead order.
                    if (isTerminal) return existingTraces.some(t => t.traceType === traceType);
                    // Termsheet tiles only apply to buy structured products.
                    if (TERMSHEET_TRACE_TYPES.has(traceType)) return needsTermsheet;
                    if (traceType === EMAIL_TRACE_TYPES.ORDER_TO_ISSUER) return isStructuredProduct;
                    return true;
                  })
                  .map(traceType => {
                  const traces = selectedOrder.order.emailTraces || [];
                  // The "Signed Termsheet" tile is unified with the TS status indicator:
                  // it shows the signed evidence uploaded via the status chip
                  // (termsheet_signed) or a legacy 'termsheet' upload, and uploading
                  // here advances the TS status to Signed.
                  const isTermsheetTile = traceType === EMAIL_TRACE_TYPES.TERMSHEET;
                  const trace = isTermsheetTile
                    ? (traces.find(t => t.traceType === EMAIL_TRACE_TYPES.TERMSHEET_SIGNED)
                      || traces.find(t => t.traceType === EMAIL_TRACE_TYPES.TERMSHEET))
                    : traces.find(t => t.traceType === traceType);
                  const isUploading = uploadingTrace === traceType;
                  const isPhoneMode = !isTermsheetTile && !!tracePhoneForms[traceType];

                  return (
                    <div
                      key={traceType}
                      style={{
                        flex: isMobile ? '0 0 auto' : '1 1 0',
                        minWidth: isMobile ? 0 : '200px',
                        border: trace ? '2px solid var(--gain-color)' : '2px dashed var(--border-color)',
                        borderRadius: '8px',
                        padding: '12px',
                        textAlign: 'center',
                        background: trace ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-primary)',
                        position: 'relative',
                        transition: 'all 0.2s',
                        opacity: isUploading ? 0.6 : 1
                      }}
                      onDragOver={(e) => {
                        if (isPhoneMode) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.currentTarget.style.borderColor = '#0ea5e9';
                        e.currentTarget.style.background = 'rgba(14, 165, 233, 0.08)';
                      }}
                      onDragLeave={(e) => {
                        if (isPhoneMode) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.currentTarget.style.borderColor = trace ? 'var(--gain-color)' : 'var(--border-color)';
                        e.currentTarget.style.background = trace ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-primary)';
                      }}
                      onDrop={(e) => {
                        if (isPhoneMode) { e.preventDefault(); return; }
                        if (isTermsheetTile) {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.style.borderColor = trace ? 'var(--gain-color)' : 'var(--border-color)';
                          e.currentTarget.style.background = trace ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-primary)';
                          const file = (e.dataTransfer.files && e.dataTransfer.files[0])
                            || [...(e.dataTransfer.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).find(Boolean);
                          if (file) handleSignedTermsheetUpload(file, selectedOrder.order._id);
                          return;
                        }
                        handleDropTrace(e, traceType, selectedOrder.order._id);
                      }}
                    >
                      <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: isTermsheetTile ? '2px' : '8px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                        {EMAIL_TRACE_LABELS[traceType]}
                      </div>
                      {isTermsheetTile && (
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                          Evidence of client signature — linked to the TS status
                        </div>
                      )}

                      {isUploading ? (
                        <div style={{ fontSize: '12px', color: '#0ea5e9' }}>Saving...</div>
                      ) : trace ? (
                        trace.traceMode === 'phone' ? (
                          /* Phone trace completed */
                          <div>
                            <div style={{ fontSize: '18px', marginBottom: '4px', color: 'var(--gain-color)' }}>&#9742; &#10003;</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-primary)', marginBottom: '2px' }}>
                              {trace.phoneCaller} &rarr; {trace.phoneCallee}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                              {new Date(trace.phoneCallTime).toLocaleString()}
                            </div>
                            {trace.phoneNotes && (
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', fontStyle: 'italic' }}>
                                {trace.phoneNotes}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                              <button
                                style={{ padding: isMobile ? '8px 14px' : '3px 8px', fontSize: isMobile ? '13px' : '10px', border: '1px solid var(--loss-color)', borderRadius: '4px', background: 'transparent', color: 'var(--loss-color)', cursor: 'pointer' }}
                                onClick={(e) => { e.stopPropagation(); handleDeleteTrace(selectedOrder.order._id, trace._id); }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* File trace completed */
                          <div>
                            <div style={{ fontSize: '18px', marginBottom: '4px', color: 'var(--gain-color)' }}>&#10003;</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-primary)', wordBreak: 'break-all', marginBottom: '6px' }}>
                              {trace.fileName}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                              {new Date(trace.uploadedAt).toLocaleDateString()}
                            </div>
                            {isTermsheetTile && (
                              <div style={{ fontSize: '10px', fontWeight: '600', color: selectedOrder.order.termsheetColor || '#6b7280', marginBottom: '8px' }}>
                                TS status: {selectedOrder.order.termsheetLabel || 'None'}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                              <button
                                style={{ padding: isMobile ? '8px 14px' : '3px 8px', fontSize: isMobile ? '13px' : '10px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                                onClick={(e) => { e.stopPropagation(); handleDownloadTrace(selectedOrder.order._id, trace._id, trace.fileName); }}
                              >
                                Download
                              </button>
                              <button
                                style={{ padding: isMobile ? '8px 14px' : '3px 8px', fontSize: isMobile ? '13px' : '10px', border: '1px solid var(--loss-color)', borderRadius: '4px', background: 'transparent', color: 'var(--loss-color)', cursor: 'pointer' }}
                                onClick={(e) => { e.stopPropagation(); handleDeleteTrace(selectedOrder.order._id, trace._id); }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        )
                      ) : (
                        /* Empty state with file/phone toggle (signed termsheet is file-only) */
                        <div>
                          {!isTermsheetTile && (
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '8px' }}>
                            <button
                              onClick={() => setTracePhoneForms(prev => { const n = {...prev}; delete n[traceType]; return n; })}
                              style={{
                                padding: '2px 10px', fontSize: '10px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                background: !isPhoneMode ? '#0ea5e9' : 'var(--bg-secondary)',
                                color: !isPhoneMode ? '#fff' : 'var(--text-secondary)'
                              }}
                            >File</button>
                            <button
                              onClick={() => {
                                const now = new Date();
                                const pad = (n) => String(n).padStart(2, '0');
                                const defaultTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                                setTracePhoneForms(prev => ({
                                  ...prev, [traceType]: prev[traceType] || { callTime: defaultTime, caller: '', callee: '', notes: '' }
                                }));
                              }}
                              style={{
                                padding: '2px 10px', fontSize: '10px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                background: isPhoneMode ? '#0ea5e9' : 'var(--bg-secondary)',
                                color: isPhoneMode ? '#fff' : 'var(--text-secondary)'
                              }}
                            >Phone</button>
                          </div>
                          )}

                          {isPhoneMode ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
                              <div>
                                <label style={{ display: 'block', fontSize: '9px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px' }}>Call Time</label>
                                <input type="datetime-local" value={tracePhoneForms[traceType]?.callTime || ''}
                                  onChange={e => { const val = e.target.value; setTracePhoneForms(prev => ({...prev, [traceType]: {...prev[traceType], callTime: val}})); }}
                                  style={{ width: '100%', padding: '4px 6px', fontSize: '11px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '9px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px' }}>Caller</label>
                                <input placeholder="Who called" value={tracePhoneForms[traceType]?.caller || ''}
                                  onChange={e => { const val = e.target.value; setTracePhoneForms(prev => ({...prev, [traceType]: {...prev[traceType], caller: val}})); }}
                                  style={{ width: '100%', padding: '4px 6px', fontSize: '11px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '9px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px' }}>Callee</label>
                                <input placeholder="Who was called" value={tracePhoneForms[traceType]?.callee || ''}
                                  onChange={e => { const val = e.target.value; setTracePhoneForms(prev => ({...prev, [traceType]: {...prev[traceType], callee: val}})); }}
                                  style={{ width: '100%', padding: '4px 6px', fontSize: '11px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '9px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px' }}>Notes</label>
                                <input placeholder="Optional notes" value={tracePhoneForms[traceType]?.notes || ''}
                                  onChange={e => { const val = e.target.value; setTracePhoneForms(prev => ({...prev, [traceType]: {...prev[traceType], notes: val}})); }}
                                  style={{ width: '100%', padding: '4px 6px', fontSize: '11px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
                              </div>
                              <button
                                onClick={() => handleSavePhoneTrace(traceType, selectedOrder.order._id)}
                                style={{ marginTop: '4px', padding: '5px', fontSize: '11px', fontWeight: '600', background: 'var(--gain-color)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                              >Save</button>
                            </div>
                          ) : (
                            <div>
                              <div style={{ fontSize: '22px', marginBottom: '4px', opacity: 0.3 }}>&#128233;</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                                {isMobile
                                  ? (isTermsheetTile ? 'Attach the signed termsheet — sets TS status to Signed' : 'Nothing on file yet')
                                  : (isTermsheetTile ? 'Drop the signed termsheet here — sets TS status to Signed' : 'Drop file here')}
                              </div>
                              <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                <label style={{
                                  padding: isMobile ? '9px 18px' : '4px 14px', fontSize: isMobile ? '13px' : '11px', fontWeight: '500',
                                  border: '1px solid #0ea5e9', borderRadius: '4px',
                                  background: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9',
                                  cursor: 'pointer', display: 'inline-block'
                                }}>
                                  Browse
                                  <input
                                    type="file"
                                    accept={isTermsheetTile ? TERMSHEET_EVIDENCE_TYPES.join(',') : ".msg,.eml,.pdf,.jpg,.jpeg,.png,.gif,.html"}
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                      if (e.target.files && e.target.files.length > 0) {
                                        if (isTermsheetTile) {
                                          handleSignedTermsheetUpload(e.target.files[0], selectedOrder.order._id);
                                        } else {
                                          handleTraceFile(e.target.files[0], traceType, selectedOrder.order._id);
                                        }
                                        e.target.value = '';
                                      }
                                    }}
                                  />
                                </label>
                                {graphConnection.connected && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // Termsheet evidence goes through its own
                                      // status-advancing method, which takes a File —
                                      // so the picker runs in file mode there and in
                                      // attach-to-order mode for the mail traces.
                                      if (isTermsheetTile) {
                                        setFilePicker({ kind: 'signedTermsheet', orderId: selectedOrder.order._id });
                                      } else {
                                        setMailPicker({ orderId: selectedOrder.order._id, traceType });
                                      }
                                    }}
                                    style={{
                                      padding: isMobile ? '9px 18px' : '4px 14px', fontSize: isMobile ? '13px' : '11px', fontWeight: '500',
                                      border: '1px solid var(--border-color)', borderRadius: '4px',
                                      background: 'transparent', color: 'var(--text-secondary)',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    From Outlook
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Only the mailbox that sent the order can see its thread —
                  conversationId is mailbox-scoped. */}
              {graphConnected && selectedOrder?.order?.graphSend?.conversationId && (
                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={checkingReplies}
                    onClick={() => handleCheckReplies(selectedOrder.order)}
                    style={{
                      padding: '5px 14px', fontSize: '11px', fontWeight: 500,
                      border: '1px solid var(--border-color)', borderRadius: '4px',
                      background: 'transparent', color: 'var(--text-secondary)',
                      cursor: checkingReplies ? 'wait' : 'pointer'
                    }}
                  >
                    {checkingReplies ? 'Checking…' : 'Check for bank reply'}
                  </button>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Searches the thread this order was sent in.
                  </span>
                </div>
              )}
              {traceError && (
                <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--loss-color)', fontSize: '12px' }}>
                  {traceError}
                </div>
              )}
            </div>
            );
            })()}
          </div>
        )}
      </Modal>

      {/* Cancel Modal */}
      <Modal
        isOpen={cancelModalOpen}
        onClose={() => {
          setCancelModalOpen(false);
          setCancellationReason('');
          setActionError(null);
        }}
        title="Cancel Order"
        size="small"
        footer={
          <>
            <ActionButton
              variant="secondary"
              onClick={() => setCancelModalOpen(false)}
              disabled={isActioning}
            >
              Back
            </ActionButton>
            <ActionButton
              variant="danger"
              onClick={handleCancel}
              loading={isActioning}
            >
              Confirm Cancel
            </ActionButton>
          </>
        }
      >
        <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
          Are you sure you want to cancel this order? This action cannot be undone.
        </p>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
            Cancellation Reason (Optional)
          </label>
          <textarea
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              fontSize: '13px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              minHeight: '80px',
              resize: 'vertical'
            }}
            value={cancellationReason}
            onChange={(e) => setCancellationReason(e.target.value)}
            placeholder="Enter reason for cancellation..."
          />
        </div>
        {actionError && (
          <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--loss-color)', fontSize: '13px' }}>
            {actionError}
          </div>
        )}
      </Modal>

      {/* Execute Modal */}
      <Modal
        isOpen={executeModalOpen}
        onClose={() => {
          setExecuteModalOpen(false);
          setExecutedQuantity('');
          setExecutedPrice('');
          setActionError(null);
        }}
        title="Mark as Executed"
        size="small"
        footer={
          <>
            <ActionButton
              variant="secondary"
              onClick={() => setExecuteModalOpen(false)}
              disabled={isActioning}
            >
              Back
            </ActionButton>
            <ActionButton
              variant="success"
              onClick={handleMarkExecuted}
              loading={isActioning}
            >
              Confirm Execution
            </ActionButton>
          </>
        }
      >
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
            Executed Quantity *
          </label>
          <FormattedNumberInput
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              fontSize: '13px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)'
            }}
            value={executedQuantity}
            onChange={(e) => setExecutedQuantity(e.target.value)}
            maxDecimals={0}
          />
        </div>
        {selectedOrder?.order?.assetType !== ASSET_TYPES.TERM_DEPOSIT && (
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
            Executed Price (Optional)
          </label>
          <FormattedNumberInput
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              fontSize: '13px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)'
            }}
            value={executedPrice}
            onChange={(e) => setExecutedPrice(e.target.value)}
            maxDecimals={2}
          />
        </div>
        )}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
            Execution Date
          </label>
          <input
            type="date"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              fontSize: '13px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)'
            }}
            value={executionDate}
            onChange={(e) => setExecutionDate(e.target.value)}
          />
        </div>
        {actionError && (
          <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--loss-color)', fontSize: '13px' }}>
            {actionError}
          </div>
        )}
      </Modal>

      {/* Edit Order Modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setActionError(null);
        }}
        title="Edit Order"
        size="small"
        footer={
          <>
            <ActionButton
              variant="secondary"
              onClick={() => setEditModalOpen(false)}
              disabled={isActioning}
            >
              Cancel
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={handleEdit}
              loading={isActioning}
            >
              Save Changes
            </ActionButton>
          </>
        }
      >
        {selectedOrder && (
          <>
            <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Order Reference</div>
              <div style={{ fontWeight: '600', fontFamily: 'monospace' }}>{selectedOrder.order.orderReference}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{selectedOrder.order.securityName}</div>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
                Quantity *
              </label>
              <FormattedNumberInput
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)'
                }}
                value={editQuantity}
                onChange={(e) => setEditQuantity(e.target.value)}
                maxDecimals={0}
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
                Price Type
              </label>
              <select
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)'
                }}
                value={editPriceType}
                onChange={(e) => setEditPriceType(e.target.value)}
              >
                <option value="market">Market</option>
                <option value="limit">Limit</option>
                <option value="stop_loss">Stop Loss</option>
                <option value="take_profit">Take Profit</option>
              </select>
            </div>
            {editPriceType !== 'market' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
                  Limit Price
                </label>
                <FormattedNumberInput
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '13px',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)'
                  }}
                  value={editLimitPrice}
                  onChange={(e) => setEditLimitPrice(e.target.value)}
                  maxDecimals={2}
                />
              </div>
            )}
            {actionError && (
              <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--loss-color)', fontSize: '13px' }}>
                {actionError}
              </div>
            )}
          </>
        )}
      </Modal>

      {/* Delete Order Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setActionError(null);
        }}
        title="Delete Order"
        size="small"
        footer={
          <>
            <ActionButton
              variant="secondary"
              onClick={() => setDeleteModalOpen(false)}
              disabled={isActioning}
            >
              Cancel
            </ActionButton>
            <ActionButton
              variant="danger"
              onClick={handleDelete}
              loading={isActioning}
            >
              Delete Order
            </ActionButton>
          </>
        }
      >
        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🗑️</div>
          <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
            Are you sure you want to delete this order?
          </p>
          {selectedOrder && (
            <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '6px', marginBottom: '16px' }}>
              <div style={{ fontWeight: '600', fontFamily: 'monospace' }}>{selectedOrder.order.orderReference}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {OrderFormatters.orderDirectionLabel(selectedOrder.order)} - {selectedOrder.order.securityName}
              </div>
            </div>
          )}
          <p style={{ fontSize: '12px', color: 'var(--danger-color)' }}>
            This action cannot be undone.
          </p>
        </div>
        {actionError && (
          <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--loss-color)', fontSize: '13px' }}>
            {actionError}
          </div>
        )}
      </Modal>

      {/* Reject Order Modal — undoes a validated order before it's transmitted to the bank.
          Distinct from Delete: this is audited (orders.rejectValidation) and requires a reason,
          so the mistake is on record and the creator has to re-enter a fresh order rather than
          having this one silently patched or wiped. */}
      <Modal
        isOpen={rejectModalOpen}
        onClose={() => {
          setRejectModalOpen(false);
          setActionError(null);
        }}
        title="Reject Order"
        size="small"
        footer={
          <>
            <ActionButton
              variant="secondary"
              onClick={() => setRejectModalOpen(false)}
              disabled={isActioning}
            >
              Cancel
            </ActionButton>
            <ActionButton
              variant="danger"
              onClick={handleReject}
              loading={isActioning}
              disabled={!rejectReason.trim()}
            >
              Reject Order
            </ActionButton>
          </>
        }
      >
        <div style={{ padding: '0.5rem 0' }}>
          <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
            This order was already validated. Rejecting it now moves it to Rejected — it will not
            be sent to the bank. The creator will need to re-enter a new order; a reason is
            required for the audit trail.
          </p>
          {selectedOrder && (
            <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '6px', marginBottom: '16px' }}>
              <div style={{ fontWeight: '600', fontFamily: 'monospace' }}>{selectedOrder.order.orderReference}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {OrderFormatters.orderDirectionLabel(selectedOrder.order)} - {selectedOrder.order.securityName}
              </div>
            </div>
          )}
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Enter rejection reason..."
            rows={3}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              resize: 'vertical'
            }}
          />
        </div>
        {actionError && (
          <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--loss-color)', fontSize: '13px' }}>
            {actionError}
          </div>
        )}
      </Modal>

      {/* Modify Order Modal */}
      <Modal
        isOpen={limitModalOpen}
        onClose={() => {
          setLimitModalOpen(false);
          setActionError(null);
        }}
        title="Request Modification"
        size="medium"
        footer={
          <>
            <ActionButton
              variant="secondary"
              onClick={() => setLimitModalOpen(false)}
              disabled={isActioning}
            >
              Cancel
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={handleUpdateLimit}
              loading={isActioning}
              disabled={!limitInstructionFile}
            >
              {isActioning ? 'Submitting...' : 'Submit Modification'}
            </ActionButton>
          </>
        }
      >
        {selectedOrder && (
          <>
            <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Order Reference</div>
              <div style={{ fontWeight: '600', fontFamily: 'monospace' }}>{selectedOrder.order.orderReference}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{selectedOrder.order.securityName}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Current: {OrderFormatters.getPriceTypeLabel(selectedOrder.order.priceType)}
                {selectedOrder.order.limitPrice != null ? ` — ${OrderFormatters.formatWithCurrency(selectedOrder.order.limitPrice, selectedOrder.order.currency)}` : ''}
                {selectedOrder.order.stopLossPrice != null ? ` | SL: ${selectedOrder.order.stopLossPrice}` : ''}
                {selectedOrder.order.takeProfitPrice != null ? ` | TP: ${selectedOrder.order.takeProfitPrice}` : ''}
              </div>
            </div>

            <div style={{ fontSize: '11px', color: '#f97316', background: 'rgba(249, 115, 22, 0.08)', padding: '8px 12px', borderRadius: '6px', marginBottom: '16px', border: '1px solid rgba(249, 115, 22, 0.2)' }}>
              Modifications require four-eyes validation. Attach the client instruction email.
            </div>

            {/* Price Type */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
                Price Type
              </label>
              <select
                style={{
                  width: '100%', padding: '10px 12px',
                  border: '1px solid var(--border-color)', borderRadius: '6px',
                  fontSize: '13px', background: 'var(--bg-primary)', color: 'var(--text-primary)'
                }}
                value={limitPriceType}
                onChange={(e) => setLimitPriceType(e.target.value)}
              >
                <option value="market">Market</option>
                <option value="limit">Limit</option>
              </select>
            </div>

            {/* Limit / SL / TP fields */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
              {limitPriceType !== 'market' && (
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
                    Limit Price
                  </label>
                  <FormattedNumberInput
                    style={{
                      width: '100%', padding: '10px 12px',
                      border: '1px solid var(--border-color)', borderRadius: '6px',
                      fontSize: '13px', background: 'var(--bg-primary)', color: 'var(--text-primary)'
                    }}
                    value={limitNewPrice}
                    onChange={(e) => setLimitNewPrice(e.target.value)}
                    maxDecimals={6}
                  />
                </div>
              )}
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: 'var(--loss-color)' }}>
                  Stop Loss
                </label>
                <FormattedNumberInput
                  style={{
                    width: '100%', padding: '10px 12px',
                    border: '1px solid var(--border-color)', borderRadius: '6px',
                    fontSize: '13px', background: 'var(--bg-primary)', color: 'var(--text-primary)'
                  }}
                  value={limitNewStopLoss}
                  onChange={(e) => setLimitNewStopLoss(e.target.value)}
                  placeholder="Optional"
                  maxDecimals={6}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500', color: 'var(--gain-color)' }}>
                  Take Profit
                </label>
                <FormattedNumberInput
                  style={{
                    width: '100%', padding: '10px 12px',
                    border: '1px solid var(--border-color)', borderRadius: '6px',
                    fontSize: '13px', background: 'var(--bg-primary)', color: 'var(--text-primary)'
                  }}
                  value={limitNewTakeProfit}
                  onChange={(e) => setLimitNewTakeProfit(e.target.value)}
                  placeholder="Optional"
                  maxDecimals={6}
                />
              </div>
            </div>

            {/* Reason */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
                Reason for change
              </label>
              <input
                type="text"
                style={{
                  width: '100%', padding: '10px 12px',
                  border: '1px solid var(--border-color)', borderRadius: '6px',
                  fontSize: '13px', background: 'var(--bg-primary)', color: 'var(--text-primary)'
                }}
                value={limitReason}
                onChange={(e) => setLimitReason(e.target.value)}
                placeholder="e.g. Client requested via email"
              />
            </div>

            {/* Client Instruction Email (required) */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
                Client Instruction Email *
              </label>
              <div
                style={{
                  border: limitInstructionFile ? '2px solid var(--gain-color)' : '2px dashed var(--border-color)',
                  borderRadius: '8px', padding: '14px', textAlign: 'center',
                  cursor: 'pointer',
                  background: limitInstructionFile ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-primary)',
                  transition: 'border-color 0.15s'
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (file) {
                    if (file.size > EMAIL_TRACE_MAX_SIZE) { setActionError('File exceeds 15MB'); return; }
                    setLimitInstructionFile(file); setActionError(null);
                  }
                }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = EMAIL_TRACE_ACCEPTED_TYPES.join(',');
                  input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                      if (file.size > EMAIL_TRACE_MAX_SIZE) { setActionError('File exceeds 15MB'); return; }
                      setLimitInstructionFile(file); setActionError(null);
                    }
                  };
                  input.click();
                }}
              >
                {limitInstructionFile ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px' }}>📎</span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--gain-color)' }}>{limitInstructionFile.name}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      ({(limitInstructionFile.size / 1024).toFixed(0)} KB)
                    </span>
                    <button
                      style={{ background: 'none', border: 'none', color: 'var(--loss-color)', cursor: 'pointer', fontSize: '14px', padding: '2px 6px' }}
                      onClick={(e) => { e.stopPropagation(); setLimitInstructionFile(null); }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                      Click or drag & drop client instruction
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      .pdf, .jpg, .png, .eml, .msg, .html
                    </div>
                    {graphConnected && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setFilePicker('limitInstruction'); }}
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
            </div>

            {actionError && (
              <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--loss-color)', fontSize: '13px' }}>
                {actionError}
              </div>
            )}
          </>
        )}
      </Modal>

      {/* Force Settle Modal */}
      <Modal
        isOpen={!!forceSettleOrder}
        onClose={() => { setForceSettleOrder(null); setForceSettleReason(''); }}
        title={`Force Settle ${forceSettleOrder?.orderReference || ''}`}
        size="small"
        footer={
          <>
            <ActionButton variant="secondary" onClick={() => { setForceSettleOrder(null); setForceSettleReason(''); }}>
              Cancel
            </ActionButton>
            <ActionButton variant="primary" onClick={handleForceSettle}>
              Confirm Settlement
            </ActionButton>
          </>
        }
      >
        <p style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
          Manually mark <strong>{forceSettleOrder?.securityName || 'this order'}</strong> as settled. Use this for edge cases where the automatic settlement check cannot confirm.
        </p>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
            Reason (Optional)
          </label>
          <textarea
            style={{
              width: '100%', padding: '10px 12px',
              border: '1px solid var(--border-color)', borderRadius: '6px',
              fontSize: '13px', background: 'var(--bg-primary)', color: 'var(--text-primary)',
              minHeight: '80px', resize: 'vertical', boxSizing: 'border-box'
            }}
            value={forceSettleReason}
            onChange={(e) => setForceSettleReason(e.target.value)}
            placeholder="e.g. Confirmed with bank via phone, settlement visible on next statement..."
          />
        </div>
      </Modal>

      {/* Termsheet Evidence Modal */}
      <Modal
        isOpen={!!termsheetEvidenceModal}
        onClose={() => {
          if (termsheetEvidenceUploading) return;
          setTermsheetEvidenceModal(null);
          setTermsheetEvidenceFile(null);
          setTermsheetEvidenceError(null);
        }}
        title={termsheetEvidenceModal
          ? `Mark termsheet as ${termsheetEvidenceModal.targetStatus} — upload evidence`
          : 'Termsheet evidence'}
        size="small"
        footer={
          <>
            <ActionButton
              variant="secondary"
              onClick={() => {
                setTermsheetEvidenceModal(null);
                setTermsheetEvidenceFile(null);
                setTermsheetEvidenceError(null);
              }}
              disabled={termsheetEvidenceUploading}
            >
              Cancel
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={submitTermsheetEvidence}
              disabled={!termsheetEvidenceFile || termsheetEvidenceUploading}
            >
              {termsheetEvidenceUploading ? 'Uploading…' : 'Confirm & advance'}
            </ActionButton>
          </>
        }
      >
        <p style={{ marginBottom: '12px', color: 'var(--text-secondary)', fontSize: '13px' }}>
          {termsheetEvidenceModal?.targetStatus === TERMSHEET_STATUSES.SIGNED
            ? 'Attach the signed termsheet (PDF) returned by the client.'
            : 'Attach the email sent to the client (.eml or .msg) or a PDF of the termsheet that was sent.'}
        </p>
        {termsheetEvidenceModal?.existingTraces?.length > 0 && (() => {
          const targetTypes = termsheetEvidenceModal.targetStatus === TERMSHEET_STATUSES.SIGNED
            ? [EMAIL_TRACE_TYPES.TERMSHEET_SIGNED, EMAIL_TRACE_TYPES.TERMSHEET]
            : [EMAIL_TRACE_TYPES.TERMSHEET_SENT];
          const willReplace = termsheetEvidenceModal.existingTraces.some(t => targetTypes.includes(t.traceType));
          return (
            <div style={{ marginBottom: '12px', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '10px', background: 'var(--bg-secondary)' }}>
              <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>
                Termsheet files already on this order
              </div>
              {termsheetEvidenceModal.existingTraces.map(t => (
                <div key={t._id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '3px 0' }}>
                  <span style={{ color: 'var(--text-muted)', minWidth: '110px', flexShrink: 0 }}>
                    {EMAIL_TRACE_LABELS[t.traceType] || t.traceType}
                  </span>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      handleDownloadTrace(termsheetEvidenceModal.orderId, t._id, t.fileName);
                    }}
                    style={{ color: '#0ea5e9', textDecoration: 'underline', flex: 1, wordBreak: 'break-all' }}
                  >
                    {t.fileName}
                  </a>
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px', flexShrink: 0 }}>
                    {t.uploadedAt ? new Date(t.uploadedAt).toLocaleDateString() : ''}
                  </span>
                  <button
                    onClick={() => handleDeleteEvidenceTrace(t._id)}
                    disabled={termsheetEvidenceUploading}
                    style={{ padding: '2px 8px', fontSize: '10px', border: '1px solid var(--loss-color)', borderRadius: '4px', background: 'transparent', color: 'var(--loss-color)', cursor: 'pointer', flexShrink: 0 }}
                  >
                    Delete
                  </button>
                </div>
              ))}
              {willReplace && (
                <div style={{ fontSize: '11px', color: 'var(--warning-color)', marginTop: '6px' }}>
                  Uploading a new file will automatically replace the existing one for this step.
                </div>
              )}
            </div>
          );
        })()}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (termsheetEvidenceUploading) return;
            e.currentTarget.style.borderColor = '#0ea5e9';
            e.currentTarget.style.background = 'rgba(14, 165, 233, 0.05)';
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.style.borderColor = 'var(--border-color)';
            e.currentTarget.style.background = 'var(--bg-primary)';
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.style.borderColor = 'var(--border-color)';
            e.currentTarget.style.background = 'var(--bg-primary)';
            if (termsheetEvidenceUploading) return;
            setTermsheetEvidenceError(null);

            // Standard file drop
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              setTermsheetEvidenceFile(e.dataTransfer.files[0]);
              return;
            }

            // Outlook-style drag (dataTransfer.items)
            if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
              for (const item of e.dataTransfer.items) {
                if (item.kind === 'file') {
                  const file = item.getAsFile();
                  if (file) {
                    setTermsheetEvidenceFile(file);
                    return;
                  }
                }
              }
            }

            setTermsheetEvidenceError(
              'No file received. Drag the email from Outlook to your Desktop first (creates a .msg file), then drag the .msg file here.'
            );
          }}
          style={{
            border: '2px dashed var(--border-color)',
            borderRadius: '6px',
            padding: '16px',
            textAlign: 'center',
            background: 'var(--bg-primary)',
            transition: 'border-color 0.15s, background 0.15s',
            marginBottom: '8px',
            cursor: termsheetEvidenceUploading ? 'not-allowed' : 'pointer',
            opacity: termsheetEvidenceUploading ? 0.6 : 1
          }}
        >
          <p style={{ margin: '0 0 8px 0', color: 'var(--text-muted)', fontSize: '12px' }}>
            Drag &amp; drop a file here, or
          </p>
          <input
            type="file"
            accept={TERMSHEET_EVIDENCE_TYPES.join(',')}
            onChange={(e) => {
              const file = e.target.files && e.target.files[0];
              setTermsheetEvidenceFile(file || null);
              setTermsheetEvidenceError(null);
            }}
            disabled={termsheetEvidenceUploading}
            style={{ width: '100%', fontSize: '13px' }}
          />
          <p style={{ margin: '8px 0 0 0', color: 'var(--text-muted)', fontSize: '11px' }}>
            Accepted: {TERMSHEET_EVIDENCE_TYPES.join(', ')} — max 15MB
          </p>
        </div>
        {termsheetEvidenceFile && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Selected: <strong>{termsheetEvidenceFile.name}</strong> ({Math.ceil(termsheetEvidenceFile.size / 1024)} KB)
          </div>
        )}
        {termsheetEvidenceError && (
          <div style={{ fontSize: '12px', color: 'var(--loss-color)', marginTop: '8px' }}>
            {termsheetEvidenceError}
          </div>
        )}
      </Modal>

      {/* New Order Modal */}
      <OrderModal
        key={newOrderModalKey}
        isOpen={newOrderModalOpen}
        onClose={() => setNewOrderModalOpen(false)}
        mode="buy"
        clients={clients}
        onOrderCreated={handleOrderCreated}
        user={user}
      />

      {/* CSS Animation for loading spinners */}
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default OrderBook;
