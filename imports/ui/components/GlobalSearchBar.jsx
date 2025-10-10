import React, { useState, useEffect, useRef } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { ProductsCollection } from '/imports/api/products';

const GlobalSearchBar = ({ onProductSelect }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchRef = useRef(null);
  const resultsRef = useRef(null);

  // Subscribe to products with sessionId for authentication
  const sessionId = localStorage.getItem('sessionId');
  const productsLoading = useSubscribe('products', sessionId);

  // Get all products for searching
  const allProducts = useFind(() => ProductsCollection.find());

  // Filter products based on search term
  const searchResults = React.useMemo(() => {
    if (!searchTerm.trim()) return [];
    
    const term = searchTerm.toLowerCase().trim();
    
    return allProducts.filter(product => {
      // Search by product title
      if (product.title?.toLowerCase().includes(term)) return true;
      
      // Search by ISIN
      if (product.isin?.toLowerCase().includes(term)) return true;
      
      // Search by underlying assets
      if (product.underlyings && Array.isArray(product.underlyings)) {
        return product.underlyings.some(underlying => {
          // Check if underlying has direct symbol/ticker properties
          if (underlying.symbol?.toLowerCase().includes(term)) return true;
          if (underlying.ticker?.toLowerCase().includes(term)) return true;
          if (underlying.name?.toLowerCase().includes(term)) return true;
          
          // Search by security symbol
          if (underlying.security?.symbol?.toLowerCase().includes(term)) return true;
          
          // Search by security name
          if (underlying.security?.name?.toLowerCase().includes(term)) return true;
          
          // Search by basket securities
          if (underlying.basket && Array.isArray(underlying.basket)) {
            return underlying.basket.some(security => 
              security.symbol?.toLowerCase().includes(term) ||
              security.name?.toLowerCase().includes(term)
            );
          }
          
          return false;
        });
      }
      
      // Search in payoffStructure (which is the droppedItems from StructuredProductInterface)
      if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
        return product.payoffStructure.some(item => {
          if (item.type === 'Underlying Asset' && item.definition) {
            // Search single underlying
            if (item.definition.security) {
              return item.definition.security.symbol?.toLowerCase().includes(term) ||
                     item.definition.security.name?.toLowerCase().includes(term);
            }
            
            // Search basket underlyings
            if (item.definition.basket && Array.isArray(item.definition.basket)) {
              return item.definition.basket.some(security =>
                security.symbol?.toLowerCase().includes(term) ||
                security.name?.toLowerCase().includes(term)
              );
            }
          }
          return false;
        });
      }
      
      // Search in dropped items for underlying assets (legacy support)
      if (product.droppedItems && Array.isArray(product.droppedItems)) {
        return product.droppedItems.some(item => {
          if (item.type === 'Underlying Asset' && item.definition) {
            // Search single underlying
            if (item.definition.security) {
              return item.definition.security.symbol?.toLowerCase().includes(term) ||
                     item.definition.security.name?.toLowerCase().includes(term);
            }
            
            // Search basket underlyings
            if (item.definition.basket && Array.isArray(item.definition.basket)) {
              return item.definition.basket.some(security =>
                security.symbol?.toLowerCase().includes(term) ||
                security.name?.toLowerCase().includes(term)
              );
            }
          }
          return false;
        });
      }
      
      return false;
    }).slice(0, 8); // Limit to 8 results
  }, [searchTerm, allProducts]);

  // Handle keyboard navigation and shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Global shortcut: Press "/" to focus search
      if (e.key === '/' && !isSearchOpen && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      
      if (!isSearchOpen || searchResults.length === 0) return;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => 
            prev < searchResults.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && searchResults[selectedIndex]) {
            handleProductSelect(searchResults[selectedIndex]);
          }
          break;
        case 'Escape':
          setIsSearchOpen(false);
          setSelectedIndex(-1);
          searchRef.current?.blur();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, searchResults, selectedIndex]);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsSearchOpen(false);
        setSelectedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleProductSelect = (product) => {
    setSearchTerm('');
    setIsSearchOpen(false);
    setSelectedIndex(-1);
    if (onProductSelect) {
      onProductSelect(product);
    }
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    setIsSearchOpen(value.trim().length > 0);
    setSelectedIndex(-1);
  };

  const highlightMatch = (text, searchTerm) => {
    if (!text || !searchTerm) return text;
    
    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) => 
      regex.test(part) ? (
        <span key={index} style={{ backgroundColor: 'var(--accent-color)', color: 'white', padding: '0 2px', borderRadius: '2px' }}>
          {part}
        </span>
      ) : part
    );
  };

  const getUnderlyingDisplay = (product) => {
    // Check underlyings array first
    if (product.underlyings && Array.isArray(product.underlyings) && product.underlyings.length > 0) {
      const underlying = product.underlyings[0];
      
      // Check for direct symbol/ticker properties
      if (underlying.symbol) return underlying.symbol;
      if (underlying.ticker) return underlying.ticker;
      
      if (underlying.security) {
        return underlying.security.symbol || underlying.security.name;
      }
      if (underlying.basket && underlying.basket.length > 0) {
        return `${underlying.basket[0].symbol} + ${underlying.basket.length - 1} more`;
      }
    }
    
    // Check payoffStructure for underlying assets
    if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
      const underlyingAsset = product.payoffStructure.find(item => item.type === 'Underlying Asset');
      if (underlyingAsset?.definition) {
        if (underlyingAsset.definition.security) {
          return underlyingAsset.definition.security.symbol || underlyingAsset.definition.security.name;
        }
        if (underlyingAsset.definition.basket && underlyingAsset.definition.basket.length > 0) {
          return `${underlyingAsset.definition.basket[0].symbol} + ${underlyingAsset.definition.basket.length - 1} more`;
        }
      }
    }
    
    // Check droppedItems for underlying assets (legacy support)
    if (product.droppedItems && Array.isArray(product.droppedItems)) {
      const underlyingAsset = product.droppedItems.find(item => item.type === 'Underlying Asset');
      if (underlyingAsset?.definition) {
        if (underlyingAsset.definition.security) {
          return underlyingAsset.definition.security.symbol || underlyingAsset.definition.security.name;
        }
        if (underlyingAsset.definition.basket && underlyingAsset.definition.basket.length > 0) {
          return `${underlyingAsset.definition.basket[0].symbol} + ${underlyingAsset.definition.basket.length - 1} more`;
        }
      }
    }
    
    return 'No underlying';
  };

  return (
    <div ref={searchRef} style={{ position: 'relative', flex: '1', maxWidth: '500px', margin: '0 2rem' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={() => searchTerm.trim() && setIsSearchOpen(true)}
          placeholder="Search products by name, ISIN, or underlying... (Press / to focus)"
          style={{
            width: '100%',
            padding: '8px 40px 8px 12px',
            borderRadius: '20px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontSize: '0.9rem',
            outline: 'none',
            transition: 'all 0.2s ease',
            boxShadow: isSearchOpen ? '0 0 0 2px var(--accent-color)' : 'none'
          }}
        />
        <div style={{
          position: 'absolute',
          right: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-muted)',
          pointerEvents: 'none'
        }}>
          🔍
        </div>
      </div>

      {/* Search Results Dropdown */}
      {isSearchOpen && searchResults.length > 0 && (
        <div
          ref={resultsRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            zIndex: 1000,
            maxHeight: '400px',
            overflowY: 'auto',
            marginTop: '4px'
          }}
        >
          <div style={{
            padding: '8px 12px',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)'
          }}>
            {searchResults.length} product{searchResults.length !== 1 ? 's' : ''} found
          </div>
          
          {searchResults.map((product, index) => (
            <div
              key={product._id}
              onClick={() => handleProductSelect(product)}
              onMouseEnter={() => setSelectedIndex(index)}
              style={{
                padding: '12px',
                cursor: 'pointer',
                borderBottom: index < searchResults.length - 1 ? '1px solid var(--border-color)' : 'none',
                background: selectedIndex === index ? 'var(--bg-secondary)' : 'transparent',
                transition: 'background-color 0.1s ease'
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '12px'
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    marginBottom: '4px',
                    fontSize: '0.9rem'
                  }}>
                    {highlightMatch(product.title, searchTerm)}
                  </div>
                  <div style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '2px'
                  }}>
                    ISIN: {highlightMatch(product.isin, searchTerm)}
                  </div>
                  <div style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)'
                  }}>
                    Underlying: {highlightMatch(getUnderlyingDisplay(product), searchTerm)}
                  </div>
                </div>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: '4px'
                }}>
                  <div style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)'
                  }}>
                    {product.createdAt ? new Date(product.createdAt).toLocaleDateString() : ''}
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    color: 'var(--accent-color)',
                    fontWeight: '500'
                  }}>
                    Click to view report
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No Results */}
      {isSearchOpen && searchTerm.trim() && searchResults.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 1000,
          marginTop: '4px',
          padding: '20px',
          textAlign: 'center',
          color: 'var(--text-muted)'
        }}>
          No products found for "{searchTerm}"
        </div>
      )}
    </div>
  );
};

export default GlobalSearchBar;