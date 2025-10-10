import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';

/**
 * Orion Memory Report Component
 *
 * Displays evaluation results for Orion Memory products.
 * Shows underlying performance with upper barrier cap mechanism,
 * considered performance, and basket calculations.
 */
const OrionReport = ({ results, productId, product }) => {
  const orionParams = results.orionStructure || {};
  const status = results.currentStatus || {};
  const features = results.features || {};
  const underlyings = results.underlyings || [];

  return (
    <div style={{
      marginTop: '1rem',
      padding: '1rem',
      background: 'var(--bg-primary)',
      borderRadius: '6px'
    }}>
      {/* Header */}
      <div style={{
        fontSize: '0.9rem',
        fontWeight: '600',
        color: 'var(--text-primary)',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        ⭐ Orion Memory Evaluation Results
      </div>

      {/* Underlying Assets Performance Table */}
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
                  {/* Table Header */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.2fr',
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
                    }}>🏢 Asset</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>📍 Initial</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>💹 Current</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>📊 Performance</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>✨ Considered</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>🎯 Upper Barrier</div>
                  </div>

                  {/* Table Rows */}
                  {underlyings.map((underlying, index) => {
                    const hitUpperBarrier = underlying.hitUpperBarrier || false;
                    const consideredPerf = underlying.consideredPerformance || 0;
                    const consideredIsPositive = consideredPerf >= 0;
                    const isFinal = index === underlyings.length - 1;

                    return (
                      <div
                        key={underlying.id || index}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.2fr',
                          gap: '0.75rem',
                          padding: '1.25rem 1.5rem',
                          background: index % 2 === 0 ? 'var(--bg-secondary)' : 'rgba(148, 163, 184, 0.03)',
                          borderBottom: !isFinal ? '1px solid rgba(148, 163, 184, 0.1)' : 'none',
                          alignItems: 'center',
                          transition: 'all 0.2s ease',
                          cursor: 'default'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(99, 102, 241, 0.08)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = index % 2 === 0 ? 'var(--bg-secondary)' : 'rgba(148, 163, 184, 0.03)';
                        }}
                      >
                        {/* Asset Name */}
                        <div>
                          <div style={{
                            fontWeight: '700',
                            color: 'var(--text-primary)',
                            fontSize: '0.95rem',
                            marginBottom: '0.25rem'
                          }}>
                            {underlying.ticker}
                          </div>
                          <div style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)'
                          }}>
                            {underlying.name || underlying.ticker}
                          </div>
                        </div>

                        {/* Initial Price */}
                        <div style={{
                          textAlign: 'center',
                          fontFamily: 'monospace',
                          color: 'var(--text-secondary)',
                          fontSize: '0.9rem',
                          fontWeight: '500'
                        }}>
                          {underlying.initialPriceFormatted || underlying.strikeFormatted || '-'}
                        </div>

                        {/* Current Price */}
                        <div style={{
                          textAlign: 'center',
                          fontFamily: 'monospace',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem'
                        }}>
                          {underlying.currentPriceFormatted || '-'}
                        </div>

                        {/* Performance */}
                        <div style={{
                          textAlign: 'center',
                          fontFamily: 'monospace',
                          fontWeight: '700',
                          color: underlying.isPositive ? '#10b981' : '#ef4444',
                          fontSize: '1rem'
                        }}>
                          {underlying.performanceFormatted || '-'}
                        </div>

                        {/* Considered Performance (capped at rebate) */}
                        <div style={{
                          textAlign: 'center',
                          fontFamily: 'monospace',
                          fontWeight: '700',
                          color: consideredIsPositive ? '#10b981' : '#ef4444',
                          fontSize: '1rem',
                          padding: '0.5rem',
                          background: consideredIsPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          borderRadius: '6px'
                        }}>
                          {underlying.consideredPerformanceFormatted || '-'}
                        </div>

                        {/* Upper Barrier Status */}
                        <div style={{
                          textAlign: 'center',
                          display: 'flex',
                          justifyContent: 'center'
                        }}>
                          {hitUpperBarrier ? (
                            <span style={{
                              padding: '6px 12px',
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              fontWeight: '700',
                              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                              color: 'white',
                              boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                              letterSpacing: '0.5px'
                            }}>
                              ✓ HIT
                            </span>
                          ) : (
                            <span style={{
                              padding: '6px 12px',
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              background: 'var(--bg-tertiary)',
                              color: 'var(--text-muted)',
                              border: '1px solid rgba(148, 163, 184, 0.2)'
                            }}>
                              Not Hit
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Basket Considered Performance Summary */}
          {results.basketConsideredPerformanceFormatted && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              background: 'var(--bg-primary)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{
                fontSize: '0.9rem',
                fontWeight: '600',
                color: 'var(--text-secondary)'
              }}>
                Basket Considered Performance:
              </div>
              <div style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: results.basketConsideredPerformance >= 0 ? '#10b981' : '#ef4444',
                fontFamily: 'monospace'
              }}>
                {results.basketConsideredPerformanceFormatted}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      <StructuredProductChart productId={productId} height="900px" />

      {/* Orion Parameters Summary */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1.5rem',
        marginTop: '1.5rem'
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Upper Barrier (Cap)
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {orionParams.upperBarrier}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Rebate Value
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {orionParams.rebate}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Lower Barrier (Protection)
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {orionParams.lowerBarrier || orionParams.capitalGuaranteed}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Observation Frequency
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)', textTransform: 'capitalize' }}>
            {orionParams.observationFrequency}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrionReport;
