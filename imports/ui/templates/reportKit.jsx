import React, { useEffect } from 'react';

/**
 * Building blocks of the server-built PDF documents (portfolio statement,
 * product reports): one fixed A4-landscape page per <section>, the Amberlake
 * header and footer, KPI strips and SVG charts. Display only: every figure,
 * label and coordinate comes from the server.
 */

export const LOGO = '/images/amberlake-logo.png';

export const CSS = `
@page { size: A4 landscape; margin: 0; }
html, body { margin: 0; padding: 0; background: #FFFFFF !important; }
* { print-color-adjust: exact; -webkit-print-color-adjust: exact; box-sizing: border-box; }
.st-doc { background: #FFFFFF; }
/* Print only the statement, anchored at the sheet origin: anything the app
   shell renders around the route would otherwise shift every fixed page. */
@media print {
  /* The app shell gives html, body and #react-target overflow-x: hidden, which
     turns them into scroll containers: Chrome then prints only what fits the
     first sheet. Undo it on every element that wraps the statement. */
  html, body, :has(.st-doc) { height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; }
  body * { visibility: hidden; }
  .st-doc, .st-doc * { visibility: visible; }
  .st-doc { position: absolute; left: 0; top: 0; width: 1123px; }
}
.st-page { width: 1123px; height: 794px; position: relative; overflow: hidden; background: #FFFFFF; color: #2A2F37;
  font-family: 'Poppins','Helvetica Neue',sans-serif; -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums lining-nums;
  break-after: page; page-break-after: always; }
.st-page:last-child { break-after: auto; page-break-after: auto; }
.st-inner { padding: 30px 56px 36px; display: flex; flex-direction: column; height: 100%; }
.st-mono { font-family: 'IBM Plex Mono',ui-monospace,Menlo,monospace; }
.st-k { font-size: 10px; line-height: 14px; letter-spacing: 0.2em; text-transform: uppercase; font-weight: 500; color: #687080; }
.st-lbl { font-size: 10px; line-height: 14px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 500; color: #687080; }
.st-pos { color: #2E7559; } .st-neg { color: #B23B2A; }
.st-n { text-align: right; white-space: nowrap; }
.st-cap { font-size: 10.5px; line-height: 15px; color: #687080; }
.st-ph { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 9px; border-bottom: 1px solid #1A2B40; }
.st-tr { display: grid; align-items: center; font-size: 12px; line-height: 17px; padding: 6px 0; border-bottom: 1px solid #EEE9E1; }
.st-th { display: grid; align-items: end; font-size: 10px; line-height: 13px; color: #687080; padding: 8px 0 6px; border-bottom: 1px solid #E6E1D8; }
.st-toc { display: grid; grid-template-columns: 36px minmax(0,1fr) 28px; align-items: baseline; padding: 13px 0; border-bottom: 1px solid #E6E1D8; }
.st-ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

export const tone = (t) => (t === 'pos' ? 'st-pos' : t === 'neg' ? 'st-neg' : '');

export const Header = ({ header }) => (
  <header style={{ flex: 'none', height: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <img src={LOGO} alt="Amberlake Partners" style={{ height: 20, width: 'auto', display: 'block' }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 10.5, lineHeight: '14px', color: '#687080' }}>
      <span style={{ color: '#1A2B40', fontWeight: 500 }}>{header.clientName}</span>
      <span style={{ width: 1, height: 12, background: '#D9D3C8' }} />
      <span>{header.valuationText}</span>
      <span style={{ width: 1, height: 12, background: '#D9D3C8' }} />
      <span>{header.currencyText}</span>
    </div>
  </header>
);

export const Title = ({ page, right }) => (
  <div style={{ flex: 'none', marginTop: 24, paddingBottom: 16, borderBottom: '1px solid #E6E1D8', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="st-lbl" style={{ color: '#A9561A' }}>{page.section}</div>
      <h1 style={{ margin: 0, fontSize: 30, lineHeight: '36px', fontWeight: 300, letterSpacing: '-0.01em', color: '#1A2B40' }}>{page.title}</h1>
    </div>
    {right}
  </div>
);

export const KpiStrip = ({ kpis }) => (kpis && kpis.length ? (
  <div style={{ display: 'flex', gap: 28 }}>
    {kpis.map((k, i) => (
      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
        <span className="st-cap">{k.label}</span>
        <span className={tone(k.tone)} style={{ fontSize: 15, lineHeight: '20px', color: k.tone ? undefined : '#1A2B40', fontWeight: 500 }}>{k.value}</span>
      </div>
    ))}
  </div>
) : null);

const FOOTER_DEFAULT = { left: 'Amberlake Partners SAM · Private and confidential', middle: 'SEC registered · CCAF regulated' };

export const Footer = ({ page, labels = FOOTER_DEFAULT }) => (
  <footer style={{ flex: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #E6E1D8', paddingTop: 9, fontSize: 10, lineHeight: '14px', color: '#687080' }}>
    <span>{labels.left}</span>
    <span>{labels.middle}</span>
    <span><span style={{ color: '#1A2B40', fontWeight: 500 }}>{page.pageNumber}</span> / {page.pageCount}</span>
  </footer>
);

export const Page = ({ data, page, right, children }) => (
  <section className="st-page">
    <div className="st-inner">
      <Header header={data.header} />
      <Title page={page} right={right} />
      <main style={{ flex: 1, minHeight: 0, paddingTop: 20 }}>{children}</main>
      <Footer page={page} labels={data.labels?.footer} />
    </div>
  </section>
);

export const Bar = ({ pct, color = '#1A2B40', height = 3 }) => (
  <div style={{ height, background: '#F1EDE6' }}><div style={{ width: `${pct}%`, height, background: color }} /></div>
);


export const LineChart = ({ chart }) => (
  <svg width={chart.width} height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} style={{ display: 'block' }}>
    {chart.yTicks.map((t, i) => (
      <g key={i}>
        <line x1={chart.plot.left} x2={chart.plot.right} y1={t.y} y2={t.y} stroke="#EEE9E1" strokeWidth="1" />
        <text x={chart.plot.left - 8} y={t.y + 3} textAnchor="end" fontSize="9.5" fill="#687080" fontFamily="IBM Plex Mono, monospace">{t.label}</text>
      </g>
    ))}
    {chart.xTicks.map((t, i) => <text key={i} x={t.x} y={chart.plot.bottom + 16} textAnchor="middle" fontSize="9.5" fill="#687080" fontFamily="Poppins, sans-serif">{t.label}</text>)}
    <path d={chart.area} fill="#1A2B40" fillOpacity="0.06" />
    <path d={chart.line} fill="none" stroke="#1A2B40" strokeWidth="1.6" />
    <circle cx={chart.lastPoint.x} cy={chart.lastPoint.y} r="3" fill="#DD772A" />
  </svg>
);

export const BarChart = ({ chart }) => (
  <svg width={chart.width} height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} style={{ display: 'block' }}>
    {chart.yTicks.map((t, i) => (
      <g key={i}>
        <line x1={chart.plot.left} x2={chart.plot.right} y1={t.y} y2={t.y} stroke="#EEE9E1" strokeWidth="1" />
        <text x={chart.plot.left - 6} y={t.y + 3} textAnchor="end" fontSize="9" fill="#687080" fontFamily="IBM Plex Mono, monospace">{t.label}</text>
      </g>
    ))}
    <line x1={chart.plot.left} x2={chart.plot.right} y1={chart.zeroY} y2={chart.zeroY} stroke="#9A9389" strokeWidth="1" />
    {chart.bars.map((b, i) => (
      <g key={i}>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={b.positive ? '#2E7559' : '#C76A5A'} />
        {b.valueText && <text x={b.labelX} y={b.valueY} textAnchor="middle" fontSize="8.5" fill="#2A2F37" fontFamily="IBM Plex Mono, monospace">{b.valueText}</text>}
        <text x={b.labelX} y={chart.plot.bottom + 14} textAnchor="middle" fontSize="9" fill="#687080" fontFamily="Poppins, sans-serif">{b.label}</text>
      </g>
    ))}
  </svg>
);


/**
 * Several lines on one date axis (server geometry from buildMultiLineChart):
 * solid lines for underlyings, dashed for barrier and autocall levels, thin
 * vertical lines for observation dates.
 */
export const MultiLineChart = ({ chart }) => (
  <svg width={chart.width} height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} style={{ display: 'block' }}>
    {chart.yTicks.map((t, i) => (
      <g key={i}>
        <line x1={chart.plot.left} x2={chart.plot.right} y1={t.y} y2={t.y} stroke="#EEE9E1" strokeWidth="1" />
        <text x={chart.plot.left - 8} y={t.y + 3} textAnchor="end" fontSize="9.5" fill="#687080" fontFamily="IBM Plex Mono, monospace">{t.label}</text>
      </g>
    ))}
    {chart.markers.map((m, i) => (
      <g key={i}>
        <line x1={m.x} x2={m.x} y1={chart.plot.top} y2={chart.plot.bottom} stroke="#D9D3C8" strokeWidth="1" strokeDasharray="2 3" />
        {m.label && <text x={m.x} y={chart.plot.top + 8} textAnchor="middle" fontSize="8" fill="#9A9389" fontFamily="Poppins, sans-serif">{m.label}</text>}
      </g>
    ))}
    {chart.xTicks.map((t, i) => <text key={i} x={t.x} y={chart.plot.bottom + 16} textAnchor="middle" fontSize="9.5" fill="#687080" fontFamily="Poppins, sans-serif">{t.label}</text>)}
    {chart.lines.map((l, i) => (
      <path key={i} d={l.d} fill="none" stroke={l.color} strokeWidth={l.dashed ? 1.3 : 1.6} strokeDasharray={l.dashed ? '6 4' : undefined} />
    ))}
    {chart.lastPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.6" fill={p.color} />)}
  </svg>
);

/** Horizontal bars around zero with an optional reference line (buildHBarChart). */
export const HBarChart = ({ chart }) => (
  <svg width={chart.width} height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} style={{ display: 'block' }}>
    {chart.rows.map((r, i) => (
      <g key={i}>
        <text x={0} y={r.y + r.h / 2 + 4} fontSize="10.5" fill="#1A2B40" fontFamily="IBM Plex Mono, monospace">{r.label}</text>
        <rect x={chart.plot.left} y={r.y + 7} width={chart.plot.right - chart.plot.left} height={r.h - 14} fill="#F6F3EE" />
        <rect x={r.barX} y={r.y + 7} width={r.barW} height={r.h - 14} fill={r.tone === 'neg' ? '#C76A5A' : r.tone === 'warn' ? '#DD772A' : '#2E7559'} />
        <text x={chart.width} y={r.y + r.h / 2 + 4} textAnchor="end" fontSize="10.5" fill={r.tone === 'neg' ? '#B23B2A' : '#2E7559'} fontFamily="Poppins, sans-serif" fontWeight="500">{r.valueText}</text>
      </g>
    ))}
    <line x1={chart.zeroX} x2={chart.zeroX} y1={0} y2={chart.plot.bottom} stroke="#9A9389" strokeWidth="1" />
    {chart.reference && <line x1={chart.reference.x} x2={chart.reference.x} y1={-2} y2={chart.plot.bottom + 2} stroke="#1A2B40" strokeWidth="1.4" strokeDasharray="4 3" />}
    {chart.ticks.map((t, i) => <text key={i} x={t.x} y={chart.plot.bottom + 15} textAnchor="middle" fontSize="9" fill="#687080" fontFamily="IBM Plex Mono, monospace">{t.label}</text>)}
  </svg>
);

/** Self-hosted fonts (CSP font-src 'self'). */
export const PdfFonts = () => (
  <>
    <link rel="stylesheet" href="/fonts/poppins.css" />
    <link rel="stylesheet" href="/fonts/fonts.css" />
  </>
);

/**
 * PDF-mode body flag on mount, and the ready flag Puppeteer waits for once the
 * document (or its error) has rendered and the fonts are in.
 */
export const usePdfReady = (done) => {
  useEffect(() => {
    document.body.setAttribute('data-pdf-mode', 'true');
    return () => document.body.removeAttribute('data-pdf-mode');
  }, []);
  useEffect(() => {
    if (!done) return;
    const ready = () => document.body.setAttribute('data-pdf-ready', 'true');
    if (document.fonts?.ready) document.fonts.ready.then(() => setTimeout(ready, 300)); else setTimeout(ready, 800);
  }, [done]);
};
