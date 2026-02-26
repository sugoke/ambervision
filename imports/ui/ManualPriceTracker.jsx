import React, { useState, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ManualPriceTrackersCollection } from '../api/manualPriceTrackers.js';

export default function ManualPriceTracker({ user }) {
  const sessionId = localStorage.getItem('sessionId');

  // State
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [scrapingIds, setScrapingIds] = useState(new Set());
  const [isScrapeAll, setIsScrapeAll] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', message }

  // Form state
  const [formIsin, setFormIsin] = useState('');
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formCurrency, setFormCurrency] = useState('EUR');

  // Subscribe to trackers
  const { trackers, isLoading } = useTracker(() => {
    const handle = Meteor.subscribe('manualPriceTrackers', sessionId);
    return {
      trackers: ManualPriceTrackersCollection.find({}, { sort: { name: 1 } }).fetch(),
      isLoading: !handle.ready()
    };
  }, [sessionId]);

  // Filtered trackers
  const filteredTrackers = useMemo(() => {
    if (!searchTerm) return trackers;
    const term = searchTerm.toLowerCase();
    return trackers.filter(t =>
      t.name.toLowerCase().includes(term) ||
      t.isin.toLowerCase().includes(term) ||
      t.url.toLowerCase().includes(term)
    );
  }, [trackers, searchTerm]);

  // Toast notification helpers
  const showSuccess = (message) => {
    setToast({ type: 'success', message });
    setTimeout(() => setToast(null), 4000);
  };

  const showError = (message) => {
    setToast({ type: 'error', message });
    setTimeout(() => setToast(null), 6000);
  };

  // Reset form
  const resetForm = () => {
    setFormIsin('');
    setFormName('');
    setFormUrl('');
    setFormCurrency('EUR');
    setShowAddForm(false);
    setEditingId(null);
  };

  // Start editing
  const startEdit = (tracker) => {
    setEditingId(tracker._id);
    setFormIsin(tracker.isin);
    setFormName(tracker.name);
    setFormUrl(tracker.url);
    setFormCurrency(tracker.currency);
    setShowAddForm(true);
  };

  // Add or update tracker
  const handleSubmit = async () => {
    if (!formIsin.trim() || !formName.trim() || !formUrl.trim()) {
      showError('ISIN, Name, and URL are required');
      return;
    }

    try {
      if (editingId) {
        await Meteor.callAsync('manualPriceTrackers.update', {
          id: editingId,
          name: formName.trim(),
          url: formUrl.trim(),
          currency: formCurrency,
          sessionId
        });
        showSuccess(`Updated tracker: ${formName}`);
      } else {
        await Meteor.callAsync('manualPriceTrackers.add', {
          isin: formIsin.trim(),
          name: formName.trim(),
          url: formUrl.trim(),
          currency: formCurrency,
          sessionId
        });
        showSuccess(`Added tracker: ${formName}`);
      }
      resetForm();
    } catch (error) {
      showError(error.reason || error.message);
    }
  };

  // Remove tracker
  const handleRemove = async (id, name) => {
    if (!confirm(`Remove tracker "${name}"?`)) return;
    try {
      await Meteor.callAsync('manualPriceTrackers.remove', { id, sessionId });
      showSuccess(`Removed tracker: ${name}`);
    } catch (error) {
      showError(error.reason || error.message);
    }
  };

  // Scrape single
  const handleScrape = async (id) => {
    setScrapingIds(prev => new Set([...prev, id]));
    try {
      const result = await Meteor.callAsync('manualPriceTrackers.scrape', { id, sessionId });
      showSuccess(`Scraped price: ${result.price} (confidence: ${result.confidence})`);
    } catch (error) {
      showError(`Scrape failed: ${error.reason || error.message}`);
    } finally {
      setScrapingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Scrape all
  const handleScrapeAll = async () => {
    setIsScrapeAll(true);
    try {
      const result = await Meteor.callAsync('manualPriceTrackers.scrapeAll', { sessionId });
      const msg = `Scrape complete: ${result.success} success, ${result.failed} failed`;
      if (result.failed > 0) {
        showError(msg);
      } else {
        showSuccess(msg);
      }
    } catch (error) {
      showError(`Scrape all failed: ${error.reason || error.message}`);
    } finally {
      setIsScrapeAll(false);
    }
  };

  // Status indicator
  const getStatusInfo = (tracker) => {
    if (tracker.lastScrapeError) {
      return { color: '#ef4444', label: 'Error' };
    }
    if (!tracker.lastScrapedAt) {
      return { color: '#6b7280', label: 'Never scraped' };
    }
    const hoursSince = (Date.now() - new Date(tracker.lastScrapedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      return { color: '#10b981', label: 'Fresh' };
    }
    return { color: '#f59e0b', label: 'Stale' };
  };

  // Format date
  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  if (isLoading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading trackers...
      </div>
    );
  }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          padding: '10px 16px',
          marginBottom: '1rem',
          borderRadius: '6px',
          fontSize: '0.85rem',
          background: toast.type === 'success' ? '#065f4620' : '#ef444420',
          color: toast.type === 'success' ? '#10b981' : '#ef4444',
          border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: 'inherit',
            cursor: 'pointer', fontSize: '1rem', padding: '0 4px'
          }}>x</button>
        </div>
      )}

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        gap: '0.5rem'
      }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.1rem' }}>
          Manual Price Tracker
          <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: '0.85rem', marginLeft: '0.5rem' }}>
            ({trackers.length} instruments)
          </span>
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleScrapeAll}
            disabled={isScrapeAll || trackers.length === 0}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              cursor: isScrapeAll || trackers.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '0.85rem',
              opacity: isScrapeAll || trackers.length === 0 ? 0.5 : 1
            }}
          >
            {isScrapeAll ? 'Scraping...' : 'Scrape All'}
          </button>
          <button
            onClick={() => { resetForm(); setShowAddForm(!showAddForm); }}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--accent-color)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.85rem'
            }}
          >
            {showAddForm && !editingId ? 'Cancel' : '+ Add Instrument'}
          </button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div style={{
          background: 'var(--bg-tertiary)',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem',
          border: '1px solid var(--border-color)'
        }}>
          <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-primary)', fontSize: '0.95rem' }}>
            {editingId ? 'Edit Instrument' : 'Add New Instrument'}
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>ISIN</label>
              <input
                type="text"
                value={formIsin}
                onChange={(e) => setFormIsin(e.target.value)}
                disabled={!!editingId}
                placeholder="CH1234567890"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: editingId ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Instrument name"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Currency</label>
              <select
                value={formCurrency}
                onChange={(e) => setFormCurrency(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box'
                }}
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="CHF">CHF</option>
                <option value="GBP">GBP</option>
                <option value="ILS">ILS</option>
                <option value="JPY">JPY</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>URL</label>
              <input
                type="text"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://example.com/price-page"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              onClick={resetForm}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--accent-color)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              {editingId ? 'Save Changes' : 'Add Instrument'}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      {trackers.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, ISIN, or URL..."
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              boxSizing: 'border-box'
            }}
          />
        </div>
      )}

      {/* Table */}
      {filteredTrackers.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          {trackers.length === 0 ? 'No instruments tracked yet. Add one above.' : 'No results matching search.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                {['ISIN', 'Name', 'URL', 'Currency', 'Latest Price', 'Last Updated', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{
                    padding: '8px 10px',
                    textAlign: 'left',
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    whiteSpace: 'nowrap'
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredTrackers.map(tracker => {
                const status = getStatusInfo(tracker);
                const isScraping = scrapingIds.has(tracker._id);
                const isExpanded = expandedId === tracker._id;

                return (
                  <React.Fragment key={tracker._id}>
                    <tr style={{
                      borderBottom: '1px solid var(--border-color)',
                      transition: 'background 0.15s',
                    }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '0.8rem' }}>{tracker.isin}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 500, color: 'var(--text-primary)' }}>{tracker.name}</td>
                      <td style={{ padding: '8px 10px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={tracker.url} target="_blank" rel="noopener noreferrer"
                          style={{ color: 'var(--accent-color)', textDecoration: 'none' }}
                          title={tracker.url}
                        >
                          {tracker.url.replace(/^https?:\/\//, '').substring(0, 40)}{tracker.url.length > 47 ? '...' : ''}
                        </a>
                      </td>
                      <td style={{ padding: '8px 10px' }}>{tracker.currency}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {tracker.latestPrice !== null && tracker.latestPrice !== undefined
                          ? tracker.latestPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                          : '-'
                        }
                      </td>
                      <td style={{ padding: '8px 10px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {formatDate(tracker.lastScrapedAt)}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: status.color,
                          marginRight: '6px'
                        }} />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{status.label}</span>
                        {tracker.lastScrapeError && (
                          <span title={tracker.lastScrapeError} style={{ marginLeft: '4px', cursor: 'help' }}>
                            (?)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => handleScrape(tracker._id)}
                          disabled={isScraping || isScrapeAll}
                          title="Scrape price now"
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            cursor: isScraping || isScrapeAll ? 'not-allowed' : 'pointer',
                            fontSize: '0.8rem',
                            marginRight: '4px',
                            opacity: isScraping || isScrapeAll ? 0.5 : 1
                          }}
                        >
                          {isScraping ? '...' : 'Scrape'}
                        </button>
                        <button
                          onClick={() => startEdit(tracker)}
                          title="Edit"
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            marginRight: '4px'
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleRemove(tracker._id, tracker.name)}
                          title="Delete"
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid #ef4444',
                            background: 'transparent',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            marginRight: '4px'
                          }}
                        >
                          Del
                        </button>
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : tracker._id)}
                          title={isExpanded ? 'Hide history' : 'Show history'}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.8rem'
                          }}
                        >
                          {isExpanded ? 'Hide' : 'History'}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded price history */}
                    {isExpanded && tracker.priceHistory && tracker.priceHistory.length > 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: '0 10px 12px 10px', background: 'var(--bg-tertiary)' }}>
                          <div style={{ padding: '8px 0' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                              Price History (last 30)
                            </span>
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                              gap: '4px',
                              marginTop: '6px'
                            }}>
                              {tracker.priceHistory.slice(0, 30).map((h, i) => (
                                <div key={i} style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  background: 'var(--bg-primary)',
                                  fontSize: '0.78rem'
                                }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>{h.date}</span>
                                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                    {h.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {isExpanded && (!tracker.priceHistory || tracker.priceHistory.length === 0) && (
                      <tr>
                        <td colSpan={8} style={{ padding: '8px 10px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                          No price history yet.
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
