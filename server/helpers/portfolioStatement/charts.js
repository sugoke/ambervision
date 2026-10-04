/**
 * SVG geometry for the statement's charts, computed server-side so the PDF page
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
