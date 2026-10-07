/**
 * Hand-off to the meeting-report editor from elsewhere in the app (a
 * "visit report requested" notification): the target client is stored, the
 * app routes to the Intranet, and MeetingReports opens a new report on that
 * client. Same pattern as the sizeable-transaction review hand-off.
 */

const PENDING_KEY = 'pendingMeetingReport';

// Fired as well, for an Intranet / MeetingReports already mounted
export const MEETING_REPORT_OPEN_EVENT = 'av:open-meeting-report';

/** @param {{ entityId: string, clientName?: string, requestId?: string }} target */
export const setPendingMeetingReport = (target) => {
  if (!target?.entityId) return;
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(target)); } catch (e) { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(MEETING_REPORT_OPEN_EVENT));
};

/** Is a hand-off waiting (without consuming it)? */
export const hasPendingMeetingReport = () => {
  try { return !!sessionStorage.getItem(PENDING_KEY); } catch (e) { return false; }
};

export const consumePendingMeetingReport = () => {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    const target = JSON.parse(raw);
    return target?.entityId ? target : null;
  } catch (e) {
    return null;
  }
};
