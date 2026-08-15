import React, { useRef, useEffect, useState } from 'react';

/**
 * Renders a pre-built Chart.js config passed as a prop. The config is fully
 * computed server-side and embedded in the report document — this component
 * only loads the Chart.js library and instantiates it.
 */
const GenericChart = ({ chartConfig, height = '420px' }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadChartJS = async () => {
      try {
        if (typeof window !== 'undefined' && !window.Chart) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }
        setLibraryLoaded(true);
      } catch (e) {
        setError('Failed to load chart library');
      }
    };
    loadChartJS();
  }, []);

  useEffect(() => {
    if (!libraryLoaded || !chartConfig || !canvasRef.current || !window.Chart) return;

    if (window.Chart.register && window.chartjs_plugin_annotation) {
      window.Chart.register(window.chartjs_plugin_annotation);
    }

    if (chartRef.current) chartRef.current.destroy();
    try {
      chartRef.current = new window.Chart(canvasRef.current.getContext('2d'), {
        type: chartConfig.type || 'line',
        data: chartConfig.data,
        options: { ...chartConfig.options, responsive: true, maintainAspectRatio: false }
      });
    } catch (e) {
      setError('Failed to create chart: ' + e.message);
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [libraryLoaded, chartConfig]);

  if (error) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger-color)' }}>⚠️ {error}</div>;
  }

  return (
    <div style={{ height, background: chartConfig?.options?.backgroundColor || '#0f172a', borderRadius: '8px', padding: '1rem' }}>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', maxHeight: '100%' }} />
    </div>
  );
};

export default GenericChart;
