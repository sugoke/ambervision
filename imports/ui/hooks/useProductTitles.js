import { useEffect, useMemo, useRef, useState } from 'react';
import { Meteor } from 'meteor/meteor';

/**
 * Ambervision product titles keyed by ISIN, for the ISINs currently on screen.
 *
 * Orders carry whatever short label the desk typed ("Ph+"); when the ISIN is a
 * product we manage, its record has the full name. Components pass the ISINs
 * they display and read back `{ [isin]: title }` — missing keys mean "no
 * product for this ISIN, keep the order's own name".
 *
 * Only ISINs not yet resolved are fetched, so a reactive list that re-renders
 * on every subscription batch does not re-query the same set.
 */
export function useProductTitles(isins) {
  const key = useMemo(
    () => Array.from(new Set((isins || []).filter(Boolean).map(i => String(i).trim()))).sort().join(','),
    // The array identity changes every render; the sorted key does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Array.isArray(isins) ? isins.join(',') : '']
  );
  const [titles, setTitles] = useState({});
  const requested = useRef(new Set());

  useEffect(() => {
    if (!key) return undefined;
    const pending = key.split(',').filter(isin => !requested.current.has(isin));
    if (pending.length === 0) return undefined;
    pending.forEach(isin => requested.current.add(isin));

    const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;
    if (!sessionId) return undefined;

    let cancelled = false;
    Meteor.callAsync('products.getTitlesByIsins', pending, sessionId)
      .then(map => {
        if (!cancelled && map && typeof map === 'object') {
          setTitles(prev => ({ ...prev, ...map }));
        }
      })
      .catch(err => {
        // Allow a retry on the next key change rather than pinning a failure.
        pending.forEach(isin => requested.current.delete(isin));
        console.warn('[useProductTitles] lookup failed:', err?.reason || err?.message || err);
      });
    return () => { cancelled = true; };
  }, [key]);

  return titles;
}

/** Apply a title map to an order: full product name first, the typed label kept for tooltips. */
export function withProductTitle(order, titles) {
  const title = order?.isin ? titles[order.isin] : null;
  if (!title || title === order.securityName) return order;
  return { ...order, securityName: title, orderSecurityName: order.securityName };
}

export default useProductTitles;
