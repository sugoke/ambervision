import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check, Match } from 'meteor/check';
import { HTTP } from 'meteor/http';

import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';

/**
 * Client Meeting Reports — "Rapport de Visite Client"
 *
 * Lets RMs (and admins/compliance) capture meeting notes, have Claude rewrite
 * them into the three-section French/English compliance template, store the
 * result, and download a PDF.
 */

export const MeetingReportsCollection = new Mongo.Collection('meetingReports');

export const MEETING_TYPES = {
  IN_PERSON: 'in_person',
  CALL: 'call'
};

export const SATISFACTION_LEVELS = {
  VERY_SATISFIED: 'very_satisfied',
  SATISFIED: 'satisfied',
  MODERATELY_SATISFIED: 'moderately_satisfied',
  DISSATISFIED: 'dissatisfied'
};

export const REPORT_STATUS = {
  DRAFT: 'draft',
  FINALIZED: 'finalized',
  DELETED: 'deleted'
};

const ALLOWED_AUTHOR_ROLES = [
  USER_ROLES.RELATIONSHIP_MANAGER,
  USER_ROLES.ASSISTANT,
  USER_ROLES.ADMIN,
  USER_ROLES.SUPERADMIN,
  USER_ROLES.COMPLIANCE
];
const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COMPLIANCE];

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

if (Meteor.isServer) {
  Meteor.startup(() => {
    MeetingReportsCollection.createIndex({ managerUserId: 1, createdAt: -1 });
    MeetingReportsCollection.createIndex({ entityId: 1, meetingDate: -1 });
    MeetingReportsCollection.createIndex({ status: 1, createdAt: -1 });
  });
}

// ---------- Authorization helpers --------------------------------------------------

async function resolveActiveUser(sessionId) {
  const session = await SessionHelpers.validateSession(sessionId);
  if (!session) throw new Meteor.Error('not-authorized', 'Invalid or expired session');
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) throw new Meteor.Error('not-authorized', 'User not found');
  return user;
}

function ensureAuthor(user) {
  if (!ALLOWED_AUTHOR_ROLES.includes(user.role)) {
    throw new Meteor.Error('not-authorized', 'Your role cannot create meeting reports');
  }
}

function isAdmin(user) {
  return ADMIN_ROLES.includes(user.role);
}

/**
 * Compute the set of entityIds and bankAccountIds the user has access to.
 * Mirrors the scoping rules used by viewAs.search:
 *   - Entities directly assigned to the user (or their effective RM IDs)
 *   - Bank accounts where the user is a backup RM (and their owning entities)
 */
async function getUserScope(user) {
  const rmIds = UserHelpers.getEffectiveRmIds(user);
  if (!rmIds.length) return { entityIds: [], bankAccountIds: [] };

  const directEntities = await ClientEntitiesCollection.find(
    {
      isActive: true,
      $or: [
        { assignedUserIds: { $in: rmIds } },
        { relationshipManagerId: { $in: rmIds } }
      ]
    },
    { fields: { _id: 1 } }
  ).fetchAsync();

  const backupAccounts = await BankAccountsCollection.find(
    { backupRmIds: { $in: rmIds }, isActive: true },
    { fields: { _id: 1, entityId: 1 } }
  ).fetchAsync();

  const entityIds = [...new Set([
    ...directEntities.map(e => e._id),
    ...backupAccounts.map(a => a.entityId).filter(Boolean)
  ])];
  const bankAccountIds = backupAccounts.map(a => a._id);

  return { entityIds, bankAccountIds };
}

async function ensureCanReadReport(user, report) {
  if (!report) throw new Meteor.Error('not-found', 'Meeting report not found');
  if (isAdmin(user)) return;
  const { entityIds, bankAccountIds } = await getUserScope(user);
  const linkedToScope =
    (report.entityId && entityIds.includes(report.entityId)) ||
    (report.bankAccountId && bankAccountIds.includes(report.bankAccountId));
  if (!linkedToScope) {
    throw new Meteor.Error('not-authorized', 'You do not have access to this report');
  }
}

async function ensureCanWriteReport(user, report) {
  await ensureCanReadReport(user, report);
  if (report.status === REPORT_STATUS.FINALIZED && !isAdmin(user)) {
    throw new Meteor.Error('locked', 'Finalized reports can only be edited by an admin');
  }
}

function formatUserName(u) {
  if (!u) return '';
  return [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(' ').trim()
    || u.username || u.email || 'Unknown';
}

/**
 * Resolve the relationship manager that should appear as "manager" on the
 * report PDF for the given entity. Prefers the entity's first assigned user
 * with role RM (or superadmin), with a fallback to whichever assigned user is
 * resolvable. Returns null if no entity or nobody is assigned.
 */
async function resolveEntityRm(entityId) {
  if (!entityId) return null;
  const entity = await ClientEntitiesCollection.findOneAsync(entityId);
  if (!entity) return null;
  const candidateIds = (entity.assignedUserIds && entity.assignedUserIds.length > 0)
    ? entity.assignedUserIds
    : (entity.relationshipManagerId ? [entity.relationshipManagerId] : []);
  if (candidateIds.length === 0) return null;
  const candidateUsers = await UsersCollection.find({ _id: { $in: candidateIds } }).fetchAsync();
  return candidateUsers.find(u =>
      u.role === USER_ROLES.RELATIONSHIP_MANAGER || u.role === USER_ROLES.SUPERADMIN
    )
    || candidateUsers[0]
    || null;
}

// ---------- Anthropic rewrite ------------------------------------------------------

const SYSTEM_PROMPT = `You are a wealth-management assistant turning a relationship manager's raw meeting notes into a polished, substantive client-visit report ("Rapport de Visite Client"). The output goes into a compliance file — it must read as a professional, well-reasoned account of the meeting, not a one-line summary.

CRITICAL RULES:
1. Reply in the SAME LANGUAGE as the raw notes. Auto-detect (usually French, sometimes English). Do not translate.
2. Output JSON only — no markdown, no commentary, no code fence. The response MUST start with { and end with }.
3. Tone: professional, factual, third-person, past tense ("Le client a indiqué…", "The client mentioned…"). No filler, no marketing language, no disclaimers.

SECTION ROLES — each section has a DISTINCT job. Do not blur them.
4. **object** = the factual narrative of the meeting itself. Who/where/when (if mentioned), what was reviewed, what decisions or statements the client made, the client's stated intentions, and any operational facts the client communicated (incoming flows, account moves, life events). Keep it grounded in what actually happened in the meeting. NO market data, NO price levels, NO macro commentary, NO third-party forecasts here. Roughly 4–7 sentences.
5. **proposition** = the investment angle and ALL the market/macro context. Either: (a) the idea proposed by the RM and the client's response, or (b) — if the client took a self-directed decision (e.g. "the client decided to invest in gold") — the analysis of *why that decision is consistent (or not) with current market conditions*. This is the ONLY section that should contain price levels, recent moves with figures, central-bank flows, valuation, drivers, and forward-looking views. End with concrete next steps. Roughly 5–9 sentences.
6. ZERO REPETITION between object and proposition. If a fact appears in object, it must NOT reappear in proposition, and vice-versa. Operational facts (e.g. "the client mentioned an upcoming €2M inflow") belong in object only — proposition can refer to it briefly if it changes the recommendation, but does not restate the fact.
7. **complaint** = concrete grievances raised by the client. If none, output exactly 'Néant' (FR) or 'None' (EN). Never pad.

ENRICHMENT (proposition section only):
8. Use the web_search tool when the notes mention specific assets (e.g. "or", "gold", "Microsoft", "EUR/USD"), themes (e.g. "AI", "energy transition", "rate cuts"), or recent events. Search for current price levels, recent macro data, central-bank moves, or company-specific news. Use up to a few searches as needed. Reference the takeaway concisely inside the prose (e.g. "l'or a progressé d'environ 18 % depuis le début de l'année, soutenu par les achats des banques centrales et la baisse anticipée des taux"). Do not output URL lists or footnotes — weave it into the sentence. Strip any HTML / citation tags before returning.

WHAT YOU MUST NEVER DO:
9. Never invent what the client said, did, decided, asked or felt. Only the RM's notes are authoritative for that. If the notes are silent on a point, leave it out.
10. Never invent personal data, account moves, transaction amounts or product names that aren't in the notes.
11. Keep all names, ISINs, account numbers, currency amounts, dates and explicit percentages from the input verbatim.
12. Don't manufacture a complaint or a satisfaction signal.

Output schema (JSON, clean values only):
{
  "language": "fr" | "en" | "<other-iso-639-1>",
  "object": "<Factual meeting narrative — see rule 4. NO market data here.>",
  "proposition": "<Investment angle + all market/macro context — see rule 5. Or 'Néant'/'None' if nothing relevant.>",
  "complaint": "<Concrete complaint or 'Néant'/'None'.>"
}`;

export const MeetingReportHelpers = {
  /**
   * Call Claude to turn raw notes into structured sections.
   * Returns { language, object, proposition, complaint }.
   */
  async rewriteNotes({ rawNotes, clientNameSnapshot, meetingDate, meetingType, location }) {
    const apiKey = Meteor.settings.private?.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Meteor.Error('anthropic-config-error', 'ANTHROPIC_API_KEY not configured');
    if (!rawNotes || !rawNotes.trim()) throw new Meteor.Error('invalid-input', 'rawNotes required');

    const userMessage = [
      `Client: ${clientNameSnapshot || 'Unknown'}`,
      meetingDate ? `Date: ${meetingDate}` : null,
      meetingType ? `Type: ${meetingType === MEETING_TYPES.CALL ? 'Call' : 'In-person meeting'}` : null,
      location ? `Lieu / Location: ${location}` : null,
      '',
      'Raw notes:',
      rawNotes
    ].filter(Boolean).join('\n');

    let response;
    try {
      response = await HTTP.post(ANTHROPIC_API_URL, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'web-search-2025-03-05',
          'content-type': 'application/json'
        },
        data: {
          model: ANTHROPIC_MODEL,
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
          tools: [{
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 4
          }]
        },
        timeout: 180000 // 3 min — web search adds latency
      });
    } catch (err) {
      const status = err.response?.statusCode;
      const message = err.response?.data?.error?.message || err.message || 'Unknown error';
      if (status === 401) throw new Meteor.Error('anthropic-auth-failed', 'Invalid Anthropic API key');
      if (status === 429) throw new Meteor.Error('anthropic-rate-limit', 'Anthropic API rate limit. Try again shortly.');
      throw new Meteor.Error('anthropic-call-failed', `Anthropic call failed: ${message}`);
    }

    // Web-search responses can contain multiple text blocks plus tool_use /
    // server_tool_use / web_search_tool_result blocks. We want the prose-text
    // blocks only, joined.
    let text = (response.data?.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    if (!text) throw new Meteor.Error('anthropic-empty-response', 'Empty response from Anthropic');

    // Strip a code fence if the model returns one despite instructions.
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    // The web_search tool injects <cite index="...">…</cite> around quoted
    // facts. Remove them before JSON parsing — leaving them produces clean
    // prose for the user.
    text = text.replace(/<cite[^>]*>/gi, '').replace(/<\/cite>/gi, '');

    // If the model wrapped the JSON in any prose, slice from the first { to
    // the matching last }.
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace > 0 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.error('[MeetingReports] Failed to parse JSON:', text.slice(0, 400));
      throw new Meteor.Error('anthropic-bad-json', 'Could not parse rewrite response as JSON');
    }

    const stripCites = (s) => String(s || '')
      .replace(/<cite[^>]*>/gi, '')
      .replace(/<\/cite>/gi, '')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .trim();

    return {
      language: typeof parsed.language === 'string' ? parsed.language.toLowerCase() : 'fr',
      object: stripCites(parsed.object),
      proposition: stripCites(parsed.proposition),
      complaint: stripCites(parsed.complaint)
    };
  },

  /**
   * Filter visible reports for a user. Admins see everything; everyone else
   * sees reports linked to entities/bank accounts within their scope (i.e.
   * accounts they manage directly or as backup RM).
   */
  async buildVisibilityFilter(user) {
    if (isAdmin(user)) return {};
    const { entityIds, bankAccountIds } = await getUserScope(user);
    if (!entityIds.length && !bankAccountIds.length) {
      // No accessible accounts → match nothing.
      return { _id: { $in: [] } };
    }
    return {
      $or: [
        { entityId: { $in: entityIds } },
        { bankAccountId: { $in: bankAccountIds } }
      ]
    };
  }
};

// ---------- Methods ----------------------------------------------------------------

if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Run the AI rewrite without persisting anything. Returns the four fields
     * { language, object, proposition, complaint } that the UI then shows in
     * editable text areas.
     */
    async 'meetingReports.rewrite'(sessionId, params) {
      check(sessionId, String);
      check(params, {
        rawNotes: String,
        clientNameSnapshot: Match.Maybe(String),
        meetingDate: Match.Maybe(String),
        meetingType: Match.Maybe(String),
        location: Match.Maybe(String)
      });
      const user = await resolveActiveUser(sessionId);
      ensureAuthor(user);
      return await MeetingReportHelpers.rewriteNotes(params);
    },

    /**
     * Insert a new report or update an existing draft. Pass `meetingReportId`
     * to update; omit to insert. Snapshots are captured on save so renames
     * downstream don't change historical reports.
     */
    async 'meetingReports.saveDraft'(sessionId, params) {
      check(sessionId, String);
      check(params, {
        meetingReportId: Match.Maybe(String),
        entityId: Match.Maybe(String),
        bankAccountId: Match.Maybe(String),
        clientNameSnapshot: String,
        accountNumberSnapshot: Match.Maybe(String),
        bankNameSnapshot: Match.Maybe(String),
        meetingType: String,
        meetingDate: String,                    // ISO date (YYYY-MM-DD)
        location: Match.Maybe(String),
        language: Match.Maybe(String),
        rawNotes: String,
        sections: {
          object: String,
          proposition: String,
          complaint: String
        },
        satisfaction: Match.Maybe(String)
      });

      const user = await resolveActiveUser(sessionId);
      ensureAuthor(user);

      if (!Object.values(MEETING_TYPES).includes(params.meetingType)) {
        throw new Meteor.Error('invalid-input', 'Invalid meeting type');
      }
      if (params.satisfaction && !Object.values(SATISFACTION_LEVELS).includes(params.satisfaction)) {
        throw new Meteor.Error('invalid-input', 'Invalid satisfaction level');
      }

      // The "manager" on the PDF is the entity's relationship manager — not
      // the user clicking save (who may be an assistant). Fall back to the
      // current user only when no entity/RM can be resolved.
      const rmUser = await resolveEntityRm(params.entityId);
      const managerUser = rmUser || user;
      const managerName = formatUserName(managerUser);

      // Resolve the authoritative bank/account/entity snapshots from IDs,
      // ignoring whatever the client guessed. This keeps the audit trail
      // accurate even if the client UI displays fuzzy labels.
      let resolvedAccountNumber = params.accountNumberSnapshot || null;
      let resolvedBankName = params.bankNameSnapshot || null;
      let resolvedClientName = params.clientNameSnapshot;

      if (params.bankAccountId) {
        const account = await BankAccountsCollection.findOneAsync(params.bankAccountId);
        if (account) {
          resolvedAccountNumber = account.accountNumber || resolvedAccountNumber;
          if (account.bankId) {
            const bank = await BanksCollection.findOneAsync(account.bankId);
            if (bank) resolvedBankName = bank.name || resolvedBankName;
          }
        }
      }
      if (params.entityId) {
        const entity = await ClientEntitiesCollection.findOneAsync(params.entityId);
        if (entity) {
          const display = ClientEntityHelpers?.getEntityDisplayName?.(entity);
          if (display) resolvedClientName = display;
        }
      }

      const baseFields = {
        entityId: params.entityId || null,
        bankAccountId: params.bankAccountId || null,
        clientNameSnapshot: resolvedClientName,
        accountNumberSnapshot: resolvedAccountNumber,
        bankNameSnapshot: resolvedBankName,
        managerUserId: managerUser._id,
        managerNameSnapshot: managerName,
        meetingType: params.meetingType,
        meetingDate: new Date(params.meetingDate),
        location: params.location || '',
        language: params.language || 'fr',
        rawNotes: params.rawNotes,
        sections: {
          object: params.sections.object,
          proposition: params.sections.proposition,
          complaint: params.sections.complaint
        },
        satisfaction: params.satisfaction || null,
        updatedAt: new Date(),
        updatedBy: user._id
      };

      if (params.meetingReportId) {
        const existing = await MeetingReportsCollection.findOneAsync(params.meetingReportId);
        await ensureCanWriteReport(user, existing);
        await MeetingReportsCollection.updateAsync(params.meetingReportId, { $set: baseFields });
        return { _id: params.meetingReportId };
      }

      const insertDoc = {
        ...baseFields,
        status: REPORT_STATUS.DRAFT,
        pdfPath: null,
        pdfGeneratedAt: null,
        createdAt: new Date(),
        createdBy: user._id
      };
      const _id = await MeetingReportsCollection.insertAsync(insertDoc);
      return { _id };
    },

    /**
     * Mark a report as finalized and (re)generate its PDF.
     */
    async 'meetingReports.finalize'(sessionId, meetingReportId) {
      check(sessionId, String);
      check(meetingReportId, String);
      const user = await resolveActiveUser(sessionId);
      ensureAuthor(user);

      const report = await MeetingReportsCollection.findOneAsync(meetingReportId);
      await ensureCanWriteReport(user, report);

      await MeetingReportsCollection.updateAsync(meetingReportId, {
        $set: { status: REPORT_STATUS.FINALIZED, updatedAt: new Date(), updatedBy: user._id }
      });

      // Generate the PDF inline so the UI can download it immediately.
      const { generateMeetingReportPdf } = await import('/server/helpers/meetingReportPdfHelper');
      const fresh = await MeetingReportsCollection.findOneAsync(meetingReportId);
      const result = await generateMeetingReportPdf(fresh);

      await MeetingReportsCollection.updateAsync(meetingReportId, {
        $set: { pdfPath: result.relativeUrl, pdfGeneratedAt: new Date() }
      });
      return { _id: meetingReportId, url: result.relativeUrl };
    },

    /**
     * Generate (or regenerate) the PDF without changing status. Useful for
     * downloading a draft.
     */
    async 'meetingReports.generatePdf'(sessionId, meetingReportId) {
      check(sessionId, String);
      check(meetingReportId, String);
      const user = await resolveActiveUser(sessionId);
      const report = await MeetingReportsCollection.findOneAsync(meetingReportId);
      await ensureCanReadReport(user, report);

      const { generateMeetingReportPdf } = await import('/server/helpers/meetingReportPdfHelper');
      const result = await generateMeetingReportPdf(report);
      await MeetingReportsCollection.updateAsync(meetingReportId, {
        $set: { pdfPath: result.relativeUrl, pdfGeneratedAt: new Date() }
      });
      return { _id: meetingReportId, url: result.relativeUrl };
    },

    /**
     * Soft-delete: marks status='deleted'. Authors can delete their own drafts;
     * admins can delete anything.
     */
    async 'meetingReports.delete'(sessionId, meetingReportId) {
      check(sessionId, String);
      check(meetingReportId, String);
      const user = await resolveActiveUser(sessionId);
      const report = await MeetingReportsCollection.findOneAsync(meetingReportId);
      await ensureCanReadReport(user, report);
      if (!isAdmin(user) && report.status === REPORT_STATUS.FINALIZED) {
        throw new Meteor.Error('locked', 'Finalized reports can only be deleted by an admin');
      }
      await MeetingReportsCollection.updateAsync(meetingReportId, {
        $set: { status: REPORT_STATUS.DELETED, updatedAt: new Date(), updatedBy: user._id }
      });
      return { success: true };
    },

    async 'meetingReports.get'(sessionId, meetingReportId) {
      check(sessionId, String);
      check(meetingReportId, String);
      const user = await resolveActiveUser(sessionId);
      const report = await MeetingReportsCollection.findOneAsync(meetingReportId);
      await ensureCanReadReport(user, report);
      return report;
    }
  });
}
