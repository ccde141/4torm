/**
 * MCP stdio client — 子进程启动 + JSON-RPC 2.0 通信
 *
 * 实现 MCP 协议的 client 端（stdio transport）：
 * - 启动外部 MCP server 子进程
 * - 通过 stdin/stdout 收发 JSON-RPC 消息
 * - 支持 initialize / tools/list / tools/call
 *
 * 单文件 ≤ 300 行
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

// ── 类型 ──────────────────────────────────────────────────────────

export interface McpServerConfig {
  name: string;
  enabled: boolean;
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, any>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// ── MCP Client ───────────────────────────────────────────────────

export class McpStdioClient extends EventEmitter {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buffer = '';
  private _connected = false;
  private _tools: McpToolDef[] = [];
  /** 标记本次退出是否为用户/管理器主动断开（用于区分崩溃，决定要不要自动重连） */
  private _intentional = false;

  constructor(private config: McpServerConfig) {
    super();
  }

  get connected(): boolean { return this._connected; }
  get tools(): McpToolDef[] { return this._tools; }
  get name(): string { return this.config.name; }

  /** 启动子进程并完成 MCP 握手 */
  async connect(): Promise<void> {
    if (this._connected) return;
    this._intentional = false;

    const env = { ...process.env, ...this.config.env };
    this.proc = spawn(this.config.command, this.config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      shell: true,
    });

    this.proc.stdout!.on('data', (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr!.on('data', (chunk: Buffer) => {
      // stderr 作为 debug 日志，不阻塞
      this.emit('log', `[${this.config.name}] ${chunk.toString().trim()}`);
    });
    this.proc.on('exit', (code) => {
      this._connected = false;
      this.rejectAll(new Error(`MCP server ${this.config.name} exited with code ${code}`));
      this.emit('disconnected', { code, intentional: this._intentional });
    });
    this.proc.on('error', (err) => {
      // spawn 本身失败（命令不存在等）
      this._connected = false;
      this.rejectAll(new Error(`MCP server ${this.config.name} spawn error: ${err.message}`));
      this.emit('disconnected', { code: null, intentional: this._intentional });
    });

    // 等待进程就绪（给 100ms 让 stdio 建立）
    await new Promise(r => setTimeout(r, 100));

    // MCP initialize 握手
    const initResult = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: '4torm', version: '1.0.0' },
    });

    // 发送 initialized 通知
    this.notify('notifications/initialized', {});

    this._connected = true;
    this.emit('connected', initResult);

    // 拉取工具列表
    await this.refreshTools();
  }

  /** 刷新工具列表 */
  async refreshTools(): Promise<McpToolDef[]> {
    const result = await this.request('tools/list', {});
    this._tools = (result.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema,
    }));
    return this._tools;
  }

  /** 调用工具 */
  async callTool(toolName: string, args: Record<string, any>): Promise<string> {
    const result = await this.request('tools/call', { name: toolName, arguments: args });
    // MCP tool result: { content: [{ type: 'text', text: '...' }, ...] }
    if (Array.isArray(result.content)) {
      return result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  /** 断开连接（主动）。标记 intentional，使管理器不会对其自动重连。 */
  disconnect(): void {
    this._intentional = true;
    if (this.proc) {
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
    this._connected = false;
    this._tools = [];
    this.rejectAll(new Error('Client disconnected'));
  }

  // ── 内部方法 ──

  private async request(method: string, params: Record<string, any>): Promise<any> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method} (id=${id})`));
      }, 30_000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });
      this.send(msg);
    });
  }

  private notify(method: string, params: Record<string, any>): void {
    const msg = { jsonrpc: '2.0' as const, method, params };
    this.send(msg);
  }

  private send(msg: object): void {
    if (!this.proc?.stdin?.writable) throw new Error('MCP stdin not writable');
    const json = JSON.stringify(msg);
    this.proc.stdin.write(json + '\n');
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    while (true) {
      const newlineIdx = this.buffer.indexOf('\n');
      if (newlineIdx === -1) break;
      const line = this.buffer.slice(0, newlineIdx).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch { /* skip non-JSON lines */ }
    }
  }

  private handleMessage(msg: any): void {
    // 响应（有 id）
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`));
      } else {
        resolve(msg.result);
      }
      return;
    }
    // 通知（无 id）— 目前不处理
    this.emit('notification', msg);
  }

  private rejectAll(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }
}
