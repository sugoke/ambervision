// Products Publications
//
// A product is visible to a client (or a scoped staff view) through its
// allocations and bank positions; staff in PRODUCT_CATALOGUE_ROLES may also
// browse the whole catalogue ("Show All"). All scoping goes through the access
// scope (server/helpers/accessScope.js).

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ProductsCollection } from '/imports/api/products';
import { AllocationsCollection } from '/imports/api/allocations';
import { parseViewAs } from '/imports/utils/viewAs';
import { getSessionUser, getSessionOrPdfUser } from '../helpers/sessionAuth.js';
import { PRODUCT_CATALOGUE_ROLES } from '../helpers/accessPolicy.js';
import { resolveScope, allocationsSelector, productIdsInScope, isProductInScope } from '../helpers/accessScope.js';

/**
 * Products in the viewer's perimeter (allocated or held). A see-all viewer
 * without View As gets the whole catalogue.
 */
Meteor.publish("products", async function (sessionId = null, rawViewAs = null) {
  check(sessionId, Match.Maybe(String));
  const viewAs = parseViewAs(rawViewAs);

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const scope = await resolveScope(user, viewAs);
  if (scope.denied) return this.ready();

  const ids = await productIdsInScope(scope);
  if (ids === null) return ProductsCollection.find();
  if (ids.size === 0) return this.ready();
  return ProductsCollection.find({ _id: { $in: [...ids] } });
});

/**
 * One product, for the report page. Also serves the headless PDF renderer,
 * which authenticates with `pdf-temp-<token>` in place of a session id.
 */
Meteor.publish("products.single", async function (productId, sessionId = null) {
  check(productId, String);
  check(sessionId, Match.Maybe(String));

  const user = await getSessionOrPdfUser({ sessionId });
  if (!user) return this.ready();

  const scope = await resolveScope(user);
  if (!(await isProductInScope(scope, productId))) return this.ready();

  return ProductsCollection.find({ _id: productId });
});

/**
 * A product's allocations, limited to the viewer's perimeter.
 */
Meteor.publish("productAllocations", async function (productId, sessionId = null) {
  check(productId, String);
  check(sessionId, Match.Maybe(String));

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();

  return AllocationsCollection.find({ $and: [await allocationsSelector(scope), { productId }] });
});

/**
 * Every allocation in the viewer's perimeter (optionally narrowed by View As).
 */
Meteor.publish("allAllocations", async function (sessionId = null, rawViewAs = null) {
  check(sessionId, Match.Maybe(String));
  const viewAs = parseViewAs(rawViewAs);

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const scope = await resolveScope(user, viewAs);
  if (scope.denied) return this.ready();

  return AllocationsCollection.find(await allocationsSelector(scope));
});

/**
 * The whole product catalogue ("Show All" toggle) — catalogue roles only.
 */
Meteor.publish("products.all", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));

  const user = await getSessionUser(sessionId);
  if (!user || !PRODUCT_CATALOGUE_ROLES.includes(user.role)) return this.ready();

  return ProductsCollection.find();
});
