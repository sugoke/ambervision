import React, { useState, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker, useSubscribe } from 'meteor/react-meteor-data';
import { UnderlyingsAnalysisCollection } from '/imports/api/underlyingsAnalysis';
import { RiskAnalysisReportsCollection } from '/imports/api/riskAnalysis';
import { AllocationsCollection } from '/imports/api/allocations';
import { USER_ROLES } from '/imports/api/users';
import { useTheme } from './ThemeContext.jsx';
import { useViewAs } from './ViewAsContext.jsx';
import { Bubble } from 'react-chartjs-2';
import RiskReportModal from './components/RiskReportModal.jsx';
import CustomDateInput from './components/CustomDateInput.jsx';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import { useIsMobile } from './hooks/useIsMobile.js';
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

const asOfStringToDate = (s) => (s ? new Date(`${s}T23:59:59.999`) : null);

const UnderlyingsView = ({ user, onNavigateToReport }) => {
  const { isDarkMode } = useTheme();
  const isMobile = useIsMobile();
  const { viewAsFilter } = useViewAs();
  // Rebuilding the analysis and the AI risk report are staff actions
  const canRunAnalysis = user?.role !== USER_ROLES.CLIENT;
  const [sortColumn, setSortColumn] = useState('symbol');
  const [sortDirection, setSortDirection] = useState('asc');
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [activeTab, setActiveTab] = useState('table'); // 'table' | 'chart'

  // As-of historical date ('' = live). Stored as YYYY-MM-DD string from <input type="date">.
  const [asOfDateStr, setAsOfDateStr] = useState('');
  const [historicalAnalysis, setHistoricalAnalysis] = useState(null);
  const [isLoadingHistorical, setIsLoadingHistorical] = useState(false);

  // Risk Report State
  const [isRiskReportModalOpen, setIsRiskReportModalOpen] = useState(false);
  const [isGeneratingRiskReport, setIsGeneratingRiskReport] = useState(false);
  const [riskReportId, setRiskReportId] = useState(null);
  const [riskReportError, setRiskReportError] = useState(null);
  const [reportLanguage, setReportLanguage] = useState('en'); // 'en' or 'fr'
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);

  const sessionId = useMemo(() => localStorage.getItem('sessionId'), []);

  // Subscribe to the pre-computed analysis (the publication needs the session to authorize)
  const isLoading = useSubscribe('phoenixUnderlyingsAnalysis', sessionId);

  // Subscribe to allocations for ViewAs filtering and compute accessible product IDs.
  // Subscribe + read live inside the same autorun so that if ViewAsContext or anything
  // else stops the sub externally, the reactive find().fetch() re-fires the autorun
  // and re-creates the subscription with the current viewAsFilter.
  const { accessibleProductIds, allocationsReady } = useTracker(() => {
    const handle = Meteor.subscribe('allAllocations', sessionId, viewAsFilter);
    const ready = handle.ready();
    if (!viewAsFilter) return { accessibleProductIds: null, allocationsReady: ready };
    const allocs = AllocationsCollection.find().fetch();
    const productIds = [...new Set(allocs.map(a => a.productId))];
    return { accessibleProductIds: productIds, allocationsReady: ready };
  }, [sessionId, viewAsFilter]);

  // Get the live analysis from database (NO client-side calculations)
  const liveAnalysis = useTracker(() => {
    const analysis = UnderlyingsAnalysisCollection.findOne({ _id: 'phoenix_live_underlyings' });
    return analysis || null;
  }, []);

  // When an as-of date is selected, swap the data source to the on-demand historical result
  const analysisData = asOfDateStr ? historicalAnalysis : liveAnalysis;

  // Fetch historical analysis whenever the as-of date changes
  React.useEffect(() => {
    if (!asOfDateStr) {
      setHistoricalAnalysis(null);
      setRefreshError(null);
      return;
    }
    let cancelled = false;
    const asOfDate = asOfStringToDate(asOfDateStr);
    setIsLoadingHistorical(true);
    setRefreshError(null);
    Meteor.callAsync('underlyingsAnalysis.generateAsOf', asOfDate, sessionId)
      .then((doc) => {
        if (!cancelled) setHistoricalAnalysis(doc);
      })
      .catch((err) => {
        console.error('Error generating historical analysis:', err);
        if (!cancelled) {
          setHistoricalAnalysis(null);
          setRefreshError(err.message || err.reason || 'Failed to load historical analysis');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistorical(false);
      });
    return () => { cancelled = true; };
  }, [asOfDateStr, sessionId]);

  // Live mode: gate by ACTUAL bank holdings (source of truth). A product that
  // was sold or matured leaves the holdings feed, so it must not appear here even
  // if a stale allocation still references it. heldProductIds is scoped to the
  // current viewAsFilter (null = admin global "held by any client").
  // null = not yet loaded (show none rather than a misleading "all").
  const [heldProductIds, setHeldProductIds] = useState(null);
  React.useEffect(() => {
    // Historical mode keeps its own as-of scoping below; skip the live holdings fetch.
    if (asOfDateStr) return;
    setHeldProductIds(null);
    let cancelled = false;
    Meteor.callAsync('holdings.getHeldProductIds', { sessionId, viewAsFilter })
      .then(ids => { if (!cancelled) setHeldProductIds(new Set(ids)); })
      .catch(err => {
        console.error('[Underlyings] Failed to load held product ids:', err);
        if (!cancelled) setHeldProductIds(new Set());
      });
    return () => { cancelled = true; };
  }, [sessionId, viewAsFilter, asOfDateStr]);

  // Extract data from analysis (all pre-computed server-side)
  const allUnderlyingsData = analysisData?.underlyings || [];
  const underlyingsData = useMemo(() => {
    if (asOfDateStr) {
      // Historical (as-of) mode: keep the allocation-based scoping so a past-date
      // view shows what was held then, not what is held today.
      if (!viewAsFilter) return allUnderlyingsData;
      if (!allocationsReady) return [];
      return allUnderlyingsData.filter(u => accessibleProductIds.includes(u.productId));
    }
    // Live mode: show only products currently held in scope.
    if (!heldProductIds) return [];
    return allUnderlyingsData.filter(u => heldProductIds.has(u.productId));
  }, [allUnderlyingsData, accessibleProductIds, allocationsReady, viewAsFilter, asOfDateStr, heldProductIds]);

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
      if (asOfDateStr) {
        const doc = await Meteor.callAsync(
          'underlyingsAnalysis.generateAsOf',
          asOfStringToDate(asOfDateStr),
          sessionId
        );
        setHistoricalAnalysis(doc);
      } else {
        await Meteor.callAsync('underlyingsAnalysis.generate', sessionId);
      }
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

      const asOfDate = asOfStringToDate(asOfDateStr);
      console.log(`Generating risk analysis report in ${language}${asOfDate ? ` as of ${asOfDateStr}` : ''}...`);
      const result = await Meteor.callAsync('riskAnalysis.generate', sessionId, language, asOfDate);

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
    // Keep the barrier (0%) and warning (+10%) lines always in view
    const minY = Math.min(...yValues, 0);
    const maxY = Math.max(...yValues, 10);
    const maxRadius = Math.max(...radiuses);

    // Add padding based on largest bubble radius (convert radius to percentage of axis range)
    const xRange = maxX - minX || 100;
    const yRange = maxY - minY || 100;
    const xPadding = Math.max(xRange * 0.05, maxRadius * 2);
    const yPadding = Math.max(yRange * 0.08, maxRadius * 1.5);

    // Round the bounds to a "nice" step so the edge ticks read 0, 100, +200%… not 60.8 / 205.8119…
    const niceStep = (range, targetTicks) => {
      const raw = range / targetTicks;
      const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
      const normalized = raw / magnitude;
      const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
      return factor * magnitude;
    };
    const xStep = niceStep(xRange + 2 * xPadding, 8);
    const yStep = niceStep(yRange + 2 * yPadding, 10);
    const xMinRaw = minX - xPadding;
    const xMin = minX >= 0 && xMinRaw < 0 ? 0 : Math.floor(xMinRaw / xStep) * xStep;
    const xMax = Math.ceil((maxX + xPadding) / xStep) * xStep;
    const yMin = Math.floor((minY - yPadding) / yStep) * yStep;
    const yMax = Math.ceil((maxY + yPadding) / yStep) * yStep;

    const axisTitleColor = isDarkMode ? '#e5e7eb' : '#374151';
    const tickColor = isDarkMode ? '#9ca3af' : '#6b7280';
    const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)';
    const axisBorderColor = isDarkMode ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)';

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
              // Canvas cannot resolve CSS variables, so the colour must be literal
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
          min: xMin,
          max: xMax,
          title: {
            display: true,
            text: 'Days to Final Observation',
            color: axisTitleColor,
            font: { size: 13, weight: '600' },
            padding: { top: 10 }
          },
          border: {
            color: axisBorderColor
          },
          grid: {
            color: gridColor
          },
          ticks: {
            color: tickColor,
            stepSize: xStep,
            font: { size: 12 },
            callback: (value) => `${Math.round(value)}d`
          }
        },
        y: {
          min: yMin,
          max: yMax,
          title: {
            display: true,
            text: 'Distance to Barrier (%)',
            color: axisTitleColor,
            font: { size: 13, weight: '600' },
            padding: { bottom: 10 }
          },
          border: {
            color: axisBorderColor
          },
          grid: {
            color: (ctx) => (ctx.tick && ctx.tick.value === 0 ? 'transparent' : gridColor)
          },
          ticks: {
            color: tickColor,
            stepSize: yStep,
            font: { size: 12 },
            callback: (value) => {
              const rounded = Math.round(value * 10) / 10;
              return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
            }
          }
        }
      }
    };
  }, [bubbleChartData, isDarkMode, onNavigateToReport]);

  if (isLoading() || (asOfDateStr && isLoadingHistorical && !historicalAnalysis)) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '400px',
        color: 'var(--text-secondary)'
      }}>
        {asOfDateStr ? `Loading underlying data as of ${asOfDateStr}...` : 'Loading underlying data...'}
      </div>
    );
  }

  // Same visual language as the PMS screen: one banded header card, a quiet
  // tab bar with an amber underline, compact toolbars and a hairline table.
  const eyebrowStyle = {
    fontSize: '0.75rem',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--text-muted)',
    marginBottom: '0.4rem'
  };

  const bandStyle = (isFirst = false) => ({
    padding: isMobile ? '0.875rem 1rem' : '0.875rem 1.25rem',
    // Keep right-aligned controls clear of the fixed right-hand navigation rail
    paddingRight: isMobile ? '1rem' : '4.5rem',
    borderTop: isFirst ? 'none' : '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    justifyContent: 'space-between',
    alignItems: isMobile ? 'stretch' : 'center',
    gap: isMobile ? '0.875rem' : '1.5rem',
    flexWrap: 'wrap'
  });

  const toolbarControlStyle = {
    padding: '0.5rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontSize: '0.75rem'
  };

  const secondaryButtonStyle = (disabled) => ({
    padding: '0.5rem 0.875rem',
    background: 'var(--bg-primary)',
    color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '9px',
    fontSize: '0.8125rem',
    fontWeight: '600',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
    width: isMobile ? '100%' : 'auto'
  });

  const primaryButtonStyle = (disabled) => ({
    padding: '0.5rem 0.875rem',
    background: disabled ? 'var(--bg-tertiary)' : 'var(--accent-color)',
    color: disabled ? 'var(--text-muted)' : 'var(--accent-contrast)',
    border: `1px solid ${disabled ? 'var(--border-color)' : 'var(--accent-color)'}`,
    borderRadius: '9px',
    fontSize: '0.8125rem',
    fontWeight: '600',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
    width: isMobile ? '100%' : 'auto'
  });

  const pageButtonStyle = (disabled, active = false) => ({
    ...toolbarControlStyle,
    padding: '0.375rem 0.625rem',
    background: active ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
    color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
    fontWeight: active ? '600' : '400',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1
  });

  const kpis = [
    { label: 'Unique underlyings', value: summary.uniqueUnderlyings, color: 'var(--text-primary)' },
    { label: 'Live barrier products', value: summary.totalProducts, color: 'var(--text-primary)' },
    { label: 'Positive performance', value: summary.positivePerformance, color: 'var(--gain-color)' },
    { label: 'Negative performance', value: summary.negativePerformance, color: 'var(--loss-color)' },
    { label: 'Warning zone', value: summary.warningZone, color: 'var(--warning-color)' },
    { label: 'Below barrier', value: summary.belowBarrier, color: 'var(--loss-color)' }
  ];

  const tableColumns = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'name', label: 'Name' },
    { key: 'currentPrice', label: 'Current', align: 'right' },
    { key: 'initialPrice', label: 'Initial', align: 'right' },
    { key: 'performance', label: 'Performance', align: 'right' },
    { key: 'distanceToBarrier', label: 'To barrier', align: 'right', title: 'Distance to lowest protection barrier' },
    { key: 'daysToFinalObservation', label: 'Days left', align: 'right' },
    { key: 'productIsin', label: 'Product' }
  ];

  const viewTabs = [
    { id: 'table', icon: '📋', label: 'Underlyings', count: totalItems },
    { id: 'chart', icon: '🫧', label: 'Barrier Risk Chart', count: bubbleChartData.datasets[0].data.length }
  ];

  const openProductReport = (productId) => {
    if (!productId) return;
    if (onNavigateToReport) {
      onNavigateToReport({ _id: productId });
    } else {
      window.location.href = `/report/${productId}`;
    }
  };

  const cellStyle = (align = 'left') => ({
    padding: '0.75rem',
    fontSize: '0.875rem',
    textAlign: align,
    color: 'var(--text-primary)',
    verticalAlign: 'middle'
  });

  return (
    <div style={{
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '2rem 1rem'
    }}>
      {/* ── Header card ─────────────────────────────────────────────── */}
      <div style={{
        marginBottom: '1.5rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        overflow: 'visible'
      }}>
        {/* Band 1: title + as-of date */}
        <div style={bandStyle(true)}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{
              margin: 0,
              fontFamily: 'var(--font-serif)',
              fontSize: isMobile ? '1.5rem' : '1.875rem',
              fontWeight: '500',
              letterSpacing: '0.2px',
              color: 'var(--text-primary)',
              lineHeight: '1.15'
            }}>
              Underlyings
            </h1>
            <div style={{
              marginTop: '4px',
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              flexWrap: 'wrap'
            }}>
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%', flex: 'none',
                background: asOfDateStr ? 'var(--warning-color)' : 'var(--gain-color)',
                boxShadow: `0 0 0 3px color-mix(in srgb, ${asOfDateStr ? 'var(--warning-color)' : 'var(--gain-color)'} 18%, transparent)`
              }} />
              <span>
                {asOfDateStr
                  ? `Barrier-protected products as of ${asOfDateStr}`
                  : 'Live barrier-protected products · capital-guaranteed excluded'}
                {generatedAt && ` · Generated ${generatedAt}`}
              </span>
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ ...eyebrowStyle, textAlign: isMobile ? 'left' : 'right' }}>
              <label htmlFor="underlyings-asof-date">As of</label>
            </div>
            <div style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
              justifyContent: isMobile ? 'flex-start' : 'flex-end'
            }}>
              <CustomDateInput
                id="underlyings-asof-date"
                value={asOfDateStr}
                onChange={(e) => {
                  const v = e.target.value;
                  const today = new Date().toISOString().slice(0, 10);
                  setAsOfDateStr(v && v > today ? today : v);
                }}
                placeholder="DD/MM/YYYY"
                style={{ width: '160px' }}
                className="underlyings-asof-input"
              />
              {asOfDateStr && (
                <button
                  onClick={() => setAsOfDateStr('')}
                  title="Switch back to live"
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    color: 'var(--warning-color)',
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    fontWeight: '600',
                    whiteSpace: 'nowrap'
                  }}
                >
                  ↻ Live
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Band 2: key figures */}
        <div style={{
          ...bandStyle(),
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, minmax(0, 1fr))',
          gap: isMobile ? '0.875rem' : '1.5rem'
        }}>
          {kpis.map(kpi => (
            <div key={kpi.label} style={{ minWidth: 0 }}>
              <div style={eyebrowStyle}>{kpi.label}</div>
              <div className="tnum" style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '1.75rem',
                fontWeight: '500',
                lineHeight: '1.1',
                color: kpi.color
              }}>
                {kpi.value}
              </div>
            </div>
          ))}
        </div>

        {/* Band 3: staff actions */}
        {canRunAnalysis && (
          <div style={{ ...bandStyle(), justifyContent: 'flex-end' }}>
            <div style={{
              display: isMobile ? 'grid' : 'flex',
              gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
              gap: '0.5rem',
              alignItems: 'center'
            }}>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                style={secondaryButtonStyle(isRefreshing)}
              >
                {isRefreshing ? 'Refreshing...' : '↻ Refresh analysis'}
              </button>
              <button
                onClick={handleShowLanguageSelector}
                disabled={summary.totalProducts === 0}
                style={primaryButtonStyle(summary.totalProducts === 0)}
                title={summary.totalProducts === 0 ? 'No products available' : 'Generate Amberlake risk analysis report'}
              >
                Risk Report ▾
              </button>
            </div>
          </div>
        )}
      </div>

      {refreshError && (
        <div style={{
          marginBottom: '1.5rem',
          padding: '0.75rem 1rem',
          borderRadius: '9px',
          border: '1px solid color-mix(in srgb, var(--loss-color) 35%, transparent)',
          background: 'color-mix(in srgb, var(--loss-color) 10%, transparent)',
          color: 'var(--loss-color)',
          fontSize: '0.875rem'
        }}>
          Error: {refreshError}
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <LiquidGlassCard style={{ marginBottom: '2rem' }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          padding: '0.75rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          {viewTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '0.7rem 1rem',
                background: 'transparent',
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent-color)' : '2px solid transparent',
                borderRadius: 0,
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.85rem',
                letterSpacing: '0.2px',
                transition: 'color 0.16s ease, border-color 0.16s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                flex: '1 1 auto',
                minWidth: 'fit-content',
                justifyContent: 'center'
              }}
              onMouseEnter={(e) => { if (activeTab !== tab.id) e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { if (activeTab !== tab.id) e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <span style={{ fontSize: '1.1rem' }}>{tab.icon}</span>
              <span>{tab.label}</span>
              <span className="tnum" style={{ fontSize: '0.75rem', fontWeight: '500', color: 'var(--text-muted)' }}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div style={{ padding: isMobile ? '1rem' : '1.25rem' }}>
          {activeTab === 'table' && (
            <>
              {/* Toolbar */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
                flexWrap: 'wrap',
                gap: '1rem'
              }}>
                <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                  Underlying Assets
                </h3>

                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Search symbol or name..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ ...toolbarControlStyle, width: isMobile ? '100%' : '220px', paddingRight: searchTerm ? '1.75rem' : '0.75rem', outline: 'none' }}
                    />
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm('')}
                        title="Clear search"
                        style={{
                          position: 'absolute', right: '0.4rem', top: '50%', transform: 'translateY(-50%)',
                          background: 'transparent', border: 'none', color: 'var(--text-muted)',
                          cursor: 'pointer', fontSize: '0.85rem', padding: '0 0.2rem'
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <select
                    value={itemsPerPage}
                    onChange={(e) => setItemsPerPage(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                    style={{ ...toolbarControlStyle, cursor: 'pointer' }}
                    title="Rows per page"
                  >
                    <option value="10">10 per page</option>
                    <option value="25">25 per page</option>
                    <option value="50">50 per page</option>
                    <option value="100">100 per page</option>
                    <option value="all">All</option>
                  </select>

                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {searchTerm
                      ? `${totalItems} of ${underlyingsData.length} underlyings`
                      : `${totalItems} underlyings`}
                  </span>
                </div>
              </div>

              {/* Table */}
              <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '9px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '980px' }}>
                  <thead>
                    <tr>
                      {tableColumns.map(col => (
                        <th
                          key={col.key}
                          onClick={() => handleSort(col.key)}
                          title={col.title}
                          style={{
                            padding: '0.625rem 0.75rem',
                            textAlign: col.align || 'left',
                            fontSize: '0.75rem',
                            fontWeight: '500',
                            color: sortColumn === col.key ? 'var(--text-primary)' : 'var(--text-muted)',
                            background: 'var(--bg-tertiary)',
                            borderBottom: '1px solid var(--border-color)',
                            cursor: 'pointer',
                            userSelect: 'none',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {col.label}{sortColumn === col.key && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedData.map((underlying, index) => (
                      <tr
                        key={`${underlying.symbol}-${underlying.productId}`}
                        style={{
                          borderBottom: index < paginatedData.length - 1 ? '1px solid var(--border-color)' : 'none',
                          transition: 'background 0.15s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ ...cellStyle(), fontWeight: '600', whiteSpace: 'nowrap' }}>
                          {underlying.symbol}
                        </td>
                        <td style={cellStyle()}>
                          {underlying.name}
                          {underlying.exchange && (
                            <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {underlying.exchange}
                            </span>
                          )}
                        </td>
                        <td className="tnum" style={cellStyle('right')}>
                          {underlying.currentPriceFormatted || (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No data</span>
                          )}
                        </td>
                        <td className="tnum" style={{ ...cellStyle('right'), color: 'var(--text-secondary)' }}>
                          {underlying.initialPriceFormatted || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td className="tnum" style={{ ...cellStyle('right'), fontWeight: '600', color: underlying.performanceColor || 'var(--text-secondary)' }}>
                          {underlying.performanceFormatted || <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>—</span>}
                        </td>
                        <td
                          className="tnum"
                          style={{ ...cellStyle('right'), fontWeight: '600', color: underlying.distanceToBarrierColor || 'var(--text-secondary)' }}
                          title={underlying.lowestBarrier != null ? `Barrier at ${underlying.lowestBarrier}%` : ''}
                        >
                          {underlying.distanceToBarrierFormatted || <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>—</span>}
                        </td>
                        <td className="tnum" style={{
                          ...cellStyle('right'),
                          color: underlying.daysToFinalObservation < 0 ? 'var(--loss-color)' : 'var(--text-secondary)',
                          fontWeight: underlying.daysToFinalObservation < 0 ? '600' : '400'
                        }}>
                          {underlying.daysToFinalObservationFormatted}
                        </td>
                        <td style={{ ...cellStyle(), maxWidth: '280px' }}>
                          <button
                            type="button"
                            onClick={() => openProductReport(underlying.productId)}
                            title="Open the product report"
                            style={{
                              display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start',
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                              maxWidth: '100%'
                            }}
                          >
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--accent-color)', fontWeight: '500' }}>
                              {underlying.productIsin}
                            </span>
                            <span style={{
                              fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.3',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%'
                            }}>
                              {underlying.productTitle}
                            </span>
                          </button>
                        </td>
                      </tr>
                    ))}

                    {totalItems === 0 && (
                      <tr>
                        <td colSpan={tableColumns.length} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                          {searchTerm ? `No underlyings match "${searchTerm}"` : 'No underlying assets found'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {itemsPerPage !== 'all' && totalPages > 1 && (
                <div style={{
                  marginTop: '1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {startIndex + 1}–{Math.min(endIndex, totalItems)} of {totalItems}
                  </span>
                  <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                    <button
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      style={pageButtonStyle(currentPage === 1)}
                    >
                      ← Previous
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                      .map((p, i, arr) => (
                        <React.Fragment key={p}>
                          {i > 0 && p - arr[i - 1] > 1 && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>…</span>
                          )}
                          <button
                            onClick={() => setCurrentPage(p)}
                            style={pageButtonStyle(false, p === currentPage)}
                          >
                            {p}
                          </button>
                        </React.Fragment>
                      ))}
                    <button
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      style={pageButtonStyle(currentPage === totalPages)}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'chart' && (
            bubbleChartData.datasets[0].data.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No underlyings with a barrier and market data to plot
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.125rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                    Barrier Risk
                  </h3>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                    One bubble per product and underlying, sized by the amount invested.{' '}
                    <span style={{ color: 'var(--gain-color)', fontWeight: '600' }}>Green</span> more than 10% above the barrier,{' '}
                    <span style={{ color: 'var(--warning-color)', fontWeight: '600' }}>orange</span> within 10%,{' '}
                    <span style={{ color: 'var(--loss-color)', fontWeight: '600' }}>red</span> below it (capital at risk).
                    {' '}Click a bubble to open the product report.
                  </div>
                </div>
                <div style={{ height: isMobile ? '420px' : '620px', position: 'relative', cursor: 'pointer' }}>
                  <Bubble data={bubbleChartData} options={bubbleChartOptions} />
                </div>
              </>
            )
          )}
        </div>
      </LiquidGlassCard>

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
                  background: 'linear-gradient(135deg, var(--info-color) 0%, #2563eb 100%)',
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
