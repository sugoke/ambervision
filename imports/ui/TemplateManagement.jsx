import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker, useSubscribe } from 'meteor/react-meteor-data';
import { TemplatesCollection } from '/imports/api/templates';
import { USER_ROLES } from '/imports/api/users';
import { useTheme } from './ThemeContext.jsx';

const TemplateManagement = ({ user, onNavigate, onEditTemplate }) => {
  const { isDarkMode } = useTheme();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // Subscribe to templates
  const isLoading = useSubscribe('templates');
  
  // Get templates from the database
  const { templates, categories } = useTracker(() => {
    const templatesData = TemplatesCollection.find({}, {
      sort: { [sortBy]: 1 }
    }).fetch();
    
    console.log('TemplateManagement: Found templates:', templatesData.length);
    console.log('TemplateManagement: Templates data:', templatesData);
    
    // Extract unique categories
    const uniqueCategories = [...new Set(templatesData.map(t => t.category || 'uncategorized'))];
    
    return {
      templates: templatesData,
      categories: uniqueCategories
    };
  }, [sortBy]);
  
  // Filter templates based on search and category
  const filteredTemplates = templates.filter(template => {
    const matchesSearch = searchTerm === '' || 
      template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });
  
  const handleUseTemplate = (template) => {
    if (onNavigate && onEditTemplate) {
      onEditTemplate({
        ...template,
        isTemplate: true,
        templateId: template._id
      });
      onNavigate('create-product');
    }
  };
  
  const handleEditTemplate = async (template) => {
    // Only admin/superadmin can edit templates
    if (user?.role !== USER_ROLES.ADMIN && user?.role !== USER_ROLES.SUPERADMIN) {
      alert('You do not have permission to edit templates');
      return;
    }
    
    if (onNavigate && onEditTemplate) {
      onEditTemplate({
        ...template,
        isEditingTemplate: true,
        templateId: template._id
      });
      onNavigate('create-product');
    }
  };
  
  const handleDeleteTemplate = async (templateId) => {
    // Only admin/superadmin can delete templates
    if (user?.role !== USER_ROLES.ADMIN && user?.role !== USER_ROLES.SUPERADMIN) {
      alert('You do not have permission to delete templates');
      return;
    }
    
    if (confirm('Are you sure you want to delete this template?')) {
      try {
        const sessionId = localStorage.getItem('sessionId');
        if (!sessionId) {
          alert('Session expired. Please log in again.');
          return;
        }
        await Meteor.callAsync('templates.delete', templateId, sessionId);
      } catch (error) {
        console.error('Error deleting template:', error);
        alert('Failed to delete template: ' + error.message);
      }
    }
  };
  
  const handleCloneTemplate = async (template) => {
    try {
      const newName = prompt('Enter name for the cloned template:', `${template.name} (Copy)`);
      if (newName) {
        const sessionId = localStorage.getItem('sessionId');
        if (!sessionId) {
          alert('Session expired. Please log in again.');
          return;
        }
        await Meteor.callAsync('templates.clone', template._id, newName, sessionId);
      }
    } catch (error) {
      console.error('Error cloning template:', error);
      alert('Failed to clone template: ' + error.message);
    }
  };
  
  
  const getCategoryIcon = (category) => {
    const icons = {
      'built-in': '🏛️',
      'autocallables': '🎯',
      'capital-protected': '🛡️',
      'certificates': '📜',
      'custom': '✨',
      'uncategorized': '📁'
    };
    return icons[category?.toLowerCase()] || '📋';
  };
  
  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };
  
  if (isLoading()) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '400px',
        color: 'var(--text-secondary)'
      }}>
        Loading templates...
      </div>
    );
  }
  
  return (
    <div style={{
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '2rem'
    }}>
      {/* Header Section */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        padding: '3rem 2rem',
        borderRadius: '20px',
        marginBottom: '2rem',
        boxShadow: '0 10px 30px rgba(102, 126, 234, 0.3)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute',
          top: '-50%',
          right: '-10%',
          width: '300px',
          height: '300px',
          background: 'radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%)',
          borderRadius: '50%'
        }} />
        
        <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
          <h1 style={{
            margin: '0 0 1rem 0',
            fontSize: '2.5rem',
            fontWeight: '700',
            letterSpacing: '-0.02em'
          }}>
            Template Library
          </h1>
          <p style={{
            margin: '0 auto',
            fontSize: '1.1rem',
            opacity: 0.9,
            maxWidth: '600px',
            lineHeight: 1.6
          }}>
            Browse and manage product templates. Use pre-built structures or create your own custom templates.
          </p>
        </div>
      </div>
      
      {/* Controls Section */}
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: '16px',
        padding: '1.5rem',
        marginBottom: '2rem',
        border: '1px solid var(--border-color)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: '1rem',
          alignItems: 'center'
        }}>
          {/* Search Bar */}
          <input
            type="text"
            placeholder="Search templates by name or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              fontSize: '0.95rem',
              color: 'var(--text-primary)',
              outline: 'none',
              transition: 'all 0.2s'
            }}
          />
          
          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              fontSize: '0.95rem',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="all">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>
                {getCategoryIcon(category)} {category.charAt(0).toUpperCase() + category.slice(1).replace('-', ' ')}
              </option>
            ))}
          </select>
          
          {/* Sort Options */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              fontSize: '0.95rem',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="name">Sort by Name</option>
            <option value="createdAt">Sort by Date</option>
            <option value="category">Sort by Category</option>
          </select>
        </div>
      </div>
      
      {/* Stats Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-primary)' }}>
            {templates.length}
          </div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Total Templates
          </div>
        </div>
        
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: '#667eea' }}>
            {templates.filter(t => t.isBuiltIn).length}
          </div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Built-in Templates
          </div>
        </div>
        
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: '#10b981' }}>
            {templates.filter(t => !t.isBuiltIn).length}
          </div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Custom Templates
          </div>
        </div>
        
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid var(--border-color)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', fontWeight: '700', color: '#f59e0b' }}>
            {categories.length}
          </div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Categories
          </div>
        </div>
      </div>
      
      {/* Templates Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
        gap: '1.5rem'
      }}>
        {filteredTemplates.map(template => (
          <div
            key={template._id}
            style={{
              background: 'var(--bg-secondary)',
              borderRadius: '16px',
              padding: '1.5rem',
              border: '1px solid var(--border-color)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
              transition: 'all 0.3s',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.05)';
            }}
          >
            {/* Template Header */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{
                    margin: '0 0 0.5rem 0',
                    fontSize: '1.25rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    {getCategoryIcon(template.category)} {template.name}
                  </h3>
                  <p style={{
                    margin: 0,
                    fontSize: '0.875rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    {template.description || 'No description available'}
                  </p>
                  
                  {/* Template Tags */}
                  {template.tags && template.tags.length > 0 && (
                    <div style={{ 
                      marginTop: '0.5rem',
                      display: 'flex',
                      gap: '0.25rem',
                      flexWrap: 'wrap'
                    }}>
                      {template.tags.slice(0, 3).map(tag => (
                        <span
                          key={tag}
                          style={{
                            padding: '0.2rem 0.5rem',
                            background: 'rgba(102, 126, 234, 0.1)',
                            color: '#667eea',
                            borderRadius: '10px',
                            fontSize: '0.7rem',
                            fontWeight: '500'
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                      {template.tags.length > 3 && (
                        <span style={{
                          fontSize: '0.7rem',
                          color: 'var(--text-secondary)'
                        }}>
                          +{template.tags.length - 3} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
                
                {template.isBuiltIn && (
                  <span style={{
                    padding: '0.25rem 0.75rem',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    borderRadius: '20px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    letterSpacing: '0.05em'
                  }}>
                    BUILT-IN
                  </span>
                )}
              </div>
            </div>
            
            {/* Template Metadata */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '0.75rem',
              marginBottom: '1rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-color)'
            }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Components
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                  {template.droppedItems?.length || 0} items
                </div>
              </div>
              
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Created
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                  {formatDate(template.createdAt)}
                </div>
              </div>
              
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Version
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                  v{template.version || 1}
                </div>
              </div>
              
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Status
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: '600', color: template.isPublic ? '#10b981' : '#f59e0b' }}>
                  {template.isPublic ? 'Public' : 'Private'}
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: user?.role === USER_ROLES.ADMIN || user?.role === USER_ROLES.SUPERADMIN ? 'repeat(4, 1fr)' : '1fr 1fr',
              gap: '0.5rem'
            }}>
              <button
                onClick={() => handleUseTemplate(template)}
                style={{
                  padding: '0.5rem',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.25rem'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <span>📋</span> Use
              </button>
              
              <button
                onClick={() => handleCloneTemplate(template)}
                style={{
                  padding: '0.5rem',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.25rem'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-primary)';
                }}
              >
                <span>📑</span> Clone
              </button>
              
              {(user?.role === USER_ROLES.ADMIN || user?.role === USER_ROLES.SUPERADMIN) && (
                <>
                  <button
                    onClick={() => handleEditTemplate(template)}
                    style={{
                      padding: '0.5rem',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.25rem'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-tertiary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'var(--bg-primary)';
                    }}
                  >
                    <span>✏️</span> Edit
                  </button>
                  
                  {!template.isBuiltIn && (
                    <button
                      onClick={() => handleDeleteTemplate(template._id)}
                      style={{
                        padding: '0.5rem',
                        background: '#fee2e2',
                        color: '#dc2626',
                        border: '1px solid #fecaca',
                        borderRadius: '8px',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.25rem'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#fecaca';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#fee2e2';
                      }}
                    >
                      <span>🗑️</span> Delete
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Empty State */}
      {filteredTemplates.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          color: 'var(--text-secondary)'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📭</div>
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: '600' }}>
            No templates found
          </h3>
          <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.95rem' }}>
            {templates.length === 0 ? 
              'No templates exist. Create your own custom templates using the product builder.' :
              'Try adjusting your search or filter criteria'
            }
          </p>
          
          {/* Show debug info */}
          <div style={{
            marginTop: '2rem',
            padding: '1rem',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            fontSize: '0.875rem',
            color: 'var(--text-secondary)'
          }}>
            <div><strong>Debug Info:</strong></div>
            <div>Loading: {isLoading() ? 'Yes' : 'No'}</div>
            <div>Templates in DB: {templates.length}</div>
            <div>Filtered Templates: {filteredTemplates.length}</div>
            <div>Search Term: "{searchTerm}"</div>
            <div>Selected Category: {selectedCategory}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplateManagement;