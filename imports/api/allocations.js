import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { PMSHoldingsCollection } from './pmsHoldings';
import { BankAccountsCollection } from './bankAccounts';

// Allocations collection for tracking product allocations to clients
export const AllocationsCollection = new Mongo.Collection('allocations');

// Allocation schema structure:
// {
//   productId: String (reference to ProductsCollection),
//   clientId: String (reference to UsersCollection),
//   bankAccountId: String (reference to BankAccountsCollection),
//   nominalInvested: Number,
//   purchasePrice: Number (percentage, e.g., 100 for 100%),
//   allocatedAt: Date,
//   allocatedBy: String (userId of admin/superadmin who created the allocation),
//   status: String ('active', 'cancelled', 'matured', 'redeemed'),
//   notes: String (optional),
//   lastModifiedAt: Date (optional),
//   lastModifiedBy: String (optional),
//
//   // Auto-allocation fields (when created from bank file import)
//   source: String ('manual' | 'bank_auto'),
//   autoAllocatedAt: Date (when auto-created from bank file),
//   autoAllocatedFromFile: String (source bank file name),
//   quantity: Number (quantity from bank file),
//   confirmedByAdmin: Boolean (for review workflow),
//   confirmedAt: Date,
//   confirmedBy: String,
//
//   // Redemption tracking (for historical visibility)
//   redeemedAt: Date (when product was redeemed),
//   redemptionPrice: Number (final redemption price),
//   redemptionValue: Number (total value at redemption),
//   lastSeenInBankFile: Date (last time position appeared in bank file),
//
//   // PMS Holdings linking (integration with bank position files)
//   linkedHoldingIds: [String] (array of PMSHoldingsCollection._id),
//   holdingsSyncedAt: Date (last sync with bank positions),
//   isin: String (cached from product for faster queries)
// }

// Number formatting utilities (2 decimal precision)
export const AllocationFormatters = {
  // Format currency with 2 decimal places
  formatCurrency(value) {
    if (typeof value !== 'number' || isNaN(value)) return '0.00';
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  },

  // Format percentage with 2 decimal places
  formatPercentage(value) {
    if (typeof value !== 'number' || isNaN(value)) return '0.00%';
    return `${value.toFixed(2)}%`;
  },

  // Format currency with USD symbol
  formatUSD(value) {
    if (typeof value !== 'number' || isNaN(value)) return '$0.00';
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
};

// Helper functions for allocation management
export const AllocationHelpers = {
  // Get all allocations for a product
  getProductAllocations(productId) {
    check(productId, String);
    return AllocationsCollection.find({ productId, status: 'active' }, { sort: { allocatedAt: -1 } });
  },

  // Get all allocations for a client
  getClientAllocations(clientId) {
    check(clientId, String);
    return AllocationsCollection.find({ clientId, status: 'active' }, { sort: { allocatedAt: -1 } });
  },

  // Get all allocations including redeemed (for historical view)
  getAllClientAllocations(clientId, includeRedeemed = true) {
    check(clientId, String);
    const query = { clientId };
    if (!includeRedeemed) {
      query.status = { $in: ['active', 'matured'] };
    } else {
      // Include active, matured, and redeemed
      query.status = { $in: ['active', 'matured', 'redeemed'] };
    }
    return AllocationsCollection.find(query, { sort: { allocatedAt: -1 } });
  },

  // Get allocation summary for a product
  async getProductAllocationSummary(productId) {
    check(productId, String);

    const allocations = await AllocationsCollection.find({ productId, status: 'active' }).fetchAsync();

    const summary = {
      totalAllocations: allocations.length,
      totalNominalInvested: 0,
      clientCount: new Set(),
      allocations: allocations
    };

    allocations.forEach(allocation => {
      summary.totalNominalInvested += allocation.nominalInvested;
      summary.clientCount.add(allocation.clientId);
    });

    summary.clientCount = summary.clientCount.size;

    return summary;
  },

  // Update an allocation
  async updateAllocation(allocationId, updates, userId) {
    check(allocationId, String);
    check(userId, String);

    const updateData = {
      lastModifiedAt: new Date(),
      lastModifiedBy: userId
    };

    if (updates.nominalInvested !== undefined) {
      updateData.nominalInvested = updates.nominalInvested;
    }
    if (updates.purchasePrice !== undefined) {
      updateData.purchasePrice = updates.purchasePrice;
    }
    if (updates.clientId !== undefined) {
      updateData.clientId = updates.clientId;
    }
    if (updates.bankAccountId !== undefined) {
      updateData.bankAccountId = updates.bankAccountId;
    }

    const result = await AllocationsCollection.updateAsync(
      { _id: allocationId },
      { $set: updateData }
    );

    return result;
  },

  // Delete an allocation
  async deleteAllocation(allocationId) {
    check(allocationId, String);

    const result = await AllocationsCollection.removeAsync({ _id: allocationId });
    return result;
  },

  // Cancel an allocation
  async cancelAllocation(allocationId, userId) {
    check(allocationId, String);
    check(userId, String);

    const result = await AllocationsCollection.updateAsync(
      { _id: allocationId },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: userId
        }
      }
    );

    return result;
  },

  // Mark allocation as redeemed (product disappeared from bank file)
  async markAsRedeemed(allocationId, redemptionData) {
    check(allocationId, String);

    const updateData = {
      status: 'redeemed',
      redeemedAt: redemptionData.redeemedAt || new Date()
    };

    if (redemptionData.redemptionPrice) {
      updateData.redemptionPrice = redemptionData.redemptionPrice;
    }
    if (redemptionData.redemptionValue) {
      updateData.redemptionValue = redemptionData.redemptionValue;
    }

    const result = await AllocationsCollection.updateAsync(
      { _id: allocationId },
      { $set: updateData }
    );

    return result;
  },

  // Update last seen date (called during bank file processing)
  async updateLastSeen(allocationId, lastSeenDate) {
    check(allocationId, String);

    const result = await AllocationsCollection.updateAsync(
      { _id: allocationId },
      { $set: { lastSeenInBankFile: lastSeenDate || new Date() } }
    );

    return result;
  },

  // Compute allocation summary for display (pre-formatted for architectural compliance)
  computeAllocationSummary(allocations) {
    if (!allocations || !Array.isArray(allocations)) {
      return {
        totalNominalInvested: 0,
        totalNominalInvestedFormatted: AllocationFormatters.formatUSD(0),
        clientCount: 0,
        allocationCount: 0,
        averagePrice: 100,
        averagePriceFormatted: AllocationFormatters.formatPercentage(100)
      };
    }

    const totalNominalInvested = allocations.reduce((sum, allocation) => {
      return sum + (allocation.nominalInvested || 0);
    }, 0);

    const clientCount = new Set(allocations.map(a => a.clientId)).size;

    // Calculate average price (pre-computed for UI)
    const averagePrice = allocations.reduce((sum, allocation) => {
      return sum + (allocation.purchasePrice || 100);
    }, 0) / allocations.length;

    return {
      totalNominalInvested,
      totalNominalInvestedFormatted: AllocationFormatters.formatUSD(totalNominalInvested),
      clientCount,
      allocationCount: allocations.length,
      averagePrice,
      averagePriceFormatted: AllocationFormatters.formatPercentage(averagePrice)
    };
  },

  // Pre-format allocation details for display (no client-side calculations)
  formatAllocationDetails(allocations) {
    if (!allocations || !Array.isArray(allocations)) {
      return [];
    }

    return allocations.map(allocation => ({
      ...allocation,
      // Pre-format dates to avoid client-side .toLocaleDateString() calls
      allocatedAtFormatted: allocation.allocatedAt ?
        new Date(allocation.allocatedAt).toLocaleDateString() : 'N/A',
      // Pre-format numbers with 2 decimal precision
      nominalInvestedFormatted: AllocationFormatters.formatCurrency(allocation.nominalInvested || 0),
      purchasePriceFormatted: AllocationFormatters.formatPercentage(allocation.purchasePrice || 100)
    }));
  },

  // Auto-create allocations from PMS holdings when product matches by ISIN
  async autoCreateFromPMSHoldings(productId, isin) {
    check(productId, String);
    check(isin, String);

    if (!isin) {
      console.log('[AUTO-ALLOC] No ISIN provided, skipping auto-allocation');
      return [];
    }

    const normalizedIsin = isin.toUpperCase();
    console.log(`[AUTO-ALLOC] Checking for PMS holdings with ISIN: ${normalizedIsin}`);

    // Find all active PMS holdings with matching ISIN
    const holdings = await PMSHoldingsCollection.find({
      isin: normalizedIsin,
      isLatest: true,
      isActive: true
    }).fetchAsync();

    console.log(`[AUTO-ALLOC] Found ${holdings.length} PMS holdings for ISIN: ${normalizedIsin}`);

    const createdAllocations = [];

    for (const holding of holdings) {
      // Skip if no userId on holding
      if (!holding.userId) {
        console.log(`[AUTO-ALLOC] Skipping holding ${holding._id} - no userId`);
        continue;
      }

      // Skip if allocation already exists for this user/product
      const existingAlloc = await AllocationsCollection.findOneAsync({
        productId,
        clientId: holding.userId,
        status: 'active'
      });

      if (existingAlloc) {
        console.log(`[AUTO-ALLOC] Skipping - allocation already exists for user ${holding.userId}`);
        continue;
      }

      // Find user's bank account for this portfolio
      const bankAccount = await BankAccountsCollection.findOneAsync({
        userId: holding.userId,
        accountNumber: holding.portfolioCode,
        isActive: true
      });

      if (!bankAccount) {
        // Try to find any active bank account for this user
        const anyBankAccount = await BankAccountsCollection.findOneAsync({
          userId: holding.userId,
          isActive: true
        });

        if (!anyBankAccount) {
          console.log(`[AUTO-ALLOC] Skipping - no bank account found for user ${holding.userId}`);
          continue;
        }

        // Use any active bank account if specific portfolio not found
        console.log(`[AUTO-ALLOC] Using fallback bank account for user ${holding.userId}`);

        // Create auto-allocation with fallback bank account
        const allocationId = await AllocationsCollection.insertAsync({
          productId,
          clientId: holding.userId,
          bankAccountId: anyBankAccount._id,
          nominalInvested: holding.quantity || 0,
          purchasePrice: 100, // Default to par
          status: 'active',
          source: 'bank_auto',
          autoAllocatedAt: new Date(),
          autoAllocatedFromFile: holding.sourceFile || null,
          quantity: holding.quantity || 0,
          linkedHoldingIds: [holding._id],
          allocatedAt: new Date(),
          isin: normalizedIsin
        });

        // Update holding with link
        await PMSHoldingsCollection.updateAsync(holding._id, {
          $set: {
            linkedProductId: productId,
            linkedAllocationId: allocationId,
            linkingStatus: 'auto_linked',
            linkedAt: new Date()
          }
        });

        console.log(`[AUTO-ALLOC] Created allocation ${allocationId} for user ${holding.userId} with quantity ${holding.quantity}`);
        createdAllocations.push(allocationId);
        continue;
      }

      // Create auto-allocation with matching bank account
      const allocationId = await AllocationsCollection.insertAsync({
        productId,
        clientId: holding.userId,
        bankAccountId: bankAccount._id,
        nominalInvested: holding.quantity || 0,
        purchasePrice: 100, // Default to par
        status: 'active',
        source: 'bank_auto',
        autoAllocatedAt: new Date(),
        autoAllocatedFromFile: holding.sourceFile || null,
        quantity: holding.quantity || 0,
        linkedHoldingIds: [holding._id],
        allocatedAt: new Date(),
        isin: normalizedIsin
      });

      // Update holding with link
      await PMSHoldingsCollection.updateAsync(holding._id, {
        $set: {
          linkedProductId: productId,
          linkedAllocationId: allocationId,
          linkingStatus: 'auto_linked',
          linkedAt: new Date()
        }
      });

      console.log(`[AUTO-ALLOC] Created allocation ${allocationId} for user ${holding.userId} with quantity ${holding.quantity}`);
      createdAllocations.push(allocationId);
    }

    console.log(`[AUTO-ALLOC] Created ${createdAllocations.length} allocations for product ${productId}`);
    return createdAllocations;
  }
};
