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

    'updateMarketData': async function() {
        const apiKey = '5c265eab2c9066.19444326';
        const products = Products.find().fetch();
        const updatePromises = [];
        
        console.log(`Starting update for ${products.length} products`);
        
        // Map to store earliest tradeDate for each ticker
        const tickerStartDates = {};
        const allTickers = new Set();
        
        // First pass - collect all tickers and their earliest trade dates
        products.forEach(product => {
            const productTradeDate = product.genericData?.tradeDate;
            
            if (!productTradeDate) {
                console.log(`Product ${product._id} has no tradeDate`);
                return;
            }
            
            product.underlyings.forEach(underlying => {
                const eodTicker = underlying.eodTicker;
                if (!eodTicker) return;
                
                allTickers.add(eodTicker);
                
                if (!tickerStartDates[eodTicker] || 
                    new Date(productTradeDate) < new Date(tickerStartDates[eodTicker])) {
                    tickerStartDates[eodTicker] = productTradeDate;
                    console.log(`Updated earliest date for ${eodTicker} to ${productTradeDate} from product ${product._id}`);
                }
            });
        });
        
        console.log(`Collected start dates for ${Object.keys(tickerStartDates).length} unique tickers`);

        // Process each unique ticker once using its earliest date
        for (const eodTicker of allTickers) {
            console.log(`Processing ticker: ${eodTicker} with earliest date: ${tickerStartDates[eodTicker]}`);
            
            updatePromises.push((async () => {
                try {
                    // Check if ticker already exists in Historical collection
                    const existingRecord = Historical.findOne({ eodTicker });
                    
                    let startDate;
                    let existingData = [];
                    
                    if (existingRecord) {
                        console.log(`Found existing record for ${eodTicker}, data array length: ${existingRecord.data?.length || 0}`);
                        
                        // Always use the earliest product trade date to ensure complete history
                        startDate = tickerStartDates[eodTicker];
                        
                        if (existingRecord.data && Array.isArray(existingRecord.data) && existingRecord.data.length > 0) {
                            existingData = existingRecord.data;
                            console.log(`${eodTicker}: Using data from ${existingRecord.data[0].date} to ${existingRecord.data[existingRecord.data.length-1].date}, forcing fetch from product tradeDate: ${startDate}`);
                        } else {
                            console.log(`Existing record has no data for ${eodTicker}, using earliest product tradeDate: ${startDate}`);
                        }
                    } else {
                        startDate = tickerStartDates[eodTicker];
                        console.log(`No historical record for ${eodTicker}, using earliest product tradeDate: ${startDate}`);
                    }

                    const currentDate = new Date().toISOString().split('T')[0];
                    console.log(`${eodTicker}: Fetching from ${startDate} to ${currentDate}`);

                    if (startDate && new Date(startDate) <= new Date(currentDate)) {
                        try {
                            const url = `https://eodhd.com/api/eod/${eodTicker}?api_token=${apiKey}&from=${startDate}&to=${currentDate}&fmt=json`;
                            console.log(`Request URL: ${url}`);
                            
                            const response = await HTTP.get(url);
                            const newData = response.data;

                            console.log(`${eodTicker}: Received ${newData?.length || 0} raw records, response status: ${response.statusCode}`);
                            
                            if (response.statusCode !== 200) {
                                console.log(`${eodTicker}: API error - ${JSON.stringify(response.data)}`);
                                return;
                            }

                            if (!Array.isArray(newData) || newData.length === 0) {
                                console.log(`${eodTicker}: No data received or invalid format`);
                                return;
                            }

                            const processedData = newData
                                .filter(d => d && d.date && d.close !== undefined)
                                .map(d => ({
                                    date: d.date,
                                    open: d.open,
                                    high: d.high,
                                    low: d.low,
                                    close: d.close,
                                    adjusted_close: d.adjusted_close,
                                    volume: d.volume
                                }));

                            console.log(`${eodTicker}: Processed ${processedData.length} records after filtering (${newData.length - processedData.length} removed)`);

                            if (processedData.length > 0) {
                                // Create a map of existing data by date to avoid duplicates
                                const existingDataMap = new Map();
                                existingData.forEach(item => {
                                    existingDataMap.set(item.date, item);
                                });
                                
                                // Add new data only if not already present
                                const datesToAdd = [];
                                processedData.forEach(item => {
                                    if (!existingDataMap.has(item.date)) {
                                        datesToAdd.push(item);
                                        existingDataMap.set(item.date, item);
                                    }
                                });
                                
                                // Combine all data and sort by date
                                const combinedData = Array.from(existingDataMap.values())
                                    .sort((a, b) => new Date(a.date) - new Date(b.date));
                                
                                try {
                                    if (existingRecord) {
                                        console.log(`${eodTicker}: Replacing document with ${combinedData.length} total records (${datesToAdd.length} new)`);
                                        await Historical.remove({ eodTicker });
                                    } else {
                                        console.log(`${eodTicker}: Creating new document with ${combinedData.length} records`);
                                    }
                                    
                                    await Historical.insert({
                                        eodTicker,
                                        data: combinedData
                                    });
                                    
                                    console.log(`Updated ${eodTicker} with ${datesToAdd.length} new records, total: ${combinedData.length}`);
                                } catch (dbError) {
                                    console.error(`Database error for ${eodTicker}: ${dbError.message}`);
                                }
                            }
                        } catch (error) {
                            console.error(`Error fetching ${eodTicker}:`, error);
                            console.log(`Full error details for ${eodTicker}:`, error.response?.content || JSON.stringify(error));
                        }
                    } else {
                        console.log(`${eodTicker}: No update needed, startDate ${startDate} > currentDate ${currentDate}`);
                    }
                } catch (processError) {
                    console.error(`General error processing ${eodTicker}:`, processError);
                }
            })());
        }

        try {
            await Promise.all(updatePromises);
            console.log("Market data update completed, processed tickers:", Array.from(allTickers));
            return "Market data update completed";
        } catch (finalError) {
            console.error("Error in market data update:", finalError);
            return "Market data update completed with errors";
        }
    }
});
