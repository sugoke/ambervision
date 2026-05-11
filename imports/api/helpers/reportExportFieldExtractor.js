const pickNumber = (value) => {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const TEMPLATE_EXTRACTORS = {
  phoenix_autocallable: (tr) => ({
    minGuaranteedPercent: null,
    capitalReturnPercent: pickNumber(tr?.indicativeMaturityValue?.capitalReturn),
    indicativeMaturityValuePercent: pickNumber(tr?.indicativeMaturityValue?.totalValue),
    totalCouponsEarnedPercent: pickNumber(tr?.observationAnalysis?.totalCouponsEarned)
  }),
  orion_memory: (tr) => ({
    minGuaranteedPercent: pickNumber(
      tr?.indicativeMaturityValue?.capitalGuaranteed ?? tr?.orionStructure?.capitalGuaranteed
    ),
    capitalReturnPercent: pickNumber(tr?.indicativeMaturityValue?.capitalReturn),
    indicativeMaturityValuePercent: pickNumber(tr?.indicativeMaturityValue?.totalValue),
    totalCouponsEarnedPercent: null
  }),
  himalaya: (tr) => ({
    minGuaranteedPercent: pickNumber(tr?.himalayaStructure?.floor),
    capitalReturnPercent: pickNumber(tr?.totalPayout),
    indicativeMaturityValuePercent: pickNumber(tr?.totalPayout),
    totalCouponsEarnedPercent: null
  }),
  shark_note: (tr) => ({
    minGuaranteedPercent: pickNumber(tr?.sharkStructure?.floorLevel),
    capitalReturnPercent: null,
    indicativeMaturityValuePercent: pickNumber(tr?.redemption?.value),
    totalCouponsEarnedPercent: pickNumber(tr?.sharkStructure?.rebateValue)
  }),
  participation_note: (tr) => ({
    minGuaranteedPercent: pickNumber(tr?.redemption?.protectionLevel),
    capitalReturnPercent: null,
    indicativeMaturityValuePercent: pickNumber(tr?.indicativeMaturityValue?.totalValue),
    totalCouponsEarnedPercent: pickNumber(tr?.redemption?.coupon)
  }),
  reverse_convertible: (tr) => ({
    minGuaranteedPercent: null,
    capitalReturnPercent: pickNumber(tr?.redemption?.capitalComponent),
    indicativeMaturityValuePercent: pickNumber(tr?.redemption?.totalValue),
    totalCouponsEarnedPercent: pickNumber(tr?.redemption?.coupon)
  }),
  reverse_convertible_bond: (tr) => ({
    minGuaranteedPercent: null,
    capitalReturnPercent: pickNumber(tr?.redemption?.capitalComponent),
    indicativeMaturityValuePercent: pickNumber(tr?.redemption?.totalValue),
    totalCouponsEarnedPercent: pickNumber(tr?.redemption?.coupon)
  })
};

export const extractExportFields = (report) => {
  if (!report) return null;
  const templateId = report.templateId;
  const tr = report.templateResults || {};
  const extractor = TEMPLATE_EXTRACTORS[templateId];
  const fields = extractor
    ? extractor(tr)
    : {
        minGuaranteedPercent: null,
        capitalReturnPercent: null,
        indicativeMaturityValuePercent: null,
        totalCouponsEarnedPercent: null
      };

  return {
    templateId: templateId || null,
    productStatus: tr?.currentStatus?.productStatus || null,
    ...fields
  };
};
