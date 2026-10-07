import fs from 'fs';
import path from 'path';
import { ClientDocumentsCollection, DOCUMENT_TYPES } from '/imports/api/clientDocuments.js';
import { MeetingReportsCollection } from '/imports/api/meetingReports.js';
import { ensureUserDirectory } from '../methods/clientDocumentMethods.js';

/**
 * A finalized meeting report is the client's visit report: its PDF is filed on
 * the client file as a `visit_report` document dated on the meeting, which is
 * what the KYC tab and the compliance dashboard read for the yearly visit.
 *
 * The report keeps the document id (visitDocumentId) so a re-finalize replaces
 * the filed copy and a delete removes it.
 */

const safeFilePart = (value) => String(value || '')
  .replace(/[\\/:*?"<>|]/g, ' ')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 80);

/** Remove the visit document filed from this report, if any. */
export async function removeMeetingReportVisitDocument(report) {
  const documentId = report?.visitDocumentId;
  if (!documentId) return;
  const doc = await ClientDocumentsCollection.findOneAsync(documentId);
  if (doc) {
    try {
      if (doc.filePath && fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
    } catch (err) {
      console.error('[MEETING-REPORTS] Could not delete filed visit report file:', err.message);
    }
    await ClientDocumentsCollection.removeAsync(documentId);
  }
  await MeetingReportsCollection.updateAsync(report._id, { $unset: { visitDocumentId: '' } });
}

/**
 * File the report's PDF on the client as its visit report (replacing an
 * earlier filing of the same report). Reports without a client are not filed.
 *
 * @param {Object} report    the finalized meeting report
 * @param {Buffer} pdfBuffer the rendered PDF
 * @param {Object} user      who finalized it
 * @returns {String|null} the clientDocuments id
 */
export async function fileMeetingReportAsVisit(report, pdfBuffer, user) {
  if (!report?.entityId || !pdfBuffer?.length) return null;

  await removeMeetingReportVisitDocument(report);

  const userDir = ensureUserDirectory(report.entityId);
  const storedFileName = `${DOCUMENT_TYPES.VISIT_REPORT}_${Date.now()}.pdf`;
  const filePath = path.join(userDir, storedFileName);
  fs.writeFileSync(filePath, pdfBuffer);

  const meetingDate = report.meetingDate ? new Date(report.meetingDate) : new Date();
  const kind = report.meetingType === 'call' ? 'Call report' : 'Rapport de visite';
  const fileName = `${kind} ${safeFilePart(report.clientNameSnapshot)} ${meetingDate.toISOString().slice(0, 10)}.pdf`;

  const documentId = await ClientDocumentsCollection.insertAsync({
    userId: report.entityId,
    familyMemberIndex: null,
    documentType: DOCUMENT_TYPES.VISIT_REPORT,
    fileName,
    storedFileName,
    filePath,
    mimeType: 'application/pdf',
    fileSize: pdfBuffer.length,
    uploadedAt: new Date(),
    uploadedBy: user?._id || null,
    expirationDate: null,
    documentNumber: null,
    // The visit date the KYC tab and the compliance check read
    issuanceDate: meetingDate,
    bankAccountId: report.bankAccountId || null,
    source: 'meeting_report',
    meetingReportId: report._id
  });

  await MeetingReportsCollection.updateAsync(report._id, { $set: { visitDocumentId: documentId } });
  return documentId;
}
