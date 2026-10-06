import React from 'react';
import HoldingPriceChart from '../HoldingPriceChart.jsx';
import LiveOrderPills from './LiveOrderPills.jsx';
import { formatCurrency, formatPrice } from './pmsFormatters.js';
import { S, POSITIVE, NEGATIVE, labelStyle, headlineRowStyle, cardStyle } from './pmsMobileStyles.js';

/**
 * PositionCardMobile - phone-friendly rendering of a single PMS holding.
 *
 * Replaces the desktop 5-column grid (which needed a 700px-wide horizontal
 * scroll strip per row) with a tap-to-expand card. No data is dropped: the
 * fields that don't fit the collapsed card move into the expansion instead of
 * behind a swipe.
 *
 * Collapsed: name / ISIN + Value + P&L.
 * Expanded: quantity, avg price, weight, last price, market value in local
 *           currency, total cost, account, WTD/MTD/YTD (+ contribution),
 *           and the role-gated Buy / Sell / Reclassify actions.
 *
 * Typography is deliberately larger than the desktop table (12px floor for
 * labels, ~17px names, ~20px key figures) - this view is used by clients
 * reading on a phone.
 */

const PositionCardMobile = ({
  position,
  isExpanded,
  onToggle,
  portfolioCurrency,
  totalPortfolioValue,
  linePerf,
  isStale,
  positionFreshness,
  totalBuyQty,
  totalSellQty,
  buyOrderCount,
  sellOrderCount,
  restingOrders = [],
  theme,
  userRole,
  onBuy,
  onSell,
  onReclassify,
  // Opens the linked structured product's report in the app, with the PMS still
  // behind it. Absent when the host provides no navigation, in which case the
  // name stays an ordinary link.
  onOpenReport
}) => {
  const gainPositive = position.gainLoss >= 0;
  const gainPctPositive = position.gainLossPercent >= 0;

  // Same expressions as the desktop row - values are not recomputed differently here
  const weightPercent = totalPortfolioValue > 0
    ? ((position.marketValue / totalPortfolioValue) * 100).toFixed(2)
    : '0.00';
  const investedPercent = position.costBasis != null && totalPortfolioValue > 0
    ? `${((position.costBasis / totalPortfolioValue) * 100).toFixed(1)}% invested`
    : null;
  const priceVsAvg = position.avgPrice > 0
    ? `${position.currentPrice >= position.avgPrice ? '+' : ''}${(((position.currentPrice - position.avgPrice) / position.avgPrice) * 100).toFixed(1)}%`
    : null;
  const priceIsUp = position.currentPrice >= position.avgPrice;

  const showLocalCurrency = position.currency
    && position.currency !== portfolioCurrency
    && position.marketValueOriginalCurrency;

  const costText = position.costBasis != null
    ? formatCurrency(position.costBasis, portfolioCurrency)
    : position.costBasisOriginalCurrency != null
      ? formatCurrency(position.costBasisOriginalCurrency, position.currency)
      : 'N/A';

  // Period performance: '—' when the position had no snapshot before period start
  const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v))
    ? '—'
    : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const pctColor = (v) => (v === null || v === undefined || !Number.isFinite(v))
    ? 'var(--text-muted)'
    : (v >= 0 ? POSITIVE : NEGATIVE);

  const identifierText = position.isin
    || (position.maturityDate
      ? `Matures ${new Date(position.maturityDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
      : position.securityType === 'TERM_DEPOSIT'
        ? (position.depositTerm?.type === 'call' ? 'Call deposit' : 'Rolling deposit')
        : 'N/A');

  const priceDateLabel = position.priceDate
    ? `Last price (${new Date(position.priceDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })})`
    : 'Last price';

  const orderChip = (qty, count, positive) => (
    <span
      style={{
        fontSize: '0.75rem',
        fontWeight: '600',
        color: positive ? POSITIVE : NEGATIVE,
        background: positive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
        padding: '2px 6px',
        borderRadius: '4px',
        marginLeft: '6px',
        whiteSpace: 'nowrap'
      }}
      title={`${positive ? 'Buy' : 'Sell'} order: ${positive ? '+' : '-'}${qty.toLocaleString()} (${count} order${count > 1 ? 's' : ''})`}
    >
      {positive ? '+' : '-'}{qty.toLocaleString()}
    </span>
  );

  // Detail fields laid out as a wrapping 2-column label/value list
  const detailFields = [
    {
      key: 'qty',
      label: 'Quantity',
      value: (
        <span>
          {position.quantity.toLocaleString()}
          {totalBuyQty > 0 && orderChip(totalBuyQty, buyOrderCount, true)}
          {totalSellQty > 0 && orderChip(totalSellQty, sellOrderCount, false)}
        </span>
      )
    },
    {
      key: 'avgPrice',
      label: 'Avg purch. price',
      value: formatPrice(position.avgPrice, position.currency, position.priceType),
      sub: investedPercent
    },
    {
      key: 'weight',
      label: '% of portfolio',
      value: `${weightPercent}%`
    },
    {
      key: 'lastPrice',
      label: priceDateLabel,
      value: formatPrice(position.currentPrice, position.currency, position.priceType),
      valueColor: priceIsUp ? POSITIVE : NEGATIVE,
      sub: priceVsAvg,
      subColor: priceIsUp ? POSITIVE : NEGATIVE
    },
    {
      key: 'marketValueLocal',
      label: `Market value (${position.currency})`,
      value: formatCurrency(position.marketValueOriginalCurrency || position.marketValue, position.currency)
    },
    {
      key: 'totalCost',
      label: 'Total cost',
      value: costText
    },
    {
      key: 'account',
      label: 'Account',
      value: position.bankName || 'N/A'
    }
  ];

  const actionButtonStyle = (color, background) => ({
    minHeight: '44px',
    padding: '0 0.75rem',
    borderRadius: '8px',
    border: 'none',
    background,
    color,
    fontSize: '0.9375rem',
    fontWeight: '600',
    cursor: 'pointer',
    width: '100%'
  });

  const canTrade = ['rm', 'admin', 'superadmin'].includes(userRole);
  const canReclassify = ['admin', 'superadmin', 'compliance'].includes(userRole);

  return (
    <div
      onClick={onToggle}
      style={{ ...cardStyle(theme, isExpanded), cursor: 'pointer' }}
    >
      {/* Header: icon + name + ISIN, with expand affordance */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        {position.productIcon && (
          <span
            style={{ fontSize: '1.35rem', flexShrink: 0, lineHeight: 1.3 }}
            title={position.linkedProduct?.templateId || 'Structured Product'}
          >
            {position.productIcon}
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontWeight: '600',
            color: 'var(--text-primary)',
            fontSize: S.name,
            lineHeight: '1.3',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}>
            {position.linkedProduct ? (
              <a
                href={`/report/${position.linkedProduct._id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onOpenReport) {
                    // In-app: a full page load would drop the PMS and leave no
                    // way back to this list.
                    e.preventDefault();
                    onOpenReport(position.linkedProduct._id);
                  }
                }}
                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              >
                {position.name}
              </a>
            ) : position.name}
          </div>
          <div style={{
            fontSize: S.isin,
            color: 'var(--text-secondary)',
            fontFamily: 'monospace',
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            marginTop: '0.125rem'
          }}>
            {identifierText}
            {position.isin && (
              <HoldingPriceChart
                isin={position.isin}
                securityName={position.name}
                sessionId={localStorage.getItem('sessionId')}
              />
            )}
            {isStale && (
              <span
                title={`Data is ${positionFreshness?.businessDaysOld} business day(s) old`}
                style={{ fontSize: '0.9rem' }}
              >
                ⚠️
              </span>
            )}
          </div>
          {/* Live limit / stop orders working on this position */}
          <LiveOrderPills orders={restingOrders} style={{ marginTop: '0.3rem' }} />
        </div>
        {/* Report shortcut on the collapsed card: no need to expand it first */}
        {position.linkedProduct && onOpenReport && (
          <button
            type="button"
            aria-label={`Open the product report for ${position.name}`}
            onClick={(e) => { e.stopPropagation(); onOpenReport(position.linkedProduct._id); }}
            style={{
              flexShrink: 0,
              minHeight: '32px',
              padding: '0 0.6rem',
              borderRadius: '8px',
              border: 'none',
              background: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--info-color)',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            📄 Report
          </button>
        )}
        {/* U+25BE / U+25B8 rather than U+25BC / U+25B6: the latter pair has an
            emoji presentation that renders as a blue play button and ignores
            the inherited colour. */}
        <span style={{
          fontSize: '1rem',
          color: 'var(--text-secondary)',
          flexShrink: 0,
          padding: '0 0.25rem',
          lineHeight: '1.4'
        }}>
          {isExpanded ? '▾' : '▸'}
        </span>
      </div>

      {/* Headline figures: Value + P&L.
          One figure per full-width row (label left, number right) so large
          amounts never wrap and the currency symbol never orphans. */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        marginTop: '0.75rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid var(--border-color)'
      }}>
        <div style={headlineRowStyle}>
          <div style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>Value</div>
          <div style={{ textAlign: 'right', minWidth: 0 }}>
            <div style={{
              fontSize: S.figure,
              fontWeight: '700',
              color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: '1.2',
              whiteSpace: 'nowrap'
            }}>
              {formatCurrency(position.marketValue, portfolioCurrency)}
            </div>
            {showLocalCurrency && (
              <div style={{
                fontSize: S.secondary,
                color: 'var(--text-secondary)',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
                marginTop: '0.125rem'
              }}>
                {formatCurrency(position.marketValueOriginalCurrency, position.currency)}
              </div>
            )}
          </div>
        </div>
        <div style={headlineRowStyle}>
          <div style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>P&L</div>
          <div style={{ textAlign: 'right', minWidth: 0 }}>
            <div style={{
              fontSize: S.figure,
              fontWeight: '700',
              color: gainPositive ? POSITIVE : NEGATIVE,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: '1.2',
              whiteSpace: 'nowrap'
            }}>
              {gainPositive ? '+' : ''}{formatCurrency(position.gainLoss, portfolioCurrency)}
            </div>
            <div style={{
              fontSize: S.secondary,
              fontWeight: '600',
              color: gainPctPositive ? POSITIVE : NEGATIVE,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              marginTop: '0.125rem'
            }}>
              {gainPctPositive ? '+' : ''}{position.gainLossPercent.toFixed(2)}%
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Detail fields */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0.875rem 0.75rem',
            marginTop: '0.875rem',
            paddingTop: '0.875rem',
            borderTop: '1px solid var(--border-color)'
          }}>
            {detailFields.map((field) => (
              <div key={field.key} style={{ minWidth: 0 }}>
                <div style={labelStyle}>{field.label}</div>
                <div style={{
                  fontSize: S.value,
                  color: field.valueColor || 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                  wordBreak: 'break-word'
                }}>
                  {field.value}
                </div>
                {field.sub && (
                  <div style={{
                    fontSize: S.label,
                    color: field.subColor || 'var(--text-secondary)',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: '0.125rem'
                  }}>
                    {field.sub}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Period performance + contribution to portfolio return */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.5rem',
            marginTop: '0.875rem',
            paddingTop: '0.875rem',
            borderTop: '1px solid var(--border-color)'
          }}>
            {['wtd', 'mtd', 'ytd'].map((key) => {
              const p = linePerf ? linePerf[key] : null;
              return (
                <div key={key} style={{ minWidth: 0 }}>
                  <div style={labelStyle}>{key.toUpperCase()}</div>
                  <div style={{
                    fontSize: S.value,
                    fontWeight: '600',
                    color: pctColor(p?.returnPercent),
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {fmtPct(p?.returnPercent)}
                  </div>
                  <div style={{
                    fontSize: S.label,
                    color: 'var(--text-secondary)',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: '0.125rem'
                  }}>
                    Contrib {fmtPct(p?.contributionPercent)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* The report of the structured product this position holds. On a
              phone the product name is a two-line clamp inside a card whose tap
              expands it, so the link in it is easy to miss — this is the
              obvious way in, and every role gets it. */}
          {position.linkedProduct && onOpenReport && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenReport(position.linkedProduct._id); }}
              style={{
                ...actionButtonStyle('var(--info-color)', 'rgba(59, 130, 246, 0.15)'),
                width: '100%',
                marginTop: '0.875rem'
              }}
            >
              📄 View product report
            </button>
          )}

          {/* Actions - Buy/Sell for RM/Admin, Reclassify for Admin/Compliance */}
          {(canTrade || canReclassify) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.5rem',
              marginTop: '0.875rem',
              paddingTop: '0.875rem',
              borderTop: '1px solid var(--border-color)'
            }}>
              {canTrade && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); onBuy(position); }}
                    style={actionButtonStyle(POSITIVE, 'rgba(16, 185, 129, 0.15)')}
                  >
                    Buy More
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSell(position); }}
                    style={actionButtonStyle(NEGATIVE, 'rgba(239, 68, 68, 0.15)')}
                  >
                    Sell
                  </button>
                </>
              )}
              {canReclassify && (
                <button
                  onClick={(e) => { e.stopPropagation(); onReclassify(position); }}
                  style={{ ...actionButtonStyle('#8b5cf6', 'rgba(139, 92, 246, 0.15)'), gridColumn: '1 / -1' }}
                >
                  Reclassify
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PositionCardMobile;
