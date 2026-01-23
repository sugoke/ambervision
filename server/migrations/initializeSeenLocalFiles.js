/**
 * Migration Script: Initialize seenLocalFiles for Local Connections
 *
 * Problem: Local connections (like CFM) were reporting old files as "new" in emails
 * because the detection logic was based on database processing, not actual file presence.
 *
 * The fix changes local connections to track "seen" files like SFTP connections do.
 * This migration initializes the seenLocalFiles field with all current files so
 * the first run after the fix doesn't report all existing files as "new".
 *
 * Run from Meteor shell:
 *   meteor shell
 *   > require('./server/migrations/initializeSeenLocalFiles.js').initializeSeenLocalFiles()
 *
 * Or call as Meteor method:
 *   Meteor.call('migrations.initializeSeenLocalFiles')
 */

import { Meteor } from 'meteor/meteor';
import { BankConnectionsCollection } from '../../imports/api/bankConnections.js';
import fs from 'fs';
import path from 'path';

export async function initializeSeenLocalFiles() {
  console.log('[MIGRATION] Starting seenLocalFiles initialization for local connections...');

  // Find all local connections
  const localConnections = await BankConnectionsCollection.find({
    connectionType: 'local'
  }).fetchAsync();

  if (localConnections.length === 0) {
    console.log('[MIGRATION] No local connections found');
    return { success: true, updated: 0 };
  }

  console.log(`[MIGRATION] Found ${localConnections.length} local connection(s)`);

  const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
  let updatedCount = 0;

  for (const connection of localConnections) {
    console.log(`[MIGRATION] Processing: ${connection.connectionName}`);

    if (!connection.localFolderName) {
      console.log(`[MIGRATION]   - Skipping: no localFolderName set`);
      continue;
    }

    const folderPath = path.join(bankfilesRoot, connection.localFolderName);

    if (!fs.existsSync(folderPath)) {
      console.log(`[MIGRATION]   - Skipping: folder not found: ${folderPath}`);
      continue;
    }

    // Get all files in the folder
    const allFiles = fs.readdirSync(folderPath).filter(f => {
      const stat = fs.statSync(path.join(folderPath, f));
      return stat.isFile();
    });

    console.log(`[MIGRATION]   - Found ${allFiles.length} files in folder`);

    // Check if seenLocalFiles already exists
    if (connection.seenLocalFiles && connection.seenLocalFiles.length > 0) {
      console.log(`[MIGRATION]   - seenLocalFiles already set (${connection.seenLocalFiles.length} files), skipping`);
      continue;
    }

    // Update the connection with all current files as "seen"
    await BankConnectionsCollection.updateAsync(connection._id, {
      $set: { seenLocalFiles: allFiles }
    });

    console.log(`[MIGRATION]   - Initialized seenLocalFiles with ${allFiles.length} files`);
    updatedCount++;
  }

  console.log(`[MIGRATION] Complete: updated ${updatedCount} connection(s)`);

  return {
    success: true,
    updated: updatedCount,
    total: localConnections.length
  };
}

// Register as Meteor method for easy calling
Meteor.methods({
  async 'migrations.initializeSeenLocalFiles'() {
    return await initializeSeenLocalFiles();
  }
});
