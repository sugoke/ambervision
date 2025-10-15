import React, { useState, useRef, useMemo } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { ProductPricesCollection } from '/imports/api/productPrices';
import { ProductsCollection } from '/imports/api/products';

const Prices = () => {
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('uploadDate');
  const [sortDirection, setSortDirection] = useState('desc');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Subscribe to product prices and products - memoize sessionId to prevent re-subscriptions
  const sessionId = useMemo(() => localStorage.getItem('sessionId'), []);
  const isLoading = useSubscribe('productPrices', sessionId);
  const prices = useFind(() => ProductPricesCollection.find({}, { sort: { uploadDate: -1 } }), []);
  
  // Subscribe to products
  const productsLoading = useSubscribe('products', sessionId);
  const products = useFind(() => ProductsCollection.find({}, { sort: { createdAt: -1 } }), []);

  // Filter and sort prices
  const filteredAndSortedPrices = useMemo(() => {
    let filtered = prices;
    
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = prices.filter(price => 
        price.isin.toLowerCase().includes(searchLower)
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];
      
      if (aValue instanceof Date) {
        aValue = aValue.getTime();
      }
      if (bValue instanceof Date) {
        bValue = bValue.getTime();
      }
      
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }
      
      let comparison = 0;
      if (aValue < bValue) comparison = -1;
      if (aValue > bValue) comparison = 1;
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [prices, searchTerm, sortField, sortDirection]);

  // Calculate products with missing or outdated prices
  const productsNeedingPrices = useMemo(() => {
    // Create a map of latest prices by ISIN
    const latestPricesByISIN = {};
    prices.forEach(price => {
      if (!latestPricesByISIN[price.isin] || 
          new Date(price.uploadDate) > new Date(latestPricesByISIN[price.isin].uploadDate)) {
        latestPricesByISIN[price.isin] = price;
      }
    });

    // Filter live products that need price updates
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    return products.filter(product => {
      // Only check products with ISIN (exclude drafts/deleted)
      if (!product.isin) return false;

      // Skip explicitly deleted or draft products
      if (product.status === 'deleted' || product.status === 'draft') return false;

      const latestPrice = latestPricesByISIN[product.isin];

      // No price at all
      if (!latestPrice) return true;

      // Price is older than one week
      if (new Date(latestPrice.uploadDate) < oneWeekAgo) return true;

      return false;
    }).map(product => {
      const latestPrice = latestPricesByISIN[product.isin];
      return {
        ...product,
        lastPrice: latestPrice,
        hasPrice: !!latestPrice,
        priceAge: latestPrice ? Math.floor((new Date() - new Date(latestPrice.uploadDate)) / (1000 * 60 * 60 * 24)) : null
      };
    });
  }, [products, prices]);

  // Handle sort
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Parse CSV file
  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    const data = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Detect separator - check if line contains semicolon or comma
      let separator = ',';
      if (line.includes(';') && !line.includes(',')) {
        separator = ';';
      } else if (line.includes(';') && line.includes(',')) {
        // If both exist, prefer semicolon if it appears before comma
        const semicolonIndex = line.indexOf(';');
        const commaIndex = line.indexOf(',');
        if (semicolonIndex < commaIndex) {
          separator = ';';
        }
      }
      
      // Split by detected separator
      const values = line.split(separator).map(val => val.trim().replace(/^["']|["']$/g, ''));
      
      if (values.length >= 2) {
        // Handle European decimal format (comma as decimal separator)
        let priceValue = values[1];
        if (separator === ';' && priceValue.includes(',')) {
          // European format: semicolon separator with comma as decimal (e.g., "US123;102,50")
          priceValue = priceValue.replace(',', '.');
        }
        
        data.push({
          isin: values[0],
          price: priceValue
        });
      }
    }
    
    console.log('Parsed CSV data:', data);
    return data;
  };

  // Handle file processing (shared between upload and drop)
  const processFile = async (file) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadResult({
        success: false,
        error: 'Please select a CSV file'
      });
      return;
    }

    setUploading(true);
    setUploadResult(null);

    try {
      const text = await file.text();
      const csvData = parseCSV(text);
      
      if (csvData.length === 0) {
        setUploadResult({
          success: false,
          error: 'No valid data found in CSV file'
        });
        setUploading(false);
        return;
      }

      console.log('Parsed CSV data:', csvData);

      // Upload to server
      Meteor.call('productPrices.uploadSimpleCsv', csvData, sessionId, (error, result) => {
        setUploading(false);
        
        if (error) {
          console.error('Upload error:', error);
          setUploadResult({
            success: false,
            error: error.message || 'Upload failed'
          });
        } else {
          console.log('Upload result:', result);
          setUploadResult(result);
        }
      });

    } catch (error) {
      console.error('File processing error:', error);
      setUploading(false);
      setUploadResult({
        success: false,
        error: 'Failed to process file: ' + error.message
      });
    }
  };

  // Handle drag and drop events
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!uploading) {
      setDragOver(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOver(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    if (uploading) return;

    const files = Array.from(e.dataTransfer.files);
    const csvFile = files.find(file => file.name.toLowerCase().endsWith('.csv'));
    
    if (!csvFile) {
      setUploadResult({
        success: false,
        error: 'Please drop a CSV file'
      });
      return;
    }

    await processFile(csvFile);
  };

  // Handle file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    await processFile(file);

    // Clear file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };


  return (
    <div>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes progress {
          0% { width: 0%; }
          50% { width: 100%; }
          100% { width: 0%; }
        }
      `}</style>

      {/* Upload Section */}
      <div style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        background: 'var(--bg-primary)'
      }}>
        <h3 style={{
          margin: '0 0 1.5rem 0',
          fontSize: '1.2rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          Upload Price Data
        </h3>
        <p style={{
          margin: '0 0 1.5rem 0',
          color: 'var(--text-secondary)',
          fontSize: '0.9rem'
        }}>
          Import product prices from CSV files
        </p>
        
        <div style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1rem 1.25rem',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 0.75rem 0',
            fontSize: '0.9rem',
            fontWeight: '600',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span style={{ color: 'var(--accent-color)' }}>ℹ️</span>
            CSV Format Guidelines
          </h4>
          <ul style={{
            margin: 0,
            paddingLeft: '1.5rem',
            color: 'var(--text-secondary)',
            fontSize: '0.85rem',
            lineHeight: '1.6'
          }}>
            <li>Column 1: ISIN code (e.g., US1234567890)</li>
            <li>Column 2: Price value</li>
            <li style={{ marginTop: '0.5rem' }}>Supported formats:</li>
            <ul style={{ marginTop: '0.25rem' }}>
              <li>US format: <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>US1234567890,102.50</code></li>
              <li>European format: <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>US1234567890;102,50</code></li>
            </ul>
          </ul>
        </div>

        {/* Drag and Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent-color)' : 'var(--border-color)'}`,
            borderRadius: '8px',
            padding: '2rem',
            textAlign: 'center',
            background: dragOver ? 'rgba(0, 123, 255, 0.05)' : 'var(--bg-secondary)',
            transition: 'all 0.3s ease',
            cursor: uploading ? 'not-allowed' : 'pointer',
            marginBottom: '1.5rem'
          }}
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          <div style={{ 
            fontSize: '2rem', 
            marginBottom: '1rem'
          }}>
            {uploading ? '⏳' : dragOver ? '📥' : '📤'}
          </div>
          <h4 style={{
            margin: '0 0 0.5rem 0',
            color: 'var(--text-primary)',
            fontSize: '1rem',
            fontWeight: '600'
          }}>
            {uploading ? 'Processing CSV file...' : dragOver ? 'Release to upload' : 'Drop CSV file here or click to browse'}
          </h4>
          <p style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: '0.875rem'
          }}>
            {uploading ? 'Please wait while we process your file' : 'Maximum file size: 50MB'}
          </p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <input
            id="csv-file-upload"
            name="csvFileUpload"
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            disabled={uploading}
            style={{ display: 'none' }}
          />
          
          {uploading && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--accent-color)',
              fontSize: '0.9rem',
              justifyContent: 'center',
              width: '100%'
            }}>
              <div style={{
                width: '16px',
                height: '16px',
                border: '2px solid var(--accent-color)',
                borderTop: '2px solid transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></div>
              Uploading...
            </div>
          )}
        </div>

        {/* Upload Result */}
        {uploadResult && (
          <div style={{
            marginTop: '1rem',
            padding: '12px 16px',
            borderRadius: '8px',
            fontSize: '0.875rem',
            background: uploadResult.success 
              ? 'rgba(40, 167, 69, 0.1)' 
              : 'rgba(220, 53, 69, 0.1)',
            border: `1px solid ${uploadResult.success 
              ? 'rgba(40, 167, 69, 0.3)' 
              : 'rgba(220, 53, 69, 0.3)'}`,
            color: uploadResult.success 
              ? 'var(--success-color)' 
              : 'var(--danger-color)'
          }}>
            {uploadResult.success ? (
              <div>
                <div style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
                  ✅ {uploadResult.message}
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  Processed: {uploadResult.stats.processed} | 
                  Updated: {uploadResult.stats.updated} | 
                  Inserted: {uploadResult.stats.inserted} | 
                  Errors: {uploadResult.stats.errors}
                </div>
                {uploadResult.errors && uploadResult.errors.length > 0 && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    <strong>Errors:</strong>
                    {uploadResult.errors.map((error, index) => (
                      <div key={index}>Row {error.row}: {error.error}</div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={{ fontWeight: '600' }}>{uploadResult.error}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Prices Database Section */}
      <div style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        background: 'var(--bg-primary)'
      }}>
        <h3 style={{
          margin: '0 0 1.5rem 0',
          fontSize: '1.2rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          Price Database
        </h3>
        <p style={{
          margin: '0 0 1.5rem 0',
          fontSize: '0.9rem',
          color: 'var(--text-secondary)'
        }}>
          {prices.length} total entries
        </p>
        
        {/* Header with Search */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem'
        }}>
          
          {/* Search Bar */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem'
          }}>
            <div>
              <label htmlFor="isin-search" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Search ISIN
              </label>
              <input
                id="isin-search"
                name="isinSearch"
                type="text"
                placeholder="Enter ISIN to search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '250px',
                  padding: '12px 16px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
            
            {searchTerm && (
              <span style={{
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                background: 'var(--bg-tertiary)',
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}>
                {filteredAndSortedPrices.length} results
              </span>
            )}
          </div>
        </div>

        {/* Prices Table */}
        {filteredAndSortedPrices.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '2rem',
            color: 'var(--text-secondary)'
          }}>
            <p>{prices.length === 0 ? 'No prices in database' : 'No matches found'}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', position: 'relative', zIndex: 1 }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              border: '1px solid var(--border-color)'
            }}>
            <thead>
              <tr>
                {[
                  { field: 'isin', label: 'ISIN' },
                  { field: 'price', label: 'Price' },
                  { field: 'currency', label: 'Currency' },
                  { field: 'uploadDate', label: 'Upload Date' },
                  { field: 'source', label: 'Source' }
                ].map(column => (
                  <th
                    key={column.field}
                    onClick={() => handleSort(column.field)}
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      padding: '12px',
                      border: '1px solid var(--border-color)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}
                  >
                    {column.label}
                    {sortField === column.field && (
                      <span style={{ marginLeft: '4px', fontSize: '0.75rem' }}>
                        {sortDirection === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedPrices.map((price, index) => (
                <tr key={price._id}>
                  <td style={{
                    padding: '12px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                    color: 'var(--text-primary)'
                  }}>
                    {price.isin}
                  </td>
                  <td style={{
                    padding: '12px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    {price.price.toFixed(2)}
                  </td>
                  <td style={{
                    padding: '12px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)',
                    fontSize: '0.875rem',
                    color: 'var(--text-secondary)'
                  }}>
                    {price.currency}
                  </td>
                  <td style={{
                    padding: '12px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)',
                    fontSize: '0.875rem',
                    color: 'var(--text-secondary)'
                  }}>
                    {price.uploadDate.toLocaleDateString()} {price.uploadDate.toLocaleTimeString()}
                  </td>
                  <td style={{
                    padding: '12px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)',
                    fontSize: '0.875rem',
                    color: 'var(--text-secondary)'
                  }}>
                    {price.metadata?.uploadType || 'csv_upload'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>

      {/* Products Needing Price Updates Section */}
      <div style={{
        marginTop: '2rem',
        background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
        borderRadius: '16px',
        border: '1px solid var(--border-color)',
        padding: '2rem',
        boxShadow: '0 2px 8px var(--shadow)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'var(--warning-color, #ffc107)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.25rem'
            }}>
              ⚠️
            </div>
            <div>
              <h3 style={{
                margin: 0,
                fontSize: '1.1rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Products Requiring Price Updates
              </h3>
              <p style={{
                margin: '0.125rem 0 0 0',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)'
              }}>
                Products with ISIN that have missing or outdated prices (older than 7 days)
              </p>
            </div>
          </div>
          
          <span style={{
            fontSize: '0.9rem',
            color: 'var(--text-secondary)',
            background: productsNeedingPrices.length > 0 ? 'rgba(255, 193, 7, 0.1)' : 'rgba(40, 167, 69, 0.1)',
            padding: '6px 12px',
            borderRadius: '6px',
            border: `1px solid ${productsNeedingPrices.length > 0 ? 'rgba(255, 193, 7, 0.3)' : 'rgba(40, 167, 69, 0.3)'}`,
            fontWeight: '500'
          }}>
            {productsNeedingPrices.length} {productsNeedingPrices.length === 1 ? 'product' : 'products'}
          </span>
        </div>

        {/* Products Table */}
        {productsNeedingPrices.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            border: '1px dashed var(--border-color)'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}>✅</div>
            <h3 style={{
              margin: '0 0 0.5rem 0',
              color: 'var(--text-secondary)',
              fontSize: '1.1rem',
              fontWeight: '500'
            }}>
              All products have recent prices
            </h3>
            <p style={{
              margin: 0,
              color: 'var(--text-muted)',
              fontSize: '0.85rem'
            }}>
              No products require price updates at this time
            </p>
          </div>
        ) : (
          <div style={{
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid var(--border-color)'
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse'
            }}>
              <thead>
                <tr style={{
                  background: 'var(--bg-tertiary)',
                  borderBottom: '1px solid var(--border-color)'
                }}>
                  <th style={{
                    padding: '14px 16px',
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.75px',
                    width: '25%'
                  }}>
                    Product
                  </th>
                  <th style={{
                    padding: '14px 16px',
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.75px',
                    width: '20%'
                  }}>
                    ISIN
                  </th>
                  <th style={{
                    padding: '14px 16px',
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.75px',
                    width: '20%'
                  }}>
                    Last Price
                  </th>
                  <th style={{
                    padding: '14px 16px',
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.75px',
                    width: '20%'
                  }}>
                    Last Update
                  </th>
                  <th style={{
                    padding: '14px 16px',
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.75px',
                    width: '15%'
                  }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {productsNeedingPrices.map((product, index) => (
                  <tr 
                    key={product._id}
                    style={{
                      borderBottom: index === productsNeedingPrices.length - 1 ? 'none' : '1px solid var(--border-color)',
                      transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <td style={{
                      padding: '14px 16px',
                      fontSize: '0.9rem',
                      color: 'var(--text-primary)',
                      fontWeight: '500'
                    }}>
                      {product.title || product.name || 'Unnamed Product'}
                    </td>
                    <td style={{
                      padding: '14px 16px',
                      fontSize: '0.9rem',
                      fontFamily: 'monospace',
                      color: 'var(--text-primary)'
                    }}>
                      {product.isin}
                    </td>
                    <td style={{
                      padding: '14px 16px',
                      fontSize: '0.9rem',
                      color: product.hasPrice ? 'var(--text-primary)' : 'var(--text-muted)'
                    }}>
                      {product.hasPrice 
                        ? `${product.lastPrice.price.toFixed(2)} ${product.lastPrice.currency || 'USD'}`
                        : 'No price'
                      }
                    </td>
                    <td style={{
                      padding: '14px 16px',
                      fontSize: '0.85rem',
                      color: 'var(--text-secondary)'
                    }}>
                      {product.hasPrice 
                        ? `${product.priceAge} day${product.priceAge !== 1 ? 's' : ''} ago`
                        : 'Never'
                      }
                    </td>
                    <td style={{
                      padding: '14px 16px'
                    }}>
                      <span style={{
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        background: product.hasPrice 
                          ? 'rgba(255, 193, 7, 0.1)' 
                          : 'rgba(220, 53, 69, 0.1)',
                        color: product.hasPrice 
                          ? 'var(--warning-color, #ffc107)' 
                          : 'var(--danger-color, #dc3545)',
                        border: `1px solid ${product.hasPrice 
                          ? 'rgba(255, 193, 7, 0.3)' 
                          : 'rgba(220, 53, 69, 0.3)'}`
                      }}>
                        {product.hasPrice ? 'Outdated' : 'Missing'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Prices;