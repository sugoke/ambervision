import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Confirmation that an order mail actually left.
 *
 * The send modal closes the moment Graph accepts the message, which on its own
 * looks indistinguishable from the modal being dismissed — so the desk was left
 * wondering whether the bank had been mailed. This says what went where, and
 * that the sent copy is being filed back on the order as its "order to bank"
 * trace (that part completes a beat later, in the background).
 *
 * Portals to <body>: the light-theme backdrop-filter wrappers in App.jsx trap
 * position:fixed descendants.
 */
export default function OrderSentToast({ notice, onDismiss }) {
  // Callers pass an inline arrow, so onDismiss changes on every render of the
  // (reactive) order book. Depending on it restarted the timer each time and the
  // toast never left; read it through a ref instead.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const toastRef = useRef(null);

  useEffect(() => {
    if (!notice) return undefined;
    const dismiss = () => dismissRef.current?.();
    const timer = setTimeout(dismiss, 6000);
    // A click anywhere outside the toast dismisses it too.
    const onPointerDown = (e) => {
      if (toastRef.current && !toastRef.current.contains(e.target)) dismiss();
    };
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [notice]);

  if (!notice) return null;

  const toast = (
    <div
      ref={toastRef}
      role="status"
      aria-live="polite"
      onClick={() => dismissRef.current?.()}
      style={{
        position: 'fixed', zIndex: 20002,
        left: '50%', transform: 'translateX(-50%)',
        bottom: 'calc(24px + env(safe-area-inset-bottom))',
        maxWidth: 'min(520px, calc(100vw - 32px))',
        display: 'flex', alignItems: 'flex-start', gap: '10px',
        padding: '12px 16px', borderRadius: '10px',
        background: 'var(--bg-secondary)',
        border: '1px solid rgba(16, 185, 129, 0.45)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
        cursor: 'pointer'
      }}
    >
      <span style={{ fontSize: '18px', lineHeight: 1.2 }}>✅</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
          {notice.count > 1
            ? `${notice.count} orders sent`
            : `Order ${notice.orderReference || ''} sent`}
        </div>
        {notice.sentTo && (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', wordBreak: 'break-word' }}>
            To {notice.sentTo}
          </div>
        )}
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
          A copy is in your Sent Items and is being filed as the order-to-bank trace.
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={(e) => { e.stopPropagation(); dismissRef.current?.(); }}
        style={{
          marginLeft: 'auto', flexShrink: 0,
          background: 'none', border: 'none', padding: '0 2px',
          fontSize: '16px', lineHeight: 1, color: 'var(--text-muted)', cursor: 'pointer'
        }}
      >
        ×
      </button>
    </div>
  );

  return createPortal(toast, document.body);
}
