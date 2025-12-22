import React, { useState, useEffect } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { AllocationsCollection } from '/imports/api/allocations';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';

const ProductAllocation = ({ product, user, onClose }) => {
  // Form state for adding new allocation
  const [currentForm, setCurrentForm] = useState({
    clientId: '',
    bankAccountId: '',
    nominalInvested: '',
    purchasePrice: '100.00'
  });

  // Table of allocations to be validated
  const [allocationsBatch, setAllocationsBatch] = useState([]);

  // State for editing existing positions
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSyncingHoldings, setIsSyncingHoldings] = useState(false);

  // Subscribe to users, bank accounts, banks, and existing allocations
  const usersLoading = useSubscribe('customUsers');
  const bankAccountsLoading = useSubscribe('allBankAccounts');
  const banksLoading = useSubscribe('banks');
  const allocationsLoading = useSubscribe('productAllocations', product._id);

  // Check if subscriptions are actually loading or just not ready
  const isActuallyLoading = usersLoading === null || bankAccountsLoading === null ||
                            banksLoading === null || allocationsLoading === null;

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

  // Get existing allocations for this product
  const existingAllocations = useFind(() =>
    AllocationsCollection.find({ productId: product._id, status: 'active' }, { sort: { allocatedAt: -1 } })
  );

  // Get all linked holdings for allocations (fetched at component level to avoid hooks in loops)
  const allLinkedHoldings = useFind(() =>
    PMSHoldingsCollection.find({
      $or: [
        { linkedAllocationId: { $exists: true, $ne: null } },
        { _id: { $in: existingAllocations.flatMap(a => a.linkedHoldingIds || []) } }
      ],
      isActive: true
    })
  );

  // Group bank accounts by user
  const bankAccountsByUser = {};
  allBankAccounts.forEach(account => {
    if (!bankAccountsByUser[account.userId]) {
      bankAccountsByUser[account.userId] = [];
    }
    bankAccountsByUser[account.userId].push(account);
  });

  // Helper function to format number with 2 decimals
  const formatNumber = (value) => {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00';
    return num.toFixed(2);
  };

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
    if (!currentForm.nominalInvested || parseFloat(currentForm.nominalInvested) <= 0) {
      setError('Please enter a valid nominal invested amount');
      return;
    }
    if (!currentForm.purchasePrice || parseFloat(currentForm.purchasePrice) <= 0) {
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
      purchasePrice: '100.00'
    });
    setError('');
  };

  // Remove allocation from batch
  const removeFromBatch = (id) => {
    setAllocationsBatch(allocationsBatch.filter(alloc => alloc.id !== id));
  };

  // Update form field
  const updateForm = (field, value) => {
    if (field === 'clientId') {
      setCurrentForm({ ...currentForm, clientId: value, bankAccountId: '' });
    } else if (field === 'nominalInvested' || field === 'purchasePrice') {
      // Allow decimal input
      setCurrentForm({ ...currentForm, [field]: value });
    } else {
      setCurrentForm({ ...currentForm, [field]: value });
    }
  };

  // Handle form submission (create new allocations)
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
      setAllocationsBatch([]);
      setTimeout(() => {
        setSuccess('');
      }, 3000);
    } catch (err) {
      setError(err.message || 'Error saving allocations');
    } finally {
      setIsLoading(false);
    }
  };

  // Start editing an existing allocation
  const startEdit = (allocation) => {
    setEditingId(allocation._id);
    setEditForm({
      clientId: allocation.clientId,
      bankAccountId: allocation.bankAccountId,
      nominalInvested: formatNumber(allocation.nominalInvested),
      purchasePrice: formatNumber(allocation.purchasePrice)
    });
  };

  // Cancel editing
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  // Save edited allocation
  const saveEdit = async (allocationId) => {
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      const sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        throw new Error('Please log in to update allocations');
      }

      // Prepare updates
      const updates = {
        nominalInvested: parseFloat(editForm.nominalInvested),
        purchasePrice: parseFloat(editForm.purchasePrice),
        clientId: editForm.clientId,
        bankAccountId: editForm.bankAccountId
      };

      // Validate
      if (updates.nominalInvested <= 0) {
        throw new Error('Nominal invested must be greater than 0');
      }
      if (updates.purchasePrice <= 0) {
        throw new Error('Purchase price must be greater than 0');
      }

      await Meteor.callAsync('allocations.update', {
        allocationId,
        updates,
        sessionId
      });

      setSuccess('Allocation updated successfully!');
      setEditingId(null);
      setEditForm({});
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Error updating allocation');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete allocation
  const deleteAllocation = async (allocationId) => {
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      const sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        throw new Error('Please log in to delete allocations');
      }

      await Meteor.callAsync('allocations.delete', {
        allocationId,
        sessionId
      });

      setSuccess('Allocation deleted successfully!');
      setDeleteConfirmId(null);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Error deleting allocation');
    } finally {
      setIsLoading(false);
    }
  };

  // Sync allocation with bank holdings
  const syncAllocationHoldings = async (allocationId) => {
    setError('');
    setSuccess('');
    setIsSyncingHoldings(true);

    try {
      const result = await Meteor.callAsync('allocations.syncWithHoldings', {
        allocationId
      });

      setSuccess(`Synced with ${result.holdingsCount} bank position(s)!`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Error syncing holdings');
    } finally {
      setIsSyncingHoldings(false);
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
          <p>Loading data...</p>
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
          maxWidth: '95%',
          width: '1100px',
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

        {/* Current Positions Section */}
        {existingAllocations.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ marginBottom: '12px' }}>Current Positions ({existingAllocations.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                background: 'var(--bg-primary)',
                borderRadius: '6px',
                overflow: 'hidden',
                border: '1px solid var(--border-color)'
              }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Client</th>
                    <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Bank Account</th>
                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid var(--border-color)' }}>Nominal Invested</th>
                    <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid var(--border-color)' }}>Price (%)</th>
                    <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {existingAllocations.map((allocation, index) => {
                    const client = clients.find(c => c._id === allocation.clientId);
                    const account = allBankAccounts.find(a => a._id === allocation.bankAccountId);
                    const bank = banksById[account?.bankId];
                    const isEditing = editingId === allocation._id;
                    const isDeleteConfirm = deleteConfirmId === allocation._id;

                    return (
                      <tr key={allocation._id} style={{
                        borderBottom: index < existingAllocations.length - 1 ? '1px solid var(--border-color)' : 'none',
                        background: isEditing ? 'rgba(59, 130, 246, 0.05)' : 'transparent'
                      }}>
                        <td style={{ padding: '12px' }}>
                          {isEditing ? (
                            <select
                              value={editForm.clientId}
                              onChange={(e) => setEditForm({ ...editForm, clientId: e.target.value, bankAccountId: '' })}
                              style={{
                                width: '100%',
                                padding: '6px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-primary)',
                                color: 'var(--text-primary)',
                                fontSize: '0.85rem'
                              }}
                            >
                              {clients.map(c => (
                                <option key={c._id} value={c._id}>
                                  {c.profile?.firstName} {c.profile?.lastName}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <>
                              {client?.profile?.firstName} {client?.profile?.lastName}
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                {client?.email}
                              </div>
                            </>
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {isEditing ? (
                            <select
                              value={editForm.bankAccountId}
                              onChange={(e) => setEditForm({ ...editForm, bankAccountId: e.target.value })}
                              style={{
                                width: '100%',
                                padding: '6px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-primary)',
                                color: 'var(--text-primary)',
                                fontSize: '0.85rem'
                              }}
                            >
                              {bankAccountsByUser[editForm.clientId]?.map(acc => {
                                const b = banksById[acc.bankId];
                                return (
                                  <option key={acc._id} value={acc._id}>
                                    {b?.name} - {acc.accountNumber}
                                  </option>
                                );
                              })}
                            </select>
                          ) : (
                            <>
                              {bank?.name || 'Unknown Bank'}
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                {account?.accountNumber} ({account?.referenceCurrency})
                              </div>
                            </>
                          )}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontWeight: '600' }}>
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.01"
                              value={editForm.nominalInvested}
                              onChange={(e) => setEditForm({ ...editForm, nominalInvested: e.target.value })}
                              style={{
                                width: '120px',
                                padding: '6px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-primary)',
                                color: 'var(--text-primary)',
                                fontSize: '0.85rem',
                                textAlign: 'right'
                              }}
                            />
                          ) : (
                            formatNumber(allocation.nominalInvested)
                          )}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.01"
                              value={editForm.purchasePrice}
                              onChange={(e) => setEditForm({ ...editForm, purchasePrice: e.target.value })}
                              style={{
                                width: '100px',
                                padding: '6px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-primary)',
                                color: 'var(--text-primary)',
                                fontSize: '0.85rem',
                                textAlign: 'right'
                              }}
                            />
                          ) : (
                            `${formatNumber(allocation.purchasePrice)}%`
                          )}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {isEditing ? (
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button
                                onClick={() => saveEdit(allocation._id)}
                                disabled={isLoading}
                                style={{
                                  background: 'var(--success-color, #28a745)',
                                  border: 'none',
                                  color: 'white',
                                  borderRadius: '4px',
                                  padding: '4px 12px',
                                  cursor: isLoading ? 'not-allowed' : 'pointer',
                                  fontSize: '0.8rem'
                                }}
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={isLoading}
                                style={{
                                  background: 'transparent',
                                  border: '1px solid var(--border-color)',
                                  color: 'var(--text-primary)',
                                  borderRadius: '4px',
                                  padding: '4px 12px',
                                  cursor: isLoading ? 'not-allowed' : 'pointer',
                                  fontSize: '0.8rem'
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : isDeleteConfirm ? (
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.8rem', marginRight: '4px' }}>Confirm?</span>
                              <button
                                onClick={() => deleteAllocation(allocation._id)}
                                disabled={isLoading}
                                style={{
                                  background: 'var(--error-color, #dc3545)',
                                  border: 'none',
                                  color: 'white',
                                  borderRadius: '4px',
                                  padding: '4px 12px',
                                  cursor: isLoading ? 'not-allowed' : 'pointer',
                                  fontSize: '0.8rem'
                                }}
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                disabled={isLoading}
                                style={{
                                  background: 'transparent',
                                  border: '1px solid var(--border-color)',
                                  color: 'var(--text-primary)',
                                  borderRadius: '4px',
                                  padding: '4px 12px',
                                  cursor: isLoading ? 'not-allowed' : 'pointer',
                                  fontSize: '0.8rem'
                                }}
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button
                                onClick={() => startEdit(allocation)}
                                disabled={isLoading || editingId !== null}
                                style={{
                                  background: 'transparent',
                                  border: '1px solid var(--info-color, #3b82f6)',
                                  color: 'var(--info-color, #3b82f6)',
                                  borderRadius: '4px',
                                  padding: '4px 12px',
                                  cursor: (isLoading || editingId !== null) ? 'not-allowed' : 'pointer',
                                  fontSize: '0.8rem'
                                }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(allocation._id)}
                                disabled={isLoading || editingId !== null}
                                style={{
                                  background: 'transparent',
                                  border: '1px solid var(--error-color, #dc3545)',
                                  color: 'var(--error-color, #dc3545)',
                                  borderRadius: '4px',
                                  padding: '4px 12px',
                                  cursor: (isLoading || editingId !== null) ? 'not-allowed' : 'pointer',
                                  fontSize: '0.8rem'
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Bank Positions Section */}
        {existingAllocations.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🏦 Bank Positions
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '400' }}>
                (Live positions from bank accounts)
              </span>
            </h3>

            {existingAllocations.map((allocation) => {
              // Get linked holdings for this allocation (filtered from component-level query)
              const linkedHoldingIds = allocation.linkedHoldingIds || [];
              const linkedHoldings = linkedHoldingIds.length > 0
                ? allLinkedHoldings.filter(h => linkedHoldingIds.includes(h._id))
                : allLinkedHoldings.filter(h => h.linkedAllocationId === allocation._id);

              const client = clients.find(c => c._id === allocation.clientId);
              const bankAccount = allBankAccounts.find(acc => acc._id === allocation.bankAccountId);
              const bank = banksById[bankAccount?.bankId];

              if (linkedHoldings.length === 0) return null;

              return (
                <div key={allocation._id} style={{
                  background: 'var(--bg-secondary)',
                  padding: '16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  marginBottom: '12px'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                    paddingBottom: '12px',
                    borderBottom: '1px solid var(--border-color)'
                  }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '0.95rem' }}>
                        {client?.profile?.firstName} {client?.profile?.lastName}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {bank?.name} - {bankAccount?.accountNumber}
                      </div>
                    </div>
                    <button
                      onClick={() => syncAllocationHoldings(allocation._id)}
                      disabled={isSyncingHoldings}
                      style={{
                        padding: '6px 12px',
                        background: 'var(--accent-color)',
                        border: 'none',
                        borderRadius: '4px',
                        color: 'white',
                        cursor: isSyncingHoldings ? 'not-allowed' : 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: '500'
                      }}
                    >
                      {isSyncingHoldings ? '🔄 Syncing...' : '🔄 Sync Now'}
                    </button>
                  </div>

                  {/* Holdings table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <th style={{ padding: '8px', textAlign: 'left', fontWeight: '600' }}>ISIN</th>
                          <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Quantity</th>
                          <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Market Price</th>
                          <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>Market Value</th>
                          <th style={{ padding: '8px', textAlign: 'left', fontWeight: '600' }}>Last Updated</th>
                          <th style={{ padding: '8px', textAlign: 'center', fontWeight: '600' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linkedHoldings.map((holding, idx) => {
                          const isActive = holding.isActive;
                          const fileAge = holding.fileDate ?
                            Math.floor((new Date() - new Date(holding.fileDate)) / (1000 * 60 * 60 * 24)) : null;

                          return (
                            <tr key={holding._id} style={{
                              borderBottom: idx < linkedHoldings.length - 1 ? '1px solid var(--border-color)' : 'none',
                              opacity: isActive ? 1 : 0.5
                            }}>
                              <td style={{ padding: '8px' }}>
                                <div style={{ fontSize: '0.9rem', fontWeight: '500' }}>{holding.isin || 'N/A'}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                  {holding.securityName || 'Unknown Security'}
                                </div>
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
                                {holding.quantity?.toLocaleString() || '-'}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
                                {holding.marketPrice ?
                                  `${holding.marketPrice.toFixed(2)} ${holding.priceCurrency || holding.currency || ''}`
                                  : '-'}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '600' }}>
                                {holding.marketValue ?
                                  `${holding.marketValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${holding.currency || ''}`
                                  : '-'}
                              </td>
                              <td style={{ padding: '8px', fontSize: '0.8rem' }}>
                                {holding.fileDate ? new Date(holding.fileDate).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                }) : 'N/A'}
                                {fileAge !== null && (
                                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                    {fileAge === 0 ? 'Today' : `${fileAge}d ago`}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'center' }}>
                                <span style={{
                                  padding: '4px 8px',
                                  borderRadius: '12px',
                                  fontSize: '0.7rem',
                                  fontWeight: '600',
                                  background: isActive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                  color: isActive ? '#10b981' : '#ef4444'
                                }}>
                                  {isActive ? '✓ Active' : '⚠ Missing'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {allocation.holdingsSyncedAt && (
                    <div style={{
                      marginTop: '8px',
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      textAlign: 'right'
                    }}>
                      Last synced: {new Date(allocation.holdingsSyncedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  )}
                </div>
              );
            })}
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
                  step="0.01"
                  value={currentForm.nominalInvested}
                  onChange={(e) => updateForm('nominalInvested', e.target.value)}
                  placeholder="Enter amount (e.g., 10000.50)"
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
                  step="0.01"
                  value={currentForm.purchasePrice}
                  onChange={(e) => updateForm('purchasePrice', e.target.value)}
                  placeholder="100.00"
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
                          {formatNumber(allocation.nominalInvested)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          {formatNumber(allocation.purchasePrice)}%
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
            Close
          </button>
          {allocationsBatch.length > 0 && (
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              style={{
                padding: '12px 24px',
                background: isLoading ? 'var(--text-muted)' : 'var(--success-color, #28a745)',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                fontWeight: '600'
              }}
            >
              {isLoading ? 'Validating Batch...' : `Validate Batch (${allocationsBatch.length} items)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductAllocation;
