import React, { createContext, useContext, useState, useEffect } from 'react';

// Context for "View As" filter that allows admins to restrict their view to specific clients/accounts
const ViewAsContext = createContext();

export const ViewAsProvider = ({ children }) => {
  const [viewAsFilter, setViewAsFilter] = useState(() => {
    // Try to restore from localStorage
    const saved = localStorage.getItem('viewAsFilter');
    return saved ? JSON.parse(saved) : null;
  });

  // Persist to localStorage whenever it changes
  useEffect(() => {
    if (viewAsFilter) {
      localStorage.setItem('viewAsFilter', JSON.stringify(viewAsFilter));
    } else {
      localStorage.removeItem('viewAsFilter');
    }
  }, [viewAsFilter]);

  const setFilter = (filter) => {
    setViewAsFilter(filter);
  };

  const clearFilter = () => {
    setViewAsFilter(null);
  };

  return (
    <ViewAsContext.Provider value={{ viewAsFilter, setFilter, clearFilter }}>
      {children}
    </ViewAsContext.Provider>
  );
};

export const useViewAs = () => {
  const context = useContext(ViewAsContext);
  if (!context) {
    throw new Error('useViewAs must be used within ViewAsProvider');
  }
  return context;
};
