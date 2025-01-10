import { Historical } from '/imports/api/products/products.js';

export async function identifyUnderlying(context, product, observation, parameters) {
  const underlyings = product.underlyings;
  const observationDate = observation.observationDate;
  const underlyingType = parameters.underlyingType;

  try {
    const performances = await Promise.all(underlyings.map(async (underlying) => {
      const historical = Historical.findOne({ ticker: underlying.ticker });
      if (!historical) throw new Error(`No historical data found for ticker ${underlying.ticker}`);
      const dataPoint = historical.data.find(point => point.date === observationDate);
      if (!dataPoint) throw new Error(`No data found for ticker ${underlying.ticker} on date ${observationDate}`);
      const performance = (dataPoint.closingPrice / underlying.initialReferenceLevel) * 100;
      return {
        name: underlying.name,
        performance: parseFloat(performance.toFixed(2))
      };
    }));

    let relevantPerformance;

    if (underlyingType === 'worstOf') {
      relevantPerformance = performances.reduce((worst, current) => 
        current.performance < worst.performance ? current : worst
      );
    } else if (underlyingType === 'bestOf') {
      relevantPerformance = performances.reduce((best, current) => 
        current.performance > best.performance ? current : best
      );
    } else if (underlyingType === 'averageOf') {
      const averagePerformance = performances.reduce((sum, current) => 
        sum + current.performance, 0) / performances.length;

      relevantPerformance = {
        name: 'Average of Basket',
        performance: parseFloat(averagePerformance.toFixed(2))
      };
    } else {
      throw new Error(`Unsupported underlyingType: ${underlyingType}`);
    }

    context.identifiedUnderlying = relevantPerformance;
    console.log(`identifyUnderlying set context.identifiedUnderlying: ${JSON.stringify(context.identifiedUnderlying)}`);
    return context;

  } catch (error) {
    console.error('Error in identifyUnderlying:', error);
    throw error;
  }
}
