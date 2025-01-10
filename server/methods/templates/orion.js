import { Products } from '/imports/api/products/products.js';
import { Historical } from '/imports/api/products/products.js';

/**
 * Processes an Orion product by calculating performance, creating output tables,
 * and updating the product with the processed data.
 *
 * @param {Object} product - The Orion product to process.
 * @returns {Object} - The processed product.
 */
export function processOrionProduct(product) {
  console.log(`Processing Orion product: ${product.genericData.ISINCode}`);

  if (!product || !product.genericData || !product.underlyings) {
    console.error('Invalid product data for Orion processing');
    return null;
  }

  // Process underlyings and calculate chart100
  const { processedUnderlyings, chart100 } = calculateUnderlyingPerformancesAndChart(product);

  // Determine product status based on final observation date
  const today = new Date();
  const finalObservationDate = new Date(product.genericData.finalObservation);
  const status = today <= finalObservationDate ? 'live' : 'matured';

  // Create the processed product with status and chart100
  const processedProduct = {
    ...product,
    underlyings: processedUnderlyings,
    chart100,
    status
  };

  console.log('Processed Orion product:', JSON.stringify(processedProduct, null, 2));

  // Create output table based on the processed product
  const outputTableData = createOutputTable(processedProduct);

  // Update the product with the output table data, chart100, and status
  Products.update(product._id, {
    $set: {
      outputTable: outputTableData,
      avgBasket: outputTableData.avgBasket,
      avgProduct: outputTableData.avgProduct,
      redemption: outputTableData.redemption,
      status,
      underlyings: processedUnderlyings,
      chart100,
      chartOptions: {
        upperBarrier: {
          borderColor: 'rgba(255, 99, 132, 0.7)',  // Red color
          backgroundColor: 'rgba(255, 99, 132, 0.1)',
          borderWidth: 2,
          fill: true
        }
      }
    }
  });

  return processedProduct;
}

/**
 * Creates an output table for the Orion product.
 *
 * @param {Object} product - The processed Orion product.
 * @returns {Object} - The output table data.
 */
export function createOutputTable(product) {
  const underlyingsData = product.underlyings.map(underlying => {
    const perfOfStock = calculatePerformance(underlying, product);
    const { upperBarrierTouched, touchDate } = checkUpperBarrierTouched(underlying, product);

    let consideredPerformance;
    if (upperBarrierTouched) {
      consideredPerformance = product.features.rebate;  // Use rebate value if barrier touched
    } else {
      consideredPerformance = perfOfStock;
    }

    return {
      ticker: underlying.ticker,
      name: underlying.name,
      initialReferenceLevel: underlying.initialReferenceLevel,
      perfOfStock: perfOfStock,
      consideredPerformance: consideredPerformance,
      upperBarrierTouched: upperBarrierTouched,
      touchDate: touchDate || 'N/A'
    };
  });

  const avgBasket = calculateAverage(underlyingsData.map(u => u.perfOfStock));
  const avgProduct = calculateAverage(underlyingsData.map(u => u.consideredPerformance));
  
  const redemption = Math.max(1, 1 + (avgProduct / 100)) * 100;

  const outputTable = {
    underlyings: underlyingsData,
    avgBasket,
    avgProduct,
    redemption: Number(redemption.toFixed(4))
  };

  console.log('Created output table:', outputTable);
  return outputTable;
}

/**
 * Updates the product with the generated output table and related data.
 *
 * @param {String} productId - The ID of the product to update.
 * @param {Object} outputTableData - The output table data to add.
 * @param {String} status - The product status (live or matured)
 */
export function updateProductWithOutputTable(productId, outputTableData, status) {
  Products.update(productId, {
    $set: {
      outputTable: outputTableData,
      avgBasket: outputTableData.avgBasket,
      avgProduct: outputTableData.avgProduct,
      redemption: outputTableData.redemption,
      status
    }
  });

  console.log(`Updated product ${productId} with output table data and status: ${status}`);
}

/**
 * Calculates the average of an array of numbers.
 *
 * @param {Array} numbers - The array of numbers.
 * @returns {Number} - The average value.
 */
function calculateAverage(numbers) {
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((a, b) => a + b, 0);
  return sum / numbers.length;
}

/**
 * Calculates the performance of an underlying
 * @param {Object} underlying - The underlying asset
 * @returns {Number} - Performance value
 */
function calculatePerformance(underlying) {
  // We can use the already calculated performance from lastPriceInfo
  return underlying.lastPriceInfo.performance || 0;
}

/**
 * Checks if the upper barrier has been touched
 * @param {Object} underlying - The underlying asset
 * @param {Object} product - The full product object
 * @returns {Object} - Touch status and date
 */
function checkUpperBarrierTouched(underlying, product) {
  const upperBarrier = product.features.upperBarrier;
  const upperBarrierBasis100 = 100 + upperBarrier; // Convert barrier to basis 100
  
  // Get historical data
  const historicalData = Historical.findOne({ eodTicker: underlying.eodTicker });
  if (!historicalData || !historicalData.data.length) {
    return { upperBarrierTouched: false, touchDate: null };
  }

  // Check all historical prices
  const initialPrice = underlying.initialReferenceLevel;
  for (const dataPoint of historicalData.data) {
    const basis100Value = (dataPoint.close * 100) / initialPrice;
    if (basis100Value >= upperBarrierBasis100) {
      return {
        upperBarrierTouched: true,
        touchDate: new Date(dataPoint.date).toISOString().split('T')[0]
      };
    }
  }
  
  return { upperBarrierTouched: false, touchDate: null };
}

/**
 * Checks if the down barrier has been touched
 * @param {Object} underlying - The underlying asset
 * @param {Object} product - The full product object
 * @returns {Object} - Touch status
 */
function checkDownBarrierTouched(underlying, product) {
  // If there's no down barrier defined, return false
  if (!product.features.downBarrier) {
    return { downBarrierTouched: false };
  }
  
  const downBarrier = product.features.downBarrier;
  const performance = underlying.lastPriceInfo.performance;
  
  return {
    downBarrierTouched: performance <= downBarrier
  };
}

function calculateUnderlyingPerformancesAndChart(product) {
  console.log(`Calculating performances and chart data for product ${product.genericData.ISINCode}`);

  const tradeDate = new Date(product.genericData.tradeDate);
  const finalObservation = new Date(product.genericData.finalObservation);
  const upperBarrier = product.features.upperBarrier;
  const upperBarrierBasis100 = 100 * (1 + (upperBarrier / 100));
  const today = new Date();

  console.log(`Trade Date: ${tradeDate}, Final Observation: ${finalObservation}`);

  const chart100Data = {};
  const processedUnderlyings = [];

  // First, create all date entries up to final observation
  for (let d = new Date(tradeDate); d <= finalObservation; d.setDate(d.getDate() + 1)) {
    const dateString = d.toISOString().split('T')[0];
    chart100Data[dateString] = {
      date: dateString,
      upperBarrier: upperBarrierBasis100,
      values: {}
    };
  }

  // Then process underlyings data only up to today
  product.underlyings.forEach(underlying => {
    console.log(`Processing underlying ${underlying.ticker}`);
    const historicalData = Historical.findOne({ eodTicker: underlying.eodTicker });

    if (!historicalData || !historicalData.data.length) {
      console.error(`No historical data found for ${underlying.ticker}`);
      return;
    }

    // Sort data by date
    const sortedData = historicalData.data
      .map(dataPoint => ({
        ...dataPoint,
        date: new Date(dataPoint.date)
      }))
      .sort((a, b) => a.date - b.date);

    const initialPrice = underlying.initialReferenceLevel;
    let lastKnownPrice = initialPrice;

    // Calculate chart100 data only up to today
    for (let d = new Date(tradeDate); d <= today && d <= finalObservation; d.setDate(d.getDate() + 1)) {
      const dateString = d.toISOString().split('T')[0];
      const priceData = sortedData.find(data => 
        data.date.toISOString().split('T')[0] === dateString
      );

      if (priceData) {
        lastKnownPrice = priceData.close;
      }

      // Calculate the basis 100 value
      const basis100Value = (lastKnownPrice * 100) / initialPrice;

      // Set the value for this date
      if (chart100Data[dateString]) {
        chart100Data[dateString].values[underlying.ticker] = basis100Value;
      }
    }

    // Process underlying performance data
    const lastDataPoint = sortedData[sortedData.length - 1];
    const performance = ((lastDataPoint.close / initialPrice) - 1) * 100;

    processedUnderlyings.push({
      ...underlying,
      lastPriceInfo: {
        price: lastDataPoint.close,
        performance: Number(performance.toFixed(2)),
        date: lastDataPoint.date.toISOString().split('T')[0]
      }
    });
  });

  // Convert chart100Data object to array and sort by date
  const chart100 = Object.values(chart100Data)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  return { processedUnderlyings, chart100 };
}
