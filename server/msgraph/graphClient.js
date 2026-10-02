import { Meteor } from 'meteor/meteor';
import { GRAPH_BASE } from './config.js';
import { getAccessToken, clearCachedToken } from './tokenStore.js';
import { touchLastUsed } from './accountStore.js';

/**
 * Thin Microsoft Graph transport. Everything above this layer deals in plain
 * objects; everything Graph-specific (auth headers, throttling, paging, OData
 * quoting) lives here.
 */

const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 30 * 1000;
// Total budget across retries, so a Meteor method can never hang indefinitely
// behind a throttled mailbox.
const TOTAL_BUDGET_MS = 35 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** OData string literals escape a single quote by doubling it. */
export const odataQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * Graph paging hands back an opaque absolute @odata.nextLink which we round-trip
 * through the browser as a cursor. Anything coming back from a client is
 * untrusted, so pin it to the Graph origin before fetching it — otherwise the
 * cursor is a server-side request forgery primitive.
 */
function resolveUrl(pathOrAbsoluteUrl) {
  if (/^https?:\/\//i.test(pathOrAbsoluteUrl)) {
    if (!pathOrAbsoluteUrl.startsWith(`${GRAPH_BASE}/`)) {
      throw new Meteor.Error('msgraph-bad-url', 'Refusing to follow a non-Graph URL');
    }
    return pathOrAbsoluteUrl;
  }
  return `${GRAPH_BASE}${pathOrAbsoluteUrl.startsWith('/') ? '' : '/'}${pathOrAbsoluteUrl}`;
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function readError(response) {
  try {
    const body = await response.json();
    return {
      code: body?.error?.code || null,
      message: body?.error?.message || response.statusText
    };
  } catch (e) {
    return { code: null, message: response.statusText };
  }
}

/**
 * Graph and Exchange speak to each other, not to our users. Turn the handful of
 * errors that reach the mail picker into something actionable; anything else
 * passes through unchanged.
 */
function friendlyGraphError(code, message) {
  const text = `${code || ''} ${message || ''}`;

  // EXO refuses some filter/sort combinations outright — notably a restriction
  // on a nested property (from/emailAddress/address) together with $orderby.
  if (/ErrorInvalidRestriction|restriction or sort order is too complex/i.test(text)) {
    return 'Outlook could not run that combination of filters. Try typing the name in the search box instead of the From field, or clear a filter.';
  }
  if (/ErrorAccessDenied|ErrorItemNotFound/i.test(text)) {
    return 'That mailbox item is not available — it may have been moved or deleted.';
  }
  if (/MailboxNotEnabledForRESTAPI|ErrorMailboxNotSupported/i.test(text)) {
    return 'This mailbox cannot be read through the Outlook connection.';
  }
  return null;
}

/**
 * Core request. Handles a stale access token (one forced refresh + retry) and
 * Graph throttling (429/503/504 with Retry-After).
 *
 * `raw: true` streams the body and returns a Buffer, aborting once `maxBytes`
 * is exceeded rather than buffering an arbitrarily large mail into memory.
 */
export async function graphFetch(userId, pathOrAbsoluteUrl, {
  method = 'GET',
  query,
  body,
  headers = {},
  raw = false,
  maxBytes = 25 * 1024 * 1024
} = {}) {
  const url = resolveUrl(pathOrAbsoluteUrl) + buildQuery(query);
  const startedAt = Date.now();
  let refreshed = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const token = await getAccessToken(userId);

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    // A token can be revoked mid-flight. Force one refresh, then give up.
    if (response.status === 401 && !refreshed) {
      refreshed = true;
      clearCachedToken(userId);
      continue;
    }

    if ([429, 503, 504].includes(response.status) && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS)
        // Exponential with jitter, so parallel callers don't resynchronise.
        : Math.min(1000 * Math.pow(2, attempt) * (0.8 + Math.random() * 0.4), MAX_RETRY_WAIT_MS);

      if (Date.now() - startedAt + backoff > TOTAL_BUDGET_MS) {
        throw new Meteor.Error('msgraph-throttled', 'Outlook is rate-limiting requests. Please try again in a moment.');
      }
      await sleep(backoff);
      continue;
    }

    if (!response.ok) {
      const { code, message } = await readError(response);
      // Exchange's own wording ("The restriction or sort order is too complex
      // for this operation") means nothing to whoever is picking an email, so
      // say what happened and what to do instead. The original is kept in the
      // server log and in the error details.
      const friendly = friendlyGraphError(code, message);
      if (friendly) {
        console.error(`[Graph] ${code || response.status}: ${message} — ${url.split('?')[0]}`);
      }
      throw new Meteor.Error('msgraph-error', friendly || message || `Graph returned ${response.status}`, {
        graphCode: code,
        status: response.status,
        graphMessage: message
      });
    }

    touchLastUsed(userId);

    if (raw) return streamToBuffer(response, maxBytes);
    // /send answers 202 with an empty body, not 204 — parsing it as JSON throws
    // after the mail has already gone, and the caller never records the send.
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  throw new Meteor.Error('msgraph-throttled', 'Outlook is rate-limiting requests. Please try again in a moment.');
}

async function streamToBuffer(response, maxBytes) {
  const chunks = [];
  let total = 0;

  // Graph does not advertise MIME size up front, so enforce the cap as bytes
  // arrive and abort the moment it is exceeded.
  for await (const chunk of response.body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Meteor.Error('msgraph-too-large', 'This email is larger than the size limit for attachments.');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

// Fields the picker list needs. Kept narrow so a 25-row page stays small.
const LIST_SELECT = [
  'id', 'subject', 'from', 'toRecipients', 'receivedDateTime', 'sentDateTime',
  'hasAttachments', 'bodyPreview', 'conversationId', 'internetMessageId', 'isRead'
].join(',');

export async function getMe(userId) {
  return graphFetch(userId, '/me', { query: { $select: 'id,displayName,mail,userPrincipalName' } });
}

/**
 * Browse mode: exact filtering, newest first, deep paging.
 *
 * Paging uses @odata.nextLink rather than $skip: $skip is O(n) server-side and
 * skips or duplicates rows when the mailbox changes mid-scroll, whereas the
 * nextLink is a stable continuation token.
 */
export async function listMessages(userId, {
  folderId = 'inbox',
  top = 25,
  cursor = null,
  fromAddress = null,
  hasAttachments = null,
  sinceDays = null
} = {}) {
  if (cursor) {
    const page = await graphFetch(userId, cursor);
    return { messages: page.value || [], nextCursor: page['@odata.nextLink'] || null };
  }

  const filters = [];
  if (fromAddress) filters.push(`from/emailAddress/address eq ${odataQuote(fromAddress.toLowerCase())}`);
  if (hasAttachments === true) filters.push('hasAttachments eq true');
  if (sinceDays) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    filters.push(`receivedDateTime ge ${since}`);
  }

  const path = folderId ? `/me/mailFolders/${encodeURIComponent(folderId)}/messages` : '/me/messages';
  const page = await graphFetch(userId, path, {
    query: {
      $select: LIST_SELECT,
      // Exchange rejects a restriction on the nested from/emailAddress/address
      // together with a sort ("the restriction or sort order is too complex for
      // this operation"), so a from-filtered browse gives up date ordering.
      // Callers that want both send the sender through search (KQL from:) instead.
      ...(fromAddress ? {} : { $orderby: 'receivedDateTime desc' }),
      $top: Math.min(Number(top) || 25, 50),
      ...(filters.length ? { $filter: filters.join(' and ') } : {})
    }
  });

  return { messages: page.value || [], nextCursor: page['@odata.nextLink'] || null };
}

/**
 * Search mode. Graph's $search on messages has three limitations that shape the
 * UI, so they are enforced here rather than discovered later:
 *   - it cannot be combined with $filter (400),
 *   - $orderby is not allowed with it, so results come back by RELEVANCE,
 *   - $skip is ignored; paging is nextLink only.
 * Hence every filter — sender, attachments, date range — is folded into the KQL
 * string instead, where Exchange evaluates them as part of the search. The
 * folder still scopes the request through the path.
 */
export async function searchMessages(userId, {
  query,
  folderId = null,
  top = 25,
  cursor = null,
  fromAddress = null,
  hasAttachments = null,
  sinceDays = null
} = {}) {
  if (cursor) {
    const page = await graphFetch(userId, cursor);
    return { messages: page.value || [], nextCursor: page['@odata.nextLink'] || null };
  }

  const terms = [];
  if (query) terms.push(String(query).trim());
  // KQL from: matches the display name as well as the address, which is what
  // people actually type ("jacques"). The OData equivalent needs the exact
  // address — and Exchange refuses to sort alongside it.
  if (fromAddress) terms.push(`from:${fromAddress}`);
  if (hasAttachments === true) terms.push('hasAttachment:true');
  if (sinceDays) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    terms.push(`received>=${since.toISOString().slice(0, 10)}`);
  }

  // The whole KQL expression is one double-quoted literal; escape embedded quotes.
  const kql = terms.join(' ').replace(/"/g, '\\"');

  const path = folderId ? `/me/mailFolders/${encodeURIComponent(folderId)}/messages` : '/me/messages';
  const page = await graphFetch(userId, path, {
    query: {
      $search: `"${kql}"`,
      $select: LIST_SELECT,
      $top: Math.min(Number(top) || 25, 50)
    }
  });

  return { messages: page.value || [], nextCursor: page['@odata.nextLink'] || null };
}

export async function getMessage(userId, messageId, { select } = {}) {
  return graphFetch(userId, `/me/messages/${encodeURIComponent(messageId)}`, {
    query: select ? { $select: select } : undefined
  });
}

/**
 * The headline capability: /$value returns the message as RFC-822 MIME, which
 * is byte-for-byte a .eml. Anything ingested this way is therefore parseable by
 * the existing mailparser path and previewable in TracePreview — unlike a .msg,
 * which the app can only offer as a download.
 */
export async function getMessageMime(userId, messageId, { maxBytes } = {}) {
  return graphFetch(userId, `/me/messages/${encodeURIComponent(messageId)}/$value`, {
    raw: true,
    maxBytes
  });
}

/* ------------------------------------------------------------------ *
 * Sending
 *
 * Deliberately draft-then-send rather than POST /me/sendMail: sendMail
 * answers 202 with an empty body, so it yields no message id, no
 * internetMessageId and no conversationId. Without those we can neither
 * auto-file the sent mail as the order_to_bank trace nor match the bank's
 * reply later. Creating a draft first is what makes both possible, and is
 * why the app asks for Mail.ReadWrite rather than just Mail.Read.
 * ------------------------------------------------------------------ */

// A single POST /me/messages caps out around 4MB of request body. Anything
// bigger has to go through an upload session, chunked.
export const INLINE_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
// Upload-session chunks must be a multiple of 320 KiB and stay under 4MB.
const UPLOAD_CHUNK_BYTES = 320 * 1024 * 10;

export async function createDraft(userId, message) {
  return graphFetch(userId, '/me/messages', { method: 'POST', body: message });
}

/**
 * Attach a file too large to inline, via an upload session.
 *
 * The session's uploadUrl points at a storage endpoint, not graph.microsoft.com,
 * and is itself the credential — it must be called WITHOUT the bearer token.
 * That is also why it bypasses graphFetch, whose origin pin would reject it.
 */
export async function addLargeAttachment(userId, messageId, { name, contentType, contentBytes }) {
  const buffer = Buffer.from(contentBytes, 'base64');
  const size = buffer.length;

  const session = await graphFetch(userId, `/me/messages/${encodeURIComponent(messageId)}/attachments/createUploadSession`, {
    method: 'POST',
    body: {
      AttachmentItem: {
        attachmentType: 'file',
        name,
        size,
        contentType: contentType || 'application/octet-stream'
      }
    }
  });

  const uploadUrl = session?.uploadUrl;
  if (!uploadUrl) throw new Meteor.Error('msgraph-upload-failed', 'Outlook did not return an upload URL for the attachment.');

  for (let start = 0; start < size; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, size) - 1;
    const chunk = buffer.subarray(start, end + 1);

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${start}-${end}/${size}`
      },
      body: chunk
    });

    // 200/201 close the session, 202 asks for the next chunk.
    if (![200, 201, 202].includes(response.status)) {
      throw new Meteor.Error('msgraph-upload-failed',
        `Attachment upload failed at bytes ${start}-${end} (HTTP ${response.status}).`);
    }
  }
}

export async function sendDraft(userId, messageId) {
  return graphFetch(userId, `/me/messages/${encodeURIComponent(messageId)}/send`, { method: 'POST' });
}

/**
 * Locate the sent copy of a message.
 *
 * Sending invalidates the draft id — the message moves to Sent Items under a
 * NEW id — so the draft id cannot be used to fetch it back. internetMessageId
 * is the one handle stable across that move. Exchange also takes a moment to
 * materialise the copy, hence the caller's retries.
 */
/**
 * Every message in a conversation, for matching a bank's reply back to an order.
 *
 * Two Graph quirks are handled here rather than at the call site:
 *  - conversationId is MAILBOX-scoped, so this only ever makes sense against the
 *    mailbox that sent the original; the bank's own id for the thread differs.
 *  - $filter on conversationId combined with $orderby receivedDateTime can be
 *    rejected as an inefficient filter, so sorting happens in Node.
 *
 * internetMessageHeaders is returned ONLY when explicitly selected, and it is
 * what carries In-Reply-To / References — the fallback that survives a subject
 * rewrite, which is exactly when conversationId stops matching.
 */
export async function getMessagesByConversationId(userId, conversationId, { sinceIso } = {}) {
  const filters = [`conversationId eq ${odataQuote(conversationId)}`];
  if (sinceIso) filters.push(`receivedDateTime ge ${sinceIso}`);

  const page = await graphFetch(userId, '/me/messages', {
    query: {
      $filter: filters.join(' and '),
      $select: 'id,subject,from,receivedDateTime,hasAttachments,bodyPreview,conversationId,internetMessageId,internetMessageHeaders',
      $top: 50
    }
  });

  return (page.value || []).sort(
    (a, b) => new Date(a.receivedDateTime || 0) - new Date(b.receivedDateTime || 0)
  );
}

export async function findSentByInternetMessageId(userId, internetMessageId) {
  const page = await graphFetch(userId, '/me/mailFolders/sentitems/messages', {
    query: {
      $filter: `internetMessageId eq ${odataQuote(internetMessageId)}`,
      $select: 'id,subject,internetMessageId,conversationId,sentDateTime',
      $top: 1
    }
  });
  return (page.value || [])[0] || null;
}
