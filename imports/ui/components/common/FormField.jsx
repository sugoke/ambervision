import React from 'react';

/**
 * FormField - Standardized form field component with validation and error handling
 * 
 * @param {Object} props
 * @param {string} props.label - Field label
 * @param {string} props.type - Input type (text, email, password, number, etc.)
 * @param {string} props.value - Input value
 * @param {Function} props.onChange - Change handler
 * @param {string} props.placeholder - Input placeholder
 * @param {boolean} props.required - Whether field is required
 * @param {boolean} props.disabled - Whether field is disabled
 * @param {string|string[]} props.error - Error message(s)
 * @param {string} props.help - Help text
 * @param {string} props.size - Field size: 'small', 'medium', 'large'
 * @param {React.ReactNode} props.prefix - Prefix icon or text
 * @param {React.ReactNode} props.suffix - Suffix icon or text
 * @param {Object} props.style - Additional styles
 * @param {Object} props.inputProps - Additional input props
 */
const FormField = ({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  error,
  help,
  size = 'medium',
  prefix,
  suffix,
  style = {},
  inputProps = {},
  ...props
}) => {
  const hasError = error && (Array.isArray(error) ? error.length > 0 : error);
  
  const sizes = {
    small: {
      padding: '8px 12px',
      fontSize: '0.8rem',
      borderRadius: '4px'
    },
    medium: {
      padding: '12px 16px',
      fontSize: '0.9rem',
      borderRadius: '6px'
    },
    large: {
      padding: '16px 20px',
      fontSize: '1rem',
      borderRadius: '8px'
    }
  };

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    ...style
  };

  const labelStyle = {
    fontSize: '0.9rem',
    fontWeight: '600',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem'
  };

  const inputContainerStyle = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center'
  };

  const inputStyle = {
    width: '100%',
    border: `2px solid ${hasError ? 'var(--danger-color)' : 'var(--border-color)'}`,
    background: disabled ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
    color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
    outline: 'none',
    transition: 'all 0.2s ease',
    fontFamily: 'inherit',
    paddingLeft: prefix ? '2.5rem' : sizes[size].padding.split(' ')[1],
    paddingRight: suffix ? '2.5rem' : sizes[size].padding.split(' ')[1],
    paddingTop: sizes[size].padding.split(' ')[0],
    paddingBottom: sizes[size].padding.split(' ')[0],
    fontSize: sizes[size].fontSize,
    borderRadius: sizes[size].borderRadius
  };

  const affixStyle = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    color: 'var(--text-secondary)',
    fontSize: sizes[size].fontSize,
    pointerEvents: 'none',
    zIndex: 1
  };

  const prefixStyle = {
    ...affixStyle,
    left: '12px'
  };

  const suffixStyle = {
    ...affixStyle,
    right: '12px'
  };

  const errorStyle = {
    fontSize: '0.8rem',
    color: 'var(--danger-color)',
    fontWeight: '500'
  };

  const helpStyle = {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)'
  };

  const renderErrors = () => {
    if (!hasError) return null;
    
    if (Array.isArray(error)) {
      return error.map((err, index) => (
        <div key={index} style={errorStyle}>{err}</div>
      ));
    }
    
    return <div style={errorStyle}>{error}</div>;
  };

  return (
    <div style={containerStyle}>
      {label && (
        <label style={labelStyle}>
          {label}
          {required && <span style={{ color: 'var(--danger-color)' }}>*</span>}
        </label>
      )}
      
      <div style={inputContainerStyle}>
        {prefix && <div style={prefixStyle}>{prefix}</div>}
        
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          style={inputStyle}
          onFocus={(e) => {
            if (!hasError) {
              e.target.style.borderColor = 'var(--accent-color)';
              e.target.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.1)';
            }
          }}
          onBlur={(e) => {
            e.target.style.borderColor = hasError ? 'var(--danger-color)' : 'var(--border-color)';
            e.target.style.boxShadow = 'none';
          }}
          {...inputProps}
          {...props}
        />
        
        {suffix && <div style={suffixStyle}>{suffix}</div>}
      </div>
      
      {renderErrors()}
      
      {help && !hasError && (
        <div style={helpStyle}>{help}</div>
      )}
    </div>
  );
};

export default FormField;