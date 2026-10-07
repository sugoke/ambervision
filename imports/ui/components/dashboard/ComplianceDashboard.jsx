import React, { useState, useEffect, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import SizeableTransactionsModal, { consumePendingSizeableReviewId, SIZEABLE_OPEN_EVENT } from '../compliance/SizeableTransactionsModal.jsx';

/**
 * Compliance dashboard - firm-wide recap of client files for compliance and
 * superadmin: outdated / missing documents, Amberlake forms, periodic reviews,
 * signed portfolios, visits, account risk reviews, bank mandates, static data.
 *
 * Display only: every count, date and label comes pre-computed from
 * complianceDashboard.getOverview. This component filters and renders.
 */

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'prospect', label: 'Prospects' },
  { key: 'archived', label: 'Archived' }
];

const SEVERITY_COLOR = {
  critical: 'var(--loss-color)',
  warning: 'var(--warning-color)'
};

const MAX_ROWS_PER_CARD = 8;

export default function ComplianceDashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [expanded, setExpanded] = useState({});
  // Sizeable transactions modal; a notification click opens it on one item
  const [sizeableOpen, setSizeableOpen] = useState(false);
  const [sizeableReviewId, setSizeableReviewId] = useState(null);
  useEffect(() => {
    const openPending = () => {
      const pending = consumePendingSizeableReviewId();
      if (pending) {
        setSizeableReviewId(pending);
        setSizeableOpen(true);
      }
    };
    openPending();
    window.addEventListener(SIZEABLE_OPEN_EVENT, openPending);
    return () => window.removeEventListener(SIZEABLE_OPEN_EVENT, openPending);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await Meteor.callAsync('complianceDashboard.getOverview', localStorage.getItem('sessionId')));
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openClient = (entityId) => onNavigate?.('client', { entityId });

  if (loading && !data) {
    return (
      <div style={styles.container}>
        <Header />
        <div style={styles.muted}>Loading compliance overview…</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={styles.container}>
        <Header />
        <div style={styles.errorBox}>
          {error} <button style={styles.linkButton} onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  const totals = data.totals[statusFilter];
  const clientsInStatus = data.clients.filter(c => statusFilter === 'all' || c.status === statusFilter);
  const visibleCategories = data.categories.filter(c => !categoryFilter || c.key === categoryFilter);
  const attentionClients = clientsInStatus
    .filter(c => c.issues.length > 0)
    .filter(c => !categoryFilter || c.categories.includes(categoryFilter));

  return (
    <div style={styles.container}>
      <Header
        subtitle={`${data.clientsWithIssues[statusFilter]} of ${data.statusCounts[statusFilter]} client files need attention · updated ${data.generatedAtText}`}
        onRefresh={load}
        refreshing={loading}
      />

      {/* Status filter */}
      <div style={styles.chipRow}>
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            style={{ ...styles.chip, ...(statusFilter === f.key ? styles.chipActive : {}) }}
          >
            {f.label} <span style={styles.chipCount}>{data.statusCounts[f.key]}</span>
          </button>
        ))}
        {categoryFilter && (
          <button onClick={() => setCategoryFilter(null)} style={{ ...styles.chip, marginLeft: 'auto' }}>
            Clear filter ✕
          </button>
        )}
      </div>

      {/* KPI tiles - click to focus on one category */}
      <div style={styles.kpiGrid}>
        {data.categories.map(cat => {
          const t = totals[cat.key];
          const active = categoryFilter === cat.key;
          const clear = t.critical === 0 && t.warning === 0;
          return (
            <button
              key={cat.key}
              onClick={() => setCategoryFilter(active ? null : cat.key)}
              style={{ ...styles.kpiTile, ...(active ? styles.kpiTileActive : {}) }}
            >
              <div style={styles.kpiLabel}>{cat.label}</div>
              {clear ? (
                <div style={{ ...styles.kpiValue, color: 'var(--gain-color)' }}>All clear</div>
              ) : (
                <div style={styles.kpiValue}>
                  {t.clients} <span style={styles.kpiUnit}>client{t.clients === 1 ? '' : 's'}</span>
                </div>
              )}
              <div style={styles.kpiBreakdown}>
                <span style={{ color: SEVERITY_COLOR.critical }}>{t.critical} critical</span>
                <span style={{ color: SEVERITY_COLOR.warning }}>{t.warning} warning</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Sizeable transactions (AML) - opens the review modal */}
      {data.sizeableCounts && (
        <button
          onClick={() => { setSizeableReviewId(null); setSizeableOpen(true); }}
          style={{ ...styles.kpiTile, width: '100%', marginTop: '12px', display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}
        >
          <div style={{ flex: '1 1 240px' }}>
            <div style={styles.kpiLabel}>💶 Sizeable transactions</div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Single movement ≥ EUR 100k · monthly total per account ≥ EUR 300k</div>
          </div>
          {data.sizeableCounts.pending === 0 ? (
            <div style={{ ...styles.kpiValue, color: 'var(--gain-color)' }}>All clear</div>
          ) : (
            <div style={styles.kpiBreakdown}>
              <span style={{ color: 'var(--warning-color)' }}>{data.sizeableCounts.open} to review</span>
              <span style={{ color: '#8b5cf6' }}>{data.sizeableCounts.questioned} waiting for RM</span>
              <span style={{ color: 'var(--accent-color)' }}>{data.sizeableCounts.answered} answered</span>
            </div>
          )}
          <span style={{ fontSize: '13px', color: 'var(--accent-color)', fontWeight: 600 }}>Open →</span>
        </button>
      )}

      <SizeableTransactionsModal
        isOpen={sizeableOpen}
        onClose={() => { setSizeableOpen(false); load(); }}
        onOpenClient={(entityId) => { setSizeableOpen(false); openClient(entityId); }}
        initialReviewId={sizeableReviewId}
      />

      {/* One card per category */}
      <div className="av-grid" style={{ marginTop: '20px' }}>
        {visibleCategories.map(cat => {
          const rows = clientsInStatus
            .map(c => ({ client: c, issues: c.issues.filter(i => i.category === cat.key) }))
            .filter(r => r.issues.length > 0);
          const isOpen = !!expanded[cat.key];
          const shown = isOpen ? rows : rows.slice(0, MAX_ROWS_PER_CARD);
          return (
            <div key={cat.key} className={categoryFilter ? 'av-col-12' : 'av-col-6'}>
              <div style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.cardTitle}>{cat.label}</span>
                  <span style={styles.cardCount}>{rows.length === 0 ? '' : `${totals[cat.key].clients} client${totals[cat.key].clients === 1 ? '' : 's'}`}</span>
                </div>
                {rows.length === 0 ? (
                  <div style={styles.allClear}>✓ All clear</div>
                ) : (
                  <div style={styles.list}>
                    {shown.map(({ client, issues }) => (
                      <div key={client.entityId} style={styles.row} onClick={() => openClient(client.entityId)} title="Open client file">
                        <div style={styles.rowHeader}>
                          <span style={styles.clientName}>{client.name}</span>
                          {client.status !== 'active' && <span style={styles.statusBadge}>{client.status}</span>}
                          {client.rmNames && <span style={styles.rmName}>{client.rmNames}</span>}
                        </div>
                        {issues.map((issue, idx) => (
                          <div key={idx} style={styles.issue}>
                            <span style={{ ...styles.dot, background: SEVERITY_COLOR[issue.severity] }} />
                            <span style={styles.issueText}>
                              {issue.subject && <span style={styles.issueSubject}>{issue.subject} · </span>}
                              {issue.label}
                              {issue.detail && <span style={styles.issueDetail}> — {issue.detail}</span>}
                            </span>
                            {issue.dueText && (
                              <span style={{ ...styles.due, color: SEVERITY_COLOR[issue.severity] }} title={issue.dueDateText}>
                                {issue.dueText}
                              </span>
                            )}
                          </div>
                        ))}
                        {cat.key === 'visit' && (
                          <VisitRequestAction client={client} onChanged={load} />
                        )}
                      </div>
                    ))}
                    {rows.length > MAX_ROWS_PER_CARD && (
                      <button style={styles.linkButton} onClick={() => setExpanded(prev => ({ ...prev, [cat.key]: !isOpen }))}>
                        {isOpen ? 'Show less' : `Show all ${rows.length}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Worst files first */}
        <div className="av-col-12">
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.cardTitle}>Client files needing attention</span>
              <span style={styles.cardCount}>{attentionClients.length}</span>
            </div>
            {attentionClients.length === 0 ? (
              <div style={styles.allClear}>✓ Every client file is complete</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Client</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Relationship manager</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Critical</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Warnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attentionClients.map(c => (
                      <tr key={c.entityId} style={styles.tr} onClick={() => openClient(c.entityId)} title="Open client file">
                        <td style={{ ...styles.td, fontWeight: 600 }}>{c.name}</td>
                        <td style={styles.td}>{c.status}</td>
                        <td style={styles.td}>{c.rmNames || '—'}</td>
                        <td style={{ ...styles.td, textAlign: 'right', color: c.criticalCount ? SEVERITY_COLOR.critical : 'var(--text-muted)', fontWeight: 600 }}>{c.criticalCount}</td>
                        <td style={{ ...styles.td, textAlign: 'right', color: c.warningCount ? SEVERITY_COLOR.warning : 'var(--text-muted)', fontWeight: 600 }}>{c.warningCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Visit card: ask the client's RM for a meeting report, or show the pending
 * request. The RM is notified and lands in the meeting-report editor on this
 * client; finalizing the report closes the request and clears the visit flag.
 */
function VisitRequestAction({ client, onChanged }) {
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const stop = (e) => e.stopPropagation();

  const call = async (method, args) => {
    setBusy(true);
    setError(null);
    try {
      await Meteor.callAsync(method, args, localStorage.getItem('sessionId'));
      setComposing(false);
      setNote('');
      onChanged?.();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setBusy(false);
    }
  };

  const request = client.visitRequest;
  return (
    <div style={styles.requestRow} onClick={stop}>
      {request ? (
        <>
          <span style={styles.requestPill} title={request.note || undefined}>
            Report requested {request.requestedAtText}{request.requestedByName ? ` by ${request.requestedByName}` : ''} — pending
          </span>
          <button style={styles.requestLink} disabled={busy} onClick={() => call('visitReportRequests.cancel', { requestId: request.requestId })}>
            Withdraw
          </button>
        </>
      ) : composing ? (
        <>
          <input
            autoFocus
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') call('visitReportRequests.create', { entityId: client.entityId, note }); }}
            placeholder="Note to the RM (optional)"
            style={styles.requestInput}
            maxLength={1000}
          />
          <button style={styles.requestButton} disabled={busy} onClick={() => call('visitReportRequests.create', { entityId: client.entityId, note })}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
          <button style={styles.requestLink} disabled={busy} onClick={() => { setComposing(false); setNote(''); }}>Cancel</button>
        </>
      ) : (
        <button style={styles.requestButton} onClick={() => setComposing(true)} title={client.rmNames ? `Ask ${client.rmNames} for a meeting report` : 'Ask the RM for a meeting report'}>
          Request report
        </button>
      )}
      {error && <span style={styles.requestError}>{error}</span>}
    </div>
  );
}

function Header({ subtitle, onRefresh, refreshing }) {
  return (
    <div style={styles.header}>
      <div>
        <h1 style={styles.title}>Compliance <em style={styles.titleAccent}>overview</em>.</h1>
        {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
      </div>
      {onRefresh && (
        <button style={styles.refreshButton} onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      )}
    </div>
  );
}

const styles = {
  container: { padding: '24px', maxWidth: '1600px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '18px', flexWrap: 'wrap' },
  title: { fontFamily: 'var(--font-serif)', fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: '500', lineHeight: 1.05, color: 'var(--text-primary)', margin: '0 0 7px' },
  titleAccent: { fontStyle: 'italic', color: 'var(--accent-color)' },
  subtitle: { fontSize: '14px', color: 'var(--text-muted)', margin: 0 },
  refreshButton: { padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px' },
  muted: { color: 'var(--text-muted)', fontSize: '14px' },
  errorBox: { padding: '14px', borderRadius: '10px', border: '1px solid var(--loss-color)', color: 'var(--loss-color)' },
  linkButton: { background: 'none', border: 'none', padding: '6px 0 0', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, textAlign: 'left' },
  requestRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px', cursor: 'default' },
  requestButton: { padding: '3px 10px', borderRadius: '6px', border: '1px solid var(--accent-color)', background: 'transparent', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '12px', fontWeight: 600 },
  requestLink: { background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' },
  requestPill: { padding: '2px 8px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 600, color: 'var(--warning-color)', background: 'color-mix(in srgb, var(--warning-color) 12%, transparent)' },
  requestInput: { flex: '1 1 180px', minWidth: 0, padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '12px' },
  requestError: { fontSize: '11.5px', color: 'var(--loss-color)' },
  chipRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' },
  chip: { padding: '6px 12px', borderRadius: '999px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px' },
  chipActive: { background: 'var(--accent-color)', borderColor: 'var(--accent-color)', color: 'white' },
  chipCount: { opacity: 0.75, marginLeft: '4px' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' },
  kpiTile: { textAlign: 'left', padding: '14px 16px', borderRadius: 'var(--radius, 14px)', border: '1px solid var(--border-color)', background: 'var(--card-bg, var(--bg-secondary))', boxShadow: 'var(--card-shadow)', cursor: 'pointer', color: 'var(--text-primary)' },
  kpiTileActive: { borderColor: 'var(--accent-color)', boxShadow: '0 0 0 1px var(--accent-color)' },
  kpiLabel: { fontSize: '11px', fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' },
  kpiValue: { fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 500, lineHeight: 1.1 },
  kpiUnit: { fontSize: '13px', fontFamily: 'inherit', color: 'var(--text-muted)' },
  kpiBreakdown: { display: 'flex', gap: '10px', fontSize: '12px', marginTop: '6px' },
  card: { background: 'var(--card-bg, var(--bg-secondary))', borderRadius: 'var(--radius, 14px)', padding: '20px', border: '1px solid var(--border-color)', boxShadow: 'var(--card-shadow)', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' },
  cardTitle: { fontSize: '11.5px', fontWeight: 600, letterSpacing: '1.8px', textTransform: 'uppercase', color: 'var(--text-muted)' },
  cardCount: { fontSize: '12px', color: 'var(--text-muted)' },
  allClear: { color: 'var(--gain-color)', fontSize: '14px', padding: '8px 0' },
  list: { display: 'flex', flexDirection: 'column', gap: '2px' },
  row: { padding: '9px 10px', borderRadius: '8px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' },
  rowHeader: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' },
  clientName: { fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' },
  statusBadge: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.6px', padding: '1px 6px', borderRadius: '4px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' },
  rmName: { fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' },
  issue: { display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '13px', padding: '2px 0' },
  dot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, transform: 'translateY(-1px)' },
  issueText: { flex: 1, color: 'var(--text-secondary)' },
  issueSubject: { color: 'var(--text-muted)' },
  issueDetail: { color: 'var(--text-muted)' },
  due: { fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' },
  tr: { cursor: 'pointer' },
  td: { padding: '9px 10px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)' }
};
