import React, { createContext, useContext, useState, useCallback, useLayoutEffect, useRef, useMemo } from 'react';

/**
 * Tabs for the product report pages. Every payoff template marks its top-level
 * blocks with <ReportSection tab="...">; the report page renders one tab bar for
 * whatever sections are present. Tabs are the same for every payoff, so a user
 * finds the schedule or the chart in the same place on any product.
 *
 * Inactive sections stay mounted (hidden), so charts and fetched data survive a
 * tab switch. A tab appears only when one of its sections renders something.
 * With tabs disabled (PDF), sections render inline as one long page.
 */

export const REPORT_TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'chart', label: 'Chart' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'structure', label: 'Structure' },
  { key: 'news', label: 'News' },
  { key: 'clients', label: 'Clients' }
];

const ReportTabsContext = createContext(null);

export const ReportTabsProvider = ({ enabled = true, children }) => {
  const [activeTab, setActiveTab] = useState(REPORT_TABS[0].key);
  // section id -> tab key, for sections currently rendering content
  const [present, setPresent] = useState({});

  const setSectionPresence = useCallback((id, tab, hasContent) => {
    setPresent(prev => {
      if (hasContent ? prev[id] === tab : !(id in prev)) return prev;
      const next = { ...prev };
      if (hasContent) next[id] = tab; else delete next[id];
      return next;
    });
  }, []);

  const availableTabs = useMemo(() => {
    const keys = new Set(Object.values(present));
    return REPORT_TABS.filter(t => keys.has(t.key));
  }, [present]);

  // Fall back to the first tab with content when the chosen one has none
  const currentTab = availableTabs.some(t => t.key === activeTab) ? activeTab : (availableTabs[0]?.key || activeTab);

  const value = useMemo(() => ({ enabled, activeTab: currentTab, setActiveTab, availableTabs, setSectionPresence }),
    [enabled, currentTab, availableTabs, setSectionPresence]);

  return <ReportTabsContext.Provider value={value}>{children}</ReportTabsContext.Provider>;
};

let sectionCounter = 0;

export const ReportSection = ({ tab, children }) => {
  const ctx = useContext(ReportTabsContext);
  const ref = useRef(null);
  const idRef = useRef(null);
  if (idRef.current === null) { sectionCounter += 1; idRef.current = `section-${sectionCounter}`; }

  // Register while this section actually renders something
  useLayoutEffect(() => {
    if (!ctx || !ctx.enabled) return;
    ctx.setSectionPresence(idRef.current, tab, !!ref.current && ref.current.childElementCount > 0);
  });
  useLayoutEffect(() => () => { if (ctx) ctx.setSectionPresence(idRef.current, tab, false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ctx || !ctx.enabled) return <>{children}</>;
  return (
    <div ref={ref} data-report-tab={tab} style={{ display: ctx.activeTab === tab ? 'contents' : 'none' }}>
      {children}
    </div>
  );
};

export const ReportTabBar = ({ style }) => {
  const ctx = useContext(ReportTabsContext);
  if (!ctx || !ctx.enabled || ctx.availableTabs.length < 2) return null;
  return (
    <div role="tablist" aria-label="Report sections" className="report-tab-bar" style={{
      display: 'flex',
      gap: '0.25rem',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
      borderBottom: '1px solid var(--border-color)',
      margin: '1rem 0',
      scrollbarWidth: 'none',
      ...style
    }}>
      {ctx.availableTabs.map(t => {
        const active = t.key === ctx.activeTab;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => ctx.setActiveTab(t.key)}
            style={{
              flex: 'none',
              padding: '0.6rem 1rem',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${active ? 'var(--accent-color, #DD772A)' : 'transparent'}`,
              marginBottom: '-1px',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: active ? 600 : 400,
              fontSize: '0.92rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
};
