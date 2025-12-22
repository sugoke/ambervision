import React, { useState, useMemo } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { NewslettersCollection } from '../api/newsletters';
import NewsletterUploader from './components/NewsletterUploader.jsx';

const MarketNews = ({ user }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Subscribe to newsletters
  const { newsletters, isLoading } = useTracker(() => {
    const handle = Meteor.subscribe('newsletters');
    return {
      newsletters: NewslettersCollection.find({}, { sort: { uploadedAt: -1 } }).fetch(),
      isLoading: !handle.ready()
    };
  }, []);

  // Check if user is admin
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  // Categories
  const categories = [
    { id: 'all', label: 'All', icon: '📰' },
    { id: 'market-update', label: 'Market Updates', icon: '📊' },
    { id: 'research', label: 'Research', icon: '🔬' },
    { id: 'news', label: 'News', icon: '📢' }
  ];

  // Filter and search newsletters
  const filteredNewsletters = useMemo(() => {
    let filtered = newsletters;

    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(n => n.category === selectedCategory);
    }

    // Filter by search term
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(n =>
        n.title.toLowerCase().includes(search) ||
        n.description.toLowerCase().includes(search)
      );
    }

    return filtered;
  }, [newsletters, selectedCategory, searchTerm]);

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Format date
  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // Handle download
  const handleDownload = (newsletter) => {
    Meteor.call('newsletters.incrementDownload', newsletter._id);
    window.open(newsletter.fileUrl, '_blank');
  };

  // Handle delete
  const handleDelete = async (newsletter) => {
    if (!confirm(`Are you sure you want to delete "${newsletter.title}"?`)) {
      return;
    }

    const sessionId = localStorage.getItem('sessionId');
    try {
      await Meteor.callAsync('newsletters.delete', newsletter._id, sessionId);
      console.log('Newsletter deleted successfully');
    } catch (error) {
      console.error('Error deleting newsletter:', error);
      alert('Failed to delete newsletter: ' + error.reason);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      {/* Header */}
      <div style={{
        marginBottom: '2rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <h1 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '1.8rem',
            fontWeight: '700',
            color: 'var(--text-primary)'
          }}>
            📰 Market News
          </h1>
          <p style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: '1rem'
          }}>
            Newsletters and market updates
          </p>
        </div>

        {/* Upload Button - Admin Only */}
        {isAdmin && (
          <button
            onClick={() => setShowUploadModal(true)}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: '0 2px 8px rgba(0, 123, 255, 0.3)',
              transition: 'all 0.2s ease'
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
            <span>📤</span>
            Upload Newsletter
          </button>
        )}
      </div>

      {/* Search and Filter Bar */}
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '2rem',
        border: '1px solid var(--border-color)'
      }}>
        {/* Search Input */}
        <input
          type="text"
          placeholder="Search newsletters..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            fontSize: '1rem',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            marginBottom: '1rem'
          }}
        />

        {/* Category Filters */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                padding: '0.5rem 1rem',
                border: selectedCategory === cat.id ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                borderRadius: '20px',
                background: selectedCategory === cat.id ? 'var(--accent-color)' : 'var(--bg-primary)',
                color: selectedCategory === cat.id ? 'white' : 'var(--text-primary)',
                fontSize: '0.9rem',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <span>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results Count */}
      <div style={{
        marginBottom: '1rem',
        color: 'var(--text-secondary)',
        fontSize: '0.9rem'
      }}>
        {filteredNewsletters.length} {filteredNewsletters.length === 1 ? 'newsletter' : 'newsletters'} found
      </div>

      {/* Loading State */}
      {isLoading && (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          color: 'var(--text-secondary)'
        }}>
          Loading newsletters...
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredNewsletters.length === 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '3rem',
          textAlign: 'center',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📭</div>
          <p style={{
            margin: '0 0 0.5rem 0',
            fontSize: '1.1rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            No newsletters found
          </p>
          <p style={{
            margin: 0,
            color: 'var(--text-secondary)'
          }}>
            {searchTerm || selectedCategory !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Check back later for updates'
            }
          </p>
        </div>
      )}

      {/* Newsletter Table */}
      {!isLoading && filteredNewsletters.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          overflow: 'hidden'
        }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse'
          }}>
            <thead>
              <tr style={{
                background: 'var(--bg-tertiary)',
                borderBottom: '2px solid var(--border-color)'
              }}>
                <th style={{
                  padding: '1rem',
                  textAlign: 'left',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  Title
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'left',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  Description
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'left',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap'
                }}>
                  Date
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'left',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap'
                }}>
                  Size
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'center',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap'
                }}>
                  Downloads
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'right',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap'
                }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredNewsletters.map((newsletter, index) => (
                <tr
                  key={newsletter._id}
                  style={{
                    borderBottom: index === filteredNewsletters.length - 1 ? 'none' : '1px solid var(--border-color)',
                    transition: 'background 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <td style={{
                    padding: '1rem',
                    fontSize: '0.95rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    {newsletter.title}
                  </td>
                  <td style={{
                    padding: '1rem',
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)',
                    maxWidth: '300px'
                  }}>
                    {newsletter.description}
                  </td>
                  <td style={{
                    padding: '1rem',
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap'
                  }}>
                    {formatDate(newsletter.uploadedAt)}
                  </td>
                  <td style={{
                    padding: '1rem',
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap'
                  }}>
                    {formatFileSize(newsletter.fileSize)}
                  </td>
                  <td style={{
                    padding: '1rem',
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                    textAlign: 'center'
                  }}>
                    {newsletter.downloadCount || 0}
                  </td>
                  <td style={{
                    padding: '1rem',
                    textAlign: 'right'
                  }}>
                    <div style={{
                      display: 'flex',
                      gap: '0.5rem',
                      justifyContent: 'flex-end'
                    }}>
                      <button
                        onClick={() => handleDownload(newsletter)}
                        style={{
                          padding: '0.5rem 1rem',
                          background: 'var(--accent-color)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.85rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.opacity = '0.9';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.opacity = '1';
                        }}
                      >
                        📥 Download
                      </button>

                      {isAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(newsletter);
                          }}
                          style={{
                            padding: '0.5rem 0.75rem',
                            background: 'var(--bg-tertiary)',
                            color: '#dc3545',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.target.style.background = '#dc3545';
                            e.target.style.color = 'white';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.background = 'var(--bg-tertiary)';
                            e.target.style.color = '#dc3545';
                          }}
                          title="Delete newsletter"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <NewsletterUploader
          onClose={() => setShowUploadModal(false)}
          user={user}
        />
      )}
    </div>
  );
};

export default MarketNews;
