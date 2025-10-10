import React, { useEffect } from 'react';
import ActionButton from './ActionButton.jsx';

/**
 * Modal - Reusable modal component with consistent styling and behavior
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether modal is open
 * @param {Function} props.onClose - Close handler
 * @param {string} props.title - Modal title
 * @param {React.ReactNode} props.children - Modal content
 * @param {React.ReactNode} props.footer - Custom footer content
 * @param {string} props.size - Modal size: 'small', 'medium', 'large', 'fullscreen'
 * @param {boolean} props.closeOnOverlayClick - Close when clicking overlay
 * @param {boolean} props.closeOnEscape - Close when pressing escape
 * @param {boolean} props.showCloseButton - Show X close button
 * @param {Object} props.style - Additional styles
 */
const Modal = ({
  isOpen = false,
  onClose,
  title,
  children,
  footer,
  size = 'medium',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  style = {},
  ...props
}) => {
  // Handle escape key
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeOnEscape, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizes = {
    small: { maxWidth: '400px', margin: '10vh auto' },
    medium: { maxWidth: '600px', margin: '8vh auto' },
    large: { maxWidth: '800px', margin: '5vh auto' },
    fullscreen: { 
      maxWidth: '95vw', 
      maxHeight: '95vh', 
      margin: '2.5vh auto',
      height: 'calc(95vh - 4rem)'
    }
  };

  const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem',
    overflowY: 'auto'
  };

  const modalStyle = {
    background: 'var(--bg-primary)',
    borderRadius: '12px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    border: '1px solid var(--border-color)',
    width: '100%',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    ...sizes[size],
    ...style
  };

  const headerStyle = {
    padding: '1.5rem 1.5rem 1rem 1.5rem',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0
  };

  const titleStyle = {
    margin: 0,
    fontSize: '1.2rem',
    fontWeight: '600',
    color: 'var(--text-primary)'
  };

  const closeButtonStyle = {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '0.25rem',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2rem',
    height: '2rem',
    transition: 'all 0.2s ease'
  };

  const contentStyle = {
    padding: '1.5rem',
    flex: 1,
    overflowY: 'auto'
  };

  const footerStyle = {
    padding: '1rem 1.5rem 1.5rem 1.5rem',
    borderTop: '1px solid var(--border-color)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.75rem',
    flexShrink: 0
  };

  const handleOverlayClick = (e) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      onClose?.();
    }
  };

  return (
    <div style={overlayStyle} onClick={handleOverlayClick} {...props}>
      <div style={modalStyle}>
        {(title || showCloseButton) && (
          <div style={headerStyle}>
            {title && <h2 style={titleStyle}>{title}</h2>}
            {showCloseButton && (
              <button
                style={closeButtonStyle}
                onClick={onClose}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
                aria-label="Close modal"
              >
                ×
              </button>
            )}
          </div>
        )}
        
        <div style={contentStyle}>
          {children}
        </div>
        
        {footer && (
          <div style={footerStyle}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;