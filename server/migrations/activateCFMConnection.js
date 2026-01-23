/**
 * Migration Script: Activate CFM Bank Connection
 *
 * Problem: CFM bank connection exists but is inactive, preventing file processing.
 * CFM deposits files directly to bankfiles/cfm/incoming on the server.
 *
 * This script:
 * 1. Finds the CFM bank connection
 * 2. Sets isActive to true
 * 3. Ensures localFolderName is set to 'cfm/incoming'
 *
 * Run from Meteor shell:
 *   meteor shell
 *   > require('./server/migrations/activateCFMConnection.js').activateCFMConnection()
 *
 * Or call as Meteor method:
 *   Meteor.call('migrations.activateCFMConnection')
 */

import { Meteor } from 'meteor/meteor';
import { BankConnectionsCollection } from '../../imports/api/bankConnections.js';
import { BanksCollection } from '../../imports/api/banks.js';

export async function activateCFMConnection() {
  console.log('[MIGRATION] Starting CFM connection activation...');

  // Find the CFM bank
  const cfmBank = await BanksCollection.findOneAsync({
    $or: [
      { name: { $regex: /cfm/i } },
      { name: { $regex: /indosuez/i } },
      { name: { $regex: /credit foncier/i } }
    ]
  });

  if (!cfmBank) {
    console.log('[MIGRATION] CFM bank not found in database');
    return { success: false, error: 'CFM bank not found' };
  }

  console.log(`[MIGRATION] Found CFM bank: ${cfmBank.name} (${cfmBank._id})`);

  // Find the CFM connection
  const cfmConnection = await BankConnectionsCollection.findOneAsync({
    bankId: cfmBank._id
  });

  if (!cfmConnection) {
    console.log('[MIGRATION] No connection found for CFM bank, creating one...');

    // Create a new local connection for CFM
    const connectionId = await BankConnectionsCollection.insertAsync({
      bankId: cfmBank._id,
      connectionName: 'CFM Local',
      connectionType: 'local',
      localFolderName: 'cfm/incoming',
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
      createdBy: 'migration',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log(`[MIGRATION] Created new CFM connection: ${connectionId}`);
    return { success: true, action: 'created', connectionId };
  }

  console.log(`[MIGRATION] Found CFM connection: ${cfmConnection.connectionName}`);
  console.log(`[MIGRATION] Current state: isActive=${cfmConnection.isActive}, localFolderName=${cfmConnection.localFolderName}`);

  // Update the connection
  const updates = {
    isActive: true,
    localFolderName: cfmConnection.localFolderName || 'cfm/incoming',
    status: 'connected',
    updatedAt: new Date()
  };

  await BankConnectionsCollection.updateAsync(cfmConnection._id, {
    $set: updates
  });

  console.log(`[MIGRATION] Updated CFM connection:`);
  console.log(`[MIGRATION]   - isActive: true`);
  console.log(`[MIGRATION]   - localFolderName: ${updates.localFolderName}`);
  console.log(`[MIGRATION]   - status: connected`);

  return {
    success: true,
    action: 'updated',
    connectionId: cfmConnection._id,
    updates
  };
}

// Register as Meteor method for easy calling
Meteor.methods({
  async 'migrations.activateCFMConnection'() {
    return await activateCFMConnection();
  }
});
