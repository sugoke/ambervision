// /server/methods/updateProducts.js
import { Meteor } from 'meteor/meteor';
import { Products } from '/imports/api/products/products.js'; // Adjust the import path as necessary
import { Historical } from '/imports/api/products/products.js'; // Adjust the import path as necessary
import { HTTP } from 'meteor/http';
import { Random } from 'meteor/random';
import { check } from 'meteor/check';
import { Match } from 'meteor/check';
import { Mongo } from 'meteor/mongo';

import { Holdings } from '/imports/api/products/products.js';

Meteor.methods({
  'validateProductForm'(formData) {
    check(formData, {
      isin: String,
      mode: String
    });

    const errors = [];

    // Check if ISIN already exists when in newProduct mode
    if (formData.mode === 'newProduct') {
      const existingProduct = Products.findOne({
        $or: [
          { "genericData.ISINCode": formData.isin },
          { "ISINCode": formData.isin }
        ]
      });

      if (existingProduct) {
        errors.push({
          field: 'isin',
          message: 'This ISIN already exists'
        });
      }
    }

    // Validate ISIN format (12 characters, alphanumeric)
    if (!/^[A-Z0-9]{12}$/.test(formData.isin)) {
      errors.push({
        field: 'isin',
        message: 'ISIN must be 12 characters long and contain only letters and numbers'
      });
    }

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  },

  'insertProduct'(productData) {
    try {
      // Validate user
      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to insert a product');
      }

      // Log incoming data
      console.log('Attempting to insert product with ISIN:', productData.genericData?.ISINCode);

      // Validate ISIN
      const validationResult = Meteor.call('validateProductForm', {
        isin: productData.genericData?.ISINCode || productData.ISINCode,
        mode: 'newProduct'
      });

      if (!validationResult.isValid) {
        throw new Meteor.Error('validation-error', validationResult.errors[0].message);
      }

      // Ensure required structures exist
      productData.status = productData.status || 'pending';
      productData.features = productData.features || {};
      productData.underlyings = productData.underlyings || [];
      productData.observationDates = productData.observationDates || [];

      // Clean and validate underlyings
      productData.underlyings = productData.underlyings.map(underlying => ({
        name: underlying.name || '',
        ticker: underlying.ticker || '',
        exchange: underlying.exchange || '',
        country: underlying.country || '',
        currency: underlying.currency || '',
        initialReferenceLevel: parseFloat(underlying.initialReferenceLevel) || null,
        eodTicker: underlying.eodTicker || '',
        lastPriceInfo: underlying.lastPriceInfo || {
          price: null,
          performance: null,
          distanceToBarrier: null,
          date: null,
          isWorstOf: false
        }
      }));

      // Clean and validate observation dates
      productData.observationDates = productData.observationDates.map(obs => ({
        observationDate: obs.observationDate || null,
        paymentDate: obs.paymentDate || null,
        couponBarrierLevel: parseFloat(obs.couponBarrierLevel) || null,
        autocallLevel: parseFloat(obs.autocallLevel) || null,
        couponPerPeriod: parseFloat(obs.couponPerPeriod) || null
      }));

      // Clean features object
      Object.keys(productData.features).forEach(key => {
        if (typeof productData.features[key] === 'string' && !isNaN(productData.features[key])) {
          productData.features[key] = parseFloat(productData.features[key]);
        }
      });

      console.log('Cleaned product data:', JSON.stringify(productData, null, 2));

      // Insert with error catching
      try {
        const productId = Products.insert(productData);
        console.log('Product inserted successfully with ID:', productId);
        return productId;
      } catch (dbError) {
        console.error('Database insertion error:', dbError);
        throw new Meteor.Error('db-error', 'Failed to insert product into database', dbError);
      }

    } catch (error) {
      console.error('Product insertion error:', error);
      throw new Meteor.Error(
        error.error || 'insert-failed',
        error.reason || 'Failed to insert product',
        error.details
      );
    }
  },

  'testDatabaseConnection'() {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized');
    }
    
    try {
      // Test read
      const count = Products.find().count();
      
      // Test write
      const testId = Products.insert({
        test: true,
        timestamp: new Date()
      });
      
      // Clean up
      Products.remove({ _id: testId });
      
      return {
        success: true,
        count,
        mongoUrl: process.env.MONGO_URL.replace(/:[^:\/]+@/, ':****@')
      };
    } catch (error) {
      throw new Meteor.Error('db-error', error.message);
    }
  }
});