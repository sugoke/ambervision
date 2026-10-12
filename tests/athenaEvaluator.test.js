/**
 * Athena payoff arithmetic and schedule ladder.
 *
 * Reference case: BNP Paribas Athena XS3524899567 (CE12997CLV) on Partners Group /
 * Sandoz, issued at 66.90%, strike 09/10/2026, issue 23/10/2026.
 *   Autocall n=2 (11/10/2027, 100% level) -> N x 100%; n=3 (10/04/2028, 90%) -> N x 110%
 *   Final: worst-of >= 80% -> 120%; >= 16% -> 100% + 125% x (worst-of - 80%); else 0%.
 */
import assert from 'assert';
import { AthenaEvaluationHelpers as H } from '../imports/api/evaluators/athenaEvaluationHelpers.js';
import {
  generateSchedule,
  applyLevelConfig,
  markManualEdit,
  redemptionAmountFor,
  hasRedemptionLadder
} from '../imports/utils/scheduleGenerator.js';

const BNP_TIERS = [
  { fromLevel: 80, type: 'fixed', amount: 120 },
  { fromLevel: 16, type: 'linear', base: 100, gearing: 125, strike: 80 },
  { fromLevel: 0, type: 'fixed', amount: 0 }
];

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

describe('Athena final payoff tiers (BNP CE12997CLV)', function () {
  it('pays 120% at or above the 80% final barrier', function () {
    close(H.evaluateFinalTiers(85, BNP_TIERS).payout, 120);
    close(H.evaluateFinalTiers(80, BNP_TIERS).payout, 120);
    close(H.evaluateFinalTiers(140, BNP_TIERS).payout, 120);
  });

  it('pays the geared put between 16% and 80%', function () {
    // 100% + 125% x (60% - 80%) = 75%
    close(H.evaluateFinalTiers(60, BNP_TIERS).payout, 75);
    // 100% + 125% x (16% - 80%) = 20%
    close(H.evaluateFinalTiers(16, BNP_TIERS).payout, 20);
    // Just under the barrier the put is at par
    close(H.evaluateFinalTiers(79.999999, BNP_TIERS).payout, 100 + 1.25 * (79.999999 - 80));
  });

  it('pays 0% below 16%', function () {
    close(H.evaluateFinalTiers(15.9, BNP_TIERS).payout, 0);
    close(H.evaluateFinalTiers(0, BNP_TIERS).payout, 0);
  });

  it('reports which tier applies', function () {
    assert.strictEqual(H.evaluateFinalTiers(85, BNP_TIERS).tierIndex, 0);
    assert.strictEqual(H.evaluateFinalTiers(60, BNP_TIERS).tierIndex, 1);
    assert.strictEqual(H.evaluateFinalTiers(10, BNP_TIERS).tierIndex, 2);
  });

  it('orders tiers by level whatever the input order, and reads numeric strings', function () {
    const shuffled = [BNP_TIERS[2], { ...BNP_TIERS[1], fromLevel: '16', gearing: '125' }, BNP_TIERS[0]];
    close(H.evaluateFinalTiers(60, shuffled).payout, 75);
    close(H.evaluateFinalTiers(90, shuffled).payout, 120);
  });

  it('pays nothing below the lowest tier when the term sheet has no "otherwise" case', function () {
    close(H.evaluateFinalTiers(10, BNP_TIERS.slice(0, 2)).payout, 0);
  });

  it('describes the tiers for display', function () {
    const rows = H.describeTiers(BNP_TIERS, 1);
    assert.deepStrictEqual(rows.map(r => r.rangeLabel), ['≥ 80%', '16% – 80%', '< 16%']);
    assert.deepStrictEqual(rows.map(r => r.formulaLabel), ['120%', '100% + 125% × (worst-of − 80%)', '0%']);
    assert.deepStrictEqual(rows.map(r => r.isActive), [false, true, false]);
  });
});

describe('Athena capital-at-risk level', function () {
  it('is the geared put strike for the BNP note', function () {
    assert.strictEqual(H.capitalAtRiskLevel(BNP_TIERS), 80);
  });

  it('is the protection barrier for a classic Athena', function () {
    const classic = [
      { fromLevel: 100, type: 'fixed', amount: 108 },
      { fromLevel: 60, type: 'fixed', amount: 100 },
      { fromLevel: 0, type: 'linear', base: 100, gearing: 100, strike: 100 }
    ];
    assert.strictEqual(H.capitalAtRiskLevel(classic), 60);
    // Below the barrier: 1:1 with the worst-of
    close(H.evaluateFinalTiers(45, classic).payout, 45);
  });

  it('is null when the final redemption never falls below par', function () {
    assert.strictEqual(H.capitalAtRiskLevel([{ fromLevel: 0, type: 'fixed', amount: 100 }]), null);
  });
});

describe('Athena returns on the issue price', function () {
  it('measures the redemption against the 66.90% paid', function () {
    close(H.returnOnIssuePrice(120, 66.9), (120 / 66.9 - 1) * 100);
    assert.strictEqual(H.formatPercent(H.returnOnIssuePrice(120, 66.9), { signed: true }), '+79.37%');
    assert.strictEqual(H.formatPercent(H.returnOnIssuePrice(100, 66.9), { signed: true }), '+49.48%');
  });

  it('annualises from the issue date to the payment date', function () {
    // 23/10/2026 -> 25/10/2027 is 367 days: (100 / 66.90)^(365/367) - 1
    const expected = (Math.pow(100 / 66.9, 365 / 367) - 1) * 100;
    close(H.annualizedReturn(100, 66.9, '2026-10-23', '2027-10-25'), expected, 1e-9);
  });

  it('gives no figure without an issue price or with dates out of order', function () {
    assert.strictEqual(H.returnOnIssuePrice(120, 0), null);
    assert.strictEqual(H.annualizedReturn(120, 66.9, '2027-01-01', '2026-01-01'), null);
  });
});

describe('Athena schedule ladder', function () {
  const productDetails = {
    tradeDate: '2026-10-09',
    valueDate: '2026-10-23',
    finalObservation: '2028-10-09',
    maturity: '2028-10-23',
    currency: 'CHF'
  };
  const scheduleConfig = {
    frequency: 'semi-annually',
    coolOffPeriods: 1,
    initialAutocallLevel: 100,
    stepDownValue: -10,
    redemptionBase: 80,
    redemptionStep: 10
  };

  it('computes base + n x coupon', function () {
    assert.strictEqual(redemptionAmountFor(2, scheduleConfig), 100);
    assert.strictEqual(redemptionAmountFor(3, scheduleConfig), 110);
    assert.strictEqual(redemptionAmountFor(4, scheduleConfig), 120);
  });

  it('fills the BNP levels and amounts on a generated schedule', function () {
    const rows = generateSchedule({ productDetails, scheduleConfig, underlyings: [] });
    assert.strictEqual(rows.length, 4);
    assert.strictEqual(rows[0].isCallable, false);
    assert.deepStrictEqual(rows.slice(1, 3).map(r => [r.autocallLevel, r.redemptionAmount]), [[100, 100], [90, 110]]);
  });

  it('keeps an amount typed by hand when the ladder changes', function () {
    const rows = generateSchedule({ productDetails, scheduleConfig, underlyings: [] });
    const edited = rows.map(r => (r.id === 'period_1' ? markManualEdit(r, 'redemptionAmount', 101.5) : r));
    const updated = applyLevelConfig(edited, { ...scheduleConfig, redemptionStep: 12 });
    assert.strictEqual(updated[1].redemptionAmount, 101.5);
    assert.strictEqual(updated[2].redemptionAmount, 116);
  });

  it('leaves other payoffs without a redemption amount', function () {
    const phoenixConfig = { frequency: 'quarterly', initialAutocallLevel: 100, stepDownValue: 0 };
    assert.strictEqual(hasRedemptionLadder(phoenixConfig), false);
    const rows = generateSchedule({ productDetails, scheduleConfig: phoenixConfig, underlyings: [] });
    assert.ok(rows.every(r => !('redemptionAmount' in r)));
  });
});
