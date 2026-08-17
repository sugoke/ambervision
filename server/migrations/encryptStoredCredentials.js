import { BankConnectionsCollection } from '/imports/api/bankConnections';
import { encryptSecret, isEncryptedSecret } from '../helpers/credentialCrypto.js';

/**
 * SECURITY migration: bankConnections SFTP passwords were stored in plaintext
 * ("Will be encrypted in production" — it never was). Encrypt every stored
 * plaintext password with AES-256-GCM (see server/helpers/credentialCrypto.js).
 *
 * Idempotent: already-encrypted values (enc:v1: prefix) are skipped. No-op
 * (with a warning from credentialCrypto) when CREDENTIALS_ENCRYPTION_KEY is
 * not configured.
 */
export async function encryptStoredCredentials() {
  const connections = await BankConnectionsCollection.find(
    { password: { $type: 'string', $ne: '' } },
    { fields: { password: 1 } }
  ).fetchAsync();

  let encrypted = 0;
  for (const conn of connections) {
    if (isEncryptedSecret(conn.password)) continue;
    const value = encryptSecret(conn.password);
    if (value === conn.password) return; // no key configured — nothing we can do
    await BankConnectionsCollection.updateAsync(conn._id, { $set: { password: value } });
    encrypted++;
  }

  if (encrypted > 0) {
    console.log(`[encryptStoredCredentials] Encrypted ${encrypted} stored SFTP password(s) at rest`);
  }
}
