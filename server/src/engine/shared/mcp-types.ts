export type McpTransport = 'stdio' | 'streamable-http' | 'sse';

interface McpConfigBase {
  name: string;
  enabled: boolean;
  transport: McpTransport;
}

export interface McpStdioConfig extends McpConfigBase {
  transport: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  autoWorkspaces?: boolean;
}

export interface McpRemoteConfig extends McpConfigBase {
  transport: 'streamable-http' | 'sse';
  url: string;
  headers: Record<string, string>;
}

export type McpServerConfig = McpStdioConfig | McpRemoteConfig;

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

export interface McpClient {
  readonly name: string;
  readonly connected: boolean;
  readonly tools: McpToolDef[];
  connect(): Promise<void>;
  refreshTools(): Promise<McpToolDef[]>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<string>;
  disconnect(): void;
  on(event: 'log', listener: (message: string) => void): this;
  on(event: 'disconnected', listener: (info: { code: number | null; intentional: boolean }) => void): this;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
