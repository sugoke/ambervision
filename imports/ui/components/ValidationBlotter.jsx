import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { OrdersCollection, ORDER_STATUSES, ASSET_TYPES, EMAIL_TRACE_TYPES, EMAIL_TRACE_LABELS, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, OrderFormatters, OrderHelpers } from '/imports/api/orders';
import { UsersCollection } from '/imports/api/users';
import { BanksCollection } from '/imports/api/banks';

/**
 * ValidationBlotter - Displays orders pending four-eyes validation
 *
 * Shows a compact table of PENDING_VALIDATION orders with approve/reject actions.
 * Auto-hides when no orders need validation or user lacks canValidateOrders.
 */
const ValidationBlotter = ({ user, onOrderUpdate }) => {
  const [rejectModalOrder, setRejectModalOrder] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [revisionModalOrder, setRevisionModalOrder] = useState(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [deleteModalOrder, setDeleteModalOrder] = useState(null);
  const [isActioning, setIsActioning] = useState(null);
  const [reviewOrder, setReviewOrder] = useState(null);
  // Inline-edit state for a sent-back order being revised by its creator
  const [editIsin, setEditIsin] = useState('');
  const [editSecurityName, setEditSecurityName] = useState('');
  const [editCurrency, setEditCurrency] = useState('');
  const [editAssetType, setEditAssetType] = useState('');
  // Security search (mirrors the new-order modal's securities.search autocomplete)
  const [secSearchQuery, setSecSearchQuery] = useState('');
  const [secSearchResults, setSecSearchResults] = useState([]);
  const [secSearching, setSecSearching] = useState(false);
  const [manualSecurity, setManualSecurity] = useState(false); // manual security entry when not in autocomplete
  const secSearchTimeout = useRef(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editPriceType, setEditPriceType] = useState('market');
  const [editLimitPrice, setEditLimitPrice] = useState('');
  const [editStopLoss, setEditStopLoss] = useState('');
  const [editTakeProfit, setEditTakeProfit] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editBroker, setEditBroker] = useState('');
  const [editFxRate, setEditFxRate] = useState('');
  const [editFxValueDate, setEditFxValueDate] = useState('');
  const [editFxForwardDate, setEditFxForwardDate] = useState('');
  const [editDepositTenor, setEditDepositTenor] = useState('');
  const [editDepositMaturityDate, setEditDepositMaturityDate] = useState('');
  const [editError, setEditError] = useState(null);
  // Validator attestation: required when no CLIENT_ORDER trace is attached at review time
  const [emailCompared, setEmailCompared] = useState(false);
  const [uploadingTrace, setUploadingTrace] = useState(false);
  const [parsedEmails, setParsedEmails] = useState({});
  const [selectedTraceType, setSelectedTraceType] = useState(null);
  const [aiCheckResult, setAiCheckResult] = useState(null); // { loading, result, error }
  const [aiCheckOrderId, setAiCheckOrderId] = useState(null);
  // Ticks every 30s purely to re-render so review locks past their 5-minute TTL
  // visually expire. The lock's staleness is time-based (Date.now() vs
  // reviewingAt) and reviewingAt never changes once set, so without this tick a
  // stale lock would stay frozen on screen — rows un-clickable and Validate
  // disabled — even though the server already permits a takeover.
  const [, setLockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLockTick(t => t + 1), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const getSessionId = () => localStorage.getItem('sessionId');

  // Inject spinner keyframes once
  useEffect(() => {
    if (!document.getElementById('orderModalSpinStyle')) {
      const style = document.createElement('style');
      style.id = 'orderModalSpinStyle';
      style.textContent = '@keyframes orderModalSpin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }
  }, []);

  const isStaff = ['superadmin', 'admin', 'rm', 'assistant', 'compliance', 'staff'].includes(user?.role);

  const sessionId = useMemo(() => localStorage.getItem('sessionId'), []);

  // Pure Meteor reactivity — subscribe + read from minimongo
  const { displayOrders, isLoading } = useTracker(() => {
    if (!isStaff || !sessionId) {
      return { displayOrders: [], isLoading: false };
    }

    const handle = Meteor.subscribe('orders', sessionId, {
      status: [ORDER_STATUSES.PENDING_VALIDATION, ORDER_STATUSES.PENDING_MODIFICATION, ORDER_STATUSES.REVISION_REQUESTED]
    });

    if (!handle.ready()) {
      return { displayOrders: [], isLoading: true };
    }

    const rawOrders = OrdersCollection.find(
      { status: { $in: [ORDER_STATUSES.PENDING_VALIDATION, ORDER_STATUSES.PENDING_MODIFICATION, ORDER_STATUSES.REVISION_REQUESTED] } },
      { sort: { createdAt: -1 } }
    ).fetch();

    // Enrich with client names from the already-subscribed users collection
    const enriched = rawOrders.map(order => {
      const formatted = OrderHelpers.formatOrderDetails(order);
      const client = order.clientId ? UsersCollection.findOne(order.clientId) : null;
      const creator = order.createdBy ? UsersCollection.findOne(order.createdBy) : null;
      const bank = order.bankId ? BanksCollection.findOne(order.bankId) : null;
      return {
        ...formatted,
        clientName: client
          ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || client.email
          : order.clientName || 'Unknown',
        createdByName: creator
          ? `${creator.profile?.firstName || ''} ${creator.profile?.lastName || ''}`.trim() || creator.email
          : order.createdByName || 'Unknown',
        bankName: bank?.name || order.bankName || ''
      };
    });

    return { displayOrders: enriched, isLoading: false };
  }, [isStaff, sessionId]);

  // Auto-run AI check when review modal opens with email traces
  useEffect(() => {
    if (!reviewOrder) {
      setAiCheckResult(null);
      setAiCheckOrderId(null);
      return;
    }
    if (reviewOrder.emailTraces?.length > 0 && aiCheckOrderId !== reviewOrder._id) {
      runAiCheck(reviewOrder._id);
    }
  }, [reviewOrder?._id]);

  const runAiCheck = async (orderId) => {
    setAiCheckResult({ loading: true });
    setAiCheckOrderId(orderId);
    try {
      const sid = getSessionId();
      const res = await Meteor.callAsync('orders.aiComplianceCheck', { orderId, sessionId: sid });
      setAiCheckResult({ loading: false, result: res.result });
    } catch (err) {
      setAiCheckResult({ loading: false, error: err.reason || err.message || 'AI check failed' });
    }
  };

  // ---- Review-lock helpers ---------------------------------------------------
  // Tells us if a given order is locked by someone OTHER than the current user
  // (with a still-fresh 5-minute claim). Used to gate the row click + the
  // Validate button so two reviewers can't race against each other.
  const REVIEW_LOCK_TTL_MS = 5 * 60 * 1000;
  const isLockedByOther = (order) => {
    if (!order?.reviewingBy || order.reviewingBy === user?._id) return false;
    if (!order.reviewingAt) return false;
    return (Date.now() - new Date(order.reviewingAt).getTime()) < REVIEW_LOCK_TTL_MS;
  };
  const lockHolderLabel = (order) => order?.reviewingByName || 'another user';

  const openReview = async (order) => {
    // Four-eyes: the creator must never claim the review lock — they can still
    // open the panel to view / revise, just without locking peers out. The
    // server enforces this too (orders.claimForReview rejects the creator).
    if (order.createdBy !== user?._id) {
      // Claim the lock first so peers see "Being reviewed by …" immediately.
      try {
        const sessionId = getSessionId();
        await Meteor.callAsync('orders.claimForReview', { orderId: order._id, sessionId });
      } catch (err) {
        alert(err.reason || err.message || 'Could not open this order for review.');
        return;
      }
    }
    setReviewOrder(order);
  };

  const closeReview = async () => {
    const current = reviewOrder;
    setReviewOrder(null);
    if (current?._id) {
      try {
        const sessionId = getSessionId();
        await Meteor.callAsync('orders.releaseReview', { orderId: current._id, sessionId });
      } catch (err) {
        // Releasing is best-effort — the 5-minute TTL will free it anyway.
        console.warn('[ValidationBlotter] releaseReview failed:', err);
      }
    }
  };

  // Closed-tab / navigation case is handled by the 5-min server-side TTL —
  // no explicit unmount-cleanup needed (and a useEffect-on-unmount captures
  // the wrong reviewOrder via stale closure anyway).

  // Reset the four-eyes attestation when switching between (or closing) review orders
  useEffect(() => {
    setEmailCompared(false);
  }, [reviewOrder?._id]);

  // Format a stored Date (or date string) to the yyyy-mm-dd value an <input type="date"> expects
  const toDateInputValue = (d) => {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  };

  // Is the current viewer the creator of a sent-back order (i.e. allowed to revise it)?
  const isRevising = reviewOrder?.status === ORDER_STATUSES.REVISION_REQUESTED
    && reviewOrder?.createdBy === user?._id;

  // Seed the inline-edit fields from the order whenever a sent-back order is opened by its creator
  useEffect(() => {
    setEditError(null);
    setSecSearchQuery('');
    setSecSearchResults([]);
    setManualSecurity(false);
    if (!isRevising) return;
    setEditIsin(reviewOrder.isin || '');
    setEditSecurityName(reviewOrder.securityName || '');
    setEditCurrency(reviewOrder.currency || '');
    setEditAssetType(reviewOrder.assetType || '');
    setEditQuantity(reviewOrder.quantity?.toString() || '');
    setEditPriceType(reviewOrder.priceType || 'market');
    setEditLimitPrice(reviewOrder.limitPrice?.toString() || '');
    setEditStopLoss(reviewOrder.stopLossPrice?.toString() || '');
    setEditTakeProfit(reviewOrder.takeProfitPrice?.toString() || '');
    setEditNotes(reviewOrder.notes || '');
    setEditBroker(reviewOrder.broker || '');
    setEditFxRate(reviewOrder.fxRate?.toString() || '');
    setEditFxValueDate(toDateInputValue(reviewOrder.fxValueDate));
    setEditFxForwardDate(toDateInputValue(reviewOrder.fxForwardDate));
    setEditDepositTenor(reviewOrder.depositTenor || '');
    setEditDepositMaturityDate(toDateInputValue(reviewOrder.depositMaturityDate));
  }, [reviewOrder?._id, isRevising]);

  // Debounced security search — same securities.search backend the new-order modal uses
  useEffect(() => {
    if (!isRevising || secSearchQuery.length < 2) {
      setSecSearchResults([]);
      return;
    }
    setSecSearching(true);
    if (secSearchTimeout.current) clearTimeout(secSearchTimeout.current);
    secSearchTimeout.current = setTimeout(async () => {
      try {
        const results = await Meteor.callAsync('securities.search', { query: secSearchQuery, limit: 15 }, getSessionId());
        setSecSearchResults(results || []);
      } catch (err) {
        console.error('[ValidationBlotter] security search failed:', err);
        setSecSearchResults([]);
      } finally {
        setSecSearching(false);
      }
    }, 300);
    return () => { if (secSearchTimeout.current) clearTimeout(secSearchTimeout.current); };
  }, [secSearchQuery, isRevising]);

  // Map a securities.search result's assetClass to our ASSET_TYPES (mirrors OrderModal)
  const assetClassToType = {
    equity: ASSET_TYPES.EQUITY,
    bond: ASSET_TYPES.BOND,
    structured_product: ASSET_TYPES.STRUCTURED_PRODUCT,
    fund: ASSET_TYPES.FUND,
    etf: ASSET_TYPES.ETF,
    fx: ASSET_TYPES.FX
  };

  const handleSelectNewSecurity = (result) => {
    setEditIsin(result.isin || '');
    setEditSecurityName(result.name || result.ticker || '');
    if (result.currency) setEditCurrency(result.currency);
    if (result.assetClass && assetClassToType[result.assetClass]) {
      setEditAssetType(assetClassToType[result.assetClass]);
    }
    setSecSearchQuery('');
    setSecSearchResults([]);
  };

  // Auto-parse .eml traces when review order is opened
  useEffect(() => {
    if (!reviewOrder) { setParsedEmails({}); return; }
    const emlTraces = (reviewOrder.emailTraces || []).filter(t =>
      (t.fileName || '').toLowerCase().endsWith('.eml')
    );
    emlTraces.forEach(async (trace) => {
      if (parsedEmails[trace._id]) return; // already parsed
      try {
        const sessionId = getSessionId();
        const result = await Meteor.callAsync('orders.parseEmailTrace', {
          orderId: reviewOrder._id, traceId: trace._id, sessionId
        });
        if (result?.success) {
          setParsedEmails(prev => ({ ...prev, [trace._id]: result }));
        }
      } catch (err) {
        console.error('Error parsing .eml:', err);
        setParsedEmails(prev => ({ ...prev, [trace._id]: { error: err.reason || 'Failed to parse' } }));
      }
    });

    // Also parse modification instruction file if it's an .eml
    const modFile = reviewOrder.pendingModification?.instructionFile;
    if (modFile && (modFile.fileName || '').toLowerCase().endsWith('.eml')) {
      const modKey = 'mod_' + reviewOrder._id;
      if (!parsedEmails[modKey]) {
        (async () => {
          try {
            const sessionId = getSessionId();
            const result = await Meteor.callAsync('orders.parseEmailTrace', {
              orderId: reviewOrder._id, traceId: modKey, sessionId
            });
            if (result?.success) {
              setParsedEmails(prev => ({ ...prev, [modKey]: result }));
            }
          } catch (err) {
            console.error('Error parsing modification .eml:', err);
            setParsedEmails(prev => ({ ...prev, [modKey]: { error: err.reason || 'Failed to parse' } }));
          }
        })();
      }
    }
  }, [reviewOrder?._id, reviewOrder?.emailTraces?.length, reviewOrder?.pendingModification?.instructionFile?.fileName]);

  // Build a .eml file (RFC 2822 MIME) with the PDF (and optional termsheet) attached
  const buildEmlFile = (emailData, pdfBase64, pdfFilename, termsheet) => {
    const boundary = '----=_NextPart_' + Date.now().toString(36);
    const to = emailData.to;
    const cc = emailData.cc || '';
    const subject = emailData.subject || '';
    const body = emailData.body || '';
    const extraAttachments = [];
    if (termsheet?.content && termsheet?.name) {
      extraAttachments.push({
        name: termsheet.name,
        content: termsheet.content,
        contentType: termsheet.contentType || 'application/octet-stream'
      });
    }

    const lines = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : null,
      `Subject: ${subject}`,
      'X-Unsent: 1',
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      body,
      '',
      `--${boundary}`,
      `Content-Type: application/pdf; name="${pdfFilename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${pdfFilename}"`,
      '',
      // Split base64 into 76-char lines per MIME spec
      ...pdfBase64.match(/.{1,76}/g),
      ''
    ];
    extraAttachments.forEach(att => {
      lines.push(
        `--${boundary}`,
        `Content-Type: ${att.contentType}; name="${att.name}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${att.name}"`,
        '',
        ...att.content.match(/.{1,76}/g),
        ''
      );
    });
    lines.push(`--${boundary}--`);

    return lines.filter(l => l !== null).join('\r\n');
  };

  const handleValidate = async (order) => {
    setIsActioning(order._id);
    try {
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('orders.validate', {
        orderId: order._id,
        sessionId,
        emailComparedAttestation: emailCompared
      });

      // After validation: download .eml with PDF attached
      // The .eml opens as a prefilled Outlook draft with To/CC/Subject/Body + PDF attachment
      // Tip: right-click the download in Chrome → "Always open files of this type" for auto-open
      if (result.pdfData && result.emailData) {
        const pdfFilename = `${result.orderReference || order.orderReference || 'order'}.pdf`;
        const emlContent = buildEmlFile(result.emailData, result.pdfData, pdfFilename, result.termsheet);
        const blob = new Blob([emlContent], { type: 'message/rfc822' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${result.orderReference || order.orderReference || 'order'}.eml`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      }
      onOrderUpdate?.();
    } catch (err) {
      alert(err.reason || err.message || 'Validation failed');
    } finally {
      setIsActioning(null);
    }
  };

  const handleUploadTrace = (file, traceType) => {
    if (!file || !reviewOrder) return;
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!EMAIL_TRACE_ACCEPTED_TYPES.includes(ext)) {
      alert(`File type ${ext} not accepted. Use: ${EMAIL_TRACE_ACCEPTED_TYPES.join(', ')}`);
      return;
    }
    if (file.size > EMAIL_TRACE_MAX_SIZE) {
      alert('File exceeds maximum size of 15MB');
      return;
    }
    setUploadingTrace(true);
    setSelectedTraceType(traceType);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(',')[1];
        const sid = getSessionId();
        await Meteor.callAsync('orders.uploadEmailTrace', {
          orderId: reviewOrder._id,
          traceType,
          fileName: file.name,
          base64Data: base64,
          mimeType: file.type || 'application/octet-stream',
          sessionId: sid
        });
        const updated = OrdersCollection.findOne(reviewOrder._id);
        if (updated) {
          const formatted = OrderHelpers.formatOrderDetails(updated);
          setReviewOrder({ ...formatted, clientName: reviewOrder.clientName, createdByName: reviewOrder.createdByName });
        }
      } catch (err) {
        alert(err.reason || err.message || 'Upload failed');
      } finally {
        setUploadingTrace(false);
        setSelectedTraceType(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleReject = async () => {
    if (!rejectModalOrder) return;
    setIsActioning(rejectModalOrder._id);
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.rejectValidation', {
        orderId: rejectModalOrder._id,
        reason: rejectionReason || null,
        sessionId
      });
      setRejectModalOrder(null);
      setRejectionReason('');
      onOrderUpdate?.();
    } catch (err) {
      alert(err.reason || err.message || 'Rejection failed');
    } finally {
      setIsActioning(null);
    }
  };

  const handleValidateModification = async (order) => {
    setIsActioning(order._id);
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.validateModification', { orderId: order._id, sessionId });
      closeReview();
      onOrderUpdate?.();
    } catch (err) {
      alert(err.reason || err.message || 'Validation failed');
    } finally {
      setIsActioning(null);
    }
  };

  const handleRejectModification = async () => {
    if (!rejectModalOrder) return;
    setIsActioning(rejectModalOrder._id);
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.rejectModification', {
        orderId: rejectModalOrder._id,
        reason: rejectionReason || null,
        sessionId
      });
      setRejectModalOrder(null);
      setRejectionReason('');
      onOrderUpdate?.();
    } catch (err) {
      alert(err.reason || err.message || 'Rejection failed');
    } finally {
      setIsActioning(null);
    }
  };

  const handleRequestRevision = async () => {
    if (!revisionModalOrder) return;
    setIsActioning(revisionModalOrder._id);
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.requestRevision', {
        orderId: revisionModalOrder._id,
        reason: revisionReason || null,
        sessionId
      });
      setRevisionModalOrder(null);
      setRevisionReason('');
    } catch (err) {
      alert(err.reason || err.message || 'Request revision failed');
    } finally {
      setIsActioning(null);
    }
  };

  // Creator revises a sent-back order in place, then resubmits it for validation
  const handleSaveAndResubmit = async (order) => {
    setEditError(null);

    // Basic validation before touching the server
    const qty = parseFloat(editQuantity);
    if (!(qty > 0)) {
      setEditError('Quantity must be greater than zero.');
      return;
    }
    const needsLimit = editPriceType !== 'market';
    if (needsLimit && !(parseFloat(editLimitPrice) > 0)) {
      setEditError('A price is required for non-market orders.');
      return;
    }

    if (!editIsin || !editSecurityName) {
      setEditError('A security (name and ISIN) is required.');
      return;
    }

    // Build the update payload — only the fields relevant to this asset type
    const updateData = {
      isin: editIsin,
      securityName: editSecurityName,
      currency: editCurrency || undefined,
      assetType: editAssetType || undefined,
      quantity: qty,
      priceType: editPriceType,
      notes: editNotes || undefined,
      broker: editBroker || undefined
    };
    if (needsLimit) {
      updateData.limitPrice = parseFloat(editLimitPrice);
    }
    if (editStopLoss !== '') updateData.stopLossPrice = parseFloat(editStopLoss);
    if (editTakeProfit !== '') updateData.takeProfitPrice = parseFloat(editTakeProfit);

    if (editAssetType === ASSET_TYPES.FX) {
      if (editFxRate !== '') updateData.fxRate = parseFloat(editFxRate);
      if (editFxValueDate) updateData.fxValueDate = editFxValueDate;
      if (editFxForwardDate) updateData.fxForwardDate = editFxForwardDate;
    }
    if (editAssetType === ASSET_TYPES.TERM_DEPOSIT) {
      if (editDepositTenor) updateData.depositTenor = editDepositTenor;
      if (editDepositMaturityDate) updateData.depositMaturityDate = editDepositMaturityDate;
    }

    setIsActioning(order._id);
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.update', { orderId: order._id, updateData, sessionId });
      await Meteor.callAsync('orders.resubmitForValidation', { orderId: order._id, sessionId });
      closeReview();
      onOrderUpdate?.();
    } catch (err) {
      setEditError(err.reason || err.message || 'Could not save and resubmit the order.');
    } finally {
      setIsActioning(null);
    }
  };

  // Creator discards a sent-back order entirely
  const handleDelete = async () => {
    if (!deleteModalOrder) return;
    setIsActioning(deleteModalOrder._id);
    try {
      const sessionId = getSessionId();
      await Meteor.callAsync('orders.delete', { orderId: deleteModalOrder._id, sessionId });
      setDeleteModalOrder(null);
      onOrderUpdate?.();
    } catch (err) {
      alert(err.reason || err.message || 'Delete failed');
    } finally {
      setIsActioning(null);
    }
  };

  // Don't render if not staff or no orders pending
  if (!isStaff || (!isLoading && displayOrders.length === 0)) {
    return null;
  }

  const canValidate = user?.canValidateOrders === true || user?.role === 'compliance';

  const isOwnOrder = (order) => order.createdBy === user._id;

  return (
    <>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.headerIcon}>⚠️</span>
            <span style={styles.headerTitle}>Orders Pending Validation</span>
            <span style={styles.badge}>{displayOrders.length}</span>
          </div>
          <span style={styles.headerSubtitle}>Four-eyes principle — a different person must validate each order</span>
        </div>

        {isLoading ? (
          <div style={styles.loading}>Loading...</div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Reference</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Created By</th>
                  <th style={styles.th}>WA</th>
                  <th style={styles.th}>Account</th>
                  <th style={styles.th}>Bank</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Security</th>
                  <th style={styles.th}>Asset</th>
                  <th style={styles.th}>Ccy</th>
                  <th style={styles.th}>Qty</th>
                  <th style={styles.th}>Price</th>
                  <th style={styles.th}>Broker</th>
                </tr>
              </thead>
              <tbody>
                {displayOrders.map(order => {
                  const locked = isLockedByOther(order);
                  // The creator can never validate their own order, so a peer's
                  // review lock must not block them from opening it to view or
                  // revise. openReview() skips claiming the lock for own orders.
                  const blocked = locked && !isOwnOrder(order);
                  return (
                  <tr key={order._id} style={{ ...styles.row, cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.55 : 1 }}
                    title={locked ? `Being reviewed by ${lockHolderLabel(order)}` : undefined}
                    onClick={() => {
                      if (blocked) {
                        alert(`This order is currently being reviewed by ${lockHolderLabel(order)}. Please wait until they finish or the 5-minute lock expires.`);
                        return;
                      }
                      openReview(order);
                    }}
                    onMouseEnter={(e) => { if (!blocked) Array.from(e.currentTarget.children).forEach(td => td.style.background = 'var(--bg-secondary)'); }}
                    onMouseLeave={(e) => Array.from(e.currentTarget.children).forEach(td => td.style.background = 'var(--bg-primary)')}
                  >
                    <td style={styles.td}>
                      <span style={{ fontFamily: 'monospace', fontWeight: '500' }}>
                        {order.orderReference}
                      </span>
                      {locked && (
                        <span style={{ marginLeft: '6px', fontSize: '9px', fontWeight: '700', color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase' }}
                          title={`Being reviewed by ${lockHolderLabel(order)}`}>
                          🔒 In review
                        </span>
                      )}
                      {order.status === 'pending_modification' && (
                        <span style={{ marginLeft: '6px', fontSize: '9px', fontWeight: '700', color: '#a855f7', background: 'rgba(168,85,247,0.1)', padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>
                          Modif.
                        </span>
                      )}
                      {order.status === 'revision_requested' && (
                        <span style={{ marginLeft: '6px', fontSize: '9px', fontWeight: '700', color: '#e879f9', background: 'rgba(232,121,249,0.1)', padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>
                          {isOwnOrder(order) ? 'Revise' : 'Revision'}
                        </span>
                      )}
                      {order.emailTraces?.some(t => t.traceType === 'client_order') && (
                        <span title="Client order email attached" style={{ marginLeft: '4px', fontSize: '12px', cursor: 'help' }}>📎</span>
                      )}
                    </td>
                    <td style={styles.td} title={order.createdAtFull}>{order.createdAtFormatted}</td>
                    <td style={styles.td}>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: isOwnOrder(order) ? '600' : '400',
                        color: isOwnOrder(order) ? '#f97316' : 'var(--text-primary)'
                      }}>
                        {order.createdByName}
                        {isOwnOrder(order) && <span style={{ fontSize: '10px', marginLeft: '4px' }}>(you)</span>}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                        {order.wealthAmbassadorFormatted || order.wealthAmbassador || ''}
                      </span>
                    </td>
                    <td style={styles.td}>{order.clientName}</td>
                    <td style={styles.td}>{order.bankName}</td>
                    <td style={styles.td}>
                      <span style={{
                        fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
                        color: order.orderType === 'buy' ? '#10b981' : '#ef4444',
                        padding: '2px 6px', borderRadius: '4px',
                        background: order.orderType === 'buy' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'
                      }}>
                        {order.orderType}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <div title={order.securityName} style={{ fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{order.securityName}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {order.assetType === ASSET_TYPES.FX ? (order.fxPairFormatted || 'FX') :
                         order.assetType === ASSET_TYPES.TERM_DEPOSIT ? (order.depositTenorLabel || 'TD') :
                         order.isin}
                      </div>
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{order.assetTypeLabel || ''}</span>
                    </td>
                    <td style={styles.td}>{order.currency || ''}</td>
                    <td style={styles.td}>{order.quantityFormatted}</td>
                    <td style={styles.td}>
                      {order.priceType !== 'market' && order.limitPrice
                        ? <span style={{ fontSize: '12px', fontWeight: '500' }} title={order.priceTypeLabel}>{order.limitPriceFormatted}</span>
                        : <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{order.priceTypeLabel || 'Market'}</span>
                      }
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{order.broker || ''}</span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review & Validate Modal */}
      {reviewOrder && (
        <div style={{ ...styles.modalOverlay, alignItems: 'flex-start', overflowY: 'auto', padding: '40px 0' }} onClick={() => closeReview()}>
          <div style={{ ...styles.modalContent, maxWidth: '1100px', margin: 'auto', background: 'var(--bg-secondary)' }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h3 style={{ ...styles.modalTitle, marginBottom: '4px' }}>Review Order</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>{reviewOrder.orderReference}</span>
                  <span style={{
                    fontSize: '12px', fontWeight: '700', textTransform: 'uppercase',
                    color: reviewOrder.orderType === 'buy' ? '#10b981' : '#ef4444',
                    padding: '3px 10px', borderRadius: '4px',
                    background: reviewOrder.orderType === 'buy' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'
                  }}>
                    {reviewOrder.orderType}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                    {reviewOrder.securityName}
                  </span>
                  <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    {reviewOrder.isin}
                  </span>
                </div>
              </div>
              <button
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer', padding: '4px' }}
                onClick={() => closeReview()}
              >
                ✕
              </button>
            </div>

            {/* AI Compliance Hint */}
            {reviewOrder.emailTraces?.length > 0 && (
              <div style={{
                marginBottom: '14px',
                borderRadius: '8px',
                border: `1px solid ${!aiCheckResult ? 'var(--border-color)' : aiCheckResult.loading ? 'var(--border-color)' : aiCheckResult.error ? 'rgba(239,68,68,0.3)' : aiCheckResult.result?.status === 'match' ? 'rgba(16,185,129,0.3)' : aiCheckResult.result?.status === 'mismatch' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
                background: !aiCheckResult ? 'var(--bg-secondary)' : aiCheckResult.loading ? 'var(--bg-secondary)' : aiCheckResult.error ? 'rgba(239,68,68,0.05)' : aiCheckResult.result?.status === 'match' ? 'rgba(16,185,129,0.05)' : aiCheckResult.result?.status === 'mismatch' ? 'rgba(239,68,68,0.05)' : 'rgba(245,158,11,0.05)',
                overflow: 'hidden'
              }}>
                {!aiCheckResult || aiCheckResult.loading ? (
                  <div style={{ padding: '10px 14px', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid var(--border-color)', borderTopColor: 'var(--accent-color)', borderRadius: '50%', animation: 'orderModalSpin 0.6s linear infinite' }} />
                    Analyzing email vs order...
                  </div>
                ) : aiCheckResult.error ? (
                  <div style={{ padding: '10px 14px', fontSize: '12px', color: '#ef4444' }}>
                    AI check failed: {aiCheckResult.error}
                  </div>
                ) : (
                  <div>
                    <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>
                        {aiCheckResult.result.status === 'match' ? '✅' : aiCheckResult.result.status === 'mismatch' ? '🚨' : '⚠️'}
                      </span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: aiCheckResult.result.status === 'match' ? '#10b981' : aiCheckResult.result.status === 'mismatch' ? '#ef4444' : '#f59e0b' }}>
                        {aiCheckResult.result.summary}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        AI hint
                        <span
                          style={{ cursor: 'pointer', opacity: 0.6, fontSize: '12px' }}
                          onClick={() => runAiCheck(reviewOrder._id)}
                          title="Re-run AI check"
                        >↻</span>
                      </span>
                    </div>
                    {aiCheckResult.result.checks?.length > 0 && (
                      <div style={{ padding: '0 14px 10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {aiCheckResult.result.checks.map((check, i) => (
                          <span key={i} style={{
                            fontSize: '11px', padding: '3px 8px', borderRadius: '4px',
                            background: check.status === 'ok' ? 'rgba(16,185,129,0.1)' : check.status === 'mismatch' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                            color: check.status === 'ok' ? '#10b981' : check.status === 'mismatch' ? '#ef4444' : '#f59e0b',
                            fontWeight: '600'
                          }} title={check.detail}>
                            {check.status === 'ok' ? '✓' : check.status === 'mismatch' ? '✗' : '!'} {check.field}
                          </span>
                        ))}
                      </div>
                    )}
                    {aiCheckResult.result.notes && (
                      <div style={{ padding: '0 14px 10px', fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                        {aiCheckResult.result.notes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Two-column layout: Order Details (left) | Email/Attachments (right) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '14px' }}>

            {/* LEFT COLUMN: Order Details */}
            <div>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px',
              padding: '14px', borderRadius: '8px', background: 'var(--bg-secondary)',
              marginBottom: '14px', fontSize: '12px'
            }}>
              <div><span style={styles.reviewLabel}>Security</span><div style={styles.reviewValue}>{reviewOrder.securityName}</div></div>
              <div><span style={styles.reviewLabel}>ISIN</span><div style={{ ...styles.reviewValue, fontFamily: 'monospace' }}>
                {reviewOrder.assetType === ASSET_TYPES.FX ? (reviewOrder.fxPairFormatted || 'FX') :
                 reviewOrder.assetType === ASSET_TYPES.TERM_DEPOSIT ? (reviewOrder.depositTenorLabel || 'TD') :
                 reviewOrder.isin}
              </div></div>
              <div><span style={styles.reviewLabel}>Asset Type</span><div style={styles.reviewValue}>{reviewOrder.assetTypeLabel}</div></div>
              <div><span style={styles.reviewLabel}>Currency</span><div style={styles.reviewValue}>{reviewOrder.currency}</div></div>
              <div><span style={styles.reviewLabel}>Quantity</span><div style={{ ...styles.reviewValue, fontWeight: '700', fontSize: '15px' }}>{reviewOrder.quantityFormatted}</div></div>
              <div><span style={styles.reviewLabel}>Order Type</span><div style={styles.reviewValue}>{reviewOrder.priceTypeLabel || 'Market'}</div></div>
              {(reviewOrder.priceType === 'limit' || reviewOrder.priceType === 'stop_limit') && reviewOrder.limitPrice && (
                <div><span style={styles.reviewLabel}>Limit Price</span><div style={{ ...styles.reviewValue, fontWeight: '700', color: '#0ea5e9' }}>{reviewOrder.limitPriceFormatted}</div></div>
              )}
              {reviewOrder.stopPrice && (
                <div><span style={styles.reviewLabel}>Stop Price</span><div style={{ ...styles.reviewValue, fontWeight: '700', color: '#f59e0b' }}>{OrderFormatters.formatWithCurrency(reviewOrder.stopPrice, reviewOrder.currency)}</div></div>
              )}
              {reviewOrder.stopLossPriceFormatted && (
                <div><span style={styles.reviewLabel}>Stop Loss</span><div style={{ ...styles.reviewValue, color: '#ef4444' }}>{reviewOrder.stopLossPriceFormatted}</div></div>
              )}
              {reviewOrder.takeProfitPriceFormatted && (
                <div><span style={styles.reviewLabel}>Take Profit</span><div style={{ ...styles.reviewValue, color: '#10b981' }}>{reviewOrder.takeProfitPriceFormatted}</div></div>
              )}
              {reviewOrder.estimatedValueFormatted && (
                <div><span style={styles.reviewLabel}>Est. Value</span><div style={{ ...styles.reviewValue, fontWeight: '700' }}>{reviewOrder.estimatedValueFormatted}</div></div>
              )}
              {reviewOrder.validityType && reviewOrder.validityType !== 'day' && (
                <div><span style={styles.reviewLabel}>Validity</span><div style={styles.reviewValue}>
                  {reviewOrder.validityType === 'gtc' ? 'Good Till Canceled' : reviewOrder.validityType === 'gtd' ? `Good Till ${reviewOrder.validityDateFormatted || reviewOrder.validityDate || 'Date'}` : reviewOrder.validityType}
                </div></div>
              )}
              {reviewOrder.settlementCurrency && (
                <div><span style={styles.reviewLabel}>Settlement Ccy</span><div style={styles.reviewValue}>{reviewOrder.settlementCurrency}</div></div>
              )}
              <div><span style={styles.reviewLabel}>Account Name</span><div style={{ ...styles.reviewValue, fontWeight: '600' }}>{reviewOrder.clientName}</div></div>
              <div><span style={styles.reviewLabel}>Bank / Account</span><div style={styles.reviewValue}>{reviewOrder.bankName || ''}{reviewOrder.portfolioCode ? ` - ${reviewOrder.portfolioCode}` : ''}</div></div>
              {reviewOrder.wealthAmbassador && (
                <div><span style={styles.reviewLabel}>Wealth Ambassador</span><div style={styles.reviewValue}>{reviewOrder.wealthAmbassador}</div></div>
              )}
              {reviewOrder.broker && (
                <div><span style={styles.reviewLabel}>Broker / Issuer</span><div style={styles.reviewValue}>{reviewOrder.broker}</div></div>
              )}
              {reviewOrder.underlyings && (
                <div style={{ gridColumn: 'span 2' }}><span style={styles.reviewLabel}>Underlyings</span><div style={styles.reviewValue}>{reviewOrder.underlyings}</div></div>
              )}
              {reviewOrder.linkedOrderGroup && (
                <div style={{ gridColumn: 'span 2' }}><span style={styles.reviewLabel}>Linked Group</span><div style={{ ...styles.reviewValue, fontFamily: 'monospace' }}>
                  {reviewOrder.linkedOrderGroup}{reviewOrder.linkedOrderType ? ` (${reviewOrder.linkedOrderType === 'take_profit' ? 'Take Profit' : reviewOrder.linkedOrderType === 'stop_loss' ? 'Stop Loss' : reviewOrder.linkedOrderType})` : ''}
                </div></div>
              )}
              {/* FX-specific */}
              {reviewOrder.assetType === ASSET_TYPES.FX && reviewOrder.fxSubtypeLabel && (
                <div><span style={styles.reviewLabel}>FX Type</span><div style={styles.reviewValue}>{reviewOrder.fxSubtypeLabel}</div></div>
              )}
              {reviewOrder.fxRateFormatted && (
                <div><span style={styles.reviewLabel}>Indicative Rate</span><div style={styles.reviewValue}>{reviewOrder.fxRateFormatted}</div></div>
              )}
              {reviewOrder.fxValueDateFormatted && (
                <div><span style={styles.reviewLabel}>Value Date</span><div style={styles.reviewValue}>{reviewOrder.fxValueDateFormatted}</div></div>
              )}
              {reviewOrder.fxForwardDateFormatted && (
                <div><span style={styles.reviewLabel}>Forward Date</span><div style={styles.reviewValue}>{reviewOrder.fxForwardDateFormatted}</div></div>
              )}
              {/* Term Deposit-specific */}
              {reviewOrder.depositTenorLabel && (
                <div><span style={styles.reviewLabel}>Tenor</span><div style={styles.reviewValue}>{reviewOrder.depositTenorLabel}</div></div>
              )}
              {reviewOrder.depositMaturityDateFormatted && (
                <div><span style={styles.reviewLabel}>Maturity Date</span><div style={styles.reviewValue}>{reviewOrder.depositMaturityDateFormatted}</div></div>
              )}
              <div><span style={styles.reviewLabel}>Created By</span><div style={{
                ...styles.reviewValue,
                fontWeight: isOwnOrder(reviewOrder) ? '700' : '400',
                color: isOwnOrder(reviewOrder) ? '#f97316' : 'var(--text-primary)'
              }}>{reviewOrder.createdByName}{isOwnOrder(reviewOrder) && ' (you)'}</div></div>
              <div><span style={styles.reviewLabel}>Created At</span><div style={styles.reviewValue}>{reviewOrder.createdAtFull || reviewOrder.createdAtFormatted}</div></div>
            </div>

            {/* Notes */}
            {reviewOrder.notes && (
              <div style={{
                padding: '12px 14px', borderRadius: '8px', marginBottom: '14px',
                background: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.2)'
              }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '6px' }}>
                  Client Instructions / Notes
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                  {reviewOrder.notes}
                </div>
              </div>
            )}

            {/* Revise panel — only the original creator of a sent-back order can edit & resubmit */}
            {isRevising && (
              <div style={{ padding: '14px', borderRadius: '8px', border: '2px solid #e879f9', background: 'rgba(232, 121, 249, 0.05)', marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#e879f9', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>
                  Revise Order
                </div>
                {reviewOrder.revisionReason && (
                  <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginBottom: '12px', padding: '8px 10px', borderRadius: '6px', background: 'rgba(232, 121, 249, 0.08)', border: '1px solid rgba(232, 121, 249, 0.25)' }}>
                    <span style={{ fontWeight: '700', color: '#e879f9' }}>
                      {reviewOrder.revisionRequestedByName ? `${reviewOrder.revisionRequestedByName} asked:` : 'Revision requested:'}
                    </span>{' '}
                    {reviewOrder.revisionReason}
                  </div>
                )}

                {/* Security — editable via the same securities.search autocomplete the new-order modal uses */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={styles.editLabel}>Security</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', marginBottom: '6px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {editSecurityName || '—'}
                      </div>
                      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {editIsin || '—'}{editCurrency ? ` | ${editCurrency}` : ''}{editAssetType ? ` | ${editAssetType}` : ''}
                      </div>
                    </div>
                  </div>
                  {manualSecurity ? (
                    /* Manual entry — for securities not in the autocomplete */
                    <div style={{ padding: '12px', borderRadius: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>Enter security details manually</span>
                        <button type="button" style={styles.linkBtn} onClick={() => setManualSecurity(false)}>Back to search</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={styles.editLabel}>Security Name</label>
                          <input type="text" style={styles.editInput} value={editSecurityName}
                            onChange={(e) => setEditSecurityName(e.target.value)} placeholder="e.g. Phoenix Autocallable on TSLA/AAPL" />
                        </div>
                        <div>
                          <label style={styles.editLabel}>ISIN</label>
                          <input type="text" style={styles.editInput} value={editIsin} maxLength={20}
                            onChange={(e) => setEditIsin(e.target.value.toUpperCase())} placeholder="e.g. CH1234567890" />
                        </div>
                        <div>
                          <label style={styles.editLabel}>Currency</label>
                          <input type="text" style={styles.editInput} value={editCurrency} maxLength={3}
                            onChange={(e) => setEditCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="EUR" />
                        </div>
                        <div>
                          <label style={styles.editLabel}>Asset Type</label>
                          <select style={styles.editInput} value={editAssetType} onChange={(e) => setEditAssetType(e.target.value)}>
                            <option value={ASSET_TYPES.EQUITY}>Equity</option>
                            <option value={ASSET_TYPES.BOND}>Bond</option>
                            <option value={ASSET_TYPES.STRUCTURED_PRODUCT}>Structured Product</option>
                            <option value={ASSET_TYPES.FUND}>Fund</option>
                            <option value={ASSET_TYPES.ETF}>ETF</option>
                            <option value={ASSET_TYPES.FX}>FX</option>
                            <option value={ASSET_TYPES.TERM_DEPOSIT}>Term Deposit</option>
                            <option value={ASSET_TYPES.OTHER}>Other</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        style={styles.editInput}
                        value={secSearchQuery}
                        onChange={(e) => setSecSearchQuery(e.target.value)}
                        placeholder="Search by name, ISIN, or ticker to change security..."
                      />
                      {secSearching && (
                        <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)' }}>
                          <div style={{ width: '14px', height: '14px', border: '2px solid var(--border-color)', borderTopColor: 'var(--accent-color)', borderRadius: '50%', animation: 'orderModalSpin 0.6s linear infinite' }} />
                        </div>
                      )}
                      {secSearchResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, marginTop: '4px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxHeight: '260px', overflowY: 'auto' }}>
                          {secSearchResults.map((result, idx) => (
                            <div
                              key={result._id || idx}
                              onClick={() => handleSelectNewSecurity(result)}
                              style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: idx < secSearchResults.length - 1 ? '1px solid var(--border-color)' : 'none' }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                <div style={{ fontWeight: '500', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.name || result.ticker}</div>
                                <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '3px', fontWeight: '500', flexShrink: 0,
                                  background: result.source === 'product' ? 'rgba(99, 102, 241, 0.15)' : result.source === 'eod' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                                  color: result.source === 'product' ? '#6366f1' : result.source === 'eod' ? '#f59e0b' : '#6b7280' }}>
                                  {result.source === 'product' ? 'Ambervision' : result.source === 'eod' ? 'EOD' : result.source === 'metadata' ? 'Local' : 'PMS'}
                                </span>
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                {result.isin} {result.ticker && result.ticker !== result.isin ? `| ${result.ticker}` : ''} {result.currency ? `| ${result.currency}` : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {!secSearching && secSearchQuery.length >= 2 && secSearchResults.length === 0 && (
                        <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>No securities found.</div>
                      )}
                      <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Can't find it?{' '}
                        <button type="button" style={styles.linkBtn} onClick={() => { setManualSecurity(true); setSecSearchQuery(''); setSecSearchResults([]); }}>
                          Enter manually
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
                  <div>
                    <label style={styles.editLabel}>Quantity</label>
                    <input type="number" style={styles.editInput} value={editQuantity}
                      onChange={(e) => setEditQuantity(e.target.value)} min="0" step="any" />
                  </div>
                  <div>
                    <label style={styles.editLabel}>Order Type</label>
                    <select style={styles.editInput} value={editPriceType}
                      onChange={(e) => setEditPriceType(e.target.value)}>
                      <option value="market">Market</option>
                      <option value="limit">Limit</option>
                      <option value="stop_limit">Stop Limit</option>
                      <option value="stop_loss">Stop Loss</option>
                      <option value="take_profit">Take Profit</option>
                    </select>
                  </div>
                  {editPriceType !== 'market' && (
                    <div>
                      <label style={styles.editLabel}>Price</label>
                      <input type="number" style={styles.editInput} value={editLimitPrice}
                        onChange={(e) => setEditLimitPrice(e.target.value)} min="0" step="any" />
                    </div>
                  )}
                  <div>
                    <label style={styles.editLabel}>Stop Loss (optional)</label>
                    <input type="number" style={styles.editInput} value={editStopLoss}
                      onChange={(e) => setEditStopLoss(e.target.value)} min="0" step="any" />
                  </div>
                  <div>
                    <label style={styles.editLabel}>Take Profit (optional)</label>
                    <input type="number" style={styles.editInput} value={editTakeProfit}
                      onChange={(e) => setEditTakeProfit(e.target.value)} min="0" step="any" />
                  </div>
                  <div>
                    <label style={styles.editLabel}>Broker / Issuer</label>
                    <input type="text" style={styles.editInput} value={editBroker}
                      onChange={(e) => setEditBroker(e.target.value)} />
                  </div>
                  {editAssetType === ASSET_TYPES.FX && (
                    <>
                      <div>
                        <label style={styles.editLabel}>Indicative Rate</label>
                        <input type="number" style={styles.editInput} value={editFxRate}
                          onChange={(e) => setEditFxRate(e.target.value)} min="0" step="any" />
                      </div>
                      <div>
                        <label style={styles.editLabel}>Value Date</label>
                        <input type="date" style={styles.editInput} value={editFxValueDate}
                          onChange={(e) => setEditFxValueDate(e.target.value)} />
                      </div>
                      <div>
                        <label style={styles.editLabel}>Forward Date</label>
                        <input type="date" style={styles.editInput} value={editFxForwardDate}
                          onChange={(e) => setEditFxForwardDate(e.target.value)} />
                      </div>
                    </>
                  )}
                  {editAssetType === ASSET_TYPES.TERM_DEPOSIT && (
                    <>
                      <div>
                        <label style={styles.editLabel}>Tenor</label>
                        <input type="text" style={styles.editInput} value={editDepositTenor}
                          onChange={(e) => setEditDepositTenor(e.target.value)} />
                      </div>
                      <div>
                        <label style={styles.editLabel}>Maturity Date</label>
                        <input type="date" style={styles.editInput} value={editDepositMaturityDate}
                          onChange={(e) => setEditDepositMaturityDate(e.target.value)} />
                      </div>
                    </>
                  )}
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={styles.editLabel}>Notes</label>
                    <textarea style={{ ...styles.editInput, minHeight: '60px', resize: 'vertical' }} value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)} rows={2} />
                  </div>
                </div>
              </div>
            )}

            </div>{/* END LEFT COLUMN */}

            {/* RIGHT COLUMN: Email / Attachments */}
            <div>
            {(() => {
              const traces = reviewOrder.emailTraces || [];

              const getTraceUrl = (trace) => `/order_traces/${reviewOrder._id}/${trace.storedFileName}`;
              const isPreviewable = (trace) => {
                const ext = (trace.fileName || '').toLowerCase();
                return ext.endsWith('.pdf') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') ||
                       ext.endsWith('.png') || ext.endsWith('.gif') || ext.endsWith('.html');
              };

              const traceSlots = [
                { type: EMAIL_TRACE_TYPES.CLIENT_ORDER, label: 'Client Order', icon: '📋', color: '#f97316', statusHint: null },
                // Only show Order to Bank and Bank Confirmation for orders past validation
                ...(reviewOrder.status !== ORDER_STATUSES.PENDING_VALIDATION && reviewOrder.status !== 'pending_modification' ? [
                  { type: EMAIL_TRACE_TYPES.ORDER_TO_BANK, label: 'Order to Bank', icon: '📤', color: '#0ea5e9', statusHint: 'Transmitted' },
                  { type: EMAIL_TRACE_TYPES.BANK_CONFIRMATION, label: 'Bank Confirmation', icon: '✅', color: '#10b981', statusHint: 'Executed' },
                ] : [])
              ];

              const triggerUpload = (traceType) => {
                if (uploadingTrace) return;
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = EMAIL_TRACE_ACCEPTED_TYPES.join(',');
                input.onchange = (e) => handleUploadTrace(e.target.files[0], traceType);
                input.click();
              };

              return (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '8px' }}>
                    Traces
                  </div>

                  {/* Phone order indicator */}
                  {reviewOrder.orderSource === 'phone' && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '8px 12px', marginBottom: '6px', borderRadius: '6px',
                      background: 'rgba(59, 130, 246, 0.06)', border: '1px solid rgba(59, 130, 246, 0.25)'
                    }}>
                      <span style={{ fontSize: '14px' }}>📞</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: '#3b82f6', textTransform: 'uppercase' }}>
                          Phone Order
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                          {reviewOrder.phoneCallTime
                            ? `Call at ${new Date(reviewOrder.phoneCallTime).toLocaleString()}`
                            : 'No call time recorded'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Trace slots */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {traceSlots.map(({ type, label, icon, color, statusHint }) => {
                      const trace = traces.find(t => t.traceType === type);
                      const previewable = trace && isPreviewable(trace);
                      const url = trace && getTraceUrl(trace);
                      const isImage = trace && /\.(jpg|jpeg|png|gif)$/i.test(trace.fileName || '');
                      const isEml = trace && /\.eml$/i.test(trace.fileName || '');
                      const parsed = trace && parsedEmails[trace._id];

                      return (
                        <div key={type} style={{
                          borderRadius: '6px', background: 'var(--bg-secondary)',
                          border: `1px solid ${trace ? color + '40' : 'var(--border-color)'}`, overflow: 'hidden'
                        }}>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '8px 12px'
                          }}>
                            <span style={{ fontSize: '14px' }}>{icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: color, textTransform: 'uppercase' }}>
                                {label}
                                {statusHint && <span style={{ fontWeight: '400', color: 'var(--text-muted)', textTransform: 'none', marginLeft: '6px' }}>→ {statusHint}</span>}
                              </div>
                              {trace ? (
                                trace.traceMode === 'phone' ? (
                                  <div style={{ fontSize: '12px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    &#9742; {trace.phoneCaller} &rarr; {trace.phoneCallee} ({new Date(trace.phoneCallTime).toLocaleString()})
                                  </div>
                                ) : (
                                  <div style={{ fontSize: '12px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {trace.fileName}
                                  </div>
                                )
                              ) : (
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Not attached</div>
                              )}
                            </div>
                            {!trace && (
                              <button
                                style={{
                                  padding: '4px 10px', borderRadius: '4px', border: `1px solid ${color}40`,
                                  background: `${color}10`, color: color, fontSize: '11px',
                                  fontWeight: '600', cursor: uploadingTrace ? 'wait' : 'pointer', whiteSpace: 'nowrap'
                                }}
                                onClick={() => triggerUpload(type)}
                                disabled={uploadingTrace}
                              >
                                {uploadingTrace && selectedTraceType === type ? 'Uploading...' : 'Attach'}
                              </button>
                            )}
                            {trace && (
                              <button
                                style={{
                                  padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--border-color)',
                                  background: 'transparent', color: 'var(--text-muted)', fontSize: '11px',
                                  fontWeight: '600', cursor: uploadingTrace ? 'wait' : 'pointer', whiteSpace: 'nowrap'
                                }}
                                onClick={() => triggerUpload(type)}
                                disabled={uploadingTrace}
                              >
                                Replace
                              </button>
                            )}
                          </div>

                          {/* Inline preview for attached trace */}
                          {trace && previewable && (
                            <div style={{ borderTop: '1px solid var(--border-color)', padding: '8px', background: 'var(--bg-primary)' }}>
                              {isImage ? (
                                <img
                                  src={url}
                                  alt={trace.fileName}
                                  style={{ maxWidth: '100%', maxHeight: '500px', display: 'block', margin: '0 auto', borderRadius: '4px' }}
                                />
                              ) : (
                                <iframe
                                  src={url}
                                  title={trace.fileName}
                                  style={{ width: '100%', height: '500px', border: 'none', borderRadius: '4px', background: '#fff' }}
                                />
                              )}
                            </div>
                          )}

                          {/* Inline preview for .eml (parsed server-side) */}
                          {trace && isEml && (
                            <div style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
                              {!parsed ? (
                                <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                                  Loading email...
                                </div>
                              ) : parsed.error ? (
                                <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#ef4444' }}>
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
                                        Attachments: {parsed.attachmentNames.join(', ')}
                                      </div>
                                    )}
                                  </div>
                                  {parsed.html ? (
                                    <iframe
                                      srcDoc={parsed.html}
                                      title="Email content"
                                      style={{ width: '100%', height: '400px', border: 'none', background: '#fff' }}
                                      sandbox="allow-same-origin"
                                    />
                                  ) : (
                                    <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.5', maxHeight: '400px', overflowY: 'auto' }}>
                                      {parsed.text}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* .msg files — download only */}
                          {trace && !previewable && !isEml && (
                            <div style={{ borderTop: '1px solid var(--border-color)', padding: '12px', textAlign: 'center' }}>
                              <button
                                style={{
                                  padding: '6px 16px', borderRadius: '4px', border: '1px solid var(--border-color)',
                                  background: 'transparent', color: 'var(--text-secondary)', fontSize: '12px',
                                  fontWeight: '600', cursor: 'pointer'
                                }}
                                onClick={() => {
                                  const a = document.createElement('a');
                                  a.href = url; a.download = trace.fileName; a.click();
                                }}
                              >
                                Download {trace.fileName}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Validator attestation: only when no CLIENT_ORDER trace is attached.
                Mirrors the OrderModal "Force sell" checkbox pattern visually. */}
            {(() => {
              const hasClientOrderTrace = (reviewOrder.emailTraces || []).some(t => t.traceType === EMAIL_TRACE_TYPES.CLIENT_ORDER);
              if (hasClientOrderTrace) return null;
              const deferred = reviewOrder.clientOrderDeferred;
              return (
                <div style={{
                  marginTop: '12px',
                  padding: '10px 12px',
                  background: emailCompared ? 'rgba(249, 115, 22, 0.08)' : 'var(--bg-secondary)',
                  border: `1px solid ${emailCompared ? '#f97316' : 'rgba(249, 115, 22, 0.35)'}`,
                  borderRadius: '8px'
                }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={emailCompared}
                      onChange={(e) => setEmailCompared(e.target.checked)}
                      style={{ marginTop: '2px', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: emailCompared ? '#f97316' : 'var(--text-primary)' }}>
                        I have compared this order to the original client instruction
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {deferred
                          ? `Creator ${deferred.byName || 'unknown'} indicated they would attach the client order later. Verify the instruction (email, chat, paper) before approving.`
                          : 'No client-order trace is attached. Confirm you have independently reviewed the source (email, chat, paper) before validating.'}
                      </div>
                    </div>
                  </label>
                </div>
              );
            })()}
            </div>{/* END RIGHT COLUMN */}

            </div>{/* END TWO-COLUMN GRID */}

            {/* Allocation Warning */}
            {reviewOrder.allocationWarning && reviewOrder.allocationWarning.breaches?.length > 0 && (
              <div style={{
                padding: '14px 16px', marginBottom: '14px', borderRadius: '8px',
                background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)'
              }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#f59e0b', marginBottom: '8px' }}>
                  Investment Profile Warning
                </div>
                {reviewOrder.allocationWarning.breaches.map((b, idx) => (
                  <div key={idx} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '5px 0', borderBottom: idx < reviewOrder.allocationWarning.breaches.length - 1 ? '1px solid rgba(245, 158, 11, 0.15)' : 'none',
                    fontSize: '12px'
                  }}>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)', textTransform: 'capitalize' }}>{b.category}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {b.current.toFixed(1)}% → <span style={{ color: '#f59e0b', fontWeight: '600' }}>{b.projected.toFixed(1)}%</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>limit {b.limit}%</span>
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  This order was flagged for exceeding the account's investment profile allocation limits.
                </div>
                {reviewOrder.allocationWarning.justification && (
                  <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginTop: '8px', padding: '8px 10px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.15)' }}>
                    <span style={{ fontWeight: '600', color: '#f59e0b', fontSize: '11px' }}>Justification:</span>{' '}
                    {reviewOrder.allocationWarning.justification}
                  </div>
                )}
              </div>
            )}

            {/* Modification History */}
            {reviewOrder.limitHistoryFormatted?.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '8px' }}>
                  Modification History
                </div>
                {reviewOrder.limitHistoryFormatted.map((entry, idx) => (
                  <div key={idx} style={{
                    fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px',
                    padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: '4px',
                    borderLeft: `3px solid ${entry.status === 'rejected' ? '#ef4444' : entry.validatedByName ? '#10b981' : 'var(--border-color)'}`
                  }}>
                    <div>
                      {entry.changedAtFormatted} — {entry.changedByName || 'Unknown'}
                      {entry.reason && <span style={{ color: 'var(--text-muted)' }}> — {entry.reason}</span>}
                    </div>
                    {entry.newPriceType && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {entry.priceTypeLabel}: {entry.price ?? '—'} → {entry.newPriceTypeLabel}: {entry.newPrice ?? '—'}
                        {entry.stopLossPrice !== undefined && ` | SL: ${entry.stopLossPrice ?? '—'} → ${entry.newStopLossPrice ?? '—'}`}
                        {entry.takeProfitPrice !== undefined && ` | TP: ${entry.takeProfitPrice ?? '—'} → ${entry.newTakeProfitPrice ?? '—'}`}
                      </div>
                    )}
                    {entry.validatedByName && (
                      <div style={{ fontSize: '11px', color: '#10b981', marginTop: '2px' }}>
                        Validated by {entry.validatedByName} on {entry.validatedAtFormatted}
                      </div>
                    )}
                    {entry.status === 'rejected' && (
                      <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '2px' }}>
                        Rejected by {entry.rejectedByName} on {entry.rejectedAtFormatted}
                        {entry.rejectionReason && ` — ${entry.rejectionReason}`}
                      </div>
                    )}
                    {entry.instructionFile && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        📎 {entry.instructionFile.fileName}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Pending Modification Details */}
            {reviewOrder.status === 'pending_modification' && reviewOrder.pendingModification && (() => {
              const mod = reviewOrder.pendingModification;
              const isModRequester = mod.requestedBy === user._id;
              const instrUrl = mod.instructionFile ? `/order_traces/${reviewOrder._id}/${mod.instructionFile.storedFileName}` : null;
              const instrPreviewable = mod.instructionFile && /\.(pdf|jpg|jpeg|png|gif|html)$/i.test(mod.instructionFile.fileName || '');
              const instrIsImage = mod.instructionFile && /\.(jpg|jpeg|png|gif)$/i.test(mod.instructionFile.fileName || '');
              const instrIsEml = mod.instructionFile && /\.eml$/i.test(mod.instructionFile.fileName || '');
              const modEmlKey = `mod_${reviewOrder._id}`;
              const parsedEml = instrIsEml ? parsedEmails[modEmlKey] : null;

              return (
                <div style={{ marginBottom: '14px', padding: '14px', borderRadius: '8px', border: '2px solid #a855f7', background: 'rgba(168, 85, 247, 0.05)' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#a855f7', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: '10px' }}>
                    Proposed Modification
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Requested by <strong style={{ color: 'var(--text-primary)' }}>{mod.requestedByName}</strong> on {new Date(mod.requestedAt).toLocaleString()}
                    {mod.reason && <span> — {mod.reason}</span>}
                  </div>

                  {/* Changes table */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', fontSize: '12px', marginBottom: '10px' }}>
                    <div style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Field</div>
                    <div style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Current</div>
                    <div style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>Proposed</div>

                    {mod.oldValues.priceType !== mod.newValues.priceType && (<>
                      <div>Price Type</div>
                      <div style={{ color: 'var(--text-secondary)' }}>{mod.oldValues.priceType}</div>
                      <div style={{ color: '#a855f7', fontWeight: '600' }}>{mod.newValues.priceType}</div>
                    </>)}

                    {mod.oldValues.limitPrice !== mod.newValues.limitPrice && (<>
                      <div>Limit Price</div>
                      <div style={{ color: 'var(--text-secondary)' }}>{mod.oldValues.limitPrice ?? '—'}</div>
                      <div style={{ color: '#a855f7', fontWeight: '600' }}>{mod.newValues.limitPrice ?? '—'}</div>
                    </>)}

                    {mod.oldValues.stopLossPrice !== mod.newValues.stopLossPrice && (<>
                      <div>Stop Loss</div>
                      <div style={{ color: '#ef4444' }}>{mod.oldValues.stopLossPrice ?? '—'}</div>
                      <div style={{ color: '#a855f7', fontWeight: '600' }}>{mod.newValues.stopLossPrice ?? '—'}</div>
                    </>)}

                    {mod.oldValues.takeProfitPrice !== mod.newValues.takeProfitPrice && (<>
                      <div>Take Profit</div>
                      <div style={{ color: '#10b981' }}>{mod.oldValues.takeProfitPrice ?? '—'}</div>
                      <div style={{ color: '#a855f7', fontWeight: '600' }}>{mod.newValues.takeProfitPrice ?? '—'}</div>
                    </>)}
                  </div>

                  {/* Client Instruction Preview */}
                  {instrUrl && (
                    <div style={{ borderRadius: '6px', border: '1px solid var(--border-color)', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
                      <div style={{ padding: '6px 10px', fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)' }}>
                        Client Instruction: {mod.instructionFile.fileName}
                      </div>
                      {instrPreviewable && (
                        <div style={{ padding: '8px', background: 'var(--bg-primary)' }}>
                          {instrIsImage ? (
                            <img src={instrUrl} alt="Client instruction" style={{ maxWidth: '100%', maxHeight: '400px', display: 'block', margin: '0 auto', borderRadius: '4px' }} />
                          ) : (
                            <iframe src={instrUrl} title="Client instruction" style={{ width: '100%', height: '400px', border: 'none', borderRadius: '4px', background: '#fff' }} />
                          )}
                        </div>
                      )}
                      {instrIsEml && !parsedEml && (
                        <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                          Loading email preview...
                        </div>
                      )}
                      {instrIsEml && parsedEml?.error && (
                        <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: '#ef4444' }}>
                          Failed to parse email: {parsedEml.error}
                        </div>
                      )}
                      {instrIsEml && parsedEml && !parsedEml.error && (
                        <div>
                          <div style={{ padding: '8px 10px', fontSize: '12px', borderBottom: '1px solid var(--border-color)' }}>
                            {parsedEml.from && <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>From:</strong> <span style={{ color: 'var(--text-primary)' }}>{parsedEml.from}</span></div>}
                            {parsedEml.to && <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>To:</strong> <span style={{ color: 'var(--text-primary)' }}>{parsedEml.to}</span></div>}
                            <div style={{ marginBottom: '3px' }}><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>Subject:</strong> <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{parsedEml.subject}</span></div>
                            {parsedEml.date && <div><strong style={{ color: 'var(--text-muted)', width: '50px', display: 'inline-block' }}>Date:</strong> <span style={{ color: 'var(--text-primary)' }}>{new Date(parsedEml.date).toLocaleString()}</span></div>}
                            {parsedEml.hasAttachments && (
                              <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '11px' }}>
                                Attachments: {parsedEml.attachmentNames.join(', ')}
                              </div>
                            )}
                          </div>
                          {parsedEml.html ? (
                            <iframe
                              srcDoc={parsedEml.html}
                              title="Email content"
                              style={{ width: '100%', height: '300px', border: 'none', background: '#fff' }}
                              sandbox="allow-same-origin"
                            />
                          ) : parsedEml.text ? (
                            <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.5', maxHeight: '300px', overflowY: 'auto' }}>{parsedEml.text}</div>
                          ) : (
                            <div style={{ padding: '10px', fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Email has no body content (calendar invitation or empty message)</div>
                          )}
                        </div>
                      )}
                      {!instrPreviewable && !instrIsEml && (
                        <div style={{ padding: '10px', textAlign: 'center' }}>
                          <button
                            style={{ padding: '6px 14px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                            onClick={() => { const a = document.createElement('a'); a.href = instrUrl; a.download = mod.instructionFile.fileName; a.click(); }}
                          >
                            Download {mod.instructionFile.fileName}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <button style={styles.modalCancelBtn} onClick={() => closeReview()}>
                Cancel
              </button>

              {reviewOrder.status === 'pending_modification' ? (
                <>
                  <button
                    style={{ ...styles.rejectBtn, padding: '8px 20px', fontSize: '13px', opacity: isActioning ? 0.5 : 1 }}
                    onClick={() => { setRejectModalOrder(reviewOrder); setRejectionReason(''); closeReview(); }}
                    disabled={!!isActioning}
                  >
                    Reject Modification
                  </button>
                  <button
                    style={{
                      ...styles.validateBtn, padding: '8px 20px', fontSize: '13px',
                      opacity: ((reviewOrder.pendingModification?.requestedBy === user._id) || isActioning || isLockedByOther(reviewOrder)) ? 0.5 : 1,
                      cursor: ((reviewOrder.pendingModification?.requestedBy === user._id) || isActioning || isLockedByOther(reviewOrder)) ? 'not-allowed' : 'pointer'
                    }}
                    onClick={async () => { await handleValidateModification(reviewOrder); }}
                    disabled={(reviewOrder.pendingModification?.requestedBy === user._id) || !!isActioning || isLockedByOther(reviewOrder)}
                    title={
                      (reviewOrder.pendingModification?.requestedBy === user._id) ? 'Cannot validate your own modification (four-eyes)'
                      : isLockedByOther(reviewOrder) ? `Being reviewed by ${lockHolderLabel(reviewOrder)}`
                      : 'Validate modification'
                    }
                  >
                    {isActioning === reviewOrder._id ? 'Validating...' : 'Validate Modification'}
                  </button>
                </>
              ) : reviewOrder.status === ORDER_STATUSES.REVISION_REQUESTED ? (
                <>
                  {editError && (
                    <div style={{ flex: 1, fontSize: '12px', color: '#ef4444', marginRight: '8px', alignSelf: 'center' }}>
                      {editError}
                    </div>
                  )}
                  {reviewOrder.createdBy === user._id ? (
                    <>
                      <button
                        style={{ ...styles.rejectBtn, padding: '8px 20px', fontSize: '13px', opacity: isActioning ? 0.5 : 1 }}
                        onClick={() => { const o = reviewOrder; closeReview(); setDeleteModalOrder(o); }}
                        disabled={!!isActioning}
                        title="Discard this order entirely"
                      >
                        Delete
                      </button>
                      <button
                        style={{ ...styles.validateBtn, padding: '8px 20px', fontSize: '13px', opacity: isActioning ? 0.5 : 1 }}
                        onClick={() => handleSaveAndResubmit(reviewOrder)}
                        disabled={!!isActioning}
                        title="Save your changes and send the order back to a validator"
                      >
                        {isActioning === reviewOrder._id ? 'Saving...' : 'Save & Resubmit'}
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Waiting for {reviewOrder.createdByName || 'creator'} to revise
                    </span>
                  )}
                </>
              ) : (
                <>
                  <button
                    style={{ ...styles.rejectBtn, padding: '8px 20px', fontSize: '13px', opacity: isActioning ? 0.5 : 1 }}
                    onClick={() => { setRejectModalOrder(reviewOrder); setRejectionReason(''); closeReview(); }}
                    disabled={!!isActioning}
                  >
                    Reject
                  </button>
                  <button
                    style={{
                      padding: '8px 20px', fontSize: '13px', borderRadius: '4px', border: 'none',
                      background: '#e879f9', color: '#fff', fontWeight: '600', cursor: 'pointer',
                      transition: 'opacity 0.15s',
                      opacity: isActioning ? 0.5 : 1
                    }}
                    onClick={() => { setRevisionModalOrder(reviewOrder); setRevisionReason(''); closeReview(); }}
                    disabled={!!isActioning}
                    title="Send back to creator for modifications"
                  >
                    Request Modification
                  </button>
                  {(() => {
                    const hasClientOrderTrace = (reviewOrder.emailTraces || []).some(t => t.traceType === EMAIL_TRACE_TYPES.CLIENT_ORDER);
                    const attestationMissing = !hasClientOrderTrace && !emailCompared;
                    const validateDisabled = isOwnOrder(reviewOrder) || !!isActioning || isLockedByOther(reviewOrder) || attestationMissing;
                    return (
                  <button
                    style={{
                      ...styles.validateBtn, padding: '8px 20px', fontSize: '13px',
                      opacity: validateDisabled ? 0.5 : 1,
                      cursor: validateDisabled ? 'not-allowed' : 'pointer'
                    }}
                    onClick={async () => { await handleValidate(reviewOrder); closeReview(); }}
                    disabled={validateDisabled}
                    title={
                      isOwnOrder(reviewOrder) ? 'Cannot validate your own order (four-eyes)'
                      : isLockedByOther(reviewOrder) ? `Being reviewed by ${lockHolderLabel(reviewOrder)}`
                      : attestationMissing ? 'Tick "I have compared this order to the original client instruction" first'
                      : 'Validate this order'
                    }
                  >
                    {isActioning === reviewOrder._id ? 'Validating...' : 'Validate Order'}
                  </button>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectModalOrder && (
        <div style={styles.modalOverlay} onClick={() => setRejectModalOrder(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>
              {rejectModalOrder.status === 'pending_modification' ? 'Reject Modification' : 'Reject Order'} {rejectModalOrder.orderReference}
            </h3>
            <p style={styles.modalDesc}>
              {rejectModalOrder.status === 'pending_modification'
                ? <>This will reject the modification and revert the order to its previous status.</>
                : <>This will reject the order for <strong>{rejectModalOrder.securityName}</strong> and notify the creator.</>
              }
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={styles.modalLabel}>Reason (optional)</label>
              <textarea
                style={styles.modalTextarea}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Enter rejection reason..."
                rows={3}
              />
            </div>
            <div style={styles.modalActions}>
              <button
                style={styles.modalCancelBtn}
                onClick={() => setRejectModalOrder(null)}
              >
                Cancel
              </button>
              <button
                style={{
                  ...styles.rejectBtn,
                  padding: '8px 20px',
                  fontSize: '13px',
                  opacity: isActioning ? 0.5 : 1
                }}
                onClick={rejectModalOrder.status === 'pending_modification' ? handleRejectModification : handleReject}
                disabled={!!isActioning}
              >
                {isActioning ? 'Rejecting...' : (rejectModalOrder.status === 'pending_modification' ? 'Reject Modification' : 'Reject Order')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Revision Reason Modal */}
      {revisionModalOrder && (
        <div style={styles.modalOverlay} onClick={() => setRevisionModalOrder(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>
              Request Modification — {revisionModalOrder.orderReference}
            </h3>
            <p style={styles.modalDesc}>
              This will send the order for <strong>{revisionModalOrder.securityName}</strong> back to {revisionModalOrder.createdByName || 'the creator'} for revision.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={styles.modalLabel}>What needs to be changed? (optional)</label>
              <textarea
                style={styles.modalTextarea}
                value={revisionReason}
                onChange={(e) => setRevisionReason(e.target.value)}
                placeholder="e.g. Wrong quantity, check the client instruction email..."
                rows={3}
              />
            </div>
            <div style={styles.modalActions}>
              <button
                style={styles.modalCancelBtn}
                onClick={() => setRevisionModalOrder(null)}
              >
                Cancel
              </button>
              <button
                style={{
                  padding: '8px 20px',
                  borderRadius: '4px',
                  border: 'none',
                  background: '#e879f9',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  opacity: isActioning ? 0.5 : 1
                }}
                onClick={handleRequestRevision}
                disabled={!!isActioning}
              >
                {isActioning ? 'Sending...' : 'Send Back for Revision'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deleteModalOrder && (
        <div style={styles.modalOverlay} onClick={() => setDeleteModalOrder(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Delete Order {deleteModalOrder.orderReference}</h3>
            <p style={styles.modalDesc}>
              This will permanently delete the order for <strong>{deleteModalOrder.securityName}</strong>. This cannot be undone.
            </p>
            <div style={styles.modalActions}>
              <button style={styles.modalCancelBtn} onClick={() => setDeleteModalOrder(null)}>
                Cancel
              </button>
              <button
                style={{ ...styles.rejectBtn, padding: '8px 20px', fontSize: '13px', opacity: isActioning ? 0.5 : 1 }}
                onClick={handleDelete}
                disabled={!!isActioning}
              >
                {isActioning ? 'Deleting...' : 'Delete Order'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Confirm Transmitted Modal */}
    </>
  );
};

const styles = {
  editLabel: {
    display: 'block',
    fontSize: '10px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    marginBottom: '4px'
  },
  editInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '7px 9px',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    fontSize: '13px',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)'
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: 'var(--accent-color)',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  container: {
    borderLeft: '4px solid #f97316',
    borderRadius: '8px',
    background: 'var(--bg-primary)',
    border: '1px solid rgba(249, 115, 22, 0.3)',
    borderLeftWidth: '4px',
    borderLeftColor: '#f97316',
    marginBottom: '16px',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'rgba(249, 115, 22, 0.08)',
    borderBottom: '1px solid rgba(249, 115, 22, 0.15)'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  headerIcon: {
    fontSize: '16px'
  },
  headerTitle: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#f97316',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '22px',
    height: '22px',
    borderRadius: '11px',
    background: '#f97316',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '700',
    padding: '0 6px'
  },
  headerSubtitle: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontStyle: 'italic'
  },
  loading: {
    padding: '20px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '13px'
  },
  tableWrapper: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px'
  },
  th: {
    padding: '8px 12px',
    textAlign: 'left',
    fontWeight: '600',
    fontSize: '11px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    borderBottom: '1px solid var(--border-color)',
    whiteSpace: 'nowrap',
    background: 'var(--bg-secondary)'
  },
  row: {
    borderBottom: '1px solid var(--border-color)',
    transition: 'background 0.15s'
  },
  td: {
    padding: '8px 12px',
    fontSize: '12px',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    background: 'var(--bg-primary)'
  },
  reviewBtn: {
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    background: '#0ea5e9',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.15s'
  },
  validateBtn: {
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    background: '#10b981',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.15s'
  },
  rejectBtn: {
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    background: '#ef4444',
    color: '#fff',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.15s'
  },
  // Reject modal styles
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000
  },
  modalContent: {
    background: 'var(--bg-primary)',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '440px',
    width: '90%',
    boxShadow: '0 20px 40px rgba(0,0,0,0.3)'
  },
  modalTitle: {
    margin: '0 0 8px 0',
    fontSize: '16px',
    fontWeight: '700',
    color: 'var(--text-primary)'
  },
  modalDesc: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    marginBottom: '16px',
    lineHeight: '1.5'
  },
  modalLabel: {
    display: 'block',
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    marginBottom: '6px'
  },
  modalTextarea: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontSize: '13px',
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box'
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px'
  },
  modalCancelBtn: {
    padding: '8px 20px',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  reviewLabel: {
    display: 'block',
    fontSize: '10px',
    fontWeight: '600',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    marginBottom: '2px'
  },
  reviewValue: {
    fontSize: '13px',
    color: 'var(--text-primary)',
    wordBreak: 'break-word'
  }
};

export default ValidationBlotter;
