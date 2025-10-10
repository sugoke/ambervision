import React from 'react';

export const ProtectionMonitorCard = ({ report, product, characteristics }) => {
  const protectionData = report.protectionAnalysis || {};
  const payoffStructure = product?.payoffStructure || [];
  
  // Extract protection levels from payoff structure
  const protectionLevels = [];
  payoffStructure.forEach(item => {
    if (item.type === 'barrier' || 
        (item.label && (item.label.toLowerCase().includes('barrier') ||
                       item.label.toLowerCase().includes('protection')))) {
      protectionLevels.push({
        level: parseFloat(item.value) || 0,
        label: item.label || 'Protection Level',
        type: characteristics.protectionType || 'standard'
      });
    }
  });

  // Get current underlying level from report
  const currentLevel = report.currentPrices?.average || 100;
  const lowestProtection = protectionLevels.length > 0 ? 
    Math.min(...protectionLevels.map(b => b.level)) : null;
  
  const distanceToProtection = lowestProtection ? 
    ((currentLevel - lowestProtection) / lowestProtection * 100) : null;

  const getDistanceColor = (distance) => {
    if (distance > 20) return '#10b981'; // green - safe
    if (distance > 10) return '#f59e0b'; // amber - caution
    return '#ef4444'; // red - danger
  };

  return (
    <div className="glass-container glass-container--amber"
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
          Protection Monitor
        </h3>
        <p style={{
          margin: '0 0 1rem 0',
          fontSize: '0.875rem',
          color: '#e5e7eb',
          fontWeight: '500',
          opacity: 0.9,
          textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)'
        }}>
          Downside protection tracking
        </p>

        {protectionLevels.length > 0 && (
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
                Active Protection Levels
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {protectionLevels.map((protection, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem',
                    background: 'rgba(245, 158, 11, 0.2)',
                    borderRadius: '8px',
                    border: '1px solid rgba(245, 158, 11, 0.3)'
                  }}>
                    <span style={{
                      fontSize: '0.875rem',
                      color: '#fef3c7',
                      fontWeight: '600'
                    }}>
                      {protection.label}
                    </span>
                    <span style={{
                      fontSize: '1rem',
                      fontWeight: '700',
                      color: 'white'
                    }}>
                      {protection.level}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {distanceToProtection !== null && (
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
                  Distance to Protection
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{
                    fontSize: '2rem',
                    fontWeight: '700',
                    color: getDistanceColor(distanceToProtection),
                    textShadow: '0 2px 4px rgba(0, 0, 0, 0.3)'
                  }}>
                    {distanceToProtection.toFixed(1)}%
                  </div>
                  <div style={{
                    padding: '0.25rem 0.75rem',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    background: `linear-gradient(135deg, ${getDistanceColor(distanceToProtection)} 0%, ${getDistanceColor(distanceToProtection)}dd 100%)`,
                    color: 'white',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.2)'
                  }}>
                    {distanceToProtection > 20 ? 'Safe' : distanceToProtection > 10 ? 'Caution' : 'Danger'}
                  </div>
                </div>
              </div>
            )}

            {/* Visual protection indicator */}
            <div style={{
              marginTop: '1rem',
              height: '40px',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '8px',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Current level indicator */}
              <div style={{
                position: 'absolute',
                left: `${Math.min(95, Math.max(5, currentLevel))}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '8px',
                height: '24px',
                background: 'white',
                borderRadius: '4px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
              }} />
              
              {/* Protection level indicators */}
              {protectionLevels.map((protection, idx) => (
                <div key={idx} style={{
                  position: 'absolute',
                  left: `${protection.level}%`,
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  background: '#ef4444',
                  opacity: 0.8
                }} />
              ))}
            </div>
          </>
        )}

        {characteristics.protectionType && (
          <div style={{
            marginTop: '1rem',
            fontSize: '0.75rem',
            color: '#fef3c7',
            fontWeight: '600',
            textTransform: 'capitalize',
            opacity: 0.9
          }}>
            Protection Type: {characteristics.protectionType}
          </div>
        )}
      </div>
    </div>
  );
};