import React from 'react';
import { CBlock, KW } from './Block.jsx';
import ConditionNodeView from './ConditionNodeView.jsx';
import StatementStack from './StatementStack.jsx';

/**
 * An IF rule as a C-block: a condition socket in the header, a THEN arm holding
 * a statement stack, and an optional OTHERWISE arm. Drop a Logic chip (AND/OR/
 * NOT) onto the condition to wrap it; drop actions into the arms.
 */
export default function RuleBlock({ sentence, onChange, onRemove, ctx }) {
  const set = (patch) => onChange({ ...sentence, ...patch });
  const hasElse = (sentence.elseActions || []).length > 0 || sentence._showElse;

  return (
    <CBlock
      category="rule"
      icon="◆"
      title="IF"
      header={<ConditionNodeView node={sentence.condition} ctx={ctx} onChange={c => set({ condition: c })} onRemove={() => set({ condition: null })} />}
      onRemove={onRemove}
    >
      <div style={{ marginBottom: '0.4rem' }}>
        <div style={{ ...KW, marginBottom: '0.25rem' }}>THEN</div>
        <StatementStack actions={sentence.actions} ctx={ctx} onChange={a => set({ actions: a })} placeholder="drop actions here" />
      </div>
      {hasElse ? (
        <div>
          <div style={{ ...KW, marginBottom: '0.25rem' }}>OTHERWISE</div>
          <StatementStack actions={sentence.elseActions} ctx={ctx} onChange={a => set({ elseActions: a })} placeholder="drop else-actions here" />
        </div>
      ) : (
        <span onClick={() => set({ _showElse: true })} style={{ fontSize: '0.72rem', color: 'var(--accent-color)', cursor: 'pointer' }}>+ otherwise</span>
      )}
    </CBlock>
  );
}
