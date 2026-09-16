/**
 * Prefilled bank-order emails.
 *
 * The app never sends the order email itself: it hands the user a .eml draft
 * (X-Unsent: 1) with To/Cc/Subject/Body and the order PDF (plus the termsheet
 * when there is one) attached, which Outlook opens as an editable draft.
 * Used by the validation blotter (right after validating) and the order book
 * (re-sending later), and per client for a bulk.
 */

/** Build the RFC 2822 MIME text of the draft. */
export const buildEmlFile = (emailData, pdfBase64, pdfFilename, termsheet) => {
  const boundary = '----=_NextPart_' + Date.now().toString(36);
  const extraAttachments = [];
  if (termsheet?.content && termsheet?.name) {
    extraAttachments.push({
      name: termsheet.name,
      content: termsheet.content,
      contentType: termsheet.contentType || 'application/octet-stream'
    });
  }

  const lines = [
    `To: ${emailData.to || ''}`,
    emailData.cc ? `Cc: ${emailData.cc}` : null,
    `Subject: ${emailData.subject || ''}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    emailData.body || '',
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${pdfFilename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${pdfFilename}"`,
    '',
    // Split base64 into 76-char lines per MIME spec
    ...(pdfBase64.match(/.{1,76}/g) || []),
    ''
  ];
  extraAttachments.forEach(att => {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${att.contentType}; name="${att.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.name}"`,
      '',
      ...(att.content.match(/.{1,76}/g) || []),
      ''
    );
  });
  lines.push(`--${boundary}--`);

  return lines.filter(l => l !== null).join('\r\n');
};

/**
 * Hand the browser one .eml draft for an order.
 * `payload` is the shape orders.validate / orders.prepareEmail return:
 * { orderReference, emailData, pdfData, termsheet }.
 */
export const downloadEml = ({ orderReference, emailData, pdfData, termsheet }) => {
  if (!emailData || !pdfData) return false;
  const reference = orderReference || 'order';
  const emlContent = buildEmlFile(emailData, pdfData, `${reference}.pdf`, termsheet);
  const blob = new Blob([emlContent], { type: 'message/rfc822' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${reference}.eml`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke after the click has been handed off, otherwise some browsers abort the download.
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return true;
};

/**
 * Download several drafts one after another. Browsers block a burst of
 * downloads fired in the same tick, so each is spaced out; Chrome may still ask
 * once to allow multiple downloads from the site.
 */
export const downloadEmlSequential = async (payloads, delayMs = 600) => {
  let count = 0;
  for (const payload of payloads) {
    if (downloadEml(payload)) count++;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return count;
};

/* ------------------------------------------------------------------------- *
 * Mobile path
 *
 * iOS (Safari, Outlook, Mail) cannot open a .eml as an editable draft: the
 * file lands in the share sheet and Outlook attaches the .eml itself to an
 * empty message, which the bank desk cannot read. On phones we therefore skip
 * the .eml and hand the PDF (and termsheet) to the share sheet as real files,
 * with the subject and body alongside, and show the recipients to copy.
 * ------------------------------------------------------------------------- */

/**
 * Whether this device cannot open a .eml draft (phones and tablets). Detection
 * is by device, not viewport: an iPad in landscape is wide but has the same
 * limitation.
 */
export const isMobileMailDevice = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  // iPadOS 13+ reports a desktop Safari UA; touch points give it away.
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
  return false;
};

const base64ToFile = (base64, name, type) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
};

/** The attachments of a draft as File objects: the order PDF, then the termsheet when there is one. */
export const buildOrderAttachmentFiles = ({ orderReference, pdfData, termsheet }) => {
  const files = [];
  if (pdfData) files.push(base64ToFile(pdfData, `${orderReference || 'order'}.pdf`, 'application/pdf'));
  if (termsheet?.content && termsheet?.name) {
    files.push(base64ToFile(termsheet.content, termsheet.name, termsheet.contentType || 'application/octet-stream'));
  }
  return files;
};

/** True when the browser can put these files on the native share sheet. */
export const canShareOrderEmail = (payload) => {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
  try {
    const files = buildOrderAttachmentFiles(payload);
    return files.length > 0 && navigator.canShare({ files });
  } catch (err) {
    return false;
  }
};

/**
 * Put the PDF (and termsheet) on the native share sheet with the subject and
 * body. Mail and Outlook attach the files; recipients cannot be prefilled this
 * way, so the caller shows them for copying.
 * Resolves true when the user completed the share, false when they dismissed
 * it or the browser refused (e.g. the tap that triggered it is too old).
 */
export const shareOrderEmail = async (payload) => {
  if (!canShareOrderEmail(payload)) return false;
  const { emailData = {} } = payload;
  try {
    await navigator.share({
      files: buildOrderAttachmentFiles(payload),
      title: emailData.subject || '',
      text: emailData.body || ''
    });
    return true;
  } catch (err) {
    // AbortError: user closed the sheet. NotAllowedError: no fresh user gesture.
    console.warn('[emlBuilder] share sheet not completed:', err?.name || err);
    return false;
  }
};

/** A mailto: link with To/Cc/Subject/Body prefilled (attachments are not possible via mailto). */
export const buildMailtoUrl = (emailData = {}) => {
  const params = [];
  if (emailData.cc) params.push(`cc=${encodeURIComponent(emailData.cc.split(';').map(a => a.trim()).filter(Boolean).join(','))}`);
  if (emailData.subject) params.push(`subject=${encodeURIComponent(emailData.subject)}`);
  if (emailData.body) params.push(`body=${encodeURIComponent(emailData.body)}`);
  const to = (emailData.to || '').split(';').map(a => a.trim()).filter(Boolean).join(',');
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@').replace(/%2C/g, ',')}${params.length ? '?' + params.join('&') : ''}`;
};

/** Plain download of the attachments (fallback when the share sheet is unavailable). */
export const downloadOrderAttachments = (payload) => {
  const files = buildOrderAttachmentFiles(payload);
  files.forEach((file, i) => {
    setTimeout(() => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(file);
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, i * 600);
  });
  return files.length;
};

/**
 * Outlook for iOS/Android compose deep link. Prefills To/Cc/Subject/Body;
 * attachments are not supported by the scheme, so the PDF is saved to Files
 * first and picked up from the Outlook draft (Attach > Files > Downloads).
 * Recipients are semicolon separated, which is the format emailData already uses.
 */
export const buildOutlookComposeUrl = (emailData = {}) => {
  const params = [];
  if (emailData.to) params.push(`to=${encodeURIComponent(emailData.to)}`);
  if (emailData.cc) params.push(`cc=${encodeURIComponent(emailData.cc)}`);
  if (emailData.subject) params.push(`subject=${encodeURIComponent(emailData.subject)}`);
  if (emailData.body) params.push(`body=${encodeURIComponent(emailData.body)}`);
  return `ms-outlook://compose?${params.join('&')}`;
};

/** Hand off to the Outlook app. Nothing happens when Outlook is not installed (the sheet offers mailto: for that). */
export const openOutlookCompose = (emailData) => {
  if (typeof window === 'undefined') return;
  window.location.href = buildOutlookComposeUrl(emailData);
};
