import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { AllocationsCollection, AllocationHelpers } from '/imports/api/allocations';
import { ProductsCollection } from '/imports/api/products';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection } from '/imports/api/users';

// User roles
const USER_ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  CLIENT: 'client'
};

/**
 * PMS Holdings & Allocations Linking Methods
 *
 * These methods handle bidirectional linking between:
 * - Manual allocations in Ambervision (AllocationsCollection)
 * - Automated bank positions (PMSHoldingsCollection) from SFTP imports
 *
 * Linking is based on ISIN + client/user matching
 */

Meteor.methods({
  /**
   * Auto-link holdings after bank file import
   * Called automatically after bank position file is processed
   *
   * Links holdings to existing products and allocations based on:
   * - ISIN matching (holding.isin = product.isin)
   * - User matching (holding.userId = allocation.clientId)
   * - Bank account matching (holding.portfolioCode = bankAccount.accountNumber)
   */
  async 'pmsHoldings.autoLinkOnImport'({ bankId, fileDate }) {
    check(bankId, String);
    check(fileDate, Date);

    // Allow server-side calls (scheduled jobs, automated processes)
    // Only require authentication if there's a userId present
    if (this.userId) {
      // User is authenticated, validate they have admin permissions
      const user = await UsersCollection.findOneAsync(this.userId);
      if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
        throw new Meteor.Error('not-authorized', 'Only administrators can auto-link holdings');
      }
    }
    // If this.userId is undefined, it's a server-side call (e.g., from cron job or server method) - allow it

    try {
      // Get all unlinked holdings from this bank file import
      const unlinkedHoldings = await PMSHoldingsCollection.find({
        bankId,
        fileDate,
        linkingStatus: 'unlinked',
        isin: { $exists: true, $ne: null, $ne: '' }
      }).fetchAsync();

      console.log(`[PMS AUTO-LINK] Found ${unlinkedHoldings.length} unlinked holdings with ISIN`);

      const linkResults = {
        total: unlinkedHoldings.length,
        linked: 0,
        failed: 0,
        noMatch: 0,
        details: []
      };

      for (const holding of unlinkedHoldings) {
        try {
          // Find products with matching ISIN
          const matchingProducts = await ProductsCollection.find({
            isin: holding.isin
          }, {
            sort: { createdAt: -1 } // Most recent first
          }).fetchAsync();

          if (matchingProducts.length === 0) {
            linkResults.noMatch++;
            linkResults.details.push({
              holdingId: holding._id,
              isin: holding.isin,
              status: 'no_product_match',
              message: 'No product found with this ISIN'
            });
            continue;
          }

          // Use most recent product if multiple matches
          const product = matchingProducts[0];

          // Find allocation for this product + user
          const allocation = await AllocationsCollection.findOneAsync({
            productId: product._id,
            clientId: holding.userId,
            status: 'active'
          });

          if (!allocation) {
            // Auto-create allocation from this holding
            console.log(`[PMS AUTO-LINK] No allocation found for product ${product._id} and user ${holding.userId}, auto-creating...`);

            try {
              // Find user's bank account for this portfolio
              let bankAccount = await BankAccountsCollection.findOneAsync({
                userId: holding.userId,
                accountNumber: holding.portfolioCode,
                isActive: true
              });

              // Fallback to any active bank account if specific portfolio not found
              if (!bankAccount) {
                bankAccount = await BankAccountsCollection.findOneAsync({
                  userId: holding.userId,
                  isActive: true
                });
              }

              if (!bankAccount) {
                linkResults.noMatch++;
                linkResults.details.push({
                  holdingId: holding._id,
                  isin: holding.isin,
                  productId: product._id,
                  status: 'no_bank_account',
                  message: 'No bank account found for user to auto-create allocation'
                });
                continue;
              }

              // Create auto-allocation
              const allocationId = await AllocationsCollection.insertAsync({
                productId: product._id,
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
                isin: holding.isin?.toUpperCase()
              });

              // Update holding with link
              await PMSHoldingsCollection.updateAsync(holding._id, {
                $set: {
                  linkedProductId: product._id,
                  linkedAllocationId: allocationId,
                  linkingStatus: 'auto_linked',
                  linkedAt: new Date(),
                  linkedBy: this.userId || null
                }
              });

              linkResults.linked++;
              linkResults.details.push({
                holdingId: holding._id,
                isin: holding.isin,
                productId: product._id,
                allocationId: allocationId,
                status: 'auto_created',
                message: `Auto-created allocation with quantity ${holding.quantity}`
              });

              console.log(`[PMS AUTO-LINK] Auto-created allocation ${allocationId} for holding ${holding._id} (quantity: ${holding.quantity})`);
              continue;

            } catch (autoCreateError) {
              linkResults.failed++;
              linkResults.details.push({
                holdingId: holding._id,
                isin: holding.isin,
                productId: product._id,
                status: 'auto_create_failed',
                message: `Failed to auto-create allocation: ${autoCreateError.message}`
              });
              console.error(`[PMS AUTO-LINK] Error auto-creating allocation for holding ${holding._id}:`, autoCreateError);
              continue;
            }
          }

          // Verify bank account matches
          const bankAccount = await BankAccountsCollection.findOneAsync({
            _id: allocation.bankAccountId,
            userId: holding.userId
          });

          if (!bankAccount) {
            linkResults.failed++;
            linkResults.details.push({
              holdingId: holding._id,
              isin: holding.isin,
              productId: product._id,
              allocationId: allocation._id,
              status: 'bank_account_mismatch',
              message: 'Bank account not found for allocation'
            });
            continue;
          }

          // Auto-link: Update holding
          await PMSHoldingsCollection.updateAsync(holding._id, {
            $set: {
              linkedProductId: product._id,
              linkedAllocationId: allocation._id,
              linkingStatus: 'auto_linked',
              linkedAt: new Date(),
              linkedBy: this.userId || null // null for server-side/automated calls
            }
          });

          // Update allocation with linked holding
          await AllocationsCollection.updateAsync(allocation._id, {
            $addToSet: { linkedHoldingIds: holding._id },
            $set: { holdingsSyncedAt: new Date() }
          });

          linkResults.linked++;
          linkResults.details.push({
            holdingId: holding._id,
            isin: holding.isin,
            productId: product._id,
            allocationId: allocation._id,
            status: 'linked',
            message: 'Successfully auto-linked'
          });

          console.log(`[PMS AUTO-LINK] Linked holding ${holding._id} to allocation ${allocation._id} (ISIN: ${holding.isin})`);

        } catch (error) {
          linkResults.failed++;
          linkResults.details.push({
            holdingId: holding._id,
            isin: holding.isin,
            status: 'error',
            message: error.message
          });
          console.error(`[PMS AUTO-LINK] Error linking holding ${holding._id}:`, error);
        }
      }

      console.log(`[PMS AUTO-LINK] Complete: ${linkResults.linked} linked, ${linkResults.noMatch} no match, ${linkResults.failed} failed`);

      return {
        success: true,
        ...linkResults
      };

    } catch (error) {
      console.error('[PMS AUTO-LINK] Fatal error:', error);
      throw new Meteor.Error('auto-link-failed', `Auto-linking failed: ${error.message}`);
    }
  },

  /**
   * Manually link a holding to a product/allocation
   * Used when admin wants to link from PMS UI
   */
  async 'pmsHoldings.linkToProduct'({ holdingId, productId, allocationId }) {
    check(holdingId, String);
    check(productId, String);
    check(allocationId, Match.Maybe(String));

    // Validate user using Meteor's built-in authentication
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    const user = await UsersCollection.findOneAsync(this.userId);
    if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
      throw new Meteor.Error('not-authorized', 'Only administrators can link holdings');
    }

    try {
      // Validate holding exists
      const holding = await PMSHoldingsCollection.findOneAsync(holdingId);
      if (!holding) {
        throw new Meteor.Error('holding-not-found', 'Holding not found');
      }

      // Validate product exists
      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) {
        throw new Meteor.Error('product-not-found', 'Product not found');
      }

      // If allocation ID provided, validate it
      let allocation = null;
      if (allocationId) {
        allocation = await AllocationsCollection.findOneAsync(allocationId);
        if (!allocation) {
          throw new Meteor.Error('allocation-not-found', 'Allocation not found');
        }

        // Verify allocation matches product and user
        if (allocation.productId !== productId) {
          throw new Meteor.Error('allocation-mismatch', 'Allocation does not match product');
        }
        if (allocation.clientId !== holding.userId) {
          throw new Meteor.Error('user-mismatch', 'Allocation user does not match holding user');
        }
      } else {
        // Try to find existing allocation
        allocation = await AllocationsCollection.findOneAsync({
          productId,
          clientId: holding.userId,
          status: 'active'
        });
      }

      // Update holding
      await PMSHoldingsCollection.updateAsync(holdingId, {
        $set: {
          linkedProductId: productId,
          linkedAllocationId: allocation?._id || null,
          linkingStatus: 'manual_linked',
          linkedAt: new Date(),
          linkedBy: user._id
        }
      });

      // Update allocation if exists
      if (allocation) {
        await AllocationsCollection.updateAsync(allocation._id, {
          $addToSet: { linkedHoldingIds: holdingId },
          $set: { holdingsSyncedAt: new Date() }
        });
      }

      console.log(`[PMS MANUAL-LINK] Linked holding ${holdingId} to product ${productId}${allocation ? ` and allocation ${allocation._id}` : ''}`);

      return {
        success: true,
        holdingId,
        productId,
        allocationId: allocation?._id || null,
        message: 'Successfully linked'
      };

    } catch (error) {
      console.error('[PMS MANUAL-LINK] Error:', error);
      throw new Meteor.Error('link-failed', `Linking failed: ${error.message}`);
    }
  },

  /**
   * Sync allocation with current bank holdings
   * Refreshes linked holdings data and detects missing positions
   */
  async 'allocations.syncWithHoldings'({ allocationId }) {
    check(allocationId, String);

    // Validate user using Meteor's built-in authentication
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    const user = await UsersCollection.findOneAsync(this.userId);
    if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
      throw new Meteor.Error('not-authorized', 'Only administrators can sync holdings');
    }

    try {
      // Get allocation
      const allocation = await AllocationsCollection.findOneAsync(allocationId);
      if (!allocation) {
        throw new Meteor.Error('allocation-not-found', 'Allocation not found');
      }

      // Get product to get ISIN
      const product = await ProductsCollection.findOneAsync(allocation.productId);
      if (!product) {
        throw new Meteor.Error('product-not-found', 'Product not found');
      }

      // Find current holdings matching this allocation
      const matchingHoldings = await PMSHoldingsCollection.find({
        userId: allocation.clientId,
        isin: product.isin,
        isActive: true
      }, {
        sort: { fileDate: -1 }
      }).fetchAsync();

      // Update allocation with current holdings
      const holdingIds = matchingHoldings.map(h => h._id);

      await AllocationsCollection.updateAsync(allocationId, {
        $set: {
          linkedHoldingIds: holdingIds,
          holdingsSyncedAt: new Date()
        }
      });

      // Update holdings to link back to allocation
      for (const holding of matchingHoldings) {
        if (holding.linkedAllocationId !== allocationId) {
          await PMSHoldingsCollection.updateAsync(holding._id, {
            $set: {
              linkedProductId: product._id,
              linkedAllocationId: allocationId,
              linkingStatus: holding.linkingStatus === 'unlinked' ? 'auto_linked' : holding.linkingStatus,
              linkedAt: new Date(),
              linkedBy: user._id
            }
          });
        }
      }

      console.log(`[ALLOCATION SYNC] Synced allocation ${allocationId} with ${matchingHoldings.length} holdings`);

      return {
        success: true,
        allocationId,
        holdingsCount: matchingHoldings.length,
        holdings: matchingHoldings,
        syncedAt: new Date()
      };

    } catch (error) {
      console.error('[ALLOCATION SYNC] Error:', error);
      throw new Meteor.Error('sync-failed', `Sync failed: ${error.message}`);
    }
  },

  /**
   * Manually trigger auto-allocation creation for a product
   * Admin can use this to create allocations from existing PMS holdings
   */
  async 'allocations.autoCreateFromPMS'(productId) {
    check(productId, String);

    // Validate user
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    const user = await UsersCollection.findOneAsync(this.userId);
    if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
      throw new Meteor.Error('not-authorized', 'Only administrators can trigger auto-allocation');
    }

    try {
      // Get product
      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) {
        throw new Meteor.Error('product-not-found', 'Product not found');
      }

      if (!product.isin) {
        throw new Meteor.Error('no-isin', 'Product has no ISIN - cannot match with PMS holdings');
      }

      // Use the AllocationHelpers function
      const createdAllocations = await AllocationHelpers.autoCreateFromPMSHoldings(productId, product.isin);

      console.log(`[MANUAL AUTO-ALLOC] Created ${createdAllocations.length} allocations for product ${productId}`);

      return {
        success: true,
        productId,
        isin: product.isin,
        allocationsCreated: createdAllocations.length,
        allocationIds: createdAllocations
      };

    } catch (error) {
      console.error('[MANUAL AUTO-ALLOC] Error:', error);
      throw new Meteor.Error('auto-allocation-failed', `Auto-allocation failed: ${error.message}`);
    }
  },

  /**
   * Get linking suggestions for a holding
   * Finds potential products and allocations that could be linked
   */
  async 'pmsHoldings.getLinkingSuggestions'({ holdingId }) {
    check(holdingId, String);

    // Validate user using Meteor's built-in authentication
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    try {
      // Get holding
      const holding = await PMSHoldingsCollection.findOneAsync(holdingId);
      if (!holding) {
        throw new Meteor.Error('holding-not-found', 'Holding not found');
      }

      const suggestions = {
        holdingId,
        isin: holding.isin,
        products: [],
        allocations: []
      };

      // Find products with matching ISIN
      if (holding.isin) {
        const products = await ProductsCollection.find({
          isin: holding.isin
        }, {
          sort: { createdAt: -1 }
        }).fetchAsync();

        suggestions.products = products;

        // For each product, find allocations for this user
        for (const product of products) {
          const allocations = await AllocationsCollection.find({
            productId: product._id,
            clientId: holding.userId,
            status: 'active'
          }).fetchAsync();

          suggestions.allocations.push(...allocations);
        }
      }

      return {
        success: true,
        ...suggestions
      };

    } catch (error) {
      console.error('[LINKING SUGGESTIONS] Error:', error);
      throw new Meteor.Error('suggestions-failed', `Failed to get suggestions: ${error.message}`);
    }
  }
});
