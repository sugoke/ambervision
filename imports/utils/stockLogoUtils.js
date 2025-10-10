import React from 'react';
import { Meteor } from 'meteor/meteor';

// Utility for getting stock/company logos

/**
 * Get stock logo URL for a given symbol
 * @param {string} symbol - Stock symbol (e.g., 'AAPL', 'TSLA')
 * @returns {string} - Logo URL
 */
export const getStockLogoUrl = (symbol) => {
  if (!symbol) return null;

  // Clean the symbol (remove any exchange suffixes)
  const cleanSymbol = symbol.split('.')[0].toUpperCase();

  // Use Logo.dev service for stock logos (free tier)
  const logoToken = Meteor.settings.private?.LOGO_DEV_API_TOKEN || 'pk_X-1ZO13ESgeOdMsIFIS9Tw';
  return `https://img.logo.dev/${cleanSymbol}.com?token=${logoToken}&format=png&size=64`;
};

/**
 * Stock logo component with fallback
 * @param {string} symbol - Stock symbol
 * @param {string} companyName - Company name for alt text
 * @param {object} style - Custom styles
 */
export const StockLogo = ({ symbol, companyName, style = {} }) => {
  const defaultStyle = {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    marginRight: '8px',
    objectFit: 'contain',
    backgroundColor: '#f5f5f5',
    border: '1px solid #e0e0e0'
  };

  const combinedStyle = { ...defaultStyle, ...style };
  
  if (!symbol) return null;

  return (
    <img
      src={getStockLogoUrl(symbol)}
      alt={`${companyName || symbol} logo`}
      style={combinedStyle}
      onError={(e) => {
        // Fallback to a generic icon or first letter
        e.target.style.display = 'none';
        e.target.nextSibling.style.display = 'flex';
      }}
      onLoad={(e) => {
        // Hide fallback if image loads successfully
        if (e.target.nextSibling) {
          e.target.nextSibling.style.display = 'none';
        }
      }}
    />
  );
};

/**
 * Fallback icon when logo fails to load
 */
export const StockLogoFallback = ({ symbol, style = {} }) => {
  const defaultStyle = {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    marginRight: '8px',
    backgroundColor: '#6c757d',
    color: 'white',
    display: 'none', // Hidden by default, shown when main logo fails
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 'bold'
  };

  const combinedStyle = { ...defaultStyle, ...style };
  
  if (!symbol) return null;

  const letter = symbol.charAt(0).toUpperCase();

  return (
    <div style={combinedStyle}>
      {letter}
    </div>
  );
};