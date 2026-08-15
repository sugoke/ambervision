/**
 * Client Document Manager Component
 *
 * Manages compliance documents for clients and their family members:
 * - ID / Passport (with expiration date)
 * - Residency Card (with expiration date)
 * - Proof of Address (must be < 6 months old)
 *
 * Several files can be uploaded per document type. Each file keeps its own
 * metadata (number / issuance / expiration where relevant).
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

// Document types shown in the Documents tab (KYC files live in the KYC tab).
const DOCUMENT_TAB_TYPES = [
  ...getDocumentsByCategory('compliance'),
  ...getDocumentsByCategory('amberlake')
];

const IMAGE_PDF_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif'];
const WORD_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

// Resolve the accepted file types for a given document config.
const getAcceptConfig = (config) => {
  const allowWord = !!config?.allowsWord;
  const mimeTypes = allowWord ? [...IMAGE_PDF_TYPES, ...WORD_TYPES] : IMAGE_PDF_TYPES;
  const accept = allowWord ? '.pdf,.jpg,.jpeg,.png,.gif,.doc,.docx' : '.pdf,.jpg,.jpeg,.png,.gif';
  const help = allowWord ? 'PDF, Word or image' : 'PDF or image';
  return { mimeTypes, accept, help };
};

// Convert a File to base64 (without the data: prefix)
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result.split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// Status badge for a single document
const StatusBadge = ({ document }) => {
  if (!document) return null;
  const status = ClientDocumentHelpers.getDocumentStatus(document);
  const badgeStyles = {
    expired: { backgroundColor: 'var(--loss-color)', color: 'white' },
    warning: { backgroundColor: 'var(--warning-color)', color: 'white' },
    stale: { backgroundColor: 'var(--warning-color)', color: 'white' },
    ok: { backgroundColor: 'var(--gain-color)', color: 'white' },
    missing: { backgroundColor: '#6b7280', color: 'white' }
  };
  return (
    <span style={{
      ...badgeStyles[status.status],
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '0.75rem',
      fontWeight: '600',
      marginLeft: '8px'
    }}>
      {status.message}
    </span>
  );
};

const smallInput = {
  padding: '3px 6px',
  fontSize: '0.8rem',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  backgroundColor: 'var(--bg-primary)',
  color: 'var(--text-primary)'
};

const smallLabel = {
  fontSize: '0.8rem',
  color: 'var(--text-secondary)',
  fontWeight: '500',
  minWidth: '60px'
};

// One uploaded file for a document type
const DocumentFileRow = ({ document, config, onUploadComplete }) => {
  const [expirationDate, setExpirationDate] = useState(
    document?.expirationDate ? new Date(document.expirationDate).toISOString().split('T')[0] : ''
  );
  const [documentNumber, setDocumentNumber] = useState(document?.documentNumber || '');
  const [issuanceDate, setIssuanceDate] = useState(
    document?.issuanceDate ? new Date(document.issuanceDate).toISOString().split('T')[0] : ''
  );

  const handleView = async () => {
    try {
      const sessionId = localStorage.getItem('sessionId');
      const url = await Meteor.callAsync('clientDocuments.getDownloadUrl', document._id, sessionId);
      window.open(url, '_blank');
    } catch (error) {
      console.error('View error:', error);
      alert('Failed to open document: ' + error.message);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${document.fileName}"?`)) return;
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('clientDocuments.delete', document._id, sessionId);
      if (onUploadComplete) onUploadComplete();
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete document: ' + error.message);
    }
  };

  const handleExpirationChange = async (e) => {
    const newDate = e.target.value;
    setExpirationDate(newDate);
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('clientDocuments.updateExpiration', document._id, newDate ? new Date(newDate) : null, sessionId);
    } catch (error) {
      console.error('Update expiration error:', error);
    }
  };

  const handleDocumentNumberChange = async (e) => {
    const newNumber = e.target.value;
    setDocumentNumber(newNumber);
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('clientDocuments.updateDetails', document._id, { documentNumber: newNumber }, sessionId);
    } catch (error) {
      console.error('Update document number error:', error);
    }
  };

  const handleIssuanceDateChange = async (e) => {
    const newDate = e.target.value;
    setIssuanceDate(newDate);
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('clientDocuments.updateDetails', document._id, { issuanceDate: newDate ? new Date(newDate) : null }, sessionId);
    } catch (error) {
      console.error('Update issuance date error:', error);
    }
  };

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      padding: '10px',
      backgroundColor: 'var(--bg-secondary)',
      marginBottom: '8px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '500', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
              {document.fileName}
            </span>
            <StatusBadge document={document} />
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {ClientDocumentHelpers.formatFileSize(document.fileSize)} • Uploaded {new Date(document.uploadedAt).toLocaleDateString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', marginLeft: '10px' }}>
          <button onClick={handleView} style={{ padding: '3px 10px', fontSize: '0.75rem', backgroundColor: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>View</button>
          <button onClick={handleDelete} style={{ padding: '3px 10px', fontSize: '0.75rem', backgroundColor: 'var(--loss-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete</button>
        </div>
      </div>

      {config.requiresExpiration && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px', marginTop: '8px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={smallLabel}>Number:</label>
            <input type="text" value={documentNumber} onChange={handleDocumentNumberChange} placeholder="ID/Passport number" style={{ ...smallInput, flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={smallLabel}>Issued:</label>
            <input type="date" value={issuanceDate} onChange={handleIssuanceDateChange} style={smallInput} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={smallLabel}>Expires:</label>
            <input type="date" value={expirationDate} onChange={handleExpirationChange} style={smallInput} />
          </div>
        </div>
      )}
    </div>
  );
};

// Dropzone to add a NEW file for a document type
const AddDocumentDropzone = ({ documentType, config, userId, familyMemberIndex, onUploadComplete }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [expirationDate, setExpirationDate] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [issuanceDate, setIssuanceDate] = useState('');
  const fileInputRef = useRef(null);

  const { mimeTypes, accept, help } = getAcceptConfig(config);
  const inputId = `doc-input-${documentType}-${familyMemberIndex ?? 'main'}`;

  const handleFile = useCallback(async (file) => {
    if (!file) return;

    if (!mimeTypes.includes(file.type)) {
      alert(`Please upload a ${help} file`);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    setIsUploading(true);
    try {
      const base64Data = await fileToBase64(file);
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('clientDocuments.upload', {
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
      // Reset per-upload metadata
      setExpirationDate('');
      setDocumentNumber('');
      setIssuanceDate('');
      if (onUploadComplete) onUploadComplete();
    } catch (error) {
      console.error('[DocumentUpload] Upload error:', error);
      alert('Failed to upload document: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  }, [userId, familyMemberIndex, documentType, expirationDate, documentNumber, issuanceDate, onUploadComplete, mimeTypes, help]);

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) handleFile(files[0]);
  };

  const handleFileInput = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) handleFile(files[0]);
    e.target.value = '';
  };

  return (
    <div
      style={{
        border: isDragOver ? '2px dashed var(--accent-color)' : '1px dashed var(--border-color)',
        borderRadius: '6px',
        padding: '12px',
        backgroundColor: isDragOver ? 'rgba(0, 123, 255, 0.05)' : 'var(--bg-secondary)',
        textAlign: 'center',
        cursor: isUploading ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s ease'
      }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
      onDrop={handleDrop}
      onClick={() => { if (!isUploading && fileInputRef.current) fileInputRef.current.click(); }}
    >
      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        accept={accept}
        onChange={handleFileInput}
        style={{ display: 'none' }}
        disabled={isUploading}
      />

      {isUploading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <div style={{ width: '16px', height: '16px', border: '2px solid var(--border-color)', borderTop: '2px solid var(--accent-color)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Uploading...</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            {isDragOver ? '📥 Drop file here' : `➕ Add file (${help})`}
          </span>

          {config.requiresExpiration && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px', borderTop: '1px solid var(--border-color)', width: '100%' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <label style={{ ...smallLabel, fontSize: '0.75rem' }}>Number:</label>
                <input type="text" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} placeholder="ID/Passport #" style={{ ...smallInput, fontSize: '0.75rem', width: '120px' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <label style={{ ...smallLabel, fontSize: '0.75rem' }}>Issued:</label>
                <input type="date" value={issuanceDate} onChange={(e) => setIssuanceDate(e.target.value)} style={{ ...smallInput, fontSize: '0.75rem' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <label style={{ ...smallLabel, fontSize: '0.75rem' }}>Expires:</label>
                <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} style={{ ...smallInput, fontSize: '0.75rem' }} />
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// A document type: header + list of files + add control
export const DocumentTypeSection = ({ documentType, documents, userId, familyMemberIndex, onUploadComplete }) => {
  const config = DOCUMENT_TYPE_CONFIG[documentType];
  if (!config) return null;

  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '1rem', marginRight: '6px' }}>{config.icon}</span>
        <span style={{ fontWeight: '500', color: 'var(--text-primary)', fontSize: '0.9rem' }}>{config.label}</span>
        {documents.length > 0 && (
          <span style={{ marginLeft: '8px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            ({documents.length})
          </span>
        )}
      </div>

      {documents.map(doc => (
        <DocumentFileRow key={doc._id} document={doc} config={config} onUploadComplete={onUploadComplete} />
      ))}

      <AddDocumentDropzone
        documentType={documentType}
        config={config}
        userId={userId}
        familyMemberIndex={familyMemberIndex}
        onUploadComplete={onUploadComplete}
      />
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
  // Get all documents of a type for this person
  const getDocuments = (docType) => documents.filter(d =>
    d.documentType === docType &&
    (familyMemberIndex === null
      ? (d.familyMemberIndex === null || d.familyMemberIndex === undefined)
      : d.familyMemberIndex === familyMemberIndex)
  );

  // Warnings across all files shown in this tab
  const hasWarnings = DOCUMENT_TAB_TYPES.some(docType =>
    getDocuments(docType).some(doc => {
      const status = ClientDocumentHelpers.getDocumentStatus(doc);
      return ['expired', 'warning', 'stale'].includes(status.status);
    })
  );

  // Count types with no file uploaded
  const missingCount = DOCUMENT_TAB_TYPES.filter(type => getDocuments(type).length === 0).length;

  const renderCategory = (title, category) => (
    <div style={{ marginBottom: '16px' }}>
      <div style={{
        fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px',
        paddingBottom: '4px', borderBottom: '1px solid var(--border-color)'
      }}>
        {title}
      </div>
      {getDocumentsByCategory(category).map(docType => (
        <DocumentTypeSection
          key={docType}
          documentType={docType}
          documents={getDocuments(docType)}
          userId={userId}
          familyMemberIndex={familyMemberIndex}
          onUploadComplete={onUploadComplete}
        />
      ))}
    </div>
  );

  return (
    <div style={{ marginBottom: '16px', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
      <div
        onClick={onToggleCollapse}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: 'var(--bg-tertiary)', cursor: 'pointer', userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.2rem' }}>{personIcon}</span>
          <span style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.95rem' }}>{personName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {missingCount > 0 && (
            <span style={{ backgroundColor: '#6b7280', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600' }}>
              {missingCount} missing
            </span>
          )}
          {hasWarnings && (
            <span style={{ backgroundColor: 'var(--warning-color)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600' }}>!</span>
          )}
          <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s ease' }}>▼</span>
        </div>
      </div>

      {!isCollapsed && (
        <div style={{ padding: '12px 16px' }}>
          {renderCategory('📋 Compliance Documents', 'compliance')}
          {renderCategory('🏛️ Amberlake Partners Pack', 'amberlake')}
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

  const handleUploadComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  const [collapsedState, setCollapsedState] = useState({});
  const toggleCollapse = (key) => setCollapsedState(prev => ({ ...prev, [key]: !prev[key] }));

  // Count total warnings and missing across all persons (documents-tab types only)
  const totalIssues = () => {
    let warnings = 0;
    let missing = 0;

    const countFor = (familyMemberIndex) => {
      DOCUMENT_TAB_TYPES.forEach(docType => {
        const docs = documents.filter(d =>
          d.documentType === docType &&
          (familyMemberIndex === null
            ? (d.familyMemberIndex === null || d.familyMemberIndex === undefined)
            : d.familyMemberIndex === familyMemberIndex)
        );
        if (docs.length === 0) {
          missing++;
        } else if (docs.some(doc => ['expired', 'warning', 'stale'].includes(ClientDocumentHelpers.getDocumentStatus(doc).status))) {
          warnings++;
        }
      });
    };

    countFor(null);
    familyMembers.forEach((_, idx) => countFor(idx));

    return { warnings, missing };
  };

  if (!userId) return null;

  const { warnings, missing } = totalIssues();

  return (
    <LiquidGlassCard style={{ padding: '20px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '1.5rem' }}>📋</span>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '600', color: 'var(--text-primary)' }}>Documents</h3>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {missing > 0 && (
            <span style={{ backgroundColor: '#6b7280', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '600' }}>{missing} missing</span>
          )}
          {warnings > 0 && (
            <span style={{ backgroundColor: 'var(--warning-color)', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '600' }}>{warnings} need attention</span>
          )}
        </div>
      </div>

      {isLoading() && (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>Loading documents...</div>
      )}

      {!isLoading() && (
        <div>
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

/**
 * KYC Document Manager — a lightweight uploader for KYC files (PDF/Word),
 * rendered inside the KYC tab. Reuses the same storage as client documents.
 */
export const KycDocumentManager = ({ userId }) => {
  const sessionId = localStorage.getItem('sessionId');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const isLoading = useSubscribe('clientDocuments', userId, sessionId);
  const documents = useFind(
    () => ClientDocumentsCollection.find({ userId, documentType: DOCUMENT_TYPES.KYC_FILE }),
    [userId, refreshTrigger]
  );

  const handleUploadComplete = useCallback(() => setRefreshTrigger(prev => prev + 1), []);

  if (!userId) return null;

  return (
    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
        📎 KYC Files
      </div>
      {isLoading() ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading files...</div>
      ) : (
        <DocumentTypeSection
          documentType={DOCUMENT_TYPES.KYC_FILE}
          documents={documents.filter(d => d.familyMemberIndex === null || d.familyMemberIndex === undefined)}
          userId={userId}
          familyMemberIndex={null}
          onUploadComplete={handleUploadComplete}
        />
      )}
    </div>
  );
};

export default ClientDocumentManager;
