import puppeteer from 'puppeteer';

/**
 * Shared PDF Generation Helper
 *
 * Generates PDF from HTML content using Puppeteer.
 * This is a shared helper that can be called from any server method.
 */

/**
 * Generate PDF from HTML content
 * @param {String} html - Full HTML content to render
 * @param {Object} options - PDF generation options
 * @returns {Object} - { pdfData: base64String }
 */
export async function generatePDFFromHTML(html, options = {}) {
  console.log('[PDF Helper] Starting PDF generation');

  let browser = null;
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
    const fs = require('fs');
    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          executablePath = p;
          console.log('[PDF Helper] Found Chrome at:', p);
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
        '--disable-gpu'
      ]
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 2 // High DPI for sharp text
    });

    // Set content
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Wait for any dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Generate PDF with optimal settings
    let pdfBuffer = await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      margin: {
        top: options.marginTop || '20mm',
        right: options.marginRight || '15mm',
        bottom: options.marginBottom || '20mm',
        left: options.marginLeft || '15mm'
      },
      preferCSSPageSize: false
    });

    await browser.close();
    browser = null;

    console.log('[PDF Helper] PDF generated, size:', pdfBuffer?.length, 'bytes');

    // Validate the PDF buffer
    if (!pdfBuffer) {
      throw new Error('PDF generation returned null/undefined');
    }

    // Ensure we have a proper Buffer (Puppeteer might return Uint8Array in some versions)
    if (!Buffer.isBuffer(pdfBuffer)) {
      console.log('[PDF Helper] Converting pdfBuffer to Buffer...');
      pdfBuffer = Buffer.from(pdfBuffer);
    }

    if (pdfBuffer.length === 0) {
      throw new Error('Generated PDF is empty (0 bytes)');
    }

    // Validate PDF header
    const pdfHeader = pdfBuffer.slice(0, 5).toString('utf8');
    if (pdfHeader !== '%PDF-') {
      throw new Error(`Generated content is not a PDF. Header: ${pdfHeader}`);
    }

    console.log('[PDF Helper] Valid PDF header confirmed');

    // Convert to base64
    const base64String = pdfBuffer.toString('base64');
    console.log('[PDF Helper] Base64 length:', base64String.length);

    // Validate base64 starts with PDF signature (JVBERi = %PDF-)
    if (!base64String.startsWith('JVBERi')) {
      throw new Error('PDF encoding failed - invalid base64 signature');
    }

    return { pdfData: base64String };

  } catch (error) {
    if (browser) {
      await browser.close();
    }
    console.error('[PDF Helper] Error generating PDF:', error);
    throw error;
  }
}
