import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { GenericProductsCollection } from '/imports/api/genericProducts/collections.js';
import { EXAMPLE_DEFINITIONS } from '/imports/api/genericProducts/examples/index.js';
import { Section, Btn, Badge, thStyle, tdStyle, inputStyle } from './formControls.jsx';

const GenericProductList = ({ sessionId, onNew, onEdit, onReport }) => {
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  const [exampleIdx, setExampleIdx] = useState('');

  const { products, isReady } = useTracker(() => {
    const handle = Meteor.subscribe('genericProducts.list');
    return {
      products: GenericProductsCollection.find({}, { sort: { lastUpdated: -1 } }).fetch(),
      isReady: handle.ready()
    };
  }, []);

  const flash = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 6000);
  };

  const importExample = async () => {
    if (exampleIdx === '') return;
    const example = EXAMPLE_DEFINITIONS[Number(exampleIdx)];
    try {
      const { _id } = await Meteor.callAsync('genericProducts.save', example.name, example.definition, sessionId);
      flash(`Imported "${example.name}"`);
      onEdit(_id);
    } catch (e) {
      flash(e.reason || e.message, true);
    }
  };

  const evaluate = async (product) => {
    setBusyId(product._id);
    try {
      await Meteor.callAsync('genericProducts.evaluate', product._id, sessionId);
      flash(`Evaluated "${product.name}"`);
      onReport(product._id);
    } catch (e) {
      flash(e.reason || e.message, true);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (product) => {
    if (!window.confirm(`Delete "${product.name}" and its reports?`)) return;
    try {
      await Meteor.callAsync('genericProducts.remove', product._id, sessionId);
      flash(`Deleted "${product.name}"`);
    } catch (e) {
      flash(e.reason || e.message, true);
    }
  };

  return (
    <Section
      title="Composed products"
      subtitle="Each product is a data document composed of primitives — no template, no per-product code."
      actions={
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            style={{ ...inputStyle, width: '260px' }}
            value={exampleIdx}
            onChange={e => setExampleIdx(e.target.value)}
          >
            <option value="">Import example…</option>
            {EXAMPLE_DEFINITIONS.map((ex, i) => (
              <option key={i} value={i}>{ex.name.replace('Example — ', '')}</option>
            ))}
          </select>
          <Btn small onClick={importExample} disabled={exampleIdx === ''}>Import</Btn>
          <Btn small tone="primary" onClick={onNew}>＋ New product</Btn>
        </div>
      }
    >
      {message && (
        <div style={{
          padding: '0.5rem 0.75rem', borderRadius: '6px', marginBottom: '0.75rem', fontSize: '0.85rem',
          background: message.isError ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
          color: message.isError ? 'var(--danger-color)' : 'var(--success-color)'
        }}>
          {message.text}
        </div>
      )}

      {!isReady ? (
        <div style={{ color: 'var(--text-muted)', padding: '1rem' }}>Loading…</div>
      ) : products.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
          No composed products yet. Import an example or create one from scratch.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>ISIN</th>
              <th style={thStyle}>Underlyings</th>
              <th style={thStyle}>Observations</th>
              <th style={thStyle}>Last evaluated</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr key={p._id}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{p.name}</td>
                <td style={tdStyle}>{p.definition?.identity?.isin || '—'}</td>
                <td style={tdStyle}>
                  {(p.definition?.underlyings || []).map(u => u.ticker).join(', ') || '—'}
                </td>
                <td style={tdStyle}>{(p.definition?.schedule?.rows || []).length}</td>
                <td style={tdStyle}>
                  {p.lastEvaluatedAt ? new Date(p.lastEvaluatedAt).toLocaleString() : 'Never'}
                </td>
                <td style={tdStyle}><Badge tone={p.status === 'active' ? 'green' : 'gray'}>{p.status}</Badge></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <Btn small onClick={() => onEdit(p._id)}>Edit</Btn>
                    <Btn small tone="primary" onClick={() => evaluate(p)} disabled={busyId === p._id}>
                      {busyId === p._id ? 'Evaluating…' : 'Evaluate'}
                    </Btn>
                    <Btn small onClick={() => onReport(p._id)} disabled={!p.lastReportId}>Report</Btn>
                    <Btn small tone="danger" onClick={() => remove(p)}>Delete</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
};

export default GenericProductList;
