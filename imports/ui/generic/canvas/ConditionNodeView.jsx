import React from 'react';
import { useDrop } from 'react-dnd';
import { DRAG } from './labels.js';
import Slot from './Slot.jsx';
import Chip from './Chip.jsx';

/**
 * Recursive condition editor. A `compare` node is three slots (value, comparator,
 * value/level). Dropping a Logic chip (AND/OR/NOT) onto a compare wraps it into
 * a group / negation. `null` = ALWAYS.
 */
export default function ConditionNodeView({ node, onChange, ctx, onRemove }) {
  // Wrap-on-logic-drop: accept a logic chip and transform the current node.
  const [{ isOver, canDrop }, drop] = useDrop({
    accept: DRAG.CHIP,
    canDrop: (item) => item.chipClass === 'logic',
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      const logic = item.chip;
      if (logic.kind === 'not') {
        onChange({ kind: 'not', child: node || { kind: 'always' } });
      } else {
        onChange({ kind: 'group', op: logic.op, children: [node || { kind: 'compare', left: null, op: 'gte', right: null }, { kind: 'compare', left: null, op: 'gte', right: null }] });
      }
    },
    collect: m => ({ isOver: m.isOver({ shallow: true }), canDrop: m.canDrop() })
  });

  const wrapStyle = {
    display: 'inline-flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap',
    padding: '2px', borderRadius: '6px',
    outline: isOver && canDrop ? '1px dashed var(--gain-color)' : 'none'
  };

  if (!node || node.kind === 'always') {
    return (
      <span ref={drop} style={wrapStyle}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>always</span>
      </span>
    );
  }

  if (node.kind === 'compare') {
    return (
      <span ref={drop} style={wrapStyle}>
        <Slot role="conditionLeft" chip={node.left} ctx={ctx} onDrop={c => onChange({ ...node, left: c })} onChange={c => onChange({ ...node, left: c })} onRemove={() => onChange({ ...node, left: null })} placeholder="value" />
        <Slot role="conditionOp" chip={node.op ? { kind: 'cmp', op: node.op } : null} ctx={ctx} onDrop={c => onChange({ ...node, op: c.op })} onChange={c => onChange({ ...node, op: c.op })} onRemove={() => onChange({ ...node, op: null })} placeholder="≥" />
        <Slot role="conditionRight" chip={node.right} ctx={ctx} onDrop={c => onChange({ ...node, right: c })} onChange={c => onChange({ ...node, right: c })} onRemove={() => onChange({ ...node, right: null })} placeholder="level" />
      </span>
    );
  }

  if (node.kind === 'group') {
    return (
      <span ref={drop} style={{ ...wrapStyle, border: '1px solid var(--border-color)' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>(</span>
        {(node.children || []).map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--neutral-color)' }}>{node.op.toUpperCase()}</span>}
            <ConditionNodeView
              node={child}
              ctx={ctx}
              onChange={nc => onChange({ ...node, children: node.children.map((c, j) => j === i ? nc : c) })}
              onRemove={() => onChange({ ...node, children: node.children.filter((_, j) => j !== i) })}
            />
          </React.Fragment>
        ))}
        <span onClick={() => onChange({ ...node, children: [...node.children, { kind: 'compare', left: null, op: 'gte', right: null }] })} style={{ cursor: 'pointer', fontSize: '0.72rem', color: 'var(--accent-color)' }}>＋</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>)</span>
      </span>
    );
  }

  if (node.kind === 'not') {
    return (
      <span ref={drop} style={{ ...wrapStyle, border: '1px solid var(--border-color)' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--loss-color)' }}>NOT</span>
        <ConditionNodeView node={node.child} ctx={ctx} onChange={nc => onChange({ ...node, child: nc })} />
      </span>
    );
  }

  if (node.kind === 'stateIs') {
    return (
      <span style={wrapStyle}>
        <Chip chip={node} ctx={ctx} draggable={false} onChange={onChange} onRemove={onRemove} />
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{node.register} is {node.expect ? 'true' : 'false'}</span>
      </span>
    );
  }

  if (node.kind === 'raw') {
    return <span style={wrapStyle}><Chip chip={node} ctx={ctx} draggable={false} onRemove={onRemove} /></span>;
  }

  return <span ref={drop} style={wrapStyle}>{node.kind}</span>;
}
