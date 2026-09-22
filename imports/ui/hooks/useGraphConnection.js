import { useCallback, useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';

/**
 * Outlook connection state for the order book.
 *
 * The order detail panel renders one trace tile per trace type, so a naive
 * implementation would fire the same two method calls six times on every open.
 * The result is cached module-wide and shared between hook instances; call
 * refresh() after connecting or disconnecting to invalidate it.
 */

let cache = null;          // { available, connected, mailbox, status, needsReconsent }
let inFlight = null;       // Promise while a fetch is running
const listeners = new Set();

const notify = () => listeners.forEach(fn => fn(cache));

async function load() {
  const sessionId = localStorage.getItem('sessionId');
  const config = await Meteor.callAsync('msgraph.config');

  if (!config?.available) {
    return {
      available: false,
      connected: false,
      mailbox: null,
      status: null,
      needsReconsent: false,
      devBlocked: Boolean(config?.devBlocked),
      keyMissing: Boolean(config?.keyMissing)
    };
  }

  const status = await Meteor.callAsync('msgraph.status', sessionId);
  return {
    available: true,
    connected: Boolean(status?.connected),
    mailbox: status?.mailbox || null,
    status: status?.status || null,
    needsReconsent: Boolean(status?.needsReconsent),
    devBlocked: false,
    keyMissing: false
  };
}

function fetchOnce() {
  if (inFlight) return inFlight;
  inFlight = load()
    .then(result => { cache = result; notify(); return result; })
    .catch(() => {
      // A mailbox lookup must never break the order book: fall back to "not
      // available", which simply hides every Outlook affordance.
      cache = { available: false, connected: false, mailbox: null, status: null, needsReconsent: false };
      notify();
      return cache;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function invalidateGraphConnection() {
  cache = null;
  fetchOnce();
}

export function useGraphConnection() {
  const [state, setState] = useState(cache);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    listeners.add(setState);
    if (!cache) {
      fetchOnce().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    return () => { listeners.delete(setState); };
  }, []);

  const refresh = useCallback(() => {
    cache = null;
    setLoading(true);
    return fetchOnce().finally(() => setLoading(false));
  }, []);

  // Full-page navigation rather than a popup: minting the OAuth state needs a
  // server round-trip, so a window.open() after that await falls outside the
  // click gesture and gets blocked.
  const connect = useCallback(async (returnTo) => {
    const sessionId = localStorage.getItem('sessionId');
    const { authorizeUrl } = await Meteor.callAsync(
      'msgraph.beginConnect',
      sessionId,
      returnTo || `${window.location.pathname}${window.location.search}`
    );
    window.location.href = authorizeUrl;
  }, []);

  return {
    available: Boolean(state?.available),
    connected: Boolean(state?.connected),
    mailbox: state?.mailbox || null,
    needsReconsent: Boolean(state?.needsReconsent),
    loading,
    refresh,
    connect
  };
}

export default useGraphConnection;
