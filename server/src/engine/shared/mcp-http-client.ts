import { McpBaseClient } from './mcp-base-client.js';
import { McpSseParser } from './mcp-sse-parser.js';
import type { JsonRpcRequest, JsonRpcResponse, McpRemoteConfig } from './mcp-types.js';

const PROTOCOL_VERSION = '2024-11-05';

function parseRpc(value: unknown): JsonRpcResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP JSON-RPC 响应无效');
  return value as JsonRpcResponse;
}

export class McpHttpClient extends McpBaseClient {
  private nextId = 1;
  private sessionId = '';

  constructor(private readonly config: McpRemoteConfig) { super(); }
  get name(): string { return this.config.name; }

  protected async openTransport(): Promise<void> {}

  protected closeTransport(): void {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = '';
    void fetch(this.config.url, { method: 'DELETE', headers: this.headers(sessionId) }).catch(() => undefined);
  }

  protected async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: '2.0', id, method, params });
    const rpc = await this.readResponse(response, id);
    if (rpc.error) throw new Error(`MCP error [${rpc.error.code}]: ${rpc.error.message}`);
    return rpc.result;
  }

  protected async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const response = await this.post({ jsonrpc: '2.0', method, params });
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
  }

  private headers(sessionId = this.sessionId): Record<string, string> {
    return {
      ...this.config.headers,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
    };
  }

  private async post(message: JsonRpcRequest): Promise<Response> {
    const response = await fetch(this.config.url, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(message),
    });
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) this.sessionId = sessionId;
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
    return response;
  }

  private async readResponse(response: Response, id: number): Promise<JsonRpcResponse> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return parseRpc(await response.json());
    if (!contentType.includes('text/event-stream')) throw new Error(`MCP HTTP 返回了不支持的 Content-Type：${contentType || '空'}`);
    return this.readSseResponse(response, id);
  }

  private async readSseResponse(response: Response, id: number): Promise<JsonRpcResponse> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('MCP HTTP SSE 响应缺少 body');
    const decoder = new TextDecoder();
    let matched: JsonRpcResponse | undefined;
    const parser = new McpSseParser(event => {
      if (event.event !== 'message') return;
      const rpc = parseRpc(JSON.parse(event.data));
      if (rpc.id === id) matched = rpc;
    });
    while (!matched) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    if (!matched) throw new Error(`MCP HTTP SSE 未返回请求 ${id} 的结果`);
    await reader.cancel().catch(() => undefined);
    return matched;
  }
}
