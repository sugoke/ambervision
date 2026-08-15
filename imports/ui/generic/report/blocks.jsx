import React from 'react';
import { Badge, thStyle, tdStyle } from '../formControls.jsx';
import GenericChart from './GenericChart.jsx';

/**
 * Report blocks — PURE DISPLAY. Every value arrives pre-formatted from the
 * report composer; there is no arithmetic, no Math, no .toFixed() here.
 */

function BlockCard({ title, children }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
      borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem'
    }}>
      {title && <h3 style={{ margin: '0 0 0.9rem 0', fontSize: '1rem', color: 'var(--text-primary)' }}>{title}</h3>}
      {children}
    </div>
  );
}

const LIFECYCLE_COLORS = { green: 'var(--gain-color)', amber: 'var(--warning-color)', red: 'var(--loss-color)', blue: '#0ea5e9', gray: 'var(--neutral-color)' };

export function StatusBlock({ lifecycleLabel, lifecycleColor, evaluationDateFormatted, detailLines }) {
  return (
    <BlockCard>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <span style={{
          background: LIFECYCLE_COLORS[lifecycleColor] || LIFECYCLE_COLORS.gray,
          color: '#fff', borderRadius: '999px', padding: '0.35rem 1rem', fontWeight: 700, fontSize: '0.9rem'
        }}>
          {lifecycleLabel}
        </span>
        <div>
          {(detailLines || []).map((line, i) => (
            <div key={i} style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{line}</div>
          ))}
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Evaluated {evaluationDateFormatted}
          </div>
        </div>
      </div>
    </BlockCard>
  );
}

export function UnderlyingsBlock({ rows }) {
  return (
    <BlockCard title="Underlyings">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Ticker</th>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Initial fixing</th>
            <th style={thStyle}>Last close</th>
            <th style={thStyle}>Level</th>
            <th style={thStyle}>Performance</th>
            <th style={thStyle}>State</th>
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((r, i) => (
            <tr key={i}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.ticker}</td>
              <td style={tdStyle}>{r.name}</td>
              <td style={tdStyle}>{r.initialFixingFormatted}</td>
              <td style={tdStyle}>{r.lastCloseFormatted} <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({r.lastCloseDateFormatted})</span></td>
              <td style={tdStyle}>{r.levelFormatted}</td>
              <td style={{ ...tdStyle, color: r.isPositive === null ? 'var(--text-primary)' : r.isPositive ? 'var(--success-color)' : 'var(--danger-color)', fontWeight: 600 }}>
                {r.performanceFormatted}
              </td>
              <td style={tdStyle}>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  {(r.badges || []).map((b, j) => <Badge key={j} tone={b.tone}>{b.text}</Badge>)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </BlockCard>
  );
}

export function ChartBlock({ chartConfig }) {
  return (
    <BlockCard title="Performance">
      <GenericChart chartConfig={chartConfig} />
    </BlockCard>
  );
}

export function ScheduleBlock({ levelColumns, rows }) {
  return (
    <BlockCard title="Observation schedule">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Observation</th>
              <th style={thStyle}>Payment</th>
              {(levelColumns || []).map(k => <th key={k} style={thStyle}>{k}</th>)}
              <th style={thStyle}>Measures</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r, i) => (
              <tr key={i} style={{ opacity: r.statusLabel === 'Cancelled' ? 0.5 : 1 }}>
                <td style={tdStyle}>{r.observationDateFormatted}</td>
                <td style={tdStyle}>{r.paymentDateFormatted}</td>
                {(r.levelsFormatted || []).map((v, j) => <td key={j} style={tdStyle}>{v}</td>)}
                <td style={{ ...tdStyle, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{r.measuresFormatted || '—'}</td>
                <td style={tdStyle}><Badge tone={r.statusColor}>{r.statusLabel}</Badge></td>
                <td style={tdStyle}>
                  {(r.eventOutcomes || []).map((eo, j) => (
                    <div key={j} style={{ marginBottom: '0.2rem' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{eo.label}: </span>
                      <Badge tone={eo.tone}>{eo.text}</Badge>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BlockCard>
  );
}

export function CouponsBlock({ totalFormatted, totalMoneyFormatted, countText, rows }) {
  return (
    <BlockCard title="Coupons">
      <div style={{ display: 'flex', gap: '2rem', marginBottom: '0.9rem' }}>
        <div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total paid</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--success-color)' }}>{totalFormatted}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{totalMoneyFormatted}</div>
        </div>
        <div style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{countText}</div>
      </div>
      {(rows || []).length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Observation</th>
              <th style={thStyle}>Payment</th>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>Value</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={tdStyle}>{r.observationDateFormatted}</td>
                <td style={tdStyle}>{r.paymentDateFormatted}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.amountFormatted}</td>
                <td style={tdStyle}>{r.moneyFormatted}</td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: '0.78rem' }}>{r.memoryNote}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </BlockCard>
  );
}

export function BarrierBlock({ monitors }) {
  return (
    <BlockCard title="Barriers">
      {(monitors || []).map((m, i) => (
        <div key={i} style={{ marginBottom: i < monitors.length - 1 ? '1rem' : 0, paddingBottom: i < monitors.length - 1 ? '1rem' : 0, borderBottom: i < monitors.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.4rem' }}>
            <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{m.title}</strong>
            <Badge tone={m.mode === 'count' ? 'blue' : m.triggered ? 'red' : 'green'}>{m.statusText}</Badge>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{m.styleText}{m.scopeText ? ` — ${m.scopeText}` : ''}</div>
          {m.mode !== 'count' && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Closest approach: {m.closestApproachText}</div>
          )}
          {(m.triggerLines || []).length > 0 && (
            <div style={{ marginTop: '0.4rem' }}>
              {m.triggerLines.map((t, j) => (
                <div key={j} style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>• {t}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </BlockCard>
  );
}

export function StateRegistersBlock({ entries }) {
  return (
    <BlockCard title="State history">
      {(entries || []).map((e, i) => (
        <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>• {e}</div>
      ))}
    </BlockCard>
  );
}

export function AccumulatorsBlock({ rows }) {
  return (
    <BlockCard title="Accumulators">
      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        {(rows || []).map((r, i) => (
          <div key={i}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.id}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{r.valueFormatted}</div>
          </div>
        ))}
      </div>
    </BlockCard>
  );
}

export function PayoffBlock({ inputLabel, inputValueFormatted, isApplied, isIndicative, redemptionFormatted, redemptionMoneyFormatted, wasCalled, branches }) {
  return (
    <BlockCard title="Terminal payoff">
      {wasCalled ? (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Not applicable — the product was called before final observation.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '2rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Input — {inputLabel}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{inputValueFormatted}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              {isApplied ? 'Redemption' : isIndicative ? 'Indicative redemption (if final were today)' : 'Redemption'}
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>{redemptionFormatted}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{redemptionMoneyFormatted}</div>
          </div>
        </div>
      )}
      <div>
        {(branches || []).map((b, i) => (
          <div key={i} style={{
            padding: '0.5rem 0.75rem', borderRadius: '6px', marginBottom: '0.35rem', fontSize: '0.85rem',
            background: b.isActive ? 'rgba(14,165,233,0.1)' : 'var(--bg-tertiary)',
            border: b.isActive ? '1px solid #0ea5e9' : '1px solid transparent',
            color: 'var(--text-primary)'
          }}>
            <span style={{ color: 'var(--text-muted)' }}>{b.conditionText}: </span>
            {b.payoffText}
            {b.isActive && <Badge tone="blue"> active</Badge>}
          </div>
        ))}
      </div>
    </BlockCard>
  );
}

export function IssuesBlock({ rows }) {
  return (
    <BlockCard title="Data issues">
      {(rows || []).map((r, i) => (
        <div key={i} style={{ fontSize: '0.85rem', marginBottom: '0.3rem', color: r.severity === 'error' ? 'var(--danger-color)' : r.severity === 'warning' ? 'var(--warning-color)' : 'var(--text-muted)' }}>
          [{r.severity}] {r.message}
        </div>
      ))}
    </BlockCard>
  );
}

export function JsonDefinitionBlock({ json }) {
  return (
    <BlockCard title="Definition (as evaluated)">
      <details>
        <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Show JSON</summary>
        <pre style={{
          marginTop: '0.5rem', fontSize: '0.7rem', lineHeight: 1.45, overflow: 'auto', maxHeight: '400px',
          color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '0.6rem'
        }}>
          {json}
        </pre>
      </details>
    </BlockCard>
  );
}
