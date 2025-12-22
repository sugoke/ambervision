import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { IssuersCollection } from '/imports/api/issuers';
import { formatDateToISO, formatDateToDDMMYYYY, isWeekend, isMarketHoliday, getNextTradingDay } from '/imports/utils/dateUtils.js';
import { formatDateForDisplay, formatDateInput as formatDateInputUtil, formatDateForInput } from '/imports/utils/dateFormatters.js';
import CustomDateInput from '../../CustomDateInput.jsx';
import { validateISIN, cleanISIN } from '/imports/utils/isinValidator.js';

const ProductDetailsCard = ({ productDetails, onUpdateProductDetails, onRegenerateTitle, editingProduct }) => {
  const [editingField, setEditingField] = useState(null);
  const [tempValue, setTempValue] = useState('');

  // ISIN validation states
  const [isinValidation, setIsinValidation] = useState({ valid: true, error: null });
  const [isinUniqueness, setIsinUniqueness] = useState({ isUnique: true, conflict: null });
  const [isCheckingIsin, setIsCheckingIsin] = useState(false);
  const isinCheckTimeoutRef = useRef(null);

  // Date calculation helper states
  const [showDateHelper, setShowDateHelper] = useState(false);
  const [initialToPaymentDelay, setInitialToPaymentDelay] = useState(14);
  const [finalToMaturityDelay, setFinalToMaturityDelay] = useState(14);
  const [productDuration, setProductDuration] = useState('');

  // Subscribe to issuers data
  const issuers = useTracker(() => {
    Meteor.subscribe('issuers');
    return IssuersCollection.find({ active: true }, { sort: { name: 1 } }).fetch();
  });

  // Validate ISIN whenever productDetails.isin changes
  useEffect(() => {
    const currentIsin = productDetails.isin;

    // Clear previous timeout
    if (isinCheckTimeoutRef.current) {
      clearTimeout(isinCheckTimeoutRef.current);
    }

    // Reset validation states if ISIN is empty
    if (!currentIsin || !currentIsin.trim()) {
      setIsinValidation({ valid: true, error: null });
      setIsinUniqueness({ isUnique: true, conflict: null });
      setIsCheckingIsin(false);
      return;
    }

    // Validate ISIN syntax
    const syntaxValidation = validateISIN(currentIsin);
    setIsinValidation(syntaxValidation);

    // If syntax is invalid, don't check uniqueness
    if (!syntaxValidation.valid) {
      setIsinUniqueness({ isUnique: true, conflict: null });
      setIsCheckingIsin(false);
      return;
    }

    // Debounce uniqueness check (500ms after user stops typing)
    setIsCheckingIsin(true);
    isinCheckTimeoutRef.current = setTimeout(async () => {
      try {
        const cleanedIsin = cleanISIN(currentIsin);
        const result = await Meteor.callAsync(
          'products.checkISINUniqueness',
          cleanedIsin,
          editingProduct?._id // Exclude current product if editing
        );
        setIsinUniqueness(result);
      } catch (error) {
        console.error('Error checking ISIN uniqueness:', error);
        setIsinUniqueness({ isUnique: true, conflict: null });
      } finally {
        setIsCheckingIsin(false);
      }
    }, 500);

    // Cleanup timeout on unmount
    return () => {
      if (isinCheckTimeoutRef.current) {
        clearTimeout(isinCheckTimeoutRef.current);
      }
    };
  }, [productDetails.isin, editingProduct?._id]);

  const handleEdit = (field, currentValue) => {
    setEditingField(field);
    // For date fields, keep the YYYY-MM-DD format for HTML date inputs
    if (['tradeDate', 'valueDate', 'finalObservation', 'maturity'].includes(field)) {
      // Use the raw value for HTML date inputs
      setTempValue(currentValue || '');
    } else {
      setTempValue(currentValue);
    }
  };

  // Handle direct changes to date inputs
  const handleDateChange = (field, newValue) => {
    // Safety check for onUpdateProductDetails prop
    if (!onUpdateProductDetails) {
      console.warn('onUpdateProductDetails prop not provided to ProductDetailsCard');
      return;
    }
    
    // Validate the date format and value
    if (newValue && newValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const dateValue = new Date(newValue);
      if (!isNaN(dateValue.getTime())) {
        onUpdateProductDetails(field, newValue);
        return;
      }
    }
    // Allow clearing the field or set empty if invalid
    onUpdateProductDetails(field, newValue === '' ? '' : productDetails[field]);
  };

  const handleSave = (field) => {
    // Safety check for onUpdateProductDetails prop
    if (!onUpdateProductDetails) {
      console.warn('onUpdateProductDetails prop not provided to ProductDetailsCard');
      setEditingField(null);
      setTempValue('');
      return;
    }
    
    let processedValue = tempValue;
    
    // ISIN validation and formatting
    if (field === 'isin') {
      processedValue = tempValue.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (processedValue.length > 12) {
        processedValue = processedValue.substring(0, 12);
      }
    }
    
    onUpdateProductDetails(field, processedValue);
    setEditingField(null);
    setTempValue('');
  };

  const handleKeyPress = (e, field) => {
    if (e.key === 'Enter') {
      handleSave(field);
    }
    if (e.key === 'Escape') {
      setEditingField(null);
      setTempValue('');
    }
  };

  // Date calculation helpers
  const parseDuration = (duration) => {
    if (!duration) return null;
    const match = duration.match(/^(\d+)([MYmy])$/i);
    if (!match) return null;
    
    const value = parseInt(match[1]);
    const unit = match[2].toUpperCase();
    
    if (unit === 'M') return { months: value };
    if (unit === 'Y') return { years: value };
    return null;
  };

  const addCalendarDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  const addDuration = (date, duration) => {
    const parsed = parseDuration(duration);
    if (!parsed) return null;
    
    const result = new Date(date);
    if (parsed.months) {
      result.setMonth(result.getMonth() + parsed.months);
    }
    if (parsed.years) {
      result.setFullYear(result.getFullYear() + parsed.years);
    }
    
    return result;
  };


  const calculateDates = () => {
    if (!productDetails.tradeDate || !productDuration || !productDuration.trim()) {
      alert('Please set both Trade Date and Product Duration before calculating dates.');
      return;
    }
    
    const tradeDate = new Date(productDetails.tradeDate);
    if (isNaN(tradeDate.getTime())) {
      alert('Invalid trade date. Please enter a valid date.');
      return;
    }
    
    // Calculate Value Date - trade date + initialToPaymentDelay calendar days
    let valueDate = addCalendarDays(tradeDate, initialToPaymentDelay);
    
    // If value date falls on weekend/holiday, move to next business day
    if (isWeekend(valueDate) || isMarketHoliday(valueDate, ['US', 'EU', 'GB'])) {
      valueDate = getNextTradingDay(valueDate, ['US', 'EU', 'GB']);
    }
    
    // Calculate Final Observation Date - based on duration from TRADE date (not value date)
    let finalObservation = addDuration(tradeDate, productDuration);
    if (!finalObservation) {
      alert(`Invalid product duration format: "${productDuration}". Please use format like "6M", "1Y", "2Y", etc.`);
      return;
    }
    
    // If final observation falls on weekend/holiday, move to next business day
    if (isWeekend(finalObservation) || isMarketHoliday(finalObservation, ['US', 'EU', 'GB'])) {
      finalObservation = getNextTradingDay(finalObservation, ['US', 'EU', 'GB']);
    }
    
    // Calculate Maturity Date - final observation + finalToMaturityDelay calendar days
    let maturity = addCalendarDays(finalObservation, finalToMaturityDelay);
    
    // If maturity falls on weekend/holiday, move to next business day
    if (isWeekend(maturity) || isMarketHoliday(maturity, ['US', 'EU', 'GB'])) {
      maturity = getNextTradingDay(maturity, ['US', 'EU', 'GB']);
    }
    
    console.log('📅 Date Calculation Results:', {
      tradeDate: formatDateForInput(tradeDate),
      valueDate: formatDateForInput(valueDate),
      finalObservation: formatDateForInput(finalObservation),
      maturity: formatDateForInput(maturity),
      productDuration,
      initialToPaymentDelay,
      finalToMaturityDelay
    });
    
    // Update all calculated dates
    onUpdateProductDetails('valueDate', formatDateForInput(valueDate));
    onUpdateProductDetails('finalObservation', formatDateForInput(finalObservation));
    onUpdateProductDetails('maturity', formatDateForInput(maturity));
  };

  const renderField = (field, label, type = 'text', tabIndex = 0) => {
    const value = productDetails[field];
    const isEditing = editingField === field;

    // Currency dropdown options
    const currencyOptions = [
      { value: 'USD', label: 'USD - US Dollar' },
      { value: 'EUR', label: 'EUR - Euro' },
      { value: 'GBP', label: 'GBP - British Pound' },
      { value: 'JPY', label: 'JPY - Japanese Yen' },
      { value: 'CHF', label: 'CHF - Swiss Franc' },
      { value: 'CAD', label: 'CAD - Canadian Dollar' },
      { value: 'AUD', label: 'AUD - Australian Dollar' },
      { value: 'HKD', label: 'HKD - Hong Kong Dollar' },
      { value: 'SGD', label: 'SGD - Singapore Dollar' },
      { value: 'NOK', label: 'NOK - Norwegian Krone' },
      { value: 'SEK', label: 'SEK - Swedish Krona' },
      { value: 'DKK', label: 'DKK - Danish Krone' },
    ];

    // Get ISIN validation status for display
    const showIsinValidation = field === 'isin' && value && value.trim();
    const hasIsinError = showIsinValidation && (!isinValidation.valid || !isinUniqueness.isUnique);

    return (
      <div className="product-field">
        <label className="field-label">{label}:</label>
        {field === 'currency' ? (
          <select
            value={value}
            onChange={(e) => onUpdateProductDetails && onUpdateProductDetails(field, e.target.value)}
            className="field-select"
            tabIndex={tabIndex}
          >
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field === 'issuer' ? (
          <select
            value={value}
            onChange={(e) => onUpdateProductDetails && onUpdateProductDetails(field, e.target.value)}
            className="field-select"
            tabIndex={tabIndex}
          >
            <option value="">Select Issuer</option>
            {issuers.map((issuer) => (
              <option key={issuer._id} value={issuer.name}>
                {issuer.name}
              </option>
            ))}
          </select>
        ) : ['tradeDate', 'valueDate', 'finalObservation', 'maturity'].includes(field) ? (
          // Always show date inputs for date fields, even when empty
          <CustomDateInput
            value={value || ''}
            onChange={(e) => handleDateChange(field, e.target.value)}
            className="field-input"
            title={`Set ${label.toLowerCase()}`}
          />
        ) : isEditing ? (
          <input
            type={type}
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            onBlur={() => handleSave(field)}
            onKeyDown={(e) => handleKeyPress(e, field)}
            className="field-input"
            placeholder={field === 'isin' ? 'e.g., US1234567890' : ''}
            maxLength={field === 'isin' ? 12 : undefined}
            tabIndex={tabIndex}
            autoFocus
          />
        ) : (
          <span
            className="field-value"
            onClick={() => handleEdit(field, value)}
            tabIndex={tabIndex}
            role="button"
            aria-label={`Edit ${label}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleEdit(field, value);
              }
            }}
            style={hasIsinError ? { color: '#ef4444', fontWeight: '500' } : {}}
          >
            {value || 'Click to edit'}
          </span>
        )}

        {/* ISIN validation feedback */}
        {showIsinValidation && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
            {isCheckingIsin && (
              <div style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
                Checking ISIN...
              </div>
            )}

            {!isCheckingIsin && !isinValidation.valid && (
              <div style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>❌</span>
                <span>{isinValidation.error}</span>
              </div>
            )}

            {!isCheckingIsin && isinValidation.valid && !isinUniqueness.isUnique && (
              <div style={{ color: '#ef4444' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span>⚠️</span>
                  <span style={{ fontWeight: '500' }}>ISIN already exists in database</span>
                </div>
                {isinUniqueness.conflict && (
                  <div style={{ marginLeft: '1.75rem', color: '#6b7280', fontSize: '0.8rem' }}>
                    Product: <strong style={{ color: '#ef4444' }}>{isinUniqueness.conflict.title}</strong>
                    {isinUniqueness.conflict.createdAt && (
                      <> (created {new Date(isinUniqueness.conflict.createdAt).toLocaleDateString()})</>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isCheckingIsin && isinValidation.valid && isinUniqueness.isUnique && (
              <div style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>✅</span>
                <span>Valid ISIN</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="product-details-card">
      <h3 className="card-title">Product Details</h3>
      <div className="product-sections">
        {/* Product Identification */}
        <div className="product-section">
          <h4 className="section-title">Product Identification</h4>
          <div className="section-fields">
            {renderField('isin', 'ISIN', 'text', 11)}
            {renderField('issuer', 'Issuer', 'text', 12)}
          </div>
        </div>

        {/* Dates */}
        <div className="product-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h4 className="section-title">Important Dates</h4>
            <button
              onClick={() => setShowDateHelper(!showDateHelper)}
              style={{
                padding: '4px 8px',
                fontSize: '0.8rem',
                background: showDateHelper ? 'var(--accent-color)' : 'var(--bg-secondary)',
                color: showDateHelper ? 'white' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              title="Auto-calculate dates based on duration and delays"
            >
              🧮 Date Helper
            </button>
          </div>
          
          {showDateHelper && (
            <div style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '1rem'
            }}>
              <h5 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                📅 Auto-Calculate Dates
              </h5>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Product Duration
                  </label>
                  <input
                    type="text"
                    value={productDuration}
                    onChange={(e) => {
                      const newValue = e.target.value.toUpperCase();
                      console.log('📅 Duration changed:', newValue);
                      setProductDuration(newValue);
                    }}
                    placeholder="e.g., 6M, 2Y, 3Y"
                    style={{
                      width: '100%',
                      padding: '6px',
                      fontSize: '0.8rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Initial → Payment Delay
                  </label>
                  <input
                    type="text"
                    value={initialToPaymentDelay}
                    onChange={(e) => setInitialToPaymentDelay(parseInt(e.target.value) || 0)}
                    style={{
                      width: '100%',
                      padding: '6px',
                      fontSize: '0.8rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)'
                    }}
                  />
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>calendar days</small>
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Final → Maturity Delay
                  </label>
                  <input
                    type="text"
                    value={finalToMaturityDelay}
                    onChange={(e) => setFinalToMaturityDelay(parseInt(e.target.value) || 0)}
                    style={{
                      width: '100%',
                      padding: '6px',
                      fontSize: '0.8rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)'
                    }}
                  />
                  <small style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>calendar days</small>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                <span>💡</span>
                <span>Value Date = Trade Date + Initial Delay, Final Observation = Trade Date + Duration, Maturity = Final Observation + Final Delay (all adjusted for weekends/holidays)</span>
              </div>
              
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  onClick={calculateDates}
                  disabled={!productDetails.tradeDate || !productDuration || !productDuration.trim()}
                  style={{
                    padding: '8px 16px',
                    fontSize: '0.8rem',
                    background: (!productDetails.tradeDate || !productDuration || !productDuration.trim()) ? '#6b7280' : '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: (!productDetails.tradeDate || !productDuration || !productDuration.trim()) ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    opacity: (!productDetails.tradeDate || !productDuration || !productDuration.trim()) ? 0.6 : 1,
                    transform: (!productDetails.tradeDate || !productDuration || !productDuration.trim()) ? 'none' : 'scale(1)',
                    boxShadow: (!productDetails.tradeDate || !productDuration || !productDuration.trim()) ? 'none' : '0 2px 4px rgba(16, 185, 129, 0.3)'
                  }}
                  title={(!productDetails.tradeDate || !productDuration || !productDuration.trim()) ? 
                    'Please set Trade Date and Product Duration first' : 
                    'Calculate all dates automatically based on Trade Date and Duration'
                  }
                  onMouseEnter={(e) => {
                    if (!e.target.disabled) {
                      e.target.style.transform = 'scale(1.05)';
                      e.target.style.boxShadow = '0 4px 8px rgba(16, 185, 129, 0.4)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!e.target.disabled) {
                      e.target.style.transform = 'scale(1)';
                      e.target.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.3)';
                    }
                  }}
                >
                  🔄 Calculate Dates
                </button>
              </div>
            </div>
          )}
          
          <div className="section-fields">
            {renderField('tradeDate', 'Trade Date', 'text', 13)}
            {renderField('valueDate', 'Value Date', 'text', 14)}
            {renderField('finalObservation', 'Final Observation', 'text', 15)}
            {renderField('maturity', 'Maturity', 'text', 16)}
          </div>
        </div>

        {/* Financial Terms */}
        <div className="product-section">
          <h4 className="section-title">Financial Terms</h4>
          <div className="section-fields">
            {renderField('currency', 'Currency', 'text', 17)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailsCard;