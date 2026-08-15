import React, { useMemo } from 'react';
import { validateDefinition } from '/imports/api/genericProducts/definitionSchema.js';

/**
 * Read-only view of the composed definition with live validation.
 * The definition IS the product — this panel shows exactly what will be saved.
 */
export default function JsonPreviewPanel({ definition }) {
  const { errors, warnings } = useMemo(() => validateDefinition(definition), [definition]);

  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
      borderRadius: '10px', padding: '1rem', position: 'sticky', top: '1rem',
      maxHeight: 'calc(100vh - 2rem)', display: 'flex', flexDirection: 'column'
    }}>
      <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
        Definition (read-only)
      </h4>

      {errors.length > 0 && (
        <div style={{ marginBottom: '0.5rem' }}>
          {errors.map((e, i) => (
            <div key={i} style={{ fontSize: '0.75rem', color: 'var(--danger-color)', marginBottom: '0.2rem' }}>✕ {e}</div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div style={{ marginBottom: '0.5rem' }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: '0.75rem', color: 'var(--warning-color)', marginBottom: '0.2rem' }}>⚠ {w}</div>
          ))}
        </div>
      )}
      {errors.length === 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--success-color)', marginBottom: '0.5rem' }}>✓ Definition is valid</div>
      )}

      <pre style={{
        margin: 0, flex: 1, overflow: 'auto', fontSize: '0.68rem', lineHeight: 1.45,
        color: 'var(--text-secondary)', background: 'var(--bg-tertiary)',
        borderRadius: '6px', padding: '0.6rem'
      }}>
        {JSON.stringify(definition, null, 2)}
      </pre>
    </div>
  );
}
