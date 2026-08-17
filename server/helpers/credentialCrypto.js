import { Meteor } from 'meteor/meteor';
import crypto from 'crypto';

/**
 * At-rest encryption for stored third-party credentials (e.g. bankConnections
 * SFTP passwords). AES-256-GCM, key derived from
 * Meteor.settings.private.CREDENTIALS_ENCRYPTION_KEY.
 *
 * Stored format: "enc:v1:<ivB64>:<tagB64>:<cipherB64>".
 * decryptSecret() passes non-"enc:v1:" values through unchanged, so plaintext
 * written before the key existed keeps working until the startup migration
 * (encryptStoredCredentials) converts it.
 */

const PREFIX = 'enc:v1:';
let warnedNoKey = false;

const getKey = () => {
  const raw = Meteor.settings?.private?.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw || typeof raw !== 'string' || raw.length < 16) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn('[credentialCrypto] CREDENTIALS_ENCRYPTION_KEY not configured — stored credentials remain in plaintext');
    }
    return null;
  }
  // Normalize any sufficiently long string to a 32-byte key.
  return crypto.createHash('sha256').update(raw).digest();
};

export const isEncryptedSecret = (value) =>
  typeof value === 'string' && value.startsWith(PREFIX);

export const encryptSecret = (plaintext) => {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  if (isEncryptedSecret(plaintext)) return plaintext; // already encrypted
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
};

export const decryptSecret = (value) => {
  if (!isEncryptedSecret(value)) return value; // plaintext passthrough
  const key = getKey();
  if (!key) {
    throw new Meteor.Error('credentials-key-missing',
      'Stored credential is encrypted but CREDENTIALS_ENCRYPTION_KEY is not configured');
  }
  const [ivB64, tagB64, cipherB64] = value.slice(PREFIX.length).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(cipherB64, 'base64')), decipher.final()]).toString('utf8');
};
