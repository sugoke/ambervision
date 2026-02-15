import React, { useState, useEffect, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTheme } from '../ThemeContext.jsx';
import LiquidGlassCard from './LiquidGlassCard.jsx';

const PAGE_SIZE = 5;

const formatDate = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatDuration = (ms) => {
  if (!ms) return 'N/A';
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
};

const PortfolioReviewsList = ({ viewAsFilter, accountFilter, onOpenReview, onGenerateNew, refreshKey = 0, isGenerating = false, onCancelGeneration }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [langPickerOpen, setLangPickerOpen] = useState(false);

  const fetchReviews = useCallback(() => {
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) return;

    Meteor.callAsync('portfolioReview.list', sessionId, viewAsFilter, accountFilter)
      .then(result => {
        setReviews(result || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('[PortfolioReviewsList] Error loading reviews:', err);
        setLoading(false);
      });
  }, [viewAsFilter?.id, accountFilter]);

  // Initial fetch + re-fetch when refreshKey changes
  useEffect(() => {
    setLoading(true);
    fetchReviews();
  }, [fetchReviews, refreshKey]);

  // Auto-poll while a review is generating (every 5 seconds)
  useEffect(() => {
    if (!isGenerating) return;

    const pollInterval = setInterval(() => {
      fetchReviews();
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [isGenerating, fetchReviews]);

  // Reset page when reviews change significantly
  useEffect(() => {
    const totalPages = Math.ceil(reviews.length / PAGE_SIZE);
    if (page >= totalPages && totalPages > 0) {
      setPage(totalPages - 1);
    }
  }, [reviews.length, page]);

  const handleDelete = (e, reviewId) => {
    e.stopPropagation();
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) return;

    Meteor.callAsync('portfolioReview.delete', reviewId, sessionId)
      .then(() => {
        setReviews(prev => prev.filter(r => r._id !== reviewId));
      })
      .catch(err => {
        console.error('[PortfolioReviewsList] Delete failed:', err);
      });
  };

  const handleCancel = (e, reviewId) => {
    e.stopPropagation();
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) return;

    Meteor.callAsync('portfolioReview.cancel', reviewId, sessionId)
      .then(() => {
        fetchReviews();
        if (onCancelGeneration) onCancelGeneration();
      })
      .catch(err => {
        console.error('[PortfolioReviewsList] Cancel failed:', err);
      });
  };

  const getStatusBadge = (status, progress) => {
    const base = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.35rem',
      padding: '0.25rem 0.75rem',
      borderRadius: '12px',
      fontSize: '0.75rem',
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: '0.5px'
    };

    switch (status) {
      case 'generating':
        return (
          <span style={{ ...base, background: '#dbeafe', color: '#1d4ed8' }}>
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#3b82f6',
              animation: 'reviewPulse 1.5s infinite'
            }} />
            Generating
          </span>
        );
      case 'completed':
        return (
          <span style={{ ...base, background: '#dcfce7', color: '#166534' }}>
            Ready
          </span>
        );
      case 'cancelled':
        return (
          <span style={{ ...base, background: '#fef3c7', color: '#92400e' }}>
            Cancelled
          </span>
        );
      case 'failed':
        return (
          <span style={{ ...base, background: '#fef2f2', color: '#991b1b' }}>
            Failed
          </span>
        );
      default:
        return (
          <span style={{ ...base, background: '#f3f4f6', color: '#6b7280' }}>
            {status}
          </span>
        );
    }
  };

  if (loading && reviews.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading reviews...
      </div>
    );
  }

  const totalPages = Math.ceil(reviews.length / PAGE_SIZE);
  const pagedReviews = reviews.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      {/* Header with Generate button */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '0.75rem',
        padding: '0 1.25rem'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '1.1rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          Portfolio Reviews
          {reviews.length > 0 && (
            <span style={{ fontSize: '0.8rem', fontWeight: '400', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
              ({reviews.length})
            </span>
          )}
        </h3>
        <div style={{ position: 'relative', display: 'inline-flex' }}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setLangPickerOpen(false); }}
          tabIndex={-1}
        >
          <button
            onClick={() => !isGenerating && setLangPickerOpen(!langPickerOpen)}
            disabled={isGenerating}
            style={{
              padding: '0.5rem 1rem',
              background: isGenerating
                ? 'linear-gradient(135deg, #6b7280 0%, #9ca3af 100%)'
                : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: '600',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              opacity: isGenerating ? 0.7 : 1
            }}
          >
            {isGenerating ? 'Generating...' : '+ New Review ▾'}
          </button>
          {langPickerOpen && !isGenerating && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              background: isDark ? '#1f2937' : '#fff',
              border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 50,
              overflow: 'hidden',
              minWidth: '120px'
            }}>
              {[{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }].map(lang => (
                <button
                  key={lang.code}
                  onClick={() => {
                    setLangPickerOpen(false);
                    onGenerateNew(lang.code);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    color: isDark ? '#e5e7eb' : '#1e293b',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : '#f3f4f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {reviews.length === 0 ? (
        <LiquidGlassCard>
          <div style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            color: 'var(--text-muted)'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📋</div>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              No portfolio reviews yet. Generate your first review to prepare for client meetings.
            </p>
          </div>
        </LiquidGlassCard>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {pagedReviews.map(review => (
              <LiquidGlassCard key={review._id}>
                <div
                  style={{
                    padding: '0.75rem 1.25rem',
                    cursor: review.status === 'completed' ? 'pointer' : 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    transition: 'background 0.15s',
                    borderRadius: '8px',
                    minHeight: '48px'
                  }}
                  onClick={() => review.status === 'completed' && onOpenReview(review._id)}
                  onMouseEnter={e => {
                    if (review.status === 'completed') {
                      e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)';
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {/* Left: Date & Client */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.9rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      marginBottom: '0.25rem'
                    }}>
                      {formatDate(review.generatedAt)}
                    </div>
                    <div style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      gap: '0.75rem',
                      flexWrap: 'wrap'
                    }}>
                      <span>{review.clientName || 'Consolidated'}</span>
                      <span>{review.language === 'fr' ? 'FR' : 'EN'}</span>
                      {review.portfolioSnapshot && (
                        <span>{review.portfolioSnapshot.positionCount} positions</span>
                      )}
                    </div>
                  </div>

                  {/* Middle: Progress (if generating) */}
                  {review.status === 'generating' && review.progress && (
                    <div style={{
                      fontSize: '0.75rem',
                      color: '#3b82f6',
                      textAlign: 'center',
                      minWidth: '150px'
                    }}>
                      <div style={{ marginBottom: '0.3rem' }}>{review.progress.currentStepLabel}</div>
                      <div style={{
                        width: '100%',
                        height: '4px',
                        background: isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb',
                        borderRadius: '2px',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${((review.progress.completedSections || 0) / (review.progress.totalSections || 7)) * 100}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, #6366f1, #3b82f6)',
                          borderRadius: '2px',
                          transition: 'width 0.5s ease'
                        }} />
                      </div>
                    </div>
                  )}

                  {/* Middle: Error message (if failed) */}
                  {review.status === 'failed' && review.progress?.currentStepLabel && (
                    <div style={{
                      fontSize: '0.75rem',
                      color: '#ef4444',
                      maxWidth: '200px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {review.progress.currentStepLabel}
                    </div>
                  )}

                  {/* Right: Status, Time & Actions */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexShrink: 0
                  }}>
                    {review.processingTimeMs && review.status === 'completed' && (
                      <span style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)'
                      }}>
                        {formatDuration(review.processingTimeMs)}
                      </span>
                    )}
                    {getStatusBadge(review.status, review.progress)}
                    {/* Cancel button for generating reviews */}
                    {review.status === 'generating' && (
                      <button
                        onClick={(e) => handleCancel(e, review._id)}
                        title="Cancel generation"
                        style={{
                          width: '28px',
                          height: '28px',
                          border: 'none',
                          borderRadius: '6px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#ef4444',
                          fontSize: '1rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}
                      >
                        &#9632;
                      </button>
                    )}
                    {/* Delete button for completed/failed/cancelled reviews */}
                    {(review.status === 'completed' || review.status === 'failed' || review.status === 'cancelled') && (
                      <button
                        onClick={(e) => handleDelete(e, review._id)}
                        title="Delete review"
                        style={{
                          width: '28px',
                          height: '28px',
                          border: 'none',
                          borderRadius: '6px',
                          background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                          color: 'var(--text-muted)',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          opacity: 0.6,
                          transition: 'opacity 0.15s'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ef4444'; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = ''; }}
                      >
                        &#128465;
                      </button>
                    )}
                  </div>
                </div>
              </LiquidGlassCard>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.5rem',
              marginTop: '1rem'
            }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  padding: '0.35rem 0.6rem',
                  border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                  borderRadius: '6px',
                  background: isDark ? '#1f2937' : '#fff',
                  color: page === 0 ? (isDark ? '#4b5563' : '#d1d5db') : 'var(--text-primary)',
                  fontSize: '0.8rem',
                  cursor: page === 0 ? 'default' : 'pointer'
                }}
              >
                &lsaquo; Prev
              </button>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={{
                  padding: '0.35rem 0.6rem',
                  border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                  borderRadius: '6px',
                  background: isDark ? '#1f2937' : '#fff',
                  color: page >= totalPages - 1 ? (isDark ? '#4b5563' : '#d1d5db') : 'var(--text-primary)',
                  fontSize: '0.8rem',
                  cursor: page >= totalPages - 1 ? 'default' : 'pointer'
                }}
              >
                Next &rsaquo;
              </button>
            </div>
          )}
        </>
      )}

      {/* Pulse animation for generating badge */}
      <style>{`
        @keyframes reviewPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
};

export default PortfolioReviewsList;
