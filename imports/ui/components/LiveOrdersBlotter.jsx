import React, { useMemo, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { OrdersCollection, OrderHelpers, LIVE_ORDER_STATUSES, RESTING_PRICE_TYPES } from '/imports/api/orders';
import { BanksCollection } from '/imports/api/banks';
import { useIsMobile } from '../hooks/useIsMobile.js';

/**
 * LiveOrdersBlotter - the limit / stop / take-profit orders still working at
 * the banks (validated, not filled, cancelled or rejected). Reactive: an order
 * leaves the list as soon as it is executed or cancelled. Oldest first, so the
 * orders working longest surface. Nothing expires orders on our side, so a
 * passed Day/GTD validity is flagged for the desk to confirm with the bank.
 * Hidden when no order is live.
 */
const LiveOrdersBlotter = ({ user, onOpenOrder }) => {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const isStaff = ['superadmin', 'admin', 'rm', 'assistant', 'compliance', 'staff'].includes(user?.role);
  const sessionId = useMemo(() => localStorage.getItem('sessionId'), []);

  const orders = useTracker(() => {
    if (!isStaff || !sessionId) return [];
    const handle = Meteor.subscribe('orders', sessionId, {
      status: LIVE_ORDER_STATUSES,
      priceType: RESTING_PRICE_TYPES,
      limit: 500
    });
    Meteor.subscribe('banks');
    if (!handle.ready()) return [];
    return OrdersCollection.find(
      { status: { $in: LIVE_ORDER_STATUSES }, priceType: { $in: RESTING_PRICE_TYPES } },
      { sort: { createdAt: 1 } }
    ).fetch().map(order => {
      const formatted = OrderHelpers.formatOrderDetails(order);
      const bank = order.bankId ? BanksCollection.findOne(order.bankId) : null;
      return {
        ...formatted,
        securityName: order.displayName || formatted.securityName,
        bankName: bank?.name || order.bankName || '—'
      };
    });
  }, [isStaff, sessionId]);

  if (!isStaff || orders.length === 0) return null;

  const passedCount = orders.filter(o => o.validityPassed).length;
  const th = { padding: '8px 10px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-color)' };
  const td = { padding: '8px 10px', fontSize: '0.82rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', verticalAlign: 'top' };
  const right = { textAlign: 'right' };
  const sideColor = (o) => (o.orderType === 'sell' ? 'var(--loss-color)' : 'var(--gain-color)');

  return (
    <div style={{ marginBottom: '1rem', border: '1px solid rgba(245, 158, 11, 0.45)', borderRadius: '10px', background: 'var(--bg-secondary)', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '10px 14px', background: 'rgba(245, 158, 11, 0.10)', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
      >
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
          ⏳ Live limit orders · {orders.length}
          {passedCount > 0 && (
            <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--loss-color)' }}>
              {passedCount} with validity passed
            </span>
          )}
        </span>
        <span style={{ color: 'var(--text-secondary)' }}>{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (isMobile ? (
        <div style={{ padding: '8px' }}>
          {orders.map(o => (
            <div key={o._id} onClick={() => onOpenOrder?.(o)} style={{ padding: '10px', marginBottom: '8px', borderRadius: '8px', background: 'var(--bg-primary)', border: o.validityPassed ? '1px solid var(--loss-color)' : '1px solid var(--border-color)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <span>{o.orderReference} · {o.createdAtFormatted}</span>
                <span>{o.statusLabel}</span>
              </div>
              <div style={{ fontWeight: 600, margin: '4px 0', fontSize: '0.88rem' }}>{o.securityName}</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: sideColor(o) }}>{o.restingLabel} {!o.quotesAsPercent && o.currency}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {o.clientName} · {o.bankName} {o.portfolioCode} · {o.validityShort}
              </div>
              {o.validityPassed && <div style={{ fontSize: '0.75rem', color: 'var(--loss-color)', marginTop: '4px' }}>Validity passed: confirm with the bank or cancel</div>}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Reference</th>
                <th style={th}>Placed</th>
                <th style={th}>Client / Account</th>
                <th style={th}>Bank</th>
                <th style={th}>Side</th>
                <th style={th}>Type</th>
                <th style={th}>Security</th>
                <th style={{ ...th, ...right }}>Qty</th>
                <th style={{ ...th, ...right }}>Limit / trigger</th>
                <th style={th}>Ccy</th>
                <th style={th}>Validity</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr
                  key={o._id}
                  onClick={() => onOpenOrder?.(o)}
                  style={{ cursor: 'pointer', background: o.validityPassed ? 'rgba(239, 68, 68, 0.06)' : 'transparent' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = o.validityPassed ? 'rgba(239, 68, 68, 0.06)' : 'transparent'; }}
                >
                  <td style={{ ...td, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{o.orderReference}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{o.createdAtFormatted}</td>
                  <td style={td}>
                    <div>{o.clientName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{o.portfolioCode}</div>
                  </td>
                  <td style={td}>{o.bankName}</td>
                  <td style={{ ...td, fontWeight: 600, color: sideColor(o), textTransform: 'capitalize' }}>{o.orderType}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{o.priceTypeLabel}</td>
                  <td style={td}>
                    <div>{o.securityName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{o.isin}</div>
                  </td>
                  <td style={{ ...td, ...right, whiteSpace: 'nowrap' }}>{o.remainingOfTotalFormatted}</td>
                  <td style={{ ...td, ...right, whiteSpace: 'nowrap', fontWeight: 600 }}>{o.triggerPriceFormatted || '—'}</td>
                  <td style={td}>{o.currency}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {o.validityShort || '—'}
                    {o.validityPassed && <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--loss-color)' }}>Validity passed: confirm or cancel</div>}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{o.statusLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

export default LiveOrdersBlotter;
