// Deterministic checks run on the term sheet's own text after AI extraction.
//
// The model sometimes misses values that the document states plainly (e.g. the strike
// written per underlying as "47.3760 (70% of Share Initial)"). These helpers read such
// values straight from the PDF text layer so the extractor can correct the model. They
// return null when the text is ambiguous, in which case the model's value is kept.

const PERCENT = /(\d{1,3}(?:[.,]\d+)?)\s*%/g;

const toNumber = (s) => parseFloat(String(s).replace(',', '.'));

// "Strike", "Strike Price(s)", "Strike Level", "Strike(k)" … but not "Strike Date"
const STRIKE_LABEL = /\bStrike(?:\s*(?:Price|Level|Barrier)s?)?(?:\s*\([a-z]\))?(?!\s*(?:Date|Day|Currency|Time))\b/i;

/**
 * Strike as a % of the initial level, read from the term sheet's Strike row(s).
 * The row block is the label line plus the following lines that keep quoting a
 * percentage (per-underlying lists wrap over several lines). All percentages in every
 * strike block must agree, otherwise the result is ambiguous (null).
 */
export const detectStrikePercent = (text) => {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const values = new Set();

  lines.forEach((line, i) => {
    const label = line.match(STRIKE_LABEL);
    if (!label || !/^\s*Strike/i.test(line.slice(label.index))) return;
    // Only rows where "Strike…" starts the line (a term sheet field label)
    if (line.slice(0, label.index).trim() !== '') return;

    const block = [line.slice(label.index + label[0].length)];
    for (let j = i + 1; j < lines.length && j <= i + 20; j++) {
      if (!/%/.test(lines[j]) || lines[j].length > 160) break;
      block.push(lines[j]);
    }
    for (const match of block.join('\n').matchAll(PERCENT)) {
      const value = toNumber(match[1]);
      if (value > 0 && value <= 150) values.add(value);
    }
  });

  return values.size === 1 ? [...values][0] : null;
};

// The autocall section: from its heading to the next payout heading (bounded length)
const autocallSection = (text, maxLength) => {
  if (!text) return null;
  const source = String(text);
  const start = source.search(/Automatic\s+Early\s+Redemption|Autocall(?:able)?\s+(?:Event|Condition|Trigger)|Early\s+Redemption\s+(?:Event|Condition)/i);
  if (start < 0) return null;
  let section = source.slice(start, start + maxLength);
  const end = section.slice(20).search(/\n\s*(?:Final\s+Redemption|Redemption\s+Amount|Final\s+Payout)/i);
  if (end >= 0) section = section.slice(0, end + 20);
  return section;
};

/**
 * Memory ("snowball"/lock-in) autocall is a property of the autocall condition itself:
 * an underlying counts as above its level if it was above it on the current OR any
 * preceding observation date. Returns true/false when an autocall section is found,
 * null when the document has none.
 */
export const detectMemoryAutocall = (text) => {
  const section = autocallSection(text, 1500);
  if (section === null) return null;
  return /preced|any\s+previous|on\s+any\s+(?:prior|earlier)|lock[\s-]?in|memory\s+(?:autocall|early\s+redemption|effect)|already\s+(?:been\s+)?(?:fixed|locked)/i.test(section);
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];
const pad = (n) => String(n).padStart(2, '0');

// Every date written in the text, as ISO: "March 25th, 2027", "25 March 2027",
// "25/03/2027" (day first, European term sheets) and "2027-03-25"
export const extractISODates = (text) => {
  const dates = new Set();
  const source = String(text || '');
  const monthRe = MONTHS.join('|');
  for (const m of source.matchAll(new RegExp(String.raw`\b(${monthRe})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`, 'gi'))) {
    dates.add(`${m[3]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(m[2])}`);
  }
  for (const m of source.matchAll(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${monthRe})\s+(\d{4})`, 'gi'))) {
    dates.add(`${m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`);
  }
  for (const m of source.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) {
    dates.add(`${m[3]}-${pad(m[2])}-${pad(m[1])}`);
  }
  for (const m of source.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) dates.add(m[0]);
  return dates;
};

/**
 * An observation whose date is not in the term sheet's autocall table cannot autocall
 * (e.g. the final redemption valuation date when the table stops one period earlier).
 * Applied only when the autocall section's dates clearly line up with the schedule
 * (at least two observation dates found in it); otherwise the schedule is unchanged.
 */
export const applyAutocallTableDates = (schedule = [], text) => {
  const section = autocallSection(text, 6000);
  if (!section || !Array.isArray(schedule) || schedule.length === 0) return { schedule, changed: [] };
  const autocallDates = extractISODates(section);
  const matched = schedule.filter(row => autocallDates.has(row?.observationDate)).length;
  if (matched < 2) return { schedule, changed: [] };

  const changed = [];
  const next = schedule.map(row => {
    if (!row || autocallDates.has(row.observationDate) || row.isCallable === false) return row;
    changed.push(row.id || row.observationDate);
    return { ...row, isCallable: false, autocallLevel: null };
  });
  return { schedule: next, changed };
};

// A non-callable observation has no autocall level
export const normalizeNonCallableRows = (schedule = []) =>
  schedule.map(row => (row && row.isCallable === false ? { ...row, autocallLevel: null } : row));
