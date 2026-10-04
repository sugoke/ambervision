import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import LiquidGlassCard from '../LiquidGlassCard.jsx';
import {
  OPERATION_CATEGORIES,
  OPERATION_CATEGORY_LIST,
  OPERATION_TYPES,
  getOperationTypeColor
} from '/imports/api/constants/operationTypes';
import { getCurrencySymbol } from './pmsFormatters.js';

/**
 * PMS transactions: one harmonized list for every bank.
 *
 * Every operation carries a `std` block written by its bank parser (type, category,
 * label, description, signed amount and currency, fees, taxes, the bank's own code and
 * wording), so this view reads the same fields whatever the bank.
 */

const PERIODS = [
  { key: 'MTD', label: 'MTD' },
  { key: 'YTD', label: 'YTD' },
  { key: '12M', label: '12 months' },
  { key: 'ALL', label: 'All' },
  { key: 'CUSTOM', label: 'Custom' }
];

// Card payments are spending, not portfolio activity: off until asked for
const DEFAULT_CATEGORIES = OPERATION_CATEGORY_LIST
  .map(c => c.key)
  .filter(k => k !== OPERATION_CATEGORIES.CARD_PAYMENTS.key);

const CASH_FLOW_TYPES = new Set([
  OPERATION_TYPES.TRANSFER_IN, OPERATION_TYPES.TRANSFER_OUT,
  OPERATION_TYPES.PAYMENT_IN, OPERATION_TYPES.PAYMENT_OUT
]);

const startOfPeriod = (key, now = new Date()) => {
  if (key === 'MTD') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (key === 'YTD') return new Date(now.getFullYear(), 0, 1);
  if (key === '12M') return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return null;
};

const formatAmount = (value, currency, { signed = false, decimals = 2 } = {}) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = signed ? (n > 0 ? '+' : n < 0 ? '−' : '') : (n < 0 ? '−' : '');
  const symbol = currency ? getCurrencySymbol(currency) : '';
  return `${sign}${symbol ? `${symbol} ` : ''}${abs}`;
};

const formatNumber = (value, decimals = 4) => {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: decimals });
};

const formatDate = (date) => (date
  ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—');

const monthKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

const categoryOf = (key) => OPERATION_CATEGORIES[key] || OPERATION_CATEGORIES.OTHER;

export default function TransactionsSection({
  operations = [],
  isLoading = false,
  isMobile = false,
  theme = 'light',
  accountLabelFor = () => '',
  bankNameFor = () => '',
  exportName = 'transactions'
}) {
  const [period, setPeriod] = useState('YTD');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [categories, setCategories] = useState(new Set(DEFAULT_CATEGORIES));
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  // Period + search filter (categories are applied after, so chips can show counts)
  const inPeriod = useMemo(() => {
    const from = period === 'CUSTOM' ? (customFrom ? new Date(customFrom) : null) : startOfPeriod(period);
    const to = period === 'CUSTOM' && customTo ? new Date(`${customTo}T23:59:59`) : null;
    const q = search.trim().toLowerCase();
    return operations.filter(op => {
      const d = op.date ? new Date(op.date) : null;
      if (from && (!d || d < from)) return false;
      if (to && (!d || d > to)) return false;
      if (!q) return true;
      const s = op.std || {};
      return [s.instrumentName, s.description, s.isin, s.reference, s.bankTypeLabel, s.label, op.portfolioCode]
        .some(v => v && String(v).toLowerCase().includes(q));
    });
  }, [operations, period, customFrom, customTo, search]);

  const categoryStats = useMemo(() => {
    const stats = {};
    for (const op of inPeriod) {
      const key = op.std?.category || OPERATION_CATEGORIES.OTHER.key;
      if (!stats[key]) stats[key] = { count: 0, totals: {} };
      stats[key].count++;
      const ccy = op.std?.currency || '';
      stats[key].totals[ccy] = (stats[key].totals[ccy] || 0) + (Number(op.std?.amount) || 0);
    }
    return stats;
  }, [inPeriod]);

  const visible = useMemo(
    () => inPeriod.filter(op => categories.has(op.std?.category || OPERATION_CATEGORIES.OTHER.key)),
    [inPeriod, categories]
  );

  // Summary per currency over the visible operations
  const summary = useMemo(() => {
    const byCcy = {};
    for (const op of visible) {
      const s = op.std || {};
      const ccy = s.currency || '—';
      if (!byCcy[ccy]) byCcy[ccy] = { inflows: 0, outflows: 0, income: 0, feesTaxes: 0 };
      const amount = Number(s.amount) || 0;
      if (CASH_FLOW_TYPES.has(s.type) && s.cashImpact !== false) {
        if (amount > 0) byCcy[ccy].inflows += amount; else byCcy[ccy].outflows += amount;
      } else if (s.category === OPERATION_CATEGORIES.INCOME.key) {
        byCcy[ccy].income += amount;
      } else if (s.category === OPERATION_CATEGORIES.FEES_TAXES.key) {
        byCcy[ccy].feesTaxes += amount;
      }
    }
    return Object.entries(byCcy)
      .filter(([, v]) => v.inflows || v.outflows || v.income || v.feesTaxes)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const op of visible) {
      const key = op.date ? monthKey(op.date) : 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(op);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  const toggleCategory = (key) => {
    setCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const exportExcel = () => {
    const rows = visible.map(op => {
      const s = op.std || {};
      return {
        Date: op.date ? new Date(op.date).toISOString().slice(0, 10) : '',
        'Value date': op.valueDate ? new Date(op.valueDate).toISOString().slice(0, 10) : '',
        Bank: bankNameFor(op),
        Account: accountLabelFor(op),
        Category: categoryOf(s.category).label,
        Type: s.label || op.type,
        Instrument: s.instrumentName || '',
        ISIN: s.isin || '',
        Description: s.description || '',
        Quantity: s.quantity ?? '',
        Price: s.price ?? '',
        Amount: s.amount ?? '',
        Currency: s.currency || '',
        Fees: s.fees ?? '',
        Taxes: s.taxes ?? '',
        'Accrued interest': s.accruedInterest ?? '',
        'FX rate': s.fxRate ?? '',
        'Bank code': s.bankTypeCode || '',
        'Bank wording': s.bankTypeLabel || '',
        Reference: s.reference || ''
      };
    });
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Transactions');
    XLSX.writeFile(book, `${exportName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ---- styles
  const chip = (active) => ({
    padding: '6px 12px',
    borderRadius: '999px',
    border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`,
    background: active ? 'var(--accent-color)' : 'transparent',
    color: active ? 'white' : 'var(--text-secondary)',
    fontSize: '0.8rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  });
  const muted = { color: 'var(--text-muted)', fontSize: '0.78rem' };
  const rowHover = theme === 'light' ? 'rgba(0, 0, 0, 0.025)' : 'rgba(255, 255, 255, 0.03)';

  const amountColor = (op) => {
    const s = op.std || {};
    if (s.cashImpact === false) return 'var(--text-secondary)';
    return Number(s.amount) > 0 ? 'var(--gain-color)' : Number(s.amount) < 0 ? 'var(--loss-color)' : 'var(--text-secondary)';
  };

  const TypeBadge = ({ op }) => {
    const s = op.std || {};
    const color = getOperationTypeColor(s.type || op.type);
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
        background: color.bg, color: color.text, whiteSpace: 'nowrap'
      }}>
        <span>{categoryOf(s.category).icon}</span>{s.label || op.type}
      </span>
    );
  };

  const primaryText = (op) => {
    const s = op.std || {};
    return s.instrumentName || s.description || s.label || op.type;
  };
  const secondaryText = (op) => {
    const s = op.std || {};
    const parts = [];
    if (s.instrumentName && s.description && s.description !== s.instrumentName) parts.push(s.description);
    if (s.isin) parts.push(s.isin);
    if (s.cashImpact === false) parts.push('securities, no cash');
    return parts.join(' · ');
  };
  const tradeText = (op) => {
    const s = op.std || {};
    if (s.category !== OPERATION_CATEGORIES.TRADES.key || !s.quantity) return '';
    return s.price ? `${formatNumber(s.quantity, 4)} @ ${formatNumber(s.price, 4)}` : formatNumber(s.quantity, 4);
  };

  const Details = ({ op }) => {
    const s = op.std || {};
    const items = [
      ['Trade date', formatDate(op.date)],
      ['Value date', formatDate(op.valueDate)],
      ['Bank', bankNameFor(op) || '—'],
      ['Account', accountLabelFor(op) || op.portfolioCode || '—'],
      ['Quantity', s.quantity != null ? formatNumber(s.quantity, 6) : null],
      ['Price', s.price != null ? formatNumber(s.price, 6) : null],
      ['Amount', formatAmount(s.amount, s.currency, { signed: true })],
      ['Fees', s.fees != null ? formatAmount(s.fees, s.currency) : null],
      ['Taxes', s.taxes != null ? formatAmount(s.taxes, s.currency) : null],
      ['Accrued interest', s.accruedInterest != null ? formatAmount(s.accruedInterest, s.currency) : null],
      ['FX rate', s.fxRate != null && s.fxRate !== 1 ? formatNumber(s.fxRate, 6) : null],
      ['Bank wording', s.bankTypeLabel || null],
      ['Bank code', s.bankTypeCode || null],
      ['Reference', s.reference || null],
      ['Source file', op.sourceFile || null]
    ].filter(([, v]) => v !== null && v !== undefined && v !== '');
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))',
        gap: '10px 16px',
        padding: '12px 14px',
        background: 'var(--bg-secondary)',
        borderRadius: '8px',
        margin: '4px 0 10px'
      }}>
        {s.description && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={muted}>Description</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>{s.description}</div>
          </div>
        )}
        {items.map(([label, value]) => (
          <div key={label} style={{ minWidth: 0 }}>
            <div style={muted}>{label}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>{value}</div>
          </div>
        ))}
      </div>
    );
  };

  const cardPayments = categoryStats[OPERATION_CATEGORIES.CARD_PAYMENTS.key];

  return (
    <div style={{ padding: isMobile ? '0.75rem' : '1.5rem' }}>
      <LiquidGlassCard style={{ background: theme === 'light' ? '#ffffff' : '#0f172a', backdropFilter: 'none' }}>
        <div style={{ padding: isMobile ? '1rem' : '1.5rem' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 400, color: 'var(--text-primary)' }}>
              Transactions <span style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>({visible.length})</span>
            </h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search instrument, ISIN, wording…"
                style={{
                  padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--border-color)',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.85rem',
                  width: isMobile ? '100%' : '260px', boxSizing: 'border-box'
                }}
              />
              <button
                onClick={exportExcel}
                disabled={visible.length === 0}
                style={{ ...chip(false), borderRadius: '8px', padding: '7px 12px', opacity: visible.length === 0 ? 0.5 : 1 }}
              >
                ⬇ Excel
              </button>
            </div>
          </div>

          {/* Period */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)} style={chip(period === p.key)}>{p.label}</button>
            ))}
            {period === 'CUSTOM' && (
              <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
                <span style={muted}>→</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }} />
              </span>
            )}
          </div>

          {/* Categories */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {OPERATION_CATEGORY_LIST.filter(c => categoryStats[c.key]).map(c => (
              <button key={c.key} onClick={() => toggleCategory(c.key)} style={chip(categories.has(c.key))}>
                {c.icon} {c.label} <span style={{ opacity: 0.75 }}>{categoryStats[c.key].count}</span>
              </button>
            ))}
          </div>
          {cardPayments && !categories.has(OPERATION_CATEGORIES.CARD_PAYMENTS.key) && (
            <div style={{ ...muted, marginTop: '-0.5rem', marginBottom: '1rem' }}>
              {cardPayments.count} card payment{cardPayments.count > 1 ? 's' : ''} hidden
              ({Object.entries(cardPayments.totals).map(([ccy, v]) => formatAmount(v, ccy, { signed: true })).join(', ')}) — tick “Card payments” to show them.
            </div>
          )}

          {/* Summary */}
          {summary.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${Math.min(summary.length, 3)}, minmax(0, 1fr))`, gap: '10px', marginBottom: '1.25rem' }}>
              {summary.map(([ccy, v]) => (
                <div key={ccy} style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '10px 12px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>{ccy}</div>
                  {[
                    ['Money in', v.inflows],
                    ['Money out', v.outflows],
                    ['Net flows', v.inflows + v.outflows],
                    ['Income', v.income],
                    ['Fees & taxes', v.feesTaxes]
                  ].filter(([, n]) => n).map(([label, n]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem', padding: '2px 0' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                      <span style={{ color: n > 0 ? 'var(--gain-color)' : n < 0 ? 'var(--loss-color)' : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatAmount(n, ccy, { signed: true })}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* List */}
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Loading transactions…</div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              No transactions for this period and filter.
            </div>
          ) : groups.map(([key, ops]) => (
            <div key={key} style={{ marginBottom: '1.25rem' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                borderBottom: '1px solid var(--border-color)', padding: '6px 2px', marginBottom: '4px'
              }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{key === 'unknown' ? 'No date' : monthLabel(key)}</span>
                <span style={muted}>{ops.length} transaction{ops.length > 1 ? 's' : ''}</span>
              </div>

              {ops.map(op => {
                const s = op.std || {};
                const open = expandedId === op.id;
                return (
                  <div key={op.id}>
                    <div
                      onClick={() => setExpandedId(open ? null : op.id)}
                      onMouseEnter={e => { e.currentTarget.style.background = rowHover; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      style={isMobile ? {
                        display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 10px',
                        padding: '10px 4px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer'
                      } : {
                        display: 'grid', gridTemplateColumns: '92px 170px minmax(0, 1fr) 170px 160px 18px',
                        alignItems: 'center', gap: '12px', padding: '9px 4px',
                        borderBottom: '1px solid var(--border-color)', cursor: 'pointer'
                      }}
                    >
                      {isMobile ? (
                        <>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <TypeBadge op={op} />
                            <span style={muted}>{formatDate(op.date)}</span>
                          </div>
                          <div style={{ textAlign: 'right', fontWeight: 600, color: amountColor(op), fontVariantNumeric: 'tabular-nums' }}>
                            {formatAmount(s.amount, s.currency, { signed: true })}
                          </div>
                          <div style={{ gridColumn: '1 / -1', fontSize: '0.88rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {primaryText(op)}
                          </div>
                          {(secondaryText(op) || tradeText(op)) && (
                            <div style={{ gridColumn: '1 / -1', ...muted }}>{[tradeText(op), secondaryText(op)].filter(Boolean).join(' · ')}</div>
                          )}
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatDate(op.date)}</span>
                          <span><TypeBadge op={op} /></span>
                          <span style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {primaryText(op)}
                            </div>
                            {secondaryText(op) && (
                              <div style={{ ...muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{secondaryText(op)}</div>
                            )}
                          </span>
                          <span style={{ ...muted, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{tradeText(op)}</span>
                          <span style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 600, color: amountColor(op), fontVariantNumeric: 'tabular-nums' }}>
                              {formatAmount(s.amount, s.currency, { signed: true })}
                            </div>
                            {s.fees ? <div style={muted}>fees {formatAmount(s.fees, s.currency)}</div> : null}
                          </span>
                          <span style={{ ...muted, textAlign: 'center' }}>{open ? '▴' : '▾'}</span>
                        </>
                      )}
                    </div>
                    {open && <Details op={op} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </LiquidGlassCard>
    </div>
  );
}
