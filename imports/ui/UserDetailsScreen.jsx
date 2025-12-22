import React, { useState, useEffect } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { UsersCollection, USER_ROLES } from '../api/users.js';
import { BankAccountsCollection } from '../api/bankAccounts.js';
import { BanksCollection } from '../api/banks.js';
import { AccountProfilesCollection, PROFILE_TEMPLATES, aggregateToFourCategories } from '../api/accountProfiles.js';
import { PortfolioSnapshotsCollection } from '../api/portfolioSnapshots.js';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import { useTheme } from './ThemeContext.jsx';

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

export default function UserDetailsScreen({ userId, onBack, embedded = false }) {
  const { isDark: isDarkMode } = useTheme();
  const sessionId = localStorage.getItem('sessionId');

  // State for editing sections
  const [editingBasicInfo, setEditingBasicInfo] = useState(false);
  const [editingRM, setEditingRM] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    birthday: '',
    preferredLanguage: 'en',
    referenceCurrency: 'EUR',
    relationshipManagerId: '',
    newPassword: ''
  });

  // Bank account creation state
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({
    bankId: '',
    accountNumber: '',
    referenceCurrency: 'USD',
    accountType: 'personal',
    accountStructure: 'direct',
    lifeInsuranceCompany: ''
  });

  // Bank account edit state
  const [editingBankAccount, setEditingBankAccount] = useState(null);
  const [editBankAccountData, setEditBankAccountData] = useState({});

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
    maxCash: 0,
    maxBonds: 0,
    maxEquities: 0,
    maxAlternative: 0
  });

  // Subscribe to data
  const { user, bankAccounts, relationshipManagers, banks, currentUser, accountProfiles, portfolioSnapshots, isLoading } = useTracker(() => {
    const userHandle = Meteor.subscribe('customUsers');
    const banksHandle = Meteor.subscribe('banks');
    const bankAccountsHandle = Meteor.subscribe('allBankAccounts');
    const accountProfilesHandle = Meteor.subscribe('accountProfiles', sessionId, userId);
    const portfolioSnapshotsHandle = Meteor.subscribe('portfolioSnapshots', sessionId, {}, { type: 'client', id: userId });

    const userData = UsersCollection.findOne(userId);
    const rms = UsersCollection.find({ role: USER_ROLES.RELATIONSHIP_MANAGER }).fetch();
    const banksData = BanksCollection.find().fetch();
    const accountsData = BankAccountsCollection.find({
      userId: userId,
      isActive: true
    }).fetch();

    // Get account profiles for this user's accounts
    const accountIds = accountsData.map(a => a._id);
    const profilesData = AccountProfilesCollection.find({
      bankAccountId: { $in: accountIds }
    }).fetch();

    // Get portfolio snapshots for this user (already sorted by date desc from publication)
    const snapshotsData = PortfolioSnapshotsCollection.find({
      userId: userId
    }).fetch();

    // Get current user session
    const session = Meteor.connection && Meteor.connection._lastSessionId;
    const currentUserData = session ? UsersCollection.findOne({ 'sessions.sessionId': sessionId }) : null;

    return {
      user: userData,
      bankAccounts: accountsData,
      relationshipManagers: rms,
      banks: banksData,
      currentUser: currentUserData,
      accountProfiles: profilesData,
      portfolioSnapshots: snapshotsData,
      isLoading: !userHandle.ready() || !banksHandle.ready() || !bankAccountsHandle.ready()
    };
  }, [userId, sessionId]);

  // Update form data when user data loads
  useEffect(() => {
    if (user) {
      setFormData({
        email: user.email || user.username || '',
        firstName: user.profile?.firstName || '',
        lastName: user.profile?.lastName || '',
        birthday: user.profile?.birthday ? new Date(user.profile.birthday).toISOString().split('T')[0] : '',
        preferredLanguage: user.profile?.preferredLanguage || 'en',
        referenceCurrency: user.profile?.referenceCurrency || 'EUR',
        relationshipManagerId: user.relationshipManagerId || '',
        newPassword: ''
      });
    }
  }, [user]);

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
          updatedAt: new Date()
        }
      }, sessionId);

      setEditingBasicInfo(false);

      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'success',
        message: 'User information updated successfully',
        sessionId
      });
    } catch (error) {
      console.error('Error updating user:', error);
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: `Failed to update user: ${error.message}`,
        sessionId
      });
    }
  };

  const handleSaveRM = async () => {
    try {
      await Meteor.callAsync('users.updateProfile', userId, {
        relationshipManagerId: formData.relationshipManagerId || null
      }, sessionId);

      setEditingRM(false);

      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'success',
        message: 'Relationship manager updated successfully',
        sessionId
      });
    } catch (error) {
      console.error('Error updating RM:', error);
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: `Failed to update RM: ${error.message}`,
        sessionId
      });
    }
  };

  const handleResetPassword = async () => {
    if (!formData.newPassword || formData.newPassword.length < 6) {
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: 'Password must be at least 6 characters',
        sessionId
      });
      return;
    }

    try {
      await Meteor.callAsync('users.adminResetPassword', userId, formData.newPassword, sessionId);

      setFormData({ ...formData, newPassword: '' });
      setEditingPassword(false);

      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'success',
        message: 'Password reset successfully',
        sessionId
      });
    } catch (error) {
      console.error('Error resetting password:', error);
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: `Failed to reset password: ${error.message}`,
        sessionId
      });
    }
  };

  const handleAddBankAccount = async () => {
    if (!newAccount.bankId || !newAccount.accountNumber) {
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: 'Bank and account number are required',
        sessionId
      });
      return;
    }

    try {
      await Meteor.callAsync('bankAccounts.create', {
        userId,
        ...newAccount,
        sessionId
      });

      setNewAccount({
        bankId: '',
        accountNumber: '',
        referenceCurrency: 'USD',
        accountType: 'personal',
        accountStructure: 'direct',
        lifeInsuranceCompany: ''
      });
      setShowAddAccount(false);

      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'success',
        message: 'Bank account added successfully',
        sessionId
      });
    } catch (error) {
      console.error('Error adding bank account:', error);
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: `Failed to add bank account: ${error.message}`,
        sessionId
      });
    }
  };

  const handleDeleteBankAccount = async (accountId) => {
    if (!confirm('Are you sure you want to delete this bank account?')) {
      return;
    }

    try {
      await Meteor.callAsync('bankAccounts.remove', { accountId, sessionId });

      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'success',
        message: 'Bank account deleted successfully',
        sessionId
      });
    } catch (error) {
      console.error('Error deleting bank account:', error);
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: `Failed to delete bank account: ${error.message}`,
        sessionId
      });
    }
  };

  const handleEditBankAccount = (account) => {
    setEditingBankAccount(account._id);
    setEditBankAccountData({
      referenceCurrency: account.referenceCurrency || 'EUR',
      accountType: account.accountType || 'personal',
      authorizedOverdraft: account.authorizedOverdraft || ''
    });
  };

  const handleSaveEditBankAccount = async (accountId) => {
    try {
      const overdraftValue = editBankAccountData.authorizedOverdraft
        ? parseFloat(editBankAccountData.authorizedOverdraft)
        : null;

      await Meteor.callAsync('bankAccounts.update', {
        accountId,
        updates: {
          referenceCurrency: editBankAccountData.referenceCurrency,
          accountType: editBankAccountData.accountType,
          authorizedOverdraft: overdraftValue
        },
        sessionId
      });

      if (currentUser?._id) {
        Meteor.call('notifications.create', {
          userId: currentUser?._id,
          type: 'success',
          message: 'Bank account updated successfully',
          sessionId
        });
      }

      setEditingBankAccount(null);
      setEditBankAccountData({});
    } catch (error) {
      console.error('Error updating bank account:', error);
      if (currentUser?._id) {
        Meteor.call('notifications.create', {
          userId: currentUser?._id,
          type: 'error',
          message: `Failed to update bank account: ${error.message}`,
          sessionId
        });
      }
    }
  };

  const handleCancelEditBankAccount = () => {
    setEditingBankAccount(null);
    setEditBankAccountData({});
  };

  const handleAddFamilyMember = async () => {
    if (!newFamilyMember.name) {
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: 'Family member name is required',
        sessionId
      });
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

      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'success',
        message: 'Family member added successfully',
        sessionId
      });
    } catch (error) {
      console.error('Error adding family member:', error);
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: `Failed to add family member: ${error.message}`,
        sessionId
      });
    }
  };

  const handleDeleteFamilyMember = async (familyMemberId) => {
    if (!confirm('Are you sure you want to delete this family member?')) {
      return;
    }

    try {
      const familyMembers = (user.profile?.familyMembers || []).filter(fm => fm._id !== familyMemberId);

      await Meteor.callAsync('users.updateProfile', userId, {
        profile: {
          ...user.profile,
          familyMembers,
          updatedAt: new Date()
        }
      }, sessionId);

      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'success',
        message: 'Family member deleted successfully',
        sessionId
      });
    } catch (error) {
      console.error('Error deleting family member:', error);
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: `Failed to delete family member: ${error.message}`,
        sessionId
      });
    }
  };

  // Per-account profile handlers
  const handleStartEditAccountProfile = (accountId) => {
    const existingProfile = accountProfiles?.find(p => p.bankAccountId === accountId);
    setAccountProfileDraft({
      maxCash: existingProfile?.maxCash || 0,
      maxBonds: existingProfile?.maxBonds || 0,
      maxEquities: existingProfile?.maxEquities || 0,
      maxAlternative: existingProfile?.maxAlternative || 0
    });
    setEditingAccountProfile(accountId);
  };

  const handleSaveAccountProfile = async (accountId) => {
    try {
      await Meteor.callAsync('accountProfiles.upsert', accountId, accountProfileDraft, sessionId);

      setEditingAccountProfile(null);

      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'success',
        message: 'Account profile updated successfully',
        sessionId
      });
    } catch (error) {
      console.error('Error updating account profile:', error);
      Meteor.call('notifications.create', {
        userId: currentUser?._id,
        type: 'error',
        message: `Failed to update account profile: ${error.message}`,
        sessionId
      });
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
      setAccountProfileDraft({
        maxCash: template.maxCash,
        maxBonds: template.maxBonds,
        maxEquities: template.maxEquities,
        maxAlternative: template.maxAlternative
      });
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

  if (isLoading || !user) {
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
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Loading user details...</p>
      </div>
    );
  }

  const fullName = `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.email || user.username;
  const initials = getInitials(user.profile?.firstName, user.profile?.lastName, user.email);
  const assignedRM = relationshipManagers.find(rm => rm._id === user.relationshipManagerId);

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

              {/* Role Badge */}
              <span style={{
                padding: '6px 14px',
                borderRadius: '20px',
                background: getRoleBadgeColor(user.role),
                color: '#fff',
                fontSize: '12px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
              }}>
                {user.role}
              </span>

              {/* Active Status */}
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
            </div>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                <span>✉️</span>
                <span>{user.email || user.username}</span>
              </div>
              {user.profile?.createdAt && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <span>📅</span>
                  <span>Joined {new Date(user.profile.createdAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            {/* Relationship Manager Row (for clients only) */}
            {user.role === USER_ROLES.CLIENT && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <span>👔</span>
                  {editingRM ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <select
                        value={formData.relationshipManagerId}
                        onChange={(e) => setFormData({ ...formData, relationshipManagerId: e.target.value })}
                        style={{
                          padding: '6px 10px',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          outline: 'none',
                          minWidth: '150px'
                        }}
                      >
                        <option value="">No RM assigned</option>
                        {relationshipManagers.map(rm => (
                          <option key={rm._id} value={rm._id}>
                            {rm.profile?.firstName} {rm.profile?.lastName}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleSaveRM}
                        style={{
                          padding: '5px 12px',
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          border: 'none',
                          borderRadius: '5px',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: '500'
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingRM(false);
                          setFormData({ ...formData, relationshipManagerId: user.relationshipManagerId || '' });
                        }}
                        style={{
                          padding: '5px 12px',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '5px',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: '500'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span style={{ color: assignedRM ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {assignedRM
                          ? `${assignedRM.profile?.firstName || ''} ${assignedRM.profile?.lastName || ''}`.trim()
                          : 'No RM assigned'}
                      </span>
                      <button
                        onClick={() => setEditingRM(true)}
                        style={{
                          padding: '3px 8px',
                          background: 'transparent',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--bg-tertiary)';
                          e.currentTarget.style.color = 'var(--text-primary)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--text-secondary)';
                        }}
                      >
                        ✏️
                      </button>
                    </>
                  )}
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
              borderRadius: '12px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: isMobile ? '1.5rem' : '1.75rem', fontWeight: '700', color: '#4da6ff', marginBottom: '4px' }}>
                {bankAccounts.length}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>
                Bank Accounts
              </div>
            </div>

            {user.profile?.familyMembers && (
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

      {/* Main Content Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: isMobile ? '1rem' : '1.5rem'
      }}>
        {/* Left Column - Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '1rem' : '1.5rem' }}>

          {/* Basic Information */}
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
                    Birthday
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
                        newPassword: ''
                      });
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

                <div style={{
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)'
                }}>
                  <p style={{ margin: '0 0 6px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Birthday
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
              </div>
            )}
          </LiquidGlassCard>

          {/* Bank Accounts (CLIENT only) */}
          {user.role === USER_ROLES.CLIENT && (
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
                  <span style={{ fontSize: '24px' }}>🏦</span>
                  Bank Accounts
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '12px',
                    background: isDarkMode ? 'rgba(79, 166, 255, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                    color: '#4da6ff',
                    fontSize: '14px',
                    fontWeight: '600'
                  }}>
                    {bankAccounts.length}
                  </span>
                </h2>
                <button
                  onClick={() => setShowAddAccount(true)}
                  style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 4px 8px rgba(16, 185, 129, 0.3)'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  + Add Account
                </button>
              </div>

              {showAddAccount && (
                <div style={{
                  marginBottom: '24px',
                  padding: '20px',
                  background: isDarkMode ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.03)',
                  borderRadius: '12px',
                  border: `2px solid ${isDarkMode ? 'rgba(16, 185, 129, 0.2)' : 'rgba(16, 185, 129, 0.15)'}`,
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
                    New Bank Account
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
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
                        Bank *
                      </label>
                      <select
                        value={newAccount.bankId}
                        onChange={(e) => setNewAccount({ ...newAccount, bankId: e.target.value })}
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
                        <option value="">Select bank...</option>
                        {banks.map(bank => (
                          <option key={bank._id} value={bank._id}>{bank.name}</option>
                        ))}
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
                        Account Number *
                      </label>
                      <input
                        type="text"
                        value={newAccount.accountNumber}
                        onChange={(e) => setNewAccount({ ...newAccount, accountNumber: e.target.value })}
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
                        Currency
                      </label>
                      <select
                        value={newAccount.referenceCurrency}
                        onChange={(e) => setNewAccount({ ...newAccount, referenceCurrency: e.target.value })}
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
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="GBP">GBP</option>
                        <option value="CHF">CHF</option>
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
                        Account Type
                      </label>
                      <select
                        value={newAccount.accountType}
                        onChange={(e) => setNewAccount({ ...newAccount, accountType: e.target.value })}
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
                        <option value="personal">Personal</option>
                        <option value="company">Company</option>
                        <option value="life_insurance">Life Insurance</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                    <button
                      onClick={() => {
                        setShowAddAccount(false);
                        setNewAccount({
                          bankId: '',
                          accountNumber: '',
                          referenceCurrency: 'USD',
                          accountType: 'personal',
                          accountStructure: 'direct',
                          lifeInsuranceCompany: ''
                        });
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
                      onClick={handleAddBankAccount}
                      style={{
                        padding: '10px 20px',
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500',
                        boxShadow: '0 4px 8px rgba(16, 185, 129, 0.3)'
                      }}
                    >
                      ✓ Add Account
                    </button>
                  </div>
                </div>
              )}

              {bankAccounts.length === 0 && !showAddAccount ? (
                <div style={{
                  padding: '48px 24px',
                  textAlign: 'center',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '12px',
                  border: '2px dashed var(--border-color)'
                }}>
                  <div style={{ fontSize: '64px', marginBottom: '16px', opacity: 0.5 }}>🏦</div>
                  <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '16px', fontWeight: '500' }}>
                    No bank accounts yet
                  </p>
                  <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Add a bank account to get started
                  </p>
                  <button
                    onClick={() => setShowAddAccount(true)}
                    style={{
                      padding: '10px 24px',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                  >
                    + Add Your First Account
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {bankAccounts.map(account => {
                    const bank = banks.find(b => b._id === account.bankId);
                    const isEditing = editingBankAccount === account._id;

                    return (
                      <div
                        key={account._id}
                        style={{
                          padding: '16px',
                          background: isDarkMode
                            ? 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)'
                            : 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.01) 100%)',
                          borderRadius: '12px',
                          border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                          transition: 'all 0.3s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (!isEditing) {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = `0 8px 16px ${isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)'}`;
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
                            <div style={{
                              width: '48px',
                              height: '48px',
                              borderRadius: '12px',
                              background: getBankLogoPath(bank?.name) ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '24px',
                              overflow: 'hidden',
                              border: getBankLogoPath(bank?.name) ? '1px solid var(--border-color)' : 'none'
                            }}>
                              {getBankLogoPath(bank?.name) ? (
                                <img
                                  src={getBankLogoPath(bank?.name)}
                                  alt={bank?.name || 'Bank'}
                                  style={{
                                    width: '40px',
                                    height: '40px',
                                    objectFit: 'contain'
                                  }}
                                  onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'inline';
                                  }}
                                />
                              ) : null}
                              <span style={{ display: getBankLogoPath(bank?.name) ? 'none' : 'inline' }}>🏦</span>
                            </div>
                            <div>
                              <p style={{
                                margin: '0 0 4px',
                                color: 'var(--text-primary)',
                                fontSize: '17px',
                                fontWeight: '600'
                              }}>
                                {bank?.name || 'Unknown Bank'}
                              </p>
                              {isEditing ? (
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                                  <span style={{
                                    color: 'var(--text-secondary)',
                                    fontSize: '13px'
                                  }}>
                                    <strong>Account:</strong> {account.accountNumber}
                                  </span>
                                  <select
                                    value={editBankAccountData.referenceCurrency || 'EUR'}
                                    onChange={(e) => setEditBankAccountData(prev => ({ ...prev, referenceCurrency: e.target.value }))}
                                    style={{
                                      padding: '4px 8px',
                                      borderRadius: '6px',
                                      border: '1px solid var(--border-color)',
                                      background: 'var(--bg-secondary)',
                                      color: 'var(--text-primary)',
                                      fontSize: '12px',
                                      fontWeight: '600'
                                    }}
                                  >
                                    {['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'ILS'].map(curr => (
                                      <option key={curr} value={curr}>{curr}</option>
                                    ))}
                                  </select>
                                  <select
                                    value={editBankAccountData.accountType || 'personal'}
                                    onChange={(e) => setEditBankAccountData(prev => ({ ...prev, accountType: e.target.value }))}
                                    style={{
                                      padding: '4px 8px',
                                      borderRadius: '6px',
                                      border: '1px solid var(--border-color)',
                                      background: 'var(--bg-secondary)',
                                      color: 'var(--text-primary)',
                                      fontSize: '12px',
                                      fontWeight: '600',
                                      textTransform: 'capitalize'
                                    }}
                                  >
                                    <option value="personal">Personal</option>
                                    <option value="company">Company</option>
                                    <option value="life_insurance">Life Insurance</option>
                                  </select>
                                  <input
                                    type="number"
                                    placeholder="Credit Line"
                                    value={editBankAccountData.authorizedOverdraft || ''}
                                    onChange={(e) => setEditBankAccountData(prev => ({
                                      ...prev,
                                      authorizedOverdraft: e.target.value
                                    }))}
                                    style={{
                                      padding: '4px 8px',
                                      borderRadius: '6px',
                                      border: '1px solid var(--border-color)',
                                      background: 'var(--bg-secondary)',
                                      color: 'var(--text-primary)',
                                      fontSize: '12px',
                                      fontWeight: '600',
                                      width: '100px'
                                    }}
                                  />
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                  <span style={{
                                    color: 'var(--text-secondary)',
                                    fontSize: '13px'
                                  }}>
                                    <strong>Account:</strong> {account.accountNumber}
                                  </span>
                                  <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    background: isDarkMode ? 'rgba(79, 166, 255, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                    color: '#4da6ff',
                                    fontSize: '12px',
                                    fontWeight: '600'
                                  }}>
                                    {account.referenceCurrency}
                                  </span>
                                  <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    background: isDarkMode ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                                    color: '#8b5cf6',
                                    fontSize: '12px',
                                    fontWeight: '600'
                                  }}>
                                    {account.accountType === 'life_insurance' ? 'Life Insurance' : account.accountType?.charAt(0).toUpperCase() + account.accountType?.slice(1)}
                                  </span>
                                  {account.authorizedOverdraft > 0 && (
                                    <span style={{
                                      padding: '2px 8px',
                                      borderRadius: '6px',
                                      background: isDarkMode ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                      color: '#10b981',
                                      fontSize: '12px',
                                      fontWeight: '600'
                                    }}>
                                      Credit: {account.referenceCurrency} {account.authorizedOverdraft.toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSaveEditBankAccount(account._id)}
                                style={{
                                  padding: '10px 18px',
                                  background: 'rgba(16, 185, 129, 0.1)',
                                  border: '1px solid rgba(16, 185, 129, 0.3)',
                                  borderRadius: '8px',
                                  color: '#10b981',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  transition: 'all 0.3s ease',
                                  whiteSpace: 'nowrap'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)';
                                  e.currentTarget.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)';
                                  e.currentTarget.style.transform = 'scale(1)';
                                }}
                              >
                                Save
                              </button>
                              <button
                                onClick={handleCancelEditBankAccount}
                                style={{
                                  padding: '10px 18px',
                                  background: 'rgba(107, 114, 128, 0.1)',
                                  border: '1px solid rgba(107, 114, 128, 0.3)',
                                  borderRadius: '8px',
                                  color: '#6b7280',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  transition: 'all 0.3s ease',
                                  whiteSpace: 'nowrap'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(107, 114, 128, 0.2)';
                                  e.currentTarget.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(107, 114, 128, 0.1)';
                                  e.currentTarget.style.transform = 'scale(1)';
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEditBankAccount(account)}
                                style={{
                                  padding: '10px 18px',
                                  background: 'rgba(59, 130, 246, 0.1)',
                                  border: '1px solid rgba(59, 130, 246, 0.3)',
                                  borderRadius: '8px',
                                  color: '#3b82f6',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  transition: 'all 0.3s ease',
                                  whiteSpace: 'nowrap'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)';
                                  e.currentTarget.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)';
                                  e.currentTarget.style.transform = 'scale(1)';
                                }}
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => handleDeleteBankAccount(account._id)}
                                style={{
                                  padding: '10px 18px',
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  borderRadius: '8px',
                                  color: '#ef4444',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  transition: 'all 0.3s ease',
                                  whiteSpace: 'nowrap'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                                  e.currentTarget.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                                  e.currentTarget.style.transform = 'scale(1)';
                                }}
                              >
                                🗑️ Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Per-Account Investment Profiles & Allocations (CLIENT only) */}
          {user.role === USER_ROLES.CLIENT && bankAccounts.length > 0 && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <h2 style={{
                margin: '0 0 24px',
                fontSize: '20px',
                fontWeight: '600',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <span style={{ fontSize: '24px' }}>📊</span>
                Account Investment Profiles
              </h2>

              {/* Loop through each bank account */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {bankAccounts.map(account => {
                  const bank = banks.find(b => b._id === account.bankId);
                  const profile = getProfileForAccount(account._id);
                  const allocation = getAllocationForAccount(account);
                  const isEditing = editingAccountProfile === account._id;

                  const categories = [
                    { key: 'cash', label: 'Cash', labelFr: 'Monétaire', color: '#3b82f6', icon: '💵', maxKey: 'maxCash' },
                    { key: 'bonds', label: 'Bonds', labelFr: 'Obligations', color: '#10b981', icon: '📄', maxKey: 'maxBonds' },
                    { key: 'equities', label: 'Equities', labelFr: 'Actions', color: '#f59e0b', icon: '📈', maxKey: 'maxEquities' },
                    { key: 'alternative', label: 'Alternative', labelFr: 'Alternatif', color: '#8b5cf6', icon: '🎯', maxKey: 'maxAlternative' }
                  ];

                  return (
                    <div key={account._id} style={{
                      padding: '20px',
                      background: isDarkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                      borderRadius: '12px',
                      border: '1px solid var(--border-color)'
                    }}>
                      {/* Account Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '8px',
                            background: getBankLogoPath(bank?.name) ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            border: getBankLogoPath(bank?.name) ? '1px solid var(--border-color)' : 'none',
                            flexShrink: 0
                          }}>
                            {getBankLogoPath(bank?.name) ? (
                              <img
                                src={getBankLogoPath(bank?.name)}
                                alt={bank?.name || 'Bank'}
                                style={{
                                  width: '28px',
                                  height: '28px',
                                  objectFit: 'contain'
                                }}
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  e.target.nextSibling.style.display = 'inline';
                                }}
                              />
                            ) : null}
                            <span style={{ display: getBankLogoPath(bank?.name) ? 'none' : 'inline', fontSize: '18px' }}>🏦</span>
                          </div>
                          <div>
                            <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '16px', fontWeight: '600' }}>
                              {bank?.name || 'Unknown Bank'} - {account.accountNumber}
                            </h3>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                              {account.referenceCurrency} • {account.accountType === 'life_insurance' ? 'Life Insurance' : account.accountType?.charAt(0).toUpperCase() + account.accountType?.slice(1)}
                            </span>
                          </div>
                        </div>
                        {!isEditing && (
                          <button
                            onClick={() => handleStartEditAccountProfile(account._id)}
                            style={{
                              padding: '6px 12px',
                              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                              border: 'none',
                              borderRadius: '6px',
                              color: '#fff',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: '500'
                            }}
                          >
                            {profile ? 'Edit Profile' : 'Set Profile'}
                          </button>
                        )}
                      </div>

                      {/* Side-by-side: Profile Editor + Allocation Chart */}
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '20px' }}>
                        {/* Left: Profile Editor / Display */}
                        <div style={{
                          padding: '16px',
                          background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                          borderRadius: '10px'
                        }}>
                          <h4 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: '14px', fontWeight: '600' }}>
                            Maximum Allocation Limits
                          </h4>

                          {isEditing ? (
                            <>
                              {/* Template Dropdown */}
                              <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '6px' }}>
                                  Apply Template
                                </label>
                                <select
                                  onChange={(e) => e.target.value && applyTemplate(e.target.value)}
                                  style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '6px',
                                    color: 'var(--text-primary)',
                                    fontSize: '13px'
                                  }}
                                >
                                  <option value="">Select a template...</option>
                                  {Object.entries(PROFILE_TEMPLATES).map(([key, template]) => (
                                    <option key={key} value={key}>{template.name}</option>
                                  ))}
                                </select>
                              </div>

                              {/* Allocation Inputs */}
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                                {categories.map(cat => (
                                  <div key={cat.key} style={{
                                    padding: '10px',
                                    background: `${cat.color}10`,
                                    borderRadius: '8px',
                                    border: `1px solid ${cat.color}30`
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                      <span style={{ fontSize: '16px' }}>{cat.icon}</span>
                                      <span style={{ color: 'var(--text-primary)', fontSize: '12px', fontWeight: '600' }}>{cat.label}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={accountProfileDraft[cat.maxKey]}
                                        onChange={(e) => handleAccountAllocationChange(cat.maxKey, e.target.value)}
                                        style={{
                                          width: '60px',
                                          padding: '6px',
                                          background: 'var(--bg-secondary)',
                                          border: '1px solid var(--border-color)',
                                          borderRadius: '4px',
                                          color: 'var(--text-primary)',
                                          fontSize: '14px',
                                          fontWeight: '600',
                                          textAlign: 'center'
                                        }}
                                      />
                                      <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>%</span>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {/* Save/Cancel */}
                              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                <button
                                  onClick={() => setEditingAccountProfile(null)}
                                  style={{
                                    padding: '8px 16px',
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '6px',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    fontSize: '13px'
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleSaveAccountProfile(account._id)}
                                  style={{
                                    padding: '8px 16px',
                                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    border: 'none',
                                    borderRadius: '6px',
                                    color: '#fff',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    fontWeight: '500'
                                  }}
                                >
                                  Save
                                </button>
                              </div>
                            </>
                          ) : profile ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                              {categories.map(cat => (
                                <div key={cat.key} style={{
                                  padding: '10px',
                                  background: `${cat.color}10`,
                                  borderRadius: '8px',
                                  textAlign: 'center'
                                }}>
                                  <span style={{ fontSize: '20px' }}>{cat.icon}</span>
                                  <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '11px' }}>{cat.label}</p>
                                  <p style={{ margin: '2px 0 0', color: 'var(--text-primary)', fontSize: '18px', fontWeight: '700' }}>
                                    {profile[cat.maxKey]}%
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                              <div style={{ fontSize: '32px', marginBottom: '8px', opacity: 0.5 }}>📋</div>
                              <p style={{ margin: 0, fontSize: '13px' }}>No profile set for this account</p>
                            </div>
                          )}
                        </div>

                        {/* Right: Allocation Chart */}
                        <div style={{
                          padding: '16px',
                          background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                          borderRadius: '10px'
                        }}>
                          <h4 style={{ margin: '0 0 16px', color: 'var(--text-primary)', fontSize: '14px', fontWeight: '600' }}>
                            Current vs Maximum Allocation
                          </h4>

                          {allocation && profile ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              {categories.map(cat => {
                                const current = allocation[cat.key] || 0;
                                const max = profile[cat.maxKey] || 0;
                                const isOverLimit = current > max;

                                return (
                                  <div key={cat.key}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                      <span style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span>{cat.icon}</span> {cat.label}
                                      </span>
                                      <span style={{
                                        color: isOverLimit ? '#ef4444' : 'var(--text-primary)',
                                        fontSize: '12px',
                                        fontWeight: '600'
                                      }}>
                                        {current.toFixed(1)}% / {max}%
                                        {isOverLimit && <span style={{ marginLeft: '4px' }}>⚠️</span>}
                                      </span>
                                    </div>
                                    <div style={{
                                      position: 'relative',
                                      height: '20px',
                                      background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                                      borderRadius: '10px',
                                      overflow: 'hidden'
                                    }}>
                                      {/* Max limit indicator */}
                                      <div style={{
                                        position: 'absolute',
                                        left: `${max}%`,
                                        top: 0,
                                        bottom: 0,
                                        width: '2px',
                                        background: isDarkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)',
                                        zIndex: 2
                                      }} />
                                      {/* Current allocation bar */}
                                      <div style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        bottom: 0,
                                        width: `${Math.min(current, 100)}%`,
                                        background: isOverLimit
                                          ? 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
                                          : `linear-gradient(90deg, ${cat.color} 0%, ${cat.color}dd 100%)`,
                                        borderRadius: '10px',
                                        transition: 'width 0.3s ease'
                                      }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : allocation && !profile ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              {categories.map(cat => {
                                const current = allocation[cat.key] || 0;

                                return (
                                  <div key={cat.key}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                      <span style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span>{cat.icon}</span> {cat.label}
                                      </span>
                                      <span style={{ color: 'var(--text-primary)', fontSize: '12px', fontWeight: '600' }}>
                                        {current.toFixed(1)}%
                                      </span>
                                    </div>
                                    <div style={{
                                      position: 'relative',
                                      height: '20px',
                                      background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                                      borderRadius: '10px',
                                      overflow: 'hidden'
                                    }}>
                                      <div style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        bottom: 0,
                                        width: `${Math.min(current, 100)}%`,
                                        background: `linear-gradient(90deg, ${cat.color} 0%, ${cat.color}dd 100%)`,
                                        borderRadius: '10px',
                                        transition: 'width 0.3s ease'
                                      }} />
                                    </div>
                                  </div>
                                );
                              })}
                              <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '11px', textAlign: 'center' }}>
                                Set a profile to see limit comparisons
                              </p>
                            </div>
                          ) : (
                            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                              <div style={{ fontSize: '32px', marginBottom: '8px', opacity: 0.5 }}>📉</div>
                              <p style={{ margin: 0, fontSize: '13px' }}>No portfolio data available</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </LiquidGlassCard>
          )}

          {/* Family Members (CLIENT only) */}
          {user.role === USER_ROLES.CLIENT && (
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
                        Birthday
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
                              <span>Birthday not set</span>
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

          {/* Password Reset (ADMIN and SUPERADMIN - but ADMINs cannot reset SUPERADMIN passwords) */}
          {(currentUser?.role === USER_ROLES.SUPERADMIN ||
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
        </div>
      </div>
    </div>
  );
}
