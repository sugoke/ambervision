/**
 * Open a document URL that must first be minted by an async server call
 * (signed download tokens), without tripping mobile popup blockers.
 *
 * `window.open(url)` AFTER an await is outside the user-gesture call stack, so
 * iOS Safari (and most mobile browsers) silently block it — the classic
 * "download works on desktop but does nothing on the phone". The fix is to
 * open the tab synchronously inside the gesture and point it at the URL once
 * the async call resolves.
 *
 * Usage (inside a click handler):
 *   await openDocumentWindow(() => Meteor.callAsync('products.getTermSheetUrl', ...));
 */
export async function openDocumentWindow(getUrl) {
  // Opened synchronously, while we are still inside the user gesture
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const url = await getUrl();
    if (!url) {
      // Flow legitimately produced no document — just close the placeholder
      if (win && !win.closed) win.close();
      return false;
    }
    if (win && !win.closed) {
      win.location.replace(url);
    } else {
      // Popup unavailable (standalone PWA / blocker): navigate this tab.
      // For document endpoints the browser shows the file and Back returns.
      window.location.assign(url);
    }
    return true;
  } catch (error) {
    if (win && !win.closed) win.close();
    throw error;
  }
}

export default openDocumentWindow;
