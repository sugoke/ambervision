import React, { useState, useEffect, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { useDialog } from './useDialog.js';
import Dialog from './Dialog.jsx';

// Admin dashboard for market data providers: enable/disable, priority,
// rate limits, health stats and a per-provider ticker coverage test.
const DataProvidersManager = ({ user }) => {
  const [providers, setProviders] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [testTicker, setTestTicker] = useState('');
  const [testResults, setTestResults] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [editingLimits, setEditingLimits] = useState(null); // { providerId, perMinute, perDay }
  const { dialogState, hideDialog, showSuccess, showError } = useDialog();

  const sessionId = localStorage.getItem('sessionId');

  const loadProviders = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await Meteor.callAsync('dataProviders.list', sessionId);
      setProviders(list);
    } catch (error) {
      console.error('DataProvidersManager: Error loading providers:', error);
      showError(`Error loading providers: ${error.reason || error.message}`, 'Load Failed');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const handleToggleEnabled = async (provider) => {
    try {
      await Meteor.callAsync('dataProviders.setEnabled', provider.providerId, !provider.enabled, sessionId);
      await loadProviders();
    } catch (error) {
      showError(error.reason || error.message, 'Toggle Failed');
    }
  };

  const handleMovePriority = async (provider, direction) => {
    const sorted = [...providers].sort((a, b) => a.priority - b.priority);
    const index = sorted.findIndex(p => p.providerId === provider.providerId);
    const swapWith = sorted[index + direction];
    if (!swapWith) return;
    try {
      await Meteor.callAsync('dataProviders.setPriority', provider.providerId, swapWith.priority, sessionId);
      await Meteor.callAsync('dataProviders.setPriority', swapWith.providerId, provider.priority, sessionId);
      await loadProviders();
    } catch (error) {
      showError(error.reason || error.message, 'Priority Change Failed');
    }
  };

  const handleResetHealth = async (provider) => {
    try {
      await Meteor.callAsync('dataProviders.resetHealth', provider.providerId, sessionId);
      await loadProviders();
      showSuccess(`Health stats reset for ${provider.name}`, 'Reset Done');
    } catch (error) {
      showError(error.reason || error.message, 'Reset Failed');
    }
  };

  const handleSaveLimits = async () => {
    if (!editingLimits) return;
    try {
      await Meteor.callAsync('dataProviders.setRateLimit', editingLimits.providerId, {
        perMinute: Number(editingLimits.perMinute) || 1,
        perDay: Number(editingLimits.perDay) || 1
      }, sessionId);
      setEditingLimits(null);
      await loadProviders();
    } catch (error) {
      showError(error.reason || error.message, 'Save Failed');
    }
  };

  const handleTestTicker = async () => {
    if (!testTicker || testTicker.trim().length < 2) return;
    setIsTesting(true);
    setTestResults(null);
    try {
      const results = await Meteor.callAsync('dataProviders.testTicker', testTicker.trim(), sessionId);
      setTestResults(results);
      await loadProviders(); // refresh health counters
    } catch (error) {
      showError(error.reason || error.message, 'Test Failed');
    } finally {
      setIsTesting(false);
    }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleString() : '—';

  const capabilityChips = (capabilities) =>
    Object.entries(capabilities || {})
      .filter(([, v]) => v)
      .map(([k]) => (
        <span key={k} style={{
          display: 'inline-block',
          padding: '0.1rem 0.45rem',
          marginRight: '0.25rem',
          marginBottom: '0.15rem',
          fontSize: '0.7rem',
          borderRadius: '9999px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-secondary)'
        }}>{k}</span>
      ));

  const sortedProviders = [...providers].sort((a, b) => a.priority - b.priority);

  const cellStyle = { padding: '0.75rem', borderBottom: '1px solid var(--border-color)', verticalAlign: 'top' };
  const headerStyle = { ...cellStyle, fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-secondary)' };
  const buttonStyle = {
    padding: '0.35rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontSize: '0.8rem'
  };

  return (
    <div>
      {/* Provider table */}
      <section style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        background: 'var(--bg-primary)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0 }}>🔀 Market Data Providers</h3>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Providers are tried in priority order; when one has no data for a ticker, the next enabled provider fills the gap.
              API keys are configured in settings.json, never stored in the database.
            </p>
          </div>
          <button style={buttonStyle} onClick={loadProviders} disabled={isLoading}>
            {isLoading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...headerStyle, textAlign: 'left' }}>Provider</th>
              <th style={{ ...headerStyle, textAlign: 'center' }}>Priority</th>
              <th style={{ ...headerStyle, textAlign: 'center' }}>Status</th>
              <th style={{ ...headerStyle, textAlign: 'left' }}>Capabilities</th>
              <th style={{ ...headerStyle, textAlign: 'left' }}>Rate Limit</th>
              <th style={{ ...headerStyle, textAlign: 'left' }}>Health</th>
              <th style={{ ...headerStyle, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedProviders.map((p, idx) => (
              <tr key={p.providerId}>
                <td style={cellStyle}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{p.providerId}</div>
                  <div style={{ marginTop: '0.25rem' }}>
                    {p.hasApiKey ? (
                      <span style={{ fontSize: '0.7rem', color: '#059669' }}>🔑 API key configured</span>
                    ) : (
                      <span style={{ fontSize: '0.7rem', color: '#dc2626' }}>⚠️ No API key in settings.json</span>
                    )}
                  </div>
                </td>
                <td style={{ ...cellStyle, textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button
                    style={{ ...buttonStyle, padding: '0.15rem 0.4rem', marginRight: '0.25rem' }}
                    onClick={() => handleMovePriority(p, -1)}
                    disabled={idx === 0}
                    title="Higher priority"
                  >▲</button>
                  {p.priority}
                  <button
                    style={{ ...buttonStyle, padding: '0.15rem 0.4rem', marginLeft: '0.25rem' }}
                    onClick={() => handleMovePriority(p, 1)}
                    disabled={idx === sortedProviders.length - 1}
                    title="Lower priority"
                  >▼</button>
                </td>
                <td style={{ ...cellStyle, textAlign: 'center' }}>
                  <button
                    onClick={() => handleToggleEnabled(p)}
                    style={{
                      ...buttonStyle,
                      background: p.enabled ? '#059669' : '#6b7280',
                      color: 'white',
                      border: 'none'
                    }}
                  >
                    {p.enabled ? 'ON' : 'OFF'}
                  </button>
                </td>
                <td style={cellStyle}>{capabilityChips(p.capabilities)}</td>
                <td style={cellStyle}>
                  {editingLimits?.providerId === p.providerId ? (
                    <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="number"
                        value={editingLimits.perMinute}
                        onChange={e => setEditingLimits({ ...editingLimits, perMinute: e.target.value })}
                        style={{ width: '55px', padding: '0.2rem' }}
                        title="Requests per minute"
                      />/min
                      <input
                        type="number"
                        value={editingLimits.perDay}
                        onChange={e => setEditingLimits({ ...editingLimits, perDay: e.target.value })}
                        style={{ width: '65px', padding: '0.2rem' }}
                        title="Requests per day"
                      />/day
                      <button style={{ ...buttonStyle, padding: '0.2rem 0.5rem' }} onClick={handleSaveLimits}>✓</button>
                      <button style={{ ...buttonStyle, padding: '0.2rem 0.5rem' }} onClick={() => setEditingLimits(null)}>✕</button>
                    </div>
                  ) : p.rateLimit ? (
                    <div>
                      <div style={{ fontSize: '0.8rem' }}>{p.rateLimit.perMinute}/min · {p.rateLimit.perDay}/day</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Used today: {p.health?.dailyCreditsUsed || 0}/{p.rateLimit.perDay}
                      </div>
                      <button
                        style={{ ...buttonStyle, padding: '0.15rem 0.4rem', marginTop: '0.25rem', fontSize: '0.7rem' }}
                        onClick={() => setEditingLimits({
                          providerId: p.providerId,
                          perMinute: p.rateLimit.perMinute,
                          perDay: p.rateLimit.perDay
                        })}
                      >Edit</button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Unlimited</span>
                  )}
                </td>
                <td style={{ ...cellStyle, fontSize: '0.75rem' }}>
                  <div>✅ {p.health?.successCount || 0} ok · ❌ {p.health?.errorCount || 0} errors</div>
                  <div style={{ color: 'var(--text-secondary)' }}>Last success: {formatDate(p.health?.lastSuccessAt)}</div>
                  {p.health?.lastError && (
                    <div style={{ color: '#dc2626', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={p.health.lastError}>
                      Last error: {p.health.lastError}
                    </div>
                  )}
                </td>
                <td style={{ ...cellStyle, textAlign: 'right' }}>
                  <button style={buttonStyle} onClick={() => handleResetHealth(p)}>Reset stats</button>
                </td>
              </tr>
            ))}
            {sortedProviders.length === 0 && !isLoading && (
              <tr><td style={cellStyle} colSpan={7}>No providers configured.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Ticker coverage test */}
      <section style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        background: 'var(--bg-primary)'
      }}>
        <h3 style={{ marginTop: 0 }}>🧪 Test Ticker Coverage</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Probes the ticker against every enabled provider individually (e.g. <code>7203.TSE</code> for Toyota on Tokyo).
          Use EOD format: TICKER.EXCHANGE.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="text"
            value={testTicker}
            onChange={e => setTestTicker(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleTestTicker()}
            placeholder="e.g. 7203.TSE or AAPL.US"
            style={{
              flex: '0 0 260px',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)'
            }}
          />
          <button
            style={{ ...buttonStyle, background: 'var(--accent-color, #2563eb)', color: 'white', border: 'none' }}
            onClick={handleTestTicker}
            disabled={isTesting || testTicker.trim().length < 2}
          >
            {isTesting ? 'Testing… (may queue behind rate limit)' : 'Test'}
          </button>
        </div>

        {testResults && (
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {testResults.map(r => (
              <div key={r.providerId} style={{
                flex: '1 1 260px',
                padding: '1rem',
                borderRadius: '8px',
                border: `1px solid ${r.ok ? '#059669' : '#dc2626'}`,
                background: 'var(--bg-secondary)'
              }}>
                <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                  {r.ok ? '✅' : '❌'} {r.name}
                </div>
                {r.ok ? (
                  <div style={{ fontSize: '0.85rem' }}>
                    <div>Bars (7 days): {r.barCount}</div>
                    <div>Latest close: {r.latestClose ?? '—'} {r.currency || ''}</div>
                    <div>Live price: {r.livePrice ?? '—'}</div>
                    {r.liveError && <div style={{ color: '#d97706' }}>Quote: {r.liveError}</div>}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.85rem', color: '#dc2626' }}>{r.error}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog
        isOpen={dialogState.isOpen}
        onClose={hideDialog}
        title={dialogState.title}
        message={dialogState.message}
        type={dialogState.type}
        onConfirm={dialogState.onConfirm}
        onCancel={dialogState.onCancel}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        showCancel={dialogState.showCancel}
      />
    </div>
  );
};

export default DataProvidersManager;
