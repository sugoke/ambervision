import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ProductsCollection } from '../../api/products';
import { TemplateReportsCollection } from '../../api/templateReports';
import StructuredProductChart from '../components/StructuredProductChart.jsx';

/**
 * Twin Win Report PDF Template
 *
 * Clean, table-based layout designed for PDF generation. Uses explicit colors
 * (no CSS variables) for reliable PDF rendering. Pure display of pre-computed values.
 * Mirrors ParticipationNoteReportPDF.jsx.
 */
const TwinWinReportPDF = ({ productId: propProductId }) => {
  const [isReady, setIsReady] = useState(false);

  const productId = propProductId || (typeof window !== 'undefined'
    ? window.location.pathname.split('/').pop()
    : null);

  const [pdfAuthState, setPdfAuthState] = useState({ validated: false, error: null });
  const [currentSessionId, setCurrentSessionId] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null
  );

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isPDFMode = urlParams?.get('pdfToken') != null;
  const pdfToken = urlParams?.get('pdfToken');
  const pdfUserId = urlParams?.get('userId');
  const lang = urlParams?.get('lang') || 'en';

  // Validate PDF token if in PDF mode
  useEffect(() => {
    if (isPDFMode && pdfToken && pdfUserId) {
      Meteor.call('pdf.validateToken', pdfUserId, pdfToken, (error, result) => {
        if (error || !result.valid) {
          console.error('[TwinWinReportPDF] Token validation failed:', error?.reason || result?.reason);
          setPdfAuthState({ validated: false, error: error?.reason || result?.reason || 'Invalid token' });
        } else {
          setPdfAuthState({ validated: true, error: null });
          const tempSessionId = `pdf-temp-${pdfToken}`;
          localStorage.setItem('sessionId', tempSessionId);
          localStorage.setItem('pdfTempSession', 'true');
          setCurrentSessionId(tempSessionId);
        }
      });
    }
    return () => {
      if (localStorage.getItem('pdfTempSession') === 'true') {
        localStorage.removeItem('sessionId');
        localStorage.removeItem('pdfTempSession');
        setCurrentSessionId(null);
      }
    };
  }, [isPDFMode, pdfToken, pdfUserId]);

  // Force white background for PDF
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
          body::before, body::after { display: none !important; }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
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

  const { product, latestReport, isLoading } = useTracker(() => {
    const sessionId = currentSessionId;

    if (isPDFMode && !pdfAuthState.validated) {
      return { product: null, latestReport: null, isLoading: true };
    }
    if (!productId) return { product: null, latestReport: null, isLoading: true };

    const productSub = Meteor.subscribe('products.single', productId, sessionId);
    const reportsSub = Meteor.subscribe('templateReports.forProduct', productId, sessionId);

    const prod = ProductsCollection.findOne(productId);
    const report = TemplateReportsCollection.findOne({ productId }, { sort: { createdAt: -1 } });

    return {
      product: prod,
      latestReport: report,
      isLoading: !productSub.ready() || !reportsSub.ready()
    };
  }, [productId, currentSessionId, isPDFMode, pdfAuthState.validated]);

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
        : (pdfAuthState.validated ? 'Loading product data...' : 'Authenticating PDF session...'))
      : 'Loading product report...';
    return (
      <div style={styles.loading}>
        <p>{loadingMessage}</p>
      </div>
    );
  }

  if (!product || !latestReport) {
    return (
      <div style={styles.loading}>
        <p>Report not found</p>
      </div>
    );
  }

  const results = latestReport.templateResults || {};
  const displayProduct = product.displayProduct || product;
  const params = results.twinWinStructure || {};
  const underlyings = results.underlyings || [];
  const basketPerformance = results.basketPerformance || {};
  const redemption = results.redemption || {};
  const barriers = results.barriers || {};

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const status = results.currentStatus?.productStatus || 'unknown';

  return (
    <>
      <style>{`
        html, body, #react-target { background: white !important; background-color: white !important; }
        .fixed-bg-light, .fixed-bg-dark { display: none !important; }
      `}</style>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <h1 style={styles.title}>
                <span style={{ marginRight: '0.5rem' }}>🔁</span>
                {displayProduct.title || displayProduct.productName || 'Twin Win Report'}
              </h1>
              <div style={styles.headerMeta}>
                <span style={styles.metaItem}>ISIN: {displayProduct.isin || '-'}</span>
                <span style={styles.metaItem}>Currency: {displayProduct.currency || 'USD'}</span>
                <span style={{
                  ...styles.statusBadge,
                  background: status === 'live' ? '#d1fae5' : '#e5e7eb',
                  color: status === 'live' ? '#047857' : '#374151'
                }}>
                  {status.toUpperCase()}
                </span>
              </div>
            </div>
            <img
              src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png"
              alt="Amberlake Partners"
              style={{ height: '40px', width: 'auto', marginLeft: '1rem' }}
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
                <th style={styles.th}>Maturity Date</th>
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

        {/* Structure */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Twin Win Structure</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Parameter</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={styles.td}>Capital Protection</td><td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{params.capitalProtectionFormatted}</td></tr>
              <tr><td style={styles.td}>Bonus (floor)</td><td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{params.bonusFormatted}</td></tr>
              <tr><td style={styles.td}>Lower Barrier</td><td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{params.lowerBarrierFormatted}</td></tr>
              <tr><td style={styles.td}>Upper Barrier</td><td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{params.upperBarrierFormatted}</td></tr>
              <tr><td style={styles.td}>Barrier Observation</td><td style={{ ...styles.td, textAlign: 'right' }}>{params.barrierTypeLabel}</td></tr>
              <tr><td style={styles.td}>Aggregation</td><td style={{ ...styles.td, textAlign: 'right' }}>{params.basketTypeLabel}</td></tr>
              <tr style={{ background: '#f0f9ff' }}>
                <td style={{ ...styles.td, fontWeight: 700 }}>Minimum Redemption</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: '#1e3a5f' }}>{params.minRedemptionFormatted}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Underlying Performance */}
        {underlyings.length > 0 && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Underlying Performance</h2>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Ticker</th>
                  <th style={styles.th}>Name</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Initial</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Current</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Performance</th>
                </tr>
              </thead>
              <tbody>
                {underlyings.map((u, i) => (
                  <tr key={u.ticker || i}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{u.ticker}</td>
                    <td style={styles.td}>{u.name || '-'}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace' }}>{u.initialPriceFormatted || '-'}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace' }}>{u.currentPriceFormatted || '-'}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace', color: u.isPositive ? '#047857' : '#b91c1c' }}>
                      {u.performanceFormatted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Barrier Monitoring */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Barrier Monitoring ({barriers.typeLabel})</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Barrier</th>
                <th style={styles.th}>Status</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Touched On</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={styles.td}>Lower Barrier ({params.lowerBarrierFormatted})</td>
                <td style={{ ...styles.td, fontWeight: 600, color: barriers.lowerTouched ? '#b45309' : '#047857' }}>{barriers.lowerStatusLabel}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{barriers.lowerTouchDateFormatted || '-'}</td>
              </tr>
              <tr>
                <td style={styles.td}>Upper Barrier ({params.upperBarrierFormatted})</td>
                <td style={{ ...styles.td, fontWeight: 600, color: barriers.upperTouched ? '#b45309' : '#047857' }}>{barriers.upperStatusLabel}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{barriers.upperTouchDateFormatted || '-'}</td>
              </tr>
              <tr style={{ background: '#f8fafc' }}>
                <td style={{ ...styles.td, fontWeight: 700 }}>Basket Performance</td>
                <td style={{ ...styles.td, fontWeight: 700, fontFamily: 'monospace', color: basketPerformance.isPositive ? '#047857' : '#b91c1c' }} colSpan={2}>
                  {basketPerformance.currentFormatted}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Redemption */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Redemption Value — {redemption.scenarioLabel}</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Component</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={styles.td}>Capital Return</td>
                <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace' }}>{redemption.capitalComponentFormatted}</td>
              </tr>
              <tr>
                <td style={styles.td}>Participation / Bonus</td>
                <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace', color: (redemption.participationComponent || 0) >= 0 ? '#047857' : '#b91c1c' }}>
                  {redemption.participationComponentFormatted}
                </td>
              </tr>
              <tr style={{ background: '#e8f4fc' }}>
                <td style={{ ...styles.td, fontWeight: 700 }}>Total Redemption</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, fontSize: '1.25rem', color: '#1e3a5f', fontFamily: 'monospace' }}>
                  {redemption.totalValueFormatted}
                </td>
              </tr>
            </tbody>
          </table>
          {redemption.formula && (
            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem', fontStyle: 'italic' }}>
              Formula: {redemption.formula}
            </p>
          )}
        </div>

        {/* Performance Chart */}
        {productId && (
          <div style={{ ...styles.section, pageBreakBefore: 'always' }}>
            <h2 style={styles.sectionTitle}>Performance Evolution</h2>
            <div style={{ height: '400px', marginTop: '1rem' }}>
              <StructuredProductChart productId={productId} height="400px" />
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={styles.footer}>
          <p>Generated by Amberlake Partners • {new Date().toLocaleString('en-US')}</p>
          <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
            Report generated on {formatDate(latestReport.evaluationDate || latestReport.createdAt)}
          </p>
        </div>
      </div>
    </>
  );
};

// Styles — dark blue theme, printable, no CSS variables
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
  loading: { padding: '2rem', textAlign: 'center', color: '#64748b', background: 'white', minHeight: '100vh' },
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
  title: { fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center' },
  headerMeta: { display: 'flex', gap: '2rem', marginTop: '0.5rem', fontSize: '0.9rem', color: '#334155', alignItems: 'center' },
  metaItem: { color: '#334155', fontWeight: 500 },
  statusBadge: { padding: '3px 12px', borderRadius: '4px', fontWeight: 600, fontSize: '0.8rem' },
  section: { marginBottom: '1.5rem', background: 'white' },
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
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', boxShadow: '0 1px 3px rgba(30, 58, 95, 0.1)' },
  th: {
    background: 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)',
    padding: '0.75rem',
    textAlign: 'left',
    fontWeight: 600,
    color: 'white',
    borderBottom: '2px solid #1e3a5f'
  },
  td: { padding: '0.75rem', borderBottom: '1px solid #e2e8f0', color: '#1e293b', background: 'white' },
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

export default TwinWinReportPDF;
