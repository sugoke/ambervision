import React, { useState, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTheme } from '../ThemeContext.jsx';

/**
 * TermSheetUploader Component
 *
 * Allows users to upload PDF term sheets for automatic product data extraction.
 * Features:
 * - Drag & drop file upload
 * - Template selection (Phoenix, Orion, Himalaya, Shark Note)
 * - Multi-stage animated progress bar
 * - Error handling with user-friendly messages
 * - Success callback to open extracted product in editor
 */
const TermSheetUploader = ({ onProductExtracted, sessionId }) => {
  const { theme } = useTheme();
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState('phoenix_autocallable');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [error, setError] = useState(null);

  // Available templates
  const templates = [
    { id: 'phoenix_autocallable', name: 'Phoenix Autocallable', icon: '🔥' },
    { id: 'orion_memory', name: 'Orion', icon: '⭐' },
    { id: 'himalaya', name: 'Himalaya', icon: '🏔️' },
    { id: 'shark_note', name: 'Shark Note', icon: '🦈' },
    { id: 'participation_note', name: 'Participation Note', icon: '📈' },
    { id: 'reverse_convertible', name: 'Reverse Convertible', icon: '🔄' }
  ];

  // Progress stages with percentage milestones
  const progressStages = [
    { stage: 'uploading', label: '📄 Uploading file...', percent: 10 },
    { stage: 'analyzing', label: '🔍 Analyzing term sheet...', percent: 30 },
    { stage: 'extracting', label: '📊 Extracting data...', percent: 70 },
    { stage: 'creating', label: '✅ Creating product...', percent: 90 },
    { stage: 'done', label: '🎉 Done!', percent: 100 }
  ];

  // Convert file to base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Remove data:application/pdf;base64, prefix
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Update progress stage
  const updateProgressStage = (stageIndex) => {
    const stage = progressStages[stageIndex];
    setProgressStage(stage.label);
    setProgress(stage.percent);
  };

  // Handle file selection
  const handleFileSelect = useCallback((file) => {
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf') {
      setError('Please select a PDF file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    setSelectedFile(file);
    setError(null);
  }, []);

  // Handle drag events
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  // Handle file input change
  const handleFileInputChange = (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  // Handle upload and extraction
  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file');
      return;
    }

    if (!selectedTemplate) {
      setError('Please select a template');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProgress(0);

    try {
      // Stage 1: Uploading file (10%)
      updateProgressStage(0);
      const base64Data = await fileToBase64(selectedFile);

      // Stage 2: Analyzing term sheet (30%)
      setTimeout(() => updateProgressStage(1), 500);

      // Stage 3: Extracting data (70%)
      setTimeout(() => updateProgressStage(2), 1000);

      // Call Meteor method
      Meteor.call(
        'termSheet.extract',
        base64Data,
        selectedTemplate,
        sessionId,
        (error, result) => {
          if (error) {
            console.error('[TermSheetUploader] Extraction error:', error);
            setIsProcessing(false);
            setProgress(0);
            setProgressStage('');

            // User-friendly error messages
            if (error.error === 'duplicate-isin') {
              setError(error.reason || 'A product with this ISIN already exists in the database.');
            } else if (error.error === 'anthropic-auth-failed') {
              setError('Authentication failed. Please check API configuration.');
            } else if (error.error === 'anthropic-rate-limit') {
              setError('Rate limit exceeded. Please wait a moment and try again.');
            } else if (error.error === 'template-not-found') {
              setError('Template not found. Please select a different template.');
            } else {
              setError(error.reason || 'Failed to extract term sheet. Please try again.');
            }
            return;
          }

          // Stage 4: Creating product (90%)
          updateProgressStage(3);

          // Stage 5: Done (100%)
          setTimeout(() => {
            updateProgressStage(4);

            // Wait a moment to show success, then call callback
            setTimeout(() => {
              setIsProcessing(false);
              setProgress(0);
              setProgressStage('');
              setSelectedFile(null);

              // Call success callback with extracted product
              if (onProductExtracted) {
                onProductExtracted(result.productId, result.extractedData);
              }
            }, 1000);
          }, 500);
        }
      );
    } catch (err) {
      console.error('[TermSheetUploader] Upload error:', err);
      setIsProcessing(false);
      setProgress(0);
      setProgressStage('');
      setError('Failed to process file. Please try again.');
    }
  };

  return (
    <div style={{
      padding: '2rem',
      background: theme === 'light' ? 'rgba(255, 255, 255, 0.95)' : 'var(--bg-secondary)',
      borderRadius: '12px',
      border: `2px solid ${theme === 'light' ? '#e5e7eb' : 'var(--border-color)'}`,
      backdropFilter: 'blur(10px)',
      maxWidth: '600px',
      margin: '0 auto'
    }}>
      <h3 style={{
        margin: '0 0 1.5rem 0',
        fontSize: '1.5rem',
        fontWeight: '600',
        color: 'var(--text-primary)',
        textAlign: 'center'
      }}>
        Upload Term Sheet
      </h3>

      {/* Template Selection */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{
          display: 'block',
          marginBottom: '0.5rem',
          fontSize: '0.875rem',
          fontWeight: '500',
          color: 'var(--text-secondary)'
        }}>
          Product Template
        </label>
        <select
          value={selectedTemplate}
          onChange={(e) => setSelectedTemplate(e.target.value)}
          disabled={isProcessing}
          style={{
            width: '100%',
            padding: '0.75rem',
            fontSize: '1rem',
            border: `1px solid ${theme === 'light' ? '#d1d5db' : 'var(--border-color)'}`,
            borderRadius: '8px',
            background: theme === 'light' ? '#ffffff' : 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            opacity: isProcessing ? 0.5 : 1
          }}
        >
          {templates.map(template => (
            <option key={template.id} value={template.id}>
              {template.icon} {template.name}
            </option>
          ))}
        </select>
      </div>

      {/* File Drop Zone */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${isDragging ? '#3b82f6' : (theme === 'light' ? '#d1d5db' : 'var(--border-color)')}`,
          borderRadius: '12px',
          padding: '2rem',
          textAlign: 'center',
          background: isDragging
            ? (theme === 'light' ? '#eff6ff' : 'rgba(59, 130, 246, 0.1)')
            : (theme === 'light' ? '#f9fafb' : 'var(--bg-tertiary)'),
          transition: 'all 0.2s ease',
          cursor: isProcessing ? 'not-allowed' : 'pointer',
          opacity: isProcessing ? 0.5 : 1,
          marginBottom: '1.5rem'
        }}
      >
        <input
          type="file"
          accept="application/pdf"
          onChange={handleFileInputChange}
          disabled={isProcessing}
          style={{ display: 'none' }}
          id="file-upload-input"
        />

        {selectedFile ? (
          <div>
            <div style={{
              fontSize: '3rem',
              marginBottom: '0.5rem'
            }}>
              📄
            </div>
            <p style={{
              margin: '0 0 0.5rem 0',
              fontSize: '1rem',
              fontWeight: '500',
              color: 'var(--text-primary)'
            }}>
              {selectedFile.name}
            </p>
            <p style={{
              margin: 0,
              fontSize: '0.875rem',
              color: 'var(--text-secondary)'
            }}>
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
            {!isProcessing && (
              <button
                onClick={() => setSelectedFile(null)}
                style={{
                  marginTop: '0.75rem',
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: `1px solid ${theme === 'light' ? '#d1d5db' : 'var(--border-color)'}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.target.style.background = theme === 'light' ? '#f3f4f6' : 'var(--bg-secondary)';
                }}
                onMouseOut={(e) => {
                  e.target.style.background = 'transparent';
                }}
              >
                Remove
              </button>
            )}
          </div>
        ) : (
          <label htmlFor="file-upload-input" style={{ cursor: isProcessing ? 'not-allowed' : 'pointer' }}>
            <div style={{
              fontSize: '3rem',
              marginBottom: '0.5rem'
            }}>
              📎
            </div>
            <p style={{
              margin: '0 0 0.5rem 0',
              fontSize: '1rem',
              fontWeight: '500',
              color: 'var(--text-primary)'
            }}>
              Drag & drop PDF here
            </p>
            <p style={{
              margin: 0,
              fontSize: '0.875rem',
              color: 'var(--text-secondary)'
            }}>
              or click to browse
            </p>
          </label>
        )}
      </div>

      {/* Progress Bar */}
      {isProcessing && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{
            marginBottom: '0.5rem',
            fontSize: '0.875rem',
            fontWeight: '500',
            color: 'var(--text-primary)',
            textAlign: 'center'
          }}>
            {progressStage}
          </div>
          <div style={{
            width: '100%',
            height: '8px',
            background: theme === 'light' ? '#e5e7eb' : 'var(--bg-tertiary)',
            borderRadius: '4px',
            overflow: 'hidden',
            position: 'relative'
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #3b82f6 0%, #10b981 100%)',
              borderRadius: '4px',
              transition: 'width 0.5s ease',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Animated shimmer effect */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                animation: 'shimmer 1.5s infinite',
                transform: 'translateX(-100%)'
              }} />
            </div>
          </div>
          <div style={{
            marginTop: '0.5rem',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            textAlign: 'center'
          }}>
            {progress}%
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div style={{
          padding: '1rem',
          background: theme === 'light' ? '#fee2e2' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${theme === 'light' ? '#fca5a5' : '#ef4444'}`,
          borderRadius: '8px',
          marginBottom: '1.5rem'
        }}>
          <p style={{
            margin: 0,
            fontSize: '0.875rem',
            color: theme === 'light' ? '#991b1b' : '#fca5a5',
            fontWeight: '500'
          }}>
            {error}
          </p>
        </div>
      )}

      {/* Upload Button */}
      <button
        onClick={handleUpload}
        disabled={!selectedFile || isProcessing}
        style={{
          width: '100%',
          padding: '0.875rem',
          fontSize: '1rem',
          fontWeight: '600',
          background: (!selectedFile || isProcessing)
            ? (theme === 'light' ? '#d1d5db' : 'var(--bg-tertiary)')
            : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          color: (!selectedFile || isProcessing) ? 'var(--text-secondary)' : '#ffffff',
          border: 'none',
          borderRadius: '8px',
          cursor: (!selectedFile || isProcessing) ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s ease',
          boxShadow: (!selectedFile || isProcessing) ? 'none' : '0 4px 6px rgba(59, 130, 246, 0.2)'
        }}
        onMouseOver={(e) => {
          if (selectedFile && !isProcessing) {
            e.target.style.transform = 'translateY(-1px)';
            e.target.style.boxShadow = '0 6px 12px rgba(59, 130, 246, 0.3)';
          }
        }}
        onMouseOut={(e) => {
          if (selectedFile && !isProcessing) {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = '0 4px 6px rgba(59, 130, 246, 0.2)';
          }
        }}
      >
        {isProcessing ? 'Processing...' : 'Extract Product Data'}
      </button>

      {/* Shimmer animation keyframes */}
      <style>{`
        @keyframes shimmer {
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  );
};

export default TermSheetUploader;
