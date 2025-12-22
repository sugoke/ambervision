import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { BankConnectionsCollection, BankConnectionHelpers } from '../../imports/api/bankConnections.js';
import { BankConnectionLogHelpers } from '../../imports/api/bankConnectionLogs.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { PMSHoldingsHelpers, PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { PMSOperationsHelpers } from '../../imports/api/pmsOperations.js';
import { PortfolioSnapshotHelpers, PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { BankPositionParser } from '../../imports/api/bankPositionParser.js';
import { BankOperationParser } from '../../imports/api/bankOperationParser.js';
import { BankFileStructureHelpers } from '../../imports/api/bankFileStructures.js';
import { NotificationHelpers } from '../../imports/api/notifications.js';
import { AccountProfilesCollection, aggregateToFourCategories } from '../../imports/api/accountProfiles.js';
import path from 'path';

/**
 * Validate session and ensure user is admin
 */
async function validateAdminSession(sessionId) {
  // Allow system-cron bypass for CRON jobs
  if (sessionId === 'system-cron' || sessionId === 'system') {
    return { _id: 'system', username: 'system-cron', role: 'superadmin' };
  }

  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  if (user.role !== 'admin' && user.role !== 'superadmin') {
    throw new Meteor.Error('not-authorized', 'Admin access required');
  }

  return user;
}

/**
 * Find userId for a portfolio code by matching to bank accounts
 * @param {string} portfolioCode - Portfolio code from PMS file
 * @param {string} bankId - Bank ID
 * @returns {string|null} - userId if found, null otherwise
 */
async function findUserIdForPortfolioCode(portfolioCode, bankId) {
  if (!portfolioCode || !bankId) {
    return null;
  }

  // Normalize portfolio code: strip "-N" suffix that Julius Baer adds in PORTFOLIO column
  // Examples: "5040217-1" → "5040217", "5040241-1" → "5040241"
  // This is needed because operations files use PORTFOLIO column (with suffix),
  // but positions files use THIRD_CODE column (without suffix)
  const normalizedCode = portfolioCode.split('-')[0];

  const bankAccount = await BankAccountsCollection.findOneAsync({
    accountNumber: normalizedCode,
    bankId: bankId,
    isActive: true
  });

  return bankAccount ? bankAccount.userId : null;
}

Meteor.methods({
  /**
   * Process latest position file for a bank connection
   */
  async 'bankPositions.processLatest'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    // Get connection
    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    // Get bank details
    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    console.log(`[BANK_POSITIONS] Processing latest positions for: ${connection.connectionName}`);

    // Log processing start
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName,
      action: 'process_positions',
      status: 'started',
      message: `Position processing started by ${user.username}`,
      userId: user._id
    });

    try {
      // Build path to bank files directory
      // Use environment variable for persistent storage, fallback to process.cwd()
      const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');

      let bankFolderPath;
      if (connection.connectionType === 'local' && connection.localFolderName) {
        // For local connections, use the configured folder path
        bankFolderPath = path.join(bankfilesRoot, connection.localFolderName);
      } else {
        // For SFTP connections, use sanitized bank name
        const sanitizedBankName = bank.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        bankFolderPath = path.join(bankfilesRoot, sanitizedBankName);
      }

      console.log(`[BANK_POSITIONS] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[BANK_POSITIONS] Current working directory: ${process.cwd()}`);
      console.log(`[BANK_POSITIONS] Scanning directory: ${bankFolderPath}`);

      // Check if directory exists
      const fs = require('fs');
      if (!fs.existsSync(bankFolderPath)) {
        console.error(`[BANK_POSITIONS] Directory does not exist: ${bankFolderPath}`);
        throw new Meteor.Error('directory-not-found', `Bank files directory not found: ${bankFolderPath}`);
      }

      // List files in directory for debugging
      try {
        const files = fs.readdirSync(bankFolderPath);
        console.log(`[BANK_POSITIONS] Found ${files.length} files in directory:`, files.slice(0, 10));
      } catch (err) {
        console.error(`[BANK_POSITIONS] Error reading directory: ${err.message}`);
      }

      // Parse latest file (without userId - will be matched later)
      const parseResult = BankPositionParser.parseLatestFile(bankFolderPath, {
        bankId: connection.bankId,
        bankName: bank.name,
        userId: null  // Will be matched to bank accounts
      });

      if (parseResult.error) {
        throw new Meteor.Error('no-files', parseResult.error);
      }

      const { positions, filename, fileDate, totalRecords, content, parser } = parseResult;

      console.log(`[BANK_POSITIONS] Parsed ${totalRecords} positions from ${filename}`);

      // Check for CSV structure changes
      if (content && parser) {
        try {
          // Extract current file structure
          const delimiter = parser.filenamePattern ? ';' : ','; // Julius Baer uses semicolon
          const currentStructure = BankFileStructureHelpers.extractStructure(content, delimiter);

          if (currentStructure) {
            // Check for structure changes compared to previous file
            const structureChange = await BankFileStructureHelpers.checkStructureChange({
              bankId: connection.bankId,
              fileType: 'positions',
              currentStructure,
              currentFileDate: fileDate
            });

            if (structureChange) {
              // Create warning notification for admins
              console.warn(`[FILE_STRUCTURE] ${structureChange.message}`);
              console.warn(`[FILE_STRUCTURE] Warnings: ${structureChange.warnings.join(', ')}`);

              await NotificationHelpers.create({
                userId: user._id,
                type: 'warning',
                title: 'Bank File Structure Changed',
                message: `${bank.name}: ${structureChange.message}\n\nChanges detected:\n${structureChange.warnings.map(w => `• ${w}`).join('\n')}`,
                metadata: {
                  bankId: connection.bankId,
                  bankName: bank.name,
                  fileType: 'positions',
                  currentFile: filename,
                  previousFile: structureChange.previousFile,
                  warnings: structureChange.warnings,
                  currentHeaders: structureChange.currentHeaders,
                  previousHeaders: structureChange.previousHeaders
                }
              });
            }

            // Record current file structure for future comparisons
            await BankFileStructureHelpers.recordStructure({
              bankId: connection.bankId,
              bankName: bank.name,
              fileType: 'positions',
              filename,
              fileDate,
              csvContent: content,
              delimiter,
              userId: user._id
            });
          }
        } catch (structureError) {
          console.error(`[FILE_STRUCTURE] Error checking structure: ${structureError.message}`);
          // Don't fail processing if structure check fails
        }
      }

      // Save positions to database with automatic account matching
      let newRecords = 0;
      let updatedRecords = 0;
      let unchangedRecords = 0;
      let skippedRecords = 0;
      let unmappedPositions = 0;
      const errors = [];
      const unmappedPortfolioCodes = new Set();
      const processedUniqueKeys = new Set(); // Track uniqueKeys for sold position detection
      const processedPortfolioCodes = new Set(); // Track portfolios we processed for cleanup

      // Log all unique portfolio codes found in positions file for debugging
      const allPosPortfolioCodes = [...new Set(positions.map(pos => pos.portfolioCode))];
      console.log(`[BANK_POSITIONS] Found ${allPosPortfolioCodes.length} unique portfolio codes in positions file: ${allPosPortfolioCodes.join(', ')}`);

      // Get all bank accounts for this bank to help with debugging
      const bankAccounts = await BankAccountsCollection.find({
        bankId: connection.bankId,
        isActive: true
      }).fetchAsync();
      console.log(`[BANK_POSITIONS] Found ${bankAccounts.length} active bank accounts for bankId=${connection.bankId}`);
      console.log(`[BANK_POSITIONS] Bank account numbers: ${bankAccounts.map(ba => ba.accountNumber).join(', ')}`);

      for (const position of positions) {
        try {
          // Match portfolio code to bank account to find userId
          const userId = await findUserIdForPortfolioCode(position.portfolioCode, connection.bankId);

          if (!userId) {
            // Skip positions without matching account - with detailed logging
            console.warn(`[BANK_POSITIONS] ❌ SKIPPING unmapped position:`);
            console.warn(`  - Portfolio Code: ${position.portfolioCode}`);
            console.warn(`  - ISIN: ${position.isin || 'N/A'}`);
            console.warn(`  - Security: ${position.securityName || 'N/A'}`);
            console.warn(`  - Bank ID: ${connection.bankId}`);
            console.warn(`  - Reason: No bank account found with accountNumber matching this portfolioCode`);
            unmappedPortfolioCodes.add(position.portfolioCode);
            unmappedPositions++;
            skippedRecords++;
            continue;
          }

          console.log(`[BANK_POSITIONS] ✓ Matched position portfolio=${position.portfolioCode} to userId=${userId}`);

          // Set the matched userId
          position.userId = userId;

          // Add connection ID and source file path
          position.connectionId = connectionId;
          position.sourceFilePath = path.join(bankFolderPath, filename);

          // Auto-enrich with internal product data if ISIN matches
          if (position.isin) {
            try {
              const { ISINClassifierHelpers } = await import('../../imports/api/isinClassifier.js');
              const productInfo = await ISINClassifierHelpers.extractProductClassification(position.isin);

              if (productInfo && productInfo.source === 'internal_product') {
                console.log(`[BANK_POSITIONS] Auto-enriching ${position.isin} from internal product DB: ${productInfo.data.securityName}`);

                // ALWAYS override with Ambervision product title for internal products
                // Bank-provided names are generic; Ambervision titles are our official product names
                position.securityName = productInfo.data.securityName;

                // Set assetClass from Ambervision classification
                position.assetClass = productInfo.data.assetClass || 'structured_product';

                // Set structured product classification fields directly on position for easy access
                position.structuredProductUnderlyingType = productInfo.data.structuredProductUnderlyingType;
                position.structuredProductProtectionType = productInfo.data.structuredProductProtectionType;

                // Store product metadata in bankSpecificData
                position.bankSpecificData = position.bankSpecificData || {};
                position.bankSpecificData.productType = productInfo.data.productType;
                position.bankSpecificData.issuer = productInfo.data.issuer;
                position.bankSpecificData.structuredProductUnderlyingType = productInfo.data.structuredProductUnderlyingType;
                position.bankSpecificData.structuredProductProtectionType = productInfo.data.structuredProductProtectionType;
                position.bankSpecificData.capitalGuaranteed100 = productInfo.data.capitalGuaranteed100;
                position.bankSpecificData.capitalGuaranteedPartial = productInfo.data.capitalGuaranteedPartial;
                position.bankSpecificData.barrierProtected = productInfo.data.barrierProtected;
                position.bankSpecificData.autoEnriched = true;
                position.bankSpecificData.enrichedAt = new Date();
                position.bankSpecificData.ambervisionTitle = productInfo.data.securityName;

                // AUTO-ALLOCATION: Create allocation if it doesn't exist
                try {
                  const { AllocationsCollection, AllocationHelpers } = await import('../../imports/api/allocations.js');
                  const { ProductsCollection } = await import('../../imports/api/products.js');

                  // Get the product
                  const matchedProduct = await ProductsCollection.findOneAsync({ isin: position.isin });

                  if (matchedProduct && userId) {
                    // Check if allocation already exists for this user/product
                    const existingAllocation = await AllocationsCollection.findOneAsync({
                      productId: matchedProduct._id,
                      clientId: userId
                    });

                    if (!existingAllocation) {
                      // Auto-create allocation
                      const allocationData = {
                        productId: matchedProduct._id,
                        clientId: userId,
                        bankAccountId: bankAccount._id,
                        nominalInvested: position.marketValue || 0,
                        purchasePrice: position.costPrice || 100, // Use cost price from bank
                        quantity: position.quantity || 0,
                        allocatedAt: new Date(),
                        allocatedBy: 'system',
                        status: 'active',
                        source: 'bank_auto',
                        autoAllocatedAt: new Date(),
                        autoAllocatedFromFile: filename,
                        lastSeenInBankFile: fileDate,
                        confirmedByAdmin: false,
                        notes: `Auto-allocated from bank file: ${filename}`
                      };

                      const allocationId = await AllocationsCollection.insertAsync(allocationData);
                      console.log(`[AUTO_ALLOCATION] Created allocation ${allocationId} for ${position.isin} → user ${userId}`);
                    } else {
                      // Update last seen date
                      await AllocationHelpers.updateLastSeen(existingAllocation._id, fileDate);

                      // Update status if needed (reactivate if was redeemed but now appears again)
                      if (existingAllocation.status === 'redeemed') {
                        await AllocationsCollection.updateAsync(existingAllocation._id, {
                          $set: {
                            status: 'active',
                            lastSeenInBankFile: fileDate,
                            notes: `${existingAllocation.notes || ''} | Reappeared in bank file ${filename} on ${fileDate}`
                          }
                        });
                        console.log(`[AUTO_ALLOCATION] Reactivated allocation for ${position.isin} (was redeemed)`);
                      }
                    }
                  }
                } catch (allocationError) {
                  console.error(`[AUTO_ALLOCATION] Error creating allocation for ${position.isin}: ${allocationError.message}`);
                  // Don't fail the import
                }

                // UNIFIED PRICING: Extract price from bank file and upsert to product prices
                if (position.marketPrice && position.priceDate) {
                  try {
                    const { ProductPriceHelpers } = await import('../../imports/api/productPrices.js');

                    // Convert decimal to percentage format ONLY for percentage-priced instruments
                    // PMSHoldings stores prices in decimal format (0.9677 = 96.77%)
                    // ProductPrices expects percentage format (96.77 = 96.77%)
                    const displayPrice = position.priceType === 'percentage'
                      ? position.marketPrice * 100  // 0.9677 → 96.77
                      : position.marketPrice;       // Keep absolute prices (equities) as-is

                    await ProductPriceHelpers.upsertProductPrice({
                      isin: position.isin,
                      price: displayPrice,
                      currency: position.priceCurrency || position.currency || 'USD',
                      priceDate: position.priceDate,
                      priceSource: 'bank_file',
                      uploadedBy: 'system',
                      sourceFile: filename,
                      bankFileDate: position.dataDate || fileDate,
                      metadata: {
                        bankName: bank.name,
                        portfolioCode: position.portfolioCode,
                        priceType: position.priceType
                      }
                    });
                  } catch (pricingError) {
                    console.error(`[UNIFIED_PRICING] Error upserting price for ${position.isin}: ${pricingError.message}`);
                    // Don't fail the import
                  }
                }
              }
            } catch (enrichError) {
              console.error(`[BANK_POSITIONS] Error enriching position: ${enrichError.message}`);
              // Continue without enrichment - don't fail the whole import
            }
          }

          // Upsert position
          const result = await PMSHoldingsHelpers.upsertHolding(position);

          // Track this position for sold position detection
          // Generate uniqueKey if not already set by parser (Julius Baer parser doesn't set it)
          const trackingUniqueKey = position.uniqueKey || PMSHoldingsHelpers.generateUniqueKey({
            bankId: connection.bankId,
            portfolioCode: position.portfolioCode,
            isin: position.isin,
            currency: position.currency,
            securityType: position.securityType,
            endDate: position.bankSpecificData?.endDate,
            reference: position.bankSpecificData?.reference
          });
          if (trackingUniqueKey) {
            processedUniqueKeys.add(trackingUniqueKey);
          }
          if (position.portfolioCode && position.userId) {
            processedPortfolioCodes.add(position.portfolioCode);
          }

          if (result.isNew) {
            newRecords++;
          } else if (result.updated) {
            updatedRecords++;
          } else {
            unchangedRecords++;
          }
        } catch (error) {
          console.error(`[BANK_POSITIONS] Error saving position: ${error.message}`);
          errors.push({
            portfolio: position.portfolioCode,
            isin: position.isin,
            error: error.message
          });
          skippedRecords++;
        }
      }

      // SOLD POSITION CLEANUP: Mark positions that are no longer in the bank file as inactive
      // This ensures PMS exactly matches today's bank statement
      console.log(`[BANK_POSITIONS] Checking for sold/transferred positions...`);
      let soldPositionsCount = 0;
      try {
        if (processedPortfolioCodes.size > 0 && processedUniqueKeys.size > 0) {
          // Find positions for these portfolios that are NOT in current file
          // These are positions that existed before but are now missing = sold/transferred/redeemed
          const stalePositions = await PMSHoldingsCollection.find({
            bankId: connection.bankId,
            portfolioCode: { $in: Array.from(processedPortfolioCodes) },
            isLatest: true,
            isActive: { $ne: false }, // Include positions where isActive is true or undefined
            uniqueKey: { $nin: Array.from(processedUniqueKeys) }
          }).fetchAsync();

          if (stalePositions.length > 0) {
            console.log(`[BANK_POSITIONS] Found ${stalePositions.length} positions to mark as sold/inactive`);

            for (const stale of stalePositions) {
              await PMSHoldingsCollection.updateAsync(stale._id, {
                $set: {
                  isActive: false,        // No longer active
                  // isLatest: true,      // KEEP as true - this IS the latest known state
                  soldAt: fileDate,
                  soldReason: 'position_not_in_bank_file',
                  updatedAt: new Date()
                }
              });
              soldPositionsCount++;
              console.log(`[BANK_POSITIONS] Marked as sold: ${stale.securityName || stale.isin || 'Unknown'} (${stale.portfolioCode})`);
            }
          } else {
            console.log(`[BANK_POSITIONS] No sold positions detected`);
          }
        }
      } catch (cleanupError) {
        console.error(`[BANK_POSITIONS] Error during stale position cleanup: ${cleanupError.message}`);
        // Don't fail the import
      }

      // REDEMPTION DETECTION: Check for allocations that disappeared from bank file
      console.log(`[BANK_POSITIONS] Checking for redeemed products...`);
      try {
        const { AllocationsCollection, AllocationHelpers } = await import('../../imports/api/allocations.js');

        // Get all active allocations for this bank connection
        const activeAllocations = await AllocationsCollection.find({
          bankAccountId: { $in: positions.map(p => p.userId).filter(Boolean) },
          status: 'active',
          source: 'bank_auto' // Only check auto-allocated products
        }).fetchAsync();

        // Get ISINs present in current bank file
        const currentFileIsins = new Set(positions.map(p => p.isin).filter(Boolean));

        for (const allocation of activeAllocations) {
          // Get product ISIN
          const { ProductsCollection } = await import('../../imports/api/products.js');
          const product = await ProductsCollection.findOneAsync(allocation.productId);

          if (product && product.isin) {
            // Check if this ISIN is missing from current file
            if (!currentFileIsins.has(product.isin)) {
              // Product disappeared - likely redeemed
              // Check if it was seen recently (within last 30 days)
              const daysSinceLastSeen = allocation.lastSeenInBankFile
                ? Math.floor((fileDate - allocation.lastSeenInBankFile) / (1000 * 60 * 60 * 24))
                : 999;

              if (daysSinceLastSeen <= 30) {
                // Mark as redeemed
                await AllocationHelpers.markAsRedeemed(allocation._id, {
                  redeemedAt: fileDate,
                  redemptionPrice: null, // We don't have final price
                  redemptionValue: allocation.nominalInvested // Use nominal as estimate
                });

                console.log(`[REDEMPTION] Marked allocation as redeemed: ${product.isin} for user ${allocation.clientId}`);
              }
            }
          }
        }
      } catch (redemptionError) {
        console.error(`[REDEMPTION] Error detecting redemptions: ${redemptionError.message}`);
      }

      // Create portfolio snapshots for each portfolio (only for matched positions with userId)
      console.log(`[BANK_POSITIONS] Creating portfolio snapshots...`);

      // Group positions by portfolio code (only positions with userId - i.e., matched positions)
      const positionsByPortfolio = positions
        .filter(pos => pos.userId) // Only include matched positions
        .reduce((groups, pos) => {
          const portfolioCode = pos.portfolioCode || 'UNKNOWN';
          if (!groups[portfolioCode]) {
            groups[portfolioCode] = [];
          }
          groups[portfolioCode].push(pos);
          return groups;
        }, {});

      // Create snapshot for each portfolio
      for (const [portfolioCode, portfolioPositions] of Object.entries(positionsByPortfolio)) {
        try {
          // Use userId from the positions (all positions in a portfolio belong to same user)
          const portfolioUserId = portfolioPositions[0].userId;

          await PortfolioSnapshotHelpers.createSnapshot({
            userId: portfolioUserId,
            bankId: connection.bankId,
            bankName: bank.name,
            connectionId,
            portfolioCode,
            accountNumber: portfolioPositions[0].accountNumber || null,
            snapshotDate: fileDate,
            fileDate,
            sourceFile: filename,
            holdings: portfolioPositions
          });
        } catch (snapshotError) {
          console.error(`[BANK_POSITIONS] Error creating snapshot for ${portfolioCode}: ${snapshotError.message}`);
        }
      }

      // CHECK ALLOCATION LIMITS after creating snapshots
      console.log(`[BANK_POSITIONS] Checking allocation limits against investment profiles...`);
      try {
        for (const [portfolioCode, portfolioPositions] of Object.entries(positionsByPortfolio)) {
          const portfolioUserId = portfolioPositions[0].userId;

          // Find the bank account for this portfolio
          const bankAccount = await BankAccountsCollection.findOneAsync({
            accountNumber: portfolioCode.split('-')[0], // Strip any suffix
            bankId: connection.bankId,
            isActive: true
          });

          if (!bankAccount) continue;

          // Get the latest snapshot for this portfolio (needed for both negative cash and allocation checks)
          const snapshot = await PortfolioSnapshotsCollection.findOneAsync({
            userId: portfolioUserId,
            portfolioCode,
            bankId: connection.bankId
          }, { sort: { snapshotDate: -1 } });

          // CHECK FOR NEGATIVE CASH BALANCE FIRST (doesn't require account profile)
          // Check PMSHoldings directly for cash positions with negative values
          // Note: assetClass is stored in lowercase ('cash', not 'CASH')
          const cashHoldings = await PMSHoldingsCollection.find({
            portfolioCode,
            bankId: connection.bankId,
            isLatest: true,
            $or: [
              { assetClass: 'cash' },
              { assetClass: { $regex: /^cash$/i } },
              { securityType: 'CASH' },
              { securityType: { $regex: /cash/i } }
            ]
          }).fetchAsync();

          // Also get ALL holdings to check for any negative values
          const allHoldings = await PMSHoldingsCollection.find({
            portfolioCode,
            bankId: connection.bankId,
            isLatest: true
          }).fetchAsync();

          const totalCashFromHoldings = cashHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);

          // Log detailed info about cash holdings
          console.log(`[CASH_CHECK] Portfolio ${portfolioCode}: found ${cashHoldings.length} cash holdings, total=${totalCashFromHoldings}, snapshot cash=${snapshot?.cashBalance}`);

          // Log each cash holding for debugging
          cashHoldings.forEach(h => {
            console.log(`[CASH_DETAIL] - ${h.securityName || h.isin}: assetClass=${h.assetClass}, securityType=${h.securityType}, marketValue=${h.marketValue}, currency=${h.currency}`);
          });

          // Check ALL holdings for negative values
          const negativeHoldings = allHoldings.filter(h => (h.marketValue || 0) < 0);
          if (negativeHoldings.length > 0) {
            console.log(`[NEGATIVE_VALUES] Portfolio ${portfolioCode}: ${negativeHoldings.length} holdings with negative marketValue:`);
            negativeHoldings.forEach(h => {
              console.log(`[NEGATIVE_VALUES] - ${h.securityName || h.isin}: assetClass=${h.assetClass}, securityType=${h.securityType}, marketValue=${h.marketValue}`);
            });
          }

          // Log unique asset classes in portfolio for debugging
          const assetClasses = [...new Set(allHoldings.map(h => h.assetClass))];
          console.log(`[ASSET_CLASSES] Portfolio ${portfolioCode} has asset classes: ${assetClasses.join(', ')}`);

          // Aggregate cash holdings by currency to get NET cash position per currency
          // This prevents double-counting when multiple cash entries exist for the same currency
          const cashByCurrency = {};
          for (const h of cashHoldings) {
            const currency = h.currency || 'EUR';
            if (!cashByCurrency[currency]) {
              cashByCurrency[currency] = { currency, totalValue: 0, holdings: [] };
            }
            cashByCurrency[currency].totalValue += (h.marketValue || 0);
            cashByCurrency[currency].holdings.push(h);
          }

          // Find currencies with negative NET balance
          const negativeCurrencies = Object.values(cashByCurrency).filter(c => c.totalValue < 0);

          // Log aggregated cash by currency for debugging
          Object.values(cashByCurrency).forEach(c => {
            console.log(`[CASH_AGGREGATED] ${c.currency}: ${c.holdings.length} entries, net value: ${c.totalValue.toLocaleString()}`);
          });

          // Get the authorized overdraft (credit line) for this account
          const authorizedOverdraft = bankAccount.authorizedOverdraft || 0;

          // Calculate total negative cash amount (as positive number for comparison) from NET balances
          const totalNegativeCash = negativeCurrencies.reduce((sum, c) => sum + Math.abs(c.totalValue), 0);

          // Only alert if negative cash EXCEEDS authorized overdraft
          const excessOverdraft = totalNegativeCash - authorizedOverdraft;
          const shouldAlert = negativeCurrencies.length > 0 && excessOverdraft > 0;

          if (shouldAlert) {
            // Get client info for notification
            const clientForCash = await UsersCollection.findOneAsync(portfolioUserId);
            const clientNameForCash = clientForCash?.profile?.firstName && clientForCash?.profile?.lastName
              ? `${clientForCash.profile.firstName} ${clientForCash.profile.lastName}`
              : clientForCash?.email || 'Unknown';

            // Build message with NET negative cash positions per currency
            const negativeDetails = negativeCurrencies.map(c => {
              const formatted = c.totalValue.toLocaleString('en-US', {
                style: 'currency',
                currency: c.currency
              });
              return `${c.currency}: ${formatted}`;
            }).join(', ');

            const overdraftInfo = authorizedOverdraft > 0
              ? ` (exceeds credit line of ${bankAccount.referenceCurrency || 'EUR'} ${authorizedOverdraft.toLocaleString()} by ${excessOverdraft.toLocaleString()})`
              : '';

            console.log(`[NEGATIVE_CASH] Account ${bankAccount.accountNumber} has negative cash positions: ${negativeDetails}${overdraftInfo}`);

            // Check for duplicate notification (same account, within 24 hours)
            const metadata = {
              bankAccountId: bankAccount._id,
              portfolioCode,
              clientId: portfolioUserId,
              clientName: clientNameForCash,
              negativeCashPositions: negativeCurrencies.map(c => ({
                currency: c.currency,
                amount: c.totalValue
              })),
              totalCashBalance: totalCashFromHoldings,
              authorizedOverdraft,
              excessOverdraft,
              severity: 'critical'
            };

            const isDuplicate = await NotificationHelpers.checkUserNotificationDuplicate(
              'unauthorized_overdraft',
              metadata,
              24 // hours
            );

            if (!isDuplicate) {
              // Collect all users who should see this notification
              const recipientIds = new Set();

              // Get all admin and superadmin users
              const adminUsers = await UsersCollection.find({
                role: { $in: ['admin', 'superadmin'] }
              }).fetchAsync();
              adminUsers.forEach(admin => recipientIds.add(admin._id));

              // Add the relationship manager if assigned
              if (clientForCash?.relationshipManagerId) {
                recipientIds.add(clientForCash.relationshipManagerId);
              }

              // Create ONE notification for all relevant users
              if (recipientIds.size > 0) {
                await NotificationHelpers.createForMultipleUsers({
                  userIds: Array.from(recipientIds),
                  type: 'error',
                  title: 'Negative Cash Balance Alert',
                  message: `CRITICAL: ${clientNameForCash}'s account ${bank.name} ${bankAccount.accountNumber} has negative cash: ${negativeDetails}${overdraftInfo}`,
                  metadata,
                  eventType: 'unauthorized_overdraft'
                });
              }
            } else {
              console.log(`[NEGATIVE_CASH] Skipping duplicate notification for account ${bankAccount.accountNumber}`);
            }
          } else if (negativeCurrencies.length > 0 && excessOverdraft <= 0) {
            // Negative cash within authorized overdraft - log but don't alert
            console.log(`[NEGATIVE_CASH] Account ${bankAccount.accountNumber} has negative cash (${totalNegativeCash.toLocaleString()}) within authorized overdraft limit (${authorizedOverdraft.toLocaleString()})`);
            // Resolve any existing alerts since the overdraft is now within limits
            await NotificationHelpers.resolveUserNotifications('unauthorized_overdraft', {
              bankAccountId: bankAccount._id
            });
          } else {
            // No negative cash positions - resolve any existing alerts for this account
            await NotificationHelpers.resolveUserNotifications('unauthorized_overdraft', {
              bankAccountId: bankAccount._id
            });
          }

          // Get the account profile for allocation limit checks
          const accountProfile = await AccountProfilesCollection.findOneAsync({
            bankAccountId: bankAccount._id
          });

          // Skip allocation limit check if no profile set (but negative cash check already ran above)
          if (!accountProfile) continue;

          // For allocation checks, we need the snapshot with breakdown data
          if (!snapshot || !snapshot.assetClassBreakdown || !snapshot.totalAccountValue) continue;

          // Calculate current allocation
          const allocation = aggregateToFourCategories(snapshot.assetClassBreakdown, snapshot.totalAccountValue);

          // Check for breaches
          const breaches = [];

          if (allocation.cash > accountProfile.maxCash) {
            breaches.push({ category: 'Cash', current: allocation.cash.toFixed(1), limit: accountProfile.maxCash });
          }
          if (allocation.bonds > accountProfile.maxBonds) {
            breaches.push({ category: 'Bonds', current: allocation.bonds.toFixed(1), limit: accountProfile.maxBonds });
          }
          if (allocation.equities > accountProfile.maxEquities) {
            breaches.push({ category: 'Equities', current: allocation.equities.toFixed(1), limit: accountProfile.maxEquities });
          }
          if (allocation.alternative > accountProfile.maxAlternative) {
            breaches.push({ category: 'Alternative', current: allocation.alternative.toFixed(1), limit: accountProfile.maxAlternative });
          }

          if (breaches.length > 0) {
            console.log(`[ALLOCATION_BREACH] Account ${bankAccount.accountNumber} has ${breaches.length} breaches`);

            // Get client name for notification
            const client = await UsersCollection.findOneAsync(portfolioUserId);
            const clientName = client?.profile?.firstName && client?.profile?.lastName
              ? `${client.profile.firstName} ${client.profile.lastName}`
              : client?.email || 'Unknown';

            // Create notification for admin and the client's RM
            const breachDetails = breaches.map(b => `${b.category}: ${b.current}% (limit: ${b.limit}%)`).join(', ');

            // Notify the admin who processed the file
            await NotificationHelpers.create({
              userId: user._id,
              type: 'warning',
              title: 'Allocation Limit Breached',
              message: `${clientName}'s account ${bank.name} ${bankAccount.accountNumber} exceeds investment profile limits.\n\n${breachDetails}`,
              metadata: {
                bankAccountId: bankAccount._id,
                portfolioCode,
                clientId: portfolioUserId,
                clientName,
                breaches,
                allocation,
                profile: {
                  maxCash: accountProfile.maxCash,
                  maxBonds: accountProfile.maxBonds,
                  maxEquities: accountProfile.maxEquities,
                  maxAlternative: accountProfile.maxAlternative
                }
              },
              eventType: 'allocation_breach'
            });

            // Also notify the relationship manager if one is assigned
            if (client?.relationshipManagerId && client.relationshipManagerId !== user._id) {
              await NotificationHelpers.create({
                userId: client.relationshipManagerId,
                type: 'warning',
                title: 'Allocation Limit Breached',
                message: `${clientName}'s account ${bank.name} ${bankAccount.accountNumber} exceeds investment profile limits.\n\n${breachDetails}`,
                metadata: {
                  bankAccountId: bankAccount._id,
                  portfolioCode,
                  clientId: portfolioUserId,
                  clientName,
                  breaches,
                  allocation,
                  profile: {
                    maxCash: accountProfile.maxCash,
                    maxBonds: accountProfile.maxBonds,
                    maxEquities: accountProfile.maxEquities,
                    maxAlternative: accountProfile.maxAlternative
                  }
                },
                eventType: 'allocation_breach'
              });
            }
          }
        }
      } catch (breachCheckError) {
        console.error(`[BANK_POSITIONS] Error checking allocation limits: ${breachCheckError.message}`);
        // Don't fail the import if breach check fails
      }

      // Log success (before processing operations)
      let logMessage = `Processed ${totalRecords} positions: ${newRecords} new, ${updatedRecords} updated`;
      if (unmappedPositions > 0) {
        logMessage += `, ${unmappedPositions} skipped (unmapped)`;
      }
      if (soldPositionsCount > 0) {
        logMessage += `, ${soldPositionsCount} marked as sold`;
      }

      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'process_positions',
        status: 'success',
        message: logMessage,
        metadata: {
          filename,
          fileDate: fileDate.toISOString(),
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          unmappedPositions,
          soldPositions: soldPositionsCount,
          unmappedPortfolioCodes: unmappedPositions > 0 ? Array.from(unmappedPortfolioCodes) : undefined,
          errors: errors.length > 0 ? errors : undefined
        },
        userId: user._id
      });

      if (unmappedPositions > 0) {
        console.log(
          `[BANK_POSITIONS] WARNING: ${unmappedPositions} positions skipped due to unmapped portfolio codes: ${Array.from(unmappedPortfolioCodes).join(', ')}`
        );
      }

      console.log(
        `[BANK_POSITIONS] Processing complete: ` +
        `${newRecords} new, ${updatedRecords} updated, ${unchangedRecords} unchanged, ${skippedRecords} skipped` +
        (soldPositionsCount > 0 ? `, ${soldPositionsCount} sold` : '')
      );

      // AUTO-LINK holdings to products and allocations
      console.log(`[PMS_AUTO_LINK] Starting auto-linking for bankId=${connection.bankId}, fileDate=${fileDate.toISOString()}`);
      try {
        const linkingResult = await Meteor.callAsync('pmsHoldings.autoLinkOnImport', {
          bankId: connection.bankId,
          fileDate
        });

        if (linkingResult.success) {
          console.log(
            `[PMS_AUTO_LINK] Auto-linking complete: ` +
            `${linkingResult.linked} linked, ${linkingResult.noMatch} no match, ${linkingResult.failed} failed`
          );

          // Log auto-linking summary
          await BankConnectionLogHelpers.logConnectionAttempt({
            connectionId,
            bankId: connection.bankId,
            connectionName: connection.connectionName,
            action: 'auto_link_holdings',
            status: 'success',
            message: `Auto-linked ${linkingResult.linked} holdings to products/allocations`,
            metadata: {
              totalHoldings: linkingResult.total,
              linked: linkingResult.linked,
              noMatch: linkingResult.noMatch,
              failed: linkingResult.failed,
              fileDate: fileDate.toISOString()
            },
            userId: user._id
          });
        }
      } catch (linkingError) {
        console.error(`[PMS_AUTO_LINK] Auto-linking failed: ${linkingError.message}`);
        // Don't fail the import - linking can be done manually later
        await BankConnectionLogHelpers.logConnectionAttempt({
          connectionId,
          bankId: connection.bankId,
          connectionName: connection.connectionName,
          action: 'auto_link_holdings',
          status: 'failed',
          error: linkingError.message,
          userId: user._id
        });
      }

      // ALSO PROCESS OPERATIONS
      console.log(`[BANK_OPERATIONS] Processing operations from same directory`);

      let operationsResult = { totalRecords: 0, newRecords: 0, updatedRecords: 0, skippedRecords: 0, unmappedOperations: 0 };

      try {
        const operationsParseResult = BankOperationParser.parseLatestFile(bankFolderPath, {
          bankId: connection.bankId,
          bankName: bank.name,
          userId: null  // Will be matched to bank accounts
        });

        if (operationsParseResult.error) {
          console.warn(`[BANK_OPERATIONS] Parse error: ${operationsParseResult.error}`);
        }

        if (!operationsParseResult.error && operationsParseResult.operations) {
          const { operations, filename: opFilename } = operationsParseResult;
          console.log(`[BANK_OPERATIONS] Parsed ${operations.length} operations from ${opFilename}`);

          let opNew = 0;
          let opUpdated = 0;
          let opSkipped = 0;
          let opUnmapped = 0;
          const opUnmappedPortfolioCodes = new Set();

          // Log all unique portfolio codes found in operations file for debugging
          const allOpPortfolioCodes = [...new Set(operations.map(op => op.portfolioCode))];
          console.log(`[BANK_OPERATIONS] Found ${allOpPortfolioCodes.length} unique portfolio codes in operations file: ${allOpPortfolioCodes.join(', ')}`);

          // Get all bank accounts for this bank to help with debugging
          const bankAccounts = await BankAccountsCollection.find({
            bankId: connection.bankId,
            isActive: true
          }).fetchAsync();
          console.log(`[BANK_OPERATIONS] Found ${bankAccounts.length} active bank accounts for bankId=${connection.bankId}`);
          console.log(`[BANK_OPERATIONS] Bank account numbers: ${bankAccounts.map(ba => ba.accountNumber).join(', ')}`);

          for (const operation of operations) {
            try {
              // Match portfolio code to bank account to find userId
              const userId = await findUserIdForPortfolioCode(operation.portfolioCode, connection.bankId);

              if (!userId) {
                // Skip operations without matching account - with detailed logging
                console.warn(`[BANK_OPERATIONS] ❌ SKIPPING unmapped operation:`);
                console.warn(`  - Portfolio Code: ${operation.portfolioCode}`);
                console.warn(`  - Operation Type: ${operation.operationType}`);
                console.warn(`  - Operation Date: ${operation.operationDate}`);
                console.warn(`  - Instrument: ${operation.instrumentCode || operation.isin || 'N/A'}`);
                console.warn(`  - Bank ID: ${connection.bankId}`);
                console.warn(`  - Reason: No bank account found with accountNumber matching this portfolioCode`);
                opUnmappedPortfolioCodes.add(operation.portfolioCode);
                opUnmapped++;
                opSkipped++;
                continue;
              }

              console.log(`[BANK_OPERATIONS] ✓ Matched operation portfolio=${operation.portfolioCode} to userId=${userId}`);

              // Set the matched userId
              operation.userId = userId;

              operation.connectionId = connectionId;
              operation.sourceFilePath = path.join(bankFolderPath, opFilename);

              const result = await PMSOperationsHelpers.upsertOperation(operation);

              if (result.updated) {
                opUpdated++;
              } else {
                opNew++;
              }
            } catch (error) {
              console.error(`[BANK_OPERATIONS] Error saving operation: ${error.message}`);
              opSkipped++;
            }
          }

          operationsResult = {
            totalRecords: operations.length,
            newRecords: opNew,
            updatedRecords: opUpdated,
            skippedRecords: opSkipped,
            unmappedOperations: opUnmapped,
            unmappedPortfolioCodes: opUnmapped > 0 ? Array.from(opUnmappedPortfolioCodes) : undefined,
            filename: opFilename
          };

          if (opUnmapped > 0) {
            console.log(
              `[BANK_OPERATIONS] WARNING: ${opUnmapped} operations skipped due to unmapped portfolio codes: ${Array.from(opUnmappedPortfolioCodes).join(', ')}`
            );
          }

          console.log(
            `[BANK_OPERATIONS] Operations complete: ` +
            `${opNew} new, ${opUpdated} updated, ${opSkipped} skipped`
          );

          // Log operations processing success
          const opLogMessage = opUnmapped > 0
            ? `Processed ${operations.length} operations: ${opNew} new, ${opUpdated} updated, ${opUnmapped} skipped (unmapped)`
            : `Processed ${operations.length} operations: ${opNew} new, ${opUpdated} updated`;

          await BankConnectionLogHelpers.logConnectionAttempt({
            connectionId,
            bankId: connection.bankId,
            connectionName: connection.connectionName,
            action: 'process_operations',
            status: 'success',
            message: opLogMessage,
            metadata: {
              filename: opFilename,
              totalRecords: operations.length,
              newRecords: opNew,
              updatedRecords: opUpdated,
              skippedRecords: opSkipped,
              unmappedOperations: opUnmapped,
              unmappedPortfolioCodes: opUnmapped > 0 ? Array.from(opUnmappedPortfolioCodes) : undefined
            },
            userId: user._id
          });
        } else {
          console.log(`[BANK_OPERATIONS] No operations file found or parse error`);
        }
      } catch (opError) {
        console.error(`[BANK_OPERATIONS] Operations processing error: ${opError.message}`);
      }

      // Log successful position processing with detailed stats
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'process_positions',
        status: 'success',
        message: `Processed ${filename}: ${newRecords} new, ${updatedRecords} updated, ${skippedRecords} skipped`,
        metadata: {
          filename,
          fileDate,
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          unmappedPositions,
          soldPositions: soldPositionsCount,
          unmappedPortfolioCodes: unmappedPositions > 0 ? Array.from(unmappedPortfolioCodes) : [],
          errorsCount: errors.length
        },
        userId: user._id
      });

      // Update lastProcessedAt timestamp on successful processing
      await BankConnectionHelpers.updateActivityTimestamps(connectionId, { processedAt: new Date() });

      return {
        success: true,
        positions: {
          filename,
          fileDate,
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          unmappedPositions,
          soldPositions: soldPositionsCount,
          unmappedPortfolioCodes: unmappedPositions > 0 ? Array.from(unmappedPortfolioCodes) : undefined,
          errors
        },
        operations: operationsResult
      };

    } catch (error) {
      console.error(`[BANK_POSITIONS] Processing failed: ${error.message}`);

      // Log failure
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'process_positions',
        status: 'failed',
        error: error.message,
        userId: user._id
      });

      throw new Meteor.Error('processing-failed', error.message);
    }
  },

  /**
   * Get available position files for a connection
   */
  async 'bankPositions.getAvailableFiles'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    // Get connection and bank
    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    // Sanitize bank name
    const sanitizedBankName = bank.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const bankFolderPath = path.join(process.cwd(), 'bankfiles', sanitizedBankName);

    // Find all position files
    const files = BankPositionParser.findPositionFiles(bankFolderPath);

    return {
      files: files.map(f => ({
        filename: f.filename,
        fileDate: f.fileDate,
        fileSize: f.fileSize,
        bankParser: f.bankParser
      })),
      directory: sanitizedBankName
    };
  },

  /**
   * Get holdings summary for a portfolio
   */
  async 'bankPositions.getPortfolioSummary'({ portfolioCode, bankId, sessionId }) {
    check(portfolioCode, String);
    check(bankId, Match.Optional(String));
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    const summary = await PMSHoldingsHelpers.getHoldingsSummary(portfolioCode);

    return {
      portfolioCode,
      summary,
      totalPositions: summary.length,
      totalMarketValue: summary.reduce((sum, s) => sum + (s.totalMarketValue || 0), 0)
    };
  },

  /**
   * Get latest holdings for a portfolio
   */
  async 'bankPositions.getLatestHoldings'({ portfolioCode, bankId, sessionId }) {
    check(portfolioCode, String);
    check(bankId, Match.Optional(String));
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    const holdings = await PMSHoldingsHelpers.getLatestHoldings(portfolioCode, bankId);

    return {
      portfolioCode,
      holdings,
      totalPositions: holdings.length,
      fileDate: holdings.length > 0 ? holdings[0].fileDate : null
    };
  },

  /**
   * Get dates that have files available but haven't been processed into PMSHoldings
   * Used for detecting gaps when bank files were missed
   */
  async 'bankPositions.getMissingDates'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);

    const user = await validateAdminSession(sessionId);

    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    // Build path to bank files
    const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
    let bankFolderPath;
    if (connection.connectionType === 'local' && connection.localFolderName) {
      bankFolderPath = path.join(bankfilesRoot, connection.localFolderName);
    } else {
      const sanitizedBankName = bank.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      bankFolderPath = path.join(bankfilesRoot, sanitizedBankName);
    }

    // Get all available file dates from the directory
    const availableDates = BankPositionParser.getAvailableFileDates(bankFolderPath);

    if (availableDates.length === 0) {
      return { missingDates: [], availableDates: [], processedDates: [], connectionId };
    }

    // Get all processed snapshot dates from PMSHoldings for this bank
    // We use rawCollection for distinct() since Meteor's collection doesn't have it
    const processedSnapshots = await PMSHoldingsCollection.rawCollection().distinct(
      'snapshotDate',
      { bankId: connection.bankId, isLatest: true }
    );

    // Normalize processed dates to YYYY-MM-DD strings for comparison
    const processedDateStrings = new Set(
      processedSnapshots.map(d => new Date(d).toISOString().split('T')[0])
    );

    // Find missing dates (available in files but not processed)
    const missingDates = availableDates.filter(date => {
      const dateStr = date.toISOString().split('T')[0];
      return !processedDateStrings.has(dateStr);
    });

    console.log(`[BANK_POSITIONS] getMissingDates for ${connection.connectionName}: ${availableDates.length} file dates, ${processedSnapshots.length} processed, ${missingDates.length} missing`);

    return {
      missingDates: missingDates.map(d => d.toISOString()),
      availableDates: availableDates.map(d => d.toISOString()),
      processedDates: Array.from(processedDateStrings),
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName
    };
  },

  /**
   * Process files for a specific date
   * Used for processing historical/missed dates
   */
  async 'bankPositions.processDate'({ connectionId, targetDate, sessionId }) {
    check(connectionId, String);
    check(targetDate, String); // ISO date string
    check(sessionId, String);

    const user = await validateAdminSession(sessionId);

    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    const dateToProcess = new Date(targetDate);
    const dateStr = dateToProcess.toISOString().split('T')[0];

    console.log(`[BANK_POSITIONS] Processing historical date ${dateStr} for: ${connection.connectionName}`);

    // Log processing start
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName,
      action: 'process_historical',
      status: 'started',
      message: `Historical processing for ${dateStr} started by ${user.username}`,
      metadata: { targetDate: dateStr },
      userId: user._id
    });

    try {
      // Build path
      const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
      let bankFolderPath;
      if (connection.connectionType === 'local' && connection.localFolderName) {
        bankFolderPath = path.join(bankfilesRoot, connection.localFolderName);
      } else {
        const sanitizedBankName = bank.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        bankFolderPath = path.join(bankfilesRoot, sanitizedBankName);
      }

      // Parse files for the specific date using the new method
      const parseResult = BankPositionParser.parseFilesForDate(bankFolderPath, dateToProcess, {
        bankId: connection.bankId,
        bankName: bank.name,
        userId: null
      });

      if (parseResult.error) {
        throw new Meteor.Error('no-files', parseResult.error);
      }

      const { positions, filename, fileDate, totalRecords } = parseResult;

      console.log(`[BANK_POSITIONS] Parsed ${totalRecords} positions for ${dateStr} from ${filename}`);

      // Process positions (same logic as processLatest)
      let newRecords = 0;
      let updatedRecords = 0;
      let unchangedRecords = 0;
      let skippedRecords = 0;
      let unmappedPositions = 0;
      const errors = [];
      const unmappedPortfolioCodes = new Set();
      const processedUniqueKeys = new Set();
      const processedPortfolioCodes = new Set();

      for (const position of positions) {
        try {
          // Match portfolio code to bank account to find userId
          const userId = await findUserIdForPortfolioCode(position.portfolioCode, connection.bankId);

          if (!userId) {
            unmappedPortfolioCodes.add(position.portfolioCode);
            unmappedPositions++;
            skippedRecords++;
            continue;
          }

          position.userId = userId;
          position.connectionId = connectionId;
          position.sourceFilePath = path.join(bankFolderPath, filename);

          // Auto-enrich with internal product data if ISIN matches
          if (position.isin) {
            try {
              const { ISINClassifierHelpers } = await import('../../imports/api/isinClassifier.js');
              const productInfo = await ISINClassifierHelpers.extractProductClassification(position.isin);

              if (productInfo && productInfo.source === 'internal_product') {
                console.log(`[BANK_POSITIONS] Auto-enriching ${position.isin} from internal product DB: ${productInfo.data.securityName}`);

                // ALWAYS override with Ambervision product title for internal products
                position.securityName = productInfo.data.securityName;
                position.assetClass = productInfo.data.assetClass || 'structured_product';

                // Store product metadata in bankSpecificData
                position.bankSpecificData = position.bankSpecificData || {};
                position.bankSpecificData.productType = productInfo.data.productType;
                position.bankSpecificData.issuer = productInfo.data.issuer;
                position.bankSpecificData.structuredProductUnderlyingType = productInfo.data.structuredProductUnderlyingType;
                position.bankSpecificData.structuredProductProtectionType = productInfo.data.structuredProductProtectionType;
                position.bankSpecificData.autoEnriched = true;
                position.bankSpecificData.enrichedAt = new Date();
                position.bankSpecificData.ambervisionTitle = productInfo.data.securityName;
              }
            } catch (enrichError) {
              console.error(`[BANK_POSITIONS] Error enriching position: ${enrichError.message}`);
            }
          }

          // Upsert position
          const result = await PMSHoldingsHelpers.upsertHolding(position);

          // Track for sold position detection
          const trackingUniqueKey = position.uniqueKey || PMSHoldingsHelpers.generateUniqueKey({
            bankId: connection.bankId,
            portfolioCode: position.portfolioCode,
            isin: position.isin,
            currency: position.currency,
            securityType: position.securityType,
            endDate: position.bankSpecificData?.endDate,
            reference: position.bankSpecificData?.reference
          });
          if (trackingUniqueKey) {
            processedUniqueKeys.add(trackingUniqueKey);
          }
          if (position.portfolioCode && position.userId) {
            processedPortfolioCodes.add(position.portfolioCode);
          }

          if (result.isNew) {
            newRecords++;
          } else if (result.updated) {
            updatedRecords++;
          } else {
            unchangedRecords++;
          }
        } catch (error) {
          console.error(`[BANK_POSITIONS] Error saving position for ${dateStr}: ${error.message}`);
          errors.push({
            portfolio: position.portfolioCode,
            isin: position.isin,
            error: error.message
          });
          skippedRecords++;
        }
      }

      // Create portfolio snapshots
      const positionsByPortfolio = positions
        .filter(pos => pos.userId)
        .reduce((groups, pos) => {
          const portfolioCode = pos.portfolioCode || 'UNKNOWN';
          if (!groups[portfolioCode]) {
            groups[portfolioCode] = [];
          }
          groups[portfolioCode].push(pos);
          return groups;
        }, {});

      for (const [portfolioCode, portfolioPositions] of Object.entries(positionsByPortfolio)) {
        try {
          const portfolioUserId = portfolioPositions[0].userId;

          await PortfolioSnapshotHelpers.createSnapshot({
            userId: portfolioUserId,
            bankId: connection.bankId,
            bankName: bank.name,
            connectionId,
            portfolioCode,
            accountNumber: portfolioPositions[0].accountNumber || null,
            snapshotDate: fileDate,
            fileDate,
            sourceFile: filename,
            holdings: portfolioPositions
          });
        } catch (snapshotError) {
          console.error(`[BANK_POSITIONS] Error creating snapshot for ${portfolioCode}: ${snapshotError.message}`);
        }
      }

      // Log success
      const logMessage = `Historical processing for ${dateStr}: ${newRecords} new, ${updatedRecords} updated` +
        (unmappedPositions > 0 ? `, ${unmappedPositions} skipped` : '');

      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'process_historical',
        status: 'success',
        message: logMessage,
        metadata: {
          targetDate: dateStr,
          filename,
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          unmappedPositions,
          unmappedPortfolioCodes: unmappedPositions > 0 ? Array.from(unmappedPortfolioCodes) : undefined
        },
        userId: user._id
      });

      console.log(`[BANK_POSITIONS] Historical processing for ${dateStr} complete: ${newRecords} new, ${updatedRecords} updated`);

      return {
        success: true,
        targetDate: dateStr,
        filename,
        fileDate,
        totalRecords,
        newRecords,
        updatedRecords,
        unchangedRecords,
        skippedRecords,
        unmappedPositions,
        errors
      };

    } catch (error) {
      console.error(`[BANK_POSITIONS] Historical processing failed for ${dateStr}: ${error.message}`);

      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'process_historical',
        status: 'failed',
        error: error.message,
        metadata: { targetDate: dateStr },
        userId: user._id
      });

      throw new Meteor.Error('processing-failed', error.message);
    }
  },

  /**
   * Process all missing dates for a connection in chronological order
   * Automatically detects gaps and processes each missing date
   */
  async 'bankPositions.processMissingDates'({ connectionId, sessionId, maxDates = 30 }) {
    check(connectionId, String);
    check(sessionId, String);
    check(maxDates, Match.Optional(Number));

    const user = await validateAdminSession(sessionId);

    // Get missing dates
    const { missingDates, connectionName } = await Meteor.callAsync('bankPositions.getMissingDates', {
      connectionId,
      sessionId
    });

    if (missingDates.length === 0) {
      console.log(`[BANK_POSITIONS] No missing dates for connection ${connectionId}`);
      return { success: true, processedCount: 0, failedCount: 0, missingCount: 0, remainingCount: 0, results: [] };
    }

    console.log(`[BANK_POSITIONS] Found ${missingDates.length} missing dates for ${connectionName}, processing up to ${maxDates}`);

    // Limit the number of dates to process
    const datesToProcess = missingDates.slice(0, maxDates);
    const results = [];
    let successCount = 0;
    let failCount = 0;

    // Process in chronological order (oldest first - array is already sorted)
    for (const dateStr of datesToProcess) {
      try {
        console.log(`[BANK_POSITIONS] Processing missing date: ${dateStr}`);

        const result = await Meteor.callAsync('bankPositions.processDate', {
          connectionId,
          targetDate: dateStr,
          sessionId
        });

        results.push({
          date: dateStr,
          success: true,
          newRecords: result.newRecords,
          updatedRecords: result.updatedRecords,
          totalRecords: result.totalRecords
        });
        successCount++;

      } catch (error) {
        console.error(`[BANK_POSITIONS] Failed to process ${dateStr}: ${error.message}`);
        results.push({
          date: dateStr,
          success: false,
          error: error.message
        });
        failCount++;
        // Continue with next date, don't stop on errors
      }
    }

    console.log(`[BANK_POSITIONS] Missing dates processing complete: ${successCount} succeeded, ${failCount} failed, ${Math.max(0, missingDates.length - maxDates)} remaining`);

    return {
      success: true,
      processedCount: successCount,
      failedCount: failCount,
      missingCount: missingDates.length,
      remainingCount: Math.max(0, missingDates.length - maxDates),
      results
    };
  },

  /**
   * TEST METHOD: Process Julius Baer files directly from bankfiles/julius-baer/
   * Does not require a bank connection - for testing purposes only
   */
  async 'bankPositions.testProcessJuliusBaer'({ sessionId }) {
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    console.log(`[BANK_POSITIONS_TEST] Testing Julius Baer position processing`);

    // Log processing start
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId: 'TEST',
      bankId: 'TEST_JULIUS_BAER',
      connectionName: 'Julius Baer Test',
      action: 'test_process_positions',
      status: 'started',
      message: `Test position processing started by ${user.username}`,
      userId: user._id
    });

    try {
      // Build path to bank files directory
      // Use environment variable for persistent storage, fallback to process.cwd()
      const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
      const bankFolderPath = path.join(bankfilesRoot, 'julius-baer');

      console.log(`[BANK_POSITIONS_TEST] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[BANK_POSITIONS_TEST] Current working directory: ${process.cwd()}`);
      console.log(`[BANK_POSITIONS_TEST] Scanning directory: ${bankFolderPath}`);

      // Parse latest file (without userId - will be matched later)
      const parseResult = BankPositionParser.parseLatestFile(bankFolderPath, {
        bankId: 'TEST_JULIUS_BAER',
        bankName: 'Julius Baer (Test)',
        userId: null  // Will be matched to bank accounts
      });

      if (parseResult.error) {
        throw new Meteor.Error('no-files', parseResult.error);
      }

      const { positions, filename, fileDate, totalRecords } = parseResult;

      console.log(`[BANK_POSITIONS_TEST] Parsed ${totalRecords} positions from ${filename}`);

      // Save positions to database with automatic account matching
      let newRecords = 0;
      let updatedRecords = 0;
      let unchangedRecords = 0;
      let skippedRecords = 0;
      let unmappedPositions = 0;
      const errors = [];
      const unmappedPortfolioCodes = new Set();

      for (const position of positions) {
        try {
          // Match portfolio code to bank account to find userId
          const userId = await findUserIdForPortfolioCode(position.portfolioCode, 'TEST_JULIUS_BAER');

          if (!userId) {
            // Skip positions without matching account
            console.log(`[BANK_POSITIONS_TEST] Skipping unmapped position: portfolio=${position.portfolioCode}, isin=${position.isin}`);
            unmappedPortfolioCodes.add(position.portfolioCode);
            unmappedPositions++;
            skippedRecords++;
            continue;
          }

          // Set the matched userId
          position.userId = userId;

          // Add test connection ID and source file path
          position.connectionId = 'TEST';
          position.sourceFilePath = path.join(bankFolderPath, filename);

          // Upsert position
          const result = await PMSHoldingsHelpers.upsertHolding(position);

          if (result.isNew) {
            newRecords++;
          } else if (result.updated) {
            updatedRecords++;
          } else {
            unchangedRecords++;
          }
        } catch (error) {
          console.error(`[BANK_POSITIONS_TEST] Error saving position: ${error.message}`);
          errors.push({
            portfolio: position.portfolioCode,
            isin: position.isin,
            error: error.message
          });
          skippedRecords++;
        }
      }

      // Create portfolio snapshots for each portfolio (only for matched positions with userId)
      console.log(`[BANK_POSITIONS_TEST] Creating portfolio snapshots...`);

      // Group positions by portfolio code (only positions with userId - i.e., matched positions)
      const positionsByPortfolio = positions
        .filter(pos => pos.userId) // Only include matched positions
        .reduce((groups, pos) => {
          const portfolioCode = pos.portfolioCode || 'UNKNOWN';
          if (!groups[portfolioCode]) {
            groups[portfolioCode] = [];
          }
          groups[portfolioCode].push(pos);
          return groups;
        }, {});

      // Create snapshot for each portfolio
      for (const [portfolioCode, portfolioPositions] of Object.entries(positionsByPortfolio)) {
        try {
          // Use userId from the positions (all positions in a portfolio belong to same user)
          const portfolioUserId = portfolioPositions[0].userId;

          await PortfolioSnapshotHelpers.createSnapshot({
            userId: portfolioUserId,
            bankId: 'TEST_JULIUS_BAER',
            bankName: 'Julius Baer (Test)',
            connectionId: 'TEST',
            portfolioCode,
            accountNumber: portfolioPositions[0].accountNumber || null,
            snapshotDate: fileDate,
            fileDate,
            sourceFile: filename,
            holdings: portfolioPositions
          });
        } catch (snapshotError) {
          console.error(`[BANK_POSITIONS_TEST] Error creating snapshot for ${portfolioCode}: ${snapshotError.message}`);
        }
      }

      // CHECK ALLOCATION LIMITS after creating snapshots (TEST)
      console.log(`[BANK_POSITIONS_TEST] Checking allocation limits against investment profiles...`);
      try {
        for (const [portfolioCode, portfolioPositions] of Object.entries(positionsByPortfolio)) {
          const portfolioUserId = portfolioPositions[0].userId;

          // Find the bank account for this portfolio
          const testBankAccount = await BankAccountsCollection.findOneAsync({
            accountNumber: portfolioCode.split('-')[0],
            bankId: 'TEST_JULIUS_BAER',
            isActive: true
          });

          if (!testBankAccount) continue;

          // Get the account profile
          const accountProfile = await AccountProfilesCollection.findOneAsync({
            bankAccountId: testBankAccount._id
          });

          if (!accountProfile) continue;

          // Get the latest snapshot
          const snapshot = await PortfolioSnapshotsCollection.findOneAsync({
            userId: portfolioUserId,
            portfolioCode,
            bankId: 'TEST_JULIUS_BAER'
          }, { sort: { snapshotDate: -1 } });

          if (!snapshot || !snapshot.assetClassBreakdown || !snapshot.totalAccountValue) continue;

          // Calculate current allocation
          const allocation = aggregateToFourCategories(snapshot.assetClassBreakdown, snapshot.totalAccountValue);

          // Check for breaches
          const breaches = [];

          if (allocation.cash > accountProfile.maxCash) {
            breaches.push({ category: 'Cash', current: allocation.cash.toFixed(1), limit: accountProfile.maxCash });
          }
          if (allocation.bonds > accountProfile.maxBonds) {
            breaches.push({ category: 'Bonds', current: allocation.bonds.toFixed(1), limit: accountProfile.maxBonds });
          }
          if (allocation.equities > accountProfile.maxEquities) {
            breaches.push({ category: 'Equities', current: allocation.equities.toFixed(1), limit: accountProfile.maxEquities });
          }
          if (allocation.alternative > accountProfile.maxAlternative) {
            breaches.push({ category: 'Alternative', current: allocation.alternative.toFixed(1), limit: accountProfile.maxAlternative });
          }

          if (breaches.length > 0) {
            console.log(`[ALLOCATION_BREACH_TEST] Account ${testBankAccount.accountNumber} has ${breaches.length} breaches`);

            const client = await UsersCollection.findOneAsync(portfolioUserId);
            const clientName = client?.profile?.firstName && client?.profile?.lastName
              ? `${client.profile.firstName} ${client.profile.lastName}`
              : client?.email || 'Unknown';

            const breachDetails = breaches.map(b => `${b.category}: ${b.current}% (limit: ${b.limit}%)`).join(', ');

            await NotificationHelpers.create({
              userId: user._id,
              type: 'warning',
              title: 'Allocation Limit Breached',
              message: `${clientName}'s account Julius Baer ${testBankAccount.accountNumber} exceeds investment profile limits.\n\n${breachDetails}`,
              metadata: {
                bankAccountId: testBankAccount._id,
                portfolioCode,
                clientId: portfolioUserId,
                clientName,
                breaches,
                allocation
              },
              eventType: 'allocation_breach'
            });

            if (client?.relationshipManagerId && client.relationshipManagerId !== user._id) {
              await NotificationHelpers.create({
                userId: client.relationshipManagerId,
                type: 'warning',
                title: 'Allocation Limit Breached',
                message: `${clientName}'s account Julius Baer ${testBankAccount.accountNumber} exceeds investment profile limits.\n\n${breachDetails}`,
                metadata: {
                  bankAccountId: testBankAccount._id,
                  portfolioCode,
                  clientId: portfolioUserId,
                  clientName,
                  breaches,
                  allocation
                },
                eventType: 'allocation_breach'
              });
            }
          }
        }
      } catch (breachCheckError) {
        console.error(`[BANK_POSITIONS_TEST] Error checking allocation limits: ${breachCheckError.message}`);
      }

      // Log success
      const testLogMessage = unmappedPositions > 0
        ? `TEST: Processed ${totalRecords} positions: ${newRecords} new, ${updatedRecords} updated, ${unchangedRecords} unchanged, ${unmappedPositions} skipped (unmapped)`
        : `TEST: Processed ${totalRecords} positions: ${newRecords} new, ${updatedRecords} updated, ${unchangedRecords} unchanged`;

      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId: 'TEST',
        bankId: 'TEST_JULIUS_BAER',
        connectionName: 'Julius Baer Test',
        action: 'test_process_positions',
        status: 'success',
        message: testLogMessage,
        metadata: {
          filename,
          fileDate: fileDate.toISOString(),
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          unmappedPositions,
          unmappedPortfolioCodes: unmappedPositions > 0 ? Array.from(unmappedPortfolioCodes) : undefined,
          errors: errors.length > 0 ? errors : undefined
        },
        userId: user._id
      });

      if (unmappedPositions > 0) {
        console.log(
          `[BANK_POSITIONS_TEST] WARNING: ${unmappedPositions} positions skipped due to unmapped portfolio codes: ${Array.from(unmappedPortfolioCodes).join(', ')}`
        );
      }

      console.log(
        `[BANK_POSITIONS_TEST] Processing complete: ` +
        `${newRecords} new, ${updatedRecords} updated, ${unchangedRecords} unchanged, ${skippedRecords} skipped`
      );

      // AUTO-LINK holdings to products and allocations
      console.log(`[PMS_AUTO_LINK_TEST] Starting auto-linking for bankId=TEST_JULIUS_BAER, fileDate=${fileDate.toISOString()}`);
      try {
        const linkingResult = await Meteor.callAsync('pmsHoldings.autoLinkOnImport', {
          bankId: 'TEST_JULIUS_BAER',
          fileDate
        });

        if (linkingResult.success) {
          console.log(
            `[PMS_AUTO_LINK_TEST] Auto-linking complete: ` +
            `${linkingResult.linked} linked, ${linkingResult.noMatch} no match, ${linkingResult.failed} failed`
          );

          // Log auto-linking summary
          await BankConnectionLogHelpers.logConnectionAttempt({
            connectionId: 'TEST',
            bankId: 'TEST_JULIUS_BAER',
            connectionName: 'Julius Baer Test',
            action: 'auto_link_holdings',
            status: 'success',
            message: `Auto-linked ${linkingResult.linked} holdings to products/allocations`,
            metadata: {
              totalHoldings: linkingResult.total,
              linked: linkingResult.linked,
              noMatch: linkingResult.noMatch,
              failed: linkingResult.failed,
              fileDate: fileDate.toISOString()
            },
            userId: user._id
          });
        }
      } catch (linkingError) {
        console.error(`[PMS_AUTO_LINK_TEST] Auto-linking failed: ${linkingError.message}`);
        // Don't fail the import - linking can be done manually later
        await BankConnectionLogHelpers.logConnectionAttempt({
          connectionId: 'TEST',
          bankId: 'TEST_JULIUS_BAER',
          connectionName: 'Julius Baer Test',
          action: 'auto_link_holdings',
          status: 'failed',
          error: linkingError.message,
          userId: user._id
        });
      }

      // ALSO PROCESS OPERATIONS
      console.log(`[BANK_OPERATIONS_TEST] Processing operations from same directory`);

      let operationsResult = { totalRecords: 0, newRecords: 0, updatedRecords: 0, skippedRecords: 0, unmappedOperations: 0 };

      try {
        const operationsParseResult = BankOperationParser.parseLatestFile(bankFolderPath, {
          bankId: 'TEST_JULIUS_BAER',
          bankName: 'Julius Baer (Test)',
          userId: null  // Will be matched to bank accounts
        });

        if (!operationsParseResult.error && operationsParseResult.operations) {
          const { operations, filename: opFilename } = operationsParseResult;
          console.log(`[BANK_OPERATIONS_TEST] Parsed ${operations.length} operations from ${opFilename}`);

          let opNew = 0;
          let opUpdated = 0;
          let opSkipped = 0;
          let opUnmapped = 0;
          const opUnmappedPortfolioCodes = new Set();

          for (const operation of operations) {
            try {
              // Match portfolio code to bank account to find userId
              const userId = await findUserIdForPortfolioCode(operation.portfolioCode, 'TEST_JULIUS_BAER');

              if (!userId) {
                // Skip operations without matching account
                console.log(`[BANK_OPERATIONS_TEST] Skipping unmapped operation: portfolio=${operation.portfolioCode}, type=${operation.operationType}`);
                opUnmappedPortfolioCodes.add(operation.portfolioCode);
                opUnmapped++;
                opSkipped++;
                continue;
              }

              // Set the matched userId
              operation.userId = userId;

              operation.connectionId = 'TEST';
              operation.sourceFilePath = path.join(bankFolderPath, opFilename);

              const result = await PMSOperationsHelpers.upsertOperation(operation);

              if (result.updated) {
                opUpdated++;
              } else {
                opNew++;
              }
            } catch (error) {
              console.error(`[BANK_OPERATIONS_TEST] Error saving operation: ${error.message}`);
              opSkipped++;
            }
          }

          operationsResult = {
            totalRecords: operations.length,
            newRecords: opNew,
            updatedRecords: opUpdated,
            skippedRecords: opSkipped,
            unmappedOperations: opUnmapped,
            unmappedPortfolioCodes: opUnmapped > 0 ? Array.from(opUnmappedPortfolioCodes) : undefined,
            filename: opFilename
          };

          if (opUnmapped > 0) {
            console.log(
              `[BANK_OPERATIONS_TEST] WARNING: ${opUnmapped} operations skipped due to unmapped portfolio codes: ${Array.from(opUnmappedPortfolioCodes).join(', ')}`
            );
          }

          console.log(
            `[BANK_OPERATIONS_TEST] Operations complete: ` +
            `${opNew} new, ${opUpdated} updated, ${opSkipped} skipped`
          );
        } else {
          console.log(`[BANK_OPERATIONS_TEST] No operations file found or parse error`);
        }
      } catch (opError) {
        console.error(`[BANK_OPERATIONS_TEST] Operations processing error: ${opError.message}`);
      }

      return {
        success: true,
        positions: {
          filename,
          fileDate,
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          errors
        },
        operations: operationsResult
      };

    } catch (error) {
      console.error(`[BANK_POSITIONS_TEST] Processing failed: ${error.message}`);

      // Log failure
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId: 'TEST',
        bankId: 'TEST_JULIUS_BAER',
        connectionName: 'Julius Baer Test',
        action: 'test_process_positions',
        status: 'failed',
        error: error.message,
        userId: user._id
      });

      throw new Meteor.Error('processing-failed', error.message);
    }
  },

  /**
   * Get dates that have PMSHoldings data but no corresponding portfolioSnapshot
   * Used to detect missing snapshots that need to be regenerated
   */
  async 'bankPositions.getMissingSnapshotDates'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);

    const user = await validateAdminSession(sessionId);

    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    console.log(`[MISSING_SNAPSHOTS] Checking for missing snapshots for connection: ${connection.connectionName}`);

    // Get all unique snapshotDates from PMSHoldings for this bank
    // Group by userId and portfolioCode to match snapshot structure
    const holdingsDates = await PMSHoldingsCollection.rawCollection().aggregate([
      {
        $match: {
          bankId: connection.bankId,
          isLatest: true,  // Only check current versions
          userId: { $exists: true, $ne: null }  // Must have a mapped user
        }
      },
      {
        $group: {
          _id: {
            userId: '$userId',
            portfolioCode: '$portfolioCode',
            snapshotDate: {
              $dateToString: { format: '%Y-%m-%d', date: '$snapshotDate' }
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.snapshotDate': 1 }
      }
    ]).toArray();

    console.log(`[MISSING_SNAPSHOTS] Found ${holdingsDates.length} unique (user, portfolio, date) combinations in PMSHoldings`);

    // Get all existing snapshot dates
    const existingSnapshots = await PortfolioSnapshotsCollection.rawCollection().aggregate([
      {
        $match: {
          bankId: connection.bankId
        }
      },
      {
        $group: {
          _id: {
            userId: '$userId',
            portfolioCode: '$portfolioCode',
            snapshotDate: {
              $dateToString: { format: '%Y-%m-%d', date: '$snapshotDate' }
            }
          }
        }
      }
    ]).toArray();

    // Create a set of existing snapshot keys for fast lookup
    const existingKeys = new Set(
      existingSnapshots.map(s => `${s._id.userId}|${s._id.portfolioCode}|${s._id.snapshotDate}`)
    );

    console.log(`[MISSING_SNAPSHOTS] Found ${existingKeys.size} existing snapshots`);

    // Find missing combinations
    const missingDates = holdingsDates
      .filter(h => !existingKeys.has(`${h._id.userId}|${h._id.portfolioCode}|${h._id.snapshotDate}`))
      .map(h => ({
        userId: h._id.userId,
        portfolioCode: h._id.portfolioCode,
        snapshotDate: h._id.snapshotDate,
        holdingsCount: h.count
      }));

    console.log(`[MISSING_SNAPSHOTS] Found ${missingDates.length} missing snapshot dates`);

    return {
      success: true,
      bankId: connection.bankId,
      totalHoldingsDates: holdingsDates.length,
      existingSnapshots: existingKeys.size,
      missingDates
    };
  },

  /**
   * Regenerate portfolio snapshots for dates that have PMSHoldings but no snapshot
   * This repairs gaps in the performance chart
   */
  async 'bankPositions.regenerateMissingSnapshots'({ connectionId, sessionId, maxDates = 30 }) {
    check(connectionId, String);
    check(sessionId, String);
    check(maxDates, Match.Maybe(Number));

    const user = await validateAdminSession(sessionId);

    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    // Get missing snapshot dates
    const { missingDates } = await Meteor.callAsync('bankPositions.getMissingSnapshotDates', {
      connectionId,
      sessionId
    });

    if (missingDates.length === 0) {
      console.log(`[REGENERATE_SNAPSHOTS] No missing snapshots to regenerate`);
      return {
        success: true,
        regenerated: 0,
        message: 'No missing snapshots'
      };
    }

    // Sort by date to process chronologically
    missingDates.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

    // Limit the number of dates to process
    const datesToProcess = missingDates.slice(0, maxDates);

    console.log(`[REGENERATE_SNAPSHOTS] Regenerating ${datesToProcess.length} missing snapshots (of ${missingDates.length} total)`);

    let regenerated = 0;
    const errors = [];

    for (const missing of datesToProcess) {
      try {
        // Parse the date string back to a Date object
        const snapshotDate = new Date(missing.snapshotDate + 'T00:00:00.000Z');

        // Get all holdings for this user/portfolio/date
        const startOfDay = new Date(snapshotDate);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(snapshotDate);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const holdings = await PMSHoldingsCollection.find({
          bankId: connection.bankId,
          userId: missing.userId,
          portfolioCode: missing.portfolioCode,
          snapshotDate: { $gte: startOfDay, $lte: endOfDay }
        }).fetchAsync();

        if (holdings.length === 0) {
          console.log(`[REGENERATE_SNAPSHOTS] No holdings found for ${missing.portfolioCode} on ${missing.snapshotDate}, skipping`);
          continue;
        }

        // Get account info
        const accountNumber = holdings[0]?.accountNumber || null;

        // Create the snapshot
        await PortfolioSnapshotHelpers.createSnapshot({
          userId: missing.userId,
          bankId: connection.bankId,
          bankName: bank.name,
          connectionId,
          portfolioCode: missing.portfolioCode,
          accountNumber,
          snapshotDate,
          fileDate: holdings[0]?.fileDate || snapshotDate,
          sourceFile: `regenerated_from_holdings_${missing.snapshotDate}`,
          holdings
        });

        regenerated++;
        console.log(`[REGENERATE_SNAPSHOTS] Regenerated snapshot for ${missing.portfolioCode} on ${missing.snapshotDate}`);

      } catch (error) {
        console.error(`[REGENERATE_SNAPSHOTS] Error regenerating snapshot for ${missing.portfolioCode} on ${missing.snapshotDate}: ${error.message}`);
        errors.push({
          portfolioCode: missing.portfolioCode,
          snapshotDate: missing.snapshotDate,
          error: error.message
        });
      }
    }

    console.log(`[REGENERATE_SNAPSHOTS] Complete: ${regenerated} regenerated, ${errors.length} errors`);

    return {
      success: true,
      regenerated,
      errors,
      remaining: missingDates.length - datesToProcess.length
    };
  }
});
