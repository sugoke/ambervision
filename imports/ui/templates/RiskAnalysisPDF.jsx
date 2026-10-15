import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { LOGO, CSS, tone, KpiStrip, Page, PdfFonts, usePdfReady } from './reportKit.jsx';

/**
 * Underlyings risk report (PDF), in the portfolio statement's style.
 * Rendered by Puppeteer at /pdf/risk-analysis/<id>, one fixed A4-landscape
 * page per <section>. Display only: every figure, label and page break comes
 * from the server (riskAnalysis.getReportForPdf → server/helpers/riskReport).
 */

const EXTRA_CSS = `
.st-badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 2px; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 500; }
.st-badge-critical { background: #F6E3DF; color: #B23B2A; }
.st-badge-high { background: #FBF1E8; color: #A9561A; }
.st-p { margin: 0; font-size: 11.5px; line-height: 17px; color: #2A2F37; }
.st-p + .st-p { margin-top: 8px; }
`;

const SectionHead = ({ title, caption }) => (
  <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>{title}</span>{caption && <span className="st-cap">{caption}</span>}</div>
);

const Paragraphs = ({ items, size }) => items.map((p, i) => (
  <p key={i} className="st-p" style={size ? { fontSize: size, lineHeight: `${Math.round(size * 1.5)}px` } : undefined}>{p}</p>
));

// ── Cover ────────────────────────────────────────────────────────────────────
const Cover = ({ data }) => {
  const c = data.cover;
  return (
    <section className="st-page" style={{ color: '#1A2B40' }}>
      <div style={{ position: 'absolute', left: 64, top: 56, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <img src={LOGO} alt="Amberlake Partners" style={{ height: 54, width: 'auto', display: 'block' }} />
        <div className="st-k">{c.privateLabel}</div>
      </div>
      <div style={{ position: 'absolute', left: 64, top: 190, width: 560, display: 'flex', flexDirection: 'column' }}>
        <div className="st-k" style={{ color: '#A9561A', letterSpacing: '0.3em', fontSize: 11 }}>{c.kicker}</div>
        <h1 style={{ margin: '22px 0 0', fontSize: 46, lineHeight: '54px', fontWeight: 300, letterSpacing: '-0.02em', color: '#1A2B40' }}>{c.title}</h1>
        <div style={{ marginTop: 24, width: 60, height: 2, background: '#DD772A' }} />
        <div style={{ marginTop: 30, display: 'flex', alignItems: 'flex-start', gap: 32 }}>
          {c.facts.map(fct => (
            <div key={fct.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="st-k">{fct.label}</span>
              <span style={{ fontSize: 14, lineHeight: '18px', color: '#1A2B40' }}>{fct.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 676, top: 190, width: 1, height: 376, background: '#E6E1D8' }} />
      {/* Not a <nav>: client/pdf-styles.css hides every nav element in print */}
      <div role="navigation" aria-label={c.contentsLabel} style={{ position: 'absolute', left: 720, top: 190, width: 339, display: 'flex', flexDirection: 'column' }}>
        <div className="st-k" style={{ paddingBottom: 12, borderBottom: '1.5px solid #1A2B40' }}>{c.contentsLabel}</div>
        {c.contents.map(item => (
          <div key={item.n} className="st-toc">
            <span className="st-mono" style={{ fontSize: 11, color: '#A9561A' }}>{item.n}</span>
            <span style={{ fontSize: 15, lineHeight: '20px', fontWeight: 300 }}>{item.label}</span>
            <span className="st-mono" style={{ fontSize: 11, color: '#687080', textAlign: 'right' }}>{item.page}</span>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 64, top: 618, width: 995, height: 148, borderTop: '1.5px solid #1A2B40', paddingTop: 26, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 32 }}>
          {c.headline.map(r => (
            <div key={r.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="st-k">{r.label}</div>
              <div className={tone(r.tone)} style={{ fontSize: 24, lineHeight: '30px', fontWeight: 300 }}>{r.value}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid #E6E1D8', fontSize: 10, lineHeight: '14px', color: '#687080', letterSpacing: '0.02em' }}>
          <span>{c.address}</span>
          <span>{c.regulated}</span>
        </div>
      </div>
    </section>
  );
};

// ── Summary ──────────────────────────────────────────────────────────────────
const Summary = ({ data, page: p }) => (
  <Page data={data} page={p} right={<KpiStrip kpis={p.kpis} />}>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', columnGap: 48, height: '100%' }}>
      <section style={{ minWidth: 0 }}>
        <SectionHead title={p.execTitle} />
        <div style={{ paddingTop: 12 }}><Paragraphs items={p.paragraphs} size={12} /></div>
      </section>
      <section style={{ minWidth: 0 }}>
        <SectionHead title={p.glanceTitle} />
        {p.glance.map((r, i) => (
          <div key={i} className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', columnGap: 14, padding: '8px 0' }}>
            <span style={{ color: r.muted ? '#687080' : '#2A2F37', paddingLeft: r.muted ? 12 : 0, fontWeight: r.strong ? 500 : 400 }}>{r.label}</span>
            <span className={`st-n ${tone(r.tone)}`} style={{ color: r.tone ? undefined : r.muted ? '#687080' : '#1A2B40', fontWeight: 500 }}>{r.value}</span>
          </div>
        ))}
        {p.allClear && (
          <div style={{ marginTop: 18, padding: '12px 14px', background: '#E8F1EC', borderLeft: '3px solid #2E7559', fontSize: 11.5, lineHeight: '16px', color: '#2A2F37' }}>{p.allClear}</div>
        )}
      </section>
    </div>
  </Page>
);

const TextPage = ({ data, page: p }) => (
  <Page data={data} page={p}>
    <div style={{ width: 640 }}><Paragraphs items={p.paragraphs} size={12} /></div>
  </Page>
);

// ── Tables ───────────────────────────────────────────────────────────────────
const ProductCell = ({ r }) => (
  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
    <span className="st-ell" style={{ color: '#1A2B40', fontWeight: 500 }}>{r.title}</span>
    <span className="st-mono" style={{ fontSize: 10, lineHeight: '14px', color: '#687080' }}>{r.isin}</span>
  </span>
);

const BELOW_COLS = 'minmax(0,1.5fr) minmax(0,1.3fr) 64px 92px 108px 132px';
const BelowTable = ({ data, page: p }) => (
  <Page data={data} page={p} right={<KpiStrip kpis={p.kpis} />}>
    <div className="st-th" style={{ gridTemplateColumns: BELOW_COLS, columnGap: 14 }}>
      <span>{p.columns.product}</span><span>{p.columns.below}</span><span className="st-n">{p.columns.barrier}</span>
      <span className="st-n">{p.columns.worst}</span><span className="st-n">{p.columns.final}</span><span className="st-n">{p.columns.nominal}</span>
    </div>
    {p.rows.map((r, i) => (
      <div key={i} className="st-tr" style={{ gridTemplateColumns: BELOW_COLS, columnGap: 14, padding: '8px 0' }}>
        <ProductCell r={r} />
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
          {r.below.map((u, j) => (
            <span key={j} style={{ whiteSpace: 'nowrap' }}>
              <span className="st-mono" style={{ fontSize: 11, color: '#1A2B40' }}>{u.symbol}</span>{' '}
              <span className="st-neg" style={{ fontSize: 11 }}>{u.value}</span>
            </span>
          ))}
        </span>
        <span className="st-n" style={{ color: '#687080' }}>{r.barrier}</span>
        <span className={`st-n ${tone(r.worstTone)}`} style={{ fontWeight: 500 }}>{r.worst}</span>
        <span className="st-n" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span>{r.final}</span>{r.finalCaption && <span className="st-cap">{r.finalCaption}</span>}
        </span>
        <span className="st-n" style={{ color: '#1A2B40' }}>{r.nominal}</span>
      </div>
    ))}
  </Page>
);

const DOWN_COLS = 'minmax(0,2fr) 120px 110px 90px 150px';
const DownTable = ({ data, page: p }) => (
  <Page data={data} page={p} right={<KpiStrip kpis={p.kpis} />}>
    <div className="st-th" style={{ gridTemplateColumns: DOWN_COLS, columnGap: 14 }}>
      <span>{p.columns.product}</span><span className="st-n">{p.columns.price}</span><span className="st-n">{p.columns.cost}</span>
      <span className="st-n">{p.columns.loss}</span><span className="st-n">{p.columns.nominal}</span>
    </div>
    {p.rows.map((r, i) => (
      <div key={i} className="st-tr" style={{ gridTemplateColumns: DOWN_COLS, columnGap: 14, padding: '8px 0' }}>
        <ProductCell r={r} />
        <span className="st-n" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span>{r.price}</span>{r.priceCaption && <span className="st-cap">{r.priceCaption}</span>}
        </span>
        <span className="st-n" style={{ color: '#687080' }}>{r.cost}</span>
        <span className="st-n st-neg" style={{ fontWeight: 500 }}>{r.loss}</span>
        <span className="st-n" style={{ color: '#1A2B40' }}>{r.nominal}</span>
      </div>
    ))}
    {p.footnote && <div className="st-cap" style={{ marginTop: 10 }}>{p.footnote}</div>}
  </Page>
);

// ── Commentary blocks ────────────────────────────────────────────────────────
const UnderlyingBlock = ({ b }) => (
  <article style={{ paddingBottom: 18, marginBottom: 12, borderBottom: '1px solid #E6E1D8' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 34, borderBottom: '1px solid #1A2B40' }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
        <span className="st-mono" style={{ fontSize: 15, color: '#1A2B40', fontWeight: 500 }}>{b.symbol}</span>
        <span className="st-ell" style={{ fontSize: 12.5, color: '#2A2F37' }}>{b.name}</span>
      </span>
      <span className={`st-badge st-badge-${b.badgeTone}`}>{b.badge}</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '270px minmax(0,1fr)', columnGap: 36, paddingTop: 10 }}>
      <div>
        {b.metrics.map((m, i) => (
          <div key={i} className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', columnGap: 10, padding: '3px 0', fontSize: 11.5 }}>
            <span style={{ color: '#687080' }}>{m.label}</span>
            <span className={`st-n ${tone(m.tone)}`} style={{ color: m.tone ? undefined : '#1A2B40', fontWeight: 500 }}>{m.value}</span>
          </div>
        ))}
      </div>
      <div style={{ minWidth: 0 }}>
        <Paragraphs items={b.paragraphs} />
        {b.products.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="st-lbl" style={{ fontSize: 9, marginBottom: 2 }}>{b.productsLabel}</div>
            {b.products.map((p, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 120px 64px', columnGap: 12, fontSize: 11, lineHeight: '19px' }}>
                <span className="st-ell" style={{ color: '#2A2F37' }}>{p.title}</span>
                <span className="st-mono" style={{ fontSize: 10, color: '#687080' }}>{p.isin}</span>
                <span className={`st-n ${tone(p.tone)}`}>{p.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </article>
);

const ProductHead = ({ b }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, height: 44, marginBottom: 8, borderBottom: '1px solid #1A2B40', paddingBottom: 6 }}>
    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span className="st-ell" style={{ fontSize: 13.5, color: '#1A2B40', fontWeight: 500 }}>{b.title} <span className="st-mono" style={{ fontSize: 10.5, color: '#687080', fontWeight: 400, marginLeft: 8 }}>{b.isin}</span></span>
      <span className="st-cap">{b.caption}{b.note && <span style={{ fontStyle: 'italic' }}> · {b.note}</span>}</span>
    </span>
    <span className="st-neg" style={{ fontSize: 16, fontWeight: 500, whiteSpace: 'nowrap' }}>{b.loss}</span>
  </div>
);

const Decliner = ({ b }) => (
  <div style={{ padding: '0 0 16px 14px' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, height: 22 }}>
      <span className="st-mono" style={{ fontSize: 12, color: '#1A2B40', fontWeight: 500 }}>{b.symbol}</span>
      <span style={{ fontSize: 11.5, color: '#2A2F37' }}>{b.name}</span>
      <span className="st-neg" style={{ fontSize: 11.5, fontWeight: 500 }}>{b.performance}</span>
    </div>
    {b.reference
      ? <div className="st-cap" style={{ fontStyle: 'italic' }}>{b.reference}</div>
      : <Paragraphs items={b.paragraphs} />}
  </div>
);

const BLOCKS = { underlying: UnderlyingBlock, productHead: ProductHead, decliner: Decliner };
const Blocks = ({ data, page: p }) => (
  <Page data={data} page={p}>
    {p.blocks.map((b, i) => {
      const Component = BLOCKS[b.kind];
      return Component ? <Component key={i} b={b} /> : null;
    })}
  </Page>
);

// ── Notes ────────────────────────────────────────────────────────────────────
const NoteColumn = ({ items }) => (
  <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    {items.map((n, i) => (
      <div key={i}>
        <SectionHead title={n.title} />
        <p className="st-p" style={{ marginTop: 8, fontSize: 11 }}>{n.text}</p>
      </div>
    ))}
  </section>
);

const Notes = ({ data, page: p }) => (
  <Page data={data} page={p} right={<div className="st-cap" style={{ textAlign: 'right' }}>{p.generatedText}</div>}>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 48 }}>
      <NoteColumn items={p.left} />
      <NoteColumn items={p.right} />
    </div>
  </Page>
);

const PAGE_COMPONENTS = { summary: Summary, text: TextPage, belowTable: BelowTable, downTable: DownTable, blocks: Blocks, notes: Notes };

export const REPORT_CSS = CSS + EXTRA_CSS;
export function RiskDocument({ data }) {
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

export default function RiskAnalysisPDF() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const pdfToken = params.get('pdfToken');
  const userId = params.get('userId');
  const lang = params.get('lang') === 'fr' ? 'fr' : 'en';
  const match = typeof window !== 'undefined' ? window.location.pathname.match(/\/pdf\/risk-analysis\/([a-zA-Z0-9]+)/) : null;
  const reportId = match ? match[1] : null;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!pdfToken || !userId || !reportId) { setError('Missing PDF token'); return undefined; }
    let cancelled = false;
    Meteor.callAsync('riskAnalysis.getReportForPdf', { reportId, userId, pdfToken, lang })
      .then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err.reason || err.message || 'Report unavailable'); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  usePdfReady(!!(data || error));

  return (
    <div className="st-doc">
      <PdfFonts />
      <style>{REPORT_CSS}</style>
      {error && <div id="pdf-loading-state" style={{ padding: 40, fontFamily: 'sans-serif', color: '#B23B2A' }}>Authentication failed: {error}</div>}
      {!data && !error && <div id="pdf-loading-state" className="report-content" style={{ padding: 40, fontFamily: 'sans-serif' }}>Loading report…</div>}
      {data && <RiskDocument data={data} />}
    </div>
  );
}
