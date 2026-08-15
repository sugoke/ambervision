// Shared type scale and building blocks for the PMS mobile card layouts.
// Deliberately larger than the desktop tables: this view is read on a phone,
// often by clients rather than by RMs, so the floor is 12px for labels and
// ~20px for the figure that matters.

export const POSITIVE = '#10b981';
export const NEGATIVE = '#ef4444';

export const S = {
  name: '1.0625rem',      // 17px - card title
  isin: '0.8125rem',      // 13px - identifier / monospace
  label: '0.75rem',       // 12px - field label
  figure: '1.25rem',      // 20px - headline number
  value: '0.9375rem',     // 15px - detail value
  secondary: '0.875rem'   // 14px - secondary line under a figure
};

export const labelStyle = {
  fontSize: S.label,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  marginBottom: '0.125rem'
};

// Headline figure row: small label on the left, large number right-aligned.
// Giving each figure the full card width is what stops long amounts from
// wrapping and orphaning the currency symbol onto its own line.
export const headlineRowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '0.75rem'
};

export const cardStyle = (theme, isActive = false) => ({
  border: '1px solid var(--border-color)',
  borderRadius: '10px',
  background: isActive
    ? (theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)')
    : 'var(--bg-secondary)',
  padding: '1rem'
});

// Divider used between a card's header and its figures
export const dividerStyle = {
  marginTop: '0.75rem',
  paddingTop: '0.75rem',
  borderTop: '1px solid var(--border-color)'
};
