import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import fs from 'fs';
import {
  TERMSHEET_SOURCES,
  getTermsheetsDir,
  resolveProjectRoot,
  resolveTermsheetPath,
  buildTermsheetFilename,
  termsheetUrl,
  termsheetFilenameFromUrl,
  writeTermsheetFile,
  deleteTermsheetFile
} from './documentStorage';

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
    // Mint a single-use capability token for a product's stored term sheet.
    // Term sheets are product documents (not client PII), so any authenticated
    // user may fetch one — but the /termsheets endpoint now requires the token,
    // closing the previous anonymous access.
    async 'products.getTermSheetUrl'(productId, sessionId) {
      check(productId, String);
      check(sessionId, String);

      const user = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!user) throw new Meteor.Error('not-authorized', 'You must be logged in');

      const product = await ProductsCollection.findOneAsync(productId);
      if (!product?.termSheet?.url) throw new Meteor.Error('not-found', 'No term sheet for this product');

      const storedUrl = String(product.termSheet.url);
      const filePath = storedUrl.split('?')[0]; // token binds to the exact path

      // A term-sheet record is not proof the PDF is in the store. Minting a
      // token regardless made every missing file look like a working download
      // that opened a blank tab reading "Termsheet not found" — say so here
      // instead, so the caller can report it and the record can be fixed.
      if (!resolveTermsheetPath(termsheetFilenameFromUrl(storedUrl))) {
        console.error(`[TermSheet] Record points at a file that is not in the store: ${storedUrl} (product ${productId})`);
        throw new Meteor.Error(
          'termsheet-file-missing',
          'The term sheet is recorded for this product but its file is missing from the store. Please re-upload it.'
        );
      }

      const { issueDocumentToken } = await import('/server/documentAccess.js');
      const token = await issueDocumentToken(filePath, user._id);
      return `${filePath}?dl=${token}`;
    },

    /**
     * The term sheet already on file for an ISIN, for the order book.
     *
     * Placing a structured-product order requires the termsheet PDF, which for a
     * product already in the system is the same document the product report
     * serves. Rather than making the desk find and re-upload it, the order modal
     * looks it up here and attaches the stored copy as the order's evidence.
     *
     * Called twice: without `includeData` to show what is on file, then with it
     * to pull the bytes at submit time.
     */
    /**
     * Ambervision product titles for a set of ISINs.
     *
     * The desk types a short label on an order ("Ph+"); the product record
     * carries the full name ("ENI/SHELL/TTE Phoenix Autocallable"). The order
     * book and validation panels show the latter when the ISIN is a product we
     * manage, so every screen reads the same name. Returns { [isin]: title }.
     */
    async 'products.getTitlesByIsins'(isins, sessionId) {
      check(isins, [String]);
      check(sessionId, String);

      const user = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!user) throw new Meteor.Error('not-authorized', 'You must be logged in');

      const unique = [...new Set(isins.map(i => String(i).trim()).filter(Boolean))].slice(0, 500);
      if (unique.length === 0) return {};
      const variants = [...new Set(unique.flatMap(i => [i, i.toUpperCase()]))];
      const products = await ProductsCollection.find(
        { isin: { $in: variants } },
        { fields: { isin: 1, title: 1 } }
      ).fetchAsync();
      const titles = {};
      for (const p of products) {
        if (!p.isin || !p.title) continue;
        titles[p.isin] = p.title;
        titles[p.isin.toUpperCase()] = p.title;
      }
      return titles;
    },

    async 'products.getTermSheetByIsin'(isin, sessionId, includeData = false) {
      check(isin, String);
      check(sessionId, String);
      check(includeData, Boolean);

      const user = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!user) throw new Meteor.Error('not-authorized', 'You must be logged in');

      const product = await ProductsCollection.findOneAsync({ isin });
      const filename = termsheetFilenameFromUrl(product?.termSheet?.url);
      if (!filename) return null;

      const filePath = resolveTermsheetPath(filename);
      if (!filePath) {
        // Metadata without the file: the product record points at a term sheet
        // that isn't on disk (restored DB, pre-volume upload). Report it as
        // absent so the order modal asks for an upload instead of silently
        // attaching nothing.
        console.warn(`[TermSheet] ${isin} references ${filename} but it is not on disk`);
        return null;
      }

      const result = {
        productId: product._id,
        productTitle: product.title || null,
        filename,
        originalFilename: product.termSheet.originalFilename || filename,
        uploadedAt: product.termSheet.uploadedAt || null,
        source: product.termSheet.source || null,
        sizeBytes: fs.statSync(filePath).size
      };

      if (includeData) {
        result.base64Data = fs.readFileSync(filePath).toString('base64');
      }

      return result;
    },

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

      // Same naming and same directory as every other writer — term-sheet
      // extraction at product creation, and promotion from an order's termsheet
      // evidence. See imports/api/documentStorage.js. This used to write to
      // public/termsheets/ in dev, which both diverged from the extractor and
      // tripped Meteor's file watcher (hot reload mid-upload).
      const sanitizedFilename = buildTermsheetFilename(product);

      // Replacing a term sheet stored under a different name (the product title
      // changed since, or the pre-2025 nested URL form) would orphan the old file.
      const previousFilename = termsheetFilenameFromUrl(product.termSheet?.url);
      if (previousFilename && previousFilename !== sanitizedFilename) {
        deleteTermsheetFile(previousFilename);
      }

      let storedPath;
      try {
        storedPath = writeTermsheetFile(sanitizedFilename, Buffer.from(base64Data, 'base64'));
      } catch (error) {
        console.error('Error writing term sheet file:', error);
        throw new Meteor.Error('file-system-error', 'Failed to save term sheet file');
      }

      const publicUrl = termsheetUrl(sanitizedFilename);

      // Update product document with term sheet metadata
      const updateResult = await ProductsCollection.updateAsync(productId, {
        $set: {
          termSheet: {
            url: publicUrl,
            filename: sanitizedFilename,
            originalFilename: filename,
            uploadedAt: new Date(),
            uploadedBy: user._id,
            source: TERMSHEET_SOURCES.MANUAL_UPLOAD
          }
        }
      });

      console.log(`[TermSheet] Uploaded for product ${productId} by ${user.email}: ${sanitizedFilename} (original: ${filename}) -> ${storedPath}`);

      return {
        success: true,
        url: publicUrl,
        filename: sanitizedFilename,
        updated: updateResult
      };
    },

    /**
     * Find products by underlying ticker
     * Used by MarketDataManager to link securities to their products
     */
    async 'products.findByUnderlying'(ticker, sessionId = null) {
      check(ticker, String);
      const { requireRole } = await import('/server/helpers/sessionAuth.js');
      const { STAFF_ROLES } = await import('/server/helpers/accessPolicy.js');
      await requireRole(sessionId, STAFF_ROLES);

      // Strip exchange suffix for matching (e.g., "AAPL.US" -> "AAPL"),
      // then escape it: the ticker is user input used inside a $regex.
      const baseTicker = String(ticker).split('.')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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