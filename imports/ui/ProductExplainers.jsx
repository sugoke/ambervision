import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PRODUCT_EXPLAINERS } from '/imports/constants/productExplainers.js';

// Mini-app: Product Explainers
// Gallery of interactive client-facing product explainers. Clicking one opens it
// full screen over the app (browser full screen where supported, a fixed overlay
// otherwise, e.g. iPhone) with a close button on the slide to return to the Intranet.
const ProductExplainers = ({ isDark }) => {
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState(null);
  const enteredFullscreen = useRef(false);

  const active = PRODUCT_EXPLAINERS.find(e => e.id === activeId);

  const openExplainer = (id) => {
    setActiveId(id);
    // Must run inside the click handler (user gesture) for the browser to allow it
    const root = document.documentElement;
    if (document.fullscreenEnabled && root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen()
        .then(() => { enteredFullscreen.current = true; })
        .catch(() => {});
    }
  };

  const closeExplainer = () => {
    setActiveId(null);
    if (enteredFullscreen.current && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    enteredFullscreen.current = false;
  };

  useEffect(() => {
    if (!activeId) return;

    const onKey = (e) => { if (e.key === 'Escape') closeExplainer(); };
    // Leaving browser full screen (Esc, system gesture) also closes the explainer
    const onFullscreenChange = () => {
      if (enteredFullscreen.current && !document.fullscreenElement) closeExplainer();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeId]);

  // The decks are same-origin: hide their own "Plein écran" button (already full
  // screen here) and forward Esc from inside the deck to close the viewer.
  const onFrameLoad = (e) => {
    try {
      const doc = e.target.contentDocument;
      const style = doc.createElement('style');
      style.textContent = '#fs{display:none !important}';
      doc.head.appendChild(style);
      doc.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeExplainer(); });
    } catch (err) { /* cross-origin deck: leave it untouched */ }
  };

  const term = search.trim().toLowerCase();
  const filtered = PRODUCT_EXPLAINERS.filter(e =>
    !term ||
    e.title.toLowerCase().includes(term) ||
    e.productType.toLowerCase().includes(term) ||
    e.description.toLowerCase().includes(term)
  );

  const viewer = active && createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active.title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: '#0C1424'
      }}
    >
      <iframe
        key={active.id}
        src={active.file}
        title={active.title}
        onLoad={onFrameLoad}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
      />
      <button
        onClick={closeExplainer}
        aria-label="Close explainer"
        title="Close"
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: '1.5px solid rgba(245, 240, 232, 0.35)',
          background: 'rgba(12, 20, 36, 0.75)',
          color: '#F5F0E8',
          fontSize: '1.5rem',
          lineHeight: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
          WebkitTapHighlightColor: 'transparent'
        }}
      >
        ×
      </button>
    </div>,
    document.body
  );

  return (
    <div>
      {viewer}
      <div style={{ marginBottom: '1.5rem' }}>
        <input
          type="text"
          placeholder="Search explainers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            fontSize: '1rem',
            border: `2px solid ${isDark ? 'var(--border-color)' : '#e5e7eb'}`,
            borderRadius: '8px',
            background: isDark ? 'var(--bg-tertiary)' : 'white',
            color: 'var(--text-primary)',
            outline: 'none',
            boxSizing: 'border-box'
          }}
          onFocus={(e) => e.target.style.borderColor = 'var(--accent-color)'}
          onBlur={(e) => e.target.style.borderColor = isDark ? 'var(--border-color)' : '#e5e7eb'}
        />
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '1.5rem'
      }}>
        {filtered.map(explainer => (
          <button
            key={explainer.id}
            onClick={() => openExplainer(explainer.id)}
            style={{
              textAlign: 'left',
              padding: 0,
              font: 'inherit',
              cursor: 'pointer',
              background: isDark ? 'var(--bg-secondary)' : 'white',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              display: 'flex',
              flexDirection: 'column'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
            }}
          >
            <div style={{
              aspectRatio: '16 / 9',
              background: 'linear-gradient(135deg, #1B2A4A 0%, #0C1424 100%)',
              color: '#F5F0E8',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxSizing: 'border-box'
            }}>
              <span style={{
                alignSelf: 'flex-start',
                fontSize: '0.75rem',
                fontWeight: '600',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: '#F6CD86',
                border: '1px solid rgba(246, 205, 134, 0.5)',
                borderRadius: '999px',
                padding: '0.2rem 0.65rem'
              }}>
                {explainer.productType}
              </span>
              <div>
                <div style={{ fontSize: '1.35rem', fontWeight: '600', lineHeight: 1.2 }}>
                  {explainer.title}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'rgba(245, 240, 232, 0.62)', marginTop: '0.35rem' }}>
                  ▶ Open interactive explainer
                </div>
              </div>
            </div>
            <div style={{ padding: '1rem 1.25rem' }}>
              <p style={{
                margin: 0,
                fontSize: '0.9rem',
                color: 'var(--text-muted)',
                lineHeight: 1.5
              }}>
                {explainer.description}
              </p>
              <div style={{
                marginTop: '0.75rem',
                fontSize: '0.8rem',
                fontWeight: '600',
                color: 'var(--text-secondary)'
              }}>
                Language: {explainer.language}
              </div>
            </div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>🔍</div>
          <p style={{ fontSize: '1.1rem', margin: 0 }}>
            No explainers found matching your search.
          </p>
        </div>
      )}
    </div>
  );
};

export default ProductExplainers;
