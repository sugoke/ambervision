// Portfolio-code matching helpers.
//
// Bank files key positions by portfolioCode; a client's account `504024` may
// appear as `504024` and as currency sub-accounts `504024-USD`, `504024-CHF`.
// Matching on the raw prefix `^504024` also matches a DIFFERENT client's
// `5040241` — a cross-client read. Every regex built here is escaped and
// anchored with `(-|$)` so a base matches itself and its sub-accounts only.

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `504024-USD` → `504024`; `504024` → `504024`. */
export function accountBase(accountNumber) {
  if (!accountNumber) return '';
  return String(accountNumber).split('-')[0];
}

/** Regex matching exactly one account base and its `-XXX` sub-accounts. */
export function portfolioCodeRegex(base) {
  return new RegExp('^' + escapeRegex(accountBase(base)) + '(-|$)');
}

/** Regex matching any of several account bases and their sub-accounts. */
export function portfolioCodeRegexForBases(bases) {
  const uniq = [...new Set((bases || []).map(accountBase).filter(Boolean))];
  if (uniq.length === 0) return null;
  return new RegExp('^(' + uniq.map(escapeRegex).join('|') + ')(-|$)');
}

/** True when `portfolioCode` belongs to the account `base` (itself or a sub-account). */
export function portfolioCodeMatches(base, portfolioCode) {
  if (!base || !portfolioCode) return false;
  return portfolioCodeRegex(base).test(String(portfolioCode));
}
