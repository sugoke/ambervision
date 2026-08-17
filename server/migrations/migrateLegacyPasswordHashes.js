import crypto from 'crypto';
import { UsersCollection, UserHelpers } from '/imports/api/users';

/**
 * SECURITY migration: legacy accounts stored passwords as reversible base64
 * ("btoa(password + 'salt123')"). Because that scheme is reversible, we can
 * decode each legacy hash and immediately re-store it as scrypt — no user
 * action needed, and no reversible password material remains in the DB.
 *
 * Undecodable non-scrypt values (corrupt data) are replaced with a random
 * scrypt hash and flagged mustChangePassword, forcing an admin reset.
 *
 * Idempotent: only touches documents whose password doesn't start with 'scrypt$'.
 */
export async function migrateLegacyPasswordHashes() {
  const legacyUsers = await UsersCollection.find(
    { password: { $exists: true, $not: /^scrypt\$/ } },
    { fields: { password: 1 } }
  ).fetchAsync();

  if (legacyUsers.length === 0) return;

  let converted = 0;
  let locked = 0;
  for (const user of legacyUsers) {
    let plaintext = null;
    try {
      const decoded = Buffer.from(String(user.password), 'base64').toString('utf8');
      if (decoded.endsWith('salt123')) {
        plaintext = decoded.slice(0, -'salt123'.length);
      }
    } catch (e) {
      // fall through to lock
    }

    if (plaintext !== null) {
      await UsersCollection.updateAsync(user._id, {
        $set: { password: UserHelpers.hashPassword(plaintext) }
      });
      converted++;
    } else {
      await UsersCollection.updateAsync(user._id, {
        $set: {
          password: UserHelpers.hashPassword(crypto.randomBytes(32).toString('hex')),
          mustChangePassword: true
        }
      });
      locked++;
    }
  }

  console.log(`[migrateLegacyPasswordHashes] Upgraded ${converted} legacy password hash(es) to scrypt${locked ? `, locked ${locked} undecodable account(s) pending admin reset` : ''}`);
}
