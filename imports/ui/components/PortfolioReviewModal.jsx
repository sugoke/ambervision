import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import PDFDownloadButton from './PDFDownloadButton.jsx';
import { useTheme } from '../ThemeContext.jsx';

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
  return new Intl.NumberFormat('en-US', {
    style: 'decimal',
    maximumFractionDigits: 0
  }).format(value);
};

/**
 * Parse markdown bold (**text**) into React elements
 */
const renderMarkdown = (text) => {
  if (!text || typeof text !== 'string') return text;

  // Split into paragraphs
  return text.split('\n\n').map((paragraph, pIdx) => {
    if (!paragraph.trim()) return null;

    // Check for markdown headers
    const headerMatch = paragraph.match(/^(#{1,4})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const headerText = headerMatch[2];
      const fontSize = level === 1 ? '1.2rem' : level === 2 ? '1.05rem' : '0.95rem';
      return (
        <h3 key={pIdx} style={{
          fontSize,
          fontWeight: '700',
          margin: '1rem 0 0.5rem',
          color: 'var(--text-primary)'
        }}>
          {renderBold(headerText)}
        </h3>
      );
    }

    // Check for bullet points
    if (paragraph.trim().startsWith('- ') || paragraph.trim().startsWith('* ') || paragraph.trim().match(/^\d+\./)) {
      const lines = paragraph.split('\n').filter(l => l.trim());
      return (
        <ul key={pIdx} style={{ margin: '0.5rem 0', paddingLeft: '1.25rem' }}>
          {lines.map((line, lIdx) => (
            <li key={lIdx} style={{
              fontSize: '0.875rem',
              lineHeight: '1.6',
              color: 'var(--text-secondary)',
              marginBottom: '0.25rem'
            }}>
              {renderBold(line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s*/, ''))}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p key={pIdx} style={{
        fontSize: '0.875rem',
        lineHeight: '1.7',
        color: 'var(--text-secondary)',
        margin: '0 0 0.75rem'
      }}>
        {renderBold(paragraph)}
      </p>
    );
  }).filter(Boolean);
};

const renderBold = (text) => {
  if (!text) return text;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

/**
 * Collapsible section component
 */
const Section = ({ title, icon, children, defaultExpanded = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div style={{
      marginBottom: '1rem',
      border: '1px solid var(--border-color, #e5e7eb)',
      borderRadius: '10px',
      overflow: 'hidden'
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          padding: '0.875rem 1.25rem',
          background: 'var(--card-bg, #f9fafb)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.95rem',
          fontWeight: '600',
          color: 'var(--text-primary)',
          transition: 'background 0.15s'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.1rem' }}>{icon}</span>
          {title}
        </span>
        <span style={{
          transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
          transition: 'transform 0.2s',
          fontSize: '0.8rem'
        }}>
          &#9660;
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '1rem 1.25rem' }}>
          {children}
        </div>
      )}
    </div>
  );
};

const PortfolioReviewModal = ({ reviewId, onClose }) => {
  const { isDarkMode } = useTheme();
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!reviewId) return;
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) return;

    setLoading(true);
    Meteor.callAsync('portfolioReview.getReview', reviewId, sessionId)
      .then(result => {
        setReview(result);
        setLoading(false);
      })
      .catch(err => {
        setError(err.reason || err.message);
        setLoading(false);
      });
  }, [reviewId]);

  const handleExport = () => {
    if (!review) return;

    let text = `PORTFOLIO REVIEW\n`;
    text += `Client: ${review.clientName || 'Consolidated'}\n`;
    text += `Generated: ${formatDate(review.generatedAt, review.language)}\n`;
    text += `${'='.repeat(80)}\n\n`;

    if (review.portfolioSnapshot) {
      text += `PORTFOLIO SNAPSHOT\n${'-'.repeat(80)}\n`;
      text += `Total Value: EUR ${formatCurrency(review.portfolioSnapshot.totalValueEUR)}\n`;
      text += `Positions: ${review.portfolioSnapshot.positionCount}\n`;
      text += `Unrealized P&L: EUR ${formatCurrency(review.portfolioSnapshot.unrealizedPnLEUR)}\n\n`;
    }

    const sections = [
      ['MARKET OVERVIEW', review.macroAnalysis?.content],
      ['ALLOCATION ANALYSIS', review.allocationAnalysis?.content],
      ['FX EXPOSURE', review.fxAnalysis?.content],
      ['UPCOMING EVENTS', review.eventsSchedule?.content],
      ['CASH POSITION', review.cashAnalysis?.content],
      ['RECOMMENDATIONS', review.recommendations?.content]
    ];

    for (const [title, content] of sections) {
      if (content) {
        text += `${title}\n${'-'.repeat(80)}\n${content}\n\n`;
      }
    }

    if (review.positionAnalyses?.length > 0) {
      text += `POSITION ANALYSES\n${'='.repeat(80)}\n\n`;
      for (const pos of review.positionAnalyses) {
        text += `${pos.securityName} (${pos.isin})\n`;
        text += `Type: ${pos.securityType} | Weight: ${pos.weightPercent?.toFixed(2)}% | P&L: ${pos.unrealizedPnLPercent?.toFixed(2)}%\n`;
        text += `${pos.commentary}\n\n`;
      }
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Portfolio_Review_${review.clientName || 'Consolidated'}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Group positions by asset type
  const positionsByType = {};
  if (review?.positionAnalyses) {
    for (const pos of review.positionAnalyses) {
      const type = pos.securityType || 'OTHER';
      if (!positionsByType[type]) positionsByType[type] = [];
      positionsByType[type].push(pos);
    }
  }

  const typeLabels = {
    STRUCTURED_PRODUCT: 'Structured Products',
    EQUITY: 'Equities',
    BOND: 'Bonds',
    FUND: 'Funds',
    OTHER: 'Other'
  };

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #portfolio-review-print-area, #portfolio-review-print-area * { visibility: visible; }
          #portfolio-review-print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div
        style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(4px)'
        }}
        onClick={onClose}
      >
        <div
          style={{
            background: isDarkMode ? '#1f2937' : '#ffffff',
            borderRadius: '16px',
            maxWidth: '1200px',
            width: '95%',
            maxHeight: '95vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="no-print" style={{
            padding: '1.25rem 1.5rem',
            borderBottom: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: isDarkMode ? '#111827' : '#f9fafb',
            borderTopLeftRadius: '16px',
            borderTopRightRadius: '16px'
          }}>
            <div>
              <h2 style={{
                margin: 0,
                fontSize: '1.2rem',
                fontWeight: '700',
                color: isDarkMode ? '#e5e7eb' : '#1f2937'
              }}>
                Portfolio Review
              </h2>
              {review && (
                <div style={{
                  fontSize: '0.8rem',
                  color: isDarkMode ? '#9ca3af' : '#6b7280',
                  marginTop: '0.25rem'
                }}>
                  {review.clientName} &middot; {formatDate(review.generatedAt, review.language)}
                  {review.portfolioSnapshot && (
                    <> &middot; EUR {formatCurrency(review.portfolioSnapshot.totalValueEUR)}</>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {review && review.status === 'completed' && (
                <>
                  <PDFDownloadButton
                    reportId={review._id}
                    reportType="portfolio-review"
                    filename={`Portfolio_Review_${review.clientName || 'Review'}_${new Date().toISOString().split('T')[0]}`}
                    title="PDF"
                    style={{
                      padding: '0.5rem 0.875rem',
                      background: 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  />
                  <button
                    onClick={handleExport}
                    style={{
                      padding: '0.5rem 0.875rem',
                      background: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Export TXT
                  </button>
                </>
              )}
              <button
                onClick={onClose}
                style={{
                  width: '36px',
                  height: '36px',
                  border: 'none',
                  borderRadius: '8px',
                  background: isDarkMode ? '#374151' : '#e5e7eb',
                  color: isDarkMode ? '#d1d5db' : '#6b7280',
                  fontSize: '1.1rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                &times;
              </button>
            </div>
          </div>

          {/* Content */}
          <div
            id="portfolio-review-print-area"
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '1.5rem',
              '--text-primary': isDarkMode ? '#e5e7eb' : '#1e293b',
              '--text-secondary': isDarkMode ? '#d1d5db' : '#374151',
              '--text-muted': isDarkMode ? '#9ca3af' : '#6b7280',
              '--border-color': isDarkMode ? '#374151' : '#e5e7eb',
              '--card-bg': isDarkMode ? '#111827' : '#f9fafb',
              color: isDarkMode ? '#e5e7eb' : '#1e293b'
            }}
          >
            {loading && (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading review...
              </div>
            )}

            {error && (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>
                Error loading review: {error}
              </div>
            )}

            {review && !loading && (
              <div style={{ maxWidth: '900px', margin: '0 auto' }}>
                {/* Portfolio Snapshot Banner */}
                {review.portfolioSnapshot && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: '0.75rem',
                    marginBottom: '1.5rem',
                    padding: '1rem',
                    background: isDarkMode ? 'rgba(79, 70, 229, 0.1)' : 'rgba(79, 70, 229, 0.05)',
                    borderRadius: '10px',
                    border: `1px solid ${isDarkMode ? 'rgba(79, 70, 229, 0.2)' : 'rgba(79, 70, 229, 0.15)'}`
                  }}>
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Value</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>EUR {formatCurrency(review.portfolioSnapshot.totalValueEUR)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Unrealized P&L</div>
                      <div style={{
                        fontSize: '1.1rem',
                        fontWeight: '700',
                        color: (review.portfolioSnapshot.unrealizedPnLEUR || 0) >= 0 ? '#10b981' : '#ef4444'
                      }}>
                        EUR {formatCurrency(review.portfolioSnapshot.unrealizedPnLEUR)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Positions</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>{review.portfolioSnapshot.positionCount}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Accounts</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>{review.portfolioSnapshot.accountCount}</div>
                    </div>
                  </div>
                )}

                {/* 1. Market Overview */}
                {review.macroAnalysis?.content && (
                  <Section title="Market Overview" icon="🌍" defaultExpanded={true}>
                    {renderMarkdown(review.macroAnalysis.content)}
                  </Section>
                )}

                {/* 2. Portfolio Positions */}
                {review.positionAnalyses?.length > 0 && (
                  <Section title={`Portfolio Positions (${review.positionAnalyses.length})`} icon="📊" defaultExpanded={false}>
                    {Object.entries(positionsByType).map(([type, positions]) => (
                      <div key={type} style={{ marginBottom: '1.25rem' }}>
                        <h4 style={{
                          fontSize: '0.9rem',
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          margin: '0 0 0.5rem',
                          padding: '0.4rem 0',
                          borderBottom: '1px solid var(--border-color, #e5e7eb)'
                        }}>
                          {typeLabels[type] || type} ({positions.length})
                        </h4>
                        {positions
                          .sort((a, b) => (b.weightPercent || 0) - (a.weightPercent || 0))
                          .map((pos, idx) => (
                          <div key={idx} style={{
                            padding: '0.75rem',
                            marginBottom: '0.5rem',
                            borderRadius: '8px',
                            background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)',
                            border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`
                          }}>
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              marginBottom: '0.4rem'
                            }}>
                              <div>
                                <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                                  {pos.securityName}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {pos.isin} &middot; {pos.currency}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '1rem' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                                  {pos.weightPercent?.toFixed(2)}%
                                </div>
                                <div style={{
                                  fontSize: '0.75rem',
                                  fontWeight: '500',
                                  color: (pos.unrealizedPnLPercent || 0) >= 0 ? '#10b981' : '#ef4444'
                                }}>
                                  {(pos.unrealizedPnLPercent || 0) >= 0 ? '+' : ''}{pos.unrealizedPnLPercent?.toFixed(2)}%
                                </div>
                              </div>
                            </div>
                            <div style={{
                              fontSize: '0.8rem',
                              lineHeight: '1.5',
                              color: 'var(--text-secondary)'
                            }}>
                              {pos.commentary}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </Section>
                )}

                {/* 3. Asset Allocation */}
                {review.allocationAnalysis && (
                  <Section title="Asset Allocation" icon="📐" defaultExpanded={true}>
                    {/* Allocation bars */}
                    {review.allocationAnalysis.currentAllocation && (
                      <div style={{ marginBottom: '1rem' }}>
                        {Object.entries(review.allocationAnalysis.currentAllocation).map(([cat, pct]) => {
                          const limit = review.allocationAnalysis.profileLimits?.[`max${cat.charAt(0).toUpperCase() + cat.slice(1)}`];
                          const isBreached = limit && pct > limit;

                          return (
                            <div key={cat} style={{ marginBottom: '0.5rem' }}>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '0.8rem',
                                marginBottom: '0.2rem'
                              }}>
                                <span style={{
                                  fontWeight: '600',
                                  color: isBreached ? '#ef4444' : 'var(--text-primary)',
                                  textTransform: 'capitalize'
                                }}>
                                  {cat} {isBreached && '(!)'}
                                </span>
                                <span style={{ color: 'var(--text-muted)' }}>
                                  {pct.toFixed(1)}%{limit ? ` / ${limit}%` : ''}
                                </span>
                              </div>
                              <div style={{
                                height: '8px',
                                background: isDarkMode ? 'rgba(255,255,255,0.1)' : '#e5e7eb',
                                borderRadius: '4px',
                                overflow: 'hidden',
                                position: 'relative'
                              }}>
                                <div style={{
                                  height: '100%',
                                  width: `${Math.min(pct, 100)}%`,
                                  background: isBreached
                                    ? '#ef4444'
                                    : cat === 'cash' ? '#6366f1' : cat === 'bonds' ? '#06b6d4' : cat === 'equities' ? '#10b981' : '#f59e0b',
                                  borderRadius: '4px',
                                  transition: 'width 0.3s'
                                }} />
                                {limit && (
                                  <div style={{
                                    position: 'absolute',
                                    left: `${Math.min(limit, 100)}%`,
                                    top: 0,
                                    bottom: 0,
                                    width: '2px',
                                    background: isDarkMode ? '#d1d5db' : '#374151'
                                  }} />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Breaches */}
                    {review.allocationAnalysis.breaches?.length > 0 && (
                      <div style={{
                        padding: '0.75rem',
                        background: 'rgba(239, 68, 68, 0.08)',
                        borderRadius: '8px',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        marginBottom: '1rem'
                      }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#ef4444', marginBottom: '0.3rem' }}>
                          Allocation Breaches
                        </div>
                        {review.allocationAnalysis.breaches.map((b, i) => (
                          <div key={i} style={{ fontSize: '0.8rem', color: '#dc2626' }}>
                            {b.category}: {b.current.toFixed(1)}% (limit {b.limit}%, excess +{b.excess.toFixed(1)}%)
                          </div>
                        ))}
                      </div>
                    )}

                    {renderMarkdown(review.allocationAnalysis.content)}
                  </Section>
                )}

                {/* 4. Currency Exposure */}
                {review.fxAnalysis && (
                  <Section title="Currency Exposure" icon="💱" defaultExpanded={true}>
                    {review.fxAnalysis.exposureByCurrency?.length > 0 && (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                        gap: '0.5rem',
                        marginBottom: '1rem'
                      }}>
                        {review.fxAnalysis.exposureByCurrency.map(e => (
                          <div key={e.currency} style={{
                            padding: '0.6rem',
                            borderRadius: '8px',
                            background: isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                            border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                            textAlign: 'center'
                          }}>
                            <div style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                              {e.currency}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {e.percentOfTotal.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              {e.positionCount} pos.
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {renderMarkdown(review.fxAnalysis.content)}
                  </Section>
                )}

                {/* 5. Events (Redemptions + Observations) */}
                {review.eventsSchedule && (
                  <Section title="Events Schedule" icon="📅" defaultExpanded={true}>
                    {/* Recently redeemed products - table */}
                    {review.eventsSchedule.recentRedemptions?.length > 0 && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          color: '#10b981',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '0.5rem'
                        }}>
                          Recently Redeemed Products
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '0.78rem'
                          }}>
                            <thead>
                              <tr style={{
                                borderBottom: `2px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
                                color: 'var(--text-muted)',
                                fontSize: '0.7rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                              }}>
                                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Product</th>
                                <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Type</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Size</th>
                                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Date</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Return</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Coupons</th>
                              </tr>
                            </thead>
                            <tbody>
                              {review.eventsSchedule.recentRedemptions.map((r, i) => (
                                <tr key={`redeemed-${i}`} style={{
                                  borderBottom: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                                }}>
                                  <td style={{ padding: '0.5rem 0.5rem' }}>
                                    <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>{r.productName}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.productIsin}</div>
                                  </td>
                                  <td style={{ textAlign: 'center', padding: '0.5rem 0.5rem' }}>
                                    <span style={{
                                      display: 'inline-block',
                                      padding: '0.15rem 0.5rem',
                                      borderRadius: '10px',
                                      fontSize: '0.68rem',
                                      fontWeight: '600',
                                      textTransform: 'capitalize',
                                      background: r.redemptionType === 'autocalled' ? 'rgba(59, 130, 246, 0.1)' :
                                        r.redemptionType === 'called' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                      color: r.redemptionType === 'autocalled' ? '#3b82f6' :
                                        r.redemptionType === 'called' ? '#f59e0b' : '#10b981'
                                    }}>
                                      {r.redemptionType}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'right', padding: '0.5rem 0.5rem', fontWeight: '500', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                                    {r.notional ? `${r.currency} ${r.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '-'}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.5rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {r.redemptionDate ? new Date(r.redemptionDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                  </td>
                                  <td style={{ textAlign: 'right', padding: '0.5rem 0.5rem', fontWeight: '600', whiteSpace: 'nowrap',
                                    color: r.totalReturn && parseFloat(r.totalReturn) >= 100 ? '#10b981' : '#ef4444'
                                  }}>
                                    {r.totalReturn || '-'}
                                  </td>
                                  <td style={{ textAlign: 'right', padding: '0.5rem 0.5rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                                    {r.couponsEarned || '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {/* Possible upcoming redemptions - table */}
                    {review.eventsSchedule.possibleRedemptions?.length > 0 && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          color: '#f59e0b',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '0.5rem'
                        }}>
                          Possible Redemptions (next 30 days)
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '0.78rem'
                          }}>
                            <thead>
                              <tr style={{
                                borderBottom: `2px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
                                color: 'var(--text-muted)',
                                fontSize: '0.7rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                              }}>
                                <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Likelihood</th>
                                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Product</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Size</th>
                                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Date</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Autocall</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', fontWeight: '600' }}>Worst Perf</th>
                              </tr>
                            </thead>
                            <tbody>
                              {review.eventsSchedule.possibleRedemptions.map((r, i) => (
                                <tr key={`possible-${i}`} style={{
                                  borderBottom: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                                }}>
                                  <td style={{ textAlign: 'center', padding: '0.5rem 0.5rem' }}>
                                    <span style={{
                                      display: 'inline-block',
                                      padding: '0.15rem 0.5rem',
                                      borderRadius: '10px',
                                      fontSize: '0.68rem',
                                      fontWeight: '600',
                                      textTransform: 'capitalize',
                                      background: r.autocallLikelihood === 'likely' ? 'rgba(16, 185, 129, 0.1)'
                                        : r.autocallLikelihood === 'possible' ? 'rgba(245, 158, 11, 0.1)'
                                        : 'rgba(107, 114, 128, 0.1)',
                                      color: r.autocallLikelihood === 'likely' ? '#10b981'
                                        : r.autocallLikelihood === 'possible' ? '#f59e0b'
                                        : '#6b7280'
                                    }}>
                                      {r.autocallLikelihood || r.observationType}
                                    </span>
                                  </td>
                                  <td style={{ padding: '0.5rem 0.5rem' }}>
                                    <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>{r.productName}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                      {r.observationType === 'maturity' ? 'Maturity' : 'Autocall observation'}
                                    </div>
                                  </td>
                                  <td style={{ textAlign: 'right', padding: '0.5rem 0.5rem', fontWeight: '500', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                                    {r.notional ? `${r.currency} ${r.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '-'}
                                  </td>
                                  <td style={{ padding: '0.5rem 0.5rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {r.nextObservationDate ? new Date(r.nextObservationDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                  </td>
                                  <td style={{ textAlign: 'right', padding: '0.5rem 0.5rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                                    {r.autocallBarrier ? `${r.autocallBarrier}%` : '-'}
                                  </td>
                                  <td style={{ textAlign: 'right', padding: '0.5rem 0.5rem', fontWeight: '600', whiteSpace: 'nowrap',
                                    color: r.currentWorstPerformance != null
                                      ? (r.currentWorstPerformance >= 0 ? '#10b981' : r.currentWorstPerformance >= -10 ? '#f59e0b' : '#ef4444')
                                      : 'var(--text-muted)'
                                  }}>
                                    {r.currentWorstPerformance != null ? `${r.currentWorstPerformance >= 0 ? '+' : ''}${r.currentWorstPerformance.toFixed(1)}%` : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {/* Recent observation events (last 30 days) */}
                    {review.eventsSchedule.recentEvents?.length > 0 && (
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '0.5rem'
                        }}>
                          Recent (last 30 days)
                        </div>
                        {review.eventsSchedule.recentEvents.slice(0, 10).map((evt, i) => (
                          <div key={`past-${i}`} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.5rem 0',
                            opacity: 0.75,
                            borderBottom: i < review.eventsSchedule.recentEvents.length - 1
                              ? `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                              : 'none'
                          }}>
                            <div style={{
                              minWidth: '50px',
                              textAlign: 'center',
                              padding: '0.25rem 0.5rem',
                              background: 'rgba(107, 114, 128, 0.1)',
                              borderRadius: '6px',
                              fontSize: '0.7rem',
                              fontWeight: '600',
                              color: '#6b7280'
                            }}>
                              {Math.abs(evt.daysUntil)}d ago
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                                {evt.productName}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {evt.description || evt.eventType} &middot; {new Date(evt.eventDate).toLocaleDateString('en-GB')}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Upcoming events (next 30 days) */}
                    {review.eventsSchedule.upcomingEvents?.length > 0 && (
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{
                          fontSize: '0.8rem',
                          fontWeight: '600',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '0.5rem'
                        }}>
                          Upcoming (next 30 days)
                        </div>
                        {review.eventsSchedule.upcomingEvents.slice(0, 15).map((evt, i) => (
                          <div key={`up-${i}`} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.5rem 0',
                            borderBottom: i < review.eventsSchedule.upcomingEvents.length - 1
                              ? `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`
                              : 'none'
                          }}>
                            <div style={{
                              minWidth: '50px',
                              textAlign: 'center',
                              padding: '0.25rem 0.5rem',
                              background: evt.daysUntil <= 7 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                              borderRadius: '6px',
                              fontSize: '0.7rem',
                              fontWeight: '600',
                              color: evt.daysUntil <= 7 ? '#ef4444' : '#f59e0b'
                            }}>
                              {evt.daysUntil}d
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                                {evt.productName}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {evt.description || evt.eventType} &middot; {new Date(evt.eventDate).toLocaleDateString('en-GB')}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {renderMarkdown(review.eventsSchedule.content)}
                  </Section>
                )}

                {/* 6. Cash Position */}
                {review.cashAnalysis && (
                  <Section title="Cash Position" icon="💰" defaultExpanded={true}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: '0.75rem',
                      marginBottom: '1rem'
                    }}>
                      <div style={{
                        padding: '0.75rem',
                        background: isDarkMode ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.05)',
                        borderRadius: '8px'
                      }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Pure Cash</div>
                        <div style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>EUR {formatCurrency(review.cashAnalysis.pureCashEUR)}</div>
                      </div>
                      <div style={{
                        padding: '0.75rem',
                        background: isDarkMode ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.05)',
                        borderRadius: '8px'
                      }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Cash + Equivalents</div>
                        <div style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>EUR {formatCurrency(review.cashAnalysis.totalCashEquivalentEUR)}</div>
                      </div>
                      <div style={{
                        padding: '0.75rem',
                        background: isDarkMode ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.05)',
                        borderRadius: '8px'
                      }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>% of Portfolio</div>
                        <div style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>{review.cashAnalysis.cashAsPercentOfPortfolio?.toFixed(1)}%</div>
                      </div>
                    </div>
                    {renderMarkdown(review.cashAnalysis.content)}
                  </Section>
                )}

                {/* 7. Recommendations (highlighted) */}
                {review.recommendations?.content && (
                  <Section title="Investment Recommendations" icon="💡" defaultExpanded={true}>
                    <div style={{
                      padding: '0.75rem',
                      background: isDarkMode ? 'rgba(79, 70, 229, 0.1)' : 'rgba(79, 70, 229, 0.05)',
                      borderRadius: '8px',
                      borderLeft: '4px solid #6366f1',
                      marginBottom: '0.5rem'
                    }}>
                      {renderMarkdown(review.recommendations.content)}
                    </div>
                  </Section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default PortfolioReviewModal;
