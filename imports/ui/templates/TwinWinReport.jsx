import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';
import CopyableISIN from '../components/CopyableISIN.jsx';
import PriceSparkline from '../components/PriceSparkline.jsx';
import { ReportSection } from '../components/ReportTabs.jsx';

/**
 * Twin Win Report Component
 *
 * Pure display — every value comes pre-formatted from the evaluator (zero calculations).
 * Sections:
 *   - Product Structure (CP, bonus, lower/upper barriers, barrier type)
 *   - Underlyings table (with distance to each barrier)
 *   - Dual Barrier monitoring
 *   - Redemption scenario + the 4-case payoff explanation
 *   - Performance evolution chart
 *
 * Mirrors BonusCertificateReport.jsx styling.
 */
const TwinWinReport = ({ results, productId }) => {
  const params = results.twinWinStructure || {};
  const underlyings = results.underlyings || [];
  const basketPerformance = results.basketPerformance || {};
  const redemption = results.redemption || {};
  const barriers = results.barriers || {};

  const anyTouched = !!barriers.upperTouched || !!barriers.lowerTouched;
  const bothTouched = !!barriers.upperTouched && !!barriers.lowerTouched;

  const cardBase = {
    background: 'rgba(255, 255, 255, 0.15)',
    padding: '1.25rem',
    borderRadius: '6px',
    border: '1px solid rgba(255, 255, 255, 0.2)'
  };
  const cardLabel = {
    fontSize: '0.7rem',
    color: 'rgba(255, 255, 255, 0.85)',
    textTransform: 'uppercase',
    marginBottom: '0.75rem',
    fontWeight: '700',
    letterSpacing: '0.5px'
  };
  const cardValue = {
    fontSize: '1.8rem',
    fontWeight: '700',
    color: 'white',
    marginBottom: '0.5rem',
    fontFamily: 'monospace'
  };
  const cardHint = {
    fontSize: '0.7rem',
    color: 'rgba(255, 255, 255, 0.75)',
    lineHeight: '1.4'
  };

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
        🔁 Twin Win Evaluation Results
      </div>

      <ReportSection tab="summary">
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem'
        }}>
          <div style={cardBase}>
            <div style={cardLabel}>🛡️ Capital Protection</div>
            <div style={cardValue}>{params.capitalProtectionFormatted}</div>
            <div style={cardHint}>Protected at maturity</div>
          </div>

          <div style={cardBase}>
            <div style={cardLabel}>🎯 Bonus Floor</div>
            <div style={cardValue}>{params.bonusFormatted}</div>
            <div style={cardHint}>Guaranteed minimum participation</div>
          </div>

          <div style={cardBase}>
            <div style={cardLabel}>⬇️ Lower Barrier</div>
            <div style={cardValue}>{params.lowerBarrierFormatted}</div>
            <div style={cardHint}>{params.barrierTypeLabel}</div>
          </div>

          <div style={cardBase}>
            <div style={cardLabel}>⬆️ Upper Barrier</div>
            <div style={cardValue}>{params.upperBarrierFormatted}</div>
            <div style={cardHint}>{params.barrierTypeLabel}</div>
          </div>
        </div>

        <div style={{
          marginTop: '1rem',
          fontSize: '0.75rem',
          color: 'rgba(255, 255, 255, 0.85)',
          display: 'flex',
          gap: '1.5rem',
          flexWrap: 'wrap'
        }}>
          <span>Minimum redemption: <strong>{params.minRedemptionFormatted}</strong></span>
          {params.basketTypeLabel && <span>Aggregation: <strong>{params.basketTypeLabel}</strong></span>}
        </div>
      </div>
      </ReportSection>

      <ReportSection tab="summary">
      {/* Underlying Assets Performance */}
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
                border: `1px solid ${underlying.isPositive ? 'var(--gain-color)' : 'var(--loss-color)'}20`
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
                  <div style={{ background: 'var(--bg-primary)', padding: '0.85rem', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem', fontWeight: '600', letterSpacing: '0.5px' }}>Initial Level</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{underlying.initialPriceFormatted}</div>
                  </div>

                  <div style={{ background: 'var(--bg-primary)', padding: '0.85rem', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem', fontWeight: '600', letterSpacing: '0.5px' }}>{underlying.priceLevelLabel || 'Current Level'}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: underlying.hasCurrentData ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {underlying.currentPriceFormatted}
                    </div>
                    {underlying.priceDateFormatted && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.35rem', fontWeight: '500' }}>{underlying.priceDateFormatted}</div>
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
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem', fontWeight: '600', letterSpacing: '0.5px' }}>Performance</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: '700', color: underlying.isPositive ? 'var(--gain-color)' : 'var(--loss-color)', fontFamily: 'monospace' }}>{underlying.performanceFormatted}</div>
                  </div>

                  <div style={{ background: 'var(--bg-primary)', padding: '0.85rem', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem', fontWeight: '600', letterSpacing: '0.5px' }}>To Lower / Upper</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                      {underlying.distanceToLowerFormatted} / {underlying.distanceToUpperFormatted}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem', fontWeight: '600' }}>{underlying.barrierStatusText}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </ReportSection>

      <ReportSection tab="summary">
      {/* Dual Barrier Monitoring */}
      <div style={{
        background: anyTouched
          ? 'linear-gradient(135deg, var(--warning-color) 0%, #d97706 100%)'
          : (barriers.observed
            ? 'linear-gradient(135deg, var(--gain-color) 0%, #059669 100%)'
            : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'),
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        border: '2px solid rgba(255, 255, 255, 0.2)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.1)'
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
          🛡️ Barrier Monitoring
          <span style={{ fontSize: '0.7rem', background: 'rgba(255, 255, 255, 0.25)', color: 'white', padding: '3px 8px', borderRadius: '4px', fontWeight: '500' }}>{barriers.typeLabel}</span>
        </h4>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div style={cardBase}>
            <div style={cardLabel}>⬇️ Lower Barrier ({params.lowerBarrierFormatted})</div>
            <div style={{ ...cardValue, fontSize: '1.4rem' }}>{barriers.lowerStatusLabel}</div>
            {barriers.lowerTouchDateFormatted && (
              <div style={cardHint}>Touched {barriers.lowerTouchDateFormatted}{barriers.breachedTickerLower ? ` by ${barriers.breachedTickerLower}` : ''}</div>
            )}
          </div>

          <div style={cardBase}>
            <div style={cardLabel}>⬆️ Upper Barrier ({params.upperBarrierFormatted})</div>
            <div style={{ ...cardValue, fontSize: '1.4rem' }}>{barriers.upperStatusLabel}</div>
            {barriers.upperTouchDateFormatted && (
              <div style={cardHint}>Touched {barriers.upperTouchDateFormatted}{barriers.breachedTickerUpper ? ` by ${barriers.breachedTickerUpper}` : ''}</div>
            )}
          </div>

          <div style={cardBase}>
            <div style={cardLabel}>Basket Performance</div>
            <div style={cardValue}>{basketPerformance.currentFormatted}</div>
            <div style={cardHint}>{params.basketTypeLabel}</div>
          </div>
        </div>
      </div>
      </ReportSection>

      <ReportSection tab="summary">
      {/* Redemption Calculation */}
      <div style={{
        background: bothTouched
          ? 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'
          : 'linear-gradient(135deg, var(--gain-color) 0%, #059669 100%)',
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
          fontWeight: '700',
          flexWrap: 'wrap'
        }}>
          💰 Redemption Calculation
          <span style={{ fontSize: '0.7rem', background: 'rgba(255, 255, 255, 0.25)', color: 'white', padding: '3px 8px', borderRadius: '4px', fontWeight: '500' }}>{redemption.scenarioLabel}</span>
        </h4>

        <div style={{
          background: 'white',
          padding: '2rem',
          borderRadius: '8px',
          textAlign: 'center',
          marginBottom: '1.5rem',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '1px', marginBottom: '0.75rem' }}>Total Redemption Value</div>
          <div style={{ fontSize: '3rem', fontWeight: '800', color: 'var(--gain-color)', fontFamily: 'monospace', lineHeight: '1' }}>{redemption.totalValueFormatted}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--neutral-color)', marginTop: '0.5rem' }}>{redemption.formula}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div style={cardBase}>
            <div style={cardLabel}>💰 Capital Return</div>
            <div style={cardValue}>{redemption.capitalComponentFormatted}</div>
            <div style={cardHint}>Capital protection level</div>
          </div>
          <div style={cardBase}>
            <div style={cardLabel}>📈 Participation / Bonus</div>
            <div style={{ ...cardValue, color: redemption.participationComponent >= 0 ? '#a7f3d0' : '#fecaca' }}>{redemption.participationComponentFormatted}</div>
            <div style={cardHint}>Floored at the {params.bonusFormatted} bonus</div>
          </div>
        </div>
      </div>
      </ReportSection>

      <ReportSection tab="structure">
      {/* How a Twin Win pays */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        marginBottom: '1.5rem',
        fontSize: '0.85rem',
        color: 'var(--text-secondary)',
        lineHeight: '1.6'
      }}>
        <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
          ℹ️ How a Twin Win Works (capital protection {params.capitalProtectionFormatted}, bonus {params.bonusFormatted}):
        </div>
        <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
          <li><strong>Neither barrier touched:</strong> {params.capitalProtectionFormatted} + max(Bonus, |performance|) — gains whether the underlying rose or fell.</li>
          <li><strong>Upper barrier ({params.upperBarrierFormatted}) touched:</strong> {params.capitalProtectionFormatted} + max(Bonus, −performance) — only the downside-converted gain survives.</li>
          <li><strong>Lower barrier ({params.lowerBarrierFormatted}) touched:</strong> {params.capitalProtectionFormatted} + max(Bonus, performance) — only the upside participation survives.</li>
          <li><strong>Both barriers touched:</strong> {params.capitalProtectionFormatted} + Bonus = {params.minRedemptionFormatted} (the guaranteed minimum).</li>
          <li><strong>{params.barrierTypeLabel}:</strong> {params.barrierType === 'american' ? 'each barrier is monitored continuously (any touch over the life counts)' : 'barriers are checked only at the final fixing'}.</li>
        </ul>
      </div>
      </ReportSection>

      <ReportSection tab="chart">
      {/* Performance Chart */}
      {productId && (
        <div style={{
          background: 'var(--bg-secondary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>📈 Performance Evolution</h4>
          <StructuredProductChart productId={productId} height="450px" />
        </div>
      )}
      </ReportSection>

      <ReportSection tab="news">
      {/* Latest News */}
      {underlyings.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>📰 Latest News</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {underlyings.map((u, i) => (
              <UnderlyingNews key={i} ticker={u.ticker} />
            ))}
          </div>
        </div>
      )}
      </ReportSection>

      <ReportSection tab="structure">
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
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Capital Protection</div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>{params.capitalProtectionFormatted}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Bonus</div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>{params.bonusFormatted}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Barriers</div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>{params.lowerBarrierFormatted} / {params.upperBarrierFormatted}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Observation</div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>{params.barrierTypeLabel}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Min Redemption</div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)' }}>{params.minRedemptionFormatted}</div>
        </div>
      </div>
      </ReportSection>
    </div>
  );
};

export default TwinWinReport;
