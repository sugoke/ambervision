import React from 'react';
import RiskAnalysisReport from './RiskAnalysisReport.jsx';
import PDFDownloadButton from './PDFDownloadButton.jsx';
import { useTheme } from '../ThemeContext.jsx';

/**
 * RiskReportModal Component
 * Modal wrapper for the risk analysis report with print and export functionality
 */
const RiskReportModal = ({ report, onClose, isGenerating = false, progress = null }) => {
  const { isDarkMode } = useTheme();

  const handlePrint = () => {
    window.print();
  };

  const handleExport = () => {
    // Create a formatted text export of the report
    if (!report) return;

    let exportText = `PORTFOLIO RISK ANALYSIS REPORT\n`;
    exportText += `Generated: ${new Date(report.generatedAt).toLocaleString()}\n`;
    exportText += `${'='.repeat(80)}\n\n`;

    exportText += `SUMMARY\n`;
    exportText += `${'-'.repeat(80)}\n`;
    exportText += `Total At Risk: ${report.summary.totalAtRisk} positions\n`;
    exportText += `Unique Underlyings: ${report.summary.uniqueUnderlyings}\n`;
    exportText += `Critical Risk: ${report.summary.criticalRisk}\n`;
    exportText += `High Risk: ${report.summary.highRisk}\n`;
    exportText += `Average Distance to Barrier: ${report.summary.averageDistanceToBarrier.toFixed(1)}%\n`;
    exportText += `Average Days Remaining: ${Math.round(report.summary.averageDaysRemaining)}\n\n`;

    exportText += `EXECUTIVE SUMMARY\n`;
    exportText += `${'-'.repeat(80)}\n`;
    exportText += `${report.executiveSummary}\n\n`;

    exportText += `RECOMMENDATIONS\n`;
    exportText += `${'-'.repeat(80)}\n`;
    exportText += `${report.recommendations}\n\n`;

    exportText += `DETAILED ANALYSIS\n`;
    exportText += `${'='.repeat(80)}\n\n`;

    report.analyses.forEach((analysis, index) => {
      exportText += `${index + 1}. ${analysis.symbol} - ${analysis.companyName}\n`;
      exportText += `${'-'.repeat(80)}\n`;
      exportText += `Risk Level: ${analysis.riskLevel.toUpperCase()}\n`;
      exportText += `Current Price: ${analysis.currentPrice.toFixed(2)}\n`;
      exportText += `Barrier Price: ${analysis.barrierPrice.toFixed(2)}\n`;
      exportText += `Performance: ${analysis.performance >= 0 ? '+' : ''}${analysis.performance.toFixed(2)}%\n`;
      exportText += `Distance to Barrier: ${analysis.distanceToBarrier >= 0 ? '+' : ''}${analysis.distanceToBarrier.toFixed(1)}%\n`;
      exportText += `Days Remaining: ${analysis.daysRemaining}\n\n`;
      exportText += `Analysis:\n${analysis.analysis}\n\n`;

      if (analysis.products && analysis.products.length > 0) {
        exportText += `Affected Products (${analysis.products.length}):\n`;
        analysis.products.forEach(product => {
          exportText += `  - ${product.productTitle} (${product.productIsin})\n`;
          exportText += `    Distance: ${product.distanceToBarrier >= 0 ? '+' : ''}${product.distanceToBarrier.toFixed(1)}%, Days: ${product.daysRemaining}\n`;
        });
        exportText += `\n`;
      }

      exportText += `\n`;
    });

    // Create and download the file
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Risk_Analysis_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Print Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #risk-report-print-area, #risk-report-print-area * {
            visibility: visible;
          }
          #risk-report-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Modal Overlay */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(4px)'
        }}
        onClick={onClose}
      >
        {/* Modal Content */}
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
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with actions - No Print */}
          <div
            className="no-print"
            style={{
              padding: '1.5rem',
              borderBottom: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: isDarkMode ? '#111827' : '#f9fafb',
              borderTopLeftRadius: '16px',
              borderTopRightRadius: '16px'
            }}
          >
            <h2 style={{
              margin: 0,
              fontSize: '1.25rem',
              fontWeight: '700',
              color: isDarkMode ? '#e5e7eb' : '#1f2937'
            }}>
              {isGenerating ? 'Generating Risk Analysis Report...' : 'Risk Analysis Report'}
            </h2>

            {!isGenerating && report && (
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <PDFDownloadButton
                  reportId={report._id}
                  reportType="risk-analysis"
                  filename={`Risk_Analysis_${new Date().toISOString().split('T')[0]}`}
                  title="Download PDF"
                  style={{
                    padding: '0.625rem 1.25rem',
                    background: 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                />
                <button
                  onClick={handleExport}
                  style={{
                    padding: '0.625rem 1.25rem',
                    background: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#2563eb';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#3b82f6';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <span>💾</span> Export TXT
                </button>

                <button
                  onClick={handlePrint}
                  style={{
                    padding: '0.625rem 1.25rem',
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#059669';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#10b981';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <span>🖨️</span> Print
                </button>

                <button
                  onClick={onClose}
                  style={{
                    padding: '0.625rem 1.25rem',
                    background: isDarkMode ? '#374151' : '#e5e7eb',
                    color: isDarkMode ? '#e5e7eb' : '#1f2937',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = isDarkMode ? '#4b5563' : '#d1d5db';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isDarkMode ? '#374151' : '#e5e7eb';
                  }}
                >
                  Close
                </button>
              </div>
            )}

            {/* Close button when not generating and no report */}
            {!isGenerating && !report && (
              <button
                onClick={onClose}
                style={{
                  padding: '0.625rem 1.25rem',
                  background: isDarkMode ? '#374151' : '#e5e7eb',
                  color: isDarkMode ? '#e5e7eb' : '#1f2937',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isDarkMode ? '#4b5563' : '#d1d5db';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isDarkMode ? '#374151' : '#e5e7eb';
                }}
              >
                Close
              </button>
            )}
          </div>

          {/* Content Area - Scrollable */}
          <div
            id="risk-report-print-area"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 0
            }}
          >
            {isGenerating ? (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '400px',
                padding: '2rem',
                textAlign: 'center'
              }}>
                <div style={{
                  width: '60px',
                  height: '60px',
                  border: '4px solid ' + (isDarkMode ? '#374151' : '#e5e7eb'),
                  borderTopColor: '#3b82f6',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  marginBottom: '1.5rem'
                }}></div>

                <h3 style={{
                  margin: '0 0 1rem 0',
                  fontSize: '1.25rem',
                  fontWeight: '600',
                  color: isDarkMode ? '#e5e7eb' : '#1f2937'
                }}>
                  Analyzing Portfolio Risk
                </h3>

                {progress && (
                  <p style={{
                    margin: '0 0 1rem 0',
                    fontSize: '0.95rem',
                    color: isDarkMode ? '#9ca3af' : '#6b7280'
                  }}>
                    {progress}
                  </p>
                )}

                <p style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  color: isDarkMode ? '#6b7280' : '#9ca3af',
                  maxWidth: '500px'
                }}>
                  Amberlake is searching the web for recent news and generating detailed analysis for each at-risk underlying. This may take 10-30 seconds...
                </p>

                <style>{`
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                `}</style>
              </div>
            ) : report ? (
              <RiskAnalysisReport report={report} />
            ) : (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '400px',
                padding: '2rem',
                color: isDarkMode ? '#9ca3af' : '#6b7280'
              }}>
                <p>No report data available</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default RiskReportModal;
