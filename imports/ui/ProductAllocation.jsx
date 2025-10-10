import React, { useState, useEffect } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';

const ProductAllocation = ({ product, user, onClose }) => {
  // Form state for adding new allocation
  const [currentForm, setCurrentForm] = useState({
    clientId: '',
    bankAccountId: '',
    nominalInvested: '',
    purchasePrice: '100'
  });
  
  // Table of allocations to be validated
  const [allocationsBatch, setAllocationsBatch] = useState([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Subscribe to users, bank accounts, and banks with loading status
  const usersLoading = useSubscribe('customUsers');
  const bankAccountsLoading = useSubscribe('allBankAccounts');
  const banksLoading = useSubscribe('banks');
  
  // Check if subscriptions are actually loading or just not ready
  const isActuallyLoading = usersLoading === null || bankAccountsLoading === null || banksLoading === null;

  // Get all client users
  const clients = useFind(() => 
    UsersCollection.find({ role: USER_ROLES.CLIENT }, { sort: { 'profile.lastName': 1, 'profile.firstName': 1 } })
  );

  // Get all banks for display
  const banks = useFind(() => BanksCollection.find());
  const banksById = {};
  banks.forEach(bank => { banksById[bank._id] = bank; });

  // Get all bank accounts
  const allBankAccounts = useFind(() => BankAccountsCollection.find({ isActive: true }));

  // Group bank accounts by user
  const bankAccountsByUser = {};
  allBankAccounts.forEach(account => {
    if (!bankAccountsByUser[account.userId]) {
      bankAccountsByUser[account.userId] = [];
    }
    bankAccountsByUser[account.userId].push(account);
  });


  // Add allocation to batch table
  const addToBatch = () => {
    // Validate form
    if (!currentForm.clientId) {
      setError('Please select a client');
      return;
    }
    if (!currentForm.bankAccountId) {
      setError('Please select a bank account');
      return;
    }
    if (!currentForm.nominalInvested || currentForm.nominalInvested <= 0) {
      setError('Please enter a valid nominal invested amount');
      return;
    }
    if (!currentForm.purchasePrice || currentForm.purchasePrice <= 0) {
      setError('Please enter a valid purchase price');
      return;
    }

    // Add to batch
    const newAllocation = {
      id: Date.now(),
      ...currentForm,
      nominalInvested: parseFloat(currentForm.nominalInvested),
      purchasePrice: parseFloat(currentForm.purchasePrice)
    };
    
    setAllocationsBatch([...allocationsBatch, newAllocation]);
    
    // Reset form
    setCurrentForm({
      clientId: '',
      bankAccountId: '',
      nominalInvested: '',
      purchasePrice: '100'
    });
    setError('');
  };

  // Remove allocation from batch
  const removeFromBatch = (id) => {
    setAllocationsBatch(allocationsBatch.filter(alloc => alloc.id !== id));
  };

  // Update form field
  const updateForm = (field, value) => {
    setCurrentForm({ ...currentForm, [field]: value });
    if (field === 'clientId') {
      setCurrentForm({ ...currentForm, clientId: value, bankAccountId: '' });
    }
  };

  // Handle form submission
  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      if (allocationsBatch.length === 0) {
        throw new Error('Please add at least one allocation to the batch');
      }

      // Get sessionId from localStorage for authentication
      const sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        throw new Error('Please log in to create allocations');
      }

      // Call server method to save allocations
      await Meteor.callAsync('allocations.create', {
        productId: product._id,
        allocations: allocationsBatch.map(alloc => ({
          clientId: alloc.clientId,
          bankAccountId: alloc.bankAccountId,
          nominalInvested: alloc.nominalInvested,
          purchasePrice: alloc.purchasePrice
        })),
        sessionId
      });

      setSuccess('Allocations saved successfully!');
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Error saving allocations');
    } finally {
      setIsLoading(false);
    }
  };


  // Show loading only for the first few seconds, then show the modal anyway
  const [forceShow, setForceShow] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setForceShow(true);
    }, 1000); // Show modal after 1 second regardless of loading state
    
    return () => clearTimeout(timer);
  }, []);

  // Don't show loading if we have any data, even if subscriptions aren't "ready"
  const hasData = clients.length > 0 || banks.length > 0 || allBankAccounts.length > 0;
  const shouldShowLoading = isActuallyLoading && !forceShow && !hasData;

  if (shouldShowLoading) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}>
        <div style={{
          background: 'var(--bg-primary)',
          borderRadius: '8px',
          padding: '24px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '4px solid var(--border-color)',
            borderTop: '4px solid var(--accent-color)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }}></div>
          <p>Loading client data...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    }}>
      <div 
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-primary)',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '90%',
          width: '900px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
          position: 'relative',
          zIndex: 10001
        }}>
        <h2 style={{ marginTop: 0, marginBottom: '16px' }}>
          Allocate Product: {product.title}
        </h2>
        
        {product.isin && (
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
            ISIN: {product.isin}
          </p>
        )}

        {error && (
          <div style={{
            background: 'rgba(220, 53, 69, 0.1)',
            border: '1px solid rgba(220, 53, 69, 0.3)',
            borderRadius: '4px',
            padding: '12px',
            marginBottom: '16px',
            color: 'var(--error-color, #dc3545)'
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            background: 'rgba(40, 167, 69, 0.1)',
            border: '1px solid rgba(40, 167, 69, 0.3)',
            borderRadius: '4px',
            padding: '12px',
            marginBottom: '16px',
            color: 'var(--success-color, #28a745)'
          }}>
            {success}
          </div>
        )}

        {/* Allocation Form */}
        <div style={{ marginBottom: '24px' }}>
          <h3>Add New Allocation</h3>
          <div style={{
            background: 'var(--bg-secondary)',
            padding: '20px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              {/* Client Selection */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', fontWeight: '500' }}>
                  Client
                </label>
                <select
                  value={currentForm.clientId}
                  onChange={(e) => updateForm('clientId', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem'
                  }}
                >
                  <option value="">Select a client...</option>
                  {clients.map(client => (
                    <option key={client._id} value={client._id}>
                      {client.profile?.firstName} {client.profile?.lastName} ({client.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Bank Account Selection */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', fontWeight: '500' }}>
                  Bank Account
                </label>
                <select
                  value={currentForm.bankAccountId}
                  onChange={(e) => updateForm('bankAccountId', e.target.value)}
                  disabled={!currentForm.clientId}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: currentForm.clientId ? 'var(--bg-primary)' : 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                    cursor: currentForm.clientId ? 'pointer' : 'not-allowed'
                  }}
                >
                  <option value="">
                    {currentForm.clientId 
                      ? (bankAccountsByUser[currentForm.clientId]?.length > 0 
                          ? 'Select a bank account...' 
                          : 'No bank accounts available')
                      : 'Select a client first...'}
                  </option>
                  {currentForm.clientId && bankAccountsByUser[currentForm.clientId]?.map(account => {
                    const bank = banksById[account.bankId];
                    return (
                      <option key={account._id} value={account._id}>
                        {bank?.name || 'Unknown Bank'} - {account.accountNumber} ({account.referenceCurrency})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Nominal Invested */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', fontWeight: '500' }}>
                  Nominal Invested
                </label>
                <input
                  type="number"
                  value={currentForm.nominalInvested}
                  onChange={(e) => updateForm('nominalInvested', e.target.value)}
                  placeholder="Enter amount"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem'
                  }}
                />
              </div>

              {/* Purchase Price */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.9rem', fontWeight: '500' }}>
                  Purchase Price (%)
                </label>
                <input
                  type="number"
                  value={currentForm.purchasePrice}
                  onChange={(e) => updateForm('purchasePrice', e.target.value)}
                  placeholder="100"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem'
                  }}
                />
              </div>
            </div>

            <button
              onClick={addToBatch}
              style={{
                padding: '10px 20px',
                background: 'var(--info-color, #3b82f6)',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: '500'
              }}
            >
              + Add to Batch
            </button>
          </div>
        </div>

        {/* Allocations Batch Table */}
        <div style={{ marginBottom: '20px' }}>
          <h3>Allocation Batch ({allocationsBatch.length} items)</h3>
          {allocationsBatch.length === 0 ? (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              background: 'var(--bg-secondary)',
              borderRadius: '6px',
              border: '1px dashed var(--border-color)'
            }}>
              No allocations added yet. Use the form above to add allocations to the batch.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                background: 'var(--bg-primary)',
                borderRadius: '6px',
                overflow: 'hidden'
              }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Client</th>
                    <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Bank Account</th>
                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid var(--border-color)' }}>Amount</th>
                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid var(--border-color)' }}>Price (%)</th>
                    <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationsBatch.map((allocation, index) => {
                    const client = clients.find(c => c._id === allocation.clientId);
                    const account = allBankAccounts.find(a => a._id === allocation.bankAccountId);
                    const bank = banksById[account?.bankId];
                    
                    return (
                      <tr key={allocation.id} style={{ borderBottom: index < allocationsBatch.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                        <td style={{ padding: '12px' }}>
                          {client?.profile?.firstName} {client?.profile?.lastName}
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {client?.email}
                          </div>
                        </td>
                        <td style={{ padding: '12px' }}>
                          {bank?.name || 'Unknown Bank'}
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {account?.accountNumber} ({account?.referenceCurrency})
                          </div>
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: '600' }}>
                          {allocation.nominalInvested.toLocaleString()}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          {allocation.purchasePrice}%
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <button
                            onClick={() => removeFromBatch(allocation.id)}
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--error-color, #dc3545)',
                              color: 'var(--error-color, #dc3545)',
                              borderRadius: '4px',
                              padding: '4px 8px',
                              cursor: 'pointer',
                              fontSize: '0.8rem'
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: '500'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || allocationsBatch.length === 0}
            style={{
              padding: '12px 24px',
              background: isLoading ? 'var(--text-muted)' : allocationsBatch.length === 0 ? 'var(--text-muted)' : 'var(--success-color, #28a745)',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: isLoading || allocationsBatch.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              fontWeight: '600'
            }}
          >
            {isLoading ? 'Validating Batch...' : allocationsBatch.length === 0 ? 'Add Allocations to Validate' : `Validate Batch (${allocationsBatch.length} items)`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductAllocation;