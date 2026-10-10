// Client Entities Publications
// Entities in the viewer's access scope (admins: all; RM/assistant: their
// perimeter; clients: entities they hold grants for or own through accounts).
//
// The fictional demo client is excluded from the list: it must not turn up in
// Contacts, entity pickers or counts. It stays reachable through the View As
// search (`viewAs.search`), which is the only way in by design.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { resolveScope, entitiesSelector, isEntityInScope } from '../helpers/accessScope.js';

const EXCLUDE_DEMO = { isDemo: { $ne: true } };

// GDPR data minimisation (Art. 5(1)(c)): the LIST publication does not ship the
// high-sensitivity KYC block (PEP status, wealth categories, FATCA data, risk
// scoring) or family members. Those fields come one entity at a time via
// 'clientEntities.details'.
const LIST_FIELDS = {
  fields: {
    kyc: 0,
    usPerson: 0,
    kycRiskScore: 0,
    kycRiskScoreHistory: 0,
    'profile.familyMembers': 0
  }
};

Meteor.publish('clientEntities', async function (sessionId) {
  check(sessionId, Match.Maybe(String));

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();

  return ClientEntitiesCollection.find(
    { $and: [entitiesSelector(scope), { isActive: true }, EXCLUDE_DEMO] },
    LIST_FIELDS
  );
});

// Full document for a single entity — the only channel for the KYC block.
Meteor.publish('clientEntities.details', async function (sessionId, entityId) {
  check(sessionId, Match.Maybe(String));
  check(entityId, Match.Maybe(String));
  if (!entityId) return this.ready();

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const scope = await resolveScope(user);
  if (!(await isEntityInScope(scope, entityId))) return this.ready();

  return ClientEntitiesCollection.find({ _id: entityId });
});
