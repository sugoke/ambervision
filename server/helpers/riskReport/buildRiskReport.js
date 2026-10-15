/**
 * Server-built view-model of the underlyings risk report PDF, in the style of
 * the portfolio statement: cover, summary, products below barrier, commentary
 * per underlying, products down 15%+ and methodology, on fixed A4-landscape
 * pages. Every string and page break is decided here; RiskAnalysisPDF.jsx only
 * renders.
 *
 * Page breaks: the AI commentary has no fixed length, so each block's height
 * is estimated from its text (characters per line at the column width) and
 * blocks are packed onto pages without ever being cut in two.
 */
import { Meteor } from 'meteor/meteor';
import { RiskAnalysisReportsCollection } from '/imports/api/riskAnalysis';
import { UsersCollection } from '/imports/api/users';
import { isSeeAll, isStaff } from '../accessPolicy.js';
import { formatterFor } from '../reportKit/format.js';
import { translatorFor } from './i18n.js';

// Room for the page body between the title rule and the footer (px)
const BODY_HEIGHT = 535;
const TABLE_ROWS = 10;
// Poppins averages about 0.54 em per character (measured on rendered reports)
const charsPerLine = (widthPx, fontPx) => Math.floor(widthPx / (fontPx * 0.54));

const plain = (text) => String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
const paragraphsOf = (text) => plain(text).split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
const textHeight = (paras, widthPx, fontPx = 11.5, lineHeight = 17, gap = 8) => paras.reduce(
  (h, p, i) => h + Math.ceil(p.length / charsPerLine(widthPx, fontPx)) * lineHeight + (i > 0 ? gap : 0), 0
);

/** Pack items ({ h, keepWithNext }) onto pages of `budget` px, never splitting an item. */
function flow(items, budget) {
  const pages = [];
  let current = [];
  let used = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const need = item.keepWithNext && items[i + 1] ? item.h + items[i + 1].h : item.h;
    if (current.length > 0 && used + need > budget) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += item.h;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

const chunk = (rows, size) => {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

const userName = (u) => {
  const full = [u?.profile?.firstName, u?.profile?.lastName].filter(Boolean).join(' ').trim();
  return full || u?.username || u?.emails?.[0]?.address || '—';
};

export async function buildRiskReport({ currentUser, reportId, lang = null, now = new Date() }) {
  if (!isStaff(currentUser)) throw new Meteor.Error('not-authorized', 'Insufficient permissions');
  const report = await RiskAnalysisReportsCollection.findOneAsync(
    isSeeAll(currentUser) ? { _id: reportId } : { _id: reportId, generatedBy: currentUser._id }
  );
  if (!report) throw new Meteor.Error('not-found', 'Risk analysis report not found');

  const scopedUser = report.scopedToUserId
    ? await UsersCollection.findOneAsync(report.scopedToUserId, { fields: { username: 1, emails: 1, 'profile.firstName': 1, 'profile.lastName': 1 } })
    : null;
  return layoutRiskReport(report, { lang, scopeName: scopedUser ? userName(scopedUser) : null, now });
}

/**
 * Pages of a stored risk report (no database access).
 * @param {Object} report - riskAnalysisReports document
 * @param {Object} opts - { lang (fallback when the report has none), scopeName (RM of a scoped report), now }
 */
export function layoutRiskReport(report, { lang = null, scopeName = null, now = new Date() } = {}) {
  // The commentary is written in the report's language: the labels follow it
  const f = formatterFor(report.language || lang || 'en');
  const t = translatorFor(f.lang);

  const scopeText = report.scopedToUserId ? t('scopeOf', { name: scopeName || '—' }) : t('scopeAll');
  const asOf = report.asOfDate || report.generatedAt;

  const summary = report.summary || {};
  const analyses = report.analyses || [];
  const impacted = report.impactedProducts || [];
  const down = report.productsDownSinceLaunch || [];

  const daysText = (n) => (!Number.isFinite(n) ? '—' : n < 0 ? t('expired') : n === 1 ? t('day') : t('days', { n: f.num(n, 0) }));
  const nominalText = (amount, ccy) => (amount > 0 ? `${f.num(amount, 0)}${ccy ? ` ${ccy}` : ''}` : '—');
  const distTone = (d) => (d < 0 ? 'neg' : 'pos');

  const pages = [];
  const sections = [];
  const startSection = (key, title) => {
    const n = String(sections.length + 1).padStart(2, '0');
    sections.push({ n, key, label: title });
    return n;
  };
  const pushPage = (page) => { pages.push(page); return pages.length + 1; }; // cover is page 1

  // ── 01 Summary ────────────────────────────────────────────────────────────
  const nSummary = startSection('summary', t('titleSummary'));
  const execParas = paragraphsOf(report.executiveSummary);
  const glance = [
    { label: t('rowProducts'), value: Number.isFinite(report.totalProducts) ? f.num(report.totalProducts, 0) : '—' },
    { label: t('rowBelowUnique'), value: f.num(summary.uniqueUnderlyings || 0, 0), tone: summary.uniqueUnderlyings > 0 ? 'neg' : null, strong: true },
    { label: t('rowCritical'), value: f.num(summary.criticalRisk || 0, 0), muted: true },
    { label: t('rowHigh'), value: f.num(summary.highRisk || 0, 0), muted: true },
    { label: t('rowProductsBelow'), value: f.num(impacted.length, 0) },
    summary.uniqueUnderlyings > 0 ? { label: t('rowAvgDistance'), value: f.signedPctOf(summary.averageDistanceToBarrier, 1), tone: 'neg' } : null,
    summary.uniqueUnderlyings > 0 ? { label: t('rowAvgDays'), value: daysText(Math.round(summary.averageDaysRemaining)) } : null,
    { label: t('rowDown'), value: f.num(down.length, 0), tone: down.length > 0 ? 'neg' : null }
  ].filter(Boolean);

  // Executive summary in the left column (590 px); overflow continues on a text page
  const execPages = flow(execParas.map(p => ({ h: textHeight([p], 590, 12, 18) + 10, text: p })), BODY_HEIGHT - 40);
  pushPage({
    type: 'summary', section: `${nSummary} · ${t('sectionSummary')}`, title: t('titleSummary'),
    kpis: [
      { label: t('kpiProducts'), value: Number.isFinite(report.totalProducts) ? f.num(report.totalProducts, 0) : '—' },
      { label: t('kpiBelow'), value: f.num(summary.uniqueUnderlyings || 0, 0), tone: summary.uniqueUnderlyings > 0 ? 'neg' : null },
      { label: t('kpiCritical'), value: f.num(summary.criticalRisk || 0, 0), tone: summary.criticalRisk > 0 ? 'neg' : null },
      { label: t('kpiDown'), value: f.num(down.length, 0), tone: down.length > 0 ? 'neg' : null }
    ],
    execTitle: t('executiveSummary'),
    paragraphs: (execPages[0] || []).map(i => i.text),
    glanceTitle: t('glance'),
    glance,
    allClear: summary.uniqueUnderlyings > 0 ? null : t('allClear')
  });
  execPages.slice(1).forEach(items => pushPage({
    type: 'text', section: `${nSummary} · ${t('sectionSummary')}`, title: t('continued', { title: t('titleSummary') }),
    paragraphs: items.map(i => i.text)
  }));

  // ── 02 Products below barrier ─────────────────────────────────────────────
  if (impacted.length > 0) {
    const n = startSection('below', t('titleBelow'));
    const rows = impacted.map(p => ({
      title: p.productTitle || p.productIsin || '—',
      isin: p.productIsin || '',
      below: (p.atRiskUnderlyings || [])
        .slice().sort((a, b) => a.distanceToBarrier - b.distanceToBarrier)
        .map(u => ({ symbol: u.symbol, value: f.signedPctOf(u.distanceToBarrier, 1) })),
      barrier: Number.isFinite(p.barrierLevel) ? f.pctOf(p.barrierLevel, 0) : '—',
      worst: f.signedPctOf(p.worstDistance, 1),
      worstTone: distTone(p.worstDistance),
      final: p.finalObservation ? f.dateCompact(p.finalObservation) : daysText(p.daysRemaining),
      finalCaption: p.finalObservation ? daysText(p.daysRemaining) : null,
      nominal: nominalText(p.clientNotional, p.productCurrency)
    }));
    chunk(rows, TABLE_ROWS).forEach((part, i) => pushPage({
      type: 'belowTable', section: `${n} · ${t('sectionBelow')}`,
      title: i === 0 ? t('titleBelow') : t('continued', { title: t('titleBelow') }),
      kpis: i === 0 ? [{ label: t('rowProductsBelow'), value: f.num(impacted.length, 0) }] : [],
      columns: { product: t('colProduct'), below: t('colBelow'), barrier: t('colBarrier'), worst: t('colWorst'), final: t('colFinal'), nominal: t('colNominal') },
      rows: part
    }));
  }

  // ── 03 Commentary per underlying below its barrier ────────────────────────
  const commentPage = new Map(); // symbol -> page number of its commentary
  if (analyses.length > 0) {
    const n = startSection('underlyings', t('titleUnderlyings'));
    const blocks = analyses
      .slice().sort((a, b) => a.distanceToBarrier - b.distanceToBarrier)
      .map(a => {
        const paras = paragraphsOf(a.analysis);
        const products = (a.products || []).slice().sort((x, y) => x.distanceToBarrier - y.distanceToBarrier).map(p => ({
          title: p.productTitle || p.productIsin || '—',
          isin: p.productIsin || '',
          value: f.signedPctOf(p.distanceToBarrier, 1),
          tone: distTone(p.distanceToBarrier)
        }));
        const critical = a.distanceToBarrier < -5;
        const metrics = [
          { label: t('current'), value: f.num(a.currentPrice, 2) },
          { label: t('initial'), value: f.num(a.strikePrice, 2) },
          { label: t('barrierPrice'), value: `${f.num(a.barrierPrice, 2)}${Number.isFinite(a.barrierLevel) ? ` · ${f.pctOf(a.barrierLevel, 0)}` : ''}` },
          { label: t('performance'), value: f.signedPctOf(a.performance, 2), tone: a.performance < 0 ? 'neg' : 'pos' },
          { label: t('distance'), value: f.signedPctOf(a.distanceToBarrier, 1), tone: distTone(a.distanceToBarrier) },
          { label: t('timeLeft'), value: daysText(a.daysRemaining) }
        ];
        // header 34 + body + products + separation
        const bodyH = Math.max(metrics.length * 24, textHeight(paras, 690) + (products.length ? 26 + products.length * 19 : 0));
        return {
          kind: 'underlying',
          h: 34 + 10 + bodyH + 30,
          symbol: a.symbol,
          name: a.companyName || '',
          badge: critical ? t('riskCritical') : t('riskHigh'),
          badgeTone: critical ? 'critical' : 'high',
          metrics,
          paragraphs: paras,
          productsLabel: t('inProducts'),
          products
        };
      });
    flow(blocks, BODY_HEIGHT).forEach((items, i) => {
      const pageNumber = pushPage({
        type: 'blocks', section: `${n} · ${t('sectionUnderlyings')}`,
        title: i === 0 ? t('titleUnderlyings') : t('continued', { title: t('titleUnderlyings') }),
        blocks: items
      });
      items.forEach(b => { if (!commentPage.has(b.symbol)) commentPage.set(b.symbol, pageNumber); });
    });
  }

  // ── 04 Products down 15%+ on their cost ───────────────────────────────────
  if (down.length > 0) {
    const n = startSection('down', t('titleDown'));
    const rows = down.map(p => ({
      title: p.productTitle || p.productIsin || '—',
      isin: p.productIsin || '',
      price: f.pctOf(p.latestPrice, 2),
      priceCaption: p.priceDate ? f.dateCompact(p.priceDate) : null,
      cost: p.baselineSource === 'default_100' ? `${f.pctOf(100, 2)}*` : f.pctOf(p.baselineCost, 2),
      loss: f.signedPctOf(p.lossPercent, 1),
      nominal: nominalText(p.clientNominal, p.currency)
    }));
    const tableParts = chunk(rows, TABLE_ROWS);
    tableParts.forEach((part, i) => pushPage({
      type: 'downTable', section: `${n} · ${t('sectionDown')}`,
      title: i === 0 ? t('titleDown') : t('continued', { title: t('titleDown') }),
      kpis: i === 0 ? [{ label: t('kpiDown'), value: f.num(down.length, 0), tone: 'neg' }] : [],
      columns: { product: t('colProduct'), price: t('colPrice'), cost: t('colCost'), loss: t('colLoss'), nominal: t('colNominal') },
      rows: part,
      footnote: down.some(p => p.baselineSource === 'default_100') ? `* ${t('defaultCost')}` : null
    }));

    // Commentary: one head per product, one item per declining underlying
    const items = [];
    for (const p of down) {
      items.push({
        kind: 'productHead', h: 52, keepWithNext: (p.underlyings || []).length > 0,
        title: p.productTitle || p.productIsin || '—',
        isin: p.productIsin || '',
        caption: `${t('latestPrice', { price: f.pctOf(p.latestPrice, 2), date: p.priceDate ? f.dateShort(p.priceDate) : '—' })} · ${t('costBasis', { cost: p.baselineSource === 'default_100' ? t('defaultCost') : f.pctOf(p.baselineCost, 2) })}`,
        loss: f.signedPctOf(p.lossPercent, 1),
        note: p.underlyingsDataUnavailable ? t('noUnderlyingData') : p.note === 'no-declining-underlyings' ? t('noDecliners') : null
      });
      for (const u of p.underlyings || []) {
        // A stock already commented (section 03, or an earlier product here)
        // points back to that page instead of repeating the text
        const repeated = commentPage.has(u.symbol);
        const paras = repeated ? [] : paragraphsOf(u.analysis);
        if (!repeated) commentPage.set(u.symbol, null); // page known once placed
        items.push({
          kind: 'decliner',
          h: 26 + (repeated ? 18 : textHeight(paras, 960)) + 16,
          symbol: u.symbol,
          name: u.name || '',
          performance: f.signedPctOf(u.performance, 2),
          paragraphs: paras,
          repeated
        });
      }
    }
    flow(items, BODY_HEIGHT).forEach((pageItems) => {
      const pageNumber = pushPage({
        type: 'blocks', section: `${n} · ${t('sectionDown')}`,
        title: t('continued', { title: t('titleDown') }),
        blocks: pageItems
      });
      pageItems.forEach(b => { if (b.kind === 'decliner' && !b.repeated) commentPage.set(b.symbol, pageNumber); });
    });
    for (const b of items) {
      if (b.repeated) b.reference = t('seeAbove', { page: commentPage.get(b.symbol) });
    }
  }

  // ── Methodology ───────────────────────────────────────────────────────────
  const nNotes = startSection('notes', t('titleNotes'));
  pushPage({
    type: 'notes', section: `${nNotes} · ${t('sectionNotes')}`, title: t('titleNotes'),
    generatedText: `${t('generatedLabel')} ${f.timestamp(report.generatedAt || now)}`,
    left: [
      { title: t('notesPerimeter'), text: t('notesPerimeterText', { scope: report.scopedToUserId ? t('notesPerimeterScoped', { name: scopeName || '—' }) : t('notesPerimeterAll') }) },
      { title: t('notesPerformance'), text: t('notesPerformanceText') },
      { title: t('notesBarrier'), text: t('notesBarrierText') }
    ],
    right: [
      { title: t('notesDown'), text: t('notesDownText') },
      { title: t('notesCommentary'), text: t('notesCommentaryText') },
      { title: t('notice'), text: t('noticeText') }
    ]
  });

  const pageCount = pages.length + 1;
  pages.forEach((p, i) => { p.pageNumber = i + 2; p.pageCount = pageCount; });
  const firstPageOf = (prefix) => pages.find(p => p.section.startsWith(prefix))?.pageNumber;

  return {
    meta: { pageCount, lang: f.lang },
    labels: { footer: { left: t('footerLeft'), middle: t('footerMiddle') } },
    header: {
      clientName: scopeText,
      valuationText: t('pricesAsOf', { date: f.dateLong(asOf) }),
      currencyText: t('docKicker')
    },
    cover: {
      kicker: t('docKicker'),
      title: t('docTitle'),
      privateLabel: t('privateConfidential'),
      facts: [
        { label: t('scopeLabel'), value: scopeText },
        { label: t('asOfLabel'), value: f.dateLong(asOf) },
        { label: t('generatedLabel'), value: f.timestamp(report.generatedAt || now) }
      ],
      headline: [
        { label: t('kpiProducts'), value: Number.isFinite(report.totalProducts) ? f.num(report.totalProducts, 0) : '—' },
        { label: t('kpiBelow'), value: f.num(summary.uniqueUnderlyings || 0, 0), tone: summary.uniqueUnderlyings > 0 ? 'neg' : null },
        { label: t('rowProductsBelow'), value: f.num(impacted.length, 0) },
        { label: t('kpiDown'), value: f.num(down.length, 0), tone: down.length > 0 ? 'neg' : null }
      ],
      contentsLabel: t('contents'),
      contents: sections.map(s => ({ n: s.n, label: s.label, page: firstPageOf(`${s.n} ·`) })).filter(c => c.page),
      address: t('coverAddress'),
      regulated: t('footerMiddle')
    },
    pages
  };
}
