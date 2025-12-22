/**
 * Ticker Symbol Utilities
 *
 * Centralized utilities for normalizing, validating, and managing ticker symbols
 * to ensure compatibility with EOD Historical Data API.
 *
 * EOD API Ticker Formats:
 * - US Stocks/ETFs: AAPL.US, TSLA.US
 * - Indices: GSPC.INDX, STOXX50E.INDX
 * - Forex: EURUSD.FOREX, GBPUSD.FOREX
 * - Crypto: BTC-USD.CC, ETH-USD.CC
 * - European Stocks: SAP.DE, AIR.PA, ASML.AS
 * - Asian Stocks: 7203.T (Toyota), 005930.KS (Samsung)
 */

/**
 * Comprehensive exchange mapping for major international stocks
 * Maps stock ticker to its correct exchange suffix
 */
const STOCK_EXCHANGE_MAP = {
  // === French Stocks (Euronext Paris) .PA ===
  'TTE': '.PA',      // TotalEnergies
  'RNO': '.PA',      // Renault
  'OR': '.PA',       // L'Oréal
  'AI': '.PA',       // Air Liquide
  'AIR': '.PA',      // Airbus
  'SAN': '.PA',      // Sanofi
  'BN': '.PA',       // Danone
  'CA': '.PA',       // Carrefour
  'MC': '.PA',       // LVMH
  'GLE': '.PA',      // Société Générale
  'ML': '.PA',       // Michelin
  'ORA': '.PA',      // Orange
  'SAF': '.PA',      // Safran
  'SU': '.PA',       // Schneider Electric
  'UG': '.PA',       // Peugeot
  'VIV': '.PA',      // Vivendi
  'CS': '.PA',       // AXA
  'BNP': '.PA',      // BNP Paribas
  'FP': '.PA',       // TotalEnergies (alternative)
  'EL': '.PA',       // EssilorLuxottica
  'PUB': '.PA',      // Publicis
  'VIE': '.PA',      // Veolia
  'DG': '.PA',       // Vinci
  'SGO': '.PA',      // Saint-Gobain
  'KER': '.PA',      // Kering
  'RI': '.PA',       // Pernod Ricard

  // === German Stocks (XETRA/Frankfurt) ===
  // EOD API supports: XETRA, F, BE, HM, DU, HA, MU, STU
  // Using .XETRA as primary (main electronic exchange)
  'SAP': '.XETRA',   // SAP
  'VOW3': '.XETRA',  // Volkswagen
  'ADS': '.XETRA',   // Adidas
  'BMW': '.XETRA',   // BMW
  'DAI': '.XETRA',   // Daimler/Mercedes
  'BAS': '.XETRA',   // BASF
  'ALV': '.XETRA',   // Allianz
  'DTE': '.XETRA',   // Deutsche Telekom
  'SIE': '.XETRA',   // Siemens
  'MRK': '.XETRA',   // Merck
  'IFX': '.XETRA',   // Infineon
  'FRE': '.XETRA',   // Fresenius
  'HEI': '.XETRA',   // HeidelbergCement
  'CON': '.XETRA',   // Continental
  'LIN': '.XETRA',   // Linde
  'DB1': '.XETRA',   // Deutsche Börse
  'DBK': '.XETRA',   // Deutsche Bank
  'MUV2': '.XETRA',  // Munich Re
  'BEI': '.XETRA',   // Beiersdorf
  'HEN3': '.XETRA',  // Henkel
  'VNA': '.XETRA',   // Vonovia
  'EOAN': '.XETRA',  // E.ON
  'RWE': '.XETRA',   // RWE
  'PAH3': '.XETRA',  // Porsche

  // === Dutch Stocks (Euronext Amsterdam) .AS ===
  'ASML': '.AS',     // ASML
  'RDSA': '.AS',     // Shell (Class A)
  'RDSB': '.AS',     // Shell (Class B)
  'UNA': '.AS',      // Unilever
  'PHIA': '.AS',     // Philips
  'ING': '.AS',      // ING Group
  'ABN': '.AS',      // ABN AMRO
  'KPN': '.AS',      // KPN
  'RAND': '.AS',     // Randstad
  'DSM': '.AS',      // DSM
  'HEIA': '.AS',     // Heineken
  'AD': '.AS',       // Ahold Delhaize
  'AKZA': '.AS',     // AkzoNobel
  'WKL': '.AS',      // Wolters Kluwer
  'INGA': '.AS',     // ING (alternative)

  // === Italian Stocks (Borsa Italiana) .MI ===
  'ENI': '.MI',      // Eni
  'ISP': '.MI',      // Intesa Sanpaolo
  'UCG': '.MI',      // UniCredit
  'TIT': '.MI',      // Telecom Italia
  'ENEL': '.MI',     // Enel
  'G': '.MI',        // Generali
  'MB': '.MI',       // Mediobanca
  'RACE': '.MI',     // Ferrari
  'SRG': '.MI',      // Snam Rete Gas
  'FCA': '.MI',      // Fiat Chrysler (now Stellantis)
  'TEN': '.MI',      // Tenaris
  'STLA': '.MI',     // Stellantis
  'LDO': '.MI',      // Leonardo
  'PRY': '.MI',      // Prysmian

  // === Swiss Stocks (SIX Swiss Exchange) .SW ===
  'NESN': '.SW',     // Nestlé
  'ROG': '.SW',      // Roche
  'NOVN': '.SW',     // Novartis
  'UHR': '.SW',      // Swatch Group
  'CFR': '.SW',      // Compagnie Financière Richemont
  'ABBN': '.SW',     // ABB
  'SREN': '.SW',     // Swiss Re
  'GIVN': '.SW',     // Givaudan
  'ZURN': '.SW',     // Zurich Insurance
  'LONN': '.SW',     // Lonza
  'CSGN': '.SW',     // Credit Suisse
  'UBSG': '.SW',     // UBS
  'SLHN': '.SW',     // Swiss Life
  'BAER': '.SW',     // Julius Baer
  'SCMN': '.SW',     // Swisscom
  'GEBN': '.SW',     // Geberit
  'HOLN': '.SW',     // Holcim
  'SGSN': '.SW',     // SGS

  // === UK Stocks (London Stock Exchange) .LSE ===
  'VOD': '.LSE',     // Vodafone
  'BP': '.LSE',      // BP
  'RDSA': '.LSE',    // Royal Dutch Shell A
  'RDSB': '.LSE',    // Royal Dutch Shell B
  'GSK': '.LSE',     // GlaxoSmithKline
  'AZN': '.LSE',     // AstraZeneca
  'ULVR': '.LSE',    // Unilever
  'DGE': '.LSE',     // Diageo
  'RIO': '.LSE',     // Rio Tinto
  'BHP': '.LSE',     // BHP
  'HSBA': '.LSE',    // HSBC
  'BATS': '.LSE',    // British American Tobacco
  'LLOY': '.LSE',    // Lloyds Banking Group
  'BARC': '.LSE',    // Barclays
  'PRU': '.LSE',     // Prudential
  'NG': '.LSE',      // National Grid
  'SSE': '.LSE',     // SSE
  'LSEG': '.LSE',    // London Stock Exchange Group
  'IMB': '.LSE',     // Imperial Brands
  'RB': '.LSE',      // Reckitt Benckiser
  'REL': '.LSE',     // RELX
  'STAN': '.LSE',    // Standard Chartered
  'OCDO': '.LSE',    // Ocado (added)

  // === Danish Stocks (Nasdaq Copenhagen) .CO ===
  'NOVO-B': '.CO',   // Novo Nordisk
  'NOVOB': '.CO',    // Novo Nordisk (alternative)
  'DSV': '.CO',      // DSV
  'MAERSK-B': '.CO', // Maersk
  'VWS': '.CO',      // Vestas Wind Systems
  'COLO-B': '.CO',   // Coloplast
  'CARL-B': '.CO',   // Carlsberg
  'TRYG': '.CO',     // Tryg
  'ORSTED': '.CO',   // Ørsted
  'GN': '.CO',       // GN Store Nord
  'CHR': '.CO',      // Chr. Hansen
  'DEMANT': '.CO',   // Demant
  'PNDORA': '.CO',   // Pandora

  // === Swedish Stocks (Nasdaq Stockholm) .ST ===
  'VOLV-B': '.ST',   // Volvo
  'HM-B': '.ST',     // H&M
  'ERIC-B': '.ST',   // Ericsson
  'ATCO-A': '.ST',   // Atlas Copco
  'ABB': '.ST',      // ABB (also listed in Switzerland)
  'SKA-B': '.ST',    // Skanska
  'SEB-A': '.ST',    // SEB
  'SWED-A': '.ST',   // Swedbank
  'SAND': '.ST',     // Sandvik
  'ALFA': '.ST',     // Alfa Laval
  'ASSA-B': '.ST',   // ASSA ABLOY
  'ESSITY-B': '.ST', // Essity

  // === Norwegian Stocks (Oslo Børs) .OL ===
  'EQNR': '.OL',     // Equinor
  'DNB': '.OL',      // DNB
  'TEL': '.OL',      // Telenor
  'MOWI': '.OL',     // Mowi
  'YAR': '.OL',      // Yara
  'ORK': '.OL',      // Orkla
  'NHY': '.OL',      // Norsk Hydro
  'AKRBP': '.OL',    // Aker BP

  // === Finnish Stocks (Nasdaq Helsinki) .HE ===
  'NOKIA': '.HE',    // Nokia
  'KNEBV': '.HE',    // KONE
  'FORTUM': '.HE',   // Fortum
  'SAMPO': '.HE',    // Sampo
  'NESTE': '.HE',    // Neste
  'UPM': '.HE',      // UPM-Kymmene
  'STERV': '.HE',    // Stora Enso
  'TYRES': '.HE',    // Nokian Tyres

  // === Spanish Stocks (BME Spanish Exchanges) .MC ===
  'SAN': '.MC',      // Banco Santander
  'TEF': '.MC',      // Telefónica
  'IBE': '.MC',      // Iberdrola
  'ITX': '.MC',      // Inditex
  'BBVA': '.MC',     // BBVA
  'REP': '.MC',      // Repsol
  'ENG': '.MC',      // Enagás
  'ACS': '.MC',      // ACS
  'FER': '.MC',      // Ferrovial
  'AENA': '.MC',     // Aena
  'CABK': '.MC',     // CaixaBank
  'IAG': '.MC',      // International Airlines Group

  // === Belgian Stocks (Euronext Brussels) .BR ===
  'ABI': '.BR',      // Anheuser-Busch InBev
  'KBC': '.BR',      // KBC Group
  'ACKB': '.BR',     // Ackermans & van Haaren
  'COFB': '.BR',     // Cofinimmo
  'SOF': '.BR',      // Sofina
  'UCB': '.BR',      // UCB
  'COLR': '.BR',     // Colruyt

  // === Portuguese Stocks (Euronext Lisbon) .LS ===
  'EDP': '.LS',      // EDP
  'GALP': '.LS',     // Galp Energia
  'BCP': '.LS',      // Banco Comercial Português
  'JMT': '.LS',      // Jerónimo Martins
  'NOS': '.LS',      // NOS

  // === Austrian Stocks (Vienna Stock Exchange) .VI ===
  'VOE': '.VI',      // Voestalpine
  'ANDR': '.VI',     // Andritz
  'EBS': '.VI',      // Erste Group Bank
  'OMV': '.VI',      // OMV
  'POST': '.VI',     // Österreichische Post
  'RBI': '.VI',      // Raiffeisen Bank International

  // === Singapore Stocks (SGX) .SI ===
  'D05': '.SI',      // DBS Bank
  'O39': '.SI',      // OCBC Bank
  'U11': '.SI',      // UOB
  'Z74': '.SI',      // Singtel
  'C52': '.SI',      // ComfortDelGro

  // === Hong Kong Stocks (HKEX) .HK ===
  '0005': '.HK',     // HSBC Holdings
  '0700': '.HK',     // Tencent
  '0941': '.HK',     // China Mobile
  '1299': '.HK',     // AIA Group
  '2318': '.HK',     // Ping An Insurance
  '0939': '.HK',     // China Construction Bank
  '1398': '.HK',     // ICBC

  // === South Korean Stocks (KRX) .KS ===
  '005930': '.KS',   // Samsung Electronics
  '000660': '.KS',   // SK Hynix
  '035420': '.KS',   // Naver
  '035720': '.KS',   // Kakao
  '051910': '.KS',   // LG Chem

  // === Japanese Stocks (Tokyo Stock Exchange) .T ===
  '7203': '.T',      // Toyota
  '9984': '.T',      // SoftBank
  '6758': '.T',      // Sony
  '7974': '.T',      // Nintendo
  '8306': '.T',      // Mitsubishi UFJ
  '9432': '.T',      // NTT
  '6861': '.T',      // Keyence
  '4063': '.T',      // Shin-Etsu Chemical
};

/**
 * Map country codes to exchange suffixes
 */
const COUNTRY_TO_EXCHANGE = {
  'US': '.US',
  'FR': '.PA',
  'DE': '.XETRA',    // Germany uses XETRA (main electronic exchange)
  'NL': '.AS',
  'IT': '.MI',
  'CH': '.SW',
  'GB': '.LSE',
  'UK': '.LSE',
  'DK': '.CO',
  'SE': '.ST',
  'NO': '.OL',
  'FI': '.HE',
  'ES': '.MC',
  'BE': '.BR',
  'PT': '.LS',
  'AT': '.VI',
  'SG': '.SI',
  'HK': '.HK',
  'KR': '.KS',
  'JP': '.T',
  'AU': '.AX',
  'CA': '.TO',
  'BR': '.SA',
  'MX': '.MX',
  'IN': '.NS',
  'CN': '.SS',
};

/**
 * Currency to primary exchange mapping (fallback)
 */
const CURRENCY_TO_EXCHANGE = {
  'USD': '.US',
  'EUR': '.PA',  // Default to Paris for EUR (could also be .DE, .AS, .MI)
  'GBP': '.LSE',
  'CHF': '.SW',
  'DKK': '.CO',
  'SEK': '.ST',
  'NOK': '.OL',
  'JPY': '.T',
  'HKD': '.HK',
  'SGD': '.SI',
  'KRW': '.KS',
  'AUD': '.AX',
  'CAD': '.TO',
};

/**
 * Validates if a string looks like a valid ticker symbol
 *
 * @param {string} symbol - Symbol to validate
 * @returns {Object} Validation result with { valid: boolean, reason: string }
 */
export const validateTickerFormat = (symbol) => {
  if (!symbol || typeof symbol !== 'string') {
    return { valid: false, reason: 'Symbol is empty or not a string' };
  }

  // Trim whitespace
  const trimmed = symbol.trim();

  // Check for spaces (likely a company name, not a ticker)
  if (trimmed.includes(' ')) {
    return { valid: false, reason: 'Symbol contains spaces (likely a company name)' };
  }

  // Check length (tickers are typically 1-10 characters before exchange suffix)
  const parts = trimmed.split('.');
  const tickerPart = parts[0];

  if (tickerPart.length === 0 || tickerPart.length > 10) {
    return { valid: false, reason: 'Ticker symbol too long or empty' };
  }

  // Valid formats:
  // 1. Has exchange suffix: AAPL.US, SAP.DE, NOVO-B.CO
  // 2. Has dash for forex/crypto: EUR-USD.FOREX, BTC-USD.CC
  // 3. Numeric tickers (Asian markets): 7203.T, 005930.KS
  const hasExchange = trimmed.includes('.');
  const hasDash = trimmed.includes('-');
  const isNumeric = /^\d+$/.test(tickerPart);

  if (hasExchange || hasDash || isNumeric) {
    return { valid: true, reason: 'Valid ticker format' };
  }

  // If no exchange suffix and not numeric, it might need normalization
  return {
    valid: true,
    reason: 'Valid ticker but may need exchange suffix',
    needsNormalization: true
  };
};

/**
 * Normalizes a ticker symbol to EOD API format
 *
 * @param {string} symbol - Raw ticker symbol
 * @param {Object} options - Additional context for normalization
 * @param {string} options.name - Security name (helps with validation)
 * @param {string} options.country - Country code (ISO 2-letter)
 * @param {string} options.currency - Currency code (ISO 3-letter)
 * @param {string} options.exchange - Explicit exchange (if known)
 * @returns {string} Normalized ticker symbol with exchange suffix
 */
export const normalizeTickerSymbol = (symbol, options = {}) => {
  if (!symbol || typeof symbol !== 'string') {
    console.warn('[TickerUtils] Invalid symbol:', symbol);
    return null;
  }

  const trimmed = symbol.trim().toUpperCase();
  const { name, country, currency, exchange } = options;

  // If already has exchange suffix, return as-is
  if (trimmed.includes('.') && !trimmed.endsWith('.')) {
    return trimmed;
  }

  // Check if symbol is in hardcoded exchange map
  if (STOCK_EXCHANGE_MAP[trimmed]) {
    return trimmed + STOCK_EXCHANGE_MAP[trimmed];
  }

  // If explicit exchange provided, use it
  if (exchange) {
    const exchangeSuffix = exchange.startsWith('.') ? exchange : `.${exchange}`;
    return `${trimmed}${exchangeSuffix}`;
  }

  // Try to determine exchange from country
  if (country && COUNTRY_TO_EXCHANGE[country.toUpperCase()]) {
    return trimmed + COUNTRY_TO_EXCHANGE[country.toUpperCase()];
  }

  // Try to determine exchange from currency
  if (currency && CURRENCY_TO_EXCHANGE[currency.toUpperCase()]) {
    return trimmed + CURRENCY_TO_EXCHANGE[currency.toUpperCase()];
  }

  // Default to US exchange for unknown tickers
  console.log(`[TickerUtils] No specific exchange found for ${trimmed}, defaulting to .US`);
  return `${trimmed}.US`;
};

/**
 * Extracts exchange suffix from a ticker symbol
 *
 * @param {string} ticker - Ticker symbol (e.g., "AAPL.US")
 * @returns {string|null} Exchange suffix (e.g., "US") or null if none
 */
export const extractExchange = (ticker) => {
  if (!ticker || !ticker.includes('.')) {
    return null;
  }

  const parts = ticker.split('.');
  return parts[parts.length - 1];
};

/**
 * Extracts base symbol from a ticker (removes exchange suffix)
 *
 * @param {string} ticker - Full ticker symbol (e.g., "AAPL.US")
 * @returns {string} Base symbol (e.g., "AAPL")
 */
export const extractBaseSymbol = (ticker) => {
  if (!ticker) {
    return '';
  }

  return ticker.split('.')[0];
};

/**
 * Determines currency from ticker exchange
 *
 * @param {string} ticker - Full ticker symbol with exchange
 * @returns {string} Currency code (ISO 3-letter)
 */
export const getCurrencyFromTicker = (ticker) => {
  const exchange = extractExchange(ticker);

  if (!exchange) {
    return 'USD'; // Default
  }

  // Index currencies
  if (exchange === 'INDX') {
    const symbol = extractBaseSymbol(ticker);
    if (['STOXX50E', 'FCHI', 'GDAXI', 'SX5E', 'CAC', 'DAX'].includes(symbol)) {
      return 'EUR';
    } else if (symbol === 'N225') {
      return 'JPY';
    } else if (['FTSE', 'UKX'].includes(symbol)) {
      return 'GBP';
    }
    return 'USD'; // Most indices priced in USD
  }

  // Exchange to currency mapping
  const exchangeToCurrency = {
    'US': 'USD',
    'PA': 'EUR',
    'XETRA': 'EUR', // XETRA
    'F': 'EUR',     // Frankfurt
    'DE': 'EUR',    // Keep for backwards compatibility
    'BE': 'EUR',    // Berlin
    'HM': 'EUR',    // Hamburg
    'DU': 'EUR',    // Dusseldorf
    'HA': 'EUR',    // Hanover
    'MU': 'EUR',    // Munich
    'STU': 'EUR',   // Stuttgart
    'AS': 'EUR',
    'MI': 'EUR',
    'MC': 'EUR',
    'BR': 'EUR',
    'LS': 'EUR',
    'VI': 'EUR',
    'SW': 'CHF',
    'LSE': 'GBP',
    'L': 'GBP',     // Keep for backwards compatibility
    'IL': 'GBP',    // London IL
    'CO': 'DKK',
    'ST': 'SEK',
    'OL': 'NOK',
    'HE': 'EUR',
    'T': 'JPY',
    'HK': 'HKD',
    'SI': 'SGD',
    'KS': 'KRW',
    'AX': 'AUD',
    'TO': 'CAD',
  };

  return exchangeToCurrency[exchange] || 'USD';
};

/**
 * Checks if a ticker is a known exchange-listed stock
 *
 * @param {string} ticker - Ticker symbol
 * @returns {boolean} True if ticker is in known stock list
 */
export const isKnownStock = (ticker) => {
  const baseSymbol = extractBaseSymbol(ticker?.toUpperCase() || '');
  return STOCK_EXCHANGE_MAP.hasOwnProperty(baseSymbol);
};

/**
 * Gets user-friendly exchange name from exchange code
 *
 * @param {string} exchangeCode - Exchange code (e.g., "US", "PA", "DE")
 * @returns {string} Full exchange name
 */
export const getExchangeName = (exchangeCode) => {
  const exchangeNames = {
    // Major exchanges
    'US': 'US Exchanges (NYSE/NASDAQ)',
    'PA': 'Euronext Paris',
    'XETRA': 'XETRA Stock Exchange',
    'F': 'Frankfurt Stock Exchange',
    'DE': 'XETRA (legacy)',  // Keep for backwards compatibility
    'AS': 'Euronext Amsterdam',
    'MI': 'Borsa Italiana (Milan)',
    'SW': 'SIX Swiss Exchange',
    'LSE': 'London Stock Exchange',
    'L': 'London Stock Exchange (legacy)',
    'IL': 'London IL',

    // Nordic exchanges
    'CO': 'Copenhagen Exchange',
    'ST': 'Stockholm Exchange',
    'OL': 'Oslo Stock Exchange',
    'HE': 'Helsinki Exchange',

    // Other European
    'MC': 'Madrid Exchange',
    'BR': 'Euronext Brussels',
    'LS': 'Euronext Lisbon',
    'VI': 'Vienna Exchange',
    'LU': 'Luxembourg Stock Exchange',
    'IR': 'Irish Exchange',
    'IC': 'Iceland Exchange',
    'PR': 'Prague Stock Exchange',
    'BUD': 'Budapest Stock Exchange',
    'WAR': 'Warsaw Stock Exchange',
    'RO': 'Bucharest Stock Exchange',
    'ZSE': 'Zagreb Stock Exchange',
    'AT': 'Athens Exchange',

    // German regional exchanges
    'BE': 'Berlin Exchange',
    'HM': 'Hamburg Exchange',
    'DU': 'Dusseldorf Exchange',
    'HA': 'Hanover Exchange',
    'MU': 'Munich Exchange',
    'STU': 'Stuttgart Exchange',

    // Asian/Global exchanges
    'SI': 'Singapore Exchange',
    'HK': 'Hong Kong Stock Exchange',
    'KS': 'Korea Exchange',
    'T': 'Tokyo Stock Exchange',
    'AX': 'Australian Securities Exchange',
    'TO': 'Toronto Stock Exchange',

    // Indices and special
    'INDX': 'Index',
    'FOREX': 'Forex',
    'CC': 'Cryptocurrency',
  };

  return exchangeNames[exchangeCode] || exchangeCode;
};

/**
 * Normalizes exchange suffixes for EOD Historical Data API compatibility
 *
 * IMPORTANT: Database may store human-readable exchange names (e.g., "XETRA", "LSE")
 * but EOD API uses standardized exchange codes (e.g., ".F", ".L").
 * This function converts database exchange names to EOD API format.
 *
 * Common conversions:
 * - XETRA/DE → F (Frankfurt Stock Exchange)
 * - LSE/LON → L (London Stock Exchange)
 * - EPA/PAR → PA (Euronext Paris)
 *
 * @param {string} ticker - Ticker with exchange suffix (e.g., "CON.XETRA", "BP.LSE")
 * @returns {string} Normalized ticker for EOD API (e.g., "CON.F", "BP.L")
 */
export const normalizeExchangeForEOD = (ticker) => {
  if (!ticker || typeof ticker !== 'string') {
    return ticker;
  }

  // Exchange suffix mapping: Database format → EOD API format
  // Based on official EOD API exchanges list: https://eodhd.com/api/exchanges-list/
  const exchangeNormalization = {
    // US exchanges (EOD supports unified .US or separate exchange codes)
    // Unified .US is recommended and covers NYSE, NASDAQ, NYSE ARCA, OTC, BATS, etc.
    '.NASDAQ': '.US',        // NASDAQ → US (unified exchange)
    '.NYSE': '.US',          // NYSE → US (unified exchange)
    '.BATS': '.US',          // BATS → US
    '.OTC': '.US',           // OTC → US
    '.OTCBB': '.US',         // OTCBB → US
    '.OTCQB': '.US',         // OTCQB → US
    '.OTCQX': '.US',         // OTCQX → US
    '.PINK': '.US',          // PINK → US
    '.OTCMKTS': '.US',       // OTC Markets → US
    '.NYSEARCA': '.US',      // NYSE ARCA → US
    '.NYSEAMERICAN': '.US',  // NYSE American → US

    // German exchanges (EOD supports: XETRA, F, BE, HM, DU, HA, MU, STU)
    '.DE': '.XETRA',        // Germany → XETRA (most common)
    '.FWB': '.F',           // Frankfurter Wertpapierbörse → Frankfurt
    '.FRANKFURT': '.F',     // Frankfurt → F

    // UK exchanges (EOD supports: LSE, IL)
    '.LON': '.LSE',         // London → LSE
    '.L': '.LSE',           // .L → LSE (EOD doesn't support .L - must use LSE)

    // French exchanges (EOD supports: PA)
    '.EPA': '.PA',          // Euronext Paris → PA
    '.PAR': '.PA',          // Paris → PA

    // Norwegian exchange (EOD supports: OL)
    '.OSL': '.OL',          // Oslo → OL (EOD uses .OL not .OSL)

    // Other common variations
    '.AMS': '.AS',          // Amsterdam → AS
    '.MIL': '.MI',          // Milan → MI (not in visible list, but commonly used)
    '.SWX': '.SW',          // Swiss Exchange → SW
  };

  // Check if ticker has an exchange suffix that needs normalization
  for (const [dbFormat, eodFormat] of Object.entries(exchangeNormalization)) {
    if (ticker.endsWith(dbFormat)) {
      const normalized = ticker.replace(dbFormat, eodFormat);
      // Only log when actually normalizing (not for already-correct formats)
      if (normalized !== ticker) {
        console.log(`[TickerUtils] Normalized exchange: ${ticker} → ${normalized}`);
      }
      return normalized;
    }
  }

  // No normalization needed - return as-is
  return ticker;
};

/**
 * Batch normalize an array of ticker symbols
 *
 * @param {Array<string>} symbols - Array of raw symbols
 * @param {Object} commonOptions - Common options to apply to all
 * @returns {Array<Object>} Array of { original, normalized, valid, reason }
 */
export const batchNormalizeTickers = (symbols, commonOptions = {}) => {
  if (!Array.isArray(symbols)) {
    return [];
  }

  return symbols.map(symbol => {
    const validation = validateTickerFormat(symbol);
    const normalized = validation.valid ? normalizeTickerSymbol(symbol, commonOptions) : null;

    return {
      original: symbol,
      normalized: normalized,
      valid: validation.valid && normalized !== null,
      reason: validation.reason,
      needsNormalization: validation.needsNormalization
    };
  });
};
