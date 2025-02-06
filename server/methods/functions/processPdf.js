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

const getDeepseekKey = () => {
  const key = Meteor.settings?.private?.deepseekKey;
  if (!key) throw new Meteor.Error('deepseek-key-missing', 'Deepseek API key not configured');
  return key;
};

const getOpenAIKey = () => {
  const key = Meteor.settings?.private?.openaiKey;
  if (!key) throw new Meteor.Error('openai-key-missing', 'OpenAI API key not configured');
  return key;
};

const callLLMApi = async (messages) => {
  console.log('Calling OpenAI API...');
  return await HTTP.call('POST', 'https://api.openai.com/v1/chat/completions', {
    headers: {
      'Authorization': `Bearer ${getOpenAIKey()}`,
      'Content-Type': 'application/json',
    },
    data: {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a financial document parser specialized in structured products."
        },
        ...messages.slice(1)
      ]
    }
  });
};

const findClosestIssuer = (name) => {
  const issuers = Issuers.find({}, { fields: { name: 1 } }).fetch();

  const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedInput = normalize(name);

  // First try exact match
  const exactMatch = issuers.find(i => i.name === name);
  if (exactMatch) return exactMatch.name;

  // Then try case-insensitive match
  const caseInsensitiveMatch = issuers.find(i => i.name.toLowerCase() === name.toLowerCase());
  if (caseInsensitiveMatch) return caseInsensitiveMatch.name;

  let bestMatch = null;
  let highestSimilarity = 0;

  issuers.forEach(issuer => {
    const normalizedIssuer = normalize(issuer.name);
    
    // Check if the normalized strings are very similar
    if (normalizedInput === normalizedIssuer || 
        normalizedInput.includes(normalizedIssuer)) {
      if (normalizedIssuer.length > highestSimilarity) {
        highestSimilarity = normalizedIssuer.length;
        bestMatch = issuer.name;
      }
    }
  });

  console.log('Issuer matching:', { input: name, matched: bestMatch || name });
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
  { percent: 50, status: 'Processing with AI...' },
  { percent: 60, status: 'Parsing product data...' },
  { percent: 70, status: 'Validating product data...' },
  { percent: 75, status: 'Processing underlyings...' },
  { percent: 80, status: 'Preparing database...' },
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
    console.log('processPdfWithAI called by user:', this.userId);
    const currentStatus = Meteor.users.findOne(this.userId)?.processingStatus;
    if (currentStatus && currentStatus.inProgress) {
      console.warn('Processing already in progress for user:', this.userId);
      throw new Meteor.Error('processing-in-progress', 'A processing operation is already in progress for this user.');
    }
    // Mark processing as started to prevent duplicate calls
    Meteor.users.update(this.userId, {
      $set: { 'processingStatus.inProgress': true }
    });
    
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
      const isinResponse = await callLLMApi([
        {
          role: "system",
          content: "You are a financial document parser specialized in extracting ISIN codes."
        },
        {
          role: "user",
          content: `Find and return ONLY the ISIN code from this text. An ISIN is a 12-character code starting with 2 letters (usually CH for Swiss products) followed by 10 alphanumeric characters. Return only the ISIN, nothing else. If no ISIN is found, return "NONE".\n\nText:\n${pdfData.text}`
        }
      ]);

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
      
      updateProgress(userId, 'Processing with AI...');
      console.log('Preparing AI request...');
      const prompt = `You are a financial document parser specialized in structured products. Extract data from this termsheet and return a JSON object with this EXACT structure:

{
  "status": "pending",
  "genericData": {
    "ISINCode": "${isin}",
    "currency": "string",
    "issuer": "string",
    "settlementType": "string",
    "settlementTx": "string",
    "tradeDate": "YYYY-MM-DD",
    "paymentDate": "YYYY-MM-DD", 
    "finalObservation": "YYYY-MM-DD",
    "maturityDate": "YYYY-MM-DD",
    "template": "phoenix",
    "name": "string",
    "nonCallPeriods": number
  },
  "features": {
    "memoryCoupon": boolean,
    "memoryAutocall": boolean,
    "oneStar": boolean,
    "lowStrike": boolean,
    "autocallStepdown": boolean,
    "jump": boolean,
    "stepDown": boolean,
    "couponBarrier": number,
    "capitalProtectionBarrier": number,
    "couponPerPeriod": number
  },
  "underlyings": [{
    "name": "string",
    "ticker": "string",
    "exchange": "string",
    "country": "string",
    "currency": "string", 
    "initialReferenceLevel": number,
    "eodTicker": "string",
    "lastPriceInfo": {}
  }],
  "observationDates": [{
    "observationDate": "YYYY-MM-DD",
    "paymentDate": "YYYY-MM-DD",
    "couponBarrierLevel": number,
    "autocallLevel": number or null,
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

Rules for tickers and EOD format:
1. Raw ticker format: Return as "symbol exchange" (e.g., "AAPL UW")
2. EOD ticker format: Must be "symbol.exchange" where exchange is from this mapping:
   - UW or UN → .US
   - FP → .PA
   - SE → .SW
   - LN → .L
   - GY → .XETRA
   - IM → .MI
   - NA → .AS
   - SM → .MC
   - T → .JP
   - HK → .HK

Examples:
- "AAPL UW" → "AAPL.US"
- "SAN FP" → "SAN.PA"
- "ADS GY" → "ADS.XETRA"
- "NESN SE" → "NESN.SW"

IMPORTANT: Always verify eodTicker follows symbol.exchange format exactly.`;
      
      console.log('Sending request to AI...');
      const fullResponse = await callLLMApi([
        {
          role: "system",
          content: "You are a financial document parser specialized in structured products."
        },
        {
          role: "user",
          content: prompt + "\n\nPDF content:\n" + pdfData.text
        }
      ]);
      console.log('Received AI response');

      updateProgress(userId, 'Parsing product data...');
      console.log('Starting to parse AI response...');
      let parsedData;
      try {
        const responseText = fullResponse.data.choices[0].message.content.trim();
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}') + 1;
        const jsonStr = responseText.slice(jsonStart, jsonEnd);
        
        parsedData = JSON.parse(jsonStr);
        console.log('Parsed data successfully');

        if (!parsedData.genericData?.ISINCode || parsedData.genericData.ISINCode !== isin) {
          console.log('Setting correct ISIN:', isin);
          if (!parsedData.genericData) parsedData.genericData = {};
          parsedData.genericData.ISINCode = isin;
        }

      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        console.log('Raw response:', fullResponse.data.choices[0].message.content);
        throw new Meteor.Error('processing-error', 'Failed to parse product data');
      }

      updateProgress(userId, 'Validating product data...');
      parsedData.genericData.issuer = findClosestIssuer(parsedData.genericData.issuer);

      updateProgress(userId, 'Processing underlyings...');
      parsedData.underlyings = parsedData.underlyings.map(underlying => {
        const eodTicker = mapToEODTicker(underlying.ticker);
        return {
          ...underlying,
          eodTicker
        };
      });

      parsedData.genericData.name = "Phoenix on " + parsedData.underlyings
        .map(u => u.eodTicker)
        .join(" / ");

      updateProgress(userId, 'Preparing database...');
      console.log('Inserting product into database...', {
        isin: parsedData.genericData.ISINCode,
        name: parsedData.genericData.name
      });

      try {
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
    } finally {
      Meteor.users.update(this.userId, {
        $unset: { 'processingStatus.inProgress': "" }
      });
    }
  }
});
