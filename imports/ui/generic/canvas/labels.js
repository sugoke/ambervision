/**
 * Palette definition for the drag-and-drop builder. Pure data + tiny chip
 * factories. Everything a user can drag lives here; the canvas model shapes
 * (canvasModel.js) are what the factories produce and what compile.js consumes.
 */

// react-dnd drag types. All chips share ONE type so a slot can accept the type
// and reject by chipClass in canDrop() — that is what lets an incompatible
// hover show red rather than never firing isOver.
export const DRAG = {
  CHIP: 'gen/chip',
  LINE: 'gen/line'
};

// Slot role -> accepted chip classes (see canvasModel CHIP_CLASSES).
export const SLOT_ACCEPTS = {
  conditionLeft: ['value'],
  conditionOp: ['comparator'],
  conditionRight: ['number', 'levelRef'],
  anyDaySubject: ['value', 'monitorSubject'],
  monitorLevel: ['number'],
  monitorActions: ['action'],       // filtered further to state-mutating actions in UI
  ruleActions: ['action'],
  payoffMeasure: ['value'],
  payoffLegs: ['payoffLeg'],
  selectorTarget: ['value'],
  spreadInput: ['value'],
  rateMeasure: ['value']
};

// ---- chip factories (ctx = { underlyings }) ----
const value = (chip) => chip;

export const PALETTE = [
  {
    group: 'Values',
    color: 'blue',
    // Per-underlying chips are injected dynamically (see underlyingChips()).
    entries: [
      { id: 'worstOf', chipClass: 'value', label: 'Worst of', icon: '↓', make: () => value({ kind: 'worstOf', universe: 'all', valueOf: 'performance' }) },
      { id: 'bestOf', chipClass: 'value', label: 'Best of', icon: '↑', make: () => value({ kind: 'bestOf', universe: 'all', valueOf: 'performance' }) },
      { id: 'average', chipClass: 'value', label: 'Average', icon: '≈', make: () => value({ kind: 'average', universe: 'all', basis: 'live' }) },
      { id: 'weightedBasket', chipClass: 'value', label: 'Weighted basket', icon: 'Σ', make: () => value({ kind: 'weightedBasket' }) },
      { id: 'spread', chipClass: 'value', label: 'Spread (A − B)', icon: '−', make: () => value({ kind: 'spread', left: null, right: null }) },
      { id: 'number', chipClass: 'number', label: 'Number', icon: '#', make: () => ({ kind: 'number', value: 100 }) },
      { id: 'levelRef', chipClass: 'levelRef', label: "This line's level", icon: '⌗', make: () => ({ kind: 'levelRef', key: '' }) },
      { id: 'anyUnderlying', chipClass: 'monitorSubject', label: 'Any underlying', icon: '∃', make: () => ({ kind: 'anyUnderlying' }) },
      { id: 'eachUnderlying', chipClass: 'monitorSubject', label: 'Each underlying', icon: '∀', make: () => ({ kind: 'eachUnderlying' }) }
    ]
  },
  {
    group: 'Comparisons',
    color: 'amber',
    entries: [
      { id: 'gte', chipClass: 'comparator', label: '≥', icon: '≥', make: () => ({ kind: 'cmp', op: 'gte' }) },
      { id: 'gt', chipClass: 'comparator', label: '>', icon: '>', make: () => ({ kind: 'cmp', op: 'gt' }) },
      { id: 'lte', chipClass: 'comparator', label: '≤', icon: '≤', make: () => ({ kind: 'cmp', op: 'lte' }) },
      { id: 'lt', chipClass: 'comparator', label: '<', icon: '<', make: () => ({ kind: 'cmp', op: 'lt' }) }
    ]
  },
  {
    group: 'Logic',
    color: 'gray',
    entries: [
      { id: 'and', chipClass: 'logic', label: 'AND', icon: '&', make: () => ({ kind: 'group', op: 'and' }) },
      { id: 'or', chipClass: 'logic', label: 'OR', icon: '|', make: () => ({ kind: 'group', op: 'or' }) },
      { id: 'not', chipClass: 'logic', label: 'NOT', icon: '¬', make: () => ({ kind: 'not' }) }
    ]
  },
  {
    group: 'Events',
    color: 'green',
    entries: [
      { id: 'payCoupon', chipClass: 'action', label: 'Pay coupon', icon: '💰', make: () => ({ kind: 'payCoupon', rate: { mode: 'fixed', value: 2.5 }, memory: false }) },
      { id: 'addToMemory', chipClass: 'action', label: 'Add to memory', icon: '🧠', make: () => ({ kind: 'addToMemory', rate: { mode: 'fixed', value: 2.5 } }) },
      { id: 'call', chipClass: 'action', label: 'Call / redeem', icon: '📞', make: () => ({ kind: 'call', redemption: { mode: 'fixed', value: 100 }, plusMemory: false }) },
      { id: 'knockIn', chipClass: 'action', label: 'Knock in', icon: '⚠️', make: () => ({ kind: 'knockIn' }) },
      { id: 'lock', chipClass: 'action', label: 'Lock', icon: '🔒', make: () => ({ kind: 'lock', selector: { kind: 'triggering' }, lockValue: { mode: 'observed' } }) },
      { id: 'eliminate', chipClass: 'action', label: 'Eliminate', icon: '✂️', make: () => ({ kind: 'eliminate', selector: { kind: 'triggering' } }) },
      { id: 'flag', chipClass: 'action', label: 'Flag', icon: '🚩', make: () => ({ kind: 'flag', selector: { kind: 'triggering' } }) }
    ]
  },
  {
    group: 'Payoff',
    color: 'teal',
    entries: [
      { id: 'participation', chipClass: 'payoffLeg', label: 'Participation leg', icon: '📈', make: () => ({ strike: 0, gearing: 1, floor: null, cap: null, absolute: false }) },
      { id: 'absoluteLeg', chipClass: 'payoffLeg', label: 'Absolute leg', icon: '|x|', make: () => ({ strike: 100, gearing: 1, floor: 0, cap: null, absolute: true }) }
    ]
  }
];

export const LINE_LABELS = [
  { id: 'loop', label: 'Loop of observations', icon: '🔁' },
  { id: 'single', label: 'Observation line', icon: '📅' },
  { id: 'anyDay', label: 'Any-day (continuous)', icon: '📉' },
  { id: 'count', label: 'Count-days line', icon: '🔢' },
  { id: 'final', label: 'Final line', icon: '🏁' }
];

// Dynamic per-underlying value chips for the Values group.
export function underlyingChips(underlyings) {
  return (underlyings || []).map(u => ({
    id: `u_${u.id}`,
    chipClass: 'value',
    label: u.ticker || u.id,
    icon: u.basis === 'level' ? '📊' : '•',
    make: () => ({ kind: 'underlying', underlyingId: u.id })
  }));
}

export const GROUP_TONE = {
  Values: 'blue', Comparisons: 'amber', Logic: 'gray', Events: 'green', Payoff: 'teal'
};
