import React, { useEffect } from 'react';

/**
 * Infine Loan Calculator Page
 * Embeds the Infine Meteor app in a full-screen iframe
 * Accessible at /#infine without authentication
 */
const InfinePage = () => {
// GDPR: third-party analytics (counter.dev) removed — no consent mechanism existed
  // and visitor IPs were sent to an external processor on every page load.


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
