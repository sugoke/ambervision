/**
 * Rate Chart Builder
 *
 * For rate-linked target-redemption certificates there is NO underlying price
 * series. Instead we plot the COUPON ACCUMULATION toward the target:
 *  - a stepped line of cumulative coupon over the known periods
 *  - a horizontal Target line (e.g. 18%)
 *  - per-coupon point markers
 *  - a marker at the early-redemption period if the target was reached
 */
export const RateChartBuilder = {
  async generateChartData(product, evaluation) {
    const structure = evaluation.rateStructure || {};
    const schedule = evaluation.schedule || {};
    const periods = schedule.periods || [];
    const target = structure.targetEnabled ? structure.targetCoupon : null;

    // Only known (non-pending, non-cancelled) periods contribute to the curve.
    const knownPeriods = periods.filter(p => p.cumulativeCoupon !== null && p.cumulativeCoupon !== undefined);

    const labels = knownPeriods.map(p => p.paymentDate || p.observationDate);

    const cumulativeData = knownPeriods.map(p => ({
      x: p.paymentDate || p.observationDate,
      y: p.cumulativeCoupon
    }));

    const datasets = [];

    datasets.push({
      label: 'Cumulative Coupon',
      data: cumulativeData,
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.12)',
      borderWidth: 3,
      fill: true,
      stepped: true,
      pointRadius: 4,
      pointBackgroundColor: '#10b981',
      isPercentage: true,
      order: 1
    });

    if (target !== null && labels.length > 0) {
      datasets.push({
        label: `Target (${target.toFixed(0)}%)`,
        data: labels.map(date => ({ x: date, y: target })),
        borderColor: '#ef4444',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [8, 4],
        fill: false,
        pointRadius: 0,
        isPercentage: true,
        order: 2
      });
    }

    // Annotations: launch / maturity verticals + redemption marker.
    const annotations = {};
    if (labels.length > 0) {
      annotations.start = {
        type: 'line', xMin: 0, xMax: 0,
        borderColor: '#374151', borderWidth: 1.5,
        label: { content: 'Start', display: true, position: 'start', backgroundColor: '#374151', color: 'white', font: { size: 10, weight: 'bold' } }
      };
    }

    const redemption = evaluation.targetRedemption || {};
    if (redemption.reached && redemption.redemptionDate) {
      const dStr = new Date(redemption.redemptionDate).toISOString().split('T')[0];
      const idx = labels.findIndex(l => {
        const ls = typeof l === 'string' ? l : new Date(l).toISOString().split('T')[0];
        return ls === dStr;
      });
      if (idx >= 0) {
        annotations.redemption = {
          type: 'point',
          xValue: idx,
          yValue: target,
          backgroundColor: '#f59e0b',
          borderColor: '#f59e0b',
          borderWidth: 2,
          radius: 9,
          label: { content: 'Target reached — early redemption', display: true, position: 'top', backgroundColor: '#f59e0b', color: 'white', font: { size: 11, weight: 'bold' }, padding: 6 }
        };
      }
    }

    const chartData = {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          title: {
            display: true,
            text: `${product.title || 'Rate Certificate'} - Coupon Accumulation`,
            font: { size: 16, weight: 'bold' },
            color: '#1f2937'
          },
          legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 15, font: { size: 11 } } },
          tooltip: {
            enabled: true,
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                if (context.parsed.y !== null) label += context.parsed.y.toFixed(2) + '%';
                return label;
              }
            }
          },
          annotation: { annotations }
        },
        scales: {
          x: {
            type: 'category',
            title: { display: true, text: 'Payment Date', font: { size: 12, weight: 'bold' } },
            ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 12 },
            grid: { display: true, color: 'rgba(209, 213, 219, 0.2)', drawBorder: false }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Cumulative Coupon (%)', font: { size: 12, weight: 'bold' } },
            ticks: { callback: function(value) { return value.toFixed(0) + '%'; } },
            grid: { display: true, color: 'rgba(209, 213, 219, 0.2)', drawBorder: false }
          }
        }
      },
      metadata: {
        productId: product._id,
        productTitle: product.title || product.productName || 'Rate Certificate',
        chartTitle: `${product.title || 'Rate Certificate'} - Coupon Accumulation`,
        chartType: 'rate_coupon_accumulation',
        templateId: 'rate',
        target,
        knownCumulative: schedule.knownCumulative,
        anyPending: schedule.anyPending,
        targetReached: !!redemption.reached,
        dataPoints: labels.length,
        generatedAt: new Date().toISOString(),
        version: '1.0.0'
      }
    };

    return chartData;
  }
};
