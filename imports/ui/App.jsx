import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import Login from './Login.jsx';
import MainContent from './MainContent.jsx';
import PasswordReset from './PasswordReset.jsx';
import GlobalSearchBar from './components/GlobalSearchBar.jsx';
import ViewAsFilter from './components/ViewAsFilter.jsx';
import NotificationCenter from './NotificationCenter.jsx';
import AmberChat from './AmberChat.jsx';
import { ThemeProvider, useTheme } from './ThemeContext.jsx';
import { ViewAsProvider } from './ViewAsContext.jsx';

// Lazy load MarketTicker to improve initial page load performance
// This splits MarketTicker into a separate chunk that loads asynchronously
const MarketTicker = lazy(() => import('./MarketTicker.jsx'));

const AppContent = () => {
  const { theme } = useTheme();
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true); // Add loading state for authentication
  const [isComponentLibraryOpen, setIsComponentLibraryOpen] = useState(false);
  const [showMarketTicker, setShowMarketTicker] = useState(false); // Defer MarketTicker loading
  const [isAmberChatOpen, setIsAmberChatOpen] = useState(false); // Amber AI chat state
  // Parse route from URL
  const parseRouteFromUrl = () => {
    if (typeof window === 'undefined') return { section: 'dashboard' };

    const pathname = window.location.pathname;
    const hash = window.location.hash.slice(1);

    // Check for report route: /report/:productId
    const reportMatch = pathname.match(/^\/report\/([a-zA-Z0-9]+)$/);
    if (reportMatch) {
      const productId = reportMatch[1];
      console.log('App: Found report route for product:', productId);
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
      const timer = setTimeout(() => {
        setShowMarketTicker(true);
      }, 2000); // 2 second delay after auth completes

      return () => clearTimeout(timer);
    }
  }, [isAuthLoading]);

  // Create background style for both light and dark mode
  const backgroundStyle = theme === 'light' ? {
    backgroundImage: 'url(/images/daymode.jpg)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
    backgroundRepeat: 'no-repeat',
    backgroundColor: 'transparent' // Remove white background when image is present
  } : {
    // Dark mode background - elegant geometric pattern
    backgroundImage: 'url("https://wallpapers.com/images/high/elegant-abstract-geometric-pattern-with-monochromatic-black-rectangle-m8k9bhf9vr2ydzoh.webp")',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
    backgroundRepeat: 'no-repeat'
  };

  return (
      <div style={{ 
        minHeight: '100vh', 
        transition: 'all 0.3s ease',
        ...backgroundStyle
      }}>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          
          /* Day mode background image - only applies when not in dark mode */
          html[data-theme="light"] body {
            background-image: url('/images/daymode.jpg') !important;
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-repeat: no-repeat;
          }
          
          /* Alternative selector for light mode */
          body:not(.dark-mode) {
            background-image: url('/images/daymode.jpg') !important;
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-repeat: no-repeat;
          }
          
          /* Dark mode background - elegant geometric pattern */
          html[data-theme="dark"] body {
            background-image: url("https://wallpapers.com/images/high/elegant-abstract-geometric-pattern-with-monochromatic-black-rectangle-m8k9bhf9vr2ydzoh.webp") !important;
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-repeat: no-repeat;
          }
          
          /* Alternative selector for dark mode */
          body.dark-mode {
            background-image: url("https://wallpapers.com/images/high/elegant-abstract-geometric-pattern-with-monochromatic-black-rectangle-m8k9bhf9vr2ydzoh.webp") !important;
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-repeat: no-repeat;
          }
          
          /* Make sure body background shows through all elements in light mode */
          html[data-theme="light"] * {
            /* This will help debug - temporarily make all backgrounds slightly transparent */
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
            backdropFilter: theme === 'light' ? 'blur(10px)' : 'none'
          }}>
            {/* Compact Header */}
            <header style={{
              background: theme === 'light' ? 'transparent' : 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border-color)',
              padding: '0.75rem 1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
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
                    height: '32px',
                    width: 'auto',
                    objectFit: 'contain'
                  }}
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </div>
              
              {/* Center section - Global Search + View As Filter - Hide in Intranet section */}
              {currentSection !== 'intranet' && (
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

                  {/* View As Filter - Only for admins */}
                  <ViewAsFilter currentUser={user} />
                </div>
              )}

              {/* Right section - Notification Center + Amber AI */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <NotificationCenter
                  currentUser={user}
                  onViewAllClick={() => handleSectionChange('notifications')}
                />

                {/* Amber AI Chat Toggle */}
                <button
                  onClick={() => setIsAmberChatOpen(!isAmberChatOpen)}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: 'none',
                    background: isAmberChatOpen
                      ? 'linear-gradient(135deg, #b65f23 0%, #c76d2f 100%)'
                      : 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)',
                    color: isAmberChatOpen ? 'white' : 'var(--text-primary)',
                    fontSize: '1.2rem',
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
                    if (!isAmberChatOpen) {
                      e.target.style.background = 'linear-gradient(135deg, #b65f23 0%, #c76d2f 100%)';
                      e.target.style.color = 'white';
                      e.target.style.boxShadow = '0 2px 8px rgba(182, 95, 35, 0.3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isAmberChatOpen) {
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

            {/* Market Ticker - Lazy loaded for performance - Hide in Intranet section */}
            {currentSection !== 'intranet' && (showMarketTicker ? (
              <Suspense fallback={<div style={{ height: '50px', background: 'linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)', borderBottom: '1px solid var(--border-color)' }} />}>
                <MarketTicker />
              </Suspense>
            ) : (
              <div style={{ height: '50px', background: 'linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)', borderBottom: '1px solid var(--border-color)' }} />
            ))}
          </div>
        )}

        {/* Spacer to push content below fixed header - Adjust height for Intranet (no MarketTicker) */}
        {user && <div style={{ height: currentSection === 'intranet' ? '50px' : '100px' }} />}

        {/* Loading state during authentication check */}
        {isAuthLoading && (
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

        {/* Login Form Section - Only show when not logged in, not loading, and not on reset password page */}
        {!user && !isAuthLoading && currentSection !== 'reset-password' && (
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


        {/* Main Content - Protected */}
        {user && currentSection !== 'reset-password' && <MainContent user={user} currentSection={currentSection} setCurrentSection={handleSectionChange} onComponentLibraryStateChange={setIsComponentLibraryOpen} currentRoute={currentRoute} />}

        {/* Spacer to prevent content from being hidden behind fixed bottom bar */}
        {user && <div style={{ height: '40px' }} />}

        {/* Fixed Bottom Bar - User Info and Logout */}
        {user && (
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            background: theme === 'light' ? 'rgba(248, 249, 250, 0.95)' : 'var(--bg-secondary)',
            borderTop: '1px solid var(--border-color)',
            padding: '0.3rem 1rem',
            backdropFilter: theme === 'light' ? 'blur(10px)' : 'none',
            boxShadow: '0 -2px 4px rgba(0, 0, 0, 0.1)'
          }}>
            <Login onUserChange={handleUserChange} compact={true} />
          </div>
        )}

        {/* Amber AI Chat Panel */}
        {user && (
          <AmberChat
            isOpen={isAmberChatOpen}
            onClose={() => setIsAmberChatOpen(false)}
            currentUser={user}
          />
        )}
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
