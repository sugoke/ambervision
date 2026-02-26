import React, { useState } from 'react';
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

/**
 * HoldingPriceChart - Tiny chart icon next to ISIN that opens a price history modal
 * Supports both:
 * - Structured products/bonds (prices stored by ISIN in ProductPricesCollection, often as decimal %)
 * - Equities (prices stored by fullTicker in MarketDataCacheCollection)
 */
const HoldingPriceChart = ({ isin, securityName, sessionId }) => {
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [priceData, setPriceData] = useState(null);
  const [error, setError] = useState(null);

  if (!isin) return null;

  const handleClick = async (e) => {
    e.stopPropagation();

    if (priceData) {
      setShowModal(true);
      return;
    }

    setLoading(true);
    setError(null);
    setShowModal(true);

    try {
      const result = await Meteor.callAsync('pms.getHoldingPriceHistory', { isin, sessionId });
      if (result.hasData) {
        setPriceData(result);
      } else {
        setError(result.error || 'No price data available');
      }
    } catch (err) {
      setError(err.reason || err.message || 'Failed to load price data');
    } finally {
      setLoading(false);
    }
  };

  const buildChartData = () => {
    if (!priceData) return null;

    const { prices, isPositive, currency, firstPrice, isPercentagePrice } = priceData;
    const lineColor = isPositive ? '#10b981' : '#ef4444';

    // For percentage prices (structured products), display as % (multiply by 100)
    const displayPrices = isPercentagePrice
      ? prices.map(p => ({ ...p, displayPrice: p.price * 100 }))
      : prices.map(p => ({ ...p, displayPrice: p.price }));

    const displayFirstPrice = isPercentagePrice ? firstPrice * 100 : firstPrice;

    const chartData = {
      labels: displayPrices.map(p => p.date),
      datasets: [{
        label: 'Price',
        data: displayPrices.map(p => p.displayPrice),
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

    const chartOptions = {
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
              if (isPercentagePrice) {
                return ` ${val.toFixed(2)}%`;
              }
              return ` ${currency || ''} ${val.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}`;
            }
          }
        },
        annotation: {
          annotations: displayFirstPrice ? {
            initialLine: {
              type: 'line',
              yMin: displayFirstPrice,
              yMax: displayFirstPrice,
              borderColor: '#6b7280',
              borderWidth: 1.5,
              borderDash: [5, 5],
              label: {
                display: true,
                content: isPercentagePrice
                  ? `Start: ${displayFirstPrice.toFixed(2)}%`
                  : `Start: ${displayFirstPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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
            callback: function(value) {
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
            maxTicksLimit: 6,
            callback: isPercentagePrice
              ? (value) => `${value.toFixed(1)}%`
              : undefined
          }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    };

    return { chartData, chartOptions };
  };

  const charts = priceData ? buildChartData() : null;

  // Performance display
  const perfText = priceData ? (() => {
    const change = ((priceData.lastPrice - priceData.firstPrice) / priceData.firstPrice * 100);
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}%`;
  })() : null;

  // Format the last price for display
  const lastPriceDisplay = priceData ? (() => {
    if (priceData.isPercentagePrice) {
      return `${(priceData.lastPrice * 100).toFixed(2)}%`;
    }
    return `${priceData.currency} ${priceData.lastPrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  })() : null;

  return (
    <>
      {/* Tiny chart icon */}
      <span
        onClick={handleClick}
        title={`View price history for ${isin}`}
        style={{
          cursor: 'pointer',
          fontSize: '0.65rem',
          opacity: loading ? 0.5 : 0.6,
          transition: 'opacity 0.2s ease',
          marginLeft: '0.3rem',
          display: 'inline-flex',
          alignItems: 'center',
          verticalAlign: 'middle'
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = loading ? '0.5' : '0.6'; }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ display: 'block' }}>
          <polyline
            points="1,10 4,7 7,9 10,4 13,6"
            stroke="#6366f1"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <line x1="1" y1="13" x2="13" y2="13" stroke="#94a3b8" strokeWidth="0.75" />
          <line x1="1" y1="1" x2="1" y2="13" stroke="#94a3b8" strokeWidth="0.75" />
        </svg>
      </span>

      {/* Modal with chart */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={securityName || isin}
        size="large"
      >
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.9rem' }}>Loading price history...</span>
          </div>
        )}

        {error && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.9rem' }}>{error}</span>
          </div>
        )}

        {priceData && charts && (
          <>
            {/* Header with ticker/ISIN and performance */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem',
              padding: '0 0.25rem'
            }}>
              <div>
                {priceData.source === 'marketData' && priceData.fullTicker !== isin && (
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontFamily: 'monospace', marginRight: '0.5rem' }}>
                    {priceData.fullTicker}
                  </span>
                )}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {isin}
                </span>
              </div>
              <div style={{
                fontSize: '1rem',
                fontWeight: '600',
                color: priceData.isPositive ? '#10b981' : '#ef4444'
              }}>
                {perfText}
              </div>
            </div>

            {/* Chart */}
            <div style={{ height: '350px', padding: '0.5rem 0' }}>
              <Line data={charts.chartData} options={charts.chartOptions} />
            </div>

            {/* Footer */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              marginTop: '0.75rem',
              padding: '0 0.25rem'
            }}>
              <span>From: {new Date(priceData.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span>Last: {lastPriceDisplay}</span>
              <span>{priceData.dataPoints} data points</span>
            </div>
          </>
        )}
      </Modal>
    </>
  );
};

export default HoldingPriceChart;
