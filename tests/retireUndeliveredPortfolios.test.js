// A bank file retires the accounts the bank has stopped delivering: current
// records of a portfolio code absent from the file and older than the gap are
// cleared, codes merely absent for a day are kept.
import assert from 'assert';
import { Random } from 'meteor/random';
import { PMSHoldingsCollection, PMSHoldingsHelpers } from '/imports/api/pmsHoldings';

const day = (iso) => new Date(`${iso}T00:00:00Z`);

describe('bank import: undelivered portfolios are retired', function () {
  this.timeout(30000);
  const bankId = `bank-${Random.id(6)}`;
  const otherBank = `bank-${Random.id(6)}`;
  const tag = { __testRun: bankId };

  const row = (portfolioCode, snapshot, extra = {}) => ({
    bankId, portfolioCode, snapshotDate: day(snapshot), isLatest: true, isActive: true,
    uniqueKey: `${portfolioCode}|${Random.id(8)}`, securityName: 'Cash EUR', currency: 'EUR', marketValue: 100, ...tag, ...extra
  });

  before(async function () {
    await PMSHoldingsCollection.insertAsync(row('303457', '2025-12-30'));          // renumbered away: retire
    await PMSHoldingsCollection.insertAsync(row('303457', '2025-12-24'));          // older record of the same dead code: retire
    await PMSHoldingsCollection.insertAsync(row('303457.001', '2026-10-19'));      // in the file: keep
    await PMSHoldingsCollection.insertAsync(row('777001', '2026-10-15'));          // absent today, seen 4 days ago: keep
    await PMSHoldingsCollection.insertAsync(row('888001', '2026-10-01'));          // absent for 18 days: retire
    await PMSHoldingsCollection.insertAsync(row('CONSOLIDATED', '2025-01-01'));    // roll-up rows are never touched
    await PMSHoldingsCollection.insertAsync({ ...row('303457', '2025-12-30'), isLatest: false }); // history: untouched
    await PMSHoldingsCollection.insertAsync({ ...row('303457', '2025-12-30'), bankId: otherBank, __testRun: bankId }); // another bank
  });

  after(async function () {
    await PMSHoldingsCollection.removeAsync(tag);
  });

  it('retires codes missing for more than the gap, keeps the rest', async function () {
    const result = await PMSHoldingsHelpers.retireUndeliveredPortfolios({
      bankId, fileDate: day('2026-10-19'), deliveredCodes: new Set(['303457.001'])
    });
    assert.deepStrictEqual(result.portfoliosRetired, ['303457', '888001']);
    assert.strictEqual(result.recordsRetired, 3);

    const current = await PMSHoldingsCollection.find({ ...tag, bankId, isLatest: true }).fetchAsync();
    assert.deepStrictEqual(current.map(r => r.portfolioCode).sort(), ['303457.001', '777001', 'CONSOLIDATED']);

    const retired = await PMSHoldingsCollection.find({ ...tag, bankId, retiredReason: 'portfolio_not_in_bank_files' }).fetchAsync();
    assert.strictEqual(retired.length, 3);
    assert.ok(retired.every(r => r.isActive === false && r.isLatest === false && r.retiredAt));

    const other = await PMSHoldingsCollection.findOneAsync({ ...tag, bankId: otherBank });
    assert.strictEqual(other.isLatest, true, 'another bank is never touched');
  });

  it('does nothing without a file date or delivered codes', async function () {
    const empty = await PMSHoldingsHelpers.retireUndeliveredPortfolios({ bankId, fileDate: day('2026-10-19'), deliveredCodes: [] });
    assert.strictEqual(empty.recordsRetired, 0);
    const noDate = await PMSHoldingsHelpers.retireUndeliveredPortfolios({ bankId, fileDate: 'nope', deliveredCodes: ['x'] });
    assert.strictEqual(noDate.recordsRetired, 0);
  });
});
