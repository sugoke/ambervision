// Account Selector Component
// Dropdown to select which bank account to view

import React from 'react';

const AccountSelector = ({ 
  bankAccounts, 
  selectedBankAccountId, 
  onAccountChange, 
  getAccountDisplayInfo 
}) => {
  if (!bankAccounts || bankAccounts.length === 0) {
    return null;
  }

  return (
    <div className="account-selector-container">
      <div className="account-selector-header">
        <h3 className="selector-title">
          <span className="selector-icon">🏦</span>
          Select Account
        </h3>
        <p className="selector-description">
          Choose which bank account to view holdings for
        </p>
      </div>

      <div className="account-selector">
        <select
          value={selectedBankAccountId || ''}
          onChange={(e) => onAccountChange(e.target.value)}
          className="account-dropdown"
        >
          <option value="" disabled>
            Choose an account...
          </option>
          {bankAccounts.map(account => {
            const { displayName, clientName } = getAccountDisplayInfo(account);
            return (
              <option key={account._id} value={account._id}>
                {displayName}
              </option>
            );
          })}
        </select>

        {/* Account Info Display */}
        {selectedBankAccountId && (
          <div className="selected-account-info">
            {(() => {
              const selectedAccount = bankAccounts.find(acc => acc._id === selectedBankAccountId);
              if (!selectedAccount) return null;
              
              const { displayName, clientName } = getAccountDisplayInfo(selectedAccount);
              return (
                <div className="account-details">
                  <div className="account-detail-item">
                    <span className="detail-label">Client:</span>
                    <span className="detail-value">{clientName}</span>
                  </div>
                  <div className="account-detail-item">
                    <span className="detail-label">Account:</span>
                    <span className="detail-value">{selectedAccount.accountNumber || 'N/A'}</span>
                  </div>
                  <div className="account-detail-item">
                    <span className="detail-label">Currency:</span>
                    <span className="detail-value">{selectedAccount.referenceCurrency || 'USD'}</span>
                  </div>
                  <div className="account-detail-item">
                    <span className="detail-label">Type:</span>
                    <span className="detail-value">{selectedAccount.accountType || 'Investment'}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <style jsx>{`
        .account-selector-container {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 1.5rem;
          margin-bottom: 2rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        .account-selector-header {
          margin-bottom: 1.5rem;
        }

        .selector-title {
          margin: 0 0 0.5rem 0;
          font-size: 1.25rem;
          font-weight: 600;
          color: #1f2937;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .selector-icon {
          font-size: 1.5rem;
        }

        .selector-description {
          margin: 0;
          color: #6b7280;
          font-size: 0.9rem;
        }

        .account-selector {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .account-dropdown {
          width: 100%;
          padding: 0.75rem 1rem;
          border: 2px solid #d1d5db;
          border-radius: 8px;
          font-size: 1rem;
          color: #1f2937;
          background: white;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .account-dropdown:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .account-dropdown:hover {
          border-color: #9ca3af;
        }

        .selected-account-info {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1rem;
        }

        .account-details {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }

        .account-detail-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem;
          background: white;
          border-radius: 6px;
          border: 1px solid #e5e7eb;
        }

        .detail-label {
          font-size: 0.8rem;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .detail-value {
          font-size: 0.9rem;
          font-weight: 500;
          color: #1f2937;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
          .account-selector-container {
            padding: 1rem;
          }

          .account-details {
            grid-template-columns: 1fr;
          }

          .account-detail-item {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.25rem;
          }
        }
      `}</style>
    </div>
  );
};

export default AccountSelector;