/**
 * Create/Edit Product: schedule persistence, issuer date conventions and the
 * Summary coupon label.
 *
 * Reference case: BNP Paribas Phoenix XS3508902205 on BP / FANG / TTE, strike
 * 25/09/2026, issue 09/10/2026, final observation 25/09/2028, maturity 09/10/2028,
 * quarterly, 1 non-call period, autocall 100% stepping down 5% to a 75% floor.
 */
import assert from 'assert';
import {
  generateSchedule,
  applyLevelConfig,
  markManualEdit,
  countManualDateEdits,
  shouldAutoBuildSchedule,
  resolveCalendars,
  resolvePaymentLag
} from '../imports/utils/scheduleGenerator.js';
import {
  easterSunday,
  isHolidayISO,
  isBusinessDayISO,
  calendarsForUnderlyings
} from '../imports/utils/holidayCalendars.js';
import { formatPerPeriodCouponLabel } from '../imports/utils/couponLabel.js';

const productDetails = {
  tradeDate: '2026-09-25',
  valueDate: '2026-10-09',
  finalObservation: '2028-09-25',
  maturity: '2028-10-09',
  currency: 'EUR'
};

const underlyings = [
  { ticker: 'BP', securityData: { exchange: 'US', ticker: 'BP.US' } },
  { ticker: 'FANG', securityData: { exchange: 'US', ticker: 'FANG.US' } },
  { ticker: 'TTE', securityData: { exchange: 'PA', ticker: 'TTE.PA' } }
];

const scheduleConfig = {
  frequency: 'quarterly',
  coolOffPeriods: 1,
  stepDownValue: -5,
  initialAutocallLevel: 100,
  initialCouponBarrier: 70,
  autocallFloor: 75
};

// Dates printed in the term sheet
const TERMSHEET_ROWS = [
  ['2026-12-28', '2027-01-12'],
  ['2027-03-25', '2027-04-12'],
  ['2027-06-25', '2027-07-09'],
  ['2027-09-27', '2027-10-11'],
  ['2027-12-27', '2028-01-10'],
  ['2028-03-27', '2028-04-10'],
  ['2028-06-26', '2028-07-10'],
  ['2028-09-25', '2028-10-09']
];

describe('Holiday calendars', function () {
  it('computes Easter-based holidays for any year', function () {
    assert.strictEqual(easterSunday(2027), '2027-03-28');
    assert.ok(isHolidayISO('2027-03-26', ['TARGET2']), 'Good Friday 2027');
    assert.ok(isHolidayISO('2027-03-29', ['TARGET2']), 'Easter Monday 2027');
  });

  it('applies the UK Boxing Day substitute only to the UK calendar', function () {
    assert.ok(isHolidayISO('2026-12-28', ['GB']));
    assert.ok(isBusinessDayISO('2026-12-28', ['US', 'EU']));
  });

  it('derives observation calendars from the underlyings exchanges', function () {
    const { calendars, unmapped } = calendarsForUnderlyings(underlyings);
    assert.deepStrictEqual(calendars.sort(), ['EU', 'US']);
    assert.deepStrictEqual(unmapped, []);
  });
});

describe('Schedule generation (issuer conventions)', function () {
  it('uses TARGET2 for EUR payments and derives a 10 business day lag from trade → issue date', function () {
    const { paymentCalendars } = resolveCalendars({ scheduleConfig, underlyings, currency: 'EUR' });
    assert.deepStrictEqual(paymentCalendars, ['TARGET2']);
    assert.deepStrictEqual(resolvePaymentLag(scheduleConfig, productDetails, paymentCalendars), { lag: 10, source: 'issueDate' });
  });

  it('reproduces the BNP term sheet dates', function () {
    const rows = generateSchedule({ productDetails, scheduleConfig, underlyings });
    assert.deepStrictEqual(rows.map(r => [r.observationDate, r.valueDate]), TERMSHEET_ROWS);
  });

  it('stops the step-down at the autocall floor', function () {
    const rows = generateSchedule({ productDetails, scheduleConfig, underlyings });
    assert.deepStrictEqual(rows.map(r => r.autocallLevel), [null, 100, 95, 90, 85, 80, 75, 75]);
    assert.deepStrictEqual(rows.map(r => r.isCallable), [false, true, true, true, true, true, true, true]);
  });

  it('uses an explicit payment lag when set', function () {
    const rows = generateSchedule({
      productDetails,
      scheduleConfig: { ...scheduleConfig, paymentLagBusinessDays: 5 },
      underlyings
    });
    assert.strictEqual(rows[1].valueDate, '2027-04-05'); // 25/03 + 5 TARGET2 days, Good Friday and Easter Monday skipped
  });
});

describe('Schedule persistence (manual edits survive save/load)', function () {
  const editByHand = () => {
    const generated = generateSchedule({ productDetails, scheduleConfig, underlyings });
    return generated.map(row => {
      if (row.id === 'period_0') return markManualEdit(row, 'observationDate', '2026-12-29');
      if (row.id === 'period_1') return markManualEdit(row, 'valueDate', '2027-04-15');
      return row;
    });
  };

  it('flags hand-edited rows', function () {
    const edited = editByHand();
    assert.strictEqual(edited[0].manualOverride, true);
    assert.deepStrictEqual(edited[0].manualFields, ['observationDate']);
    assert.strictEqual(countManualDateEdits(edited), 2);
  });

  it('does not rebuild a stored schedule when the Schedule tab loads', function () {
    const stored = JSON.parse(JSON.stringify(editByHand())); // what Mongo returns
    assert.strictEqual(shouldAutoBuildSchedule(stored, productDetails), false);
    assert.strictEqual(shouldAutoBuildSchedule([], productDetails), true);
    assert.strictEqual(stored[0].observationDate, '2026-12-29');
    assert.strictEqual(stored[1].valueDate, '2027-04-15');
  });

  it('keeps manual dates and manual levels on a level-only config change', function () {
    let edited = editByHand();
    edited = edited.map(row => (row.id === 'period_3' ? markManualEdit(row, 'autocallLevel', 92) : row));
    const updated = applyLevelConfig(edited, { ...scheduleConfig, stepDownValue: -2.5 });
    assert.strictEqual(updated[0].observationDate, '2026-12-29');
    assert.strictEqual(updated[1].valueDate, '2027-04-15');
    assert.strictEqual(updated[2].autocallLevel, 97.5);
    assert.strictEqual(updated[3].autocallLevel, 92, 'manual level kept');
  });

  if (Meteor.isServer) {
    it('round-trips hand-edited dates through the products collection', async function () {
      const { ProductsCollection } = await import('../imports/api/products.js');
      const observationSchedule = editByHand();
      const _id = await ProductsCollection.insertAsync({
        isin: 'TEST-SCHEDULE-ROUNDTRIP', templateId: 'phoenix_autocallable', ...productDetails, observationSchedule, scheduleConfig
      });
      try {
        const loaded = await ProductsCollection.findOneAsync(_id);
        assert.deepStrictEqual(loaded.observationSchedule, observationSchedule);
        assert.deepStrictEqual(loaded.scheduleConfig, scheduleConfig);
        assert.strictEqual(shouldAutoBuildSchedule(loaded.observationSchedule, loaded), false);
      } finally {
        await ProductsCollection.removeAsync(_id);
      }
    });
  }
});

describe('Summary coupon label', function () {
  it('shows a per-period coupon with its annual equivalent', function () {
    assert.strictEqual(formatPerPeriodCouponLabel(2.8, 'quarterly'), '2.8% per quarter (11.2% p.a.)');
    assert.strictEqual(formatPerPeriodCouponLabel(0.75, 'Monthly'), '0.75% per month (9% p.a.)');
    assert.strictEqual(formatPerPeriodCouponLabel(4, 'semi-annually'), '4% per semester (8% p.a.)');
  });

  it('shows an annual coupon as p.a. and an unknown frequency as per period', function () {
    assert.strictEqual(formatPerPeriodCouponLabel(8, 'annually'), '8% p.a.');
    assert.strictEqual(formatPerPeriodCouponLabel(2.8, undefined), '2.8% per period');
  });
});
