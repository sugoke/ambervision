import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';

/**
 * CBonds API Integration Service
 *
 * Provides access to CBonds bond pricing and data through their REST API.
 * Documentation: https://data.cbonds.info/files/api/API_documentation_eng.pdf
 *
 * API Authentication: Basic HTTP auth via login/password URL parameters
 * Base URL: https://ws.cbonds.info/services/json/
 */

// Get API credentials from settings
const CBONDS_LOGIN = Meteor.settings.private?.CBONDS_API_LOGIN;
const CBONDS_PASSWORD = Meteor.settings.private?.CBONDS_API_PASSWORD;
const CBONDS_BASE_URL = Meteor.settings.private?.CBONDS_BASE_URL || 'https://ws.cbonds.info/services/json';

/**
 * CBonds API Helper Functions
 */
export const CBondsApiHelpers = {
  /**
   * Check if API credentials are configured
   */
  isConfigured() {
    return !!(CBONDS_LOGIN && CBONDS_PASSWORD);
  },

  /**
   * Test API connectivity with demo endpoint (no credentials required)
   */
  async testDemoConnection() {
    try {
      const demoUrl = 'https://ws.cbonds.info/services/json/demo/get_emissions/?lang=eng';
      console.log('[CBonds API] Testing demo endpoint:', demoUrl);

      const response = await HTTP.get(demoUrl, {
        timeout: 30000,
        headers: {
          'Accept': 'application/json'
        }
      });

      return {
        success: true,
        statusCode: response.statusCode,
        message: 'Demo endpoint accessible'
      };
    } catch (error) {
      console.error('[CBonds API] Demo test failed:', error.message);
      return {
        success: false,
        error: error.message,
        message: 'Demo endpoint test failed'
      };
    }
  },

  /**
   * Build authenticated URL with credentials
   */
  buildAuthUrl(endpoint) {
    if (!this.isConfigured()) {
      throw new Meteor.Error('cbonds-not-configured',
        'CBonds API credentials not configured. Please add CBONDS_API_LOGIN and CBONDS_API_PASSWORD to settings.json');
    }

    // Remove leading slash from endpoint if present to avoid path replacement
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;

    // Ensure base URL ends with slash
    const baseUrl = CBONDS_BASE_URL.endsWith('/') ? CBONDS_BASE_URL : CBONDS_BASE_URL + '/';

    // Construct full URL
    const fullUrl = baseUrl + cleanEndpoint;
    const url = new URL(fullUrl);

    url.searchParams.set('login', CBONDS_LOGIN);
    url.searchParams.set('password', CBONDS_PASSWORD);
    url.searchParams.set('lang', 'eng');

    console.log('[CBonds API] Built URL:', url.toString().replace(CBONDS_PASSWORD, '***'));
    console.log('[CBonds API] Using login:', CBONDS_LOGIN);

    return url.toString();
  },

  /**
   * Make authenticated GET request to CBonds API
   */
  async makeRequest(endpoint, params = {}) {
    try {
      const url = this.buildAuthUrl(endpoint);

      // Add additional query parameters
      const urlObj = new URL(url);
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
          urlObj.searchParams.set(key, params[key]);
        }
      });

      console.log('[CBonds API] Making request to:', endpoint);

      const response = await HTTP.get(urlObj.toString(), {
        timeout: 30000, // 30 second timeout
        headers: {
          'Accept': 'application/json'
        }
      });

      if (response.statusCode !== 200) {
        throw new Meteor.Error('cbonds-api-error',
          `CBonds API returned status ${response.statusCode}`);
      }

      return response.data;
    } catch (error) {
      console.error('[CBonds API] Request failed:', error.message);

      // Log more details about the error
      if (error.response) {
        console.error('[CBonds API] Response status:', error.response.statusCode);
        console.error('[CBonds API] Response body:', error.response.content);
        console.error('[CBonds API] Response headers:', error.response.headers);

        // Handle 401 Unauthorized specifically
        if (error.response.statusCode === 401) {
          throw new Meteor.Error('cbonds-unauthorized',
            'CBonds API authentication failed. Please verify your login credentials (email: ' + CBONDS_LOGIN + ') are correct and active. Contact CBonds support if the issue persists.');
        }

        throw new Meteor.Error('cbonds-api-error',
          `CBonds API error: ${error.response.statusCode} - ${error.response.content || error.message}`);
      }

      throw new Meteor.Error('cbonds-request-failed',
        `Failed to connect to CBonds API: ${error.message}`);
    }
  },

  /**
   * Search for stocks by ISIN, ticker, or name
   * @param {string} query - Search query (ISIN, ticker, or stock name)
   * @param {object} filters - Optional filters
   * @returns {Promise<Array>} Array of stock results
   */
  async searchStocks(query, filters = {}) {
    if (!query || query.trim().length === 0) {
      throw new Meteor.Error('invalid-query', 'Search query cannot be empty');
    }

    console.log('[CBonds API] Searching stocks:', query, filters);

    try {
      const params = { ...filters };

      // Check if query is an ISIN
      const isISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(query.toUpperCase());
      if (isISIN) {
        params.isin = query.toUpperCase();
      } else {
        params.search = query;
      }

      console.log('[CBonds API] Stock search params:', JSON.stringify(params));

      const data = await this.makeRequest('/get_stocks_full/', params);

      // Parse response
      let results = [];
      if (data.items && Array.isArray(data.items)) {
        results = data.items;
      } else if (Array.isArray(data)) {
        results = data;
      } else if (typeof data === 'object') {
        results = [data];
      }

      console.log('[CBonds API] Found', results.length, 'stocks');
      if (results.length > 0) {
        console.log('[CBonds API] First raw stock fields:', Object.keys(results[0]).join(', '));
        console.log('[CBonds API] First raw stock data:', JSON.stringify(results[0]));
      } else {
        console.log('[CBonds API] No stocks returned from API for query:', query);
      }

      let normalized = results.map(stock => this.normalizeStockData(stock));

      // If searching by ISIN, filter to exact matches only
      if (isISIN) {
        const searchISIN = query.toUpperCase();
        console.log('[CBonds API] Normalized stock ISINs:', normalized.map(s => s.isin).join(', '));

        const exactMatches = normalized.filter(stock => stock.isin === searchISIN);
        console.log(`[CBonds API] Stock ISIN search for ${searchISIN}: found ${normalized.length} results, ${exactMatches.length} exact matches`);

        normalized = exactMatches;
      }

      if (normalized.length > 0) {
        console.log('[CBonds API] Returning', normalized.length, 'stocks');
      }

      return normalized;
    } catch (error) {
      console.error('[CBonds API] Stock search failed:', error);
      throw error;
    }
  },

  /**
   * Search for bonds by ISIN, name, or other criteria
   * @param {string} query - Search query (ISIN, bond name, issuer name)
   * @param {object} filters - Optional filters (currency, maturity range, etc.)
   * @returns {Promise<Array>} Array of bond results
   */
  async searchBonds(query, filters = {}) {
    if (!query || query.trim().length === 0) {
      throw new Meteor.Error('invalid-query', 'Search query cannot be empty');
    }

    console.log('[CBonds API] Searching bonds:', query, filters);

    try {
      // Use get_emissions endpoint for bond search
      const params = {
        ...filters
      };

      // If query looks like an ISIN (alphanumeric, typically 12 chars), search by ISIN
      // Otherwise search by name
      const isISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(query.toUpperCase());
      if (isISIN) {
        params.isin = query.toUpperCase();
      } else {
        params.search = query;
      }

      console.log('[CBonds API] Search params:', JSON.stringify(params));

      const data = await this.makeRequest('/get_emissions/', params);

      // Normalize response structure
      if (!data) {
        return [];
      }

      // CBonds API returns data with this structure:
      // { count: N, total: N, items: [...] }
      let results = [];
      if (data.items && Array.isArray(data.items)) {
        results = data.items;
      } else if (Array.isArray(data)) {
        results = data;
      } else if (data.emissions && Array.isArray(data.emissions)) {
        results = data.emissions;
      } else if (data.data && Array.isArray(data.data)) {
        results = data.data;
      } else if (typeof data === 'object') {
        // Single result returned as object
        results = [data];
      }

      console.log('[CBonds API] Found', results.length, 'bonds');
      if (results.length > 0) {
        console.log('[CBonds API] First raw bond fields:', Object.keys(results[0]).join(', '));
        console.log('[CBonds API] First raw bond data:', JSON.stringify(results[0]));
        // Log the actual ISINs returned
        const returnedISINs = results.map(b => b.isin_code || b.isin || b.ISIN).filter(Boolean);
        console.log('[CBonds API] Returned ISINs:', returnedISINs.join(', '));
      } else {
        console.log('[CBonds API] No bonds returned from API for query:', query);
      }

      let normalized = results.map(bond => this.normalizeBondData(bond));

      // If searching by ISIN, filter to exact matches only
      // CBonds API does fuzzy matching even with isin parameter, so we enforce exact matching
      if (isISIN) {
        const searchISIN = query.toUpperCase();

        // Log all ISINs we got after normalization
        console.log('[CBonds API] Normalized ISINs:', normalized.map(b => b.isin).join(', '));

        const exactMatches = normalized.filter(bond => bond.isin === searchISIN);

        console.log(`[CBonds API] ISIN search for ${searchISIN}: found ${normalized.length} results, ${exactMatches.length} exact matches`);

        // Only return exact matches - no fuzzy results
        normalized = exactMatches;
      }

      if (normalized.length > 0) {
        console.log('[CBonds API] Returning', normalized.length, 'bonds');
        console.log('[CBonds API] First normalized bond:', JSON.stringify(normalized[0]).substring(0, 800));
      }

      return normalized;
    } catch (error) {
      console.error('[CBonds API] Search failed:', error);
      throw error;
    }
  },

  /**
   * Get bond by CBonds ID
   * @param {string|number} bondId - CBonds bond ID (e.g., 928257)
   * @returns {Promise<Object>} Bond details
   */
  async getBondById(bondId) {
    if (!bondId) {
      throw new Meteor.Error('invalid-id', 'Bond ID cannot be empty');
    }

    console.log('[CBonds API] Getting bond by ID:', bondId);

    try {
      const params = {
        id: bondId.toString()
      };

      const data = await this.makeRequest('/get_emissions/', params);

      if (!data || !data.items || data.items.length === 0) {
        throw new Meteor.Error('bond-not-found', `No bond found with ID: ${bondId}`);
      }

      const bond = this.normalizeBondData(data.items[0]);
      console.log('[CBonds API] Found bond:', bond.name, '(ISIN:', bond.isin, ')');

      return bond;
    } catch (error) {
      console.error('[CBonds API] Failed to get bond by ID:', error);
      throw error;
    }
  },

  /**
   * Get detailed information for a specific bond by ISIN
   * @param {string} isin - Bond ISIN code
   * @returns {Promise<Object>} Bond details
   */
  async getBondDetails(isin) {
    if (!isin || isin.trim().length === 0) {
      throw new Meteor.Error('invalid-isin', 'ISIN cannot be empty');
    }

    console.log('[CBonds API] Getting bond details for ISIN:', isin);

    try {
      const results = await this.searchBonds(isin);

      if (!results || results.length === 0) {
        throw new Meteor.Error('bond-not-found', `No bond found with ISIN: ${isin}`);
      }

      // Return the first result (should be exact match)
      return results[0];
    } catch (error) {
      console.error('[CBonds API] Failed to get bond details:', error);
      throw error;
    }
  },

  /**
   * Get stock trading data (price quotes)
   * @param {string|number} stockId - Stock ID
   * @returns {Promise<Object>} Stock trading/price data
   */
  async getStockQuote(stockId) {
    if (!stockId) {
      throw new Meteor.Error('invalid-id', 'Stock ID cannot be empty');
    }

    console.log('[CBonds API] Getting stock quote for stock ID:', stockId);

    try {
      const params = { id: stockId.toString() };
      const data = await this.makeRequest('/get_tradings_stocks_full_new/', params);

      if (data && (data.items || data.quotes || data.tradings)) {
        console.log('[CBonds API] Found stock quote data');
        return data;
      }

      throw new Meteor.Error('quote-not-available', 'Stock price data not available from CBonds API.');
    } catch (error) {
      console.error('[CBonds API] Failed to get stock quote:', error);
      throw error;
    }
  },

  /**
   * Get current price and yield for a bond by ID
   * @param {string|number} bondId - Bond ID
   * @returns {Promise<Object>} Bond price and yield data
   */
  async getBondQuote(bondId) {
    if (!bondId) {
      throw new Meteor.Error('invalid-id', 'Bond ID cannot be empty');
    }

    console.log('[CBonds API] Getting quote for bond ID:', bondId);

    try {
      // Try common CBonds endpoints for quotes
      const endpoints = [
        '/get_quotes/',
        '/get_last_quotes/',
        '/get_prices/'
      ];

      for (const endpoint of endpoints) {
        try {
          const params = { id: bondId.toString() };
          console.log('[CBonds API] Trying endpoint:', endpoint);

          const data = await this.makeRequest(endpoint, params);

          if (data && (data.items || data.quotes || data.prices)) {
            console.log('[CBonds API] Found quote data at endpoint:', endpoint);
            return data;
          }
        } catch (error) {
          console.log('[CBonds API] Endpoint', endpoint, 'not available:', error.message);
          continue;
        }
      }

      throw new Meteor.Error('quote-not-available', 'Price/yield data not available from CBonds API. Your subscription may not include market data.');
    } catch (error) {
      console.error('[CBonds API] Failed to get bond quote:', error);
      throw error;
    }
  },

  /**
   * Search for both bonds and stocks
   * @param {string} query - Search query (ISIN, ticker, or name)
   * @param {object} filters - Optional filters
   * @returns {Promise<Array>} Array of combined results
   */
  async searchAll(query, filters = {}) {
    if (!query || query.trim().length === 0) {
      throw new Meteor.Error('invalid-query', 'Search query cannot be empty');
    }

    console.log('[CBonds API] Searching all (bonds + stocks):', query);

    try {
      // Try both bonds and stocks in parallel
      const [bondResults, stockResults] = await Promise.all([
        this.searchBonds(query, filters).catch(err => {
          console.log('[CBonds API] Bond search failed:', err.message);
          return [];
        }),
        this.searchStocks(query, filters).catch(err => {
          console.log('[CBonds API] Stock search failed:', err.message);
          return [];
        })
      ]);

      const combined = [...bondResults, ...stockResults];
      console.log('[CBonds API] Combined search results:', bondResults.length, 'bonds +', stockResults.length, 'stocks =', combined.length, 'total');

      return combined;
    } catch (error) {
      console.error('[CBonds API] Combined search failed:', error);
      throw error;
    }
  },

  /**
   * Get current price for a specific bond
   * @param {string} isin - Bond ISIN code
   * @returns {Promise<Object>} Bond price information
   */
  async getBondPrice(isin) {
    if (!isin || isin.trim().length === 0) {
      throw new Meteor.Error('invalid-isin', 'ISIN cannot be empty');
    }

    console.log('[CBonds API] Getting bond price for ISIN:', isin);

    try {
      const bondDetails = await this.getBondDetails(isin);

      return {
        isin: bondDetails.isin,
        name: bondDetails.name,
        price: bondDetails.price,
        priceFormatted: bondDetails.priceFormatted,
        yield: bondDetails.yield,
        yieldFormatted: bondDetails.yieldFormatted,
        currency: bondDetails.currency,
        lastUpdate: bondDetails.lastUpdate || new Date()
      };
    } catch (error) {
      console.error('[CBonds API] Failed to get bond price:', error);
      throw error;
    }
  },

  /**
   * Normalize stock data from CBonds API response
   * @param {Object} rawStock - Raw stock data from API
   * @returns {Object} Normalized stock data
   */
  normalizeStockData(rawStock) {
    if (!rawStock) return null;

    const normalized = {
      type: 'stock',
      isin: rawStock.isin_code || rawStock.isin || null,
      ticker: rawStock.ticker || rawStock.symbol || null,
      name: rawStock.emitent_name_eng || rawStock.name || rawStock.ticker || 'Unknown Stock',
      issuer: rawStock.emitent_name_eng || rawStock.emitent_full_name_eng || 'Unknown Issuer',

      // Exchange and market data
      exchange: rawStock.exchange_name_eng || rawStock.exchange || null,
      currency: rawStock.currency_name || rawStock.currency || 'USD',
      country: rawStock.emitent_country_name_eng || rawStock.country || null,

      // Stock-specific fields
      stockId: rawStock.id || null,
      sector: rawStock.sector_name_eng || null,
      industry: rawStock.industry_name_eng || null,

      // Keep raw data for debugging
      _raw: rawStock
    };

    return normalized;
  },

  /**
   * Normalize bond data from CBonds API response
   * @param {Object} rawBond - Raw bond data from API
   * @returns {Object} Normalized bond data
   */
  normalizeBondData(rawBond) {
    if (!rawBond) return null;

    // CBonds API field mapping based on actual response
    const normalized = {
      type: 'bond',
      isin: rawBond.isin_code || rawBond.isin || rawBond.ISIN || null,
      name: rawBond.bbgid_ticker || rawBond.emitent_name_eng || rawBond.name || 'Unknown Bond',
      issuer: rawBond.emitent_name_eng || rawBond.emitent_full_name_eng || rawBond.issuer || 'Unknown Issuer',

      // Price data - CBonds may not return prices in search results
      price: this.parseNumber(rawBond.price || rawBond.last_price || rawBond.close_price),
      priceFormatted: this.formatPrice(rawBond.price || rawBond.last_price || rawBond.close_price, rawBond.currency_name),

      // Yield data
      yield: this.parseNumber(rawBond.yield || rawBond.ytm || rawBond.yield_to_maturity),
      yieldFormatted: this.formatYield(rawBond.yield || rawBond.ytm || rawBond.yield_to_maturity),

      // Coupon data
      coupon: this.parseNumber(rawBond.emission_coupon_rate || rawBond.curr_coupon_rate || rawBond.coupon || rawBond.coupon_rate),
      couponFormatted: this.formatYield(rawBond.emission_coupon_rate || rawBond.curr_coupon_rate || rawBond.coupon || rawBond.coupon_rate),

      // Dates
      maturityDate: this.parseDate(rawBond.maturity_date || rawBond.maturity),
      maturityDateFormatted: this.formatDate(rawBond.maturity_date || rawBond.maturity),
      issueDate: this.parseDate(rawBond.settlement_date || rawBond.date_of_start_circulation || rawBond.issue_date),

      // Other details
      currency: rawBond.currency_name || rawBond.currency || 'USD',
      faceValue: this.parseNumber(rawBond.nominal_price || rawBond.initial_nominal_price || rawBond.face_value),
      outstandingAmount: this.parseNumber(rawBond.outstanding_volume || rawBond.remaining_outstand_amount || rawBond.outstanding),

      // Ratings - CBonds may not include ratings in basic search
      rating: rawBond.rating || rawBond.credit_rating || null,

      // Exchange/Market
      exchange: rawBond.micex_shortname || rawBond.exchange || rawBond.market || null,

      // Additional useful CBonds fields
      bbgid: rawBond.bbgid || null,
      bondType: rawBond.kind_name_eng || null,
      status: rawBond.status_name_eng || null,

      // Last update timestamp
      lastUpdate: this.parseDate(rawBond.update_time || rawBond.updating_date || rawBond.last_update) || new Date(),

      // Keep raw data for debugging
      _raw: rawBond
    };

    return normalized;
  },

  /**
   * Parse numeric value safely
   */
  parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  },

  /**
   * Parse date string safely
   */
  parseDate(dateStr) {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date;
    } catch (error) {
      return null;
    }
  },

  /**
   * Format price with currency
   */
  formatPrice(price, currency = 'USD') {
    const parsed = this.parseNumber(price);
    if (parsed === null) return 'N/A';

    return `${parsed.toFixed(2)} ${currency}`;
  },

  /**
   * Format yield as percentage
   */
  formatYield(yieldValue) {
    const parsed = this.parseNumber(yieldValue);
    if (parsed === null) return 'N/A';

    return `${parsed.toFixed(2)}%`;
  },

  /**
   * Format date to readable string
   */
  formatDate(dateStr) {
    const date = this.parseDate(dateStr);
    if (!date) return 'N/A';

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
};

/**
 * Meteor Methods for Client Access
 */
if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Check if CBonds API is configured
     */
    'cbonds.isConfigured'() {
      return CBondsApiHelpers.isConfigured();
    },

    /**
     * Test demo endpoint connectivity (no auth required)
     */
    async 'cbonds.testDemo'() {
      return await CBondsApiHelpers.testDemoConnection();
    },

    /**
     * Search for both bonds and stocks
     * @param {string} query - Search query (ISIN, ID, ticker, or name)
     * @param {object} filters - Optional search filters
     * @param {string} sessionId - Session ID for authentication
     */
    async 'cbonds.searchAll'(query, filters, sessionId) {
      console.log('[CBonds Method] searchAll called by user:', this.userId);

      // Require authentication (either userId or sessionId)
      if (!this.userId && !sessionId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to search');
      }

      // If query is purely numeric, treat it as a bond ID
      if (/^\d+$/.test(query)) {
        console.log('[CBonds Method] Detected numeric ID, fetching bond by ID:', query);
        const bond = await CBondsApiHelpers.getBondById(query);
        return [bond]; // Return as array for consistency
      }

      return await CBondsApiHelpers.searchAll(query, filters);
    },

    /**
     * Search for bonds only
     * @param {string} query - Search query (ISIN, bond ID, or name)
     * @param {object} filters - Optional search filters
     * @param {string} sessionId - Session ID for authentication
     */
    async 'cbonds.searchBonds'(query, filters, sessionId) {
      console.log('[CBonds Method] searchBonds called by user:', this.userId);

      // Require authentication (either userId or sessionId)
      if (!this.userId && !sessionId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to search bonds');
      }

      // If query is purely numeric, treat it as a bond ID
      if (/^\d+$/.test(query)) {
        console.log('[CBonds Method] Detected numeric ID, fetching bond by ID:', query);
        const bond = await CBondsApiHelpers.getBondById(query);
        return [bond]; // Return as array for consistency
      }

      return await CBondsApiHelpers.searchBonds(query, filters);
    },

    /**
     * Search for stocks only
     * @param {string} query - Search query (ISIN, ticker, or name)
     * @param {object} filters - Optional search filters
     * @param {string} sessionId - Session ID for authentication
     */
    async 'cbonds.searchStocks'(query, filters, sessionId) {
      console.log('[CBonds Method] searchStocks called by user:', this.userId);

      // Require authentication (either userId or sessionId)
      if (!this.userId && !sessionId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to search stocks');
      }

      return await CBondsApiHelpers.searchStocks(query, filters);
    },

    /**
     * Get bond by CBonds ID
     * @param {string|number} bondId - CBonds bond ID
     * @param {string} sessionId - Session ID for authentication
     */
    async 'cbonds.getBondById'(bondId, sessionId) {
      console.log('[CBonds Method] getBondById called by user:', this.userId);

      // Require authentication (either userId or sessionId)
      if (!this.userId && !sessionId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to get bond details');
      }

      return await CBondsApiHelpers.getBondById(bondId);
    },

    /**
     * Get bond details by ISIN
     * @param {string} isin - Bond ISIN code
     * @param {string} sessionId - Session ID for authentication
     */
    async 'cbonds.getBondDetails'(isin, sessionId) {
      console.log('[CBonds Method] getBondDetails called by user:', this.userId);

      // Require authentication (either userId or sessionId)
      if (!this.userId && !sessionId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to get bond details');
      }

      return await CBondsApiHelpers.getBondDetails(isin);
    },

    /**
     * Get bond price by ISIN
     * @param {string} isin - Bond ISIN code
     * @param {string} sessionId - Session ID for authentication
     */
    async 'cbonds.getBondPrice'(isin, sessionId) {
      console.log('[CBonds Method] getBondPrice called by user:', this.userId);

      // Require authentication (either userId or sessionId)
      if (!this.userId && !sessionId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to get bond prices');
      }

      return await CBondsApiHelpers.getBondPrice(isin);
    },

    /**
     * Get bond quote (price/yield) by bond ID
     * @param {string|number} bondId - Bond ID
     * @param {string} sessionId - Session ID for authentication
     */
    async 'cbonds.getBondQuote'(bondId, sessionId) {
      console.log('[CBonds Method] getBondQuote called by user:', this.userId);

      // Require authentication (either userId or sessionId)
      if (!this.userId && !sessionId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to get bond quotes');
      }

      return await CBondsApiHelpers.getBondQuote(bondId);
    },

    /**
     * Get stock quote (price/trading data) by stock ID
     * @param {string|number} stockId - Stock ID
     * @param {string} sessionId - Session ID for authentication
     */
    async 'cbonds.getStockQuote'(stockId, sessionId) {
      console.log('[CBonds Method] getStockQuote called by user:', this.userId);

      // Require authentication (either userId or sessionId)
      if (!this.userId && !sessionId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to get stock quotes');
      }

      return await CBondsApiHelpers.getStockQuote(stockId);
    }
  });
}
