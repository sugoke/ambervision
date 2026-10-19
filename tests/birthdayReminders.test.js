// Birthday reminders: which birthdays are due on a given day, and what the RM reads.
import assert from 'assert';
import {
  upcomingBirthdays, celebratedMonthDay, ageOn, addDaysISO, describeBirthday, birthdayKey, BIRTHDAY_REMINDER_LEAD_DAYS
} from '/server/helpers/birthdayReminders.js';

const people = [
  { id: 'c1', name: 'Anna Rossi', kind: 'client', birthday: '1970-10-16', entityId: 'e1', ownerRmIds: ['rm1'] },
  { id: 'c2', name: 'Bruno Weiss', kind: 'client', birthday: '1985-10-23', entityId: 'e2', ownerRmIds: ['rm2'] },
  { id: 'e1-family-0', name: 'Léa Rossi', kind: 'family', relationship: 'daughter', relatedTo: 'Anna Rossi', birthday: '2012-10-16', entityId: 'e1', ownerRmIds: ['rm1'] },
  { id: 'c3', name: 'Leap Day', kind: 'client', birthday: '1992-02-29', entityId: 'e3', ownerRmIds: ['rm1'] },
  { id: 't1', name: 'Staff Member', kind: 'team', birthday: '1990-10-16', entityId: null, ownerRmIds: [] },
  { id: 'c4', name: 'No Year', kind: 'client', birthday: '1900-10-16', entityId: 'e4', ownerRmIds: ['rm1'] }
];

describe('birthday reminders', function () {
  it('reminds a week ahead and on the day, never for the team', function () {
    assert.deepStrictEqual(BIRTHDAY_REMINDER_LEAD_DAYS, [7, 0]);
    const due = upcomingBirthdays(people, '2026-10-16');
    const ids = due.map(d => `${d.person.id}@${d.daysUntil}`).sort();
    assert.deepStrictEqual(ids, ['c1@0', 'c2@7', 'c4@0', 'e1-family-0@0']);
    const anna = due.find(d => d.person.id === 'c1');
    assert.strictEqual(anna.age, 56);
    assert.strictEqual(anna.dateISO, '2026-10-16');
    assert.strictEqual(due.find(d => d.person.id === 'c4').age, null, 'placeholder year gives no age');
  });

  it('handles month and year boundaries', function () {
    assert.strictEqual(addDaysISO('2026-12-28', 7), '2027-01-04');
    const nyPeople = [{ id: 'x', name: 'X', kind: 'client', birthday: '1980-01-04', ownerRmIds: ['rm1'] }];
    assert.strictEqual(upcomingBirthdays(nyPeople, '2026-12-28')[0].daysUntil, 7);
  });

  it('a 29 February birthday is celebrated on the 28th in a non-leap year', function () {
    assert.strictEqual(celebratedMonthDay('1992-02-29', 2028), '02-29');
    assert.strictEqual(celebratedMonthDay('1992-02-29', 2027), '02-28');
    assert.strictEqual(upcomingBirthdays(people, '2027-02-28').some(d => d.person.id === 'c3' && d.daysUntil === 0), true);
    assert.strictEqual(upcomingBirthdays(people, '2027-02-21').some(d => d.person.id === 'c3' && d.daysUntil === 7), true);
    assert.strictEqual(ageOn('1992-02-29', '2027-02-28'), 35);
  });

  it('reads naturally for a client and for a family member', function () {
    const [client] = upcomingBirthdays([people[0]], '2026-10-09');
    const c = describeBirthday(client);
    assert.strictEqual(c.title, '🎂 Birthday in 7 days — Anna Rossi');
    assert.ok(/Anna Rossi turns 56 on Friday 16 October\. Anna Rossi is a client of yours\./.test(c.message), c.message);

    const [family] = upcomingBirthdays([people[2]], '2026-10-16');
    const f = describeBirthday(family);
    assert.strictEqual(f.title, '🎂 Birthday today — Léa Rossi');
    assert.ok(/Léa Rossi, daughter of Anna Rossi, turns 14 on Friday 16 October\. Anna Rossi is a client of yours\./.test(f.message), f.message);

    assert.strictEqual(birthdayKey(client), 'c1|2026-10-16|7');
    assert.notStrictEqual(birthdayKey(client), birthdayKey(upcomingBirthdays([people[0]], '2026-10-16')[0]), 'the week-ahead and the day reminders are distinct');
  });
});
