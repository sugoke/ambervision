/**
 * Amber → MCP tool adapter (server-only).
 *
 * Exposes the same tool surface the MCP server exposes to external clients,
 * but in a form that can be passed directly to Anthropic's Messages API.
 *
 * Why: the chat used to inject a giant `buildUserContext()` JSON blob every
 * turn (products, allocations, prices, holdings, observations, notifications).
 * That bloated the prompt cache and went stale within 5 minutes. Instead we
 * now hand Claude the MCP tools and let it fetch what each question needs.
 *
 * This is in-process — no HTTP, no OAuth — the adapter runs the same handler
 * functions registered in server/mcp/tools.js, bound to the chat user's scope.
 */

import { registerTools } from '/server/mcp/tools.js';

/**
 * Convert a single Zod schema field to a JSON Schema property.
 *
 * The MCP tools use a narrow subset of Zod (string/number/boolean/array/enum,
 * with .optional() and .describe()) so a small hand-rolled walker is enough
 * and avoids a brittle deep require into MCP SDK's vendored zod-to-json-schema.
 */
function zodFieldToJsonSchema(field) {
  let schema = field;
  let optional = false;
  let description;

  while (schema && schema._def) {
    const def = schema._def;
    if (def.description && !description) description = def.description;
    if (def.typeName === 'ZodOptional') { optional = true; schema = def.innerType; continue; }
    if (def.typeName === 'ZodDefault') { schema = def.innerType; continue; }
    if (def.typeName === 'ZodNullable') { schema = def.innerType; continue; }
    break;
  }

  const def = schema && schema._def;
  let json;
  switch (def && def.typeName) {
    case 'ZodString':
      json = { type: 'string' };
      break;
    case 'ZodNumber':
      json = { type: 'number' };
      break;
    case 'ZodBoolean':
      json = { type: 'boolean' };
      break;
    case 'ZodEnum':
      json = { type: 'string', enum: def.values };
      break;
    case 'ZodArray': {
      const inner = zodFieldToJsonSchema(def.type);
      json = { type: 'array', items: inner.schema };
      break;
    }
    default:
      json = { type: 'string' };
  }
  if (description) json.description = description;
  return { schema: json, optional };
}

function zodInputSchemaToJsonSchema(zodInputSchema) {
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(zodInputSchema || {})) {
    const { schema, optional } = zodFieldToJsonSchema(field);
    properties[key] = schema;
    if (!optional) required.push(key);
  }
  const out = { type: 'object', properties };
  if (required.length > 0) out.required = required;
  return out;
}

/**
 * In-process stand-in for the MCP SDK's McpServer — captures every
 * registerTool() call into a flat map so we can re-expose the same handlers
 * to Anthropic's tool-use loop.
 */
function createCollector() {
  const tools = {};
  return {
    tools,
    registerTool(name, { description, inputSchema }, handler) {
      tools[name] = { description, inputSchema, handler };
    }
  };
}

/**
 * Flatten an MCP tool result (`{ content: [{type:'text', text}], isError? }`)
 * to a string the Anthropic API can put in a tool_result block.
 */
function mcpResultToString(result) {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content
    .filter(b => b && b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

/**
 * Build the Anthropic-compatible toolset for a given user.
 *
 * @param {Object} user — full user document (used by resolveMcpScope)
 * @returns {{ anthropicTools: Array, executeTool: (name, input) => Promise<{ result: string, isError: boolean }> }}
 */
export function buildAmberToolset(user) {
  const collector = createCollector();
  registerTools(collector, user);

  const anthropicTools = Object.entries(collector.tools).map(([name, { description, inputSchema }]) => ({
    name,
    description,
    input_schema: zodInputSchemaToJsonSchema(inputSchema)
  }));

  async function executeTool(name, input) {
    const entry = collector.tools[name];
    if (!entry) {
      return { result: JSON.stringify({ error: `Unknown tool: ${name}` }), isError: true };
    }
    try {
      const result = await entry.handler(input || {});
      return {
        result: mcpResultToString(result) || JSON.stringify(result),
        isError: !!result?.isError
      };
    } catch (error) {
      return {
        result: JSON.stringify({ error: error.message || String(error) }),
        isError: true
      };
    }
  }

  return { anthropicTools, executeTool };
}
