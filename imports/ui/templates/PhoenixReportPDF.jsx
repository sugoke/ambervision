import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ProductsCollection } from '../../api/products';
import { TemplateReportsCollection } from '../../api/templateReports';
import StructuredProductChart from '../components/StructuredProductChart.jsx';

/**
 * Phoenix Report PDF Template
 *
 * Clean, table-based layout specifically designed for PDF generation.
 * Uses explicit colors (no CSS variables) for reliable PDF rendering.
 */
const PhoenixReportPDF = ({ productId: propProductId }) => {
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

  // Validate PDF token if in PDF mode
  useEffect(() => {
    if (isPDFMode && pdfToken && pdfUserId) {
      console.log('[PhoenixReportPDF] Validating PDF authentication token...');
      Meteor.call('pdf.validateToken', pdfUserId, pdfToken, (error, result) => {
        if (error || !result.valid) {
          console.error('[PhoenixReportPDF] Token validation failed:', error?.reason || result?.reason);
          setPdfAuthState({ validated: false, error: error?.reason || result?.reason || 'Invalid token' });
        } else {
          console.log('[PhoenixReportPDF] PDF token validated successfully');
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
      // Force white background for PDF - override any dark theme
      document.body.style.cssText = 'background: white !important; background-color: white !important; min-height: 100vh;';
      document.documentElement.style.cssText = 'background: white !important; background-color: white !important;';

      // Also add a style element to override any other dark styles
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

    // In PDF mode, wait for authentication before subscribing
    if (isPDFMode && !pdfAuthState.validated) {
      console.log('[PhoenixReportPDF] Waiting for PDF auth validation...');
      return { product: null, latestReport: null, isLoading: true };
    }

    if (!productId) return { product: null, latestReport: null, isLoading: true };

    console.log('[PhoenixReportPDF] Subscribing with sessionId:', sessionId ? `${sessionId.substring(0, 20)}...` : 'null');

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
      // Wait for chart to render
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
  const phoenixParams = results.phoenixStructure || {};
  const underlyings = results.underlyings || [];
  const observationAnalysis = results.observationAnalysis || {};
  const basketAnalysis = results.basketAnalysis || {};
  const indicativeValue = results.indicativeMaturityValue || {};

  // Format date helper
  const formatDate = (date) => {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
              <span style={{ marginRight: '0.5rem' }}>🔥</span>
              {displayProduct.title || displayProduct.productName || 'Phoenix Autocallable Report'}
            </h1>
            <div style={styles.headerMeta}>
              <span style={styles.metaItem}>ISIN: {displayProduct.isin || '-'}</span>
              <span style={styles.metaItem}>Currency: {displayProduct.currency || 'EUR'}</span>
              <span style={{
                ...styles.statusBadge,
                background: results.currentStatus?.productStatus === 'live' ? '#d1fae5' : '#e5e7eb',
                color: results.currentStatus?.productStatus === 'live' ? '#047857' : '#374151'
              }}>
                {(results.currentStatus?.productStatus || 'unknown').toUpperCase()}
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

      {/* Product Timeline */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Product Timeline</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Trade Date</th>
              <th style={styles.th}>Value Date</th>
              <th style={styles.th}>Final Observation</th>
              <th style={styles.th}>Maturity</th>
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
          <h2 style={styles.sectionTitle}>💰 Product Market Price</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Price Type</th>
                <th style={{...styles.th, textAlign: 'right'}}>Value</th>
                <th style={{...styles.th, textAlign: 'right'}}>% of Nominal</th>
              </tr>
            </thead>
            <tbody>
              {(displayProduct.bidPrice || results.productPrice?.bid) && (
                <tr>
                  <td style={styles.td}>Bid Price</td>
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
                  <td style={styles.td}>Ask Price</td>
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
                  <td style={{...styles.td, fontWeight: 600}}>Mid Price</td>
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
                  <td style={styles.td}>Price Date</td>
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
          <h2 style={styles.sectionTitle}>Underlying Performance</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Ticker</th>
                <th style={styles.th}>Name</th>
                <th style={{...styles.th, textAlign: 'right'}}>Initial Price</th>
                <th style={{...styles.th, textAlign: 'right'}}>Current Price</th>
                <th style={{...styles.th, textAlign: 'right'}}>Performance</th>
                <th style={{...styles.th, textAlign: 'center'}}>Status</th>
              </tr>
            </thead>
            <tbody>
              {underlyings.map((u, i) => (
                <tr key={u.ticker || i} style={u.isWorstPerforming ? { background: '#fef2f2' } : {}}>
                  <td style={{...styles.td, fontWeight: 600}}>{u.ticker}</td>
                  <td style={styles.td}>{u.name || u.companyName || '-'}</td>
                  <td style={{...styles.td, textAlign: 'right'}}>{u.initialPriceFormatted || u.initialPrice?.toFixed(2) || '-'}</td>
                  <td style={{...styles.td, textAlign: 'right'}}>{u.currentPriceFormatted || u.currentPrice?.toFixed(2) || '-'}</td>
                  <td style={{
                    ...styles.td,
                    textAlign: 'right',
                    fontWeight: 600,
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
                        Worst
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Performance Bar Chart */}
      {underlyings.length > 0 && (
        <div style={{...styles.section, pageBreakBefore: 'always'}}>
          <h2 style={styles.sectionTitle}>
            📊 Performance Overview
            {phoenixParams.protectionBarrier && (
              <span style={{
                fontSize: '0.75rem',
                background: 'linear-gradient(135deg, #1e3a5f 0%, #3b5998 100%)',
                color: 'white',
                padding: '3px 10px',
                borderRadius: '4px',
                fontWeight: 500,
                marginLeft: '0.75rem'
              }}>
                Protection at {phoenixParams.protectionBarrier}%
              </span>
            )}
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
                const protectionBarrierLevel = phoenixParams.protectionBarrier || 70;
                const protectionBarrierPerformance = protectionBarrierLevel - 100;
                const minScale = Math.min(-50, protectionBarrierPerformance - 10);
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
                    {/* Ticker name */}
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
                    </div>

                    {/* Bar chart area */}
                    <div style={{
                      position: 'relative',
                      height: '32px',
                      background: 'white',
                      borderRadius: '4px',
                      border: '1px solid #e2e8f0'
                    }}>
                      {/* Zero line */}
                      <div style={{
                        position: 'absolute',
                        left: `${zeroPosition}%`,
                        top: 0,
                        bottom: 0,
                        width: '2px',
                        background: '#94a3b8',
                        zIndex: 1
                      }} />

                      {/* Protection barrier line */}
                      {phoenixParams.protectionBarrier && (
                        <div style={{
                          position: 'absolute',
                          left: `${(protectionBarrierPerformance - minScale) / totalRange * 100}%`,
                          top: '-4px',
                          bottom: '-4px',
                          width: '3px',
                          background: '#3b82f6',
                          zIndex: 2
                        }}>
                          {index === 0 && (
                            <div style={{
                              position: 'absolute',
                              top: '-18px',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              fontSize: '0.6rem',
                              color: '#3b82f6',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              background: '#f8fafc',
                              padding: '1px 4px',
                              borderRadius: '2px'
                            }}>
                              Barrier
                            </div>
                          )}
                        </div>
                      )}

                      {/* Performance bar */}
                      <div style={{
                        position: 'absolute',
                        left: `${barLeft}%`,
                        top: '4px',
                        bottom: '4px',
                        width: `${barWidth}%`,
                        background: underlying.barrierStatus === 'breached'
                          ? 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
                          : underlying.barrierStatus === 'near'
                            ? 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)'
                            : 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                        borderRadius: '3px',
                        zIndex: 3
                      }} />

                      {/* Scale markers on last row */}
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
                            {minScale >= 0 ? '+' : ''}{Math.round(minScale)}%
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

                    {/* Performance value */}
                    <div style={{
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: underlying.barrierStatus === 'breached'
                        ? '#ef4444'
                        : underlying.barrierStatus === 'near'
                          ? '#f59e0b'
                          : '#10b981',
                      textAlign: 'right',
                      fontFamily: 'monospace'
                    }}>
                      {underlying.performanceFormatted}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
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
                <span>Above Barrier (Safe)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{
                  width: '16px',
                  height: '10px',
                  background: 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)',
                  borderRadius: '2px'
                }} />
                <span>Near Barrier (Warning)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{
                  width: '16px',
                  height: '10px',
                  background: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
                  borderRadius: '2px'
                }} />
                <span>Below Barrier (Breached)</span>
              </div>
              {phoenixParams.protectionBarrier && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <div style={{
                    width: '3px',
                    height: '14px',
                    background: '#3b82f6'
                  }} />
                  <span>Protection Barrier ({phoenixParams.protectionBarrier}%)</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Barrier Status */}
      {basketAnalysis && (
        <div style={{...styles.section}}>
          <h2 style={styles.sectionTitle}>Barrier Status</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Barrier Type</th>
                <th style={{...styles.th, textAlign: 'right'}}>Level</th>
                <th style={{...styles.th, textAlign: 'right'}}>Distance to Barrier</th>
                <th style={{...styles.th, textAlign: 'center'}}>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={styles.td}>Autocall Barrier</td>
                <td style={{...styles.td, textAlign: 'right'}}>{phoenixParams.autocallBarrier || '-'}%</td>
                <td style={{
                  ...styles.td,
                  textAlign: 'right',
                  color: (basketAnalysis.distanceToAutocall || 0) >= 0 ? '#047857' : '#b91c1c'
                }}>
                  {basketAnalysis.distanceToAutocallFormatted || '-'}
                </td>
                <td style={{...styles.td, textAlign: 'center'}}>
                  <span style={{
                    background: basketAnalysis.autocallTriggered ? '#d1fae5' : '#fef3c7',
                    color: basketAnalysis.autocallTriggered ? '#047857' : '#b45309',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem'
                  }}>
                    {basketAnalysis.autocallTriggered ? 'Triggered' : 'Not Triggered'}
                  </span>
                </td>
              </tr>
              <tr>
                <td style={styles.td}>Protection Barrier</td>
                <td style={{...styles.td, textAlign: 'right'}}>{phoenixParams.protectionBarrier || '-'}%</td>
                <td style={{
                  ...styles.td,
                  textAlign: 'right',
                  color: (basketAnalysis.criticalDistance || 0) >= 0 ? '#047857' : '#b91c1c'
                }}>
                  {basketAnalysis.criticalDistanceFormatted || '-'}
                </td>
                <td style={{...styles.td, textAlign: 'center'}}>
                  <span style={{
                    background: basketAnalysis.breachedCount > 0 ? '#fee2e2' : '#d1fae5',
                    color: basketAnalysis.breachedCount > 0 ? '#b91c1c' : '#047857',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem'
                  }}>
                    {basketAnalysis.breachedCount > 0 ? 'Breached' : 'Protected'}
                  </span>
                </td>
              </tr>
              {phoenixParams.couponBarrier && (
                <tr>
                  <td style={styles.td}>Coupon Barrier</td>
                  <td style={{...styles.td, textAlign: 'right'}}>{phoenixParams.couponBarrier}%</td>
                  <td style={{...styles.td, textAlign: 'right'}}>-</td>
                  <td style={{...styles.td, textAlign: 'center'}}>-</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Coupon Summary */}
      {observationAnalysis && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Coupon Summary</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Metric</th>
                <th style={{...styles.th, textAlign: 'right'}}>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={styles.td}>Coupon Rate (per observation)</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>{phoenixParams.couponRate || '-'}%</td>
              </tr>
              <tr>
                <td style={styles.td}>Total Coupons Earned</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 600, color: '#047857'}}>
                  {observationAnalysis.totalCouponsEarnedFormatted || `${observationAnalysis.totalCouponsEarned || 0}%`}
                </td>
              </tr>
              <tr>
                <td style={styles.td}>Coupons in Memory</td>
                <td style={{...styles.td, textAlign: 'right', color: observationAnalysis.totalMemoryCoupons > 0 ? '#b45309' : '#6b7280'}}>
                  {observationAnalysis.totalMemoryCouponsFormatted || `${observationAnalysis.totalMemoryCoupons || 0}%`}
                </td>
              </tr>
              <tr>
                <td style={styles.td}>Observations Completed</td>
                <td style={{...styles.td, textAlign: 'right'}}>
                  {observationAnalysis.completedObservations || 0} / {observationAnalysis.totalObservations || 0}
                </td>
              </tr>
              <tr>
                <td style={styles.td}>Remaining Observations</td>
                <td style={{...styles.td, textAlign: 'right'}}>{observationAnalysis.remainingObservations || 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Indicative Value */}
      {indicativeValue && indicativeValue.isLive && (
        <div style={{...styles.section, pageBreakBefore: 'always'}}>
          <h2 style={styles.sectionTitle}>
            💹 Indicative Value (If Matured Today)
          </h2>
          <p style={{fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem', fontStyle: 'italic'}}>
            This is a hypothetical calculation based on current market prices.
          </p>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Metric</th>
                <th style={{...styles.th, textAlign: 'right'}}>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={styles.td}>Capital Return</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>
                  {indicativeValue.capitalReturnFormatted || `${indicativeValue.capitalReturn || 100}%`}
                </td>
              </tr>
              <tr>
                <td style={styles.td}>Accumulated Coupons</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 600, color: '#047857'}}>
                  {indicativeValue.totalCouponsFormatted || `${indicativeValue.totalCoupons || 0}%`}
                </td>
              </tr>
              <tr style={{background: '#e8f4fc'}}>
                <td style={{...styles.td, fontWeight: 700}}>Total Theoretical Return</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 700, fontSize: '1.25rem', color: '#1e3a5f'}}>
                  {indicativeValue.totalValueFormatted || `${indicativeValue.totalValue || 100}%`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Performance Chart */}
      {productId && (
        <div style={{...styles.section, pageBreakBefore: 'always'}}>
          <h2 style={styles.sectionTitle}>Performance Evolution</h2>
          <div style={{height: '400px', marginTop: '1rem'}}>
            <StructuredProductChart productId={productId} height="400px" />
          </div>
        </div>
      )}

      {/* Observation Schedule */}
      {observationAnalysis.observations && observationAnalysis.observations.length > 0 && (
        <div style={{...styles.section, pageBreakBefore: 'always'}}>
          <h2 style={styles.sectionTitle}>Observation Schedule</h2>
          <table style={{...styles.table, fontSize: '0.8rem'}}>
            <thead>
              <tr>
                <th style={{...styles.th, width: '30px'}}>#</th>
                <th style={{...styles.th, width: '90px'}}>Obs Date</th>
                <th style={{...styles.th, width: '90px'}}>Payment</th>
                <th style={{...styles.th, textAlign: 'center', width: '70px'}}>Type</th>
                <th style={{...styles.th, textAlign: 'right', width: '70px'}}>Autocall</th>
                <th style={{...styles.th, textAlign: 'right', width: '70px'}}>Coupon</th>
                <th style={{...styles.th, textAlign: 'center', width: '60px'}}>Memory</th>
                <th style={{...styles.th, textAlign: 'center', width: '70px'}}>Status</th>
              </tr>
            </thead>
            <tbody>
              {observationAnalysis.observations.map((obs, i) => {
                const isFinal = i === observationAnalysis.observations.length - 1;
                return (
                  <tr key={i} style={{
                    background: obs.isNext ? '#fef3c7' :
                               obs.status === 'completed' && obs.couponEarned ? '#d1fae5' :
                               'transparent'
                  }}>
                    <td style={{...styles.td, fontWeight: 600}}>{i + 1}</td>
                    <td style={styles.td}>{obs.observationDateFormatted || obs.dateFormatted || formatDate(obs.observationDate || obs.date)}</td>
                    <td style={styles.td}>{obs.paymentDateFormatted || formatDate(obs.paymentDate) || '-'}</td>
                    <td style={{...styles.td, textAlign: 'center'}}>
                      <span style={{
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        background: isFinal ? '#fef3c7' : '#e0f2fe',
                        color: isFinal ? '#b45309' : '#0369a1'
                      }}>
                        {isFinal ? 'Final' : 'Obs'}
                      </span>
                    </td>
                    <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>{obs.autocallLevel || phoenixParams.autocallBarrier || '-'}%</td>
                    <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>{obs.couponRate || phoenixParams.couponRate || '-'}%</td>
                    <td style={{...styles.td, textAlign: 'center'}}>
                      {obs.hasMemory || observationAnalysis.hasMemoryCoupon ? 'Yes' : 'No'}
                    </td>
                    <td style={{...styles.td, textAlign: 'center'}}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 500,
                        background: obs.status === 'completed' ? (obs.couponEarned ? '#d1fae5' : '#fee2e2') :
                                   obs.isNext ? '#fef3c7' : '#f3f4f6',
                        color: obs.status === 'completed' ? (obs.couponEarned ? '#047857' : '#b91c1c') :
                               obs.isNext ? '#b45309' : '#6b7280'
                      }}>
                        {obs.status === 'completed' ? (obs.couponEarned ? 'Paid' : 'Missed') :
                         obs.isNext ? 'Next' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Product Parameters */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Product Parameters</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Parameter</th>
              <th style={{...styles.th, textAlign: 'right'}}>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}>Autocall Barrier</td>
              <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>{phoenixParams.autocallBarrier || '-'}%</td>
            </tr>
            <tr>
              <td style={styles.td}>Protection Barrier</td>
              <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>{phoenixParams.protectionBarrier || '-'}%</td>
            </tr>
            <tr>
              <td style={styles.td}>Memory Coupon Rate</td>
              <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>{phoenixParams.couponRate || '-'}%</td>
            </tr>
            <tr>
              <td style={styles.td}>Observation Frequency</td>
              <td style={{...styles.td, textAlign: 'right', textTransform: 'capitalize'}}>{phoenixParams.observationFrequency || '-'}</td>
            </tr>
            <tr>
              <td style={styles.td}>Notional</td>
              <td style={{...styles.td, textAlign: 'right'}}>
                {displayProduct.notional ? `${displayProduct.currency || 'EUR'} ${displayProduct.notional.toLocaleString()}` : '-'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <p>Generated by Amberlake Partners • {new Date().toLocaleString()}</p>
        <p style={{fontSize: '0.75rem', color: '#9ca3af'}}>
          Report generated on {formatDate(latestReport.evaluationDate || latestReport.createdAt)}
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
    maxWidth: '297mm', // A4 landscape width
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

export default PhoenixReportPDF;
