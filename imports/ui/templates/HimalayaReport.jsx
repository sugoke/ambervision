import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';
import { getTranslation, t } from '../../utils/reportTranslations';

/**
 * Himalaya Report Component
 *
 * Displays evaluation results for Himalaya products.
 * Shows selection history, recorded performances, average calculation, and final payout.
 * Supports multiple languages (EN/FR) via URL parameter.
 */
const HimalayaReport = ({ results, productId, product }) => {
  // Get language from URL params
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const lang = urlParams?.get('lang') || 'en';
  const tr = getTranslation(lang);

  const params = results.himalayaStructure || {};
  const status = results.currentStatus || {};
  const features = results.features || {};
  const underlyings = results.underlyings || [];
  const calculation = results.himalayaCalculation || {};
  const selectionHistory = calculation.selectionHistory || [];

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
        🏔️ {tr.himalayaEvaluationResults}
      </div>

      {/* Final Performance Summary */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        marginBottom: '1.5rem',
        border: '2px solid var(--border-color)'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1.5rem'
        }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              {status.hasMatured ? tr.finalAveragePerformance : tr.currentAveragePerformance}
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: results.averagePerformance >= 0 ? '#10b981' : '#ef4444',
              fontFamily: 'monospace'
            }}>
              {results.averagePerformanceFormatted}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              {status.hasMatured ? tr.finalFlooredPerformance : tr.indicativeFlooredPerformance} ({params.floor}% floor)
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: results.flooredPerformance >= 0 ? '#10b981' : '#ef4444',
              fontFamily: 'monospace'
            }}>
              {results.flooredPerformanceFormatted}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              {status.hasMatured ? tr.finalPayout : tr.indicativePayoutIfMaturedToday}
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: 'var(--text-primary)',
              fontFamily: 'monospace'
            }}>
              {results.totalPayoutFormatted}
            </div>
          </div>

          {calculation.floorApplied && (
            <div style={{
              gridColumn: '1 / -1',
              padding: '0.75rem',
              background: '#f59e0b20',
              border: '1px solid #f59e0b',
              borderRadius: '4px',
              fontSize: '0.85rem',
              color: '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              ⚠️ {t(lang, 'floorApplied', { floor: params.floor })}
            </div>
          )}
        </div>
      </div>

      {/* Indicative Calculation Disclaimer for Live Products */}
      {!status.hasMatured && (
        <div style={{
          background: 'rgba(99, 102, 241, 0.1)',
          padding: '1rem',
          borderRadius: '6px',
          marginBottom: '1.5rem',
          fontSize: '0.85rem',
          color: '#6366f1',
          fontStyle: 'italic',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.5rem'
        }}>
          <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>💡</span>
          <span>
            {tr.indicativeCalculationBasedOnCurrentPrices}
            Actual performance and payout will be determined at final observation on{' '}
            <strong>
              {params.observationDates?.[params.observationDates.length - 1]?.date ?
                new Date(params.observationDates[params.observationDates.length - 1].date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                }) : 'final observation date'
              }
            </strong>.
          </span>
        </div>
      )}

      {/* Combined Performance Table */}
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
            📊 {tr.performanceSummary}
          </h4>

          {/* Table with Gradient Border */}
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
              <div style={{
                overflowX: 'auto',
                overflowY: 'hidden',
                maxWidth: '100%'
              }}>
                <div style={{
                  minWidth: '750px'
                }}>
                  {/* Table Header - Sleek Dark Header */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '0.6fr 1fr 1.8fr 1fr 1fr 1fr 0.8fr',
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
                      letterSpacing: '1px',
                      textAlign: 'center'
                    }}>🔢 {tr.obsNumber}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>📅 {tr.date}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>🏆 {tr.bestPerformer}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      textAlign: 'right'
                    }}>📍 {tr.initialLevel}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      textAlign: 'right'
                    }}>🎯 {status.hasMatured ? tr.finalLevel : tr.observationLevel}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      textAlign: 'right'
                    }}>📊 {tr.performance}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      textAlign: 'center'
                    }}>✨ {tr.remainingUnderlying}</div>
                  </div>

                  {/* Selection History Rows */}
                  {selectionHistory.map((selection, index) => (
                    <div
                      key={`selected-${index}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '0.6fr 1fr 1.8fr 1fr 1fr 1fr 0.8fr',
                        gap: '0.75rem',
                        padding: '1rem 1.5rem',
                        borderBottom: index < selectionHistory.length - 1 ? '1px solid rgba(148, 163, 184, 0.15)' : 'none',
                        alignItems: 'center',
                        background: selection.status === 'frozen' ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
                        borderLeft: selection.status === 'frozen' ? '3px solid #10b981' : '3px solid transparent'
                      }}
                    >
                {/* Observation Number */}
                <div style={{
                  textAlign: 'center',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.25rem'
                }}>
                  {selection.status === 'frozen' && <span style={{ fontSize: '0.85rem' }}>🔒</span>}
                  {selection.observationNumber}
                </div>

                {/* Observation Date */}
                <div style={{
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem'
                }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {selection.observationDate ? new Date(selection.observationDate).toLocaleDateString() : '-'}
                  </span>
                  {selection.status === 'frozen' && (
                    <span style={{
                      fontSize: '0.7rem',
                      color: '#10b981',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      ● Frozen
                    </span>
                  )}
                  {selection.status === 'pending' && (
                    <span style={{
                      fontSize: '0.7rem',
                      color: '#6b7280',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      ○ Pending
                    </span>
                  )}
                </div>

                {/* Selected Underlying */}
                <div>
                  <div style={{
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem'
                  }}>
                    {selection.selectedUnderlying}
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)'
                  }}>
                    {selection.selectedUnderlyingName}
                  </div>
                </div>

                {/* Initial Level */}
                <div style={{
                  textAlign: 'right'
                }}>
                  <div style={{
                    fontFamily: 'monospace',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem'
                  }}>
                    {selection.initialLevelFormatted}
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    marginTop: '0.15rem'
                  }}>
                    {product?.tradeDate ? new Date(product.tradeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Trade date'}
                  </div>
                </div>

                {/* Final Level */}
                <div style={{
                  textAlign: 'right'
                }}>
                  <div style={{
                    fontFamily: 'monospace',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem'
                  }}>
                    {selection.finalLevelFormatted}
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    marginTop: '0.15rem'
                  }}>
                    {selection.status === 'frozen'
                      ? (selection.observationDate ? new Date(selection.observationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Obs date')
                      : 'Today'
                    }
                  </div>
                </div>

                {/* Performance */}
                <div style={{
                  textAlign: 'right',
                  fontFamily: 'monospace',
                  fontWeight: selection.status === 'frozen' ? '900' : '700',
                  color: selection.status === 'frozen'
                    ? (selection.performance >= 0 ? '#10b981' : '#ef4444')
                    : '#9ca3af',
                  fontSize: '0.95rem'
                }}>
                  {selection.performanceFormatted}
                </div>

                      {/* Remaining Underlyings */}
                      <div style={{
                        textAlign: 'center',
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)'
                      }}>
                        {selection.remainingUnderlyings}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Average Calculation */}
          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            background: 'var(--bg-primary)',
            borderRadius: '6px',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              marginBottom: '0.5rem'
            }}>
              Average Calculation:
            </div>
            <div style={{
              fontSize: '0.9rem',
              color: 'var(--text-primary)',
              fontFamily: 'monospace',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.25rem'
            }}>
              <span>(</span>
              {calculation.recordedPerformances?.map((perf, idx) => {
                const isFrozen = selectionHistory[idx]?.status === 'frozen';
                const perfFormatted = (perf >= 0 ? '+' : '') + perf.toFixed(2);
                return (
                  <React.Fragment key={idx}>
                    <span style={{
                      fontWeight: isFrozen ? '700' : '400',
                      color: isFrozen
                        ? (perf >= 0 ? '#10b981' : '#ef4444')
                        : '#9ca3af'
                    }}>
                      {perfFormatted}
                    </span>
                    {idx < calculation.recordedPerformances.length - 1 && <span> + </span>}
                  </React.Fragment>
                );
              })}
              <span>) / {calculation.recordedPerformances?.length} = </span>
              <span style={{ fontWeight: '700', color: results.averagePerformance >= 0 ? '#10b981' : '#ef4444' }}>
                {results.averagePerformanceFormatted}
              </span>
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

      {/* Himalaya Parameters Summary */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1.5rem'
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Floor Level
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {params.floor}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Number of Underlyings
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {underlyings.length}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Observation Dates
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {params.observationDates?.length || 0}
          </div>
        </div>
      </div>

      {/* Performance Chart */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        marginTop: '1.5rem',
        border: '1px solid var(--border-color)'
      }}>
        <StructuredProductChart productId={productId} height="900px" />
      </div>
    </div>
  );
};

export default HimalayaReport;
