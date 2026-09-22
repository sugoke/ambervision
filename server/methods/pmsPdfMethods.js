/**
 * PMS PDF Methods
 *
 * Server methods for fetching PMS data for PDF generation.
 * These methods authenticate via PDF token instead of session,
 * allowing Puppeteer to access data without a real session.
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { findUserByPdfAccessToken } from '../helpers/pdfAccessTokens.js';
import { accountHolderSelector } from '/imports/api/bankAccounts';
// The perimeter rule lives with the dashboard that defined it. Importing it is
// the point: this file used to carry its own copy, and the copy was wrong.
import { getFilteredClientIds } from './rmDashboardMethods.js';
import { ProductsCollection } from '/imports/api/products';
import { SecuritiesMetadataCollection } from '/imports/api/securitiesMetadata';
import { PortfolioSnapshotHelpers } from '/imports/api/portfolioSnapshots';

/**
 * Validate PDF token and return the user
 */
async function validatePdfToken(userId, pdfToken) {
  if (!userId || !pdfToken) {
    throw new Meteor.Error('invalid-params', 'Missing userId or pdfToken');
  }

  // Accepts a token from the per-run list as well as the legacy single slot,
  // and checks expiry in the query — see server/helpers/pdfAccessTokens.js.
  const user = await findUserByPdfAccessToken(userId, pdfToken);

  if (!user) {
    throw new Meteor.Error('unauthorized', 'Invalid or expired PDF token');
  }

  return user;
}

/**
 * The report's data perimeter, resolved exactly as the on-screen PMS resolves it.
 *
 * This file used to branch on the role by hand, and honoured `viewAsFilter` only
 * for ADMIN and SUPERADMIN. A COMPLIANCE user matched no branch at all, so the
 * filter stayed `{ isActive, isLatest }` and the report was built from EVERY
 * client's holdings — while its header still named the one client that had been
 * selected. It also knew nothing about the 'entity' viewAs type (what the picker
 * returns since the entity migration) and matched `userId` only, so entity-only
 * clients were invisible.
 *
 * @returns {{ ownerIds: string[], account: Object|null }}
 */
const resolvePdfScope = async (currentUser, viewAsFilter) => {
  const ownerIds = await getFilteredClientIds(currentUser, viewAsFilter || null);

  // 'account' narrows to ONE account. getFilteredClientIds resolves the account's
  // OWNER, which on its own would widen the report back out to every account
  // that owner holds.
  const account = viewAsFilter?.type === 'account'
    ? await BankAccountsCollection.findOneAsync(viewAsFilter.id)
    : null;

  return { ownerIds, account };
};

/** Holdings/operations carry the owner as a legacy userId or as an entityId. */
const ownerSelector = (ownerIds) => ({
  $or: [
    { userId: { $in: ownerIds } },
    { entityId: { $in: ownerIds } }
  ]
});

/**
 * Positions in the perimeter.
 *
 * CONSOLIDATED rows are roll-up copies of the per-account rows — including both
 * is what put every position in the report twice and doubled the total (289 real
 * rows plus 221 roll-ups read as 510 holdings and ~200M instead of ~117M).
 */
const holdingsSelector = ({ ownerIds, account }) => ({
  isActive: true,
  isLatest: true,
  ...ownerSelector(ownerIds),
  ...(account
    ? { portfolioCode: account.accountNumber, bankId: account.bankId }
    : { portfolioCode: { $ne: 'CONSOLIDATED' } })
});

// GDPR accountability
const { AuditLog } = require('/imports/api/auditLog');

Meteor.methods({
  /**
   * Get PMS holdings for PDF generation
   */
  async 'pms.getHoldingsForPdf'({ userId, pdfToken, viewAsFilter }) {
    check(userId, String);
    check(pdfToken, String);
    check(viewAsFilter, Match.Maybe(Match.ObjectIncluding({
      type: String,
      id: String
    })));

    console.log('[PMS_PDF] Fetching holdings for PDF, userId:', userId);

    // Validate PDF token
    const currentUser = await validatePdfToken(userId, pdfToken);

    await AuditLog.record({
      actorUserId: currentUser._id,
      actorRole: currentUser.role,
      action: 'export.pdf',
      targetType: 'pmsReport',
      targetId: viewAsFilter ? `${viewAsFilter.type}:${viewAsFilter.id}` : 'all'
    });

    const scope = await resolvePdfScope(currentUser, viewAsFilter);

    const holdings = await PMSHoldingsCollection.find(holdingsSelector(scope), {
      sort: { securityName: 1 }
    }).fetchAsync();

    console.log(`[PMS_PDF] Found ${holdings.length} holdings for ${scope.ownerIds.length} owner(s)${scope.account ? ` on account ${scope.account.accountNumber}` : ''}`);
    return holdings;
  },

  /**
   * Get PMS operations for PDF generation
   */
  async 'pms.getOperationsForPdf'({ userId, pdfToken, viewAsFilter }) {
    check(userId, String);
    check(pdfToken, String);
    check(viewAsFilter, Match.Maybe(Match.ObjectIncluding({
      type: String,
      id: String
    })));

    console.log('[PMS_PDF] Fetching operations for PDF, userId:', userId);

    // Validate PDF token
    const currentUser = await validatePdfToken(userId, pdfToken);

    const scope = await resolvePdfScope(currentUser, viewAsFilter);

    const operations = await PMSOperationsCollection.find({
      isActive: true,
      ...ownerSelector(scope.ownerIds),
      ...(scope.account
        ? { portfolioCode: scope.account.accountNumber, bankId: scope.account.bankId }
        : {})
    }, {
      sort: { operationDate: -1, inputDate: -1 }
    }).fetchAsync();

    console.log(`[PMS_PDF] Found ${operations.length} operations for ${scope.ownerIds.length} owner(s)`);
    return operations;
  },

  /**
   * Get bank accounts for PDF generation
   */
  async 'pms.getBankAccountsForPdf'({ userId, pdfToken, viewAsFilter }) {
    check(userId, String);
    check(pdfToken, String);
    check(viewAsFilter, Match.Maybe(Match.ObjectIncluding({
      type: String,
      id: String
    })));

    console.log('[PMS_PDF] Fetching bank accounts for PDF, userId:', userId);

    // Validate PDF token
    const currentUser = await validatePdfToken(userId, pdfToken);

    const scope = await resolvePdfScope(currentUser, viewAsFilter);

    // accountHolderSelector, not a bare { entityId }: a joint account is one row
    // listing every holder, and the co-holders would otherwise lose it.
    const accounts = await BankAccountsCollection.find(
      scope.account
        ? { _id: scope.account._id }
        : { isActive: true, ...accountHolderSelector(scope.ownerIds) }
    ).fetchAsync();

    console.log(`[PMS_PDF] Found ${accounts.length} bank accounts for ${scope.ownerIds.length} owner(s)`);
    return accounts;
  },

  /**
   * Get products for PDF generation (for linking holdings to structured products)
   */
  async 'pms.getProductsForPdf'({ userId, pdfToken }) {
    check(userId, String);
    check(pdfToken, String);

    console.log('[PMS_PDF] Fetching products for PDF');

    // Validate PDF token
    await validatePdfToken(userId, pdfToken);

    // Return all active products (needed for ISIN matching)
    const products = await ProductsCollection.find(
      { isActive: { $ne: false } },
      { fields: { _id: 1, isin: 1, name: 1, productTitle: 1, productType: 1 } }
    ).fetchAsync();

    console.log('[PMS_PDF] Found', products.length, 'products');
    return products;
  },

  /**
   * Get securities metadata for PDF generation (for asset class classification)
   */
  async 'pms.getSecuritiesMetadataForPdf'({ userId, pdfToken }) {
    check(userId, String);
    check(pdfToken, String);

    console.log('[PMS_PDF] Fetching securities metadata for PDF');

    // Validate PDF token
    await validatePdfToken(userId, pdfToken);

    // Return all securities metadata
    const metadata = await SecuritiesMetadataCollection.find({}).fetchAsync();

    console.log('[PMS_PDF] Found', metadata.length, 'securities metadata entries');
    return metadata;
  },

  /**
   * Get performance periods for PDF generation
   */
  async 'pms.getPerformanceForPdf'({ userId, pdfToken, viewAsFilter }) {
    check(userId, String);
    check(pdfToken, String);
    check(viewAsFilter, Match.Maybe(Match.ObjectIncluding({
      type: String,
      id: String
    })));

    console.log('[PMS_PDF] Fetching performance data for PDF');

    // Validate PDF token
    const currentUser = await validatePdfToken(userId, pdfToken);

    const now = new Date();

    // Same perimeter as the positions above. The snapshot helper works from one
    // owner, so take the first of the resolved ids: with a viewAs selection that
    // is the selected client (or the selected account's owner), and without one
    // there is no single portfolio whose performance this would be.
    const scope = await resolvePdfScope(currentUser, viewAsFilter);
    const targetUserId = viewAsFilter ? (scope.ownerIds[0] || currentUser._id) : currentUser._id;
    const targetPortfolioCode = scope.account ? scope.account.accountNumber : null;

    // Define period start dates
    const periods = {
      '1M': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      '3M': new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
      '6M': new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000),
      'YTD': new Date(now.getFullYear(), 0, 1),
      '1Y': new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
      'ALL': null
    };

    const results = {};

    for (const [periodName, startDate] of Object.entries(periods)) {
      try {
        const performance = await PortfolioSnapshotHelpers.calculatePerformance({
          userId: targetUserId,
          portfolioCode: targetPortfolioCode,
          startDate,
          endDate: now
        });

        if (performance) {
          results[periodName] = {
            hasData: true,
            returnPercent: performance.totalReturnPercent,
            returnAmount: performance.totalReturn,
            startValue: performance.initialValue,
            endValue: performance.finalValue,
            change: performance.totalReturn,
            dataPoints: performance.dataPoints
          };
        } else {
          results[periodName] = {
            hasData: false,
            returnPercent: 0,
            returnAmount: 0,
            startValue: 0,
            endValue: 0,
            change: 0
          };
        }
      } catch (error) {
        console.error(`[PMS_PDF] Error calculating ${periodName} performance:`, error.message);
        results[periodName] = {
          hasData: false,
          returnPercent: 0,
          returnAmount: 0,
          startValue: 0,
          endValue: 0,
          change: 0
        };
      }
    }

    console.log('[PMS_PDF] Performance data calculated');
    return results;
  }
});

console.log('[PMS_PDF] PMS PDF methods registered');
