/**
 * Centralized styling constants and theme system
 * This file contains reusable style objects and theme definitions
 * to ensure consistency across the application
 */

// Color palette - referenced from CSS variables but can be used in JS
export const colors = {
  // Primary colors
  primary: 'var(--text-primary)',
  secondary: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
  accent: 'var(--accent-color)',
  
  // Status colors
  success: 'var(--success-color)',
  warning: 'var(--warning-color)',
  danger: 'var(--danger-color)',
  info: 'var(--info-color)',
  
  // Background colors
  bgPrimary: 'var(--bg-primary)',
  bgSecondary: 'var(--bg-secondary)',
  bgTertiary: 'var(--bg-tertiary)',
  
  // Utility colors
  border: 'var(--border-color)',
  shadow: 'var(--shadow)'
};

// Typography scale
export const typography = {
  fontSize: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem'  // 36px
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800'
  },
  lineHeight: {
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.75'
  },
  letterSpacing: {
    tight: '-0.025em',
    normal: '0',
    wide: '0.025em',
    wider: '0.05em',
    widest: '0.1em'
  }
};

// Spacing scale (based on 4px grid)
export const spacing = {
  px: '1px',
  0: '0',
  1: '0.25rem',  // 4px
  2: '0.5rem',   // 8px
  3: '0.75rem',  // 12px
  4: '1rem',     // 16px
  5: '1.25rem',  // 20px
  6: '1.5rem',   // 24px
  8: '2rem',     // 32px
  10: '2.5rem',  // 40px
  12: '3rem',    // 48px
  16: '4rem',    // 64px
  20: '5rem',    // 80px
  24: '6rem'     // 96px
};

// Border radius scale
export const borderRadius = {
  none: '0',
  sm: '0.125rem',   // 2px
  default: '0.25rem', // 4px
  md: '0.375rem',   // 6px
  lg: '0.5rem',     // 8px
  xl: '0.75rem',    // 12px
  '2xl': '1rem',    // 16px
  full: '9999px'
};

// Shadow definitions
export const shadows = {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  default: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)'
};

// Animation and transitions
export const animations = {
  transition: {
    fast: 'all 0.15s ease',
    default: 'all 0.2s ease',
    slow: 'all 0.3s ease'
  },
  duration: {
    fast: '150ms',
    default: '200ms',
    slow: '300ms'
  },
  easing: {
    linear: 'linear',
    ease: 'ease',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out'
  }
};

// Common component styles
export const commonStyles = {
  // Button styles
  button: {
    base: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: typography.fontWeight.semibold,
      textDecoration: 'none',
      outline: 'none',
      cursor: 'pointer',
      userSelect: 'none',
      transition: animations.transition.default,
      border: 'none'
    },
    sizes: {
      sm: {
        padding: `${spacing[2]} ${spacing[3]}`,
        fontSize: typography.fontSize.sm,
        borderRadius: borderRadius.default
      },
      md: {
        padding: `${spacing[2]} ${spacing[4]}`,
        fontSize: typography.fontSize.base,
        borderRadius: borderRadius.md
      },
      lg: {
        padding: `${spacing[3]} ${spacing[6]}`,
        fontSize: typography.fontSize.lg,
        borderRadius: borderRadius.lg
      }
    }
  },

  // Input styles
  input: {
    base: {
      display: 'block',
      width: '100%',
      border: `2px solid ${colors.border}`,
      background: colors.bgPrimary,
      color: colors.primary,
      outline: 'none',
      transition: animations.transition.default,
      fontFamily: 'inherit'
    },
    sizes: {
      sm: {
        padding: `${spacing[2]} ${spacing[3]}`,
        fontSize: typography.fontSize.sm,
        borderRadius: borderRadius.default
      },
      md: {
        padding: `${spacing[3]} ${spacing[4]}`,
        fontSize: typography.fontSize.base,
        borderRadius: borderRadius.md
      },
      lg: {
        padding: `${spacing[4]} ${spacing[5]}`,
        fontSize: typography.fontSize.lg,
        borderRadius: borderRadius.lg
      }
    },
    states: {
      focus: {
        borderColor: colors.accent,
        boxShadow: `0 0 0 3px ${colors.accent}20`
      },
      error: {
        borderColor: colors.danger
      }
    }
  },

  // Card styles
  card: {
    base: {
      background: colors.bgSecondary,
      border: `1px solid ${colors.border}`,
      borderRadius: borderRadius.xl,
      padding: spacing[6],
      transition: animations.transition.default
    },
    variants: {
      elevated: {
        boxShadow: shadows.md
      },
      bordered: {
        border: `2px solid ${colors.border}`
      }
    },
    hover: {
      transform: 'translateY(-2px)',
      boxShadow: shadows.lg
    }
  },

  // Modal styles
  modal: {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      zIndex: 1000,
      padding: spacing[4]
    },
    content: {
      background: colors.bgPrimary,
      borderRadius: borderRadius.xl,
      boxShadow: shadows.xl,
      border: `1px solid ${colors.border}`,
      width: '100%',
      position: 'relative'
    }
  },

  // Table styles
  table: {
    container: {
      overflowX: 'auto'
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      background: colors.bgPrimary,
      borderRadius: borderRadius.xl,
      overflow: 'hidden',
      border: `1px solid ${colors.border}`
    },
    header: {
      background: colors.bgTertiary,
      borderBottom: `1px solid ${colors.border}`
    },
    headerCell: {
      padding: `${spacing[3]} ${spacing[4]}`,
      textAlign: 'left',
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.semibold,
      color: colors.secondary,
      textTransform: 'uppercase',
      letterSpacing: typography.letterSpacing.wide
    },
    bodyCell: {
      padding: `${spacing[3]} ${spacing[4]}`,
      fontSize: typography.fontSize.sm,
      color: colors.primary,
      borderBottom: `1px solid ${colors.border}`
    }
  },

  // Loading spinner
  spinner: {
    container: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    spinner: {
      border: `2px solid ${colors.border}`,
      borderTop: `2px solid ${colors.accent}`,
      borderRadius: borderRadius.full,
      animation: 'spin 1s linear infinite'
    }
  }
};

// Layout helpers
export const layout = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: `0 ${spacing[6]}`
  },
  flexCenter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  flexBetween: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  grid: {
    auto: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: spacing[6]
    },
    responsive: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: spacing[6]
    }
  }
};

// Utility functions for creating styles
export const createButtonStyle = (variant = 'primary', size = 'md') => ({
  ...commonStyles.button.base,
  ...commonStyles.button.sizes[size],
  ...(variant === 'primary' && {
    background: colors.accent,
    color: 'white'
  }),
  ...(variant === 'secondary' && {
    background: 'transparent',
    color: colors.primary,
    border: `1px solid ${colors.border}`
  }),
  ...(variant === 'danger' && {
    background: colors.danger,
    color: 'white'
  })
});

export const createInputStyle = (size = 'md', hasError = false) => ({
  ...commonStyles.input.base,
  ...commonStyles.input.sizes[size],
  ...(hasError && commonStyles.input.states.error)
});

export const createCardStyle = (variant = 'default', hoverable = false) => ({
  ...commonStyles.card.base,
  ...commonStyles.card.variants[variant],
  ...(hoverable && {
    cursor: 'pointer',
    ':hover': commonStyles.card.hover
  })
});