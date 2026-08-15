import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { GenericProductReportsCollection } from '/imports/api/genericProducts/collections.js';
import { BLOCK_REGISTRY } from './blockRegistry.js';
import { Btn, inputStyle } from '../formControls.jsx';

/**
 * Generic product report — pure display. The report document contains an
 * ordered blocks[] array with pre-formatted props; this component just maps
 * it through the block registry.
 */
const GenericProductReport = ({ sessionId, productId, onBack, onEdit }) => {
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { reports, isReady } = useTracker(() => {
    const handle = Meteor.subscribe('genericProductReports.forProduct', productId);
    return {
      reports: GenericProductReportsCollection.find({ productId }, { sort: { createdAt: -1 } }).fetch(),
      isReady: handle.ready()
    };
  }, [productId]);

  const report = selectedReportId
    ? reports.find(r => r._id === selectedReportId)
    : reports[0];

  const reEvaluate = async () => {
    setBusy(true);
    setError(null);
    try {
      await Meteor.callAsync('genericProducts.evaluate', productId, sessionId);
      setSelectedReportId(null); // jump to the new latest
    } catch (e) {
      setError(e.reason || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!isReady) return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>Loading report…</div>;

  if (!report) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ marginBottom: '1rem' }}>No report yet for this product.</div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
          <Btn onClick={onBack}>← Back</Btn>
          <Btn tone="primary" onClick={reEvaluate} disabled={busy}>{busy ? 'Evaluating…' : 'Run evaluation'}</Btn>
        </div>
        {error && <div style={{ marginTop: '1rem', color: 'var(--danger-color)' }}>{error}</div>}
      </div>
    );
  }

  const h = report.header || {};

  return (
    <div>
      {/* Toolbar */}
      <div style={{
        display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem',
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: '10px', padding: '0.75rem 1rem', flexWrap: 'wrap'
      }}>
        <Btn small onClick={onBack}>← Back</Btn>
        <Btn small onClick={onEdit}>Edit product</Btn>
        <div style={{ flex: 1 }} />
        {reports.length > 1 && (
          <select
            style={{ ...inputStyle, width: '260px' }}
            value={report._id}
            onChange={e => setSelectedReportId(e.target.value)}
          >
            {reports.map((r, i) => (
              <option key={r._id} value={r._id}>
                {i === 0 ? 'Latest — ' : ''}{new Date(r.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        )}
        <Btn small tone="primary" onClick={reEvaluate} disabled={busy}>{busy ? 'Evaluating…' : 'Re-run evaluation'}</Btn>
      </div>

      {error && <div style={{ color: 'var(--danger-color)', marginBottom: '1rem' }}>{error}</div>}

      {/* Header */}
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem'
      }}>
        <h2 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>{h.name}</h2>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <span><strong>ISIN</strong> {h.isinFormatted}</span>
          <span><strong>Issuer</strong> {h.issuer}</span>
          <span><strong>Notional</strong> {h.notionalFormatted}</span>
          <span><strong>Trade</strong> {h.tradeDateFormatted}</span>
          <span><strong>Value</strong> {h.valueDateFormatted}</span>
          <span><strong>Final obs.</strong> {h.finalObservationFormatted}</span>
          <span><strong>Maturity</strong> {h.maturityDateFormatted}</span>
          <span>{h.settlementLabel}</span>
        </div>
      </div>

      {/* Blocks — self-assembling from the report document */}
      {(report.blocks || []).map((block, i) => {
        const Component = BLOCK_REGISTRY[block.type];
        if (!Component) return null;
        return <Component key={i} {...block.props} />;
      })}
    </div>
  );
};

export default GenericProductReport;
