/**
 * Migration Script: Create Client Entities from Existing Users
 *
 * This migration separates "client identity" from "user login accounts" by:
 * 1. Creating clientEntity records from users with role client/life_insurance
 * 2. Creating userEntityAccess records linking each user to their entity
 * 3. Adding entityId to bankAccounts, pmsHoldings, portfolioSnapshots, orders, etc.
 *
 * IMPORTANT: This migration is ADDITIVE and REVERSIBLE.
 * Old userId fields are NEVER removed — entityId is added alongside.
 * Rollback method strips all entityId fields and drops new collections.
 *
 * Run from Meteor shell:
 *   meteor shell
 *   > require('./server/migrations/migrateToEntities.js').migrateToEntities()
 *
 * Verify:
 *   > require('./server/migrations/migrateToEntities.js').verifyEntityMigration()
 *
 * Rollback:
 *   > require('./server/migrations/migrateToEntities.js').rollbackEntityMigration()
 */

import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { Random } from 'meteor/random';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES } from '../../imports/api/users.js';
import { ClientEntitiesCollection, ENTITY_TYPES, ENTITY_STATUSES } from '../../imports/api/clientEntities.js';
import { UserEntityAccessCollection, ACCESS_LEVELS } from '../../imports/api/userEntityAccess.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { OrdersCollection } from '../../imports/api/orders.js';

/**
 * Main migration: Create entities from existing client/life_insurance users
 */
export async function migrateToEntities() {
  console.log('[ENTITY_MIGRATION] Starting migration to client entities...');

  // Check if migration has already been run
  const existingEntities = await ClientEntitiesCollection.find({}).countAsync();
  if (existingEntities > 0) {
    console.log(`[ENTITY_MIGRATION] WARNING: ${existingEntities} entities already exist. Skipping creation step.`);
    console.log('[ENTITY_MIGRATION] Run rollbackEntityMigration() first if you want to re-run.');
    return { success: false, reason: 'entities_already_exist', existingCount: existingEntities };
  }

  const stats = {
    entitiesCreated: 0,
    accessRecordsCreated: 0,
    bankAccountsUpdated: 0,
    holdingsUpdated: 0,
    snapshotsUpdated: 0,
    ordersUpdated: 0,
    errors: []
  };

  // Build userId → entityId mapping
  const userEntityMap = new Map();

  // Step 1: Create client entities from client users
  console.log('[ENTITY_MIGRATION] Step 1: Creating entities from client users...');

  const clientUsers = await UsersCollection.find({
    role: { $in: [USER_ROLES.CLIENT, USER_ROLES.LIFE_INSURANCE, USER_ROLES.PROSPECT] }
  }).fetchAsync();

  console.log(`[ENTITY_MIGRATION] Found ${clientUsers.length} client/life_insurance/prospect users to migrate`);

  for (const user of clientUsers) {
    try {
      const entityType = user.role === USER_ROLES.LIFE_INSURANCE
        ? ENTITY_TYPES.LIFE_INSURANCE
        : ENTITY_TYPES.PHYSICAL_PERSON;

      // Determine entity status from user role
      const entityStatus = user.role === USER_ROLES.PROSPECT
        ? ENTITY_STATUSES.PROSPECT
        : ENTITY_STATUSES.ACTIVE;

      const profile = {};

      if (entityType === ENTITY_TYPES.PHYSICAL_PERSON) {
        profile.firstName = user.profile?.firstName || user.firstName || '';
        profile.lastName = user.profile?.lastName || user.lastName || '';
        profile.birthday = user.profile?.birthday || null;
        profile.familyMembers = user.profile?.familyMembers || [];
        profile.preferredLanguage = user.profile?.preferredLanguage || 'en';
      } else {
        // Life insurance — use the name fields as company name
        const firstName = user.profile?.firstName || user.firstName || '';
        const lastName = user.profile?.lastName || user.lastName || '';
        profile.companyName = `${firstName} ${lastName}`.trim() || 'Unnamed Policy';
        profile.preferredLanguage = user.profile?.preferredLanguage || 'en';
      }

      // Check if user has company-specific fields (clientType, companyName, stakeholders)
      if (user.profile?.clientType === 'company' || user.profile?.companyName) {
        // Override to company type if user was marked as company
        const finalType = user.profile?.clientType === 'company' ? ENTITY_TYPES.COMPANY : entityType;

        if (finalType === ENTITY_TYPES.COMPANY) {
          profile.companyName = user.profile?.companyName || `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
          delete profile.firstName;
          delete profile.lastName;
        }
      }

      const entityData = {
        type: entityType,
        status: entityStatus,
        profile: {
          ...profile,
          createdAt: user.profile?.createdAt || user.createdAt || new Date(),
          updatedAt: new Date()
        },
        relationshipManagerId: user.relationshipManagerId || null,
        referenceCurrency: user.profile?.referenceCurrency || 'EUR',
        stakeholders: (user.profile?.stakeholders || []).map(s => ({
          ...s,
          _id: s._id || Random.id()
        })),
        migratedFromUserId: user._id,
        isActive: true,
        createdAt: user.profile?.createdAt || user.createdAt || new Date(),
        updatedAt: new Date()
      };

      const entityId = await ClientEntitiesCollection.insertAsync(entityData);
      userEntityMap.set(user._id, entityId);
      stats.entitiesCreated++;

      console.log(`[ENTITY_MIGRATION] Created entity ${entityId} (${entityType}) from user ${user._id} (${user.email || user.username})`);
    } catch (error) {
      stats.errors.push({ step: 'create_entity', userId: user._id, error: error.message });
      console.error(`[ENTITY_MIGRATION] Error creating entity for user ${user._id}:`, error.message);
    }
  }

  // Step 2: Create userEntityAccess records
  console.log('[ENTITY_MIGRATION] Step 2: Creating access records...');

  for (const [userId, entityId] of userEntityMap) {
    try {
      await UserEntityAccessCollection.insertAsync({
        userId,
        entityId,
        accessLevel: ACCESS_LEVELS.FULL,
        grantedBy: 'migration',
        grantedAt: new Date(),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      stats.accessRecordsCreated++;
    } catch (error) {
      stats.errors.push({ step: 'create_access', userId, entityId, error: error.message });
      console.error(`[ENTITY_MIGRATION] Error creating access for user ${userId}:`, error.message);
    }
  }

  // Step 3: Add entityId to bankAccounts
  console.log('[ENTITY_MIGRATION] Step 3: Updating bank accounts with entityId...');

  for (const [userId, entityId] of userEntityMap) {
    try {
      const result = await BankAccountsCollection.rawCollection().updateMany(
        { userId, entityId: { $exists: false } },
        { $set: { entityId } }
      );
      stats.bankAccountsUpdated += result.modifiedCount;
    } catch (error) {
      stats.errors.push({ step: 'update_bank_accounts', userId, error: error.message });
    }
  }

  // Step 4: Add entityId to pmsHoldings
  console.log('[ENTITY_MIGRATION] Step 4: Updating holdings with entityId...');

  for (const [userId, entityId] of userEntityMap) {
    try {
      const result = await PMSHoldingsCollection.rawCollection().updateMany(
        { userId, entityId: { $exists: false } },
        { $set: { entityId } }
      );
      stats.holdingsUpdated += result.modifiedCount;
      if (result.modifiedCount > 0) {
        console.log(`[ENTITY_MIGRATION] Updated ${result.modifiedCount} holdings for user ${userId} → entity ${entityId}`);
      }
    } catch (error) {
      stats.errors.push({ step: 'update_holdings', userId, error: error.message });
    }
  }

  // Step 5: Add entityId to portfolioSnapshots
  console.log('[ENTITY_MIGRATION] Step 5: Updating snapshots with entityId...');

  for (const [userId, entityId] of userEntityMap) {
    try {
      const result = await PortfolioSnapshotsCollection.rawCollection().updateMany(
        { userId, entityId: { $exists: false } },
        { $set: { entityId } }
      );
      stats.snapshotsUpdated += result.modifiedCount;
    } catch (error) {
      stats.errors.push({ step: 'update_snapshots', userId, error: error.message });
    }
  }

  // Step 6: Add entityId to orders
  console.log('[ENTITY_MIGRATION] Step 6: Updating orders with entityId...');

  for (const [userId, entityId] of userEntityMap) {
    try {
      const result = await OrdersCollection.rawCollection().updateMany(
        { clientId: userId, entityId: { $exists: false } },
        { $set: { entityId } }
      );
      stats.ordersUpdated += result.modifiedCount;
    } catch (error) {
      stats.errors.push({ step: 'update_orders', userId, error: error.message });
    }
  }

  console.log('[ENTITY_MIGRATION] Migration complete!');
  console.log('[ENTITY_MIGRATION] Stats:', JSON.stringify(stats, null, 2));

  return { success: true, stats };
}

/**
 * Verify the migration was successful
 */
export async function verifyEntityMigration() {
  console.log('[ENTITY_MIGRATION] Verifying migration...');

  const results = {
    entities: await ClientEntitiesCollection.find({}).countAsync(),
    accessRecords: await UserEntityAccessCollection.find({ isActive: true }).countAsync(),
    bankAccountsWithEntity: await BankAccountsCollection.find({ entityId: { $exists: true } }).countAsync(),
    bankAccountsWithoutEntity: await BankAccountsCollection.find({ entityId: { $exists: false }, isActive: true }).countAsync(),
    holdingsWithEntity: 0,
    holdingsWithoutEntity: 0,
    snapshotsWithEntity: 0,
    snapshotsWithoutEntity: 0,
    ordersWithEntity: 0,
    ordersWithoutEntity: 0
  };

  // Check holdings (only active/latest)
  results.holdingsWithEntity = await PMSHoldingsCollection.find({
    entityId: { $exists: true },
    isActive: true,
    isLatest: true
  }).countAsync();
  results.holdingsWithoutEntity = await PMSHoldingsCollection.find({
    entityId: { $exists: false },
    isActive: true,
    isLatest: true
  }).countAsync();

  // Check snapshots (recent only)
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  results.snapshotsWithEntity = await PortfolioSnapshotsCollection.find({
    entityId: { $exists: true },
    snapshotDate: { $gte: lastWeek }
  }).countAsync();
  results.snapshotsWithoutEntity = await PortfolioSnapshotsCollection.find({
    entityId: { $exists: false },
    snapshotDate: { $gte: lastWeek }
  }).countAsync();

  // Check orders
  results.ordersWithEntity = await OrdersCollection.find({
    entityId: { $exists: true }
  }).countAsync();
  results.ordersWithoutEntity = await OrdersCollection.find({
    entityId: { $exists: false },
    clientId: { $exists: true }
  }).countAsync();

  // Orphan checks
  const entityIds = (await ClientEntitiesCollection.find({}, { fields: { _id: 1 } }).fetchAsync()).map(e => e._id);
  results.bankAccountsWithInvalidEntity = await BankAccountsCollection.find({
    entityId: { $exists: true, $nin: entityIds },
    isActive: true
  }).countAsync();

  console.log('[ENTITY_MIGRATION] Verification results:', JSON.stringify(results, null, 2));

  const issues = [];
  if (results.bankAccountsWithoutEntity > 0) {
    issues.push(`${results.bankAccountsWithoutEntity} active bank accounts without entityId`);
  }
  if (results.holdingsWithoutEntity > 0) {
    issues.push(`${results.holdingsWithoutEntity} active holdings without entityId`);
  }
  if (results.bankAccountsWithInvalidEntity > 0) {
    issues.push(`${results.bankAccountsWithInvalidEntity} bank accounts with invalid entityId`);
  }

  if (issues.length > 0) {
    console.log('[ENTITY_MIGRATION] Issues found:', issues.join('; '));
  } else {
    console.log('[ENTITY_MIGRATION] No issues found!');
  }

  return { results, issues };
}

/**
 * Rollback: Remove all entity-related data
 */
export async function rollbackEntityMigration() {
  console.log('[ENTITY_MIGRATION] Rolling back entity migration...');

  const stats = {
    entitiesRemoved: 0,
    accessRecordsRemoved: 0,
    bankAccountsCleared: 0,
    holdingsCleared: 0,
    snapshotsCleared: 0,
    ordersCleared: 0
  };

  // Remove entityId from orders
  const ordersResult = await OrdersCollection.rawCollection().updateMany(
    { entityId: { $exists: true } },
    { $unset: { entityId: '' } }
  );
  stats.ordersCleared = ordersResult.modifiedCount;

  // Remove entityId from snapshots
  const snapshotsResult = await PortfolioSnapshotsCollection.rawCollection().updateMany(
    { entityId: { $exists: true } },
    { $unset: { entityId: '' } }
  );
  stats.snapshotsCleared = snapshotsResult.modifiedCount;

  // Remove entityId from holdings
  const holdingsResult = await PMSHoldingsCollection.rawCollection().updateMany(
    { entityId: { $exists: true } },
    { $unset: { entityId: '' } }
  );
  stats.holdingsCleared = holdingsResult.modifiedCount;

  // Remove entityId from bank accounts
  const bankResult = await BankAccountsCollection.rawCollection().updateMany(
    { entityId: { $exists: true } },
    { $unset: { entityId: '' } }
  );
  stats.bankAccountsCleared = bankResult.modifiedCount;

  // Drop access records
  const accessCount = await UserEntityAccessCollection.find({}).countAsync();
  await UserEntityAccessCollection.rawCollection().deleteMany({});
  stats.accessRecordsRemoved = accessCount;

  // Drop entities
  const entityCount = await ClientEntitiesCollection.find({}).countAsync();
  await ClientEntitiesCollection.rawCollection().deleteMany({});
  stats.entitiesRemoved = entityCount;

  console.log('[ENTITY_MIGRATION] Rollback complete!');
  console.log('[ENTITY_MIGRATION] Stats:', JSON.stringify(stats, null, 2));

  return { success: true, stats };
}

/**
 * Backfill: Set status='active' on existing entities that don't have a status field
 * and migrate prospect-role users to entities with status='prospect'
 */
export async function migrateStatusField() {
  console.log('[ENTITY_MIGRATION] Backfilling status field on existing entities...');

  // Step 1: Set status='active' on all entities missing the status field
  const backfillResult = await ClientEntitiesCollection.rawCollection().updateMany(
    { status: { $exists: false } },
    { $set: { status: ENTITY_STATUSES.ACTIVE } }
  );
  console.log(`[ENTITY_MIGRATION] Backfilled ${backfillResult.modifiedCount} entities with status='active'`);

  // Step 2: Migrate prospect-role users that haven't been migrated yet
  const prospectUsers = await UsersCollection.find({
    role: USER_ROLES.PROSPECT
  }).fetchAsync();

  let prospectsMigrated = 0;

  for (const user of prospectUsers) {
    // Check if already migrated
    const existing = await ClientEntitiesCollection.findOneAsync({ migratedFromUserId: user._id });
    if (existing) {
      // Just ensure the status is 'prospect'
      if (existing.status !== ENTITY_STATUSES.PROSPECT) {
        await ClientEntitiesCollection.updateAsync(existing._id, {
          $set: { status: ENTITY_STATUSES.PROSPECT }
        });
      }
      continue;
    }

    // Create entity from prospect user
    const profile = {
      firstName: user.profile?.firstName || '',
      lastName: user.profile?.lastName || '',
      birthday: user.profile?.birthday || null,
      preferredLanguage: user.profile?.preferredLanguage || 'en',
      createdAt: user.profile?.createdAt || user.createdAt || new Date(),
      updatedAt: new Date()
    };

    await ClientEntitiesCollection.insertAsync({
      type: ENTITY_TYPES.PHYSICAL_PERSON,
      status: ENTITY_STATUSES.PROSPECT,
      profile,
      relationshipManagerId: user.relationshipManagerId || null,
      referenceCurrency: user.profile?.referenceCurrency || 'EUR',
      stakeholders: [],
      migratedFromUserId: user._id,
      isActive: true,
      createdAt: user.profile?.createdAt || user.createdAt || new Date(),
      updatedAt: new Date()
    });
    prospectsMigrated++;
  }

  console.log(`[ENTITY_MIGRATION] Migrated ${prospectsMigrated} prospect users to entities`);
  return { backfilled: backfillResult.modifiedCount, prospectsMigrated };
}

// Also register as Meteor methods for admin access via the app
Meteor.methods({
  async 'migration.createEntities'(sessionId) {
    check(sessionId, String);

    // Only superadmin can run migrations
    const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
    if (!session) throw new Meteor.Error('not-authorized', 'Invalid session');

    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user || user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only superadmin can run migrations');
    }

    return await migrateToEntities();
  },

  async 'migration.verifyEntities'(sessionId) {
    check(sessionId, String);

    const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
    if (!session) throw new Meteor.Error('not-authorized', 'Invalid session');

    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user || user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only superadmin can verify migrations');
    }

    return await verifyEntityMigration();
  },

  async 'migration.migrateStatus'(sessionId) {
    check(sessionId, String);

    const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
    if (!session) throw new Meteor.Error('not-authorized', 'Invalid session');

    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user || user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only superadmin can run migrations');
    }

    return await migrateStatusField();
  },

  async 'migration.rollbackEntities'(sessionId) {
    check(sessionId, String);

    const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
    if (!session) throw new Meteor.Error('not-authorized', 'Invalid session');

    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user || user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only superadmin can rollback migrations');
    }

    return await rollbackEntityMigration();
  }
});
