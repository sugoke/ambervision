import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check, Match } from 'meteor/check';
import { Random } from 'meteor/random';
import { ASSET_TYPES, OrderFormatters } from './orders';

// Banks collection for managing bank information
export const BanksCollection = new Mongo.Collection('banks');

// Bank schema structure:
// {
//   name: String (e.g., "UBS", "Credit Suisse", "Deutsche Bank"),
//   city: String,
//   country: String,
//   countryCode: String (ISO 3166-1 alpha-2, e.g., "CH", "DE", "US"),
//   deskEmail: String (optional - DEFAULT order desk; fallback for any asset type
//                      not claimed by a desk below),
//   ccEmails: [String] (optional - bank-wide copies, always added to order emails),
//   desks: [{                     (optional - order intake split by asset class,
//     key: String,                 e.g. CFM: securities -> trading desk, FX -> FX
//     label: String,               team, funds -> funds team)
//     email: String,
//     ccEmails: [String],
//     assetTypes: [String]         subset of ASSET_TYPES; each asset type belongs
//   }],                            to at most one desk
//   isActive: Boolean,
//   createdAt: Date,
//   updatedAt: Date,
//   createdBy: String (userId of admin who created it)
// }

const DEFAULT_DESK_LABEL = 'Trading Desk';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (value) => typeof value === 'string' && EMAIL_PATTERN.test(value);

const normalizeEmailList = (list) => {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map(e => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    .filter(e => e && !seen.has(e) && seen.add(e));
};

/**
 * Validate and normalise the per-asset-class desks an admin saved on a bank.
 *
 * Rows left completely blank (an untouched "Add desk" row) are dropped. Any
 * other row must carry a label, a valid email and at least one asset type,
 * and an asset type may belong to one desk only — otherwise the routing would
 * be ambiguous. Throws Meteor.Error so the admin UI can show the reason.
 */
export function sanitizeDesks(desks) {
  check(desks, [Object]);
  const validAssetTypes = new Set(Object.values(ASSET_TYPES));
  const claimedBy = new Map(); // assetType -> desk label
  const result = [];

  desks.forEach((row, index) => {
    check(row, Match.ObjectIncluding({
      key: Match.Maybe(String),
      label: Match.Maybe(String),
      email: Match.Maybe(String),
      ccEmails: Match.Maybe([String]),
      assetTypes: Match.Maybe([String])
    }));

    const label = (row.label || '').trim();
    const email = (row.email || '').trim().toLowerCase();
    const ccEmails = normalizeEmailList(row.ccEmails);
    const assetTypes = [...new Set((row.assetTypes || []).filter(t => validAssetTypes.has(t)))];

    if (!label && !email && assetTypes.length === 0) return; // blank placeholder row

    const where = label || `desk #${index + 1}`;
    if (!label) throw new Meteor.Error('invalid-desk', `Desk #${index + 1} needs a name`);
    if (!isValidEmail(email)) throw new Meteor.Error('invalid-desk', `"${where}" needs a valid email address`);
    const badCc = ccEmails.find(e => !isValidEmail(e));
    if (badCc) throw new Meteor.Error('invalid-desk', `"${where}" has an invalid CC address: ${badCc}`);
    if (assetTypes.length === 0) {
      throw new Meteor.Error('invalid-desk', `"${where}" must handle at least one asset type`);
    }
    assetTypes.forEach(type => {
      if (claimedBy.has(type)) {
        throw new Meteor.Error(
          'duplicate-asset-type',
          `Asset type "${OrderFormatters.getAssetTypeLabel(type)}" is mapped to both "${claimedBy.get(type)}" and "${where}"`
        );
      }
      claimedBy.set(type, label);
    });

    result.push({
      key: row.key || Random.id(8),
      label,
      email,
      ccEmails: ccEmails.filter(e => e !== email),
      assetTypes
    });
  });

  return result;
}

// Helper functions for bank management
export const BankHelpers = {
  /**
   * Who receives an order email for this bank, given the order's asset type.
   *
   * The desk whose assetTypes include the order's type wins; anything not
   * claimed by a desk (or a bank with no desks at all) falls back to the
   * bank-wide deskEmail, so banks that never configured desks behave as
   * before. Bank-wide ccEmails are always copied; the matched desk's own
   * ccEmails are added on top. A desk row without an email is ignored so a
   * half-filled configuration can never swallow orders into an empty "To".
   *
   * Pure — safe to call from client code for display.
   *
   * @returns {{ to: string, cc: string[], deskLabel: string, matched: boolean }}
   */
  resolveOrderRecipients(bank, assetType) {
    const desk = (bank?.desks || []).find(d =>
      d?.email && Array.isArray(d.assetTypes) && assetType && d.assetTypes.includes(assetType)
    );
    const to = (desk?.email || bank?.deskEmail || '').toLowerCase();
    const cc = normalizeEmailList([...(bank?.ccEmails || []), ...(desk?.ccEmails || [])])
      .filter(e => e !== to);
    return {
      to,
      cc,
      deskLabel: desk?.label || DEFAULT_DESK_LABEL,
      matched: !!desk
    };
  },

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
  async addBank(name, city, country, countryCode, createdBy, deskEmail = null) {
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

    const bankData = {
      name: name.trim(),
      city: city.trim(),
      country: country.trim(),
      countryCode: countryCode.toUpperCase(),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy
    };

    // Add deskEmail if provided
    if (deskEmail && deskEmail.trim()) {
      bankData.deskEmail = deskEmail.trim().toLowerCase();
    }

    const bankId = await BanksCollection.insertAsync(bankData);

    return bankId;
  },

  // Update bank information
  async updateBank(bankId, updates, updatedBy) {
    check(bankId, String);
    check(updates, Object);
    check(updatedBy, String);

    const allowedFields = ['name', 'city', 'country', 'countryCode', 'deskEmail', 'ccEmails', 'desks'];
    const filteredUpdates = {};

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        if (field === 'countryCode') {
          filteredUpdates[field] = updates[field].toUpperCase();
        } else if (field === 'deskEmail') {
          filteredUpdates[field] = updates[field] ? updates[field].trim().toLowerCase() : null;
        } else if (field === 'ccEmails') {
          filteredUpdates[field] = Array.isArray(updates[field])
            ? updates[field].map(e => e.trim().toLowerCase()).filter(e => e)
            : [];
        } else if (field === 'desks') {
          filteredUpdates[field] = sanitizeDesks(Array.isArray(updates[field]) ? updates[field] : []);
        } else {
          filteredUpdates[field] = updates[field].trim();
        }
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