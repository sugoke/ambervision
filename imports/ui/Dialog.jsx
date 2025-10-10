import React from 'react';

const Dialog = ({ 
  isOpen, 
  onClose, 
  title, 
  message, 
  type = 'info', // 'info', 'confirm', 'error', 'success', 'warning'
  onConfirm,
  onCancel,
  confirmText = 'OK',
  cancelText = 'Cancel',
  showCancel = false,
  children
}) => {
  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !showCancel) {
      onClose();
    }
  };

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    onClose();
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    onClose();
  };

  const getDialogIcon = () => {
    switch (type) {
      case 'error':
        return '⚠️';
      case 'success':
        return '✅';
      case 'warning':
        return '⚡';
      case 'confirm':
        return '❓';
      default:
        return 'ℹ️';
    }
  };

  const getDialogClass = () => {
    return `dialog-${type}`;
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className={`modal-content dialog-content ${getDialogClass()}`}>
        {title && (
          <div className="modal-header">
            <span className="dialog-icon">{getDialogIcon()}</span>
            <h3 className="dialog-title">{title}</h3>
          </div>
        )}
        
        <div className="modal-body">
          {message && <p className="dialog-message">{message}</p>}
          {children}
        </div>
        
        <div className="modal-footer">
          {showCancel && (
            <button 
              className="modal-btn modal-btn-secondary" 
              onClick={handleCancel}
            >
              {cancelText}
            </button>
          )}
          <button 
            className="modal-btn modal-btn-primary" 
            onClick={handleConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dialog;