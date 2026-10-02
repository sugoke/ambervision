// Registry of interactive product explainers shown in Intranet > Product Explainers.
// Each explainer is a self-contained HTML deck served from /public/explainers/.
// To add one: drop the HTML file into /public/explainers/ and add an entry below.
export const PRODUCT_EXPLAINERS = [
  {
    id: 'phoenix-memory-low-strike',
    title: 'Phoenix Memory Low Strike',
    productType: 'Phoenix',
    language: 'FR',
    description: 'Memory coupons, 70% protection barrier and 70% strike on the worst performer. Scenario simulator and payoff at maturity.',
    file: '/explainers/phoenix-memory-low-strike.html'
  },
  {
    id: 'orion-tech',
    title: 'Orion Tech',
    productType: 'Orion',
    language: 'FR',
    description: '100% capital guarantee in USD on a 7-stock basket, +75% knock-out barrier with +30% rebate. Scenario simulator and payoff at maturity.',
    file: '/explainers/orion-tech.html'
  }
];
