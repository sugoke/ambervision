import React, { useState, useEffect } from 'react';

// Reusable Schedule Module Component
const ScheduleModule = ({ 
  productDetails, 
  onUpdateProductDetails, 
  observationSchedule, 
  setObservationSchedule,
  showObservationDates = true,  // For products with observations during life
  showMaturityOnly = false     // For products with only maturity observation
}) => {
  const [paymentDateInputs, setPaymentDateInputs] = useState({});
  const [delayInputs, setDelayInputs] = useState({});

  // Helper function to add days to a date
  const addDaysToDate = (date, days) => {
    if (!date || isNaN(days)) return '';
    const result = new Date(date);
    result.setDate(result.getDate() + parseInt(days));
    return result.toISOString().split('T')[0];
  };

  // Helper function to format date for display
  const formatDisplayDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Apply delay to observation date
  const applyDelayToDate = (index, delay) => {
    const schedule = [...observationSchedule];
    const observationDate = schedule[index]?.date;
    
    if (observationDate && delay) {
      const paymentDate = addDaysToDate(observationDate, delay);
      schedule[index].paymentDate = paymentDate;
      setObservationSchedule(schedule);
      
      // Clear the delay input after applying
      setDelayInputs(prev => ({
        ...prev,
        [index]: ''
      }));
    }
  };

  // Handle manual payment date change
  const handlePaymentDateChange = (index, value) => {
    const schedule = [...observationSchedule];
    schedule[index].paymentDate = value;
    setObservationSchedule(schedule);
  };

  // Update payment date inputs state
  const handlePaymentDateInputChange = (index, value) => {
    setPaymentDateInputs(prev => ({
      ...prev,
      [index]: value
    }));
  };

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{
          margin: 0,
          fontSize: '1.4rem',
          fontWeight: 700,
          color: 'var(--text-primary)'
        }}>
          {showMaturityOnly ? 'Product Schedule' : 'Observation Schedule'}
        </h2>
        <p style={{
          marginTop: '0.5rem',
          fontSize: '0.95rem',
          color: 'var(--text-secondary)'
        }}>
          {showMaturityOnly 
            ? 'Configure product timeline and payment dates'
            : 'Review observation dates and set payment dates. Final observation determines outcome, maturity is when settlement occurs.'
          }
        </p>
      </div>

      {/* Product Timeline Summary */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '2rem',
        border: '1px solid var(--border-color)'
      }}>
        <h3 style={{ 
          margin: '0 0 1rem 0',
          fontSize: '1.1rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          Product Timeline
        </h3>
        
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem'
        }}>
          <div>
            <label style={{ 
              display: 'block', 
              fontSize: '0.85rem', 
              fontWeight: '500',
              color: 'var(--text-secondary)',
              marginBottom: '0.25rem'
            }}>
              Trade Date
            </label>
            <input
              type="date"
              value={productDetails.tradeDate ? new Date(productDetails.tradeDate).toISOString().split('T')[0] : ''}
              onChange={(e) => onUpdateProductDetails('tradeDate', e.target.value)}
              style={{
                padding: '0.5rem',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                fontSize: '0.9rem',
                width: '100%',
                background: 'var(--bg-primary)'
              }}
            />
          </div>

          <div>
            <label style={{ 
              display: 'block', 
              fontSize: '0.85rem', 
              fontWeight: '500',
              color: 'var(--text-secondary)',
              marginBottom: '0.25rem'
            }}>
              Value Date
            </label>
            <input
              type="date"
              value={productDetails.valueDate ? new Date(productDetails.valueDate).toISOString().split('T')[0] : ''}
              onChange={(e) => onUpdateProductDetails('valueDate', e.target.value)}
              style={{
                padding: '0.5rem',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                fontSize: '0.9rem',
                width: '100%',
                background: 'var(--bg-primary)'
              }}
            />
          </div>

          {!showMaturityOnly && (
            <div>
              <label style={{ 
                display: 'block', 
                fontSize: '0.85rem', 
                fontWeight: '500',
                color: 'var(--text-secondary)',
                marginBottom: '0.25rem'
              }}>
                Final Observation
              </label>
              <input
                type="date"
                value={productDetails.finalObservation ? new Date(productDetails.finalObservation).toISOString().split('T')[0] : ''}
                onChange={(e) => onUpdateProductDetails('finalObservation', e.target.value)}
                style={{
                  padding: '0.5rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  fontSize: '0.9rem',
                  width: '100%',
                  background: 'var(--bg-primary)'
                }}
              />
            </div>
          )}

          <div>
            <label style={{ 
              display: 'block', 
              fontSize: '0.85rem', 
              fontWeight: '500',
              color: 'var(--text-secondary)',
              marginBottom: '0.25rem'
            }}>
              Maturity Date
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="date"
                value={productDetails.maturity ? new Date(productDetails.maturity).toISOString().split('T')[0] : 
                       productDetails.maturityDate ? new Date(productDetails.maturityDate).toISOString().split('T')[0] : ''}
                onChange={(e) => onUpdateProductDetails('maturity', e.target.value)}
                style={{
                  padding: '0.5rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  fontSize: '0.9rem',
                  flex: 1,
                  background: 'var(--bg-primary)'
                }}
              />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                or use delay helper →
              </span>
              <input
                type="text"
                placeholder="+2"
                style={{
                  padding: '0.5rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  fontSize: '0.9rem',
                  width: '60px',
                  textAlign: 'center'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const delay = e.target.value;
                    const finalObsDate = productDetails.finalObservation;
                    if (finalObsDate && delay) {
                      const maturityDate = addDaysToDate(finalObsDate, delay);
                      onUpdateProductDetails('maturity', maturityDate);
                      e.target.value = '';
                    }
                  }
                }}
              />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                (Press Enter)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Observation Schedule Table (for products with observations) */}
      {showObservationDates && observationSchedule && observationSchedule.length > 0 && (
        <div>
          <h3 style={{ 
            margin: '0 0 1rem 0',
            fontSize: '1.1rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Payment Schedule
          </h3>

          <div style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            overflow: 'hidden'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={{
                    padding: '1rem',
                    textAlign: 'left',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border-color)'
                  }}>
                    #
                  </th>
                  <th style={{
                    padding: '1rem',
                    textAlign: 'left',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border-color)'
                  }}>
                    Observation Date
                  </th>
                  <th style={{
                    padding: '1rem',
                    textAlign: 'left',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border-color)'
                  }}>
                    Payment Date
                  </th>
                  <th style={{
                    padding: '1rem',
                    textAlign: 'left',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border-color)'
                  }}>
                    Delay Helper
                  </th>
                </tr>
              </thead>
              <tbody>
                {observationSchedule.map((entry, index) => (
                  <tr key={index} style={{
                    borderBottom: index < observationSchedule.length - 1 ? '1px solid var(--border-color)' : 'none'
                  }}>
                    <td style={{ padding: '1rem', fontSize: '0.9rem' }}>
                      {index + 1}
                    </td>
                    <td style={{ padding: '1rem', fontSize: '0.9rem', fontWeight: '500' }}>
                      {formatDisplayDate(entry.date)}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <input
                        type="date"
                        value={entry.paymentDate || ''}
                        onChange={(e) => handlePaymentDateChange(index, e.target.value)}
                        style={{
                          padding: '0.5rem',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                          width: '140px'
                        }}
                      />
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          type="text"
                          placeholder="+14"
                          value={delayInputs[index] || ''}
                          onChange={(e) => setDelayInputs(prev => ({
                            ...prev,
                            [index]: e.target.value
                          }))}
                          style={{
                            padding: '0.5rem',
                            border: '1px solid var(--border-color)',
                            borderRadius: '4px',
                            fontSize: '0.85rem',
                            width: '60px',
                            textAlign: 'center'
                          }}
                        />
                        <button
                          onClick={() => applyDelayToDate(index, delayInputs[index])}
                          disabled={!delayInputs[index] || !entry.date}
                          style={{
                            padding: '0.5rem 0.75rem',
                            background: 'var(--accent-color)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '0.8rem',
                            cursor: delayInputs[index] && entry.date ? 'pointer' : 'not-allowed',
                            opacity: delayInputs[index] && entry.date ? 1 : 0.5
                          }}
                        >
                          Apply
                        </button>
                      </div>
                      <div style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                        marginTop: '0.25rem'
                      }}>
                        Format: +14 or -7
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Maturity-only products */}
      {showMaturityOnly && (
        <div>
          <h3 style={{ 
            margin: '0 0 1rem 0',
            fontSize: '1.1rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Settlement
          </h3>
          
          <div style={{
            background: 'var(--bg-secondary)',
            padding: '1.5rem',
            borderRadius: '8px',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ 
                display: 'block', 
                fontSize: '0.9rem', 
                fontWeight: '500',
                marginBottom: '0.5rem'
              }}>
                Settlement Date
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="date"
                  value={productDetails.settlementDate || ''}
                  onChange={(e) => onUpdateProductDetails('settlementDate', e.target.value)}
                  style={{
                    padding: '0.75rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    width: '160px'
                  }}
                />
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  or use delay helper →
                </span>
                <input
                  type="text"
                  placeholder="+2"
                  style={{
                    padding: '0.75rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    width: '60px',
                    textAlign: 'center'
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const delay = e.target.value;
                      const maturityDate = productDetails.maturity || productDetails.maturityDate;
                      if (maturityDate && delay) {
                        const settlementDate = addDaysToDate(maturityDate, delay);
                        onUpdateProductDetails('settlementDate', settlementDate);
                        e.target.value = '';
                      }
                    }
                  }}
                />
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  (Press Enter)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Helper Information */}
      <div style={{
        background: 'rgba(59, 130, 246, 0.05)',
        border: '1px solid rgba(59, 130, 246, 0.2)',
        borderRadius: '6px',
        padding: '1rem',
        marginTop: '1.5rem'
      }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
          <strong>💡 Delay Helper Tips:</strong>
        </div>
        <ul style={{ 
          margin: '0.5rem 0 0 0',
          paddingLeft: '1rem',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          lineHeight: '1.4'
        }}>
          <li>Use <code>+14</code> to add 14 days to the observation date</li>
          <li>Use <code>-3</code> to subtract 3 days from the observation date</li>
          <li>Payment dates can also be set manually using the date picker</li>
        </ul>
      </div>
    </div>
  );
};

export default ScheduleModule;