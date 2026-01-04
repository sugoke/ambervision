import React, { useState, useEffect } from 'react';

/**
 * Landing Page - Marketing landing page for US citizens
 * Accessible at /#landing without authentication
 */
const LandingPage = () => {
  // Load Counter.dev analytics script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdn.counter.dev/script.js';
    script.setAttribute('data-id', '6eab4d24-5529-4548-b0aa-738a003e0169');
    script.setAttribute('data-utcoffset', '2');
    script.async = true;
    document.body.appendChild(script);

    return () => {
      // Cleanup on unmount
      document.body.removeChild(script);
    };
  }, []);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    countryCode: '+1' // Default to US
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);
  const [emailError, setEmailError] = useState(null);

  // Common country codes for the target audience
  const countryCodes = [
    { code: '+1', country: 'US/CA', flag: '🇺🇸' },
    { code: '+44', country: 'UK', flag: '🇬🇧' },
    { code: '+33', country: 'FR', flag: '🇫🇷' },
    { code: '+41', country: 'CH', flag: '🇨🇭' },
    { code: '+377', country: 'MC', flag: '🇲🇨' },
    { code: '+49', country: 'DE', flag: '🇩🇪' },
    { code: '+39', country: 'IT', flag: '🇮🇹' },
    { code: '+34', country: 'ES', flag: '🇪🇸' },
    { code: '+351', country: 'PT', flag: '🇵🇹' },
    { code: '+31', country: 'NL', flag: '🇳🇱' },
    { code: '+32', country: 'BE', flag: '🇧🇪' },
    { code: '+352', country: 'LU', flag: '🇱🇺' },
    { code: '+43', country: 'AT', flag: '🇦🇹' },
    { code: '+972', country: 'IL', flag: '🇮🇱' },
    { code: '+971', country: 'UAE', flag: '🇦🇪' },
    { code: '+65', country: 'SG', flag: '🇸🇬' },
    { code: '+852', country: 'HK', flag: '🇭🇰' },
  ];

  // Email validation regex
  const validateEmail = (email) => {
    if (!email) return true; // Empty is OK (phone can be used instead)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // Clear email error when user types
    if (name === 'email') {
      setEmailError(null);
    }
  };

  const handleEmailBlur = () => {
    if (formData.email && !validateEmail(formData.email)) {
      setEmailError('Please enter a valid email address');
    } else {
      setEmailError(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    // Validate email format
    if (formData.email && !validateEmail(formData.email)) {
      setEmailError('Please enter a valid email address');
      setIsSubmitting(false);
      return;
    }

    try {
      // Format phone with country code
      const formattedPhone = formData.phone
        ? `${formData.countryCode} ${formData.phone.replace(/^0+/, '')}` // Remove leading zeros
        : null;

      // Send form data via Meteor method
      const result = await new Promise((resolve, reject) => {
        Meteor.call('landing.submitContactForm', {
          name: formData.name,
          email: formData.email || null,
          phone: formattedPhone
        }, (error, result) => {
          if (error) reject(error);
          else resolve(result);
        });
      });

      setSubmitStatus({ type: 'success', message: result.message });
      setFormData({ name: '', email: '', phone: '', countryCode: '+1' });
    } catch (error) {
      console.error('Form submission error:', error);
      setSubmitStatus({
        type: 'error',
        message: error.reason || 'Something went wrong. Please try again or contact us directly.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Hero Section */}
      <section style={styles.hero}>
        <a href="https://amberlakepartners.com" target="_blank" rel="noopener noreferrer">
          <img
            src="https://amberlakepartners.com/assets/logos/1.png"
            alt="Amberlake Partners"
            style={styles.logo}
          />
        </a>
        <h1 style={styles.heroTitle}>
          Ready to Invest in Europe?<br/>
          <span style={styles.heroTitleHighlight}>Get Your Free Expert Consultation Today.</span>
        </h1>
        <p style={styles.heroText}>
          We've helped dozens of US citizens navigate European wealth management.
          Leave your contact info to schedule a 1-on-1 session with Amberlake Partners.
        </p>

        <form style={styles.heroForm} onSubmit={handleSubmit}>
          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <input
                type="text"
                name="name"
                placeholder="Your name"
                value={formData.name}
                onChange={handleInputChange}
                required
                style={styles.input}
              />
            </div>
          </div>
          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <input
                type="email"
                name="email"
                placeholder="Email address"
                value={formData.email}
                onChange={handleInputChange}
                onBlur={handleEmailBlur}
                style={{
                  ...styles.input,
                  borderColor: emailError ? '#f87171' : 'rgba(255, 255, 255, 0.15)'
                }}
              />
              {emailError && (
                <p style={styles.inputError}>{emailError}</p>
              )}
            </div>
          </div>
          <div style={styles.formRow}>
            <div style={styles.phoneGroup}>
              <select
                name="countryCode"
                value={formData.countryCode}
                onChange={handleInputChange}
                style={styles.countrySelect}
              >
                {countryCodes.map(({ code, country, flag }) => (
                  <option key={code} value={code}>
                    {flag} {code}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                name="phone"
                placeholder="Phone number"
                value={formData.phone}
                onChange={handleInputChange}
                style={styles.phoneInput}
              />
            </div>
          </div>
          <button
            type="submit"
            style={{
              ...styles.btn,
              opacity: isSubmitting ? 0.7 : 1,
              cursor: isSubmitting ? 'wait' : 'pointer'
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Sending...' : 'Get in Touch'}
          </button>

          {submitStatus?.type === 'success' && (
            <div style={styles.successMessage}>
              <i className="fas fa-check-circle" style={{ marginRight: '8px' }}></i>
              {submitStatus.message}
            </div>
          )}
          {submitStatus?.type === 'error' && (
            <p style={{ ...styles.formNote, color: '#f87171' }}>
              <i className="fas fa-exclamation-circle" style={{ marginRight: '8px' }}></i>
              {submitStatus.message}
            </p>
          )}
          {!submitStatus && (
            <p style={styles.formNote}>
              Enter email or phone number — we'll contact you shortly.
            </p>
          )}

          <div style={styles.privacyNote}>
            <i className="fas fa-shield-alt" style={{ marginRight: '8px', color: '#DD772A' }}></i>
            Your privacy matters. We will never share your information with third parties or contact you unnecessarily.
            <br />
            <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>
              Regulated by CCAF in Monaco and SEC in the United States.
            </span>
          </div>
        </form>

        <div style={styles.heroContact}>
          <a href="tel:+37792001712" style={styles.contactLink}>
            <i className="fas fa-phone" style={styles.contactIcon}></i> +377 92 00 17 12
          </a>
          <a href="https://wa.me/37792001712" target="_blank" rel="noopener noreferrer" style={styles.contactLink}>
            <i className="fab fa-whatsapp" style={styles.contactIcon}></i> WhatsApp
          </a>
          <a href="mailto:contact@amberlakepartners.com" style={styles.contactLink}>
            <i className="fas fa-envelope" style={styles.contactIcon}></i> contact@amberlakepartners.com
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer style={styles.footer}>
        <p style={styles.footerText}>
          © 2025 Amberlake Partners. All rights reserved. | {' '}
          <a href="https://amberlakepartners.com" target="_blank" rel="noopener noreferrer" style={styles.footerLink}>
            Visit Main Site
          </a>
        </p>
      </footer>

      {/* Load Font Awesome */}
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      />
      {/* Load Poppins font */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#1A2B40',
    color: '#FFFFFF',
    fontFamily: "'Poppins', sans-serif",
    lineHeight: 1.6,
    margin: 0,
    padding: 0,
  },
  hero: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    textAlign: 'center',
    padding: '40px 20px',
    position: 'relative',
    background: 'linear-gradient(rgba(26, 43, 64, 0.85), rgba(26, 43, 64, 0.9)), url("https://amberlakepartners.com/assets/img/headers/header-1.jpg") center/cover no-repeat',
  },
  logo: {
    maxWidth: '180px',
    marginBottom: '25px',
  },
  heroTitle: {
    fontSize: '2.8rem',
    fontWeight: 300,
    marginBottom: '15px',
    lineHeight: 1.2,
  },
  heroTitleHighlight: {
    color: '#DD772A',
    fontWeight: 500,
  },
  heroText: {
    fontSize: '1.1rem',
    color: '#B0BEC5',
    maxWidth: '600px',
    marginBottom: '25px',
    fontWeight: 300,
  },
  heroForm: {
    background: 'rgba(255, 255, 255, 0.08)',
    padding: '25px 30px',
    borderRadius: '10px',
    width: '100%',
    maxWidth: '450px',
    marginBottom: '20px',
  },
  formRow: {
    display: 'flex',
    gap: '15px',
    marginBottom: '15px',
  },
  formGroup: {
    flex: 1,
  },
  input: {
    width: '100%',
    padding: '12px 15px',
    background: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '5px',
    color: '#FFFFFF',
    fontFamily: "'Poppins', sans-serif",
    fontSize: '0.95rem',
    outline: 'none',
    boxSizing: 'border-box',
  },
  inputError: {
    color: '#f87171',
    fontSize: '0.75rem',
    marginTop: '5px',
    marginBottom: 0,
  },
  phoneGroup: {
    display: 'flex',
    gap: '10px',
    flex: 1,
    width: '100%',
  },
  countrySelect: {
    width: '100px',
    minWidth: '100px',
    flexShrink: 0,
    padding: '12px 8px',
    background: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '5px',
    color: '#FFFFFF',
    fontFamily: "'Poppins', sans-serif",
    fontSize: '0.9rem',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23B0BEC5' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    paddingRight: '25px',
    boxSizing: 'border-box',
  },
  phoneInput: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    padding: '12px 15px',
    background: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '5px',
    color: '#FFFFFF',
    fontFamily: "'Poppins', sans-serif",
    fontSize: '0.95rem',
    outline: 'none',
    boxSizing: 'border-box',
  },
  btn: {
    width: '100%',
    padding: '14px',
    background: '#DD772A',
    color: '#1A2B40',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '1rem',
    transition: 'all 0.3s ease',
    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
    borderRadius: '3px',
    fontFamily: "'Poppins', sans-serif",
  },
  formNote: {
    fontSize: '0.8rem',
    color: '#B0BEC5',
    marginTop: '10px',
    marginBottom: 0,
  },
  successMessage: {
    marginTop: '15px',
    padding: '15px',
    background: 'rgba(74, 222, 128, 0.15)',
    border: '1px solid rgba(74, 222, 128, 0.3)',
    borderRadius: '8px',
    color: '#4ade80',
    fontSize: '0.95rem',
    fontWeight: 500,
    textAlign: 'center',
  },
  privacyNote: {
    marginTop: '20px',
    padding: '12px 15px',
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '6px',
    fontSize: '0.75rem',
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 1.5,
  },
  heroContact: {
    marginTop: '25px',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '25px',
  },
  contactLink: {
    color: '#FFFFFF',
    textDecoration: 'none',
    fontSize: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    transition: 'color 0.3s ease',
  },
  contactIcon: {
    fontSize: '1.2rem',
    color: '#DD772A',
  },
  footer: {
    padding: '40px 10%',
    textAlign: 'center',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
  },
  footerText: {
    color: '#B0BEC5',
    fontSize: '0.9rem',
    fontWeight: 300,
    margin: 0,
  },
  footerLink: {
    color: '#DD772A',
    textDecoration: 'none',
    transition: 'opacity 0.3s ease',
  },
};

export default LandingPage;
