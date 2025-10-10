import React, { useState, useEffect } from 'react';

/**
 * BasketComparisonView - Widget for comparing multiple baskets and their differential
 */
export const BasketComparisonView = ({ product, evaluationResults, report }) => {
  const [baskets, setBaskets] = useState([]);
  const [differential, setDifferential] = useState(null);

  useEffect(() => {
    if (!product?.payoffStructure) return;

    const extractedBaskets = [];
    
    // Extract named baskets from payoff structure
    product.payoffStructure.forEach(component => {
      if ((component.type === 'basket' || (component.type === 'underlying' && component.isBasket)) &&
          component.label && !component.label.toLowerCase().includes('basket')) {
        
        const basketData = {
          name: component.label,
          securities: component.selectedSecurities || [],
          performance: 0,
          weights: {}
        };

        // Calculate basket performance
        if (basketData.securities.length > 0) {
          let totalPerformance = 0;
          basketData.securities.forEach(security => {
            const weight = parseFloat(security.weight) || (100 / basketData.securities.length);
            basketData.weights[security.symbol] = weight;
            
            // Get performance from report if available
            const assetData = report?.underlyings?.assets?.find(
              a => a.ticker === security.symbol
            );
            
            if (assetData?.performance?.return) {
              totalPerformance += (assetData.performance.return * weight / 100);
            }
          });
          basketData.performance = totalPerformance;
        }

        extractedBaskets.push(basketData);
      }
    });

    setBaskets(extractedBaskets);

    // Calculate differential if we have 2 baskets
    if (extractedBaskets.length >= 2) {
      const diff = extractedBaskets[0].performance - extractedBaskets[1].performance;
      setDifferential(diff);
    }
  }, [product, report]);

  const getPerformanceColor = (performance) => {
    if (performance > 0) return '#10b981';
    if (performance < 0) return '#ef4444';
    return '#9ca3af';
  };

  const getPerformanceIcon = (performance) => {
    if (performance > 0) return '📈';
    if (performance < 0) return '📉';
    return '➡️';
  };

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.05)',
      borderRadius: '12px',
      padding: '1.5rem',
      border: '1px solid rgba(255, 255, 255, 0.1)'
    }}>
      <h3 style={{
        margin: '0 0 1.5rem 0',
        fontSize: '1.125rem',
        fontWeight: '600',
        color: '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        ⚖️ Basket Comparison
      </h3>

      {/* Baskets Display */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {baskets.map((basket, index) => (
          <div key={index} style={{
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            padding: '1rem',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.75rem'
            }}>
              <h4 style={{
                margin: 0,
                fontSize: '1rem',
                fontWeight: '600',
                color: '#60a5fa'
              }}>
                {basket.name}
              </h4>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span>{getPerformanceIcon(basket.performance)}</span>
                <span style={{
                  fontSize: '1.125rem',
                  fontWeight: '600',
                  color: getPerformanceColor(basket.performance)
                }}>
                  {basket.performance.toFixed(2)}%
                </span>
              </div>
            </div>

            {/* Securities in basket */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: '0.5rem',
              fontSize: '0.75rem',
              color: 'rgba(255, 255, 255, 0.6)'
            }}>
              <div style={{ fontWeight: '500' }}>Security</div>
              <div style={{ fontWeight: '500', textAlign: 'right' }}>Weight</div>
              <div style={{ fontWeight: '500', textAlign: 'right' }}>Contrib.</div>
              
              {basket.securities.map((security, secIndex) => {
                const weight = basket.weights[security.symbol] || 0;
                const assetData = report?.underlyings?.assets?.find(
                  a => a.ticker === security.symbol
                );
                const performance = assetData?.performance?.return || 0;
                const contribution = (performance * weight / 100);
                
                return (
                  <React.Fragment key={secIndex}>
                    <div>{security.symbol}</div>
                    <div style={{ textAlign: 'right' }}>{weight.toFixed(1)}%</div>
                    <div style={{ 
                      textAlign: 'right',
                      color: getPerformanceColor(contribution)
                    }}>
                      {contribution.toFixed(2)}%
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Differential Display */}
      {differential !== null && baskets.length >= 2 && (
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '8px'
        }}>
          <div style={{
            fontSize: '0.875rem',
            color: 'rgba(255, 255, 255, 0.6)',
            marginBottom: '0.5rem',
            textAlign: 'center'
          }}>
            Differential ({baskets[0].name} - {baskets[1].name})
          </div>
          <div style={{
            fontSize: '1.5rem',
            fontWeight: '700',
            color: getPerformanceColor(differential),
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem'
          }}>
            <span>{getPerformanceIcon(differential)}</span>
            <span>{differential > 0 ? '+' : ''}{differential.toFixed(2)}%</span>
          </div>
        </div>
      )}

      {/* Visualization */}
      {baskets.length >= 2 && (
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: '8px'
        }}>
          <div style={{ 
            position: 'relative', 
            height: '120px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around'
          }}>
            {baskets.slice(0, 2).map((basket, index) => {
              const height = Math.abs(basket.performance) * 2;
              const isPositive = basket.performance >= 0;
              
              return (
                <div key={index} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <div style={{
                    width: '80px',
                    height: `${Math.min(height, 100)}px`,
                    background: isPositive 
                      ? 'linear-gradient(180deg, #10b981 0%, #059669 100%)'
                      : 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    transform: isPositive ? 'translateY(0)' : `translateY(${100 - height}px)`
                  }}>
                    {basket.performance.toFixed(1)}%
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'rgba(255, 255, 255, 0.7)',
                    textAlign: 'center',
                    maxWidth: '80px'
                  }}>
                    {basket.name}
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Zero line */}
          <div style={{
            position: 'absolute',
            left: '10%',
            right: '10%',
            top: '50%',
            height: '1px',
            background: 'rgba(255, 255, 255, 0.2)',
            zIndex: 0
          }} />
        </div>
      )}

      {/* Info Note */}
      <div style={{
        marginTop: '1rem',
        padding: '0.75rem',
        background: 'rgba(251, 191, 36, 0.1)',
        border: '1px solid rgba(251, 191, 36, 0.3)',
        borderRadius: '6px',
        fontSize: '0.75rem',
        color: 'rgba(255, 255, 255, 0.7)'
      }}>
        💡 This widget compares the performance of named baskets in your payoff structure. 
        The differential shows the performance difference between baskets.
      </div>
    </div>
  );
};

export default BasketComparisonView;