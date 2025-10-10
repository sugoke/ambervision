import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';

const SystemOperations = ({ user }) => {
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchResults, setBatchResults] = useState(null);
  const { dialogState, showAlert, showError, showSuccess, showConfirm, hideDialog } = useDialog();

  const handleBatchProcessAllProducts = async () => {
    const confirmed = await showConfirm(
      'This will process ALL live products in the database and evaluate their current performance. This may take several minutes depending on the number of products and market data required.\n\nProceed with batch processing?',
      null,
      'Confirm Batch Processing'
    );
    
    if (!confirmed) return;

    setBatchProcessing(true);
    setBatchResults(null);

    try {
      console.log('=== BATCH PROCESS FLOW START ===');
      console.log('[UI] SystemOperations: User clicked "Process All Products" button');
      console.log('[UI] User confirmed batch processing');
      console.log('[UI] Starting batch processing of all live products');
      
      // Get sessionId from localStorage
      const sessionId = localStorage.getItem('sessionId');
      console.log('[UI] Session ID:', sessionId);
      
      console.log('[UI] Calling Meteor method: products.processAllLiveProducts');
      const results = await Meteor.callAsync('products.processAllLiveProducts', {
        includeDebug: true  // Changed to true for detailed logging
      }, sessionId);

      setBatchResults(results);
      
      if (results.success) {
        showSuccess(
          `Batch processing completed successfully!\n\nProcessed: ${results.successfulProducts}/${results.totalProducts} products\nSuccess Rate: ${results.successRate}%\nTotal Time: ${(results.totalTimeMs / 1000).toFixed(1)}s`,
          'Batch Processing Complete'
        );
      } else {
        showError(`Batch processing failed: ${results.error}`, 'Batch Processing Error');
      }
      
    } catch (error) {
      console.error('SystemOperations: Batch processing failed:', error);
      showError(`Failed to process products: ${error.message}`, 'Processing Error');
    } finally {
      setBatchProcessing(false);
    }
  };

  return (
    <div>
      {/* Batch Processing Section */}
      <section style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        background: 'var(--bg-primary)'
      }}>
        <h3 style={{
          margin: '0 0 1.5rem 0',
          fontSize: '1.2rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          System Operations
        </h3>
        
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem'
        }}>
          <div>
            <h4 style={{
              margin: 0,
              fontSize: '1rem',
              fontWeight: '500',
              color: 'var(--text-primary)'
            }}>
              Batch Product Processing
            </h4>
            <p style={{
              margin: '0.25rem 0 0 0',
              color: 'var(--text-secondary)',
              fontSize: '0.875rem'
            }}>
              Process all live products to evaluate performance and generate reports
            </p>
          </div>
          
          <button
            onClick={handleBatchProcessAllProducts}
            disabled={batchProcessing}
            style={{
              padding: '12px 24px',
              background: batchProcessing 
                ? 'var(--text-muted)' 
                : 'var(--success-color)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: batchProcessing ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              minWidth: '200px',
              justifyContent: 'center'
            }}
          >
            {batchProcessing ? (
              <>
                <span style={{ 
                  animation: 'spin 1s linear infinite',
                  fontSize: '1.2rem'
                }}>⚡</span>
                Processing...
              </>
            ) : (
              <>
                <span>🚀</span>
                Process All Products
              </>
            )}
          </button>
        </div>

        {/* Processing Status */}
        {batchProcessing && (
          <div style={{
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            padding: '1.5rem',
            border: '1px solid var(--border-color)',
            marginBottom: '1.5rem'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem'
            }}>
              <span style={{ 
                animation: 'spin 1s linear infinite',
                fontSize: '1.25rem',
                color: 'var(--accent-color)'
              }}>⚡</span>
              <span style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>
                Processing in progress...
              </span>
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--accent-color)' }}>▸</span>
                Fetching market data for all underlying assets
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--accent-color)' }}>▸</span>
                Evaluating payoff structures and calculating returns
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--accent-color)' }}>▸</span>
                Detecting autocalls and coupon payments
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--accent-color)' }}>▸</span>
                Generating performance reports
              </div>
            </div>
          </div>
        )}

        {/* Batch Results Summary */}
        {batchResults && batchResults.success && (
          <div style={{
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            padding: '1.5rem',
            border: '1px solid var(--success-color)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              marginBottom: '1.5rem'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                background: 'linear-gradient(135deg, var(--success-color) 0%, #20c997 100%)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem'
              }}>
                ✅
              </div>
              <div>
                <h3 style={{
                  margin: 0,
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  Batch Processing Results
                </h3>
              </div>
            </div>
            
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem'
            }}>
              <div style={{
                background: 'var(--bg-secondary)',
                padding: '1.25rem',
                borderRadius: '10px',
                textAlign: 'center',
                border: '1px solid var(--border-color)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                  {batchResults.successfulProducts}/{batchResults.totalProducts}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontWeight: '500' }}>
                  Products Processed
                </div>
              </div>
              
              <div style={{
                background: 'var(--bg-secondary)',
                padding: '1.25rem',
                borderRadius: '10px',
                textAlign: 'center',
                border: '1px solid var(--border-color)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--success-color)' }}>
                  {batchResults.successRate}%
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontWeight: '500' }}>
                  Success Rate
                </div>
              </div>
              
              <div style={{
                background: 'var(--bg-secondary)',
                padding: '1.25rem',
                borderRadius: '10px',
                textAlign: 'center',
                border: '1px solid var(--border-color)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--accent-color)' }}>
                  {(batchResults.totalTimeMs / 1000).toFixed(1)}s
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontWeight: '500' }}>
                  Processing Time
                </div>
              </div>
              
              <div style={{
                background: 'var(--bg-secondary)',
                padding: '1.25rem',
                borderRadius: '10px',
                textAlign: 'center',
                border: '1px solid var(--border-color)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--info-color)' }}>
                  {batchResults.summary?.autocallCount || 0}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem', fontWeight: '500' }}>
                  Autocalled Products
                </div>
              </div>
            </div>

            {/* Performance Summary */}
            {batchResults.summary && batchResults.summary.totalReturns && batchResults.summary.totalReturns.length > 0 && (
              <div style={{
                background: 'var(--bg-secondary)',
                padding: '1.25rem',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                marginTop: '1rem'
              }}>
                <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Portfolio Performance Overview:
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  Average Return: {(batchResults.summary.totalReturns.reduce((sum, r) => sum + r, 0) / batchResults.summary.totalReturns.length).toFixed(2)}% • 
                  Best: {Math.max(...batchResults.summary.totalReturns).toFixed(2)}% • 
                  Worst: {Math.min(...batchResults.summary.totalReturns).toFixed(2)}% • 
                  Total Events: {batchResults.summary.totalEvents} • 
                  Total Payments: {batchResults.summary.totalPayments}
                </div>
              </div>
            )}

            {/* Failed Products */}
            {batchResults.failedProducts > 0 && (
              <div style={{
                background: 'rgba(220, 53, 69, 0.1)',
                padding: '1.25rem',
                borderRadius: '10px',
                marginTop: '1rem',
                border: '1px solid var(--danger-color)'
              }}>
                <div style={{ fontWeight: '600', color: 'var(--error-color)', marginBottom: '0.5rem' }}>
                  ⚠️ {batchResults.failedProducts} Product(s) Failed Processing
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  Check the detailed results below for error information and retry if needed.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error Results */}
        {batchResults && !batchResults.success && (
          <div style={{
            background: 'rgba(220, 53, 69, 0.1)',
            border: '1px solid var(--danger-color)',
            borderRadius: '12px',
            padding: '1.5rem'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              marginBottom: '1rem'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                background: 'var(--danger-color)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem'
              }}>
                ❌
              </div>
              <div>
                <h3 style={{
                  margin: 0,
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  Batch Processing Failed
                </h3>
              </div>
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              {batchResults.error}
            </div>
          </div>
        )}
      </section>

      {/* Market Data Operations */}
      <section style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        background: 'var(--bg-primary)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '2rem'
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            background: 'var(--warning-color, #f59e0b)',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem'
          }}>
            📈
          </div>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: '1.3rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Market Data Operations
            </h2>
            <p style={{
              margin: '0.25rem 0 0 0',
              color: 'var(--text-secondary)',
              fontSize: '0.9rem'
            }}>
              Manage market data caching and synchronization
            </p>
          </div>
        </div>
        
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.5rem'
        }}>
          <div
            style={{
              padding: '1.5rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              textAlign: 'left'
            }}
            onClick={() => showAlert('Market data refresh functionality will be implemented in future versions.', 'Coming Soon')}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              e.currentTarget.style.borderColor = 'var(--accent-color)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.borderColor = 'var(--border-color)';
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '0.75rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>🔄</span>
              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>
                Refresh Market Data
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              Update cached market data for all underlying assets
            </div>
          </div>

          <div
            style={{
              padding: '1.5rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              textAlign: 'left'
            }}
            onClick={() => showAlert('Cache cleanup functionality will be implemented in future versions.', 'Coming Soon')}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              e.currentTarget.style.borderColor = 'var(--accent-color)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.borderColor = 'var(--border-color)';
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '0.75rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>🧹</span>
              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>
                Clean Cache
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              Remove old cached price data to free up storage
            </div>
          </div>
        </div>
      </section>

      {/* System Information */}
      <div style={{
        background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
        borderRadius: '16px',
        border: '1px solid var(--border-color)',
        padding: '2.5rem',
        boxShadow: '0 2px 8px var(--shadow)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '2rem'
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem'
          }}>
            ℹ️
          </div>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: '1.3rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              System Information
            </h2>
            <p style={{
              margin: '0.25rem 0 0 0',
              color: 'var(--text-secondary)',
              fontSize: '0.9rem'
            }}>
              System capabilities and feature overview
            </p>
          </div>
        </div>
        
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1.5rem'
        }}>
          <div style={{
            background: 'var(--bg-primary)',
            padding: '1.5rem',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>⚙️</span>
              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>
                Rule Engine
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              Version 1.0.0<br/>
              30+ Component Types<br/>
              Generic Evaluation
            </div>
          </div>

          <div style={{
            background: 'var(--bg-primary)',
            padding: '1.5rem',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>📊</span>
              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>
                Market Data
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              EOD Historical API<br/>
              Intelligent Caching<br/>
              Batch Processing
            </div>
          </div>

          <div style={{
            background: 'var(--bg-primary)',
            padding: '1.5rem',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>🚀</span>
              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>
                Features
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              Report Generation<br/>
              Scenario Analysis<br/>
              Portfolio Management
            </div>
          </div>
        </div>
      </div>

      {/* Dialog Component */}
      <Dialog
        isOpen={dialogState.isOpen}
        onClose={hideDialog}
        title={dialogState.title}
        message={dialogState.message}
        type={dialogState.type}
        onConfirm={dialogState.onConfirm}
        onCancel={dialogState.onCancel}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        showCancel={dialogState.showCancel}
      >
        {dialogState.children}
      </Dialog>
      
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default SystemOperations;