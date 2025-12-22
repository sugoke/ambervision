import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { UsersCollection } from '../imports/api/users.js';

/**
 * PDF Authentication Middleware
 *
 * Validates temporary PDF access tokens passed via URL parameters
 * This allows Puppeteer to authenticate without needing cookies/sessions
 */

// Middleware to handle PDF authentication
WebApp.connectHandlers.use(async (req, res, next) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pdfToken = url.searchParams.get('pdfToken');
  const userId = url.searchParams.get('userId');
  const isPDFMode = url.searchParams.get('pdf') === 'true';

  // Only process if this is a PDF request with auth parameters
  if (isPDFMode && pdfToken && userId) {
    try {
      console.log('[PDF_AUTH] Validating PDF token for user:', userId);

      // Find user with matching PDF access token
      const user = await UsersCollection.findOneAsync({
        _id: userId,
        'services.pdfAccess.token': pdfToken
      });

      if (!user) {
        console.log('[PDF_AUTH] Invalid or expired PDF token');
        res.writeHead(401, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Unauthorized</title></head>
            <body style="font-family: system-ui; padding: 2rem; text-align: center;">
              <h1>PDF Generation Failed</h1>
              <p>Invalid or expired authentication token.</p>
              <p style="color: #666; font-size: 0.9rem;">This temporary link has expired. Please generate a new PDF.</p>
            </body>
          </html>
        `);
        return;
      }

      // Check if token is expired
      const expiresAt = user.services.pdfAccess.expiresAt;
      if (expiresAt && new Date(expiresAt) < new Date()) {
        console.log('[PDF_AUTH] PDF token expired at:', expiresAt);
        res.writeHead(401, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Token Expired</title></head>
            <body style="font-family: system-ui; padding: 2rem; text-align: center;">
              <h1>PDF Generation Failed</h1>
              <p>Authentication token has expired.</p>
              <p style="color: #666; font-size: 0.9rem;">Please generate a new PDF.</p>
            </body>
          </html>
        `);
        return;
      }

      console.log('[PDF_AUTH] ✓ PDF token valid for user:', user.emails?.[0]?.address);

      // Store authenticated userId in request for downstream use
      req.pdfAuthUserId = userId;
    } catch (error) {
      console.error('[PDF_AUTH] Error validating PDF token:', error);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Error</title></head>
          <body style="font-family: system-ui; padding: 2rem; text-align: center;">
            <h1>PDF Generation Error</h1>
            <p>An error occurred during authentication.</p>
            <p style="color: #666; font-size: 0.9rem;">${error.message}</p>
          </body>
        </html>
      `);
      return;
    }
  }

  // Continue to next middleware
  next();
});

// Helper method to validate PDF token on client
Meteor.methods({
  async 'pdf.validateToken'(userId, pdfToken) {
    // This is called from client-side to validate before rendering
    const user = await UsersCollection.findOneAsync({
      _id: userId,
      'services.pdfAccess.token': pdfToken
    });

    if (!user) {
      return { valid: false, reason: 'Invalid or expired token' };
    }

    const expiresAt = user.services.pdfAccess.expiresAt;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return { valid: false, reason: 'Token expired' };
    }

    return { valid: true, userId: user._id };
  }
});

console.log('[PDF_AUTH] PDF authentication middleware registered');
