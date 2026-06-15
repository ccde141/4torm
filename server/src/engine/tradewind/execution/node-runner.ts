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
import { runTradewindReActNative } from './native-adapter';
import { buildVirtualToolDefs } from './virtual-tools';
import {
  compactIfNeeded,
  AGENT_COMPACT_THRESHOLD,
  type CompactState,
  type CompactorOpts,
} from './context-compactor';
import { execDelegate, execContact } from './node-runner-tools';
import { execListAgents, execCreateWorkflow } from '../../shared/workflow-builder';
import { pushUnified } from './unified-stream';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── 类型 ──────────────────────────────────────────────────────────

export type MessageSource = 'human' | 'envelope' | 'contact';

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
  | { type: 'contact-start'; target: string }
  | { type: 'contact-done'; target: string; result: string; ok: boolean }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'compact-start' }
  | { type: 'compact-done'; archivedRounds: number; summaryLength: number }
  | { type: 'compact-warn'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface NodeRunnerOpts {
  dataDir: string;
  /** 本节点 ID（contact 防死锁用） */
  nodeId: string;
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
  /** 压缩归档目录（output/bak/agent_{nodeName}/） */
  compactArchiveDir?: string;
  /** 是否允许 delegate（sub-agent 委托） */
  allowDelegate?: boolean;
  /** contact 可联络的协作者名称列表（去自身） */
  contactTargets?: string[];
  /** 是否走原生 tool calls（启动时 resolve 一次，运行期固定） */
  native?: boolean;
}

// ── NodeRunner ───────────────────────────────────────────────────

export class NodeRunner {
  private readonly opts: NodeRunnerOpts;
  private readonly queue: QueuedMessage[] = [];
  private readonly messages: ContextMessage[] = [];
  private busy = false;
  private processing = false;
  private readonly eventListeners = new Set<(ev: NodeRunnerEvent) => void>();
  private readonly compactState: CompactState = { disabled: false, archiveSeq: 0 };
  private roundAbort: AbortController | null = null;

  /** 当前轮累积事件 buffer（不管有没有 listener 都攒，窗口重开时 replay） */
  private currentRoundBuffer: NodeRunnerEvent[] = [];

  constructor(opts: NodeRunnerOpts) {
    this.opts = opts;
    this.messages.push({ role: 'system', content: opts.systemPrompt });
  }

  isBusy(): boolean { return this.busy; }
  getMessages(): readonly ContextMessage[] { return this.messages; }

  /** 中止当前轮次（人类点停止按钮） */
  abortRound(): void {
    this.roundAbort?.abort();
  }

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

  /** 注册事件监听器（SSE 推送用，支持多个）。注册时自动 replay 当前轮已产生事件。 */
  addEventListener(fn: (ev: NodeRunnerEvent) => void): void {
    this.eventListeners.add(fn);
    // 窗口重新打开：补发当前轮已产生的事件（token + tool-call 等）
    if (this.currentRoundBuffer.length > 0) {
      for (const ev of this.currentRoundBuffer) fn(ev);
    }
  }

  /** 移除事件监听器 */
  removeEventListener(fn: (ev: NodeRunnerEvent) => void): void {
    this.eventListeners.delete(fn);
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
    this.roundAbort = new AbortController();
    const emit = (ev: NodeRunnerEvent) => {
      this.currentRoundBuffer.push(ev);
      for (const fn of this.eventListeners) fn(ev);
      pushUnified('agent', this.opts.nodeId, ev as unknown as Record<string, unknown>);
    };

    // 追加 user message 到上下文
    this.messages.push({ role: 'user', content: msg.content });
    // 通知前端（人类消息由 send() 自行插入，无需重复推送）
    if (msg.source !== 'human') {
      emit({ type: 'user-message', content: msg.content, source: msg.source } as any);
    }

    try {
      const result = await this.runReAct(emit);
      // 追加 assistant 回复到上下文
      this.messages.push({ role: 'assistant', content: result.rawContent });

      emit({ type: 'answer', content: result.content, rawContent: result.rawContent });
      emit({ type: 'done' });
      // 轮次完成，清空 replay buffer（历史已持久化到 messages）
      this.currentRoundBuffer = [];

      // 信封/contact 来源：回调通知系统拿走输出
      if ((msg.source === 'envelope' || msg.source === 'contact') && msg.onComplete) {
        msg.onComplete(result.content);
      }

      // 实时持久化
      await this.persist();

      // 压缩检查（轮次完整结束后）
      await this.checkAndCompact(result.lastPromptTokens, emit);
    } catch (e) {
      const isAbort = (e as Error).name === 'AbortError';
      if (!isAbort) {
        emit({ type: 'error', message: (e as Error).message });
      }
      // 信封/contact 来源：必须调 onComplete，否则下游永久卡死
      if ((msg.source === 'envelope' || msg.source === 'contact') && msg.onComplete) {
        const fallback = isAbort
          ? '[工作流已停止]'
          : `[错误] ${(e as Error).message}`;
        msg.onComplete(fallback);
      }
      emit({ type: 'done' });
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

  /** 压缩检查 + 执行 */
  private async checkAndCompact(
    lastPromptTokens: number | undefined,
    emit: (ev: NodeRunnerEvent) => void,
  ): Promise<void> {
    if (!this.opts.compactArchiveDir) return;

    const compacted = await compactIfNeeded(
      this.messages,
      lastPromptTokens,
      this.compactState,
      {
        dataDir: this.opts.dataDir,
        model: this.opts.model,
        archiveDir: this.opts.compactArchiveDir,
        threshold: AGENT_COMPACT_THRESHOLD,
        onEvent: (ev) => {
          if (ev.type === 'compact-start') emit({ type: 'compact-start' });
          if (ev.type === 'compact-done') emit({ type: 'compact-done', archivedRounds: ev.archivedRounds, summaryLength: ev.summaryLength });
          if (ev.type === 'compact-warn') emit({ type: 'compact-warn', message: ev.message });
        },
      },
    );

    // 压缩后重新持久化
    if (compacted) await this.persist();
  }

  /** 跑 ReAct 循环 */
  private async runReAct(emit: (ev: NodeRunnerEvent) => void) {
    const { dataDir, model, temperature, signal } = this.opts;
    const toolDefs = await loadAgentToolDefs(dataDir, this.opts.toolNames, this.opts.skillIds);

    // 组合信号：orchestrator 全局 abort 或本轮 abort 均可中断
    const roundSignal = this.roundAbort!.signal;
    const combinedAbort = new AbortController();
    const onGlobal = () => combinedAbort.abort();
    const onRound = () => combinedAbort.abort();
    signal.addEventListener('abort', onGlobal, { once: true });
    roundSignal.addEventListener('abort', onRound, { once: true });
    const cleanup = () => {
      signal.removeEventListener('abort', onGlobal);
      roundSignal.removeEventListener('abort', onRound);
    };

    // 构建 toolCaller（文本/native 共用同一个执行器）
    const toolCaller: ToolCaller = {
      call: async (tool, args) => {
        if (tool === 'delegate') {
          return execDelegate(this.opts, args, emit);
        }
        if (tool === 'contact') {
          return execContact(this.opts, args, emit);
        }
        // 工作流搭建假工具
        if (tool === 'list_agents') {
          emit({ type: 'tool-call', tool, args });
          const result = await execListAgents(dataDir);
          emit({ type: 'tool-result', tool, result, ok: true });
          return result;
        }
        if (tool === 'create_workflow') {
          emit({ type: 'tool-call', tool, args });
          const result = await execCreateWorkflow(dataDir, args);
          const ok = !result.startsWith('创建失败');
          emit({ type: 'tool-result', tool, result, ok });
          return result;
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

    try {
      // native 决策由启动时注入（opts.native），不每轮 resolve
      if (this.opts.native) {
        // 原生路径：虚拟工具注册为 function definition
        const virtualDefs = buildVirtualToolDefs({
          allowDelegate: this.opts.allowDelegate ?? true,
          contactTargets: this.opts.contactTargets ?? [],
        });
        const nativeToolDefs = [...toolDefs, ...virtualDefs];

        return await runTradewindReActNative({
          dataDir,
          model,
          temperature,
          messages: [...this.messages],
          toolDefs: nativeToolDefs,
          toolCaller,
          onEvent: emit,
          signal: combinedAbort.signal,
        });
      }

      // 文本路径（保持不变）
      const llm: LLMCaller = {
        async call(msgs, _options, onChunk, sig) {
          return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig });
        },
      };

      return await runReActLoop({
        messages: [...this.messages],
        llm,
        tools: toolDefs.length > 0 ? toolCaller : undefined,
        onEvent: (ev) => {
          if (ev.type === 'token') emit({ type: 'token', content: ev.chunk });
        },
        signal: combinedAbort.signal,
      });
    } finally {
      cleanup();
    }
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
}
