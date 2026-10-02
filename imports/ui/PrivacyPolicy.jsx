import React from 'react';

/**
 * Privacy policy — accessible unauthenticated at /#privacy.
 *
 * DRAFT for legal review: the factual content (data categories, processors,
 * retention windows) reflects the August 2026 GDPR audit of this codebase and
 * must be kept in sync when processors or retention settings change.
 */
const PrivacyPolicy = () => {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <p style={styles.eyebrow}>Ambervision — Privacy Policy</p>
        <h1 style={styles.title}>How we handle personal data</h1>
        <p style={styles.draft}>DRAFT — pending legal review</p>

        <h2 style={styles.h2}>Who we are</h2>
        <p style={styles.p}>
          Ambervision is operated by Amberlake Partners, which acts as data controller for the
          personal data processed on this platform. Contact: <a href="mailto:mf@amberlakepartners.com" style={styles.a}>mf@amberlakepartners.com</a>.
        </p>

        <h2 style={styles.h2}>What we process, and why</h2>
        <ul style={styles.ul}>
          <li><strong>Client identification and KYC data</strong> (identity, contact details, nationality, tax status, identification documents, beneficial owners) — processed to meet legal obligations (AML/CFT, FATCA) and to perform the wealth-management mandate.</li>
          <li><strong>Financial data</strong> (accounts, positions, transactions, orders) — processed to perform the mandate and meet record-keeping obligations.</li>
          <li><strong>Relationship records</strong> (meeting reports, order correspondence) — processed on the basis of legitimate interest in documenting advice given.</li>
          <li><strong>Technical data</strong> (login sessions including IP address and browser identifier) — processed for the security of the platform.</li>
          <li><strong>Prospect contact details</strong> submitted through our contact form — processed on the basis of your consent, which you may withdraw at any time.</li>
        </ul>

        <h2 style={styles.h2}>Processors we rely on</h2>
        <ul style={styles.ul}>
          <li><strong>Hosting and database</strong> — our application and database are hosted on European infrastructure.</li>
          <li><strong>Anthropic</strong> (AI assistance) — portfolio analysis, document extraction, drafting support and the in-app assistant. Prompts are minimised: client identity is pseudonymised where the feature allows it.</li>
          <li><strong>SendPulse</strong> (email delivery) — notification and report emails to you and to our staff.</li>
          <li><strong>Market data providers</strong> (EOD Historical Data, SIX/Telekurs, CBonds and similar) — receive only instrument identifiers, never personal data.</li>
        </ul>

        <h2 style={styles.h2}>How long we keep data</h2>
        <ul style={styles.ul}>
          <li>Client identification and financial records — for the duration of the relationship plus the retention period required by AML/CFT law.</li>
          <li>Prospect contact-form submissions — 12 months.</li>
          <li>Login session records — 7 to 30 days.</li>
          <li>Technical logs — 20 minutes to 90 days depending on the log.</li>
          <li>Raw bank statement files — 24 months after ingestion.</li>
        </ul>

        <h2 style={styles.h2}>Your rights</h2>
        <p style={styles.p}>
          You may request access to, rectification of, or erasure of your personal data, restriction
          of or objection to its processing, and a portable copy of the data you provided. Where
          processing rests on consent, you may withdraw it at any time. Financial records that we
          are legally required to keep are pseudonymised rather than deleted when you exercise your
          right to erasure. To exercise any right, write to <a href="mailto:mf@amberlakepartners.com" style={styles.a}>mf@amberlakepartners.com</a>.
          You may also lodge a complaint with your supervisory authority.
        </p>

        <h2 style={styles.h2}>Cookies and tracking</h2>
        <p style={styles.p}>
          The platform uses only strictly necessary storage: a session token that keeps you signed
          in, and interface preferences stored in your browser. There are no analytics or
          advertising trackers, and no data is shared with social networks.
        </p>

        <p style={styles.footer}>Last updated: August 2026</p>
        <p style={styles.footer}><a href="/" style={styles.a}>← Back to Ambervision</a></p>
      </div>
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    background: 'var(--page-bg, #0E1014)',
    color: 'var(--text-color, #F5F1E8)',
    fontFamily: "var(--font-sans, 'Instrument Sans', sans-serif)",
    padding: '48px 20px',
    display: 'flex',
    justifyContent: 'center'
  },
  card: {
    maxWidth: '760px',
    width: '100%',
    background: 'var(--card-bg, #171A21)',
    borderRadius: 'var(--radius, 12px)',
    boxShadow: 'var(--card-shadow, 0 2px 16px rgba(0,0,0,0.3))',
    padding: '40px 36px'
  },
  eyebrow: {
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    fontSize: '11px',
    color: 'var(--accent-strong, #E0A138)',
    margin: '0 0 8px'
  },
  title: {
    fontFamily: "var(--font-serif, 'Newsreader', serif)",
    fontSize: '32px',
    fontWeight: 500,
    margin: '0 0 4px'
  },
  draft: {
    fontSize: '12px',
    opacity: 0.6,
    fontStyle: 'italic',
    margin: '0 0 24px'
  },
  h2: {
    fontFamily: "var(--font-serif, 'Newsreader', serif)",
    fontSize: '20px',
    fontWeight: 500,
    margin: '28px 0 8px'
  },
  p: { fontSize: '14px', lineHeight: 1.7, margin: '0 0 12px', opacity: 0.92 },
  ul: { fontSize: '14px', lineHeight: 1.7, margin: '0 0 12px', paddingLeft: '20px', opacity: 0.92 },
  a: { color: 'var(--accent-strong, #E0A138)', textDecoration: 'none' },
  footer: { fontSize: '12px', opacity: 0.6, marginTop: '24px', marginBottom: 0 }
};

export default PrivacyPolicy;
