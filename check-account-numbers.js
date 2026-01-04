/**
 * Utility script to check and display account numbers in bankAccounts collection
 * Run this with: meteor node check-account-numbers.js
 */

import { Meteor } from 'meteor/meteor';
import { BankAccountsCollection } from './imports/api/bankAccounts.js';
import { PMSHoldingsCollection } from './imports/api/pmsHoldings.js';

Meteor.startup(async () => {
  console.log('\n=== CHECKING ACCOUNT NUMBERS ===\n');

  // Get all bank accounts
  const bankAccounts = await BankAccountsCollection.find({ isActive: true }).fetchAsync();

  console.log(`Found ${bankAccounts.length} active bank accounts:\n`);

  bankAccounts.forEach((account, i) => {
    console.log(`${i + 1}. Account Number: "${account.accountNumber}"`);
    console.log(`   Bank: ${account.bankName || account.bankId}`);
    console.log(`   User ID: ${account.userId}`);
    console.log(`   Format Check: ${account.accountNumber.includes('-') ? '❌ Contains hyphen (WRONG - should be THIRD_CODE format)' : '✅ No hyphen (CORRECT)'}`);
    console.log('');
  });

  // Check what portfolio codes are in holdings
  console.log('\n=== PORTFOLIO CODES IN HOLDINGS ===\n');

  const holdings = await PMSHoldingsCollection.find({}).fetchAsync();
  const uniquePortfolioCodes = [...new Set(holdings.map(h => h.portfolioCode).filter(Boolean))];

  console.log(`Found ${uniquePortfolioCodes.length} unique portfolio codes in holdings:\n`);

  uniquePortfolioCodes.forEach((code, i) => {
    const matchingAccount = bankAccounts.find(acc => acc.accountNumber === code);
    console.log(`${i + 1}. Portfolio Code: "${code}"`);
    console.log(`   Matched to Account: ${matchingAccount ? '✅ YES' : '❌ NO - Holdings orphaned!'}`);
    if (matchingAccount) {
      console.log(`   Account belongs to user: ${matchingAccount.userId}`);
    }
    console.log('');
  });

  // Summary
  console.log('\n=== SUMMARY ===\n');
  const accountsWithHyphen = bankAccounts.filter(acc => acc.accountNumber.includes('-'));
  const orphanedCodes = uniquePortfolioCodes.filter(code =>
    !bankAccounts.some(acc => acc.accountNumber === code)
  );

  if (accountsWithHyphen.length > 0) {
    console.log(`⚠️  ${accountsWithHyphen.length} accounts have hyphens in account numbers (should be removed):`);
    accountsWithHyphen.forEach(acc => {
      const suggestedFix = acc.accountNumber.split('-')[0];
      console.log(`   - "${acc.accountNumber}" should be "${suggestedFix}"`);
    });
  } else {
    console.log('✅ All account numbers are in correct format (no hyphens)');
  }

  if (orphanedCodes.length > 0) {
    console.log(`\n⚠️  ${orphanedCodes.length} portfolio codes in holdings have no matching bank account:`);
    orphanedCodes.forEach(code => {
      console.log(`   - "${code}"`);
    });
    console.log('\n   These holdings will show as unmapped and not appear in user portfolios.');
  } else {
    console.log('\n✅ All portfolio codes have matching bank accounts');
  }

  console.log('\n=== CHECK COMPLETE ===\n');

  process.exit(0);
});
