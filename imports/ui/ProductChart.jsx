import React, { useRef, useEffect } from 'react';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LineController,
  CategoryScale,
  LinearScale,
  TimeScale,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation';

// Register Chart.js components
ChartJS.register(
  LineElement,
  PointElement,
  LineController,
  CategoryScale,
  LinearScale,
  TimeScale,
  Title,
  Tooltip,
  Legend,
  Filler,
  annotationPlugin
);

// Helper functions for date handling
const formatDateForDisplay = (dateStr) => {
  if (!dateStr) return '';
  
  try {
    // Handle various date formats
    let date;
    if (typeof dateStr === 'string') {
      // Try parsing different formats
      if (dateStr.includes('-')) {
        date = new Date(dateStr);
      } else if (dateStr.includes('/')) {
        date = new Date(dateStr);
      } else {
        // Fallback: return as is if it's already formatted
        return dateStr;
      }
    } else {
      date = new Date(dateStr);
    }
    
    if (isNaN(date.getTime())) {
      return dateStr?.toString() || '';
    }
    
    // Format as DD/MM/YYYY for display
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    
    return `${day}/${month}/${year}`;
  } catch (error) {
    return dateStr?.toString() || '';
  }
};

const isDateMatch = (label, targetDate) => {
  if (!label || !targetDate) return false;
  
  // Convert both to comparable strings
  const labelStr = typeof label === 'string' ? label : label?.toString();
  const targetStr = typeof targetDate === 'string' ? targetDate : targetDate?.toString();
  
  if (!labelStr || !targetStr) return false;
  
  // Direct string match
  if (labelStr === targetStr) return true;
  
  // Try parsing both as dates and comparing
  try {
    const labelDate = new Date(labelStr);
    const targetDateObj = new Date(targetStr);
    
    if (!isNaN(labelDate.getTime()) && !isNaN(targetDateObj.getTime())) {
      // Compare dates (same day)
      return labelDate.toDateString() === targetDateObj.toDateString();
    }
  } catch (error) {
    // Fall back to string comparison
  }
  
  // Partial string match
  return labelStr.includes(targetStr) || targetStr.includes(labelStr);
};

const ProductChart = ({ chartData }) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!chartData) {
      return;
    }

    // Destroy previous chart instance if it exists
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Create new chart configuration
    const ctx = chartRef.current.getContext('2d');
    
    // Get base config, but sanitize any time-based configurations to avoid YYYY format issues
    let config = chartData.config || createDefaultChartConfig(chartData);
    
    console.log('Chart data summary:', {
      finalDate: chartData.finalDate,
      observationDates: chartData.observationDates?.length || 0,
      totalLabels: config.data?.labels?.length
    });
    
    // Calculate data range for better y-axis scaling
    let dataMin = Infinity;
    let dataMax = -Infinity;
    
    if (config.data?.datasets) {
      config.data.datasets.forEach(dataset => {
        if (dataset.data) {
          dataset.data.forEach(point => {
            const value = typeof point === 'object' ? point.y : point;
            if (typeof value === 'number' && !isNaN(value)) {
              dataMin = Math.min(dataMin, value);
              dataMax = Math.max(dataMax, value);
            }
          });
        }
      });
    }
    
    // Add 20% padding to the data range
    const range = dataMax - dataMin;
    const padding = range * 0.2;
    const adjustedMin = dataMin - padding;
    const adjustedMax = dataMax + padding;
    
    // Extract observation dates and final date for vertical lines
    const observationDates = [];
    let finalDate = null;
    
    // Look for observation dates in the chart data
    if (chartData.observationDates) {
      observationDates.push(...chartData.observationDates);
    }
    
    // Look for final/maturity date
    if (chartData.finalDate) {
      finalDate = chartData.finalDate;
    } else if (chartData.maturityDate) {
      finalDate = chartData.maturityDate;
    }
    
    // Get x-axis labels to find date positions
    const xLabels = config.data?.labels || [];
    
    // Use server-generated annotations only
    let annotations = {};
    
    if (config.options?.plugins?.annotation?.annotations) {
      annotations = { ...config.options.plugins.annotation.annotations };
      console.log('Using server-generated annotations:', Object.keys(annotations));
    } else {
      console.log('No server annotations found');
    }
    
    // Always override both x and y axis configurations
    config = {
      ...config,
      options: {
        ...config.options,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          ...config.options.plugins,
          title: {
            ...config.options.plugins?.title,
            color: '#ffffff',
            display: true
          },
          legend: {
            ...config.options.plugins?.legend,
            labels: {
              ...config.options.plugins?.legend?.labels,
              color: '#ffffff'
            }
          },
          annotation: {
            annotations: annotations,
            clip: false
          }
        },
        scales: {
          ...config.options.scales,
          x: {
            ...config.options.scales?.x,
            type: config.options.scales?.x?.type === 'time' ? 'category' : 'category',
            ticks: {
              ...config.options.scales?.x?.ticks,
              color: '#ffffff',
              maxRotation: 45,
              minRotation: 0,
              callback: function(value, index) {
                const labels = this.chart.data.labels;
                const currentLabel = labels[index];
                const totalLabels = labels.length;
                
                // Always show first and last
                if (index === 0) {
                  return `Trade Date\n${formatDateForDisplay(currentLabel)}`;
                }
                
                if (index === totalLabels - 1) {
                  return `Final Date\n${formatDateForDisplay(currentLabel)}`;
                }
                
                // Check if this label matches any observation dates
                const observationDates = chartData.observationDates || [];
                for (let i = 0; i < observationDates.length; i++) {
                  const obsDate = observationDates[i];
                  if (isDateMatch(currentLabel, obsDate)) {
                    // Check if this is the last observation
                    const isLastObs = i === observationDates.length - 1;
                    const label = isLastObs ? 'Final Observation' : `Obs ${i + 1}`;
                    return `${label}\n${formatDateForDisplay(obsDate)}`;
                  }
                }
                
                // Check if this label matches any coupon payment dates
                const couponDates = chartData.couponPaymentDates || [];
                for (let i = 0; i < couponDates.length; i++) {
                  const couponDate = couponDates[i];
                  if (isDateMatch(currentLabel, couponDate)) {
                    return `Coupon ${i + 1}\n${formatDateForDisplay(couponDate)}`;
                  }
                }
                
                // For intermediate points, show every 4th label to avoid crowding
                if (index % 4 === 0) {
                  return formatDateForDisplay(currentLabel);
                }
                
                return '';
              }
            },
            grid: {
              display: false
            },
            border: {
              display: true,
              color: '#ffffff',
              width: 2
            }
          },
          y: {
            ...config.options.scales?.y,
            type: 'linear',
            display: true,
            position: 'left',
            beginAtZero: false,
            grid: {
              display: false
            },
            border: {
              display: true,
              color: '#ffffff',
              width: 2
            },
            ticks: {
              ...config.options.scales?.y?.ticks,
              color: '#ffffff',
              maxTicksLimit: 8,
              callback: function(value) {
                return value.toFixed(1) + '%';
              }
            },
            // Use the afterDataLimits from chartDataGenerator for proper auto-scaling
            afterDataLimits: config.options.scales?.y?.afterDataLimits || function(scale) {
              const range = scale.max - scale.min;
              const padding = range * 0.1;
              scale.min = scale.min - padding;
              scale.max = scale.max + padding;
            }
          }
        }
      }
    };
    
    
    try {
      chartInstance.current = new ChartJS(ctx, config);
    } catch (error) {
      console.error('Error creating chart:', error);
      // Fallback: try with category scale if time scale fails
      if (error.message && (error.message.includes('YYYY') || error.message.includes('yyyy'))) {
        try {
          // Ensure canvas is clean before creating fallback chart
          if (chartInstance.current) {
            chartInstance.current.destroy();
            chartInstance.current = null;
          }
          
          const fallbackConfig = {
            ...config,
            options: {
              ...config.options,
              scales: {
                ...config.options.scales,
                x: {
                  type: 'category',
                  ticks: {
                    color: '#ffffff',
                    maxRotation: 45,
                    minRotation: 0,
                    callback: function(value, index) {
                      const totalLabels = this.chart.data.labels.length;
                      
                      // Show Initial at the beginning
                      if (index === 0) {
                        return 'Initial';
                      }
                      
                      // Show Final Date at the end
                      if (index === totalLabels - 1) {
                        return 'Final Date';
                      }
                      
                      // Show observations at fixed intervals based on where vertical lines should be
                      const observationDates = chartData.observationDates || [];
                      if (observationDates.length > 0) {
                        // Calculate approximate intervals for observations
                        const approxInterval = Math.floor((totalLabels - 2) / (observationDates.length + 1));
                        
                        for (let i = 0; i < observationDates.length; i++) {
                          const expectedIndex = (i + 1) * approxInterval;
                          // Show label if we're close to the expected position (within 5 indices)
                          if (Math.abs(index - expectedIndex) <= 5 && index > 0 && index < totalLabels - 1) {
                            return `Obs ${i + 1}`;
                          }
                        }
                      }
                      
                      return '';
                    }
                  },
                  grid: {
                    display: false
                  },
                  border: {
                    display: true,
                    color: '#ffffff',
                    width: 2
                  }
                }
              }
            }
          };
          chartInstance.current = new ChartJS(ctx, fallbackConfig);
          console.log('Successfully created fallback chart with category scale');
        } catch (fallbackError) {
          console.error('Fallback chart creation also failed:', fallbackError);
        }
      }
    }

    // Cleanup on unmount
    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [chartData]);

  // Helper function to create default chart configuration
  const createDefaultChartConfig = (data) => {
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark' || 
                       document.body.classList.contains('dark-mode');
    
    const textColor = '#ffffff';
    const gridColor = '#ffffff';
    const bgColor = 'transparent';
    
    return {
      type: 'line',
      data: data.data || {
        labels: [],
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          title: {
            display: true,
            text: data.title || 'Product Performance',
            color: textColor,
            font: {
              size: 16,
              weight: 'bold'
            }
          },
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: textColor,
              usePointStyle: true,
              padding: 15
            }
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: 'white',
            bodyColor: 'white',
            borderColor: gridColor,
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                if (context.parsed.y !== null) {
                  label += context.parsed.y.toFixed(2);
                  if (context.dataset.isPercentage) {
                    label += '%';
                  }
                }
                return label;
              }
            }
          },
          annotation: data.annotations || {}
        },
        scales: {
          x: {
            type: 'category',
            ticks: {
              color: textColor,
              maxRotation: 45,
              minRotation: 0,
              callback: function(value, index) {
                const label = this.getLabelForValue(value);
                // For default config, only show important dates if they're available
                if (data.observationDates || data.finalDate || data.maturityDate) {
                  const importantDates = [...(data.observationDates || [])];
                  if (data.finalDate) {
                    importantDates.push(data.finalDate);
                  } else if (data.maturityDate) {
                    importantDates.push(data.maturityDate);
                  }
                  
                  const isImportant = importantDates.some(date => {
                    const labelStr = typeof label === 'string' ? label : label?.toString();
                    const dateStr = typeof date === 'string' ? date : date?.toString();
                    return labelStr === dateStr || labelStr?.includes(dateStr) || dateStr?.includes(labelStr);
                  });
                  
                  return isImportant ? label : '';
                }
                // If no important dates are defined, show all labels
                return label;
              }
            },
            grid: {
              display: false
            },
            border: {
              display: true,
              color: '#ffffff',
              width: 2
            }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            beginAtZero: true,
            min: 0,
            grace: '5%',
            ticks: {
              color: textColor,
              callback: function(value) {
                return value.toFixed(2) + (this.chart.data.datasets[0]?.isPercentage ? '%' : '');
              }
            },
            grid: {
              display: false
            },
            border: {
              display: true,
              color: '#ffffff',
              width: 2
            }
          }
        }
      }
    };
  };

  if (!chartData) {
    return (
      <div style={{
        padding: '2rem',
        background: 'transparent',
        borderRadius: '8px',
        textAlign: 'center',
        color: 'rgba(255, 255, 255, 0.7)'
      }}>
        No chart data available
      </div>
    );
  }

  return (
    <div style={{
      width: '60%',
      height: '600px',
      position: 'relative',
      padding: '1rem',
      background: 'transparent',
      margin: '0 auto'
    }}>
      <canvas ref={chartRef}></canvas>
    </div>
  );
};

export default ProductChart;