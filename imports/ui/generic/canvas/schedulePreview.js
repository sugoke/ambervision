/**
 * Explode canvas lines into a flat, date-sorted schedule with provenance, so
 * the Schedule tab can list every observation and edit its dates (writing
 * overrides back to the source line). Mirrors compile.js date arithmetic.
 */

import { addByUnit, loopStep, loopCount } from '/imports/api/genericProducts/canvas/frequency.js';

function round2(x) { return Math.round(x * 100) / 100; }
function addDaysIso(iso, days) {
  if (!iso) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function explodeSchedule(lines, fallbackEnd) {
  const rows = [];
  for (const line of lines || []) {
    if (line.lineType === 'loop') {
      const { unit: freqUnit, n: freqN } = loopStep(line);
      const periods = loopCount(line, fallbackEnd);
      for (let i = 0; i < periods; i++) {
        const obsOverride = line.dateOverrides ? line.dateOverrides[i] : undefined;
        const observationDate = obsOverride || addByUnit(line.firstObservation, freqUnit, i * freqN);
        const payOverride = line.paymentDateOverrides ? line.paymentDateOverrides[i] : undefined;
        const paymentDate = payOverride || addDaysIso(observationDate, line.paymentLagDays || 0);
        const levels = {};
        for (const col of line.columns || []) {
          const ov = col.overrides ? col.overrides[i] : undefined;
          levels[col.key] = ov !== undefined && ov !== null ? ov : round2((col.initial || 0) - (col.stepPerPeriod || 0) * i);
        }
        rows.push({
          key: `${line.id}_${i}`, lineId: line.id, lineType: 'loop', period: i,
          observationDate, paymentDate, levels,
          eventCount: (line.rules || []).length,
          obsOverridden: !!obsOverride, payOverridden: !!payOverride
        });
      }
    } else if (line.lineType === 'single') {
      rows.push({
        key: line.id, lineId: line.id, lineType: 'single', period: null,
        observationDate: line.observationDate, paymentDate: line.paymentDate,
        levels: line.levels || {}, eventCount: (line.rules || []).length,
        obsOverridden: false, payOverridden: false
      });
    }
  }
  rows.sort((a, b) => (a.observationDate < b.observationDate ? -1 : a.observationDate > b.observationDate ? 1 : 0));
  return rows;
}

/**
 * Apply a date edit from the Schedule tab back to the source line, returning a
 * new lines array. `field` is 'observationDate' | 'paymentDate'.
 */
export function applyScheduleEdit(lines, row, field, value) {
  return lines.map(line => {
    if (line.id !== row.lineId) return line;
    if (line.lineType === 'single') {
      return { ...line, [field]: value };
    }
    // loop → write into the override map for this period
    const mapKey = field === 'observationDate' ? 'dateOverrides' : 'paymentDateOverrides';
    const map = { ...(line[mapKey] || {}) };
    if (value) map[row.period] = value;
    else delete map[row.period];
    return { ...line, [mapKey]: map };
  });
}

/** Clear any date override for a loop row (revert to the generated cadence). */
export function clearScheduleOverride(lines, row) {
  return lines.map(line => {
    if (line.id !== row.lineId || line.lineType !== 'loop') return line;
    const dateOverrides = { ...(line.dateOverrides || {}) };
    const paymentDateOverrides = { ...(line.paymentDateOverrides || {}) };
    delete dateOverrides[row.period];
    delete paymentDateOverrides[row.period];
    return { ...line, dateOverrides, paymentDateOverrides };
  });
}
