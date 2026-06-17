import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';
import CopyableISIN from '../components/CopyableISIN.jsx';
import PriceSparkline from '../components/PriceSparkline.jsx';

/**
 * Bonus Certificate Report Component
 *
 * Pure display — every value comes pre-formatted from the evaluator. Sections:
 *   - Product Structure (strike, KI threshold, participation, cap)
 *   - Underlyings table (with KI distance)
 *   - Performance bar chart
 *   - Knock-In status
 *   - Redemption scenario
 *   - Price evolution chart
 *
 * Mirrors ReverseConvertibleReport.jsx styling.
 */
const BonusCertificateReport = ({ results, productId }) => {
  const params = results.bonusCertificateStructure || {};
  const status = results.currentStatus || {};
  const underlyings = results.underlyings || [];
  const basketPerformance = results.basketPerformance || {};
  const redemption = results.redemption || {};
  const knockIn = results.knockIn || {};
  const basketAnalysis = results.basketAnalysis || null;

  const knockInBreached = !!knockIn.hasOccurred;

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
        🎁 {params.variantLabel || 'Bonus Certificate'} Evaluation Results
      </div>

      {/* Product Structure Summary */}
      <div style={{
        background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        border: '2px solid #2dd4bf',
        boxShadow: '0 8px 24px rgba(20, 184, 166, 0.3)'
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem'
        }}>
          {/* Knock-In Threshold */}
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
              🛡️ Knock-In Threshold
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'white',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>
              {params.barrierLevelFormatted}
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)',
              lineHeight: '1.4'
            }}>
              {params.barrierTypeLabel}
            </div>
          </div>

          {/* Participation */}
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
              📈 Participation
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'white',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>
              {params.participationRateFormatted}
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)'
            }}>
              {params.participationRate > 100 ? 'Leveraged upside' : 'Vanilla upside'}
            </div>
          </div>

          {/* Cap */}
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
              🧢 Cap
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'white',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>
              {params.capFormatted}
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)'
            }}>
              Max redemption {params.maxRedemptionFormatted}
            </div>
          </div>

          {/* Bonus Floor */}
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
              🎯 Bonus Floor
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'white',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>
              {params.bonusLevelFormatted}
            </div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)'
            }}>
              If no knock-in
            </div>
          </div>
        </div>

        {/* Basket type tag */}
        {params.basketTypeLabel && (
          <div style={{
            marginTop: '1rem',
            fontSize: '0.75rem',
            color: 'rgba(255, 255, 255, 0.85)'
          }}>
            Aggregation: <strong>{params.basketTypeLabel}</strong>
          </div>
        )}
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

          <div style={{ display: 'grid', gap: '1rem' }}>
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
                {/* Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid var(--border-color)'
                }}>
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
                      style={{ width: '36px', height: '36px', objectFit: 'contain' }}
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

                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '1rem',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace',
                      marginBottom: '0.25rem'
                    }}>
                      {underlying.ticker}
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
                          <CopyableISIN isin={underlying.isin} prefix="ISIN: " />
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Data grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: '1.25rem',
                  alignItems: 'start'
                }}>
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
                    }}>Initial Level</div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace'
                    }}>{underlying.initialPriceFormatted}</div>
                  </div>

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
                    }}>{underlying.priceLevelLabel || 'Current Level'}</div>
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
                      }}>{underlying.priceDateFormatted}</div>
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
                    }}>Performance</div>
                    <div style={{
                      fontSize: '1.2rem',
                      fontWeight: '700',
                      color: underlying.isPositive ? '#10b981' : '#ef4444',
                      fontFamily: 'monospace'
                    }}>{underlying.performanceFormatted}</div>
                  </div>

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
                    }}>KI Distance</div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '700',
                      color: underlying.barrierStatus === 'breached' ? '#ef4444' :
                             underlying.barrierStatus === 'near' ? '#f59e0b' : '#10b981',
                      fontFamily: 'monospace'
                    }}>{underlying.distanceToBarrierFormatted}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: underlying.barrierStatus === 'breached' ? '#ef4444' :
                             underlying.barrierStatus === 'near' ? '#f59e0b' : '#10b981',
                      marginTop: '0.35rem',
                      fontWeight: '600'
                    }}>{underlying.barrierStatusText}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Knock-In Status */}
      <div style={{
        background: knockInBreached
          ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
          : (knockIn.observed
            ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
            : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'),
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        border: knockInBreached ? '2px solid #f87171' : '2px solid rgba(255, 255, 255, 0.2)',
        boxShadow: knockInBreached
          ? '0 8px 24px rgba(239, 68, 68, 0.3)'
          : '0 8px 24px rgba(0, 0, 0, 0.1)'
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
          🛡️ Knock-In Status — {knockIn.statusLabel}
          <span style={{
            fontSize: '0.7rem',
            background: 'rgba(255, 255, 255, 0.25)',
            color: 'white',
            padding: '3px 8px',
            borderRadius: '4px',
            fontWeight: '500'
          }}>{knockIn.typeLabel}</span>
        </h4>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem'
        }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.15)',
            padding: '1rem',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.85)',
              textTransform: 'uppercase',
              marginBottom: '0.5rem',
              fontWeight: '700',
              letterSpacing: '0.5px'
            }}>Basket Performance</div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: 'white',
              fontFamily: 'monospace'
            }}>{basketPerformance.currentFormatted}</div>
          </div>

          <div style={{
            background: 'rgba(255, 255, 255, 0.15)',
            padding: '1rem',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.85)',
              textTransform: 'uppercase',
              marginBottom: '0.5rem',
              fontWeight: '700',
              letterSpacing: '0.5px'
            }}>Distance to KI</div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: 'white',
              fontFamily: 'monospace'
            }}>{knockIn.currentDistanceFormatted}</div>
          </div>

          {knockIn.occurredAtFormatted && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.15)',
              padding: '1rem',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}>
              <div style={{
                fontSize: '0.7rem',
                color: 'rgba(255, 255, 255, 0.85)',
                textTransform: 'uppercase',
                marginBottom: '0.5rem',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>Breached On</div>
              <div style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: 'white',
                fontFamily: 'monospace'
              }}>{knockIn.occurredAtFormatted}</div>
              {knockIn.breachedTicker && (
                <div style={{
                  fontSize: '0.75rem',
                  color: 'rgba(255, 255, 255, 0.85)',
                  marginTop: '0.25rem'
                }}>by {knockIn.breachedTicker}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Redemption Calculation */}
      <div style={{
        background: knockInBreached
          ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
          : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        border: knockInBreached ? '2px solid #f87171' : '2px solid #34d399',
        boxShadow: knockInBreached
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
          <span style={{
            fontSize: '0.7rem',
            background: 'rgba(255, 255, 255, 0.25)',
            color: 'white',
            padding: '3px 8px',
            borderRadius: '4px',
            fontWeight: '500'
          }}>{redemption.scenarioLabel}</span>
        </h4>

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
          }}>Total Redemption Value</div>
          <div style={{
            fontSize: '3rem',
            fontWeight: '800',
            color: knockInBreached ? '#ef4444' : '#10b981',
            fontFamily: 'monospace',
            lineHeight: '1'
          }}>{redemption.totalValueFormatted}</div>
          <div style={{
            fontSize: '0.75rem',
            color: '#94a3b8',
            marginTop: '0.5rem'
          }}>{redemption.formula}</div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem'
        }}>
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
            }}>💰 Capital Return</div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'white',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>{redemption.capitalComponentFormatted}</div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)',
              lineHeight: '1.4'
            }}>
              {knockInBreached ? '1:1 with underlying' : 'Bonus floor protected'}
            </div>
          </div>

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
            }}>📈 Bonus / Upside</div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: redemption.bonusOrUpside >= 0 ? '#a7f3d0' : '#fecaca',
              marginBottom: '0.5rem',
              fontFamily: 'monospace'
            }}>{redemption.bonusOrUpsideFormatted}</div>
            <div style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.75)'
            }}>
              {knockInBreached
                ? 'Same as performance (no floor)'
                : `${params.participationRateFormatted} × basket${params.capEnabled ? ', capped' : ''}`}
            </div>
          </div>
        </div>
      </div>

      {/* Basket analysis (counts) */}
      {basketAnalysis && underlyings.length > 1 && (
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
            🧮 Basket Knock-In Analysis
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
              }}>{basketAnalysis.criticalDistanceFormatted}</div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>Critical Distance</div>
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
              }}>{basketAnalysis.safeCount}</div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}>Above KI</div>
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
                }}>{basketAnalysis.nearCount}</div>
                <div style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>Near KI</div>
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
                }}>{basketAnalysis.breachedCount}</div>
                <div style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase'
                }}>At/Below KI</div>
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
          }}>📈 Performance Evolution</h4>
          <StructuredProductChart productId={productId} height="450px" />
        </div>
      )}

      {/* Latest News */}
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
          }}>📰 Latest News</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {underlyings.map((u, i) => (
              <UnderlyingNews key={i} ticker={u.ticker} />
            ))}
          </div>
        </div>
      )}

      {/* Parameters Summary Footer */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '1.5rem'
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Strike Level
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {params.strikeLevelFormatted}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Knock-In Threshold
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {params.barrierLevelFormatted} ({params.barrierTypeLabel})
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Participation
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {params.participationRateFormatted}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Cap
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {params.capFormatted}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Max Redemption
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {params.maxRedemptionFormatted}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BonusCertificateReport;
