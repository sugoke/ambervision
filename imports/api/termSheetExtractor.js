import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { HTTP } from 'meteor/http';
import { ProductsCollection } from './products';
import { SessionHelpers } from './sessions';
import { IssuersCollection } from './issuers';

// Anthropic API configuration (same as riskAnalysis.js)
const ANTHROPIC_API_KEY = Meteor.settings.private?.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

if (Meteor.isServer) {
  /**
   * Call Anthropic Claude API to extract data from term sheet
   * @param {string} pdfBase64 - Base64 encoded PDF data
   * @param {Object} templateStructure - Example product structure to match
   * @param {Array} issuerList - List of valid issuers to match against
   * @returns {Promise<Object>} - Extracted product data
   */
  async function callAnthropicForExtraction(pdfBase64, templateStructure, issuerList) {
    if (!ANTHROPIC_API_KEY) {
      throw new Meteor.Error('anthropic-config-error', 'Anthropic API key not configured in settings.json');
    }

    try {
      console.log('[TermSheetExtractor] Calling Anthropic API...');

      const extractionPrompt = `You are a structured products data extraction expert.

I will provide you with a term sheet document and a JSON schema that you must follow EXACTLY.

TASK:
Extract all relevant information from the term sheet and return a JSON object that matches the provided schema structure.

SCHEMA TO FOLLOW:
${JSON.stringify(templateStructure, null, 2)}

VALID ISSUERS LIST (match the issuer name from the term sheet to the CLOSEST match in this list):
${issuerList.map(i => `- ${i.name} (${i.country})`).join('\n')}

EXTRACTION RULES:
1. Match the exact field names and structure from the schema
2. For dates: use ISO format "YYYY-MM-DD"
3. For underlyings: extract ticker, name, ISIN, initial prices (strike prices)
   - Set the "strike" field to the initial/strike price from the term sheet
   - DO NOT populate securityData.price - leave it null (current market prices will be fetched separately)
   - Only populate: ticker, name, isin, strike, and basic securityData (symbol, name, exchange, currency, country)
4. For barriers: extract all levels as percentages (e.g., 70 for 70%)
5. For observation schedule: generate all observation dates based on frequency and dates found in term sheet
6. For structure and payoffStructure: create the appropriate components based on product type
7. If a field is not found in the term sheet, use null or empty array
8. Do NOT add fields that are not in the schema
9. Do NOT modify the structure or field names
10. For coupon rates, autocall levels, protection barriers: extract exact percentages
11. For memory coupon/autocall: detect from term sheet language (e.g., "memory", "cumulative")
12. For issuer: MUST select the closest match from the VALID ISSUERS LIST provided above (use exact name from list)
13. For observationSchedule: calculate dates based on frequency (quarterly, monthly, etc.)
14. Generate appropriate schedule IDs as "period_0", "period_1", etc.
15. For scheduleConfig.stepDownValue - CRITICAL CALCULATION:
    - This is the CHANGE PER PERIOD (not total change)
    - Calculate: stepDownValue = (Level at Period N+1) - (Level at Period N)
    - EXAMPLE 1: If term sheet shows autocall at 100%, 95%, 90%, 85%:
      * Change from 100% to 95% = -5
      * Change from 95% to 90% = -5
      * Change from 90% to 85% = -5
      * Therefore: stepDownValue = -5 (NOT -15, which would be total change)
    - EXAMPLE 2: If term sheet shows autocall at 100%, 105%, 110%:
      * Change from 100% to 105% = +5
      * Therefore: stepDownValue = +5
    - EXAMPLE 3: If term sheet shows flat autocall at 100%, 100%, 100%:
      * No change between periods
      * Therefore: stepDownValue = 0
16. For underlyings array: each underlying must have a "strike" field containing the initial price/strike price

CRITICAL: Return ONLY the JSON object with no additional text, explanations, or markdown formatting.`;

      const response = await HTTP.post(ANTHROPIC_API_URL, {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        data: {
          model: ANTHROPIC_MODEL,
          max_tokens: 16000, // Larger for complex products
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: pdfBase64
                  }
                },
                {
                  type: "text",
                  text: extractionPrompt
                }
              ]
            }
          ],
          // Enable extended thinking for better analysis
          thinking: {
            type: 'enabled',
            budget_tokens: 3000
          }
        }
      });

      if (response.data && response.data.content && response.data.content.length > 0) {
        // Extract text from response (filter out thinking blocks)
        const textContent = response.data.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');

        console.log('[TermSheetExtractor] Raw response:', textContent.substring(0, 200) + '...');

        // Parse JSON response
        let extractedData;
        try {
          // Try to parse directly
          extractedData = JSON.parse(textContent);
        } catch (parseError) {
          // Try to extract JSON from markdown code blocks
          const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            extractedData = JSON.parse(jsonMatch[1]);
          } else {
            // Try to find JSON object in the text
            const jsonStart = textContent.indexOf('{');
            const jsonEnd = textContent.lastIndexOf('}') + 1;
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
              extractedData = JSON.parse(textContent.substring(jsonStart, jsonEnd));
            } else {
              throw parseError;
            }
          }
        }

        console.log('[TermSheetExtractor] Successfully parsed extracted data');
        return extractedData;
      }

      throw new Error('Invalid response from Anthropic API');
    } catch (error) {
      console.error('[TermSheetExtractor] Anthropic API error:', error);

      if (error.response) {
        const status = error.response.statusCode;
        const message = error.response.data?.error?.message || 'Unknown error';

        if (status === 401) {
          throw new Meteor.Error('anthropic-auth-failed', 'Invalid Anthropic API key');
        } else if (status === 429) {
          throw new Meteor.Error('anthropic-rate-limit', 'Anthropic API rate limit exceeded. Please wait a moment and try again.');
        } else {
          throw new Meteor.Error('anthropic-api-error', `Anthropic API error: ${message}`);
        }
      }

      throw new Meteor.Error('anthropic-call-failed', `Failed to call Anthropic API: ${error.message}`);
    }
  }

  Meteor.methods({
    /**
     * Extract structured product data from term sheet PDF
     * @param {string} fileData - Base64 encoded PDF data
     * @param {string} templateId - Template ID to use for structure reference
     * @param {string} sessionId - User session ID
     * @returns {Promise<Object>} - Extracted product with ID
     */
    async 'termSheet.extract'(fileData, templateId, sessionId) {
      check(fileData, String);
      check(templateId, String);
      check(sessionId, String);

      console.log(`[TermSheetExtractor] Starting extraction for template: ${templateId}`);
      const startTime = Date.now();

      // Validate session
      const session = await SessionHelpers.validateSession(sessionId);
      if (!session) {
        throw new Meteor.Error('not-authorized', 'Invalid or expired session');
      }

      // Get an example product for this template
      const exampleProduct = await ProductsCollection.findOneAsync({
        templateId: templateId
      });

      if (!exampleProduct) {
        throw new Meteor.Error('template-not-found', `No example product found for template: ${templateId}`);
      }

      console.log(`[TermSheetExtractor] Found example product: ${exampleProduct.title}`);

      // Get list of valid issuers from database
      const issuers = await IssuersCollection.find({}).fetchAsync();
      console.log(`[TermSheetExtractor] Found ${issuers.length} issuers for matching`);

      // Prepare structure schema (sanitize example - REMOVE observationSchedule as it's auto-generated)
      const structureSchema = {
        title: exampleProduct.title,
        isin: exampleProduct.isin,
        issuer: exampleProduct.issuer,
        currency: exampleProduct.currency,
        tradeDate: exampleProduct.tradeDate,
        valueDate: exampleProduct.valueDate,
        finalObservation: exampleProduct.finalObservation,
        maturity: exampleProduct.maturity,
        maturityDate: exampleProduct.maturityDate,
        notional: exampleProduct.notional,
        denomination: exampleProduct.denomination,
        couponFrequency: exampleProduct.couponFrequency,
        underlyingMode: exampleProduct.underlyingMode,
        basketMode: exampleProduct.basketMode,
        structure: exampleProduct.structure,
        payoffStructure: exampleProduct.payoffStructure,
        underlyings: exampleProduct.underlyings,
        // DO NOT include observationSchedule - it's auto-generated from scheduleConfig
        finalObservationDate: exampleProduct.finalObservationDate,
        structureParams: exampleProduct.structureParams,
        scheduleConfig: {
          frequency: 'quarterly',
          coolOffPeriods: 0,
          stepDownValue: -5, // EXAMPLE: -5 means decrease by 5% per period
          initialAutocallLevel: 100,
          initialCouponBarrier: 70
        }
      };

      console.log('[TermSheetExtractor] Calling Anthropic API...');

      // Call Anthropic for extraction
      let extractedData;
      try {
        extractedData = await callAnthropicForExtraction(fileData, structureSchema, issuers);
      } catch (error) {
        console.error('[TermSheetExtractor] Extraction failed:', error);
        throw error;
      }

      console.log('[TermSheetExtractor] Extraction complete, preparing product document...');

      // Add metadata to extracted data
      const productDocument = {
        ...extractedData,
        templateId: templateId,
        template: templateId,
        productStatus: 'draft', // Mark as draft initially
        extractedFromTermSheet: true,
        termSheetMetadata: {
          extractedAt: new Date(),
          extractedBy: session.userId,
          model: ANTHROPIC_MODEL,
          processingTimeMs: Date.now() - startTime
        },
        createdAt: new Date(),
        createdBy: session.userId,
        updatedAt: new Date(),
        updatedBy: session.userId
      };

      console.log('[TermSheetExtractor] Inserting product into database...');

      // Insert into database
      let productId;
      try {
        productId = await ProductsCollection.insertAsync(productDocument);
      } catch (dbError) {
        console.error('[TermSheetExtractor] Database insertion failed:', dbError);
        throw new Meteor.Error('db-insert-failed', `Failed to create product: ${dbError.message}`);
      }

      const processingTime = Date.now() - startTime;
      console.log(`[TermSheetExtractor] Product created successfully in ${processingTime}ms, ID: ${productId}`);

      return {
        success: true,
        productId,
        extractedData: productDocument,
        processingTimeMs: processingTime
      };
    },

    /**
     * Get list of available templates for term sheet extraction
     * @returns {Array} - List of template IDs and names
     */
    'termSheet.getAvailableTemplates'() {
      // Return hardcoded template list
      return [
        { _id: 'phoenix_autocallable', name: 'Phoenix Autocallable', icon: '🔥' },
        { _id: 'orion_memory', name: 'Orion', icon: '⭐' },
        { _id: 'himalaya', name: 'Himalaya', icon: '🏔️' },
        { _id: 'shark_note', name: 'Shark Note', icon: '🦈' }
      ];
    }
  });
}
