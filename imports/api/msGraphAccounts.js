import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

/**
 * Per-user Microsoft Graph (Outlook) mailbox connections.
 *
 * Deliberately a collection of its own rather than a `customUsers.services.*`
 * subdocument: server/publications/users.js publishes `profile: 1` wholesale and
 * customUsers docs travel widely, so keeping OAuth tokens out of that document
 * removes any chance of one reaching a client. Nothing here is ever published —
 * the UI reads its status through the `msgraph.status` method, which returns the
 * safe projection below.
 *
 * Tokens are encrypted at rest by the caller (server/msgraph/accountStore.js,
 * via server/helpers/credentialCrypto.js) — same split as bankConnections.
 *
 * Schema:
 * {
 *   _id: String,
 *   userId: String,                 // customUsers._id
 *   clientId: String,               // Entra app id this connection was granted to.
 *                                   // Dev and prod use separate app registrations, so a
 *                                   // developer's own connection never collides with their
 *                                   // production one in this shared Atlas database.
 *   microsoftUserId: String,        // Entra object id (oid)
 *   microsoftEmail: String,         // mail || userPrincipalName
 *   displayName: String,
 *   tenantId: String,
 *   scopes: [String],               // scopes actually granted
 *   refreshToken: String,           // encrypted ("enc:v1:...")
 *   accessToken: String,            // encrypted ("enc:v1:...")
 *   accessTokenExpiresAt: Date,
 *   status: 'connected' | 'needs_reconsent' | 'revoked',
 *   lastError: String | null,
 *   connectedAt: Date,
 *   lastUsedAt: Date | null,
 *   lastRefreshAt: Date | null
 * }
 */
export const MsGraphAccountsCollection = new Mongo.Collection('msGraphAccounts');

/**
 * Short-lived OAuth authorization state. Bridges the browser redirect back to
 * this app's custom session model: `this.userId` is always null here, so the
 * callback cannot identify the user from Meteor. The state doc — created by an
 * authenticated method call — is what carries the userId, which means the
 * session token itself never travels through Microsoft's redirect.
 *
 * { _id, stateHash, userId, codeVerifier, createdAt, expiresAt }
 */
export const MsGraphAuthStatesCollection = new Mongo.Collection('msGraphAuthStates');

export const MSGRAPH_STATUS = {
  CONNECTED: 'connected',
  NEEDS_RECONSENT: 'needs_reconsent',
  REVOKED: 'revoked'
};

// Fields safe to hand to the client. Never includes refreshToken/accessToken.
export const MSGRAPH_PUBLIC_FIELDS = {
  microsoftEmail: 1,
  displayName: 1,
  status: 1,
  scopes: 1,
  connectedAt: 1,
  lastUsedAt: 1,
  lastError: 1
};

if (Meteor.isServer) {
  Meteor.startup(async () => {
    try {
      await MsGraphAccountsCollection.createIndexAsync({ userId: 1, clientId: 1 }, { unique: true });
      await MsGraphAccountsCollection.createIndexAsync({ userId: 1 });
      await MsGraphAuthStatesCollection.createIndexAsync({ stateHash: 1 }, { unique: true });
      // TTL: abandoned sign-ins clean themselves up.
      await MsGraphAuthStatesCollection.createIndexAsync({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    } catch (e) {
      console.error('[MSGraph] Index creation failed:', e.message);
    }
  });
}
