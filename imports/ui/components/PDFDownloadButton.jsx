import React, { useState } from 'react';
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
  options = {},
  contentSelector = '.report-content', // Selector for the content to convert to PDF
  iconOnly = false, // When true, only show icon (title becomes tooltip)
  showLanguageSelector = true // Whether to show language selection modal
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [showLangModal, setShowLangModal] = useState(false);

  const handleDownloadClick = () => {
    if (showLanguageSelector) {
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
        options: { title: filename || 'Report', ...options }
      });

      console.log('[PDF] Received result type:', typeof result);

      // Handle both string and object responses
      let base64Data = result;
      if (typeof result === 'object' && result !== null) {
        base64Data = result.pdfData || result.data || result;
        console.log('[PDF] Extracted from object, keys were:', Object.keys(result));
      }

      if (!base64Data) {
        throw new Error('No PDF data received from server');
      }

      if (typeof base64Data !== 'string') {
        console.error('[PDF] Unexpected data type:', typeof base64Data, base64Data);
        throw new Error(`Unexpected data type: ${typeof base64Data}`);
      }

      // Clean the base64 string (remove any whitespace/newlines)
      const cleanBase64 = base64Data.replace(/[\s\n\r]/g, '');
      console.log('[PDF] Base64 length:', cleanBase64.length);
      console.log('[PDF] First 50 chars:', cleanBase64.substring(0, 50));

      // Validate it looks like a PDF (PDF files in base64 start with "JVBERi" which is "%PDF-")
      if (!cleanBase64.startsWith('JVBERi')) {
        console.error('[PDF] Data does not appear to be a PDF. First 200 chars:', cleanBase64.substring(0, 200));
        // Try to decode and see what the content is
        try {
          const decoded = atob(cleanBase64.substring(0, 100));
          console.error('[PDF] Decoded start:', decoded);
        } catch (e) {
          console.error('[PDF] Could not decode sample');
        }
        throw new Error('Server did not return valid PDF data. Check server logs.');
      }

      // Convert base64 to blob and trigger download
      const byteCharacters = atob(cleanBase64);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      // Create download link and trigger
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename || 'report'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('[PDF] Download triggered successfully');

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
          maxWidth: '320px',
          width: '90%',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          pointerEvents: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
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
            type="button"
            style={{
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
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
            type="button"
            style={{
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
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

  return (
    <div style={{ display: 'inline-block', position: 'relative' }}>
      {/* Language Selection Modal - rendered via Portal */}
      {languageModal}

      <button
        onClick={handleDownloadClick}
        disabled={isGenerating}
        className={`pdf-download-button ${className}`}
        style={{
          padding: iconOnly ? '0' : '0.65rem 1.25rem',
          background: isGenerating
            ? 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)'
            : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
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
        `}
      </style>
    </div>
  );
};

export default PDFDownloadButton;
