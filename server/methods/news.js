import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { check } from 'meteor/check';

// Only define the method if it doesn't already exist
if (!Meteor.server.method_handlers['getUnderlyingNews']) {
  Meteor.methods({
    getUnderlyingNews(tickers) {
      check(tickers, [String]);

      try {
        const results = [];
        
        for (const ticker of tickers) {
          console.log('Fetching news for:', ticker);
          
          const response = HTTP.get(`https://eodhistoricaldata.com/api/news`, {
            params: {
              api_token: Meteor.settings.private.eodApiKey,
              s: ticker,
              limit: 2,
              from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            }
          });

          if (response.data && Array.isArray(response.data)) {
            const newsWithTicker = response.data.map(item => ({
              ...item,
              ticker: ticker
            }));
            results.push(...newsWithTicker);
          }
        }

        return results
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .slice(0, 4);

      } catch (error) {
        console.error('News API error:', error.message);
        throw new Meteor.Error('news-api-error', 'Failed to fetch news');
      }
    }
  });
} 