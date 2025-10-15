import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';
import { USER_ROLES } from '/imports/api/users';
import { useDialog } from '../useDialog';
import Dialog from '../Dialog.jsx';

/**
 * Participation Note Report Component
 *
 * Displays evaluation results for Participation Note structured products.
 * All data is pre-calculated in the evaluator - this component only displays.
 *
 * NO CALCULATIONS PERFORMED IN THIS COMPONENT.
 */
const ParticipationNoteReport = ({ results, productId, product, user }) => {
  // State for admin issuer call management
  const [isEditingCall, setIsEditingCall] = useState(false);
  const [hasCallOption, setHasCallOption] = useState(false);
  const [callDate, setCallDate] = useState('');
  const [callPrice, setCallPrice] = useState('');
  const [callRebate, setCallRebate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Dialog for confirmation
  const { dialogState, hideDialog, showConfirm } = useDialog();

  // Check if user is admin or superadmin
  const isAdmin = user && (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN);

  if (!results) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        No report data available
      </div>
    );
  }

  const participationParams = results.participationStructure || {};
  const status = results.currentStatus || {};
  const underlyings = results.underlyings || []; // Fixed: array not object
  const basketPerformance = results.basketPerformance || {};
  const participation = results.participation || {};
  const redemption = results.redemption || {};
  const issuerCall = results.issuerCall || {};

  // DEBUG: Log underlyings data structure
  console.log('📰 [ParticipationNoteReport] Underlyings from results:', underlyings.map(u => ({
    ticker: u.ticker,
    hasNews: !!u.news,
    newsCount: u.news?.length || 0,
    firstNewsTitle: u.news?.[0]?.title
  })));

  // Handler for showing confirmation before saving
  const handleConfirmAndSave = async () => {
    // Format the date for display
    const formattedDate = callDate ? new Date(callDate).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }) : 'Not set';

    const confirmMessage = hasCallOption
      ? `Are you sure you want to declare an issuer call on ${formattedDate}${callPrice ? ` at ${callPrice}%` : ''}${callRebate ? ` with ${callRebate}% rebate` : ''}?\n\nThis action will update the product evaluation and notify relevant users.`
      : 'Are you sure you want to remove the issuer call option?\n\nThis action will revert the product to its original state.';

    const confirmed = await showConfirm(
      confirmMessage,
      null,
      hasCallOption ? 'Confirm Issuer Call' : 'Confirm Removal'
    );

    if (confirmed) {
      await handleSaveIssuerCall();
    }
  };

  // Handler for saving issuer call
  const handleSaveIssuerCall = async () => {
    setIsSaving(true);
    setSaveMessage('');

    try {
      await Meteor.callAsync('products.setIssuerCall', productId, {
        hasCallOption,
        callDate: hasCallOption && callDate ? new Date(callDate) : null,
        callPrice: hasCallOption && callPrice ? parseFloat(callPrice) : null,
        callRebate: hasCallOption && callRebate ? parseFloat(callRebate) : null
      });

      setSaveMessage(hasCallOption ? '✓ Issuer call set successfully!' : '✓ Issuer call removed successfully!');
      setIsEditingCall(false);

      // Reload page after 1.5 seconds to show updated evaluation
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      setSaveMessage(`✗ Error: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Handler for starting edit
  const handleStartEdit = () => {
    // Pre-fill with current values if they exist
    const currentCallDate = product?.structureParameters?.issuerCallDate;
    const currentCallPrice = product?.structureParameters?.issuerCallPrice;
    const currentCallRebate = product?.structureParameters?.issuerCallRebate ||
                              product?.structureParams?.issuerCallRebate;

    setHasCallOption(!!currentCallDate);
    setCallDate(currentCallDate ? new Date(currentCallDate).toISOString().split('T')[0] : '');
    setCallPrice(currentCallPrice ? currentCallPrice.toString() : '');
    setCallRebate(currentCallRebate ? currentCallRebate.toString() : '');
    setIsEditingCall(true);
    setSaveMessage('');
  };

  return (
    <div style={{
      marginTop: '1rem',
      padding: '1rem',
      background: 'var(--bg-primary)',
      borderRadius: '6px'
    }}>
      {/* Header */}
      <div style={{
        fontSize: '0.9rem',
        fontWeight: '600',
        color: 'var(--text-primary)',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        📈 Participation Note Evaluation Results
      </div>

      {/* Underlying Assets Performance Table */}
      {underlyings.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            📊 Underlying Assets Performance
          </h4>

          {/* Table with Gradient Border */}
          <div style={{
            background: 'linear-gradient(135deg, #334155 0%, #475569 100%)',
            borderRadius: '12px',
            padding: '1px',
            boxShadow: '0 10px 40px rgba(51, 65, 85, 0.2)'
          }}>
            <div style={{
              background: 'var(--bg-secondary)',
              borderRadius: '11px',
              overflow: 'hidden'
            }}>
              <div style={{
                overflowX: 'auto',
                overflowY: 'hidden',
                maxWidth: '100%'
              }}>
                <div style={{
                  minWidth: '750px'
                }}>
                  {/* Table Header */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1.2fr',
                    gap: '0.75rem',
                    padding: '1.25rem 1.5rem',
                    background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                    borderBottom: '2px solid rgba(148, 163, 184, 0.2)'
                  }}>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>🏢 Asset</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>📍 Initial</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>💹 Current</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>📊 Performance</div>
                  </div>

                  {/* Table Rows */}
                  {underlyings.map((underlying, index) => {
                    const isFinal = index === underlyings.length - 1;

                    return (
                      <div
                        key={underlying.id || index}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '2fr 1fr 1fr 1.2fr',
                          gap: '0.75rem',
                          padding: '1.25rem 1.5rem',
                          background: index % 2 === 0 ? 'var(--bg-secondary)' : 'rgba(148, 163, 184, 0.03)',
                          borderBottom: !isFinal ? '1px solid rgba(148, 163, 184, 0.1)' : 'none',
                          alignItems: 'center',
                          transition: 'all 0.2s ease',
                          cursor: 'default'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(99, 102, 241, 0.08)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = index % 2 === 0 ? 'var(--bg-secondary)' : 'rgba(148, 163, 184, 0.03)';
                        }}
                      >
                        {/* Asset Name */}
                        <div>
                          <div style={{
                            fontWeight: '700',
                            color: 'var(--text-primary)',
                            fontSize: '0.95rem',
                            marginBottom: '0.25rem'
                          }}>
                            {underlying.ticker}
                          </div>
                          <div style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)'
                          }}>
                            {underlying.name || underlying.ticker}
                          </div>
                        </div>

                        {/* Initial Price */}
                        <div style={{
                          textAlign: 'center',
                          fontFamily: 'monospace',
                          color: 'var(--text-secondary)',
                          fontSize: '0.9rem',
                          fontWeight: '500'
                        }}>
                          {underlying.initialPriceFormatted || '-'}
                        </div>

                        {/* Current Price */}
                        <div style={{
                          textAlign: 'center',
                          fontFamily: 'monospace',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem'
                        }}>
                          {underlying.currentPriceFormatted || '-'}
                        </div>

                        {/* Performance */}
                        <div style={{
                          textAlign: 'center',
                          fontFamily: 'monospace',
                          fontWeight: '700',
                          color: underlying.isPositive ? '#10b981' : '#ef4444',
                          fontSize: '1rem',
                          padding: '0.5rem',
                          background: underlying.isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          borderRadius: '6px'
                        }}>
                          {underlying.performanceFormatted || '-'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Basket Performance Summary */}
          {underlyings.length > 1 && basketPerformance.currentFormatted && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              background: 'var(--bg-primary)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{
                fontSize: '0.9rem',
                fontWeight: '600',
                color: 'var(--text-secondary)'
              }}>
                Basket Performance ({participationParams.referencePerformanceLabel}):
              </div>
              <div style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: basketPerformance.isPositive ? '#10b981' : '#ef4444',
                fontFamily: 'monospace'
              }}>
                {basketPerformance.currentFormatted}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Latest News Section */}
      {underlyings.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            📰 Latest News
          </h4>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            {underlyings.map((underlying, index) => (
              <UnderlyingNews
                key={index}
                ticker={underlying.ticker}
                news={underlying.news}
              />
            ))}
          </div>
        </div>
      )}

      {/* Chart */}
      <StructuredProductChart productId={productId} height="900px" />

      {/* Issuer Call Status (if applicable) */}
      {issuerCall.hasCallOption && (
        <div style={{
          background: 'var(--bg-secondary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginTop: '1.5rem',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            🏦 Issuer Call Option
          </h4>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.25rem',
            background: issuerCall.isCalled
              ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.1) 100%)'
              : 'linear-gradient(135deg, rgba(107, 114, 128, 0.1) 0%, rgba(75, 85, 99, 0.05) 100%)',
            borderRadius: '8px',
            border: issuerCall.isCalled
              ? '2px solid rgba(245, 158, 11, 0.3)'
              : '2px solid rgba(107, 114, 128, 0.2)'
          }}>
            <div>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: '700',
                color: issuerCall.isCalled ? '#f59e0b' : 'var(--text-primary)',
                marginBottom: '0.5rem'
              }}>
                {issuerCall.status}
              </div>
              {issuerCall.isCalled && issuerCall.callDateFormatted && (
                <div style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)'
                }}>
                  Called on <strong>{issuerCall.callDateFormatted}</strong>
                  {issuerCall.callPriceFormatted && (
                    <span> at <strong>{issuerCall.callPriceFormatted}</strong></span>
                  )}
                  {issuerCall.rebateFormatted && (
                    <span> (Rebate: <strong style={{ color: '#10b981' }}>{issuerCall.rebateFormatted}</strong>)</span>
                  )}
                </div>
              )}
              {!issuerCall.isCalled && issuerCall.callDateFormatted && (
                <div style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)'
                }}>
                  Can be called on or after <strong>{issuerCall.callDateFormatted}</strong>
                </div>
              )}
            </div>
            <div>
              {issuerCall.isCalled ? (
                <span style={{
                  padding: '10px 20px',
                  borderRadius: '12px',
                  fontSize: '0.85rem',
                  fontWeight: '700',
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: 'white',
                  boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
                  letterSpacing: '0.5px'
                }}>
                  ✓ CALLED
                </span>
              ) : (
                <span style={{
                  padding: '10px 20px',
                  borderRadius: '12px',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-muted)',
                  border: '1px solid rgba(148, 163, 184, 0.2)'
                }}>
                  Not Called
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin Only: Issuer Call Management */}
      {isAdmin && (
        <div style={{
          background: 'var(--bg-secondary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginTop: '1.5rem',
          marginBottom: '1.5rem',
          border: '2px dashed rgba(99, 102, 241, 0.3)'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            🔧 Admin: Declare Issuer Call
            <span style={{
              fontSize: '0.7rem',
              padding: '4px 8px',
              background: 'rgba(99, 102, 241, 0.2)',
              borderRadius: '4px',
              color: '#6366f1',
              fontWeight: '600'
            }}>
              ADMIN ONLY
            </span>
          </h4>

          {!isEditingCall ? (
            <div>
              <button
                onClick={handleStartEdit}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 6px 16px rgba(99, 102, 241, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.3)';
                }}
              >
                {issuerCall.hasCallOption ? '✏️ Edit Issuer Call' : '➕ Set Issuer Call'}
              </button>
            </div>
          ) : (
            <div style={{
              padding: '1.5rem',
              background: 'var(--bg-primary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)'
            }}>
              {/* Checkbox for has call option */}
              <div style={{
                marginBottom: '1.5rem',
                padding: '1rem',
                background: 'var(--bg-secondary)',
                borderRadius: '6px'
              }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  <input
                    type="checkbox"
                    checked={hasCallOption}
                    onChange={(e) => setHasCallOption(e.target.checked)}
                    style={{
                      width: '20px',
                      height: '20px',
                      cursor: 'pointer'
                    }}
                  />
                  <span>Product has been called by issuer</span>
                </label>
              </div>

              {/* Call Date Input */}
              {hasCallOption && (
                <>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      marginBottom: '0.5rem',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      Call Date (required)
                    </label>
                    <input
                      type="date"
                      value={callDate}
                      onChange={(e) => setCallDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        fontSize: '0.95rem',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace'
                      }}
                      required
                    />
                  </div>

                  {/* Call Price Input */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      marginBottom: '0.5rem',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      Call Price (% of nominal, optional)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={callPrice}
                      onChange={(e) => setCallPrice(e.target.value)}
                      placeholder="e.g., 105.50"
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        fontSize: '0.95rem',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace'
                      }}
                    />
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.5rem',
                      fontStyle: 'italic'
                    }}>
                      Example: 105.50 means the product was called at 105.50% of nominal value
                    </div>
                  </div>

                  {/* Rebate Input */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      marginBottom: '0.5rem',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      Issuer Call Rebate (%, optional)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="20"
                      value={callRebate}
                      onChange={(e) => setCallRebate(e.target.value)}
                      placeholder="e.g., 5.0"
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        fontSize: '0.95rem',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace'
                      }}
                    />
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.5rem',
                      fontStyle: 'italic'
                    }}>
                      Additional payment on top of 100% when called by issuer (e.g., 5% means investor receives 105%)
                    </div>
                  </div>
                </>
              )}

              {/* Save Message */}
              {saveMessage && (
                <div style={{
                  padding: '0.75rem',
                  marginBottom: '1rem',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  background: saveMessage.startsWith('✓') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  color: saveMessage.startsWith('✓') ? '#10b981' : '#ef4444',
                  border: `1px solid ${saveMessage.startsWith('✓') ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                }}>
                  {saveMessage}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{
                display: 'flex',
                gap: '1rem',
                justifyContent: 'flex-end'
              }}>
                <button
                  onClick={() => setIsEditingCall(false)}
                  disabled={isSaving}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    cursor: isSaving ? 'not-allowed' : 'pointer',
                    opacity: isSaving ? 0.5 : 1
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmAndSave}
                  disabled={isSaving || (hasCallOption && !callDate)}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: isSaving || (hasCallOption && !callDate)
                      ? '#9ca3af'
                      : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    cursor: isSaving || (hasCallOption && !callDate) ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                  }}
                >
                  {isSaving ? 'Saving...' : '💾 Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Participation Calculation */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        marginBottom: '1.5rem'
      }}>
        <h4 style={{
          margin: '0 0 1rem 0',
          fontSize: '1rem',
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          🧮 Participation Calculation
        </h4>

        <div style={{
          padding: '1.5rem',
          background: 'var(--bg-primary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1.5rem',
            marginBottom: '1.5rem'
          }}>
            <div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                Raw Performance
              </div>
              <div style={{
                fontSize: '1.5rem',
                fontFamily: 'monospace',
                color: participation.rawPerformance >= 0 ? '#10b981' : '#ef4444',
                fontWeight: '700'
              }}>
                {participation.rawPerformanceFormatted || 'N/A'}
              </div>
            </div>

            <div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                Participation Rate
              </div>
              <div style={{
                fontSize: '1.5rem',
                fontFamily: 'monospace',
                color: 'var(--accent-color)',
                fontWeight: '700'
              }}>
                {participation.participationRateFormatted || 'N/A'}
              </div>
            </div>

            <div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                Participated Performance
              </div>
              <div style={{
                fontSize: '1.5rem',
                fontFamily: 'monospace',
                color: participation.participatedPerformance >= 0 ? '#10b981' : '#ef4444',
                fontWeight: '700'
              }}>
                {participation.participatedPerformanceFormatted || 'N/A'}
              </div>
            </div>
          </div>

          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            marginBottom: '0.5rem',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}>
            Formula:
          </div>
          <div style={{
            fontSize: '0.95rem',
            fontFamily: 'monospace',
            color: 'var(--text-secondary)',
            marginBottom: '1.5rem',
            padding: '0.75rem',
            background: 'var(--bg-secondary)',
            borderRadius: '6px'
          }}>
            {participation.formula || 'N/A'}
          </div>
        </div>
      </div>

      {/* Redemption Calculation */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        marginBottom: '1.5rem'
      }}>
        <h4 style={{
          margin: '0 0 1rem 0',
          fontSize: '1rem',
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          💰 Redemption at Maturity
        </h4>

        <div style={{
          padding: '1.5rem',
          background: 'var(--bg-primary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%)',
            borderRadius: '8px',
            border: '2px solid rgba(16, 185, 129, 0.2)'
          }}>
            <div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginBottom: '0.25rem',
                textTransform: 'uppercase',
                letterSpacing: '1px'
              }}>
                Redemption Value
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                fontStyle: 'italic'
              }}>
                📊 Performance-based with participation
              </div>
            </div>
            <div style={{
              fontSize: '2.5rem',
              fontWeight: '700',
              color: '#10b981',
              fontFamily: 'monospace'
            }}>
              {redemption.valueFormatted || 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* Participation Note Parameters Summary */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1.5rem'
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Participation Rate
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: '#10b981' }}>
            {participationParams.participationRateFormatted || 'N/A'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Strike Level
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--accent-color)' }}>
            {participationParams.strikeFormatted || 'N/A'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Reference Performance
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)', textTransform: 'capitalize' }}>
            {participationParams.referencePerformanceLabel || 'N/A'}
          </div>
        </div>

        {issuerCall.hasCallOption && (
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Issuer Call Option
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: '600', color: issuerCall.isCalled ? '#f59e0b' : '#6b7280' }}>
              {issuerCall.isCalled ? 'Called' : 'Available'}
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
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
    </div>
  );
};

export default ParticipationNoteReport;
