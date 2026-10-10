import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useDialog } from './useDialog.js';
import Dialog from './Dialog.jsx';

const MarketDataManager = ({ user }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshResults, setRefreshResults] = useState(null);
  const [cacheStats, setCacheStats] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const { dialogState, hideDialog, showConfirm, showSuccess, showError } = useDialog();

  // State for product lookup modal
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [tickerProducts, setTickerProducts] = useState([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);

  // State for stale / missing market data table
  const [staleData, setStaleData] = useState(null);
  const [isLoadingStale, setIsLoadingStale] = useState(false);

  const loadStaleTickers = async () => {
    setIsLoadingStale(true);
    try {
      const sessionId = localStorage.getItem('sessionId');
      const result = await Meteor.callAsync('marketData.getStaleTickers', sessionId);
      setStaleData(result);
    } catch (error) {
      console.error('Error loading stale tickers:', error);
      setStaleData(null);
    } finally {
      setIsLoadingStale(false);
    }
  };

  // Load cache statistics + stale data on component mount
  useEffect(() => {
    const loadStats = async () => {
      setIsLoadingStats(true);
      try {
        const stats = await Meteor.callAsync('marketData.getStats');
        setCacheStats(stats);
      } catch (error) {
        console.error('Error loading cache stats:', error);
      } finally {
        setIsLoadingStats(false);
      }
    };
    loadStats();
    loadStaleTickers();
  }, []);

  const handleRefreshMarketData = async () => {
    console.log('MarketDataManager: Button clicked - starting refresh process');
    setIsRefreshing(true);
    setRefreshResults(null);

    const startTime = Date.now();

    try {
      console.log('MarketDataManager: Starting market data refresh');
      
      // Get sessionId from localStorage
      const sessionId = localStorage.getItem('sessionId');
      console.log('MarketDataManager: Using sessionId:', sessionId ? 'Found' : 'Missing');
      
      console.log('MarketDataManager: Calling Meteor method...');
      const results = await Meteor.callAsync('marketData.refreshCache', {
        includeDebug: false
      }, sessionId);
      
      // Add duration to results
      const duration = Date.now() - startTime;
      results.duration = duration;
      
      console.log('MarketDataManager: Received results:', results);

      setRefreshResults(results);
      
      // Reload stats after refresh with longer delay to ensure DB operations complete
      setTimeout(async () => {
        try {
          console.log('MarketDataManager: Reloading cache stats after refresh...');
          const stats = await Meteor.callAsync('marketData.getStats');
          console.log('MarketDataManager: New cache stats:', stats);
          setCacheStats(stats);
        } catch (error) {
          console.error('MarketDataManager: Error loading cache stats after refresh:', error);
        }
      }, 2000); // Increased delay to 2 seconds

    } catch (error) {
      console.error('MarketDataManager: Error refreshing market data:', error);
      console.error('MarketDataManager: Error stack:', error.stack);
      console.error('MarketDataManager: Error details:', {
        message: error.message,
        reason: error.reason,
        details: error.details,
        error: error.error
      });
      setRefreshResults({
        success: false,
        error: error.message || error.reason || 'Unknown error occurred'
      });
    } finally {
      console.log('MarketDataManager: Setting isRefreshing to false');
      setIsRefreshing(false);
    }
  };

  const handleClearCache = async () => {
    const confirmed = await showConfirm(
      'Are you sure you want to clear all cached market data? This action cannot be undone.',
      null,
      'Clear Cache Confirmation'
    );
    
    if (!confirmed) {
      return;
    }

    try {
      const sessionId = localStorage.getItem('sessionId');
      console.log('MarketDataManager: clearCache sessionId:', sessionId);
      const result = await Meteor.callAsync('marketData.clearCache', null, sessionId);
      showSuccess(result.message, 'Cache Cleared');
      
      // Reload stats after clearing
      try {
        const stats = await Meteor.callAsync('marketData.getStats');
        setCacheStats(stats);
      } catch (error) {
        console.error('Error loading cache stats:', error);
      }
      setRefreshResults(null);
    } catch (error) {
      console.error('Error clearing cache:', error);
      showError(`Error clearing cache: ${error.message}`, 'Clear Cache Failed');
    }
  };

  const formatNumber = (num) => {
    return new Intl.NumberFormat().format(num);
  };

  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const formatDate = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  };

  // Handle clicking on a ticker to show products
  const handleTickerClick = async (fullTicker) => {
    setSelectedTicker(fullTicker);
    setIsLoadingProducts(true);
    setTickerProducts([]);

    try {
      const products = await Meteor.callAsync('products.findByUnderlying', fullTicker, localStorage.getItem('sessionId'));
      setTickerProducts(products);
    } catch (error) {
      console.error('Error finding products:', error);
      setTickerProducts([]);
    } finally {
      setIsLoadingProducts(false);
    }
  };

  // Sort results to show errors first
  const getSortedDetails = () => {
    if (!refreshResults?.details) return [];
    return [...refreshResults.details].sort((a, b) => {
      // Sort by errors first (descending)
      if ((b.errors || 0) !== (a.errors || 0)) {
        return (b.errors || 0) - (a.errors || 0);
      }
      // Then by error flag
      if (a.error && !b.error) return -1;
      if (!a.error && b.error) return 1;
      return 0;
    });
  };

  return (
    <div>
      {/* Market Data Cache Management */}
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
          Market Data Cache Management
        </h3>
        <p style={{
          margin: '0 0 1.5rem 0',
          color: 'var(--text-secondary)',
          fontSize: '0.9rem'
        }}>
          Manage historical market data cache for all securities
        </p>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
          <button
            onClick={(e) => {
              console.log('Button onClick event triggered', e);
              handleRefreshMarketData();
            }}
            disabled={isRefreshing}
            style={{
              padding: '12px 24px',
              background: isRefreshing 
                ? 'var(--text-muted)' 
                : 'var(--accent-color)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: isRefreshing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.3s ease'
            }}
          >
            {isRefreshing ? '🔄' : '📈'} 
            {isRefreshing ? 'Refreshing Market Data...' : 'Refresh Market Data'}
          </button>

          <button
            onClick={handleClearCache}
            style={{
              padding: '12px 24px',
              background: 'transparent',
              color: 'var(--danger-color)',
              border: '1px solid var(--danger-color)',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'var(--danger-color)';
              e.target.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'transparent';
              e.target.style.color = 'var(--danger-color)';
            }}
          >
            🗑️ Clear Cache
          </button>
        </div>

        {/* Cache Statistics */}
        {cacheStats && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginTop: '1.5rem'
          }}>
            <div style={{
              padding: '1.25rem',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              textAlign: 'center',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}>
              <div style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--accent-color)' }}>
                {formatNumber(cacheStats?.totalRecords || 0)}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontWeight: '500' }}>
                Total Records
              </div>
            </div>

            <div style={{
              padding: '1.25rem',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              textAlign: 'center',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}>
              <div style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--accent-color)' }}>
                {cacheStats?.uniqueStockCount || 0}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontWeight: '500' }}>
                Unique Securities
              </div>
            </div>

            <div style={{
              padding: '1.25rem',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              textAlign: 'center',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}>
              <div style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                {cacheStats?.oldestDate ? new Date(cacheStats.oldestDate).toLocaleDateString() : 'N/A'}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontWeight: '500' }}>
                Oldest Data
              </div>
            </div>

            <div style={{
              padding: '1.25rem',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              textAlign: 'center',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}>
              <div style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                {cacheStats?.newestDate ? new Date(cacheStats.newestDate).toLocaleDateString() : 'N/A'}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontWeight: '500' }}>
                Latest Data
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Stale / Missing Market Data */}
      <section style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        background: 'var(--bg-primary)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{
              margin: '0 0 0.25rem 0',
              fontSize: '1.2rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Stale / Missing Market Data
            </h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Tracked securities that did not get fresh prices — missing from cache, or behind their exchange peers.
            </p>
          </div>
          <button
            onClick={loadStaleTickers}
            disabled={isLoadingStale}
            style={{
              padding: '10px 18px',
              background: 'transparent',
              color: 'var(--accent-color)',
              border: '1px solid var(--accent-color)',
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '600',
              cursor: isLoadingStale ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {isLoadingStale ? '🔄 Loading…' : '🔄 Refresh list'}
          </button>
        </div>

        {staleData?.summary && (
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--danger-color)', fontWeight: '600' }}>
              {staleData.summary.missingCount} missing
            </span>
            <span style={{ color: '#d97706', fontWeight: '600' }}>
              {staleData.summary.staleCount} stale
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {staleData.summary.totalCached} cached / {staleData.summary.totalTracked} tracked
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Latest data: {formatDate(staleData.summary.newestDate)}
            </span>
          </div>
        )}

        {isLoadingStale && !staleData ? (
          <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>Loading…</div>
        ) : !staleData || staleData.rows.length === 0 ? (
          <div style={{
            padding: '1.5rem',
            textAlign: 'center',
            color: 'var(--success-color)',
            fontWeight: '500'
          }}>
            ✅ All tracked tickers are up to date.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              border: '1px solid var(--border-color)',
              minWidth: '960px'
            }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  {['Ticker', 'Exchange', 'Status', 'Last Price Date', 'Days Behind', 'Last Updated', 'Source', 'Reason', 'Products'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px',
                      border: '1px solid var(--border-color)',
                      textAlign: 'left',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--text-secondary)'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staleData.rows.map((row, index) => {
                  const isMissing = row.status === 'MISSING';
                  return (
                    <tr key={row.fullTicker} style={{ backgroundColor: index % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
                      <td style={{ padding: '10px 12px', border: '1px solid var(--border-color)', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                        <span
                          onClick={() => handleTickerClick(row.fullTicker)}
                          style={{ cursor: 'pointer', color: 'var(--accent-color)', textDecoration: 'underline' }}
                          title="Click to view products with this underlying"
                        >
                          {row.fullTicker}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', border: '1px solid var(--border-color)', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {row.exchange || '—'}
                      </td>
                      <td style={{ padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          color: 'white',
                          backgroundColor: isMissing ? 'var(--danger-color)' : '#d97706'
                        }}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', border: '1px solid var(--border-color)', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {formatDate(row.latestDate)}
                      </td>
                      <td style={{ padding: '10px 12px', border: '1px solid var(--border-color)', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {row.daysBehind != null ? `${row.daysBehind}` : (row.daysBehindToday != null ? `${row.daysBehindToday}*` : '—')}
                      </td>
                      <td style={{ padding: '10px 12px', border: '1px solid var(--border-color)', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {formatDate(row.lastUpdated)}
                      </td>
                      <td style={{ padding: '10px 12px', border: '1px solid var(--border-color)', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        {row.dataSource || '—'}
                      </td>
                      <td style={{ padding: '10px 12px', border: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {row.reason || '—'}
                      </td>
                      <td style={{ padding: '10px 12px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                        {row.products && row.products.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            {row.products.map(p => (
                              <a
                                key={p._id}
                                href={`/report/${p._id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--accent-color)', textDecoration: 'underline', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }}
                                title={p.title || p.isin || p._id}
                              >
                                {p.title || p.isin || p._id}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ margin: '0.75rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              * For MISSING rows, "Days Behind" shows weekdays since the last cached price (if any), relative to today.
            </p>
          </div>
        )}
      </section>

      {/* Refresh Results */}
      {refreshResults && (
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
            {refreshResults.success ? '✅' : '❌'} Market Data Refresh {refreshResults.success ? 'Complete' : 'Failed'}
          </h3>

          {refreshResults.success ? (
            <div>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', 
                gap: '1rem',
                marginBottom: '1.5rem'
              }}>
                <div style={{
                  background: 'var(--bg-primary)',
                  padding: '1rem',
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Duration
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                    {refreshResults.duration ? formatDuration(refreshResults.duration) : 'N/A'}
                  </div>
                </div>
                <div style={{
                  background: 'var(--bg-primary)',
                  padding: '1rem',
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Stocks Processed
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                    {refreshResults.details ? refreshResults.details.length : 0}/
                    {refreshResults.details ? refreshResults.details.length : 0}
                  </div>
                </div>
                <div style={{
                  background: 'var(--bg-primary)',
                  padding: '1rem',
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Success Rate
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--success-color)' }}>
                    {refreshResults.summary ? (() => {
                      const total = (refreshResults.summary.cached || 0) + (refreshResults.summary.skipped || 0) + (refreshResults.summary.errors || 0);
                      return total > 0 ? Math.round(((refreshResults.summary.cached || 0) / total) * 100) : 0;
                    })() : 0}%
                  </div>
                </div>
                <div style={{
                  background: 'var(--bg-primary)',
                  padding: '1rem',
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Records Inserted
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                    {refreshResults.summary ? formatNumber(refreshResults.summary.cached || 0) : '0'}
                  </div>
                </div>
                <div style={{
                  background: 'var(--bg-primary)',
                  padding: '1rem',
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Records Updated
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                    {refreshResults.summary ? formatNumber(refreshResults.summary.skipped || 0) : '0'}
                  </div>
                </div>
                <div style={{
                  background: 'var(--bg-primary)',
                  padding: '1rem',
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Errors
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '600', color: (refreshResults.summary?.errors || 0) > 0 ? 'var(--danger-color)' : 'var(--text-primary)' }}>
                    {refreshResults.summary ? refreshResults.summary.errors || 0 : '0'}
                  </div>
                </div>
              </div>

              {/* Results Table */}
              {refreshResults.details && refreshResults.details.length > 0 && (
                <details style={{ marginTop: '1.5rem' }}>
                  <summary style={{ 
                    cursor: 'pointer', 
                    fontWeight: '600',
                    color: 'var(--accent-color)',
                    marginBottom: '1rem',
                    fontSize: '0.95rem'
                  }}>
                    View Detailed Results ({refreshResults.details.length} securities)
                  </summary>
                  <div style={{ 
                    overflowX: 'auto',
                    position: 'relative',
                    zIndex: 1
                  }}>
                    <table style={{ 
                      width: '100%', 
                      borderCollapse: 'collapse',
                      border: '1px solid var(--border-color)',
                      tableLayout: 'fixed',
                      minWidth: '600px'
                    }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                          <th style={{
                            padding: '12px',
                            border: '1px solid var(--border-color)',
                            textAlign: 'left',
                            width: '40%'
                          }}>Security</th>
                          <th style={{
                            padding: '12px',
                            border: '1px solid var(--border-color)',
                            textAlign: 'left',
                            width: '15%'
                          }}>Status</th>
                          <th style={{
                            padding: '12px',
                            border: '1px solid var(--border-color)',
                            textAlign: 'left',
                            width: '15%'
                          }}>Inserted</th>
                          <th style={{
                            padding: '12px',
                            border: '1px solid var(--border-color)',
                            textAlign: 'left',
                            width: '15%'
                          }}>Skipped</th>
                          <th style={{
                            padding: '12px',
                            border: '1px solid var(--border-color)',
                            textAlign: 'left',
                            width: '15%'
                          }}>Errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getSortedDetails().map((result, index) => (
                          <tr key={index} style={{ backgroundColor: 'var(--bg-primary)' }}>
                            <td style={{
                              padding: '12px',
                              border: '1px solid var(--border-color)',
                              fontSize: '0.9rem',
                              color: 'var(--text-primary)',
                              fontFamily: 'monospace',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '200px'
                            }}>
                              <span
                                onClick={() => handleTickerClick(result.fullTicker)}
                                style={{
                                  cursor: 'pointer',
                                  color: 'var(--accent-color)',
                                  textDecoration: 'underline'
                                }}
                                title="Click to view products with this underlying"
                              >
                                {result.fullTicker}
                              </span>
                            </td>
                            <td style={{
                              padding: '12px',
                              border: '1px solid var(--border-color)',
                              fontSize: '0.9rem',
                              color: 'var(--text-primary)'
                            }}>
                              {result.error ? '❌' : '✅'}
                            </td>
                            <td style={{
                              padding: '12px',
                              border: '1px solid var(--border-color)',
                              fontSize: '0.9rem',
                              color: 'var(--text-primary)'
                            }}>
                              {result.cached || 0}
                            </td>
                            <td style={{
                              padding: '12px',
                              border: '1px solid var(--border-color)',
                              fontSize: '0.9rem',
                              color: 'var(--text-primary)'
                            }}>
                              {result.skipped || 0}
                            </td>
                            <td style={{
                              padding: '12px',
                              border: '1px solid var(--border-color)',
                              fontSize: '0.9rem',
                              color: result.errors > 0 ? 'var(--danger-color)' : 'var(--text-primary)',
                              fontWeight: result.errors > 0 ? '600' : '400'
                            }}>
                              {result.errors || 0}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--danger-color)' }}>
              <strong>Error:</strong> {refreshResults.error}
            </div>
          )}
        </section>
      )}

      {/* Information Panel */}
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
          How Market Data Cache Works
        </h3>
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)'
        }}>
          <ul style={{ 
            margin: 0,
            paddingLeft: '1.5rem',
            color: 'var(--text-secondary)',
            fontSize: '0.9rem',
            lineHeight: '1.8',
            listStyle: 'none'
          }}>
            <li style={{ position: 'relative', paddingLeft: '1.5rem', marginBottom: '0.75rem' }}>
              <span style={{ position: 'absolute', left: 0, color: 'var(--accent-color)' }}>▸</span>
              Automatically discovers all securities used in structured products
            </li>
            <li style={{ position: 'relative', paddingLeft: '1.5rem', marginBottom: '0.75rem' }}>
              <span style={{ position: 'absolute', left: 0, color: 'var(--accent-color)' }}>▸</span>
              Fetches historical data from EOD Historical Data API starting from the oldest trade date
            </li>
            <li style={{ position: 'relative', paddingLeft: '1.5rem', marginBottom: '0.75rem' }}>
              <span style={{ position: 'absolute', left: 0, color: 'var(--accent-color)' }}>▸</span>
              Stores daily OHLCV data in a local MongoDB collection for fast access
            </li>
            <li style={{ position: 'relative', paddingLeft: '1.5rem', marginBottom: '0.75rem' }}>
              <span style={{ position: 'absolute', left: 0, color: 'var(--accent-color)' }}>▸</span>
              Prevents duplicate entries with unique constraints on ticker + date
            </li>
            <li style={{ position: 'relative', paddingLeft: '1.5rem', marginBottom: '0.75rem' }}>
              <span style={{ position: 'absolute', left: 0, color: 'var(--accent-color)' }}>▸</span>
              Updates existing records if newer data is available
            </li>
            <li style={{ position: 'relative', paddingLeft: '1.5rem' }}>
              <span style={{ position: 'absolute', left: 0, color: 'var(--accent-color)' }}>▸</span>
              Includes a small delay between API calls to respect rate limits
            </li>
          </ul>
        </div>
      </section>

      {/* Product Selection Modal */}
      {selectedTicker && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setSelectedTicker(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '12px',
              padding: '1.5rem',
              minWidth: '400px',
              maxWidth: '600px',
              maxHeight: '80vh',
              overflow: 'auto',
              border: '1px solid var(--border-color)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{
              margin: '0 0 1rem 0',
              fontSize: '1.1rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Products with {selectedTicker}
            </h3>

            {isLoadingProducts ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading products...
              </div>
            ) : tickerProducts.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No products found with this underlying
              </div>
            ) : (
              <div style={{ marginBottom: '1rem' }}>
                {tickerProducts.map((product) => (
                  <div
                    key={product._id}
                    style={{
                      padding: '0.75rem 1rem',
                      borderBottom: '1px solid var(--border-color)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                        {product.title || product.isin || product._id}
                      </div>
                      {product.isin && product.title && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                          {product.isin}
                        </div>
                      )}
                      {product.maturityDate && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                          Maturity: {new Date(product.maturityDate).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <a
                      href={`/report/${product._id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '0.5rem 1rem',
                        backgroundColor: 'var(--accent-color)',
                        color: 'white',
                        borderRadius: '6px',
                        textDecoration: 'none',
                        fontSize: '0.85rem',
                        fontWeight: '500'
                      }}
                    >
                      View Report
                    </a>
                  </div>
                ))}
              </div>
            )}

            <div style={{ textAlign: 'right' }}>
              <button
                onClick={() => setSelectedTicker(null)}
                style={{
                  padding: '0.5rem 1.5rem',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog Component */}
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

export default MarketDataManager;