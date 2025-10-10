import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';

/**
 * Himalaya Report Component
 *
 * Displays evaluation results for Himalaya products.
 * Shows selection history, recorded performances, average calculation, and final payout.
 */
const HimalayaReport = ({ results, productId, product }) => {
  const params = results.himalayaStructure || {};
  const status = results.currentStatus || {};
  const features = results.features || {};
  const underlyings = results.underlyings || [];
  const calculation = results.himalayaCalculation || {};
  const selectionHistory = calculation.selectionHistory || [];

  // Format dates from product data
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const tradeDateFormatted = formatDate(product?.tradeDate);
  const paymentDateFormatted = formatDate(product?.paymentDate);
  const finalDateFormatted = formatDate(params?.finalObservation || product?.finalObservation);
  const maturityDateFormatted = formatDate(product?.maturity || product?.maturityDate);

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
        justifyContent: 'space-between',
        gap: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          🏔️ Himalaya Evaluation Results
        </div>
        <div style={{
          display: 'flex',
          gap: '1.5rem',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          fontWeight: '400'
        }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Trade Date:</span>{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
              {tradeDateFormatted}
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Payment Date:</span>{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
              {paymentDateFormatted}
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Final Date:</span>{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
              {finalDateFormatted}
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Maturity:</span>{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
              {maturityDateFormatted}
            </span>
          </div>
        </div>
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
              Average Performance
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: results.finalPerformance >= 0 ? '#10b981' : '#ef4444',
              fontFamily: 'monospace'
            }}>
              {results.finalPerformanceFormatted}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Floored Performance ({params.floor}% floor)
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
              Final Payout
            </div>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: 'var(--text-primary)',
              fontFamily: 'monospace'
            }}>
              {results.finalPayoutFormatted}
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
              ⚠️ Floor applied: Performance below {params.floor}% floor
            </div>
          )}
        </div>
      </div>

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
            📊 Himalaya Performance Summary
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
                    }}>🔢 Obs #</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>📅 Date</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>🏆 Best Performer</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      textAlign: 'right'
                    }}>📍 Initial Level</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      textAlign: 'right'
                    }}>🎯 Final Level</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      textAlign: 'right'
                    }}>📊 Performance</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      textAlign: 'center'
                    }}>✨ Remaining</div>
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
                        background: 'transparent'
                      }}
                    >
                {/* Observation Number */}
                <div style={{
                  textAlign: 'center',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem'
                }}>
                  {selection.observationNumber}
                </div>

                {/* Observation Date */}
                <div style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  fontFamily: 'monospace'
                }}>
                  {selection.observationDate ? new Date(selection.observationDate).toLocaleDateString() : '-'}
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
                  textAlign: 'right',
                  fontFamily: 'monospace',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem'
                }}>
                  {selection.initialLevelFormatted}
                </div>

                {/* Final Level */}
                <div style={{
                  textAlign: 'right',
                  fontFamily: 'monospace',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem'
                }}>
                  {selection.finalLevelFormatted}
                </div>

                {/* Performance */}
                <div style={{
                  textAlign: 'right',
                  fontFamily: 'monospace',
                  fontWeight: '700',
                  color: selection.performance >= 0 ? '#10b981' : '#ef4444',
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
              fontFamily: 'monospace'
            }}>
              ({calculation.recordedPerformances?.map(p => p.toFixed(2)).join(' + ')}) / {calculation.recordedPerformances?.length} = {results.finalPerformanceFormatted}
            </div>
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
