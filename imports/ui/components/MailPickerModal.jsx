import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Meteor } from 'meteor/meteor';
import { EMAIL_TRACE_LABELS } from '/imports/api/orders.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

/**
 * Pick a message from the user's own Outlook mailbox and attach it to an order
 * as a trace, replacing the drag-it-to-your-Desktop-first dance.
 *
 * Portals to document.body: the light-theme backdrop-filter wrappers in App.jsx
 * create a containing block that traps position:fixed descendants, which has
 * already broken the notification panel and the login overlay.
 *
 * Two modes, because Graph forbids combining $search with $filter/$orderby:
 *   Browse - exact filters, newest first.
 *   Search - relevance-ordered, no date sort (the UI says so rather than
 *            leaving the ordering looking broken).
 */

const FOLDERS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'sentitems', label: 'Sent Items' },
  { id: null, label: 'All mail' }
];

const SINCE_OPTIONS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: null, label: 'Any time' }
];

const formatWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  try {
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { day: '2-digit', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : '2-digit' });
  } catch {
    return String(iso);
  }
};

export default function MailPickerModal({
  open,
  onClose,
  orderId,
  traceType,
  defaultFromFilter = '',
  // Which folder to open on. The order-to-bank trace is a mail WE sent, so
  // browsing the inbox for it is a wasted step.
  defaultFolder = 'inbox',
  onAttached,
  // When supplied, the modal shows exactly these messages instead of browsing
  // the mailbox — used by "Check for bank reply", where the candidate set is
  // already the answer and a browser would just be in the way.
  fixedMessages = null,
  heading = 'Attach from Outlook',
  emptyText = 'No messages match these filters.',
  // File mode. Supplied where the trace has nowhere to attach yet — order
  // creation holds a browser File until the order is inserted — so the picked
  // message is handed back as a File instead of being written to an order.
  onPickFile = null
}) {
  const [folderId, setFolderId] = useState(defaultFolder);
  const [query, setQuery] = useState('');
  const [fromAddress, setFromAddress] = useState(defaultFromFilter || '');
  const [hasAttachments, setHasAttachments] = useState(false);
  const [sinceDays, setSinceDays] = useState(30);

  const [messages, setMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [relevanceOrdered, setRelevanceOrdered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [attaching, setAttaching] = useState(false);

  // Guards against a slow earlier request overwriting a newer result.
  const requestSeq = useRef(0);

  // Narrow viewports stack the panes instead of splitting them: side by side,
  // the preview column gets too narrow to read and grows its own horizontal
  // scrollbar.
  const isNarrow = useIsMobile();

  const fetchPage = useCallback(async (cursor = null) => {
    const seq = ++requestSeq.current;
    cursor ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const result = await Meteor.callAsync('graphMail.listMessages', localStorage.getItem('sessionId'), {
        folderId: folderId || undefined,
        query: query.trim() || undefined,
        fromAddress: fromAddress.trim() || undefined,
        hasAttachments: hasAttachments || undefined,
        sinceDays: sinceDays || undefined,
        cursor: cursor || undefined,
        top: 25
      });
      if (seq !== requestSeq.current) return; // a newer request already landed
      setMessages(prev => (cursor ? [...prev, ...result.messages] : result.messages));
      setNextCursor(result.nextCursor);
      setRelevanceOrdered(Boolean(result.relevanceOrdered));
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err.reason || err.message);
    } finally {
      if (seq === requestSeq.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [folderId, query, fromAddress, hasAttachments, sinceDays]);

  // Debounced so typing in the search or from box doesn't fire a call per key.
  useEffect(() => {
    if (!open) return undefined;
    if (fixedMessages) {
      setMessages(fixedMessages);
      setNextCursor(null);
      setLoading(false);
      return undefined;
    }
    const t = setTimeout(() => { fetchPage(null); }, 350);
    return () => clearTimeout(t);
  }, [open, fetchPage, fixedMessages]);

  useEffect(() => {
    if (open) {
      // The modal stays mounted between uses, so the initial useState value is
      // only ever applied once — re-seed the filter each time it opens, or a
      // picker opened later for a different trace type comes up unfiltered.
      setFromAddress(defaultFromFilter || '');
      setFolderId(defaultFolder);
      return undefined;
    }
    // Reset on close so the next open starts clean.
    setMessages([]); setSelected(null); setPreview(null); setNextCursor(null); setError(null);
    return undefined;
  }, [open, defaultFromFilter, defaultFolder]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const handleSelect = async (message) => {
    setSelected(message);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const result = await Meteor.callAsync('graphMail.previewMessage', localStorage.getItem('sessionId'), message.id);
      setPreview(result);
    } catch (err) {
      setPreview({ error: err.reason || err.message });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAttach = async () => {
    if (!selected) return;
    setAttaching(true);
    setError(null);
    try {
      if (onPickFile) {
        const result = await Meteor.callAsync(
          'graphMail.getMessageAsFile',
          localStorage.getItem('sessionId'),
          selected.id
        );
        // Rebuild a real File so every downstream path (size checks, FileReader,
        // the existing upload handlers) behaves exactly as it does for a drop.
        const binary = atob(result.base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], result.fileName, { type: result.mimeType });
        onPickFile(file);
      } else {
        const result = await Meteor.callAsync('orders.attachGraphMessageAsTrace', {
          orderId,
          traceType,
          messageId: selected.id,
          sessionId: localStorage.getItem('sessionId')
        });
        onAttached?.(result.trace);
      }
      onClose?.();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setAttaching(false);
    }
  };

  if (!open) return null;

  const label = onPickFile ? 'attachment' : (EMAIL_TRACE_LABELS[traceType] || 'trace');

  const chip = (active) => ({
    padding: '3px 10px',
    borderRadius: '999px',
    border: `1px solid ${active ? '#0ea5e9' : 'var(--border-color)'}`,
    background: active ? 'rgba(14, 165, 233, 0.12)' : 'transparent',
    color: active ? '#0ea5e9' : 'var(--text-secondary)',
    fontSize: '11px',
    cursor: 'pointer'
  });

  /**
   * One From/To/Subject line. Flex rather than a fixed-width inline-block label:
   * a long address then pushed the value onto its own line and wrapped it
   * mid-token, which is what made the narrow preview unreadable.
   */
  const headerRow = (label, value, valueStyle = {}) => (
    <div style={{ display: 'flex', gap: '6px', marginBottom: '2px' }}>
      <strong style={{ color: 'var(--text-muted)', flex: '0 0 52px' }}>{label}:</strong>
      <span style={{ color: 'var(--text-primary)', flex: 1, minWidth: 0, overflowWrap: 'anywhere', ...valueStyle }}>
        {value}
      </span>
    </div>
  );

  const inputStyle = {
    padding: '6px 10px',
    borderRadius: '5px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: '12px'
  };

  const modal = (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // client/main.html sets viewport-fit=cover, so a fixed inset:0 overlay
        // extends under the status bar / Dynamic Island and the home indicator.
        // Inset the padding by the safe area or the header slides under the clock.
        padding: isNarrow
          ? 'calc(8px + env(safe-area-inset-top, 0px)) calc(8px + env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) calc(8px + env(safe-area-inset-left, 0px))'
          : '20px'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          width: 'min(1100px, 100%)',
          // 100% of the already-safe-area-inset content box, rather than a vh
          // figure that would measure the full viewport and overflow it again.
          height: isNarrow ? '100%' : 'min(720px, 92vh)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)'
        }}
      >
        {/* Header */}
        <div style={{ padding: isNarrow ? '10px 12px' : '14px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--text-primary)', fontSize: isNarrow ? '13px' : '14px' }}>{heading}</strong>
          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>as {label}</span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}
            aria-label="Close"
          >&times;</button>
        </div>

        {/* Toolbar — hidden when the candidate set is fixed, since there is
            nothing to browse or filter. */}
        {!fixedMessages && (
        <div style={{ padding: isNarrow ? '8px 12px' : '10px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={folderId === null ? '__all' : folderId}
            onChange={e => setFolderId(e.target.value === '__all' ? null : e.target.value)}
            style={inputStyle}
          >
            {FOLDERS.map(f => (
              <option key={f.label} value={f.id === null ? '__all' : f.id}>{f.label}</option>
            ))}
          </select>

          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search mail..."
            style={{ ...inputStyle, flex: '1 1 200px' }}
          />

          <input
            type="text"
            value={fromAddress}
            onChange={e => setFromAddress(e.target.value)}
            placeholder="From address"
            style={{ ...inputStyle, flex: '0 1 220px' }}
          />

          <button type="button" onClick={() => setHasAttachments(v => !v)} style={chip(hasAttachments)}>
            Has attachments
          </button>

          {/* The date range applies to searches too — it goes into the KQL as
              received>=… — so the chips stay put instead of vanishing the
              moment you type, which made them look like they did nothing. */}
          {SINCE_OPTIONS.map(o => (
            <button key={o.label} type="button" onClick={() => setSinceDays(o.days)} style={chip(sinceDays === o.days)}>
              {o.label}
            </button>
          ))}
        </div>
        )}

        {relevanceOrdered && (
          <div style={{ padding: '6px 18px', fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(14,165,233,0.06)' }}>
            Search results are ordered by relevance, not by date.
          </div>
        )}

        {error && (
          <div style={{ padding: '8px 18px', fontSize: '12px', color: 'var(--loss-color)', background: 'rgba(239, 68, 68, 0.08)' }}>
            {error}
            {/* A failed fetch leaves the previous page on screen; say so, or the
                rows below look like the answer to the query that just failed. */}
            {messages.length > 0 && (
              <span style={{ color: 'var(--text-muted)' }}> The list below is the last result that loaded.</span>
            )}
          </div>
        )}

        {/* Body: list + preview. Side by side on desktop; stacked on a phone,
            with the preview underneath the list. */}
        <div style={{ flex: 1, display: 'flex', flexDirection: isNarrow ? 'column' : 'row', minHeight: 0 }}>
          <div style={{
            ...(isNarrow
              ? { width: '100%', flex: selected ? '0 0 44%' : '1 1 auto', borderBottom: '1px solid var(--border-color)' }
              : { width: '42%', minWidth: '280px', borderRight: '1px solid var(--border-color)' }),
            overflowY: 'auto'
          }}>
            {loading ? (
              <div style={{ padding: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>Loading…</div>
            ) : messages.length === 0 ? (
              <div style={{ padding: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>
                {emptyText}
              </div>
            ) : (
              <>
                {messages.map(m => {
                  const isSel = selected?.id === m.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => handleSelect(m)}
                      style={{
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--border-color)',
                        cursor: 'pointer',
                        background: isSel ? 'rgba(14, 165, 233, 0.10)' : 'transparent'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: m.isRead ? 500 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.fromName || m.fromAddress}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {m.hasAttachments ? '📎 ' : ''}{formatWhen(m.receivedDateTime)}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 600, margin: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.subject}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.preview}
                      </div>
                    </div>
                  );
                })}
                {nextCursor && (
                  <div style={{ padding: '10px', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => fetchPage(nextCursor)}
                      disabled={loadingMore}
                      style={{ ...inputStyle, cursor: 'pointer', color: '#0ea5e9', borderColor: '#0ea5e9', background: 'transparent' }}
                    >
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* On a phone the empty "select a message" pane is pure wasted height,
              so the preview only appears once there is something to show. */}
          {!(isNarrow && !selected) && (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--bg-primary)' }}>
            {!selected ? (
              <div style={{ padding: '24px', fontSize: '12px', color: 'var(--text-muted)' }}>
                Select a message to preview it.
              </div>
            ) : previewLoading ? (
              <div style={{ padding: '24px', fontSize: '12px', color: 'var(--text-muted)' }}>Loading preview…</div>
            ) : preview?.error ? (
              <div style={{ padding: '24px', fontSize: '12px', color: 'var(--loss-color)' }}>
                Could not load this message: {preview.error}
              </div>
            ) : preview ? (
              <div>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-color)', fontSize: '12px' }}>
                  {headerRow('From', preview.from)}
                  {headerRow('To', preview.to)}
                  {headerRow('Subject', preview.subject, { fontWeight: 600 })}
                  {preview.date && headerRow('Date', new Date(preview.date).toLocaleString())}
                  {preview.hasAttachments && (
                    <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '11px', overflowWrap: 'anywhere' }}>
                      Attachments: {(preview.attachmentNames || []).join(', ')}
                    </div>
                  )}
                </div>
                {preview.html ? (
                  // Same sandboxed srcDoc pattern as TracePreview: no allow-scripts,
                  // so untrusted mail HTML cannot execute.
                  <iframe
                    srcDoc={preview.html}
                    title="Email preview"
                    style={{
                      width: '100%',
                      height: isNarrow ? '260px' : '380px',
                      border: 'none',
                      background: '#fff'
                    }}
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <div style={{ padding: '14px', fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                    {preview.text}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: isNarrow ? '10px 12px' : '12px 18px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center' }}>
          {/* Explanatory note costs three lines on a phone and earns none of them */}
          {!isNarrow && (
            <span style={{ flex: 1, fontSize: '11px', color: 'var(--text-muted)' }}>
              The message is saved as a .eml, so it stays previewable in the order.
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{ ...inputStyle, cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)' }}
          >Cancel</button>
          <button
            type="button"
            onClick={handleAttach}
            disabled={!selected || attaching}
            style={{
              padding: '6px 16px', borderRadius: '5px', border: 'none',
              background: (!selected || attaching) ? 'var(--border-color)' : '#0ea5e9',
              color: 'white', fontSize: '12px', fontWeight: 600,
              cursor: (!selected || attaching) ? 'not-allowed' : 'pointer'
            }}
          >
            {attaching ? 'Attaching…' : `Attach as ${label}`}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
