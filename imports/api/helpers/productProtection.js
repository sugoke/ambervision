/**
 * Capital protection derived from an Ambervision product record.
 *
 * Mirrors the protection-type classification used by securitiesMethods
 * (securities.classifyFromProduct) so the order desk and the securities
 * catalogue agree on what "capital protected" means: the note's issuer
 * guarantees 100% of the nominal at maturity, whatever the underlyings do.
 * Conditional (barrier) protection does not count.
 */

const PROTECTION_TYPES = {
  GUARANTEED_100: 'capital_guaranteed_100',
  GUARANTEED_PARTIAL: 'capital_guaranteed_partial',
  CONDITIONAL: 'capital_protected_conditional',
  OTHER: 'other_protection'
};

/**
 * @param {Object} product - products document (needs templateId and the
 *   structure/structureParams/structureParameters fields)
 * @returns {string|null} one of PROTECTION_TYPES, or null when the product
 *   carries nothing to classify from
 */
export function getProductProtectionType(product) {
  if (!product) return null;

  const templateType = (product.templateId || '').toLowerCase();
  const structureParams = product.structureParams || product.structureParameters || {};
  const structure = product.structure || {};

  if (templateType.includes('orion')) {
    const guaranteed = structureParams.capitalGuaranteed ?? structure.capitalGuaranteed ?? 100;
    if (guaranteed >= 100) return PROTECTION_TYPES.GUARANTEED_100;
    if (guaranteed > 0) return PROTECTION_TYPES.GUARANTEED_PARTIAL;
    return PROTECTION_TYPES.CONDITIONAL;
  }

  if (templateType.includes('phoenix') || templateType.includes('autocall')) {
    return PROTECTION_TYPES.CONDITIONAL;
  }

  if (templateType.includes('himalaya')) {
    const floor = structureParams.floor ?? structureParams.floorLevel ?? structure.floor ?? 100;
    if (floor >= 100) return PROTECTION_TYPES.GUARANTEED_100;
    if (floor > 0) return PROTECTION_TYPES.CONDITIONAL;
    return PROTECTION_TYPES.OTHER;
  }

  if (templateType.includes('participation')) {
    const guarantee = structureParams.capitalGuarantee ??
      structureParams.protectionBarrier ??
      structureParams.capitalProtection ??
      structure.capitalProtection ?? 0;
    if (guarantee >= 100) return PROTECTION_TYPES.GUARANTEED_100;
    if (guarantee > 0) return PROTECTION_TYPES.CONDITIONAL;
    return PROTECTION_TYPES.OTHER;
  }

  if (templateType.includes('reverse') || templateType.includes('shark')) {
    return PROTECTION_TYPES.CONDITIONAL;
  }

  if (!templateType && Object.keys(structureParams).length === 0 && Object.keys(structure).length === 0) {
    return null;
  }

  const generic = structureParams.capitalGuarantee ??
    structureParams.protectionBarrier ??
    structureParams.capitalProtection ?? 0;
  if (generic >= 100) return PROTECTION_TYPES.GUARANTEED_100;
  if (generic > 0) return PROTECTION_TYPES.CONDITIONAL;
  return PROTECTION_TYPES.CONDITIONAL;
}

/**
 * Whether an order in this product should be treated as capital protected
 * for profile allocation (counts as bonds). Returns null when the product
 * gives nothing to decide from, so callers can leave a user's choice alone.
 *
 * @param {Object} product
 * @returns {boolean|null}
 */
export function isProductCapitalProtected(product) {
  const type = getProductProtectionType(product);
  if (type === null) return null;
  return type === PROTECTION_TYPES.GUARANTEED_100;
}
