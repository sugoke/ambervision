import React, { useEffect } from 'react';
import ActionButton from './ActionButton.jsx';
import { useIsMobile } from '../../hooks/useIsMobile.js';

/**
 * Modal - Reusable modal component with consistent styling and behavior
 *
 * On phone-sized viewports the modal becomes a full-height sheet: the header and
 * footer are pinned and only the content scrolls. Previously the whole modal grew
 * with its content inside a scrolling overlay, which pushed the action buttons
 * (Continue / Confirm / Validate) below the fold — on a long form you had to
 * scroll to the very end of the document to find them.
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
  const isMobile = useIsMobile();
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

  // Every size is capped to the viewport so long forms scroll INSIDE the card
  // (header and footer pinned) — previously the card grew past the viewport and
  // only the overlay scrolled, which required pointing at the side gutters
  // because the content's overscroll containment swallowed wheel events.
  const sizes = {
    small: { maxWidth: '400px', margin: '10vh auto', maxHeight: '80vh' },
    medium: { maxWidth: '600px', margin: '8vh auto', maxHeight: '84vh' },
    large: { maxWidth: '800px', margin: '5vh auto', maxHeight: '90vh' },
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
    justifyContent: 'center',
    zIndex: 1000,
    // On mobile the sheet fills the viewport and owns its own scrolling, so the
    // overlay must not scroll or pad — otherwise the pinned footer scrolls away.
    alignItems: isMobile ? 'flex-end' : 'flex-start',
    padding: isMobile ? 0 : '1rem',
    overflowY: isMobile ? 'hidden' : 'auto'
  };

  const modalStyle = {
    background: 'var(--bg-secondary)',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    border: '1px solid var(--border-color)',
    width: '100%',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    ...(isMobile
      ? {
          borderRadius: '16px 16px 0 0',
          maxWidth: '100%',
          margin: 0,
          // Height follows the content so a short confirm stays a compact bottom
          // sheet, while a long form is capped and scrolls internally with its
          // footer pinned. The cap is a percentage of the fixed overlay rather
          // than vh, so it can't overflow under mobile browser chrome.
          height: 'auto',
          maxHeight: '92%',
          borderLeft: 'none',
          borderRight: 'none',
          borderBottom: 'none'
        }
      : { borderRadius: '12px', ...sizes[size] }),
    ...style
  };

  const headerStyle = {
    padding: isMobile ? '0.875rem 1rem' : '1.5rem 1.5rem 1rem 1.5rem',
    paddingTop: isMobile ? 'calc(0.875rem + env(safe-area-inset-top, 0px))' : undefined,
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    flexShrink: 0,
    background: 'var(--bg-secondary)'
  };

  const titleStyle = {
    margin: 0,
    fontSize: isMobile ? '1.05rem' : '1.2rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
    // A long title ("Term Deposit — Decrease") must not squeeze the close button off-screen.
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: isMobile ? 'nowrap' : 'normal'
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
    // 44px is the minimum comfortable touch target.
    width: isMobile ? '2.75rem' : '2rem',
    height: isMobile ? '2.75rem' : '2rem',
    flexShrink: 0,
    transition: 'all 0.2s ease'
  };

  const contentStyle = {
    padding: isMobile ? '1rem' : '1.5rem',
    flex: 1,
    overflowY: 'auto',
    // Keeps momentum scrolling inside the sheet instead of rubber-banding the page.
    WebkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain'
  };

  const footerStyle = {
    padding: isMobile ? '0.75rem 1rem' : '1rem 1.5rem 1.5rem 1.5rem',
    paddingBottom: isMobile ? 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' : undefined,
    borderTop: '1px solid var(--border-color)',
    display: 'flex',
    // Left unset on desktop so the previous default (stretch) is preserved exactly.
    ...(isMobile ? { alignItems: 'stretch' } : {}),
    justifyContent: 'flex-end',
    // Action bars with several buttons (the order detail view has up to seven) overflow
    // a phone-width row; wrapping keeps every one of them reachable.
    flexWrap: isMobile ? 'wrap' : 'nowrap',
    gap: '0.75rem',
    flexShrink: 0,
    background: 'var(--bg-secondary)'
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