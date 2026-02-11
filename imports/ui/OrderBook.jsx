import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import Modal from './components/common/Modal.jsx';
import ActionButton from './components/common/ActionButton.jsx';
import OrderModal from './components/OrderModal.jsx';
import { useTheme } from './ThemeContext.jsx';
import { OrdersCollection, ORDER_STATUSES, EMAIL_TRACE_TYPES, EMAIL_TRACE_LABELS, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, ASSET_TYPES, TERMSHEET_STATUSES, OrderFormatters, OrderHelpers } from '/imports/api/orders';
import { BanksCollection } from '/imports/api/banks';
import { UsersCollection } from '/imports/api/users';

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
const OrderBook = ({ user }) => {
  const { theme } = useTheme();
  const getSessionId = () => localStorage.getItem('sessionId');

  // State
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalOrders, setTotalOrders] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [bankFilter, setBankFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Modals
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [executeModalOpen, setExecuteModalOpen] = useState(false);
  const [newOrderModalOpen, setNewOrderModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');

  // Edit form state
  const [editQuantity, setEditQuantity] = useState('');
  const [editPriceType, setEditPriceType] = useState('market');
  const [editLimitPrice, setEditLimitPrice] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Execution form
  const [executedQuantity, setExecutedQuantity] = useState('');
  const [executedPrice, setExecutedPrice] = useState('');
  const [executionDate, setExecutionDate] = useState(new Date().toISOString().split('T')[0]);

  // Action states
  const [isActioning, setIsActioning] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Loading states for row actions
  const [loadingPDF, setLoadingPDF] = useState(null); // orderId currently generating PDF
  const [loadingEmail, setLoadingEmail] = useState(null); // orderId currently sending email

  // Email trace states
  const [uploadingTrace, setUploadingTrace] = useState(null); // traceType currently uploading
  const [traceError, setTraceError] = useState(null);

  // Clients for new order modal
  const [clients, setClients] = useState([]);

  // Subscribe to banks for filter dropdown
  const { banks } = useTracker(() => {
    const handle = Meteor.subscribe('banks');
    return {
      banks: BanksCollection.find({ isActive: true }).fetch()
    };
  }, []);

  // Load orders
  useEffect(() => {
    loadOrders();
  }, [statusFilter, bankFilter, searchQuery, dateFrom, dateTo, currentPage]);

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

  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const sessionId = getSessionId();
      const filters = {};

      if (statusFilter !== 'all') {
        filters.status = statusFilter;
      }
      if (bankFilter !== 'all') {
        filters.bankId = bankFilter;
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

      const result = await Meteor.callAsync('orders.list', {
        filters,
        pagination: {
          limit: pageSize,
          skip: (currentPage - 1) * pageSize,
          sortField: 'createdAt',
          sortOrder: -1
        },
        sessionId
      });

      setOrders(result.orders || []);
      setTotalOrders(result.total || 0);
    } catch (err) {
      console.error('Error loading orders:', err);
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewDetails = async (order) => {
    try {
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('orders.get', { orderId: order._id, sessionId });
      setSelectedOrder(result);
      setTraceError(null);
      setDetailModalOpen(true);
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

  const handleSendEmail = async (order) => {
    setLoadingEmail(order._id);
    try {
      const sessionId = getSessionId();

      // Send email with PDF attachment via SendPulse
      const result = await Meteor.callAsync('orders.sendEmailWithPDF', { orderId: order._id, sessionId });

      if (result.success) {
        alert(`Order sent successfully to ${result.sentTo}`);
        loadOrders();
      }
    } catch (err) {
      console.error('Error sending email:', err);
      alert('Failed to send email: ' + (err.reason || err.message));
    } finally {
      setLoadingEmail(null);
    }
  };

  const handleOrderCreated = (result) => {
    setNewOrderModalOpen(false);
    loadOrders();
  };

  // Termsheet status handler - cycles: none -> sent -> signed -> none
  const handleTermsheetToggle = async (e, order) => {
    e.stopPropagation();
    if (order.assetType !== ASSET_TYPES.STRUCTURED_PRODUCT) return;

    const cycle = [TERMSHEET_STATUSES.NONE, TERMSHEET_STATUSES.SENT, TERMSHEET_STATUSES.SIGNED];
    const currentIdx = cycle.indexOf(order.termsheetStatus || TERMSHEET_STATUSES.NONE);
    const nextStatus = cycle[(currentIdx + 1) % cycle.length];

    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.updateTermsheetStatus', {
        orderId: order._id,
        termsheetStatus: nextStatus,
        sessionId
      });
      loadOrders();
    } catch (err) {
      console.error('Error updating termsheet status:', err);
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

      // Refresh order details
      const result = await Meteor.callAsync('orders.get', { orderId, sessionId });
      setSelectedOrder(result);
    } catch (err) {
      console.error('Error uploading trace:', err);
      setTraceError(err.reason || err.message);
    } finally {
      setUploadingTrace(null);
    }
  };

  const handleDeleteTrace = async (orderId, traceId) => {
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.deleteEmailTrace', { orderId, traceId, sessionId });

      // Refresh order details
      const result = await Meteor.callAsync('orders.get', { orderId, sessionId });
      setSelectedOrder(result);
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

      if (editPriceType === 'limit' && editLimitPrice) {
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

  // Styles
  const styles = {
    container: {
      padding: '1.5rem'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '1.5rem',
      flexWrap: 'wrap',
      gap: '1rem'
    },
    title: {
      fontSize: '1.5rem',
      fontWeight: '600',
      color: 'var(--text-primary)',
      margin: 0
    },
    filters: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '12px',
      marginBottom: '1.5rem',
      alignItems: 'center'
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
    input: {
      padding: '8px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: '13px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none',
      minWidth: '150px'
    },
    select: {
      padding: '8px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: '13px',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      outline: 'none',
      cursor: 'pointer',
      minWidth: '120px'
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
      letterSpacing: '0.5px'
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
      color: type === 'buy' ? '#10b981' : '#ef4444'
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
      marginTop: '1rem',
      padding: '0.5rem 0'
    },
    pageInfo: {
      fontSize: '13px',
      color: 'var(--text-secondary)'
    },
    pageButtons: {
      display: 'flex',
      gap: '8px'
    },
    emptyState: {
      textAlign: 'center',
      padding: '3rem',
      color: 'var(--text-secondary)'
    },
    detailSection: {
      marginBottom: '20px'
    },
    detailTitle: {
      fontSize: '14px',
      fontWeight: '600',
      color: 'var(--text-primary)',
      marginBottom: '12px',
      borderBottom: '1px solid var(--border-color)',
      paddingBottom: '8px'
    },
    detailRow: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid var(--border-color)'
    },
    detailLabel: {
      color: 'var(--text-secondary)',
      fontSize: '13px'
    },
    detailValue: {
      fontWeight: '500',
      color: 'var(--text-primary)',
      fontSize: '13px'
    }
  };

  const totalPages = Math.ceil(totalOrders / pageSize);

  return (
    <div style={styles.container}>
      <LiquidGlassCard>
        <div style={{ padding: '1.5rem' }}>
          {/* Header */}
          <div style={styles.header}>
            <h1 style={styles.title}>Order Book</h1>
            <ActionButton
              variant="primary"
              onClick={() => setNewOrderModalOpen(true)}
            >
              + New Order
            </ActionButton>
          </div>

          {/* Filters */}
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

            <div style={{ marginLeft: 'auto' }}>
              <ActionButton
                variant="secondary"
                size="small"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                  setBankFilter('all');
                  setDateFrom('');
                  setDateTo('');
                }}
              >
                Clear Filters
              </ActionButton>
            </div>
          </div>

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
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Reference</th>
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Ind/Bloc</th>
                      <th style={styles.th}>WA</th>
                      <th style={styles.th}>Client</th>
                      <th style={styles.th}>Bank</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Security</th>
                      <th style={styles.th}>Asset</th>
                      <th style={styles.th}>Ccy</th>
                      <th style={styles.th}>Qty</th>
                      <th style={styles.th}>Exec Price</th>
                      <th style={styles.th}>Broker</th>
                      <th style={styles.th}>Underlyings</th>
                      <th style={styles.th}>Settl. Ccy</th>
                      <th style={styles.th}>Notes</th>
                      <th style={styles.th} title="Termsheet">TS</th>
                      <th style={styles.th}>Traces</th>
                      <th style={styles.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(order => (
                      <tr
                        key={order._id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleViewDetails(order)}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
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
                        <td style={styles.td}>{order.createdAtFormatted}</td>
                        <td style={styles.td}>
                          <span style={styles.statusBadge(order.status)}>
                            {order.statusLabel}
                          </span>
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
                          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                            {order.wealthAmbassadorFormatted || ''}
                          </span>
                        </td>
                        <td style={styles.td}>{order.clientName}</td>
                        <td style={styles.td}>{order.bankName}</td>
                        <td style={styles.td}>
                          <span style={styles.orderTypeBadge(order.orderType)}>
                            {order.orderType}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <div style={{ fontWeight: '500' }}>{order.securityName}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            {order.isin}
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
                        <td style={styles.td}>{order.quantityFormatted}</td>
                        <td style={styles.td}>
                          {order.executedPriceFormatted ? (
                            <span style={{ fontSize: '12px', fontWeight: '500' }}>{order.executedPriceFormatted}</span>
                          ) : (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {order.broker || ''}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {order.underlyings || ''}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontSize: '12px' }}>{order.settlementCurrency || ''}</span>
                        </td>
                        <td style={styles.td}>
                          {order.notes ? (
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }} title={order.notes}>
                              {order.notes.length > 20 ? order.notes.substring(0, 20) + '...' : order.notes}
                            </span>
                          ) : null}
                        </td>
                        <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                          {order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT ? (
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
                              onClick={(e) => handleTermsheetToggle(e, order)}
                              title={order.termsheetUpdatedByFormatted
                                ? `${order.termsheetUpdatedByFormatted} — ${order.termsheetUpdatedAtFormatted}\nClick to cycle: None → Sent → Signed`
                                : 'Click to cycle: None → Sent → Signed'}
                            >
                              {order.termsheetLabel || 'None'}
                            </span>
                          ) : (
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          {(() => {
                            const traceCount = (order.emailTraces || []).length;
                            const maxTraces = order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT ? 4 : 3;
                            const color = traceCount === maxTraces ? '#10b981' : traceCount > 0 ? '#f59e0b' : 'var(--text-muted)';
                            return (
                              <span style={{
                                fontSize: '11px',
                                fontWeight: '600',
                                color,
                                padding: '2px 8px',
                                borderRadius: '10px',
                                background: `${color}15`
                              }}>
                                {traceCount}/{maxTraces}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              style={{
                                ...styles.actionButton,
                                opacity: loadingPDF === order._id ? 0.7 : 1,
                                cursor: loadingPDF === order._id ? 'wait' : 'pointer',
                                minWidth: '42px'
                              }}
                              onClick={() => handleGeneratePDF(order)}
                              title="Download PDF"
                              disabled={loadingPDF === order._id}
                            >
                              {loadingPDF === order._id ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
                                </span>
                              ) : 'PDF'}
                            </button>
                            {order.status !== ORDER_STATUSES.CANCELLED && order.status !== ORDER_STATUSES.EXECUTED && (
                              <>
                                <button
                                  style={{
                                    ...styles.actionButton,
                                    opacity: loadingEmail === order._id ? 0.7 : 1,
                                    cursor: loadingEmail === order._id ? 'wait' : 'pointer',
                                    minWidth: '50px'
                                  }}
                                  onClick={() => handleSendEmail(order)}
                                  title="Send to bank"
                                  disabled={loadingEmail === order._id}
                                >
                                  {loadingEmail === order._id ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                      <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
                                    </span>
                                  ) : 'Email'}
                                </button>
                                {/* Edit button - only for pending orders */}
                                {order.status === ORDER_STATUSES.PENDING && (
                                  <button
                                    style={{ ...styles.actionButton, color: '#0ea5e9' }}
                                    onClick={() => openEditModal(order)}
                                    title="Edit order"
                                  >
                                    Edit
                                  </button>
                                )}
                                {/* Delete button - only for pending orders */}
                                {order.status === ORDER_STATUSES.PENDING && (
                                  <button
                                    style={{ ...styles.actionButton, color: '#ef4444' }}
                                    onClick={() => {
                                      setSelectedOrder({ order });
                                      setDeleteModalOpen(true);
                                    }}
                                    title="Delete order"
                                  >
                                    Delete
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={styles.pagination}>
                <span style={styles.pageInfo}>
                  Showing {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, totalOrders)} of {totalOrders}
                </span>
                <div style={styles.pageButtons}>
                  <ActionButton
                    variant="secondary"
                    size="small"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  >
                    Previous
                  </ActionButton>
                  <ActionButton
                    variant="secondary"
                    size="small"
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
            {selectedOrder.order.status !== ORDER_STATUSES.CANCELLED &&
             selectedOrder.order.status !== ORDER_STATUSES.EXECUTED && (
              <>
                <ActionButton
                  variant="danger"
                  onClick={() => {
                    setDetailModalOpen(false);
                    setCancelModalOpen(true);
                  }}
                >
                  Cancel Order
                </ActionButton>
                <ActionButton
                  variant="success"
                  onClick={() => {
                    setDetailModalOpen(false);
                    setExecutedQuantity(selectedOrder.order.quantity?.toString() || '');
                    setExecuteModalOpen(true);
                  }}
                >
                  Mark Executed
                </ActionButton>
              </>
            )}
            <ActionButton variant="secondary" onClick={() => setDetailModalOpen(false)}>
              Close
            </ActionButton>
          </>
        )}
      >
        {selectedOrder && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <span style={styles.orderTypeBadge(selectedOrder.order.orderType)}>
                {selectedOrder.order.orderType?.toUpperCase()}
              </span>
              <span style={{ ...styles.statusBadge(selectedOrder.order.status), marginLeft: '8px' }}>
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
              {selectedOrder.order.underlyings && (
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Underlyings</span>
                  <span style={styles.detailValue}>{selectedOrder.order.underlyings}</span>
                </div>
              )}
              {selectedOrder.order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT && (
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
                      onClick={() => {
                        const cycle = [TERMSHEET_STATUSES.NONE, TERMSHEET_STATUSES.SENT, TERMSHEET_STATUSES.SIGNED];
                        const currentIdx = cycle.indexOf(selectedOrder.order.termsheetStatus || TERMSHEET_STATUSES.NONE);
                        const nextStatus = cycle[(currentIdx + 1) % cycle.length];
                        const sessionId = getSessionId();
                        Meteor.callAsync('orders.updateTermsheetStatus', {
                          orderId: selectedOrder.order._id,
                          termsheetStatus: nextStatus,
                          sessionId
                        }).then(() => {
                          handleViewDetails(selectedOrder.order);
                          loadOrders();
                        });
                      }}
                      title={selectedOrder.order.termsheetUpdatedByFormatted
                        ? `${selectedOrder.order.termsheetUpdatedByFormatted} — ${selectedOrder.order.termsheetUpdatedAtFormatted}\nClick to cycle: None → Sent → Signed`
                        : 'Click to cycle: None → Sent → Signed'}
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
            </div>

            <div style={styles.detailSection}>
              <div style={styles.detailTitle}>Order Details</div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Quantity</span>
                <span style={styles.detailValue}>{selectedOrder.order.quantityFormatted}</span>
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
                  {selectedOrder.client ? `${selectedOrder.client.firstName} ${selectedOrder.client.lastName}` : 'N/A'}
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
                  <span style={styles.detailValue}>{selectedOrder.order.wealthAmbassador}</span>
                </div>
              )}
            </div>

            {selectedOrder.order.notes && (
              <div style={styles.detailSection}>
                <div style={styles.detailTitle}>Notes</div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                  {selectedOrder.order.notes}
                </p>
              </div>
            )}

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

            {/* Email Traces Section */}
            <div style={styles.detailSection}>
              <div style={styles.detailTitle}>Email Traces</div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {Object.values(EMAIL_TRACE_TYPES)
                  .filter(traceType => traceType !== EMAIL_TRACE_TYPES.ORDER_TO_ISSUER || selectedOrder.order.assetType === 'structured_product')
                  .map(traceType => {
                  const traces = selectedOrder.order.emailTraces || [];
                  const trace = traces.find(t => t.traceType === traceType);
                  const isUploading = uploadingTrace === traceType;

                  return (
                    <div
                      key={traceType}
                      style={{
                        flex: '1 1 0',
                        minWidth: '160px',
                        border: trace ? '2px solid #10b981' : '2px dashed var(--border-color)',
                        borderRadius: '8px',
                        padding: '12px',
                        textAlign: 'center',
                        background: trace ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-primary)',
                        position: 'relative',
                        transition: 'all 0.2s',
                        opacity: isUploading ? 0.6 : 1
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
                        e.currentTarget.style.borderColor = trace ? '#10b981' : 'var(--border-color)';
                        e.currentTarget.style.background = trace ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-primary)';
                      }}
                      onDrop={(e) => handleDropTrace(e, traceType, selectedOrder.order._id)}
                    >
                      <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                        {EMAIL_TRACE_LABELS[traceType]}
                      </div>

                      {isUploading ? (
                        <div style={{ fontSize: '12px', color: '#0ea5e9' }}>Uploading...</div>
                      ) : trace ? (
                        <div>
                          <div style={{ fontSize: '18px', marginBottom: '4px', color: '#10b981' }}>&#10003;</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-primary)', wordBreak: 'break-all', marginBottom: '6px' }}>
                            {trace.fileName}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                            {new Date(trace.uploadedAt).toLocaleDateString()}
                          </div>
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                            <button
                              style={{
                                padding: '3px 8px',
                                fontSize: '10px',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                background: 'var(--bg-secondary)',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer'
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadTrace(selectedOrder.order._id, trace._id, trace.fileName);
                              }}
                            >
                              Download
                            </button>
                            <button
                              style={{
                                padding: '3px 8px',
                                fontSize: '10px',
                                border: '1px solid #ef4444',
                                borderRadius: '4px',
                                background: 'transparent',
                                color: '#ef4444',
                                cursor: 'pointer'
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTrace(selectedOrder.order._id, trace._id);
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: '22px', marginBottom: '4px', opacity: 0.3 }}>&#128233;</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                            Drop .msg file here
                          </div>
                          <label style={{
                            padding: '4px 14px',
                            fontSize: '11px',
                            fontWeight: '500',
                            border: '1px solid #0ea5e9',
                            borderRadius: '4px',
                            background: 'rgba(14, 165, 233, 0.1)',
                            color: '#0ea5e9',
                            cursor: 'pointer',
                            display: 'inline-block'
                          }}>
                            Browse
                            <input
                              type="file"
                              accept=".msg,.eml,.pdf,.jpg,.jpeg,.png,.gif,.html"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                if (e.target.files && e.target.files.length > 0) {
                                  handleTraceFile(e.target.files[0], traceType, selectedOrder.order._id);
                                  e.target.value = '';
                                }
                              }}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {traceError && (
                <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: '#ef4444', fontSize: '12px' }}>
                  {traceError}
                </div>
              )}
            </div>
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
          <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: '#ef4444', fontSize: '13px' }}>
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
          <input
            type="number"
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
            min="0"
          />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
            Executed Price (Optional)
          </label>
          <input
            type="number"
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
            min="0"
            step="0.01"
          />
        </div>
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
          <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: '#ef4444', fontSize: '13px' }}>
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
              <input
                type="number"
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
                min="0"
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
              </select>
            </div>
            {editPriceType === 'limit' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
                  Limit Price
                </label>
                <input
                  type="number"
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
                  min="0"
                  step="0.01"
                />
              </div>
            )}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '500' }}>
                Notes
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
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Add notes..."
              />
            </div>
            {actionError && (
              <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: '#ef4444', fontSize: '13px' }}>
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
                {selectedOrder.order.orderType?.toUpperCase()} - {selectedOrder.order.securityName}
              </div>
            </div>
          )}
          <p style={{ fontSize: '12px', color: 'var(--danger-color)' }}>
            This action cannot be undone.
          </p>
        </div>
        {actionError && (
          <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: '#ef4444', fontSize: '13px' }}>
            {actionError}
          </div>
        )}
      </Modal>

      {/* New Order Modal */}
      <OrderModal
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
