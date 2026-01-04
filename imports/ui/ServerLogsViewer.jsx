import React, { useEffect, useRef, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ServerLogsCollection } from '../api/serverLogs.js';

/**
 * ServerLogsViewer - Real-time server log viewer for admin panel
 * Features:
 * - Auto-scroll to latest logs
 * - Filter by level (info/warn/error)
 * - Search by text
 * - 20-minute retention (handled by TTL index)
 */
const ServerLogsViewer = ({ sessionId }) => {
  const logsEndRef = useRef(null);
  const containerRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('all'); // all, info, warn, error
  const [search, setSearch] = useState('');

  // Subscribe to server logs
  const { logs, isLoading } = useTracker(() => {
    const handle = Meteor.subscribe('serverLogs', sessionId, 1000);

    if (!handle.ready()) {
      return { logs: [], isLoading: true };
    }

    // Build query based on filters
    const query = {};
    if (filter !== 'all') {
      query.level = filter;
    }
    if (search) {
      query.message = { $regex: search, $options: 'i' };
    }

    const logs = ServerLogsCollection.find(query, {
      sort: { createdAt: 1 }, // Oldest first for natural reading order
      limit: 1000
    }).fetch();

    return { logs, isLoading: false };
  }, [sessionId, filter, search]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Detect manual scroll to pause auto-scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const getLevelStyle = (level) => {
    switch (level) {
      case 'error':
        return { color: '#ef4444', fontWeight: 600 };
      case 'warn':
        return { color: '#f59e0b', fontWeight: 500 };
      default:
        return { color: '#9ca3af' };
    }
  };

  const getLevelBadge = (level) => {
    const colors = {
      info: { bg: '#1e3a5f', text: '#60a5fa' },
      warn: { bg: '#4a3728', text: '#fbbf24' },
      error: { bg: '#4a2828', text: '#f87171' }
    };
    const style = colors[level] || colors.info;
    return (
      <span style={{
        backgroundColor: style.bg,
        color: style.text,
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        marginRight: '8px'
      }}>
        {level}
      </span>
    );
  };

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div style={styles.container}>
      {/* Header with filters */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h3 style={styles.title}>Server Logs</h3>
          <span style={styles.count}>
            {logs.length} logs (last 20 min)
          </span>
        </div>
        <div style={styles.filters}>
          {/* Level filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={styles.select}
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warnings</option>
            <option value="error">Errors</option>
          </select>

          {/* Search */}
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />

          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            style={{
              ...styles.button,
              backgroundColor: autoScroll ? '#10b981' : '#4b5563'
            }}
          >
            {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          </button>
        </div>
      </div>

      {/* Logs container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={styles.logsContainer}
      >
        {isLoading ? (
          <div style={styles.loading}>Loading logs...</div>
        ) : logs.length === 0 ? (
          <div style={styles.empty}>No logs to display</div>
        ) : (
          logs.map((log) => (
            <div key={log._id} style={styles.logEntry}>
              <span style={styles.timestamp}>{formatTime(log.createdAt)}</span>
              {getLevelBadge(log.level)}
              <span style={{
                ...styles.message,
                ...getLevelStyle(log.level)
              }}>
                {log.message}
              </span>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#0d1117',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: '#161b22',
    borderBottom: '1px solid #30363d',
    flexWrap: 'wrap',
    gap: '10px'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  title: {
    margin: 0,
    fontSize: '1rem',
    fontWeight: 600,
    color: '#e6edf3'
  },
  count: {
    fontSize: '0.8rem',
    color: '#7d8590',
    backgroundColor: '#21262d',
    padding: '4px 8px',
    borderRadius: '12px'
  },
  filters: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  select: {
    backgroundColor: '#21262d',
    color: '#e6edf3',
    border: '1px solid #30363d',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '0.85rem',
    cursor: 'pointer',
    outline: 'none'
  },
  searchInput: {
    backgroundColor: '#21262d',
    color: '#e6edf3',
    border: '1px solid #30363d',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '0.85rem',
    width: '200px',
    outline: 'none'
  },
  button: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: 'none',
    color: 'white',
    fontSize: '0.8rem',
    fontWeight: 500,
    cursor: 'pointer'
  },
  logsContainer: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
    fontSize: '0.8rem',
    lineHeight: 1.5
  },
  logEntry: {
    display: 'flex',
    alignItems: 'flex-start',
    padding: '4px 8px',
    borderRadius: '4px',
    marginBottom: '2px'
  },
  timestamp: {
    color: '#7d8590',
    marginRight: '12px',
    flexShrink: 0,
    fontSize: '0.75rem'
  },
  message: {
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap'
  },
  loading: {
    color: '#7d8590',
    textAlign: 'center',
    padding: '20px'
  },
  empty: {
    color: '#7d8590',
    textAlign: 'center',
    padding: '40px'
  }
};

export default ServerLogsViewer;
