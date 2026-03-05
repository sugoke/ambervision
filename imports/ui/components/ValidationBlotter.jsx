import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { ORDER_STATUSES, ASSET_TYPES, EMAIL_TRACE_TYPES, EMAIL_TRACE_LABELS, OrderFormatters } from '/imports/api/orders';

/**
 * ValidationBlotter - Displays orders pending four-eyes validation
 *
 * Shows a compact table of PENDING_VALIDATION orders with approve/reject actions.
 * Auto-hides when no orders need validation or user lacks canValidateOrders.
 */
const ValidationBlotter = ({ user, onOrderValidated }) => {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rejectModalOrder, setRejectModalOrder] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isActioning, setIsActioning] = useState(null); // orderId being actioned
  const [reviewOrder, setReviewOrder] = useState(null); // order being reviewed before validation

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
  }, [isStaff]);

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

  // Don't render if not staff or no orders pending
  if (!isStaff || (!isLoading && orders.length === 0)) {
    return null;
  }

  const canValidate = user?.canValidateOrders === true;

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
          <div style={{ ...styles.modalContent, maxWidth: '620px' }} onClick={(e) => e.stopPropagation()}>
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

            {/* Email Traces / Attachments */}
            {(() => {
              const traces = reviewOrder.emailTraces || [];
              if (traces.length === 0) return null;
              return (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '8px' }}>
                    Attached Documents
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {traces.map((trace) => (
                      <div key={trace._id} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)'
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
                        <button
                          style={{
                            padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--border-color)',
                            background: 'transparent', color: 'var(--text-secondary)', fontSize: '11px',
                            fontWeight: '600', cursor: 'pointer'
                          }}
                          onClick={async () => {
                            try {
                              const sessionId = localStorage.getItem('sessionId');
                              const result = await Meteor.callAsync('orders.downloadEmailTrace', {
                                orderId: reviewOrder._id, traceId: trace._id, sessionId
                              });
                              if (result?.base64Data) {
                                const byteChars = atob(result.base64Data);
                                const byteArray = new Uint8Array(byteChars.length);
                                for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
                                const blob = new Blob([byteArray], { type: result.mimeType || 'application/octet-stream' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url; a.download = trace.fileName; a.click();
                                URL.revokeObjectURL(url);
                              }
                            } catch (err) {
                              console.error('Error downloading trace:', err);
                            }
                          }}
                          title={`Download ${trace.fileName}`}
                        >
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Limit History */}
            {reviewOrder.limitHistoryFormatted?.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '8px' }}>
                  Limit Price History
                </div>
                {reviewOrder.limitHistoryFormatted.map((entry, idx) => (
                  <div key={idx} style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    {entry.changedAtFormatted} — {entry.priceTypeLabel}: {OrderFormatters.formatWithCurrency(entry.price, reviewOrder.currency)}
                    {entry.changedByName && <span style={{ color: 'var(--text-muted)' }}> by {entry.changedByName}</span>}
                    {entry.reason && <span style={{ color: 'var(--text-muted)' }}> ({entry.reason})</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <button style={styles.modalCancelBtn} onClick={() => setReviewOrder(null)}>
                Cancel
              </button>
              <button
                style={{
                  ...styles.rejectBtn, padding: '8px 20px', fontSize: '13px',
                  opacity: isActioning ? 0.5 : 1
                }}
                onClick={() => {
                  setRejectModalOrder(reviewOrder);
                  setRejectionReason('');
                  setReviewOrder(null);
                }}
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
                onClick={async () => {
                  await handleValidate(reviewOrder);
                  setReviewOrder(null);
                }}
                disabled={isOwnOrder(reviewOrder) || !!isActioning}
                title={isOwnOrder(reviewOrder) ? 'Cannot validate your own order (four-eyes)' : 'Validate this order'}
              >
                {isActioning === reviewOrder._id ? 'Validating...' : 'Validate Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectModalOrder && (
        <div style={styles.modalOverlay} onClick={() => setRejectModalOrder(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Reject Order {rejectModalOrder.orderReference}</h3>
            <p style={styles.modalDesc}>
              This will reject the order for <strong>{rejectModalOrder.securityName}</strong> and notify the creator.
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
                onClick={handleReject}
                disabled={!!isActioning}
              >
                {isActioning ? 'Rejecting...' : 'Reject Order'}
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
