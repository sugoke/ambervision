import React, { useState, useEffect, useMemo } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import Dialog from './Dialog';
import { useDialog } from './useDialog';

const UserManagement = ({ user: currentUser }) => {
  const [activeSection, setActiveSection] = useState('users'); // 'users', 'rm-management', 'create'
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState(USER_ROLES.CLIENT);
  const [newUserFirstName, setNewUserFirstName] = useState('');
  const [newUserLastName, setNewUserLastName] = useState('');
  const [newUserBirthday, setNewUserBirthday] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [editModal, setEditModal] = useState(false);
  const [selectedRmId, setSelectedRmId] = useState(null); // For RM management section
  const [newBankAccount, setNewBankAccount] = useState({
    bankId: '',
    accountNumber: '',
    referenceCurrency: 'USD',
    accountType: 'personal',
    accountStructure: 'direct',
    lifeInsuranceCompany: ''
  });
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [isCreatingBankAccount, setIsCreatingBankAccount] = useState(false);
  const [newFamilyMember, setNewFamilyMember] = useState({
    name: '',
    relationship: 'spouse',
    birthday: ''
  });
  const { dialogState, hideDialog, showConfirm } = useDialog();

  // Memoize subscriptions to prevent re-initialization
  const subscriptions = useMemo(() => ({
    users: Meteor.subscribe('customUsers'),
    bankAccounts: Meteor.subscribe('allBankAccounts'),
    banks: Meteor.subscribe('banks')
  }), []);

  const { users, bankAccounts, banks, isLoadingUsers } = useTracker(() => {
    // Check if ANY subscription is not ready
    const isLoading = !subscriptions.users.ready() || 
                     !subscriptions.bankAccounts.ready() || 
                     !subscriptions.banks.ready();
    
    return {
      users: UsersCollection.find({}).fetch(),
      bankAccounts: BankAccountsCollection.find({ isActive: true }).fetch(),
      banks: BanksCollection.find({ isActive: true }, { sort: { name: 1 } }).fetch(),
      isLoadingUsers: isLoading
    };
  }, [subscriptions]); // Make it properly reactive

  // Update editingUser when bankAccounts change (to keep bank accounts in sync)
  useEffect(() => {
    if (editingUser && bankAccounts.length > 0) {
      const userBankAccounts = bankAccounts.filter(account => 
        account && account.userId === editingUser._id && account.isActive === true
      );
      
      // Only update if the bank accounts have actually changed
      if (JSON.stringify(userBankAccounts) !== JSON.stringify(editingUser.bankAccounts)) {
        console.log('useEffect: Updating editingUser bank accounts - found', userBankAccounts.length, 'accounts');
        setEditingUser(prev => ({
          ...prev,
          bankAccounts: userBankAccounts
        }));
      }
    }
  }, [bankAccounts, editingUser?._id]);

  const handleCreateUser = (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsCreatingUser(true);

    Meteor.call('users.create', {
      email: newUserEmail,
      password: newUserPassword,
      role: newUserRole,
      profile: {
        firstName: newUserFirstName,
        lastName: newUserLastName,
        birthday: newUserBirthday ? new Date(newUserBirthday) : null
      }
    }, (err) => {
      setIsCreatingUser(false);
      if (err) {
        setError(err.reason);
      } else {
        setSuccess('User created successfully!');
        setNewUserEmail('');
        setNewUserPassword('');
        setNewUserRole(USER_ROLES.CLIENT);
        setNewUserFirstName('');
        setNewUserLastName('');
        setNewUserBirthday('');
      }
    });
  };

  const handleRoleChange = (userId, newRole) => {
    Meteor.call('users.updateRole', userId, newRole, (err) => {
      if (err) {
        setError(err.reason);
      } else {
        setSuccess('User role updated successfully!');
      }
    });
  };

  const handleDeleteUser = async (userId) => {
    const confirmed = await showConfirm('Are you sure you want to delete this user?');
    if (confirmed) {
      Meteor.call('users.remove', userId, (err) => {
        if (err) {
          setError(err.reason);
        } else {
          setSuccess('User deleted successfully!');
        }
      });
    }
  };

  const handleEditUser = (user) => {
    // Use fresh data from users array (already reactive from useTracker)
    const freshUser = users.find(u => u._id === user._id) || user;
    
    // Get user's current bank accounts from reactive bankAccounts array
    // Filter out any null/undefined accounts and ensure we have the most recent data
    const userBankAccounts = bankAccounts.filter(account => 
      account && account.userId === freshUser._id && account.isActive === true
    );
    
    console.log('handleEditUser: Found bank accounts for user', freshUser._id, ':', userBankAccounts.length);
    console.log('handleEditUser: All bank accounts available:', bankAccounts.length);
    
    const editUserData = {
      _id: freshUser._id,
      email: freshUser.email,
      role: freshUser.role,
      profile: freshUser.profile || {},
      relationshipManagerId: freshUser.relationshipManagerId || null,
      bankAccounts: userBankAccounts
    };
    
    setEditingUser(editUserData);
    setEditModal(true);
    setError('');
    setSuccess('');
  };

  const handleSaveUser = () => {
    if (!editingUser.email.trim()) {
      setError('Email is required');
      return;
    }

    setError('');
    setSuccess('');

    console.log('UserManagement: Saving user profile data:', {
      userId: editingUser._id,
      email: editingUser.email,
      profile: editingUser.profile,
      relationshipManagerId: editingUser.relationshipManagerId
    });

    Meteor.call('users.updateProfile', editingUser._id, {
      email: editingUser.email,
      profile: editingUser.profile,
      relationshipManagerId: editingUser.relationshipManagerId
    }, (err) => {
      if (err) {
        console.error('UserManagement: Error saving user profile:', err);
        setError(err.reason);
      } else {
        console.log('UserManagement: User profile updated successfully');
        setSuccess('User profile updated successfully!');
        
        // Force a small delay to allow reactivity to update
        setTimeout(() => {
          setEditModal(false);
          setEditingUser(null);
        }, 100);
      }
    });
  };

  const handleCloseEditModal = () => {
    setEditModal(false);
    setEditingUser(null);
    setError('');
    setSuccess('');
    // Reset new bank account form
    setNewBankAccount({
      bankId: '',
      accountNumber: '',
      referenceCurrency: 'USD',
      accountType: 'personal',
      accountStructure: 'direct',
      lifeInsuranceCompany: ''
    });
  };

  const handleAddFamilyMember = () => {
    if (!newFamilyMember.name.trim()) {
      setError('Please enter a name for the family member');
      return;
    }

    const familyMember = {
      _id: new Date().getTime().toString(), // Simple ID generation
      name: newFamilyMember.name.trim(),
      relationship: newFamilyMember.relationship,
      birthday: newFamilyMember.birthday ? new Date(newFamilyMember.birthday) : null
    };

    setEditingUser(prev => ({
      ...prev,
      profile: {
        ...prev.profile,
        familyMembers: [...(prev.profile.familyMembers || []), familyMember]
      }
    }));

    // Reset form
    setNewFamilyMember({
      name: '',
      relationship: 'spouse',
      birthday: ''
    });

    setError('');
  };

  const handleDeleteFamilyMember = (index) => {
    setEditingUser(prev => ({
      ...prev,
      profile: {
        ...prev.profile,
        familyMembers: (prev.profile.familyMembers || []).filter((_, i) => i !== index)
      }
    }));
  };

  const handleCreateBankAccount = () => {
    if (!newBankAccount.bankId || !newBankAccount.accountNumber) {
      setError('Please select a bank and enter an account number');
      return;
    }

    setError('');
    setSuccess('');
    setIsCreatingBankAccount(true);

    const sessionId = localStorage.getItem('sessionId');
    Meteor.call('bankAccounts.create', {
      userId: editingUser._id,
      bankId: newBankAccount.bankId,
      accountNumber: newBankAccount.accountNumber,
      referenceCurrency: newBankAccount.referenceCurrency,
      accountType: newBankAccount.accountType,
      accountStructure: newBankAccount.accountStructure,
      lifeInsuranceCompany: newBankAccount.accountStructure === 'life_insurance' ? newBankAccount.lifeInsuranceCompany : null,
      sessionId: sessionId
    }, (err, result) => {
      setIsCreatingBankAccount(false);
      if (err) {
        setError(err.reason || 'Failed to create bank account');
      } else {
        setSuccess('Bank account created successfully!');
        // Reset form
        setNewBankAccount({
          bankId: '',
          accountNumber: '',
          referenceCurrency: 'USD',
          accountType: 'personal',
          accountStructure: 'direct',
          lifeInsuranceCompany: ''
        });
        // Bank accounts will be automatically updated through reactive useTracker
        // No need to manually refresh - the reactive subscription will handle it
      }
    });
  };

  const handleDeleteBankAccount = async (accountId) => {
    const confirmed = await showConfirm('Are you sure you want to delete this bank account?');
    if (confirmed) {
      setError('');
      setSuccess('');

      // Call the server method to remove the bank account
      const sessionId = localStorage.getItem('sessionId');
      Meteor.call('bankAccounts.remove', { accountId, sessionId }, (err) => {
        if (err) {
          setError(err.reason || 'Failed to delete bank account');
        } else {
          setSuccess('Bank account deleted successfully!');
          // Bank accounts will be automatically updated through reactive useTracker
          // Close and reopen modal to reflect changes
          setTimeout(() => {
            const updatedUser = users.find(u => u._id === editingUser._id);
            if (updatedUser) {
              handleEditUser(updatedUser);
            }
          }, 100);
        }
      });
    }
  };

  const getBankName = (bankId) => {
    const bank = banks.find(b => b._id === bankId);
    return bank ? bank.name : 'Unknown Bank';
  };

  if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
    return (
      <div style={{ 
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '200px',
        color: 'var(--text-secondary)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ color: 'var(--text-primary)' }}>Access Denied</h3>
          <p>You need admin privileges to access user management.</p>
        </div>
      </div>
    );
  }


  // Calculate RM statistics
  const relationshipManagers = useMemo(() => {
    return users.filter(u => u.role === USER_ROLES.RELATIONSHIP_MANAGER);
  }, [users]);

  const rmStats = useMemo(() => {
    return relationshipManagers.map(rm => {
      const assignedClients = users.filter(u =>
        u.role === USER_ROLES.CLIENT && u.relationshipManagerId === rm._id
      );
      return {
        rm,
        clientCount: assignedClients.length,
        clients: assignedClients
      };
    });
  }, [relationshipManagers, users]);

  const unassignedClients = useMemo(() => {
    return users.filter(u =>
      u.role === USER_ROLES.CLIENT && !u.relationshipManagerId
    );
  }, [users]);

  return (
    <div>
      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '2rem',
        borderBottom: '2px solid var(--border-color)',
        paddingBottom: '0'
      }}>
        <button
          onClick={() => setActiveSection('create')}
          style={{
            padding: '1rem 1.5rem',
            background: activeSection === 'create' ? 'var(--accent-color)' : 'transparent',
            color: activeSection === 'create' ? 'white' : 'var(--text-primary)',
            border: 'none',
            borderBottom: activeSection === 'create' ? '3px solid var(--accent-color)' : '3px solid transparent',
            cursor: 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            transition: 'all 0.3s ease'
          }}
        >
          ➕ Create User
        </button>
        <button
          onClick={() => setActiveSection('users')}
          style={{
            padding: '1rem 1.5rem',
            background: activeSection === 'users' ? 'var(--accent-color)' : 'transparent',
            color: activeSection === 'users' ? 'white' : 'var(--text-primary)',
            border: 'none',
            borderBottom: activeSection === 'users' ? '3px solid var(--accent-color)' : '3px solid transparent',
            cursor: 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            transition: 'all 0.3s ease'
          }}
        >
          👥 All Users ({users.length})
        </button>
        <button
          onClick={() => setActiveSection('rm-management')}
          style={{
            padding: '1rem 1.5rem',
            background: activeSection === 'rm-management' ? 'var(--accent-color)' : 'transparent',
            color: activeSection === 'rm-management' ? 'white' : 'var(--text-primary)',
            border: 'none',
            borderBottom: activeSection === 'rm-management' ? '3px solid var(--accent-color)' : '3px solid transparent',
            cursor: 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            transition: 'all 0.3s ease'
          }}
        >
          👔 RM Management ({relationshipManagers.length} RMs)
        </button>
      </div>

      {/* Create New User Form */}
      {activeSection === 'create' && (
      <section style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        background: 'var(--bg-primary)'
      }}>
        <h3 style={{
          margin: '0 0 1.5rem 0',
          fontSize: '1.2rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          Create New User
        </h3>
        <form onSubmit={handleCreateUser}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            <div>
              <label htmlFor="new-user-email" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Email:
              </label>
              <input
                id="new-user-email"
                name="newUserEmail"
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                required
                autoComplete="email"
                style={{ 
                  width: '100%', 
                  padding: '12px 16px', 
                  border: '2px solid var(--border-color)', 
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
            
            <div>
              <label htmlFor="new-user-password" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Password:
              </label>
              <input
                id="new-user-password"
                name="newUserPassword"
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                required
                autoComplete="new-password"
                style={{ 
                  width: '100%', 
                  padding: '12px 16px', 
                  border: '2px solid var(--border-color)', 
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            <div>
              <label htmlFor="new-user-role" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Role:
              </label>
              <select
                id="new-user-role"
                name="newUserRole"
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '12px 16px', 
                  border: '2px solid var(--border-color)', 
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer'
                }}
              >
                <option value={USER_ROLES.CLIENT}>Client</option>
                <option value={USER_ROLES.RELATIONSHIP_MANAGER}>Relationship Manager</option>
                <option value={USER_ROLES.ADMIN}>Admin</option>
                {currentUser.role === USER_ROLES.SUPERADMIN && (
                  <option value={USER_ROLES.SUPERADMIN}>Super Admin</option>
                )}
              </select>
            </div>

            <div>
              <label htmlFor="new-user-firstname" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                First Name:
              </label>
              <input
                id="new-user-firstname"
                name="newUserFirstName"
                type="text"
                value={newUserFirstName}
                onChange={(e) => setNewUserFirstName(e.target.value)}
                autoComplete="given-name"
                style={{ 
                  width: '100%', 
                  padding: '12px 16px', 
                  border: '2px solid var(--border-color)', 
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            <div>
              <label htmlFor="new-user-lastname" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Last Name:
              </label>
              <input
                id="new-user-lastname"
                name="newUserLastName"
                type="text"
                value={newUserLastName}
                onChange={(e) => setNewUserLastName(e.target.value)}
                autoComplete="family-name"
                style={{ 
                  width: '100%', 
                  padding: '12px 16px', 
                  border: '2px solid var(--border-color)', 
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            <div>
              <label htmlFor="new-user-birthday" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Birthday:
              </label>
              <input
                id="new-user-birthday"
                name="newUserBirthday"
                type="date"
                value={newUserBirthday}
                onChange={(e) => setNewUserBirthday(e.target.value)}
                autoComplete="bday"
                style={{ 
                  width: '100%', 
                  padding: '12px 16px', 
                  border: '2px solid var(--border-color)', 
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
          </div>

          <button type="submit" disabled={isCreatingUser} style={{ 
            padding: '12px 24px', 
            background: isCreatingUser 
              ? 'var(--text-muted)' 
              : 'var(--success-color)', 
            color: 'white', 
            border: 'none', 
            borderRadius: '8px',
            cursor: isCreatingUser ? 'not-allowed' : 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            transition: 'all 0.3s ease',
            boxShadow: isCreatingUser ? 'none' : '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            {isCreatingUser ? 'Creating User...' : 'Create User'}
          </button>
        </form>
      </section>
      )}

      {/* Messages */}
      {error && (
        <div style={{ 
          color: 'var(--danger-color)', 
          marginBottom: '1rem',
          padding: '12px 16px',
          backgroundColor: 'rgba(220, 53, 69, 0.1)',
          border: '1px solid rgba(220, 53, 69, 0.3)',
          borderRadius: '8px',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ 
          color: 'var(--success-color)', 
          marginBottom: '1rem',
          padding: '12px 16px',
          backgroundColor: 'rgba(40, 167, 69, 0.1)',
          border: '1px solid rgba(40, 167, 69, 0.3)',
          borderRadius: '8px',
          fontSize: '0.875rem'
        }}>
          {success}
        </div>
      )}

      {/* Users List */}
      {activeSection === 'users' && (
      <section style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '1.5rem'
      }}>
        <h3 style={{
          margin: '0 0 1.5rem 0',
          fontSize: '1.2rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          All Users ({users.length})
        </h3>
        
        {isLoadingUsers ? (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            border: '1px dashed var(--border-color)'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}>⏳</div>
            <h3 style={{
              margin: '0 0 0.5rem 0',
              color: 'var(--text-secondary)',
              fontSize: '1.1rem',
              fontWeight: '500'
            }}>
              Loading users...
            </h3>
            <p style={{
              margin: 0,
              color: 'var(--text-muted)',
              fontSize: '0.85rem'
            }}>
              Please wait while we fetch the user data
            </p>
          </div>
        ) : (
          <div style={{ 
            overflowX: 'auto'
          }}>
            <table style={{ 
              width: '100%', 
              borderCollapse: 'collapse',
              border: '1px solid var(--border-color)'
            }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>Email</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>First Name</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>Last Name</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>Role</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>Relationship Manager</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>Created</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user._id} style={{ backgroundColor: 'var(--bg-primary)' }}>
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)' }}>
                    {user.email || 'No email'}
                  </td>
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)' }}>
                    {user.profile?.firstName || '-'}
                  </td>
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)' }}>
                    {user.profile?.lastName || '-'}
                  </td>
                  <td style={{ 
                    padding: '12px', 
                    border: '1px solid var(--border-color)'
                  }}>
                    {currentUser.role === USER_ROLES.SUPERADMIN ? (
                      <select
                        id={`user-role-${user._id}`}
                        name={`userRole-${user._id}`}
                        value={user.role || USER_ROLES.CLIENT}
                        onChange={(e) => handleRoleChange(user._id, e.target.value)}
                        style={{ 
                          width: '100%', 
                          padding: '4px', 
                          border: '1px solid var(--border-color)', 
                          borderRadius: '3px',
                          backgroundColor: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          minHeight: '32px',
                          cursor: 'pointer'
                        }}
                      >
                        <option value={USER_ROLES.CLIENT}>Client</option>
                        <option value={USER_ROLES.RELATIONSHIP_MANAGER}>Relationship Manager</option>
                        <option value={USER_ROLES.ADMIN}>Admin</option>
                        <option value={USER_ROLES.SUPERADMIN}>Super Admin</option>
                      </select>
                    ) : (
                      <span style={{
                        padding: '4px 8px',
                        backgroundColor:
                          user.role === USER_ROLES.SUPERADMIN ? 'var(--danger-color)' :
                          user.role === USER_ROLES.ADMIN ? 'var(--warning-color)' :
                          user.role === USER_ROLES.RELATIONSHIP_MANAGER ? '#3b82f6' :
                          'var(--success-color)',
                        color: 'white',
                        borderRadius: '3px',
                        fontSize: '0.8em'
                      }}>
                        {user.role || USER_ROLES.CLIENT}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)' }}>
                    {user.role === USER_ROLES.CLIENT && user.relationshipManagerId ? (
                      (() => {
                        const rm = users.find(u => u._id === user.relationshipManagerId);
                        return rm ? (
                          <span style={{
                            padding: '4px 8px',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            color: '#3b82f6',
                            borderRadius: '4px',
                            fontSize: '0.85em',
                            fontWeight: '500'
                          }}>
                            {rm.profile?.firstName || ''} {rm.profile?.lastName || rm.email}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.85em', fontStyle: 'italic' }}>
                            RM not found
                          </span>
                        );
                      })()
                    ) : user.role === USER_ROLES.CLIENT ? (
                      <span style={{
                        padding: '4px 8px',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        color: '#f59e0b',
                        borderRadius: '4px',
                        fontSize: '0.85em',
                        fontWeight: '500'
                      }}>
                        Unassigned
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>-</span>
                    )}
                  </td>
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)' }}>
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
                  </td>
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                      {user._id !== currentUser._id && (
                        <button
                          onClick={() => handleEditUser(user)}
                          style={{ 
                            padding: '4px 8px', 
                            backgroundColor: 'var(--accent-color)', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '0.8em'
                          }}
                        >
                          Edit
                        </button>
                      )}
                      
                      {currentUser.role === USER_ROLES.SUPERADMIN && user._id !== currentUser._id && (
                        <button
                          onClick={() => handleDeleteUser(user._id)}
                          style={{ 
                            padding: '4px 8px', 
                            backgroundColor: 'var(--danger-color)', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '0.8em'
                          }}
                        >
                          Delete
                        </button>
                      )}
                      
                      {user._id === currentUser._id && (
                        <span style={{ 
                          color: 'var(--text-muted)', 
                          fontSize: '0.8em',
                          fontStyle: 'italic'
                        }}>
                          Current User
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        
        {!isLoadingUsers && users.length === 0 && (
          <div style={{ 
            textAlign: 'center', 
            padding: '3rem', 
            color: 'var(--text-muted)',
            fontSize: '1rem'
          }}>
            No users found.
          </div>
        )}
      </section>
      )}

      {/* RM Management Section */}
      {activeSection === 'rm-management' && (
        <div>
          {/* RM Overview Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '2rem'
          }}>
            <div style={{
              background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1.5rem',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '2rem',
                fontWeight: '700',
                color: '#3b82f6',
                marginBottom: '0.5rem'
              }}>
                {relationshipManagers.length}
              </div>
              <div style={{
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                fontWeight: '500',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Total RMs
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1.5rem',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '2rem',
                fontWeight: '700',
                color: 'var(--success-color)',
                marginBottom: '0.5rem'
              }}>
                {users.filter(u => u.role === USER_ROLES.CLIENT).length}
              </div>
              <div style={{
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                fontWeight: '500',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Total Clients
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1.5rem',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '2rem',
                fontWeight: '700',
                color: '#f59e0b',
                marginBottom: '0.5rem'
              }}>
                {unassignedClients.length}
              </div>
              <div style={{
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                fontWeight: '500',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Unassigned Clients
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1.5rem',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '2rem',
                fontWeight: '700',
                color: '#6366f1',
                marginBottom: '0.5rem'
              }}>
                {relationshipManagers.length > 0
                  ? Math.round(users.filter(u => u.role === USER_ROLES.CLIENT && u.relationshipManagerId).length / relationshipManagers.length)
                  : 0}
              </div>
              <div style={{
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                fontWeight: '500',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Avg Clients per RM
              </div>
            </div>
          </div>

          {/* RM Overview Table */}
          <section style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '1.5rem',
            marginBottom: '2rem'
          }}>
            <h3 style={{
              margin: '0 0 1.5rem 0',
              fontSize: '1.2rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Relationship Managers Overview
            </h3>

            {relationshipManagers.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '3rem 2rem',
                background: 'var(--bg-secondary)',
                borderRadius: '12px',
                border: '2px dashed var(--border-color)'
              }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.3 }}>👔</div>
                <h3 style={{
                  margin: '0 0 0.5rem 0',
                  color: 'var(--text-secondary)',
                  fontSize: '1.1rem',
                  fontWeight: '500'
                }}>
                  No Relationship Managers
                </h3>
                <p style={{
                  margin: 0,
                  color: 'var(--text-muted)',
                  fontSize: '0.9rem'
                }}>
                  Create users with "Relationship Manager" role to get started
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  border: '1px solid var(--border-color)'
                }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                      <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>RM Name</th>
                      <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>Email</th>
                      <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>Assigned Clients</th>
                      <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rmStats.map(({ rm, clientCount, clients }) => (
                      <tr key={rm._id} style={{ backgroundColor: 'var(--bg-primary)' }}>
                        <td style={{ padding: '12px', border: '1px solid var(--border-color)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{
                              padding: '4px 8px',
                              backgroundColor: '#3b82f6',
                              color: 'white',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              fontWeight: '600'
                            }}>
                              RM
                            </span>
                            <span style={{ fontWeight: '600' }}>
                              {rm.profile?.firstName || ''} {rm.profile?.lastName || 'Unknown'}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '12px', border: '1px solid var(--border-color)' }}>
                          {rm.email}
                        </td>
                        <td style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                          <span style={{
                            padding: '4px 12px',
                            backgroundColor: clientCount > 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(156, 163, 175, 0.1)',
                            color: clientCount > 0 ? '#22c55e' : '#9ca3af',
                            borderRadius: '12px',
                            fontSize: '0.9rem',
                            fontWeight: '600'
                          }}>
                            {clientCount} {clientCount === 1 ? 'client' : 'clients'}
                          </span>
                        </td>
                        <td style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                          <button
                            onClick={() => setSelectedRmId(selectedRmId === rm._id ? null : rm._id)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: selectedRmId === rm._id ? '#3b82f6' : 'var(--accent-color)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '0.85rem',
                              fontWeight: '600',
                              transition: 'all 0.2s ease'
                            }}
                          >
                            {selectedRmId === rm._id ? 'Hide Clients' : 'View Clients'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Selected RM's Clients */}
          {selectedRmId && (() => {
            const rmStat = rmStats.find(s => s.rm._id === selectedRmId);
            if (!rmStat) return null;

            return (
              <section style={{
                background: 'var(--bg-primary)',
                border: '2px solid #3b82f6',
                borderRadius: '12px',
                padding: '1.5rem',
                marginBottom: '2rem'
              }}>
                <h3 style={{
                  margin: '0 0 1.5rem 0',
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span style={{
                    padding: '4px 8px',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    borderRadius: '4px',
                    fontSize: '0.75rem'
                  }}>
                    RM
                  </span>
                  {rmStat.rm.profile?.firstName || ''} {rmStat.rm.profile?.lastName || rmStat.rm.email}'s Clients ({rmStat.clientCount})
                </h3>

                {rmStat.clients.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '2rem',
                    color: 'var(--text-muted)',
                    fontStyle: 'italic'
                  }}>
                    No clients assigned yet
                  </div>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                    gap: '1rem'
                  }}>
                    {rmStat.clients.map(client => (
                      <div
                        key={client._id}
                        style={{
                          padding: '1rem',
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                            {client.profile?.firstName || ''} {client.profile?.lastName || 'Unknown'}
                          </div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {client.email}
                          </div>
                        </div>
                        <button
                          onClick={() => handleEditUser(client)}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'var(--accent-color)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: '600'
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })()}

          {/* Unassigned Clients */}
          {unassignedClients.length > 0 && (
            <section style={{
              background: 'var(--bg-primary)',
              border: '2px solid #f59e0b',
              borderRadius: '12px',
              padding: '1.5rem'
            }}>
              <h3 style={{
                margin: '0 0 1.5rem 0',
                fontSize: '1.1rem',
                fontWeight: '600',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span style={{
                  padding: '4px 8px',
                  backgroundColor: '#f59e0b',
                  color: 'white',
                  borderRadius: '4px',
                  fontSize: '0.75rem'
                }}>
                  ⚠️
                </span>
                Unassigned Clients ({unassignedClients.length})
              </h3>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '1rem'
              }}>
                {unassignedClients.map(client => (
                  <div
                    key={client._id}
                    style={{
                      padding: '1rem',
                      background: 'rgba(245, 158, 11, 0.05)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '8px'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '0.75rem'
                    }}>
                      <div>
                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                          {client.profile?.firstName || ''} {client.profile?.lastName || 'Unknown'}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          {client.email}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            // Directly update the client's RM
                            Meteor.call('users.updateProfile', client._id, {
                              relationshipManagerId: e.target.value
                            }, (err) => {
                              if (err) {
                                setError(err.reason);
                              } else {
                                setSuccess(`Client assigned successfully!`);
                                e.target.value = ''; // Reset dropdown
                              }
                            });
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                          backgroundColor: 'var(--bg-secondary)',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="">Assign to RM...</option>
                        {relationshipManagers.map(rm => (
                          <option key={rm._id} value={rm._id}>
                            {rm.profile?.firstName || ''} {rm.profile?.lastName || rm.email}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleEditUser(client)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'var(--accent-color)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: '600'
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Edit User Modal */}
      {editModal && editingUser && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }} onClick={handleCloseEditModal}>
          <div style={{
            backgroundColor: 'var(--bg-primary)',
            borderRadius: '12px',
            padding: '2rem',
            width: '90%',
            maxWidth: '600px',
            maxHeight: '80vh',
            overflowY: 'auto',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1.5rem',
              borderBottom: '2px solid var(--border-color)',
              paddingBottom: '1rem'
            }}>
              <h2 style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Edit User Profile
              </h2>
              <button
                onClick={handleCloseEditModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '4px'
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="edit-user-email" style={{
                display: 'block',
                marginBottom: '8px',
                fontWeight: '600',
                color: 'var(--text-secondary)'
              }}>
                Email Address
              </label>
              <input
                id="edit-user-email"
                name="editUserEmail"
                type="email"
                value={editingUser.email}
                onChange={(e) => setEditingUser(prev => ({ ...prev, email: e.target.value }))}
                autoComplete="email"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="edit-user-firstname" style={{
                display: 'block',
                marginBottom: '8px',
                fontWeight: '600',
                color: 'var(--text-secondary)'
              }}>
                First Name
              </label>
              <input
                id="edit-user-firstname"
                name="editUserFirstName"
                type="text"
                value={editingUser.profile.firstName || ''}
                onChange={(e) => {
                  console.log('UserManagement: firstName changed to:', e.target.value);
                  setEditingUser(prev => ({ 
                    ...prev, 
                    profile: { ...prev.profile, firstName: e.target.value }
                  }));
                }}
                autoComplete="given-name"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="edit-user-lastname" style={{
                display: 'block',
                marginBottom: '8px',
                fontWeight: '600',
                color: 'var(--text-secondary)'
              }}>
                Last Name
              </label>
              <input
                id="edit-user-lastname"
                name="editUserLastName"
                type="text"
                value={editingUser.profile.lastName || ''}
                onChange={(e) => {
                  console.log('UserManagement: lastName changed to:', e.target.value);
                  setEditingUser(prev => ({ 
                    ...prev, 
                    profile: { ...prev.profile, lastName: e.target.value }
                  }));
                }}
                autoComplete="family-name"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="edit-user-birthday" style={{
                display: 'block',
                marginBottom: '8px',
                fontWeight: '600',
                color: 'var(--text-secondary)'
              }}>
                Birthday
              </label>
              <input
                id="edit-user-birthday"
                name="editUserBirthday"
                type="date"
                value={editingUser.profile.birthday ? new Date(editingUser.profile.birthday).toISOString().split('T')[0] : ''}
                onChange={(e) => {
                  console.log('UserManagement: birthday changed to:', e.target.value);
                  setEditingUser(prev => ({ 
                    ...prev, 
                    profile: { ...prev.profile, birthday: e.target.value ? new Date(e.target.value) : null }
                  }));
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  transition: 'border-color 0.3s ease'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'var(--accent-color)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'var(--border-color)';
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="edit-user-language" style={{
                display: 'block',
                marginBottom: '8px',
                fontWeight: '600',
                color: 'var(--text-secondary)'
              }}>
                Preferred Language
              </label>
              <select
                id="edit-user-language"
                name="editUserLanguage"
                value={editingUser.profile.preferredLanguage || 'en'}
                onChange={(e) => {
                  setEditingUser(prev => ({ 
                    ...prev, 
                    profile: { ...prev.profile, preferredLanguage: e.target.value }
                  }));
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  boxSizing: 'border-box',
                  cursor: 'pointer'
                }}
              >
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="es">Spanish</option>
                <option value="it">Italian</option>
              </select>
            </div>

            {/* Relationship Manager Assignment - Only for clients */}
            {(editingUser.role === USER_ROLES.CLIENT || !editingUser.role) && (
              <div style={{ marginBottom: '1.5rem' }}>
                <label htmlFor="edit-user-rm" style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: '600',
                  color: 'var(--text-secondary)'
                }}>
                  👔 Relationship Manager
                </label>
                <select
                  id="edit-user-rm"
                  name="editUserRelationshipManager"
                  value={editingUser.relationshipManagerId || ''}
                  onChange={(e) => {
                    setEditingUser(prev => ({
                      ...prev,
                      relationshipManagerId: e.target.value || null
                    }));
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '2px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '1rem',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">No Relationship Manager (Unassigned)</option>
                  {users.filter(u => u.role === USER_ROLES.RELATIONSHIP_MANAGER).map(rm => (
                    <option key={rm._id} value={rm._id}>
                      {rm.profile?.firstName || ''} {rm.profile?.lastName || rm.email}
                    </option>
                  ))}
                </select>
                {editingUser.relationshipManagerId && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    color: '#3b82f6'
                  }}>
                    ℹ️ This client is assigned to {(() => {
                      const rm = users.find(u => u._id === editingUser.relationshipManagerId);
                      return rm ? `${rm.profile?.firstName || ''} ${rm.profile?.lastName || rm.email}` : 'Unknown RM';
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Family Members Section - Only for clients */}
            {(editingUser.role === USER_ROLES.CLIENT || !editingUser.role) && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px'
                }}>
                  <label style={{
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    fontSize: '1rem'
                  }}>
                    👨‍👩‍👧‍👦 Family Members
                  </label>
                </div>

                {/* Family Members List */}
                <div style={{
                  marginBottom: '1rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '1rem',
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}>
                  {editingUser.profile.familyMembers && editingUser.profile.familyMembers.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {editingUser.profile.familyMembers.map((member, index) => (
                        <div
                          key={member._id || index}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{
                              fontWeight: '600',
                              color: 'var(--text-primary)',
                              marginBottom: '4px',
                              fontSize: '0.9rem'
                            }}>
                              {member.name}
                            </div>
                            <div style={{
                              display: 'flex',
                              gap: '12px',
                              fontSize: '0.8rem',
                              color: 'var(--text-secondary)'
                            }}>
                              <span>{member.relationship}</span>
                              <span>Birthday: {member.birthday ? new Date(member.birthday).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set'}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteFamilyMember(index)}
                            style={{
                              padding: '4px 8px',
                              background: 'var(--danger-color)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.8rem'
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontStyle: 'italic',
                      padding: '2rem'
                    }}>
                      No family members added
                    </div>
                  )}
                </div>

                {/* Add New Family Member Section */}
                <div style={{
                  padding: '1rem',
                  background: 'var(--bg-secondary)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}>
                  <h4 style={{
                    margin: '0 0 1rem 0',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    ➕ Add Family Member
                  </h4>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    {/* Name */}
                    <div>
                      <label htmlFor="family-member-name" style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', fontWeight: '500' }}>
                        Name
                      </label>
                      <input
                        id="family-member-name"
                        type="text"
                        value={newFamilyMember.name}
                        onChange={(e) => {
                          setNewFamilyMember(prev => ({ ...prev, name: e.target.value }));
                        }}
                        placeholder="Enter name"
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem'
                        }}
                      />
                    </div>

                    {/* Relationship */}
                    <div>
                      <label htmlFor="family-member-relationship" style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', fontWeight: '500' }}>
                        Relationship
                      </label>
                      <select
                        id="family-member-relationship"
                        value={newFamilyMember.relationship}
                        onChange={(e) => {
                          setNewFamilyMember(prev => ({ ...prev, relationship: e.target.value }));
                        }}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="spouse">Spouse</option>
                        <option value="child">Child</option>
                        <option value="parent">Parent</option>
                        <option value="sibling">Sibling</option>
                        <option value="grandparent">Grandparent</option>
                        <option value="grandchild">Grandchild</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    {/* Birthday */}
                    <div>
                      <label htmlFor="family-member-birthday" style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', fontWeight: '500' }}>
                        Birthday
                      </label>
                      <input
                        id="family-member-birthday"
                        type="date"
                        value={newFamilyMember.birthday}
                        onChange={(e) => setNewFamilyMember(prev => ({ ...prev, birthday: e.target.value }))}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem'
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={handleAddFamilyMember}
                      disabled={!newFamilyMember.name.trim()}
                      style={{
                        padding: '8px 16px',
                        background: (newFamilyMember.name.trim()) ? 'var(--accent-color)' : 'var(--text-muted)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: (newFamilyMember.name.trim()) ? 'pointer' : 'not-allowed',
                        fontSize: '0.85rem',
                        fontWeight: '600'
                      }}
                    >
                      Add Member
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Bank Account Linking Section - Only for clients */}
            {(editingUser.role === USER_ROLES.CLIENT || !editingUser.role) && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px'
                }}>
                  <label style={{
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    fontSize: '1rem'
                  }}>
                    🏦 Bank Accounts
                  </label>
                </div>

                {/* User's Bank Accounts List */}
                <div style={{
                  marginBottom: '1rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '1rem',
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}>
                  {editingUser.bankAccounts && editingUser.bankAccounts.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {editingUser.bankAccounts.map(account => (
                        <div
                          key={account._id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{
                              fontWeight: '600',
                              color: 'var(--text-primary)',
                              marginBottom: '4px',
                              fontSize: '0.9rem'
                            }}>
                              {getBankName(account.bankId)}
                            </div>
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                              fontSize: '0.8rem',
                              color: 'var(--text-secondary)'
                            }}>
                              <div style={{ display: 'flex', gap: '12px' }}>
                                <span>Account: {account.accountNumber}</span>
                                <span>Currency: {account.referenceCurrency}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '12px' }}>
                                <span>Type: {account.accountType || 'personal'}</span>
                                <span>Structure: {account.accountStructure === 'life_insurance' ? 'Life Insurance' : 'Direct'}</span>
                              </div>
                              {account.accountStructure === 'life_insurance' && account.lifeInsuranceCompany && (
                                <div style={{ fontSize: '0.75rem', fontStyle: 'italic', color: 'var(--accent-color)' }}>
                                  Via: {account.lifeInsuranceCompany}
                                </div>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteBankAccount(account._id)}
                            style={{
                              padding: '4px 8px',
                              background: 'var(--danger-color)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.8rem'
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontStyle: 'italic',
                      padding: '2rem'
                    }}>
                      No bank accounts created for this user
                    </div>
                  )}
                </div>

                {/* Create New Bank Account Section */}
                <div style={{
                  padding: '1rem',
                  background: 'var(--bg-secondary)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}>
                  <h4 style={{
                    margin: '0 0 1rem 0',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    ➕ Create New Bank Account
                  </h4>
                  
                  {/* First Row - Bank and Account Number */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label htmlFor="new-bank-select" style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', fontWeight: '500' }}>
                        Bank
                      </label>
                      <select
                        id="new-bank-select"
                        name="newBankId"
                        value={newBankAccount.bankId}
                        onChange={(e) => {
                          setNewBankAccount(prev => ({ ...prev, bankId: e.target.value }));
                        }}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="">Select a bank...</option>
                        {banks.map(bank => (
                          <option key={bank._id} value={bank._id}>
                            {bank.name} ({bank.city}, {bank.countryCode})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="new-account-number" style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', fontWeight: '500' }}>
                        Account Number
                      </label>
                      <input
                        id="new-account-number"
                        name="newAccountNumber"
                        type="text"
                        value={newBankAccount.accountNumber}
                        onChange={(e) => setNewBankAccount(prev => ({ ...prev, accountNumber: e.target.value }))}
                        placeholder="Enter account number"
                        autoComplete="off"
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem'
                        }}
                      />
                    </div>
                  </div>

                  {/* Second Row - Account Type and Currency */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label htmlFor="new-account-type" style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', fontWeight: '500' }}>
                        Account Type
                      </label>
                      <select
                        id="new-account-type"
                        name="newAccountType"
                        value={newBankAccount.accountType}
                        onChange={(e) => {
                          setNewBankAccount(prev => ({ ...prev, accountType: e.target.value }));
                        }}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="personal">Personal</option>
                        <option value="company">Company</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="new-currency-select" style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', fontWeight: '500' }}>
                        Reference Currency
                      </label>
                      <select
                        id="new-currency-select"
                        name="newCurrency"
                        value={newBankAccount.referenceCurrency}
                        onChange={(e) => {
                          setNewBankAccount(prev => ({ ...prev, referenceCurrency: e.target.value }));
                        }}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="CHF">CHF</option>
                        <option value="GBP">GBP</option>
                        <option value="JPY">JPY</option>
                      </select>
                    </div>
                  </div>

                  {/* Third Row - Account Structure */}
                  <div style={{ marginBottom: '12px' }}>
                    <label htmlFor="new-account-structure" style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', fontWeight: '500' }}>
                      Account Structure
                    </label>
                    <select
                      id="new-account-structure"
                      name="newAccountStructure"
                      value={newBankAccount.accountStructure}
                      onChange={(e) => {
                        setNewBankAccount(prev => ({ 
                          ...prev, 
                          accountStructure: e.target.value,
                          lifeInsuranceCompany: e.target.value === 'direct' ? '' : prev.lifeInsuranceCompany
                        }));
                      }}
                      style={{
                        width: '100%',
                        padding: '8px',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="direct">Direct</option>
                      <option value="life_insurance">Through Life Insurance</option>
                    </select>
                  </div>

                  {/* Life Insurance Company Field - Only show if life insurance is selected */}
                  {newBankAccount.accountStructure === 'life_insurance' && (
                    <div style={{ marginBottom: '12px' }}>
                      <label htmlFor="new-life-insurance" style={{ display: 'block', marginBottom: '6px', fontSize: '0.8rem', fontWeight: '500' }}>
                        Life Insurance Company
                      </label>
                      <input
                        id="new-life-insurance"
                        name="newLifeInsurance"
                        type="text"
                        value={newBankAccount.lifeInsuranceCompany}
                        onChange={(e) => setNewBankAccount(prev => ({ ...prev, lifeInsuranceCompany: e.target.value }))}
                        placeholder="Enter life insurance company name"
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem'
                        }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>

                    {/* Create Button */}
                    <div>
                      <button
                        onClick={handleCreateBankAccount}
                        disabled={!newBankAccount.bankId || !newBankAccount.accountNumber || isCreatingBankAccount}
                        style={{
                          padding: '8px 16px',
                          background: (newBankAccount.bankId && newBankAccount.accountNumber && !isCreatingBankAccount)
                            ? 'var(--accent-color)' 
                            : 'var(--text-muted)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: (newBankAccount.bankId && newBankAccount.accountNumber && !isCreatingBankAccount) ? 'pointer' : 'not-allowed',
                          fontSize: '0.85rem',
                          fontWeight: '600'
                        }}
                      >
                        {isCreatingBankAccount ? 'Creating...' : 'Create Account'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end',
              borderTop: '1px solid var(--border-color)',
              paddingTop: '1rem'
            }}>
              <button
                onClick={handleCloseEditModal}
                style={{
                  padding: '10px 20px',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '500'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUser}
                style={{
                  padding: '10px 20px',
                  background: 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600'
                }}
              >
                Save Changes
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
};

export default React.memo(UserManagement);