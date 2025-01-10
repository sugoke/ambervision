import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { check } from 'meteor/check';

Meteor.methods({
  async 'getEodNews'(tickers) {
    check(tickers, [String]);
    
    const apiKey = Meteor.settings.private.eodApiKey;
    if (!apiKey) {
      throw new Meteor.Error('api-key-missing', 'EOD API key not configured');
    }

    const news = [];
    for (const ticker of tickers) {
      try {
        const formattedTicker = ticker.includes('.') ? ticker : `${ticker}.US`;
        const url = `https://eodhistoricaldata.com/api/news?api_token=${apiKey}&s=${formattedTicker}&offset=0&limit=10`;
        
        console.log(`Fetching news for ${formattedTicker}`);
        const result = await HTTP.get(url);
        
        if (result.statusCode === 200 && Array.isArray(result.data)) {
          news.push(...result.data.map(item => ({
            ticker,
            title: item.title,
            text: item.text,
            date: new Date(item.date),
            link: item.link,
            source: item.source
          })));
        }
      } catch (error) {
        console.error(`Error fetching news for ${ticker}:`, error);
      }
    }

    // Sort by date and return latest 10 overall
    return news
      .sort((a, b) => b.date - a.date)
      .slice(0, 10);
  }
}); 