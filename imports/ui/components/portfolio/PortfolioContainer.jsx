// Portfolio Container
// Main orchestrator component for the direct equities portfolio system

import React, { useState } from 'react';
import { usePortfolioData } from '../../../hooks/usePortfolioData.js';
import PortfolioSummary from './PortfolioSummary.jsx';
import HoldingsTable from './HoldingsTable.jsx';
import TransactionModals from './TransactionModals.jsx';
import CurrencyConverter from './CurrencyConverter.jsx';
import PortfolioHeader from './PortfolioHeader.jsx';
import AccountSelector from './AccountSelector.jsx';
import CSVUploadModal from './CSVUploadModal.jsx';

const PortfolioContainer = ({ user }) => {
  // Modal state
  const [isAddStockModalOpen, setIsAddStockModalOpen] = useState(false);
  const [confirmRemoveHolding, setConfirmRemoveHolding] = useState(null);
  const [selectedStock, setSelectedStock] = useState(null);
  const [stockDetails, setStockDetails] = useState(null);
  const [modifyHolding, setModifyHolding] = useState(null);
  const [isCsvUploadModalOpen, setIsCsvUploadModalOpen] = useState(false);
  const [csvUploadLoading, setCsvUploadLoading] = useState(false);
  const [csvUploadResult, setCsvUploadResult] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [csvPreviewData, setCsvPreviewData] = useState(null);

  // Display preferences
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const [sortConfig, setSortConfig] = useState({ key: 'symbol', direction: 'asc' });
  const [filterText, setFilterText] = useState('');

  // Use portfolio data hook
  const {
    selectedBankAccountId,
    isLoading,
    isUpdatingPrices,
    lastPriceUpdate,
    collapsedAccounts,
    exchangeRates,
    ratesLoading,
    bankAccounts,
    selectedBankAccount,
    holdings,
    allHoldings,
    isDataReady,
    users,
    portfolioStats,
    setSelectedBankAccountId,
    toggleAccountCollapse,
    updateMarketPrices,
    refreshData,
    getAccountDisplayInfo
  } = usePortfolioData(user);

  // Handle sort change
  const handleSort = (key) => {
    setSortConfig(prevSort => ({
      key,
      direction: prevSort.key === key && prevSort.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Handle add stock
  const handleAddStock = () => {
    if (!selectedBankAccount) {
      alert('Please select a bank account first');
      return;
    }
    setIsAddStockModalOpen(true);
  };

  // Handle stock details
  const handleShowStockDetails = (holding) => {
    setSelectedStock(holding);
    setStockDetails({
      symbol: holding.symbol,
      fullTicker: holding.fullTicker,
      quantity: holding.quantity,
      averagePrice: holding.averagePrice,
      currentPrice: holding.currentPrice,
      // Additional details would be loaded here
    });
  };

  // Handle modify holding
  const handleModifyHolding = (holding) => {
    setModifyHolding(holding);
  };

  // Handle remove holding confirmation
  const handleRemoveHolding = (holding) => {
    setConfirmRemoveHolding({
      holdingId: holding._id,
      holdingName: `${holding.symbol} (${holding.quantity} shares)`
    });
  };

  // Handle CSV upload
  const handleCsvUpload = () => {
    setIsCsvUploadModalOpen(true);
  };

  // Show loading state
  if (isLoading || !isDataReady) {
    return (
      <div className="portfolio-loading">
        <div className="loading-spinner">🔄</div>
        <p>Loading portfolio data...</p>
      </div>
    );
  }

  return (
    <div className="portfolio-container">
      {/* Portfolio Header */}
      <PortfolioHeader
        user={user}
        isUpdatingPrices={isUpdatingPrices}
        lastPriceUpdate={lastPriceUpdate}
        onRefreshPrices={() => updateMarketPrices(true)}
        onAddStock={handleAddStock}
        onCsvUpload={handleCsvUpload}
      />

      {/* Account Selector */}
      <AccountSelector
        bankAccounts={bankAccounts}
        selectedBankAccountId={selectedBankAccountId}
        onAccountChange={setSelectedBankAccountId}
        getAccountDisplayInfo={getAccountDisplayInfo}
      />

      {/* Portfolio Summary */}
      <PortfolioSummary
        portfolioStats={portfolioStats}
        displayCurrency={displayCurrency}
        exchangeRates={exchangeRates}
        ratesLoading={ratesLoading}
      />

      {/* Currency Converter */}
      <CurrencyConverter
        displayCurrency={displayCurrency}
        onDisplayCurrencyChange={setDisplayCurrency}
        exchangeRates={exchangeRates}
        ratesLoading={ratesLoading}
      />

      {/* Holdings Table */}
      <HoldingsTable
        holdings={holdings}
        selectedBankAccount={selectedBankAccount}
        displayCurrency={displayCurrency}
        exchangeRates={exchangeRates}
        sortConfig={sortConfig}
        filterText={filterText}
        collapsedAccounts={collapsedAccounts}
        onSort={handleSort}
        onFilterChange={setFilterText}
        onToggleAccountCollapse={toggleAccountCollapse}
        onShowStockDetails={handleShowStockDetails}
        onModifyHolding={handleModifyHolding}
        onRemoveHolding={handleRemoveHolding}
        isUpdatingPrices={isUpdatingPrices}
      />

      {/* Transaction Modals */}
      <TransactionModals
        // Add Stock Modal
        isAddStockModalOpen={isAddStockModalOpen}
        onCloseAddStockModal={() => setIsAddStockModalOpen(false)}
        selectedBankAccount={selectedBankAccount}
        
        // Stock Details Modal
        selectedStock={selectedStock}
        stockDetails={stockDetails}
        onCloseStockDetails={() => {
          setSelectedStock(null);
          setStockDetails(null);
        }}
        
        // Modify Holding Modal
        modifyHolding={modifyHolding}
        onCloseModifyHolding={() => setModifyHolding(null)}
        
        // Remove Holding Confirmation
        confirmRemoveHolding={confirmRemoveHolding}
        onConfirmRemoveHolding={() => {
          // Handle actual removal here
          setConfirmRemoveHolding(null);
        }}
        onCancelRemoveHolding={() => setConfirmRemoveHolding(null)}
        
        // Shared props
        exchangeRates={exchangeRates}
        onRefreshData={refreshData}
      />

      {/* CSV Upload Modal */}
      <CSVUploadModal
        isOpen={isCsvUploadModalOpen}
        onClose={() => {
          setIsCsvUploadModalOpen(false);
          setCsvFile(null);
          setCsvPreviewData(null);
          setCsvUploadResult(null);
        }}
        selectedBankAccount={selectedBankAccount}
        csvFile={csvFile}
        csvPreviewData={csvPreviewData}
        csvUploadLoading={csvUploadLoading}
        csvUploadResult={csvUploadResult}
        onFileChange={setCsvFile}
        onPreviewChange={setCsvPreviewData}
        onLoadingChange={setCsvUploadLoading}
        onResultChange={setCsvUploadResult}
        onRefreshData={refreshData}
      />

      {/* No bank account message */}
      {bankAccounts.length === 0 && (
        <div className="no-accounts-message">
          <div className="empty-state">
            <div className="empty-icon">🏦</div>
            <h3>No Bank Accounts Found</h3>
            <p>You need to have at least one bank account to manage equity holdings.</p>
            <p>Please contact your relationship manager to set up a bank account.</p>
          </div>
        </div>
      )}

      {/* No holdings message */}
      {bankAccounts.length > 0 && holdings.length === 0 && selectedBankAccount && (
        <div className="no-holdings-message">
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <h3>No Holdings in This Account</h3>
            <p>Start building your portfolio by adding your first stock position.</p>
            <button
              className="add-first-stock-btn"
              onClick={handleAddStock}
            >
              📈 Add Your First Stock
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PortfolioContainer;