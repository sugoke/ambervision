import React, { useState, useCallback } from 'react';
import GenericProductList from './GenericProductList.jsx';
import GenericProductBuilder from './builder/GenericProductBuilder.jsx';
import GenericProductReport from './report/GenericProductReport.jsx';

/**
 * Product Composer — root of the generic (composition-based) product page.
 * Internal navigation (list | builder | report) is component state, NOT new
 * MainContent sections, keeping the footprint in shared files minimal.
 */
const GenericProductsPage = ({ user }) => {
  const [view, setView] = useState('list');
  const [selectedProductId, setSelectedProductId] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('genericSelectedProductId') || null;
    }
    return null;
  });

  const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;

  const selectProduct = useCallback((productId) => {
    setSelectedProductId(productId);
    if (typeof window !== 'undefined') {
      if (productId) localStorage.setItem('genericSelectedProductId', productId);
      else localStorage.removeItem('genericSelectedProductId');
    }
  }, []);

  const goToList = useCallback(() => setView('list'), []);
  const goToBuilder = useCallback((productId) => { selectProduct(productId); setView('builder'); }, [selectProduct]);
  const goToReport = useCallback((productId) => { selectProduct(productId); setView('report'); }, [selectProduct]);

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1500px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>🧱 Product Composer</h2>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Composition-based products (experimental — separate from the template engine)
        </span>
      </div>

      {view === 'list' && (
        <GenericProductList
          user={user}
          sessionId={sessionId}
          onNew={() => goToBuilder(null)}
          onEdit={goToBuilder}
          onReport={goToReport}
        />
      )}
      {view === 'builder' && (
        <GenericProductBuilder
          user={user}
          sessionId={sessionId}
          productId={selectedProductId}
          onBack={goToList}
          onEvaluated={goToReport}
        />
      )}
      {view === 'report' && (
        <GenericProductReport
          user={user}
          sessionId={sessionId}
          productId={selectedProductId}
          onBack={goToList}
          onEdit={() => goToBuilder(selectedProductId)}
        />
      )}
    </div>
  );
};

export default GenericProductsPage;
