import React, { useState, useRef, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';

/**
 * Autocomplete that searches clients by name, account name, or account number.
 * Selecting a result sets both clientId and bankAccountId in one go.
 *
 * Props:
 *   onSelect({ clientId, bankAccountId, clientName, accountLabel }) — called when user picks an account
 *   value — display string for selected account (controlled)
 *   placeholder
 *   disabled
 *   style — input style override
 */
export default function AccountAutocomplete({ onSelect, value = '', placeholder = 'Search client or account...', disabled = false, style = {} }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = (text) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const sessionId = localStorage.getItem('sessionId');
        const res = await Meteor.callAsync('viewAs.search', text.trim(), sessionId);
        setResults(res?.entities || []);
        setIsOpen(true);
      } catch (err) {
        console.error('AccountAutocomplete search error:', err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);
  };

  const handleSelect = (entity, account) => {
    const entityName = entity.profile?.companyName
      || `${entity.profile?.firstName || ''} ${entity.profile?.lastName || ''}`.trim()
      || 'Unknown';
    const accountNameSuffix = account.name && account.name !== entityName ? ` "${account.name}"` : '';
    const label = `${entityName} — ${account.bankName || ''} ${account.accountNumber || ''}${accountNameSuffix} (${account.referenceCurrency || ''})`.trim();

    setQuery('');
    setIsOpen(false);
    setResults([]);

    onSelect({
      clientId: entity.migratedFromUserId || null,
      entityId: account.entityId || entity._id,
      bankAccountId: account._id,
      clientName: entityName,
      accountLabel: label
    });
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    onSelect({ clientId: '', bankAccountId: '', clientName: '', accountLabel: '' });
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid var(--border-color)',
    borderRadius: '6px',
    fontSize: '13px',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    outline: 'none',
    boxSizing: 'border-box',
    ...style
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {value ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: '6px',
          border: '1px solid var(--border-color)', fontSize: '13px'
        }}>
          <span style={{ flex: 1, color: 'var(--text-primary)', fontWeight: '500' }}>{value}</span>
          {!disabled && (
            <span onClick={handleClear} style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '16px', lineHeight: 1 }}>&times;</span>
          )}
        </div>
      ) : (
        <input
          type="text"
          style={inputStyle}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}

      {isOpen && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, right: 0,
          background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
          borderRadius: '6px 6px 0 0', maxHeight: '300px', overflowY: 'auto',
          zIndex: 200, boxShadow: '0 -4px 16px rgba(0,0,0,0.2)'
        }}>
          {isSearching && (
            <div style={{ padding: '10px 14px', fontSize: '12px', color: 'var(--text-muted)' }}>Searching...</div>
          )}
          {!isSearching && results.length === 0 && query.length >= 2 && (
            <div style={{ padding: '10px 14px', fontSize: '12px', color: 'var(--text-muted)' }}>No results</div>
          )}
          {results.map(entity => {
            const entityName = entity.profile?.companyName
              || `${entity.profile?.firstName || ''} ${entity.profile?.lastName || ''}`.trim()
              || 'Unknown';
            const accounts = entity.accounts || [];
            if (accounts.length === 0) return null;

            return (
              <div key={entity._id}>
                <div style={{ padding: '6px 14px', fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--bg-secondary)' }}>
                  {entityName}
                  {entity.type === 'company' && <span style={{ marginLeft: '6px', fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: 'rgba(99,102,241,0.15)', color: '#6366f1' }}>Company</span>}
                </div>
                {accounts.map(account => (
                  <div
                    key={account._id}
                    onClick={() => handleSelect(entity, account)}
                    style={{
                      padding: '8px 14px 8px 24px', cursor: 'pointer', fontSize: '13px',
                      color: 'var(--text-primary)', transition: 'background 0.1s',
                      borderBottom: '1px solid var(--border-color)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontWeight: '500' }}>{account.bankName || ''}</span>
                    <span style={{ marginLeft: '6px', color: 'var(--text-secondary)' }}>{account.accountNumber || ''}</span>
                    {account.name && account.name !== entityName && <span style={{ marginLeft: '6px', color: 'var(--text-muted)', fontSize: '12px' }}>({account.name})</span>}
                    <span style={{ marginLeft: '8px', fontSize: '11px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(79,166,255,0.1)', color: '#4da6ff' }}>{account.referenceCurrency || ''}</span>
                    {account.ownerName && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#f59e0b' }}>via {account.ownerName}</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
