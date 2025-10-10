import React from 'react';

export const AutocallCard = ({ report, product, characteristics }) => {
  const autocallData = report.autocallAnalysis || {};
  const payoffStructure = product?.payoffStructure || [];
  
  // Extract autocall levels from payoff structure
  const autocallLevels = [];
  const observationDates = product?.observationDates || [];
  
  // Find autocall components in the structure
  payoffStructure.forEach(item => {
    if (item.type === 'autocall' && item.value) {
      autocallLevels.push({
        level: parseFloat(item.value),
        label: item.label || 'Autocall Level'
      });
    }
  });

  // Get autocall probability and next observation
  const nextObservation = observationDates.find(date => new Date(date) > new Date());
  const daysToNext = nextObservation ? 
    Math.ceil((new Date(nextObservation) - new Date()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div className="glass-container glass-container--purple"
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
          Autocall Analysis
        </h3>
        <p style={{
          margin: '0 0 1rem 0',
          fontSize: '0.875rem',
          color: '#e5e7eb',
          fontWeight: '500',
          opacity: 0.9,
          textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)'
        }}>
          Early redemption opportunities
        </p>
        
        {autocallLevels.length > 0 && (
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
              {characteristics.autocallType === 'stepDown' ? 'Step-Down Levels' : 'Autocall Levels'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {autocallLevels.map((level, idx) => (
                <span key={idx} style={{
                  padding: '0.25rem 0.75rem',
                  borderRadius: '12px',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  background: 'linear-gradient(135deg, #a855f7 0%, #a855f7dd 100%)',
                  color: 'white',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}>
                  {level.level}%
                </span>
              ))}
            </div>
          </div>
        )}

        {nextObservation && (
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
              Next Observation
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.5rem'
            }}>
              <span style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: 'var(--lg-text)',
                textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)'
              }}>
                {daysToNext}
              </span>
              <span style={{
                fontSize: '0.875rem',
                color: '#e5e7eb',
                fontWeight: '500',
                opacity: 0.9
              }}>
                days ({new Date(nextObservation).toLocaleDateString()})
              </span>
            </div>
          </div>
        )}

        {autocallData.probability && (
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: 'rgba(168, 85, 247, 0.2)',
            borderRadius: '8px',
            border: '1px solid rgba(168, 85, 247, 0.3)'
          }}>
            <div style={{
              fontSize: '0.875rem',
              color: '#e9d5ff',
              fontWeight: '600'
            }}>
              Autocall Probability: {(autocallData.probability * 100).toFixed(1)}%
            </div>
          </div>
        )}
      </div>
    </div>
  );
};