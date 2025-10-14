import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';

/**
 * Cron Jobs Dashboard - Admin Interface
 *
 * Displays scheduled job status, execution logs, statistics, and manual triggers
 * Available to admin and superadmin users only
 */
const CronJobsDashboard = ({ user }) => {
  const [loading, setLoading] = useState(true);
  const [schedule, setSchedule] = useState([]);
  const [stats, setStats] = useState({});
  const [logs, setLogs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [triggering, setTriggering] = useState(null);
  const [expandedLog, setExpandedLog] = useState(null);
  const [error, setError] = useState(null);

  const sessionId = localStorage.getItem('sessionId');
  const isSuperAdmin = user?.role === 'superadmin';

  // Load data on mount
  useEffect(() => {
    loadDashboardData();

    // Refresh every 30 seconds
    const interval = setInterval(loadDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadDashboardData = async () => {
    try {
      setError(null);

      // Load schedule
      const scheduleData = await new Promise((resolve, reject) => {
        Meteor.call('cronJobs.getSchedule', sessionId, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      setSchedule(scheduleData);

      // Load stats for all jobs
      const statsData = await new Promise((resolve, reject) => {
        Meteor.call('cronJobLogs.getAllStats', sessionId, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      setStats(statsData);

      // Load recent logs
      const logsData = await new Promise((resolve, reject) => {
        Meteor.call('cronJobLogs.getRecent', selectedJob, 50, sessionId, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      setLogs(logsData);

      setLoading(false);
    } catch (err) {
      console.error('Failed to load cron dashboard data:', err);
      setError(err.message || 'Failed to load dashboard data');
      setLoading(false);
    }
  };

  const handleTriggerJob = async (jobName) => {
    if (!isSuperAdmin) {
      alert('Only superadmin users can manually trigger jobs');
      return;
    }

    if (!confirm(`Manually trigger ${jobName}? This will run the job immediately.`)) {
      return;
    }

    setTriggering(jobName);
    try {
      const methodName = jobName === 'marketDataRefresh'
        ? 'cronJobs.triggerMarketDataRefresh'
        : 'cronJobs.triggerProductRevaluation';

      await new Promise((resolve, reject) => {
        Meteor.call(methodName, sessionId, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      alert(`${jobName} triggered successfully!`);

      // Reload data after a short delay to see results
      setTimeout(loadDashboardData, 2000);
    } catch (err) {
      console.error(`Failed to trigger ${jobName}:`, err);
      alert(`Failed to trigger job: ${err.message}`);
    } finally {
      setTriggering(null);
    }
  };

  const formatDate = (date) => {
    if (!date) return 'Never';
    const d = new Date(date);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (ms) => {
    if (!ms) return 'N/A';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading cron jobs dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: '2rem',
        background: 'var(--error-bg)',
        border: '1px solid var(--error-color)',
        borderRadius: '8px',
        color: 'var(--error-color)'
      }}>
        <strong>Error:</strong> {error}
        <button
          onClick={loadDashboardData}
          style={{
            marginLeft: '1rem',
            padding: '0.5rem 1rem',
            background: 'var(--accent-color)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Header with Refresh Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            Scheduled Jobs
          </h3>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            Nightly market data refresh and product re-evaluation
          </p>
        </div>
        <button
          onClick={loadDashboardData}
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '0.9rem',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.borderColor = 'var(--accent-color)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)';
            e.currentTarget.style.borderColor = 'var(--border-color)';
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Job Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        {schedule.map((job) => {
          const jobStats = stats[job.name] || {};
          const statusColor = jobStats.lastRun?.status === 'success' ? '#10b981' :
                            jobStats.lastRun?.status === 'error' ? '#ef4444' : '#6b7280';

          return (
            <div
              key={job.name}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
              }}
            >
              {/* Job Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h4 style={{
                    margin: '0 0 0.25rem 0',
                    fontSize: '1rem',
                    color: 'var(--text-primary)',
                    fontWeight: '600'
                  }}>
                    {job.name === 'marketDataRefresh' ? '📊 Market Data Refresh' : '🔄 Product Re-evaluation'}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {job.name === 'marketDataRefresh'
                      ? 'Fetches latest market data'
                      : 'Re-evaluates live products'}
                  </p>
                </div>
                {jobStats.lastRun && (
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: statusColor,
                      boxShadow: `0 0 8px ${statusColor}`
                    }}
                    title={jobStats.lastRun.status}
                  />
                )}
              </div>

              {/* Schedule Info */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Next Run:</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                    {formatDate(job.nextScheduledRun)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Last Run:</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                    {formatDate(job.lastFinishedAt)}
                  </span>
                </div>
              </div>

              {/* Stats */}
              {jobStats.totalRuns > 0 && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '0.5rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid var(--border-color)'
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                      {jobStats.totalRuns}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: '600', color: '#10b981' }}>
                      {jobStats.successRate?.toFixed(0)}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Success</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                      {formatDuration(jobStats.avgDuration)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Avg Time</div>
                  </div>
                </div>
              )}

              {/* Manual Trigger Button */}
              {isSuperAdmin && (
                <button
                  onClick={() => handleTriggerJob(job.name)}
                  disabled={triggering === job.name}
                  style={{
                    padding: '0.75rem',
                    background: triggering === job.name ? 'var(--bg-secondary)' : 'var(--accent-color)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: triggering === job.name ? 'not-allowed' : 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: '500',
                    transition: 'all 0.2s ease',
                    opacity: triggering === job.name ? 0.6 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (triggering !== job.name) {
                      e.currentTarget.style.background = 'var(--accent-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (triggering !== job.name) {
                      e.currentTarget.style.background = 'var(--accent-color)';
                    }
                  }}
                >
                  {triggering === job.name ? '⏳ Running...' : '▶️ Trigger Now'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent Execution Logs */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            Recent Executions
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setSelectedJob(null)}
              style={{
                padding: '0.5rem 1rem',
                background: selectedJob === null ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                color: selectedJob === null ? 'white' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              All Jobs
            </button>
            <button
              onClick={() => setSelectedJob('marketDataRefresh')}
              style={{
                padding: '0.5rem 1rem',
                background: selectedJob === 'marketDataRefresh' ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                color: selectedJob === 'marketDataRefresh' ? 'white' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              Market Data
            </button>
            <button
              onClick={() => setSelectedJob('productRevaluation')}
              style={{
                padding: '0.5rem 1rem',
                background: selectedJob === 'productRevaluation' ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                color: selectedJob === 'productRevaluation' ? 'white' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              Re-evaluation
            </button>
          </div>
        </div>

        {/* Logs Table */}
        <div style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          {logs.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No execution logs found
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: '600' }}>Status</th>
                    <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: '600' }}>Job</th>
                    <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: '600' }}>Started</th>
                    <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: '600' }}>Duration</th>
                    <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: '600' }}>Results</th>
                    <th style={{ padding: '1rem', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: '600' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, index) => {
                    const isExpanded = expandedLog === log._id;
                    const hasErrors = log.status === 'error' || (log.details?.errors && log.details.errors.length > 0);

                    return (
                      <React.Fragment key={log._id}>
                        <tr style={{
                          borderBottom: '1px solid var(--border-color)',
                          background: index % 2 === 0 ? 'transparent' : 'var(--bg-secondary)'
                        }}>
                          <td style={{ padding: '1rem' }}>
                            <span style={{
                              padding: '0.25rem 0.75rem',
                              borderRadius: '12px',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              background: log.status === 'success' ? '#10b98120' :
                                        log.status === 'error' ? '#ef444420' : '#6b728020',
                              color: log.status === 'success' ? '#10b981' :
                                    log.status === 'error' ? '#ef4444' : '#6b7280'
                            }}>
                              {log.status === 'success' ? '✓ Success' :
                               log.status === 'error' ? '✗ Error' : '● Running'}
                            </span>
                          </td>
                          <td style={{ padding: '1rem', color: 'var(--text-primary)', fontWeight: '500' }}>
                            {log.jobName === 'marketDataRefresh' ? '📊 Market Data' : '🔄 Re-evaluation'}
                          </td>
                          <td style={{ padding: '1rem', color: 'var(--text-primary)' }}>
                            {formatDate(log.startTime)}
                          </td>
                          <td style={{ padding: '1rem', color: 'var(--text-primary)' }}>
                            {formatDuration(log.duration)}
                          </td>
                          <td style={{ padding: '1rem', color: 'var(--text-primary)' }}>
                            {log.jobName === 'marketDataRefresh' ? (
                              <span>
                                {log.tickersSucceeded || 0}/{log.tickersProcessed || 0} tickers
                                {log.tickersFailed > 0 && (
                                  <span style={{ color: '#ef4444', marginLeft: '0.5rem' }}>
                                    ({log.tickersFailed} failed)
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span>
                                {log.productsSucceeded || 0}/{log.productsProcessed || 0} products
                                {log.productsFailed > 0 && (
                                  <span style={{ color: '#ef4444', marginLeft: '0.5rem' }}>
                                    ({log.productsFailed} failed)
                                  </span>
                                )}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '1rem' }}>
                            {(hasErrors || log.errorMessage) && (
                              <button
                                onClick={() => setExpandedLog(isExpanded ? null : log._id)}
                                style={{
                                  padding: '0.25rem 0.75rem',
                                  background: 'var(--error-bg)',
                                  color: 'var(--error-color)',
                                  border: '1px solid var(--error-color)',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '0.75rem',
                                  fontWeight: '500'
                                }}
                              >
                                {isExpanded ? '▲ Hide Errors' : '▼ Show Errors'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (hasErrors || log.errorMessage) && (
                          <tr style={{ background: 'var(--bg-secondary)' }}>
                            <td colSpan="6" style={{ padding: '1rem' }}>
                              <div style={{
                                background: 'var(--error-bg)',
                                border: '1px solid var(--error-color)',
                                borderRadius: '6px',
                                padding: '1rem',
                                color: 'var(--error-color)'
                              }}>
                                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', fontWeight: '600' }}>
                                  Error Details
                                </h4>
                                {log.errorMessage && (
                                  <div style={{ marginBottom: '1rem' }}>
                                    <strong>Error:</strong> {log.errorMessage}
                                  </div>
                                )}
                                {log.errorStack && (
                                  <pre style={{
                                    fontSize: '0.75rem',
                                    overflow: 'auto',
                                    padding: '0.5rem',
                                    background: 'rgba(0,0,0,0.2)',
                                    borderRadius: '4px',
                                    marginBottom: '1rem'
                                  }}>
                                    {log.errorStack}
                                  </pre>
                                )}
                                {log.details?.errors && log.details.errors.length > 0 && (
                                  <div>
                                    <strong>Failed Items:</strong>
                                    <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.5rem' }}>
                                      {log.details.errors.map((err, i) => (
                                        <li key={i} style={{ marginBottom: '0.5rem' }}>
                                          {err.ticker || err.productId || 'Unknown'}: {err.error}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
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
      </div>
    </div>
  );
};

export default CronJobsDashboard;
