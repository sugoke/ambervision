import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';
import CopyableISIN from '../components/CopyableISIN.jsx';
import PriceSparkline from '../components/PriceSparkline.jsx';
import { getTranslation, t } from '../../utils/reportTranslations';
import { useIsMobile } from '../hooks/useIsMobile.js';
import ScheduleCardsMobile from '../components/reports/ScheduleCardsMobile.jsx';

/**
 * Phoenix Autocallable Report Component
 *
 * Displays comprehensive evaluation results for Phoenix Autocallable products.
 * Shows underlying performance, autocall barriers, memory coupons, protection levels,
 * observation schedule, and detailed charts.
 * Supports multiple languages (EN/FR) via URL parameter.
 */
const PhoenixReport = ({ results, productId, product }) => {
  // Get language from URL params
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const lang = urlParams?.get('lang') || 'en';
  const tr = getTranslation(lang);

  const phoenixParams = results.phoenixStructure || {};
  const status = results.currentStatus || {};
  const features = results.features || {};
  const placeholder = results.placeholderResults || {};
  const underlyings = results.underlyings || [];

  // Data-quality issues recorded during evaluation. These change how the numbers below
  // should be read (e.g. a price feed that doesn't match the term sheet), so they belong
  // on the report itself and not only on the dashboard's hover badge.
  const processingIssues = product?.processingIssues || [];
  const blockingIssues = processingIssues.filter(i => i.severity === 'error' || i.severity === 'warning');

  // Viewport detection — shared hook (handles resize + orientationchange)
  const isMobile = useIsMobile();
  const isBelowDesktop = useIsMobile(1024);
  const isTablet = !isMobile && isBelowDesktop;

  // Observation-row states, computed ONCE (they were previously recomputed
  // inside the row map — O(n²) findIndex/reduce per render)
  const observations = results.observationAnalysis?.observations || [];
  const obsRowMeta = React.useMemo(() => {
    const firstCallIndex = observations.findIndex(o => o.productCalled && o.hasOccurred);
    const finalIndex = observations.length - 1;
    const redemptionIndex = firstCallIndex !== -1 ? firstCallIndex :
      (observations[finalIndex]?.hasOccurred ? finalIndex : -1);
    const lastOccurredIndex = observations.reduce(
      (lastIdx, o, idx) => (o.hasOccurred ? idx : lastIdx), -1
    );
    return { redemptionIndex, finalIndex, lastOccurredIndex };
  }, [observations]);

  // Observation table grid template — shared by the header and every row
  const obsGridTemplate = React.useMemo(() => {
    const hasMemoryAutocall = results.observationAnalysis?.hasMemoryAutocall;
    const hasGuaranteedCoupon = results.observationAnalysis?.hasGuaranteedCoupon;
    // Base columns: Observation, Payment, Type, Trigger, Autocall, Coupon
    // Optional: Memory (only if NOT guaranteed coupon), Memory Lock (only if hasMemoryAutocall)
    if (hasGuaranteedCoupon) {
      return hasMemoryAutocall
        ? '1.2fr 1.2fr 1.5fr 1fr 1fr 1fr 1.3fr'
        : '1.2fr 1.2fr 1.5fr 1fr 1fr 1fr';
    }
    return hasMemoryAutocall
      ? '1.2fr 1.2fr 1.5fr 1fr 1fr 1fr 1fr 1.3fr'
      : '1.2fr 1.2fr 1.5fr 1fr 1fr 1fr 1fr';
  }, [results.observationAnalysis]);

  return (
    <div>
      {/* Data-quality banner — shown above everything because it qualifies every figure below */}
      {blockingIssues.length > 0 && (
        <div
          className="pdf-card"
          style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            borderLeft: '4px solid var(--warning-color)',
            borderRadius: '8px',
            padding: '14px 16px',
            marginBottom: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '16px' }}>⚠️</span>
            <span style={{ fontWeight: '700', fontSize: '13px', color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {tr.dataQualityWarning || 'Data quality'}
            </span>
          </div>
          <ul style={{ margin: 0, paddingLeft: '24px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.6 }}>
            {blockingIssues.map((issue, idx) => (
              <li key={issue.code ? `${issue.code}-${idx}` : idx}>{issue.message}</li>
            ))}
          </ul>
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            {tr.dataQualityWarningHint || 'Figures below may not reflect the term sheet until this is resolved.'}
          </div>
        </div>
      )}

      {/* Underlying Assets Performance Card */}
      {underlyings.length > 0 && (
        <div className="pdf-card" style={{
          background: 'var(--bg-primary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            📊 {tr.underlyingAssetsPerformance}
          </h4>

          <div style={{
            display: 'grid',
            gap: '1rem'
          }}>
            {underlyings.map((underlying, index) => (
              isMobile ? (
                /* Mobile: dense position-row card - one glance per underlying */
                <div key={underlying.id || index} style={{
                  background: 'var(--bg-tertiary)',
                  padding: '0.85rem',
                  borderRadius: '8px',
                  border: underlying.isWorstPerforming
                    ? '2px solid var(--loss-color)'
                    : '1px solid var(--border-color)'
                }}>
                  {/* Row 1: logo + ticker/name + performance */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{
                      width: '34px', height: '34px', borderRadius: '7px', overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--bg-primary)', border: '1px solid var(--border-color)', flexShrink: 0
                    }}>
                      <img
                        src={`https://financialmodelingprep.com/image-stock/${underlying.ticker}.png`}
                        alt={underlying.ticker}
                        style={{ width: '26px', height: '26px', objectFit: 'contain' }}
                        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                      />
                      <div style={{
                        display: 'none', width: '26px', height: '26px', background: 'var(--accent-color)',
                        borderRadius: '4px', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.7rem', fontWeight: '600', color: 'white'
                      }}>
                        {underlying.ticker?.substring(0, 2).toUpperCase()}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.95rem', fontWeight: '700', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                          {underlying.ticker}
                        </span>
                        {underlying.hasMemoryAutocallFlag && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--gain-color)' }}
                            title={`${tr.flaggedForMemoryAutocall} ${underlying.memoryAutocallFlaggedDateFormatted || 'N/A'}`}>&#128274;</span>
                        )}
                        {underlying.isWorstPerforming && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--loss-color)' }} title={tr.worstPerforming}>&#9888;&#65039;</span>
                        )}
                      </div>
                      <div style={{
                        fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        {underlying.name}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '1.15rem', fontWeight: '700', fontFamily: 'monospace', flexShrink: 0,
                      color: underlying.isPositive ? 'var(--gain-color)' : 'var(--loss-color)'
                    }}>
                      {underlying.performanceFormatted}
                    </div>
                  </div>

                  {/* Row 2: initial -> current levels + sparkline */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '0.6rem', marginTop: '0.6rem'
                  }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace', minWidth: 0 }}>
                      <span>{underlying.initialPriceFormatted}</span>
                      <span style={{ color: 'var(--text-muted)', margin: '0 0.3rem' }}>&#8594;</span>
                      <span style={{ fontWeight: '700', color: underlying.hasCurrentData ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {underlying.currentPriceFormatted}
                      </span>
                      {underlying.priceDateFormatted && (
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                          {underlying.priceLevelLabel || tr.currentLevel} &middot; {underlying.priceDateFormatted}
                        </div>
                      )}
                    </div>
                    {underlying.sparklineData?.hasData && (
                      /* Fixed width: the sparkline canvas otherwise expands and
                         pushes the whole card wider than the phone viewport */
                      <div style={{ flexShrink: 0, width: '110px', overflow: 'hidden' }}>
                        <PriceSparkline
                          sparklineData={underlying.sparklineData}
                          ticker={underlying.ticker}
                          initialPrice={underlying.initialPrice}
                          currency={underlying.currency}
                          isPositive={underlying.isPositive}
                        />
                      </div>
                    )}
                  </div>

                  {/* Row 3: barrier chip */}
                  <div style={{
                    marginTop: '0.6rem',
                    padding: '0.35rem 0.6rem',
                    borderRadius: '999px',
                    textAlign: 'center',
                    fontSize: '0.72rem',
                    fontWeight: '600',
                    fontFamily: 'monospace',
                    background: underlying.barrierStatus === 'breached' ? 'rgba(239, 68, 68, 0.12)' :
                               underlying.barrierStatus === 'near' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                    color: underlying.barrierStatus === 'breached' ? 'var(--loss-color)' :
                           underlying.barrierStatus === 'near' ? 'var(--warning-color)' : 'var(--gain-color)',
                    border: `1px solid ${
                      underlying.barrierStatus === 'breached' ? 'rgba(239, 68, 68, 0.3)' :
                      underlying.barrierStatus === 'near' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)'
                    }`
                  }}>
                    {tr.barrierDistance}: {underlying.distanceToBarrierFormatted} &middot; {underlying.barrierStatusText}
                  </div>
                </div>
              ) : (
              <div key={underlying.id || index} style={{
                background: 'var(--bg-tertiary)',
                padding: '1.25rem',
                borderRadius: '8px',
                border: underlying.isWorstPerforming
                  ? '2px solid var(--loss-color)'
                  : `1px solid ${underlying.isPositive ? 'var(--gain-color)' : 'var(--loss-color)'}20`,
                boxShadow: underlying.isWorstPerforming
                  ? '0 0 0 1px rgba(239, 68, 68, 0.1)'
                  : 'none'
              }}>
                {/* Header Section - Logo, Ticker, Company Name */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid var(--border-color)'
                }}>
                  {/* Stock Logo */}
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    flexShrink: 0
                  }}>
                    <img
                      src={`https://financialmodelingprep.com/image-stock/${underlying.ticker}.png`}
                      alt={underlying.ticker}
                      style={{
                        width: '36px',
                        height: '36px',
                        objectFit: 'contain'
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                    <div style={{
                      display: 'none',
                      width: '36px',
                      height: '36px',
                      background: 'var(--accent-color)',
                      borderRadius: '4px',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.9rem',
                      fontWeight: '600',
                      color: 'white'
                    }}>
                      {underlying.ticker?.substring(0, 2).toUpperCase()}
                    </div>
                  </div>

                  {/* Company Info */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minWidth: 0
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.25rem'
                    }}>
                      <div style={{
                        fontSize: '1rem',
                        fontWeight: '700',
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace'
                      }}>
                        {underlying.ticker}
                      </div>
                      {underlying.hasMemoryAutocallFlag && (
                        <span
                          style={{
                            fontSize: '0.9rem',
                            color: 'var(--gain-color)',
                            cursor: 'help'
                          }}
                          title={`${tr.flaggedForMemoryAutocall} ${underlying.memoryAutocallFlaggedDateFormatted || 'N/A'}`}
                        >
                          🔒
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-primary)',
                      lineHeight: '1.3',
                      marginBottom: '0.35rem',
                      fontWeight: '500'
                    }}>
                      {underlying.name}
                    </div>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      <span>{underlying.exchange}</span>
                      <span>{underlying.currency}</span>
                      {underlying.isin && (
                        <CopyableISIN isin={underlying.isin} prefix="ISIN: " />
                      )}
                    </div>
                  </div>
                </div>

                {/* Data Grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: isMobile ? '0.75rem' : '1.25rem',
                  alignItems: 'start'
                }}>

                  {/* Initial Level */}
                  <div style={{
                    background: 'var(--bg-primary)',
                    padding: '0.85rem',
                    borderRadius: '6px',
                    textAlign: 'center'
                  }}>
                    <div style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600',
                      letterSpacing: '0.5px'
                    }}>
                      {tr.initialLevel}
                    </div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.initialPriceFormatted}
                    </div>
                  </div>

                  {/* Current/Redemption Level */}
                  <div style={{
                    background: 'var(--bg-primary)',
                    padding: '0.85rem',
                    borderRadius: '6px',
                    textAlign: 'center'
                  }}>
                    <div style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600',
                      letterSpacing: '0.5px'
                    }}>
                      {underlying.priceLevelLabel || tr.currentLevel}
                    </div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '700',
                      color: underlying.hasCurrentData ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.currentPriceFormatted}
                      {underlying.isRedeemed && underlying.priceSource === 'initial_fallback_error' && (
                        <span style={{ fontSize: '0.7rem', marginLeft: '0.25rem', color: 'var(--loss-color)' }} title="Missing historical data">⚠️</span>
                      )}
                    </div>
                    {underlying.priceDateFormatted && (
                      <div style={{
                        fontSize: '0.65rem',
                        color: 'var(--text-muted)',
                        marginTop: '0.35rem',
                        fontWeight: '500'
                      }}>
                        {underlying.priceDateFormatted}
                      </div>
                    )}
                    {underlying.sparklineData?.hasData && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <PriceSparkline
                          sparklineData={underlying.sparklineData}
                          ticker={underlying.ticker}
                          initialPrice={underlying.initialPrice}
                          currency={underlying.currency}
                          isPositive={underlying.isPositive}
                        />
                      </div>
                    )}
                  </div>

                  {/* Performance */}
                  <div style={{
                    background: underlying.isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    padding: '0.85rem',
                    borderRadius: '6px',
                    textAlign: 'center',
                    border: `1px solid ${underlying.isPositive ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                  }}>
                    <div style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600',
                      letterSpacing: '0.5px'
                    }}>
                      {tr.performance}
                    </div>
                    <div style={{
                      fontSize: '1.2rem',
                      fontWeight: '700',
                      color: underlying.isPositive ? 'var(--gain-color)' : 'var(--loss-color)',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.performanceFormatted}
                    </div>
                  </div>

                  {/* Barrier Distance */}
                  <div style={{
                    background: underlying.barrierStatus === 'breached' ? 'rgba(239, 68, 68, 0.1)' :
                               underlying.barrierStatus === 'near' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                    padding: '0.85rem',
                    borderRadius: '6px',
                    textAlign: 'center',
                    border: `1px solid ${
                      underlying.barrierStatus === 'breached' ? 'rgba(239, 68, 68, 0.3)' :
                      underlying.barrierStatus === 'near' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)'
                    }`
                  }}>
                    <div style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600',
                      letterSpacing: '0.5px'
                    }}>
                      {tr.barrierDistance}
                    </div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '700',
                      color: underlying.barrierStatus === 'breached' ? 'var(--loss-color)' :
                             underlying.barrierStatus === 'near' ? 'var(--warning-color)' : 'var(--gain-color)',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.distanceToBarrierFormatted}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: underlying.barrierStatus === 'breached' ? 'var(--loss-color)' :
                             underlying.barrierStatus === 'near' ? 'var(--warning-color)' : 'var(--gain-color)',
                      marginTop: '0.35rem',
                      fontWeight: '600'
                    }}>
                      {underlying.barrierStatusText}
                    </div>
                  </div>
                </div>
              </div>
              )
            ))}
          </div>
        </div>
      )}

      {/* Performance Bar Chart - responsive: compact columns on phones */}
      {underlyings.length > 0 && (
        <div className="pdf-card pdf-page-break-before" style={{
          background: 'var(--bg-primary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1.5rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            📊 {tr.performanceOverview}
            {phoenixParams.protectionBarrier && (
              <span style={{
                fontSize: '0.75rem',
                background: '#6366f1',
                color: 'white',
                padding: '3px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                {tr.protectionAt} {phoenixParams.protectionBarrier}%
              </span>
            )}
          </h4>

          <div style={{
            background: 'var(--bg-tertiary)',
            padding: isMobile ? '1rem 0.75rem 0.75rem' : '1.5rem',
            borderRadius: '8px',
            position: 'relative'
          }}>
            {/* Y-axis labels and bars */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}>
              {underlyings.map((underlying, index) => {
                // Calculate adaptive scale based on protection barrier and performance data
                const performance = underlying.performance || 0;
                const protectionBarrierLevel = phoenixParams.protectionBarrier || 70; // Stored as level (e.g., 40%)

                // Convert barrier level to performance: 40% level = -60% performance
                const protectionBarrierPerformance = protectionBarrierLevel - 100;

                // Minimum scale: 10% below protection barrier performance
                const minScale = Math.min(-50, protectionBarrierPerformance - 10);

                // Maximum scale: Max of (100%, highest performance + 10%)
                const maxPerformance = Math.max(...underlyings.map(u => u.performance || 0));
                const maxScale = Math.max(100, maxPerformance + 10);

                // Calculate total range and zero position
                const totalRange = maxScale - minScale;
                const zeroPosition = (0 - minScale) / totalRange * 100; // Position of 0% on the scale

                // Calculate bar position and width
                let barLeft = 0;
                let barWidth = 0;

                if (performance >= 0) {
                  // Positive performance - bar goes from 0 to right
                  barLeft = zeroPosition;
                  barWidth = Math.min(performance, maxScale) / totalRange * 100;
                } else {
                  // Negative performance - bar goes from left to 0
                  const absPerf = Math.abs(performance);
                  barWidth = Math.min(absPerf, Math.abs(minScale)) / totalRange * 100;
                  barLeft = zeroPosition - barWidth;
                }

                return (
                  <div key={index} style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '58px 1fr 64px' : '140px 1fr 80px',
                    gap: isMobile ? '0.5rem' : '1rem',
                    alignItems: 'center'
                  }}>
                    {/* Ticker name */}
                    <div style={{
                      fontSize: isMobile ? '0.72rem' : '0.85rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: isMobile ? '0.25rem' : '0.5rem',
                      fontFamily: 'monospace',
                      overflow: 'hidden'
                    }}>
                      {underlying.ticker}
                      {underlying.isWorstPerforming && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--loss-color)' }} title={tr.worstPerforming}>⚠️</span>
                      )}
                    </div>

                    {/* Bar chart area */}
                    <div style={{
                      position: 'relative',
                      height: '36px',
                      background: 'var(--bg-primary)',
                      borderRadius: '4px',
                      overflow: 'visible'
                    }}>
                      {/* Zero line */}
                      <div style={{
                        position: 'absolute',
                        left: `${zeroPosition}%`,
                        top: 0,
                        bottom: 0,
                        width: '2px',
                        background: 'var(--border-color)',
                        zIndex: 1
                      }} />

                      {/* Protection barrier line */}
                      {phoenixParams.protectionBarrier && (
                        <div style={{
                          position: 'absolute',
                          left: `${(protectionBarrierPerformance - minScale) / totalRange * 100}%`,
                          top: '-8px',
                          bottom: '-8px',
                          width: '3px',
                          background: '#60a5fa',
                          zIndex: 2,
                          boxShadow: '0 0 8px rgba(96, 165, 250, 0.6), 0 0 16px rgba(96, 165, 250, 0.3)'
                        }}>
                          {/* Barrier label on first row */}
                          {index === 0 && (
                            <div style={{
                              position: 'absolute',
                              top: '-24px',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              fontSize: '0.65rem',
                              color: '#60a5fa',
                              fontWeight: '700',
                              whiteSpace: 'nowrap',
                              background: 'var(--bg-tertiary)',
                              padding: '2px 6px',
                              borderRadius: '3px',
                              boxShadow: '0 0 6px rgba(96, 165, 250, 0.3)'
                            }}>
                              {tr.barrier}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Performance bar */}
                      <div style={{
                        position: 'absolute',
                        left: `${barLeft}%`,
                        top: '4px',
                        bottom: '4px',
                        width: `${barWidth}%`,
                        background: underlying.barrierStatus === 'breached'
                          ? 'linear-gradient(90deg, var(--loss-color) 0%, #dc2626 100%)'
                          : underlying.barrierStatus === 'near'
                            ? 'linear-gradient(90deg, var(--warning-color) 0%, #d97706 100%)'
                            : 'linear-gradient(90deg, var(--gain-color) 0%, #059669 100%)',
                        borderRadius: '3px',
                        transition: 'all 0.3s ease',
                        boxShadow: underlying.barrierStatus === 'breached'
                          ? '0 2px 8px rgba(239, 68, 68, 0.3)'
                          : underlying.barrierStatus === 'near'
                            ? '0 2px 8px rgba(245, 158, 11, 0.3)'
                            : '0 2px 8px rgba(16, 185, 129, 0.3)',
                        zIndex: 3
                      }} />

                      {/* Scale markers */}
                      {index === underlyings.length - 1 && (
                        <>
                          {/* Minimum scale marker */}
                          <div style={{
                            position: 'absolute',
                            left: '0%',
                            bottom: '-20px',
                            fontSize: '0.65rem',
                            color: 'var(--text-muted)',
                            fontFamily: 'monospace'
                          }}>
                            {minScale >= 0 ? '+' : ''}{Math.round(minScale)}%
                          </div>
                          {/* 0% marker */}
                          <div style={{
                            position: 'absolute',
                            left: `${zeroPosition}%`,
                            bottom: '-20px',
                            transform: 'translateX(-50%)',
                            fontSize: '0.65rem',
                            color: 'var(--text-secondary)',
                            fontWeight: '600',
                            fontFamily: 'monospace'
                          }}>
                            0%
                          </div>
                          {/* Maximum scale marker */}
                          <div style={{
                            position: 'absolute',
                            right: '0%',
                            bottom: '-20px',
                            fontSize: '0.65rem',
                            color: 'var(--text-muted)',
                            fontFamily: 'monospace'
                          }}>
                            +{Math.round(maxScale)}%
                          </div>
                        </>
                      )}
                    </div>

                    {/* Performance value */}
                    <div style={{
                      fontSize: isMobile ? '0.78rem' : '0.9rem',
                      fontWeight: '700',
                      color: underlying.barrierStatus === 'breached'
                        ? 'var(--loss-color)'
                        : underlying.barrierStatus === 'near'
                          ? 'var(--warning-color)'
                          : 'var(--gain-color)',
                      textAlign: 'right',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.performanceFormatted}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div style={{
              marginTop: isMobile ? '2rem' : '2.5rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: isMobile ? '0.6rem 1rem' : '2rem',
              fontSize: isMobile ? '0.68rem' : '0.75rem',
              color: 'var(--text-secondary)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '20px',
                  height: '12px',
                  background: 'linear-gradient(90deg, var(--gain-color) 0%, #059669 100%)',
                  borderRadius: '2px'
                }} />
                <span>{tr.aboveBarrierSafe}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '20px',
                  height: '12px',
                  background: 'linear-gradient(90deg, var(--warning-color) 0%, #d97706 100%)',
                  borderRadius: '2px'
                }} />
                <span>{tr.nearBarrierWarning}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '20px',
                  height: '12px',
                  background: 'linear-gradient(90deg, var(--loss-color) 0%, #dc2626 100%)',
                  borderRadius: '2px'
                }} />
                <span>{tr.belowBarrierBreached}</span>
              </div>
              {phoenixParams.protectionBarrier && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '3px',
                    height: '16px',
                    background: '#60a5fa',
                    boxShadow: '0 0 6px rgba(96, 165, 250, 0.5)'
                  }} />
                  <span>{tr.protectionBarrier} ({phoenixParams.protectionBarrier}%)</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Latest News Section - Hidden in PDF */}
      {underlyings.length > 0 && (
        <div className="no-print underlying-news-section" style={{
          background: 'var(--bg-primary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            📰 {tr.latestNews}
          </h4>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            {underlyings.map((underlying, index) => (
              <UnderlyingNews
                key={index}
                ticker={underlying.ticker}
              />
            ))}
          </div>
        </div>
      )}

      {/* Basket Analysis Summary */}
      {results.basketAnalysis && (
        <div className="pdf-card pdf-page-break-before" style={{
          background: 'var(--bg-primary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            🛡️ {tr.capitalProtectionAnalysis}
            <span style={{
              fontSize: '0.8rem',
              background: results.basketAnalysis.breachedCount > 0 ? 'var(--loss-color)' :
                         results.basketAnalysis.nearCount > 0 ? 'var(--warning-color)' : 'var(--gain-color)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontWeight: '500'
            }}>
              {results.basketAnalysis.protectionBarrier}% Barrier
            </span>
          </h4>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : (isTablet ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(180px, 1fr))'),
            gap: '1rem'
          }}>
            <div style={{
              background: 'var(--bg-tertiary)',
              padding: '1rem',
              borderRadius: '6px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                color: results.basketAnalysis.criticalDistance >= 0 ? 'var(--gain-color)' : 'var(--loss-color)',
                marginBottom: '0.5rem'
              }}>
                {results.basketAnalysis.criticalDistanceFormatted}
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>
                {tr.criticalDistance}
              </div>
            </div>

            <div style={{
              background: 'var(--bg-tertiary)',
              padding: '1rem',
              borderRadius: '6px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                color: 'var(--gain-color)',
                marginBottom: '0.5rem'
              }}>
                {results.basketAnalysis.safeCount}
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>
                {tr.aboveBarrier}
              </div>
            </div>

            {results.basketAnalysis.nearCount > 0 && (
              <div style={{
                background: 'var(--bg-tertiary)',
                padding: '1rem',
                borderRadius: '6px',
                textAlign: 'center'
              }}>
                <div style={{
                  fontSize: '1.5rem',
                  fontWeight: '700',
                  color: 'var(--warning-color)',
                  marginBottom: '0.5rem'
                }}>
                  {results.basketAnalysis.nearCount}
                </div>
                <div style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  {tr.nearBarrier}
                </div>
              </div>
            )}

            {results.basketAnalysis.breachedCount > 0 && (
              <div style={{
                background: 'var(--bg-tertiary)',
                padding: '1rem',
                borderRadius: '6px',
                textAlign: 'center'
              }}>
                <div style={{
                  fontSize: '1.5rem',
                  fontWeight: '700',
                  color: 'var(--loss-color)',
                  marginBottom: '0.5rem'
                }}>
                  {results.basketAnalysis.breachedCount}
                </div>
                <div style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  {tr.belowBarrier}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Indicative Maturity Value (live) / Final Redemption Result (matured/autocalled) */}
      {results.indicativeMaturityValue && (results.indicativeMaturityValue.isLive || results.indicativeMaturityValue.isMatured || results.indicativeMaturityValue.isAutocalled) && (() => {
        const iv = results.indicativeMaturityValue;
        const isFinal = iv.isMatured || iv.isAutocalled;
        const accentColor = isFinal ? (iv.pnlIsPositive ? 'var(--gain-color)' : 'var(--loss-color)') : '#6366f1';
        const accentBg = isFinal
          ? (iv.pnlIsPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)')
          : 'rgba(99, 102, 241, 0.1)';
        const accentBorder = isFinal
          ? (iv.pnlIsPositive ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)')
          : 'rgba(99, 102, 241, 0.3)';

        return (
        <div className="pdf-card pdf-page-break-before" style={{
          background: `linear-gradient(135deg, ${accentBg} 0%, transparent 100%)`,
          border: `2px solid ${accentBorder}`,
          borderRadius: '12px',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Decorative gradient background */}
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '200px',
            height: '200px',
            background: `radial-gradient(circle, ${accentBg} 0%, transparent 70%)`,
            pointerEvents: 'none'
          }} />

          <div style={{
            position: 'relative',
            zIndex: 1
          }}>
            <h4 style={{
              margin: '0 0 1rem 0',
              fontSize: '1rem',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              {isFinal ? '🏁' : '💡'} {isFinal ? tr.finalRedemptionResult : tr.indicativeValueIfMaturedToday}
            <span style={{
              fontSize: '0.75rem',
              background: isFinal
                ? (iv.pnlIsPositive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)')
                : 'rgba(99, 102, 241, 0.2)',
              color: accentColor,
              padding: '4px 8px',
              borderRadius: '4px',
              fontWeight: '600'
            }}>
              {isFinal ? tr.finalResult : tr.hypothetical}
            </span>
          </h4>

          <div style={{
            background: 'var(--bg-tertiary)',
            padding: '1rem',
            borderRadius: '6px',
            marginBottom: '1rem',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
            border: '1px solid var(--border-color)'
          }}>
            {isFinal ? tr.finalRedemptionDisclaimer : tr.indicativeCalculationDisclaimer}
          </div>

          {/* Total Value - Large Display */}
          <div style={{
            background: 'var(--bg-secondary)',
            padding: '2rem',
            borderRadius: '8px',
            textAlign: 'center',
            marginBottom: '1.5rem',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              fontWeight: '700',
              letterSpacing: '1px',
              marginBottom: '0.75rem'
            }}>
              {isFinal ? tr.totalRedemptionValue : tr.currentTheoreticalTotalReturn}
            </div>
            <div style={{
              fontSize: '3rem',
              fontWeight: '800',
              color: accentColor,
              fontFamily: 'monospace',
              lineHeight: '1'
            }}>
              {iv.totalValueFormatted}
            </div>
            {isFinal && (
              <div style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                color: iv.pnlIsPositive ? 'var(--gain-color)' : 'var(--loss-color)',
                fontFamily: 'monospace',
                marginTop: '0.5rem'
              }}>
                {tr.netPnl}: {iv.pnlFormatted}
              </div>
            )}
            <div style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              marginTop: '0.5rem'
            }}>
              {tr.asOf} {iv.evaluationDateFormatted}
            </div>
          </div>

          {/* Breakdown Components */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : (isTablet ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(200px, 1fr))'),
            gap: '1rem'
          }}>
            {/* Capital Component */}
            <div style={{
              background: 'var(--bg-secondary)',
              padding: '1.25rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                fontSize: '0.7rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                marginBottom: '0.75rem',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>
                💰 {tr.capitalReturn}
              </div>
              <div style={{
                fontSize: '1.8rem',
                fontWeight: '700',
                color: iv.capitalReturn < 100 ? 'var(--loss-color)' : 'var(--text-primary)',
                marginBottom: '0.5rem',
                fontFamily: 'monospace'
              }}>
                {iv.capitalReturnFormatted}
              </div>
              <div style={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                lineHeight: '1.4'
              }}>
                {iv.capitalExplanation}
              </div>
            </div>

            {/* Coupons Earned */}
            <div style={{
              background: 'var(--bg-secondary)',
              padding: '1.25rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                fontSize: '0.7rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                marginBottom: '0.75rem',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>
                💵 {tr.couponsEarned}
              </div>
              <div style={{
                fontSize: '1.8rem',
                fontWeight: '700',
                color: iv.couponsEarned > 0 ? 'var(--gain-color)' : 'var(--text-muted)',
                marginBottom: '0.5rem',
                fontFamily: 'monospace'
              }}>
                {iv.couponsEarnedFormatted}
              </div>
              <div style={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)'
              }}>
                {isFinal ? tr.totalCouponsPaid : tr.totalCouponsPaidToDate}
              </div>
            </div>

            {/* Memory Coupons */}
            {iv.hasMemoryCoupons && (
              <div style={{
                background: 'var(--bg-secondary)',
                padding: '1.25rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  marginBottom: '0.75rem',
                  fontWeight: '700',
                  letterSpacing: '0.5px'
                }}>
                  🧠 {tr.memoryCoupons}
                </div>
                <div style={{
                  fontSize: '1.8rem',
                  fontWeight: '700',
                  color: iv.memoryCouponsForfeit ? 'var(--loss-color)' : 'var(--warning-color)',
                  marginBottom: '0.5rem',
                  fontFamily: 'monospace',
                  textDecoration: iv.memoryCouponsForfeit ? 'line-through' : 'none'
                }}>
                  {iv.memoryCouponsForfeit
                    ? iv.memoryCouponsForfeitFormatted
                    : iv.memoryCouponsFormatted}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)'
                }}>
                  {iv.memoryCouponsForfeit
                    ? `⚠️ ${tr.forfeitedBelowBarrier}`
                    : tr.accumulatedInMemory}
                </div>
              </div>
            )}
          </div>

          {/* Protection Barrier Info */}
          <div style={{
            marginTop: '1rem',
            padding: '0.85rem 1rem',
            background: 'var(--bg-tertiary)',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span style={{ fontSize: '1rem' }}>🛡️</span>
            <div>
              <strong>{tr.protectionBarrier}:</strong> {iv.protectionBarrierFormatted} |
              <strong style={{ marginLeft: '0.5rem' }}>{tr.currentBasket}:</strong> {iv.basketPerformanceFormatted}
            </div>
          </div>
          </div>
        </div>
        );
      })()}

      {/* Observation Schedule */}
      {results.observationAnalysis && results.observationAnalysis.observations && results.observationAnalysis.observations.length > 0 && (
        <div className="pdf-card pdf-page-break-before observation-schedule-section" style={{
          background: 'var(--bg-primary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            📅 {tr.observationSchedule}
            {results.observationAnalysis.isEarlyAutocall && (
              <span style={{
                fontSize: '0.8rem',
                background: 'var(--gain-color)',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                {tr.called} {results.observationAnalysis.callDateFormatted}
              </span>
            )}
            {results.observationAnalysis.isMaturedAtFinal && (
              <span style={{
                fontSize: '0.8rem',
                background: '#6366f1',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                {tr.matured}
              </span>
            )}
            {results.observationAnalysis.hasMemoryAutocall && (
              <span style={{
                fontSize: '0.8rem',
                background: '#6366f1',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                {tr.memoryAutocall}
              </span>
            )}
            {results.observationAnalysis.hasMemoryCoupon && !results.observationAnalysis.hasGuaranteedCoupon && (
              <span style={{
                fontSize: '0.8rem',
                background: 'var(--warning-color)',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                {tr.memoryCoupon}
              </span>
            )}
            {results.observationAnalysis.hasGuaranteedCoupon && (
              <span style={{
                fontSize: '0.8rem',
                background: 'var(--gain-color)',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                💰 Guaranteed
              </span>
            )}
          </h4>

          {/* Summary Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            <div style={{
              background: 'var(--bg-tertiary)',
              padding: '1rem',
              borderRadius: '6px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '1.2rem',
                fontWeight: '700',
                color: 'var(--text-primary)',
                marginBottom: '0.5rem'
              }}>
                {results.observationAnalysis.totalCouponsEarnedFormatted}
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>
                {tr.totalCouponsEarned}
              </div>
            </div>

            {/* In Memory stat - hide when guaranteed coupon is enabled */}
            {!results.observationAnalysis.hasGuaranteedCoupon && (
              <div style={{
                background: 'var(--bg-tertiary)',
                padding: '1rem',
                borderRadius: '6px',
                textAlign: 'center'
              }}>
                <div style={{
                  fontSize: '1.2rem',
                  fontWeight: '700',
                  color: results.observationAnalysis.totalMemoryCoupons > 0 ? 'var(--warning-color)' : 'var(--text-muted)',
                  marginBottom: '0.5rem'
                }}>
                  {results.observationAnalysis.totalMemoryCouponsFormatted}
                </div>
                <div style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  {tr.inMemory}
                </div>
              </div>
            )}

            <div style={{
              background: 'var(--bg-tertiary)',
              padding: '1rem',
              borderRadius: '6px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '1.2rem',
                fontWeight: '700',
                color: 'var(--text-primary)',
                marginBottom: '0.5rem'
              }}>
                {results.observationAnalysis.totalObservations}
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>
                {tr.totalObservations}
              </div>
            </div>

            <div style={{
              background: 'var(--bg-tertiary)',
              padding: '1rem',
              borderRadius: '6px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '1.2rem',
                fontWeight: '700',
                color: results.observationAnalysis.remainingObservations > 0 ? 'var(--accent-color)' : 'var(--text-muted)',
                marginBottom: '0.5rem'
              }}>
                {results.observationAnalysis.remainingObservations}
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>
                {tr.remaining}
              </div>
            </div>
          </div>

          {/* Next Observation Prediction Card - Hide for redeemed/autocalled products */}
          {results.observationAnalysis.nextObservationPrediction &&
           !results.observationAnalysis.nextObservationPrediction.isLastObservation &&
           !results.observationAnalysis.isEarlyAutocall &&
           !results.observationAnalysis.isMaturedAtFinal &&
           !results.observationAnalysis.isEarlyAutocall && (
            <div className="pdf-card pdf-page-break-before" style={{
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(96, 165, 250, 0.05) 100%)',
              border: '2px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '12px',
              padding: '1.5rem',
              marginBottom: '1.5rem',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Decorative gradient background */}
              <div style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: '200px',
                height: '200px',
                background: 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)',
                pointerEvents: 'none'
              }} />

              <div style={{
                position: 'relative',
                zIndex: 1
              }}>
                <h4 style={{
                  margin: '0 0 1rem 0',
                  fontSize: '1rem',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  🔮 {tr.nextObservationPrediction}
                  <span style={{
                    fontSize: '0.75rem',
                    background: 'rgba(59, 130, 246, 0.2)',
                    color: 'var(--info-color)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontWeight: '600'
                  }}>
                    {results.observationAnalysis.nextObservationPrediction.daysUntil} {tr.days}
                  </span>
                </h4>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : 'auto 1fr auto',
                  gap: '1.5rem',
                  alignItems: 'center'
                }}>
                  {/* Date */}
                  <div style={{
                    textAlign: isMobile ? 'center' : 'left'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600',
                      letterSpacing: '0.5px'
                    }}>
                      {tr.date}
                    </div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '700',
                      color: 'var(--text-primary)'
                    }}>
                      {results.observationAnalysis.nextObservationPrediction.dateFormatted}
                    </div>
                  </div>

                  {/* Prediction Details */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}>
                    {/* Predicted Outcome */}
                    <div>
                      <div style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                        textTransform: 'uppercase',
                        marginBottom: '0.5rem',
                        fontWeight: '600',
                        letterSpacing: '0.5px'
                      }}>
                        {tr.predictedOutcome}
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexWrap: 'wrap'
                      }}>
                        {results.observationAnalysis.nextObservationPrediction.outcomeType === 'autocall' && (
                          <span style={{
                            background: 'linear-gradient(135deg, var(--info-color) 0%, #2563eb 100%)',
                            color: '#ffffff',
                            padding: '0.5rem 1rem',
                            borderRadius: '8px',
                            fontSize: '0.9rem',
                            fontWeight: '700',
                            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
                            letterSpacing: '0.3px'
                          }}>
                            🎊 {tr.autocallAt} {results.observationAnalysis.nextObservationPrediction.autocallPriceFormatted}
                          </span>
                        )}
                        {results.observationAnalysis.nextObservationPrediction.outcomeType === 'coupon' && (
                          <>
                            <span style={{
                              color: '#059669',
                              background: '#d1fae5',
                              padding: '0.5rem 1rem',
                              borderRadius: '8px',
                              fontSize: '0.9rem',
                              fontWeight: '700',
                              boxShadow: '0 1px 3px rgba(5, 150, 105, 0.1)'
                            }}>
                              💵 {tr.coupon}: {results.observationAnalysis.nextObservationPrediction.memoryWouldBeReleased
                                ? results.observationAnalysis.nextObservationPrediction.totalCouponWithMemoryFormatted
                                : results.observationAnalysis.nextObservationPrediction.couponAmountFormatted}
                            </span>
                            {results.observationAnalysis.nextObservationPrediction.memoryWouldBeReleased && (
                              <span style={{
                                color: '#7c3aed',
                                background: '#ede9fe',
                                padding: '0.5rem 1rem',
                                borderRadius: '8px',
                                fontSize: '0.8rem',
                                fontWeight: '600',
                                boxShadow: '0 1px 3px rgba(124, 58, 237, 0.1)',
                                marginLeft: '0.5rem'
                              }}>
                                🧠 {tr.includesMemory || 'Incl.'} {results.observationAnalysis.nextObservationPrediction.totalMemoryCouponsFormatted} {tr.memory || 'memory'}
                              </span>
                            )}
                          </>
                        )}
                        {results.observationAnalysis.nextObservationPrediction.outcomeType === 'memory_added' && (
                          <span style={{
                            color: '#c2410c',
                            background: '#fed7aa',
                            padding: '0.5rem 1rem',
                            borderRadius: '8px',
                            fontSize: '0.9rem',
                            fontWeight: '700',
                            boxShadow: '0 1px 3px rgba(234, 88, 12, 0.1)'
                          }}>
                            🧠 {tr.addedToMemory}: {results.observationAnalysis.nextObservationPrediction.couponAmount.toFixed(1)}% ({tr.total}: {results.observationAnalysis.nextObservationPrediction.totalMemoryCouponsFormatted})
                          </span>
                        )}
                        {results.observationAnalysis.nextObservationPrediction.outcomeType === 'final_redemption' && (
                          <span style={{
                            background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
                            color: '#ffffff',
                            padding: '0.5rem 1rem',
                            borderRadius: '8px',
                            fontSize: '0.9rem',
                            fontWeight: '700',
                            boxShadow: '0 2px 8px rgba(234, 88, 12, 0.3)',
                            letterSpacing: '0.3px'
                          }}>
                            🏁 {tr.finalRedemption}: {results.observationAnalysis.nextObservationPrediction.redemptionAmountFormatted}
                          </span>
                        )}
                        {results.observationAnalysis.nextObservationPrediction.outcomeType === 'no_event' && (
                          <span style={{
                            color: 'var(--neutral-color)',
                            fontStyle: 'italic',
                            fontSize: '0.9rem',
                            fontWeight: '500'
                          }}>
                            ✗ {tr.noCouponWouldBePaid}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Explanation */}
                    <div style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.5'
                    }}>
                      {results.observationAnalysis.nextObservationPrediction.explanation}
                    </div>
                  </div>

                  {/* Basket Level */}
                  <div style={{
                    textAlign: isMobile ? 'center' : 'right',
                    background: 'var(--bg-tertiary)',
                    padding: '1rem',
                    borderRadius: '8px'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600',
                      letterSpacing: '0.5px'
                    }}>
                      {tr.currentBasket}
                    </div>
                    <div style={{
                      fontSize: '1.3rem',
                      fontWeight: '700',
                      color: results.observationAnalysis.nextObservationPrediction.currentBasketLevel >= 0 ? 'var(--gain-color)' : 'var(--loss-color)'
                    }}>
                      {results.observationAnalysis.nextObservationPrediction.currentBasketLevelFormatted}
                    </div>
                  </div>
                </div>

                {/* Assumption disclaimer */}
                <div style={{
                  marginTop: '1rem',
                  padding: '0.75rem',
                  background: 'rgba(148, 163, 184, 0.1)',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  fontStyle: 'italic',
                  textAlign: 'center'
                }}>
                  ℹ️ {results.observationAnalysis.nextObservationPrediction.assumption}
                </div>
              </div>
            </div>
          )}

          {/* Observation schedule — card list on phones (the grid table needs
              ≥750px), themed grid table on desktop */}
          {isMobile ? (
            <ScheduleCardsMobile rows={observations.map((obs, index) => {
              const isRedemptionRow = index === obsRowMeta.redemptionIndex;
              const isFutureRow = !obs.hasOccurred;
              const isFinalObservation = index === obsRowMeta.finalIndex;
              const isMostRecent = index === obsRowMeta.lastOccurredIndex && obsRowMeta.lastOccurredIndex !== -1;

              const paymentSuffix = obs.couponPaid > 0 && obs.hasOccurred
                ? (obs.paymentConfirmed ? ` ✓ ${tr.paid}` : (obs.isPastDue ? ` ⚠ ${tr.overdue}` : ` · ${tr.pending}`))
                : '';
              const fields = [
                { label: tr.payment, value: `${obs.paymentDateFormatted}${paymentSuffix}` },
                { label: tr.trigger, value: obs.autocallLevelFormatted },
                {
                  label: tr.autocall,
                  value: obs.productCalled === null ? `⏳ ${tr.tbd}` : (obs.productCalled ? `✓ ${tr.yes}` : `✗ ${tr.no}`)
                },
                { label: tr.coupon, value: obs.couponPaid > 0 ? obs.couponPaidFormatted : '—' }
              ];
              if (!results.observationAnalysis.hasGuaranteedCoupon) {
                fields.push({ label: tr.memory, value: obs.couponInMemory > 0 ? obs.couponInMemoryFormatted : '—' });
              }
              if (results.observationAnalysis.hasMemoryAutocall) {
                const flagged = obs.underlyingFlags?.filter(f => f.isFlagged) || [];
                fields.push({
                  label: tr.memoryLock,
                  value: flagged.length === 0
                    ? '—'
                    : (obs.allUnderlyingsFlagged ? `${tr.allFlagged} ✓` : flagged.map(f => `${f.ticker} 🔒`).join('  '))
                });
              }
              return {
                key: index,
                title: `${isMostRecent ? '⏰ ' : ''}${obs.observationDateFormatted}`,
                subtitle: obs.observationType,
                badge: isRedemptionRow
                  ? { text: `🎊 ${tr.redeemed}`, background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', color: '#ffffff' }
                  : null,
                accent: isRedemptionRow ? 'success' : (isMostRecent ? 'info' : (isFinalObservation ? 'warning' : null)),
                muted: isFutureRow && !isFinalObservation,
                fields
              };
            })} />
          ) : (
          <div style={{
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            boxShadow: '0 10px 40px color-mix(in srgb, var(--shadow, rgba(0,0,0,0.15)) 40%, transparent)'
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
                  minWidth: '750px'
                }}>
                  {/* Table Header — themed so it reads in both light and dark mode */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: obsGridTemplate,
                    gap: '0.75rem',
                    padding: '1.25rem 1.5rem',
                    background: 'var(--bg-tertiary)',
                    borderBottom: '2px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      📅 {tr.observation}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      💰 {tr.payment}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      🏷️ {tr.type}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      🎯 {tr.trigger}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      ✅ {tr.autocall}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      💵 {tr.coupon}
                    </div>
                    {!results.observationAnalysis.hasGuaranteedCoupon && (
                      <div style={{
                        fontSize: '0.7rem',
                        fontWeight: '700',
                        color: 'var(--text-secondary)',
                        textTransform: 'uppercase',
                        textAlign: 'center',
                        letterSpacing: '1px'
                      }}>
                        🧠 {tr.memory}
                      </div>
                    )}
                    {results.observationAnalysis.hasMemoryAutocall && (
                      <div style={{
                        fontSize: '0.7rem',
                        fontWeight: '700',
                        color: 'var(--text-secondary)',
                        textTransform: 'uppercase',
                        textAlign: 'center',
                        letterSpacing: '1px'
                      }}>
                        🔒 {tr.memoryLock}
                      </div>
                    )}
                  </div>

                  {/* Table Rows - Enhanced Visual Hierarchy */}
                  {observations.map((obs, index) => {
                    // Row states precomputed once in obsRowMeta (was O(n²) here)
                    const isRedemptionRow = index === obsRowMeta.redemptionIndex;
                    const isFutureRow = !obs.hasOccurred;
                    const isFinalObservation = index === obsRowMeta.finalIndex;
                    const isMostRecentObservation = index === obsRowMeta.lastOccurredIndex && obsRowMeta.lastOccurredIndex !== -1;

                    return (
                    <div key={index} style={{
                      display: 'grid',
                      gridTemplateColumns: obsGridTemplate,
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '1rem 1.5rem',
                      borderBottom: index < observations.length - 1 ?
                        '1px solid var(--border-color)' : 'none',
                      background: isRedemptionRow
                        ? 'linear-gradient(135deg, #059669 0%, #047857 100%)'
                        : isMostRecentObservation
                          ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(96, 165, 250, 0.15) 100%)'
                          : isFutureRow
                            ? 'color-mix(in srgb, var(--text-muted) 6%, transparent)'
                            : 'transparent',
                      borderLeft: isMostRecentObservation
                        ? '4px solid var(--info-color)'
                        : isRedemptionRow
                          ? '4px solid #059669'
                          : isFinalObservation
                            ? '4px solid #ea580c'
                            : 'none',
                      transition: 'all 0.15s ease',
                      position: 'relative'
                    }}>
                      {/* Status Badge Overlay for Redemption Row */}
                      {isRedemptionRow && (
                        <div style={{
                          position: 'absolute',
                          top: '0.75rem',
                          right: '1.5rem',
                          background: 'rgba(255, 255, 255, 0.95)',
                          padding: '0.35rem 0.85rem',
                          borderRadius: '20px',
                          fontSize: '0.65rem',
                          fontWeight: '700',
                          color: '#047857',
                          textTransform: 'uppercase',
                          letterSpacing: '0.8px',
                          boxShadow: '0 4px 12px rgba(5, 150, 105, 0.25)'
                        }}>
                          🎊 {tr.redeemed}
                        </div>
                      )}

                      {/* Observation Date */}
                      <div style={{
                        fontSize: '0.875rem',
                        color: isRedemptionRow
                          ? '#ffffff'
                          : isFutureRow
                            ? 'var(--neutral-color)'
                            : 'var(--text-primary)',
                        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                        fontWeight: isMostRecentObservation ? '700' : '600',
                        display: 'flex',
                        alignItems: 'center'
                      }}>
                        {isMostRecentObservation && (
                          <span style={{
                            marginRight: '0.5rem',
                            fontSize: '1rem'
                          }}>
                            ⏰
                          </span>
                        )}
                        {obs.observationDateFormatted}
                      </div>

                      {/* Payment Date */}
                      <div style={{
                        fontSize: '0.875rem',
                        color: isRedemptionRow
                          ? '#ffffff'
                          : isFutureRow
                            ? 'var(--neutral-color)'
                            : 'var(--text-primary)',
                        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                        fontWeight: isMostRecentObservation ? '700' : '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}>
                        <span>{obs.paymentDateFormatted}</span>
                        {/* Payment Confirmation Badge */}
                        {obs.couponPaid > 0 && obs.hasOccurred && (
                          <>
                            {obs.paymentConfirmed ? (
                              <span
                                style={{
                                  background: 'linear-gradient(135deg, var(--gain-color) 0%, #059669 100%)',
                                  color: '#ffffff',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '6px',
                                  fontSize: '0.65rem',
                                  fontWeight: '700',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
                                  cursor: 'help',
                                  whiteSpace: 'nowrap'
                                }}
                                title={obs.confirmedPayment ?
                                  `Payment Confirmed\nAmount: ${obs.confirmedPayment.actualAmount?.toFixed(2)} ${obs.confirmedPayment.currency || ''}\nDate: ${new Date(obs.confirmedPayment.actualDate).toLocaleDateString('en-GB')}\nConfidence: ${obs.matchConfidence}`
                                  : 'Payment Confirmed'}
                              >
                                ✓ {tr.paid}
                              </span>
                            ) : obs.isPastDue ? (
                              <span
                                style={{
                                  background: 'linear-gradient(135deg, var(--loss-color) 0%, #dc2626 100%)',
                                  color: '#ffffff',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '6px',
                                  fontSize: '0.65rem',
                                  fontWeight: '700',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  boxShadow: '0 2px 6px rgba(239, 68, 68, 0.3)',
                                  cursor: 'help',
                                  whiteSpace: 'nowrap'
                                }}
                                title="Payment past due - not found in PMS operations"
                              >
                                ⚠ {tr.overdue}
                              </span>
                            ) : (
                              <span
                                style={{
                                  // On the green redemption row the muted chip is illegible —
                                  // use a translucent white pill with white text there
                                  background: isRedemptionRow
                                    ? 'rgba(255, 255, 255, 0.25)'
                                    : 'color-mix(in srgb, var(--text-muted) 18%, transparent)',
                                  color: isRedemptionRow ? '#ffffff' : 'var(--text-muted)',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '6px',
                                  fontSize: '0.65rem',
                                  fontWeight: '700',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  cursor: 'help',
                                  whiteSpace: 'nowrap'
                                }}
                                title={obs.matchMessage || 'Payment status unknown'}
                              >
                                ? {tr.pending}
                              </span>
                            )}
                          </>
                        )}
                        {/* Redemption Confirmation Badge - shows when product was autocalled */}
                        {obs.autocalled && obs.hasOccurred && (
                          <>
                            {obs.redemptionConfirmed ? (
                              <span
                                style={{
                                  background: 'linear-gradient(135deg, var(--info-color) 0%, #2563eb 100%)',
                                  color: '#ffffff',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '6px',
                                  fontSize: '0.65rem',
                                  fontWeight: '700',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  boxShadow: '0 2px 6px rgba(59, 130, 246, 0.3)',
                                  cursor: 'help',
                                  whiteSpace: 'nowrap'
                                }}
                                title={obs.confirmedRedemption ?
                                  `Redemption Confirmed\nAmount: ${obs.confirmedRedemption.actualAmount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${obs.confirmedRedemption.currency || ''}\nDate: ${new Date(obs.confirmedRedemption.actualDate).toLocaleDateString('en-GB')}\nConfidence: ${obs.redemptionMatchConfidence}`
                                  : 'Redemption Confirmed'}
                              >
                                ✓ {tr.redeemed}
                              </span>
                            ) : obs.redemptionIsPastDue ? (
                              <span
                                style={{
                                  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                                  color: '#ffffff',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '6px',
                                  fontSize: '0.65rem',
                                  fontWeight: '700',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  boxShadow: '0 2px 6px rgba(249, 115, 22, 0.3)',
                                  cursor: 'help',
                                  whiteSpace: 'nowrap'
                                }}
                                title="Redemption past due - not found in PMS operations"
                              >
                                ⚠ {tr.redeemed}
                              </span>
                            ) : (
                              <span
                                style={{
                                  // On the green redemption row the muted chip is illegible —
                                  // use a translucent white pill with white text there
                                  background: isRedemptionRow
                                    ? 'rgba(255, 255, 255, 0.25)'
                                    : 'color-mix(in srgb, var(--text-muted) 18%, transparent)',
                                  color: isRedemptionRow ? '#ffffff' : 'var(--text-muted)',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '6px',
                                  fontSize: '0.65rem',
                                  fontWeight: '700',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  cursor: 'help',
                                  whiteSpace: 'nowrap'
                                }}
                                title={obs.redemptionMatchMessage || 'Redemption status unknown'}
                              >
                                ? {tr.redeemed}
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      {/* Observation Type - Badge Style */}
                      <div style={{
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center'
                      }}>
                        <span style={{
                          background: isRedemptionRow
                            ? 'rgba(255, 255, 255, 0.3)'
                            : isFinalObservation
                              ? 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)'
                              : isFutureRow
                                ? 'color-mix(in srgb, var(--text-muted) 18%, transparent)'
                                : 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                          color: isRedemptionRow || isFinalObservation
                            ? '#ffffff'
                            : isFutureRow
                              ? '#64748b'
                              : '#ffffff',
                          padding: '0.4rem 0.85rem',
                          borderRadius: '8px',
                          fontWeight: '700',
                          whiteSpace: 'nowrap',
                          boxShadow: isFutureRow
                            ? 'none'
                            : '0 2px 12px rgba(30, 41, 59, 0.2)',
                          letterSpacing: '0.3px'
                        }}>
                          {obs.observationType}
                        </span>
                      </div>

                      {/* Autocall Level */}
                      <div style={{
                        fontSize: '0.875rem',
                        color: isRedemptionRow
                          ? '#ffffff'
                          : !obs.isCallable
                            ? 'var(--text-muted)'
                            : isFutureRow
                              ? 'var(--neutral-color)'
                              : 'var(--text-primary)',
                        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                        textAlign: 'center',
                        fontWeight: '700'
                      }}>
                        {obs.autocallLevelFormatted}
                      </div>

                      {/* Product Called - Enhanced Visual */}
                      <div style={{
                        fontSize: '0.875rem',
                        textAlign: 'center',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}>
                        {obs.productCalled === null ? (
                          <span style={{
                            color: 'var(--neutral-color)',
                            fontStyle: 'italic',
                            fontSize: '0.8rem',
                            fontWeight: '500'
                          }}>
                            ⏳ {tr.tbd}
                          </span>
                        ) : obs.productCalled ? (
                          <span style={{
                            background: isRedemptionRow
                              ? 'rgba(255, 255, 255, 0.3)'
                              : 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                            color: '#ffffff',
                            padding: '0.4rem 0.85rem',
                            borderRadius: '8px',
                            fontWeight: '700',
                            fontSize: '0.75rem',
                            boxShadow: isRedemptionRow ? 'none' : '0 2px 12px rgba(5, 150, 105, 0.3)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            letterSpacing: '0.3px'
                          }}>
                            ✓ {tr.yes}
                          </span>
                        ) : (
                          <span style={{
                            color: isRedemptionRow ? 'rgba(255, 255, 255, 0.7)' : 'var(--text-muted)',
                            fontSize: '0.8rem',
                            fontWeight: '600'
                          }}>
                            ✗ {tr.no}
                          </span>
                        )}
                      </div>

                      {/* Coupon Paid */}
                      <div style={{
                        fontSize: '0.875rem',
                        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                        textAlign: 'center',
                        fontWeight: '700'
                      }}>
                        {obs.couponPaid > 0 ? (
                          <span style={{
                            color: isRedemptionRow ? '#ffffff' : '#059669',
                            background: isRedemptionRow
                              ? 'rgba(255, 255, 255, 0.2)'
                              : '#d1fae5',
                            padding: '0.35rem 0.75rem',
                            borderRadius: '8px',
                            display: 'inline-block',
                            boxShadow: isRedemptionRow ? 'none' : '0 1px 3px rgba(5, 150, 105, 0.1)'
                          }}>
                            {obs.couponPaidFormatted}
                          </span>
                        ) : (
                          <span style={{
                            color: isRedemptionRow ? 'rgba(255, 255, 255, 0.5)' : 'var(--border-color)',
                            fontWeight: '400'
                          }}>
                            —
                          </span>
                        )}
                      </div>

                      {/* Memory Coupon - Hide when guaranteed coupon is enabled */}
                      {!results.observationAnalysis.hasGuaranteedCoupon && (
                        <div style={{
                          fontSize: '0.875rem',
                          fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                          textAlign: 'center',
                          fontWeight: '700'
                        }}>
                          {obs.couponInMemory > 0 ? (
                            <span style={{
                              color: isRedemptionRow ? '#ffffff' : '#c2410c',
                              background: isRedemptionRow
                                ? 'rgba(255, 255, 255, 0.2)'
                                : '#fed7aa',
                              padding: '0.35rem 0.75rem',
                              borderRadius: '8px',
                              display: 'inline-block',
                              boxShadow: isRedemptionRow ? 'none' : '0 1px 3px rgba(234, 88, 12, 0.1)'
                            }}>
                              {obs.couponInMemoryFormatted}
                            </span>
                          ) : (
                            <span style={{
                              color: isRedemptionRow ? 'rgba(255, 255, 255, 0.5)' : 'var(--border-color)',
                              fontWeight: '400'
                            }}>
                              —
                            </span>
                          )}
                        </div>
                      )}

                      {/* Memory Autocall Flags - Only show locked/flagged underlyings */}
                      {results.observationAnalysis.hasMemoryAutocall && (
                        <div style={{
                          fontSize: '0.75rem',
                          textAlign: 'center',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.25rem',
                          justifyContent: 'center',
                          alignItems: 'center'
                        }}>
                          {(() => {
                            // Filter to show only flagged underlyings
                            const flaggedUnderlyings = obs.underlyingFlags?.filter(flag => flag.isFlagged) || [];

                            if (flaggedUnderlyings.length === 0) {
                              // No flags yet
                              return (
                                <span style={{
                                  color: isRedemptionRow ? 'rgba(255, 255, 255, 0.5)' : 'var(--neutral-color)',
                                  fontStyle: 'italic',
                                  fontSize: '0.7rem'
                                }}>
                                  —
                                </span>
                              );
                            }

                            if (obs.allUnderlyingsFlagged) {
                              // All underlyings are flagged - show "All Flagged" badge
                              return (
                                <span style={{
                                  background: isRedemptionRow
                                    ? 'rgba(255, 255, 255, 0.3)'
                                    : 'linear-gradient(135deg, var(--gain-color) 0%, #059669 100%)',
                                  color: '#ffffff',
                                  padding: '0.35rem 0.65rem',
                                  borderRadius: '8px',
                                  fontWeight: '700',
                                  fontSize: '0.7rem',
                                  boxShadow: isRedemptionRow ? 'none' : '0 2px 8px rgba(16, 185, 129, 0.3)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem'
                                }}>
                                  {tr.allFlagged} ✓
                                </span>
                              );
                            }

                            // Show only flagged underlyings
                            return flaggedUnderlyings.map(flag => (
                              <span
                                key={flag.ticker}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '0.25rem 0.5rem',
                                  borderRadius: '6px',
                                  background: isRedemptionRow ? 'rgba(255, 255, 255, 0.2)' : '#d1fae5',
                                  color: isRedemptionRow ? '#ffffff' : '#059669',
                                  fontSize: '0.7rem',
                                  fontWeight: '700',
                                  border: flag.isNewFlag ? '1px solid var(--gain-color)' : 'none',
                                  gap: '0.25rem'
                                }}
                                title={`${flag.ticker} flagged${flag.isNewFlag ? ' (new!)' : ''}`}
                              >
                                {flag.ticker}
                                <span>🔒</span>
                                {flag.isNewFlag && <span style={{ fontSize: '0.6rem' }}>✨</span>}
                              </span>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* Performance Chart */}
      {productId && (
        <div className="pdf-card pdf-page-break-before structured-product-chart" style={{
          background: 'var(--bg-primary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            📈 {tr.performanceEvolution}
          </h4>
          <StructuredProductChart productId={productId} height={isMobile ? '300px' : '450px'} />
        </div>
      )}

      {/* Phoenix Parameters Summary */}
      <div className="pdf-card pdf-page-break-before" style={{
        background: 'var(--bg-primary)',
        padding: isMobile ? '1rem' : '1.5rem',
        borderRadius: '6px',
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: isMobile ? '1rem' : '1.5rem'
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            {tr.autocallBarrier}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {phoenixParams.autocallBarrier}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            {tr.protectionBarrier}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {phoenixParams.protectionBarrier}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            {results.observationAnalysis.hasGuaranteedCoupon ? 'Guaranteed Coupon' : tr.memoryCoupon}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {phoenixParams.couponRate}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            {tr.observationFrequency}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)', textTransform: 'capitalize' }}>
            {phoenixParams.observationFrequency}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhoenixReport;
