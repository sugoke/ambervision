import React, { useState, useEffect } from 'react';
import { formatDateToISO, formatDateToDDMMYYYY, isWeekend, isMarketHoliday, getNextTradingDay } from '/imports/utils/dateUtils.js';

const ScheduleBuilder = ({ productDetails, scheduleConfig, onUpdateSchedule, onConfigChange, selectedTemplateId, underlyings, existingSchedule }) => {
  const [schedule, setSchedule] = useState(existingSchedule || []);
  const [stepDownInput, setStepDownInput] = useState('');
  const [hasLoadedExistingSchedule, setHasLoadedExistingSchedule] = useState(false);
  const [allowRegeneration, setAllowRegeneration] = useState(false);

  // Check if this is a participation note
  const isParticipationNote = selectedTemplateId === 'participation_note';

  // Use props for configuration, fallback to defaults if not provided
  const frequency = scheduleConfig?.frequency || 'quarterly';
  const coolOffPeriods = scheduleConfig?.coolOffPeriods ?? 0;
  const stepDownValue = scheduleConfig?.stepDownValue ?? -5;
  const initialAutocallLevel = scheduleConfig?.initialAutocallLevel ?? 100;
  const initialCouponBarrier = scheduleConfig?.initialCouponBarrier ?? 70;

  // Initialize local input state from prop
  useEffect(() => {
    setStepDownInput(String(stepDownValue));
  }, []);

  // Load existing schedule from term sheet extraction
  useEffect(() => {
    if (existingSchedule && existingSchedule.length > 0 && !hasLoadedExistingSchedule) {
      console.log('[ScheduleBuilder] Loading existing schedule from term sheet:', existingSchedule.length, 'observations');

      // Log rebateAmount values for debugging
      if (isParticipationNote) {
        console.log('[ScheduleBuilder] Participation Note schedule with rebateAmount:',
          existingSchedule.map(obs => ({
            id: obs.id,
            observationDate: obs.observationDate,
            rebateAmount: obs.rebateAmount
          }))
        );
      }

      setSchedule(existingSchedule);
      setHasLoadedExistingSchedule(true);
      setAllowRegeneration(false); // Don't allow regeneration immediately after term sheet load
      if (onUpdateSchedule) {
        onUpdateSchedule(existingSchedule);
      }
    }
  }, [existingSchedule]);

  // Track configuration changes - when user changes config, allow regeneration
  useEffect(() => {
    if (hasLoadedExistingSchedule && schedule.length > 0) {
      // User has changed a configuration value, enable regeneration
      setAllowRegeneration(true);
    }
  }, [frequency, coolOffPeriods, stepDownValue, initialAutocallLevel, initialCouponBarrier]);

  // Calculate delay days from setup tab (difference between trade date and value date)
  const getDelayDays = () => {
    if (productDetails?.tradeDate && productDetails?.valueDate) {
      const tradeDate = new Date(productDetails.tradeDate);
      const valueDate = new Date(productDetails.valueDate);
      const diffTime = valueDate.getTime() - tradeDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays > 0 ? diffDays : 14; // Default to 14 if negative or zero
    }
    return 14; // Default delay
  };

  // Generate observation dates based on frequency
  const generateObservationDates = () => {
    if (!productDetails?.tradeDate || !productDetails?.finalObservation) {
      return [];
    }

    const tradeDate = new Date(productDetails.tradeDate);
    const finalDate = new Date(productDetails.finalObservation);
    const dates = [];
    let currentDate = new Date(tradeDate);

    // Calculate interval based on frequency
    let monthsInterval;
    switch (frequency) {
      case 'monthly': monthsInterval = 1; break;
      case 'quarterly': monthsInterval = 3; break;
      case 'semi-annually': monthsInterval = 6; break;
      case 'annually': monthsInterval = 12; break;
      default: monthsInterval = 3;
    }

    // Generate dates until final observation
    let periodIndex = 0;
    while (currentDate <= finalDate) {
      // Move to next period
      currentDate = new Date(tradeDate);
      currentDate.setMonth(currentDate.getMonth() + (periodIndex + 1) * monthsInterval);

      // Don't go beyond final observation
      if (currentDate > finalDate) {
        currentDate = new Date(finalDate);
      }

      // Adjust for weekends and holidays
      while (isWeekend(currentDate) || isMarketHoliday(currentDate, ['US', 'EU', 'GB'])) {
        currentDate = getNextTradingDay(currentDate, ['US', 'EU', 'GB']);
      }

      dates.push(new Date(currentDate));
      
      // Break if we've reached the final date
      if (currentDate.getTime() >= finalDate.getTime()) {
        break;
      }
      
      periodIndex++;
    }

    return dates;
  };

  // Generate value dates (observation date + delay)
  const generateValueDate = (observationDate) => {
    const delayDays = getDelayDays();
    let valueDate = new Date(observationDate);
    valueDate.setDate(valueDate.getDate() + delayDays);

    // Adjust for weekends and holidays
    while (isWeekend(valueDate) || isMarketHoliday(valueDate, ['US', 'EU', 'GB'])) {
      valueDate = getNextTradingDay(valueDate, ['US', 'EU', 'GB']);
    }

    return valueDate;
  };

  // Generate schedule when dependencies change
  useEffect(() => {
    // Safety check for productDetails
    if (!productDetails) return;

    // IMPORTANT: If schedule exists from term sheet and user hasn't changed config, preserve it
    // But allow regeneration if user has explicitly changed configuration values
    if (schedule && schedule.length > 0 && hasLoadedExistingSchedule && !allowRegeneration) {
      console.log('[ScheduleBuilder] Schedule from term sheet, config unchanged - preserving exact dates');
      return;
    }

    const observationDates = generateObservationDates();
    const newSchedule = observationDates.map((obsDate, index) => {
      const isCallable = index >= coolOffPeriods;
      // Calculate autocall level: N/A for non-call periods, start at initial level for first callable period
      let autocallLevel;
      if (!isCallable) {
        autocallLevel = null; // N/A for non-call periods
      } else {
        // For callable periods, start at initial level and apply step-down from first callable period
        const callablePeriodIndex = index - coolOffPeriods;
        autocallLevel = initialAutocallLevel + (stepDownValue * callablePeriodIndex);
      }

      // Preserve rebateAmount from existingSchedule if available (from term sheet extraction)
      const existingObs = existingSchedule && existingSchedule[index];
      const rebateAmountValue = isParticipationNote
        ? (existingObs?.rebateAmount !== undefined && existingObs?.rebateAmount !== null
            ? existingObs.rebateAmount
            : 0)
        : null;

      return {
        id: `period_${index}`,
        observationDate: formatDateToISO(obsDate),
        valueDate: formatDateToISO(generateValueDate(obsDate)),
        autocallLevel: autocallLevel,
        isCallable: isCallable,
        couponBarrier: initialCouponBarrier,
        periodIndex: index + 1,
        rebateAmount: rebateAmountValue  // Preserve term sheet data or default to 0
      };
    });

    setSchedule(newSchedule);
    if (onUpdateSchedule) {
      onUpdateSchedule(newSchedule);
    }
  }, [
    frequency,
    productDetails?.tradeDate,
    productDetails?.finalObservation,
    productDetails?.valueDate,
    coolOffPeriods,
    stepDownValue,
    initialAutocallLevel,
    initialCouponBarrier,
    allowRegeneration  // Include this so schedule regenerates when user changes config
  ]);

  // Update schedule item
  const updateScheduleItem = (id, field, value) => {
    const updatedSchedule = schedule.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    );
    setSchedule(updatedSchedule);
    if (onUpdateSchedule) {
      onUpdateSchedule(updatedSchedule);
    }
  };

  // Delete schedule row
  const deleteScheduleRow = (id) => {
    const updatedSchedule = schedule.filter(item => item.id !== id);

    // Reindex periods after deletion
    const reindexedSchedule = updatedSchedule.map((item, index) => ({
      ...item,
      periodIndex: index + 1,
      id: `period_${index}` // Also update IDs to maintain consistency
    }));

    setSchedule(reindexedSchedule);
    if (onUpdateSchedule) {
      onUpdateSchedule(reindexedSchedule);
    }
    console.log('[ScheduleBuilder] Deleted row, remaining observations:', reindexedSchedule.length);
  };

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
  if (selectedTemplateId === 'himalaya') {
    const numberOfUnderlyings = underlyings?.length || 0;
    const numberOfObservations = numberOfUnderlyings;

    useEffect(() => {
      if (numberOfObservations > 0 && productDetails?.tradeDate && productDetails?.finalObservation) {
        const tradeDate = new Date(productDetails.tradeDate);
        const finalDate = new Date(productDetails.finalObservation);
        const totalDays = (finalDate - tradeDate) / (1000 * 60 * 60 * 24);
        const intervalDays = totalDays / numberOfObservations;

        const himalayaSchedule = [];
        for (let i = 1; i <= numberOfObservations; i++) {
          let obsDate = new Date(tradeDate);
          obsDate.setDate(obsDate.getDate() + Math.round(intervalDays * i));

          // Adjust for weekends and holidays
          while (isWeekend(obsDate) || isMarketHoliday(obsDate, ['US', 'EU', 'GB'])) {
            obsDate = getNextTradingDay(obsDate, ['US', 'EU', 'GB']);
          }

          himalayaSchedule.push({
            id: `himalaya_obs_${i}`,
            observationDate: formatDateToISO(obsDate),
            valueDate: formatDateToISO(generateValueDate(obsDate)),
            observationNumber: i,
            periodIndex: i
          });
        }

        setSchedule(himalayaSchedule);
        if (onUpdateSchedule) {
          onUpdateSchedule(himalayaSchedule);
        }
      }
    }, [numberOfObservations, productDetails?.tradeDate, productDetails?.finalObservation]);

    // Handler to update observation date
    const updateHimalayaDate = (id, newDate) => {
      const updatedSchedule = schedule.map(item => {
        if (item.id === id) {
          // Recalculate value date based on new observation date
          const obsDate = new Date(newDate);
          return {
            ...item,
            observationDate: newDate,
            valueDate: formatDateToISO(generateValueDate(obsDate))
          };
        }
        return item;
      });

      setSchedule(updatedSchedule);
      if (onUpdateSchedule) {
        onUpdateSchedule(updatedSchedule);
      }
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
              onChange={(e) => onConfigChange && onConfigChange('frequency', e.target.value)}
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
                onConfigChange && onConfigChange('coolOffPeriods', finalValue);
              }}
              onBlur={(e) => {
                // Ensure value is valid on blur
                if (e.target.value === '') {
                  e.target.value = '0';
                  onConfigChange && onConfigChange('coolOffPeriods', 0);
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
                onChange={(e) => onConfigChange && onConfigChange('initialAutocallLevel', parseFloat(e.target.value) || 100)}
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
                        onConfigChange('stepDownValue', numValue);
                      }
                    }
                  }
                }}
                onBlur={() => {
                  // On blur, ensure we have a valid number
                  if (stepDownInput === '' || stepDownInput === '-' || stepDownInput === '.' || stepDownInput === '-.') {
                    setStepDownInput('0');
                    if (onConfigChange) {
                      onConfigChange('stepDownValue', 0);
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
                onChange={(e) => onConfigChange && onConfigChange('initialCouponBarrier', parseFloat(e.target.value) || 70)}
                style={{...inputStyle, width: '80px'}}
              />
            </div>
          )}
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
                          color: '#ef4444',
                          border: '1px solid #ef4444',
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
                          e.target.style.background = '#ef4444';
                          e.target.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.background = 'transparent';
                          e.target.style.color = '#ef4444';
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
                <strong> Delay Days:</strong> {getDelayDays()}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                💡 All dates automatically avoid weekends and major holidays (US/EU)
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

                // Calculate next observation date based on frequency
                const newObsDate = new Date(lastObsDate);
                let monthsInterval;
                switch (frequency) {
                  case 'monthly': monthsInterval = 1; break;
                  case 'quarterly': monthsInterval = 3; break;
                  case 'semi-annually': monthsInterval = 6; break;
                  case 'annually': monthsInterval = 12; break;
                  default: monthsInterval = 3;
                }
                newObsDate.setMonth(newObsDate.getMonth() + monthsInterval);

                // Create new observation
                const newObs = {
                  id: `period_${schedule.length}`,
                  observationDate: formatDateToISO(newObsDate),
                  valueDate: formatDateToISO(generateValueDate(newObsDate)),
                  autocallLevel: initialAutocallLevel,
                  isCallable: true,
                  couponBarrier: initialCouponBarrier,
                  periodIndex: schedule.length + 1,
                  rebateAmount: isParticipationNote ? 0 : null
                };

                const updatedSchedule = [...schedule, newObs];
                setSchedule(updatedSchedule);
                if (onUpdateSchedule) {
                  onUpdateSchedule(updatedSchedule);
                }
                console.log('[ScheduleBuilder] Added new observation period');
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
