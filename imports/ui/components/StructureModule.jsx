import React, { useState, useEffect, useCallback } from 'react';
import { BUILT_IN_TEMPLATES } from '/imports/api/templates';

// Structure Module Component - Configuration parameters for selected templates
const StructureModule = ({ selectedTemplateId, structureParams, onParamChange }) => {

  // Product-specific parameter configuration based on selected template
  const renderParameterScreen = () => {
    if (!selectedTemplateId) {
      return (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          color: 'var(--text-muted)'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📋</div>
          <h3>No Template Selected</h3>
          <p>Please select a template first to configure product parameters</p>
        </div>
      );
    }

    const selectedTemplate = BUILT_IN_TEMPLATES.find(t => t._id === selectedTemplateId);
    if (!selectedTemplate) return null;

    const commonStyle = {
      backgroundColor: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '24px',
      boxShadow: '0 2px 8px var(--shadow), 0 1px 3px rgba(0,0,0,0.05)',
      position: 'relative',
      overflow: 'hidden'
    };

    const fieldStyle = {
      marginBottom: '16px'
    };

    const labelStyle = {
      display: 'block',
      marginBottom: '8px',
      fontWeight: '600',
      color: 'var(--text-primary)',
      fontSize: '0.875rem',
      lineHeight: '1.2'
    };

    const fieldContainerStyle = {
      display: 'flex',
      flexDirection: 'column',
      minHeight: '60px',
      justifyContent: 'flex-start'
    };

    const inputBaseStyle = {
      padding: '10px 12px',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      fontSize: '0.9rem',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      transition: 'all 0.2s ease',
      boxSizing: 'border-box',
      height: '40px'
    };

    const inputStyle = {
      ...inputBaseStyle,
      width: '100%'
    };

    const selectStyle = {
      ...inputBaseStyle,
      cursor: 'pointer'
    };

    const numberInputStyle = {
      ...inputBaseStyle,
      width: '120px'
    };

    const selectInputStyle = {
      ...inputBaseStyle,
      width: '180px',
      cursor: 'pointer'
    };

    // Focus and blur event handlers for consistent styling
    const handleInputFocus = (e) => {
      e.target.style.borderColor = 'var(--accent-color)';
      e.target.style.boxShadow = '0 0 0 2px rgba(0, 123, 255, 0.1)';
    };

    const handleInputBlur = (e) => {
      e.target.style.borderColor = 'var(--border-color)';
      e.target.style.boxShadow = 'none';
    };

    switch (selectedTemplateId) {
      case 'phoenix_autocallable':
        return (
          <div>
            <div style={commonStyle}>
              <h4 style={{
                margin: '0 0 20px 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem',
                fontWeight: '600',
                borderBottom: '2px solid var(--accent-color)',
                paddingBottom: '8px'
              }}>🔥 Phoenix Autocallable Configuration</h4>

              {/* Essential Parameters */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '1.5rem',
                marginBottom: '2rem'
              }}>
                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Coupon Rate (% per period)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={structureParams?.couponRate !== undefined ? structureParams.couponRate : 8.5}
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={(e) => {
                      handleInputBlur(e);
                      // Parse and save value on blur
                      const value = e.target.value.replace(',', '.');
                      const numValue = parseFloat(value);
                      if (!isNaN(numValue)) {
                        onParamChange && onParamChange('couponRate', numValue);
                      } else {
                        // Reset to default if invalid
                        e.target.value = structureParams?.couponRate !== undefined ? structureParams.couponRate : 8.5;
                      }
                    }}
                  />
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Capital Protection Barrier</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      value={structureParams?.protectionBarrierType || 'european'}
                      style={{ ...selectInputStyle, width: '110px' }}
                      onFocus={handleInputFocus}
                      onBlur={handleInputBlur}
                      onChange={(e) => onParamChange && onParamChange('protectionBarrierType', e.target.value)}
                    >
                      <option value="american">American</option>
                      <option value="european">European</option>
                    </select>
                    <input
                      type="number"
                      value={structureParams?.protectionBarrierLevel || 70}
                      min="50"
                      max="100"
                      step="1"
                      style={{ ...numberInputStyle, width: '70px' }}
                      onFocus={handleInputFocus}
                      onBlur={handleInputBlur}
                      onChange={(e) => onParamChange && onParamChange('protectionBarrierLevel', parseInt(e.target.value) || 0)}
                    />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>%</span>
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Strike Level (%)</label>
                  <input
                    type="number"
                    value={structureParams?.strike || 100}
                    min="80"
                    max="120"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('strike', parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>

              {/* Features Section */}
              <div style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '1.5rem',
                marginBottom: '1rem'
              }}>
                <h5 style={{
                  margin: '0 0 1rem 0',
                  color: 'var(--text-primary)',
                  fontSize: '1rem',
                  fontWeight: '600'
                }}>
                  Available Features
                </h5>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: '1rem'
                }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    background: 'var(--bg-primary)',
                    transition: 'background-color 0.2s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={structureParams?.memoryCoupon === true}
                      style={{
                        width: '18px',
                        height: '18px',
                        accentColor: 'var(--accent-color)'
                      }}
                      onChange={(e) => onParamChange && onParamChange('memoryCoupon', e.target.checked)}
                    />
                    <span style={{
                      fontSize: '0.9rem',
                      color: 'var(--text-primary)',
                      fontWeight: '500'
                    }}>
                      Memory Coupon - Accumulates unpaid coupons
                    </span>
                  </label>

                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    background: 'var(--bg-primary)',
                    transition: 'background-color 0.2s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={structureParams?.memoryAutocall === true}
                      style={{
                        width: '18px',
                        height: '18px',
                        accentColor: 'var(--accent-color)'
                      }}
                      onChange={(e) => onParamChange && onParamChange('memoryAutocall', e.target.checked)}
                    />
                    <span style={{
                      fontSize: '0.9rem',
                      color: 'var(--text-primary)',
                      fontWeight: '500'
                    }}>
                      Memory Autocall - Remembers previous autocall opportunities
                    </span>
                  </label>

                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    cursor: 'pointer',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    background: 'var(--bg-primary)',
                    transition: 'background-color 0.2s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={structureParams?.oneStarRating === true}
                      style={{
                        width: '18px',
                        height: '18px',
                        accentColor: 'var(--accent-color)'
                      }}
                      onChange={(e) => onParamChange && onParamChange('oneStarRating', e.target.checked)}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span style={{
                        fontSize: '0.9rem',
                        color: 'var(--text-primary)',
                        fontWeight: '500'
                      }}>
                        ⭐ One Star Rating - Capital protection at maturity
                      </span>
                      <span style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        fontWeight: '400',
                        fontStyle: 'italic'
                      }}>
                        If at least one underlying is at or above initial level at maturity, capital is 100% protected
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        );

      case 'orion_memory':
        return (
          <div>
            <div style={commonStyle}>
              <h4 style={{
                margin: '0 0 20px 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem',
                fontWeight: '600',
                borderBottom: '2px solid var(--accent-color)',
                paddingBottom: '8px'
              }}>⭐ Orion Memory Configuration</h4>

              {/* Essential ORION Parameters */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '1.5rem'
              }}>
                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Upper Barrier (%)</label>
                  <input
                    type="number"
                    value={structureParams?.upperBarrier || 100}
                    min="90"
                    max="120"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('upperBarrier', parseInt(e.target.value) || 0)}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Autocall trigger level
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Rebate (%)</label>
                  <input
                    type="number"
                    value={structureParams?.rebate || 8.0}
                    min="0"
                    max="20"
                    step="0.1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('rebate', parseFloat(e.target.value) || 0)}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Annual coupon rate
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Capital Guaranteed Level (%)</label>
                  <input
                    type="number"
                    value={structureParams?.capitalGuaranteed || 100}
                    min="80"
                    max="100"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('capitalGuaranteed', parseInt(e.target.value) || 0)}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Minimum return at maturity
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'himalaya':
        return (
          <div>
            <div style={commonStyle}>
              <h4 style={{ margin: '0 0 20px 0', color: 'var(--text-primary)' }}>🏔️ Himalaya Configuration</h4>

              <div style={{
                maxWidth: '400px'
              }}>
                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>
                    Capital Protection Level (Floor) (%)
                    <span style={{
                      display: 'block',
                      fontSize: '0.75rem',
                      fontWeight: '400',
                      color: 'var(--text-muted)',
                      marginTop: '4px'
                    }}>
                      Minimum payout level - final performance cannot go below this
                    </span>
                  </label>
                  <input
                    type="number"
                    value={structureParams?.floor || 100}
                    onChange={(e) => onParamChange('floor', parseFloat(e.target.value))}
                    min="0"
                    max="100"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                  />
                </div>

                <div style={{
                  marginTop: '1.5rem',
                  padding: '1rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.5'
                }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                    ℹ️ How Himalaya Works:
                  </div>
                  <ul style={{ margin: '0', paddingLeft: '1.5rem' }}>
                    <li>At each observation date, the best performing underlying is selected</li>
                    <li>That underlying is then removed from future observations</li>
                    <li>At maturity, all recorded performances are averaged</li>
                    <li>The floor ensures the final payout is at least {structureParams?.floor || 100}%</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        );

      case 'participation_note':
        return (
          <div>
            <div style={commonStyle}>
              <h4 style={{
                margin: '0 0 20px 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem',
                fontWeight: '600',
                borderBottom: '2px solid var(--accent-color)',
                paddingBottom: '8px'
              }}>📈 Participation Note Configuration</h4>

              {/* Essential Participation Note Parameters */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1.5rem',
                marginBottom: '1.5rem'
              }}>
                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Participation Rate (%)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={structureParams?.participationRate !== undefined ? structureParams.participationRate : 100}
                    min="0"
                    max="500"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={(e) => {
                      handleInputBlur(e);
                      const numValue = parseInt(e.target.value);
                      if (!isNaN(numValue)) {
                        onParamChange && onParamChange('participationRate', numValue);
                      } else {
                        e.target.value = structureParams?.participationRate !== undefined ? structureParams.participationRate : 100;
                      }
                    }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Multiplier applied to underlying performance
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Strike (%)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={structureParams?.strike !== undefined ? structureParams.strike : 100}
                    min="50"
                    max="150"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={(e) => {
                      handleInputBlur(e);
                      const numValue = parseInt(e.target.value);
                      if (!isNaN(numValue)) {
                        onParamChange && onParamChange('strike', numValue);
                      } else {
                        e.target.value = structureParams?.strike !== undefined ? structureParams.strike : 100;
                      }
                    }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Initial reference level
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Cap Level (%)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={structureParams?.cap !== undefined ? structureParams.cap : 0}
                    min="0"
                    max="500"
                    step="5"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={(e) => {
                      handleInputBlur(e);
                      const numValue = parseInt(e.target.value);
                      if (!isNaN(numValue)) {
                        onParamChange && onParamChange('cap', numValue);
                      } else {
                        e.target.value = structureParams?.cap !== undefined ? structureParams.cap : 0;
                      }
                    }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Maximum payout level (0 = no cap)
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Capital Guarantee Level (%)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={structureParams?.capitalGuarantee !== undefined ? structureParams.capitalGuarantee : 100}
                    min="0"
                    max="100"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={(e) => {
                      handleInputBlur(e);
                      const numValue = parseInt(e.target.value);
                      if (!isNaN(numValue)) {
                        onParamChange && onParamChange('capitalGuarantee', numValue);
                      } else {
                        e.target.value = structureParams?.capitalGuarantee !== undefined ? structureParams.capitalGuarantee : 100;
                      }
                    }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Minimum redemption level at maturity
                  </div>
                </div>
              </div>

              {/* Callable Feature */}
              <div style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '1.5rem',
                marginBottom: '1rem'
              }}>
                <h5 style={{
                  margin: '0 0 1rem 0',
                  color: 'var(--text-primary)',
                  fontSize: '1rem',
                  fontWeight: '600'
                }}>
                  Additional Features
                </h5>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  cursor: 'pointer',
                  padding: '0.5rem',
                  borderRadius: '6px',
                  background: 'var(--bg-primary)',
                  transition: 'background-color 0.2s ease'
                }}>
                  <input
                    type="checkbox"
                    checked={structureParams?.callableByIssuer === true}
                    style={{
                      width: '18px',
                      height: '18px',
                      accentColor: 'var(--accent-color)'
                    }}
                    onChange={(e) => onParamChange && onParamChange('callableByIssuer', e.target.checked)}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <span style={{
                      fontSize: '0.9rem',
                      color: 'var(--text-primary)',
                      fontWeight: '500'
                    }}>
                      Callable by Issuer
                    </span>
                    <span style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      fontWeight: '400',
                      fontStyle: 'italic'
                    }}>
                      Issuer has the right to call the product before maturity
                    </span>
                  </div>
                </label>

                {/* Rebate field - shown only if callable */}
                {structureParams?.callableByIssuer && (
                  <div style={{
                    padding: '1rem',
                    background: 'var(--bg-primary)',
                    borderRadius: '6px',
                    marginLeft: '2.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem'
                  }}>
                    {/* Coupon Type Selector */}
                    <div>
                      <label style={{
                        ...labelStyle,
                        marginBottom: '0.75rem',
                        display: 'block'
                      }}>
                        Rebate Type
                      </label>
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                      }}>
                        <label style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          cursor: 'pointer',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          background: structureParams?.issuerCallRebateType === 'fixed' || !structureParams?.issuerCallRebateType ? 'var(--bg-secondary)' : 'transparent',
                          border: '1px solid',
                          borderColor: structureParams?.issuerCallRebateType === 'fixed' || !structureParams?.issuerCallRebateType ? 'var(--accent-color)' : 'var(--border-color)'
                        }}>
                          <input
                            type="radio"
                            name="issuerCallRebateType"
                            value="fixed"
                            checked={structureParams?.issuerCallRebateType === 'fixed' || !structureParams?.issuerCallRebateType}
                            style={{
                              accentColor: 'var(--accent-color)'
                            }}
                            onChange={(e) => onParamChange && onParamChange('issuerCallRebateType', 'fixed')}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '500' }}>
                              Fixed Coupon Amount
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              Flat payment regardless of time spent (e.g., 5% means investor receives 105%)
                            </span>
                          </div>
                        </label>
                        <label style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          cursor: 'pointer',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          background: structureParams?.issuerCallRebateType === 'per_annum' ? 'var(--bg-secondary)' : 'transparent',
                          border: '1px solid',
                          borderColor: structureParams?.issuerCallRebateType === 'per_annum' ? 'var(--accent-color)' : 'var(--border-color)'
                        }}>
                          <input
                            type="radio"
                            name="issuerCallRebateType"
                            value="per_annum"
                            checked={structureParams?.issuerCallRebateType === 'per_annum'}
                            style={{
                              accentColor: 'var(--accent-color)'
                            }}
                            onChange={(e) => onParamChange && onParamChange('issuerCallRebateType', 'per_annum')}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '500' }}>
                              Coupon p.a.
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              Calculated based on time spent in product (prorated by days)
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* Rebate Value */}
                    <div>
                      <label style={labelStyle}>
                        {structureParams?.issuerCallRebateType === 'per_annum'
                          ? 'Issuer Call Rebate (% p.a.)'
                          : 'Issuer Call Rebate (%)'}
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        defaultValue={structureParams?.issuerCallRebate !== undefined ? structureParams.issuerCallRebate : 0}
                        min="0"
                        max="20"
                        step="0.5"
                        style={numberInputStyle}
                        onFocus={handleInputFocus}
                        onBlur={(e) => {
                          handleInputBlur(e);
                          const value = e.target.value.replace(',', '.');
                          const numValue = parseFloat(value);
                          if (!isNaN(numValue)) {
                            onParamChange && onParamChange('issuerCallRebate', numValue);
                          } else {
                            e.target.value = structureParams?.issuerCallRebate !== undefined ? structureParams.issuerCallRebate : 0;
                          }
                        }}
                      />
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {structureParams?.issuerCallRebateType === 'per_annum'
                          ? 'Annual rate that will be prorated based on actual days held when product is called'
                          : 'Additional payment on top of 100% when product is called by issuer (e.g., 5% means investor receives 105%)'}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Info Box */}
              <div style={{
                marginTop: '1.5rem',
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                lineHeight: '1.5'
              }}>
                <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  ℹ️ How Participation Note Works:
                </div>
                <ul style={{ margin: '0', paddingLeft: '1.5rem' }}>
                  <li>At maturity: redemption = {structureParams?.capitalGuarantee || 100}% + (performance × {structureParams?.participationRate || 100}%)</li>
                  <li>Performance is calculated from strike level ({structureParams?.strike || 100}%)</li>
                  {structureParams?.cap && structureParams.cap > 0 ? (
                    <li>Maximum payout is capped at {structureParams.cap}%</li>
                  ) : (
                    <li>No cap - unlimited upside potential with {structureParams?.participationRate || 100}% participation</li>
                  )}
                  <li>Capital guarantee ensures minimum payout of {structureParams?.capitalGuarantee || 100}%</li>
                  {structureParams?.callableByIssuer && (
                    <>
                      <li>Issuer may call the product early if market conditions are favorable</li>
                      {structureParams?.issuerCallRebate > 0 && (
                        structureParams?.issuerCallRebateType === 'per_annum' ? (
                          <li>If called: investor receives 100% + prorated coupon ({structureParams.issuerCallRebate}% p.a. × days held / 365)</li>
                        ) : (
                          <li>If called: investor receives 100% + {structureParams.issuerCallRebate}% fixed rebate = {100 + structureParams.issuerCallRebate}%</li>
                        )
                      )}
                    </>
                  )}
                </ul>
              </div>
            </div>
          </div>
        );

      case 'reverse_convertible':
        return (
          <div>
            <div style={commonStyle}>
              <h4 style={{
                margin: '0 0 20px 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem',
                fontWeight: '600',
                borderBottom: '2px solid var(--accent-color)',
                paddingBottom: '8px'
              }}>🔄 Reverse Convertible Configuration</h4>

              {/* Essential Parameters */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '1.5rem',
                marginBottom: '2rem'
              }}>
                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Coupon Rate p.a. (%)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={structureParams?.couponRate !== undefined ? structureParams.couponRate : 3.5}
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={(e) => {
                      handleInputBlur(e);
                      // Parse and save value on blur
                      const value = e.target.value.replace(',', '.');
                      const numValue = parseFloat(value);
                      if (!isNaN(numValue)) {
                        onParamChange && onParamChange('couponRate', numValue);
                      } else {
                        // Reset to default if invalid
                        e.target.value = structureParams?.couponRate !== undefined ? structureParams.couponRate : 3.5;
                      }
                    }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Guaranteed coupon paid at maturity
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Capital Protection Barrier</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      value={structureParams?.barrierType || 'european'}
                      style={{ ...selectInputStyle, width: '110px' }}
                      onFocus={handleInputFocus}
                      onBlur={handleInputBlur}
                      onChange={(e) => onParamChange && onParamChange('barrierType', e.target.value)}
                    >
                      <option value="american">American</option>
                      <option value="european">European</option>
                    </select>
                    <input
                      type="number"
                      value={structureParams?.capitalProtectionBarrier || 70}
                      min="0"
                      max="100"
                      step="1"
                      style={{ ...numberInputStyle, width: '70px' }}
                      onFocus={handleInputFocus}
                      onBlur={handleInputBlur}
                      onChange={(e) => onParamChange && onParamChange('capitalProtectionBarrier', parseInt(e.target.value) || 0)}
                    />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>%</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {structureParams?.barrierType === 'american'
                      ? 'Continuous monitoring during product life'
                      : 'Checked only at final observation'}
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Strike Level (%)</label>
                  <input
                    type="number"
                    value={structureParams?.strike || 100}
                    min="50"
                    max="150"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('strike', parseInt(e.target.value) || 0)}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Initial reference level for performance calculation
                  </div>
                </div>
              </div>

              {/* Gearing Factor Display (Calculated) */}
              <div style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '1.5rem',
                marginBottom: '1rem'
              }}>
                <h5 style={{
                  margin: '0 0 1rem 0',
                  color: 'var(--text-primary)',
                  fontSize: '1rem',
                  fontWeight: '600'
                }}>
                  Calculated Parameters
                </h5>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1rem'
                }}>
                  <div style={{
                    padding: '1rem',
                    background: 'var(--bg-primary)',
                    borderRadius: '6px'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600'
                    }}>
                      Gearing Factor
                    </div>
                    <div style={{
                      fontSize: '1.5rem',
                      fontWeight: '700',
                      color: 'var(--accent-color)',
                      fontFamily: 'monospace'
                    }}>
                      {(1 / ((structureParams?.capitalProtectionBarrier || 70) / 100)).toFixed(2)}x
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.5rem',
                      lineHeight: '1.4'
                    }}>
                      Downside participation below barrier
                      <br />
                      Formula: 1 ÷ (barrier ÷ 100)
                    </div>
                  </div>

                  <div style={{
                    padding: '1rem',
                    background: 'var(--bg-primary)',
                    borderRadius: '6px'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600'
                    }}>
                      Example Scenario
                    </div>
                    <div style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.6'
                    }}>
                      If underlying at 60% (−40%):<br />
                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        100% + (−40% × {(1 / ((structureParams?.capitalProtectionBarrier || 70) / 100)).toFixed(2)}) + {structureParams?.couponRate || 3.5}%
                      </span>
                      <br />
                      = <strong>{(100 + (-40 * (1 / ((structureParams?.capitalProtectionBarrier || 70) / 100))) + (structureParams?.couponRate || 3.5)).toFixed(1)}%</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Info Box */}
              <div style={{
                marginTop: '1.5rem',
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                lineHeight: '1.5'
              }}>
                <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  ℹ️ How Reverse Convertible Works:
                </div>
                <ul style={{ margin: '0', paddingLeft: '1.5rem' }}>
                  <li><strong>Guaranteed Coupon:</strong> {structureParams?.couponRate || 3.5}% paid at maturity regardless of underlying performance</li>
                  <li><strong>Above Barrier ({structureParams?.capitalProtectionBarrier || 70}%):</strong> Full capital protection → 100% + {structureParams?.couponRate || 3.5}% coupon</li>
                  <li><strong>Below Barrier:</strong> Geared downside exposure → 100% + (performance × {(1 / ((structureParams?.capitalProtectionBarrier || 70) / 100)).toFixed(2)}x) + {structureParams?.couponRate || 3.5}% coupon</li>
                  <li><strong>{structureParams?.barrierType === 'american' ? 'American Barrier:' : 'European Barrier:'}</strong> {structureParams?.barrierType === 'american' ? 'Monitored continuously (any intraday touch counts)' : 'Checked only at final observation date'}</li>
                  <li><strong>Best for:</strong> Investors seeking high income with moderate downside protection in stable markets</li>
                </ul>
              </div>
            </div>
          </div>
        );

      case 'reverse_convertible_bond':
        return (
          <div>
            <div style={commonStyle}>
              <h4 style={{
                margin: '0 0 20px 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem',
                fontWeight: '600',
                borderBottom: '2px solid var(--accent-color)',
                paddingBottom: '8px'
              }}>📜 Reverse Convertible (Bond) Configuration</h4>

              {/* Essential Parameters */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1.5rem',
                marginBottom: '2rem'
              }}>
                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Coupon Rate p.a. (%)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={structureParams?.couponRate !== undefined ? structureParams.couponRate : 3.5}
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={(e) => {
                      handleInputBlur(e);
                      // Parse and save value on blur
                      const value = e.target.value.replace(',', '.');
                      const numValue = parseFloat(value);
                      if (!isNaN(numValue)) {
                        onParamChange && onParamChange('couponRate', numValue);
                      } else {
                        // Reset to default if invalid
                        e.target.value = structureParams?.couponRate !== undefined ? structureParams.couponRate : 3.5;
                      }
                    }}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Guaranteed coupon paid at maturity
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Capital Protection Barrier</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      value={structureParams?.barrierType || 'european'}
                      style={{ ...selectInputStyle, width: '110px' }}
                      onFocus={handleInputFocus}
                      onBlur={handleInputBlur}
                      onChange={(e) => onParamChange && onParamChange('barrierType', e.target.value)}
                    >
                      <option value="american">American</option>
                      <option value="european">European</option>
                    </select>
                    <input
                      type="number"
                      value={structureParams?.capitalProtectionBarrier || 100}
                      min="0"
                      max="100"
                      step="1"
                      style={{ ...numberInputStyle, width: '70px' }}
                      onFocus={handleInputFocus}
                      onBlur={handleInputBlur}
                      onChange={(e) => onParamChange && onParamChange('capitalProtectionBarrier', parseInt(e.target.value) || 0)}
                    />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>%</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {structureParams?.barrierType === 'american'
                      ? 'Continuous monitoring during product life'
                      : 'Checked only at final observation'}
                  </div>
                </div>
              </div>

              {/* Gearing Factor Display (Calculated) */}
              <div style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '1.5rem',
                marginBottom: '1rem'
              }}>
                <h5 style={{
                  margin: '0 0 1rem 0',
                  color: 'var(--text-primary)',
                  fontSize: '1rem',
                  fontWeight: '600'
                }}>
                  Calculated Parameters
                </h5>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1rem'
                }}>
                  <div style={{
                    padding: '1rem',
                    background: 'var(--bg-primary)',
                    borderRadius: '6px'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600'
                    }}>
                      Gearing Factor
                    </div>
                    <div style={{
                      fontSize: '1.5rem',
                      fontWeight: '700',
                      color: 'var(--accent-color)',
                      fontFamily: 'monospace'
                    }}>
                      {(1 / ((structureParams?.capitalProtectionBarrier || 100) / 100)).toFixed(2)}x
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.5rem',
                      lineHeight: '1.4'
                    }}>
                      Downside participation below barrier
                      <br />
                      Formula: 1 ÷ (barrier ÷ 100)
                    </div>
                  </div>

                  <div style={{
                    padding: '1rem',
                    background: 'var(--bg-primary)',
                    borderRadius: '6px'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      marginBottom: '0.5rem',
                      fontWeight: '600'
                    }}>
                      Example Scenario
                    </div>
                    <div style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.6'
                    }}>
                      If bond at 95% (−5%):<br />
                      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        100% + (−5% × {(1 / ((structureParams?.capitalProtectionBarrier || 100) / 100)).toFixed(2)}) + {structureParams?.couponRate || 3.5}%
                      </span>
                      <br />
                      = <strong>{(100 + (-5 * (1 / ((structureParams?.capitalProtectionBarrier || 100) / 100))) + (structureParams?.couponRate || 3.5)).toFixed(1)}%</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Info Box */}
              <div style={{
                marginTop: '1.5rem',
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                lineHeight: '1.5'
              }}>
                <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  ℹ️ How Reverse Convertible (Bond) Works:
                </div>
                <ul style={{ margin: '0', paddingLeft: '1.5rem' }}>
                  <li><strong>Guaranteed Coupon:</strong> {structureParams?.couponRate || 3.5}% paid at maturity regardless of bond performance</li>
                  <li><strong>Above Barrier ({structureParams?.capitalProtectionBarrier || 100}%):</strong> Full capital protection → 100% + {structureParams?.couponRate || 3.5}% coupon</li>
                  <li><strong>Below Barrier:</strong> Geared downside exposure → 100% + (performance × {(1 / ((structureParams?.capitalProtectionBarrier || 100) / 100)).toFixed(2)}x) + {structureParams?.couponRate || 3.5}% coupon</li>
                  <li><strong>{structureParams?.barrierType === 'american' ? 'American Barrier:' : 'European Barrier:'}</strong> {structureParams?.barrierType === 'american' ? 'Monitored continuously (any intraday touch counts)' : 'Checked only at final observation date'}</li>
                  <li><strong>Bond Underlying:</strong> This template is designed for reverse convertibles on bond underlyings</li>
                  <li><strong>Best for:</strong> Investors seeking high income with full capital protection on investment-grade bonds</li>
                </ul>
              </div>
            </div>
          </div>
        );

      case 'shark_note':
        return (
          <div>
            <div style={commonStyle}>
              <h4 style={{
                margin: '0 0 20px 0',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem',
                fontWeight: '600',
                borderBottom: '2px solid var(--accent-color)',
                paddingBottom: '8px'
              }}>🦈 Shark Note Configuration</h4>

              {/* Essential Shark Note Parameters */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1.5rem',
                marginBottom: '1.5rem'
              }}>
                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Strike (%)</label>
                  <input
                    type="number"
                    value={structureParams?.strike || 100}
                    min="50"
                    max="150"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('strike', parseInt(e.target.value) || 0)}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Initial reference level
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Upper Barrier (Knock-Out) (%)</label>
                  <input
                    type="number"
                    value={structureParams?.upperBarrier || 140}
                    min="110"
                    max="200"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('upperBarrier', parseInt(e.target.value) || 0)}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Barrier touch triggers early termination
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Rebate Value (%)</label>
                  <input
                    type="number"
                    value={structureParams?.rebateValue || 10}
                    min="0"
                    max="50"
                    step="0.5"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('rebateValue', parseFloat(e.target.value) || 0)}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Fixed payment if barrier touched
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Floor Level (%)</label>
                  <input
                    type="number"
                    value={structureParams?.floorLevel || 90}
                    min="0"
                    max="100"
                    step="1"
                    style={numberInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('floorLevel', parseInt(e.target.value) || 0)}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Minimum redemption level
                  </div>
                </div>
              </div>

              {/* Additional Configuration */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1.5rem'
              }}>
                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Reference Performance</label>
                  <select
                    value={structureParams?.referencePerformance || 'worst-of'}
                    style={selectInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('referencePerformance', e.target.value)}
                  >
                    <option value="worst-of">Worst Of</option>
                    <option value="best-of">Best Of</option>
                    <option value="average">Average</option>
                  </select>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    For basket products
                  </div>
                </div>

                <div style={fieldContainerStyle}>
                  <label style={labelStyle}>Barrier Observation</label>
                  <select
                    value={structureParams?.barrierObservation || 'continuous'}
                    style={selectInputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    onChange={(e) => onParamChange && onParamChange('barrierObservation', e.target.value)}
                  >
                    <option value="continuous">Continuous</option>
                    <option value="closing">Closing Prices</option>
                    <option value="at_maturity">At Maturity Only</option>
                  </select>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    When barrier is monitored
                  </div>
                </div>
              </div>

              {/* Info Box */}
              <div style={{
                marginTop: '1.5rem',
                padding: '1rem',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                lineHeight: '1.5'
              }}>
                <div style={{ fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  ℹ️ How Shark Note Works:
                </div>
                <ul style={{ margin: '0', paddingLeft: '1.5rem' }}>
                  <li>If upper barrier is touched during product life: redemption = 100% + {structureParams?.rebateValue || 10}% (fixed rebate)</li>
                  <li>If upper barrier NOT touched: redemption = Max(100% + performance, {structureParams?.floorLevel || 90}%)</li>
                  <li>Floor level provides downside protection</li>
                  <li>No observation schedule needed - only initial and maturity dates</li>
                </ul>
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            <p>Parameter configuration not available for this template</p>
          </div>
        );
    }
  };

  return (
    <div className="structure-module">
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem',
        paddingBottom: '1rem',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>Product Parameters</h2>
      </div>

      {renderParameterScreen()}
    </div>
  );
};

export default StructureModule;
