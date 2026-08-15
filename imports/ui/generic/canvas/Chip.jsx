import React from 'react';
import { useDrag } from 'react-dnd';
import { DRAG } from './labels.js';
import { CHIP_CLASSES } from '/imports/api/genericProducts/canvas/canvasModel.js';
import InlineNumber from './InlineNumber.jsx';
import Slot from './Slot.jsx';

const TONE = {
  value: { bg: 'rgba(14,165,233,0.15)', fg: '#38bdf8', bd: 'rgba(14,165,233,0.4)' },
  number: { bg: 'rgba(148,163,184,0.15)', fg: '#cbd5e1', bd: 'rgba(148,163,184,0.4)' },
  levelRef: { bg: 'rgba(148,163,184,0.15)', fg: '#cbd5e1', bd: 'rgba(148,163,184,0.4)' },
  monitorSubject: { bg: 'rgba(14,165,233,0.15)', fg: '#38bdf8', bd: 'rgba(14,165,233,0.4)' },
  comparator: { bg: 'rgba(245,158,11,0.18)', fg: '#fbbf24', bd: 'rgba(245,158,11,0.45)' },
  action: { bg: 'rgba(16,185,129,0.15)', fg: '#34d399', bd: 'rgba(16,185,129,0.4)' },
  payoffLeg: { bg: 'rgba(20,184,166,0.15)', fg: '#2dd4bf', bd: 'rgba(20,184,166,0.4)' },
  raw: { bg: 'rgba(168,85,247,0.12)', fg: '#c084fc', bd: 'rgba(168,85,247,0.35)' }
};

function InlineSelect({ value, onChange, options }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '0.75rem', padding: '1px 2px' }}
    >
      {options.map(o => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

function chipClassOf(chip) {
  if (!chip) return 'value';
  if (chip.kind === 'group' || chip.kind === 'not') return 'logic';
  if (chip.strike !== undefined && chip.gearing !== undefined && chip.kind === undefined) return 'payoffLeg';
  return CHIP_CLASSES[chip.kind] || 'value';
}

function RateEditor({ rate, onChange, ctx }) {
  const mode = rate?.mode || 'fixed';
  const set = (patch) => onChange({ ...rate, ...patch });
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
      <InlineSelect
        value={mode}
        onChange={m => {
          if (m === 'fixed') onChange({ mode: 'fixed', value: 2.5 });
          else if (m === 'levelRef') onChange({ mode: 'levelRef', key: ctx.lineLevelKeys?.[0] || '' });
          else if (m === 'measure') onChange({ mode: 'measure', value: null, gearing: 1, spread: 0, floor: null, cap: null });
          else onChange({ mode: 'accrualFraction', base: { mode: 'fixed', value: 4 }, counterKey: ctx.counterKeys?.[0] || '' });
        }}
        options={[['fixed', 'fixed'], ['levelRef', 'line level'], ['measure', 'floating'], ['accrualFraction', '× days']]}
      />
      {mode === 'fixed' && <InlineNumber value={rate.value} onChange={v => set({ value: v })} suffix="%" />}
      {mode === 'levelRef' && <InlineSelect value={rate.key} onChange={k => set({ key: k })} options={(ctx.lineLevelKeys || []).length ? ctx.lineLevelKeys : ['']} />}
      {mode === 'measure' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          <InlineNumber value={rate.gearing} onChange={v => set({ gearing: v })} width={40} suffix="×" />
          <Slot role="rateMeasure" chip={rate.value} ctx={ctx} onDrop={c => set({ value: c })} onRemove={() => set({ value: null })} placeholder="measure" />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>+</span>
          <InlineNumber value={rate.spread} onChange={v => set({ spread: v })} width={40} suffix="%" />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>fl</span>
          <InlineNumber value={rate.floor} onChange={v => set({ floor: v })} width={36} />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>cap</span>
          <InlineNumber value={rate.cap} onChange={v => set({ cap: v })} width={36} />
        </span>
      )}
      {mode === 'accrualFraction' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          <InlineNumber value={rate.base?.value} onChange={v => set({ base: { mode: 'fixed', value: v } })} suffix="%" />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>× days in</span>
          <InlineSelect value={rate.counterKey} onChange={k => set({ counterKey: k })} options={(ctx.counterKeys || []).length ? ctx.counterKeys : ['']} />
        </span>
      )}
    </span>
  );
}

function SelectorEditor({ selector, onChange, ctx }) {
  const kind = selector?.kind || 'triggering';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
      <InlineSelect
        value={kind}
        onChange={k => onChange(k === 'triggering' ? { kind: 'triggering' } : { kind: 'valueChip', chip: null })}
        options={[['triggering', 'the triggering one'], ['valueChip', 'selected by']]}
      />
      {kind === 'valueChip' && (
        <Slot role="selectorTarget" chip={selector.chip} ctx={ctx} onDrop={c => onChange({ kind: 'valueChip', chip: c })} onRemove={() => onChange({ kind: 'valueChip', chip: null })} placeholder="value" />
      )}
    </span>
  );
}

// Renders the inner content of a chip based on kind. Exported so block
// components can reuse the exact same inline editors.
export function ChipBody({ chip, onChange, ctx }) {
  const set = (patch) => onChange({ ...chip, ...patch });
  const k = chip.kind;

  // payoff leg (no `kind`)
  if (k === undefined && chip.strike !== undefined) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
        <span>{chip.absolute ? '|x−' : ''}strike</span>
        <InlineNumber value={chip.strike} onChange={v => set({ strike: v })} width={44} />
        <span>gear</span>
        <InlineNumber value={chip.gearing} onChange={v => set({ gearing: v })} width={40} />
        <span>fl</span>
        <InlineNumber value={chip.floor} onChange={v => set({ floor: v })} width={36} />
        <span>cap</span>
        <InlineNumber value={chip.cap} onChange={v => set({ cap: v })} width={36} />
        <label style={{ fontSize: '0.72rem', display: 'inline-flex', gap: '2px' }}>
          <input type="checkbox" checked={!!chip.absolute} onChange={e => set({ absolute: e.target.checked })} />abs
        </label>
      </span>
    );
  }

  switch (k) {
    case 'underlying': {
      const u = (ctx.underlyings || []).find(x => x.id === chip.underlyingId);
      return <span>{u?.ticker || chip.underlyingId}</span>;
    }
    case 'worstOf':
    case 'bestOf':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          <span>{k === 'worstOf' ? 'Worst of' : 'Best of'}</span>
          <InlineSelect value={chip.universe} onChange={v => set({ universe: v })} options={['active', 'all', 'locked']} />
        </span>
      );
    case 'average':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          <span>Average</span>
          <InlineSelect value={chip.universe} onChange={v => set({ universe: v })} options={['active', 'all', 'locked']} />
          <InlineSelect value={chip.basis} onChange={v => set({ basis: v })} options={[['live', 'live'], ['lockedOrLive', 'locked/live']]} />
        </span>
      );
    case 'weightedBasket':
      return <span>Weighted basket</span>;
    case 'spread':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
          <Slot role="spreadInput" chip={chip.left} ctx={ctx} onDrop={c => set({ left: c })} onRemove={() => set({ left: null })} placeholder="A" />
          <span>−</span>
          <Slot role="spreadInput" chip={chip.right} ctx={ctx} onDrop={c => set({ right: c })} onRemove={() => set({ right: null })} placeholder="B" />
        </span>
      );
    case 'measureRef':
      return <span title="Advanced measure (read-only)">⚙ measure</span>;
    case 'number':
      return <InlineNumber value={chip.value} onChange={v => set({ value: v })} suffix="%" />;
    case 'levelRef':
      return <InlineSelect value={chip.key} onChange={key => set({ key })} options={(ctx.lineLevelKeys || []).length ? ctx.lineLevelKeys : ['']} />;
    case 'anyUnderlying': return <span>Any underlying</span>;
    case 'eachUnderlying': return <span>Each underlying</span>;
    case 'cmp': {
      const sym = { gte: '≥', gt: '>', lte: '≤', lt: '<' }[chip.op];
      return <InlineSelect value={chip.op} onChange={op => set({ op })} options={[['gte', '≥'], ['gt', '>'], ['lte', '≤'], ['lt', '<']]} />;
    }
    case 'payCoupon':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          <span>Pay</span>
          <RateEditor rate={chip.rate} onChange={r => set({ rate: r })} ctx={ctx} />
          <label style={{ fontSize: '0.72rem', display: 'inline-flex', gap: '2px' }}>
            <input type="checkbox" checked={!!chip.memory} onChange={e => set({ memory: e.target.checked })} />memory
          </label>
        </span>
      );
    case 'addToMemory':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          <span>Add to memory</span>
          <RateEditor rate={chip.rate} onChange={r => set({ rate: r })} ctx={ctx} />
        </span>
      );
    case 'call':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          <span>Call at</span>
          <RateEditor rate={chip.redemption} onChange={r => set({ redemption: r })} ctx={ctx} />
          <label style={{ fontSize: '0.72rem', display: 'inline-flex', gap: '2px' }}>
            <input type="checkbox" checked={!!chip.plusMemory} onChange={e => set({ plusMemory: e.target.checked })} />+memory
          </label>
        </span>
      );
    case 'knockIn': return <span>Knock in</span>;
    case 'lock':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          <span>Lock</span>
          <SelectorEditor selector={chip.selector} onChange={s => set({ selector: s })} ctx={ctx} />
          <span>at</span>
          <InlineSelect value={chip.lockValue?.mode || 'observed'} onChange={m => set({ lockValue: m === 'fixed' ? { mode: 'fixed', value: 100 } : { mode: 'observed' } })} options={[['observed', 'observed'], ['fixed', 'fixed']]} />
          {chip.lockValue?.mode === 'fixed' && <InlineNumber value={chip.lockValue.value} onChange={v => set({ lockValue: { mode: 'fixed', value: v } })} suffix="%" />}
        </span>
      );
    case 'eliminate':
      return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}><span>Eliminate</span><SelectorEditor selector={chip.selector} onChange={s => set({ selector: s })} ctx={ctx} /></span>;
    case 'flag':
      return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}><span>Flag</span><SelectorEditor selector={chip.selector} onChange={s => set({ selector: s })} ctx={ctx} /></span>;
    case 'raw':
      return <span title={JSON.stringify(chip.condition || chip.action)}>⚙ advanced</span>;
    default:
      return <span>{k}</span>;
  }
}

/**
 * A placed chip: draggable (to move between slots) with an inline editor body.
 */
export default function Chip({ chip, onChange, onRemove, ctx, draggable = true }) {
  const cls = chipClassOf(chip);
  const tone = TONE[cls] || TONE.value;
  const [{ isDragging }, drag] = useDrag({
    type: DRAG.CHIP,
    item: { chipClass: cls, chip, move: true },
    collect: m => ({ isDragging: m.isDragging() })
  });

  return (
    <span
      ref={draggable ? drag : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        background: tone.bg, border: `1px solid ${tone.bd}`, color: tone.fg,
        borderRadius: '6px', padding: '2px 6px', fontSize: '0.8rem',
        opacity: isDragging ? 0.4 : 1, cursor: draggable ? 'grab' : 'default'
      }}
    >
      <ChipBody chip={chip} onChange={onChange || (() => {})} ctx={ctx || {}} />
      {onRemove && (
        <span onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ cursor: 'pointer', opacity: 0.6, fontSize: '0.7rem' }}>✕</span>
      )}
    </span>
  );
}
