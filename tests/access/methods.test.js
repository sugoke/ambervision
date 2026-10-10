// Method isolation: identifiers supplied by the caller are checked against the
// caller's access scope, never trusted.
import assert from 'assert';
import '/server/methods/orderMethods.js';
import '/server/methods/performanceMethods.js';
import '/server/methods/clientDocumentMethods.js';
import { seedAccessFixtures, teardownAccessFixtures } from '../helpers/fixtures.js';
import { callMethod, tryMethod, hasMethod } from '../helpers/harness.js';
import { assertOnlyOwners } from '../helpers/assertScope.js';

const DELETED_METHODS = [
  'debug.findAlcoaAccount', 'debug.checkActualDataState', 'debug.analyzeEURDisplayIssue',
  'debug.checkEURAccountAlcoa', 'debug.simpleForceFixCurrency', 'debug.testCurrencyConversion',
  'debug.testConversionFunction', 'templates.debugServer', 'admin.debugBankAccounts',
  'admin.createMyBankAccount', 'products.create.clean', 'pmsHoldings.debugFullPublicationLogic',
  'pmsOperations.debugCount', 'products.debugPaths'
];

describe('access: methods', function () {
  this.timeout(120000);
  let F;
  before(async function () { F = await seedAccessFixtures(); });
  after(async function () { await teardownAccessFixtures(F); });

  const tok = (name) => F.tokens[name];
  const isDenied = (error) => !!error && /not-authorized|unauthorized|not authorized|outside|scope/i.test(`${error.error} ${error.reason} ${error.message}`);

  it('debug methods no longer exist', function () {
    for (const name of DELETED_METHODS) {
      assert.ok(!hasMethod(name), `${name} still registered`);
    }
  });

  it('orders.list: a client cannot read another client\'s orders', async function () {
    const own = await callMethod('orders.list', { filters: {}, pagination: { limit: 500 }, sessionId: tok('clientA') });
    const rows = own.orders || own.items || own;
    assertOnlyOwners(F, rows, ['A', 'J', 'W'], 'orders.list clientA');
    const widened = await callMethod('orders.list', { filters: { clientId: F.entities.entityB }, pagination: { limit: 500 }, sessionId: tok('clientA') });
    assertOnlyOwners(F, widened.orders || widened.items || widened, ['A', 'J', 'W'], 'orders.list clientA with foreign filter');
    const staff = await callMethod('orders.list', { filters: { clientId: F.entities.entityB }, pagination: { limit: 500 }, sessionId: tok('rmA') });
    const staffRows = staff.orders || staff.items || staff;
    assert.ok(staffRows.some(o => o.__testRun === F.runId), 'order book staff see every order');
    const intro = await tryMethod('orders.list', { filters: {}, pagination: {}, sessionId: tok('introducer') });
    assert.ok(isDenied(intro.error), 'introducer must be refused');
  });

  it('order helpers: account must belong to the client and client to the RM', async function () {
    const foreignAccount = await tryMethod('orders.getAccountHoldings', { clientId: F.entities.entityA, bankAccountId: F.accounts.acctB }, tok('rmA'));
    assert.ok(isDenied(foreignAccount.error), 'account of B for client A must be refused');
    const foreignClient = await tryMethod('orders.getAccountHoldings', { clientId: F.entities.entityB, bankAccountId: F.accounts.acctB }, tok('rmA'));
    assert.ok(isDenied(foreignClient.error), 'rmA probing B must be refused');
    const ok = await tryMethod('orders.getAccountHoldings', { clientId: F.entities.entityA, bankAccountId: F.accounts.acctA }, tok('rmA'));
    assert.ok(!ok.error, `rmA own client: ${ok.error?.message}`);
    const cash = await tryMethod('orders.getAccountCashBalance', { clientId: F.entities.entityA, bankAccountId: F.accounts.acctB }, tok('admin'));
    assert.ok(isDenied(cash.error), 'even admin cannot pair account B with client A');
    const client = await tryMethod('orders.getAccountHoldings', { clientId: F.entities.entityA, bankAccountId: F.accounts.acctA }, tok('clientA'));
    assert.ok(isDenied(client.error), 'clients cannot place orders');
  });

  it('performance: portfolio codes and view-as targets are checked against the scope', async function () {
    const foreign = await tryMethod('performance.getChartData', { sessionId: tok('clientA'), portfolioCode: '5040241' });
    assert.ok(isDenied(foreign.error) || foreign.result?.hasData === false, 'clientA must not read B history');
    const ownCode = await tryMethod('performance.getChartData', { sessionId: tok('clientA'), portfolioCode: '504024' });
    assert.ok(!ownCode.error, `own code: ${ownCode.error?.message}`);
    const rmForeign = await tryMethod('performance.getChartData', { sessionId: tok('rmA'), viewAsFilter: { type: 'entity', id: F.entities.entityB } });
    assert.ok(isDenied(rmForeign.error) || rmForeign.result?.hasData === false, 'rmA viewAs entityB must be refused');
    const twr = await tryMethod('performance.calculateTWR', { sessionId: tok('clientB'), portfolioCode: '504024' });
    assert.ok(isDenied(twr.error) || twr.result?.hasData === false, 'clientB TWR of A refused');
    const dates = await callMethod('snapshots.getAvailableDates', { sessionId: tok('clientA') });
    assert.ok(dates.success);
    const periods = await tryMethod('performance.getPeriods', { sessionId: tok('rmA'), viewAsFilter: { type: 'client', id: { $ne: null } } });
    assert.ok(periods.error, 'operator injection in viewAs must throw');
  });

  it('performance.getHoldingPeriodPerformance ignores keys outside the scope', async function () {
    const { PMSHoldingsCollection } = await import('/imports/api/pmsHoldings');
    const bRow = await PMSHoldingsCollection.findOneAsync({ _id: F.holdings.acctB[0] });
    const aRow = await PMSHoldingsCollection.findOneAsync({ _id: F.holdings.acctA[0] });
    const res = await callMethod('performance.getHoldingPeriodPerformance', {
      sessionId: tok('clientA'),
      holdings: [
        { uniqueKey: bRow.uniqueKey, portfolioCode: bRow.portfolioCode, portfolioCurrency: 'EUR', currentPrice: 100, currentValue: 1000 },
        { uniqueKey: aRow.uniqueKey, portfolioCode: aRow.portfolioCode, portfolioCurrency: 'EUR', currentPrice: 100, currentValue: 1000 }
      ]
    });
    assert.ok(!(bRow.uniqueKey in res), 'B uniqueKey must be dropped');
    assert.ok(aRow.uniqueKey in res, 'A uniqueKey kept');
  });

  it('client documents download: subject or in-scope staff only', async function () {
    const { ClientDocumentsCollection } = await import('/imports/api/clientDocuments.js');
    const docB = await ClientDocumentsCollection.findOneAsync({ __testRun: F.runId, bankAccountId: F.accounts.acctB });
    const rmA = await tryMethod('clientDocuments.getDownloadUrl', docB._id, tok('rmA'));
    assert.ok(isDenied(rmA.error), 'rmA cannot download B documents');
    const clientA = await tryMethod('clientDocuments.getDownloadUrl', docB._id, tok('clientA'));
    assert.ok(isDenied(clientA.error), 'clientA cannot download B documents');
  });
});
