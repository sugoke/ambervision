import React, { useEffect, useRef, useState } from 'react';

// Pull distance (px, after damping) that arms the refresh
const THRESHOLD = 75;
// Cap so the indicator never travels absurdly far
const MAX_PULL = 130;

/**
 * PullToRefresh — native-feeling pull-down-to-refresh for the mobile web app.
 *
 * Mounted once (App.jsx, mobile only). Listens to window touch events: when the
 * page is scrolled to the very top and the user drags down past the threshold,
 * releasing reloads the page — every section re-fetches its data on mount, so a
 * reload is a full refresh.
 *
 * Deliberately inert while document.body scroll is locked (overflow: hidden) —
 * that's the signal that a full-screen layer (Amber chat, notification panel)
 * owns the touch, and pulling inside those must not reload the app.
 */
const PullToRefresh = () => {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const active = useRef(false);
  const pullNow = useRef(0);

  useEffect(() => {
    const canStart = () => {
      const scroller = document.scrollingElement || document.documentElement;
      return scroller.scrollTop <= 0 && document.body.style.overflow !== 'hidden';
    };

    const reset = () => {
      active.current = false;
      startY.current = null;
      pullNow.current = 0;
      setPull(0);
    };

    const onTouchStart = (e) => {
      if (!canStart() || e.touches.length !== 1) return;
      startY.current = e.touches[0].clientY;
      active.current = true;
    };

    const onTouchMove = (e) => {
      if (!active.current || startY.current === null) return;
      if (!canStart()) { reset(); return; }
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        pullNow.current = 0;
        setPull(0);
        return;
      }
      // Damping so the indicator trails the finger like the native gesture
      const damped = Math.min(MAX_PULL, dy * 0.5);
      pullNow.current = damped;
      setPull(damped);
    };

    const onTouchEnd = () => {
      if (active.current && pullNow.current >= THRESHOLD) {
        setRefreshing(true);
        // Small delay so the spinner state paints before the reload kicks in
        setTimeout(() => window.location.reload(), 120);
      } else {
        reset();
      }
      active.current = false;
      startY.current = null;
      pullNow.current = 0;
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  if (pull <= 0 && !refreshing) return null;

  const progress = Math.min(1, pull / THRESHOLD);
  const armed = progress >= 1;

  return (
    <div style={{
      position: 'fixed',
      top: `calc(env(safe-area-inset-top, 0px) + ${Math.round(pull * 0.6)}px)`,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 10001,
      pointerEvents: 'none',
      transition: refreshing ? 'none' : 'opacity 0.15s ease'
    }}>
      <style>{`
        @keyframes ptrSpin { to { transform: rotate(360deg); } }
      `}</style>
      <div style={{
        width: '38px',
        height: '38px',
        borderRadius: '50%',
        background: 'var(--card-bg, var(--bg-secondary))',
        border: '1px solid var(--border-color)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: refreshing ? 1 : 0.4 + progress * 0.6
      }}>
        {refreshing ? (
          <div style={{
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            border: '2px solid var(--border-color)',
            borderTopColor: 'var(--accent-color)',
            animation: 'ptrSpin 0.7s linear infinite'
          }} />
        ) : (
          <span style={{
            fontSize: '1rem',
            color: armed ? 'var(--accent-color)' : 'var(--text-muted)',
            display: 'inline-block',
            transform: `rotate(${progress * 180}deg)`,
            transition: 'color 0.1s ease'
          }}>
            ↓
          </span>
        )}
      </div>
    </div>
  );
};

export default PullToRefresh;
