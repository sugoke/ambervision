import React, { useState } from 'react';

/**
 * UnderlyingNews Component
 *
 * Displays latest news articles for a specific underlying asset from EOD API.
 * Compact, collapsible design that fits well within report templates.
 */
const UnderlyingNews = ({ ticker, news }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // If no news available, show empty state
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
