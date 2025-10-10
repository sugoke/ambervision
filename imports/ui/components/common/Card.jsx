import React from 'react';

/**
 * Card - Reusable card component with consistent styling
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.children - Card content
 * @param {string} props.title - Optional card title
 * @param {React.ReactNode} props.header - Custom header content
 * @param {React.ReactNode} props.footer - Optional footer content
 * @param {boolean} props.hoverable - Enable hover effects
 * @param {string} props.variant - Card style: 'default', 'elevated', 'bordered'
 * @param {Object} props.style - Additional styles
 * @param {string} props.className - Additional CSS classes
 */
const Card = ({
  children,
  title,
  header,
  footer,
  hoverable = false,
  variant = 'default',
  style = {},
  className = '',
  ...props
}) => {
  const variants = {
    default: {
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      boxShadow: 'none'
    },
    elevated: {
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      boxShadow: '0 2px 8px var(--shadow)'
    },
    bordered: {
      background: 'var(--bg-primary)',
      border: '2px solid var(--border-color)',
      boxShadow: 'none'
    }
  };

  const cardStyle = {
    borderRadius: '12px',
    padding: '1.5rem',
    transition: hoverable ? 'all 0.2s ease' : 'none',
    ...variants[variant],
    ...style
  };

  const headerStyle = {
    marginBottom: '1rem',
    paddingBottom: title && !header ? '0.75rem' : 0,
    borderBottom: title && !header ? '1px solid var(--border-color)' : 'none'
  };

  const footerStyle = {
    marginTop: '1rem',
    paddingTop: '0.75rem',
    borderTop: '1px solid var(--border-color)'
  };

  return (
    <div
      style={cardStyle}
      className={className}
      onMouseEnter={hoverable ? (e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 16px var(--shadow)';
      } : undefined}
      onMouseLeave={hoverable ? (e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = variants[variant].boxShadow;
      } : undefined}
      {...props}
    >
      {(title || header) && (
        <div style={headerStyle}>
          {header || (
            <h3 style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              {title}
            </h3>
          )}
        </div>
      )}
      
      <div>
        {children}
      </div>
      
      {footer && (
        <div style={footerStyle}>
          {footer}
        </div>
      )}
    </div>
  );
};

export default Card;