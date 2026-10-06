import React from 'react';

/**
 * One pill per live resting order (limit / stop / take-profit) on a PMS line,
 * e.g. "⏳ Limit sell 10,100 @ 24.00". Orders arrive pre-formatted by
 * OrderHelpers.formatOrderDetails (orders.list), so this only displays them.
 * A passed Day/GTD validity is flagged, since nothing expires orders on our side.
 */
const LiveOrderPills = ({ orders = [], style }) => {
  if (!orders.length) return null;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.3rem', ...style }}>
      {orders.map(order => {
        const isSell = order.orderType === 'sell';
        const title = [
          order.orderReference,
          `${order.priceTypeLabel || 'Order'} ${order.orderType || ''}`.trim(),
          order.triggerPriceFormatted && `Price: ${order.triggerPriceFormatted}${order.currency && !order.quotesAsPercent ? ` ${order.currency}` : ''}`,
          `Quantity: ${order.remainingOfTotalFormatted}`,
          order.validityShort && `Validity: ${order.validityShort}`,
          order.statusLabel && `Status: ${order.statusLabel}`,
          order.validityPassed && 'Validity passed: confirm with the bank or cancel'
        ].filter(Boolean).join('\n');
        return (
          <span
            key={order._id}
            title={title}
            style={{
              flex: 'none',
              padding: '0.05rem 0.45rem',
              fontSize: '0.68rem',
              lineHeight: '1.2rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              borderRadius: '4px',
              color: isSell ? 'var(--loss-color)' : 'var(--gain-color)',
              background: 'rgba(245, 158, 11, 0.14)',
              border: order.validityPassed ? '1px solid var(--loss-color)' : '1px solid rgba(245, 158, 11, 0.45)'
            }}
          >
            ⏳ {order.restingLabel}{order.validityPassed ? ' · validity passed' : ''}
          </span>
        );
      })}
    </span>
  );
};

export default LiveOrderPills;
