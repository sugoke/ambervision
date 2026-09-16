import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  canShareOrderEmail,
  shareOrderEmail,
  buildMailtoUrl,
  openOutlookCompose,
  downloadOrderAttachments
} from '/imports/utils/emlBuilder.js';

/**
 * OrderEmailSheet — the phone replacement for the .eml draft, built for Outlook.
 *
 * iPhone/iPad cannot open a .eml as an editable message (Outlook attaches the
 * .eml itself to a blank email, which the desk cannot read), and no mobile
 * route both prefills the text and attaches a file. The sheet therefore walks
 * through the two steps that do work with Outlook:
 *   1. Save the order PDF (and termsheet) to Files.
 *   2. Open Outlook through its compose deep link with To/Cc/Subject/Body
 *      prefilled, then attach the PDF from Files > Downloads inside the draft.
 * The recipients and text are also shown with Copy buttons as a fallback, and
 * a mailto: link covers a device without Outlook.
 *
 * Portaled to <body>: the light theme's backdrop-filter wrappers trap
 * position:fixed descendants.
 */
const OrderEmailSheet = ({ payload, onClose }) => {
  const [copied, setCopied] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!payload) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [payload]);

  // Decoding the PDF to ask canShare() is not free; do it once per payload.
  const shareable = useMemo(() => (payload ? canShareOrderEmail(payload) : false), [payload]);

  if (!payload) return null;

  const { emailData = {}, orderReference, termsheet } = payload;
  const pdfName = `${orderReference || 'order'}.pdf`;
  const attachmentNames = [pdfName, termsheet?.name].filter(Boolean);
  const attachmentLabel = attachmentNames.length > 1 ? 'PDF + termsheet' : 'PDF';
  const recipients = (emailData.to || '').split(';').map(a => a.trim()).filter(Boolean).join(', ');
  const ccList = (emailData.cc || '').split(';').map(a => a.trim()).filter(Boolean).join(', ');

  const copy = async (key, text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable */ }
      document.body.removeChild(ta);
    }
    setCopied(key);
    setTimeout(() => setCopied(current => (current === key ? null : current)), 1500);
  };

  const handleSave = () => {
    downloadOrderAttachments(payload);
    setSaved(true);
  };

  const row = (key, label, value) => (
    <div style={s.row}>
      <div style={s.rowText}>
        <div style={s.label}>{label}</div>
        <div style={{ ...s.value, color: value ? 'var(--text-primary)' : 'var(--warning-color)' }}>
          {value || 'Not configured. Add the desk address in Bank Management.'}
        </div>
      </div>
      {value && (
        <button type="button" style={s.copyBtn} onClick={() => copy(key, value)}>
          {copied === key ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );

  const sheet = (
    <div style={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={s.sheet} role="dialog" aria-modal="true" aria-label="Send order email in Outlook">
        <div style={s.header}>
          <div style={{ minWidth: 0 }}>
            <div style={s.title}>Send order email in Outlook</div>
            <div style={s.subtitle}>{orderReference}</div>
          </div>
          <button type="button" style={s.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={s.content}>
          <div style={s.hint}>
            Outlook on a phone cannot open a .eml draft, and cannot receive text and an attachment together. Two steps instead:
          </div>

          <div style={s.step}>
            <div style={s.stepNumber}>1</div>
            <div style={s.stepBody}>
              <button type="button" style={s.secondaryBtn} onClick={handleSave}>
                {saved ? `Save ${attachmentLabel} again` : `Save ${attachmentLabel} to Files`}
              </button>
              <div style={s.stepHint}>Lands in Files › Downloads as {attachmentNames.join(' and ')}.</div>
            </div>
          </div>

          <div style={s.step}>
            <div style={s.stepNumber}>2</div>
            <div style={s.stepBody}>
              <button type="button" style={s.primaryBtn} onClick={() => openOutlookCompose(emailData)}>
                Open in Outlook
              </button>
              <div style={s.stepHint}>
                The draft opens with To, Cc, subject and text filled in. Tap the attachment icon › Files › Downloads and pick {pdfName}.
              </div>
            </div>
          </div>

          <div style={s.altLinks}>
            <a href={buildMailtoUrl(emailData)} style={s.altLink}>Outlook not installed? Open in the default mail app</a>
            {shareable && (
              <button type="button" style={s.altLinkBtn} onClick={() => shareOrderEmail(payload)}>
                Share the {attachmentLabel} to Outlook instead (attachment only, text to paste)
              </button>
            )}
          </div>

          <div style={s.sectionLabel}>Copy if needed</div>
          {row('to', 'To', recipients)}
          {ccList && row('cc', 'Cc', ccList)}
          {row('subject', 'Subject', emailData.subject)}

          <div style={s.row}>
            <div style={s.rowText}>
              <div style={s.label}>Body</div>
              <pre style={s.body}>{emailData.body || ''}</pre>
            </div>
            {emailData.body && (
              <button type="button" style={s.copyBtn} onClick={() => copy('body', emailData.body)}>
                {copied === 'body' ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
        </div>

        <div style={s.footer}>
          <button type="button" style={s.doneBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
};

const s = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 1200,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center'
  },
  sheet: {
    width: '100%',
    maxWidth: '640px',
    maxHeight: '92%',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    borderRadius: '16px 16px 0 0',
    border: '1px solid var(--border-color)',
    borderBottom: 'none',
    boxShadow: '0 -12px 40px rgba(0,0,0,0.35)',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '14px 16px',
    paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))',
    borderBottom: '1px solid var(--border-color)',
    flexShrink: 0
  },
  title: { fontSize: '1.05rem', fontWeight: 600 },
  subtitle: { fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '2px' },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: '1.6rem',
    width: '44px',
    height: '44px',
    cursor: 'pointer',
    flexShrink: 0
  },
  content: {
    padding: '14px 16px',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flex: 1
  },
  hint: { fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.45 },
  step: { display: 'flex', gap: '10px', alignItems: 'flex-start' },
  stepNumber: {
    flexShrink: 0,
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    background: 'var(--accent-color)',
    color: 'var(--accent-contrast, #fff)',
    fontWeight: 700,
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '9px'
  },
  stepBody: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' },
  stepHint: { fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '46px',
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid var(--accent-color)',
    background: 'var(--accent-color)',
    color: 'var(--accent-contrast, #fff)',
    fontWeight: 600,
    fontSize: '0.95rem',
    cursor: 'pointer'
  },
  secondaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '44px',
    padding: '10px 16px',
    borderRadius: '8px',
    border: '1px solid var(--accent-color)',
    background: 'var(--bg-primary)',
    color: 'var(--accent-color)',
    fontWeight: 600,
    fontSize: '0.9rem',
    textDecoration: 'none',
    textAlign: 'center',
    cursor: 'pointer'
  },
  altLinks: { display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '2px' },
  altLink: { fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'underline' },
  altLinkBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    textAlign: 'left',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  sectionLabel: {
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text-muted)',
    marginTop: '6px'
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: '8px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)'
  },
  rowText: { flex: 1, minWidth: 0 },
  label: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '3px' },
  value: { fontSize: '13px', wordBreak: 'break-word', lineHeight: 1.4 },
  body: {
    margin: 0,
    fontSize: '12.5px',
    fontFamily: 'inherit',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.45,
    color: 'var(--text-primary)',
    maxHeight: '220px',
    overflowY: 'auto'
  },
  copyBtn: {
    flexShrink: 0,
    minHeight: '36px',
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid var(--accent-color)',
    background: 'transparent',
    color: 'var(--accent-color)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  footer: {
    padding: '12px 16px',
    paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
    borderTop: '1px solid var(--border-color)',
    flexShrink: 0
  },
  doneBtn: {
    width: '100%',
    minHeight: '44px',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontWeight: 600,
    fontSize: '0.95rem',
    cursor: 'pointer'
  }
};

export default OrderEmailSheet;
