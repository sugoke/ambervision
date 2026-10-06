/**
 * Sections of the portfolio statement PDF, in order. Shared by the download
 * dialog (which ones to include) and the server builder (buildStatement).
 * `n` is the number each statement page's `section` label starts with;
 * `required` sections are always included.
 */
export const STATEMENT_SECTIONS = [
  { key: 'overview', n: '01', label: 'Overview' },
  { key: 'allocation', n: '02', label: 'Allocation and exposure' },
  { key: 'positions', n: '03', label: 'Positions' },
  { key: 'performance', n: '04', label: 'Performance' },
  { key: 'activity', n: '05', label: 'Activity' },
  { key: 'notes', n: '06', label: 'Notes and disclosures', required: true }
];
