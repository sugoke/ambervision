export function compareToCapitalProtectionBarrier(context, product, observation, parameters) {
  console.log('compareToCapitalProtectionBarrier called with context:', JSON.stringify(context));
  console.log('Observation:', JSON.stringify(observation));
  console.log('Lifecycle parameters:', JSON.stringify(parameters));

  if (!context.identifiedUnderlying || context.identifiedUnderlying.performance === undefined) {
    console.error('Error: Missing or undefined performance in identifiedUnderlying');
    throw new Error('Missing or undefined performance in identifiedUnderlying');
  }

  const calculatedPerformance = context.identifiedUnderlying.performance;
  const capitalProtectionBarrier = parameters.capitalProtectionBarrier;

  let isCapitalProtected = false;

  if (calculatedPerformance >= capitalProtectionBarrier) {
    isCapitalProtected = true;
    console.log(`Capital is protected. Performance: ${calculatedPerformance} >= capital protection barrier: ${capitalProtectionBarrier}`);
  } else {
    console.log(`Capital is not protected. Performance: ${calculatedPerformance} < capital protection barrier: ${capitalProtectionBarrier}`);
  }

  // Update the context with the result
  context.capitalProtectionResult = {
    isCapitalProtected: isCapitalProtected,
    capitalProtectionBarrier: capitalProtectionBarrier,
    performance: calculatedPerformance
  };

  return context;
}
