import React, { useEffect, useState, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { NOTIFICATION_PREFERENCE_GROUPS } from '/imports/constants/notificationPreferences';

const cardStyle = {
  background: 'var(--bg-secondary)',
  borderRadius: '12px',
  padding: '1.5rem 2rem',
  boxShadow: '0 1px 3px var(--shadow)',
  border: '1px solid var(--border-color)',
  marginBottom: '1.5rem'
};

const buttonStyle = (primary, disabled) => ({
  padding: '0.6rem 1.25rem',
  borderRadius: '8px',
  border: primary ? 'none' : '1px solid var(--border-color)',
  background: primary ? 'var(--accent-color)' : 'var(--bg-primary)',
  color: primary ? 'white' : 'var(--text-primary)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
  fontSize: '0.9rem',
  fontWeight: '500'
});

const formatDate = d => {
  if (!d) return null;
  try { return new Date(d).toLocaleString(); } catch { return null; }
};

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState({});
  const [savedPrefs, setSavedPrefs] = useState({});
  const [meta, setMeta] = useState({ deliveryAddress: null, deliveryEnabled: false, updatedAt: null, eligible: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await Meteor.callAsync('notificationPreferences.get', localStorage.getItem('sessionId'));
      setPrefs(result.email || {});
      setSavedPrefs(result.email || {});
      setMeta({
        deliveryAddress: result.deliveryAddress,
        deliveryEnabled: result.deliveryEnabled,
        updatedAt: result.updatedAt,
        eligible: result.eligible !== false
      });
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isDirty = NOTIFICATION_PREFERENCE_GROUPS.some(g =>
    g.preferences.some(p => !p.alwaysEmailed && !!prefs[p.key] !== !!savedPrefs[p.key])
  );

  const toggle = (key) => {
    setMessage(null);
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const setGroup = (group, value) => {
    setMessage(null);
    setPrefs(prev => {
      const next = { ...prev };
      group.preferences.forEach(p => { if (!p.alwaysEmailed) next[p.key] = value; });
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await Meteor.callAsync('notificationPreferences.update', prefs, localStorage.getItem('sessionId'));
      await load();
      setMessage('Preferences saved.');
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await Meteor.callAsync('notificationPreferences.sendTest', localStorage.getItem('sessionId'));
      setMessage(`Test email sent to ${result.sentTo}.`);
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div style={{ ...cardStyle, color: 'var(--text-secondary)' }}>Loading notification preferences…</div>;
  }

  // Alert emails are reserved to superadmins, RMs and compliance
  if (!meta.eligible) {
    return (
      <div style={{ ...cardStyle, color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
        Alerts appear on the Notifications page. Email alerts are not sent to this account.
      </div>
    );
  }

  return (
    <div>
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-primary)' }}>
          🔔 Email Alerts
        </h3>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Tick the alerts you want to receive by email as soon as they happen. All alerts remain visible
          in the Notifications page either way.
          {meta.deliveryAddress && (
            <> Emails are sent to <strong style={{ color: 'var(--text-primary)' }}>{meta.deliveryAddress}</strong>.</>
          )}
        </p>
        {!meta.deliveryEnabled && (
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            fontSize: '0.85rem',
            color: 'var(--text-secondary)'
          }}>
            ⚠️ Instant alert emails are currently disabled on this server. Your choices are saved and
            will apply once delivery is enabled.
          </div>
        )}
      </div>

      {NOTIFICATION_PREFERENCE_GROUPS.map(group => {
        const configurable = group.preferences.filter(p => !p.alwaysEmailed);
        const allOn = configurable.length > 0 && configurable.every(p => prefs[p.key]);
        return (
          <div key={group.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>{group.label}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{group.description}</div>
              </div>
              {configurable.length > 1 && (
                <button type="button" onClick={() => setGroup(group, !allOn)} style={{ ...buttonStyle(false, false), padding: '0.35rem 0.9rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  {allOn ? 'Untick all' : 'Tick all'}
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.5rem' }}>
              {group.preferences.map(pref => {
                const checked = pref.alwaysEmailed ? true : !!prefs[pref.key];
                return (
                  <label
                    key={pref.key}
                    title={pref.hint || ''}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.6rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: checked ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                      cursor: pref.alwaysEmailed ? 'default' : 'pointer',
                      opacity: pref.alwaysEmailed ? 0.75 : 1
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={pref.alwaysEmailed}
                      onChange={() => toggle(pref.key)}
                      style={{ marginTop: '2px', accentColor: 'var(--accent-color)' }}
                    />
                    <span>
                      <span style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-primary)' }}>{pref.label}</span>
                      {pref.hint && (
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>{pref.hint}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={handleSave} disabled={!isDirty || saving} style={buttonStyle(true, !isDirty || saving)}>
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
        <button type="button" onClick={handleTest} disabled={testing} style={buttonStyle(false, testing)}>
          {testing ? 'Sending…' : 'Send test email'}
        </button>
        {message && <span style={{ fontSize: '0.85rem', color: 'var(--success-color, #10b981)' }}>{message}</span>}
        {error && <span style={{ fontSize: '0.85rem', color: 'var(--danger-color, #ef4444)' }}>{error}</span>}
        {!message && !error && formatDate(meta.updatedAt) && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Last saved {formatDate(meta.updatedAt)}</span>
        )}
      </div>
    </div>
  );
}
