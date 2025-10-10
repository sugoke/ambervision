// Portfolio Header Component
// Header section with title, actions, and status information

import React from 'react';
import { formatNumber } from '../../../utils/currencyUtils.js';

const PortfolioHeader = ({ 
  user, 
  isUpdatingPrices, 
  lastPriceUpdate, 
  onRefreshPrices, 
  onAddStock, 
  onCsvUpload 
}) => {
  return (
    <div className="portfolio-header">
      <div className="header-content">
        {/* Title Section */}
        <div className="header-title">
          <h1 className="portfolio-title">
            📊 Direct Equity Portfolio
          </h1>
          <p className="portfolio-subtitle">
            Manage your direct equity holdings and track performance
          </p>
        </div>

        {/* Actions Section */}
        <div className="header-actions">
          <div className="action-buttons">
            {/* Add Stock Button */}
            <button
              className="action-btn primary add-stock-btn"
              onClick={onAddStock}
              title="Add new stock position"
            >
              <span className="btn-icon">📈</span>
              <span className="btn-text">Add Stock</span>
            </button>

            {/* CSV Upload Button */}
            <button
              className="action-btn secondary csv-upload-btn"
              onClick={onCsvUpload}
              title="Upload holdings from CSV file"
            >
              <span className="btn-icon">📄</span>
              <span className="btn-text">Import CSV</span>
            </button>

            {/* Refresh Prices Button */}
            <button
              className={`action-btn secondary refresh-btn ${isUpdatingPrices ? 'loading' : ''}`}
              onClick={onRefreshPrices}
              disabled={isUpdatingPrices}
              title="Refresh market prices"
            >
              <span className={`btn-icon ${isUpdatingPrices ? 'spinning' : ''}`}>
                {isUpdatingPrices ? '🔄' : '🔄'}
              </span>
              <span className="btn-text">
                {isUpdatingPrices ? 'Updating...' : 'Refresh Prices'}
              </span>
            </button>
          </div>

          {/* Price Update Status */}
          <div className="price-update-status">
            {lastPriceUpdate && (
              <div className="last-update-info">
                <span className="update-icon">⏱️</span>
                <span className="update-text">
                  Last updated: {lastPriceUpdate.toLocaleTimeString()}
                </span>
              </div>
            )}
            
            {isUpdatingPrices && (
              <div className="updating-indicator">
                <span className="loading-dot"></span>
                <span className="loading-dot"></span>
                <span className="loading-dot"></span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Market Status Bar */}
      <div className="market-status-bar">
        <div className="status-item">
          <span className="status-icon">🕒</span>
          <span className="status-text">Market Status: Open</span>
        </div>
        <div className="status-item">
          <span className="status-icon">📡</span>
          <span className="status-text">Real-time Data</span>
        </div>
        <div className="status-item">
          <span className="status-icon">💰</span>
          <span className="status-text">Multi-Currency Support</span>
        </div>
      </div>

      {/* User Info */}
      {user && (
        <div className="user-context">
          <span className="user-welcome">
            Welcome, {user.profile?.firstName || user.email || 'User'}
          </span>
        </div>
      )}

      <style jsx>{`
        .portfolio-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 2rem;
          border-radius: 12px;
          margin-bottom: 2rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .header-content {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1.5rem;
        }

        .header-title {
          flex: 1;
        }

        .portfolio-title {
          margin: 0 0 0.5rem 0;
          font-size: 2rem;
          font-weight: 700;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .portfolio-subtitle {
          margin: 0;
          font-size: 1.1rem;
          opacity: 0.9;
          font-weight: 400;
        }

        .header-actions {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 1rem;
        }

        .action-buttons {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .action-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.25rem;
          border: none;
          border-radius: 8px;
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .action-btn.primary {
          background: rgba(255, 255, 255, 0.2);
          color: white;
          border: 2px solid rgba(255, 255, 255, 0.3);
        }

        .action-btn.primary:hover {
          background: rgba(255, 255, 255, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }

        .action-btn.secondary {
          background: rgba(255, 255, 255, 0.1);
          color: white;
          border: 2px solid rgba(255, 255, 255, 0.2);
        }

        .action-btn.secondary:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .action-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none !important;
        }

        .action-btn.loading .btn-icon {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .price-update-status {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.5rem;
        }

        .last-update-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
          opacity: 0.8;
        }

        .updating-indicator {
          display: flex;
          gap: 0.25rem;
        }

        .loading-dot {
          width: 6px;
          height: 6px;
          background: white;
          border-radius: 50%;
          animation: loading-pulse 1.5s infinite;
        }

        .loading-dot:nth-child(2) {
          animation-delay: 0.2s;
        }

        .loading-dot:nth-child(3) {
          animation-delay: 0.4s;
        }

        @keyframes loading-pulse {
          0%, 80%, 100% { opacity: 0.3; }
          40% { opacity: 1; }
        }

        .market-status-bar {
          display: flex;
          gap: 2rem;
          padding: 1rem 0;
          border-top: 1px solid rgba(255, 255, 255, 0.2);
          border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }

        .status-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
          opacity: 0.9;
        }

        .user-context {
          text-align: right;
          margin-top: 1rem;
          font-size: 0.9rem;
          opacity: 0.8;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
          .portfolio-header {
            padding: 1.5rem;
          }

          .header-content {
            flex-direction: column;
            gap: 1.5rem;
          }

          .header-actions {
            align-items: flex-start;
            width: 100%;
          }

          .action-buttons {
            width: 100%;
            justify-content: flex-start;
          }

          .market-status-bar {
            flex-direction: column;
            gap: 0.5rem;
          }

          .portfolio-title {
            font-size: 1.5rem;
          }

          .portfolio-subtitle {
            font-size: 1rem;
          }
        }
      `}</style>
    </div>
  );
};

export default PortfolioHeader;