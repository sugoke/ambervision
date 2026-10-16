import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import Modal from '../common/Modal.jsx';
import { openDocumentWindow } from '../../utils/openDocument.js';

/**
 * Sizeable transactions (AML) - compliance side.
 *
 * Lists the flags raised on client money flows (single movement >= 100k EUR,
 * monthly total per account and direction >= 300k EUR), lets compliance
 * question the RM and close the item once the explanation is satisfactory.
 *
 * Display only: rows, amounts, dates and labels come pre-formatted from
 * sizeableTransactions.list.
 */

// A notification click stores the review to open, then routes to the dashboard
const PENDING_KEY = 'pendingSizeableReviewId';

// Fired as well, for a dashboard that is already mounted
export const SIZEABLE_OPEN_EVENT = 'av:open-sizeable-review';

export const setPendingSizeableReviewId = (reviewId) => {
  try { sessionStorage.setItem(PENDING_KEY, reviewId); } catch (e) { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(SIZEABLE_OPEN_EVENT));
};

export const consumePendingSizeableReviewId = () => {
  try {
    const id = sessionStorage.getItem(PENDING_KEY);
    if (id) sessionStorage.removeItem(PENDING_KEY);
    return id;
  } catch (e) {
    return null;
  }
};

const STATUS_FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'open', label: 'To review' },
  { key: 'questioned', label: 'Waiting for RM' },
  { key: 'answered', label: 'RM answered' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' }
];

const sessionId = () => localStorage.getItem('sessionId');

const EVIDENCE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.tif,.tiff,.doc,.docx';

// Browsers leave file.type empty for some formats (HEIC, TIFF on Windows);
// the server checks extension and MIME agree, so supply the one it expects.
const MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic', '.gif': 'image/gif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
const mimeTypeOf = (file) => {
  if (file.type) return file.type;
  const ext = `.${(file.name.split('.').pop() || '').toLowerCase()}`;
  return MIME_BY_EXTENSION[ext] || 'application/octet-stream';
};

// Convert a File to base64 (without the data: prefix)
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result.split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

/**
 * Supporting documents of one review: the evidence corroborating the flows
 * (bank instruction, invoice, contract, source-of-funds letter…). Compliance
 * and the account's RM can both attach; who may remove what is decided by the
 * server (row.canAttach, document.canRemove).
 */
function SizeableDocuments({ row, onChanged }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const upload = async (file) => {
    if (!file) return;
    setBusy('upload');
    setError(null);
    try {
      const base64Data = await fileToBase64(file);
      await Meteor.callAsync('sizeableTransactions.attachDocument', {
        reviewId: row._id, fileName: file.name, base64Data, mimeType: mimeTypeOf(file)
      }, sessionId());
      await onChanged?.();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const open = async (doc) => {
    setError(null);
    try {
      // Tab opened synchronously inside the click gesture (popup blockers)
      await openDocumentWindow(() =>
        Meteor.callAsync('sizeableTransactions.getDocumentUrl', { reviewId: row._id, documentId: doc._id }, sessionId())
      );
    } catch (err) {
      setError(err.reason || err.message);
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Remove "${doc.fileName}" from this review?`)) return;
    setBusy(doc._id);
    setError(null);
    try {
      await Meteor.callAsync('sizeableTransactions.removeDocument', { reviewId: row._id, documentId: doc._id }, sessionId());
      await onChanged?.();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setBusy(null);
    }
  };

  const documents = row.documents || [];

  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={styles.sectionLabel}>Supporting documents</div>
      {documents.length === 0 && <div style={{ ...styles.muted, marginBottom: '8px' }}>No document attached yet.</div>}
      {documents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
          {documents.map(doc => (
            <div key={doc._id} style={styles.documentRow}>
              <span style={{ fontSize: '16px' }}>📄</span>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <button onClick={() => open(doc)} style={styles.documentLink} title="Open">{doc.fileName}</button>
                <div style={styles.muted}>{doc.metaText}</div>
              </div>
              <button onClick={() => open(doc)} style={styles.secondaryButton}>Open</button>
              {doc.canRemove && (
                <button
                  onClick={() => remove(doc)}
                  disabled={!!busy}
                  style={{ ...styles.secondaryButton, color: 'var(--loss-color)', opacity: busy ? 0.5 : 1 }}
                >
                  {busy === doc._id ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {row.canAttach && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <input
            ref={inputRef}
            type="file"
            accept={EVIDENCE_ACCEPT}
            style={{ display: 'none' }}
            onChange={e => upload(e.target.files?.[0])}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={!!busy}
            style={{ ...styles.secondaryButton, opacity: busy ? 0.5 : 1 }}
          >
            {busy === 'upload' ? 'Uploading…' : '📎 Attach document'}
          </button>
          <span style={styles.muted}>PDF, Word or image · 25 MB max</span>
        </div>
      )}
      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

/**
 * Operations, supporting documents and conversation of one review. Shared by
 * the compliance modal and the RM's questions card.
 */
export function SizeableReviewDetail({ row, onChanged }) {
  return (
    <div>
      <div style={styles.sectionLabel}>Operations</div>
      <div style={{ overflowX: 'auto', marginBottom: '14px' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Date</th>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>Description</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>EUR</th>
            </tr>
          </thead>
          <tbody>
            {row.operations.map(op => (
              <tr key={op.operationId}>
                <td style={styles.td}>{op.dateText}</td>
                <td style={styles.td}>
                  {op.typeLabel}
                  {op.assetLabel && <div style={{ fontSize: '11px', color: op.isSecurities ? '#8b5cf6' : 'var(--text-muted)' }}>{op.assetLabel}</div>}
                </td>
                <td style={{ ...styles.td, color: 'var(--text-secondary)' }}>{op.description}</td>
                <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{op.amountText}</td>
                <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{op.amountEURText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SizeableDocuments row={row} onChanged={onChanged} />

      <div style={styles.sectionLabel}>Conversation</div>
      {row.thread.length === 0 ? (
        <div style={styles.muted}>No question asked yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {row.thread.map((t, i) => (
            <div key={i} style={{
              ...styles.message,
              borderLeft: `3px solid ${t.role === 'compliance' ? '#8b5cf6' : t.role === 'rm' ? 'var(--accent-color)' : 'var(--text-muted)'}`
            }}>
              <div style={styles.messageMeta}>
                <strong>{t.roleLabel}</strong>{t.byName ? ` · ${t.byName}` : ''} · {t.atText}
              </div>
              <div style={styles.messageText}>{t.text}</div>
            </div>
          ))}
        </div>
      )}
      {row.closedText && <div style={{ ...styles.muted, marginTop: '10px', color: 'var(--gain-color)' }}>✓ {row.closedText}</div>}
    </div>
  );
}

export function StatusPill({ row }) {
  return (
    <span style={{
      ...styles.pill,
      color: row.statusColor,
      background: `color-mix(in srgb, ${row.statusColor} 12%, transparent)`
    }}>{row.statusLabel}</span>
  );
}

function ComplianceActions({ row, onDone }) {
  const [question, setQuestion] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  if (row.isDone) return null;

  const run = async (kind, method, payload) => {
    setBusy(kind);
    setError(null);
    try {
      await Meteor.callAsync(method, payload, sessionId());
      setQuestion('');
      setNote('');
      await onDone();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={styles.actions}>
      <div>
        <label style={styles.sectionLabel}>{row.thread.some(t => t.role === 'compliance') ? 'Follow-up question to the RM' : 'Question to the RM'}</label>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder={row.hasRm ? 'Ask for the origin / destination of the funds and supporting documents…' : 'No relationship manager is assigned to this account'}
          disabled={!row.hasRm}
          rows={3}
          style={styles.textarea}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
          <button
            onClick={() => run('ask', 'sizeableTransactions.ask', { reviewId: row._id, question })}
            disabled={!row.hasRm || !question.trim() || !!busy}
            style={{ ...styles.primaryButton, opacity: (!row.hasRm || !question.trim() || busy) ? 0.5 : 1 }}
          >
            {busy === 'ask' ? 'Sending…' : `Ask ${row.rmNamesText || 'RM'}`}
          </button>
          {!row.hasRm && <span style={{ ...styles.muted, color: 'var(--warning-color)' }}>Assign an RM to this account in Contacts to question them.</span>}
        </div>
      </div>

      <div>
        <label style={styles.sectionLabel}>Close this item</label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional closing note (e.g. explanation and documents reviewed)"
            style={{ ...styles.input, flex: '1 1 260px' }}
          />
          <button
            onClick={() => run('done', 'sizeableTransactions.markDone', { reviewId: row._id, note })}
            disabled={!!busy}
            style={{ ...styles.doneButton, opacity: busy ? 0.5 : 1 }}
          >
            {busy === 'done' ? 'Saving…' : '✓ Mark as done'}
          </button>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

export default function SizeableTransactionsModal({ isOpen, onClose, onOpenClient, initialReviewId = null, onChanged }) {
  const [status, setStatus] = useState('pending');
  const [period, setPeriod] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(initialReviewId);

  // Opened from a notification: show every status so the item is found
  useEffect(() => {
    if (initialReviewId) {
      setExpandedId(initialReviewId);
      setStatus('all');
    }
  }, [initialReviewId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await Meteor.callAsync('sizeableTransactions.list', { status, period: period || null }, sessionId()));
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setLoading(false);
    }
  }, [status, period]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const afterAction = async () => {
    await load();
    onChanged?.();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="💶 Sizeable transactions" size="large">
      {data?.rulesText && <div style={{ ...styles.muted, marginBottom: '12px' }}>{data.rulesText}</div>}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setStatus(f.key)}
            style={{ ...styles.chip, ...(status === f.key ? styles.chipActive : {}) }}
          >
            {f.label}{data?.counts?.[f.key] !== undefined && <span style={{ opacity: 0.75, marginLeft: '4px' }}>{data.counts[f.key]}</span>}
          </button>
        ))}
        <select value={period} onChange={e => setPeriod(e.target.value)} style={{ ...styles.input, width: 'auto', marginLeft: 'auto' }}>
          <option value="">All months</option>
          {(data?.periods || []).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {loading && !data && <div style={styles.muted}>Scanning operations…</div>}

      {data && data.rows.length === 0 && !loading && (
        <div style={{ ...styles.muted, padding: '24px 0', textAlign: 'center' }}>Nothing to show for this filter.</div>
      )}

      {data && data.rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', opacity: loading ? 0.6 : 1 }}>
          {data.rows.map(row => {
            const expanded = expandedId === row._id;
            return (
              <div key={row._id} style={{ ...styles.rowCard, ...(expanded ? { borderColor: 'var(--accent-color)' } : {}) }}>
                <div onClick={() => setExpandedId(expanded ? null : row._id)} style={styles.rowHead}>
                  <div style={{ minWidth: '110px' }}>
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{row.whenText}</div>
                    <span style={styles.kindBadge}>{row.kindLabel}</span>
                  </div>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (row.entityId) onOpenClient?.(row.entityId); }}
                      style={styles.clientLink}
                      disabled={!row.entityId}
                    >
                      {row.clientName}
                    </button>
                    <div style={styles.muted}>
                      {row.accountText} · {row.operationCountText} · {row.assetText}
                      {row.documentCountText && <> · 📎 {row.documentCountText}</>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '150px' }}>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: row.isIncoming ? 'var(--gain-color)' : 'var(--loss-color)' }}>
                      {row.directionLabel} {row.amountEURText}
                    </div>
                    <div style={styles.muted}>{row.rmNamesText ? `RM: ${row.rmNamesText}` : 'No RM assigned'}</div>
                  </div>
                  <div style={{ minWidth: '120px', textAlign: 'right' }}>
                    <StatusPill row={row} />
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{expanded ? '▲' : '▼'}</div>
                  </div>
                </div>

                {expanded && (
                  <div style={styles.rowBody}>
                    <SizeableReviewDetail row={row} onChanged={afterAction} />
                    <ComplianceActions row={row} onDone={afterAction} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

export const styles = {
  muted: { fontSize: '12.5px', color: 'var(--text-muted)' },
  error: { padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--loss-color)', color: 'var(--loss-color)', fontSize: '13px', margin: '8px 0' },
  chip: { padding: '6px 12px', borderRadius: '999px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px' },
  chipActive: { background: 'var(--accent-color)', borderColor: 'var(--accent-color)', color: 'white' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' },
  primaryButton: { padding: '8px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600 },
  secondaryButton: { padding: '6px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, whiteSpace: 'nowrap' },
  documentRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-secondary)', flexWrap: 'wrap' },
  documentLink: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, fontSize: '13.5px', color: 'var(--accent-color)', textAlign: 'left', wordBreak: 'break-all' },
  doneButton: { padding: '8px 16px', background: 'var(--gain-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' },
  rowCard: { border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-secondary)', overflow: 'hidden' },
  rowHead: { display: 'flex', gap: '14px', alignItems: 'center', padding: '12px 14px', cursor: 'pointer', flexWrap: 'wrap' },
  rowBody: { padding: '14px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)' },
  kindBadge: { display: 'inline-block', marginTop: '4px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '1px 6px', borderRadius: '4px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' },
  clientLink: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', textAlign: 'left' },
  pill: { display: 'inline-block', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap' },
  sectionLabel: { display: 'block', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { textAlign: 'left', padding: '6px 8px', fontSize: '10.5px', fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' },
  td: { padding: '7px 8px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)' },
  message: { padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: '6px' },
  messageMeta: { fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '3px' },
  messageText: { fontSize: '13.5px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' },
  actions: { display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px', paddingTop: '14px', borderTop: '1px dashed var(--border-color)' }
};
