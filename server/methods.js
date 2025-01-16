import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { check } from 'meteor/check';
import { Products } from '/imports/api/products/products.js';
import { Holdings } from '/imports/api/holdings/holdings.js';
import { Tickers } from '/imports/api/products/products.js';

// Get API key from environment or settings
const getApiKey = () => {
  const settingsKey = Meteor.settings?.private?.eodApiKey;
  if (settingsKey) return settingsKey;
  
  const envKey = process.env.EOD_API_KEY;
  if (envKey) return envKey;
  
  console.error('EOD API key not configured');
  return null;
};

const sendEmail = ({ to, subject, text }) => {
  const smtp = Meteor.settings.private.smtp2go;
  
  try {
    const result = HTTP.post('https://api.smtp2go.com/v3/email/send', {
      data: {
        api_key: smtp.apiKey,
        to: [to],
        sender: smtp.from,
        subject: subject,
        text_body: text
      }
    });
    return result;
  } catch (error) {
    console.error('SMTP2GO API Error:', error);
    throw new Meteor.Error('email-error', error.message);
  }
};

Meteor.methods({
  'getLastPrice'(eodTicker) {
    check(eodTicker, String);
    
    if (!eodTicker) {
      throw new Meteor.Error('invalid-ticker', 'EOD ticker is required');
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      console.error('EOD API key not configured');
      return null;
    }

    try {
      console.log('Fetching price for:', eodTicker);
      const url = `https://eodhistoricaldata.com/api/real-time/${eodTicker}?api_token=${apiKey}&fmt=json`;
      const result = HTTP.get(url);
      
      if (result.statusCode === 200 && result.data) {
        return {
          lastPrice: result.data.close,
          timestamp: result.data.timestamp,
          previousClose: result.data.previousClose
        };
      }
      console.error('Invalid API response:', result);
      return null;
    } catch (error) {
      console.error('Error fetching last price for', eodTicker, ':', error);
      return null;
    }
  },

  'getClientProducts'(clientId) {
    check(clientId, String);
    
    const holdings = Holdings.find({ userId: clientId }).fetch();
    const productIds = [...new Set(holdings.map(h => h.productId))];
    const products = Products.find({ _id: { $in: productIds } }).fetch();
    
    return productIds;
  },

  'searchTickersByName'(name) {
    check(name, String);

    const regex = new RegExp(name, 'i');
    return Tickers.find({
      Name: regex
    }, {
      limit: 10,
      fields: { Code: 1, Name: 1, Country: 1, Exchange: 1, Currency: 1 }
    }).fetch();
  },

  'getTickerClosingPrice'(symbolWithExchange) {
    this.unblock();
    const url = `https://eodhd.com/api/eod/${symbolWithExchange}?filter=last_close&api_token=${getApiKey()}&fmt=json`;

    try {
      const result = HTTP.get(url);
      return [{
        close: JSON.parse(result.content),
        date: new Date().toISOString().split('T')[0]
      }];
    } catch (error) {
      console.error("Failed to fetch ticker closing price for", symbolWithExchange, ":", error);
      throw new Meteor.Error('api-call-failed', 'Failed to fetch ticker closing price');
    }
  },

  'email.sendResetLink': function(to, url) {
    check(to, String);
    check(url, String);
    
    return sendEmail({
      to: to,
      subject: "Reset Your Password",
      text: `Click this link to reset your password: ${url}`
    });
  }
}); 