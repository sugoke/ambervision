import React, { useState, useEffect, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { BankConnectionsCollection } from '../api/bankConnections.js';
import { BankConnectionLogsCollection } from '../api/bankConnectionLogs.js';
import { BanksCollection } from '../api/banks.js';
import { useDialog } from './useDialog.js';
import Dialog from './Dialog.jsx';

const inputStyle = {
  width: '100%',
  padding: '10px',
  borderRadius: '8px',
  border: '2px solid var(--border-color)',
  fontSize: '14px',
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)'
};

const labelStyle = {
  display: 'block',
  marginBottom: '5px',
  fontSize: '14px',
  color: 'var(--text-secondary)',
  fontWeight: '500'
};

const BankConnectionsManager = ({ user }) => {
  // Get sessionId from localStorage (where it's stored after login)
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    const storedSessionId = localStorage.getItem('sessionId');
    setSessionId(storedSessionId);
  }, []);

  // State
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [fileList, setFileList] = useState(null);
  const [currentRemotePath, setCurrentRemotePath] = useState('/');
  const [showLogs, setShowLogs] = useState(false);

  // Form state for new connection
  const [newConnection, setNewConnection] = useState({
    bankId: '',
    connectionName: '',
    connectionType: 'sftp',
    host: '',
    port: 22,
    username: '',
    password: '',
    privateKeyPath: '',
    remotePath: '/',
    keySource: 'settings' // 'file' or 'settings'
  });

  // Dialog hook
  const { dialogState, showConfirm, showError, showSuccess, hideDialog } = useDialog();

  // Subscribe to data
  const connectionsReady = useTracker(() => {
    if (!sessionId) return false;
    const handle = Meteor.subscribe('bankConnections', sessionId);
    return handle.ready();
  }, [sessionId]);

  const logsReady = useTracker(() => {
    if (!sessionId) return false;
    const handle = Meteor.subscribe('bankConnectionLogs', sessionId, selectedConnection?._id, 50);
    return handle.ready();
  }, [sessionId, selectedConnection?._id]);

  // Get connections
  const connections = useTracker(() => {
    if (!connectionsReady) return [];
    return BankConnectionsCollection.find({ isActive: true }, { sort: { createdAt: -1 } }).fetch();
  }, [connectionsReady]);

  // Get banks for dropdown
  const banks = useTracker(() => {
    return BanksCollection.find({ isActive: true }, { sort: { name: 1 } }).fetch();
  }, []);

  // Get logs for selected connection
  const logs = useTracker(() => {
    if (!logsReady || !selectedConnection) return [];
    return BankConnectionLogsCollection.find(
      { connectionId: selectedConnection._id },
      { sort: { timestamp: -1 }, limit: 50 }
    ).fetch();
  }, [logsReady, selectedConnection?._id]);

  // Handle form input change
  const handleInputChange = (field, value) => {
    setNewConnection(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Create new connection
  const handleCreateConnection = async () => {
    // Validate sessionId is available
    if (!sessionId) {
      showError('Session not ready. Please refresh the page and try again.');
      return;
    }

    if (!newConnection.bankId || !newConnection.connectionName || !newConnection.host || !newConnection.username) {
      showError('Please fill in all required fields');
      return;
    }

    if (!newConnection.password && !newConnection.privateKeyPath) {
      showError('Please provide either a password or private key path');
      return;
    }

    setIsCreating(true);

    try {
      // Sanitize data - convert empty strings to null for optional fields
      const connectionData = {
        bankId: newConnection.bankId,
        connectionName: newConnection.connectionName,
        connectionType: newConnection.connectionType,
        host: newConnection.host,
        port: parseInt(newConnection.port) || 22,
        username: newConnection.username,
        password: newConnection.password || null,
        privateKeyPath: newConnection.privateKeyPath || null,
        remotePath: newConnection.remotePath || '/',
        sessionId
      };

      // Debug logging
      console.log('[BankConnections] Creating connection with:', {
        ...connectionData,
        sessionIdType: typeof sessionId,
        sessionIdValue: sessionId
      });

      const result = await Meteor.callAsync('bankConnections.create', connectionData);

      showSuccess('Connection created successfully');

      // Reset form
      setNewConnection({
        bankId: '',
        connectionName: '',
        connectionType: 'sftp',
        host: '',
        port: 22,
        username: '',
        password: '',
        privateKeyPath: '',
        remotePath: '/'
      });

    } catch (error) {
      console.error('Failed to create connection:', error);
      showError(`Failed to create connection: ${error.reason || error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Test connection
  const handleTestConnection = async (connection) => {
    setIsTesting(true);
    setTestResult(null);
    setSelectedConnection(connection);

    try {
      const result = await Meteor.callAsync('bankConnections.test', {
        connectionId: connection._id,
        sessionId
      });

      setTestResult({
        success: true,
        message: result.message,
        fileCount: result.fileCount
      });

      showSuccess(`Connection successful! Found ${result.fileCount} files in remote directory.`);

    } catch (error) {
      console.error('Connection test failed:', error);
      setTestResult({
        success: false,
        message: error.reason || error.message
      });
      showError(`Connection failed: ${error.reason || error.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  // List files
  const handleListFiles = async (connection, remotePath = null) => {
    setIsListing(true);
    setFileList(null);
    setSelectedConnection(connection);

    try {
      const result = await Meteor.callAsync('bankConnections.listFiles', {
        connectionId: connection._id,
        remotePath,
        sessionId
      });

      setFileList(result.files);
      setCurrentRemotePath(result.path);
      showSuccess(`Found ${result.files.length} files in ${result.path}`);

    } catch (error) {
      console.error('File listing failed:', error);
      showError(`Failed to list files: ${error.reason || error.message}`);
    } finally {
      setIsListing(false);
    }
  };

  // Download file
  const handleDownloadFile = async (file) => {
    if (file.isDirectory) {
      showError('Cannot download directories');
      return;
    }

    setIsDownloading(true);

    try {
      // Construct full file path from current remote path and file name
      const fullPath = `${currentRemotePath}/${file.name}`.replace(/\/+/g, '/');

      const result = await Meteor.callAsync('bankConnections.downloadFile', {
        connectionId: selectedConnection._id,
        filePath: fullPath,
        sessionId
      });

      // Convert base64 to blob and trigger download
      const byteCharacters = atob(result.fileBuffer);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray]);

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName || file.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showSuccess(`Downloaded: ${result.fileName}`);

    } catch (error) {
      console.error('File download failed:', error);
      showError(`Failed to download file: ${error.reason || error.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  // Download all files
  const handleDownloadAllFiles = async (connection) => {
    setIsDownloadingAll(true);
    setSelectedConnection(connection);

    try {
      const result = await Meteor.callAsync('bankConnections.downloadAllFiles', {
        connectionId: connection._id,
        sessionId
      });

      showSuccess(
        `Downloaded ${result.newFiles.length} new files. ` +
        `Skipped ${result.skippedFiles.length} existing files. ` +
        (result.failedFiles.length > 0 ? `${result.failedFiles.length} failed.` : '')
      );

    } catch (error) {
      console.error('Download all failed:', error);
      showError(`Failed to download all files: ${error.reason || error.message}`);
    } finally {
      setIsDownloadingAll(false);
    }
  };

  // Delete connection
  const handleDeleteConnection = async (connection) => {
    const confirmed = await new Promise((resolve) => {
      showConfirm(
        `Delete connection "${connection.connectionName}"?`,
        () => resolve(true),
        () => resolve(false)
      );
    });

    if (!confirmed) return;

    try {
      await Meteor.callAsync('bankConnections.delete', {
        connectionId: connection._id,
        sessionId
      });

      showSuccess('Connection deleted successfully');

      if (selectedConnection?._id === connection._id) {
        setSelectedConnection(null);
      }

    } catch (error) {
      console.error('Failed to delete connection:', error);
      showError(`Failed to delete connection: ${error.reason || error.message}`);
    }
  };

  // Get status indicator
  const getStatusIndicator = (status) => {
    switch (status) {
      case 'connected': return '🟢';
      case 'error': return '🔴';
      case 'not_tested': return '⚪';
      default: return '🟡';
    }
  };

  // Get status text
  const getStatusText = (status) => {
    switch (status) {
      case 'connected': return 'Connected';
      case 'error': return 'Error';
      case 'not_tested': return 'Not Tested';
      default: return 'Unknown';
    }
  };

  // Format timestamp
  const formatTimestamp = (date) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleString();
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-primary)', fontSize: '24px', fontWeight: '600' }}>
        🔌 Bank Connection Manager
      </h2>

      {/* Create New Connection Form */}
      <section style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '12px',
        marginBottom: '2rem',
        border: '2px solid var(--border-color)'
      }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '18px', fontWeight: '600' }}>
          Create New Connection
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>Bank *</label>
            <select value={newConnection.bankId} onChange={(e) => handleInputChange('bankId', e.target.value)} style={inputStyle}>
              <option value="">Select a bank...</option>
              {banks.map(bank => (
                <option key={bank._id} value={bank._id}>{bank.name} ({bank.city}, {bank.country})</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Connection Name *</label>
            <input type="text" value={newConnection.connectionName} onChange={(e) => handleInputChange('connectionName', e.target.value)}
              placeholder="e.g., Julius Baer SFTP Production" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Connection Type *</label>
            <select value={newConnection.connectionType} onChange={(e) => handleInputChange('connectionType', e.target.value)} style={inputStyle}>
              <option value="sftp">SFTP (SSH File Transfer)</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Host *</label>
            <input type="text" value={newConnection.host} onChange={(e) => handleInputChange('host', e.target.value)}
              placeholder="e.g., sftp.bank.com" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Port</label>
            <input type="number" value={newConnection.port} onChange={(e) => handleInputChange('port', e.target.value)}
              placeholder="22" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Username *</label>
            <input type="text" value={newConnection.username} onChange={(e) => handleInputChange('username', e.target.value)}
              placeholder="SFTP username" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input type="password" value={newConnection.password} onChange={(e) => handleInputChange('password', e.target.value)}
              placeholder="Leave blank if using SSH key" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>SSH Key Source</label>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  value="file"
                  checked={newConnection.keySource === 'file'}
                  onChange={(e) => handleInputChange('keySource', e.target.value)}
                />
                <span>File Path</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  value="settings"
                  checked={newConnection.keySource === 'settings'}
                  onChange={(e) => handleInputChange('keySource', e.target.value)}
                />
                <span>From Settings</span>
              </label>
            </div>

            {newConnection.keySource === 'file' ? (
              <input
                type="text"
                value={newConnection.privateKeyPath || ''}
                onChange={(e) => handleInputChange('privateKeyPath', e.target.value)}
                placeholder="e.g., /home/user/.ssh/jb_sftp"
                style={inputStyle}
              />
            ) : (
              <select
                value={newConnection.privateKeyPath || ''}
                onChange={(e) => handleInputChange('privateKeyPath', e.target.value)}
                style={inputStyle}
              >
                <option value="">Select SSH key from settings...</option>
                <option value="SETTINGS:SFTP_PRIVATE_KEY">Default SFTP Key (shared for all banks)</option>
              </select>
            )}
            <small style={{ display: 'block', marginTop: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              {newConnection.keySource === 'file'
                ? 'Path to SSH private key file on server filesystem (not recommended for Docker)'
                : 'SSH key stored in application settings (recommended)'}
            </small>
          </div>

          <div>
            <label style={labelStyle}>Remote Path</label>
            <input type="text" value={newConnection.remotePath} onChange={(e) => handleInputChange('remotePath', e.target.value)}
              placeholder="Default: /" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
          <button onClick={handleCreateConnection} disabled={isCreating || !sessionId} style={{
            padding: '10px 20px',
            backgroundColor: (isCreating || !sessionId) ? 'var(--text-muted)' : 'var(--accent-color)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: (isCreating || !sessionId) ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: '600'
          }}>
            {isCreating ? 'Creating...' : '✚ Create Connection'}
          </button>

          {!sessionId && (
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              ⏳ Waiting for session...
            </span>
          )}
        </div>
      </section>

      {/* Connections List */}
      <section>
        <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '18px', fontWeight: '600' }}>
          Existing Connections ({connections.length})
        </h3>

        {connections.length === 0 ? (
          <div style={{
            padding: '3rem',
            textAlign: 'center',
            background: 'var(--bg-secondary)',
            borderRadius: '12px',
            color: 'var(--text-muted)',
            border: '2px dashed var(--border-color)'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '1rem' }}>🔌</div>
            <div style={{ fontSize: '16px' }}>No connections yet. Create your first connection above.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {connections.map(connection => {
              const bank = banks.find(b => b._id === connection.bankId);
              const isSelected = selectedConnection?._id === connection._id;

              return (
                <div key={connection._id} style={{
                  background: 'var(--bg-primary)',
                  padding: '1.5rem',
                  borderRadius: '12px',
                  border: `2px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'}`,
                  transition: 'all 0.2s ease'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: '1rem' }}>
                    <div style={{ flex: 1, minWidth: '300px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '24px' }}>{getStatusIndicator(connection.status)}</span>
                        <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '16px', fontWeight: '600' }}>
                          {connection.connectionName}
                        </h4>
                        <span style={{
                          padding: '3px 10px',
                          background: 'var(--accent-color)',
                          color: 'white',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '600',
                          textTransform: 'uppercase'
                        }}>
                          {connection.connectionType}
                        </span>
                      </div>

                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                        <strong>Bank:</strong> {bank?.name || 'Unknown'} •
                        <strong> Host:</strong> {connection.host}:{connection.port} •
                        <strong> User:</strong> {connection.username}
                      </div>

                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <strong>Status:</strong> {getStatusText(connection.status)} •
                        <strong> Last Connection:</strong> {formatTimestamp(connection.lastConnection)} •
                        <strong> Attempts:</strong> {connection.connectionCount || 0}
                      </div>

                      {connection.lastError && (
                        <div style={{
                          marginTop: '0.75rem',
                          padding: '0.75rem',
                          background: 'rgba(220, 53, 69, 0.1)',
                          borderLeft: '3px solid var(--danger-color)',
                          borderRadius: '6px',
                          fontSize: '12px',
                          color: 'var(--danger-color)'
                        }}>
                          <strong>Last Error:</strong> {connection.lastError}
                        </div>
                      )}

                      {connection.privateKeyPath && (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                          🔑 Using SSH key: <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>
                            {connection.privateKeyPath}
                          </code>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button onClick={() => handleTestConnection(connection)} disabled={isTesting} style={{
                        padding: '8px 14px',
                        background: 'var(--success-color)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: isTesting ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                        fontWeight: '600',
                        opacity: isTesting && isSelected ? 0.6 : 1
                      }}>
                        {isTesting && isSelected ? '⏳ Testing...' : '🔌 Test'}
                      </button>

                      <button onClick={() => handleListFiles(connection)} disabled={isListing || connection.status !== 'connected'} style={{
                        padding: '8px 14px',
                        background: connection.status === 'connected' ? 'var(--accent-color)' : 'var(--text-muted)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: (isListing || connection.status !== 'connected') ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                        fontWeight: '600',
                        opacity: isListing && isSelected ? 0.6 : 1
                      }}>
                        {isListing && isSelected ? '⏳ Listing...' : '📁 Files'}
                      </button>

                      <button onClick={() => handleDownloadAllFiles(connection)} disabled={isDownloadingAll || connection.status !== 'connected'} style={{
                        padding: '8px 14px',
                        background: connection.status === 'connected' ? 'var(--success-color)' : 'var(--text-muted)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: (isDownloadingAll || connection.status !== 'connected') ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                        fontWeight: '600',
                        opacity: isDownloadingAll && isSelected ? 0.6 : 1
                      }}>
                        {isDownloadingAll && isSelected ? '⏳ Downloading...' : '⬇️ Download All'}
                      </button>

                      <button onClick={() => { setSelectedConnection(connection); setShowLogs(!showLogs); }} style={{
                        padding: '8px 14px',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: '600'
                      }}>
                        📋 Logs
                      </button>

                      <button onClick={() => handleDeleteConnection(connection)} style={{
                        padding: '8px 14px',
                        background: 'var(--danger-color)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: '600'
                      }}>
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* File List */}
      {fileList && (
        <section style={{
          marginTop: '2rem',
          background: 'var(--bg-secondary)',
          padding: '1.5rem',
          borderRadius: '12px',
          border: '2px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '18px', fontWeight: '600' }}>
              📁 Remote Files ({fileList.length})
            </h3>
            <button onClick={() => setFileList(null)} style={{
              padding: '6px 12px',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '2px solid var(--border-color)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600'
            }}>
              ✕ Close
            </button>
          </div>

          <div style={{ maxHeight: '400px', overflowY: 'auto', background: 'var(--bg-primary)', borderRadius: '8px', border: '2px solid var(--border-color)' }}>
            <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                <tr>
                  <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)', fontWeight: '600' }}>Name</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: 'var(--text-primary)', fontWeight: '600' }}>Size</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)', fontWeight: '600' }}>Modified</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)', fontWeight: '600' }}>Type</th>
                  <th style={{ padding: '12px', textAlign: 'center', color: 'var(--text-primary)', fontWeight: '600' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fileList.map((file, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid var(--border-color-light)' }}>
                    <td style={{ padding: '10px', color: 'var(--text-primary)' }}>
                      {file.isDirectory ? '📁' : '📄'} {file.name}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {file.isDirectory ? '-' : `${(file.size / 1024).toFixed(2)} KB`}
                    </td>
                    <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                      {new Date(file.modified).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                      {file.isDirectory ? 'Directory' : 'File'}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'center' }}>
                      {!file.isDirectory && (
                        <button
                          onClick={() => handleDownloadFile(file)}
                          disabled={isDownloading}
                          style={{
                            padding: '6px 12px',
                            background: isDownloading ? 'var(--text-muted)' : 'var(--accent-color)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: isDownloading ? 'not-allowed' : 'pointer',
                            fontSize: '12px',
                            fontWeight: '600'
                          }}
                        >
                          {isDownloading ? '⏳' : '⬇️ Download'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Connection Logs */}
      {showLogs && selectedConnection && (
        <section style={{
          marginTop: '2rem',
          background: 'var(--bg-secondary)',
          padding: '1.5rem',
          borderRadius: '12px',
          border: '2px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '18px', fontWeight: '600' }}>
              📋 Connection Logs - {selectedConnection.connectionName}
            </h3>
            <button onClick={() => setShowLogs(false)} style={{
              padding: '6px 12px',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '2px solid var(--border-color)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600'
            }}>
              ✕ Close
            </button>
          </div>

          <div style={{ maxHeight: '400px', overflowY: 'auto', background: 'var(--bg-primary)', borderRadius: '8px', border: '2px solid var(--border-color)' }}>
            {logs.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No logs available for this connection.
              </div>
            ) : (
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)' }}>
                  <tr>
                    <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)', fontWeight: '600' }}>Timestamp</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)', fontWeight: '600' }}>Action</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)', fontWeight: '600' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: 'var(--text-primary)', fontWeight: '600' }}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, index) => (
                    <tr key={index} style={{ borderBottom: '1px solid var(--border-color-light)' }}>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <span style={{
                          padding: '3px 8px',
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-primary)',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: '600',
                          textTransform: 'uppercase'
                        }}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <span style={{
                          padding: '3px 8px',
                          background: log.status === 'success' ? 'rgba(40, 167, 69, 0.1)' : log.status === 'failed' ? 'rgba(220, 53, 69, 0.1)' : 'rgba(255, 193, 7, 0.1)',
                          color: log.status === 'success' ? 'var(--success-color)' : log.status === 'failed' ? 'var(--danger-color)' : '#ffc107',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: '600',
                          textTransform: 'uppercase'
                        }}>
                          {log.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--text-primary)' }}>
                        {log.message}
                        {log.error && (
                          <div style={{ color: 'var(--danger-color)', fontSize: '11px', marginTop: '4px' }}>
                            Error: {log.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      <Dialog {...dialogState} onClose={hideDialog} />
    </div>
  );
};

export default BankConnectionsManager;
