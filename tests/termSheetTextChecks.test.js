/**
 * Term sheet text checks run after AI extraction.
 *
 * Fixture: text layer of BNP Paribas XS3508902627 (2Y Phoenix Snowball Worst-of on
 * ABI / DLTR / UL), as returned by pdf-parse. The model returned strike 100 and a
 * memory autocall; the document says strike 70 and a same-date autocall condition.
 */
import assert from 'assert';
import {
  detectStrikePercent,
  detectMemoryAutocall,
  extractISODates,
  applyAutocallTableDates,
  normalizeNonCallableRows
} from '../imports/api/termSheetTextChecks.js';

const BNP_TEXT = `Trade Date September 25th, 2026
Strike Date September 25th, 2026
Issue Date October 09th, 2026
Strike Price Anheuser-Busch InBev SA/NV - 47.3760 (70% of Share1Initial)
Dollar Tree Inc - 79.8490 (70% of Share2Initial)
Unilever PLC - 43.7780 (70% of Share3Initial)
Conditional Coupon (for
each Certificate)
If, on any Coupon Valuation Daten, the official closing price of each Underlying Share is greater
than or equal to 70% of ShareiInitial with i from 1 to 3, then a Coupon calculated as follows will be
N x 3.1250% x (1 + T)
n Coupon Valuation Daten Coupon Payment Daten
1 December 28th, 2026 January 12th, 2027
2 March 25th, 2027 April 12th, 2027
7 June 26th, 2028 July 10th, 2028
8 September 25th, 2028 October 09th, 2028
Automatic Early
Redemption
If, on any Automatic Early Redemption Valuation Daten, the official closing price of each Underlying
Share is greater than or equal to its Automatic Early Redemption Pricein, then the Issuer shall
redeem each Certificate on the relevant Automatic Early Redemption Daten at the Automatic
Early Redemption Amount calculated as follows:
N x 100%
1 March 25th, 2027 April 12th, 2027 100% x ShareiInitial with i
from 1 to 3
6 June 26th, 2028 July 10th, 2028 75% x ShareiInitial with i
from 1 to 3
Final Redemption On the Redemption Date, if the Certificates have not been automatically early redeemed or
purchased and cancelled by the Issuer prior to the Redemption Valuation Date, the Issuer shall
1) If WO ShareFinal is greater than or equal to 70% x WO ShareInitial:`;

describe('Term sheet text checks', function () {
  describe('detectStrikePercent', function () {
    it('reads the strike % from per-underlying Strike Price rows', function () {
      assert.strictEqual(detectStrikePercent(BNP_TEXT), 70);
    });

    it('handles other strike wordings', function () {
      assert.strictEqual(detectStrikePercent('Strike Level: 100%'), 100);
      assert.strictEqual(detectStrikePercent('Strike(k) (k from 1 to 2) means: 40% × S(0,k)'), 40);
      assert.strictEqual(detectStrikePercent('Strike Price DKK 623.40 (75.00%*)\nUSD 60.62 (75.00%*)\nNext Field'), 75);
    });

    it('ignores Strike Date and returns null when strike rows disagree', function () {
      assert.strictEqual(detectStrikePercent('Strike Date September 25th, 2026'), null);
      assert.strictEqual(detectStrikePercent('Strike Price A - 10 (70% of Initial)\nB - 20 (80% of Initial)'), null);
    });
  });

  describe('detectMemoryAutocall', function () {
    it('is false for a same-date autocall condition, even on a "Snowball" product', function () {
      assert.strictEqual(detectMemoryAutocall(BNP_TEXT), false);
    });

    it('is true when the condition refers to preceding dates', function () {
      const text = 'Automatic Early Redemption\nIf on any Valuation Date each Share closes at or above its level on such date or any preceding Valuation Date';
      assert.strictEqual(detectMemoryAutocall(text), true);
    });

    it('is null without an autocall section', function () {
      assert.strictEqual(detectMemoryAutocall('Final Redemption N x 100%'), null);
    });
  });

  describe('autocall table dates', function () {
    it('parses the date formats used in term sheets', function () {
      assert.deepStrictEqual(
        [...extractISODates('March 25th, 2027 | 26 March 2027 | 27/03/2027 | 2027-03-28')].sort(),
        ['2027-03-25', '2027-03-26', '2027-03-27', '2027-03-28']
      );
    });

    it('marks observations missing from the autocall table as non-callable', function () {
      const schedule = [
        { id: 'period_0', observationDate: '2026-12-28', isCallable: false, autocallLevel: 100 },
        { id: 'period_1', observationDate: '2027-03-25', isCallable: true, autocallLevel: 100 },
        { id: 'period_6', observationDate: '2028-06-26', isCallable: true, autocallLevel: 75 },
        { id: 'period_7', observationDate: '2028-09-25', isCallable: true, autocallLevel: 70 }
      ];
      const { schedule: checked, changed } = applyAutocallTableDates(schedule, BNP_TEXT);
      assert.deepStrictEqual(changed, ['period_7']);
      const rows = normalizeNonCallableRows(checked);
      assert.deepStrictEqual(rows.map(r => [r.isCallable, r.autocallLevel]), [
        [false, null], [true, 100], [true, 75], [false, null]
      ]);
    });

    it('leaves the schedule alone when the autocall dates cannot be matched', function () {
      const schedule = [{ id: 'period_0', observationDate: '2030-01-15', isCallable: true, autocallLevel: 100 }];
      assert.deepStrictEqual(applyAutocallTableDates(schedule, BNP_TEXT).changed, []);
    });
  });
});
