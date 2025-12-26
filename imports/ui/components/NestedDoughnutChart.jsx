import React from 'react';
import { Doughnut } from 'react-chartjs-2';

/**
 * NestedDoughnutChart - Displays hierarchical data as concentric doughnut rings
 *
 * Inner ring: Level 1 (parent categories - underlying types)
 * Outer ring: Level 2 (child categories - protection types, aligned with parents)
 */
const NestedDoughnutChart = ({
  level1Data,        // [{ key, name, value, percentage }]
  level2Data,        // [{ key, name, value, parent, percentage }]
  theme = 'dark',
  formatCurrency,
  currency = 'USD',
  totalValue
}) => {
  // Color palette for Level 1 (underlying types)
  const level1Colors = {
    'equity_linked': '#3b82f6',        // Blue
    'fixed_income_linked': '#f59e0b',  // Orange
    'credit_linked': '#8b5cf6',        // Purple
    'commodities_linked': '#ec4899',   // Pink
    'other': '#64748b'                 // Gray
  };

  // Get color with opacity for Level 2
  const getLevel2Color = (parentKey, protectionType) => {
    const baseColor = level1Colors[parentKey] || '#64748b';
    const shadeMap = {
      'capital_guaranteed_100': 'ff',         // 100% opacity
      'capital_guaranteed_partial': 'b3',     // 70% opacity
      'capital_protected_conditional': '80',  // 50% opacity
      'other_protection': '4d'                // 30% opacity
    };
    const opacity = shadeMap[protectionType] || '80';
    return `${baseColor}${opacity}`;
  };

  // Build datasets for nested chart
  const chartData = {
    labels: [...level1Data.map(d => d.name), ...level2Data.map(d => d.name)],
    datasets: [
      // Inner ring - Level 1 (Underlying Types)
      {
        data: level1Data.map(d => d.value),
        backgroundColor: level1Data.map(d => level1Colors[d.key] || '#64748b'),
        borderColor: theme === 'light' ? '#ffffff' : '#111827',
        borderWidth: 2,
        weight: 0.6  // Inner ring weight
      },
      // Outer ring - Level 2 (Protection Types)
      {
        data: level2Data.map(d => d.value),
        backgroundColor: level2Data.map(d => getLevel2Color(d.parent, d.type)),
        borderColor: theme === 'light' ? '#ffffff' : '#111827',
        borderWidth: 1,
        weight: 1  // Outer ring weight
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: true,
    cutout: '35%',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: theme === 'light' ? '#ffffff' : '#1f2937',
        titleColor: theme === 'light' ? '#111827' : '#f9fafb',
        bodyColor: theme === 'light' ? '#374151' : '#d1d5db',
        borderColor: theme === 'light' ? '#e5e7eb' : '#374151',
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        callbacks: {
          label: function(context) {
            const value = context.parsed || 0;
            const percentage = totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : 0;
            const formattedValue = formatCurrency ? formatCurrency(value, currency) : value.toLocaleString();
            return `${context.label}: ${formattedValue} (${percentage}%)`;
          }
        }
      }
    }
  };

  return <Doughnut data={chartData} options={options} />;
};

export default NestedDoughnutChart;
