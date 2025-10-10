# Chart.js Setup for Product Reports

To enable the performance charts in product reports, you need to install Chart.js and its dependencies.

## Installation

Run the following command in your project directory:

```bash
meteor npm install chart.js chartjs-adapter-date-fns chartjs-plugin-annotation
```

## What's Included

- **chart.js**: The main Chart.js library for creating charts
- **chartjs-adapter-date-fns**: Date adapter for time-scale charts
- **chartjs-plugin-annotation**: Plugin for adding annotations (like coupon payment markers)

## Features

Once installed, the Product Report will display:

1. **Price Performance Chart**
   - All underlying assets rebased to 100 at trade date
   - Daily price data points (excluding weekends)
   - Interactive tooltips showing exact values

2. **Barrier Lines**
   - Autocall Level (green dashed line)
   - Protection Barrier (red dashed line)
   - Coupon Barrier (orange dashed line)

3. **Coupon Payments**
   - Visual markers on the chart showing when coupons were paid
   - Amount displayed on hover

## Usage

After installation, navigate to any product report and click on the "Price Chart" tab to view the performance visualization.

## Troubleshooting

If the chart doesn't appear after installation:
1. Restart the Meteor server
2. Clear your browser cache
3. Check the browser console for any errors

The chart component will display an installation message if Chart.js is not detected.