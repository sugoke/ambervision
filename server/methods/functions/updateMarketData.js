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
        const processedTickers = new Set();
        const updatePromises = [];

        products.forEach(product => {
          product.underlyings.forEach(underlying => {
            const eodTicker = underlying.eodTicker;
            
            if (!eodTicker || processedTickers.has(eodTicker)) return;
            processedTickers.add(eodTicker);

            updatePromises.push((async () => {
              const latestRecord = Historical.findOne(
                { eodTicker },
                { sort: { 'data.date': -1 }, fields: { 'data.date': 1 } }
              );

              let startDate;
              if (latestRecord?.data?.length) {
                const lastDate = new Date(latestRecord.data[latestRecord.data.length - 1].date);
                lastDate.setDate(lastDate.getDate() + 1);
                startDate = lastDate.toISOString().split('T')[0];
              } else {
                startDate = product.genericData?.tradeDate;
              }

              const currentDate = new Date().toISOString().split('T')[0];

              if (startDate && new Date(startDate) <= new Date(currentDate)) {
                try {
                  const url = `https://eodhd.com/api/eod/${eodTicker}?api_token=${apiKey}&from=${startDate}&to=${currentDate}&fmt=json`;
                  const response = await HTTP.get(url);
                  const newData = response.data;

                  if (!Array.isArray(newData) || newData.length === 0) return;

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
                }
              }
            })());
          });
        });

        await Promise.all(updatePromises);
        return "Market data update completed";
    }
});
