import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import UnderlyingNews from '../components/UnderlyingNews.jsx';
import PriceSparkline from '../components/PriceSparkline.jsx';
import { USER_ROLES } from '/imports/api/users';
import { useDialog } from '../useDialog';
import Dialog from '../Dialog.jsx';
import { getTranslation, t } from '../../utils/reportTranslations';

/**
 * Participation Note Report Component
 *
 * Displays evaluation results for Participation Note structured products.
 * All data is pre-calculated in the evaluator - this component only displays.
 * Supports multiple languages (EN/FR) via URL parameter.
 *
 * NO CALCULATIONS PERFORMED IN THIS COMPONENT.
 */
const ParticipationNoteReport = ({ results, productId, product, user }) => {
  // Get language from URL params
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const lang = urlParams?.get('lang') || 'en';
  const tr = getTranslation(lang);
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
  const observationSchedule = results.observationSchedule || [];
  const hasObservationSchedule = results.hasObservationSchedule || false;

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
      // Get sessionId from localStorage for authentication
      const sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        throw new Error('Not logged in - please refresh the page');
      }

      await Meteor.callAsync('products.setIssuerCall', productId, {
        hasCallOption,
        callDate: hasCallOption && callDate ? new Date(callDate) : null,
        callPrice: hasCallOption && callPrice ? parseFloat(callPrice) : null,
        callRebate: hasCallOption && callRebate ? parseFloat(callRebate) : null
      }, sessionId);

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
        📈 {tr.participationNoteEvaluationResults}
      </div>

      {/* Prominent Called Banner - appears FIRST when product is called */}
      {issuerCall.isCalled && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6, 0.15) 100%)',
          padding: '2rem',
          borderRadius: '12px',
          marginBottom: '1.5rem',
          border: '3px solid rgba(245, 158, 11, 0.5)',
          boxShadow: '0 8px 32px rgba(245, 158, 11, 0.15)'
        }}>
          {/* Header with large icon */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            <span style={{ fontSize: '2.5rem' }}>🏦</span>
            <div>
              <h3 style={{
                margin: 0,
                fontSize: '1.5rem',
                fontWeight: '700',
                color: '#b45309',
                letterSpacing: '0.5px'
              }}>
                {tr.productCalledByIssuer}
              </h3>
              <p style={{
                margin: '0.5rem 0 0 0',
                fontSize: '1rem',
                color: 'var(--text-secondary)'
              }}>
                {tr.productWasEarlyRedeemedOn} <strong style={{ color: '#b45309' }}>{issuerCall.callDateFormatted}</strong>
              </p>
            </div>
          </div>

          {/* Key metrics grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '1.5rem',
            padding: '1.25rem',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '2px solid rgba(245, 158, 11, 0.4)'
          }}>
            {/* Call Date */}
            <div>
              <div style={{
                fontSize: '0.7rem',
                fontWeight: '600',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '0.5rem'
              }}>
                Call Date
              </div>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: '700',
                color: '#f59e0b'
              }}>
                {issuerCall.callDateFormatted}
              </div>
            </div>

            {/* Call Price */}
            <div>
              <div style={{
                fontSize: '0.7rem',
                fontWeight: '600',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '0.5rem'
              }}>
                Call Price
              </div>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: '700',
                color: 'var(--text-primary)'
              }}>
                {issuerCall.callPriceFormatted || '100%'}
              </div>
            </div>

            {/* Rebate (if applicable) */}
            {issuerCall.rebateFormatted && (
              <div>
                <div style={{
                  fontSize: '0.7rem',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '0.5rem'
                }}>
                  Rebate
                </div>
                <div style={{
                  fontSize: '1.1rem',
                  fontWeight: '700',
                  color: '#34d399'
                }}>
                  {issuerCall.rebateFormatted}
                  {issuerCall.rebateType === 'per_annum' && issuerCall.rebateCalculationDetails && (
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: '500',
                      color: 'var(--text-secondary)',
                      marginLeft: '0.5rem'
                    }}>
                      ({issuerCall.rebateCalculationDetails.annualRate?.toFixed(2)}% p.a.)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Total Redemption */}
            <div>
              <div style={{
                fontSize: '0.7rem',
                fontWeight: '600',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '0.5rem'
              }}>
                Total Received
              </div>
              <div style={{
                fontSize: '1.25rem',
                fontWeight: '700',
                color: '#34d399'
              }}>
                {issuerCall.totalReceivedFormatted || `${((issuerCall.callPrice || 100) + (issuerCall.rebate || 0)).toFixed(2)}%`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Underlying Assets Performance Table */}
      {underlyings.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginBottom: '1.5rem',
          opacity: issuerCall.isCalled ? 0.7 : 1,
          filter: issuerCall.isCalled ? 'saturate(0.6)' : 'none',
          transition: 'all 0.3s ease'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            📊 {tr.underlyingAssetsPerformance}
            {issuerCall.isCalled && (
              <span style={{
                fontSize: '0.7rem',
                padding: '4px 8px',
                background: 'rgba(107, 114, 128, 0.2)',
                borderRadius: '4px',
                color: 'var(--text-muted)',
                fontWeight: '500',
                marginLeft: '0.5rem'
              }}>
                Historical
              </span>
            )}
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
                    }}>🏢 {tr.asset}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>📍 {tr.initialLevel}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>💹 {tr.currentLevel}</div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      color: '#e2e8f0',
                      textTransform: 'uppercase',
                      textAlign: 'center',
                      letterSpacing: '1px'
                    }}>📊 {tr.performance}</div>
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
                        {underlying.sparklineData?.hasData && (
                          <div style={{ marginTop: '0.5rem' }}>
                            <PriceSparkline
                              sparklineData={underlying.sparklineData}
                              ticker={underlying.ticker}
                              initialPrice={underlying.initialPrice}
                              currency={underlying.currency}
                              isPositive={underlying.isPositive}
                            />
                          </div>
                        )}

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

          {/* Info note when called */}
          {issuerCall.isCalled && (
            <div style={{
              marginTop: '1rem',
              padding: '0.75rem 1rem',
              background: 'rgba(107, 114, 128, 0.1)',
              borderRadius: '6px',
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span style={{ fontSize: '1rem' }}>ℹ️</span>
              Performance data shown is for historical reference only. This product was called by the issuer on {issuerCall.callDateFormatted}.
            </div>
          )}
        </div>
      )}

      {/* Indicative Maturity Value - Shows hypothetical redemption if product matured today */}
      {results.indicativeMaturityValue && results.indicativeMaturityValue.isLive && (
        <div className="pdf-card pdf-page-break-before" style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%)',
          border: '2px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '12px',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Decorative gradient background */}
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '200px',
            height: '200px',
            background: 'radial-gradient(circle, rgba(16, 185, 129, 0.15) 0%, transparent 70%)',
            pointerEvents: 'none'
          }} />

          <div style={{
            position: 'relative',
            zIndex: 1
          }}>
            <h4 style={{
              margin: '0 0 1rem 0',
              fontSize: '1rem',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              💡 {tr.indicativeValueIfMaturedToday}
              <span style={{
                fontSize: '0.75rem',
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#10b981',
                padding: '4px 8px',
                borderRadius: '4px',
                fontWeight: '600'
              }}>
                {tr.hypothetical}
              </span>
            </h4>

            <div style={{
              background: 'var(--bg-tertiary)',
              padding: '1rem',
              borderRadius: '6px',
              marginBottom: '1rem',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              fontStyle: 'italic',
              border: '1px solid var(--border-color)'
            }}>
              {tr.indicativeCalculationDisclaimer}
            </div>

            {/* Total Indicative Value - Large Display */}
            <div style={{
              background: 'var(--bg-secondary)',
              padding: '2rem',
              borderRadius: '8px',
              textAlign: 'center',
              marginBottom: '1.5rem',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                fontWeight: '700',
                letterSpacing: '1px',
                marginBottom: '0.75rem'
              }}>
                {tr.currentTheoreticalTotalReturn}
              </div>
              <div style={{
                fontSize: '3rem',
                fontWeight: '800',
                color: results.indicativeMaturityValue.isPositive ? '#10b981' : '#ef4444',
                fontFamily: 'monospace',
                lineHeight: '1'
              }}>
                {results.indicativeMaturityValue.totalValueFormatted}
              </div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginTop: '0.5rem'
              }}>
                {tr.asOf} {results.indicativeMaturityValue.evaluationDateFormatted}
              </div>
            </div>

            {/* Breakdown Components */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem'
            }}>
              {/* Raw Basket Performance */}
              <div style={{
                background: 'var(--bg-secondary)',
                padding: '1.25rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  marginBottom: '0.75rem',
                  fontWeight: '700',
                  letterSpacing: '0.5px'
                }}>
                  📊 Basket Performance
                </div>
                <div style={{
                  fontSize: '1.8rem',
                  fontWeight: '700',
                  color: results.indicativeMaturityValue.rawPerformance >= 0 ? '#10b981' : '#ef4444',
                  marginBottom: '0.5rem',
                  fontFamily: 'monospace'
                }}>
                  {results.indicativeMaturityValue.rawPerformanceFormatted}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  lineHeight: '1.4'
                }}>
                  {results.indicativeMaturityValue.referencePerformanceLabel}
                  {results.indicativeMaturityValue.drivingUnderlyingTicker && (
                    <span style={{ color: 'var(--text-secondary)', marginLeft: '0.25rem' }}>
                      ({results.indicativeMaturityValue.drivingUnderlyingTicker})
                    </span>
                  )}
                </div>
              </div>

              {/* Participation Rate */}
              <div style={{
                background: 'var(--bg-secondary)',
                padding: '1.25rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  marginBottom: '0.75rem',
                  fontWeight: '700',
                  letterSpacing: '0.5px'
                }}>
                  📈 Participation Rate
                </div>
                <div style={{
                  fontSize: '1.8rem',
                  fontWeight: '700',
                  color: 'var(--accent-color)',
                  marginBottom: '0.5rem',
                  fontFamily: 'monospace'
                }}>
                  {results.indicativeMaturityValue.participationRateFormatted}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)'
                }}>
                  Multiplier on performance
                </div>
              </div>

              {/* Participated Performance */}
              <div style={{
                background: 'var(--bg-secondary)',
                padding: '1.25rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  marginBottom: '0.75rem',
                  fontWeight: '700',
                  letterSpacing: '0.5px'
                }}>
                  💰 Participated Return
                </div>
                <div style={{
                  fontSize: '1.8rem',
                  fontWeight: '700',
                  color: results.indicativeMaturityValue.participatedPerformance >= 0 ? '#10b981' : '#ef4444',
                  marginBottom: '0.5rem',
                  fontFamily: 'monospace'
                }}>
                  {results.indicativeMaturityValue.participatedPerformanceFormatted}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)'
                }}>
                  Performance × Participation
                </div>
              </div>
            </div>

            {/* Formula Info */}
            <div style={{
              marginTop: '1rem',
              padding: '0.85rem 1rem',
              background: 'rgba(16, 185, 129, 0.1)',
              borderRadius: '6px',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span style={{ fontSize: '1rem' }}>🧮</span>
              <div>
                <strong>Formula:</strong> 100% + ({results.indicativeMaturityValue.rawPerformanceFormatted} × {results.indicativeMaturityValue.participationRateFormatted}) = <strong style={{ color: results.indicativeMaturityValue.isPositive ? '#10b981' : '#ef4444' }}>{results.indicativeMaturityValue.totalValueFormatted}</strong>
              </div>
            </div>
          </div>
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
            📰 {tr.latestNews}
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
              />
            ))}
          </div>
        </div>
      )}

      {/* Chart */}
      <StructuredProductChart productId={productId} height="900px" />

      {/* Issuer Call Status (only show when NOT called - called products have the prominent banner at top) */}
      {issuerCall.hasCallOption && !issuerCall.isCalled && (
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
                    <span>
                      {' '}(Rebate: <strong style={{ color: '#10b981' }}>{issuerCall.rebateFormatted}</strong>
                      {issuerCall.rebateType === 'per_annum' && issuerCall.rebateCalculationDetails && (
                        <span style={{ fontSize: '0.8rem', fontStyle: 'italic', color: 'var(--text-muted)' }}>
                          {' '}— {issuerCall.rebateCalculationDetails.annualRate.toFixed(2)}% p.a. × {issuerCall.rebateCalculationDetails.daysHeld} days
                        </span>
                      )})
                    </span>
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
        marginBottom: '1.5rem',
        opacity: issuerCall.isCalled ? 0.5 : 1,
        filter: issuerCall.isCalled ? 'saturate(0.4)' : 'none',
        transition: 'all 0.3s ease'
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
          {issuerCall.isCalled && (
            <span style={{
              fontSize: '0.7rem',
              padding: '4px 8px',
              background: 'rgba(107, 114, 128, 0.2)',
              borderRadius: '4px',
              color: 'var(--text-muted)',
              fontWeight: '500',
              marginLeft: '0.5rem'
            }}>
              Not Applicable - Called
            </span>
          )}
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
          {issuerCall.isCalled ? '💰 Redemption at Call' : '💰 Redemption at Maturity'}
        </h4>

        <div style={{
          padding: '1.5rem',
          background: 'var(--bg-primary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          {issuerCall.isCalled ? (
            /* Called product - show call-specific redemption */
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.1) 100%)',
              borderRadius: '8px',
              border: '2px solid rgba(245, 158, 11, 0.3)'
            }}>
              <div>
                <div style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.25rem',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}>
                  Total Amount Received
                </div>
                <div style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  marginTop: '0.5rem'
                }}>
                  Called on {issuerCall.callDateFormatted}
                </div>
              </div>
              <div style={{
                fontSize: '2.5rem',
                fontWeight: '700',
                color: '#f59e0b',
                fontFamily: 'monospace'
              }}>
                {(() => {
                  const callPrice = issuerCall.callPrice || 100;
                  const rebate = issuerCall.rebate || 0;
                  const total = callPrice + rebate;
                  return `${total.toFixed(2)}%`;
                })()}
              </div>
            </div>
          ) : (
            /* Normal maturity-based redemption */
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
          )}
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

      {/* Early Redemption Schedule (if applicable) */}
      {hasObservationSchedule && observationSchedule.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          padding: '1.5rem',
          borderRadius: '6px',
          marginTop: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            📅 Early Redemption Schedule
          </h4>

          {/* Call Notice - shown when product was called */}
          {issuerCall.isCalled && (
            <div style={{
              padding: '1rem',
              marginBottom: '1rem',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.1) 100%)',
              borderRadius: '8px',
              border: '2px solid rgba(245, 158, 11, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span style={{ fontSize: '1.5rem' }}>🏦</span>
              <div>
                <div style={{
                  fontSize: '0.95rem',
                  fontWeight: '700',
                  color: '#f59e0b',
                  marginBottom: '0.25rem'
                }}>
                  Product Called on {issuerCall.callDateFormatted}
                </div>
                <div style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)'
                }}>
                  Remaining observation dates are cancelled. Total received: {(() => {
                    const callPrice = issuerCall.callPrice || 100;
                    const rebate = issuerCall.rebate || 0;
                    return `${(callPrice + rebate).toFixed(2)}%`;
                  })()}
                </div>
              </div>
            </div>
          )}

          <div style={{
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            marginBottom: '1rem',
            fontStyle: 'italic'
          }}>
            {issuerCall.isCalled
              ? 'Schedule of potential call dates. Product was called before completing the full schedule.'
              : 'Dates on which the issuer may call the product early. Note: These are optional redemption dates - the issuer is not obligated to call on these dates.'
            }
          </div>
          <div style={{
            overflowX: 'auto'
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.9rem'
            }}>
              <thead>
                <tr style={{
                  background: 'var(--bg-primary)',
                  borderBottom: '2px solid var(--border-color)'
                }}>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    Period
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    Observation Date
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    Redemption Date
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'center',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    Rebate
                  </th>
                  <th style={{
                    padding: '0.75rem',
                    textAlign: 'center',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {observationSchedule.map((obs, index) => {
                  const observationDate = new Date(obs.observationDate);
                  const valueDate = new Date(obs.valueDate);
                  const now = new Date();
                  const isPast = observationDate < now;

                  // Check if this observation date matches the call date
                  const callDateObj = issuerCall.callDate ? new Date(issuerCall.callDate) : null;
                  const isCallDate = issuerCall.isCalled && callDateObj &&
                    observationDate.toDateString() === callDateObj.toDateString();

                  // Check if this date is AFTER the call date (cancelled)
                  const isCancelledByCall = issuerCall.isCalled && callDateObj &&
                    observationDate > callDateObj;

                  return (
                    <tr
                      key={obs.id || index}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        background: isCallDate
                          ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(217, 119, 6, 0.15) 100%)'
                          : isCancelledByCall
                            ? 'rgba(107, 114, 128, 0.1)'
                            : isPast ? 'var(--bg-tertiary)' : 'transparent',
                        border: isCallDate ? '2px solid rgba(245, 158, 11, 0.5)' : 'none',
                        opacity: isCancelledByCall ? 0.5 : 1
                      }}
                    >
                      <td style={{
                        padding: '0.75rem',
                        color: isCallDate ? '#b45309' : isCancelledByCall ? 'var(--text-muted)' : 'var(--text-secondary)',
                        fontWeight: isCallDate ? '700' : '500',
                        textDecoration: isCancelledByCall ? 'line-through' : 'none'
                      }}>
                        {index + 1}
                      </td>
                      <td style={{
                        padding: '0.75rem',
                        color: isCallDate ? '#b45309' : isCancelledByCall ? 'var(--text-muted)' : 'var(--text-primary)',
                        fontWeight: isCallDate ? '700' : 'normal',
                        textDecoration: isCancelledByCall ? 'line-through' : 'none'
                      }}>
                        {observationDate.toLocaleDateString('en-US', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric'
                        })}
                      </td>
                      <td style={{
                        padding: '0.75rem',
                        color: isCallDate ? '#b45309' : isCancelledByCall ? 'var(--text-muted)' : 'var(--text-primary)',
                        fontWeight: isCallDate ? '700' : 'normal',
                        textDecoration: isCancelledByCall ? 'line-through' : 'none'
                      }}>
                        {valueDate.toLocaleDateString('en-US', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric'
                        })}
                      </td>
                      <td style={{
                        padding: '0.75rem',
                        textAlign: 'center',
                        color: isCancelledByCall ? 'var(--text-muted)' : 'var(--text-primary)',
                        fontWeight: '500',
                        textDecoration: isCancelledByCall ? 'line-through' : 'none'
                      }}>
                        {obs.rebateAmount !== undefined && obs.rebateAmount !== null ? (
                          <span style={{ color: isCancelledByCall ? 'var(--text-muted)' : '#10b981' }}>{obs.rebateAmount.toFixed(2)}%</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>N/A</span>
                        )}
                      </td>
                      <td style={{
                        padding: '0.75rem',
                        textAlign: 'center'
                      }}>
                        {isCancelledByCall ? (
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            background: 'rgba(107, 114, 128, 0.2)',
                            color: 'var(--text-muted)',
                            fontWeight: '500'
                          }}>
                            Cancelled
                          </span>
                        ) : isCallDate ? (
                          <span style={{
                            padding: '6px 14px',
                            borderRadius: '6px',
                            fontSize: '0.8rem',
                            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                            color: 'white',
                            fontWeight: '700',
                            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)'
                          }}>
                            ✓ CALLED
                          </span>
                        ) : isPast ? (
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            background: 'rgba(107, 114, 128, 0.2)',
                            color: 'var(--text-muted)',
                            fontWeight: '500'
                          }}>
                            Past
                          </span>
                        ) : (
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            background: 'rgba(59, 130, 246, 0.15)',
                            color: '#3b82f6',
                            fontWeight: '500'
                          }}>
                            Upcoming
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
