import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { LOGO, CSS, tone, KpiStrip, Page, MultiLineChart, HBarChart, PdfFonts, usePdfReady } from './reportKit.jsx';

/**
 * Structured product report (PDF), in the portfolio statement's style.
 * Rendered by Puppeteer at /pdf/product/<id>, one fixed A4-landscape page per
 * <section>. Display only: every figure, label and page break comes from the
 * server (products.getReportForPdf → server/helpers/productReport).
 */

const toneClass = (t) => (t === 'warn' ? 'st-warn' : tone(t));
const EXTRA_CSS = `
.st-warn { color: #A9561A; }
.st-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 2px; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500; }
.st-badge-live { background: #E8F1EC; color: #2E7559; }
.st-badge-closed { background: #F1EDE6; color: #1A2B40; }
`;

const SectionHead = ({ title, caption }) => (
  <div className="st-ph"><span className="st-lbl" style={{ color: '#1A2B40' }}>{title}</span>{caption && <span className="st-cap">{caption}</span>}</div>
);

// ── Cover ────────────────────────────────────────────────────────────────────
const Cover = ({ data }) => {
  const c = data.cover;
  const bottom = [...c.timeline.filter(r => r.label).slice(0, 3)];
  return (
    <section className="st-page" style={{ color: '#1A2B40' }}>
      <div style={{ position: 'absolute', left: 64, top: 56, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <img src={LOGO} alt="Amberlake Partners" style={{ height: 34, width: 'auto', display: 'block' }} />
        <div className="st-k">{c.privateLabel}</div>
      </div>
      <div style={{ position: 'absolute', left: 64, top: 190, width: 560, display: 'flex', flexDirection: 'column' }}>
        <div className="st-k" style={{ color: '#A9561A', letterSpacing: '0.3em', fontSize: 11 }}>{c.kicker} · {c.templateLabel}</div>
        <h1 style={{ margin: '22px 0 0', fontSize: c.longTitle ? 40 : 56, lineHeight: c.longTitle ? '48px' : '62px', fontWeight: 300, letterSpacing: '-0.02em', color: '#1A2B40' }}>{c.title}</h1>
        <div style={{ marginTop: 24, width: 60, height: 2, background: '#DD772A' }} />
        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className={`st-badge st-badge-${c.status.tone}`}>{c.status.text}</span>
          <span style={{ fontSize: 15, lineHeight: '22px', fontWeight: 300, color: '#2A2F37' }}>{c.evaluationLabel} {c.evaluationText}</span>
        </div>
        <div style={{ marginTop: 30, display: 'flex', alignItems: 'flex-start', gap: 28 }}>
          {c.facts.map(fct => (
            <div key={fct.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="st-k">{fct.label}</span>
              <span className={fct.mono ? 'st-mono' : ''} style={{ fontSize: 14, lineHeight: '18px', color: '#1A2B40' }}>{fct.value}</span>
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
          {bottom.map(r => (
            <div key={r.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="st-k">{r.label}</div>
              <div style={{ fontSize: 17, lineHeight: '24px', fontWeight: 300 }}>{r.value}</div>
            </div>
          ))}
          {c.headline && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="st-k" style={{ color: '#A9561A' }}>{c.headline.label}</div>
              <div style={{ fontSize: 17, lineHeight: '24px', fontWeight: 500 }}>
                {c.headline.value}{c.headline.caption && <span className={toneClass(c.headline.tone)} style={{ fontSize: 12, fontWeight: 400, marginLeft: 10 }}>{c.headline.caption}</span>}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid #E6E1D8', fontSize: 10, lineHeight: '14px', color: '#687080', letterSpacing: '0.02em' }}>
          <span>{c.address}</span>
          <span>{c.regulated}</span>
        </div>
      </div>
    </section>
  );
};

// ── Overview ─────────────────────────────────────────────────────────────────
const UND_COLS = (u) => ['minmax(0,1fr)', '92px', '92px', '86px', u.hasDistance ? '86px' : null, u.hasStatus ? '104px' : null].filter(Boolean).join(' ');

const Overview = ({ data, page: p }) => {
  const u = p.underlyings;
  const labels = data.labels.table;
  return (
    <Page data={data} page={p} right={<KpiStrip kpis={p.kpis} />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 400px', columnGap: 44, height: '100%' }}>
        <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {u && (
            <>
              <SectionHead title={labels.underlyings} caption={u.priceCaption} />
              <div className="st-th" style={{ gridTemplateColumns: UND_COLS(u), columnGap: 10 }}>
                <span>{labels.colUnderlying}</span><span className="st-n">{labels.colInitial}</span><span className="st-n">{labels.colCurrent}</span>
                <span className="st-n">{labels.colPerformance}</span>{u.hasDistance && <span className="st-n">{u.distanceLabel || labels.colDistance}</span>}{u.hasStatus && <span className="st-n">{labels.colStatus}</span>}
              </div>
              {u.rows.map((r, i) => (
                <div key={i} className="st-tr" style={{ gridTemplateColumns: UND_COLS(u), columnGap: 10, padding: '5px 0' }}>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span className="st-mono" style={{ color: '#1A2B40', fontSize: 11.5, lineHeight: '15px' }}>{r.ticker}{r.worst && <span aria-label="worst" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: '#A9561A', verticalAlign: 'middle', marginLeft: 6 }} />}</span>
                    <span className="st-ell" style={{ fontSize: 10.5, lineHeight: '14px', color: '#687080' }}>{r.name}</span>
                  </span>
                  <span className="st-n" style={{ color: '#687080' }}>{r.initial}</span>
                  <span className="st-n">{r.current}</span>
                  <span className={`st-n ${toneClass(r.performanceTone)}`} style={{ fontWeight: 500 }}>{r.performance}</span>
                  {u.hasDistance && <span className="st-n">{r.distance || '—'}</span>}
                  {u.hasStatus && <span className={`st-n ${toneClass(r.statusTone)}`}>{r.status || '—'}</span>}
                </div>
              ))}
              {labels.worstNote && u.rows.some(r => r.worst) && <div className="st-cap" style={{ marginTop: 10 }}><span aria-label="worst" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: '#A9561A', verticalAlign: 'middle', marginRight: 2 }} /> {labels.worstNote}</div>}
              {u.missingText && <div style={{ marginTop: 14, padding: '10px 14px', background: '#FBF1E8', borderLeft: '3px solid #DD772A', fontSize: 11, lineHeight: '16px', color: '#2A2F37' }}>{u.missingText}</div>}
            </>
          )}
        </section>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 26, minWidth: 0 }}>
          {u && u.bars && (
            <div>
              <SectionHead title={u.barsCaption || labels.colPerformance} />
              <div style={{ paddingTop: 14 }}><HBarChart chart={u.bars} /></div>
            </div>
          )}
          <div>
            <SectionHead title={labels.timeline} />
            {p.timeline.map(r => (
              <div key={r.label} className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', padding: '7px 0' }}>
                <span style={{ color: r.past ? '#687080' : '#1A2B40' }}>{r.label}</span>
                <span className="st-n" style={{ color: r.past ? '#687080' : '#1A2B40', fontWeight: r.past ? 400 : 500 }}>{r.value}</span>
              </div>
            ))}
            {p.marketPrice && (
              <div className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', padding: '7px 0', borderBottom: 'none' }}>
                <span>{p.marketPrice.label}{p.marketPrice.caption && <span className="st-cap" style={{ marginLeft: 8 }}>{p.marketPrice.caption}</span>}</span>
                <span className="st-n" style={{ color: '#1A2B40', fontWeight: 500 }}>{p.marketPrice.value}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </Page>
  );
};

// ── Payoff ───────────────────────────────────────────────────────────────────
const Figures = ({ block }) => (
  <div>
    <SectionHead title={block.title} />
    {block.rows.map((r, i) => (
      <div key={i} className="st-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', padding: r.strong ? '9px 0' : '7px 0', borderBottom: r.strong ? '1.5px solid #1A2B40' : undefined, borderTop: r.strong ? '1px solid #1A2B40' : undefined }}>
        <span style={{ color: r.muted ? '#687080' : '#2A2F37', fontWeight: r.strong ? 600 : 400 }}>{r.label}</span>
        <span className={`st-n ${toneClass(r.tone)}`} style={{ color: r.tone ? undefined : r.muted ? '#687080' : '#1A2B40', fontWeight: r.strong ? 600 : 500, fontSize: r.strong ? 14 : 12 }}>{r.value}</span>
      </div>
    ))}
    {block.text && <p style={{ margin: '12px 0 0', fontSize: 11.5, lineHeight: '17px', color: '#2A2F37' }}>{block.text}</p>}
  </div>
);

const Callout = ({ block }) => (
  <div style={{ background: '#F6F3EE', padding: '16px 18px', borderLeft: '3px solid #DD772A' }}>
    <div className="st-lbl" style={{ color: '#A9561A' }}>{block.title}</div>
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 22, lineHeight: '28px', fontWeight: 300, color: '#1A2B40' }}>{block.value}</span>
      {block.caption && <span className="st-cap">{block.caption}</span>}
    </div>
    {block.text && <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: '17px', color: '#2A2F37' }}>{block.text}</p>}
    {block.note && <div className="st-cap" style={{ marginTop: 6 }}>{block.note}</div>}
  </div>
);

const Block = ({ block }) => (block.kind === 'callout' ? <Callout block={block} /> : <Figures block={block} />);

const Payoff = ({ data, page: p }) => (
  <Page data={data} page={p}>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 48, height: '100%' }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>{p.left.map((b, i) => <Block key={i} block={b} />)}</section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>{p.right.map((b, i) => <Block key={i} block={b} />)}</section>
    </div>
  </Page>
);

// ── Performance ──────────────────────────────────────────────────────────────
const Performance = ({ data, page: p }) => (
  <Page data={data} page={p}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', marginBottom: 12 }}>
      {p.legend.map((l, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, lineHeight: '14px', color: '#2A2F37' }}>
          <svg width="22" height="6" style={{ display: 'block' }}><line x1="0" x2="22" y1="3" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dashed ? '5 3' : undefined} /></svg>
          {l.label}
        </span>
      ))}
    </div>
    <MultiLineChart chart={p.chart} />
    <div className="st-cap" style={{ marginTop: 10 }}>{p.caption}</div>
  </Page>
);

// ── Schedule ─────────────────────────────────────────────────────────────────
const Schedule = ({ data, page: p }) => {
  const cols = p.columns.map(c => (c.align === 'right' ? '84px' : c.key === 'type' ? 'minmax(0,1.2fr)' : c.key === 'outcome' ? 'minmax(0,1fr)' : '96px')).join(' ');
  return (
    <Page data={data} page={p}>
      <div className="st-th" style={{ gridTemplateColumns: cols, columnGap: 12 }}>
        {p.columns.map(c => <span key={c.key} className={c.align === 'right' ? 'st-n' : ''}>{c.label}</span>)}
      </div>
      {p.rows.map((r, i) => (
        <div key={i} className="st-tr" style={{ gridTemplateColumns: cols, columnGap: 12, padding: '7px 6px', margin: '0 -6px', background: r.highlight ? '#F6F3EE' : undefined, color: r.upcoming ? '#687080' : undefined }}>
          {p.columns.map(c => (
            <span key={c.key} className={`${c.align === 'right' ? 'st-n' : 'st-ell'} ${c.toneFrom ? toneClass(r[c.toneFrom]) : ''}`} style={{ fontWeight: c.key === 'outcome' && r.highlight ? 600 : undefined }}>{r.cells[c.key]}</span>
          ))}
        </div>
      ))}
    </Page>
  );
};

// ── Notes ────────────────────────────────────────────────────────────────────
const Notes = ({ data, page: p }) => (
  <Page data={data} page={p} right={<div className="st-cap" style={{ textAlign: 'right' }}>{p.generatedText}<br />{p.sourceText}</div>}>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 48, height: '100%' }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div>
          <SectionHead title={p.labels.parameters} />
          {p.parameters.map((r, i) => (
            <div key={i} className="st-tr" style={{ gridTemplateColumns: '170px minmax(0,1fr)', columnGap: 14, padding: '6px 0', fontSize: 11.5 }}>
              <span style={{ color: '#687080' }}>{r.label}</span><span style={{ color: '#1A2B40' }}>{r.value}</span>
            </div>
          ))}
        </div>
        {p.howItWorks.length > 0 && (
          <div>
            <SectionHead title={p.labels.howItWorks} />
            {p.howItWorks.map((para, i) => <p key={i} style={{ margin: '10px 0 0', fontSize: 11, lineHeight: '16px' }}>{para}</p>)}
          </div>
        )}
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 11, lineHeight: '15.5px' }}>
        <div>
          <SectionHead title={p.labels.notice} />
          {p.notice.map((para, i) => <p key={i} style={{ margin: '8px 0 0' }}>{para}</p>)}
        </div>
        <div>
          <SectionHead title={p.labels.regulatory} />
          <p style={{ margin: '8px 0 0' }}>Amberlake Partners SAM · {data.labels.footer.middle}<br />38 Boulevard des Moulins, MC 98000 Monaco<br />amberlakepartners.com</p>
        </div>
      </section>
    </div>
  </Page>
);

const PAGE_COMPONENTS = { overview: Overview, payoff: Payoff, performance: Performance, schedule: Schedule, notes: Notes };

/** All pages of a built product report (also rendered on its own for tests). */
export const REPORT_CSS = CSS + EXTRA_CSS;
export function ProductDocument({ data }) {
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

export default function ProductReportPDF({ productId: productIdProp }) {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const pdfToken = params.get('pdfToken');
  const userId = params.get('userId');
  const lang = params.get('lang') === 'fr' ? 'fr' : 'en';
  const productId = productIdProp || (typeof window !== 'undefined' ? window.location.pathname.split('/').filter(Boolean).pop() : null);

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!pdfToken || !userId || !productId) { setError('Missing PDF token'); return undefined; }
    let cancelled = false;
    Meteor.callAsync('products.getReportForPdf', { userId, pdfToken, productId, lang })
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
      {data && <ProductDocument data={data} />}
    </div>
  );
}
