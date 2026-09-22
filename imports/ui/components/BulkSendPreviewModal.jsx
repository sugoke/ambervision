import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Meteor } from 'meteor/meteor';
import { useIsMobile } from '../hooks/useIsMobile.js';

/**
 * Review and send every validated client's bank email in a bulk group, from the
 * user's own Outlook mailbox.
 *
 * Sends are strictly SEQUENTIAL. Graph allows only about four concurrent
 * requests per mailbox, and firing a whole bulk at once would throttle; running
 * them one at a time also gives honest per-row progress and lets one failure be
 * reported without taking the rest of the batch down with it.
 *
 * Recipients are editable per row because "no desk email configured at this
 * bank for this asset type" is a real and recurring case — previously it was
 * fixed by hand in Outlook after the draft opened, which no longer happens.
 *
 * Portals to document.body: the light-theme backdrop-filter wrappers in App.jsx
 * trap position:fixed descendants.
 */
export default function BulkSendPreviewModal({ items, mailbox, onClose, onDone }) {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState([]);
  const [sending, setSending] = useState(false);
  const [finished, setFinished] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!items) return;
    setRows(items.map(it => ({
      ...it,
      selected: true,
      to: it.payload?.emailData?.to || '',
      status: 'pending',
      error: null
    })));
    setSending(false);
    setFinished(false);
    cancelRef.current = false;
  }, [items]);

  useEffect(() => {
    if (!items) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [items]);

  if (!items) return null;

  const patch = (orderId, changes) =>
    setRows(prev => prev.map(r => (r.orderId === orderId ? { ...r, ...changes } : r)));

  const selectable = rows.filter(r => r.selected && r.status !== 'sent');
  const missingRecipient = selectable.filter(r => !r.to.trim()).length;

  const handleSend = async () => {
    const queue = rows.filter(r => r.selected && r.status !== 'sent' && r.to.trim());

    setSending(true);
    setFinished(false);
    // Pinned at start: `selectable` shrinks as rows complete, so using it as the
    // denominator would make the progress count slide around.
    setProgress({ done: 0, total: queue.length });
    cancelRef.current = false;

    for (const row of queue) {
      if (cancelRef.current) break;
      setProgress(p => ({ ...p, done: p.done + 1 }));
      patch(row.orderId, { status: 'sending', error: null });
      try {
        await Meteor.callAsync('orders.sendViaGraph', {
          orderId: row.orderId,
          sessionId: localStorage.getItem('sessionId'),
          overrides: { to: row.to }
        });
        patch(row.orderId, { status: 'sent' });
      } catch (err) {
        // One bad recipient must not stop the rest of the batch.
        patch(row.orderId, { status: 'failed', error: err.reason || err.message });
      }
    }

    setSending(false);
    setFinished(true);
    // The per-row statuses stay on screen, but the caller gets the totals so it
    // can confirm the batch the same way a single send is confirmed.
    setRows(current => {
      const sent = current.filter(r => r.status === 'sent').length;
      const failed = current.filter(r => r.status === 'failed').length;
      onDone?.({ sent, failed });
      return current;
    });
  };

  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const statusCell = (row) => {
    if (row.status === 'sent') return <span style={{ color: 'var(--gain-color)' }}>Sent</span>;
    if (row.status === 'sending') return <span style={{ color: 'var(--text-muted)' }}>Sending…</span>;
    if (row.status === 'failed') {
      return <span style={{ color: 'var(--loss-color)' }} title={row.error || ''}>Failed</span>;
    }
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  };

  const inputStyle = {
    padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '11px', width: '100%'
  };

  const modal = (
    <div
      onClick={() => { if (!sending) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 20001,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? '0' : '20px'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          borderRadius: isMobile ? '14px 14px 0 0' : '10px',
          width: isMobile ? '100%' : 'min(900px, 100%)',
          maxHeight: isMobile ? '94vh' : '92vh',
          paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : 0,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)'
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
          <strong style={{ color: 'var(--text-primary)', fontSize: '14px' }}>
            Send {rows.length} bank {rows.length === 1 ? 'email' : 'emails'}
          </strong>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
            Sending one at a time from {mailbox || 'your mailbox'}. Each lands in your Sent Items and is
            filed back onto its order.
          </div>
        </div>

        {missingRecipient > 0 && !finished && (
          <div style={{ padding: '8px 18px', fontSize: '11px', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--text-primary)' }}>
            {missingRecipient} selected {missingRecipient === 1 ? 'order has' : 'orders have'} no recipient and will be
            skipped. Type an address below, and set it permanently in Bank Management.
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {/* A five-column table does not fit a phone, and letting it scroll
              sideways hides the recipient field — the one thing that may need
              fixing before sending. One card per order instead. */}
          {isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 14px' }}>
              {rows.map(row => (
                <div
                  key={row.orderId}
                  style={{
                    border: '1px solid var(--border-color)', borderRadius: '8px',
                    padding: '10px 12px', background: 'var(--bg-primary)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={sending || row.status === 'sent'}
                      onChange={e => patch(row.orderId, { selected: e.target.checked })}
                      style={{ width: '18px', height: '18px', flexShrink: 0 }}
                    />
                    <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '12px', color: 'var(--text-primary)' }}>
                      {row.orderReference}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: '11px' }}>{statusCell(row)}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>{row.clientName}</div>
                  <input
                    type="text"
                    value={row.to}
                    disabled={sending || row.status === 'sent'}
                    onChange={e => patch(row.orderId, { to: e.target.value })}
                    placeholder="desk@bank.com"
                    style={{
                      ...inputStyle,
                      fontSize: '16px', padding: '9px 10px', boxSizing: 'border-box',
                      borderColor: row.to.trim() ? 'var(--border-color)' : 'var(--warning-color)'
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px 6px 18px', width: '28px' }} />
                <th style={{ padding: '6px 8px' }}>Order</th>
                <th style={{ padding: '6px 8px' }}>Client</th>
                <th style={{ padding: '6px 8px', minWidth: '200px' }}>To</th>
                <th style={{ padding: '6px 18px 6px 8px', width: '70px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.orderId} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '6px 8px 6px 18px' }}>
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={sending || row.status === 'sent'}
                      onChange={e => patch(row.orderId, { selected: e.target.checked })}
                    />
                  </td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {row.orderReference}
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>{row.clientName}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      type="text"
                      value={row.to}
                      disabled={sending || row.status === 'sent'}
                      onChange={e => patch(row.orderId, { to: e.target.value })}
                      placeholder="desk@bank.com"
                      style={{
                        ...inputStyle,
                        borderColor: row.to.trim() ? 'var(--border-color)' : 'var(--warning-color)'
                      }}
                    />
                  </td>
                  <td style={{ padding: '6px 18px 6px 8px' }}>{statusCell(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}

          {finished && (
            <div style={{ padding: '12px 18px', fontSize: '12px', color: 'var(--text-primary)' }}>
              {counts.sent || 0} sent
              {counts.failed ? `, ${counts.failed} failed` : ''}
              {rows.some(r => r.status === 'failed') && (
                <ul style={{ margin: '8px 0 0 0', paddingLeft: '18px', color: 'var(--loss-color)' }}>
                  {rows.filter(r => r.status === 'failed').map(r => (
                    <li key={r.orderId}>{r.orderReference}: {r.error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div style={{
          padding: '12px 18px', borderTop: '1px solid var(--border-color)',
          display: 'flex', gap: '10px', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap'
        }}>
          <span style={{ flex: isMobile ? '1 1 100%' : 1, fontSize: '11px', color: 'var(--text-muted)' }}>
            {sending ? `Sending ${progress.done} of ${progress.total}…` : ''}
          </span>
          {sending ? (
            <button
              type="button"
              onClick={() => { cancelRef.current = true; }}
              style={{
                padding: isMobile ? '12px 14px' : '6px 14px', borderRadius: '5px',
                border: '1px solid var(--border-color)', background: 'transparent',
                color: 'var(--text-secondary)', fontSize: isMobile ? '14px' : '12px', cursor: 'pointer',
                ...(isMobile ? { flex: 1 } : {})
              }}
            >
              Stop after current
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: isMobile ? '12px 14px' : '6px 14px', borderRadius: '5px',
                  border: '1px solid var(--border-color)', background: 'transparent',
                  color: 'var(--text-secondary)', fontSize: isMobile ? '14px' : '12px', cursor: 'pointer',
                  ...(isMobile ? { flex: 1 } : {})
                }}
              >
                {finished ? 'Close' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={selectable.filter(r => r.to.trim()).length === 0}
                style={{
                  padding: isMobile ? '12px 18px' : '6px 18px', borderRadius: '5px', border: 'none',
                  background: selectable.filter(r => r.to.trim()).length === 0 ? 'var(--border-color)' : '#0ea5e9',
                  color: 'white', fontSize: isMobile ? '15px' : '12px', fontWeight: 600,
                  cursor: selectable.filter(r => r.to.trim()).length === 0 ? 'not-allowed' : 'pointer',
                  ...(isMobile ? { flex: 2 } : {})
                }}
              >
                {finished ? 'Retry failed' : `Send ${selectable.filter(r => r.to.trim()).length}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
