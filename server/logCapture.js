import { ServerLogsCollection, ServerLogsHelpers } from '../imports/api/serverLogs.js';

/**
 * Server Log Capture
 * Intercepts console.log/warn/error and stores in MongoDB for real-time viewing
 * Non-blocking - uses async insert with silent failure
 */

// Store original console methods
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

// Flag to prevent recursive logging
let isCapturing = false;

/**
 * Convert arguments to a string message
 */
function argsToMessage(args) {
  return args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

/**
 * Insert log entry asynchronously (non-blocking)
 */
function captureLog(level, args) {
  // Prevent recursive capture (when our own inserts log)
  if (isCapturing) return;

  isCapturing = true;

  const message = argsToMessage(args);
  const prefix = ServerLogsHelpers.extractPrefix(message);

  // Insert async, don't await - fire and forget
  ServerLogsCollection.insertAsync({
    level,
    message,
    prefix,
    createdAt: new Date()
  }).catch(() => {
    // Silent fail - don't break app
  }).finally(() => {
    isCapturing = false;
  });
}

// Override console.log
console.log = function(...args) {
  originalLog.apply(console, args);
  captureLog('info', args);
};

// Override console.warn
console.warn = function(...args) {
  originalWarn.apply(console, args);
  captureLog('warn', args);
};

// Override console.error
console.error = function(...args) {
  originalError.apply(console, args);
  captureLog('error', args);
};

// Log that capture is active (this will be the first captured log!)
originalLog('[SERVER_LOGS] Console capture initialized - logs will be stored for 20 minutes');
