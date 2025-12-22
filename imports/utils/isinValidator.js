/**
 * ISIN (International Securities Identification Number) Validation Utility
 *
 * Validates ISIN syntax according to ISO 6166 standard:
 * - Format: CC NNNNNNNNN C (12 characters total)
 * - CC: 2-letter country code (ISO 3166-1 alpha-2)
 * - NNNNNNNNN: 9 alphanumeric characters (national securities identifier)
 * - C: 1 check digit calculated using Luhn algorithm
 *
 * Examples:
 * - US0378331005 (Apple Inc.)
 * - GB0002374006 (BBC)
 * - DE0005140008 (Deutsche Bank)
 */

/**
 * Validates ISIN format and check digit
 * @param {string} isin - The ISIN to validate
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateISIN(isin) {
  // Check if ISIN is provided
  if (!isin || typeof isin !== 'string') {
    return { valid: false, error: 'ISIN is required' };
  }

  // Remove whitespace and convert to uppercase
  const cleanIsin = isin.trim().toUpperCase();

  // Check length
  if (cleanIsin.length !== 12) {
    return { valid: false, error: `ISIN must be exactly 12 characters (found ${cleanIsin.length})` };
  }

  // Check format: 2 letters + 10 alphanumeric
  const formatRegex = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
  if (!formatRegex.test(cleanIsin)) {
    return { valid: false, error: 'ISIN format invalid. Must be: 2 letters + 9 alphanumeric + 1 digit' };
  }

  // Validate country code (first 2 characters)
  const countryCode = cleanIsin.substring(0, 2);
  if (!isValidCountryCode(countryCode)) {
    return { valid: false, error: `Invalid country code: ${countryCode}` };
  }

  // Validate check digit using Luhn algorithm
  if (!validateCheckDigit(cleanIsin)) {
    return { valid: false, error: 'Invalid ISIN check digit' };
  }

  return { valid: true, error: null };
}

/**
 * Validates ISIN check digit using Luhn algorithm (modulus 10)
 * @param {string} isin - The ISIN to validate
 * @returns {boolean} True if check digit is valid
 */
function validateCheckDigit(isin) {
  // Convert ISIN to numeric string
  // Letters are converted to numbers: A=10, B=11, ..., Z=35
  let numericString = '';
  for (let i = 0; i < isin.length; i++) {
    const char = isin[i];
    if (/[A-Z]/.test(char)) {
      // Convert letter to number: A=10, B=11, ..., Z=35
      numericString += (char.charCodeAt(0) - 55).toString();
    } else {
      numericString += char;
    }
  }

  // Apply Luhn algorithm
  let sum = 0;
  let shouldDouble = false;

  // Process digits from right to left
  for (let i = numericString.length - 1; i >= 0; i--) {
    let digit = parseInt(numericString[i], 10);

    if (shouldDouble) {
      digit *= 2;
      // If doubled digit > 9, sum the digits (e.g., 14 -> 1+4=5)
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  // Check if sum is divisible by 10
  return sum % 10 === 0;
}

/**
 * Validates country code against ISO 3166-1 alpha-2 standard
 * Includes common financial centers and country codes used in ISINs
 * @param {string} code - 2-letter country code
 * @returns {boolean} True if valid country code
 */
function isValidCountryCode(code) {
  // Common ISO 3166-1 alpha-2 country codes used in ISINs
  const validCodes = new Set([
    // Major financial centers
    'US', 'GB', 'DE', 'FR', 'CH', 'JP', 'CA', 'AU', 'HK', 'SG',
    // European countries
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'GR',
    'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL',
    'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI',
    // Americas
    'AR', 'BR', 'CL', 'CO', 'MX', 'PE', 'VE', 'PA', 'CR', 'UY',
    // Asia-Pacific
    'CN', 'IN', 'ID', 'MY', 'TH', 'PH', 'VN', 'KR', 'TW', 'NZ',
    // Middle East & Africa
    'AE', 'SA', 'IL', 'QA', 'KW', 'BH', 'OM', 'ZA', 'EG', 'MA',
    // Other
    'RU', 'TR', 'UA', 'KZ', 'BY', 'RS', 'MK',
    // Special codes
    'XS', // International securities (supranational entities)
    'XF', // International funds
    'EU', // European Union
  ]);

  return validCodes.has(code);
}

/**
 * Calculates the check digit for an ISIN
 * Useful for generating valid ISINs or debugging
 * @param {string} isinWithoutCheckDigit - First 11 characters of ISIN
 * @returns {string|null} The check digit (0-9) or null if invalid input
 */
export function calculateCheckDigit(isinWithoutCheckDigit) {
  if (!isinWithoutCheckDigit || isinWithoutCheckDigit.length !== 11) {
    return null;
  }

  // Convert to numeric string
  let numericString = '';
  for (let i = 0; i < isinWithoutCheckDigit.length; i++) {
    const char = isinWithoutCheckDigit[i].toUpperCase();
    if (/[A-Z]/.test(char)) {
      numericString += (char.charCodeAt(0) - 55).toString();
    } else if (/[0-9]/.test(char)) {
      numericString += char;
    } else {
      return null; // Invalid character
    }
  }

  // Apply Luhn algorithm
  let sum = 0;
  let shouldDouble = true; // Start with doubling since we're missing the check digit

  for (let i = numericString.length - 1; i >= 0; i--) {
    let digit = parseInt(numericString[i], 10);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  // Calculate check digit
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit.toString();
}

/**
 * Formats ISIN with spaces for readability
 * @param {string} isin - The ISIN to format
 * @returns {string} Formatted ISIN (e.g., "US 037833100 5")
 */
export function formatISIN(isin) {
  if (!isin || isin.length !== 12) {
    return isin;
  }
  const clean = isin.trim().toUpperCase();
  return `${clean.substring(0, 2)} ${clean.substring(2, 11)} ${clean.substring(11)}`;
}

/**
 * Cleans and normalizes ISIN input
 * @param {string} isin - The ISIN to clean
 * @returns {string} Cleaned ISIN (uppercase, no spaces)
 */
export function cleanISIN(isin) {
  if (!isin) return '';
  return isin.trim().toUpperCase().replace(/\s/g, '');
}
