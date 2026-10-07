import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Meteor } from 'meteor/meteor';
import { downloadEml, downloadOrderAttachments, openOutlookCompose, isMobileMailDevice } from '/imports/utils/emlBuilder.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

/**
 * Review an order email before it leaves, then send it from the user's own
 * Outlook mailbox.
 *
 * "Download .eml instead" stays on every send, permanently. It is what makes
 * this safe to roll out: any time Graph misbehaves, or the desk address needs
 * fixing in Outlook, the original path is one click away.
 *
 * Portals to document.body — the light-theme backdrop-filter wrappers in
 * App.jsx trap position:fixed descendants.
 */
/** Enough to make a term sheet render in the preview frame; the rest downloads. */
function guessContentType(name = '') {
  const ext = String(name).toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'txt') return 'text/plain';
  return 'application/octet-stream';
}

export default function OrderSendPreviewModal({ payload, mailbox, onClose, onSent }) {
  const isMobile = useIsMobile();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  // Name of the attachment currently opened for review, and the blob URLs made
  // for it — revoked on close so a 13 MB PDF does not sit in memory afterwards.
  const [previewing, setPreviewing] = useState(null);
  const blobUrls = useRef(new Map());

  useEffect(() => {
    if (!payload) return;
    setTo(payload.emailData?.to || '');
    setCc(payload.emailData?.cc || '');
    setSubject(payload.emailData?.subject || '');
    setBody(payload.emailData?.body || '');
    setError(null);
  }, [payload]);

  // Release the attachment blob URLs when the modal goes away.
  useEffect(() => {
    if (payload) return undefined;
    blobUrls.current.forEach(url => URL.revokeObjectURL(url));
    blobUrls.current.clear();
    setPreviewing(null);
    return undefined;
  }, [payload]);

  useEffect(() => () => {
    blobUrls.current.forEach(url => URL.revokeObjectURL(url));
    blobUrls.current.clear();
  }, []);

  useEffect(() => {
    if (!payload) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !sending) onClose?.(); };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [payload, sending, onClose]);

  if (!payload) return null;

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await Meteor.callAsync('orders.sendViaGraph', {
        orderId: payload.orderId,
        sessionId: localStorage.getItem('sessionId'),
        overrides: { to, cc, subject, body },
        // amend / cancel: the server rebuilds that ticket, not the original order
        ticketKind: payload.ticketKind || undefined
      });
      onSent?.(result);
      onClose?.();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setSending(false);
    }
  };

  /**
   * The escape hatch, in whichever form the device can actually use: a .eml
   * draft on desktop, and on a phone the old hand-off — attachments to Files,
   * then Outlook's compose deep link.
   */
  const handleFallback = () => {
    if (isMobileMailDevice()) {
      downloadOrderAttachments(payload);
      setTimeout(() => openOutlookCompose({ ...payload.emailData, to, cc, subject, body }), 400);
    } else {
      downloadEml(payload);
    }
    onClose?.();
  };

  const attachments = [
    { name: `${payload.fileReference || payload.orderReference}.pdf`, data: payload.pdfData, contentType: 'application/pdf' },
    ...(payload.termsheet
      ? [{
        name: payload.termsheet.name,
        data: payload.termsheet.content,
        contentType: payload.termsheet.contentType || guessContentType(payload.termsheet.name)
      }]
      : [])
  ].filter(a => a.data);

  /**
   * Blob URL for an attachment, built once and reused. The bytes are already in
   * the payload, so reviewing what is about to go out costs no round trip.
   */
  const urlFor = (attachment) => {
    const cached = blobUrls.current.get(attachment.name);
    if (cached) return cached;
    const binary = atob(attachment.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: attachment.contentType || 'application/octet-stream' }));
    blobUrls.current.set(attachment.name, url);
    return url;
  };

  const togglePreview = (attachment) => {
    const url = urlFor(attachment);
    // iOS renders only the first page of a PDF in an iframe, so a phone opens
    // the file in its own tab where the real viewer takes over.
    if (isMobile) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    setPreviewing(prev => (prev === attachment.name ? null : attachment.name));
  };

  const previewAttachment = attachments.find(a => a.name === previewing);

  const sizeOf = (base64) => {
    const bytes = Math.ceil((base64?.length || 0) * 0.75);
    return bytes > 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  // On a phone the 60px label column left the inputs too narrow to read an
  // address in, so labels sit above their field instead. 16px text is what
  // stops iOS zooming the whole page when a field takes focus.
  const labelStyle = isMobile
    ? { fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }
    : { fontSize: '11px', color: 'var(--text-muted)', width: '60px', flexShrink: 0, paddingTop: '7px' };
  const fieldStyle = {
    flex: 1, width: isMobile ? '100%' : undefined, boxSizing: 'border-box',
    padding: isMobile ? '9px 10px' : '6px 9px', borderRadius: '5px',
    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: isMobile ? '16px' : '12px'
  };
  const rowStyle = isMobile
    ? { display: 'block', marginBottom: '10px' }
    : { display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' };
  const mobileButton = isMobile
    ? { flex: '1 1 100%', padding: '12px 14px', fontSize: '14px', textAlign: 'center' }
    : {};

  const modal = (
    <div
      onClick={() => { if (!sending) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        // A phone gets a sheet anchored to the bottom, where the thumbs are.
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? '0' : '20px'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          borderRadius: isMobile ? '14px 14px 0 0' : '10px',
          width: isMobile ? '100%' : 'min(760px, 100%)',
          maxHeight: isMobile ? '94vh' : '92vh',
          // Keep the send button clear of the home indicator on an iPhone.
          paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : 0,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)'
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
          <strong style={{ color: 'var(--text-primary)', fontSize: '14px' }}>
            {payload.ticketKind === 'cancel' ? 'Send cancellation of order' : payload.ticketKind === 'amend' ? 'Send amendment of order' : 'Send order'} {payload.orderReference}
          </strong>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
            Sending from {mailbox || 'your Outlook mailbox'} — it will appear in your Sent Items.
          </div>
        </div>

        <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1 }}>
          {!payload.emailData?.to && (
            <div style={{
              marginBottom: '10px', padding: '8px 10px', borderRadius: '6px',
              background: 'rgba(245, 158, 11, 0.1)', color: 'var(--text-primary)', fontSize: '11px'
            }}>
              No desk email is configured at {payload.emailData?.bankName || 'this bank'} for{' '}
              {payload.emailData?.assetType || 'this asset type'} orders. Add the recipient below, and set it
              permanently in Bank Management.
            </div>
          )}

          <div style={rowStyle}>
            <span style={labelStyle}>To</span>
            <input type="text" value={to} onChange={e => setTo(e.target.value)} style={fieldStyle} placeholder="desk@bank.com" />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Cc</span>
            <input type="text" value={cc} onChange={e => setCc(e.target.value)} style={fieldStyle} />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Subject</span>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} style={fieldStyle} />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Message</span>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={isMobile ? 8 : 12}
              style={{ ...fieldStyle, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }}
            />
          </div>

          {/* Attachments are reviewable before the mail goes out: what the bank
              receives is a PDF the desk has never seen rendered otherwise. */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px', paddingLeft: isMobile ? 0 : '68px', alignItems: 'center' }}>
            {attachments.map(a => {
              const open = previewing === a.name;
              return (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => togglePreview(a)}
                  title={isMobile ? 'Open to review' : (open ? 'Hide the preview' : 'Preview before sending')}
                  style={{
                    padding: isMobile ? '7px 12px' : '3px 10px', borderRadius: '999px',
                    fontSize: isMobile ? '12px' : '11px', fontFamily: 'inherit',
                    border: `1px solid ${open ? '#0ea5e9' : 'var(--border-color)'}`,
                    background: open ? 'rgba(14,165,233,0.1)' : 'transparent',
                    color: open ? '#0ea5e9' : 'var(--text-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  📎 {a.name} · {sizeOf(a.data)} · {isMobile ? 'open' : (open ? 'hide' : 'preview')}
                </button>
              );
            })}
          </div>

          {previewAttachment && !isMobile && (
            <div style={{
              marginTop: '10px', marginLeft: '68px',
              border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden',
              background: 'var(--bg-primary)'
            }}>
              <iframe
                title={`Preview of ${previewAttachment.name}`}
                src={urlFor(previewAttachment)}
                style={{ width: '100%', height: '420px', border: 'none', display: 'block' }}
              />
              <div style={{ padding: '6px 10px', fontSize: '11px', borderTop: '1px solid var(--border-color)' }}>
                <a
                  href={urlFor(previewAttachment)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#0ea5e9', textDecoration: 'none' }}
                >
                  Open {previewAttachment.name} in a new tab
                </a>
              </div>
            </div>
          )}

          {error && (
            <div style={{
              marginTop: '12px', padding: '8px 10px', borderRadius: '6px',
              background: 'rgba(239, 68, 68, 0.1)', color: 'var(--loss-color)', fontSize: '12px'
            }}>
              {error}
            </div>
          )}
        </div>

        {/* column-reverse on a phone: the DOM keeps Send last (it is the
            primary action for a keyboard) while the thumb finds it on top. */}
        <div style={{
          padding: '12px 18px', borderTop: '1px solid var(--border-color)',
          display: 'flex', flexDirection: isMobile ? 'column-reverse' : 'row',
          gap: '10px', alignItems: 'center', flexWrap: 'wrap'
        }}>
          <button
            type="button"
            onClick={handleFallback}
            disabled={sending}
            style={{
              padding: '6px 12px', borderRadius: '5px', border: '1px solid var(--border-color)',
              background: 'transparent', color: 'var(--text-secondary)', fontSize: '12px',
              cursor: sending ? 'not-allowed' : 'pointer',
              ...mobileButton
            }}
          >
            {isMobile ? 'Open in Outlook app instead' : 'Download .eml instead'}
          </button>
          {!isMobile && <div style={{ flex: 1 }} />}
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            style={{
              padding: '6px 14px', borderRadius: '5px', border: '1px solid var(--border-color)',
              background: 'transparent', color: 'var(--text-secondary)', fontSize: '12px',
              cursor: sending ? 'not-allowed' : 'pointer',
              ...mobileButton
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !to.trim()}
            style={{
              padding: '6px 18px', borderRadius: '5px', border: 'none',
              background: (sending || !to.trim()) ? 'var(--border-color)' : '#0ea5e9',
              color: 'white', fontSize: '12px', fontWeight: 600,
              cursor: (sending || !to.trim()) ? 'not-allowed' : 'pointer',
              ...mobileButton,
              ...(isMobile ? { fontSize: '15px' } : {})
            }}
          >
            {sending ? 'Sending…' : 'Send mail'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
