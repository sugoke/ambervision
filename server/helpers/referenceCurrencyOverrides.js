import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { CMBMonacoParser } from '/imports/api/parsers/cmbMonacoParser.js';

/**
 * Feed bankAccounts.referenceCurrency into the CMB parser's manual-override
 * map. The bank file itself has no explicit reference-currency column, and the
 * cash-row heuristic proved unstable (EUR/USD flip-flops on 302894.001) — the
 * account configuration maintained in the app is the authority.
 *
 * Overrides take precedence over auto-detection; detection remains the
 * fallback for accounts not yet configured. Call before any position parse
 * (startup + each sync) so the map stays fresh.
 */
export async function refreshReferenceCurrencyOverrides() {
  try {
    const accounts = await BankAccountsCollection.find(
      { referenceCurrency: { $exists: true, $nin: [null, ''] } },
      { fields: { accountNumber: 1, referenceCurrency: 1 } }
    ).fetchAsync();

    const overrides = {};
    for (const account of accounts) {
      if (!account.accountNumber) continue;
      const stripped = CMBMonacoParser.stripLeadingZeros(String(account.accountNumber));
      overrides[stripped] = account.referenceCurrency;
    }

    CMBMonacoParser.portfolioReferenceCurrencyOverrides = overrides;
    console.log(`[REF_CCY] Loaded ${Object.keys(overrides).length} reference-currency overrides from bankAccounts`);
  } catch (e) {
    console.error('[REF_CCY] Failed to refresh reference-currency overrides:', e.message);
  }
}
