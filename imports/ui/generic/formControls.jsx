import React from 'react';

/**
 * Small shared form primitives for the generic product builder.
 * Styling uses the app's CSS variables so the page matches the rest of the UI.
 */

export const card = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: '10px',
  padding: '1.25rem',
  marginBottom: '1rem'
};

export const inputStyle = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  padding: '0.45rem 0.6rem',
  fontSize: '0.85rem',
  width: '100%',
  boxSizing: 'border-box'
};

export const labelStyle = {
  display: 'block',
  fontSize: '0.72rem',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: '0.3rem'
};

export function Section({ title, subtitle, children, actions }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: subtitle ? '0.25rem' : '0.9rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>{title}</h3>
        {actions}
      </div>
      {subtitle && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.9rem' }}>{subtitle}</div>
      )}
      {children}
    </div>
  );
}

export function Field({ label, children, width }) {
  return (
    <div style={{ marginBottom: '0.75rem', width: width || 'auto', minWidth: 0 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, disabled }) {
  return (
    <input
      type="text"
      style={{ ...inputStyle, opacity: disabled ? 0.6 : 1 }}
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
    />
  );
}

export function NumberInput({ value, onChange, placeholder, step, disabled }) {
  return (
    <input
      type="number"
      style={{ ...inputStyle, opacity: disabled ? 0.6 : 1 }}
      value={value ?? ''}
      placeholder={placeholder}
      step={step || 'any'}
      disabled={disabled}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

export function DateInput({ value, onChange, disabled }) {
  return (
    <input
      type="date"
      style={{ ...inputStyle, opacity: disabled ? 0.6 : 1, colorScheme: 'dark' }}
      value={value ?? ''}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
    />
  );
}

export function Select({ value, onChange, options, disabled }) {
  return (
    <select
      style={{ ...inputStyle, opacity: disabled ? 0.6 : 1 }}
      value={value ?? ''}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
    >
      {options.map(opt => {
        const [v, label] = Array.isArray(opt) ? opt : [opt, opt];
        return <option key={v} value={v}>{label}</option>;
      })}
    </select>
  );
}

export function Checkbox({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Btn({ onClick, children, tone = 'default', small, disabled, title }) {
  const tones = {
    default: { background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' },
    primary: { background: 'var(--accent-color)', color: '#fff', border: '1px solid var(--accent-color)' },
    success: { background: 'var(--success-color)', color: '#fff', border: '1px solid var(--success-color)' },
    danger: { background: 'transparent', color: 'var(--danger-color)', border: '1px solid var(--danger-color)' }
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...tones[tone],
        borderRadius: '6px',
        padding: small ? '0.25rem 0.6rem' : '0.5rem 1rem',
        fontSize: small ? '0.75rem' : '0.85rem',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1
      }}
    >
      {children}
    </button>
  );
}

const BADGE_TONES = {
  green: { background: 'rgba(16,185,129,0.15)', color: 'var(--gain-color)' },
  amber: { background: 'rgba(245,158,11,0.15)', color: 'var(--warning-color)' },
  red: { background: 'rgba(239,68,68,0.15)', color: 'var(--loss-color)' },
  blue: { background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' },
  purple: { background: 'rgba(168,85,247,0.15)', color: '#a855f7' },
  gray: { background: 'rgba(148,163,184,0.15)', color: 'var(--neutral-color)' }
};

export function Badge({ tone = 'gray', children }) {
  const t = BADGE_TONES[tone] || BADGE_TONES.gray;
  return (
    <span style={{
      ...t, borderRadius: '999px', padding: '0.15rem 0.6rem',
      fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block'
    }}>
      {children}
    </span>
  );
}

export const thStyle = {
  textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.72rem', fontWeight: 600,
  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em',
  borderBottom: '1px solid var(--border-color)'
};

export const tdStyle = {
  padding: '0.5rem 0.6rem', fontSize: '0.85rem', color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border-color)', verticalAlign: 'top'
};

export function Row({ children, gap = '0.75rem', wrap }) {
  return (
    <div style={{ display: 'flex', gap, flexWrap: wrap ? 'wrap' : 'nowrap', alignItems: 'flex-end' }}>
      {children}
    </div>
  );
}
