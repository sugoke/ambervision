import React from 'react';
import { useDrag } from 'react-dnd';

const DraggableItem = ({ type, label, icon, defaultValue }) => {
  const [{ isDragging }, drag] = useDrag({
    type: type,
    item: { type, label, icon, defaultValue },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  return (
    <div
      ref={drag}
      className={`draggable-item ${isDragging ? 'dragging' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={`Drag ${type} to add to timeline`}
      title={`Drag ${label} to add to timeline`}
      style={{
        opacity: isDragging ? 0.5 : 1,
        cursor: 'move',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        margin: '4px 0',
        backgroundColor: 'var(--bg-secondary, #f8f9fa)',
        border: '1px solid var(--border-color, #e9ecef)',
        borderRadius: '6px',
        fontSize: '14px',
        color: 'var(--text-primary, #212529)',
        transition: 'all 0.2s ease'
      }}
    >
      <span className="icon" style={{ fontSize: '16px' }}>{icon}</span>
      <span className="label" style={{ fontWeight: '500', color: 'var(--text-primary, #212529)' }}>{label}</span>
    </div>
  );
};

export default DraggableItem;