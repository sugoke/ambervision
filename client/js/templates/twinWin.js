import { Template } from 'meteor/templating';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation';

import '../../html/templates/twinWin.html';

Chart.register(...registerables, annotationPlugin);

Template.twinWin.onRendered(function() {
  this.autorun(() => {

    
    const product = Template.currentData();

    if (!product || !product.chart100 || !product.chart100[0] || !product.chart100[0].data) {
      return;
    }

    const ctx = document.getElementById('productChart');
    if (!ctx) {
      return;
    }

    const chartData = product.chart100[0].data;

    if (chartData && chartData.length > 0) {
      const datasets = [
        {
          label: 'Value',
          data: chartData.map(item => ({ x: new Date(item.date), y: item.value })),
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          fill: false,
          tension: 0.1,
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: 'Down Barrier',
          data: chartData.map(item => ({ x: new Date(item.date), y: item.downBarrier })),
          borderColor: 'rgba(255, 99, 132, 0.7)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          fill: false,
          borderDash: [5, 5],
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: 'Up Barrier',
          data: chartData.map(item => ({ x: new Date(item.date), y: item.upBarrier })),
          borderColor: 'rgba(54, 162, 235, 0.7)',
          backgroundColor: 'rgba(54, 162, 235, 0.2)',
          fill: false,
          borderDash: [5, 5],
          pointRadius: 0,
          borderWidth: 2
        }
      ];

      new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            intersect: false,
            mode: 'index',
          },
          scales: {
            x: {
              type: 'time',
              time: {
                unit: 'day',
                displayFormats: {
                  day: 'MMM d'
                }
              },
              title: {
                display: true,
                text: 'Date'
              }
            },
            y: {
              title: {
                display: true,
                text: 'Value'
              }
            }
          },
          plugins: {
            legend: {
              position: 'top',
            },
            tooltip: {
              mode: 'index',
              intersect: false,
            },
            title: {
              display: true,
              text: 'Product Performance'
            }
          }
        }
      });
    }
  });
});

function getRandomColor(alpha = 1) {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ... existing code ...
