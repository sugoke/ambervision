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
                const latestRecord = Historical.findOne(
                    { eodTicker },
                    { sort: { 'data.date': -1 }, fields: { 'data.date': 1, 'data': 1 } }
                );
                
                console.log(`Latest record for ${eodTicker}: ${JSON.stringify(latestRecord?.data?.length ? 
                    {lastDate: latestRecord.data[latestRecord.data.length - 1].date, recordsCount: latestRecord.data.length} : 
                    {exists: !!latestRecord})}`);

                let startDate;
                if (latestRecord?.data?.length) {
                    const lastDate = new Date(latestRecord.data[latestRecord.data.length - 1].date);
                    lastDate.setDate(lastDate.getDate() + 1);
                    startDate = lastDate.toISOString().split('T')[0];
                } else {
                    // Use the earliest date found for this ticker
                    startDate = tickerStartDates[eodTicker];
                    console.log(`No historical data for ${eodTicker}, using earliest product tradeDate: ${startDate}`);
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
                            await Historical.update(
                                { eodTicker },
                                { $push: { data: { $each: processedData } } },
                                { upsert: true }
                            );
                            console.log(`Updated ${eodTicker} with ${processedData.length} records`);
                        }
                    } catch (error) {
                        console.error(`Error fetching ${eodTicker}:`, error);
                        console.log(`Full error details for ${eodTicker}:`, error.response?.content || JSON.stringify(error));
                    }
                } else {
                    console.log(`${eodTicker}: No update needed, startDate ${startDate} > currentDate ${currentDate}`);
                }
            })());
        }

        await Promise.all(updatePromises);
        console.log("Market data update completed, processed tickers:", Array.from(allTickers));
        return "Market data update completed";
    }
});
