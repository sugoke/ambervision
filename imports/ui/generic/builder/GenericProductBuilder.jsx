import React, { useState, useEffect, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { GenericProductsCollection } from '/imports/api/genericProducts/collections.js';
import { validateDefinition } from '/imports/api/genericProducts/definitionSchema.js';
import { compileCanvas } from '/imports/api/genericProducts/canvas/compile.js';
import { decompileDefinition } from '/imports/api/genericProducts/canvas/decompile.js';
import { createEmptyCanvas } from '/imports/api/genericProducts/canvas/canvasModel.js';
import { loopEnd } from '/imports/api/genericProducts/canvas/frequency.js';

// Legacy loops carried a fixed `count`; convert to an explicit `until` date so
// changing the frequency re-derives the number of observations against a fixed
// end date (rather than keeping a stale count).
function migrateLoops(lines, fallbackEnd) {
  return (lines || []).map(l => {
    if (l.lineType !== 'loop' || l.until) return l;
    const { count, ...rest } = l;
    return { ...rest, until: loopEnd(l, fallbackEnd) || '' };
  });
}
import { Btn, inputStyle } from '../formControls.jsx';
import { IdentitySection, UnderlyingsSection } from './sections.jsx';
import ScheduleTab from './ScheduleTab.jsx';
import JsonPreviewPanel from './JsonPreviewPanel.jsx';
import PalettePanel from '../canvas/PalettePanel.jsx';
import BlockCanvas from '../canvas/BlockCanvas.jsx';

const TABS = [
  { id: 'details', label: 'Details', icon: '📋' },
  { id: 'underlyings', label: 'Underlyings', icon: '📊' },
  { id: 'composer', label: 'Composer', icon: '🧱' },
  { id: 'schedule', label: 'Schedule', icon: '📅' }
];

const EMPTY_IDENTITY = {
  isin: '', issuer: '', currency: 'USD', notional: 1000000, denomination: 1000,
  tradeDate: '', valueDate: '', finalObservationDate: '', maturityDate: '', settlement: 'cash'
};

/**
 * Drag-and-drop builder. The canvas (lines of sentences) compiles to the
 * definition document the engine already evaluates; Identity + Underlyings
 * stay as compact panels above the canvas.
 */
const GenericProductBuilder = ({ sessionId, productId, onBack, onEvaluated }) => {
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState(EMPTY_IDENTITY);
  const [underlyings, setUnderlyings] = useState([]);
  const [lines, setLines] = useState(() => createEmptyCanvas().lines);
  const [meta, setMeta] = useState({ extraAccumulators: [], rawMeasures: {} });
  const [loadedId, setLoadedId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [tab, setTab] = useState(productId ? 'composer' : 'details');
  const [showJson, setShowJson] = useState(false);

  const { product, isReady } = useTracker(() => {
    if (!productId) return { product: null, isReady: true };
    const handle = Meteor.subscribe('genericProducts.byId', productId);
    return { product: GenericProductsCollection.findOne(productId), isReady: handle.ready() };
  }, [productId]);

  // Load once per product: prefer stored canvasModel, else decompile the definition.
  useEffect(() => {
    if (product && product._id !== loadedId) {
      setName(product.name || '');
      setIdentity(product.definition?.identity || EMPTY_IDENTITY);
      setUnderlyings(product.definition?.underlyings || []);
      const fallbackEnd = product.definition?.identity?.finalObservationDate;
      if (product.canvasModel?.lines) {
        setLines(migrateLoops(product.canvasModel.lines, fallbackEnd));
        setMeta(product.canvasModel.meta || { extraAccumulators: [], rawMeasures: {} });
      } else {
        const canvas = decompileDefinition(product.definition);
        setLines(migrateLoops(canvas.lines, fallbackEnd));
        setMeta(canvas.meta);
      }
      setLoadedId(product._id);
    }
  }, [product, loadedId]);

  const canvasModel = useMemo(() => ({ version: 1, lines, meta }), [lines, meta]);
  const definition = useMemo(
    () => compileCanvas({ identity, underlyings, canvasModel }),
    [identity, underlyings, canvasModel]
  );

  const { errors } = validateDefinition(definition);
  const canSave = errors.length === 0;

  // Shim so the reused Identity/Underlyings form sections keep their API.
  const headerObj = { identity, underlyings };
  const setHeader = (updater) => {
    const next = typeof updater === 'function' ? updater(headerObj) : updater;
    if (next.identity) setIdentity(next.identity);
    if (next.underlyings) setUnderlyings(next.underlyings);
  };

  const flash = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 6000);
  };

  const save = async () => {
    setBusy('save');
    try {
      if (productId) {
        await Meteor.callAsync('genericProducts.update', productId, name || 'Untitled product', definition, sessionId, canvasModel);
        flash('Saved');
        return productId;
      }
      const { _id } = await Meteor.callAsync('genericProducts.save', name || 'Untitled product', definition, sessionId, canvasModel);
      flash('Saved');
      return _id;
    } catch (e) {
      flash(e.reason || e.message, true);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const saveAndEvaluate = async () => {
    const id = await save();
    if (!id) return;
    setBusy('evaluate');
    try {
      await Meteor.callAsync('genericProducts.evaluate', id, sessionId);
      onEvaluated(id);
    } catch (e) {
      flash(e.reason || e.message, true);
    } finally {
      setBusy(null);
    }
  };

  if (productId && !isReady) {
    return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>Loading product…</div>;
  }

  const tabBtn = (t) => (
    <button
      key={t.id}
      onClick={() => setTab(t.id)}
      style={{
        padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
        border: 'none', borderBottom: `2px solid ${tab === t.id ? 'var(--accent-color)' : 'transparent'}`,
        background: 'transparent', color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)'
      }}
    >
      {t.icon} {t.label}
    </button>
  );

  return (
    <DndProvider backend={HTML5Backend}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.5rem',
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: '10px', padding: '0.75rem 1rem'
      }}>
        <Btn small onClick={onBack}>← Back</Btn>
        <input
          type="text"
          style={{ ...inputStyle, width: '300px', fontWeight: 600 }}
          value={name}
          placeholder="Product name"
          onChange={e => setName(e.target.value)}
        />
        {/* Validity pill — click to reveal the definition panel + its errors */}
        <span
          onClick={() => setShowJson(s => !s)}
          title={canSave ? 'Definition is valid' : errors.join('\n')}
          style={{
            cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '999px',
            background: canSave ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            color: canSave ? 'var(--success-color)' : 'var(--danger-color)'
          }}
        >
          {canSave ? '✓ valid' : `⚠ ${errors.length} issue${errors.length === 1 ? '' : 's'}`}
        </span>
        <div style={{ flex: 1 }} />
        {message && (
          <span style={{ fontSize: '0.8rem', color: message.isError ? 'var(--danger-color)' : 'var(--success-color)' }}>
            {message.text}
          </span>
        )}
        <Btn small onClick={() => setShowJson(s => !s)}>{showJson ? 'Hide definition' : 'Show definition'}</Btn>
        <Btn onClick={save} disabled={!canSave || !!busy} title={canSave ? '' : 'Fix validation errors first'}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </Btn>
        <Btn tone="primary" onClick={saveAndEvaluate} disabled={!canSave || !!busy}>
          {busy === 'evaluate' ? 'Evaluating…' : 'Save & Evaluate'}
        </Btn>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1rem' }}>
        {TABS.map(tabBtn)}
      </div>

      {/* Tab content (+ optional JSON drawer on the right) */}
      <div style={{ display: 'grid', gridTemplateColumns: showJson ? 'minmax(0, 1fr) 360px' : '1fr', gap: '1rem', alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          {tab === 'details' && <IdentitySection definition={headerObj} setDefinition={setHeader} />}
          {tab === 'underlyings' && <UnderlyingsSection definition={headerObj} setDefinition={setHeader} sessionId={sessionId} />}
          {tab === 'composer' && (
            <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
              <PalettePanel underlyings={underlyings} />
              <div style={{ minWidth: 0 }}>
                <BlockCanvas lines={lines} onChange={setLines} underlyings={underlyings} finalObservationDate={identity.finalObservationDate} />
              </div>
            </div>
          )}
          {tab === 'schedule' && <ScheduleTab lines={lines} onChange={setLines} finalObservationDate={identity.finalObservationDate} />}
        </div>
        {showJson && <JsonPreviewPanel definition={definition} />}
      </div>
    </DndProvider>
  );
};

export default GenericProductBuilder;
