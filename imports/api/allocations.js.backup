import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

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
//   status: String ('active', 'cancelled', 'matured'),
//   notes: String (optional)
// }

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

  // Compute allocation summary for display (pre-formatted for architectural compliance)
  computeAllocationSummary(allocations) {
    if (!allocations || !Array.isArray(allocations)) {
      return {
        totalNominalInvested: 0,
        totalNominalInvestedFormatted: '$0',
        clientCount: 0,
        allocationCount: 0,
        averagePrice: 100,
        averagePriceFormatted: '100.0%'
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
      totalNominalInvestedFormatted: totalNominalInvested.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }),
      clientCount,
      allocationCount: allocations.length,
      averagePrice,
      averagePriceFormatted: `${averagePrice.toFixed(1)}%`
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
        new Date(allocation.allocatedAt).toLocaleDateString() : 'N/A'
    }));
  }
};