export function calculateLowStrikeRedemption(context, product, observation, parameters) {
  console.log('calculateLowStrikeRedemption called with context:', JSON.stringify(context));
  console.log('Observation:', JSON.stringify(observation));
  console.log('Lifecycle parameters:', JSON.stringify(parameters));

  if (!context.capitalProtectionResult) {
    console.error('Error: Capital protection result is missing in context.');
    throw new Error('Capital protection result is missing in context.');
  }

  const isCapitalProtected = context.capitalProtectionResult.isCapitalProtected;
  const calculatedPerformance = context.capitalProtectionResult.performance;
  const capitalProtectionBarrier = context.capitalProtectionResult.capitalProtectionBarrier;

  let redemptionAmount;

  if (isCapitalProtected) {
    redemptionAmount = 100; // Capital is protected, return 100%
    console.log('Capital is protected. Redemption amount set to 100%.');
  } else {
    // Calculate the redemption amount when capital is not protected
    redemptionAmount = 100 - ((capitalProtectionBarrier - calculatedPerformance) * (100 / capitalProtectionBarrier));
    console.log(`Capital is not protected. Redemption amount calculated as: ${redemptionAmount.toFixed(2)}%.`);
  }

  // Update the context with the redemption amount
  context.lowStrikeRedemptionResult = {
    redemptionAmount: redemptionAmount.toFixed(2),
    isCapitalProtected: isCapitalProtected
  };

  return context;
}
