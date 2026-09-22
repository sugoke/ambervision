import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useIsMobile } from '../hooks/useIsMobile.js';

/**
 * DataFreshnessBadge Component
 *
 * Shows a single bank's data freshness status as a colored badge
 */
export const DataFreshnessBadge = ({
  bankName,
  dataDateFormatted,
  status,
  statusIcon,
  message,
  lastError,
  compact = false
}) => {
  const getStatusStyles = () => {
    switch (status) {
      case 'fresh':
        return {
          background: 'linear-gradient(135deg, var(--gain-color) 0%, #059669 100%)',
          borderColor: '#059669',
          textColor: '#ffffff'
        };
      case 'stale':
        return {
          background: 'linear-gradient(135deg, var(--warning-color) 0%, #d97706 100%)',
          borderColor: '#d97706',
          textColor: '#ffffff'
        };
      case 'old':
        return {
          background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
          borderColor: '#ea580c',
          textColor: '#ffffff'
        };
      case 'error':
        return {
          background: 'linear-gradient(135deg, var(--loss-color) 0%, #dc2626 100%)',
          borderColor: '#dc2626',
          textColor: '#ffffff'
        };
      default:
        return {
          background: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
          borderColor: '#4b5563',
          textColor: '#ffffff'
        };
    }
  };

  const styles = getStatusStyles();
  const isMobileView = useIsMobile();

  if (compact) {
    return (
      <span
        title={`${bankName}: ${message}${lastError ? ` - ${lastError}` : ''}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '2px 8px',
          borderRadius: '12px',
          background: styles.background,
          color: styles.textColor,
          fontSize: '12px',
          fontWeight: '500',
          cursor: 'help'
        }}
      >
        <span>{statusIcon}</span>
        <span>{bankName}</span>
      </span>
    );
  }

  // On a phone the badges stack, so one takes the full row: the bank name gets
  // the space it needs and the date sits against the right edge.
  return (
    <div
      title={lastError && status === 'error' ? lastError : undefined}
      style={{
        display: isMobileView ? 'flex' : 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        borderRadius: '8px',
        background: styles.background,
        color: styles.textColor,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        flex: 'none',
        width: isMobileView ? '100%' : 'auto',
        minWidth: 0,
        boxSizing: 'border-box'
      }}
    >
      <span style={{ fontSize: '13px', lineHeight: 1, flex: 'none' }}>{statusIcon}</span>
      <span style={{
        fontWeight: '600',
        fontSize: '12px',
        // A long bank name truncates rather than pushing the row wider than
        // the screen; the full name stays in the title tooltip.
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>{bankName}</span>
      <span style={{
        fontSize: '12px',
        opacity: 0.9,
        whiteSpace: 'nowrap',
        marginLeft: isMobileView ? 'auto' : 0,
        flex: 'none'
      }}>
        {status === 'error' ? 'Sync Failed' : dataDateFormatted}
      </span>
    </div>
  );
};

/**
 * DataFreshnessWarning Component
 *
 * Shows a warning banner when data is stale or has errors
 */
export const DataFreshnessWarning = ({ banks, hasStaleData, hasErrors }) => {
  if (!hasStaleData && !hasErrors) return null;

  const staleCount = banks.filter(b => b.status === 'stale' || b.status === 'old').length;
  const errorCount = banks.filter(b => b.status === 'error').length;

  const staleBanks = banks.filter(b => b.status === 'stale' || b.status === 'old');
  const errorBanks = banks.filter(b => b.status === 'error');

  let message = '';
  if (errorCount > 0 && staleCount > 0) {
    message = `${errorBanks.map(b => b.bankName).join(', ')} sync failed. ${staleBanks.map(b => `${b.bankName} data is ${b.businessDaysOld} day(s) old`).join('. ')}.`;
  } else if (errorCount > 0) {
    message = `${errorBanks.map(b => b.bankName).join(', ')} sync failed.`;
  } else {
    message = staleBanks.map(b => `${b.bankName} data is ${b.businessDaysOld} day(s) old`).join('. ') + '.';
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        borderRadius: '8px',
        background: hasErrors
          ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(220, 38, 38, 0.15) 100%)'
          : 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.15) 100%)',
        border: `1px solid ${hasErrors ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
        marginBottom: '16px'
      }}
    >
      <span style={{ fontSize: '20px' }}>{hasErrors ? '🔴' : '⚠️'}</span>
      <div>
        <div style={{ fontWeight: '600', color: hasErrors ? '#dc2626' : '#d97706', fontSize: '14px' }}>
          {hasErrors ? 'Data Sync Issues' : 'Stale Data Warning'}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {message}
        </div>
      </div>
    </div>
  );
};

/**
 * DataFreshnessPanel Component
 *
 * Full panel showing all bank freshness statuses with optional warning
 */
export const DataFreshnessPanel = ({
  sessionId,
  userId,
  showWarning = true,
  compact = false,
  visibleBankIds = null, // Optional: filter to only show these bank IDs
  onLoad
}) => {
  const [freshnessData, setFreshnessData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Declared with the other hooks: the early returns below would otherwise
  // make the hook order vary between renders.
  const isMobileView = useIsMobile();

  useEffect(() => {
    console.log('[DataFreshness] useEffect - sessionId:', sessionId, 'userId:', userId, 'visibleBankIds:', visibleBankIds);
    if (!sessionId) {
      console.log('[DataFreshness] No sessionId, skipping fetch');
      setLoading(false);
      return;
    }

    setLoading(true);
    Meteor.call('pms.getDataFreshness', { sessionId, userId }, (err, result) => {
      console.log('[DataFreshness] Method result:', err, result);
      setLoading(false);
      if (err) {
        console.error('[DataFreshness] Error:', err);
        setError(err.reason || 'Failed to load freshness data');
      } else {
        setFreshnessData(result);
        if (onLoad) onLoad(result);
      }
    });
  }, [sessionId, userId]);

  if (loading) {
    return (
      <div style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
        Loading data status...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '8px', color: 'var(--loss-color)', fontSize: '13px' }}>
        {error}
      </div>
    );
  }

  if (!freshnessData || freshnessData.banks.length === 0) {
    // Debug: show message when no banks found
    console.log('[DataFreshness] No banks found, freshnessData:', freshnessData);
    return null;
  }

  // Filter banks to only show those in the visible scope (if provided)
  const filteredBanks = visibleBankIds && visibleBankIds.length > 0
    ? freshnessData.banks.filter(bank => visibleBankIds.includes(bank.bankId))
    : freshnessData.banks;

  if (filteredBanks.length === 0) {
    return null;
  }

  // Recalculate status flags based on filtered banks
  const hasStaleData = filteredBanks.some(r => r.status === 'stale' || r.status === 'old');
  const hasErrors = filteredBanks.some(r => r.status === 'error');

  return (
    <div style={{ width: isMobileView ? '100%' : 'auto', minWidth: 0 }}>
      {showWarning && (
        <DataFreshnessWarning
          banks={filteredBanks}
          hasStaleData={hasStaleData}
          hasErrors={hasErrors}
        />
      )}

      {/* Phones stack the badges: a horizontal row of them ran off the right
          edge of the screen, and a scroll strip hid banks nobody thought to
          swipe for. Wider viewports keep the wrapping row. */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobileView ? 'column' : 'row',
          flexWrap: isMobileView ? 'nowrap' : 'wrap',
          // Compact pills keep their natural width; full badges take the row.
          alignItems: isMobileView ? (compact ? 'flex-start' : 'stretch') : 'center',
          gap: compact ? '8px' : (isMobileView ? '8px' : '12px'),
          width: isMobileView ? '100%' : 'auto',
          minWidth: 0
        }}
      >
        {filteredBanks.map((bank) => (
          <DataFreshnessBadge
            key={bank.connectionId}
            {...bank}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
};

export default DataFreshnessPanel;
