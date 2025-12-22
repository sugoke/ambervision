import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { EJSON } from 'meteor/ejson';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';

/**
 * PDF Generation Methods
 *
 * Server-side methods for generating high-quality PDFs from HTML content
 * using Puppeteer for accurate rendering and proper page breaks.
 */

/**
 * Validate session and return user info
 * @param {String} sessionId - Session ID from localStorage
 * @returns {Object} - { user, userId }
 */
async function validateSession(sessionId) {
  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid or expired session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  return { user, userId: user._id };
}

Meteor.methods({
  /**
   * Diagnostic method to test Puppeteer setup
   * Returns information about Chrome/Puppeteer availability
   */
  async 'pdf.diagnose'({ sessionId }) {
    check(sessionId, String);

    // Validate session (admin only would be better but for diagnostics...)
    await validateSession(sessionId);

    const diagnostics = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      puppeteerVersion: null,
      chromePaths: [],
      canLaunch: false,
      launchError: null,
      testPdfGenerated: false
    };

    // Check for Chrome executable paths
    const possiblePaths = [
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      process.env.PUPPETEER_EXECUTABLE_PATH
    ].filter(Boolean);

    for (const p of possiblePaths) {
      try {
        if (require('fs').existsSync(p)) {
          diagnostics.chromePaths.push(p);
        }
      } catch (e) { /* ignore */ }
    }

    // Try to get Puppeteer version
    try {
      const pkg = require('puppeteer/package.json');
      diagnostics.puppeteerVersion = pkg.version;
    } catch (e) {
      diagnostics.puppeteerVersion = 'unknown';
    }

    // Try to launch browser
    let browser = null;
    try {
      const launchOptions = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      };

      if (diagnostics.chromePaths.length > 0) {
        launchOptions.executablePath = diagnostics.chromePaths[0];
      }

      browser = await puppeteer.launch(launchOptions);
      diagnostics.canLaunch = true;

      // Try to generate a simple test PDF
      const page = await browser.newPage();
      await page.setContent('<html><body><h1>Test PDF</h1></body></html>');
      const pdfBuffer = await page.pdf({ format: 'A4' });

      if (pdfBuffer && pdfBuffer.length > 0) {
        const header = pdfBuffer.slice(0, 5).toString('utf8');
        diagnostics.testPdfGenerated = header === '%PDF-';
        diagnostics.testPdfSize = pdfBuffer.length;
      }

      await browser.close();
    } catch (e) {
      diagnostics.launchError = e.message;
      if (browser) {
        try { await browser.close(); } catch (err) { /* ignore */ }
      }
    }

    console.log('[PDF Diagnostics]', JSON.stringify(diagnostics, null, 2));
    return diagnostics;
  },

  /**
   * Generate PDF from HTML content
   * @param {Object} params - Method parameters
   * @param {String} params.html - Full HTML content to render
   * @param {String} params.sessionId - Session ID for authentication
   * @param {Object} params.options - PDF generation options
   * @returns {String} - Base64 encoded PDF data
   */
  async 'pdf.generateFromHTML'({ html, sessionId, options = {} }) {
    check(html, String);
    check(sessionId, String);
    check(options, Object);

    // Validate session
    const { user, userId } = await validateSession(sessionId);

    console.log('[PDF] Starting PDF generation for user:', userId);

    let browser = null;
    try {
      // Launch headless browser
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();

      // Set viewport for consistent rendering
      await page.setViewport({
        width: 1200,
        height: 1600,
        deviceScaleFactor: 2 // High DPI for sharp text
      });

      // Set content with proper base URL for assets
      const baseUrl = Meteor.absoluteUrl();
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      // Wait for any dynamic content to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Generate PDF with optimal settings
      const pdfBuffer = await page.pdf({
        format: options.format || 'A4',
        printBackground: true,
        margin: {
          top: options.marginTop || '20mm',
          right: options.marginRight || '15mm',
          bottom: options.marginBottom || '20mm',
          left: options.marginLeft || '15mm'
        },
        displayHeaderFooter: options.displayHeaderFooter !== false,
        headerTemplate: options.headerTemplate || `
          <div style="width: 100%; height: 1px;"></div>
        `,
        footerTemplate: options.footerTemplate || `
          <div style="width: 100%; font-size: 9px; padding: 5px 15mm; color: #666; border-top: 1px solid #e5e7eb; text-align: center;">
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
            <span style="float: right;">Generated by Amberlake Partners</span>
          </div>
        `,
        preferCSSPageSize: false
      });

      await browser.close();

      console.log('[PDF] PDF generated successfully, size:', pdfBuffer.length, 'bytes');

      // Convert to base64 - return as wrapped object to prevent DDP serialization issues
      const base64String = pdfBuffer.toString('base64');
      return { pdfData: base64String };

    } catch (error) {
      if (browser) {
        await browser.close();
      }
      console.error('[PDF] Error generating PDF:', error);
      throw new Meteor.Error('pdf-generation-failed', `Failed to generate PDF: ${error.message}`);
    }
  },

  /**
   * Generate PDF from a report by ID
   * @param {Object} params - Method parameters
   * @param {String} params.reportId - Report ID to generate PDF for
   * @param {String} params.reportType - Type of report (underlyings, product, etc.)
   * @param {String} params.sessionId - Session ID for authentication
   * @param {String} params.lang - Language code for report (en/fr)
   * @param {Object} params.options - PDF generation options
   * @returns {String} - Base64 encoded PDF data
   */
  async 'pdf.generateReport'({ reportId, reportType, sessionId, lang = 'en', options = {} }) {
    check(reportId, String);
    check(reportType, String);
    check(sessionId, String);
    check(lang, String);
    check(options, Object);

    // Validate session
    const { user, userId } = await validateSession(sessionId);

    console.log('[PDF] Generating report PDF:', reportType, reportId, 'for user:', userId, 'language:', lang);

    let browser = null;

    try {
      // Create a temporary access token for PDF generation (expires in 5 minutes)
      const crypto = await import('crypto');
      const tempToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      // Store temporary token in user document
      await UsersCollection.updateAsync(userId, {
        $set: {
          'services.pdfAccess': {
            token: tempToken,
            expiresAt: expiresAt
          }
        }
      });

      console.log('[PDF] Temporary PDF access token created for user:', userId);

      // Build the URL to render with temp token
      const baseUrl = Meteor.absoluteUrl();
      let reportUrl;

      switch (reportType) {
        case 'underlyings':
          reportUrl = `${baseUrl}underlyings-report/${reportId}?pdf=true&pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
          break;
        case 'product':
          reportUrl = `${baseUrl}report/${reportId}?pdf=true&pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
          break;
        case 'template':
          // For template reports, check if we have a dedicated PDF template
          // Look up the latest report to determine the template type
          const { TemplateReportsCollection } = await import('../../imports/api/templateReports.js');
          const latestReport = await TemplateReportsCollection.findOneAsync(
            { productId: reportId },
            { sort: { createdAt: -1 } }
          );

          const templateId = latestReport?.templateId || options.templateId;
          const templateIdLower = templateId ? templateId.toLowerCase() : '';
          console.log('[PDF] Template type for product:', reportId, 'is:', templateId, '(normalized:', templateIdLower, ')');

          // Use dedicated PDF templates for supported product types (case-insensitive matching)
          if (templateIdLower.includes('phoenix')) {
            reportUrl = `${baseUrl}pdf/phoenix/${reportId}?pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
            console.log('[PDF] Using dedicated Phoenix PDF template');
          } else if (templateIdLower.includes('orion')) {
            reportUrl = `${baseUrl}pdf/orion/${reportId}?pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
            console.log('[PDF] Using dedicated Orion PDF template');
          } else if (templateIdLower.includes('participation')) {
            reportUrl = `${baseUrl}pdf/participation/${reportId}?pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
            console.log('[PDF] Using dedicated Participation Note PDF template');
          } else {
            // Fallback to existing product view for other templates
            reportUrl = `${baseUrl}product/${reportId}?pdf=true&pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
          }
          break;
        case 'pms':
          // PMS Portfolio Report - reportId is the account filter ('all' or specific account ID)
          // Also pass viewAsFilter from options if present
          const viewAsFilterParam = options.viewAsFilter ? `&viewAsFilter=${encodeURIComponent(options.viewAsFilter)}` : '';
          const accountFilterParam = options.accountFilter ? `&account=${encodeURIComponent(options.accountFilter)}` : '';
          reportUrl = `${baseUrl}pdf/pms/${reportId}?pdfToken=${tempToken}&userId=${userId}&lang=${lang}${viewAsFilterParam}${accountFilterParam}`;
          console.log('[PDF] Using PMS Portfolio Report template for account:', reportId, 'viewAsFilter:', options.viewAsFilter ? 'present' : 'none');
          break;
        case 'risk-analysis':
          // Risk Analysis Report - reportId is the risk analysis report ID
          reportUrl = `${baseUrl}pdf/risk-analysis/${reportId}?pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
          console.log('[PDF] Using Risk Analysis Report template for report:', reportId);
          break;
        default:
          throw new Meteor.Error('invalid-report-type', 'Invalid report type specified');
      }

      // Launch browser and navigate to report
      console.log('[PDF] Launching Puppeteer browser...');
      try {
        // Try to find Chrome executable path for containerized environments
        const possiblePaths = [
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          process.env.PUPPETEER_EXECUTABLE_PATH
        ].filter(Boolean);

        let executablePath = null;
        for (const p of possiblePaths) {
          try {
            if (require('fs').existsSync(p)) {
              executablePath = p;
              console.log('[PDF] Found Chrome at:', p);
              break;
            }
          } catch (e) { /* ignore */ }
        }

        const launchOptions = {
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--safebrowsing-disable-auto-update'
          ]
        };

        if (executablePath) {
          launchOptions.executablePath = executablePath;
        }

        browser = await puppeteer.launch(launchOptions);
        console.log('[PDF] Browser launched successfully');
      } catch (launchError) {
        console.error('[PDF] Failed to launch browser:', launchError);
        console.error('[PDF] This may be due to missing Chrome/Chromium in the Docker container.');
        console.error('[PDF] Try: apt-get install -y chromium-browser or setting PUPPETEER_EXECUTABLE_PATH');
        throw new Meteor.Error('puppeteer-launch-failed', `Failed to launch browser: ${launchError.message}. Chrome may not be installed in the container.`);
      }

      const page = await browser.newPage();
      console.log('[PDF] New page created');

      // Set viewport
      await page.setViewport({
        width: 1200,
        height: 1600,
        deviceScaleFactor: 2
      });

      console.log('[PDF] Navigating to:', reportUrl.replace(tempToken, '***TOKEN***'));

      // Navigate to report page
      try {
        const response = await page.goto(reportUrl, {
          waitUntil: 'networkidle0',
          timeout: 60000
        });

        console.log('[PDF] Navigation complete, status:', response?.status());

        if (!response || response.status() >= 400) {
          const content = await page.content();
          console.error('[PDF] Page returned error status. First 500 chars of content:', content.substring(0, 500));
          throw new Error(`Page returned status ${response?.status() || 'unknown'}`);
        }
      } catch (navError) {
        console.error('[PDF] Navigation failed:', navError.message);
        // Try to capture what's on the page
        try {
          const content = await page.content();
          console.error('[PDF] Page content after nav error (first 500 chars):', content.substring(0, 500));
        } catch (e) { /* ignore */ }
        throw navError;
      }

      console.log('[PDF] Page loaded, waiting for content to be ready...');

      // Wait for the page to mark itself as ready for PDF
      try {
        await page.waitForSelector('body[data-pdf-ready="true"]', {
          timeout: 30000
        });
        console.log('[PDF] Content ready signal received');
      } catch (waitError) {
        console.log('[PDF] Timeout waiting for ready signal, checking page state...');

        // Capture page state for debugging
        const pageTitle = await page.title();
        const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || 'No body text');
        const hasPdfMode = await page.evaluate(() => document.body?.getAttribute('data-pdf-mode'));
        const hasReport = await page.evaluate(() => !!document.querySelector('#product-report-content, .report-content, .template-product-report'));

        console.log('[PDF] Page state:', {
          title: pageTitle,
          hasPdfMode,
          hasReportContent: hasReport,
          bodyPreview: bodyText.substring(0, 200)
        });

        if (!hasReport) {
          // Check if page is stuck in loading state
          const isLoadingState = await page.evaluate(() => !!document.querySelector('#pdf-loading-state'));
          const loadingText = await page.evaluate(() => document.querySelector('#pdf-loading-state')?.innerText || '');

          // Capture full page content for debugging
          const fullContent = await page.content();
          console.error('[PDF] No report content found. Full HTML (first 1000 chars):', fullContent.substring(0, 1000));

          if (isLoadingState) {
            console.error('[PDF] Page stuck in loading state:', loadingText);
            throw new Meteor.Error('pdf-loading-timeout', `Report still loading after timeout. Status: ${loadingText}. Authentication may have failed.`);
          }

          throw new Meteor.Error('pdf-no-content', `Page did not load report content. Title: "${pageTitle}". Check authentication and page URL.`);
        }

        // Wait a bit more if content seems to be loading
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Capture page state before PDF generation for debugging
      const preGenTitle = await page.title();
      const preGenBodyPreview = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || 'empty');
      console.log('[PDF] Pre-generation page state - Title:', preGenTitle);
      console.log('[PDF] Pre-generation body preview:', preGenBodyPreview);

      // Inject white background styles to ensure no dark backgrounds in PDF
      await page.addStyleTag({
        content: `
          html, body, #react-target {
            background: white !important;
            background-color: white !important;
          }
          .fixed-bg-light, .fixed-bg-dark {
            display: none !important;
          }
        `
      });
      console.log('[PDF] Injected white background styles');

      // Generate PDF - try simple approach first
      // Use landscape mode for better table display
      // Determine if this report should be landscape
      // PMS reports need landscape for wide tables
      const useLandscape = reportType === 'pms';

      let pdfBuffer;
      try {
        pdfBuffer = await page.pdf({
          format: 'A4',
          landscape: useLandscape,
          printBackground: true,
          preferCSSPageSize: false, // Ensure Puppeteer settings override CSS @page rules
          margin: {
            top: '15mm',
            right: '10mm',
            bottom: '15mm',
            left: '10mm'
          },
          displayHeaderFooter: true,
          headerTemplate: `
            <div style="width: 100%; height: 1px;"></div>
          `,
          footerTemplate: `
            <div style="width: 100%; font-size: 9px; padding: 5px 10mm; color: #666; text-align: center;">
              <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
            </div>
          `
        });
      } catch (pdfError) {
        console.error('[PDF] PDF generation with headers failed:', pdfError.message);
        console.log('[PDF] Trying simple PDF generation without headers...');
        // Fallback: try without header/footer
        pdfBuffer = await page.pdf({
          format: 'A4',
          landscape: useLandscape,
          printBackground: true,
          preferCSSPageSize: false,
          margin: {
            top: '10mm',
            right: '10mm',
            bottom: '10mm',
            left: '10mm'
          }
        });
      }

      await browser.close();
      browser = null;

      // Clean up temporary token
      await UsersCollection.updateAsync(userId, {
        $unset: {
          'services.pdfAccess': ''
        }
      });

      console.log('[PDF] Report PDF generated, size:', pdfBuffer?.length, 'bytes');
      console.log('[PDF] pdfBuffer type:', typeof pdfBuffer, 'isBuffer:', Buffer.isBuffer(pdfBuffer), 'isUint8Array:', pdfBuffer instanceof Uint8Array);

      // Validate the PDF buffer
      if (!pdfBuffer) {
        throw new Meteor.Error('pdf-empty', 'PDF generation returned null/undefined');
      }

      // Ensure we have a proper Buffer (Puppeteer might return Uint8Array in some versions)
      if (!Buffer.isBuffer(pdfBuffer)) {
        console.log('[PDF] Converting pdfBuffer to Buffer...');
        pdfBuffer = Buffer.from(pdfBuffer);
      }

      if (pdfBuffer.length === 0) {
        throw new Meteor.Error('pdf-empty', 'Generated PDF is empty (0 bytes)');
      }

      // Check what we actually got
      const firstBytes = pdfBuffer.slice(0, 50);
      const pdfHeader = firstBytes.slice(0, 5).toString('utf8');
      const firstBytesHex = firstBytes.toString('hex').substring(0, 40);
      const firstBytesUtf8 = firstBytes.toString('utf8');

      console.log('[PDF] First 5 bytes (header):', pdfHeader);
      console.log('[PDF] First 50 bytes (hex):', firstBytesHex);
      console.log('[PDF] First 50 bytes (utf8):', firstBytesUtf8);

      if (pdfHeader !== '%PDF-') {
        // Not a PDF - try to understand what it is
        let contentType = 'unknown';
        if (firstBytesUtf8.includes('<!DOCTYPE') || firstBytesUtf8.includes('<html')) {
          contentType = 'HTML page (page might have shown an error)';
        } else if (firstBytesUtf8.includes('{')) {
          contentType = 'JSON (possibly an error response)';
        }
        console.error('[PDF] Invalid PDF - received:', contentType);
        console.error('[PDF] Buffer content preview:', firstBytesUtf8);
        throw new Meteor.Error('pdf-invalid', `Generated content is not a PDF. Got: ${contentType}. First bytes: ${firstBytesUtf8.substring(0, 100)}`);
      }

      console.log('[PDF] Valid PDF header confirmed');

      // Convert to base64
      const base64String = pdfBuffer.toString('base64');
      console.log('[PDF] Base64 length:', base64String.length);
      console.log('[PDF] Base64 first 50 chars:', base64String.substring(0, 50));

      // Validate base64 starts with PDF signature (JVBERi = %PDF-)
      if (!base64String.startsWith('JVBERi')) {
        console.error('[PDF] Base64 does not start with PDF signature');
        throw new Meteor.Error('pdf-encoding-error', 'PDF encoding failed');
      }

      // Return the base64 string
      return base64String;

    } catch (error) {
      // Clean up browser and temp token on error
      if (browser) {
        await browser.close();
      }

      // Clean up temp token
      try {
        await UsersCollection.updateAsync(userId, {
          $unset: {
            'services.pdfAccess': ''
          }
        });
      } catch (cleanupError) {
        console.error('[PDF] Error cleaning up temp token:', cleanupError);
      }

      console.error('[PDF] Error generating report PDF:', error);
      throw new Meteor.Error('pdf-generation-failed', `Failed to generate report PDF: ${error.message}`);
    }
  }
});
