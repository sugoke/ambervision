// Transaction Modals Component
// Manages all transaction-related modals (add, modify, remove, details)

import React from 'react';
import AddStockModal from '../AddStockModal.jsx';
import Modal from '../common/Modal.jsx';
import { formatCurrency, formatNumber } from '../../../utils/currencyUtils.js';

const TransactionModals = ({
  // Add Stock Modal
  isAddStockModalOpen,
  onCloseAddStockModal,
  selectedBankAccount,
  
  // Stock Details Modal
  selectedStock,
  stockDetails,
  onCloseStockDetails,
  
  // Modify Holding Modal
  modifyHolding,
  onCloseModifyHolding,
  
  // Remove Holding Confirmation
  confirmRemoveHolding,
  onConfirmRemoveHolding,
  onCancelRemoveHolding,
  
  // Shared props
  exchangeRates,
  onRefreshData
}) => {

  return (
    <>
      {/* Add Stock Modal */}
      {isAddStockModalOpen && (
        <AddStockModal
          isOpen={isAddStockModalOpen}
          onClose={onCloseAddStockModal}
          bankAccount={selectedBankAccount}
          onStockAdded={() => {
            onCloseAddStockModal();
            onRefreshData();
          }}
        />
      )}

      {/* Stock Details Modal */}
      {selectedStock && stockDetails && (
        <Modal
          isOpen={true}
          onClose={onCloseStockDetails}
          title={`Stock Details: ${stockDetails.symbol}`}
          size="large"
        >
          <div className="stock-details-content">
            {/* Stock Header */}
            <div className="stock-header">
              <div className="stock-info">
                <h3 className="stock-symbol">{stockDetails.symbol}</h3>
                <p className="stock-ticker">{stockDetails.fullTicker}</p>
              </div>
              <div className="stock-price">
                <div className="current-price">
                  {formatCurrency(stockDetails.currentPrice || 0)}
                </div>
                <div className="price-change">
                  {/* Price change would be calculated here */}
                </div>
              </div>
            </div>

            {/* Position Details */}
            <div className="position-details">
              <div className="detail-grid">
                <div className="detail-item">
                  <label>Quantity:</label>
                  <span>{formatNumber(stockDetails.quantity || 0, 0)} shares</span>
                </div>
                <div className="detail-item">
                  <label>Average Price:</label>
                  <span>{formatCurrency(stockDetails.averagePrice || 0)}</span>
                </div>
                <div className="detail-item">
                  <label>Current Price:</label>
                  <span>{formatCurrency(stockDetails.currentPrice || 0)}</span>
                </div>
                <div className="detail-item">
                  <label>Market Value:</label>
                  <span>{formatCurrency((stockDetails.quantity || 0) * (stockDetails.currentPrice || 0))}</span>
                </div>
                <div className="detail-item">
                  <label>Cost Basis:</label>
                  <span>{formatCurrency((stockDetails.quantity || 0) * (stockDetails.averagePrice || 0))}</span>
                </div>
                <div className="detail-item">
                  <label>Unrealized P&L:</label>
                  <span className={`pnl ${((stockDetails.currentPrice || 0) - (stockDetails.averagePrice || 0)) >= 0 ? 'positive' : 'negative'}`}>
                    {formatCurrency((stockDetails.quantity || 0) * ((stockDetails.currentPrice || 0) - (stockDetails.averagePrice || 0)))}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="stock-actions">
              <button
                className="action-btn modify"
                onClick={() => {
                  onCloseStockDetails();
                  // Set modify holding state
                }}
              >
                ✏️ Modify Position
              </button>
              <button
                className="action-btn sell"
                onClick={() => {
                  onCloseStockDetails();
                  // Open sell modal
                }}
              >
                📉 Sell Shares
              </button>
            </div>
          </div>

          <style jsx>{`
            .stock-details-content {
              padding: 1rem;
            }

            .stock-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 1.5rem;
              background: #f9fafb;
              border-radius: 8px;
              margin-bottom: 2rem;
            }

            .stock-symbol {
              margin: 0;
              font-size: 1.5rem;
              font-weight: 700;
              color: #1f2937;
            }

            .stock-ticker {
              margin: 0;
              color: #6b7280;
              font-size: 0.9rem;
            }

            .current-price {
              font-size: 1.25rem;
              font-weight: 600;
              color: #1f2937;
              text-align: right;
            }

            .detail-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 1rem;
              margin-bottom: 2rem;
            }

            .detail-item {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 0.75rem;
              background: #f9fafb;
              border-radius: 6px;
              border: 1px solid #e5e7eb;
            }

            .detail-item label {
              font-weight: 600;
              color: #6b7280;
              font-size: 0.9rem;
            }

            .detail-item span {
              font-weight: 500;
              color: #1f2937;
            }

            .pnl.positive {
              color: #10b981;
            }

            .pnl.negative {
              color: #ef4444;
            }

            .stock-actions {
              display: flex;
              gap: 1rem;
              justify-content: center;
            }

            .action-btn {
              padding: 0.75rem 1.5rem;
              border: none;
              border-radius: 6px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s ease;
            }

            .action-btn.modify {
              background: #3b82f6;
              color: white;
            }

            .action-btn.modify:hover {
              background: #2563eb;
            }

            .action-btn.sell {
              background: #ef4444;
              color: white;
            }

            .action-btn.sell:hover {
              background: #dc2626;
            }

            @media (max-width: 768px) {
              .detail-grid {
                grid-template-columns: 1fr;
              }

              .stock-header {
                flex-direction: column;
                gap: 1rem;
                text-align: center;
              }

              .stock-actions {
                flex-direction: column;
              }
            }
          `}</style>
        </Modal>
      )}

      {/* Remove Holding Confirmation Modal */}
      {confirmRemoveHolding && (
        <Modal
          isOpen={true}
          onClose={onCancelRemoveHolding}
          title="Confirm Remove Holding"
          size="small"
        >
          <div className="remove-confirmation">
            <div className="warning-icon">⚠️</div>
            <p className="warning-message">
              Are you sure you want to remove the following holding?
            </p>
            <div className="holding-info">
              <strong>{confirmRemoveHolding.holdingName}</strong>
            </div>
            <p className="warning-note">
              This action cannot be undone. The holding will be permanently deleted.
            </p>
            
            <div className="confirmation-actions">
              <button
                className="confirm-btn cancel"
                onClick={onCancelRemoveHolding}
              >
                Cancel
              </button>
              <button
                className="confirm-btn remove"
                onClick={onConfirmRemoveHolding}
              >
                Remove Holding
              </button>
            </div>
          </div>

          <style jsx>{`
            .remove-confirmation {
              padding: 1rem;
              text-align: center;
            }

            .warning-icon {
              font-size: 3rem;
              margin-bottom: 1rem;
            }

            .warning-message {
              font-size: 1.1rem;
              color: #374151;
              margin-bottom: 1rem;
            }

            .holding-info {
              background: #fef3c7;
              padding: 1rem;
              border-radius: 8px;
              margin: 1rem 0;
              color: #92400e;
            }

            .warning-note {
              font-size: 0.9rem;
              color: #6b7280;
              margin-bottom: 2rem;
            }

            .confirmation-actions {
              display: flex;
              gap: 1rem;
              justify-content: center;
            }

            .confirm-btn {
              padding: 0.75rem 1.5rem;
              border: none;
              border-radius: 6px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s ease;
            }

            .confirm-btn.cancel {
              background: #6b7280;
              color: white;
            }

            .confirm-btn.cancel:hover {
              background: #4b5563;
            }

            .confirm-btn.remove {
              background: #ef4444;
              color: white;
            }

            .confirm-btn.remove:hover {
              background: #dc2626;
            }
          `}</style>
        </Modal>
      )}

      {/* Modify Holding Modal */}
      {modifyHolding && (
        <Modal
          isOpen={true}
          onClose={onCloseModifyHolding}
          title={`Modify Position: ${modifyHolding.symbol}`}
          size="medium"
        >
          <div className="modify-holding-content">
            <p>Modify holding functionality would go here...</p>
            {/* This would contain a form to modify the holding */}
            
            <div className="modify-actions">
              <button
                className="action-btn cancel"
                onClick={onCloseModifyHolding}
              >
                Cancel
              </button>
              <button
                className="action-btn save"
                onClick={() => {
                  // Save changes
                  onCloseModifyHolding();
                  onRefreshData();
                }}
              >
                Save Changes
              </button>
            </div>
          </div>

          <style jsx>{`
            .modify-holding-content {
              padding: 1rem;
            }

            .modify-actions {
              display: flex;
              gap: 1rem;
              justify-content: flex-end;
              margin-top: 2rem;
            }

            .action-btn.cancel {
              background: #6b7280;
              color: white;
              padding: 0.75rem 1.5rem;
              border: none;
              border-radius: 6px;
              cursor: pointer;
            }

            .action-btn.save {
              background: #10b981;
              color: white;
              padding: 0.75rem 1.5rem;
              border: none;
              border-radius: 6px;
              cursor: pointer;
            }
          `}</style>
        </Modal>
      )}
    </>
  );
};

export default TransactionModals;