/**
 * 信风 Node Runner —— Agent 节点的持续对话引擎
 *
 * 从普通会话 SessionRunner 复制解耦，独立演进。
 *
 * 核心差异：
 * - 持续循环：节点启动后不退出，持续监听消息队列
 * - 双来源：信封（系统投入）+ 人类对话，统一队列串行处理
 * - 信封处理完后自动投递下游（通过回调）
 * - 无危险工具确认（工作流内工具全自动）
 * - 无 session 持久化（生命周期绑定 execution）
 *
 * 信风独立副本，可自主演进。
 */

import type { ContextMessage } from '../../shared/types';
import { callLLM } from '../../shared/llm-bridge';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader';
import {
  runReActLoop,
  type LLMCaller,
  type ToolCaller,
} from './react-loop';
import { runSubAgent, type SubAgentEvent } from './sub-agent-runner';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── 类型 ──────────────────────────────────────────────────────────

export type MessageSource = 'human' | 'envelope';

export interface QueuedMessage {
  source: MessageSource;
  content: string;
  /** 信封处理完成后的回调（只有 envelope 来源有） */
  onComplete?: (output: string) => void;
}

/** SSE 事件（推送给前端） */
export type NodeRunnerEvent =
  | { type: 'token'; content: string }
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, string> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface NodeRunnerOpts {
  dataDir: string;
  agentId: string;
  model: string;
  /** LLM 采样温度（来自 agent 配置） */
  temperature: number;
  toolNames: string[];
  skillIds: string[];
  workspace: string;
  /** 沙箱级别（用于 sub-agent 继承） */
  sandboxLevel: 'strict' | 'relaxed' | 'unrestricted';
  systemPrompt: string;
  signal: AbortSignal;
  /** 持久化路径（每轮对话后写入 messages.json） */
  persistDir?: string;
}

// ── NodeRunner ───────────────────────────────────────────────────

export class NodeRunner {
  private readonly opts: NodeRunnerOpts;
  private readonly queue: QueuedMessage[] = [];
  private readonly messages: ContextMessage[] = [];
  private busy = false;
  private processing = false;
  private eventListener: ((ev: NodeRunnerEvent) => void) | null = null;

  /** 当前轮累积事件 buffer（不管有没有 listener 都攒，窗口重开时 replay） */
  private currentRoundBuffer: NodeRunnerEvent[] = [];

  constructor(opts: NodeRunnerOpts) {
    this.opts = opts;
    this.messages.push({ role: 'system', content: opts.systemPrompt });
  }

  isBusy(): boolean { return this.busy; }
  getMessages(): readonly ContextMessage[] { return this.messages; }

  /** 强制落盘当前 messages（供 orchestrator stop 时主动调用） */
  async flush(): Promise<void> { await this.persist(); }

  /**
   * 追加一条 system 消息到当前上下文末尾。
   * 用于运行时注入跨节点事件（例如：会议结束后广播纪要给已激活的参与者节点）。
   * 与 push() 不同：不进队列、不触发 LLM 调用、立刻可见于下一次对话。
   */
  appendSystemMessage(content: string): void {
    this.messages.push({ role: 'system', content });
    void this.persist();
  }

  /** 注册事件监听器（SSE 推送用，同时只能一个）。注册时自动 replay 当前轮已产生事件。 */
  setEventListener(fn: ((ev: NodeRunnerEvent) => void) | null): void {
    this.eventListener = fn;
    // 窗口重新打开：补发当前轮已产生的事件（token + tool-call 等）
    if (fn && this.currentRoundBuffer.length > 0) {
      for (const ev of this.currentRoundBuffer) fn(ev);
    }
  }

  /** 投入消息（人类或信封），自动触发处理 */
  push(msg: QueuedMessage): void {
    this.queue.push(msg);
    this.drain();
  }

  /** 串行消费队列 */
  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        if (this.opts.signal.aborted) break;
        const msg = this.queue.shift()!;
        await this.handle(msg);
      }
    } finally {
      this.processing = false;
    }
  }

  /** 处理单条消息 */
  private async handle(msg: QueuedMessage): Promise<void> {
    this.busy = true;
    this.currentRoundBuffer = [];
    const emit = (ev: NodeRunnerEvent) => {
      this.currentRoundBuffer.push(ev);
      this.eventListener?.(ev);
    };

    // 追加 user message 到上下文
    this.messages.push({ role: 'user', content: msg.content });

    try {
      const result = await this.runReAct(emit);
      // 追加 assistant 回复到上下文
      this.messages.push({ role: 'assistant', content: result.rawContent });

      emit({ type: 'answer', content: result.content, rawContent: result.rawContent });
      emit({ type: 'done' });
      // 轮次完成，清空 replay buffer（历史已持久化到 messages）
      this.currentRoundBuffer = [];

      // 信封来源：回调通知系统拿走输出
      if (msg.source === 'envelope' && msg.onComplete) {
        msg.onComplete(result.content);
      }

      // 实时持久化
      await this.persist();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      emit({ type: 'error', message: (e as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /** 持久化 messages 到磁盘 */
  private async persist(): Promise<void> {
    if (!this.opts.persistDir) return;
    try {
      await fs.mkdir(this.opts.persistDir, { recursive: true });
      const target = path.join(this.opts.persistDir, 'messages.json');
      const tmp = target + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(this.messages, null, 2));
      await fs.rename(tmp, target);
    } catch { /* 持久化失败不阻塞 */ }
  }

  /** 跑 ReAct 循环 */
  private async runReAct(emit: (ev: NodeRunnerEvent) => void) {
    const { dataDir, model, temperature, signal } = this.opts;
    const toolDefs = await loadAgentToolDefs(dataDir, this.opts.toolNames, this.opts.skillIds);

    const llm: LLMCaller = {
      async call(msgs, _options, onChunk, sig) {
        return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig });
      },
    };

    const toolCaller: ToolCaller = {
      call: async (tool, args) => {
        if (tool === 'delegate') {
          return this.execDelegate(args, emit);
        }
        emit({ type: 'tool-call', tool, args });
        try {
          const result = await this.execTool(tool, args);
          emit({ type: 'tool-result', tool, result, ok: true });
          return result;
        } catch (e) {
          const err = `工具执行失败: ${(e as Error).message}`;
          emit({ type: 'tool-result', tool, result: err, ok: false });
          return err;
        }
      },
    };

    return runReActLoop({
      messages: [...this.messages],
      llm,
      tools: toolDefs.length > 0 ? toolCaller : undefined,
      onEvent: (ev) => {
        if (ev.type === 'token') emit({ type: 'token', content: ev.chunk });
      },
      signal,
    });
  }

  /** 执行普通工具 */
  private async execTool(tool: string, args: Record<string, string>): Promise<string> {
    const url = (process.env.TOOL_BRIDGE_URL || 'http://localhost:3001').replace(/\/+$/, '') + '/api/tools/exec';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool, args,
        agentId: this.opts.agentId,
        workspaceDirOverride: this.opts.workspace,
        sandboxLevelOverride: this.opts.sandboxLevel,
      }),
      signal: this.opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json() as { result?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.result ?? '';
  }

  /** 执行 delegate */
  private async execDelegate(
    args: Record<string, string>,
    emit: (ev: NodeRunnerEvent) => void,
  ): Promise<string> {
    const task = args.task || '';
    const context = args.context || '';
    const subSystemPrompt = args.systemPrompt || '';
    const delegateId = `del-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    emit({ type: 'delegate-start', task, delegateId });

    const result = await runSubAgent({
      task, context, systemPrompt: subSystemPrompt,
      agentId: this.opts.agentId,
      dataDir: this.opts.dataDir,
      signal: this.opts.signal,
      maxRounds: 100,
      parentSandboxLevel: this.opts.sandboxLevel,
      emit: (ev: SubAgentEvent) => {
        switch (ev.type) {
          case 'token':
            emit({ type: 'delegate-token', delegateId, content: ev.data.t });
            break;
          case 'tool_call':
            emit({ type: 'delegate-tool-call', delegateId, tool: ev.data.tool, args: ev.data.args });
            break;
          case 'tool_result':
            emit({ type: 'delegate-tool-result', delegateId, tool: ev.data.tool, result: ev.data.result, ok: ev.data.ok });
            break;
        }
      },
    });

    // 归档 sub-agent meta + context
    if (this.opts.persistDir) {
      const subDir = path.join(this.opts.persistDir, 'sub-agents', delegateId);
      try {
        await fs.mkdir(subDir, { recursive: true });
        await fs.writeFile(path.join(subDir, 'meta.json'), JSON.stringify({
          delegateId,
          task,
          status: result.status,
          rounds: result.rounds,
          timestamp: new Date().toISOString(),
        }, null, 2));
        await fs.writeFile(path.join(subDir, 'summary.txt'), result.summary);
      } catch { /* 归档失败不阻塞 */ }
    }

    emit({ type: 'delegate-done', delegateId, summary: result.summary, status: result.status });
    return `[${result.status}] ${result.summary}`;
  }
}
