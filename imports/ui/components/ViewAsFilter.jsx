import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { USER_ROLES } from '/imports/api/users';
import { ClientEntityHelpers, ENTITY_TYPES, ENTITY_STATUSES } from '/imports/api/clientEntities';
import { useViewAs } from '../ViewAsContext.jsx';

const ViewAsFilter = ({ currentUser, onSelect }) => {
  const { viewAsFilter, setFilter, clearFilter, favorites, addFavorite, removeFavorite, isFavorite } = useViewAs();
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState({ entities: [] });
  const [isSearching, setIsSearching] = useState(false);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Show for admins, superadmins, compliance, and relationship managers only
  if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN && currentUser.role !== USER_ROLES.COMPLIANCE && currentUser.role !== USER_ROLES.RELATIONSHIP_MANAGER)) {
    return null;
  }

  // Debounced search function
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchTerm || searchTerm.trim().length < 2 || viewAsFilter) {
      setSearchResults({ entities: [] });
      return;
    }

    setIsSearching(true);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const sessionId = localStorage.getItem('sessionId');
        const results = await Meteor.callAsync('viewAs.search', searchTerm, sessionId);
        setSearchResults(results);
      } catch (error) {
        console.error('ViewAs search error:', error);
        setSearchResults({ entities: [] });
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

  // Build results from entities
  const allResults = React.useMemo(() => {
    return (searchResults.entities || []).map(entity => ({
      type: 'entity',
      data: entity,
      matchedBy: entity.matchedByAccount ? 'account' : 'name'
    }));
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
      type: 'entity',
      id: result.data._id,
      label: ClientEntityHelpers.getEntityDisplayName(result.data),
      data: result.data
    };
    setFilter(filter);
    setSearchTerm('');
    setIsOpen(false);

    if (onSelect) {
      onSelect(filter);
    }
  };

  const handleSelectAccount = (e, account, entity) => {
    e.stopPropagation();
    const entityName = ClientEntityHelpers.getEntityDisplayName(entity);
    const filter = {
      type: 'account',
      id: account._id,
      label: `${entityName} - ${account.accountNumber}`,
      data: {
        ...account,
        entityName,
        entityId: entity._id,
        entityData: entity
      }
    };
    setFilter(filter);
    setSearchTerm('');
    setIsOpen(false);

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
    e.stopPropagation();
    const id = result.data._id;
    if (isFavorite(id)) {
      removeFavorite(id);
    } else {
      addFavorite({
        type: 'entity',
        id: id,
        label: ClientEntityHelpers.getEntityDisplayName(result.data),
        data: result.data
      });
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

  // Show favorites when focused with no search term and no active filter
  const allFavorites = favorites.filter(f => f.type === 'entity' || f.type === 'client');
  const showFavorites = isOpen && !viewAsFilter && !searchTerm && allFavorites.length > 0;

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
              if (!viewAsFilter) setIsOpen(true);
            }}
            placeholder={viewAsFilter ? '' : 'Search entities...'}
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
              maxHeight: '400px',
              overflowY: 'auto',
              zIndex: 1000
            }}>
              {allResults.map((result, index) => {
                const entity = result.data;
                const accounts = entity.accounts || [];
                const entityType = entity.type;
                const isInsurance = entity.isInsurance;
                const statusDisplay = entity.status && entity.status !== ENTITY_STATUSES.ACTIVE
                  ? ClientEntityHelpers.getEntityStatusDisplay(entity.status)
                  : null;

                return (
                  <div
                    key={entity._id}
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
                      marginBottom: accounts.length > 0 ? '0.35rem' : 0
                    }}>
                      {/* Icon */}
                      <span style={{ fontSize: '1rem' }}>
                        {isInsurance ? '\ud83d\udee1\ufe0f' : entityType === ENTITY_TYPES.COMPANY ? '\ud83c\udfe2' : '\ud83d\udc64'}
                      </span>

                      {/* Name */}
                      <span style={{
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        flex: 1
                      }}>
                        {ClientEntityHelpers.getEntityDisplayName(entity)}
                      </span>

                      {/* Type badge */}
                      <span style={{
                        fontSize: '0.6rem',
                        padding: '0.15rem 0.4rem',
                        borderRadius: '4px',
                        background: entityType === ENTITY_TYPES.COMPANY ? '#fef3c7' : '#dcfce7',
                        color: entityType === ENTITY_TYPES.COMPANY ? '#92400e' : '#166534',
                        fontWeight: '600',
                        textTransform: 'uppercase'
                      }}>
                        {isInsurance ? 'Insurance' : ClientEntityHelpers.getEntityTypeLabel(entityType)}
                      </span>

                      {/* Status badge (non-active only) */}
                      {statusDisplay && (
                        <span style={{
                          fontSize: '0.55rem',
                          padding: '0.1rem 0.35rem',
                          borderRadius: '3px',
                          background: `${statusDisplay.color}15`,
                          color: statusDisplay.color,
                          fontWeight: '600'
                        }}>
                          {statusDisplay.label}
                        </span>
                      )}

                      {/* Currency */}
                      {entity.referenceCurrency && (
                        <span style={{
                          fontSize: '0.6rem',
                          padding: '0.1rem 0.35rem',
                          borderRadius: '3px',
                          background: 'rgba(107, 114, 128, 0.1)',
                          color: 'var(--text-muted)',
                          fontWeight: '600'
                        }}>
                          {entity.referenceCurrency}
                        </span>
                      )}

                      {/* Favorite star */}
                      <button
                        onClick={(e) => toggleFavorite(e, result)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '1rem',
                          padding: '0.25rem',
                          color: isFavorite(entity._id) ? '#f59e0b' : 'var(--text-muted)',
                          transition: 'color 0.15s'
                        }}
                        title={isFavorite(entity._id) ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        {isFavorite(entity._id) ? '\u2605' : '\u2606'}
                      </button>
                    </div>

                    {/* Bank accounts - clickable to select a specific account */}
                    {accounts.length > 0 && (
                      <div style={{ paddingLeft: '1.5rem', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {accounts.map(acc => (
                          <span key={acc._id}
                            onClick={(e) => handleSelectAccount(e, acc, entity)}
                            style={{
                              fontSize: '0.7rem',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              background: 'rgba(14, 165, 233, 0.08)',
                              color: '#0ea5e9',
                              border: '1px solid rgba(14, 165, 233, 0.15)',
                              cursor: 'pointer',
                              transition: 'all 0.15s'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(14, 165, 233, 0.2)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(14, 165, 233, 0.08)'; }}
                            title={`Select account ${acc.accountNumber} only`}
                          >
                            {acc.bankName ? `${acc.bankName} ` : ''}{acc.accountNumber}{acc.ownerName ? ` — ${acc.ownerName}` : ''}{acc.referenceCurrency ? ` (${acc.referenceCurrency})` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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
                <span style={{ color: '#f59e0b', fontSize: '0.875rem' }}>{'\u2605'}</span>
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
              {allFavorites.map((favorite, index) => (
                <div
                  key={`fav-${favorite.id}`}
                  onClick={() => handleSelectFavorite(favorite)}
                  style={{
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    background: 'transparent',
                    borderBottom: index < allFavorites.length - 1 ? '1px solid var(--border-color)' : 'none',
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
                    <span style={{ fontSize: '1rem' }}>
                      {favorite.data?.type === ENTITY_TYPES.COMPANY ? '\ud83c\udfe2' : '\ud83d\udc64'}
                    </span>

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
                      background: '#dcfce7',
                      color: '#166534',
                      fontWeight: '600',
                      textTransform: 'uppercase'
                    }}>
                      {favorite.data?.type ? ClientEntityHelpers.getEntityTypeLabel(favorite.data.type) : 'Entity'}
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
                      {'\u2605'}
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
              No entities found
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ViewAsFilter;
