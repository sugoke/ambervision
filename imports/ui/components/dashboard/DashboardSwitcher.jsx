import React, { useState, useEffect } from 'react';
import RMDashboard from './RMDashboard.jsx';
import ComplianceDashboard from './ComplianceDashboard.jsx';

/**
 * Dashboard entry point. Compliance and superadmin users can switch between the
 * business dashboard (RMDashboard) and the compliance dashboard; everyone else
 * gets the business dashboard unchanged. The choice is remembered per user in
 * this browser, like the dashboard currency.
 */

const COMPLIANCE_DASHBOARD_ROLES = ['compliance', 'superadmin'];
const VERSIONS = [
  { key: 'business', label: 'Business' },
  { key: 'compliance', label: 'Compliance' }
];

export default function DashboardSwitcher({ user, onNavigate }) {
  const canSwitch = COMPLIANCE_DASHBOARD_ROLES.includes(user?.role);
  const storageKey = `dashboardVersion_${user?._id}`;

  const readSaved = () => {
    if (!canSwitch) return 'business';
    try {
      const stored = localStorage.getItem(storageKey);
      if (VERSIONS.some(v => v.key === stored)) return stored;
    } catch (e) { /* storage unavailable - fall back to the role default */ }
    return user?.role === 'compliance' ? 'compliance' : 'business';
  };
  const [version, setVersion] = useState(readSaved);
  // The user record can arrive after the first render: re-read the saved choice then
  useEffect(() => { setVersion(readSaved()); }, [user?._id, user?.role]);

  if (!canSwitch) return <RMDashboard user={user} onNavigate={onNavigate} />;

  const choose = (key) => {
    setVersion(key);
    try { localStorage.setItem(storageKey, key); } catch (e) { /* ignore */ }
  };

  return (
    <div>
      <div style={styles.bar}>
        <div style={styles.toggle} role="tablist" aria-label="Dashboard version">
          {VERSIONS.map(v => (
            <button
              key={v.key}
              role="tab"
              aria-selected={version === v.key}
              onClick={() => choose(v.key)}
              style={{ ...styles.option, ...(version === v.key ? styles.optionActive : {}) }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {version === 'compliance'
        ? <ComplianceDashboard user={user} onNavigate={onNavigate} />
        : <RMDashboard user={user} onNavigate={onNavigate} />}
    </div>
  );
}

const styles = {
  bar: { maxWidth: '1600px', margin: '0 auto', padding: '16px 24px 0', display: 'flex', justifyContent: 'flex-end' },
  toggle: { display: 'inline-flex', padding: '3px', borderRadius: '999px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' },
  option: { padding: '6px 16px', borderRadius: '999px', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 },
  optionActive: { background: 'var(--accent-color)', color: 'white' }
};
