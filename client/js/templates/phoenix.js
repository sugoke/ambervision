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
    return Template.instance().newsLoading.get();
  },

  underlyingNews() {
    const news = Template.instance().underlyingNews.get();
    return news?.map(item => {
      // Parse date handling both ISO and UTC formats
      let date;
      try {
        // Try parsing the date string directly
        date = item.date ? new Date(item.date) : null;
        
        // If date is invalid, try parsing UTC timestamp
        if (isNaN(date)) {
          date = item.date ? new Date(item.date.replace(' ', 'T') + 'Z') : null;
        }
      } catch (e) {
        console.error('Date parsing error:', e);
        date = null;
      }

      return {
        ticker: item.ticker?.split('.')?.[0] || '',
        date: date ? date.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC'
        }) : 'N/A',
        title: item.title,
        text: item.content,
        source: 'EOD Historical Data',
        link: item.link
      };
    }) || [];
  },

  truncateText(text, lines = 2) {
    if (!text) return '';
    const words = text.split(' ');
    const avgWordsPerLine = 12;
    const maxWords = lines * avgWordsPerLine;
    if (words.length > maxWords) {
      return words.slice(0, maxWords).join(' ') + '...';
    }
    return text;
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
  },

  aiCommentary() {
    return Template.instance().aiCommentary.get();
  },

  isAiCommentaryLoading() {
    return Template.instance().isAiCommentaryLoading.get();
  }
});

let chartInstance = null;
let performanceChartInstance = null; // Added for underlyings performance bar chart

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

    // Sort the chart100 data by date
    chart100.sort((a, b) => normalizeDate(a.date) - normalizeDate(b.date));

    // Extract datasets for each underlying
    const datasets = [];

    // Get unique underlyings from first data point
    const firstPoint = chart100[0];
    const underlyings = Object.keys(firstPoint.values.reduce((acc, val) => {
      if (val.underlying !== 'worstOf') {
        acc[val.underlying] = true;
      }
      return acc;
    }, {}));

    // Create dataset for each underlying
    underlyings.forEach((underlying, index) => {
      datasets.push({
        label: underlying,
        data: chart100.map(item => ({
          x: new Date(item.date),
          y: item.values.find(v => v.underlying === underlying)?.value || null
        })),
        borderColor: pastelColors[index % pastelColors.length],
        backgroundColor: pastelColors[index % pastelColors.length],
        fill: false,
        pointRadius: 0,
        borderWidth: 2
      });
    });

    // Add dataset for worstOf
    datasets.unshift({
      label: 'Worst Performing',
      data: chart100.map(item => ({
        x: new Date(item.date),
        y: item.values.find(v => v.underlying === 'worstOf')?.value || null
      })),
      borderColor: 'rgba(255, 255, 0, 1)',
      backgroundColor: 'rgba(255, 255, 0, 0.2)',
      fill: false,
      pointRadius: 0,
      borderWidth: 1,
      borderDash: [5, 5],
      order: -1
    });

    // Add dataset for coupon barrier
    datasets.push({
      label: 'Coupon Barrier',
      data: chart100.map(item => ({
        x: new Date(item.date),
        y: item.couponBarrier || null
      })),
      borderColor: 'rgba(255, 99, 132, 0.7)',
      backgroundColor: 'rgba(255, 99, 132, 0.2)',
      fill: 'start',
      pointRadius: 0,
      borderWidth: 2,
      borderDash: [5, 5]
    });

    // Add dataset for initial level
    datasets.push({
      label: 'Initial Level',
      data: chart100.map(item => ({ 
        x: new Date(item.date), 
        y: 100 
      })),
      borderColor: 'rgba(255, 165, 0, 0.7)',
      backgroundColor: 'rgba(255, 165, 0, 0.2)',
      fill: false,
      pointRadius: 0,
      borderWidth: 2,
      borderDash: [5, 5]
    });

    // Add logging to debug the datasets
    console.log('Processed datasets:', datasets);
    console.log('Sample data points:', datasets.map(d => ({
      label: d.label,
      points: d.data.slice(0, 5)
    })));

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
          yValue = 100; // Fixed level
        } else if (dataset.label === 'Worst Performing') {
          yValue = item.values.find(v => v.underlying === 'worstOf')?.value || null;
        } else {
          yValue = item.values.find(v => v.underlying === dataset.label)?.value || null;
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
      // ... other annotations (e.g., observation lines) ...
    };

    // Extract x-axis values for vertical annotation lines
    const annotationXValues = Object.values(annotations)
      .filter(a => a.type === 'line' && a.scaleID === 'x' && a.value)
      .map(a => {
          const d = new Date(a.value);
          d.setHours(0, 0, 0, 0);
          return d.getTime();
      });

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
            y: dataPoint.values.find(v => v.underlying === ticker)?.value || null,
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

    // Calculate dynamic minimum and maximum y values across all datasets and add a margin of 5
    let calculatedMax = -Infinity;
    let calculatedMin = Infinity;
    datasets.forEach(dataset => {
      dataset.data.forEach(point => {
        if (point.y !== null) {
          if (point.y > calculatedMax) {
            calculatedMax = point.y;
          }
          if (point.y < calculatedMin) {
            calculatedMin = point.y;
          }
        }
      });
    });
    if (calculatedMax === -Infinity) calculatedMax = 0;
    if (calculatedMin === Infinity) calculatedMin = 0;
    const dynamicMax = calculatedMax + 5;
    const dynamicMin = calculatedMin - 5;

    // Create chart options with dynamic y-axis maximum
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
          min: tradeDate,
          max: endDate,
          grid: {
            display: false
          },
          ticks: {
            color: '#ffffff',
            callback: function(value, index, ticks) {
              // Get the default label for this tick
              const label = this.getLabelForValue(value);
              const tickDate = new Date(label);
              tickDate.setHours(0, 0, 0, 0);
              // Only display the label if it matches one of our annotation x values
              return annotationXValues.includes(tickDate.getTime()) ? label : '';
            }
          }
        },
        y: {
          min: dynamicMin,
          max: dynamicMax,
          grid: {
            display: false
          },
          ticks: {
            color: '#ffffff'
          }
        }
      },
      elements: {
        line: {
          tension: 0.4 // Makes lines smoother
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#ffffff'
          }
        },
        annotation: {
          annotations: annotations
        }
      }
    };

    // Create or update chart
    if (chartInstance) {
      chartInstance.destroy();
    }

    // Log the final data before creating chart
    console.log('Final datasets for chart:', {
      labels: datasets.map(d => d.label),
      dataPoints: datasets.map(d => d.data.length),
      sampleData: datasets.map(d => d.data.slice(0, 3))
    });
    
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: { 
        datasets: datasets.map(dataset => ({
          ...dataset,
          spanGaps: true, // Connects points across null values
          parsing: {
            xAxisKey: 'x',
            yAxisKey: 'y'
          }
        }))
      },
      options: chartOptions
    });

    // Create Performance Bar Chart for Underlyings
    const performanceCtx = document.getElementById('performanceChart');
    if (performanceCtx && product && product.underlyings) {
      const underlyingLabels = product.underlyings.map(u => u.ticker);
      const performanceData = product.underlyings.map(u => {
        return (u.lastPriceInfo && typeof u.lastPriceInfo.performance === 'number')
          ? u.lastPriceInfo.performance
          : 0;
      });
      
      let minPerf = Math.min(...performanceData);
      let maxPerf = Math.max(...performanceData);
      if (minPerf === maxPerf) {
        minPerf -= 1;
        maxPerf += 1;
      }
      
      function performanceColor(perf) {
        let ratio = (perf - minPerf) / (maxPerf - minPerf);
        if (ratio < 0) ratio = 0;
        if (ratio > 1) ratio = 1;
        // Interpolate from orange [255, 165, 0] (low performance)
        // to soft green [144, 238, 144] (high performance)
        const r = Math.round(255 * (1 - ratio) + 144 * ratio);
        const g = Math.round(165 * (1 - ratio) + 238 * ratio);
        const b = Math.round(0 * (1 - ratio) + 144 * ratio);
        return `rgb(${r}, ${g}, ${b})`;
      }
      
      const barColors = performanceData.map(p => performanceColor(p));
      
      const performanceChartData = {
        labels: underlyingLabels,
        datasets: [{
          label: 'Performance (%)',
          data: performanceData,
          backgroundColor: barColors,
        }]
      };
      
      const protectionLevel = (product.features && product.features.capitalProtectionBarrier) 
         ? Number(product.features.capitalProtectionBarrier) - 100 : null;
      
      const performanceChartOptions = {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: '#ffffff'
            }
          },
          x: {
            ticks: {
              color: '#ffffff'
            }
          }
        },
        plugins: {
          legend: {
            labels: {
              color: '#ffffff'
            }
          },
          annotation: {
            annotations: {
              zeroLine: {
                type: 'line',
                scaleID: 'y',
                value: 0,
                borderColor: 'rgba(255,255,255,0.7)',
                borderDash: [5, 5],
                borderWidth: 1,
                label: {
                  content: '0',
                  enabled: true,
                  position: 'end',
                  color: '#ffffff'
                }
              },
              protectionLine: protectionLevel !== null ? {
                type: 'line',
                scaleID: 'y',
                value: protectionLevel,
                borderColor: 'rgba(255,0,0,0.7)',
                borderDash: [5, 5],
                borderWidth: 1,
                label: {
                  content: 'Protection',
                  enabled: true,
                  position: 'end',
                  color: '#ffffff'
                }
              } : undefined
            }
          }
        }
      };
      
      if (performanceChartInstance) {
        performanceChartInstance.destroy();
      }
      
      performanceChartInstance = new Chart(performanceCtx, {
        type: 'bar',
        data: performanceChartData,
        options: performanceChartOptions
      });
    }

    // Log any errors
    chartInstance.options.onError = function(chart, err) {
      console.error('Chart.js error:', err);
    };
  });

  // Fetch news when template is rendered
  this.autorun(() => {
    const product = Template.currentData();
    if (product?.underlyings) {
      this.newsLoading.set(true);
      
      const tickers = product.underlyings
        .map(u => u.eodTicker)
        .filter(t => t && t.length > 0);

      if (tickers.length > 0) {
        Meteor.call('getUnderlyingNews', tickers, (error, result) => {
          this.newsLoading.set(false);
          if (error) {
            console.error('Error fetching news:', error);
          } else {
            this.underlyingNews.set(result);
          }
        });
      } else {
        this.newsLoading.set(false);
        this.underlyingNews.set([]);
      }
    }
  });

  // Generate initial AI commentary
  generateAiCommentary(this);
});

Template.phoenix.onCreated(function() {
  this.pdfLoading = new ReactiveVar(false);
  this.newsLoading = new ReactiveVar(false);
  this.underlyingNews = new ReactiveVar([]);
  this.aiCommentary = new ReactiveVar('');
  this.isAiCommentaryLoading = new ReactiveVar(false);

  this.autorun(() => {
    const data = Template.currentData();
    if (data?.underlyings) {
      this.newsLoading.set(true);
      
      const tickers = data.underlyings
        .map(u => u.eodTicker)
        .filter(t => t && t.length > 0);

      if (tickers.length > 0) {
        Meteor.call('getUnderlyingNews', tickers, (error, result) => {
          this.newsLoading.set(false);
          if (error) {
            console.error('Error fetching news:', error);
          } else {
            this.underlyingNews.set(result);
          }
        });
      } else {
        this.newsLoading.set(false);
        this.underlyingNews.set([]);
      }
    }
  });
});

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
  },

  'click #refreshAiCommentary'(event, template) {
    event.preventDefault();
    generateAiCommentary(template);
  }
});

function generateAiCommentary(template) {
  const product = Template.currentData();
  if (!product) return;

  template.isAiCommentaryLoading.set(true);

  const productData = {
    isin: product.genericData.ISINCode,
    name: product.genericData.name,
    status: product.status,
    underlyings: product.underlyings,
    features: product.features,
    observationsTable: product.observationsTable,
    totalCouponPaid: product.totalCouponPaid,
    maturityDate: product.genericData.maturityDate,
    news: template.underlyingNews.get()
  };

  const prompt = `Make a client friendly summary using all available information, with underlyings levels, explanation if related to some news, level compared to different barriers, time left till the end. Keep a positive vibe and don't blame the choice of underlyings. comment on the coupons paid.`;

  Meteor.call('getAiCommentary', productData, prompt, (error, result) => {
    template.isAiCommentaryLoading.set(false);
    if (error) {
      console.error('Error getting AI commentary:', error);
      template.aiCommentary.set('Unable to generate commentary at this time.');
    } else {
      template.aiCommentary.set(result);
    }
  });
}

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
