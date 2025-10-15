import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTheme } from './ThemeContext.jsx';
import BirthdayCalendar from './BirthdayCalendar.jsx';

// Mini-app: Email Tester
const EmailTester = ({ isDark }) => {
  const [email, setEmail] = useState('sugoke@hotmail.com');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const sendTestEmail = () => {
    if (!email) {
      setResult({ success: false, message: 'Please enter an email address' });
      return;
    }

    setSending(true);
    setResult(null);

    const sessionId = localStorage.getItem('sessionId');

    Meteor.call('email.sendTest', email, sessionId, (error, response) => {
      setSending(false);

      if (error) {
        console.error('Email send error:', error);
        setResult({
          success: false,
          message: error.reason || error.message || 'Failed to send test email'
        });
      } else {
        console.log('Email sent successfully:', response);
        setResult({
          success: true,
          message: response.message || 'Test email sent successfully!',
          messageId: response.messageId,
          timestamp: response.timestamp
        });
      }
    });
  };

  return (
    <div style={{
      maxWidth: '600px',
      margin: '0 auto'
    }}>
      <div style={{
        background: isDark ? 'var(--bg-secondary)' : 'white',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '2rem',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
      }}>
        <div style={{
          textAlign: 'center',
          marginBottom: '2rem'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📧</div>
          <h2 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '1.5rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Email Service Tester
          </h2>
          <p style={{
            margin: 0,
            fontSize: '0.95rem',
            color: 'var(--text-muted)'
          }}>
            Test your MailerSend email configuration
          </p>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{
            display: 'block',
            marginBottom: '0.5rem',
            fontSize: '0.9rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Recipient Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email address"
            disabled={sending}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '1rem',
              border: `2px solid ${isDark ? 'var(--border-color)' : '#e5e7eb'}`,
              borderRadius: '8px',
              background: sending ? 'var(--bg-tertiary)' : (isDark ? 'var(--bg-tertiary)' : 'white'),
              color: 'var(--text-primary)',
              outline: 'none',
              transition: 'border-color 0.2s ease',
              boxSizing: 'border-box',
              opacity: sending ? 0.6 : 1,
              cursor: sending ? 'not-allowed' : 'text'
            }}
            onFocus={(e) => !sending && (e.target.style.borderColor = 'var(--accent-color)')}
            onBlur={(e) => e.target.style.borderColor = isDark ? 'var(--border-color)' : '#e5e7eb'}
          />
        </div>

        <button
          onClick={sendTestEmail}
          disabled={sending}
          style={{
            width: '100%',
            padding: '1rem',
            fontSize: '1rem',
            fontWeight: '600',
            border: 'none',
            borderRadius: '8px',
            cursor: sending ? 'not-allowed' : 'pointer',
            background: sending
              ? '#9ca3af'
              : 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            color: 'white',
            transition: 'all 0.2s ease',
            boxShadow: sending ? 'none' : '0 2px 8px rgba(0, 123, 255, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem'
          }}
          onMouseEnter={(e) => {
            if (!sending) {
              e.target.style.transform = 'translateY(-2px)';
              e.target.style.boxShadow = '0 4px 12px rgba(0, 123, 255, 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (!sending) {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 2px 8px rgba(0, 123, 255, 0.3)';
            }
          }}
        >
          {sending ? (
            <>
              <div style={{
                width: '16px',
                height: '16px',
                border: '2px solid white',
                borderTop: '2px solid transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></div>
              Sending...
            </>
          ) : (
            <>
              📤 Send Test Email
            </>
          )}
        </button>

        {result && (
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem 1.25rem',
            borderRadius: '8px',
            fontSize: '0.9rem',
            background: result.success
              ? 'rgba(40, 167, 69, 0.1)'
              : 'rgba(220, 53, 69, 0.1)',
            border: `1px solid ${result.success
              ? 'rgba(40, 167, 69, 0.3)'
              : 'rgba(220, 53, 69, 0.3)'}`,
            color: result.success
              ? '#28a745'
              : '#dc3545'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: result.success && result.messageId ? '0.75rem' : 0
            }}>
              <span style={{ fontSize: '1.2rem' }}>
                {result.success ? '✅' : '❌'}
              </span>
              <strong>{result.message}</strong>
            </div>
            {result.success && result.messageId && (
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                paddingLeft: '1.7rem'
              }}>
                Message ID: {result.messageId}
                {result.timestamp && (
                  <div>Sent at: {new Date(result.timestamp).toLocaleString()}</div>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{
          marginTop: '2rem',
          padding: '1rem',
          background: isDark ? 'var(--bg-tertiary)' : '#f8f9fa',
          borderRadius: '8px',
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
          lineHeight: '1.6'
        }}>
          <strong style={{ color: 'var(--text-secondary)' }}>ℹ️ How it works:</strong>
          <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0 }}>
            <li>Sends a test email using the MailerSend service</li>
            <li>Verifies your email configuration is working</li>
            <li>Returns the message ID for tracking</li>
            <li>Check your spam folder if you don't see it</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

// Mini-app: Pitch Manager
const PitchManager = ({ isDark }) => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  // Sample pitch templates - in production, these would come from a database
  const pitchTemplates = [
    {
      id: 1,
      category: 'real-estate',
      title: 'Real Estate Agent Partnership',
      description: 'Pitch for partnering with real estate agents',
      content: `Dear [Agent Name],

I hope this message finds you well. I am reaching out from Amber Lake Partners to explore a potential partnership opportunity.

We specialize in structured financial products and have a strong track record of working with high-net-worth individuals in the real estate sector. Our clients often require sophisticated investment solutions that complement their property portfolios.

We believe there is a strong synergy between our services and your client base. We would be delighted to discuss how we can work together to provide comprehensive financial solutions to your clients.

Would you be available for a brief call next week to explore this further?

Best regards,
[Your Name]
Amber Lake Partners`
    },
    {
      id: 2,
      category: 'bank',
      title: 'Bank Collaboration Proposal',
      description: 'Initial outreach to banking institutions',
      content: `Dear [Bank Representative],

I am writing to introduce Amber Lake Partners and explore potential collaboration opportunities in the structured products space.

Our firm specializes in designing and managing bespoke structured financial products for institutional and private clients. We have extensive experience with:
- Autocallable products
- Capital protection structures
- Yield enhancement solutions
- Custom derivative strategies

We believe our expertise could complement your product offering and provide additional value to your clients. We would welcome the opportunity to discuss how we might work together.

Could we schedule a meeting to explore this further?

Best regards,
[Your Name]
Amber Lake Partners`
    },
    {
      id: 3,
      category: 'client',
      title: 'New Client Welcome',
      description: 'Welcome message for onboarding new clients',
      content: `Dear [Client Name],

Welcome to Amber Lake Partners! We are delighted to have you as a client and look forward to working with you.

Your dedicated relationship manager is [RM Name], who will be your primary point of contact. [He/She] will reach out shortly to schedule an introductory meeting and discuss your investment objectives.

In the meantime, you can access your portfolio dashboard at [URL]. If you have any questions, please don't hesitate to reach out.

We look forward to a successful partnership.

Warm regards,
[Your Name]
Amber Lake Partners`
    },
    {
      id: 4,
      category: 'product',
      title: 'Product Presentation Introduction',
      description: 'Introduction email when presenting a new structured product',
      content: `Dear [Client Name],

I hope you are doing well. I wanted to share an interesting investment opportunity that aligns well with your portfolio objectives.

We have structured a [Product Type] that offers:
- [Key Feature 1]
- [Key Feature 2]
- [Key Feature 3]

Key Details:
- Underlying: [Underlying Assets]
- Term: [Duration]
- Protection Level: [Barrier Level]%
- Potential Return: [Coupon Rate]% per annum

I have attached a detailed termsheet for your review. Would you be available for a call this week to discuss this opportunity in detail?

Best regards,
[Your Name]
Amber Lake Partners`
    },
    {
      id: 5,
      category: 'follow-up',
      title: 'Client Follow-Up',
      description: 'Follow-up after meeting or proposal',
      content: `Dear [Client Name],

Thank you for taking the time to meet with me [yesterday/last week]. I enjoyed our discussion about [topic].

As promised, I am following up on [specific items discussed]:
1. [Action item 1]
2. [Action item 2]
3. [Action item 3]

Please let me know if you need any additional information or clarification. I am happy to schedule another call to address any questions you may have.

Looking forward to hearing from you.

Best regards,
[Your Name]
Amber Lake Partners`
    },
    {
      id: 6,
      category: 'internal',
      title: 'Team Meeting Request',
      description: 'Internal email for scheduling team meetings',
      content: `Hi Team,

I would like to schedule a meeting to discuss [topic/project].

Proposed agenda:
- [Agenda item 1]
- [Agenda item 2]
- [Agenda item 3]

Please let me know your availability for [time range] this week. I will send out a calendar invite once we confirm a time that works for everyone.

Thanks,
[Your Name]`
    }
  ];

  const categories = [
    { id: 'all', label: 'All Templates', icon: '📋' },
    { id: 'real-estate', label: 'Real Estate', icon: '🏠' },
    { id: 'bank', label: 'Banking', icon: '🏦' },
    { id: 'client', label: 'Client Relations', icon: '🤝' },
    { id: 'product', label: 'Products', icon: '📊' },
    { id: 'follow-up', label: 'Follow-ups', icon: '📧' },
    { id: 'internal', label: 'Internal', icon: '👥' }
  ];

  const filteredPitches = pitchTemplates.filter(pitch => {
    const matchesCategory = selectedCategory === 'all' || pitch.category === selectedCategory;
    const matchesSearch = pitch.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         pitch.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return (
    <div>
      {/* Search Bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <input
          type="text"
          placeholder="Search pitch templates..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            fontSize: '1rem',
            border: `2px solid ${isDark ? 'var(--border-color)' : '#e5e7eb'}`,
            borderRadius: '8px',
            background: isDark ? 'var(--bg-tertiary)' : 'white',
            color: 'var(--text-primary)',
            outline: 'none',
            transition: 'border-color 0.2s ease'
          }}
          onFocus={(e) => e.target.style.borderColor = 'var(--accent-color)'}
          onBlur={(e) => e.target.style.borderColor = isDark ? 'var(--border-color)' : '#e5e7eb'}
        />
      </div>

      {/* Category Filters */}
      <div style={{
        display: 'flex',
        gap: '0.75rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap'
      }}>
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.9rem',
              fontWeight: '500',
              border: 'none',
              borderRadius: '20px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: selectedCategory === cat.id
                ? 'var(--accent-color)'
                : isDark ? 'var(--bg-tertiary)' : '#f3f4f6',
              color: selectedCategory === cat.id
                ? 'white'
                : 'var(--text-primary)',
              boxShadow: selectedCategory === cat.id
                ? '0 2px 8px rgba(0, 123, 255, 0.3)'
                : 'none'
            }}
            onMouseEnter={(e) => {
              if (selectedCategory !== cat.id) {
                e.target.style.background = isDark ? 'var(--bg-secondary)' : '#e5e7eb';
              }
            }}
            onMouseLeave={(e) => {
              if (selectedCategory !== cat.id) {
                e.target.style.background = isDark ? 'var(--bg-tertiary)' : '#f3f4f6';
              }
            }}
          >
            {cat.icon} {cat.label}
          </button>
        ))}
      </div>

      {/* Pitch Templates Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
        gap: '1.5rem'
      }}>
        {filteredPitches.map(pitch => (
          <div
            key={pitch.id}
            style={{
              background: isDark ? 'var(--bg-secondary)' : 'white',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1.5rem',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
            }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'start',
              marginBottom: '0.75rem'
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '1.1rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                {pitch.title}
              </h3>
              <button
                onClick={() => copyToClipboard(pitch.content, pitch.id)}
                style={{
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  background: copiedId === pitch.id
                    ? '#10b981'
                    : 'var(--accent-color)',
                  color: 'white',
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap'
                }}
                onMouseEnter={(e) => {
                  if (copiedId !== pitch.id) {
                    e.target.style.background = '#0056b3';
                  }
                }}
                onMouseLeave={(e) => {
                  if (copiedId !== pitch.id) {
                    e.target.style.background = 'var(--accent-color)';
                  }
                }}
              >
                {copiedId === pitch.id ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>
            <p style={{
              margin: '0 0 1rem 0',
              fontSize: '0.9rem',
              color: 'var(--text-muted)',
              fontStyle: 'italic'
            }}>
              {pitch.description}
            </p>
            <div style={{
              background: isDark ? 'var(--bg-tertiary)' : '#f8f9fa',
              borderRadius: '8px',
              padding: '1rem',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              maxHeight: '200px',
              overflowY: 'auto',
              lineHeight: '1.6',
              border: `1px solid ${isDark ? 'var(--border-color)' : '#e5e7eb'}`
            }}>
              {pitch.content}
            </div>
          </div>
        ))}
      </div>

      {filteredPitches.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>🔍</div>
          <p style={{ fontSize: '1.1rem', margin: 0 }}>
            No pitch templates found matching your search.
          </p>
        </div>
      )}
    </div>
  );
};

const Intranet = ({ user }) => {
  const { theme, isDark } = useTheme();
  const [activeApp, setActiveApp] = useState('pitch-manager');

  // Define available mini-apps
  const miniApps = [
    {
      id: 'pitch-manager',
      label: 'Pitch Manager',
      icon: '📝',
      description: 'Reusable pitch templates'
    },
    {
      id: 'birthday-calendar',
      label: 'Birthday Calendar',
      icon: '🎂',
      description: 'Track team & client birthdays'
    },
    {
      id: 'email-tester',
      label: 'Email Tester',
      icon: '📧',
      description: 'Test email service configuration'
    },
    {
      id: 'coming-soon-1',
      label: 'Coming Soon',
      icon: '🚀',
      description: 'More tools on the way',
      disabled: true
    }
  ];

  const renderActiveApp = () => {
    switch (activeApp) {
      case 'pitch-manager':
        return <PitchManager isDark={isDark} />;
      case 'birthday-calendar':
        return <BirthdayCalendar user={user} />;
      case 'email-tester':
        return <EmailTester isDark={isDark} />;
      default:
        return (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            color: 'var(--text-muted)'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚧</div>
            <h2 style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)' }}>
              Coming Soon
            </h2>
            <p style={{ margin: 0, fontSize: '1rem' }}>
              This mini-app is under development.
            </p>
          </div>
        );
    }
  };

  return (
    <div style={{
      minHeight: 'calc(100vh - 200px)',
      padding: '2rem',
      background: isDark ? 'var(--bg-primary)' : 'rgba(255, 255, 255, 0.95)',
      backdropFilter: 'blur(10px)'
    }}>
      {/* Header */}
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        marginBottom: '2rem'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1rem'
        }}>
          <div style={{
            fontSize: '2.5rem',
            background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            🏢
          </div>
          <h1 style={{
            margin: 0,
            fontSize: '2rem',
            fontWeight: '700',
            color: 'var(--text-primary)',
            background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            Intranet
          </h1>
        </div>
        <p style={{
          margin: 0,
          fontSize: '1.1rem',
          color: 'var(--text-muted)',
          lineHeight: '1.6'
        }}>
          Internal team workspace • Welcome, {user.email}
        </p>
      </div>

      {/* Mini-Apps Navigation */}
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto 2rem',
        background: isDark ? 'var(--bg-secondary)' : 'white',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '0.5rem',
        display: 'flex',
        gap: '0.5rem',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        overflowX: 'auto'
      }}>
        {miniApps.map(app => (
          <button
            key={app.id}
            onClick={() => !app.disabled && setActiveApp(app.id)}
            disabled={app.disabled}
            style={{
              flex: '0 0 auto',
              padding: '0.75rem 1.5rem',
              fontSize: '0.95rem',
              fontWeight: '600',
              border: 'none',
              borderRadius: '8px',
              cursor: app.disabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              background: activeApp === app.id
                ? 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)'
                : 'transparent',
              color: activeApp === app.id
                ? 'white'
                : app.disabled
                  ? 'var(--text-muted)'
                  : 'var(--text-primary)',
              opacity: app.disabled ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: activeApp === app.id
                ? '0 2px 8px rgba(0, 123, 255, 0.3)'
                : 'none'
            }}
            onMouseEnter={(e) => {
              if (!app.disabled && activeApp !== app.id) {
                e.target.style.background = isDark ? 'var(--bg-tertiary)' : '#f3f4f6';
              }
            }}
            onMouseLeave={(e) => {
              if (!app.disabled && activeApp !== app.id) {
                e.target.style.background = 'transparent';
              }
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>{app.icon}</span>
            {app.label}
          </button>
        ))}
      </div>

      {/* Active Mini-App Content */}
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto'
      }}>
        {renderActiveApp()}
      </div>
    </div>
  );
};

export default Intranet;
