import React, { useState, useEffect, useRef } from 'react';

const CustomDateInput = ({ value, onChange, className = '', style = {}, placeholder = 'DD/MM/YYYY', ...props }) => {
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const lastExternalValue = useRef(value);
  const typingTimeoutRef = useRef(null);

  // Convert ISO date (YYYY-MM-DD) to display format (DD/MM/YYYY)
  const formatDateForDisplay = (isoDate) => {
    if (!isoDate) return '';
    try {
      const [year, month, day] = isoDate.split('-');
      return `${day}/${month}/${year}`;
    } catch {
      return '';
    }
  };

  // Convert DDMMYYYY to ISO format (YYYY-MM-DD)
  const parseInputToISO = (input) => {
    const digitsOnly = input.replace(/\D/g, '');
    
    if (digitsOnly.length === 8) {
      const day = digitsOnly.substring(0, 2);
      const month = digitsOnly.substring(2, 4);
      const year = digitsOnly.substring(4, 8);
      
      // Validate the date
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() == year && date.getMonth() == month - 1 && date.getDate() == day) {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }
    
    return null;
  };

  // Auto-format the input as user types
  const formatInput = (input) => {
    const digitsOnly = input.replace(/\D/g, '').substring(0, 8);
    
    if (digitsOnly.length <= 2) {
      return digitsOnly;
    } else if (digitsOnly.length <= 4) {
      return `${digitsOnly.substring(0, 2)}/${digitsOnly.substring(2)}`;
    } else {
      return `${digitsOnly.substring(0, 2)}/${digitsOnly.substring(2, 4)}/${digitsOnly.substring(4)}`;
    }
  };

  // Initialize input value on mount
  useEffect(() => {
    if (value && !inputValue) {
      setInputValue(formatDateForDisplay(value));
      lastExternalValue.current = value;
    }
  }, []);

  // Only update from prop when external value actually changes and user is not typing
  useEffect(() => {
    if (value !== lastExternalValue.current && !isTyping) {
      setInputValue(formatDateForDisplay(value));
      lastExternalValue.current = value;
    }
  }, [value]); // Remove isTyping dependency to prevent interference

  const stopTyping = () => {
    setIsTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  const handleChange = (e) => {
    // Start typing mode
    setIsTyping(true);
    
    // Clear any existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    const newValue = e.target.value;
    const formatted = formatInput(newValue);
    setInputValue(formatted);
    
    // Auto-stop typing after 2 seconds of no input
    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 2000);
  };

  const handleBlur = () => {
    setIsTyping(false);
    
    const digitsOnly = inputValue.replace(/\D/g, '');
    
    if (digitsOnly.length === 8) {
      // Complete date - validate and update parent
      const isoDate = parseInputToISO(inputValue);
      if (isoDate && onChange) {
        lastExternalValue.current = isoDate; // Prevent loop
        onChange({ target: { value: isoDate } });
        // Update display to properly formatted version
        setInputValue(formatDateForDisplay(isoDate));
      } else {
        // Invalid date - keep what user typed for them to fix
        console.warn('Invalid date entered:', inputValue);
      }
    } else if (digitsOnly.length === 0) {
      // Empty field
      if (onChange) {
        lastExternalValue.current = ''; // Prevent loop
        onChange({ target: { value: '' } });
      }
    }
    // For partial dates (1-7 digits), don't clear - just keep what user typed
    // The user can continue typing to complete the date
  };

  const handleFocus = () => {
    setIsTyping(true);
  };

  const handleKeyDown = (e) => {
    // Allow navigation and editing keys
    const allowedKeys = [8, 9, 27, 13, 46, 37, 38, 39, 40];
    
    if (allowedKeys.includes(e.keyCode) || 
        (e.ctrlKey && [65, 67, 86, 88].includes(e.keyCode))) {
      return;
    }
    
    // On Enter, stop typing and blur
    if (e.keyCode === 13) {
      e.target.blur();
      return;
    }
    
    // Only allow numbers
    if ((e.keyCode < 48 || e.keyCode > 57) && (e.keyCode < 96 || e.keyCode > 105)) {
      e.preventDefault();
      return;
    }

    // Limit to 8 digits
    const digitsOnly = inputValue.replace(/\D/g, '');
    if (digitsOnly.length >= 8) {
      e.preventDefault();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    setIsTyping(true);
    
    const paste = (e.clipboardData || window.clipboardData).getData('text');
    const formatted = formatInput(paste);
    setInputValue(formatted);
    
    // Auto-stop typing after paste
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 1000);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Handle date picker change
  const handleDatePickerChange = (e) => {
    const isoDate = e.target.value;
    if (isoDate) {
      setInputValue(formatDateForDisplay(isoDate));
      lastExternalValue.current = isoDate;
      if (onChange) {
        onChange({ target: { value: isoDate } });
      }
    }
  };

  // Show date picker
  const showDatePicker = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (datePickerRef.current) {
      try {
        // Try modern showPicker API first
        if (datePickerRef.current.showPicker && typeof datePickerRef.current.showPicker === 'function') {
          datePickerRef.current.showPicker();
        } else {
          // Fallback: temporarily make the date input visible and trigger it
          const dateInput = datePickerRef.current;
          const originalStyle = dateInput.style.cssText;
          
          // Make it temporarily interactable
          dateInput.style.cssText = 'position: absolute; opacity: 0.01; pointer-events: auto; width: 100%; height: 100%; top: 0; left: 0; z-index: 1000;';
          dateInput.focus();
          dateInput.click();
          
          // Restore original style after a short delay
          setTimeout(() => {
            dateInput.style.cssText = originalStyle;
          }, 100);
        }
      } catch (error) {
        console.warn('Could not open date picker:', error);
      }
    }
  };

  const datePickerRef = useRef(null);

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        type="text"
        className={`date-input ${className}`}
        value={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        style={{
          width: '100%',
          paddingRight: '35px'
        }}
        {...props}
      />
      
      {/* Hidden date picker */}
      <input
        ref={datePickerRef}
        type="date"
        value={lastExternalValue.current || ''}
        onChange={handleDatePickerChange}
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          width: '100%',
          height: '100%',
          top: 0,
          left: 0,
          zIndex: -1
        }}
        tabIndex={-1}
      />
      
      {/* Clickable calendar icon */}
      <div
        onClick={showDatePicker}
        style={{
          position: 'absolute',
          right: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: '14px',
          padding: '2px',
          borderRadius: '2px',
          transition: 'background-color 0.2s ease'
        }}
        onMouseEnter={(e) => {
          e.target.style.backgroundColor = 'var(--bg-secondary, #f0f0f0)';
        }}
        onMouseLeave={(e) => {
          e.target.style.backgroundColor = 'transparent';
        }}
        title="Open date picker"
      >
        📅
      </div>
    </div>
  );
};

export default CustomDateInput;