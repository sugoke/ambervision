/**
 * Utility script to fix account numbers in bankAccounts collection
 * This removes the "-1" suffix from account numbers to match THIRD_CODE format
 *
 * BEFORE RUNNING:
 * 1. Run check-account-numbers.js first to see what will be changed
 * 2. Backup your database
 *
 * Run this with: meteor node fix-account-numbers.js
 */

import { Meteor } from 'meteor/meteor';
import { BankAccountsCollection } from './imports/api/bankAccounts.js';

Meteor.startup(async () => {
  console.log('\n=== FIXING ACCOUNT NUMBERS ===\n');

  // Get all bank accounts with hyphens
  const allAccounts = await BankAccountsCollection.find({ isActive: true }).fetchAsync();
  const accountsToFix = allAccounts.filter(acc => acc.accountNumber && acc.accountNumber.includes('-'));

  if (accountsToFix.length === 0) {
    console.log('✅ No accounts need fixing - all are in correct format!');
    console.log('\n=== FIX COMPLETE ===\n');
    process.exit(0);
    return;
  }

  console.log(`Found ${accountsToFix.length} accounts that need fixing:\n`);

  let fixedCount = 0;
  let errorCount = 0;

  for (const account of accountsToFix) {
    const oldAccountNumber = account.accountNumber;
    const newAccountNumber = oldAccountNumber.split('-')[0]; // Remove everything after first hyphen

    console.log(`Fixing: "${oldAccountNumber}" → "${newAccountNumber}"`);

    try {
      // Check if new account number already exists
      const existing = await BankAccountsCollection.findOneAsync({
        accountNumber: newAccountNumber,
        bankId: account.bankId,
        _id: { $ne: account._id }
      });

      if (existing) {
        console.log(`   ⚠️  SKIPPED: Account "${newAccountNumber}" already exists for this bank`);
        console.log(`      You may need to manually merge these accounts or delete duplicates`);
        errorCount++;
        continue;
      }

      // Update the account number
      await BankAccountsCollection.updateAsync(account._id, {
        $set: { accountNumber: newAccountNumber }
      });

      console.log(`   ✅ Updated successfully`);
      fixedCount++;

    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
      errorCount++;
    }

    console.log('');
  }

  // Summary
  console.log('\n=== FIX SUMMARY ===\n');
  console.log(`✅ Successfully fixed: ${fixedCount} accounts`);
  if (errorCount > 0) {
    console.log(`❌ Errors/Skipped: ${errorCount} accounts`);
  }
  console.log('\n=== FIX COMPLETE ===\n');
  console.log('Next steps:');
  console.log('1. Run check-account-numbers.js again to verify the fix');
  console.log('2. Refresh the PMS interface to see updated account numbers');
  console.log('3. Re-process position files if needed to map holdings correctly\n');

  process.exit(0);
});
