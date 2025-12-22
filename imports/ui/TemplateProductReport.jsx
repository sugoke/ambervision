import React, { useState, useEffect, useRef } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';
import { TemplateReportsCollection } from '/imports/api/templateReports';
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
import ParticipationNoteReport from './templates/ParticipationNoteReport.jsx';
import ReverseConvertibleReport from './templates/ReverseConvertibleReport.jsx';
import ReverseConvertibleBondReport from './templates/ReverseConvertibleBondReport.jsx';
import ProductCommentaryCard from './components/ProductCommentaryCard.jsx';
import TermSheetManager from './components/TermSheetManager.jsx';
import PDFDownloadButton from './components/PDFDownloadButton.jsx';

/**
 * Processing Issues Alert Component
 * Shows a banner when a product has processing issues
 * Displays all issues with severity indicators
 */
const ProcessingIssuesAlert = ({ product }) => {
  if (!product) return null;

  const {
    processingIssues,
    hasProcessingErrors,
    hasProcessingWarnings,
    lastSuccessfulEvaluation
  } = product;

  // Don't show anything if no issues
  if (!hasProcessingErrors && !hasProcessingWarnings) {
    return null;
  }

  const issueCount = processingIssues?.length || 0;
  const errorCount = processingIssues?.filter(i => i.severity === 'error').length || 0;
  const warningCount = processingIssues?.filter(i => i.severity === 'warning').length || 0;

  // Format last successful evaluation date
  const lastSuccessDate = lastSuccessfulEvaluation
    ? new Date(lastSuccessfulEvaluation).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : null;

  // Determine colors based on severity
  const bgColor = hasProcessingErrors ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)';
  const borderColor = hasProcessingErrors ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.25)';
  const iconColor = hasProcessingErrors ? '#ef4444' : '#f59e0b';
  const headerColor = hasProcessingErrors ? '#ef4444' : '#f59e0b';

  return (
    <div style={{
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: '8px',
      padding: '1rem 1.25rem',
      marginBottom: '1.5rem'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        {/* Icon */}
        <div style={{ flexShrink: 0, marginTop: '2px' }}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={iconColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {hasProcessingErrors ? (
              // Exclamation circle for errors
              <>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </>
            ) : (
              // Triangle warning for warnings
              <>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </>
            )}
          </svg>
        </div>

        {/* Content */}
        <div style={{ flex: 1 }}>
          <div style={{
            fontWeight: '600',
            fontSize: '0.95rem',
            color: headerColor,
            marginBottom: '0.5rem'
          }}>
            {hasProcessingErrors ? 'Report Processing Errors' : 'Report Processing Warnings'}
          </div>

          <div style={{
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
            marginBottom: '0.75rem',
            lineHeight: '1.5'
          }}>
            {hasProcessingErrors
              ? 'Some data in this report may be incomplete or outdated due to processing errors.'
              : 'This report was generated with some warnings that may affect data accuracy.'
            }
          </div>

          {/* Issues List */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}>
            {processingIssues?.map((issue, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  background: issue.severity === 'error'
                    ? 'rgba(239, 68, 68, 0.1)'
                    : 'rgba(245, 158, 11, 0.1)',
                  borderRadius: '4px',
                  fontSize: '0.8rem'
                }}
              >
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  flexShrink: 0
                }}>
                  [{issue.type}]
                </span>
                <span style={{
                  color: issue.severity === 'error' ? '#fca5a5' : '#fcd34d',
                  flex: 1
                }}>
                  {issue.message}
                </span>
                {issue.underlying && (
                  <span style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    flexShrink: 0
                  }}>
                    {issue.underlying}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Last Successful Evaluation */}
          {lastSuccessDate && hasProcessingErrors && (
            <div style={{
              marginTop: '0.75rem',
              fontSize: '0.75rem',
              color: 'var(--text-muted)'
            }}>
              Last successful evaluation: {lastSuccessDate}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * New Template-based Product Report Component
 * 
 * This replaces the old complex ProductReport with a simpler, template-focused approach.
 * Each template will have its own report builder and layout.
 */
const TemplateProductReport = ({ productId, user, onNavigateBack, onEditProduct, onAllocateProduct }) => {
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState(null);
  const [showAllocationDetails, setShowAllocationDetails] = useState(false);

  // Cache for product data to prevent "not found" errors during re-renders (e.g., window resize)
  const productCache = useRef(null);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);
  const [isTablet, setIsTablet] = useState(typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth < 1024);

  // PDF mode detection and authentication
  const [pdfAuthState, setPdfAuthState] = useState({ validated: false, error: null });
  // Track sessionId as state so useTracker re-runs when it changes (fixes race condition)
  const [currentSessionId, setCurrentSessionId] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null
  );
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isPDFMode = urlParams?.get('pdf') === 'true';
  const pdfToken = urlParams?.get('pdfToken');
  const pdfUserId = urlParams?.get('userId');

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      const tablet = window.innerWidth >= 768 && window.innerWidth < 1024;
      setIsMobile(mobile);
      setIsTablet(tablet);
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Call once on mount

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Validate PDF token if in PDF mode and create temporary session
  useEffect(() => {
    if (isPDFMode && pdfToken && pdfUserId) {
      console.log('[PDF] Validating PDF authentication token...');
      Meteor.call('pdf.validateToken', pdfUserId, pdfToken, (error, result) => {
        if (error || !result.valid) {
          console.error('[PDF] Token validation failed:', error?.reason || result?.reason);
          setPdfAuthState({ validated: false, error: error?.reason || result?.reason || 'Invalid token' });
        } else {
          console.log('[PDF] ✓ Token validated successfully');
          setPdfAuthState({ validated: true, error: null });

          // Store a temporary sessionId for PDF generation
          // This allows subscriptions to work during PDF rendering
          const tempSessionId = `pdf-temp-${pdfToken}`;
          localStorage.setItem('sessionId', tempSessionId);
          localStorage.setItem('pdfTempSession', 'true');
          // Update state to trigger useTracker re-run
          setCurrentSessionId(tempSessionId);
          console.log('[PDF] Set temporary sessionId:', tempSessionId);
        }
      });
    } else if (!isPDFMode) {
      // Not in PDF mode, no validation needed
      setPdfAuthState({ validated: true, error: null });

      // Clean up any PDF temporary session
      if (localStorage.getItem('pdfTempSession') === 'true') {
        localStorage.removeItem('pdfTempSession');
        localStorage.removeItem('sessionId');
        setCurrentSessionId(null);
      }
    }
  }, [isPDFMode, pdfToken, pdfUserId]);

  // Set PDF mode attribute on body for CSS
  useEffect(() => {
    if (isPDFMode && typeof document !== 'undefined') {
      document.body.setAttribute('data-pdf-mode', 'true');
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.removeAttribute('data-pdf-mode');
      }
    };
  }, [isPDFMode]);

  // Subscribe to product, reports, allocations, users and bank accounts
  const { product, latestReport, allocations, allocationsSummary, allocationDetails, productPrice, isDataReady } = useTracker(() => {
    // Use state-tracked sessionId to ensure reactivity when it changes (e.g., PDF auth completes)
    const sessionId = currentSessionId;
    console.log('[TemplateProductReport] useTracker running with sessionId:', sessionId ? `${sessionId.substring(0, 20)}...` : 'null', 'isPDFMode:', isPDFMode, 'pdfAuthValidated:', pdfAuthState.validated);

    // In PDF mode, wait for authentication to complete before subscribing
    if (isPDFMode && !pdfAuthState.validated) {
      console.log('[TemplateProductReport] PDF mode: waiting for auth validation...');
      return {
        product: null,
        latestReport: null,
        allocations: [],
        allocationsSummary: null,
        allocationDetails: null,
        productPrice: null,
        isDataReady: false
      };
    }

    const productHandle = Meteor.subscribe('products.single', productId, sessionId);
    const reportsHandle = Meteor.subscribe('templateReports.forProduct', productId);
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
    const reportData = TemplateReportsCollection.findOne(
      { productId },
      { sort: { createdAt: -1 } }
    );

    // DEBUG: Log report query results
    console.log('[TemplateProductReport] Report query for productId:', productId);
    console.log('[TemplateProductReport] Report found:', !!reportData);
    if (reportData) {
      console.log('[TemplateProductReport] Report details:', {
        _id: reportData._id,
        productId: reportData.productId,
        templateId: reportData.templateId,
        createdAt: reportData.createdAt
      });
    } else {
      console.log('[TemplateProductReport] No report found. All reports in collection:');
      const allReports = TemplateReportsCollection.find({}).fetch();
      console.log('[TemplateProductReport] Total reports in client cache:', allReports.length);
      allReports.forEach(r => {
        console.log(`  - Report ${r._id}: productId=${r.productId}, templateId=${r.templateId}`);
      });
    }
    
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

    // Cache product data if it exists to prevent "not found" during re-renders
    if (productData) {
      productCache.current = productData;
    }

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
  }, [productId, currentSessionId, isPDFMode, pdfAuthState.validated]);

  // ❌ REMOVED - All formatting calculations moved to processor
  // Report components must only display pre-computed values

  // Mark page as ready for PDF when data is loaded
  useEffect(() => {
    if (isPDFMode && isDataReady && latestReport && typeof document !== 'undefined') {
      // Wait a bit for charts and images to render
      setTimeout(() => {
        document.body.setAttribute('data-pdf-ready', 'true');
        console.log('[PDF] Page marked as ready for PDF generation');
      }, 2000);
    }
  }, [isPDFMode, isDataReady, latestReport]);

  // Handle evaluation
  const handleEvaluateProduct = async () => {
    if (!displayProduct) return;
    
    setIsEvaluating(true);
    setEvaluationError(null);
    
    try {
      console.log('TemplateProductReport: Starting evaluation for product:', displayProduct._id);
      
      const sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        throw new Error('No session found');
      }
      
      // Call the template reports method (uses template registry system)
      const reportId = await Meteor.callAsync('templateReports.create', displayProduct, sessionId);
      console.log('TemplateProductReport: Evaluation completed, report ID:', reportId);
      
      // The useTracker will automatically pick up the new report due to reactivity
      
    } catch (error) {
      console.error('TemplateProductReport: Evaluation failed:', error);
      setEvaluationError(error.message || 'Failed to evaluate product');
    } finally {
      setIsEvaluating(false);
    }
  };

  // Use cached product if current product is undefined (during re-renders like window resize)
  const displayProduct = product || productCache.current;

  // DEBUG: Log what's happening
  console.log('[TemplateProductReport DEBUG]', {
    productId,
    hasProduct: !!product,
    hasCache: !!productCache.current,
    hasDisplayProduct: !!displayProduct,
    isDataReady,
    isMobile,
    isTablet,
    windowWidth: typeof window !== 'undefined' ? window.innerWidth : 'undefined'
  });

  // Show loading if we have no product data at all (neither current nor cached)
  if (!displayProduct) {
    // In PDF mode, show auth status for debugging
    const loadingMessage = isPDFMode
      ? (pdfAuthState.error
        ? `Authentication failed: ${pdfAuthState.error}`
        : (pdfAuthState.validated
          ? 'Loading product data...'
          : 'Authenticating PDF session...'))
      : 'Loading product report...';

    return (
      <div
        id="pdf-loading-state"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '400px',
          color: 'var(--text-secondary)'
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📊</div>
          {loadingMessage}
          {isPDFMode && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', opacity: 0.7 }}>
              PDF Mode | Auth: {pdfAuthState.validated ? 'OK' : 'Pending'} | Session: {currentSessionId ? 'Set' : 'None'}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: '1200px',
      margin: '0 auto',
      padding: isMobile ? '0.75rem' : '2rem'
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
            const templateId = latestReport?.templateId || displayProduct?.templateId || 'unknown';
            switch(templateId) {
              case 'phoenix_autocallable': return 'phoenix.gif';
              case 'orion_memory': return 'orion.png';
              case 'himalaya': return 'himalaya.png';
              case 'shark_note': return 'shark.gif';
              case 'participation_note': return 'participation.gif';
              case 'reverse_convertible': return 'phoenix.gif';
              case 'reverse_convertible_bond': return 'phoenix.gif';
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
          {!isPDFMode && (
            <button
              onClick={onNavigateBack}
              className="no-print"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                cursor: 'pointer',
                marginBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-tertiary)';
                e.currentTarget.style.borderColor = 'var(--accent-color)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-secondary)';
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
            >
              ← Back
            </button>
          )}

          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            justifyContent: 'space-between',
            alignItems: isMobile ? 'stretch' : 'flex-start',
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
                    {getTemplateIcon(latestReport?.templateId || displayProduct.templateId || 'unknown')}
                  </span>
                  {latestReport?.templateResults?.generatedProductName || displayProduct.title || displayProduct.productName || 'Untitled Product'}
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
            {!isPDFMode && (
              <div className="no-print" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end' }}>
          <button
            onClick={handleEvaluateProduct}
            disabled={isEvaluating}
            style={{
              background: isEvaluating ? 'var(--bg-muted)' : 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
              color: isEvaluating ? 'var(--text-muted)' : 'white',
              border: 'none',
              width: '44px',
              height: '44px',
              padding: '0',
              borderRadius: '8px',
              fontSize: '1.1rem',
              cursor: isEvaluating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease'
            }}
            title={isEvaluating ? 'Evaluating...' : 'Run Evaluation'}
          >
            {isEvaluating ? '⏳' : '🔄'}
          </button>

          {/* PDF Download Button - Only show if report exists */}
          {latestReport && (
            <PDFDownloadButton
              reportId={productId}
              reportType="template"
              filename={`${(latestReport?.templateResults?.generatedProductName || displayProduct.title || 'product').replace(/[^a-z0-9]/gi, '_').toLowerCase()}-report-${new Date().toISOString().split('T')[0]}.pdf`}
              title="Download PDF"
              iconOnly={true}
              contentSelector="#product-report-content"
              style={{
                width: '44px',
                height: '44px',
                padding: '0',
                minHeight: 'unset'
              }}
            />
          )}

          {/* Edit Product Button - Only for Admin/Superadmin */}
          {onEditProduct && user && (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN) && (
            <button
              onClick={() => onEditProduct(displayProduct)}
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'white',
                border: 'none',
                width: '44px',
                height: '44px',
                padding: '0',
                borderRadius: '8px',
                fontSize: '1.1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s ease'
              }}
              title="Edit Product"
            >
              ✏️
            </button>
          )}

          {/* Allocate to Clients Button - Only for Admin/Superadmin */}
          {onAllocateProduct && user && (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN) && (
            <button
              onClick={() => onAllocateProduct(displayProduct)}
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: 'white',
                border: 'none',
                width: '44px',
                height: '44px',
                padding: '0',
                borderRadius: '8px',
                fontSize: '1.1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s ease'
              }}
              title="Allocate to Clients"
            >
              👥
            </button>
          )}

          {/* Term Sheet Manager - Upload/Download Term Sheet */}
          <TermSheetManager
            product={displayProduct}
            user={user}
            productId={productId}
          />
            </div>
            )}
          </div>
        </div>

        {/* Bottom Section - Product Details and Price */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : (latestReport?.templateResults?.currentStatus?.productStatus === 'live' ? '1fr auto' : '1fr'),
          gap: '1.5rem',
          padding: isMobile ? '1rem' : '1.5rem',
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
                  {displayProduct.isin || 'N/A'}
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
                  {displayProduct.currency || 'USD'}
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
                gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: isMobile ? '1rem' : '1.25rem'
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
                    {latestReport?.templateResults?.timeline?.tradeDateFormatted || displayProduct.tradeDateFormatted || formatDateForDisplay(displayProduct.tradeDate) || 'N/A'}
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
                    {latestReport?.templateResults?.timeline?.valueDateFormatted || displayProduct.valueDateFormatted || displayProduct.issueDateFormatted || formatDateForDisplay(displayProduct.valueDate) || formatDateForDisplay(displayProduct.issueDate) || 'N/A'}
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
                    {latestReport?.templateResults?.timeline?.finalObservationFormatted || displayProduct.finalObservationFormatted || formatDateForDisplay(displayProduct.finalObservation) || formatDateForDisplay(displayProduct.finalObservationDate) || 'N/A'}
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
                    {latestReport?.templateResults?.timeline?.maturityDateFormatted || displayProduct.maturityFormatted || formatDateForDisplay(displayProduct.maturity) || formatDateForDisplay(displayProduct.maturityDate) || 'N/A'}
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
              minWidth: isMobile ? 'auto' : '220px',
              width: isMobile ? '100%' : 'auto',
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
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
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
                  {/* Mobile: Card Layout */}
                  {isMobile ? (
                    <div style={{ padding: '0.5rem' }}>
                      {allocationDetails.map((allocation, index) => (
                        <div
                          key={allocation._id}
                          style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            padding: '1rem',
                            marginBottom: index < allocationDetails.length - 1 ? '0.75rem' : '0'
                          }}
                        >
                          <div style={{ marginBottom: '0.75rem' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase' }}>Client</div>
                            <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                              {allocation.clientName || 'Unknown Client'}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              {allocation.clientEmail}
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase' }}>Amount</div>
                              <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                                {allocation.nominalInvestedFormatted}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {allocation.accountCurrency}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase' }}>Price</div>
                              <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                                {allocation.purchasePrice}%
                              </div>
                            </div>
                          </div>

                          <div style={{ marginTop: '0.75rem' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase' }}>Bank Account</div>
                            <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                              {allocation.bankName}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              {allocation.accountNumber}
                            </div>
                          </div>

                          <div style={{ marginTop: '0.75rem' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase' }}>Date</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {allocation.allocatedAtFormatted}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Desktop: Table Layout */
                    <>
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
                    </>
                  )}
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

          <div id="product-report-content">
            {/* Processing Issues Alert */}
            <ProcessingIssuesAlert product={displayProduct} />

            {/* Template Results Display */}
            {latestReport.templateResults && Object.keys(latestReport.templateResults).length > 0 &&
             renderTemplateResults(latestReport.templateResults, latestReport.templateId, productId, displayProduct, user)}
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
            Run an evaluation to generate a detailed report for this {getTemplateName(displayProduct.templateId || 'unknown')} product.
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

// Helper to format raw date string for display (fallback only)
const formatDateForDisplay = (dateString) => {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch (error) {
    return null;
  }
};

// Helper to get template display name
const getTemplateName = (templateId) => {
  const templateNames = {
    'phoenix_autocallable': 'Phoenix Autocallable',
    'orion_memory': 'Orion Memory',
    'himalaya': 'Himalaya',
    'himalaya_protection': 'Himalaya Protection',
    'shark_note': 'Shark Note',
    'participation_note': 'Participation Note',
    'reverse_convertible': 'Reverse Convertible',
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
    'participation_note': '📈',
    'reverse_convertible': '🔄',
    'unknown_template': '📄',
    'unknown': '📄'
  };

  return templateIcons[templateId] || '📄';
};

// Helper to render template-specific results
const renderTemplateResults = (results, templateId, productId, product, user) => {
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

  if (templateId === 'participation_note' && results.templateType === 'participation_note') {
    return <ParticipationNoteReport results={results} productId={productId} product={product} user={user} />;
  }

  if (templateId === 'reverse_convertible' && results.templateType === 'reverse_convertible') {
    return <ReverseConvertibleReport results={results} productId={productId} />;
  }

  if (templateId === 'reverse_convertible_bond' && results.templateType === 'reverse_convertible_bond') {
    return <ReverseConvertibleBondReport results={results} productId={productId} />;
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