/**
 * Round-trip test: for each fixture, decompile the definition to a canvas
 * model, recompile it, and assert (a) it validates and (b) it is structurally
 * equal to the original (modulo generated ids, via canonicalize).
 *
 * Run: node --experimental-default-type=module imports/api/genericProducts/canvas/tests/roundTrip.mjs
 */

import { compileCanvas } from '../compile.js';
import { decompileDefinition } from '../decompile.js';
import { canonicalJSON } from '../canonicalize.js';
import { createEmptyCanvas } from '../canvasModel.js';
import { validateDefinition } from '../../definitionSchema.js';
import { EXAMPLE_DEFINITIONS } from '../../examples/index.js';

let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL ${msg}`); };
const ok = (msg) => console.log(`ok   ${msg}`);

// ---- Round-trip all fixtures ----
for (const ex of EXAMPLE_DEFINITIONS) {
  const short = ex.name.replace('Example — ', '');
  const d0 = ex.definition;
  const canvas = decompileDefinition(d0);
  const d1 = compileCanvas({ identity: d0.identity, underlyings: d0.underlyings, canvasModel: canvas });

  const { errors } = validateDefinition(d1);
  if (errors.length) { fail(`${short}: recompiled invalid — ${errors.join('; ')}`); continue; }

  const c0 = canonicalJSON(d0);
  const c1 = canonicalJSON(d1);
  if (c0 !== c1) {
    fail(`${short}: canonical mismatch`);
    // find first differing top-level key for a hint
    const o0 = JSON.parse(c0), o1 = JSON.parse(c1);
    for (const k of Object.keys(o0)) {
      if (JSON.stringify(o0[k]) !== JSON.stringify(o1[k])) {
        console.log(`     first diff in "${k}":`);
        console.log(`       original:   ${JSON.stringify(o0[k]).slice(0, 400)}`);
        console.log(`       recompiled: ${JSON.stringify(o1[k]).slice(0, 400)}`);
        break;
      }
    }
  } else {
    ok(`round-trip: ${short}`);
  }
}

// ---- Compiler unit cases ----
function unit(label, fn) {
  try { fn(); ok(`unit: ${label}`); } catch (e) { fail(`unit: ${label} — ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

unit('empty canvas compiles (terminal payoff invalid until input set)', () => {
  const def = compileCanvas({ identity: {}, underlyings: [], canvasModel: createEmptyCanvas() });
  assert(def.schedule.rows.length === 0, 'no rows');
  assert(def.terminalPayoff.branches.length === 1, 'one branch');
});

unit('knockIn action auto-enables knockedIn register', () => {
  const canvas = {
    version: 1,
    lines: [{
      id: 'ln1', lineType: 'anyDay', window: { from: 'valueDate', to: 'finalObservationDate' },
      subject: { kind: 'worstOf', universe: 'all' }, comparison: 'touchesBelow', level: 65, once: true,
      actions: [{ kind: 'knockIn' }]
    }, {
      id: 'lnf', lineType: 'final', inputValue: { kind: 'worstOf', universe: 'all' },
      branches: [{ id: 'b1', condition: null, payoff: { base: 100, legs: [] } }]
    }],
    meta: { extraAccumulators: [], rawMeasures: {} }
  };
  const def = compileCanvas({ identity: {}, underlyings: [{ id: 'u1', fullTicker: 'A.US', initialFixing: 100 }], canvasModel: canvas });
  assert(def.stateRegisters.global.knockedIn.enabled === true, 'knockedIn enabled');
});

unit('memory coupon auto-creates memoryCouponBalance accumulator', () => {
  const canvas = {
    version: 1,
    lines: [{
      id: 'ln1', lineType: 'single', observationDate: '2024-06-01', paymentDate: '2024-06-08', levels: {},
      rules: [{ id: 's1', label: '', condition: null, actions: [{ kind: 'payCoupon', rate: { mode: 'fixed', value: 2.5 }, memory: true }], elseActions: [] }]
    }, {
      id: 'lnf', lineType: 'final', inputValue: { kind: 'average', universe: 'all', basis: 'live' },
      branches: [{ id: 'b1', condition: null, payoff: { base: 100, legs: [] } }]
    }],
    meta: { extraAccumulators: [], rawMeasures: {} }
  };
  const def = compileCanvas({ identity: {}, underlyings: [{ id: 'u1', fullTicker: 'A.US', initialFixing: 100 }], canvasModel: canvas });
  assert(def.stateRegisters.accumulators.some(a => a.id === 'memoryCouponBalance'), 'memory accumulator present');
});

unit('measure dedup: two worst-of chips → one measure', () => {
  const worst = () => ({ kind: 'worstOf', universe: 'all', valueOf: 'performance' });
  const canvas = {
    version: 1,
    lines: [{
      id: 'ln1', lineType: 'single', observationDate: '2024-06-01', paymentDate: '2024-06-08', levels: { b: 70 },
      rules: [{ id: 's1', label: '', condition: { kind: 'compare', left: worst(), op: 'gte', right: { kind: 'levelRef', key: 'b' } }, actions: [], elseActions: [] }]
    }, {
      id: 'lnf', lineType: 'final', inputValue: worst(),
      branches: [{ id: 'b1', condition: null, payoff: { base: 100, legs: [] } }]
    }],
    meta: { extraAccumulators: [], rawMeasures: {} }
  };
  const def = compileCanvas({ identity: {}, underlyings: [{ id: 'u1', fullTicker: 'A.US', initialFixing: 100 }, { id: 'u2', fullTicker: 'B.US', initialFixing: 100 }], canvasModel: canvas });
  assert(def.measures.length === 1, `expected 1 measure, got ${def.measures.length}`);
});

console.log(failures === 0 ? '\nALL ROUND-TRIP TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
