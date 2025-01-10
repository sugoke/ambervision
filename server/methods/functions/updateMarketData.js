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

    'updateMarketData': function() {
        console.log('Starting updateMarketData method');
        const apiKey = '5c265eab2c9066.19444326';
        const products = Products.find().fetch();
    
        console.log(`Found ${products.length} products`);
    
        // Create a map to store the earliest trade date for each eodTicker
        const earliestTradeDates = {};
    
        // First pass: Find the earliest trade date for each eodTicker
        products.forEach(product => {
          const tradeDate = product.genericData?.tradeDate;
          if (!tradeDate) {
            console.warn(`Skipping product with missing tradeDate: ${product._id}`);
            return;
          }

          product.underlyings.forEach(underlying => {
            const eodTicker = underlying.eodTicker;
            if (!eodTicker) {
              console.warn(`Skipping underlying with missing eodTicker in product: ${product._id}`);
              return;
            }

            if (!earliestTradeDates[eodTicker] || new Date(tradeDate) < new Date(earliestTradeDates[eodTicker])) {
              earliestTradeDates[eodTicker] = tradeDate;
            }
          });
        });
    
        console.log('Earliest trade dates for each eodTicker:', earliestTradeDates);
    
        // Create a Set to keep track of processed tickers
        const processedTickers = new Set();
    
        products.forEach(product => {
          const underlyings = product.underlyings;
          console.log(`Processing product with ISINCode: ${product.genericData.ISINCode} and underlyings: ${underlyings.map(u => u.eodTicker).join(', ')}`);
    
          underlyings.forEach(underlying => {
            const eodTicker = underlying.eodTicker;
    
            if (!eodTicker || processedTickers.has(eodTicker)) {
              console.log(`Skipping already processed or invalid ticker: ${eodTicker}`);
              return;
            }
    
            processedTickers.add(eodTicker);
    
            const historicalData = Historical.findOne({ eodTicker }, { sort: { 'data.date': -1 } });
    
            // Use the earliest trade date for this eodTicker
            const startDate = earliestTradeDates[eodTicker];
            const currentDate = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
    
            console.log(`Logic for start date of ${eodTicker}:`);
            console.log(`  - Earliest trade date from products: ${startDate}`);
            console.log(`  - Latest date in historical data: ${historicalData ? historicalData.data[0].date : 'No historical data'}`);
            console.log(`  - Current date: ${currentDate}`);
            console.log(`  - Chosen start date: ${startDate}`);
    
            console.log(`Fetching data for ticker: ${eodTicker} from date: ${startDate} to ${currentDate}`);
    
            const url = `https://eodhd.com/api/eod/${eodTicker}?api_token=${apiKey}&from=${startDate}&to=${currentDate}&fmt=json`;
            try {
              const response = HTTP.get(url);
              const newData = response.data;
    
              if (!newData || !Array.isArray(newData)) {
                console.error(`Invalid data received for ${eodTicker}:`, response);
                return;
              }
    
              // Filter out data points that are already in the database
              const existingDates = new Set(historicalData ? historicalData.data.map(d => d.date) : []);
              const filteredData = newData.filter(dataPoint => !existingDates.has(dataPoint.date));
    
              console.log(`Received ${filteredData.length} new data points for ticker: ${eodTicker}`);
    
              if (filteredData.length > 0) {
                // Extract all necessary fields and validate data points
                const processedData = filteredData
                  .filter(dataPoint => dataPoint && dataPoint.date && dataPoint.close !== undefined)
                  .map(dataPoint => ({
                    date: dataPoint.date,
                    open: dataPoint.open,
                    high: dataPoint.high,
                    low: dataPoint.low,
                    close: dataPoint.close,
                    adjusted_close: dataPoint.adjusted_close,
                    volume: dataPoint.volume
                  }));
    
                if (processedData.length > 0) {
                  Historical.update(
                    { eodTicker },
                    { $push: { data: { $each: processedData } } },
                    { upsert: true }
                  );
                  console.log(`Updated historical data for eodTicker: ${eodTicker}`);
                } else {
                  console.log(`No valid data points to update for eodTicker: ${eodTicker}`);
                }
              } else {
                console.log(`No new data points to update for eodTicker: ${eodTicker}`);
              }
            } catch (error) {
              console.error(`Failed to fetch data for ${eodTicker}:`, error);
            }
          });
        });
    
        console.log('Completed updateMarketData method');
      },
    
});
