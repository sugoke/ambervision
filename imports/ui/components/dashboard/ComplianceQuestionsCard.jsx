import React, { useState, useEffect, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import Modal from '../common/Modal.jsx';
import {
  SizeableReviewDetail,
  StatusPill,
  consumePendingSizeableReviewId,
  SIZEABLE_OPEN_EVENT,
  styles
} from '../compliance/SizeableTransactionsModal.jsx';

/**
 * RM side of the sizeable transactions workflow: the compliance questions
 * addressed to this RM, and a modal to send the explanation back.
 *
 * Loads its own data and renders nothing when there is no question for the
 * user, so it can sit on the shared dashboard for every role.
 */
export default function ComplianceQuestionsCard({ onOpenClient }) {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await Meteor.callAsync('sizeableTransactions.listForRm', localStorage.getItem('sessionId')));
    } catch (err) {
      // Not an RM-side user: keep the card hidden
      setData(null);
    }
  }, []);

  useEffect(() => {
    load();
    // Opened from a "Compliance question" notification
    const openPending = () => {
      const pending = consumePendingSizeableReviewId();
      if (pending) {
        setOpenId(pending);
        load();
      }
    };
    openPending();
    window.addEventListener(SIZEABLE_OPEN_EVENT, openPending);
    return () => window.removeEventListener(SIZEABLE_OPEN_EVENT, openPending);
  }, [load]);

  if (!data || data.rows.length === 0) return null;

  const openRow = data.rows.find(r => r._id === openId) || null;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await Meteor.callAsync('sizeableTransactions.answer', { reviewId: openRow._id, answer }, localStorage.getItem('sessionId'));
      setAnswer('');
      setOpenId(null);
      await load();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setBusy(false);
    }
  };

  // Renders its own full-width grid cell so the cell disappears with the card
  return (
    <div className="av-col-12">
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
        <div style={cardTitle}>🛡️ Compliance questions</div>
        {data.toAnswerCount > 0 && (
          <span style={{ ...styles.pill, color: 'var(--loss-color)', background: 'color-mix(in srgb, var(--loss-color) 12%, transparent)' }}>
            {data.toAnswerCount} to answer
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {data.rows.map(row => (
          <div key={row._id} onClick={() => { setOpenId(row._id); setAnswer(''); setError(null); }} style={{ ...styles.rowCard, ...styles.rowHead }}>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{row.clientName}</div>
              <div style={styles.muted}>{row.accountText} · {row.kindLabel} · {row.whenText}</div>
            </div>
            <div style={{ fontWeight: 700, color: row.isIncoming ? 'var(--gain-color)' : 'var(--loss-color)', whiteSpace: 'nowrap' }}>
              {row.directionLabel} {row.amountEURText}
            </div>
            <StatusPill row={row} />
          </div>
        ))}
      </div>

      <Modal
        isOpen={!!openRow}
        onClose={() => setOpenId(null)}
        title={openRow ? `Compliance question — ${openRow.clientName}` : ''}
        size="large"
      >
        {openRow && (
          <div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
              <div style={{ fontWeight: 700, fontSize: '16px', color: openRow.isIncoming ? 'var(--gain-color)' : 'var(--loss-color)' }}>
                {openRow.directionLabel} {openRow.amountEURText}
              </div>
              <span style={styles.kindBadge}>{openRow.kindLabel}</span>
              <span style={styles.muted}>{openRow.whenText} · {openRow.accountText}</span>
              <StatusPill row={openRow} />
              {openRow.entityId && onOpenClient && (
                <button onClick={() => { setOpenId(null); onOpenClient(openRow.entityId); }} style={{ ...styles.clientLink, color: 'var(--accent-color)', fontSize: '13px', marginLeft: 'auto' }}>
                  Open client file →
                </button>
              )}
            </div>

            <SizeableReviewDetail row={openRow} />

            {!openRow.isDone && (
              <div style={styles.actions}>
                <label style={styles.sectionLabel}>{openRow.status === 'answered' ? 'Add to your explanation' : 'Your explanation / corroboration'}</label>
                <textarea
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  rows={4}
                  placeholder="Origin or destination of the funds, economic rationale, supporting documents provided…"
                  style={styles.textarea}
                />
                <div>
                  <button
                    onClick={send}
                    disabled={!answer.trim() || busy}
                    style={{ ...styles.primaryButton, opacity: (!answer.trim() || busy) ? 0.5 : 1 }}
                  >
                    {busy ? 'Sending…' : 'Send to compliance'}
                  </button>
                </div>
                {error && <div style={styles.error}>{error}</div>}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
    </div>
  );
}

const cardStyle = {
  background: 'var(--card-bg, var(--bg-secondary))', borderRadius: 'var(--radius, 14px)', padding: '20px',
  border: '1px solid var(--border-color)', boxShadow: 'var(--card-shadow)', boxSizing: 'border-box'
};
const cardTitle = { fontSize: '11.5px', fontWeight: 600, letterSpacing: '1.8px', textTransform: 'uppercase', color: 'var(--text-muted)' };
