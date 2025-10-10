import React, { useState } from 'react';
import { ProductsCollection } from '/imports/api/products';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';

export const ProductForm = () => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const { dialogState, showAlert, showError, showSuccess, hideDialog } = useDialog();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!name.trim() || !price.trim()) {
      showError('Please fill in name and price', 'Missing Required Fields');
      return;
    }

    try {
      await ProductsCollection.insertAsync({
        name: name.trim(),
        price: parseFloat(price),
        description: description.trim(),
        createdAt: new Date()
      });
      
      setName('');
      setPrice('');
      setDescription('');
      showSuccess('Product added successfully!', 'Success');
    } catch (error) {
      console.error('Error adding product:', error);
      showError(`Error adding product: ${error.message}`, 'Add Error');
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
        Add New Product
      </h3>
      
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontSize: '0.875rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Product Name *
          </label>
          <input
            type="text"
            placeholder="Enter product name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            tabIndex={1}
            required
            style={{
              width: '100%',
              padding: '12px 16px',
              border: '2px solid var(--border-color)',
              borderRadius: '8px',
              fontSize: '1rem',
              boxSizing: 'border-box',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              transition: 'border-color 0.2s ease'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent-color)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
          />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontSize: '0.875rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Price *
          </label>
          <input
            type="number"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            tabIndex={2}
            step="0.01"
            min="0"
            required
            style={{
              width: '100%',
              padding: '12px 16px',
              border: '2px solid var(--border-color)',
              borderRadius: '8px',
              fontSize: '1rem',
              boxSizing: 'border-box',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              transition: 'border-color 0.2s ease'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent-color)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
          />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontSize: '0.875rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Description
          </label>
          <textarea
            placeholder="Optional description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            tabIndex={3}
            rows="3"
            style={{
              width: '100%',
              padding: '12px 16px',
              border: '2px solid var(--border-color)',
              borderRadius: '8px',
              fontSize: '1rem',
              boxSizing: 'border-box',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              resize: 'vertical',
              minHeight: '80px',
              transition: 'border-color 0.2s ease'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--accent-color)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
          />
        </div>

        <button 
          type="submit" 
          tabIndex={4}
          style={{
            width: '100%',
            padding: '12px 24px',
            background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
          onMouseEnter={(e) => {
            e.target.style.transform = 'translateY(-1px)';
            e.target.style.boxShadow = '0 4px 12px rgba(0, 123, 255, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = 'none';
          }}
        >
          Add Product
        </button>
      </form>
      
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