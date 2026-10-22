import { EventEmitter } from 'node:events';
import { readMcpToolOutcome } from './mcp-result.js';
import type { McpClient, McpToolDef, McpToolOutcome } from './mcp-types.js';

const MAX_TOOL_PAGES = 100;
const MAX_DISCOVERED_TOOLS = 10_000;

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
  protected abstract request(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  protected abstract notify(method: string, params: Record<string, unknown>): Promise<void>;

  get connected(): boolean { return this._connected; }
  get tools(): McpToolDef[] { return this._tools; }

  async connect(): Promise<void> {
    if (this._connected) return;
    this.intentional = false;
    try {
      await this.openTransport();
      if (this.intentional) throw new Error('MCP client disconnected');
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: '4torm', version: '1.0.0' },
      });
      if (this.intentional) throw new Error('MCP client disconnected');
      await this.notify('notifications/initialized', {});
      if (this.intentional) throw new Error('MCP client disconnected');
      await this.refreshTools();
      if (this.intentional) throw new Error('MCP client disconnected');
      this._connected = true;
    } catch (error) {
      this.closeTransport();
      this._connected = false;
      this._tools = [];
      throw error;
    }
  }

  async refreshTools(): Promise<McpToolDef[]> {
    const tools: McpToolDef[] = [];
    const names = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < MAX_TOOL_PAGES; pageIndex++) {
      const page = recordValue(await this.request('tools/list',
        cursor === undefined ? {} : { cursor }), 'tools/list');
      const entries = toolList(page);
      if (tools.length + entries.length > MAX_DISCOVERED_TOOLS) {
        throw new Error(`MCP tools/list 工具数量超过上限 ${MAX_DISCOVERED_TOOLS}`);
      }
      for (const entry of entries) {
        if (names.has(entry.name)) throw new Error(`MCP tools/list 工具名称重复：${entry.name}`);
        names.add(entry.name);
        tools.push(entry);
      }
      if (page.nextCursor === undefined) {
        this._tools = tools;
        return this._tools;
      }
      if (typeof page.nextCursor !== 'string' || !page.nextCursor) {
        throw new Error('MCP tools/list nextCursor 必须是非空字符串');
      }
      if (cursors.has(page.nextCursor)) throw new Error('MCP tools/list 分页 cursor 重复');
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw new Error(`MCP tools/list 分页数量超过上限 ${MAX_TOOL_PAGES}`);
  }

  async callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    return (await this.callToolOutcome(toolName, args, signal)).result;
  }

  async callToolOutcome(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolOutcome> {
    const result = await this.request('tools/call', { name: toolName, arguments: args }, signal);
    return readMcpToolOutcome(result);
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
