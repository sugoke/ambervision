import React from 'react';

export const CouponScheduleCard = ({ report, product, characteristics }) => {
  const couponData = report.couponAnalysis || {};
  const payoffStructure = product?.payoffStructure || [];
  const observationDates = product?.observationDates || [];
  
  // Extract coupon rates from payoff structure
  const couponRates = [];
  payoffStructure.forEach(item => {
    if (item.type === 'coupon' || 
        (item.label && item.label.toLowerCase().includes('coupon'))) {
      const rate = parseFloat(item.value) || 0;
      if (rate > 0) {
        couponRates.push({
          rate: rate,
          label: item.label || 'Coupon',
          isMemory: characteristics.hasMemoryCoupons
        });
      }
    }
  });

  // Calculate total expected coupons
  const annualRate = couponRates.length > 0 ? 
    Math.max(...couponRates.map(c => c.rate)) : 0;
  const frequency = characteristics.couponFrequency || 'quarterly';
  const periodsPerYear = {
    'monthly': 12,
    'quarterly': 4,
    'semi-annual': 2,
    'annual': 1
  }[frequency] || 4;
  
  const couponPerPeriod = annualRate / periodsPerYear;
  const totalPeriods = observationDates.length;
  const potentialTotal = couponPerPeriod * totalPeriods;

  // Count paid and upcoming coupons
  const today = new Date();
  const paidCoupons = observationDates.filter(date => new Date(date) < today).length;
  const upcomingCoupons = observationDates.filter(date => new Date(date) >= today).length;

  return (
    <div className="glass-container glass-container--green"
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 12px 12px rgba(0, 0, 0, 0.3), 0 0 30px rgba(0, 0, 0, 0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 6px 6px rgba(0, 0, 0, 0.2), 0 0 20px rgba(0, 0, 0, 0.1)';
      }}>
      <div className="glass-filter" />
      <div className="glass-overlay" />
      <div className="glass-specular" />
      <div className="glass-content">
        <h3 style={{
          margin: '0 0 0.25rem 0',
          fontSize: '1.125rem',
          fontWeight: '700',
          color: 'var(--lg-text)',
          letterSpacing: '-0.01em',
          textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)'
        }}>
          Coupon Schedule
        </h3>
        <p style={{
          margin: '0 0 1rem 0',
          fontSize: '0.875rem',
          color: '#e5e7eb',
          fontWeight: '500',
          opacity: 0.9,
          textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)'
        }}>
          Income distribution timeline
        </p>

        {couponRates.length > 0 && (
          <>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{
                fontSize: '0.75rem',
                color: '#cccccc',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                opacity: 0.45,
                marginBottom: '0.5rem',
                textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)'
              }}>
                Coupon Rate
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.5rem'
              }}>
                <span style={{
                  fontSize: '2rem',
                  fontWeight: '700',
                  color: '#86efac',
                  textShadow: '0 2px 4px rgba(0, 0, 0, 0.3)'
                }}>
                  {annualRate.toFixed(2)}%
                </span>
                <span style={{
                  fontSize: '0.875rem',
                  color: '#e5e7eb',
                  fontWeight: '500',
                  opacity: 0.9
                }}>
                  p.a. ({frequency})
                </span>
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1rem',
              marginBottom: '1rem'
            }}>
              <div style={{
                padding: '0.75rem',
                background: 'rgba(34, 197, 94, 0.2)',
                borderRadius: '8px',
                border: '1px solid rgba(34, 197, 94, 0.3)'
              }}>
                <div style={{
                  fontSize: '0.75rem',
                  color: '#bbf7d0',
                  fontWeight: '600',
                  marginBottom: '0.25rem'
                }}>
                  Paid
                </div>
                <div style={{
                  fontSize: '1.25rem',
                  fontWeight: '700',
                  color: 'white'
                }}>
                  {paidCoupons}
                </div>
              </div>
              
              <div style={{
                padding: '0.75rem',
                background: 'rgba(34, 197, 94, 0.2)',
                borderRadius: '8px',
                border: '1px solid rgba(34, 197, 94, 0.3)'
              }}>
                <div style={{
                  fontSize: '0.75rem',
                  color: '#bbf7d0',
                  fontWeight: '600',
                  marginBottom: '0.25rem'
                }}>
                  Remaining
                </div>
                <div style={{
                  fontSize: '1.25rem',
                  fontWeight: '700',
                  color: 'white'
                }}>
                  {upcomingCoupons}
                </div>
              </div>
            </div>

            {characteristics.hasMemoryCoupons && (
              <div style={{
                padding: '0.75rem',
                background: 'rgba(34, 197, 94, 0.2)',
                borderRadius: '8px',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                marginBottom: '1rem'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span style={{
                    fontSize: '1rem'
                  }}>💾</span>
                  <span style={{
                    fontSize: '0.875rem',
                    color: '#bbf7d0',
                    fontWeight: '600'
                  }}>
                    Memory Feature Active
                  </span>
                </div>
                <div style={{
                  fontSize: '0.75rem',
                  color: '#e5e7eb',
                  marginTop: '0.25rem',
                  opacity: 0.9
                }}>
                  Missed coupons accumulate for future payment
                </div>
              </div>
            )}

            <div style={{
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              paddingTop: '1rem'
            }}>
              <div style={{
                fontSize: '0.75rem',
                color: '#cccccc',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                opacity: 0.45,
                marginBottom: '0.5rem',
                textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)'
              }}>
                Potential Total Income
              </div>
              <div style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: 'var(--lg-text)',
                textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)'
              }}>
                {potentialTotal.toFixed(2)}%
              </div>
            </div>
          </>
        )}

        {couponData.nextPaymentDate && (
          <div style={{
            marginTop: '1rem',
            fontSize: '0.875rem',
            color: '#bbf7d0',
            fontWeight: '600'
          }}>
            Next Payment: {new Date(couponData.nextPaymentDate).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
};