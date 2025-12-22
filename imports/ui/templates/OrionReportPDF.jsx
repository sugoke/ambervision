import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ProductsCollection } from '../../api/products';
import { TemplateReportsCollection } from '../../api/templateReports';
import StructuredProductChart from '../components/StructuredProductChart.jsx';

/**
 * Orion Report PDF Template
 *
 * Clean, table-based layout specifically designed for PDF generation.
 * Uses explicit colors (no CSS variables) for reliable PDF rendering.
 */
const OrionReportPDF = ({ productId: propProductId }) => {
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
      console.log('[OrionReportPDF] Validating PDF authentication token...');
      Meteor.call('pdf.validateToken', pdfUserId, pdfToken, (error, result) => {
        if (error || !result.valid) {
          console.error('[OrionReportPDF] Token validation failed:', error?.reason || result?.reason);
          setPdfAuthState({ validated: false, error: error?.reason || result?.reason || 'Invalid token' });
        } else {
          console.log('[OrionReportPDF] PDF token validated successfully');
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
      console.log('[OrionReportPDF] Waiting for PDF auth validation...');
      return { product: null, latestReport: null, isLoading: true };
    }

    if (!productId) return { product: null, latestReport: null, isLoading: true };

    console.log('[OrionReportPDF] Subscribing with sessionId:', sessionId ? `${sessionId.substring(0, 20)}...` : 'null');

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
  const orionParams = results.orionStructure || {};
  const underlyings = results.underlyings || [];
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
              <span style={{ marginRight: '0.5rem' }}>⭐</span>
              {displayProduct.title || displayProduct.productName || 'Orion Memory Report'}
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

      {/* Underlying Performance with Considered Performance */}
      {underlyings.length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>📊 Underlying Assets Performance</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Ticker</th>
                <th style={styles.th}>Name</th>
                <th style={{...styles.th, textAlign: 'right'}}>Initial</th>
                <th style={{...styles.th, textAlign: 'right'}}>Current</th>
                <th style={{...styles.th, textAlign: 'right'}}>Performance</th>
                <th style={{...styles.th, textAlign: 'right'}}>Considered</th>
                <th style={{...styles.th, textAlign: 'center'}}>Upper Barrier</th>
              </tr>
            </thead>
            <tbody>
              {underlyings.map((u, i) => {
                const consideredPerf = u.consideredPerformance || 0;
                const consideredIsPositive = consideredPerf >= 0;
                return (
                  <tr key={u.ticker || i} style={u.isWorstPerforming ? { background: '#fef2f2' } : {}}>
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
                    <td style={{
                      ...styles.td,
                      textAlign: 'right',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: consideredIsPositive ? '#047857' : '#b91c1c',
                      background: consideredIsPositive ? '#d1fae5' : '#fee2e2'
                    }}>
                      {u.consideredPerformanceFormatted || `${consideredPerf >= 0 ? '+' : ''}${consideredPerf.toFixed(2)}%`}
                    </td>
                    <td style={{...styles.td, textAlign: 'center'}}>
                      {u.hitUpperBarrier ? (
                        <span style={{
                          background: '#d1fae5',
                          color: '#047857',
                          padding: '3px 10px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600
                        }}>
                          ✓ HIT
                        </span>
                      ) : (
                        <span style={{
                          background: '#f3f4f6',
                          color: '#6b7280',
                          padding: '3px 10px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 500
                        }}>
                          Not Hit
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Basket Considered Performance Summary */}
      {results.basketConsideredPerformanceFormatted && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>📈 Basket Considered Performance</h2>
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
                Average of Considered Performances
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                Capped at rebate ({orionParams.rebate}%) if upper barrier ({orionParams.upperBarrier}%) is hit
              </div>
            </div>
            <div style={{
              fontSize: '2rem',
              fontWeight: 700,
              color: results.basketConsideredPerformance >= 0 ? '#047857' : '#b91c1c',
              fontFamily: 'monospace'
            }}>
              {results.basketConsideredPerformanceFormatted}
            </div>
          </div>
        </div>
      )}

      {/* Performance Bar Chart */}
      {underlyings.length > 0 && (
        <div style={{...styles.section, pageBreakBefore: 'always'}}>
          <h2 style={styles.sectionTitle}>
            📊 Performance Overview
            {orionParams.lowerBarrier && (
              <span style={{
                fontSize: '0.75rem',
                background: 'linear-gradient(135deg, #1e3a5f 0%, #3b5998 100%)',
                color: 'white',
                padding: '3px 10px',
                borderRadius: '4px',
                fontWeight: 500,
                marginLeft: '0.75rem'
              }}>
                Protection at {orionParams.lowerBarrier}%
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
                const protectionBarrierLevel = orionParams.lowerBarrier || 70;
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
                      {underlying.hitUpperBarrier && (
                        <span style={{ fontSize: '0.7rem', color: '#10b981' }}>✓</span>
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

                      {orionParams.lowerBarrier && (
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
                              Protection
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{
                        position: 'absolute',
                        left: `${barLeft}%`,
                        top: '4px',
                        bottom: '4px',
                        width: `${barWidth}%`,
                        background: underlying.hitUpperBarrier
                          ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
                          : performance >= 0
                            ? 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)'
                            : 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)',
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

                    <div style={{
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: performance >= 0 ? '#10b981' : '#f59e0b',
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
                <span>Upper Barrier Hit (Capped)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{
                  width: '16px',
                  height: '10px',
                  background: 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)',
                  borderRadius: '2px'
                }} />
                <span>Positive (Uncapped)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{
                  width: '16px',
                  height: '10px',
                  background: 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)',
                  borderRadius: '2px'
                }} />
                <span>Negative Performance</span>
              </div>
              {orionParams.lowerBarrier && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <div style={{
                    width: '3px',
                    height: '14px',
                    background: '#3b82f6'
                  }} />
                  <span>Protection Barrier ({orionParams.lowerBarrier}%)</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Barrier Status */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Barrier Status</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Barrier Type</th>
              <th style={{...styles.th, textAlign: 'right'}}>Level</th>
              <th style={{...styles.th, textAlign: 'center'}}>Description</th>
              <th style={{...styles.th, textAlign: 'center'}}>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}>Upper Barrier (Cap)</td>
              <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>{orionParams.upperBarrier || '-'}%</td>
              <td style={{...styles.td, textAlign: 'center', fontSize: '0.8rem', color: '#64748b'}}>
                Performance capped at rebate if hit
              </td>
              <td style={{...styles.td, textAlign: 'center'}}>
                <span style={{
                  background: indicativeValue.hitBarrierCount > 0 ? '#d1fae5' : '#f3f4f6',
                  color: indicativeValue.hitBarrierCount > 0 ? '#047857' : '#6b7280',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem'
                }}>
                  {indicativeValue.hitBarrierCount || 0}/{indicativeValue.totalUnderlyings || underlyings.length} Hit
                </span>
              </td>
            </tr>
            <tr>
              <td style={styles.td}>Lower Barrier (Protection)</td>
              <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>{orionParams.lowerBarrier || '-'}%</td>
              <td style={{...styles.td, textAlign: 'center', fontSize: '0.8rem', color: '#64748b'}}>
                Capital protection level
              </td>
              <td style={{...styles.td, textAlign: 'center'}}>
                <span style={{
                  background: indicativeValue.protectionIntact ? '#d1fae5' : '#fee2e2',
                  color: indicativeValue.protectionIntact ? '#047857' : '#b91c1c',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem'
                }}>
                  {indicativeValue.protectionIntact ? 'Protected' : 'Breached'}
                </span>
              </td>
            </tr>
            <tr>
              <td style={styles.td}>Rebate Value</td>
              <td style={{...styles.td, textAlign: 'right', fontFamily: 'monospace'}}>{orionParams.rebate || '-'}%</td>
              <td style={{...styles.td, textAlign: 'center', fontSize: '0.8rem', color: '#64748b'}}>
                Capped upside per underlying
              </td>
              <td style={{...styles.td, textAlign: 'center'}}>-</td>
            </tr>
          </tbody>
        </table>
      </div>

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
                <td style={styles.td}>Basket Considered Performance</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace', color: indicativeValue.basketPerformance >= 0 ? '#047857' : '#b91c1c'}}>
                  {indicativeValue.basketPerformanceFormatted || `${indicativeValue.basketPerformance || 0}%`}
                </td>
              </tr>
              <tr>
                <td style={styles.td}>Worst Performer</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace', color: indicativeValue.worstPerformer >= 0 ? '#047857' : '#b91c1c'}}>
                  {indicativeValue.worstPerformerFormatted || `${indicativeValue.worstPerformer || 0}%`}
                </td>
              </tr>
              <tr>
                <td style={styles.td}>Upper Barrier Hits</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>
                  {indicativeValue.hitBarrierCount || 0} / {indicativeValue.totalUnderlyings || underlyings.length}
                </td>
              </tr>
              <tr>
                <td style={styles.td}>Capital Return</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace'}}>
                  {indicativeValue.capitalReturnFormatted || `${indicativeValue.capitalReturn || 100}%`}
                </td>
              </tr>
              <tr style={{background: '#e8f4fc'}}>
                <td style={{...styles.td, fontWeight: 700}}>Total Theoretical Return</td>
                <td style={{...styles.td, textAlign: 'right', fontWeight: 700, fontSize: '1.25rem', color: '#1e3a5f', fontFamily: 'monospace'}}>
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
              <td style={styles.td}>Upper Barrier (Cap)</td>
              <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>{orionParams.upperBarrier || '-'}%</td>
            </tr>
            <tr>
              <td style={styles.td}>Rebate Value</td>
              <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>{orionParams.rebate || '-'}%</td>
            </tr>
            <tr>
              <td style={styles.td}>Lower Barrier (Protection)</td>
              <td style={{...styles.td, textAlign: 'right', fontWeight: 600}}>{orionParams.lowerBarrier || '-'}%</td>
            </tr>
            <tr>
              <td style={styles.td}>Observation Frequency</td>
              <td style={{...styles.td, textAlign: 'right', textTransform: 'capitalize'}}>{orionParams.observationFrequency || '-'}</td>
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

export default OrionReportPDF;
