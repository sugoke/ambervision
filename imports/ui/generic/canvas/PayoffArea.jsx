import React from 'react';
import { useDrop } from 'react-dnd';
import { DRAG } from './labels.js';
import Chip from './Chip.jsx';
import InlineNumber from './InlineNumber.jsx';

/**
 * Redemption payoff: a base % plus participation/absolute legs. Dropping a
 * payoff-leg chip appends a leg (each leg carries its own strike/gearing/
 * floor/cap/absolute inline).
 */
export default function PayoffArea({ payoff, onChange, ctx }) {
  const [{ isOver, canDrop }, drop] = useDrop({
    accept: DRAG.CHIP,
    canDrop: (item) => item.chipClass === 'payoffLeg',
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      onChange({ ...payoff, legs: [...(payoff.legs || []), item.chip] });
    },
    collect: m => ({ isOver: m.isOver({ shallow: true }), canDrop: m.canDrop() })
  });

  const border = isOver ? (canDrop ? '1px solid var(--gain-color)' : '1px solid var(--loss-color)') : '1px dashed var(--border-color)';

  return (
    <span ref={drop} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', border, borderRadius: '6px', padding: '2px 6px' }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>base</span>
      <InlineNumber value={payoff.base} onChange={v => onChange({ ...payoff, base: v ?? 0 })} suffix="%" />
      {(payoff.legs || []).map((leg, i) => (
        <React.Fragment key={i}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>+</span>
          <Chip
            chip={leg}
            ctx={ctx}
            draggable={false}
            onChange={nl => onChange({ ...payoff, legs: payoff.legs.map((x, j) => j === i ? nl : x) })}
            onRemove={() => onChange({ ...payoff, legs: payoff.legs.filter((_, j) => j !== i) })}
          />
        </React.Fragment>
      ))}
    </span>
  );
}
