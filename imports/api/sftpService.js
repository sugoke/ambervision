import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * SFTP Service for managing bank SFTP connections
 * Uses ssh2 library for SSH/SFTP operations
 */
export const SFTPService = {
  /**
   * Test SFTP connection
   * @param {Object} config - Connection configuration
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection(config) {
    const {
      host,
      port = 22,
      username,
      password = null,
      privateKeyPath = null,
      timeout = 30000
    } = config;

    return new Promise((resolve, reject) => {
      const conn = new Client();
      let connected = false;
      let sftpReady = false;

      // Set timeout for connection
      const timeoutId = setTimeout(() => {
        if (!connected) {
          conn.end();
          reject(new Error(`Connection timeout after ${timeout}ms`));
        }
      }, timeout);

      conn.on('ready', () => {
        connected = true;
        console.log(`[SFTP] Connected to ${host}:${port} as ${username}`);

        // Try to start SFTP session
        conn.sftp((err, sftp) => {
          if (err) {
            clearTimeout(timeoutId);
            conn.end();
            reject(new Error(`SFTP session failed: ${err.message}`));
            return;
          }

          sftpReady = true;
          console.log('[SFTP] SFTP session established');

          // Test by reading remote directory
          sftp.readdir('.', (err, list) => {
            clearTimeout(timeoutId);
            conn.end();

            if (err) {
              reject(new Error(`Directory read failed: ${err.message}`));
              return;
            }

            resolve({
              success: true,
              message: 'Connection successful',
              connected: true,
              sftpReady: true,
              fileCount: list ? list.length : 0,
              timestamp: new Date()
            });
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeoutId);
        console.error(`[SFTP] Connection error: ${err.message}`);
        reject(new Error(`Connection failed: ${err.message}`));
      });

      conn.on('end', () => {
        console.log('[SFTP] Connection closed');
      });

      // Prepare connection configuration
      const connectionConfig = {
        host,
        port,
        username,
        readyTimeout: timeout
      };

      // Use private key if provided, otherwise use password
      if (privateKeyPath) {
        try {
          let privateKey;

          // Check if key should be read from settings (format: SETTINGS:KEY_NAME)
          if (privateKeyPath.startsWith('SETTINGS:')) {
            const settingsKeyName = privateKeyPath.replace('SETTINGS:', '');

            // Import Meteor settings
            const { Meteor } = require('meteor/meteor');

            if (!Meteor.settings || !Meteor.settings.private || !Meteor.settings.private[settingsKeyName]) {
              throw new Error(`Settings key '${settingsKeyName}' not found in Meteor.settings.private`);
            }

            privateKey = Meteor.settings.private[settingsKeyName];
            console.log(`[SFTP] Using private key from settings: ${settingsKeyName}`);
          } else {
            // Expand ~ to home directory if present
            let expandedPath = privateKeyPath;
            if (privateKeyPath.startsWith('~/')) {
              expandedPath = path.join(os.homedir(), privateKeyPath.slice(2));
            } else if (privateKeyPath === '~') {
              expandedPath = os.homedir();
            }

            // Read private key from file system
            privateKey = fs.readFileSync(expandedPath, 'utf8');
            console.log(`[SFTP] Using private key from file: ${expandedPath}`);
          }

          connectionConfig.privateKey = privateKey;
        } catch (err) {
          clearTimeout(timeoutId);
          reject(new Error(`Failed to read private key from ${privateKeyPath}: ${err.message}`));
          return;
        }
      } else if (password) {
        connectionConfig.password = password;
        console.log('[SFTP] Using password authentication');
      } else {
        clearTimeout(timeoutId);
        reject(new Error('No authentication method provided (password or privateKey required)'));
        return;
      }

      // Connect
      try {
        console.log(`[SFTP] Connecting to ${host}:${port} as ${username}...`);
        conn.connect(connectionConfig);
      } catch (err) {
        clearTimeout(timeoutId);
        reject(new Error(`Connection failed: ${err.message}`));
      }
    });
  },

  /**
   * List files in remote directory
   * @param {Object} config - Connection configuration
   * @param {String} remotePath - Remote directory path
   * @returns {Promise<Array>} List of files
   */
  async listFiles(config, remotePath = '/') {
    const {
      host,
      port = 22,
      username,
      password = null,
      privateKeyPath = null,
      timeout = 30000
    } = config;

    return new Promise((resolve, reject) => {
      const conn = new Client();

      const timeoutId = setTimeout(() => {
        conn.end();
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            clearTimeout(timeoutId);
            conn.end();
            reject(new Error(`SFTP session failed: ${err.message}`));
            return;
          }

          sftp.readdir(remotePath, (err, list) => {
            clearTimeout(timeoutId);
            conn.end();

            if (err) {
              reject(new Error(`Failed to list directory ${remotePath}: ${err.message}`));
              return;
            }

            // Format file list
            const files = list.map(file => ({
              name: file.filename,
              size: file.attrs.size,
              modified: new Date(file.attrs.mtime * 1000),
              isDirectory: file.attrs.isDirectory(),
              permissions: file.attrs.mode
            }));

            resolve(files);
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`Connection failed: ${err.message}`));
      });

      // Prepare connection configuration
      const connectionConfig = {
        host,
        port,
        username,
        readyTimeout: timeout
      };

      if (privateKeyPath) {
        try {
          let privateKey;

          // Check if key should be read from settings (format: SETTINGS:KEY_NAME)
          if (privateKeyPath.startsWith('SETTINGS:')) {
            const settingsKeyName = privateKeyPath.replace('SETTINGS:', '');

            // Import Meteor settings
            const { Meteor } = require('meteor/meteor');

            if (!Meteor.settings || !Meteor.settings.private || !Meteor.settings.private[settingsKeyName]) {
              throw new Error(`Settings key '${settingsKeyName}' not found in Meteor.settings.private`);
            }

            privateKey = Meteor.settings.private[settingsKeyName];
          } else {
            // Expand ~ to home directory if present
            let expandedPath = privateKeyPath;
            if (privateKeyPath.startsWith('~/')) {
              expandedPath = path.join(os.homedir(), privateKeyPath.slice(2));
            } else if (privateKeyPath === '~') {
              expandedPath = os.homedir();
            }

            privateKey = fs.readFileSync(expandedPath, 'utf8');
          }

          connectionConfig.privateKey = privateKey;
        } catch (err) {
          clearTimeout(timeoutId);
          reject(new Error(`Failed to read private key: ${err.message}`));
          return;
        }
      } else if (password) {
        connectionConfig.password = password;
      } else {
        clearTimeout(timeoutId);
        reject(new Error('No authentication method provided'));
        return;
      }

      conn.connect(connectionConfig);
    });
  },

  /**
   * Download file from SFTP server
   * @param {Object} config - Connection configuration
   * @param {String} remoteFile - Remote file path
   * @param {String} localPath - Local destination path
   * @returns {Promise<Object>} Download result
   */
  async downloadFile(config, remoteFile, localPath) {
    const {
      host,
      port = 22,
      username,
      password = null,
      privateKeyPath = null,
      timeout = 120000  // 2 minutes (increased from 60s for large files)
    } = config;

    return new Promise((resolve, reject) => {
      const conn = new Client();

      const timeoutId = setTimeout(() => {
        conn.end();
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            clearTimeout(timeoutId);
            conn.end();
            reject(new Error(`SFTP session failed: ${err.message}`));
            return;
          }

          // Download file
          sftp.fastGet(remoteFile, localPath, (err) => {
            clearTimeout(timeoutId);
            conn.end();

            if (err) {
              reject(new Error(`Download failed: ${err.message}`));
              return;
            }

            // Get file stats
            const stats = fs.statSync(localPath);

            resolve({
              success: true,
              message: 'File downloaded successfully',
              remoteFile,
              localPath,
              size: stats.size,
              timestamp: new Date()
            });
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`Connection failed: ${err.message}`));
      });

      // Prepare connection configuration
      const connectionConfig = {
        host,
        port,
        username,
        readyTimeout: timeout
      };

      if (privateKeyPath) {
        try {
          let privateKey;

          // Check if key should be read from settings (format: SETTINGS:KEY_NAME)
          if (privateKeyPath.startsWith('SETTINGS:')) {
            const settingsKeyName = privateKeyPath.replace('SETTINGS:', '');

            // Import Meteor settings
            const { Meteor } = require('meteor/meteor');

            if (!Meteor.settings || !Meteor.settings.private || !Meteor.settings.private[settingsKeyName]) {
              throw new Error(`Settings key '${settingsKeyName}' not found in Meteor.settings.private`);
            }

            privateKey = Meteor.settings.private[settingsKeyName];
          } else {
            // Expand ~ to home directory if present
            let expandedPath = privateKeyPath;
            if (privateKeyPath.startsWith('~/')) {
              expandedPath = path.join(os.homedir(), privateKeyPath.slice(2));
            } else if (privateKeyPath === '~') {
              expandedPath = os.homedir();
            }

            privateKey = fs.readFileSync(expandedPath, 'utf8');
          }

          connectionConfig.privateKey = privateKey;
        } catch (err) {
          clearTimeout(timeoutId);
          reject(new Error(`Failed to read private key: ${err.message}`));
          return;
        }
      } else if (password) {
        connectionConfig.password = password;
      } else {
        clearTimeout(timeoutId);
        reject(new Error('No authentication method provided'));
        return;
      }

      conn.connect(connectionConfig);
    });
  },

  /**
   * Download file from SFTP server to buffer (in-memory)
   * @param {Object} config - Connection configuration
   * @param {String} remoteFile - Remote file path
   * @returns {Promise<Buffer>} File buffer
   */
  async downloadFileToBuffer(config, remoteFile) {
    const {
      host,
      port = 22,
      username,
      password = null,
      privateKeyPath = null,
      timeout = 120000  // 2 minutes (increased from 60s for large files)
    } = config;

    return new Promise((resolve, reject) => {
      const conn = new Client();

      const timeoutId = setTimeout(() => {
        conn.end();
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            clearTimeout(timeoutId);
            conn.end();
            reject(new Error(`SFTP session failed: ${err.message}`));
            return;
          }

          // Download file to buffer
          const chunks = [];
          const readStream = sftp.createReadStream(remoteFile);

          readStream.on('data', (chunk) => {
            chunks.push(chunk);
          });

          readStream.on('end', () => {
            clearTimeout(timeoutId);
            conn.end();

            // Combine chunks into single buffer
            const buffer = Buffer.concat(chunks);
            console.log(`[SFTP] Downloaded ${remoteFile} (${buffer.length} bytes) to buffer`);
            resolve(buffer);
          });

          readStream.on('error', (err) => {
            clearTimeout(timeoutId);
            conn.end();
            reject(new Error(`Download failed: ${err.message}`));
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`Connection failed: ${err.message}`));
      });

      // Prepare connection configuration
      const connectionConfig = {
        host,
        port,
        username,
        readyTimeout: timeout
      };

      if (privateKeyPath) {
        try {
          let privateKey;

          // Check if key should be read from settings (format: SETTINGS:KEY_NAME)
          if (privateKeyPath.startsWith('SETTINGS:')) {
            const settingsKeyName = privateKeyPath.replace('SETTINGS:', '');

            // Import Meteor settings
            const { Meteor } = require('meteor/meteor');

            if (!Meteor.settings || !Meteor.settings.private || !Meteor.settings.private[settingsKeyName]) {
              throw new Error(`Settings key '${settingsKeyName}' not found in Meteor.settings.private`);
            }

            privateKey = Meteor.settings.private[settingsKeyName];
          } else {
            // Expand ~ to home directory if present
            let expandedPath = privateKeyPath;
            if (privateKeyPath.startsWith('~/')) {
              expandedPath = path.join(os.homedir(), privateKeyPath.slice(2));
            } else if (privateKeyPath === '~') {
              expandedPath = os.homedir();
            }

            privateKey = fs.readFileSync(expandedPath, 'utf8');
          }

          connectionConfig.privateKey = privateKey;
        } catch (err) {
          clearTimeout(timeoutId);
          reject(new Error(`Failed to read private key: ${err.message}`));
          return;
        }
      } else if (password) {
        connectionConfig.password = password;
      } else {
        clearTimeout(timeoutId);
        reject(new Error('No authentication method provided'));
        return;
      }

      conn.connect(connectionConfig);
    });
  }
};
