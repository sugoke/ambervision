import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { SessionHelpers } from './sessions.js';
import { UsersCollection } from './users.js';

/**
 * Portfolio Reviews Collection
 *
 * Stores AI-generated portfolio review reports for client meetings.
 * Reviews analyze every position, provide macro context, check allocation compliance,
 * review FX exposure, summarize upcoming events, assess cash deployment, and offer recommendations.
 */
export const PortfolioReviewsCollection = new Mongo.Collection('portfolioReviews');

/**
 * May `user` read `review`? Assigned on the server below (shared file: the
 * access helpers live under /server and are imported lazily there); null on
 * the client. Used by the methods here and by pdf.generateReport.
 *
 * @type {null | ((user: object, review: object, scope?: object|null) => Promise<boolean>)}
 */
export let canReadReview = null;

if (Meteor.isServer) {
  // Ensure indexes for efficient queries
  Meteor.startup(() => {
    PortfolioReviewsCollection.rawCollection().createIndex(
      { generatedBy: 1, generatedAt: -1 },
      { background: true }
    ).catch(err => console.warn('[PortfolioReviews] Index creation warning:', err.message));

    PortfolioReviewsCollection.rawCollection().createIndex(
      { 'viewAsFilter.id': 1, generatedAt: -1 },
      { background: true }
    ).catch(err => console.warn('[PortfolioReviews] Index creation warning:', err.message));

    PortfolioReviewsCollection.rawCollection().createIndex(
      { status: 1, generatedAt: -1 },
      { background: true }
    ).catch(err => console.warn('[PortfolioReviews] Index creation warning:', err.message));
  });

  /**
   * A portfolio review is a firm-wide staff artifact about one client. See-all
   * roles read every review; an RM or assistant reads the reviews they
   * generated and those whose View As target (client, entity or account) is
   * inside their perimeter. Nobody else reads any.
   *
   * `scope` is the caller's already-resolved scope when it has one (list
   * resolves it once for every review); otherwise it is resolved here.
   */
  canReadReview = async function (user, review, scope = null) {
    if (!user || !review) return false;
    const { isSeeAll, isStaff } = await import('../../server/helpers/accessPolicy.js');
    if (!isStaff(user)) return false;
    if (isSeeAll(user)) return true;
    if (review.generatedBy && review.generatedBy === user._id) return true;

    const targetId = review.viewAsFilter?.id;
    if (typeof targetId !== 'string' || !targetId) return false;

    const { resolveScope, isClientInScope } = await import('../../server/helpers/accessScope.js');
    const own = scope || await resolveScope(user);
    if (own.denied) return false;
    if (own.bankAccountIds.includes(targetId) || own.entityIds.includes(targetId)) return true;
    return isClientInScope(own, targetId);
  };

  /**
   * The publications below used `this.userId`, which is always null in this
   * app (no Meteor accounts), so they matched nothing. They now take the
   * session token last, like every other publication.
   */
  const reviewPublisher = async (sessionId) => {
    const { getSessionUser } = await import('../../server/helpers/sessionAuth.js');
    const { isSeeAll, isStaff } = await import('../../server/helpers/accessPolicy.js');
    const user = await getSessionUser(sessionId);
    if (!isStaff(user)) return null;
    return { user, seeAll: isSeeAll(user) };
  };

  // Publish reviews for a specific client/account context
  Meteor.publish('portfolioReviews.forClient', async function (viewAsFilter, accountFilter, limit = 20, sessionId = null) {
    check(viewAsFilter, Match.Maybe(Object));
    check(accountFilter, Match.Maybe(String));
    check(limit, Number);
    check(sessionId, Match.Maybe(String));

    const viewer = await reviewPublisher(sessionId);
    if (!viewer) return this.ready();

    const query = viewer.seeAll ? {} : { generatedBy: viewer.user._id };

    if (viewAsFilter && typeof viewAsFilter.id === 'string' && viewAsFilter.id) {
      query['viewAsFilter.id'] = viewAsFilter.id;
    }
    if (accountFilter && accountFilter !== 'consolidated') {
      query.accountFilter = accountFilter;
    }

    return PortfolioReviewsCollection.find(query, {
      sort: { generatedAt: -1 },
      limit: Math.min(limit, 50),
      fields: {
        // Exclude heavy content fields for listing
        'positionAnalyses.commentary': 0,
        'macroAnalysis.content': 0,
        'allocationAnalysis.content': 0,
        'fxAnalysis.content': 0,
        'eventsSchedule.content': 0,
        'cashAnalysis.content': 0,
        'recommendations.content': 0
      }
    });
  });

  // Publish the latest generating review (for toast notification)
  Meteor.publish('portfolioReviews.active', async function (sessionId = null) {
    check(sessionId, Match.Maybe(String));

    const viewer = await reviewPublisher(sessionId);
    if (!viewer) return this.ready();

    const query = viewer.seeAll
      ? { status: 'generating' }
      : { generatedBy: viewer.user._id, status: 'generating' };

    return PortfolioReviewsCollection.find(
      query,
      {
        sort: { generatedAt: -1 },
        limit: 1,
        fields: {
          status: 1,
          progress: 1,
          generatedAt: 1,
          clientName: 1
        }
      }
    );
  });

  // Import the generator (only on server)
  const { generatePortfolioReview } = require('./portfolioReviewGenerator');

  // Portfolio reviews are staff meeting-prep artifacts (client holdings/PII).
  // These methods previously accepted any string as sessionId/pdfToken without
  // validating it — closing that requires a real staff session or a valid PDF token.
  const REVIEW_STAFF_ROLES = ['admin', 'superadmin', 'compliance', 'rm', 'assistant'];

  async function requireReviewStaff(sessionId) {
    const session = await SessionHelpers.validateSession(sessionId);
    if (!session || !session.userId) {
      throw new Meteor.Error('not-authorized', 'Invalid or expired session');
    }
    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user || !REVIEW_STAFF_ROLES.includes(user.role)) {
      throw new Meteor.Error('not-authorized', 'Staff access required');
    }
    return user;
  }

  async function validateReviewPdfToken(userId, pdfToken) {
    if (!userId || !pdfToken) {
      throw new Meteor.Error('invalid-params', 'Missing userId or pdfToken');
    }
    // Same rule as server/helpers/pdfAccessTokens.js (the source of truth):
    // a token from the per-generation list, or the legacy single slot, and
    // unexpired either way. Inlined rather than imported because this file is
    // shared code — a /server import would be pulled into the client bundle.
    const now = new Date();
    const user = await UsersCollection.findOneAsync({
      _id: userId,
      $or: [
        { 'services.pdfAccessTokens': { $elemMatch: { token: pdfToken, expiresAt: { $gt: now } } } },
        { 'services.pdfAccess.token': pdfToken, 'services.pdfAccess.expiresAt': { $gt: now } }
      ]
    });
    if (!user) {
      throw new Meteor.Error('unauthorized', 'Invalid or expired PDF token');
    }
    return user;
  }

  Meteor.methods({
    /**
     * Start generating a portfolio review in the background.
     * Returns the reviewId immediately; client subscribes for progress updates.
     */
    async 'portfolioReview.generate'(sessionId, accountFilter, viewAsFilter, language = 'en') {
      check(sessionId, String);
      check(accountFilter, String);
      check(viewAsFilter, Match.Maybe(Object));
      check(language, String);

      const currentUser = await requireReviewStaff(sessionId);

      // The review is built from the target's holdings, so the target must be
      // inside the caller's perimeter: an RM may not review another RM's
      // client. resolveScope denies a malformed filter and an out-of-perimeter
      // target alike; the original object is still stored (the UI reads its
      // `label`).
      {
        const { resolveScope, assertAccountInScope } = await import('../../server/helpers/accessScope.js');
        const scope = await resolveScope(currentUser, viewAsFilter || null);
        if (scope.denied) {
          throw new Meteor.Error('not-authorized', 'Client is outside your access scope');
        }
        if (accountFilter !== 'consolidated' && accountFilter !== 'all') {
          await assertAccountInScope(scope, accountFilter);
        }
      }

      console.log('[PortfolioReview] Starting generation, account:', accountFilter, 'language:', language);

      // Create initial document with status='generating'
      const reviewDoc = {
        accountFilter,
        viewAsFilter: viewAsFilter || null,
        clientName: viewAsFilter?.label || 'Consolidated',
        language,
        status: 'generating',
        generatedAt: new Date(),
        completedAt: null,
        generatedBy: currentUser._id,
        processingTimeMs: null,
        progress: {
          currentStep: 'initializing',
          currentStepLabel: language === 'fr' ? 'Initialisation...' : 'Initializing...',
          completedSections: 0,
          totalSections: 9,
          positionsAnalyzed: 0,
          totalPositions: 0
        },
        portfolioSnapshot: null,
        macroAnalysis: null,
        positionAnalyses: [],
        allocationAnalysis: null,
        fxAnalysis: null,
        eventsSchedule: null,
        cashAnalysis: null,
        pointsOfAttention: null,
        recommendations: null
      };

      const reviewId = await PortfolioReviewsCollection.insertAsync(reviewDoc);
      console.log('[PortfolioReview] Created review document:', reviewId);

      // Unblock the client so they can continue navigating
      this.unblock();

      // Run generation in background
      generatePortfolioReview(reviewId, accountFilter, viewAsFilter, language, currentUser._id)
        .then(() => {
          console.log('[PortfolioReview] Background generation completed for:', reviewId);
        })
        .catch(async (error) => {
          console.error('[PortfolioReview] Background generation failed:', error);
          try {
            await PortfolioReviewsCollection.updateAsync(reviewId, {
              $set: {
                status: 'failed',
                completedAt: new Date(),
                'progress.currentStep': 'failed',
                'progress.currentStepLabel': error.message || 'Generation failed'
              }
            });
          } catch (updateErr) {
            console.error('[PortfolioReview] Failed to update error status:', updateErr);
          }
        });

      return { reviewId };
    },

    /**
     * Get a specific review by ID (full document)
     */
    async 'portfolioReview.getReview'(reviewId, sessionId) {
      check(reviewId, String);
      check(sessionId, String);

      const user = await requireReviewStaff(sessionId);

      const review = await PortfolioReviewsCollection.findOneAsync(reviewId);
      if (!review) {
        throw new Meteor.Error('not-found', 'Portfolio review not found');
      }
      if (!(await canReadReview(user, review))) {
        throw new Meteor.Error('not-authorized', 'Portfolio review is outside your access scope');
      }

      return review;
    },

    /**
     * Get review for PDF generation (bypasses session check, uses pdfToken)
     */
    async 'portfolioReview.getReviewForPdf'({ reviewId, userId, pdfToken }) {
      check(reviewId, String);
      check(userId, String);
      check(pdfToken, String);

      // Validate the short-lived PDF token (previously the token was ignored).
      // The token proves identity only; the same scope rule as on screen applies.
      const user = await validateReviewPdfToken(userId, pdfToken);

      const review = await PortfolioReviewsCollection.findOneAsync(reviewId);
      if (!review) {
        throw new Meteor.Error('not-found', 'Portfolio review not found');
      }
      if (!(await canReadReview(user, review))) {
        throw new Meteor.Error('not-authorized', 'Portfolio review is outside your access scope');
      }

      return review;
    },

    /**
     * List reviews (summary only, for the reviews tab)
     */
    async 'portfolioReview.list'(sessionId, viewAsFilter, accountFilter, limit = 20) {
      check(sessionId, String);
      check(viewAsFilter, Match.Maybe(Object));
      check(accountFilter, Match.Maybe(String));
      check(limit, Number);

      const user = await requireReviewStaff(sessionId);

      const query = {};

      if (viewAsFilter && typeof viewAsFilter.id === 'string' && viewAsFilter.id) {
        query['viewAsFilter.id'] = viewAsFilter.id;
      }
      if (accountFilter && accountFilter !== 'consolidated') {
        query.accountFilter = accountFilter;
      }

      const reviews = await PortfolioReviewsCollection.find(query, {
        sort: { generatedAt: -1 },
        limit: Math.min(limit, 50),
        fields: {
          _id: 1,
          accountFilter: 1,
          viewAsFilter: 1,
          clientName: 1,
          language: 1,
          status: 1,
          generatedAt: 1,
          completedAt: 1,
          generatedBy: 1,
          processingTimeMs: 1,
          progress: 1,
          portfolioSnapshot: 1
        }
      }).fetchAsync();

      // Reviews are few: filter in memory with the one rule, resolving the
      // caller's scope once. See-all roles pass without a scope lookup.
      const { isSeeAll } = await import('../../server/helpers/accessPolicy.js');
      if (isSeeAll(user)) return reviews;

      const { resolveScope } = await import('../../server/helpers/accessScope.js');
      const scope = await resolveScope(user);
      const readable = [];
      for (const review of reviews) {
        if (await canReadReview(user, review, scope)) readable.push(review);
      }
      return readable;
    },

    /**
     * Delete a review
     */
    async 'portfolioReview.delete'(reviewId, sessionId) {
      check(reviewId, String);
      check(sessionId, String);

      const user = await requireReviewStaff(sessionId);

      const review = await PortfolioReviewsCollection.findOneAsync(reviewId);
      if (!review) {
        throw new Meteor.Error('not-found', 'Review not found');
      }

      // Only the review's author or an admin/compliance user may delete it.
      const canDeleteAny = ['admin', 'superadmin', 'compliance'].includes(user.role);
      if (!canDeleteAny && review.generatedBy && review.generatedBy !== user._id) {
        throw new Meteor.Error('not-authorized', 'You can only delete reviews you generated');
      }

      await PortfolioReviewsCollection.removeAsync(reviewId);
      return { success: true };
    },

    /**
     * Cancel a generating review
     */
    async 'portfolioReview.cancel'(reviewId, sessionId) {
      check(reviewId, String);
      check(sessionId, String);

      await requireReviewStaff(sessionId);

      const review = await PortfolioReviewsCollection.findOneAsync(reviewId);
      if (!review) {
        throw new Meteor.Error('not-found', 'Review not found');
      }
      if (review.status !== 'generating') {
        throw new Meteor.Error('invalid-status', 'Review is not currently generating');
      }

      await PortfolioReviewsCollection.updateAsync(reviewId, {
        $set: {
          status: 'cancelled',
          completedAt: new Date(),
          'progress.currentStep': 'cancelled',
          'progress.currentStepLabel': 'Cancelled by user'
        }
      });

      return { success: true };
    }
  });
}
