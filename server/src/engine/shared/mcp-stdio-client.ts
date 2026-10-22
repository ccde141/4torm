import type { ChildProcess } from 'node:child_process';
import spawn from 'cross-spawn';
import { StringDecoder } from 'node:string_decoder';
import { McpBaseClient } from './mcp-base-client.js';
import type { JsonRpcRequest, JsonRpcResponse, McpStdioConfig } from './mcp-types.js';
import { createMcpRequestScope } from './mcp-request.js';
import { readMcpRpcResponse } from './mcp-rpc.js';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class McpStdioClient extends McpBaseClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private decoder = new StringDecoder('utf8');

  constructor(private readonly config: McpStdioConfig) { super(); }
  get name(): string { return this.config.name; }

  protected async openTransport(): Promise<void> {
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    const env = { ...process.env, ...this.config.env };
    const proc = spawn(this.config.command, this.config.args, {
      stdio: ['pipe', 'pipe', 'pipe'], env, cwd: this.config.cwd,
      windowsHide: true,
    });
    this.proc = proc;
    proc.stdout!.on('data', chunk => this.onData(Buffer.from(chunk)));
    proc.stderr!.on('data', chunk => this.emit('log', `[${this.name}] ${String(chunk).trim()}`));
    proc.on('exit', code => { if (this.proc === proc) this.onExit(code); });
    proc.on('error', error => { if (this.proc === proc) this.onProcessError(error); });
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  protected closeTransport(): void {
    if (this.proc) {
      try { this.proc.kill(); } catch { /* process already gone */ }
      this.proc = null;
    }
    this.rejectAll(new Error('MCP client disconnected'));
  }

  protected request(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const scope = createMcpRequestScope(signal);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        scope.signal.removeEventListener('abort', abort);
        scope.dispose();
      };
      const abort = () => {
        this.pending.delete(id);
        cleanup();
        reject(scope.signal.reason);
        try { this.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } }); }
        catch { /* The disconnected transport cannot receive cancellation. */ }
      };
      if (scope.signal.aborted) { cleanup(); reject(scope.signal.reason); return; }
      scope.signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve: value => { cleanup(); resolve(value); },
        reject: error => { cleanup(); reject(error); },
      });
      try { this.send(message); }
      catch (error) { this.pending.delete(id); cleanup(); reject(error as Error); }
    });
  }

  protected async notify(method: string, params: Record<string, unknown>): Promise<void> {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(message: JsonRpcRequest): void {
    if (!this.proc?.stdin?.writable) throw new Error('MCP stdin not writable');
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.parseLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private parseLine(line: string): void {
    try { this.handleMessage(JSON.parse(line) as JsonRpcResponse); }
    catch { this.emit('log', `[${this.name}] ${line}`); }
  }

  private handleMessage(message: JsonRpcResponse): void {
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

  private onExit(code: number | null): void {
    this.proc = null;
    this.rejectAll(new Error(`MCP server ${this.name} exited with code ${code}`));
    this.transportClosed(code);
  }

  private onProcessError(error: Error): void {
    this.rejectAll(new Error(`MCP server ${this.name} spawn error: ${error.message}`));
    this.transportClosed();
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
