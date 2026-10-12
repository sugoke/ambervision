import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';
import CopyableISIN from '../components/CopyableISIN.jsx';
import PriceSparkline from '../components/PriceSparkline.jsx';
import { ReportSection } from '../components/ReportTabs.jsx';

/**
 * Athena Report Component
 *
 * Pure display: every value comes pre-formatted from AthenaEvaluator (zero calculations).
 *   - Structure (issue price, autocall, coupon per period, final barrier, capital at risk)
 *   - Redemption: actual (autocalled / matured) or indicative at today's worst-of,
 *     on notional and on the issue price
 *   - Next observation outlook
 *   - Underlyings
 *   - Schedule: autocall level and redemption amount per date
 *   - Final payoff tiers, the applicable one highlighted
 */
const STATUS_LABEL = {
  live: { text: 'Live', color: '#3b82f6' },
  autocalled: { text: 'Autocalled', color: '#f59e0b' },
  matured: { text: 'Matured', color: '#6366f1' }
};

const OUTCOME_LABEL = {
  autocalled: { text: 'Autocalled', color: 'var(--gain-color)' },
  matured: { text: 'Redeemed', color: '#6366f1' },
  not_called: { text: 'Below autocall', color: 'var(--text-secondary)' },
  not_callable: { text: 'Not callable', color: 'var(--text-muted)' },
  missing_data: { text: 'Price missing', color: 'var(--warning-color)' },
  upcoming: { text: 'Upcoming', color: 'var(--text-muted)' }
};

const AthenaReport = ({ results, productId }) => {
  const params = results.athenaStructure || {};
  const underlyings = results.underlyings || [];
  const status = results.currentStatus || {};
  const iv = results.indicativeMaturityValue || {};
  const oa = results.observationAnalysis || {};
  const observations = oa.observations || [];
  const prediction = oa.nextObservationPrediction;
  const basket = results.basketAnalysis || {};
  const statusInfo = STATUS_LABEL[status.productStatus] || STATUS_LABEL.live;

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
    fontSize: '1.6rem',
    fontWeight: '700',
    color: 'white',
    marginBottom: '0.5rem',
    fontFamily: 'monospace'
  };
  const cardHint = { fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.75)', lineHeight: '1.4' };
  const panel = { background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '6px', marginBottom: '1.5rem' };
  const panelTitle = { margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' };
  const th = { padding: '10px 12px', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)' };
  const td = { padding: '10px 12px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.85rem' };
  const tile = { background: 'var(--bg-primary)', padding: '0.85rem', borderRadius: '6px', textAlign: 'center' };
  const tileLabel = { fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem', fontWeight: '600', letterSpacing: '0.5px' };

  const redemptionTitle = iv.isAutocalled
    ? 'Redeemed at autocall'
    : iv.isMatured ? 'Final redemption' : 'Indicative redemption if matured today';

  return (
    <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        🦉 Athena Evaluation Results
        <span style={{ fontSize: '0.7rem', background: statusInfo.color, color: 'white', padding: '3px 8px', borderRadius: '4px', fontWeight: '600' }}>
          {statusInfo.text}
        </span>
      </div>

      <ReportSection tab="summary">
        <div style={{
          background: 'linear-gradient(135deg, #0f766e 0%, #115e59 100%)',
          padding: '1.5rem',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          border: '2px solid #2dd4bf',
          boxShadow: '0 8px 24px rgba(15, 118, 110, 0.3)'
        }}>
          <h4 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: 'white', fontWeight: '700' }}>📋 Product Structure</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem' }}>
            <div style={cardBase}>
              <div style={cardLabel}>💶 Issue Price</div>
              <div style={cardValue}>{params.issuePriceFormatted}</div>
              <div style={cardHint}>Price paid, % of notional</div>
            </div>
            <div style={cardBase}>
              <div style={cardLabel}>🎯 First Autocall Level</div>
              <div style={cardValue}>{params.autocallBarrierFormatted}</div>
              <div style={cardHint}>Every underlying at or above</div>
            </div>
            <div style={cardBase}>
              <div style={cardLabel}>🧮 Coupon per Period</div>
              <div style={cardValue}>{params.couponPerPeriodFormatted || 'Per date'}</div>
              <div style={cardHint}>Accrued, paid only at redemption</div>
            </div>
            <div style={cardBase}>
              <div style={cardLabel}>🛡️ Capital at Risk Below</div>
              <div style={cardValue}>{params.capitalAtRiskLevelFormatted}</div>
              <div style={cardHint}>Worst-of at the final observation</div>
            </div>
          </div>
          {params.basketTypeLabel && (
            <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.85)' }}>
              Reference: <strong>{params.basketTypeLabel}</strong> · Final barrier <strong>{params.finalBarrierFormatted}</strong>
            </div>
          )}
        </div>
      </ReportSection>

      <ReportSection tab="summary">
        <div style={{
          background: iv.isLive ? 'linear-gradient(135deg, #334155 0%, #1e293b 100%)' : 'linear-gradient(135deg, var(--gain-color) 0%, #059669 100%)',
          padding: '1.5rem',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          border: '2px solid rgba(255, 255, 255, 0.2)'
        }}>
          <h4 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: 'white', fontWeight: '700' }}>💰 {redemptionTitle}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <div style={cardBase}>
              <div style={cardLabel}>Redemption (% of notional)</div>
              <div style={cardValue}>{iv.redemptionAmountFormatted}</div>
              <div style={cardHint}>Worst-of {iv.worstOfLevelFormatted} of initial</div>
            </div>
            <div style={cardBase}>
              <div style={cardLabel}>Return on Issue Price</div>
              <div style={{ ...cardValue, color: iv.returnIsPositive ? '#a7f3d0' : '#fecaca' }}>{iv.returnOnIssuePriceFormatted}</div>
              <div style={cardHint}>Paid {iv.issuePriceFormatted}</div>
            </div>
            <div style={cardBase}>
              <div style={cardLabel}>Annualised</div>
              <div style={{ ...cardValue, color: iv.returnIsPositive ? '#a7f3d0' : '#fecaca' }}>{iv.annualizedReturnFormatted}</div>
              <div style={cardHint}>From issue to payment date</div>
            </div>
            <div style={cardBase}>
              <div style={cardLabel}>vs Notional</div>
              <div style={{ ...cardValue, color: iv.pnlIsPositive ? '#a7f3d0' : '#fecaca' }}>{iv.pnlFormatted}</div>
              <div style={cardHint}>Redemption − 100%</div>
            </div>
          </div>
          <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.9)', lineHeight: '1.5' }}>
            {iv.capitalExplanation}
          </div>
        </div>
      </ReportSection>

      {prediction && (
        <ReportSection tab="summary">
          <div style={panel}>
            <h4 style={panelTitle}>🔮 Next Observation · {prediction.dateFormatted}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '0.75rem' }}>
              <div style={tile}>
                <div style={tileLabel}>Outcome at today's prices</div>
                <div style={{ fontSize: '1.05rem', fontWeight: '700', color: prediction.autocallWouldTrigger ? 'var(--gain-color)' : 'var(--text-primary)' }}>{prediction.displayText}</div>
              </div>
              <div style={tile}>
                <div style={tileLabel}>Worst-of today</div>
                <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{prediction.currentWorstOfLevelFormatted}</div>
              </div>
              {!prediction.isFinalObservation && (
                <div style={tile}>
                  <div style={tileLabel}>Autocall level</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{prediction.autocallLevelFormatted}</div>
                </div>
              )}
              {prediction.redemptionAmount !== null && (
                <div style={tile}>
                  <div style={tileLabel}>Return on issue price</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                    {prediction.returnOnIssuePriceFormatted} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({prediction.annualizedReturnFormatted} p.a.)</span>
                  </div>
                </div>
              )}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{prediction.explanation}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>{prediction.assumption}</div>
          </div>
        </ReportSection>
      )}

      <ReportSection tab="summary">
        {underlyings.length > 0 && (
          <div style={panel}>
            <h4 style={panelTitle}>
              📊 Underlying Assets
              {basket.criticalDistanceFormatted && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '500' }}>
                  · worst-of distance to {params.capitalAtRiskLevelFormatted}: {basket.criticalDistanceFormatted}
                </span>
              )}
            </h4>
            <div style={{ display: 'grid', gap: '1rem' }}>
              {underlyings.map((u, index) => (
                <div key={u.ticker || index} style={{
                  background: 'var(--bg-tertiary)',
                  padding: '1.25rem',
                  borderRadius: '8px',
                  border: u.isWorstPerforming ? '1px solid var(--loss-color)' : '1px solid var(--border-color)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{u.ticker}</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{u.name}</span>
                    {u.isWorstPerforming && underlyings.length > 1 && (
                      <span style={{ fontSize: '0.65rem', background: 'var(--loss-color)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>WORST-OF</span>
                    )}
                    {u.isin && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}><CopyableISIN isin={u.isin} prefix="ISIN: " /></span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem', alignItems: 'start' }}>
                    <div style={tile}>
                      <div style={tileLabel}>Initial Level</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{u.initialPriceFormatted}</div>
                    </div>
                    <div style={tile}>
                      <div style={tileLabel}>Current Level</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{u.currentPriceFormatted}</div>
                      {u.priceDateFormatted && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>{u.priceDateFormatted}</div>}
                      {u.sparklineData?.hasData && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <PriceSparkline sparklineData={u.sparklineData} ticker={u.ticker} initialPrice={u.initialPrice} currency={u.currency} isPositive={u.isPositive} />
                        </div>
                      )}
                    </div>
                    <div style={{ ...tile, background: u.isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)' }}>
                      <div style={tileLabel}>Performance</div>
                      <div style={{ fontSize: '1.15rem', fontWeight: '700', color: u.isPositive ? 'var(--gain-color)' : 'var(--loss-color)', fontFamily: 'monospace' }}>{u.performanceFormatted}</div>
                    </div>
                    <div style={tile}>
                      <div style={tileLabel}>Distance to {params.capitalAtRiskLevelFormatted}</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{u.distanceToBarrierFormatted}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem', fontWeight: '600' }}>{u.barrierStatusText}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </ReportSection>

      <ReportSection tab="schedule">
        <div style={panel}>
          <h4 style={panelTitle}>📅 Observation Schedule</h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>Observation</th>
                  <th style={th}>Payment</th>
                  <th style={th}>Type</th>
                  <th style={th}>Autocall Level</th>
                  <th style={th}>Redemption</th>
                  <th style={th}>Return on Issue (p.a.)</th>
                  <th style={th}>Worst-of</th>
                  <th style={th}>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {observations.map((obs, i) => {
                  const outcome = OUTCOME_LABEL[obs.outcome] || OUTCOME_LABEL.upcoming;
                  const highlight = obs.autocalled || (obs.isFinal && obs.paysRedemption);
                  return (
                    <tr key={i} style={{ background: highlight ? 'rgba(16, 185, 129, 0.08)' : 'transparent' }}>
                      <td style={td}>{obs.periodNumber}</td>
                      <td style={td}>{obs.observationDateFormatted}</td>
                      <td style={td}>{obs.paymentDateFormatted}</td>
                      <td style={td}>{obs.observationType}</td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>{obs.isCallable ? obs.autocallLevelFormatted : '—'}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: '600' }}>
                        {obs.isCallable || obs.isFinal ? obs.redemptionAmountFormatted : '—'}
                        {obs.finalTierLabel && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '400' }}>{obs.finalTierLabel}</div>}
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>
                        {obs.isCallable || obs.isFinal ? <>{obs.returnOnIssuePriceFormatted} <span style={{ color: 'var(--text-muted)' }}>({obs.annualizedReturnFormatted})</span></> : '—'}
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>{obs.worstOfLevelFormatted || obs.basketLevelFormatted}</td>
                      <td style={{ ...td, color: outcome.color, fontWeight: '600' }}>
                        {outcome.text}
                        {obs.redemptionConfirmed && <span title="Redemption found in bank operations" style={{ marginLeft: '6px', color: 'var(--gain-color)' }}>✓ paid</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            No coupon is paid between dates: the accrued coupon is included in the redemption amount. Final redemption follows the payoff tiers.
          </div>
        </div>
      </ReportSection>

      <ReportSection tab="structure">
        <div style={panel}>
          <h4 style={panelTitle}>🎚️ Final Payoff (worst-of at the final observation)</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
            <thead>
              <tr>
                <th style={th}>Worst-of level</th>
                <th style={th}>Redemption (% of notional)</th>
              </tr>
            </thead>
            <tbody>
              {(params.tiers || []).map((tier, i) => (
                <tr key={i} style={{ background: tier.isActive ? 'rgba(59, 130, 246, 0.12)' : 'transparent' }}>
                  <td style={{ ...td, fontWeight: tier.isActive ? '700' : '500' }}>
                    {tier.rangeLabel}
                    {tier.isActive && <span style={{ marginLeft: '8px', fontSize: '0.7rem', color: '#3b82f6' }}>{iv.isLive ? '◀ today' : '◀ applied'}</span>}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: tier.isActive ? '700' : '500' }}>{tier.formulaLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>ℹ️ How this Athena works</div>
            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
              <li>No coupon is paid during the life of the note; it accrues and is paid with the redemption.</li>
              <li>On each callable date, if every underlying closes at or above its autocall level, the note redeems early at that date's amount (see the schedule).</li>
              <li>Otherwise, at maturity the worst-performing underlying selects the payoff tier above.</li>
              <li>Issued at {params.issuePriceFormatted}: returns are shown on notional and on the price paid.</li>
            </ul>
          </div>
        </div>
      </ReportSection>

      <ReportSection tab="chart">
        {productId && (
          <div style={panel}>
            <h4 style={panelTitle}>📈 Performance Evolution</h4>
            <StructuredProductChart productId={productId} height="450px" />
          </div>
        )}
      </ReportSection>

      <ReportSection tab="news">
        {underlyings.length > 0 && (
          <div style={panel}>
            <h4 style={panelTitle}>📰 Latest News</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {underlyings.map((u, i) => <UnderlyingNews key={i} ticker={u.ticker} />)}
            </div>
          </div>
        )}
      </ReportSection>
    </div>
  );
};

export default AthenaReport;
