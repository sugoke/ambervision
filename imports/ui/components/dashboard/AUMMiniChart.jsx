import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip
);

/**
 * Mini AUM Evolution Chart for Dashboard
 * Shows portfolio value evolution over time
 */
const AUMMiniChart = ({ sessionId, viewAsFilter, currency = 'EUR', isMobile = false }) => {
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const chartRef = useRef(null);

  useEffect(() => {
    const fetchChartData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Use WTD (Week to Date) - last 7 days for more accurate recent data
        const wtdDays = 7;

        // Use rmDashboard.getAUMHistory for consistent AUM data
        Meteor.call(
          'rmDashboard.getAUMHistory',
          sessionId,
          wtdDays,
          currency,
          (err, result) => {
            setLoading(false);
            if (err) {
              console.error('[AUMMiniChart] Error fetching data:', err);
              setError('Failed to load chart data');
              return;
            }

            if (!result || !result.hasData) {
              setChartData(null);
              return;
            }

            // Format labels to show just month/day
            const formattedLabels = result.labels.map(label => {
              const date = new Date(label);
              return `${date.getDate()}/${date.getMonth() + 1}`;
            });

            setChartData({
              labels: formattedLabels,
              datasets: [{
                data: result.values,
                borderColor: '#10b981',
                backgroundColor: (context) => {
                  const ctx = context.chart.ctx;
                  const gradient = ctx.createLinearGradient(0, 0, 0, context.chart.height);
                  gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
                  gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
                  return gradient;
                },
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2
              }],
              rawSnapshots: result.snapshots
            });
          }
        );
      } catch (err) {
        setLoading(false);
        setError('Failed to load chart data');
        console.error('[AUMMiniChart] Exception:', err);
      }
    };

    fetchChartData();
  }, [sessionId, viewAsFilter, currency]);

  // Calculate change from first to last value
  const getChange = () => {
    if (!chartData || !chartData.rawSnapshots || chartData.rawSnapshots.length < 2) {
      return null;
    }

    const first = chartData.rawSnapshots[0].value;
    const last = chartData.rawSnapshots[chartData.rawSnapshots.length - 1].value;
    const change = last - first;
    const changePercent = first > 0 ? ((change / first) * 100) : 0;

    return {
      amount: change,
      percent: changePercent,
      isPositive: change >= 0
    };
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: '#fff',
        bodyColor: '#fff',
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          label: (context) => {
            return formatCurrency(context.raw);
          }
        }
      }
    },
    scales: {
      x: {
        display: false,
        grid: {
          display: false
        }
      },
      y: {
        display: false,
        grid: {
          display: false
        }
      }
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    }
  };

  const change = getChange();

  if (loading) {
    return (
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        padding: isMobile ? '1rem' : '1.25rem',
        border: '1px solid var(--border-color)',
        height: isMobile ? '140px' : '160px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Loading AUM data...
        </div>
      </div>
    );
  }

  if (error || !chartData) {
    return (
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        padding: isMobile ? '1rem' : '1.25rem',
        border: '1px solid var(--border-color)',
        height: isMobile ? '140px' : '160px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          {error || 'No AUM history available'}
        </div>
      </div>
    );
  }

  const currentValue = chartData.rawSnapshots?.[chartData.rawSnapshots.length - 1]?.value;

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      borderRadius: '12px',
      padding: isMobile ? '1rem' : '1.25rem',
      border: '1px solid var(--border-color)',
      height: isMobile ? '140px' : '160px',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '0.5rem'
      }}>
        <div style={{
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          AUM Evolution (WTD)
        </div>
        {change && (
          <div style={{
            fontSize: '0.85rem',
            fontWeight: '600',
            color: change.isPositive ? '#10b981' : '#ef4444'
          }}>
            {change.isPositive ? '+' : ''}{change.percent.toFixed(1)}%
          </div>
        )}
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Line ref={chartRef} data={chartData} options={chartOptions} />
      </div>
    </div>
  );
};

export default AUMMiniChart;
