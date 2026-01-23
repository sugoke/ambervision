/**
 * Migration Script: Activate Societe Generale Monaco Bank Connection
 *
 * Problem: Need to set up local file connection for Societe Generale Monaco.
 * SG deposits ZIP files directly to /mnt/HC_Volume_103962382/bankfiles/sg/prod/incoming
 *
 * File format: FIMFILE_FIM_IO_AMBERLAKE_DDMMYYYY.zip
 * Contains GPG-encrypted CSV files for positions, prices, transactions, etc.
 *
 * This script:
 * 1. Finds the Societe Generale Monaco bank
 * 2. Creates a local connection pointing to sg/prod/incoming
 * 3. Sets connection as active and connected
 *
 * Run from Meteor shell:
 *   meteor shell
 *   > require('./server/migrations/activateSGConnection.js').activateSGConnection()
 *
 * Or call as Meteor method:
 *   Meteor.call('migrations.activateSGConnection')
 */

import { Meteor } from 'meteor/meteor';
import { BankConnectionsCollection } from '../../imports/api/bankConnections.js';
import { BanksCollection } from '../../imports/api/banks.js';

export async function activateSGConnection() {
  console.log('[MIGRATION] Starting Societe Generale Monaco connection activation...');

  // Find the Societe Generale Monaco bank
  const sgBank = await BanksCollection.findOneAsync({
    $or: [
      { name: { $regex: /soci[eé]t[eé]\s*g[eé]n[eé]rale/i } },
      { name: { $regex: /sg\s*monaco/i } },
      { name: { $regex: /societe\s*generale/i } }
    ]
  });

  if (!sgBank) {
    console.log('[MIGRATION] Societe Generale Monaco bank not found in database');
    console.log('[MIGRATION] Searching for any bank with "generale" in name...');

    // Try a broader search
    const allBanks = await BanksCollection.find({}).fetchAsync();
    const matchingBanks = allBanks.filter(b =>
      b.name.toLowerCase().includes('generale') ||
      b.name.toLowerCase().includes('société') ||
      b.name.toLowerCase().includes('societe')
    );

    if (matchingBanks.length > 0) {
      console.log('[MIGRATION] Found potential matches:');
      matchingBanks.forEach(b => console.log(`  - ${b.name} (${b._id})`));
    }

    return { success: false, error: 'Societe Generale Monaco bank not found' };
  }

  console.log(`[MIGRATION] Found SG bank: ${sgBank.name} (${sgBank._id})`);

  // Find existing SG connection
  const sgConnection = await BankConnectionsCollection.findOneAsync({
    bankId: sgBank._id
  });

  if (!sgConnection) {
    console.log('[MIGRATION] No connection found for SG bank, creating one...');

    // Create a new local connection for SG
    const connectionId = await BankConnectionsCollection.insertAsync({
      bankId: sgBank._id,
      connectionName: 'SG Monaco Local',
      connectionType: 'local',
      localFolderName: 'sg/prod/incoming',
      host: null,
      port: 22,
      username: null,
      password: null,
      privateKeyPath: null,
      remotePath: '/',
      status: 'connected',
      isActive: true,
      lastConnection: new Date(),
      lastConnectionAttempt: new Date(),
      lastDownloadAt: null,
      lastProcessedAt: null,
      lastError: null,
      connectionCount: 0,
      seenLocalFiles: [], // Track processed ZIP files
      createdBy: 'migration',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log(`[MIGRATION] Created new SG connection: ${connectionId}`);
    console.log(`[MIGRATION]   - connectionType: local`);
    console.log(`[MIGRATION]   - localFolderName: sg/prod/incoming`);
    console.log(`[MIGRATION]   - status: connected`);
    console.log(`[MIGRATION]   - isActive: true`);

    return { success: true, action: 'created', connectionId };
  }

  console.log(`[MIGRATION] Found SG connection: ${sgConnection.connectionName}`);
  console.log(`[MIGRATION] Current state: isActive=${sgConnection.isActive}, localFolderName=${sgConnection.localFolderName}`);

  // Update the connection
  const updates = {
    isActive: true,
    localFolderName: 'sg/prod/incoming',
    connectionType: 'local',
    status: 'connected',
    updatedAt: new Date()
  };

  await BankConnectionsCollection.updateAsync(sgConnection._id, {
    $set: updates
  });

  console.log(`[MIGRATION] Updated SG connection:`);
  console.log(`[MIGRATION]   - isActive: true`);
  console.log(`[MIGRATION]   - localFolderName: sg/prod/incoming`);
  console.log(`[MIGRATION]   - connectionType: local`);
  console.log(`[MIGRATION]   - status: connected`);

  return {
    success: true,
    action: 'updated',
    connectionId: sgConnection._id,
    updates
  };
}

// Register as Meteor method for easy calling
Meteor.methods({
  async 'migrations.activateSGConnection'() {
    return await activateSGConnection();
  },

  // Reset seenLocalFiles to reprocess ZIP files
  async 'migrations.resetSGSeenFiles'() {
    console.log('[MIGRATION] Resetting SG seenLocalFiles...');

    const result = await BankConnectionsCollection.updateAsync(
      {
        $or: [
          { connectionName: { $regex: /sg/i } },
          { localFolderName: { $regex: /sg\//i } }
        ]
      },
      { $set: { seenLocalFiles: [] } }
    );

    console.log(`[MIGRATION] Reset seenLocalFiles for ${result} connection(s)`);
    return { success: true, updated: result };
  }
});
