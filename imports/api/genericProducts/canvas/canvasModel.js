/**
 * Canvas model — the drag-and-drop authoring representation. Pure data.
 *
 * The canvas is NOT the product: it compiles to the definition document
 * (compile.js) and decompiles back from one (decompile.js). Loops don't exist
 * in the definition — they explode into schedule rows — so the canvas model
 * carries the loop structure the definition can't.
 *
 * A product doc stores `canvasModel` alongside `definition`; canvas-authored
 * products reload from canvasModel losslessly, imported/legacy ones decompile.
 *
 * Shapes (see also the plan): every id is a short deterministic-at-creation
 * string so recompilation is stable.
 *
 *   Line union (lineType):
 *     loop   { id, lineType:'loop', firstObservation, frequencyMonths, count,
 *              paymentLagDays, columns:[{key, initial, stepPerPeriod, overrides:{i:val}}],
 *              rules:[Sentence] }
 *     single { id, lineType:'single', observationDate, paymentDate, levels:{k:v}, rules:[Sentence] }
 *     anyDay { id, lineType:'anyDay', window:{from,to}, once, subject, comparison, level, actions:[ActionChip] }
 *     count  { id, lineType:'count', window:{from,to}, subject, range:{low,high}, counterKey }
 *     final  { id, lineType:'final', inputValue: ValueChip|null, branches:[{id, condition|null, payoff:{base, legs}}] }
 *
 *   Sentence      { id, label, condition: ConditionNode|null, actions:[ActionChip], elseActions:[ActionChip] }
 *   ConditionNode compare|group|not|stateIs|countIs|always|raw   (see conditionActionChips below)
 *   ValueChip     underlying|worstOf|bestOf|average|weightedBasket|spread|number|levelRef|measureRef
 *   ActionChip    payCoupon|addToMemory|call|knockIn|lock|eliminate|flag|raw
 *   RateChip      fixed|levelRef|measure|accrualFraction
 *   LegChip       {strike, gearing, floor, cap, absolute}
 */

let _idCounter = 0;

/**
 * Deterministic id generator. Reset at the start of a compile/decompile so the
 * same input yields the same ids. Prefix keeps ids readable.
 */
export function newId(prefix = 'x') {
  _idCounter += 1;
  return `${prefix}${_idCounter}`;
}

export function resetIds() {
  _idCounter = 0;
}

export function createEmptyCanvas() {
  return {
    version: 1,
    lines: [
      {
        id: 'ln_final',
        lineType: 'final',
        inputValue: null,
        plusMemory: false,
        branches: [
          { id: 'br_otherwise', condition: null, payoff: { base: 100, legs: [] } }
        ]
      }
    ],
    meta: { extraAccumulators: [], rawMeasures: {} }
  };
}

// Chip-kind → the group of slots it may drop into (used by the UI Slot compat).
export const CHIP_CLASSES = {
  underlying: 'value', worstOf: 'value', bestOf: 'value', average: 'value',
  weightedBasket: 'value', spread: 'value', measureRef: 'value',
  number: 'number', levelRef: 'levelRef',
  cmp: 'comparator', touch: 'touchComparator',
  payCoupon: 'action', addToMemory: 'action', call: 'action', knockIn: 'action',
  lock: 'action', eliminate: 'action', flag: 'action', raw: 'action',
  participation: 'payoffLeg'
};

export function isValueChipKind(kind) {
  return ['underlying', 'worstOf', 'bestOf', 'average', 'weightedBasket', 'spread', 'measureRef'].includes(kind);
}
