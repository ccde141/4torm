import { EventEmitter } from 'node:events';
import { formatMcpToolResult } from './mcp-result.js';
import type { McpClient, McpToolDef } from './mcp-types.js';

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`MCP ${label} 返回结构无效`);
  }
  return value as Record<string, unknown>;
}

function toolList(value: unknown): McpToolDef[] {
  const result = recordValue(value, 'tools/list');
  if (!Array.isArray(result.tools)) throw new Error('MCP tools/list 缺少 tools 数组');
  return result.tools.map(item => {
    const tool = recordValue(item, 'tool');
    if (typeof tool.name !== 'string' || !tool.name) throw new Error('MCP tool 缺少 name');
    return {
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      inputSchema: recordValue(tool.inputSchema ?? { type: 'object' }, 'inputSchema'),
    } as McpToolDef;
  });
}

export abstract class McpBaseClient extends EventEmitter implements McpClient {
  protected intentional = false;
  protected _connected = false;
  protected _tools: McpToolDef[] = [];

  abstract get name(): string;
  protected abstract openTransport(): Promise<void>;
  protected abstract closeTransport(): void;
  protected abstract request(method: string, params: Record<string, unknown>): Promise<unknown>;
  protected abstract notify(method: string, params: Record<string, unknown>): Promise<void>;

  get connected(): boolean { return this._connected; }
  get tools(): McpToolDef[] { return this._tools; }

  async connect(): Promise<void> {
    if (this._connected) return;
    this.intentional = false;
    await this.openTransport();
    try {
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: '4torm', version: '1.0.0' },
      });
      await this.notify('notifications/initialized', {});
      this._connected = true;
      await this.refreshTools();
    } catch (error) {
      this.closeTransport();
      this._connected = false;
      throw error;
    }
  }

  async refreshTools(): Promise<McpToolDef[]> {
    this._tools = toolList(await this.request('tools/list', {}));
    return this._tools;
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request('tools/call', { name: toolName, arguments: args });
    return formatMcpToolResult(result);
  }

  disconnect(): void {
    this.intentional = true;
    this.closeTransport();
    this._connected = false;
    this._tools = [];
  }

  protected transportClosed(code: number | null = null): void {
    this._connected = false;
    this._tools = [];
    this.emit('disconnected', { code, intentional: this.intentional });
  }
}
