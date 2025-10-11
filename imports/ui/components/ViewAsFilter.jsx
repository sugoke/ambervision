import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { useViewAs } from '../ViewAsContext.jsx';

const ViewAsFilter = ({ currentUser }) => {
  const { viewAsFilter, setFilter, clearFilter } = useViewAs();
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);

  // Only show for admins and superadmins
  if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
    return null;
  }

  // Subscribe to clients and bank accounts
  const { clients, bankAccounts, isLoading } = useTracker(() => {
    const clientsSub = Meteor.subscribe('users.clients');
    const bankAccountsSub = Meteor.subscribe('bankAccounts.all');
    const banksSub = Meteor.subscribe('banks.all');

    const clientsList = UsersCollection.find(
      { role: USER_ROLES.CLIENT },
      { sort: { 'profile.lastName': 1, 'profile.firstName': 1 } }
    ).fetch();

    const accountsList = BankAccountsCollection.find(
      { isActive: true },
      { sort: { accountNumber: 1 } }
    ).fetch();

    const banksMap = {};
    BanksCollection.find({}).fetch().forEach(bank => {
      banksMap[bank._id] = bank;
    });

    // Enhance bank accounts with user and bank info
    const enhancedAccounts = accountsList.map(account => {
      const user = UsersCollection.findOne(account.userId);
      const bank = banksMap[account.bankId];
      return {
        ...account,
        userName: user ? `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() : 'Unknown',
        userEmail: user?.email || '',
        bankName: bank?.name || 'Unknown Bank'
      };
    });

    return {
      clients: clientsList,
      bankAccounts: enhancedAccounts,
      isLoading: !clientsSub.ready() || !bankAccountsSub.ready() || !banksSub.ready()
    };
  }, []);

  // Filter results based on search term
  const filteredClients = clients.filter(client => {
    if (!searchTerm) return false;
    const searchLower = searchTerm.toLowerCase();
    const fullName = `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.toLowerCase();
    const email = (client.email || '').toLowerCase();
    return fullName.includes(searchLower) || email.includes(searchLower);
  });

  const filteredAccounts = bankAccounts.filter(account => {
    if (!searchTerm) return false;
    const searchLower = searchTerm.toLowerCase();
    return (
      account.accountNumber.toLowerCase().includes(searchLower) ||
      account.userName.toLowerCase().includes(searchLower) ||
      account.userEmail.toLowerCase().includes(searchLower) ||
      account.bankName.toLowerCase().includes(searchLower)
    );
  });

  const allResults = [
    ...filteredClients.map(c => ({ type: 'client', data: c })),
    ...filteredAccounts.map(a => ({ type: 'account', data: a }))
  ].slice(0, 10); // Limit to 10 results

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => Math.min(prev + 1, allResults.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (allResults[highlightedIndex]) {
          handleSelect(allResults[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  const handleSelect = (result) => {
    const filter = {
      type: result.type,
      id: result.data._id || result.data.userId,
      label: result.type === 'client'
        ? `${result.data.profile?.firstName || ''} ${result.data.profile?.lastName || ''}`.trim()
        : `${result.data.accountNumber} - ${result.data.userName}`,
      data: result.data
    };
    setFilter(filter);
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleClear = () => {
    clearFilter();
    setSearchTerm('');
    inputRef.current?.focus();
  };

  const displayValue = viewAsFilter
    ? viewAsFilter.label
    : searchTerm;

  return (
    <div ref={dropdownRef} style={{ position: 'relative', minWidth: '300px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {/* Label */}
        <span style={{
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
          fontWeight: '500',
          whiteSpace: 'nowrap'
        }}>
          View as:
        </span>

        {/* Input */}
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            ref={inputRef}
            type="text"
            value={displayValue}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsOpen(true);
              setHighlightedIndex(0);
              if (viewAsFilter) clearFilter();
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (searchTerm && !viewAsFilter) setIsOpen(true);
            }}
            placeholder={viewAsFilter ? '' : 'Search clients or accounts...'}
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '0.5rem 2.5rem 0.5rem 0.75rem',
              background: viewAsFilter ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-primary)',
              border: viewAsFilter ? '2px solid #3b82f6' : '1px solid var(--border-color)',
              borderRadius: '8px',
              color: viewAsFilter ? '#3b82f6' : 'var(--text-primary)',
              fontSize: '0.875rem',
              fontWeight: viewAsFilter ? '600' : '400',
              outline: 'none',
              transition: 'all 0.2s'
            }}
          />

          {/* Clear button */}
          {viewAsFilter && (
            <button
              onClick={handleClear}
              style={{
                position: 'absolute',
                right: '0.5rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: '#3b82f6',
                cursor: 'pointer',
                fontSize: '1.2rem',
                lineHeight: 1,
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Clear filter"
            >
              ×
            </button>
          )}

          {/* Dropdown */}
          {isOpen && !viewAsFilter && allResults.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '0.25rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              maxHeight: '300px',
              overflowY: 'auto',
              zIndex: 1000
            }}>
              {allResults.map((result, index) => (
                <div
                  key={`${result.type}-${result.data._id}`}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  style={{
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    background: highlightedIndex === index ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    borderBottom: index < allResults.length - 1 ? '1px solid var(--border-color)' : 'none',
                    transition: 'background 0.15s'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.25rem'
                  }}>
                    {/* Icon */}
                    <span style={{ fontSize: '1rem' }}>
                      {result.type === 'client' ? '👤' : '🏦'}
                    </span>

                    {/* Main text */}
                    <span style={{
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      {result.type === 'client'
                        ? `${result.data.profile?.firstName || ''} ${result.data.profile?.lastName || ''}`.trim()
                        : result.data.accountNumber
                      }
                    </span>

                    {/* Badge */}
                    <span style={{
                      fontSize: '0.65rem',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '4px',
                      background: result.type === 'client' ? '#dbeafe' : '#fef3c7',
                      color: result.type === 'client' ? '#1e40af' : '#92400e',
                      fontWeight: '600',
                      textTransform: 'uppercase'
                    }}>
                      {result.type === 'client' ? 'Client' : 'Account'}
                    </span>
                  </div>

                  {/* Secondary text */}
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    paddingLeft: '1.5rem'
                  }}>
                    {result.type === 'client'
                      ? result.data.email
                      : `${result.data.userName} • ${result.data.bankName}`
                    }
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* No results message */}
          {isOpen && !viewAsFilter && searchTerm && allResults.length === 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '0.25rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1rem',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.875rem',
              zIndex: 1000
            }}>
              No clients or accounts found
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ViewAsFilter;
