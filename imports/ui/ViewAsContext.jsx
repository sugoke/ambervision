import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';

// Context for "View As" filter that allows admins to restrict their view to specific clients/accounts
const ViewAsContext = createContext();

export const ViewAsProvider = ({ children }) => {
  const [viewAsFilter, setViewAsFilter] = useState(() => {
    // Try to restore from localStorage
    const saved = localStorage.getItem('viewAsFilter');
    return saved ? JSON.parse(saved) : null;
  });

  // Favorites state with localStorage persistence
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('viewAsFavorites');
    return saved ? JSON.parse(saved) : [];
  });

  // Persist favorites to localStorage
  useEffect(() => {
    localStorage.setItem('viewAsFavorites', JSON.stringify(favorites));
  }, [favorites]);

  const addFavorite = (item) => {
    setFavorites(prev => {
      // Don't add duplicates
      if (prev.some(f => f.id === item.id)) return prev;
      // Limit to 10 favorites, remove oldest if exceeded
      const updated = [...prev, item];
      return updated.slice(-10);
    });
  };

  const removeFavorite = (id) => {
    setFavorites(prev => prev.filter(f => f.id !== id));
  };

  const isFavorite = (id) => {
    return favorites.some(f => f.id === id);
  };

  // Track previous filter to detect actual changes (not initial mount)
  const prevFilterRef = useRef(viewAsFilter);

  // Force subscription refresh when filter changes
  useEffect(() => {
    // Only process if this is an actual change (not initial mount)
    const isInitialMount = prevFilterRef.current === viewAsFilter;
    const filterChanged = !isInitialMount &&
      JSON.stringify(prevFilterRef.current) !== JSON.stringify(viewAsFilter);

    if (filterChanged) {
      console.log('[ViewAsContext] Filter changed, forcing subscription refresh...');
      console.log('[ViewAsContext] Previous filter:', prevFilterRef.current);
      console.log('[ViewAsContext] New filter:', viewAsFilter);

      // Force all active subscriptions to stop and restart
      // This ensures MiniMongo cache is properly cleared and repopulated
      const subscriptions = ['products', 'allAllocations', 'productAllocations', 'schedule.observations', 'equityHoldings'];

      // Find and stop these subscriptions
      Object.keys(Meteor.connection._subscriptions || {}).forEach(subId => {
        const sub = Meteor.connection._subscriptions[subId];
        if (sub && subscriptions.includes(sub._name)) {
          console.log('[ViewAsContext] Stopping subscription:', sub._name);
          sub.stop();
        }
      });

      console.log('[ViewAsContext] Subscriptions stopped. Components will automatically restart them with new filter.');
    }

    // Update ref for next comparison
    prevFilterRef.current = viewAsFilter;

    // Persist to localStorage
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
    <ViewAsContext.Provider value={{
      viewAsFilter,
      setFilter,
      clearFilter,
      favorites,
      addFavorite,
      removeFavorite,
      isFavorite
    }}>
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
