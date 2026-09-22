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
      // The opened tab keeps a handle on this one; drop it once it has
      // navigated so the document cannot script the app.
      try { win.opener = null; } catch { /* cross-origin once navigated */ }
      return true;
    }
    // Popup unavailable (standalone PWA, in-app webview, blocker). This must
    // NOT navigate the current tab: a full-screen PDF then replaces the app
    // and on mobile there is no way back to it. A synthetic target="_blank"
    // click is the remaining way to hand the file to a separate tab — and in
    // a standalone PWA it leaves the app entirely, which is what we want.
    return openViaAnchor(url);
  } catch (error) {
    if (win && !win.closed) win.close();
    throw error;
  }
}

/**
 * Last-resort open that never touches the current tab. Returns false when
 * there is no document to click into, so callers can tell the user rather
 * than leaving them staring at an unchanged screen.
 */
function openViaAnchor(url) {
  if (typeof document === 'undefined' || !document.body) return false;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}

export default openDocumentWindow;
