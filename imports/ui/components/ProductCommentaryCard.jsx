import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker, useSubscribe } from 'meteor/react-meteor-data';
import { ProductCommentaryCollection } from '/imports/api/riskAnalysis';

/**
 * Product Commentary Card Component
 * Displays AI-generated investment advisor commentary for a product
 */
const ProductCommentaryCard = ({ productId }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);

  // Subscribe to the latest commentary for this product
  const sessionId = localStorage.getItem('sessionId');
  useSubscribe('productCommentary', productId, sessionId);

  // Get the latest commentary
  const commentary = useTracker(() => {
    return ProductCommentaryCollection.findOne(
      { productId },
      { sort: { generatedAt: -1 } }
    );
  }, [productId]);

  const handleGenerateCommentary = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        throw new Error('No session found');
      }

      const result = await Meteor.callAsync('productCommentary.generate', productId, sessionId);
      console.log('[ProductCommentary] Generated successfully:', result);
    } catch (err) {
      console.error('[ProductCommentary] Generation failed:', err);
      setError(err.message || 'Failed to generate commentary');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      padding: '1.5rem',
      marginBottom: '2rem',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: commentary ? '1rem' : 0
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '1.2rem',
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          💬 Investment Commentary
        </h3>

        <button
          onClick={handleGenerateCommentary}
          disabled={isGenerating}
          style={{
            background: isGenerating
              ? 'var(--bg-muted)'
              : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
            color: isGenerating ? 'var(--text-muted)' : 'white',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '8px',
            fontSize: '0.9rem',
            fontWeight: '600',
            cursor: isGenerating ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.3s ease',
            boxShadow: isGenerating ? 'none' : '0 2px 8px rgba(139, 92, 246, 0.3)'
          }}
        >
          {isGenerating ? (
            <>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
              Generating...
            </>
          ) : (
            <>
              🤖 {commentary ? 'Regenerate' : 'Generate'} Commentary
            </>
          )}
        </button>
      </div>

      {error && (
        <div style={{
          background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
          border: '1px solid #f87171',
          borderRadius: '8px',
          padding: '1rem',
          marginTop: '1rem',
          color: '#dc2626',
          fontSize: '0.9rem'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {commentary && (
        <div style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1.5rem',
          marginTop: '1rem'
        }}>
          <div style={{
            fontSize: '0.95rem',
            lineHeight: '1.7',
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap'
          }}>
            {commentary.commentary}
          </div>

          <div style={{
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)'
          }}>
            <span>
              Generated: {new Date(commentary.generatedAt).toLocaleString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
            <span style={{
              background: 'rgba(139, 92, 246, 0.1)',
              color: '#8b5cf6',
              padding: '4px 8px',
              borderRadius: '4px',
              fontWeight: '600'
            }}>
              🤖 AI Generated
            </span>
          </div>
        </div>
      )}

      {!commentary && !isGenerating && !error && (
        <div style={{
          textAlign: 'center',
          padding: '2rem 1rem',
          color: 'var(--text-secondary)',
          fontSize: '0.9rem'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>💬</div>
          <p style={{ margin: 0 }}>
            No commentary generated yet. Click the button above to generate a client-ready investment commentary using AI.
          </p>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default ProductCommentaryCard;
