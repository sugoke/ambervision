import React from 'react';
import { useDrop } from 'react-dnd';
import { DRAG, SLOT_ACCEPTS } from './labels.js';
import Chip from './Chip.jsx';

/**
 * A typed drop target. Accepts DRAG.CHIP but only allows chips whose class is
 * in the slot's role list — compatible hover shows green, incompatible red
 * (and the drop is rejected). When filled, renders the chip with its editor.
 */
export default function Slot({ role, chip, onDrop, onRemove, onChange, ctx, placeholder = 'drop here', filter }) {
  const accepts = SLOT_ACCEPTS[role] || [];
  const [{ isOver, canDrop }, drop] = useDrop({
    accept: DRAG.CHIP,
    canDrop: (item) => {
      if (!accepts.includes(item.chipClass)) return false;
      if (filter && !filter(item)) return false;
      return true;
    },
    drop: (item) => {
      // The chip object the palette/moved-chip carries. Palette items provide
      // `make()` results already materialized as `item.chip`.
      onDrop(item.chip);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop()
    })
  });

  if (chip) {
    return (
      <span ref={drop} style={{ display: 'inline-flex' }}>
        <Chip chip={chip} ctx={ctx} onChange={onChange} onRemove={onRemove} />
      </span>
    );
  }

  const border = isOver ? (canDrop ? '1px solid var(--gain-color)' : '1px solid var(--loss-color)') : '1px dashed var(--border-color)';
  const bg = isOver ? (canDrop ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)') : 'transparent';

  return (
    <span
      ref={drop}
      style={{
        display: 'inline-flex', alignItems: 'center', minWidth: '54px', minHeight: '22px',
        justifyContent: 'center', border, background: bg, borderRadius: '6px',
        padding: '1px 6px', fontSize: '0.72rem', color: 'var(--text-muted)'
      }}
    >
      {placeholder}
    </span>
  );
}
