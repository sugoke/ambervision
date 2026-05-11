import React, { useState, useEffect } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { UsersCollection, USER_ROLES } from '../api/users.js';
import { ClientEntitiesCollection, ClientEntityHelpers, ENTITY_TYPES, ENTITY_STATUSES } from '../api/clientEntities.js';
import { UserEntityAccessCollection, ACCESS_LEVELS } from '../api/userEntityAccess.js';
import { BankAccountsCollection } from '../api/bankAccounts.js';
import { BanksCollection } from '../api/banks.js';
import { AccountProfilesCollection, PROFILE_TEMPLATES, aggregateToFourCategories } from '../api/accountProfiles.js';
import { PortfolioSnapshotsCollection } from '../api/portfolioSnapshots.js';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import ClientDocumentManager from './components/ClientDocumentManager.jsx';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';
import { useTheme } from './ThemeContext.jsx';

// Validators for authorized contact fields on bank accounts
const AUTHORIZED_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

// Map bank names to their logo files in public/images/logos_banks/
const getBankLogoPath = (bankName) => {
  if (!bankName) return null;
  // Normalize to remove accents (é -> e, etc.) and convert to lowercase
  const name = bankName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (name.includes('julius') || name.includes('baer')) {
    return '/images/logos_banks/jb.png';
  }
  if (name.includes('andbank')) {
    return '/images/logos_banks/andbank.png';
  }
  if (name.includes('cfm') || name.includes('credit foncier') || name.includes('indosuez')) {
    return '/images/logos_banks/cfm.png';
  }
  if (name.includes('societe generale') || name.includes('sgmc')) {
    return '/images/logos_banks/SGMC.png';
  }
  if (name.includes('edmond') || name.includes('rothschild')) {
    return '/images/logos_banks/EDRMC.png';
  }
  if (name.includes('cmb')) {
    return '/images/logos_banks/cmb.jpg';
  }
  return null; // No logo available - will use fallback emoji
};

export default function UserDetailsScreen({ userId, entityId = null, onBack, embedded = false }) {
  const { isDark: isDarkMode } = useTheme(); // v2
  const sessionId = localStorage.getItem('sessionId');

  const { dialogState, showConfirm, hideDialog } = useDialog();

  // State for editing sections
  const [editingBasicInfo, setEditingBasicInfo] = useState(false);
  const [editingRM, setEditingRM] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordResetSuccess, setPasswordResetSuccess] = useState(false);
  const [editingRole, setEditingRole] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    birthday: '',
    preferredLanguage: 'en',
    referenceCurrency: 'EUR',
    relationshipManagerId: '',
    newPassword: '',
    clientType: 'natural',
    companyName: ''
  });

  // Stakeholders state (UBO, directors) for company clients
  const [stakeholders, setStakeholders] = useState([]);
  const [showAddStakeholder, setShowAddStakeholder] = useState(false);
  const [newStakeholder, setNewStakeholder] = useState({
    entityId: '',
    name: '',
    role: 'ubo',
    ownership: '',
    notes: ''
  });

  // Bank account creation state
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({
    name: '',
    bankId: '',
    accountNumber: '',
    referenceCurrency: 'USD',
    accountType: 'personal',
    accountStructure: 'direct',
    lifeInsuranceCompany: '',
    relationshipManagerId: '',
    backupRmIds: [],
    beneficialOwnerIds: [],
    comment: '',
    authorizedEmail: '',
    authorizedCcEmails: [],
    authorizedPhone: ''
  });
  const [newAccountCcInput, setNewAccountCcInput] = useState('');
  const [editAccountCcInput, setEditAccountCcInput] = useState('');

  // Bank account edit state
  const [editingBankAccount, setEditingBankAccount] = useState(null);
  const [expandedAccountId, setExpandedAccountId] = useState(null);
  const [editBankAccountData, setEditBankAccountData] = useState({});

  // Current user state (fetched via auth method since sessions are in separate collection)
  const [currentUser, setCurrentUser] = useState(null);

  // Archive client modal state (closure date + closure-letter PDF)
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveClosureDate, setArchiveClosureDate] = useState('');
  const [archiveClosureFile, setArchiveClosureFile] = useState(null);
  const [archiveError, setArchiveError] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);

  // Fetch current user on mount
  useEffect(() => {
    if (sessionId) {
      Meteor.call('auth.getCurrentUser', sessionId, (err, user) => {
        if (!err && user) {
          setCurrentUser(user);
        }
      });
    }
  }, [sessionId]);

  // Family member state
  const [showAddFamilyMember, setShowAddFamilyMember] = useState(false);
  const [newFamilyMember, setNewFamilyMember] = useState({
    name: '',
    relationship: 'spouse',
    birthday: ''
  });

  // Per-account investment profile state
  // Key: bankAccountId, Value: { maxCash, maxBonds, maxEquities, maxAlternative }
  const [editingAccountProfile, setEditingAccountProfile] = useState(null); // accountId being edited
  const [accountProfileDraft, setAccountProfileDraft] = useState({
    profileName: '',
    maxCash: 0,
    maxBonds: 0,
    maxEquities: 0,
    maxAlternative: 0,
    isProfessionalInvestor: false
  });

  // Tab navigation state
  const [activeTab, setActiveTab] = useState('info');

  // KYC Risk Score state
  const [editingRiskScore, setEditingRiskScore] = useState(false);
  const [savingRiskScore, setSavingRiskScore] = useState(false);
  const [riskScoreModalOpen, setRiskScoreModalOpen] = useState(false);

  // RM's clients state (for viewing RM profiles)
  const [rmClients, setRmClients] = useState([]);
  const [rmClientsLoading, setRmClientsLoading] = useState(false);

  // Introducer's accounts state (for viewing Introducer profiles)
  const [introducerAccounts, setIntroducerAccounts] = useState([]);
  const [introducerAccountsLoading, setIntroducerAccountsLoading] = useState(false);

  // Subscribe to data
  const { user, entity, allEntities, linkedEntities, linkedUsers, bankAccounts, relationshipManagers, introducers, banks, accountProfiles, portfolioSnapshots, isLoading } = useTracker(() => {
    const userHandle = Meteor.subscribe('customUsers');
    const banksHandle = Meteor.subscribe('banks');
    const bankAccountsHandle = Meteor.subscribe('allBankAccounts');
    const entityHandle = Meteor.subscribe('clientEntities', sessionId);
    if (userId || entityId) {
      Meteor.subscribe('accountProfiles', sessionId, userId, entityId);
      if (userId) {
        Meteor.subscribe('portfolioSnapshots', sessionId, {}, { type: 'client', id: userId });
      }
    }

    const userData = userId ? UsersCollection.findOne(userId) : null;
    const rms = UsersCollection.find({ role: { $in: [USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.SUPERADMIN] } }).fetch();
    const introducersData = UsersCollection.find({ role: USER_ROLES.INTRODUCER }).fetch();
    const banksData = BanksCollection.find().fetch();

    // Bank accounts: prefer entityId query, fall back to userId
    const accountQuery = entityId
      ? { entityId, isActive: true }
      : userId ? { userId, isActive: true } : { _id: null };
    const accountsData = BankAccountsCollection.find(accountQuery).fetch();

    // Get account profiles for this user's accounts
    const accountIds = accountsData.map(a => a._id);
    const profilesData = AccountProfilesCollection.find({
      bankAccountId: { $in: accountIds }
    }).fetch();

    // Get portfolio snapshots
    const snapshotsQuery = entityId
      ? { entityId, portfolioCode: { $ne: 'CONSOLIDATED' } }
      : userId ? { userId, portfolioCode: { $ne: 'CONSOLIDATED' } } : { _id: null };
    const snapshotsData = PortfolioSnapshotsCollection.find(snapshotsQuery).fetch();

    // Get entity data if entityId prop is provided
    const entityData = entityId ? ClientEntitiesCollection.findOne(entityId) : null;

    // All entities (for beneficial owner picker)
    const allEntitiesData = ClientEntitiesCollection.find({ isActive: true }).fetch();

    // Get linked entities for this user account (via access grants)
    const userAccessRecords = userId ? UserEntityAccessCollection.find({ userId, isActive: true }).fetch() : [];
    const linkedEntityIds = userAccessRecords.map(a => a.entityId);
    const linkedEntitiesData = linkedEntityIds.length > 0
      ? ClientEntitiesCollection.find({ _id: { $in: linkedEntityIds } }).fetch().map(e => ({
          ...e,
          accessLevel: userAccessRecords.find(a => a.entityId === e._id)?.accessLevel || 'full'
        }))
      : [];

    // Get linked users for this entity (if viewing entity)
    const entityAccessRecords = entityId ? UserEntityAccessCollection.find({ entityId, isActive: true }).fetch() : [];
    const linkedUserIds = entityAccessRecords.map(a => a.userId);
    const linkedUsersData = linkedUserIds.length > 0
      ? UsersCollection.find({ _id: { $in: linkedUserIds } }).fetch().map(u => ({
          ...u,
          accessLevel: entityAccessRecords.find(a => a.userId === u._id)?.accessLevel || 'full'
        }))
      : [];

    return {
      user: userData,
      entity: entityData,
      allEntities: allEntitiesData,
      linkedEntities: linkedEntitiesData,
      linkedUsers: linkedUsersData,
      bankAccounts: accountsData,
      relationshipManagers: rms,
      introducers: introducersData,
      banks: banksData,
      accountProfiles: profilesData,
      portfolioSnapshots: snapshotsData,
      isLoading: !userHandle.ready() || !banksHandle.ready() || !bankAccountsHandle.ready()
    };
  }, [userId, entityId, sessionId]);

  // Update form data when user or entity data loads
  useEffect(() => {
    if (entity && !user) {
      // Entity-only mode: populate from entity profile
      setFormData({
        email: '',
        firstName: entity.profile?.firstName || '',
        lastName: entity.profile?.lastName || '',
        birthday: entity.profile?.birthday ? new Date(entity.profile.birthday).toISOString().split('T')[0] : '',
        preferredLanguage: entity.profile?.preferredLanguage || 'en',
        referenceCurrency: entity.referenceCurrency || 'EUR',
        relationshipManagerId: entity.relationshipManagerId || '',
        assignedUserIds: entity.assignedUserIds || (entity.relationshipManagerId ? [entity.relationshipManagerId] : []),
        isInsurance: entity.isInsurance || false,
        newPassword: '',
        clientType: entity.type === ENTITY_TYPES.COMPANY ? 'company' : 'natural',
        companyName: entity.profile?.companyName || ''
      });
      setStakeholders(entity.stakeholders || []);
    } else if (user) {
      setFormData({
        email: user.email || user.username || '',
        firstName: user.profile?.firstName || '',
        lastName: user.profile?.lastName || '',
        birthday: user.profile?.birthday ? new Date(user.profile.birthday).toISOString().split('T')[0] : '',
        preferredLanguage: user.profile?.preferredLanguage || 'en',
        referenceCurrency: user.profile?.referenceCurrency || 'EUR',
        relationshipManagerId: user.relationshipManagerId || '',
        newPassword: '',
        clientType: user.profile?.clientType || 'natural',
        companyName: user.profile?.companyName || ''
      });
      setStakeholders(user.profile?.stakeholders || []);
    }
  }, [user, entity]);

  // Fetch RM's clients when viewing an RM profile
  useEffect(() => {
    if (user && user.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      setRmClientsLoading(true);
      // Fetch all clients assigned to this RM
      const clients = UsersCollection.find({
        role: USER_ROLES.CLIENT,
        relationshipManagerId: userId,
        isActive: { $ne: false }
      }, {
        sort: { 'profile.lastName': 1, 'profile.firstName': 1 }
      }).fetch();
      setRmClients(clients);
      setRmClientsLoading(false);
    }
  }, [user, userId]);

  // Fetch accounts introduced by this introducer when viewing an Introducer profile
  useEffect(() => {
    if (user && user.role === USER_ROLES.INTRODUCER) {
      setIntroducerAccountsLoading(true);
      // Fetch all bank accounts introduced by this introducer
      const accounts = BankAccountsCollection.find({
        introducerId: userId,
        isActive: true
      }).fetch();

      // Enrich with client info
      const enrichedAccounts = accounts.map(account => {
        const client = UsersCollection.findOne(account.userId);
        const bank = BanksCollection.findOne(account.bankId);
        return {
          ...account,
          clientName: client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() : 'Unknown',
          clientId: client?._id,
          bankName: bank?.name || 'Unknown Bank'
        };
      });

      setIntroducerAccounts(enrichedAccounts);
      setIntroducerAccountsLoading(false);
    }
  }, [user, userId]);

  // Handlers
  const handleSaveBasicInfo = async () => {
    try {
      await Meteor.callAsync('users.updateProfile', userId, {
        email: formData.email,
        profile: {
          ...user.profile,
          firstName: formData.firstName,
          lastName: formData.lastName,
          birthday: formData.birthday ? new Date(formData.birthday) : null,
          preferredLanguage: formData.preferredLanguage,
          referenceCurrency: formData.referenceCurrency,
          clientType: formData.clientType,
          companyName: formData.clientType === 'company' ? formData.companyName : '',
          stakeholders: formData.clientType === 'company' ? stakeholders : [],
          updatedAt: new Date()
        }
      }, sessionId);

      setEditingBasicInfo(false);

    } catch (error) {
      console.error('Error updating user:', error);
    }
  };

  const handleSaveRM = async () => {
    try {
      if (entityId && !userId) {
        // Entity mode: update entity RM
        await Meteor.callAsync('clientEntities.update', entityId, {
          assignedUserIds: formData.assignedUserIds || [],
          relationshipManagerId: (formData.assignedUserIds || [])[0] || null
        }, sessionId);
      } else {
        await Meteor.callAsync('users.updateProfile', userId, {
          relationshipManagerId: formData.relationshipManagerId || null
        }, sessionId);
      }

      setEditingRM(false);

    } catch (error) {
      console.error('Error updating RM:', error);
    }
  };

  const handleResetPassword = async () => {
    if (!formData.newPassword || formData.newPassword.length < 6) {
      return;
    }

    try {
      await Meteor.callAsync('users.adminResetPassword', userId, formData.newPassword, sessionId);

      setFormData({ ...formData, newPassword: '' });
      setEditingPassword(false);
      setPasswordResetSuccess(true);

      // Auto-hide success message after 5 seconds
      setTimeout(() => setPasswordResetSuccess(false), 5000);

    } catch (error) {
      console.error('Error resetting password:', error);
    }
  };

  const handleSaveRole = async () => {
    if (!selectedRole || selectedRole === user?.role) {
      setEditingRole(false);
      return;
    }

    try {
      await Meteor.callAsync('users.updateRole', userId, selectedRole, sessionId);
      setEditingRole(false);
      setSelectedRole(null);
    } catch (error) {
      console.error('Error updating role:', error);
    }
  };

  const handleAddBankAccount = async () => {
    if (!newAccount.bankId || !newAccount.accountNumber) {
      return;
    }

    const trimmedEmail = (newAccount.authorizedEmail || '').trim();
    if (trimmedEmail && !AUTHORIZED_EMAIL_REGEX.test(trimmedEmail)) {
      alert('Authorized email is not a valid email address.');
      return;
    }
    const trimmedPhone = (newAccount.authorizedPhone || '').trim();
    if (trimmedPhone && !E164_PHONE_REGEX.test(trimmedPhone)) {
      alert('Authorized phone must be in E.164 format (e.g. +33612345678).');
      return;
    }
    const cleanedCcEmails = (newAccount.authorizedCcEmails || [])
      .map(e => (typeof e === 'string' ? e.trim() : ''))
      .filter(e => e.length > 0);
    for (const cc of cleanedCcEmails) {
      if (!AUTHORIZED_EMAIL_REGEX.test(cc)) {
        alert(`CC email is not valid: ${cc}`);
        return;
      }
    }

    try {
      if (entityId) {
        // Entity mode: use entity-specific method
        // Auto-set accountType based on entity type
        const effectiveAccountType = entity?.type === ENTITY_TYPES.COMPANY ? 'company' : 'personal';
        await Meteor.callAsync('bankAccounts.addForEntity', entityId, {
          name: newAccount.name || fullName,
          bankId: newAccount.bankId,
          accountNumber: newAccount.accountNumber,
          referenceCurrency: newAccount.referenceCurrency,
          accountType: effectiveAccountType,
          accountStructure: newAccount.accountStructure || 'direct',
          lifeInsuranceCompany: newAccount.lifeInsuranceCompany || null,
          relationshipManagerId: newAccount.relationshipManagerId || null,
          backupRmIds: (newAccount.backupRmIds || []).filter(id => id),
          beneficialOwnerIds: (newAccount.beneficialOwnerIds || []).filter(id => id),
          comment: newAccount.comment || null,
          authorizedEmail: trimmedEmail || null,
          authorizedCcEmails: cleanedCcEmails,
          authorizedPhone: trimmedPhone || null
        }, sessionId);
      } else {
        // Legacy user mode
        await Meteor.callAsync('bankAccounts.create', {
          userId,
          ...newAccount,
          authorizedEmail: trimmedEmail || null,
          authorizedCcEmails: cleanedCcEmails,
          authorizedPhone: trimmedPhone || null,
          sessionId
        });
      }

      setNewAccount({
        bankId: '',
        accountNumber: '',
        referenceCurrency: 'USD',
        accountType: 'personal',
        accountStructure: 'direct',
        lifeInsuranceCompany: '',
        relationshipManagerId: '',
        backupRmIds: [],
        beneficialOwnerIds: [],
        comment: '',
        authorizedEmail: '',
        authorizedCcEmails: [],
        authorizedPhone: ''
      });
      setNewAccountCcInput('');
      setShowAddAccount(false);

      console.log('Bank account added successfully');
    } catch (error) {
      console.error('Error adding bank account:', error);
      alert(`Failed to add bank account: ${error.reason || error.message}`);
    }
  };

  const handleDeleteBankAccount = async (accountId) => {
    const confirmed = await showConfirm('Are you sure you want to delete this bank account? This action cannot be undone.');
    if (!confirmed) return;

    try {
      await Meteor.callAsync('bankAccounts.remove', { accountId, sessionId });
    } catch (error) {
      console.error('Error deleting bank account:', error);
    }
  };

  const handleEditBankAccount = (account) => {
    setEditingBankAccount(account._id);
    setEditBankAccountData({
      referenceCurrency: account.referenceCurrency || 'EUR',
      accountType: account.accountType || 'personal',
      authorizedOverdraft: account.authorizedOverdraft || '',
      comment: account.comment || '',
      introducerId: account.introducerId || '',
      lifeInsuranceCompany: account.lifeInsuranceCompany || '',
      beneficialOwnerIds: account.beneficialOwnerIds || (account.beneficialOwnerId ? [account.beneficialOwnerId] : []),
      relationshipManagerId: account.relationshipManagerId || '',
      backupRmIds: account.backupRmIds || [],
      name: account.name || '',
      accountNumber: account.accountNumber || '',
      authorizedEmail: account.authorizedEmail || '',
      authorizedCcEmails: account.authorizedCcEmails || [],
      authorizedPhone: account.authorizedPhone || ''
    });
    setEditAccountCcInput('');
  };

  const handleSaveEditBankAccount = async (accountId) => {
    const trimmedEmail = (editBankAccountData.authorizedEmail || '').trim();
    if (trimmedEmail && !AUTHORIZED_EMAIL_REGEX.test(trimmedEmail)) {
      alert('Authorized email is not a valid email address.');
      return;
    }
    const trimmedPhone = (editBankAccountData.authorizedPhone || '').trim();
    if (trimmedPhone && !E164_PHONE_REGEX.test(trimmedPhone)) {
      alert('Authorized phone must be in E.164 format (e.g. +33612345678).');
      return;
    }
    const cleanedCcEmails = (editBankAccountData.authorizedCcEmails || [])
      .map(e => (typeof e === 'string' ? e.trim() : ''))
      .filter(e => e.length > 0);
    for (const cc of cleanedCcEmails) {
      if (!AUTHORIZED_EMAIL_REGEX.test(cc)) {
        alert(`CC email is not valid: ${cc}`);
        return;
      }
    }

    try {
      const overdraftValue = editBankAccountData.authorizedOverdraft
        ? parseFloat(editBankAccountData.authorizedOverdraft)
        : null;

      await Meteor.callAsync('bankAccounts.update', {
        accountId,
        updates: {
          name: editBankAccountData.name || null,
          accountNumber: editBankAccountData.accountNumber || null,
          referenceCurrency: editBankAccountData.referenceCurrency,
          accountType: editBankAccountData.accountType,
          authorizedOverdraft: overdraftValue,
          comment: editBankAccountData.comment || '',
          introducerId: editBankAccountData.introducerId || null,
          beneficialOwnerIds: (editBankAccountData.beneficialOwnerIds || []).filter(id => id),
          relationshipManagerId: editBankAccountData.relationshipManagerId || null,
          backupRmIds: (editBankAccountData.backupRmIds || []).filter(id => id),
          lifeInsuranceCompany: editBankAccountData.accountType === 'life_insurance'
            ? (editBankAccountData.lifeInsuranceCompany || null)
            : null,
          authorizedEmail: trimmedEmail,
          authorizedCcEmails: cleanedCcEmails,
          authorizedPhone: trimmedPhone
        },
        sessionId
      });


      setEditingBankAccount(null);
      setEditBankAccountData({});
      setEditAccountCcInput('');
    } catch (error) {
      console.error('Error updating bank account:', error);
      alert(`Failed to update bank account: ${error.reason || error.message}`);
    }
  };

  const handleCancelEditBankAccount = () => {
    setEditingBankAccount(null);
    setEditBankAccountData({});
  };

  const handleAddFamilyMember = async () => {
    if (!newFamilyMember.name) {
      return;
    }

    try {
      const familyMembers = user.profile?.familyMembers || [];
      familyMembers.push({
        _id: new Meteor.Collection.ObjectID().toHexString(),
        ...newFamilyMember,
        birthday: newFamilyMember.birthday ? new Date(newFamilyMember.birthday) : null
      });

      await Meteor.callAsync('users.updateProfile', userId, {
        profile: {
          ...user.profile,
          familyMembers,
          updatedAt: new Date()
        }
      }, sessionId);

      setNewFamilyMember({
        name: '',
        relationship: 'spouse',
        birthday: ''
      });
      setShowAddFamilyMember(false);

    } catch (error) {
      console.error('Error adding family member:', error);
    }
  };

  const handleDeleteFamilyMember = async (familyMemberId) => {
    const confirmed = await showConfirm('Are you sure you want to delete this family member?');
    if (!confirmed) return;

    try {
      const familyMembers = (user.profile?.familyMembers || []).filter(fm => fm._id !== familyMemberId);

      await Meteor.callAsync('users.updateProfile', userId, {
        profile: {
          ...user.profile,
          familyMembers,
          updatedAt: new Date()
        }
      }, sessionId);

    } catch (error) {
      console.error('Error deleting family member:', error);
    }
  };

  // Per-account profile handlers
  const handleStartEditAccountProfile = (accountId) => {
    const existingProfile = accountProfiles?.find(p => p.bankAccountId === accountId);
    setAccountProfileDraft({
      profileName: existingProfile?.profileName || '',
      maxCash: existingProfile?.maxCash || 0,
      maxBonds: existingProfile?.maxBonds || 0,
      maxEquities: existingProfile?.maxEquities || 0,
      maxAlternative: existingProfile?.maxAlternative || 0,
      isProfessionalInvestor: existingProfile?.isProfessionalInvestor || false
    });
    setEditingAccountProfile(accountId);
  };

  const handleSaveAccountProfile = async (accountId) => {
    try {
      await Meteor.callAsync('accountProfiles.upsert', accountId, accountProfileDraft, sessionId);

      setEditingAccountProfile(null);

    } catch (error) {
      console.error('Error updating account profile:', error);
    }
  };

  const handleAccountAllocationChange = (field, value) => {
    const numValue = Math.max(0, Math.min(100, parseInt(value) || 0));
    setAccountProfileDraft(prev => ({
      ...prev,
      [field]: numValue
    }));
  };

  const applyTemplate = (templateKey) => {
    const template = PROFILE_TEMPLATES[templateKey];
    if (template) {
      setAccountProfileDraft(prev => ({
        ...prev,
        profileName: template.name,
        maxCash: template.maxCash,
        maxBonds: template.maxBonds,
        maxEquities: template.maxEquities,
        maxAlternative: template.maxAlternative
      }));
    }
  };

  // Utility functions
  const getAccountProfileTotal = () => {
    return accountProfileDraft.maxCash + accountProfileDraft.maxBonds +
           accountProfileDraft.maxEquities + accountProfileDraft.maxAlternative;
  };

  const getProfileForAccount = (accountId) => {
    return accountProfiles?.find(p => p.bankAccountId === accountId);
  };

  const getProfileName = (profile) => {
    if (!profile) return null;
    if (profile.profileName) return profile.profileName;
    // Derive from template match
    for (const [, template] of Object.entries(PROFILE_TEMPLATES)) {
      if (profile.maxCash === template.maxCash &&
          profile.maxBonds === template.maxBonds &&
          profile.maxEquities === template.maxEquities &&
          profile.maxAlternative === template.maxAlternative) {
        return template.name;
      }
    }
    return null;
  };

  const getSnapshotForAccount = (account) => {
    // Get the bank name for matching
    const bank = banks?.find(b => b._id === account.bankId);
    const bankName = bank?.name?.toLowerCase() || '';

    // Try to find matching snapshot - data is sorted by date desc so first match is latest
    // Match by portfolioCode (account number) and either bankId or bankName
    return portfolioSnapshots?.find(s => {
      const portfolioMatches = s.portfolioCode === account.accountNumber ||
                               s.accountNumber === account.accountNumber;

      // Try multiple ways to match the bank
      const bankMatches = s.bankId === account.bankId ||
                          s.bankId?.toLowerCase()?.includes(bankName) ||
                          s.bankName?.toLowerCase()?.includes(bankName) ||
                          bankName?.includes(s.bankName?.toLowerCase() || '');

      return portfolioMatches && bankMatches;
    });
  };

  const getAllocationForAccount = (account) => {
    const snapshot = getSnapshotForAccount(account);
    if (!snapshot || !snapshot.assetClassBreakdown || !snapshot.totalAccountValue) {
      return null;
    }
    return aggregateToFourCategories(snapshot.assetClassBreakdown, snapshot.totalAccountValue);
  };

  const getInitials = (firstName, lastName, email) => {
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    if (email) {
      return email.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case USER_ROLES.SUPERADMIN:
        return 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
      case USER_ROLES.ADMIN:
        return 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)';
      case USER_ROLES.COMPLIANCE:
        return 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)';
      case USER_ROLES.RELATIONSHIP_MANAGER:
        return 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)';
      case USER_ROLES.CLIENT:
        return 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
      default:
        return 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
    }
  };

  const getAvatarGradient = (name) => {
    const gradients = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #30cfd0 0%, #330867 100%)'
    ];
    const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return gradients[hash % gradients.length];
  };

  const calculateAge = (birthday) => {
    if (!birthday) return null;
    const today = new Date();
    const birthDate = new Date(birthday);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const getPasswordStrength = (password) => {
    if (!password) return { strength: 0, label: '', color: '' };
    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 10) strength++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;

    if (strength <= 2) return { strength, label: 'Weak', color: '#ef4444' };
    if (strength <= 3) return { strength, label: 'Medium', color: '#f59e0b' };
    return { strength, label: 'Strong', color: '#10b981' };
  };

  // KYC Risk Score Criteria Configuration (based on "Matrice risque Client AP.xlsx")
  const RISK_CRITERIA = [
    {
      id: 'relationNature',
      number: 1,
      label: 'Nature de la relation',
      labelEn: 'Nature of Relationship',
      options: [
        { value: 'individual', label: 'Personne physique', labelEn: 'Natural Person', score: 1 },
        { value: 'company', label: 'Personne morale', labelEn: 'Legal Entity', score: 2 },
        { value: 'trust', label: 'Trust, Fondation', labelEn: 'Trust, Foundation', score: 5 }
      ]
    },
    {
      id: 'pepStatus',
      number: 2,
      label: 'PPE Status',
      labelEn: 'PEP Status',
      options: [
        { value: 'pep', label: 'PEP', labelEn: 'PEP', score: 30 },
        { value: 'nonPep', label: 'NON-PEP', labelEn: 'Non-PEP', score: 0 }
      ]
    },
    {
      id: 'residence',
      number: 3,
      label: 'Residence',
      labelEn: 'Residence',
      options: [
        { value: 'euLowRisk', label: 'Monaco/EU/EEE/Suisse', labelEn: 'Monaco/EU/EEA/Switzerland', score: 1 },
        { value: 'nonEu', label: 'Non-EU', labelEn: 'Non-EU', score: 3 },
        { value: 'gafiBlacklist', label: 'GAFI blacklist', labelEn: 'FATF blacklist', score: 20 },
        { value: 'highRisk', label: 'Haut risque', labelEn: 'High risk', score: 15 }
      ]
    },
    {
      id: 'nationality',
      number: 4,
      label: 'Nationalite',
      labelEn: 'Nationality',
      options: [
        { value: 'euLowRisk', label: 'Monaco/EU/EEE/Suisse', labelEn: 'Monaco/EU/EEA/Switzerland', score: 1 },
        { value: 'nonEu', label: 'Non-EU', labelEn: 'Non-EU', score: 2 },
        { value: 'gafiBlacklist', label: 'GAFI blacklist', labelEn: 'FATF blacklist', score: 10 },
        { value: 'highRisk', label: 'Haut risque', labelEn: 'High risk', score: 10 }
      ]
    },
    {
      id: 'activityLocation',
      number: 5,
      label: 'Localisation des activites',
      labelEn: 'Activity Location',
      options: [
        { value: 'euLowRisk', label: 'Monaco/EU/EEE/Suisse', labelEn: 'Monaco/EU/EEA/Switzerland', score: 1 },
        { value: 'nonEu', label: 'Non-EU', labelEn: 'Non-EU', score: 3 },
        { value: 'gafiBlacklist', label: 'GAFI blacklist', labelEn: 'FATF blacklist', score: 10 },
        { value: 'highRisk', label: 'Haut risque', labelEn: 'High risk', score: 10 }
      ]
    },
    {
      id: 'fundsLocation',
      number: 6,
      label: 'Localisation des fonds',
      labelEn: 'Funds Location',
      options: [
        { value: 'euLowRisk', label: 'Monaco/EU/EEE/Suisse', labelEn: 'Monaco/EU/EEA/Switzerland', score: 1 },
        { value: 'nonEu', label: 'Non-EU', labelEn: 'Non-EU', score: 3 },
        { value: 'gafiBlacklist', label: 'GAFI blacklist', labelEn: 'FATF blacklist', score: 10 },
        { value: 'highRisk', label: 'Haut risque', labelEn: 'High risk', score: 10 }
      ]
    },
    {
      id: 'sensitiveActivity',
      number: 7,
      label: 'Activite sensible',
      labelEn: 'Sensitive Activity',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 10 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'communicationDifficulty',
      number: 8,
      label: 'Difficulte communication',
      labelEn: 'Communication Difficulty',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 3 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'criminalProsecution',
      number: 9,
      label: 'Poursuites penales',
      labelEn: 'Criminal Prosecution',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 30 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'sanctionsList',
      number: 10,
      label: 'Liste de sanctions',
      labelEn: 'Sanctions List',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 30 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'negativeInfo',
      number: 11,
      label: 'Information negative en ligne',
      labelEn: 'Negative Info Online',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 10 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'mandateType',
      number: 12,
      label: 'Type de mandat',
      labelEn: 'Mandate Type',
      options: [
        { value: 'advisoryRto', label: 'Gestion Conseil avec RTO', labelEn: 'Advisory with RTO', score: 1 },
        { value: 'advisory', label: 'Gestion Conseil', labelEn: 'Advisory', score: 2 }
      ]
    },
    {
      id: 'largeAccount',
      number: 13,
      label: 'Compte > 10M/25M',
      labelEn: 'Account > 10M/25M',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 10 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'transactionFrequency',
      number: 14,
      label: 'Transactions frequence',
      labelEn: 'Transaction Frequency',
      options: [
        { value: 'normal', label: 'Normal', labelEn: 'Normal', score: 1 },
        { value: 'frequent', label: 'Frequent/important', labelEn: 'Frequent/Significant', score: 2 }
      ]
    },
    {
      id: 'productRisk',
      number: 15,
      label: 'Risque Produit',
      labelEn: 'Product Risk',
      options: [
        { value: 'standard', label: 'Action/Obligation/Monetaire', labelEn: 'Equities/Bonds/Money Market', score: 1 },
        { value: 'structured', label: 'Produit Structure', labelEn: 'Structured Products', score: 3 },
        { value: 'privateEquity', label: 'Private Equity', labelEn: 'Private Equity', score: 4 }
      ]
    },
    {
      id: 'complexStructure',
      number: 16,
      label: 'Structure complexe',
      labelEn: 'Complex Structure',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 15 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    }
  ];

  // Helper function to calculate risk score for a single column
  const calculateRiskScore = (criteriaValues) => {
    let total = 0;
    RISK_CRITERIA.forEach(criterion => {
      const selectedOption = criterion.options.find(o => o.value === criteriaValues[criterion.id]);
      if (selectedOption) total += selectedOption.score;
    });
    return {
      totalScore: total,
      riskLevel: total < 15 ? 'low' : total < 30 ? 'medium' : 'high'
    };
  };

  // Helper function to get risk level display info
  const getRiskLevelDisplay = (riskLevel) => {
    switch (riskLevel) {
      case 'low':
        return { label: 'Risque Faible', labelEn: 'Low Risk', color: '#10b981', emoji: '🟢', reviewPeriod: '2 years' };
      case 'medium':
        return { label: 'Risque Moyen', labelEn: 'Medium Risk', color: '#f59e0b', emoji: '🟡', reviewPeriod: '2 years' };
      case 'high':
        return { label: 'Risque Eleve', labelEn: 'High Risk', color: '#ef4444', emoji: '🔴', reviewPeriod: '1 year' };
      default:
        return { label: 'Non evalue', labelEn: 'Not Assessed', color: '#6b7280', emoji: '⚪', reviewPeriod: '-' };
    }
  };

  // Initialize risk score form from user data
  const getInitialRiskScoreForm = () => {
    const savedData = user?.profile?.kycRiskScore;
    if (savedData) {
      return {
        clientProspect: savedData.clientProspect?.criteria || {},
        beneficialOwner: savedData.beneficialOwner?.criteria || {},
        businessRelationship: savedData.businessRelationship?.criteria || {},
        comments: savedData.comments || ''
      };
    }
    // Default empty form
    return {
      clientProspect: {},
      beneficialOwner: {},
      businessRelationship: {},
      comments: ''
    };
  };

  const [riskScoreForm, setRiskScoreForm] = useState(getInitialRiskScoreForm);

  // Update risk score form when user data changes
  useEffect(() => {
    if (user?.profile?.kycRiskScore) {
      setRiskScoreForm(getInitialRiskScoreForm());
    }
  }, [user?.profile?.kycRiskScore]);

  // Handle risk score form changes
  const handleRiskScoreChange = (column, criterionId, value) => {
    setRiskScoreForm(prev => ({
      ...prev,
      [column]: {
        ...prev[column],
        [criterionId]: value
      }
    }));
  };

  // Save risk score data
  const handleSaveRiskScore = async () => {
    setSavingRiskScore(true);
    try {
      const clientProspectResult = calculateRiskScore(riskScoreForm.clientProspect);
      const beneficialOwnerResult = calculateRiskScore(riskScoreForm.beneficialOwner);
      const businessRelationshipResult = calculateRiskScore(riskScoreForm.businessRelationship);

      // Determine highest risk level for next review calculation
      const riskLevels = [clientProspectResult.riskLevel, beneficialOwnerResult.riskLevel, businessRelationshipResult.riskLevel];
      const highestRisk = riskLevels.includes('high') ? 'high' : riskLevels.includes('medium') ? 'medium' : 'low';
      const reviewMonths = highestRisk === 'high' ? 12 : 24;
      const nextReviewDate = new Date();
      nextReviewDate.setMonth(nextReviewDate.getMonth() + reviewMonths);

      const riskScoreData = {
        assessmentDate: new Date(),
        assessedBy: currentUser?._id,
        clientProspect: {
          criteria: riskScoreForm.clientProspect,
          totalScore: clientProspectResult.totalScore,
          riskLevel: clientProspectResult.riskLevel
        },
        beneficialOwner: {
          criteria: riskScoreForm.beneficialOwner,
          totalScore: beneficialOwnerResult.totalScore,
          riskLevel: beneficialOwnerResult.riskLevel
        },
        businessRelationship: {
          criteria: riskScoreForm.businessRelationship,
          totalScore: businessRelationshipResult.totalScore,
          riskLevel: businessRelationshipResult.riskLevel
        },
        comments: riskScoreForm.comments,
        nextReviewDate: nextReviewDate
      };

      await Meteor.callAsync('users.updateRiskScore', userId, riskScoreData, sessionId);

      setEditingRiskScore(false);
    } catch (error) {
      console.error('Error saving risk score:', error);
    } finally {
      setSavingRiskScore(false);
    }
  };

  // Entity-first mode: when entityId is provided, we may not have a userId/user
  const isEntityMode = !!entityId;
  const hasUser = !!user;

  if (isLoading || (!user && !entity)) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
        gap: '20px'
      }}>
        <div style={{
          width: '60px',
          height: '60px',
          border: '4px solid var(--border-color)',
          borderTop: '4px solid var(--accent-color)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Loading details...</p>
      </div>
    );
  }

  // Derive display info from entity (preferred) or user (fallback)
  const fullName = isEntityMode && entity
    ? ClientEntityHelpers.getEntityDisplayName(entity)
    : `${user?.profile?.firstName || ''} ${user?.profile?.lastName || ''}`.trim() || user?.email || user?.username || '';
  const accountDefaultName = (() => {
    if (isEntityMode && entity?.type === ENTITY_TYPES.PHYSICAL_PERSON) {
      const last = (entity.profile?.lastName || '').toUpperCase();
      const first = entity.profile?.firstName || '';
      return last && first ? `${last} ${first}` : fullName;
    }
    if (!isEntityMode && user?.profile?.lastName) {
      const last = (user.profile.lastName || '').toUpperCase();
      const first = user.profile.firstName || '';
      return last && first ? `${last} ${first}` : fullName;
    }
    return fullName;
  })();
  const initials = isEntityMode && entity
    ? fullName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() || '?'
    : getInitials(user?.profile?.firstName, user?.profile?.lastName, user?.email);
  const assignedRM = relationshipManagers.find(rm => rm._id === (isEntityMode && entity ? entity.relationshipManagerId : user?.relationshipManagerId));
  const assignedUsers = isEntityMode && entity
    ? (entity.assignedUserIds || (entity.relationshipManagerId ? [entity.relationshipManagerId] : []))
        .map(id => relationshipManagers.find(rm => rm._id === id)).filter(Boolean)
    : assignedRM ? [assignedRM] : [];

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div style={{
      padding: isMobile ? '1rem' : '2rem',
      maxWidth: '1400px',
      margin: '0 auto',
      animation: 'fadeIn 0.5s ease-out'
    }}>
      {/* Back Button - hidden when embedded in master-detail view */}
      {!embedded && (
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            marginBottom: '1.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: '500',
            transition: 'all 0.3s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)';
            e.currentTarget.style.transform = 'translateX(-4px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-secondary)';
            e.currentTarget.style.transform = 'translateX(0)';
          }}
        >
          <span style={{ fontSize: '18px' }}>←</span>
          Back to Users
        </button>
      )}

      {/* User Header with Avatar and Stats */}
      <LiquidGlassCard
        borderRadius="12px"
        style={{
          marginBottom: isMobile ? '1rem' : '1.5rem',
          padding: isMobile ? '1.5rem' : '2rem'
        }}
      >
        <div style={{ display: 'flex', gap: isMobile ? '1rem' : '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Avatar */}
          <div style={{
            width: isMobile ? '80px' : '100px',
            height: isMobile ? '80px' : '100px',
            borderRadius: '50%',
            background: getAvatarGradient(fullName),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: isMobile ? '28px' : '36px',
            fontWeight: '700',
            color: '#fff',
            boxShadow: '0 8px 16px rgba(0,0,0,0.2)',
            flexShrink: 0
          }}>
            {initials}
          </div>

          {/* User Info */}
          <div style={{ flex: 1, minWidth: '250px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <h1 style={{
                margin: 0,
                fontSize: isMobile ? '1.5rem' : '2rem',
                fontWeight: '700',
                color: 'var(--text-primary)',
                lineHeight: 1.2
              }}>
                {fullName}
              </h1>

              {/* Entity Type Badge (entity mode) or Role Badge (user mode) */}
              {isEntityMode && entity && !hasUser ? (
                <span style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  background: entity?.isInsurance ? 'rgba(20, 184, 166, 0.15)' : entity.type === ENTITY_TYPES.COMPANY ? 'rgba(99, 102, 241, 0.15)' : 'rgba(5, 150, 105, 0.15)',
                  color: entity?.isInsurance ? '#14b8a6' : entity.type === ENTITY_TYPES.COMPANY ? '#6366f1' : '#059669',
                  fontSize: '12px',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {ClientEntityHelpers.getEntityTypeLabel(entity.type)}
                </span>
              ) : null}
              {isEntityMode && entity && bankAccounts.length > 0 && (
                <span style={{
                  padding: '4px 10px',
                  borderRadius: '16px',
                  background: 'rgba(37, 99, 235, 0.12)',
                  color: '#2563eb',
                  fontSize: '11px',
                  fontWeight: '600',
                  letterSpacing: '0.3px'
                }}>
                  Client
                </span>
              )}
              {hasUser && editingRole && currentUser?.role === USER_ROLES.SUPERADMIN ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <select
                    value={selectedRole || user.role}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: '2px solid var(--accent-color)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                  >
                    <option value={USER_ROLES.CLIENT}>Client</option>
                    <option value={USER_ROLES.RELATIONSHIP_MANAGER}>Relationship Manager</option>
                    <option value={USER_ROLES.COMPLIANCE}>Compliance</option>
                    <option value={USER_ROLES.ADMIN}>Admin</option>
                    <option value={USER_ROLES.SUPERADMIN}>Super Admin</option>
                  </select>
                  <button
                    onClick={handleSaveRole}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      background: '#10b981',
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditingRole(false); setSelectedRole(null); }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : hasUser ? (
                <span
                  onClick={() => {
                    if (currentUser?.role === USER_ROLES.SUPERADMIN && user._id !== currentUser._id) {
                      setSelectedRole(user.role);
                      setEditingRole(true);
                    }
                  }}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '20px',
                    background: getRoleBadgeColor(user.role),
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                    cursor: currentUser?.role === USER_ROLES.SUPERADMIN && user._id !== currentUser._id ? 'pointer' : 'default',
                    transition: 'transform 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (currentUser?.role === USER_ROLES.SUPERADMIN && user._id !== currentUser._id) {
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                  title={currentUser?.role === USER_ROLES.SUPERADMIN && user._id !== currentUser._id ? 'Click to change role' : ''}
                >
                  {user.role}
                </span>
              ) : null}}

              {/* Active Status — only for user-only views (no entity) */}
              {!entity && (
                <span style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '20px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#10b981',
                  fontSize: '0.75rem',
                  fontWeight: '600'
                }}>
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#10b981',
                    animation: 'pulse 2s infinite'
                  }} />
                  Active
                </span>
              )}

              {/* Entity Status Badge */}
              {entity && (() => {
                const statusDisplay = ClientEntityHelpers.getEntityStatusDisplay(entity.status);
                const canManageStatus = [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE].includes(currentUser?.role);
                return (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      background: `${statusDisplay.color}20`,
                      border: `1px solid ${statusDisplay.color}50`,
                      color: statusDisplay.color,
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      cursor: canManageStatus ? 'pointer' : 'default'
                    }}
                    onClick={async () => {
                      if (!canManageStatus) return;
                      const statuses = Object.values(ENTITY_STATUSES);
                      const currentIdx = statuses.indexOf(entity.status || ENTITY_STATUSES.ACTIVE);
                      const nextStatus = statuses[(currentIdx + 1) % statuses.length];
                      if (nextStatus === ENTITY_STATUSES.ARCHIVED) {
                        setArchiveError('');
                        setArchiveClosureFile(null);
                        setArchiveClosureDate(new Date().toISOString().split('T')[0]);
                        setShowArchiveModal(true);
                        return;
                      }
                      try {
                        await Meteor.callAsync('clientEntities.updateStatus', entityId, nextStatus, sessionId);
                      } catch (err) {
                        console.error('Failed to update entity status:', err);
                      }
                    }}
                    title={canManageStatus ? 'Click to cycle status' : ''}
                  >
                    {statusDisplay.label}
                  </span>
                );
              })()}

              {/* Can Validate Orders Badge - staff roles only, togglable by SuperAdmin */}
              {hasUser && [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.COMPLIANCE, USER_ROLES.STAFF].includes(user.role) && (() => {
                const canToggle = currentUser?.role === USER_ROLES.SUPERADMIN;
                const isEnabled = user.canValidateOrders === true;
                return (
                  <button
                    onClick={async () => {
                      if (!canToggle) return;
                      try {
                        await Meteor.callAsync('users.updateCanValidateOrders', user._id, !isEnabled, sessionId);
                      } catch (err) {
                        console.error('Error updating canValidateOrders:', err);
                        alert(err.reason || 'Failed to update permission');
                      }
                    }}
                    disabled={!canToggle}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      background: isEnabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                      border: `1px solid ${isEnabled ? 'rgba(16, 185, 129, 0.3)' : 'rgba(107, 114, 128, 0.3)'}`,
                      color: isEnabled ? '#10b981' : '#6b7280',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      cursor: canToggle ? 'pointer' : 'default',
                      transition: 'all 0.2s ease',
                      userSelect: 'none',
                      outline: 'none'
                    }}
                    title={canToggle
                      ? `Click to ${isEnabled ? 'disable' : 'enable'} order validation permission`
                      : 'Order validation permission'}
                  >
                    Can Validate Orders: {isEnabled ? 'Yes' : 'No'}
                  </button>
                );
              })()}

              {/* Archive / Reactivate buttons (admin, superadmin, compliance) */}
              {isEntityMode && entity && [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE].includes(currentUser?.role) && (
                <>
                  {entity.status !== ENTITY_STATUSES.ARCHIVED && (
                    <button
                      onClick={() => {
                        setArchiveError('');
                        setArchiveClosureFile(null);
                        setArchiveClosureDate(new Date().toISOString().split('T')[0]);
                        setShowArchiveModal(true);
                      }}
                      style={{ padding: '6px 14px', borderRadius: '20px', background: 'rgba(251, 191, 36, 0.12)', border: '1px solid rgba(251, 191, 36, 0.3)', color: '#f59e0b', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s ease' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251, 191, 36, 0.25)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(251, 191, 36, 0.12)'; }}
                    >
                      Archive
                    </button>
                  )}
                  {entity.status === ENTITY_STATUSES.ARCHIVED && (
                    <button
                      onClick={async () => {
                        const label = ClientEntityHelpers.getEntityDisplayName(entity);
                        const confirmed = await showConfirm(`Reactivate "${label}"?`);
                        if (!confirmed) return;
                        try {
                          await Meteor.callAsync('clientEntities.updateStatus', entityId, ENTITY_STATUSES.ACTIVE, sessionId);
                        } catch (err) {
                          console.error('Failed to reactivate entity:', err);
                        }
                      }}
                      style={{ padding: '6px 14px', borderRadius: '20px', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s ease' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.25)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.12)'; }}
                    >
                      Reactivate
                    </button>
                  )}
                </>
              )}

              {/* Permanent delete (superadmin only) */}
              {isEntityMode && entity && currentUser?.role === USER_ROLES.SUPERADMIN && (
                <button
                  onClick={async () => {
                    const label = ClientEntityHelpers.getEntityDisplayName(entity);
                    const confirmed = await showConfirm(`Are you sure you want to permanently delete "${label}"? This action cannot be undone.`);
                    if (!confirmed) return;
                    try {
                      if (isEntityMode && entityId) {
                        await Meteor.callAsync('clientEntities.deactivate', entityId, sessionId);
                      }
                      if (hasUser && userId) {
                        await Meteor.callAsync('users.remove', userId);
                      }
                      if (onBack) onBack();
                    } catch (err) {
                      console.error('Error deleting:', err);
                    }
                  }}
                  style={{ padding: '6px 14px', borderRadius: '20px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'; }}
                >
                  Delete
                </button>
              )}

            </div>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {(user?.profile?.createdAt || entity?.createdAt) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <span>📅</span>
                  <span>Created {new Date(user?.profile?.createdAt || entity?.createdAt).toLocaleDateString()}</span>
                </div>
              )}
              {isEntityMode && entity && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <span>💰</span>
                  <span>{entity.referenceCurrency || 'EUR'}</span>
                </div>
              )}
            </div>


            {/* Risk Score Row (for clients only) */}
            {hasUser && user.role === USER_ROLES.CLIENT && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <span>📊</span>
                  {(() => {
                    const riskScore = user.profile?.kycRiskScore;
                    if (!riskScore) {
                      return <span style={{ color: 'var(--text-muted)' }}>Risk not assessed</span>;
                    }
                    // Get highest risk level from the three columns
                    const levels = [
                      riskScore.clientProspect?.riskLevel,
                      riskScore.beneficialOwner?.riskLevel,
                      riskScore.businessRelationship?.riskLevel
                    ].filter(Boolean);
                    const highestRisk = levels.includes('high') ? 'high' : levels.includes('medium') ? 'medium' : 'low';
                    const display = getRiskLevelDisplay(highestRisk);
                    return (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '3px 10px',
                        background: `${display.color}15`,
                        border: `1px solid ${display.color}40`,
                        borderRadius: '12px',
                        fontSize: '0.85rem',
                        fontWeight: '500',
                        color: display.color
                      }}>
                        {display.emoji} {display.labelEn}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Quick Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: isMobile ? '0.75rem' : '1rem',
            minWidth: isMobile ? '240px' : '280px'
          }}>
            <div style={{
              padding: isMobile ? '1rem' : '1rem',
              background: 'rgba(79, 166, 255, 0.1)',
              border: '1px solid rgba(79, 166, 255, 0.2)',
              borderRadius: '12px'
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px', marginBottom: '6px' }}>
                Accounts
              </div>
              {(() => {
                const categoryCounts = {};
                bankAccounts.forEach(acc => {
                  let category;
                  const comment = (acc.comment || '').toLowerCase();
                  if (comment.includes('credit')) {
                    category = 'Credit';
                  } else if (comment === 'spending') {
                    category = 'Spending';
                  } else if (acc.accountType === 'life_insurance') {
                    category = 'Life Insurance';
                  } else {
                    category = 'Investment';
                  }
                  categoryCounts[category] = (categoryCounts[category] || 0) + 1;
                });
                return Object.entries(categoryCounts).map(([cat, count]) => (
                  <div key={cat} style={{ fontSize: '13px', color: '#4da6ff', fontWeight: '600', lineHeight: '1.6' }}>
                    {count} {cat}
                  </div>
                ));
              })()}
              {bankAccounts.length === 0 && (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No accounts</div>
              )}
            </div>

            {hasUser && user.profile?.familyMembers && user.profile?.clientType !== 'company' && (
              <div style={{
                padding: isMobile ? '1rem' : '1rem',
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                borderRadius: '12px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: isMobile ? '1.5rem' : '1.75rem', fontWeight: '700', color: '#8b5cf6', marginBottom: '4px' }}>
                  {user.profile.familyMembers.length}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>
                  Family Members
                </div>
              </div>
            )}
          </div>
        </div>
      </LiquidGlassCard>

      {/* Tab Navigation */}
      {(() => {
        const tabs = [
          { id: 'info', label: 'Information', icon: '👤' },
          { id: 'rmClients', label: 'Clients', icon: '👥', rmOnly: true, userOnly: true },
          { id: 'introducerAccounts', label: 'Accounts Introduced', icon: '🤝', introducerOnly: true, userOnly: true },
          { id: 'accounts', label: 'Accounts', icon: '🏦', entityOrClient: true },
          { id: 'stakeholders', label: 'Stakeholders', icon: '🏛️', entityCompanyOnly: true },
          { id: 'documents', label: 'Documents', icon: '📋', entityOrClient: true, notLifeInsurance: true },
          { id: 'kyc', label: 'KYC', icon: '✅', clientOnly: true },
          { id: 'riskScore', label: 'Risk Score', icon: '📊', clientOnly: true },
          { id: 'family', label: 'Linked People', icon: '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66', clientOnly: true, personOnly: true },
          { id: 'access', label: 'User Access', icon: '\ud83d\udd11', entityOnly: true, notLifeInsurance: true },
          { id: 'password', label: 'Password', icon: '\ud83d\udd12', adminOnly: true, userOnly: true }
        ];

        const isAdmin = currentUser?.role === USER_ROLES.ADMIN || currentUser?.role === USER_ROLES.SUPERADMIN;
        const isViewingClient = hasUser && user.role === USER_ROLES.CLIENT;
        const isViewingRM = hasUser && user.role === USER_ROLES.RELATIONSHIP_MANAGER;
        const isViewingIntroducer = hasUser && user.role === USER_ROLES.INTRODUCER;
        const isCompanyClient = isViewingClient && user?.profile?.clientType === 'company';
        const isEntityCompany = isEntityMode && entity?.type === ENTITY_TYPES.COMPANY;

        const visibleTabs = tabs.filter(tab => {
          // User-only tabs hidden in entity mode without a user
          if (tab.userOnly && isEntityMode && !hasUser) return false;
          // Entity-or-client: show for entity mode OR client user
          if (tab.entityOrClient && !isEntityMode && !isViewingClient) return false;
          // Entity-company-only: show for entity companies OR user company clients
          if (tab.entityCompanyOnly && !isEntityCompany && !isCompanyClient) return false;
          // RM-only tabs shown only when viewing an RM
          if (tab.rmOnly && !isViewingRM) return false;
          // Introducer-only tabs shown only when viewing an Introducer
          if (tab.introducerOnly && !isViewingIntroducer) return false;
          // Person-only tabs hidden for company clients
          if (tab.personOnly && isCompanyClient) return false;
          // Client-only tabs shown when viewing a client (admins included)
          if (tab.clientOnly && !isViewingClient) return false;
          // Entity-only tabs shown only when entityId prop is provided
          if (tab.entityOnly && !entityId) return false;
          // Admin-only tabs shown only for admins
          if (tab.adminOnly && !isAdmin) return false;
          return true;
        });

        return (
          <div style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '20px',
            flexWrap: 'wrap'
          }}>
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: activeTab === tab.id ? 'var(--accent-color)' : 'var(--bg-secondary)',
                  color: activeTab === tab.id ? 'white' : 'var(--text-primary)',
                  fontWeight: activeTab === tab.id ? '600' : '400',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.9rem'
                }}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        );
      })()}

      {/* Main Content Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: isMobile ? '1rem' : '1.5rem'
      }}>
        {/* Left Column - Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '1rem' : '1.5rem' }}>

          {/* Entity Profile Info (entity-only mode without user) */}
          {activeTab === 'info' && isEntityMode && !hasUser && entity && (
            <LiquidGlassCard borderRadius="12px" style={{ padding: isMobile ? '1.5rem' : '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '2px solid var(--border-color)', paddingBottom: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.5rem' }}>
                    {entity?.isInsurance ? '\ud83d\udee1\ufe0f' : entity.type === ENTITY_TYPES.COMPANY ? '\ud83c\udfe2' : '\ud83d\udc64'}
                  </span>
                  Entity Profile
                </h2>
                {!editingBasicInfo ? (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button onClick={() => setEditingBasicInfo(true)} style={{ padding: '8px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Edit</button>
                    {currentUser?.role === USER_ROLES.SUPERADMIN && (
                      <button
                        onClick={async () => {
                          const label = isEntityMode && entity
                            ? ClientEntityHelpers.getEntityDisplayName(entity)
                            : fullName;
                          const confirmed = await showConfirm(`Are you sure you want to delete "${label}"? This action cannot be undone.`);
                          if (!confirmed) return;
                          try {
                            if (isEntityMode && entityId) {
                              await Meteor.callAsync('clientEntities.deactivate', entityId, sessionId);
                            }
                            if (hasUser && userId) {
                              await Meteor.callAsync('users.remove', userId);
                            }
                            if (onBack) onBack();
                          } catch (err) {
                            console.error('Error deleting:', err);
                            alert(err.reason || 'Failed to delete');
                          }
                        }}
                        style={{
                          padding: '8px 16px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '8px',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: '600',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                      >
                        🗑️ Delete
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={async () => {
                      try {
                        const updates = { profile: {} };
                        if (entity.type === ENTITY_TYPES.PHYSICAL_PERSON) {
                          updates.profile.firstName = formData.firstName;
                          updates.profile.lastName = formData.lastName;
                          if (formData.birthday) updates.profile.birthday = new Date(formData.birthday);
                        } else {
                          updates.profile.companyName = formData.companyName;
                        }
                        updates.profile.preferredLanguage = formData.preferredLanguage;
                        updates.referenceCurrency = formData.referenceCurrency;
                        updates.isInsurance = formData.isInsurance || false;
                        await Meteor.callAsync('clientEntities.update', entityId, updates, sessionId);
                        setEditingBasicInfo(false);
                      } catch (err) {
                        console.error('Error updating entity:', err);
                      }
                    }} style={{ padding: '8px 16px', background: '#10b981', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Save</button>
                    <button onClick={() => setEditingBasicInfo(false)} style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                {entity.type === ENTITY_TYPES.PHYSICAL_PERSON ? (
                  <>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>First Name</label>
                      {editingBasicInfo ? (
                        <input value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                      ) : (
                        <div style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{entity.profile?.firstName || '-'}</div>
                      )}
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Last Name</label>
                      {editingBasicInfo ? (
                        <input value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                      ) : (
                        <div style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{entity.profile?.lastName || '-'}</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ gridColumn: isMobile ? '1' : '1 / -1' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Company Name</label>
                    {editingBasicInfo ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <input value={formData.companyName} onChange={e => setFormData({...formData, companyName: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          <input type="checkbox" checked={formData.isInsurance || false} onChange={e => setFormData({...formData, isInsurance: e.target.checked})} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                          Life Insurance Company
                        </label>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{entity.profile?.companyName || '-'}</span>
                        {entity.isInsurance && <span style={{ padding: '2px 8px', borderRadius: '5px', fontSize: '0.7rem', fontWeight: '600', background: 'rgba(20, 184, 166, 0.12)', color: '#14b8a6' }}>Insurance</span>}
                      </div>
                    )}
                  </div>
                )}
                {<><div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Reference Currency</label>
                  {editingBasicInfo ? (
                    <select value={formData.referenceCurrency} onChange={e => setFormData({...formData, referenceCurrency: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box', cursor: 'pointer' }}>
                      {['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <div style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{entity.referenceCurrency || 'EUR'}</div>
                  )}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Language</label>
                  {editingBasicInfo ? (
                    <select value={formData.preferredLanguage} onChange={e => setFormData({...formData, preferredLanguage: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box', cursor: 'pointer' }}>
                      <option value="en">English</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="it">Italian</option>
                      <option value="es">Spanish</option>
                    </select>
                  ) : (
                    <div style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{{'en':'English','fr':'French','de':'German','it':'Italian','es':'Spanish'}[entity.profile?.preferredLanguage] || entity.profile?.preferredLanguage || '-'}</div>
                  )}
                </div>
                </>}
              </div>

              {/* Roles in other entities */}
              {(() => {
                const roleLabels = { ubo: 'UBO', director: 'Director', signatory: 'Signatory', shareholder: 'Shareholder' };
                const roles = [];
                allEntities.forEach(company => {
                  if (!company.stakeholders?.length) return;
                  company.stakeholders.forEach(sh => {
                    if (sh.entityId === entityId) {
                      roles.push({ role: roleLabels[sh.role] || sh.role, companyName: ClientEntityHelpers.getEntityDisplayName(company), ownership: sh.ownership });
                    }
                  });
                });
                if (roles.length === 0) return null;
                return (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>Roles in Companies</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {roles.map((r, i) => (
                        <span key={i} style={{
                          padding: '4px 10px', borderRadius: '6px',
                          background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6',
                          fontSize: '0.82rem', fontWeight: '600'
                        }}>
                          {r.role}{r.ownership ? ` ${r.ownership}%` : ''} @ {r.companyName}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </LiquidGlassCard>
          )}

          {/* Basic Information (info tab) — user mode */}
          {activeTab === 'info' && hasUser && (
            <LiquidGlassCard borderRadius="12px" style={{ padding: isMobile ? '1.5rem' : '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMobile ? '1rem' : '1.5rem', borderBottom: '2px solid var(--border-color)', paddingBottom: '1rem' }}>
              <h2 style={{
                margin: 0,
                fontSize: isMobile ? '1.2rem' : '1.25rem',
                fontWeight: '700',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <span style={{ fontSize: isMobile ? '1.3rem' : '1.5rem' }}>👤</span>
                Basic Information
              </h2>
              {!editingBasicInfo && (
                <button
                  onClick={() => setEditingBasicInfo(true)}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--accent-color)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 2px 8px rgba(0, 123, 255, 0.3)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 123, 255, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 123, 255, 0.3)';
                  }}
                >
                  ✏️ Edit
                </button>
              )}
            </div>

            {editingBasicInfo ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                <div>
                  <label style={{
                    display: 'block',
                    marginBottom: '8px',
                    color: 'var(--text-secondary)',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    Email *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '16px'
                    }}>
                      ✉️
                    </span>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '12px 12px 12px 40px',
                        background: 'var(--bg-secondary)',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                        transition: 'all 0.3s ease',
                        outline: 'none'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    />
                  </div>
                </div>

                {/* Client Type (only for client role) */}
                {user.role === USER_ROLES.CLIENT && (
                  <div>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      Client Type
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, clientType: 'natural' })}
                        style={{
                          flex: 1,
                          padding: '10px',
                          borderRadius: '6px',
                          border: `2px solid ${formData.clientType === 'natural' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                          background: formData.clientType === 'natural' ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-secondary)',
                          color: formData.clientType === 'natural' ? 'var(--accent-color)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontWeight: '500',
                          fontSize: '0.9rem',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        Natural Person
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, clientType: 'company' })}
                        style={{
                          flex: 1,
                          padding: '10px',
                          borderRadius: '6px',
                          border: `2px solid ${formData.clientType === 'company' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                          background: formData.clientType === 'company' ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-secondary)',
                          color: formData.clientType === 'company' ? 'var(--accent-color)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontWeight: '500',
                          fontSize: '0.9rem',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        Company
                      </button>
                    </div>
                  </div>
                )}

                {/* Company Name (only for company clients) */}
                {user.role === USER_ROLES.CLIENT && formData.clientType === 'company' && (
                  <div>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={formData.companyName}
                      onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                      placeholder="Enter company name"
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: 'var(--bg-secondary)',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                        transition: 'all 0.3s ease',
                        outline: 'none'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    />
                  </div>
                )}

                {/* First/Last Name (only for natural persons or non-client roles) */}
                {(user.role !== USER_ROLES.CLIENT || formData.clientType !== 'company') && (
                  <>
                    <div>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        color: 'var(--text-secondary)',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        First Name
                      </label>
                      <input
                        type="text"
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem',
                          transition: 'all 0.3s ease',
                          outline: 'none'
                        }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                      />
                    </div>

                    <div>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        color: 'var(--text-secondary)',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Last Name
                      </label>
                      <input
                        type="text"
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem',
                          transition: 'all 0.3s ease',
                          outline: 'none'
                        }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                      />
                    </div>
                  </>
                )}

                {/* Date of Birth - hide for company clients */}
                {(user.role !== USER_ROLES.CLIENT || formData.clientType !== 'company') && (
                  <div>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      Date of Birth
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: '16px'
                      }}>
                        🎂
                      </span>
                      <input
                        type="date"
                        value={formData.birthday}
                        onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px 12px 12px 40px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem',
                          transition: 'all 0.3s ease',
                          outline: 'none'
                        }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label style={{
                    display: 'block',
                    marginBottom: '8px',
                    color: 'var(--text-secondary)',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    Preferred Language
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '16px'
                    }}>
                      🌐
                    </span>
                    <select
                      value={formData.preferredLanguage}
                      onChange={(e) => setFormData({ ...formData, preferredLanguage: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '12px 12px 12px 40px',
                        background: 'var(--bg-secondary)',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                        transition: 'all 0.3s ease',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    >
                      <option value="en">English</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="es">Spanish</option>
                      <option value="it">Italian</option>
                    </select>
                  </div>
                </div>

                {/* Reference Currency */}
                <div>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontWeight: '500',
                    color: 'var(--text-secondary)',
                    fontSize: '0.85rem'
                  }}>
                    Reference Currency
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '16px'
                    }}>
                      💱
                    </span>
                    <select
                      value={formData.referenceCurrency}
                      onChange={(e) => setFormData({ ...formData, referenceCurrency: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '12px 12px 12px 40px',
                        background: 'var(--bg-secondary)',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                        transition: 'all 0.3s ease',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    >
                      <option value="USD">USD - US Dollar</option>
                      <option value="EUR">EUR - Euro</option>
                      <option value="GBP">GBP - British Pound</option>
                      <option value="CHF">CHF - Swiss Franc</option>
                      <option value="ILS">ILS - Israeli Shekel</option>
                    </select>
                  </div>
                </div>

                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
                  <button
                    onClick={() => {
                      setEditingBasicInfo(false);
                      setFormData({
                        email: user.email || user.username || '',
                        firstName: user.profile?.firstName || '',
                        lastName: user.profile?.lastName || '',
                        birthday: user.profile?.birthday ? new Date(user.profile.birthday).toISOString().split('T')[0] : '',
                        preferredLanguage: user.profile?.preferredLanguage || 'en',
                        referenceCurrency: user.profile?.referenceCurrency || 'EUR',
                        relationshipManagerId: user.relationshipManagerId || '',
                        newPassword: '',
                        clientType: user.profile?.clientType || 'natural',
                        companyName: user.profile?.companyName || ''
                      });
                      setStakeholders(user.profile?.stakeholders || []);
                    }}
                    style={{
                      padding: '12px 24px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: '500',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveBasicInfo}
                    style={{
                      padding: '12px 24px',
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    💾 Save Changes
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                <div style={{
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)'
                }}>
                  <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Email
                  </p>
                  <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '500' }}>
                    {user.email || user.username}
                  </p>
                </div>

                {user.profile?.clientType === 'company' ? (
                  <div style={{
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Company Name
                    </p>
                    <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '500' }}>
                      {user.profile?.companyName || <span style={{ color: 'var(--text-secondary)' }}>Not set</span>}
                    </p>
                  </div>
                ) : (
                  <div style={{
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Full Name
                    </p>
                    <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '500' }}>
                      {fullName}
                    </p>
                  </div>
                )}

                {/* Date of Birth - hide for company clients */}
                {user.profile?.clientType !== 'company' && (
                  <div style={{
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Date of Birth
                    </p>
                    <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '500' }}>
                      {user.profile?.birthday ? (
                        <>
                          {new Date(user.profile.birthday).toLocaleDateString()}
                          {calculateAge(user.profile.birthday) && (
                            <span style={{ marginLeft: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                              ({calculateAge(user.profile.birthday)} years)
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)' }}>Not set</span>
                      )}
                    </p>
                  </div>
                )}

                <div style={{
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)'
                }}>
                  <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Language
                  </p>
                  <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '500' }}>
                    {user.profile?.preferredLanguage?.toUpperCase() || 'EN'}
                  </p>
                </div>

                {/* Reference Currency */}
                <div style={{
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)'
                }}>
                  <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Reference Currency
                  </p>
                  <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '500' }}>
                    {user.profile?.referenceCurrency || 'EUR'}
                  </p>
                </div>

                {/* Client Type */}
                {user.role === USER_ROLES.CLIENT && (
                  <div style={{
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Client Type
                    </p>
                    <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '500' }}>
                      {user.profile?.clientType === 'company' ? 'Company' : 'Natural Person'}
                    </p>
                  </div>
                )}

                {/* Company Name */}
                {user.role === USER_ROLES.CLIENT && user.profile?.clientType === 'company' && user.profile?.companyName && (
                  <div style={{
                    padding: '1rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Company Name
                    </p>
                    <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: '500' }}>
                      {user.profile.companyName}
                    </p>
                  </div>
                )}
              </div>
            )}
          </LiquidGlassCard>
          )}

          {/* RM's Clients - rmClients tab (when viewing an RM profile) */}
          {activeTab === 'rmClients' && hasUser && user.role === USER_ROLES.RELATIONSHIP_MANAGER && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span>👥</span> Assigned Clients
                  <span style={{
                    fontSize: '0.85rem',
                    fontWeight: '500',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    background: 'var(--accent-color)',
                    color: 'white'
                  }}>
                    {rmClients.length}
                  </span>
                </h2>
              </div>

              {rmClientsLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                  Loading clients...
                </div>
              ) : rmClients.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '3rem',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-secondary)',
                  borderRadius: '12px',
                  border: '1px dashed var(--border-color)'
                }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>👤</div>
                  <p style={{ margin: 0, fontSize: '1rem' }}>No clients assigned to this RM yet</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {rmClients.map(client => {
                    const firstName = client.profile?.firstName || client.firstName || '';
                    const lastName = client.profile?.lastName || client.lastName || '';
                    const displayName = firstName || lastName ? `${firstName} ${lastName}`.trim() : 'Unnamed';
                    const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || '?';

                    return (
                      <div
                        key={client._id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '1rem',
                          padding: '1rem',
                          background: 'var(--bg-secondary)',
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {/* Avatar */}
                        <div style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontWeight: '600',
                          fontSize: '1rem',
                          flexShrink: 0
                        }}>
                          {initials}
                        </div>

                        {/* Client Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontWeight: '600',
                            color: 'var(--text-primary)',
                            fontSize: '1rem',
                            marginBottom: '4px'
                          }}>
                            {displayName}
                          </div>
                          <div style={{
                            fontSize: '0.85rem',
                            color: 'var(--text-secondary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {client.email}
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          background: 'rgba(5, 150, 105, 0.1)',
                          color: '#059669',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          flexShrink: 0
                        }}>
                          Client
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Introducer's Accounts - introducerAccounts tab (when viewing an Introducer profile) */}
          {activeTab === 'introducerAccounts' && hasUser && user.role === USER_ROLES.INTRODUCER && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span>🤝</span> Accounts Introduced
                  <span style={{
                    fontSize: '0.85rem',
                    fontWeight: '500',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    background: 'var(--accent-color)',
                    color: 'white'
                  }}>
                    {introducerAccounts.length}
                  </span>
                </h2>
              </div>

              {introducerAccountsLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                  Loading accounts...
                </div>
              ) : introducerAccounts.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '3rem',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-secondary)',
                  borderRadius: '12px',
                  border: '1px dashed var(--border-color)'
                }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>🏦</div>
                  <p style={{ margin: 0, fontSize: '1rem' }}>No accounts introduced yet</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {introducerAccounts.map(account => {
                    const initials = account.clientName?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';

                    return (
                      <div
                        key={account._id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '1rem',
                          padding: '1rem',
                          background: 'var(--bg-secondary)',
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {/* Bank logo or icon */}
                        <div style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '12px',
                          background: getBankLogoPath(account.bankName) ? 'var(--bg-primary)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          overflow: 'hidden',
                          border: getBankLogoPath(account.bankName) ? '1px solid var(--border-color)' : 'none'
                        }}>
                          {getBankLogoPath(account.bankName) ? (
                            <img
                              src={getBankLogoPath(account.bankName)}
                              alt={account.bankName}
                              style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                            />
                          ) : (
                            <span style={{ fontSize: '24px' }}>🏦</span>
                          )}
                        </div>

                        {/* Account Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontWeight: '600',
                            color: 'var(--text-primary)',
                            fontSize: '1rem',
                            marginBottom: '4px'
                          }}>
                            {account.bankName}
                          </div>
                          <div style={{
                            fontSize: '0.85rem',
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            gap: '8px',
                            flexWrap: 'wrap',
                            alignItems: 'center'
                          }}>
                            <span>{account.accountNumber}</span>
                            <span style={{ color: 'var(--text-muted)' }}>•</span>
                            <span style={{ fontWeight: '500', color: '#3b82f6' }}>{account.clientName}</span>
                          </div>
                        </div>

                        {/* Currency Badge */}
                        <div style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          background: isDarkMode ? 'rgba(79, 166, 255, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                          color: '#4da6ff',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          flexShrink: 0
                        }}>
                          {account.referenceCurrency || 'EUR'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Linked Client Entities (shown in info tab for non-entity views) */}
          {activeTab === 'info' && !entityId && linkedEntities.length > 0 && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <h3 style={{
                margin: '0 0 16px 0',
                fontSize: '1.1rem',
                fontWeight: '600',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>🏢</span> Linked Client Entities
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {linkedEntities.map(ent => {
                  const statusDisplay = ClientEntityHelpers.getEntityStatusDisplay(ent.status);
                  return (
                    <div key={ent._id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'var(--bg-secondary)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1.1rem' }}>
                          {ent.type === ENTITY_TYPES.PHYSICAL_PERSON ? '\ud83d\udc64' : ent.type === ENTITY_TYPES.COMPANY ? '\ud83c\udfe2' : '\ud83d\udee1\ufe0f'}
                        </span>
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            {ClientEntityHelpers.getEntityDisplayName(ent)}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {ClientEntityHelpers.getEntityTypeLabel(ent.type)} · {ent.accessLevel} access
                          </div>
                        </div>
                      </div>
                      <span style={{
                        fontSize: '0.65rem',
                        fontWeight: '600',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        background: `${statusDisplay.color}15`,
                        color: statusDisplay.color
                      }}>
                        {statusDisplay.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </LiquidGlassCard>
          )}

          {/* Linked User Accounts (shown in info tab for entity views) */}
          {activeTab === 'info' && entityId && linkedUsers.length > 0 && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <h3 style={{
                margin: '0 0 16px 0',
                fontSize: '1.1rem',
                fontWeight: '600',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>🔑</span> Linked User Accounts
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {linkedUsers.map(u => (
                  <div key={u._id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {u.profile?.firstName || ''} {u.profile?.lastName || ''} {!u.profile?.firstName && !u.profile?.lastName && (u.email || 'Unnamed')}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {u.email} · {u.role} · {u.accessLevel} access
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </LiquidGlassCard>
          )}

          {/* Bank Accounts - accounts tab — unified table with expandable rows */}
          {activeTab === 'accounts' && (isEntityMode || (hasUser && user.role === USER_ROLES.CLIENT)) && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.3rem' }}>🏦</span> Bank Accounts
                  <span style={{ fontSize: '0.8rem', fontWeight: '600', padding: '2px 8px', borderRadius: '10px', background: 'var(--accent-color)', color: 'white' }}>{bankAccounts.length}</span>
                </h2>
                <button onClick={() => { if (!showAddAccount) { setNewAccount(prev => ({...prev, name: accountDefaultName})); } setShowAddAccount(!showAddAccount); }} style={{
                  background: showAddAccount ? 'var(--danger-color)' : '#10b981', color: 'white', border: 'none',
                  padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600'
                }}>{showAddAccount ? 'Cancel' : '+ Add Account'}</button>
              </div>

              {/* Add Account Form (compact) */}
              {showAddAccount && (
                <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '10px', marginBottom: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Name</label>
                      <input type="text" placeholder={fullName} value={newAccount.name} onChange={e => { const val = e.target.value; setNewAccount(prev => ({...prev, name: val})); }}
                        style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Bank *</label>
                      <select value={newAccount.bankId} onChange={e => { const val = e.target.value; setNewAccount(prev => ({...prev, bankId: val})); }}
                        style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <option value="">Select bank...</option>
                        {banks.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Account # *</label>
                      <input type="text" value={newAccount.accountNumber} onChange={e => { const val = e.target.value; setNewAccount(prev => ({...prev, accountNumber: val})); }}
                        style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Currency</label>
                      <select value={newAccount.referenceCurrency} onChange={e => { const val = e.target.value; setNewAccount(prev => ({...prev, referenceCurrency: val})); }}
                        style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', cursor: 'pointer' }}>
                        {['EUR','USD','GBP','CHF','JPY','CAD','AUD','ILS'].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    {(entity?.isInsurance || newAccount.accountStructure === 'life_insurance') && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Beneficial Owners (UBOs)</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                          {(newAccount.beneficialOwnerIds || []).map(uboId => {
                            const uboEntity = allEntities.find(e => e._id === uboId);
                            return uboEntity ? (
                              <span key={uboId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.75rem', fontWeight: '600', background: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9' }}>
                                {ClientEntityHelpers.getEntityDisplayName(uboEntity)}
                                <span onClick={() => setNewAccount(prev => ({...prev, beneficialOwnerIds: (prev.beneficialOwnerIds || []).filter(id => id !== uboId)}))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                              </span>
                            ) : null;
                          })}
                        </div>
                        <select value="_placeholder" onChange={e => { const val = e.target.value; if (val && val !== '_placeholder') { setNewAccount(prev => ({...prev, beneficialOwnerIds: [...(prev.beneficialOwnerIds || []), val]})); } }}
                          style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', cursor: 'pointer' }}>
                          <option value="_placeholder">Add UBO...</option>
                          {allEntities.filter(e => e._id !== entityId && (e.type === ENTITY_TYPES.PHYSICAL_PERSON || e.type === ENTITY_TYPES.COMPANY) && !(newAccount.beneficialOwnerIds || []).includes(e._id)).map(e => (
                            <option key={e._id} value={e._id}>{ClientEntityHelpers.getEntityDisplayName(e)} ({ClientEntityHelpers.getEntityTypeLabel(e.type)})</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {(
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Description</label>
                        <select value={newAccount.comment} onChange={e => { const val = e.target.value; setNewAccount(prev => ({...prev, comment: val})); }}
                          style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', cursor: 'pointer' }}>
                          <option value="">Select...</option>
                          <option value="Investments">Investments</option>
                          <option value="Credit line">Credit line</option>
                          <option value="Credit card">Credit card</option>
                          <option value="Spending">Spending</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Authorized contacts for order communication */}
                  {(() => {
                    const addEmailValid = !newAccount.authorizedEmail || AUTHORIZED_EMAIL_REGEX.test(newAccount.authorizedEmail.trim());
                    const addPhoneValid = !newAccount.authorizedPhone || E164_PHONE_REGEX.test(newAccount.authorizedPhone.trim());
                    const addCcInputValid = !newAccountCcInput.trim() || AUTHORIZED_EMAIL_REGEX.test(newAccountCcInput.trim());
                    const handleAddCc = () => {
                      const val = newAccountCcInput.trim();
                      if (!val || !AUTHORIZED_EMAIL_REGEX.test(val)) return;
                      if ((newAccount.authorizedCcEmails || []).includes(val)) { setNewAccountCcInput(''); return; }
                      setNewAccount(prev => ({ ...prev, authorizedCcEmails: [...(prev.authorizedCcEmails || []), val] }));
                      setNewAccountCcInput('');
                    };
                    return (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--border-color)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Authorized contacts</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Authorized email</label>
                            <input type="email" placeholder="orders@example.com" value={newAccount.authorizedEmail}
                              onChange={e => { const val = e.target.value; setNewAccount(prev => ({ ...prev, authorizedEmail: val })); }}
                              style={{ width: '100%', padding: '9px', border: `1px solid ${addEmailValid ? 'var(--border-color)' : '#ef4444'}`, borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                            {!addEmailValid && <div style={{ color: '#ef4444', fontSize: '0.7rem', marginTop: '3px' }}>Invalid email format</div>}
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Authorized phone (E.164)</label>
                            <input type="tel" placeholder="+33612345678" value={newAccount.authorizedPhone}
                              onChange={e => { const val = e.target.value; setNewAccount(prev => ({ ...prev, authorizedPhone: val })); }}
                              style={{ width: '100%', padding: '9px', border: `1px solid ${addPhoneValid ? 'var(--border-color)' : '#ef4444'}`, borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                            {!addPhoneValid && <div style={{ color: '#ef4444', fontSize: '0.7rem', marginTop: '3px' }}>Must be E.164, e.g. +33612345678</div>}
                          </div>
                          <div style={{ gridColumn: '1 / -1' }}>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>CC emails</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                              {(newAccount.authorizedCcEmails || []).map(cc => (
                                <span key={cc} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.75rem', fontWeight: '600', background: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9' }}>
                                  {cc}
                                  <span onClick={() => setNewAccount(prev => ({ ...prev, authorizedCcEmails: (prev.authorizedCcEmails || []).filter(e => e !== cc) }))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                                </span>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <input type="email" placeholder="cc@example.com" value={newAccountCcInput}
                                onChange={e => setNewAccountCcInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCc(); } }}
                                style={{ flex: 1, padding: '9px', border: `1px solid ${addCcInputValid ? 'var(--border-color)' : '#ef4444'}`, borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                              <button type="button" onClick={handleAddCc}
                                disabled={!newAccountCcInput.trim() || !addCcInputValid}
                                style={{ padding: '8px 14px', background: (!newAccountCcInput.trim() || !addCcInputValid) ? 'var(--bg-secondary)' : 'var(--accent-color)', color: (!newAccountCcInput.trim() || !addCcInputValid) ? 'var(--text-muted)' : 'white', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: (!newAccountCcInput.trim() || !addCcInputValid) ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>Add</button>
                            </div>
                            {!addCcInputValid && <div style={{ color: '#ef4444', fontSize: '0.7rem', marginTop: '3px' }}>Invalid email format</div>}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
                    <button onClick={() => { setShowAddAccount(false); setNewAccount({ name: '', bankId: '', accountNumber: '', referenceCurrency: 'USD', accountType: 'personal', accountStructure: 'direct', lifeInsuranceCompany: '', relationshipManagerId: '', backupRmIds: [], beneficialOwnerIds: [], comment: '', authorizedEmail: '', authorizedCcEmails: [], authorizedPhone: '' }); setNewAccountCcInput(''); }}
                      style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
                    {(() => {
                      const addEmailOk = !newAccount.authorizedEmail || AUTHORIZED_EMAIL_REGEX.test(newAccount.authorizedEmail.trim());
                      const addPhoneOk = !newAccount.authorizedPhone || E164_PHONE_REGEX.test(newAccount.authorizedPhone.trim());
                      const canAdd = newAccount.bankId && newAccount.accountNumber && addEmailOk && addPhoneOk;
                      return (
                        <button onClick={handleAddBankAccount}
                          disabled={!canAdd}
                          style={{ padding: '8px 16px', background: !canAdd ? 'rgba(16, 185, 129, 0.4)' : '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: !canAdd ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Add Account</button>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Accounts Table */}
              {bankAccounts.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem', opacity: 0.3 }}>🏦</div>
                  <p style={{ margin: 0 }}>No bank accounts yet</p>
                </div>
              ) : (
                <div style={{ borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)' }}>
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Bank</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Name</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Account</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>CCY</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Type</th>
                        {entity?.isInsurance && <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>UBO</th>}
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Profile</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)', width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankAccounts.map((account, idx) => {
                        const bank = banks.find(b => b._id === account.bankId);
                        const isExpanded = expandedAccountId === account._id;
                        const profile = accountProfiles?.find(p => p.bankAccountId === account._id);
                        const uboIds = account.beneficialOwnerIds || (account.beneficialOwnerId ? [account.beneficialOwnerId] : []);
                        const ubos = uboIds.map(id => allEntities.find(e => e._id === id)).filter(Boolean);
                        const isEditing = editingBankAccount === account._id;

                        return (
                          <React.Fragment key={account._id}>
                            {/* Compact row */}
                            <tr
                              onClick={() => setExpandedAccountId(isExpanded ? null : account._id)}
                              style={{ cursor: 'pointer', background: idx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)', borderTop: idx > 0 ? '1px solid var(--border-color)' : 'none', transition: 'background 0.12s' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                              onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)'}
                            >
                              <td style={{ padding: '10px 14px', fontWeight: '600', color: 'var(--text-primary)' }}>{bank?.name || '-'}</td>
                              <td style={{ padding: '10px 14px', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{account.name || fullName}</td>
                              <td style={{ padding: '10px 14px', fontFamily: "'Roboto Mono', monospace", fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{account.accountNumber}</td>
                              <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', background: 'rgba(79, 166, 255, 0.1)', color: '#4da6ff' }}>{account.referenceCurrency}</span>
                              </td>
                              <td style={{ padding: '10px 14px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{account.comment || account.accountType}</td>
                              {entity?.isInsurance && <td style={{ padding: '10px 14px', fontSize: '0.82rem', color: ubos.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>{ubos.length > 0 ? ubos.map(u => ClientEntityHelpers.getEntityDisplayName(u)).join(', ') : '-'}</td>}
                              <td style={{ padding: '10px 14px' }}>
                                {profile ? (
                                  <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>{profile.profileName || 'Set'}</span>
                                ) : (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>-</span>
                                )}
                              </td>
                              <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: '0.8rem' }}>{isExpanded ? '▲' : '▼'}</td>
                            </tr>

                            {/* Expanded detail row */}
                            {isExpanded && (
                              <tr style={{ background: 'var(--bg-tertiary)' }}>
                                <td colSpan={entity?.isInsurance ? 8 : 7} style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>
                                    {/* Left: Account Details & Edit */}
                                    <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '10px', border: '1px solid var(--border-color)', gridColumn: isEditing && !isMobile ? '1 / -1' : 'auto' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)' }}>Account Details</h4>
                                        {!isEditing && (
                                          <button onClick={(e) => { e.stopPropagation(); handleEditBankAccount(account); setEditingBankAccount(account._id); }}
                                            style={{ padding: '4px 10px', background: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}>Edit</button>
                                        )}
                                      </div>
                                      {isEditing ? (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Name</label>
                                            <input type="text" value={editBankAccountData.name || ''} onChange={e => setEditBankAccountData(prev => ({...prev, name: e.target.value}))}
                                              placeholder={fullName}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                          </div>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Account Number</label>
                                            <input type="text" value={editBankAccountData.accountNumber || ''} onChange={e => setEditBankAccountData(prev => ({...prev, accountNumber: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                          </div>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Currency</label>
                                            <select value={editBankAccountData.referenceCurrency || 'EUR'} onChange={e => setEditBankAccountData(prev => ({...prev, referenceCurrency: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              {['EUR','USD','GBP','CHF','JPY','CAD','AUD','ILS'].map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                          </div>
                                          {(<>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Description</label>
                                            <select value={editBankAccountData.comment || ''} onChange={e => setEditBankAccountData(prev => ({...prev, comment: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              <option value="">-</option><option value="Investments">Investments</option><option value="Credit line">Credit line</option><option value="Spending">Spending</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Credit Line</label>
                                            <input type="number" value={editBankAccountData.authorizedOverdraft || ''} onChange={e => setEditBankAccountData(prev => ({...prev, authorizedOverdraft: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                          </div>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Introducer</label>
                                            <select value={editBankAccountData.introducerId || ''} onChange={e => setEditBankAccountData(prev => ({...prev, introducerId: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              <option value="">No Introducer</option>
                                              {introducers.map(i => <option key={i._id} value={i._id}>{`${i.profile?.firstName || ''} ${i.profile?.lastName || ''}`.trim()}</option>)}
                                            </select>
                                          </div>
                                          </>)}
                                          {(isEntityMode && entity?.isInsurance) && (
                                            <div style={{ gridColumn: '1 / -1' }}>
                                              <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Beneficial Owners (UBOs)</label>
                                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                {(editBankAccountData.beneficialOwnerIds || []).map(uboId => {
                                                  const uboEntity = allEntities.find(e => e._id === uboId);
                                                  return uboEntity ? (
                                                    <span key={uboId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: '600', background: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9' }}>
                                                      {ClientEntityHelpers.getEntityDisplayName(uboEntity)}
                                                      <span onClick={() => setEditBankAccountData(prev => ({...prev, beneficialOwnerIds: (prev.beneficialOwnerIds || []).filter(id => id !== uboId)}))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                                                    </span>
                                                  ) : null;
                                                })}
                                              </div>
                                              <select value="_placeholder" onChange={e => { const val = e.target.value; if (val && val !== '_placeholder') { setEditBankAccountData(prev => ({...prev, beneficialOwnerIds: [...(prev.beneficialOwnerIds || []), val]})); } }}
                                                style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                                <option value="_placeholder">Add UBO...</option>
                                                {allEntities.filter(e => e._id !== entityId && (e.type === ENTITY_TYPES.PHYSICAL_PERSON || e.type === ENTITY_TYPES.COMPANY) && !(editBankAccountData.beneficialOwnerIds || []).includes(e._id)).map(e => (
                                                  <option key={e._id} value={e._id}>{ClientEntityHelpers.getEntityDisplayName(e)}</option>
                                                ))}
                                              </select>
                                            </div>
                                          )}
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Relationship Manager</label>
                                            <select value={editBankAccountData.relationshipManagerId || ''} onChange={e => setEditBankAccountData(prev => ({...prev, relationshipManagerId: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              <option value="">No RM</option>
                                              {relationshipManagers.map(rm => <option key={rm._id} value={rm._id}>{rm.profile?.firstName} {rm.profile?.lastName}</option>)}
                                            </select>
                                          </div>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Backup RMs</label>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                              {(editBankAccountData.backupRmIds || []).map(rmId => {
                                                const rm = relationshipManagers.find(r => r._id === rmId);
                                                return rm ? (
                                                  <span key={rmId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: '600', background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
                                                    {rm.profile?.firstName} {rm.profile?.lastName}
                                                    <span onClick={() => setEditBankAccountData(prev => ({...prev, backupRmIds: (prev.backupRmIds || []).filter(id => id !== rmId)}))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                                                  </span>
                                                ) : null;
                                              })}
                                            </div>
                                            <select value={'_placeholder'} onChange={e => { const val = e.target.value; if (val && val !== '_placeholder') { setEditBankAccountData(prev => ({...prev, backupRmIds: [...(prev.backupRmIds || []), val]})); } }}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              <option value="_placeholder">Add backup...</option>
                                              {relationshipManagers.filter(rm => rm._id !== editBankAccountData.relationshipManagerId && !(editBankAccountData.backupRmIds || []).includes(rm._id)).map(rm => <option key={rm._id} value={rm._id}>{rm.profile?.firstName} {rm.profile?.lastName}</option>)}
                                            </select>
                                          </div>
                                          {(() => {
                                            const editEmailValid = !editBankAccountData.authorizedEmail || AUTHORIZED_EMAIL_REGEX.test((editBankAccountData.authorizedEmail || '').trim());
                                            const editPhoneValid = !editBankAccountData.authorizedPhone || E164_PHONE_REGEX.test((editBankAccountData.authorizedPhone || '').trim());
                                            const editCcInputValid = !editAccountCcInput.trim() || AUTHORIZED_EMAIL_REGEX.test(editAccountCcInput.trim());
                                            const handleAddEditCc = () => {
                                              const val = editAccountCcInput.trim();
                                              if (!val || !AUTHORIZED_EMAIL_REGEX.test(val)) return;
                                              if ((editBankAccountData.authorizedCcEmails || []).includes(val)) { setEditAccountCcInput(''); return; }
                                              setEditBankAccountData(prev => ({ ...prev, authorizedCcEmails: [...(prev.authorizedCcEmails || []), val] }));
                                              setEditAccountCcInput('');
                                            };
                                            return (
                                              <div style={{ gridColumn: '1 / -1', marginTop: '8px', paddingTop: '10px', borderTop: '1px dashed var(--border-color)' }}>
                                                <div style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Authorized contacts</div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                                                  <div>
                                                    <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Authorized email</label>
                                                    <input type="email" placeholder="orders@example.com" value={editBankAccountData.authorizedEmail || ''}
                                                      onChange={e => setEditBankAccountData(prev => ({ ...prev, authorizedEmail: e.target.value }))}
                                                      style={{ width: '100%', padding: '7px', border: `1px solid ${editEmailValid ? 'var(--border-color)' : '#ef4444'}`, borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                                    {!editEmailValid && <div style={{ color: '#ef4444', fontSize: '0.68rem', marginTop: '3px' }}>Invalid email format</div>}
                                                  </div>
                                                  <div>
                                                    <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Authorized phone (E.164)</label>
                                                    <input type="tel" placeholder="+33612345678" value={editBankAccountData.authorizedPhone || ''}
                                                      onChange={e => setEditBankAccountData(prev => ({ ...prev, authorizedPhone: e.target.value }))}
                                                      style={{ width: '100%', padding: '7px', border: `1px solid ${editPhoneValid ? 'var(--border-color)' : '#ef4444'}`, borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                                    {!editPhoneValid && <div style={{ color: '#ef4444', fontSize: '0.68rem', marginTop: '3px' }}>Must be E.164, e.g. +33612345678</div>}
                                                  </div>
                                                  <div style={{ gridColumn: '1 / -1' }}>
                                                    <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>CC emails</label>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                                      {(editBankAccountData.authorizedCcEmails || []).map(cc => (
                                                        <span key={cc} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: '600', background: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9' }}>
                                                          {cc}
                                                          <span onClick={() => setEditBankAccountData(prev => ({ ...prev, authorizedCcEmails: (prev.authorizedCcEmails || []).filter(e => e !== cc) }))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                                                        </span>
                                                      ))}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                      <input type="email" placeholder="cc@example.com" value={editAccountCcInput}
                                                        onChange={e => setEditAccountCcInput(e.target.value)}
                                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddEditCc(); } }}
                                                        style={{ flex: 1, padding: '7px', border: `1px solid ${editCcInputValid ? 'var(--border-color)' : '#ef4444'}`, borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                                      <button type="button" onClick={handleAddEditCc}
                                                        disabled={!editAccountCcInput.trim() || !editCcInputValid}
                                                        style={{ padding: '6px 12px', background: (!editAccountCcInput.trim() || !editCcInputValid) ? 'var(--bg-secondary)' : 'var(--accent-color)', color: (!editAccountCcInput.trim() || !editCcInputValid) ? 'var(--text-muted)' : 'white', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: (!editAccountCcInput.trim() || !editCcInputValid) ? 'not-allowed' : 'pointer', fontSize: '0.78rem', fontWeight: '600' }}>Add</button>
                                                    </div>
                                                    {!editCcInputValid && <div style={{ color: '#ef4444', fontSize: '0.68rem', marginTop: '3px' }}>Invalid email format</div>}
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })()}
                                          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', marginTop: '6px' }}>
                                            <button onClick={() => handleSaveEditBankAccount(account._id)} style={{ padding: '7px 14px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600' }}>Save</button>
                                            <button onClick={() => { setEditingBankAccount(null); setEditBankAccountData({}); setEditAccountCcInput(''); }} style={{ padding: '7px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.82rem' }}>Cancel</button>
                                            <button onClick={() => handleDeleteBankAccount(account._id)} style={{ padding: '7px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '0.82rem', marginLeft: 'auto' }}>Delete</button>
                                          </div>
                                        </div>
                                      ) : (() => {
                                        const rm = account.relationshipManagerId ? relationshipManagers.find(r => r._id === account.relationshipManagerId) : null;
                                        const intro = account.introducerId ? introducers.find(i => i._id === account.introducerId) : null;
                                        return (
                                        <div>
                                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px 24px' }}>
                                            <div>
                                              <div style={{ fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Currency</div>
                                              <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#4da6ff' }}>{account.referenceCurrency}</div>
                                            </div>
                                            <div>
                                              <div style={{ fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Description</div>
                                              <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{account.comment || account.accountType || '-'}</div>
                                            </div>
                                            {account.authorizedOverdraft > 0 && (
                                              <div>
                                                <div style={{ fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Credit Line</div>
                                                <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#10b981' }}>{account.referenceCurrency} {account.authorizedOverdraft?.toLocaleString()}</div>
                                              </div>
                                            )}
                                            <div>
                                              <div style={{ fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Relationship Manager</div>
                                              <div style={{ fontSize: '0.85rem', color: rm ? '#2563eb' : 'var(--text-muted)' }}>{rm ? `${rm.profile?.firstName} ${rm.profile?.lastName}` : '-'}</div>
                                            </div>
                                            {(account.backupRmIds || []).length > 0 && (
                                              <div>
                                                <div style={{ fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Backup RMs</div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                  {(account.backupRmIds || []).map(rmId => { const brm = relationshipManagers.find(r => r._id === rmId); return brm ? <span key={rmId} style={{ fontSize: '0.8rem', color: '#8b5cf6' }}>{brm.profile?.firstName} {brm.profile?.lastName}</span> : null; })}
                                                </div>
                                              </div>
                                            )}
                                            <div>
                                              <div style={{ fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Introducer</div>
                                              <div style={{ fontSize: '0.85rem', color: intro ? '#f59e0b' : 'var(--text-muted)' }}>{intro ? `${intro.profile?.firstName || ''} ${intro.profile?.lastName || ''}`.trim() : 'None'}</div>
                                            </div>
                                            {ubos.length > 0 && (
                                              <div>
                                                <div style={{ fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>UBOs</div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                  {ubos.map(u => <span key={u._id} style={{ fontSize: '0.8rem', color: '#0ea5e9' }}>{ClientEntityHelpers.getEntityDisplayName(u)}</span>)}
                                                </div>
                                              </div>
                                            )}
                                            {account.accountType === 'life_insurance' && account.lifeInsuranceCompany && (
                                              <div>
                                                <div style={{ fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Insurance Company</div>
                                                <div style={{ fontSize: '0.85rem', color: '#8b5cf6' }}>{account.lifeInsuranceCompany}</div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                        );
                                      })()}
                                    </div>

                                    {/* Right: Investment Profile */}
                                    <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)' }}>Investment Profile</h4>
                                        <button onClick={(e) => { e.stopPropagation(); if (editingAccountProfile === account._id) { handleSaveAccountProfile(account._id); } else { handleStartEditAccountProfile(account._id); } }}
                                          style={{ padding: '4px 10px', background: editingAccountProfile === account._id ? '#10b981' : 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}>
                                          {editingAccountProfile === account._id ? 'Save' : (profile ? 'Edit' : 'Set Profile')}
                                        </button>
                                      </div>
                                      {editingAccountProfile === account._id ? (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                          <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Template</label>
                                            <select onChange={e => { if (e.target.value) applyTemplate(e.target.value); }} style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              <option value="">Apply template...</option>
                                              {Object.entries(PROFILE_TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}
                                            </select>
                                          </div>
                                          {['maxCash', 'maxBonds', 'maxEquities', 'maxAlternative'].map(field => (
                                            <div key={field}>
                                              <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>{field.replace('max', '')}</label>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <input type="number" min="0" max="100" value={accountProfileDraft[field]} onChange={e => handleAccountAllocationChange(field, e.target.value)}
                                                  style={{ width: '60px', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', textAlign: 'center' }} />
                                                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>%</span>
                                              </div>
                                            </div>
                                          ))}
                                          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <input type="checkbox" checked={accountProfileDraft.isProfessionalInvestor || false} onChange={e => setAccountProfileDraft(prev => ({...prev, isProfessionalInvestor: e.target.checked}))} />
                                            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Professional Investor</span>
                                          </div>
                                          <div style={{ gridColumn: '1 / -1' }}>
                                            <button onClick={() => setEditingAccountProfile(null)} style={{ padding: '6px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
                                          </div>
                                        </div>
                                      ) : profile ? (
                                        <div>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                                            {profile.profileName && <span style={{ padding: '3px 8px', borderRadius: '5px', fontSize: '0.75rem', fontWeight: '600', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>{profile.profileName}</span>}
                                            {profile.isProfessionalInvestor && <span style={{ padding: '3px 8px', borderRadius: '5px', fontSize: '0.75rem', fontWeight: '600', background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>Professional</span>}
                                          </div>
                                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                                            {[{label:'Cash', val: profile.maxCash}, {label:'Bonds', val: profile.maxBonds}, {label:'Equities', val: profile.maxEquities}, {label:'Alt.', val: profile.maxAlternative}].map(c => (
                                              <div key={c.label} style={{ padding: '8px', background: 'var(--bg-secondary)', borderRadius: '6px', textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '2px' }}>{c.label}</div>
                                                <div style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>{c.val}%</div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No profile set</div>
                                      )}
                                    </div>

                                    {/* Right: Risk Matrix */}
                                    {hasUser && user.role === USER_ROLES.CLIENT && (() => {
                                      const riskScore = user.profile?.kycRiskScore;
                                      const getHighestRisk = (rs) => {
                                        if (!rs) return null;
                                        const levels = [rs.clientProspect?.riskLevel, rs.beneficialOwner?.riskLevel, rs.businessRelationship?.riskLevel].filter(Boolean);
                                        return levels.includes('high') ? 'high' : levels.includes('medium') ? 'medium' : levels.length > 0 ? 'low' : null;
                                      };
                                      const highestRisk = getHighestRisk(riskScore);
                                      const display = highestRisk ? getRiskLevelDisplay(highestRisk) : null;
                                      const isOverdue = riskScore?.nextReviewDate && new Date(riskScore.nextReviewDate) < new Date();

                                      return (
                                        <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                            <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)' }}>Risk Matrix</h4>
                                            <button onClick={(e) => { e.stopPropagation(); setRiskScoreModalOpen(true); setEditingRiskScore(true); }}
                                              style={{ padding: '4px 10px', background: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}>
                                              {riskScore ? 'Edit' : 'Assess'}
                                            </button>
                                          </div>
                                          {riskScore ? (
                                            <div>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                                <span style={{
                                                  padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: '600',
                                                  background: `${display.color}15`, border: `1px solid ${display.color}40`, color: display.color
                                                }}>
                                                  {display.emoji} {display.labelEn}
                                                </span>
                                              </div>
                                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '10px' }}>
                                                {[
                                                  { label: 'Client', data: riskScore.clientProspect },
                                                  { label: 'Benef.', data: riskScore.beneficialOwner },
                                                  { label: 'Bus. Rel.', data: riskScore.businessRelationship }
                                                ].map(col => {
                                                  const colDisplay = col.data?.riskLevel ? getRiskLevelDisplay(col.data.riskLevel) : null;
                                                  return (
                                                    <div key={col.label} style={{ padding: '6px', background: 'var(--bg-primary)', borderRadius: '6px', textAlign: 'center' }}>
                                                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '2px' }}>{col.label}</div>
                                                      <div style={{ fontSize: '0.9rem', fontWeight: '700', color: colDisplay?.color || 'var(--text-muted)' }}>
                                                        {col.data?.totalScore ?? '-'}
                                                      </div>
                                                      {colDisplay && <div style={{ fontSize: '0.6rem', color: colDisplay.color }}>{colDisplay.labelEn}</div>}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                {riskScore.assessmentDate && (
                                                  <span>Assessed: {new Date(riskScore.assessmentDate).toLocaleDateString()}</span>
                                                )}
                                                {riskScore.nextReviewDate && (
                                                  <span style={{ color: isOverdue ? '#ef4444' : 'var(--text-muted)', fontWeight: isOverdue ? '600' : '400' }}>
                                                    Review: {new Date(riskScore.nextReviewDate).toLocaleDateString()} {isOverdue ? '(overdue)' : ''}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                          ) : (
                                            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Not assessed</div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Stakeholders - stakeholders tab (company entities) */}
          {activeTab === 'stakeholders' && ((isEntityMode && entity?.type === ENTITY_TYPES.COMPANY) || (hasUser && user?.role === USER_ROLES.CLIENT && user?.profile?.clientType === 'company')) && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.3rem' }}>🏛️</span> Stakeholders
                </h2>
                <button onClick={() => setShowAddStakeholder(!showAddStakeholder)} style={{
                  background: showAddStakeholder ? 'var(--danger-color)' : '#10b981', color: 'white', border: 'none',
                  padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600'
                }}>{showAddStakeholder ? 'Cancel' : '+ Add Stakeholder'}</button>
              </div>

              {/* Add Stakeholder Form */}
              {showAddStakeholder && (
                <div style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Person / Company *</label>
                      <select
                        value={newStakeholder.entityId || ''}
                        onChange={(e) => {
                          const selected = allEntities.find(ent => ent._id === e.target.value);
                          setNewStakeholder({
                            ...newStakeholder,
                            entityId: e.target.value,
                            name: selected ? ClientEntityHelpers.getEntityDisplayName(selected) : ''
                          });
                        }}
                        style={{ width: '100%', padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.9rem', cursor: 'pointer' }}
                      >
                        <option value="">Select person or company...</option>
                        {allEntities
                          .filter(e => e._id !== entityId && (e.type === ENTITY_TYPES.PHYSICAL_PERSON || e.type === ENTITY_TYPES.COMPANY))
                          .map(e => (
                            <option key={e._id} value={e._id}>
                              {ClientEntityHelpers.getEntityDisplayName(e)} ({ClientEntityHelpers.getEntityTypeLabel(e.type)})
                            </option>
                          ))
                        }
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Role *</label>
                      <select value={newStakeholder.role} onChange={(e) => setNewStakeholder({ ...newStakeholder, role: e.target.value })}
                        style={{ width: '100%', padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.9rem', cursor: 'pointer' }}>
                        <option value="ubo">Ultimate Beneficial Owner (UBO)</option>
                        <option value="director">Director</option>
                        <option value="signatory">Authorized Signatory</option>
                        <option value="shareholder">Shareholder</option>
                      </select>
                    </div>
                    {(newStakeholder.role === 'ubo' || newStakeholder.role === 'shareholder') && (
                      <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Ownership %</label>
                        <input type="number" value={newStakeholder.ownership} onChange={(e) => setNewStakeholder({ ...newStakeholder, ownership: e.target.value })}
                          placeholder="e.g. 25" min="0" max="100"
                          style={{ width: '100%', padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                      </div>
                    )}
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Notes</label>
                      <input type="text" value={newStakeholder.notes} onChange={(e) => setNewStakeholder({ ...newStakeholder, notes: e.target.value })}
                        placeholder="Optional notes"
                        style={{ width: '100%', padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => { setShowAddStakeholder(false); setNewStakeholder({ entityId: '', name: '', role: 'ubo', ownership: '', notes: '' }); }}
                      style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
                    <button
                      onClick={async () => {
                        if (!newStakeholder.entityId) return;
                        const { _editIdx, ...shData } = newStakeholder;
                        let updated;
                        if (_editIdx !== undefined && _editIdx !== null) {
                          updated = stakeholders.map((s, i) => i === _editIdx ? { ...s, ...shData } : s);
                        } else {
                          updated = [...stakeholders, { ...shData, _id: Date.now().toString(), createdAt: new Date() }];
                        }
                        setStakeholders(updated);
                        try {
                          if (isEntityMode && entityId) {
                            await Meteor.callAsync('clientEntities.update', entityId, { stakeholders: updated }, sessionId);
                          } else {
                            await Meteor.callAsync('users.updateProfile', userId, { profile: { ...user.profile, stakeholders: updated, updatedAt: new Date() } }, sessionId);
                          }
                        } catch (err) { console.error('Error saving stakeholder:', err); }
                        setNewStakeholder({ entityId: '', name: '', role: 'ubo', ownership: '', notes: '' });
                        setShowAddStakeholder(false);
                      }}
                      disabled={!newStakeholder.entityId}
                      style={{ padding: '8px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontWeight: '500', fontSize: '0.85rem', opacity: !newStakeholder.entityId ? 0.5 : 1 }}
                    >{newStakeholder._editIdx !== undefined && newStakeholder._editIdx !== null ? 'Save' : 'Add'}</button>
                  </div>
                </div>
              )}

              {/* Stakeholder List */}
              {stakeholders.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>Add UBOs, directors, and other key persons</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {stakeholders.map((sh, idx) => {
                    const roleLabels = { ubo: 'UBO', director: 'Director', signatory: 'Signatory', shareholder: 'Shareholder' };
                    const roleColors = { ubo: '#dc2626', director: '#2563eb', signatory: '#059669', shareholder: '#7c3aed' };
                    return (
                      <div key={sh._id || idx} style={{ padding: '14px 16px', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.95rem' }}>{sh.name}</span>
                            <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', color: roleColors[sh.role] || '#6b7280', background: `${roleColors[sh.role] || '#6b7280'}15` }}>
                              {roleLabels[sh.role] || sh.role}
                            </span>
                            {sh.ownership && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{sh.ownership}%</span>}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {sh.entityId && (() => { const ent = allEntities.find(e => e._id === sh.entityId); return ent ? <span>{ClientEntityHelpers.getEntityTypeLabel(ent.type)}</span> : null; })()}
                            {sh.entityId && sh.notes && <span> · </span>}
                            {sh.notes && <span>{sh.notes}</span>}
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            const updated = stakeholders.filter((_, i) => i !== idx);
                            setStakeholders(updated);
                            try {
                              if (isEntityMode && entityId) {
                                await Meteor.callAsync('clientEntities.update', entityId, { stakeholders: updated }, sessionId);
                              } else {
                                await Meteor.callAsync('users.updateProfile', userId, { profile: { ...user.profile, stakeholders: updated, updatedAt: new Date() } }, sessionId);
                              }
                            } catch (err) { console.error('Error removing stakeholder:', err); }
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-muted)', padding: '4px' }}
                          title="Remove stakeholder"
                        >×</button>
                        <button
                          onClick={() => {
                            setNewStakeholder({ entityId: sh.entityId || '', name: sh.name, role: sh.role, ownership: sh.ownership || '', notes: sh.notes || '', _editIdx: idx });
                            setShowAddStakeholder(true);
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--accent-color)', padding: '4px' }}
                          title="Edit stakeholder"
                        >Edit</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Documents - documents tab (when viewing a client profile) */}
          {activeTab === 'documents' && (isEntityMode || (hasUser && user.role === USER_ROLES.CLIENT)) && (
            <ClientDocumentManager
              userId={userId || entityId}
              familyMembers={user?.profile?.familyMembers || entity?.profile?.familyMembers || []}
            />
          )}

          {/* KYC - kyc tab (when viewing a client profile) */}
          {activeTab === 'kyc' && hasUser && user.role === USER_ROLES.CLIENT && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span>✅</span> KYC Status
                </h2>
              </div>

              {/* KYC Status Overview */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '24px'
              }}>
                {/* Identity Verification */}
                <div style={{
                  padding: '16px',
                  background: user.profile?.kyc?.identityVerified ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  border: `1px solid ${user.profile?.kyc?.identityVerified ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                  borderRadius: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.25rem' }}>{user.profile?.kyc?.identityVerified ? '✅' : '⏳'}</span>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Identity</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {user.profile?.kyc?.identityVerified ? 'Verified' : 'Pending verification'}
                  </div>
                  {user.profile?.kyc?.identityVerifiedDate && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {new Date(user.profile.kyc.identityVerifiedDate).toLocaleDateString()}
                    </div>
                  )}
                </div>

                {/* Address Verification */}
                <div style={{
                  padding: '16px',
                  background: user.profile?.kyc?.addressVerified ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  border: `1px solid ${user.profile?.kyc?.addressVerified ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                  borderRadius: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.25rem' }}>{user.profile?.kyc?.addressVerified ? '✅' : '⏳'}</span>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Address</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {user.profile?.kyc?.addressVerified ? 'Verified' : 'Pending verification'}
                  </div>
                  {user.profile?.kyc?.addressVerifiedDate && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {new Date(user.profile.kyc.addressVerifiedDate).toLocaleDateString()}
                    </div>
                  )}
                </div>

                {/* Source of Funds */}
                <div style={{
                  padding: '16px',
                  background: user.profile?.kyc?.sourceOfFundsVerified ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  border: `1px solid ${user.profile?.kyc?.sourceOfFundsVerified ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                  borderRadius: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.25rem' }}>{user.profile?.kyc?.sourceOfFundsVerified ? '✅' : '⏳'}</span>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Source of Funds</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {user.profile?.kyc?.sourceOfFundsVerified ? 'Verified' : 'Pending verification'}
                  </div>
                  {user.profile?.kyc?.sourceOfFundsVerifiedDate && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {new Date(user.profile.kyc.sourceOfFundsVerifiedDate).toLocaleDateString()}
                    </div>
                  )}
                </div>

                {/* Risk Assessment */}
                <div style={{
                  padding: '16px',
                  background: user.profile?.kyc?.riskLevel
                    ? (user.profile.kyc.riskLevel === 'low' ? 'rgba(16, 185, 129, 0.1)'
                       : user.profile.kyc.riskLevel === 'medium' ? 'rgba(245, 158, 11, 0.1)'
                       : 'rgba(239, 68, 68, 0.1)')
                    : 'rgba(107, 114, 128, 0.1)',
                  border: `1px solid ${user.profile?.kyc?.riskLevel
                    ? (user.profile.kyc.riskLevel === 'low' ? 'rgba(16, 185, 129, 0.3)'
                       : user.profile.kyc.riskLevel === 'medium' ? 'rgba(245, 158, 11, 0.3)'
                       : 'rgba(239, 68, 68, 0.3)')
                    : 'rgba(107, 114, 128, 0.3)'}`,
                  borderRadius: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.25rem' }}>
                      {user.profile?.kyc?.riskLevel === 'low' ? '🟢'
                       : user.profile?.kyc?.riskLevel === 'medium' ? '🟡'
                       : user.profile?.kyc?.riskLevel === 'high' ? '🔴'
                       : '⚪'}
                    </span>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Risk Level</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                    {user.profile?.kyc?.riskLevel || 'Not assessed'}
                  </div>
                </div>
              </div>

              {/* KYC Details */}
              <div style={{
                padding: '16px',
                background: 'var(--bg-secondary)',
                borderRadius: '12px',
                border: '1px solid var(--border-color)'
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                  Additional Information
                </h3>

                <div style={{ display: 'grid', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Nationality</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                      {user.profile?.kyc?.nationality || '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Tax Residence</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                      {user.profile?.kyc?.taxResidence || '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>PEP Status</span>
                    <span style={{
                      color: user.profile?.kyc?.isPEP ? '#f59e0b' : 'var(--text-primary)',
                      fontWeight: '500'
                    }}>
                      {user.profile?.kyc?.isPEP ? 'Yes - Politically Exposed Person' : 'No'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Last Review</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                      {user.profile?.kyc?.lastReviewDate
                        ? new Date(user.profile.kyc.lastReviewDate).toLocaleDateString()
                        : '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Next Review Due</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                      {user.profile?.kyc?.nextReviewDate
                        ? new Date(user.profile.kyc.nextReviewDate).toLocaleDateString()
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {user.profile?.kyc?.notes && (
                <div style={{
                  marginTop: '16px',
                  padding: '16px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)'
                }}>
                  <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                    Notes
                  </h3>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                    {user.profile.kyc.notes}
                  </p>
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* KYC Risk Score - riskScore tab (when viewing a client profile) */}
          {activeTab === 'riskScore' && hasUser && user.role === USER_ROLES.CLIENT && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span>📊</span> KYC Risk Assessment
                </h2>
                {!editingRiskScore && (currentUser?.role === USER_ROLES.SUPERADMIN || currentUser?.role === USER_ROLES.ADMIN || currentUser?.role === USER_ROLES.COMPLIANCE) && (
                  <button
                    onClick={() => setEditingRiskScore(true)}
                    style={{
                      padding: '8px 16px',
                      background: 'linear-gradient(135deg, var(--accent-color) 0%, var(--accent-color-dark, #0284c7) 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    ✏️ Edit
                  </button>
                )}
              </div>

              {/* Assessment Info Bar */}
              {user.profile?.kycRiskScore?.assessmentDate && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '16px',
                  marginBottom: '24px',
                  padding: '12px 16px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '8px',
                  fontSize: '0.85rem'
                }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Last Assessment: </span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                      {new Date(user.profile.kycRiskScore.assessmentDate).toLocaleDateString()}
                    </span>
                  </div>
                  {user.profile?.kycRiskScore?.nextReviewDate && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Next Review Due: </span>
                      <span style={{
                        color: new Date(user.profile.kycRiskScore.nextReviewDate) < new Date() ? '#ef4444' : 'var(--text-primary)',
                        fontWeight: '500'
                      }}>
                        {new Date(user.profile.kycRiskScore.nextReviewDate).toLocaleDateString()}
                        {new Date(user.profile.kycRiskScore.nextReviewDate) < new Date() && ' (Overdue)'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Risk Score Matrix Table */}
              <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.85rem'
                }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-tertiary)' }}>
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        borderBottom: '2px solid var(--border-color)',
                        minWidth: '200px'
                      }}>
                        Criteria
                      </th>
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        borderBottom: '2px solid var(--border-color)',
                        minWidth: '180px'
                      }}>
                        Client Prospect
                      </th>
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        borderBottom: '2px solid var(--border-color)',
                        minWidth: '180px'
                      }}>
                        Beneficial Owner
                      </th>
                      <th style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        borderBottom: '2px solid var(--border-color)',
                        minWidth: '180px'
                      }}>
                        Business Relationship
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {RISK_CRITERIA.map((criterion, idx) => (
                      <tr key={criterion.id} style={{
                        background: idx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)'
                      }}>
                        <td style={{
                          padding: '10px 16px',
                          borderBottom: '1px solid var(--border-color)',
                          color: 'var(--text-primary)'
                        }}>
                          <span style={{ color: 'var(--text-secondary)', marginRight: '8px' }}>{criterion.number}.</span>
                          {criterion.labelEn}
                        </td>
                        {['clientProspect', 'beneficialOwner', 'businessRelationship'].map(column => (
                          <td key={column} style={{
                            padding: '10px 16px',
                            borderBottom: '1px solid var(--border-color)',
                            textAlign: 'center'
                          }}>
                            {editingRiskScore ? (
                              <select
                                value={riskScoreForm[column][criterion.id] || ''}
                                onChange={(e) => handleRiskScoreChange(column, criterion.id, e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '8px 12px',
                                  background: 'var(--bg-primary)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '6px',
                                  color: 'var(--text-primary)',
                                  fontSize: '0.8rem',
                                  cursor: 'pointer'
                                }}
                              >
                                <option value="">-- Select --</option>
                                {criterion.options.map(option => (
                                  <option key={option.value} value={option.value}>
                                    {option.labelEn} ({option.score} pts)
                                  </option>
                                ))}
                              </select>
                            ) : (
                              (() => {
                                const savedValue = user.profile?.kycRiskScore?.[column]?.criteria?.[criterion.id];
                                const selectedOption = criterion.options.find(o => o.value === savedValue);
                                if (selectedOption) {
                                  return (
                                    <span style={{
                                      padding: '4px 10px',
                                      background: selectedOption.score >= 10 ? 'rgba(239, 68, 68, 0.1)'
                                        : selectedOption.score >= 3 ? 'rgba(245, 158, 11, 0.1)'
                                        : 'rgba(16, 185, 129, 0.1)',
                                      border: `1px solid ${selectedOption.score >= 10 ? 'rgba(239, 68, 68, 0.3)'
                                        : selectedOption.score >= 3 ? 'rgba(245, 158, 11, 0.3)'
                                        : 'rgba(16, 185, 129, 0.3)'}`,
                                      borderRadius: '4px',
                                      fontSize: '0.8rem',
                                      color: selectedOption.score >= 10 ? '#ef4444'
                                        : selectedOption.score >= 3 ? '#f59e0b'
                                        : '#10b981'
                                    }}>
                                      {selectedOption.labelEn} ({selectedOption.score})
                                    </span>
                                  );
                                }
                                return <span style={{ color: 'var(--text-muted)' }}>—</span>;
                              })()
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {/* Totals Row */}
                  <tfoot>
                    <tr style={{ background: 'var(--bg-tertiary)' }}>
                      <td style={{
                        padding: '14px 16px',
                        fontWeight: '700',
                        color: 'var(--text-primary)',
                        borderTop: '2px solid var(--border-color)'
                      }}>
                        TOTAL SCORE
                      </td>
                      {['clientProspect', 'beneficialOwner', 'businessRelationship'].map(column => {
                        const result = editingRiskScore
                          ? calculateRiskScore(riskScoreForm[column])
                          : {
                              totalScore: user.profile?.kycRiskScore?.[column]?.totalScore || 0,
                              riskLevel: user.profile?.kycRiskScore?.[column]?.riskLevel || null
                            };
                        const display = getRiskLevelDisplay(result.riskLevel);
                        return (
                          <td key={column} style={{
                            padding: '14px 16px',
                            textAlign: 'center',
                            borderTop: '2px solid var(--border-color)'
                          }}>
                            <div style={{
                              fontSize: '1.5rem',
                              fontWeight: '700',
                              color: display.color,
                              marginBottom: '4px'
                            }}>
                              {result.totalScore}
                            </div>
                            <div style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '4px 12px',
                              background: `${display.color}15`,
                              border: `1px solid ${display.color}40`,
                              borderRadius: '20px',
                              fontSize: '0.8rem',
                              fontWeight: '600',
                              color: display.color
                            }}>
                              {display.emoji} {display.labelEn}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Score Legend */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '16px',
                marginBottom: '24px',
                padding: '16px',
                background: 'var(--bg-secondary)',
                borderRadius: '8px'
              }}>
                <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginRight: '8px' }}>Score Classification:</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#10b981' }}>🟢</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>&lt; 15 pts = Low Risk (review every 2 years)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#f59e0b' }}>🟡</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>15-29 pts = Medium Risk (review every 2 years)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#ef4444' }}>🔴</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>≥ 30 pts = High Risk (review every year)</span>
                </div>
              </div>

              {/* Comments Section */}
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{
                  margin: '0 0 12px',
                  fontSize: '1rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  Comments
                </h3>
                {editingRiskScore ? (
                  <textarea
                    value={riskScoreForm.comments}
                    onChange={(e) => setRiskScoreForm(prev => ({ ...prev, comments: e.target.value }))}
                    placeholder="Enter any additional comments or observations..."
                    style={{
                      width: '100%',
                      minHeight: '100px',
                      padding: '12px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                      resize: 'vertical'
                    }}
                  />
                ) : (
                  <div style={{
                    padding: '12px 16px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '8px',
                    color: user.profile?.kycRiskScore?.comments ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: '0.9rem',
                    whiteSpace: 'pre-wrap',
                    minHeight: '60px'
                  }}>
                    {user.profile?.kycRiskScore?.comments || 'No comments recorded.'}
                  </div>
                )}
              </div>

              {/* Action Buttons (Edit Mode) */}
              {editingRiskScore && (
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => {
                      setEditingRiskScore(false);
                      setRiskScoreForm(getInitialRiskScoreForm());
                    }}
                    disabled={savingRiskScore}
                    style={{
                      padding: '12px 24px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      cursor: savingRiskScore ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      opacity: savingRiskScore ? 0.5 : 1,
                      transition: 'all 0.3s ease'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveRiskScore}
                    disabled={savingRiskScore}
                    style={{
                      padding: '12px 24px',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: savingRiskScore ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: savingRiskScore ? 0.7 : 1,
                      transition: 'all 0.3s ease'
                    }}
                  >
                    {savingRiskScore ? (
                      <>
                        <span style={{
                          width: '16px',
                          height: '16px',
                          border: '2px solid rgba(255,255,255,0.3)',
                          borderTopColor: '#fff',
                          borderRadius: '50%',
                          animation: 'spin 1s linear infinite'
                        }} />
                        Saving...
                      </>
                    ) : (
                      <>💾 Save Assessment</>
                    )}
                  </button>
                </div>
              )}

              {/* No Assessment Yet */}
              {!user.profile?.kycRiskScore && !editingRiskScore && (
                <div style={{
                  padding: '32px',
                  textAlign: 'center',
                  background: 'var(--bg-secondary)',
                  borderRadius: '12px',
                  border: '1px dashed var(--border-color)'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px', opacity: 0.5 }}>📋</div>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>
                    No KYC risk assessment has been performed for this client yet.
                  </p>
                  {(currentUser?.role === USER_ROLES.SUPERADMIN || currentUser?.role === USER_ROLES.ADMIN || currentUser?.role === USER_ROLES.COMPLIANCE) && (
                    <button
                      onClick={() => setEditingRiskScore(true)}
                      style={{
                        marginTop: '16px',
                        padding: '10px 20px',
                        background: 'linear-gradient(135deg, var(--accent-color) 0%, var(--accent-color-dark, #0284c7) 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                    >
                      Start Assessment
                    </button>
                  )}
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Family Members - family tab (when viewing a client profile) */}
          {activeTab === 'family' && hasUser && user.role === USER_ROLES.CLIENT && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span style={{ fontSize: '24px' }}>👨‍👩‍👧‍👦</span>
                  Family Members
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '12px',
                    background: isDarkMode ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                    color: '#8b5cf6',
                    fontSize: '14px',
                    fontWeight: '600'
                  }}>
                    {user.profile?.familyMembers?.length || 0}
                  </span>
                </h2>
                <button
                  onClick={() => setShowAddFamilyMember(true)}
                  style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 4px 8px rgba(139, 92, 246, 0.3)'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  + Add Member
                </button>
              </div>

              {showAddFamilyMember && (
                <div style={{
                  marginBottom: '24px',
                  padding: '20px',
                  background: isDarkMode ? 'rgba(139, 92, 246, 0.05)' : 'rgba(139, 92, 246, 0.03)',
                  borderRadius: '12px',
                  border: `2px solid ${isDarkMode ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.15)'}`,
                  animation: 'slideUp 0.3s ease-out'
                }}>
                  <h3 style={{
                    margin: '0 0 16px',
                    color: 'var(--text-primary)',
                    fontSize: '16px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '20px' }}>➕</span>
                    New Family Member
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                    <div>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        color: isDarkMode ? '#e5e7eb' : '#374151',
                        fontSize: '13px',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Name *
                      </label>
                      <input
                        type="text"
                        value={newFamilyMember.name}
                        onChange={(e) => setNewFamilyMember({ ...newFamilyMember, name: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          fontSize: '15px',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        color: isDarkMode ? '#e5e7eb' : '#374151',
                        fontSize: '13px',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Relationship
                      </label>
                      <select
                        value={newFamilyMember.relationship}
                        onChange={(e) => setNewFamilyMember({ ...newFamilyMember, relationship: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          fontSize: '15px',
                          outline: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="spouse">💑 Spouse</option>
                        <option value="child">👶 Child</option>
                        <option value="parent">👴 Parent</option>
                        <option value="sibling">👫 Sibling</option>
                      </select>
                    </div>

                    <div>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        color: isDarkMode ? '#e5e7eb' : '#374151',
                        fontSize: '13px',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Date of Birth
                      </label>
                      <input
                        type="date"
                        value={newFamilyMember.birthday}
                        onChange={(e) => setNewFamilyMember({ ...newFamilyMember, birthday: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          fontSize: '15px',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                    <button
                      onClick={() => {
                        setShowAddFamilyMember(false);
                        setNewFamilyMember({ name: '', relationship: 'spouse', birthday: '' });
                      }}
                      style={{
                        padding: '10px 20px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddFamilyMember}
                      style={{
                        padding: '10px 20px',
                        background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500',
                        boxShadow: '0 4px 8px rgba(139, 92, 246, 0.3)'
                      }}
                    >
                      ✓ Add Member
                    </button>
                  </div>
                </div>
              )}

              {(!user.profile?.familyMembers || user.profile.familyMembers.length === 0) && !showAddFamilyMember ? (
                <div style={{
                  padding: '48px 24px',
                  textAlign: 'center',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '12px',
                  border: '2px dashed var(--border-color)'
                }}>
                  <div style={{ fontSize: '64px', marginBottom: '16px', opacity: 0.5 }}>👨‍👩‍👧‍👦</div>
                  <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '16px', fontWeight: '500' }}>
                    No family members added
                  </p>
                  <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Add family members to keep track of important information
                  </p>
                  <button
                    onClick={() => setShowAddFamilyMember(true)}
                    style={{
                      padding: '10px 24px',
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                  >
                    + Add Your First Family Member
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                  {(user.profile?.familyMembers || []).map(member => {
                    const memberInitials = member.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
                    const age = calculateAge(member.birthday);
                    const relationshipEmoji = {
                      spouse: '💑',
                      child: '👶',
                      parent: '👴',
                      sibling: '👫'
                    }[member.relationship] || '👤';

                    return (
                      <div
                        key={member._id}
                        style={{
                          padding: '20px',
                          background: isDarkMode
                            ? 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)'
                            : 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.01) 100%)',
                          borderRadius: '12px',
                          border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                          transition: 'all 0.3s ease',
                          position: 'relative'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-4px)';
                          e.currentTarget.style.boxShadow = `0 12px 20px ${isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)'}`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        <button
                          onClick={() => handleDeleteFamilyMember(member._id)}
                          style={{
                            position: 'absolute',
                            top: '12px',
                            right: '12px',
                            padding: '6px 10px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '6px',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600',
                            transition: 'all 0.3s ease'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                        >
                          🗑️
                        </button>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                          <div style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '50%',
                            background: getAvatarGradient(member.name),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '20px',
                            fontWeight: '700',
                            color: '#fff',
                            boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
                          }}>
                            {memberInitials}
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{
                              margin: '0 0 4px',
                              color: 'var(--text-primary)',
                              fontSize: '16px',
                              fontWeight: '600'
                            }}>
                              {member.name}
                            </p>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}>
                              <span style={{
                                padding: '3px 10px',
                                borderRadius: '8px',
                                background: isDarkMode ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                                color: '#8b5cf6',
                                fontSize: '12px',
                                fontWeight: '600',
                                textTransform: 'capitalize'
                              }}>
                                {relationshipEmoji} {member.relationship}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div style={{
                          padding: '12px',
                          background: 'var(--bg-tertiary)',
                          borderRadius: '8px',
                          fontSize: '13px',
                          color: 'var(--text-secondary)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>🎂</span>
                            {member.birthday ? (
                              <>
                                {new Date(member.birthday).toLocaleDateString()}
                                {age && (
                                  <span style={{
                                    marginLeft: '8px',
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    background: isDarkMode ? 'rgba(79, 166, 255, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                    color: '#4da6ff',
                                    fontSize: '12px',
                                    fontWeight: '600'
                                  }}>
                                    {age} years
                                  </span>
                                )}
                              </>
                            ) : (
                              <span>Date of birth not set</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Password Reset (ADMIN and SUPERADMIN - but ADMINs cannot reset SUPERADMIN passwords) - password tab */}
          {activeTab === 'password' && (currentUser?.role === USER_ROLES.SUPERADMIN ||
            (currentUser?.role === USER_ROLES.ADMIN && user?.role !== USER_ROLES.SUPERADMIN)) && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: isDarkMode ? '#fff' : '#000',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span style={{ fontSize: '24px' }}>🔒</span>
                  Password Reset
                </h2>
                {!editingPassword && (
                  <button
                    onClick={() => setEditingPassword(true)}
                    style={{
                      padding: '8px 16px',
                      background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 4px 8px rgba(239, 68, 68, 0.3)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    🔑 Reset Password
                  </button>
                )}
              </div>

              {editingPassword ? (
                <div>
                  {/* Warning Alert */}
                  <div style={{
                    padding: '16px',
                    marginBottom: '20px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: '10px',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'flex-start'
                  }}>
                    <span style={{ fontSize: '24px', flexShrink: 0 }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                      <p style={{
                        margin: '0 0 6px',
                        color: '#f59e0b',
                        fontSize: '14px',
                        fontWeight: '600'
                      }}>
                        Security Warning
                      </p>
                      <p style={{
                        margin: 0,
                        color: 'var(--warning-color)',
                        fontSize: '13px',
                        lineHeight: 1.5
                      }}>
                        The user will be logged out of all active sessions and must use the new password to log in again.
                      </p>
                    </div>
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: isDarkMode ? '#e5e7eb' : '#374151',
                      fontSize: '13px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      New Password (min 6 characters)
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={formData.newPassword}
                        onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px 44px 12px 12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          fontSize: '15px',
                          outline: 'none'
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          position: 'absolute',
                          right: '8px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          padding: '6px',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '20px',
                          opacity: 0.6
                        }}
                      >
                        {showPassword ? '🙈' : '👁️'}
                      </button>
                    </div>

                    {/* Password Strength Indicator */}
                    {formData.newPassword && (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            Password Strength:
                          </span>
                          <span style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            color: getPasswordStrength(formData.newPassword).color
                          }}>
                            {getPasswordStrength(formData.newPassword).label}
                          </span>
                        </div>
                        <div style={{
                          height: '6px',
                          background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                          borderRadius: '3px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${(getPasswordStrength(formData.newPassword).strength / 5) * 100}%`,
                            background: getPasswordStrength(formData.newPassword).color,
                            transition: 'all 0.3s ease'
                          }} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => {
                        setEditingPassword(false);
                        setFormData({ ...formData, newPassword: '' });
                        setShowPassword(false);
                      }}
                      style={{
                        padding: '12px 24px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500',
                        transition: 'all 0.3s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleResetPassword}
                      style={{
                        padding: '12px 24px',
                        background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500',
                        transition: 'all 0.3s ease',
                        boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                      onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                    >
                      🔒 Reset Password
                    </button>
                  </div>
                </div>
              ) : passwordResetSuccess ? (
                <div style={{
                  padding: '24px',
                  textAlign: 'center',
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.1) 100%)',
                  borderRadius: '10px',
                  border: '1px solid rgba(16, 185, 129, 0.3)'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
                  <p style={{ margin: 0, color: '#10b981', fontSize: '16px', fontWeight: '600' }}>
                    Password Reset Successfully!
                  </p>
                  <p style={{ margin: '8px 0 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
                    The user has been logged out of all sessions and must use the new password to log in.
                  </p>
                </div>
              ) : (
                <div style={{
                  padding: '24px',
                  textAlign: 'center',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '10px'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px', opacity: 0.5 }}>🔐</div>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>
                    Click "Reset Password" to change this user's password
                  </p>
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* User Access Management - only shown for entity views */}
          {activeTab === 'access' && entityId && (() => {
            // Inline access management component
            const AccessManager = () => {
              const [accessUsers, setAccessUsers] = React.useState([]);
              const [allUsers, setAllUsers] = React.useState([]);
              const [loadingAccess, setLoadingAccess] = React.useState(true);
              const [addingUserId, setAddingUserId] = React.useState('');
              const [addingLevel, setAddingLevel] = React.useState('full');

              React.useEffect(() => {
                // Fetch access records and all users for this entity
                const loadAccess = async () => {
                  try {
                    const accessRecords = UserEntityAccessCollection.find({ entityId, isActive: true }).fetch();
                    setAccessUsers(accessRecords);

                    // Get all staff users for the add dropdown
                    const users = UsersCollection.find({
                      isActive: { $ne: false }
                    }).fetch();
                    setAllUsers(users);
                  } catch (e) {
                    console.error('Error loading access:', e);
                  }
                  setLoadingAccess(false);
                };
                loadAccess();
              }, []);

              const handleGrant = () => {
                if (!addingUserId) return;
                Meteor.call('userEntityAccess.grant', addingUserId, entityId, addingLevel, sessionId, (err) => {
                  if (err) {
                    alert('Error granting access: ' + (err.reason || err.message));
                  } else {
                    setAccessUsers(UserEntityAccessCollection.find({ entityId, isActive: true }).fetch());
                    setAddingUserId('');
                  }
                });
              };

              const handleRevoke = async (targetUserId) => {
                const confirmed = await showConfirm('Revoke this user\'s access?');
                if (!confirmed) return;
                Meteor.call('userEntityAccess.revoke', targetUserId, entityId, sessionId, (err) => {
                  if (err) {
                    alert('Error revoking access: ' + (err.reason || err.message));
                  } else {
                    setAccessUsers(UserEntityAccessCollection.find({ entityId, isActive: true }).fetch());
                  }
                });
              };

              const entity = ClientEntitiesCollection.findOne(entityId);
              const entityName = entity ? ClientEntityHelpers.getEntityDisplayName(entity) : 'Entity';

              // Users who already have access
              const accessUserIds = accessUsers.map(a => a.userId);
              // Available users to add (not already having access)
              const availableUsers = allUsers.filter(u => !accessUserIds.includes(u._id));

              return (
                <LiquidGlassCard style={{ padding: '24px' }}>
                  <h2 style={{
                    margin: '0 0 16px 0',
                    fontSize: '20px',
                    fontWeight: '600',
                    color: isDarkMode ? '#fff' : '#000',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <span style={{ fontSize: '24px' }}>{'\ud83d\udd11'}</span>
                    User Access — {entityName}
                  </h2>
                  <p style={{ margin: '0 0 20px 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Manage which user accounts can view this client entity's data (holdings, orders, documents).
                  </p>

                  {/* Current access list */}
                  {loadingAccess ? (
                    <p style={{ color: 'var(--text-secondary)' }}>Loading access records...</p>
                  ) : accessUsers.length === 0 ? (
                    <div style={{
                      padding: '20px',
                      textAlign: 'center',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '8px',
                      marginBottom: '16px'
                    }}>
                      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>No user accounts have access to this entity yet.</p>
                    </div>
                  ) : (
                    <div style={{ marginBottom: '20px' }}>
                      {accessUsers.map(access => {
                        const accessUser = allUsers.find(u => u._id === access.userId);
                        const name = accessUser
                          ? `${accessUser.profile?.firstName || accessUser.firstName || ''} ${accessUser.profile?.lastName || accessUser.lastName || ''}`.trim() || accessUser.email
                          : access.userId;

                        return (
                          <div key={access._id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 16px',
                            background: 'var(--bg-secondary)',
                            borderRadius: '8px',
                            marginBottom: '8px',
                            border: '1px solid var(--border-color)'
                          }}>
                            <div>
                              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.95rem' }}>{name}</div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                {accessUser?.email} — {access.accessLevel} access
                              </div>
                            </div>
                            <button
                              onClick={() => handleRevoke(access.userId)}
                              style={{
                                padding: '6px 12px',
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: '#ef4444',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                fontWeight: '500'
                              }}
                            >
                              Revoke
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add access form */}
                  {(currentUser?.role === USER_ROLES.SUPERADMIN || currentUser?.role === USER_ROLES.ADMIN) && (
                    <div style={{
                      padding: '16px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)'
                    }}>
                      <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                        Grant Access
                      </h4>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          value={addingUserId}
                          onChange={(e) => setAddingUserId(e.target.value)}
                          style={{
                            flex: 1,
                            minWidth: '200px',
                            padding: '8px 12px',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem'
                          }}
                        >
                          <option value="">Select user...</option>
                          {availableUsers.map(u => (
                            <option key={u._id} value={u._id}>
                              {`${u.profile?.firstName || u.firstName || ''} ${u.profile?.lastName || u.lastName || ''}`.trim() || u.email} ({u.role})
                            </option>
                          ))}
                        </select>
                        <select
                          value={addingLevel}
                          onChange={(e) => setAddingLevel(e.target.value)}
                          style={{
                            padding: '8px 12px',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem'
                          }}
                        >
                          <option value="full">Full Access</option>
                          <option value="readonly">Read Only</option>
                        </select>
                        <button
                          onClick={handleGrant}
                          disabled={!addingUserId}
                          style={{
                            padding: '8px 16px',
                            background: addingUserId ? 'var(--accent-color)' : 'var(--text-muted)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: addingUserId ? 'pointer' : 'not-allowed',
                            fontSize: '0.9rem',
                            fontWeight: '600'
                          }}
                        >
                          Grant
                        </button>
                      </div>
                    </div>
                  )}
                </LiquidGlassCard>
              );
            };

            return <AccessManager />;
          })()}
        </div>
      </div>

      {/* Risk Score Assessment Modal */}
      {riskScoreModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 10000, overflowY: 'auto', padding: '40px 0' }}
          onClick={() => { setRiskScoreModalOpen(false); setEditingRiskScore(false); }}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: '12px', padding: '24px', maxWidth: '900px', width: '95%', margin: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>KYC Risk Assessment</h3>
              <button onClick={() => { setRiskScoreModalOpen(false); setEditingRiskScore(false); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer', padding: '4px' }}>✕</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', width: '40%' }}>Criteria</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: '#3b82f6', fontWeight: '600' }}>Client</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: '#8b5cf6', fontWeight: '600' }}>Benef. Owner</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: '#f59e0b', fontWeight: '600' }}>Business Rel.</th>
                  </tr>
                </thead>
                <tbody>
                  {RISK_CRITERIA.map((criterion, idx) => (
                    <tr key={criterion.id} style={{ borderBottom: '1px solid var(--border-color)', background: idx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                      <td style={{ padding: '6px 10px', color: 'var(--text-primary)', fontSize: '0.76rem' }}>
                        <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>{idx + 1}.</span>
                        {criterion.labelEn}
                      </td>
                      {['clientProspect', 'beneficialOwner', 'businessRelationship'].map(column => (
                        <td key={column} style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <select
                            value={riskScoreForm[column]?.[criterion.id] ?? ''}
                            onChange={(e) => handleRiskScoreChange(column, criterion.id, e.target.value ? parseInt(e.target.value) : '')}
                            style={{
                              width: '100%', padding: '4px', border: '1px solid var(--border-color)', borderRadius: '4px',
                              background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.72rem', cursor: 'pointer'
                            }}>
                            <option value="">-</option>
                            {criterion.options.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.labelEn} ({opt.value} pts)</option>
                            ))}
                          </select>
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: '700' }}>
                    <td style={{ padding: '10px', color: 'var(--text-primary)' }}>TOTAL SCORE</td>
                    {['clientProspect', 'beneficialOwner', 'businessRelationship'].map(column => {
                      const result = calculateRiskScore(riskScoreForm[column] || {});
                      const colDisplay = getRiskLevelDisplay(result.riskLevel);
                      return (
                        <td key={column} style={{ padding: '10px', textAlign: 'center' }}>
                          <div style={{ fontSize: '1rem', fontWeight: '700', color: colDisplay.color }}>{result.totalScore}</div>
                          <span style={{ padding: '2px 8px', borderRadius: '8px', fontSize: '0.68rem', fontWeight: '600', background: `${colDisplay.color}15`, color: colDisplay.color }}>
                            {colDisplay.emoji} {colDisplay.labelEn}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px', fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '16px' }}>
              <span>{'< 15 pts = Low Risk'}</span>
              <span>{'15-29 pts = Medium Risk'}</span>
              <span>{'\u2265 30 pts = High Risk'}</span>
            </div>

            <div style={{ marginTop: '12px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '4px' }}>Comments</label>
              <textarea
                value={riskScoreForm.comments || ''}
                onChange={(e) => setRiskScoreForm(prev => ({ ...prev, comments: e.target.value }))}
                rows={2}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.82rem', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                placeholder="Additional notes..."
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => { setRiskScoreModalOpen(false); setEditingRiskScore(false); }}
                style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>
                Cancel
              </button>
              <button
                onClick={async () => { await handleSaveRiskScore(); setRiskScoreModalOpen(false); setEditingRiskScore(false); }}
                disabled={savingRiskScore}
                style={{ padding: '8px 16px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: savingRiskScore ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '600', opacity: savingRiskScore ? 0.7 : 1 }}>
                {savingRiskScore ? 'Saving...' : 'Save Assessment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive Client Modal — closure date + PDF closure letter */}
      {showArchiveModal && (
        <div
          onClick={() => { if (!archiveBusy) setShowArchiveModal(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)', maxWidth: '480px', width: '100%', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
          >
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-primary)' }}>
              Archive Client
            </h3>
            <p style={{ margin: '0 0 18px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Provide the closure date and attach the signed closure letter (PDF).
            </p>

            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Closure Date
            </label>
            <input
              type="date"
              value={archiveClosureDate}
              onChange={e => setArchiveClosureDate(e.target.value)}
              disabled={archiveBusy}
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--border-color)', borderRadius: '8px', fontSize: '0.9rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', boxSizing: 'border-box', marginBottom: '16px' }}
            />

            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Closure Letter (PDF)
            </label>
            <input
              type="file"
              accept="application/pdf"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f && f.type !== 'application/pdf') {
                  setArchiveError('File must be a PDF.');
                  setArchiveClosureFile(null);
                  return;
                }
                if (f && f.size > 10 * 1024 * 1024) {
                  setArchiveError('File must be smaller than 10MB.');
                  setArchiveClosureFile(null);
                  return;
                }
                setArchiveError('');
                setArchiveClosureFile(f || null);
              }}
              disabled={archiveBusy}
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', boxSizing: 'border-box', marginBottom: '4px' }}
            />
            {archiveClosureFile && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                {archiveClosureFile.name} — {(archiveClosureFile.size / 1024).toFixed(0)} KB
              </div>
            )}

            {archiveError && (
              <div style={{ marginTop: '8px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: '0.8rem' }}>
                {archiveError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                onClick={() => setShowArchiveModal(false)}
                disabled={archiveBusy}
                style={{ padding: '9px 18px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: archiveBusy ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '500' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!archiveClosureDate) {
                    setArchiveError('Closure date is required.');
                    return;
                  }
                  if (!archiveClosureFile) {
                    setArchiveError('Closure letter PDF is required.');
                    return;
                  }
                  setArchiveBusy(true);
                  setArchiveError('');
                  try {
                    const base64Data = await new Promise((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result.split(',')[1]);
                      reader.onerror = reject;
                      reader.readAsDataURL(archiveClosureFile);
                    });
                    await Meteor.callAsync('clientEntities.updateStatus', entityId, ENTITY_STATUSES.ARCHIVED, sessionId, {
                      closureDate: archiveClosureDate,
                      fileName: archiveClosureFile.name,
                      base64Data,
                      mimeType: archiveClosureFile.type
                    });
                    setShowArchiveModal(false);
                  } catch (err) {
                    console.error('Failed to archive entity:', err);
                    setArchiveError(err.reason || 'Failed to archive client.');
                  } finally {
                    setArchiveBusy(false);
                  }
                }}
                disabled={archiveBusy}
                style={{ padding: '9px 18px', background: '#f59e0b', border: 'none', borderRadius: '8px', color: 'white', cursor: archiveBusy ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '600', opacity: archiveBusy ? 0.7 : 1 }}
              >
                {archiveBusy ? 'Archiving…' : 'Archive Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Dialog
        isOpen={dialogState.isOpen}
        onClose={hideDialog}
        title={dialogState.title}
        message={dialogState.message}
        type={dialogState.type}
        onConfirm={dialogState.onConfirm}
        onCancel={dialogState.onCancel}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        showCancel={dialogState.showCancel}
      />
    </div>
  );
}
