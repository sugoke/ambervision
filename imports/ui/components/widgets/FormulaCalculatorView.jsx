import React, { useState, useEffect } from 'react';

/**
 * FormulaCalculatorView - Widget for displaying and calculating mathematical formulas
 * in structured products with complex payoffs
 */
export const FormulaCalculatorView = ({ product, evaluationResults, report }) => {
  const [variables, setVariables] = useState({});
  const [formulaResult, setFormulaResult] = useState(null);
  const [selectedFormula, setSelectedFormula] = useState(null);

  // Extract formulas and variables from payoff structure
  useEffect(() => {
    if (!product?.payoffStructure) return;

    const extractedVars = {};
    const formulas = [];

    product.payoffStructure.forEach(component => {
      if (component.type === 'variable_store') {
        extractedVars[component.value || component.defaultValue] = {
          name: component.value || component.defaultValue,
          value: 0,
          source: component.label
        };
      }
      
      if (component.type === 'formula') {
        formulas.push({
          id: component.id,
          expression: component.value || component.defaultValue,
          label: component.label,
          description: component.description
        });
      }
    });

    // Extract basket values from report if available
    if (report?.underlyings?.assets) {
      report.underlyings.assets.forEach(asset => {
        if (asset.name && !asset.name.includes('Basket')) {
          extractedVars[asset.name] = {
            name: asset.name,
            value: asset.performance?.return || 0,
            source: 'Underlying Asset'
          };
        }
      });
    }

    setVariables(extractedVars);
    if (formulas.length > 0) {
      setSelectedFormula(formulas[0]);
    }
  }, [product, report]);

  const calculateFormula = () => {
    if (!selectedFormula) return;

    try {
      // Create a safe evaluation context with variable values
      const context = {};
      Object.entries(variables).forEach(([name, info]) => {
        context[name] = info.value;
      });

      // Simple formula parser (in production, use a proper expression parser)
      let expression = selectedFormula.expression;
      Object.entries(context).forEach(([name, value]) => {
        expression = expression.replace(new RegExp(name, 'g'), value);
      });

      // WARNING: This is for demo only - never use eval in production
      const result = eval(expression);
      setFormulaResult(result);
    } catch (error) {
      console.error('Formula calculation error:', error);
      setFormulaResult('Error in calculation');
    }
  };

  const handleVariableChange = (varName, newValue) => {
    setVariables(prev => ({
      ...prev,
      [varName]: {
        ...prev[varName],
        value: parseFloat(newValue) || 0
      }
    }));
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
        🧮 Formula Calculator
      </h3>

      {/* Formula Selection */}
      {selectedFormula && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '1rem'
          }}>
            <div style={{
              fontSize: '0.875rem',
              color: 'rgba(255, 255, 255, 0.6)',
              marginBottom: '0.5rem'
            }}>
              Active Formula:
            </div>
            <div style={{
              fontSize: '1rem',
              fontFamily: 'monospace',
              color: '#60a5fa',
              padding: '0.5rem',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '4px',
              overflowX: 'auto'
            }}>
              {selectedFormula.expression}
            </div>
          </div>
        </div>
      )}

      {/* Variable Inputs */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{
          fontSize: '0.875rem',
          fontWeight: '600',
          color: 'rgba(255, 255, 255, 0.8)',
          marginBottom: '1rem'
        }}>
          Variables:
        </h4>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {Object.entries(variables).map(([name, info]) => (
            <div key={name} style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 80px',
              gap: '0.75rem',
              alignItems: 'center',
              padding: '0.75rem',
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <div>
                <div style={{
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  color: '#f3f4f6'
                }}>
                  {name}
                </div>
                <div style={{
                  fontSize: '0.75rem',
                  color: 'rgba(255, 255, 255, 0.5)'
                }}>
                  {info.source}
                </div>
              </div>
              
              <input
                type="number"
                value={info.value}
                onChange={(e) => handleVariableChange(name, e.target.value)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  padding: '0.5rem',
                  color: '#f3f4f6',
                  fontSize: '0.875rem',
                  textAlign: 'right'
                }}
                step="0.01"
              />
              
              <div style={{
                fontSize: '0.875rem',
                color: 'rgba(255, 255, 255, 0.6)',
                textAlign: 'right'
              }}>
                %
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Calculate Button */}
      <button
        onClick={calculateFormula}
        style={{
          width: '100%',
          padding: '0.75rem',
          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          border: 'none',
          borderRadius: '6px',
          color: 'white',
          fontSize: '0.875rem',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'transform 0.2s ease',
          marginBottom: '1rem'
        }}
        onMouseEnter={(e) => e.target.style.transform = 'translateY(-1px)'}
        onMouseLeave={(e) => e.target.style.transform = 'translateY(0)'}
      >
        Calculate Formula
      </button>

      {/* Result Display */}
      {formulaResult !== null && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '8px',
          padding: '1rem',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '0.875rem',
            color: 'rgba(255, 255, 255, 0.6)',
            marginBottom: '0.5rem'
          }}>
            Formula Result:
          </div>
          <div style={{
            fontSize: '1.5rem',
            fontWeight: '600',
            color: '#10b981'
          }}>
            {typeof formulaResult === 'number' ? 
              `${formulaResult.toFixed(2)}%` : 
              formulaResult}
          </div>
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
        💡 This calculator evaluates mathematical formulas defined in the payoff structure. 
        Adjust variable values to see how they affect the formula result.
      </div>
    </div>
  );
};

export default FormulaCalculatorView;