/**
 * Birthday reminders for relationship managers.
 *
 * Every morning the reminder job looks at the birthdays of the contacts and
 * family members in the firm's book and tells each RM (and the assistants who
 * work for them) about the ones coming up on their own clients: once a week
 * ahead, so there is time to send something, and once on the day.
 *
 * The notifications land in the notification center like any other alert and
 * follow the recipient's email preferences ("Client birthdays"). Each
 * (recipient, person, year, lead time) is notified once: the job is safe to
 * re-run.
 *
 * Pure date logic is kept separate from the database work so it can be tested.
 */

import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { NotificationsCollection, NotificationHelpers, EVENT_TYPES } from '/imports/api/notifications';
import { collectBirthdayPeople } from './birthdayPeople.js';

/** Days ahead at which a reminder is sent (0 = the day itself). */
export const BIRTHDAY_REMINDER_LEAD_DAYS = [7, 0];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's calendar date where the firm sits, as YYYY-MM-DD. */
export const todayInParis = (now = new Date()) =>
  now.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

/** YYYY-MM-DD plus a number of days (UTC arithmetic on calendar dates). */
export const addDaysISO = (isoDate, days) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * The month-day a birthday is celebrated in a given year. A 29 February
 * birthday is kept on the 28th in a non-leap year.
 */
export const celebratedMonthDay = (birthdayISO, year) => {
  const monthDay = birthdayISO.slice(5);
  return monthDay === '02-29' && !isLeapYear(year) ? '02-28' : monthDay;
};

/** Age reached on the celebrated date, or null when the stored year is a placeholder. */
export const ageOn = (birthdayISO, targetISO) => {
  const birthYear = Number(birthdayISO.slice(0, 4));
  const targetYear = Number(targetISO.slice(0, 4));
  // 1900 (and earlier) is what a missing year is stored as; nobody is older than 120
  if (!birthYear || birthYear <= 1900 || birthYear >= targetYear || targetYear - birthYear > 120) return null;
  return targetYear - birthYear;
};

/**
 * Which people have a birthday at each lead time from `todayISO`.
 * @returns {Array<{ person, daysUntil, dateISO, age }>}
 */
export function upcomingBirthdays(people, todayISO, leadDays = BIRTHDAY_REMINDER_LEAD_DAYS) {
  const matches = [];
  for (const daysUntil of leadDays) {
    const dateISO = addDaysISO(todayISO, daysUntil);
    const year = Number(dateISO.slice(0, 4));
    const monthDay = dateISO.slice(5);
    for (const person of people) {
      if (!person.birthday || person.kind === 'team') continue;
      if (celebratedMonthDay(person.birthday, year) !== monthDay) continue;
      matches.push({ person, daysUntil, dateISO, age: ageOn(person.birthday, dateISO) });
    }
  }
  return matches;
}

const formatDay = (isoDate) => new Date(`${isoDate}T00:00:00Z`)
  .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Title and message of one reminder, ready for the notification center. */
export function describeBirthday({ person, daysUntil, dateISO, age }) {
  const when = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
  const who = person.kind === 'family'
    ? `${person.name}, ${person.relationship ? `${person.relationship} of ` : 'family of '}${person.relatedTo}`
    : person.name;
  const turns = age ? ` turns ${age}` : `'s birthday is`;
  const title = `🎂 Birthday ${when} — ${person.name}`;
  const message = person.kind === 'family'
    ? `${who},${turns} on ${formatDay(dateISO)}. ${person.relatedTo} is a client of yours.`
    : `${who}${turns} on ${formatDay(dateISO)}. ${person.name} is a client of yours.`;
  return { title, message };
}

/** One key per (person, celebrated date, lead time): the unit of "already reminded". */
export const birthdayKey = ({ person, dateISO, daysUntil }) => `${person.id}|${dateISO}|${daysUntil}`;

/**
 * The staff to remind about a contact: its RMs plus the assistants who assist
 * them. Deactivated logins are skipped.
 */
async function recipientsFor(ownerRmIds, cache) {
  const key = ownerRmIds.join(',');
  if (cache.has(key)) return cache.get(key);
  if (ownerRmIds.length === 0) { cache.set(key, []); return []; }
  const staff = await UsersCollection.find(
    {
      isActive: { $ne: false },
      deactivatedAt: { $exists: false },
      $or: [
        { _id: { $in: ownerRmIds }, role: { $ne: USER_ROLES.CLIENT } },
        { role: USER_ROLES.ASSISTANT, assignedRmIds: { $in: ownerRmIds } }
      ]
    },
    { fields: { _id: 1 } }
  ).fetchAsync();
  const ids = staff.map(u => u._id);
  cache.set(key, ids);
  return ids;
}

/**
 * Send the reminders due today. Returns counts for the job log.
 * @param {Object} [options]
 * @param {String} [options.today]  YYYY-MM-DD (defaults to today in Paris)
 */
export async function sendBirthdayReminders({ today = todayInParis() } = {}) {
  const { people } = await collectBirthdayPeople();
  const due = upcomingBirthdays(people, today);
  const results = { date: today, peopleWithBirthday: 0, birthdaysDue: due.length, remindersSent: 0, alreadySent: 0, withoutRm: 0 };
  results.peopleWithBirthday = people.filter(p => p.birthday && p.kind !== 'team').length;

  const recipientCache = new Map();
  for (const match of due) {
    const recipients = await recipientsFor(match.person.ownerRmIds || [], recipientCache);
    if (recipients.length === 0) { results.withoutRm++; continue; }

    const key = birthdayKey(match);
    const { title, message } = describeBirthday(match);
    for (const userId of recipients) {
      const already = await NotificationsCollection.findOneAsync(
        { userId, eventType: EVENT_TYPES.CLIENT_BIRTHDAY, 'metadata.birthdayKey': key },
        { fields: { _id: 1 } }
      );
      if (already) { results.alreadySent++; continue; }
      await NotificationHelpers.create({
        userId,
        type: 'info',
        eventType: EVENT_TYPES.CLIENT_BIRTHDAY,
        title,
        message,
        metadata: {
          birthdayKey: key,
          entityId: match.person.entityId || null,
          personId: match.person.id,
          personKind: match.person.kind,
          clientName: match.person.kind === 'family' ? match.person.relatedTo : match.person.name,
          birthdayDate: match.dateISO,
          daysUntil: match.daysUntil
        }
      });
      results.remindersSent++;
    }
  }

  console.log(`[BIRTHDAYS] ${today}: ${results.birthdaysDue} birthday(s) due, ${results.remindersSent} reminder(s) sent, ${results.alreadySent} already sent, ${results.withoutRm} without RM`);
  return results;
}
