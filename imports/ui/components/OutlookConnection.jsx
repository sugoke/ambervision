import React, { useCallback, useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';

/**
 * Profile -> Mailbox tab: connect / disconnect the signed-in user's own Outlook
 * mailbox over Microsoft Graph.
 *
 * Connecting is a full-page navigation to login.microsoftonline.com rather than
 * a popup: minting the OAuth state needs a server round-trip first, so a
 * window.open() after that await is outside the click gesture and popup
 * blockers eat it. The session token lives in localStorage and survives the
 * navigation, and the callback returns the browser to this tab.
 */

const RETURN_TO = '/profile';

const formatDate = d => {
  if (!d) return '-';
  try { return new Date(d).toLocaleString(); } catch { return String(d); }
};

// Short, fixed codes set by server/msgraph/callbackHandler.js. Nothing from
// Microsoft or the query string is ever rendered directly.
const CALLBACK_ERRORS = {
  denied: 'Sign-in was cancelled or refused at Microsoft. Nothing was connected.',
  invalid: 'That sign-in link was already used or is no longer valid. Please try connecting again.',
  expired: 'The sign-in took too long and expired. Please try connecting again.',
  session: 'Your Ambervision session changed during sign-in. Please sign in again, then reconnect.',
  ratelimited: 'Too many attempts. Please wait a moment and try again.',
  failed: 'The connection could not be completed. Please try again, or contact support if it persists.'
};

export default function OutlookConnection() {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sessionId = localStorage.getItem('sessionId');
      const cfg = await Meteor.callAsync('msgraph.config');
      setConfig(cfg);
      if (cfg?.configured) {
        setStatus(await Meteor.callAsync('msgraph.status', sessionId));
      }
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Surface the outcome of a redirect back from Microsoft, then strip the query
  // so a refresh does not replay the message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('mail');
    const mailError = params.get('mailError');
    if (!connected && !mailError) return;

    if (connected === 'connected') setNotice('Your Outlook mailbox is connected.');
    if (mailError) setError(CALLBACK_ERRORS[mailError] || CALLBACK_ERRORS.failed);

    params.delete('mail');
    params.delete('mailError');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, []);

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const sessionId = localStorage.getItem('sessionId');
      const { authorizeUrl } = await Meteor.callAsync('msgraph.beginConnect', sessionId, RETURN_TO);
      window.location.href = authorizeUrl;
    } catch (err) {
      setError(err.reason || err.message);
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm(
      'Disconnect your Outlook mailbox?\n\n' +
      'Ambervision will stop reading your mail and you will go back to dragging emails in ' +
      'and opening drafts in Outlook. Nothing already attached to an order is removed.'
    )) return;

    setBusy(true);
    setError(null);
    try {
      await Meteor.callAsync('msgraph.disconnect', localStorage.getItem('sessionId'));
      setNotice('Your Outlook mailbox has been disconnected.');
      await refresh();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setBusy(false);
    }
  };

  const boxStyle = {
    background: 'var(--bg-secondary)',
    borderRadius: '12px',
    padding: '1.5rem',
    border: '1px solid var(--border-color)',
    marginBottom: '1.5rem'
  };

  const buttonStyle = (variant) => ({
    padding: '0.7rem 1.25rem',
    background: variant === 'danger' ? 'transparent' : 'var(--accent-color)',
    color: variant === 'danger' ? '#dc2626' : 'white',
    border: variant === 'danger' ? '1px solid #dc2626' : 'none',
    borderRadius: '6px',
    fontSize: '0.9rem',
    fontWeight: 500,
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.6 : 1
  });

  if (loading) {
    return <div style={{ ...boxStyle, color: 'var(--text-muted)' }}>Loading...</div>;
  }

  const isConnected = status?.connected;
  const needsReconsent = status?.needsReconsent;

  return (
    <div>
      <div style={boxStyle}>
        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
          Outlook Mailbox
        </h3>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Connect your own Outlook mailbox to attach emails to orders without dragging them out
          of Outlook first, and to send orders to banks directly from Ambervision. Mail is sent
          from your own address and appears in your own Sent Items. Only messages you explicitly
          pick are ever stored &mdash; your mailbox is never copied or indexed.
        </p>
      </div>

      {notice && (
        <div style={{ ...boxStyle, borderColor: 'var(--gain-color)', background: 'rgba(16, 185, 129, 0.06)', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
          {notice}
        </div>
      )}

      {error && (
        <div style={{ ...boxStyle, borderColor: '#dc2626', background: 'rgba(220, 38, 38, 0.06)', color: '#b91c1c', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {!config?.configured && (
        <div style={{ ...boxStyle, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Outlook integration is not configured on this server. Email attachments and order emails
          continue to work through drag-and-drop and downloaded drafts.
        </div>
      )}

      {config?.configured && config?.keyMissing && (
        <div style={{ ...boxStyle, borderColor: 'var(--warning-color)', background: 'rgba(245, 158, 11, 0.06)', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
          Outlook cannot be connected: this server has no mailbox-token encryption key configured
          (<code>MSGRAPH_TOKEN_ENCRYPTION_KEY</code>). Credentials are never stored unencrypted, so
          connecting is blocked until an administrator sets it.
        </div>
      )}

      {config?.configured && config?.devBlocked && (
        <div style={{ ...boxStyle, borderColor: 'var(--warning-color)', background: 'rgba(245, 158, 11, 0.06)', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
          Outlook connection is disabled on this development server. Set <code>MSGRAPH_ALLOW_DEV: true</code> in
          your settings file to enable it here.
        </div>
      )}

      {config?.available && (
        <div style={boxStyle}>
          {isConnected || needsReconsent ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{
                  padding: '0.2rem 0.6rem',
                  borderRadius: '999px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'white',
                  background: needsReconsent ? 'var(--warning-color)' : 'var(--gain-color)'
                }}>
                  {needsReconsent ? 'Reconnection needed' : 'Connected'}
                </span>
                <strong style={{ color: 'var(--text-primary)' }}>{status.mailbox}</strong>
                {status.displayName && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>({status.displayName})</span>
                )}
              </div>

              {needsReconsent && (
                <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                  Your Outlook connection expired &mdash; this usually follows a password change, a revoked
                  app permission, or a security policy that requires signing in again. Reconnect to
                  restore the mail picker and in-app sending.
                </p>
              )}

              <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                Connected {formatDate(status.connectedAt)}
                {status.lastUsedAt ? ` · last used ${formatDate(status.lastUsedAt)}` : ''}
              </div>

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {needsReconsent && (
                  <button onClick={handleConnect} disabled={busy} style={buttonStyle()}>
                    Reconnect Outlook
                  </button>
                )}
                <button onClick={handleDisconnect} disabled={busy} style={buttonStyle('danger')}>
                  Disconnect
                </button>
              </div>

              <p style={{ margin: '1rem 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Disconnecting removes Ambervision&apos;s stored access. To also revoke the permission at
                Microsoft, visit myaccount.microsoft.com &rarr; &ldquo;Apps you have given access to&rdquo;.
              </p>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                No mailbox connected. You will be taken to Microsoft to sign in, then returned here.
              </p>
              <button onClick={handleConnect} disabled={busy} style={buttonStyle()}>
                {busy ? 'Redirecting...' : 'Connect Outlook'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
