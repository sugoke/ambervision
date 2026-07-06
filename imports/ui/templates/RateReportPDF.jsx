import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ProductsCollection } from '../../api/products';
import { TemplateReportsCollection } from '../../api/templateReports';
import StructuredProductChart from '../components/StructuredProductChart.jsx';

/**
 * Rate Report PDF Template (CMS Steepener / Target-Redemption certificate).
 * Clean table-based layout, explicit colors for reliable PDF rendering.
 * Mirrors TwinWinReportPDF.jsx / ParticipationNoteReportPDF.jsx.
 */
const RateReportPDF = ({ productId: propProductId }) => {
  const [isReady, setIsReady] = useState(false);

  const productId = propProductId || (typeof window !== 'undefined'
    ? window.location.pathname.split('/').pop() : null);

  const [pdfAuthState, setPdfAuthState] = useState({ validated: false, error: null });
  const [currentSessionId, setCurrentSessionId] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null);

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isPDFMode = urlParams?.get('pdfToken') != null;
  const pdfToken = urlParams?.get('pdfToken');
  const pdfUserId = urlParams?.get('userId');

  useEffect(() => {
    if (isPDFMode && pdfToken && pdfUserId) {
      Meteor.call('pdf.validateToken', pdfUserId, pdfToken, (error, result) => {
        if (error || !result.valid) {
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
          html, body, #react-target, .main-content, .App { background: white !important; background-color: white !important; }
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
    if (isPDFMode && !pdfAuthState.validated) return { product: null, latestReport: null, isLoading: true };
    if (!productId) return { product: null, latestReport: null, isLoading: true };

    const productSub = Meteor.subscribe('products.single', productId, sessionId);
    const reportsSub = Meteor.subscribe('templateReports.forProduct', productId, sessionId);
    const prod = ProductsCollection.findOne(productId);
    const report = TemplateReportsCollection.findOne({ productId }, { sort: { createdAt: -1 } });
    return { product: prod, latestReport: report, isLoading: !productSub.ready() || !reportsSub.ready() };
  }, [productId, currentSessionId, isPDFMode, pdfAuthState.validated]);

  useEffect(() => {
    if (!isLoading && product && latestReport) {
      setTimeout(() => {
        setIsReady(true);
        if (typeof document !== 'undefined') document.body.setAttribute('data-pdf-ready', 'true');
      }, 2000);
    }
  }, [isLoading, product, latestReport]);

  if (isLoading) {
    const loadingMessage = isPDFMode
      ? (pdfAuthState.error ? `Authentication failed: ${pdfAuthState.error}`
        : (pdfAuthState.validated ? 'Loading product data...' : 'Authenticating PDF session...'))
      : 'Loading product report...';
    return <div style={styles.loading}><p>{loadingMessage}</p></div>;
  }
  if (!product || !latestReport) {
    return <div style={styles.loading}><p>Report not found</p></div>;
  }

  const results = latestReport.templateResults || {};
  const displayProduct = product.displayProduct || product;
  const s = results.rateStructure || {};
  const schedule = results.schedule || {};
  const periods = schedule.periods || [];
  const target = results.targetRedemption || {};
  const redemption = results.redemption || {};
  const referenceRates = results.referenceRates || [];
  const status = results.currentStatus?.productStatus || 'live';

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  const statusLabel = (st) => ({ paid: 'Paid', upcoming: 'Upcoming', pending_fixing: 'Pending fixing', redeemed: 'Redeemed', cancelled: 'Cancelled' }[st] || st);

  return (
    <>
      <style>{`html, body, #react-target { background: white !important; } .fixed-bg-light, .fixed-bg-dark { display: none !important; }`}</style>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <h1 style={styles.title}><span style={{ marginRight: '0.5rem' }}>📈</span>{displayProduct.title || 'Rate Certificate'}</h1>
              <div style={styles.headerMeta}>
                <span style={styles.metaItem}>ISIN: {displayProduct.isin || '-'}</span>
                <span style={styles.metaItem}>Currency: {displayProduct.currency || 'EUR'}</span>
                <span style={{ ...styles.statusBadge, background: status === 'live' ? '#d1fae5' : '#fef3c7', color: status === 'live' ? '#047857' : '#b45309' }}>{status.toUpperCase()}</span>
              </div>
            </div>
            <img src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png" alt="Amberlake Partners" style={{ height: '40px', width: 'auto', marginLeft: '1rem' }} />
          </div>
        </div>

        {/* Structure */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Product Structure</h2>
          <table style={styles.table}>
            <tbody>
              <tr><td style={styles.td}>Capital Protection</td><td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{s.capitalProtectionFormatted}</td></tr>
              <tr><td style={styles.td}>Target Coupon</td><td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{s.targetCouponFormatted}</td></tr>
              <tr><td style={styles.td}>Fixed Coupon (first {s.fixedPeriods} periods)</td><td style={{ ...styles.td, textAlign: 'right' }}>{s.fixedCouponRateFormatted}</td></tr>
              <tr><td style={styles.td}>Floating Coupon</td><td style={{ ...styles.td, textAlign: 'right' }}>{s.floatingFormulaLabel}</td></tr>
              <tr><td style={styles.td}>Frequency</td><td style={{ ...styles.td, textAlign: 'right' }}>{s.couponFrequencyLabel}</td></tr>
              <tr><td style={styles.td}>Reference Rates</td><td style={{ ...styles.td, textAlign: 'right' }}>{referenceRates.map(r => r.name).join(', ') || '-'}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Timeline */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Timeline</h2>
          <table style={styles.table}>
            <thead><tr><th style={styles.th}>Trade Date</th><th style={styles.th}>Issue Date</th><th style={styles.th}>Final Observation</th><th style={styles.th}>Maturity</th></tr></thead>
            <tbody><tr>
              <td style={styles.td}>{fmtDate(displayProduct.tradeDate)}</td>
              <td style={styles.td}>{fmtDate(displayProduct.valueDate)}</td>
              <td style={styles.td}>{fmtDate(displayProduct.finalObservation)}</td>
              <td style={styles.td}>{fmtDate(displayProduct.maturityDate)}</td>
            </tr></tbody>
          </table>
        </div>

        {/* Target progress */}
        {s.targetEnabled && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Target Redemption — {target.statusLabel}</h2>
            <table style={styles.table}>
              <tbody>
                <tr><td style={styles.td}>Cumulative (known)</td><td style={{ ...styles.td, textAlign: 'right', fontWeight: 600 }}>{schedule.knownCumulativeFormatted}</td></tr>
                <tr><td style={styles.td}>Target</td><td style={{ ...styles.td, textAlign: 'right' }}>{s.targetCouponFormatted}</td></tr>
                <tr><td style={styles.td}>Progress</td><td style={{ ...styles.td, textAlign: 'right' }}>{schedule.targetProgressFormatted}</td></tr>
                {target.reached && <tr style={{ background: '#fef3c7' }}><td style={{ ...styles.td, fontWeight: 700 }}>Early redemption</td><td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{target.redemptionDateFormatted}</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* Coupon Schedule */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Coupon Schedule</h2>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>#</th><th style={styles.th}>Observation</th><th style={styles.th}>Payment</th><th style={styles.th}>Type</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Rate p.a.</th><th style={{ ...styles.th, textAlign: 'right' }}>Coupon</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Cumulative</th><th style={{ ...styles.th, textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.periodIndex} style={p.status === 'pending_fixing' ? { background: '#fffbeb' } : {}}>
                  <td style={styles.td}>{p.periodIndex}</td>
                  <td style={styles.td}>{p.observationDateFormatted || '—'}</td>
                  <td style={styles.td}>{p.paymentDateFormatted || '—'}</td>
                  <td style={styles.td}>{p.couponType === 'fixed' ? 'Fixed' : 'Floating'}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace' }}>{p.annualRatePaFormatted}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace' }}>{p.periodCouponFormatted}</td>
                  <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{p.cumulativeCouponFormatted}</td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>{statusLabel(p.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Redemption */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Redemption</h2>
          <table style={styles.table}>
            <tbody>
              <tr><td style={styles.td}>Capital Return</td><td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace' }}>{redemption.capitalComponentFormatted}</td></tr>
              <tr><td style={styles.td}>Coupons {target.reached ? '' : '(known)'}</td><td style={{ ...styles.td, textAlign: 'right', fontFamily: 'monospace' }}>{redemption.couponComponentFormatted}</td></tr>
              <tr style={{ background: '#e8f4fc' }}><td style={{ ...styles.td, fontWeight: 700 }}>{target.reached ? 'Total Redemption' : 'Value (capital + known coupons)'}</td>
                <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, fontSize: '1.25rem', color: '#1e3a5f', fontFamily: 'monospace' }}>{redemption.totalValueFormatted}</td></tr>
            </tbody>
          </table>
          {redemption.formula && <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem', fontStyle: 'italic' }}>{redemption.formula}</p>}
        </div>

        {/* Chart */}
        {productId && (
          <div style={{ ...styles.section, pageBreakBefore: 'always' }}>
            <h2 style={styles.sectionTitle}>Coupon Accumulation</h2>
            <div style={{ height: '400px', marginTop: '1rem' }}><StructuredProductChart productId={productId} height="400px" /></div>
          </div>
        )}

        <div style={styles.footer}>
          <p>Generated by Amberlake Partners • {new Date().toLocaleString('en-US')}</p>
          <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Report generated on {fmtDate(latestReport.evaluationDate || latestReport.createdAt)}</p>
        </div>
      </div>
    </>
  );
};

const styles = {
  container: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', fontSize: '10pt', lineHeight: 1.4, color: '#1e293b', background: 'white', padding: '2rem', maxWidth: '297mm', margin: '0 auto', minHeight: '100vh' },
  loading: { padding: '2rem', textAlign: 'center', color: '#64748b', background: 'white', minHeight: '100vh' },
  header: { borderBottom: '3px solid #1e3a5f', paddingBottom: '1rem', marginBottom: '1.5rem', background: 'transparent', padding: '1.5rem', marginTop: '-2rem', marginLeft: '-2rem', marginRight: '-2rem', paddingLeft: '2rem', paddingRight: '2rem' },
  title: { fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center' },
  headerMeta: { display: 'flex', gap: '2rem', marginTop: '0.5rem', fontSize: '0.9rem', color: '#334155', alignItems: 'center' },
  metaItem: { color: '#334155', fontWeight: 500 },
  statusBadge: { padding: '3px 12px', borderRadius: '4px', fontWeight: 600, fontSize: '0.8rem' },
  section: { marginBottom: '1.5rem', background: 'white' },
  sectionTitle: { fontSize: '1.1rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.75rem', borderBottom: '2px solid #1e3a5f', paddingBottom: '0.5rem', background: 'linear-gradient(90deg, #f1f5f9 0%, transparent 100%)', padding: '0.5rem', marginLeft: '-0.5rem', paddingLeft: '0.5rem', borderRadius: '4px 0 0 0' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', boxShadow: '0 1px 3px rgba(30, 58, 95, 0.1)' },
  th: { background: 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)', padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'white', borderBottom: '2px solid #1e3a5f' },
  td: { padding: '0.55rem 0.75rem', borderBottom: '1px solid #e2e8f0', color: '#1e293b', background: 'white' },
  footer: { marginTop: '2rem', paddingTop: '1rem', borderTop: '2px solid #1e3a5f', textAlign: 'center', color: '#475569', fontSize: '0.85rem', background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)', padding: '1rem', marginLeft: '-2rem', marginRight: '-2rem', marginBottom: '-2rem', paddingLeft: '2rem', paddingRight: '2rem' }
};

export default RateReportPDF;
