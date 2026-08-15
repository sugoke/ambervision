import React from 'react';
import { useDrop } from 'react-dnd';
import { DRAG } from './labels.js';
import { ChipBody } from './Chip.jsx';
import { StatementRow } from './Block.jsx';

/**
 * A vertical stack of statement (action) blocks with a drop zone at the bottom
 * to append. `allow` restricts which action kinds may be dropped (monitors take
 * only state-mutating actions).
 */
export default function StatementStack({ actions, onChange, ctx, allow, placeholder = 'drop actions here' }) {
  const [{ isOver, canDrop }, drop] = useDrop({
    accept: DRAG.CHIP,
    canDrop: (item) => item.chipClass === 'action' && (!allow || allow.includes(item.chip.kind)),
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      onChange([...(actions || []), item.chip]);
    },
    collect: m => ({ isOver: m.isOver({ shallow: true }), canDrop: m.canDrop() })
  });

  const dropBorder = isOver ? (canDrop ? '2px dashed var(--gain-color)' : '2px dashed var(--loss-color)') : '2px dashed var(--border-color)';

  return (
    <div>
      {(actions || []).map((a, i) => (
        <StatementRow key={i} onRemove={() => onChange(actions.filter((_, j) => j !== i))}>
          <ChipBody chip={a} ctx={ctx} onChange={na => onChange(actions.map((x, j) => j === i ? na : x))} />
        </StatementRow>
      ))}
      <div
        ref={drop}
        style={{
          border: dropBorder, borderRadius: '8px', padding: '4px 8px',
          fontSize: '0.72rem', color: 'var(--text-muted)',
          background: isOver && canDrop ? 'rgba(16,185,129,0.08)' : 'transparent'
        }}
      >
        {placeholder}
      </div>
    </div>
  );
}
