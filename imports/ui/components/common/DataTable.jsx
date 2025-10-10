import React, { useState } from 'react';
import LoadingSpinner from './LoadingSpinner.jsx';

/**
 * DataTable - Reusable data table component with sorting, filtering, and pagination
 * 
 * @param {Object} props
 * @param {Array} props.columns - Column definitions: [{ field, label, width, sortable, render }]
 * @param {Array} props.data - Table data
 * @param {boolean} props.loading - Loading state
 * @param {Function} props.onSort - Sort handler (field, direction)
 * @param {Function} props.onRowClick - Row click handler
 * @param {string} props.sortField - Current sort field
 * @param {string} props.sortDirection - Current sort direction ('asc' or 'desc')
 * @param {React.ReactNode} props.emptyState - Custom empty state content
 * @param {boolean} props.striped - Alternating row colors
 * @param {boolean} props.hoverable - Row hover effects
 * @param {Object} props.style - Additional styles
 */
const DataTable = ({
  columns = [],
  data = [],
  loading = false,
  onSort,
  onRowClick,
  sortField,
  sortDirection,
  emptyState,
  striped = true,
  hoverable = true,
  style = {},
  ...props
}) => {
  const [localSortField, setLocalSortField] = useState(sortField);
  const [localSortDirection, setLocalSortDirection] = useState(sortDirection || 'asc');

  const handleSort = (field) => {
    if (!columns.find(col => col.field === field)?.sortable) return;

    let newDirection = 'asc';
    if (localSortField === field && localSortDirection === 'asc') {
      newDirection = 'desc';
    }

    setLocalSortField(field);
    setLocalSortDirection(newDirection);

    if (onSort) {
      onSort(field, newDirection);
    }
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    background: 'var(--bg-primary)',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid var(--border-color)',
    ...style
  };

  const headerStyle = {
    background: 'var(--bg-tertiary)',
    borderBottom: '1px solid var(--border-color)'
  };

  const headerCellStyle = {
    padding: '14px 16px',
    textAlign: 'left',
    fontSize: '0.8rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.75px',
    userSelect: 'none'
  };

  const sortableHeaderStyle = {
    ...headerCellStyle,
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  };

  const bodyCellStyle = {
    padding: '12px 16px',
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border-color)'
  };

  const rowStyle = (index, isLast) => ({
    borderBottom: isLast ? 'none' : '1px solid var(--border-color)',
    background: striped && index % 2 === 1 ? 'var(--bg-secondary)' : 'transparent',
    transition: hoverable ? 'background-color 0.2s ease' : 'none',
    cursor: onRowClick ? 'pointer' : 'default'
  });

  const getSortIcon = (field) => {
    if (localSortField !== field) return '';
    return localSortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  const renderEmptyState = () => {
    if (emptyState) return emptyState;
    
    return (
      <tr>
        <td 
          colSpan={columns.length} 
          style={{
            ...bodyCellStyle,
            textAlign: 'center',
            padding: '3rem',
            color: 'var(--text-secondary)'
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}>📁</div>
          <div>No data available</div>
        </td>
      </tr>
    );
  };

  const renderLoadingState = () => (
    <tr>
      <td 
        colSpan={columns.length} 
        style={{
          ...bodyCellStyle,
          textAlign: 'center',
          padding: '3rem'
        }}
      >
        <LoadingSpinner size="medium" text="Loading data..." center />
      </td>
    </tr>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle} {...props}>
        <thead>
          <tr style={headerStyle}>
            {columns.map((column) => (
              <th
                key={column.field}
                style={{
                  ...(column.sortable ? sortableHeaderStyle : headerCellStyle),
                  width: column.width,
                  textAlign: column.align || 'left'
                }}
                onClick={() => column.sortable && handleSort(column.field)}
                onMouseEnter={column.sortable ? (e) => {
                  e.currentTarget.style.color = 'var(--accent-color)';
                  e.currentTarget.style.background = 'rgba(0, 123, 255, 0.05)';
                } : undefined}
                onMouseLeave={column.sortable ? (e) => {
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.background = 'transparent';
                } : undefined}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {column.label}
                  {column.sortable && (
                    <span style={{ fontSize: '0.7rem' }}>
                      {getSortIcon(column.field) || '⇅'}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            renderLoadingState()
          ) : data.length === 0 ? (
            renderEmptyState()
          ) : (
            data.map((row, index) => (
              <tr
                key={row.id || row._id || index}
                style={rowStyle(index, index === data.length - 1)}
                onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                onMouseEnter={hoverable && onRowClick ? (e) => {
                  e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                } : undefined}
                onMouseLeave={hoverable && onRowClick ? (e) => {
                  e.currentTarget.style.backgroundColor = 
                    striped && index % 2 === 1 ? 'var(--bg-secondary)' : 'transparent';
                } : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.field}
                    style={{
                      ...bodyCellStyle,
                      textAlign: column.align || 'left'
                    }}
                  >
                    {column.render 
                      ? column.render(row[column.field], row, index)
                      : row[column.field]
                    }
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DataTable;