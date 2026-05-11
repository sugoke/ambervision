import React, { useEffect, useState, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import Login from './Login.jsx';

/**
 * OAuth consent page.
 *
 * Invoked when our /authorize endpoint redirects the browser here with a
 * ?req=<reqId> param. We show the requesting client, the user signs in
 * if needed, then explicitly approves — at which point we get a redirect
 * URL back to the OAuth client with the auth code.
 */
export default function OAuthConsent({ user, onUserChange }) {
  const [reqId, setReqId] = useState(null);
  const [request, setRequest] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ready | approving | redirecting | error

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('req');
    if (!id) {
      setLoadError('Missing authorization request id');
      setStatus('error');
      return;
    }
    setReqId(id);
  }, []);

  useEffect(() => {
    if (!reqId) return;
    (async () => {
      try {
        const res = await Meteor.callAsync('oauth.getAuthorizationRequest', reqId);
        setRequest(res);
        setStatus('ready');
      } catch (err) {
        setLoadError(err.reason || err.message);
        setStatus('error');
      }
    })();
  }, [reqId]);

  const redirectTo = useCallback((url) => {
    setStatus('redirecting');
    // Absolute navigation — leaves the SPA
    window.location.href = url;
  }, []);

  const handleApprove = async () => {
    if (!reqId) return;
    setSubmitting(true);
    setStatus('approving');
    try {
      const sessionId = localStorage.getItem('sessionId');
      const res = await Meteor.callAsync('oauth.approveAuthorization', sessionId, reqId);
      redirectTo(res.redirectUrl);
    } catch (err) {
      setLoadError(err.reason || err.message);
      setStatus('error');
      setSubmitting(false);
    }
  };

  const handleDeny = async () => {
    if (!reqId) return;
    setSubmitting(true);
    try {
      const sessionId = localStorage.getItem('sessionId');
      const res = await Meteor.callAsync('oauth.denyAuthorization', sessionId, reqId);
      redirectTo(res.redirectUrl);
    } catch (err) {
      setLoadError(err.reason || err.message);
      setSubmitting(false);
    }
  };

  const containerStyle = {
    maxWidth: '520px',
    margin: '60px auto',
    padding: '2rem',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '16px',
    boxShadow: '0 4px 20px var(--shadow)',
    color: 'var(--text-primary)'
  };

  if (status === 'loading') {
    return <div style={containerStyle}>Loading authorization request…</div>;
  }

  if (status === 'error') {
    return (
      <div style={containerStyle}>
        <h2 style={{ marginTop: 0 }}>Authorization error</h2>
        <p style={{ color: '#dc2626' }}>{loadError}</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          You can close this window.
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={containerStyle}>
        <h2 style={{ marginTop: 0 }}>Sign in to continue</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          <strong>{request?.client?.clientName || 'An application'}</strong> wants to
          access your Ambervision portfolio. Sign in to review and approve.
        </p>
        <Login onUserChange={onUserChange} compact={false} />
      </div>
    );
  }

  const scopes = request?.scopes && request.scopes.length ? request.scopes : ['portfolio'];
  const clientHost = (() => {
    try { return new URL(request?.redirectUri).host; } catch { return null; }
  })();

  return (
    <div style={containerStyle}>
      <h2 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Authorize access</h2>
      <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.95rem' }}>
        Signed in as <strong>{user.email || user.username}</strong>
      </p>

      <div style={{
        marginTop: '1.5rem',
        padding: '1rem',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '10px'
      }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          {request?.client?.clientName || 'Unknown application'}
        </div>
        {clientHost && (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            will be redirected to <code>{clientHost}</code>
          </div>
        )}
        <div style={{ fontSize: '0.9rem', marginTop: '0.75rem' }}>
          This app will be able to:
        </div>
        <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <li>Read your portfolio, holdings, cash balance, and orders</li>
          <li>See only the data you see when signed in — nothing more</li>
          <li>Not place orders or modify any data</li>
        </ul>
        {scopes.length > 0 && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Scopes: {scopes.join(', ')}
          </div>
        )}
      </div>

      <div style={{
        marginTop: '1rem',
        padding: '0.75rem 1rem',
        background: 'rgba(245, 158, 11, 0.08)',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        borderRadius: '8px',
        fontSize: '0.85rem',
        color: 'var(--text-secondary)'
      }}>
        You can revoke access any time from <strong>My Profile → API Access → Connected apps</strong>.
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
        <button
          onClick={handleDeny}
          disabled={submitting}
          style={{
            flex: 1,
            padding: '0.75rem',
            background: 'transparent',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            cursor: submitting ? 'wait' : 'pointer',
            fontSize: '0.95rem'
          }}
        >Deny</button>
        <button
          onClick={handleApprove}
          disabled={submitting}
          style={{
            flex: 2,
            padding: '0.75rem',
            background: 'var(--accent-color)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: submitting ? 'wait' : 'pointer',
            fontSize: '0.95rem',
            fontWeight: 500,
            opacity: submitting ? 0.7 : 1
          }}
        >{status === 'approving' || status === 'redirecting' ? 'Approving…' : `Allow ${request?.client?.clientName || 'application'}`}</button>
      </div>
    </div>
  );
}
