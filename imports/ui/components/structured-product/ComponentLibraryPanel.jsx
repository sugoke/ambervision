import React, { useState } from 'react';
import { Card, ActionButton } from '../common';
import { colors, spacing, borderRadius } from '../../../constants/styles';

/**
 * ComponentLibraryPanel - Extracted from StructuredProductInterface
 * Provides drag-and-drop component library for building payoff structures
 * 
 * @param {Object} props
 * @param {Function} props.onDragStart - Handler for drag start events
 * @param {Array} props.categories - Component categories to display
 * @param {boolean} props.isCollapsed - Whether the panel is collapsed
 * @param {Function} props.onToggleCollapse - Handler for collapse toggle
 */
const ComponentLibraryPanel = ({
  onDragStart,
  categories = [],
  isCollapsed = false,
  onToggleCollapse
}) => {
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id || '');

  const defaultCategories = [];

  const categoriesToUse = categories.length > 0 ? categories : defaultCategories;

  const handleDragStart = (e, component) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({
      type: component.type,
      icon: component.icon,
      id: `${component.type}_${Date.now()}`
    }));
    onDragStart?.(component);
  };

  if (isCollapsed) {
    return (
      <Card 
        style={{ 
          width: '60px',
          padding: spacing[2],
          transition: 'all 0.3s ease'
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <ActionButton
            variant="secondary"
            size="small"
            onClick={onToggleCollapse}
            style={{ 
              padding: spacing[2],
              minWidth: 'auto'
            }}
          >
            📚
          </ActionButton>
        </div>
      </Card>
    );
  }

  return (
    <Card 
      style={{ 
        width: '320px',
        height: '100vh',
        maxHeight: '100vh',
        transition: 'all 0.3s ease',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing[4],
        paddingBottom: spacing[3],
        borderBottom: `1px solid ${colors.border}`
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing[2]
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: `${colors.accent}20`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1rem'
          }}>
            📚
          </div>
          <h3 style={{
            margin: 0,
            fontSize: '1rem',
            fontWeight: '600',
            color: colors.primary
          }}>
            Component Library
          </h3>
        </div>
        
        <ActionButton
          variant="secondary"
          size="small"
          onClick={onToggleCollapse}
        >
          ←
        </ActionButton>
      </div>

      {/* Category Tabs */}
      {categoriesToUse.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing[1],
          marginBottom: spacing[4]
        }}>
          {categoriesToUse.map((category) => (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              style={{
                padding: `${spacing[1]} ${spacing[3]}`,
                border: `1px solid ${activeCategory === category.id ? colors.accent : colors.border}`,
                background: activeCategory === category.id ? `${colors.accent}10` : 'transparent',
                color: activeCategory === category.id ? colors.accent : colors.secondary,
                borderRadius: borderRadius.md,
                fontSize: '0.8rem',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: spacing[1]
              }}
            >
              <span>{category.icon}</span>
              <span>{category.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Component Grid */}
      <div 
        className="component-library-panel-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingRight: spacing[1],
          scrollBehavior: 'smooth',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {categoriesToUse.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: spacing[6],
            color: colors.primary || 'var(--text-primary)'
          }}>
            <div style={{
              fontSize: '3rem',
              marginBottom: spacing[3]
            }}>
              📚
            </div>
            <div style={{
              fontSize: '1rem',
              fontWeight: '500',
              marginBottom: spacing[2],
              color: colors.primary || 'var(--text-primary)'
            }}>
              Component Library Empty
            </div>
            <div style={{
              fontSize: '0.9rem',
              lineHeight: '1.4',
              color: colors.secondary || 'var(--text-secondary)'
            }}>
              No components available.<br />
              Start fresh by adding your own components.
            </div>
          </div>
        ) : (
          categoriesToUse
            .find(cat => cat.id === activeCategory)
            ?.components.map((component, index) => (
              <ComponentCard
                key={`${component.type}_${index}`}
                component={component}
                onDragStart={handleDragStart}
              />
            ))
        )}
      </div>

      {/* Help Text */}
      <div style={{
        marginTop: spacing[4],
        padding: spacing[3],
        background: `${colors.info}10`,
        border: `1px solid ${colors.info}30`,
        borderRadius: borderRadius.md,
        fontSize: '0.8rem',
        color: colors.secondary,
        flexShrink: 0 // Prevent shrinking when scrolling
      }}>
        <div style={{ fontWeight: '600', marginBottom: spacing[1] }}>
          💡 How to use:
        </div>
        <ul style={{ margin: 0, paddingLeft: spacing[4] }}>
          <li>Drag components to the payoff structure builder</li>
          <li>IF components automatically go to the top</li>
          <li>Combine components to create complex payoffs</li>
        </ul>
      </div>
    </Card>
  );
};

// Individual component card
const ComponentCard = ({ component, onDragStart }) => {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        setIsDragging(true);
        onDragStart(e, component);
      }}
      onDragEnd={() => setIsDragging(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: spacing[3],
        padding: spacing[3],
        marginBottom: spacing[2],
        background: isDragging ? `${colors.accent}10` : colors.bgPrimary,
        border: `1px solid ${isDragging ? colors.accent : colors.border}`,
        borderRadius: borderRadius.md,
        cursor: 'grab',
        transition: 'all 0.2s ease',
        userSelect: 'none'
      }}
      onMouseEnter={(e) => {
        if (!isDragging) {
          e.currentTarget.style.background = `${colors.accent}05`;
          e.currentTarget.style.borderColor = `${colors.accent}50`;
          e.currentTarget.style.transform = 'translateY(-1px)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          e.currentTarget.style.background = colors.bgPrimary;
          e.currentTarget.style.borderColor = colors.border;
          e.currentTarget.style.transform = 'translateY(0)';
        }
      }}
    >
      {/* Component Icon */}
      <div style={{
        width: '36px',
        height: '36px',
        borderRadius: borderRadius.md,
        background: `${colors.accent}15`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.2rem',
        flexShrink: 0
      }}>
        {component.icon}
      </div>

      {/* Component Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
      </div>

      {/* Drag Handle */}
      <div style={{
        color: colors.muted,
        fontSize: '0.8rem',
        flexShrink: 0
      }}>
        ⋮⋮
      </div>
    </div>
  );
};

export default ComponentLibraryPanel;