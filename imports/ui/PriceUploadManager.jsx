import React, { useState } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { ProductPricesCollection } from '/imports/api/productPrices';
import { Meteor } from 'meteor/meteor';
import FileUploadDropzone from './FileUploadDropzone.jsx';
import { parseFileForPrices, ParseResultSummary } from './ExcelCSVParser.jsx';

const PriceUploadManager = ({ user }) => {
  const [uploadStep, setUploadStep] = useState('upload'); // upload, preview, processing, complete
  const [selectedFile, setSelectedFile] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Subscribe to recent price uploads for history
  const pricesLoading = useSubscribe('recentPriceUploads', 10);
  const recentUploads = useFind(() => 
    ProductPricesCollection.find({}, { 
      sort: { uploadDate: -1 }, 
      limit: 10,
      fields: { source: 1, uploadDate: 1, uploadedBy: 1, isin: 1, price: 1, currency: 1 }
    })
  );

  const handleFileSelect = async (file) => {
    setError('');
    setSuccess('');
    setSelectedFile(file);
    
    try {
      setUploadStep('processing');
      const result = await parseFileForPrices(file);
      setParseResult(result);
      setUploadStep('preview');
    } catch (err) {
      setError(err.message);
      setUploadStep('upload');
      setSelectedFile(null);
    }
  };

  const handleConfirmUpload = async () => {
    if (!parseResult || !parseResult.data || parseResult.data.length === 0) {
      setError('No valid data to upload');
      return;
    }

    setUploadStep('processing');
    setUploadProgress({ current: 0, total: parseResult.data.length });
    
    try {
      // Upload data to server
      const result = await new Promise((resolve, reject) => {
        Meteor.call('productPrices.bulkUpload', {
          pricesData: parseResult.data,
          source: selectedFile.name,
          metadata: {
            originalRowCount: parseResult.summary.totalRows,
            validRowCount: parseResult.summary.validRows,
            errorRowCount: parseResult.summary.errorRows
          }
        }, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      setSuccess(`Successfully uploaded ${result.insertedCount} price records! ${result.duplicateCount} duplicates were skipped.`);
      setUploadStep('complete');
      
      // Reset after a delay
      setTimeout(() => {
        resetUpload();
      }, 5000);

    } catch (err) {
      setError(err.reason || err.message || 'Upload failed');
      setUploadStep('preview');
    }
  };

  const resetUpload = () => {
    setUploadStep('upload');
    setSelectedFile(null);
    setParseResult(null);
    setUploadProgress(null);
    setError('');
    setSuccess('');
  };

  const renderUploadStep = () => {
    switch (uploadStep) {
      case 'upload':
        return (
          <FileUploadDropzone
            onFileSelect={handleFileSelect}
            acceptedTypes={['.xlsx', '.xls', '.csv']}
            maxSize={50 * 1024 * 1024} // 50MB
            multiple={false}
          />
        );

      case 'processing':
        return (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem'
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              border: '6px solid var(--border-color)',
              borderTop: '6px solid var(--accent-color)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 2rem'
            }}></div>
            <h3 style={{
              margin: '0 0 1rem 0',
              color: 'var(--text-primary)'
            }}>
              {uploadProgress ? 'Uploading to Server...' : 'Processing File...'}
            </h3>
            {uploadProgress && (
              <div style={{
                color: 'var(--text-secondary)',
                fontSize: '0.9rem'
              }}>
                {uploadProgress.current} of {uploadProgress.total} records processed
              </div>
            )}
          </div>
        );

      case 'preview':
        return (
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '2rem'
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '1.1rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Upload Preview: {selectedFile?.name}
              </h3>
              <button
                onClick={resetUpload}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                Cancel
              </button>
            </div>

            <ParseResultSummary result={parseResult} />

            {parseResult?.data && parseResult.data.length > 0 && (
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
                  Sample Data (first 5 records):
                </h4>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.85rem'
                  }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-primary)' }}>
                        <th style={{ padding: '8px', border: '1px solid var(--border-color)', textAlign: 'left' }}>ISIN</th>
                        <th style={{ padding: '8px', border: '1px solid var(--border-color)', textAlign: 'right' }}>Price</th>
                        <th style={{ padding: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>Currency</th>
                        <th style={{ padding: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseResult.data.slice(0, 5).map((row, index) => (
                        <tr key={index}>
                          <td style={{ padding: '8px', border: '1px solid var(--border-color)', fontFamily: 'monospace' }}>
                            {row.isin}
                          </td>
                          <td style={{ padding: '8px', border: '1px solid var(--border-color)', textAlign: 'right', fontFamily: 'monospace' }}>
                            {row.price.toFixed(4)}
                          </td>
                          <td style={{ padding: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                            {row.currency}
                          </td>
                          <td style={{ padding: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                            {new Date(row.priceDate).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parseResult.data.length > 5 && (
                  <div style={{
                    marginTop: '0.5rem',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    fontStyle: 'italic'
                  }}>
                    ... and {parseResult.data.length - 5} more records
                  </div>
                )}
              </div>
            )}

            <div style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'flex-end',
              marginTop: '2rem'
            }}>
              <button
                onClick={resetUpload}
                style={{
                  padding: '12px 24px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '1rem'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmUpload}
                disabled={!parseResult?.data || parseResult.data.length === 0}
                style={{
                  padding: '12px 24px',
                  background: parseResult?.data && parseResult.data.length > 0 
                    ? 'linear-gradient(135deg, var(--success-color) 0%, #20c997 100%)'
                    : 'var(--text-muted)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: parseResult?.data && parseResult.data.length > 0 ? 'pointer' : 'not-allowed',
                  fontSize: '1rem',
                  fontWeight: '600'
                }}
              >
                Upload {parseResult?.data?.length || 0} Records
              </button>
            </div>
          </div>
        );

      case 'complete':
        return (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem'
          }}>
            <div style={{
              fontSize: '2.5rem',
              marginBottom: '1rem',
              color: 'var(--success-color)'
            }}>
              ✅
            </div>
            <h3 style={{
              margin: '0 0 1rem 0',
              color: 'var(--text-primary)'
            }}>
              Upload Complete!
            </h3>
            <p style={{
              margin: '0 0 2rem 0',
              color: 'var(--text-secondary)'
            }}>
              {success}
            </p>
            <button
              onClick={resetUpload}
              style={{
                background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Upload Another File
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  if (user.role !== 'superadmin') {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '200px',
        color: 'var(--text-secondary)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <h3>Access Denied</h3>
          <p>Only superadmins can upload price data.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      padding: '2rem',
      margin: '1rem 0'
    }}>
      {/* Header */}
      <div style={{
        marginBottom: '2rem'
      }}>
        <h2 style={{
          margin: '0 0 0.5rem 0',
          fontSize: '1.2rem',
          fontWeight: '700',
          color: 'var(--text-primary)'
        }}>
          📊 Price Data Upload
        </h2>
        <p style={{
          margin: 0,
          color: 'var(--text-secondary)',
          fontSize: '1rem'
        }}>
          Upload Excel or CSV files containing ISIN codes and their corresponding prices
        </p>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div style={{
          color: 'var(--danger-color)',
          marginBottom: '1rem',
          padding: '12px 16px',
          backgroundColor: 'rgba(220, 53, 69, 0.1)',
          border: '1px solid rgba(220, 53, 69, 0.3)',
          borderRadius: '8px',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      {success && uploadStep !== 'complete' && (
        <div style={{
          color: 'var(--success-color)',
          marginBottom: '1rem',
          padding: '12px 16px',
          backgroundColor: 'rgba(40, 167, 69, 0.1)',
          border: '1px solid rgba(40, 167, 69, 0.3)',
          borderRadius: '8px',
          fontSize: '0.875rem'
        }}>
          {success}
        </div>
      )}

      {/* Main Upload Area */}
      {renderUploadStep()}

      {/* Recent Uploads History */}
      {uploadStep === 'upload' && !pricesLoading() && recentUploads.length > 0 && (
        <div style={{
          marginTop: '3rem',
          paddingTop: '2rem',
          borderTop: '1px solid var(--border-color)'
        }}>
          <h3 style={{
            margin: '0 0 1rem 0',
            fontSize: '1.2rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Recent Uploads
          </h3>
          <div style={{
            display: 'grid',
            gap: '0.5rem'
          }}>
            {recentUploads.slice(0, 5).map((price) => (
              <div
                key={price._id}
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '0.75rem 1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.85rem'
                }}
              >
                <div style={{ color: 'var(--text-primary)' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: '600' }}>
                    {price.isin}
                  </span>
                  <span style={{ margin: '0 0.5rem', color: 'var(--text-muted)' }}>•</span>
                  <span style={{ fontFamily: 'monospace' }}>
                    {price.price} {price.currency}
                  </span>
                </div>
                <div style={{ 
                  color: 'var(--text-secondary)',
                  fontSize: '0.75rem'
                }}>
                  {price.source} • {new Date(price.uploadDate).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CSS for animations */}
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default PriceUploadManager;