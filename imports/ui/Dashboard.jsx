import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';
import { ProductPricesCollection } from '/imports/api/productPrices';
import { AllocationsCollection } from '/imports/api/allocations';
import { useTheme } from './ThemeContext.jsx';

const Dashboard = ({ onCreateProduct, onEditProduct, onViewReport, onDeleteProduct, onViewProductReport }) => {
  const { theme } = useTheme();
  
  // Responsive detection
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  
  // State for search and sorting
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('desc');
  const [showLiveOnly, setShowLiveOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [productsPerPage, setProductsPerPage] = useState(10);
  const [referenceCurrency, setReferenceCurrency] = useState('USD'); // TODO: Get from user preferences
  const [exchangeRates, setExchangeRates] = useState({}); // Cache for exchange rates

  // Responsive detection effect
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1024);
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, [])

  // Fetch exchange rates from currency cache (refreshes daily)
  useEffect(() => {
    const fetchExchangeRates = async () => {
      try {
        console.log('Dashboard: Fetching cached exchange rates...');
        
        // Use the currency cache for main currency pairs (cached for 24 hours)
        Meteor.call('currencyCache.getMainRates', (error, result) => {
          if (error) {
            console.error('Dashboard: Error fetching cached exchange rates:', error);
            return;
          }

          if (result && result.success) {
            setExchangeRates(result.rates);
            console.log(`Dashboard: Exchange rates updated from cache (${result.stats.cached} cached, ${result.stats.fetched} fetched):`, result.rates);
          } else {
            console.error('Dashboard: Failed to get exchange rates:', result?.error);
          }
        });
      } catch (error) {
        console.error('Dashboard: Error in fetchExchangeRates:', error);
      }
    };

    fetchExchangeRates();
  }, [referenceCurrency]);

  // Helper function to convert currency
  const convertCurrency = useCallback((amount, fromCurrency, toCurrency = referenceCurrency) => {
    if (fromCurrency === toCurrency) return amount;
    
    // If no exchange rates loaded yet, return original amount
    if (Object.keys(exchangeRates).length === 0) {
      return amount;
    }
    
    // For forex pairs, we get rates like EURUSD.FOREX (EUR to USD)
    const forexDirectKey = `${fromCurrency}${toCurrency}.FOREX`;
    const forexReverseKey = `${toCurrency}${fromCurrency}.FOREX`;
    
    if (exchangeRates[forexDirectKey]) {
      return amount * exchangeRates[forexDirectKey];
    }
    
    if (exchangeRates[forexReverseKey]) {
      return amount / exchangeRates[forexReverseKey];
    }
    
    // Also try without .FOREX suffix for direct pairs
    const directRateKey = `${fromCurrency}${toCurrency}`;
    const reverseRateKey = `${toCurrency}${fromCurrency}`;
    
    if (exchangeRates[directRateKey]) {
      return amount * exchangeRates[directRateKey];
    }
    
    if (exchangeRates[reverseRateKey]) {
      return amount / exchangeRates[reverseRateKey];
    }
    
    // Cross-currency conversion via USD (if available)
    const usdFromKey = `${fromCurrency}USD.FOREX`;
    const usdToKey = `USD${toCurrency}.FOREX`;
    const fromUsdKey = `USD${fromCurrency}.FOREX`;
    const toUsdKey = `${toCurrency}USD.FOREX`;
    
    if (exchangeRates[usdFromKey] && exchangeRates[usdToKey]) {
      // fromCurrency -> USD -> toCurrency
      const usdAmount = amount * exchangeRates[usdFromKey];
      return usdAmount * exchangeRates[usdToKey];
    } else if (exchangeRates[fromUsdKey] && exchangeRates[toUsdKey]) {
      // fromCurrency -> USD -> toCurrency (using reverse rates)
      const usdAmount = amount / exchangeRates[fromUsdKey];
      return usdAmount / exchangeRates[toUsdKey];
    }
    
    // Fallback: return original amount if no rate available
    console.warn(`No exchange rate found for ${fromCurrency} to ${toCurrency}. Available rates:`, Object.keys(exchangeRates));
    return amount;
  }, [exchangeRates, referenceCurrency]);

  // Helper function to get standardized product status
  const getStandardizedProductStatus = (product) => {
    // First check the new standardized field in the product record
    if (product.productStatus) {
      return product.productStatus;
    }
    
    // Fallback to old status system
    if (product.status) {
      return product.status;
    }
    
    // Default to live for products with payoff structure
    if (product.payoffStructure && product.payoffStructure.length > 0) {
      return 'live';
    }
    
    return null;
  };

  // Function to get product lifecycle status using standardized report data
  const getProductLifecycleStatus = (product) => {
    // First check the new standardized fields in the product record
    if (product.productStatus) {
      const status = product.productStatus;
      const statusDetails = product.statusDetails;
      
      switch (status) {
        case 'autocalled':
          if (statusDetails?.callDateFormatted) {
            return `Autocalled on ${statusDetails.callDateFormatted}`;
          }
          return 'Autocalled';
        case 'matured':
          return 'Matured';
        case 'live':
          return 'Live';
        default:
          return status.charAt(0).toUpperCase() + status.slice(1);
      }
    }
    
    // Fallback to old status system
    if (product.status) {
      const status = product.status.charAt(0).toUpperCase() + product.status.slice(1);
      
      if (product.status === 'autocalled' && product.statusDate) {
        const date = new Date(product.statusDate).toLocaleDateString();
        return `Autocalled on ${date}`;
      } else if (product.status === 'matured') {
        return 'Matured';
      }
      
      return status;
    }
    
    // Default to Live if no status is available
    return 'Live';
  };
  
  // Stable sessionId
  const sessionId = useMemo(() => localStorage.getItem('sessionId'), []);
  
  // Use useTracker for more stable subscription handling
  const { products, allocations, productPrices, isLoading } = useTracker(() => {
    // Subscribe to all required data
    const productsHandle = Meteor.subscribe('products', sessionId);
    const allocationsHandle = Meteor.subscribe('allAllocations', sessionId);
    const pricesHandle = Meteor.subscribe('productPrices', sessionId);
    
    const loading = !productsHandle.ready() || !allocationsHandle.ready() || !pricesHandle.ready();
    
    return {
      products: ProductsCollection.find({}, { sort: { createdAt: -1 } }).fetch(),
      allocations: AllocationsCollection.find().fetch(),
      productPrices: ProductPricesCollection.find({ isActive: true }).fetch(),
      isLoading: loading
    };
  }, [sessionId]);

  // Calculate nominal totals per product (memoized for performance)
  const nominalByProduct = useMemo(() => {
    const totals = {};
    allocations.forEach(allocation => {
      if (allocation.status === 'active') {
        totals[allocation.productId] = (totals[allocation.productId] || 0) + allocation.nominalInvested;
      }
    });
    return totals;
  }, [allocations]);

  // Create price map for efficient lookup
  const priceMap = useMemo(() => {
    const map = new Map();
    productPrices.forEach(priceRecord => {
      map.set(priceRecord.isin, priceRecord.price);
    });
    return map;
  }, [productPrices]);

  // Calculate total portfolio value (memoized for performance)
  const portfolioTotalValue = useMemo(() => {
    let total = 0;
    products.forEach(product => {
      const nominal = nominalByProduct[product._id];
      if (nominal) {
        // Get current price from uploaded prices, fallback to 100.00
        const currentPrice = priceMap.get(product.isin) || 100.00;
        const positionValue = nominal * currentPrice / 100;
        
        // Convert from product currency to reference currency
        const fromCurrency = product.currency || 'USD';
        const toCurrency = referenceCurrency;
        
        if (fromCurrency === toCurrency) {
          total += positionValue;
        } else {
          // Inline currency conversion to avoid dependency loop
          let convertedValue = positionValue;
          
          if (Object.keys(exchangeRates).length > 0) {
            const forexDirectKey = `${fromCurrency}${toCurrency}.FOREX`;
            const forexReverseKey = `${toCurrency}${fromCurrency}.FOREX`;
            
            if (exchangeRates[forexDirectKey]) {
              convertedValue = positionValue * exchangeRates[forexDirectKey];
            } else if (exchangeRates[forexReverseKey]) {
              convertedValue = positionValue / exchangeRates[forexReverseKey];
            } else {
              // Try cross-currency conversion via USD
              const usdFromKey = `${fromCurrency}USD.FOREX`;
              const usdToKey = `USD${toCurrency}.FOREX`;
              
              if (exchangeRates[usdFromKey] && exchangeRates[usdToKey]) {
                const usdAmount = positionValue * exchangeRates[usdFromKey];
                convertedValue = usdAmount * exchangeRates[usdToKey];
              }
            }
          }
          
          total += convertedValue;
        }
      }
    });
    return total;
  }, [products, nominalByProduct, priceMap, exchangeRates, referenceCurrency]);

  // Filter and sort products
  const filteredAndSortedProducts = useMemo(() => {
    // First filter by search term
    let filtered = products;
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = products.filter(product =>
        (product.productName && product.productName.toLowerCase().includes(searchLower)) ||
        (product.title && product.title.toLowerCase().includes(searchLower)) ||
        (product.isin && product.isin.toLowerCase().includes(searchLower)) ||
        (product.currency && product.currency.toLowerCase().includes(searchLower)) ||
        (product.issuer && product.issuer.toLowerCase().includes(searchLower))
      );
    }

    // Filter by live status if toggle is enabled
    if (showLiveOnly) {
      filtered = filtered.filter(product => {
        return getStandardizedProductStatus(product) === 'live';
      });
    }

    // Then sort
    const sorted = [...filtered].sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];
      
      // Handle special cases
      if (sortField === 'status') {
        aValue = getProductLifecycleStatus(a);
        bValue = getProductLifecycleStatus(b);
      }
      
      // Handle null/undefined values
      if (!aValue) aValue = '';
      if (!bValue) bValue = '';
      
      // Compare values
      let comparison = 0;
      if (typeof aValue === 'string') {
        comparison = aValue.localeCompare(bValue);
      } else if (aValue instanceof Date || !isNaN(Date.parse(aValue))) {
        comparison = new Date(aValue) - new Date(bValue);
      } else {
        comparison = aValue - bValue;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return sorted;
  }, [products, searchTerm, sortField, sortDirection, showLiveOnly]);

  // Pagination logic
  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * productsPerPage;
    const endIndex = startIndex + productsPerPage;
    return filteredAndSortedProducts.slice(startIndex, endIndex);
  }, [filteredAndSortedProducts, currentPage, productsPerPage]);

  const totalPages = Math.ceil(filteredAndSortedProducts.length / productsPerPage);

  // Handle sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Generate a display title for products without a title
  const getProductDisplayTitle = (product) => {
    // If product has a title, use it
    if (product.title) return product.title;
    if (product.productName) return product.productName;

    // Generate a descriptive title from available data
    const parts = [];

    // Add underlyings if available
    if (product.underlyings && product.underlyings.length > 0) {
      const tickers = product.underlyings.map(u => u.ticker || u.symbol).filter(Boolean);
      if (tickers.length > 0) {
        parts.push(tickers.join('/'));
      }
    }

    // Add template/product type if available
    if (product.templateId || product.template) {
      const template = (product.templateId || product.template).replace(/_/g, ' ');
      parts.push(template.charAt(0).toUpperCase() + template.slice(1));
    }

    // Add currency if available
    if (product.currency) {
      parts.push(product.currency);
    }

    // If we generated any parts, join them
    if (parts.length > 0) {
      return parts.join(' ');
    }

    // Last resort: use ISIN if available
    if (product.isin) {
      return `Product ${product.isin}`;
    }

    return 'Untitled Product';
  };

  // Show loading state
  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '400px',
        color: 'var(--text-secondary)'
      }}>
        Loading products...
      </div>
    );
  }

  return (
    <div style={{ 
      maxWidth: '1200px', 
      margin: '0 auto', 
      padding: isMobile ? '1rem' : '2rem',
      backgroundColor: 'transparent',
      transition: 'all 0.3s ease'
    }}>
      {/* Dashboard Header */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: isMobile ? '1rem' : '0',
        marginBottom: '2rem',
        padding: isMobile ? '1rem 0' : '1.5rem 0',
        borderBottom: '2px solid var(--border-color)'
      }}>
        <div>
          <h1 style={{
            margin: '0 0 0.5rem 0',
            fontSize: isMobile ? '1.5rem' : '2rem',
            fontWeight: '700',
            color: 'var(--text-primary)'
          }}>
            Product Dashboard
          </h1>
          <p style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.9rem' : '1rem'
          }}>
            Manage and overview your structured products
          </p>
        </div>
        <button
          onClick={onCreateProduct}
          style={{
            background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            color: 'white',
            border: 'none',
            padding: isMobile ? '10px 20px' : '12px 24px',
            borderRadius: '8px',
            fontSize: isMobile ? '0.9rem' : '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.3s ease',
            boxShadow: '0 2px 8px rgba(0, 123, 255, 0.3)',
            width: isMobile ? '100%' : 'auto'
          }}
          onMouseEnter={(e) => {
            e.target.style.transform = 'translateY(-2px)';
            e.target.style.boxShadow = '0 4px 12px rgba(0, 123, 255, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = '0 2px 8px rgba(0, 123, 255, 0.3)';
          }}
        >
          <span>➕</span>
          Create New Product
        </button>
      </div>

      {/* Search Bar */}
      <div style={{
        marginBottom: '2rem',
        position: 'relative'
      }}>
        <input
          type="text"
          placeholder="Search by title, ISIN, currency, or issuer..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: isMobile ? '10px 40px 10px 16px' : '12px 48px 12px 20px',
            fontSize: isMobile ? '0.9rem' : '1rem',
            border: '2px solid var(--border-color)',
            borderRadius: '10px',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            outline: 'none',
            transition: 'all 0.3s ease'
          }}
          onFocus={(e) => {
            e.target.style.borderColor = 'var(--accent-color)';
            e.target.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.1)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'var(--border-color)';
            e.target.style.boxShadow = 'none';
          }}
        />
        <span style={{
          position: 'absolute',
          right: isMobile ? '12px' : '16px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-secondary)',
          fontSize: isMobile ? '1rem' : '1.2rem',
          pointerEvents: 'none'
        }}>
          🔍
        </span>
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            style={{
              position: 'absolute',
              right: isMobile ? '35px' : '45px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.color = 'var(--accent-color)';
            }}
            onMouseLeave={(e) => {
              e.target.style.color = 'var(--text-secondary)';
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Filter Controls */}
      <div style={{
        marginBottom: '2rem',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: isMobile ? '1rem' : '0'
      }}>
        <div style={{ 
          display: 'flex', 
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          gap: isMobile ? '1rem' : '0'
        }}>
        {/* Live Products Toggle */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 16px',
          border: '2px solid var(--border-color)',
          borderRadius: '10px',
          background: 'var(--bg-secondary)',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          userSelect: 'none'
        }}
        onClick={() => setShowLiveOnly(!showLiveOnly)}
        >
          <div style={{
            width: '20px',
            height: '20px',
            border: '2px solid var(--accent-color)',
            borderRadius: '4px',
            background: showLiveOnly ? 'var(--accent-color)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s ease'
          }}>
            {showLiveOnly && (
              <span style={{
                color: 'white',
                fontSize: '12px',
                fontWeight: 'bold'
              }}>
                ✓
              </span>
            )}
          </div>
          <span style={{
            color: 'var(--text-primary)',
            fontSize: '0.95rem',
            fontWeight: '500'
          }}>
            Show Live Products Only
          </span>
        </div>

        {/* Products Per Page */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginLeft: isMobile ? '0' : '20px'
        }}>
          <span style={{
            color: 'var(--text-primary)',
            fontSize: '0.95rem',
            fontWeight: '500'
          }}>
            Show
          </span>
          <select
            value={productsPerPage}
            onChange={(e) => {
              setProductsPerPage(Number(e.target.value));
              setCurrentPage(1); // Reset to first page when changing per page
            }}
            style={{
              padding: '6px 12px',
              border: '2px solid var(--border-color)',
              borderRadius: '6px',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span style={{
            color: 'var(--text-primary)',
            fontSize: '0.95rem',
            fontWeight: '500'
          }}>
            products per page
          </span>
        </div>
        </div>

        {/* Reference Currency Selector - Right aligned */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <span style={{
            color: 'var(--text-primary)',
            fontSize: '0.95rem',
            fontWeight: '500'
          }}>
            Reference Currency
          </span>
          <select
            value={referenceCurrency}
            onChange={(e) => setReferenceCurrency(e.target.value)}
            style={{
              padding: '6px 12px',
              border: '2px solid var(--border-color)',
              borderRadius: '6px',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              minWidth: '80px'
            }}
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="CHF">CHF</option>
            <option value="JPY">JPY</option>
            <option value="CAD">CAD</option>
            <option value="AUD">AUD</option>
          </select>
        </div>
      </div>

      {/* Statistics Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr 1fr' : isTablet ? 'repeat(3, 1fr)' : 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: isMobile ? '0.75rem' : '1.5rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: isMobile ? '1rem' : '1.5rem',
          textAlign: 'center',
          boxShadow: '0 2px 4px var(--shadow)',
          display: 'flex',
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'center',
          gap: isMobile ? '0.5rem' : '0'
        }}>
          <div style={{
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            order: isMobile ? 1 : 2
          }}>
            Total Products
          </div>
          <div style={{
            fontSize: isMobile ? '1.1rem' : '1.3rem',
            fontWeight: '700',
            color: 'var(--accent-color)',
            marginBottom: isMobile ? '0' : '0.5rem',
            order: isMobile ? 2 : 1
          }}>
            {products.length}
          </div>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: isMobile ? '1rem' : '1.5rem',
          textAlign: 'center',
          boxShadow: '0 2px 4px var(--shadow)',
          display: 'flex',
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'center',
          gap: isMobile ? '0.5rem' : '0'
        }}>
          <div style={{
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            order: isMobile ? 1 : 2
          }}>
            Portfolio Value
          </div>
          <div style={{
            fontSize: isMobile ? '0.95rem' : '1.1rem',
            fontWeight: '700',
            color: 'var(--success-color)',
            marginBottom: isMobile ? '0' : '0.5rem',
            wordBreak: 'break-word',
            lineHeight: '1.2',
            order: isMobile ? 2 : 1
          }}>
            {referenceCurrency} {portfolioTotalValue.toLocaleString(undefined, {
              minimumFractionDigits: isMobile ? 0 : 2,
              maximumFractionDigits: isMobile ? 0 : 2
            })}
          </div>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: isMobile ? '1rem' : '1.5rem',
          textAlign: 'center',
          boxShadow: '0 2px 4px var(--shadow)',
          display: 'flex',
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'center',
          gap: isMobile ? '0.5rem' : '0'
        }}>
          <div style={{
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            order: isMobile ? 1 : 2
          }}>
            Live Products
          </div>
          <div style={{
            fontSize: isMobile ? '1.1rem' : '1.3rem',
            fontWeight: '700',
            color: 'var(--warning-color)',
            marginBottom: isMobile ? '0' : '0.5rem',
            order: isMobile ? 2 : 1
          }}>
            {products.filter(p => getStandardizedProductStatus(p) === 'live').length}
          </div>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: isMobile ? '1rem' : '1.5rem',
          textAlign: 'center',
          boxShadow: '0 2px 4px var(--shadow)',
          display: isMobile ? 'none' : 'flex', // Hide on mobile to save space
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'center',
          gap: isMobile ? '0.5rem' : '0'
        }}>
          <div style={{
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            order: isMobile ? 1 : 2
          }}>
            Autocalled
          </div>
          <div style={{
            fontSize: isMobile ? '1.1rem' : '1.3rem',
            fontWeight: '700',
            color: '#0284c7',
            marginBottom: isMobile ? '0' : '0.5rem',
            order: isMobile ? 2 : 1
          }}>
            {products.filter(p => getStandardizedProductStatus(p) === 'autocalled').length}
          </div>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: isMobile ? '1rem' : '1.5rem',
          textAlign: 'center',
          boxShadow: '0 2px 4px var(--shadow)',
          display: isMobile ? 'none' : 'flex', // Hide on mobile to save space
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'center',
          gap: isMobile ? '0.5rem' : '0'
        }}>
          <div style={{
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            order: isMobile ? 1 : 2
          }}>
            Matured
          </div>
          <div style={{
            fontSize: isMobile ? '1.1rem' : '1.3rem',
            fontWeight: '700',
            color: '#6b7280',
            marginBottom: isMobile ? '0' : '0.5rem',
            order: isMobile ? 2 : 1
          }}>
            {products.filter(p => getStandardizedProductStatus(p) === 'matured').length}
          </div>
        </div>
      </div>

      {/* Products Display */}
      {filteredAndSortedProducts.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '2px dashed var(--border-color)'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: 0.5 }}>📊</div>
          <h2 style={{
            margin: '0 0 1rem 0',
            color: 'var(--text-secondary)',
            fontSize: '1.2rem'
          }}>
            {products.length === 0 ? 'No products created yet' : 'No products match your search'}
          </h2>
          <p style={{
            margin: '0 0 2rem 0',
            color: 'var(--text-muted)',
            fontSize: '1rem'
          }}>
            {products.length === 0 
              ? 'Get started by creating your first structured product' 
              : 'Try adjusting your search terms'}
          </p>
          {products.length === 0 && (
            <button
              onClick={onCreateProduct}
              style={{
                background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
                color: 'white',
                border: 'none',
                padding: '14px 28px',
                borderRadius: '8px',
                fontSize: '1.1rem',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
            >
              Create Your First Product
            </button>
          )}
        </div>
      ) : (
        // Products Table
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          overflow: isMobile || isTablet ? 'auto' : 'hidden'
        }}>
          <table style={{
            width: isMobile || isTablet ? 'max-content' : '100%',
            minWidth: isMobile || isTablet ? '800px' : 'auto',
            borderCollapse: 'collapse',
            tableLayout: 'fixed'
          }}>
            <thead>
              <tr style={{
                background: 'var(--bg-tertiary)',
                borderBottom: '2px solid var(--border-color)'
              }}>
                {[
                  { field: 'title', label: 'Product Title', width: '30%' },
                  { field: 'isin', label: 'ISIN', width: '12%' },
                  { field: 'currency', label: 'Cur', width: '5%' },
                  { field: 'nominal', label: 'Nominal', width: '10%' },
                  { field: 'price', label: 'Price', width: '7%' },
                  { field: 'position', label: 'Position Value', width: '12%' },
                  { field: 'status', label: 'Status', width: '9%' },
                  { field: 'maturity', label: 'Maturity', width: '10%' }
                ].map(column => (
                  <th
                    key={column.field}
                    onClick={() => handleSort(column.field)}
                    style={{
                      padding: isMobile ? '8px 12px' : '12px 16px',
                      textAlign: 'center',
                      fontSize: isMobile ? '0.75rem' : '0.85rem',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      cursor: 'pointer',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.2s ease',
                      width: column.width || 'auto'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.color = 'var(--accent-color)';
                      e.target.style.background = 'rgba(0, 123, 255, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.color = 'var(--text-secondary)';
                      e.target.style.background = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      {column.label}
                      {sortField === column.field && (
                        <span style={{ fontSize: '0.7rem' }}>
                          {sortDirection === 'asc' ? '▲' : '▼'}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                <th style={{
                  padding: isMobile ? '8px 12px' : '12px 16px',
                  width: '5%',
                  textAlign: 'center',
                  fontSize: isMobile ? '0.75rem' : '0.85rem',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedProducts.map((product, index) => (
                <tr
                  key={product._id}
                  onClick={() => onViewProductReport ? onViewProductReport(product) : onEditProduct(product)}
                  style={{
                    borderBottom: '1px solid var(--border-color)',
                    transition: 'all 0.2s ease',
                    background: index % 2 === 0 ? 'transparent' : 'var(--bg-primary)',
                     cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                     e.currentTarget.style.transform = 'translateY(-1px)';
                     e.currentTarget.style.boxShadow = '0 2px 8px var(--shadow)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = index % 2 === 0 ? 'transparent' : 'var(--bg-primary)';
                     e.currentTarget.style.transform = 'translateY(0)';
                     e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <td style={{
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    fontSize: isMobile ? '0.85rem' : '0.95rem',
                    fontWeight: '500',
                    color: 'var(--text-primary)'
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      {/* Template Icon */}
                      <span style={{ fontSize: '1.2rem' }}>
                        {(() => {
                          const templateId = product.templateId || product.template || '';
                          switch(templateId) {
                            case 'phoenix_autocallable': return '🦅';
                            case 'orion_memory': return '⭐';
                            case 'himalaya': return '🏔️';
                            case 'shark_note': return '🦈';
                            default: return '📊';
                          }
                        })()}
                      </span>
                      {getProductDisplayTitle(product)}
                    </div>
                  </td>
                  <td style={{
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    fontSize: isMobile ? '0.8rem' : '0.9rem',
                    color: 'var(--text-secondary)',
                    fontFamily: 'monospace'
                  }}>
                    {product.isin || '-'}
                  </td>
                  <td style={{
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    fontSize: isMobile ? '0.8rem' : '0.9rem',
                    color: 'var(--text-secondary)',
                    textAlign: 'center'
                  }}>
                    {product.currency || '-'}
                  </td>
                  <td style={{
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    fontSize: isMobile ? '0.8rem' : '0.9rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    textAlign: 'right'
                  }}>
                    {nominalByProduct[product._id] ? 
                      nominalByProduct[product._id].toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      }) : 
                      '-'
                    }
                  </td>
                  <td style={{
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    fontSize: isMobile ? '0.8rem' : '0.9rem',
                    color: 'var(--text-secondary)',
                    textAlign: 'right'
                  }}>
                    {(() => {
                      // Get current price from uploaded prices, fallback to 100.00
                      const currentPrice = priceMap.get(product.isin) || 100.00;
                      return `${currentPrice.toFixed(2)}%`;
                    })()}
                  </td>
                  <td style={{
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    fontSize: isMobile ? '0.8rem' : '0.9rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    textAlign: 'right'
                  }}>
                    {(() => {
                      const nominal = nominalByProduct[product._id];
                      // Get current price from uploaded prices, fallback to 100.00
                      const currentPrice = priceMap.get(product.isin) || 100.00;
                      const positionValue = nominal ? (nominal * currentPrice / 100) : 0;
                      
                      if (positionValue <= 0) return '-';
                      
                      // Convert from product currency to reference currency
                      const convertedValue = convertCurrency(positionValue, product.currency || 'USD');
                      
                      return convertedValue.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      });
                    })()}
                  </td>
                  <td style={{
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    textAlign: 'center'
                  }}>
                    {(() => {
                      const status = getProductLifecycleStatus(product);
                      const getStatusColor = (status) => {
                        if (status.startsWith('Autocalled')) return '#0284c7'; // Blue
                        if (status.startsWith('Matured')) return '#6b7280'; // Gray
                        switch (status) {
                          case 'Live': return '#059669'; // Green
                          case 'Pending': return '#f59e0b'; // Amber
                          default: return '#6b7280';
                        }
                      };
                      
                      return (
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          background: getStatusColor(status),
                          color: 'white'
                        }}>
                          {status}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    fontSize: isMobile ? '0.8rem' : '0.9rem',
                    color: 'var(--text-secondary)',
                    width: '120px',
                    textAlign: 'center'
                  }}>
                    {product.maturity || '-'}
                  </td>
                  <td style={{
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    textAlign: 'center'
                  }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditProduct(product);
                        }}
                        style={{
                          padding: '6px 12px',
                          background: 'var(--accent-color)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                          fontWeight: '500',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.transform = 'scale(1.05)';
                          e.target.style.boxShadow = '0 2px 6px rgba(0, 123, 255, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.transform = 'scale(1)';
                          e.target.style.boxShadow = 'none';
                        }}
                      >
                        Edit
                      </button>
                      {onDeleteProduct && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteProduct(product);
                          }}
                          style={{
                            padding: '6px 10px',
                            background: '#dc3545',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '1rem',
                            fontWeight: '700',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            lineHeight: '1'
                          }}
                          onMouseEnter={(e) => {
                            e.target.style.transform = 'scale(1.05)';
                            e.target.style.boxShadow = '0 2px 6px rgba(220, 53, 69, 0.3)';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.transform = 'scale(1)';
                            e.target.style.boxShadow = 'none';
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredAndSortedProducts.length > 0 && (
            <div style={{
              padding: isMobile ? '8px 12px' : '12px 16px',
              background: 'var(--bg-tertiary)',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: isMobile ? '1rem' : '0'
            }}>
              <div style={{
                fontSize: isMobile ? '0.75rem' : '0.85rem',
                color: 'var(--text-secondary)',
                textAlign: isMobile ? 'center' : 'left'
              }}>
                Showing {((currentPage - 1) * productsPerPage) + 1} to {Math.min(currentPage * productsPerPage, filteredAndSortedProducts.length)} of {filteredAndSortedProducts.length} products
              </div>
              
              {totalPages > 1 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: isMobile ? '5px' : '10px',
                  flexWrap: isMobile ? 'wrap' : 'nowrap',
                  justifyContent: isMobile ? 'center' : 'flex-start'
                }}>
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    style={{
                      padding: '6px 12px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      background: currentPage === 1 ? 'var(--bg-muted)' : 'var(--bg-secondary)',
                      color: currentPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                      cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                      fontSize: '0.85rem',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    Previous
                  </button>
                  
                  <span style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    padding: '0 10px'
                  }}>
                    Page {currentPage} of {totalPages}
                  </span>
                  
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    style={{
                      padding: '6px 12px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      background: currentPage === totalPages ? 'var(--bg-muted)' : 'var(--bg-secondary)',
                      color: currentPage === totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                      cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                      fontSize: '0.85rem',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Dashboard;