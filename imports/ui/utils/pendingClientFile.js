/**
 * Hand-off to a client's file from outside the Clients section (a birthday
 * reminder in the notification center, for instance): the target entity is
 * stored, the app routes to Clients, and MainContent opens that file. Same
 * pattern as the sizeable-transaction and meeting-report hand-offs.
 */

const PENDING_KEY = 'pendingClientFileEntityId';

// Fired as well, for a MainContent already mounted
export const CLIENT_FILE_OPEN_EVENT = 'av:open-client-file';

export const setPendingClientFile = (entityId) => {
  if (!entityId) return;
  try { sessionStorage.setItem(PENDING_KEY, entityId); } catch (e) { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(CLIENT_FILE_OPEN_EVENT));
};

export const consumePendingClientFile = () => {
  try {
    const id = sessionStorage.getItem(PENDING_KEY);
    if (id) sessionStorage.removeItem(PENDING_KEY);
    return id || null;
  } catch (e) {
    return null;
  }
};
