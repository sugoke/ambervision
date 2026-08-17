import React, { useState, useEffect } from 'react';

/**
 * Safe arithmetic evaluator (no eval / Function). Accepts only numbers and the
 * operators + - * / ( ) and Math.min/Math.max/Math.abs — enough for payoff formulas,
 * and incapable of executing arbitrary JavaScript. Tokenises, then evaluates with a
 * shunting-yard to RPN pass. Throws on any unexpected token.
 */
function evaluateArithmetic(expr) {
  const s = String(expr).replace(/Math\.(min|max|abs)/g, '$1');
  const tokens = s.match(/(\d+\.?\d*|\.\d+|[()+\-*/,]|min|max|abs)/g);
  if (!tokens || tokens.join('') !== s.replace(/\s+/g, '')) {
    throw new Error('Invalid characters in expression');
  }
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const fns = {
    min: (a, b) => Math.min(a, b),
    max: (a, b) => Math.max(a, b),
    abs: (a) => Math.abs(a)
  };
  const out = [];
  const ops = [];
  const apply = (op) => {
    if (op in fns) {
      const f = fns[op];
      const args = f.length === 1 ? [out.pop()] : [out.pop(), out.pop()].reverse();
      out.push(f(...args));
    } else {
      const b = out.pop(); const a = out.pop();
      out.push(op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b);
    }
  };
  for (const t of tokens) {
    if (/^(\d|\.)/.test(t)) out.push(parseFloat(t));
    else if (t in fns) ops.push(t);
    else if (t === ',') { while (ops.length && ops[ops.length - 1] !== '(') apply(ops.pop()); }
    else if (t in prec) {
      while (ops.length && (ops[ops.length - 1] in prec) && prec[ops[ops.length - 1]] >= prec[t]) apply(ops.pop());
      ops.push(t);
    } else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') apply(ops.pop());
      if (ops.pop() !== '(') throw new Error('Mismatched parentheses');
      if (ops.length && (ops[ops.length - 1] in fns)) apply(ops.pop());
    }
  }
  while (ops.length) { const op = ops.pop(); if (op === '(') throw new Error('Mismatched parentheses'); apply(op); }
  if (out.length !== 1) throw new Error('Malformed expression');
  return out[0];
}

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
      const context = {};
      Object.entries(variables).forEach(([name, info]) => {
        context[name] = Number(info.value) || 0;
      });

      // SECURITY: never eval() a stored formula — a product author could plant JS that
      // runs in a viewer's browser (stored XSS). Substitute variables with a properly
      // escaped, boundary-anchored regex, then evaluate arithmetic only via a safe parser.
      let expression = String(selectedFormula.expression || '');
      Object.entries(context)
        .sort((a, b) => b[0].length - a[0].length) // longest names first
        .forEach(([name, value]) => {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          expression = expression.replace(new RegExp(`\\b${escaped}\\b`, 'g'), `(${value})`);
        });

      const result = evaluateArithmetic(expression);
      setFormulaResult(Number.isFinite(result) ? result : 'Error in calculation');
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
          background: 'linear-gradient(135deg, var(--info-color) 0%, #2563eb 100%)',
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
            color: 'var(--gain-color)'
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