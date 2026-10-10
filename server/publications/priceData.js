// Price Data Publications
// Product prices are reference data for any logged-in user; uploads are superadmin-only.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { USER_ROLES } from '/imports/api/users';
import { ProductPricesCollection } from '/imports/api/productPrices';
import { getSessionUser } from '../helpers/sessionAuth.js';

// Recent price uploads (superadmin only)
Meteor.publish("recentPriceUploads", async function (sessionId = null, limit = 10) {
  check(sessionId, Match.Maybe(String));
  check(limit, Match.Maybe(Number));
  const user = await getSessionUser(sessionId);
  if (!user || user.role !== USER_ROLES.SUPERADMIN) return this.ready();

  return ProductPricesCollection.find(
    { isActive: true },
    { sort: { uploadDate: -1 }, limit: Math.min(limit || 10, 100) }
  );
});

// Price history for one ISIN
Meteor.publish("priceHistory", async function (isin, limit = 50, sessionId = null) {
  check(isin, Match.Maybe(String));
  check(limit, Match.Maybe(Number));
  check(sessionId, Match.Maybe(String));
  if (!isin) return this.ready();

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  return ProductPricesCollection.find(
    { isin: isin.toUpperCase(), isActive: true },
    { sort: { priceDate: -1, uploadDate: -1 }, limit: Math.min(limit || 50, 200) }
  );
});
