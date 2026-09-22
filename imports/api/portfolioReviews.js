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

  // Publish reviews for a specific client/account context
  Meteor.publish('portfolioReviews.forClient', function (viewAsFilter, accountFilter, limit = 20) {
    check(limit, Number);

    const query = { generatedBy: this.userId };

    if (viewAsFilter && viewAsFilter.id) {
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
  Meteor.publish('portfolioReviews.active', function () {
    return PortfolioReviewsCollection.find(
      { generatedBy: this.userId, status: 'generating' },
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

      await requireReviewStaff(sessionId);

      const review = await PortfolioReviewsCollection.findOneAsync(reviewId);
      if (!review) {
        throw new Meteor.Error('not-found', 'Portfolio review not found');
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
      await validateReviewPdfToken(userId, pdfToken);

      const review = await PortfolioReviewsCollection.findOneAsync(reviewId);
      if (!review) {
        throw new Meteor.Error('not-found', 'Portfolio review not found');
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

      await requireReviewStaff(sessionId);

      const query = {};

      if (viewAsFilter && viewAsFilter.id) {
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

      return reviews;
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
