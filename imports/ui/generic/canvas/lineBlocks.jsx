import React, { useState } from 'react';
import { NumberInput, DateInput, Select, TextInput, Checkbox, Btn } from '../formControls.jsx';
import { newId } from '/imports/api/genericProducts/canvas/canvasModel.js';
import { addByUnit, loopStep, loopEnd, loopCount, FREQUENCY_UNITS } from '/imports/api/genericProducts/canvas/frequency.js';
import { CBlock, KW } from './Block.jsx';
import RuleBlock from './RuleBlock.jsx';
import StatementStack from './StatementStack.jsx';
import ConditionNodeView from './ConditionNodeView.jsx';
import PayoffArea from './PayoffArea.jsx';
import Slot from './Slot.jsx';
import InlineNumber from './InlineNumber.jsx';

const STATE_ACTIONS = ['knockIn', 'lock', 'eliminate', 'flag'];

function round2(x) { return Math.round(x * 100) / 100; }

const PREVIEW_CAP = 40; // don't render hundreds of date rows for daily loops

const fieldBox = (w) => ({ display: 'inline-block', width: w });

function RulesArea({ rules, onChange, ctx }) {
  return (
    <div>
      {(rules || []).map((s, i) => (
        <RuleBlock
          key={s.id || i}
          sentence={s}
          ctx={ctx}
          onChange={ns => onChange(rules.map((x, j) => j === i ? ns : x))}
          onRemove={() => onChange(rules.filter((_, j) => j !== i))}
        />
      ))}
      <Btn small onClick={() => onChange([...(rules || []), { id: newId('s'), label: '', condition: null, actions: [], elseActions: [] }])}>＋ IF rule</Btn>
    </div>
  );
}

// ---------------------------------------------------------------- Loop
export function LoopBlock({ line, onChange, onRemove, baseCtx }) {
  const [showRows, setShowRows] = useState(false);
  const set = (patch) => onChange({ ...line, ...patch });
  const columns = line.columns || [];
  const ctx = { ...baseCtx, lineLevelKeys: columns.map(c => c.key).filter(Boolean) };
  const setCol = (i, patch) => set({ columns: columns.map((c, j) => j === i ? { ...c, ...patch } : c) });
  const cellValue = (col, i) => {
    const ov = col.overrides ? col.overrides[i] : undefined;
    return ov !== undefined && ov !== null ? ov : round2((col.initial || 0) - (col.stepPerPeriod || 0) * i);
  };

  const step = loopStep(line);
  const fallbackEnd = baseCtx.finalObservationDate;
  const periods = loopCount(line, fallbackEnd);
  const endValue = line.until || loopEnd(line, fallbackEnd) || '';
  // Changing the cadence (frequency, unit, start date) re-derives all
  // observation dates, so any per-period holiday overrides no longer apply —
  // clear them so the schedule stays a faithful reflection of the loop.
  const resetCadence = { dateOverrides: {}, paymentDateOverrides: {}, frequencyMonths: undefined, count: undefined };
  const header = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
      <span style={KW}>every</span>
      <span style={fieldBox('50px')}><NumberInput value={step.n} onChange={v => set({ frequencyN: v, frequencyUnit: step.unit, ...resetCadence, until: endValue })} /></span>
      <span style={fieldBox('95px')}>
        <Select value={step.unit} options={FREQUENCY_UNITS} onChange={v => set({ frequencyUnit: v, frequencyN: step.n, ...resetCadence, until: endValue })} />
      </span>
      <span style={KW}>from</span>
      <span style={fieldBox('140px')}><DateInput value={line.firstObservation} onChange={v => set({ firstObservation: v, ...resetCadence, until: endValue })} /></span>
      <span style={KW}>until</span>
      <span style={fieldBox('140px')}><DateInput value={endValue} onChange={v => set({ until: v, count: undefined })} /></span>
      <span style={KW}>pay +</span>
      <span style={fieldBox('48px')}><NumberInput value={line.paymentLagDays} onChange={v => set({ paymentLagDays: v })} /></span>
      <span style={KW}>d</span>
      <span style={{ ...KW, color: 'var(--accent-color)' }}>→ {periods} obs</span>
    </span>
  );

  return (
    <CBlock category="loop" icon="🔁" title="LOOP" header={header} onRemove={onRemove}>
      <div style={{ marginBottom: '0.5rem' }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Level columns (the step-down ladder)</div>
        {columns.map((col, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '0.75rem', marginBottom: '0.3rem' }}>
            <span style={fieldBox('120px')}><TextInput value={col.key} onChange={v => setCol(i, { key: v })} /></span>
            <span style={KW}>init</span>
            <InlineNumber value={col.initial} onChange={v => setCol(i, { initial: v })} />
            <span style={KW}>step−</span>
            <InlineNumber value={col.stepPerPeriod} onChange={v => setCol(i, { stepPerPeriod: v })} width={44} />
            <Btn small onClick={() => setCol(i, { stepPerPeriod: 0, overrides: {} })} title="Same on every row">same</Btn>
            <Btn small tone="danger" onClick={() => set({ columns: columns.filter((_, j) => j !== i) })}>✕</Btn>
          </span>
        ))}
        <div style={{ marginTop: '0.2rem' }}>
          <Btn small onClick={() => set({ columns: [...columns, { key: `level${columns.length + 1}`, initial: 100, stepPerPeriod: 0, overrides: {} }] })}>＋ column</Btn>
          {columns.length > 0 && periods > 0 && <Btn small onClick={() => setShowRows(s => !s)}>{showRows ? 'hide rows' : 'preview rows'}</Btn>}
        </div>
        {showRows && columns.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '0.4rem', fontSize: '0.78rem' }}>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ padding: '2px 6px', color: 'var(--text-muted)' }}>#</th><th style={{ padding: '2px 6px', color: 'var(--text-muted)' }}>obs</th>{columns.map(c => <th key={c.key} style={{ padding: '2px 6px', color: 'var(--text-muted)' }}>{c.key}</th>)}</tr></thead>
              <tbody>
                {Array.from({ length: Math.min(periods, PREVIEW_CAP) }).map((_, i) => (
                  <tr key={i}>
                    <td style={{ padding: '2px 6px', color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td style={{ padding: '2px 6px' }}>{addByUnit(line.firstObservation, step.unit, i * step.n)}</td>
                    {columns.map((col, ci) => (
                      <td key={ci} style={{ padding: '2px 6px' }}><InlineNumber value={cellValue(col, i)} onChange={v => setCol(ci, { overrides: { ...(col.overrides || {}), [i]: v } })} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {periods > PREVIEW_CAP && (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.2rem' }}>
                Showing first {PREVIEW_CAP} of {periods} — edit the full list in the Schedule tab.
              </div>
            )}
          </div>
        )}
      </div>
      <RulesArea rules={line.rules} ctx={ctx} onChange={r => set({ rules: r })} />
    </CBlock>
  );
}

// ---------------------------------------------------------------- Single
export function SingleBlock({ line, onChange, onRemove, baseCtx }) {
  const set = (patch) => onChange({ ...line, ...patch });
  const levels = line.levels || {};
  const ctx = { ...baseCtx, lineLevelKeys: Object.keys(levels) };
  const header = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
      <span style={KW}>observe</span>
      <span style={fieldBox('140px')}><DateInput value={line.observationDate} onChange={v => set({ observationDate: v })} /></span>
      <span style={KW}>pay</span>
      <span style={fieldBox('140px')}><DateInput value={line.paymentDate} onChange={v => set({ paymentDate: v })} /></span>
    </span>
  );
  return (
    <CBlock category="loop" icon="📅" title="OBSERVE" header={header} onRemove={onRemove}>
      <div style={{ marginBottom: '0.4rem' }}>
        {Object.entries(levels).map(([k, v]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '0.75rem' }}>
            <span style={fieldBox('120px')}><TextInput value={k} onChange={nk => { const nl = { ...levels }; delete nl[k]; nl[nk] = v; set({ levels: nl }); }} /></span>
            <InlineNumber value={v} onChange={nv => set({ levels: { ...levels, [k]: nv } })} />
            <Btn small tone="danger" onClick={() => { const nl = { ...levels }; delete nl[k]; set({ levels: nl }); }}>✕</Btn>
          </span>
        ))}
        <Btn small onClick={() => set({ levels: { ...levels, [`level${Object.keys(levels).length + 1}`]: 100 } })}>＋ level</Btn>
      </div>
      <RulesArea rules={line.rules} ctx={ctx} onChange={r => set({ rules: r })} />
    </CBlock>
  );
}

// ---------------------------------------------------------------- Any-day
export function AnyDayBlock({ line, onChange, onRemove, baseCtx }) {
  const set = (patch) => onChange({ ...line, ...patch });
  const ctx = { ...baseCtx, lineLevelKeys: [] };
  const header = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
      <span style={KW}>from</span>
      <span style={fieldBox('130px')}><Select value={line.window?.from} options={['valueDate', 'tradeDate']} onChange={v => set({ window: { ...line.window, from: v } })} /></span>
      <span style={KW}>to</span>
      <span style={fieldBox('165px')}><Select value={line.window?.to} options={['finalObservationDate', 'maturityDate']} onChange={v => set({ window: { ...line.window, to: v } })} /></span>
      <Checkbox checked={line.once !== false} label="once" onChange={v => set({ once: v })} />
    </span>
  );
  return (
    <CBlock category="monitor" icon="📉" title="ANY DAY" header={header} onRemove={onRemove}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <span style={KW}>IF</span>
        <Slot role="anyDaySubject" chip={line.subject} ctx={ctx} onDrop={c => set({ subject: c })} onChange={c => set({ subject: c })} onRemove={() => set({ subject: null })} placeholder="subject" />
        <span style={fieldBox('130px')}><Select value={line.comparison} options={[['touchesBelow', 'touches below'], ['touchesAbove', 'touches above']]} onChange={v => set({ comparison: v })} /></span>
        <InlineNumber value={line.level} onChange={v => set({ level: v })} suffix="%" />
      </div>
      <div style={{ ...KW, marginBottom: '0.25rem' }}>THEN</div>
      <StatementStack actions={line.actions} ctx={ctx} onChange={a => set({ actions: a })} allow={STATE_ACTIONS} placeholder="drop state actions (knock in, lock…)" />
    </CBlock>
  );
}

// ---------------------------------------------------------------- Count
export function CountBlock({ line, onChange, onRemove, baseCtx }) {
  const set = (patch) => onChange({ ...line, ...patch });
  const ctx = { ...baseCtx, lineLevelKeys: [] };
  const header = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
      <span style={KW}>from</span>
      <span style={fieldBox('130px')}><Select value={line.window?.from} options={['valueDate', 'tradeDate']} onChange={v => set({ window: { ...line.window, from: v } })} /></span>
      <span style={KW}>to</span>
      <span style={fieldBox('165px')}><Select value={line.window?.to} options={['finalObservationDate', 'maturityDate']} onChange={v => set({ window: { ...line.window, to: v } })} /></span>
    </span>
  );
  return (
    <CBlock category="count" icon="🔢" title="COUNT DAYS" header={header} onRemove={onRemove}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={KW}>where</span>
        <Slot role="anyDaySubject" chip={line.subject} ctx={ctx} onDrop={c => set({ subject: c })} onChange={c => set({ subject: c })} onRemove={() => set({ subject: null })} placeholder="rate" />
        <span style={KW}>in [</span>
        <InlineNumber value={line.range?.low} onChange={v => set({ range: { ...line.range, low: v } })} />
        <span style={KW}>,</span>
        <InlineNumber value={line.range?.high} onChange={v => set({ range: { ...line.range, high: v } })} />
        <span style={KW}>] → counter</span>
        <span style={fieldBox('130px')}><TextInput value={line.counterKey} onChange={v => set({ counterKey: v })} /></span>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Reference this counter from a "Pay coupon → × days" rate.</div>
    </CBlock>
  );
}

// ---------------------------------------------------------------- Final
export function FinalBlock({ line, onChange, onRemove, baseCtx }) {
  const set = (patch) => onChange({ ...line, ...patch });
  const ctx = { ...baseCtx, lineLevelKeys: [] };
  const branches = line.branches || [];
  const setBranch = (i, patch) => set({ branches: branches.map((b, j) => j === i ? { ...b, ...patch } : b) });
  const header = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={KW}>on</span>
      <Slot role="payoffMeasure" chip={line.inputValue} ctx={ctx} onDrop={c => set({ inputValue: c })} onChange={c => set({ inputValue: c })} onRemove={() => set({ inputValue: null })} placeholder="input value" />
      <Checkbox checked={!!line.plusMemory} label="+ memory" onChange={v => set({ plusMemory: v })} />
    </span>
  );
  return (
    <CBlock category="final" icon="🏁" title="AT MATURITY" header={header} onRemove={onRemove}>
      {branches.map((b, i) => {
        const isOtherwise = b.condition === null;
        return (
          <div key={b.id || i} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', padding: '3px 0' }}>
            {isOtherwise ? <span style={KW}>OTHERWISE</span> : (
              <>
                <span style={KW}>IF</span>
                <ConditionNodeView node={b.condition} ctx={ctx} onChange={c => setBranch(i, { condition: c })} />
              </>
            )}
            <span style={KW}>→ redeem</span>
            <PayoffArea payoff={b.payoff} ctx={ctx} onChange={p => setBranch(i, { payoff: p })} />
            {branches.length > 1 && <span onClick={() => set({ branches: branches.filter((_, j) => j !== i) })} style={{ cursor: 'pointer', color: 'var(--danger-color)', fontSize: '0.72rem' }}>✕</span>}
          </div>
        );
      })}
      <Btn small onClick={() => {
        const idx = branches.length > 0 && branches[branches.length - 1].condition === null ? branches.length - 1 : branches.length;
        const next = [...branches];
        next.splice(idx, 0, { id: newId('br'), condition: { kind: 'compare', left: null, op: 'gte', right: null }, payoff: { base: 100, legs: [] } });
        set({ branches: next });
      }}>＋ branch</Btn>
    </CBlock>
  );
}

export const LINE_BLOCKS = {
  loop: LoopBlock,
  single: SingleBlock,
  anyDay: AnyDayBlock,
  count: CountBlock,
  final: FinalBlock
};
