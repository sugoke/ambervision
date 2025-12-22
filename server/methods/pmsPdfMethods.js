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
import { UsersCollection, USER_ROLES } from '/imports/api/users';
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

  const user = await UsersCollection.findOneAsync({
    _id: userId,
    'services.pdfAccess.token': pdfToken
  });

  if (!user) {
    throw new Meteor.Error('unauthorized', 'Invalid or expired PDF token');
  }

  const expiresAt = user.services?.pdfAccess?.expiresAt;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    throw new Meteor.Error('token-expired', 'PDF token has expired');
  }

  return user;
}

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
    console.log('[PMS_PDF] Token validated for user:', currentUser.emails?.[0]?.address);

    // Build query filter based on role
    let queryFilter = { isActive: true, isLatest: true };

    // Admins and superadmins with viewAsFilter
    if (viewAsFilter && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN)) {
      if (viewAsFilter.type === 'client') {
        queryFilter.userId = viewAsFilter.id;
      } else if (viewAsFilter.type === 'account') {
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          queryFilter.userId = bankAccount.userId;
          queryFilter.portfolioCode = bankAccount.accountNumber;
          queryFilter.bankId = bankAccount.bankId;
        }
      }
    }
    // Admins without filter - see all holdings
    else if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
      // No additional filter - see all active holdings
    }
    // Relationship Managers
    else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      const assignedClients = await UsersCollection.find({
        relationshipManagerId: currentUser._id
      }).fetchAsync();
      const clientIds = assignedClients.map(c => c._id);
      clientIds.push(currentUser._id);
      queryFilter.userId = { $in: clientIds };
    }
    // Clients - only their own holdings
    else if (currentUser.role === USER_ROLES.CLIENT) {
      queryFilter.userId = currentUser._id;
    }

    const holdings = await PMSHoldingsCollection.find(queryFilter, {
      sort: { securityName: 1 }
    }).fetchAsync();

    console.log('[PMS_PDF] Found', holdings.length, 'holdings');
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

    // Build query filter based on role
    let queryFilter = { isActive: true };

    // Admins and superadmins with viewAsFilter
    if (viewAsFilter && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN)) {
      if (viewAsFilter.type === 'client') {
        queryFilter.userId = viewAsFilter.id;
      } else if (viewAsFilter.type === 'account') {
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          queryFilter.userId = bankAccount.userId;
          queryFilter.portfolioCode = bankAccount.accountNumber;
          queryFilter.bankId = bankAccount.bankId;
        }
      }
    }
    // Admins without filter
    else if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
      // See all operations
    }
    // Relationship Managers
    else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      const assignedClients = await UsersCollection.find({
        relationshipManagerId: currentUser._id
      }).fetchAsync();
      const clientIds = assignedClients.map(c => c._id);
      clientIds.push(currentUser._id);
      queryFilter.userId = { $in: clientIds };
    }
    // Clients
    else if (currentUser.role === USER_ROLES.CLIENT) {
      queryFilter.userId = currentUser._id;
    }

    const operations = await PMSOperationsCollection.find(queryFilter, {
      sort: { operationDate: -1, inputDate: -1 }
    }).fetchAsync();

    console.log('[PMS_PDF] Found', operations.length, 'operations');
    return operations;
  },

  /**
   * Get bank accounts for PDF generation
   */
  async 'pms.getBankAccountsForPdf'({ userId, pdfToken }) {
    check(userId, String);
    check(pdfToken, String);

    console.log('[PMS_PDF] Fetching bank accounts for PDF, userId:', userId);

    // Validate PDF token
    const currentUser = await validatePdfToken(userId, pdfToken);

    // Build query based on role
    let queryFilter = { isActive: true };

    if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
      // See all accounts
    } else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      const assignedClients = await UsersCollection.find({
        relationshipManagerId: currentUser._id
      }).fetchAsync();
      const clientIds = assignedClients.map(c => c._id);
      clientIds.push(currentUser._id);
      queryFilter.userId = { $in: clientIds };
    } else if (currentUser.role === USER_ROLES.CLIENT) {
      queryFilter.userId = currentUser._id;
    }

    const accounts = await BankAccountsCollection.find(queryFilter).fetchAsync();

    console.log('[PMS_PDF] Found', accounts.length, 'bank accounts');
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

    // Determine target userId based on role and viewAsFilter
    let targetUserId = currentUser._id;
    let targetPortfolioCode = null;

    if (viewAsFilter && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN)) {
      if (viewAsFilter.type === 'client') {
        targetUserId = viewAsFilter.id;
      } else if (viewAsFilter.type === 'account') {
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          targetUserId = bankAccount.userId;
          targetPortfolioCode = bankAccount.accountNumber;
        }
      }
    }

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
