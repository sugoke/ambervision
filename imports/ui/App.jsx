import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import Login from './Login.jsx';
import MainContent from './MainContent.jsx';
import PasswordReset from './PasswordReset.jsx';
import PrintableProductReport from './PrintableProductReport.jsx';
import LandingPage from './LandingPage.jsx';
import InfinePage from './InfinePage.jsx';
import PhoenixReportPDF from './templates/PhoenixReportPDF.jsx';
import OrionReportPDF from './templates/OrionReportPDF.jsx';
import ParticipationNoteReportPDF from './templates/ParticipationNoteReportPDF.jsx';
import PMSReportPDF from './templates/PMSReportPDF.jsx';
import RiskAnalysisPDF from './templates/RiskAnalysisPDF.jsx';
import GlobalSearchBar from './components/GlobalSearchBar.jsx';
import ViewAsFilter from './components/ViewAsFilter.jsx';
import NotificationCenter from './NotificationCenter.jsx';
import AmberChat from './AmberChat.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import { ThemeProvider, useTheme } from './ThemeContext.jsx';
import { ViewAsProvider, useViewAs } from './ViewAsContext.jsx';

// Lazy load MarketTicker to improve initial page load performance
// This splits MarketTicker into a separate chunk that loads asynchronously
const MarketTicker = lazy(() => import('./MarketTicker.jsx'));

const AppContent = () => {
  const { theme } = useTheme();
  const { viewAsFilter, favorites, setFilter } = useViewAs();
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true); // Add loading state for authentication
  const [isComponentLibraryOpen, setIsComponentLibraryOpen] = useState(false);
  const [showMarketTicker, setShowMarketTicker] = useState(false); // Defer MarketTicker loading
  const [isAmberChatOpen, setIsAmberChatOpen] = useState(false); // Amber AI chat state
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false); // Mobile search overlay state
  const [mobileViewAsOpen, setMobileViewAsOpen] = useState(false); // Mobile view as overlay state
  const [isMenuOpen, setIsMenuOpen] = useState(false); // Navigation menu state (lifted for mobile header)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false); // Settings menu state (lifted for mobile header)
  const [isMobile, setIsMobile] = useState(false);

  // Detect PDF mode - bypass authentication requirement
  // PDF mode is active if either ?pdf=true or ?pdfToken is present
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const pdfToken = urlParams?.get('pdfToken');
  const pdfUserId = urlParams?.get('userId');
  const isPDFMode = urlParams?.get('pdf') === 'true' || pdfToken != null;

  // Detect mobile viewport - includes landscape mode detection
  useEffect(() => {
    const checkMobile = () => {
      // Check if either dimension is below mobile threshold (catches both portrait and landscape)
      const smallestDimension = Math.min(window.innerWidth, window.innerHeight);
      const mobile = smallestDimension < 600; // 600px threshold catches phones but not tablets/laptops

      setIsMobile(mobile);
      console.log('[App] Mobile detection:', mobile ? 'MOBILE' : 'DESKTOP',
        `(${window.innerWidth}x${window.innerHeight}, smallest: ${smallestDimension}px)`);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  // Parse route from URL
  const parseRouteFromUrl = () => {
    if (typeof window === 'undefined') return { section: 'dashboard' };

    const pathname = window.location.pathname;
    const hash = window.location.hash.slice(1);

    // Check for print-report route: /print-report/:productId
    const printReportMatch = pathname.match(/^\/print-report\/([a-zA-Z0-9]+)$/);
    if (printReportMatch) {
      const productId = printReportMatch[1];
      console.log('App: Found print-report route for product:', productId);
      return { section: 'print-report', productId };
    }

    // Check for PDF Phoenix route: /pdf/phoenix/:productId
    const pdfPhoenixMatch = pathname.match(/^\/pdf\/phoenix\/([a-zA-Z0-9]+)$/);
    if (pdfPhoenixMatch) {
      const productId = pdfPhoenixMatch[1];
      console.log('App: Found PDF Phoenix route for product:', productId);
      return { section: 'pdf-phoenix', productId };
    }

    // Check for PDF Orion route: /pdf/orion/:productId
    const pdfOrionMatch = pathname.match(/^\/pdf\/orion\/([a-zA-Z0-9]+)$/);
    if (pdfOrionMatch) {
      const productId = pdfOrionMatch[1];
      console.log('App: Found PDF Orion route for product:', productId);
      return { section: 'pdf-orion', productId };
    }

    // Check for PDF Participation Note route: /pdf/participation/:productId
    const pdfParticipationMatch = pathname.match(/^\/pdf\/participation\/([a-zA-Z0-9]+)$/);
    if (pdfParticipationMatch) {
      const productId = pdfParticipationMatch[1];
      console.log('App: Found PDF Participation Note route for product:', productId);
      return { section: 'pdf-participation', productId };
    }

    // Check for PDF PMS route: /pdf/pms/:accountFilter (or /pdf/pms for all accounts)
    const pdfPmsMatch = pathname.match(/^\/pdf\/pms(?:\/([a-zA-Z0-9]+))?$/);
    console.log('App: Checking PDF PMS route, pathname:', pathname, 'match:', pdfPmsMatch);
    if (pdfPmsMatch) {
      const accountFilter = pdfPmsMatch[1] || 'all';
      console.log('App: Found PDF PMS route for account:', accountFilter);
      return { section: 'pdf-pms', accountFilter };
    }

    // Check for PDF Risk Analysis route: /pdf/risk-analysis/:reportId
    const pdfRiskAnalysisMatch = pathname.match(/^\/pdf\/risk-analysis\/([a-zA-Z0-9]+)$/);
    if (pdfRiskAnalysisMatch) {
      const reportId = pdfRiskAnalysisMatch[1];
      console.log('App: Found PDF Risk Analysis route for report:', reportId);
      return { section: 'pdf-risk-analysis', reportId };
    }

    // Check for report route: /report/:productId
    const reportMatch = pathname.match(/^\/report\/([a-zA-Z0-9]+)$/);
    if (reportMatch) {
      const productId = reportMatch[1];
      console.log('App: Found report route for product:', productId);
      return { section: 'report', productId };
    }

    // Check for product route: /product/:productId (used by PDF generation)
    const productMatch = pathname.match(/^\/product\/([a-zA-Z0-9]+)$/);
    if (productMatch) {
      const productId = productMatch[1];
      console.log('App: Found product route for product:', productId);
      return { section: 'report', productId };
    }

    // Check for password reset route: #reset-password?token=XXXXX
    if (hash.startsWith('reset-password')) {
      const urlParams = new URLSearchParams(hash.split('?')[1]);
      const token = urlParams.get('token');
      console.log('App: Found password reset route with token:', token ? 'present' : 'missing');
      return { section: 'reset-password', token };
    }

    // Fallback to hash-based routing
    if (hash) {
      console.log('App: Restoring currentSection from URL hash:', hash);
      return { section: hash };
    }

    // Fallback to localStorage
    const storedSection = localStorage.getItem('currentSection') || 'dashboard';
    console.log('App: Restoring currentSection from localStorage:', storedSection);
    return { section: storedSection };
  };

  // Persist current section across page refreshes using URL hash and localStorage
  const [currentRoute, setCurrentRoute] = useState(parseRouteFromUrl);
  const [currentSection, setCurrentSection] = useState(currentRoute.section);

  // Update localStorage and URL hash when section changes
  const handleSectionChange = useCallback((section, productId = null) => {
    setCurrentSection(section);
    setCurrentRoute({ section, productId });
    
    if (typeof window !== 'undefined') {
      localStorage.setItem('currentSection', section);
      
      // Handle different route types
      if (section === 'report' && productId) {
        // For report routes, use pathname-based routing
        window.history.pushState(null, null, `/report/${productId}`);
      } else {
        // For regular sections, reset to root with hash
        window.history.pushState(null, null, `/#${section}`);
      }
    }
  }, []);

  // Handle user change and loading state
  const handleUserChange = (userData) => {
    console.log('[App] User state changed:', userData ? `Logged in as ${userData.email || userData.username}` : 'Logged out');
    setUser(userData);
    setIsAuthLoading(false);
    
    // If user just logged in (not page reload), handle routing
    if (userData && !user && typeof window !== 'undefined') {
      const storedSection = localStorage.getItem('currentSection');
      const currentPath = window.location.pathname;
      
      // Check if we're on a report route without a valid productId
      const reportMatch = currentPath.match(/^\/report\/([a-zA-Z0-9]+)$/);
      const isReportRouteWithoutId = storedSection === 'report' && !reportMatch;
      
      // If no stored section or invalid report route, redirect to dashboard
      if (!storedSection || isReportRouteWithoutId) {
        console.log('App: Redirecting to dashboard after login - no valid stored section');
        setCurrentSection('dashboard');
        setCurrentRoute({ section: 'dashboard' });
        localStorage.setItem('currentSection', 'dashboard');
        window.history.replaceState(null, null, '#dashboard');
      }
    }
    
    // If user logged out, clear localStorage
    if (!userData && user) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('currentSection');
        localStorage.removeItem('selectedProductId');
        localStorage.removeItem('editingProduct');
      }
    }
  };

  // Fallback: Clear loading state after 2 seconds if no session found
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (isAuthLoading) {
        setIsAuthLoading(false);
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [isAuthLoading]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handleNavigation = () => {
      const newRoute = parseRouteFromUrl();
      if (newRoute.section !== currentSection || newRoute.productId !== currentRoute.productId) {
        setCurrentRoute(newRoute);
        setCurrentSection(newRoute.section);
      }
    };

    // Listen for both hash changes and popstate (back/forward)
    window.addEventListener('hashchange', handleNavigation);
    window.addEventListener('popstate', handleNavigation);

    // Set initial hash if missing and not a report route
    if (!window.location.hash && currentSection && currentSection !== 'report') {
      window.history.replaceState(null, null, `#${currentSection}`);
    }

    return () => {
      window.removeEventListener('hashchange', handleNavigation);
      window.removeEventListener('popstate', handleNavigation);
    };
  }, [currentSection, currentRoute]);

  // Defer MarketTicker loading to improve initial page load performance
  // Wait 2 seconds after auth completes to allow main content to render first
  useEffect(() => {
    if (!isAuthLoading) {
      console.log('[App] Auth completed, waiting 2s before loading MarketTicker...');
      const timer = setTimeout(() => {
        if (!isMobile) {
          console.log('[App] Loading MarketTicker (desktop mode)');
          setShowMarketTicker(true);
        } else {
          console.log('[App] Skipping MarketTicker (mobile mode)');
        }
      }, 2000); // 2 second delay after auth completes

      return () => clearTimeout(timer);
    }
  }, [isAuthLoading, isMobile]);

  // Lock body scroll when mobile search or view as overlay is open
  useEffect(() => {
    if ((mobileSearchOpen || mobileViewAsOpen) && isMobile) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.height = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
    }

    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
    };
  }, [mobileSearchOpen, mobileViewAsOpen, isMobile]);

  // Close mobile overlays with Escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (mobileSearchOpen) setMobileSearchOpen(false);
        if (mobileViewAsOpen) setMobileViewAsOpen(false);
      }
    };

    if (mobileSearchOpen || mobileViewAsOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [mobileSearchOpen, mobileViewAsOpen]);

  return (
      <div style={{
        minHeight: '100vh',
        transition: 'all 0.3s ease',
        position: 'relative',
        isolation: 'isolate'
      }}>
        {/* Fixed Background Layer - iOS-compatible fixed background - Hidden in PDF mode */}
        {!isPDFMode && (
        <div
          className={theme === 'light' ? 'fixed-bg-light' : 'fixed-bg-dark'}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            maxHeight: '100vh',
            maxHeight: '-webkit-fill-available',
            zIndex: -1,
            overflow: 'hidden',
            backgroundImage: theme === 'light'
              ? 'url(/images/daymode.jpg)'
              : 'url("https://wallpapers.com/images/high/elegant-abstract-geometric-pattern-with-monochromatic-black-rectangle-m8k9bhf9vr2ydzoh.webp")',
            backgroundSize: 'cover',
            backgroundPosition: 'center center',
            backgroundRepeat: 'no-repeat',
            backgroundColor: theme === 'light' ? '#f8f9fa' : '#1a1a1a',
            willChange: 'transform',
            transform: 'translateZ(0)',
            WebkitTransform: 'translateZ(0)',
            WebkitBackfaceVisibility: 'hidden',
            backfaceVisibility: 'hidden',
            pointerEvents: 'none'
          }}
        >
          {/* Inner background element for better iOS compatibility */}
          <div style={{
            position: 'absolute',
            top: '-10%',
            left: '-10%',
            width: '120%',
            height: '120%',
            backgroundImage: theme === 'light'
              ? 'url(/images/daymode.jpg)'
              : 'url("https://wallpapers.com/images/high/elegant-abstract-geometric-pattern-with-monochromatic-black-rectangle-m8k9bhf9vr2ydzoh.webp")',
            backgroundSize: 'cover',
            backgroundPosition: 'center center',
            backgroundRepeat: 'no-repeat',
            transform: 'translateZ(0)',
            WebkitTransform: 'translateZ(0)'
          }} />
        </div>
        )}

        {/* SVG Filter for Liquid Glass Effect */}
        <svg style={{ display: 'none' }}>
          <filter
            id="glass-distortion"
            x="0%"
            y="0%"
            width="100%"
            height="100%"
            filterUnits="objectBoundingBox"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.01 0.01"
              numOctaves="1"
              seed="5"
              result="turbulence"
            />

            <feComponentTransfer in="turbulence" result="mapped">
              <feFuncR type="gamma" amplitude="1" exponent="10" offset="0.5" />
              <feFuncG type="gamma" amplitude="0" exponent="1" offset="0" />
              <feFuncB type="gamma" amplitude="0" exponent="1" offset="0.5" />
            </feComponentTransfer>

            <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />

            <feSpecularLighting
              in="softMap"
              surfaceScale="5"
              specularConstant="1"
              specularExponent="100"
              lightingColor="white"
              result="specLight"
            >
              <fePointLight x="-200" y="-200" z="300" />
            </feSpecularLighting>

            <feComposite
              in="specLight"
              operator="arithmetic"
              k1="0"
              k2="1"
              k3="1"
              k4="0"
              result="litImage"
            />

            <feDisplacementMap
              in="SourceGraphic"
              in2="softMap"
              scale="150"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </svg>

        <style>{`
          /* Ensure html and body allow fixed positioning */
          html {
            height: 100%;
            height: -webkit-fill-available;
            overflow-x: hidden;
          }

          body {
            min-height: 100vh;
            min-height: -webkit-fill-available;
            position: relative;
            overflow-x: hidden;
          }

          /* iOS Safari specific fixes for fixed backgrounds */
          .fixed-bg-light,
          .fixed-bg-dark {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100% !important;
            height: 100% !important;
            max-height: 100vh !important;
            max-height: -webkit-fill-available !important;
            overflow: hidden !important;
            -webkit-overflow-scrolling: touch;
          }

          /* Prevent iOS Safari from moving the background during overscroll bounce */
          @supports (-webkit-touch-callout: none) {
            .fixed-bg-light,
            .fixed-bg-dark {
              position: fixed !important;
            }
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          @keyframes slideDown {
            0% {
              opacity: 0;
              max-height: 0;
            }
            100% {
              opacity: 1;
              max-height: 1000px;
            }
          }

          /* Day mode background image - only applies when not in dark mode */
          html[data-theme="light"] body {
            background-color: #f8f9fa !important;
            background-image: url('/images/daymode.jpg') !important;
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-repeat: no-repeat;
          }

          /* Alternative selector for light mode */
          body:not(.dark-mode) {
            background-color: #f8f9fa !important;
            background-image: url('/images/daymode.jpg') !important;
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-repeat: no-repeat;
          }

          /* Dark mode background - elegant geometric pattern */
          html[data-theme="dark"] body {
            background-color: #1a1a1a !important;
            background-image: url("https://wallpapers.com/images/high/elegant-abstract-geometric-pattern-with-monochromatic-black-rectangle-m8k9bhf9vr2ydzoh.webp") !important;
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-repeat: no-repeat;
          }

          /* Alternative selector for dark mode */
          body.dark-mode {
            background-color: #1a1a1a !important;
            background-image: url("https://wallpapers.com/images/high/elegant-abstract-geometric-pattern-with-monochromatic-black-rectangle-m8k9bhf9vr2ydzoh.webp") !important;
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-repeat: no-repeat;
          }
        `}</style>
        {/* Fixed Top Section - Header + Market Ticker */}
        {user && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            background: theme === 'light' ? 'rgba(248, 249, 250, 0.95)' : 'var(--bg-secondary)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
            backdropFilter: theme === 'light' ? 'blur(10px)' : 'none',
            paddingTop: 'env(safe-area-inset-top)'
          }}>
            {/* Compact Header */}
            <header style={{
              background: theme === 'light' ? 'transparent' : 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border-color)',
              padding: isMobile ? '0.5rem 0.75rem' : '0.75rem 1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              {/* Left Section - Burger Menu (mobile only) + Logo */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                {/* Burger Menu Button - Mobile only, left of logo */}
                {isMobile && currentSection !== 'intranet' && (
                  <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '50%',
                      border: 'none',
                      background: isMenuOpen
                        ? 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)'
                        : 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)',
                      color: isMenuOpen ? 'white' : 'var(--text-primary)',
                      fontSize: '1.2rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: isMenuOpen
                        ? '0 2px 8px rgba(0, 123, 255, 0.3)'
                        : '0 2px 4px rgba(0, 0, 0, 0.1)',
                      flexShrink: 0
                    }}
                    title="Navigation menu"
                  >
                    {isMenuOpen ? '✕' : '☰'}
                  </button>
                )}

                {/* Logo */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer'
                  }}
                  onClick={() => handleSectionChange('dashboard')}
                >
                  <img
                    src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png"
                    alt="Amber Lake Partners"
                    style={{
                      height: isMobile ? '24px' : '32px',
                      width: 'auto',
                      objectFit: 'contain'
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
              </div>

              {/* Center section - Global Search + View As Filter - Hide on mobile and in Intranet section */}
              {!isMobile && currentSection !== 'intranet' && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  flex: 1,
                  maxWidth: '800px',
                  marginLeft: '1rem',
                  marginRight: '1rem'
                }}>
                  {/* Global Search Bar */}
                  <GlobalSearchBar onProductSelect={(product) => {
                    // Navigate to the product report when selected
                    handleSectionChange('report', product._id);
                  }} />

                  {/* View As Filter - For admins and RMs */}
                  <ViewAsFilter currentUser={user} />
                </div>
              )}

              {/* Right section - Mobile Action Buttons + Notification Center + Amber AI */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? '0.375rem' : '0.5rem'
              }}>
                {/* Mobile-only buttons - Search, View As, and Settings */}
                {isMobile && currentSection !== 'intranet' && (
                  <>
                    {/* Search Button */}
                    <button
                      onClick={() => setMobileSearchOpen(true)}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        border: 'none',
                        background: 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)',
                        color: 'var(--text-primary)',
                        fontSize: '1rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                        flexShrink: 0
                      }}
                      title="Search products"
                    >
                      🔍
                    </button>

                    {/* View As Button - For admins and RMs only */}
                    {user && (user.role === 'admin' || user.role === 'superadmin' || user.role === 'rm') && (
                      <button
                        onClick={() => setMobileViewAsOpen(true)}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          border: 'none',
                          background: viewAsFilter
                            ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
                            : 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)',
                          color: viewAsFilter ? '#fff' : 'var(--text-primary)',
                          fontSize: '1rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s ease',
                          boxShadow: viewAsFilter
                            ? '0 2px 8px rgba(59, 130, 246, 0.4)'
                            : '0 2px 4px rgba(0, 0, 0, 0.1)',
                          flexShrink: 0
                        }}
                        title={viewAsFilter ? `Viewing as: ${viewAsFilter.label}` : 'View as'}
                      >
                        👁️
                      </button>
                    )}

                    {/* Settings Button - Navigates to Admin Section on Mobile */}
                    {user && (user.role === 'admin' || user.role === 'superadmin') && (
                      <button
                        onClick={() => handleSectionChange('administration')}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          border: 'none',
                          background: currentSection === 'administration'
                            ? 'linear-gradient(135deg, #6c757d 0%, #495057 100%)'
                            : 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)',
                          color: currentSection === 'administration' ? 'white' : 'var(--text-primary)',
                          fontSize: '1rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s ease',
                          boxShadow: currentSection === 'administration'
                            ? '0 2px 8px rgba(108, 117, 125, 0.3)'
                            : '0 2px 4px rgba(0, 0, 0, 0.1)',
                          flexShrink: 0
                        }}
                        title="Administration"
                      >
                        ⚙️
                      </button>
                    )}
                  </>
                )}

                <NotificationCenter
                  currentUser={user}
                  onViewAllClick={() => handleSectionChange('notifications')}
                  onNotificationClick={(notification) => {
                    if (notification.productId) {
                      handleSectionChange('report', notification.productId);
                    }
                  }}
                />

                {/* Amber AI Chat Toggle */}
                <button
                  onClick={() => setIsAmberChatOpen(!isAmberChatOpen)}
                  style={{
                    width: isMobile ? '32px' : '36px',
                    height: isMobile ? '32px' : '36px',
                    borderRadius: '50%',
                    border: 'none',
                    background: isAmberChatOpen
                      ? 'linear-gradient(135deg, #b65f23 0%, #c76d2f 100%)'
                      : 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)',
                    color: isAmberChatOpen ? 'white' : 'var(--text-primary)',
                    fontSize: isMobile ? '1rem' : '1.2rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    boxShadow: isAmberChatOpen
                      ? '0 2px 8px rgba(182, 95, 35, 0.3)'
                      : '0 2px 4px rgba(0, 0, 0, 0.1)'
                  }}
                  onMouseEnter={(e) => {
                    if (!isAmberChatOpen && !isMobile) {
                      e.target.style.background = 'linear-gradient(135deg, #b65f23 0%, #c76d2f 100%)';
                      e.target.style.color = 'white';
                      e.target.style.boxShadow = '0 2px 8px rgba(182, 95, 35, 0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isAmberChatOpen && !isMobile) {
                      e.target.style.background = 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)';
                      e.target.style.color = 'var(--text-primary)';
                      e.target.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                    }
                  }}
                  title="Chat with Amber AI"
                >
                  🔮
                </button>
              </div>
            </header>

            {/* Market Ticker - Lazy loaded for performance - Hide in Intranet section and on mobile */}
            {currentSection !== 'intranet' && !isMobile && (showMarketTicker ? (
              <ErrorBoundary silent={true}>
                <Suspense fallback={<div style={{ height: '50px', background: 'linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)', borderBottom: '1px solid var(--border-color)' }} />}>
                  <MarketTicker />
                </Suspense>
              </ErrorBoundary>
            ) : (
              <div style={{ height: '50px', background: 'linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)', borderBottom: '1px solid var(--border-color)' }} />
            ))}
          </div>
        )}

        {/* Spacer to push content below fixed header - Adjust height for mobile (no MarketTicker) and Intranet - Add safe area inset */}
        {user && <div style={{
          height: currentSection === 'intranet' || isMobile
            ? (isMobile ? 'calc(40px + env(safe-area-inset-top))' : 'calc(50px + env(safe-area-inset-top))')
            : 'calc(100px + env(safe-area-inset-top))'
        }} />}

        {/* Loading state during authentication check - Exclude PDF modes as they handle their own loading */}
        {isAuthLoading && !isPDFMode && currentSection !== 'print-report' && currentSection !== 'pdf-phoenix' && currentSection !== 'pdf-orion' && currentSection !== 'pdf-participation' && currentSection !== 'pdf-pms' && currentSection !== 'pdf-risk-analysis' && currentSection !== 'landing' && currentSection !== 'infine' && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '50vh',
            color: 'var(--text-primary)'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '1.5rem',
                marginBottom: '1rem',
                animation: 'spin 1s linear infinite'
              }}>⚡</div>
              <p>Loading...</p>
            </div>
          </div>
        )}

        {/* Print-Friendly Report Page - Minimal layout for printing */}
        {currentSection === 'print-report' && currentRoute.productId && (
          <PrintableProductReport />
        )}

        {/* PDF Phoenix Report - Clean table-based layout for PDF generation */}
        {currentSection === 'pdf-phoenix' && currentRoute.productId && (
          <PhoenixReportPDF productId={currentRoute.productId} />
        )}

        {/* PDF Orion Report - Clean table-based layout for PDF generation */}
        {currentSection === 'pdf-orion' && currentRoute.productId && (
          <OrionReportPDF productId={currentRoute.productId} />
        )}

        {/* PDF Participation Note Report - Clean table-based layout for PDF generation */}
        {currentSection === 'pdf-participation' && currentRoute.productId && (
          <ParticipationNoteReportPDF productId={currentRoute.productId} />
        )}

        {/* PDF PMS Report - Portfolio Management System PDF */}
        {currentSection === 'pdf-pms' && (
          <PMSReportPDF />
        )}

        {/* PDF Risk Analysis Report */}
        {currentSection === 'pdf-risk-analysis' && (
          <RiskAnalysisPDF />
        )}

        {/* Landing Page - Public marketing page, no authentication required */}
        {currentSection === 'landing' && (
          <LandingPage />
        )}

        {/* Infine Loan Calculator - Public page, no authentication required */}
        {currentSection === 'infine' && (
          <InfinePage />
        )}

        {/* Password Reset Page - Show regardless of login state */}
        {!isAuthLoading && currentSection === 'reset-password' && (
          <PasswordReset
            token={currentRoute.token}
            onComplete={() => {
              // Return to login page
              handleSectionChange('dashboard');
              window.location.hash = '';
            }}
          />
        )}

        {/* Login Form Section - Only show when not logged in, not loading, not on reset password page, and not in PDF mode */}
        {!user && !isAuthLoading && currentSection !== 'reset-password' && !isPDFMode && currentSection !== 'print-report' && currentSection !== 'pdf-phoenix' && currentSection !== 'pdf-orion' && currentSection !== 'pdf-participation' && currentSection !== 'pdf-pms' && currentSection !== 'pdf-risk-analysis' && currentSection !== 'landing' && currentSection !== 'infine' && (
          <section style={{
            padding: '0 1rem',
            background: theme === 'light' ? 'transparent' : 'transparent'
          }}>
            <div style={{
              maxWidth: '1400px',
              margin: '0 auto',
              background: theme === 'light' ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
              borderRadius: theme === 'light' ? '8px' : '0',
              padding: theme === 'light' ? '2rem' : '0',
              backdropFilter: theme === 'light' ? 'blur(10px)' : 'none'
            }}>
              <Login onUserChange={handleUserChange} compact={false} />
            </div>
          </section>
        )}


        {/* Main Content - Protected (or PDF mode) */}
        {(user || isPDFMode) && currentSection !== 'reset-password' && currentSection !== 'print-report' && currentSection !== 'pdf-phoenix' && currentSection !== 'pdf-orion' && currentSection !== 'pdf-participation' && currentSection !== 'pdf-pms' && currentSection !== 'pdf-risk-analysis' && currentSection !== 'landing' && currentSection !== 'infine' && <MainContent user={user} currentSection={currentSection} setCurrentSection={handleSectionChange} onComponentLibraryStateChange={setIsComponentLibraryOpen} currentRoute={currentRoute} isMenuOpen={isMenuOpen} setIsMenuOpen={setIsMenuOpen} isSettingsOpen={isSettingsOpen} setIsSettingsOpen={setIsSettingsOpen} isMobile={isMobile} />}

        {/* Spacer to prevent content from being hidden behind fixed bottom bar - Hide on mobile */}
        {user && !isMobile && <div style={{ height: '40px' }} />}

        {/* Fixed Bottom Bar - User Info and Logout - Hide on mobile */}
        {user && !isMobile && (
          <LiquidGlassCard
            borderRadius="0"
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 1000,
              padding: '0.3rem 1rem'
            }}
          >
            <Login onUserChange={handleUserChange} compact={true} />
          </LiquidGlassCard>
        )}

        {/* Amber AI Chat Panel */}
        {user && (
          <AmberChat
            isOpen={isAmberChatOpen}
            onClose={() => setIsAmberChatOpen(false)}
            currentUser={user}
          />
        )}

        {/* Mobile Search Overlay */}
        {user && isMobile && mobileSearchOpen && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: theme === 'light' ? 'rgba(248, 249, 250, 0.98)' : 'rgba(26, 26, 26, 0.98)',
              zIndex: 1100,
              display: 'flex',
              flexDirection: 'column',
              backdropFilter: 'blur(10px)',
              animation: 'slideUp 0.3s ease-out'
            }}
          >
            {/* Search Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '1rem',
                paddingTop: 'calc(1rem + env(safe-area-inset-top))',
                borderBottom: '1px solid var(--border-color)',
                background: theme === 'light' ? 'rgba(255, 255, 255, 0.95)' : 'var(--bg-secondary)'
              }}
            >
              {/* Search Bar Container */}
              <div style={{ flex: 1 }}>
                <GlobalSearchBar
                  onProductSelect={(product) => {
                    handleSectionChange('report', product._id);
                    setMobileSearchOpen(false);
                  }}
                />
              </div>

              {/* Close Button */}
              <button
                onClick={() => setMobileSearchOpen(false)}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  border: 'none',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                ✕
              </button>
            </div>

            {/* Search Instructions */}
            <div
              style={{
                padding: '1.5rem',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem'
              }}
            >
              <p style={{ margin: 0 }}>
                Search by product title, ISIN, or underlying asset
              </p>
            </div>
          </div>
        )}

        {/* Mobile View As Overlay */}
        {user && isMobile && mobileViewAsOpen && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: theme === 'light' ? 'rgba(248, 249, 250, 0.98)' : 'rgba(26, 26, 26, 0.98)',
              zIndex: 1100,
              display: 'flex',
              flexDirection: 'column',
              backdropFilter: 'blur(10px)',
              animation: 'slideUp 0.3s ease-out'
            }}
          >
            {/* View As Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '1rem',
                paddingTop: 'calc(1rem + env(safe-area-inset-top))',
                borderBottom: '1px solid var(--border-color)',
                background: theme === 'light' ? 'rgba(255, 255, 255, 0.95)' : 'var(--bg-secondary)'
              }}
            >
              {/* Title */}
              <h3 style={{
                margin: 0,
                fontSize: '1.1rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                View As
              </h3>

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Close Button */}
              <button
                onClick={() => setMobileViewAsOpen(false)}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  border: 'none',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                ✕
              </button>
            </div>

            {/* View As Filter Container */}
            <div
              style={{
                padding: '1.5rem',
                flex: 1,
                overflowY: 'auto'
              }}
            >
              <ViewAsFilter
                currentUser={user}
                onSelect={() => setMobileViewAsOpen(false)}
              />

              {/* Favorites Quick Access */}
              {favorites && favorites.length > 0 && (
                <div style={{ marginTop: '1.5rem' }}>
                  <h4 style={{
                    margin: '0 0 0.75rem 0',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Favorites
                  </h4>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem'
                  }}>
                    {favorites.map(fav => (
                      <button
                        key={fav.id}
                        onClick={() => {
                          setFilter({
                            type: fav.type || 'client',
                            id: fav.id,
                            label: fav.label,
                            data: fav.data
                          });
                          setMobileViewAsOpen(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          padding: '0.875rem 1rem',
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          background: viewAsFilter?.id === fav.id
                            ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05))'
                            : 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <span style={{ fontSize: '1.25rem' }}>
                          {viewAsFilter?.id === fav.id ? '✓' : '⭐'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontWeight: '500',
                            fontSize: '0.95rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {fav.label}
                          </div>
                          {fav.data?.emails?.[0]?.address && (
                            <div style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {fav.data.emails[0].address}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Instructions */}
            <div
              style={{
                padding: '1.5rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border-color)',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                background: theme === 'light' ? 'rgba(255, 255, 255, 0.5)' : 'var(--bg-secondary)'
              }}
            >
              <p style={{ margin: 0 }}>
                Filter data to view as a specific client or account
              </p>
            </div>
          </div>
        )}

        <style>{`
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(100%);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </div>
  );
};

export const App = () => {
  return (
    <ThemeProvider>
      <ViewAsProvider>
        <AppContent />
      </ViewAsProvider>
    </ThemeProvider>
  );
};
