import { Template } from 'meteor/templating';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation';
import html2pdf from 'html2pdf.js';

// Register all Chart.js components and plugins
Chart.register(...registerables, annotationPlugin);

const CHART_HEIGHT = 400;
const CHART_WIDTH = '100%';

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
    if (!product) return 0;

    // Calculate total coupons paid
    const totalCoupons = product.observationsTable
      .filter(obs => obs.couponPaid !== '-')
      .reduce((sum, obs) => sum + parseFloat(obs.couponPaid), 0);

    // Get current bid price (assuming it's stored in product.bidPrice)
    const bidPrice = product.bidPrice || 100; // Default to 100 if not available

    // Calculate P&L: (Current Bid Price + Total Coupons - Initial Investment) / Initial Investment
    return ((bidPrice + totalCoupons - 100) / 100) * 100;
  },

  newsLoading() {
    return Template.instance().newsLoading.get();
  },

  underlyingNews() {
    return Template.instance().underlyingNews.get();
  },

  truncateText(text, lines) {
    if (!text) return '';
    const sentences = text.split(/[.!?]+\s/);
    return sentences.slice(0, lines).join('. ') + '...';
  },

  isPdfLoading() {
    return Template.instance().pdfLoading.get();
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

    // Add memory autocall annotations
    if (product.features.memoryAutocall && product.observationsTable) {
      product.observationsTable.forEach((observation, index) => {
        if (observation.newlyLockedStocks && observation.newlyLockedStocks.length > 0 && new Date(observation.observationDate) <= endDate) {
          observation.newlyLockedStocks.forEach((ticker, tickerIndex) => {
            const dataPoint = filteredChart100.find(item => item.date === observation.observationDate);
            if (dataPoint) {
              const yValue = dataPoint.values[ticker];
              if (yValue !== undefined && yValue !== null) {
                console.log(`Adding memory autocall marker for ${ticker} on ${observation.observationDate} at value ${yValue}`);
                annotations[`lock${index}_${tickerIndex}`] = {
                  type: 'point',
                  xValue: new Date(observation.observationDate),
                  yValue: yValue,
                  backgroundColor: 'rgba(255, 165, 0, 0.8)',
                  borderColor: 'rgba(255, 165, 0, 1)',
                  borderWidth: 2,
                  radius: 8,
                  label: {
                    content: '\uf023',
                    enabled: true,
                    position: 'center',
                    font: {
                      family: "'Font Awesome 5 Free'",
                      size: 14,
                      weight: 'bold',
                      style: 'normal'
                    },
                    color: 'white'
                  }
                };
              } else {
                console.warn(`No valid y-value found for ${ticker} on ${observation.observationDate}`);
              }
            } else {
              console.warn(`No data point found for ${ticker} on ${observation.observationDate}`);
            }
          });
        }
      });
    }

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
            color: '#ffffff'
          },
          grid: {
            display: false
          },
          title: {
            display: true,
            text: 'Date',
            color: '#ffffff'
          }
        },
        y: {
          ticks: {
            color: '#ffffff'
          },
          grid: {
            display: false
          },
          title: {
            display: true,
            text: 'Value',
            color: '#ffffff'
          },
          min: Math.floor(Math.min(...datasets.flatMap(dataset => 
            dataset.data.map(point => point.y).filter(y => y !== null && y !== undefined)
          )) * 0.9),
          suggestedMax: 120
        }
      },
      plugins: {
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          titleColor: '#ffffff', // Set tooltip title color to white
          bodyColor: '#ffffff', // Set tooltip body text color to white
          backgroundColor: 'rgba(0, 0, 0, 0.7)' // Set tooltip background to a dark color for contrast
        },
        annotation: {
          annotations: {
            ...annotations,

            autocallLevel: {
              type: 'line',
              mode: 'horizontal',
              scaleID: 'y',
              value: filteredChart100[0].autocallLevel, // Use the first autocall level value
              borderColor: 'rgba(255, 215, 0, 0.7)', // Gold line for visibility
              borderWidth: 1,
              label: {
                content: 'Autocall Level',
                enabled: true,
                position: 'end',
                backgroundColor: 'rgba(255, 215, 0, 0.5)',
                color: '#ffffff',
                padding: 4
              }
            }
          }
        },
        legend: {
          display: true,  // Ensure the legend is displayed
        },

      },
      layout: {
        padding: {
          top: 20,
          right: 20,
          bottom: 20,
          left: 20
        }
      }
    };

    // Create or update the chart
    if (chartInstance) {
      console.log("Updating existing chart with datasets:", datasets);
      chartInstance.data.datasets = datasets;
      chartInstance.options = mergeChartOptions(chartInstance.options, chartOptions);
      chartInstance.update();
    } else {
      console.log("Creating new chart with datasets:", datasets);
      chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: datasets
        },
        options: chartOptions
      });
    }

    // Mark chart as drawn after render
    chartInstance.drawn = true;
  });

  // Fetch news for underlyings
  this.autorun(() => {
    const product = Template.currentData();
    if (!product || !product.underlyings) return;

    const tickers = product.underlyings
      .filter(u => u && u.ticker) // Filter out undefined or missing tickers
      .map(u => u.eodTicker || u.ticker); // Use eodTicker if available, fallback to ticker
    if (!tickers.length) return;

    console.log('Fetching news for tickers:', tickers);
    this.newsLoading.set(true);

    Meteor.call('getUnderlyingNews', tickers, (error, result) => {
      this.newsLoading.set(false);
      if (error) {
        console.error('Error fetching news:', error);
        this.underlyingNews.set([]);
      } else {
        // Sort news by date, most recent first
        const sortedNews = (result || []).sort((a, b) => 
          new Date(b.publishedAt) - new Date(a.publishedAt)
        ).map(news => ({
          ...news,
          url: news.url || '#', // Provide fallback URL
          linkText: news.url ? (news.url.includes('twitter.com') ? 'View Tweet' : 'Read More') : 'No Link'
        }));
        this.underlyingNews.set(sortedNews);
      }
    });
  });
});

Template.phoenix.onCreated(function() {
  this.newsLoading = new ReactiveVar(false);
  this.underlyingNews = new ReactiveVar([]);
  this.pdfLoading = new ReactiveVar(false);
});

Template.phoenix.helpers({
  newsLoading() {
    return Template.instance().newsLoading.get();
  },
  underlyingNews() {
    return Template.instance().underlyingNews.get();
  },
  truncateText(text, lines) {
    if (!text) return '';
    const sentences = text.split(/[.!?]+\s/);
    return sentences.slice(0, lines).join('. ') + '...';
  },
  isPdfLoading() {
    return Template.instance().pdfLoading.get();
  },
  // ... existing helpers ...
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
  'click #exportPDF'(event, template) {
    event.preventDefault();
    template.pdfLoading.set(true);

    // Function to wait for chart rendering
    const waitForChart = () => {
      return new Promise(resolve => {
        const checkChart = () => {
          const canvas = document.querySelector('#productChart');
          if (canvas && chartInstance && chartInstance.drawn) {
            setTimeout(resolve, 500); // Give extra time for final render
          } else {
            setTimeout(checkChart, 100);
          }
        };
        checkChart();
      });
    };

    const generatePDF = async () => {
      try {
        // Wait for chart to be fully rendered
        await waitForChart();

        const element = document.querySelector('#content');
        const clone = element.cloneNode(true);
        
        // Set fixed width for PDF content
        clone.style.width = '800px';
        clone.style.margin = '0 auto';
        clone.style.padding = '20px';
        
        // Special handling for chart
        const originalCanvas = document.querySelector('#productChart');
        const clonedChartContainer = clone.querySelector('#productChartContainer');
        if (originalCanvas && clonedChartContainer) {
          const chartImage = originalCanvas.toDataURL('image/png', 1.0);
          const img = document.createElement('img');
          img.src = chartImage;
          img.style.width = '100%';
          img.style.height = '400px';
          img.style.backgroundColor = 'white';
          clonedChartContainer.innerHTML = '';
          clonedChartContainer.appendChild(img);
        }

        // Rest of your existing code...
        const cards = clone.querySelectorAll('.card');
        cards.forEach(card => {
          card.style.display = 'block';
          card.style.pageBreakInside = 'avoid';
          card.style.marginBottom = '20px';
          card.style.backgroundColor = '#ffffff';
          card.style.width = '100%';
        });

        const opt = {
          margin: [20, 20],
          filename: `${template.data.genericData.ISINCode}_details.pdf`,
          image: { type: 'jpeg', quality: 1 },
          html2canvas: { 
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: true,
            windowWidth: 800,
            onclone: function(clonedDoc) {
              const style = clonedDoc.createElement('style');
              style.textContent = `
                /* Your existing styles... */
                
                /* Specific chart styling */
                #productChartContainer {
                  background-color: white !important;
                  margin: 20px 0 !important;
                  padding: 10px !important;
                }
                #productChartContainer img {
                  width: 100% !important;
                  height: 400px !important;
                  object-fit: contain !important;
                }
              `;
              clonedDoc.head.appendChild(style);

              // Your existing color conversion code...
            }
          },
          jsPDF: { 
            unit: 'pt', 
            format: 'a4', 
            orientation: 'portrait',
            compress: true
          },
          pagebreak: { 
            mode: ['avoid-all', 'css', 'legacy'],
            before: '.card'
          }
        };

        await html2pdf().set(opt).from(clone).save();
      } catch (error) {
        console.error('Error generating PDF:', error);
      } finally {
        template.pdfLoading.set(false);
      }
    };

    // Start the PDF generation
    generatePDF();
  }
});
