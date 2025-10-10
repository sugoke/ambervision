import React from 'react';

export const PayoffDiagramCard = ({ report, product, characteristics }) => {
  const payoffData = report.payoffAnalysis || {};
  
  // Extract key payoff points
  const keyPoints = [];
  
  // Protection level
  if (characteristics.hasCapitalProtection) {
    keyPoints.push({
      label: 'Capital Protection',
      value: '100%',
      color: '#10b981'
    });
  }
  
  // Barrier levels
  if (characteristics.hasBarrier) {
    keyPoints.push({
      label: 'Barrier Level',
      value: `${payoffData.barrierLevel || 'N/A'}%`,
      color: '#ef4444'
    });
  }
  
  // Participation rate
  if (characteristics.hasUpside) {
    keyPoints.push({
      label: 'Participation',
      value: `${payoffData.participationRate || 100}%`,
      color: '#3b82f6'
    });
  }


  return (
    <div className="glass-container glass-container--blue"
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
          Payoff Structure
        </h3>
        <p style={{
          margin: '0 0 1rem 0',
          fontSize: '0.875rem',
          color: '#e5e7eb',
          fontWeight: '500',
          opacity: 0.9,
          textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)'
        }}>
          Expected payoff visualization
        </p>


        {/* Key Payoff Points */}
        {keyPoints.length > 0 && (
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
              Key Features
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {keyPoints.map((point, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.5rem',
                  background: 'rgba(59, 130, 246, 0.2)',
                  borderRadius: '8px',
                  border: '1px solid rgba(59, 130, 246, 0.3)'
                }}>
                  <span style={{
                    fontSize: '0.875rem',
                    color: '#dbeafe',
                    fontWeight: '600'
                  }}>
                    {point.label}
                  </span>
                  <span style={{
                    fontSize: '1rem',
                    fontWeight: '700',
                    color: point.color
                  }}>
                    {point.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Product Type Indicators */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginTop: '1rem'
        }}>
          {characteristics.isReverseConvertible && (
            <span style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: '600',
              background: 'rgba(59, 130, 246, 0.2)',
              color: '#93c5fd',
              border: '1px solid rgba(59, 130, 246, 0.3)'
            }}>
              Reverse Convertible
            </span>
          )}
          {characteristics.hasPhoenixFeature && (
            <span style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: '600',
              background: 'rgba(168, 85, 247, 0.2)',
              color: '#c4b5fd',
              border: '1px solid rgba(168, 85, 247, 0.3)'
            }}>
              Phoenix
            </span>
          )}
          {characteristics.hasDigitalPayoff && (
            <span style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: '600',
              background: 'rgba(236, 72, 153, 0.2)',
              color: '#fbcfe8',
              border: '1px solid rgba(236, 72, 153, 0.3)'
            }}>
              Digital
            </span>
          )}
        </div>

      </div>
    </div>
  );
};