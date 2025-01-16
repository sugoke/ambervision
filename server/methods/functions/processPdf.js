import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { Products } from '/imports/api/products/products.js';
import { Issuers } from '/imports/api/issuers/issuers.js';
import pdfParse from 'pdf-parse';

const EXCHANGE_MAPPING = {
  'UW': '.US',  // NASDAQ
  'UN': '.US',  // NYSE
  'FP': '.PA',  // Euronext Paris
  'SE': '.SW',  // SIX Swiss Exchange
  'LN': '.L',   // London Stock Exchange
  'GY': '.XETRA',  // Deutsche Börse (XETRA)
  'IM': '.MI',  // Borsa Italiana
  'NA': '.AS',  // Euronext Amsterdam
  'SM': '.MC',  // Bolsa de Madrid
  'SS': '.SZ',  // Shenzhen Stock Exchange
  'SH': '.SS',  // Shanghai Stock Exchange
  'T': '.JP',   // Tokyo Stock Exchange
  'HK': '.HK',  // Hong Kong Stock Exchange
  'AX': '.AU',  // Australian Securities Exchange
  'SI': '.SG',  // Singapore Exchange
  'TO': '.CA',  // Toronto Stock Exchange
  'BO': '.IN',  // Bombay Stock Exchange
  'NS': '.IN',  // National Stock Exchange of India
  'NZ': '.NZ',  // New Zealand Exchange
  'BB': '.BR',  // Euronext Brussels
  'ID': '.IR',  // Euronext Dublin
  'PL': '.LS',  // Euronext Lisbon
  'NO': '.OL',  // Oslo Stock Exchange
  'HE': '.HE',  // Helsinki Stock Exchange
  'CO': '.CO',  // Copenhagen Stock Exchange
  'ST': '.ST',  // Stockholm Stock Exchange
  'IS': '.IS',  // Istanbul Stock Exchange
  'WA': '.WA',  // Warsaw Stock Exchange
  'PR': '.PR',  // Prague Stock Exchange
  'BU': '.BU',  // Budapest Stock Exchange
  'RO': '.RO',  // Bucharest Stock Exchange
  'ZA': '.ZA',  // Johannesburg Stock Exchange
};


const mapToEODTicker = (rawTicker) => {
  const [symbol, exchange] = rawTicker.split(/\s+/);
  const eodSuffix = EXCHANGE_MAPPING[exchange] || '';
  return `${symbol}${eodSuffix}`;
};

const getOpenAIKey = () => {
  const key = Meteor.settings?.private?.openaiKey;
  if (!key) throw new Meteor.Error('openai-key-missing', 'OpenAI API key not configured');
  return key;
};

const findClosestIssuer = (name) => {
  const issuers = Issuers.find({}, { fields: { name: 1 } }).fetch();
  let bestMatch = null;
  let highestSimilarity = 0;

  const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedInput = normalize(name);

  issuers.forEach(issuer => {
    const normalizedIssuer = normalize(issuer.name);
    
    // Simple contains check
    if (normalizedInput.includes(normalizedIssuer) || 
        normalizedIssuer.includes(normalizedInput)) {
      if (normalizedIssuer.length > highestSimilarity) {
        highestSimilarity = normalizedIssuer.length;
        bestMatch = issuer.name;
      }
    }
  });

  return bestMatch || name;
};

const getKnownIssuers = () => {
  return Issuers.find({}, { fields: { name: 1 } })
    .fetch()
    .map(i => i.name)
    .join(', ');
};

Meteor.methods({
  async processPdfWithAI(fileData) {
    try {
      const pdfData = await pdfParse(fileData);
      const knownIssuers = getKnownIssuers();
      
      const prompt = `You are a financial document parser specialized in structured products. Extract data from this termsheet and return a JSON object with this EXACT structure:

{
  "status": "pending",
  "genericData": {
    "ISINCode": "string",
    "currency": "string",
    "issuer": "string", // IMPORTANT: Match issuer name with one of these known issuers: ${knownIssuers}. Return the closest match.
    "settlementType": "string", // IMPORTANT: Must be either "Cash" or "Physical". Look in final redemption section - indicates if investor receives cash or shares in case of capital loss
    "settlementTx": "string", // IMPORTANT: Number of days between trade date and settlement date (e.g., if trade date is 2024-01-01 and settlement date is 2024-01-07, then settlementTx is "7")
    "tradeDate": "YYYY-MM-DD",
    "paymentDate": "YYYY-MM-DD", 
    "finalObservation": "YYYY-MM-DD",
    "maturityDate": "YYYY-MM-DD",
    "template": "phoenix",
    "name": "string", // "Phoenix on " + EOD tickers joined by " / "
    "nonCallPeriods": number // Count of non-call periods at start of product
  },
  "features": {
    "memoryCoupon": boolean,
    "memoryAutocall": boolean, 
    "oneStar": boolean,
    "lowStrike": boolean, // True if using % of initial level
    "autocallStepdown": boolean,
    "jump": boolean,
    "stepDown": boolean,
    "couponBarrier": number,
    "capitalProtectionBarrier": number,
    "couponPerPeriod": number
  },
  "underlyings": [{
    "name": "string",
    "ticker": "string", // Raw ticker
    "exchange": "string",
    "country": "string",
    "currency": "string", 
    "initialReferenceLevel": number,
    "eodTicker": "string", // Standardized EOD format
    "lastPriceInfo": {}
  }],
  "observationDates": [{
    "observationDate": "YYYY-MM-DD",
    "paymentDate": "YYYY-MM-DD",
    "couponBarrierLevel": number,
    "autocallLevel": number or null, // IMPORTANT: null means this is a non-call date
    "couponPerPeriod": number
  }]
}

Rules:
1. All dates in YYYY-MM-DD
2. Percentages as numbers (70 not "70%")
3. Missing fields as null
4. Map tickers to EOD format (AAPL.US)
5. Empty lastPriceInfo object
6. Name as "Phoenix on " + tickers
7. For issuer, ONLY use one of these exact names: ${knownIssuers}. Match to the closest one
8. For non-call periods:
   - Compare coupon observation dates with autocall dates
   - If a date appears only in coupon table, it's a non-call date (set autocallLevel: null)
   - Count consecutive non-call dates from start as nonCallPeriods
9. For settlementType:
   - Must be either "Cash" or "Physical"
   - Check final redemption section
   - "Physical" if investor receives shares when barrier is breached
   - "Cash" if investor always receives cash even in loss scenario
10. For settlementTx:
    - Calculate days between trade date and settlement date
    - Return as string number (e.g., "7")
    - Look for "Settlement Date" or similar terms in document
11. For German stocks (GY suffix):
    - Map to .XETRA suffix
    - Example: "RWE GY" should become "RWE.XETRA"
    - This applies to all stocks traded on Deutsche Börse/Xetra`;

      const response = await HTTP.call('POST', 'https://api.openai.com/v1/chat/completions', {
        headers: {
          'Authorization': `Bearer ${getOpenAIKey()}`,
          'Content-Type': 'application/json',
        },
        data: {
          model: "gpt-4-1106-preview",
          messages: [{
            role: "user",
            content: prompt + "\n\nPDF content:\n" + pdfData.text.substring(0, 12000)
          }],
          temperature: 0.1,
          response_format: { type: "json_object" }
        }
      });

      let parsedData = JSON.parse(response.data.choices[0].message.content);

      // Match issuer name
      parsedData.genericData.issuer = findClosestIssuer(parsedData.genericData.issuer);

      // Map tickers to EOD format
      parsedData.underlyings = parsedData.underlyings.map(underlying => ({
        ...underlying,
        eodTicker: mapToEODTicker(underlying.ticker)
      }));

      // Update product name with EOD tickers
      parsedData.genericData.name = "Phoenix on " + parsedData.underlyings
        .map(u => u.eodTicker)
        .join(" / ");

      const productId = Products.insert(parsedData);

      return {
        success: true,
        isin: parsedData.genericData.ISINCode,
        productId
      };

    } catch (error) {
      console.error('PDF processing error:', error);
      throw new Meteor.Error('processing-error', error.message);
    }
  }
});
