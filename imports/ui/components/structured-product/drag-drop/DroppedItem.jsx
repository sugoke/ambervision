import React, { useState, useEffect, useRef } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { ItemTypes } from '../ItemTypes';

const DroppedItem = ({ item, index, onUpdate, onRemove, onReorder, column, onAddNestedLogic, rowIndex = 0, availableBaskets = [] }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(item.value || item.defaultValue || '');
  const [selectedBasketId, setSelectedBasketId] = useState(item.selectedBasketId || '');
  
  // Update local value when item.value changes from external sources (like EditableParametersCard)
  useEffect(() => {
    setValue(item.value || item.defaultValue || '');
  }, [item.value, item.defaultValue]);
  
  const ref = useRef(null);

  const [{ isDragging }, drag] = useDrag({
    type: ItemTypes.DROPPED_ITEM,
    item: () => {
      const dragItem = { ...item, index, column };
      return dragItem;
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [{ isOver }, drop] = useDrop({
    accept: ItemTypes.DROPPED_ITEM,
    drop: (draggedItem, monitor) => {
      if (!draggedItem || draggedItem.column !== column) return;
      
      const dragIndex = draggedItem.index;
      const hoverIndex = index;
      
      // Don't replace items with themselves
      if (dragIndex === hoverIndex) return;
      
      // Perform the reorder
      onReorder(dragIndex, hoverIndex, column);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  const handleDoubleClick = () => {
    if (item.type === ItemTypes.COUPON || (item.type === ItemTypes.BARRIER && item.label !== 'Autocall Level') || item.type === ItemTypes.STRIKE || 
        item.type === ItemTypes.LEVERAGE || item.type === ItemTypes.VARIABLE || item.type === ItemTypes.MEMORY || item.type === ItemTypes.ACTION ||
        item.type === ItemTypes.AMERICAN_BARRIER || item.type === ItemTypes.STEPDOWN ||
        item.type === ItemTypes.DYNAMIC_COUPON || item.type === ItemTypes.RANGE_ACCRUAL || item.type === ItemTypes.CALLABLE ||
        item.type === ItemTypes.PARTICIPATION ||
        ((item.type === ItemTypes.BASKET || item.type === ItemTypes.UNDERLYING || item.type === ItemTypes.COMPARISON) && item.configurable)) {
      setIsEditing(true);
    }
  };

  const handleSave = () => {
    setIsEditing(false);
    console.log('💾 Saving item:', { id: item.id, type: item.type, value, selectedBasketId });
    onUpdate(item.id, { ...item, value, selectedBasketId });
  };

  const handleBasketSelection = (basketId) => {
    setSelectedBasketId(basketId);
    onUpdate(item.id, { ...item, selectedBasketId: basketId });
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  const dragDropRef = (node) => {
    drag(drop(node));
    ref.current = node;
  };

  // Calculate tabIndex based on column order: timing=1, condition=2, action=3, continuation=4
  const getColumnTabOrder = (columnName) => {
    const columnOrder = { 'timing': 1, 'condition': 2, 'action': 3, 'continuation': 4 };
    return columnOrder[columnName] || 5;
  };

  const calculateTabIndex = () => {
    // Base tabIndex starts at 100 to leave room for other UI elements
    // Each row gets a range of 10, each column gets its position within that range
    const baseTabIndex = 100;
    const rowOffset = rowIndex * 10;
    const columnOffset = getColumnTabOrder(column);
    const itemOffset = index; // Position within the column
    return baseTabIndex + rowOffset + columnOffset + itemOffset;
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleDoubleClick();
    } else if (e.key === 'Delete' && !item.isDefault) {
      e.preventDefault();
      onRemove(item.id);
    }
  };

  const showNestedLogicButtons = item.type === ItemTypes.IF && column === 'condition';

  return (
    <div 
      ref={dragDropRef}
      className={`dropped-item ${isDragging ? 'dragging-item' : ''} ${isOver ? 'drop-hover' : ''} ${item.isDefault ? 'default-item' : ''}`}
      tabIndex={calculateTabIndex()}
      role="button"
      aria-label={`${item.type} in ${column} column. Double-click to edit, Delete key to remove`}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      style={{
        opacity: isDragging ? 0.5 : 1,
        cursor: 'move'
      }}
    >
      {!item.isDefault && <button className="remove-btn" onClick={() => onRemove(item.id)}>×</button>}
      <span className="drag-handle">⋮⋮</span>
      <span className="icon">{item.icon}</span>
      <span className="type-indicator">
        {item.label || item.type}
        {(item.value || value) && (item.type === ItemTypes.COUPON || 
         item.type === ItemTypes.STRIKE || item.type === ItemTypes.LEVERAGE || item.type === ItemTypes.PARTICIPATION ||
         (item.type === ItemTypes.ACTION && item.configurable)) && 
         ` (${item.value || value}${item.type === ItemTypes.LEVERAGE ? 'x' : '%'})`}
        {/* Show selected basket for BASKET and UNDERLYING types */}
        {(item.type === ItemTypes.BASKET || item.type === ItemTypes.UNDERLYING) && selectedBasketId && (
          <span style={{ fontSize: '0.8rem', color: 'var(--accent-color)', marginLeft: '0.5rem' }}>
            [{availableBaskets.find(b => b.id === selectedBasketId)?.name || 'Unknown Basket'}]
          </span>
        )}
      </span>
      {(item.type === ItemTypes.COUPON || item.type === ItemTypes.BARRIER || item.type === ItemTypes.STRIKE || 
        item.type === ItemTypes.LEVERAGE || item.type === ItemTypes.VARIABLE || item.type === ItemTypes.MEMORY || item.type === ItemTypes.ACTION ||
        item.type === ItemTypes.AMERICAN_BARRIER || item.type === ItemTypes.STEPDOWN ||
        item.type === ItemTypes.DYNAMIC_COUPON || item.type === ItemTypes.RANGE_ACCRUAL || item.type === ItemTypes.CALLABLE ||
        item.type === ItemTypes.PARTICIPATION ||
        (item.type === ItemTypes.BASKET && item.configurable)) && (
        <span className="value">
          {isEditing ? (
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={handleSave}
              onKeyPress={handleKeyPress}
              autoFocus
              className="value-input"
              placeholder={item.type === ItemTypes.BASKET || item.type === ItemTypes.UNDERLYING ? 'e.g., 3 or custom logic' : ''}
              style={{ 
                width: '60px', 
                padding: '2px 4px', 
                border: '1px solid #ccc', 
                borderRadius: '3px',
                textAlign: 'center'
              }}
            />
          ) : (
            <span onClick={() => setIsEditing(true)} className="editable-value">
              {value}{(item.type === ItemTypes.COUPON || item.type === ItemTypes.BARRIER || item.type === ItemTypes.STRIKE || item.type === ItemTypes.MEMORY || 
                      item.type === ItemTypes.AMERICAN_BARRIER || item.type === ItemTypes.STEPDOWN ||
                      item.type === ItemTypes.DYNAMIC_COUPON || item.type === ItemTypes.RANGE_ACCRUAL || item.type === ItemTypes.PARTICIPATION || 
                      item.type === ItemTypes.COMPARISON) ? '%' : 
                     (item.type === ItemTypes.LEVERAGE || item.type === ItemTypes.CALLABLE ? 'x' : '')}
            </span>
          )}
        </span>
      )}
      
      {/* Basket Selection for BASKET and UNDERLYING types */}
      {(item.type === ItemTypes.BASKET || item.type === ItemTypes.UNDERLYING) && availableBaskets.length > 0 && (
        <span className="basket-selection" style={{ marginLeft: '0.5rem' }}>
          <select
            value={selectedBasketId}
            onChange={(e) => handleBasketSelection(e.target.value)}
            style={{
              padding: '2px 4px',
              fontSize: '0.8rem',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              maxWidth: '120px'
            }}
          >
            <option value="">Select Basket</option>
            {availableBaskets.map(basket => (
              <option key={basket.id} value={basket.id}>
                {basket.name}
              </option>
            ))}
          </select>
        </span>
      )}
      
      {showNestedLogicButtons && (
        <div className="nested-logic-buttons">
          <button 
            className="nested-logic-btn" 
            onClick={() => onAddNestedLogic(item, 'ELSE IF')}
            title="Add ELSE IF"
          >
            + ELSE IF
          </button>
          <button 
            className="nested-logic-btn" 
            onClick={() => onAddNestedLogic(item, 'ELSE')}
            title="Add ELSE"
          >
            + ELSE
          </button>
        </div>
      )}
    </div>
  );
};

export default DroppedItem;