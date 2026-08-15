import React from 'react';

/**
 * Small inline number input for chip parameters (barrier levels, rates, etc.).
 * Kept visually tight so chips read like a sentence.
 */
export default function InlineNumber({ value, onChange, suffix, width = 56, placeholder }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '1px' }}>
      <input
        type="number"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: `${width}px`,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          color: 'var(--text-primary)',
          padding: '1px 4px',
          fontSize: '0.78rem',
          textAlign: 'right'
        }}
      />
      {suffix && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{suffix}</span>}
    </span>
  );
}
