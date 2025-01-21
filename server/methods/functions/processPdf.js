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

const validateEodTicker = (ticker) => {
  if (!ticker.includes('.')) {
    // If no suffix, check if it's a US stock and add .US
    if (ticker.match(/^[A-Z]+$/)) {
      return `${ticker}.US`;
    }
    throw new Error(`Invalid EOD ticker format: ${ticker}`);
  }
  return ticker;
};

const mapToEODTicker = (rawTicker) => {
  const [symbol, exchange] = rawTicker.split(/\s+/);
  const eodSuffix = EXCHANGE_MAPPING[exchange] || '';
  const eodTicker = `${symbol}${eodSuffix}`;
  return validateEodTicker(eodTicker);
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

const PROCESSING_STEPS = [
  { percent: 10, status: 'Starting PDF processing...' },
  { percent: 20, status: 'Parsing PDF content...' },
  { percent: 30, status: 'Extracting ISIN code...' },
  { percent: 40, status: 'Validating document...' },
  { percent: 60, status: 'Processing with AI...' },
  { percent: 70, status: 'Parsing product data...' },
  { percent: 80, status: 'Validating product data...' },
  { percent: 90, status: 'Saving to database...' },
  { percent: 100, status: 'Product saved successfully!' }
];

const updateProgress = (userId, currentStep) => {
  if (!userId) return;
  const step = PROCESSING_STEPS.find(s => s.status === currentStep);
  if (!step) return;
  
  console.log('Updating progress:', { userId, status: step.status, percent: step.percent });
  
  Meteor.users.update(userId, {
    $set: {
      'processingStatus': { 
        status: step.status,
        percent: step.percent,
        steps: PROCESSING_STEPS
      }
    }
  });
  
  // Verify update
  const user = Meteor.users.findOne(userId);
  console.log('Progress updated:', user.processingStatus);
};

if (Meteor.isServer) {
  Meteor.publish('userProcessingStatus', function() {
    if (!this.userId) return this.ready();
    return Meteor.users.find(
      { _id: this.userId },
      { fields: { 'processingStatus': 1 } }
    );
  });
}

Meteor.methods({
  clearProcessingStatus() {
    if (!this.userId) return;
    Meteor.users.update(this.userId, {
      $unset: { processingStatus: "" }
    });
  },
  async processPdfWithAI(fileData) {
    try {
      const userId = this.userId;
      updateProgress(userId, 'Starting PDF processing...');
      console.log('Starting PDF processing...');

      updateProgress(userId, 'Parsing PDF content...');
      const pdfData = await pdfParse(fileData);
      console.log('PDF parsed successfully, text length:', pdfData.text.length);
      
      updateProgress(userId, 'Retrieving known issuers...');
      const knownIssuers = getKnownIssuers();
      console.log('Known issuers retrieved:', knownIssuers);
      
      updateProgress(userId, 'Extracting ISIN code...');
      const isinResponse = await HTTP.call('POST', 'https://api.openai.com/v1/chat/completions', {
        headers: {
          'Authorization': `Bearer ${getOpenAIKey()}`,
          'Content-Type': 'application/json',
        },
        data: {
          model: "gpt-3.5-turbo",
          messages: [{
            role: "user",
            content: `Find and return ONLY the ISIN code from this text. An ISIN is a 12-character code starting with 2 letters (usually CH for Swiss products) followed by 10 alphanumeric characters. Return only the ISIN, nothing else. If no ISIN is found, return "NONE".\n\nText:\n${pdfData.text}`
          }],
          temperature: 0
        }
      });

      const isin = isinResponse.data.choices[0].message.content.trim();
      console.log('Extracted ISIN:', isin);

      updateProgress(userId, 'Validating ISIN format...');
      if (isin === 'NONE') {
        console.error('No ISIN found in document');
        throw new Meteor.Error('processing-error', 'No ISIN code found in document');
      }

      if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
        console.error('Invalid ISIN format:', isin);
        throw new Meteor.Error('processing-error', 'Invalid ISIN format detected');
      }

      updateProgress(userId, 'Checking for existing product...');
      const existingProduct = Products.findOne({
        $or: [
          { "genericData.ISINCode": { $regex: new RegExp(isin, 'i') } },
          { "ISINCode": { $regex: new RegExp(isin, 'i') } }
        ]
      }, { fields: { _id: 1 } });

      if (existingProduct) {
        console.log('Found existing product with ISIN:', isin, 'ID:', existingProduct._id);
        throw new Meteor.Error('duplicate-isin', 
          'A product with ISIN ' + isin + ' already exists. Please edit the existing product instead.',
          { existingId: existingProduct._id });
      }

      console.log('No duplicate ISIN found, proceeding with full processing...');
      
      updateProgress(userId, 'Processing term sheet with AI...');
      const prompt = `You are a financial document parser specialized in structured products. Extract data from this termsheet and return a JSON object with this EXACT structure:

{
  "status": "pending",
  "genericData": {
    "ISINCode": "string",
    "currency": "string",
    "issuer": "string", // IMPORTANT: Match issuer name EXACTLY with one of these known issuers (case-sensitive): ${knownIssuers}
    "settlementType": "string", // IMPORTANT: Must be either "Cash" or "Physical". Look in final redemption section - indicates if investor receives cash or shares in case of capital loss
    "settlementTx": "string", // IMPORTANT: Number of days between trade date and settlement date (e.g., if trade date is 2024-01-01 and settlement date is 2024-01-07, then settlementTx is "7")
    "tradeDate": "YYYY-MM-DD",
    "paymentDate": "YYYY-MM-DD", 
    "finalObservation": "YYYY-MM-DD",
    "maturityDate": "YYYY-MM-DD",
    "template": "phoenix",
    "name": "string", // "Phoenix on " + EOD tickers joined by " / "
    "nonCallPeriods": number // Count of non-call periods at start of product. number of observation dates that are not autocall dates.
  },
  "features": {
    "memoryCoupon": boolean,
    "memoryAutocall": boolean, // For memory autocall, you will find it often in Automatic early redemption section. It will look like this: If, on any Automatic Early Redemption Valuation Daten, in respect of each Underlying Share in
the Basket, the official closing price of such Underlying Share on that Automatic Early
Redemption Valuation Daten or any of the Automatic Early Redemption Valuation Daten which
precede that Automatic Early Redemption Valuation Daten is greater than or equal to its
Automatic Early Redemption Price in, then the Issuer shall redeem each Certificate on the
relevant Automatic Early Redemption Daten at the Automatic Early Redemption Amount
calculated. What you have to pay attention to is the sentence that says 'or any of the Automatic Early Redemption Valuation Date' which shows that the product is autocalled when all underlyings have been observed above the autocall level even on different dates. Assume there is no memory autocall if you cannot find something like this in the document.
    "oneStar": boolean,
    "lowStrike": boolean, // True if using % of initial level. lowStrike is true if the strike is less than 100% of the initial level. It means a potential capital loss will be calculated compared to the strike or protection barrier level, not the initial level.
    "autocallStepdown": boolean,
    "jump": boolean,
    "stepDown": boolean, // True if the autocall level goes down after the first autocall date.
    "couponBarrier": number,
    "capitalProtectionBarrier": number, // this is NOT "bond floor", it is generally the strike level which is usually below the initial level.
    "couponPerPeriod": number
  },
  "underlyings": [{
    "name": "string",
    "ticker": "string", // Raw ticker
    "exchange": "string",
    "country": "string",
    "currency": "string", 
    "initialReferenceLevel": number,
    "eodTicker": "string", // IMPORTANT: Standardized EOD format, make sure it is a valid ticker for EOD like AAPL.US (name.exchange)
    "lastPriceInfo": {}
  }],
  "observationDates": [{
    "observationDate": "YYYY-MM-DD",
    "paymentDate": "YYYY-MM-DD",
    "couponBarrierLevel": number,
    "autocallLevel": number or null, // IMPORTANT: null means this is a non-call date. This level is sometimes called Autocall Trigger Level.
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
    - This applies to all stocks traded on Deutsche Börse/Xetra

Rules for tickers and EOD format:
1. Raw ticker format: Return as "symbol exchange" (e.g., "AAPL UW", "SAN FP")
2. EOD ticker format: Must be "symbol.exchange" where exchange is from this mapping:
   - UW or UN → .US (NASDAQ/NYSE)
   - FP → .PA (Euronext Paris)
   - SE → .SW (SIX Swiss Exchange)
   - LN → .L (London)
   - GY → .XETRA (Deutsche Börse)
   - IM → .MI (Italian)
   - NA → .AS (Amsterdam)
   - SM → .MC (Madrid)
   - T → .JP (Tokyo)
   - HK → .HK (Hong Kong)

Examples:
- "AAPL UW" → "AAPL.US"
- "SAN FP" → "SAN.PA"
- "ADS GY" → "ADS.XETRA"
- "NESN SE" → "NESN.SW"

IMPORTANT: Always verify eodTicker follows symbol.exchange format exactly. Never return invalid formats like "name.exchange.other" or missing dots.
`;

    

      const fullResponse = await HTTP.call('POST', 'https://api.openai.com/v1/chat/completions', {
        headers: {
          'Authorization': `Bearer ${getOpenAIKey()}`,
          'Content-Type': 'application/json',
        },
        data: {
          model: "gpt-3.5-turbo-16k",
          messages: [{
            role: "user",
            content: prompt + "\n\nPDF content:\n" + pdfData.text + "\n\nIMPORTANT: Return ONLY a valid JSON object, nothing else."
          }],
          temperature: 0.1
        }
      });

      updateProgress(userId, 'Parsing AI response...');
      let parsedData;
      try {
        // Extract just the JSON part from the response
        const responseText = fullResponse.data.choices[0].message.content.trim();
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}') + 1;
        const jsonStr = responseText.slice(jsonStart, jsonEnd);
        
        parsedData = JSON.parse(jsonStr);
        console.log('Parsed data successfully');
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        console.log('Raw response:', fullResponse.data.choices[0].message.content);
        throw new Meteor.Error('processing-error', 'Failed to parse product data');
      }

      updateProgress(userId, 'Validating parsed data...');
      // Validate ISIN matches
      if (parsedData.genericData.ISINCode !== isin) {
        console.error('ISIN mismatch:', {
          extracted: isin,
          parsed: parsedData.genericData.ISINCode
        });
        throw new Meteor.Error('processing-error', 'ISIN code mismatch in parsed data');
      }

      // Match issuer name
      parsedData.genericData.issuer = findClosestIssuer(parsedData.genericData.issuer);

      // Map tickers to EOD format
      parsedData.underlyings = parsedData.underlyings.map(underlying => {
        const eodTicker = mapToEODTicker(underlying.ticker);
        return {
          ...underlying,
          eodTicker
        };
      });

      // Update product name with EOD tickers
      parsedData.genericData.name = "Phoenix on " + parsedData.underlyings
        .map(u => u.eodTicker)
        .join(" / ");

      console.log('Inserting product into database...', {
        isin: parsedData.genericData.ISINCode,
        name: parsedData.genericData.name
      });

      updateProgress(userId, 'Preparing database insertion...');
      try {
        // Create indexes if they don't exist
        await Products.rawCollection().createIndexes([
          { key: { "genericData.ISINCode": 1 }, unique: true, background: true },
          { key: { "ISINCode": 1 }, unique: true, background: true }
        ]).catch(err => {
          // Ignore index exists errors
          if (!err.message.includes('existing index')) {
            throw err;
          }
        });
        
        const productId = Products.insert(parsedData);
        console.log('Product inserted successfully, ID:', productId);
        updateProgress(userId, 'Product saved successfully!');
        return {
          success: true,
          isin: parsedData.genericData.ISINCode,
          productId
        };
      } catch (dbError) {
        console.error('Database error:', dbError);
        if (dbError.code === 11000) {
          // Get existing product ID for redirect
          const existing = Products.findOne({
            $or: [
              { "genericData.ISINCode": isin },
              { "ISINCode": isin }
            ]
          }, { fields: { _id: 1 } });
          
          throw new Meteor.Error('duplicate-isin', 
            'A product with ISIN ' + isin + ' already exists. Please edit the existing product instead.',
            { existingId: existing?._id });
        }
        throw new Meteor.Error('processing-error', 'Failed to save product to database');
      }

    } catch (error) {
      // Update error status while maintaining steps structure
      Meteor.users.update(this.userId, {
        $set: {
          'processingStatus': {
            status: `Error: ${error.reason || error.message}`,
            percent: 0,
            steps: PROCESSING_STEPS
          }
        }
      });
      console.error('PDF processing error:', error);
      throw new Meteor.Error(
        'processing-error',
        error.error === 'duplicate-isin' ? error.reason : 
        'Error processing PDF: ' + (error.reason || error.message || 'Unknown error')
      );
    }
  }
});
