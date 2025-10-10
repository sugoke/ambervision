import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';

// Product Prices collection for storing historical price data by ISIN
export const ProductPricesCollection = new Mongo.Collection('productPrices');

// Product price schema structure:
// {
//   isin: String (e.g., "CH0012345678"),
//   price: Number (latest price),
//   currency: String (price currency, e.g., "USD", "EUR"),
//   priceDate: Date (date of the price),
//   uploadDate: Date (when this record was uploaded),
//   uploadedBy: String (userId of who uploaded),
//   source: String (filename or source identifier),
//   isActive: Boolean (for soft delete),
//   metadata: Object (additional data like volume, market, etc.)
// }

// Helper functions for product price management
export const ProductPriceHelpers = {
  // Get latest price for an ISIN
  async getLatestPrice(isin) {
    check(isin, String);
    return await ProductPricesCollection.findOneAsync(
      { isin: isin.toUpperCase(), isActive: true },
      { sort: { priceDate: -1, uploadDate: -1 } }
    );
  },

  // Get price history for an ISIN
  getPriceHistory(isin, limit = 50) {
    check(isin, String);
    check(limit, Number);
    return ProductPricesCollection.find(
      { isin: isin.toUpperCase(), isActive: true },
      { sort: { priceDate: -1, uploadDate: -1 }, limit }
    );
  },

  // Get prices for a specific date range
  getPricesInDateRange(isin, startDate, endDate) {
    check(isin, String);
    check(startDate, Date);
    check(endDate, Date);
    
    return ProductPricesCollection.find({
      isin: isin.toUpperCase(),
      priceDate: { $gte: startDate, $lte: endDate },
      isActive: true
    }, { sort: { priceDate: -1 } });
  },

  // Bulk insert prices from upload
  async bulkInsertPrices(pricesData, uploadedBy, source) {
    check(pricesData, Array);
    check(uploadedBy, String);
    check(source, String);

    const insertPromises = pricesData.map(async (priceData) => {
      const {
        isin,
        price,
        currency = 'USD',
        priceDate,
        metadata = {}
      } = priceData;

      // Validate required fields
      if (!isin || price === undefined || !priceDate) {
        throw new Error(`Invalid price data: missing required fields for ${isin}`);
      }

      // Check if exact same price already exists (avoid duplicates)
      const existingPrice = ProductPricesCollection.findOne({
        isin: isin.toUpperCase(),
        price: parseFloat(price),
        priceDate: new Date(priceDate),
        isActive: true
      });

      if (existingPrice) {
        return null; // Skip duplicate
      }

      return await ProductPricesCollection.insertAsync({
        isin: isin.toUpperCase(),
        price: parseFloat(price),
        currency: currency.toUpperCase(),
        priceDate: new Date(priceDate),
        uploadDate: new Date(),
        uploadedBy,
        source,
        isActive: true,
        metadata
      });
    });

    const results = await Promise.all(insertPromises);
    return results.filter(Boolean); // Remove null values (duplicates)
  },

  // Get all unique ISINs with their latest prices
  async getAllLatestPrices() {
    const pipeline = [
      { $match: { isActive: true } },
      { $sort: { isin: 1, priceDate: -1, uploadDate: -1 } },
      {
        $group: {
          _id: '$isin',
          latestPrice: { $first: '$price' },
          currency: { $first: '$currency' },
          priceDate: { $first: '$priceDate' },
          uploadDate: { $first: '$uploadDate' },
          source: { $first: '$source' }
        }
      },
      { $sort: { _id: 1 } }
    ];

    return ProductPricesCollection.rawCollection().aggregate(pipeline).toArray();
  },

  // Get upload statistics
  async getUploadStats(uploadedBy = null, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const matchQuery = {
      uploadDate: { $gte: startDate },
      isActive: true
    };

    if (uploadedBy) {
      matchQuery.uploadedBy = uploadedBy;
    }

    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$uploadDate' } },
            source: '$source'
          },
          count: { $sum: 1 },
          uniqueIsins: { $addToSet: '$isin' }
        }
      },
      {
        $project: {
          date: '$_id.date',
          source: '$_id.source',
          count: 1,
          uniqueIsins: { $size: '$uniqueIsins' }
        }
      },
      { $sort: { date: -1, source: 1 } }
    ];

    return ProductPricesCollection.rawCollection().aggregate(pipeline).toArray();
  },

  // Validate ISIN format (basic validation)
  isValidISIN(isin) {
    if (!isin || typeof isin !== 'string') return false;
    
    // Basic ISIN format: 2 letter country code + 9 alphanumeric + 1 check digit
    const isinRegex = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
    return isinRegex.test(isin.toUpperCase());
  },

  // Parse and validate price data from upload
  validatePriceData(rawData) {
    const errors = [];
    const validData = [];

    rawData.forEach((row, index) => {
      const rowNum = index + 1;
      
      try {
        const {
          isin,
          price,
          currency = 'USD',
          priceDate,
          ...metadata
        } = row;

        // Validate ISIN
        if (!this.isValidISIN(isin)) {
          errors.push(`Row ${rowNum}: Invalid ISIN format '${isin}'`);
          return;
        }

        // Validate price
        const numPrice = parseFloat(price);
        if (isNaN(numPrice) || numPrice <= 0) {
          errors.push(`Row ${rowNum}: Invalid price '${price}' for ISIN ${isin}`);
          return;
        }

        // Validate date
        const parsedDate = new Date(priceDate);
        if (isNaN(parsedDate.getTime())) {
          errors.push(`Row ${rowNum}: Invalid date '${priceDate}' for ISIN ${isin}`);
          return;
        }

        // Check if date is in the future
        if (parsedDate > new Date()) {
          errors.push(`Row ${rowNum}: Future date '${priceDate}' not allowed for ISIN ${isin}`);
          return;
        }

        validData.push({
          isin: isin.toUpperCase(),
          price: numPrice,
          currency: currency.toUpperCase(),
          priceDate: parsedDate,
          metadata
        });

      } catch (error) {
        errors.push(`Row ${rowNum}: Error processing data - ${error.message}`);
      }
    });

    return { validData, errors };
  },

  // Process simple CSV upload (ISIN, Price format)
  async processSimpleCsvUpload(csvData, uploadedBy, batchId) {
    const results = {
      processed: 0,
      updated: 0,
      inserted: 0,
      errors: [],
      batchId: batchId
    };

    try {

      for (let i = 0; i < csvData.length; i++) {
        const row = csvData[i];
        
        try {
          // Handle both object format and array format
          let isin, price;
          
          if (Array.isArray(row)) {
            // Array format: [isin, price]
            isin = row[0];
            price = row[1];
          } else {
            // Object format: {isin: "XX123", price: 102}
            isin = row.isin || row.ISIN || row[Object.keys(row)[0]]; // First column
            price = row.price || row.Price || row[Object.keys(row)[1]]; // Second column
          }

          // Validate ISIN
          if (!isin || typeof isin !== 'string') {
            results.errors.push({
              row: i + 1,
              error: 'Missing or invalid ISIN',
              data: row
            });
            continue;
          }

          const cleanIsin = isin.toString().trim().toUpperCase();
          if (!cleanIsin) {
            results.errors.push({
              row: i + 1,
              error: 'Empty ISIN',
              data: row
            });
            continue;
          }

          // Validate price
          const numPrice = parseFloat(price);
          if (isNaN(numPrice) || numPrice < 0) {
            results.errors.push({
              row: i + 1,
              error: `Invalid price: ${price}`,
              data: row
            });
            continue;
          }

          // Check if exact same price already exists for today
          const today = new Date();
          today.setHours(0, 0, 0, 0); // Start of today
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1); // Start of tomorrow
          
          const existingTodayRecord = await ProductPricesCollection.findOneAsync({ 
            isin: cleanIsin,
            priceDate: { $gte: today, $lt: tomorrow },
            isActive: true 
          });
          
          const priceData = {
            isin: cleanIsin,
            price: numPrice,
            currency: 'USD', // Default currency for simple uploads
            priceDate: new Date(), // Current date for simple uploads
            uploadDate: new Date(),
            uploadedBy: uploadedBy,
            source: `csv_upload_${batchId}`,
            isActive: true,
            metadata: {
              batchId: batchId,
              uploadType: 'simple_csv'
            }
          };

          if (existingTodayRecord) {
            // Update today's price record (don't create duplicate for same day)
            await ProductPricesCollection.updateAsync(existingTodayRecord._id, {
              $set: priceData
            });
            results.updated++;
          } else {
            // Insert new historical price record
            await ProductPricesCollection.insertAsync(priceData);
            results.inserted++;
          }

          results.processed++;

        } catch (rowError) {
          results.errors.push({
            row: i + 1,
            error: rowError.message,
            data: row
          });
        }
      }

      
      return results;

    } catch (error) {
      throw new Meteor.Error('csv-processing-failed', `Failed to process CSV: ${error.message}`);
    }
  },

  // Get latest price for ISIN (updated for async)
  async getLatestPriceAsync(isin) {
    check(isin, String);
    return await ProductPricesCollection.findOneAsync(
      { isin: isin.toUpperCase(), isActive: true },
      { sort: { priceDate: -1, uploadDate: -1 } }
    );
  },

  // Get multiple latest prices
  async getLatestPricesAsync(isins) {
    check(isins, [String]);
    
    const priceRecords = await ProductPricesCollection.find({
      isin: { $in: isins.map(isin => isin.toUpperCase()) },
      isActive: true
    }).fetchAsync();
    
    // Group by ISIN and get latest price for each
    const priceMap = new Map();
    priceRecords.forEach(record => {
      const existing = priceMap.get(record.isin);
      if (!existing || record.priceDate > existing.priceDate || 
          (record.priceDate.getTime() === existing.priceDate.getTime() && record.uploadDate > existing.uploadDate)) {
        priceMap.set(record.isin, record);
      }
    });
    
    return priceMap;
  },

  // Deactivate old prices (soft delete)
  async deactivatePrices(query) {
    return await ProductPricesCollection.updateAsync(query, {
      $set: {
        isActive: false,
        deactivatedAt: new Date()
      }
    }, { multi: true });
  }
};

// Server-side methods
if (Meteor.isServer) {
  Meteor.methods({
    // Upload simple CSV with ISIN and Price columns
    async 'productPrices.uploadSimpleCsv'(csvData, sessionId) {
      check(csvData, [Match.Any]); // Can be array of arrays or array of objects
      check(sessionId, String);

      // Authenticate user - only admin/superadmin can upload prices
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
        throw new Meteor.Error('access-denied', 'Admin privileges required for price uploads');
      }


      try {
        // Generate batch ID
        const batchId = `SIMPLE_${Date.now()}_${currentUser._id}`;
        
        // Process CSV data
        const results = await ProductPriceHelpers.processSimpleCsvUpload(csvData, currentUser._id, batchId);
        
        return {
          success: true,
          message: `Successfully processed ${results.processed} price records`,
          batchId: results.batchId,
          stats: {
            processed: results.processed,
            updated: results.updated,
            inserted: results.inserted,
            errors: results.errors.length
          },
          errors: results.errors.slice(0, 10) // Limit error details in response
        };

      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    },

    // Get current price for a product by ISIN
    async 'productPrices.getCurrentPrice'(isin) {
      check(isin, String);
      
      try {
        const priceRecord = await ProductPriceHelpers.getLatestPriceAsync(isin);
        return priceRecord ? priceRecord.price : null;
      } catch (error) {
        return null;
      }
    },

    // Get current prices for multiple ISINs
    async 'productPrices.getCurrentPrices'(isins) {
      check(isins, [String]);
      
      try {
        const priceMap = await ProductPriceHelpers.getLatestPricesAsync(isins);
        
        // Convert map to simple object for client
        const pricesObj = {};
        priceMap.forEach((record, isin) => {
          pricesObj[isin] = record.price;
        });
        
        return pricesObj;
      } catch (error) {
        return {};
      }
    },

    // Get price history for a specific ISIN
    async 'productPrices.getPriceHistory'(isin, limit = 30) {
      check(isin, String);
      check(limit, Number);
      
      try {
        const priceHistory = await ProductPricesCollection.find({
          isin: isin.toUpperCase(),
          isActive: true
        }, {
          sort: { priceDate: -1, uploadDate: -1 },
          limit: limit
        }).fetchAsync();
        
        return priceHistory.map(record => ({
          price: record.price,
          priceDate: record.priceDate,
          uploadDate: record.uploadDate,
          source: record.metadata?.uploadType || 'csv_upload'
        }));
      } catch (error) {
        return [];
      }
    },

    // Get upload statistics for admin dashboard
    async 'productPrices.getUploadStats'(sessionId) {
      check(sessionId, String);

      // Authenticate user
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
        throw new Meteor.Error('access-denied', 'Admin privileges required to view upload stats');
      }

      try {
        const totalPrices = await ProductPricesCollection.find({ isActive: true }).countAsync();
        const recentUploads = await ProductPricesCollection.find({
          uploadDate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
          isActive: true
        }).countAsync();
        
        const latestUpload = await ProductPricesCollection.findOneAsync(
          { isActive: true }, 
          { sort: { uploadDate: -1 } }
        );

        // Get unique ISINs count
        const uniqueIsins = await ProductPricesCollection.rawCollection().distinct('isin', { isActive: true });
        
        return {
          totalPrices,
          uniqueIsins: uniqueIsins.length,
          recentUploads,
          latestUpload: latestUpload ? {
            uploadDate: latestUpload.uploadDate,
            batchId: latestUpload.metadata?.batchId,
            uploadType: latestUpload.metadata?.uploadType
          } : null
        };
      } catch (error) {
        return {
          totalPrices: 0,
          uniqueIsins: 0,
          recentUploads: 0,
          latestUpload: null
        };
      }
    },

    // Clear all prices (superadmin only)
    async 'productPrices.clearAll'(sessionId) {
      check(sessionId, String);

      // Authenticate user - only superadmin
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || currentUser.role !== 'superadmin') {
        throw new Meteor.Error('access-denied', 'Superadmin privileges required to clear all prices');
      }

      try {
        const deactivatedCount = await ProductPriceHelpers.deactivatePrices({ isActive: true });
        
        return {
          success: true,
          message: `Deactivated ${deactivatedCount} price records`,
          deactivatedCount
        };
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }
  });

  // Publish product prices to authenticated users
  Meteor.publish('productPrices', function(sessionId) {
    check(sessionId, Match.Optional(String));
    
    if (sessionId) {
      // Publish only active prices
      return ProductPricesCollection.find({ isActive: true });
    }
    
    return this.ready();
  });
};