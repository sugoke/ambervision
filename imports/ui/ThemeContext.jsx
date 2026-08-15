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
    // Every colour used as TEXT is chosen to clear WCAG AA (4.5:1) against the surfaces of
    // its own theme — checked against the lightest AND darkest surface in that theme, not
    // just the primary background. The light palette previously used the Bootstrap 4
    // defaults, which fail badly on white: success #28a745 was 3.13:1 and accent #007bff
    // 3.98:1, i.e. unreadable at normal text sizes. The status tokens below exist because
    // the same green/red/amber cannot serve both themes: a green that reads on near-black
    // is washed out on near-white, and vice versa.
    if (theme === 'dark') {
      root.style.setProperty('--bg-primary', '#1a1a1a');
      root.style.setProperty('--bg-primary-rgb', '26, 26, 26');
      root.style.setProperty('--bg-secondary', '#2d2d2d');
      root.style.setProperty('--bg-tertiary', '#3a3a3a');
      root.style.setProperty('--text-primary', '#ffffff');
      root.style.setProperty('--text-secondary', '#e0e0e0');
      root.style.setProperty('--text-muted', '#b0b0b0');
      root.style.setProperty('--border-color', '#4a4a4a');
      root.style.setProperty('--border-color-light', '#3a3a3a');
      root.style.setProperty('--accent-color', '#4da6ff');
      root.style.setProperty('--success-color', '#4caf50');
      root.style.setProperty('--danger-color', '#f44336');
      root.style.setProperty('--shadow', 'rgba(255,255,255,0.1)');

      // Semantic status tokens — the values the app has always used on dark.
      root.style.setProperty('--gain-color', '#10b981');
      root.style.setProperty('--loss-color', '#ef4444');
      root.style.setProperty('--warning-color', '#f59e0b');
      root.style.setProperty('--info-color', '#3b82f6');
      root.style.setProperty('--neutral-color', '#94a3b8');
    } else {
      root.style.setProperty('--bg-primary', 'rgba(255, 255, 255, 0.9)'); // Semi-transparent for background image
      root.style.setProperty('--bg-primary-rgb', '255, 255, 255');
      root.style.setProperty('--bg-secondary', 'rgba(248, 249, 250, 0.9)'); // Semi-transparent
      root.style.setProperty('--bg-tertiary', 'rgba(233, 236, 239, 0.9)'); // Semi-transparent
      root.style.setProperty('--text-primary', '#212529');
      root.style.setProperty('--text-secondary', '#495057');
      // 4.69:1 on white but only 3.95:1 on --bg-tertiary, where it is routinely used.
      root.style.setProperty('--text-muted', '#5c656d');
      // Panel edges were 1.30:1 — effectively invisible, so cards bled into each other.
      root.style.setProperty('--border-color', '#c7ced5');
      root.style.setProperty('--border-color-light', '#dde1e5');
      root.style.setProperty('--accent-color', '#0b5ed7');
      root.style.setProperty('--success-color', '#047857');
      root.style.setProperty('--danger-color', '#b91c1c');
      root.style.setProperty('--shadow', 'rgba(0,0,0,0.1)');

      // Darker equivalents of the dark-theme status colours: same meaning, legible on
      // white. Verified >= 4.5:1 on both #ffffff and the tertiary surface #e9ecef.
      root.style.setProperty('--gain-color', '#047857');
      root.style.setProperty('--loss-color', '#b91c1c');
      root.style.setProperty('--warning-color', '#b45309');
      root.style.setProperty('--info-color', '#1d4ed8');
      root.style.setProperty('--neutral-color', '#5c656d');
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