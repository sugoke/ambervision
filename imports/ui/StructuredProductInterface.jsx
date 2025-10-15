import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';
import { IssuersCollection } from '/imports/api/issuers';
import { TemplatesCollection, BUILT_IN_TEMPLATES } from '/imports/api/templates';
import { USER_ROLES } from '/imports/api/users';
import { useTheme } from './ThemeContext.jsx';
import { GenericComponents } from '/imports/api/genericComponentLibrary.js';
import SecurityAutocomplete from './SecurityAutocomplete.jsx';
import ReactCountryFlag from 'react-country-flag';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';
import { formatDateToISO, formatDateToDDMMYYYY, isWeekend, isMarketHoliday, getNextTradingDay } from '/imports/utils/dateUtils.js';
import { formatDateForDisplay } from '/imports/utils/dateFormatters.js';
import { getSecurityCountryFlag } from '/imports/utils/securityUtils.js';
import UnderlyingCreationModule from './components/UnderlyingCreationModule.jsx';
import BasketDefinitionModule from './components/structured-product/baskets/BasketDefinitionModule.jsx';
import SingleUnderlyingModule from './components/structured-product/baskets/SingleUnderlyingModule.jsx';
import ProductDetailsCard from './components/structured-product/product-details/ProductDetailsCard.jsx';
import StructureModule from './components/StructureModule.jsx';
import ScheduleBuilder from './components/ScheduleBuilder.jsx';
import SummaryModule from './components/SummaryModule.jsx';
import DraggableItem from './components/structured-product/drag-drop/DraggableItem.jsx';
import DroppedItem from './components/structured-product/drag-drop/DroppedItem.jsx';
import { ItemTypes } from './components/structured-product/ItemTypes.js';
import { globalProductValidator } from '/imports/api/validators/productStructureValidator.js';
import CustomDateInput from './components/CustomDateInput.jsx';
import TermSheetUploader from './components/TermSheetUploader.jsx';


// Column-based drop zone component
const ColumnDropZone = ({ column, items, onDrop, onUpdateItem, onRemoveItem, onReorderItem, onAddNestedLogic, indentLevel = 0, availableBaskets = [] }) => {
  // Define which item types are allowed in each column
  const getAllowedTypes = (columnType) => {
    switch(columnType) {
      case 'timing':
        return [ItemTypes.OBSERVATION, ItemTypes.TIMING, ItemTypes.FREQUENCY, ItemTypes.CALLABLE, ItemTypes.RANGE_ACCRUAL];
      case 'condition':
        return [ItemTypes.LOGIC_OPERATOR, ItemTypes.COMPARISON, ItemTypes.BARRIER, ItemTypes.BASKET, ItemTypes.UNDERLYING, ItemTypes.VARIABLE, ItemTypes.CONDITION, ItemTypes.STRIKE, 
                ItemTypes.AMERICAN_BARRIER, ItemTypes.STEPDOWN, ItemTypes.WORST_OF, ItemTypes.DYNAMIC_COUPON, ItemTypes.PARTICIPATION, 
                ItemTypes.IF, ItemTypes.ELSE];
      case 'action':
        return [ItemTypes.ACTION, ItemTypes.RESULT, ItemTypes.COUPON, ItemTypes.MEMORY, ItemTypes.AUTOCALL, ItemTypes.STRIKE, ItemTypes.LEVERAGE];
      case 'continuation':
        return [ItemTypes.CONTINUATION];
      default:
        return [];
    }
  };

  const allowedTypes = getAllowedTypes(column);

  const [{ isOver, canDrop }, drop] = useDrop({
    accept: allowedTypes,
    drop: (item) => {
      if (allowedTypes.includes(item.type)) {
        const newItem = {
          ...item,
          id: Date.now() + Math.random(),
          column: column,
          indentLevel: indentLevel,
          // Enhanced properties for flexible underlyings
          configurable: item.configurable || false,
          performanceLogic: item.performanceLogic || null,
          underlyingType: item.underlyingType || null,
          stageAdaptive: (item.type === ItemTypes.BASKET || item.type === ItemTypes.UNDERLYING)
        };
        onDrop(newItem);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  });

  const getColumnTitle = (column) => {
    switch(column) {
      case 'timing': return 'Timing';
      case 'condition': return 'Condition';
      case 'action': return 'Action';
      case 'continuation': return 'Next';
      default: return column;
    }
  };

  const getColumnClass = (column) => {
    switch(column) {
      case 'timing': return 'timing-column';
      case 'condition': return 'condition-column';
      case 'action': return 'action-column';
      case 'continuation': return 'continuation-column';
      default: return '';
    }
  };

  return (
    <div
      ref={drop}
      className={`column-drop-zone ${getColumnClass(column)} ${isOver && canDrop ? 'drop-over' : ''} ${isOver && !canDrop ? 'drop-invalid' : ''}`}
      style={{ marginLeft: `${indentLevel * 20}px` }}
    >
      <h4 className="column-title">{getColumnTitle(column)}</h4>
      <div className="column-items">
        {items
          .sort((a, b) => {
            // For condition column, enforce specific order: Logic Operators (IF/ELSE IF/ELSE) -> Underlyings/Baskets -> Operators -> Barriers
            if (column === 'condition') {
              const getItemPriority = (item) => {
                if (item.type === ItemTypes.LOGIC_OPERATOR || item.type === ItemTypes.IF || item.type === ItemTypes.ELSE) return 0; // All logic operators first (IF, ELSE IF, ELSE)
                if (item.type === ItemTypes.BASKET || item.type === ItemTypes.UNDERLYING) return 1; // Asset Baskets/Underlyings second
                if (item.type === ItemTypes.COMPARISON) return 2; // Comparison operators third
                if (item.type === ItemTypes.BARRIER) return 3; // Barriers fourth
                if (item.type === ItemTypes.STRIKE) return 4; // Strike levels last
                return 5; // Other items
              };
              
              const aPriority = getItemPriority(a);
              const bPriority = getItemPriority(b);
              
              if (aPriority !== bPriority) return aPriority - bPriority;
              
              // Same priority, sort by sortOrder
              const aOrder = a.sortOrder !== undefined ? a.sortOrder : 0;
              const bOrder = b.sortOrder !== undefined ? b.sortOrder : 0;
              return aOrder - bOrder;
            } else {
              // For other columns, logic operators always go first
              const aIsLogicOperator = a.type === ItemTypes.LOGIC_OPERATOR;
              const bIsLogicOperator = b.type === ItemTypes.LOGIC_OPERATOR;
              
              if (aIsLogicOperator && !bIsLogicOperator) return -1;
              if (!aIsLogicOperator && bIsLogicOperator) return 1;
              
              // If both are logic operators or both are not, sort by sortOrder
              const aOrder = a.sortOrder !== undefined ? a.sortOrder : 0;
              const bOrder = b.sortOrder !== undefined ? b.sortOrder : 0;
              return aOrder - bOrder;
            }
          })
          .map((item, index) => (
            <div key={item.id}>
              <DroppedItem
                item={item}
                index={index}
                onUpdate={onUpdateItem}
                onRemove={onRemoveItem}
                onReorder={onReorderItem}
                onAddNestedLogic={onAddNestedLogic}
                column={column}
                availableBaskets={availableBaskets}
              />
            </div>
          ))}
      </div>
      {items.length === 0 && (
        <div className="empty-column">
          Drop {getColumnTitle(column).toLowerCase()} here
        </div>
      )}
    </div>
  );
};

// Simple LogicRow component for structure display
const LogicRow = ({ rowIndex, items, onDrop, onUpdateItem, onRemoveItem, onReorderItem, onAddNestedLogic, onDeleteRow, section, availableBaskets = [] }) => {
  const rowItems = items.filter(item => item.rowIndex === rowIndex);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '1rem',
      borderBottom: '1px solid var(--border-color)',
      background: 'var(--bg-primary)',
      gap: '1rem'
    }}>
      <div style={{ 
        minWidth: '50px',
        fontSize: '0.9rem',
        color: 'var(--text-secondary)',
        fontWeight: '600'
      }}>
        #{rowIndex + 1}
      </div>
      
      <div style={{
        flex: 1,
        display: 'flex',
        gap: '0.5rem',
        flexWrap: 'wrap',
        minHeight: '40px',
        alignItems: 'center'
      }}>
        {rowItems.length > 0 ? (
          rowItems.map(item => (
            <div key={item.id} style={{
              background: 'var(--accent-color)',
              color: 'white',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span>{item.type}</span>
              <button
                onClick={() => onRemoveItem(item.id)}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  borderRadius: '3px',
                  color: 'white',
                  padding: '0.25rem',
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                ✕
              </button>
            </div>
          ))
        ) : (
          <div style={{
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            fontSize: '0.9rem'
          }}>
            Drop components here
          </div>
        )}
      </div>
      
      <button
        onClick={() => onDeleteRow(section, rowIndex)}
        style={{
          background: 'var(--error-color)',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          padding: '0.5rem',
          cursor: 'pointer',
          fontSize: '0.8rem'
        }}
      >
        🗑️
      </button>
    </div>
  );
};


// Template component within the structure tab
const TemplateSelector = React.memo(({ onTemplateSelect, user, onTemplateLoad, onTemplateNew, selectedTemplateId }) => {
  
  // Subscribe to templates outside of tracker to prevent re-subscriptions
  useEffect(() => {
    let handle = null;
    if (user) {
      handle = Meteor.subscribe('templates');
    }
    
    return () => {
      if (handle) {
        handle.stop();
      }
    };
  }, [user?._id]);
  
  const templates = useTracker(() => {
    if (!user) return [];
    
    // Use hardcoded built-in templates
    const builtInTemplates = BUILT_IN_TEMPLATES;
    
    // Get user's custom templates from database if any (no subscription here)
    const userId = user._id || user.id;
    const customTemplates = TemplatesCollection.find({
      userId: userId,
      isBuiltIn: { $ne: true }
    }, {
      sort: { name: 1 }
    }).fetch();
    
    // Combine hardcoded built-in templates with custom templates
    return [...builtInTemplates, ...customTemplates];
  }, [user?._id, user?.id]); // More specific dependencies


  if (!templates || templates.length === 0) {
    return (
      <div style={{ 
        padding: '2rem', 
        textAlign: 'center',
        border: '2px dashed var(--border-color)',
        borderRadius: '12px',
        background: 'var(--bg-secondary)'
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }}>📋</div>
        <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-secondary)' }}>No Templates Available</h3>
        <p style={{ margin: '0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Loading templates...
        </p>
      </div>
    );
  }

  const builtInTemplates = templates.filter(t => t.isBuiltIn);
  const customTemplates = templates.filter(t => !t.isBuiltIn);

  return (
    <>
      <div className="template-selector">
        <div style={{ 
          marginBottom: '1.5rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>Product Templates</h2>
        </div>


      {/* Built-in Templates */}
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ 
          color: 'var(--text-secondary)', 
          fontSize: '1.1rem', 
          margin: '0 0 1rem 0',
          paddingBottom: '0.5rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          🏢 Built-in Templates
        </h3>
        <div className="template-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '1rem'
        }}>
          {builtInTemplates.map((template) => (
            <div key={template._id} className="template-card" style={{
              border: selectedTemplateId === template._id ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1.5rem',
              background: selectedTemplateId === template._id ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              position: 'relative',
              boxShadow: selectedTemplateId === template._id ? '0 4px 12px rgba(0, 123, 255, 0.2)' : 'none'
            }}
            onClick={() => onTemplateLoad(template)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              e.currentTarget.style.borderColor = 'var(--accent-color)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.borderColor = 'var(--border-color)';
            }}
            >
              <div style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'var(--accent-color)',
                color: 'white',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                fontSize: '0.7rem',
                fontWeight: '600'
              }}>
                BUILT-IN
              </div>
              <h4 style={{ 
                margin: '0 0 0.5rem 0', 
                color: 'var(--text-primary)',
                fontSize: '1.1rem',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                {template.icon && <span style={{ fontSize: '1.3rem' }}>{template.icon}</span>}
                {template.name}
              </h4>
              <p style={{ 
                margin: '0 0 1rem 0', 
                color: 'var(--text-muted)', 
                fontSize: '0.9rem',
                lineHeight: '1.4'
              }}>
                {template.description || 'Professional structured product template'}
              </p>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '1rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border-color)'
              }}>
                <span style={{ 
                  color: 'var(--text-secondary)', 
                  fontSize: '0.8rem' 
                }}>
                  Click to load template
                </span>
                <span style={{
                  background: 'var(--bg-primary)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)'
                }}>
                  📋 Template
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom Templates */}
      {customTemplates.length > 0 && (
        <div>
          <h3 style={{ 
            color: 'var(--text-secondary)', 
            fontSize: '1.1rem', 
            margin: '0 0 1rem 0',
            paddingBottom: '0.5rem',
            borderBottom: '1px solid var(--border-color)'
          }}>
            👤 Your Custom Templates
          </h3>
          <div className="template-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '1rem'
          }}>
            {customTemplates.map((template) => (
              <div key={template._id} className="template-card" style={{
                border: selectedTemplateId === template._id ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '1.5rem',
                background: selectedTemplateId === template._id ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative',
                boxShadow: selectedTemplateId === template._id ? '0 4px 12px rgba(0, 123, 255, 0.2)' : 'none'
              }}
              onClick={() => onTemplateLoad(template)}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                e.currentTarget.style.borderColor = 'var(--accent-color)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
              >
                <div style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  background: 'var(--success-color)',
                  color: 'white',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.7rem',
                  fontWeight: '600'
                }}>
                  CUSTOM
                </div>
                <h4 style={{ 
                  margin: '0 0 0.5rem 0', 
                  color: 'var(--text-primary)',
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  {template.icon && <span style={{ fontSize: '1.3rem' }}>{template.icon}</span>}
                  {template.name}
                </h4>
                <p style={{ 
                  margin: '0 0 1rem 0', 
                  color: 'var(--text-muted)', 
                  fontSize: '0.9rem',
                  lineHeight: '1.4'
                }}>
                  {template.description || 'Your custom structured product template'}
                </p>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '1rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid var(--border-color)'
                }}>
                  <span style={{ 
                    color: 'var(--text-secondary)', 
                    fontSize: '0.8rem' 
                  }}>
                    Created {new Date(template.createdAt).toLocaleDateString()}
                  </span>
                  <span style={{
                    background: 'var(--bg-primary)',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)'
                  }}>
                    👤 Your Template
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
    </>
  );
});

// Schedule Module Component (now extracted)
const ScheduleModule = ({ observationSchedule, setObservationSchedule, maturityDate, setMaturityDate, finalObservationDate, setFinalObservationDate }) => {
  
  const [scheduleType, setScheduleType] = useState('manual');
  const [frequency, setFrequency] = useState('quarterly');
  const [couponRate, setCouponRate] = useState(3.5);
  const [showMaturityOnly, setShowMaturityOnly] = useState(false);
  
  // Helper function to generate schedule based on frequency
  const generateSchedule = useCallback(() => {
    if (!finalObservationDate) return;
    
    const final = new Date(finalObservationDate);
    const schedule = [];
    
    let months;
    switch(frequency) {
      case 'monthly': months = 1; break;
      case 'quarterly': months = 3; break;
      case 'semi-annual': months = 6; break;
      case 'annual': months = 12; break;
      default: months = 3;
    }
    
    // Generate observations working backwards from final
    let currentDate = new Date(final);
    while (schedule.length < 8) { // Max 8 observations
      schedule.unshift({
        id: Date.now() + Math.random(),
        date: formatDateToISO(currentDate),
        type: 'observation',
        couponRate: couponRate,
        autocallLevel: 100 - (schedule.length * 5), // Decreasing levels
        editable: true
      });
      
      currentDate.setMonth(currentDate.getMonth() - months);
      
      // Stop if we go too far back (2+ years)
      if (final.getTime() - currentDate.getTime() > 2 * 365 * 24 * 60 * 60 * 1000) {
        break;
      }
    }
    
    setObservationSchedule(schedule);
  }, [finalObservationDate, frequency, couponRate, setObservationSchedule]);
  
  // Delay helper
  const getDelayHelperText = () => {
    if (!finalObservationDate || !maturityDate) return '';
    
    const final = new Date(finalObservationDate);
    const maturity = new Date(maturityDate);
    const diffTime = maturity.getTime() - final.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Same day settlement';
    if (diffDays === 1) return '1 day delay (T+1)';
    if (diffDays === 2) return '2 days delay (T+2)';
    if (diffDays === 3) return '3 days delay (T+3)';
    return `${diffDays} days delay`;
  };
  
  const addMaturityDelayDays = (days) => {
    if (!finalObservationDate) return;
    
    const final = new Date(finalObservationDate);
    final.setDate(final.getDate() + days);
    setMaturityDate(formatDateToISO(final));
  };
  
  return (
    <div className="schedule-module">
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '2rem',
        paddingBottom: '1rem',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>Product Schedule</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setShowMaturityOnly(!showMaturityOnly)}
            style={{
              padding: '0.5rem 1rem',
              background: showMaturityOnly ? 'var(--accent-color)' : 'var(--bg-secondary)',
              color: showMaturityOnly ? 'white' : 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            {showMaturityOnly ? '📅 Show Full Schedule' : '⚡ Maturity Only'}
          </button>
        </div>
      </div>

      {/* Key Dates Timeline */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '2rem'
      }}>
        <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>Key Dates</h3>
        
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: showMaturityOnly ? '1fr' : '1fr 1fr' }}>
          {!showMaturityOnly && (
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
                Final Observation
              </label>
              <CustomDateInput
                value={finalObservationDate}
                onChange={(e) => setFinalObservationDate(e.target.value)}
              />
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Last market observation date
              </div>
            </div>
          )}
          
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
              Maturity Date
            </label>
            <CustomDateInput
              value={maturityDate}
              onChange={(e) => setMaturityDate(e.target.value)}
            />
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Settlement/payment date {getDelayHelperText()}
            </div>
            
            {!showMaturityOnly && finalObservationDate && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button onClick={() => addMaturityDelayDays(1)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}>+1 day</button>
                <button onClick={() => addMaturityDelayDays(2)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}>+2 days</button>
                <button onClick={() => addMaturityDelayDays(3)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}>+3 days</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {!showMaturityOnly && (
        <>
          {/* Schedule Generation Controls */}
          <div style={{
            background: 'var(--bg-secondary)',
            padding: '1.5rem',
            borderRadius: '8px',
            marginBottom: '2rem'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>Observation Schedule</h3>
            
            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr 1fr auto' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
                  Schedule Type
                </label>
                <select
                  value={scheduleType}
                  onChange={(e) => setScheduleType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)'
                  }}
                >
                  <option value="manual">Manual Entry</option>
                  <option value="generated">Auto Generate</option>
                </select>
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
                  Frequency
                </label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  disabled={scheduleType === 'manual'}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    background: scheduleType === 'manual' ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    opacity: scheduleType === 'manual' ? 0.6 : 1
                  }}
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="semi-annual">Semi-Annual</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
                  Default Coupon %
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={couponRate}
                  onChange={(e) => {
                    let value = e.target.value;
                    // Allow empty string, numbers, decimal points, and commas
                    if (value === '' || /^\d*[.,]?\d*$/.test(value)) {
                      // Replace comma with period for parsing
                      const normalizedValue = value.replace(',', '.');
                      const numValue = parseFloat(normalizedValue);
                      setCouponRate(isNaN(numValue) ? 0 : numValue);
                    }
                  }}
                  disabled={scheduleType === 'manual'}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    background: scheduleType === 'manual' ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    opacity: scheduleType === 'manual' ? 0.6 : 1
                  }}
                />
              </div>
              
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <button
                  onClick={generateSchedule}
                  disabled={scheduleType === 'manual' || !finalObservationDate}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: (scheduleType === 'manual' || !finalObservationDate) ? 'var(--bg-tertiary)' : 'var(--accent-color)',
                    color: (scheduleType === 'manual' || !finalObservationDate) ? 'var(--text-muted)' : 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: (scheduleType === 'manual' || !finalObservationDate) ? 'not-allowed' : 'pointer',
                    fontWeight: '500',
                    whiteSpace: 'nowrap'
                  }}
                >
                  🔄 Generate
                </button>
              </div>
            </div>
          </div>

          {/* Observation Schedule Table */}
          {observationSchedule && observationSchedule.length > 0 && (
            <div style={{
              background: 'var(--bg-secondary)',
              padding: '1.5rem',
              borderRadius: '8px'
            }}>
              <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>Observation Dates</h3>
              
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  background: 'var(--bg-primary)',
                  borderRadius: '6px',
                  overflow: 'hidden'
                }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-tertiary)' }}>
                      <th style={{ padding: '1rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>#</th>
                      <th style={{ padding: '1rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Date</th>
                      <th style={{ padding: '1rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Type</th>
                      <th style={{ padding: '1rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Coupon %</th>
                      <th style={{ padding: '1rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Autocall Level</th>
                      <th style={{ padding: '1rem', textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {observationSchedule.map((obs, index) => (
                      <tr key={obs.id} style={{ borderBottom: index < observationSchedule.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                        <td style={{ padding: '1rem' }}>{index + 1}</td>
                        <td style={{ padding: '1rem' }}>
                          <CustomDateInput
                            value={obs.date}
                            onChange={(e) => {
                              const updated = [...observationSchedule];
                              updated[index].date = e.target.value;
                              setObservationSchedule(updated);
                            }}
                            style={{
                              width: '140px'
                            }}
                          />
                        </td>
                        <td style={{ padding: '1rem' }}>
                          <select
                            value={obs.type}
                            onChange={(e) => {
                              const updated = [...observationSchedule];
                              updated[index].type = e.target.value;
                              setObservationSchedule(updated);
                            }}
                            style={{
                              padding: '0.5rem',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              background: 'var(--bg-secondary)',
                              color: 'var(--text-primary)',
                              width: '120px'
                            }}
                          >
                            <option value="observation">Observation</option>
                            <option value="coupon">Coupon Only</option>
                            <option value="autocall">Autocall</option>
                          </select>
                        </td>
                        <td style={{ padding: '1rem' }}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={obs.couponRate}
                            onChange={(e) => {
                              let value = e.target.value;
                              // Allow empty string, numbers, decimal points, and commas
                              if (value === '' || /^\d*[.,]?\d*$/.test(value)) {
                                // Replace comma with period for parsing
                                const normalizedValue = value.replace(',', '.');
                                const numValue = parseFloat(normalizedValue);
                                const updated = [...observationSchedule];
                                updated[index].couponRate = isNaN(numValue) ? 0 : numValue;
                                setObservationSchedule(updated);
                              }
                            }}
                            style={{
                              padding: '0.5rem',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              background: 'var(--bg-secondary)',
                              color: 'var(--text-primary)',
                              width: '80px'
                            }}
                          />
                        </td>
                        <td style={{ padding: '1rem' }}>
                          <input
                            type="number"
                            step="1"
                            value={obs.autocallLevel}
                            onChange={(e) => {
                              const updated = [...observationSchedule];
                              updated[index].autocallLevel = parseFloat(e.target.value);
                              setObservationSchedule(updated);
                            }}
                            style={{
                              padding: '0.5rem',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              background: 'var(--bg-secondary)',
                              color: 'var(--text-primary)',
                              width: '80px'
                            }}
                          />
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <button
                            onClick={() => {
                              const updated = observationSchedule.filter((_, i) => i !== index);
                              setObservationSchedule(updated);
                            }}
                            style={{
                              padding: '0.5rem',
                              background: 'var(--error-color)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.8rem'
                            }}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <button
                onClick={() => {
                  const newObs = {
                    id: Date.now() + Math.random(),
                    date: finalObservationDate || '',
                    type: 'observation',
                    couponRate: couponRate,
                    autocallLevel: 100,
                    editable: true
                  };
                  setObservationSchedule([...observationSchedule, newObs]);
                }}
                style={{
                  marginTop: '1rem',
                  padding: '0.75rem 1.5rem',
                  background: 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                ➕ Add Observation
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Main component
const StructuredProductInterface = ({ 
  editingProduct = null, 
  editingTemplate = null, 
  user, 
  onSave, 
  onComponentLibraryStateChange 
}) => {
  const { theme } = useTheme();
  
  // Debug log for tracking product editing
  useEffect(() => {
    if (editingProduct) {
      console.log('StructuredProductInterface: EditingProduct received:', {
        id: editingProduct._id,
        title: editingProduct.title,
        hasStructure: !!editingProduct.structure
      });
    }
  }, [editingProduct]);

  // Main state management
  const [activeTab, setActiveTab] = useState('setup');
  const [productDetails, setProductDetails] = useState({
    title: '',
    isin: '',
    issuer: '',
    currency: 'USD',
    tradeDate: '',
    valueDate: '',
    finalObservation: '',
    maturity: '',
    productFamily: '',
    notional: 100,
    denomination: 1000,
    couponFrequency: 'quarterly',
    underlyingMode: 'single'
  });

  // Structure state
  const [droppedItems, setDroppedItems] = useState({
    life: [], // Life of product structure items
    maturity: [] // At maturity structure items
  });

  // Structure configuration parameters state - initialized empty, populated by template selection
  const [structureParams, setStructureParams] = useState({});

  // Helper function to get template-specific default parameters
  const getTemplateDefaults = (templateId) => {
    switch (templateId) {
      case 'phoenix_autocallable':
        return {
          couponRate: 8.5,
          protectionBarrierLevel: 70,
          memoryCoupon: true,
          memoryAutocall: false,
          couponFrequency: 'quarterly',
          referencePerformance: 'worst-of'
        };
      case 'orion_memory':
        return {
          upperBarrier: 100,
          rebate: 8.0,
          capitalGuaranteed: 100
        };
      case 'himalaya':
        return {
          floor: 100,
          observationFrequency: 'custom'
        };
      case 'shark_note':
        return {
          strike: 100,
          upperBarrier: 140,
          rebateValue: 10,
          floorLevel: 90,
          referencePerformance: 'worst-of',
          barrierObservation: 'continuous'
        };
      default:
        return {
          couponRate: 8.5,
          protectionBarrierLevel: 70
        };
    }
  };

  // Underlying state  
  const [underlyings, setUnderlyings] = useState([]);
  const [basketMode, setBasketMode] = useState('single'); // 'single' or 'basket'
  const [basketPerformanceType, setBasketPerformanceType] = useState('worst-of'); // 'worst-of', 'best-of', 'average'
  
  // Schedule state
  const [observationSchedule, setObservationSchedule] = useState([]);
  const [maturityDate, setMaturityDate] = useState('');
  const [finalObservationDate, setFinalObservationDate] = useState('');
  const [firstObservationDate, setFirstObservationDate] = useState('');
  
  // Schedule configuration state
  const [scheduleConfig, setScheduleConfig] = useState({
    frequency: 'quarterly',
    coolOffPeriods: 0,
    stepDownValue: -5,
    initialAutocallLevel: 100,
    initialCouponBarrier: 70
  });

  // Template state
  const [editingTemplateName, setEditingTemplateName] = useState(null);
  const [isTemplateEditing, setIsTemplateEditing] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

  // Dialog state
  const { dialogState, showAlert, showError, showSuccess, showConfirm, hideDialog } = useDialog();

  // Term sheet uploader collapse state
  const [isTermSheetExpanded, setIsTermSheetExpanded] = useState(false);

  // Available baskets for dropdown components (computed from underlyings)
  const availableBaskets = useMemo(() => {
    if (basketMode === 'single' && underlyings.length > 0) {
      return [{
        id: 'single',
        name: underlyings[0]?.ticker || 'Single Underlying',
        securities: underlyings.slice(0, 1)
      }];
    } else if (basketMode === 'basket') {
      return [{
        id: 'basket',
        name: 'Custom Basket',
        securities: underlyings
      }];
    }
    return [];
  }, [underlyings, basketMode]);

  // Load editing product data
  useEffect(() => {
    if (editingProduct) {
      console.log('StructuredProductInterface: Loading editing product data');
      
      // Load basic product details
      setProductDetails({
        title: editingProduct.title || '',
        isin: editingProduct.isin || '',
        issuer: editingProduct.issuer || '',
        currency: editingProduct.currency || 'USD',
        tradeDate: editingProduct.tradeDate || '',
        valueDate: editingProduct.valueDate || '',
        finalObservation: editingProduct.finalObservation || editingProduct.finalObservationDate || '',
        maturity: editingProduct.maturity || editingProduct.maturityDate || '',
        productFamily: editingProduct.productFamily || '',
        notional: editingProduct.notional || 100,
        denomination: editingProduct.denomination || 1000,
        couponFrequency: editingProduct.couponFrequency || 'quarterly',
        underlyingMode: editingProduct.underlyingMode || 'single'
      });

      // Load structure if it exists
      if (editingProduct.structure) {
        console.log('StructuredProductInterface: Loading product structure');
        setDroppedItems(editingProduct.structure);
      }

      // Load underlyings
      if (editingProduct.underlyings) {
        setUnderlyings(editingProduct.underlyings);
        if (editingProduct.underlyings.length > 1) {
          setBasketMode('basket');
        }
      }

      // Load schedule
      if (editingProduct.observationSchedule) {
        setObservationSchedule(editingProduct.observationSchedule);
      }
      
      if (editingProduct.maturity || editingProduct.maturityDate) {
        setMaturityDate(editingProduct.maturity || editingProduct.maturityDate);
      }
      
      // Load final observation date - check multiple possible field names
      let finalObsDate = editingProduct.finalObservation || editingProduct.finalObservationDate;
      
      // If no explicit final observation date, extract from observation schedule
      if (!finalObsDate && editingProduct.observationSchedule && editingProduct.observationSchedule.length > 0) {
        const lastObservation = editingProduct.observationSchedule[editingProduct.observationSchedule.length - 1];
        if (lastObservation && lastObservation.observationDate) {
          finalObsDate = lastObservation.observationDate;
        } else if (lastObservation && lastObservation.date) {
          finalObsDate = lastObservation.date;
        }
      }
      
      if (finalObsDate) {
        setFinalObservationDate(finalObsDate);
        // Also set it in productDetails since it might be used there
        setProductDetails(prev => ({
          ...prev,
          finalObservation: finalObsDate
        }));
      }

      // Auto-select template based on saved template ID or infer from structure
      if (editingProduct.templateId) {
        setSelectedTemplateId(editingProduct.templateId);
      } else if (editingProduct.template) {
        setSelectedTemplateId(editingProduct.template);
      } else {
        // Try to infer template from product title or structure
        const title = editingProduct.title || '';
        if (title.toLowerCase().includes('phoenix')) {
          setSelectedTemplateId('phoenix_autocallable');
        } else if (title.toLowerCase().includes('orion')) {
          setSelectedTemplateId('orion_memory');
        } else if (title.toLowerCase().includes('himalaya')) {
          setSelectedTemplateId('himalaya');
        } else if (title.toLowerCase().includes('shark')) {
          setSelectedTemplateId('shark_note');
        }
      }

      // For backward compatibility, try to extract first observation date from schedule
      if (editingProduct.observationSchedule && editingProduct.observationSchedule.length > 0) {
        const firstObs = editingProduct.observationSchedule[0];
        if (firstObs && firstObs.date) {
          setFirstObservationDate(firstObs.date);
        }
      }
      
      // Load structure and schedule parameters if they exist
      if (editingProduct.structureParams) {
        setStructureParams(editingProduct.structureParams);
      }
      
      if (editingProduct.scheduleConfig) {
        setScheduleConfig(editingProduct.scheduleConfig);
      }
    }
  }, [editingProduct]);

  // Load editing template
  useEffect(() => {
    if (editingTemplate) {
      console.log('StructuredProductInterface: Loading editing template:', editingTemplate.name);
      setEditingTemplateName(editingTemplate.name);
      setIsTemplateEditing(true);
      
      // Load template structure
      if (editingTemplate.structure) {
        setDroppedItems(editingTemplate.structure);
      }
      
      // Load template details if available
      if (editingTemplate.productDetails) {
        setProductDetails(prev => ({
          ...prev,
          ...editingTemplate.productDetails
        }));
      }
      
      // Switch to structure tab
      setActiveTab('structure');
    }
  }, [editingTemplate]);

  // Component library visibility management
  const [isComponentLibraryVisible, setIsComponentLibraryVisible] = useState(false);

  // Report component library state changes to parent
  useEffect(() => {
    if (onComponentLibraryStateChange) {
      onComponentLibraryStateChange(isComponentLibraryVisible);
    }
  }, [isComponentLibraryVisible, onComponentLibraryStateChange]);

  // Tab change handler
  const handleTabChange = useCallback((newTab) => {
    console.log('StructuredProductInterface: Tab change:', activeTab, '->', newTab);
    
    // Show component library only on structure tab
    if (newTab === 'structure') {
      setIsComponentLibraryVisible(true);
    } else {
      setIsComponentLibraryVisible(false);
    }
    
    setActiveTab(newTab);
  }, [activeTab]);

  // Product details update handler
  const handleUpdateProductDetails = useCallback((field, value) => {
    console.log('StructuredProductInterface: Updating product details:', field, value);
    setProductDetails(prev => ({
      ...prev,
      [field]: value
    }));

    // Sync finalObservation changes to finalObservationDate state
    if (field === 'finalObservation') {
      setFinalObservationDate(value);
    }
  }, []);

  // Underlying mode change handler
  const handleUnderlyingModeChange = useCallback((mode) => {
    console.log('StructuredProductInterface: Changing underlying mode to:', mode);
    setBasketMode(mode);
    
    if (mode === 'single' && underlyings.length > 1) {
      // Keep only the first underlying
      setUnderlyings(prev => prev.slice(0, 1));
    }
  }, [underlyings.length]);

  // Drop handler for structure items
  const handleDrop = useCallback((item, targetSection = 'life') => {
    console.log('StructuredProductInterface: Dropping item:', item.type, 'in section:', targetSection);
    
    setDroppedItems(prev => {
      const newItems = { ...prev };
      
      // Determine which section to add to
      const section = targetSection === 'maturity' ? 'maturity' : 'life';
      
      // Get current max row index for the section
      const maxRowIndex = newItems[section].length > 0 
        ? Math.max(...newItems[section].map(item => item.rowIndex || 0))
        : -1;
      
      const newItem = {
        ...item,
        id: Date.now() + Math.random(),
        section: section,
        rowIndex: item.rowIndex !== undefined ? item.rowIndex : maxRowIndex + 1,
        sortOrder: item.sortOrder || 0
      };
      
      newItems[section] = [...newItems[section], newItem];
      
      return newItems;
    });
  }, []);

  // Update item handler
  const handleUpdateItem = useCallback((id, updatedItem) => {
    console.log('StructuredProductInterface: Updating item:', id);
    
    setDroppedItems(prev => {
      const newItems = { ...prev };
      
      // Find and update item in appropriate section
      ['life', 'maturity'].forEach(section => {
        const itemIndex = newItems[section].findIndex(item => item.id === id);
        if (itemIndex !== -1) {
          newItems[section][itemIndex] = { ...newItems[section][itemIndex], ...updatedItem };
        }
      });
      
      return newItems;
    });
  }, []);

  // Remove item handler
  const handleRemoveItem = useCallback((id) => {
    console.log('StructuredProductInterface: Removing item:', id);
    
    setDroppedItems(prev => {
      const newItems = { ...prev };
      
      // Remove item from appropriate section
      ['life', 'maturity'].forEach(section => {
        newItems[section] = newItems[section].filter(item => item.id !== id);
      });
      
      return newItems;
    });
  }, []);

  // Reorder item handler
  const handleReorderItem = useCallback((id, direction) => {
    console.log('StructuredProductInterface: Reordering item:', id, direction);
    // Implementation for reordering items within the same row/column
  }, []);

  // Add nested logic handler
  const handleAddNestedLogic = useCallback((id, logicType) => {
    console.log('StructuredProductInterface: Adding nested logic:', logicType, 'for item:', id);
    // Implementation for adding nested IF/ELSE logic
  }, []);

  // Add new row handler
  const handleAddRow = useCallback((section) => {
    console.log('StructuredProductInterface: Adding new row to section:', section);
    
    setDroppedItems(prev => {
      const newItems = { ...prev };
      const maxRowIndex = newItems[section].length > 0 
        ? Math.max(...newItems[section].map(item => item.rowIndex || 0))
        : -1;
      
      // Add an empty row (no items yet)
      // The user will drag items to this row
      
      return newItems;
    });
  }, []);

  // Delete row handler
  const handleDeleteRow = useCallback((section, rowIndex) => {
    console.log('StructuredProductInterface: Deleting row:', rowIndex, 'from section:', section);
    
    setDroppedItems(prev => {
      const newItems = { ...prev };
      
      // Remove all items from the specified row
      newItems[section] = newItems[section].filter(item => item.rowIndex !== rowIndex);
      
      // Reindex remaining rows
      const sortedItems = newItems[section].sort((a, b) => (a.rowIndex || 0) - (b.rowIndex || 0));
      const uniqueRowIndices = [...new Set(sortedItems.map(item => item.rowIndex || 0))];
      
      uniqueRowIndices.forEach((oldIndex, newIndex) => {
        newItems[section].forEach(item => {
          if (item.rowIndex === oldIndex) {
            item.rowIndex = newIndex;
          }
        });
      });
      
      return newItems;
    });
  }, []);

  // Schedule change handler
  const handleScheduleChange = useCallback((newSchedule) => {
    console.log('StructuredProductInterface: Schedule updated:', newSchedule.length, 'observations');
    setObservationSchedule(newSchedule);

    // Update first observation date if available
    if (newSchedule && newSchedule.length > 0) {
      const firstObs = newSchedule[0];
      if (firstObs && firstObs.observationDate) {
        setFirstObservationDate(firstObs.observationDate);
      }
    }
  }, []);

  // First observation date change handler
  const handleFirstObservationDateChange = useCallback((newDate) => {
    console.log('StructuredProductInterface: First observation date changed:', newDate);
    setFirstObservationDate(newDate);
  }, []);

  // Handle structure parameter changes
  const handleStructureParamChange = useCallback((param, value) => {
    console.log('StructuredProductInterface: Structure param changed:', param, value);
    setStructureParams(prev => ({
      ...prev,
      [param]: value
    }));
  }, []);

  // Handle schedule configuration changes
  const handleScheduleConfigChange = useCallback((param, value) => {
    console.log('StructuredProductInterface: Schedule config changed:', param, value);
    setScheduleConfig(prev => ({
      ...prev,
      [param]: value
    }));
  }, []);

  // Template handlers
  const handleTemplateNew = useCallback(() => {
    console.log('StructuredProductInterface: Clearing template selection');
    setSelectedTemplateId(null); // Clear template selection
    setDroppedItems({ life: [], maturity: [] });
    setStructureParams({}); // Clear template-specific parameters
  }, []);

  const handleTemplateSave = useCallback(async () => {
    if (!editingTemplateName) {
      const templateName = await showAlert(
        'Enter template name:',
        '',
        'Save Template',
        'prompt'
      );
      
      if (!templateName) return;
      setEditingTemplateName(templateName);
    }
    
    try {
      const templateData = {
        name: editingTemplateName,
        structure: droppedItems,
        productDetails: productDetails,
        userId: user._id || user.id,
        description: `Custom template: ${editingTemplateName}`,
        isBuiltIn: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await Meteor.callAsync('templates.save', templateData);
      showSuccess(`Template "${editingTemplateName}" saved successfully!`);
      
    } catch (error) {
      console.error('Error saving template:', error);
      showError('Failed to save template: ' + error.message);
    }
  }, [editingTemplateName, droppedItems, productDetails, user, showAlert, showSuccess, showError]);

  const handleTemplateLoad = useCallback((template) => {
    console.log('StructuredProductInterface: Loading template:', template.name);
    
    setSelectedTemplateId(template._id); // Highlight the selected template
    
    // Load the template structure - check both structure and droppedItems
    const templateStructure = template.structure || template.droppedItems;
    if (templateStructure && templateStructure.length > 0) {
      console.log('Loading template structure with', templateStructure.length, 'components');
      
      // Convert array structure to object structure expected by new interface
      if (Array.isArray(templateStructure)) {
        const structureBySection = {
          life: [],
          maturity: [],
          quarterly: [],
          setup: []
        };
        
        templateStructure.forEach(item => {
          const section = item.column || item.section || 'setup';
          if (!structureBySection[section]) {
            structureBySection[section] = [];
          }
          structureBySection[section].push(item);
        });
        
        setDroppedItems(structureBySection);
      } else {
        setDroppedItems(templateStructure);
      }
      
      // Switch directly to Structure tab to configure parameters
      setActiveTab('structure');
    }
    
    if (template.productDetails) {
      setProductDetails(prev => ({
        ...prev,
        ...template.productDetails
      }));
    }
    
    // Initialize template-specific parameters
    const templateDefaults = getTemplateDefaults(template._id);
    console.log('Setting template-specific parameters for', template._id, ':', templateDefaults);
    setStructureParams(templateDefaults);
    
  }, []);

  // Get session ID for API calls
  const getSessionId = () => localStorage.getItem('sessionId');

  // Handle term sheet extraction success
  const handleTermSheetExtracted = useCallback(async (productId, extractedData) => {
    console.log('StructuredProductInterface: Term sheet extracted successfully, productId:', productId);

    try {
      // Fetch the full product from database to get all fields
      const product = await ProductsCollection.findOneAsync({ _id: productId });

      if (!product) {
        showError('Failed to load extracted product');
        return;
      }

      // Load the extracted product data into the interface
      // This is similar to loading an editingProduct

      // Load basic product details
      setProductDetails({
        title: product.title || '',
        isin: product.isin || '',
        issuer: product.issuer || '',
        currency: product.currency || 'USD',
        tradeDate: product.tradeDate || '',
        valueDate: product.valueDate || '',
        finalObservation: product.finalObservation || product.finalObservationDate || '',
        maturity: product.maturity || product.maturityDate || '',
        productFamily: product.productFamily || '',
        notional: product.notional || 100,
        denomination: product.denomination || 1000,
        couponFrequency: product.couponFrequency || 'quarterly',
        underlyingMode: product.underlyingMode || 'single'
      });

      // Load structure if it exists
      if (product.structure) {
        console.log('Loading extracted product structure');
        setDroppedItems(product.structure);
      }

      // Load underlyings and fetch current market prices
      if (product.underlyings) {
        // First, set the underlyings with their strike prices
        const underlyingsWithStrikes = product.underlyings.map(u => ({
          ...u,
          // Ensure securityData exists but clear price field (we'll fetch fresh)
          securityData: u.securityData ? {
            ...u.securityData,
            price: null  // Clear price so we fetch fresh market data
          } : null
        }));

        setUnderlyings(underlyingsWithStrikes);

        if (product.underlyings.length > 1) {
          setBasketMode('basket');
        }

        // Fetch current market prices for each underlying
        product.underlyings.forEach(async (underlying, index) => {
          if (underlying.securityData) {
            try {
              const symbol = underlying.securityData.symbol || underlying.ticker;
              const exchange = underlying.securityData.exchange;

              // Fetch real-time price
              const priceData = await Meteor.callAsync('eod.getRealTimePrice', symbol, exchange);
              let lastPrice = 0;

              if (priceData) {
                if (typeof priceData === 'number') {
                  lastPrice = priceData;
                } else {
                  lastPrice = priceData.close || priceData.price || priceData.last || 0;
                }
              }

              // Update the underlying with the fetched price
              if (lastPrice > 0) {
                setUnderlyings(prev => prev.map((u, i) =>
                  i === index ? {
                    ...u,
                    securityData: {
                      ...u.securityData,
                      price: { close: lastPrice, price: lastPrice }
                    }
                  } : u
                ));
              }
            } catch (error) {
              console.error(`Failed to fetch price for ${underlying.ticker}:`, error);
            }
          }
        });
      }

      // Load schedule configuration ONLY (not observation schedule)
      // The ScheduleBuilder will auto-generate the observation schedule from scheduleConfig
      // This ensures isCallable and other fields are properly set
      if (product.scheduleConfig) {
        setScheduleConfig(product.scheduleConfig);
        // DO NOT load observationSchedule - let ScheduleBuilder generate it from scheduleConfig
      } else if (product.observationSchedule) {
        // Fallback for older products without scheduleConfig
        setObservationSchedule(product.observationSchedule);
      }

      if (product.maturity || product.maturityDate) {
        setMaturityDate(product.maturity || product.maturityDate);
      }

      // Load final observation date
      let finalObsDate = product.finalObservation || product.finalObservationDate;
      if (!finalObsDate && product.observationSchedule && product.observationSchedule.length > 0) {
        const lastObservation = product.observationSchedule[product.observationSchedule.length - 1];
        if (lastObservation && (lastObservation.observationDate || lastObservation.date)) {
          finalObsDate = lastObservation.observationDate || lastObservation.date;
        }
      }

      if (finalObsDate) {
        setFinalObservationDate(finalObsDate);
      }

      // Load template ID
      if (product.templateId) {
        setSelectedTemplateId(product.templateId);
      } else if (product.template) {
        setSelectedTemplateId(product.template);
      }

      // Load structure parameters
      if (product.structureParams) {
        setStructureParams(product.structureParams);
      }

      // Show success message and stay on setup tab
      showSuccess('Term sheet extracted successfully! The product details have been populated below.');

      // Collapse the term sheet uploader and stay on setup tab
      setIsTermSheetExpanded(false);

    } catch (error) {
      console.error('Error loading extracted product:', error);
      showError('Failed to load extracted product: ' + error.message);
    }
  }, [showError, showSuccess, handleTabChange]);

  // Auto-generate product title based on underlyings and parameters
  const generateProductTitle = useCallback(() => {
    try {
      const parts = [];

      // 1. Add underlyings
      if (underlyings && underlyings.length > 0) {
        const symbols = underlyings.map(u => u.symbol || u.ticker).filter(Boolean);
        if (symbols.length > 0) {
          if (symbols.length === 1) {
            parts.push(symbols[0]);
          } else if (symbols.length <= 3) {
            parts.push(symbols.join('/'));
          } else {
            parts.push(`${symbols.slice(0, 2).join('/')}+${symbols.length - 2}`);
          }
        }
      }

      // 2. Add template type or product type
      const templateName = selectedTemplateId || productDetails.template || productDetails.templateId;
      if (templateName) {
        const displayName = templateName
          .replace(/_/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
        parts.push(displayName);
      }

      return parts.length > 0 ? parts.join(' ') : 'New Structured Product';
    } catch (error) {
      console.error('Error generating product title:', error);
      return 'New Structured Product';
    }
  }, [underlyings, selectedTemplateId, productDetails]);

  // Auto-update title when key fields change (only for new products, not editing)
  useEffect(() => {
    if (!editingProduct && (!productDetails.title || productDetails.title === 'Untitled Product' || productDetails.title === 'New Structured Product')) {
      const generatedTitle = generateProductTitle();
      if (generatedTitle && generatedTitle !== 'New Structured Product') {
        handleUpdateProductDetails('title', generatedTitle);
      }
    }
  }, [underlyings, selectedTemplateId, structureParams, maturityDate, editingProduct, generateProductTitle]);

  // Save product handler
  const handleSaveProduct = useCallback(async () => {
    console.log('StructuredProductInterface: Saving product');
    
    // Validation
    if (!productDetails.isin) {
      showError('ISIN is required to save the product.');
      return;
    }
    
    // Convert droppedItems structure to flat payoffStructure array for validation
    const payoffStructure = [];
    console.log('[DEBUG] droppedItems structure:', droppedItems);
    Object.keys(droppedItems).forEach(sectionKey => {
      if (droppedItems[sectionKey] && Array.isArray(droppedItems[sectionKey])) {
        console.log(`[DEBUG] Processing section '${sectionKey}' with ${droppedItems[sectionKey].length} items`);
        droppedItems[sectionKey].forEach(item => {
          // Use the item's section property if it exists, otherwise use the sectionKey
          // This ensures components maintain their correct section assignment
          const section = item.section || sectionKey;
          console.log(`[DEBUG] Item type: ${item.type}, item.section: ${item.section}, sectionKey: ${sectionKey}, assigned section: ${section}`);
          payoffStructure.push({
            ...item,
            section: section,
            column: item.column || 'condition' // Ensure column is set for proper grouping
          });
        });
      }
    });
    console.log('[DEBUG] Final payoffStructure:', payoffStructure.map(p => ({ type: p.type, section: p.section, column: p.column })));
    
    try {
      const sessionId = getSessionId();

      // Always generate title from product structure
      const finalTitle = generateProductTitle();

      const productData = {
        ...productDetails,
        // Ensure required fields for validation are present
        title: finalTitle,
        maturityDate: maturityDate || productDetails.maturity || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Default to 1 year if no maturity set
        maturity: maturityDate || productDetails.maturity || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Provide both formats for compatibility
        // Map structure data to expected validation format
        structure: droppedItems,
        payoffStructure: payoffStructure,
        underlyings: underlyings,
        observationSchedule: observationSchedule,
        finalObservation: finalObservationDate,
        finalObservationDate: finalObservationDate, // Save both field names for compatibility
        firstObservation: firstObservationDate,
        basketMode: basketMode,
        // Save structure and schedule configuration parameters
        structureParams: structureParams,
        scheduleConfig: scheduleConfig,
        // Save template ID for future editing
        templateId: selectedTemplateId,
        template: selectedTemplateId, // Save both field names for compatibility
        createdAt: editingProduct ? editingProduct.createdAt : new Date(),
        updatedAt: new Date()
      };
      
      let result;
      if (editingProduct) {
        // Update existing product
        result = await Meteor.callAsync('products.update', editingProduct._id, productData, sessionId);
        showSuccess('Product updated successfully!');
      } else {
        // Create new product
        result = await Meteor.callAsync('products.save', productData, sessionId);
        showSuccess('Product created successfully!');
      }
      
      console.log('Product saved with ID:', result);
      
      if (onSave) {
        onSave();
      }
      
    } catch (error) {
      console.error('Error saving product:', error);
      showError('Failed to save product: ' + error.message);
    }
  }, [productDetails, droppedItems, underlyings, observationSchedule, maturityDate, finalObservationDate, firstObservationDate, basketMode, structureParams, scheduleConfig, editingProduct, onSave, showError, showSuccess]);

  // Get unique row indices for a section
  const getRowIndices = useCallback((section) => {
    const items = droppedItems[section] || [];
    const rowIndices = [...new Set(items.map(item => item.rowIndex || 0))];
    return rowIndices.sort((a, b) => a - b);
  }, [droppedItems]);

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'setup':
        return (
          <div className="setup-tab">
            {/* Term Sheet Uploader - Collapsible */}
            <div style={{
              marginBottom: '2rem',
              background: 'var(--bg-secondary)',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              overflow: 'hidden'
            }}>
              {/* Collapsible Header */}
              <div
                onClick={() => setIsTermSheetExpanded(!isTermSheetExpanded)}
                style={{
                  padding: '1.5rem 2rem',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: isTermSheetExpanded ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (!isTermSheetExpanded) {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isTermSheetExpanded) {
                    e.currentTarget.style.background = 'var(--bg-secondary)';
                  }
                }}
              >
                <div>
                  <h2 style={{
                    margin: '0 0 0.25rem 0',
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    📄 Extract from Term Sheet
                  </h2>
                  <p style={{
                    margin: 0,
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)'
                  }}>
                    Upload a PDF to automatically extract product details
                  </p>
                </div>
                <div style={{
                  fontSize: '1.5rem',
                  color: 'var(--text-secondary)',
                  transition: 'transform 0.2s',
                  transform: isTermSheetExpanded ? 'rotate(180deg)' : 'rotate(0deg)'
                }}>
                  ▼
                </div>
              </div>

              {/* Collapsible Content */}
              {isTermSheetExpanded && (
                <div style={{
                  padding: '0 2rem 2rem 2rem',
                  borderTop: '1px solid var(--border-color)'
                }}>
                  <div style={{ paddingTop: '1.5rem' }}>
                    <TermSheetUploader
                      onProductExtracted={handleTermSheetExtracted}
                      sessionId={getSessionId()}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            {!isTermSheetExpanded && (
              <div style={{
                margin: '2rem 0',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem'
              }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                <span style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Product Details
                </span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
              </div>
            )}

            {/* Product Details Card */}
            <ProductDetailsCard
              productDetails={productDetails}
              onUpdateProductDetails={handleUpdateProductDetails}
              onRegenerateTitle={() => {}}
              editingProduct={editingProduct}
            />
          </div>
        );

      case 'underlyings':
        return (
          <div className="underlyings-tab">
            <UnderlyingCreationModule
              underlyings={underlyings}
              setUnderlyings={setUnderlyings}
              basketMode={basketMode}
              onBasketModeChange={handleUnderlyingModeChange}
              productDetails={productDetails}
              basketPerformanceType={basketPerformanceType}
              setBasketPerformanceType={setBasketPerformanceType}
              editingProduct={editingProduct}
              selectedTemplateId={selectedTemplateId}
            />
          </div>
        );

      case 'structure':
        return (
          <StructureModule 
            selectedTemplateId={selectedTemplateId}
            structureParams={structureParams}
            onParamChange={handleStructureParamChange}
          />
        );

      case 'schedule':
        return (
          <ScheduleBuilder
            productDetails={productDetails}
            scheduleConfig={scheduleConfig}
            onUpdateSchedule={handleScheduleChange}
            onConfigChange={handleScheduleConfigChange}
            selectedTemplateId={selectedTemplateId}
            underlyings={underlyings}
          />
        );

      case 'summary':
        return (
          <SummaryModule
            selectedTemplateId={selectedTemplateId}
            productDetails={productDetails}
            underlyings={underlyings}
            observationSchedule={observationSchedule}
            droppedItems={droppedItems}
            basketMode={basketMode}
            structureParams={structureParams}
            onSaveProduct={handleSaveProduct}
            editingProduct={editingProduct}
          />
        );

      default:
        return (
          <div>
            {/* Template Selection */}
            <TemplateSelector
              onTemplateSelect={handleTemplateLoad}
              user={user}
              onTemplateLoad={handleTemplateLoad}
              onTemplateNew={handleTemplateNew}
              selectedTemplateId={selectedTemplateId}
            />
          </div>
        );
    }
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="app" style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        
        {/* Header */}
        <div style={{
          background: 'var(--bg-secondary)',
          padding: '1rem 2rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ margin: 0, color: 'var(--text-primary)' }}>
            {editingProduct ? (
              <>✏️ Edit Product: {editingProduct.title || editingProduct.productName || 'Untitled'}</>
            ) : (
              '➕ Create New Product'
            )}
          </h1>

          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{
          background: 'var(--bg-secondary)',
          borderBottom: '2px solid var(--border-color)',
          padding: '0 2rem',
          position: 'sticky',
          top: 0,
          zIndex: 99
        }}>
          <div style={{
            display: 'flex',
            gap: '0',
            alignItems: 'center'
          }}>
            {[
              { id: 'setup', label: 'Setup', icon: '⚙️' },
              { id: 'template', label: 'Template', icon: '📋' },
              { id: 'structure', label: 'Structure', icon: '🏗️' },
              { id: 'underlyings', label: 'Underlyings', icon: '📈' },
              { id: 'schedule', label: 'Schedule', icon: '📅', hideFor: ['orion_memory', 'shark_note'] },
              { id: 'summary', label: 'Summary', icon: '📊' }
            ].filter(tab => !tab.hideFor || !tab.hideFor.includes(selectedTemplateId)).map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                style={{
                  padding: '1rem 1.5rem',
                  background: activeTab === tab.id ? 'var(--bg-primary)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none',
                  borderBottom: activeTab === tab.id ? '3px solid var(--accent-color)' : '3px solid transparent',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: activeTab === tab.id ? '600' : '500',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  position: 'relative'
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab.id) {
                    e.target.style.background = 'var(--bg-tertiary)';
                    e.target.style.color = 'var(--text-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab.id) {
                    e.target.style.background = 'transparent';
                    e.target.style.color = 'var(--text-secondary)';
                  }
                }}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.badge && (
                  <span style={{
                    background: 'var(--accent-color)',
                    color: 'white',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontWeight: '600',
                    marginLeft: '0.5rem'
                  }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Template badge in tab area */}
          {selectedTemplateId && (
            <div style={{
              padding: '1rem 2rem',
              background: 'var(--bg-primary)',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem'
            }}>
              <span style={{
                fontSize: '0.9rem',
                color: 'var(--text-secondary)',
                fontWeight: '500'
              }}>
                Current Template:
              </span>
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '0.5rem 1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.9rem',
                color: 'var(--text-primary)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                <span style={{ fontSize: '1.1rem' }}>
                  {BUILT_IN_TEMPLATES.find(t => t._id === selectedTemplateId)?.icon}
                </span>
                <span style={{ fontWeight: '600' }}>
                  {BUILT_IN_TEMPLATES.find(t => t._id === selectedTemplateId)?.name}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Tab Content */}
        <div className="tab-content" style={{ padding: '2rem' }}>
          {renderTabContent()}
        </div>

        {/* Dialog */}
        {dialogState.isOpen && (
          <Dialog
            isOpen={dialogState.isOpen}
            onClose={hideDialog}
            title={dialogState.title}
            message={dialogState.message}
            type={dialogState.type}
            onConfirm={dialogState.onConfirm}
            onCancel={dialogState.onCancel}
            confirmText={dialogState.confirmText}
            cancelText={dialogState.cancelText}
            showCancel={dialogState.showCancel}
          >
            {dialogState.children}
          </Dialog>
        )}
      </div>
    </DndProvider>
  );
};

export default StructuredProductInterface;