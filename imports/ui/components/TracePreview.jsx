import React from 'react';

/**
 * Inline preview of one order trace file, as shown to a four-eyes validator.
 *
 * - images render inline, PDFs / HTML in an iframe (both via a signed URL)
 * - .eml files show the parsed headers and body (parsed server-side by
 *   orders.parseEmailTrace; `parsed` is that result, or undefined while loading)
 * - anything else (.msg) offers a download
 *
 * Display only: the caller resolves the URL and the parsed email.
 */
export const isPreviewableTrace = (trace) => {
  const name = (trace?.fileName || '').toLowerCase();
  return name.endsWith('.pdf') || name.endsWith('.jpg') || name.endsWith('.jpeg') ||
         name.endsWith('.png') || name.endsWith('.gif') || name.endsWith('.html');
};

const TracePreview = ({ trace, url, parsed, height = 500 }) => {
  if (!trace) return null;
  const fileName = trace.fileName || '';
  const isImage = /\.(jpg|jpeg|png|gif)$/i.test(fileName);
  const isEml = /\.eml$/i.test(fileName);
  const previewable = isPreviewableTrace(trace);

  if (previewable) {
    return (
      <div style={{ borderTop: '1px solid var(--border-color)', padding: '8px', background: 'var(--bg-primary)' }}>
        {!url ? (
          <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>Loading preview...</div>
        ) : isImage ? (
          <img
            src={url}
            alt={fileName}
            style={{ maxWidth: '100%', maxHeight: `${height}px`, display: 'block', margin: '0 auto', borderRadius: '4px' }}
          />
        ) : (
          <iframe
            src={url}
            title={fileName}
            style={{ width: '100%', height: `${height}px`, border: 'none', borderRadius: '4px', background: '#fff' }}
          />
        )}
      </div>
    );
  }

  if (isEml) {
    return (
      <div style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
        {!parsed ? (
          <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
            Loading email...
          </div>
        ) : parsed.error ? (
          <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--loss-color)' }}>
            Could not parse email: {parsed.error}
          </div>
        ) : (
          <div>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)', fontSize: '12px' }}>
              <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>From:</strong> <span style={{ color: 'var(--text-primary)' }}>{parsed.from}</span></div>
              <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>To:</strong> <span style={{ color: 'var(--text-primary)' }}>{parsed.to}</span></div>
              <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>Subject:</strong> <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{parsed.subject}</span></div>
              {parsed.date && (
                <div><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>Date:</strong> <span style={{ color: 'var(--text-primary)' }}>{new Date(parsed.date).toLocaleString()}</span></div>
              )}
              {parsed.hasAttachments && (
                <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '11px' }}>
                  Attachments: {(parsed.attachmentNames || []).join(', ')}
                </div>
              )}
            </div>
            {parsed.html ? (
              <iframe
                srcDoc={parsed.html}
                title="Email content"
                style={{ width: '100%', height: `${Math.max(height - 100, 200)}px`, border: 'none', background: '#fff' }}
                sandbox="allow-same-origin"
              />
            ) : (
              <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.5', maxHeight: `${Math.max(height - 100, 200)}px`, overflowY: 'auto' }}>
                {parsed.text}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // .msg and other binary formats: download only
  return (
    <div style={{ borderTop: '1px solid var(--border-color)', padding: '12px', textAlign: 'center' }}>
      <button
        type="button"
        style={{
          padding: '6px 16px', borderRadius: '4px', border: '1px solid var(--border-color)',
          background: 'transparent', color: 'var(--text-secondary)', fontSize: '12px',
          fontWeight: '600', cursor: url ? 'pointer' : 'wait'
        }}
        disabled={!url}
        onClick={() => {
          if (!url) return;
          const a = document.createElement('a');
          a.href = url; a.download = fileName; a.click();
        }}
      >
        Download {fileName}
      </button>
    </div>
  );
};

export default TracePreview;
