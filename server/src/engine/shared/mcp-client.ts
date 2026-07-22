import { McpHttpClient } from './mcp-http-client.js';
import { McpSseClient } from './mcp-sse-client.js';
import { McpStdioClient } from './mcp-stdio-client.js';
import type { McpClient, McpServerConfig } from './mcp-types.js';

export type { McpClient, McpServerConfig, McpToolDef } from './mcp-types.js';
export { McpStdioClient } from './mcp-stdio-client.js';

export function createMcpClient(config: McpServerConfig): McpClient {
  if (config.transport === 'stdio') return new McpStdioClient(config);
  if (config.transport === 'streamable-http') return new McpHttpClient(config);
  return new McpSseClient(config);
}
