import React from 'react';

/**
 * Memory Tracker Card - Displays memory feature status and accumulated periods
 * Works generically based on detected memory features in the manifest
 */
export const MemoryTrackerCard = ({ report, product, featureManifest }) => {
  // Extract memory features from manifest
  const memoryFeatures = featureManifest?.memory || {};
  const paymentFeatures = featureManifest?.payments || {};
  
  if (!memoryFeatures.hasMemory) {
    return null; // No memory features to display
  }
  
  // Get memory status from report
  const timeline = report?.timeline || [];
  const payments = report?.payments || {};
  
  // Calculate accumulated periods
  let accumulatedPeriods = 0;
  let paidPeriods = 0;
  let missedPeriods = 0;
  
  // Analyze timeline for memory events
  timeline.forEach(event => {
    if (event.type === 'observation' && event.couponEligible === false) {
      missedPeriods++;
      accumulatedPeriods++;
    } else if (event.type === 'payment' && event.accumulated) {
      paidPeriods += event.accumulatedPeriods || 1;
      accumulatedPeriods = 0; // Reset after payment
    }
  });
  
  // Memory type display
  const memoryTypeLabel = {
    'coupon': 'Coupon Memory',
    'autocall': 'Autocall Memory',
    'phoenix': 'Phoenix Memory'
  }[memoryFeatures.memoryType] || 'Memory Feature';
  
  // Calculate potential payout
  const couponRate = paymentFeatures.couponRate || 0;
  const potentialPayout = accumulatedPeriods * couponRate;
  
  return (
    <div className="glass-container glass-container--purple">
      <div className="glass-filter" />
      <div className="glass-overlay" />
      <div className="glass-specular" />
      <div className="glass-content">
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '1.5rem' 
        }}>
          <h3 style={{ 
            margin: 0, 
            fontSize: '1.125rem', 
            fontWeight: '700',
            color: 'var(--lg-text)',
            letterSpacing: '-0.01em',
            textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)'
          }}>
            🧠 {memoryTypeLabel}
          </h3>
          {accumulatedPeriods > 0 && (
            <span style={{
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '0.75rem',
              fontWeight: '600',
              background: 'rgba(168, 85, 247, 0.2)',
              color: '#a855f7',
              border: '1px solid rgba(168, 85, 247, 0.4)'
            }}>
              ACTIVE
            </span>
          )}
        </div>
        
        {/* Accumulated Periods Display */}
        <div style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          background: 'rgba(168, 85, 247, 0.1)',
          borderRadius: '12px',
          border: '1px solid rgba(168, 85, 247, 0.2)',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '2.5rem',
            fontWeight: '700',
            color: '#a855f7',
            marginBottom: '0.5rem',
            textShadow: '0 2px 4px rgba(0, 0, 0, 0.3)'
          }}>
            {accumulatedPeriods}
          </div>
          <div style={{
            fontSize: '0.875rem',
            color: '#9ca3af'
          }}>
            Accumulated Period{accumulatedPeriods !== 1 ? 's' : ''}
          </div>
        </div>
        
        {/* Statistics Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1rem',
          marginBottom: '1rem'
        }}>
          <div style={{
            padding: '0.75rem',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{
              fontSize: '0.75rem',
              color: '#9ca3af',
              marginBottom: '0.25rem'
            }}>
              Total Paid
            </div>
            <div style={{
              fontSize: '1.125rem',
              fontWeight: '600',
              color: '#10b981'
            }}>
              {paidPeriods}
            </div>
          </div>
          
          <div style={{
            padding: '0.75rem',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{
              fontSize: '0.75rem',
              color: '#9ca3af',
              marginBottom: '0.25rem'
            }}>
              Total Missed
            </div>
            <div style={{
              fontSize: '1.125rem',
              fontWeight: '600',
              color: '#f59e0b'
            }}>
              {missedPeriods}
            </div>
          </div>
        </div>
        
        {/* Potential Payout */}
        {potentialPayout > 0 && (
          <div style={{
            padding: '1rem',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{
                  fontSize: '0.75rem',
                  color: '#9ca3af',
                  marginBottom: '0.25rem'
                }}>
                  Potential Payout
                </div>
                <div style={{
                  fontSize: '0.875rem',
                  color: '#9ca3af'
                }}>
                  If triggered next observation
                </div>
              </div>
              <div style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                color: '#a855f7'
              }}>
                {potentialPayout.toFixed(2)}%
              </div>
            </div>
          </div>
        )}
        
        {/* Memory Type Features */}
        <div style={{
          marginTop: '1rem',
          padding: '0.5rem',
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: '6px',
          fontSize: '0.75rem',
          color: '#9ca3af',
          textAlign: 'center'
        }}>
          {memoryFeatures.hasPhoenixMemory && 'Phoenix Memory with Step-Down Autocall'}
          {memoryFeatures.hasSnowball && 'Snowball Accumulation Active'}
          {memoryFeatures.memoryType === 'coupon' && 'Missed coupons accumulate for future payment'}
          {memoryFeatures.memoryType === 'autocall' && 'Memory feature on autocall events'}
        </div>
        
        {/* Visual Memory Indicator */}
        <div style={{
          marginTop: '1rem',
          display: 'flex',
          justifyContent: 'center',
          gap: '0.5rem'
        }}>
          {Array.from({ length: Math.min(10, Math.max(accumulatedPeriods, 3)) }).map((_, i) => (
            <div
              key={i}
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: i < accumulatedPeriods ? '#a855f7' : 'rgba(255, 255, 255, 0.1)',
                transition: 'all 0.3s ease'
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};