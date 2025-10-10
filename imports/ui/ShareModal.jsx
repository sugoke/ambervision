import React, { useState, useRef, useEffect } from 'react';

const ShareModal = ({ isOpen, onClose, productId, productTitle }) => {
  const [copyStatus, setCopyStatus] = useState('');
  const urlInputRef = useRef(null);
  
  const shareUrl = `${window.location.origin}/report/${productId}`;

  // Auto-focus and select URL when modal opens
  useEffect(() => {
    if (isOpen && urlInputRef.current) {
      setTimeout(() => {
        urlInputRef.current.focus();
        urlInputRef.current.select();
      }, 100);
    }
  }, [isOpen]);

  // Early return after all hooks are called
  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyStatus('copied');
      
      // Reset status after 2 seconds
      setTimeout(() => {
        setCopyStatus('');
      }, 2000);
    } catch (error) {
      setCopyStatus('error');
      console.error('Failed to copy URL:', error);
      
      // Fallback: select the text in the input
      if (urlInputRef.current) {
        urlInputRef.current.select();
        urlInputRef.current.setSelectionRange(0, 99999); // For mobile devices
      }
      
      setTimeout(() => {
        setCopyStatus('');
      }, 3000);
    }
  };

  const getCopyButtonText = () => {
    switch (copyStatus) {
      case 'copied':
        return '✓ Copied!';
      case 'error':
        return '⚠️ Select & Copy';
      default:
        return '📋 Copy URL';
    }
  };

  const getCopyButtonStyle = () => {
    switch (copyStatus) {
      case 'copied':
        return {
          backgroundColor: 'var(--success-color, #28a745)',
          borderColor: 'var(--success-color, #28a745)'
        };
      case 'error':
        return {
          backgroundColor: 'var(--warning-color, #ffc107)',
          borderColor: 'var(--warning-color, #ffc107)',
          color: '#212529'
        };
      default:
        return {
          backgroundColor: 'var(--info-color, #3b82f6)',
          borderColor: 'var(--info-color, #3b82f6)'
        };
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content dialog-content">
        <div className="modal-header">
          <span className="dialog-icon">🔗</span>
          <h3 className="dialog-title">Share Report</h3>
        </div>
        
        <div className="modal-body">
          <div className="dialog-message">
            <p style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
              Share this report for <strong>{productTitle}</strong> using the link below:
            </p>
            
            <div style={{ marginBottom: '1rem' }}>
              <label className="modal-label" htmlFor="share-url">
                Shareable URL:
              </label>
              <input
                ref={urlInputRef}
                id="share-url"
                type="text"
                value={shareUrl}
                readOnly
                className="modal-input"
                style={{
                  width: '100%',
                  fontFamily: 'monospace',
                  fontSize: '0.9rem',
                  backgroundColor: 'var(--bg-secondary)',
                  cursor: 'text'
                }}
                onClick={(e) => e.target.select()}
              />
            </div>
            
            <div className="modal-info">
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                💡 This link allows anyone to view the report without requiring login.
              </p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            className="modal-btn modal-btn-secondary" 
            onClick={onClose}
          >
            Close
          </button>
          <button 
            className="modal-btn modal-btn-primary" 
            onClick={handleCopyUrl}
            style={{
              ...getCopyButtonStyle(),
              color: copyStatus === 'error' ? '#212529' : 'white'
            }}
            autoFocus
          >
            {getCopyButtonText()}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;