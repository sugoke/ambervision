import { Chart } from 'chart.js/auto';
import moment from 'moment';
import { Router } from 'meteor/iron:router';

export function renderBubbleChart(riskData, canvasId) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) {
    console.error('Canvas element not found');
    return;
  }

  // Clear existing chart
  const existingChart = Chart.getChart(ctx);
  if (existingChart) {
    existingChart.destroy();
  }

  // More granular gradient colors based on distance to barrier
  const getColorFromDistance = (distance) => {
    if (distance <= -20) {
      return 'rgba(139, 0, 0, 0.7)';      // Dark red
    }
    if (distance <= -10) {
      return 'rgba(178, 34, 34, 0.7)';    // Firebrick red
    }
    if (distance <= 0) {
      return 'rgba(220, 20, 60, 0.7)';    // Crimson
    }
    if (distance < 5) {
      return 'rgba(255, 69, 0, 0.7)';     // Red-orange
    }
    if (distance < 10) {
      return 'rgba(255, 140, 0, 0.7)';    // Dark orange
    }
    if (distance < 15) {
      return 'rgba(255, 165, 0, 0.7)';    // Orange
    }
    if (distance < 20) {
      return 'rgba(255, 215, 0, 0.7)';    // Gold
    }
    if (distance < 30) {
      return 'rgba(154, 205, 50, 0.7)';   // Yellow-green
    }
    if (distance < 40) {
      return 'rgba(34, 139, 34, 0.7)';    // Forest green
    }
    return 'rgba(0, 100, 0, 0.7)';        // Dark green
  };

  const getBorderColor = (distance) => {
    if (distance <= -20) {
      return 'rgba(139, 0, 0, 1)';      // Dark red
    }
    if (distance <= -10) {
      return 'rgba(178, 34, 34, 1)';    // Firebrick red
    }
    if (distance <= 0) {
      return 'rgba(220, 20, 60, 1)';    // Crimson
    }
    if (distance < 5) {
      return 'rgba(255, 69, 0, 1)';     // Red-orange
    }
    if (distance < 10) {
      return 'rgba(255, 140, 0, 1)';    // Dark orange
    }
    if (distance < 15) {
      return 'rgba(255, 165, 0, 1)';    // Orange
    }
    if (distance < 20) {
      return 'rgba(255, 215, 0, 1)';    // Gold
    }
    if (distance < 30) {
      return 'rgba(154, 205, 50, 1)';   // Yellow-green
    }
    if (distance < 40) {
      return 'rgba(34, 139, 34, 1)';    // Forest green
    }
    return 'rgba(0, 100, 0, 1)';        // Dark green
  };

  const now = moment();
  
  const chartData = riskData
    .filter(risk => risk.performance !== undefined && 
                   risk.distanceToBarrier !== undefined && 
                   risk.maturityDate)
    .map(risk => {
      const daysToMaturity = moment(risk.maturityDate).diff(now, 'days');
      return {
        x: daysToMaturity,
        y: risk.distanceToBarrier,
        r: 12, // Slightly larger bubbles
        ISINCode: risk.ISINCode,
        underlyingName: risk.underlyingName,
        performance: risk.performance,
        distanceToBarrier: risk.distanceToBarrier,
        maturityDate: risk.maturityDate
      };
    });

  const chart = new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [{
        label: 'Risk Data',
        data: chartData,
        backgroundColor: chartData.map(item => getColorFromDistance(item.distanceToBarrier)),
        borderColor: chartData.map(item => getBorderColor(item.distanceToBarrier)),
        borderWidth: 2,
        hoverBorderWidth: 3,
        hoverRadius: 15
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1000,
        easing: 'easeInOutQuart'
      },
      elements: {
        point: {
          shadowOffsetX: 1,
          shadowOffsetY: 1,
          shadowBlur: 5,
          shadowColor: 'rgba(0, 0, 0, 0.2)',
        }
      },
      plugins: {
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          titleColor: '#666',
          bodyColor: '#666',
          titleFont: {
            size: 14,
            weight: 'bold'
          },
          padding: 12,
          borderColor: 'rgba(200, 200, 200, 0.9)',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              const item = context.raw;
              return [
                `Stock: ${item.underlyingName}`,
                `ISIN: ${item.ISINCode}`,
                `Days to Maturity: ${item.x}`,
                `Performance: ${item.performance.toFixed(2)}%`,
                `Distance to Barrier: ${item.distanceToBarrier.toFixed(2)}%`,
                `Maturity: ${moment(item.maturityDate).format('DD.MM.YYYY')}`
              ];
            }
          }
        },
        legend: {
          display: false
        },
        annotation: {
          annotations: {
            line1: {
              type: 'line',
              yMin: 0,
              yMax: 0,
              borderColor: 'rgba(255, 255, 255, 1)',
              borderWidth: 3,
              label: {
                enabled: true,
                content: '0%',
                position: 'start',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                color: '#fff',
                padding: 5
              }
            },
            line2: {
              type: 'line',
              yMin: 100,
              yMax: 100,
              borderColor: 'rgba(120, 120, 120, 0.8)',
              borderWidth: 2,
              label: {
                enabled: true,
                content: '100%',
                position: 'start',
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                color: '#666',
                padding: 5
              }
            }
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Days to Maturity',
            font: {
              size: 11,
              weight: 'normal'
            },
            color: '#ccc' // Very light gray for axis title
          },
          grid: {
            display: true,
            color: 'rgba(200, 200, 200, 0.2)',
            borderColor: 'rgba(200, 200, 200, 0.4)'
          },
          ticks: {
            color: '#ccc', // Very light gray for numbers
            font: {
              size: 10
            }
          }
        },
        y: {
          title: {
            display: true,
            text: 'Distance to Barrier (%)',
            font: {
              size: 11,
              weight: 'normal'
            },
            color: '#ccc' // Very light gray for axis title
          },
          grid: {
            display: true,
            color: 'rgba(200, 200, 200, 0.2)',
            borderColor: 'rgba(200, 200, 200, 0.4)'
          },
          ticks: {
            callback: value => `${value.toFixed(1)}%`,
            color: '#ccc', // Very light gray for numbers
            font: {
              size: 10
            }
          }
        }
      },
      onClick: (event, elements) => {
        if (elements && elements.length > 0) {
          const dataPoint = chartData[elements[0].index];
          if (dataPoint && dataPoint.ISINCode) {
            Router.go('productDetails', {}, { 
              query: { isin: dataPoint.ISINCode }
            });
          }
        }
      },
      onHover: (event, elements) => {
        event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      }
    },
    plugins: [{
      beforeDraw: function(chart) {
        const ctx = chart.ctx;
        const yAxis = chart.scales.y;
        const xAxis = chart.scales.x;
        
        // Create gradient from 0 to the bottom of the chart area
        const gradient = ctx.createLinearGradient(
          0, 
          yAxis.getPixelForValue(0),
          0, 
          yAxis.bottom
        );
        gradient.addColorStop(0, 'rgba(240, 240, 240, 0.1)');
        gradient.addColorStop(1, 'rgba(200, 200, 200, 0.15)');
        
        // Fill area from 0 to bottom of chart
        ctx.fillStyle = gradient;
        ctx.fillRect(
          xAxis.left,
          yAxis.getPixelForValue(0),
          xAxis.right - xAxis.left,
          yAxis.bottom - yAxis.getPixelForValue(0)
        );
      }
    }]
  });

  return chart;
}
