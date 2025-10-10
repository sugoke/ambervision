import React, { useState, useCallback } from 'react';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';

const FileUploadDropzone = ({ 
  onFileSelect, 
  acceptedTypes = ['.xlsx', '.xls', '.csv'], 
  maxSize = 10 * 1024 * 1024, // 10MB default
  multiple = false,
  disabled = false 
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { dialogState, showError, hideDialog } = useDialog();

  const validateFile = (file) => {
    const errors = [];
    
    // Check file size
    if (file.size > maxSize) {
      errors.push(`File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds maximum allowed size (${(maxSize / 1024 / 1024).toFixed(1)}MB)`);
    }
    
    // Check file type
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    if (!acceptedTypes.includes(fileExtension)) {
      errors.push(`File type '${fileExtension}' is not supported. Allowed types: ${acceptedTypes.join(', ')}`);
    }
    
    return errors;
  };

  const handleFiles = useCallback(async (files) => {
    if (disabled || isProcessing) return;
    
    setIsProcessing(true);
    const fileArray = Array.from(files);
    
    try {
      if (!multiple && fileArray.length > 1) {
        throw new Error('Only one file is allowed');
      }
      
      const validatedFiles = [];
      const allErrors = [];
      
      for (const file of fileArray) {
        const errors = validateFile(file);
        if (errors.length > 0) {
          allErrors.push(`${file.name}: ${errors.join(', ')}`);
        } else {
          validatedFiles.push(file);
        }
      }
      
      if (allErrors.length > 0) {
        throw new Error(allErrors.join('\n'));
      }
      
      if (validatedFiles.length > 0) {
        await onFileSelect(multiple ? validatedFiles : validatedFiles[0]);
      }
    } catch (error) {
      console.error('File upload error:', error);
      showError(`File upload error:\n${error.message}`, 'File Upload Error');
    } finally {
      setIsProcessing(false);
    }
  }, [onFileSelect, acceptedTypes, maxSize, multiple, disabled, isProcessing]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isProcessing) {
      setIsDragOver(true);
    }
  }, [disabled, isProcessing]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    if (disabled || isProcessing) return;
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  }, [handleFiles, disabled, isProcessing]);

  const handleFileInput = useCallback((e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
    // Clear the input so the same file can be selected again
    e.target.value = '';
  }, [handleFiles]);

  const getDropzoneStyle = () => {
    let baseStyle = {
      border: '2px dashed var(--border-color)',
      borderRadius: '12px',
      padding: '3rem 2rem',
      textAlign: 'center',
      cursor: disabled || isProcessing ? 'not-allowed' : 'pointer',
      transition: 'all 0.3s ease',
      background: 'var(--bg-primary)',
      position: 'relative',
      overflow: 'hidden'
    };

    if (isDragOver && !disabled && !isProcessing) {
      baseStyle = {
        ...baseStyle,
        borderColor: 'var(--accent-color)',
        backgroundColor: 'rgba(0, 123, 255, 0.05)',
        transform: 'scale(1.02)'
      };
    }

    if (disabled || isProcessing) {
      baseStyle = {
        ...baseStyle,
        opacity: 0.6,
        backgroundColor: 'var(--bg-secondary)'
      };
    }

    return baseStyle;
  };

  return (
    <div
      style={getDropzoneStyle()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => {
        if (!disabled && !isProcessing) {
          document.getElementById('file-input').click();
        }
      }}
    >
      {/* Hidden file input */}
      <input
        id="file-input"
        type="file"
        accept={acceptedTypes.join(',')}
        multiple={multiple}
        onChange={handleFileInput}
        style={{ display: 'none' }}
        disabled={disabled || isProcessing}
      />

      {/* Loading overlay */}
      {isProcessing && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10
        }}>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '4px solid var(--border-color)',
              borderTop: '4px solid var(--accent-color)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}></div>
            <span style={{
              color: 'var(--text-primary)',
              fontWeight: '600'
            }}>
              Processing file...
            </span>
          </div>
        </div>
      )}

      {/* Dropzone content */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.5rem'
      }}>
        {/* Icon */}
        <div style={{
          fontSize: '2.5rem',
          opacity: disabled || isProcessing ? 0.5 : isDragOver ? 1 : 0.7,
          transition: 'all 0.3s ease',
          transform: isDragOver ? 'scale(1.1)' : 'scale(1)'
        }}>
          📊
        </div>

        {/* Main text */}
        <div>
          <h3 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '1.3rem',
            fontWeight: '600',
            color: 'var(--text-primary)',
            opacity: disabled || isProcessing ? 0.5 : 1
          }}>
            {isDragOver 
              ? 'Drop your file here' 
              : 'Drag & drop your file here'
            }
          </h3>
          <p style={{
            margin: '0 0 1rem 0',
            color: 'var(--text-secondary)',
            fontSize: '1rem',
            opacity: disabled || isProcessing ? 0.5 : 1
          }}>
            or click to browse and select
          </p>
        </div>

        {/* File info */}
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1rem 1.5rem',
          width: '100%',
          maxWidth: '400px'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '0.5rem 1rem',
            fontSize: '0.85rem',
            color: 'var(--text-secondary)'
          }}>
            <span style={{ fontWeight: '600' }}>Accepted formats:</span>
            <span>{acceptedTypes.join(', ')}</span>
            
            <span style={{ fontWeight: '600' }}>Maximum size:</span>
            <span>{(maxSize / 1024 / 1024).toFixed(1)}MB</span>
            
            <span style={{ fontWeight: '600' }}>Multiple files:</span>
            <span>{multiple ? 'Yes' : 'No'}</span>
          </div>
        </div>

        {/* Browse button */}
        <button
          type="button"
          disabled={disabled || isProcessing}
          style={{
            background: disabled || isProcessing 
              ? 'var(--text-muted)' 
              : 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            color: 'white',
            border: 'none',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: disabled || isProcessing ? 'not-allowed' : 'pointer',
            transition: 'all 0.3s ease'
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled && !isProcessing) {
              document.getElementById('file-input').click();
            }
          }}
        >
          {isProcessing ? 'Processing...' : 'Browse Files'}
        </button>
      </div>

      {/* Add CSS animation for loading spinner */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      
      <Dialog
        isOpen={dialogState.isOpen}
        onClose={hideDialog}
        title={dialogState.title}
        message={dialogState.message}
        type={dialogState.type}
        onConfirm={dialogState.onConfirm}
        onCancel={dialogState.onCancel}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        showCancel={dialogState.showCancel}
      />
    </div>
  );
};

export default FileUploadDropzone;