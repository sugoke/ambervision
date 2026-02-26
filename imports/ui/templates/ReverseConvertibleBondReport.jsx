import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import PriceSparkline from '../components/PriceSparkline.jsx';

/**
 * Reverse Convertible (Bond) Report Component
 *
 * Displays evaluation results for Reverse Convertible products on bond underlyings
 * using the physical delivery / conversion ratio model.
 *
 * Shows: strike level, conversion ratio, settlement type (cash/physical delivery),
 * guaranteed coupon, underlying performance, and redemption calculations.
 *
 * CSS Styling Reference: PhoenixReport.jsx
 */
const ReverseConvertibleBondReport = ({ results, productId }) => {
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
        Reverse Convertible (Bond) Evaluation Results
      </div>

      {/* Product Structure Summary */}
      <div style={{
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        border: '2px solid #34d399',
        boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)'
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
          Product Structure
        </h4>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '1rem'
        }}>
          {/* Strike Level */}
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
              Strike Level
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'white',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>
              {reverseConvertibleParams.strikeLevelFormatted}
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)',
              lineHeight: '1.4'
            }}>
              Physical delivery threshold
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
              Guaranteed Coupon
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'white',
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

          {/* Conversion Ratio */}
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
              Conversion Ratio
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'white',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>
              {reverseConvertibleParams.conversionRatioFormatted}
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)',
              lineHeight: '1.4'
            }}>
              Bonds delivered per note
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
            Underlying Assets Performance
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
                      📜
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
                      {underlying.currency && <span>Denominated in {underlying.currency}</span>}
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

                  {/* Strike Level — always show, fall back to product-level value */}
                  <div style={{
                    background: 'var(--bg-primary)',
                    padding: '0.85rem',
                    borderRadius: '6px',
                    textAlign: 'center',
                    border: '1px solid rgba(52, 211, 153, 0.3)'
                  }}>
                    <div style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600',
                      letterSpacing: '0.5px'
                    }}>
                      Strike Level
                    </div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '700',
                      color: '#34d399',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.strikeLevelFormatted || reverseConvertibleParams.strikeLevelFormatted || 'N/A'}
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
                        <span style={{ fontSize: '0.7rem', marginLeft: '0.25rem', color: '#ef4444' }} title="Missing data">!</span>
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

                  {/* Strike Distance */}
                  <div style={{
                    background: underlying.strikeStatus === 'breached' ? 'rgba(239, 68, 68, 0.1)' :
                               underlying.strikeStatus === 'near' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                    padding: '0.85rem',
                    borderRadius: '6px',
                    textAlign: 'center',
                    border: `1px solid ${
                      underlying.strikeStatus === 'breached' ? 'rgba(239, 68, 68, 0.3)' :
                      underlying.strikeStatus === 'near' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)'
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
                      Strike Distance
                    </div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '700',
                      color: underlying.strikeStatus === 'breached' ? '#ef4444' :
                             underlying.strikeStatus === 'near' ? '#f59e0b' : '#10b981',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.distanceToStrikeFormatted}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: underlying.strikeStatus === 'breached' ? '#ef4444' :
                             underlying.strikeStatus === 'near' ? '#f59e0b' : '#10b981',
                      marginTop: '0.35rem',
                      fontWeight: '600'
                    }}>
                      {underlying.strikeStatusText}
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
            Performance Overview
            {reverseConvertibleParams.strikeLevel && (
              <span style={{
                fontSize: '0.75rem',
                background: '#10b981',
                color: 'white',
                padding: '3px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                Strike at {reverseConvertibleParams.strikeLevelFormatted}
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
                // Bond chart: zero = initial price. All positions are absolute price deviations (pp of par).
                const initialPrice = underlying.initialPrice || 0;
                const currentPrice = underlying.currentPrice || 0;
                const strikeLevel = underlying.strikeLevel || reverseConvertibleParams.strikeLevel || 0;

                // Deviations from initial price in percentage-points of par
                const barDev = currentPrice - initialPrice;       // e.g. 67.04 - 67.38 = -0.34pp
                const strikeDev = strikeLevel - initialPrice;     // e.g. 72.45 - 67.38 = +5.07pp (right of zero)

                // Scale: right side must fit the strike + margin; left side fits the bar + margin
                const rightMax = Math.max(strikeDev * 1.4, Math.abs(barDev) * 1.4, 3);
                const leftMax = Math.max(Math.abs(barDev) * 1.4, rightMax * 0.25, 1.5);
                const totalRange = leftMax + rightMax;

                // Zero (= initial price) position as % of bar width
                const zeroPos = (leftMax / totalRange) * 100;

                // Bar position
                let barLeft = 0;
                let barWidth = 0;
                if (barDev >= 0) {
                  barLeft = zeroPos;
                  barWidth = Math.min((barDev / totalRange) * 100, 100 - zeroPos);
                } else {
                  barWidth = Math.min((Math.abs(barDev) / totalRange) * 100, zeroPos);
                  barLeft = zeroPos - barWidth;
                }

                // Strike line position (to the right when strikeLevel > initialPrice)
                const strikePos = Math.max(1, Math.min(99, zeroPos + (strikeDev / totalRange) * 100));

                // Axis labels (actual bond prices in % of par)
                const leftEdgePrice = initialPrice - leftMax;
                const rightEdgePrice = initialPrice + rightMax;

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
                        <span style={{ fontSize: '0.75rem', color: '#ef4444' }} title="Worst Performing">!</span>
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
                      {/* Zero line = initial price */}
                      <div style={{
                        position: 'absolute',
                        left: `${zeroPos}%`,
                        top: 0,
                        bottom: 0,
                        width: '2px',
                        background: 'var(--border-color)',
                        zIndex: 1
                      }} />

                      {/* Strike level line (to the right for strike > initial) */}
                      {strikeLevel > 0 && (
                        <div style={{
                          position: 'absolute',
                          left: `${strikePos}%`,
                          top: '-8px',
                          bottom: '-8px',
                          width: '3px',
                          background: '#34d399',
                          zIndex: 2,
                          boxShadow: '0 0 8px rgba(52, 211, 153, 0.6), 0 0 16px rgba(52, 211, 153, 0.3)'
                        }}>
                          {index === 0 && (
                            <div style={{
                              position: 'absolute',
                              top: '-24px',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              fontSize: '0.65rem',
                              color: '#34d399',
                              fontWeight: '700',
                              whiteSpace: 'nowrap',
                              background: 'var(--bg-tertiary)',
                              padding: '2px 6px',
                              borderRadius: '3px',
                              boxShadow: '0 0 6px rgba(52, 211, 153, 0.3)'
                            }}>
                              Strike {underlying.strikeLevelFormatted || reverseConvertibleParams.strikeLevelFormatted}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Price deviation bar */}
                      <div style={{
                        position: 'absolute',
                        left: `${barLeft}%`,
                        top: '4px',
                        bottom: '4px',
                        width: `${barWidth}%`,
                        background: barDev >= 0
                          ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
                          : 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
                        borderRadius: '3px',
                        transition: 'all 0.3s ease',
                        boxShadow: barDev >= 0
                          ? '0 2px 8px rgba(16, 185, 129, 0.3)'
                          : '0 2px 8px rgba(239, 68, 68, 0.3)',
                        zIndex: 3
                      }} />

                      {/* Scale markers (price axis in % of par) */}
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
                            {leftEdgePrice.toFixed(2)}%
                          </div>
                          <div style={{
                            position: 'absolute',
                            left: `${zeroPos}%`,
                            bottom: '-20px',
                            transform: 'translateX(-50%)',
                            fontSize: '0.65rem',
                            color: 'var(--text-secondary)',
                            fontWeight: '600',
                            fontFamily: 'monospace',
                            whiteSpace: 'nowrap'
                          }}>
                            {initialPrice.toFixed(2)}% ★
                          </div>
                          <div style={{
                            position: 'absolute',
                            right: '0%',
                            bottom: '-20px',
                            fontSize: '0.65rem',
                            color: 'var(--text-muted)',
                            fontFamily: 'monospace'
                          }}>
                            {rightEdgePrice.toFixed(2)}%
                          </div>
                        </>
                      )}
                    </div>

                    {/* Current price value */}
                    <div style={{
                      fontSize: '0.9rem',
                      fontWeight: '700',
                      color: barDev >= 0 ? '#10b981' : '#ef4444',
                      textAlign: 'right',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.currentPriceFormatted}
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
                  width: '2px',
                  height: '16px',
                  background: 'var(--border-color)'
                }} />
                <span>★ Initial Price (reference zero)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '20px',
                  height: '12px',
                  background: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
                  borderRadius: '2px'
                }} />
                <span>Price below initial</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '20px',
                  height: '12px',
                  background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                  borderRadius: '2px'
                }} />
                <span>Price above initial</span>
              </div>
              {reverseConvertibleParams.strikeLevel && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '3px',
                    height: '16px',
                    background: '#34d399',
                    boxShadow: '0 0 6px rgba(52, 211, 153, 0.5)'
                  }} />
                  <span>Strike ({reverseConvertibleParams.strikeLevelFormatted})</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Strike Analysis */}
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
            Strike Analysis
            <span style={{
              fontSize: '0.8rem',
              background: basketAnalysis.breachedCount > 0 ? '#ef4444' :
                         basketAnalysis.nearCount > 0 ? '#f59e0b' : '#10b981',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontWeight: '500'
            }}>
              {reverseConvertibleParams.strikeLevelFormatted} Strike
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
                Above Strike
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
                  Near Strike
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
                  At/Below Strike
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Redemption Calculation */}
      {redemption && (
        <div style={{
          background: redemption.strikeBreached
            ? 'rgba(249, 115, 22, 0.15)'
            : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          padding: '1.5rem',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          border: redemption.strikeBreached
            ? '1px solid rgba(249, 115, 22, 0.35)'
            : '2px solid #34d399',
          boxShadow: redemption.strikeBreached
            ? '0 4px 16px rgba(249, 115, 22, 0.1)'
            : '0 8px 24px rgba(16, 185, 129, 0.3)'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1.1rem',
            color: redemption.strikeBreached ? '#ea580c' : 'white',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontWeight: '700'
          }}>
            Redemption Calculation
            <span style={{
              fontSize: '0.7rem',
              background: redemption.strikeBreached ? 'rgba(249, 115, 22, 0.2)' : 'rgba(255, 255, 255, 0.25)',
              color: redemption.strikeBreached ? '#ea580c' : 'white',
              padding: '3px 8px',
              borderRadius: '4px',
              fontWeight: '500'
            }}>
              {redemption.settlementTypeLabel}
            </span>
          </h4>

          <div style={{
            background: redemption.strikeBreached ? 'rgba(249, 115, 22, 0.08)' : 'rgba(255, 255, 255, 0.15)',
            padding: '1rem',
            borderRadius: '6px',
            marginBottom: '1rem',
            fontSize: '0.8rem',
            color: redemption.strikeBreached ? 'var(--text-secondary)' : 'rgba(255, 255, 255, 0.95)',
            fontStyle: 'italic',
            border: redemption.strikeBreached ? '1px solid rgba(249, 115, 22, 0.15)' : '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            {redemption.capitalExplanation}
          </div>

          {/* Total Redemption Value - Large Display */}
          <div style={{
            background: redemption.strikeBreached ? 'var(--bg-secondary)' : 'white',
            padding: '2rem',
            borderRadius: '8px',
            textAlign: 'center',
            marginBottom: '1.5rem',
            boxShadow: redemption.strikeBreached ? 'none' : '0 4px 16px rgba(0, 0, 0, 0.1)',
            border: redemption.strikeBreached ? '1px solid rgba(249, 115, 22, 0.2)' : 'none'
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
              color: redemption.strikeBreached ? '#ea580c' : '#10b981',
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
            gridTemplateColumns: redemption.strikeBreached ? '1fr 1fr 1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem'
          }}>
            {/* Capital Component */}
            <div style={{
              background: redemption.strikeBreached ? 'rgba(249, 115, 22, 0.08)' : 'rgba(255, 255, 255, 0.15)',
              padding: '1.25rem',
              borderRadius: '6px',
              border: redemption.strikeBreached ? '1px solid rgba(249, 115, 22, 0.15)' : '1px solid rgba(255, 255, 255, 0.2)'
            }}>
              <div style={{
                fontSize: '0.7rem',
                color: redemption.strikeBreached ? '#ea580c' : 'rgba(255, 255, 255, 0.85)',
                textTransform: 'uppercase',
                marginBottom: '0.75rem',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>
                {redemption.strikeBreached ? 'Delivery Value' : 'Capital Return'}
              </div>
              <div style={{
                fontSize: '1.8rem',
                fontWeight: '700',
                color: redemption.strikeBreached ? 'var(--text-primary)' : 'white',
                marginBottom: '0.5rem',
                fontFamily: 'monospace'
              }}>
                {redemption.capitalComponentFormatted}
              </div>
              <div style={{
                fontSize: '0.7rem',
                color: redemption.strikeBreached ? 'var(--text-secondary)' : 'rgba(255, 255, 255, 0.75)',
                lineHeight: '1.4'
              }}>
                {redemption.strikeBreached ? 'Physical delivery of bonds' : 'Cash settlement at par'}
              </div>
            </div>

            {/* Guaranteed Coupon */}
            <div style={{
              background: redemption.strikeBreached ? 'rgba(249, 115, 22, 0.08)' : 'rgba(255, 255, 255, 0.15)',
              padding: '1.25rem',
              borderRadius: '6px',
              border: redemption.strikeBreached ? '1px solid rgba(249, 115, 22, 0.15)' : '1px solid rgba(255, 255, 255, 0.2)'
            }}>
              <div style={{
                fontSize: '0.7rem',
                color: redemption.strikeBreached ? '#ea580c' : 'rgba(255, 255, 255, 0.85)',
                textTransform: 'uppercase',
                marginBottom: '0.75rem',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>
                Guaranteed Coupon
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
                color: redemption.strikeBreached ? 'var(--text-secondary)' : 'rgba(255, 255, 255, 0.75)'
              }}>
                Always paid at maturity
              </div>
            </div>

            {/* Conversion Ratio (only shown when strike breached) */}
            {redemption.strikeBreached && (
              <div style={{
                background: 'rgba(249, 115, 22, 0.08)',
                padding: '1.25rem',
                borderRadius: '6px',
                border: '1px solid rgba(249, 115, 22, 0.15)'
              }}>
                <div style={{
                  fontSize: '0.7rem',
                  color: '#ea580c',
                  textTransform: 'uppercase',
                  marginBottom: '0.75rem',
                  fontWeight: '700',
                  letterSpacing: '0.5px'
                }}>
                  Conversion Ratio
                </div>
                <div style={{
                  fontSize: '1.8rem',
                  fontWeight: '700',
                  color: 'var(--text-primary)',
                  marginBottom: '0.5rem',
                  fontFamily: 'monospace'
                }}>
                  {redemption.conversionRatioFormatted}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.4'
                }}>
                  Bonds per note denomination
                </div>
              </div>
            )}
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
            Performance Evolution
          </h4>
          <StructuredProductChart productId={productId} height="450px" />
        </div>
      )}

      {/* Parameters Summary */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '1.5rem'
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Strike Level
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {reverseConvertibleParams.strikeLevelFormatted}
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
            Conversion Ratio
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {reverseConvertibleParams.conversionRatioFormatted}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Denomination
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {reverseConvertibleParams.denominationFormatted}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Par Amount
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {reverseConvertibleParams.parAmountFormatted}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Accrued Interest
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {reverseConvertibleParams.accruedInterestFormatted}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReverseConvertibleBondReport;
