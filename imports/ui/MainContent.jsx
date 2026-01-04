import React, { useState, useCallback } from 'react';
import Dashboard from './Dashboard.jsx';
import RMDashboard from './components/dashboard/RMDashboard.jsx';
import StructuredProductInterface from './StructuredProductInterface.jsx';
import { ProductForm } from './ProductForm.jsx';
import { ProductList } from './ProductList.jsx';
import UserManagement from './UserManagement.jsx';
import IssuerManagementComponent from './IssuerManagementComponent.jsx';
import UserProfileForm from './UserProfileForm.jsx';
import UserInfoDisplay from './UserInfoDisplay.jsx';
import BankAccountManagement from './BankAccountManagement.jsx';
import PriceUploadManager from './PriceUploadManager.jsx';
import AdminManagement from './AdminManagement.jsx';
import ProfileManagement from './ProfileManagement.jsx';
import ProductAllocation from './ProductAllocation.jsx';
import RightNavigationMenu from './RightNavigationMenu.jsx';
import RightSettingsMenu from './RightSettingsMenu.jsx';
import NotificationsPage from './NotificationsPage.jsx';
import { USER_ROLES } from '/imports/api/users';
import TestInput from './TestInput.jsx';
import UnderlyingsView from './UnderlyingsView.jsx';
import TemplateProductReport from './TemplateProductReport.jsx';
import Schedule from './Schedule.jsx';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';
import Intranet from './Intranet.jsx';
import MarketNews from './MarketNews.jsx';
import PortfolioManagementSystem from './PortfolioManagementSystem.jsx';
import ClientsSection from './ClientsSection.jsx';
import AlertCenter from './AlertCenter.jsx';

const MainContent = ({ user, currentSection, setCurrentSection, onComponentLibraryStateChange, currentRoute, isMenuOpen, setIsMenuOpen, isSettingsOpen, setIsSettingsOpen, isMobile }) => {
  // Use lifted menu and settings state from App.jsx (for mobile header integration)
  const { dialogState, showConfirm, showError, hideDialog } = useDialog();
  
  // Persist editing product across page refreshes
  const [editingProduct, setEditingProduct] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('editingProduct');
      console.log('MainContent: Restoring editingProduct from localStorage:', stored ? 'Found product data' : 'No product data');
      return stored ? JSON.parse(stored) : null;
    }
    return null;
  });
  
  const [editingTemplate, setEditingTemplate] = useState(null);
  
  // State for product allocation
  const [allocatingProduct, setAllocatingProduct] = useState(null);
  
  // Persist selected product ID across page refreshes
  const [selectedProductId, setSelectedProductId] = useState(() => {
    if (typeof window !== 'undefined') {
      const storedId = localStorage.getItem('selectedProductId');
      console.log('MainContent: Restoring selectedProductId from localStorage:', storedId);
      return storedId || null;
    }
    return null;
  });

  const handleNavigate = (section) => {
    setCurrentSection(section);
    // Reset editing product and template when navigating away from create-product
    if (section !== 'create-product') {
      setEditingProduct(null);
      setEditingTemplate(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('editingProduct');
      }
    }
    // Clear selected product ID when navigating away from product-report
    if (section !== 'product-report') {
      setSelectedProductId(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('selectedProductId');
      }
    }
  };

  const handleCreateProduct = useCallback(() => {
    setEditingProduct(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('editingProduct');
    }
    setCurrentSection('create-product');
  }, [setCurrentSection]);

  const handleEditProduct = useCallback((product) => {
    setEditingProduct(product);
    if (typeof window !== 'undefined') {
      localStorage.setItem('editingProduct', JSON.stringify(product));
    }
    setCurrentSection('create-product');
  }, [setCurrentSection]);

  const handleDeleteProduct = useCallback(async (product) => {
    const shouldDelete = await showConfirm(
      `Are you sure you want to delete "${product.title}"? This action cannot be undone.`,
      null,
      'Confirm Deletion'
    );
    
    if (!shouldDelete) {
      return;
    }
    
    try {
      const sessionId = localStorage.getItem('sessionId');
      console.log('Delete attempt - SessionId:', sessionId ? 'Found' : 'Not found');
      console.log('User object:', user ? `User ID: ${user.id || user._id}` : 'No user');
      
      if (!sessionId) {
        showError('No valid session found. Please log in first to delete products.', 'Authentication Error');
        return;
      }
      
      await Meteor.callAsync('products.remove', product._id, sessionId);
      console.log('Product deleted successfully:', product.title);
    } catch (error) {
      console.error('Error deleting product:', error);
      showError(`Failed to delete product: ${error.reason || error.message}`, 'Deletion Error');
    }
  }, [showConfirm, showError, user]);

  const handleEditTemplate = (template) => {
    setEditingTemplate(template);
    // The actual template loading will be handled in StructuredProductInterface
  };

  const handleViewReport = () => {};

  const handleViewProductReport = useCallback((product) => {
    console.log('MainContent: Navigating to product report for:', product._id);
    setCurrentSection('report', product._id);
  }, [setCurrentSection]);

  const handleAllocateProduct = (product) => {
    setAllocatingProduct(product);
  };

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
    // Close settings menu when opening navigation menu
    if (!isMenuOpen && isSettingsOpen) {
      setIsSettingsOpen(false);
    }
  };

  const handleNavigateToAdmin = (section = 'administration') => {
    handleNavigate(section);
    // Close navigation menu if open
    if (isMenuOpen) {
      setIsMenuOpen(false);
    }
  };

  const getUserRole = () => {
    if (!user) return 'client';
    return user.role || 'client';
  };

  const hasAccess = (requiredRole) => {
    const roleHierarchy = { client: 1, rm: 2, admin: 2, superadmin: 3 };
    const userRoleLevel = roleHierarchy[getUserRole()] || 1;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 1;
    return userRoleLevel >= requiredRoleLevel;
  };

  const isNonClient = () => {
    const role = getUserRole();
    return role !== 'client';
  };

  const renderContent = () => {
    switch (currentSection) {
      case 'dashboard':
        // Show RMDashboard for RMs and Admins, regular Dashboard for clients
        const role = getUserRole();
        if (role === 'rm' || role === 'admin' || role === 'superadmin') {
          return (
            <RMDashboard
              user={user}
              onNavigate={(section, params) => {
                if (section === 'report' && params?.productId) {
                  setCurrentSection('report', params.productId);
                } else if (section === 'client' && params?.clientId) {
                  // Navigate to user details or profile
                  setCurrentSection('user-management');
                } else {
                  setCurrentSection(section);
                }
              }}
            />
          );
        }
        return (
          <Dashboard
            user={user}
            onCreateProduct={handleCreateProduct}
            onEditProduct={handleEditProduct}
            onViewReport={handleViewReport}
            onDeleteProduct={handleDeleteProduct}
            onViewProductReport={handleViewProductReport}
          />
        );
      
      case 'products':
        // Structured Products Dashboard (the old Dashboard)
        return (
          <Dashboard
            user={user}
            onCreateProduct={handleCreateProduct}
            onEditProduct={handleEditProduct}
            onViewReport={handleViewReport}
            onDeleteProduct={handleDeleteProduct}
            onViewProductReport={handleViewProductReport}
          />
        );

      case 'create-product':
        if (!hasAccess(USER_ROLES.CLIENT)) return <div>Access denied</div>;
        return (
          <div style={{
            minHeight: '100vh',
            backgroundColor: 'var(--bg-primary)',
            padding: '0'
          }}>
            <StructuredProductInterface
              editingProduct={editingProduct}
              editingTemplate={editingTemplate}
              user={user}
              onSave={() => {
                setCurrentSection('products');
                setEditingTemplate(null); // Clear template after save
                setEditingProduct(null); // Clear product after save
              }}
              onComponentLibraryStateChange={onComponentLibraryStateChange}
            />
          </div>
        );
      
      case 'profile':
        if (!hasAccess(USER_ROLES.CLIENT)) return <div>Access denied</div>;
        return <ProfileManagement user={user} currentSection={currentSection} />;


      case 'product-report':
        return <div>Reporting removed.</div>;

      case 'report':
        if (!currentRoute.productId) {
          // Auto-redirect to dashboard instead of showing error
          console.log('MainContent: No productId for report route, redirecting to dashboard');
          setTimeout(() => handleNavigate('dashboard'), 0);
          return (
            <div style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              background: 'var(--bg-secondary)',
              borderRadius: '12px',
              border: '2px dashed var(--border-color)',
              margin: '2rem'
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: 0.5 }}>🔄</div>
              <h2 style={{
                margin: '0 0 1rem 0',
                color: 'var(--text-secondary)',
                fontSize: '1.2rem'
              }}>
                Redirecting to Dashboard
              </h2>
              <p style={{
                margin: '0 0 2rem 0',
                color: 'var(--text-muted)',
                fontSize: '1rem'
              }}>
                No product specified, taking you to the dashboard...
              </p>
            </div>
          );
        }
        return (
          <TemplateProductReport 
            productId={currentRoute.productId}
            user={user}
            onNavigateBack={() => handleNavigate('dashboard')}
            onEditProduct={handleEditProduct}
            onAllocateProduct={handleAllocateProduct}
          />
        );

      case 'product-management':
      case 'user-management':
      case 'issuer-management':
      case 'administration':
        if (!hasAccess(USER_ROLES.ADMIN)) return <div>Access denied</div>;
        return <AdminManagement user={user} currentSection={currentSection} onEditProduct={handleEditProduct} />
      
      case 'debug':
        if (!hasAccess(USER_ROLES.ADMIN)) return <div>Access denied</div>;
        return <TestInput />;
      
      case 'underlyings':
        return <UnderlyingsView user={user} onNavigateToReport={handleViewProductReport} />;
      
      case 'pms':
        if (!hasAccess(USER_ROLES.CLIENT)) return <div>Access denied</div>;
        return <PortfolioManagementSystem user={user} />;

      case 'market-news':
        if (!hasAccess(USER_ROLES.CLIENT)) return <div>Access denied</div>;
        return <MarketNews user={user} />;

      case 'schedule':
        if (!hasAccess(USER_ROLES.CLIENT)) return <div>Access denied</div>;
        return <Schedule user={user} />;

      case 'alerts':
        if (!hasAccess(USER_ROLES.CLIENT)) return <div>Access denied</div>;
        return <AlertCenter user={user} />;

      case 'intranet':
        if (!isNonClient()) return <div>Access denied</div>;
        return <Intranet user={user} />;

      case 'clients':
        if (!isNonClient()) return <div>Access denied</div>;
        return <ClientsSection user={user} />;

      case 'notifications':
        if (!hasAccess(USER_ROLES.CLIENT)) return <div>Access denied</div>;
        return <NotificationsPage currentUser={user} />;

      default:
        return (
          <Dashboard
            user={user}
            onCreateProduct={handleCreateProduct}
            onEditProduct={handleEditProduct}
            onViewReport={handleViewReport}
            onDeleteProduct={handleDeleteProduct}
            onViewProductReport={handleViewProductReport}
          />
        );
    }
  };

  return (
    <div style={{ position: 'relative', minHeight: 'calc(100vh - 200px)' }}>
      {/* Main Content Area */}
      <div style={{ 
        transition: 'margin-right 0.3s ease',
        marginRight: isMenuOpen ? '0px' : '0px' // Keep content fixed, menu overlays
      }}>
        {renderContent()}
      </div>

      {/* Right Navigation Menu */}
      <RightNavigationMenu
        isOpen={isMenuOpen}
        onToggle={toggleMenu}
        onNavigate={handleNavigate}
        currentSection={currentSection}
        userRole={getUserRole()}
        isMobile={isMobile}
      />

      {/* Right Settings Menu - Admin Navigation Button */}
      <RightSettingsMenu
        onNavigateToAdmin={handleNavigateToAdmin}
        isMobile={isMobile}
        userRole={getUserRole()}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Product Allocation Modal */}
      {allocatingProduct && (
        <ProductAllocation
          product={allocatingProduct}
          user={user}
          onClose={() => setAllocatingProduct(null)}
        />
      )}

      {/* Styled Dialog for confirmations and alerts */}
      <Dialog {...dialogState} onClose={hideDialog} />
    </div>
  );
};

export default MainContent;