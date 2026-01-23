import React, { useState, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker, useSubscribe } from 'meteor/react-meteor-data';
import { UnderlyingsAnalysisCollection } from '/imports/api/underlyingsAnalysis';
import { RiskAnalysisReportsCollection } from '/imports/api/riskAnalysis';
import { ProductsCollection } from '/imports/api/products';
import { AllocationsCollection } from '/imports/api/allocations';
import { useTheme } from './ThemeContext.jsx';
import { useViewAs } from './ViewAsContext.jsx';
import { Bubble } from 'react-chartjs-2';
import RiskReportModal from './components/RiskReportModal.jsx';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  Tooltip,
  Legend
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

// Register Chart.js components
ChartJS.register(LinearScale, PointElement, Tooltip, Legend, annotationPlugin);

const UnderlyingsView = ({ user, onNavigateToReport }) => {
  const { isDarkMode } = useTheme();
  const { viewAsFilter } = useViewAs();
  const [sortColumn, setSortColumn] = useState('symbol');
  const [sortDirection, setSortDirection] = useState('asc');
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  // Risk Report State
  const [isRiskReportModalOpen, setIsRiskReportModalOpen] = useState(false);
  const [isGeneratingRiskReport, setIsGeneratingRiskReport] = useState(false);
  const [riskReportId, setRiskReportId] = useState(null);
  const [riskReportError, setRiskReportError] = useState(null);
  const [reportLanguage, setReportLanguage] = useState('en'); // 'en' or 'fr'
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);

  // Subscribe to the pre-computed analysis
  const isLoading = useSubscribe('phoenixUnderlyingsAnalysis');

  // Subscribe to products/allocations for ViewAs filtering
  const sessionId = useMemo(() => localStorage.getItem('sessionId'), []);
  const { accessibleProductIds } = useTracker(() => {
    // Subscribe with viewAsFilter
    Meteor.subscribe('products', sessionId, viewAsFilter);
    Meteor.subscribe('allAllocations', sessionId, viewAsFilter);

    // Get allocations and extract product IDs
    const allocs = AllocationsCollection.find().fetch();
    const productIds = viewAsFilter
      ? [...new Set(allocs.map(a => a.productId))]
      : null; // null = show all products (no filter)

    return { accessibleProductIds: productIds };
  }, [sessionId, viewAsFilter]);

  // Get the analysis from database (NO client-side calculations)
  const analysisData = useTracker(() => {
    const analysis = UnderlyingsAnalysisCollection.findOne({ _id: 'phoenix_live_underlyings' });
    return analysis || null;
  }, []);

  // Extract data from analysis (all pre-computed server-side)
  // Filter by accessible products if ViewAs is active
  const allUnderlyingsData = analysisData?.underlyings || [];
  const underlyingsData = useMemo(() => {
    if (!viewAsFilter || !accessibleProductIds) {
      return allUnderlyingsData; // Show all if no filter
    }

    // Filter to only show underlyings for accessible products
    const filtered = allUnderlyingsData.filter(u => accessibleProductIds.includes(u.productId));
    console.log('[UnderlyingsView] ViewAs active - filtering', allUnderlyingsData.length, 'underlyings to', filtered.length, 'for', accessibleProductIds.length, 'accessible products');
    return filtered;
  }, [allUnderlyingsData, accessibleProductIds, viewAsFilter]);

  // Calculate summary stats from filtered data (respects ViewAs filter)
  const summary = useMemo(() => {
    if (!underlyingsData || underlyingsData.length === 0) {
      return {
        totalRows: 0,
        totalProducts: 0,
        uniqueUnderlyings: 0,
        positivePerformance: 0,
        negativePerformance: 0,
        withProtection: 0,
        belowBarrier: 0,
        warningZone: 0,
        safeZone: 0
      };
    }

    // Calculate stats from filtered underlyings
    const uniqueProducts = new Set(underlyingsData.map(u => u.productId)).size;
    const uniqueSymbols = new Set(underlyingsData.map(u => u.ticker)).size;

    return {
      totalRows: underlyingsData.length,
      totalProducts: uniqueProducts,
      uniqueUnderlyings: uniqueSymbols,
      positivePerformance: underlyingsData.filter(u => u.performance > 0).length,
      negativePerformance: underlyingsData.filter(u => u.performance < 0).length,
      withProtection: underlyingsData.filter(u => u.hasProtection).length,
      belowBarrier: underlyingsData.filter(u => u.isBelowBarrier).length,
      warningZone: underlyingsData.filter(u => u.isInWarningZone).length,
      safeZone: underlyingsData.filter(u => !u.isInWarningZone && !u.isBelowBarrier).length
    };
  }, [underlyingsData]);

  const generatedAt = analysisData?.generatedAtFormatted || null;

  // Refresh handler - regenerate analysis on demand
  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      await Meteor.callAsync('underlyingsAnalysis.generate');
    } catch (error) {
      console.error('Error refreshing analysis:', error);
      setRefreshError(error.message || 'Failed to refresh analysis');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Get session ID for authenticated API calls
  const getSessionId = () => localStorage.getItem('sessionId');

  // Subscribe to risk report if we have a report ID
  useSubscribe('riskAnalysisReport', riskReportId, getSessionId(), { skip: !riskReportId });

  // Get the risk report from database
  const riskReport = useTracker(() => {
    if (!riskReportId) return null;
    return RiskAnalysisReportsCollection.findOne(riskReportId);
  }, [riskReportId]);

  // Show language selector before generating report
  const handleShowLanguageSelector = () => {
    setShowLanguageSelector(true);
  };

  // Risk Report Generation Handler
  const handleGenerateRiskReport = async (language = 'en') => {
    setShowLanguageSelector(false);
    setIsRiskReportModalOpen(true);
    setIsGeneratingRiskReport(true);
    setRiskReportError(null);
    setRiskReportId(null);

    try {
      const sessionId = getSessionId();
      if (!sessionId) {
        throw new Error('No valid session found. Please log in first.');
      }

      console.log(`Generating risk analysis report in ${language}...`);
      const result = await Meteor.callAsync('riskAnalysis.generate', sessionId, language);

      console.log('Risk report generated:', result);
      setRiskReportId(result.reportId);
    } catch (error) {
      console.error('Error generating risk report:', error);
      setRiskReportError(error.message || error.reason || 'Failed to generate risk report');
    } finally {
      setIsGeneratingRiskReport(false);
    }
  };

  // Close risk report modal
  const handleCloseRiskReport = () => {
    setIsRiskReportModalOpen(false);
    setRiskReportId(null);
    setRiskReportError(null);
  };

  // Close language selector
  const handleCloseLanguageSelector = () => {
    setShowLanguageSelector(false);
  };

  // Filter and sort data
  const filteredAndSortedData = useMemo(() => {
    let filtered = underlyingsData;

    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(item => {
        const symbol = (item.symbol || '').toLowerCase();
        const name = (item.name || '').toLowerCase();

        return symbol.includes(searchLower) ||
               name.includes(searchLower);
      });
    }

    // Sort data
    const sorted = [...filtered].sort((a, b) => {
      let aValue = a[sortColumn];
      let bValue = b[sortColumn];

      // Handle numeric columns
      if (['currentPrice', 'initialPrice', 'performance', 'daysToFinalObservation', 'distanceToBarrier'].includes(sortColumn)) {
        aValue = parseFloat(aValue) || 0;
        bValue = parseFloat(bValue) || 0;
      }

      // Handle date columns
      if (sortColumn === 'tradeDate') {
        aValue = aValue ? new Date(aValue).getTime() : 0;
        bValue = bValue ? new Date(bValue).getTime() : 0;
      }


      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [underlyingsData, searchTerm, sortColumn, sortDirection]);

  // Reset to page 1 when search term or items per page changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, itemsPerPage]);

  // Calculate pagination
  const totalItems = filteredAndSortedData.length;
  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(totalItems / itemsPerPage);
  const startIndex = itemsPerPage === 'all' ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = itemsPerPage === 'all' ? totalItems : startIndex + itemsPerPage;
  const paginatedData = filteredAndSortedData.slice(startIndex, endIndex);

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Prepare bubble chart data for underlyings with barriers (uses pre-computed properties)
  const bubbleChartData = useMemo(() => {
    const protectedUnderlyings = underlyingsData.filter(u => u.distanceToBarrier != null && u.hasMarketData);

    const bubbles = protectedUnderlyings.map(underlying => ({
      x: underlying.daysToFinalObservation,
      y: underlying.distanceToBarrier,
      r: underlying.bubbleSize || 8,
      label: underlying.symbol,
      name: underlying.name,
      performance: underlying.performance,
      barrier: underlying.protectionBarrierLevel,
      productIsin: underlying.productIsin,
      productTitle: underlying.productTitle,
      productId: underlying.productId, // Store productId for click navigation
      notional: underlying.productNotional || 100, // Investment amount
      currency: underlying.productCurrency || 'USD' // Product currency
    }));

    return {
      datasets: [{
        label: 'Underlyings',
        data: bubbles,
        backgroundColor: protectedUnderlyings.map(u => u.bubbleColor || 'rgba(16, 185, 129, 0.6)'),
        borderColor: protectedUnderlyings.map(u => u.bubbleBorderColor || 'rgba(16, 185, 129, 1)'),
        borderWidth: 2
      }]
    };
  }, [underlyingsData]);

  const bubbleChartOptions = useMemo(() => {
    // Calculate dynamic scale bounds to ensure all bubbles fit
    const bubbles = bubbleChartData.datasets[0].data;

    // Find min/max values for X and Y axes
    const xValues = bubbles.map(b => b.x);
    const yValues = bubbles.map(b => b.y);
    const radiuses = bubbles.map(b => b.r || 8);

    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const maxRadius = Math.max(...radiuses);

    // Add padding based on largest bubble radius (convert radius to percentage of axis range)
    const xRange = maxX - minX || 100;
    const yRange = maxY - minY || 100;
    const xPadding = Math.max(xRange * 0.1, maxRadius * 2); // 10% padding or 2x max bubble radius
    const yPadding = Math.max(yRange * 0.15, maxRadius * 1.5); // 15% padding or 1.5x max bubble radius

    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (event, elements, chart) => {
        if (elements.length > 0) {
          const elementIndex = elements[0].index;
          const datasetIndex = elements[0].datasetIndex;
          const clickedBubble = chart.data.datasets[datasetIndex].data[elementIndex];

          if (clickedBubble && clickedBubble.productId) {
            // Use internal navigation instead of page reload
            if (onNavigateToReport) {
              onNavigateToReport({ _id: clickedBubble.productId });
            } else {
              // Fallback to URL navigation if handler not provided
              window.location.href = `/report/${clickedBubble.productId}`;
            }
          }
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: isDarkMode ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
          titleColor: isDarkMode ? '#fff' : '#000',
          bodyColor: isDarkMode ? '#fff' : '#000',
          borderColor: isDarkMode ? '#444' : '#ccc',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            title: (context) => {
              const point = context[0].raw;
              return point.label;
            },
            label: (context) => {
              const point = context.raw;
              // Format currency
              const currencySymbols = {
                'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥', 'CHF': 'Fr',
                'CAD': 'C$', 'AUD': 'A$', 'HKD': 'HK$', 'SGD': 'S$', 'CNY': '¥'
              };
              const currencySymbol = currencySymbols[point.currency] || point.currency + ' ';
              const formattedInvestment = `${currencySymbol}${point.notional.toLocaleString()}`;

              return [
                `Name: ${point.name}`,
                `Investment: ${formattedInvestment}`,
                `Performance: ${point.performance >= 0 ? '+' : ''}${point.performance.toFixed(2)}%`,
                `Distance to Barrier: ${point.y >= 0 ? '+' : ''}${point.y.toFixed(1)}%`,
                `Barrier Level: ${point.barrier}%`,
                `Days to Final Obs: ${point.x}`,
                `Product: ${point.productIsin}`,
                `Title: ${point.productTitle}`,
                ``,
                `💡 Click to view product report`
              ];
            }
          }
        },
        annotation: {
          annotations: {
            barrierLine: {
              type: 'line',
              yMin: 0,
              yMax: 0,
              borderColor: '#ef4444',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                display: true,
                content: 'Barrier Threshold',
                position: 'end',
                backgroundColor: '#ef4444',
                color: '#fff',
                padding: 4,
                font: {
                  size: 11,
                  weight: '600'
                }
              }
            },
            warningZone: {
              type: 'line',
              yMin: 10,
              yMax: 10,
              borderColor: '#f97316',
              borderWidth: 2,
              borderDash: [10, 5],
              label: {
                display: true,
                content: 'Warning Zone',
                position: 'start',
                backgroundColor: '#f97316',
                color: '#fff',
                padding: 4,
                font: {
                  size: 11,
                  weight: '600'
                }
              }
            }
          }
        }
      },
      scales: {
        x: {
          min: minX - xPadding,
          max: maxX + xPadding,
          title: {
            display: true,
            text: 'Days to Final Observation',
            color: '#ffffff',
            font: { size: 14, weight: '600' }
          },
          border: {
            color: '#ffffff'
          },
          grid: {
            color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
          },
          ticks: {
            color: '#ffffff'
          }
        },
        y: {
          min: minY - yPadding,
          max: maxY + yPadding,
          title: {
            display: true,
            text: 'Distance to Barrier (%)',
            color: '#ffffff',
            font: { size: 14, weight: '600' }
          },
          border: {
            color: '#ffffff'
          },
          grid: {
            color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
          },
          ticks: {
            color: '#ffffff',
            callback: function(value) {
              return value >= 0 ? `+${value}%` : `${value}%`;
            }
          }
        }
      }
    };
  }, [bubbleChartData, isDarkMode, onNavigateToReport]);

  if (isLoading()) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '400px',
        color: 'var(--text-secondary)'
      }}>
        Loading underlying data...
      </div>
    );
  }

  return (
    <div style={{
      padding: '2rem',
      background: 'var(--bg-primary)',
      minHeight: '100vh'
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
        borderRadius: '20px',
        padding: '2rem',
        marginBottom: '2rem',
        border: '1px solid var(--border-color)',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <h1 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '2rem',
            fontWeight: '700',
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em'
          }}>
            Phoenix Autocallable - Underlying Assets
          </h1>
          <p style={{
            margin: 0,
            fontSize: '1rem',
            color: 'var(--text-secondary)'
          }}>
            Track performance of underlying assets in live Phoenix products
            {generatedAt && <span> • Generated: {generatedAt}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{
              padding: '0.75rem 1.5rem',
              background: isRefreshing ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '0.95rem',
              fontWeight: '600',
              cursor: isRefreshing ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              opacity: isRefreshing ? 0.6 : 1
            }}
          >
            {isRefreshing ? 'Refreshing...' : '↻ Refresh Analysis'}
          </button>
          <button
            onClick={handleShowLanguageSelector}
            disabled={summary.totalProducts === 0}
            style={{
              padding: '0.75rem 1.5rem',
              background: (summary.totalProducts === 0)
                ? 'var(--bg-tertiary)'
                : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '0.95rem',
              fontWeight: '600',
              cursor: (summary.totalProducts === 0) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              opacity: (summary.totalProducts === 0) ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
            title={
              (summary.totalProducts === 0)
                ? 'No products available'
                : 'Generate Amberlake risk analysis report'
            }
          >
            <span>⚠️</span> Generate Risk Report
          </button>
        </div>
      </div>

      {refreshError && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '12px',
          padding: '1rem',
          marginBottom: '2rem',
          color: '#991b1b'
        }}>
          Error: {refreshError}
        </div>
      )}

      {/* Statistics Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Unique Underlyings
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-primary)' }}>
            {summary.uniqueUnderlyings}
          </div>
        </div>

        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Live Phoenix Products
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-primary)' }}>
            {summary.totalProducts}
          </div>
        </div>

        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Positive Performance
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: '#10b981' }}>
            {summary.positivePerformance}
          </div>
        </div>

        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Negative Performance
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: '#ef4444' }}>
            {summary.negativePerformance}
          </div>
        </div>

        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Warning Zone
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: '#f97316' }}>
            {summary.warningZone}
          </div>
        </div>

        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Below Barrier
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: '#ef4444' }}>
            {summary.belowBarrier}
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '2rem',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search by symbol or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem',
              paddingRight: searchTerm ? '3rem' : '0.75rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontSize: '0.95rem',
              outline: 'none'
            }}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={{
                position: 'absolute',
                right: '0.5rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '1.25rem',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.background = 'var(--bg-tertiary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.background = 'transparent';
              }}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        {searchTerm && (
          <div style={{
            marginTop: '0.75rem',
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            fontWeight: '500'
          }}>
            {filteredAndSortedData.length === 0 ? (
              <span style={{ color: '#ef4444' }}>
                No results found for "{searchTerm}"
              </span>
            ) : (
              <span>
                Found {filteredAndSortedData.length} result{filteredAndSortedData.length !== 1 ? 's' : ''} for "{searchTerm}"
              </span>
            )}
          </div>
        )}
      </div>

      {/* Pagination Controls - Top */}
      {totalItems > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1rem 1.5rem',
          marginBottom: '1rem',
          border: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          {/* Results info */}
          <div style={{
            fontSize: '0.9rem',
            color: 'var(--text-secondary)',
            fontWeight: '500'
          }}>
            Showing {startIndex + 1}-{Math.min(endIndex, totalItems)} of {totalItems} results
          </div>

          {/* Items per page selector */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem'
          }}>
            <label style={{
              fontSize: '0.9rem',
              color: 'var(--text-secondary)',
              fontWeight: '500'
            }}>
              Results per page:
            </label>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
              style={{
                padding: '0.5rem 0.75rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                fontWeight: '600',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="all">All</option>
            </select>
          </div>

          {/* Page navigation */}
          {itemsPerPage !== 'all' && totalPages > 1 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                style={{
                  padding: '0.5rem 1rem',
                  background: currentPage === 1 ? 'var(--bg-tertiary)' : 'var(--accent-color)',
                  color: currentPage === 1 ? 'var(--text-muted)' : 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                ← Previous
              </button>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}>
                {/* Show first page */}
                {currentPage > 3 && (
                  <>
                    <button
                      onClick={() => setCurrentPage(1)}
                      style={{
                        padding: '0.5rem 0.75rem',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      1
                    </button>
                    <span style={{ color: 'var(--text-muted)', padding: '0 0.25rem' }}>...</span>
                  </>
                )}

                {/* Show page numbers around current page */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }

                  if (pageNum < 1 || pageNum > totalPages) return null;
                  if (currentPage > 3 && pageNum === 1) return null;
                  if (currentPage < totalPages - 2 && pageNum === totalPages) return null;

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      style={{
                        padding: '0.5rem 0.75rem',
                        background: currentPage === pageNum ? 'var(--accent-color)' : 'var(--bg-primary)',
                        color: currentPage === pageNum ? 'white' : 'var(--text-primary)',
                        border: currentPage === pageNum ? 'none' : '1px solid var(--border-color)',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                {/* Show last page */}
                {currentPage < totalPages - 2 && (
                  <>
                    <span style={{ color: 'var(--text-muted)', padding: '0 0.25rem' }}>...</span>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      style={{
                        padding: '0.5rem 0.75rem',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      {totalPages}
                    </button>
                  </>
                )}
              </div>

              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                style={{
                  padding: '0.5rem 1rem',
                  background: currentPage === totalPages ? 'var(--bg-tertiary)' : 'var(--accent-color)',
                  color: currentPage === totalPages ? 'var(--text-muted)' : 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Table - Elegant Design matching Phoenix Report */}
      <div style={{
        background: 'linear-gradient(135deg, #334155 0%, #475569 100%)',
        borderRadius: '12px',
        padding: '1px',
        boxShadow: '0 10px 40px rgba(51, 65, 85, 0.2)'
      }}>
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '11px',
          overflow: 'hidden'
        }}>
          {/* Scrollable wrapper for the table */}
          <div style={{
            overflowX: 'auto',
            overflowY: 'hidden',
            maxWidth: '100%'
          }}>
            {/* Table with minimum width to ensure proper display */}
            <div style={{
              minWidth: '1200px'
            }}>
              {/* Table Header - Sleek Dark Header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '0.8fr 1.2fr 0.9fr 0.9fr 0.9fr 1fr 0.9fr 1.5fr',
                gap: '0.75rem',
                padding: '1.25rem 1.5rem',
                background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                borderBottom: '2px solid rgba(148, 163, 184, 0.2)'
              }}>
                <div
                  onClick={() => handleSort('symbol')}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  🏢 Symbol {sortColumn === 'symbol' && (sortDirection === 'asc' ? '↑' : '↓')}
                </div>
                <div
                  onClick={() => handleSort('name')}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  📝 Name {sortColumn === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                </div>
                <div
                  onClick={() => handleSort('currentPrice')}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    textAlign: 'right',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  💵 Current {sortColumn === 'currentPrice' && (sortDirection === 'asc' ? '↑' : '↓')}
                </div>
                <div
                  onClick={() => handleSort('initialPrice')}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    textAlign: 'right',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  📌 Initial {sortColumn === 'initialPrice' && (sortDirection === 'asc' ? '↑' : '↓')}
                </div>
                <div
                  onClick={() => handleSort('performance')}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    textAlign: 'right',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  📈 Performance {sortColumn === 'performance' && (sortDirection === 'asc' ? '↑' : '↓')}
                </div>
                <div
                  onClick={() => handleSort('distanceToBarrier')}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    textAlign: 'right',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  title="Distance to lowest protection barrier"
                >
                  🛡️ Barrier {sortColumn === 'distanceToBarrier' && (sortDirection === 'asc' ? '↑' : '↓')}
                </div>
                <div
                  onClick={() => handleSort('daysToFinalObservation')}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    textAlign: 'right',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  ⏰ Days Left {sortColumn === 'daysToFinalObservation' && (sortDirection === 'asc' ? '↑' : '↓')}
                </div>
                <div
                  onClick={() => handleSort('productIsin')}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  📊 Product {sortColumn === 'productIsin' && (sortDirection === 'asc' ? '↑' : '↓')}
                </div>
              </div>

              {/* Table Rows - Enhanced Visual Hierarchy */}
              {paginatedData.map((underlying, index) => (
                <div
                  key={`${underlying.symbol}-${underlying.productId}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '0.8fr 1.2fr 0.9fr 0.9fr 0.9fr 1fr 0.9fr 1.5fr',
                    gap: '0.75rem',
                    padding: '1rem 1.5rem',
                    borderBottom: index < paginatedData.length - 1 ?
                      '1px solid rgba(148, 163, 184, 0.15)' : 'none',
                    background: 'transparent',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {/* Symbol */}
                  <div style={{
                    fontSize: '0.875rem',
                    color: 'var(--text-primary)',
                    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                    fontWeight: '700'
                  }}>
                    {underlying.symbol}
                  </div>

                  {/* Name */}
                  <div style={{
                    fontSize: '0.875rem',
                    color: 'var(--text-primary)',
                    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                    fontWeight: '600'
                  }}>
                    {underlying.name}
                    {underlying.exchange && (
                      <span style={{
                        marginLeft: '0.5rem',
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)'
                      }}>
                        ({underlying.exchange})
                      </span>
                    )}
                  </div>

                  {/* Current Price */}
                  <div style={{
                    fontSize: '0.875rem',
                    textAlign: 'right',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    fontFamily: '"Inter", -apple-system, system-ui, sans-serif'
                  }}>
                    {underlying.currentPriceFormatted || (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: '400' }}>No data</span>
                    )}
                  </div>

                  {/* Initial Price */}
                  <div style={{
                    fontSize: '0.875rem',
                    textAlign: 'right',
                    color: 'var(--text-secondary)',
                    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                    fontWeight: '600'
                  }}>
                    {underlying.initialPriceFormatted || (
                      <span style={{ fontStyle: 'italic', fontWeight: '400' }}>—</span>
                    )}
                  </div>

                  {/* Performance */}
                  <div style={{
                    fontSize: '0.875rem',
                    textAlign: 'right',
                    fontWeight: '700',
                    color: underlying.performanceColor || 'var(--text-secondary)',
                    fontFamily: '"Inter", -apple-system, system-ui, sans-serif'
                  }}>
                    {underlying.performanceFormatted || (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: '400' }}>—</span>
                    )}
                  </div>

                  {/* Distance to Barrier */}
                  <div
                    style={{
                      fontSize: '0.875rem',
                      textAlign: 'right',
                      fontWeight: '700',
                      color: underlying.distanceToBarrierColor || 'var(--text-secondary)',
                      fontFamily: '"Inter", -apple-system, system-ui, sans-serif'
                    }}
                    title={underlying.lowestBarrier != null ? `Barrier at ${underlying.lowestBarrier}%` : ''}
                  >
                    {underlying.distanceToBarrierFormatted || (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: '400' }}>—</span>
                    )}
                  </div>

                  {/* Days to Final Observation */}
                  <div style={{
                    fontSize: '0.875rem',
                    textAlign: 'right',
                    color: underlying.daysToFinalObservation < 0 ? '#ef4444' : 'var(--text-secondary)',
                    fontWeight: underlying.daysToFinalObservation < 0 ? '700' : '600',
                    fontFamily: '"Inter", -apple-system, system-ui, sans-serif'
                  }}>
                    {underlying.daysToFinalObservationFormatted}
                  </div>

                  {/* Product ISIN and Title */}
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (underlying.productId) {
                        if (onNavigateToReport) {
                          onNavigateToReport({ _id: underlying.productId });
                        } else {
                          window.location.href = `/report/${underlying.productId}`;
                        }
                      }
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '0.7';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '1';
                    }}
                    title="Click to view product report"
                  >
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--accent-color)',
                      fontWeight: '600',
                      fontFamily: 'monospace',
                      textDecoration: 'underline'
                    }}>
                      {underlying.productIsin}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.2',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical'
                    }}>
                      {underlying.productTitle}
                    </div>
                  </div>
                </div>
              ))}

              {totalItems === 0 && (
                <div style={{
                  padding: '3rem',
                  textAlign: 'center',
                  color: 'var(--text-secondary)'
                }}>
                  No underlying assets found
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bubble Chart - Risk Visualization */}
      {bubbleChartData.datasets[0].data.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          padding: '2rem',
          marginTop: '2rem'
        }}>
          <h2 style={{
            margin: '0 0 1.5rem 0',
            fontSize: '1.5rem',
            fontWeight: '700',
            color: 'var(--text-primary)'
          }}>
            Barrier Risk Visualization
          </h2>
          <p style={{
            margin: '0 0 1.5rem 0',
            fontSize: '0.95rem',
            color: 'var(--text-secondary)'
          }}>
            Each bubble represents one product-underlying combination. Bubble size is proportional to the investment amount.
            <br />
            <span style={{ color: '#10b981', fontWeight: '600' }}> Green</span> = safe (&gt;10% above barrier),
            <span style={{ color: '#f97316', fontWeight: '600' }}> Orange</span> = warning zone (0-10% above barrier),
            <span style={{ color: '#ef4444', fontWeight: '600' }}> Red</span> = below barrier (capital at risk).
            <br />
            <span style={{ fontWeight: '600' }}>💡 Click any bubble to view the full product report.</span>
          </p>
          <div style={{ height: '500px', position: 'relative', cursor: 'pointer' }}>
            <Bubble data={bubbleChartData} options={bubbleChartOptions} />
          </div>
        </div>
      )}

      {/* Last Update */}
      {generatedAt && (
        <div style={{
          marginTop: '1rem',
          textAlign: 'center',
          fontSize: '0.875rem',
          color: 'var(--text-secondary)'
        }}>
          Analysis generated: {generatedAt}
        </div>
      )}

      {/* Language Selector Modal */}
      {showLanguageSelector && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            backdropFilter: 'blur(4px)'
          }}
          onClick={handleCloseLanguageSelector}
        >
          <div
            style={{
              background: isDarkMode ? '#1f2937' : '#ffffff',
              borderRadius: '16px',
              padding: '2rem',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{
              margin: '0 0 1.5rem 0',
              fontSize: '1.25rem',
              fontWeight: '700',
              color: isDarkMode ? '#e5e7eb' : '#1f2937',
              textAlign: 'center'
            }}>
              Select Report Language
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <button
                onClick={() => handleGenerateRiskReport('en')}
                style={{
                  padding: '1rem 1.5rem',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '1rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem',
                  transition: 'all 0.2s'
                }}
              >
                <span style={{ fontSize: '1.5rem' }}>🇬🇧</span>
                English
              </button>

              <button
                onClick={() => handleGenerateRiskReport('fr')}
                style={{
                  padding: '1rem 1.5rem',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '1rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem',
                  transition: 'all 0.2s'
                }}
              >
                <span style={{ fontSize: '1.5rem' }}>🇫🇷</span>
                Français
              </button>

              <button
                onClick={handleCloseLanguageSelector}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: isDarkMode ? '#374151' : '#e5e7eb',
                  color: isDarkMode ? '#e5e7eb' : '#1f2937',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  marginTop: '0.5rem'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Risk Report Modal */}
      {isRiskReportModalOpen && (
        <RiskReportModal
          report={riskReport}
          onClose={handleCloseRiskReport}
          isGenerating={isGeneratingRiskReport}
          progress={
            riskReportError
              ? `Error: ${riskReportError}`
              : isGeneratingRiskReport
              ? 'Analyzing underlyings and searching for news...'
              : null
          }
        />
      )}
    </div>
  );
};

export default UnderlyingsView;
