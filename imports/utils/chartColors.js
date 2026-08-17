/**
 * Chart.js renders to <canvas>, which cannot resolve CSS custom properties.
 * Passing 'var(--gain-color)' as a dataset color silently falls back to black.
 * Resolve var() references to their computed values before handing them to Chart.js.
 */
export const resolveChartColor = (color, fallback = '#64748b') => {
  if (typeof color !== 'string' || !color.startsWith('var(')) return color;
  if (typeof document === 'undefined') return fallback;
  const name = color.slice(4, -1).split(',')[0].trim();
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
};

export const resolveChartColors = (colors, fallback) =>
  colors.map((c) => resolveChartColor(c, fallback));
