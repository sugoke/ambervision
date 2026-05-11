/**
 * MCP server factory — builds a per-request McpServer instance bound to the
 * authenticated user. Each HTTP request gets its own instance so tool
 * handlers have a stable `user` closure for scope resolution.
 */

import { McpServer } from '@modelcontextprotocol/sdk/dist/cjs/server/mcp.js';
import { registerTools } from './tools.js';

const ROOT_URL = (process.env.ROOT_URL || 'http://localhost:3000').replace(/\/+$/, '');

const SERVER_INFO = {
  name: 'ambervision',
  version: '1.0.0',
  title: 'Ambervision Portfolio MCP',
  websiteUrl: ROOT_URL,
  description: 'Read-only access to your Ambervision portfolio — holdings, cash, orders, structured products, and upcoming product events.',
  icons: [
    { src: `${ROOT_URL}/iconreso.png`, mimeType: 'image/png' }
  ]
};

export function buildMcpServer(user) {
  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      tools: {}
    },
    instructions: [
      'Ambervision is a structured-products portfolio platform.',
      'Use these tools to answer questions about the user\'s portfolio, holdings,',
      'cash balance, orders, and structured products.',
      'All tools are scoped to the authenticated user — results will only contain',
      'data the user is allowed to see in the web app.'
    ].join(' ')
  });
  registerTools(server, user);
  return server;
}
