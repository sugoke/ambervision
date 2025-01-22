import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { check } from 'meteor/check';
import moment from 'moment';

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

      // Define priority markets and their scores
      const marketPriority = {
        'US': 100,  // US markets highest priority
        'LSE': 90,  // London Stock Exchange
        'XETRA': 85, // German main market
        'PA': 80,   // Paris
        'MC': 80,   // Madrid
        'MI': 80,   // Milan
        'AS': 80,   // Amsterdam
        'BR': 80,   // Brussels
        'VX': 80,   // Swiss Exchange
        'TO': 75,   // Toronto
        'HK': 70,   // Hong Kong
        'T': 70,    // Tokyo
      };

      // Define priority security types
      const typePriority = {
        'Common Stock': 50,
        'ETF': 40,
        'ADR': 30,
        'Preferred Stock': 20,
        'Fund': 10,
      };

      // Sort results with priority scoring
      const sortedResults = response.data.sort((a, b) => {
        // Calculate priority scores
        const aMarketScore = marketPriority[a.Exchange] || 0;
        const bMarketScore = marketPriority[b.Exchange] || 0;
        
        const aTypeScore = typePriority[a.Type] || 0;
        const bTypeScore = typePriority[b.Type] || 0;

        // Exact match bonus
        const aExactMatch = a.Code.toUpperCase() === query.toUpperCase() ? 1000 : 0;
        const bExactMatch = b.Code.toUpperCase() === query.toUpperCase() ? 1000 : 0;

        // Starts with bonus
        const aStartsWith = a.Code.toUpperCase().startsWith(query.toUpperCase()) ? 500 : 0;
        const bStartsWith = b.Code.toUpperCase().startsWith(query.toUpperCase()) ? 500 : 0;

        // Calculate total scores
        const aScore = aMarketScore + aTypeScore + aExactMatch + aStartsWith;
        const bScore = bMarketScore + bTypeScore + bExactMatch + bStartsWith;

        return bScore - aScore;
      });

      console.log('Sorted results:', sortedResults);
      return sortedResults;
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
       // console.log('Fetching news for:', eodTicker);
        
        const response = HTTP.get(url);
        if (response.data && Array.isArray(response.data)) {
       //   console.log(`Found ${response.data.length} news items for ${eodTicker}`);
       //   console.log('Full news data:', JSON.stringify(response.data, null, 2));
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
  },

  'getTickerInfo'(ticker, tradeDate) {
    check(ticker, String);
    check(tradeDate, String);

    try {
      const formattedTicker = ticker.includes('.') ? ticker : `${ticker}.US`;
      const formattedDate = moment(tradeDate).format('YYYY-MM-DD');
      
      console.log(`Fetching EOD historical data for ${formattedTicker} on ${formattedDate}`);
      
      // Get historical data for a range around the trade date
      const fromDate = moment(formattedDate).subtract(5, 'days').format('YYYY-MM-DD');
      const toDate = moment(formattedDate).add(1, 'days').format('YYYY-MM-DD');
      
      const url = `https://eodhistoricaldata.com/api/eod/${formattedTicker}`;
      const params = {
        api_token: EOD_API_KEY,
        from: fromDate,
        to: toDate,
        fmt: 'json'
      };
      
      console.log('API URL:', url, 'Params:', params);
      
      const response = HTTP.get(url, { params });
      console.log('EOD Historical Response:', response.data);

      // Find the closest date on or before the trade date
      let closestPrice = null;
      let closestDate = null;
      
      if (Array.isArray(response.data)) {
        // Sort by date descending to get the most recent first
        const sortedData = response.data.sort((a, b) => moment(b.date).valueOf() - moment(a.date).valueOf());
        
        // Find the first date that's on or before our target date
        const closestDay = sortedData.find(dataPoint => 
          moment(dataPoint.date).isSameOrBefore(formattedDate)
        );

        if (closestDay) {
          closestPrice = closestDay.close; // Specifically use closing price
          closestDate = closestDay.date;
          console.log(`Found closing price for ${closestDate}: ${closestPrice}`);
        }
      }

      // Get exchange info for country and currency
      const exchange = formattedTicker.split('.')[1];
      const exchangeUrl = `https://eodhistoricaldata.com/api/exchange-symbol-list/${exchange}?api_token=${EOD_API_KEY}&fmt=json`;
      const exchangeResponse = HTTP.get(exchangeUrl);
      
      const tickerInfo = exchangeResponse.data.find(item => 
        item.Code === formattedTicker.split('.')[0] || 
        item.Symbol === formattedTicker.split('.')[0]
      );

      console.log(`Found historical closing price: ${closestPrice} for date: ${closestDate}`);

      return {
        country: tickerInfo?.Country || '',
        currency: tickerInfo?.Currency || '',
        lastPrice: closestPrice,
        date: closestDate || formattedDate
      };
    } catch (error) {
      console.error('Error fetching ticker info:', error);
      console.error('Error details:', error.response?.content || error.message);
      return {
        country: '',
        currency: '',
        lastPrice: null,
        date: null
      };
    }
  }
});


