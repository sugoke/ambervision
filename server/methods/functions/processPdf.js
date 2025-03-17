import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { check } from 'meteor/check';
import { Products } from '/imports/api/products/products.js';
import { Issuers } from '/imports/api/issuers/issuers.js';
import pdfParse from 'pdf-parse';
import FormData from 'form-data';
import fs from 'fs';
import { Readable } from 'stream';
import request from 'request';

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

const getGeminiKey = () => {
  const key = Meteor.settings?.private?.geminiKey;
  if (!key) throw new Meteor.Error('gemini-key-missing', 'Gemini API key not configured');
  return key;
};

const getMistralKey = () => {
  const key = Meteor.settings?.private?.mistralKey;
  if (!key) throw new Meteor.Error('mistral-key-missing', 'Mistral API key not configured');
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
      model: "gpt-4o",
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

const callOpenAIApi = async (pdfBuffer) => {
  console.log('Calling OpenAI API for ISIN extraction...');
  try {
    // Extract text from PDF first
    const pdfData = await pdfParse(pdfBuffer);
    const pdfTextSample = pdfData.text.substring(0, 500) + '...'; // Sample for logging
    console.log('PDF text sample:', pdfTextSample);
    
    const requestData = {
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: "You are a financial document parser specialized in extracting ISIN codes from PDF documents. An ISIN code is a 12-character alphanumeric code that uniquely identifies a specific securities issue. The format is: 2 letters (country code) + 9 alphanumeric characters + 1 check digit."
        },
        {
          role: "user",
          content: `Extract ONLY the ISIN code from this PDF content. Return ONLY the ISIN code, nothing else. If multiple ISIN codes are found, return the primary one that represents the product. PDF content: ${pdfData.text.substring(0, 15000)}`
        }
      ],
      temperature: 0.1,
      max_tokens: 100,
      response_format: { type: "text" }
    };
    
    console.log('OpenAI request configuration for ISIN extraction');
    
    return await HTTP.call('POST', 'https://api.openai.com/v1/chat/completions', {
      headers: {
        'Authorization': `Bearer ${getOpenAIKey()}`,
        'Content-Type': 'application/json',
      },
      data: requestData
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Meteor.Error('openai-failed', 'OpenAI API call failed');
  }
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

const callMistralApi = async (pdfText, isin) => {
  console.log('Calling Mistral API with PDF text...');
  try {
    // Récupérer les émetteurs connus
    const knownIssuers = getKnownIssuers();
    
    // Utiliser le prompt original
    const prompt = `You are a financial document parser specialized in structured products. Extract data from this termsheet and return a JSON object with this EXACT structure:

{
  "status": "pending",
  "genericData": {
    "ISINCode": "${isin}",  // IMPORTANT: Use this exact ISIN, do not change it
    "currency": "string",
    "issuer": "string", // CRITICAL: The issuer MUST be one of these exact values (nothing else is accepted): ${knownIssuers}. Look for mentions of 'issuer', 'issued by', 'emittent', 'guarantor'. choose the closest match.
     etc.
    "settlementType": "string",
    "settlementTx": "string",
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
    "observationDate": "YYYY-MM-DD", //look for "Observation Date", or "Valuation Date(i)". the first one is usually the same as the trade date
    "paymentDate": "YYYY-MM-DD", //look for "Payment Date(i)" or Interest Payment Date
    "couponBarrierLevel": number, // sometimes in Conditional Coupon section. If the number is negative, do 1 minus this number. For example if the coupon is paid until -60% it means the barrier is 40% below the initial level.
    "autocallLevel": number or null, // IMPORTANT: null means this is a non-call date. This level is sometimes called Autocall Trigger Level. Or sometimes you find it in Knock-In threshold section.
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

IMPORTANT: Always verify eodTicker follows symbol.exchange format exactly. Never return invalid formats like "name.exchange.other" or missing dots.`;

    const userPrompt = `Extract structured data from this PDF content and return a JSON object according to the instructions. PDF content: ${pdfText.substring(0, 20000)}`;
    
    console.log('Sending text to Mistral API...');
    
    const chatResponse = await HTTP.call('POST', 'https://api.mistral.ai/v1/chat/completions', {
      headers: {
        'Authorization': `Bearer ${getMistralKey()}`,
        'Content-Type': 'application/json',
      },
      data: {
        model: "mistral-large-latest",
        messages: [
          {
            role: "system",
            content: prompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: "json_object" }
      },
      timeout: 180000
    });
    
    console.log('Mistral API response status:', chatResponse.statusCode);
    return chatResponse;
  } catch (error) {
    console.error('Mistral API error:', error);
    if (error.response) {
      console.error('Response status:', error.response.statusCode);
      console.error('Response data:', error.response.data);
    }
    throw new Meteor.Error('mistral-failed', 'Mistral API call failed: ' + (error.message || 'Unknown error'));
  }
};

const callMistralApiWithOCR = async (pdfBuffer, isin) => {
  console.log('Calling Mistral API with OCR for PDF...');
  try {
    // Récupérer les émetteurs connus
    const knownIssuers = getKnownIssuers();
    
    // Étape 1: Créer un fichier temporaire pour le PDF
    const tempFilePath = `${process.env.TEMP || 'C:/Windows/Temp'}/document_${Date.now()}.pdf`;
    fs.writeFileSync(tempFilePath, pdfBuffer);
    
    console.log('Temporary file created at:', tempFilePath);
    console.log('Uploading PDF file to Mistral...');
    
    // Étape 2: Uploader le fichier à Mistral avec request
    const fileUploadResponse = await new Promise((resolve, reject) => {
      const formData = {
        file: fs.createReadStream(tempFilePath)
      };
      
      request.post({
        url: 'https://api.mistral.ai/v1/files',
        headers: {
          'Authorization': `Bearer ${getMistralKey()}`
        },
        formData: formData
      }, (error, response, body) => {
        if (error) {
          reject(error);
        } else if (response.statusCode !== 200) {
          reject(new Error(`HTTP error ${response.statusCode}: ${body}`));
        } else {
          try {
            const data = JSON.parse(body);
            resolve({ data });
          } catch (parseError) {
            reject(new Error(`Failed to parse response: ${parseError.message}`));
          }
        }
      });
    });
    
    console.log('File upload response:', JSON.stringify(fileUploadResponse.data, null, 2));
    const fileId = fileUploadResponse.data.id;
    
    // Utiliser le prompt original
    const prompt = `You are a financial document parser specialized in structured products. Extract data from this termsheet and return a JSON object with this EXACT structure:

{
  "status": "pending",
  "genericData": {
    "ISINCode": "${isin}",  // IMPORTANT: Use this exact ISIN, do not change it
    "currency": "string",
    "issuer": "string", // CRITICAL: The issuer MUST be one of these exact values (nothing else is accepted): ${knownIssuers}. Look for mentions of 'issuer', 'issued by', 'emittent', 'guarantor'. choose the closest match.
     etc.
    "settlementType": "string",
    "settlementTx": "string",
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
    "observationDate": "YYYY-MM-DD", //look for "Observation Date", or "Valuation Date(i)". the first one is usually the same as the trade date
    "paymentDate": "YYYY-MM-DD", //look for "Payment Date(i)" or Interest Payment Date
    "couponBarrierLevel": number, // sometimes in Conditional Coupon section. If the number is negative, do 1 minus this number. For example if the coupon is paid until -60% it means the barrier is 40% below the initial level.
    "autocallLevel": number or null, // IMPORTANT: null means this is a non-call date. This level is sometimes called Autocall Trigger Level. Or sometimes you find it in Knock-In threshold section.
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

IMPORTANT: Always verify eodTicker follows symbol.exchange format exactly. Never return invalid formats like "name.exchange.other" or missing dots.`;

    console.log('Sending chat completion request with file reference...');
    
    // Étape 4: Utiliser le fichier dans une requête de chat
    const chatResponse = await HTTP.call('POST', 'https://api.mistral.ai/v1/chat/completions', {
      headers: {
        'Authorization': `Bearer ${getMistralKey()}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: "mistral-large-latest",
        messages: [
          {
            role: "system",
            content: prompt
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract structured data from this PDF document and return a JSON object according to the instructions." },
              { type: "file", file_id: fileId }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: "json_object" }
      },
      timeout: 180000
    });
    
    console.log('Mistral API response status:', chatResponse.statusCode);
    
    // Étape 5: Supprimer le fichier temporaire local
    try {
      fs.unlinkSync(tempFilePath);
      console.log('Temporary file deleted');
    } catch (unlinkError) {
      console.error('Error deleting temporary file:', unlinkError);
    }
    
    // Étape 6: Supprimer le fichier de Mistral
    try {
      await new Promise((resolve, reject) => {
        request.delete({
          url: `https://api.mistral.ai/v1/files/${fileId}`,
          headers: {
            'Authorization': `Bearer ${getMistralKey()}`
          }
        }, (error, response, body) => {
          if (error) {
            console.error('Error deleting file from Mistral:', error);
          } else if (response.statusCode !== 200) {
            console.error(`HTTP error ${response.statusCode} when deleting file:`, body);
          } else {
            console.log('File deleted from Mistral');
          }
          resolve(); // Always resolve to continue execution
        });
      });
    } catch (deleteError) {
      console.error('Error in delete file promise:', deleteError);
    }
    
    return chatResponse;
  } catch (error) {
    console.error('Mistral API error:', error);
    if (error.response) {
      console.error('Response status:', error.response.statusCode);
      console.error('Response data:', error.response.data);
    }
    throw new Meteor.Error('mistral-failed', 'Mistral API with OCR failed: ' + (error.message || 'Unknown error'));
  }
};

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
      // Utiliser OpenAI pour extraire l'ISIN
      const isinResponse = await callOpenAIApi(fileData);

      let isin;
      try {
        const responseText = isinResponse.data.choices?.[0]?.message?.content || '';
        console.log('Response text from OpenAI for ISIN extraction:', responseText);
        
        // Extract ISIN using regex
        const isinMatch = responseText.match(/[A-Z]{2}[A-Z0-9]{10}/);
        isin = isinMatch ? isinMatch[0] : null;
        console.log('ISIN from regex match:', isin);
      } catch (error) {
        console.error('ISIN extraction error:', error);
        if (error.response) {
          console.error('Response status:', error.response.statusCode);
          console.error('Response data:', error.response.data);
        }
        throw new Meteor.Error('processing-error', 'Failed to extract valid ISIN code: ' + (error.message || 'Unknown error'));
      }

      updateProgress(userId, 'Validating ISIN format...');
      if (isin === null) {
        console.error('No valid ISIN found in document');
        throw new Meteor.Error('processing-error', 'No valid ISIN found in document');
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
      
      updateProgress(userId, 'Processing with AI and OCR...');
      console.log('Preparing Mistral API request with OCR...');
      
      const response = await callMistralApiWithOCR(fileData, isin);
      
      // Parse Mistral response
      let parsedData;
      try {
        const responseText = response.data.choices?.[0]?.message?.content || '';
        console.log('Response text from Mistral OCR:', responseText);
        
        try {
          parsedData = JSON.parse(responseText);
          console.log('Parsed data object:', JSON.stringify(parsedData, null, 2));
        } catch (jsonError) {
          console.error('JSON parse error:', jsonError);
          console.error('Invalid JSON response:', responseText);
          throw new Meteor.Error('invalid-json', 'Failed to parse JSON response from Mistral');
        }
        
        if (!parsedData.genericData) {
          console.error('Missing genericData in response');
          throw new Meteor.Error('invalid-data', 'Response missing required genericData field');
        }
        
        if (!parsedData.genericData?.ISINCode || parsedData.genericData.ISINCode !== isin) {
          console.log('Setting correct ISIN:', isin);
          if (!parsedData.genericData) parsedData.genericData = {};
          parsedData.genericData.ISINCode = isin;
        }

      } catch (parseError) {
        console.error('Parse error:', parseError);
        if (parseError.response) {
          console.error('Response status:', parseError.response.statusCode);
          console.error('Response data:', parseError.response.data);
        }
        throw new Meteor.Error('processing-error', 'Failed to parse product data: ' + (parseError.message || 'Unknown error'));
      }

      updateProgress(userId, 'Validating product data...');
      
      // Match issuer name
      parsedData.genericData.issuer = findClosestIssuer(parsedData.genericData.issuer);

      updateProgress(userId, 'Processing underlyings...');
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
