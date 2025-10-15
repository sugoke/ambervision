import React, { useState, useRef, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { AmberConversationsCollection } from '../api/amberConversations';

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

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
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
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      width: '100%',
      maxWidth: '450px',
      height: '100vh',
      background: 'var(--bg-primary)',
      borderLeft: '1px solid var(--border-color)',
      boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      transition: 'transform 0.3s ease'
    }}>
      {/* Header */}
      <div style={{
        padding: '1.5rem',
        borderBottom: '1px solid var(--border-color)',
        background: 'linear-gradient(135deg, #b65f23 0%, #c76d2f 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
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
            <div style={{
              fontSize: '0.95rem',
              fontWeight: '700',
              color: 'white'
            }}>
              Amber AI
            </div>
            <div style={{
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
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
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
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {msg.content}
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
      <div style={{
        padding: '1rem',
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)'
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

      {/* CSS for typing animation */}
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
      `}</style>
    </div>
  );
};

export default AmberChat;
