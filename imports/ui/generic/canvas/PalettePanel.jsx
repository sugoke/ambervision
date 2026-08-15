import React, { useState } from 'react';
import { useDrag } from 'react-dnd';
import { DRAG, PALETTE, LINE_LABELS, underlyingChips, GROUP_TONE } from './labels.js';

const TONE_BG = {
  blue: 'rgba(14,165,233,0.15)', amber: 'rgba(245,158,11,0.18)', gray: 'rgba(148,163,184,0.15)',
  green: 'rgba(16,185,129,0.15)', teal: 'rgba(20,184,166,0.15)'
};

function PaletteChip({ entry }) {
  const [{ isDragging }, drag] = useDrag({
    type: DRAG.CHIP,
    item: () => ({ chipClass: entry.chipClass, chip: entry.make() }),
    collect: m => ({ isDragging: m.isDragging() })
  });
  return (
    <div
      ref={drag}
      title={entry.label}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', marginBottom: '4px',
        background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px',
        fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'grab', opacity: isDragging ? 0.4 : 1
      }}
    >
      <span style={{ width: '16px', textAlign: 'center' }}>{entry.icon}</span>
      <span>{entry.label}</span>
    </div>
  );
}

function LineChip({ line }) {
  const [{ isDragging }, drag] = useDrag({
    type: DRAG.LINE,
    item: () => ({ lineType: line.id }),
    collect: m => ({ isDragging: m.isDragging() })
  });
  return (
    <div
      ref={drag}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', marginBottom: '4px',
        background: 'var(--bg-tertiary)', border: '1px solid var(--accent-color)', borderRadius: '6px',
        fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'grab', opacity: isDragging ? 0.4 : 1
      }}
    >
      <span style={{ width: '16px', textAlign: 'center' }}>{line.icon}</span>
      <span>{line.label}</span>
    </div>
  );
}

export default function PalettePanel({ underlyings }) {
  const [collapsed, setCollapsed] = useState({});
  const toggle = (g) => setCollapsed(c => ({ ...c, [g]: !c[g] }));

  const groups = PALETTE.map(g => {
    if (g.group === 'Values') {
      return { ...g, entries: [...underlyingChips(underlyings), ...g.entries] };
    }
    return g;
  });

  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px',
      padding: '0.75rem', position: 'sticky', top: '1rem', maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto'
    }}>
      <h4 style={{ margin: '0 0 0.6rem 0', color: 'var(--text-primary)', fontSize: '0.85rem' }}>Palette</h4>

      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Lines</div>
        {LINE_LABELS.map(l => <LineChip key={l.id} line={l} />)}
      </div>

      {groups.map(g => (
        <div key={g.group} style={{ marginBottom: '0.6rem' }}>
          <div
            onClick={() => toggle(g.group)}
            style={{
              fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer',
              color: 'var(--text-secondary)', marginBottom: '0.35rem', padding: '2px 4px',
              borderRadius: '4px', background: TONE_BG[GROUP_TONE[g.group]] || 'transparent'
            }}
          >
            {collapsed[g.group] ? '▸' : '▾'} {g.group}
          </div>
          {!collapsed[g.group] && g.entries.map(e => <PaletteChip key={e.id} entry={e} />)}
        </div>
      ))}
    </div>
  );
}
