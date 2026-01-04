import React, { useEffect } from 'react';

/**
 * Infine Loan Calculator Page
 * Embeds the Infine Meteor app in a full-screen iframe
 * Accessible at /#infine without authentication
 */
const InfinePage = () => {
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

  return (
    <div style={styles.container}>
      <iframe
        src="https://infine.eu.meteorapp.com"
        title="Amberlake Infine Loan Calculator"
        style={styles.iframe}
      />
    </div>
  );
};

const styles = {
  container: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    padding: 0,
    overflow: 'hidden',
  },
  iframe: {
    border: 'none',
    width: '100%',
    height: '100%',
  },
};

export default InfinePage;
