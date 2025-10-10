import React from 'react';

/**
 * LoadingSpinner - Reusable loading spinner component
 * 
 * @param {Object} props
 * @param {string} props.size - Size variant: 'small', 'medium', 'large'
 * @param {string} props.color - Color override (defaults to accent color)
 * @param {string} props.text - Optional loading text
 * @param {boolean} props.center - Whether to center the spinner
 * @param {Object} props.style - Additional styles
 */
const LoadingSpinner = ({ 
  size = 'medium', 
  color = 'var(--accent-color)', 
  text = '', 
  center = false,
  style = {}
}) => {
  const sizeMap = {
    small: '16px',
    medium: '24px',
    large: '32px'
  };

  const spinnerSize = sizeMap[size] || sizeMap.medium;

  const containerStyle = {
    display: center ? 'flex' : 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: text ? '0.5rem' : 0,
    justifyContent: center ? 'center' : 'flex-start',
    ...(center && { width: '100%', height: '100%' }),
    ...style
  };

  const spinnerStyle = {
    width: spinnerSize,
    height: spinnerSize,
    border: `2px solid var(--border-color)`,
    borderTop: `2px solid ${color}`,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  };

  return (
    <div style={containerStyle}>
      <div style={spinnerStyle} />
      {text && (
        <span style={{
          fontSize: size === 'small' ? '0.8rem' : '0.9rem',
          color: 'var(--text-secondary)',
          fontWeight: '500'
        }}>
          {text}
        </span>
      )}
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default LoadingSpinner;