import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { HTTP } from 'meteor/http';
import { ProductsCollection } from './products';
import { SessionHelpers } from './sessions';
import { IssuersCollection } from './issuers';
import { BUILT_IN_TEMPLATES } from './templates';
import { SecuritiesMetadataHelpers } from './securitiesMetadata';
import { normalizeExchangeForEOD } from '/imports/utils/tickerUtils';
import { validateISIN, cleanISIN } from '/imports/utils/isinValidator';

// Anthropic API configuration (same as riskAnalysis.js)
const ANTHROPIC_API_KEY = Meteor.settings.private?.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-opus-4-7';

if (Meteor.isServer) {
  // Node.js imports for file system operations
  const fs = require('fs');
  const path = require('path');

  /**
   * Save the term sheet PDF file during extraction
   * This allows the file to be available on the report page without re-uploading
   * @param {string} base64Data - Base64 encoded PDF content
   * @param {Object} product - The product document with isin and title
   * @param {string} productId - The product ID
   * @param {string} userId - The user ID who uploaded
   * @returns {Object|null} - The termSheet object to store in the product, or null on failure
   */
  /**
   * Build termSheet metadata (URL, filename) without writing the file yet.
   * This is called BEFORE product insertion so the termSheet field is included
   * in the initial insert, avoiding race conditions with Meteor hot-reload.
   */
  function buildTermSheetMetadata(product, userId) {
    const isin = product.isin || 'NO_ISIN';
    const title = product.title || 'Untitled_Product';

    const sanitizedIsin = isin.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const sanitizedFilename = `${sanitizedIsin}_${sanitizedTitle}.pdf`;

    return {
      url: `/termsheets/${sanitizedFilename}`,
      filename: sanitizedFilename,
      originalFilename: 'termsheet.pdf',
      uploadedAt: new Date(),
      uploadedBy: userId
    };
  }

  /**
   * Write the termsheet PDF file to disk.
   *
   * Called AFTER product insertion. The file is written to a hidden
   * directory (`.termsheets/`) OUTSIDE of `public/` so Meteor's dev-mode
   * file watcher doesn't pick it up — writing into `public/` triggers a
   * hot code push that reloads the client and wipes all UI state (the
   * "screen refresh after extraction" bug). The WebApp.connectHandlers
   * route at server/main.js:/termsheets reads from the same directory so
   * the URL contract is unchanged.
   */
  function writeTermSheetFile(base64Data, termSheetMetadata) {
    try {
      console.log('[TermSheetExtractor] Writing term sheet file to disk...');

      // Determine the term sheets directory
      let termsheetsDir;
      if (process.env.TERMSHEETS_PATH) {
        termsheetsDir = process.env.TERMSHEETS_PATH;
      } else {
        let projectRoot = process.cwd();
        if (projectRoot.includes('.meteor')) {
          projectRoot = projectRoot.split('.meteor')[0].replace(/[\\\/]$/, '');
        }
        // Hidden directory (dotfile) — Meteor's build watcher ignores it.
        termsheetsDir = path.join(projectRoot, '.termsheets');
      }

      // Create directory if it doesn't exist
      if (!fs.existsSync(termsheetsDir)) {
        fs.mkdirSync(termsheetsDir, { recursive: true });
      }

      // Decode base64 to buffer and write file
      const fileBuffer = Buffer.from(base64Data, 'base64');
      const filePath = path.join(termsheetsDir, termSheetMetadata.filename);
      fs.writeFileSync(filePath, fileBuffer);

      console.log(`[TermSheetExtractor] Term sheet saved: ${filePath}`);
      return true;
    } catch (error) {
      console.error('[TermSheetExtractor] Failed to write term sheet file:', error);
      return false;
    }
  }

  /**
   * Normalize ticker formats in extracted data to ensure EOD API compatibility
   * @param {Object} extractedData - Raw extracted data from Claude
   * @returns {Object} - Data with normalized tickers
   */
  function normalizeExtractedTickers(extractedData) {
    if (!extractedData.underlyings || !Array.isArray(extractedData.underlyings)) {
      return extractedData;
    }

    console.log('[TermSheetExtractor] Normalizing ticker formats for EOD API compatibility...');

    extractedData.underlyings = extractedData.underlyings.map(underlying => {
      if (!underlying.securityData) {
        console.log(`[TermSheetExtractor] Warning: Underlying ${underlying.ticker} missing securityData`);
        return underlying;
      }

      // STEP 1: Clean the symbol by removing country/market codes
      let cleanSymbol = underlying.securityData.symbol || underlying.ticker || '';

      // Remove Bloomberg-style suffixes (space + 2 letters): "ADS GY" → "ADS"
      const symbolMatch = cleanSymbol.match(/^([A-Z0-9]+)(\s+[A-Z]{2})?$/);
      if (symbolMatch) {
        cleanSymbol = symbolMatch[1];
      }

      // HONG KONG TICKER NORMALIZATION: Zero-pad numeric HK tickers to 4 digits
      // EOD API expects HK tickers like "0700.HK", "0005.HK", not "700.HK" or "5.HK"
      const isHKExchange = (underlying.securityData.exchange || '').toUpperCase() === 'HK' ||
                           (underlying.securityData.exchange || '').toUpperCase() === 'HKEX' ||
                           (underlying.securityData.exchange || '').toUpperCase() === 'HKG' ||
                           (underlying.securityData.exchange || '').toLowerCase().includes('hong kong');

      if (isHKExchange && /^\d+$/.test(cleanSymbol)) {
        // Zero-pad to 4 digits: "700" → "0700", "5" → "0005"
        cleanSymbol = cleanSymbol.padStart(4, '0');
        console.log(`[TermSheetExtractor] HK ticker zero-padded: ${underlying.securityData.symbol || underlying.ticker} → ${cleanSymbol}`);
      }

      // STEP 2: Normalize exchange name to uppercase API format
      let exchangeCode = underlying.securityData.exchange || '';

      // Convert common variations to uppercase codes
      // US exchanges: All map to 'US' (EOD API unified exchange code)
      const exchangeNormalizations = {
        'xetra': 'XETRA',
        'frankfurt': 'XETRA',
        'euronext paris': 'PA',
        'paris': 'PA',
        'euronext amsterdam': 'AS',
        'amsterdam': 'AS',
        'euronext brussels': 'BR',
        'brussels': 'BR',
        'london': 'LSE',
        'nasdaq': 'US',      // All US exchanges → 'US'
        'nyse': 'US',        // All US exchanges → 'US'
        'nyse arca': 'US',
        'nyse american': 'US',
        'bats': 'US',
        'otc': 'US',
        'otcbb': 'US',
        'otcqb': 'US',
        'otcqx': 'US',
        'pink': 'US',
        // Hong Kong exchanges → 'HK'
        'hk': 'HK',
        'hkex': 'HK',
        'hkg': 'HK',
        'hong kong': 'HK',
        'hong kong stock exchange': 'HK',
        'sehk': 'HK'
      };

      const normalizedExchange = exchangeNormalizations[exchangeCode.toLowerCase()] || exchangeCode.toUpperCase();

      // STEP 3: Create ticker and apply EOD API normalization
      const rawTicker = normalizedExchange ? `${cleanSymbol}.${normalizedExchange}` : cleanSymbol;
      const eodTicker = normalizeExchangeForEOD(rawTicker);

      console.log(`[TermSheetExtractor] Normalized ticker:`, {
        original: { symbol: underlying.securityData.symbol, exchange: underlying.securityData.exchange },
        cleaned: { symbol: cleanSymbol, exchange: normalizedExchange },
        eodTicker: eodTicker
      });

      // Update the underlying with normalized values
      return {
        ...underlying,
        ticker: cleanSymbol,  // Update root-level ticker to clean symbol
        securityData: {
          ...underlying.securityData,
          symbol: cleanSymbol,          // Override with cleaned symbol
          exchange: normalizedExchange, // Override with normalized exchange
          ticker: eodTicker              // Add/override with EOD-compatible ticker
        }
      };
    });

    return extractedData;
  }

  /**
   * Pre-process PDF text to detect basket formula patterns BEFORE AI sees schema defaults
   * This prevents the AI from prioritizing schema defaults over actual formulas in the document
   * @param {string} pdfText - Raw text extracted from PDF
   * @returns {Object} - Detection results with basketType and confidence level
   */
  function detectBasketFormulaType(pdfText) {
    if (!pdfText || typeof pdfText !== 'string') {
      return { basketType: null, confidence: 'none', reason: 'No text provided' };
    }

    // Convert to lowercase for case-insensitive matching
    const textLower = pdfText.toLowerCase();

    // PRIORITY 1: Mathematical formula patterns (HIGHEST confidence)
    const averageFormulas = [
      /sum\s+of\s+products/i,
      /sum\s+of\s+the\s+products/i,
      /Σ/,
      /∑/,
      /initial\s*weights?\s*[×x*]\s*/i,
      /initialweight/i,
      /weighted\s+average/i,
      /weighted\s+sum/i,
      /\bsum\s*\(/i,
      /n\/i\s*=\s*1/,
      /i\s*=\s*1\s+to\s+n/
    ];

    for (const pattern of averageFormulas) {
      if (pattern.test(pdfText)) {
        console.log(`[TermSheetExtractor] PRE-PROCESSING: Detected AVERAGE formula pattern: ${pattern}`);
        return {
          basketType: 'average',
          confidence: 'high',
          reason: `Detected mathematical formula pattern: ${pattern.toString()}`
        };
      }
    }

    // PRIORITY 2: MIN/MAX functions
    if (/\bmin\s*\(/i.test(pdfText) || /\bminimum\s*\(/i.test(pdfText)) {
      console.log('[TermSheetExtractor] PRE-PROCESSING: Detected WORST-OF (MIN function)');
      return {
        basketType: 'worst-of',
        confidence: 'high',
        reason: 'Detected MIN() or minimum() function'
      };
    }

    if (/\bmax\s*\(/i.test(pdfText) || /\bmaximum\s*\(/i.test(pdfText)) {
      console.log('[TermSheetExtractor] PRE-PROCESSING: Detected BEST-OF (MAX function)');
      return {
        basketType: 'best-of',
        confidence: 'high',
        reason: 'Detected MAX() or maximum() function'
      };
    }

    // PRIORITY 3: Text descriptions (LOWER confidence)
    if (textLower.includes('worst perform') || textLower.includes('least favorable')) {
      console.log('[TermSheetExtractor] PRE-PROCESSING: Detected worst-of text description');
      return {
        basketType: 'worst-of',
        confidence: 'medium',
        reason: 'Detected "worst performing" text description'
      };
    }

    if (textLower.includes('best perform') || textLower.includes('most favorable')) {
      console.log('[TermSheetExtractor] PRE-PROCESSING: Detected best-of text description');
      return {
        basketType: 'best-of',
        confidence: 'medium',
        reason: 'Detected "best performing" text description'
      };
    }

    if (textLower.includes('average perform') || textLower.includes('arithmetic mean')) {
      console.log('[TermSheetExtractor] PRE-PROCESSING: Detected average text description');
      return {
        basketType: 'average',
        confidence: 'medium',
        reason: 'Detected "average performance" text description'
      };
    }

    return { basketType: null, confidence: 'none', reason: 'No clear basket type pattern detected' };
  }

  /**
   * Generate a complete example skeleton based on template ID
   * This provides the LLM with a detailed example structure to match
   * @param {string} templateId - Template ID (e.g., 'phoenix_autocallable')
   * @returns {Object} - Complete example product structure
   */
  function generateTemplateSchema(templateId) {
    // Template-specific complete examples
    const templates = {
      phoenix_autocallable: {
        title: "AAPL/MSFT/GOOGL Phoenix Autocallable",
        isin: "CH1300968331",
        issuer: "BNP Paribas",
        currency: "USD",
        tradeDate: "2024-01-08",
        valueDate: "2024-01-15",
        finalObservation: "2027-01-15",
        maturity: "2027-01-22",
        maturityDate: "2027-01-22",
        notional: 100,
        denomination: 1000,
        basketMode: "worst-of",
        underlyings: [
          {
            ticker: "AAPL",
            name: "Apple Inc.",
            isin: "US0378331005",
            strike: 175.50,
            securityData: {
              symbol: "AAPL",
              name: "Apple Inc.",
              exchange: "US",
              currency: "USD",
              country: "US",
              ticker: "AAPL.US"
            }
          },
          {
            ticker: "MSFT",
            name: "Microsoft Corporation",
            isin: "US5949181045",
            strike: 380.25,
            securityData: {
              symbol: "MSFT",
              name: "Microsoft Corporation",
              exchange: "US",
              currency: "USD",
              country: "US",
              ticker: "MSFT.US"
            }
          },
          {
            ticker: "GOOGL",
            name: "Alphabet Inc Class A",
            isin: "US02079K3059",
            strike: 142.80,
            securityData: {
              symbol: "GOOGL",
              name: "Alphabet Inc Class A",
              exchange: "US",
              currency: "USD",
              country: "US",
              ticker: "GOOGL.US"
            }
          }
        ],
        finalObservationDate: "2027-01-15",
        scheduleConfig: {
          frequency: "quarterly",
          coolOffPeriods: 0,
          stepDownValue: 0,
          initialAutocallLevel: 100,
          initialCouponBarrier: 70
        },
        templateId: "phoenix_autocallable",
        structureParams: {
          couponRate: 8.5,
          protectionBarrierLevel: 70,
          strike: 100,
          memoryCoupon: true,
          memoryAutocall: false,
          guaranteedCoupon: false,
          couponFrequency: "quarterly",
          referencePerformance: "worst-of"
        },
        template: "phoenix_autocallable"
      },

      reverse_convertible: {
        title: "TSLA Reverse Convertible",
        isin: "CH1234567890",
        issuer: "UBS AG",
        currency: "USD",
        tradeDate: "2024-02-15",
        valueDate: "2024-02-16",
        finalObservation: "2025-02-14",
        maturity: "2025-02-17",
        maturityDate: "2025-02-17",
        notional: 100,
        denomination: 1000,
        basketMode: "single",
        underlyings: [
          {
            ticker: "TSLA",
            name: "Tesla Inc.",
            isin: "US88160R1014",
            strike: 235.60,
            securityData: {
              symbol: "TSLA",
              name: "Tesla Inc.",
              exchange: "US",
              currency: "USD",
              country: "US",
              ticker: "TSLA.US"
            }
          }
        ],
        finalObservationDate: "2025-02-14",
        scheduleConfig: {
          frequency: "maturity",
          coolOffPeriods: 0,
          stepDownValue: 0,
          initialAutocallLevel: 100,
          initialCouponBarrier: 65
        },
        templateId: "reverse_convertible",
        structureParams: {
          couponRate: 12.0,
          protectionBarrierLevel: 65,
          strike: 100,
          referencePerformance: "single"
        },
        template: "reverse_convertible"
      },

      participation_note: {
        title: "SPX Participation Note",
        isin: "CH9876543210",
        issuer: "Credit Suisse",
        currency: "USD",
        tradeDate: "2024-03-01",
        valueDate: "2024-03-05",
        finalObservation: "2026-03-02",
        maturity: "2026-03-05",
        maturityDate: "2026-03-05",
        notional: 100,
        denomination: 1000,
        basketMode: "single",
        underlyings: [
          {
            ticker: "SPX",
            name: "S&P 500 Index",
            isin: "US78378X1072",
            strike: 5000.00,
            securityData: {
              symbol: "SPX",
              name: "S&P 500 Index",
              exchange: "INDEX",
              currency: "USD",
              country: "US",
              ticker: "SPX.INDX"
            }
          }
        ],
        finalObservationDate: "2026-03-02",
        scheduleConfig: {
          frequency: "maturity",
          coolOffPeriods: 0,
          stepDownValue: 0,
          initialAutocallLevel: 100,
          initialCouponBarrier: 100
        },
        templateId: "participation_note",
        structureParams: {
          participationRate: 120,
          strike: 100,
          cap: 150,
          capitalGuarantee: 100,
          callableByIssuer: false,
          issuerCallRebate: 0,
          issuerCallRebateType: "fixed",
          referencePerformance: "worst-of"
        },
        template: "participation_note"
      },

      orion_memory: {
        title: "EUR/USD/GBP Orion Memory",
        isin: "CH5555555555",
        issuer: "Goldman Sachs",
        currency: "EUR",
        tradeDate: "2024-04-10",
        valueDate: "2024-04-15",
        finalObservation: "2026-04-10",
        maturity: "2026-04-15",
        maturityDate: "2026-04-15",
        notional: 100,
        denomination: 1000,
        basketMode: "worst-of",
        underlyings: [
          {
            ticker: "EUR",
            name: "Euro FX",
            isin: null,
            strike: 1.0850,
            securityData: {
              symbol: "EUR",
              name: "Euro FX",
              exchange: "FOREX",
              currency: "USD",
              country: "US",
              ticker: "EUR.FOREX"
            }
          },
          {
            ticker: "GBP",
            name: "British Pound",
            isin: null,
            strike: 1.2650,
            securityData: {
              symbol: "GBP",
              name: "British Pound",
              exchange: "FOREX",
              currency: "USD",
              country: "US",
              ticker: "GBP.FOREX"
            }
          }
        ],
        finalObservationDate: "2026-04-10",
        scheduleConfig: {
          frequency: "monthly",
          coolOffPeriods: 0,
          stepDownValue: 0,
          initialAutocallLevel: 100,
          initialCouponBarrier: 100
        },
        templateId: "orion_memory",
        structureParams: {
          upperBarrier: 100,
          rebate: 9.5,
          strike: 100,
          capitalGuaranteed: 100
        },
        template: "orion_memory"
      },

      shark_note: {
        title: "NVDA/AMD Shark Note",
        isin: "CH7777777777",
        issuer: "Morgan Stanley",
        currency: "USD",
        tradeDate: "2024-05-01",
        valueDate: "2024-05-05",
        finalObservation: "2026-05-01",
        maturity: "2026-05-05",
        maturityDate: "2026-05-05",
        notional: 100,
        denomination: 1000,
        basketMode: "worst-of",
        underlyings: [
          {
            ticker: "NVDA",
            name: "NVIDIA Corporation",
            isin: "US67066G1040",
            strike: 875.00,
            securityData: {
              symbol: "NVDA",
              name: "NVIDIA Corporation",
              exchange: "US",
              currency: "USD",
              country: "US",
              ticker: "NVDA.US"
            }
          },
          {
            ticker: "AMD",
            name: "Advanced Micro Devices Inc",
            isin: "US0079031078",
            strike: 185.50,
            securityData: {
              symbol: "AMD",
              name: "Advanced Micro Devices Inc",
              exchange: "US",
              currency: "USD",
              country: "US",
              ticker: "AMD.US"
            }
          }
        ],
        finalObservationDate: "2026-05-01",
        scheduleConfig: {
          frequency: "quarterly",
          coolOffPeriods: 0,
          stepDownValue: 0,
          initialAutocallLevel: 140,
          initialCouponBarrier: 90
        },
        templateId: "shark_note",
        structureParams: {
          strike: 100,
          upperBarrier: 140,
          rebateValue: 12,
          floorLevel: 90,
          referencePerformance: "worst-of",
          barrierObservation: "continuous"
        },
        template: "shark_note"
      },

      himalaya: {
        title: "Asian Equities Himalaya",
        isin: "CH8888888888",
        issuer: "JP Morgan",
        currency: "USD",
        tradeDate: "2024-06-01",
        valueDate: "2024-06-05",
        finalObservation: "2027-06-01",
        maturity: "2027-06-05",
        maturityDate: "2027-06-05",
        notional: 100,
        denomination: 1000,
        basketMode: "himalaya",
        underlyings: [
          {
            ticker: "BABA",
            name: "Alibaba Group Holding Ltd",
            isin: "US01609W1027",
            strike: 78.50,
            securityData: {
              symbol: "BABA",
              name: "Alibaba Group Holding Ltd",
              exchange: "US",
              currency: "USD",
              country: "US",
              ticker: "BABA.US"
            }
          },
          {
            ticker: "TSM",
            name: "Taiwan Semiconductor Manufacturing",
            isin: "US8740391003",
            strike: 145.00,
            securityData: {
              symbol: "TSM",
              name: "Taiwan Semiconductor Manufacturing",
              exchange: "US",
              currency: "USD",
              country: "US",
              ticker: "TSM.US"
            }
          },
          {
            ticker: "SONY",
            name: "Sony Group Corporation",
            isin: "US8356993076",
            strike: 95.25,
            securityData: {
              symbol: "SONY",
              name: "Sony Group Corporation",
              exchange: "US",
              currency: "USD",
              country: "US",
              ticker: "SONY.US"
            }
          }
        ],
        finalObservationDate: "2027-06-01",
        scheduleConfig: {
          frequency: "annual",
          coolOffPeriods: 0,
          stepDownValue: 0,
          initialAutocallLevel: 100,
          initialCouponBarrier: 100
        },
        templateId: "himalaya",
        structureParams: {
          floor: 100,
          strike: 100,
          observationFrequency: "annual"
        },
        template: "himalaya"
      },

      bonus_certificate: {
        title: "SK hynix Capped Bonus Certificate",
        isin: "CH1534646109",
        issuer: "Société Générale",
        currency: "EUR",
        tradeDate: "2026-05-05",
        valueDate: "2026-05-12",
        finalObservation: "2027-05-06",
        maturity: "2027-05-13",
        maturityDate: "2027-05-13",
        notional: 100,
        denomination: 1000,
        basketMode: "single",
        underlyings: [
          {
            ticker: "000660",
            name: "SK hynix Inc",
            isin: "KR7000660001",
            strike: 0,
            securityData: {
              symbol: "000660",
              name: "SK hynix Inc",
              exchange: "KO",
              currency: "KRW",
              country: "KR",
              ticker: "000660.KO"
            }
          }
        ],
        finalObservationDate: "2027-05-06",
        scheduleConfig: {
          frequency: "maturity",
          coolOffPeriods: 0,
          stepDownValue: 0,
          initialAutocallLevel: 100,
          initialCouponBarrier: 60
        },
        templateId: "bonus_certificate",
        structureParams: {
          strikeLevel: 100,
          bonusLevel: 100,
          barrierLevel: 60,
          barrierType: "european",
          participationRate: 120,
          capEnabled: true,
          cap: 66,
          basketType: "single"
        },
        template: "bonus_certificate"
      },

      twin_win: {
        title: "Global X Uranium ETF Twin Win",
        isin: "XS2748037541",
        issuer: "Marex Group plc",
        currency: "USD",
        tradeDate: "2024-05-16",
        valueDate: "2024-05-23",
        finalObservation: "2027-05-17",
        maturity: "2027-05-24",
        maturityDate: "2027-05-24",
        notional: 100,
        denomination: 1000,
        basketMode: "single",
        underlyings: [
          {
            ticker: "URA",
            name: "Global X Uranium ETF",
            isin: "",
            strike: 31.52,
            securityData: {
              symbol: "URA",
              name: "Global X Uranium ETF",
              exchange: "US",
              currency: "USD",
              country: "US",
              ticker: "URA.US"
            }
          }
        ],
        finalObservationDate: "2027-05-17",
        scheduleConfig: {
          frequency: "maturity",
          coolOffPeriods: 0,
          stepDownValue: 0,
          initialAutocallLevel: 100,
          initialCouponBarrier: 70
        },
        templateId: "twin_win",
        structureParams: {
          // Capital protection level (% of denomination returned at maturity)
          capitalProtection: 100,
          // Guaranteed minimum participation ("Bonus") added on top of capital protection
          bonus: 15,
          // Lower barrier (% of initial) — touched if the underlying trades at/below it
          lowerBarrier: 70,
          // Upper barrier (% of initial) — touched if the underlying trades at/above it
          upperBarrier: 130,
          // Barriers are observed intraday/continuously over the whole life
          barrierType: "american",
          basketType: "single"
        },
        template: "twin_win"
      },

      rate: {
        title: "10Y EUR Target Steepener Certificate",
        isin: "XS2519475037",
        issuer: "BNP Paribas",
        currency: "EUR",
        tradeDate: "2023-06-13",
        valueDate: "2023-06-27",
        finalObservation: "2033-06-23",
        maturity: "2033-06-27",
        maturityDate: "2033-06-27",
        notional: 100,
        denomination: 1000,
        basketMode: "single",
        // Reference rates are synthetic (not provider-priced). Use the rate name as the
        // ticker and securityData.exchange = "RATE". No ISIN, no strike.
        underlyings: [
          {
            ticker: "EUR CMS 30Y",
            name: "EUR CMS 30Y swap rate",
            isin: "",
            strike: 0,
            securityData: { symbol: "EUR CMS 30Y", name: "EUR CMS 30Y swap rate", exchange: "RATE", currency: "EUR", country: "EU", ticker: "EUR CMS 30Y" }
          },
          {
            ticker: "EUR CMS 5Y",
            name: "EUR CMS 5Y swap rate",
            isin: "",
            strike: 0,
            securityData: { symbol: "EUR CMS 5Y", name: "EUR CMS 5Y swap rate", exchange: "RATE", currency: "EUR", country: "EU", ticker: "EUR CMS 5Y" }
          }
        ],
        finalObservationDate: "2033-06-23",
        scheduleConfig: {
          frequency: "quarterly",
          coolOffPeriods: 0,
          stepDownValue: 0,
          initialAutocallLevel: 100,
          initialCouponBarrier: 100
        },
        templateId: "rate",
        structureParams: {
          // Capital protected at maturity (% of nominal)
          capitalProtection: 100,
          // Cumulative-coupon target; the note auto-redeems once reached (0/null disables)
          targetCoupon: 18,
          targetRedemptionEnabled: true,
          // Fixed coupon for the first `fixedPeriods` periods (% per annum)
          fixedCouponRate: 8.5,
          fixedPeriods: 8,
          couponFrequency: "quarterly",
          // Display label of the floating coupon formula for the remaining periods
          floatingFormulaLabel: "Max(EUR CMS 30Y − EUR CMS 5Y, 0%)"
        },
        template: "rate"
      }
    };

    // Return the specific template or default to phoenix
    return templates[templateId] || templates.phoenix_autocallable;
  }

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

🚨🚨🚨 CRITICAL OVERRIDE - READ THIS FIRST 🚨🚨🚨
BEFORE LOOKING AT THE SCHEMA DEFAULTS BELOW, YOU MUST:

1. TABLE EXTRACTION (MOST CRITICAL FOR OBSERVATION SCHEDULES):
   - IF YOU SEE A TABLE with "Early Redemption Dates" or "Observation Dates":
     → COUNT THE ROWS in the table (e.g., if 12 rows, you need 12 observations)
     → CREATE ONE OBSERVATION OBJECT FOR EVERY SINGLE ROW
     → DO NOT skip rows, DO NOT summarize, DO NOT truncate
   - Common mistake: Extracting only 1-3 observations when table has 10+ rows
   - VERIFY: Your observationSchedule array length MUST equal the table row count

2. FORMULA-FIRST DETECTION (MANDATORY):
   - IMMEDIATELY scan the PDF for mathematical formulas in performance calculation sections
   - IF YOU SEE: "Sum of products", "∑", "Σ", "Initial Weights", "weighted sum", "weighted average"
     → YOU MUST set referencePerformance: "average" (OVERRIDE any schema defaults)
   - IF YOU SEE: "MIN(", "min(", "minimum", "worst performing"
     → YOU MUST set referencePerformance: "worst-of"
   - IF YOU SEE: "MAX(", "max(", "maximum", "best performing"
     → YOU MUST set referencePerformance: "best-of"

3. SCHEMA DEFAULTS ARE NOT AUTHORITATIVE:
   - The schema below shows example values like "worst-of" - THESE ARE JUST EXAMPLES
   - You MUST replace these defaults with actual values from the PDF
   - Mathematical formulas in the PDF ALWAYS take priority over schema defaults
   - If the PDF shows a summation formula but the schema shows "worst-of", USE "average" from the formula

4. REBATE EXTRACTION (MANDATORY for Participation Notes):
   - Every observation in observationSchedule MUST have a rebateAmount field
   - Calculate from currency amounts: (Amount / Denomination) × 100
   - Extract from percentages: direct number (e.g., "12%" → 12)

NOW YOU MAY PROCEED TO READ THE SCHEMA:
🚨🚨🚨 END CRITICAL OVERRIDE 🚨🚨🚨

TASK:
Extract all relevant information from the term sheet and return a JSON object that matches the provided schema structure.

SCHEMA TO FOLLOW (Remember: defaults here are EXAMPLES ONLY, replace with actual PDF values):
${JSON.stringify(templateStructure, null, 2)}

VALID ISSUERS LIST (match the issuer name from the term sheet to the CLOSEST match in this list):
${issuerList.map(i => `- ${i.name} (${i.country})`).join('\n')}

EXTRACTION RULES:
1. Match the exact field names and structure from the schema
2. For dates: use ISO format "YYYY-MM-DD"
   - Trade Date: May be labeled as "Trade Date", "Issue Date", "Initial Fixing Date", or "Pricing Date"
   - Value Date: May be labeled as "Value Date", "Settlement Date", or "Issue Settlement Date"
   - Final Observation: May be labeled as "Final Observation", "Final Fixing Date", or "Final Valuation Date"
   - Maturity Date: May be labeled as "Maturity Date", "Redemption Date", or "Final Settlement Date"
3. For underlyings: extract ticker, name, ISIN, and INITIAL REFERENCE PRICE
   - The per-underlying "strike" field MUST hold the INITIAL REFERENCE / SPOT REFERENCE PRICE — i.e. the absolute price at 100% of the initial fixing. This is what performance is measured AGAINST.
     * Look for labels: "Spot Reference Price", "Initial Reference Level", "Initial Fixing Level", "Initial Price", "Reference Price", "Reference Level at Initial Fixing", "Initial Level".
     * EXAMPLE (Vontobel format):
         "Spot Reference Price  DKK 831.20"        ← use 831.20 in the per-underlying "strike" field
         "Strike Price          DKK 623.40 (75.00%*)" ← DO NOT put 623.40 here. The 75% goes in structureParams.strike (or protectionBarrierLevel).
     * COMMON MISTAKE: the term sheet's "Strike Price" line is usually the strike of the short put / capital barrier (e.g. 75% × Spot). It is NOT the initial reference. Putting it in the per-underlying "strike" field corrupts all performance calculations because the system divides current price by this number to compute performance.
   - DO NOT populate securityData.price - leave it null (current market prices will be fetched separately)
   - Only populate: ticker, name, isin, strike (= initial reference price), and basic securityData (symbol, name, exchange, currency, country)
4. For barriers: extract all levels as percentages (e.g., 70 for 70%)
   - Protection/Barrier Level: Extract into structureParams.protectionBarrierLevel (e.g., if term sheet shows "70%" or "70.00%", use 70)
   - Strike Level / Initial Level: Extract into structureParams.strike
     * CRITICAL: Look for patterns like "Strike(k) = X% × S(0,k)" or "Strike Level = X%" where X is the percentage
     * Common patterns: "40% × S(0,k)", "Strike: 40%", "Strike Level: 40.00%", "X% of initial level"
     * Extract the percentage coefficient (e.g., if "40% × S(0,k)", use 40; if "70% of initial", use 70)
     * If strike shows "100%" or "100.00%", use 100
     * PER-UNDERLYING TABLE FORMAT: Many term sheets list the strike inside each underlying's own block, e.g.:
         "Strike Price DKK 623.40 (75.00%*)" — where "*" footnotes "in % of the Spot Reference Price"
         "Strike Price USD 60.62 (75.00%*)"
         "Strike Price EUR 267.83 (75.00%*)"
       Here each underlying carries its own absolute strike (623.40, 60.62, 267.83) AND a common percentage (75.00%).
       In this case: the absolute number goes in the per-underlying "strike" field, and the COMMON PERCENTAGE
       goes in structureParams.strike. So if all three rows say "(75.00%*)", set structureParams.strike = 75.
       Do NOT default to 100 just because there's no separate product-level "Strike Level = X%" line — the
       per-underlying parenthetical IS the strike level when the percentages match across all underlyings.
     * Default to 100 only if NO strike percentage information appears anywhere — including the per-underlying parentheticals.
   - Autocall Level: Extract into scheduleConfig.initialAutocallLevel (e.g., if term sheet shows "100%", use 100)
   - Coupon Barrier: Extract into scheduleConfig.initialCouponBarrier (e.g., if term sheet shows "70%", use 70)
   - Knock-In Threshold (Bonus Certificate only): Extract into structureParams.barrierLevel (e.g., if term sheet shows "Knock-In Threshold = 60% × S(0)" or "Barrier Level: 60%", use 60)
4b. For BONUS CERTIFICATE template (SSPA 1320 / 1330) — CRITICAL FIELD EXTRACTION:

   **strikeLevel** (in structureParams): A PERCENTAGE, almost always 100.
   - This is the strike as a % of the underlying's initial fixing level (NOT the absolute stock price).
   - Look for: "Strike: 100% × S(0)", "Strike Level: 100%", "Strike at 100%".
   - If you see "Strike: 100% × S(0)" → strikeLevel = 100. NOT the actual KRW/EUR/USD initial price.
   - DEFAULT: 100. Only use a different value if the termsheet EXPLICITLY shows a percentage other than 100% for the strike.
   - DO NOT extract the absolute initial fixing level (e.g. KRW 250,000 or USD 922) into this field — those go in the underlying's "strike" field instead.

   **bonusLevel** (in structureParams): A PERCENTAGE, almost always 100.
   - The redemption floor when no knock-in occurs (in % of denomination).
   - Look for: the constant inside "100% + Max(0%; …)" — for a standard bonus certificate this is 100.
   - DEFAULT: 100. Only deviate if the termsheet explicitly shows a different bonus floor.

   **barrierLevel** (in structureParams): A PERCENTAGE.
   - The Knock-In Threshold as % of initial fixing (e.g. 60 for "60% × S(0)").
   - Common values: 50, 60, 65, 70, 75.

   **barrierType** (in structureParams): 'european' | 'american'.
   - 'european': KI checked only at Valuation Date / Final Fixing Date (typical SG "European Knock-In Event").
   - 'american': KI checked on any business day during life (look for "on any Business Day from the Initial Fixing Date to the Final Fixing Date" or "continuous monitoring").

   **participationRate** (in structureParams): A PERCENTAGE.
   - The leverage applied to positive performance. Look for "120% × Performance" or "Participation: 100%".
   - DEFAULT: 100 (vanilla). Use a different value only if the termsheet explicitly multiplies performance by something other than 1.

   **capEnabled** (in structureParams): boolean.
   - true when the formula caps the upside with "Min(X%; …)" (typical capped bonus / outperformance).
   - false for plain bonus (uncapped).

   **cap** (in structureParams): A PERCENTAGE.
   - When capEnabled, the cap above par. Example: "Min(66%; 120% × Performance)" → cap = 66.
   - When not capEnabled, leave as null.

   **basketType** (in structureParams): 'worst_of' | 'best_of' | 'average' | 'single'.
   - 'worst_of': multi underlying with "minimum performance" / "worst performing" language.
   - 'best_of': "maximum performance" / "best performing".
   - 'average': "weighted sum" / "average performance" / "Σ wᵢ × perfᵢ".
   - 'single': exactly one underlying.

   **basketMode** (top-level): set to 'single' for one underlying, 'worst-of' otherwise (mirrors basketType).

   **Underlying "strike"** (in each item of the underlyings array): The ABSOLUTE initial fixing PRICE (in the underlying's reference currency, e.g. KRW 250000, USD 922.75).
   - This is the actual market price of the underlying on Valuation Date(0), NOT a percentage.
   - If the termsheet shows "KRW [TBD]" or "TBD", leave as null or 0.

   **Coupons / observation schedule**: Bonus Certificates DO NOT have coupons or an observation schedule. Leave observationSchedule as []. Do not set couponRate.

   COMMON MISTAKE TO AVOID:
   - DO NOT put the absolute strike price (e.g. 118.50, 922.75) into structureParams.strikeLevel. That field is always a percentage like 100.
   - DO NOT extract participation/cap from the underlying-level table — those belong to the structureParams.

   EXAMPLE (matches SG Capped Bonus Outperformance on SK hynix):
   - Formula: "100% + Max(0%; Min(66%; 120% × Performance(1)))" → strikeLevel=100, bonusLevel=100, participationRate=120, capEnabled=true, cap=66
   - "Knock-In Threshold = 60% × S(0)" → barrierLevel=60
   - "Valuation Date(1)" (single fixing) → barrierType='european'
5. For observation schedule: generate all observation dates based on frequency and dates found in term sheet
6. For structure and payoffStructure: create the appropriate components based on product type
7. If a field is not found in the term sheet, use null or empty array
8. Do NOT add fields that are not in the schema
9. Do NOT modify the structure or field names
10. For coupon rates, autocall levels, protection barriers: extract exact percentages from term sheet tables/text
11. MEMORY AUTOCALL (structureParams.memoryAutocall) - CRITICAL, set TRUE when ANY of these apply:
    - The product name/title contains "Snowball", "Memory", or "Phoenix Snowball" (Snowball = memory autocall).
    - The Automatic Early Redemption condition lets each underlying satisfy its autocall level on the
      CURRENT observation date OR on ANY PRECEDING observation date — i.e. the underlyings do NOT all
      have to be above the barrier on the same date. Tell-tale wording:
        * "...on that Automatic Early Redemption Valuation Date OR ANY OF the ... Valuation Dates WHICH PRECEDE ..."
        * "...closing price ... on such date or on any previous valuation date ..."
        * "lock-in", "one-star", "memory autocall", "cumulative autocall", "already-fixed underlyings"
    - If the autocall requires ALL underlyings to be above the level ON THE SAME date (no reference to
      preceding dates), set memoryAutocall = FALSE.
    MEMORY COUPON (structureParams.memoryCoupon) - set TRUE when ANY of these apply:
    - Wording "memory", "cumulative", "snowball", or coupons missed earlier are paid later ("catch-up").
    - A coupon formula that multiplies by a counter of missed/elapsed periods, e.g. "N x Rate x (1 + T)"
      where T counts coupon dates since the last paid coupon. That cumulative factor IS a memory coupon.
    For guaranteed coupon: detect from term sheet language (e.g., "guaranteed", "unconditional", "paid regardless of performance", "coupon paid at each observation", "fixed coupon")
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
17. For detecting non-call periods (scheduleConfig.coolOffPeriods) - CRITICAL:
    - Look at the payment schedule table in the term sheet
    - Compare coupon payment dates vs autocall payment dates
    - If an observation date has coupon payments but NO autocall possibility, it's a non-call period
    - Common pattern: "Observation 1: Coupon payment possible, Early redemption: No"
    - Count consecutive non-callable observations at the START of the schedule
    - Set scheduleConfig.coolOffPeriods to this count
    - In observationSchedule array: set isCallable = false for non-call periods
    - EXAMPLE 1: If term sheet shows:
      * Observation 1: Coupon Yes, Autocall No
      * Observation 2: Coupon Yes, Autocall Yes
      * Observation 3+: Coupon Yes, Autocall Yes
      → coolOffPeriods = 1, observationSchedule[0].isCallable = false
    - EXAMPLE 2: If all observations allow both coupon and autocall:
      → coolOffPeriods = 0, all observationSchedule[].isCallable = true
    - EXAMPLE 3: If first 2 observations have coupons but no autocall:
      → coolOffPeriods = 2, observationSchedule[0] and [1] have isCallable = false
18. For ticker normalization - CRITICAL FOR API COMPATIBILITY:
    - Term sheets often use Bloomberg-style tickers with country codes (e.g., "ADS GY", "AIR FP", "INTC UQ", "700 HK")
    - You MUST clean these for API compatibility:
      * Clean symbol: Remove country/market codes - "ADS GY" → "ADS", "AIR FP" → "AIR", "INTC UQ" → "INTC"
      * Set securityData.symbol to the CLEAN symbol (no country code)
    - HONG KONG TICKERS - CRITICAL ZERO-PADDING:
      * Hong Kong stocks use numeric tickers that MUST be zero-padded to 4 digits
      * "700 HK" → symbol: "0700", exchange: "HK" (Tencent)
      * "5 HK" → symbol: "0005", exchange: "HK" (HSBC)
      * "941 HK" → symbol: "0941", exchange: "HK" (China Mobile)
      * "1299 HK" → symbol: "1299", exchange: "HK" (AIA Group - already 4 digits)
      * Always pad with leading zeros to make 4 digits: "5" → "0005", "27" → "0027", "700" → "0700"
    - For exchange names, use UPPERCASE exchange codes (not human-readable names):
      * "Xetra" or "Frankfurt" → "XETRA"
      * "Euronext Paris" or "Paris" → "PA"
      * "Euronext Amsterdam" or "Amsterdam" → "AS"
      * "London" or "LSE" → "LSE"
      * "NASDAQ", "NYSE", or any US exchange → "US" (unified US exchange code)
      * "HK", "HKEX", "Hong Kong" → "HK" (Hong Kong Stock Exchange)
    - In securityData, you MUST include a "ticker" field formatted as "SYMBOL.EXCHANGE":
      * Example: For Adidas on Xetra → "ticker": "ADS.XETRA"
      * Example: For Airbus on Paris → "ticker": "AIR.PA"
      * Example: For Apple on NASDAQ → "ticker": "AAPL.US"
      * Example: For Intel on NYSE → "ticker": "INTC.US"
      * Example: For Tencent on Hong Kong → "ticker": "0700.HK" (note the zero-padding)
19. For observationSchedule array - CRITICAL - MUST GENERATE COMPLETE ARRAY WITH ALL PERIODS:
    - Generate ALL observation periods from trade date to final observation based on scheduleConfig.frequency
    - Calculate observation dates based on frequency:
      * "quarterly": Every 3 months from trade date
      * "monthly": Every 1 month from trade date
      * "semi-annual": Every 6 months from trade date
      * "annual": Every 12 months from trade date
      * "maturity": Single observation at final observation date
    - Each observation MUST include these EXACT fields:
      * id: String - Sequential ID starting from "period_0", then "period_1", "period_2", etc.
      * observationDate: String - Market observation date in ISO format "YYYY-MM-DD"
      * valueDate: String - Settlement date (typically 14 calendar days after observationDate) in ISO format "YYYY-MM-DD"
      * autocallLevel: Number - Calculated as initialAutocallLevel + (periodIndex - 1) * stepDownValue
      * isCallable: Boolean - CRITICAL: Set based on coolOffPeriods
        - If periodIndex <= coolOffPeriods: isCallable = false (non-call period)
        - If periodIndex > coolOffPeriods: isCallable = true (callable period)
        - Example: coolOffPeriods = 1 means period_0 (periodIndex=1) has isCallable=false, all others true
      * couponBarrier: Number - From scheduleConfig.initialCouponBarrier
      * periodIndex: Number - Sequential period number starting from 1 (NOT 0), then 2, 3, 4, etc.
    - IMPORTANT: periodIndex starts at 1 (not 0), but id starts at "period_0"
    - CRITICAL: You MUST generate ALL periods from start to maturity - do not omit any observations
    - For term sheets showing observation dates in a table: extract all dates and generate the array
    - For term sheets with only frequency and dates: calculate all observation dates programmatically
    - EXAMPLE CALCULATION for quarterly product from 2024-02-08 to 2026-04-30:
      * Period 0: observationDate="2024-02-08", periodIndex=1
      * Period 1: observationDate="2024-05-08", periodIndex=2
      * Period 2: observationDate="2024-08-08", periodIndex=3
      * Period 3: observationDate="2024-11-08", periodIndex=4
      * Period 4: observationDate="2025-02-08", periodIndex=5
      * ... continue until final observation at 2026-04-30
    - Total periods = number of observations based on frequency and duration

EXAMPLE TERM SHEET TABLE EXTRACTION:
If the term sheet contains a table like this:

| Parameter | Value |
|-----------|-------|
| Strike Level | 100.00% |
| Protection Barrier | 70.00% |
| Coupon | 8.50% p.a. |
| Autocall Level (Year 1) | 100.00% |

Extract it as:
- structureParams.strike: 100
- structureParams.protectionBarrierLevel: 70
- structureParams.couponRate: 8.5 (NOTE: For Phoenix products with periodic observations, this is the PER-PERIOD rate)
- scheduleConfig.initialAutocallLevel: 100

CRITICAL - COUPON RATE EXTRACTION FOR PHOENIX PRODUCTS:
For Phoenix Autocallable products, the couponRate field represents the coupon payment PER OBSERVATION PERIOD, not per annum.

IF the term sheet shows "Coupon: X% p.a." or "X% per annum":
- You MUST convert to per-period rate by dividing by periods per year
- For quarterly observations: divide p.a. rate by 4
- For monthly observations: divide p.a. rate by 12
- For semi-annual observations: divide p.a. rate by 2
- For annual observations: use the p.a. rate as-is

EXAMPLES:
1. Term sheet shows "Coupon: 8.0% p.a." with quarterly observations
   - Extract: structureParams.couponRate = 2.0 (because 8.0 / 4 = 2.0)

2. Term sheet shows "Coupon: 12.0% p.a." with monthly observations
   - Extract: structureParams.couponRate = 1.0 (because 12.0 / 12 = 1.0)

3. Term sheet shows "Coupon: 2.5% per observation" with quarterly observations
   - Extract: structureParams.couponRate = 2.5 (already per-period)

4. Term sheet shows "Coupon: 10.0% per annum" with semi-annual observations
   - Extract: structureParams.couponRate = 5.0 (because 10.0 / 2 = 5.0)

IMPORTANT: Look for frequency indicators in the term sheet:
- "quarterly", "quarterly observations", "every 3 months" → divide by 4
- "monthly", "monthly observations", "every month" → divide by 12
- "semi-annual", "semi-annually", "every 6 months" → divide by 2
- "annual", "annually", "yearly" → use as-is (divide by 1)

EXAMPLE STRIKE EXTRACTION - MATHEMATICAL FORMULAS:
If the term sheet shows strike as a formula:

Example 1:
"Strike(k) (k from 1 to 2) means: 40% × S(0,k)"
or
"Strike Level: 40.00% of initial level"

Extract: structureParams.strike = 40

Example 2:
"For Adyen NV: S(0,1) = EUR 669.2
For Ocado Group PLC: S(0,2) = GBp 487.1
Strike(k) = 40% × S(0,k)"

Extract: structureParams.strike = 40

Example 3:
"Initial Level: 100%
Protection Barrier: 70%"

Extract: structureParams.strike = 100, structureParams.protectionBarrierLevel = 70

CRITICAL REMINDER:
- Strike is the percentage reference level, NOT the absolute price
- Look for "Strike", "Strike Level", "Initial Level", "Reference Level"
- Extract the percentage coefficient from formulas like "X% × initial" or "X% of S(0)"
- If barrier and strike are different values (e.g., barrier 70%, but strike shown as 40%), they are DIFFERENT fields
- structureParams.strike is for the reference calculation level
- structureParams.protectionBarrierLevel is for the capital protection threshold

EXAMPLE OBSERVATION SCHEDULE GENERATION:
For a quarterly Phoenix product from 2024-02-08 to 2026-04-30 with:
- scheduleConfig.frequency: "quarterly"
- tradeDate: "2024-02-08"
- finalObservation: "2026-04-30"
- initialAutocallLevel: 100
- initialCouponBarrier: 70
- stepDownValue: 0

You MUST generate observationSchedule as a complete array with ALL 10 periods:

"observationSchedule": [
  {
    "id": "period_0",
    "observationDate": "2024-02-08",
    "valueDate": "2024-02-22",
    "autocallLevel": 100,
    "isCallable": true,
    "couponBarrier": 70,
    "periodIndex": 1
  },
  {
    "id": "period_1",
    "observationDate": "2024-05-08",
    "valueDate": "2024-05-22",
    "autocallLevel": 100,
    "isCallable": true,
    "couponBarrier": 70,
    "periodIndex": 2
  },
  {
    "id": "period_2",
    "observationDate": "2024-08-08",
    "valueDate": "2024-08-22",
    "autocallLevel": 100,
    "isCallable": true,
    "couponBarrier": 70,
    "periodIndex": 3
  },
  {
    "id": "period_3",
    "observationDate": "2024-11-08",
    "valueDate": "2024-11-22",
    "autocallLevel": 100,
    "isCallable": true,
    "couponBarrier": 70,
    "periodIndex": 4
  },
  {
    "id": "period_4",
    "observationDate": "2025-02-08",
    "valueDate": "2025-02-22",
    "autocallLevel": 100,
    "isCallable": true,
    "couponBarrier": 70,
    "periodIndex": 5
  },
  {
    "id": "period_5",
    "observationDate": "2025-05-08",
    "valueDate": "2025-05-22",
    "autocallLevel": 100,
    "isCallable": true,
    "couponBarrier": 70,
    "periodIndex": 6
  },
  {
    "id": "period_6",
    "observationDate": "2025-08-08",
    "valueDate": "2025-08-22",
    "autocallLevel": 100,
    "isCallable": true,
    "couponBarrier": 70,
    "periodIndex": 7
  },
  {
    "id": "period_7",
    "observationDate": "2025-11-08",
    "valueDate": "2025-11-22",
    "autocallLevel": 100,
    "isCallable": true,
    "couponBarrier": 70,
    "periodIndex": 8
  },
  {
    "id": "period_8",
    "observationDate": "2026-02-08",
    "valueDate": "2026-02-22",
    "autocallLevel": 100,
    "isCallable": true,
    "couponBarrier": 70,
    "periodIndex": 9
  },
  {
    "id": "period_9",
    "observationDate": "2026-04-30",
    "valueDate": "2026-05-14",
    "autocallLevel": 100,
    "isCallable": true,
    "couponBarrier": 70,
    "periodIndex": 10
  }
]

NOTE: The last observation date (2026-04-30) matches finalObservation exactly. If stepDownValue was -5, autocallLevel would decrease by 5 each period (100, 95, 90, 85, etc.).

20. For Participation Notes - Issuer Call (Early Redemption) Detection - CRITICAL:
    - A genuine issuer call exists ONLY when the term sheet defines CONCRETE early-redemption terms:
      a dedicated "Early Redemption" / "Issuer Call" / "Optional Redemption" / "Autocall" section or a
      TABLE of early-redemption observation dates WITH call prices/rebates and settlement dates.
    - Extract into structureParams.callableByIssuer (boolean):
      * TRUE only if such concrete call dates/prices/terms exist.
      * FALSE if there is no early-redemption table or optional-redemption clause — i.e. the product simply
        runs from the Initial Fixing Date to a single Final Fixing Date / Redemption Date.
    - 🚫 DO NOT treat generic RISK-FACTOR boilerplate as an issuer call. The following are NOT issuer calls
      and MUST yield callableByIssuer = false (unless real call terms exist elsewhere):
      * A risk paragraph titled "Early Termination and Reinvestment Risk" (standard in Leonteq/EFG/Vontobel
        term sheets) describing that the product "may be redeemed prior to maturity".
      * Language about early redemption due to "hedging disruption", "extraordinary events",
        "market disruption", "illegality", or "for tax reasons" — these are issuer protections, not a call schedule.
    - A plain capital-protection participation note (SSPA 1100: Capital Protection + Participation, optional Cap,
      single Final Fixing Date, no coupons) is NOT callable → callableByIssuer = false, no observation schedule.

    - Extract rebate into structureParams.issuerCallRebate (number as percentage):
      * Look for "Early Redemption Price", "Call Price", "Early Redemption Coupon Amount", "Rebate"
      * PERCENTAGE FORMAT: If shown as percentage (e.g., "5%", "102%", "100% + 2%")
        - Extract the percentage ABOVE 100% (e.g., "102%" → extract 2, "100% + 5%" → extract 5)
      * AMOUNT FORMAT: If shown as currency amount in a table
        - Calculate percentage: (Amount / Denomination) × 100
        - Example: EUR 120.00 with EUR 1000 denomination → (120/1000)×100 = 12%
      * Store as percentage number (e.g., 12 for 12%, not 0.12)

    - Detect rebate type into structureParams.issuerCallRebateType:
      * If text contains "p.a.", "per annum", "per year", "annually" near rebate → "per_annum"
      * Otherwise → "fixed"

    - EXAMPLES:
      * "Early Redemption at 102% of Nominal" → callableByIssuer: true, issuerCallRebate: 2, issuerCallRebateType: "fixed"
      * "Call Price: 100% + 3% p.a." → callableByIssuer: true, issuerCallRebate: 3, issuerCallRebateType: "per_annum"
      * Table showing "EUR 120.00" with denomination "EUR 1,000" → callableByIssuer: true, issuerCallRebate: 12, issuerCallRebateType: "fixed"

21. For Participation Notes - Basket Reference Performance Detection - CRITICAL:
    - Detect basket calculation method and extract into structureParams.referencePerformance:
      * Look in sections: "Basket Observation", "Performance Calculation", "Reference Asset", "Final Redemption", "Basket Performance", "Final Basket Performance"

    - CRITICAL PRIORITY 1 - Mathematical Formula Detection (ALWAYS takes precedence over text):
      * IF YOU SEE ANY OF THESE FORMULAS → MUST set referencePerformance: "average":
        - ANY summation symbol: "Σ", "∑"
        - "Sum of products" (CRITICAL - this ALWAYS means average/weighted average)
        - "Sum of the products"
        - "sum of products of the Initial Weights"
        - "Initial Weights" combined with multiplication and summation
        - "InitialWeight" with subscript i and summation
        - Any formula with: Σ(weight × performance) or Σ(Initial Weight_i × ...)
        - "n/i=1" or "i=1 to n" (summation notation)
        - Formulas showing weighted sum of performances

      * IF YOU SEE THESE → set referencePerformance: "worst-of":
        - "MIN", "min", "Minimum", "minimum of"
        - Mathematical functions: min() or MIN()

      * IF YOU SEE THESE → set referencePerformance: "best-of":
        - "MAX", "max", "Maximum", "maximum of"
        - Mathematical functions: max() or MAX()

    - PRIORITY 2 - Text Description Detection (ONLY if NO formula found):
      * Patterns for "worst-of": "worst performing", "minimum", "lowest", "least favorable"
      * Patterns for "best-of": "best performing", "maximum", "highest", "most favorable"
      * Patterns for "average": "average performance", "mean", "equally weighted average", "arithmetic mean"
      * For single underlying → "single" (only one asset in underlyings array)

    - MANDATORY EXAMPLES - These MUST return "average":
      * ❗ "Sum of products of the Initial Weights of the Underlying Components" → referencePerformance: "average"
      * ❗ "Σ(i=1 to n) InitialWeight_i × (Final Level_i / Initial Level_i)" → referencePerformance: "average"
      * ❗ Any formula with Σ and Initial Weights → referencePerformance: "average"
      * "Final redemption based on worst performing underlying" → referencePerformance: "worst-of"
      * "MIN(performance_1, performance_2, ...)" → referencePerformance: "worst-of"

    - CRITICAL RULE: If document contains BOTH a mathematical formula AND descriptive text, the FORMULA takes absolute priority
    - For single underlying products → "single"
    - Only default to "worst-of" if NO formula found AND no clear text indicators

22. For Participation Notes - Observation Schedule Generation - CRITICAL:
    ⚠️ MANDATORY: Every observation MUST include rebateAmount field (see below)

    🚨 CRITICAL TABLE EXTRACTION RULE 🚨
    - COUNT THE ROWS: First, count how many rows are in the Early Redemption table
    - EXTRACT ALL ROWS: You MUST create one observation object for EVERY SINGLE ROW in the table
    - NO SKIPPING: Do NOT skip rows, do NOT summarize, do NOT truncate
    - If the table has 12 rows → you MUST create 12 observations
    - If the table has 24 rows → you MUST create 24 observations
    - VERIFY: After extraction, count your observations and ensure it matches the table row count

    - If term sheet shows "Early Redemption Observation Dates" or similar table:
      * STEP 1: Count the total number of rows in the table
      * STEP 2: Generate observationSchedule array with EXACTLY that many observations (one per row)
      * For each observation in the table MUST include ALL these fields:
        - id: "period_0", "period_1", etc.
        - observationDate: Early Redemption Observation Date (ISO format)
        - valueDate: Early Redemption Date (settlement date, ISO format)
        - isCallable: true (issuer can call on this date)
        - autocallLevel: null (not applicable for participation notes)
        - couponBarrier: null (not applicable for participation notes)
        - periodIndex: Sequential starting from 1
        - rebateAmount: CRITICAL - Extract rebate for THIS specific observation:
          * Look for columns: "Early Redemption Coupon Amount", "Coupon Amount", "Rebate", "Early Redemption Price"
          * CURRENCY FORMAT (e.g., "EUR 120.00", "$150", "CHF 100"):
            - Calculate: (Amount / Denomination) × 100
            - Example: EUR 120.00 with denomination EUR 1,000 → (120 / 1000) × 100 = 12
          * PERCENTAGE FORMAT (e.g., "12%", "5.5%"):
            - Extract number directly (12 for "12%")
          * Store as number (e.g., 12 for 12%, NOT 0.12)
          * If amount varies per row, extract individual amount for each observation
          * If same for all rows, use that value for all observations

      * Set scheduleConfig.frequency based on spacing:
        - Monthly spacing → "monthly"
        - Quarterly spacing → "quarterly"
        - Otherwise → "custom"

    - If NO early redemption dates shown (standard participation note):
      * Set scheduleConfig.frequency: "maturity"
      * Generate single observation at finalObservation date
      * Set isCallable: false

    - EXAMPLE 1 - Currency amounts in table:
      Term sheet shows:
      | Early Redemption Observation Date | Early Redemption Date | Coupon Amount |
      | 26/12/2024                        | 06/01/2025           | EUR 120.00    |
      | 27/01/2025                        | 31/01/2025           | EUR 120.00    |
      | 26/02/2025                        | 05/03/2025           | EUR 120.00    |

      Product details show: denomination: 1000, currency: "EUR"

      STEP 1: Calculate rebate percentage from denomination:
      - Denomination: EUR 1,000
      - Row 1 coupon: EUR 120.00 → (120 / 1000) × 100 = 12
      - Row 2 coupon: EUR 120.00 → (120 / 1000) × 100 = 12
      - Row 3 coupon: EUR 120.00 → (120 / 1000) × 100 = 12

      STEP 2: Generate observationSchedule with rebateAmount for EACH observation:
      "observationSchedule": [
        {
          "id": "period_0",
          "observationDate": "2024-12-26",
          "valueDate": "2025-01-06",
          "isCallable": true,
          "autocallLevel": null,
          "couponBarrier": null,
          "periodIndex": 1,
          "rebateAmount": 12
        },
        {
          "id": "period_1",
          "observationDate": "2025-01-27",
          "valueDate": "2025-01-31",
          "isCallable": true,
          "autocallLevel": null,
          "couponBarrier": null,
          "periodIndex": 2,
          "rebateAmount": 12
        },
        {
          "id": "period_2",
          "observationDate": "2025-02-26",
          "valueDate": "2025-03-05",
          "isCallable": true,
          "autocallLevel": null,
          "couponBarrier": null,
          "periodIndex": 3,
          "rebateAmount": 12
        }
      ]

    - EXAMPLE 2 - Percentage in table:
      Term sheet shows:
      | Observation Date | Settlement Date | Early Redemption Price |
      | 15/06/2025      | 20/06/2025      | 105%                   |
      | 15/12/2025      | 20/12/2025      | 105%                   |

      Extract rebate as: 105 - 100 = 5

      "observationSchedule": [
        {
          "id": "period_0",
          "observationDate": "2025-06-15",
          "valueDate": "2025-06-20",
          "isCallable": true,
          "autocallLevel": null,
          "couponBarrier": null,
          "periodIndex": 1,
          "rebateAmount": 5
        },
        {
          "id": "period_1",
          "observationDate": "2025-12-15",
          "valueDate": "2025-12-20",
          "isCallable": true,
          "autocallLevel": null,
          "couponBarrier": null,
          "periodIndex": 2,
          "rebateAmount": 5
        }
      ]

    - EXAMPLE 3 - LARGE TABLE (CRITICAL - Shows how to handle many rows):
      🚨 This example demonstrates that you MUST extract EVERY ROW, no matter how many there are 🚨

      Term sheet shows a monthly callable table with 12 rows:
      | Early Redemption Observation Date | Early Redemption Date | Coupon Amount |
      | 26/12/2024                        | 06/01/2025           | EUR 100.00    |
      | 27/01/2025                        | 31/01/2025           | EUR 100.00    |
      | 26/02/2025                        | 05/03/2025           | EUR 100.00    |
      | 26/03/2025                        | 04/04/2025           | EUR 100.00    |
      | 28/04/2025                        | 06/05/2025           | EUR 100.00    |
      | 26/05/2025                        | 03/06/2025           | EUR 100.00    |
      | 26/06/2025                        | 03/07/2025           | EUR 100.00    |
      | 28/07/2025                        | 04/08/2025           | EUR 100.00    |
      | 26/08/2025                        | 03/09/2025           | EUR 100.00    |
      | 26/09/2025                        | 03/10/2025           | EUR 100.00    |
      | 27/10/2025                        | 04/11/2025           | EUR 100.00    |
      | 26/11/2025                        | 03/12/2025           | EUR 100.00    |

      Denomination: EUR 1,000
      Calculation: (100 / 1000) × 100 = 10% rebate per observation

      YOU MUST CREATE 12 OBSERVATIONS (one for each row):
      "observationSchedule": [
        {"id": "period_0", "observationDate": "2024-12-26", "valueDate": "2025-01-06", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 1, "rebateAmount": 10},
        {"id": "period_1", "observationDate": "2025-01-27", "valueDate": "2025-01-31", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 2, "rebateAmount": 10},
        {"id": "period_2", "observationDate": "2025-02-26", "valueDate": "2025-03-05", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 3, "rebateAmount": 10},
        {"id": "period_3", "observationDate": "2025-03-26", "valueDate": "2025-04-04", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 4, "rebateAmount": 10},
        {"id": "period_4", "observationDate": "2025-04-28", "valueDate": "2025-05-06", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 5, "rebateAmount": 10},
        {"id": "period_5", "observationDate": "2025-05-26", "valueDate": "2025-06-03", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 6, "rebateAmount": 10},
        {"id": "period_6", "observationDate": "2025-06-26", "valueDate": "2025-07-03", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 7, "rebateAmount": 10},
        {"id": "period_7", "observationDate": "2025-07-28", "valueDate": "2025-08-04", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 8, "rebateAmount": 10},
        {"id": "period_8", "observationDate": "2025-08-26", "valueDate": "2025-09-03", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 9, "rebateAmount": 10},
        {"id": "period_9", "observationDate": "2025-09-26", "valueDate": "2025-10-03", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 10, "rebateAmount": 10},
        {"id": "period_10", "observationDate": "2025-10-27", "valueDate": "2025-11-04", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 11, "rebateAmount": 10},
        {"id": "period_11", "observationDate": "2025-11-26", "valueDate": "2025-12-03", "isCallable": true, "autocallLevel": null, "couponBarrier": null, "periodIndex": 12, "rebateAmount": 10}
      ]

      ✅ VERIFICATION: Table has 12 rows → Created 12 observations → CORRECT
      ❌ WRONG: Creating only 1-3 observations when table has 12 rows

      REMEMBER: If the term sheet table has 15, 20, or even 24 rows, you MUST create that many observations!

      CRITICAL VALIDATION - rebateAmount field:
      - MUST be present in EVERY observation in observationSchedule array
      - MUST be a number (e.g., 12, not "12%" or "0.12")
      - Calculate from currency: (Amount / Denomination) × 100
      - Extract from percentage: Remove "%" symbol and parse number
      - If table shows varying amounts: Extract individually for each row
      - If table shows same amount: Use same value for all observations
      - NEVER leave rebateAmount as null or undefined for Participation Notes

      COMMON TERM SHEET PATTERNS:
      - "Early Redemption Coupon Amount: EUR 120.00" → Calculate percentage from denomination
      - "Early Redemption Price: 112%" → Extract 12 (the amount above 100%)
      - "Rebate: 5% p.a." → Extract 5 (note: type handled separately in structureParams)
      - Table with different amounts per row → Extract each individual value

      ⚠️ FINAL VALIDATION BEFORE RETURNING JSON:
      - Check EVERY observation in observationSchedule array
      - VERIFY each observation has "rebateAmount" field present
      - If ANY observation is missing rebateAmount, ADD IT with calculated value
      - For Participation Notes: rebateAmount is MANDATORY, not optional

      RATE PRODUCTS (templateId "rate" — CMS steepener / target-redemption / TARN rate certificates):
      - These have NO equity/fund underlying. The references are INTEREST-RATE indices
        (e.g. "EUR CMS 30Y", "EUR CMS 5Y", "Euribor"). Represent each as a synthetic underlying:
        ticker = the rate name, securityData.exchange = "RATE", isin = "", strike = 0. Do NOT invent
        equity tickers or ISINs for them.
      - structureParams to extract:
        * capitalProtection: the % of nominal returned at maturity (e.g. "100% x NA" → 100).
        * fixedCouponRate + fixedPeriods: if early periods pay a fixed coupon (e.g. "t = 1 to 8: 8.50% per annum")
          set fixedCouponRate = 8.5 and fixedPeriods = 8.
        * floatingFormulaLabel: the verbatim floating-coupon formula for the remaining periods
          (e.g. "Max(EUR CMS 30Y − EUR CMS 5Y, 0%)").
        * targetCoupon + targetRedemptionEnabled: if there is a "Target Coupon" / "Target Redemption" /
          "Automatic Early Redemption when cumulative coupon ≥ X%", set targetCoupon = X and
          targetRedemptionEnabled = true. Otherwise targetRedemptionEnabled = false.
        * couponFrequency: from the interest-period spacing (quarterly/semi-annually/annually).
      - observationSchedule: extract ALL coupon/interest periods from the schedule table (these notes
        commonly have 40+ rows). For each row include id ("period_0"…), observationDate (the fixing/observation
        date if present, else the interest-period end date), valueDate (the interest payment date), periodIndex
        (1-based). Do NOT skip rows. autocallLevel/couponBarrier may be null (not applicable to rate products).
      - Floating coupon VALUES are NOT extracted here (the underlying rate fixings are entered manually later).

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
          // Opus 4.7 uses adaptive thinking; effort controls reasoning depth.
          // "high" is appropriate for term sheet extraction (tables, formulas, dates).
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high' }
        }
      });

      if (response.data && response.data.content && response.data.content.length > 0) {
        // Extract thinking blocks for formula detection
        const thinkingBlocks = response.data.content
          .filter(block => block.type === 'thinking')
          .map(block => block.thinking)
          .join('\n');

        // Extract text from response (filter out thinking blocks)
        const textContent = response.data.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');

        console.log('[TermSheetExtractor] Raw response:', textContent.substring(0, 200) + '...');

        // Check thinking blocks for formula mentions
        const thinkingLower = thinkingBlocks.toLowerCase();
        const hasFormulaInThinking =
          thinkingLower.includes('sum of products') ||
          thinkingLower.includes('∑') ||
          thinkingLower.includes('summation') ||
          thinkingLower.includes('weighted average') ||
          thinkingLower.includes('initial weight');

        if (hasFormulaInThinking) {
          console.log('[TermSheetExtractor] 🔍 FORMULA DETECTED in AI thinking blocks - will validate basket type');
        }

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

        // POST-PROCESSING: Validate basket type detection
        if (extractedData.structureParams?.referencePerformance) {
          console.log('[TermSheetExtractor] POST-PROCESSING: Validating basket type...');
          console.log('[TermSheetExtractor] Extracted referencePerformance:', extractedData.structureParams.referencePerformance);

          // AGGRESSIVE AUTO-CORRECTION: If AI thinking mentioned formulas but extracted "worst-of", force-correct to "average"
          if (hasFormulaInThinking && extractedData.structureParams.referencePerformance === 'worst-of') {
            console.warn('[TermSheetExtractor] 🚨 CRITICAL AUTO-CORRECTION: AI thinking mentioned summation formulas but extracted "worst-of". FORCING correction to "average".');
            extractedData.structureParams.referencePerformance = 'average';
            console.log('[TermSheetExtractor] ✅ Basket type corrected to "average" based on formula detection');
          }

          // Additional check: For Participation Notes with multiple underlyings defaulting to "worst-of"
          // This is likely an error since basket participation notes usually use average/weighted average
          if (extractedData.structureParams.referencePerformance === 'worst-of' &&
              extractedData.underlyings &&
              extractedData.underlyings.length > 1 &&
              extractedData.templateId === 'participation_note') {
            console.warn('[TermSheetExtractor] ⚠️ POST-PROCESSING WARNING: Participation Note with multiple underlyings detected as "worst-of". Most basket participation notes use "average". Consider verifying the term sheet.');

            // For multi-underlying Participation Notes, default to "average" unless explicitly stated otherwise
            // This is a safe assumption since average/weighted average is the most common for basket structures
            console.log('[TermSheetExtractor] 🔄 APPLYING HEURISTIC: Defaulting multi-underlying Participation Note to "average"');
            extractedData.structureParams.referencePerformance = 'average';
          }

          // If "worst-of" is still detected, log for manual review
          if (extractedData.structureParams.referencePerformance === 'worst-of') {
            console.log('[TermSheetExtractor] POST-PROCESSING: "worst-of" detected and retained. If term sheet contains summation formulas, manually verify this is correct.');
          } else if (extractedData.structureParams.referencePerformance === 'average') {
            console.log('[TermSheetExtractor] ✅ POST-PROCESSING: "average" confirmed (likely formula-based or auto-corrected)');
          }
        }

        // POST-PROCESSING: Memory autocall / memory coupon safeguard.
        // The "Snowball" family describes memory autocall without ever using the word
        // "memory" (each underlying may satisfy its level on the current OR any preceding
        // observation date). Rather than rely solely on the model flipping the flag, also
        // detect it from the extracted title and the model's own reasoning, and only ever
        // promote false -> true (never override an explicit true).
        if (extractedData.structureParams &&
            (extractedData.structureParams.memoryAutocall !== undefined ||
             extractedData.structureParams.memoryCoupon !== undefined)) {
          const titleLower = (extractedData.title || '').toLowerCase();

          const memoryAutocallSignal =
            titleLower.includes('snowball') ||
            titleLower.includes('memory') ||
            thinkingLower.includes('snowball') ||
            thinkingLower.includes('memory autocall') ||
            thinkingLower.includes('which precede') ||
            thinkingLower.includes('preceding valuation') ||
            thinkingLower.includes('preceding observation') ||
            thinkingLower.includes('any previous valuation') ||
            thinkingLower.includes('or any of the') ||
            thinkingLower.includes('lock-in') ||
            thinkingLower.includes('lock in');

          if (memoryAutocallSignal && !extractedData.structureParams.memoryAutocall) {
            console.warn('[TermSheetExtractor] 🔁 POST-PROCESSING: Memory/Snowball autocall signal detected (title/thinking) but memoryAutocall was false. Forcing memoryAutocall = true.');
            extractedData.structureParams.memoryAutocall = true;
          }

          const memoryCouponSignal =
            titleLower.includes('snowball') ||
            titleLower.includes('memory') ||
            thinkingLower.includes('memory coupon') ||
            thinkingLower.includes('cumulative coupon') ||
            thinkingLower.includes('(1 + t)') ||
            thinkingLower.includes('(1+t)') ||
            thinkingLower.includes('catch-up') ||
            thinkingLower.includes('previously unpaid');

          if (memoryCouponSignal && extractedData.structureParams.memoryCoupon === false) {
            console.warn('[TermSheetExtractor] 🔁 POST-PROCESSING: Memory coupon signal detected but memoryCoupon was false. Forcing memoryCoupon = true.');
            extractedData.structureParams.memoryCoupon = true;
          }
        }

        // POST-PROCESSING: Validate observationSchedule count
        if (extractedData.observationSchedule && Array.isArray(extractedData.observationSchedule)) {
          const obsCount = extractedData.observationSchedule.length;
          console.log(`[TermSheetExtractor] POST-PROCESSING: Observation schedule has ${obsCount} observations`);

          // Warning if only 1 observation for a callable product
          if (obsCount === 1 && extractedData.structureParams?.callableByIssuer) {
            console.warn('[TermSheetExtractor] ⚠️ POST-PROCESSING WARNING: Only 1 observation extracted for callable product. If term sheet shows a table with multiple early redemption dates, ALL rows should be extracted!');
          }

          // Warning if very few observations for monthly/quarterly frequency
          const frequency = extractedData.scheduleConfig?.frequency;
          if ((frequency === 'monthly' && obsCount < 6) || (frequency === 'quarterly' && obsCount < 3)) {
            console.warn(`[TermSheetExtractor] ⚠️ POST-PROCESSING WARNING: Only ${obsCount} observations extracted for ${frequency} frequency. Verify all table rows were extracted.`);
          }

          console.log('[TermSheetExtractor] POST-PROCESSING: Validating rebateAmount in observation schedule...');

          const missingRebate = extractedData.observationSchedule.filter(obs =>
            obs.isCallable && (obs.rebateAmount === undefined || obs.rebateAmount === null)
          );

          if (missingRebate.length > 0) {
            console.warn(`[TermSheetExtractor] ⚠️ POST-PROCESSING WARNING: ${missingRebate.length} callable observations missing rebateAmount field`);

            // Auto-fix: Set to 0 if missing
            missingRebate.forEach(obs => {
              obs.rebateAmount = 0;
              console.log(`[TermSheetExtractor] POST-PROCESSING: Auto-fixed observation ${obs.id} with rebateAmount = 0`);
            });
          } else {
            console.log('[TermSheetExtractor] ✅ POST-PROCESSING: All callable observations have rebateAmount field');
          }
        }

        // POST-PROCESSING: Non-callable participation notes must NOT carry a callable
        // observation schedule. The schedule-generation prompt is heavily biased toward the
        // callable case, so a plain capital-protection participation note (SSPA 1100) can come
        // back with a spurious monthly schedule. If the issuer cannot call, collapse it.
        if ((extractedData.templateId === 'participation_note' || extractedData.template === 'participation_note')) {
          const sp = extractedData.structureParams || {};
          const isCallable = sp.callableByIssuer === true;
          const sched = Array.isArray(extractedData.observationSchedule) ? extractedData.observationSchedule : [];
          const hasCallableObs = sched.some(o => o && o.isCallable === true);

          if (!isCallable && (sched.length > 1 || hasCallableObs)) {
            console.warn(`[TermSheetExtractor] 🚫 POST-PROCESSING: Participation Note is NOT issuer-callable but a ${sched.length}-observation schedule was generated (callable: ${hasCallableObs}). Collapsing to no schedule (single redemption at maturity).`);
            extractedData.observationSchedule = [];
            if (extractedData.scheduleConfig) {
              extractedData.scheduleConfig.frequency = 'maturity';
            }
            if (extractedData.structureParams) {
              extractedData.structureParams.callableByIssuer = false;
            }
          }
        }

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

      // Validate template exists
      const template = BUILT_IN_TEMPLATES.find(t => t._id === templateId);
      if (!template) {
        throw new Meteor.Error('template-not-found', `Template not found: ${templateId}`);
      }

      console.log(`[TermSheetExtractor] Using template: ${template.name}`);

      // Get list of valid issuers from database
      const issuers = await IssuersCollection.find({}).fetchAsync();
      console.log(`[TermSheetExtractor] Found ${issuers.length} issuers for matching`);

      // Generate schema structure for this template
      const structureSchema = generateTemplateSchema(templateId);

      console.log('[TermSheetExtractor] Calling Anthropic API...');

      // Call Anthropic for extraction
      let extractedData;
      try {
        extractedData = await callAnthropicForExtraction(fileData, structureSchema, issuers);
      } catch (error) {
        console.error('[TermSheetExtractor] Extraction failed:', error);
        throw error;
      }

      console.log('[TermSheetExtractor] Extraction complete, normalizing ticker formats...');

      // Normalize ticker formats for EOD API compatibility
      extractedData = normalizeExtractedTickers(extractedData);

      console.log('[TermSheetExtractor] Ticker normalization complete, preparing product document...');

      // Shorten product title if too long (max 80 characters)
      if (extractedData.title && extractedData.title.length > 80) {
        const originalTitle = extractedData.title;

        // For Himalaya products, use short form
        if (extractedData.title.toLowerCase().includes('himalaya')) {
          const durationMatch = extractedData.title.match(/(\d+Y\s*\d*M?)/);
          const duration = durationMatch ? durationMatch[1] : '';

          const underlyingsCount = extractedData.underlyings ? extractedData.underlyings.length : 0;
          const currencyMatch = extractedData.title.match(/\bin\s+([A-Z]{3})$/);
          const currency = currencyMatch ? currencyMatch[1] : extractedData.currency || 'USD';

          extractedData.title = `${duration} Himalaya ${underlyingsCount} Assets ${currency}`.trim();
          console.log(`[TermSheetExtractor] Shortened title: "${originalTitle}" → "${extractedData.title}"`);
        } else {
          // Generic shortening
          extractedData.title = extractedData.title.substring(0, 77) + '...';
          console.log(`[TermSheetExtractor] Truncated title: "${originalTitle}" → "${extractedData.title}"`);
        }
      }

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

      console.log('[TermSheetExtractor] Validating ISIN...');

      // Validate ISIN syntax if present
      if (extractedData.isin) {
        // Clean and normalize ISIN
        extractedData.isin = cleanISIN(extractedData.isin);

        // Validate ISIN syntax using ISO 6166 standard
        const isinValidation = validateISIN(extractedData.isin);
        if (!isinValidation.valid) {
          console.error(`[TermSheetExtractor] Invalid ISIN: ${extractedData.isin} - ${isinValidation.error}`);
          throw new Meteor.Error(
            'invalid-isin',
            `Invalid ISIN extracted from term sheet: "${extractedData.isin}". Error: ${isinValidation.error}. Please verify the ISIN in the term sheet and try again.`
          );
        }

        console.log(`[TermSheetExtractor] ISIN syntax valid: ${extractedData.isin}`);

        // Check if ISIN already exists in database (any status, including draft).
        // Previously we excluded drafts, which let users create real duplicates by
        // re-extracting the same term sheet before finalising the first product.
        const existingProduct = await ProductsCollection.findOneAsync({ isin: extractedData.isin });

        if (existingProduct) {
          console.log(`[TermSheetExtractor] ISIN already exists: ${extractedData.isin} (Product ID: ${existingProduct._id}, status: ${existingProduct.productStatus || 'unknown'})`);
          throw new Meteor.Error(
            'duplicate-isin',
            `A product with ISIN "${extractedData.isin}" already exists in the database. Product title: "${existingProduct.title || existingProduct.productName || 'Untitled'}" (status: ${existingProduct.productStatus || 'unknown'}). Open the existing product instead of re-extracting the term sheet.`
          );
        }

        console.log(`[TermSheetExtractor] ISIN is unique`);
      } else {
        console.warn('[TermSheetExtractor] No ISIN found in extracted data');
      }

      console.log('[TermSheetExtractor] Inserting product into database...');

      // Build termSheet metadata BEFORE inserting the product so it's included
      // in the initial insert. This avoids a race condition where writing the PDF
      // to public/ triggers a Meteor hot-reload before the separate updateAsync
      // can attach the termSheet field.
      const termSheetMetadata = buildTermSheetMetadata(productDocument, session.userId);
      if (termSheetMetadata) {
        productDocument.termSheet = termSheetMetadata;
      }

      // Insert into database (with termSheet field already set)
      let productId;
      try {
        productId = await ProductsCollection.insertAsync(productDocument);
      } catch (dbError) {
        console.error('[TermSheetExtractor] Database insertion failed:', dbError);
        throw new Meteor.Error('db-insert-failed', `Failed to create product: ${dbError.message}`);
      }

      const processingTime = Date.now() - startTime;
      console.log(`[TermSheetExtractor] Product created successfully in ${processingTime}ms, ID: ${productId}`);

      // Write the PDF file to disk AFTER the product is in the database.
      // In dev mode, this may trigger a Meteor hot-reload, but the product
      // already has the termSheet field set from the initial insert.
      if (termSheetMetadata) {
        writeTermSheetFile(fileData, termSheetMetadata);
        console.log(`[TermSheetExtractor] Term sheet attached to product: ${termSheetMetadata.url}`);
      }

      // Auto-create allocations from existing PMS holdings for this ISIN.
      // Mirrors the hook on manual product creation at server/main.js:2575.
      // Without this, products extracted from a term sheet stay disconnected from
      // the bank holdings already imported, so the dashboard shows no Position.
      if (productDocument.isin) {
        Meteor.defer(async () => {
          try {
            const { AllocationHelpers } = await import('./allocations.js');
            const createdAllocations = await AllocationHelpers.autoCreateFromPMSHoldings(productId, productDocument.isin);
            if (createdAllocations.length > 0) {
              console.log(`[TermSheetExtractor] Auto-created ${createdAllocations.length} allocations from PMS holdings for ${productDocument.isin}`);
            }
          } catch (allocError) {
            console.error('[TermSheetExtractor] Error auto-creating allocations:', allocError);
          }
        });
      }

      // Auto-sync to securitiesMetadata if product has ISIN
      if (productDocument.isin) {
        Meteor.defer(async () => {
          try {
            // Map templateId to structuredProductType
            const templateId = productDocument.templateId || productDocument.template || '';
            const templateLower = templateId.toLowerCase();

            let structuredProductType = 'other';
            if (templateLower.includes('phoenix') || templateLower.includes('autocallable')) {
              structuredProductType = 'phoenix';
            } else if (templateLower.includes('orion')) {
              structuredProductType = 'orion';
            } else if (templateLower.includes('himalaya')) {
              structuredProductType = 'himalaya';
            } else if (templateLower.includes('participation')) {
              structuredProductType = 'participation_note';
            } else if (templateLower.includes('reverse_convertible_bond')) {
              structuredProductType = 'reverse_convertible_bond';
            } else if (templateLower.includes('reverse_convertible')) {
              structuredProductType = 'reverse_convertible';
            } else if (templateLower.includes('shark')) {
              structuredProductType = 'shark_note';
            } else if (templateLower.includes('bonus_certificate') || templateLower.includes('bonus')) {
              structuredProductType = 'bonus_certificate';
            }

            // Determine underlying type based on underlyings
            let underlyingType = 'equity_linked';
            if (productDocument.underlyings && productDocument.underlyings.length > 0) {
              const firstUnderlying = productDocument.underlyings[0];
              const ticker = firstUnderlying.ticker || firstUnderlying.symbol || '';
              if (ticker.includes('.BOND') || ticker.includes('BOND')) {
                underlyingType = 'fixed_income_linked';
              } else if (ticker.includes('.COMM') || ticker.includes('GOLD') || ticker.includes('OIL')) {
                underlyingType = 'commodities_linked';
              }
            }

            // Determine protection type from product structure
            let protectionType = 'capital_protected_conditional';
            if (productDocument.capitalProtection === 100) {
              protectionType = 'capital_guaranteed_100';
            } else if (productDocument.capitalProtection && productDocument.capitalProtection > 0) {
              protectionType = 'capital_guaranteed_partial';
            }

            const securityMetadata = {
              isin: productDocument.isin,
              securityName: productDocument.title || productDocument.productName || `Structured Product ${productDocument.isin}`,
              assetClass: 'structured_product',
              structuredProductType: structuredProductType,
              structuredProductUnderlyingType: underlyingType,
              structuredProductProtectionType: protectionType,
              sourceProductId: productId,
              autoCreatedFromProduct: true
            };

            await SecuritiesMetadataHelpers.upsertSecurityMetadata(securityMetadata);
            console.log(`[TermSheetExtractor] Auto-synced to securitiesMetadata: ${productDocument.isin}`);
          } catch (metadataError) {
            console.error('[TermSheetExtractor] Error syncing to securitiesMetadata:', metadataError);
          }
        });
      }

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
