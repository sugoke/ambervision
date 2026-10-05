/**
 * SVG geometry for the server-built PDF charts (portfolio statement, product
 * reports), computed server-side so the PDF page
 * only draws what it receives (no scaling or arithmetic in the template).
 */
import { compact } from './format.js';

const round = (v) => Math.round(v * 10) / 10;

/** Nice tick step for a value range */
const niceStep = (range, targetTicks) => {
  const raw = range / Math.max(1, targetTicks);
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / magnitude;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * magnitude;
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Line chart of a value series.
 * @param {Array<{date: string, value: number}>} series - sorted by date ('YYYY-MM-DD')
 */
export const buildLineChart = (series, { width = 600, height = 230, padLeft = 56, padRight = 12, padTop = 10, padBottom = 24 } = {}) => {
  const points = (series || []).filter(p => Number.isFinite(p.value));
  if (points.length < 2) return null;
  const values = points.map(p => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= Math.abs(min) * 0.05 || 1; max += Math.abs(max) * 0.05 || 1; }
  const step = niceStep(max - min, 4);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const t0 = Date.parse(points[0].date);
  const t1 = Date.parse(points[points.length - 1].date);
  const x = (date) => padLeft + ((Date.parse(date) - t0) / Math.max(1, t1 - t0)) * plotW;
  const y = (value) => padTop + (1 - (value - lo) / (hi - lo)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(x(p.date))} ${round(y(p.value))}`).join(' ');
  const area = `${line} L${round(x(points[points.length - 1].date))} ${round(padTop + plotH)} L${round(x(points[0].date))} ${round(padTop + plotH)} Z`;

  const yTicks = [];
  for (let v = lo; v <= hi + step / 2; v += step) yTicks.push({ y: round(y(v)), label: compact(v) });

  // One tick per month start inside the range (thinned to at most 12)
  const xTicks = [];
  const start = new Date(points[0].date);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const months = [];
  while (cursor.getTime() <= t1) {
    months.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const every = Math.max(1, Math.ceil(months.length / 12));
  months.forEach((m, i) => {
    if (i % every !== 0) return;
    const iso = m.toISOString().slice(0, 10);
    xTicks.push({ x: round(x(iso)), label: m.getUTCMonth() === 0 ? String(m.getUTCFullYear()) : MONTH_ABBR[m.getUTCMonth()] });
  });

  const last = points[points.length - 1];
  return {
    width, height,
    plot: { left: padLeft, right: width - padRight, top: padTop, bottom: padTop + plotH },
    line, area, yTicks, xTicks,
    lastPoint: { x: round(x(last.date)), y: round(y(last.value)) }
  };
};

/**
 * Bar chart around a zero line (positive and negative bars).
 * @param {Array<{label: string, value: number, valueText: string, positive: boolean}>} items
 */
export const buildBarChart = (items, { width = 600, height = 200, padLeft = 44, padRight = 8, padTop = 16, padBottom = 24, tickFormat = (v) => `${v}` } = {}) => {
  const bars = (items || []).filter(i => Number.isFinite(i.value));
  if (bars.length === 0) return null;
  const values = bars.map(b => b.value);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) max = 1;
  const step = niceStep(max - min, 4);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const y = (v) => padTop + (1 - (v - lo) / (hi - lo)) * plotH;
  const slot = plotW / bars.length;
  const barW = Math.min(36, slot * 0.62);
  const zeroY = y(0);

  const yTicks = [];
  for (let v = lo; v <= hi + step / 2; v += step) yTicks.push({ y: round(y(v)), label: tickFormat(Number(v.toFixed(6))) });

  return {
    width, height, zeroY: round(zeroY),
    plot: { left: padLeft, right: width - padRight, top: padTop, bottom: padTop + plotH },
    yTicks,
    bars: bars.map((b, i) => {
      const cx = padLeft + slot * i + slot / 2;
      const top = Math.min(y(b.value), zeroY);
      const h = Math.max(1, Math.abs(y(b.value) - zeroY));
      return {
        x: round(cx - barW / 2), y: round(top), w: round(barW), h: round(h),
        labelX: round(cx), label: b.label,
        valueText: b.valueText, valueY: round(b.value >= 0 ? top - 4 : top + h + 10),
        positive: b.positive
      };
    })
  };
};

/**
 * Several lines over one date axis, e.g. underlyings rebased to 100 with the
 * product's barrier and autocall levels. The axis runs over `range` (launch to
 * maturity) even where the lines stop (today), so the remaining time shows.
 *
 * @param {Object} spec
 * @param {[string, string]} spec.range - first and last date ('YYYY-MM-DD')
 * @param {Array<{label, color, dashed, points: Array<{date, value}>}>} spec.series
 * @param {Array<{date, label}>} [spec.markers] - vertical lines (observation dates)
 * @param {Function} [spec.tickFormat] - y label from a value
 * @param {Function} [spec.monthLabel] - x label from a month index (0-11)
 */
export const buildMultiLineChart = ({ range, series, markers = [], tickFormat = (v) => `${v}`, monthLabel = (m) => MONTH_ABBR[m] }, { width = 640, height = 300, padLeft = 44, padRight = 12, padTop = 12, padBottom = 26 } = {}) => {
  const usable = (series || [])
    .map(s => ({ ...s, points: (s.points || []).filter(p => p && p.date && Number.isFinite(p.value)) }))
    .filter(s => s.points.length >= 2);
  if (!usable.length || !range || !range[0] || !range[1]) return null;
  const values = usable.flatMap(s => s.points.map(p => p.value));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 5; max += 5; }
  const step = niceStep(max - min, 5);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const t0 = Date.parse(range[0]);
  const t1 = Date.parse(range[1]);
  const x = (date) => padLeft + ((Date.parse(date) - t0) / Math.max(1, t1 - t0)) * plotW;
  const y = (value) => padTop + (1 - (value - lo) / (hi - lo)) * plotH;

  // Constant stretches (barrier lines) need only their end points
  const thin = (points) => points.filter((p, i) => i === 0 || i === points.length - 1
    || p.value !== points[i - 1].value || p.value !== points[i + 1].value);

  const lines = usable.map(s => ({
    label: s.label,
    color: s.color,
    dashed: !!s.dashed,
    d: thin(s.points).map((p, i) => `${i === 0 ? 'M' : 'L'}${round(x(p.date))} ${round(y(p.value))}`).join(' ')
  }));

  const yTicks = [];
  for (let v = lo; v <= hi + step / 2; v += step) yTicks.push({ y: round(y(v)), label: tickFormat(Number(v.toFixed(6))) });

  const xTicks = [];
  const months = [];
  const cursor = new Date(Date.UTC(new Date(t0).getUTCFullYear(), new Date(t0).getUTCMonth() + 1, 1));
  while (cursor.getTime() <= t1) { months.push(new Date(cursor)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
  const every = Math.max(1, Math.ceil(months.length / 12));
  months.forEach((m, i) => {
    if (i % every !== 0) return;
    xTicks.push({ x: round(x(m.toISOString().slice(0, 10))), label: m.getUTCMonth() === 0 || i === 0 ? `${monthLabel(m.getUTCMonth())} ${String(m.getUTCFullYear()).slice(2)}` : monthLabel(m.getUTCMonth()) });
  });

  return {
    width, height,
    plot: { left: padLeft, right: width - padRight, top: padTop, bottom: padTop + plotH },
    yTicks, xTicks, lines,
    markers: markers
      .filter(m => m && m.date && Date.parse(m.date) >= t0 && Date.parse(m.date) <= t1)
      .map(m => ({ x: round(x(m.date)), label: m.label })),
    lastPoints: usable.filter(s => !s.dashed).map(s => {
      const p = s.points[s.points.length - 1];
      return { x: round(x(p.date)), y: round(y(p.value)), color: s.color };
    })
  };
};

/**
 * Horizontal bars around a zero axis, one row per item, with an optional
 * vertical reference (a barrier, as a performance such as -50 for 50%).
 * @param {Array<{label, value, valueText, tone}>} items - value in %
 */
export const buildHBarChart = (items, { reference = null, width = 460, rowHeight = 26, labelWidth = 70, valueWidth = 64, tickFormat = (v) => `${v}` } = {}) => {
  const rows = (items || []).filter(i => Number.isFinite(i.value));
  if (!rows.length) return null;
  const values = rows.map(r => r.value).concat(Number.isFinite(reference) ? [reference] : []);
  const step = niceStep(Math.max(...values, 0) - Math.min(...values, 0) || 10, 4);
  const lo = Math.min(0, Math.floor(Math.min(...values) / step) * step);
  const hi = Math.max(0, Math.ceil(Math.max(...values) / step) * step);
  const left = labelWidth;
  const right = width - valueWidth;
  const x = (v) => left + ((v - lo) / Math.max(1e-9, hi - lo)) * (right - left);
  const zeroX = x(0);
  const height = rows.length * rowHeight + 22;
  return {
    width, height,
    plot: { left, right, top: 0, bottom: rows.length * rowHeight },
    zeroX: round(zeroX),
    reference: Number.isFinite(reference) ? { x: round(x(reference)) } : null,
    ticks: [...new Set([lo, 0, hi])].map(v => ({ x: round(x(v)), label: tickFormat(v) })),
    rows: rows.map((r, i) => ({
      y: i * rowHeight, h: rowHeight, label: r.label, valueText: r.valueText, tone: r.tone,
      barX: round(Math.min(x(r.value), zeroX)), barW: round(Math.max(1, Math.abs(x(r.value) - zeroX)))
    }))
  };
};
