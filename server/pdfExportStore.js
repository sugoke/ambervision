/**
 * Temporary store for generated report PDFs.
 *
 * Generated PDFs used to come back from `pdf.generateReport` as a base64 string
 * in the method result — the whole file through DDP. A consolidated PMS report
 * for a compliance user (every client, 2,400+ operations) weighs ~13 MB, which
 * becomes a ~17 MB base64 string plus the copies EJSON/DDP make while framing
 * the reply. On the 4 GB production host, with the headless Chrome that just
 * rendered the report still winding down, that killed the Node process: the
 * server logged "Report PDF generated" and then restarted, the Meteor client
 * re-sent the pending method call on reconnect, and the report regenerated in a
 * loop that never produced a file.
 *
 * So the PDF is written here instead and handed over as a short-lived,
 * token-gated URL that the browser streams over HTTP — no large payload on the
 * DDP wire, and memory stays flat whatever the report's size.
 *
 * Files are deliberately ephemeral: they live in the container's temp space
 * (PDF_EXPORTS_PATH overrides), not on the document volume, and anything older
 * than TTL is swept away.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Random } from 'meteor/random';

/** Public URL prefix served by the /pdf-exports WebApp handler. */
export const PDF_EXPORT_URL_PREFIX = '/pdf-exports';

/** One flat directory, one safe path segment — enforced here and at the HTTP edge. */
export const SAFE_PDF_EXPORT_FILENAME = /^[A-Za-z0-9_-]+\.pdf$/;

/** How long a generated export stays on disk before the sweeper removes it. */
export const PDF_EXPORT_TTL_MS = 30 * 60 * 1000;

export function getPdfExportsDir() {
  return process.env.PDF_EXPORTS_PATH || path.join(os.tmpdir(), 'ambervision-pdf-exports');
}

/**
 * Resolve a stored name to its path, refusing anything that is not a plain
 * filename inside the store.
 */
export function resolvePdfExportPath(storedFileName) {
  if (!SAFE_PDF_EXPORT_FILENAME.test(storedFileName || '')) return null;
  const dir = path.resolve(getPdfExportsDir());
  const filePath = path.resolve(dir, storedFileName);
  if (!filePath.startsWith(dir + path.sep)) return null;
  return filePath;
}

/**
 * Turn a report title into the download name the browser will show. ASCII,
 * no separators, no quotes — the result is both the on-disk name and the
 * Content-Disposition filename, so it has to satisfy SAFE_PDF_EXPORT_FILENAME.
 */
function slugify(title) {
  const slug = String(title || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // é → e
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return slug || 'report';
}

/**
 * Write a generated PDF to the store.
 *
 * @param {Buffer} buffer - the PDF
 * @param {string} title - desired download name (without extension)
 * @returns {{ storedFileName: string, filePath: string, publicPath: string, fileSize: number }}
 */
export function storePdfExport(buffer, title) {
  const dir = getPdfExportsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const storedFileName = `${slugify(title)}_${Random.id(10)}.pdf`;
  const filePath = resolvePdfExportPath(storedFileName);
  if (!filePath) throw new Error('Could not resolve a safe path for the generated PDF');

  fs.writeFileSync(filePath, buffer);

  return {
    storedFileName,
    filePath,
    publicPath: `${PDF_EXPORT_URL_PREFIX}/${storedFileName}`,
    fileSize: buffer.length
  };
}

/**
 * Delete exports older than `maxAgeMs`. Runs at startup and after each
 * generation; a download that never happened is not worth keeping.
 */
export function sweepPdfExports(maxAgeMs = PDF_EXPORT_TTL_MS) {
  const dir = getPdfExportsDir();
  let removed = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of fs.readdirSync(dir)) {
      if (!SAFE_PDF_EXPORT_FILENAME.test(entry)) continue;
      const filePath = path.join(dir, entry);
      try {
        if (fs.statSync(filePath).mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          removed += 1;
        }
      } catch { /* a file removed under us is fine */ }
    }
  } catch (error) {
    console.error('[PDFExport] Sweep failed:', error.message);
  }
  return removed;
}
