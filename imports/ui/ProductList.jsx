import React, { useState, useMemo } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { ProductsCollection } from '/imports/api/products';
import { Meteor } from 'meteor/meteor';
import { USER_ROLES } from '/imports/api/users';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';

export const ProductList = ({ user, onEditProduct }) => {
  // Memoize sessionId to prevent unnecessary re-subscriptions
  const sessionId = useMemo(() => localStorage.getItem('sessionId'), []);
  const isLoading = useSubscribe('products', sessionId);
  const products = useFind(() => ProductsCollection.find({}, { sort: { createdAt: -1 } }), []);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editForm, setEditForm] = useState({});
  const { dialogState, showAlert, showError, showConfirm, hideDialog } = useDialog();

  const canEditProducts = user && (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN);

  const handleEdit = (product) => {
    if (onEditProduct) {
      // Use the proper edit handler that opens the product builder
      onEditProduct(product);
    } else {
      // Fallback to inline edit if no handler provided
      setEditingProduct(product._id);
      setEditForm({
        title: product.name || product.title || '',
        isin: product.isin || '',
        description: product.description || '',
        currency: product.currency || '',
        price: product.price || ''
      });
    }
  };

  const handleSaveEdit = async () => {
    if (!editingProduct) return;
    
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('products.update', editingProduct, editForm, sessionId);
      setEditingProduct(null);
      setEditForm({});
    } catch (error) {
      console.error('Error updating product:', error);
      showError(`Error updating product: ${error.reason || error.message}`, 'Update Error');
    }
  };

  const handleCancelEdit = () => {
    setEditingProduct(null);
    setEditForm({});
  };

  const handleRemove = async (productId) => {
    const shouldRemove = await showConfirm(
      'Are you sure you want to remove this product? This action cannot be undone.',
      null,
      'Confirm Removal'
    );
    
    if (!shouldRemove) {
      return;
    }
    
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('products.remove', productId, sessionId);
    } catch (error) {
      console.error('Error removing product:', error);
      showError(`Error removing product: ${error.reason || error.message}`, 'Removal Error');
    }
  };


  return (
    <div style={{
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      padding: '1.5rem'
    }}>
      <h3 style={{
        margin: '0 0 1.5rem 0',
        fontSize: '1.2rem',
        fontWeight: '600',
        color: 'var(--text-primary)'
      }}>
        Products ({products.length})
      </h3>
      
      {products.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          border: '2px dashed var(--border-color)'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📦</div>
          <p style={{
            margin: 0,
            color: 'var(--text-muted)',
            fontSize: '1rem'
          }}>
            No products found. Add one using the form!
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gap: '1rem'
        }}>
          {products.map((product) => (
            <div 
              key={product._id} 
              style={{
                padding: '1.5rem',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                background: 'var(--bg-secondary)',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.borderColor = 'var(--accent-color)';
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 4px 8px var(--shadow)';
              }}
              onMouseLeave={(e) => {
                e.target.style.borderColor = 'var(--border-color)';
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                {editingProduct === product._id ? (
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--accent-color)',
                      borderRadius: '4px',
                      padding: '0.25rem 0.5rem',
                      flex: 1,
                      marginRight: '1rem'
                    }}
                  />
                ) : (
                  <h4 style={{
                    margin: 0,
                    fontSize: '1.1rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    {product.name || product.title}
                  </h4>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '12px',
                    background: product.isin ? 'var(--accent-color)' : 'var(--success-color)',
                    color: 'white'
                  }}>
                    {product.isin ? 'Structured' : 'Simple'}
                  </span>
                  {canEditProducts && (
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      {editingProduct === product._id ? (
                        <>
                          <button
                            onClick={handleSaveEdit}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.7rem',
                              border: 'none',
                              borderRadius: '4px',
                              background: 'var(--success-color)',
                              color: 'white',
                              cursor: 'pointer'
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.7rem',
                              border: 'none',
                              borderRadius: '4px',
                              background: 'var(--text-muted)',
                              color: 'white',
                              cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleEdit(product)}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.7rem',
                              border: 'none',
                              borderRadius: '4px',
                              background: 'var(--accent-color)',
                              color: 'white',
                              cursor: 'pointer'
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleRemove(product._id)}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.7rem',
                              border: 'none',
                              borderRadius: '4px',
                              background: '#dc3545',
                              color: 'white',
                              cursor: 'pointer'
                            }}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '0.5rem 1rem',
                marginBottom: '1rem',
                fontSize: '0.9rem'
              }}>
                {/* Only show price for simple products */}
                {typeof product.price === 'number' && (
                  <>
                    <span style={{ 
                      fontWeight: '600', 
                      color: 'var(--text-secondary)' 
                    }}>
                      Price:
                    </span>
                    {editingProduct === product._id ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editForm.price}
                        onChange={(e) => setEditForm({...editForm, price: parseFloat(e.target.value) || 0})}
                        style={{
                          color: 'var(--text-primary)',
                          fontFamily: 'monospace',
                          fontWeight: '600',
                          fontSize: '1rem',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          padding: '0.25rem'
                        }}
                      />
                    ) : (
                      <span style={{ 
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace',
                        fontWeight: '600',
                        fontSize: '1rem'
                      }}>
                        ${product.price.toFixed(2)}
                      </span>
                    )}
                  </>
                )}
                
                {/* Show ISIN for structured products */}
                {product.isin && (
                  <>
                    <span style={{ 
                      fontWeight: '600', 
                      color: 'var(--text-secondary)' 
                    }}>
                      ISIN:
                    </span>
                    {editingProduct === product._id ? (
                      <input
                        type="text"
                        value={editForm.isin}
                        onChange={(e) => setEditForm({...editForm, isin: e.target.value})}
                        style={{
                          color: 'var(--text-primary)',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          padding: '0.25rem'
                        }}
                      />
                    ) : (
                      <span style={{ color: 'var(--text-primary)' }}>
                        {product.isin}
                      </span>
                    )}
                  </>
                )}
                
                {/* Show currency for structured products */}
                {product.currency && (
                  <>
                    <span style={{ 
                      fontWeight: '600', 
                      color: 'var(--text-secondary)' 
                    }}>
                      Currency:
                    </span>
                    {editingProduct === product._id ? (
                      <input
                        type="text"
                        value={editForm.currency}
                        onChange={(e) => setEditForm({...editForm, currency: e.target.value})}
                        style={{
                          color: 'var(--text-primary)',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          padding: '0.25rem'
                        }}
                      />
                    ) : (
                      <span style={{ color: 'var(--text-primary)' }}>
                        {product.currency}
                      </span>
                    )}
                  </>
                )}
                
                {product.description && (
                  <>
                    <span style={{ 
                      fontWeight: '600', 
                      color: 'var(--text-secondary)' 
                    }}>
                      Description:
                    </span>
                    {editingProduct === product._id ? (
                      <textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                        style={{
                          color: 'var(--text-primary)',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          padding: '0.25rem',
                          resize: 'vertical',
                          minHeight: '60px'
                        }}
                      />
                    ) : (
                      <span style={{ color: 'var(--text-primary)' }}>
                        {product.description}
                      </span>
                    )}
                  </>
                )}
              </div>
              
              <div style={{
                paddingTop: '0.75rem',
                borderTop: '1px solid var(--border-color)',
                fontSize: '0.8rem',
                color: 'var(--text-muted)'
              }}>
                Added: {product.createdAt.toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Global Dialog Component */}
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
      >
        {dialogState.children}
      </Dialog>
    </div>
  );
};