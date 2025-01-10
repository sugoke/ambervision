import { Template } from 'meteor/templating';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation';

// Register all Chart.js components and plugins
Chart.register(...registerables, annotationPlugin);

let chartInstance = null;

const pastelColors = [
  'rgba(255, 182, 193, 1)',    // Light pink
  'rgba(176, 224, 230, 1)',    // Powder blue
  'rgba(255, 218, 185, 1)',    // Peach
  'rgba(152, 251, 152, 1)',    // Pale green
  'rgba(238, 130, 238, 1)',    // Violet
  'rgba(135, 206, 235, 1)',    // Sky blue
  'rgba(255, 160, 122, 1)',    // Light salmon
  'rgba(221, 160, 221, 1)',    // Plum
];

Template.orion.onRendered(function() {
  console.log('Orion template rendered');

  // Wait for DOM to be ready
  Tracker.afterFlush(() => {
    this.autorun(() => {
      const product = Template.currentData();
      console.log('Product data:', product);

      if (!product || !product.chart100) {
        console.log("No product or chart100 data available");
        return;
      }

      const ctx = document.getElementById('productChart');
      if (!ctx) {
        console.error("Canvas element not found");
        return;
      }

      // Destroy existing chart if it exists
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }

      const chart100 = product.chart100;
      console.log("Processing chart100 data:", chart100[0]);

      // Get underlying keys
      const underlyingKeys = Object.keys(chart100[0].values);
      console.log("Underlying keys:", underlyingKeys);

      // Sort the chart100 data by date
      chart100.sort((a, b) => new Date(a.date) - new Date(b.date));

      // Extract datasets for each underlying
      const datasets = underlyingKeys.map((key, index) => ({
        label: key,
        data: chart100.map(item => ({ 
          x: new Date(item.date), 
          y: item.values[key] 
        })),
        borderColor: pastelColors[index % pastelColors.length],
        backgroundColor: pastelColors[index % pastelColors.length],
        fill: false,
        pointRadius: 0,
        borderWidth: 2
      }));

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

      // Add dataset for upper barrier
      datasets.push({
        label: 'Upper Barrier',
        data: chart100.map(item => ({ 
          x: new Date(item.date), 
          y: item.upperBarrier 
        })),
        borderColor: 'rgba(255, 99, 132, 0.7)',
        backgroundColor: 'transparent',  // No fill
        fill: false,                    // Disable fill
        pointRadius: 0,
        borderWidth: 2,
        borderDash: [5, 5]
      });

      // Calculate the minimum value across all datasets
      const allValues = datasets.flatMap(dataset => 
        dataset.data.map(point => point.y)
      ).filter(value => value !== null && !isNaN(value));

      const minValue = Math.min(...allValues);
      const maxValue = Math.max(...allValues);

      // Set the y-axis min to 10 below the lowest point
      const yMin = Math.floor(minValue - 5);
      const yMax = Math.ceil(maxValue + 5); // Add some padding to the top as well

      // Find touch points for annotations
      const annotations = {};
      underlyingKeys.forEach((ticker, index) => {
        const dataset = datasets[index];
        const upperBarrierValue = product.features.upperBarrier + 100;
        
        // Find the first point where the line crosses the barrier
        const touchPoint = dataset.data.find(point => point.y >= upperBarrierValue);
        
        if (touchPoint) {
          annotations[`touch-${ticker}`] = {
            type: 'point',
            xValue: touchPoint.x,
            yValue: touchPoint.y,
            backgroundColor: 'rgba(255, 99, 132, 1)',
            borderColor: 'white',
            borderWidth: 2,
            radius: 6,
            label: {
              display: true,
              content: `${ticker} touched`,
              position: 'top',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: '#fff',
              padding: 4
            }
          };
        }
      });

      const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'month'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            },
            ticks: {
              color: '#ffffff'
            }
          },
          y: {
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            },
            ticks: {
              color: '#ffffff'
            },
            min: yMin,
            max: yMax
          }
        },
        plugins: {
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            backgroundColor: 'rgba(0, 0, 0, 0.7)'
          },
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#ffffff',
              padding: 10
            }
          },
          annotation: {
            annotations: annotations
          }
        }
      };

      console.log("Creating new chart with datasets:", datasets);

      // Create new chart
      chartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: chartOptions
      });
    });
  });
});

Template.orion.onDestroyed(function() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
});
