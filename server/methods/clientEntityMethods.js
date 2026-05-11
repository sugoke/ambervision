import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import fs from 'fs';
import path from 'path';
import { ClientEntitiesCollection, ClientEntityHelpers, ENTITY_TYPES, ENTITY_STATUSES, STAKEHOLDER_ROLES } from '../../imports/api/clientEntities.js';
import { UserEntityAccessCollection, UserEntityAccessHelpers, ACCESS_LEVELS } from '../../imports/api/userEntityAccess.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES } from '../../imports/api/users.js';
import { BankAccountsCollection, BankAccountHelpers } from '../../imports/api/bankAccounts.js';

// Resolve base path for fichier_central (matches clientDocumentMethods.js)
const getEntitiesDocsBasePath = () => {
  if (process.env.FICHIER_CENTRAL_PATH) {
    return path.join(process.env.FICHIER_CENTRAL_PATH, 'entities');
  }
  let projectRoot = process.cwd();
  if (projectRoot.includes('.meteor')) {
    projectRoot = projectRoot.split('.meteor')[0].replace(/[\\\/]$/, '');
  }
  return path.join(projectRoot, 'public', 'fichier_central', 'entities');
};

// Helper: validate session and return current user
async function validateSession(sessionId) {
  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true,
    expiresAt: { $gt: new Date() }
  });

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  return user;
}

// Helper: check if user can manage entities
function canManageEntities(user) {
  return [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE].includes(user.role);
}

// Helper: check if user can manage a specific entity (admin or assigned RM)
async function canManageEntity(user, entityId) {
  if (canManageEntities(user)) return true;

  if (user.role === USER_ROLES.RELATIONSHIP_MANAGER || user.role === USER_ROLES.ASSISTANT) {
    const entity = await ClientEntitiesCollection.findOneAsync(entityId);
    if (!entity) return false;
    const assignedIds = entity.assignedUserIds || [];
    // Check new array field or legacy field
    if (assignedIds.includes(user._id)) return true;
    if (entity.relationshipManagerId === user._id) return true;
    // For assistants, also check their assigned RM IDs
    if (user.role === USER_ROLES.ASSISTANT) {
      const rmIds = user.assignedRmIds || [];
      return rmIds.some(id => assignedIds.includes(id) || id === entity.relationshipManagerId);
    }
    return false;
  }

  return false;
}

Meteor.methods({
  /**
   * Create a new client entity
   */
  async 'clientEntities.create'(data, sessionId) {
    check(sessionId, String);
    check(data, {
      type: Match.OneOf(...Object.values(ENTITY_TYPES)),
      status: Match.Maybe(Match.OneOf(...Object.values(ENTITY_STATUSES))),
      profile: Object,
      relationshipManagerId: Match.Maybe(String),
      referenceCurrency: Match.Maybe(String),
      stakeholders: Match.Maybe([Object])
    });

    const currentUser = await validateSession(sessionId);

    if (!canManageEntities(currentUser) &&
        currentUser.role !== USER_ROLES.RELATIONSHIP_MANAGER) {
      throw new Meteor.Error('not-authorized', 'Only admins and RMs can create entities');
    }

    // For RMs, default the relationshipManagerId to themselves
    const rmId = data.relationshipManagerId ||
      (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER ? currentUser._id : null);

    const entityId = await ClientEntityHelpers.createEntity({
      type: data.type,
      status: data.status || ENTITY_STATUSES.ACTIVE,
      profile: data.profile,
      relationshipManagerId: rmId,
      referenceCurrency: data.referenceCurrency || 'EUR',
      stakeholders: data.stakeholders || []
    });

    console.log(`[ClientEntity] Created entity ${entityId} of type ${data.type} by user ${currentUser._id}`);
    return entityId;
  },

  /**
   * Update a client entity
   */
  async 'clientEntities.update'(entityId, updates, sessionId) {
    check(entityId, String);
    check(updates, Object);
    check(sessionId, String);

    const currentUser = await validateSession(sessionId);

    if (!await canManageEntity(currentUser, entityId)) {
      throw new Meteor.Error('not-authorized', 'You do not have permission to edit this entity');
    }

    await ClientEntityHelpers.updateEntity(entityId, updates);
    console.log(`[ClientEntity] Updated entity ${entityId} by user ${currentUser._id}`);
    return entityId;
  },

  /**
   * Deactivate a client entity
   */
  async 'clientEntities.deactivate'(entityId, sessionId) {
    check(entityId, String);
    check(sessionId, String);

    const currentUser = await validateSession(sessionId);

    if (!canManageEntities(currentUser)) {
      throw new Meteor.Error('not-authorized', 'Only admins can deactivate entities');
    }

    await ClientEntityHelpers.deactivateEntity(entityId);
    // Also revoke all access
    await UserEntityAccessHelpers.revokeAllAccessForEntity(entityId);

    console.log(`[ClientEntity] Deactivated entity ${entityId} by user ${currentUser._id}`);
    return true;
  },

  /**
   * Update entity lifecycle status (prospect → active → archived)
   * When transitioning to ARCHIVED, archiveData (closure date + closure-letter PDF) is required.
   */
  async 'clientEntities.updateStatus'(entityId, status, sessionId, archiveData) {
    check(entityId, String);
    check(status, Match.OneOf(...Object.values(ENTITY_STATUSES)));
    check(sessionId, String);
    check(archiveData, Match.Maybe({
      closureDate: Match.OneOf(Date, String),
      fileName: String,
      base64Data: String,
      mimeType: String
    }));

    const currentUser = await validateSession(sessionId);

    if (!await canManageEntity(currentUser, entityId)) {
      throw new Meteor.Error('not-authorized', 'You do not have permission to change this entity status');
    }

    const setUpdates = { status, updatedAt: new Date() };

    if (status === ENTITY_STATUSES.ARCHIVED) {
      if (!archiveData) {
        throw new Meteor.Error('missing-archive-data', 'Closure date and closure-letter PDF are required when archiving a client.');
      }
      if (archiveData.mimeType !== 'application/pdf') {
        throw new Meteor.Error('invalid-file-type', 'Closure letter must be a PDF.');
      }

      const buffer = Buffer.from(archiveData.base64Data, 'base64');
      const baseDir = path.join(getEntitiesDocsBasePath(), entityId);
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

      const ts = Date.now();
      const ext = path.extname(archiveData.fileName) || '.pdf';
      const storedFileName = `closure_letter_${ts}${ext}`;
      const filePath = path.join(baseDir, storedFileName);
      fs.writeFileSync(filePath, buffer);

      setUpdates.archivedAt = typeof archiveData.closureDate === 'string'
        ? new Date(archiveData.closureDate)
        : archiveData.closureDate;
      setUpdates.archivedBy = currentUser._id;
      setUpdates.closureLetter = {
        fileName: archiveData.fileName,
        storedFileName,
        filePath,
        mimeType: archiveData.mimeType,
        fileSize: buffer.length,
        uploadedAt: new Date(),
        uploadedBy: currentUser._id
      };
    }

    await ClientEntitiesCollection.updateAsync(entityId, { $set: setUpdates });

    console.log(`[ClientEntity] Status changed to '${status}' for entity ${entityId} by user ${currentUser._id}`);
    return true;
  },

  /**
   * Grant a user access to a client entity
   */
  async 'userEntityAccess.grant'(userId, entityId, accessLevel, sessionId) {
    check(userId, String);
    check(entityId, String);
    check(accessLevel, Match.OneOf(...Object.values(ACCESS_LEVELS)));
    check(sessionId, String);

    const currentUser = await validateSession(sessionId);

    if (!canManageEntities(currentUser)) {
      throw new Meteor.Error('not-authorized', 'Only admins can manage access grants');
    }

    // Verify the target user and entity exist
    const targetUser = await UsersCollection.findOneAsync(userId);
    if (!targetUser) {
      throw new Meteor.Error('not-found', 'Target user not found');
    }

    const entity = await ClientEntitiesCollection.findOneAsync(entityId);
    if (!entity) {
      throw new Meteor.Error('not-found', 'Entity not found');
    }

    await UserEntityAccessHelpers.grantAccess(userId, entityId, accessLevel, currentUser._id);
    console.log(`[UserEntityAccess] Granted ${accessLevel} access: user ${userId} → entity ${entityId} by ${currentUser._id}`);
    return true;
  },

  /**
   * Revoke a user's access to a client entity
   */
  async 'userEntityAccess.revoke'(userId, entityId, sessionId) {
    check(userId, String);
    check(entityId, String);
    check(sessionId, String);

    const currentUser = await validateSession(sessionId);

    if (!canManageEntities(currentUser)) {
      throw new Meteor.Error('not-authorized', 'Only admins can manage access grants');
    }

    await UserEntityAccessHelpers.revokeAccess(userId, entityId);
    console.log(`[UserEntityAccess] Revoked access: user ${userId} → entity ${entityId} by ${currentUser._id}`);
    return true;
  },

  /**
   * Get entities accessible to the current user
   * Returns entities based on role and access grants
   */
  async 'clientEntities.getForCurrentUser'(sessionId) {
    check(sessionId, String);

    const currentUser = await validateSession(sessionId);

    const isAdmin = [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE].includes(currentUser.role);

    if (isAdmin) {
      return await ClientEntitiesCollection.find({ isActive: true }).fetchAsync();
    }

    if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      return await ClientEntitiesCollection.find({
        relationshipManagerId: currentUser._id,
        isActive: true
      }).fetchAsync();
    }

    if (currentUser.role === USER_ROLES.ASSISTANT) {
      const rmIds = currentUser.assignedRmIds || [];
      return await ClientEntitiesCollection.find({
        relationshipManagerId: { $in: rmIds },
        isActive: true
      }).fetchAsync();
    }

    // For all other roles, use access grants
    const entityIds = await UserEntityAccessHelpers.getEntityIdsForUser(currentUser._id);
    if (entityIds.length === 0) return [];

    return await ClientEntitiesCollection.find({
      _id: { $in: entityIds },
      isActive: true
    }).fetchAsync();
  },

  /**
   * Add a bank account to a client entity
   */
  async 'bankAccounts.addForEntity'(entityId, accountData, sessionId) {
    check(entityId, String);
    check(sessionId, String);
    check(accountData, Match.ObjectIncluding({
      bankId: String,
      accountNumber: String
    }));

    const currentUser = await validateSession(sessionId);

    if (!await canManageEntity(currentUser, entityId)) {
      throw new Meteor.Error('not-authorized', 'You do not have permission to add accounts to this entity');
    }

    // Validate beneficial owners exist if provided
    const uboIds = accountData.beneficialOwnerIds || [];
    for (const uboId of uboIds) {
      const beneficialOwner = await ClientEntitiesCollection.findOneAsync(uboId);
      if (!beneficialOwner) {
        throw new Meteor.Error('not-found', `Beneficial owner entity not found: ${uboId}`);
      }
    }

    const bankAccountId = await BankAccountHelpers.addEntityBankAccount(
      entityId,
      accountData.bankId,
      accountData.accountNumber,
      accountData.referenceCurrency || 'EUR',
      accountData.accountType || 'personal',
      accountData.accountStructure || 'direct',
      {
        name: accountData.name,
        lifeInsuranceCompany: accountData.lifeInsuranceCompany,
        relationshipManagerId: accountData.relationshipManagerId,
        backupRmIds: accountData.backupRmIds,
        beneficialOwnerIds: uboIds,
        authorizedOverdraft: accountData.authorizedOverdraft,
        comment: accountData.comment,
        authorizedEmail: accountData.authorizedEmail,
        authorizedCcEmails: accountData.authorizedCcEmails,
        authorizedPhone: accountData.authorizedPhone
      }
    );

    console.log(`[BankAccount] Created account ${bankAccountId} for entity ${entityId} by user ${currentUser._id}`);
    return bankAccountId;
  }
});
