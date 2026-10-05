/**
 * Server-built view-model of a structured product report PDF, in the style of
 * the portfolio statement: cover, overview, payoff, performance chart,
 * schedule and notes, on fixed A4-landscape pages. Every figure, label and
 * page break is decided here; ProductReportPDF.jsx only renders.
 *
 * Data: the product, its latest evaluation (templateReports, one per product),
 * its stored chart data and its last price on file. The payoff-specific part
 * comes from an adapter (./adapters) chosen by the evaluation's templateId.
 */
import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';
import { TemplateReportsCollection } from '/imports/api/templateReports';
import { ChartDataCollection } from '/imports/api/chartData';
import { ProductPriceHelpers } from '/imports/api/productPrices';
import { AllocationsCollection } from '/imports/api/allocations';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { clientAllocationSelector } from '../clientAllocationScope.js';
import { formatterFor } from '../reportKit/format.js';
import { translatorFor } from './i18n.js';
import { statusOf, timelineOf, priceOf, chartOf, toIso } from './common.js';
import { adapterFor } from './adapters/index.js';

const SCHEDULE_ROWS = 15;

const chunk = (rows, size) => {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

/**
 * Same rule as the products.single publication: staff with a book-wide view
 * see every product; a client the products allocated to them; an RM those
 * allocated to their clients.
 */
async function canViewProduct(user, productId) {
  if (!user) return false;
  if ([USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE].includes(user.role)) return true;
  if (user.role === USER_ROLES.CLIENT) {
    const selector = await clientAllocationSelector(user);
    return !!(selector && await AllocationsCollection.findOneAsync({ $and: [{ productId }, selector] }));
  }
  if (user.role === USER_ROLES.RELATIONSHIP_MANAGER) {
    const clients = await UsersCollection.find({ role: USER_ROLES.CLIENT, relationshipManagerId: user._id }, { fields: { _id: 1 } }).fetchAsync();
    return !!await AllocationsCollection.findOneAsync({ productId, clientId: { $in: clients.map(c => c._id) } });
  }
  return false;
}

export async function buildProductReport({ currentUser, productId, lang = 'en', now = new Date() }) {
  if (!await canViewProduct(currentUser, productId)) throw new Meteor.Error('not-authorized', 'Product not available');
  const product = await ProductsCollection.findOneAsync(productId);
  if (!product) throw new Meteor.Error('not-found', 'Product not found');
  const report = await TemplateReportsCollection.findOneAsync({ productId }, { sort: { createdAt: -1 } });
  if (!report?.templateResults) throw new Meteor.Error('not-found', 'This product has no evaluation yet');

  const f = formatterFor(lang);
  const t = translatorFor(f.lang);
  const results = report.templateResults;
  const status = statusOf(results, product, t);
  const [chartDoc, price] = await Promise.all([
    ChartDataCollection.findOneAsync({ productId }),
    product.isin ? ProductPriceHelpers.getLatestPrice(product.isin) : null
  ]);

  const adapter = adapterFor(report.templateId);
  const built = adapter.build({ results, product, report, status, f, t, now });
  const templateLabel = adapter.templateKey ? t(adapter.templateKey) : (product.template || report.templateId || '').replace(/_/g, ' ');
  const title = results.generatedProductName || product.title || product.productName || product.isin || '—';
  const evaluationDate = report.evaluationDate || results.currentStatus?.evaluationDate || report.createdAt;
  const timeline = timelineOf(product, results, f, t, now);
  const marketPrice = priceOf(price, status, f, t);
  const chart = chartOf(chartDoc, f, t);

  // Countdown to final observation while live, else the final observation date
  const finalIso = toIso(results.timeline?.finalObservation || product.finalObservation || product.finalObservationDate);
  const daysToFinal = finalIso ? Math.ceil((Date.parse(finalIso) - Date.parse(toIso(now))) / 86400000) : null;
  const finalKpi = status.key === 'live' && Number.isFinite(daysToFinal) && daysToFinal >= 0
    ? { label: t('daysToFinal'), value: daysToFinal === 1 ? t('day') : t('days', { n: f.num(daysToFinal, 0) }) }
    : finalIso ? { label: t('finalObservation'), value: f.dateShort(finalIso) } : null;

  const header = {
    clientName: title,
    valuationText: `${t('evaluationDate')} ${f.dateLong(evaluationDate)}`,
    currencyText: product.isin ? `${t('isin')} ${product.isin}` : templateLabel
  };

  const pages = [];
  pages.push({
    type: 'overview', section: `01 · ${t('sectionOverview')}`, title: t('titleOverview'),
    kpis: [
      { label: t('status'), value: status.text },
      finalKpi,
      marketPrice ? { label: marketPrice.label, value: marketPrice.value } : null,
      built.headline ? { label: built.headline.label, value: built.headline.value, tone: built.headline.tone } : null
    ].filter(Boolean),
    timeline,
    marketPrice,
    underlyings: built.underlyings
  });
  if (built.payoff && (built.payoff.left.length || built.payoff.right.length)) {
    pages.push({ type: 'payoff', section: `02 · ${t('sectionPayoff')}`, title: built.payoff.title, left: built.payoff.left, right: built.payoff.right });
  }
  if (chart) {
    pages.push({ type: 'performance', section: `03 · ${t('sectionPerformance')}`, title: t('titlePerformance'), chart: chart.chart, legend: chart.legend, caption: t('chartCaption') });
  }
  if (built.schedule && built.schedule.rows.length) {
    chunk(built.schedule.rows, SCHEDULE_ROWS).forEach((rows, i) => pages.push({
      type: 'schedule', section: `04 · ${t('sectionSchedule')}`,
      title: i === 0 ? built.schedule.title : `${built.schedule.title} (${i + 1})`,
      columns: built.schedule.columns, rows
    }));
  }
  pages.push({
    type: 'notes', section: `05 · ${t('sectionNotes')}`, title: t('titleNotes'),
    parameters: [
      { label: t('isin'), value: product.isin || '—' },
      { label: t('issuer'), value: product.issuer || '—' },
      { label: t('currency'), value: product.currency || '—' },
      ...built.parameters
    ],
    howItWorks: built.howItWorks,
    notice: t('noticeText'),
    generatedText: t('generated', { date: f.timestamp(now) }),
    sourceText: t('sourceText', { date: f.dateLong(evaluationDate) }),
    labels: { parameters: t('parameters'), howItWorks: t('howItWorks'), notice: t('notice'), sources: t('sources'), regulatory: t('regulatory') }
  });

  const pageCount = pages.length + 1;
  pages.forEach((p, i) => { p.pageNumber = i + 2; p.pageCount = pageCount; });
  const firstPage = (type) => pages.find(p => p.type === type)?.pageNumber;
  const contents = [
    ['01', t('sectionOverview'), 'overview'], ['02', built.payoff?.title, 'payoff'], ['03', t('titlePerformance'), 'performance'],
    ['04', built.schedule?.title, 'schedule'], ['05', t('titleNotes'), 'notes']
  ].map(([n, label, type]) => ({ n, label, page: firstPage(type) })).filter(c => c.page && c.label);

  return {
    meta: { pageCount, lang: f.lang, templateId: report.templateId },
    labels: {
      footer: { left: t('footerLeft'), middle: t('footerMiddle') },
      table: {
        underlyings: t('underlyings'), colUnderlying: t('colUnderlying'), colInitial: t('colInitial'), colCurrent: t('colCurrent'),
        colPerformance: t('colPerformance'), colDistance: t('colDistance'), colStatus: t('colStatus'), timeline: t('timeline'), worstNote: t('worstNote')
      }
    },
    header,
    cover: {
      kicker: t('docKicker'),
      templateLabel,
      title,
      longTitle: title.length > 34,
      status,
      facts: [
        { label: t('isin'), value: product.isin || '—', mono: true },
        { label: t('issuer'), value: product.issuer || '—' },
        { label: t('currency'), value: product.currency || '—' }
      ],
      timeline,
      headline: built.headline,
      contents,
      contentsLabel: t('contents'),
      reportDateLabel: t('reportDate'),
      reportDate: f.dateLong(now),
      evaluationLabel: t('evaluationDate'),
      evaluationText: f.dateLong(evaluationDate),
      privateLabel: t('privateConfidential'),
      address: t('coverAddress'),
      regulated: t('footerMiddle')
    },
    pages
  };
}
