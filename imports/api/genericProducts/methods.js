import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { GenericProductsCollection, GenericProductReportsCollection } from './collections.js';
import { validateDefinition } from './definitionSchema.js';

if (Meteor.isServer) {
  const { SessionHelpers } = require('/imports/api/sessions');
  const { UsersCollection, USER_ROLES } = require('/imports/api/users');
  const { buildSeriesForDefinition, lookupClose } = require('./engine/fixingsService.js');
  const { evaluateDefinition } = require('./engine/evaluateDefinition.js');
  const { composeReport } = require('./reporting/reportComposer.js');

  const validateSessionAndGetUser = async (sessionId) => {
    if (!sessionId) {
      throw new Meteor.Error('not-authorized', 'Session ID required');
    }
    const session = await SessionHelpers.validateSession(sessionId);
    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid or expired session');
    }
    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }
    return user;
  };

  const requireAdmin = async (sessionId) => {
    const user = await validateSessionAndGetUser(sessionId);
    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Admin access required');
    }
    return user;
  };

  const requireValidDefinition = (definition) => {
    const { errors } = validateDefinition(definition);
    if (errors.length > 0) {
      throw new Meteor.Error('validation-failed', `Definition invalid: ${errors.join('; ')}`);
    }
  };

  const runEvaluation = async (product, evaluatedBy) => {
    const definition = product.definition;
    const preIssues = [];
    const series = await buildSeriesForDefinition(definition, preIssues);
    const evaluationDate = new Date().toISOString().slice(0, 10);
    const raw = evaluateDefinition({
      definition,
      externalEvents: product.externalEvents || [],
      series,
      evaluationDate
    });
    raw.issues = [...preIssues, ...raw.issues];
    return composeReport({ product, definition, raw, series, evaluatedBy });
  };

  Meteor.methods({
    async 'genericProducts.save'(name, definition, sessionId, canvasModel) {
      check(name, String);
      check(definition, Object);
      check(sessionId, String);
      check(canvasModel, Match.Maybe(Object));
      const user = await requireAdmin(sessionId);
      requireValidDefinition(definition);

      const _id = await GenericProductsCollection.insertAsync({
        name: name || 'Untitled product',
        status: 'draft',
        externalEvents: [],
        definition,
        canvasModel: canvasModel || null,
        createdBy: user._id,
        createdAt: new Date(),
        lastUpdated: new Date()
      });
      return { _id };
    },

    async 'genericProducts.update'(productId, name, definition, sessionId, canvasModel) {
      check(productId, String);
      check(name, String);
      check(definition, Object);
      check(sessionId, String);
      check(canvasModel, Match.Maybe(Object));
      await requireAdmin(sessionId);
      requireValidDefinition(definition);

      const existing = await GenericProductsCollection.findOneAsync(productId);
      if (!existing) throw new Meteor.Error('not-found', 'Product not found');

      const $set = { name, definition, lastUpdated: new Date() };
      if (canvasModel !== undefined) $set.canvasModel = canvasModel || null;

      await GenericProductsCollection.updateAsync(productId, { $set });
      return { _id: productId };
    },

    async 'genericProducts.remove'(productId, sessionId) {
      check(productId, String);
      check(sessionId, String);
      await requireAdmin(sessionId);

      await GenericProductsCollection.removeAsync(productId);
      await GenericProductReportsCollection.removeAsync({ productId });
      return { removed: true };
    },

    async 'genericProducts.recordExternalEvent'(productId, event, sessionId) {
      check(productId, String);
      check(event, { key: String, date: String, note: Match.Optional(String) });
      check(sessionId, String);
      await requireAdmin(sessionId);

      await GenericProductsCollection.updateAsync(productId, {
        $push: { externalEvents: { key: event.key, date: event.date, note: event.note || '' } },
        $set: { lastUpdated: new Date() }
      });
      return { recorded: true };
    },

    /**
     * Evaluate a saved product: fixings -> engine -> composer -> store report.
     * Reports accumulate (history); the UI shows the latest.
     */
    async 'genericProducts.evaluate'(productId, sessionId) {
      check(productId, String);
      check(sessionId, String);
      this.unblock();
      const user = await requireAdmin(sessionId);

      const product = await GenericProductsCollection.findOneAsync(productId);
      if (!product) throw new Meteor.Error('not-found', 'Product not found');
      requireValidDefinition(product.definition);

      console.log(`[genericProducts] Evaluating ${product.name} (${productId})`);
      const report = await runEvaluation(product, user._id);
      const reportId = await GenericProductReportsCollection.insertAsync(report);
      await GenericProductsCollection.updateAsync(productId, {
        $set: { lastEvaluatedAt: new Date(), lastReportId: reportId }
      });
      console.log(`[genericProducts] Report ${reportId} stored for ${product.name}`);
      return { reportId };
    },

    /**
     * Evaluate a definition WITHOUT saving anything — pre-save sanity check.
     */
    async 'genericProducts.dryRun'(name, definition, sessionId) {
      check(name, String);
      check(definition, Object);
      check(sessionId, String);
      this.unblock();
      const user = await requireAdmin(sessionId);
      requireValidDefinition(definition);

      const report = await runEvaluation(
        { _id: 'dry-run', name: name || 'Dry run', definition, externalEvents: [] },
        user._id
      );
      return { report };
    },

    /**
     * Close at (or last close before) a date — the "Fetch fixing" button.
     */
    async 'genericProducts.lookupFixing'(fullTicker, isoDate, sessionId) {
      check(fullTicker, String);
      check(isoDate, String);
      check(sessionId, String);
      this.unblock();
      await requireAdmin(sessionId);

      const result = await lookupClose(fullTicker, isoDate);
      if (!result) throw new Meteor.Error('no-data', `No price data for ${fullTicker} around ${isoDate}`);
      return result;
    }
  });
}
