import { Products } from '/imports/api/products/products.js';
import { Historical } from '/imports/api/products/products.js';

export function processPhoenixProduct(product) {
  console.log(`Processing Phoenix product with ISIN: ${product.genericData.ISINCode}`);

  const result = {
    ISINCode: product.genericData.ISINCode,
    name: product.genericData.name,
    observations: [],
    autocalled: false,
    autocallDate: null,
    capitalRedemption: null
  };

  // Parse and normalize current date
  const currentDate = normalizeDateToMidnight(new Date());

  let missedCoupons = 0;
  let underlyingsAboveAutocall = new Set();
  let autocalled = false;
  let autocallDate = null;
  let productStatus = product.status || 'ongoing';
  let totalCouponPaid = 0;

  console.log(`Starting observation date loop for product ${product.genericData.ISINCode}`);
  for (let observation of product.observationDates) {
    // Parse and normalize observation date
    const observationDate = parseAndNormalizeDate(observation.observationDate);
    console.log(`Processing observation date: ${formatDate(observationDate)}`);

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

    // Only add allLockedStocks if memoryAutocall is true
    if (product.features.memoryAutocall) {
      observationResult.allLockedStocks = [];
    }

    if (observationDate <= currentDate) {
      console.log(`Observation date ${formatDate(observationDate)} is in the past or present`);
      const observationPerformances = calculateUnderlyingPerformancesAtDate(product, observationDate);
      console.log(`Calculated performances for observation date: ${JSON.stringify(observationPerformances)}`);

      const worstPerforming = findWorstPerforming(observationPerformances);
      console.log(`Worst performing underlying: ${worstPerforming.ticker} with performance ${worstPerforming.performance}`);

      observationResult.worstPerformingUnderlying = worstPerforming.ticker;
      observationResult.worstPerformance = worstPerforming.performance !== null ? Number(worstPerforming.performance.toFixed(2)) : null;
      observationResult.aboveCouponBarrier = worstPerforming.performance >= (observation.couponBarrierLevel - 100);

      console.log(`Above coupon barrier: ${observationResult.aboveCouponBarrier}`);

      if (observationResult.aboveCouponBarrier) {
        console.log(`Above coupon barrier. Paying coupon.`);
        observationResult.couponPaid = product.features.couponPerPeriod * (1 + missedCoupons);
        totalCouponPaid += observationResult.couponPaid;  // Add to total coupon paid
        console.log(`Total coupon paid: ${observationResult.couponPaid}`);
        console.log(`Cumulative total coupon paid: ${totalCouponPaid}`);
        missedCoupons = 0;
      } else {
        console.log(`Below coupon barrier. No coupon paid.`);
        observationResult.couponPaid = 0;
        if (product.features.memoryCoupon) {
          missedCoupons++;
          console.log(`Memory coupon feature active. Missed coupons: ${missedCoupons}`);
        }
      }

      if (product.features.memoryAutocall) {
        console.log(`Memory autocall feature active`);

        if (observation.autocallLevel) {
          const previouslyLockedStocks = new Set(underlyingsAboveAutocall);

          observationPerformances.forEach(perf => {
            console.log(`Checking ${perf.ticker}: Performance ${perf.performance}, Autocall Level ${observation.autocallLevel - 100}`);
            if (perf.performance >= (observation.autocallLevel - 100)) {
              underlyingsAboveAutocall.add(perf.ticker);
              console.log(`${perf.ticker} is above autocall level`);
            } else {
              console.log(`${perf.ticker} is below autocall level`);
            }
          });

          observationResult.underlyingsAboveAutocall = Array.from(underlyingsAboveAutocall);
          observationResult.newlyLockedStocks = observationResult.underlyingsAboveAutocall.filter(stock => !previouslyLockedStocks.has(stock));

          // Only set allLockedStocks if memoryAutocall is true
          if (product.features.memoryAutocall) {
            observationResult.allLockedStocks = Array.from(underlyingsAboveAutocall);
          }

          observationResult.autocalled = underlyingsAboveAutocall.size === product.underlyings.length;
        } else {
          console.log(`No autocall level for this observation date. Product cannot be autocalled.`);
          observationResult.autocalled = false;
        }

        console.log(`Newly locked stocks: ${JSON.stringify(observationResult.newlyLockedStocks)}`);
        console.log(`All locked stocks: ${JSON.stringify(observationResult.allLockedStocks)}`);
        console.log(`Autocalled: ${observationResult.autocalled}`);
      } else {
        observationResult.autocalled = observation.autocallLevel ? worstPerforming.performance >= (observation.autocallLevel - 100) : false;
      }

      if (observationResult.autocalled) {
        console.log(`Product autocalled on ${observation.observationDate}`);
        autocalled = true;
        autocallDate = observation.observationDate;
        productStatus = 'autocalled';
        result.observations.push(observationResult);
        break; // Exit the loop as the product has been autocalled
      }
    }

    result.observations.push(observationResult);
  }

  // Add these lines after the loop
  result.autocalled = autocalled;
  result.autocallDate = autocallDate;

  let lastPriceDate;
  if (autocalled && autocallDate) {
    lastPriceDate = parseAndNormalizeDate(autocallDate);
    console.log(`Product autocalled. Using autocall date as last price date: ${formatDate(lastPriceDate)}`);
    productStatus = 'autocalled';
  } else {
    lastPriceDate = currentDate;
    console.log(`Product ongoing. Using current date as last price date: ${formatDate(lastPriceDate)}`);

    const maturityDate = parseAndNormalizeDate(product.genericData.finalObservation);
    if (lastPriceDate >= maturityDate) {
      productStatus = 'matured';
      console.log(`Product has reached maturity date. Setting status to matured.`);
    } else {
      productStatus = 'live';
      console.log(`Product is still live. Setting status to live.`);
    }
  }

  console.log(`Calculating current performances for product ${product.genericData.ISINCode}`);
  const performanceData = calculateUnderlyingPerformances(product, lastPriceDate);

  // Add redemption calculation
  const redemptionIfToday = calculateRedemptionIfToday(product, performanceData.performances);
  console.log(`Theoretical redemption if today: ${redemptionIfToday}%`);

  console.log(`Updating underlyings with current performance for product ${product.genericData.ISINCode}`);
  const { updatedUnderlyings, chart100 } = updateUnderlyingsWithPerformance(product.underlyings, performanceData);

  // Check for final redemption before any database updates
  const finalObservationDate = parseAndNormalizeDate(product.genericData.finalObservation);
  
  if (currentDate >= finalObservationDate && !autocalled) {
    console.log('Product has reached final observation date');
    const finalRedemption = calculateFinalRedemption(product, finalObservationDate);
    result.capitalRedemption = finalRedemption;
    productStatus = 'matured';
  }

  // Now update product with all data including final redemption if applicable
  Products.update(product._id, {
    $set: {
      underlyings: updatedUnderlyings,
      chart100: chart100,
      redemptionIfToday: redemptionIfToday,
      capitalRedemption: result.capitalRedemption,
      status: productStatus,
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

  product.underlyings = updatedUnderlyings;
  product.chart100 = chart100;
  product.chartOptions = {
    autocallLevel: {
      borderColor: 'rgba(255, 215, 0, 0.7)',
      backgroundColor: 'rgba(255, 215, 0, 0.1)',
      borderWidth: 2,
      fill: true
    }
  };

  console.log(`Updating product ${product.genericData.ISINCode} with observations table, total coupon paid, and status: ${productStatus}`);
  updateProductWithObservationsTable(product._id, result, totalCouponPaid, productStatus);
  console.log(`Finished processing product ${product.genericData.ISINCode}`);

  return result;
}

function calculateUnderlyingPerformances(product, lastPriceDate) {
  console.log(`Calculating performances for product ${product.genericData.ISINCode}`);

  const tradeDate = parseAndNormalizeDate(product.genericData.tradeDate);
  const finalObservation = parseAndNormalizeDate(product.genericData.finalObservation);
  const capitalProtectionBarrier = product.features.capitalProtectionBarrier;

  console.log(`Trade Date: ${formatDate(tradeDate)}, Final Observation: ${formatDate(finalObservation)}`);

  if (isNaN(tradeDate.getTime()) || isNaN(finalObservation.getTime())) {
    console.error(`Invalid trade date or maturity date for product ${product.genericData.ISINCode}`);
    return { performances: [], chart100: [] };
  }

  const chart100Data = {};
  let currentCouponBarrier = product.features.couponBarrier;
  let currentAutocallLevel = null;
  let autocallDate = null;

  // Determine the autocall date if it exists
  for (const obs of product.observationDates) {
    if (obs.autocalled) {
      autocallDate = parseAndNormalizeDate(obs.observationDate);
      console.log(`Product autocalled on ${formatDate(autocallDate)}`);
      break;
    }
  }

  // Ensure today's data is included
  const today = normalizeDateToMidnight(new Date());

  const performances = product.underlyings.map(underlying => {
    console.log(`Processing underlying ${underlying.ticker}`);
    const historicalData = Historical.findOne({ eodTicker: underlying.eodTicker });

    if (!historicalData || historicalData.data.length === 0) {
      console.error(`No historical data found for ${underlying.ticker}`);
      return {
        ticker: underlying.ticker,
        eodTicker: underlying.eodTicker,
        performance: 0,
        distanceToBarrier: 0,
        lastPrice: null,
        lastPriceDate: null
      };
    }

    // Sort data by date and normalize dates
    const sortedData = historicalData.data.map(dataPoint => {
      const date = parseAndNormalizeDate(dataPoint.date);
      return { ...dataPoint, date };
    }).sort((a, b) => a.date - b.date);

    const latestDataDate = sortedData[sortedData.length - 1].date;
    console.log(`Latest available data for ${underlying.ticker} is on ${formatDate(latestDataDate)}`);

    // Always use the latest available date
    const endDate = latestDataDate;

    // Filter data from trade date to latest available date
    const filteredData = sortedData.filter(d => d.date >= tradeDate && d.date <= endDate);

    if (filteredData.length === 0) {
      console.error(`No price data found for ${underlying.ticker} between ${formatDate(tradeDate)} and ${formatDate(endDate)}`);
      return {
        ticker: underlying.ticker,
        eodTicker: underlying.eodTicker,
        performance: 0,
        distanceToBarrier: 0,
        lastPrice: null,
        lastPriceDate: null
      };
    }

    const initialPrice = filteredData[0].close;
    console.log(`Initial Price for ${underlying.ticker}: ${initialPrice}`);

    let lastKnownPrice = initialPrice;
    let lastKnownDate = filteredData[0].date;

    // Calculate chart100 data
    const finalDate = parseAndNormalizeDate(product.genericData.finalObservation);
    for (let d = new Date(tradeDate); d <= finalDate; d.setDate(d.getDate() + 1)) {
      const dateString = formatDate(d);
      const isBeforeOrEqualToday = d <= today;

      // Initialize the chart100Data for this date with only necessary levels
      if (!chart100Data[dateString]) {
        chart100Data[dateString] = {
          date: dateString,
          couponBarrier: currentCouponBarrier,
          autocallLevel: currentAutocallLevel,
          values: {}
        };
      }

      // Update levels if there's a new observation date
      const relevantObservation = product.observationDates.find(obs => {
        const obsDate = parseAndNormalizeDate(obs.observationDate);
        return obsDate.getTime() === d.getTime();
      });
      if (relevantObservation) {
        currentCouponBarrier = relevantObservation.couponBarrierLevel;
        if (relevantObservation.autocallLevel !== null) {
          currentAutocallLevel = relevantObservation.autocallLevel;
        }
        chart100Data[dateString].couponBarrier = currentCouponBarrier;
        chart100Data[dateString].autocallLevel = currentAutocallLevel;
      }

      // Only include stock values up to today
      if (isBeforeOrEqualToday) {
        const priceData = filteredData.find(data => data.date.getTime() === d.getTime());
        if (priceData) {
          lastKnownPrice = priceData.close;
          lastKnownDate = priceData.date;
        }

        // Calculate and set the basis 100 value for stocks
        const basis100Value = (lastKnownPrice * 100) / initialPrice;
        chart100Data[dateString].values[underlying.ticker] = basis100Value;
      }
    }

    // After the loop, calculate worstOf for dates up to today
    Object.keys(chart100Data).forEach(dateString => {
      const date = parseAndNormalizeDate(dateString);
      if (date <= today) {
        const values = Object.values(chart100Data[dateString].values)
          .filter(value => typeof value === 'number');
        if (values.length > 0) {
          chart100Data[dateString].values.worstOf = Math.min(...values);
        }
      }
    });

    const performance = ((lastKnownPrice / initialPrice) - 1) * 100;
    const distanceToBarrier = ((lastKnownPrice - (capitalProtectionBarrier / 100 * initialPrice)) / lastKnownPrice) * 100;

    return {
      ticker: underlying.ticker,
      eodTicker: underlying.eodTicker,
      performance,
      distanceToBarrier,
      lastPrice: lastKnownPrice,
      lastPriceDate: formatDate(lastKnownDate)
    };
  });

  // Convert chart100Data object to array and sort by date
  let chart100 = Object.values(chart100Data).sort((a, b) => new Date(a.date) - new Date(b.date));

  // Filter out records after the autocall date
  if (product.autocallDate) {
    const autocallDate = parseAndNormalizeDate(product.autocallDate);
    chart100 = chart100.filter(record => parseAndNormalizeDate(record.date) <= autocallDate);
  }

  const result = {
    performances,
    chart100,
    autocalled: !!autocallDate,
    autocallDate: autocallDate ? formatDate(autocallDate) : null
  };

  return result;
}

function updateUnderlyingsWithPerformance(underlyings, performanceData) {
  console.log(`Updating underlyings with performance`);
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

  console.log(`Worst performing: ${worstPerforming ? worstPerforming.ticker : 'None'} with performance ${worstPerforming ? worstPerforming.performance.toFixed(2) + '%' : 'N/A'}`);

  const updatedUnderlyings = underlyings.map(underlying => {
    const performance = performances.find(p => p.eodTicker === underlying.eodTicker);
    if (performance) {
      console.log(`Updating ${underlying.ticker}:`);
      console.log(`Performance: ${performance.performance !== null ? performance.performance.toFixed(2) + '%' : 'null'}`);
      console.log(`Distance to Barrier: ${performance.distanceToBarrier !== null ? performance.distanceToBarrier.toFixed(2) + '%' : 'null'}`);

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

  // Add worstOf to chart100.values
  if (chart100 && chart100.length > 0) {
    chart100.forEach(point => {
      if (point.values) {
        const underlyingValues = Object.values(point.values)
          .filter(value => typeof value === 'number');

        const worstOf = Math.min(...underlyingValues);

        point.values.worstOf = worstOf;
      }
    });
  }

  return { updatedUnderlyings, chart100 };
}

function calculateUnderlyingPerformancesAtDate(product, observationDate) {
  console.log(`Calculating underlying performances at date ${formatDate(observationDate)}`);

  // Normalize observationDate to midnight
  if (!(observationDate instanceof Date)) {
    observationDate = parseAndNormalizeDate(observationDate);
  } else {
    observationDate = normalizeDateToMidnight(observationDate);
  }

  return product.underlyings.map(underlying => {
    console.log(`Processing underlying ${underlying.ticker}`);
    const historicalData = Historical.findOne({ eodTicker: underlying.eodTicker });

    if (!historicalData || historicalData.data.length === 0) {
      console.log(`No historical data found for ${underlying.ticker}`);
      return { ticker: underlying.ticker, eodTicker: underlying.eodTicker, performance: null };
    }

    const sortedData = historicalData.data.map(dataPoint => {
      const date = parseAndNormalizeDate(dataPoint.date);
      return { ...dataPoint, date };
    }).sort((a, b) => b.date - a.date);

    const priceAtObservation = sortedData.find(d => d.date <= observationDate);

    if (!priceAtObservation) {
      console.log(`No price data found for ${underlying.ticker} at or before ${formatDate(observationDate)}`);
      return { ticker: underlying.ticker, eodTicker: underlying.eodTicker, performance: null };
    }

    const performance = ((priceAtObservation.close / underlying.initialReferenceLevel) - 1) * 100;

    console.log(`Calculated performance for ${underlying.ticker}: ${performance.toFixed(2)}%`);
    return {
      ticker: underlying.ticker,
      eodTicker: underlying.eodTicker,
      performance
    };
  });
}

function findWorstPerforming(performances) {
  console.log(`Finding worst performing underlying`);
  console.log(`Performances: ${JSON.stringify(performances)}`);

  const worst = performances.reduce((worst, current) => {
    console.log(`Comparing: Current ${current.ticker} (${current.performance}) vs Worst ${worst ? worst.ticker : 'None'} (${worst ? worst.performance : 'None'})`);
    if (current.performance === null) {
      console.log(`Skipping ${current.ticker} due to null performance`);
      return worst;
    }
    if (!worst || worst.performance === null || current.performance < worst.performance) {
      console.log(`New worst found: ${current.ticker}`);
      return current;
    }
    return worst;
  }, null);

  console.log(`Worst performing: ${worst.ticker} with performance ${worst.performance.toFixed(2)}%`);
  return worst;
}

function updateProductWithObservationsTable(productId, result, totalCouponPaid, status) {
  console.log(`Updating product ${productId} with observations table, total coupon paid, and status: ${status}`);
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
  console.log(`Product ${productId} updated successfully with status: ${status}`);
}

// Helper functions for date parsing and formatting
function parseAndNormalizeDate(dateString) {
  // Assuming dateString is in 'YYYY-MM-DD' format
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function normalizeDateToMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDate(date) {
  // Format date as 'YYYY-MM-DD' in local time
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Add this function after the existing helper functions
function calculateRedemptionIfToday(product, currentPerformances) {
  console.log('Calculating theoretical redemption if today was final date');
  
  if (!product || !currentPerformances || !currentPerformances.length) {
    console.log('Missing required data for redemption calculation');
    return null;
  }

  // Get worst performing underlying
  const worstPerforming = currentPerformances.reduce((worst, current) => {
    if (!current || current.performance === null) return worst;
    if (!worst || current.performance < worst.performance) return current;
    return worst;
  }, null);

  if (!worstPerforming) {
    console.log('Unable to determine worst performing underlying');
    return null;
  }

  const worstPerformanceValue = worstPerforming.performance;
  console.log(`Worst performing underlying: ${worstPerforming.ticker} with performance ${worstPerformanceValue}%`);

  // Get capital protection barrier
  const capitalProtectionBarrier = product.features.capitalProtectionBarrier;
  console.log(`Capital protection barrier: ${capitalProtectionBarrier}%`);

  // Calculate redemption
  let redemption;
  if (worstPerformanceValue >= 0) {
    // Above initial level
    redemption = 100;
    console.log('Above initial level - 100% redemption');
  } else if (worstPerformanceValue >= (capitalProtectionBarrier - 100)) {
    // Above capital protection barrier
    redemption = 100;
    console.log('Above capital protection barrier - 100% redemption');
  } else {
    // Below capital protection barrier - capital at risk
    redemption = 100 + worstPerformanceValue;
    console.log(`Below capital protection barrier - ${redemption}% redemption`);
  }

  return redemption;
}

// Add this function after calculateRedemptionIfToday
function calculateFinalRedemption(product, observationDate) {
  console.log('Calculating final redemption');
  
  const performances = calculateUnderlyingPerformancesAtDate(product, observationDate);
  const worstPerforming = findWorstPerforming(performances);
  const hasOneStar = product.features.oneStar;
  const isLowStrike = product.features.lowStrike;
  const protectionBarrier = product.features.capitalProtectionBarrier;
  
  console.log(`Final observation performances: ${JSON.stringify(performances)}`);
  console.log(`Worst performing: ${worstPerforming.ticker} at ${worstPerforming.performance.toFixed(2)}%`);
  console.log(`Protection barrier: ${protectionBarrier}%`);
  
  // Check One Star condition first
  if (hasOneStar) {
    const anyPositive = performances.some(perf => perf.performance >= 0);
    if (anyPositive) {
      console.log('One Star condition met - 100% redemption');
      return 100;
    }
  }
  
  // Above protection barrier
  if (worstPerforming.performance >= (protectionBarrier - 100)) {
    console.log('Above protection barrier - 100% redemption');
    return 100;
  }
  
  // Below protection barrier
  if (isLowStrike) {
    // Low Strike calculation: Loss is leveraged from protection barrier
    const leverage = 1 / (protectionBarrier / 100);
    const loss = (worstPerforming.performance - (protectionBarrier - 100)) * leverage;
    const redemption = 100 + loss;
    console.log(`Low Strike product - Leverage: ${leverage}, Loss: ${loss.toFixed(2)}%, Redemption: ${redemption.toFixed(2)}%`);
    return redemption;
  } else {
    // Classic product - Direct loss
    const redemption = 100 + worstPerforming.performance;
    console.log(`Classic product - Direct loss, Redemption: ${redemption.toFixed(2)}%`);
    return redemption;
  }
}

Meteor.methods({
  'products.insert'(productData) {
    check(productData, {
      ISINCode: String,
      underlyings: Array,
      genericData: Object,
      features: Object,
      observationDates: Array,
      // Add any other fields that should be part of the initial insert
    });

    // Ensure required fields are present
    const requiredFields = ['ISINCode', 'underlyings', 'genericData', 'features', 'observationDates'];
    requiredFields.forEach(field => {
      if (!productData[field]) {
        throw new Meteor.Error('missing-field', `Missing required field: ${field}`);
      }
    });

    // Process underlyings
    const processedUnderlyings = productData.underlyings.map(underlying => ({
      ticker: underlying.ticker,
      currency: underlying.currency,
      name: underlying.name,
      initialReferenceLevel: underlying.initialReferenceLevel,
      eodTicker: underlying.eodTicker,
      lastPriceInfo: {
        price: null,
        performance: null,
        distanceToBarrier: null,
        date: null,
        isWorstOf: false
      }
    }));

    // Process observation dates
    const processedObservationDates = productData.observationDates.map(obs => ({
      observationDate: obs.observationDate,
      paymentDate: obs.paymentDate,
      couponBarrierLevel: obs.couponBarrierLevel,
      autocallLevel: obs.autocallLevel || null
    }));

    // Prepare the product object
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

    // Insert the product
    const productId = Products.insert(product);

    // After insertion, trigger calculations
    Meteor.call('calculateProductPerformances', productId);

    return productId;
  },

  'calculateProductPerformances'(productId) {
    const product = Products.findOne(productId);
    if (!product) {
      throw new Meteor.Error('product-not-found', 'Product not found');
    }

    // Call the function to process the product
    const result = processPhoenixProduct(product);

    // Update the product with the calculated data
    Products.update(productId, {
      $set: {
        underlyings: product.underlyings,
        chart100: product.chart100,
        observationsTable: result.observations,
        autocalled: result.autocalled,
        autocallDate: result.autocallDate,
        totalCouponPaid: totalCouponPaid,
        status: product.status
      }
    });
  }
});

