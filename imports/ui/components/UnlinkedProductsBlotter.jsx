import React, { useState, useEffect, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTheme } from '../ThemeContext.jsx';
import LiquidGlassCard from './LiquidGlassCard.jsx';

const UnlinkedProductsBlotter = ({ user }) => {
  const { theme } = useTheme();
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);

  const isAdmin = user && (user.role === 'admin' || user.role === 'superadmin');

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
      setLoading(false);
      return;
    }

    Meteor.callAsync('products.getUnlinkedStructuredProducts', { sessionId })
      .then(result => {
        setHoldings(result || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('[UnlinkedProductsBlotter] Error:', err);
        setLoading(false);
      });
  }, [isAdmin]);

  if (!isAdmin || loading || holdings.length === 0) return null;

  const formatNumber = (val) => {
    if (val == null || isNaN(val)) return '-';
    return Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const columns = [
    { key: 'securityName', label: 'Security Name', width: '40%', align: 'left' },
    { key: 'isin', label: 'ISIN', width: '20%', align: 'center' },
    { key: 'bankName', label: 'Bank', width: '18%', align: 'center' },
    { key: 'currency', label: 'Ccy', width: '10%', align: 'center' },
    { key: 'holders', label: 'Holders', width: '12%', align: 'center' }
  ];

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <LiquidGlassCard>
        {/* Header */}
        <div
          onClick={() => setCollapsed(!collapsed)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              fontSize: '0.95rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Unlinked Structured Products
            </span>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '22px',
              height: '22px',
              padding: '0 6px',
              borderRadius: '11px',
              fontSize: '0.75rem',
              fontWeight: '700',
              background: 'rgba(245, 158, 11, 0.15)',
              color: '#d97706',
              border: '1px solid rgba(245, 158, 11, 0.3)'
            }}>
              {holdings.length}
            </span>
          </div>
          <span style={{
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            transition: 'transform 0.2s ease',
            transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)'
          }}>
            ▼
          </span>
        </div>

        {/* Table */}
        {!collapsed && (
          <div style={{
            borderTop: '1px solid var(--border-color)',
            overflow: 'auto'
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              tableLayout: 'fixed'
            }}>
              <thead>
                <tr style={{
                  background: 'var(--bg-tertiary)',
                  borderBottom: '2px solid var(--border-color)'
                }}>
                  {columns.map(col => (
                    <th key={col.key} style={{
                      padding: '8px',
                      textAlign: col.align || 'center',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.3px',
                      whiteSpace: 'nowrap',
                      width: col.width
                    }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => (
                  <tr
                    key={h._id}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      transition: 'background 0.15s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0, 123, 255, 0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {columns.map(col => (
                      <td key={col.key} style={{
                        padding: '8px',
                        fontSize: '0.8rem',
                        color: 'var(--text-primary)',
                        textAlign: col.align || 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {col.format ? col.format(h[col.key]) : (h[col.key] || '-')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </LiquidGlassCard>
    </div>
  );
};

export default UnlinkedProductsBlotter;
