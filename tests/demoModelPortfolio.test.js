// The demo client's virtual model portfolio: sized once from the nominal at real
// prices, revalued daily from the banks' prices on the same instruments.
import assert from 'assert';
import { Random } from 'meteor/random';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PortfolioSnapshotsCollection } from '/imports/api/portfolioSnapshots';
import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { AllocationsCollection } from '/imports/api/allocations';
import {
  positionTargets, sizePosition, pickReferencePrice, todayUTC,
  launchDemoModelPortfolio, refreshDemoModelPortfolio, resetDemoModelPortfolio, getModelBook,
  MODEL_SLEEVES, MODEL_PORTFOLIO_CODE, MODEL_ACCOUNT_ID, DEMO_ENTITY_ID, DEMO_BANK_ID
} from '/server/helpers/demoModelPortfolio.js';

describe('demo model portfolio: sizing and reference prices', function () {
  it('splits the nominal in three equal sleeves, equal weights inside each', function () {
    const targets = positionTargets(9_000_000);
    const bySleeve = targets.reduce((acc, t) => { acc[t.sleeve] = (acc[t.sleeve] || 0) + t.targetEUR; return acc; }, {});
    for (const s of MODEL_SLEEVES) assert.ok(Math.abs(bySleeve[s.key] - 3_000_000) < 0.01, s.key);
    assert.strictEqual(targets.length, MODEL_SLEEVES.reduce((n, s) => n + s.isins.length, 0));
    const alternatives = targets.filter(t => t.sleeve === 'alternatives');
    assert.ok(alternatives.every(t => Math.abs(t.targetEUR - 1_000_000) < 0.01), 'gold, PE and hedge funds in equal thirds');
  });

  it('buys notes in whole denominations rounded down and funds in units, through the EUR factor', function () {
    assert.strictEqual(sizePosition({ targetEUR: 416_667, price: 1.004, eurPerLocal: 1, priceType: 'percentage' }), 415_000);
    assert.strictEqual(sizePosition({ targetEUR: 416_667, price: 0.98, eurPerLocal: 1, priceType: 'percentage', denomination: 5000 }), 425_000);
    assert.strictEqual(sizePosition({ targetEUR: 416_667, price: 1.0134, eurPerLocal: 1, priceType: 'percentage' }), 411_000, 'never above the target');
    assert.ok(sizePosition({ targetEUR: 416_667, price: 1.0134, eurPerLocal: 1, priceType: 'percentage' }) * 1.0134 <= 416_667);
    // USD fund at 262.89 with 1 USD = 0.8915 EUR
    assert.strictEqual(sizePosition({ targetEUR: 1_111_111, price: 262.89, eurPerLocal: 0.8915, priceType: 'absolute' }), 4740.913);
    assert.strictEqual(sizePosition({ targetEUR: 1000, price: 0, eurPerLocal: 1, priceType: 'absolute' }), 0);
  });

  it('takes the newest priced real row and the bank\'s own EUR conversion', function () {
    const ref = pickReferencePrice([
      { marketPrice: 262.1, priceDate: new Date('2026-10-10'), snapshotDate: new Date('2026-10-10'), currency: 'USD', marketValue: 100, marketValueOriginalCurrency: 112.17 },
      { marketPrice: 262.89, priceDate: new Date('2026-10-16'), snapshotDate: new Date('2026-10-19'), currency: 'USD', marketValue: 2556480.45, marketValueOriginalCurrency: 2867604.12, securityName: 'NCM', portfolioCode: 'A' },
      { marketPrice: 0, priceDate: new Date('2026-10-19'), currency: 'USD' },
      { marketPrice: 300, priceDate: new Date('2026-10-19'), currency: 'USD', isActive: false }
    ]);
    assert.strictEqual(ref.price, 262.89);
    assert.ok(Math.abs(ref.eurPerLocal - 1 / 1.1217) < 1e-4);
    assert.strictEqual(ref.sourcePortfolioCode, 'A');
    assert.strictEqual(pickReferencePrice([]), null);
    assert.strictEqual(pickReferencePrice([{ marketPrice: 1.01, currency: 'EUR', priceType: 'percentage' }]).eurPerLocal, 1);
  });
});

describe('demo model portfolio: launch and daily refresh', function () {
  this.timeout(60000);
  const tag = { __testRun: `model-${Random.id(6)}` };
  const realBank = `bank-${Random.id(6)}`;
  const isins = ['TESTNOTE000001', 'TESTFUND000001', 'TESTGOLD000001'];
  const sleeves = [
    { key: 'phoenix', label: 'Notes', weight: 1 / 3, isins: [isins[0]] },
    { key: 'capital_guaranteed', label: 'Funds', weight: 1 / 3, isins: [isins[1]] },
    { key: 'alternatives', label: 'Gold', weight: 1 / 3, isins: [isins[2]] }
  ];
  let createdDemoEntity = false;
  const d = (iso) => new Date(`${iso}T09:00:00Z`);

  const realRow = (isin, extra) => ({
    ...tag, bankId: realBank, portfolioCode: 'REAL-1', isin, isLatest: true, isActive: true, uniqueKey: `${isin}|${Random.id(6)}`,
    snapshotDate: new Date('2026-10-19T00:00:00Z'), priceDate: new Date('2026-10-19T00:00:00Z'), securityName: `Real ${isin}`, ...extra
  });

  before(async function () {
    if (!(await ClientEntitiesCollection.findOneAsync(DEMO_ENTITY_ID))) {
      await ClientEntitiesCollection.insertAsync({ _id: DEMO_ENTITY_ID, type: 'physical_person', status: 'active', isActive: true, isDemo: true, profile: { firstName: 'Demo', lastName: 'Portfolio' }, ...tag });
      createdDemoEntity = true;
    }
    await resetDemoModelPortfolio();
    await PMSHoldingsCollection.insertAsync(realRow(isins[0], { marketPrice: 1.004, priceType: 'percentage', currency: 'EUR', marketValue: 1004, marketValueOriginalCurrency: 1004, securityType: 'STRUCTURED_PRODUCT', assetClass: 'structured_product' }));
    await PMSHoldingsCollection.insertAsync(realRow(isins[1], { marketPrice: 29.05, priceType: 'absolute', currency: 'EUR', marketValue: 2905, marketValueOriginalCurrency: 2905, securityType: 'FUND', assetClass: 'private_equity' }));
    await PMSHoldingsCollection.insertAsync(realRow(isins[2], { marketPrice: 262.89, priceType: 'absolute', currency: 'USD', marketValue: 2000, marketValueOriginalCurrency: 2243.4, securityType: 'COMMODITY', assetClass: 'commodities' }));
  });

  after(async function () {
    await resetDemoModelPortfolio();
    await PMSHoldingsCollection.removeAsync(tag);
    if (createdDemoEntity) await ClientEntitiesCollection.removeAsync({ _id: DEMO_ENTITY_ID, ...tag });
  });

  it('launches at real prices, keeps the residual as cash, and writes day one', async function () {
    const result = await refreshDemoModelPortfolio({ now: d('2026-10-20'), nominalEUR: 3_000_000, sleeves });
    assert.strictEqual(result.launched, true);
    assert.strictEqual(result.positions, 3);
    assert.deepStrictEqual(result.stalePrices, []);

    const book = await getModelBook();
    assert.strictEqual(book.nominalEUR, 3_000_000);
    const note = book.positions.find(p => p.isin === isins[0]);
    assert.strictEqual(note.quantity, 996_000, 'note bought in whole thousands at 100.4%');
    const gold = book.positions.find(p => p.isin === isins[2]);
    assert.ok(Math.abs(gold.costEurPerLocal - 2000 / 2243.4) < 1e-6, 'USD converted with the bank\'s factor');
    const invested = book.positions.reduce((s, p) => s + p.costEUR, 0);
    assert.ok(Math.abs(invested + book.cashEUR - 3_000_000) < 1, 'nominal fully accounted for');
    assert.ok(book.cashEUR >= 0, 'the residual cash is never negative');
    assert.ok(Math.abs(result.totalAccountValue - 3_000_000) < 1, 'worth the nominal on day one');

    const account = await BankAccountsCollection.findOneAsync(MODEL_ACCOUNT_ID);
    assert.ok(account && account.isDemo && account.entityId === DEMO_ENTITY_ID && account.bankId === DEMO_BANK_ID);
    const rows = await PMSHoldingsCollection.find({ portfolioCode: MODEL_PORTFOLIO_CODE, isLatest: true }).fetchAsync();
    assert.strictEqual(rows.length, 4, 'three positions and the cash line');
    assert.ok(rows.every(r => r.isDemo && r.entityId === DEMO_ENTITY_ID && !r.userId));
    const snap = await PortfolioSnapshotsCollection.findOneAsync({ portfolioCode: MODEL_PORTFOLIO_CODE });
    assert.strictEqual(snap.snapshotDate.getTime(), todayUTC(d('2026-10-20')).getTime());
    assert.strictEqual(snap.totalCapitalInvested, 3_000_000);
    assert.strictEqual(snap.positionCount, 3);
  });

  it('is purely virtual: the central demo exclusion hides every row of it', async function () {
    const demo = await ClientEntityHelpers.getDemoExclusion();
    assert.ok(demo.entityIds.includes(DEMO_ENTITY_ID), 'the demo entity is excluded from client counts and aggregates');
    assert.ok(demo.bankAccountIds.includes(MODEL_ACCOUNT_ID), 'the model account is part of the exclusion');

    const hidden = await ClientEntityHelpers.hiddenHoldingsSelector();
    const visibleModelRows = await PMSHoldingsCollection.find({ $and: [{ portfolioCode: MODEL_PORTFOLIO_CODE }, hidden] }).countAsync();
    assert.strictEqual(visibleModelRows, 0, 'no model holding survives the exclusion used by AUM, dashboards and alerts');

    const visibleWhenDrilledIn = await PMSHoldingsCollection.find({
      $and: [{ portfolioCode: MODEL_PORTFOLIO_CODE }, await ClientEntityHelpers.hiddenHoldingsSelector({ exceptEntityId: DEMO_ENTITY_ID })]
    }).countAsync();
    assert.strictEqual(visibleWhenDrilledIn, 4, 'only an explicit View As on the demo shows it');

    const snapshotsOutsideDemo = await PortfolioSnapshotsCollection.find({ portfolioCode: MODEL_PORTFOLIO_CODE, entityId: { $nin: demo.entityIds } }).countAsync();
    assert.strictEqual(snapshotsOutsideDemo, 0, 'its snapshots are keyed to the demo entity the firm-wide aggregate skips');
  });

  it('revalues the next day as a new version and keeps a stale price flagged', async function () {
    // The note gains 2%, the fund row disappears from every real account
    await PMSHoldingsCollection.updateAsync({ ...tag, isin: isins[0] }, { $set: { marketPrice: 1.024, priceDate: new Date('2026-10-20T00:00:00Z') } });
    await PMSHoldingsCollection.updateAsync({ ...tag, isin: isins[1] }, { $set: { isActive: false } });

    const result = await refreshDemoModelPortfolio({ now: d('2026-10-21') });
    assert.strictEqual(result.launched, false);
    assert.deepStrictEqual(result.stalePrices, [isins[1]]);
    assert.strictEqual(result.rowsInserted, 4);
    assert.ok(result.totalAccountValue > 3_000_000, 'the note gain shows');

    const versions = await PMSHoldingsCollection.find({ uniqueKey: `DEMO::${MODEL_PORTFOLIO_CODE}::${isins[0]}` }).fetchAsync();
    assert.strictEqual(versions.length, 2);
    assert.strictEqual(versions.filter(v => v.isLatest).length, 1);
    const latest = versions.find(v => v.isLatest);
    assert.strictEqual(latest.marketPrice, 1.024);
    assert.strictEqual(latest.costPrice, 1.004, 'cost stays at the launch price');
    const fund = await PMSHoldingsCollection.findOneAsync({ uniqueKey: `DEMO::${MODEL_PORTFOLIO_CODE}::${isins[1]}`, isLatest: true });
    assert.strictEqual(fund.priceStale, true);
    assert.strictEqual(fund.marketPrice, 29.05);
    assert.strictEqual(await PortfolioSnapshotsCollection.find({ portfolioCode: MODEL_PORTFOLIO_CODE }).countAsync(), 2);

    // Same day again: updated in place, no new version or snapshot
    const again = await refreshDemoModelPortfolio({ now: d('2026-10-21') });
    assert.strictEqual(again.rowsInserted, 0);
    assert.strictEqual(again.rowsUpdated, 4);
    assert.strictEqual(await PortfolioSnapshotsCollection.find({ portfolioCode: MODEL_PORTFOLIO_CODE }).countAsync(), 2);
  });

  it('a second launch is refused; reset removes everything of the model only', async function () {
    await assert.rejects(() => launchDemoModelPortfolio({ nominalEUR: 1 }), /already launched/);
    const removed = await resetDemoModelPortfolio();
    assert.ok(removed.holdings >= 4 && removed.snapshots === 2 && removed.book === 1);
    assert.strictEqual(await AllocationsCollection.find({ bankAccountId: MODEL_ACCOUNT_ID }).countAsync(), 0);
    assert.strictEqual(await PMSHoldingsCollection.find(tag).countAsync(), 3, 'the real rows are untouched');
  });
});
