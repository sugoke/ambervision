import { Products } from '/imports/api/products/products.js';
import { Historical } from '/imports/api/products/products.js';

const DATE_CACHE = new Map();

export function processPhoenixProduct(product) {
  console.log('========= Starting Phoenix Product Processing =========');
  console.log('Product ISIN:', product.genericData.ISINCode);
  
  const result = {
    ISINCode: product.genericData.ISINCode,
    name: product.genericData.name,
    observations: [],
    autocalled: false,
    autocallDate: null,
    capitalRedemption: null
  };

  const currentDate = normalizeDateToMidnight(new Date());

  let missedCoupons = 0;
  let underlyingsAboveAutocall = new Set();
  let autocalled = false;
  let autocallDate = null;
  let productStatus = product.status || 'ongoing';
  let totalCouponPaid = 0;

  const normalizedObservations = product.observationDates.map(obs => ({
    ...obs,
    normalizedDate: parseAndNormalizeDate(obs.observationDate)
  }));
  
  console.log('First observation date details:', {
    original: normalizedObservations[0].observationDate,
    normalized: formatDate(normalizedObservations[0].normalizedDate),
    couponBarrier: normalizedObservations[0].couponBarrierLevel,
    autocallLevel: normalizedObservations[0].autocallLevel
  });

  // Process first observation
  const firstObs = normalizedObservations[0];
  const firstObsDate = firstObs.normalizedDate;
  
  console.log('Current date vs first observation:', {
    currentDate: formatDate(currentDate),
    firstObsDate: formatDate(firstObsDate),
    isPast: firstObsDate <= currentDate
  });

  if (firstObsDate <= currentDate) {
    console.log('Processing first observation date performance');
    const observationPerformances = calculateUnderlyingPerformancesAtDate(product, firstObsDate);
    console.log('Underlying performances:', observationPerformances);

    const worstPerforming = findWorstPerforming(observationPerformances);
    console.log('Worst performing:', {
      ticker: worstPerforming.ticker,
      performance: worstPerforming.performance
    });

    const aboveCouponBarrier = worstPerforming.performance >= (firstObs.couponBarrierLevel - 100);
    console.log('Coupon barrier check:', {
      performance: worstPerforming.performance,
      barrier: firstObs.couponBarrierLevel - 100,
      above: aboveCouponBarrier
    });

    if (aboveCouponBarrier) {
      const couponAmount = product.features.couponPerPeriod * (1 + missedCoupons);
      console.log('Coupon payment:', {
        base: product.features.couponPerPeriod,
        missed: missedCoupons,
        total: couponAmount
      });
    }

    if (firstObs.autocallLevel) {
      console.log('Autocall check:', {
        performance: worstPerforming.performance,
        level: firstObs.autocallLevel - 100,
        isAutocalled: worstPerforming.performance >= (firstObs.autocallLevel - 100)
      });
    }
  }

  // Calculate adjusted initial reference levels first
  const underlyingsWithAdjusted = product.underlyings.map(underlying => {
    const historicalData = Historical.findOne({ eodTicker: underlying.eodTicker });
    let adjustedInitialRef = underlying.initialReferenceLevel;

    if (historicalData?.data?.length) {
      const tradeDate = parseAndNormalizeDate(product.genericData.tradeDate);
      const initialData = historicalData.data.find(d => 
        parseAndNormalizeDate(d.date).getTime() === tradeDate.getTime()
      );

      if (initialData?.adjusted_close) {
        console.log('Found initial data for', underlying.ticker, {
          date: product.genericData.tradeDate,
          close: initialData.close,
          adjusted_close: initialData.adjusted_close,
          initialRef: underlying.initialReferenceLevel
        });

        // If initial reference matches close price, use adjusted_close as adjusted reference
        if (Math.abs(underlying.initialReferenceLevel - initialData.close) < 0.01) {
          adjustedInitialRef = initialData.adjusted_close;
        } else {
          // Otherwise calculate adjustment factor
          const adjustmentFactor = initialData.adjusted_close / initialData.close;
          adjustedInitialRef = underlying.initialReferenceLevel * adjustmentFactor;
        }

        console.log('Calculated adjusted reference for', underlying.ticker, {
          original: underlying.initialReferenceLevel,
          adjusted: adjustedInitialRef
        });
      }
    }

    return {
      ...underlying,
      adjustedInitialReferenceLevel: adjustedInitialRef
    };
  });

  // Update product with adjusted values
  Products.update(product._id, {
    $set: {
      underlyings: underlyingsWithAdjusted
    }
  });

  // Continue with the rest of the processing using the updated underlyings
  product.underlyings = underlyingsWithAdjusted;

  for (let observation of normalizedObservations) {
    const observationDate = observation.normalizedDate;

    const observationResult = {
      observationDate: observation.observationDate,
      paymentDate: observation.paymentDate,
      couponBarrierLevel: observation.couponBarrierLevel,
      autocallLevel: observation.autocallLevel || 'N/A',
      worstPerformingUnderlying: '-',
      worstPerformance: '-',
      aboveCouponBarrier: null,
      couponPaid: '-',
      autocalled: '-',
      underlyingsAboveAutocall: [],
      newlyLockedStocks: []
    };

    if (product.features.memoryAutocall) {
      observationResult.allLockedStocks = [];
    }

    if (observationDate <= currentDate) {
      const observationPerformances = calculateUnderlyingPerformancesAtDate(product, observationDate);
      const worstPerforming = findWorstPerforming(observationPerformances);

      observationResult.worstPerformingUnderlying = worstPerforming.ticker;
      observationResult.worstPerformance = worstPerforming.performance !== null ? 
        Number(worstPerforming.performance.toFixed(2)) : null;
      observationResult.aboveCouponBarrier = worstPerforming.performance >= 
        (observation.couponBarrierLevel - 100);

      if (observationResult.aboveCouponBarrier) {
        observationResult.couponPaid = product.features.couponPerPeriod * (1 + missedCoupons);
        totalCouponPaid += observationResult.couponPaid;
        missedCoupons = 0;
      } else {
        observationResult.couponPaid = 0;
        if (product.features.memoryCoupon) {
          missedCoupons++;
        }
      }

      if (product.features.memoryAutocall) {
        if (observation.autocallLevel) {
          const previouslyLockedStocks = new Set(underlyingsAboveAutocall);
          console.log('Memory Autocall - Previous locked stocks:', Array.from(previouslyLockedStocks));

          observationPerformances.forEach(perf => {
            if (perf.performance >= (observation.autocallLevel - 100)) {
              underlyingsAboveAutocall.add(perf.ticker);
              console.log(`Memory Autocall - Adding ${perf.ticker} to locked stocks:`, {
                performance: perf.performance,
                autocallLevel: observation.autocallLevel - 100
              });
            }
          });

          observationResult.underlyingsAboveAutocall = Array.from(underlyingsAboveAutocall);
          observationResult.newlyLockedStocks = observationResult.underlyingsAboveAutocall
            .filter(stock => !previouslyLockedStocks.has(stock));

          console.log('Memory Autocall - Results:', {
            allLocked: Array.from(underlyingsAboveAutocall),
            newlyLocked: observationResult.newlyLockedStocks
          });

          if (product.features.memoryAutocall) {
            observationResult.allLockedStocks = Array.from(underlyingsAboveAutocall);
          }

          observationResult.autocalled = underlyingsAboveAutocall.size === product.underlyings.length;
        } else {
          observationResult.autocalled = false;
        }
      } else {
        observationResult.autocalled = observation.autocallLevel ? 
          worstPerforming.performance >= (observation.autocallLevel - 100) : false;
      }

      if (observationResult.autocalled) {
        autocalled = true;
        autocallDate = observation.observationDate;
        productStatus = 'autocalled';
        result.observations.push(observationResult);
        break;
      }
    }

    result.observations.push(observationResult);
  }

  result.autocalled = autocalled;
  result.autocallDate = autocallDate;

  let lastPriceDate;
  if (autocalled && autocallDate) {
    lastPriceDate = parseAndNormalizeDate(autocallDate);
    productStatus = 'autocalled';
  } else {
    lastPriceDate = currentDate;
    const maturityDate = parseAndNormalizeDate(product.genericData.finalObservation);
    productStatus = lastPriceDate >= maturityDate ? 'matured' : 'live';
  }

  const performanceData = calculateUnderlyingPerformances(product, lastPriceDate);
  const redemptionIfToday = calculateRedemptionIfToday(product, performanceData.performances);

  const { updatedUnderlyings, chart100 } = updateUnderlyingsWithPerformance(
    product.underlyings, 
    performanceData
  );

  const finalObservationDate = parseAndNormalizeDate(product.genericData.finalObservation);
  
  if (currentDate >= finalObservationDate && !autocalled) {
    const finalRedemption = calculateFinalRedemption(product, finalObservationDate);
    result.capitalRedemption = finalRedemption;
    productStatus = 'matured';
  }

  // Calculate P&L if product is matured or autocalled
  let pnl = null;
  if (productStatus === 'matured' || productStatus === 'autocalled') {
    pnl = result.capitalRedemption - 100 + totalCouponPaid;
    console.log('Final P&L calculation:', {
      totalCouponPaid,
      capitalRedemption: result.capitalRedemption,
      formula: `${result.capitalRedemption} - 100 + ${totalCouponPaid}`,
      pnl
    });
  }

  Products.update(product._id, {
    $set: {
      underlyings: updatedUnderlyings,
      chart100: chart100,
      redemptionIfToday: redemptionIfToday,
      capitalRedemption: result.capitalRedemption,
      status: productStatus,
      pnl: pnl,
      chartOptions: {
        autocallLevel: {
          borderColor: 'rgba(255, 215, 0, 0.7)',
          backgroundColor: 'rgba(255, 215, 0, 0.1)',
          borderWidth: 2,
          fill: true
        }
      }
    }
  });

  updateProductWithObservationsTable(product._id, result, totalCouponPaid, productStatus);

  return result;
}

function calculateUnderlyingPerformances(product, lastPriceDate) {
  const tradeDate = parseAndNormalizeDate(product.genericData.tradeDate);
  const finalObservation = parseAndNormalizeDate(product.genericData.finalObservation);
  const currentDate = normalizeDateToMidnight(new Date());
  
  console.log('Building chart data from', {
    tradeDate: formatDate(tradeDate),
    finalObservation: formatDate(finalObservation),
    currentDate: formatDate(currentDate)
  });

  // Initialize chart data structure with array for values instead of object
  const dateMap = new Map();
  let iterDate = new Date(tradeDate);
  while (iterDate <= finalObservation) {
    const dateStr = formatDate(iterDate);
    dateMap.set(dateStr, {
      date: dateStr,
      couponBarrier: product.features.couponBarrier,
      autocallLevel: null,
      values: [] // Array instead of object
    });
    iterDate.setDate(iterDate.getDate() + 1);
  }

  // First, create a map of observation dates to their autocall levels
  const observationLevels = new Map();
  product.observationDates.forEach(obs => {
    if (obs.autocallLevel) {
      const obsDate = formatDate(parseAndNormalizeDate(obs.observationDate));
      observationLevels.set(obsDate, obs.autocallLevel);
    }
  });

  // Process each underlying's historical data
  product.underlyings.forEach(underlying => {
    const historicalData = Historical.findOne({ eodTicker: underlying.eodTicker });
    if (!historicalData?.data?.length) {
      console.warn(`No historical data for ${underlying.ticker}`);
      return;
    }

    // Get all price data within date range
    const priceData = historicalData.data
      .map(d => ({
        ...d,
        date: parseAndNormalizeDate(d.date)
      }))
      .filter(d => d.date >= tradeDate && d.date <= finalObservation)
      .sort((a, b) => a.date - b.date);

    // Process each price point and interpolate missing dates
    let prevData = null;
    for (const [dateStr, dayData] of dateMap) {
      const date = parseAndNormalizeDate(dateStr);
      
      if (date > currentDate) {
        dayData.values.push({
          underlying: underlying.ticker,
          value: null
        });
        continue;
      }
      
      // Find exact price data or closest previous/next data points
      const exactData = priceData.find(p => formatDate(p.date) === dateStr);
      const nextData = !exactData ? priceData.find(p => p.date > date) : null;
      
      // Calculate performance as before
      let performance;
      if (exactData) {
        performance = (exactData.adjusted_close / underlying.adjustedInitialReferenceLevel) * 100;
        prevData = exactData;
      } else if (prevData && nextData) {
        // Linear interpolation between prev and next data points
        const totalDays = (nextData.date - prevData.date) / (1000 * 60 * 60 * 24);
        const daysSincePrev = (date - prevData.date) / (1000 * 60 * 60 * 24);
        const prevPerf = (prevData.adjusted_close / underlying.adjustedInitialReferenceLevel) * 100;
        const nextPerf = (nextData.adjusted_close / underlying.adjustedInitialReferenceLevel) * 100;
        performance = prevPerf + (nextPerf - prevPerf) * (daysSincePrev / totalDays);
      } else if (prevData) {
        performance = (prevData.adjusted_close / underlying.adjustedInitialReferenceLevel) * 100;
      } else {
        performance = 100;
      }

      // Store performance in array format
      dayData.values.push({
        underlying: underlying.ticker,
        value: performance
      });

      // Set autocall level for all dates (including future)
      if (observationLevels.has(dateStr)) {
        dayData.autocallLevel = observationLevels.get(dateStr);
      } else {
        // Find the most recent observation date
        const prevObsDate = Array.from(observationLevels.entries())
          .filter(([obsDate]) => parseAndNormalizeDate(obsDate) <= date)
          .sort((a, b) => parseAndNormalizeDate(b[0]) - parseAndNormalizeDate(a[0]))[0];
        
        if (prevObsDate) {
          dayData.autocallLevel = prevObsDate[1];
        }
      }
    }
  });

  // Calculate worst performing
  const chart100 = Array.from(dateMap.values()).map(dayData => {
    const date = parseAndNormalizeDate(dayData.date);
    
    if (date > currentDate || dayData.values.every(v => v.value === null)) {
      return {
        ...dayData,
        values: [
          ...dayData.values,
          { underlying: 'worstOf', value: null }
        ]
      };
    }
    
    const validValues = dayData.values
      .map(v => v.value)
      .filter(v => v !== null && !isNaN(v));
      
    const worstOf = validValues.length > 0 ? Math.min(...validValues) : null;
    
    return {
      ...dayData,
      values: [
        ...dayData.values,
        { underlying: 'worstOf', value: worstOf }
      ]
    };
  });

  console.log('Chart data sample:', {
    firstDay: chart100[0],
    lastDay: chart100[chart100.length - 1],
    totalDays: chart100.length,
    hasAutocallLevel: chart100.some(day => day.autocallLevel !== null),
    currentDate: formatDate(currentDate)
  });

  return {
    performances: calculatePerformances(product, lastPriceDate),
    chart100
  };
}

function updateUnderlyingsWithPerformance(underlyings, performanceData) {
  const { performances, chart100 } = performanceData;

  const worstPerforming = performances.reduce((worst, current) => {
    if (current.performance === null) {
      return worst;
    }
    if (!worst || worst.performance === null || current.performance < worst.performance) {
      return current;
    }
    return worst;
  }, null);

  const updatedUnderlyings = underlyings.map(underlying => {
    const performance = performances.find(p => p.eodTicker === underlying.eodTicker);
    if (performance) {
      underlying.lastPriceInfo = {
        price: performance.lastPrice,
        performance: performance.performance,
        distanceToBarrier: performance.distanceToBarrier,
        date: parseAndNormalizeDate(performance.lastPriceDate),
        isWorstOf: worstPerforming && performance.eodTicker === worstPerforming.eodTicker
      };
    } else {
      console.error(`No performance data found for ${underlying.ticker}`);
    }
    return underlying;
  });

  if (chart100 && chart100.length > 0) {
    chart100.forEach(point => {
      if (point.values) {
        // Only calculate worstOf for points where we have numeric values
        const underlyingValues = point.values
          .filter(v => typeof v.value === 'number' && v.value !== null);

        // If no valid values found, keep the existing worstOf value
        if (underlyingValues.length === 0) {
          return;
        }

        // Find and update worstOf entry
        const worstOfIndex = point.values.findIndex(v => v.underlying === 'worstOf');
        const worstOfValue = Math.min(...underlyingValues.map(v => v.value));
        
        if (worstOfIndex >= 0) {
          point.values[worstOfIndex].value = worstOfValue;
        } else {
          point.values.push({ underlying: 'worstOf', value: worstOfValue });
        }
      }
    });
  }

  return { updatedUnderlyings, chart100 };
}

function calculateUnderlyingPerformancesAtDate(product, observationDate) {
  if (!(observationDate instanceof Date)) {
    observationDate = parseAndNormalizeDate(observationDate);
  } else {
    observationDate = normalizeDateToMidnight(observationDate);
  }

  return product.underlyings.map(underlying => {
    console.log('\nCalculating performance for:', underlying.ticker);
    
    const historicalData = Historical.findOne({ eodTicker: underlying.eodTicker });
    if (!historicalData?.data?.length) {
      console.log('No historical data found');
      return { ticker: underlying.ticker, eodTicker: underlying.eodTicker, performance: null };
    }

    // First, get the adjustment factor from trade date
    const tradeDate = parseAndNormalizeDate(product.genericData.tradeDate);
    const initialPriceData = historicalData.data
      .find(d => parseAndNormalizeDate(d.date).getTime() === tradeDate.getTime());

    console.log('Initial price data:', {
      date: product.genericData.tradeDate,
      close: initialPriceData?.close,
      adjusted_close: initialPriceData?.adjusted_close,
      initialRef: underlying.initialReferenceLevel
    });

    // Calculate adjustment factor based on initial reference and adjusted price
    const adjustmentFactor = initialPriceData?.adjusted_close / initialPriceData?.close || 1;
    const adjustedInitialRef = underlying.initialReferenceLevel * adjustmentFactor;

    console.log('Adjustment calculation:', {
      factor: adjustmentFactor,
      adjustedInitialRef: adjustedInitialRef
    });

    // Get price at observation date
    const sortedData = historicalData.data
      .map(d => ({
        ...d,
        date: parseAndNormalizeDate(d.date)
      }))
      .sort((a, b) => b.date - a.date);

    const priceAtObservation = sortedData.find(d => d.date <= observationDate);
    if (!priceAtObservation) {
      console.log('No price found at observation date');
      return { ticker: underlying.ticker, eodTicker: underlying.eodTicker, performance: null };
    }

    console.log('Price at observation:', {
      date: formatDate(priceAtObservation.date),
      close: priceAtObservation.close,
      adjusted_close: priceAtObservation.adjusted_close
    });

    // Calculate performance using adjusted prices
    const performance = ((priceAtObservation.adjusted_close / adjustedInitialRef) - 1) * 100;
    
    console.log('Performance calculation:', {
      currentPrice: priceAtObservation.adjusted_close,
      adjustedInitialRef,
      ratio: priceAtObservation.adjusted_close / adjustedInitialRef,
      performance
    });

    return {
      ticker: underlying.ticker,
      eodTicker: underlying.eodTicker,
      performance
    };
  });
}

function findWorstPerforming(performances) {
  const worst = performances.reduce((worst, current) => {
    if (!current || current.performance === null) return worst;
    if (!worst || current.performance < worst.performance) return current;
    return worst;
  }, null);

  return worst;
}

function updateProductWithObservationsTable(productId, result, totalCouponPaid, status) {
  const updateObject = {
    observationsTable: result.observations.map(obs => {
      const cleanedObs = { ...obs };
      if (!cleanedObs.allLockedStocks) {
        delete cleanedObs.allLockedStocks;
      }
      return cleanedObs;
    }),
    autocalled: result.autocalled,
    autocallDate: result.autocallDate,
    underlyings: result.underlyings,
    totalCouponPaid: totalCouponPaid,
    status: status,
    chart100: result.chart100
  };

  Products.update(productId, { $set: updateObject });
}

function parseAndNormalizeDate(dateString) {
  if (DATE_CACHE.has(dateString)) {
    return DATE_CACHE.get(dateString);
  }
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  DATE_CACHE.set(dateString, date);
  return date;
}

function normalizeDateToMidnight(date) {
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (DATE_CACHE.has(key)) {
    return DATE_CACHE.get(key);
  }
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  DATE_CACHE.set(key, normalized);
  return normalized;
}

function formatDate(date) {
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (DATE_CACHE.has(key + '_formatted')) {
    return DATE_CACHE.get(key + '_formatted');
  }
  const formatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  DATE_CACHE.set(key + '_formatted', formatted);
  return formatted;
}

function calculateRedemptionIfToday(product, currentPerformances) {
  if (!product || !currentPerformances || !currentPerformances.length) {
    return null;
  }

  const worstPerforming = currentPerformances.reduce((worst, current) => {
    if (!current || current.performance === null) return worst;
    if (!worst || current.performance < worst.performance) return current;
    return worst;
  }, null);

  if (!worstPerforming) {
    return null;
  }

  const hasOneStar = product.features.oneStar;
  const isLowStrike = product.features.lowStrike;
  const protectionBarrier = product.features.capitalProtectionBarrier;

  // Check One Star condition first
  if (hasOneStar) {
    const anyPositive = currentPerformances.some(perf => perf.performance >= 0);
    if (anyPositive) {
      return 100;
    }
  }

  // Check protection barrier
  if (worstPerforming.performance >= (protectionBarrier - 100)) {
    return 100;
  }

  // Apply low strike if applicable
  if (isLowStrike) {
    const leverage = 1 / (protectionBarrier / 100);
    const loss = (worstPerforming.performance - (protectionBarrier - 100)) * leverage;
    return 100 + loss;
  }

  // Standard redemption calculation
  return 100 + worstPerforming.performance;
}

function calculateFinalRedemption(product, observationDate) {
  const performances = calculateUnderlyingPerformancesAtDate(product, observationDate);
  const worstPerforming = findWorstPerforming(performances);
  const hasOneStar = product.features.oneStar;
  const isLowStrike = product.features.lowStrike;
  const protectionBarrier = product.features.capitalProtectionBarrier;
  
  if (hasOneStar) {
    const anyPositive = performances.some(perf => perf.performance >= 0);
    if (anyPositive) {
      return 100;
    }
  }
  
  if (worstPerforming.performance >= (protectionBarrier - 100)) {
    return 100;
  }
  
  if (isLowStrike) {
    const leverage = 1 / (protectionBarrier / 100);
    const loss = (worstPerforming.performance - (protectionBarrier - 100)) * leverage;
    const redemption = 100 + loss;
    return redemption;
  } else {
    const redemption = 100 + worstPerforming.performance;
    return redemption;
  }
}

function calculatePerformances(product, lastPriceDate) {
  const capitalProtectionBarrier = product.features.capitalProtectionBarrier;

  return product.underlyings.map(underlying => {
    const historicalData = Historical.findOne({ eodTicker: underlying.eodTicker });
    if (!historicalData?.data?.length) return {
      ticker: underlying.ticker,
      eodTicker: underlying.eodTicker,
      performance: null,
      distanceToBarrier: null,
      lastPrice: null,
      lastPriceDate: null
    };

    // Get initial price data
    const tradeDate = parseAndNormalizeDate(product.genericData.tradeDate);
    const initialData = historicalData.data.find(d => 
      parseAndNormalizeDate(d.date).getTime() === tradeDate.getTime()
    );

    if (!initialData?.adjusted_close) return {
      ticker: underlying.ticker,
      eodTicker: underlying.eodTicker,
      performance: null,
      distanceToBarrier: null,
      lastPrice: null,
      lastPriceDate: null
    };

    // Get price at last price date
    const sortedData = historicalData.data
      .map(d => ({
        ...d,
        date: parseAndNormalizeDate(d.date)
      }))
      .sort((a, b) => b.date - a.date);

    const lastPriceInfo = sortedData.find(d => d.date <= lastPriceDate);
    if (!lastPriceInfo) return {
      ticker: underlying.ticker,
      eodTicker: underlying.eodTicker,
      performance: null,
      distanceToBarrier: null,
      lastPrice: null,
      lastPriceDate: null
    };

    // Calculate performance using adjusted prices
    const performance = ((lastPriceInfo.adjusted_close / underlying.adjustedInitialReferenceLevel) - 1) * 100;
    
    // Calculate distance to barrier
    const barrierPrice = (capitalProtectionBarrier / 100) * underlying.adjustedInitialReferenceLevel;
    const distanceToBarrier = ((lastPriceInfo.adjusted_close - barrierPrice) / lastPriceInfo.adjusted_close) * 100;

    return {
      ticker: underlying.ticker,
      eodTicker: underlying.eodTicker,
      performance,
      distanceToBarrier,
      lastPrice: lastPriceInfo.close,
      lastAdjustedPrice: lastPriceInfo.adjusted_close,
      lastPriceDate: formatDate(lastPriceInfo.date)
    };
  });
}

Meteor.methods({
  'products.insert'(productData) {
    check(productData, {
      ISINCode: String,
      underlyings: Array,
      genericData: Object,
      features: Object,
      observationDates: Array,
    });

    const requiredFields = ['ISINCode', 'underlyings', 'genericData', 'features', 'observationDates'];
    requiredFields.forEach(field => {
      if (!productData[field]) {
        throw new Meteor.Error('missing-field', `Missing required field: ${field}`);
      }
    });

    const processedUnderlyings = productData.underlyings.map(underlying => {
      const historicalData = Historical.findOne({ eodTicker: underlying.eodTicker });
      let adjustedInitialReferenceLevel = underlying.initialReferenceLevel;
      
      if (historicalData?.data?.length) {
        const tradeDate = parseAndNormalizeDate(productData.genericData.tradeDate);
        const initialData = historicalData.data.find(d => 
          parseAndNormalizeDate(d.date).getTime() === tradeDate.getTime()
        );
        
        if (initialData?.adjusted_close) {
          const adjustmentFactor = initialData.adjusted_close / initialData.close;
          adjustedInitialReferenceLevel = underlying.initialReferenceLevel * adjustmentFactor;
        }
      }

      return {
        ...underlying,
        initialReferenceLevel: underlying.initialReferenceLevel,
        adjustedInitialReferenceLevel,
        lastPriceInfo: {
          price: null,
          adjustedPrice: null,
          performance: null,
          distanceToBarrier: null,
          date: null,
          isWorstOf: false
        }
      };
    });

    const processedObservationDates = productData.observationDates.map(obs => ({
      observationDate: obs.observationDate,
      paymentDate: obs.paymentDate,
      couponBarrierLevel: obs.couponBarrierLevel,
      autocallLevel: obs.autocallLevel || null
    }));

    const product = {
      ISINCode: productData.genericData.ISINCode,
      underlyings: processedUnderlyings,
      genericData: productData.genericData,
      features: productData.features,
      observationDates: processedObservationDates,
      observationsTable: [],
      autocallDate: null,
      autocalled: false,
      chart100: [],
      totalCouponPaid: 0
    };

    const productId = Products.insert(product);

    Meteor.call('calculateProductPerformances', productId);

    return productId;
  },

  'calculateProductPerformances'(productId) {
    const product = Products.findOne(productId);
    if (!product) {
      throw new Meteor.Error('product-not-found', 'Product not found');
    }

    const result = processPhoenixProduct(product);

    Products.update(productId, {
      $set: {
        underlyings: product.underlyings,
        chart100: product.chart100,
        observationsTable: result.observations,
        autocalled: result.autocalled,
        autocallDate: result.autocallDate,
        totalCouponPaid: result.totalCouponPaid,
        status: product.status
      }
    });
  }
});

