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
 * @param {boolean} props.fullWidth - Span the container and centre the label (touch targets)
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
  fullWidth = false,
  style = {},
  ...props
}) => {
  // Filled variants use --accent-contrast for their label: the dark theme's fills are
  // light-mid ledger tones (ink text reads best), the light theme's fills are deep
  // tones (white reads best) — and that is exactly the mapping the token carries.
  const variants = {
    primary: {
      background: 'var(--accent-color)',
      color: 'var(--accent-contrast, #fff)',
      border: '1px solid var(--accent-color)'
    },
    secondary: {
      background: 'var(--bg-secondary)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-color)'
    },
    danger: {
      background: 'var(--danger-color)',
      color: 'var(--accent-contrast, #fff)',
      border: '1px solid var(--danger-color)'
    },
    success: {
      background: 'var(--success-color)',
      color: 'var(--accent-contrast, #fff)',
      border: '1px solid var(--success-color)'
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
      borderRadius: '8px',
      // Guarantees the ~44px touch minimum regardless of variant: bordered variants
      // gain 2px from their border, borderless ones would otherwise fall just short.
      minHeight: '44px'
    }
  };

  const isDisabled = disabled || loading;

  const buttonStyle = {
    display: fullWidth ? 'flex' : 'inline-flex',
    alignItems: 'center',
    // Only centre when we control the width — callers that size buttons themselves
    // keep the previous default alignment.
    ...(fullWidth ? { justifyContent: 'center' } : {}),
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
    ...(fullWidth ? { width: '100%' } : {}),
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
          // Proposal hover: the hairline and label warm to amber.
          e.currentTarget.style.borderColor = 'var(--accent-color)';
          e.currentTarget.style.color = 'var(--accent-color)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isDisabled) {
          e.currentTarget.style.opacity = '1';
          e.currentTarget.style.transform = 'translateY(0)';
          if (variant === 'secondary') {
            e.currentTarget.style.borderColor = 'var(--border-color)';
            e.currentTarget.style.color = 'var(--text-primary)';
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