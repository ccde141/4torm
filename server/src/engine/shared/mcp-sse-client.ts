import { McpBaseClient } from './mcp-base-client.js';
import { McpSseParser, type McpSseEvent } from './mcp-sse-parser.js';
import type { JsonRpcRequest, JsonRpcResponse, McpRemoteConfig } from './mcp-types.js';
import { createMcpRequestScope, type McpRequestScope } from './mcp-request.js';
import { readMcpRpcResponse } from './mcp-rpc.js';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class McpSseClient extends McpBaseClient {
  private nextId = 1;
  private endpoint = '';
  private controller: AbortController | null = null;
  private pending = new Map<number, PendingRequest>();
  private endpointReady: ((value: string) => void) | null = null;
  private endpointFailed: ((error: Error) => void) | null = null;
  private posts = new Set<McpRequestScope>();

  constructor(private readonly config: McpRemoteConfig) { super(); }
  get name(): string { return this.config.name; }

  protected async openTransport(): Promise<void> {
    this.controller = new AbortController();
    const scope = createMcpRequestScope(this.controller.signal);
    const timeout = () => this.controller?.abort(scope.signal.reason);
    scope.signal.addEventListener('abort', timeout, { once: true });
    try {
      const response = await fetch(this.config.url, {
        headers: { ...this.config.headers, Accept: 'text/event-stream' },
        signal: this.controller.signal,
      });
      if (!response.ok) throw new Error(`MCP SSE ${response.status}: ${await response.text()}`);
      if (!response.body) throw new Error('MCP SSE 响应缺少 body');
      const ready = new Promise<string>((resolve, reject) => {
        this.endpointReady = resolve;
        this.endpointFailed = reject;
      });
      void this.consume(response).catch(error => this.onStreamError(error));
      this.endpoint = await ready;
    } finally {
      scope.signal.removeEventListener('abort', timeout);
      scope.dispose();
      this.endpointReady = null;
      this.endpointFailed = null;
    }
  }

  protected closeTransport(): void {
    this.controller?.abort();
    this.controller = null;
    this.endpointFailed?.(new Error('MCP client disconnected'));
    this.endpoint = '';
    this.rejectAll(new Error('MCP client disconnected'));
    for (const scope of this.posts) scope.cancel();
  }

  protected request(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const scope = createMcpRequestScope(signal);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        scope.signal.removeEventListener('abort', abort);
        scope.dispose();
        scope.cancel();
      };
      const abort = () => {
        this.pending.delete(id);
        cleanup();
        reject(scope.signal.reason);
        if (!this.intentional && this.endpoint) {
          void this.notify('notifications/cancelled', { requestId: id }).catch(() => undefined);
        }
      };
      if (scope.signal.aborted) { cleanup(); reject(scope.signal.reason); return; }
      scope.signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve: value => { cleanup(); resolve(value); },
        reject: error => { cleanup(); reject(error); },
      });
      void this.post({ jsonrpc: '2.0', id, method, params }, scope.signal).catch(error => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        pending?.reject(error as Error);
      });
    });
  }

  protected async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const scope = createMcpRequestScope();
    this.posts.add(scope);
    try { await this.post({ jsonrpc: '2.0', method, params }, scope.signal); }
    finally { scope.dispose(); this.posts.delete(scope); }
  }

  private async post(message: JsonRpcRequest, signal: AbortSignal): Promise<void> {
    if (!this.endpoint) throw new Error('MCP SSE endpoint 尚未就绪');
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { ...this.config.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal,
    });
    if (!response.ok) throw new Error(`MCP SSE POST ${response.status}: ${await response.text()}`);
    void response.body?.cancel().catch(() => undefined);
  }

  private async consume(response: Response): Promise<void> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const parser = new McpSseParser(event => this.handleEvent(event));
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      if (!this.intentional) throw new Error('MCP SSE stream closed');
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
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
    this.pending.delete(message.id);
    try {
      const rpc = readMcpRpcResponse(message, message.id);
      if (rpc.error) pending.reject(new Error(`MCP error [${rpc.error.code}]: ${rpc.error.message}`));
      else pending.resolve(rpc.result);
    } catch (error) { pending.reject(error as Error); }
  }

  private onStreamError(error: unknown): void {
    this.endpointFailed?.(error as Error);
    if (this.intentional || (error as Error).name === 'AbortError') return;
    this.rejectAll(error as Error);
    this.transportClosed();
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
