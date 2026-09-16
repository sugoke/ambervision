import React, { useState, useMemo, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { useTheme } from './ThemeContext.jsx';
import {
  ResearchDocumentsCollection,
  RESEARCH_CATEGORY_CONFIG,
  RESEARCH_CATEGORY_ORDER,
  canWriteResearch,
  canDeleteResearch
} from '../api/researchDocuments';
import { openDocumentWindow } from './utils/openDocument.js';

/**
 * Intranet mini-app: Research library.
 *
 * Staff upload PDFs by hand (monthly report, equity recommended list, stock
 * research notes); everyone on the Intranet can browse, search and open them.
 * Files are served through the token-gated /research endpoint — the list only
 * ever holds metadata.
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;

// ---------- small helpers --------------------------------------------------------

const getSessionId = () => localStorage.getItem('sessionId');

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Date → value for <input type="month"> ("YYYY-MM") or type="date" ("YYYY-MM-DD"), UTC. */
function toInputValue(date, granularity) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const iso = d.toISOString();
  return granularity === 'month' ? iso.slice(0, 7) : iso.slice(0, 10);
}

/** Input value → ISO string the server can parse (month → first of month). */
function fromInputValue(value, granularity) {
  if (!value) return null;
  return granularity === 'month' ? `${value}-01T00:00:00.000Z` : `${value}T00:00:00.000Z`;
}

function todayInputValue(granularity) {
  return toInputValue(new Date(), granularity);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Mirror of the server's default title, so the form shows what will be stored. */
function suggestTitle(category, dateValue, security) {
  const config = RESEARCH_CATEGORY_CONFIG[category];
  if (!config) return '';
  if (config.hasSecurity) {
    return [security?.ticker?.trim().toUpperCase(), security?.name?.trim()].filter(Boolean).join(' — ');
  }
  if (!dateValue) return config.label;
  const iso = fromInputValue(dateValue, config.dateGranularity);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return config.label;
  const period = config.dateGranularity === 'month'
    ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${config.label} — ${period}`;
}

function matchesSearch(doc, term) {
  if (!term) return true;
  const haystack = [
    doc.title,
    doc.description,
    doc.periodLabel,
    doc.security?.ticker,
    doc.security?.name,
    doc.security?.isin,
    doc.uploadedByName,
    doc.fileName
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(term);
}

// ---------- shared styles --------------------------------------------------------

const inputStyle = (isDark) => ({
  width: '100%',
  padding: '0.6rem 0.8rem',
  fontSize: '0.95rem',
  border: `1px solid ${isDark ? 'var(--border-color)' : '#e5e7eb'}`,
  borderRadius: 8,
  background: isDark ? 'var(--bg-tertiary)' : 'white',
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box'
});

const labelStyle = {
  display: 'block',
  marginBottom: '0.35rem',
  fontSize: '0.85rem',
  fontWeight: 600,
  color: 'var(--text-secondary)'
};

const primaryBtn = {
  padding: '0.65rem 1.25rem',
  fontSize: '0.95rem',
  fontWeight: 600,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  background: 'linear-gradient(135deg, var(--accent-color) 0%, var(--accent-color) 100%)',
  color: 'white',
  boxShadow: '0 2px 8px rgba(0, 123, 255, 0.3)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  whiteSpace: 'nowrap'
};

const ghostBtn = {
  padding: '5px 10px',
  background: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 12,
  whiteSpace: 'nowrap'
};

const chipStyle = (active, isDark) => ({
  padding: '0.5rem 1rem',
  fontSize: '0.9rem',
  fontWeight: 500,
  border: 'none',
  borderRadius: 20,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  background: active ? 'var(--accent-color)' : (isDark ? 'var(--bg-tertiary)' : '#f3f4f6'),
  color: active ? 'white' : 'var(--text-primary)',
  boxShadow: active ? '0 2px 8px rgba(0, 123, 255, 0.3)' : 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  whiteSpace: 'nowrap'
});

const countBadge = (active) => ({
  fontSize: '0.75rem',
  padding: '0 0.45rem',
  borderRadius: 10,
  background: active ? 'rgba(255,255,255,0.25)' : 'var(--bg-secondary)',
  color: active ? 'white' : 'var(--text-muted)',
  minWidth: 18,
  textAlign: 'center'
});

// ---------- Upload / edit form (portaled modal) -----------------------------------

function ResearchFormModal({ mode, initial, defaultCategory, user, onClose, onSaved }) {
  const { isDark } = useTheme();
  const isEdit = mode === 'edit';

  const [category, setCategory] = useState(initial?.category || defaultCategory || RESEARCH_CATEGORY_ORDER[0]);
  const config = RESEARCH_CATEGORY_CONFIG[category];

  const [dateValue, setDateValue] = useState(() =>
    initial?.documentDate
      ? toInputValue(initial.documentDate, RESEARCH_CATEGORY_CONFIG[initial.category]?.dateGranularity)
      : todayInputValue(RESEARCH_CATEGORY_CONFIG[category]?.dateGranularity)
  );
  const [security, setSecurity] = useState({
    ticker: initial?.security?.ticker || '',
    name: initial?.security?.name || '',
    isin: initial?.security?.isin || ''
  });
  const [title, setTitle] = useState(initial?.title || '');
  const [titleTouched, setTitleTouched] = useState(isEdit);
  const [description, setDescription] = useState(initial?.description || '');
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');

  // Switching category changes the date granularity: re-seed the picker.
  const handleCategoryChange = (next) => {
    const nextConfig = RESEARCH_CATEGORY_CONFIG[next];
    setCategory(next);
    setDateValue(todayInputValue(nextConfig.dateGranularity));
  };

  // Keep the suggested title in sync until the user types their own.
  useEffect(() => {
    if (!titleTouched) setTitle(suggestTitle(category, dateValue, security));
  }, [category, dateValue, security, titleTouched]);

  const pickFile = (candidate) => {
    setError('');
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted');
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      setError('File exceeds the 25 MB limit');
      return;
    }
    setFile(candidate);
  };

  const submit = async () => {
    setError('');
    if (!dateValue) {
      setError(`${config.dateLabel} is required`);
      return;
    }
    if (config.hasSecurity && !security.ticker.trim() && !security.name.trim()) {
      setError('Enter at least a ticker or a company name');
      return;
    }
    if (!isEdit && !file) {
      setError('Select a PDF to upload');
      return;
    }

    setBusy(true);
    try {
      const sessionId = getSessionId();
      const documentDate = fromInputValue(dateValue, config.dateGranularity);
      const securityPayload = config.hasSecurity
        ? { ticker: security.ticker.trim() || null, name: security.name.trim() || null, isin: security.isin.trim() || null }
        : null;

      if (isEdit) {
        setStage('Saving…');
        await Meteor.callAsync('research.updateMetadata', sessionId, initial._id, {
          title: title.trim(),
          description: description.trim(),
          documentDate,
          security: securityPayload
        });
      } else {
        setStage('Reading file…');
        const base64Data = await fileToBase64(file);
        setStage('Uploading…');
        await Meteor.callAsync('research.upload', sessionId, {
          category,
          title: title.trim(),
          description: description.trim(),
          documentDate,
          security: securityPayload,
          fileName: file.name,
          base64Data
        });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.reason || err.message || 'Something went wrong');
      setBusy(false);
      setStage('');
    }
  };

  const modal = (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '6vh 1rem', overflowY: 'auto'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 620,
          background: isDark ? 'var(--bg-secondary)' : 'white',
          border: '1px solid var(--border-color)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          padding: '1.5rem',
          color: 'var(--text-primary)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            {isEdit ? 'Edit document' : 'Upload research PDF'}
          </h3>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            style={{ ...ghostBtn, fontSize: 16, lineHeight: 1, padding: '4px 9px' }}
          >×</button>
        </div>

        {/* Category */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>Category</label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {RESEARCH_CATEGORY_ORDER.map(id => {
              const c = RESEARCH_CATEGORY_CONFIG[id];
              const active = id === category;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={isEdit || busy}
                  onClick={() => handleCategoryChange(id)}
                  style={{ ...chipStyle(active, isDark), opacity: isEdit && !active ? 0.4 : 1, cursor: isEdit ? 'default' : 'pointer' }}
                >
                  <span>{c.icon}</span>{c.label}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{config.description}</div>
        </div>

        {/* Date + security */}
        <div style={{ display: 'grid', gridTemplateColumns: config.hasSecurity ? '1fr 1fr' : '1fr', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <label style={labelStyle}>{config.dateLabel}</label>
            <input
              type={config.dateGranularity === 'month' ? 'month' : 'date'}
              value={dateValue}
              disabled={busy}
              onChange={(e) => setDateValue(e.target.value)}
              style={inputStyle(isDark)}
            />
          </div>
          {config.hasSecurity && (
            <div>
              <label style={labelStyle}>Ticker</label>
              <input
                type="text"
                value={security.ticker}
                disabled={busy}
                placeholder="e.g. MSFT"
                onChange={(e) => setSecurity(s => ({ ...s, ticker: e.target.value.toUpperCase() }))}
                style={{ ...inputStyle(isDark), textTransform: 'uppercase' }}
              />
            </div>
          )}
        </div>

        {config.hasSecurity && (
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <label style={labelStyle}>Company</label>
              <input
                type="text"
                value={security.name}
                disabled={busy}
                placeholder="Company name"
                onChange={(e) => setSecurity(s => ({ ...s, name: e.target.value }))}
                style={inputStyle(isDark)}
              />
            </div>
            <div>
              <label style={labelStyle}>ISIN <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
              <input
                type="text"
                value={security.isin}
                disabled={busy}
                placeholder="US5949181045"
                maxLength={12}
                onChange={(e) => setSecurity(s => ({ ...s, isin: e.target.value.toUpperCase() }))}
                style={{ ...inputStyle(isDark), textTransform: 'uppercase' }}
              />
            </div>
          </div>
        )}

        {/* Title / description */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>Title</label>
          <input
            type="text"
            value={title}
            disabled={busy}
            onChange={(e) => { setTitleTouched(true); setTitle(e.target.value); }}
            style={inputStyle(isDark)}
          />
          {!titleTouched && (
            <div style={{ marginTop: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Suggested from the fields above — edit to override.
            </div>
          )}
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>Description <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
          <textarea
            value={description}
            disabled={busy}
            rows={2}
            placeholder="Short summary, key calls, who wrote it…"
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...inputStyle(isDark), resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        {/* File drop zone (upload only) */}
        {!isEdit && (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); pickFile(e.dataTransfer.files?.[0]); }}
            onClick={() => !busy && document.getElementById('research-file-input')?.click()}
            style={{
              border: `2px dashed ${isDragging ? 'var(--accent-color)' : 'var(--border-color)'}`,
              borderRadius: 10,
              padding: '1.25rem',
              textAlign: 'center',
              cursor: busy ? 'default' : 'pointer',
              background: isDragging ? 'rgba(0,123,255,0.06)' : (isDark ? 'var(--bg-tertiary)' : '#fafafa'),
              marginBottom: '1rem',
              transition: 'all 0.15s ease'
            }}
          >
            <input
              id="research-file-input"
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {file ? (
              <div>
                <div style={{ fontSize: '1.6rem' }}>📄</div>
                <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{file.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatFileSize(file.size)} · click to change</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '1.6rem' }}>📎</div>
                <div style={{ fontWeight: 600 }}>Drop a PDF here or click to browse</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>PDF only · up to 25 MB</div>
              </div>
            )}
          </div>
        )}

        {isEdit && (
          <div style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            File: {initial.fileName} ({formatFileSize(initial.fileSize)}). To replace the PDF, delete this entry and upload again.
          </div>
        )}

        {error && (
          <div style={{
            marginBottom: '1rem', padding: '0.7rem 1rem', borderRadius: 8, fontSize: '0.9rem',
            background: 'rgba(220, 53, 69, 0.1)', border: '1px solid rgba(220, 53, 69, 0.3)', color: '#dc3545'
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
          <button onClick={onClose} disabled={busy} style={{ ...ghostBtn, padding: '0.6rem 1rem', fontSize: '0.9rem' }}>Cancel</button>
          <button onClick={submit} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1, cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? stage : (isEdit ? 'Save changes' : '⬆ Upload')}
          </button>
        </div>
      </div>
    </div>
  );

  // Portal to <body>: the Intranet wrapper uses backdrop-filter, which traps
  // position:fixed descendants inside its own box.
  return ReactDOM.createPortal(modal, document.body);
}

// ---------- Latest issue hero ----------------------------------------------------

function LatestCard({ doc, config, isDark, onOpen }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap',
      padding: '1.25rem 1.5rem', marginBottom: '1.25rem',
      background: isDark ? 'var(--bg-secondary)' : 'white',
      border: '1px solid var(--border-color)',
      borderLeft: '4px solid var(--accent-color)',
      borderRadius: 12,
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
    }}>
      <div style={{ fontSize: '2.2rem' }}>{config.icon}</div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent-color)', marginBottom: 2 }}>
          Latest {config.label}
        </div>
        <div style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)' }}>{doc.title}</div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 2 }}>
          {config.dateLabel}: {doc.periodLabel} · {formatFileSize(doc.fileSize)} · uploaded by {doc.uploadedByName}
        </div>
        {doc.description && (
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 6 }}>{doc.description}</div>
        )}
      </div>
      <button onClick={() => onOpen(doc)} style={primaryBtn}>📖 Open PDF</button>
    </div>
  );
}

// ---------- Table ----------------------------------------------------------------

function DocumentTable({ docs, showCategory, showSecurity, user, onOpen, onEdit, onDelete, pendingDeleteId }) {
  const canWrite = canWriteResearch(user);
  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)', textAlign: 'left' }}>
              {showCategory && <th style={{ padding: '10px 14px' }}>Category</th>}
              <th style={{ padding: '10px 14px' }}>Title</th>
              {showSecurity && <th style={{ padding: '10px 14px' }}>Security</th>}
              <th style={{ padding: '10px 14px' }}>Date</th>
              <th style={{ padding: '10px 14px' }}>Size</th>
              <th style={{ padding: '10px 14px' }}>Uploaded</th>
              <th style={{ padding: '10px 14px', textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {docs.map(doc => {
              const config = RESEARCH_CATEGORY_CONFIG[doc.category] || {};
              const confirming = pendingDeleteId === doc._id;
              return (
                <tr key={doc._id} style={{ borderTop: '1px solid var(--border-color)' }}>
                  {showCategory && (
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{ marginRight: 6 }}>{config.icon}</span>{config.label}
                    </td>
                  )}
                  <td style={{ padding: '10px 14px' }}>
                    <div
                      onClick={() => onOpen(doc)}
                      style={{ fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}
                      title="Open PDF"
                    >
                      {doc.title}
                    </div>
                    {doc.description && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {doc.description}
                      </div>
                    )}
                  </td>
                  {showSecurity && (
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      {doc.security ? (
                        <>
                          {doc.security.ticker && (
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                              background: 'rgba(0,123,255,0.12)', color: 'var(--accent-color)', marginRight: 6
                            }}>{doc.security.ticker}</span>
                          )}
                          <span style={{ color: 'var(--text-secondary)' }}>{doc.security.name}</span>
                          {doc.security.isin && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{doc.security.isin}</div>
                          )}
                        </>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  )}
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{doc.periodLabel}</td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{formatFileSize(doc.fileSize)}</td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                    <div>{doc.uploadedByName}</div>
                    <div style={{ fontSize: 11 }}>{doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : ''}</div>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => onOpen(doc)} style={ghostBtn}>Open</button>
                    {canWrite && (
                      <button onClick={() => onEdit(doc)} style={{ ...ghostBtn, marginLeft: 6 }}>Edit</button>
                    )}
                    {canDeleteResearch(user, doc) && (
                      <button
                        onClick={() => onDelete(doc)}
                        style={{
                          ...ghostBtn, marginLeft: 6,
                          color: confirming ? 'white' : '#dc3545',
                          background: confirming ? '#dc3545' : 'transparent',
                          borderColor: confirming ? '#dc3545' : 'var(--border-color)'
                        }}
                      >
                        {confirming ? 'Confirm delete' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Main -----------------------------------------------------------------

export default function ResearchLibrary({ user }) {
  const { isDark } = useTheme();

  const sub = useMemo(() => Meteor.subscribe('research.list', getSessionId()), []);
  const { docs, isLoading } = useTracker(() => ({
    docs: ResearchDocumentsCollection.find({}, { sort: { documentDate: -1, uploadedAt: -1 } }).fetch(),
    isLoading: !sub.ready()
  }), [sub]);

  const [activeCategory, setActiveCategory] = useState(RESEARCH_CATEGORY_ORDER[0]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // { mode: 'upload' } | { mode: 'edit', doc }
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [notice, setNotice] = useState(null); // { kind: 'error'|'ok', text }

  // Two-step delete resets itself if the second click never comes.
  useEffect(() => {
    if (!pendingDeleteId) return undefined;
    const timer = setTimeout(() => setPendingDeleteId(null), 4000);
    return () => clearTimeout(timer);
  }, [pendingDeleteId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const counts = useMemo(() => {
    const byCategory = {};
    docs.forEach(d => { byCategory[d.category] = (byCategory[d.category] || 0) + 1; });
    return byCategory;
  }, [docs]);

  const term = search.trim().toLowerCase();
  const visibleDocs = useMemo(() => {
    const inCategory = activeCategory === 'all' ? docs : docs.filter(d => d.category === activeCategory);
    return inCategory.filter(d => matchesSearch(d, term));
  }, [docs, activeCategory, term]);

  const activeConfig = activeCategory === 'all' ? null : RESEARCH_CATEGORY_CONFIG[activeCategory];
  // The newest issue is only "the current one" when nothing is filtering the list.
  const latest = activeConfig?.highlightLatest && !term && visibleDocs.length > 0 ? visibleDocs[0] : null;
  const tableDocs = latest ? visibleDocs.slice(1) : visibleDocs;

  const showCategory = activeCategory === 'all';
  const showSecurity = activeCategory === 'all'
    ? visibleDocs.some(d => d.security)
    : !!activeConfig?.hasSecurity;

  const handleOpen = useCallback(async (doc) => {
    try {
      await openDocumentWindow(async () => {
        const res = await Meteor.callAsync('research.getDownloadUrl', getSessionId(), doc._id);
        return res.url;
      });
    } catch (err) {
      setNotice({ kind: 'error', text: err.reason || err.message || 'Could not open the document' });
    }
  }, []);

  const handleDelete = useCallback(async (doc) => {
    if (pendingDeleteId !== doc._id) {
      setPendingDeleteId(doc._id);
      return;
    }
    setPendingDeleteId(null);
    try {
      await Meteor.callAsync('research.delete', getSessionId(), doc._id);
      setNotice({ kind: 'ok', text: `Deleted "${doc.title}"` });
    } catch (err) {
      setNotice({ kind: 'error', text: err.reason || err.message || 'Delete failed' });
    }
  }, [pendingDeleteId]);

  const canWrite = canWriteResearch(user);

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', flex: 1 }}>
          {RESEARCH_CATEGORY_ORDER.map(id => {
            const c = RESEARCH_CATEGORY_CONFIG[id];
            const active = activeCategory === id;
            return (
              <button key={id} onClick={() => setActiveCategory(id)} style={chipStyle(active, isDark)}>
                <span>{c.icon}</span>{c.label}
                <span style={countBadge(active)}>{counts[id] || 0}</span>
              </button>
            );
          })}
          <button onClick={() => setActiveCategory('all')} style={chipStyle(activeCategory === 'all', isDark)}>
            <span>📚</span>All
            <span style={countBadge(activeCategory === 'all')}>{docs.length}</span>
          </button>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, ticker, ISIN, author…"
          style={{ ...inputStyle(isDark), width: 260, padding: '0.55rem 0.9rem' }}
        />
        {canWrite && (
          <button onClick={() => setModal({ mode: 'upload' })} style={primaryBtn}>⬆ Upload PDF</button>
        )}
      </div>

      {activeConfig && (
        <div style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          {activeConfig.description}
        </div>
      )}

      {notice && (
        <div style={{
          marginBottom: '1rem', padding: '0.7rem 1rem', borderRadius: 8, fontSize: '0.9rem',
          background: notice.kind === 'ok' ? 'rgba(40, 167, 69, 0.1)' : 'rgba(220, 53, 69, 0.1)',
          border: `1px solid ${notice.kind === 'ok' ? 'rgba(40, 167, 69, 0.3)' : 'rgba(220, 53, 69, 0.3)'}`,
          color: notice.kind === 'ok' ? '#28a745' : '#dc3545'
        }}>
          {notice.text}
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      ) : visibleDocs.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 12
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>{activeConfig?.icon || '📚'}</div>
          <p style={{ fontSize: '1.05rem', margin: '0 0 1rem 0' }}>
            {term ? 'No documents match your search.' : `No ${activeConfig ? activeConfig.label.toLowerCase() : 'research'} uploaded yet.`}
          </p>
          {canWrite && !term && (
            <button onClick={() => setModal({ mode: 'upload' })} style={primaryBtn}>⬆ Upload the first one</button>
          )}
        </div>
      ) : (
        <>
          {latest && <LatestCard doc={latest} config={activeConfig} isDark={isDark} onOpen={handleOpen} />}
          {tableDocs.length > 0 && (
            <>
              {latest && (
                <div style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 0.5rem 0.25rem' }}>
                  Previous issues
                </div>
              )}
              <DocumentTable
                docs={tableDocs}
                showCategory={showCategory}
                showSecurity={showSecurity}
                user={user}
                onOpen={handleOpen}
                onEdit={(doc) => setModal({ mode: 'edit', doc })}
                onDelete={handleDelete}
                pendingDeleteId={pendingDeleteId}
              />
            </>
          )}
        </>
      )}

      {modal && (
        <ResearchFormModal
          mode={modal.mode}
          initial={modal.doc || null}
          defaultCategory={activeCategory === 'all' ? RESEARCH_CATEGORY_ORDER[0] : activeCategory}
          user={user}
          onClose={() => setModal(null)}
          onSaved={() => setNotice({ kind: 'ok', text: modal.mode === 'edit' ? 'Document updated' : 'PDF uploaded' })}
        />
      )}
    </div>
  );
}
