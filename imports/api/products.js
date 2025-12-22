import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import fs from 'fs';
import path from 'path';

export const ProductsCollection = new Mongo.Collection('products');

// Product schema structure:
// {
//   _id: String,
//   title: String,
//   isin: String,
//   templateId: String (phoenix, orion, himalaya, participation_note, etc.),
//   structureParameters: Object (protection barriers, autocall levels, coupons, etc.),
//   underlyings: Array of Objects,
//   tradeDate: Date,
//   maturityDate: Date,
//   issuer: String,
//   currency: String,
//   termSheet: Object (url, filename, uploadedAt, etc.),
//   createdBy: String,
//   createdAt: Date,
//
//   // Demo/Template Product Fields
//   isDemo: Boolean (default: false - marks product as demonstration/template),
//   requiresAllocation: Boolean (default: true - whether product must be allocated to appear in client views),
//   linkedBankHoldings: Number (cached count of bank holdings with this ISIN)
// }

if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Set or unset issuer call for a participation note
     * Admin/SuperAdmin only
     */
    async 'products.setIssuerCall'(productId, issuerCallData, sessionId) {
      check(productId, String);
      check(sessionId, String);

      // Authenticate user using custom session system
      const user = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!user) {
        throw new Meteor.Error('not-authorized', 'You must be logged in');
      }

      // Check if user is admin or superadmin
      if (user.role !== 'admin' && user.role !== 'superadmin') {
        throw new Meteor.Error('not-authorized', 'Only admins and superadmins can set issuer call');
      }

      // Validate product exists
      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) {
        throw new Meteor.Error('not-found', 'Product not found');
      }

      // Validate it's a participation note
      if (product.templateId !== 'participation_note') {
        throw new Meteor.Error('invalid-product', 'Only participation notes can have issuer calls set');
      }

      // Update product with issuer call data
      const updateFields = {};

      if (issuerCallData.hasCallOption) {
        // Set issuer call
        updateFields['structureParameters.issuerCallDate'] = issuerCallData.callDate;

        // Handle call price
        if (issuerCallData.callPrice) {
          updateFields['structureParameters.issuerCallPrice'] = parseFloat(issuerCallData.callPrice);
        } else {
          // Remove call price if not provided
          await ProductsCollection.updateAsync(productId, {
            $unset: { 'structureParameters.issuerCallPrice': '' }
          });
        }

        // Handle call rebate
        if (issuerCallData.callRebate) {
          updateFields['structureParameters.issuerCallRebate'] = parseFloat(issuerCallData.callRebate);
        } else {
          // Remove call rebate if not provided
          await ProductsCollection.updateAsync(productId, {
            $unset: { 'structureParameters.issuerCallRebate': '' }
          });
        }
      } else {
        // Remove issuer call
        await ProductsCollection.updateAsync(productId, {
          $unset: {
            'structureParameters.issuerCallDate': '',
            'structureParameters.issuerCallPrice': '',
            'structureParameters.issuerCallRebate': ''
          }
        });

        console.log(`🏦 Issuer call removed from product ${productId} by ${user.email}`);
        return { success: true, removed: true };
      }

      // Perform the update
      const result = await ProductsCollection.updateAsync(productId, {
        $set: updateFields
      });

      console.log(`🏦 Issuer call set for product ${productId} by ${user.email}:`, issuerCallData);

      return { success: true, updated: result };
    },

    /**
     * Upload term sheet PDF for a product
     * Admin/SuperAdmin only
     */
    async 'products.uploadTermSheet'(productId, base64Data, filename, sessionId) {
      check(productId, String);
      check(base64Data, String);
      check(filename, String);
      check(sessionId, String);

      // Authenticate user using custom session system
      const user = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!user) {
        throw new Meteor.Error('not-authorized', 'You must be logged in');
      }

      // Check if user is admin or superadmin
      if (user.role !== 'admin' && user.role !== 'superadmin') {
        throw new Meteor.Error('not-authorized', 'Only admins and superadmins can upload term sheets');
      }

      // Validate product exists
      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) {
        throw new Meteor.Error('not-found', 'Product not found');
      }

      // Validate file data
      if (!base64Data || !filename) {
        throw new Meteor.Error('invalid-data', 'File data and filename are required');
      }

      // Generate filename from ISIN and product title
      const isin = product.isin || 'NO_ISIN';
      const title = product.title || 'Untitled_Product';

      // Sanitize ISIN and title for filename - remove special characters, keep only alphanumeric, hyphens, underscores
      const sanitizedIsin = isin.replace(/[^a-zA-Z0-9_-]/g, '_');
      const sanitizedTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50); // Limit title length

      // Create filename: ISIN_Title.pdf
      const sanitizedFilename = `${sanitizedIsin}_${sanitizedTitle}.pdf`;

      // Create directory path for termsheets (flat structure - no product subdirectories)
      // Use environment variable in production (persistent volume), fallback to public/ in development
      let termsheetsDir;

      if (process.env.TERMSHEETS_PATH) {
        // Production: use persistent volume mount (flat structure)
        termsheetsDir = process.env.TERMSHEETS_PATH;
        console.log(`📁 Term sheet upload - Using persistent volume:`);
        console.log(`   TERMSHEETS_PATH: ${process.env.TERMSHEETS_PATH}`);
      } else {
        // Development: use public directory (flat structure)
        let projectRoot = process.cwd();
        if (projectRoot.includes('.meteor')) {
          projectRoot = projectRoot.split('.meteor')[0].replace(/[\\\/]$/, '');
        }
        const publicDir = path.join(projectRoot, 'public');
        termsheetsDir = path.join(publicDir, 'termsheets');
        console.log(`📁 Term sheet upload - Using public directory:`);
        console.log(`   Project root: ${projectRoot}`);
        console.log(`   Public dir: ${publicDir}`);
      }

      console.log(`   Termsheets dir: ${termsheetsDir}`);

      // Create directory if it doesn't exist
      try {
        if (!fs.existsSync(termsheetsDir)) {
          fs.mkdirSync(termsheetsDir, { recursive: true });
        }
      } catch (error) {
        console.error('Error creating directory:', error);
        throw new Meteor.Error('file-system-error', 'Failed to create directory structure');
      }

      // If there's an existing term sheet, delete the old file
      if (product.termSheet && product.termSheet.url) {
        // Extract filename from URL (handles both old /termsheets/{productId}/{filename} and new /termsheets/{filename} formats)
        const urlParts = product.termSheet.url.replace(/^\//, '').split('/');
        const oldFilename = urlParts[urlParts.length - 1]; // Always get last part (the actual filename)

        let oldFilePath;
        if (process.env.TERMSHEETS_PATH) {
          // Try new flat structure first
          oldFilePath = path.join(process.env.TERMSHEETS_PATH, oldFilename);

          // If not found, try old structure with product subdirectory (for migration compatibility)
          if (!fs.existsSync(oldFilePath) && urlParts.length === 3) {
            const oldProductId = urlParts[1];
            oldFilePath = path.join(process.env.TERMSHEETS_PATH, oldProductId, oldFilename);
          }
        } else {
          let projectRoot = process.cwd();
          if (projectRoot.includes('.meteor')) {
            projectRoot = projectRoot.split('.meteor')[0].replace(/[\\\/]$/, '');
          }
          const publicDir = path.join(projectRoot, 'public');
          oldFilePath = path.join(publicDir, product.termSheet.url.replace(/^\//, ''));
        }

        try {
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
            console.log(`🗑️ Deleted old term sheet: ${oldFilePath}`);
          }
        } catch (error) {
          console.error('Error deleting old term sheet:', error);
          // Continue anyway - don't fail the upload if we can't delete the old file
        }
      }

      // Save the new file (flat structure - directly in termsheets directory)
      const filePath = path.join(termsheetsDir, sanitizedFilename);
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(filePath, buffer);
        console.log(`📄 Term sheet saved to: ${filePath}`);
      } catch (error) {
        console.error('Error writing file:', error);
        throw new Meteor.Error('file-system-error', 'Failed to save term sheet file');
      }

      // Generate public URL (flat structure - no product subdirectory)
      const publicUrl = `/termsheets/${sanitizedFilename}`;

      // Update product document with term sheet metadata
      const updateResult = await ProductsCollection.updateAsync(productId, {
        $set: {
          termSheet: {
            url: publicUrl,
            filename: sanitizedFilename,
            originalFilename: filename,
            uploadedAt: new Date(),
            uploadedBy: user._id
          }
        }
      });

      console.log(`📄 Term sheet uploaded for product ${productId} by ${user.email}: ${sanitizedFilename} (original: ${filename})`);

      return {
        success: true,
        url: publicUrl,
        filename: sanitizedFilename,
        updated: updateResult
      };
    },

    /**
     * Debug method to check filesystem paths
     */
    'products.debugPaths'() {
      const cwd = process.cwd();
      const projectRoot = cwd.includes('.meteor') ? cwd.split('.meteor')[0].replace(/[\\\/]$/, '') : cwd;
      const publicDir = path.join(projectRoot, 'public');

      return {
        cwd,
        projectRoot,
        publicDir,
        publicExists: fs.existsSync(publicDir),
        publicContents: fs.existsSync(publicDir) ? fs.readdirSync(publicDir) : []
      };
    },

    /**
     * Find products by underlying ticker
     * Used by MarketDataManager to link securities to their products
     */
    async 'products.findByUnderlying'(ticker) {
      check(ticker, String);

      // Strip exchange suffix for matching (e.g., "AAPL.US" -> "AAPL")
      const baseTicker = ticker.split('.')[0];

      return await ProductsCollection.find({
        $or: [
          { 'underlyings.ticker': { $regex: baseTicker, $options: 'i' } },
          { 'underlyings.symbol': { $regex: baseTicker, $options: 'i' } },
          { 'underlyings.security.symbol': { $regex: baseTicker, $options: 'i' } }
        ]
      }, {
        fields: { _id: 1, title: 1, isin: 1, maturityDate: 1 }
      }).fetchAsync();
    }
  });
}