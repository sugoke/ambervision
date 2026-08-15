/**
 * Loop frequency helpers. A loop repeats every N of a unit (day/week/month/
 * year). Pure + isomorphic. Legacy loops used `frequencyMonths`; loopStep()
 * falls back to it so old saved canvas models keep working.
 */

export const FREQUENCY_UNITS = [
  ['day', 'days'],
  ['week', 'weeks'],
  ['month', 'months'],
  ['year', 'years']
];

export function addByUnit(iso, unit, amount) {
  if (!iso) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  switch (unit) {
    case 'day': return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
    case 'week': return new Date(Date.UTC(y, m - 1, d + amount * 7)).toISOString().slice(0, 10);
    case 'month': return new Date(Date.UTC(y, m - 1 + amount, d)).toISOString().slice(0, 10);
    case 'year': return new Date(Date.UTC(y, m - 1 + amount * 12, d)).toISOString().slice(0, 10);
    default: return iso;
  }
}

export function loopStep(line) {
  if (line.frequencyUnit) return { unit: line.frequencyUnit, n: line.frequencyN != null ? line.frequencyN : 1 };
  // legacy: frequencyMonths
  return { unit: 'month', n: line.frequencyMonths != null ? line.frequencyMonths : 1 };
}

// Safety cap so a daily loop over a long term can't generate an unbounded list.
export const LOOP_CAP = 2000;

/**
 * The end date a loop runs to. A loop is date-range driven: it repeats from
 * firstObservation until `until` (falling back to the product's final
 * observation date). Legacy loops that carry a fixed `count` are honored by
 * converting that count into an equivalent end date.
 */
export function loopEnd(line, fallbackEnd) {
  if (line.until) return line.until;
  if (line.count != null && line.firstObservation) {
    const { unit, n } = loopStep(line);
    return addByUnit(line.firstObservation, unit, (Math.max(line.count, 1) - 1) * n);
  }
  return fallbackEnd || null;
}

/**
 * Number of observations a loop generates = periods from firstObservation to
 * loopEnd at the chosen frequency (inclusive), capped for safety.
 */
export function loopCount(line, fallbackEnd) {
  const { unit, n } = loopStep(line);
  const end = loopEnd(line, fallbackEnd);
  if (!line.firstObservation || !end) return line.count != null ? line.count : 0;
  let i = 0;
  while (i < LOOP_CAP && addByUnit(line.firstObservation, unit, i * n) <= end) i++;
  return i;
}
