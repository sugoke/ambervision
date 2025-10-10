import React, { useState } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { Meteor } from 'meteor/meteor';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';

const BankAccountManagement = ({ user }) => {
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({
    bankId: '',
    accountNumber: '',
    referenceCurrency: 'USD'
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { dialogState, showConfirm, hideDialog } = useDialog();

  // Subscribe to user's bank accounts and banks
  const bankAccountsLoading = useSubscribe('userBankAccounts', user._id);
  const banksLoading = useSubscribe('banks');

  const bankAccounts = useFind(() => 
    BankAccountsCollection.find({ userId: user._id, isActive: true }, { sort: { createdAt: -1 } })
  );
  const banks = useFind(() => 
    BanksCollection.find({ isActive: true }, { sort: { name: 1 } })
  );

  // Currency options
  const currencies = [
    'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK',
    'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'RUB', 'TRY', 'ZAR', 'BRL',
    'MXN', 'INR', 'CNY', 'HKD', 'SGD', 'KRW', 'THB', 'MYR', 'IDR', 'PHP'
  ];

  const handleAddAccount = (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    if (!newAccount.bankId || !newAccount.accountNumber) {
      setError('Please fill in all required fields');
      setIsLoading(false);
      return;
    }

    const sessionId = localStorage.getItem('sessionId');
    console.log('BankAccountManagement: Adding account with sessionId:', sessionId ? 'Present' : 'Missing');
    console.log('BankAccountManagement: Account data:', {
      bankId: newAccount.bankId,
      accountNumber: newAccount.accountNumber,
      referenceCurrency: newAccount.referenceCurrency
    });

    Meteor.call('bankAccounts.add', {
      bankId: newAccount.bankId,
      accountNumber: newAccount.accountNumber.trim(),
      referenceCurrency: newAccount.referenceCurrency,
      sessionId: sessionId
    }, (err, result) => {
      console.log('BankAccountManagement: Meteor call result:', err ? `Error: ${err.message}` : 'Success');
      setIsLoading(false);
      if (err) {
        console.error('BankAccountManagement: Full error:', err);
        setError(err.reason || err.message || 'Failed to add bank account');
      } else {
        console.log('BankAccountManagement: Account added successfully:', result);
        setSuccess('Bank account added successfully!');
        setNewAccount({ bankId: '', accountNumber: '', referenceCurrency: 'USD' });
        setIsAddingAccount(false);
        setTimeout(() => setSuccess(''), 3000);
      }
    });
  };

  const handleRemoveAccount = async (accountId) => {
    const confirmed = await showConfirm('Are you sure you want to remove this bank account?');
    if (confirmed) {
      const sessionId = localStorage.getItem('sessionId');
      Meteor.call('bankAccounts.remove', { accountId, sessionId }, (err) => {
        if (err) {
          setError(err.reason || 'Failed to remove bank account');
        } else {
          setSuccess('Bank account removed successfully!');
          setTimeout(() => setSuccess(''), 3000);
        }
      });
    }
  };

  const getBankInfo = (bankId) => {
    return banks.find(bank => bank._id === bankId);
  };

  console.log('BankAccountManagement: Current state:', {
    isAddingAccount,
    banksCount: banks.length,
    bankAccountsCount: bankAccounts.length,
    loading: bankAccountsLoading() || banksLoading()
  });

  if (bankAccountsLoading() || banksLoading()) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '200px',
        color: 'var(--text-secondary)'
      }}>
        Loading bank accounts...
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      padding: '2rem',
      margin: '1rem 0'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '1.3rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          Bank Accounts ({bankAccounts.length})
        </h3>
        <button
          onClick={() => {
            console.log('BankAccountManagement: Add Account button clicked');
            setIsAddingAccount(true);
          }}
          style={{
            background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            color: 'white',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '8px',
            fontSize: '0.9rem',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>+</span>
          Add Account
        </button>
      </div>

      {/* Success/Error Messages */}
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

      {/* Add Account Form */}
      {console.log('BankAccountManagement: Checking form render, isAddingAccount =', isAddingAccount)}
      {isAddingAccount && (
        <div style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1.5rem',
          marginBottom: '2rem'
        }}>
          <h4 style={{
            margin: '0 0 1.5rem 0',
            fontSize: '1.1rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Add New Bank Account
          </h4>

          <form onSubmit={handleAddAccount}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem'
            }}>
              <div>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  Bank *
                </label>
                <select
                  value={newAccount.bankId}
                  onChange={(e) => setNewAccount({ ...newAccount, bankId: e.target.value })}
                  required
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
                >
                  <option value="">Select a bank...</option>
                  {banks.map(bank => (
                    <option key={bank._id} value={bank._id}>
                      {bank.name} - {bank.city}, {bank.country}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  Account Number *
                </label>
                <input
                  type="text"
                  value={newAccount.accountNumber}
                  onChange={(e) => setNewAccount({ ...newAccount, accountNumber: e.target.value })}
                  required
                  placeholder="Enter account number"
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
                <label style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  Reference Currency
                </label>
                <select
                  value={newAccount.referenceCurrency}
                  onChange={(e) => setNewAccount({ ...newAccount, referenceCurrency: e.target.value })}
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
                >
                  {currencies.map(currency => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'flex-end'
            }}>
              <button
                type="button"
                onClick={() => {
                  setIsAddingAccount(false);
                  setNewAccount({ bankId: '', accountNumber: '', referenceCurrency: 'USD' });
                  setError('');
                }}
                style={{
                  padding: '10px 20px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                style={{
                  padding: '10px 20px',
                  background: isLoading ? 'var(--text-muted)' : 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600'
                }}
              >
                {isLoading ? 'Adding...' : 'Add Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bank Accounts List */}
      {bankAccounts.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          background: 'var(--bg-primary)',
          borderRadius: '8px',
          border: '2px dashed var(--border-color)'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>🏦</div>
          <h4 style={{
            margin: '0 0 1rem 0',
            color: 'var(--text-secondary)',
            fontSize: '1.1rem'
          }}>
            No bank accounts added yet
          </h4>
          <p style={{
            margin: '0 0 1.5rem 0',
            color: 'var(--text-muted)',
            fontSize: '0.9rem'
          }}>
            Add your bank accounts to manage your financial information
          </p>
          <button
            onClick={() => {
              console.log('BankAccountManagement: "Add Your First Account" button clicked');
              setIsAddingAccount(true);
            }}
            style={{
              background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Add Your First Account
          </button>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gap: '1rem'
        }}>
          {bankAccounts.map((account) => {
            const bankInfo = getBankInfo(account.bankId);
            return (
              <div
                key={account._id}
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '1.5rem',
                  transition: 'all 0.3s ease'
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: '1rem',
                      marginBottom: '1rem'
                    }}>
                      <div>
                        <div style={{
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '4px'
                        }}>
                          Bank
                        </div>
                        <div style={{
                          fontSize: '1rem',
                          color: 'var(--text-primary)',
                          fontWeight: '600'
                        }}>
                          {bankInfo ? bankInfo.name : 'Unknown Bank'}
                        </div>
                        {bankInfo && (
                          <div style={{
                            fontSize: '0.85rem',
                            color: 'var(--text-secondary)'
                          }}>
                            {bankInfo.city}, {bankInfo.country}
                          </div>
                        )}
                      </div>

                      <div>
                        <div style={{
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '4px'
                        }}>
                          Account Number
                        </div>
                        <div style={{
                          fontSize: '1rem',
                          color: 'var(--text-primary)',
                          fontWeight: '500',
                          fontFamily: 'monospace'
                        }}>
                          {account.accountNumber}
                        </div>
                      </div>

                      <div>
                        <div style={{
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '4px'
                        }}>
                          Currency
                        </div>
                        <div style={{
                          fontSize: '1rem',
                          color: 'var(--text-primary)',
                          fontWeight: '600'
                        }}>
                          {account.referenceCurrency}
                        </div>
                      </div>

                      <div>
                        <div style={{
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '4px'
                        }}>
                          Added
                        </div>
                        <div style={{
                          fontSize: '0.9rem',
                          color: 'var(--text-secondary)'
                        }}>
                          {account.createdAt ? new Date(account.createdAt).toLocaleDateString() : 'Unknown'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleRemoveAccount(account._id)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--danger-color)',
                      color: 'var(--danger-color)',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      marginLeft: '1rem'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = 'var(--danger-color)';
                      e.target.style.color = 'white';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'none';
                      e.target.style.color = 'var(--danger-color)';
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {/* Global Dialog Component */}
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
      >
        {dialogState.children}
      </Dialog>
    </div>
  );
};

export default BankAccountManagement;