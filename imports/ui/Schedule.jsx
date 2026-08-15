import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { useTracker } from 'meteor/react-meteor-data';
import { useViewAs } from './ViewAsContext.jsx';
import { useTheme } from './ThemeContext.jsx';
import { useIsMobile } from './hooks/useIsMobile.js';
import ObservationCardMobile from './components/schedule/ObservationCardMobile.jsx';

// Create a client-side collection to receive the published schedule data
const ObservationScheduleCollection = new Mongo.Collection('observationSchedule');

const Schedule = ({ user }) => {
  const { viewAsFilter } = useViewAs();
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Mobile only: the list opens on what's next, with history behind a toggle.
  const [showPast, setShowPast] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const nextObservationRef = useRef(null);
  const tableContainerRef = useRef(null);

  // Subscribe to schedule observations with view-as filter
  const { observations, isLoading } = useTracker(() => {
    const sessionId = localStorage.getItem('sessionId');
    const handle = Meteor.subscribe('schedule.observations', sessionId, viewAsFilter);

    const obs = ObservationScheduleCollection.find(
      {},
      { sort: { observationDate: 1 } }
    ).fetch();

    // Debug: Check if outcome data is present
    if (obs.length > 0) {
      console.log('[SCHEDULE CLIENT] First observation:', obs[0]);
      console.log('[SCHEDULE CLIENT] Has outcome?', !!obs[0].outcome);
      if (obs[0].outcome) {
        console.log('[SCHEDULE CLIENT] Outcome data:', obs[0].outcome);
      }
    }

    return {
      observations: obs,
      isLoading: !handle.ready()
    };
  }, [viewAsFilter]);

  // Find the next observation (first future or today's observation)
  // Server now provides isPast flag, so we find first non-past observation
  const nextObservationIndex = observations.findIndex(obs => !obs.isPast);

  // The prediction column/field only renders for the FIRST upcoming observation
  // of each product. Resolving that per row with a slice().some() is O(n²) —
  // ~99k iterations on a 445-row book, every render. One pass instead.
  const firstUpcomingObsIds = useMemo(() => {
    const seenProducts = new Set();
    const ids = new Set();
    for (const obs of observations) {
      if (obs.isPast) continue;
      if (seenProducts.has(obs.productId)) continue;
      seenProducts.add(obs.productId);
      ids.add(obs._id);
    }
    return ids;
  }, [observations]);

  // Mobile splits the book into upcoming / past; desktop keeps one full list.
  const { pastObservations, upcomingObservations } = useMemo(() => ({
    pastObservations: observations.filter(obs => obs.isPast),
    upcomingObservations: observations.filter(obs => !obs.isPast)
  }), [observations]);

  const mobileList = showPast ? pastObservations : upcomingObservations;

  // Debug: Log next observation prediction data
  React.useEffect(() => {
    if (observations.length > 0 && nextObservationIndex >= 0) {
      const nextObs = observations[nextObservationIndex];
      console.log('[SCHEDULE CLIENT] Next observation:', {
        index: nextObservationIndex,
        productId: nextObs.productId,
        hasPrediction: !!nextObs.nextObservationPrediction,
        predictionData: nextObs.nextObservationPrediction
      });
    }
  }, [observations, nextObservationIndex]);

  // Auto-scroll to next observation on initial load.
  // Mobile has nothing to do here: the list already starts at the next
  // observation, and scrolling an inner box would fight the page scroll.
  useEffect(() => {
    if (isMobile) return;
    if (!isLoading && nextObservationRef.current && tableContainerRef.current) {
      // Wait for DOM to render, then scroll
      setTimeout(() => {
        // Scroll within the table container to center the next observation
        const container = tableContainerRef.current;
        const element = nextObservationRef.current;

        if (container && element) {
          const containerHeight = container.clientHeight;
          const elementTop = element.offsetTop;
          const elementHeight = element.clientHeight;

          // Calculate scroll position to center the element
          const scrollPosition = elementTop - (containerHeight / 2) + (elementHeight / 2);

          container.scrollTo({
            top: scrollPosition,
            behavior: 'smooth'
          });
        }
      }, 100);
    }
  }, [isLoading, observations.length, isMobile]);

  // Handle manual refresh - triggers server-side recalculation
  const handleRefresh = () => {
    setIsRefreshing(true);

    // Resubscribe to force server-side refresh and recalculation
    const sessionId = localStorage.getItem('sessionId');
    Meteor.subscribe('schedule.observations', sessionId, viewAsFilter, {
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
    if (obs.isFinal) return 'Final';
    if (obs.observationType === 'coupon') return 'Coupon';
    if (obs.isCallable) return 'Autocall';
    return obs.observationType || '—';
  };

  // Get observation type badge color
  const getObservationTypeBadgeStyle = (obs) => {
    if (obs.isFinal) {
      return {
        background: 'var(--loss-color)',
        color: 'white'
      };
    }
    if (obs.observationType === 'coupon') {
      return {
        background: 'var(--gain-color)',
        color: 'white'
      };
    }
    if (obs.isCallable) {
      return {
        background: 'var(--info-color)',
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
      padding: isMobile ? '0.75rem' : '2rem',
      maxWidth: '1400px',
      margin: '0 auto',
      minHeight: 'calc(100vh - 200px)'
    }}>
      {/* Header */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: isMobile ? '1rem' : '1.5rem',
        borderRadius: '12px',
        marginBottom: isMobile ? '1rem' : '1.5rem',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: isMobile ? '0.875rem' : '0',
        border: '1px solid var(--border-color)'
      }}>
        <div>
          <h1 style={{
            margin: '0 0 0.5rem 0',
            fontSize: isMobile ? '1.375rem' : '1.8rem',
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
            minHeight: isMobile ? '44px' : undefined,
            width: isMobile ? '100%' : undefined,
            background: isRefreshing ? 'var(--bg-tertiary)' : 'var(--accent-color)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: isRefreshing ? 'not-allowed' : 'pointer',
            fontSize: '0.95rem',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            transition: 'all 0.2s ease',
            opacity: isRefreshing ? 0.6 : 1,
            flexShrink: 0
          }}
          // Hover-only styling sticks after a tap on touch devices, so it is
          // wired up on pointer devices only.
          onMouseEnter={isMobile ? undefined : (e) => {
            if (!isRefreshing) {
              e.target.style.background = '#0056b3';
              e.target.style.transform = 'translateY(-2px)';
            }
          }}
          onMouseLeave={isMobile ? undefined : (e) => {
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

      {/* Mobile: single-axis card list, opening on what's next */}
      {!isLoading && observations.length > 0 && isMobile && (
        <div>
          {/* Upcoming / Past segmented toggle */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0.375rem',
            padding: '0.375rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            marginBottom: '1rem'
          }}>
            {[
              { key: 'upcoming', label: 'Upcoming', count: upcomingObservations.length, active: !showPast },
              { key: 'past', label: 'Past', count: pastObservations.length, active: showPast }
            ].map(seg => (
              <button
                key={seg.key}
                onClick={() => { setShowPast(seg.key === 'past'); setExpandedId(null); }}
                style={{
                  minHeight: '40px',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  background: seg.active ? 'var(--accent-color)' : 'transparent',
                  color: seg.active ? '#ffffff' : 'var(--text-secondary)'
                }}
              >
                {seg.label} ({seg.count})
              </button>
            ))}
          </div>

          {mobileList.length === 0 ? (
            <div style={{
              padding: '2rem 1rem',
              textAlign: 'center',
              color: 'var(--text-muted)',
              background: 'var(--bg-secondary)',
              border: '1px dashed var(--border-color)',
              borderRadius: '10px'
            }}>
              {showPast ? 'No past observations' : 'No upcoming observations'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {mobileList.map((obs, index) => {
                // The date sits in a heading above each run of same-day cards
                // rather than being repeated on every card.
                const prev = mobileList[index - 1];
                const showDateHeading = !prev
                  || prev.observationDateFormatted !== obs.observationDateFormatted;
                const daysColor = obs.daysLeftColor === 'urgent' ? 'var(--warning-color)'
                  : obs.daysLeftColor === 'soon' ? 'var(--info-color)'
                  : 'var(--text-muted)';

                return (
                  <React.Fragment key={obs._id}>
                    {showDateHeading && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                        padding: '0.75rem 0.25rem 0.25rem',
                        borderTop: index === 0 ? 'none' : '1px solid var(--border-color)',
                        marginTop: index === 0 ? 0 : '0.5rem'
                      }}>
                        {obs.isToday && (
                          <span style={{
                            background: 'var(--warning-color)',
                            color: 'white',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: '700'
                          }}>
                            TODAY
                          </span>
                        )}
                        <span style={{
                          fontSize: '0.9375rem',
                          fontWeight: '700',
                          color: 'var(--text-primary)'
                        }}>
                          {obs.observationDateFormatted}
                        </span>
                        {obs.daysLeftText && (
                          <span style={{ fontSize: '0.8125rem', fontWeight: '600', color: daysColor }}>
                            {obs.daysLeftText}
                          </span>
                        )}
                      </div>
                    )}
                    <ObservationCardMobile
                      obs={obs}
                      isExpanded={expandedId === obs._id}
                      onToggle={() => setExpandedId(expandedId === obs._id ? null : obs._id)}
                      isNext={!showPast && index === 0}
                      showPrediction={firstUpcomingObsIds.has(obs._id)}
                      typeLabel={getObservationTypeDisplay(obs)}
                      theme={theme}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Observations Table - Elegant Design matching Phoenix Report */}
      {!isLoading && observations.length > 0 && !isMobile && (
        <div style={{
          background: 'linear-gradient(135deg, #334155 0%, #475569 100%)',
          borderRadius: '12px',
          padding: '1px',
          boxShadow: '0 10px 40px rgba(51, 65, 85, 0.2)'
        }}>
          <div style={{
            background: 'var(--bg-secondary)',
            borderRadius: '11px',
            overflow: 'hidden'
          }}>
            {/* Scrollable wrapper for the table - Both horizontal and vertical */}
            <div
              ref={tableContainerRef}
              className="schedule-table-container"
              style={{
                overflowX: 'auto',
                overflowY: 'auto',
                maxWidth: '100%',
                maxHeight: '500px', // Show approximately 7 rows + header
                position: 'relative'
              }}>
              {/* Table with minimum width to ensure proper display */}
              <div style={{
                minWidth: '1300px'
              }}>
                {/* Table Header - Sleek Dark Header (sticky so column names stay visible while scrolling) */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1.6fr 1.2fr 2fr 0.9fr 1fr 0.9fr 1.3fr 1.2fr',
                  gap: '0.75rem',
                  padding: '1.25rem 1.5rem',
                  background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                  borderBottom: '2px solid rgba(148, 163, 184, 0.2)',
                  position: 'sticky',
                  top: 0,
                  zIndex: 2
                }}>
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px'
                  }}>
                    📅 Observation
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px'
                  }}>
                    🏷️ Type
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px'
                  }}>
                    📊 Product
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px'
                  }}>
                    🔢 ISIN
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    textAlign: 'right'
                  }}>
                    💼 Nominal
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    textAlign: 'center'
                  }}>
                    📊 Status
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    textAlign: 'center'
                  }}>
                    💰 Coupons
                  </div>
                  <div style={{
                    fontSize: '0.7rem',
                    fontWeight: '700',
                    color: '#e2e8f0',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    textAlign: 'center'
                  }}>
                    🔮 Prediction
                  </div>
                </div>

                {/* Table Rows - Enhanced Visual Hierarchy */}
                {observations.map((obs, index) => {
                const isNextObservation = index === nextObservationIndex;
                const isFutureRow = !obs.isPast;
                const isPastRow = obs.isPast;

                // Check if this is the first upcoming observation for THIS product
                const isFirstUpcomingForProduct = firstUpcomingObsIds.has(obs._id);

                // Get color based on server-calculated daysLeftColor
                const getDaysLeftColor = (colorKey) => {
                  switch (colorKey) {
                    case 'muted': return 'var(--neutral-color)';
                    case 'urgent': return 'var(--warning-color)';
                    case 'soon': return 'var(--info-color)';
                    default: return 'var(--text-primary)';
                  }
                };

                return (
                  <div
                    key={obs._id}
                    ref={isNextObservation ? nextObservationRef : null}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.6fr 1.2fr 2fr 0.9fr 1fr 0.9fr 1.3fr 1.2fr',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.55rem 1.5rem',
                      borderBottom: index < observations.length - 1 ?
                        '1px solid rgba(148, 163, 184, 0.15)' : 'none',
                      background: isNextObservation
                        ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(96, 165, 250, 0.15) 100%)'
                        : isFutureRow
                          ? 'rgba(148, 163, 184, 0.05)'
                          : 'transparent',
                      borderLeft: isNextObservation
                        ? '4px solid var(--info-color)'
                        : obs.isFinal
                          ? '4px solid #ea580c'
                          : 'none',
                      transition: 'all 0.15s ease',
                      position: 'relative'
                    }}
                  >
                    {/* Observation Date (with days-left counter inline) */}
                    <div style={{
                      fontSize: '0.875rem',
                      color: isFutureRow ? 'var(--neutral-color)' : 'var(--text-primary)',
                      fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                      fontWeight: isNextObservation ? '700' : '600',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      {obs.isToday && (
                        <span style={{
                          background: 'var(--warning-color)',
                          color: 'white',
                          padding: '0.3rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.65rem',
                          fontWeight: '700',
                          letterSpacing: '0.5px'
                        }}>
                          TODAY
                        </span>
                      )}
                      {isNextObservation && !obs.isToday && (
                        <span style={{
                          marginRight: '0.5rem',
                          fontSize: '1rem'
                        }}>
                          ⏰
                        </span>
                      )}
                      <span>{obs.observationDateFormatted}</span>
                      {obs.daysLeftText && (
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          color: getDaysLeftColor(obs.daysLeftColor)
                        }}>
                          ({obs.daysLeftText})
                        </span>
                      )}
                    </div>

                    {/* Observation Type - Badge Style */}
                    <div style={{
                      fontSize: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start'
                    }}>
                      <span style={{
                        background: obs.isFinal
                          ? 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)'
                          : isFutureRow
                            ? 'rgba(148, 163, 184, 0.2)'
                            : 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                        color: obs.isFinal
                          ? '#ffffff'
                          : isFutureRow
                            ? '#64748b'
                            : '#ffffff',
                        padding: '0.4rem 0.85rem',
                        borderRadius: '8px',
                        fontWeight: '700',
                        whiteSpace: 'nowrap',
                        boxShadow: isFutureRow
                          ? 'none'
                          : '0 2px 12px rgba(30, 41, 59, 0.2)',
                        letterSpacing: '0.3px'
                      }}>
                        {getObservationTypeDisplay(obs)}
                      </span>
                    </div>

                    {/* Product Name */}
                    <div
                      title={obs.productTitle}
                      style={{
                        fontSize: '0.875rem',
                        color: isFutureRow ? 'var(--neutral-color)' : 'var(--text-primary)',
                        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0
                      }}
                    >
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%'
                      }}>
                        {obs.productTitle}
                      </span>
                    </div>

                    {/* ISIN - Clickable */}
                    <div
                      onClick={() => {
                        window.history.pushState(null, null, `/report/${obs.productId}`);
                        window.location.href = `/report/${obs.productId}`;
                      }}
                      style={{
                        fontSize: '0.85rem',
                        color: isFutureRow ? 'var(--neutral-color)' : 'var(--text-primary)',
                        fontFamily: 'monospace',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        textDecorationStyle: 'dotted',
                        textUnderlineOffset: '3px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--info-color)';
                        e.currentTarget.style.textDecorationStyle = 'solid';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = isFutureRow ? 'var(--neutral-color)' : 'var(--text-primary)';
                        e.currentTarget.style.textDecorationStyle = 'dotted';
                      }}
                      title={`Click to open ${obs.productTitle} report`}
                    >
                      {obs.productIsin}
                    </div>

                    {/* Nominal held by the currently-viewed client/entity */}
                    <div style={{
                      fontSize: '0.875rem',
                      color: isFutureRow ? 'var(--neutral-color)' : 'var(--text-primary)',
                      fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                      fontWeight: '600',
                      textAlign: 'right'
                    }}>
                      {obs.clientNominal != null
                        ? new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: obs.productCurrency || 'EUR',
                            maximumFractionDigits: 0
                          }).format(obs.clientNominal)
                        : '—'}
                    </div>

                    {/* Status - REDEEMED badge or em-dash */}
                    <div style={{
                      fontSize: '0.8rem',
                      fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                      textAlign: 'center',
                      fontWeight: '600',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center'
                    }}>
                      {obs.outcome && obs.outcome.hasOccurred && obs.outcome.productCalled ? (
                        <span style={{
                          background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                          color: '#ffffff',
                          padding: '0.35rem 0.7rem',
                          borderRadius: '8px',
                          display: 'inline-block',
                          fontSize: '0.7rem',
                          fontWeight: '700',
                          boxShadow: '0 2px 8px rgba(5, 150, 105, 0.3)',
                          letterSpacing: '0.3px'
                        }}>
                          REDEEMED
                        </span>
                      ) : (
                        <span style={{
                          color: 'var(--neutral-color)',
                          fontWeight: '400'
                        }}>
                          —
                        </span>
                      )}
                    </div>

                    {/* Coupons - coupon and memory pills inline */}
                    <div style={{
                      fontSize: '0.8rem',
                      fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
                      fontWeight: '600',
                      display: 'flex',
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: '0.35rem',
                      justifyContent: 'center',
                      alignItems: 'center'
                    }}>
                      {obs.outcome && obs.outcome.hasOccurred ? (
                        <>
                          {obs.outcome.couponPaid > 0 && (
                            <span style={{
                              color: '#059669',
                              background: '#d1fae5',
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              display: 'inline-block',
                              fontSize: '0.75rem',
                              boxShadow: '0 1px 3px rgba(5, 150, 105, 0.1)'
                            }}>
                              💵 {obs.outcome.couponPaidFormatted}
                            </span>
                          )}
                          {obs.outcome.couponInMemory > 0 && (
                            <span style={{
                              color: '#c2410c',
                              background: '#fed7aa',
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              display: 'inline-block',
                              fontSize: '0.75rem',
                              boxShadow: '0 1px 3px rgba(234, 88, 12, 0.1)'
                            }}>
                              🧠 Memory: {obs.outcome.couponInMemoryFormatted}
                            </span>
                          )}
                          {obs.outcome.couponPaid === 0 && obs.outcome.couponInMemory === 0 && !obs.outcome.productCalled && (
                            <span style={{
                              color: 'var(--neutral-color)',
                              fontStyle: 'italic',
                              fontSize: '0.75rem',
                              fontWeight: '500'
                            }}>
                              ✗ No coupon
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {obs.couponRate && (
                            <span style={{
                              color: '#059669',
                              background: '#d1fae5',
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              display: 'inline-block',
                              fontSize: '0.75rem',
                              boxShadow: '0 1px 3px rgba(5, 150, 105, 0.1)'
                            }}>
                              💵 {obs.couponRate}%
                            </span>
                          )}
                          {obs.autocallLevel && (
                            <span style={{
                              color: '#2563eb',
                              background: '#dbeafe',
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              display: 'inline-block',
                              fontSize: '0.75rem',
                              boxShadow: '0 1px 3px rgba(37, 99, 235, 0.1)'
                            }}>
                              🎯 {obs.autocallLevel}%
                            </span>
                          )}
                          {!obs.couponRate && !obs.autocallLevel && (
                            <span style={{
                              color: 'var(--neutral-color)',
                              fontWeight: '400'
                            }}>
                              —
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* Prediction Column */}
                    <div style={{
                      fontSize: '0.875rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      flexWrap: 'wrap'
                    }}>
                      {isFirstUpcomingForProduct && obs.nextObservationPrediction ? (
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem',
                          alignItems: 'center'
                        }}>
                          {obs.nextObservationPrediction.outcomeType === 'autocall' && (
                            <span style={{
                              background: 'linear-gradient(135deg, var(--info-color) 0%, #2563eb 100%)',
                              color: '#ffffff',
                              padding: '0.35rem 0.7rem',
                              borderRadius: '8px',
                              display: 'inline-block',
                              fontSize: '0.7rem',
                              fontWeight: '700',
                              boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
                              letterSpacing: '0.3px'
                            }}>
                              🎊 Autocall: {obs.nextObservationPrediction.autocallPriceFormatted}
                            </span>
                          )}
                          {obs.nextObservationPrediction.outcomeType === 'coupon' && (
                            <span style={{
                              color: '#059669',
                              background: '#d1fae5',
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              display: 'inline-block',
                              fontSize: '0.75rem',
                              boxShadow: '0 1px 3px rgba(5, 150, 105, 0.1)',
                              fontWeight: '600'
                            }}>
                              💵 Coupon: {obs.nextObservationPrediction.couponAmountFormatted}
                            </span>
                          )}
                          {obs.nextObservationPrediction.outcomeType === 'memory_added' && (
                            <span style={{
                              color: '#c2410c',
                              background: '#fed7aa',
                              padding: '0.3rem 0.6rem',
                              borderRadius: '6px',
                              display: 'inline-block',
                              fontSize: '0.75rem',
                              boxShadow: '0 1px 3px rgba(234, 88, 12, 0.1)',
                              fontWeight: '600'
                            }}>
                              🧠 In Memory
                            </span>
                          )}
                          {obs.nextObservationPrediction.outcomeType === 'final_redemption' && (
                            <span style={{
                              background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
                              color: '#ffffff',
                              padding: '0.35rem 0.7rem',
                              borderRadius: '8px',
                              display: 'inline-block',
                              fontSize: '0.7rem',
                              fontWeight: '700',
                              boxShadow: '0 2px 8px rgba(234, 88, 12, 0.3)',
                              letterSpacing: '0.3px'
                            }}>
                              🏁 Final: {obs.nextObservationPrediction.redemptionAmountFormatted}
                            </span>
                          )}
                          {obs.nextObservationPrediction.outcomeType === 'no_event' && (
                            <span style={{
                              color: 'var(--neutral-color)',
                              fontStyle: 'italic',
                              fontSize: '0.75rem',
                              fontWeight: '500'
                            }}>
                              ✗ No coupon
                            </span>
                          )}
                          <span style={{
                            fontSize: '0.65rem',
                            color: 'var(--neutral-color)',
                            fontStyle: 'italic',
                            fontWeight: '400'
                          }}>
                            Basket: {obs.nextObservationPrediction.currentBasketLevelFormatted}
                          </span>
                        </div>
                      ) : (
                        <span style={{
                          color: 'var(--neutral-color)',
                          fontWeight: '400',
                          fontSize: '0.875rem'
                        }}>
                          —
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
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

      {/* Spin animation for loading/refresh icons + Custom scrollbar */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        /* Custom scrollbar styling for the table */
        .schedule-table-container::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        .schedule-table-container::-webkit-scrollbar-track {
          background: rgba(148, 163, 184, 0.1);
          border-radius: 4px;
        }

        .schedule-table-container::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.4);
          border-radius: 4px;
        }

        .schedule-table-container::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.6);
        }
      `}</style>
    </div>
  );
};

export default Schedule;
