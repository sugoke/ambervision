import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { BankConnectionsCollection } from '../api/bankConnections.js';
import { BankConnectionLogsCollection } from '../api/bankConnectionLogs.js';
import { CronJobLogsCollection } from '../api/cronJobLogs.js';
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

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // State
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [isProcessingPositions, setIsProcessingPositions] = useState(false);
  const [isTestProcessing, setIsTestProcessing] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [fileList, setFileList] = useState(null);
  const [currentRemotePath, setCurrentRemotePath] = useState('/');
  const [showLogs, setShowLogs] = useState(false);

  // Form state for new connection
  const [newConnection, setNewConnection] = useState({
    bankId: '',
    connectionName: '',
    connectionType: 'sftp',  // 'sftp' or 'local'
    host: '',
    port: 22,
    username: '',
    password: '',
    privateKeyPath: '',
    remotePath: '/',
    keySource: 'settings', // 'file' or 'settings'
    localFolderName: ''    // For 'local' type: folder name relative to bankfiles/
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

  const cronLogsReady = useTracker(() => {
    if (!sessionId) return false;
    const handle = Meteor.subscribe('bankFileSyncLogs', sessionId, 10);
    return handle.ready();
  }, [sessionId]);

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

  // Get CRON job logs for bank file sync
  const cronLogs = useTracker(() => {
    if (!cronLogsReady) return [];
    return CronJobLogsCollection.find(
      { jobName: 'bankFileSync' },
      { sort: { startTime: -1 }, limit: 10 }
    ).fetch();
  }, [cronLogsReady]);

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

    // Common validation
    if (!newConnection.bankId || !newConnection.connectionName) {
      showError('Please fill in Bank and Connection Name');
      return;
    }

    // Type-specific validation
    if (newConnection.connectionType === 'sftp') {
      if (!newConnection.host || !newConnection.username) {
        showError('Please fill in Host and Username for SFTP connection');
        return;
      }
      if (!newConnection.password && !newConnection.privateKeyPath) {
        showError('Please provide either a password or private key path');
        return;
      }
    } else if (newConnection.connectionType === 'local') {
      if (!newConnection.localFolderName) {
        showError('Please provide a folder name for local connection');
        return;
      }
    }

    setIsCreating(true);

    try {
      // Build connection data based on type
      const connectionData = {
        bankId: newConnection.bankId,
        connectionName: newConnection.connectionName,
        connectionType: newConnection.connectionType,
        sessionId
      };

      if (newConnection.connectionType === 'sftp') {
        // SFTP-specific fields
        connectionData.host = newConnection.host;
        connectionData.port = parseInt(newConnection.port) || 22;
        connectionData.username = newConnection.username;
        connectionData.password = newConnection.password || null;
        connectionData.privateKeyPath = newConnection.privateKeyPath || null;
        connectionData.remotePath = newConnection.remotePath || '/';
      } else if (newConnection.connectionType === 'local') {
        // Local folder-specific fields
        connectionData.localFolderName = newConnection.localFolderName;
      }

      // Debug logging
      console.log('[BankConnections] Creating connection with:', {
        ...connectionData,
        sessionIdType: typeof sessionId,
        sessionIdValue: sessionId
      });

      const result = await Meteor.callAsync('bankConnections.create', connectionData);

      showSuccess(`${newConnection.connectionType === 'local' ? 'Local folder' : 'SFTP'} connection created successfully`);

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
        remotePath: '/',
        keySource: 'settings',
        localFolderName: ''
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
    // Don't clear fileList when navigating folders - just show loading state
    setSelectedConnection(connection);

    try {
      const result = await Meteor.callAsync('bankConnections.listFiles', {
        connectionId: connection._id,
        remotePath,
        sessionId
      });

      // Sort: folders first, then files, both alphabetically
      const sortedFiles = [...result.files].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      setFileList(sortedFiles);
      setCurrentRemotePath(result.path);
      const folderCount = sortedFiles.filter(f => f.isDirectory).length;
      const fileCount = sortedFiles.filter(f => !f.isDirectory).length;
      showSuccess(`Found ${folderCount} folders, ${fileCount} files in ${result.path}`);

    } catch (error) {
      console.error('File listing failed:', error);
      showError(`Failed to list files: ${error.reason || error.message}`);
    } finally {
      setIsListing(false);
    }
  };

  // Navigate into a folder
  const handleOpenFolder = (folderName) => {
    if (!selectedConnection) return;
    const newPath = `${currentRemotePath}/${folderName}`.replace(/\/+/g, '/');
    handleListFiles(selectedConnection, newPath);
  };

  // Navigate to parent folder
  const handleGoBack = () => {
    if (!selectedConnection || currentRemotePath === '/') return;
    const parts = currentRemotePath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = '/' + parts.join('/');
    handleListFiles(selectedConnection, parentPath);
  };

  // Navigate to specific path from breadcrumb
  const handleBreadcrumbClick = (pathIndex) => {
    if (!selectedConnection) return;
    const parts = currentRemotePath.split('/').filter(Boolean);
    const newPath = '/' + parts.slice(0, pathIndex + 1).join('/');
    handleListFiles(selectedConnection, newPath);
  };

  // Download file
  const handleDownloadFile = async (file) => {
    if (file.isDirectory) {
      showError('Cannot download directories');
      return;
    }

    setIsDownloading(true);

    // Safety timeout for individual file downloads (2 minutes)
    const timeoutId = setTimeout(() => {
      if (isMountedRef.current) {
        console.warn('[BankConnections] Individual file download timeout');
        setIsDownloading(false);
        showError('File download timed out. Please try again.');
      }
    }, 2 * 60 * 1000);

    try {
      // Construct full file path from current remote path and file name
      const fullPath = `${currentRemotePath}/${file.name}`.replace(/\/+/g, '/');

      const result = await Meteor.callAsync('bankConnections.downloadFile', {
        connectionId: selectedConnection._id,
        filePath: fullPath,
        sessionId
      });

      clearTimeout(timeoutId);

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

      if (isMountedRef.current) {
        showSuccess(`Downloaded: ${result.fileName}`);
      }

    } catch (error) {
      clearTimeout(timeoutId);
      console.error('File download failed:', error);
      if (isMountedRef.current) {
        showError(`Failed to download file: ${error.reason || error.message}`);
      }
    } finally {
      clearTimeout(timeoutId);
      if (isMountedRef.current) {
        setIsDownloading(false);
      }
    }
  };

  // Download all files
  const handleDownloadAllFiles = async (connection) => {
    setIsDownloadingAll(true);
    setSelectedConnection(connection);

    // Safety timeout: reset button after 5 minutes max to prevent stuck state
    const timeoutId = setTimeout(() => {
      if (isMountedRef.current) {
        console.warn('[BankConnections] Download timeout - resetting state after 5 minutes');
        setIsDownloadingAll(false);
        showError('Download operation timed out after 5 minutes. Please check the connection and try again.');
      }
    }, 5 * 60 * 1000);

    try {
      const result = await Meteor.callAsync('bankConnections.downloadAllFiles', {
        connectionId: connection._id,
        sessionId
      });

      clearTimeout(timeoutId);

      if (isMountedRef.current) {
        showSuccess(
          `Downloaded ${result.newFiles.length} new files. ` +
          `Skipped ${result.skippedFiles.length} existing files. ` +
          (result.failedFiles.length > 0 ? `${result.failedFiles.length} failed.` : '')
        );
      }

    } catch (error) {
      clearTimeout(timeoutId);
      console.error('Download all failed:', error);
      if (isMountedRef.current) {
        showError(`Failed to download all files: ${error.reason || error.message}`);
      }
    } finally {
      clearTimeout(timeoutId);
      if (isMountedRef.current) {
        setIsDownloadingAll(false);
      }
    }
  };

  // Process latest positions file
  const handleProcessPositions = async (connection) => {
    setIsProcessingPositions(true);
    setSelectedConnection(connection);

    try {
      const result = await Meteor.callAsync('bankPositions.processLatest', {
        connectionId: connection._id,
        sessionId
      });

      // Build detailed message for positions
      const posMsg = `Positions: ${result.positions.newRecords} new, ${result.positions.updatedRecords} updated` +
        (result.positions.unchangedRecords > 0 ? `, ${result.positions.unchangedRecords} unchanged` : '') +
        (result.positions.skippedRecords > 0 ? `, ${result.positions.skippedRecords} skipped` : '');

      // Build detailed message for operations
      const opMsg = result.operations && result.operations.totalRecords > 0
        ? ` | Operations: ${result.operations.newRecords} new, ${result.operations.updatedRecords} updated` +
          (result.operations.skippedRecords > 0 ? `, ${result.operations.skippedRecords} skipped` : '')
        : ' | Operations: No operations file found';

      // Build warning message if there are unmapped portfolio codes
      let warningMsg = '';
      const hasUnmappedPos = result.positions.unmappedPositions > 0;
      const hasUnmappedOps = result.operations && result.operations.unmappedOperations > 0;

      if (hasUnmappedPos || hasUnmappedOps) {
        const unmappedDetails = [];

        if (hasUnmappedPos) {
          unmappedDetails.push(
            `${result.positions.unmappedPositions} positions skipped (unmapped portfolio codes: ${result.positions.unmappedPortfolioCodes?.join(', ') || 'unknown'})`
          );
        }

        if (hasUnmappedOps) {
          unmappedDetails.push(
            `${result.operations.unmappedOperations} operations skipped (unmapped portfolio codes: ${result.operations.unmappedPortfolioCodes?.join(', ') || 'unknown'})`
          );
        }

        warningMsg = '\n\n⚠️ WARNING: ' + unmappedDetails.join('. ') +
          '\n\nPlease create bank accounts with matching account numbers in the system.';
      }

      // Trigger PMS holdings refresh (for async publication reactivity in Meteor 3)
      window.dispatchEvent(new CustomEvent('pmsHoldingsRefresh', { detail: Date.now() }));

      // Show success with potential warning
      if (hasUnmappedPos || hasUnmappedOps) {
        showError(`Processed ${result.positions.filename}. ${posMsg}${opMsg}${warningMsg}`);
      } else {
        showSuccess(`Processed ${result.positions.filename}. ${posMsg}${opMsg}`);
      }

    } catch (error) {
      console.error('Process positions failed:', error);
      showError(`Failed to process positions: ${error.reason || error.message}`);
    } finally {
      setIsProcessingPositions(false);
    }
  };

  // TEST: Process Julius Baer positions and operations from bankfiles/julius-baer/
  const handleTestProcessJuliusBaer = async () => {
    setIsTestProcessing(true);

    try {
      const result = await Meteor.callAsync('bankPositions.testProcessJuliusBaer', {
        sessionId
      });

      const posMsg = result.positions
        ? `Positions: ${result.positions.totalRecords} from ${result.positions.filename} (${result.positions.newRecords} new, ${result.positions.updatedRecords} updated)`
        : 'No positions processed';

      const opMsg = result.operations && result.operations.totalRecords > 0
        ? ` | Operations: ${result.operations.totalRecords} from ${result.operations.filename} (${result.operations.newRecords} new, ${result.operations.updatedRecords} updated)`
        : ' | No operations found';

      // Trigger PMS holdings refresh (for async publication reactivity in Meteor 3)
      window.dispatchEvent(new CustomEvent('pmsHoldingsRefresh', { detail: Date.now() }));

      showSuccess(`TEST SUCCESS: ${posMsg}${opMsg}`);

    } catch (error) {
      console.error('Test process failed:', error);
      showError(`TEST FAILED: ${error.reason || error.message}`);
    } finally {
      setIsTestProcessing(false);
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

  // Check if a date is from today
  const isToday = (date) => {
    if (!date) return false;
    const d = new Date(date);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() &&
           d.getMonth() === today.getMonth() &&
           d.getDate() === today.getDate();
  };

  // Get status indicator - check both status and recency
  const getStatusIndicator = (connection) => {
    // If there's an error status, show red
    if (connection.status === 'error') return '🔴';

    // If never tested, show white
    if (connection.status === 'not_tested') return '⚪';

    // If status is "connected" but last connection/download/process wasn't today, show red
    if (connection.status === 'connected') {
      const hasRecentActivity = isToday(connection.lastConnection) ||
                                isToday(connection.lastDownloadAt) ||
                                isToday(connection.lastProcessedAt);
      return hasRecentActivity ? '🟢' : '🔴';
    }

    return '🟡';
  };

  // Get status text - includes staleness information
  const getStatusText = (connection) => {
    if (connection.status === 'error') return 'Error';
    if (connection.status === 'not_tested') return 'Not Tested';

    if (connection.status === 'connected') {
      const hasRecentActivity = isToday(connection.lastConnection) ||
                                isToday(connection.lastDownloadAt) ||
                                isToday(connection.lastProcessedAt);
      return hasRecentActivity ? 'Connected' : 'Stale (no sync today)';
    }

    return 'Unknown';
  };

  // Format timestamp
  const formatTimestamp = (date) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleString();
  };

  return (
    <div style={{ padding: 'min(2rem, 5vw)', maxWidth: '1400px', margin: '0 auto' }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: '1rem' }}>
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
              <option value="sftp">SFTP (Download from server)</option>
              <option value="local">Local Folder (Bank uploads files)</option>
            </select>
          </div>

          {/* SFTP-specific fields */}
          {newConnection.connectionType === 'sftp' && (
            <>
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
            </>
          )}

          {/* Local folder-specific fields */}
          {newConnection.connectionType === 'local' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{
                padding: '1rem',
                background: 'rgba(59, 130, 246, 0.1)',
                borderRadius: '8px',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                marginBottom: '1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '18px' }}>ℹ️</span>
                  <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Local Folder Connection</span>
                </div>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  Files are uploaded by the bank directly to this folder. No download will be performed during processing.
                  The system will only check for new files and process them.
                </p>
              </div>

              <label style={labelStyle}>Folder Name *</label>
              <input
                type="text"
                value={newConnection.localFolderName}
                onChange={(e) => handleInputChange('localFolderName', e.target.value)}
                placeholder="e.g., julius-baer"
                style={inputStyle}
              />
              <small style={{ display: 'block', marginTop: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Folder name relative to <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px' }}>bankfiles/</code> directory.
                {newConnection.localFolderName && (
                  <span style={{ display: 'block', marginTop: '0.25rem', color: 'var(--accent-color)' }}>
                    Full path: bankfiles/{newConnection.localFolderName}
                  </span>
                )}
              </small>
            </div>
          )}
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

          <button onClick={handleTestProcessJuliusBaer} disabled={isTestProcessing || !sessionId} style={{
            padding: '10px 20px',
            backgroundColor: (isTestProcessing || !sessionId) ? 'var(--text-muted)' : '#f59e0b',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: (isTestProcessing || !sessionId) ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: '600'
          }}>
            {isTestProcessing ? '⏳ Testing...' : '🧪 Test JB Parser'}
          </button>

          {!sessionId && (
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              ⏳ Waiting for session...
            </span>
          )}
        </div>
      </section>

      {/* CRON Job Sync Summary */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '18px', fontWeight: '600' }}>
          Bank File Sync History
        </h3>

        {cronLogs.length === 0 ? (
          <div style={{
            padding: '1.5rem',
            background: 'var(--bg-secondary)',
            borderRadius: '12px',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}>
            No sync jobs have been recorded yet.
          </div>
        ) : (
          <div style={{
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            overflow: 'hidden'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Status</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Started</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Duration</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Connections</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Files</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: 'var(--text-secondary)' }}>Triggered By</th>
                </tr>
              </thead>
              <tbody>
                {cronLogs.map((log, index) => (
                  <tr key={log._id} style={{
                    borderTop: index > 0 ? '1px solid var(--border-color)' : 'none',
                    background: index % 2 === 0 ? 'transparent' : 'var(--bg-secondary)'
                  }}>
                    <td style={{ padding: '12px' }}>
                      {(() => {
                        // Determine effective status - if "success" but has failures, show as "partial"
                        const hasFailed = log.details?.connectionsFailed > 0;
                        const effectiveStatus = log.status === 'success' && hasFailed ? 'partial' : log.status;

                        return (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: '600',
                            background: effectiveStatus === 'success' ? 'rgba(16, 185, 129, 0.15)' :
                                       effectiveStatus === 'error' ? 'rgba(239, 68, 68, 0.15)' :
                                       'rgba(251, 191, 36, 0.15)',
                            color: effectiveStatus === 'success' ? 'var(--success-color)' :
                                   effectiveStatus === 'error' ? 'var(--danger-color)' :
                                   'var(--warning-color)'
                          }}>
                            {effectiveStatus === 'success' ? '✓' : effectiveStatus === 'error' ? '✗' : '⚠'}
                            {effectiveStatus}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-primary)' }}>
                      {log.startTime ? new Date(log.startTime).toLocaleString() : 'N/A'}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                      {log.duration ? `${(log.duration / 1000).toFixed(1)}s` : 'N/A'}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-primary)' }}>
                      {log.details?.connectionsSucceeded ?? 0}/{log.details?.connectionsProcessed ?? 0}
                      {log.details?.connectionsFailed > 0 && (
                        <span style={{ color: 'var(--danger-color)', marginLeft: '4px' }}>
                          ({log.details.connectionsFailed} failed)
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                      {log.details?.filesDownloaded ?? 0} downloaded
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-muted)' }}>
                      {log.triggeredBy === 'cron' ? '🕐 Scheduled' : '👤 Manual'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                        <span style={{ fontSize: '24px' }}>{getStatusIndicator(connection)}</span>
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
                        <strong>Bank:</strong> {bank?.name || 'Unknown'}
                        {connection.connectionType === 'sftp' ? (
                          <>
                            {' '}• <strong>Host:</strong> {connection.host}:{connection.port}
                            {' '}• <strong>User:</strong> {connection.username}
                          </>
                        ) : (
                          <>
                            {' '}• <strong>Folder:</strong> bankfiles/{connection.localFolderName}
                          </>
                        )}
                      </div>

                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <div>
                          <strong>Status:</strong> {getStatusText(connection)} •
                          <strong> Last Connection:</strong> {formatTimestamp(connection.lastConnection)} •
                          <strong> Attempts:</strong> {connection.connectionCount || 0}
                        </div>
                        <div style={{ marginTop: '4px' }}>
                          <strong>Last Download:</strong> {formatTimestamp(connection.lastDownloadAt)} •
                          <strong> Last Processed:</strong> {formatTimestamp(connection.lastProcessedAt)}
                        </div>
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

                      {/* Download All button - only show for SFTP connections */}
                      {connection.connectionType === 'sftp' && (
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
                      )}

                      <button onClick={() => handleProcessPositions(connection)} disabled={isProcessingPositions || connection.status !== 'connected'} style={{
                        padding: '8px 14px',
                        background: connection.status === 'connected' ? '#8b5cf6' : 'var(--text-muted)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: (isProcessingPositions || connection.status !== 'connected') ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                        fontWeight: '600',
                        opacity: isProcessingPositions && isSelected ? 0.6 : 1
                      }}>
                        {isProcessingPositions && isSelected ? '⏳ Processing...' : '📊 Process Files'}
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

          {/* Breadcrumb Navigation */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1rem',
            padding: '0.75rem',
            background: 'var(--bg-primary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            flexWrap: 'wrap'
          }}>
            {currentRemotePath !== '/' && (
              <button
                onClick={handleGoBack}
                disabled={isListing}
                style={{
                  padding: '4px 10px',
                  background: 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isListing ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  fontWeight: '600',
                  opacity: isListing ? 0.6 : 1
                }}
              >
                ⬅️ Back
              </button>
            )}
            <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Path:</span>
            <span
              onClick={() => selectedConnection && handleListFiles(selectedConnection, '/')}
              style={{
                color: 'var(--accent-color)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500'
              }}
            >
              /
            </span>
            {currentRemotePath.split('/').filter(Boolean).map((part, index, arr) => (
              <React.Fragment key={index}>
                <span style={{ color: 'var(--text-muted)' }}>/</span>
                <span
                  onClick={() => index < arr.length - 1 && handleBreadcrumbClick(index)}
                  style={{
                    color: index < arr.length - 1 ? 'var(--accent-color)' : 'var(--text-primary)',
                    cursor: index < arr.length - 1 ? 'pointer' : 'default',
                    fontSize: '13px',
                    fontWeight: index < arr.length - 1 ? '500' : '600'
                  }}
                >
                  {part}
                </span>
              </React.Fragment>
            ))}
            {isListing && (
              <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '12px' }}>
                ⏳ Loading...
              </span>
            )}
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
                  <tr
                    key={index}
                    onClick={() => file.isDirectory && handleOpenFolder(file.name)}
                    style={{
                      borderBottom: '1px solid var(--border-color-light)',
                      cursor: file.isDirectory ? 'pointer' : 'default',
                      transition: 'background 0.15s ease'
                    }}
                    onMouseEnter={(e) => file.isDirectory && (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                    onMouseLeave={(e) => file.isDirectory && (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px', color: 'var(--text-primary)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '16px' }}>{file.isDirectory ? '📁' : '📄'}</span>
                        <span style={{
                          color: file.isDirectory ? 'var(--accent-color)' : 'var(--text-primary)',
                          fontWeight: file.isDirectory ? '600' : '400'
                        }}>
                          {file.name}
                        </span>
                      </span>
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
                      {file.isDirectory ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenFolder(file.name); }}
                          disabled={isListing}
                          style={{
                            padding: '6px 12px',
                            background: isListing ? 'var(--text-muted)' : 'var(--accent-color)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: isListing ? 'not-allowed' : 'pointer',
                            fontSize: '12px',
                            fontWeight: '600'
                          }}
                        >
                          {isListing ? '⏳' : '📂 Open'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDownloadFile(file)}
                          disabled={isDownloading}
                          style={{
                            padding: '6px 12px',
                            background: isDownloading ? 'var(--text-muted)' : 'var(--success-color)',
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

          <div style={{ maxHeight: '500px', overflowY: 'auto', background: 'var(--bg-primary)', borderRadius: '8px', border: '2px solid var(--border-color)' }}>
            {logs.length === 0 ? (
              <div style={{ padding: 'min(2rem, 5vw)', textAlign: 'center', color: 'var(--text-muted)' }}>
                No logs available for this connection.
              </div>
            ) : (
              <div style={{ padding: '0' }}>
                {logs.map((log, index) => (
                  <div key={index} style={{
                    borderBottom: '1px solid var(--border-color-light)',
                    padding: '12px 16px',
                    background: index % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)'
                  }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '140px' }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
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
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>
                        {log.message}
                      </span>
                    </div>

                    {/* Error message if present */}
                    {log.error && (
                      <div style={{
                        color: 'var(--danger-color)',
                        fontSize: '12px',
                        marginBottom: '8px',
                        padding: '8px',
                        background: 'rgba(220, 53, 69, 0.1)',
                        borderRadius: '4px'
                      }}>
                        Error: {log.error}
                      </div>
                    )}

                    {/* File details from metadata */}
                    {log.metadata && (log.action === 'download_all' || log.action === 'process_positions') && (
                      <div style={{
                        marginTop: '8px',
                        padding: '10px',
                        background: 'var(--bg-tertiary)',
                        borderRadius: '6px',
                        fontSize: '12px'
                      }}>
                        {/* Download details */}
                        {log.action === 'download_all' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ color: 'var(--text-muted)', fontWeight: '600', marginBottom: '4px' }}>
                              📥 Download Details
                            </div>
                            {log.metadata.newFiles && log.metadata.newFiles.length > 0 && (
                              <div>
                                <span style={{ color: 'var(--success-color)', fontWeight: '600' }}>✓ Downloaded ({log.metadata.newFilesCount || log.metadata.newFiles.length}):</span>
                                <span style={{ color: 'var(--text-primary)', marginLeft: '8px' }}>
                                  {Array.isArray(log.metadata.newFiles) ? log.metadata.newFiles.join(', ') : log.metadata.newFiles}
                                </span>
                              </div>
                            )}
                            {log.metadata.skippedFiles && log.metadata.skippedFiles.length > 0 && (
                              <div>
                                <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}>⏭ Skipped ({log.metadata.skippedFilesCount || log.metadata.skippedFiles.length}):</span>
                                <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>
                                  {Array.isArray(log.metadata.skippedFiles) ? log.metadata.skippedFiles.join(', ') : log.metadata.skippedFiles}
                                </span>
                              </div>
                            )}
                            {log.metadata.failedFiles && log.metadata.failedFiles.length > 0 && (
                              <div>
                                <span style={{ color: 'var(--danger-color)', fontWeight: '600' }}>✗ Failed ({log.metadata.failedFilesCount || log.metadata.failedFiles.length}):</span>
                                <span style={{ color: 'var(--danger-color)', marginLeft: '8px' }}>
                                  {Array.isArray(log.metadata.failedFiles)
                                    ? log.metadata.failedFiles.map(f => typeof f === 'object' ? `${f.name} (${f.error})` : f).join(', ')
                                    : log.metadata.failedFiles}
                                </span>
                              </div>
                            )}
                            {(!log.metadata.newFiles || log.metadata.newFiles.length === 0) &&
                             (!log.metadata.skippedFiles || log.metadata.skippedFiles.length === 0) && (
                              <div style={{ color: 'var(--text-muted)' }}>No files to process</div>
                            )}
                          </div>
                        )}

                        {/* Process details */}
                        {log.action === 'process_positions' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ color: 'var(--text-muted)', fontWeight: '600', marginBottom: '4px' }}>
                              📊 Processing Details
                            </div>
                            {log.metadata.filename && (
                              <div>
                                <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}>File:</span>
                                <span style={{ color: 'var(--text-primary)', marginLeft: '8px', fontFamily: 'monospace' }}>
                                  {log.metadata.filename}
                                </span>
                                {log.metadata.fileDate && (
                                  <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                                    ({new Date(log.metadata.fileDate).toLocaleDateString()})
                                  </span>
                                )}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                              {log.metadata.totalRecords !== undefined && (
                                <span><strong style={{ color: 'var(--text-muted)' }}>Total:</strong> {log.metadata.totalRecords}</span>
                              )}
                              {log.metadata.newRecords !== undefined && (
                                <span style={{ color: 'var(--success-color)' }}><strong>New:</strong> {log.metadata.newRecords}</span>
                              )}
                              {log.metadata.updatedRecords !== undefined && (
                                <span style={{ color: '#17a2b8' }}><strong>Updated:</strong> {log.metadata.updatedRecords}</span>
                              )}
                              {log.metadata.unchangedRecords !== undefined && (
                                <span style={{ color: 'var(--text-muted)' }}><strong>Unchanged:</strong> {log.metadata.unchangedRecords}</span>
                              )}
                              {log.metadata.skippedRecords !== undefined && log.metadata.skippedRecords > 0 && (
                                <span style={{ color: '#ffc107' }}><strong>Skipped:</strong> {log.metadata.skippedRecords}</span>
                              )}
                            </div>
                            {log.metadata.unmappedPositions > 0 && (
                              <div style={{ color: '#ffc107' }}>
                                <strong>Unmapped positions:</strong> {log.metadata.unmappedPositions}
                                {log.metadata.unmappedPortfolioCodes && log.metadata.unmappedPortfolioCodes.length > 0 && (
                                  <span style={{ marginLeft: '8px' }}>
                                    (codes: {log.metadata.unmappedPortfolioCodes.join(', ')})
                                  </span>
                                )}
                              </div>
                            )}
                            {log.metadata.soldPositions > 0 && (
                              <div style={{ color: 'var(--text-muted)' }}>
                                <strong>Sold positions detected:</strong> {log.metadata.soldPositions}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <Dialog {...dialogState} onClose={hideDialog} />
    </div>
  );
};

export default BankConnectionsManager;
