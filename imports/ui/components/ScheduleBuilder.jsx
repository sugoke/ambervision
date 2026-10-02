import React, { useState, useEffect } from 'react';
import { HOLIDAY_CALENDARS, rollFollowingISO } from '/imports/utils/holidayCalendars.js';
import {
  generateSchedule,
  applyLevelConfig,
  markManualEdit,
  countManualDateEdits,
  isDateConfigField,
  resolveCalendars,
  resolvePaymentLag,
  paymentDateFor,
  addMonthsISO,
  shouldAutoBuildSchedule
} from '/imports/utils/scheduleGenerator.js';

// Schedule tab. The stored schedule rows (existingSchedule, owned by the parent) are the
// source of truth: they are displayed exactly as saved or extracted from the term sheet
// and are never rebuilt on mount or load. A rebuild happens only when the user changes
// a Schedule Configuration field or clicks "Regenerate schedule", and date rebuilds ask
// for confirmation first. Hand edits in the table are flagged (manualOverride /
// manualFields) so level-only rebuilds keep them.
const ScheduleBuilder = ({ productDetails, scheduleConfig, onUpdateSchedule, onConfigChange, selectedTemplateId, underlyings, existingSchedule }) => {
  const schedule = existingSchedule || [];
  const [stepDownInput, setStepDownInput] = useState('');

  // Check if this is a participation note
  const isParticipationNote = selectedTemplateId === 'participation_note';
  const isHimalaya = selectedTemplateId === 'himalaya';

  // Use props for configuration, fallback to defaults if not provided
  const frequency = scheduleConfig?.frequency || 'quarterly';
  const coolOffPeriods = scheduleConfig?.coolOffPeriods ?? 0;
  const stepDownValue = scheduleConfig?.stepDownValue ?? -5;
  const initialAutocallLevel = scheduleConfig?.initialAutocallLevel ?? 100;
  const initialCouponBarrier = scheduleConfig?.initialCouponBarrier ?? 70;
  const autocallFloor = scheduleConfig?.autocallFloor ?? '';

  const { observationCalendars, paymentCalendars, unmappedExchanges } = resolveCalendars({
    scheduleConfig, underlyings, currency: productDetails?.currency
  });
  const paymentLag = resolvePaymentLag(scheduleConfig || {}, productDetails || {}, paymentCalendars);

  // Initialize local input state from prop
  useEffect(() => {
    setStepDownInput(String(stepDownValue));
  }, []);

  const buildSchedule = (config) => generateSchedule({
    productDetails,
    scheduleConfig: config,
    underlyings,
    isParticipationNote,
    previousSchedule: schedule
  });

  const commitSchedule = (rows) => {
    if (onUpdateSchedule) onUpdateSchedule(rows);
  };

  // Initial build only: a new product with dates set but no schedule yet
  useEffect(() => {
    if (isHimalaya || !shouldAutoBuildSchedule(schedule, productDetails)) return;
    const rows = buildSchedule(scheduleConfig || {});
    if (rows.length > 0) commitSchedule(rows);
  }, [productDetails?.tradeDate, productDetails?.finalObservation, isHimalaya]);

  const confirmDateRebuild = () => {
    if (schedule.length === 0) return true;
    // Dates that are exactly what the current configuration generates can be rebuilt
    // silently; anything else (term sheet dates, hand edits) needs confirmation.
    const generated = buildSchedule(scheduleConfig || {});
    const onlyGeneratedDates = countManualDateEdits(schedule) === 0 &&
      generated.length === schedule.length &&
      generated.every((row, i) =>
        row.observationDate === schedule[i].observationDate && row.valueDate === schedule[i].valueDate);
    if (onlyGeneratedDates) return true;

    const manual = countManualDateEdits(schedule);
    const detail = manual > 0
      ? `${manual} row(s) have dates edited by hand.`
      : 'Current dates (including term sheet dates) will be replaced.';
    return window.confirm(`This will regenerate all observation and payment dates and overwrite manual date edits.\n\n${detail}\n\nContinue?`);
  };

  // Config change from the Schedule Configuration panel: this is the only automatic rebuild
  const handleConfigChange = (param, value) => {
    const nextConfig = { ...(scheduleConfig || {}), [param]: value };
    if (isDateConfigField(param)) {
      if (!confirmDateRebuild()) return;
      onConfigChange && onConfigChange(param, value);
      commitSchedule(buildSchedule(nextConfig));
    } else {
      onConfigChange && onConfigChange(param, value);
      if (schedule.length > 0) commitSchedule(applyLevelConfig(schedule, nextConfig));
    }
  };

  const regenerateSchedule = () => {
    if (!confirmDateRebuild()) return;
    commitSchedule(buildSchedule(scheduleConfig || {}));
  };

  // Update schedule item (hand edit in the table)
  const updateScheduleItem = (id, field, value) => {
    commitSchedule(schedule.map(item => (item.id === id ? markManualEdit(item, field, value) : item)));
  };

  // Delete schedule row
  const deleteScheduleRow = (id) => {
    const reindexedSchedule = schedule
      .filter(item => item.id !== id)
      .map((item, index) => ({
        ...item,
        periodIndex: index + 1,
        id: `period_${index}` // Also update IDs to maintain consistency
      }));
    commitSchedule(reindexedSchedule);
  };

  // Himalaya: one observation per underlying. Generated only when the number of
  // underlyings no longer matches the stored schedule, so saved dates survive reloads.
  const numberOfUnderlyings = underlyings?.length || 0;
  useEffect(() => {
    if (!isHimalaya) return;
    if (numberOfUnderlyings === 0 || schedule.length === numberOfUnderlyings) return;
    if (!productDetails?.tradeDate || !productDetails?.finalObservation) return;

    const start = new Date(productDetails.tradeDate);
    const end = new Date(productDetails.finalObservation);
    const intervalDays = (end - start) / (1000 * 60 * 60 * 24) / numberOfUnderlyings;
    const rows = [];
    for (let i = 1; i <= numberOfUnderlyings; i++) {
      const raw = new Date(start);
      raw.setUTCDate(raw.getUTCDate() + Math.round(intervalDays * i));
      const observationDate = rollFollowingISO(raw.toISOString().slice(0, 10), observationCalendars);
      rows.push({
        id: `himalaya_obs_${i}`,
        observationDate,
        valueDate: paymentDateFor(observationDate, paymentLag.lag, paymentCalendars),
        observationNumber: i,
        periodIndex: i
      });
    }
    commitSchedule(rows);
  }, [isHimalaya, numberOfUnderlyings, productDetails?.tradeDate, productDetails?.finalObservation]);

  // Get non-call helper text
  const getCoolOffHelperText = () => {
    if (coolOffPeriods === 0) return "Product is callable from first observation";
    if (coolOffPeriods === 1) return "First period is non-callable";
    return `First ${coolOffPeriods} periods are non-callable`;
  };

  // Common input styles
  const inputStyle = {
    padding: '6px 8px',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    fontSize: '0.9rem',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    width: '100%',
    boxSizing: 'border-box'
  };

  const selectStyle = {
    ...inputStyle,
    cursor: 'pointer'
  };

  const configLabelStyle = {
    display: 'block',
    marginBottom: '0.5rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
    fontSize: '0.9rem'
  };

  const helperStyle = { color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px', display: 'block' };

  if (!productDetails?.tradeDate || !productDetails?.finalObservation) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '3rem 2rem',
        color: 'var(--text-muted)',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        margin: '2rem 0'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📅</div>
        <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
          Schedule Builder Not Available
        </h3>
        <p>Please set Trade Date and Final Observation in the Setup tab first</p>
      </div>
    );
  }

  // Himalaya-specific simple schedule (dates auto-generated based on # of underlyings)
  if (isHimalaya) {
    const numberOfObservations = numberOfUnderlyings;

    // Hand edit of an observation date: the payment date follows with the issuer lag
    const updateHimalayaDate = (id, newDate) => {
      commitSchedule(schedule.map(item => {
        if (item.id !== id) return item;
        const edited = markManualEdit(item, 'observationDate', newDate);
        return newDate ? { ...edited, valueDate: paymentDateFor(newDate, paymentLag.lag, paymentCalendars) } : edited;
      }));
    };

    return (
      <div className="schedule-builder himalaya">
        <div style={{
          marginBottom: '2rem'
        }}>
          <h2 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>🏔️ Himalaya Observation Schedule</h2>
          <p style={{
            margin: 0,
            fontSize: '0.95rem',
            color: 'var(--text-secondary)'
          }}>
            {numberOfObservations} observation dates automatically generated (one per underlying)
          </p>
        </div>

        {numberOfUnderlyings === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📊</div>
            <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
              Add Underlyings First
            </h3>
            <p style={{ color: 'var(--text-muted)' }}>
              Please add underlyings in the Underlyings tab. The number of observation dates will equal the number of underlyings.
            </p>
          </div>
        ) : (
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            overflow: 'hidden'
          }}>
            {/* Table Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '0.5fr 2fr',
              gap: '1rem',
              padding: '1rem 1.5rem',
              background: 'var(--bg-primary)',
              borderBottom: '1px solid var(--border-color)',
              fontWeight: '600',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)'
            }}>
              <div>Obs #</div>
              <div>Observation Date</div>
            </div>

            {/* Schedule Rows */}
            {schedule.map((item, index) => (
              <div
                key={item.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '0.5fr 2fr',
                  gap: '1rem',
                  padding: '1rem 1.5rem',
                  borderBottom: index < schedule.length - 1 ? '1px solid var(--border-color)' : 'none',
                  alignItems: 'center',
                  background: index === schedule.length - 1 ? 'var(--bg-tertiary)' : 'transparent'
                }}
              >
                <div style={{
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem'
                }}>
                  {item.observationNumber}
                </div>

                <div>
                  <input
                    type="date"
                    value={item.observationDate}
                    onChange={(e) => updateHimalayaDate(item.id, e.target.value)}
                    style={{
                      padding: '6px 8px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      fontSize: '0.9rem',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace',
                      width: '180px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>
            ))}

            {schedule.length > 0 && (
              <div style={{
                padding: '1.5rem',
                background: 'var(--bg-primary)',
                borderTop: '1px solid var(--border-color)',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                lineHeight: '1.6'
              }}>
                <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  ℹ️ How it works:
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                  <li>At each observation date, the best performing underlying is selected and removed from the basket</li>
                  <li>The final observation (highlighted) determines the last selection</li>
                  <li>All recorded performances are averaged to calculate the final payout</li>
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="schedule-builder">
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem',
        paddingBottom: '1rem',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>Schedule Builder</h2>
        <button
          type="button"
          onClick={regenerateSchedule}
          title="Rebuild all dates and levels from the Schedule Configuration"
          style={{
            padding: '0.5rem 1rem',
            background: 'transparent',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: '600'
          }}
        >
          ↻ Regenerate schedule
        </button>
      </div>

      {/* Configuration Panel */}
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '2rem',
        boxShadow: '0 2px 8px var(--shadow)'
      }}>
        <h3 style={{ margin: '0 0 1.5rem 0', color: 'var(--text-primary)' }}>
          📊 Schedule Configuration
        </h3>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1.5rem',
          marginBottom: '1.5rem'
        }}>
          {/* Frequency Selection */}
          <div>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontWeight: '600',
              color: 'var(--text-primary)',
              fontSize: '0.9rem'
            }}>
              Observation Frequency
            </label>
            <select
              value={frequency}
              onChange={(e) => handleConfigChange('frequency', e.target.value)}
              style={selectStyle}
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="semi-annually">Semi-Annually</option>
              <option value="annually">Annually</option>
            </select>
          </div>

          {/* Non-call Periods */}
          <div>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontWeight: '600',
              color: 'var(--text-primary)',
              fontSize: '0.9rem'
            }}>
              Non-call Periods
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={coolOffPeriods}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9]/g, '');
                const numValue = value === '' ? 0 : parseInt(value, 10);
                const maxValue = schedule.length || 99;
                const finalValue = Math.min(Math.max(0, numValue), maxValue);
                handleConfigChange('coolOffPeriods', finalValue);
              }}
              onBlur={(e) => {
                // Ensure value is valid on blur
                if (e.target.value === '') {
                  e.target.value = '0';
                  handleConfigChange('coolOffPeriods', 0);
                }
              }}
              style={{...inputStyle, width: '80px'}}
              placeholder="0"
            />
            <small style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px', display: 'block' }}>
              {isParticipationNote ? (
                <>
                  Cool-off period before early redemption is possible. Example: 6 = callable after 6 months
                </>
              ) : (
                getCoolOffHelperText()
              )}
            </small>
          </div>

          {/* Initial Autocall Level */}
          {!isParticipationNote && (
            <div>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: '600',
                color: 'var(--text-primary)',
                fontSize: '0.9rem'
              }}>
                Initial Autocall Level (%)
              </label>
              <input
                type="number"
                min="50"
                max="150"
                step="1"
                value={initialAutocallLevel}
                onChange={(e) => handleConfigChange('initialAutocallLevel', parseFloat(e.target.value) || 100)}
                style={{...inputStyle, width: '80px'}}
              />
            </div>
          )}

          {/* Step-down Value */}
          {!isParticipationNote && (
            <div>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: '600',
                color: 'var(--text-primary)',
                fontSize: '0.9rem'
              }}>
                Step-down per Period (%)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={stepDownInput}
                onChange={(e) => {
                  const value = e.target.value;
                  // Allow empty, negative sign, decimal point, and valid number patterns
                  if (value === '' || /^-?\d*\.?\d*$/.test(value)) {
                    setStepDownInput(value);

                    // Update parent only if we have a valid number
                    if (value && value !== '-' && value !== '.' && value !== '-.') {
                      const numValue = parseFloat(value);
                      if (!isNaN(numValue) && onConfigChange) {
                        handleConfigChange('stepDownValue', numValue);
                      }
                    }
                  }
                }}
                onBlur={() => {
                  // On blur, ensure we have a valid number
                  if (stepDownInput === '' || stepDownInput === '-' || stepDownInput === '.' || stepDownInput === '-.') {
                    setStepDownInput('0');
                    if (onConfigChange) {
                      handleConfigChange('stepDownValue', 0);
                    }
                  }
                }}
                style={{...inputStyle, width: '80px', textAlign: 'right'}}
              />
              <small style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px', display: 'block' }}>
                Negative values reduce autocall level
              </small>
            </div>
          )}

          {/* Initial Coupon Barrier */}
          {!isParticipationNote && (
            <div>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontWeight: '600',
                color: 'var(--text-primary)',
                fontSize: '0.9rem'
              }}>
                Coupon Barrier (%)
              </label>
              <input
                type="number"
                min="30"
                max="100"
                step="1"
                value={initialCouponBarrier}
                onChange={(e) => handleConfigChange('initialCouponBarrier', parseFloat(e.target.value) || 70)}
                style={{...inputStyle, width: '80px'}}
              />
            </div>
          )}

          {/* Autocall floor: the step-down stops at this level */}
          {!isParticipationNote && (
            <div>
              <label style={configLabelStyle}>Autocall Floor (%)</label>
              <input
                type="text"
                inputMode="decimal"
                value={autocallFloor}
                placeholder="None"
                onChange={(e) => {
                  const raw = e.target.value.replace(',', '.');
                  if (raw === '') { handleConfigChange('autocallFloor', null); return; }
                  const num = parseFloat(raw);
                  if (!isNaN(num)) handleConfigChange('autocallFloor', num);
                }}
                style={{...inputStyle, width: '80px'}}
              />
              <small style={helperStyle}>Lowest autocall level reached by the step-down</small>
            </div>
          )}

          {/* Payment lag in business days after each observation */}
          <div>
            <label style={configLabelStyle}>Payment Lag (business days)</label>
            <input
              type="text"
              inputMode="numeric"
              value={scheduleConfig?.paymentLagBusinessDays ?? ''}
              placeholder={String(paymentLag.lag)}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, '');
                handleConfigChange('paymentLagBusinessDays', raw === '' ? null : parseInt(raw, 10));
              }}
              style={{...inputStyle, width: '80px'}}
            />
            <small style={helperStyle}>
              {paymentLag.source === 'config'
                ? 'Set manually'
                : paymentLag.source === 'issueDate'
                  ? `Default ${paymentLag.lag}: trade date → issue date`
                  : `Default ${paymentLag.lag}: no issue date set`}
            </small>
          </div>

          {/* Holiday calendar for observation dates */}
          <div>
            <label style={configLabelStyle}>Observation Calendar</label>
            <select
              value={scheduleConfig?.observationCalendar || 'underlyings'}
              onChange={(e) => handleConfigChange('observationCalendar', e.target.value)}
              style={selectStyle}
            >
              <option value="underlyings">Underlying exchanges</option>
              {Object.entries(HOLIDAY_CALENDARS).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
            <small style={helperStyle}>
              Using: {observationCalendars.join(' + ')}
              {unmappedExchanges.length > 0 && ` (no calendar for ${unmappedExchanges.join(', ')}: weekends only)`}
            </small>
          </div>

          {/* Holiday calendar for payment dates */}
          <div>
            <label style={configLabelStyle}>Payment Calendar</label>
            <select
              value={scheduleConfig?.paymentCalendar || ''}
              onChange={(e) => handleConfigChange('paymentCalendar', e.target.value || null)}
              style={selectStyle}
            >
              <option value="">Product currency ({paymentCalendars[0]})</option>
              {Object.entries(HOLIDAY_CALENDARS).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
        </div>

      </div>

      {/* Schedule Table */}
      {schedule.length > 0 && (
        <div style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 2px 8px var(--shadow)'
        }}>
          <div style={{
            background: 'var(--bg-secondary)',
            padding: '1rem 1.5rem',
            borderBottom: '1px solid var(--border-color)'
          }}>
            <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>
              📊 Observation Schedule
            </h3>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.9rem'
            }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)' }}>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                    Period
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                    {isParticipationNote ? 'Early Redemption Observation Date' : 'Observation Date'}
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                    {isParticipationNote ? 'Early Redemption Date' : 'Value Date'}
                  </th>
                  {isParticipationNote && (
                    <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                      Rebate (%)
                    </th>
                  )}
                  {!isParticipationNote && (
                    <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                      Autocall Level (%)
                    </th>
                  )}
                  {!isParticipationNote && (
                    <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                      Callable
                    </th>
                  )}
                  {!isParticipationNote && (
                    <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                      Coupon Barrier (%)
                    </th>
                  )}
                  <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((item, index) => (
                  <tr key={item.id} style={{
                    borderBottom: index < schedule.length - 1 ? '1px solid var(--border-color)' : 'none',
                    background: index % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-tertiary)'
                  }}>
                    <td style={{ padding: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                      {String(item.periodIndex)}
                      {item.manualOverride && (
                        <span
                          title={`Edited by hand: ${(item.manualFields || []).join(', ')}`}
                          style={{ marginLeft: '6px', fontSize: '0.75rem', color: 'var(--accent-color)' }}
                        >
                          ✎
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <input
                        type="date"
                        value={item.observationDate}
                        onChange={(e) => updateScheduleItem(item.id, 'observationDate', e.target.value)}
                        style={{
                          ...inputStyle,
                          fontSize: '0.85rem',
                          padding: '4px 6px'
                        }}
                      />
                    </td>
                    <td style={{ padding: '12px' }}>
                      <input
                        type="date"
                        value={item.valueDate}
                        onChange={(e) => updateScheduleItem(item.id, 'valueDate', e.target.value)}
                        style={{
                          ...inputStyle,
                          fontSize: '0.85rem',
                          padding: '4px 6px'
                        }}
                      />
                    </td>
                    {isParticipationNote && (
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          max="50"
                          step="0.5"
                          value={item.rebateAmount !== undefined && item.rebateAmount !== null ? item.rebateAmount : 0}
                          onChange={(e) => updateScheduleItem(item.id, 'rebateAmount', parseFloat(e.target.value) || 0)}
                          style={{
                            ...inputStyle,
                            fontSize: '0.85rem',
                            padding: '4px 6px',
                            width: '80px',
                            textAlign: 'center'
                          }}
                        />
                      </td>
                    )}
                    {!isParticipationNote && (
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        {item.isCallable ? (
                          <input
                            type="number"
                            min="50"
                            max="150"
                            step="0.5"
                            value={item.autocallLevel || initialAutocallLevel}
                            onChange={(e) => updateScheduleItem(item.id, 'autocallLevel', parseFloat(e.target.value) || 100)}
                            style={{
                              ...inputStyle,
                              fontSize: '0.85rem',
                              padding: '4px 6px',
                              width: '80px',
                              textAlign: 'center'
                            }}
                          />
                        ) : (
                          <span style={{
                            color: 'var(--text-muted)',
                            fontSize: '0.85rem',
                            fontStyle: 'italic'
                          }}>
                            N/A
                          </span>
                        )}
                      </td>
                    )}
                    {!isParticipationNote && (
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={item.isCallable}
                          onChange={(e) => updateScheduleItem(item.id, 'isCallable', e.target.checked)}
                          style={{
                            width: '18px',
                            height: '18px',
                            accentColor: 'var(--accent-color)',
                            cursor: 'pointer'
                          }}
                        />
                        {!item.isCallable && (
                          <div style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-muted)',
                            marginTop: '2px'
                          }}>
                            Non-call
                          </div>
                        )}
                      </td>
                    )}
                    {!isParticipationNote && (
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <input
                          type="number"
                          min="30"
                          max="100"
                          step="1"
                          value={item.couponBarrier}
                          onChange={(e) => updateScheduleItem(item.id, 'couponBarrier', parseFloat(e.target.value) || 70)}
                          style={{
                            ...inputStyle,
                            fontSize: '0.85rem',
                            padding: '4px 6px',
                            width: '80px',
                            textAlign: 'center'
                          }}
                        />
                      </td>
                    )}
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <button
                        onClick={() => deleteScheduleRow(item.id)}
                        style={{
                          padding: '4px',
                          background: 'transparent',
                          color: 'var(--loss-color)',
                          border: '1px solid var(--loss-color)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          width: '24px',
                          height: '24px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.background = 'var(--loss-color)';
                          e.target.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.background = 'transparent';
                          e.target.style.color = 'var(--loss-color)';
                        }}
                        title="Delete this observation"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Summary */}
          <div style={{
            background: 'var(--bg-secondary)',
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.85rem',
            color: 'var(--text-secondary)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <strong>Total Periods:</strong> {schedule.length} | 
                <strong> Callable Periods:</strong> {schedule.filter(item => item.isCallable).length} |
                <strong> Non-call Periods:</strong> {schedule.filter(item => !item.isCallable).length} |
                <strong> Payment Lag:</strong> {paymentLag.lag} business days
                {countManualDateEdits(schedule) > 0 && <> | <strong> Edited by hand:</strong> {countManualDateEdits(schedule)}</>}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                💡 Saved dates are kept as entered. Regenerated dates use {observationCalendars.join(' + ')} for observations and {paymentCalendars.join(' + ')} for payments
              </div>
            </div>
          </div>

          {/* Add Observation Button */}
          <div style={{
            padding: '1rem 1.5rem',
            background: 'var(--bg-secondary)',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            gap: '1rem',
            alignItems: 'center'
          }}>
            <button
              onClick={() => {
                // Get the last observation or use product dates as fallback
                const lastObs = schedule[schedule.length - 1];
                const lastObsDate = lastObs?.observationDate || productDetails?.finalObservation || productDetails?.tradeDate;

                if (!lastObsDate) {
                  alert('Please set product dates first before adding observations');
                  return;
                }

                // Next observation one period after the last one, rolled to a trading day
                const months = { monthly: 1, quarterly: 3, 'semi-annually': 6, annually: 12 }[frequency] || 3;
                const observationDate = rollFollowingISO(addMonthsISO(lastObsDate, months), observationCalendars);

                // Added rows are hand edits: regeneration asks before overwriting them
                const newObs = markManualEdit({
                  id: `period_${schedule.length}`,
                  valueDate: paymentDateFor(observationDate, paymentLag.lag, paymentCalendars),
                  autocallLevel: initialAutocallLevel,
                  isCallable: true,
                  couponBarrier: initialCouponBarrier,
                  periodIndex: schedule.length + 1,
                  rebateAmount: isParticipationNote ? 0 : null
                }, 'observationDate', observationDate);

                commitSchedule([...schedule, newObs]);
              }}
              style={{
                padding: '0.75rem 1.5rem',
                background: 'var(--accent-color)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: '600',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.transform = 'scale(1.05)';
                e.target.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'scale(1)';
                e.target.style.boxShadow = 'none';
              }}
              title="Add a new observation period to the schedule"
            >
              ➕ Add Observation Period
            </button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Manually add custom observation periods
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleBuilder;
