/**
 * Example definitions — the six proof targets of the composition schema.
 * They double as demo seeds ("Import example…" in the product list).
 *
 * Initial fixings are placeholders: after importing, use "Fetch fixing"
 * in the Underlyings section to pull the real close at the value date.
 */

function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  return date.toISOString().slice(0, 10);
}

function quarterlyRows({ firstObservation, count, paymentLagDays, levels, events, stepDown = 0 }) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const observationDate = addMonths(firstObservation, i * 3);
    const [y, m, d] = observationDate.split('-').map(Number);
    const pay = new Date(Date.UTC(y, m - 1, d + paymentLagDays));
    const rowLevels = { ...levels };
    if (rowLevels.autocallLevel !== undefined) {
      rowLevels.autocallLevel = Math.round((rowLevels.autocallLevel - stepDown * i) * 100) / 100;
    }
    rows.push({
      id: `obs_${i + 1}`,
      observationDate,
      paymentDate: pay.toISOString().slice(0, 10),
      levels: rowLevels,
      events: [...events]
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 1. Phoenix worst-of: memory coupon + step-down autocall + American KI + put
// ---------------------------------------------------------------------------
const phoenixWorstOf = {
  name: 'Example — Phoenix Worst-Of (memory, step-down, KI 65)',
  definition: {
    identity: {
      isin: 'XS0000000001',
      issuer: 'Example Issuer',
      currency: 'USD',
      notional: 1000000,
      denomination: 1000,
      tradeDate: '2024-01-15',
      valueDate: '2024-01-22',
      finalObservationDate: '2026-01-22',
      maturityDate: '2026-01-29',
      settlement: 'cash'
    },
    underlyings: [
      { id: 'u1', ticker: 'AAPL', fullTicker: 'AAPL.US', name: 'Apple Inc', isin: 'US0378331005', initialFixing: 191.56 },
      { id: 'u2', ticker: 'MSFT', fullTicker: 'MSFT.US', name: 'Microsoft Corp', isin: 'US5949181045', initialFixing: 398.67 },
      // AMZN rather than NVDA: NVDA's June 2024 10:1 split makes raw closes
      // inconsistent with a split-adjusted fixing across the product's life
      { id: 'u3', ticker: 'AMZN', fullTicker: 'AMZN.US', name: 'Amazon.com Inc', isin: 'US0231351067', initialFixing: 154.78 }
    ],
    stateRegisters: {
      perUnderlying: {
        locked: { enabled: false },
        eliminated: { enabled: false },
        flagged: { enabled: false }
      },
      global: { knockedIn: { enabled: true, initial: false } },
      accumulators: [
        { id: 'memoryCouponBalance', initial: 0 },
        { id: 'couponsPaidTotal', initial: 0 }
      ]
    },
    measures: [
      { id: 'mWorst', type: 'rankSelect', mode: 'worst', rank: 1, universe: 'active', valueOf: 'performance' }
    ],
    schedule: {
      rows: quarterlyRows({
        firstObservation: '2024-04-22',
        count: 8,
        paymentLagDays: 7,
        levels: { autocallLevel: 100, couponBarrier: 70, couponRate: 2.5 },
        events: ['evCoupon', 'evAutocall'],
        stepDown: 1
      }),
      monitors: [
        {
          id: 'monKI',
          type: 'barrierMonitor',
          scope: 'measure',
          measureId: 'mWorst',
          direction: 'below',
          level: 65,
          observation: 'continuous',
          window: { from: 'valueDate', to: 'finalObservationDate' },
          onTrigger: [{ type: 'setState', register: 'knockedIn', value: true }],
          once: true
        }
      ]
    },
    events: [
      {
        id: 'evCoupon',
        label: 'Memory coupon',
        condition: {
          type: 'levelTest', measureId: 'mWorst', op: 'gte',
          level: { source: 'rowLevel', key: 'couponBarrier' }
        },
        actions: [
          {
            type: 'payCoupon',
            rate: { source: 'rowLevel', key: 'couponRate' },
            memory: true,
            accumulatorId: 'memoryCouponBalance',
            guaranteed: false
          }
        ],
        elseActions: [
          {
            type: 'accrueToAccumulator',
            accumulatorId: 'memoryCouponBalance',
            rate: { source: 'rowLevel', key: 'couponRate' }
          }
        ]
      },
      {
        id: 'evAutocall',
        label: 'Autocall',
        condition: {
          type: 'levelTest', measureId: 'mWorst', op: 'gte',
          level: { source: 'rowLevel', key: 'autocallLevel' }
        },
        actions: [
          {
            type: 'call',
            redemptionLevel: { source: 'fixed', value: 100 },
            plusAccumulators: []
          }
        ],
        elseActions: []
      }
    ],
    terminalPayoff: {
      inputMeasureId: 'mWorst',
      branches: [
        {
          condition: { type: 'stateTest', register: 'knockedIn', expect: false },
          payoff: { base: 100, legs: [] }
        },
        {
          condition: { type: 'levelTest', measureId: 'mWorst', op: 'gte', level: { source: 'fixed', value: 100 } },
          payoff: { base: 100, legs: [] }
        },
        {
          condition: { type: 'always' },
          payoff: { base: 0, legs: [{ type: 'linear', of: 'input', strike: 0, gearing: 1, floor: null, cap: null, absolute: false }] }
        }
      ]
    }
  }
};

// ---------------------------------------------------------------------------
// 2. Orion: per-underlying American upper barrier locks performance at a
//    fixed rebate; redemption = mean of locked-or-live performances, floor 100
// ---------------------------------------------------------------------------
const orionLockAtRebate = {
  name: 'Example — Orion (lock at rebate 116.5, floor 100)',
  definition: {
    identity: {
      isin: 'XS0000000002',
      issuer: 'Example Issuer',
      currency: 'USD',
      notional: 1000000,
      denomination: 1000,
      tradeDate: '2024-01-15',
      valueDate: '2024-01-22',
      finalObservationDate: '2026-01-22',
      maturityDate: '2026-01-29',
      settlement: 'cash'
    },
    underlyings: [
      { id: 'u1', ticker: 'AAPL', fullTicker: 'AAPL.US', name: 'Apple Inc', isin: 'US0378331005', initialFixing: 191.56 },
      { id: 'u2', ticker: 'MSFT', fullTicker: 'MSFT.US', name: 'Microsoft Corp', isin: 'US5949181045', initialFixing: 398.67 },
      { id: 'u3', ticker: 'GOOGL', fullTicker: 'GOOGL.US', name: 'Alphabet Inc', isin: 'US02079K3059', initialFixing: 142.65 }
    ],
    stateRegisters: {
      perUnderlying: {
        locked: { enabled: true },
        eliminated: { enabled: false },
        flagged: { enabled: false }
      },
      global: { knockedIn: { enabled: false, initial: false } },
      accumulators: []
    },
    measures: [
      { id: 'mMeanLockedOrLive', type: 'aggregate', fn: 'meanOfLockedOrLive', universe: 'all' }
    ],
    schedule: {
      rows: [],
      monitors: [
        {
          id: 'monUpperLock',
          type: 'barrierMonitor',
          scope: 'eachUnderlying',
          direction: 'above',
          level: 150,
          observation: 'continuous',
          window: { from: 'valueDate', to: 'finalObservationDate' },
          onTrigger: [
            {
              type: 'lockUnderlying',
              selector: { source: 'triggering' },
              lockValue: { source: 'fixed', value: 116.5 }
            }
          ],
          once: false
        }
      ]
    },
    events: [],
    terminalPayoff: {
      inputMeasureId: 'mMeanLockedOrLive',
      branches: [
        {
          condition: { type: 'always' },
          payoff: { base: 0, legs: [{ type: 'linear', of: 'input', strike: 0, gearing: 1, floor: 100, cap: null, absolute: false }] }
        }
      ]
    }
  }
};

// ---------------------------------------------------------------------------
// 3. Himalaya: at each observation, lock the best performer at its observed
//    level and remove it; redemption = mean of locked levels, floor 100
// ---------------------------------------------------------------------------
const himalayaLockEliminate = {
  name: 'Example — Himalaya (lock best + eliminate, floor 100)',
  definition: {
    identity: {
      isin: 'XS0000000003',
      issuer: 'Example Issuer',
      currency: 'USD',
      notional: 1000000,
      denomination: 1000,
      tradeDate: '2022-01-17',
      valueDate: '2022-01-24',
      finalObservationDate: '2026-01-26',
      maturityDate: '2026-02-02',
      settlement: 'cash'
    },
    underlyings: [
      { id: 'u1', ticker: 'AAPL', fullTicker: 'AAPL.US', name: 'Apple Inc', isin: 'US0378331005', initialFixing: 161.62 },
      { id: 'u2', ticker: 'MSFT', fullTicker: 'MSFT.US', name: 'Microsoft Corp', isin: 'US5949181045', initialFixing: 296.37 },
      { id: 'u3', ticker: 'AMZN', fullTicker: 'AMZN.US', name: 'Amazon.com Inc', isin: 'US0231351067', initialFixing: 142.65 },
      { id: 'u4', ticker: 'GOOGL', fullTicker: 'GOOGL.US', name: 'Alphabet Inc', isin: 'US02079K3059', initialFixing: 128.32 }
    ],
    stateRegisters: {
      perUnderlying: {
        locked: { enabled: true },
        eliminated: { enabled: true },
        flagged: { enabled: false }
      },
      global: { knockedIn: { enabled: false, initial: false } },
      accumulators: []
    },
    measures: [
      { id: 'mBest', type: 'rankSelect', mode: 'best', rank: 1, universe: 'active', valueOf: 'performance' },
      { id: 'mMeanLocked', type: 'aggregate', fn: 'meanOfLockedOrLive', universe: 'locked' }
    ],
    schedule: {
      rows: [
        { id: 'obs_1', observationDate: '2023-01-24', paymentDate: '2023-01-31', levels: {}, events: ['evLock'] },
        { id: 'obs_2', observationDate: '2024-01-24', paymentDate: '2024-01-31', levels: {}, events: ['evLock'] },
        { id: 'obs_3', observationDate: '2025-01-24', paymentDate: '2025-01-31', levels: {}, events: ['evLock'] },
        { id: 'obs_4', observationDate: '2026-01-26', paymentDate: '2026-02-02', levels: {}, events: ['evLock'] }
      ],
      monitors: []
    },
    events: [
      {
        id: 'evLock',
        label: 'Lock best performer and eliminate it',
        condition: { type: 'always' },
        actions: [
          {
            type: 'lockUnderlying',
            selector: { source: 'measureSelection', measureId: 'mBest' },
            lockValue: { source: 'observed' }
          },
          {
            type: 'eliminateUnderlying',
            selector: { source: 'measureSelection', measureId: 'mBest' }
          }
        ],
        elseActions: []
      }
    ],
    terminalPayoff: {
      inputMeasureId: 'mMeanLocked',
      branches: [
        {
          condition: { type: 'always' },
          payoff: { base: 0, legs: [{ type: 'linear', of: 'input', strike: 0, gearing: 1, floor: 100, cap: null, absolute: false }] }
        }
      ]
    }
  }
};

// ---------------------------------------------------------------------------
// 4. Twin Win: American KI at 70; if never touched, gain |performance - 100|
//    (capped at 30) on top of par; if touched, linear downside
// ---------------------------------------------------------------------------
const twinWin = {
  name: 'Example — Twin Win (KI 70, absolute leg capped 30)',
  definition: {
    identity: {
      isin: 'XS0000000004',
      issuer: 'Example Issuer',
      currency: 'USD',
      notional: 1000000,
      denomination: 1000,
      tradeDate: '2024-01-15',
      valueDate: '2024-01-22',
      finalObservationDate: '2026-01-22',
      maturityDate: '2026-01-29',
      settlement: 'cash'
    },
    underlyings: [
      { id: 'u1', ticker: 'TSLA', fullTicker: 'TSLA.US', name: 'Tesla Inc', isin: 'US88160R1014', initialFixing: 212.19 }
    ],
    stateRegisters: {
      perUnderlying: {
        locked: { enabled: false },
        eliminated: { enabled: false },
        flagged: { enabled: false }
      },
      global: { knockedIn: { enabled: true, initial: false } },
      accumulators: []
    },
    measures: [
      { id: 'mPerf', type: 'aggregate', fn: 'mean', universe: 'all' }
    ],
    schedule: {
      rows: [],
      monitors: [
        {
          id: 'monKI',
          type: 'barrierMonitor',
          scope: 'measure',
          measureId: 'mPerf',
          direction: 'below',
          level: 70,
          observation: 'continuous',
          window: { from: 'valueDate', to: 'finalObservationDate' },
          onTrigger: [{ type: 'setState', register: 'knockedIn', value: true }],
          once: true
        }
      ]
    },
    events: [],
    terminalPayoff: {
      inputMeasureId: 'mPerf',
      branches: [
        {
          condition: { type: 'stateTest', register: 'knockedIn', expect: false },
          payoff: { base: 100, legs: [{ type: 'linear', of: 'input', strike: 100, gearing: 1, floor: 0, cap: 30, absolute: true }] }
        },
        {
          condition: { type: 'always' },
          payoff: { base: 0, legs: [{ type: 'linear', of: 'input', strike: 0, gearing: 1, floor: null, cap: null, absolute: false }] }
        }
      ]
    }
  }
};

// ---------------------------------------------------------------------------
// 5. Participation note: 100 + 150% of basket upside, capped at +40
// ---------------------------------------------------------------------------
const participationNote = {
  name: 'Example — Participation Note (150% upside, cap +40)',
  definition: {
    identity: {
      isin: 'XS0000000005',
      issuer: 'Example Issuer',
      currency: 'USD',
      notional: 1000000,
      denomination: 1000,
      tradeDate: '2024-01-15',
      valueDate: '2024-01-22',
      finalObservationDate: '2026-01-22',
      maturityDate: '2026-01-29',
      settlement: 'cash'
    },
    underlyings: [
      { id: 'u1', ticker: 'AAPL', fullTicker: 'AAPL.US', name: 'Apple Inc', isin: 'US0378331005', initialFixing: 191.56, weight: 0.5 },
      { id: 'u2', ticker: 'MSFT', fullTicker: 'MSFT.US', name: 'Microsoft Corp', isin: 'US5949181045', initialFixing: 398.67, weight: 0.5 }
    ],
    stateRegisters: {
      perUnderlying: {
        locked: { enabled: false },
        eliminated: { enabled: false },
        flagged: { enabled: false }
      },
      global: { knockedIn: { enabled: false, initial: false } },
      accumulators: []
    },
    measures: [
      { id: 'mBasket', type: 'aggregate', fn: 'weightedMean', universe: 'all' }
    ],
    schedule: { rows: [], monitors: [] },
    events: [],
    terminalPayoff: {
      inputMeasureId: 'mBasket',
      branches: [
        {
          condition: { type: 'always' },
          payoff: { base: 100, legs: [{ type: 'linear', of: 'input', strike: 100, gearing: 1.5, floor: 0, cap: 40, absolute: false }] }
        }
      ]
    }
  }
};

// ---------------------------------------------------------------------------
// 6. Zero-coupon worst-of note: single observation; par if worst >= 100,
//    otherwise linear downside on the worst performer
// ---------------------------------------------------------------------------
const zeroCouponLTV = {
  name: 'Example — Zero-Coupon Worst-Of Note (7 months)',
  definition: {
    identity: {
      isin: 'XS0000000006',
      issuer: 'Example Issuer',
      currency: 'USD',
      notional: 1000000,
      denomination: 1000,
      tradeDate: '2025-06-02',
      valueDate: '2025-06-09',
      finalObservationDate: '2026-01-09',
      maturityDate: '2026-01-16',
      settlement: 'cash'
    },
    underlyings: [
      { id: 'u1', ticker: 'AAPL', fullTicker: 'AAPL.US', name: 'Apple Inc', isin: 'US0378331005', initialFixing: 201.7 },
      { id: 'u2', ticker: 'MSFT', fullTicker: 'MSFT.US', name: 'Microsoft Corp', isin: 'US5949181045', initialFixing: 461.97 },
      { id: 'u3', ticker: 'NVDA', fullTicker: 'NVDA.US', name: 'NVIDIA Corp', isin: 'US67066G1040', initialFixing: 137.38 },
      { id: 'u4', ticker: 'AMZN', fullTicker: 'AMZN.US', name: 'Amazon.com Inc', isin: 'US0231351067', initialFixing: 205.01 }
    ],
    stateRegisters: {
      perUnderlying: {
        locked: { enabled: false },
        eliminated: { enabled: false },
        flagged: { enabled: false }
      },
      global: { knockedIn: { enabled: false, initial: false } },
      accumulators: []
    },
    measures: [
      { id: 'mWorst', type: 'rankSelect', mode: 'worst', rank: 1, universe: 'all', valueOf: 'performance' }
    ],
    schedule: {
      rows: [
        { id: 'obs_final', observationDate: '2026-01-09', paymentDate: '2026-01-16', levels: {}, events: [] }
      ],
      monitors: []
    },
    events: [],
    terminalPayoff: {
      inputMeasureId: 'mWorst',
      branches: [
        {
          condition: { type: 'levelTest', measureId: 'mWorst', op: 'gte', level: { source: 'fixed', value: 100 } },
          payoff: { base: 100, legs: [] }
        },
        {
          condition: { type: 'always' },
          payoff: { base: 0, legs: [{ type: 'linear', of: 'input', strike: 0, gearing: 1, floor: null, cap: null, absolute: false }] }
        }
      ]
    }
  }
};

// Rows every `frequencyMonths` with a constant level bag and event list.
function periodicRows({ firstObservation, count, frequencyMonths, paymentLagDays, levels, events }) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const observationDate = addMonths(firstObservation, i * frequencyMonths);
    const [y, m, d] = observationDate.split('-').map(Number);
    const pay = new Date(Date.UTC(y, m - 1, d + paymentLagDays));
    rows.push({
      id: `obs_${i + 1}`,
      observationDate,
      paymentDate: pay.toISOString().slice(0, 10),
      levels: { ...levels },
      events: [...events]
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 7. Range accrual note: quarterly coupon = 4% × (days SOFR in [1%, 4.5%] / days)
// ---------------------------------------------------------------------------
const rangeAccrualNote = {
  name: 'Example — CMS Range Accrual (4% × days in [1, 4.5])',
  definition: {
    identity: {
      isin: 'XS0000000007',
      issuer: 'Example Issuer',
      currency: 'USD',
      notional: 1000000,
      denomination: 1000,
      tradeDate: '2024-01-15',
      valueDate: '2024-01-22',
      finalObservationDate: '2026-01-22',
      maturityDate: '2026-01-29',
      settlement: 'cash'
    },
    underlyings: [
      { id: 'r1', ticker: 'SOFR', fullTicker: 'SOFR.RATE', name: 'SOFR Rate', isin: null, basis: 'level' }
    ],
    stateRegisters: {
      perUnderlying: {
        locked: { enabled: false },
        eliminated: { enabled: false },
        flagged: { enabled: false }
      },
      global: { knockedIn: { enabled: false, initial: false } },
      accumulators: [
        { id: 'daysInRange', initial: 0 },
        { id: 'daysInRangeObserved', initial: 0 }
      ]
    },
    measures: [
      { id: 'mRate', type: 'aggregate', fn: 'mean', universe: 'all' }
    ],
    schedule: {
      rows: periodicRows({
        firstObservation: '2024-04-22',
        count: 8,
        frequencyMonths: 3,
        paymentLagDays: 7,
        levels: { couponRate: 4 },
        events: ['evAccrualCoupon']
      }),
      monitors: [
        {
          id: 'monRange',
          type: 'barrierMonitor',
          mode: 'count',
          scope: 'measure',
          measureId: 'mRate',
          direction: 'inside',
          level: 1,
          levelHigh: 4.5,
          observation: 'continuous',
          window: { from: 'valueDate', to: 'finalObservationDate' },
          countAccumulatorId: 'daysInRange',
          observedDaysAccumulatorId: 'daysInRangeObserved',
          once: false
        }
      ]
    },
    events: [
      {
        id: 'evAccrualCoupon',
        label: 'Accrual coupon',
        condition: { type: 'always' },
        actions: [
          {
            type: 'payCoupon',
            rate: {
              source: 'accrualFraction',
              rate: { source: 'rowLevel', key: 'couponRate' },
              countAccumulatorId: 'daysInRange',
              observedDaysAccumulatorId: 'daysInRangeObserved',
              resetEachPeriod: true
            },
            memory: false,
            guaranteed: false
          }
        ],
        elseActions: []
      }
    ],
    terminalPayoff: {
      inputMeasureId: 'mRate',
      branches: [
        { condition: { type: 'always' }, payoff: { base: 100, legs: [] } }
      ]
    }
  }
};

// ---------------------------------------------------------------------------
// 8. Steepener note: annual coupon = 4 × (CMS30 − CMS2), floored 0, capped 8
// ---------------------------------------------------------------------------
const steepenerNote = {
  name: 'Example — CMS Steepener (4 × (CMS30 − CMS2), floor 0, cap 8)',
  definition: {
    identity: {
      isin: 'XS0000000008',
      issuer: 'Example Issuer',
      currency: 'EUR',
      notional: 1000000,
      denomination: 1000,
      tradeDate: '2024-01-15',
      valueDate: '2024-01-22',
      finalObservationDate: '2029-01-22',
      maturityDate: '2029-01-29',
      settlement: 'cash'
    },
    underlyings: [
      { id: 'u1', ticker: 'CMS30', fullTicker: 'CMS30.RATE', name: 'EUR CMS 30Y', isin: null, basis: 'level' },
      { id: 'u2', ticker: 'CMS2', fullTicker: 'CMS2.RATE', name: 'EUR CMS 2Y', isin: null, basis: 'level' }
    ],
    stateRegisters: {
      perUnderlying: {
        locked: { enabled: false },
        eliminated: { enabled: false },
        flagged: { enabled: false }
      },
      global: { knockedIn: { enabled: false, initial: false } },
      accumulators: []
    },
    measures: [
      { id: 'mCms30', type: 'aggregate', fn: 'mean', universe: 'all', underlyingIds: ['u1'] },
      { id: 'mCms2', type: 'aggregate', fn: 'mean', universe: 'all', underlyingIds: ['u2'] },
      { id: 'mSpread', type: 'combine', fn: 'spread', inputs: [{ measureId: 'mCms30', weight: 1 }, { measureId: 'mCms2', weight: 1 }] }
    ],
    schedule: {
      rows: periodicRows({
        firstObservation: '2025-01-22',
        count: 5,
        frequencyMonths: 12,
        paymentLagDays: 7,
        levels: {},
        events: ['evFloatingCoupon']
      }),
      monitors: []
    },
    events: [
      {
        id: 'evFloatingCoupon',
        label: 'Steepener coupon',
        condition: { type: 'always' },
        actions: [
          {
            type: 'payCoupon',
            rate: { source: 'measure', measureId: 'mSpread', gearing: 4, spread: 0, floor: 0, cap: 8 },
            memory: false,
            guaranteed: false
          }
        ],
        elseActions: []
      }
    ],
    terminalPayoff: {
      inputMeasureId: 'mCms30',
      branches: [
        { condition: { type: 'always' }, payoff: { base: 100, legs: [] } }
      ]
    }
  }
};

export const EXAMPLE_DEFINITIONS = [
  phoenixWorstOf,
  orionLockAtRebate,
  himalayaLockEliminate,
  twinWin,
  participationNote,
  zeroCouponLTV,
  rangeAccrualNote,
  steepenerNote
];
