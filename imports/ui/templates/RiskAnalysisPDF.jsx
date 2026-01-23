import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { getTranslation, getLocale } from '../../utils/reportTranslations';

/**
 * RiskAnalysisPDF Component
 *
 * PDF-optimized version of the Risk Analysis Report.
 * All sections are expanded (no interactivity).
 * Designed for Puppeteer PDF generation.
 * Supports multiple languages (EN/FR) via URL parameter.
 */

const formatDate = (date, lang = 'en') => {
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  return new Date(date).toLocaleString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatShortDate = (date, lang = 'en') => {
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  return new Date(date).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

const getRiskBadgeStyle = (riskLevel) => {
  const baseStyle = {
    display: 'inline-block',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  };

  switch (riskLevel) {
    case 'critical':
      return { ...baseStyle, background: '#fecaca', color: '#991b1b' };
    case 'high':
      return { ...baseStyle, background: '#fed7aa', color: '#9a3412' };
    case 'moderate':
      return { ...baseStyle, background: '#fef08a', color: '#854d0e' };
    default:
      return { ...baseStyle, background: '#d1d5db', color: '#374151' };
  }
};

const RiskAnalysisPDF = () => {
  console.log('[RiskAnalysisPDF] Component rendering...');

  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // PDF mode detection and authentication
  const [pdfAuthState, setPdfAuthState] = useState({ validated: false, error: null });

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const pdfToken = urlParams?.get('pdfToken');
  const pdfUserId = urlParams?.get('userId');
  const lang = urlParams?.get('lang') || 'en';
  const tr = getTranslation(lang);

  // Extract reportId from URL path: /pdf/risk-analysis/:reportId
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const reportIdMatch = pathname.match(/\/pdf\/risk-analysis\/([a-zA-Z0-9]+)/);
  const reportId = reportIdMatch ? reportIdMatch[1] : null;

  // Validate PDF token
  useEffect(() => {
    if (pdfToken && pdfUserId) {
      console.log('[RiskAnalysisPDF] Validating PDF authentication token...');
      Meteor.call('pdf.validateToken', pdfUserId, pdfToken, (error, result) => {
        if (error || !result.valid) {
          console.error('[RiskAnalysisPDF] Token validation failed:', error?.reason || result?.reason);
          setPdfAuthState({ validated: false, error: error?.reason || result?.reason || 'Invalid token' });
        } else {
          console.log('[RiskAnalysisPDF] PDF token validated successfully');
          setPdfAuthState({ validated: true, error: null });
        }
      });
    } else {
      setPdfAuthState({ validated: false, error: 'Missing authentication parameters' });
    }
  }, [pdfToken, pdfUserId]);

  // Fetch report data once authenticated
  useEffect(() => {
    if (pdfAuthState.validated && reportId && pdfUserId && pdfToken) {
      console.log('[RiskAnalysisPDF] Fetching report data...');
      Meteor.callAsync('riskAnalysis.getReportForPdf', { reportId, userId: pdfUserId, pdfToken })
        .then(result => {
          console.log('[RiskAnalysisPDF] Report fetched:', result?.analyses?.length || 0, 'analyses');
          setReport(result);
          setIsLoading(false);
        })
        .catch(err => {
          console.error('[RiskAnalysisPDF] Error fetching report:', err);
          setError(err.reason || err.message);
          setIsLoading(false);
        });
    }
  }, [pdfAuthState.validated, reportId, pdfUserId, pdfToken]);

  // Set PDF mode styling
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

  // Signal PDF readiness
  useEffect(() => {
    if (!isLoading && report) {
      setTimeout(() => {
        if (typeof document !== 'undefined') {
          document.body.setAttribute('data-pdf-ready', 'true');
        }
      }, 1500);
    }
  }, [isLoading, report]);

  // Loading/error states
  if (!pdfAuthState.validated || isLoading) {
    const message = pdfAuthState.error
      ? `Authentication failed: ${pdfAuthState.error}`
      : !pdfAuthState.validated
        ? 'Authenticating...'
        : 'Loading report data...';

    return (
      <div className="report-content" style={{
        background: 'white',
        minHeight: '100vh',
        padding: '2rem',
        fontFamily: '"Inter", -apple-system, system-ui, sans-serif'
      }}>
        <h1 style={{ color: '#1e293b', marginBottom: '1rem' }}>Risk Analysis Report - Loading</h1>
        <p style={{ color: '#64748b' }}>{message}</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="report-content" style={{
        background: 'white',
        minHeight: '100vh',
        padding: '2rem',
        fontFamily: '"Inter", -apple-system, system-ui, sans-serif'
      }}>
        <h1 style={{ color: '#ef4444', marginBottom: '1rem' }}>Error Loading Report</h1>
        <p style={{ color: '#64748b' }}>{error || 'Report not found'}</p>
      </div>
    );
  }

  const { summary, analyses, executiveSummary, impactedProducts, generatedAt } = report;

  return (
    <>
      <style>{`
        html, body, #react-target { background: white !important; }
        @media print {
          .risk-pdf-section { page-break-inside: avoid; }
          .risk-analysis-item { page-break-before: always; }
          .risk-analysis-item:first-child { page-break-before: auto; }
        }
        @page { margin: 1cm; }
      `}</style>

      <div style={styles.container} className="risk-pdf-report report-content">
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div style={{ flex: 1 }}>
              <h1 style={styles.title}>{tr.riskAnalysisReport}</h1>
              <p style={styles.subtitle}>{lang === 'fr' ? 'Produits Structurés - Évaluation des Risques de Barrière' : 'Structured Products - Barrier Risk Assessment'}</p>
              <p style={styles.generatedAt}>{lang === 'fr' ? 'Généré:' : 'Generated:'} {formatDate(generatedAt, lang)}</p>
            </div>
            <img
              src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png"
              alt="Amberlake Partners"
              style={{ height: '40px', width: 'auto', marginLeft: '1rem' }}
            />
          </div>
        </div>

        {/* Summary Cards */}
        <div style={styles.summaryGrid} className="risk-pdf-section">
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>{lang === 'fr' ? 'À Risque' : 'At Risk'}</div>
            <div style={{ ...styles.summaryValue, color: '#ef4444' }}>
              {summary.uniqueUnderlyings}
            </div>
            <div style={styles.summarySubtext}>{lang === 'fr' ? 'Sous-jacents uniques' : 'Unique underlyings'}</div>
          </div>

          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>{lang === 'fr' ? 'Critique' : 'Critical'}</div>
            <div style={{ ...styles.summaryValue, color: '#dc2626' }}>
              {summary.criticalRisk}
            </div>
            <div style={styles.summarySubtext}>{lang === 'fr' ? '>5% sous barrière' : '>5% below barrier'}</div>
          </div>

          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>{tr.averageDistanceToBarrier}</div>
            <div style={{
              ...styles.summaryValue,
              color: summary.averageDistanceToBarrier >= 0 ? '#10b981' : '#ef4444'
            }}>
              {summary.averageDistanceToBarrier >= 0 ? '+' : ''}{summary.averageDistanceToBarrier.toFixed(1)}%
            </div>
            <div style={styles.summarySubtext}>{lang === 'fr' ? 'Vers barrière' : 'To barrier'}</div>
          </div>

          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>{lang === 'fr' ? 'Temps Moyen' : 'Avg Time'}</div>
            <div style={styles.summaryValue}>
              {Math.round(summary.averageDaysRemaining)}
            </div>
            <div style={styles.summarySubtext}>{lang === 'fr' ? 'Jours restants' : 'Days remaining'}</div>
          </div>
        </div>

        {/* Executive Summary */}
        <div style={styles.executiveSummary} className="risk-pdf-section">
          <h2 style={styles.executiveSummaryTitle}>{lang === 'fr' ? 'Résumé Exécutif' : 'Executive Summary'}</h2>
          <div style={styles.executiveSummaryText}>
            {executiveSummary}
          </div>
        </div>

        {/* Impacted Products */}
        {impactedProducts && impactedProducts.length > 0 && (
          <div style={styles.impactedProductsSection} className="risk-pdf-section">
            <h2 style={styles.impactedProductsTitle}>{lang === 'fr' ? 'Produits Impactés' : 'Impacted Products'} ({impactedProducts.length})</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {impactedProducts.map((product, idx) => (
                <div key={product.productId} style={styles.productCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={styles.productTitle}>{product.productTitle}</div>
                      <div style={styles.productIsin}>{product.productIsin}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={styles.worstDistanceLabel}>{lang === 'fr' ? 'Pire Distance' : 'Worst Distance'}</div>
                      <div style={{
                        ...styles.worstDistanceValue,
                        color: product.worstDistance >= 0 ? '#10b981' : '#ef4444'
                      }}>
                        {product.worstDistance >= 0 ? '+' : ''}{product.worstDistance.toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  <div style={styles.atRiskLabel}>
                    {lang === 'fr' ? 'Sous-jacents à Risque' : 'At-Risk Underlyings'} ({product.atRiskUnderlyings.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {product.atRiskUnderlyings.map((underlying, uIdx) => (
                      <div key={uIdx} style={styles.underlyingChip}>
                        <span style={styles.underlyingSymbol}>{underlying.symbol}</span>
                        <span style={{
                          color: underlying.distanceToBarrier >= 0 ? '#10b981' : '#ef4444',
                          fontWeight: '600'
                        }}>
                          {underlying.distanceToBarrier >= 0 ? '+' : ''}{underlying.distanceToBarrier.toFixed(1)}%
                        </span>
                        <span style={getRiskBadgeStyle(underlying.riskLevel)}>
                          {underlying.riskLevel}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detailed Analysis Section */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>{lang === 'fr' ? 'Analyse Détaillée par Sous-jacent' : 'Detailed Analysis by Underlying'}</h2>

          {analyses.map((analysis, index) => (
            <div
              key={analysis.symbol}
              className="risk-analysis-item"
              style={{
                ...styles.analysisCard,
                pageBreakBefore: index > 0 ? 'always' : 'auto'
              }}
            >
              {/* Analysis Header */}
              <div style={styles.analysisHeader}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                    <h3 style={styles.analysisSymbol}>{analysis.symbol}</h3>
                    <span style={getRiskBadgeStyle(analysis.riskLevel)}>
                      {analysis.riskLevel} risk
                    </span>
                  </div>
                  <p style={styles.analysisCompany}>{analysis.companyName}</p>
                </div>
              </div>

              {/* Key Metrics */}
              <div style={styles.metricsGrid}>
                <div style={styles.metricItem}>
                  <div style={styles.metricLabel}>{tr.currentLevel}</div>
                  <div style={styles.metricValue}>{analysis.currentPrice.toFixed(2)}</div>
                </div>
                <div style={styles.metricItem}>
                  <div style={styles.metricLabel}>{lang === 'fr' ? 'Prix Barrière' : 'Barrier Price'}</div>
                  <div style={{ ...styles.metricValue, color: '#ef4444' }}>
                    {analysis.barrierPrice.toFixed(2)}
                  </div>
                </div>
                <div style={styles.metricItem}>
                  <div style={styles.metricLabel}>{tr.performance}</div>
                  <div style={{
                    ...styles.metricValue,
                    color: analysis.performance >= 0 ? '#10b981' : '#ef4444'
                  }}>
                    {analysis.performance >= 0 ? '+' : ''}{analysis.performance.toFixed(2)}%
                  </div>
                </div>
                <div style={styles.metricItem}>
                  <div style={styles.metricLabel}>{tr.barrierDistance}</div>
                  <div style={{
                    ...styles.metricValue,
                    color: analysis.distanceToBarrier >= 0 ? '#10b981' : '#ef4444'
                  }}>
                    {analysis.distanceToBarrier >= 0 ? '+' : ''}{analysis.distanceToBarrier.toFixed(1)}%
                  </div>
                </div>
                <div style={styles.metricItem}>
                  <div style={styles.metricLabel}>{lang === 'fr' ? 'Jours Restants' : 'Days Remaining'}</div>
                  <div style={styles.metricValue}>{analysis.daysRemaining}</div>
                </div>
              </div>

              {/* Amberlake Comment */}
              <div style={styles.aiAnalysisBox}>
                <h4 style={styles.aiAnalysisTitle}>{lang === 'fr' ? 'Commentaire Amberlake' : 'Amberlake Comment'}</h4>
                <div style={styles.aiAnalysisText}>
                  {analysis.analysis}
                </div>
              </div>

              {/* Affected Products */}
              {analysis.products && analysis.products.length > 0 && (
                <div style={styles.affectedProducts}>
                  <h4 style={styles.affectedProductsTitle}>
                    {lang === 'fr' ? 'Produits Affectés' : 'Affected Products'} ({analysis.products.length})
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {analysis.products.map((product, idx) => (
                      <div key={idx} style={styles.affectedProductItem}>
                        <div>
                          <div style={styles.affectedProductName}>{product.productTitle}</div>
                          <div style={styles.affectedProductIsin}>{product.productIsin}</div>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '0.8rem' }}>
                          <div style={{
                            color: product.distanceToBarrier >= 0 ? '#10b981' : '#ef4444',
                            fontWeight: '600'
                          }}>
                            {product.distanceToBarrier >= 0 ? '+' : ''}{product.distanceToBarrier.toFixed(1)}%
                          </div>
                          <div style={{ color: '#6b7280' }}>{product.daysRemaining}d</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <p style={{ margin: '0 0 0.5rem 0' }}>
            {lang === 'fr'
              ? 'Ce rapport a été généré en utilisant l\'analyse Amberlake'
              : 'This report was generated using Amberlake analysis'}
          </p>
          <p style={{ margin: 0 }}>
            {tr.generatedBy} - {formatShortDate(new Date(), lang)}
          </p>
        </div>
      </div>
    </>
  );
};

// Styles
const styles = {
  container: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '10pt',
    lineHeight: 1.5,
    color: '#1f2937',
    background: 'white',
    padding: '2rem',
    maxWidth: '297mm',
    margin: '0 auto',
    minHeight: '100vh'
  },
  header: {
    borderBottom: '3px solid #1e3a5f',
    paddingBottom: '1.5rem',
    marginBottom: '2rem'
  },
  title: {
    margin: '0 0 0.25rem 0',
    fontSize: '1.75rem',
    fontWeight: '700',
    color: '#ef4444'
  },
  subtitle: {
    margin: '0 0 0.5rem 0',
    fontSize: '1rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  generatedAt: {
    margin: 0,
    fontSize: '0.875rem',
    color: '#9ca3af'
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '1rem',
    marginBottom: '2rem'
  },
  summaryCard: {
    background: '#f9fafb',
    borderRadius: '12px',
    padding: '1rem',
    border: '1px solid #e5e7eb',
    textAlign: 'center'
  },
  summaryLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.25rem',
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: '0.5px'
  },
  summaryValue: {
    fontSize: '1.75rem',
    fontWeight: '700',
    color: '#1f2937'
  },
  summarySubtext: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },
  executiveSummary: {
    background: '#fffbeb',
    borderLeft: '4px solid #f59e0b',
    borderRadius: '8px',
    padding: '1.5rem',
    marginBottom: '2rem'
  },
  executiveSummaryTitle: {
    margin: '0 0 1rem 0',
    fontSize: '1.25rem',
    fontWeight: '700',
    color: '#f59e0b'
  },
  executiveSummaryText: {
    fontSize: '0.95rem',
    lineHeight: '1.7',
    color: '#374151',
    whiteSpace: 'pre-wrap'
  },
  impactedProductsSection: {
    background: '#eff6ff',
    borderLeft: '4px solid #3b82f6',
    borderRadius: '8px',
    padding: '1.5rem',
    marginBottom: '2rem'
  },
  impactedProductsTitle: {
    margin: '0 0 1rem 0',
    fontSize: '1.25rem',
    fontWeight: '700',
    color: '#3b82f6'
  },
  productCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '1rem'
  },
  productTitle: {
    fontWeight: '700',
    fontSize: '1rem',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  productIsin: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    fontFamily: 'monospace'
  },
  worstDistanceLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  worstDistanceValue: {
    fontSize: '1.125rem',
    fontWeight: '700'
  },
  atRiskLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.5rem',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  underlyingChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.375rem 0.75rem',
    background: '#f9fafb',
    borderRadius: '6px',
    fontSize: '0.85rem'
  },
  underlyingSymbol: {
    fontWeight: '600',
    color: '#1f2937'
  },
  section: {
    marginBottom: '2rem'
  },
  sectionTitle: {
    margin: '0 0 1.5rem 0',
    fontSize: '1.5rem',
    fontWeight: '700',
    color: '#1f2937',
    borderBottom: '2px solid #1e3a5f',
    paddingBottom: '0.5rem'
  },
  analysisCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    marginBottom: '1.5rem',
    overflow: 'hidden'
  },
  analysisHeader: {
    padding: '1.25rem',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb'
  },
  analysisSymbol: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: '700',
    color: '#1f2937'
  },
  analysisCompany: {
    margin: 0,
    fontSize: '0.9rem',
    color: '#6b7280'
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '1rem',
    padding: '1rem 1.25rem',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb'
  },
  metricItem: {},
  metricLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  metricValue: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  aiAnalysisBox: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '1.25rem',
    margin: '1.25rem'
  },
  aiAnalysisTitle: {
    margin: '0 0 1rem 0',
    fontSize: '1rem',
    fontWeight: '600',
    color: '#8b5cf6'
  },
  aiAnalysisText: {
    fontSize: '0.925rem',
    lineHeight: '1.7',
    color: '#374151',
    whiteSpace: 'pre-wrap'
  },
  affectedProducts: {
    padding: '0 1.25rem 1.25rem'
  },
  affectedProductsTitle: {
    margin: '0 0 0.75rem 0',
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#6b7280'
  },
  affectedProductItem: {
    padding: '0.75rem',
    background: '#f9fafb',
    borderRadius: '6px',
    fontSize: '0.85rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  affectedProductName: {
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  affectedProductIsin: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    fontFamily: 'monospace'
  },
  footer: {
    marginTop: '3rem',
    paddingTop: '2rem',
    borderTop: '2px solid #1e3a5f',
    textAlign: 'center',
    color: '#6b7280',
    fontSize: '0.85rem',
    background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
    padding: '1.5rem',
    marginLeft: '-2rem',
    marginRight: '-2rem',
    marginBottom: '-2rem',
    paddingLeft: '2rem',
    paddingRight: '2rem'
  }
};

export default RiskAnalysisPDF;
