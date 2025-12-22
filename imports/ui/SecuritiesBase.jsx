import React, { useState, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import {
  SecuritiesMetadataCollection,
  ASSET_CLASSES,
  STRUCTURED_PRODUCT_TYPES,
  STRUCTURED_PRODUCT_UNDERLYING_TYPES,
  STRUCTURED_PRODUCT_PROTECTION_TYPES
} from '../api/securitiesMetadata.js';
import SecurityClassificationModal from './components/SecurityClassificationModal.jsx';

export default function SecuritiesBase({ user }) {
  const sessionId = localStorage.getItem('sessionId');

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClassified, setFilterClassified] = useState('all'); // 'all', 'classified', 'unclassified'
  const [filterAssetClass, setFilterAssetClass] = useState('');
  const [selectedSecurity, setSelectedSecurity] = useState(null);
  const [showClassificationModal, setShowClassificationModal] = useState(false);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [isBulkClassifying, setIsBulkClassifying] = useState(false);
  const [isAIClassifying, setIsAIClassifying] = useState(false);
  const [overrideExisting, setOverrideExisting] = useState(false); // Whether to override already classified securities
  const [classifyProgress, setClassifyProgress] = useState({ current: 0, total: 0, currentProduct: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  // Notification functions
  const showSuccess = (message) => {
    Meteor.call('notifications.create', {
      userId: user._id,
      type: 'success',
      message,
      sessionId
    });
  };

  const showError = (message) => {
    Meteor.call('notifications.create', {
      userId: user._id,
      type: 'error',
      message,
      sessionId
    });
  };

  // Subscribe to securities metadata
  const { securities, isLoading } = useTracker(() => {
    const filters = {};

    if (filterClassified === 'classified') {
      filters.isClassified = true;
    } else if (filterClassified === 'unclassified') {
      filters.isClassified = false;
    }

    if (filterAssetClass) {
      filters.assetClass = filterAssetClass;
    }

    if (searchTerm) {
      filters.searchTerm = searchTerm;
    }

    const handle = Meteor.subscribe('securitiesMetadata', sessionId, filters);

    return {
      securities: SecuritiesMetadataCollection.find({
        // Exclude cash positions
        securityType: { $ne: 'CASH' },
        assetClass: { $ne: 'Cash' }
      }, {
        sort: { isClassified: 1, securityName: 1 }
      }).fetch(),
      isLoading: !handle.ready()
    };
  }, [sessionId, filterClassified, filterAssetClass, searchTerm]);

  // Calculate statistics
  const stats = useMemo(() => {
    const total = securities.length;
    const classified = securities.filter(s => s.isClassified).length;
    const unclassified = total - classified;

    const byAssetClass = {};
    securities.forEach(s => {
      const assetClass = s.assetClass || 'unclassified';
      byAssetClass[assetClass] = (byAssetClass[assetClass] || 0) + 1;
    });

    return {
      total,
      classified,
      unclassified,
      byAssetClass
    };
  }, [securities]);

  // Pagination
  const paginatedSecurities = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return securities.slice(startIndex, endIndex);
  }, [securities, currentPage]);

  const totalPages = Math.ceil(securities.length / ITEMS_PER_PAGE);

  // Handle bulk import from PMS Holdings
  const handleBulkImport = async () => {
    setIsBulkImporting(true);

    try {
      const result = await Meteor.callAsync('securitiesMetadata.bulkImportFromPMS', {
        sessionId
      });

      showSuccess(
        `Imported ${result.newSecurities} new securities. ` +
        `${result.existingSecurities} already existed.` +
        (result.errorCount > 0 ? ` ${result.errorCount} errors.` : '')
      );

    } catch (error) {
      console.error('Bulk import failed:', error);
      showError(`Failed to import securities: ${error.reason || error.message}`);
    } finally {
      setIsBulkImporting(false);
    }
  };

  // Handle bulk classification from Ambervision with progress tracking
  const handleBulkClassifyFromAmbervision = async () => {
    setIsBulkClassifying(true);
    setClassifyProgress({ current: 0, total: 0, currentProduct: 'Loading...' });

    try {
      // First, get the list of securities to classify
      const listResult = await Meteor.callAsync('securitiesMetadata.getSecuritiesToClassifyFromAmbervision', {
        sessionId,
        overrideExisting
      });

      const securities = listResult.securities || [];
      const total = securities.length;

      if (total === 0) {
        showSuccess('No Ambervision products found to classify.');
        setIsBulkClassifying(false);
        setClassifyProgress({ current: 0, total: 0, currentProduct: '' });
        return;
      }

      setClassifyProgress({ current: 0, total, currentProduct: '' });

      let successCount = 0;
      let errorCount = 0;

      // Process each security one by one with progress updates
      for (let i = 0; i < securities.length; i++) {
        const security = securities[i];
        setClassifyProgress({
          current: i + 1,
          total,
          currentProduct: security.productTitle || security.isin
        });

        try {
          await Meteor.callAsync('securitiesMetadata.classifySingleFromAmbervision', {
            sessionId,
            isin: security.isin
          });
          successCount++;
        } catch (error) {
          console.error(`Failed to classify ${security.isin}:`, error);
          errorCount++;
        }
      }

      showSuccess(
        `Auto-classified ${successCount} Ambervision products.` +
        (errorCount > 0 ? ` ${errorCount} errors.` : '')
      );

    } catch (error) {
      console.error('Bulk classification failed:', error);
      showError(`Failed to auto-classify securities: ${error.reason || error.message}`);
    } finally {
      setIsBulkClassifying(false);
      setClassifyProgress({ current: 0, total: 0, currentProduct: '' });
    }
  };

  // Handle AI-only classification (non-Ambervision securities)
  const handleBulkClassifyAIOnly = async () => {
    setIsAIClassifying(true);

    try {
      const result = await Meteor.callAsync('securitiesMetadata.bulkClassifyAIOnly', {
        sessionId
      });

      showSuccess(
        `AI classified ${result.aiClassifiedCount} securities. ` +
        `${result.skippedCount} skipped.` +
        (result.errorCount > 0 ? ` ${result.errorCount} errors.` : '')
      );

    } catch (error) {
      console.error('AI classification failed:', error);
      showError(`Failed to AI-classify securities: ${error.reason || error.message}`);
    } finally {
      setIsAIClassifying(false);
    }
  };

  // Handle edit security
  const handleEditSecurity = (security) => {
    setSelectedSecurity(security);
    setShowClassificationModal(true);
  };

  // Handle save classification
  const handleSaveClassification = async (classificationData) => {
    try {
      await Meteor.callAsync('securitiesMetadata.upsert', {
        isin: selectedSecurity.isin,
        classificationData,
        sessionId
      });

      showSuccess(`Classification saved for ${selectedSecurity.isin}`);
      setShowClassificationModal(false);
      setSelectedSecurity(null);

    } catch (error) {
      console.error('Save classification failed:', error);
      showError(`Failed to save classification: ${error.reason || error.message}`);
    }
  };

  // Styles
  const cardStyle = {
    background: 'var(--bg-secondary)',
    borderRadius: '12px',
    padding: '20px',
    border: '2px solid var(--border-color)',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  };

  const statCardStyle = {
    ...cardStyle,
    textAlign: 'center',
    minWidth: '180px'
  };

  const inputStyle = {
    padding: '10px 15px',
    borderRadius: '8px',
    border: '2px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    width: '100%'
  };

  const buttonStyle = {
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    transition: 'all 0.2s'
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    background: 'var(--accent-color)',
    color: 'white'
  };

  const filterButtonStyle = (isActive) => ({
    ...buttonStyle,
    background: isActive ? 'var(--accent-color)' : 'var(--bg-tertiary)',
    color: isActive ? 'white' : 'var(--text-primary)',
    border: isActive ? 'none' : '2px solid var(--border-color)'
  });

  return (
    <div style={{ padding: '20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '32px', fontWeight: '700' }}>
          🔖 Securities Base
        </h1>
        <p style={{ margin: '10px 0 0 0', color: 'var(--text-muted)', fontSize: '16px' }}>
          Classify and manage securities from PMS holdings
        </p>
      </div>

      {/* Statistics Cards */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '30px', flexWrap: 'wrap' }}>
        <div style={statCardStyle}>
          <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--accent-color)', marginBottom: '10px' }}>
            {stats.total}
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: '500' }}>
            Total Securities
          </div>
        </div>

        <div style={statCardStyle}>
          <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--success-color)', marginBottom: '10px' }}>
            {stats.classified}
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: '500' }}>
            Classified
          </div>
        </div>

        <div style={statCardStyle}>
          <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--warning-color)', marginBottom: '10px' }}>
            {stats.unclassified}
          </div>
          <div style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: '500' }}>
            Unclassified
          </div>
        </div>

        {Object.keys(stats.byAssetClass).length > 0 && (
          <div style={statCardStyle}>
            <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '10px' }}>
              Asset Classes
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {Object.entries(stats.byAssetClass)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([assetClass, count]) => (
                  <div key={assetClass}>
                    {assetClass || 'unclassified'}: {count}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Search and Filters */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ flex: '1 1 300px' }}>
            <input
              type="text"
              placeholder="🔍 Search by ISIN or security name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Bulk Import Button */}
          <button
            onClick={handleBulkImport}
            disabled={isBulkImporting}
            style={primaryButtonStyle}
          >
            {isBulkImporting ? '⏳ Importing...' : '🔄 Sync from PMS'}
          </button>

          {/* Override Classification Selector */}
          <select
            value={overrideExisting ? 'all' : 'unclassified'}
            onChange={(e) => setOverrideExisting(e.target.value === 'all')}
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '14px',
              cursor: 'pointer',
              minWidth: '180px'
            }}
          >
            <option value="unclassified">Unclassified only</option>
            <option value="all">Override all</option>
          </select>

          {/* Bulk Classify from Ambervision Button */}
          <button
            onClick={handleBulkClassifyFromAmbervision}
            disabled={isBulkClassifying}
            style={{
              ...primaryButtonStyle,
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              minWidth: isBulkClassifying ? '280px' : 'auto'
            }}
          >
            {isBulkClassifying
              ? classifyProgress.total > 0
                ? `⏳ ${classifyProgress.current} / ${classifyProgress.total}`
                : '⏳ Loading...'
              : '✨ Auto-Classify from Ambervision'}
          </button>

          {/* Bulk Classify AI Only (non-Ambervision) Button */}
          <button
            onClick={handleBulkClassifyAIOnly}
            disabled={isAIClassifying}
            style={{
              ...primaryButtonStyle,
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
            }}
          >
            {isAIClassifying ? '⏳ AI Classifying...' : '🤖 Classify Non-Ambervision (AI)'}
          </button>
        </div>

        {/* Filter Buttons */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '15px' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', marginRight: '10px' }}>
            Classification Status:
          </div>
          <button
            onClick={() => setFilterClassified('all')}
            style={filterButtonStyle(filterClassified === 'all')}
          >
            All
          </button>
          <button
            onClick={() => setFilterClassified('unclassified')}
            style={filterButtonStyle(filterClassified === 'unclassified')}
          >
            Unclassified
          </button>
          <button
            onClick={() => setFilterClassified('classified')}
            style={filterButtonStyle(filterClassified === 'classified')}
          >
            Classified
          </button>
        </div>

        {/* Asset Class Filter */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-muted)', marginRight: '10px' }}>
            Asset Class:
          </div>
          <select
            value={filterAssetClass}
            onChange={(e) => setFilterAssetClass(e.target.value)}
            style={{ ...inputStyle, width: 'auto', minWidth: '200px' }}
          >
            <option value="">All Asset Classes</option>
            {ASSET_CLASSES.filter(ac => ac.value).map(ac => (
              <option key={ac.value} value={ac.value}>
                {ac.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Securities Table */}
      <div style={{ ...cardStyle, marginTop: '20px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            Loading securities...
          </div>
        ) : paginatedSecurities.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            No securities found. Click "Sync from PMS" to import securities.
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '15px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                      ISIN
                    </th>
                    <th style={{ padding: '15px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                      Security Name
                    </th>
                    <th style={{ padding: '15px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                      Asset Class
                    </th>
                    <th style={{ padding: '15px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                      Product Type
                    </th>
                    <th style={{ padding: '15px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                      Underlying Type
                    </th>
                    <th style={{ padding: '15px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                      Protection Type
                    </th>
                    <th style={{ padding: '15px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                      Status
                    </th>
                    <th style={{ padding: '15px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSecurities.map((security) => (
                    <tr
                      key={security._id}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        transition: 'background 0.2s',
                        background: security.isClassified ? 'transparent' : 'rgba(251, 191, 36, 0.05)'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = security.isClassified ? 'transparent' : 'rgba(251, 191, 36, 0.05)'}
                    >
                      <td style={{ padding: '15px', fontSize: '13px', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                        {security.isin}
                      </td>
                      <td style={{ padding: '15px', fontSize: '14px', color: 'var(--text-primary)' }}>
                        {security.securityName || 'Unknown'}
                      </td>
                      <td style={{ padding: '15px', fontSize: '13px', color: 'var(--text-muted)' }}>
                        {security.assetClass ? (
                          ASSET_CLASSES.find(ac => ac.value === security.assetClass)?.label || security.assetClass
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not classified</span>
                        )}
                      </td>
                      <td style={{ padding: '15px', fontSize: '13px', color: 'var(--text-muted)' }}>
                        {security.assetClass === 'structured_product' ? (
                          security.structuredProductType ? (
                            STRUCTURED_PRODUCT_TYPES.find(pt => pt.value === security.structuredProductType)?.label || security.structuredProductType
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>-</span>
                          )
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '15px', fontSize: '13px', color: 'var(--text-muted)' }}>
                        {security.assetClass === 'structured_product' ? (
                          security.structuredProductUnderlyingType ? (
                            STRUCTURED_PRODUCT_UNDERLYING_TYPES.find(ut => ut.value === security.structuredProductUnderlyingType)?.label || security.structuredProductUnderlyingType
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>-</span>
                          )
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '15px', fontSize: '13px', color: 'var(--text-muted)' }}>
                        {security.assetClass === 'structured_product' ? (
                          security.structuredProductProtectionType ? (
                            STRUCTURED_PRODUCT_PROTECTION_TYPES.find(pt => pt.value === security.structuredProductProtectionType)?.label || security.structuredProductProtectionType
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>-</span>
                          )
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '15px', textAlign: 'center' }}>
                        {security.isClassified ? (
                          <span style={{ fontSize: '20px' }} title="Classified">✅</span>
                        ) : (
                          <span style={{ fontSize: '20px' }} title="Unclassified">⚪</span>
                        )}
                      </td>
                      <td style={{ padding: '15px', textAlign: 'center' }}>
                        <button
                          onClick={() => handleEditSecurity(security)}
                          style={{
                            ...buttonStyle,
                            background: 'var(--accent-color)',
                            color: 'white',
                            padding: '6px 12px',
                            fontSize: '13px'
                          }}
                        >
                          ✏️ Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                  Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, securities.length)} of {securities.length}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    style={{
                      ...buttonStyle,
                      background: currentPage === 1 ? 'var(--bg-tertiary)' : 'var(--accent-color)',
                      color: currentPage === 1 ? 'var(--text-muted)' : 'white',
                      cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                      padding: '8px 16px'
                    }}
                  >
                    ← Previous
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 15px', fontSize: '14px', color: 'var(--text-primary)' }}>
                    Page {currentPage} of {totalPages}
                  </div>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    style={{
                      ...buttonStyle,
                      background: currentPage === totalPages ? 'var(--bg-tertiary)' : 'var(--accent-color)',
                      color: currentPage === totalPages ? 'var(--text-muted)' : 'white',
                      cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                      padding: '8px 16px'
                    }}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Classification Modal */}
      {showClassificationModal && selectedSecurity && (
        <SecurityClassificationModal
          security={selectedSecurity}
          onSave={handleSaveClassification}
          onClose={() => {
            setShowClassificationModal(false);
            setSelectedSecurity(null);
          }}
        />
      )}
    </div>
  );
}
