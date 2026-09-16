import React, { useState, useEffect, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { OrdersCollection, ORDER_STATUSES, ASSET_TYPES, EMAIL_TRACE_TYPES, EMAIL_TRACE_LABELS, TERMSHEET_TRACE_TYPES, OrderHelpers, EXECUTION_TYPE_LABELS } from '/imports/api/orders';
import { UsersCollection } from '/imports/api/users';
import { BanksCollection } from '/imports/api/banks';
import { downloadEmlSequential } from '/imports/utils/emlBuilder.js';
import { useOrderEmailDelivery } from '../hooks/useOrderEmailDelivery.js';
import TracePreview from './TracePreview.jsx';
import { useProductTitles } from '../hooks/useProductTitles.js';

const REVIEW_LOCK_TTL_MS = 5 * 60 * 1000;

/**
 * Four-eyes review of a bulk (one product, several clients) in one panel.
 *
 * Each client is a row with their own instruction trace and a "compared" tick;
 * "Validate ticked" runs the ordinary per-order validation for each of them
 * through orders.validateBulk, so every four-eyes rule stays in one place.
 * Once validated, each client gets their own prefilled bank email draft.
 *
 * Membership comes from the orders.bulkGroup subscription rather than the
 * blotter's pending list, so members that have just been validated stay on
 * screen with their email button instead of vanishing.
 */
const BulkValidationPanel = ({
  groupId,
  user,
  lockedByOther = [],
  onClose,
  onOrderUpdate,
  onRejectClient,
  onRequestRevision,
  isMobile
}) => {
  const getSessionId = () => localStorage.getItem('sessionId');
  const sessionId = useMemo(() => localStorage.getItem('sessionId'), []);
  // Desktop: .eml drafts. Phone: Outlook compose deep link per client (one hand-off at a time).
  const { deliverOrderEmail, orderEmailSheet, isMobileMailDevice } = useOrderEmailDelivery();

  const { members, isLoading } = useTracker(() => {
    if (!sessionId || !groupId) return { members: [], isLoading: false };
    const handle = Meteor.subscribe('orders.bulkGroup', sessionId, groupId);
    if (!handle.ready()) return { members: [], isLoading: true };
    const raw = OrdersCollection.find({ bulkOrderGroupId: groupId }, { sort: { createdAt: 1 } }).fetch();
    const enriched = raw.map(order => {
      const formatted = OrderHelpers.formatOrderDetails(order);
      const client = order.clientId ? UsersCollection.findOne(order.clientId) : null;
      const creator = order.createdBy ? UsersCollection.findOne(order.createdBy) : null;
      const bank = order.bankId ? BanksCollection.findOne(order.bankId) : null;
      return {
        ...formatted,
        securityName: order.displayName || formatted.securityName,
        clientName: client
          ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || client.email
          : order.clientName || 'Unknown',
        createdByName: creator
          ? `${creator.profile?.firstName || ''} ${creator.profile?.lastName || ''}`.trim() || creator.email
          : order.createdByName || 'Unknown',
        bankName: bank?.name || order.bankName || ''
      };
    });
    return { members: enriched, isLoading: false };
  }, [sessionId, groupId]);

  const [compared, setCompared] = useState({});          // orderId -> bool
  const [signedUrls, setSignedUrls] = useState({});      // orderId -> { storedFileName: url }
  const [parsedEmails, setParsedEmails] = useState({});  // traceId -> parse result
  const [expanded, setExpanded] = useState({});          // orderId -> bool (preview open)
  const [validating, setValidating] = useState(false);
  const [emailPayloads, setEmailPayloads] = useState({}); // orderId -> { orderReference, emailData, pdfData }
  const [groupTermsheet, setGroupTermsheet] = useState(null);
  const [rowErrors, setRowErrors] = useState({});        // orderId -> message
  const [emailBusy, setEmailBusy] = useState(null);      // orderId | 'all'

  // Ticks so a lock that passed its TTL visually expires (see ValidationBlotter).
  const [, setLockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLockTick(t => t + 1), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const first = members[0] || null;
  // Ambervision product name for the block's ISIN (all members share it).
  const productTitles = useProductTitles(first?.isin ? [first.isin] : []);
  const blockSecurityName = (first?.isin && productTitles[first.isin]) || first?.securityName || '';
  const isOwnBlock = !!first && first.createdBy === user?._id;
  const isPending = (m) => m.status === ORDER_STATUSES.PENDING_VALIDATION;
  const isLockedByOther = (m) => {
    if (!m?.reviewingBy || m.reviewingBy === user?._id) return false;
    if (!m.reviewingAt) return false;
    return (Date.now() - new Date(m.reviewingAt).getTime()) < REVIEW_LOCK_TTL_MS;
  };
  const clientOrderTrace = (m) => (m.emailTraces || []).find(t => t.traceType === EMAIL_TRACE_TYPES.CLIENT_ORDER);
  const isValidated = (m) => ![
    ORDER_STATUSES.PENDING_VALIDATION,
    ORDER_STATUSES.REVISION_REQUESTED,
    ORDER_STATUSES.REJECTED,
    ORDER_STATUSES.CANCELLED,
    ORDER_STATUSES.DRAFT
  ].includes(m.status);

  const pendingMembers = members.filter(isPending);
  const validatedMembers = members.filter(isValidated);
  const memberIdsKey = members.map(m => m._id).join(',');

  // Signed URLs for every member's trace files, refreshed before the 5-minute
  // token expiry and when the tab regains focus.
  useEffect(() => {
    if (members.length === 0) return;
    let cancelled = false;
    const mint = async () => {
      const sid = getSessionId();
      const entries = await Promise.all(members.map(async (m) => {
        if (!(m.emailTraces || []).length) return [m._id, {}];
        try {
          const urls = await Meteor.callAsync('orders.getEmailTraceSignedUrls', { orderId: m._id, sessionId: sid });
          return [m._id, urls || {}];
        } catch (err) {
          console.error('[BulkValidationPanel] minting trace URLs failed:', err);
          return [m._id, {}];
        }
      }));
      if (!cancelled) setSignedUrls(Object.fromEntries(entries));
    };
    mint();
    const refresh = setInterval(mint, 4 * 60 * 1000);
    window.addEventListener('focus', mint);
    return () => {
      cancelled = true;
      clearInterval(refresh);
      window.removeEventListener('focus', mint);
    };
  }, [memberIdsKey]);

  // Parse .eml client instructions server-side for an inline reading.
  useEffect(() => {
    members.forEach((m) => {
      const trace = clientOrderTrace(m);
      if (!trace || !/\.eml$/i.test(trace.fileName || '') || parsedEmails[trace._id]) return;
      (async () => {
        try {
          const result = await Meteor.callAsync('orders.parseEmailTrace', { orderId: m._id, traceId: trace._id, sessionId: getSessionId() });
          if (result?.success) setParsedEmails(prev => ({ ...prev, [trace._id]: result }));
        } catch (err) {
          setParsedEmails(prev => ({ ...prev, [trace._id]: { error: err.reason || 'Failed to parse' } }));
        }
      })();
    });
  }, [memberIdsKey]);

  // Members sharing one instruction file (same owner, two accounts) show the
  // preview once; the others point at it.
  const sharedFileLeader = useMemo(() => {
    const leaders = {};
    const byKey = new Map();
    for (const m of members) {
      const trace = clientOrderTrace(m);
      if (!trace) continue;
      const key = `${trace.fileName}|${trace.fileSize || ''}`;
      if (byKey.has(key)) {
        leaders[m._id] = byKey.get(key);
      } else {
        byKey.set(key, m);
      }
    }
    return leaders; // orderId -> leader member
  }, [memberIdsKey, members.map(m => clientOrderTrace(m)?._id).join(',')]);

  const eligibleForValidation = pendingMembers.filter(m => compared[m._id] && !isLockedByOther(m) && m.createdBy !== user?._id);
  const tickableMembers = pendingMembers.filter(m => !isLockedByOther(m) && m.createdBy !== user?._id);

  const toggleAll = () => {
    const allTicked = tickableMembers.length > 0 && tickableMembers.every(m => compared[m._id]);
    setCompared(prev => {
      const next = { ...prev };
      tickableMembers.forEach(m => { next[m._id] = !allTicked; });
      return next;
    });
  };

  const handleValidateAll = async () => {
    if (eligibleForValidation.length === 0 || validating) return;
    setValidating(true);
    setRowErrors({});
    try {
      const orderIds = eligibleForValidation.map(m => m._id);
      const attestations = {};
      orderIds.forEach(id => { attestations[id] = true; });
      const result = await Meteor.callAsync('orders.validateBulk', {
        bulkOrderGroupId: groupId,
        orderIds,
        attestations,
        sessionId: getSessionId()
      });
      const payloads = {};
      (result.results || []).forEach(r => {
        payloads[r.orderId] = { orderReference: r.orderReference, emailData: r.emailData, pdfData: r.pdfData };
      });
      setEmailPayloads(prev => ({ ...prev, ...payloads }));
      if (result.termsheet) setGroupTermsheet(result.termsheet);
      const errors = {};
      (result.errors || []).forEach(e => { errors[e.orderId] = e.error; });
      setRowErrors(errors);
      // Validated members leave the tick list.
      setCompared(prev => {
        const next = { ...prev };
        Object.keys(payloads).forEach(id => { delete next[id]; });
        return next;
      });
      onOrderUpdate?.();
    } catch (err) {
      alert(err.reason || err.message || 'Bulk validation failed');
    } finally {
      setValidating(false);
    }
  };

  /** The email payload for a validated member: from this session or re-prepared. */
  const resolveEmailPayload = async (m) => {
    if (emailPayloads[m._id]) return { ...emailPayloads[m._id], termsheet: groupTermsheet };
    const result = await Meteor.callAsync('orders.prepareEmail', { orderId: m._id, sessionId: getSessionId() });
    if (!result?.pdfData || !result?.emailData) throw new Error('No email could be prepared for this order');
    const payload = { orderReference: result.orderReference || m.orderReference, emailData: result.emailData, pdfData: result.pdfData };
    setEmailPayloads(prev => ({ ...prev, [m._id]: payload }));
    if (!groupTermsheet && result.termsheet) setGroupTermsheet(result.termsheet);
    return { ...payload, termsheet: result.termsheet || groupTermsheet };
  };

  const warnIfNoDesk = (payload, m) => {
    if (!payload.emailData?.to) {
      alert(`No desk email is configured at ${payload.emailData?.bankName || m.bankName || 'this bank'} for ${m.assetTypeLabel || 'this asset type'} orders. The draft will open with an empty recipient — add the address in Bank Management.`);
    }
  };

  const handleOpenEmail = async (m) => {
    setEmailBusy(m._id);
    try {
      const payload = await resolveEmailPayload(m);
      warnIfNoDesk(payload, m);
      deliverOrderEmail(payload);
    } catch (err) {
      alert(err.reason || err.message || 'Could not prepare the email');
    } finally {
      setEmailBusy(null);
    }
  };

  const handleDownloadAll = async () => {
    if (validatedMembers.length === 0) return;
    setEmailBusy('all');
    try {
      const payloads = [];
      for (const m of validatedMembers) {
        try {
          payloads.push(await resolveEmailPayload(m));
        } catch (err) {
          console.error('[BulkValidationPanel] prepareEmail failed:', err);
        }
      }
      const missingDesk = payloads.filter(p => !p.emailData?.to).length;
      if (missingDesk > 0) {
        alert(`${missingDesk} draft${missingDesk > 1 ? 's have' : ' has'} no desk recipient — add the address in Bank Management, then fill it in before sending.`);
      }
      await downloadEmlSequential(payloads);
    } finally {
      setEmailBusy(null);
    }
  };

  const totalQuantity = members.reduce((sum, m) => sum + (Number(m.quantity) || 0), 0);
  const tracesOnFile = members.filter(m => !!clientOrderTrace(m)).length;
  const lockedIds = new Set(lockedByOther.map(l => l.orderId));

  const statusChip = (m) => {
    if (m.status === ORDER_STATUSES.PENDING_VALIDATION) {
      if (isLockedByOther(m) || lockedIds.has(m._id)) {
        return { label: `Locked by ${m.reviewingByName || 'another user'}`, color: 'var(--warning-color)', bg: 'rgba(245,158,11,0.12)' };
      }
      return { label: 'Pending validation', color: '#f97316', bg: 'rgba(249,115,22,0.12)' };
    }
    if (m.status === ORDER_STATUSES.REJECTED) return { label: 'Rejected', color: 'var(--loss-color)', bg: 'rgba(239,68,68,0.12)' };
    if (m.status === ORDER_STATUSES.REVISION_REQUESTED) return { label: 'Sent back for revision', color: '#e879f9', bg: 'rgba(232,121,249,0.12)' };
    if (m.status === ORDER_STATUSES.CANCELLED) return { label: 'Cancelled', color: 'var(--text-muted)', bg: 'var(--bg-secondary)' };
    return {
      label: m.validatedByName ? `Validated by ${m.validatedByName}` : (m.statusLabel || 'Validated'),
      color: 'var(--gain-color)', bg: 'rgba(16,185,129,0.12)'
    };
  };

  const chip = (text, color, bg) => (
    <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', color, background: bg, padding: '2px 7px', borderRadius: '4px', whiteSpace: 'nowrap' }}>{text}</span>
  );

  const detail = (label, value) => (value ? (
    <div>
      <div style={s.detailLabel}>{label}</div>
      <div style={s.detailValue}>{value}</div>
    </div>
  ) : null);

  return (
    <>
    {orderEmailSheet}
    <div
      style={{ ...s.overlay, alignItems: 'flex-start', overflowY: 'auto', padding: isMobile ? 0 : '40px 0' }}
      onClick={onClose}
    >
      <div
        style={{
          ...s.content,
          maxWidth: isMobile ? '100%' : '1100px',
          width: isMobile ? '100%' : '90%',
          minHeight: isMobile ? '100%' : undefined,
          borderRadius: isMobile ? 0 : '12px',
          padding: isMobile ? '14px' : '24px',
          margin: isMobile ? 0 : 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>Review Block</h3>
            {first && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {chip('BLOC', '#6366f1', 'rgba(99,102,241,0.12)')}
                <span style={{
                  fontSize: '12px', fontWeight: '700', textTransform: 'uppercase',
                  color: first.orderType === 'buy' ? 'var(--gain-color)' : 'var(--loss-color)',
                  padding: '3px 10px', borderRadius: '4px',
                  background: first.orderType === 'buy' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'
                }}>
                  {first.assetType === ASSET_TYPES.FX ? (first.fxDirectionFormatted || first.orderType) : first.orderType}
                </span>
                <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }} title={blockSecurityName !== first.securityName ? `Entered on the order as “${first.securityName}”` : undefined}>{blockSecurityName}</span>
                {first.assetType !== ASSET_TYPES.FX && (
                  <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{first.isin}</span>
                )}
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {members.length} client{members.length > 1 ? 's' : ''} · total {totalQuantity.toLocaleString()}{first.quantityUnitLabel ? ` ${first.quantityUnitLabel}` : ''}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Created by {first.createdByName || 'unknown'} · {first.createdAtFull || first.createdAtFormatted}
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer', padding: '4px' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {isLoading && <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>Loading block...</div>}

        {isOwnBlock && (
          <div style={{ marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.35)', fontSize: '12px', color: '#f97316', fontWeight: '600' }}>
            You created this block — another validator must approve it. Shown read-only.
          </div>
        )}

        {lockedByOther.length > 0 && (
          <div style={{ marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', fontSize: '12px', color: 'var(--warning-color)' }}>
            {lockedByOther.length} client{lockedByOther.length > 1 ? 's are' : ' is'} being reviewed by someone else and {lockedByOther.length > 1 ? 'are' : 'is'} excluded from this review.
          </div>
        )}

        {/* Shared block details, rendered once */}
        {first && (
          <div style={{ marginBottom: '14px', padding: '12px', borderRadius: '8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
            <div style={s.sectionTitle}>Block details</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))', gap: '10px' }}>
              {detail('Price', first.priceType !== 'market' && first.limitPriceFormatted ? `${first.priceTypeLabel} ${first.limitPriceFormatted}` : (first.priceTypeLabel || 'Market'))}
              {detail('Currency', first.currency)}
              {detail('Asset', first.assetTypeLabel)}
              {detail('Validity', first.validityType ? `${first.validityType.toUpperCase()}${first.validityDate ? ` ${first.validityDate}` : ''}` : null)}
              {detail('Counterparty', first.broker)}
              {detail('Settlement ccy', first.settlementCurrency)}
              {detail('Execution', EXECUTION_TYPE_LABELS?.[first.executionType] || first.executionType)}
              {detail('Instruction source', first.orderSource === 'phone' ? 'Phone' : 'Email')}
            </div>
            {/* Term sheet shared by the block: one link per term-sheet trace on the lead order */}
            {(() => {
              const tsTraces = (first.emailTraces || []).filter(t => TERMSHEET_TRACE_TYPES.has(t.traceType) && t.storedFileName);
              if (tsTraces.length === 0) return null;
              return (
                <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                  {tsTraces.map(t => {
                    const url = (signedUrls[first._id] || {})[t.storedFileName] || null;
                    return (
                      <button
                        key={t._id}
                        type="button"
                        disabled={!url}
                        title={t.fileName}
                        onClick={() => { if (url) window.open(url, '_blank', 'noopener'); }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          padding: '5px 10px', borderRadius: '6px', border: '1px solid rgba(139,92,246,0.4)',
                          background: 'rgba(139,92,246,0.08)', color: '#8b5cf6', fontSize: '12px', fontWeight: '600',
                          cursor: url ? 'pointer' : 'wait', maxWidth: '100%'
                        }}
                      >
                        <span>&#128196;</span>
                        <span>{EMAIL_TRACE_LABELS[t.traceType] || 'Term Sheet'}</span>
                        <span style={{ fontWeight: '400', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '260px' }}>{t.fileName}</span>
                        <span style={{ fontSize: '11px' }}>&#8599;</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            {first.notes && <div style={{ marginTop: '8px' }}>{detail('Notes', first.notes)}</div>}
            {first.bankComment && <div style={{ marginTop: '8px' }}>{detail('Comment for bank', first.bankComment)}</div>}
          </div>
        )}

        {/* One card per client */}
        <div style={s.sectionTitle}>
          Clients · {tracesOnFile}/{members.length} instruction{members.length > 1 ? 's' : ''} on file
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
          {members.map((m) => {
            const trace = clientOrderTrace(m);
            const leader = sharedFileLeader[m._id];
            const url = trace ? (signedUrls[m._id] || {})[trace.storedFileName] || null : null;
            const parsed = trace ? parsedEmails[trace._id] : null;
            const pending = isPending(m);
            const locked = isLockedByOther(m) || lockedIds.has(m._id);
            const own = m.createdBy === user?._id;
            const tickable = pending && !locked && !own;
            const st = statusChip(m);
            const showPreview = trace && (expanded[m._id] ?? !leader);
            const canOpenEmail = isValidated(m);

            return (
              <div key={m._id} style={{
                borderRadius: '8px', background: 'var(--bg-primary)',
                border: `1px solid ${rowErrors[m._id] ? 'rgba(239,68,68,0.5)' : 'var(--border-color)'}`,
                borderLeft: `3px solid ${canOpenEmail ? 'var(--gain-color)' : compared[m._id] ? '#6366f1' : trace ? '#f97316' : 'var(--loss-color)'}`,
                overflow: 'hidden'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', flexWrap: 'wrap' }}>
                  {/* Identity */}
                  <div style={{ flex: 2, minWidth: '180px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>{m.clientName}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {m.bankName}{m.portfolioCode ? ` - ${m.portfolioCode}` : ''}
                    </div>
                    <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{m.orderReference}</div>
                  </div>
                  {/* Quantity */}
                  <div style={{ flex: 1, minWidth: '90px', fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                    {m.quantityFormatted}{m.quantityUnitLabel ? <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}> {m.quantityUnitLabel}</span> : null}
                  </div>
                  {/* Instruction summary */}
                  <div style={{ flex: 3, minWidth: '200px', fontSize: '12px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {m.orderSource === 'phone' ? (
                      <>
                        <span>📞</span>
                        <span>{m.phoneCallTime ? `Call at ${new Date(m.phoneCallTime).toLocaleString()}` : 'No call time recorded'}</span>
                        {m.phoneCallLine && <span style={{ color: 'var(--text-muted)' }}>· {m.phoneCallLine}</span>}
                      </>
                    ) : trace ? (
                      <>
                        <span>📎</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '260px' }} title={trace.fileName}>{trace.fileName}</span>
                        {leader && (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>· same instruction as {leader.clientName}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpanded(prev => ({ ...prev, [m._id]: !showPreview }))}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '11px', fontWeight: '600', padding: 0 }}
                        >
                          {showPreview ? 'Hide' : 'Show'}
                        </button>
                      </>
                    ) : (
                      <span style={{ color: 'var(--loss-color)', fontWeight: '600' }}>No client instruction on file</span>
                    )}
                  </div>
                  {/* Status + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end', flex: 2, minWidth: '220px' }}>
                    {chip(st.label, st.color, st.bg)}
                    {tickable && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', color: compared[m._id] ? '#6366f1' : 'var(--text-secondary)' }}
                        title={trace ? 'I have compared this order to the client instruction' : 'No trace attached — attest that you independently reviewed the client instruction'}>
                        <input
                          type="checkbox"
                          checked={!!compared[m._id]}
                          onChange={(e) => setCompared(prev => ({ ...prev, [m._id]: e.target.checked }))}
                          style={{ cursor: 'pointer' }}
                        />
                        {trace ? 'Compared' : 'Attest compared'}
                      </label>
                    )}
                    {pending && !own && (
                      <>
                        <button
                          type="button"
                          style={{ ...s.smallBtn, borderColor: 'rgba(232,121,249,0.5)', color: '#e879f9' }}
                          disabled={locked || validating}
                          onClick={() => onRequestRevision?.(m)}
                          title="Send this client's order back to the creator"
                        >
                          Modify
                        </button>
                        <button
                          type="button"
                          style={{ ...s.smallBtn, borderColor: 'rgba(239,68,68,0.5)', color: 'var(--loss-color)' }}
                          disabled={locked || validating}
                          onClick={() => onRejectClient?.(m)}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {canOpenEmail && (
                      <button
                        type="button"
                        style={{ ...s.smallBtn, borderColor: 'var(--gain-color)', color: 'var(--gain-color)' }}
                        disabled={!!emailBusy}
                        onClick={() => handleOpenEmail(m)}
                        title="Download the prefilled bank email draft for this client"
                      >
                        {emailBusy === m._id ? 'Preparing…' : '📧 Open email'}
                      </button>
                    )}
                  </div>
                </div>
                {rowErrors[m._id] && (
                  <div style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--loss-color)', background: 'rgba(239,68,68,0.06)' }}>
                    {rowErrors[m._id]}
                  </div>
                )}
                {!trace && pending && m.clientOrderDeferred && (
                  <div style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}>
                    Creator {m.clientOrderDeferred.byName || 'unknown'} indicated they would attach the client order later.
                  </div>
                )}
                {showPreview && <TracePreview trace={trace} url={url} parsed={parsed} height={420} />}
              </div>
            );
          })}
        </div>

        {/* Footer: batch validation */}
        {pendingMembers.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {tickableMembers.length > 0 && (
                <button type="button" style={s.smallBtn} onClick={toggleAll} disabled={validating}>
                  {tickableMembers.every(m => compared[m._id]) ? 'Untick all' : 'Tick all'}
                </button>
              )}
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {eligibleForValidation.length} of {pendingMembers.length} pending ticked
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" style={s.cancelBtn} onClick={onClose} disabled={validating}>Close</button>
              <button
                type="button"
                style={{ ...s.validateBtn, opacity: (isOwnBlock || validating || eligibleForValidation.length === 0) ? 0.5 : 1, cursor: (isOwnBlock || validating || eligibleForValidation.length === 0) ? 'not-allowed' : 'pointer' }}
                disabled={isOwnBlock || validating || eligibleForValidation.length === 0}
                onClick={handleValidateAll}
                title={
                  isOwnBlock ? 'Cannot validate your own block (four-eyes)'
                  : eligibleForValidation.length === 0 ? 'Tick "Compared" on each client you have checked'
                  : `Validate ${eligibleForValidation.length} client order${eligibleForValidation.length > 1 ? 's' : ''}`
                }
              >
                {validating ? 'Validating…' : `Validate ${eligibleForValidation.length} ticked`}
              </button>
            </div>
          </div>
        )}

        {/* Bank emails: one draft per validated client */}
        {validatedMembers.length > 0 && (
          <div style={{ marginTop: '14px', padding: '12px', borderRadius: '8px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <div style={{ ...s.sectionTitle, marginBottom: 0, color: 'var(--gain-color)' }}>
                Bank emails · one draft per client ({validatedMembers.length})
              </div>
              {!isMobileMailDevice && (
                <button
                  type="button"
                  style={{ ...s.validateBtn, opacity: emailBusy ? 0.5 : 1 }}
                  disabled={!!emailBusy}
                  onClick={handleDownloadAll}
                  title="Download every draft, one after another"
                >
                  {emailBusy === 'all' ? 'Preparing…' : `Download all (${validatedMembers.length})`}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {validatedMembers.map((m) => {
                const to = emailPayloads[m._id]?.emailData?.to;
                return (
                  <div key={m._id} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12px', padding: '6px 8px', borderRadius: '6px', background: 'var(--bg-primary)' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: '600', color: 'var(--text-primary)' }}>{m.orderReference}</span>
                    <span style={{ flex: 2, minWidth: '140px', color: 'var(--text-primary)' }}>{m.clientName}</span>
                    <span style={{ flex: 2, minWidth: '140px', color: 'var(--text-secondary)' }}>{m.bankName}{m.portfolioCode ? ` - ${m.portfolioCode}` : ''}</span>
                    <span style={{ flex: 2, minWidth: '140px', color: emailPayloads[m._id] ? (to ? 'var(--text-muted)' : 'var(--warning-color)') : 'var(--text-muted)' }}>
                      {emailPayloads[m._id] ? (to || 'No desk email configured') : ''}
                    </span>
                    <button
                      type="button"
                      style={{ ...s.smallBtn, borderColor: 'var(--gain-color)', color: 'var(--gain-color)' }}
                      disabled={!!emailBusy}
                      onClick={() => handleOpenEmail(m)}
                    >
                      {emailBusy === m._id ? 'Preparing…' : '📧 Open email'}
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
              {isMobileMailDevice
                ? `Each email saves the order PDF${groupTermsheet ? ' and the termsheet' : ''} to Files and opens a prefilled Outlook draft; attach the PDF from Files › Downloads.`
                : `Each draft opens in Outlook with the order PDF${groupTermsheet ? ' and the termsheet' : ''} attached. Chrome may ask once to allow several downloads.`}
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
};

const s = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
  },
  content: {
    background: 'var(--bg-secondary)', borderRadius: '12px', padding: '24px',
    boxShadow: '0 20px 40px rgba(0,0,0,0.3)'
  },
  sectionTitle: {
    fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '8px'
  },
  detailLabel: {
    fontSize: '10px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '2px'
  },
  detailValue: { fontSize: '13px', color: 'var(--text-primary)', wordBreak: 'break-word' },
  smallBtn: {
    padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--border-color)',
    background: 'transparent', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap'
  },
  cancelBtn: {
    padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-color)',
    background: 'transparent', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
  },
  validateBtn: {
    padding: '8px 16px', borderRadius: '6px', border: 'none',
    background: 'var(--gain-color)', color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
  }
};

export default BulkValidationPanel;
