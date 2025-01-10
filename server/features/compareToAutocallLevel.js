export function compareToAutocallLevel(context, product, observation, parameters) {
  console.log('compareToAutocallLevel called with context:', JSON.stringify(context));
  console.log('Observation:', JSON.stringify(observation));
  console.log('Lifecycle parameters:', JSON.stringify(parameters));

  if (!context.identifiedUnderlying || context.identifiedUnderlying.performance === undefined) {
    console.error('Error: Missing or undefined performance in identifiedUnderlying');
    throw new Error('Missing or undefined performance in identifiedUnderlying');
  }

  const calculatedPerformance = context.identifiedUnderlying.performance;
  const autocallLevel = observation.autocallLevel;

  // If autocallLevel is not defined, it's not an autocallable date; skip this step
  if (autocallLevel === undefined) {
    console.log("No autocall level defined for this observation date. Skipping autocall check.");
    return context;
  }

  let isAutocalled = false;

  if (calculatedPerformance >= autocallLevel) {
    isAutocalled = true;
    console.log(`Product autocalled at performance: ${calculatedPerformance} >= autocall level: ${autocallLevel}`);
  } else {
    console.log(`Product not autocalled. Performance: ${calculatedPerformance} < autocall level: ${autocallLevel}`);
  }

  // Update the context with the result
  context.autocallResult = {
    isAutocalled: isAutocalled,
    autocallLevel: autocallLevel,
    performance: calculatedPerformance
  };

  return context;
}
