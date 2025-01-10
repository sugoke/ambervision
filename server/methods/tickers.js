import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { check } from 'meteor/check';

import { Products } from '/imports/api/products/products.js';

const EOD_API_KEY = "5c265eab2c9066.19444326"; // Store your API key in an environment variable

Meteor.methods({
  'tickers.autocomplete'(query) {
    check(query, String);
    
    console.log('Server received autocomplete request for:', query);
    
    if (query.length < 2) {
      console.log('Query too short, returning empty array');
      return [];
    }
    
    try {
      const url = `https://eodhistoricaldata.com/api/search/${query}?api_token=${EOD_API_KEY}`;
      console.log('Calling EOD API:', url);
      
      const response = HTTP.get(url);
      console.log('EOD API response:', response.data);
      
      if (!response.data) {
        console.log('No data in response');
        return [];
      }
      
      return response.data;
    } catch (error) {
      console.error('Error fetching data from EOD Historical Data:', error);
      throw new Meteor.Error('api-error', 'Error fetching data from EOD Historical Data');
    }
  },

  getISINSuggestions: function(input) {
    console.log('Server received getISINSuggestions call with input:', input);
    
    try {
      check(input, String);
      
      if (!Products || !Products.find) {
        throw new Meteor.Error('products-not-defined', 'Products collection is not properly defined');
      }
      
      const regex = new RegExp('^' + input, 'i');
      const results = Products.find(
        { ISINCode: regex },
        { 
          fields: { 
            ISINCode: 1, 
            'genericData.name': 1, 
            'genericData.currency': 1 
          }, 
          limit: 10 
        }
      ).fetch().map(product => ({
        isin: product.ISINCode,
        name: product.genericData && product.genericData.name || 'Unknown Product',
        currency: product.genericData && product.genericData.currency || 'Unknown Currency'
      }));
      
      console.log('Server returning ISIN suggestions:', results);
      return results;
    } catch (error) {
      console.error('Error in getISINSuggestions method:', error);
      throw new Meteor.Error('get-isin-suggestions-failed', error.message);
    }
  },

  'getTickerLastPrice'(ticker) {
    check(ticker, String);
    
    try {
      const url = `https://eodhistoricaldata.com/api/real-time/${ticker}?api_token=${EOD_API_KEY}&fmt=json`;
      const response = HTTP.get(url);
      
      if (response.data) {
        return {
          close: response.data.close,
          date: response.data.timestamp
        };
      }
      return null;
    } catch (error) {
      console.error('Error fetching last price:', error);
      throw new Meteor.Error('fetch-price-failed', error.message);
    }
  },

  'getUnderlyingNews'(tickers) {
    check(tickers, Array);
    
    try {
      const news = [];
      for (const ticker of tickers) {
        const eodTicker = ticker.includes('.') ? ticker : `${ticker}.US`;
        const url = `https://eodhistoricaldata.com/api/news?s=${eodTicker}&api_token=${EOD_API_KEY}&limit=2&fmt=json`;
        console.log('Fetching news for:', eodTicker);
        
        const response = HTTP.get(url);
        if (response.data && Array.isArray(response.data)) {
          console.log(`Found ${response.data.length} news items for ${eodTicker}`);
          console.log('Full news data:', JSON.stringify(response.data, null, 2));
          news.push(...response.data.map(item => ({
            ...item,
            date: new Date(item.date || item.publishedAt).toLocaleDateString(),
            ticker: ticker,
            text: item.content || item.text || item.description || '',
            link: item.link || item.url || '#'
          })));
        } else {
          console.warn(`No news data for ${eodTicker}:`, response.data);
        }
      }
      console.log(`Total news items found: ${news.length}`);
      return news;
    } catch (error) {
      console.error('Error fetching news:', error);
      throw new Meteor.Error('fetch-news-failed', error.message);
    }
  }
});


