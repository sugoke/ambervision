/**
 * ChartDataBuilder - Main orchestrator for chart data generation
 * 
 * Orchestrates all chart data generation modules:
 * - DateRangeGenerator for x-axis date ranges
 * - MarketDataProcessor for underlying performance datasets
 * - BarrierDataProcessor for barrier level datasets
 * - EventExtractor for event data extraction
 * - AnnotationGenerator for chart annotations
 * 
 * ARCHITECTURE PRINCIPLE: All chart data is pre-calculated during report processing.
 * The UI never performs calculations - it only displays the pre-built chart object.
 */
import { DateRangeGenerator } from './DateRangeGenerator.js';
import { MarketDataProcessor } from './MarketDataProcessor.js';
import { BarrierDataProcessor } from './BarrierDataProcessor.js';
import { EventExtractor } from './EventExtractor.js';
import { AnnotationGenerator } from './AnnotationGenerator.js';

export class ChartDataBuilder {
  constructor() {
    this.version = '2.0.0';
    this.dateRangeGenerator = new DateRangeGenerator();
    this.marketDataProcessor = new MarketDataProcessor();
    this.barrierDataProcessor = new BarrierDataProcessor();
    this.eventExtractor = new EventExtractor();
    this.annotationGenerator = new AnnotationGenerator();
  }

  /**
   * Generate comprehensive chart data for a structured product
   * Creates a complete, self-contained chart object with all necessary data and configuration
   * @param {Object} product - Product configuration
   * @param {Object} evaluationResults - Evaluation results from rule engine
   * @param {Object} marketData - Market data context with prices and dates
   * @param {Object} options - Generation options (evaluationDate, etc.)
   * @returns {Promise<Object>} Complete chart data object for UI consumption
   */
  async generateChart(product, evaluationResults, marketData = null, options = {}) {
    try {
      const evaluationDate = new Date(options.evaluationDate || new Date());
      const today = new Date();
      
      // Generate date range (x-axis) - from initial date to final date
      const dateRange = this.dateRangeGenerator.generateDateRange(product, evaluationDate);
      
      // Generate rebased underlying performance datasets
      const underlyingData = await this.marketDataProcessor.generateRebasedUnderlyingDatasets(product, dateRange, marketData, evaluationDate);
      
      // Generate barrier level datasets
      const barrierData = this.barrierDataProcessor.generateBarrierDatasets(product, dateRange, evaluationResults);
      
      // Generate vertical line annotations for key dates
      const verticalAnnotations = this.annotationGenerator.generateVerticalAnnotations(product, evaluationResults, dateRange, evaluationDate, this.eventExtractor);
      
      // Generate event point annotations (coupons, autocalls, memory events)
      const eventAnnotations = this.annotationGenerator.generateEventPointAnnotations(product, evaluationResults, marketData, dateRange, this.eventExtractor);
      
      // Combine all datasets
      const allDatasets = [
        ...underlyingData.datasets,
        ...barrierData.datasets
      ];
      
      // Create complete Chart.js configuration with all styling and plugins
      const chartData = {
        // Chart.js configuration
        type: 'line',
        data: {
          labels: dateRange.labels,
          datasets: allDatasets
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
              text: `${product.title || product.productName} - Performance Chart`,
              font: { size: 16, weight: 'bold' },
              color: '#f3f4f6'
            },
            legend: {
              display: true,
              position: 'top',
              labels: {
                usePointStyle: true,
                padding: 15,
                color: '#d1d5db',
                font: { size: 12 },
                filter: (legendItem) => {
                  // Hide reference lines from legend if too many items
                  return !(allDatasets.length > 8 && legendItem.text.includes('Initial Level'));
                }
              }
            },
            tooltip: {
              enabled: true,
              backgroundColor: 'rgba(31, 41, 55, 0.9)',
              titleColor: '#ffffff',
              bodyColor: '#ffffff',
              borderColor: '#6b7280',
              borderWidth: 1,
              callbacks: {
                title: (context) => {
                  const date = new Date(context[0].label);
                  return date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  });
                },
                label: (context) => {
                  let label = context.dataset.label || '';
                  if (label) label += ': ';
                  if (context.parsed.y !== null) {
                    label += context.parsed.y.toFixed(2) + '%';
                  }
                  return label;
                }
              }
            },
            annotation: {
              annotations: {
                ...verticalAnnotations,
                ...eventAnnotations
              }
            }
          },
          scales: {
            x: {
              type: 'category',
              grid: {
                display: true,
                color: 'rgba(209, 213, 219, 0.1)',
                drawBorder: false
              },
              ticks: {
                maxRotation: 45,
                minRotation: 0,
                color: '#d1d5db',
                font: { size: 11 },
                maxTicksLimit: Math.min(12, Math.ceil(dateRange.labels.length / 30)), // Show roughly monthly ticks
                callback: (value, index, values) => {
                  const dateStr = dateRange.labels[index];
                  return this.dateRangeGenerator.formatXAxisLabel(dateStr, product, index, dateRange.labels.length);
                }
              }
            },
            y: {
              type: 'linear',
              beginAtZero: false,
              ...this.calculateYAxisRange(allDatasets),
              grid: {
                display: true,
                color: 'rgba(209, 213, 219, 0.1)',
                drawBorder: false
              },
              ticks: {
                color: '#d1d5db',
                font: { size: 11 },
                callback: (value) => value.toFixed(1) + '%'
              }
            }
          }
        },
        
        // Metadata for the chart component (not displayed but used by UI)
        metadata: {
          productId: product._id,
          productTitle: product.title || product.productName,
          productIsin: product.isin,
          chartTitle: `${product.title || product.productName} - Performance Evolution`,
          initialDate: product.tradeDate || product.valueDate,
          finalDate: product.maturity || product.maturityDate,
          evaluationDate: evaluationDate.toISOString(),
          todaysDate: today.toISOString(),
          timeToMaturity: this.dateRangeGenerator.calculateTimeToMaturity(product, evaluationDate),
          observationDates: this.eventExtractor.extractObservationDates(product),
          couponDates: this.eventExtractor.extractCouponDates(evaluationResults),
          eventDates: this.eventExtractor.extractAllEventDates(evaluationResults),
          productType: this.eventExtractor.detectProductType(product),
          hasMatured: evaluationDate >= new Date(product.maturity || product.maturityDate),
          dataPoints: dateRange.labels.length,
          underlyingCount: product.underlyings?.length || 0,
          barrierCount: barrierData.datasets.length,
          eventCount: Object.keys(eventAnnotations).length,
          generatedAt: new Date().toISOString(),
          version: '2.0.0'
        }
      };
      
      return chartData;
      
    } catch (error) {
      return {
        error: true,
        errorMessage: error.message,
        available: false,
        metadata: {
          productId: product._id,
          errorGenerated: true,
          generatedAt: new Date().toISOString()
        }
      };
    }
  }

  /**
   * Calculate Y-axis range with symmetric 10% padding
   * @param {Array} datasets - Chart datasets containing the data points
   * @returns {Object} Object with min and max values for y-axis
   */
  calculateYAxisRange(datasets) {
    try {
      // Extract all numeric y values from all datasets
      const allYValues = datasets.flatMap(dataset => 
        dataset.data.filter(point => typeof point.y === 'number').map(point => point.y)
      );
      
      if (allYValues.length === 0) {
        return { min: 0, max: 100 };
      }
      
      const dataMin = Math.min(...allYValues);
      const dataMax = Math.max(...allYValues);
      const range = dataMax - dataMin;
      
      // Apply symmetric 10% padding above and below
      const padding = range * 0.10;
      const min = dataMin - padding;
      const max = dataMax + padding;
      
      
      return { min, max };
    } catch (error) {
      return { min: 0, max: 100 };
    }
  }

  // ============================================================================
  // LEGACY METHODS FOR BACKWARD COMPATIBILITY
  // ============================================================================

  /**
   * Legacy method - delegates to dateRangeGenerator
   */
  generateDateRange(product, evaluationDate) {
    return this.dateRangeGenerator.generateDateRange(product, evaluationDate);
  }

  /**
   * Legacy method - delegates to marketDataProcessor
   */
  async generateRebasedUnderlyingDatasets(product, dateRange, marketData, evaluationDate) {
    return await this.marketDataProcessor.generateRebasedUnderlyingDatasets(product, dateRange, marketData, evaluationDate);
  }

  /**
   * Legacy method - delegates to marketDataProcessor
   */
  async generateUnderlyingDatasets(product, dateRange, options) {
    return await this.marketDataProcessor.generateUnderlyingDatasets(product, dateRange, options);
  }

  /**
   * Legacy method - delegates to barrierDataProcessor
   */
  generateBarrierDatasets(product, dateRange, evaluationResults) {
    return this.barrierDataProcessor.generateBarrierDatasets(product, dateRange, evaluationResults);
  }

  /**
   * Legacy method - delegates to annotationGenerator
   */
  generateVerticalAnnotations(product, evaluationResults, dateRange, evaluationDate) {
    return this.annotationGenerator.generateVerticalAnnotations(product, evaluationResults, dateRange, evaluationDate, this.eventExtractor);
  }

  /**
   * Legacy method - delegates to annotationGenerator
   */
  generateEventPointAnnotations(product, evaluationResults, marketData, dateRange) {
    return this.annotationGenerator.generateEventPointAnnotations(product, evaluationResults, marketData, dateRange, this.eventExtractor);
  }

  /**
   * Legacy method - delegates to annotationGenerator
   */
  generateVerticalLines(product, evaluationResults) {
    return this.annotationGenerator.generateVerticalLines(product, evaluationResults, this.eventExtractor);
  }

  /**
   * Legacy method - delegates to eventExtractor
   */
  extractObservationDates(product) {
    return this.eventExtractor.extractObservationDates(product);
  }

  /**
   * Legacy method - delegates to eventExtractor
   */
  extractCouponDates(evaluationResults) {
    return this.eventExtractor.extractCouponDates(evaluationResults);
  }

  /**
   * Legacy method - delegates to eventExtractor
   */
  extractAllEventDates(evaluationResults) {
    return this.eventExtractor.extractAllEventDates(evaluationResults);
  }

  /**
   * Legacy method - delegates to eventExtractor
   */
  detectProductType(product) {
    return this.eventExtractor.detectProductType(product);
  }

  /**
   * Legacy method - delegates to dateRangeGenerator
   */
  calculateTimeToMaturity(product, evaluationDate) {
    return this.dateRangeGenerator.calculateTimeToMaturity(product, evaluationDate);
  }

  /**
   * Legacy method - delegates to barrierDataProcessor
   */
  extractBarrierLevels(product, evaluationResults) {
    return this.barrierDataProcessor.extractBarrierLevels(product, evaluationResults);
  }

  /**
   * Legacy method - delegates to dateRangeGenerator
   */
  formatXAxisLabel(label, product, index, totalLabels) {
    return this.dateRangeGenerator.formatXAxisLabel(label, product, index, totalLabels);
  }
}

// For backward compatibility, also export as ChartDataGenerator
export const ChartDataGenerator = ChartDataBuilder;