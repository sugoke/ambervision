import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Meteor } from 'meteor/meteor';
import { USER_ROLES } from '../../api/users';

const TermSheetManager = ({ product, user, productId }) => {
  const [showModal, setShowModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const isAdmin = user && (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN);
  const hasTermSheet = product && product.termSheet && product.termSheet.url;

  const handleFileSelect = async (file) => {
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf') {
      setUploadError('Please upload a PDF file');
      return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError('File size must be less than 10MB');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = e.target.result.split(',')[1];
        const sessionId = localStorage.getItem('sessionId');

        // Call server method
        Meteor.call(
          'products.uploadTermSheet',
          productId,
          base64Data,
          file.name,
          sessionId,
          (error, result) => {
            setUploading(false);

            if (error) {
              console.error('Upload error:', error);
              setUploadError(error.reason || 'Failed to upload term sheet');
            } else {
              setUploadSuccess(true);
              setTimeout(() => {
                setShowModal(false);
                setUploadSuccess(false);
              }, 2000);
            }
          }
        );
      };

      reader.onerror = () => {
        setUploading(false);
        setUploadError('Failed to read file');
      };

      reader.readAsDataURL(file);
    } catch (error) {
      setUploading(false);
      setUploadError('Failed to upload term sheet');
      console.error('Upload error:', error);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleIconClick = () => {
    if (isAdmin) {
      setShowModal(true);
      setUploadError(null);
      setUploadSuccess(false);
    } else if (hasTermSheet) {
      // Non-admin users can download
      window.open(product.termSheet.url, '_blank');
    }
  };

  const handleDownload = () => {
    if (hasTermSheet) {
      window.open(product.termSheet.url, '_blank');
    }
  };

  const formatDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <>
      {/* Term Sheet Button - styled to match other action buttons */}
      <button
        onClick={handleIconClick}
        style={{
          background: hasTermSheet
            ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)'
            : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
          border: 'none',
          cursor: (isAdmin || hasTermSheet) ? 'pointer' : 'not-allowed',
          width: '44px',
          height: '44px',
          padding: '0',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.1rem',
          position: 'relative',
          transition: 'all 0.3s ease',
          opacity: (!isAdmin && !hasTermSheet) ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          if (isAdmin || hasTermSheet) {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(139, 92, 246, 0.4)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }}
        title={
          hasTermSheet
            ? `Term Sheet: ${product.termSheet.filename}\nUploaded: ${formatDate(product.termSheet.uploadedAt)}\n${isAdmin ? 'Click to replace or download' : 'Click to download'}`
            : isAdmin
            ? 'Upload Term Sheet'
            : 'No term sheet available'
        }
      >
        {hasTermSheet ? '📋' : '📤'}
      </button>

      {/* Upload Modal - Rendered via Portal to document.body */}
      {showModal && createPortal(
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              backgroundColor: '#1f2937',
              borderRadius: '12px',
              padding: '32px',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#f9fafb' }}>
                {hasTermSheet ? 'Replace Term Sheet' : 'Upload Term Sheet'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#9ca3af',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '0',
                  lineHeight: '1',
                }}
              >
                ×
              </button>
            </div>

            {/* Current Term Sheet Info */}
            {hasTermSheet && !uploadSuccess && (
              <div
                style={{
                  backgroundColor: '#374151',
                  padding: '12px',
                  borderRadius: '4px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ color: '#d1d5db', fontSize: '14px', marginBottom: '8px' }}>
                  Current: <strong>{product.termSheet.filename}</strong>
                </div>
                <div style={{ color: '#9ca3af', fontSize: '12px', marginBottom: '8px' }}>
                  Uploaded: {formatDate(product.termSheet.uploadedAt)}
                </div>
                <button
                  onClick={handleDownload}
                  style={{
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Download Current
                </button>
              </div>
            )}

            {/* Upload Success Message */}
            {uploadSuccess && (
              <div
                style={{
                  backgroundColor: '#10b981',
                  color: 'white',
                  padding: '12px',
                  borderRadius: '4px',
                  marginBottom: '16px',
                  textAlign: 'center',
                }}
              >
                ✓ Term sheet uploaded successfully!
              </div>
            )}

            {/* Upload Error Message */}
            {uploadError && (
              <div
                style={{
                  backgroundColor: '#ef4444',
                  color: 'white',
                  padding: '12px',
                  borderRadius: '4px',
                  marginBottom: '16px',
                }}
              >
                {uploadError}
              </div>
            )}

            {/* Upload Area */}
            {!uploading && !uploadSuccess && (
              <>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  style={{
                    border: `2px dashed ${dragActive ? '#3b82f6' : '#4b5563'}`,
                    borderRadius: '8px',
                    padding: '32px',
                    textAlign: 'center',
                    backgroundColor: dragActive ? '#374151' : '#111827',
                    transition: 'all 0.2s',
                    cursor: 'pointer',
                    marginBottom: '16px',
                  }}
                  onClick={() => document.getElementById('termsheet-file-input').click()}
                >
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
                  <div style={{ color: '#d1d5db', marginBottom: '8px' }}>
                    Drag and drop PDF here, or click to browse
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: '14px' }}>
                    Maximum file size: 10MB
                  </div>
                  <input
                    id="termsheet-file-input"
                    type="file"
                    accept="application/pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileSelect(e.target.files[0]);
                      }
                    }}
                  />
                </div>
              </>
            )}

            {/* Uploading Progress */}
            {uploading && (
              <div style={{ textAlign: 'center', padding: '32px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
                <div style={{ color: '#d1d5db', marginBottom: '8px' }}>
                  Uploading term sheet...
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '4px',
                    backgroundColor: '#374151',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: '#3b82f6',
                      animation: 'progress 1.5s ease-in-out infinite',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      <style>{`
        @keyframes progress {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </>
  );
};

export default TermSheetManager;
