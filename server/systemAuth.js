import { Random } from 'meteor/random';

/**
 * Boot-generated system token for trusted in-process (cron/startup) calls.
 *
 * Replaces the old hardcoded 'system-cron' / 'system' magic strings that any
 * client could pass as a sessionId to be treated as superadmin. This token is
 * minted fresh at each server start, lives only in the server process, and is
 * never sent to a client — so it cannot be guessed or replayed from the browser.
 */
export const SYSTEM_CRON_TOKEN = Random.id(32);

export const isSystemSession = (sessionId) =>
  typeof sessionId === 'string' && sessionId.length > 0 && sessionId === SYSTEM_CRON_TOKEN;
