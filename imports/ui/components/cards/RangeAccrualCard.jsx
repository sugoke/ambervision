import React from 'react';

/**
 * Range Accrual Card - Displays range accrual status and accumulated days
 * Adapts to any range configuration detected in the manifest
 */
export const RangeAccrualCard = ({ report, product, featureManifest }) => {
  // Extract accrual features from manifest
  const accrualFeatures = featureManifest?.accrual || {};
  
  if (!accrualFeatures.hasRangeAccrual) {
    return null; // No range accrual features
  }
  
  // Get current underlying performance
  const underlyingPerformance = report?.performance?.currentPerformance || 0;
  const ranges = accrualFeatures.ranges || [];
  
  // Check if currently in range
  const isInRange = ranges.some(range => 
    underlyingPerformance >= range.min && underlyingPerformance <= range.max
  );
  
  // Calculate accrual statistics from report
  const timeline = report?.timeline || [];
  let daysInRange = 0;
  let totalDays = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  
  timeline.forEach(event => {
    if (event.type === 'accrual' || event.rangeCheck) {
      totalDays++;
      if (event.inRange) {
        daysInRange++;
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    }
  });
  
  // Current streak (for live products)
  if (isInRange) {
    currentStreak = tempStreak;
  }
  
  const accrualPercentage = totalDays > 0 ? (daysInRange / totalDays * 100) : 0;
  
  // Range type label
  const rangeTypeLabel = {
    'single': 'Single Range',
    'dual': 'Dual Range',
    'corridor': 'Corridor Range'
  }[accrualFeatures.rangeType] || 'Range Accrual';
  
  return (
    <div className="glass-container glass-container--orange">
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
            📏 {rangeTypeLabel}
          </h3>
          <span style={{
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: '0.75rem',
            fontWeight: '600',
            background: isInRange ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            color: isInRange ? '#22c55e' : '#ef4444',
            border: `1px solid ${isInRange ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`
          }}>
            {isInRange ? 'IN RANGE' : 'OUT OF RANGE'}
          </span>
        </div>
        
        {/* Range Visualization */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '0.5rem',
            fontSize: '0.875rem'
          }}>
            <span style={{ color: '#9ca3af' }}>Range Boundaries</span>
            <span style={{ 
              color: 'var(--lg-text)',
              fontWeight: '600'
            }}>
              Current: {underlyingPerformance.toFixed(2)}%
            </span>
          </div>
          
          {/* Range Bar */}
          <div style={{
            position: 'relative',
            height: '40px',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            overflow: 'hidden'
          }}>
            {ranges.map((range, index) => (
              <div
                key={index}
                style={{
                  position: 'absolute',
                  left: `${Math.max(0, range.min)}%`,
                  right: `${Math.max(0, 100 - range.max)}%`,
                  top: 0,
                  bottom: 0,
                  background: 'rgba(251, 146, 60, 0.3)',
                  borderLeft: '2px solid #fb923c',
                  borderRight: '2px solid #fb923c'
                }}
              >
                <div style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  fontSize: '0.75rem',
                  color: 'var(--lg-text)',
                  fontWeight: '600'
                }}>
                  {range.min}% - {range.max}%
                </div>
              </div>
            ))}
            
            {/* Current Position Indicator */}
            <div style={{
              position: 'absolute',
              left: `${Math.max(0, Math.min(100, underlyingPerformance))}%`,
              top: '-5px',
              bottom: '-5px',
              width: '3px',
              background: isInRange ? '#22c55e' : '#ef4444',
              boxShadow: `0 0 8px ${isInRange ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)'}`,
              zIndex: 2
            }} />
          </div>
        </div>
        
        {/* Accrual Statistics */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '1rem',
          marginBottom: '1rem'
        }}>
          <div style={{
            padding: '0.75rem',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            textAlign: 'center'
          }}>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: '#fb923c',
              marginBottom: '0.25rem'
            }}>
              {daysInRange}
            </div>
            <div style={{
              fontSize: '0.75rem',
              color: '#9ca3af'
            }}>
              Days In Range
            </div>
          </div>
          
          <div style={{
            padding: '0.75rem',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            textAlign: 'center'
          }}>
            <div style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              color: 'var(--lg-text)',
              marginBottom: '0.25rem'
            }}>
              {totalDays}
            </div>
            <div style={{
              fontSize: '0.75rem',
              color: '#9ca3af'
            }}>
              Total Days
            </div>
          </div>
        </div>
        
        {/* Accrual Percentage Bar */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '0.5rem',
            fontSize: '0.875rem'
          }}>
            <span style={{ color: '#9ca3af' }}>Accrual Rate</span>
            <span style={{ 
              color: '#fb923c',
              fontWeight: '600'
            }}>
              {accrualPercentage.toFixed(1)}%
            </span>
          </div>
          <div style={{
            height: '8px',
            background: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              width: `${accrualPercentage}%`,
              background: 'linear-gradient(90deg, #fb923c, #f97316)',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
        
        {/* Streak Information */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1rem'
        }}>
          {currentStreak > 0 && (
            <div style={{
              padding: '0.75rem',
              background: 'rgba(34, 197, 94, 0.1)',
              borderRadius: '8px',
              border: '1px solid rgba(34, 197, 94, 0.2)'
            }}>
              <div style={{
                fontSize: '0.75rem',
                color: '#9ca3af',
                marginBottom: '0.25rem'
              }}>
                Current Streak
              </div>
              <div style={{
                fontSize: '1.125rem',
                fontWeight: '600',
                color: '#22c55e'
              }}>
                {currentStreak} days
              </div>
            </div>
          )}
          
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
              Longest Streak
            </div>
            <div style={{
              fontSize: '1.125rem',
              fontWeight: '600',
              color: 'var(--lg-text)'
            }}>
              {longestStreak} days
            </div>
          </div>
        </div>
        
        {/* Accrual Type Info */}
        {accrualFeatures.accrualFrequency && (
          <div style={{
            marginTop: '1rem',
            padding: '0.5rem',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '6px',
            fontSize: '0.75rem',
            color: '#9ca3af',
            textAlign: 'center'
          }}>
            {accrualFeatures.accrualFrequency === 'daily' && 'Daily Range Accrual'}
            {accrualFeatures.accrualFrequency === 'period' && 'Period-based Range Accrual'}
            {accrualFeatures.rangeType === 'corridor' && ' - Corridor Range Structure'}
          </div>
        )}
      </div>
    </div>
  );
};