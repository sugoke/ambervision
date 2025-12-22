import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';

/**
 * UnderlyingNews Component
 *
 * Displays latest news articles for a specific underlying asset from EOD API.
 * News is fetched on component mount for better performance during product evaluation.
 * Compact, collapsible design that fits well within report templates.
 */
const UnderlyingNews = ({ ticker }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [news, setNews] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Parse ticker to extract symbol and exchange
  const parseTickerInfo = (ticker) => {
    if (!ticker) return { symbol: null, exchange: null };

    if (ticker.includes('.')) {
      const [symbol, exchange] = ticker.split('.');
      return { symbol, exchange };
    }

    return { symbol: ticker, exchange: null };
  };

  // Fetch news on component mount
  useEffect(() => {
    const fetchNews = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { symbol, exchange } = parseTickerInfo(ticker);

        if (!symbol) {
          throw new Error('Invalid ticker format');
        }

        // Fetch 2 latest news articles using existing Meteor method
        const newsData = await Meteor.callAsync('eod.getSecurityNews', symbol, exchange, 2);
        setNews(newsData || []);
      } catch (err) {
        console.error(`Failed to fetch news for ${ticker}:`, err);
        setError(err.message || 'Failed to load news');
        setNews([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNews();
  }, [ticker]);

  // Loading state
  if (isLoading) {
    return (
      <div style={{
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '0.75rem 1rem',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <span style={{ fontSize: '1rem' }}>📰</span>
          <span style={{
            fontSize: '0.9rem',
            fontWeight: '600',
            color: 'var(--text-secondary)'
          }}>
            Loading news for {ticker}...
          </span>
          <div style={{
            width: '16px',
            height: '16px',
            border: '2px solid var(--border-color)',
            borderTop: '2px solid var(--accent-color)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginLeft: 'auto'
          }}></div>
        </div>
      </div>
    );
  }

  // Error state with retry
  if (error) {
    return (
      <div style={{
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1rem' }}>⚠️</span>
            <span style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              fontStyle: 'italic'
            }}>
              Could not load news for {ticker}
            </span>
          </div>
          <button
            onClick={() => {
              setIsLoading(true);
              setError(null);
              // Trigger re-fetch by changing a dependency
              const { symbol, exchange } = parseTickerInfo(ticker);
              Meteor.callAsync('eod.getSecurityNews', symbol, exchange, 2)
                .then(newsData => {
                  setNews(newsData || []);
                  setError(null);
                })
                .catch(err => {
                  setError(err.message || 'Failed to load news');
                  setNews([]);
                })
                .finally(() => setIsLoading(false));
            }}
            style={{
              padding: '4px 10px',
              fontSize: '0.75rem',
              background: 'var(--accent-color)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500',
              transition: 'opacity 0.2s ease'
            }}
            onMouseEnter={(e) => e.target.style.opacity = '0.8'}
            onMouseLeave={(e) => e.target.style.opacity = '1'}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (!news || news.length === 0) {
    return (
      <div style={{
        padding: '0.75rem',
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        border: '1px solid var(--border-color)',
        fontSize: '0.85rem',
        color: 'var(--text-muted)',
        fontStyle: 'italic',
        textAlign: 'center'
      }}>
        No recent news available for {ticker}
      </div>
    );
  }

  // Normal display with news
  return (
    <div style={{
      background: 'var(--bg-tertiary)',
      borderRadius: '8px',
      border: '1px solid var(--border-color)',
      overflow: 'hidden'
    }}>
      {/* Header - Click to expand/collapse */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '0.75rem 1rem',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          borderBottom: isExpanded ? '1px solid var(--border-color)' : 'none',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          transition: 'all 0.2s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)';
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <span style={{ fontSize: '1rem' }}>📰</span>
          <span style={{
            fontSize: '0.9rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Latest News for {ticker}
          </span>
          <span style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            background: 'var(--bg-primary)',
            padding: '2px 6px',
            borderRadius: '10px'
          }}>
            {news.length} {news.length === 1 ? 'article' : 'articles'}
          </span>
        </div>
        <span style={{
          fontSize: '0.9rem',
          color: 'var(--text-secondary)',
          transition: 'transform 0.2s ease',
          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
        }}>
          ▼
        </span>
      </div>

      {/* News Articles - Collapsible */}
      {isExpanded && (
        <div style={{
          padding: '0.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem'
        }}>
          {news.map((article, index) => {
            // Extract sentiment value (handle both string and object formats)
            const sentimentValue = typeof article.sentiment === 'string'
              ? article.sentiment
              : article.sentiment?.polarity || 'neutral';

            return (
            <div
              key={index}
              style={{
                padding: '1rem',
                background: 'var(--bg-primary)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 123, 255, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(0, 123, 255, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
            >
              {/* Article Title */}
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '0.95rem',
                  fontWeight: '600',
                  color: 'var(--accent-color)',
                  textDecoration: 'none',
                  display: 'block',
                  marginBottom: '0.5rem',
                  lineHeight: '1.4'
                }}
                onMouseEnter={(e) => {
                  e.target.style.textDecoration = 'underline';
                }}
                onMouseLeave={(e) => {
                  e.target.style.textDecoration = 'none';
                }}
              >
                {article.title}
              </a>

              {/* Article Date */}
              {article.date && (
                <div style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '0.5rem'
                }}>
                  {new Date(article.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              )}

              {/* Article Content Excerpt */}
              {article.content && (
                <div style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.5',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {article.content}
                </div>
              )}

              {/* Sentiment Badge (if available) */}
              {article.sentiment && (
                <div style={{
                  marginTop: '0.5rem',
                  display: 'inline-block'
                }}>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '4px 8px',
                    borderRadius: '10px',
                    background: sentimentValue === 'positive' ? '#d1fae5' :
                               sentimentValue === 'negative' ? '#fee2e2' : '#f3f4f6',
                    color: sentimentValue === 'positive' ? '#059669' :
                           sentimentValue === 'negative' ? '#dc2626' : '#6b7280',
                    fontWeight: '600',
                    textTransform: 'capitalize'
                  }}>
                    {sentimentValue}
                  </span>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UnderlyingNews;
