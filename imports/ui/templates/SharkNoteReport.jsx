import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';
import { getTranslation } from '../../utils/reportTranslations';

/**
 * Shark Note Report Component
 *
 * Displays evaluation results for Shark Note structured products.
 * All data is pre-calculated in the evaluator - this component only displays.
 * Supports multiple languages (EN/FR) via URL parameter.
 *
 * NO CALCULATIONS PERFORMED IN THIS COMPONENT.
 */
const SharkNoteReport = ({ results, productId, product }) => {
  // Get language from URL params
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const lang = urlParams?.get('lang') || 'en';
  const tr = getTranslation(lang);
  if (!results) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        No report data available
      </div>
    );
  }

  const sharkParams = results.sharkStructure || {};
  const status = results.currentStatus || {};
  const underlyings = results.underlyings || [];
  const barrierTouch = results.barrierTouch || {};
  const basketPerformance = results.basketPerformance || {};
  const redemption = results.redemption || {};

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
        🦈 {lang === 'fr' ? 'Résultats d\'Évaluation Shark Note' : 'Shark Note Evaluation Results'}
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
                    gridTemplateColumns: '2fr 1fr 1fr 1.2fr',
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
                  </div>

                  {/* Table Rows */}
                  {underlyings.map((underlying, index) => {
                    const isFinal = index === underlyings.length - 1;

                    return (
                      <div
                        key={underlying.id || index}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '2fr 1fr 1fr 1.2fr',
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
                          {underlying.initialPriceFormatted || '-'}
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
                          fontSize: '1rem',
                          padding: '0.5rem',
                          background: underlying.isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          borderRadius: '6px'
                        }}>
                          {underlying.performanceFormatted || '-'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Basket Performance Summary */}
          {underlyings.length > 1 && basketPerformance.currentFormatted && (
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
                Basket Performance ({sharkParams.referencePerformanceLabel}):
              </div>
              <div style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: basketPerformance.isPositive ? '#10b981' : '#ef4444',
                fontFamily: 'monospace'
              }}>
                {basketPerformance.currentFormatted}
              </div>
            </div>
          )}
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

      {/* Barrier Touch Status */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        marginTop: '1.5rem',
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
          🎯 {lang === 'fr' ? 'Statut Barrière Supérieure' : 'Upper Barrier Status'}
        </h4>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1.25rem',
          background: barrierTouch.touched
            ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.1) 100%)'
            : 'linear-gradient(135deg, rgba(107, 114, 128, 0.1) 0%, rgba(75, 85, 99, 0.05) 100%)',
          borderRadius: '8px',
          border: barrierTouch.touched
            ? '2px solid rgba(245, 158, 11, 0.3)'
            : '2px solid rgba(107, 114, 128, 0.2)'
        }}>
          <div>
            <div style={{
              fontSize: '1.1rem',
              fontWeight: '700',
              color: barrierTouch.touched ? '#f59e0b' : 'var(--text-primary)',
              marginBottom: '0.5rem'
            }}>
              {barrierTouch.status}
            </div>
            {barrierTouch.touched && barrierTouch.touchDateFormatted && (
              <div style={{
                fontSize: '0.85rem',
                color: 'var(--text-secondary)'
              }}>
                Touched on <strong>{barrierTouch.touchDateFormatted}</strong>
                {barrierTouch.basketLevelAtTouchFormatted && (
                  <span> at <strong>{barrierTouch.basketLevelAtTouchFormatted}</strong></span>
                )}
              </div>
            )}
          </div>
          <div>
            {barrierTouch.touched ? (
              <span style={{
                padding: '10px 20px',
                borderRadius: '12px',
                fontSize: '0.85rem',
                fontWeight: '700',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'white',
                boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
                letterSpacing: '0.5px'
              }}>
                ✓ TOUCHED
              </span>
            ) : (
              <span style={{
                padding: '10px 20px',
                borderRadius: '12px',
                fontSize: '0.85rem',
                fontWeight: '600',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-muted)',
                border: '1px solid rgba(148, 163, 184, 0.2)'
              }}>
                Not Touched
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Redemption Calculation */}
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
          💰 Redemption Calculation
        </h4>

        <div style={{
          padding: '1.5rem',
          background: 'var(--bg-primary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            marginBottom: '0.5rem',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}>
            Formula:
          </div>
          <div style={{
            fontSize: '0.95rem',
            fontFamily: 'monospace',
            color: 'var(--text-secondary)',
            marginBottom: '1.5rem',
            padding: '0.75rem',
            background: 'var(--bg-secondary)',
            borderRadius: '6px'
          }}>
            {redemption.formula || 'N/A'}
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem',
            background: redemption.type === 'barrier_touched'
              ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(217, 119, 6, 0.05) 100%)'
              : 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%)',
            borderRadius: '8px',
            border: redemption.type === 'barrier_touched'
              ? '2px solid rgba(245, 158, 11, 0.2)'
              : '2px solid rgba(16, 185, 129, 0.2)'
          }}>
            <div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginBottom: '0.25rem',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                Redemption Value
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                fontStyle: 'italic'
              }}>
                {redemption.type === 'barrier_touched'
                  ? '✅ Fixed rebate applied'
                  : '📊 Performance-based with floor'}
              </div>
            </div>
            <div style={{
              fontSize: '2.5rem',
              fontWeight: '700',
              color: redemption.type === 'barrier_touched' ? '#f59e0b' : '#10b981',
              fontFamily: 'monospace'
            }}>
              {redemption.valueFormatted || 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* Shark Note Parameters Summary */}
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
            Upper Barrier (Knock-Out)
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#f59e0b' }}>
            {sharkParams.upperBarrierFormatted || 'N/A'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Fixed Rebate Value
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#10b981' }}>
            {sharkParams.rebateValueFormatted || 'N/A'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Floor Level (Protection)
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#ef4444' }}>
            {sharkParams.floorLevelFormatted || 'N/A'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Reference Performance
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)', textTransform: 'capitalize' }}>
            {sharkParams.referencePerformanceLabel || 'N/A'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SharkNoteReport;
