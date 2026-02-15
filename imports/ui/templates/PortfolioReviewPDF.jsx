import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';

/**
 * PortfolioReviewPDF Component
 *
 * PDF-optimized version of the Portfolio Review.
 * Designed for Puppeteer PDF generation (A4 Landscape).
 * All sections expanded, no interactivity.
 */

const formatDate = (date, lang = 'en') => {
  if (!date) return 'N/A';
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  return new Date(date).toLocaleString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatCurrency = (value) => {
  if (value == null) return 'N/A';
  return new Intl.NumberFormat('en-US', { style: 'decimal', maximumFractionDigits: 0 }).format(value);
};

const renderMarkdown = (text) => {
  if (!text || typeof text !== 'string') return null;
  return text.split('\n\n').map((para, pIdx) => {
    if (!para.trim()) return null;

    const headerMatch = para.match(/^(#{1,4})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const size = level === 1 ? '16px' : level === 2 ? '14px' : '12px';
      return <h3 key={pIdx} style={{ fontSize: size, fontWeight: '700', margin: '10px 0 5px', color: '#0f172a' }}>{renderBold(headerMatch[2])}</h3>;
    }

    if (para.trim().startsWith('- ') || para.trim().startsWith('* ') || para.trim().match(/^\d+\./)) {
      const lines = para.split('\n').filter(l => l.trim());
      return (
        <ul key={pIdx} style={{ margin: '5px 0', paddingLeft: '18px' }}>
          {lines.map((line, i) => (
            <li key={i} style={{ fontSize: '11px', lineHeight: '1.6', color: '#1e293b', marginBottom: '3px' }}>
              {renderBold(line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s*/, ''))}
            </li>
          ))}
        </ul>
      );
    }

    return <p key={pIdx} style={{ fontSize: '11px', lineHeight: '1.7', color: '#1e293b', margin: '0 0 8px' }}>{renderBold(para)}</p>;
  }).filter(Boolean);
};

const renderBold = (text) => {
  if (!text) return text;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ color: '#0f172a' }}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

/**
 * Horizontal bar chart component for allocation (current vs max)
 */
const AllocationBarChart = ({ currentAllocation, profileLimits }) => {
  if (!currentAllocation) return null;

  const categories = [
    { key: 'cash', label: 'Cash', color: '#3b82f6' },
    { key: 'bonds', label: 'Bonds', color: '#10b981' },
    { key: 'equities', label: 'Equities', color: '#f59e0b' },
    { key: 'alternative', label: 'Alternative', color: '#8b5cf6' }
  ];

  const limitKey = (key) => `max${key.charAt(0).toUpperCase() + key.slice(1)}`;

  return (
    <div style={{ marginBottom: '12px' }}>
      {categories.map(({ key, label, color }) => {
        const current = currentAllocation[key] || 0;
        const max = profileLimits?.[limitKey(key)];
        const isBreached = max != null && current > max;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', gap: '10px' }}>
            <div style={{ width: '80px', fontSize: '11px', fontWeight: '600', color: '#0f172a', textAlign: 'right' }}>
              {label}
            </div>
            <div style={{ flex: 1, position: 'relative', height: '22px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
              {/* Max limit marker */}
              {max != null && max < 100 && (
                <div style={{
                  position: 'absolute',
                  left: `${max}%`,
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  background: '#64748b',
                  zIndex: 2
                }} />
              )}
              {/* Current allocation bar */}
              <div style={{
                position: 'absolute',
                left: 0,
                top: '2px',
                bottom: '2px',
                width: `${Math.min(current, 100)}%`,
                background: isBreached ? '#ef4444' : color,
                borderRadius: '3px',
                minWidth: current > 0 ? '4px' : 0,
                transition: 'width 0.3s'
              }} />
            </div>
            <div style={{ width: '110px', fontSize: '11px', fontWeight: '600', color: isBreached ? '#ef4444' : '#0f172a', textAlign: 'left' }}>
              {current.toFixed(1)}%{max != null ? ` / ${max}%` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Currency exposure horizontal bar chart
 */
const CurrencyBarChart = ({ exposureByCurrency }) => {
  if (!exposureByCurrency?.length) return null;

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  return (
    <div style={{ marginBottom: '12px' }}>
      {exposureByCurrency.slice(0, 8).map((e, i) => (
        <div key={e.currency} style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', gap: '10px' }}>
          <div style={{ width: '50px', fontSize: '11px', fontWeight: '600', color: '#0f172a', textAlign: 'right' }}>
            {e.currency}
          </div>
          <div style={{ flex: 1, position: 'relative', height: '18px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute',
              left: 0,
              top: '2px',
              bottom: '2px',
              width: `${Math.min(e.percentOfTotal, 100)}%`,
              background: colors[i % colors.length],
              borderRadius: '2px',
              minWidth: e.percentOfTotal > 0 ? '3px' : 0
            }} />
          </div>
          <div style={{ width: '80px', fontSize: '10px', fontWeight: '600', color: '#0f172a', textAlign: 'left' }}>
            {e.percentOfTotal.toFixed(1)}%
          </div>
        </div>
      ))}
    </div>
  );
};


const PortfolioReviewPDF = () => {
  const [review, setReview] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pdfAuthState, setPdfAuthState] = useState({ validated: false, error: null });

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const pdfToken = urlParams?.get('pdfToken');
  const pdfUserId = urlParams?.get('userId');
  const lang = urlParams?.get('lang') || 'en';

  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const reviewIdMatch = pathname.match(/\/pdf\/portfolio-review\/([a-zA-Z0-9]+)/);
  const reviewId = reviewIdMatch ? reviewIdMatch[1] : null;

  // Validate PDF token
  useEffect(() => {
    if (pdfToken && pdfUserId) {
      Meteor.call('pdf.validateToken', pdfUserId, pdfToken, (err, result) => {
        if (err || !result.valid) {
          setPdfAuthState({ validated: false, error: err?.reason || 'Invalid token' });
        } else {
          setPdfAuthState({ validated: true, error: null });
        }
      });
    } else {
      setPdfAuthState({ validated: false, error: 'Missing authentication parameters' });
    }
  }, [pdfToken, pdfUserId]);

  // Fetch review data
  useEffect(() => {
    if (pdfAuthState.validated && reviewId && pdfUserId && pdfToken) {
      Meteor.callAsync('portfolioReview.getReviewForPdf', { reviewId, userId: pdfUserId, pdfToken })
        .then(result => { setReview(result); setIsLoading(false); })
        .catch(err => { setError(err.reason || err.message); setIsLoading(false); });
    }
  }, [pdfAuthState.validated, reviewId, pdfUserId, pdfToken]);

  // PDF mode styling
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.setAttribute('data-pdf-mode', 'true');
      document.body.style.cssText = 'background: white !important; margin: 0; padding: 0;';
      document.documentElement.style.cssText = 'background: white !important;';
      const id = 'pdf-white-override';
      if (!document.getElementById(id)) {
        const style = document.createElement('style');
        style.id = id;
        style.textContent = `html, body, #react-target, .main-content, .App { background: white !important; } * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }`;
        document.head.appendChild(style);
      }
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.removeAttribute('data-pdf-mode');
        document.body.style.cssText = '';
        const el = document.getElementById('pdf-white-override');
        if (el) el.remove();
      }
    };
  }, []);

  // Signal PDF readiness
  useEffect(() => {
    if (!isLoading && review) {
      setTimeout(() => {
        if (typeof document !== 'undefined') document.body.setAttribute('data-pdf-ready', 'true');
      }, 1500);
    }
  }, [isLoading, review]);

  if (!pdfAuthState.validated || isLoading) {
    return (
      <div style={{ background: 'white', minHeight: '100vh', padding: '2rem', fontFamily: '"Inter", sans-serif' }}>
        <p style={{ color: '#475569' }}>{pdfAuthState.error || 'Loading...'}</p>
      </div>
    );
  }

  if (error || !review) {
    return (
      <div style={{ background: 'white', minHeight: '100vh', padding: '2rem', fontFamily: '"Inter", sans-serif' }}>
        <h1 style={{ color: '#ef4444' }}>Error</h1>
        <p style={{ color: '#475569' }}>{error || 'Review not found'}</p>
      </div>
    );
  }

  // Group positions
  const positionsByType = {};
  if (review.positionAnalyses) {
    for (const pos of review.positionAnalyses) {
      const type = pos.securityType || 'OTHER';
      if (!positionsByType[type]) positionsByType[type] = [];
      positionsByType[type].push(pos);
    }
  }

  const typeLabels = { STRUCTURED_PRODUCT: 'Structured Products', EQUITY: 'Equities', BOND: 'Bonds', FUND: 'Funds', OTHER: 'Other' };

  return (
    <>
      <style>{`
        html, body, #react-target { background: white !important; }
        @media print {
          .pdf-section { page-break-inside: avoid; }
        }
        @page { margin: 1.5cm; size: A4 landscape; }
      `}</style>

      <div style={{
        background: 'white',
        minHeight: '100vh',
        maxWidth: '297mm',
        margin: '0 auto',
        padding: '28px',
        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
        color: '#0f172a',
        fontSize: '11px',
        lineHeight: '1.6'
      }} className="report-content">

        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '3px solid #4f46e5',
          paddingBottom: '14px',
          marginBottom: '20px'
        }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.5px' }}>
              Portfolio Review
            </h1>
            <p style={{ fontSize: '14px', color: '#6366f1', margin: '3px 0 0', fontWeight: '600' }}>
              {review.clientName || 'Consolidated Portfolio'}
            </p>
            <p style={{ fontSize: '10px', color: '#64748b', margin: '3px 0 0' }}>
              {formatDate(review.generatedAt, lang)}
            </p>
          </div>
          <img
            src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png"
            alt="Amberlake Partners"
            style={{ height: '40px', width: 'auto' }}
          />
        </div>

        {/* Snapshot Cards */}
        {review.portfolioSnapshot && (
          <div style={{
            display: 'flex',
            gap: '10px',
            marginBottom: '20px'
          }} className="pdf-section">
            {[
              { label: 'Total Value', value: `EUR ${formatCurrency(review.portfolioSnapshot.totalValueEUR)}` },
              { label: 'Unrealized P&L', value: `EUR ${formatCurrency(review.portfolioSnapshot.unrealizedPnLEUR)}`, color: (review.portfolioSnapshot.unrealizedPnLEUR || 0) >= 0 ? '#059669' : '#dc2626' },
              { label: 'Positions', value: review.portfolioSnapshot.positionCount },
              { label: 'Accounts', value: review.portfolioSnapshot.accountCount }
            ].map((item, i) => (
              <div key={i} style={{
                flex: 1,
                padding: '10px 14px',
                background: '#f8fafc',
                borderRadius: '6px',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>{item.label}</div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: item.color || '#0f172a', marginTop: '3px' }}>{item.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Section: Market Overview */}
        {review.macroAnalysis?.content && (
          <div className="pdf-section" style={{ marginBottom: '18px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px', borderBottom: '2px solid #e2e8f0', paddingBottom: '4px' }}>
              Market Overview
            </h2>
            {renderMarkdown(review.macroAnalysis.content)}
          </div>
        )}

        {/* Section: Asset Allocation */}
        {review.allocationAnalysis && (
          <div className="pdf-section" style={{ marginBottom: '18px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px', borderBottom: '2px solid #e2e8f0', paddingBottom: '4px' }}>
              Asset Allocation
            </h2>
            <AllocationBarChart
              currentAllocation={review.allocationAnalysis.currentAllocation}
              profileLimits={review.allocationAnalysis.profileLimits}
            />
            {review.allocationAnalysis.breaches?.length > 0 && (
              <div style={{ padding: '8px 12px', background: '#fef2f2', borderRadius: '4px', border: '1px solid #fecaca', marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: '#dc2626', marginBottom: '4px' }}>Allocation Breaches</div>
                {review.allocationAnalysis.breaches.map((b, i) => (
                  <div key={i} style={{ fontSize: '10px', color: '#991b1b' }}>
                    {b.category}: {b.current?.toFixed(1)}% (max {b.limit}%)
                  </div>
                ))}
              </div>
            )}
            {renderMarkdown(review.allocationAnalysis.content)}
          </div>
        )}

        {/* Section: Currency Exposure */}
        {review.fxAnalysis && (
          <div className="pdf-section" style={{ marginBottom: '18px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px', borderBottom: '2px solid #e2e8f0', paddingBottom: '4px' }}>
              Currency Exposure
            </h2>
            <CurrencyBarChart exposureByCurrency={review.fxAnalysis.exposureByCurrency} />
            {review.fxAnalysis.exposureByCurrency?.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px', fontSize: '10px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Currency</th>
                    <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Value (EUR)</th>
                    <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>% Total</th>
                    <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Positions</th>
                  </tr>
                </thead>
                <tbody>
                  {review.fxAnalysis.exposureByCurrency.map(e => (
                    <tr key={e.currency}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', color: '#0f172a' }}>{e.currency}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: '#1e293b' }}>{formatCurrency(e.valueEUR)}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: '600', color: '#1e293b' }}>{e.percentOfTotal.toFixed(1)}%</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: '#1e293b' }}>{e.positionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {renderMarkdown(review.fxAnalysis.content)}
          </div>
        )}

        {/* Section: Cash Position */}
        {review.cashAnalysis && (
          <div className="pdf-section" style={{ marginBottom: '18px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px', borderBottom: '2px solid #e2e8f0', paddingBottom: '4px' }}>
              Cash Position
            </h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <div style={{ flex: 1, padding: '8px 12px', background: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '9px', color: '#64748b', fontWeight: '600' }}>Pure Cash</div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>EUR {formatCurrency(review.cashAnalysis.pureCashEUR)}</div>
              </div>
              <div style={{ flex: 1, padding: '8px 12px', background: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '9px', color: '#64748b', fontWeight: '600' }}>Cash + Equivalents</div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>EUR {formatCurrency(review.cashAnalysis.totalCashEquivalentEUR)}</div>
              </div>
              <div style={{ flex: 1, padding: '8px 12px', background: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '9px', color: '#64748b', fontWeight: '600' }}>% of Portfolio</div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>{review.cashAnalysis.cashAsPercentOfPortfolio?.toFixed(1)}%</div>
              </div>
            </div>
            {renderMarkdown(review.cashAnalysis.content)}
          </div>
        )}

        {/* Section: Events & Redemptions */}
        {review.eventsSchedule && (
          <div className="pdf-section" style={{ marginBottom: '18px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px', borderBottom: '2px solid #e2e8f0', paddingBottom: '4px' }}>
              Upcoming Events (90 Days)
            </h2>

            {/* Recently Redeemed Products */}
            {review.eventsSchedule.recentRedemptions?.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#059669', margin: '8px 0 5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Recently Redeemed Products
                </h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Product</th>
                      <th style={{ padding: '5px 8px', textAlign: 'center', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Type</th>
                      <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Size</th>
                      <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Date</th>
                      <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Return</th>
                      <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Coupons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.eventsSchedule.recentRedemptions.map((r, i) => (
                      <tr key={`red-${i}`}>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>
                          <div style={{ fontWeight: '600', color: '#0f172a' }}>{r.productName}</div>
                          <div style={{ fontSize: '8px', color: '#64748b' }}>{r.productIsin}</div>
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 6px', borderRadius: '8px', fontSize: '9px', fontWeight: '600', textTransform: 'capitalize',
                            background: r.redemptionType === 'autocalled' ? '#dbeafe' : r.redemptionType === 'called' ? '#fef3c7' : '#d1fae5',
                            color: r.redemptionType === 'autocalled' ? '#1d4ed8' : r.redemptionType === 'called' ? '#b45309' : '#047857'
                          }}>{r.redemptionType}</span>
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: '600', whiteSpace: 'nowrap', color: '#0f172a' }}>
                          {r.notional ? `${r.currency} ${r.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '-'}
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', color: '#475569', whiteSpace: 'nowrap' }}>
                          {r.redemptionDate ? new Date(r.redemptionDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: '700',
                          color: r.totalReturn && parseFloat(r.totalReturn) >= 100 ? '#059669' : '#dc2626' }}>
                          {r.totalReturn || '-'}
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: '#1e293b' }}>
                          {r.couponsEarned || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Possible Upcoming Redemptions */}
            {review.eventsSchedule.possibleRedemptions?.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#d97706', margin: '8px 0 5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Possible Redemptions (Next 30 Days)
                </h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ padding: '5px 8px', textAlign: 'center', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Likelihood</th>
                      <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Product</th>
                      <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Size</th>
                      <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Date</th>
                      <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Autocall</th>
                      <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Worst Perf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.eventsSchedule.possibleRedemptions.map((r, i) => (
                      <tr key={`pos-${i}`}>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 6px', borderRadius: '8px', fontSize: '9px', fontWeight: '600', textTransform: 'capitalize',
                            background: r.autocallLikelihood === 'likely' ? '#d1fae5' : r.autocallLikelihood === 'possible' ? '#fef3c7' : '#f3f4f6',
                            color: r.autocallLikelihood === 'likely' ? '#047857' : r.autocallLikelihood === 'possible' ? '#b45309' : '#374151'
                          }}>{r.autocallLikelihood || r.observationType}</span>
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>
                          <div style={{ fontWeight: '600', color: '#0f172a' }}>{r.productName}</div>
                          <div style={{ fontSize: '8px', color: '#64748b' }}>{r.observationType === 'maturity' ? 'Maturity' : 'Autocall observation'}</div>
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: '600', whiteSpace: 'nowrap', color: '#0f172a' }}>
                          {r.notional ? `${r.currency} ${r.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '-'}
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', color: '#475569', whiteSpace: 'nowrap' }}>
                          {r.nextObservationDate ? new Date(r.nextObservationDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', whiteSpace: 'nowrap', color: '#1e293b' }}>
                          {r.autocallBarrier ? `${r.autocallBarrier}%` : '-'}
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: '700', whiteSpace: 'nowrap',
                          color: r.currentWorstPerformance != null ? (r.currentWorstPerformance >= 0 ? '#059669' : r.currentWorstPerformance >= -10 ? '#d97706' : '#dc2626') : '#475569' }}>
                          {r.currentWorstPerformance != null ? `${r.currentWorstPerformance >= 0 ? '+' : ''}${r.currentWorstPerformance.toFixed(1)}%` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Upcoming observation events */}
            {review.eventsSchedule.upcomingEvents?.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px', fontSize: '10px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Date</th>
                    <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Product</th>
                    <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Event</th>
                    <th style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {review.eventsSchedule.upcomingEvents.slice(0, 20).map((evt, i) => (
                    <tr key={i}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', color: '#1e293b' }}>
                        {new Date(evt.eventDate).toLocaleDateString('en-GB')}
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', maxWidth: '350px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#0f172a', fontWeight: '500' }}>
                        {evt.productName}
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', color: '#1e293b' }}>
                        {evt.description || evt.eventType}
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: evt.daysUntil <= 7 ? '700' : '500', color: evt.daysUntil <= 7 ? '#dc2626' : '#1e293b' }}>
                        {evt.daysUntil}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {renderMarkdown(review.eventsSchedule.content)}
          </div>
        )}

        {/* Section: Recommendations */}
        {review.recommendations?.content && (
          <div className="pdf-section" style={{ marginBottom: '18px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px', borderBottom: '2px solid #e2e8f0', paddingBottom: '4px' }}>
              Investment Recommendations
            </h2>
            <div style={{ padding: '10px 14px', background: '#f5f3ff', borderRadius: '6px', borderLeft: '4px solid #6366f1' }}>
              {renderMarkdown(review.recommendations.content)}
            </div>
          </div>
        )}

        {/* Section: Position Analyses */}
        {review.positionAnalyses?.length > 0 && (
          <div style={{ marginBottom: '18px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px', borderBottom: '2px solid #e2e8f0', paddingBottom: '4px' }}>
              Position Analysis ({review.positionAnalyses.length} positions)
            </h2>
            {Object.entries(positionsByType).map(([type, positions]) => (
              <div key={type} style={{ marginBottom: '14px' }}>
                <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#4f46e5', margin: '8px 0 5px' }}>
                  {typeLabels[type] || type} ({positions.length})
                </h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ padding: '5px 6px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Name</th>
                      <th style={{ padding: '5px 6px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>ISIN</th>
                      <th style={{ padding: '5px 6px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Weight</th>
                      <th style={{ padding: '5px 6px', textAlign: 'right', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>P&L</th>
                      <th style={{ padding: '5px 6px', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: '700', color: '#0f172a' }}>Commentary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.sort((a, b) => (b.weightPercent || 0) - (a.weightPercent || 0)).map((pos, i) => (
                      <tr key={i}>
                        <td style={{ padding: '5px 6px', borderBottom: '1px solid #f1f5f9', fontWeight: '600', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#0f172a' }}>
                          {pos.securityName}
                        </td>
                        <td style={{ padding: '5px 6px', borderBottom: '1px solid #f1f5f9', color: '#64748b', fontSize: '9px' }}>
                          {pos.isin}
                        </td>
                        <td style={{ padding: '5px 6px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: '#1e293b', fontWeight: '500' }}>
                          {pos.weightPercent?.toFixed(2)}%
                        </td>
                        <td style={{
                          padding: '5px 6px',
                          borderBottom: '1px solid #f1f5f9',
                          textAlign: 'right',
                          color: (pos.unrealizedPnLPercent || 0) >= 0 ? '#059669' : '#dc2626',
                          fontWeight: '700'
                        }}>
                          {(pos.unrealizedPnLPercent || 0) >= 0 ? '+' : ''}{pos.unrealizedPnLPercent?.toFixed(2)}%
                        </td>
                        <td style={{ padding: '5px 6px', borderBottom: '1px solid #f1f5f9', fontSize: '9px', lineHeight: '1.5', color: '#1e293b' }}>
                          {pos.commentary}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{
          borderTop: '2px solid #e2e8f0',
          paddingTop: '10px',
          marginTop: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '9px',
          color: '#64748b'
        }}>
          <span>Amberlake Partners - Portfolio Review</span>
          <span>Confidential - For internal use only</span>
          <span>{formatDate(review.generatedAt, lang)}</span>
        </div>
      </div>
    </>
  );
};

export default PortfolioReviewPDF;
