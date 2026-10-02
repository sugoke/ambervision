import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

/**
 * Sizeable transaction reviews (AML monitoring)
 *
 * One document per flag raised on a client's external money flows
 * (TRANSFER_IN/OUT, PAYMENT_IN/OUT) read from PMSOperations:
 *   - single:  one movement >= SIZEABLE_SINGLE_THRESHOLD_EUR
 *   - monthly: movements of one bank account in one calendar month and one
 *              direction cumulating >= SIZEABLE_MONTHLY_THRESHOLD_EUR
 *
 * Detection lives in server/methods/sizeableTransactionMethods.js. Compliance
 * questions the RM about a flag, the RM answers, compliance closes it:
 *   open -> questioned -> answered -> done  (done is allowed from any state)
 *
 * Schema:
 * {
 *   key: String (unique — 'single|<operation uniqueKey>' or
 *                'monthly|<bankId>|<account>|<YYYY-MM>|<in|out>'),
 *   kind: 'single' | 'monthly',
 *   direction: 'in' | 'out',
 *   period: 'YYYY-MM',
 *   operationDate: Date (single only),
 *   bankId, bankName, portfolioCode, bankAccountId, entityId, clientName,
 *   rmIds: [String] (RM + backup RMs of the account, resolved at detection),
 *   amountEUR: Number, thresholdEUR: Number,
 *   operationIds: [String],
 *   operations: [{ operationId, dateText, typeLabel, description, amountText, amountEURText }],
 *   status: 'open' | 'questioned' | 'answered' | 'done',
 *   thread: [{ at, byUserId, byName, role: 'compliance' | 'rm' | 'system', text }],
 *   closedBy, closedByName, closedAt, closingNote,
 *   createdAt, updatedAt
 * }
 */
export const SizeableTransactionReviewsCollection = new Mongo.Collection('sizeableTransactionReviews');

export const SIZEABLE_SINGLE_THRESHOLD_EUR = 100000;
export const SIZEABLE_MONTHLY_THRESHOLD_EUR = 300000;

export const SIZEABLE_KINDS = {
  SINGLE: 'single',
  MONTHLY: 'monthly'
};

export const SIZEABLE_STATUSES = {
  OPEN: 'open',
  QUESTIONED: 'questioned',
  ANSWERED: 'answered',
  DONE: 'done'
};

export const SIZEABLE_STATUS_LABELS = {
  [SIZEABLE_STATUSES.OPEN]: 'To review',
  [SIZEABLE_STATUSES.QUESTIONED]: 'Waiting for RM',
  [SIZEABLE_STATUSES.ANSWERED]: 'RM answered',
  [SIZEABLE_STATUSES.DONE]: 'Done'
};

export const SIZEABLE_STATUS_COLORS = {
  [SIZEABLE_STATUSES.OPEN]: 'var(--warning-color)',
  [SIZEABLE_STATUSES.QUESTIONED]: '#8b5cf6',
  [SIZEABLE_STATUSES.ANSWERED]: 'var(--accent-color)',
  [SIZEABLE_STATUSES.DONE]: 'var(--gain-color)'
};

if (Meteor.isServer) {
  Meteor.startup(async () => {
    try {
      await SizeableTransactionReviewsCollection.createIndexAsync({ key: 1 }, { unique: true });
      await SizeableTransactionReviewsCollection.createIndexAsync({ status: 1, period: -1 });
      await SizeableTransactionReviewsCollection.createIndexAsync({ rmIds: 1, status: 1 });
    } catch (e) {
      console.error('[SizeableTransactions] Index creation failed:', e.message);
    }
  });
}
