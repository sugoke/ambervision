/**
 * Yield control back to the event loop periodically during long-running loops.
 * Prevents Node.js from starving other connections (subscriptions, method calls).
 *
 * @param {number} i - Current loop index
 * @param {number} interval - Yield every N iterations (default 50)
 */
export async function yieldToEventLoop(i, interval = 50) {
  if (i > 0 && i % interval === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }
}
