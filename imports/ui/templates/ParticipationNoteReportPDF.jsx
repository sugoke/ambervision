import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ProductsCollection } from '../../api/products';
import { TemplateReportsCollection } from '../../api/templateReports';
import StructuredProductChart from '../components/StructuredProductChart.jsx';
import { getTranslation, getLocale, t } from '../../utils/reportTranslations';

/**
 * Participation Note Report PDF Template
 *
 * Clean, table-based layout specifically designed for PDF generation.
 * Uses explicit colors (no CSS variables) for reliable PDF rendering.
 */
const ParticipationNoteReportPDF = ({ productId: propProductId }) => {
  const [isReady, setIsReady] = useState(false);

  // Get productId from URL path if not provided as prop
  const productId = propProductId || (typeof window !== 'undefined'
    ? window.location.pathname.split('/').pop()
    : null);

  // PDF mode detection and authentication
  const [pdfAuthState, setPdfAuthState] = useState({ validated: false, error: null });
  const [currentSessionId, setCurrentSessionId] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null
  );

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isPDFMode = urlParams?.get('pdfToken') != null;
  const pdfToken = urlParams?.get('pdfToken');
  const pdfUserId = urlParams?.get('userId');
  const lang = urlParams?.get('lang') || 'en';
  const tr = getTranslation(lang);

  // Validate PDF token if in PDF mode
  useEffect(() => {
    if (isPDFMode && pdfToken && pdfUserId) {
      console.log('[ParticipationNoteReportPDF] Validating PDF authentication token...');
      Meteor.call('pdf.validateToken', pdfUserId, pdfToken, (error, result) => {
        if (error || !result.valid) {
          console.error('[ParticipationNoteReportPDF] Token validation failed:', error?.reason || result?.reason);
          setPdfAuthState({ validated: false, error: error?.reason || result?.reason || 'Invalid token' });
        } else {
          console.log('[ParticipationNoteReportPDF] PDF token validated successfully');
          setPdfAuthState({ validated: true, error: null });

          // Store a temporary sessionId for PDF generation
          const tempSessionId = `pdf-temp-${pdfToken}`;
          localStorage.setItem('sessionId', tempSessionId);
          localStorage.setItem('pdfTempSession', 'true');
          setCurrentSessionId(tempSessionId);
        }
      });
    }

    // Cleanup on unmount
    return () => {
      if (localStorage.getItem('pdfTempSession') === 'true') {
        localStorage.removeItem('sessionId');
        localStorage.removeItem('pdfTempSession');
        setCurrentSessionId(null);
      }
    };
  }, [isPDFMode, pdfToken, pdfUserId]);

  // Set PDF mode on body and force white background
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.setAttribute('data-pdf-mode', 'true');
      document.body.style.cssText = 'background: white !important; background-color: white !important; min-height: 100vh;';
      document.documentElement.style.cssText = 'background: white !important; background-color: white !important;';

      const pdfStyleId = 'pdf-white-override';
      if (!document.getElementById(pdfStyleId)) {
        const style = document.createElement('style');
        style.id = pdfStyleId;
        style.textContent = `
          html, body, #react-target, .main-content, .App {
            background: white !important;
            background-color: white !important;
          }
          body::before, body::after {
            display: none !important;
          }
          * {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
        `;
        document.head.appendChild(style);
      }
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.removeAttribute('data-pdf-mode');
        document.body.style.cssText = '';
        document.documentElement.style.cssText = '';
        const pdfStyle = document.getElementById('pdf-white-override');
        if (pdfStyle) pdfStyle.remove();
      }
    };
  }, []);

  // Subscribe to product and report data
  const { product, latestReport, isLoading } = useTracker(() => {
    const sessionId = currentSessionId;

    if (isPDFMode && !pdfAuthState.validated) {
      console.log('[ParticipationNoteReportPDF] Waiting for PDF auth validation...');
      return { product: null, latestReport: null, isLoading: true };
    }

    if (!productId) return { product: null, latestReport: null, isLoading: true };

    console.log('[ParticipationNoteReportPDF] Subscribing with sessionId:', sessionId ? `${sessionId.substring(0, 20)}...` : 'null');

    const productSub = Meteor.subscribe('products.single', productId, sessionId);
    const reportsSub = Meteor.subscribe('templateReports.forProduct', productId, sessionId);

    const prod = ProductsCollection.findOne(productId);
    const report = TemplateReportsCollection.findOne(
      { productId },
      { sort: { createdAt: -1 } }
    );

    return {
      product: prod,
      latestReport: report,
      isLoading: !productSub.ready() || !reportsSub.ready()
    };
  }, [productId, currentSessionId, isPDFMode, pdfAuthState.validated]);

  // Signal PDF readiness
  useEffect(() => {
    if (!isLoading && product && latestReport) {
      setTimeout(() => {
        setIsReady(true);
        if (typeof document !== 'undefined') {
          document.body.setAttribute('data-pdf-ready', 'true');
        }
      }, 2000);
    }
  }, [isLoading, product, latestReport]);

  if (isLoading) {
    const loadingMessage = isPDFMode
      ? (pdfAuthState.error
        ? `Authentication failed: ${pdfAuthState.error}`
        : (pdfAuthState.validated
          ? 'Loading product data...'
          : 'Authenticating PDF session...'))
      : 'Loading product report...';

    return (
      <div style={styles.loading}>
        <p>{loadingMessage}</p>
        {isPDFMode && (
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.5rem' }}>
            PDF Mode | Auth: {pdfAuthState.validated ? 'OK' : 'Pending'} | Session: {currentSessionId ? 'Set' : 'None'}
          </p>
        )}
      </div>
    );
  }

  if (!product || !latestReport) {
    return (
      <div style={styles.loading}>
        <p>Report not found</p>
        {isPDFMode && (
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.5rem' }}>
            Product ID: {productId} | Auth: {pdfAuthState.validated ? 'OK' : 'Failed'}
          </p>
        )}
      </div>
    );
  }

  const results = latestReport.templateResults || {};
  const displayProduct = product.displayProduct || product;
  const participationParams = results.participationStructure || {};
  const underlyings = results.underlyings || [];
  const basketPerformance = results.basketPerformance || {};
  const participation = results.participation || {};
  const redemption = results.redemption || {};
  const issuerCall = results.issuerCall || {};
  const indicativeValue = results.indicativeMaturityValue || {};

  // Format date helper
  const formatDate = (date) => {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString(getLocale(lang), { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // Get reference performance label
  const getReferenceLabel = (ref) => {
    switch (ref) {
      case 'worst_of': return 'Worst-of';
      case 'best_of': return 'Best-of';
      case 'average': return lang === 'fr' ? 'Moyenne' : 'Average';
      default: return ref || 'Worst-of';
    }
  };

  return (
    <>
      {/* White background styles for PDF */}
      <style>{`
        html, body, #react-target {
          background: white !important;
          background-color: white !important;
        }
        .fixed-bg-light, .fixed-bg-dark {
          display: none !important;
        }
      `}</style>
      <div style={styles.container}>
      {/* Header with Logo */}
      <div style={styles.header}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h1 style={styles.title}>
              <span style={{ marginRight: '0.5rem' }}>📈</span>
              {displayProduct.title || displayProduct.productName || 'Participation Note Report'}
            </h1>
            <div style={styles.headerMeta}>
              <span style={styles.metaItem}>{tr.isin}: {displayProduct.isin || '-'}</span>
              <span style={styles.metaItem}>{tr.currency}: {displayProduct.currency || 'EUR'}</span>
              <span style={{
                ...styles.statusBadge,
                background: issuerCall.isCalled ? '#fef3c7' :
                           results.currentStatus?.productStatus === 'live' ? '#d1fae5' : '#e5e7eb',
                color: issuerCall.isCalled ? '#b45309' :
                       results.currentStatus?.productStatus === 'live' ? '#047857' : '#374151'
              }}>
                {issuerCall.isCalled ? tr.called.toUpperCase() : (results.currentStatus?.productStatus || 'unknown').toUpperCase()}
              </span>
            </div>
          </div>
          <img
            src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png"
            alt="Amberlake Partners"
            style={{
              height: '40px',
              width: 'auto',
              marginLeft: '1rem'
            }}
          />
        </div>
      </div>

      {/* Issuer Call Banner - Prominent if called */}
      {issuerCall.isCalled && (
        <div style={{
          background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
          padding: '1.5rem',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          border: '2px solid #f59e0b'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '2rem' }}>🏦</span>
            <div>
              <h3 style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: 700,
                color: '#b45309'
              }}>
                {tr.productCalledByIssuer}
              </h3>
              <p style={{
                margin: '0.25rem 0 0 0',
                fontSize: '0.9rem',
                color: '#92400e'
              }}>
                {tr.earlyRedeemedOn} <strong>{issuerCall.callDateFormatted}</strong>
                {issuerCall.callPrice && ` at ${issuerCall.callPriceFormatted}`}
                {issuerCall.rebate && ` with ${issuerCall.rebateFormatted} rebate`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Product Timeline */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{tr.productTimeline}</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{tr.tradeDate}</th>
              <th style={styles.th}>{tr.valueDate}</th>
              <th style={styles.th}>{tr.finalObservationDate}</th>
              <th style={styles.th}>{tr.maturityDate}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}>{formatDate(displayProduct.tradeDate)}</td>
              <td style={styles.td}>{formatDate(displayProduct.valueDate)}</td>
              <td style={styles.td}>{formatDate(displayProduct.finalObservation)}</td>
              <td style={styles.td}>{formatDate(displayProduct.maturityDate)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Market Price Info */}
      {(displayProduct.marketPrice || displayProduct.bidPrice || displayProduct.askPrice || results.productPrice) && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>💰 {tr.productMarketPrice}</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{tr.priceType}</th>
                <th style={{...styles.th, textAlign: 'right'}}>{tr.value}</th>
                <th style={{...styles.th, textAlign: 'right'}}>{tr.percentOfNominal}</th>
              </tr>
            </thead>
            <tbody>
              {(displayProduct.bidPrice || results.productPrice?.bid) && (
                <tr>
                  <td style={styles.td}>{tr.bidPrice}</td>
                  <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>
                    {displayProduct.bidPrice?.toFixed(2) || results.productPrice?.bid?.toFixed(2) || '-'}
                  </td>
                  <td style={{...styles.td, textAlign: 'right'}}>
                    {displayProduct.bidPrice ? `${displayProduct.bidPrice.toFixed(2)}%` : results.productPrice?.bid ? `${results.productPrice.bid.toFixed(2)}%` : '-'}
                  </td>
                </tr>
              )}
              {(displayProduct.askPrice || results.productPrice?.ask) && (
                <tr>
                  <td style={styles.td}>{tr.askPrice}</td>
                  <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>
                    {displayProduct.askPrice?.toFixed(2) || results.productPrice?.ask?.toFixed(2) || '-'}
                  </td>
                  <td style={{...styles.td, textAlign: 'right'}}>
                    {displayProduct.askPrice ? `${displayProduct.askPrice.toFixed(2)}%` : results.productPrice?.ask ? `${results.productPrice.ask.toFixed(2)}%` : '-'}
                  </td>
                </tr>
              )}
              {(displayProduct.marketPrice || displayProduct.midPrice || results.productPrice?.mid) && (
                <tr style={{background: '#f0f9ff'}}>
                  <td style={{...styles.td, fontWeight: 600}}>{tr.midPrice}</td>
                  <td style={{...styles.td, textAlign: 'right', fontWeight: 700, color: '#1e3a5f', fontSize: '1.1rem'}}>
                    {displayProduct.marketPrice?.toFixed(2) || displayProduct.midPrice?.toFixed(2) || results.productPrice?.mid?.toFixed(2) || '-'}
                  </td>
                  <td style={{...styles.td, textAlign: 'right', fontWeight: 600, color: '#1e3a5f'}}>
                    {displayProduct.marketPrice ? `${displayProduct.marketPrice.toFixed(2)}%` : displayProduct.midPrice ? `${displayProduct.midPrice.toFixed(2)}%` : results.productPrice?.mid ? `${results.productPrice.mid.toFixed(2)}%` : '-'}
                  </td>
                </tr>
              )}
              {displayProduct.priceDate && (
                <tr>
                  <td style={styles.td}>{tr.priceDate}</td>
                  <td style={{...styles.td, textAlign: 'right'}} colSpan={2}>
                    {formatDate(displayProduct.priceDate)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Underlying Performance */}
      {underlyings.length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>{tr.underlyingPerformance}</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{tr.ticker}</th>
                <th style={styles.th}>{tr.underlyingName}</th>
                <th style={{...styles.th, textAlign: 'right'}}>{tr.initialPrice}</th>
                <th style={{...styles.th, textAlign: 'right'}}>{tr.currentPrice}</th>
                <th style={{...styles.th, textAlign: 'right'}}>{tr.performance}</th>
                <th style={{...styles.th, textAlign: 'center'}}>{tr.statusLabel}</th>
              </tr>
            </thead>
            <tbody>
              {underlyings.map((u, i) => (
                <tr key={u.ticker || i} style={u.isWorstPerforming ? { background: '#fef2f2' } : u.isBestPerforming ? { background: '#f0fdf4' } : {}}>
                  <td style={{...styles.td, fontWeight: 600}}>{u.ticker}</td>
                  <td style={styles.td}>{u.name || u.companyName || '-'}</td>
                  <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>{u.initialPriceFormatted || u.initialPrice?.toFixed(2) || '-'}</td>
                  <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>{u.currentPriceFormatted || u.currentPrice?.toFixed(2) || '-'}</td>
                  <td style={{
                    ...styles.td,
                    textAlign: 'right',
                    fontWeight: 600,
                    fontFamily: 'monospace',
                    color: u.isPositive ? '#047857' : '#b91c1c'
                  }}>
                    {u.performanceFormatted || (u.performance ? `${u.performance >= 0 ? '+' : ''}${u.performance.toFixed(2)}%` : '-')}
                  </td>
                  <td style={{...styles.td, textAlign: 'center'}}>
                    {u.isWorstPerforming && (
                      <span style={{
                        background: '#fee2e2',
                        color: '#b91c1c',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 500
                      }}>
                        {tr.worst}
                      </span>
                    )}
                    {u.isBestPerforming && (
                      <span style={{
                        background: '#d1fae5',
                        color: '#047857',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 500
                      }}>
                        {tr.best}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Basket Performance Summary */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>📊 {tr.basketPerformance}</h2>
        <div style={{
          background: '#f8fafc',
          padding: '1.5rem',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.25rem' }}>
              {tr.referencePerformanceLbl} ({getReferenceLabel(participationParams.referencePerformance)})
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {t(lang, 'basedOnUnderlyings', { count: underlyings.length })}
            </div>
          </div>
          <div style={{
            fontSize: '2rem',
            fontWeight: 700,
            color: basketPerformance.isPositive ? '#047857' : '#b91c1c',
            fontFamily: 'monospace'
          }}>
            {basketPerformance.currentFormatted || `${basketPerformance.current >= 0 ? '+' : ''}${(basketPerformance.current || 0).toFixed(2)}%`}
          </div>
        </div>
      </div>

      {/* Performance Bar Chart */}
      {underlyings.length > 0 && (
        <div style={{...styles.section, pageBreakBefore: 'always'}}>
          <h2 style={styles.sectionTitle}>
            📊 {tr.performanceOverview}
            <span style={{
              fontSize: '0.75rem',
              background: 'linear-gradient(135deg, #1e3a5f 0%, #3b5998 100%)',
              color: 'white',
              padding: '3px 10px',
              borderRadius: '4px',
              fontWeight: 500,
              marginLeft: '0.75rem'
            }}>
              {tr.participationRate}: {participationParams.participationRateFormatted || `${participationParams.participationRate || 100}%`}
            </span>
          </h2>

          <div style={{
            background: '#f8fafc',
            padding: '1.5rem',
            borderRadius: '8px',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}>
              {underlyings.map((underlying, index) => {
                const performance = underlying.performance || 0;
                const minScale = -50;
                const maxPerformance = Math.max(...underlyings.map(u => u.performance || 0));
                const maxScale = Math.max(100, maxPerformance + 10);
                const totalRange = maxScale - minScale;
                const zeroPosition = (0 - minScale) / totalRange * 100;

                let barLeft = 0;
                let barWidth = 0;

                if (performance >= 0) {
                  barLeft = zeroPosition;
                  barWidth = Math.min(performance, maxScale) / totalRange * 100;
                } else {
                  const absPerf = Math.abs(performance);
                  barWidth = Math.min(absPerf, Math.abs(minScale)) / totalRange * 100;
                  barLeft = zeroPosition - barWidth;
                }

                return (
                  <div key={index} style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr 70px',
                    gap: '1rem',
                    alignItems: 'center'
                  }}>
                    <div style={{
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.ticker}
                      {underlying.isWorstPerforming && (
                        <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>⚠️</span>
                      )}
                      {underlying.isBestPerforming && (
                        <span style={{ fontSize: '0.75rem', color: '#10b981' }}>★</span>
                      )}
                    </div>

                    <div style={{
                      position: 'relative',
                      height: '32px',
                      background: 'white',
                      borderRadius: '4px',
                      border: '1px solid #e2e8f0'
                    }}>
                      <div style={{
                        position: 'absolute',
                        left: `${zeroPosition}%`,
                        top: 0,
                        bottom: 0,
                        width: '2px',
                        background: '#94a3b8',
                        zIndex: 1
                      }} />

                      <div style={{
                        position: 'absolute',
                        left: `${barLeft}%`,
                        top: '4px',
                        bottom: '4px',
                        width: `${barWidth}%`,
                        background: performance >= 0
                          ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
                          : 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
                        borderRadius: '3px',
                        zIndex: 3
                      }} />

                      {index === underlyings.length - 1 && (
                        <>
                          <div style={{
                            position: 'absolute',
                            left: '0%',
                            bottom: '-18px',
                            fontSize: '0.6rem',
                            color: '#64748b',
                            fontFamily: 'monospace'
                          }}>
                            {minScale}%
                          </div>
                          <div style={{
                            position: 'absolute',
                            left: `${zeroPosition}%`,
                            bottom: '-18px',
                            transform: 'translateX(-50%)',
                            fontSize: '0.6rem',
                            color: '#334155',
                            fontWeight: 600,
                            fontFamily: 'monospace'
                          }}>
                            0%
                          </div>
                          <div style={{
                            position: 'absolute',
                            right: '0%',
                            bottom: '-18px',
                            fontSize: '0.6rem',
                            color: '#64748b',
                            fontFamily: 'monospace'
                          }}>
                            +{Math.round(maxScale)}%
                          </div>
                        </>
                      )}
                    </div>

                    <div style={{
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: performance >= 0 ? '#10b981' : '#ef4444',
                      textAlign: 'right',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.performanceFormatted}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{
              marginTop: '2rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'center',
              gap: '1.5rem',
              fontSize: '0.7rem',
              color: '#475569',
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{
                  width: '16px',
                  height: '10px',
                  background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                  borderRadius: '2px'
                }} />
                <span>{tr.positivePerformance}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{
                  width: '16px',
                  height: '10px',
                  background: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
                  borderRadius: '2px'
                }} />
                <span>{tr.negativePerformance}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Participation Calculation */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>💫 {tr.participationCalculation}</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{tr.component}</th>
              <th style={{...styles.th, textAlign: 'right'}}>{tr.value}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}>{tr.rawBasketPerformance}</td>
              <td style={{
                ...styles.td,
                textAlign: 'right',
                fontWeight: 600,
                fontFamily: 'monospace',
                color: (participation.rawPerformance || 0) >= 0 ? '#047857' : '#b91c1c'
              }}>
                {participation.rawPerformanceFormatted || `${(participation.rawPerformance || 0) >= 0 ? '+' : ''}${(participation.rawPerformance || 0).toFixed(2)}%`}
              </td>
            </tr>
            <tr>
              <td style={styles.td}>{tr.participationRate}</td>
              <td style={{...styles.td, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace'}}>
                × {participation.participationRateFormatted || `${participation.participationRate || participationParams.participationRate || 100}%`}
              </td>
            </tr>
            <tr style={{background: '#f0f9ff'}}>
              <td style={{...styles.td, fontWeight: 700}}>{tr.participatedPerformance}</td>
              <td style={{
                ...styles.td,
                textAlign: 'right',
                fontWeight: 700,
                fontSize: '1.1rem',
                fontFamily: 'monospace',
                color: (participation.participatedPerformance || 0) >= 0 ? '#047857' : '#b91c1c'
              }}>
                {participation.participatedPerformanceFormatted || `${(participation.participatedPerformance || 0) >= 0 ? '+' : ''}${(participation.participatedPerformance || 0).toFixed(2)}%`}
              </td>
            </tr>
          </tbody>
        </table>
        {participation.formula && (
          <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem', fontStyle: 'italic' }}>
            {tr.formula}: {participation.formula}
          </p>
        )}
      </div>

      {/* Redemption Calculation */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>💰 {tr.redemptionValue}</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{tr.component}</th>
              <th style={{...styles.th, textAlign: 'right'}}>{tr.value}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}>{tr.baseCapital}</td>
              <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>100.00%</td>
            </tr>
            <tr>
              <td style={styles.td}>{tr.participatedPerformance}</td>
              <td style={{
                ...styles.td,
                textAlign: 'right',
                fontFamily: 'monospace',
                color: (participation.participatedPerformance || 0) >= 0 ? '#047857' : '#b91c1c'
              }}>
                {(participation.participatedPerformance || 0) >= 0 ? '+' : ''}{(participation.participatedPerformance || 0).toFixed(2)}%
              </td>
            </tr>
            {issuerCall.isCalled && issuerCall.rebate && (
              <tr>
                <td style={styles.td}>{tr.issuerCallRebate}</td>
                <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace', color: '#b45309'}}>
                  +{issuerCall.rebateFormatted || `${issuerCall.rebate}%`}
                </td>
              </tr>
            )}
            <tr style={{background: '#e8f4fc'}}>
              <td style={{...styles.td, fontWeight: 700}}>{tr.totalRedemption}</td>
              <td style={{...styles.td, textAlign: 'right', fontWeight: 700, fontSize: '1.25rem', color: '#1e3a5f', fontFamily: 'monospace'}}>
                {redemption.valueFormatted || `${(redemption.value || 100).toFixed(2)}%`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Indicative Value */}
      {indicativeValue && !issuerCall.isCalled && results.currentStatus?.productStatus === 'live' && (
        <div style={{...styles.section, pageBreakBefore: 'always'}}>
          <h2 style={styles.sectionTitle}>
            💹 {tr.indicativeValueIfMaturedToday}
          </h2>
          <p style={{fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem', fontStyle: 'italic'}}>
            {tr.hypotheticalCalculation}
          </p>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{tr.metric}</th>
                <th style={{...styles.th, textAlign: 'right'}}>{tr.value}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={styles.td}>{tr.baseCapital}</td>
                <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>100.00%</td>
              </tr>
              <tr>
                <td style={styles.td}>{tr.participatedReturn}</td>
                <td style={{
                  ...styles.td,
                  textAlign: 'right',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  color: (participation.participatedPerformance || 0) >= 0 ? '#047857' : '#b91c1c'
                }}>
                  {(participation.participatedPerformance || 0) >= 0 ? '+' : ''}{(participation.participatedPerformance || 0).toFixed(2)}%
                </td>
              </tr>
              <tr style={{background: '#e8f4fc'}}>
                <td style={{...styles.td, fontWeight: 700}}>{tr.totalTheoreticalValue}</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 700, fontSize: '1.25rem', color: '#1e3a5f', fontFamily: 'monospace'}}>
                  {indicativeValue.totalValueFormatted || redemption.valueFormatted || `${(redemption.value || 100).toFixed(2)}%`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Performance Chart */}
      {productId && (
        <div style={{...styles.section, pageBreakBefore: 'always'}}>
          <h2 style={styles.sectionTitle}>{tr.performanceEvolution}</h2>
          <div style={{height: '400px', marginTop: '1rem'}}>
            <StructuredProductChart productId={productId} height="400px" />
          </div>
        </div>
      )}

      {/* Product Parameters */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{tr.productParameters}</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{tr.parameter}</th>
              <th style={{...styles.th, textAlign: 'right'}}>{tr.value}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}>{tr.participationRate}</td>
              <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>{participationParams.participationRateFormatted || `${participationParams.participationRate || '-'}%`}</td>
            </tr>
            <tr>
              <td style={styles.td}>{tr.strikeLevel}</td>
              <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>{participationParams.strikeFormatted || `${participationParams.strike || 100}%`}</td>
            </tr>
            <tr>
              <td style={styles.td}>{tr.referencePerformanceLbl}</td>
              <td style={{...styles.td, textAlign: 'right', textTransform: 'capitalize'}}>{getReferenceLabel(participationParams.referencePerformance)}</td>
            </tr>
            <tr>
              <td style={styles.td}>{tr.issuerCallOption}</td>
              <td style={{...styles.td, textAlign: 'right'}}>
                {issuerCall.hasCallOption ? tr.yesCallable : tr.no}
              </td>
            </tr>
            <tr>
              <td style={styles.td}>{tr.notional}</td>
              <td style={{...styles.td, textAlign: 'right'}}>
                {displayProduct.notional ? `${displayProduct.currency || 'EUR'} ${displayProduct.notional.toLocaleString()}` : '-'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <p>{tr.generatedBy} • {new Date().toLocaleString(getLocale(lang))}</p>
        <p style={{fontSize: '0.75rem', color: '#9ca3af'}}>
          {tr.reportGeneratedOn} {formatDate(latestReport.evaluationDate || latestReport.createdAt)}
        </p>
      </div>
    </div>
    </>
  );
};

// Styles - Dark blue theme, printable, no CSS variables
const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    fontSize: '10pt',
    lineHeight: 1.4,
    color: '#1e293b',
    background: 'white',
    padding: '2rem',
    maxWidth: '297mm',
    margin: '0 auto',
    minHeight: '100vh'
  },
  loading: {
    padding: '2rem',
    textAlign: 'center',
    color: '#64748b',
    background: 'white',
    minHeight: '100vh'
  },
  header: {
    borderBottom: '3px solid #1e3a5f',
    paddingBottom: '1rem',
    marginBottom: '1.5rem',
    background: 'transparent',
    padding: '1.5rem',
    marginTop: '-2rem',
    marginLeft: '-2rem',
    marginRight: '-2rem',
    paddingLeft: '2rem',
    paddingRight: '2rem'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#0f172a',
    margin: 0,
    display: 'flex',
    alignItems: 'center'
  },
  headerMeta: {
    display: 'flex',
    gap: '2rem',
    marginTop: '0.5rem',
    fontSize: '0.9rem',
    color: '#334155',
    alignItems: 'center'
  },
  metaItem: {
    color: '#334155',
    fontWeight: 500
  },
  statusBadge: {
    padding: '3px 12px',
    borderRadius: '4px',
    fontWeight: 600,
    fontSize: '0.8rem'
  },
  section: {
    marginBottom: '1.5rem',
    background: 'white'
  },
  sectionTitle: {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#0f172a',
    marginBottom: '0.75rem',
    borderBottom: '2px solid #1e3a5f',
    paddingBottom: '0.5rem',
    background: 'linear-gradient(90deg, #f1f5f9 0%, transparent 100%)',
    padding: '0.5rem',
    marginLeft: '-0.5rem',
    paddingLeft: '0.5rem',
    borderRadius: '4px 0 0 0'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.9rem',
    boxShadow: '0 1px 3px rgba(30, 58, 95, 0.1)'
  },
  th: {
    background: 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)',
    padding: '0.75rem',
    textAlign: 'left',
    fontWeight: 600,
    color: 'white',
    borderBottom: '2px solid #1e3a5f'
  },
  td: {
    padding: '0.75rem',
    borderBottom: '1px solid #e2e8f0',
    color: '#1e293b',
    background: 'white'
  },
  footer: {
    marginTop: '2rem',
    paddingTop: '1rem',
    borderTop: '2px solid #1e3a5f',
    textAlign: 'center',
    color: '#475569',
    fontSize: '0.85rem',
    background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
    padding: '1rem',
    marginLeft: '-2rem',
    marginRight: '-2rem',
    marginBottom: '-2rem',
    paddingLeft: '2rem',
    paddingRight: '2rem'
  }
};

export default ParticipationNoteReportPDF;
