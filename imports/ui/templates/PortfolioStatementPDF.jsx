import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { LOGO, CSS, tone, Header, Title, KpiStrip, Footer, Page, Bar, LineChart, BarChart } from './reportKit.jsx';

/**
 * Portfolio statement (PDF). Rendered by Puppeteer at /pdf/pms, one fixed
 * A4-landscape page per <section>. Display only: every figure, label, page
 * break and chart coordinate comes from the server (pms.getStatementForPdf →
 * server/helpers/portfolioStatement/buildStatement.js).
 */

// ── Cover ────────────────────────────────────────────────────────────────────
const Cover = ({ data }) => {
  const c = data.cover;
  return (
    <section className="st-page" style={{ color: '#1A2B40' }}>
      <div style={{ position: 'absolute', left: 64, top: 56, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <img src={LOGO} alt="Amberlake Partners" style={{ height: 34, width: 'auto', display: 'block' }} />
        <div className="st-k">Private and confidential</div>
      </div>
      <div style={{ position: 'absolute', left: 64, top: 214, width: 540, display: 'flex', flexDirection: 'column' }}>
        <div className="st-k" style={{ color: '#A9561A', letterSpacing: '0.3em', fontSize: 11 }}>Portfolio statement</div>
        <h1 style={{ margin: '22px 0 0', fontSize: c.longName ? 52 : 72, lineHeight: c.longName ? '58px' : '76px', fontWeight: 300, letterSpacing: '-0.025em', color: '#1A2B40' }}>{c.clientName}</h1>
        <div style={{ marginTop: 24, width: 60, height: 2, background: '#DD772A' }} />
        <div style={{ marginTop: 24, fontSize: 21, lineHeight: '30px', fontWeight: 300, color: '#2A2F37' }}>{c.valuationText}</div>
        {c.emptyText && <div style={{ marginTop: 14, fontSize: 13, lineHeight: '20px', color: '#687080' }}>{c.emptyText}</div>}
        {c.accounts.length > 0 && (
          <div style={{ marginTop: 30, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="st-k" style={{ marginRight: 6 }}>Accounts</span>
            {c.accounts.map(a => (
              <span key={a} className="st-mono" style={{ fontSize: 12, lineHeight: '16px', padding: '6px 10px', border: '1px solid #D9D3C8', borderRadius: 2, color: '#1A2B40' }}>{a}</span>
            ))}
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', left: 676, top: 214, width: 1, height: 352, background: '#E6E1D8' }} />
      {/* Not a <nav>: client/pdf-styles.css hides every nav element in print */}
      <div role="navigation" aria-label="Contents" style={{ position: 'absolute', left: 720, top: 214, width: 339, display: 'flex', flexDirection: 'column' }}>
        <div className="st-k" style={{ paddingBottom: 12, borderBottom: '1.5px solid #1A2B40' }}>Contents</div>
        {c.contents.map(t => (
          <div key={t.n} className="st-toc">
            <span className="st-mono" style={{ fontSize: 11, color: '#A9561A' }}>{t.n}</span>
            <span style={{ fontSize: 15, lineHeight: '20px', fontWeight: 300 }}>{t.label}</span>
            <span className="st-mono" style={{ fontSize: 11, color: '#687080', textAlign: 'right' }}>{t.page}</span>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 64, top: 618, width: 995, height: 148, borderTop: '1.5px solid #1A2B40', paddingTop: 26, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 32 }}>
          {[['Report date', c.reportDate], ['Reference currency', c.currencyText], ['Custodian', c.custodianText]].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="st-k">{k}</div>
              <div style={{ fontSize: 17, lineHeight: '24px', fontWeight: 300 }}>{v}</div>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="st-k" style={{ color: '#A9561A' }}>Net asset value</div>
            <div style={{ fontSize: 17, lineHeight: '24px', fontWeight: 500 }}>{c.navText}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid #E6E1D8', fontSize: 10, lineHeight: '14px', color: '#687080', letterSpacing: '0.02em' }}>
          <span>Amberlake Partners SAM · 38 Boulevard des Moulins, MC 98000 Monaco · amberlakepartners.com</span>
          <span>SEC registered · CCAF regulated</span>
        </div>
      </div>
    </section>
  );
};

// ── Overview ─────────────────────────────────────────────────────────────────
const Overview = ({ data, page: p }) => (
  <Page data={data} page={p} right={<div className="st-cap" style={{ textAlign: 'right', maxWidth: 420 }}>{p.caption}</div>}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section style={{ display: 'grid', gridTemplateColumns: p.waterfall ? 'minmax(0,1fr) 470px' : '1fr', columnGap: 72, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="st-lbl">Net asset value · {data.header.currencyText.replace('Reference currency ', '')}</div>
          <div style={{ marginTop: 12, fontSize: 56, lineHeight: '56px', fontWeight: 300, letterSpacing: '-0.03em', color: '#1A2B40' }}>
            {p.navSign}{p.navInt}<span style={{ color: '#6E7480' }}>{p.navDec}</span>
          </div>
          {p.ytdChangeText && (
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13, lineHeight: '18px' }}>
              <span className={p.ytdChangePositive ? 'st-pos' : 'st-neg'} style={{ fontWeight: 500 }}>{p.ytdChangeText}</span>
              <span style={{ color: '#687080' }}>{p.ytdChangeLabel}</span>
            </div>
          )}
          <div style={{ marginTop: 18, display: 'flex', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="st-cap">Gross assets</span><span style={{ fontSize: 15, lineHeight: '20px', color: '#1A2B40' }}>{p.grossText}</span></div>
            {p.hasFinancing && <><div style={{ width: 1, background: '#E6E1D8' }} /><div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="st-cap">Financing drawn</span><span className="st-neg" style={{ fontSize: 15, lineHeight: '20px' }}>{p.financingText}</span></div></>}
            <div style={{ width: 1, background: '#E6E1D8' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="st-cap">Positions</span><span style={{ fontSize: 15, lineHeight: '20px', color: '#1A2B40', whiteSpace: 'nowrap' }}>{p.positionsText}</span></div>
          </div>
        </div>
        {p.waterfall && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="st-lbl">From gross assets to net asset value</span>
            </div>
            <div style={{ position: 'relative', marginTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ position: 'absolute', left: `${p.waterfall.navPct}%`, top: 26, bottom: 10, width: 0, borderLeft: '1px dashed #B9B2A6' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, lineHeight: '18px' }}><span>Gross assets</span><span className="st-n" style={{ color: '#1A2B40', fontWeight: 500 }}>{p.waterfall.grossText}</span></div>
                <div style={{ display: 'flex', height: 12, background: '#F1EDE6' }}><div style={{ width: `${p.waterfall.securitiesPct}%`, background: '#1A2B40' }} /><div style={{ width: `${p.waterfall.cashPct}%`, background: '#DD772A' }} /></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, lineHeight: '18px' }}><span>Less financing</span><span className="st-n st-neg" style={{ fontWeight: 500 }}>{p.waterfall.financingText}</span></div>
                <div style={{ display: 'flex', height: 12, background: '#F1EDE6' }}><div style={{ width: `${p.waterfall.navPct}%` }} /><div style={{ width: `${100 - p.waterfall.navPct}%`, background: '#C76A5A' }} /></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, lineHeight: '18px' }}><span style={{ color: '#1A2B40', fontWeight: 500 }}>Net asset value</span><span className="st-n" style={{ color: '#1A2B40', fontWeight: 600 }}>{p.waterfall.navText}</span></div>
                <div style={{ display: 'flex', height: 16, background: '#F1EDE6' }}><div style={{ width: `${p.waterfall.navPct}%`, background: '#13202F' }} /></div>
              </div>
            </div>
            <div className="st-cap" style={{ marginTop: 16, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {p.waterfall.legend.map(l => <span key={l.text} style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 9, height: 9, background: l.color }} />{l.text}</span>)}
            </div>
          </div>
        )}
      </section>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', borderTop: '1px solid #E6E1D8', borderBottom: '1px solid #E6E1D8' }}>
        {p.kpis.map((k, i) => (
          <div key={i} style={{ padding: i === 0 ? '14px 24px 14px 0' : i === 3 ? '14px 0 14px 24px' : '14px 24px', borderLeft: i ? '1px solid #E6E1D8' : 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="st-lbl">{k.label}</span>
            <span className={tone(k.tone)} style={{ fontSize: 25, lineHeight: '30px', fontWeight: 300, color: k.tone ? undefined : '#1A2B40' }}>{k.value}</span>
            <span className="st-cap">{k.caption}</span>
          </div>
        ))}
      </section>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', columnGap: 48 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 9, borderBottom: '1px solid #E6E1D8' }}><span className="st-lbl">Largest positions</span><span className="st-cap">{p.largest.caption}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10 }}>
            {p.largest.rows.map(r => (
              <div key={r.name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, lineHeight: '17px' }}><span className="st-ell" style={{ color: '#1A2B40', maxWidth: 230 }}>{r.name}</span><span className="st-n">{r.shareText}</span></div>
                <Bar pct={r.barPct} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 9, borderBottom: '1px solid #E6E1D8' }}><span className="st-lbl">Net currency exposure</span><span className="st-cap">% of NAV</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 14 }}>
            {p.exposure.rows.slice(0, 6).map(r => (
              <div key={r.ccy} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) 64px', alignItems: 'center' }}>
                <span className="st-mono" style={{ fontSize: 12, color: '#1A2B40' }}>{r.ccy}</span>
                <div style={{ position: 'relative', height: 12 }}>
                  <div style={{ position: 'absolute', left: '28%', top: -2, bottom: -2, width: 1, background: '#B9B2A6' }} />
                  <div style={{ position: 'absolute', top: 0, height: 12, left: `${r.barLeftPct}%`, width: `${r.barWidthPct}%`, background: r.negative ? '#C76A5A' : '#1A2B40' }} />
                </div>
                <span className={`st-n ${r.negative ? 'st-neg' : ''}`} style={{ fontSize: 12.5 }}>{r.text}</span>
              </div>
            ))}
          </div>
          <div className="st-cap" style={{ marginTop: 12 }}>{p.exposure.caption}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 9, borderBottom: '1px solid #E6E1D8' }}><span className="st-lbl">Performance</span><span className="st-cap">Change · TWR</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto 64px', columnGap: 14, fontSize: 12.5, lineHeight: '17px' }}>
            {p.periods.map((r, i) => (
              <React.Fragment key={r.label}>
                <span style={{ padding: '7px 0 6px', borderBottom: i < p.periods.length - 1 ? '1px solid #F1EDE6' : 'none' }}>{r.label}</span>
                <span className={`st-n ${r.changePositive ? 'st-pos' : 'st-neg'}`} style={{ padding: '7px 0 6px', borderBottom: i < p.periods.length - 1 ? '1px solid #F1EDE6' : 'none' }}>{r.changeText}</span>
                <span className={`st-n ${r.twrPositive ? 'st-pos' : 'st-neg'}`} style={{ padding: '7px 0 6px', borderBottom: i < p.periods.length - 1 ? '1px solid #F1EDE6' : 'none', fontWeight: 500 }}>{r.twrText}</span>
              </React.Fragment>
            ))}
          </div>
          <div className="st-cap" style={{ marginTop: 6 }}>Change in NAV includes flows; the return is time-weighted. Detail in section 04.</div>
        </div>
      </section>
    </div>
  </Page>
);

// ── Allocation ───────────────────────────────────────────────────────────────
const ShareRows = ({ rows, compactRows }) => rows.map(r => (
  <div key={r.label} className="st-tr" style={{ gridTemplateColumns: '164px minmax(0,1fr) 58px 100px', columnGap: 12, padding: compactRows ? '6px 0' : '10px 0' }}>
    <span className="st-ell">{r.label}</span>
    <span style={{ height: 8, background: '#F1EDE6' }}><span style={{ display: 'block', width: `${r.barPct}%`, height: 8, background: '#1A2B40' }} /></span>
    <span className="st-n" style={{ color: '#1A2B40', fontWeight: 500 }}>{r.shareText}</span>
    <span className="st-n" style={{ color: '#687080' }}>{r.valueText}</span>
  </div>
));

const Allocation = ({ data, page: p }) => (
  <Page data={data} page={p} right={<div className="st-cap" style={{ textAlign: 'right' }}>{p.caption}</div>}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gridTemplateRows: 'auto minmax(0,1fr)', columnGap: 56, rowGap: 28, height: '100%' }}>
      <section style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Asset allocation</span><span className="st-cap">{data.header.currencyText.replace('Reference currency ', '')}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: p.compact ? 20 : 26, paddingTop: p.compact ? 8 : 16 }}>
          <svg width={p.donutSize} height={p.donutSize} viewBox="0 0 188 188" style={{ flex: 'none', display: 'block' }}>
            <circle cx="94" cy="94" r="86" fill="none" stroke="#EEE9E1" strokeWidth="3" />
            {p.donut.financingArc && <circle cx="94" cy="94" r="86" fill="none" stroke="#C76A5A" strokeWidth="3" strokeDasharray={p.donut.financingArc} transform="rotate(-90 94 94)" />}
            {p.donut.segments.map((s, i) => <circle key={i} cx="94" cy="94" r="68" fill="none" stroke={s.color} strokeWidth="20" strokeDasharray={s.dash} strokeDashoffset={s.offset} transform="rotate(-90 94 94)" />)}
            <text x="94" y="94" textAnchor="middle" fontFamily="Poppins, Helvetica Neue, sans-serif" fontSize="24" fontWeight="300" fill="#1A2B40">{p.donut.centerText}</text>
            <text x="94" y="113" textAnchor="middle" fontFamily="Poppins, Helvetica Neue, sans-serif" fontSize="10" fill="#687080">gross assets</text>
          </svg>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="st-th" style={{ gridTemplateColumns: 'minmax(0,1fr) 96px 60px' }}><span>Asset class</span><span className="st-n">Value</span><span className="st-n">Weight</span></div>
            {p.allocationRows.map(r => (r.sub ? (
              <div key={`sub-${r.label}`} className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) 96px 60px', padding: '2px 0', fontSize: 11, color: '#687080', borderBottomColor: '#F6F3EE' }}>
                <span className="st-ell" style={{ paddingLeft: 12 }}>{r.label}</span>
                <span className="st-n">{r.valueText}</span><span className="st-n">{r.weightText}</span>
              </div>
            ) : (
              <div key={r.label} className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) 96px 60px', padding: p.compact ? '4px 0' : undefined }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}><span style={{ flex: 'none', width: 9, height: 9, background: r.color }} /><span className="st-ell">{r.label}</span></span>
                <span className="st-n">{r.valueText}</span><span className="st-n">{r.weightText}</span>
              </div>
            )))}
            <div className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) 96px 60px', fontWeight: 500, color: '#1A2B40' }}><span>Gross assets</span><span className="st-n">{p.grossText}</span><span className="st-n">100.00%</span></div>
            {p.hasFinancing && <div className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) 96px 60px' }}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 9, height: 3, background: '#C76A5A' }} />Financing</span><span className="st-n st-neg">{p.financingText}</span><span className="st-n st-neg">{p.financingWeight}</span></div>}
            <div className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) 96px 60px', fontWeight: 600, color: '#1A2B40', borderBottom: '1.5px solid #1A2B40' }}><span>Net asset value</span><span className="st-n">{p.navText}</span><span className="st-n">{p.navWeight}</span></div>
          </div>
        </div>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Currency exposure</span><span className="st-cap">{data.header.currencyText.replace('Reference currency ', '')}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 4 }}>
          <div className="st-th" style={{ gridTemplateColumns: '44px repeat(3, minmax(0,1fr)) 132px' }}><span>Ccy</span><span className="st-n">Assets</span><span className="st-n">Financing</span><span className="st-n">Net</span><span className="st-n">Net, % of NAV</span></div>
          {p.exposureRows.slice(0, 8).map(r => (
            <div key={r.ccy} className="st-tr" style={{ gridTemplateColumns: '44px repeat(3, minmax(0,1fr)) 132px', padding: '9px 0' }}>
              <span className="st-mono" style={{ color: '#1A2B40' }}>{r.ccy}</span>
              <span className="st-n">{r.assetsText}</span>
              <span className={`st-n ${r.financingZero ? '' : 'st-neg'}`} style={r.financingZero ? { color: '#687080' } : undefined}>{r.financingText}</span>
              <span className={`st-n ${r.negative ? 'st-neg' : ''}`} style={{ color: r.negative ? undefined : '#1A2B40', fontWeight: 500 }}>{r.netText}</span>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                <span style={{ position: 'relative', width: 70, height: 10 }}>
                  <span style={{ position: 'absolute', left: 18, top: -2, width: 1, height: 14, background: '#9A9389' }} />
                  <span style={{ position: 'absolute', top: 0, height: 10, left: r.barLeft, width: r.barWidth, background: r.negative ? '#C76A5A' : '#1A2B40' }} />
                </span>
                <span className={`st-n ${r.negative ? 'st-neg' : ''}`} style={{ width: 52 }}>{r.shareText}</span>
              </span>
            </div>
          ))}
          <div className="st-tr" style={{ gridTemplateColumns: '44px repeat(3, minmax(0,1fr)) 132px', padding: '9px 0', fontWeight: 600, color: '#1A2B40', borderBottom: '1.5px solid #1A2B40' }}><span>Total</span><span className="st-n">{p.exposureTotal.assets}</span><span className="st-n">{p.exposureTotal.financing}</span><span className="st-n">{p.exposureTotal.net}</span><span className="st-n">100.0%</span></div>
        </div>
        {p.exposureCaption && <div className="st-cap" style={{ marginTop: 12 }}>{p.exposureCaption}</div>}
      </section>
      {p.hasEquities && (
        <>
          <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Equities by sector</span><span className="st-cap">% of equities</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 2 }}><ShareRows rows={p.sectors.slice(0, 8)} compactRows={p.sectors.length > 5} /></div>
          </section>
          <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Equities by region</span><span className="st-cap">% of equities · issuer country</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 2 }}><ShareRows rows={p.regions.slice(0, 8)} compactRows /></div>
          </section>
        </>
      )}
    </div>
  </Page>
);

// ── Positions ────────────────────────────────────────────────────────────────
const POS_COLS = 'minmax(0,1fr) 40px 76px 72px 72px 96px 96px 96px 64px 58px';
const PositionRows = ({ group: g, refCcy }) => (
  <>
    <div className="st-th" style={{ gridTemplateColumns: POS_COLS, columnGap: 10 }}>
      <span>Security<br />ISIN</span><span>Ccy</span><span className="st-n">{g.isPercent ? 'Nominal' : 'Quantity'}</span>
      <span className="st-n">Avg cost</span><span className="st-n">Price</span><span className="st-n">Value in ccy</span>
      <span className="st-n">Value {refCcy}</span><span className="st-n">Unrealised P&amp;L</span><span className="st-n">P&amp;L %</span><span className="st-n">Weight</span>
    </div>
    {g.rows.map((r, i) => (
      <div key={i} className="st-tr" style={{ gridTemplateColumns: POS_COLS, columnGap: 10, padding: '3px 0' }}>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span className="st-ell" style={{ color: '#1A2B40', lineHeight: '15px' }}>{r.name}</span>
          <span className="st-mono st-ell" style={{ fontSize: 9.5, lineHeight: '12px', color: '#687080' }}>{r.isin}</span>
        </span>
        <span className="st-mono" style={{ fontSize: 11 }}>{r.ccy}</span>
        <span className="st-n">{r.qty}</span><span className="st-n">{r.cost}</span><span className="st-n">{r.price}</span>
        <span className="st-n" style={{ color: '#687080' }}>{r.valueCcy}</span>
        <span className="st-n" style={{ color: '#1A2B40', fontWeight: 500 }}>{r.valueRef}</span>
        <span className={`st-n ${r.pnlPositive ? 'st-pos' : 'st-neg'}`}>{r.pnl}</span>
        <span className={`st-n ${r.pnlPositive ? 'st-pos' : 'st-neg'}`}>{r.pnlPct}</span>
        <span className="st-n">{r.weight}</span>
      </div>
    ))}
    {g.total && (
      <div className="st-tr" style={{ gridTemplateColumns: POS_COLS, columnGap: 10, fontWeight: 600, color: '#1A2B40', borderBottom: '1.5px solid #1A2B40' }}>
        <span>{g.total.label}</span><span /><span /><span /><span /><span />
        <span className="st-n">{g.total.valueRef}</span>
        <span className={`st-n ${g.total.pnlPositive ? 'st-pos' : 'st-neg'}`}>{g.total.pnl}</span>
        <span className={`st-n ${g.total.pnlPositive ? 'st-pos' : 'st-neg'}`}>{g.total.pnlPct}</span>
        <span className="st-n">{g.total.weight}</span>
      </div>
    )}
  </>
);

const Positions = ({ data, page: p }) => (
  <Page data={data} page={p} right={p.kpis ? <KpiStrip kpis={p.kpis} /> : null}>
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {p.groups.map((g, i) => (
        <section key={`${g.key}-${i}`} style={{ display: 'flex', flexDirection: 'column', marginTop: p.showHeadings && i > 0 ? 18 : 0 }}>
          {p.showHeadings && (
            <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>{g.heading}</span>{g.summaryText && <span className="st-cap">{g.summaryText}</span>}</div>
          )}
          <PositionRows group={g} refCcy={p.refCcy} />
        </section>
      ))}
      {p.footnote && <div className="st-cap" style={{ marginTop: 12 }}>{p.footnote}</div>}
    </div>
  </Page>
);

// ── Liquidity and financing ──────────────────────────────────────────────────
const CASH_COLS = 'minmax(0,1fr) 110px 44px 120px 110px 64px';
const AccountTable = ({ title, caption, rows, totalLabel, totalText, totalWeight, refCcy, negative }) => (
  <section style={{ display: 'flex', flexDirection: 'column' }}>
    <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>{title}</span><span className="st-cap">{caption}</span></div>
    <div className="st-th" style={{ gridTemplateColumns: CASH_COLS, columnGap: 10 }}><span>Account</span><span>Account no.</span><span>Ccy</span><span className="st-n">Balance, in ccy</span><span className="st-n">Value, {refCcy}</span><span className="st-n">% of gross</span></div>
    {rows.map((r, i) => (
      <div key={i} className="st-tr" style={{ gridTemplateColumns: CASH_COLS, columnGap: 10 }}>
        <span className="st-ell">{r.label}</span><span className="st-mono" style={{ fontSize: 11 }}>{r.account}</span><span className="st-mono" style={{ fontSize: 11 }}>{r.ccy}</span>
        <span className={`st-n ${negative ? 'st-neg' : ''}`}>{r.balance}</span><span className={`st-n ${negative ? 'st-neg' : ''}`}>{r.valueRef}</span><span className={`st-n ${negative ? 'st-neg' : ''}`}>{r.weight}</span>
      </div>
    ))}
    <div className="st-tr" style={{ gridTemplateColumns: CASH_COLS, columnGap: 10, fontWeight: 600, color: '#1A2B40', borderBottom: '1.5px solid #1A2B40' }}>
      <span>{totalLabel}</span><span /><span /><span /><span className={`st-n ${negative ? 'st-neg' : ''}`}>{totalText}</span><span className={`st-n ${negative ? 'st-neg' : ''}`}>{totalWeight}</span>
    </div>
  </section>
);

const Liquidity = ({ data, page: p }) => (
  <Page data={data} page={p} right={<KpiStrip kpis={p.kpis} />}>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', columnGap: 48, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <AccountTable title="Cash accounts" caption={p.cash.caption} rows={p.cash.rows} totalLabel="Total cash" totalText={p.cash.totalText} totalWeight={p.cash.totalWeight} refCcy={p.refCcy} />
        {p.financing && <AccountTable title="Financing" caption={p.financing.caption || ''} rows={p.financing.rows} totalLabel="Total financing" totalText={p.financing.totalText} totalWeight={p.financing.totalWeight} refCcy={p.refCcy} negative />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {p.fxRows.length > 0 && (
          <section>
            <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Exchange rates applied</span></div>
            {p.fxRows.map(r => (
              <div key={r.ccy} className="st-tr" style={{ gridTemplateColumns: '44px minmax(0,1fr) auto', columnGap: 8 }}>
                <span className="st-mono" style={{ color: '#1A2B40' }}>{r.ccy}</span><span className="st-ell">1 {r.name}</span><span className="st-n">{r.rateText}</span>
              </div>
            ))}
            <div className="st-cap" style={{ marginTop: 8 }}>{p.fxCaption}</div>
          </section>
        )}
        {p.cost && (
          <section>
            <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Cost of financing {p.cost.year}</span><span className="st-cap">debited to date</span></div>
            {p.cost.rows.map((r, i) => (
              <div key={i} className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', columnGap: 8 }}><span className="st-ell">{r.label}</span><span className="st-n st-neg">{r.amount}</span></div>
            ))}
            <div className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', fontWeight: 600, color: '#1A2B40', borderBottom: '1.5px solid #1A2B40' }}><span>Total, at period-end rates</span><span className="st-n st-neg">{p.cost.totalText}</span></div>
          </section>
        )}
      </div>
    </div>
  </Page>
);

// ── Performance ──────────────────────────────────────────────────────────────
const Performance = ({ data, page: p }) => (
  <Page data={data} page={p} right={<KpiStrip kpis={p.kpis} />}>
    <div style={{ display: 'grid', gridTemplateColumns: '600px minmax(0,1fr)', columnGap: 44, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <section>
          <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Net asset value</span><span className="st-cap">{p.navCaption}</span></div>
          <div style={{ paddingTop: 10 }}>{p.navChart ? <LineChart chart={p.navChart} /> : <div className="st-cap" style={{ padding: '40px 0' }}>Not enough valuation history yet.</div>}</div>
        </section>
        <section>
          <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Change by period</span><span className="st-cap">{data.header.currencyText.replace('Reference currency ', '')}</span></div>
          <div className="st-th" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px 120px 120px 84px' }}><span>Period</span><span /><span className="st-n">Start value</span><span className="st-n">Change</span><span className="st-n">TWR</span></div>
          {p.periodRows.map(r => (
            <div key={r.label} className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) 120px 120px 120px 84px', padding: '5px 0' }}>
              <span style={{ color: '#1A2B40' }}>{r.label}</span><span className="st-cap">{r.fromText}</span>
              <span className="st-n">{r.startText}</span>
              <span className={`st-n ${r.changePositive ? 'st-pos' : 'st-neg'}`}>{r.changeText}</span>
              <span className={`st-n ${r.twrPositive ? 'st-pos' : 'st-neg'}`} style={{ fontWeight: 500 }}>{r.twrText}</span>
            </div>
          ))}
        </section>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        {p.monthlyChart && (
          <section>
            <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Monthly performance</span><span className="st-cap">{p.monthlyCaption}</span></div>
            <div style={{ paddingTop: 8 }}><BarChart chart={p.monthlyChart} /></div>
            {p.yearly.length > 0 && (
              <div className="st-cap" style={{ marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {p.yearly.map(y => <span key={y.label}>{y.label}{y.partial ? '*' : ''} <span className={y.isPositive ? 'st-pos' : 'st-neg'} style={{ fontWeight: 500 }}>{y.twrText}</span></span>)}
              </div>
            )}
          </section>
        )}
        <section style={{ minHeight: 0 }}>
          <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Unrealised result by position</span><span className="st-cap">{data.header.currencyText.replace('Reference currency ', '')}, against average cost</span></div>
          {p.pnlRows.map(r => (
            <div key={r.name} className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) 80px 96px 64px', columnGap: 10, padding: '4px 0' }}>
              <span className="st-ell" style={{ color: '#1A2B40' }}>{r.name}</span>
              <span style={{ height: 6, background: '#F1EDE6' }}><span style={{ display: 'block', width: `${r.barPct}%`, height: 6, background: r.positive ? '#2E7559' : '#C76A5A' }} /></span>
              <span className={`st-n ${r.positive ? 'st-pos' : 'st-neg'}`}>{r.pnl}</span>
              <span className={`st-n ${r.positive ? 'st-pos' : 'st-neg'}`}>{r.pnlPct}</span>
            </div>
          ))}
        </section>
        <div className="st-cap">{p.footnote}</div>
      </div>
    </div>
  </Page>
);

// ── Activity ─────────────────────────────────────────────────────────────────
const TRADE_COLS = '72px 74px minmax(0,1fr) 64px 62px 58px 30px 96px';
const Activity = ({ data, page: p }) => (
  <Page data={data} page={p} right={p.first ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <span className="st-cap">Period {p.periodText} · {p.totalCount} transactions</span>
      <span className="st-cap">{p.counts.map(c => `${c.label} ${c.count}`).join(' · ')}</span>
    </div>
  ) : null}>
    <div style={{ display: 'grid', gridTemplateColumns: p.first && (p.income || p.card) ? 'minmax(0,1fr) 320px' : '1fr', columnGap: 40, height: '100%' }}>
      <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Securities transactions</span><span className="st-cap">{p.trades.caption}</span></div>
        {p.trades.rows.length === 0 ? <div className="st-cap" style={{ padding: '14px 0' }}>No securities transactions this year.</div> : (
          <>
            <div className="st-th" style={{ gridTemplateColumns: TRADE_COLS, columnGap: 8 }}><span>Date</span><span>Side</span><span>Security<br />ISIN</span><span className="st-n">Qty</span><span className="st-n">Price</span><span className="st-n">Fees</span><span>Ccy</span><span className="st-n">Net amount</span></div>
            {p.trades.rows.map((r, i) => (
              <div key={i} className="st-tr" style={{ gridTemplateColumns: TRADE_COLS, columnGap: 8, padding: '3px 0', fontSize: 11.5 }}>
                <span>{r.date}</span><span>{r.side}</span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span className="st-ell" style={{ color: '#1A2B40', lineHeight: '15px' }}>{r.security}</span>
                  <span className="st-mono st-ell" style={{ fontSize: 9.5, lineHeight: '12px', color: '#687080' }}>{r.isin}</span>
                </span>
                <span className="st-n">{r.qty}</span><span className="st-n">{r.price}</span>
                <span className="st-n" style={{ color: '#687080' }}>{r.fees}</span><span className="st-mono" style={{ fontSize: 10.5 }}>{r.ccy}</span>
                <span className={`st-n ${r.isPositive ? 'st-pos' : ''}`} style={{ fontWeight: 500 }}>{r.net}</span>
              </div>
            ))}
          </>
        )}
      </section>
      {p.first && (p.income || p.card) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
          {p.income && (
            <section>
              <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Income received</span><span className="st-cap">dividends, coupons and interest, net</span></div>
              <div className="st-th" style={{ gridTemplateColumns: '44px 36px minmax(0,1fr) 84px' }}><span>Ccy</span><span className="st-n">No.</span><span className="st-n">Net received</span><span className="st-n">Tax withheld</span></div>
              {p.income.rows.map(r => (
                <div key={r.ccy} className="st-tr" style={{ gridTemplateColumns: '44px 36px minmax(0,1fr) 84px' }}>
                  <span className="st-mono">{r.ccy}</span><span className="st-n">{r.count}</span><span className="st-n st-pos">{r.net}</span><span className="st-n" style={{ color: '#687080' }}>{r.tax}</span>
                </div>
              ))}
              <div className="st-tr" style={{ gridTemplateColumns: '44px 36px minmax(0,1fr) 84px', fontWeight: 600, color: '#1A2B40', borderBottom: '1.5px solid #1A2B40' }}><span className="st-mono">{p.income.refCcy}</span><span className="st-n">{p.income.totalCount}</span><span className="st-n">{p.income.totalText}</span><span /></div>
              <div className="st-cap" style={{ marginTop: 6 }}>Total converted at period-end exchange rates.</div>
            </section>
          )}
          {p.card && (
            <section>
              <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>Card spending</span><span className="st-cap">per month</span></div>
              <div style={{ paddingTop: 8 }}><BarChart chart={p.card.chart} /></div>
              <div className="st-cap" style={{ marginTop: 4 }}>{p.card.caption}</div>
            </section>
          )}
        </div>
      )}
    </div>
  </Page>
);

// ── Account movements ────────────────────────────────────────────────────────
const MOV_COLS = '52px 86px minmax(0,1fr) 200px 96px 64px 38px 100px';
const Movements = ({ data, page: p }) => (
  <Page data={data} page={p} right={<div className="st-cap" style={{ textAlign: 'right' }}>Cash and credit account entries other than card payments and trades<br />Amounts in the currency of the account</div>}>
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {p.rows.length === 0 ? <div className="st-cap" style={{ padding: '14px 0' }}>No account movements this month.</div> : (
        <>
          <div className="st-th" style={{ gridTemplateColumns: MOV_COLS, columnGap: 10 }}><span>Date</span><span>Type</span><span>Description</span><span>Account</span><span className="st-n">Amount</span><span className="st-n">Fees</span><span>Ccy</span><span className="st-n">Net amount</span></div>
          {p.rows.map((r, i) => (
            <div key={i} className="st-tr" style={{ gridTemplateColumns: MOV_COLS, columnGap: 10, padding: '4px 0', fontSize: 11.5 }}>
              <span>{r.date}</span><span>{r.type}</span><span className="st-ell" style={{ color: '#1A2B40' }}>{r.description}</span>
              <span className="st-mono st-ell" style={{ fontSize: 10 }}>{r.account}</span>
              <span className="st-n">{r.amount}</span><span className="st-n" style={{ color: '#687080' }}>{r.fees}</span>
              <span className="st-mono" style={{ fontSize: 10.5 }}>{r.ccy}</span>
              <span className={`st-n ${r.positive ? 'st-pos' : 'st-neg'}`} style={{ fontWeight: 500 }}>{r.net}</span>
            </div>
          ))}
        </>
      )}
      {p.footnote && <div className="st-cap" style={{ marginTop: 12 }}>{p.footnote}</div>}
    </div>
  </Page>
);

// ── Notes and disclosures ────────────────────────────────────────────────────
const Notes = ({ data, page: p }) => {
  const defs = [
    ['Gross assets', 'Securities at market value plus credit balances on cash accounts, before borrowing.'],
    ['Financing', 'Debit balances on credit facilities, cards and current accounts. Shown as negative values.'],
    ['Net asset value', 'Gross assets less financing: the client\'s equity in the portfolio and the base for "% of NAV" figures.'],
    ['Weight', 'Market value as a percentage of gross assets, unless a table states otherwise.'],
    ['Unrealised P&L', `Market value less average cost, in ${p.refCcy} at period-end rates. Includes the currency effect on non-${p.refCcy} positions.`],
    ['Time-weighted return', 'Return of the investments between two dates, with deposits and withdrawals neutralised and periods chain-linked. Credit and card accounts are not part of it.'],
    ['Change', 'Difference in net asset value between two valuation dates. Includes deposits and withdrawals.'],
    ['Currency exposure', 'Assets net of financing in each currency. Negative means borrowing exceeds assets held in that currency.'],
    ['Loan to value', 'Financing drawn over gross assets. The custodian\'s own lending values per security may differ.']
  ];
  return (
    <Page data={data} page={p} right={<div className="st-cap" style={{ textAlign: 'right' }}>{p.generatedText}<br />{p.sourceText}</div>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 48, height: '100%' }}>
        <section>
          <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>How to read this statement</span></div>
          {defs.map(([k, v]) => (
            <div key={k} className="st-tr" style={{ gridTemplateColumns: '130px minmax(0,1fr)', columnGap: 14, alignItems: 'start', fontSize: 11, lineHeight: '15px', padding: '6px 0' }}>
              <span style={{ color: '#1A2B40', fontWeight: 500 }}>{k}</span><span>{v}</span>
            </div>
          ))}
        </section>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 11, lineHeight: '15.5px' }}>
          <div>
            <div className="st-ph" style={{ marginBottom: 8 }}><span className="st-lbl" style={{ color: '#1A2B40' }}>Important notice</span></div>
            <p style={{ margin: '0 0 6px' }}>This statement is a consolidated view prepared by Amberlake Partners SAM for information purposes only. It is not an official record of the client's assets.</p>
            <p style={{ margin: '0 0 6px' }}>The only official and legally binding records are the statements, valuations and transaction advices issued directly by the custodian bank{p.custodianText !== '—' ? `, ${p.custodianText}` : ''}. In the event of any discrepancy between this document and the custodian's statements, the custodian's statements prevail. Clients are invited to compare the two and to report any difference to their relationship manager within 30 days of receipt.</p>
            <p style={{ margin: '0 0 6px' }}>Amberlake Partners does not hold client assets. The figures reproduced here are taken from data transmitted by the custodian and have not been independently audited. Amberlake Partners accepts no liability for errors or omissions in the data received, nor for decisions taken on the basis of this document.</p>
            <p style={{ margin: 0 }}>Past performance is not a reliable indicator of future results. The value of investments and the income from them can fall as well as rise, and the use of borrowing amplifies both gains and losses. Nothing in this statement constitutes investment, legal or tax advice, nor an offer or solicitation to buy or sell any financial instrument.</p>
          </div>
          <div>
            <div className="st-ph" style={{ marginBottom: 8 }}><span className="st-lbl" style={{ color: '#1A2B40' }}>Valuation basis</span></div>
            <p style={{ margin: 0 }}>Securities are valued at the closing prices of {p.valuationText} supplied by the custodian. Positions in other currencies are converted to {p.refCcy} at the custodian's closing rates of the same day where supplied, market rates otherwise. Cash is stated at nominal value. Average cost is the custodian's weighted average purchase price.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24 }}>
            <div>
              <div className="st-ph" style={{ marginBottom: 8 }}><span className="st-lbl" style={{ color: '#1A2B40' }}>Regulatory information</span></div>
              <p style={{ margin: 0 }}>Amberlake Partners SAM · SEC registered · CCAF regulated<br />38 Boulevard des Moulins, MC 98000 Monaco<br />amberlakepartners.com</p>
            </div>
            {p.rm && (
              <div>
                <div className="st-ph" style={{ marginBottom: 8 }}><span className="st-lbl" style={{ color: '#1A2B40' }}>Your contact</span></div>
                <p style={{ margin: 0 }}><span style={{ color: '#1A2B40', fontWeight: 500 }}>{p.rm.name}</span>{p.rm.email && <><br />{p.rm.email}</>}{p.rm.phone && <><br />{p.rm.phone}</>}</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </Page>
  );
};

const PAGE_COMPONENTS = { overview: Overview, allocation: Allocation, positions: Positions, liquidity: Liquidity, performance: Performance, activity: Activity, movements: Movements, notes: Notes };

/** All pages of a built statement (also rendered on its own for previews/tests). */
export const STATEMENT_CSS = CSS;
export function StatementDocument({ data }) {
  return (
    <div className="report-content">
      <Cover data={data} />
      {data.pages.map((page, i) => {
        const Component = PAGE_COMPONENTS[page.type];
        return Component ? <Component key={i} data={data} page={page} /> : null;
      })}
    </div>
  );
}

export default function PortfolioStatementPDF() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const pdfToken = params.get('pdfToken');
  const userId = params.get('userId');
  const accountParam = params.get('account');
  const currencyParam = params.get('currency');
  const viewAsFilter = (() => {
    const raw = params.get('viewAsFilter');
    if (!raw) return null;
    try { return JSON.parse(decodeURIComponent(raw)); } catch (e) { return null; }
  })();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.body.setAttribute('data-pdf-mode', 'true');
    if (!pdfToken || !userId) { setError('Missing PDF token'); return undefined; }
    let cancelled = false;
    Meteor.callAsync('pms.getStatementForPdf', {
      userId,
      pdfToken,
      viewAsFilter: viewAsFilter ? { ...viewAsFilter, type: String(viewAsFilter.type), id: String(viewAsFilter.id) } : null,
      accountId: accountParam && !['all', 'consolidated'].includes(accountParam) ? accountParam : null,
      currency: currencyParam && /^[A-Z]{3}$/.test(currencyParam) ? currencyParam : null
    }).then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err.reason || err.message || 'Statement unavailable'); });
    return () => { cancelled = true; document.body.removeAttribute('data-pdf-mode'); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ready for Puppeteer once rendered and fonts are in, empty perimeter included
  useEffect(() => {
    if (!data && !error) return;
    const done = () => document.body.setAttribute('data-pdf-ready', 'true');
    if (document.fonts?.ready) document.fonts.ready.then(() => setTimeout(done, 300)); else setTimeout(done, 800);
  }, [data, error]);

  return (
    <div className="st-doc">
      <link rel="stylesheet" href="/fonts/poppins.css" />
      <link rel="stylesheet" href="/fonts/fonts.css" />
      <style>{CSS}</style>
      {error && <div id="pdf-loading-state" style={{ padding: 40, fontFamily: 'sans-serif', color: '#B23B2A' }}>Authentication failed: {error}</div>}
      {!data && !error && <div id="pdf-loading-state" className="report-content" style={{ padding: 40, fontFamily: 'sans-serif' }}>Loading statement…</div>}
      {data && <StatementDocument data={data} />}
    </div>
  );
}
