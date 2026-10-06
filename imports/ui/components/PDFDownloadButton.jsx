import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Meteor } from 'meteor/meteor';
import { translations, getTranslation } from '../../utils/reportTranslations';

/**
 * PDF Download Button Component
 *
 * Uses server-side Puppeteer to generate high-quality PDFs
 * with proper page breaks and accurate rendering.
 * Supports language selection (English/French) for reports.
 */
const PDFDownloadButton = ({
  reportId,
  reportType = 'template',
  filename,
  title = 'Download PDF',
  className = '',
  style = {},
  wrapperStyle = {}, // Overrides for the positioning wrapper (e.g. to let the
                     // button stretch to a full-width column on mobile)
  options = {},
  contentSelector = '.report-content', // Selector for the content to convert to PDF
  iconOnly = false, // When true, only show icon (title becomes tooltip)
  showLanguageSelector = true, // Whether to show language selection modal
  onDownloaded = null, // Optional callback fired after a successful PDF download
  progressLabel = null, // Text of the progress overlay; defaults per reportType
  sectionChoices = null // Optional [{ key, label, required }]: ticked sections go to the server as options.sections
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [showLangModal, setShowLangModal] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [selectedSections, setSelectedSections] = useState(() => (sectionChoices || []).map(s => s.key));
  const hasSections = Array.isArray(sectionChoices) && sectionChoices.length > 0;
  const noSectionTicked = hasSections && !sectionChoices.some(s => !s.required && selectedSections.includes(s.key));
  const toggleSection = (key) => setSelectedSections(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));

  // Seconds since generation started, shown in the progress overlay
  useEffect(() => {
    if (!isGenerating) return undefined;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [isGenerating]);

  const handleDownloadClick = () => {
    if (showLanguageSelector || hasSections) {
      setShowLangModal(true);
    } else {
      handleDownloadPDF('en');
    }
  };

  const handleDownloadPDF = async (lang = 'en') => {
    setShowLangModal(false);
    setIsGenerating(true);
    setError(null);

    try {
      console.log('[PDF] Generating PDF via server-side Puppeteer, language:', lang);

      const sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        throw new Error('Please log in to download PDFs');
      }

      // Call server-side Puppeteer method with language
      const result = await Meteor.callAsync('pdf.generateReport', {
        reportId,
        reportType,
        sessionId,
        lang,
        options: {
          title: filename || 'Report',
          ...options,
          ...(hasSections ? { sections: sectionChoices.filter(s => s.required || selectedSections.includes(s.key)).map(s => s.key) } : {})
        }
      });

      console.log('[PDF] Received result type:', typeof result);

      // The server writes the PDF to a temporary store and hands back a
      // short-lived, token-gated URL. Big reports (a consolidated PMS report
      // runs to double-digit MB) are streamed over HTTP; sending them back
      // through DDP used to take the server down with them.
      if (!result || typeof result !== 'object' || !result.downloadUrl) {
        console.error('[PDF] Unexpected response from server:', result);
        throw new Error('Server did not return a download link. Check server logs.');
      }

      console.log('[PDF] Export ready, size:', result.fileSize, 'bytes');

      const a = document.createElement('a');
      a.href = result.downloadUrl;
      a.download = `${filename || 'report'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      console.log('[PDF] Download triggered successfully');

      // Notify parent so it can trigger companion exports (e.g. Excel)
      if (onDownloaded) {
        try {
          onDownloaded(lang);
        } catch (callbackErr) {
          console.error('[PDF] onDownloaded callback failed:', callbackErr);
        }
      }

    } catch (err) {
      console.error('[PDF] Error generating PDF:', err);
      setError(err.reason || err.message || 'Failed to generate PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  // Language Selection Modal - rendered via Portal to escape stacking contexts
  const languageModal = showLangModal && createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2147483647,
        pointerEvents: 'auto'
      }}
      onClick={() => setShowLangModal(false)}
    >
      <div
        style={{
          background: 'var(--bg-primary, #1f2937)',
          borderRadius: '12px',
          padding: '1.5rem',
          maxWidth: hasSections ? '380px' : '320px',
          width: '90%',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          pointerEvents: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {hasSections && (
          <div style={{ marginBottom: '1.25rem' }}>
            <h3 style={{
              margin: '0 0 0.75rem 0',
              fontSize: '1.1rem',
              fontWeight: '600',
              color: 'var(--text-primary, white)',
              textAlign: 'center'
            }}>
              Sections to include
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {sectionChoices.map(s => (
                <label
                  key={s.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color, #4b5563)',
                    cursor: s.required ? 'default' : 'pointer',
                    fontSize: '0.9rem',
                    color: s.required ? 'var(--text-muted, #9ca3af)' : 'var(--text-primary, white)'
                  }}
                  title={s.required ? 'Always included' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={s.required || selectedSections.includes(s.key)}
                    disabled={s.required}
                    onChange={() => toggleSection(s.key)}
                  />
                  <span>{s.label}</span>
                  {s.required && <span style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>always</span>}
                </label>
              ))}
            </div>
            {noSectionTicked && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--warning-color, #f59e0b)', textAlign: 'center' }}>
                Tick at least one section.
              </div>
            )}
          </div>
        )}
        <h3 style={{
          margin: '0 0 1rem 0',
          fontSize: '1.1rem',
          fontWeight: '600',
          color: 'var(--text-primary, white)',
          textAlign: 'center'
        }}>
          {translations.en.selectReportLanguage}
        </h3>
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          justifyContent: 'center'
        }}>
          <button
            onClick={() => handleDownloadPDF('en')}
            disabled={noSectionTicked}
            type="button"
            style={{
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, var(--info-color) 0%, #2563eb 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: noSectionTicked ? 'not-allowed' : 'pointer',
              opacity: noSectionTicked ? 0.5 : 1,
              fontSize: '0.95rem',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'transform 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            🇬🇧 {translations.en.english}
          </button>
          <button
            onClick={() => handleDownloadPDF('fr')}
            disabled={noSectionTicked}
            type="button"
            style={{
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, var(--info-color) 0%, #2563eb 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: noSectionTicked ? 'not-allowed' : 'pointer',
              opacity: noSectionTicked ? 0.5 : 1,
              fontSize: '0.95rem',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'transform 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            🇫🇷 {translations.fr.french}
          </button>
        </div>
        <button
          onClick={() => setShowLangModal(false)}
          type="button"
          style={{
            marginTop: '1rem',
            width: '100%',
            padding: '0.5rem',
            background: 'transparent',
            border: '1px solid var(--border-color, #4b5563)',
            borderRadius: '6px',
            color: 'var(--text-secondary, #9ca3af)',
            cursor: 'pointer',
            fontSize: '0.85rem'
          }}
        >
          {translations.en.cancel}
        </button>
      </div>
    </div>,
    document.body
  );

  // Progress overlay while the server renders the PDF. The server reports no
  // intermediate steps, so this shows activity and elapsed time, not a percentage.
  const PROGRESS_LABELS = {
    pms: 'Generating portfolio statement',
    template: 'Generating product report',
    'risk-analysis': 'Generating risk analysis',
    'portfolio-review': 'Generating portfolio review'
  };
  const progressOverlay = isGenerating && createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2147483646
      }}
    >
      <div style={{
        background: 'var(--bg-primary, #1f2937)',
        border: '1px solid var(--border-color, #374151)',
        borderRadius: '14px',
        padding: '1.75rem 2.25rem',
        minWidth: '280px',
        maxWidth: '90vw',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.9rem',
        textAlign: 'center'
      }}>
        <div className="pdf-progress-spinner" />
        <div style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-primary, white)' }}>
          {progressLabel || PROGRESS_LABELS[reportType] || 'Generating PDF'}…
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #9ca3af)', fontVariantNumeric: 'tabular-nums' }}>
          {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, '0')}s`} elapsed
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9ca3af)', maxWidth: '260px' }}>
          The download starts automatically when the file is ready.
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <div style={{ display: 'inline-block', position: 'relative', ...wrapperStyle }}>
      {/* Language Selection Modal - rendered via Portal */}
      {languageModal}
      {progressOverlay}

      <button
        onClick={handleDownloadClick}
        disabled={isGenerating}
        className={`pdf-download-button ${className}`}
        style={{
          padding: iconOnly ? '0' : '0.65rem 1.25rem',
          background: isGenerating
            ? 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)'
            : 'linear-gradient(135deg, var(--loss-color) 0%, #dc2626 100%)',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: isGenerating ? 'not-allowed' : 'pointer',
          fontSize: '0.95rem',
          fontWeight: '500',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          ...style
        }}
        onMouseEnter={(e) => {
          if (!isGenerating) {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        }}
        title={iconOnly ? title : undefined}
      >
        {isGenerating ? (
          <>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              style={{
                animation: 'spin 1s linear infinite'
              }}
            >
              <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="2" strokeDasharray="10 5" />
            </svg>
            {!iconOnly && <span>Generating PDF...</span>}
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 11v2a2 2 0 002 2h8a2 2 0 002-2v-2M11 8l-3 3m0 0L5 8m3 3V2"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {!iconOnly && <span>{title}</span>}
          </>
        )}
      </button>

      {error && (
        <div
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: '4px',
            color: '#dc2626',
            fontSize: '0.85rem'
          }}
        >
          {error}
        </div>
      )}

      <style>
        {`
          @keyframes spin {
            from {
              transform: rotate(0deg);
            }
            to {
              transform: rotate(360deg);
            }
          }
          .pdf-progress-spinner {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            border: 4px solid var(--border-color, rgba(148, 163, 184, 0.3));
            border-top-color: var(--accent-color, #DD772A);
            animation: spin 0.9s linear infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .pdf-progress-spinner { animation-duration: 2.4s; }
          }
        `}
      </style>
    </div>
  );
};

export default PDFDownloadButton;
