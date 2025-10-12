import React, { useState, useEffect } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';
import { ReportsCollection } from '/imports/api/reports';
import { USER_ROLES, UsersCollection } from '/imports/api/users';
import { AllocationsCollection, AllocationHelpers } from '/imports/api/allocations';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { ProductPricesCollection } from '/imports/api/productPrices';
import StructuredProductChart from './components/StructuredProductChart.jsx';
import HimalayaReport from './templates/HimalayaReport.jsx';
import OrionReport from './templates/OrionReport.jsx';
import PhoenixReport from './templates/PhoenixReport.jsx';
import SharkNoteReport from './templates/SharkNoteReport.jsx';
import ProductCommentaryCard from './components/ProductCommentaryCard.jsx';

/**
 * New Template-based Product Report Component
 * 
 * This replaces the old complex ProductReport with a simpler, template-focused approach.
 * Each template will have its own report builder and layout.
 */
const TemplateProductReport = ({ productId, user, onNavigateBack, onEditProduct, onAllocateProduct }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState(null);
  const [showAllocationDetails, setShowAllocationDetails] = useState(false);

  // Subscribe to product, reports, allocations, users and bank accounts
  const { product, latestReport, allocations, allocationsSummary, allocationDetails, productPrice, isDataReady } = useTracker(() => {
    const sessionId = localStorage.getItem('sessionId');
    const productHandle = Meteor.subscribe('products.single', productId);
    const reportsHandle = Meteor.subscribe('reports.forProduct', productId);
    const allocationsHandle = Meteor.subscribe('productAllocations', productId, sessionId);
    const usersHandle = Meteor.subscribe('customUsers');
    const bankAccountsHandle = Meteor.subscribe('allBankAccounts');
    const banksHandle = Meteor.subscribe('banks');

    const productData = ProductsCollection.findOne(productId);

    // Subscribe to price history for this product's ISIN
    let priceHandle = { ready: () => true };
    let latestPrice = null;
    if (productData && productData.isin) {
      priceHandle = Meteor.subscribe('priceHistory', productData.isin, 1);
      latestPrice = ProductPricesCollection.findOne(
        { isin: productData.isin.toUpperCase(), isActive: true },
        { sort: { priceDate: -1, uploadDate: -1 } }
      );
    }
    const reportData = ReportsCollection.findOne(
      { productId },
      { sort: { createdAt: -1 } }
    );
    
    const allAllocations = AllocationsCollection.find({ 
      productId, 
      status: 'active' 
    }, { sort: { allocatedAt: -1 } }).fetch();
    
    // Filter allocations based on user role
    let allocationData = allAllocations;
    if (user && user.role === USER_ROLES.CLIENT) {
      // Client sees only their own allocations
      allocationData = allAllocations.filter(allocation => allocation.clientId === user._id);
    }
    
    // Calculate allocation summary (role-based)
    let summary = null;
    console.log('TemplateProductReport: ProductId:', productId, 'AllocationData length:', allocationData.length);
    console.log('TemplateProductReport: User role:', user?.role, 'UserId:', user?._id);
    console.log('TemplateProductReport: AllocationData:', allocationData);
    
    if (allocationData.length > 0) {
      const productCurrency = productData?.currency || 'USD';
      
      // Check if there are multiple currencies in allocations
      const currencies = [...new Set(allocationData.map(a => a.referenceCurrency).filter(Boolean))];
      const hasMixedCurrencies = currencies.length > 1;
      
      // Use helper function for allocation calculations (all pre-computed)
      const computedSummary = AllocationHelpers.computeAllocationSummary(allocationData);
      
      summary = {
        ...computedSummary,
        isClientView: user && user.role === USER_ROLES.CLIENT,
        currency: productCurrency,
        hasMixedCurrencies,
        currencies,
        // Override formatted field to include currency
        totalNominalInvestedFormatted: `${computedSummary.totalNominalInvested.toLocaleString()} ${productCurrency}`
      };
    } else {
      console.log('TemplateProductReport: No allocation data found for product:', productId);
    }
    
    // Build detailed allocation information for the collapsible section (pre-formatted)
    let detailsData = null;
    if (allocationData.length > 0 && !summary?.isClientView) {
      const users = UsersCollection.find().fetch();
      const bankAccounts = BankAccountsCollection.find().fetch();
      const banks = BanksCollection.find().fetch();
      
      const usersById = {};
      const bankAccountsById = {};
      const banksById = {};
      
      users.forEach(u => { usersById[u._id] = u; });
      bankAccounts.forEach(ba => { bankAccountsById[ba._id] = ba; });
      banks.forEach(b => { banksById[b._id] = b; });
      
      // Use helper function to get pre-formatted allocation details
      const formattedAllocations = AllocationHelpers.formatAllocationDetails(allocationData);
      
      detailsData = formattedAllocations.map(allocation => {
        const client = usersById[allocation.clientId];
        const bankAccount = bankAccountsById[allocation.bankAccountId];
        const bank = banksById[bankAccount?.bankId];
        
        return {
          ...allocation,
          clientName: client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() : 'Unknown Client',
          clientEmail: client?.email || 'Unknown',
          bankName: bank?.name || 'Unknown Bank',
          accountNumber: bankAccount?.accountNumber || 'Unknown',
          accountCurrency: bankAccount?.referenceCurrency || 'USD',
          nominalInvestedFormatted: (allocation.nominalInvested || 0).toLocaleString()
        };
      });
    }
    
    console.log('TemplateProductReport: ProductData notional values:', {
      productNotionalFormatted: productData?.notionalFormatted,
      reportNotionalFormatted: reportData?.notionalFormatted,
      productCurrency: productData?.currency,
      calculatedSummary: summary
    });
    
    return {
      product: productData,
      latestReport: reportData,
      allocations: allocationData,
      allocationsSummary: summary,
      allocationDetails: detailsData,
      productPrice: latestPrice,
      isDataReady: productHandle.ready() && reportsHandle.ready() && allocationsHandle.ready() &&
                   usersHandle.ready() && bankAccountsHandle.ready() && banksHandle.ready() && priceHandle.ready()
    };
  }, [productId]);

  // Update loading state
  useEffect(() => {
    if (isDataReady) {
      setIsLoading(false);
    }
  }, [isDataReady]);

  // ❌ REMOVED - All formatting calculations moved to processor
  // Report components must only display pre-computed values

  // Handle evaluation
  const handleEvaluateProduct = async () => {
    if (!product) return;
    
    setIsEvaluating(true);
    setEvaluationError(null);
    
    try {
      console.log('TemplateProductReport: Starting evaluation for product:', product._id);
      
      const sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        throw new Error('No session found');
      }
      
      // Call the reports method
      const reportId = await Meteor.callAsync('reports.createTemplate', product, sessionId);
      console.log('TemplateProductReport: Evaluation completed, report ID:', reportId);
      
      // The useTracker will automatically pick up the new report due to reactivity
      
    } catch (error) {
      console.error('TemplateProductReport: Evaluation failed:', error);
      setEvaluationError(error.message || 'Failed to evaluate product');
    } finally {
      setIsEvaluating(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '400px',
        color: 'var(--text-secondary)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📊</div>
          Loading product report...
        </div>
      </div>
    );
  }

  // Product not found
  if (!product) {
    return (
      <div style={{
        maxWidth: '800px',
        margin: '2rem auto',
        padding: '2rem',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>❌</div>
        <h2 style={{ color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Product Not Found
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          The product you're looking for could not be found.
        </p>
        <button
          onClick={onNavigateBack}
          style={{
            background: 'var(--accent-color)',
            color: 'white',
            border: 'none',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '2rem'
    }}>
      {/* Header */}
      <div style={{
        marginBottom: '2rem',
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {/* Background Image */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: `url('/images/${(() => {
            const templateId = latestReport?.templateId || 'unknown';
            switch(templateId) {
              case 'phoenix_autocallable': return 'phoenix.gif';
              case 'orion_memory': return 'orion.png';
              case 'himalaya': return 'himalaya.png';
              case 'shark_note': return 'shark.gif';
              default: return 'phoenix.gif';
            }
          })()}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'top',
          opacity: 0.35,
          pointerEvents: 'none',
          zIndex: 0
        }}></div>

        {/* Gradient Overlay for readability */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.6) 0%, rgba(30, 41, 59, 0.5) 50%, rgba(51, 65, 85, 0.6) 100%)',
          pointerEvents: 'none',
          zIndex: 1
        }}></div>

        {/* Top Section - Title, Status, Actions */}
        <div style={{
          padding: '1.5rem',
          borderBottom: '1px solid var(--border-color)',
          position: 'relative',
          zIndex: 2
        }}>
          <button
            onClick={onNavigateBack}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-color)',
              fontSize: '0.9rem',
              cursor: 'pointer',
              marginBottom: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: 0
            }}
          >
            ← Back to Dashboard
          </button>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1.5rem'
          }}>
            {/* Left: Title and Badges */}
            <div style={{ flex: 1 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '0.5rem',
                flexWrap: 'wrap'
              }}>
                <h1 style={{
                  margin: '0',
                  fontSize: '1.5rem',
                  fontWeight: '700',
                  color: 'var(--text-primary)',
                  lineHeight: '1.2',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span style={{ fontSize: '1.75rem' }}>
                    {getTemplateIcon(latestReport?.templateId || product.templateId || 'unknown')}
                  </span>
                  {product.title || latestReport?.templateResults?.generatedProductName || product.productName || 'Untitled Product'}
                </h1>

                {/* Product Status Badge */}
                {latestReport?.templateResults?.currentStatus?.productStatus && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: (() => {
                      const status = latestReport.templateResults.currentStatus.productStatus;
                      switch (status) {
                        case 'autocalled': return '#0284c7';
                        case 'matured': return '#6b7280';
                        case 'live': return '#059669';
                        default: return '#6b7280';
                      }
                    })(),
                    color: 'white',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    {(() => {
                      const status = latestReport.templateResults.currentStatus.productStatus;
                      const statusDetails = latestReport.templateResults.currentStatus.statusDetails;

                      switch (status) {
                        case 'autocalled':
                          return statusDetails?.callDateFormatted
                            ? `🚀 Autocalled ${statusDetails.callDateFormatted}`
                            : '🚀 Autocalled';
                        case 'matured':
                          return '📋 Matured';
                        case 'live':
                          return '🟢 Live';
                        default:
                          return status.charAt(0).toUpperCase() + status.slice(1);
                      }
                    })()}
                  </div>
                )}
              </div>

              {/* Template Badge */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: 'rgba(59, 130, 246, 0.1)',
                color: 'var(--accent-color)',
                padding: '4px 10px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: '600',
                border: '1px solid rgba(59, 130, 246, 0.2)'
              }}>
                {getTemplateName(latestReport?.templateId || 'unknown')}
              </div>
            </div>

            {/* Right: Action Buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
          <button
            onClick={handleEvaluateProduct}
            disabled={isEvaluating}
            style={{
              background: isEvaluating ? 'var(--bg-muted)' : 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
              color: isEvaluating ? 'var(--text-muted)' : 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: isEvaluating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.3s ease'
            }}
          >
            {isEvaluating ? '⏳' : '🔄'} 
            {isEvaluating ? 'Evaluating...' : 'Run Evaluation'}
          </button>
          
          {/* Edit Product Button - Only for Admin/Superadmin */}
          {onEditProduct && user && (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN) && (
            <button
              onClick={() => onEditProduct(product)}
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'all 0.3s ease'
              }}
            >
              ✏️ Edit Product
            </button>
          )}
          
          {/* Allocate to Clients Button - Only for Admin/Superadmin */}
          {onAllocateProduct && user && (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN) && (
            <button
              onClick={() => onAllocateProduct(product)}
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'all 0.3s ease'
              }}
            >
              👥 Allocate to Clients
            </button>
          )}
            </div>
          </div>
        </div>

        {/* Bottom Section - Product Details and Price */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: latestReport?.templateResults?.currentStatus?.productStatus === 'live' ? '1fr auto' : '1fr',
          gap: '1.5rem',
          padding: '1.5rem',
          position: 'relative',
          zIndex: 2,
          alignItems: 'flex-start'
        }}>
          {/* Left Side: Product Info and Timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Product Info Section */}
            <div style={{
              display: 'flex',
              gap: '2rem',
              paddingBottom: '1rem'
            }}>
              <div>
                <div style={{
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'var(--text-muted)',
                  marginBottom: '0.35rem',
                  fontWeight: '600'
                }}>
                  ISIN
                </div>
                <div style={{
                  color: 'var(--text-primary)',
                  fontWeight: '600',
                  fontFamily: 'monospace',
                  fontSize: '0.95rem'
                }}>
                  {product.isin || 'N/A'}
                </div>
              </div>

              <div>
                <div style={{
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'var(--text-muted)',
                  marginBottom: '0.35rem',
                  fontWeight: '600'
                }}>
                  Currency
                </div>
                <div style={{
                  color: 'var(--text-primary)',
                  fontWeight: '600',
                  fontSize: '0.95rem'
                }}>
                  {product.currency || 'USD'}
                </div>
              </div>
            </div>

            {/* Timeline Section - Grouped Dates */}
            <div style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '8px',
              padding: '1.25rem'
            }}>
              <div style={{
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                color: 'var(--accent-color)',
                marginBottom: '1rem',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                📅 Product Timeline
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '1.25rem'
              }}>
                <div>
                  <div style={{
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--text-muted)',
                    marginBottom: '0.35rem',
                    fontWeight: '600'
                  }}>
                    Trade Date
                  </div>
                  <div style={{
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                    fontFamily: 'monospace'
                  }}>
                    {latestReport?.tradeDateFormatted || product.tradeDateFormatted || 'N/A'}
                  </div>
                </div>

                <div>
                  <div style={{
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--text-muted)',
                    marginBottom: '0.35rem',
                    fontWeight: '600'
                  }}>
                    Value Date
                  </div>
                  <div style={{
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                    fontFamily: 'monospace'
                  }}>
                    {latestReport?.valueDateFormatted || product.valueDateFormatted || product.issueDateFormatted || 'N/A'}
                  </div>
                </div>

                <div>
                  <div style={{
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--text-muted)',
                    marginBottom: '0.35rem',
                    fontWeight: '600'
                  }}>
                    Final Observation
                  </div>
                  <div style={{
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                    fontFamily: 'monospace'
                  }}>
                    {latestReport?.finalObservationFormatted || product.finalObservationFormatted || 'N/A'}
                  </div>
                </div>

                <div>
                  <div style={{
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--text-muted)',
                    marginBottom: '0.35rem',
                    fontWeight: '600'
                  }}>
                    Maturity
                  </div>
                  <div style={{
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    fontSize: '0.95rem',
                    fontFamily: 'monospace'
                  }}>
                    {latestReport?.maturityFormatted || product.maturityFormatted || 'N/A'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Current Product Price - Show for live products */}
          {latestReport?.templateResults?.currentStatus?.productStatus === 'live' && (
            <div style={{
              padding: '1rem 1.5rem',
              background: productPrice
                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
              borderRadius: '8px',
              minWidth: '220px',
              boxShadow: productPrice
                ? '0 4px 12px rgba(16, 185, 129, 0.25)'
                : '0 4px 12px rgba(107, 114, 128, 0.15)'
            }}>
              <div style={{
                fontSize: '0.7rem',
                color: 'rgba(255, 255, 255, 0.9)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                fontWeight: '600',
                marginBottom: '0.5rem'
              }}>
                Market Price
              </div>
              <div style={{
                fontSize: productPrice ? '1.75rem' : '0.95rem',
                fontWeight: '700',
                color: 'white',
                fontFamily: 'monospace',
                marginBottom: productPrice ? '0.4rem' : 0
              }}>
                {productPrice ? (
                  <>
                    {productPrice.price.toFixed(2)}% <span style={{ fontSize: '0.85rem', opacity: 0.9 }}>of par</span>
                  </>
                ) : (
                  <span style={{ opacity: 0.8, fontFamily: 'inherit' }}>No price data</span>
                )}
              </div>
              {productPrice ? (
                <div style={{
                  fontSize: '0.7rem',
                  color: 'rgba(255, 255, 255, 0.8)'
                }}>
                  {new Date(productPrice.priceDate).toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                  })}
                </div>
              ) : (
                <div style={{
                  fontSize: '0.65rem',
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontStyle: 'italic'
                }}>
                  Upload in Admin Panel
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Client Allocations Summary */}
      {allocationsSummary && user && (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN || (user.role === USER_ROLES.CLIENT && allocationsSummary.totalNominalInvested > 0)) && (
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '1.5rem',
          marginBottom: '2rem',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
        }}>
          <h3 style={{
            margin: '0 0 1rem 0',
            fontSize: '1.2rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            👥 {allocationsSummary.isClientView ? 'Your Allocations Summary' : 'Client Allocations Summary'}
          </h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem'
          }}>
            <div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                {allocationsSummary.isClientView ? 'Your Allocations' : 'Total Allocations'}
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                {allocationsSummary.totalAllocations}
              </div>
            </div>
            {!allocationsSummary.isClientView && (
              <div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Unique Clients
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                  {allocationsSummary.clientCount}
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                {allocationsSummary.isClientView ? 'Your Holdings' : 'Total Nominal Invested'}
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                {allocationsSummary.totalNominalInvestedFormatted}
                {allocationsSummary.hasMixedCurrencies && (
                  <div style={{ 
                    fontSize: '0.7rem', 
                    color: '#f59e0b', 
                    marginTop: '4px',
                    fontWeight: '500'
                  }}>
                    ⚠️ Mixed currencies: {allocationsSummary.currencies.join(', ')}
                  </div>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                Average Purchase Price
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                {allocationsSummary.averagePriceFormatted}
              </div>
            </div>
          </div>
          
          {/* Collapsible Client Details Section - Only for Admin */}
          {allocationDetails && allocationDetails.length > 0 && user && (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN) && (
            <div style={{ marginTop: '1.5rem' }}>
              <button
                onClick={() => setShowAllocationDetails(!showAllocationDetails)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  justifyContent: 'space-between',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => e.target.style.background = 'var(--bg-tertiary)'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                <span>📋 View Client Details ({allocationDetails.length} allocations)</span>
                <span style={{ transition: 'transform 0.2s ease', transform: showAllocationDetails ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  ▼
                </span>
              </button>
              
              {showAllocationDetails && (
                <div style={{
                  marginTop: '1rem',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 2fr 1fr 1fr',
                    gap: '12px',
                    padding: '12px',
                    background: 'var(--bg-tertiary)',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border-color)'
                  }}>
                    <div>Client</div>
                    <div>Amount</div>
                    <div>Bank Account</div>
                    <div>Price</div>
                    <div>Date</div>
                  </div>
                  
                  {allocationDetails.map((allocation, index) => (
                    <div
                      key={allocation._id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 2fr 1fr 1fr',
                        gap: '12px',
                        padding: '12px',
                        borderBottom: index < allocationDetails.length - 1 ? '1px solid var(--border-color)' : 'none',
                        fontSize: '0.85rem'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                          {allocation.clientName || 'Unknown Client'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {allocation.clientEmail}
                        </div>
                      </div>
                      
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                        {allocation.nominalInvestedFormatted}
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '400' }}>
                          {allocation.accountCurrency}
                        </div>
                      </div>
                      
                      <div>
                        <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                          {allocation.bankName}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {allocation.accountNumber}
                        </div>
                      </div>
                      
                      <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                        {allocation.purchasePrice}%
                      </div>
                      
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {allocation.allocatedAtFormatted}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Product Commentary Card */}
      <ProductCommentaryCard productId={productId} />

      {/* Evaluation Error */}
      {evaluationError && (
        <div style={{
          background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
          border: '1px solid #f87171',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '2rem',
          color: '#dc2626'
        }}>
          <strong>Evaluation Error:</strong> {evaluationError}
        </div>
      )}


      {/* Latest Evaluation Results */}
      {latestReport ? (
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          padding: '2rem',
          marginBottom: '2rem'
        }}>
          <h2 style={{
            margin: '0 0 1.5rem 0',
            fontSize: '1.4rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            📊 Latest Evaluation
            <span style={{
              fontSize: '0.8rem',
              background: 'var(--success-color)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontWeight: '500'
            }}>
              {latestReport.evaluationDateFormatted || 'N/A'}
            </span>
          </h2>

          <div>
            {/* Template Results Display */}
            {latestReport.templateResults && Object.keys(latestReport.templateResults).length > 0 &&
             renderTemplateResults(latestReport.templateResults, latestReport.templateId, productId)}
          </div>
        </div>
      ) : (
        /* No Reports Available */
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '2px dashed var(--border-color)',
          padding: '3rem',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📊</div>
          <h2 style={{
            margin: '0 0 1rem 0',
            color: 'var(--text-secondary)',
            fontSize: '1.4rem'
          }}>
            No Evaluation Reports Available
          </h2>
          <p style={{
            margin: '0 0 2rem 0',
            color: 'var(--text-muted)',
            fontSize: '1rem'
          }}>
            Run an evaluation to generate a detailed report for this {getTemplateName(product.templateId || 'unknown')} product.
          </p>
          <button
            onClick={handleEvaluateProduct}
            disabled={isEvaluating}
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
            🔄 Run First Evaluation
          </button>
        </div>
      )}
    </div>
  );
};

// Helper to get template display name
const getTemplateName = (templateId) => {
  const templateNames = {
    'phoenix_autocallable': 'Phoenix Autocallable',
    'orion_memory': 'Orion Memory',
    'himalaya': 'Himalaya',
    'himalaya_protection': 'Himalaya Protection',
    'shark_note': 'Shark Note',
    'unknown_template': 'Unknown Template',
    'unknown': 'Unknown'
  };

  return templateNames[templateId] || 'Unknown Template';
};

const getTemplateIcon = (templateId) => {
  const templateIcons = {
    'phoenix_autocallable': '🦅',
    'orion_memory': '⭐',
    'himalaya': '🏔️',
    'himalaya_protection': '🏔️',
    'shark_note': '🦈',
    'unknown_template': '📄',
    'unknown': '📄'
  };

  return templateIcons[templateId] || '📄';
};

// Helper to render template-specific results
const renderTemplateResults = (results, templateId, productId) => {
  // Use template-specific report components for consistent architecture
  if (templateId === 'phoenix_autocallable' && results.templateType === 'phoenix_autocallable') {
    return <PhoenixReport results={results} productId={productId} />;
  }

  if (templateId === 'orion_memory' && results.templateType === 'orion_memory') {
    return <OrionReport results={results} productId={productId} />;
  }

  if (templateId === 'himalaya' && results.templateType === 'himalaya') {
    return <HimalayaReport results={results} productId={productId} />;
  }

  if (templateId === 'shark_note' && results.templateType === 'shark_note') {
    return <SharkNoteReport results={results} productId={productId} />;
  }

  // Default generic display for unknown templates
  return (
    <div style={{
      marginTop: '1rem',
      padding: '1rem',
      background: 'var(--bg-primary)',
      borderRadius: '6px'
    }}>
      <div style={{
        fontSize: '0.85rem',
        color: 'var(--text-secondary)',
        marginBottom: '0.5rem'
      }}>
        Template Results:
      </div>
      <pre style={{
        fontSize: '0.8rem',
        color: 'var(--text-primary)',
        margin: 0,
        whiteSpace: 'pre-wrap'
      }}>
        {JSON.stringify(results, null, 2)}
      </pre>
    </div>
  );
};

// Orion Memory specific results display

// Phoenix Autocallable specific results display

export default TemplateProductReport;