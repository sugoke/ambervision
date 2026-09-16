import React, { useCallback, useState } from 'react';
import {
  downloadEml,
  isMobileMailDevice,
  downloadOrderAttachments,
  openOutlookCompose
} from '/imports/utils/emlBuilder.js';
import OrderEmailSheet from '../components/OrderEmailSheet.jsx';

/**
 * One entry point for "give the user the bank email for this order".
 *
 * Desktop: the .eml draft download, which Outlook opens prefilled.
 *
 * Phone/tablet: iOS cannot open a .eml as a draft (Outlook attaches the .eml
 * itself to a blank message), and no mobile route can prefill the text AND
 * attach a file in one go. So the order PDF (and termsheet) is saved to Files
 * and Outlook is opened through its compose deep link with To/Cc/Subject/Body
 * prefilled; the attachment is then picked from Files > Downloads inside the
 * draft. The OrderEmailSheet stays open with the same two actions as buttons
 * (the automatic hand-off can be refused when the tap that started the
 * validation is too old) plus the recipients and text to copy.
 *
 * Usage:
 *   const { deliverOrderEmail, orderEmailSheet } = useOrderEmailDelivery();
 *   deliverOrderEmail({ orderReference, emailData, pdfData, termsheet });
 *   ... render {orderEmailSheet} anywhere in the tree (it portals to <body>).
 */
export const useOrderEmailDelivery = () => {
  const [mobilePayload, setMobilePayload] = useState(null);

  const deliverOrderEmail = useCallback((payload) => {
    if (!payload?.emailData || !payload?.pdfData) return false;
    if (!isMobileMailDevice()) return downloadEml(payload);
    setMobilePayload(payload);
    // Best effort, both retryable from the sheet: save the PDF first (a synchronous
    // anchor click, so it goes through before the page is backgrounded), then hand
    // off to Outlook once the download has been handed to the browser.
    downloadOrderAttachments(payload);
    setTimeout(() => openOutlookCompose(payload.emailData), 400);
    return true;
  }, []);

  const orderEmailSheet = mobilePayload
    ? React.createElement(OrderEmailSheet, { payload: mobilePayload, onClose: () => setMobilePayload(null) })
    : null;

  return { deliverOrderEmail, orderEmailSheet, isMobileMailDevice: isMobileMailDevice() };
};

export default useOrderEmailDelivery;
