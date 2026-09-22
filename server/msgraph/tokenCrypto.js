import { Meteor } from 'meteor/meteor';
import crypto from 'crypto';

/**
 * At-rest encryption for Microsoft Graph OAuth tokens.
 *
 * Same AES-256-GCM construction as server/helpers/credentialCrypto.js, but with
 * two deliberate differences:
 *
 *  1. **Its own key** (MSGRAPH_TOKEN_ENCRYPTION_KEY), not CREDENTIALS_ENCRYPTION_KEY.
 *     This dev machine points at the shared production Atlas cluster, and its
 *     CREDENTIALS_ENCRYPTION_KEY is deliberately parked as
 *     `_CREDENTIALS_ENCRYPTION_KEY_AFTER_DEPLOY` so dev cannot write values prod
 *     can't read. A separate key lets dev hold its *own* random value: dev can
 *     connect a mailbox and test, while remaining unable to decrypt any
 *     production Graph token sitting in the same collection.
 *
 *  2. **Fail closed.** credentialCrypto.encryptSecret() passes plaintext through
 *     when no key is configured — right for the bankConnections migration it was
 *     written for, where pre-existing plaintext had to keep working. A Graph
 *     refresh token is a long-lived credential to a person's entire mailbox, so
 *     there is no acceptable plaintext fallback: without a key we refuse to
 *     store anything at all.
 */

const PREFIX = 'genc:v1:';

const getKey = () => {
  const raw = Meteor.settings?.private?.MSGRAPH_TOKEN_ENCRYPTION_KEY;
  if (!raw || typeof raw !== 'string' || raw.length < 16) return null;
  return crypto.createHash('sha256').update(raw).digest();
};

export const isGraphSecretEncrypted = (value) =>
  typeof value === 'string' && value.startsWith(PREFIX);

export const isGraphCryptoAvailable = () => getKey() !== null;

export function assertGraphCryptoAvailable() {
  if (!isGraphCryptoAvailable()) {
    throw new Meteor.Error(
      'msgraph-key-missing',
      'Cannot store Outlook credentials: MSGRAPH_TOKEN_ENCRYPTION_KEY is not configured on this server. ' +
      'Set it to a long random string in your settings file (each environment may use its own value).'
    );
  }
}

export function encryptGraphSecret(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  if (isGraphSecretEncrypted(plaintext)) return plaintext;

  const key = getKey();
  if (!key) {
    // No silent plaintext fallback — see the header comment.
    throw new Meteor.Error('msgraph-key-missing', 'MSGRAPH_TOKEN_ENCRYPTION_KEY is not configured');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptGraphSecret(value) {
  if (!value) return value;
  if (!isGraphSecretEncrypted(value)) {
    // A Graph token was never allowed to be stored in plaintext, so anything
    // unprefixed here is corrupt or was written with a different scheme.
    throw new Meteor.Error('msgraph-token-unreadable', 'Stored Outlook credential is not in the expected encrypted format');
  }
  const key = getKey();
  if (!key) {
    throw new Meteor.Error('msgraph-key-missing', 'MSGRAPH_TOKEN_ENCRYPTION_KEY is not configured');
  }
  const [ivB64, tagB64, cipherB64] = value.slice(PREFIX.length).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(cipherB64, 'base64')), decipher.final()]).toString('utf8');
}
