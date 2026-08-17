import React from 'react';

/**
 * LiquidGlassCard — the app's primary card surface.
 *
 * Historically a "liquid glass" effect (backdrop blur + SVG distortion + white
 * tint). Rebuilt for the Ambervision design system: a calm panel with a hairline
 * border — dark theme gets the ink→panel gradient, light theme a white card with
 * a soft paper shadow. Both come from theme tokens (--card-bg / --card-shadow),
 * so this one component restyles every screen that wraps itself in it.
 *
 * The name and prop API are kept so the 13 consuming screens need no changes.
 */
const LiquidGlassCard = ({
  children,
  style = {},
  className = '',
  onClick,
  onMouseEnter,
  onMouseLeave,
  onTouchStart,
  onTouchEnd,
  borderRadius = 'var(--radius, 14px)',
  ...props
}) => {
  return (
    <div
      className={`liquidGlass-wrapper ${className}`}
      style={{
        position: 'relative',
        display: 'flex',
        overflow: 'hidden',
        background: 'var(--card-bg, var(--bg-secondary))',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--card-shadow, 0 1px 2px rgba(0,0,0,0.2))',
        transition: 'border-color 0.16s ease, box-shadow 0.16s ease',
        borderRadius: borderRadius,
        ...style
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      {...props}
    >
      <div
        className="liquidGlass-text"
        style={{
          zIndex: 1,
          width: '100%',
          borderRadius: borderRadius
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default LiquidGlassCard;
