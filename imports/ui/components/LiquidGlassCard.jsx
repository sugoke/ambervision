import React from 'react';

/**
 * LiquidGlassCard Component
 *
 * A reusable card component that applies a liquid glass effect with:
 * - Blurred backdrop with distortion
 * - Semi-transparent white tint
 * - Glossy shine on edges
 * - Smooth hover animations
 *
 * Based on the original liquid glass effect from:
 * https://codepen.io/lassiterda/pen/vEOpqMa
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
  borderRadius = '10px',
  ...props
}) => {
  return (
    <div
      className={`liquidGlass-wrapper ${className}`}
      style={{
        position: 'relative',
        display: 'flex',
        fontWeight: '600',
        overflow: 'hidden',
        boxShadow: '0 6px 6px rgba(0, 0, 0, 0.2), 0 0 20px rgba(0, 0, 0, 0.1)',
        transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 2.2)',
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
      {/* Layer 0: Glass distortion effect with blur */}
      <div
        className="liquidGlass-effect"
        style={{
          position: 'absolute',
          zIndex: 0,
          inset: 0,
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
          filter: 'url(#glass-distortion)',
          overflow: 'hidden',
          borderRadius: borderRadius
        }}
      />

      {/* Layer 1: Semi-transparent white tint */}
      <div
        className="liquidGlass-tint"
        style={{
          zIndex: 1,
          position: 'absolute',
          inset: 0,
          background: 'rgba(255, 255, 255, 0.10)',
          borderRadius: borderRadius
        }}
      />

      {/* Layer 2: Glossy shine effect */}
      <div
        className="liquidGlass-shine"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          overflow: 'hidden',
          boxShadow: 'inset 2px 2px 1px 0 rgba(255, 255, 255, 0.3), inset -1px -1px 1px 1px rgba(255, 255, 255, 0.3)',
          borderRadius: borderRadius,
          pointerEvents: 'none'
        }}
      />

      {/* Layer 3: Content */}
      <div
        className="liquidGlass-text"
        style={{
          zIndex: 3,
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
