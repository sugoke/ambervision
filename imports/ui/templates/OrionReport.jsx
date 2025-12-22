import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';
import { getTranslation, t } from '../../utils/reportTranslations';

/**
 * Orion Memory Report Component
 *
 * Displays evaluation results for Orion Memory products.
 * Shows underlying performance with upper barrier cap mechanism,
 * considered performance, and basket calculations.
 * Supports multiple languages (EN/FR) via URL parameter.
 */
const OrionReport = ({ results, productId, product }) => {
  // Get language from URL params
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const lang = urlParams?.get('lang') || 'en';
  const tr = getTranslation(lang);

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
        ⭐ {tr.orionMemoryEvaluationResults}
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
            📊 {tr.underlyingAssetsPerformance}
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
                    }}>🏢 {tr.asset}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>📍 {tr.initialLevel}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>💹 {tr.currentLevel}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>📊 {tr.performance}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>✨ {tr.considered}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>🎯 {tr.upperBarrier}</div>
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
                        {/* Asset Name with Logo */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem'
                        }}>
                          {/* Stock Logo */}
                          <div style={{
                            width: '40px',
                            height: '40px',
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

                          {/* Company Info */}
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
                color: results.indicativeMaturityValue.totalValue >= 100 ? '#10b981' : '#ef4444',
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
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem'
            }}>
              {/* Basket Performance */}
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
                  📈 Basket Performance
                </div>
                <div style={{
                  fontSize: '1.8rem',
                  fontWeight: '700',
                  color: results.indicativeMaturityValue.basketPerformance >= 0 ? '#10b981' : '#ef4444',
                  marginBottom: '0.5rem',
                  fontFamily: 'monospace'
                }}>
                  {results.indicativeMaturityValue.basketPerformanceFormatted}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  lineHeight: '1.4'
                }}>
                  Average of considered performances
                </div>
              </div>

              {/* Worst Performer */}
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
                  📉 Worst Performer
                </div>
                <div style={{
                  fontSize: '1.8rem',
                  fontWeight: '700',
                  color: results.indicativeMaturityValue.worstPerformer >= 0 ? '#10b981' : '#ef4444',
                  marginBottom: '0.5rem',
                  fontFamily: 'monospace'
                }}>
                  {results.indicativeMaturityValue.worstPerformerFormatted}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)'
                }}>
                  Determines protection status
                </div>
              </div>

              {/* Upper Barrier Status */}
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
                  🎯 Upper Barrier Status
                </div>
                <div style={{
                  fontSize: '1.2rem',
                  fontWeight: '700',
                  color: results.indicativeMaturityValue.hitBarrierCount > 0 ? '#10b981' : 'var(--text-muted)',
                  marginBottom: '0.5rem'
                }}>
                  {results.indicativeMaturityValue.hitBarrierCount}/{results.indicativeMaturityValue.totalUnderlyings} Hit
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  lineHeight: '1.4'
                }}>
                  {results.indicativeMaturityValue.barrierStatusText}
                </div>
              </div>
            </div>

            {/* Protection Barrier Info */}
            <div style={{
              marginTop: '1rem',
              padding: '0.85rem 1rem',
              background: results.indicativeMaturityValue.protectionIntact
                ? 'rgba(16, 185, 129, 0.1)'
                : 'rgba(239, 68, 68, 0.1)',
              borderRadius: '6px',
              border: `1px solid ${results.indicativeMaturityValue.protectionIntact
                ? 'rgba(16, 185, 129, 0.3)'
                : 'rgba(239, 68, 68, 0.3)'}`,
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span style={{ fontSize: '1rem' }}>
                {results.indicativeMaturityValue.protectionIntact ? '🛡️' : '⚠️'}
              </span>
              <div>
                <strong>{tr.protectionBarrier}:</strong> {results.indicativeMaturityValue.protectionBarrierFormatted} |
                <strong style={{ marginLeft: '0.5rem' }}>{tr.upperBarrier}:</strong> {results.indicativeMaturityValue.upperBarrierFormatted} |
                <strong style={{ marginLeft: '0.5rem' }}>Rebate:</strong> {results.indicativeMaturityValue.rebateFormatted}
              </div>
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
            {tr.observationFrequency}
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
