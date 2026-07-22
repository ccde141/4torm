import { McpBaseClient } from './mcp-base-client.js';
import { McpSseParser, type McpSseEvent } from './mcp-sse-parser.js';
import type { JsonRpcRequest, JsonRpcResponse, McpRemoteConfig } from './mcp-types.js';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class McpSseClient extends McpBaseClient {
  private nextId = 1;
  private endpoint = '';
  private controller: AbortController | null = null;
  private pending = new Map<number, PendingRequest>();
  private endpointReady: ((value: string) => void) | null = null;

  constructor(private readonly config: McpRemoteConfig) { super(); }
  get name(): string { return this.config.name; }

  protected async openTransport(): Promise<void> {
    this.controller = new AbortController();
    const response = await fetch(this.config.url, {
      headers: { ...this.config.headers, Accept: 'text/event-stream' },
      signal: this.controller.signal,
    });
    if (!response.ok) throw new Error(`MCP SSE ${response.status}: ${await response.text()}`);
    if (!response.body) throw new Error('MCP SSE 响应缺少 body');
    const ready = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP SSE 未返回 endpoint 事件')), 30_000);
      this.endpointReady = value => {
        clearTimeout(timer);
        resolve(value);
      };
    });
    void this.consume(response).catch(error => this.onStreamError(error));
    this.endpoint = await ready;
    this.endpointReady = null;
  }

  protected closeTransport(): void {
    this.controller?.abort();
    this.controller = null;
    this.endpoint = '';
    this.rejectAll(new Error('MCP client disconnected'));
  }

  protected request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method} (id=${id})`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      void this.post({ jsonrpc: '2.0', id, method, params }).catch(error => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      });
    });
  }

  protected async notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.post({ jsonrpc: '2.0', method, params });
  }

  private async post(message: JsonRpcRequest): Promise<void> {
    if (!this.endpoint) throw new Error('MCP SSE endpoint 尚未就绪');
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { ...this.config.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error(`MCP SSE POST ${response.status}: ${await response.text()}`);
  }

  private async consume(response: Response): Promise<void> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const parser = new McpSseParser(event => this.handleEvent(event));
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    if (!this.intentional) this.transportClosed();
  }

  private handleEvent(event: McpSseEvent): void {
    if (event.event === 'endpoint') {
      const endpoint = new URL(event.data, this.config.url).toString();
      this.endpointReady?.(endpoint);
      return;
    }
    if (event.event !== 'message') return;
    const message = JSON.parse(event.data) as JsonRpcResponse;
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(`MCP error [${message.error.code}]: ${message.error.message}`));
    else pending.resolve(message.result);
  }

  private onStreamError(error: unknown): void {
    if (this.intentional || (error as Error).name === 'AbortError') return;
    this.rejectAll(error as Error);
    this.transportClosed();
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
