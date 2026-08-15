import React from 'react';

/**
 * ObservationCardMobile - phone rendering of one row of the observation schedule.
 *
 * The desktop view is an 8-column grid pinned to minWidth:1300px inside a
 * 500px-tall scroll box, so on a phone it becomes a horizontal scroll nested
 * inside a vertical one, and only the date and type columns are ever on screen.
 * Here each observation is a card: product name and type visible, everything
 * else (ISIN, nominal, status, coupons, prediction) one tap away.
 *
 * The observation date is not repeated on the card - the date heading above a
 * run of same-day cards carries it.
 *
 * Every value is pre-computed in server/publications/schedule.js. The only
 * formatting done here is the nominal, carried over verbatim from the desktop
 * cell so the two cannot drift.
 */

const MUTED = 'var(--neutral-color)';

const S = {
  title: '1rem',        // 16px - product name, the primary identifier
  label: '0.75rem',     // 12px - field label
  value: '0.875rem',    // 14px - field value
  pill: '0.8125rem'     // 13px - badge text
};

const labelStyle = {
  fontSize: S.label,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  flexShrink: 0
};

const rowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '0.75rem'
};

const pill = (color, background) => ({
  color,
  background,
  padding: '0.3rem 0.6rem',
  borderRadius: '6px',
  display: 'inline-block',
  fontSize: S.pill,
  fontWeight: '600',
  whiteSpace: 'nowrap'
});

const ObservationCardMobile = ({
  obs,
  isExpanded,
  onToggle,
  isNext,
  showPrediction,
  typeLabel,
  theme
}) => {
  const isFuture = !obs.isPast;
  const pred = obs.nextObservationPrediction;

  const openReport = (e) => {
    e.stopPropagation();
    window.history.pushState(null, null, `/report/${obs.productId}`);
    window.location.href = `/report/${obs.productId}`;
  };

  // Coupon / autocall badges - same branching as the desktop Coupons cell
  const renderCoupons = () => {
    if (obs.outcome && obs.outcome.hasOccurred) {
      const badges = [];
      if (obs.outcome.couponPaid > 0) {
        badges.push(
          <span key="paid" style={pill('#059669', '#d1fae5')}>
            💵 {obs.outcome.couponPaidFormatted}
          </span>
        );
      }
      if (obs.outcome.couponInMemory > 0) {
        badges.push(
          <span key="mem" style={pill('#c2410c', '#fed7aa')}>
            🧠 Memory: {obs.outcome.couponInMemoryFormatted}
          </span>
        );
      }
      if (badges.length === 0 && !obs.outcome.productCalled) {
        badges.push(
          <span key="none" style={{ color: MUTED, fontStyle: 'italic', fontSize: S.value }}>
            ✗ No coupon
          </span>
        );
      }
      return badges.length ? badges : <span style={{ color: MUTED }}>—</span>;
    }

    const badges = [];
    if (obs.couponRate) {
      badges.push(
        <span key="rate" style={pill('#059669', '#d1fae5')}>💵 {obs.couponRate}%</span>
      );
    }
    if (obs.autocallLevel) {
      badges.push(
        <span key="level" style={pill('#2563eb', '#dbeafe')}>🎯 {obs.autocallLevel}%</span>
      );
    }
    return badges.length ? badges : <span style={{ color: MUTED }}>—</span>;
  };

  const renderPrediction = () => {
    if (!pred) return null;
    const t = pred.outcomeType;
    let badge = null;
    if (t === 'autocall') {
      badge = <span style={pill('#ffffff', 'linear-gradient(135deg, var(--info-color) 0%, #2563eb 100%)')}>🎊 Autocall: {pred.autocallPriceFormatted}</span>;
    } else if (t === 'coupon') {
      badge = <span style={pill('#059669', '#d1fae5')}>💵 Coupon: {pred.couponAmountFormatted}</span>;
    } else if (t === 'memory_added') {
      badge = <span style={pill('#c2410c', '#fed7aa')}>🧠 In Memory</span>;
    } else if (t === 'final_redemption') {
      badge = <span style={pill('#ffffff', 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)')}>🏁 Final: {pred.redemptionAmountFormatted}</span>;
    } else if (t === 'no_event') {
      badge = <span style={{ color: MUTED, fontStyle: 'italic', fontSize: S.value }}>✗ No coupon</span>;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
        {badge}
        <span style={{ fontSize: S.label, color: MUTED, fontStyle: 'italic' }}>
          Basket: {pred.currentBasketLevelFormatted}
        </span>
      </div>
    );
  };

  const detailRow = (label, value, key) => (
    <div key={key} style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={{
        fontSize: S.value,
        color: 'var(--text-primary)',
        textAlign: 'right',
        minWidth: 0,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.35rem',
        justifyContent: 'flex-end'
      }}>
        {value}
      </span>
    </div>
  );

  return (
    <div
      onClick={onToggle}
      style={{
        border: `1px solid ${isNext ? 'var(--info-color)' : 'var(--border-color)'}`,
        borderLeft: isNext
          ? '4px solid var(--info-color)'
          : obs.isFinal
            ? '4px solid #ea580c'
            : `1px solid ${'var(--border-color)'}`,
        borderRadius: '10px',
        background: isExpanded
          ? (theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)')
          : 'var(--bg-secondary)',
        padding: '0.875rem 1rem',
        cursor: 'pointer'
      }}
    >
      {/* Product name + chevron */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{
          flex: 1,
          minWidth: 0,
          fontSize: S.title,
          fontWeight: '600',
          color: 'var(--text-primary)',
          lineHeight: '1.35'
        }}>
          {obs.productTitle}
        </div>
        {/* U+25BE / U+25B8 rather than U+25BC / U+25B6: the latter pair has an
            emoji presentation that renders as a blue play button and ignores
            the inherited colour. */}
        <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', flexShrink: 0, lineHeight: '1.4' }}>
          {isExpanded ? '▾' : '▸'}
        </span>
      </div>

      {/* Type + status badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem', alignItems: 'center' }}>
        <span style={{
          background: obs.isFinal
            ? 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)'
            : isFuture
              ? 'rgba(148, 163, 184, 0.2)'
              : 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
          color: obs.isFinal ? '#ffffff' : isFuture ? 'var(--text-secondary)' : '#ffffff',
          padding: '0.3rem 0.65rem',
          borderRadius: '8px',
          fontWeight: '700',
          fontSize: S.pill,
          whiteSpace: 'nowrap',
          // The raw observationType fallback is lowercase ("observation"),
          // which reads as a typo next to "Autocall" / "Final".
          textTransform: 'capitalize'
        }}>
          {typeLabel}
        </span>
        {isNext && !obs.isToday && (
          <span style={{
            background: 'linear-gradient(135deg, var(--info-color) 0%, #2563eb 100%)',
            color: '#ffffff',
            padding: '0.3rem 0.65rem',
            borderRadius: '8px',
            fontWeight: '700',
            fontSize: S.pill,
            letterSpacing: '0.4px'
          }}>
            NEXT
          </span>
        )}
        {obs.outcome && obs.outcome.hasOccurred && obs.outcome.productCalled && (
          <span style={{
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            color: '#ffffff',
            padding: '0.3rem 0.65rem',
            borderRadius: '8px',
            fontWeight: '700',
            fontSize: S.pill,
            letterSpacing: '0.4px'
          }}>
            REDEEMED
          </span>
        )}
      </div>

      {isExpanded && (
        <div style={{
          marginTop: '0.875rem',
          paddingTop: '0.875rem',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.625rem'
        }}>
          {detailRow('ISIN', (
            <span style={{ fontFamily: 'monospace' }}>{obs.productIsin}</span>
          ), 'isin')}

          {obs.clientNominal != null && detailRow('Nominal', new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: obs.productCurrency || 'EUR',
            maximumFractionDigits: 0
          }).format(obs.clientNominal), 'nominal')}

          {detailRow(obs.isPast ? 'Coupons' : 'Terms', renderCoupons(), 'coupons')}

          {showPrediction && pred && detailRow('Prediction', renderPrediction(), 'prediction')}

          <button
            onClick={openReport}
            style={{
              minHeight: '44px',
              marginTop: '0.25rem',
              width: '100%',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--accent-color)',
              fontSize: '0.9375rem',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Open product report →
          </button>
        </div>
      )}
    </div>
  );
};

export default ObservationCardMobile;
