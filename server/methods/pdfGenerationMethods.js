import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { EJSON } from 'meteor/ejson';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { SessionsCollection, SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { storePdfExport, sweepPdfExports } from '../pdfExportStore.js';
import { issueDocumentToken } from '../documentAccess.js';
import { issuePdfAccessToken, revokePdfAccessToken } from '../helpers/pdfAccessTokens.js';

/**
 * PDF Generation Methods
 *
 * Server-side methods for generating high-quality PDFs from HTML content
 * using Puppeteer for accurate rendering and proper page breaks.
 */

/**
 * How long Chrome may take to lay out and print the document. Puppeteer's
 * default is 30 seconds, which the consolidated PMS report — every client, 500+
 * holdings, 2,400+ operations — blows through: it failed with "Timed out after
 * waiting 30000ms" and nothing reached the browser. Generation is a background
 * job behind a spinner, so waiting is cheaper than failing.
 */
const PDF_RENDER_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * Validate session and return user info
 * @param {String} sessionId - Session ID from localStorage
 * @returns {Object} - { user, userId }
 */
async function validateSession(sessionId) {
  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionHelpers.findByToken(sessionId);

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
   * @returns {Object} - { downloadUrl, fileName, fileSize } — a short-lived,
   *   token-gated URL the browser streams. The PDF is NOT returned inline:
   *   see server/pdfExportStore.js for why that crashed the server.
   */
  async 'pdf.generateReport'({ reportId, reportType, sessionId, lang = 'en', options = {} }) {
    check(reportId, String);
    check(reportType, String);
    check(sessionId, String);
    check(lang, String);
    check(options, Object);

    // Deliberately NOT unblocked: the Puppeteer page authenticates with a
    // single `services.pdfAccess` token on the user document, so two
    // generations running at once for one user would clobber each other's
    // token. Meteor's per-connection method queue keeps them sequential.

    // Validate session
    const { user, userId } = await validateSession(sessionId);

    console.log('[PDF] Generating report PDF:', reportType, reportId, 'for user:', userId, 'language:', lang);

    let browser = null;
    // Hoisted: the catch below revokes it, and only this call's own token.
    let tempToken = null;

    try {
      // One token per generation, held in a list — see server/helpers/pdfAccessTokens.js.
      // A single shared slot meant a retry's cleanup deleted the live run's
      // token and its page failed to authenticate. The TTL covers the whole
      // render, which for a consolidated PMS report runs into minutes.
      ({ token: tempToken } = await issuePdfAccessToken(userId, PDF_RENDER_TIMEOUT_MS + 60 * 1000));

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
          } else if (templateIdLower.includes('twin')) {
            reportUrl = `${baseUrl}pdf/twinwin/${reportId}?pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
            console.log('[PDF] Using dedicated Twin Win PDF template');
          } else if (templateIdLower === 'rate' || templateIdLower.includes('steepener')) {
            reportUrl = `${baseUrl}pdf/rate/${reportId}?pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
            console.log('[PDF] Using dedicated Rate PDF template');
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
          // The currency the portfolio is shown in on screen, so the report matches it
          const currencyParam = typeof options.currency === 'string' && /^[A-Z]{3}$/.test(options.currency) ? `&currency=${options.currency}` : '';
          reportUrl = `${baseUrl}pdf/pms/${reportId}?pdfToken=${tempToken}&userId=${userId}&lang=${lang}${viewAsFilterParam}${accountFilterParam}${currencyParam}`;
          console.log('[PDF] Using PMS Portfolio Report template for account:', reportId, 'viewAsFilter:', options.viewAsFilter ? 'present' : 'none');
          break;
        case 'risk-analysis':
          // Risk Analysis Report - reportId is the risk analysis report ID
          reportUrl = `${baseUrl}pdf/risk-analysis/${reportId}?pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
          console.log('[PDF] Using Risk Analysis Report template for report:', reportId);
          break;
        case 'portfolio-review':
          // Portfolio Review Report - reportId is the review ID
          reportUrl = `${baseUrl}pdf/portfolio-review/${reportId}?pdfToken=${tempToken}&userId=${userId}&lang=${lang}`;
          console.log('[PDF] Using Portfolio Review template for review:', reportId);
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
      // The portfolio statement is designed at 1123×794 px per page (A4 landscape)
      await page.setViewport(reportType === 'pms'
        ? { width: 1123, height: 794, deviceScaleFactor: 2 }
        : { width: 1200, height: 1600, deviceScaleFactor: 2 });

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

      // Never print a page that is still loading or has failed to authenticate.
      // The report shell renders its own error state, which satisfies the
      // "has report content" check — so a failed run came back as a perfectly
      // valid PDF reading "Authentication failed: Invalid or expired token",
      // which is worse than an error: it looks like a report.
      const blocked = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        if (/Authentication failed/i.test(text)) return 'authentication';
        if (document.querySelector('#pdf-loading-state') && !document.body?.dataset?.pdfReady) return 'loading';
        return null;
      });
      if (blocked === 'authentication') {
        throw new Meteor.Error('pdf-auth-failed',
          'The report page could not authenticate. Please try generating the report again.');
      }
      if (blocked === 'loading') {
        throw new Meteor.Error('pdf-loading-timeout',
          'The report was still loading when the PDF was due. Please try again.');
      }

      // Generate PDF - try simple approach first
      // Use landscape mode for better table display
      // Determine if this report should be landscape
      // PMS reports need landscape for wide tables
      const useLandscape = reportType === 'pms' || reportType === 'portfolio-review';

      // Running footer. The client-facing portfolio report carries the firm's
      // confidentiality marking and page count on every sheet, per the brand
      // guide's document footer; other report types keep the plain page count.
      // Puppeteer renders this template in its own document, so it inherits no
      // page styles and must carry its own font stack (web fonts are not
      // available here, hence the system stack rather than Poppins).
      const brandedFooter = `
        <div style="width: 100%; font-family: Helvetica, Arial, sans-serif; font-size: 7.5px; color: #767C88; padding: 0 10mm;">
          <div style="border-top: 0.5px solid #E8D5A3; padding-top: 4px; display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #1B2A4A; font-weight: 600;">Amberlake Partners SAM &middot; Confidential</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>
        </div>
      `;
      const plainFooter = `
        <div style="width: 100%; font-size: 9px; padding: 5px 10mm; color: #666; text-align: center;">
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `;
      const runningFooter = reportType === 'pms' ? brandedFooter : plainFooter;

      let pdfBuffer;
      const renderStartedAt = Date.now();
      // The portfolio statement is laid out as fixed A4-landscape pages
      // (1123×794 CSS px each) carrying their own header, footer and "n / N",
      // so it prints edge to edge with no Puppeteer margins or running footer.
      if (reportType === 'pms') {
        pdfBuffer = await page.pdf({
          width: '297mm',
          height: '210mm',
          printBackground: true,
          preferCSSPageSize: true,
          timeout: PDF_RENDER_TIMEOUT_MS,
          margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
          displayHeaderFooter: false
        });
      } else try {
        pdfBuffer = await page.pdf({
          format: 'A4',
          landscape: useLandscape,
          printBackground: true,
          preferCSSPageSize: false, // Ensure Puppeteer settings override CSS @page rules
          // Puppeteer defaults to a 30s protocol timeout, which a consolidated
          // PMS report (500+ holdings, 2,400+ operations, hundreds of pages)
          // exceeds while Chrome is still laying out the print document — the
          // report then failed with "Timed out after waiting 30000ms" and the
          // desk saw nothing happen at all.
          timeout: PDF_RENDER_TIMEOUT_MS,
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
          footerTemplate: runningFooter
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
          timeout: PDF_RENDER_TIMEOUT_MS,
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

      // Clean up this run's token — never anyone else's.
      await revokePdfAccessToken(userId, tempToken);

      console.log(`[PDF] Report PDF generated, size: ${pdfBuffer?.length} bytes, rendered in ${Math.round((Date.now() - renderStartedAt) / 1000)}s`);
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

      // Hand the file over as a URL, never as method result data. A 13 MB PMS
      // report became a 17 MB base64 string plus the copies DDP makes framing
      // the reply, and the server was OOM-killed mid-send — which made the
      // client re-send the method on reconnect and regenerate forever.
      const stored = storePdfExport(pdfBuffer, options.title || `${reportType}-report`);
      pdfBuffer = null;

      const token = await issueDocumentToken(stored.publicPath, userId);
      sweepPdfExports();

      console.log('[PDF] Export ready:', stored.storedFileName, `(${stored.fileSize} bytes)`);

      return {
        downloadUrl: `${stored.publicPath}?dl=${token}`,
        fileName: stored.storedFileName,
        fileSize: stored.fileSize
      };

    } catch (error) {
      // Clean up browser and temp token on error
      if (browser) {
        await browser.close();
      }

      // Clean up this run's token. Scoped to the token this call minted: the
      // unscoped version deleted whatever was in the slot, so a failed run
      // pulled the rug from under a retry that had already started.
      try {
        if (tempToken) await revokePdfAccessToken(userId, tempToken);
      } catch (cleanupError) {
        console.error('[PDF] Error cleaning up temp token:', cleanupError);
      }

      console.error('[PDF] Error generating report PDF:', error);
      throw new Meteor.Error('pdf-generation-failed', `Failed to generate report PDF: ${error.message}`);
    }
  }
});
