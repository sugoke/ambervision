import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { ProductsCollection } from './products';
import { EODApiHelpers } from './eodApi';
import { validateISIN } from '../utils/isinValidator';

/**
 * ISIN Smart Classifier
 *
 * Three-tier classification system:
 * 1. Internal structured products lookup (highest confidence)
 * 2. Anthropic AI classification (intelligent analysis)
 * 3. Online ISIN database lookup (factual data)
 */

// Anthropic API configuration
const ANTHROPIC_API_KEY = Meteor.settings.private?.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

/**
 * Map ISIN country codes to country names and typical exchanges/currencies
 */
function getCountryFromCode(code) {
  const countryMap = {
    // Major financial centers
    'US': 'United States',
    'GB': 'United Kingdom',
    'DE': 'Germany',
    'FR': 'France',
    'CH': 'Switzerland',
    'JP': 'Japan',
    'CA': 'Canada',
    'AU': 'Australia',
    'HK': 'Hong Kong',
    'SG': 'Singapore',
    // European countries
    'AT': 'Austria',
    'BE': 'Belgium',
    'NL': 'Netherlands',
    'IT': 'Italy',
    'ES': 'Spain',
    'PT': 'Portugal',
    'IE': 'Ireland',
    'LU': 'Luxembourg',
    'DK': 'Denmark',
    'SE': 'Sweden',
    'NO': 'Norway',
    'FI': 'Finland',
    // Asia-Pacific
    'CN': 'China',
    'IN': 'India',
    'KR': 'South Korea',
    'TW': 'Taiwan',
    // Special codes
    'XS': 'International (Euroclear/Clearstream)',
    'XF': 'International Fund',
    'EU': 'European Union'
  };
  return countryMap[code] || `Unknown (${code})`;
}

/**
 * Call Anthropic Claude API for ISIN classification
 */
async function callAnthropicAPI(prompt, maxTokens = 1500) {
  if (!ANTHROPIC_API_KEY) {
    throw new Meteor.Error('anthropic-config-error', 'Anthropic API key not configured');
  }

  try {
    const response = await HTTP.post(ANTHROPIC_API_URL, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      data: {
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
        // Note: Extended thinking removed - not supported by API
      }
    });

    if (response.data && response.data.content && response.data.content.length > 0) {
      const textContent = response.data.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      return textContent;
    }

    throw new Error('Invalid response from Anthropic API');
  } catch (error) {
    console.error('[ISINClassifier] Anthropic API error:', error);
    throw new Meteor.Error('anthropic-call-failed', `AI classification failed: ${error.message}`);
  }
}

/**
 * TIER 1: Extract classification data from internal structured product
 */
export const ISINClassifierHelpers = {
  /**
   * Check if ISIN matches an internal structured product
   */
  async extractProductClassification(isin) {
    if (!isin) return null;

    const product = await ProductsCollection.findOneAsync({ isin: isin.toUpperCase() });
    if (!product) return null;

    console.log(`[ISINClassifier] Found internal product: ${product.title}`);

    // Map template IDs to product types
    const productTypeMap = {
      'phoenix': 'Phoenix Autocallable',
      'orion': 'Orion Autocallable',
      'himalaya': 'Himalaya Autocallable',
      'participation_note': 'Participation Note',
      'shark_note': 'Shark Note',
      'reverse_convertible': 'Reverse Convertible',
      'reverse_convertible_bond': 'Reverse Convertible Bond'
    };

    // Template-based classification for underlying type and protection
    // Phoenix, Orion, Himalaya are equity-based
    // Himalaya & Orion are 100% capital guaranteed
    // Phoenix is conditionally guaranteed (barrier protected)
    const templateClassification = {
      'phoenix': {
        underlyingType: 'equity_linked',
        protectionType: 'capital_protected_conditional',
        capitalGuaranteed100: false,
        capitalGuaranteedPartial: false,
        barrierProtected: true
      },
      'orion': {
        underlyingType: 'equity_linked',
        protectionType: 'capital_guaranteed_100',
        capitalGuaranteed100: true,
        capitalGuaranteedPartial: false,
        barrierProtected: false
      },
      'himalaya': {
        underlyingType: 'equity_linked',
        protectionType: 'capital_guaranteed_100',
        capitalGuaranteed100: true,
        capitalGuaranteedPartial: false,
        barrierProtected: false
      }
    };

    const productType = productTypeMap[product.templateId] || product.templateId;
    const templateConfig = templateClassification[product.templateId];

    // Extract barrier and protection levels from structure parameters
    const params = product.structureParameters || {};
    const hasProtection = params.protectionBarrier != null && params.protectionBarrier > 0;
    const hasBarrier = params.autocallBarrier != null || params.barrierLevel != null;

    // Use template-based classification if available, otherwise fall back to parameter-based logic
    const capitalGuaranteed100 = templateConfig ? templateConfig.capitalGuaranteed100 : (params.protectionBarrier === 100);
    const capitalGuaranteedPartial = templateConfig ? templateConfig.capitalGuaranteedPartial : (hasProtection && params.protectionBarrier < 100);
    const barrierProtected = templateConfig ? templateConfig.barrierProtected : hasBarrier;
    const underlyingType = templateConfig ? templateConfig.underlyingType : '';
    const protectionType = templateConfig ? templateConfig.protectionType : '';

    return {
      source: 'internal_product',
      confidence: 'high',
      confidenceScore: 100,
      data: {
        securityName: product.title,
        assetClass: 'structured_product',
        productType: productType,
        issuer: product.issuer || '',
        currency: product.currency || '',
        maturityDate: product.maturityDate || null,
        couponRate: params.couponRate || null,

        // Structured product classification
        structuredProductUnderlyingType: underlyingType,
        structuredProductProtectionType: protectionType,

        // Capital protection
        capitalGuaranteed100: capitalGuaranteed100,
        capitalGuaranteedPartial: capitalGuaranteedPartial,
        guaranteedLevel: hasProtection ? params.protectionBarrier : (capitalGuaranteed100 ? 100 : null),
        barrierProtected: barrierProtected,
        barrierLevel: params.autocallBarrier || params.barrierLevel || null,

        // Additional metadata
        sector: 'Structured Products',
        notes: `Automatically classified from internal product database. Template: ${product.templateId}.`
      },
      explanation: `This ISIN matches an internal structured product: ${product.title}. All data extracted from product configuration.`
    };
  },

  /**
   * TIER 2: Classify using Anthropic AI knowledge base
   */
  async classifyWithAnthropicAI(isin, existingData = {}) {
    if (!isin) {
      throw new Meteor.Error('invalid-isin', 'ISIN is required');
    }

    // Validate ISIN format
    const validation = validateISIN(isin);
    if (!validation.valid) {
      throw new Meteor.Error('invalid-isin', validation.error);
    }

    console.log(`[ISINClassifier] Requesting AI classification for ISIN: ${isin}`);

    // Extract country code from ISIN for context
    const countryCode = isin.substring(0, 2);
    const countryHint = getCountryFromCode(countryCode);

    // Build structured prompt using Claude's knowledge base
    const prompt = `You are a financial securities classifier. Classify this ISIN using your knowledge of financial markets.

ISIN: ${isin}
Country Code: ${countryCode} (${countryHint})
${existingData.securityName ? `Security Name Hint: ${existingData.securityName}` : ''}
${existingData.securityType ? `Security Type Hint: ${existingData.securityType}` : ''}
${existingData.currency ? `Currency Hint: ${existingData.currency}` : ''}

TASK: Based on your training data and knowledge of financial instruments, classify this security.

ISIN STRUCTURE ANALYSIS:
- First 2 characters (${countryCode}): Country of issuance
- Characters 3-11: National Securities Identifying Number (NSIN)
- Last character: Check digit

CLASSIFICATION GUIDELINES:
1. If you recognize this ISIN from your training data (well-known stocks, bonds, ETFs), provide full details
2. If you don't recognize the specific ISIN, use the country code and any name hints to make educated guesses
3. ISINs starting with XS are typically international bonds/structured products
4. ISINs starting with CH are Swiss securities (often structured products from Swiss banks)
5. ISINs starting with US are American securities
6. ISINs starting with DE are German securities

Respond with a JSON object. Use ONLY the exact values specified in brackets for dropdown fields:

{
  "securityName": "Name of security if known, or best guess based on hints, or empty string",
  "assetClass": "MUST BE ONE OF: [structured_product, equity, fixed_income, private_equity, fund, etf, alternative, commodity, monetary_products, other]",
  "assetSubClass": "More specific type (e.g., Common Stock, Corporate Bond, Index Fund, etc.)",
  "sector": "MUST BE ONE OF: [technology, financials, healthcare, consumer_discretionary, consumer_staples, industrials, materials, energy, utilities, real_estate, communication_services] or empty string if not applicable/unknown",
  "industry": "Specific industry if known, or empty string",
  "issuer": "Issuing entity if known (e.g., UBS, Credit Suisse, Apple Inc), or empty string",
  "listingCountry": "${countryHint}",
  "listingExchange": "PREFER ONE OF: [SIX, NYSE, NASDAQ, LSE, XETRA, EURONEXT, TSE, HKEX] based on country, or empty string",
  "currency": "Trading currency ISO code based on country (CHF for Swiss, USD for US, EUR for DE, etc.)",
  "isStructuredProduct": true/false,
  "structuredProductUnderlyingType": "IF structured product, MUST BE ONE OF: [equity_linked, fixed_income_linked, credit_linked, commodities_linked] or empty string",
  "structuredProductProtectionType": "IF structured product, MUST BE ONE OF: [capital_guaranteed_100, capital_guaranteed_partial, capital_protected_conditional, other_protection] or empty string",
  "productType": "If structured product, specify type if known (e.g., Autocallable, Reverse Convertible)",
  "maturityDate": "Only if known from training data, format YYYY-MM-DD, otherwise null",
  "couponRate": "Only if known from training data, otherwise null",
  "confidenceLevel": "high if you recognize this specific ISIN, medium if you can classify based on patterns, low if mostly guessing",
  "explanation": "Explain your reasoning: Do you recognize this ISIN? What patterns helped you classify it?"
}

IMPORTANT:
1. Be honest about confidence - use "low" if guessing
2. Use country code to infer listing country, exchange, and currency
3. CH + bank name hint usually means Swiss structured product
4. XS ISINs are typically international bonds or structured products
5. Only provide fields you have reasonable confidence in`;

    try {
      const response = await callAnthropicAPI(prompt, 1500);

      // Extract JSON from response (may be wrapped in markdown code blocks)
      let jsonText = response;
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      } else if (response.includes('{') && response.includes('}')) {
        // Try to extract JSON object
        const startIdx = response.indexOf('{');
        const endIdx = response.lastIndexOf('}') + 1;
        jsonText = response.substring(startIdx, endIdx);
      }

      const aiResult = JSON.parse(jsonText);

      console.log('[ISINClassifier] AI returned classification:', {
        assetClass: aiResult.assetClass,
        securityName: aiResult.securityName,
        confidenceLevel: aiResult.confidenceLevel,
        explanation: aiResult.explanation?.substring(0, 100)
      });

      // Map AI confidence to our scale
      const confidenceMap = {
        'high': 90,
        'medium': 70,
        'low': 50
      };

      return {
        source: 'ai_analysis',
        confidence: aiResult.confidenceLevel || 'medium',
        confidenceScore: confidenceMap[aiResult.confidenceLevel] || 70,
        data: {
          securityName: aiResult.securityName || existingData.securityName || '',
          assetClass: aiResult.assetClass || '',
          assetSubClass: aiResult.assetSubClass || '',
          sector: aiResult.sector || '',
          industry: aiResult.industry || '',
          issuer: aiResult.issuer || '',
          listingCountry: aiResult.listingCountry || '',
          listingExchange: aiResult.listingExchange || '',
          currency: aiResult.currency || '',
          productType: aiResult.isStructuredProduct ? aiResult.productType : '',
          maturityDate: aiResult.maturityDate || null,
          couponRate: aiResult.couponRate || null,
          structuredProductUnderlyingType: aiResult.structuredProductUnderlyingType || '',
          structuredProductProtectionType: aiResult.structuredProductProtectionType || '',
          notes: `AI classification on ${new Date().toISOString().split('T')[0]}. ${aiResult.explanation || ''}`
        },
        explanation: aiResult.explanation || 'AI analysis completed based on ISIN structure and knowledge base'
      };
    } catch (error) {
      console.error('[ISINClassifier] AI classification error:', error);
      console.error('[ISINClassifier] Raw response was:', response?.substring(0, 500));
      throw new Meteor.Error('ai-classification-failed', `Failed to classify with AI: ${error.message}`);
    }
  },

  /**
   * TIER 3: Look up ISIN in online databases
   */
  async lookupISINOnline(isin) {
    if (!isin) {
      throw new Meteor.Error('invalid-isin', 'ISIN is required');
    }

    console.log(`[ISINClassifier] Looking up ISIN online: ${isin}`);

    try {
      // Try EOD API search with ISIN
      const results = await EODApiHelpers.searchSecurities(isin, 5);

      if (!results || results.length === 0) {
        throw new Meteor.Error('not-found', 'ISIN not found in online databases');
      }

      // Find exact ISIN match
      const exactMatch = results.find(r => r.ISIN === isin.toUpperCase());
      const match = exactMatch || results[0];

      console.log(`[ISINClassifier] Found online match: ${match.Name} (${match.Exchange})`);

      // Map EOD security type to our asset classes
      const typeMap = {
        'Common Stock': 'equity',
        'Preferred Stock': 'equity',
        'ETF': 'etf',
        'Index': 'derivative',
        'Bond': 'bond',
        'Mutual Fund': 'fund',
        'Commodity': 'alternative'
      };

      const assetClass = typeMap[match.Type] || 'other';

      return {
        source: 'online_database',
        confidence: exactMatch ? 'medium' : 'low',
        confidenceScore: exactMatch ? 75 : 60,
        data: {
          securityName: match.Name || '',
          assetClass: assetClass,
          assetSubClass: match.Type || '',
          listingExchange: match.Exchange || '',
          listingCountry: match.Country || '',
          currency: match.Currency || '',
          sector: '',
          industry: '',
          issuer: '',
          notes: `Retrieved from EOD Historical Data on ${new Date().toISOString().split('T')[0]}. Exchange: ${match.Exchange}.`
        },
        explanation: `Found in online database: ${match.Name} (${match.Type}) listed on ${match.Exchange}`
      };
    } catch (error) {
      console.error('[ISINClassifier] Online lookup error:', error);
      throw new Meteor.Error('online-lookup-failed', `Failed to lookup ISIN online: ${error.message}`);
    }
  },

  /**
   * Check if a field is empty/missing
   */
  isFieldEmpty(value) {
    return value === null ||
           value === undefined ||
           value === '' ||
           (typeof value === 'string' && value.trim() === '');
  },

  /**
   * Get description for field to help AI understand what to search for
   */
  getFieldDescription(fieldName) {
    const descriptions = {
      'securityName': 'Full official name of the security',
      'assetClass': 'Type of asset (equity, fixed_income, fund, etf, structured_product, etc.)',
      'assetSubClass': 'More specific asset type (e.g., Common Stock, Corporate Bond, Index Fund)',
      'sector': 'GICS sector (e.g., technology, financials, healthcare)',
      'industry': 'Specific industry within sector',
      'issuer': 'Full legal name of company or entity that issued the security',
      'listingExchange': 'Primary exchange where traded (e.g., NYSE, NASDAQ, SIX, LSE)',
      'listingCountry': 'Country of primary listing (full country name)',
      'currency': 'Trading currency (ISO code like USD, EUR, CHF)',
      'productType': 'Specific product type name (e.g., Reverse Convertible, Autocallable)',
      'maturityDate': 'Maturity/expiration date in YYYY-MM-DD format',
      'couponRate': 'Annual coupon or interest rate as percentage number',
      'structuredProductUnderlyingType': 'Type of underlying asset for structured products',
      'structuredProductProtectionType': 'Level of capital protection for structured products'
    };
    return descriptions[fieldName] || fieldName;
  },

  /**
   * Enrich missing fields using AI knowledge base
   */
  async enrichMissingFields(isin, partialData) {
    console.log('[ISINClassifier] Checking fields for enrichment...');
    console.log('[ISINClassifier] Current data:', JSON.stringify(partialData, null, 2));

    // Identify missing/empty fields - expanded list
    const missingFields = [];
    const importantFields = [
      'securityName',
      'assetClass',
      'assetSubClass',
      'sector',
      'industry',
      'issuer',
      'listingExchange',
      'listingCountry',
      'currency',
      'productType',
      'maturityDate',
      'couponRate',
      'structuredProductUnderlyingType',
      'structuredProductProtectionType'
    ];

    for (const field of importantFields) {
      const fieldValue = partialData[field];
      console.log(`[ISINClassifier] Checking ${field}: "${fieldValue}" (empty: ${this.isFieldEmpty(fieldValue)})`);

      if (this.isFieldEmpty(fieldValue)) {
        missingFields.push(field);
      }
    }

    if (missingFields.length === 0) {
      console.log('[ISINClassifier] No missing fields to enrich - all fields have values');
      return partialData;
    }

    console.log('[ISINClassifier] Found missing fields:', missingFields.join(', '));

    // Extract country code for hints
    const countryCode = isin.substring(0, 2);
    const countryHint = getCountryFromCode(countryCode);

    // Build targeted prompt for missing fields with dropdown constraints
    const prompt = `You are a financial securities expert. Based on the partial information provided, fill in the missing fields using your knowledge of financial markets.

ISIN: ${isin}
Country Code: ${countryCode} (${countryHint})

Current information:
- Security Name: ${partialData.securityName || 'Unknown'}
- Asset Class: ${partialData.assetClass || 'Unknown'}
- Asset Sub-Class: ${partialData.assetSubClass || 'Unknown'}
- Sector: ${partialData.sector || 'Unknown'}
- Currency: ${partialData.currency || 'Unknown'}
- Exchange: ${partialData.listingExchange || 'Unknown'}
- Country: ${partialData.listingCountry || 'Unknown'}
- Issuer: ${partialData.issuer || 'Unknown'}

Using the ISIN country code and any known information above, provide reasonable values for these missing fields:
${missingFields.map(f => `- ${f}: ${this.getFieldDescription(f)}`).join('\n')}

INFERENCE RULES:
- Use country code to infer listingCountry (${countryCode} = ${countryHint})
- Infer currency from country (CH=CHF, US=USD, GB=GBP, DE/FR/IT/ES/NL=EUR, JP=JPY)
- Infer exchange from country (CH=SIX, US=NYSE/NASDAQ, GB=LSE, DE=XETRA)
- If asset class is known, use it to guide sector/industry guesses
- For structured products from Swiss banks (CH ISINs), assume equity_linked unless otherwise indicated

CONSTRAINTS (use EXACTLY these values for dropdown fields):
- assetClass: [structured_product, equity, fixed_income, private_equity, fund, etf, alternative, commodity, monetary_products, other]
- sector: [technology, financials, healthcare, consumer_discretionary, consumer_staples, industrials, materials, energy, utilities, real_estate, communication_services] or ""
- listingExchange: [SIX, NYSE, NASDAQ, LSE, XETRA, EURONEXT, TSE, HKEX] or ""
- structuredProductUnderlyingType: [equity_linked, fixed_income_linked, credit_linked, commodities_linked] or ""
- structuredProductProtectionType: [capital_guaranteed_100, capital_guaranteed_partial, capital_protected_conditional, other_protection] or ""

Respond with ONLY a JSON object. Use "" (empty string) if you cannot reasonably infer a value.

{
  ${missingFields.map(f => `"${f}": "value here"`).join(',\n  ')}
}`;

    try {
      const response = await callAnthropicAPI(prompt, 1000);

      // Extract JSON from response
      let jsonText = response;
      const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      } else if (response.includes('{') && response.includes('}')) {
        const startIdx = response.indexOf('{');
        const endIdx = response.lastIndexOf('}') + 1;
        jsonText = response.substring(startIdx, endIdx);
      }

      const enrichedFields = JSON.parse(jsonText);

      // Merge enriched fields with partial data
      const enrichedData = { ...partialData };
      for (const field of missingFields) {
        if (enrichedFields[field]) {
          enrichedData[field] = enrichedFields[field];
        }
      }

      console.log('[ISINClassifier] Successfully enriched fields:', Object.keys(enrichedFields).filter(k => enrichedFields[k]));
      return enrichedData;

    } catch (error) {
      console.warn('[ISINClassifier] Field enrichment failed:', error.message);
      return partialData; // Return original data if enrichment fails
    }
  },

  /**
   * Smart classification - tries all three tiers in order, then enriches missing fields
   */
  async smartClassify(isin, existingData = {}) {
    if (!isin) {
      throw new Meteor.Error('invalid-isin', 'ISIN is required');
    }

    // Clean and validate ISIN
    const cleanIsin = isin.trim().toUpperCase().replace(/\s/g, '');
    const validation = validateISIN(cleanIsin);
    if (!validation.valid) {
      throw new Meteor.Error('invalid-isin', validation.error);
    }

    console.log(`[ISINClassifier] Starting smart classification for: ${cleanIsin}`);

    let result = null;

    // TIER 1: Check internal structured products
    try {
      const productResult = await this.extractProductClassification(cleanIsin);
      if (productResult) {
        console.log('[ISINClassifier] ✓ Classified from internal product (Tier 1)');
        result = productResult;
      }
    } catch (error) {
      console.warn('[ISINClassifier] Tier 1 failed:', error.message);
    }

    // TIER 2: AI classification (if Tier 1 didn't find it)
    if (!result) {
      try {
        const aiResult = await this.classifyWithAnthropicAI(cleanIsin, existingData);
        console.log('[ISINClassifier] ✓ Classified with AI analysis (Tier 2)');
        result = aiResult;
      } catch (error) {
        console.warn('[ISINClassifier] Tier 2 failed:', error.message);
      }
    }

    // TIER 3: Online database lookup (if Tier 2 failed)
    if (!result) {
      try {
        const onlineResult = await this.lookupISINOnline(cleanIsin);
        console.log('[ISINClassifier] ✓ Classified from online database (Tier 3)');
        result = onlineResult;
      } catch (error) {
        console.warn('[ISINClassifier] Tier 3 failed:', error.message);
      }
    }

    // If all tiers failed, throw error
    if (!result) {
      throw new Meteor.Error(
        'classification-failed',
        'Unable to classify ISIN. All classification methods failed. Please classify manually.'
      );
    }

    // ENRICHMENT PASS: Fill in missing fields with AI inference
    console.log('[ISINClassifier] Starting enrichment pass...');
    try {
      const enrichedData = await this.enrichMissingFields(cleanIsin, result.data);
      result.data = enrichedData;

      // Update explanation to mention enrichment
      if (result.explanation && result.data) {
        const enrichedFields = ['assetClass', 'assetSubClass', 'sector', 'industry', 'issuer', 'listingExchange', 'listingCountry', 'currency']
          .filter(field => result.data[field] && result.data[field] !== '');

        if (enrichedFields.length > 0) {
          result.explanation += ` Additional fields inferred via AI: ${enrichedFields.join(', ')}.`;
        }
      }

      console.log('[ISINClassifier] Enrichment complete');
    } catch (enrichError) {
      console.error('[ISINClassifier] Enrichment failed:', enrichError);
      console.error('[ISINClassifier] Error details:', enrichError.message, enrichError.stack);
    }

    console.log('[ISINClassifier] Final classification result:', {
      source: result.source,
      confidence: result.confidence,
      dataFields: Object.keys(result.data).filter(k => result.data[k] && result.data[k] !== '')
    });

    return result;
  }
};
