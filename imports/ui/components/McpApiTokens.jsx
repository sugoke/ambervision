import React, { useEffect, useState, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';

const TTL_OPTIONS = [
  { label: 'Never expires', value: null },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 }
];

const formatDate = d => {
  if (!d) return '—';
  try { return new Date(d).toLocaleString(); } catch { return String(d); }
};

export default function McpApiTokens() {
  const [tokens, setTokens] = useState([]);
  const [connectedApps, setConnectedApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [ttlDays, setTtlDays] = useState(null);
  const [newToken, setNewToken] = useState(null); // { rawToken, prefix, name } — one-time display
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sessionId = localStorage.getItem('sessionId');
      const [tokensResult, appsResult] = await Promise.all([
        Meteor.callAsync('mcpTokens.list', sessionId),
        Meteor.callAsync('oauth.listConnectedClients', sessionId)
      ]);
      setTokens(tokensResult || []);
      setConnectedApps(appsResult || []);
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRevokeApp = async (clientId, clientName) => {
    if (!window.confirm(`Disconnect "${clientName}"? Any LLM using this connection will lose access immediately.`)) return;
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('oauth.revokeConnectedClient', sessionId, clientId);
      await refresh();
    } catch (err) {
      setError(err.reason || err.message);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please give this token a name.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const sessionId = localStorage.getItem('sessionId');
      const result = await Meteor.callAsync('mcpTokens.create', sessionId, {
        name: name.trim(),
        ttlDays
      });
      setNewToken(result);
      setName('');
      setTtlDays(null);
      await refresh();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (tokenId, tokenName) => {
    if (!window.confirm(`Revoke token "${tokenName}"? LLMs using it will immediately lose access.`)) return;
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('mcpTokens.revoke', sessionId, tokenId);
      await refresh();
    } catch (err) {
      setError(err.reason || err.message);
    }
  };

  const handleCopy = async () => {
    if (!newToken?.rawToken) return;
    try {
      await navigator.clipboard.writeText(newToken.rawToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const mcpUrl = `${window.location.origin}/mcp`;

  const boxStyle = {
    background: 'var(--bg-secondary)',
    borderRadius: '12px',
    padding: '1.5rem',
    border: '1px solid var(--border-color)',
    marginBottom: '1.5rem'
  };

  const tokenStatus = (t) => {
    if (t.revokedAt) return { label: 'Revoked', color: '#dc2626' };
    if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now()) return { label: 'Expired', color: '#dc2626' };
    return { label: 'Active', color: '#10b981' };
  };

  return (
    <div>
      <div style={boxStyle}>
        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.15rem', color: 'var(--text-primary)' }}>
          MCP Access Tokens
        </h3>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Generate a token to let an LLM (Claude Desktop, Claude.ai, ChatGPT) query your
          Ambervision portfolio on your behalf. The LLM will only see the same data you see
          when signed in — no more, no less. Revoke any time to immediately cut access.
        </p>
      </div>

      {/* One-time raw token display */}
      {newToken && (
        <div style={{
          ...boxStyle,
          borderColor: '#f59e0b',
          background: 'rgba(245, 158, 11, 0.05)'
        }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: '#b45309' }}>
            Copy your new token now — this is the only time it will be shown
          </h4>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Store it in a password manager or directly in your LLM's MCP configuration.
            If you lose it, revoke this one and create a new one.
          </p>
          <div style={{
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'stretch',
            marginBottom: '0.75rem'
          }}>
            <code style={{
              flex: 1,
              padding: '0.75rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              wordBreak: 'break-all'
            }}>{newToken.rawToken}</code>
            <button
              onClick={handleCopy}
              style={{
                padding: '0.75rem 1rem',
                background: copied ? '#10b981' : 'var(--accent-color)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <button
            onClick={() => setNewToken(null)}
            style={{
              padding: '0.5rem 1rem',
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.85rem'
            }}
          >I've saved it, dismiss</button>
        </div>
      )}

      {/* Create form */}
      <div style={boxStyle}>
        <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>Create a new token</h4>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
              Token name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Claude Desktop on my laptop"
              maxLength={100}
              style={{
                width: '100%',
                padding: '0.6rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem'
              }}
            />
          </div>
          <div style={{ flex: '0 1 180px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
              Expiration
            </label>
            <select
              value={ttlDays === null ? '' : String(ttlDays)}
              onChange={e => setTtlDays(e.target.value === '' ? null : Number(e.target.value))}
              style={{
                width: '100%',
                padding: '0.6rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem'
              }}
            >
              {TTL_OPTIONS.map(opt => (
                <option key={String(opt.value)} value={opt.value === null ? '' : opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            style={{
              padding: '0.6rem 1.25rem',
              background: 'var(--accent-color)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.9rem',
              cursor: creating ? 'wait' : 'pointer',
              opacity: creating ? 0.7 : 1
            }}
          >{creating ? 'Creating…' : 'Generate token'}</button>
        </form>
        {error && (
          <div style={{ marginTop: '0.75rem', color: '#dc2626', fontSize: '0.85rem' }}>{error}</div>
        )}
      </div>

      {/* Tokens list */}
      <div style={boxStyle}>
        <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>Your tokens</h4>
        {loading ? (
          <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
        ) : tokens.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            No tokens yet. Create one above to connect an LLM.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '0.5rem' }}>Name</th>
                  <th style={{ padding: '0.5rem' }}>Prefix</th>
                  <th style={{ padding: '0.5rem' }}>Status</th>
                  <th style={{ padding: '0.5rem' }}>Created</th>
                  <th style={{ padding: '0.5rem' }}>Last used</th>
                  <th style={{ padding: '0.5rem' }}>Expires</th>
                  <th style={{ padding: '0.5rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map(t => {
                  const status = tokenStatus(t);
                  const revoked = !!t.revokedAt;
                  return (
                    <tr key={t._id} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                      <td style={{ padding: '0.5rem' }}>{t.name}</td>
                      <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>{t.prefix}…</td>
                      <td style={{ padding: '0.5rem', color: status.color, fontWeight: 500 }}>{status.label}</td>
                      <td style={{ padding: '0.5rem' }}>{formatDate(t.createdAt)}</td>
                      <td style={{ padding: '0.5rem' }}>{formatDate(t.lastUsedAt)}</td>
                      <td style={{ padding: '0.5rem' }}>{t.expiresAt ? formatDate(t.expiresAt) : 'Never'}</td>
                      <td style={{ padding: '0.5rem' }}>
                        {!revoked && (
                          <button
                            onClick={() => handleRevoke(t._id, t.name)}
                            style={{
                              padding: '0.35rem 0.75rem',
                              background: 'transparent',
                              color: '#dc2626',
                              border: '1px solid #dc2626',
                              borderRadius: '4px',
                              fontSize: '0.8rem',
                              cursor: 'pointer'
                            }}
                          >Revoke</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Connected third-party apps (OAuth) */}
      <div style={boxStyle}>
        <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>Connected apps</h4>
        <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Apps you've authorized via OAuth (e.g. Claude.ai's custom connector). Disconnecting
          immediately invalidates any access or refresh tokens for that app.
        </p>
        {loading ? (
          <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
        ) : connectedApps.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            No connected apps yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '0.5rem' }}>App</th>
                  <th style={{ padding: '0.5rem' }}>Scopes</th>
                  <th style={{ padding: '0.5rem' }}>Connected</th>
                  <th style={{ padding: '0.5rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {connectedApps.map(app => (
                  <tr key={app._id} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                    <td style={{ padding: '0.5rem' }}>
                      <div style={{ fontWeight: 500 }}>{app.clientName}</div>
                      {app.clientUri && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{app.clientUri}</div>
                      )}
                    </td>
                    <td style={{ padding: '0.5rem', fontSize: '0.85rem' }}>{(app.scopes || []).join(', ') || 'portfolio'}</td>
                    <td style={{ padding: '0.5rem' }}>{formatDate(app.consentedAt)}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <button
                        onClick={() => handleRevokeApp(app.clientId, app.clientName)}
                        style={{
                          padding: '0.35rem 0.75rem',
                          background: 'transparent',
                          color: '#dc2626',
                          border: '1px solid #dc2626',
                          borderRadius: '4px',
                          fontSize: '0.8rem',
                          cursor: 'pointer'
                        }}
                      >Disconnect</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Connection instructions */}
      <div style={boxStyle}>
        <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-primary)' }}>How to connect</h4>
        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Your MCP endpoint:
        </p>
        <code style={{
          display: 'block',
          padding: '0.5rem 0.75rem',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          fontSize: '0.85rem',
          marginBottom: '1rem',
          wordBreak: 'break-all'
        }}>{mcpUrl}</code>

        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 500 }}>
          Claude.ai (web) — recommended
        </p>
        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Paste the MCP endpoint into Claude.ai's "Add custom connector" dialog.
          No token required — you'll be asked to sign in here and approve the
          connection via OAuth. The same is true of ChatGPT's OAuth-based connectors.
        </p>

        <p style={{ margin: '1rem 0 0.5rem 0', fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 500 }}>
          Claude Desktop / API / ChatGPT (bearer) — personal token
        </p>
        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          These clients support custom headers; use a personal token generated above.
          Example <code>claude_desktop_config.json</code>:
        </p>
        <pre style={{
          padding: '0.75rem',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          fontSize: '0.8rem',
          overflow: 'auto',
          margin: 0
        }}>{`{
  "mcpServers": {
    "ambervision": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer amvs_YOUR_TOKEN_HERE"
      }
    }
  }
}`}</pre>
      </div>
    </div>
  );
}
