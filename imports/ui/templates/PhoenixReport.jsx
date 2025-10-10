import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';

/**
 * Phoenix Autocallable Report Component
 *
 * Displays comprehensive evaluation results for Phoenix Autocallable products.
 * Shows underlying performance, autocall barriers, memory coupons, protection levels,
 * observation schedule, and detailed charts.
 */
const PhoenixReport = ({ results, productId }) => {
  const phoenixParams = results.phoenixStructure || {};
  const status = results.currentStatus || {};
  const features = results.features || {};
  const placeholder = results.placeholderResults || {};
  const underlyings = results.underlyings || [];

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
        🔥 Phoenix Autocallable Evaluation Results
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
                padding: '1rem',
                borderRadius: '6px',
                border: underlying.isWorstPerforming
                  ? '2px solid #ef4444'
                  : `1px solid ${underlying.isPositive ? '#10b981' : '#ef4444'}20`,
                boxShadow: underlying.isWorstPerforming
                  ? '0 0 0 1px rgba(239, 68, 68, 0.1)'
                  : 'none'
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto auto auto auto',
                  gap: '1rem',
                  alignItems: 'center'
                }}>
                  {/* Company Info */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: '120px'
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.25rem'
                    }}>
                      {/* Stock Logo */}
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)'
                      }}>
                        <img
                          src={`https://financialmodelingprep.com/image-stock/${underlying.ticker}.png`}
                          alt={underlying.ticker}
                          style={{
                            width: '32px',
                            height: '32px',
                            objectFit: 'contain'
                          }}
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                        <div style={{
                          display: 'none',
                          width: '32px',
                          height: '32px',
                          background: 'var(--accent-color)',
                          borderRadius: '4px',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          color: 'white'
                        }}>
                          {underlying.ticker?.substring(0, 2).toUpperCase()}
                        </div>
                      </div>
                      <div style={{
                        fontSize: '0.9rem',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem'
                      }}>
                        {underlying.ticker}
                        {underlying.hasMemoryAutocallFlag && (
                          <span
                            style={{
                              fontSize: '0.85rem',
                              color: '#10b981',
                              cursor: 'help'
                            }}
                            title={`Flagged for Memory Autocall on ${underlying.memoryAutocallFlaggedDateFormatted || 'N/A'}`}
                          >
                            🔒
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.2'
                    }}>
                      {underlying.name}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem'
                    }}>
                      {underlying.exchange} • {underlying.currency}
                    </div>
                  </div>

                  {/* Initial Level */}
                  <div style={{
                    textAlign: 'center'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.25rem'
                    }}>
                      Initial Level
                    </div>
                    <div style={{
                      fontSize: '1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.initialPriceFormatted}
                    </div>
                  </div>

                  {/* Current/Redemption Level */}
                  <div style={{
                    textAlign: 'center'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.25rem'
                    }}>
                      {underlying.priceLevelLabel || 'Current Level'}
                    </div>
                    <div style={{
                      fontSize: '1rem',
                      fontWeight: '600',
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
                        marginTop: '0.25rem'
                      }}>
                        {underlying.priceDateFormatted}
                      </div>
                    )}
                  </div>

                  {/* Performance */}
                  <div style={{
                    textAlign: 'center'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.25rem'
                    }}>
                      Performance
                    </div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '700',
                      color: underlying.isPositive ? '#10b981' : '#ef4444',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.performanceFormatted}
                    </div>
                  </div>

                  {/* Barrier Distance */}
                  <div style={{
                    textAlign: 'center'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      marginBottom: '0.25rem'
                    }}>
                      Barrier Distance
                    </div>
                    <div style={{
                      fontSize: '1rem',
                      fontWeight: '600',
                      color: underlying.barrierStatus === 'breached' ? '#ef4444' :
                             underlying.barrierStatus === 'near' ? '#f59e0b' : '#10b981',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.distanceToBarrierFormatted}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: underlying.barrierStatus === 'breached' ? '#ef4444' :
                             underlying.barrierStatus === 'near' ? '#f59e0b' : 'var(--text-muted)',
                      marginTop: '0.25rem'
                    }}>
                      {underlying.barrierStatusText}
                    </div>
                  </div>

                  {/* Status Indicator */}
                  <div style={{
                    width: '8px',
                    height: '40px',
                    background: underlying.isPositive ? '#10b981' : '#ef4444',
                    borderRadius: '4px'
                  }}></div>
                </div>

                {/* ISIN Info */}
                {underlying.isin && (
                  <div style={{
                    marginTop: '0.75rem',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid var(--border-color)',
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)'
                  }}>
                    ISIN: {underlying.isin}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Basket Analysis Summary */}
      {results.basketAnalysis && (
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
                {results.basketAnalysis.safeCount}
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>
                Above Barrier
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
                  Near Barrier
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
                  Breached Barrier
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Observation Schedule */}
      {results.observationAnalysis && results.observationAnalysis.observations && results.observationAnalysis.observations.length > 0 && (
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
            📅 Observation Schedule
            {results.observationAnalysis.isEarlyAutocall && (
              <span style={{
                fontSize: '0.8rem',
                background: '#10b981',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontWeight: '500'
              }}>
                Called {results.observationAnalysis.callDateFormatted}
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
                Matured
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
                Memory Autocall
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
                Memory Coupon
              </span>
            )}
          </h4>

          {/* Summary Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
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
                Total Coupons Earned
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
                In Memory
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
                Total Observations
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
                Remaining
              </div>
            </div>
          </div>

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
                      📅 Observation
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      💰 Payment
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      🏷️ Type
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      🎯 Trigger
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      ✅ Status
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      💵 Coupon
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>
                      🧠 Memory
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
                        🔒 Memory Lock
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
                          🎊 Redeemed
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
                        fontWeight: isMostRecentObservation ? '700' : '600'
                      }}>
                        {obs.paymentDateFormatted}
                      </div>

                      {/* Observation Type - Badge Style */}
                      <div style={{
                        fontSize: '0.75rem',
                        display: 'inline-flex',
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
                            ⏳ TBD
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
                            ✓ YES
                          </span>
                        ) : (
                          <span style={{
                            color: isRedemptionRow ? 'rgba(255, 255, 255, 0.7)' : '#cbd5e1',
                            fontSize: '0.8rem',
                            fontWeight: '600'
                          }}>
                            ✗ NO
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
                                  All Flagged ✓
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
          <StructuredProductChart productId={productId} height="900px" />
        </div>
      )}

      {/* Phoenix Parameters Summary */}
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
            Autocall Barrier
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {phoenixParams.autocallBarrier}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Protection Barrier
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {phoenixParams.protectionBarrier}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Memory Coupon
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {phoenixParams.couponRate}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Observation Frequency
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
