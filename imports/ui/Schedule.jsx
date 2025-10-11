import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { useTracker } from 'meteor/react-meteor-data';

// Create a client-side collection to receive the published schedule data
const ObservationScheduleCollection = new Mongo.Collection('observationSchedule');

const Schedule = ({ user }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const nextObservationRef = useRef(null);

  // Subscribe to schedule observations
  const { observations, isLoading } = useTracker(() => {
    const sessionId = localStorage.getItem('sessionId');
    const handle = Meteor.subscribe('schedule.observations', sessionId);

    const obs = ObservationScheduleCollection.find(
      {},
      { sort: { observationDate: 1 } }
    ).fetch();

    return {
      observations: obs,
      isLoading: !handle.ready()
    };
  }, []);

  // Find the next observation (first future or today's observation)
  // Server now provides isPast flag, so we find first non-past observation
  const nextObservationIndex = observations.findIndex(obs => !obs.isPast);

  // Auto-scroll to next observation on initial load
  useEffect(() => {
    if (!isLoading && nextObservationRef.current) {
      // Wait for DOM to render, then scroll
      setTimeout(() => {
        nextObservationRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }, 100);
    }
  }, [isLoading, observations.length]);

  // Handle manual refresh - triggers server-side recalculation
  const handleRefresh = () => {
    setIsRefreshing(true);

    // Resubscribe to force server-side refresh and recalculation
    const sessionId = localStorage.getItem('sessionId');
    Meteor.subscribe('schedule.observations', sessionId, {
      onReady: () => {
        setIsRefreshing(false);
      },
      onError: (error) => {
        console.error('Error refreshing schedule:', error);
        setIsRefreshing(false);
      }
    });
  };

  // Get observation type display text
  const getObservationTypeDisplay = (obs) => {
    if (obs.isFinal) return 'Final Observation';
    if (obs.observationType === 'coupon') return 'Coupon Observation';
    if (obs.isCallable) return 'Autocall Observation';
    return obs.observationType || 'Observation';
  };

  // Get observation type badge color
  const getObservationTypeBadgeStyle = (obs) => {
    if (obs.isFinal) {
      return {
        background: '#ef4444',
        color: 'white'
      };
    }
    if (obs.observationType === 'coupon') {
      return {
        background: '#10b981',
        color: 'white'
      };
    }
    if (obs.isCallable) {
      return {
        background: '#3b82f6',
        color: 'white'
      };
    }
    return {
      background: 'var(--bg-tertiary)',
      color: 'var(--text-secondary)'
    };
  };

  return (
    <div style={{
      padding: '2rem',
      maxWidth: '1400px',
      margin: '0 auto',
      minHeight: 'calc(100vh - 200px)'
    }}>
      {/* Header */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '12px',
        marginBottom: '1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        border: '1px solid var(--border-color)'
      }}>
        <div>
          <h1 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '1.8rem',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span>📅</span>
            <span>Observation Schedule</span>
          </h1>
          <p style={{
            margin: 0,
            color: 'var(--text-muted)',
            fontSize: '0.95rem'
          }}>
            Upcoming observation dates for all live products
          </p>
        </div>

        {/* Refresh Button */}
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          style={{
            padding: '0.75rem 1.5rem',
            background: isRefreshing ? 'var(--bg-tertiary)' : 'var(--accent-color)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: isRefreshing ? 'not-allowed' : 'pointer',
            fontSize: '0.95rem',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s ease',
            opacity: isRefreshing ? 0.6 : 1
          }}
          onMouseEnter={(e) => {
            if (!isRefreshing) {
              e.target.style.background = '#0056b3';
              e.target.style.transform = 'translateY(-2px)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isRefreshing) {
              e.target.style.background = 'var(--accent-color)';
              e.target.style.transform = 'translateY(0)';
            }
          }}
        >
          <span style={{
            animation: isRefreshing ? 'spin 1s linear infinite' : 'none'
          }}>
            🔄
          </span>
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          color: 'var(--text-secondary)'
        }}>
          <div style={{
            fontSize: '2rem',
            marginBottom: '1rem',
            animation: 'spin 1s linear infinite'
          }}>
            ⏳
          </div>
          <p>Loading schedule...</p>
        </div>
      )}

      {/* No Observations */}
      {!isLoading && observations.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '2px dashed var(--border-color)'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>
            📭
          </div>
          <h3 style={{
            margin: '0 0 0.5rem 0',
            color: 'var(--text-primary)'
          }}>
            No Upcoming Observations
          </h3>
          <p style={{
            margin: 0,
            color: 'var(--text-muted)'
          }}>
            There are no scheduled observations for your products
          </p>
        </div>
      )}

      {/* Observations Table */}
      {!isLoading && observations.length > 0 && (
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Fixed Header */}
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'fixed'
          }}>
            <thead>
              <tr style={{
                background: 'var(--bg-tertiary)',
                borderBottom: '2px solid var(--border-color)'
              }}>
                <th style={{
                  padding: '1rem',
                  textAlign: 'left',
                  color: 'var(--text-secondary)',
                  fontWeight: '600',
                  fontSize: '0.85rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '18%'
                }}>
                  Date
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'left',
                  color: 'var(--text-secondary)',
                  fontWeight: '600',
                  fontSize: '0.85rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '12%'
                }}>
                  Days Left
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'left',
                  color: 'var(--text-secondary)',
                  fontWeight: '600',
                  fontSize: '0.85rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '18%'
                }}>
                  Type
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'left',
                  color: 'var(--text-secondary)',
                  fontWeight: '600',
                  fontSize: '0.85rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '25%'
                }}>
                  Product Name
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'left',
                  color: 'var(--text-secondary)',
                  fontWeight: '600',
                  fontSize: '0.85rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '15%'
                }}>
                  ISIN
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'left',
                  color: 'var(--text-secondary)',
                  fontWeight: '600',
                  fontSize: '0.85rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '12%'
                }}>
                  Details
                </th>
              </tr>
            </thead>
          </table>

          {/* Scrollable Body - Shows 7 rows at a time */}
          <div style={{
            maxHeight: '420px',
            overflowY: 'auto',
            overflowX: 'hidden'
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              tableLayout: 'fixed'
            }}>
              <tbody>
                {observations.map((obs, index) => {
                  const isNextObservation = index === nextObservationIndex;

                  // Get color based on server-calculated daysLeftColor
                  const getDaysLeftColor = (colorKey) => {
                    switch (colorKey) {
                      case 'muted': return 'var(--text-muted)';
                      case 'urgent': return '#f59e0b';
                      case 'soon': return '#3b82f6';
                      default: return 'var(--text-primary)';
                    }
                  };

                  return (
                    <tr
                      key={obs._id}
                      ref={isNextObservation ? nextObservationRef : null}
                      style={{
                        borderBottom: index < observations.length - 1 ? '1px solid var(--border-color)' : 'none',
                        background: isNextObservation ? 'rgba(0, 123, 255, 0.1)' : 'transparent',
                        transition: 'background 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        if (!isNextObservation) {
                          e.currentTarget.style.background = 'var(--bg-tertiary)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isNextObservation) {
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                    >
                      <td style={{
                        padding: '1rem',
                        color: 'var(--text-primary)',
                        fontWeight: isNextObservation ? '600' : '400',
                        width: '18%'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {obs.isToday && (
                            <span style={{
                              background: '#f59e0b',
                              color: 'white',
                              padding: '0.25rem 0.5rem',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: '600'
                            }}>
                              TODAY
                            </span>
                          )}
                          {isNextObservation && !obs.isToday && (
                            <span style={{
                              background: 'var(--accent-color)',
                              color: 'white',
                              padding: '0.25rem 0.5rem',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: '600'
                            }}>
                              NEXT
                            </span>
                          )}
                          {obs.observationDateFormatted}
                        </div>
                      </td>
                      <td style={{
                        padding: '1rem',
                        color: getDaysLeftColor(obs.daysLeftColor),
                        fontWeight: '600',
                        width: '12%'
                      }}>
                        {obs.daysLeftText}
                      </td>
                      <td style={{
                        padding: '1rem',
                        width: '18%'
                      }}>
                        <span style={{
                          ...getObservationTypeBadgeStyle(obs),
                          padding: '0.4rem 0.8rem',
                          borderRadius: '6px',
                          fontSize: '0.85rem',
                          fontWeight: '500',
                          display: 'inline-block'
                        }}>
                          {getObservationTypeDisplay(obs)}
                        </span>
                      </td>
                      <td style={{
                        padding: '1rem',
                        color: 'var(--text-primary)',
                        fontWeight: '500',
                        width: '25%'
                      }}>
                        {obs.productTitle}
                      </td>
                      <td style={{
                        padding: '1rem',
                        color: 'var(--text-secondary)',
                        fontFamily: 'monospace',
                        fontSize: '0.9rem',
                        width: '15%'
                      }}>
                        {obs.productIsin}
                      </td>
                      <td style={{
                        padding: '1rem',
                        color: 'var(--text-secondary)',
                        fontSize: '0.9rem',
                        width: '12%'
                      }}>
                        {obs.couponRate && (
                          <div>Coupon: {obs.couponRate}%</div>
                        )}
                        {obs.autocallLevel && (
                          <div>Autocall: {obs.autocallLevel}%</div>
                        )}
                        {!obs.couponRate && !obs.autocallLevel && (
                          <div style={{ opacity: 0.5 }}>-</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary Stats */}
      {!isLoading && observations.length > 0 && (
        <div style={{
          marginTop: '1.5rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem'
        }}>
          <div style={{
            background: 'var(--bg-secondary)',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem'
            }}>
              Total Observations
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'var(--accent-color)'
            }}>
              {observations.length}
            </div>
          </div>

          <div style={{
            background: 'var(--bg-secondary)',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem'
            }}>
              Unique Products
            </div>
            <div style={{
              fontSize: '1.8rem',
              fontWeight: '700',
              color: 'var(--accent-color)'
            }}>
              {new Set(observations.map(obs => obs.productId)).size}
            </div>
          </div>

          <div style={{
            background: 'var(--bg-secondary)',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem'
            }}>
              Next Observation
            </div>
            <div style={{
              fontSize: '1.2rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              {nextObservationIndex >= 0
                ? observations[nextObservationIndex].observationDateFormatted
                : 'None'}
            </div>
          </div>
        </div>
      )}

      {/* Spin animation for loading/refresh icons */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default Schedule;
