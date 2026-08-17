import React from 'react';

/**
 * ScheduleCardsMobile — phone rendering for report schedule/observation tables.
 *
 * The desktop grid tables in the template reports need ≥750px; on a phone they
 * force horizontal scrolling and clip. Each template maps its rows into this
 * generic card shape instead (same philosophy as the PMS mobile cards:
 * 12px label floor, one card per row, no horizontal scroll).
 *
 * Row shape:
 * {
 *   key:      string | number
 *   title:    node          — headline (usually the observation date)
 *   subtitle: node          — optional secondary line (e.g. payment date)
 *   badge:    { text, background, color }   — optional status chip
 *   accent:   'success' | 'info' | 'warning' | null — left border + wash
 *   muted:    bool          — future/inactive row styling
 *   fields:   [{ label, value }] — label/value pairs, laid out 2-up
 * }
 */

const ACCENTS = {
  success: 'var(--gain-color)',
  info: 'var(--info-color)',
  warning: '#ea580c'
};

const ScheduleCardsMobile = ({ rows }) => {
  if (!rows || rows.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      {rows.map((row) => {
        const accentColor = row.accent ? ACCENTS[row.accent] : null;
        return (
          <div
            key={row.key}
            style={{
              border: '1px solid var(--border-color)',
              borderLeft: accentColor ? `4px solid ${accentColor}` : '1px solid var(--border-color)',
              borderRadius: '10px',
              background: accentColor
                ? `color-mix(in srgb, ${accentColor} 7%, var(--bg-secondary))`
                : 'var(--bg-secondary)',
              padding: '0.85rem 1rem',
              opacity: row.muted ? 0.65 : 1
            }}
          >
            {/* Headline: title left, status chip right */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              flexWrap: 'wrap'
            }}>
              <div style={{
                fontSize: '0.9375rem',
                fontWeight: '700',
                color: 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {row.title}
              </div>
              {row.badge && (
                <span style={{
                  background: row.badge.background || 'var(--bg-tertiary)',
                  color: row.badge.color || 'var(--text-secondary)',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '8px',
                  fontSize: '0.7rem',
                  fontWeight: '700',
                  whiteSpace: 'nowrap',
                  letterSpacing: '0.3px'
                }}>
                  {row.badge.text}
                </span>
              )}
            </div>

            {row.subtitle && (
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginTop: '0.15rem'
              }}>
                {row.subtitle}
              </div>
            )}

            {row.fields && row.fields.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.6rem 1rem',
                marginTop: '0.65rem',
                paddingTop: '0.65rem',
                borderTop: '1px solid var(--border-color)'
              }}>
                {row.fields.map((f, i) => (
                  <div key={i}>
                    <div style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                      marginBottom: '0.1rem'
                    }}>
                      {f.label}
                    </div>
                    <div style={{
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {f.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ScheduleCardsMobile;
