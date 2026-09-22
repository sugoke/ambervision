import React, { useCallback, useState } from 'react';
import {
  downloadEml,
  isMobileMailDevice,
  downloadOrderAttachments,
  openOutlookCompose
} from '/imports/utils/emlBuilder.js';
import OrderEmailSheet from '../components/OrderEmailSheet.jsx';
import OrderSendPreviewModal from '../components/OrderSendPreviewModal.jsx';
import OrderSentToast from '../components/OrderSentToast.jsx';
import { useGraphConnection } from './useGraphConnection.js';

/**
 * One entry point for "give the user the bank email for this order".
 *
 * Connected Outlook mailbox, on any device: a preview opens and the mail is
 * sent from the user's own mailbox via Microsoft Graph, landing in their Sent
 * Items. The sent copy is then filed back onto the order as the order_to_bank
 * trace, which previously meant dragging the sent mail back in by hand.
 *
 * This is the whole point of the Graph route on a phone: the message is built
 * and sent server-side, so none of the mobile limitations apply — no .eml to
 * open, no attachment to re-pick out of Files, no app switch at all.
 *
 * Without a connected mailbox, unchanged:
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
 *   const { deliverOrderEmail, orderEmailSheet, orderSendPreview } = useOrderEmailDelivery();
 *   deliverOrderEmail({ orderReference, emailData, pdfData, termsheet }, { orderId });
 *   ... render {orderEmailSheet}{orderSendPreview} anywhere (both portal to <body>).
 */
export const useOrderEmailDelivery = () => {
  const [mobilePayload, setMobilePayload] = useState(null);
  const [previewPayload, setPreviewPayload] = useState(null);
  const [sentNotice, setSentNotice] = useState(null);
  const graph = useGraphConnection();

  const deliverOrderEmail = useCallback((payload, options = {}) => {
    if (!payload?.emailData || !payload?.pdfData) return false;

    // orderId is required to send server-side (the payload is rebuilt there and
    // never trusted from the client). Without it, fall back rather than guess.
    if (graph.connected && options.orderId) {
      setPreviewPayload({ ...payload, orderId: options.orderId });
      return true;
    }

    if (!isMobileMailDevice()) return downloadEml(payload);
    setMobilePayload(payload);
    // Best effort, both retryable from the sheet: save the PDF first (a synchronous
    // anchor click, so it goes through before the page is backgrounded), then hand
    // off to Outlook once the download has been handed to the browser.
    downloadOrderAttachments(payload);
    setTimeout(() => openOutlookCompose(payload.emailData), 400);
    return true;
  }, [graph.connected]);

  const orderEmailSheet = mobilePayload
    ? React.createElement(OrderEmailSheet, { payload: mobilePayload, onClose: () => setMobilePayload(null) })
    : null;

  // The modal closes on a successful send, so the confirmation lives outside it.
  // Both elements ride in the same `orderSendPreview` slot every caller already
  // renders — a separate one would have to be wired into each of them.
  const orderSendPreview = React.createElement(
    React.Fragment,
    null,
    previewPayload
      ? React.createElement(OrderSendPreviewModal, {
        key: 'preview',
        payload: previewPayload,
        mailbox: graph.mailbox,
        onClose: () => setPreviewPayload(null),
        onSent: (result) => {
          setPreviewPayload(null);
          setSentNotice({
            orderReference: result?.orderReference || previewPayload.orderReference,
            sentTo: result?.sentTo || null,
            count: 1
          });
        }
      })
      : null,
    React.createElement(OrderSentToast, {
      key: 'toast',
      notice: sentNotice,
      onDismiss: () => setSentNotice(null)
    })
  );

  return {
    deliverOrderEmail,
    orderEmailSheet,
    orderSendPreview,
    // Bulk sending runs in its own modal; it reports through the same toast.
    notifyOrdersSent: (notice) => setSentNotice(notice),
    graphConnected: graph.connected,
    graphMailbox: graph.mailbox,
    isMobileMailDevice: isMobileMailDevice()
  };
};

export default useOrderEmailDelivery;
