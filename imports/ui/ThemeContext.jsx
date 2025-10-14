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
    
    // Update CSS custom properties for immediate effect (as fallback)
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
    } else {
      root.style.setProperty('--bg-primary', 'rgba(255, 255, 255, 0.9)'); // Semi-transparent for background image
      root.style.setProperty('--bg-primary-rgb', '255, 255, 255');
      root.style.setProperty('--bg-secondary', 'rgba(248, 249, 250, 0.9)'); // Semi-transparent
      root.style.setProperty('--bg-tertiary', 'rgba(233, 236, 239, 0.9)'); // Semi-transparent
      root.style.setProperty('--text-primary', '#212529');
      root.style.setProperty('--text-secondary', '#495057');
      root.style.setProperty('--text-muted', '#6c757d');
      root.style.setProperty('--border-color', '#dee2e6');
      root.style.setProperty('--border-color-light', '#e9ecef');
      root.style.setProperty('--accent-color', '#007bff');
      root.style.setProperty('--success-color', '#28a745');
      root.style.setProperty('--danger-color', '#dc3545');
      root.style.setProperty('--shadow', 'rgba(0,0,0,0.1)');
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