import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { USER_ROLES } from '/imports/api/users';
import { useViewAs } from '../ViewAsContext.jsx';

const ViewAsFilter = ({ currentUser, onSelect }) => {
  const { viewAsFilter, setFilter, clearFilter, favorites, addFavorite, removeFavorite, isFavorite } = useViewAs();
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState({ clients: [] });
  const [isSearching, setIsSearching] = useState(false);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Only show for admins and superadmins
  if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
    return null;
  }

  // Debounced search function
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Don't search if term is too short or if a filter is already selected
    if (!searchTerm || searchTerm.trim().length < 2 || viewAsFilter) {
      setSearchResults({ clients: [] });
      return;
    }

    setIsSearching(true);

    // Debounce search by 300ms
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const sessionId = localStorage.getItem('sessionId');
        const results = await Meteor.callAsync('viewAs.search', searchTerm, sessionId);
        setSearchResults(results);
      } catch (error) {
        console.error('ViewAs search error:', error);
        setSearchResults({ clients: [] });
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchTerm, viewAsFilter]);

  // Build results: clients from direct search + clients from account number search
  const allResults = React.useMemo(() => {
    const results = [];
    const addedClientIds = new Set();

    // Add clients from direct name/email search
    (searchResults.clients || []).forEach(c => {
      if (!addedClientIds.has(c._id)) {
        results.push({ type: 'client', data: c, matchedBy: 'name' });
        addedClientIds.add(c._id);
      }
    });

    // Add clients from account number search (if not already added)
    (searchResults.bankAccounts || []).forEach(acc => {
      if (acc.userId && !addedClientIds.has(acc.userId)) {
        // Create a client-like object from the account's user info
        results.push({
          type: 'client',
          data: {
            _id: acc.userId,
            email: acc.userEmail,
            profile: {
              firstName: acc.userName?.split(' ')[0] || '',
              lastName: acc.userName?.split(' ').slice(1).join(' ') || ''
            }
          },
          matchedBy: 'account',
          matchedAccount: acc.accountNumber
        });
        addedClientIds.add(acc.userId);
      }
    });

    return results;
  }, [searchResults]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => Math.min(prev + 1, allResults.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (allResults[highlightedIndex]) {
          handleSelect(allResults[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  const handleSelect = (result) => {
    const filter = {
      type: 'client',
      id: result.data._id || result.data.userId,
      label: `${result.data.profile?.firstName || ''} ${result.data.profile?.lastName || ''}`.trim(),
      data: result.data
    };
    setFilter(filter);
    setSearchTerm('');
    setIsOpen(false);

    // Call onSelect callback if provided (for mobile overlay auto-close)
    if (onSelect) {
      onSelect(filter);
    }
  };

  const handleClear = () => {
    clearFilter();
    setSearchTerm('');
    inputRef.current?.focus();
  };

  const toggleFavorite = (e, result) => {
    e.stopPropagation(); // Prevent selecting the result
    const id = result.data._id || result.data.userId;
    if (isFavorite(id)) {
      removeFavorite(id);
    } else {
      const favoriteItem = {
        type: 'client',
        id: id,
        label: `${result.data.profile?.firstName || ''} ${result.data.profile?.lastName || ''}`.trim(),
        data: result.data
      };
      addFavorite(favoriteItem);
    }
  };

  const handleSelectFavorite = (favorite) => {
    setFilter({
      type: favorite.type,
      id: favorite.id,
      label: favorite.label,
      data: favorite.data
    });
    setSearchTerm('');
    setIsOpen(false);
    if (onSelect) {
      onSelect(favorite);
    }
  };

  // Filter favorites to only show clients (in case old account favorites exist)
  const clientFavorites = favorites.filter(f => f.type === 'client');

  // Show favorites when focused with no search term and no active filter
  const showFavorites = isOpen && !viewAsFilter && !searchTerm && clientFavorites.length > 0;

  const displayValue = viewAsFilter
    ? viewAsFilter.label
    : searchTerm;

  return (
    <div ref={dropdownRef} style={{ position: 'relative', minWidth: '300px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {/* Label */}
        <span style={{
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
          fontWeight: '500',
          whiteSpace: 'nowrap'
        }}>
          View as:
        </span>

        {/* Input */}
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            ref={inputRef}
            type="text"
            value={displayValue}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsOpen(true);
              setHighlightedIndex(0);
              if (viewAsFilter) clearFilter();
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              // Open dropdown on focus - for search results or favorites
              if (!viewAsFilter) setIsOpen(true);
            }}
            placeholder={viewAsFilter ? '' : 'Search clients...'}
            disabled={false}
            style={{
              width: '100%',
              padding: '0.5rem 2.5rem 0.5rem 0.75rem',
              background: viewAsFilter ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-primary)',
              border: viewAsFilter ? '2px solid #3b82f6' : '1px solid var(--border-color)',
              borderRadius: '8px',
              color: viewAsFilter ? '#3b82f6' : 'var(--text-primary)',
              fontSize: '0.875rem',
              fontWeight: viewAsFilter ? '600' : '400',
              outline: 'none',
              transition: 'all 0.2s'
            }}
          />

          {/* Clear button */}
          {viewAsFilter && (
            <button
              onClick={handleClear}
              style={{
                position: 'absolute',
                right: '0.5rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: '#3b82f6',
                cursor: 'pointer',
                fontSize: '1.2rem',
                lineHeight: 1,
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Clear filter"
            >
              ×
            </button>
          )}

          {/* Loading indicator */}
          {isOpen && !viewAsFilter && isSearching && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '0.25rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1rem',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.875rem',
              zIndex: 1000
            }}>
              Searching...
            </div>
          )}

          {/* Dropdown */}
          {isOpen && !viewAsFilter && !isSearching && allResults.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '0.25rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              maxHeight: '300px',
              overflowY: 'auto',
              zIndex: 1000
            }}>
              {allResults.map((result, index) => (
                <div
                  key={`${result.type}-${result.data._id}`}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  style={{
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    background: highlightedIndex === index ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    borderBottom: index < allResults.length - 1 ? '1px solid var(--border-color)' : 'none',
                    transition: 'background 0.15s'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.25rem'
                  }}>
                    {/* Icon */}
                    <span style={{ fontSize: '1rem' }}>👤</span>

                    {/* Main text */}
                    <span style={{
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      flex: 1
                    }}>
                      {`${result.data.profile?.firstName || ''} ${result.data.profile?.lastName || ''}`.trim()}
                    </span>

                    {/* Badge */}
                    <span style={{
                      fontSize: '0.65rem',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '4px',
                      background: '#dbeafe',
                      color: '#1e40af',
                      fontWeight: '600',
                      textTransform: 'uppercase'
                    }}>
                      Client
                    </span>

                    {/* Favorite star button */}
                    <button
                      onClick={(e) => toggleFavorite(e, result)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        padding: '0.25rem',
                        color: isFavorite(result.data._id || result.data.userId) ? '#f59e0b' : 'var(--text-muted)',
                        transition: 'color 0.15s'
                      }}
                      title={isFavorite(result.data._id || result.data.userId) ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      {isFavorite(result.data._id || result.data.userId) ? '★' : '☆'}
                    </button>
                  </div>

                  {/* Secondary text - Email or Account match */}
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    paddingLeft: '1.5rem'
                  }}>
                    {result.matchedBy === 'account' ? (
                      <span>
                        <span style={{ color: '#10b981', fontWeight: '500' }}>Account: {result.matchedAccount}</span>
                        {result.data.email && <span> • {result.data.email}</span>}
                      </span>
                    ) : (
                      result.data.email
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Favorites dropdown - shows when focused with no search term */}
          {showFavorites && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '0.25rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              maxHeight: '300px',
              overflowY: 'auto',
              zIndex: 1000
            }}>
              {/* Favorites header */}
              <div style={{
                padding: '0.5rem 1rem',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span style={{ color: '#f59e0b', fontSize: '0.875rem' }}>★</span>
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Favorites
                </span>
              </div>

              {/* Favorite items */}
              {clientFavorites.map((favorite, index) => (
                <div
                  key={`fav-${favorite.id}`}
                  onClick={() => handleSelectFavorite(favorite)}
                  style={{
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    background: 'transparent',
                    borderBottom: index < clientFavorites.length - 1 ? '1px solid var(--border-color)' : 'none',
                    transition: 'background 0.15s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    {/* Icon */}
                    <span style={{ fontSize: '1rem' }}>👤</span>

                    {/* Label */}
                    <span style={{
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      flex: 1
                    }}>
                      {favorite.label}
                    </span>

                    {/* Badge */}
                    <span style={{
                      fontSize: '0.65rem',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '4px',
                      background: '#dbeafe',
                      color: '#1e40af',
                      fontWeight: '600',
                      textTransform: 'uppercase'
                    }}>
                      Client
                    </span>

                    {/* Remove from favorites */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFavorite(favorite.id);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        padding: '0.25rem',
                        color: '#f59e0b',
                        transition: 'color 0.15s'
                      }}
                      title="Remove from favorites"
                    >
                      ★
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Minimum characters hint */}
          {isOpen && !viewAsFilter && searchTerm && searchTerm.trim().length < 2 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '0.25rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1rem',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.875rem',
              zIndex: 1000
            }}>
              Type at least 2 characters to search
            </div>
          )}

          {/* No results message */}
          {isOpen && !viewAsFilter && !isSearching && searchTerm && searchTerm.trim().length >= 2 && allResults.length === 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '0.25rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1rem',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.875rem',
              zIndex: 1000
            }}>
              No clients found
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ViewAsFilter;
