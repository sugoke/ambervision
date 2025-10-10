import React from 'react';
import LoadingSpinner from './LoadingSpinner.jsx';

/**
 * ActionButton - Standardized button component with loading states and variants
 * 
 * @param {Object} props
 * @param {string} props.variant - Button style: 'primary', 'secondary', 'danger', 'success'
 * @param {string} props.size - Button size: 'small', 'medium', 'large'
 * @param {boolean} props.loading - Show loading spinner
 * @param {boolean} props.disabled - Disable button
 * @param {React.ReactNode} props.children - Button content
 * @param {React.ReactNode} props.icon - Optional icon
 * @param {Function} props.onClick - Click handler
 * @param {string} props.type - Button type (button, submit, reset)
 * @param {Object} props.style - Additional styles
 */
const ActionButton = ({
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled = false,
  children,
  icon,
  onClick,
  type = 'button',
  style = {},
  ...props
}) => {
  const variants = {
    primary: {
      background: 'var(--accent-color)',
      color: 'white',
      border: 'none'
    },
    secondary: {
      background: 'transparent',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-color)'
    },
    danger: {
      background: 'var(--danger-color)',
      color: 'white',
      border: 'none'
    },
    success: {
      background: 'var(--success-color)',
      color: 'white',
      border: 'none'
    }
  };

  const sizes = {
    small: {
      padding: '6px 12px',
      fontSize: '0.8rem',
      borderRadius: '4px'
    },
    medium: {
      padding: '8px 16px',
      fontSize: '0.9rem',
      borderRadius: '6px'
    },
    large: {
      padding: '12px 24px',
      fontSize: '1rem',
      borderRadius: '8px'
    }
  };

  const isDisabled = disabled || loading;

  const buttonStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: icon || loading ? '0.5rem' : 0,
    fontWeight: '600',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.6 : 1,
    transition: 'all 0.2s ease',
    outline: 'none',
    textDecoration: 'none',
    userSelect: 'none',
    ...variants[variant],
    ...sizes[size],
    ...style
  };

  return (
    <button
      type={type}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      style={buttonStyle}
      onMouseEnter={(e) => {
        if (!isDisabled && variant !== 'secondary') {
          e.currentTarget.style.opacity = '0.9';
          e.currentTarget.style.transform = 'translateY(-1px)';
        } else if (!isDisabled && variant === 'secondary') {
          e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isDisabled) {
          e.currentTarget.style.opacity = '1';
          e.currentTarget.style.transform = 'translateY(0)';
          if (variant === 'secondary') {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }
      }}
      {...props}
    >
      {loading ? (
        <LoadingSpinner size="small" color="currentColor" />
      ) : icon && (
        <span>{icon}</span>
      )}
      {children}
    </button>
  );
};

export default ActionButton;