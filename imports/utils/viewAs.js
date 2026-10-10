// "View As" filter — the client-sent perimeter narrowing used by staff
// ({ type: 'entity' | 'client' | 'account', id }).
//
// The UI sends extra keys (label, data) and restores the filter from
// localStorage, so the server must accept-and-strip rather than demand an
// exact shape. What it must never accept is a non-string id: an operator
// object such as { $ne: null } passes a loose ownership lookup and then turns
// the follow-up query into a firm-wide read.
import { check, Match } from 'meteor/check';

export const VIEW_AS_TYPES = ['entity', 'client', 'account'];

const isViewAsType = (t) => VIEW_AS_TYPES.includes(t);
const isId = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128;

export const ViewAsPattern = Match.Maybe(Match.ObjectIncluding({
  type: Match.Where(isViewAsType),
  id: Match.Where(isId)
}));

/**
 * Validate a raw viewAs filter and return a clean `{ type, id }` or null.
 * Throws Match.Error on anything that is not a plain filter.
 */
export function parseViewAs(raw) {
  if (raw === null || raw === undefined) return null;
  check(raw, ViewAsPattern);
  return { type: raw.type, id: raw.id };
}

/** Same as parseViewAs but never throws — malformed input becomes null. */
export function parseViewAsOrNull(raw) {
  try {
    return parseViewAs(raw);
  } catch (e) {
    return null;
  }
}

/** Parse a JSON-encoded filter (PDF routes / query strings). */
export function viewAsFromQueryString(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    return parseViewAs(JSON.parse(str));
  } catch (e) {
    return null;
  }
}
