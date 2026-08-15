import React from 'react';
import { useDrop } from 'react-dnd';
import { DRAG } from './labels.js';
import { newId } from '/imports/api/genericProducts/canvas/canvasModel.js';
import { LINE_BLOCKS } from './lineBlocks.jsx';
import { Btn } from '../formControls.jsx';

function makeLine(lineType) {
  const id = newId('ln');
  switch (lineType) {
    case 'loop':
      return { id, lineType: 'loop', firstObservation: '', frequencyUnit: 'month', frequencyN: 3, until: '', paymentLagDays: 7, columns: [], rules: [], dateOverrides: {}, paymentDateOverrides: {} };
    case 'single':
      return { id, lineType: 'single', observationDate: '', paymentDate: '', levels: {}, rules: [] };
    case 'anyDay':
      return { id, lineType: 'anyDay', window: { from: 'valueDate', to: 'finalObservationDate' }, subject: null, comparison: 'touchesBelow', level: 65, once: true, actions: [] };
    case 'count':
      return { id, lineType: 'count', window: { from: 'valueDate', to: 'finalObservationDate' }, subject: null, range: { low: 1, high: 4.5 }, counterKey: `accrual${id}` };
    case 'final':
      return { id, lineType: 'final', inputValue: null, plusMemory: false, branches: [{ id: newId('br'), condition: null, payoff: { base: 100, legs: [] } }] };
    default:
      return null;
  }
}

const LINE_ORDER = { loop: 0, single: 0, anyDay: 1, count: 1, final: 2 };
const sortLines = (arr) => arr.slice().sort((a, b) => (LINE_ORDER[a.lineType] - LINE_ORDER[b.lineType]));

/**
 * The large block workspace: top-level line blocks (loop, any-day, count, at
 * maturity) live here; you compose each by dragging value/comparison/action
 * blocks into their sockets and arms. Drop a line label to add a top-level block.
 */
export default function BlockCanvas({ lines, onChange, underlyings, finalObservationDate }) {
  const counterKeys = lines.filter(l => l.lineType === 'count').map(l => l.counterKey).filter(Boolean);
  const baseCtx = { underlyings, counterKeys, finalObservationDate };

  const [{ isOver, canDrop }, drop] = useDrop({
    accept: DRAG.LINE,
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      const line = makeLine(item.lineType);
      if (line) onChange(sortLines([...lines, line]));
    },
    collect: m => ({ isOver: m.isOver(), canDrop: m.canDrop() })
  });

  const setLine = (i, nl) => onChange(lines.map((l, j) => j === i ? nl : l));
  const removeLine = (i) => onChange(lines.filter((_, j) => j !== i));
  const addLine = (t) => onChange(sortLines([...lines, makeLine(t)]));

  return (
    <div
      ref={drop}
      style={{
        background: isOver && canDrop ? 'rgba(16,185,129,0.05)' : 'var(--bg-primary)',
        backgroundImage: 'radial-gradient(var(--border-color) 0.5px, transparent 0.5px)',
        backgroundSize: '18px 18px',
        border: `1px solid ${isOver && canDrop ? 'var(--gain-color)' : 'var(--border-color)'}`,
        borderRadius: '12px', padding: '1rem', minHeight: '360px'
      }}
    >
      {lines.map((line, i) => {
        const C = LINE_BLOCKS[line.lineType];
        if (!C) return null;
        return <C key={line.id} line={line} baseCtx={baseCtx} onChange={nl => setLine(i, nl)} onRemove={() => removeLine(i)} />;
      })}

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Drag a line from the palette, or add:</span>
        <Btn small onClick={() => addLine('loop')}>🔁 Loop</Btn>
        <Btn small onClick={() => addLine('single')}>📅 Observation</Btn>
        <Btn small onClick={() => addLine('anyDay')}>📉 Any-day</Btn>
        <Btn small onClick={() => addLine('count')}>🔢 Count-days</Btn>
        <Btn small onClick={() => addLine('final')}>🏁 At maturity</Btn>
      </div>
    </div>
  );
}
