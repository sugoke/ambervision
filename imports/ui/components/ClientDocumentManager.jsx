/**
 * Client Document Manager Component
 *
 * Manages compliance documents for clients and their family members:
 * - ID / Passport (with expiration date)
 * - Residency Card (with expiration date)
 * - Proof of Address (must be < 6 months old)
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import LiquidGlassCard from './LiquidGlassCard.jsx';
import {
  ClientDocumentsCollection,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_CONFIG,
  ClientDocumentHelpers,
  getDocumentsByCategory
} from '/imports/api/clientDocuments.js';

const DocumentSlot = ({
  documentType,
  document,
  userId,
  familyMemberIndex,
  onUploadComplete
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [expirationDate, setExpirationDate] = useState(
    document?.expirationDate ? new Date(document.expirationDate).toISOString().split('T')[0] : ''
  );
  const [documentNumber, setDocumentNumber] = useState(document?.documentNumber || '');
  const [issuanceDate, setIssuanceDate] = useState(
    document?.issuanceDate ? new Date(document.issuanceDate).toISOString().split('T')[0] : ''
  );
  const fileInputRef = useRef(null);

  const config = DOCUMENT_TYPE_CONFIG[documentType];
  const status = ClientDocumentHelpers.getDocumentStatus(document);

  // Unique input ID
  const inputId = `doc-input-${documentType}-${familyMemberIndex ?? 'main'}`;

  // Handle file selection
  const handleFile = useCallback(async (file) => {
    console.log('[DocumentUpload] handleFile called with:', file?.name, file?.type, file?.size);
    if (!file) {
      console.log('[DocumentUpload] No file provided');
      return;
    }

    // Validate file type (PDF or images)
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      alert('Please upload a PDF or image file (JPEG, PNG, GIF)');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    setIsUploading(true);
    console.log('[DocumentUpload] Starting upload for:', documentType, 'userId:', userId);

    try {
      // Convert file to base64
      console.log('[DocumentUpload] Converting to base64...');
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result.split(',')[1];
          console.log('[DocumentUpload] Base64 conversion complete, length:', base64?.length);
          resolve(base64);
        };
        reader.onerror = (err) => {
          console.error('[DocumentUpload] FileReader error:', err);
          reject(err);
        };
        reader.readAsDataURL(file);
      });

      // Upload to server
      const sessionId = localStorage.getItem('sessionId');
      console.log('[DocumentUpload] Calling server method with sessionId:', sessionId?.substring(0, 8) + '...');

      const result = await Meteor.callAsync('clientDocuments.upload', {
        userId,
        familyMemberIndex: familyMemberIndex ?? null,
        documentType,
        fileName: file.name,
        base64Data,
        mimeType: file.type,
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        documentNumber: documentNumber || null,
        issuanceDate: issuanceDate ? new Date(issuanceDate) : null,
        sessionId
      });

      console.log('[DocumentUpload] Upload success:', result);

      // Wait a moment for subscription to sync, then check collection
      setTimeout(() => {
        const docsAfterUpload = ClientDocumentsCollection.find({ userId }).fetch();
        console.log('[DocumentUpload] Documents after upload (delayed check):', docsAfterUpload.length, docsAfterUpload);
      }, 500);

      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (error) {
      console.error('[DocumentUpload] Upload error:', error);
      alert('Failed to upload document: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  }, [userId, familyMemberIndex, documentType, expirationDate, documentNumber, issuanceDate, onUploadComplete]);

  // Drag & drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  // File input handler
  const handleFileInput = (e) => {
    console.log('[DocumentUpload] handleFileInput called, files:', e.target.files?.length);
    const files = e.target.files;
    if (files && files.length > 0) {
      console.log('[DocumentUpload] Selected file:', files[0].name);
      handleFile(files[0]);
    }
    e.target.value = '';
  };

  // Delete document
  const handleDelete = async () => {
    if (!document) return;

    if (window.confirm(`Are you sure you want to delete this ${config.label}?`)) {
      try {
        const sessionId = localStorage.getItem('sessionId');
        await Meteor.callAsync('clientDocuments.delete', document._id, sessionId);
        if (onUploadComplete) {
          onUploadComplete();
        }
      } catch (error) {
        console.error('Delete error:', error);
        alert('Failed to delete document: ' + error.message);
      }
    }
  };

  // View document
  const handleView = async () => {
    if (!document) return;

    try {
      const sessionId = localStorage.getItem('sessionId');
      const url = await Meteor.callAsync('clientDocuments.getDownloadUrl', document._id, sessionId);
      window.open(url, '_blank');
    } catch (error) {
      console.error('View error:', error);
      alert('Failed to open document: ' + error.message);
    }
  };

  // Update expiration date
  const handleExpirationChange = async (e) => {
    const newDate = e.target.value;
    setExpirationDate(newDate);

    if (document && newDate) {
      try {
        const sessionId = localStorage.getItem('sessionId');
        await Meteor.callAsync('clientDocuments.updateExpiration', document._id, new Date(newDate), sessionId);
      } catch (error) {
        console.error('Update expiration error:', error);
      }
    }
  };

  // Update document number
  const handleDocumentNumberChange = async (e) => {
    const newNumber = e.target.value;
    setDocumentNumber(newNumber);

    if (document) {
      try {
        const sessionId = localStorage.getItem('sessionId');
        await Meteor.callAsync('clientDocuments.updateDetails', document._id, { documentNumber: newNumber }, sessionId);
      } catch (error) {
        console.error('Update document number error:', error);
      }
    }
  };

  // Update issuance date
  const handleIssuanceDateChange = async (e) => {
    const newDate = e.target.value;
    setIssuanceDate(newDate);

    if (document && newDate) {
      try {
        const sessionId = localStorage.getItem('sessionId');
        await Meteor.callAsync('clientDocuments.updateDetails', document._id, { issuanceDate: new Date(newDate) }, sessionId);
      } catch (error) {
        console.error('Update issuance date error:', error);
      }
    }
  };

  // Get status badge style
  const getStatusBadge = () => {
    if (!document) return null;

    const badgeStyles = {
      expired: { backgroundColor: '#ef4444', color: 'white' },
      warning: { backgroundColor: '#f59e0b', color: 'white' },
      stale: { backgroundColor: '#f59e0b', color: 'white' },
      ok: { backgroundColor: '#10b981', color: 'white' },
      missing: { backgroundColor: '#6b7280', color: 'white' }
    };

    return (
      <span
        style={{
          ...badgeStyles[status.status],
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: '600',
          marginLeft: '8px'
        }}
      >
        {status.message}
      </span>
    );
  };

  return (
    <div style={{ marginBottom: '12px' }}>
      {/* Document type header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '6px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: '1rem', marginRight: '6px' }}>{config.icon}</span>
          <span style={{ fontWeight: '500', color: 'var(--text-primary)', fontSize: '0.9rem' }}>{config.label}</span>
          {getStatusBadge()}
        </div>

        {/* Actions */}
        {document && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={handleView}
              style={{
                padding: '3px 10px',
                fontSize: '0.75rem',
                backgroundColor: 'var(--accent-color)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              View
            </button>
            <button
              onClick={handleDelete}
              style={{
                padding: '3px 10px',
                fontSize: '0.75rem',
                backgroundColor: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Drop zone or file info */}
      <div
        style={{
          border: isDragOver ? '2px dashed var(--accent-color)' : '1px dashed var(--border-color)',
          borderRadius: '6px',
          padding: document ? '10px' : '16px',
          backgroundColor: isDragOver ? 'rgba(0, 123, 255, 0.05)' : 'var(--bg-secondary)',
          textAlign: 'center',
          cursor: isUploading ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s ease',
          minHeight: document ? 'auto' : '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          console.log('[DocumentUpload] Drop zone clicked, document:', !!document, 'isUploading:', isUploading);
          if (!isUploading && !document && fileInputRef.current) {
            console.log('[DocumentUpload] Triggering file input click');
            fileInputRef.current.click();
          }
        }}
      >
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.gif"
          onChange={handleFileInput}
          style={{ display: 'none' }}
          disabled={isUploading}
        />

        {isUploading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '16px',
              height: '16px',
              border: '2px solid var(--border-color)',
              borderTop: '2px solid var(--accent-color)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Uploading...</span>
          </div>
        ) : document ? (
          <div style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            {/* File info */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              textAlign: 'left'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: '0.8rem',
                  fontWeight: '500',
                  color: 'var(--text-primary)',
                  wordBreak: 'break-word'
                }}>
                  {document.fileName}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                  marginTop: '2px'
                }}>
                  {ClientDocumentHelpers.formatFileSize(document.fileSize)} •
                  Uploaded {new Date(document.uploadedAt).toLocaleDateString()}
                </div>
              </div>

              {/* Replace button */}
              <label
                htmlFor={inputId}
                style={{
                  padding: '3px 10px',
                  fontSize: '0.75rem',
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginLeft: '10px'
                }}
              >
                Replace
              </label>
            </div>

            {/* Document number and dates for ID and Residency Card */}
            {config.requiresExpiration && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                paddingTop: '6px',
                borderTop: '1px solid var(--border-color)'
              }}>
                {/* Document Number */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <label style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    fontWeight: '500',
                    minWidth: '60px'
                  }}>
                    Number:
                  </label>
                  <input
                    type="text"
                    value={documentNumber}
                    onChange={handleDocumentNumberChange}
                    placeholder="ID/Passport number"
                    style={{
                      padding: '3px 6px',
                      fontSize: '0.8rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      flex: 1
                    }}
                  />
                </div>
                {/* Issuance Date */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <label style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    fontWeight: '500',
                    minWidth: '60px'
                  }}>
                    Issued:
                  </label>
                  <input
                    type="date"
                    value={issuanceDate}
                    onChange={handleIssuanceDateChange}
                    style={{
                      padding: '3px 6px',
                      fontSize: '0.8rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
                {/* Expiration Date */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <label style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    fontWeight: '500',
                    minWidth: '60px'
                  }}>
                    Expires:
                  </label>
                  <input
                    type="date"
                    value={expirationDate}
                    onChange={handleExpirationChange}
                    style={{
                      padding: '3px 6px',
                      fontSize: '0.8rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            width: '100%'
          }}>
            <label
              htmlFor={inputId}
              style={{
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                width: '100%'
              }}
            >
              <span style={{ fontSize: '1.2rem', opacity: 0.6 }}>
                {isDragOver ? '📥' : '📎'}
              </span>
              <span style={{
                color: 'var(--text-secondary)',
                fontSize: '0.8rem'
              }}>
                {isDragOver ? 'Drop file here' : 'Drag & drop or click'}
              </span>
            </label>

            {/* Document details input for new uploads */}
            {config.requiresExpiration && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                paddingTop: '8px',
                borderTop: '1px solid var(--border-color)',
                width: '100%'
              }}
              onClick={(e) => e.stopPropagation()}
              >
                {/* Document Number */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  justifyContent: 'center'
                }}>
                  <label style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    fontWeight: '500',
                    minWidth: '60px'
                  }}>
                    Number:
                  </label>
                  <input
                    type="text"
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    placeholder="ID/Passport #"
                    style={{
                      padding: '3px 6px',
                      fontSize: '0.75rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      width: '120px'
                    }}
                  />
                </div>
                {/* Issuance Date */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  justifyContent: 'center'
                }}>
                  <label style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    fontWeight: '500',
                    minWidth: '60px'
                  }}>
                    Issued:
                  </label>
                  <input
                    type="date"
                    value={issuanceDate}
                    onChange={(e) => setIssuanceDate(e.target.value)}
                    style={{
                      padding: '3px 6px',
                      fontSize: '0.75rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
                {/* Expiration Date */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  justifyContent: 'center'
                }}>
                  <label style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    fontWeight: '500',
                    minWidth: '60px'
                  }}>
                    Expires:
                  </label>
                  <input
                    type="date"
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                    style={{
                      padding: '3px 6px',
                      fontSize: '0.75rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

// Person section (main client or family member)
const PersonDocuments = ({
  personName,
  personIcon,
  userId,
  familyMemberIndex,
  documents,
  isCollapsed,
  onToggleCollapse,
  onUploadComplete
}) => {
  // Get document by type for this person
  const getDocument = (docType) => documents.find(d =>
    d.documentType === docType &&
    (familyMemberIndex === null
      ? (d.familyMemberIndex === null || d.familyMemberIndex === undefined)
      : d.familyMemberIndex === familyMemberIndex)
  );

  // Check warnings for this person
  const hasWarnings = Object.values(DOCUMENT_TYPES).some(docType => {
    const doc = getDocument(docType);
    if (!doc) return false;
    const status = ClientDocumentHelpers.getDocumentStatus(doc);
    return ['expired', 'warning', 'stale'].includes(status.status);
  });

  // Count missing documents for this person
  const missingCount = Object.values(DOCUMENT_TYPES).filter(
    type => !getDocument(type)
  ).length;

  return (
    <div style={{
      marginBottom: '16px',
      border: '1px solid var(--border-color)',
      borderRadius: '8px',
      overflow: 'hidden'
    }}>
      {/* Person header */}
      <div
        onClick={onToggleCollapse}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: 'var(--bg-tertiary)',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.2rem' }}>{personIcon}</span>
          <span style={{
            fontWeight: '600',
            color: 'var(--text-primary)',
            fontSize: '0.95rem'
          }}>
            {personName}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {missingCount > 0 && (
            <span style={{
              backgroundColor: '#6b7280',
              color: 'white',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '0.7rem',
              fontWeight: '600'
            }}>
              {missingCount} missing
            </span>
          )}
          {hasWarnings && (
            <span style={{
              backgroundColor: '#f59e0b',
              color: 'white',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '0.7rem',
              fontWeight: '600'
            }}>
              !</span>
          )}
          <span style={{
            fontSize: '1rem',
            color: 'var(--text-secondary)',
            transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 0.2s ease'
          }}>
            ▼
          </span>
        </div>
      </div>

      {/* Document slots organized by category */}
      {!isCollapsed && (
        <div style={{ padding: '12px 16px' }}>
          {/* Compliance Documents */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              fontSize: '0.75rem',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '8px',
              paddingBottom: '4px',
              borderBottom: '1px solid var(--border-color)'
            }}>
              📋 Compliance Documents
            </div>
            {getDocumentsByCategory('compliance').map(docType => (
              <DocumentSlot
                key={docType}
                documentType={docType}
                document={getDocument(docType)}
                userId={userId}
                familyMemberIndex={familyMemberIndex}
                onUploadComplete={onUploadComplete}
              />
            ))}
          </div>

          {/* Amberlake Partners Pack */}
          <div>
            <div style={{
              fontSize: '0.75rem',
              fontWeight: '600',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '8px',
              paddingBottom: '4px',
              borderBottom: '1px solid var(--border-color)'
            }}>
              🏛️ Amberlake Partners Pack
            </div>
            {getDocumentsByCategory('amberlake').map(docType => (
              <DocumentSlot
                key={docType}
                documentType={docType}
                document={getDocument(docType)}
                userId={userId}
                familyMemberIndex={familyMemberIndex}
                onUploadComplete={onUploadComplete}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ClientDocumentManager = ({ userId, familyMembers = [] }) => {
  const sessionId = localStorage.getItem('sessionId');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const isLoading = useSubscribe('clientDocuments', userId, sessionId);
  const documents = useFind(() => ClientDocumentsCollection.find({ userId }), [userId, refreshTrigger]);

  // Callback to force refresh after upload
  const handleUploadComplete = useCallback(() => {
    console.log('[ClientDocumentManager] Upload complete, triggering refresh');
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // Debug: Log subscription and documents state
  useEffect(() => {
    console.log('[ClientDocumentManager] Subscription status - isLoading:', isLoading());
    console.log('[ClientDocumentManager] Documents found:', documents.length, documents);
    console.log('[ClientDocumentManager] userId:', userId, 'sessionId:', sessionId?.substring(0, 8) + '...');
    console.log('[ClientDocumentManager] refreshTrigger:', refreshTrigger);

    // Also check raw collection
    const rawDocs = ClientDocumentsCollection.find({}).fetch();
    console.log('[ClientDocumentManager] Raw collection documents:', rawDocs.length, rawDocs);
  }, [isLoading, documents, userId, sessionId, refreshTrigger]);

  // Collapse state for each person (main client + family members)
  const [collapsedState, setCollapsedState] = useState({});

  const toggleCollapse = (key) => {
    setCollapsedState(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Count total warnings and missing across all persons
  const totalIssues = () => {
    let warnings = 0;
    let missing = 0;

    // Check main client
    Object.values(DOCUMENT_TYPES).forEach(docType => {
      const doc = documents.find(d =>
        d.documentType === docType &&
        (d.familyMemberIndex === null || d.familyMemberIndex === undefined)
      );
      if (!doc) {
        missing++;
      } else {
        const status = ClientDocumentHelpers.getDocumentStatus(doc);
        if (['expired', 'warning', 'stale'].includes(status.status)) {
          warnings++;
        }
      }
    });

    // Check family members
    familyMembers.forEach((_, idx) => {
      Object.values(DOCUMENT_TYPES).forEach(docType => {
        const doc = documents.find(d =>
          d.documentType === docType &&
          d.familyMemberIndex === idx
        );
        if (!doc) {
          missing++;
        } else {
          const status = ClientDocumentHelpers.getDocumentStatus(doc);
          if (['expired', 'warning', 'stale'].includes(status.status)) {
            warnings++;
          }
        }
      });
    });

    return { warnings, missing };
  };

  if (!userId) {
    return null;
  }

  const { warnings, missing } = totalIssues();

  return (
    <LiquidGlassCard style={{ padding: '20px', marginBottom: '20px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
        paddingBottom: '12px',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '1.5rem' }}>📋</span>
          <h3 style={{
            margin: 0,
            fontSize: '1.1rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Documents
          </h3>
        </div>

        {/* Status summary */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {missing > 0 && (
            <span style={{
              backgroundColor: '#6b7280',
              color: 'white',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: '600'
            }}>
              {missing} missing
            </span>
          )}
          {warnings > 0 && (
            <span style={{
              backgroundColor: '#f59e0b',
              color: 'white',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: '600'
            }}>
              {warnings} need attention
            </span>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading() && (
        <div style={{
          textAlign: 'center',
          padding: '20px',
          color: 'var(--text-secondary)'
        }}>
          Loading documents...
        </div>
      )}

      {/* Document sections */}
      {!isLoading() && (
        <div>
          {/* Debug: show document count */}
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px', padding: '4px 8px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px' }}>
            Debug: {documents.length} documents loaded for user {userId?.substring(0, 8)}...
          </div>
          {/* Main client */}
          <PersonDocuments
            personName="Main Client"
            personIcon="👤"
            userId={userId}
            familyMemberIndex={null}
            documents={documents}
            isCollapsed={collapsedState['main']}
            onToggleCollapse={() => toggleCollapse('main')}
            onUploadComplete={handleUploadComplete}
          />

          {/* Family members */}
          {familyMembers.map((member, idx) => (
            <PersonDocuments
              key={idx}
              personName={member.name || `Family Member ${idx + 1}`}
              personIcon={member.relationship === 'spouse' ? '💑' : member.relationship === 'child' ? '👶' : '👥'}
              userId={userId}
              familyMemberIndex={idx}
              documents={documents}
              isCollapsed={collapsedState[`fm-${idx}`]}
              onToggleCollapse={() => toggleCollapse(`fm-${idx}`)}
              onUploadComplete={handleUploadComplete}
            />
          ))}
        </div>
      )}
    </LiquidGlassCard>
  );
};

export default ClientDocumentManager;
