import React, { useRef, useEffect, useState } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { ChartDataCollection } from '/imports/api/chartData';

/**
 * StructuredProductChart Component - Displays Chart.js charts with pre-calculated data
 * 
 * This component loads chart data from the database and displays it using Chart.js.
 * All chart data is pre-calculated during report processing - this component
 * only handles display logic.
 */
const StructuredProductChart = ({ productId, height = '400px' }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [isChartLibraryLoaded, setIsChartLibraryLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Subscribe to chart data for this product
  const { chartData, isReady } = useTracker(() => {
    const handle = Meteor.subscribe('chartData.byProduct', productId);
    const data = ChartDataCollection.findOne({ productId });

    console.log('📊 Chart subscription status:', {
      productId,
      isReady: handle.ready(),
      hasData: !!data,
      dataType: data?.type,
      datasetCount: data?.data?.datasets?.length
    });

    return {
      chartData: data,
      isReady: handle.ready()
    };
  }, [productId]);

  // Load Chart.js library dynamically
  useEffect(() => {
    const loadChartJS = async () => {
      try {
        if (typeof window !== 'undefined' && !window.Chart) {
          // Load Chart.js from CDN
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });

          // Load Chart.js annotation plugin
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });

          // Load annotation plugin
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
          
          console.log('📊 Chart.js library loaded successfully');
        }
        
        setIsChartLibraryLoaded(true);
      } catch (error) {
        console.error('❌ Failed to load Chart.js:', error);
        setError('Failed to load chart library');
      }
    };

    loadChartJS();
  }, []);

  // Create or update chart when data is available
  useEffect(() => {
    if (!isChartLibraryLoaded || !isReady || !chartData || !canvasRef.current || !window.Chart) {
      return;
    }

    const ctx = canvasRef.current.getContext('2d');
    
    // Destroy existing chart if it exists
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    try {
      console.log('📊 Creating Chart.js instance with pre-calculated data');
      
      // Register annotation plugin
      if (window.Chart && window.Chart.register && window.chartjs_plugin_annotation) {
        window.Chart.register(window.chartjs_plugin_annotation);
      }

      // Apply gradients to datasets that need them
      const processedData = { ...chartData.data };
      if (processedData.datasets) {
        processedData.datasets = processedData.datasets.map(dataset => {
          if (dataset._needsGradient) {
            const processedDataset = { ...dataset };
            
            // Create gradient function based on type
            processedDataset.backgroundColor = (context) => {
              const chart = context.chart;
              const { ctx: chartCtx, chartArea } = chart;
              if (!chartArea) return dataset.backgroundColor; // Fallback
              
              let gradient;
              if (dataset._gradientType === 'autocall') {
                gradient = chartCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                gradient.addColorStop(0, 'rgba(16, 185, 129, 0.25)'); // Green at top
                gradient.addColorStop(0.7, 'rgba(16, 185, 129, 0.1)'); // Fade to lighter
                gradient.addColorStop(1, 'rgba(16, 185, 129, 0.03)'); // Very light at bottom
              } else if (dataset._gradientType === 'protection') {
                gradient = chartCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                gradient.addColorStop(0, 'rgba(239, 68, 68, 0.2)'); // Red at barrier level
                gradient.addColorStop(0.8, 'rgba(239, 68, 68, 0.08)'); // Fade to lighter
                gradient.addColorStop(1, 'rgba(239, 68, 68, 0.02)'); // Very light at bottom
              } else {
                return dataset.backgroundColor; // Fallback
              }
              
              return gradient;
            };
            
            // Clean up the metadata
            delete processedDataset._needsGradient;
            delete processedDataset._gradientType;
            
            return processedDataset;
          }
          return dataset;
        });
      }

      // Create new chart with processed data
      chartRef.current = new window.Chart(ctx, {
        type: chartData.type || 'line',
        data: processedData,
        options: {
          ...chartData.options,
          responsive: true,
          maintainAspectRatio: false,
          // Override height
          height: parseInt(height.replace('px', ''))
        }
      });

      console.log('✅ Chart.js instance created successfully');
      
    } catch (error) {
      console.error('❌ Error creating chart:', error);
      setError('Failed to create chart: ' + error.message);
    }

    // Cleanup function
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [isChartLibraryLoaded, isReady, chartData, height]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (chartRef.current) {
        chartRef.current.resize();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Loading state
  if (!isReady) {
    return (
      <div style={{
        height,
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)'
      }}>
        <div>📊 Loading chart data...</div>
      </div>
    );
  }

  // No chart data available
  if (!chartData) {
    return (
      <div style={{
        height,
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        border: '2px dashed var(--border-color)'
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>📈</div>
        <div style={{ fontWeight: '500', marginBottom: '0.5rem' }}>No Chart Data Available</div>
        <div style={{ fontSize: '0.9rem' }}>
          Chart data will be generated when the product is evaluated.
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{
        height,
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--error-color)',
        border: '2px dashed var(--error-color)'
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>⚠️</div>
        <div style={{ fontWeight: '500', marginBottom: '0.5rem' }}>Chart Error</div>
        <div style={{ fontSize: '0.9rem', textAlign: 'center', maxWidth: '300px' }}>
          {error}
        </div>
      </div>
    );
  }

  // Chart library loading state
  if (!isChartLibraryLoaded) {
    return (
      <div style={{
        height,
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)'
      }}>
        <div>📊 Loading chart library...</div>
      </div>
    );
  }

  // Toggle fullscreen
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Chart display
  return (
    <div style={{
      height: isFullscreen ? '100vh' : height,
      position: isFullscreen ? 'fixed' : 'relative',
      top: isFullscreen ? 0 : 'auto',
      left: isFullscreen ? 0 : 'auto',
      width: isFullscreen ? '100vw' : 'auto',
      zIndex: isFullscreen ? 9999 : 'auto',
      background: chartData?.options?.backgroundColor || '#000000',
      borderRadius: isFullscreen ? 0 : '8px',
      padding: '1rem'
    }}>
      {/* Fullscreen Toggle Button */}
      <button
        onClick={toggleFullscreen}
        style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          background: 'rgba(255, 255, 255, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          borderRadius: '6px',
          color: 'white',
          padding: '0.5rem 1rem',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: '500',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          backdropFilter: 'blur(10px)',
          transition: 'all 0.2s ease',
          zIndex: 10
        }}
        onMouseEnter={(e) => {
          e.target.style.background = 'rgba(255, 255, 255, 0.2)';
          e.target.style.transform = 'scale(1.05)';
        }}
        onMouseLeave={(e) => {
          e.target.style.background = 'rgba(255, 255, 255, 0.1)';
          e.target.style.transform = 'scale(1)';
        }}
      >
        {isFullscreen ? '✕ Exit Fullscreen' : '⛶ Fullscreen'}
      </button>

      <canvas
        ref={canvasRef}
        style={{
          maxWidth: '100%',
          maxHeight: '100%'
        }}
      />
    </div>
  );
};

export default StructuredProductChart;