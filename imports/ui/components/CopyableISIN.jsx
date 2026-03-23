import React, { useState } from 'react';

const CopyableISIN = ({ isin, style = {}, prefix = '' }) => {
  const [copied, setCopied] = useState(false);

  if (!isin) return null;

  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(isin);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span
      onClick={handleCopy}
      title="Click to copy ISIN"
      style={{ cursor: 'pointer', position: 'relative', ...style }}
    >
      {prefix}{isin}
      {copied && (
        <span style={{
          position: 'absolute',
          top: '-28px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#10b981',
          color: '#fff',
          fontSize: '0.7rem',
          fontWeight: '600',
          padding: '3px 8px',
          borderRadius: '4px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          animation: 'fadeIn 0.15s ease'
        }}>
          ISIN copied
        </span>
      )}
    </span>
  );
};

export default CopyableISIN;
