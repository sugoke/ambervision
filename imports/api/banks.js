import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

// Banks collection for managing bank information
export const BanksCollection = new Mongo.Collection('banks');

// Bank schema structure:
// {
//   name: String (e.g., "UBS", "Credit Suisse", "Deutsche Bank"),
//   city: String,
//   country: String,
//   countryCode: String (ISO 3166-1 alpha-2, e.g., "CH", "DE", "US"),
//   isActive: Boolean,
//   createdAt: Date,
//   updatedAt: Date,
//   createdBy: String (userId of admin who created it)
// }

// Helper functions for bank management
export const BankHelpers = {
  // Get all active banks
  getActiveBanks() {
    return BanksCollection.find({ isActive: true }, { sort: { name: 1 } });
  },

  // Get banks by country
  getBanksByCountry(countryCode) {
    check(countryCode, String);
    return BanksCollection.find({
      countryCode: countryCode.toUpperCase(),
      isActive: true
    }, { sort: { name: 1 } });
  },

  // Add a new bank (admin only)
  async addBank(name, city, country, countryCode, createdBy) {
    check(name, String);
    check(city, String);
    check(country, String);
    check(countryCode, String);
    check(createdBy, String);

    // Check if bank already exists
    const existingBank = await BanksCollection.findOneAsync({
      name: name.trim(),
      city: city.trim(),
      country: country.trim(),
      isActive: true
    });

    if (existingBank) {
      throw new Error('Bank already exists in this city/country');
    }

    const bankId = await BanksCollection.insertAsync({
      name: name.trim(),
      city: city.trim(),
      country: country.trim(),
      countryCode: countryCode.toUpperCase(),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy
    });

    return bankId;
  },

  // Update bank information
  async updateBank(bankId, updates, updatedBy) {
    check(bankId, String);
    check(updates, Object);
    check(updatedBy, String);

    const allowedFields = ['name', 'city', 'country', 'countryCode'];
    const filteredUpdates = {};
    
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = field === 'countryCode' 
          ? updates[field].toUpperCase() 
          : updates[field].trim();
      }
    });

    filteredUpdates.updatedAt = new Date();
    filteredUpdates.updatedBy = updatedBy;

    return await BanksCollection.updateAsync(bankId, {
      $set: filteredUpdates
    });
  },

  // Deactivate a bank (soft delete)
  async deactivateBank(bankId, deactivatedBy) {
    check(bankId, String);
    check(deactivatedBy, String);
    
    return await BanksCollection.updateAsync(bankId, {
      $set: {
        isActive: false,
        updatedAt: new Date(),
        deactivatedBy
      }
    });
  },

  // Search banks by name
  searchBanks(searchTerm) {
    check(searchTerm, String);
    const regex = new RegExp(searchTerm.trim(), 'i');
    return BanksCollection.find({
      name: { $regex: regex },
      isActive: true
    }, { sort: { name: 1 } });
  },

  // Validate country code
  isValidCountryCode(countryCode) {
    const validCodes = [
      'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT',
      'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI',
      'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY',
      'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
      'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
      'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK',
      'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL',
      'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
      'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR',
      'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
      'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS',
      'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
      'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW',
      'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP',
      'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
      'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
      'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM',
      'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF',
      'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW',
      'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
      'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
    ];
    return validCodes.includes(countryCode.toUpperCase());
  }
};