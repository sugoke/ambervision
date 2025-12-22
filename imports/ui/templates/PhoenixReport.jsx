import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';
import { getTranslation, t } from '../../utils/reportTranslations';

/**
 * Phoenix Autocallable Report Component
 *
 * Displays comprehensive evaluation results for Phoenix Autocallable products.
 * Shows underlying performance, autocall barriers, memory coupons, protection levels,
 * observation schedule, and detailed charts.
 * Supports multiple languages (EN/FR) via URL parameter.
 */
const PhoenixReport = ({ results, productId }) => {
  // Get language from URL params
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const lang = urlParams?.get('lang') || 'en';
  const tr = getTranslation(lang);

  const phoenixParams = results.phoenixStructure || {};
  const status = results.currentStatus || {};
  const features = results.features || {};
  const placeholder = results.placeholderResults || {};
  const underlyings = results.underlyings || [];

  // Debug: Log prediction data
  React.useEffect(() => {
    console.log('[PHOENIX REPORT] Report data:', {
      productId,
      hasObsAnalysis: !!results.observationAnalysis,
      hasPrediction: !!results.observationAnalysis?.nextObservationPrediction,
      predictionData: results.observationAnalysis?.nextObservationPrediction
    });
  }, [results, productId]);

  // Mobile detection
  const [isMobile, setIsMobile] = React.useState(typeof window !== 'undefined' && window.innerWidth < 768);
  const [isTablet, setIsTablet] = React.useState(typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth < 1024);

  React.useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      const tablet = window.innerWidth >= 768 && window.innerWidth < 1024;
      setIsMobile(mobile);
      setIsTablet(tablet);
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div>
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
              <div key={underlying.id || index} style={{
                background: 'var(--bg-tertiary)',
                padding: '1.25rem',
                borderRadius: '8px',
                border: underlying.isWorstPerforming
                  ? '2px solid #ef4444'
                  : `1px solid ${underlying.isPositive ? '#10b981' : '#ef4444'}20`,
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
                            color: '#10b981',
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
                        <>
                          <span>ISIN: {underlying.isin}</span>
                        </>
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
                        <span style={{ fontSize: '0.7rem', marginLeft: '0.25rem', color: '#ef4444' }} title="Missing historical data">⚠️</span>
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
                      color: underlying.isPositive ? '#10b981' : '#ef4444',
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
                      color: underlying.barrierStatus === 'breached' ? '#ef4444' :
                             underlying.barrierStatus === 'near' ? '#f59e0b' : '#10b981',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.distanceToBarrierFormatted}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: underlying.barrierStatus === 'breached' ? '#ef4444' :
                             underlying.barrierStatus === 'near' ? '#f59e0b' : '#10b981',
                      marginTop: '0.35rem',
                      fontWeight: '600'
                    }}>
                      {underlying.barrierStatusText}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance Bar Chart - Hidden on mobile portrait */}
      {underlyings.length > 0 && !isMobile && (
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
            padding: '1.5rem',
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
                    gridTemplateColumns: '140px 1fr 80px',
                    gap: '1rem',
                    alignItems: 'center'
                  }}>
                    {/* Ticker name */}
                    <div style={{
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.ticker}
                      {underlying.isWorstPerforming && (
                        <span style={{ fontSize: '0.75rem', color: '#ef4444' }} title={tr.worstPerforming}>⚠️</span>
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
                          ? 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
                          : underlying.barrierStatus === 'near'
                            ? 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)'
                            : 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
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
                      fontSize: '0.9rem',
                      fontWeight: '700',
                      color: underlying.barrierStatus === 'breached'
                        ? '#ef4444'
                        : underlying.barrierStatus === 'near'
                          ? '#f59e0b'
                          : '#10b981',
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
              marginTop: '2.5rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'center',
              gap: '2rem',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '20px',
                  height: '12px',
                  background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                  borderRadius: '2px'
                }} />
                <span>{tr.aboveBarrierSafe}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '20px',
                  height: '12px',
                  background: 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)',
                  borderRadius: '2px'
                }} />
                <span>{tr.nearBarrierWarning}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '20px',
                  height: '12px',
                  background: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
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
              background: results.basketAnalysis.breachedCount > 0 ? '#ef4444' :
                         results.basketAnalysis.nearCount > 0 ? '#f59e0b' : '#10b981',
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
                color: results.basketAnalysis.criticalDistance >= 0 ? '#10b981' : '#ef4444',
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
                color: '#10b981',
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
                  color: '#f59e0b',
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
                  color: '#ef4444',
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

      {/* Indicative Maturity Value - Shows hypothetical redemption if product matured today */}
      {results.indicativeMaturityValue && results.indicativeMaturityValue.isLive && (
        <div className="pdf-card pdf-page-break-before" style={{
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(79, 70, 229, 0.05) 100%)',
          border: '2px solid rgba(99, 102, 241, 0.3)',
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
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, transparent 70%)',
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
              💡 {tr.indicativeValueIfMaturedToday}
            <span style={{
              fontSize: '0.75rem',
              background: 'rgba(99, 102, 241, 0.2)',
              color: '#6366f1',
              padding: '4px 8px',
              borderRadius: '4px',
              fontWeight: '600'
            }}>
              {tr.hypothetical}
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
            {tr.indicativeCalculationDisclaimer}
          </div>

          {/* Total Indicative Value - Large Display */}
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
              {tr.currentTheoreticalTotalReturn}
            </div>
            <div style={{
              fontSize: '3rem',
              fontWeight: '800',
              color: '#6366f1',
              fontFamily: 'monospace',
              lineHeight: '1'
            }}>
              {results.indicativeMaturityValue.totalValueFormatted}
            </div>
            <div style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              marginTop: '0.5rem'
            }}>
              {tr.asOf} {results.indicativeMaturityValue.evaluationDateFormatted}
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
                color: 'var(--text-primary)',
                marginBottom: '0.5rem',
                fontFamily: 'monospace'
              }}>
                {results.indicativeMaturityValue.capitalReturnFormatted}
              </div>
              <div style={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                lineHeight: '1.4'
              }}>
                {results.indicativeMaturityValue.capitalExplanation}
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
                color: results.indicativeMaturityValue.couponsEarned > 0 ? '#10b981' : 'var(--text-muted)',
                marginBottom: '0.5rem',
                fontFamily: 'monospace'
              }}>
                {results.indicativeMaturityValue.couponsEarnedFormatted}
              </div>
              <div style={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)'
              }}>
                {tr.totalCouponsPaidToDate}
              </div>
            </div>

            {/* Memory Coupons */}
            {results.indicativeMaturityValue.hasMemoryCoupons && (
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
                  color: results.indicativeMaturityValue.memoryCouponsForfeit ? '#ef4444' : '#f59e0b',
                  marginBottom: '0.5rem',
                  fontFamily: 'monospace',
                  textDecoration: results.indicativeMaturityValue.memoryCouponsForfeit ? 'line-through' : 'none'
                }}>
                  {results.indicativeMaturityValue.memoryCouponsForfeit
                    ? results.indicativeMaturityValue.memoryCouponsForfeitFormatted
                    : results.indicativeMaturityValue.memoryCouponsFormatted}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)'
                }}>
                  {results.indicativeMaturityValue.memoryCouponsForfeit
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
              <strong>{tr.protectionBarrier}:</strong> {results.indicativeMaturityValue.protectionBarrierFormatted} |
              <strong style={{ marginLeft: '0.5rem' }}>{tr.currentBasket}:</strong> {results.indicativeMaturityValue.basketPerformanceFormatted}
            </div>
          </div>
          </div>
        </div>
      )}

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
                background: '#10b981',
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
            {results.observationAnalysis.hasMemoryCoupon && (
              <span style={{
                fontSize: '0.8rem',
                background: '#f59e0b',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                {tr.memoryCoupon}
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

            <div style={{
              background: 'var(--bg-tertiary)',
              padding: '1rem',
              borderRadius: '6px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '1.2rem',
                fontWeight: '700',
                color: results.observationAnalysis.totalMemoryCoupons > 0 ? '#f59e0b' : 'var(--text-muted)',
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
           !results.observationAnalysis.productCalled && (
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
                    color: '#3b82f6',
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
                            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
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
                          <span style={{
                            color: '#059669',
                            background: '#d1fae5',
                            padding: '0.5rem 1rem',
                            borderRadius: '8px',
                            fontSize: '0.9rem',
                            fontWeight: '700',
                            boxShadow: '0 1px 3px rgba(5, 150, 105, 0.1)'
                          }}>
                            💵 {tr.coupon}: {results.observationAnalysis.nextObservationPrediction.couponAmountFormatted}
                          </span>
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
                            color: '#94a3b8',
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
                      color: results.observationAnalysis.nextObservationPrediction.currentBasketLevel >= 0 ? '#10b981' : '#ef4444'
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

          {/* Observation Table - Elegant Design */}
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
                  minWidth: '750px'
                }}>
                  {/* Table Header - Sleek Dark Header */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: results.observationAnalysis.hasMemoryAutocall
                      ? '1.2fr 1.2fr 1.5fr 1fr 1fr 1fr 1fr 1.3fr'
                      : '1.2fr 1.2fr 1.5fr 1fr 1fr 1fr 1fr',
                    gap: '0.75rem',
                    padding: '1.25rem 1.5rem',
                    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                    borderBottom: '2px solid rgba(148, 163, 184, 0.2)'
                  }}>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      📅 {tr.observation}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      💰 {tr.payment}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      🏷️ {tr.type}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      🎯 {tr.trigger}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      ✅ {tr.autocall}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      💵 {tr.coupon}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      🧠 {tr.memory}
                    </div>
                    {results.observationAnalysis.hasMemoryAutocall && (
                      <div style={{
                        fontSize: '0.7rem',
                        fontWeight: '700',
                        color: '#e2e8f0',
                        textTransform: 'uppercase',
                        textAlign: 'center',
                        letterSpacing: '1px'
                      }}>
                        🔒 {tr.memoryLock}
                      </div>
                    )}
                  </div>

                  {/* Table Rows - Enhanced Visual Hierarchy */}
                  {results.observationAnalysis.observations.map((obs, index) => {
                    // Find the first redemption date
                    const firstCallIndex = results.observationAnalysis.observations.findIndex(o => o.productCalled && o.hasOccurred);
                    const finalIndex = results.observationAnalysis.observations.length - 1;

                    const redemptionIndex = firstCallIndex !== -1 ? firstCallIndex :
                      (results.observationAnalysis.observations[finalIndex].hasOccurred ? finalIndex : -1);

                    const isRedemptionRow = index === redemptionIndex;
                    const isFutureRow = !obs.hasOccurred;
                    const isFinalObservation = index === finalIndex;

                    // Find the last observation that has occurred
                    const lastOccurredIndex = results.observationAnalysis.observations.reduce((lastIdx, observation, idx) => {
                      return observation.hasOccurred ? idx : lastIdx;
                    }, -1);
                    const isMostRecentObservation = index === lastOccurredIndex && lastOccurredIndex !== -1;

                    return (
                    <div key={index} style={{
                      display: 'grid',
                      gridTemplateColumns: results.observationAnalysis.hasMemoryAutocall
                        ? '1.2fr 1.2fr 1.5fr 1fr 1fr 1fr 1fr 1.3fr'
                        : '1.2fr 1.2fr 1.5fr 1fr 1fr 1fr 1fr',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '1rem 1.5rem',
                      borderBottom: index < results.observationAnalysis.observations.length - 1 ?
                        '1px solid rgba(148, 163, 184, 0.15)' : 'none',
                      background: isRedemptionRow
                        ? 'linear-gradient(135deg, #059669 0%, #047857 100%)'
                        : isMostRecentObservation
                          ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(96, 165, 250, 0.15) 100%)'
                          : isFutureRow
                            ? 'rgba(148, 163, 184, 0.05)'
                            : 'transparent',
                      borderLeft: isMostRecentObservation
                        ? '4px solid #3b82f6'
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
                            ? '#94a3b8'
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
                            ? '#94a3b8'
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
                                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
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
                                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
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
                                  background: 'rgba(148, 163, 184, 0.2)',
                                  color: '#64748b',
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
                                ? 'rgba(148, 163, 184, 0.2)'
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
                            ? '#cbd5e1'
                            : isFutureRow
                              ? '#94a3b8'
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
                            color: '#94a3b8',
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
                            color: isRedemptionRow ? 'rgba(255, 255, 255, 0.7)' : '#cbd5e1',
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
                            color: isRedemptionRow ? 'rgba(255, 255, 255, 0.5)' : '#e2e8f0',
                            fontWeight: '400'
                          }}>
                            —
                          </span>
                        )}
                      </div>

                      {/* Memory Coupon */}
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
                            color: isRedemptionRow ? 'rgba(255, 255, 255, 0.5)' : '#e2e8f0',
                            fontWeight: '400'
                          }}>
                            —
                          </span>
                        )}
                      </div>

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
                                  color: isRedemptionRow ? 'rgba(255, 255, 255, 0.5)' : '#94a3b8',
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
                                    : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
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
                                  border: flag.isNewFlag ? '1px solid #10b981' : 'none',
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
          <StructuredProductChart productId={productId} height="450px" />
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
            {tr.memoryCoupon}
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
