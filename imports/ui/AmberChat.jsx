import React, { useState, useRef, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { AmberConversationsCollection } from '../api/amberConversations';

/**
 * Simple markdown renderer for chat messages
 * Converts **bold**, *italic*, ### headers, and - bullet lists
 */
const renderMarkdown = (text) => {
  if (!text) return null;

  // Split by lines to handle headers and lists
  const lines = text.split('\n');
  const elements = [];
  let currentList = [];

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} style={{ margin: '0.5rem 0', paddingLeft: '1.25rem' }}>
          {currentList.map((item, i) => (
            <li key={i} style={{ marginBottom: '0.25rem' }}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  const renderInlineMarkdown = (line) => {
    // Process inline formatting: **bold** and *italic*
    const parts = [];
    let remaining = line;
    let key = 0;

    while (remaining.length > 0) {
      // Check for **bold**
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      if (boldMatch && boldMatch.index === 0) {
        parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // Check for *italic* (but not **)
      const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
      if (italicMatch && italicMatch.index === 0) {
        parts.push(<em key={key++}>{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }

      // Find next formatting marker
      const nextBold = remaining.indexOf('**');
      const nextItalic = remaining.search(/(?<!\*)\*(?!\*)/);
      let nextMarker = -1;

      if (nextBold !== -1 && (nextItalic === -1 || nextBold < nextItalic)) {
        nextMarker = nextBold;
      } else if (nextItalic !== -1) {
        nextMarker = nextItalic;
      }

      if (nextMarker === -1) {
        parts.push(remaining);
        break;
      } else if (nextMarker > 0) {
        parts.push(remaining.slice(0, nextMarker));
        remaining = remaining.slice(nextMarker);
      } else {
        // No match at start, move one character
        parts.push(remaining[0]);
        remaining = remaining.slice(1);
      }
    }

    return parts;
  };

  lines.forEach((line, index) => {
    // Check for headers
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <div key={index} style={{ fontWeight: '600', fontSize: '0.9rem', marginTop: '0.75rem', marginBottom: '0.25rem' }}>
          {renderInlineMarkdown(line.slice(4))}
        </div>
      );
    } else if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <div key={index} style={{ fontWeight: '600', fontSize: '0.95rem', marginTop: '0.75rem', marginBottom: '0.25rem' }}>
          {renderInlineMarkdown(line.slice(3))}
        </div>
      );
    } else if (line.startsWith('# ')) {
      flushList();
      elements.push(
        <div key={index} style={{ fontWeight: '700', fontSize: '1rem', marginTop: '0.75rem', marginBottom: '0.25rem' }}>
          {renderInlineMarkdown(line.slice(2))}
        </div>
      );
    } else if (line.match(/^[-•]\s/)) {
      // Bullet list item
      currentList.push(line.slice(2));
    } else if (line.trim() === '') {
      flushList();
      elements.push(<div key={index} style={{ height: '0.5rem' }} />);
    } else {
      flushList();
      elements.push(
        <div key={index} style={{ marginBottom: '0.25rem' }}>
          {renderInlineMarkdown(line)}
        </div>
      );
    }
  });

  flushList();
  return elements;
};

/**
 * AmberChat Component
 *
 * Chat interface for Amber AI assistant with:
 * - Real-time conversation display
 * - Message history
 * - Typing indicators
 * - Token usage tracking (for admins)
 * - Mobile-responsive design
 */
const AmberChat = ({ isOpen, onClose, currentUser }) => {
  const [conversationId, setConversationId] = useState(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Get current user ID from prop
  const currentUserId = currentUser?._id || currentUser?.id;

  // Get authentication session ID
  const authSessionId = localStorage.getItem('sessionId');

  // Subscribe to current conversation
  const { conversation, isReady } = useTracker(() => {
    if (!conversationId || !authSessionId) {
      return { conversation: null, isReady: true };
    }

    const handle = Meteor.subscribe('amber.conversation', conversationId, authSessionId);
    const conv = AmberConversationsCollection.findOne({ sessionId: conversationId });

    return {
      conversation: conv,
      isReady: handle.ready()
    };
  }, [conversationId, authSessionId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [conversation?.messages]);

  // Focus input when opened and handle body scroll
  useEffect(() => {
    if (isOpen) {
      // Prevent body scroll on mobile when chat is open
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';

      if (inputRef.current) {
        inputRef.current.focus();
      }
    } else {
      // Restore body scroll
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }

    return () => {
      // Cleanup on unmount
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [isOpen]);

  // Initialize conversation ID on mount when user is available
  useEffect(() => {
    if (!conversationId && currentUserId) {
      const newConversationId = `amber-${currentUserId}-${Date.now()}`;
      setConversationId(newConversationId);
    }
  }, [currentUserId, conversationId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = () => {
    if (!message.trim() || isLoading) return;

    const userMessage = message.trim();
    setMessage('');
    setError(null);
    setIsLoading(true);

    Meteor.call('amber.chat', userMessage, conversationId, authSessionId, (err, response) => {
      setIsLoading(false);

      if (err) {
        console.error('Amber chat error:', err);
        setError(err.reason || 'Failed to send message. Please try again.');
        return;
      }

      // Update conversation ID if this was the first message
      if (!conversationId && response.sessionId) {
        setConversationId(response.sessionId);
      }
    });
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = () => {
    if (!currentUserId) return;
    const newConversationId = `amber-${currentUserId}-${Date.now()}`;
    setConversationId(newConversationId);
    setMessage('');
    setError(null);
  };

  if (!isOpen) return null;

  const messages = conversation?.messages || [];

  return (
    <div className="amber-chat-panel" style={{
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      width: '100%',
      maxWidth: '450px',
      height: '100vh',
      background: 'var(--bg-primary)',
      borderLeft: '1px solid var(--border-color)',
      boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      transition: 'transform 0.3s ease',
      overflow: 'hidden',
      WebkitOverflowScrolling: 'touch'
    }}>
      {/* Header */}
      <div className="amber-chat-header" style={{
        padding: '1.5rem',
        borderBottom: '1px solid var(--border-color)',
        background: 'linear-gradient(135deg, #b65f23 0%, #c76d2f 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="amber-chat-avatar" style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem'
          }}>
            🔮
          </div>
          <div>
            <div className="amber-chat-title" style={{
              fontSize: '0.95rem',
              fontWeight: '700',
              color: 'white'
            }}>
              Amber AI
            </div>
            <div className="amber-chat-subtitle" style={{
              fontSize: '0.7rem',
              color: 'rgba(255, 255, 255, 0.85)'
            }}>
              Your Investment Assistant
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleNewConversation}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '6px',
              padding: '0.5rem 0.75rem',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: '500',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.2)';
            }}
            title="Start new conversation"
          >
            New Chat
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '6px',
              width: '36px',
              height: '36px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '1.2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.2)';
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="amber-chat-messages" style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        minHeight: 0
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '3rem 1.5rem',
            color: 'var(--text-muted)'
          }}>
            <div style={{
              fontSize: '2.5rem',
              marginBottom: '1rem'
            }}>
              👋
            </div>
            <div style={{
              fontSize: '0.95rem',
              fontWeight: '600',
              marginBottom: '0.5rem',
              color: 'var(--text-primary)'
            }}>
              Hi! I'm Amber
            </div>
            <div style={{
              fontSize: '0.8rem',
              lineHeight: '1.5'
            }}>
              I can help you understand your structured product portfolio, answer questions about upcoming observations, and explain payoff scenarios.
            </div>
            <div style={{
              marginTop: '1.5rem',
              padding: '1rem',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              textAlign: 'left',
              fontSize: '0.75rem'
            }}>
              <div style={{
                fontWeight: '600',
                marginBottom: '0.5rem',
                color: 'var(--text-primary)'
              }}>
                Try asking:
              </div>
              <ul style={{
                margin: 0,
                paddingLeft: '1.5rem',
                color: 'var(--text-secondary)'
              }}>
                <li>What observations do I have coming up?</li>
                <li>Explain my Phoenix products</li>
                <li>What's my capital protection status?</li>
                <li>Tell me about [ISIN]</li>
              </ul>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg._id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              animation: 'fadeIn 0.3s ease'
            }}
          >
            <div style={{
              maxWidth: '80%',
              padding: '0.65rem 0.85rem',
              borderRadius: '12px',
              background: msg.role === 'user'
                ? 'linear-gradient(135deg, #b65f23 0%, #c76d2f 100%)'
                : 'var(--bg-secondary)',
              color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
              fontSize: '0.85rem',
              lineHeight: '1.5',
              wordBreak: 'break-word'
            }}>
              {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
            </div>
            <div style={{
              fontSize: '0.65rem',
              color: 'var(--text-muted)',
              marginTop: '0.25rem',
              display: 'flex',
              gap: '0.5rem'
            }}>
              {new Date(msg.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
              {msg.tokens && msg.tokens.cached > 0 && (
                <span title="Used cached context">⚡ cached</span>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-start'
          }}>
            <div style={{
              padding: '0.65rem 0.85rem',
              borderRadius: '12px',
              background: 'var(--bg-secondary)',
              fontSize: '0.85rem'
            }}>
              <div style={{
                display: 'flex',
                gap: '0.3rem',
                alignItems: 'center'
              }}>
                <span className="typing-dot" style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'var(--text-muted)',
                  animation: 'typing 1.4s infinite'
                }}></span>
                <span className="typing-dot" style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'var(--text-muted)',
                  animation: 'typing 1.4s infinite 0.2s'
                }}></span>
                <span className="typing-dot" style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'var(--text-muted)',
                  animation: 'typing 1.4s infinite 0.4s'
                }}></span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            padding: '0.65rem 0.85rem',
            borderRadius: '8px',
            background: '#fee2e2',
            color: '#dc2626',
            fontSize: '0.75rem',
            border: '1px solid #fca5a5'
          }}>
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="amber-chat-input" style={{
        padding: '1rem',
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        flexShrink: 0
      }}>
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'flex-end'
        }}>
          <textarea
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask Amber anything..."
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '0.65rem 0.85rem',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              fontFamily: 'inherit',
              resize: 'none',
              minHeight: '40px',
              maxHeight: '120px',
              outline: 'none',
              transition: 'border-color 0.2s ease'
            }}
            onFocus={(e) => {
              e.target.style.borderColor = '#b65f23';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'var(--border-color)';
            }}
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || isLoading}
            style={{
              padding: '0.65rem 1.25rem',
              borderRadius: '12px',
              border: 'none',
              background: (!message.trim() || isLoading)
                ? 'var(--bg-tertiary)'
                : 'linear-gradient(135deg, #b65f23 0%, #c76d2f 100%)',
              color: 'white',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: (!message.trim() || isLoading) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              opacity: (!message.trim() || isLoading) ? 0.5 : 1,
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={(e) => {
              if (message.trim() && !isLoading) {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 4px 12px rgba(182, 95, 35, 0.3)';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = 'none';
            }}
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
        <div style={{
          marginTop: '0.5rem',
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          textAlign: 'center'
        }}>
          Press Enter to send • Shift+Enter for new line
        </div>
      </div>

      {/* CSS for typing animation and mobile responsiveness */}
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes typing {
          0%, 60%, 100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          30% {
            transform: translateY(-10px);
            opacity: 1;
          }
        }

        /* Base panel styles */
        .amber-chat-panel {
          -webkit-overflow-scrolling: touch;
        }

        /* iOS safe area support */
        @supports (padding: max(0px)) {
          .amber-chat-panel {
            padding-left: max(0px, env(safe-area-inset-left));
            padding-right: max(0px, env(safe-area-inset-right));
          }

          .amber-chat-header {
            padding-top: max(1.5rem, env(safe-area-inset-top)) !important;
          }

          .amber-chat-input {
            padding-bottom: max(1rem, env(safe-area-inset-bottom)) !important;
          }
        }

        /* Mobile responsiveness - Comprehensive styling */
        @media (max-width: 768px) {
          .amber-chat-panel {
            max-width: 100% !important;
            left: 0 !important;
            right: 0 !important;
            border-left: none !important;
            box-shadow: none !important;
            /* Use viewport height with fallback */
            height: 100vh !important;
            height: -webkit-fill-available !important;
            min-height: -webkit-fill-available !important;
          }

          /* Compact header on mobile */
          .amber-chat-header {
            padding: 0.75rem 1rem !important;
          }

          .amber-chat-avatar {
            width: 32px !important;
            height: 32px !important;
            fontSize: 1.2rem !important;
          }

          .amber-chat-title {
            fontSize: 0.85rem !important;
          }

          .amber-chat-subtitle {
            font-size: 0.65rem !important;
          }

          /* Compact messages area on mobile */
          .amber-chat-messages {
            padding: 0.75rem !important;
            gap: 0.5rem !important;
            -webkit-overflow-scrolling: touch !important;
          }

          /* Compact input area on mobile */
          .amber-chat-input {
            padding: 0.75rem !important;
          }
        }

        /* Extra small devices */
        @media (max-width: 480px) {
          .amber-chat-header {
            padding: 0.65rem 0.85rem !important;
          }

          .amber-chat-messages {
            padding: 0.65rem !important;
          }

          .amber-chat-input {
            padding: 0.65rem !important;
          }
        }

        /* iOS-specific fixes */
        @supports (-webkit-touch-callout: none) {
          .amber-chat-panel {
            height: -webkit-fill-available !important;
            min-height: -webkit-fill-available !important;
          }
        }
      `}</style>
    </div>
  );
};

export default AmberChat;
