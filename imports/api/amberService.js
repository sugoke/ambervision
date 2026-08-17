import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { check, Match } from 'meteor/check';
import { UsersCollection, USER_ROLES } from './users';
import { AmberConversationsCollection } from './amberConversations';
import { ClientEntitiesCollection, ClientEntityHelpers } from './clientEntities';
import { resolveMcpScope } from '/server/mcp/scopeHelper.js';
import { buildAmberToolset } from './amberMcpAdapter.js';

// Anthropic API configuration
const ANTHROPIC_API_KEY = Meteor.settings.private?.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

// Cache duration (5 minutes as per Anthropic docs)
const CACHE_DURATION_MS = 5 * 60 * 1000;

// How many tool-use rounds the model gets per chat turn before we cut it off.
// Higher than the legacy limit because MCP tools chain naturally
// (list_entities → list_accounts → get_account_balance).
const MAX_TOOL_ITERATIONS = 10;

if (Meteor.isServer) {
  /**
   * Amber AI Service
   *
   * Conversations are short-context: the prompt only ships identity + scope
   * summary, and detail data (holdings, products, observations, etc.) is
   * fetched on demand through the MCP tool surface (see amberMcpAdapter.js).
   */
  export const AmberService = {
    /**
     * Identity + scope summary that fits comfortably in a cached system block.
     * No bulk lists — those go through MCP tools.
     */
    async buildUserContext(userId) {
      const user = await UsersCollection.findOneAsync(userId);
      if (!user) {
        throw new Meteor.Error('user-not-found', 'User not found');
      }

      const scope = await resolveMcpScope(user);

      const dataScope = scope.isAdmin
        ? 'admin'
        : user.role === USER_ROLES.RELATIONSHIP_MANAGER || user.role === USER_ROLES.ASSISTANT
          ? 'rm'
          : 'client';

      let entitySummary = null;
      if (!scope.isAdmin && scope.entityIds && scope.entityIds.length > 0) {
        const entities = await ClientEntitiesCollection.find(
          { _id: { $in: scope.entityIds }, isActive: true },
          { fields: { type: 1, profile: 1, referenceCurrency: 1 }, limit: 25 }
        ).fetchAsync();
        entitySummary = entities.map(e => ({
          entityId: e._id,
          name: ClientEntityHelpers.getEntityDisplayName(e),
          type: e.type,
          referenceCurrency: e.referenceCurrency || null
        }));
      }

      return {
        user: {
          role: user.role,
          email: user.email,
          firstName: user.profile?.firstName || '',
          lastName: user.profile?.lastName || '',
          preferredLanguage: user.profile?.preferredLanguage || 'en'
        },
        dataScope,
        scopeSummary: scope.isAdmin
          ? { mode: 'admin', note: 'Sees all entities and accounts' }
          : {
              mode: dataScope,
              entityCount: scope.entityIds?.length || 0,
              accountCount: scope.bankAccounts?.length || 0,
              entities: entitySummary
            },
        timestamp: new Date().toISOString()
      };
    },

    /**
     * Build system prompt for Amber.
     * Stays small + stable so it remains cache-friendly across turns.
     */
    _buildSystemPrompt(contextData) {
      const { user, dataScope, scopeSummary } = contextData;

      const scopeBlock = scopeSummary.mode === 'admin'
        ? 'Admin scope — you can query data across all entities and accounts.'
        : `Scope: ${scopeSummary.entityCount} entity/entities, ${scopeSummary.accountCount} bank account(s).`
          + (scopeSummary.entities?.length
            ? `\nAccessible entities (use entityId to filter tools):\n${
              scopeSummary.entities.map(e => `  - ${e.name} (entityId=${e.entityId}, type=${e.type}, ccy=${e.referenceCurrency || 'n/a'})`).join('\n')
            }`
            : '');

      return `You are Amber, the AI assistant for Ambervision — a structured-products portfolio platform.

**Current user**
- Name: ${user.firstName} ${user.lastName}
- Role: ${user.role}
- Email: ${user.email}
- Preferred language: ${user.preferredLanguage}

**Data scope**
${scopeBlock}

**How to answer**
You do NOT have the user's data preloaded. Use the available tools to fetch what each question needs:
- whoami / list_entities — identity and which entities are accessible
- get_portfolio_summary, get_account_balance, get_cash_balance — high-level balances
- list_holdings, list_orders, list_pending_orders, list_transactions — positions and activity
- search_products, get_product_details — structured-product structure, barriers, observation schedule
- get_upcoming_events — coupon / autocall / maturity dates
- get_portfolio_snapshots, get_performance — historical evolution and returns
- list_alerts — barrier touches, coupon paid, autocalls, overdrafts
- get_underlying_exposure, get_fx_rate — cross-cutting lookups

Prefer the most specific tool for the question. For multi-step questions, chain tool calls
(e.g. list_entities → list_holdings entityId=…).

**Guidelines**
- Be professional, clear, and concise. Explain structured-product mechanics in plain terms when asked.
- Never provide investment advice or recommendations.
- All numbers come from tools — never invent figures or estimate from memory.
- If a tool returns no data, say so plainly; do not fabricate.
- Reference products by ISIN or title.
- Answer in the user's preferred language: ${user.preferredLanguage}.`;
    },

    /**
     * Call Anthropic API with prompt caching and MCP-backed tool support.
     */
    async callAnthropicAPI(contextData, conversationHistory, userMessage, user) {
      if (!ANTHROPIC_API_KEY) {
        throw new Meteor.Error('anthropic-config-error', 'Anthropic API key not configured');
      }

      const systemPrompt = this._buildSystemPrompt(contextData);
      const { anthropicTools, executeTool } = buildAmberToolset(user);

      try {
        console.log(`[Amber] Calling Anthropic API — ${anthropicTools.length} tools available, model=${ANTHROPIC_MODEL}`);

        const messages = [
          ...conversationHistory,
          { role: 'user', content: userMessage }
        ];

        const totalUsage = { input: 0, output: 0, cached: 0, cacheCreation: 0 };

        for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
          const response = await HTTP.post(ANTHROPIC_API_URL, {
            headers: {
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'prompt-caching-2024-07-31',
              'content-type': 'application/json'
            },
            data: {
              model: ANTHROPIC_MODEL,
              max_tokens: 4000,
              tools: anthropicTools,
              system: [
                {
                  type: 'text',
                  text: systemPrompt,
                  cache_control: { type: 'ephemeral' }
                }
              ],
              messages
            }
          });

          const usage = response.data.usage || {};
          totalUsage.input += usage.input_tokens || 0;
          totalUsage.output += usage.output_tokens || 0;
          totalUsage.cached += usage.cache_read_input_tokens || 0;
          totalUsage.cacheCreation += usage.cache_creation_input_tokens || 0;

          console.log(`[Amber] API call ${iteration} — usage:`, {
            input: usage.input_tokens || 0,
            output: usage.output_tokens || 0,
            cached: usage.cache_read_input_tokens || 0,
            stop_reason: response.data.stop_reason
          });

          if (response.data.stop_reason === 'end_turn') {
            const textContent = response.data.content
              .filter(block => block.type === 'text')
              .map(block => block.text)
              .join('\n');
            return { content: textContent, usage: totalUsage };
          }

          if (response.data.stop_reason !== 'tool_use') {
            throw new Error(`Unexpected stop_reason: ${response.data.stop_reason}`);
          }

          messages.push({ role: 'assistant', content: response.data.content });

          const toolResults = [];
          for (const block of response.data.content) {
            if (block.type !== 'tool_use') continue;
            // GDPR: log tool name + argument keys only — values can carry entity ids,
            // account filters and search strings.
            console.log(`[Amber] Tool call: ${block.name} (args: ${Object.keys(block.input || {}).join(', ') || 'none'})`);
            const { result, isError } = await executeTool(block.name, block.input);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
              ...(isError ? { is_error: true } : {})
            });
          }
          messages.push({ role: 'user', content: toolResults });
        }

        throw new Error(`Max tool iterations (${MAX_TOOL_ITERATIONS}) reached`);
      } catch (error) {
        console.error('[Amber] Anthropic API error:', error);

        if (error.response) {
          const status = error.response.statusCode;
          const message = error.response.data?.error?.message || 'Unknown error';

          if (status === 401) {
            throw new Meteor.Error('anthropic-auth-failed', 'Invalid Anthropic API key');
          } else if (status === 429) {
            throw new Meteor.Error('anthropic-rate-limit', 'API rate limit exceeded');
          } else {
            throw new Meteor.Error('anthropic-api-error', `API error: ${message}`);
          }
        }

        throw new Meteor.Error('anthropic-call-failed', `Failed to call API: ${error.message}`);
      }
    },

    /**
     * Process chat message and return response
     */
    async chat(userId, message, sessionId) {
      check(userId, String);
      check(message, String);
      check(sessionId, Match.Maybe(String));

      const user = await UsersCollection.findOneAsync(userId);
      if (!user) {
        throw new Meteor.Error('user-not-found', 'User not found');
      }

      const actualSessionId = sessionId || `amber-${userId}-${Date.now()}`;

      let conversation = await AmberConversationsCollection.findOneAsync({
        sessionId: actualSessionId,
        userId
      });

      const now = new Date();
      let needsContextRefresh = false;

      if (!conversation) {
        conversation = {
          userId,
          sessionId: actualSessionId,
          messages: [],
          contextSummary: {
            dataScope: user.role,
            lastCacheRefresh: null,
            contextTokens: 0
          },
          metadata: {
            userRole: user.role,
            userEmail: user.email,
            userName: `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim()
          },
          status: 'active',
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 30 days
        };
        const conversationId = await AmberConversationsCollection.insertAsync(conversation);
        conversation._id = conversationId;
        needsContextRefresh = true;
      } else if (
        !conversation.contextSummary?.lastCacheRefresh ||
        (now - conversation.contextSummary.lastCacheRefresh) > CACHE_DURATION_MS
      ) {
        needsContextRefresh = true;
      }

      const contextData = await this.buildUserContext(userId);

      const conversationHistory = conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const apiResponse = await this.callAnthropicAPI(
        contextData,
        conversationHistory,
        message,
        user
      );

      const userMessageObj = {
        _id: `msg-${Date.now()}-user`,
        role: 'user',
        content: message,
        timestamp: now,
        tokens: { input: apiResponse.usage.input, output: 0, cached: 0 }
      };

      const assistantMessageObj = {
        _id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: apiResponse.content,
        timestamp: new Date(),
        tokens: { input: 0, output: apiResponse.usage.output, cached: apiResponse.usage.cached }
      };

      await AmberConversationsCollection.updateAsync(conversation._id, {
        $push: {
          messages: { $each: [userMessageObj, assistantMessageObj] }
        },
        $set: {
          updatedAt: new Date(),
          'contextSummary.lastCacheRefresh': needsContextRefresh ? now : conversation.contextSummary.lastCacheRefresh,
          'contextSummary.contextTokens': apiResponse.usage.input + (apiResponse.usage.cacheCreation || 0)
        }
      });

      return {
        sessionId: actualSessionId,
        message: apiResponse.content,
        usage: apiResponse.usage,
        conversationId: conversation._id
      };
    }
  };

  // Meteor methods
  Meteor.methods({
    /**
     * Send a message to Amber and get a response
     */
    async 'amber.chat'(message, conversationId, authSessionId) {
      check(message, String);
      check(conversationId, Match.Maybe(String));
      check(authSessionId, String);

      const { SessionHelpers } = require('./sessions');
      const session = await SessionHelpers.validateSession(authSessionId);
      const userId = session.userId;

      return await AmberService.chat(userId, message, conversationId);
    },

    /**
     * Archive a conversation
     */
    async 'amber.archiveConversation'(conversationId, authSessionId) {
      check(conversationId, String);
      check(authSessionId, String);

      const { SessionHelpers } = require('./sessions');
      const session = await SessionHelpers.validateSession(authSessionId);
      const userId = session.userId;

      return await AmberConversationsCollection.updateAsync(
        { sessionId: conversationId, userId },
        { $set: { status: 'archived', updatedAt: new Date() } }
      );
    },

    /**
     * Get conversation by session ID
     */
    async 'amber.getConversation'(conversationId, authSessionId) {
      check(conversationId, String);
      check(authSessionId, String);

      const { SessionHelpers } = require('./sessions');
      const session = await SessionHelpers.validateSession(authSessionId);
      const userId = session.userId;

      return await AmberConversationsCollection.findOneAsync({
        sessionId: conversationId,
        userId
      });
    }
  });
}
