import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    // Check localStorage first, then default to dark
    const saved = localStorage.getItem('structured-products-theme');
    if (saved) return saved;

    // Default to dark mode (night mode)
    return 'dark';
  });

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('structured-products-theme', newTheme);
  };

  const setLightTheme = () => {
    setTheme('light');
    localStorage.setItem('structured-products-theme', 'light');
  };

  const setDarkTheme = () => {
    setTheme('dark');
    localStorage.setItem('structured-products-theme', 'dark');
  };

  // Apply theme to document root
  useEffect(() => {
    const root = document.documentElement;
    
    // Set the data-theme attribute
    root.setAttribute('data-theme', theme);
    
    // Also add/remove the dark-mode class for backward compatibility
    if (theme === 'dark') {
      root.classList.add('dark-mode');
      document.body.classList.add('dark-mode');
    } else {
      root.classList.remove('dark-mode');
      document.body.classList.remove('dark-mode');
    }
    
    // Update CSS custom properties for immediate effect (as fallback).
    //
    // "Ambervision" design system — extracted from the approved desktop proposals
    // (dashboard-proposal.html / pms-proposal.html for dark, pms-redesign.html for light).
    // Dark is a warm near-black "ink" desk with amber as the single signature accent;
    // light is a warm-paper "statement" look with the same amber anchoring.
    //
    // Every colour used as TEXT clears WCAG AA (4.5:1) against every surface of its own
    // theme (bg-primary, bg-secondary AND bg-tertiary). The proposals' raw light values
    // (#B8841F amber 2.82:1, #BE4436 red 4.41:1 on the deepest paper) fail AA, so text
    // tokens are darkened versions of the same hues; the raw bright values live in
    // --accent-strong for non-text uses (rules, glyphs, washes, fills).
    if (theme === 'dark') {
      root.style.setProperty('--bg-primary', '#0E1014');        // ink — page ground
      root.style.setProperty('--bg-primary-rgb', '14, 16, 20');
      root.style.setProperty('--bg-secondary', '#171A21');      // panel — cards, modals
      root.style.setProperty('--bg-tertiary', '#1E222B');       // panel-2 — hover, insets
      root.style.setProperty('--text-primary', '#F5F1E8');      // warm off-white "paper"
      root.style.setProperty('--text-secondary', '#C9CDD5');
      root.style.setProperty('--text-muted', '#8B909C');        // 4.98:1 worst-case
      root.style.setProperty('--border-color', '#2A2F3A');      // hairline
      root.style.setProperty('--border-color-light', '#21252E');
      root.style.setProperty('--accent-color', '#E0A138');      // signature amber, 7.07:1
      root.style.setProperty('--success-color', '#57B891');
      root.style.setProperty('--danger-color', '#D9776B');
      root.style.setProperty('--shadow', 'rgba(0,0,0,0.45)');

      // Status tokens — desaturated ledger tones from the proposal, all AA on panels.
      root.style.setProperty('--gain-color', '#57B891');
      root.style.setProperty('--loss-color', '#D9776B');
      root.style.setProperty('--warning-color', '#E0A138');
      root.style.setProperty('--info-color', '#7FB0DE');
      root.style.setProperty('--neutral-color', '#8B909C');

      // Design-system extensions (non-text accents + card recipe).
      root.style.setProperty('--accent-strong', '#F2C46B');     // amber-hi: glyphs, rules
      root.style.setProperty('--accent-contrast', '#0E1014');   // text on amber fills
      root.style.setProperty('--card-bg', 'linear-gradient(180deg, #171A21, #14171D)');
      root.style.setProperty('--card-shadow', '0 1px 2px rgba(0,0,0,0.3)');
      root.style.setProperty('--page-bg',
        'radial-gradient(1200px 600px at 78% -8%, rgba(224,161,56,.10), transparent 60%),' +
        'radial-gradient(900px 500px at 0% 100%, rgba(87,184,145,.05), transparent 55%), #0E1014');
    } else {
      root.style.setProperty('--bg-primary', '#FFFFFF');        // card ground
      root.style.setProperty('--bg-primary-rgb', '255, 255, 255');
      root.style.setProperty('--bg-secondary', '#FBF9F3');      // card-soft warm panels
      root.style.setProperty('--bg-tertiary', '#F1EDE2');       // deep paper insets
      root.style.setProperty('--text-primary', '#1C1F26');      // ink
      root.style.setProperty('--text-secondary', '#3D424D');    // body
      root.style.setProperty('--text-muted', '#666C78');        // 4.51:1 worst-case
      root.style.setProperty('--border-color', '#D8D2C2');      // hair-strong
      root.style.setProperty('--border-color-light', '#E7E2D6'); // hair
      root.style.setProperty('--accent-color', '#8A5F0B');      // amber-deep, 4.82:1 as text
      root.style.setProperty('--success-color', '#14724F');
      root.style.setProperty('--danger-color', '#B03C2F');
      root.style.setProperty('--shadow', 'rgba(28,31,38,0.12)');

      // Status tokens — proposal hues darkened just enough to clear AA on all surfaces.
      root.style.setProperty('--gain-color', '#14724F');
      root.style.setProperty('--loss-color', '#B03C2F');
      root.style.setProperty('--warning-color', '#A34A08');
      root.style.setProperty('--info-color', '#2B669D');
      root.style.setProperty('--neutral-color', '#666C78');

      // Design-system extensions.
      root.style.setProperty('--accent-strong', '#B8841F');     // ledger amber: rules, fills
      root.style.setProperty('--accent-contrast', '#FFFFFF');
      root.style.setProperty('--card-bg', '#FFFFFF');
      root.style.setProperty('--card-shadow', '0 1px 2px rgba(28,31,38,.04), 0 8px 24px -18px rgba(28,31,38,.18)');
      root.style.setProperty('--page-bg',
        'radial-gradient(900px 400px at 90% -6%, rgba(184,132,31,.07), transparent 60%), #F7F4EC');
    }
  }, [theme]);

  // System theme changes are disabled - we default to dark mode
  // Users can manually toggle if they prefer light mode
  useEffect(() => {
    // No longer listening to system theme changes
    // Dark mode is the standard default
  }, []);

  return (
    <ThemeContext.Provider value={{
      theme,
      toggleTheme,
      setLightTheme,
      setDarkTheme,
      isDark: theme === 'dark'
    }}>
      {children}
    </ThemeContext.Provider>
  );
};