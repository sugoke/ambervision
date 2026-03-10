import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { ORDER_STATUSES, ASSET_TYPES, EMAIL_TRACE_TYPES, EMAIL_TRACE_LABELS, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, OrderFormatters } from '/imports/api/orders';

/**
 * ValidationBlotter - Displays orders pending four-eyes validation
 *
 * Shows a compact table of PENDING_VALIDATION orders with approve/reject actions.
 * Auto-hides when no orders need validation or user lacks canValidateOrders.
 */
const ValidationBlotter = ({ user, onOrderValidated, refreshKey }) => {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rejectModalOrder, setRejectModalOrder] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isActioning, setIsActioning] = useState(null); // orderId being actioned
  const [reviewOrder, setReviewOrder] = useState(null); // order being reviewed before validation
  const [uploadingTrace, setUploadingTrace] = useState(false);
  const [parsedEmails, setParsedEmails] = useState({}); // traceId -> parsed email data

  const getSessionId = () => localStorage.getItem('sessionId');

  // Staff roles that can see the order book
  const isStaff = ['superadmin', 'admin', 'rm', 'compliance', 'staff'].includes(user?.role);

  const loadPendingValidation = async () => {
    try {
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('orders.listPendingValidation', { sessionId });
      setOrders(result?.orders || []);
    } catch (err) {
      console.error('Error loading pending validation orders:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isStaff) {
      loadPendingValidation();
      // Refresh every 30 seconds
      const interval = setInterval(loadPendingValidation, 30000);
      return () => clearInterval(interval);
    } else {
      setIsLoading(false);
    }
  }, [isStaff, refreshKey]);

  // Auto-parse .eml traces when review order is opened
  useEffect(() => {
    if (!reviewOrder) { setParsedEmails({}); return; }
    const emlTraces = (reviewOrder.emailTraces || []).filter(t =>
      (t.fileName || '').toLowerCase().endsWith('.eml')
    );
    emlTraces.forEach(async (trace) => {
      if (parsedEmails[trace._id]) return; // already parsed
      try {
        const sessionId = getSessionId();
        const result = await Meteor.callAsync('orders.parseEmailTrace', {
          orderId: reviewOrder._id, traceId: trace._id, sessionId
        });
        if (result?.success) {
          setParsedEmails(prev => ({ ...prev, [trace._id]: result }));
        }
      } catch (err) {
        console.error('Error parsing .eml:', err);
        setParsedEmails(prev => ({ ...prev, [trace._id]: { error: err.reason || 'Failed to parse' } }));
      }
    });

    // Also parse modification instruction file if it's an .eml
    const modFile = reviewOrder.pendingModification?.instructionFile;
    if (modFile && (modFile.fileName || '').toLowerCase().endsWith('.eml')) {
      const modKey = 'mod_' + reviewOrder._id;
      if (!parsedEmails[modKey]) {
        (async () => {
          try {
            const sessionId = getSessionId();
            const result = await Meteor.callAsync('orders.parseEmailTrace', {
              orderId: reviewOrder._id, traceId: modKey, sessionId
            });
            if (result?.success) {
              setParsedEmails(prev => ({ ...prev, [modKey]: result }));
            }
          } catch (err) {
            console.error('Error parsing modification .eml:', err);
            setParsedEmails(prev => ({ ...prev, [modKey]: { error: err.reason || 'Failed to parse' } }));
          }
        })();
      }
    }
  }, [reviewOrder?._id, reviewOrder?.emailTraces?.length, reviewOrder?.pendingModification?.instructionFile?.fileName]);

  const handleValidate = async (order) => {
    setIsActioning(order._id);
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.validate', { orderId: order._id, sessionId });
      await loadPendingValidation();
      if (onOrderValidated) onOrderValidated();
    } catch (err) {
      alert(err.reason || err.message || 'Validation failed');
    } finally {
      setIsActioning(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModalOrder) return;
    setIsActioning(rejectModalOrder._id);
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.rejectValidation', {
        orderId: rejectModalOrder._id,
        reason: rejectionReason || null,
        sessionId
      });
      setRejectModalOrder(null);
      setRejectionReason('');
      await loadPendingValidation();
      if (onOrderValidated) onOrderValidated();
    } catch (err) {
      alert(err.reason || err.message || 'Rejection failed');
    } finally {
      setIsActioning(null);
    }
  };

  const handleValidateModification = async (order) => {
    setIsActioning(order._id);
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.validateModification', { orderId: order._id, sessionId });
      setReviewOrder(null);
      await loadPendingValidation();
      if (onOrderValidated) onOrderValidated();
    } catch (err) {
      alert(err.reason || err.message || 'Validation failed');
    } finally {
      setIsActioning(null);
    }
  };

  const handleRejectModification = async () => {
    if (!rejectModalOrder) return;
    setIsActioning(rejectModalOrder._id);
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.rejectModification', {
        orderId: rejectModalOrder._id,
        reason: rejectionReason || null,
        sessionId
      });
      setRejectModalOrder(null);
      setRejectionReason('');
      await loadPendingValidation();
      if (onOrderValidated) onOrderValidated();
    } catch (err) {
      alert(err.reason || err.message || 'Rejection failed');
    } finally {
      setIsActioning(null);
    }
  };

  // Don't render if not staff or no orders pending
  if (!isStaff || (!isLoading && orders.length === 0)) {
    return null;
  }

  const canValidate = user?.canValidateOrders === true || user?.role === 'compliance';

  const isOwnOrder = (order) => order.createdBy === user._id;

  return (
    <>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.headerIcon}>⚠️</span>
            <span style={styles.headerTitle}>Orders Pending Validation</span>
            <span style={styles.badge}>{orders.length}</span>
          </div>
          <span style={styles.headerSubtitle}>Four-eyes principle — a different person must validate each order</span>
        </div>

        {isLoading ? (
          <div style={styles.loading}>Loading...</div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Reference</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Created By</th>
                  <th style={styles.th}>Client</th>
                  <th style={styles.th}>Bank</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>ISIN</th>
                  <th style={styles.th}>Security</th>
                  <th style={styles.th}>Qty</th>
                  <th style={styles.th}>Price</th>
                  <th style={styles.th}>Ccy</th>
                  <th style={{ ...styles.th, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => (
                  <tr key={order._id} style={styles.row}>
                    <td style={styles.td}>
                      <span style={{ fontFamily: 'monospace', fontWeight: '600', fontSize: '12px' }}>
                        {order.orderReference}
                      </span>
                      {order.status === 'pending_modification' && (
                        <span style={{ marginLeft: '6px', fontSize: '9px', fontWeight: '700', color: '#a855f7', background: 'rgba(168,85,247,0.1)', padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>
                          Modif.
                        </span>
                      )}
                      {order.emailTraces?.some(t => t.traceType === 'client_order') && (
                        <span title="Client order email attached" style={{ marginLeft: '4px', fontSize: '12px', cursor: 'help' }}>📎</span>
                      )}
                    </td>
                    <td style={styles.td}>{order.createdAtFormatted}</td>
                    <td style={styles.td}>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: isOwnOrder(order) ? '600' : '400',
                        color: isOwnOrder(order) ? '#f97316' : 'var(--text-primary)'
                      }}>
                        {order.createdByName}
                        {isOwnOrder(order) && <span style={{ fontSize: '10px', marginLeft: '4px' }}>(you)</span>}
                      </span>
                    </td>
                    <td style={styles.td}>{order.clientName}</td>
                    <td style={styles.td}>{order.bankName}</td>
                    <td style={styles.td}>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        color: order.orderType === 'buy' ? '#10b981' : '#ef4444'
                      }}>
                        {order.orderType}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                        {order.assetType === ASSET_TYPES.FX ? (order.fxPairFormatted || 'FX') :
                         order.assetType === ASSET_TYPES.TERM_DEPOSIT ? (order.depositTenorLabel || 'TD') :
                         order.isin}
                      </span>
                    </td>
                    <td style={{ ...styles.td, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {order.securityName}
                    </td>
                    <td style={styles.td}>{order.quantityFormatted}</td>
                    <td style={styles.td}>
                      {order.priceType !== 'market' && order.limitPrice
                        ? <span style={{ fontSize: '11px' }} title={order.priceTypeLabel}>{order.limitPriceFormatted}</span>
                        : <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{order.priceTypeLabel || 'Market'}</span>
                      }
                    </td>
                    <td style={styles.td}>{order.currency}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      {canValidate ? (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            style={{
                              ...styles.reviewBtn,
                              opacity: isOwnOrder(order) || isActioning === order._id ? 0.4 : 1,
                              cursor: isOwnOrder(order) || isActioning === order._id ? 'not-allowed' : 'pointer'
                            }}
                            onClick={() => setReviewOrder(order)}
                            disabled={isOwnOrder(order) || isActioning === order._id}
                            title={isOwnOrder(order) ? 'Cannot validate your own order (four-eyes)' : 'Review & validate order'}
                          >
                            {isActioning === order._id ? '...' : 'Review'}
                          </button>
                          <button
                            style={{
                              ...styles.rejectBtn,
                              opacity: isActioning === order._id ? 0.4 : 1,
                              cursor: isActioning === order._id ? 'not-allowed' : 'pointer'
                            }}
                            onClick={() => { setRejectModalOrder(order); setRejectionReason(''); }}
                            disabled={isActioning === order._id}
                            title="Reject order"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review & Validate Modal */}
      {reviewOrder && (
        <div style={styles.modalOverlay} onClick={() => setReviewOrder(null)}>
          <div style={{ ...styles.modalContent, maxWidth: '720px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h3 style={{ ...styles.modalTitle, marginBottom: '4px' }}>Review Order</h3>
                <span style={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--text-muted)' }}>{reviewOrder.orderReference}</span>
              </div>
              <span style={{
                fontSize: '12px', fontWeight: '700', textTransform: 'uppercase',
                color: reviewOrder.orderType === 'buy' ? '#10b981' : '#ef4444',
                padding: '4px 10px', borderRadius: '4px',
                background: reviewOrder.orderType === 'buy' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'
              }}>
                {reviewOrder.orderType}
              </span>
            </div>

            {/* Order Details Grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px',
              padding: '14px', borderRadius: '8px', background: 'var(--bg-secondary)',
              marginBottom: '14px', fontSize: '12px'
            }}>
              <div><span style={styles.reviewLabel}>Security</span><div style={styles.reviewValue}>{reviewOrder.securityName}</div></div>
              <div><span style={styles.reviewLabel}>ISIN</span><div style={{ ...styles.reviewValue, fontFamily: 'monospace' }}>
                {reviewOrder.assetType === ASSET_TYPES.FX ? (reviewOrder.fxPairFormatted || 'FX') :
                 reviewOrder.assetType === ASSET_TYPES.TERM_DEPOSIT ? (reviewOrder.depositTenorLabel || 'TD') :
                 reviewOrder.isin}
              </div></div>
              <div><span style={styles.reviewLabel}>Asset Type</span><div style={styles.reviewValue}>{reviewOrder.assetTypeLabel}</div></div>
              <div><span style={styles.reviewLabel}>Currency</span><div style={styles.reviewValue}>{reviewOrder.currency}</div></div>
              <div><span style={styles.reviewLabel}>Quantity</span><div style={{ ...styles.reviewValue, fontWeight: '700' }}>{reviewOrder.quantityFormatted}</div></div>
              <div><span style={styles.reviewLabel}>Price Type</span><div style={styles.reviewValue}>{reviewOrder.priceTypeLabel || 'Market'}</div></div>
              {reviewOrder.priceType !== 'market' && reviewOrder.limitPrice && (
                <div><span style={styles.reviewLabel}>Limit Price</span><div style={{ ...styles.reviewValue, fontWeight: '700', color: '#0ea5e9' }}>{reviewOrder.limitPriceFormatted}</div></div>
              )}
              {reviewOrder.stopLossPriceFormatted && (
                <div><span style={styles.reviewLabel}>Stop Loss</span><div style={{ ...styles.reviewValue, color: '#ef4444' }}>{reviewOrder.stopLossPriceFormatted}</div></div>
              )}
              {reviewOrder.takeProfitPriceFormatted && (
                <div><span style={styles.reviewLabel}>Take Profit</span><div style={{ ...styles.reviewValue, color: '#10b981' }}>{reviewOrder.takeProfitPriceFormatted}</div></div>
              )}
              {reviewOrder.estimatedValueFormatted && (
                <div><span style={styles.reviewLabel}>Est. Value</span><div style={styles.reviewValue}>{reviewOrder.estimatedValueFormatted}</div></div>
              )}
              <div><span style={styles.reviewLabel}>Client</span><div style={styles.reviewValue}>{reviewOrder.clientName}</div></div>
              <div><span style={styles.reviewLabel}>Bank</span><div style={styles.reviewValue}>{reviewOrder.bankName}</div></div>
              {reviewOrder.wealthAmbassador && (
                <div><span style={styles.reviewLabel}>Wealth Ambassador</span><div style={styles.reviewValue}>{reviewOrder.wealthAmbassador}</div></div>
              )}
              {reviewOrder.broker && (
                <div><span style={styles.reviewLabel}>Broker</span><div style={styles.reviewValue}>{reviewOrder.broker}</div></div>
              )}
              {reviewOrder.underlyings && (
                <div style={{ gridColumn: 'span 2' }}><span style={styles.reviewLabel}>Underlyings</span><div style={styles.reviewValue}>{reviewOrder.underlyings}</div></div>
              )}
              {/* FX-specific */}
              {reviewOrder.assetType === ASSET_TYPES.FX && reviewOrder.fxSubtypeLabel && (
                <div><span style={styles.reviewLabel}>FX Type</span><div style={styles.reviewValue}>{reviewOrder.fxSubtypeLabel}</div></div>
              )}
              {reviewOrder.fxRateFormatted && (
                <div><span style={styles.reviewLabel}>Indicative Rate</span><div style={styles.reviewValue}>{reviewOrder.fxRateFormatted}</div></div>
              )}
              {reviewOrder.fxValueDateFormatted && (
                <div><span style={styles.reviewLabel}>Value Date</span><div style={styles.reviewValue}>{reviewOrder.fxValueDateFormatted}</div></div>
              )}
              {reviewOrder.fxForwardDateFormatted && (
                <div><span style={styles.reviewLabel}>Forward Date</span><div style={styles.reviewValue}>{reviewOrder.fxForwardDateFormatted}</div></div>
              )}
              {/* Term Deposit-specific */}
              {reviewOrder.depositTenorLabel && (
                <div><span style={styles.reviewLabel}>Tenor</span><div style={styles.reviewValue}>{reviewOrder.depositTenorLabel}</div></div>
              )}
              {reviewOrder.depositMaturityDateFormatted && (
                <div><span style={styles.reviewLabel}>Maturity Date</span><div style={styles.reviewValue}>{reviewOrder.depositMaturityDateFormatted}</div></div>
              )}
              <div><span style={styles.reviewLabel}>Created By</span><div style={{
                ...styles.reviewValue,
                fontWeight: isOwnOrder(reviewOrder) ? '700' : '400',
                color: isOwnOrder(reviewOrder) ? '#f97316' : 'var(--text-primary)'
              }}>{reviewOrder.createdByName}{isOwnOrder(reviewOrder) && ' (you)'}</div></div>
              <div><span style={styles.reviewLabel}>Created At</span><div style={styles.reviewValue}>{reviewOrder.createdAtFull || reviewOrder.createdAtFormatted}</div></div>
            </div>

            {/* Notes */}
            {reviewOrder.notes && (
              <div style={{
                padding: '12px 14px', borderRadius: '8px', marginBottom: '14px',
                background: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.2)'
              }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>
                  Client Instructions / Notes
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                  {reviewOrder.notes}
                </div>
              </div>
            )}

            {/* Email Traces / Attachments with inline preview */}
            {(() => {
              const traces = reviewOrder.emailTraces || [];
              const hasClientOrder = traces.some(t => t.traceType === EMAIL_TRACE_TYPES.CLIENT_ORDER) ||
                (reviewOrder.status === 'pending_modification' && reviewOrder.pendingModification?.instructionFile);

              const getTraceUrl = (trace) => `/order_traces/${reviewOrder._id}/${trace.storedFileName}`;
              const isPreviewable = (trace) => {
                const ext = (trace.fileName || '').toLowerCase();
                return ext.endsWith('.pdf') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') ||
                       ext.endsWith('.png') || ext.endsWith('.gif') || ext.endsWith('.html');
              };

              const handleUploadClientOrder = (file) => {
                if (!file) return;
                const ext = '.' + file.name.split('.').pop().toLowerCase();
                if (!EMAIL_TRACE_ACCEPTED_TYPES.includes(ext)) {
                  alert(`File type ${ext} not accepted. Use: ${EMAIL_TRACE_ACCEPTED_TYPES.join(', ')}`);
                  return;
                }
                if (file.size > EMAIL_TRACE_MAX_SIZE) {
                  alert('File exceeds maximum size of 15MB');
                  return;
                }
                setUploadingTrace(true);
                const reader = new FileReader();
                reader.onload = async () => {
                  try {
                    const base64 = reader.result.split(',')[1];
                    const sessionId = localStorage.getItem('sessionId');
                    await Meteor.callAsync('orders.uploadEmailTrace', {
                      orderId: reviewOrder._id,
                      traceType: EMAIL_TRACE_TYPES.CLIENT_ORDER,
                      fileName: file.name,
                      base64Data: base64,
                      mimeType: file.type || 'application/octet-stream',
                      sessionId
                    });
                    // Reload orders to get updated traces
                    await loadPendingValidation();
                    // Update the reviewOrder with fresh data
                    const freshOrders = await Meteor.callAsync('orders.listPendingValidation', { sessionId });
                    const updated = (freshOrders?.orders || []).find(o => o._id === reviewOrder._id);
                    if (updated) setReviewOrder(updated);
                  } catch (err) {
                    alert(err.reason || err.message || 'Upload failed');
                  } finally {
                    setUploadingTrace(false);
                  }
                };
                reader.readAsDataURL(file);
              };

              return (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '8px' }}>
                    Client Order Email
                  </div>

                  {/* Existing traces — shown inline automatically */}
                  {traces.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: hasClientOrder ? 0 : '8px' }}>
                      {traces.map((trace) => {
                        const previewable = isPreviewable(trace);
                        const url = getTraceUrl(trace);
                        const isImage = /\.(jpg|jpeg|png|gif)$/i.test(trace.fileName || '');
                        const isEml = /\.eml$/i.test(trace.fileName || '');
                        const parsed = parsedEmails[trace._id];

                        return (
                          <div key={trace._id} style={{
                            borderRadius: '6px', background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)', overflow: 'hidden'
                          }}>
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: '8px',
                              padding: '8px 12px'
                            }}>
                              <span style={{ fontSize: '14px' }}>
                                {trace.traceType === EMAIL_TRACE_TYPES.CLIENT_ORDER ? '📋' : '📎'}
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                                  {EMAIL_TRACE_LABELS[trace.traceType] || trace.traceType}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {trace.fileName}
                                </div>
                              </div>
                            </div>

                            {/* Inline preview for images / PDF / HTML */}
                            {previewable && (
                              <div style={{ borderTop: '1px solid var(--border-color)', padding: '8px', background: 'var(--bg-primary)' }}>
                                {isImage ? (
                                  <img
                                    src={url}
                                    alt={trace.fileName}
                                    style={{ maxWidth: '100%', maxHeight: '500px', display: 'block', margin: '0 auto', borderRadius: '4px' }}
                                  />
                                ) : (
                                  <iframe
                                    src={url}
                                    title={trace.fileName}
                                    style={{ width: '100%', height: '500px', border: 'none', borderRadius: '4px', background: '#fff' }}
                                  />
                                )}
                              </div>
                            )}

                            {/* Inline preview for .eml (parsed server-side) */}
                            {isEml && (
                              <div style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
                                {!parsed ? (
                                  <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                                    Loading email...
                                  </div>
                                ) : parsed.error ? (
                                  <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#ef4444' }}>
                                    Could not parse email: {parsed.error}
                                  </div>
                                ) : (
                                  <div>
                                    {/* Email header */}
                                    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)', fontSize: '12px' }}>
                                      <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>From:</strong> <span style={{ color: 'var(--text-primary)' }}>{parsed.from}</span></div>
                                      <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>To:</strong> <span style={{ color: 'var(--text-primary)' }}>{parsed.to}</span></div>
                                      <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>Subject:</strong> <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{parsed.subject}</span></div>
                                      {parsed.date && (
                                        <div><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>Date:</strong> <span style={{ color: 'var(--text-primary)' }}>{new Date(parsed.date).toLocaleString()}</span></div>
                                      )}
                                      {parsed.hasAttachments && (
                                        <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '11px' }}>
                                          Attachments: {parsed.attachmentNames.join(', ')}
                                        </div>
                                      )}
                                    </div>
                                    {/* Email body */}
                                    {parsed.html ? (
                                      <iframe
                                        srcDoc={parsed.html}
                                        title="Email content"
                                        style={{ width: '100%', height: '400px', border: 'none', background: '#fff' }}
                                        sandbox="allow-same-origin"
                                      />
                                    ) : (
                                      <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.5', maxHeight: '400px', overflowY: 'auto' }}>
                                        {parsed.text}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* .msg files — download only */}
                            {!previewable && !isEml && (
                              <div style={{ borderTop: '1px solid var(--border-color)', padding: '12px', textAlign: 'center' }}>
                                <button
                                  style={{
                                    padding: '6px 16px', borderRadius: '4px', border: '1px solid var(--border-color)',
                                    background: 'transparent', color: 'var(--text-secondary)', fontSize: '12px',
                                    fontWeight: '600', cursor: 'pointer'
                                  }}
                                  onClick={() => {
                                    const a = document.createElement('a');
                                    a.href = url; a.download = trace.fileName; a.click();
                                  }}
                                >
                                  Download {trace.fileName}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Upload zone if no client order attached */}
                  {!hasClientOrder && (
                    <div
                      style={{
                        border: '2px dashed rgba(249, 115, 22, 0.4)',
                        borderRadius: '6px',
                        padding: '14px',
                        textAlign: 'center',
                        cursor: uploadingTrace ? 'wait' : 'pointer',
                        background: 'rgba(249, 115, 22, 0.05)',
                        transition: 'border-color 0.15s'
                      }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleUploadClientOrder(e.dataTransfer.files[0]);
                      }}
                      onClick={() => {
                        if (uploadingTrace) return;
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = EMAIL_TRACE_ACCEPTED_TYPES.join(',');
                        input.onchange = (e) => handleUploadClientOrder(e.target.files[0]);
                        input.click();
                      }}
                    >
                      {uploadingTrace ? (
                        <span style={{ fontSize: '12px', color: '#f97316' }}>Uploading...</span>
                      ) : (
                        <div>
                          <div style={{ fontSize: '12px', color: '#f97316', fontWeight: '600', marginBottom: '2px' }}>
                            No client order email attached
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            Click or drag & drop to attach (.pdf, .jpg, .png, .msg, .eml, .html)
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Modification History */}
            {reviewOrder.limitHistoryFormatted?.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '8px' }}>
                  Modification History
                </div>
                {reviewOrder.limitHistoryFormatted.map((entry, idx) => (
                  <div key={idx} style={{
                    fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px',
                    padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: '4px',
                    borderLeft: `3px solid ${entry.status === 'rejected' ? '#ef4444' : entry.validatedByName ? '#10b981' : 'var(--border-color)'}`
                  }}>
                    <div>
                      {entry.changedAtFormatted} — {entry.changedByName || 'Unknown'}
                      {entry.reason && <span style={{ color: 'var(--text-muted)' }}> — {entry.reason}</span>}
                    </div>
                    {entry.newPriceType && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {entry.priceTypeLabel}: {entry.price ?? '—'} → {entry.newPriceTypeLabel}: {entry.newPrice ?? '—'}
                        {entry.stopLossPrice !== undefined && ` | SL: ${entry.stopLossPrice ?? '—'} → ${entry.newStopLossPrice ?? '—'}`}
                        {entry.takeProfitPrice !== undefined && ` | TP: ${entry.takeProfitPrice ?? '—'} → ${entry.newTakeProfitPrice ?? '—'}`}
                      </div>
                    )}
                    {entry.validatedByName && (
                      <div style={{ fontSize: '11px', color: '#10b981', marginTop: '2px' }}>
                        Validated by {entry.validatedByName} on {entry.validatedAtFormatted}
                      </div>
                    )}
                    {entry.status === 'rejected' && (
                      <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '2px' }}>
                        Rejected by {entry.rejectedByName} on {entry.rejectedAtFormatted}
                        {entry.rejectionReason && ` — ${entry.rejectionReason}`}
                      </div>
                    )}
                    {entry.instructionFile && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        📎 {entry.instructionFile.fileName}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Pending Modification Details */}
            {reviewOrder.status === 'pending_modification' && reviewOrder.pendingModification && (() => {
              const mod = reviewOrder.pendingModification;
              const isModRequester = mod.requestedBy === user._id;
              const instrUrl = mod.instructionFile ? `/order_traces/${reviewOrder._id}/${mod.instructionFile.storedFileName}` : null;
              const instrPreviewable = mod.instructionFile && /\.(pdf|jpg|jpeg|png|gif|html)$/i.test(mod.instructionFile.fileName || '');
              const instrIsImage = mod.instructionFile && /\.(jpg|jpeg|png|gif)$/i.test(mod.instructionFile.fileName || '');
              const instrIsEml = mod.instructionFile && /\.eml$/i.test(mod.instructionFile.fileName || '');
              const modEmlKey = `mod_${reviewOrder._id}`;
              const parsedEml = instrIsEml ? parsedEmails[modEmlKey] : null;

              return (
                <div style={{ marginBottom: '14px', padding: '14px', borderRadius: '8px', border: '2px solid #a855f7', background: 'rgba(168, 85, 247, 0.05)' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#a855f7', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>
                    Proposed Modification
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Requested by <strong style={{ color: 'var(--text-primary)' }}>{mod.requestedByName}</strong> on {new Date(mod.requestedAt).toLocaleString()}
                    {mod.reason && <span> — {mod.reason}</span>}
                  </div>

                  {/* Changes table */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', fontSize: '12px', marginBottom: '10px' }}>
                    <div style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Field</div>
                    <div style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Current</div>
                    <div style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Proposed</div>

                    {mod.oldValues.priceType !== mod.newValues.priceType && (<>
                      <div>Price Type</div>
                      <div style={{ color: 'var(--text-secondary)' }}>{mod.oldValues.priceType}</div>
                      <div style={{ color: '#a855f7', fontWeight: '600' }}>{mod.newValues.priceType}</div>
                    </>)}

                    {mod.oldValues.limitPrice !== mod.newValues.limitPrice && (<>
                      <div>Limit Price</div>
                      <div style={{ color: 'var(--text-secondary)' }}>{mod.oldValues.limitPrice ?? '—'}</div>
                      <div style={{ color: '#a855f7', fontWeight: '600' }}>{mod.newValues.limitPrice ?? '—'}</div>
                    </>)}

                    {mod.oldValues.stopLossPrice !== mod.newValues.stopLossPrice && (<>
                      <div>Stop Loss</div>
                      <div style={{ color: '#ef4444' }}>{mod.oldValues.stopLossPrice ?? '—'}</div>
                      <div style={{ color: '#a855f7', fontWeight: '600' }}>{mod.newValues.stopLossPrice ?? '—'}</div>
                    </>)}

                    {mod.oldValues.takeProfitPrice !== mod.newValues.takeProfitPrice && (<>
                      <div>Take Profit</div>
                      <div style={{ color: '#10b981' }}>{mod.oldValues.takeProfitPrice ?? '—'}</div>
                      <div style={{ color: '#a855f7', fontWeight: '600' }}>{mod.newValues.takeProfitPrice ?? '—'}</div>
                    </>)}
                  </div>

                  {/* Client Instruction Preview */}
                  {instrUrl && (
                    <div style={{ borderRadius: '6px', border: '1px solid var(--border-color)', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
                      <div style={{ padding: '6px 10px', fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)' }}>
                        Client Instruction: {mod.instructionFile.fileName}
                      </div>
                      {instrPreviewable && (
                        <div style={{ padding: '8px', background: 'var(--bg-primary)' }}>
                          {instrIsImage ? (
                            <img src={instrUrl} alt="Client instruction" style={{ maxWidth: '100%', maxHeight: '400px', display: 'block', margin: '0 auto', borderRadius: '4px' }} />
                          ) : (
                            <iframe src={instrUrl} title="Client instruction" style={{ width: '100%', height: '400px', border: 'none', borderRadius: '4px', background: '#fff' }} />
                          )}
                        </div>
                      )}
                      {instrIsEml && !parsedEml && (
                        <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                          Loading email preview...
                        </div>
                      )}
                      {instrIsEml && parsedEml?.error && (
                        <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: '#ef4444' }}>
                          Failed to parse email: {parsedEml.error}
                        </div>
                      )}
                      {instrIsEml && parsedEml && !parsedEml.error && (
                        <div>
                          <div style={{ padding: '8px 10px', fontSize: '12px', borderBottom: '1px solid var(--border-color)' }}>
                            {parsedEml.from && <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>From:</strong> <span style={{ color: 'var(--text-primary)' }}>{parsedEml.from}</span></div>}
                            {parsedEml.to && <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>To:</strong> <span style={{ color: 'var(--text-primary)' }}>{parsedEml.to}</span></div>}
                            <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>Subject:</strong> <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{parsedEml.subject}</span></div>
                            {parsedEml.date && <div><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>Date:</strong> <span style={{ color: 'var(--text-primary)' }}>{new Date(parsedEml.date).toLocaleString()}</span></div>}
                            {parsedEml.hasAttachments && (
                              <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '11px' }}>
                                Attachments: {parsedEml.attachmentNames.join(', ')}
                              </div>
                            )}
                          </div>
                          {parsedEml.html ? (
                            <iframe
                              srcDoc={parsedEml.html}
                              title="Email content"
                              style={{ width: '100%', height: '300px', border: 'none', background: '#fff' }}
                              sandbox="allow-same-origin"
                            />
                          ) : parsedEml.text ? (
                            <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.5', maxHeight: '300px', overflowY: 'auto' }}>{parsedEml.text}</div>
                          ) : (
                            <div style={{ padding: '10px', fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Email has no body content (calendar invitation or empty message)</div>
                          )}
                        </div>
                      )}
                      {!instrPreviewable && !instrIsEml && (
                        <div style={{ padding: '10px', textAlign: 'center' }}>
                          <button
                            style={{ padding: '6px 14px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                            onClick={() => { const a = document.createElement('a'); a.href = instrUrl; a.download = mod.instructionFile.fileName; a.click(); }}
                          >
                            Download {mod.instructionFile.fileName}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <button style={styles.modalCancelBtn} onClick={() => setReviewOrder(null)}>
                Cancel
              </button>

              {reviewOrder.status === 'pending_modification' ? (
                <>
                  <button
                    style={{ ...styles.rejectBtn, padding: '8px 20px', fontSize: '13px', opacity: isActioning ? 0.5 : 1 }}
                    onClick={() => { setRejectModalOrder(reviewOrder); setRejectionReason(''); setReviewOrder(null); }}
                    disabled={!!isActioning}
                  >
                    Reject Modification
                  </button>
                  <button
                    style={{
                      ...styles.validateBtn, padding: '8px 20px', fontSize: '13px',
                      opacity: (reviewOrder.pendingModification?.requestedBy === user._id) || isActioning ? 0.5 : 1,
                      cursor: (reviewOrder.pendingModification?.requestedBy === user._id) || isActioning ? 'not-allowed' : 'pointer'
                    }}
                    onClick={async () => { await handleValidateModification(reviewOrder); }}
                    disabled={(reviewOrder.pendingModification?.requestedBy === user._id) || !!isActioning}
                    title={(reviewOrder.pendingModification?.requestedBy === user._id) ? 'Cannot validate your own modification (four-eyes)' : 'Validate modification'}
                  >
                    {isActioning === reviewOrder._id ? 'Validating...' : 'Validate Modification'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    style={{ ...styles.rejectBtn, padding: '8px 20px', fontSize: '13px', opacity: isActioning ? 0.5 : 1 }}
                    onClick={() => { setRejectModalOrder(reviewOrder); setRejectionReason(''); setReviewOrder(null); }}
                    disabled={!!isActioning}
                  >
                    Reject
                  </button>
                  <button
                    style={{
                      ...styles.validateBtn, padding: '8px 20px', fontSize: '13px',
                      opacity: isOwnOrder(reviewOrder) || isActioning ? 0.5 : 1,
                      cursor: isOwnOrder(reviewOrder) || isActioning ? 'not-allowed' : 'pointer'
                    }}
                    onClick={async () => { await handleValidate(reviewOrder); setReviewOrder(null); }}
                    disabled={isOwnOrder(reviewOrder) || !!isActioning}
                    title={isOwnOrder(reviewOrder) ? 'Cannot validate your own order (four-eyes)' : 'Validate this order'}
                  >
                    {isActioning === reviewOrder._id ? 'Validating...' : 'Validate Order'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectModalOrder && (
        <div style={styles.modalOverlay} onClick={() => setRejectModalOrder(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>
              {rejectModalOrder.status === 'pending_modification' ? 'Reject Modification' : 'Reject Order'} {rejectModalOrder.orderReference}
            </h3>
            <p style={styles.modalDesc}>
              {rejectModalOrder.status === 'pending_modification'
                ? <>This will reject the modification and revert the order to its previous status.</>
                : <>This will reject the order for <strong>{rejectModalOrder.securityName}</strong> and notify the creator.</>
              }
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={styles.modalLabel}>Reason (optional)</label>
              <textarea
                style={styles.modalTextarea}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Enter rejection reason..."
                rows={3}
              />
            </div>
            <div style={styles.modalActions}>
              <button
                style={styles.modalCancelBtn}
                onClick={() => setRejectModalOrder(null)}
              >
                Cancel
              </button>
              <button
                style={{
                  ...styles.rejectBtn,
                  padding: '8px 20px',
                  fontSize: '13px',
                  opacity: isActioning ? 0.5 : 1
                }}
                onClick={rejectModalOrder.status === 'pending_modification' ? handleRejectModification : handleReject}
                disabled={!!isActioning}
              >
                {isActioning ? 'Rejecting...' : (rejectModalOrder.status === 'pending_modification' ? 'Reject Modification' : 'Reject Order')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const styles = {
  container: {
    borderLeft: '4px solid #f97316',
    borderRadius: '8px',
    background: 'var(--bg-primary)',
    border: '1px solid rgba(249, 115, 22, 0.3)',
    borderLeftWidth: '4px',
    borderLeftColor: '#f97316',
    marginBottom: '16px',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'rgba(249, 115, 22, 0.08)',
    borderBottom: '1px solid rgba(249, 115, 22, 0.15)'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  headerIcon: {
    fontSize: '16px'
  },
  headerTitle: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#f97316',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '22px',
    height: '22px',
    borderRadius: '11px',
    background: '#f97316',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '700',
    padding: '0 6px'
  },
  headerSubtitle: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontStyle: 'italic'
  },
  loading: {
    padding: '20px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '13px'
  },
  tableWrapper: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px'
  },
  th: {
    padding: '8px 12px',
    textAlign: 'left',
    fontWeight: '600',
    fontSize: '11px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    borderBottom: '1px solid var(--border-color)',
    whiteSpace: 'nowrap'
  },
  row: {
    borderBottom: '1px solid var(--border-color)',
    transition: 'background 0.15s'
  },
  td: {
    padding: '8px 12px',
    fontSize: '12px',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap'
  },
  reviewBtn: {
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    background: '#0ea5e9',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.15s'
  },
  validateBtn: {
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    background: '#10b981',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.15s'
  },
  rejectBtn: {
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    background: '#ef4444',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.15s'
  },
  // Reject modal styles
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000
  },
  modalContent: {
    background: 'var(--bg-primary)',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '440px',
    width: '90%',
    boxShadow: '0 20px 40px rgba(0,0,0,0.3)'
  },
  modalTitle: {
    margin: '0 0 8px 0',
    fontSize: '16px',
    fontWeight: '700',
    color: 'var(--text-primary)'
  },
  modalDesc: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    marginBottom: '16px',
    lineHeight: '1.5'
  },
  modalLabel: {
    display: 'block',
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    marginBottom: '6px'
  },
  modalTextarea: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontSize: '13px',
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box'
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px'
  },
  modalCancelBtn: {
    padding: '8px 20px',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  reviewLabel: {
    display: 'block',
    fontSize: '10px',
    fontWeight: '600',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    marginBottom: '2px'
  },
  reviewValue: {
    fontSize: '13px',
    color: 'var(--text-primary)',
    wordBreak: 'break-word'
  }
};

export default ValidationBlotter;
