import fs from 'fs';
import path from 'path';
import { generatePDFFromHTML } from './pdfHelper';
import {
  MEETING_TYPES,
  SATISFACTION_LEVELS
} from '/imports/api/meetingReports';

/**
 * Render a meeting report into a PDF and write it to public/meetingReports/{id}.pdf.
 * Returns { absolutePath, relativeUrl, base64 }.
 */
export async function generateMeetingReportPdf(report) {
  if (!report || !report._id) throw new Error('generateMeetingReportPdf: missing report');

  const html = renderMeetingReportHtml(report);
  const { pdfData } = await generatePDFFromHTML(html, {
    format: 'A4',
    marginTop: '20mm',
    marginBottom: '20mm',
    marginLeft: '18mm',
    marginRight: '18mm'
  });

  const buffer = Buffer.from(pdfData, 'base64');
  const dir = resolveOutputDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${report._id}.pdf`;
  const absolutePath = path.join(dir, filename);
  fs.writeFileSync(absolutePath, buffer);

  return {
    absolutePath,
    relativeUrl: `/meetingReports/${filename}`,
    base64: pdfData
  };
}

function resolveOutputDir() {
  if (process.env.MEETING_REPORTS_PATH) return process.env.MEETING_REPORTS_PATH;
  let projectRoot = process.cwd();
  if (projectRoot.includes('.meteor')) {
    projectRoot = projectRoot.split('.meteor')[0].replace(/[\\/]$/, '');
  }
  return path.join(projectRoot, 'public', 'meetingReports');
}

// ---------- HTML rendering ---------------------------------------------------

function escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphs(text) {
  if (!text) return '';
  return String(text)
    .split(/\n{2,}/)
    .map(p => `<p>${escape(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function formatDate(d, locale) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  if (locale === 'en') return `${month}/${day}/${year}`;
  return `${day}/${month}/${year}`;
}

function checkboxRow(label, checked) {
  return `<span class="cb">${checked ? '☒' : '☐'}</span> <span class="cb-label">${escape(label)}</span>`;
}

function renderMeetingReportHtml(report) {
  const lang = (report.language || 'fr').toLowerCase();
  const isEN = lang === 'en';

  const t = isEN ? {
    title: 'Client Visit Report',
    internal: 'Internal Document',
    disclaimer: 'This report is required at least annually but should be produced for any meeting where traceability is appropriate.',
    name: 'Name(s), First name(s):',
    company: 'Corporate name',
    companyHint: '(for companies)',
    accountNumber: 'Account number:',
    bank: 'Custodian bank:',
    manager: 'Manager:',
    inPerson: 'Client meeting',
    call: 'Call report',
    date: 'Date:',
    location: 'Location:',
    object: 'Object / Description of the exchange with the client:',
    proposition: 'Investment proposition:',
    complaint: 'Complaint:',
    satisfaction: 'Client satisfaction level:',
    verySat: 'Very satisfied',
    sat: 'Satisfied',
    moderate: 'Moderately satisfied',
    dissat: 'Dissatisfied',
    signature: 'Manager signature'
  } : {
    title: 'Rapport de Visite Client',
    internal: 'Document Interne',
    disclaimer: 'La périodicité obligatoire de ce rapport est annuelle mais il devra être généré lors de chaque entretien avec le client dont vous jugez opportun de conserver une traçabilité.',
    name: 'Nom(s), Prénom(s) :',
    company: 'Dénomination sociale',
    companyHint: '(pour les sociétés)',
    accountNumber: 'Numéro du compte :',
    bank: 'Déposé auprès de la banque dépositaire :',
    manager: 'Gestionnaire :',
    inPerson: 'Rendez-vous Client',
    call: 'Call Report',
    date: 'Date :',
    location: 'Lieu :',
    object: 'Objet/Descriptif de l’échange avec le client :',
    proposition: 'Proposition d’Investissement :',
    complaint: 'Réclamation :',
    satisfaction: 'Niveau Satisfaction Client :',
    verySat: 'Très Satisfait',
    sat: 'Satisfait',
    moderate: 'Moyennement Satisfait',
    dissat: 'Mécontent',
    signature: 'Signature du gestionnaire'
  };

  const sat = report.satisfaction;
  const isInPerson = report.meetingType === MEETING_TYPES.IN_PERSON;
  const isCall = report.meetingType === MEETING_TYPES.CALL;

  return `<!doctype html>
<html lang="${escape(lang)}">
<head>
<meta charset="utf-8" />
<title>${escape(t.title)}</title>
<style>
  /* Amberlake Partners brand: amber gradient #b65f23 → #c76d2f, accent #DD772A, dark #1A2B40 */
  * { box-sizing: border-box; }
  html, body { width: 100%; max-width: 100%; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 11pt;
    color: #1f2937;
    margin: 0;
    padding: 0;
    line-height: 1.45;
    overflow-x: hidden;
  }
  .brand-bar {
    background: linear-gradient(135deg, #b65f23 0%, #c76d2f 100%);
    color: #ffffff;
    padding: 14px 18px;
    margin-bottom: 18px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
  }
  .brand-bar .logo {
    height: 30px;
    width: auto;
    flex: 0 0 auto;
    filter: brightness(0) invert(1); /* render dark logo as white on amber bar */
  }
  .brand-bar .titles { text-align: right; flex: 1 1 auto; min-width: 0; }
  .brand-bar h1 {
    margin: 0;
    font-size: 14pt;
    font-weight: 600;
    letter-spacing: 0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .brand-bar .subtitle {
    margin-top: 2px;
    font-size: 9pt;
    opacity: 0.9;
    white-space: nowrap;
  }
  .disclaimer {
    font-size: 9pt;
    color: #475569;
    background: #faf3ec;
    padding: 9px 14px;
    border-left: 4px solid #DD772A;
    border-radius: 0 4px 4px 0;
    margin-bottom: 18px;
  }
  table.identity { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  table.identity td { padding: 7px 10px; border: 1px solid #e2e8f0; vertical-align: top; font-size: 10.5pt; }
  table.identity td.label { background: #faf3ec; font-weight: 600; color: #1A2B40; width: 40%; }
  .meeting-type {
    display: flex; gap: 24px; margin-bottom: 14px; padding: 10px 12px;
    background: #faf3ec; border-radius: 4px;
  }
  .cb { font-size: 14pt; vertical-align: middle; color: #b65f23; }
  .cb-label { vertical-align: middle; margin-left: 4px; font-weight: 500; }
  .meta-row {
    display: flex; gap: 36px; margin-bottom: 18px; font-size: 11pt;
    padding: 8px 12px; background: #faf3ec; border-radius: 4px;
  }
  .meta-row strong { color: #1A2B40; }
  .section { margin-bottom: 16px; page-break-inside: avoid; }
  .section h2 {
    font-size: 11.5pt;
    color: #1A2B40;
    margin: 0 0 8px 0;
    padding-bottom: 4px;
    border-bottom: 2px solid #DD772A;
    font-weight: 600;
    letter-spacing: 0.2px;
  }
  .section .body {
    padding: 12px 14px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-left: 3px solid #DD772A;
    border-radius: 0 4px 4px 0;
    min-height: 24px;
  }
  .section .body p { margin: 0 0 8px 0; text-align: justify; }
  .section .body p:last-child { margin-bottom: 0; }
  .satisfaction {
    display: flex; gap: 22px; flex-wrap: wrap; align-items: center;
    padding: 10px 12px; background: #faf3ec; border-radius: 4px;
  }
  .signature {
    margin-top: 36px; display: flex; justify-content: space-between; align-items: flex-end;
    font-size: 10pt; padding-top: 12px; border-top: 1px solid #e2e8f0;
  }
  .signature .line {
    border-top: 1.5px solid #1A2B40; min-width: 220px; padding-top: 4px; text-align: center;
    color: #1A2B40; font-weight: 500;
  }
  .footer-brand {
    margin-top: 24px; padding-top: 10px; border-top: 1px solid #e2e8f0;
    font-size: 8pt; color: #b65f23; text-align: center; letter-spacing: 1px; font-weight: 600;
  }
</style>
</head>
<body>
  <div class="brand-bar">
    <img class="logo" src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png" alt="Amberlake Partners" />
    <div class="titles">
      <h1>${escape(t.title)}</h1>
      <div class="subtitle">${escape(t.internal)}</div>
    </div>
  </div>

  <div class="disclaimer">${escape(t.disclaimer)}</div>

  <table class="identity">
    <tr>
      <td class="label">${escape(t.name)}</td>
      <td>${escape(report.clientNameSnapshot || '')}</td>
    </tr>
    <tr>
      <td class="label">${escape(t.accountNumber)}</td>
      <td>${escape(report.accountNumberSnapshot || '')}</td>
    </tr>
    <tr>
      <td class="label">${escape(t.bank)}</td>
      <td>${escape(report.bankNameSnapshot || '')}</td>
    </tr>
    <tr>
      <td class="label">${escape(t.manager)}</td>
      <td>${escape(report.managerNameSnapshot || '')}</td>
    </tr>
  </table>

  <div class="meeting-type">
    ${checkboxRow(t.inPerson, isInPerson)}
    ${checkboxRow(t.call, isCall)}
  </div>

  <div class="meta-row">
    <div><strong>${escape(t.date)}</strong> ${escape(formatDate(report.meetingDate, lang))}</div>
    ${report.location ? `<div><strong>${escape(t.location)}</strong> ${escape(report.location)}</div>` : ''}
  </div>

  <div class="section">
    <h2>${escape(t.object)}</h2>
    <div class="body">${paragraphs(report.sections?.object)}</div>
  </div>

  <div class="section">
    <h2>${escape(t.proposition)}</h2>
    <div class="body">${paragraphs(report.sections?.proposition)}</div>
  </div>

  <div class="section">
    <h2>${escape(t.complaint)}</h2>
    <div class="body">${paragraphs(report.sections?.complaint)}</div>
  </div>

  <div class="section">
    <h2>${escape(t.satisfaction)}</h2>
    <div class="satisfaction">
      ${checkboxRow(t.verySat, sat === SATISFACTION_LEVELS.VERY_SATISFIED)}
      ${checkboxRow(t.moderate, sat === SATISFACTION_LEVELS.MODERATELY_SATISFIED)}
      ${checkboxRow(t.sat, sat === SATISFACTION_LEVELS.SATISFIED)}
      ${checkboxRow(t.dissat, sat === SATISFACTION_LEVELS.DISSATISFIED)}
    </div>
  </div>

  <div class="signature">
    <div><strong>${escape(t.date)}</strong> ${escape(formatDate(report.meetingDate, lang))}</div>
    <div class="line">${escape(t.signature)}<br/>${escape(report.managerNameSnapshot || '')}</div>
  </div>

  <div class="footer-brand">AMBERLAKE PARTNERS</div>
</body>
</html>`;
}
