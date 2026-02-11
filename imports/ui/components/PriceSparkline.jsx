import React, { useState } from 'react';
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
import annotationPlugin from 'chartjs-plugin-annotation';
import Modal from './common/Modal.jsx';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  annotationPlugin
);

const PriceSparkline = ({ sparklineData, ticker, initialPrice, currency, isPositive }) => {
  const [showModal, setShowModal] = useState(false);

  if (!sparklineData || !sparklineData.hasData || !sparklineData.prices?.length) {
    return null;
  }

  const prices = sparklineData.prices;
  const lineColor = isPositive ? '#10b981' : '#ef4444';

  // --- Compact sparkline config ---
  const sparklineChartData = {
    labels: prices.map(p => p.date),
    datasets: [{
      data: prices.map(p => p.price),
      borderColor: lineColor,
      backgroundColor: (context) => {
        const ctx = context.chart?.ctx;
        if (!ctx) return 'transparent';
        const gradient = ctx.createLinearGradient(0, 0, 0, context.chart.height);
        if (isPositive) {
          gradient.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
          gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
        } else {
          gradient.addColorStop(0, 'rgba(239, 68, 68, 0.25)');
          gradient.addColorStop(1, 'rgba(239, 68, 68, 0.0)');
        }
        return gradient;
      },
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      borderWidth: 1.5
    }]
  };

  const sparklineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
      annotation: { annotations: {} }
    },
    scales: {
      x: { display: false },
      y: { display: false }
    },
    interaction: { mode: 'none' }
  };

  // --- Enlarged chart config ---
  const enlargedChartData = {
    labels: prices.map(p => p.date),
    datasets: [{
      label: `${ticker} Price`,
      data: prices.map(p => p.price),
      borderColor: lineColor,
      backgroundColor: (context) => {
        const ctx = context.chart?.ctx;
        if (!ctx) return 'transparent';
        const gradient = ctx.createLinearGradient(0, 0, 0, context.chart.height);
        if (isPositive) {
          gradient.addColorStop(0, 'rgba(16, 185, 129, 0.15)');
          gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
        } else {
          gradient.addColorStop(0, 'rgba(239, 68, 68, 0.15)');
          gradient.addColorStop(1, 'rgba(239, 68, 68, 0.0)');
        }
        return gradient;
      },
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 2
    }]
  };

  const enlargedOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        titleColor: '#fff',
        bodyColor: '#fff',
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          title: (items) => {
            if (!items.length) return '';
            const date = new Date(items[0].label);
            return date.toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric'
            });
          },
          label: (context) => {
            const val = context.raw;
            return ` ${currency || ''} ${val.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}`;
          }
        }
      },
      annotation: {
        annotations: initialPrice ? {
          initialLine: {
            type: 'line',
            yMin: initialPrice,
            yMax: initialPrice,
            borderColor: '#6b7280',
            borderWidth: 1.5,
            borderDash: [5, 5],
            label: {
              display: true,
              content: `Initial: ${initialPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              position: 'start',
              backgroundColor: 'rgba(107, 114, 128, 0.85)',
              color: '#fff',
              font: { size: 11 },
              padding: 4
            }
          }
        } : {}
      }
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        ticks: {
          color: 'rgba(148, 163, 184, 0.8)',
          font: { size: 10 },
          maxTicksLimit: 8,
          callback: function(value, index) {
            const label = this.getLabelForValue(value);
            const date = new Date(label);
            return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          }
        }
      },
      y: {
        display: true,
        grid: {
          color: 'rgba(128, 128, 128, 0.1)',
          drawBorder: false
        },
        ticks: {
          color: 'rgba(148, 163, 184, 0.8)',
          font: { size: 10 },
          maxTicksLimit: 6
        }
      }
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    }
  };

  return (
    <>
      <div
        onClick={() => setShowModal(true)}
        style={{
          cursor: 'pointer',
          height: '40px',
          width: '100%',
          marginTop: '0.4rem',
          opacity: 0.9,
          transition: 'opacity 0.2s ease'
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.9'; }}
        title={`Click to enlarge ${ticker} price history`}
      >
        <Line data={sparklineChartData} options={sparklineOptions} />
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={`${ticker} Price History`}
        size="large"
      >
        <div style={{ height: '350px', padding: '0.5rem 0' }}>
          <Line data={enlargedChartData} options={enlargedOptions} />
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          marginTop: '0.75rem',
          padding: '0 0.25rem'
        }}>
          <span>From: {new Date(sparklineData.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <span>To: {new Date(sparklineData.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <span>{sparklineData.dataPoints} data points</span>
        </div>
      </Modal>
    </>
  );
};

export default PriceSparkline;
