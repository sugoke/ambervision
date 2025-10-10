// Shared date formatting utilities

// Helper function to format date as DD/MM/YYYY
export const formatDateForDisplay = (dateString, showNotSpecified = true) => {
  if (!dateString) return showNotSpecified ? 'Not specified' : '';
  try {
    const date = new Date(dateString + (dateString.includes('T') ? '' : 'T00:00:00'));
    if (isNaN(date.getTime())) return dateString;
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (e) {
    return dateString;
  }
};

// Smart date formatting function for input
export const formatDateInput = (value) => {
  // Remove all non-numeric characters
  const numbers = value.replace(/\D/g, '');
  
  // Don't format if empty
  if (!numbers) return '';
  
  // Auto-format as user types: DDMMYYYY -> DD/MM/YYYY
  if (numbers.length <= 2) {
    return numbers;
  } else if (numbers.length <= 4) {
    return `${numbers.slice(0, 2)}/${numbers.slice(2)}`;
  } else if (numbers.length <= 8) {
    return `${numbers.slice(0, 2)}/${numbers.slice(2, 4)}/${numbers.slice(4)}`;
  } else {
    // Limit to 8 digits max
    return `${numbers.slice(0, 2)}/${numbers.slice(2, 4)}/${numbers.slice(4, 8)}`;
  }
};

// Format date for input fields (YYYY-MM-DD)
export const formatDateForInput = (date) => {
  if (!date) return '';
  return date.toISOString().split('T')[0];
};