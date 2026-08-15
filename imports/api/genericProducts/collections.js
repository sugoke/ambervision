import { Mongo } from 'meteor/mongo';

/**
 * Generic (composition-based) products — fully isolated from ProductsCollection.
 *
 * Product document:
 * {
 *   _id, name, status: 'draft'|'active'|'archived',
 *   createdBy, createdAt, lastUpdated,
 *   externalEvents: [{ key, date: 'YYYY-MM-DD', note }],   // recorded facts (e.g. issuer call)
 *   definition: { identity, underlyings, stateRegisters, measures, schedule, events, terminalPayoff }
 * }
 *
 * All dates inside `definition` are ISO 'YYYY-MM-DD' strings.
 */
export const GenericProductsCollection = new Mongo.Collection('genericProducts');

/**
 * One document per evaluation run. Reports are self-contained snapshots:
 * pre-formatted values only, chart config embedded, definitionSnapshot frozen.
 */
export const GenericProductReportsCollection = new Mongo.Collection('genericProductReports');
