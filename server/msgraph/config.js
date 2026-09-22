import { Meteor } from 'meteor/meteor';

/**
 * Microsoft Graph configuration, read from Meteor.settings.private.
 *
 * The integration is entirely optional: when the settings block is absent the
 * feature reports itself as not configured and every UI affordance stays
 * hidden, exactly like the Telekurs endpoint's 503 `endpoint_not_configured`
 * behaviour (server/telekursIngestHandler.js). Nothing throws at startup.
 *
 * Why a server-side authorization-code flow rather than MSAL.js in the browser:
 * server/securityHeaders.js pins `connect-src 'self'` and `frame-ancestors
 * 'none'` as the primary defence for the localStorage session token. MSAL's
 * token XHR and its silent-renew iframe both violate that, so widening the CSP
 * would trade away the app's main anti-exfiltration control. Doing the code
 * exchange and every Graph call server-side needs no CSP change at all.
 */

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Delegated scopes. offline_access buys refresh tokens; User.Read identifies the
// connected mailbox in the UI; Mail.ReadWrite covers list/search/read/MIME *and*
// the draft we create before sending (POST /me/sendMail returns no id, so we
// need a draft to capture internetMessageId + conversationId); Mail.Send sends.
export const GRAPH_SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'User.Read',
  'Mail.ReadWrite',
  'Mail.Send'
];

export function getGraphConfig() {
  const p = Meteor.settings?.private || {};
  const tenantId = p.MSGRAPH_TENANT_ID;
  const clientId = p.MSGRAPH_CLIENT_ID;
  const clientSecret = p.MSGRAPH_CLIENT_SECRET;

  // Fall back to ROOT_URL so a correctly deployed environment needs no extra
  // setting; MSGRAPH_REDIRECT_URI stays available for odd proxy setups.
  const root = (p.APP_URL || process.env.ROOT_URL || '').replace(/\/+$/, '');
  const redirectUri = p.MSGRAPH_REDIRECT_URI || (root ? `${root}/auth/microsoft/callback` : null);

  return {
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
    archiveBcc: p.MSGRAPH_ARCHIVE_BCC || null,
    // Dev points at the shared production Atlas cluster, so connecting a real
    // mailbox from a developer's machine is opt-in rather than accidental.
    allowDev: p.MSGRAPH_ALLOW_DEV === true,
    authorizeUrl: tenantId ? `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize` : null,
    tokenUrl: tenantId ? `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token` : null,
    isConfigured: Boolean(tenantId && clientId && clientSecret && redirectUri)
  };
}

export function assertGraphConfigured() {
  const config = getGraphConfig();
  if (!config.isConfigured) {
    throw new Meteor.Error(
      'msgraph-not-configured',
      'Outlook integration is not configured on this server (MSGRAPH_TENANT_ID / MSGRAPH_CLIENT_ID / MSGRAPH_CLIENT_SECRET).'
    );
  }
  if (Meteor.isDevelopment && !config.allowDev) {
    throw new Meteor.Error(
      'msgraph-dev-disabled',
      'Outlook integration is disabled on this development server. This machine shares the production database, ' +
      'so connecting a mailbox is opt-in: set MSGRAPH_ALLOW_DEV: true in your settings file.'
    );
  }
  return config;
}

/**
 * Startup validation. Deliberately does NOT throw on missing settings — unlike
 * server/mcp/oauth/router.js, which hard-fails because MCP cannot work without
 * it. Outlook is an optional enhancement layered over a working .eml fallback,
 * so a rotated secret must degrade the feature, never take the app down.
 */
export function reportGraphStartupState() {
  const config = getGraphConfig();
  if (!config.isConfigured) {
    console.log('[MSGraph] Not configured — Outlook integration disabled (drag-and-drop / .eml fallback unaffected)');
    return;
  }
  if (Meteor.isProduction) {
    if (!process.env.ROOT_URL) {
      console.error('[MSGraph] ROOT_URL is not set — the OAuth redirect_uri cannot be derived. Outlook integration will fail.');
    } else if (!/^https:\/\//i.test(process.env.ROOT_URL)) {
      console.error(`[MSGraph] ROOT_URL must be https for OAuth, got: ${process.env.ROOT_URL}`);
    }
  }
  console.log(`[MSGraph] Ready — redirect_uri=${config.redirectUri}${Meteor.isDevelopment && !config.allowDev ? ' (dev connect disabled: set MSGRAPH_ALLOW_DEV)' : ''}`);
}
