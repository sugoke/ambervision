import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { Section, Field, TextInput, NumberInput, DateInput, Select, Btn, Row } from '../formControls.jsx';

/**
 * Identity + Underlyings panels — the two parts of the product that aren't
 * draggable concepts. Everything else is composed on the drag-and-drop canvas.
 */

// ---------------------------------------------------------------- Identity
export function IdentitySection({ definition, setDefinition }) {
  const identity = definition.identity;
  const set = (patch) => setDefinition(d => ({ ...d, identity: { ...d.identity, ...patch } }));
  return (
    <Section title="Identity" subtitle="The wrapper: ISIN, issuer, dates, notional.">
      <Row wrap>
        <Field label="ISIN" width="160px"><TextInput value={identity.isin} onChange={v => set({ isin: v.toUpperCase() })} placeholder="XS…" /></Field>
        <Field label="Issuer" width="220px"><TextInput value={identity.issuer} onChange={v => set({ issuer: v })} /></Field>
        <Field label="Currency" width="90px"><TextInput value={identity.currency} onChange={v => set({ currency: v.toUpperCase() })} /></Field>
        <Field label="Notional" width="130px"><NumberInput value={identity.notional} onChange={v => set({ notional: v })} /></Field>
        <Field label="Denomination" width="110px"><NumberInput value={identity.denomination} onChange={v => set({ denomination: v })} /></Field>
        <Field label="Settlement" width="120px">
          <Select value={identity.settlement} options={[['cash', 'Cash'], ['physical', 'Physical']]} onChange={v => set({ settlement: v })} />
        </Field>
      </Row>
      <Row wrap>
        <Field label="Trade date" width="150px"><DateInput value={identity.tradeDate} onChange={v => set({ tradeDate: v })} /></Field>
        <Field label="Value date (initial fixing)" width="150px"><DateInput value={identity.valueDate} onChange={v => set({ valueDate: v })} /></Field>
        <Field label="Final observation" width="150px"><DateInput value={identity.finalObservationDate} onChange={v => set({ finalObservationDate: v })} /></Field>
        <Field label="Maturity (settlement)" width="150px"><DateInput value={identity.maturityDate} onChange={v => set({ maturityDate: v })} /></Field>
      </Row>
    </Section>
  );
}

// ------------------------------------------------------------- Underlyings
export function UnderlyingsSection({ definition, setDefinition, sessionId }) {
  const [fetching, setFetching] = useState(null);
  const underlyings = definition.underlyings || [];
  const setList = (list) => setDefinition(d => ({ ...d, underlyings: list }));
  const setAt = (i, patch) => setList(underlyings.map((u, j) => (j === i ? { ...u, ...patch } : u)));

  const nextId = () => {
    let n = 1;
    while (underlyings.some(u => u.id === `u${n}`)) n++;
    return `u${n}`;
  };

  const fetchFixing = async (i) => {
    const u = underlyings[i];
    if (!u.fullTicker || !definition.identity.valueDate) return;
    setFetching(i);
    try {
      const r = await Meteor.callAsync('genericProducts.lookupFixing', u.fullTicker, definition.identity.valueDate, sessionId);
      setAt(i, { initialFixing: r.close });
    } catch (e) {
      alert(e.reason || e.message);
    } finally {
      setFetching(null);
    }
  };

  return (
    <Section
      title="Underlyings"
      subtitle="Each leaf produces a performance: close ÷ initial fixing × 100 (100 = flat)."
      actions={<Btn small onClick={() => setList([...underlyings, { id: nextId(), ticker: '', fullTicker: '', name: '', isin: '', initialFixing: null, basis: 'performance' }])}>＋ underlying</Btn>}
    >
      {underlyings.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No underlyings yet.</div>}
      {underlyings.map((u, i) => (
        <Row key={u.id} wrap>
          <Field label="Ticker" width="90px"><TextInput value={u.ticker} onChange={v => setAt(i, { ticker: v.toUpperCase(), fullTicker: u.fullTicker || (v ? `${v.toUpperCase()}.US` : '') })} /></Field>
          <Field label="Full ticker (data key)" width="130px"><TextInput value={u.fullTicker} onChange={v => setAt(i, { fullTicker: v.toUpperCase() })} placeholder="AAPL.US" /></Field>
          <Field label="Name" width="160px"><TextInput value={u.name} onChange={v => setAt(i, { name: v })} /></Field>
          <Field label="ISIN" width="130px"><TextInput value={u.isin} onChange={v => setAt(i, { isin: v.toUpperCase() })} /></Field>
          <Field label="Basis" width="130px">
            <Select value={u.basis || 'performance'} options={[['performance', 'Price performance'], ['level', 'Rate level']]} onChange={v => setAt(i, { basis: v })} />
          </Field>
          <Field label="Initial fixing" width="100px"><NumberInput value={u.initialFixing} onChange={v => setAt(i, { initialFixing: v })} disabled={u.basis === 'level'} /></Field>
          <Field label="Weight (opt.)" width="90px"><NumberInput value={u.weight} onChange={v => setAt(i, v === null ? { weight: undefined } : { weight: v })} /></Field>
          <Field label=" " width="auto">
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <Btn small onClick={() => fetchFixing(i)} disabled={fetching === i || !u.fullTicker} title="Close at the value date">
                {fetching === i ? '…' : 'Fetch fixing'}
              </Btn>
              <Btn small tone="danger" onClick={() => setList(underlyings.filter((_, j) => j !== i))}>✕</Btn>
            </div>
          </Field>
        </Row>
      ))}
    </Section>
  );
}
