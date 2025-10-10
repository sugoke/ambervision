import React from 'react';

// CSV parser utility functions
const parseCSV = (csvText) => {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]);
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    const row = {};
    headers.forEach((header, index) => {
      row[header.toLowerCase().trim()] = values[index] || '';
    });
    data.push(row);
  }

  return data;
};

const parseCSVLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
};

// Excel parser using FileReader for basic Excel files
const parseExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        // For basic Excel parsing, we'll try to parse as CSV
        // In a real implementation, you'd use a library like xlsx
        const text = e.target.result;
        
        // Try to detect if it's actually a CSV disguised as Excel
        if (text.includes(',') || text.includes('\t')) {
          const csvData = parseCSV(text.replace(/\t/g, ','));
          resolve(csvData);
        } else {
          reject(new Error('Excel file format not supported. Please convert to CSV or use a simpler Excel format.'));
        }
      } catch (error) {
        reject(new Error('Failed to parse Excel file: ' + error.message));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read Excel file'));
    };
    
    reader.readAsText(file);
  });
};

// Main parser function
export const parseFileForPrices = async (file) => {
  const fileName = file.name.toLowerCase();
  let rawData = [];
  
  try {
    if (fileName.endsWith('.csv')) {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed to read CSV file'));
        reader.readAsText(file);
      });
      rawData = parseCSV(text);
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      rawData = await parseExcel(file);
    } else {
      throw new Error('Unsupported file format');
    }
    
    // Normalize the data structure for price uploads
    const normalizedData = normalizeUploadData(rawData);
    return normalizedData;
    
  } catch (error) {
    throw new Error(`File parsing error: ${error.message}`);
  }
};

// Normalize different data formats to expected structure
const normalizeUploadData = (rawData) => {
  if (!Array.isArray(rawData) || rawData.length === 0) {
    throw new Error('No data found in file');
  }
  
  const normalizedData = [];
  const errors = [];
  
  rawData.forEach((row, index) => {
    try {
      const normalizedRow = normalizeRow(row, index + 1);
      if (normalizedRow) {
        normalizedData.push(normalizedRow);
      }
    } catch (error) {
      errors.push(`Row ${index + 1}: ${error.message}`);
    }
  });
  
  if (errors.length > 0 && normalizedData.length === 0) {
    throw new Error('No valid data rows found:\n' + errors.join('\n'));
  }
  
  return {
    data: normalizedData,
    errors: errors,
    summary: {
      totalRows: rawData.length,
      validRows: normalizedData.length,
      errorRows: errors.length
    }
  };
};

// Normalize a single row to expected format
const normalizeRow = (row, rowNumber) => {
  if (!row || typeof row !== 'object') {
    throw new Error('Invalid row data');
  }
  
  // Try to find ISIN field (case insensitive, multiple possible names)
  const isinField = findField(row, ['isin', 'isin_code', 'instrument', 'security_id', 'id']);
  if (!isinField) {
    throw new Error('ISIN field not found (expected columns: isin, isin_code, instrument, security_id, or id)');
  }
  
  // Try to find price field
  const priceField = findField(row, ['price', 'last_price', 'close_price', 'market_price', 'value', 'amount']);
  if (!priceField) {
    throw new Error('Price field not found (expected columns: price, last_price, close_price, market_price, value, or amount)');
  }
  
  // Try to find date field
  const dateField = findField(row, ['date', 'price_date', 'trade_date', 'market_date', 'timestamp', 'as_of_date']);
  
  // Try to find currency field (optional)
  const currencyField = findField(row, ['currency', 'ccy', 'curr', 'price_currency']);
  
  // Extract values
  const isin = String(isinField.value || '').trim().toUpperCase();
  const price = parseFloat(priceField.value);
  const currency = currencyField ? String(currencyField.value || '').trim().toUpperCase() : 'USD';
  
  // Handle date
  let priceDate = new Date();
  if (dateField && dateField.value) {
    priceDate = parseDate(dateField.value);
    if (isNaN(priceDate.getTime())) {
      throw new Error(`Invalid date format: ${dateField.value}`);
    }
  }
  
  // Validate required fields
  if (!isin) {
    throw new Error('ISIN is required');
  }
  
  if (isNaN(price) || price <= 0) {
    throw new Error(`Invalid price: ${priceField.value}`);
  }
  
  // Collect any additional metadata
  const metadata = {};
  Object.keys(row).forEach(key => {
    const lowerKey = key.toLowerCase();
    if (!['isin', 'price', 'date', 'currency'].some(field => 
      lowerKey.includes(field) || field.includes(lowerKey)
    )) {
      metadata[key] = row[key];
    }
  });
  
  return {
    isin,
    price,
    currency,
    priceDate,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  };
};

// Helper function to find a field by multiple possible names
const findField = (row, possibleNames) => {
  const keys = Object.keys(row);
  
  for (const name of possibleNames) {
    // Exact match (case insensitive)
    const exactMatch = keys.find(key => key.toLowerCase() === name.toLowerCase());
    if (exactMatch) {
      return { key: exactMatch, value: row[exactMatch] };
    }
    
    // Partial match (field contains the name)
    const partialMatch = keys.find(key => 
      key.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(key.toLowerCase())
    );
    if (partialMatch) {
      return { key: partialMatch, value: row[partialMatch] };
    }
  }
  
  return null;
};

// Parse various date formats
const parseDate = (dateValue) => {
  if (!dateValue) return new Date();
  
  // If it's already a Date object
  if (dateValue instanceof Date) {
    return dateValue;
  }
  
  const dateStr = String(dateValue).trim();
  
  // Try various date formats
  const formats = [
    // ISO formats
    /^\d{4}-\d{2}-\d{2}$/,           // 2023-12-01
    /^\d{4}-\d{2}-\d{2}T/,           // 2023-12-01T...
    
    // US formats
    /^\d{1,2}\/\d{1,2}\/\d{4}$/,     // 12/1/2023 or 1/12/2023
    /^\d{1,2}-\d{1,2}-\d{4}$/,       // 12-1-2023 or 1-12-2023
    
    // European formats
    /^\d{1,2}\.\d{1,2}\.\d{4}$/,     // 1.12.2023
    
    // Excel date serial numbers (approximate)
    /^\d{5}$/                        // 44927 (Excel serial)
  ];
  
  // Try parsing directly first
  let date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  // Try Excel serial number conversion (rough approximation)
  if (/^\d{5}$/.test(dateStr)) {
    const serial = parseInt(dateStr);
    if (serial > 25000 && serial < 100000) { // Reasonable range
      date = new Date(1900, 0, serial - 1); // Excel epoch
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }
  
  // If all else fails, return current date
  console.warn(`Could not parse date: ${dateStr}, using current date`);
  return new Date();
};

// Utility component for displaying parse results
export const ParseResultSummary = ({ result }) => {
  if (!result) return null;
  
  const { data, errors, summary } = result;
  
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '8px',
      padding: '1.5rem',
      margin: '1rem 0'
    }}>
      <h4 style={{
        margin: '0 0 1rem 0',
        fontSize: '1.1rem',
        fontWeight: '600',
        color: 'var(--text-primary)'
      }}>
        Parse Results
      </h4>
      
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: '1rem',
        marginBottom: errors.length > 0 ? '1.5rem' : 0
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '1.2rem',
            fontWeight: '700',
            color: 'var(--text-primary)'
          }}>
            {summary.totalRows}
          </div>
          <div style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Total Rows
          </div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '1.2rem',
            fontWeight: '700',
            color: 'var(--success-color)'
          }}>
            {summary.validRows}
          </div>
          <div style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Valid Rows
          </div>
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '1.2rem',
            fontWeight: '700',
            color: summary.errorRows > 0 ? 'var(--danger-color)' : 'var(--text-muted)'
          }}>
            {summary.errorRows}
          </div>
          <div style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Error Rows
          </div>
        </div>
      </div>
      
      {errors.length > 0 && (
        <div>
          <h5 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '0.9rem',
            fontWeight: '600',
            color: 'var(--danger-color)'
          }}>
            Parsing Errors:
          </h5>
          <div style={{
            background: 'rgba(220, 53, 69, 0.1)',
            border: '1px solid rgba(220, 53, 69, 0.3)',
            borderRadius: '6px',
            padding: '0.75rem',
            fontSize: '0.85rem',
            color: 'var(--danger-color)',
            maxHeight: '200px',
            overflowY: 'auto'
          }}>
            {errors.slice(0, 10).map((error, index) => (
              <div key={index} style={{ marginBottom: '0.25rem' }}>
                {error}
              </div>
            ))}
            {errors.length > 10 && (
              <div style={{ fontStyle: 'italic', marginTop: '0.5rem' }}>
                ... and {errors.length - 10} more errors
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};