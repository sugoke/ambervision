import React from 'react';

/**
 * Visual block primitives for the Scratch-style canvas.
 *
 * - CBlock: a C-shaped container (loop, IF, AT MATURITY…) with a colored left
 *   rail, a header row, and an indented body that holds child blocks.
 * - StatementRow: a single stacked statement block (an action) with a notch.
 *
 * Colors match the Chip tones so palette chips and placed blocks read as one
 * system.
 */

export const CATEGORY = {
  loop: { rail: '#a855f7', bg: 'rgba(168,85,247,0.10)', bd: 'rgba(168,85,247,0.35)' },
  rule: { rail: 'var(--warning-color)', bg: 'rgba(245,158,11,0.10)', bd: 'rgba(245,158,11,0.35)' },
  monitor: { rail: '#0ea5e9', bg: 'rgba(14,165,233,0.10)', bd: 'rgba(14,165,233,0.35)' },
  count: { rail: '#f97316', bg: 'rgba(249,115,22,0.10)', bd: 'rgba(249,115,22,0.35)' },
  final: { rail: '#14b8a6', bg: 'rgba(20,184,166,0.10)', bd: 'rgba(20,184,166,0.35)' },
  action: { rail: 'var(--gain-color)', bg: 'rgba(16,185,129,0.14)', bd: 'rgba(16,185,129,0.4)' }
};

const kw = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.03em' };
export const KW = kw;

/**
 * A C-shaped container block.
 */
export function CBlock({ category = 'rule', title, icon, headerRight, header, children, onRemove, indent = true }) {
  const c = CATEGORY[category] || CATEGORY.rule;
  return (
    <div style={{
      position: 'relative',
      background: c.bg,
      border: `1px solid ${c.bd}`,
      borderLeft: `5px solid ${c.rail}`,
      borderRadius: '10px',
      padding: '0.6rem 0.7rem',
      marginBottom: '0.6rem'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: children ? '0.5rem' : 0 }}>
        {(icon || title) && (
          <strong style={{ color: 'var(--text-primary)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
            {icon} {title}
          </strong>
        )}
        {header}
        <div style={{ flex: 1 }} />
        {headerRight}
        {onRemove && (
          <span onClick={onRemove} title="Remove block" style={{ cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.75rem' }}>✕</span>
        )}
      </div>
      {children && (
        <div style={{ paddingLeft: indent ? '0.85rem' : 0, borderLeft: indent ? `2px dotted ${c.bd}` : 'none' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A stacked statement block (an action). Notched, full-width row.
 */
export function StatementRow({ children, onRemove, dragRef, isDragging }) {
  const c = CATEGORY.action;
  return (
    <div
      ref={dragRef}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
        background: c.bg, border: `1px solid ${c.bd}`, borderLeft: `5px solid ${c.rail}`,
        borderRadius: '8px', padding: '4px 8px', marginBottom: '4px',
        opacity: isDragging ? 0.4 : 1, cursor: dragRef ? 'grab' : 'default'
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>{children}</div>
      {onRemove && <span onClick={onRemove} style={{ cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.72rem' }}>✕</span>}
    </div>
  );
}
