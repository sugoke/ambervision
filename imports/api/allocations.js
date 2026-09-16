import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { PMSHoldingsCollection } from './pmsHoldings';
import { BankAccountsCollection, accountHolderSelector } from './bankAccounts';
import { ProductsCollection } from './products';

// Allocations collection for tracking product allocations to clients
export const AllocationsCollection = new Mongo.Collection('allocations');

// Allocation schema structure:
// {
//   productId: String (reference to ProductsCollection),
//   clientId: String (the owning client — an entity id for entity-era clients,
//     a legacy user id for older ones; entityId below carries the entity when known),
//   entityId: String (optional, the client entity this allocation belongs to),
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

  /**
   * Link a product to the bank positions that already hold it, creating one
   * allocation per holding.
   *
   * Matching is by ISIN. An allocation is what the product dashboard reads for
   * NOM / BUY / POSITION, so a holding with no allocation shows up as a dash
   * even though the bank is reporting the position.
   *
   * Owner resolution is entity-first: a client created after the entity
   * migration has no legacy userId, so keying off `holding.userId` alone
   * silently skipped those positions entirely.
   */
  async autoCreateFromPMSHoldings(productId, isin) {
    check(productId, String);
    check(isin, String);

    if (!isin) {
      console.log('[AUTO-ALLOC] No ISIN provided, skipping auto-allocation');
      return [];
    }

    const normalizedIsin = isin.toUpperCase();

    // Find all active PMS holdings with matching ISIN. CONSOLIDATED rows are
    // roll-up copies of the per-account rows — allocating from both would book
    // every position twice.
    const holdings = await PMSHoldingsCollection.find({
      isin: normalizedIsin,
      isLatest: true,
      isActive: true,
      portfolioCode: { $ne: 'CONSOLIDATED' }
    }).fetchAsync();

    if (holdings.length === 0) return [];
    console.log(`[AUTO-ALLOC] Found ${holdings.length} PMS holding(s) for ISIN ${normalizedIsin}`);

    const createdAllocations = [];

    for (const holding of holdings) {
      // A closed position carries no size to allocate.
      if (!holding.quantity || holding.quantity <= 0) continue;

      // Entity first, legacy user id second — either identifies the client.
      const ownerIds = [holding.entityId, holding.userId].filter(Boolean);
      if (ownerIds.length === 0) {
        console.log(`[AUTO-ALLOC] Skipping holding ${holding._id} — no owner on the record`);
        continue;
      }

      // The account the bank actually reported the position on. Matching on
      // (bankId, portfolioCode) rather than the account number alone keeps two
      // banks that happen to reuse a number apart.
      const bankAccount =
        await BankAccountsCollection.findOneAsync({
          ...accountHolderSelector(ownerIds),
          bankId: holding.bankId,
          accountNumber: holding.portfolioCode,
          isActive: true
        })
        || await BankAccountsCollection.findOneAsync({
          ...accountHolderSelector(ownerIds),
          accountNumber: holding.portfolioCode,
          isActive: true
        })
        || await BankAccountsCollection.findOneAsync({
          ...accountHolderSelector(ownerIds),
          isActive: true
        });

      if (!bankAccount) {
        console.log(`[AUTO-ALLOC] Skipping holding ${holding._id} — no active bank account for ${ownerIds.join('/')}`);
        continue;
      }

      // Already allocated on THIS product? Match on the account first (the
      // precise link), then on either owner id, since older allocations were
      // filed under the userId.
      const existingAlloc = await AllocationsCollection.findOneAsync({
        productId,
        status: 'active',
        $or: [
          { bankAccountId: bankAccount._id },
          { clientId: { $in: ownerIds } }
        ]
      });

      if (existingAlloc) continue;

      // Already allocated on ANOTHER product? One bank position backs at most
      // one allocation across all products. Two product records sharing an ISIN
      // (duplicates predating the ISIN-uniqueness guard) would otherwise each
      // claim the same position and double the portfolio value.
      const conflicting = await AllocationHelpers.findAllocationForPosition(holding, normalizedIsin);
      if (conflicting) {
        console.warn(
          `[AUTO-ALLOC] ${normalizedIsin} ${holding.portfolioCode} is already allocated to product ` +
          `${conflicting.productId} (allocation ${conflicting._id}) — not allocating it to ${productId} as well. ` +
          `Two products likely share this ISIN.`
        );
        continue;
      }

      // pmsHoldings store prices as decimals (1.0001 = 100.01%) while
      // allocations store percentages, so the bank's cost basis is scaled up.
      // Par is the fallback only when the bank reported no cost.
      const purchasePrice = typeof holding.costPrice === 'number' && holding.costPrice > 0
        ? holding.costPrice * 100
        : 100;

      const allocationId = await AllocationsCollection.insertAsync({
        productId,
        clientId: holding.entityId || holding.userId,
        entityId: holding.entityId || null,
        bankAccountId: bankAccount._id,
        nominalInvested: holding.quantity,
        purchasePrice,
        status: 'active',
        source: 'bank_auto',
        autoAllocatedAt: new Date(),
        autoAllocatedFromFile: holding.sourceFile || null,
        quantity: holding.quantity,
        linkedHoldingIds: [holding._id],
        allocatedAt: new Date(),
        isin: normalizedIsin,
        // The bank position this allocation stands for. Stored so a later run
        // can tell "already allocated" from "a second position in the same
        // product" without walking linkedHoldingIds.
        bankId: holding.bankId || null,
        portfolioCode: holding.portfolioCode || null,
        // Demo positions must stay excluded from AUM and dashboards, so the
        // allocation inherits the flag the exclusion selectors look for.
        ...(holding.isDemo ? { isDemo: true } : {})
      });

      await PMSHoldingsCollection.updateAsync(holding._id, {
        $set: {
          linkedProductId: productId,
          linkedAllocationId: allocationId,
          linkingStatus: 'auto_linked',
          linkedAt: new Date()
        }
      });

      console.log(`[AUTO-ALLOC] Linked ${normalizedIsin} ${holding.portfolioCode}: ${holding.quantity} @ ${purchasePrice.toFixed(2)}% -> allocation ${allocationId}`);
      createdAllocations.push(allocationId);
    }

    if (createdAllocations.length > 0) {
      console.log(`[AUTO-ALLOC] Created ${createdAllocations.length} allocation(s) for product ${productId}`);
    }
    return createdAllocations;
  },

  /**
   * The active allocation already backing this exact bank position
   * (bank + portfolio + ISIN), on any product, or null.
   *
   * Allocations created before this field existed carry no bankId/portfolioCode,
   * so those are resolved through the holdings they link.
   */
  async findAllocationForPosition(holding, isin) {
    if (!holding?.bankId || !holding?.portfolioCode) return null;

    const direct = await AllocationsCollection.findOneAsync({
      isin,
      status: 'active',
      bankId: holding.bankId,
      portfolioCode: holding.portfolioCode
    });
    if (direct) return direct;

    const legacy = await AllocationsCollection.find({
      isin,
      status: 'active',
      bankId: { $exists: false },
      linkedHoldingIds: { $exists: true, $ne: [] }
    }, { fields: { productId: 1, linkedHoldingIds: 1 } }).fetchAsync();

    for (const alloc of legacy) {
      const match = await PMSHoldingsCollection.findOneAsync({
        _id: { $in: alloc.linkedHoldingIds },
        bankId: holding.bankId,
        portfolioCode: holding.portfolioCode
      }, { fields: { _id: 1 } });
      if (match) return alloc;
    }
    return null;
  },

  /**
   * Sweep every product whose ISIN the banks are reporting a position for, and
   * create the missing allocations.
   *
   * autoCreateFromPMSHoldings used to run ONLY when a product was created, but
   * the usual sequence is the other way round: the product is booked first and
   * the bank reports the position days later. Nothing linked them after the
   * fact, so those products sat on the dashboard with a dash where their size
   * should be. This runs after every bank-file import and nightly.
   *
   * Idempotent — a holding that already has an allocation is skipped.
   */
  async linkUnlinkedHoldings() {
    const isins = await PMSHoldingsCollection.rawCollection().distinct('isin', {
      isLatest: true,
      isActive: true,
      quantity: { $gt: 0 },
      portfolioCode: { $ne: 'CONSOLIDATED' }
    });

    if (!isins || isins.length === 0) return { productsLinked: 0, allocationsCreated: 0 };

    const products = await ProductsCollection.find(
      { isin: { $in: isins.filter(Boolean) } },
      { fields: { isin: 1 } }
    ).fetchAsync();

    let allocationsCreated = 0;
    let productsLinked = 0;

    for (const product of products) {
      try {
        const created = await AllocationHelpers.autoCreateFromPMSHoldings(product._id, product.isin);
        if (created.length > 0) {
          productsLinked++;
          allocationsCreated += created.length;
        }
      } catch (error) {
        // One bad product must not abort the sweep for the rest.
        console.error(`[AUTO-ALLOC] Sweep failed for product ${product._id} (${product.isin}):`, error.message);
      }
    }

    if (allocationsCreated > 0) {
      console.log(`[AUTO-ALLOC] Sweep created ${allocationsCreated} allocation(s) across ${productsLinked} product(s)`);
    }
    return { productsLinked, allocationsCreated };
  }
};
