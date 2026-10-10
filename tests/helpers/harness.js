// Invoke publications and methods the way DDP would, without a client.
import { Meteor } from 'meteor/meteor';

/**
 * Run a publication handler and collect every document it publishes.
 * Handles cursors, arrays of cursors, and the manual added()/observeChanges
 * style. Resolves `{ docs, threw }`; `threw` carries a thrown error (e.g. a
 * Match.Error from argument validation) instead of rejecting.
 */
export async function collectPublication(name, ...args) {
  const handler = Meteor.server.publish_handlers[name];
  if (!handler) throw new Error(`No publication named ${name}`);

  const docs = [];
  const stops = [];
  const ctx = {
    userId: null,
    connection: { id: 'mocha-conn', headers: {}, clientAddress: '127.0.0.1' },
    added(coll, id, fields) { docs.push({ _id: id, ...fields, __collection: coll }); },
    changed() {},
    removed(coll, id) { const i = docs.findIndex(d => d._id === id); if (i >= 0) docs.splice(i, 1); },
    ready() {},
    stop() {},
    onStop(fn) { stops.push(fn); },
    unblock() {},
    error(e) { throw e; }
  };

  let threw = null;
  try {
    const result = await handler.apply(ctx, args);
    const cursors = Array.isArray(result) ? result : (result ? [result] : []);
    for (const c of cursors) {
      if (c && typeof c.fetchAsync === 'function') {
        const rows = await c.fetchAsync();
        docs.push(...rows.map(r => ({ ...r, __collection: c._cursorDescription?.collectionName })));
      }
    }
  } catch (e) {
    threw = e;
  } finally {
    for (const fn of stops) { try { await fn(); } catch (e) { /* ignore */ } }
  }
  return { docs, threw };
}

/** Call a method handler as an unauthenticated DDP connection would. */
export async function callMethod(name, ...args) {
  const handler = Meteor.server.method_handlers[name];
  if (!handler) throw new Error(`No method named ${name}`);
  const ctx = {
    userId: null,
    connection: { id: 'mocha-conn', headers: {}, clientAddress: '127.0.0.1' },
    isSimulation: false,
    unblock() {},
    setUserId() {}
  };
  return handler.apply(ctx, args);
}

/** Resolves `{ result, error }` instead of throwing. */
export async function tryMethod(name, ...args) {
  try {
    return { result: await callMethod(name, ...args), error: null };
  } catch (error) {
    return { result: undefined, error };
  }
}

export function hasMethod(name) {
  return !!Meteor.server.method_handlers[name];
}

export function hasPublication(name) {
  return !!Meteor.server.publish_handlers[name];
}
