import { Products } from '/imports/api/products/products.js';
import { Historical } from '/imports/api/products/products.js';

const getLatestPrice = (eodTicker) => {
  const historicalData = Historical.findOne({ eodTicker: eodTicker });

  if (historicalData && historicalData.data && historicalData.data.length > 0) {
    const latestData = historicalData.data[historicalData.data.length - 1];
    console.log(`Latest price data for ${eodTicker}:`, latestData);
    return {
      price: latestData.close,
      high: latestData.high,
      low: latestData.low,
      date: new Date(latestData.date)
    };
  } else {
    console.log(`No historical data found for ${eodTicker}`);
    return null;
  }
};

const getHighLowClosePrices = (eodTicker, startDate, endDate) => {
  const historicalData = Historical.findOne({ eodTicker: eodTicker });

  if (!historicalData || !historicalData.data) {
    return null;
  }

  const relevantData = historicalData.data.filter(d => {
    const dataDate = new Date(d.date);
    return dataDate >= startDate && dataDate <= endDate;
  });

  if (relevantData.length > 0) {
    const lowestClose = Math.min(...relevantData.map(d => d.close));
    const highestClose = Math.max(...relevantData.map(d => d.close));
    return { lowestClose, highestClose };
  } else {
    return null;
  }
};

export const processTwinWinProduct = (product) => {
  let result = {
    productId: product._id,
  };

  if (!product.underlyings || !Array.isArray(product.underlyings)) {
    return result;
  }

  console.log('Product ID:', product._id);
  console.log('Trade date:', product.genericData.tradeDate);
  console.log('Final date:', product.genericData.finalDate);
  console.log('Maturity date:', product.genericData.maturityDate);

  const tradeDate = new Date(product.genericData.tradeDate);
  const finalDate = new Date(product.genericData.finalDate);
  const maturityDate = new Date(product.genericData.maturityDate);
  const today = new Date();
  const endDate = today > finalDate ? finalDate : today;

  console.log('Calculated dates:');
  console.log('- Trade date:', tradeDate.toISOString());
  console.log('- Final date:', finalDate.toISOString());
  console.log('- Maturity date:', maturityDate.toISOString());
  console.log('- End date:', endDate.toISOString());

  const newStatus = today > maturityDate ? 'matured' : 'live';
  console.log('- New status:', newStatus);

  const lastPriceInfo = product.underlyings.map((underlying, index) => {
    let priceInfo = {};

    if (!underlying || typeof underlying !== 'object') {
      console.log(`Invalid underlying at index ${index}`);
      return null;
    }

    const underlyingId = underlying.ticker || `unknown_${index}`;
    console.log(`Processing underlying: ${underlyingId}`);

    // Get price at trade date
    const tradeDatePrice = getPriceAtDate(underlying.eodTicker, tradeDate);
    if (!tradeDatePrice) {
      console.log(`No price data found for ${underlyingId} at trade date ${tradeDate}`);
      return null;
    }
    priceInfo.tradeDatePrice = tradeDatePrice.close;
    console.log(`Trade date price for ${underlyingId}: ${priceInfo.tradeDatePrice}`);

    // Determine whether to use final date price or latest price
    if (today > finalDate) {
      // If finalDate is in the past, use the closing price at finalDate
      const finalPriceData = getPriceAtDate(underlying.eodTicker, finalDate);
      if (finalPriceData) {
        priceInfo.currentPrice = finalPriceData.close;
        priceInfo.date = finalDate;
        console.log(`Final price data for ${underlyingId} at ${finalDate}:`, priceInfo.currentPrice);
      } else {
        console.log(`No final price data for ${underlyingId} at ${finalDate}`);
        return null;
      }
    } else {
      // If finalDate is in the future, use the latest available price
      const latestPriceData = getLatestPrice(underlying.eodTicker);
      if (latestPriceData) {
        priceInfo.currentPrice = latestPriceData.price;
        priceInfo.date = latestPriceData.date;
        console.log(`Latest price data for ${underlyingId}:`, priceInfo.currentPrice);
      } else {
        console.log(`No latest price data for ${underlyingId}`);
        return null;
      }
    }

    console.log(`Current/Final price for ${underlyingId}: ${priceInfo.currentPrice}`);

    if (typeof priceInfo.tradeDatePrice === 'number' && typeof priceInfo.currentPrice === 'number') {
      const priceDifference = priceInfo.currentPrice - priceInfo.tradeDatePrice;
      console.log(`Price difference: ${priceDifference}`);
      const performanceRatio = priceDifference / priceInfo.tradeDatePrice;
      console.log(`Performance ratio: ${performanceRatio}`);
      priceInfo.performance = performanceRatio * 100;
      console.log(`Calculated performance for ${underlyingId}: ${priceInfo.performance}%`);
    } else {
      priceInfo.performance = null;
      console.log(`Unable to calculate performance for ${underlyingId}:`);
      console.log(`- Trade date price: ${priceInfo.tradeDatePrice}`);
      console.log(`- Current/Final price: ${priceInfo.currentPrice}`);
      if (typeof priceInfo.tradeDatePrice !== 'number') {
        console.log(`- Trade date price is not a number. Type: ${typeof priceInfo.tradeDatePrice}`);
      }
      if (typeof priceInfo.currentPrice !== 'number') {
        console.log(`- Current/Final price is not a number. Type: ${typeof priceInfo.currentPrice}`);
      }
    }

    const initialLevel = underlying.initialReferenceLevel;
    const upperBarrier = initialLevel * (product.knockOutBarrierUp / 100);
    const lowerBarrier = initialLevel * (product.knockOutBarrierDown / 100);

    priceInfo.upperBarrierBreached = priceInfo.highestClose >= upperBarrier;
    priceInfo.lowerBarrierBreached = priceInfo.lowestClose <= lowerBarrier;

    // Get high/low close prices for the period
    const highLowPrices = getHighLowClosePrices(underlying.eodTicker, tradeDate, endDate);
    if (highLowPrices) {
      priceInfo.lowestClose = highLowPrices.lowestClose;
      priceInfo.highestClose = highLowPrices.highestClose;
      console.log(`Lowest close for ${underlyingId}: ${priceInfo.lowestClose}`);
      console.log(`Highest close for ${underlyingId}: ${priceInfo.highestClose}`);
    } else {
      console.log(`Unable to get high/low close prices for ${underlyingId}`);
      priceInfo.lowestClose = null;
      priceInfo.highestClose = null;
    }

    return priceInfo;
  }).filter(Boolean);

  const chart100 = product.underlyings.map(underlying => {
    const historicalData = Historical.findOne({ eodTicker: underlying.eodTicker });
    if (!historicalData || !historicalData.data) {
      return null;
    }
  
    const relevantData = historicalData.data.filter(d => {
      const dataDate = new Date(d.date);
      return dataDate >= tradeDate && dataDate <= endDate;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
  
    if (relevantData.length === 0) {
      return null;
    }
  
    const initialPrice = underlying.initialReferenceLevel;

    const chartData = relevantData.map(d => ({
      date: d.date,
      value: (d.close / initialPrice) * 100,
      downBarrier: product.knockOutBarrierDown,
      upBarrier: product.knockOutBarrierUp
    }));
  
    const normalizeDate = (date) => {
      const normalized = new Date(date);
      normalized.setHours(0, 0, 0, 0);
      return normalized;
    };
  
    const lastDataDate = normalizeDate(relevantData[relevantData.length - 1].date);
    const normalizedFinalDate = normalizeDate(finalDate);
  
    console.log(`For ${underlying.ticker}:`);
    console.log('- Last data date:', lastDataDate.toISOString());
    console.log('- Normalized final date:', normalizedFinalDate.toISOString());

    let currentDate = new Date(lastDataDate);
    currentDate.setDate(currentDate.getDate() + 1);
  
    while (currentDate <= normalizedFinalDate) {
      chartData.push({
        date: currentDate.toISOString().split('T')[0],
        value: null,
        downBarrier: product.knockOutBarrierDown,
        upBarrier: product.knockOutBarrierUp
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }
  
    return {
      ticker: underlying.ticker,
      name: underlying.name,
      data: chartData
    };
  }).filter(Boolean);
  
  const output = product.underlyings.map((underlying, index) => {
    console.log(`Processing underlying ${index + 1}: ${underlying.ticker}`);

    const priceInfo = lastPriceInfo[index];
    if (!priceInfo) {
      console.log(`No price info found for ${underlying.ticker}. Skipping.`);
      return null;
    }

    console.log(`Price info for ${underlying.ticker}:`, priceInfo);

    const performance = priceInfo.performance;
    console.log(`Performance: ${performance}%`);

    const barrierUpTouched = priceInfo.upperBarrierBreached;
    console.log(`Upper barrier touched: ${barrierUpTouched}`);

    const barrierDownTouched = priceInfo.lowerBarrierBreached;
    console.log(`Lower barrier touched: ${barrierDownTouched}`);

    let capitalRedemption;
    if (performance !== null && !isNaN(performance)) {
      if (performance >= 0 && !barrierUpTouched) {
        capitalRedemption = performance + 100;
        console.log(`Positive performance and upper barrier not touched. Capital redemption: ${capitalRedemption}%`);
      } else if (performance < 0 && !barrierDownTouched) {
        capitalRedemption = Math.abs(performance) + 100;
        console.log(`Negative performance and lower barrier not touched. Capital redemption: ${capitalRedemption}%`);
      } else {
        capitalRedemption = product.capitalGuaranteeLevel || 0;
        console.log(`Barrier(s) touched. Using capital guarantee level: ${capitalRedemption}%`);
      }
    } else {
      capitalRedemption = product.capitalGuaranteeLevel || 0;
      console.log(`Invalid performance. Using capital guarantee level: ${capitalRedemption}%`);
    }

    // Ensure capitalRedemption is never below capitalGuaranteeLevel
    capitalRedemption = Math.max(capitalRedemption, product.capitalGuaranteeLevel || 0);
    console.log(`Final capital redemption: ${capitalRedemption}%`);

    console.log(`Processing complete for ${underlying.ticker}`);

    return {
      ticker: underlying.ticker,
      performance,
      barrierUpTouched,
      barrierDownTouched,
      capitalRedemption
    };
  }).filter(Boolean);

  Products.update(product._id, {
    $set: {
      chart100: chart100,
      'underlyings.$[].lastPriceInfo': lastPriceInfo,
      status: newStatus,
      output: output // Add the new output object
    }
  });

  result.lastPriceInfo = lastPriceInfo;
  result.chart100 = chart100;
  result.status = newStatus;
  result.output = output; // Include the output in the result
  return result;
};

// Add this new function to get the price at a specific date
const getPriceAtDate = (eodTicker, date) => {
  const historicalData = Historical.findOne({ eodTicker: eodTicker });

  if (historicalData && historicalData.data && historicalData.data.length > 0) {
    const priceData = historicalData.data.find(d => new Date(d.date).toDateString() === date.toDateString());
    if (priceData) {
      console.log(`Price data found for ${eodTicker} at ${date}:`, priceData);
      return priceData;
    } else {
      console.log(`No price data found for ${eodTicker} at ${date}`);
      return null;
    }
  } else {
    console.log(`No historical data found for ${eodTicker}`);
    return null;
  }
};