import assert from 'assert';
import { compareWithTermSheet, checkInternalDates } from '../server/helpers/termSheetAudit/compare.js';

const product = () => ({
  isin: 'CH1559716019', currency: 'EUR', issuer: 'Vontobel', denomination: 1000,
  tradeDate: '2026-05-18', valueDate: '2026-05-25', finalObservation: '2028-05-18', maturity: '2028-05-25',
  underlyings: [
    { ticker: 'KO', name: 'COCA COLA CO', strike: 80.82 },
    { ticker: 'OR', name: "L'Oreal SA", strike: 357.1 }
  ],
  structureParams: { couponRate: 2.375, protectionBarrierLevel: 75, memoryCoupon: true },
  scheduleConfig: { initialAutocallLevel: 100, initialCouponBarrier: 75, stepDownValue: 5 },
  observationSchedule: [
    { observationDate: '2026-08-18', valueDate: '2026-08-25' },
    { observationDate: '2026-11-18', valueDate: '2026-11-25' }
  ]
});
const facts = () => ({
  isin: 'CH1559716019', currency: 'EUR', issuer: 'Vontobel Financial Products Ltd., DIFC Dubai', denomination: 1000,
  tradeDate: '2026-05-18', valueDate: '2026-05-25', finalObservationDate: '2028-05-18', maturityDate: '2028-05-25',
  underlyings: [
    { name: 'Coca-Cola Company', ticker: 'KO UN Equity', initialReferencePrice: 80.82 },
    { name: "L´Oréal International", ticker: 'OR FP Equity', initialReferencePrice: 357.1 }
  ],
  protectionBarrierPct: 75, couponBarrierPct: 75, firstAutocallLevelPct: 100, autocallStepDownPct: 5, couponPerPeriodPct: 2.375, memoryCoupon: true,
  observationDates: [
    { valuationDate: '2026-08-18', paymentDate: '2026-08-25' },
    { valuationDate: '2026-11-18', paymentDate: '2026-11-25' },
    { valuationDate: '2028-05-18', paymentDate: '2028-05-25' }
  ]
});
const opts = { protectionBarrierOf: (p) => p.structureParams.protectionBarrierLevel };
const fields = (list) => list.map(f => f.field);

describe('term sheet audit', () => {
  it('finds nothing when the product matches its term sheet', () => {
    assert.deepStrictEqual(compareWithTermSheet(product(), facts(), opts), []);
    assert.deepStrictEqual(checkInternalDates(product()), []);
  });

  it('flags a date that differs, with the gap in days', () => {
    const p = product(); p.maturity = '2028-05-26';
    const out = compareWithTermSheet(p, facts(), opts);
    assert.deepStrictEqual(fields(out), ['maturity']);
    assert.strictEqual(out[0].note, '1 days');
  });

  it('flags a wrong initial level and recognises a pence/pound scale error', () => {
    const p = product(); p.underlyings[1].strike = 35710;
    const out = compareWithTermSheet(p, facts(), opts);
    assert.deepStrictEqual(fields(out), ['strike OR']);
    assert.ok(/pence/.test(out[0].note));
  });

  it('flags barrier, coupon and memory differences', () => {
    const p = product(); p.structureParams = { couponRate: 2.5, protectionBarrierLevel: 70, memoryCoupon: false };
    assert.deepStrictEqual(fields(compareWithTermSheet(p, facts(), opts)).sort(), ['couponRate', 'memoryCoupon', 'protectionBarrier']);
  });

  it('accepts the coupon stated per annum as well as per period', () => {
    const f = facts(); f.couponPerPeriodPct = null; f.couponPerAnnumPct = 2.375;
    assert.deepStrictEqual(compareWithTermSheet(product(), f, opts), []);
  });

  it('reports a missing and an extra underlying', () => {
    const p = product(); p.underlyings.push({ ticker: 'MSFT', name: 'Microsoft Corp', strike: 400 });
    const f = facts(); f.underlyings.push({ name: 'Carlsberg A/S', ticker: 'CARLB DC Equity', initialReferencePrice: 831.2 });
    const out = compareWithTermSheet(p, f, opts);
    assert.deepStrictEqual(out.map(o => o.note), ['In the product, not in the term sheet', 'In the term sheet, not in the product']);
  });

  it('compares observation dates, ignoring the final date', () => {
    const p = product(); p.observationSchedule.push({ observationDate: '2027-02-18', valueDate: '2027-02-25' });
    const out = compareWithTermSheet(p, facts(), opts);
    assert.deepStrictEqual(fields(out), ['observationDates']);
    assert.ok(out[0].note.includes('not in term sheet: 2027-02-18'));
  });

  it('flags a payment date that differs', () => {
    const p = product(); p.observationSchedule[0].valueDate = '2026-08-26';
    assert.deepStrictEqual(fields(compareWithTermSheet(p, facts(), opts)), ['paymentDates']);
  });

  it('does not flag what the term sheet does not state', () => {
    const f = { isin: null, tradeDate: null, underlyings: [], observationDates: [] };
    assert.deepStrictEqual(compareWithTermSheet(product(), f, opts), []);
  });

  it('checks the product dates for coherence on their own', () => {
    const p = product(); p.maturity = '2028-05-01'; p.observationSchedule.push({ observationDate: '2029-01-01', valueDate: '2029-01-08' });
    assert.deepStrictEqual(fields(checkInternalDates(p)), ['dates.order', 'observationSchedule.range']);
  });
});
