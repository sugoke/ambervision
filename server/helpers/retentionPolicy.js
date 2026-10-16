import { Meteor } from 'meteor/meteor';

/**
 * Regulatory retention policy — the one place that knows how long client
 * records are kept.
 *
 * As a regulated financial intermediary the firm must keep KYC files,
 * transaction records and the related correspondence for five years after the
 * end of the business relationship (Monaco Law 1.362 / AML-CFT; GDPR
 * Art. 17(3)(b) exempts data held under such a legal obligation). So:
 *
 *   - Nothing that belongs to the client file is physically destroyed while the
 *     relationship is live, nor during the retention period that follows.
 *   - A GDPR erasure request (Art. 17) received in that window is honoured as a
 *     restriction of processing (Art. 18): the records stay, but only
 *     compliance and superadmins can see them, and the client's logins and
 *     marketing footprint are removed.
 *   - The retention clock starts at the archive date of the client entity
 *     (`archivedAt`, the closure date entered when the client is archived).
 *     Once it has run out, the nightly retention sweep destroys the restricted
 *     records and anonymises what has to stay (see gdprMethods.js).
 *
 * The number of years can be raised (never lowered below the legal minimum)
 * with settings.private.RETENTION.regulatedYears.
 */

export const LEGAL_MINIMUM_RETENTION_YEARS = 5;

/** Years client records are kept after the end of the relationship. */
export function retentionYears() {
  const configured = Number(Meteor.settings?.private?.RETENTION?.regulatedYears);
  if (Number.isFinite(configured) && configured > LEGAL_MINIMUM_RETENTION_YEARS) return configured;
  return LEGAL_MINIMUM_RETENTION_YEARS;
}

/**
 * When the retention period of a client entity ends, or null while the
 * relationship is live (no archive date, no clock).
 */
export function retentionEndFor(entity, years = retentionYears()) {
  if (!entity?.archivedAt) return null;
  const end = new Date(entity.archivedAt);
  if (Number.isNaN(end.getTime())) return null;
  end.setUTCFullYear(end.getUTCFullYear() + years);
  return end;
}

/** True once the retention period of an archived entity has fully elapsed. */
export function isPastRetention(entity, now = new Date()) {
  const end = retentionEndFor(entity);
  return !!end && end.getTime() <= now.getTime();
}

/** Display string for a retention end date (en-GB, UTC). */
export function formatRetentionEnd(date) {
  return date
    ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '';
}
