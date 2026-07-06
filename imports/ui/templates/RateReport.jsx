import React from 'react';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import CopyableISIN from '../components/CopyableISIN.jsx';

/**
 * Rate Report Component (CMS Steepener / Target-Redemption certificate)
 *
 * Pure display — every value is pre-formatted by the evaluator (zero calculations).
 * Sections: structure summary · reference rates · coupon schedule table
 * (fixed coupons computed, floating shown as "pending fixing") · target progress ·
 * redemption · coupon-accumulation chart · timeline.
 */
const RateReport = ({ results, productId }) => {
  const s = results.rateStructure || {};
  const status = results.currentStatus || {};
  const schedule = results.schedule || {};
  const periods = schedule.periods || [];
  const target = results.targetRedemption || {};
  const redemption = results.redemption || {};
  const referenceRates = results.referenceRates || [];
  const timeline = results.timeline || {};

  const statusColor = status.productStatus === 'redeemed' ? '#f59e0b'
    : status.productStatus === 'matured' ? '#6b7280' : '#10b981';

  const statusBg = (st) => {
    switch (st) {
      case 'paid': return { bg: 'rgba(16, 185, 129, 0.12)', color: '#10b981', label: 'Paid' };
      case 'upcoming': return { bg: 'var(--bg-tertiary)', color: 'var(--text-muted)', label: 'Upcoming' };
      case 'pending_fixing': return { bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', label: 'Pending fixing' };
      case 'redeemed': return { bg: 'rgba(245, 158, 11, 0.18)', color: '#b45309', label: 'Redeemed' };
      case 'cancelled': return { bg: 'var(--bg-tertiary)', color: 'var(--text-muted)', label: 'Cancelled' };
      default: return { bg: 'var(--bg-tertiary)', color: 'var(--text-muted)', label: st };
    }
  };

  const cardBase = { background: 'rgba(255, 255, 255, 0.15)', padding: '1.25rem', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.2)' };
  const cardLabel = { fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.85)', textTransform: 'uppercase', marginBottom: '0.75rem', fontWeight: '700', letterSpacing: '0.5px' };
  const cardValue = { fontSize: '1.6rem', fontWeight: '700', color: 'white', marginBottom: '0.5rem', fontFamily: 'monospace' };
  const cardHint = { fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.75)', lineHeight: '1.4' };

  const th = { textAlign: 'left', padding: '0.6rem 0.75rem', fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--border-color)' };
  const thR = { ...th, textAlign: 'right' };
  const td = { padding: '0.55rem 0.75rem', fontSize: '0.82rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' };
  const tdR = { ...td, textAlign: 'right', fontFamily: 'monospace' };

  return (
    <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
      <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        📈 Rate / CMS Steepener Evaluation Results
        <span style={{ fontSize: '0.7rem', background: statusColor, color: 'white', padding: '3px 8px', borderRadius: '4px', fontWeight: '600' }}>
          {(status.productStatus || 'live').toUpperCase()}
        </span>
      </div>

      {/* Structure Summary */}
      <div style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)', padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem', border: '2px solid #38bdf8', boxShadow: '0 8px 24px rgba(14, 165, 233, 0.3)' }}>
        <h4 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: 'white', fontWeight: '700' }}>📋 Product Structure</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          <div style={cardBase}>
            <div style={cardLabel}>🛡️ Capital Protection</div>
            <div style={cardValue}>{s.capitalProtectionFormatted}</div>
            <div style={cardHint}>Returned at maturity</div>
          </div>
          <div style={cardBase}>
            <div style={cardLabel}>🎯 Target Coupon</div>
            <div style={cardValue}>{s.targetCouponFormatted}</div>
            <div style={cardHint}>{s.targetEnabled ? 'Auto-redeems when cumulative reaches target' : 'No target redemption'}</div>
          </div>
          <div style={cardBase}>
            <div style={cardLabel}>💵 Fixed Coupon</div>
            <div style={cardValue}>{s.fixedCouponRateFormatted}</div>
            <div style={cardHint}>First {s.fixedPeriods} periods ({s.couponFrequencyLabel})</div>
          </div>
          <div style={cardBase}>
            <div style={cardLabel}>📐 Floating Coupon</div>
            <div style={{ ...cardValue, fontSize: '0.95rem', lineHeight: '1.3' }}>{s.floatingFormulaLabel}</div>
            <div style={cardHint}>Subsequent periods</div>
          </div>
        </div>
        {referenceRates.length > 0 && (
          <div style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'rgba(255,255,255,0.9)' }}>
            Reference rates: <strong>{referenceRates.map(r => r.name).join('  •  ')}</strong>
          </div>
        )}
      </div>

      {/* Target Progress */}
      {s.targetEnabled && (
        <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '6px', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--text-primary)' }}>🎯 Target Redemption Progress</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
            <div style={{ flex: 1, height: '14px', background: 'var(--bg-tertiary)', borderRadius: '7px', overflow: 'hidden' }}>
              <div style={{ width: `${schedule.targetProgressPct || 0}%`, height: '100%', background: target.reached ? '#f59e0b' : '#10b981', borderRadius: '7px' }} />
            </div>
            <div style={{ fontFamily: 'monospace', fontWeight: '700', color: 'var(--text-primary)' }}>
              {schedule.knownCumulativeFormatted} / {s.targetCouponFormatted}
            </div>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {target.statusLabel}
            {target.reached && target.redemptionDateFormatted && ` on ${target.redemptionDateFormatted}`}
            {schedule.anyPending && !target.reached && ' — floating coupons pending fixing (cumulative shown is from known coupons only).'}
          </div>
        </div>
      )}

      {/* Coupon Schedule */}
      <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '6px', marginBottom: '1.5rem' }}>
        <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--text-primary)' }}>🗓️ Coupon Schedule</h4>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>Observation</th>
                <th style={th}>Payment</th>
                <th style={th}>Type</th>
                <th style={thR}>Rate p.a.</th>
                <th style={thR}>Coupon</th>
                <th style={thR}>Cumulative</th>
                <th style={{ ...th, textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const st = statusBg(p.status);
                return (
                  <tr key={p.periodIndex}>
                    <td style={td}>{p.periodIndex}</td>
                    <td style={td}>{p.observationDateFormatted || '—'}</td>
                    <td style={td}>{p.paymentDateFormatted || '—'}</td>
                    <td style={td}>
                      <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: p.couponType === 'fixed' ? 'rgba(59,130,246,0.15)' : 'rgba(139,92,246,0.15)', color: p.couponType === 'fixed' ? '#3b82f6' : '#8b5cf6', fontWeight: 600 }}>
                        {p.couponType === 'fixed' ? 'Fixed' : 'Floating'}
                      </span>
                    </td>
                    <td style={tdR}>{p.annualRatePaFormatted}</td>
                    <td style={tdR}>{p.periodCouponFormatted}</td>
                    <td style={{ ...tdR, fontWeight: 700 }}>{p.cumulativeCouponFormatted}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '10px', background: st.bg, color: st.color, fontWeight: 600 }}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Redemption */}
      <div style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem', border: '2px solid #34d399', boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)' }}>
        <h4 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: 'white', fontWeight: '700' }}>💰 Redemption</h4>
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '1px', marginBottom: '0.75rem' }}>
            {target.reached ? 'Redemption Value' : 'Value (capital + known coupons)'}
          </div>
          <div style={{ fontSize: '2.6rem', fontWeight: '800', color: '#10b981', fontFamily: 'monospace', lineHeight: '1' }}>{redemption.totalValueFormatted}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>{redemption.formula}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div style={cardBase}>
            <div style={cardLabel}>💰 Capital Return</div>
            <div style={cardValue}>{redemption.capitalComponentFormatted}</div>
            <div style={cardHint}>Capital protected</div>
          </div>
          <div style={cardBase}>
            <div style={cardLabel}>💵 Coupons {target.reached ? '' : '(known)'}</div>
            <div style={cardValue}>{redemption.couponComponentFormatted}</div>
            <div style={cardHint}>{schedule.anyPending && !target.reached ? 'Floating coupons pending' : 'Total coupons'}</div>
          </div>
        </div>
      </div>

      {/* Coupon Accumulation Chart */}
      {productId && (
        <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '6px', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', color: 'var(--text-primary)' }}>📈 Coupon Accumulation</h4>
          <StructuredProductChart productId={productId} height="420px" />
        </div>
      )}

      {/* Footer / parameters */}
      <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '6px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1.5rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>ISIN</div>
          <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
            {results.productDetails?.isin && results.productDetails.isin !== 'N/A'
              ? <CopyableISIN isin={results.productDetails.isin} />
              : 'N/A'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Frequency</div>
          <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>{s.couponFrequencyLabel}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Maturity</div>
          <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>{timeline.maturityDateFormatted}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Status</div>
          <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>{status.daysToMaturityText}</div>
        </div>
      </div>
    </div>
  );
};

export default RateReport;
