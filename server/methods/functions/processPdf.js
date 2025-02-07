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

const getGeminiKey = () => {
  const key = Meteor.settings?.private?.geminiKey;
  if (!key) throw new Meteor.Error('gemini-key-missing', 'Gemini API key not configured');
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

const callGeminiApi = async (pdfBuffer) => {
  console.log('Calling Gemini API with direct PDF...');
  try {
    return await HTTP.call('POST', 'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent', {
      headers: {
        'Authorization': `Bearer ${getGeminiKey()}`,
        'Content-Type': 'application/json',
      },
      data: {
        contents: [{
          parts: [{
            text: `Extract data from this PDF and return a valid JSON object.`
          }, {
            inline_data: {
              mime_type: "application/pdf",
              data: Buffer.from(pdfBuffer).toString('base64')
            }
          }]
        }],
        safety_settings: {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE"
        },
        generation_config: {
          temperature: 0.1,
          top_p: 1,
          top_k: 1,
          max_output_tokens: 2048,
          stop_sequences: []
        }
      }
    });
  } catch (error) {
    console.error('Gemini API error:', error);
    throw new Meteor.Error('gemini-failed', 'Gemini API call failed');
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
      const isinResponse = await callGeminiApi(fileData);

      let isin;
      try {
        const responseText = isinResponse.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 
                            isinResponse.data.choices?.[0]?.message?.content?.trim();
        
        // Extract ISIN using regex
        const isinMatch = responseText.match(/[A-Z]{2}[A-Z0-9]{10}/);
        isin = isinMatch ? isinMatch[0] : null;
        
        if (!isin) {
          console.error('No valid ISIN found in response:', responseText);
          throw new Error('No valid ISIN found');
        }
        
        console.log('Extracted ISIN:', isin);
      } catch (error) {
        console.error('ISIN extraction error:', error);
        throw new Meteor.Error('processing-error', 'Failed to extract valid ISIN code');
      }

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
      console.log('Preparing Gemini request...');
      
      const response = await callGeminiApi(fileData);
      
      // Parse Gemini response
      let parsedData;
      try {
        const responseText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || 
                           response.data.choices?.[0]?.message?.content;
        
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}') + 1;
        const jsonStr = responseText.slice(jsonStart, jsonEnd);
        
        parsedData = JSON.parse(jsonStr);
        
        if (!parsedData.genericData?.ISINCode || parsedData.genericData.ISINCode !== isin) {
          console.log('Setting correct ISIN:', isin);
          if (!parsedData.genericData) parsedData.genericData = {};
          parsedData.genericData.ISINCode = isin;
        }

      } catch (parseError) {
        console.error('Parse error:', parseError);
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
