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
import { openDocumentWindow } from '../utils/openDocument.js';
import {
  ClientDocumentsCollection,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_CONFIG,
  ClientDocumentHelpers,
  getDocumentsByCategory,
  isOptionalDocumentType
} from '/imports/api/clientDocuments.js';

// Documents-tab and expected types are shared with the compliance dashboard.
import { getDocumentTabTypes, getExpectedDocumentTypes } from '/imports/api/complianceChecks.js';

const IMAGE_PDF_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif'];
const WORD_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

// Windows browsers report an empty (or generic) file.type for .doc/.docx when the
// registry association is missing, so the extension is the fallback source of
// truth. The server pairs extension against MIME, so the two must agree.
const MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const resolveMimeType = (file) => {
  const known = Object.values(MIME_BY_EXTENSION);
  if (file.type && known.includes(file.type)) return file.type;
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  return MIME_BY_EXTENSION[ext] || file.type || '';
};

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

// Date labels are per type ("Statement date", "Signed on", "Extract date"...),
// so they need more room than the fixed "Number:" / "Expires:" labels.
const dateFieldLabel = { ...smallLabel, minWidth: '96px' };

// One uploaded file for a document type
const DocumentFileRow = ({ document, config, onUploadComplete, accountOptions = [] }) => {
  const [bankAccountId, setBankAccountId] = useState(document?.bankAccountId || '');
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
      // Tab opened synchronously inside the click gesture — window.open after
      // the await is silently blocked by mobile popup blockers
      await openDocumentWindow(() =>
        Meteor.callAsync('clientDocuments.getDownloadUrl', document._id, sessionId)
      );
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

  const handleBankAccountChange = async (e) => {
    const newAccountId = e.target.value;
    setBankAccountId(newAccountId);
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('clientDocuments.updateDetails', document._id, { bankAccountId: newAccountId || null }, sessionId);
    } catch (error) {
      console.error('Update portfolio error:', error);
      alert('Failed to update portfolio: ' + error.message);
      setBankAccountId(document?.bankAccountId || '');
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
            {ClientDocumentHelpers.formatFileSize(document.fileSize)}
            {document.issuanceDate && ` • ${config.dateLabel || 'Document date'} ${new Date(document.issuanceDate).toLocaleDateString()}`}
            {' • '}Uploaded {new Date(document.uploadedAt).toLocaleDateString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', marginLeft: '10px' }}>
          <button onClick={handleView} style={{ padding: '3px 10px', fontSize: '0.75rem', backgroundColor: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>View</button>
          <button onClick={handleDelete} style={{ padding: '3px 10px', fontSize: '0.75rem', backgroundColor: 'var(--loss-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete</button>
        </div>
      </div>

      {/* Every document carries its own date (see DOCUMENT_TYPE_CONFIG.dateLabel):
          it is what age / staleness is measured from. Number and expiry stay
          limited to the types that actually have them. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px', marginTop: '8px', borderTop: '1px solid var(--border-color)' }}>
        {config.requiresExpiration && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={smallLabel}>Number:</label>
            <input type="text" value={documentNumber} onChange={handleDocumentNumberChange} placeholder="ID/Passport number" style={{ ...smallInput, flex: 1 }} />
          </div>
        )}
        {config.requiresBankAccount && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={dateFieldLabel}>Portfolio:</label>
            <select value={bankAccountId} onChange={handleBankAccountChange} style={{ ...smallInput, color: bankAccountId ? undefined : 'var(--loss-color)' }}>
              <option value="">Choose the portfolio…</option>
              {accountOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={dateFieldLabel}>{config.dateLabel || 'Document date'}:</label>
          <input type="date" value={issuanceDate} onChange={handleIssuanceDateChange} style={smallInput} />
        </div>
        {config.requiresExpiration && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={dateFieldLabel}>Expires:</label>
            <input type="date" value={expirationDate} onChange={handleExpirationChange} style={smallInput} />
          </div>
        )}
      </div>
    </div>
  );
};

// Dropzone to add a NEW file for a document type
const AddDocumentDropzone = ({ documentType, config, userId, familyMemberIndex, onUploadComplete, accountOptions = [] }) => {
  const [bankAccountId, setBankAccountId] = useState('');
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

    const mimeType = resolveMimeType(file);
    if (!mimeTypes.includes(mimeType)) {
      alert(`Please upload a ${help} file`);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }
    if (config.requiresBankAccount && !bankAccountId) {
      alert('Please choose the portfolio this file signs before adding it');
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
        mimeType,
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        documentNumber: documentNumber || null,
        issuanceDate: issuanceDate ? new Date(issuanceDate) : null,
        bankAccountId: config.requiresBankAccount ? bankAccountId : null,
        sessionId
      });
      // Reset per-upload metadata
      setExpirationDate('');
      setDocumentNumber('');
      setIssuanceDate('');
      setBankAccountId('');
      if (onUploadComplete) onUploadComplete();
    } catch (error) {
      console.error('[DocumentUpload] Upload error:', error);
      alert('Failed to upload document: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  }, [userId, familyMemberIndex, documentType, expirationDate, documentNumber, issuanceDate, bankAccountId, config, onUploadComplete, mimeTypes, help]);

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

          {/* The document's own date is captured for every type at upload time;
              number and expiry only for the types that carry them. Clicks are
              stopped so filling these fields does not reopen the file picker. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px', borderTop: '1px solid var(--border-color)', width: '100%' }} onClick={(e) => e.stopPropagation()}>
            {config.requiresExpiration && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <label style={{ ...smallLabel, fontSize: '0.75rem' }}>Number:</label>
                <input type="text" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} placeholder="ID/Passport #" style={{ ...smallInput, fontSize: '0.75rem', width: '120px' }} />
              </div>
            )}
            {config.requiresBankAccount && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <label style={{ ...smallLabel, fontSize: '0.75rem' }}>Portfolio:</label>
                <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} style={{ ...smallInput, fontSize: '0.75rem' }}>
                  <option value="">Choose the portfolio…</option>
                  {accountOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
              <label style={{ ...smallLabel, fontSize: '0.75rem' }}>{config.dateLabel || 'Document date'}:</label>
              <input type="date" value={issuanceDate} onChange={(e) => setIssuanceDate(e.target.value)} style={{ ...smallInput, fontSize: '0.75rem' }} />
            </div>
            {config.requiresExpiration && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <label style={{ ...smallLabel, fontSize: '0.75rem' }}>Expires:</label>
                <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} style={{ ...smallInput, fontSize: '0.75rem' }} />
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// A document type: header + list of files + add control
export const DocumentTypeSection = ({ documentType, documents, userId, familyMemberIndex, onUploadComplete, accountOptions }) => {
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

      {config.hint && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
          {config.hint}
        </div>
      )}

      {documents.map(doc => (
        <DocumentFileRow key={doc._id} document={doc} config={config} onUploadComplete={onUploadComplete} accountOptions={accountOptions} />
      ))}

      <AddDocumentDropzone
        documentType={documentType}
        config={config}
        userId={userId}
        familyMemberIndex={familyMemberIndex}
        onUploadComplete={onUploadComplete}
        accountOptions={accountOptions}
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
  onUploadComplete,
  isCompany = false
}) => {
  // Get all documents of a type for this person
  const getDocuments = (docType) => documents.filter(d =>
    d.documentType === docType &&
    (familyMemberIndex === null
      ? (d.familyMemberIndex === null || d.familyMemberIndex === undefined)
      : d.familyMemberIndex === familyMemberIndex)
  );

  // Warnings across all files shown in this tab
  const hasWarnings = getDocumentTabTypes(isCompany).some(docType =>
    getDocuments(docType).some(doc => {
      const status = ClientDocumentHelpers.getDocumentStatus(doc);
      return ['expired', 'warning', 'stale'].includes(status.status);
    })
  );

  // Count expected types with no file uploaded
  const missingCount = getExpectedDocumentTypes(isCompany)
    .filter(type => getDocuments(type).length === 0).length;

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
          {/* Personal documents don't apply to a company — shown there only if
              files were already filed under them */}
          {(!isCompany || getDocumentsByCategory('compliance').some(type => getDocuments(type).length > 0))
            && renderCategory('📋 Compliance Documents', 'compliance')}
          {isCompany && renderCategory('🏢 Corporate Documents', 'corporate')}
          {renderCategory('🏛️ Amberlake Partners Pack', 'amberlake')}
          {renderCategory('🏦 Bank Documents', 'bank')}
        </div>
      )}
    </div>
  );
};

const ClientDocumentManager = ({ userId, familyMembers = [], isCompany = false }) => {
  const sessionId = localStorage.getItem('sessionId');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const isLoading = useSubscribe('clientDocuments', userId, sessionId);
  const documents = useFind(() => ClientDocumentsCollection.find({ userId }), [userId, refreshTrigger]);

  const handleUploadComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  const [collapsedState, setCollapsedState] = useState({});
  const toggleCollapse = (key) => setCollapsedState(prev => ({ ...prev, [key]: !prev[key] }));

  // A family member linked to another contact keeps their documents on that
  // contact, so no document slots here — unless files were already filed under
  // this member. Documents are keyed by the member's position, so the index is kept.
  const showsMemberDocuments = (member, idx) =>
    !member?.linkedEntityId || documents.some(d => d.familyMemberIndex === idx);

  // Count total warnings and missing across all persons (documents-tab types only)
  const totalIssues = () => {
    let warnings = 0;
    let missing = 0;

    const countFor = (familyMemberIndex) => {
      // Family members are always individuals, even under a company entity.
      const types = getDocumentTabTypes(isCompany && familyMemberIndex === null);
      types.forEach(docType => {
        const docs = documents.filter(d =>
          d.documentType === docType &&
          (familyMemberIndex === null
            ? (d.familyMemberIndex === null || d.familyMemberIndex === undefined)
            : d.familyMemberIndex === familyMemberIndex)
        );
        if (docs.length === 0) {
          if (!isOptionalDocumentType(docType)) missing++;
        } else if (docs.some(doc => ['expired', 'warning', 'stale'].includes(ClientDocumentHelpers.getDocumentStatus(doc).status))) {
          warnings++;
        }
      });
    };

    countFor(null);
    familyMembers.forEach((member, idx) => { if (showsMemberDocuments(member, idx)) countFor(idx); });

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
            personName={isCompany ? 'Company' : 'Main Client'}
            personIcon={isCompany ? '🏢' : '👤'}
            userId={userId}
            familyMemberIndex={null}
            isCompany={isCompany}
            documents={documents}
            isCollapsed={collapsedState['main']}
            onToggleCollapse={() => toggleCollapse('main')}
            onUploadComplete={handleUploadComplete}
          />

          {familyMembers.map((member, idx) => showsMemberDocuments(member, idx) && (
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
/**
 * Uploader for ONE document type, rendered inline in a tab rather than in the
 * Documents grid. Used for the KYC files and the periodic review file.
 */
// accountOptions: [{ value: bankAccountId, label }] for types bound to a portfolio
export const SingleTypeDocumentManager = ({ userId, documentType, title, bordered = true, accountOptions = [] }) => {
  const sessionId = localStorage.getItem('sessionId');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const isLoading = useSubscribe('clientDocuments', userId, sessionId);
  const documents = useFind(
    () => ClientDocumentsCollection.find({ userId, documentType }),
    [userId, documentType, refreshTrigger]
  );

  const handleUploadComplete = useCallback(() => setRefreshTrigger(prev => prev + 1), []);

  if (!userId) return null;

  return (
    <div style={{
      marginTop: '20px',
      ...(bordered ? { paddingTop: '16px', borderTop: '1px solid var(--border-color)' } : {})
    }}>
      <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
        {title}
      </div>
      {isLoading() ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading files...</div>
      ) : (
        <DocumentTypeSection
          documentType={documentType}
          documents={documents.filter(d => d.familyMemberIndex === null || d.familyMemberIndex === undefined)}
          userId={userId}
          familyMemberIndex={null}
          onUploadComplete={handleUploadComplete}
          accountOptions={accountOptions}
        />
      )}
    </div>
  );
};

/**
 * One-image slot (client photo, specimen signature) for the Entity Profile tab.
 *
 * Drag-and-drop or click to upload; a new image replaces the previous one. The
 * file is stored through the ordinary client-documents pipeline (disk storage,
 * token-gated download), so the profile document never carries image bytes.
 */
const IMAGE_ONLY_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const MAX_IDENTITY_IMAGE_BYTES = 5 * 1024 * 1024;

export const IdentityImageSlot = ({ userId, documentType, label, aspectRatio = '1 / 1', canEdit = true }) => {
  const sessionId = localStorage.getItem('sessionId');
  const isLoading = useSubscribe('clientDocuments', userId, sessionId);
  const documents = useFind(
    () => ClientDocumentsCollection.find({ userId, documentType }, { sort: { uploadedAt: -1 } }),
    [userId, documentType]
  );
  const current = documents[0] || null;

  const [imageUrl, setImageUrl] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // Download URLs are short-lived tokens, so mint one per displayed document
  // (and again if the image fails to load once the token has expired).
  const loadUrl = useCallback(async () => {
    if (!current) { setImageUrl(null); return; }
    try {
      const url = await Meteor.callAsync('clientDocuments.getDownloadUrl', current._id, sessionId);
      setImageUrl(url);
    } catch (err) {
      console.error('[IdentityImageSlot] Could not get image URL:', err);
      setImageUrl(null);
    }
  }, [current?._id, sessionId]);

  useEffect(() => { loadUrl(); }, [loadUrl]);

  const handleFile = useCallback(async (file) => {
    if (!file || !canEdit) return;
    setError(null);
    const mimeType = resolveMimeType(file);
    if (!IMAGE_ONLY_TYPES.includes(mimeType)) {
      setError('Please drop a JPG, PNG or GIF image');
      return;
    }
    if (file.size > MAX_IDENTITY_IMAGE_BYTES) {
      setError('Image must be smaller than 5 MB');
      return;
    }
    setIsBusy(true);
    try {
      const base64Data = await fileToBase64(file);
      const previous = documents.map(d => d._id);
      await Meteor.callAsync('clientDocuments.upload', {
        userId,
        familyMemberIndex: null,
        documentType,
        fileName: file.name,
        base64Data,
        mimeType,
        expirationDate: null,
        documentNumber: null,
        issuanceDate: new Date(),
        sessionId
      });
      // One image per slot: the new upload supersedes whatever was there.
      await Promise.all(previous.map(id => Meteor.callAsync('clientDocuments.delete', id, sessionId)));
    } catch (err) {
      console.error('[IdentityImageSlot] Upload error:', err);
      setError(err.reason || err.message || 'Upload failed');
    } finally {
      setIsBusy(false);
    }
  }, [userId, documentType, documents, sessionId, canEdit]);

  const handleRemove = useCallback(async () => {
    if (!current || !canEdit) return;
    setIsBusy(true);
    setError(null);
    try {
      await Meteor.callAsync('clientDocuments.delete', current._id, sessionId);
    } catch (err) {
      console.error('[IdentityImageSlot] Delete error:', err);
      setError(err.reason || err.message || 'Could not remove image');
    } finally {
      setIsBusy(false);
    }
  }, [current?._id, sessionId, canEdit]);

  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  };

  const zoneStyle = {
    position: 'relative',
    width: '100%',
    aspectRatio,
    borderRadius: '10px',
    border: isDragOver ? '2px dashed var(--accent-color)' : (current ? '1px solid var(--border-color)' : '2px dashed var(--border-color)'),
    background: isDragOver ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-secondary)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    cursor: canEdit && !isBusy ? 'pointer' : 'default',
    transition: 'border-color 0.15s ease, background 0.15s ease',
    boxSizing: 'border-box'
  };

  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
        {label}
      </label>
      <div
        style={zoneStyle}
        onClick={() => { if (canEdit && !isBusy) inputRef.current?.click(); }}
        onDragOver={(e) => { if (!canEdit) return; e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
        onDrop={canEdit ? onDrop : undefined}
        title={canEdit ? (current ? 'Drop or click to replace' : 'Drop or click to upload') : undefined}
      >
        {isLoading() || isBusy ? (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{isBusy ? 'Uploading…' : 'Loading…'}</span>
        ) : current && imageUrl ? (
          <img
            src={imageUrl}
            alt={label}
            onError={loadUrl}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: 'white' }}
          />
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem', padding: '12px' }}>
            <div style={{ fontSize: '1.4rem', marginBottom: '4px' }}>{documentType === DOCUMENT_TYPES.CLIENT_SIGNATURE ? '✒️' : '📷'}</div>
            {canEdit ? <>Drop an image here<br />or click to choose</> : 'No image'}
          </div>
        )}
        {current && canEdit && !isBusy && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleRemove(); }}
            title="Remove image"
            style={{ position: 'absolute', top: '6px', right: '6px', width: '24px', height: '24px', borderRadius: '50%', border: 'none', background: 'rgba(17, 24, 39, 0.7)', color: 'white', cursor: 'pointer', fontSize: '0.8rem', lineHeight: '24px', padding: 0 }}
          >
            ✕
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.gif"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
      </div>
      {current && (
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px' }}>
          {current.fileName} · uploaded {current.uploadedAt ? new Date(current.uploadedAt).toLocaleDateString() : ''}
        </div>
      )}
      {error && <div style={{ fontSize: '0.72rem', color: 'var(--loss-color)', marginTop: '4px' }}>{error}</div>}
    </div>
  );
};

export const KycDocumentManager = ({ userId }) => (
  <SingleTypeDocumentManager userId={userId} documentType={DOCUMENT_TYPES.KYC_FILE} title="📎 KYC Files" />
);

export default ClientDocumentManager;
