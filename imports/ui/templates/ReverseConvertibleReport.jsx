import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';

/**
 * Reverse Convertible Report Component
 *
 * Displays comprehensive evaluation results for Reverse Convertible products.
 * Shows underlying performance, capital protection barrier, guaranteed coupon,
 * gearing factor, and redemption calculations.
 *
 * CSS Styling Reference: PhoenixReport.jsx
 */
const ReverseConvertibleReport = ({ results, productId }) => {
  const reverseConvertibleParams = results.reverseConvertibleStructure || {};
  const status = results.currentStatus || {};
  const underlyings = results.underlyings || [];
  const basketPerformance = results.basketPerformance || {};
  const redemption = results.redemption || {};
  const basketAnalysis = results.basketAnalysis || null;

  return (
    <div style={{
      marginTop: '1rem',
      padding: '1rem',
      background: 'var(--bg-primary)',
      borderRadius: '6px'
    }}>
      <div style={{
        fontSize: '0.9rem',
        fontWeight: '600',
        color: 'var(--text-primary)',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        🔄 Reverse Convertible Evaluation Results
      </div>

      {/* Product Structure Summary */}
      <div style={{
        background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        border: '2px solid #818cf8',
        boxShadow: '0 8px 24px rgba(99, 102, 241, 0.3)'
      }}>
        <h4 style={{
          margin: '0 0 1rem 0',
          fontSize: '1.1rem',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontWeight: '700'
        }}>
          📋 Product Structure
        </h4>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem'
        }}>
          {/* Capital Protection Barrier */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.15)',
            padding: '1.25rem',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.85)',
              textTransform: 'uppercase',
              marginBottom: '0.75rem',
              fontWeight: '700',
              letterSpacing: '0.5px'
            }}>
              🛡️ Capital Protection
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'white',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>
              {reverseConvertibleParams.capitalProtectionBarrierFormatted}
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)',
              lineHeight: '1.4'
            }}>
              Protection barrier level
            </div>
          </div>

          {/* Guaranteed Coupon */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.15)',
            padding: '1.25rem',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.85)',
              textTransform: 'uppercase',
              marginBottom: '0.75rem',
              fontWeight: '700',
              letterSpacing: '0.5px'
            }}>
              💵 Guaranteed Coupon
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: '#10b981',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>
              {reverseConvertibleParams.couponRateFormatted}
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)'
            }}>
              Paid at maturity
            </div>
          </div>

          {/* Gearing Factor */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.15)',
            padding: '1.25rem',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.85)',
              textTransform: 'uppercase',
              marginBottom: '0.75rem',
              fontWeight: '700',
              letterSpacing: '0.5px'
            }}>
              ⚙️ Gearing Factor
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'white',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>
              {reverseConvertibleParams.gearingFactorFormatted}
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)',
              lineHeight: '1.4'
            }}>
              Downside participation below barrier
            </div>
          </div>
        </div>
      </div>

      {/* Underlying Assets Performance Card */}
      {underlyings.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
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
            📊 Underlying Assets Performance
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
                      <span>•</span>
                      <span>{underlying.currency}</span>
                      {underlying.isin && (
                        <>
                          <span>•</span>
                          <span>ISIN: {underlying.isin}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Data Grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: '1.25rem',
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
                      Initial Level
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
                      {underlying.priceLevelLabel || 'Current Level'}
                    </div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '700',
                      color: underlying.hasCurrentData ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.currentPriceFormatted}
                      {underlying.priceSource === 'initial_fallback_error' && (
                        <span style={{ fontSize: '0.7rem', marginLeft: '0.25rem', color: '#ef4444' }} title="Missing data">⚠️</span>
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
                      Performance
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
                      Barrier Distance
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

      {/* Performance Bar Chart */}
      {underlyings.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
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
            📊 Performance Overview
            {reverseConvertibleParams.capitalProtectionBarrier && (
              <span style={{
                fontSize: '0.75rem',
                background: '#6366f1',
                color: 'white',
                padding: '3px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                Protection at {reverseConvertibleParams.capitalProtectionBarrier}%
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
                const performance = underlying.performance || 0;
                const maxRange = 150;
                const zeroPosition = 50;

                let barLeft = 0;
                let barWidth = 0;

                if (performance >= 0) {
                  barLeft = zeroPosition;
                  barWidth = Math.min(performance, 100) * (100 - zeroPosition) / 100;
                } else {
                  const absPerf = Math.abs(performance);
                  barWidth = Math.min(absPerf, 50) * zeroPosition / 50;
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
                        <span style={{ fontSize: '0.75rem', color: '#ef4444' }} title="Worst Performing">⚠️</span>
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
                      {reverseConvertibleParams.capitalProtectionBarrier && (
                        <div style={{
                          position: 'absolute',
                          left: `${zeroPosition + (reverseConvertibleParams.capitalProtectionBarrier - 100) * (zeroPosition / 50)}%`,
                          top: '-8px',
                          bottom: '-8px',
                          width: '3px',
                          background: '#60a5fa',
                          zIndex: 2,
                          boxShadow: '0 0 8px rgba(96, 165, 250, 0.6), 0 0 16px rgba(96, 165, 250, 0.3)'
                        }}>
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
                              Barrier
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
                        background: performance >= 0
                          ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
                          : 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
                        borderRadius: '3px',
                        transition: 'all 0.3s ease',
                        boxShadow: performance >= 0
                          ? '0 2px 8px rgba(16, 185, 129, 0.3)'
                          : '0 2px 8px rgba(239, 68, 68, 0.3)',
                        zIndex: 3
                      }} />

                      {/* Scale markers */}
                      {index === underlyings.length - 1 && (
                        <>
                          <div style={{
                            position: 'absolute',
                            left: '0%',
                            bottom: '-20px',
                            fontSize: '0.65rem',
                            color: 'var(--text-muted)',
                            fontFamily: 'monospace'
                          }}>
                            -50%
                          </div>
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
                          <div style={{
                            position: 'absolute',
                            right: '0%',
                            bottom: '-20px',
                            fontSize: '0.65rem',
                            color: 'var(--text-muted)',
                            fontFamily: 'monospace'
                          }}>
                            +100%
                          </div>
                        </>
                      )}
                    </div>

                    {/* Performance value */}
                    <div style={{
                      fontSize: '0.9rem',
                      fontWeight: '700',
                      color: performance >= 0 ? '#10b981' : '#ef4444',
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
                <span>Positive Performance</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '20px',
                  height: '12px',
                  background: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
                  borderRadius: '2px'
                }} />
                <span>Negative Performance</span>
              </div>
              {reverseConvertibleParams.capitalProtectionBarrier && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '3px',
                    height: '16px',
                    background: '#60a5fa',
                    boxShadow: '0 0 6px rgba(96, 165, 250, 0.5)'
                  }} />
                  <span>Protection Barrier ({reverseConvertibleParams.capitalProtectionBarrier}%)</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Latest News Section */}
      {underlyings.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
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
            📰 Latest News
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

      {/* Capital Protection Analysis */}
      {basketAnalysis && (
        <div style={{
          background: 'var(--bg-secondary)',
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
            🛡️ Capital Protection Analysis
            <span style={{
              fontSize: '0.8rem',
              background: basketAnalysis.breachedCount > 0 ? '#ef4444' :
                         basketAnalysis.nearCount > 0 ? '#f59e0b' : '#10b981',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontWeight: '500'
            }}>
              {basketAnalysis.capitalProtectionBarrier}% Barrier
            </span>
          </h4>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
                color: basketAnalysis.criticalDistance >= 0 ? '#10b981' : '#ef4444',
                marginBottom: '0.5rem'
              }}>
                {basketAnalysis.criticalDistanceFormatted}
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>
                Critical Distance
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
                {basketAnalysis.safeCount}
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>
                Above Barrier
              </div>
            </div>

            {basketAnalysis.nearCount > 0 && (
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
                  {basketAnalysis.nearCount}
                </div>
                <div style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Near Barrier
                </div>
              </div>
            )}

            {basketAnalysis.breachedCount > 0 && (
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
                  {basketAnalysis.breachedCount}
                </div>
                <div style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>
                  Breached Barrier
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Redemption Calculation */}
      {redemption && (
        <div style={{
          background: redemption.barrierBreached
            ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
            : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          padding: '1.5rem',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          border: redemption.barrierBreached
            ? '2px solid #f87171'
            : '2px solid #34d399',
          boxShadow: redemption.barrierBreached
            ? '0 8px 24px rgba(239, 68, 68, 0.3)'
            : '0 8px 24px rgba(16, 185, 129, 0.3)'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1.1rem',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontWeight: '700'
          }}>
            💰 Redemption Calculation
            {redemption.barrierBreached && (
              <span style={{
                fontSize: '0.7rem',
                background: 'rgba(255, 255, 255, 0.25)',
                color: 'white',
                padding: '3px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                Barrier Breached
              </span>
            )}
          </h4>

          <div style={{
            background: 'rgba(255, 255, 255, 0.15)',
            padding: '1rem',
            borderRadius: '6px',
            marginBottom: '1rem',
            fontSize: '0.8rem',
            color: 'rgba(255, 255, 255, 0.95)',
            fontStyle: 'italic',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            {redemption.capitalExplanation}
          </div>

          {/* Total Redemption Value - Large Display */}
          <div style={{
            background: 'white',
            padding: '2rem',
            borderRadius: '8px',
            textAlign: 'center',
            marginBottom: '1.5rem',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              fontSize: '0.85rem',
              color: '#64748b',
              textTransform: 'uppercase',
              fontWeight: '700',
              letterSpacing: '1px',
              marginBottom: '0.75rem'
            }}>
              Total Redemption Value
            </div>
            <div style={{
              fontSize: '3rem',
              fontWeight: '800',
              color: redemption.barrierBreached ? '#ef4444' : '#10b981',
              fontFamily: 'monospace',
              lineHeight: '1'
            }}>
              {redemption.totalValueFormatted}
            </div>
            <div style={{
              fontSize: '0.75rem',
              color: '#94a3b8',
              marginTop: '0.5rem'
            }}>
              {redemption.formula}
            </div>
          </div>

          {/* Breakdown Components */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem'
          }}>
            {/* Capital Component */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.15)',
              padding: '1.25rem',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}>
              <div style={{
                fontSize: '0.7rem',
                color: 'rgba(255, 255, 255, 0.85)',
                textTransform: 'uppercase',
                marginBottom: '0.75rem',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>
                💰 Capital Return
              </div>
              <div style={{
                fontSize: '1.8rem',
                fontWeight: '700',
                color: 'white',
                marginBottom: '0.5rem',
                fontFamily: 'monospace'
              }}>
                {redemption.capitalComponentFormatted}
              </div>
              <div style={{
                fontSize: '0.7rem',
                color: 'rgba(255, 255, 255, 0.75)',
                lineHeight: '1.4'
              }}>
                {redemption.barrierBreached ? 'With geared downside' : 'Fully protected'}
              </div>
            </div>

            {/* Guaranteed Coupon */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.15)',
              padding: '1.25rem',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}>
              <div style={{
                fontSize: '0.7rem',
                color: 'rgba(255, 255, 255, 0.85)',
                textTransform: 'uppercase',
                marginBottom: '0.75rem',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>
                💵 Guaranteed Coupon
              </div>
              <div style={{
                fontSize: '1.8rem',
                fontWeight: '700',
                color: '#10b981',
                marginBottom: '0.5rem',
                fontFamily: 'monospace'
              }}>
                {redemption.couponFormatted}
              </div>
              <div style={{
                fontSize: '0.7rem',
                color: 'rgba(255, 255, 255, 0.75)'
              }}>
                Always paid at maturity
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Performance Chart */}
      {productId && (
        <div style={{
          background: 'var(--bg-secondary)',
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
            📈 Performance Evolution
          </h4>
          <StructuredProductChart productId={productId} height="450px" />
        </div>
      )}

      {/* Reverse Convertible Parameters Summary */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1.5rem'
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Capital Protection Barrier
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {reverseConvertibleParams.capitalProtectionBarrierFormatted}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Guaranteed Coupon
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {reverseConvertibleParams.couponRateFormatted}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Gearing Factor
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {reverseConvertibleParams.gearingFactorFormatted}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Strike Level
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {reverseConvertibleParams.strikeFormatted}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReverseConvertibleReport;
