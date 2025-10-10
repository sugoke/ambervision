import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';

const TestInput = () => {
  const [symbol, setSymbol] = useState('SPY.US');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const testTickerCache = async () => {
    setLoading(true);
    try {
      // Test the ticker cache method
      Meteor.call('tickerCache.getPrices', [symbol], (error, response) => {
        if (error) {
          setResult({ error: error.message });
        } else {
          setResult(response);
        }
        setLoading(false);
      });
    } catch (err) {
      setResult({ error: err.message });
      setLoading(false);
    }
  };

  const testDirectAPI = async () => {
    setLoading(true);
    try {
      // Test direct EOD API call through a method
      Meteor.call('test.eodDirectCall', symbol, (error, response) => {
        if (error) {
          setResult({ error: error.message });
        } else {
          setResult(response);
        }
        setLoading(false);
      });
    } catch (err) {
      setResult({ error: err.message });
      setLoading(false);
    }
  };

  const clearCache = async () => {
    setLoading(true);
    try {
      Meteor.call('tickerCache.clear', symbol, (error, response) => {
        if (error) {
          setResult({ error: error.message });
        } else {
          setResult(response);
        }
        setLoading(false);
      });
    } catch (err) {
      setResult({ error: err.message });
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', margin: '20px' }}>
      <h3>Ticker Price Debug Tool</h3>
      
      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Enter symbol (e.g., SPY.US)"
          style={{
            padding: '10px',
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            marginRight: '10px',
            width: '200px'
          }}
        />
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={testTickerCache}
          disabled={loading}
          style={{
            padding: '10px 20px',
            marginRight: '10px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: 'var(--primary-color)',
            color: 'white',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          Test Ticker Cache
        </button>
        
        <button
          onClick={testDirectAPI}
          disabled={loading}
          style={{
            padding: '10px 20px',
            marginRight: '10px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: 'var(--success-color)',
            color: 'white',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          Test Direct API
        </button>
        
        <button
          onClick={clearCache}
          disabled={loading}
          style={{
            padding: '10px 20px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: 'var(--danger-color)',
            color: 'white',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          Clear Cache
        </button>
      </div>
      
      {loading && <p>Loading...</p>}
      
      {result && (
        <div style={{
          marginTop: '20px',
          padding: '15px',
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: '4px',
          fontFamily: 'monospace',
          fontSize: '12px',
          whiteSpace: 'pre-wrap',
          overflowX: 'auto'
        }}>
          {JSON.stringify(result, null, 2)}
        </div>
      )}
    </div>
  );
};

export default TestInput;