import { Template } from 'meteor/templating';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation';
import html2pdf from 'html2pdf.js';
import { jsPDF } from 'jspdf';
import 'jspdf/dist/polyfills.es.js';

// Register all Chart.js components and plugins
Chart.register(...registerables, annotationPlugin);

const CHART_HEIGHT = 400;
const CHART_WIDTH = '100%';
const COMPANY_LOGO = 'https://amberlakepartners.com/assets/logos/Icon%201.png';

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

Template.registerHelper('join', function(array, separator) {
    return array.join(separator);
});

Template.registerHelper('startsWith', function(str, prefix) {
  if (!str) return false;
  return str.toString().startsWith(prefix);
});

Template.phoenix.helpers({

  debugInfo() {
    return JSON.stringify(this, null, 2);
  },

  getLogoUrl(eodTicker) {
    // Check if eodTicker is provided and is a string
    if (!eodTicker || typeof eodTicker !== 'string') {
      return 'https://eodhd.com/img/logos/default/default.png'; // Fallback logo
    }

    const parts = eodTicker.split('.');
    
    // Ensure the ticker is in the correct format
    if (parts.length !== 2) {
      return 'https://eodhd.com/img/logos/default/default.png'; // Fallback logo
    }

    const ticker = parts[0];
    const region = parts[1];
    
    // Construct the logo URL
    return `https://eodhd.com/img/logos/${region}/${ticker}.png`;
  },

  timelineSteps() {
    const product = Template.instance().data;
    if (!product) return [];

    const currentDate = new Date();
    let steps = [{
      date: product.genericData.tradeDate,
      label: 'Trade Date',
      status: 'completed'
    }];

    // Function to check if a date is in the past
    const isPastDate = (date) => new Date(date) <= currentDate;

    // Function to check if an observation result is valid (not placeholder data)
    const isValidObservationResult = (result) => {
      return result.worstPerformance !== "-" && result.autocalled !== "-";
    };

    let productAutocalled = false;

    // Iterate through all observation dates
    for (let i = 0; i < product.observationDates.length; i++) {
      const obs = product.observationDates[i];
      const obsDate = new Date(obs.observationDate);
      
      let label = `Obs ${i + 1}`; // Removed [Coupon: xx%]
      let status = isPastDate(obsDate) ? 'completed' : 'disabled';

      // Check for corresponding entry in observationsTable
      const observationResult = product.observationsTable[i];
      
      if (observationResult && isValidObservationResult(observationResult)) {
        if (observationResult.autocalled) {
          label += ' (Autocalled)';
          status = 'completed';
          productAutocalled = true;
        } else if (observationResult.couponPaid) {
          label += ` (Coupon Paid: ${observationResult.couponPaid}%)`;
        }
      }

      steps.push({
        date: obs.observationDate,
        label: label,
        status: status
      });

      // If product was autocalled, stop adding future dates
      if (productAutocalled) {
        break;
      }
    }

    // Add maturity date only if the product wasn't autocalled
    if (!productAutocalled) {
      steps.push({
        date: product.genericData.maturityDate,
        label: 'Maturity',
        status: isPastDate(product.genericData.maturityDate) ? 'completed' : 'disabled'
      });
    }

    return steps;
  },

  unrealizedPnL() {
    const product = Template.instance().data;
    if (!product) return null;

    // Get redemption if today
    const redemptionIfToday = product.redemptionIfToday;
    if (redemptionIfToday === null) return null;

    // Get total coupons paid
    const totalCouponPaid = product.totalCouponPaid || 0;

    // Calculate unrealized P&L: (Redemption if today - 100 + Total Coupons)
    const unrealizedPnL = redemptionIfToday - 100 + totalCouponPaid;
    
    console.log('Unrealized P&L calculation:', {
      redemptionIfToday,
      totalCouponPaid,
      formula: `${redemptionIfToday} - 100 + ${totalCouponPaid}`,
      result: unrealizedPnL
    });

    return unrealizedPnL;
  },

  newsLoading() {
    return false;
  },

  underlyingNews() {
    return [];
  },

  truncateText(text, lines) {
    return '';
  },

  isPdfLoading() {
    return Template.instance().pdfLoading.get();
  },

  gt(a, b) {
    return a > b;
  },

  or(a, b) {
    return a || b;
  },

  formatPercentage(value) {
    if (value === null || value === undefined || value === '-') {
      return '-';
    }
    const num = Number(value);
    if (isNaN(num)) {
      return '-';
    }
    return num.toFixed(2);
  }
});

let chartInstance = null;

const pastelColors = [
  'rgba(255, 159, 64, 0.7)',  // Pastel Orange
  'rgba(54, 162, 235, 0.7)',  // Pastel Blue
  'rgba(75, 192, 192, 0.7)',  // Pastel Green
  'rgba(201, 203, 207, 0.7)'  // Pastel Gray
];

Template.phoenix.onRendered(function() {
  console.log("Phoenix template rendered, data:", Template.currentData());
  // Add fixed sizing styles
  const style = document.createElement('style');
  style.textContent = `
    #productChartContainer {
      height: ${CHART_HEIGHT}px !important;
      width: ${CHART_WIDTH} !important;
      position: relative !important;
      margin: 20px 0 !important;
    }
    #productChart {
      height: ${CHART_HEIGHT}px !important;
      width: ${CHART_WIDTH} !important;
      position: relative !important;
    }
  `;
  document.head.appendChild(style);

  function mergeChartOptions(existingOptions, newOptions) {
    const merged = JSON.parse(JSON.stringify(existingOptions));
    Object.keys(newOptions).forEach(key => {
      if (typeof newOptions[key] === 'object' && newOptions[key] !== null && !Array.isArray(newOptions[key])) {
        merged[key] = mergeChartOptions(merged[key] || {}, newOptions[key]);
      } else {
        merged[key] = newOptions[key];
      }
    });
    return merged;
  }

  this.autorun(() => {
    const product = Template.currentData();
    if (!product || !product.chart100) return;

    console.log("Chart100 data:", product.chart100);

    const ctx = document.getElementById('productChart');
    if (!ctx) return;

    const chart100 = product.chart100;

    // Normalize a date to midnight
    function normalizeDate(date) {
      const normalized = new Date(date);
      normalized.setHours(0, 0, 0, 0);
      return normalized;
    }

    // Ensure chart100 data starts from the trade date
    const tradeDate = normalizeDate(product.genericData.tradeDate);
    const finalDate = normalizeDate(product.genericData.finalDate);
    let currentDate = new Date(tradeDate);

    const underlyingKeys = Object.keys(chart100[0].values).filter(key => key !== 'worstOf');



    // Sort the chart100 data by date
    chart100.sort((a, b) => normalizeDate(a.date) - normalizeDate(b.date));

    // Extract datasets for each underlying
    
    const datasets = underlyingKeys.map((key, index) => ({
      label: key,
      data: chart100.map(item => ({ x: new Date(item.date), y: item.values[key] })),
      borderColor: pastelColors[index % pastelColors.length],
      backgroundColor: pastelColors[index % pastelColors.length],
      fill: false,
      pointRadius: 0,
      borderWidth: 2,
      borderColor: pastelColors[index % pastelColors.length],  // Keep original transparency
      backgroundColor: pastelColors[index % pastelColors.length]  // Keep original transparency
    }));

    // Add dataset for worstOf
    datasets.unshift({
      label: 'Worst Performing',
      data: chart100.map(item => ({ x: new Date(item.date), y: item.values.worstOf })),
      borderColor: 'rgba(255, 255, 0, 1)', // Yellow color
      backgroundColor: 'rgba(255, 255, 0, 0.2)', // Light yellow for background
      fill: false,
      pointRadius: 0,
      borderWidth: 1, // Thinner line
      borderDash: [5, 5], // Dashed line
      order: -1 // Ensure this dataset is drawn below others
    });
    

    // Add dataset for coupon barrier
    datasets.push({
      label: 'Coupon Barrier',
      data: chart100.map(item => ({ x: new Date(item.date), y: item.couponBarrier })),
      borderColor: 'rgba(255, 99, 132, 0.7)',  // Pastel Red
      backgroundColor: 'rgba(255, 99, 132, 0.2)',  // Semi-transparent red
      fill: 'start',
      pointRadius: 0,
      borderWidth: 2,
      borderDash: [5, 5]  // Dashed line
    });



    // Add dataset for initial level
    datasets.push({
      label: 'Initial Level',
      data: chart100.map(item => ({ x: new Date(item.date), y: 100 })),
      borderColor: 'rgba(255, 165, 0, 0.7)',  // Orange
      backgroundColor: 'rgba(255, 165, 0, 0.2)',  // Semi-transparent orange
      fill: false,
      pointRadius: 0,
      borderWidth: 2,
      borderDash: [5, 5]  // Dashed line
    });

// Determine the end date
let endDate;
if (product.autocallDate) {
  endDate = new Date(product.autocallDate);
  endDate.setDate(endDate.getDate() + 7); // One day after autocall date
} else {
  endDate = new Date(product.genericData.finalObservation);
}

// Filter chart100 data
const filteredChart100 = chart100.filter(item => normalizeDate(item.date) <= endDate);
console.log("Filtered Chart100 data:", filteredChart100);

// Add this logging for the autocall level dataset
const autocallDataset = {
  label: 'Autocall Level',
  data: filteredChart100.map(item => ({ 
    x: new Date(item.date), 
    y: item.autocallLevel !== undefined ? item.autocallLevel : null 
  })),
  borderColor: 'rgba(255, 215, 0, 0.7)',  // Gold color
  backgroundColor: 'rgba(255, 215, 0, 0.1)',  // Transparent gold
  fill: true,
  pointRadius: 0,
  borderWidth: 2,
  borderDash: [5, 5]  // Dashed line
};
console.log("Autocall Level dataset:", autocallDataset);
console.log("Sample of Autocall Level data:", autocallDataset.data.slice(0, 5));

datasets.push(autocallDataset);

datasets.forEach(dataset => {
  dataset.data = filteredChart100.map(item => {
    let yValue;

    if (dataset.label === 'Autocall Level') {
      yValue = item.autocallLevel;
    } else if (dataset.label === 'Coupon Barrier') {
      yValue = item.couponBarrier;
    } else if (dataset.label === 'Initial Level') {
      yValue = 100; // Assuming the initial level is always 100
    } else if (dataset.label === 'Worst Performing') {
      yValue = item.values.worstOf;
    } else {
      yValue = item.values[dataset.label] || null;
    }

    return {
      x: new Date(item.date),
      y: yValue,
    };
  });
});

    // Create annotations
    const annotations = {
      line1: {
        type: 'line',
        mode: 'vertical',
        scaleID: 'x',
        value: new Date(product.genericData.tradeDate),
        borderColor: 'rgba(255, 255, 255, 0.7)',
        borderWidth: 1,
        label: {
          content: 'Initial',
          enabled: true,
          position: 'top'
        }
      },
      // ... other annotations ...
    };

    // Add observation date annotations
    product.observationDates
      .filter(obs => new Date(obs.observationDate) <= endDate)
      .forEach((obs, index) => {
        annotations[`obs${index}`] = {
          type: 'line',
          mode: 'vertical',
          scaleID: 'x',
          value: new Date(obs.observationDate),
          borderColor: 'rgba(255, 255, 255, 0.7)',
          borderWidth: 1,
          label: {
            content: `Obs ${index + 1}`,
            enabled: true,
            position: 'top'
          }
        };
      });

    // Create datasets array with coupon payments as a separate dataset
    const couponDataset = {
      label: 'Coupons',
      data: product.observationsTable
        .filter(obs => obs.couponPaid && obs.couponPaid > 0)
        .map(obs => ({
          x: new Date(obs.observationDate),
          y: 100  // Fixed position at 100
        })),
      pointStyle: 'circle',  // Changed to circle
      pointRadius: 8,        // Slightly smaller
      pointHoverRadius: 10,
      backgroundColor: 'white',  // White fill
      borderColor: 'rgba(40, 167, 69, 1)',  // Solid green border
      borderWidth: 2,        // Make border visible
      pointBackgroundColor: 'white',
      pointBorderColor: 'rgba(40, 167, 69, 1)',
      pointBorderWidth: 2,
      showLine: false,
      order: -1  // To ensure coupons are drawn on top
    };

    // Add coupon dataset to existing datasets
    datasets.push(couponDataset);

    // Add dataset for memory autocall points
    if (product.features.memoryAutocall && product.observationsTable) {
      const memoryAutocallPoints = product.observationsTable
        .filter(obs => obs.newlyLockedStocks && obs.newlyLockedStocks.length > 0)
        .flatMap(obs => {
          const dataPoint = filteredChart100.find(item => item.date === obs.observationDate);
          if (!dataPoint) return [];

          return obs.newlyLockedStocks.map(ticker => ({
            x: new Date(obs.observationDate),
            y: dataPoint.values[ticker],
            lockedStock: ticker,
            allLocked: obs.allLockedStocks || []
          }));
        });

      datasets.push({
        label: 'Memory Autocall Points',
        data: memoryAutocallPoints,
        type: 'scatter',
        pointStyle: 'rectRot',
        radius: 8,
        hitRadius: 8,
        hoverRadius: 10,
        backgroundColor: 'rgba(255, 165, 0, 0.8)',
        borderColor: 'rgba(255, 165, 0, 1)',
        borderWidth: 2,
        order: -2,
        tooltip: {
          callbacks: {
            label: function(context) {
              const point = context.raw;
              return [
                `Memory Autocall: ${point.lockedStock}`,
                `Date: ${point.x.toLocaleDateString()}`,
                `Performance: ${point.y.toFixed(2)}%`,
                `All Locked: ${point.allLocked.join(', ')}`
              ];
            }
          }
        }
      });
    }

    // Chart options with custom plugin
    const chartOptions = {
      maintainAspectRatio: false,
      responsive: true,
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'day',
            displayFormats: {
              day: 'MMM d'
            }
          },
          min: new Date(product.genericData.tradeDate),
          max: endDate,
          ticks: {
            color: '#ffffff',
            callback: function(value) {
              const date = new Date(value);
              const dateStr = formatDate(date);
              
              // Show trade date
              if (dateStr === product.genericData.tradeDate) {
                return 'Trade';
              }
              
              // Show observation dates
              const obsIndex = product.observationDates.findIndex(
                obs => formatDate(new Date(obs.observationDate)) === dateStr
              );
              
              if (obsIndex !== -1) {
                return `Obs ${obsIndex + 1}`;
              }
              
              // Hide all other dates
              return '';
            },
            // Force show all observation dates
            source: 'data',
            autoSkip: false,
            major: {
              enabled: true
            },
            // Include all observation dates in the ticks
            include: [
              new Date(product.genericData.tradeDate),
              ...product.observationDates.map(obs => new Date(obs.observationDate))
            ]
          },
          grid: {
            display: false
          }
        },
        y: {
          ticks: {
            color: '#ffffff'
          },
          grid: {
            display: false
          },
          // Fix the scale to show all data points clearly
          min: Math.min(
            60,  // Minimum value to always show
            Math.floor(Math.min(...datasets.flatMap(dataset => 
              dataset.data.map(point => point.y)
                .filter(y => y !== null && y !== undefined)
            )) * 0.95)
          ),
          max: Math.max(
            140,  // Maximum value to always show
            Math.ceil(Math.max(...datasets.flatMap(dataset => 
              dataset.data.map(point => point.y)
                .filter(y => y !== null && y !== undefined)
            )) * 1.05)
          )
        }
      },
      plugins: {
        tooltip: {
          enabled: true,
          mode: 'nearest',
          intersect: true,
          callbacks: {
            label: function(context) {
              if (context.dataset.label === 'Coupons') {
                const observation = product.observationsTable
                  .find(obs => {
                    if (!obs.couponPaid || obs.couponPaid <= 0) return false;
                    const obsDate = new Date(obs.observationDate);
                    const contextDate = new Date(context.parsed.x);
                    return obsDate.getTime() === contextDate.getTime();
                  });

                if (observation) {
                  return [
                    `Coupon Payment: ${observation.couponPaid}%`,
                    `Date: ${new Date(observation.observationDate).toLocaleDateString()}`,
                    `Payment Date: ${new Date(observation.paymentDate).toLocaleDateString()}`
                  ];
                }
              }
              // For other datasets
              const value = typeof context.parsed.y === 'number' ? 
                context.parsed.y.toFixed(2) : context.parsed.y;
              return `${context.dataset.label}: ${value}`;
            }
          }
        },
        annotation: {
          annotations: {
            line1: {
              type: 'line',
              mode: 'vertical',
              scaleID: 'x',
              value: new Date(product.genericData.tradeDate),
              borderColor: 'rgba(255, 255, 255, 0.7)',
              borderWidth: 1,
              label: {
                content: 'Initial',
                enabled: true,
                position: 'top'
              }
            },
            // Add observation date lines
            ...product.observationDates
              .filter(obs => new Date(obs.observationDate) <= endDate)
              .reduce((acc, obs, index) => ({
                ...acc,
                [`obs${index}`]: {
                  type: 'line',
                  mode: 'vertical',
                  scaleID: 'x',
                  value: new Date(obs.observationDate),
                  borderColor: 'rgba(255, 255, 255, 0.7)',
                  borderWidth: 1,
                  label: {
                    content: `Obs ${index + 1}`,
                    enabled: true,
                    position: 'top'
                  }
                }
              }), {})
          }
        }
      }
    };

    // Create or update chart
    if (chartInstance) {
      chartInstance.destroy();
    }
    
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: chartOptions
    });
  });

  /* Comment out news fetching
  this.autorun(() => {
    const product = Template.currentData();
    if (!product || !product.underlyings) return;

    const tickers = product.underlyings
      .filter(u => u && u.ticker)
      .map(u => u.eodTicker || u.ticker);
    if (!tickers.length) return;

    console.log('Fetching news for tickers:', tickers);
    this.newsLoading.set(true);

    Meteor.call('getUnderlyingNews', tickers, (error, result) => {
      this.newsLoading.set(false);
      if (error) {
        console.error('Error fetching news:', error);
        this.underlyingNews.set([]);
      } else {
        const sortedNews = (result || []).sort((a, b) => 
          new Date(b.publishedAt) - new Date(a.publishedAt)
        ).map(news => ({
          ...news,
          url: news.url || '#',
          linkText: news.url ? (news.url.includes('twitter.com') ? 'View Tweet' : 'Read More') : 'No Link'
        }));
        this.underlyingNews.set(sortedNews);
      }
    });
  });
  */
});

Template.phoenix.onCreated(function() {
  // Initialize only the pdfLoading ReactiveVar
  this.pdfLoading = new ReactiveVar(false);
});

Template.phoenix.helpers({
  // Remove news-related helpers or return null/empty values
  newsLoading() {
    return false;  // Or remove this helper entirely
  },

  underlyingNews() {
    return [];  // Or remove this helper entirely
  },

  truncateText(text, lines) {
    return '';  // Or remove this helper entirely
  },

  // Keep other helpers
  isPdfLoading() {
    return Template.instance().pdfLoading.get();
  },

  gt(a, b) {
    return a > b;
  },

  or(a, b) {
    return a || b;
  },

  formatPercentage(value) {
    if (value === null || value === undefined || value === '-') {
      return '-';
    }
    const num = Number(value);
    if (isNaN(num)) {
      return '-';
    }
    return num.toFixed(2);
  }
});

Template.phoenix.onDestroyed(function() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
});

// Function to fetch or calculate values for a specific date
function fetchValuesForDate(dateString, underlyings) {
  const values = {};
  underlyings.forEach(underlying => {
    // Fetch the closing price for the underlying on the given date
    const closingPrice = getClosingPriceForDate(underlying.eodTicker, dateString);
    if (closingPrice !== undefined) {
      values[underlying.ticker] = closingPrice;
    } else {
      console.warn(`No closing price found for ${underlying.ticker} on ${dateString}`);
      values[underlying.ticker] = null;
    }
  });

  // Calculate the worstOf value
  const validValues = Object.values(values).filter(v => v !== null);
  values.worstOf = validValues.length > 0 ? Math.min(...validValues) : null;

  return values;
}

// Example function to get closing price for a specific date
function getClosingPriceForDate(eodTicker, dateString) {
  // Implement the logic to fetch the closing price from your data source
  // This could be a database query, API call, etc.
  // For example:
  const historicalData = Historical.findOne({ eodTicker });
  if (!historicalData || !historicalData.data) {
    console.warn(`No historical data found for ${eodTicker}`);
    return undefined;
  }

  const dataPoint = historicalData.data.find(d => {
    const dataDate = new Date(d.date);
    return dataDate.toISOString().split('T')[0] === dateString;
  });

  return dataPoint ? dataPoint.close : undefined;
}

Template.phoenix.events({
  'click #exportPDF': async function(event, template) {
    event.preventDefault();
    template.pdfLoading.set(true);

    const product = Template.currentData();
    
    // Get the chart canvas and temporarily invert colors
    const chartCanvas = document.getElementById('productChart');
    const ctx = chartCanvas.getContext('2d');
    
    // Save the current composite operation
    const originalOperation = ctx.globalCompositeOperation;
    
    // Invert colors
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, chartCanvas.width, chartCanvas.height);
    
    // Capture the inverted chart
    const chartImage = chartCanvas.toDataURL('image/png');
    
    // Restore original colors
    ctx.globalCompositeOperation = originalOperation;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, chartCanvas.width, chartCanvas.height);
    chartInstance.draw(); // Redraw the original chart

    const printHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Product Details - ${product.genericData.ISINCode}</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        <style>
          body { 
            font-family: 'Segoe UI', Arial, sans-serif; 
            padding: 20px;
            color: #2d353c;
            line-height: 1.4;
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 30px;
            padding-bottom: 15px;
            border-bottom: 2px solid #2d353c;
          }
          .header img {
            height: 40px;
          }
          .header-title {
            font-size: 24px;
            font-weight: 600;
          }
          .card { 
            position: relative;
            padding: 15px; 
            margin-bottom: 20px;
            background: #fff;
            border: 1px solid rgba(0,0,0,.15);
            box-shadow: 0 2px 4px rgba(0,0,0,.05);
            border-radius: 4px;
          }
          .heading { 
            font-size: 16px;
            font-weight: bold; 
            margin-bottom: 15px;
            color: #2d353c;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .data-item { 
            display: flex;
            margin-bottom: 8px;
            padding: 8px;
            border-bottom: 1px solid rgba(0,0,0,.05);
          }
          .data-label { 
            width: 200px;
            color: #5e6e82;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          table { 
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0;
            background: white;
          }
          th, td { 
            padding: 8px;
            text-align: center;
            border: 1px solid #e5e9f2;
            font-size: 12px;
          }
          th { 
            background: #f9fafc;
            font-weight: 600;
            color: #2d353c;
          }
          .badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 500;
          }
          .badge-success {
            background: #ccf3e6;
            color: #0f5132;
          }
          .badge-danger {
            background: #fde8e8;
            color: #981b1b;
          }
          .row {
            display: flex;
            margin: 0 -10px;
            gap: 20px;
          }
          .col-6 {
            flex: 0 0 calc(50% - 10px);
            min-width: 0;
          }
          .features-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .feature-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px;
            border-bottom: 1px solid rgba(0,0,0,.05);
          }
          .chart-img { 
            width: 100%; 
            max-height: 400px;
            object-fit: contain;
          }
          .page-break-before {
            page-break-before: always;
          }
          .company-logo {
            max-width: 150px;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="header-title">
            <i class="fas fa-file-alt"></i>
            Product Report
          </div>
          <img src="${COMPANY_LOGO}" alt="Company Logo" class="company-logo">
        </div>

        <div class="row">
          <div class="col-6">
            <div class="card">
              <div class="heading">
                <i class="fas fa-info-circle"></i>
                Product Details
              </div>
              <div class="data-item">
                <span class="data-label">Product Name</span>
                <span class="data-value">${product.genericData.name}</span>
              </div>
              <div class="data-item">
                <span class="data-label">ISIN Code</span>
                <span class="data-value">${product.genericData.ISINCode}</span>
              </div>
              <div class="data-item">
                <span class="data-label">Currency</span>
                <span class="data-value">${product.genericData.currency}</span>
              </div>
              <div class="data-item">
                <span class="data-label">Issuer</span>
                <span class="data-value">${product.genericData.issuer}</span>
              </div>
              <div class="data-item">
                <span class="data-label">Settlement Type</span>
                <span class="data-value">${product.genericData.settlementType}</span>
              </div>
              <div class="data-item">
                <span class="data-label">Settlement T+</span>
                <span class="data-value">${product.genericData.settlementTx}</span>
              </div>
              <div class="data-item">
                <span class="data-label">Trade Date</span>
                <span class="data-value">${new Date(product.genericData.tradeDate).toLocaleDateString()}</span>
              </div>
              <div class="data-item">
                <span class="data-label">Payment Date</span>
                <span class="data-value">${new Date(product.genericData.paymentDate).toLocaleDateString()}</span>
              </div>
              <div class="data-item">
                <span class="data-label">Final Observation</span>
                <span class="data-value">${new Date(product.genericData.finalObservation).toLocaleDateString()}</span>
              </div>
              <div class="data-item">
                <span class="data-label">Maturity Date</span>
                <span class="data-value">${new Date(product.genericData.maturityDate).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
          <div class="col-6">
            <div class="card">
              <div class="heading">
                <i class="fas fa-cogs"></i>
                Features
              </div>
              <div class="features-grid">
                <div class="feature-item">
                  <span class="data-label">Memory Coupon</span>
                  <span class="data-value">${product.features.memoryCoupon ? '✓' : '✗'}</span>
                </div>
                <div class="feature-item">
                  <span class="data-label">Memory Autocall</span>
                  <span class="data-value">${product.features.memoryAutocall ? '✓' : '✗'}</span>
                </div>
                <div class="feature-item">
                  <span class="data-label">One Star</span>
                  <span class="data-value">${product.features.oneStar ? '✓' : '✗'}</span>
                </div>
                <div class="feature-item">
                  <span class="data-label">Low Strike</span>
                  <span class="data-value">${product.features.lowStrike ? '✓' : '✗'}</span>
                </div>
                <div class="feature-item">
                  <span class="data-label">Autocall Step-down</span>
                  <span class="data-value">${product.features.autocallStepdown ? '✓' : '✗'}</span>
                </div>
                <div class="feature-item">
                  <span class="data-label">Jump</span>
                  <span class="data-value">${product.features.jump ? '✓' : '✗'}</span>
                </div>
                <div class="feature-item">
                  <span class="data-label">Coupon Barrier</span>
                  <span class="data-value">${product.features.couponBarrier}%</span>
                </div>
                <div class="feature-item">
                  <span class="data-label">Capital Protection</span>
                  <span class="data-value">${product.features.capitalProtectionBarrier}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="heading">
            <i class="fas fa-chart-line"></i>
            Underlyings
          </div>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Ticker</th>
                <th>Initial Level</th>
                <th>Current Level</th>
                <th>Performance</th>
                <th>Distance to Barrier</th>
              </tr>
            </thead>
            <tbody>
              ${product.underlyings.map(u => `
                <tr>
                  <td>${u.name}</td>
                  <td>${u.ticker}</td>
                  <td>${u.initialReferenceLevel}</td>
                  <td>${u.lastPriceInfo?.price || '-'}</td>
                  <td>${u.lastPriceInfo?.performance?.toFixed(2) || '-'}%</td>
                  <td>${u.lastPriceInfo?.distanceToBarrier?.toFixed(2) || '-'}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="card-arrow">
            <div class="card-arrow-top-left"></div>
            <div class="card-arrow-top-right"></div>
            <div class="card-arrow-bottom-left"></div>
            <div class="card-arrow-bottom-right"></div>
          </div>
        </div>

        <div class="card page-break-before">
          <div class="heading">
            <i class="fas fa-calendar-check"></i>
            Observations
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Observation Date</th>
                <th>Payment Date</th>
                <th>Coupon Barrier</th>
                <th>Autocall Level</th>
                <th>Worst Performing</th>
                <th>Worst-of Performance</th>
                <th>Coupon Paid</th>
                <th>Autocalled</th>
                <th>Newly Locked</th>
                <th>All Locked</th>
              </tr>
            </thead>
            <tbody>
              ${(product.observationDates || []).map((obs, index) => {
                // Get observation data from observationsTable
                const obsResult = product.observationsTable?.[index] || {};
                
                // Safely get values with defaults and ensure numbers
                const autocallLevel = obs.autocallLevel ? Number(obs.autocallLevel) : null;
                const couponBarrierLevel = obs.couponBarrierLevel ? Number(obs.couponBarrierLevel) : 70.00;
                const worstPerformance = obsResult.worstPerformance ? Number(obsResult.worstPerformance) : null;
                const couponPerPeriod = obsResult.couponPerPeriod ? Number(obsResult.couponPerPeriod) : null;
                
                return `
                <tr>
                  <td>${index + 1}</td>
                  <td>${new Date(obs.observationDate).toLocaleDateString()}</td>
                  <td>${new Date(obs.paymentDate).toLocaleDateString()}</td>
                  <td>${couponBarrierLevel.toFixed(2)}%</td>
                  <td>${autocallLevel ? autocallLevel.toFixed(2) + '%' : '-'}</td>
                  <td>${obsResult.worstPerformingUnderlying || '-'}</td>
                  <td>${worstPerformance !== null && !isNaN(worstPerformance) ? 
                    `<span style="color: ${worstPerformance >= 0 ? '#155724' : '#721c24'}">
                      ${worstPerformance.toFixed(2)}%
                    </span>` : 
                    '-'}</td>
                  <td>${obsResult.couponPaid && couponPerPeriod !== null && !isNaN(couponPerPeriod) ? 
                    `<span class="badge badge-success">${couponPerPeriod.toFixed(2)}%</span>` : 
                    '-'}</td>
                  <td>${obsResult.autocalled ? 
                    `<span class="badge badge-success">Yes</span>` : 
                    `<span class="badge badge-danger">No</span>`}</td>
                  <td>${obsResult.newlyLockedStocks?.join(', ') || '-'}</td>
                  <td>${obsResult.allLockedStocks?.join(', ') || '-'}</td>
                </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          <div class="card-arrow">
            <div class="card-arrow-top-left"></div>
            <div class="card-arrow-top-right"></div>
            <div class="card-arrow-bottom-left"></div>
            <div class="card-arrow-bottom-right"></div>
          </div>
        </div>

        <div class="card page-break-before">
          <div class="heading">
            <i class="fas fa-chart-area"></i>
            Performance Chart
          </div>
          <img src="${chartImage}" class="chart-img" alt="Performance Chart">
          <div class="card-arrow">
            <div class="card-arrow-top-left"></div>
            <div class="card-arrow-top-right"></div>
            <div class="card-arrow-bottom-left"></div>
            <div class="card-arrow-bottom-right"></div>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const printWindow = window.open('', '_blank');
      printWindow.document.write(printHTML);
      printWindow.document.close();
      
      // Print after a short delay to ensure image is loaded
      setTimeout(() => {
        printWindow.print();
      }, 500);

    } catch (err) {
      console.error('Error creating printable version:', err);
      } finally {
        template.pdfLoading.set(false);
      }
  }
});

Template.phoenixTemplate.onCreated(function() {
  this.searchResults = new ReactiveVar([]);
});

Template.phoenixTemplate.events({
  'input .ticker-search'(event, template) {
    const searchTerm = event.target.value.trim();
    const resultsContainer = event.target.parentElement.querySelector('.ticker-search-results');
    
    if (searchTerm.length < 2) {
      resultsContainer.classList.add('d-none');
      template.searchResults.set([]);
      return;
    }

    Meteor.call('searchTickers', searchTerm, (error, results) => {
      if (error) {
        console.error('Error searching tickers:', error);
        return;
      }
      
      template.searchResults.set(results);
      resultsContainer.classList.remove('d-none');
    });
  },

  'click .ticker-result-item'(event, template) {
    const selectedText = event.target.textContent;
    const row = event.target.closest('tr');
    const inputField = row.querySelector('.ticker-search');
    inputField.value = selectedText;
    
    // Update other fields in the row based on selected ticker
    // ...

    // Hide results
    event.target.closest('.ticker-search-results').classList.add('d-none');
    template.searchResults.set([]);
  },

  'blur .ticker-search'(event, template) {
    // Delay hiding to allow click event to fire
    setTimeout(() => {
      event.target.parentElement.querySelector('.ticker-search-results').classList.add('d-none');
      template.searchResults.set([]);
    }, 200);
  }
});

Template.phoenixTemplate.helpers({
  searchResults() {
    return Template.instance().searchResults.get();
  }
});
