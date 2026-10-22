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
import type { SandboxLevel } from '../../shared/sandbox-prompt';
import { atomicWriteFile } from '../../shared/atomic-io';
import { callLLM, type TokenUsage } from '../../shared/llm-bridge';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader';
import { execToolUnifiedOutcome } from '../../shared/exec-tool';
import { legacyToolArguments } from '../../shared/tool-arguments.js';
import {
  runReActLoop,
  type LLMCaller,
  type ToolCaller,
} from './tradewind-react-adapter';
import { runTradewindReActNative } from './native-adapter';
import { buildVirtualToolDefs, buildEnvelopeToolDefs } from './virtual-tools';
import { EnvelopeDraft, execEnvelopeToolOutcome, ENVELOPE_TOOL_NAMES, COMPLETE_TASK_TOOL, isEnvelopeRound, classifyRoundInterrupt } from './envelope-draft';
import { compactNodeManually, nodeCompactionCaller } from './node-context-compaction.js';
import { execDelegate, execContact } from './node-runner-tools';
import { execMemoryTool, MEMORY_TOOL_NAMES, buildMemoryToolDefs } from '../../shared/agent-memory';
import { NodeEventEmitter } from '../streaming/node-event-emitter';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveTradewindTermination } from './tradewind-outcome.js';
import type { FrameworkErrorKind } from '../../shared/framework-error.js';
import { frameworkTransportErrorFromUnknown } from '../../shared/framework-error-transport.js';
import { TokenUsageRecorder, captureTokenUsage, type TokenUsageProgress } from './token-usage.js';
import type { HandoffSelection, HandoffRoute } from '../foundation/handoff-target.js';
import { resolveHandoffCompletion } from './handoff-completion.js';
import type { CompactionProgress } from '../../shared/compaction/index.js';
import { projectNodeHistory, type NodeHistoryMessage } from './node-history-view.js';

// ── 类型 ──────────────────────────────────────────────────────────

export type MessageSource = 'human' | 'envelope' | 'contact';

export interface NodeRoundIdentity {
  runId: string;
  source: MessageSource;
  startedAt: string;
}

export interface QueuedMessage {
  messageId?: string;
  actor?: { type: 'human' | 'agent' | 'system'; id?: string };
  envelopeId?: string;
  activationId?: string;
  source: MessageSource;
  content: string;
  /**
   * 信封处理完成后的回调（只有 envelope/contact 来源有）。
   * info.autoOutcome：自动模式终结门结果（'completed'/'anomaly'），手动/普通为 undefined。
   */
  onComplete?: (output: string, info?: { autoOutcome?: 'completed' | 'anomaly'; target?: HandoffSelection }) => void;
  /** 信封/contact 轮真实失败时拒绝等待方，不把错误文本当交付。 */
  onFailure?: (error: Error) => void;
  /**
   * 内部标记：续跑（resume）重投的消息。为 true 时 handle 跳过"追加 user message"
   * （原消息已在上下文里）——便宜版续跑 = 在既有上下文上重跑本轮 react。外部勿设。
   */
  _resume?: boolean;
  /**
   * contact 来源专用：发起联络的源节点 ID。用于判定"本轮是否正在服务某方的 contact"，
   * 使反向联络的死锁提示能区分"我正在答你（可当场处理）"vs"你的请求还在排队（无法当场处理）"。
   */
  contactFrom?: string;
}

/** SSE 事件（推送给前端） */
export type NodeRunnerEvent = (
  | { type: 'round-start'; runId: string; source: MessageSource; startedAt: string }
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'usage'; usage: TokenUsage | null }
  | { type: 'tool-call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean; meta?: unknown;
      toolImages?: import('../../shared/types.js').ToolImageRef[] }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, unknown> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean; toolImages?: import('../../shared/types.js').ToolImageRef[] }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'contact-start'; target: string }
  | { type: 'contact-done'; target: string; result: string; ok: boolean }
  | { type: 'user-message'; content: string; source: string; messageId?: string; timestamp?: string; actor?: QueuedMessage['actor'] }
  | { type: 'answer'; content: string; rawContent: string }
  | CompactionProgress
  | { type: 'compact-warn'; message: string }
  | { type: 'compaction-notice'; message: string }
  | { type: 'context-compacted'; messages: NodeHistoryMessage[] }
  | { type: 'error'; message: string; code?: string; kind?: FrameworkErrorKind }
  | { type: 'done'; outcome?: 'completed' | 'stopped' | 'error' }
  | { type: 'paused' }
) & {
  /** 进程级单调序号（emit 时注入），前端按此对账去重 */
  seq?: number;
};

/** Agent 节点快照（REST /snapshot 返回，订阅时对账用） */
export interface NodeSnapshot {
  /** 已提交的对话历史（不含首条 system prompt） */
  messages: NodeHistoryMessage[];
  /** 当前轮进行中的有序事件日志（前端用同一 reducer 回放） */
  roundLog: NodeRunnerEvent[];
  /** 当前是否正在处理 */
  busy: boolean;
  /** 当前运行或暂停轮次的真实来源；旧客户端可忽略。 */
  roundSource?: MessageSource | null;
  /** 当前真实运行轮次；空闲和已暂停时不存在。 */
  runId?: string;
  roundStartedAt?: string;
  /** 是否已暂停（扣住信封、待续跑） */
  paused?: boolean;
  /** 被扣住的交付轮身份；恢复时核对，区别于可能同时进行的普通发话轮。 */
  pausedRunId?: string;
  /** 已派发的最大序号（前端只应用 seq > lastSeq 的增量） */
  lastSeq: number;
  tokenUsage?: TokenUsageProgress;
  compactionNotice?: string;
  compaction?: CompactionProgress;
}

/** 高频运行探针只需状态，避免每次复制完整对话与轮次事件。 */
export interface NodeRuntimeState {
  busy: boolean;
  paused: boolean;
  roundSource: MessageSource | null;
  runId?: string;
  pausedRunId?: string;
}

export interface NodeRunnerOpts {
  orchestration?: 'strict' | 'handoff';
  handoffRoutes?: readonly HandoffRoute[];
  recordEvent?: (type: string, payload: Record<string, unknown>) => Promise<void>;
  dataDir: string;
  workflowId: string;
  executionId: string;
  /** 本节点 ID（contact 防死锁用） */
  nodeId: string;
  agentId: string;
  model: string;
  /** LLM 采样温度（来自 agent 配置） */
  temperature: number;
  toolNames: string[];
  toolMode?: 'all' | 'selected';
  skillIds: string[];
  workspace: string;
  /** 沙箱级别（用于 sub-agent 继承） */
  sandboxLevel: SandboxLevel;
  systemPrompt: string;
  buildSystemPrompt?: (source: MessageSource) => string;
  compactionPrompt?: string;
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
  /**
   * 自动模式：注入信封工具（增/删/扫 + complete_task）+ 启用显式终结门。
   * 自动模式必为 native（校验器已保证），故只在 native 路径生效。
   */
  autoMode?: boolean;
}

// ── NodeRunner ───────────────────────────────────────────────────

export class NodeRunner {
  private readonly opts: NodeRunnerOpts;
  private readonly queue: QueuedMessage[] = [];
  private readonly messages: ContextMessage[] = [];
  // UI identity stays out of model messages and provider request payloads.
  private readonly messageIds = new WeakMap<ContextMessage, string>();
  private busy = false;
  private processing = false;
  private readonly events: NodeEventEmitter;
  private roundAbort: AbortController | null = null;
  private currentRoundSource: MessageSource | null = null;
  private roundIdentity: NodeRoundIdentity | null = null;
  /** 暂停中：pause() 置位，让 handle 的 catch 把本轮 abort 识别为"暂停"而非"停止/错误"。 */
  private pausing = false;
  /** 暂停时扣住的信封消息（连同 onComplete），续跑时重投。null=未暂停。 */
  private pausedMsg: QueuedMessage | null = null;
  private pausedRoundIdentity: NodeRoundIdentity | null = null;
  /** 本轮正在服务的 contact 源节点 ID（非 contact 轮为 null）。反向联络死锁提示分流用。 */
  private currentContactFrom: string | null = null;
  private readonly usage: TokenUsageRecorder;
  private lastRequestEstimate?: number;
  private compactionNotice?: string;
  private compaction?: CompactionProgress;
  private contextWrites: Promise<void> = Promise.resolve();

  constructor(opts: NodeRunnerOpts) {
    this.opts = opts;
    this.events = new NodeEventEmitter(opts.nodeId,
      { workflowId: opts.workflowId, executionId: opts.executionId });
    this.usage = new TokenUsageRecorder(opts.persistDir
      ? path.join(opts.persistDir, 'usage.json') : undefined);
    this.messages.push({ role: 'system', content: opts.systemPrompt });
  }

  isBusy(): boolean { return this.busy; }
  getAgentId(): string { return this.opts.agentId; }
  getDataDir(): string { return this.opts.dataDir; }
  getIdentity(): { workflowId: string; executionId: string } {
    return { workflowId: this.opts.workflowId, executionId: this.opts.executionId };
  }
  getMessages(): readonly ContextMessage[] { return this.messages; }
  getRoundIdentity(): NodeRoundIdentity | null {
    return this.roundIdentity ? { ...this.roundIdentity } : null;
  }
  /** 本轮正在服务的 contact 源节点 ID（非 contact 轮为 null）——反向联络死锁提示分流用。 */
  getCurrentContactFrom(): string | null { return this.currentContactFrom; }

  getRuntimeState(): NodeRuntimeState {
    return {
      busy: this.busy,
      paused: this.isPaused(),
      roundSource: this.busy ? this.currentRoundSource : this.pausedMsg?.source ?? this.currentRoundSource,
      ...(this.roundIdentity ? { runId: this.roundIdentity.runId } : {}),
      ...(this.pausedRoundIdentity ? { pausedRunId: this.pausedRoundIdentity.runId } : {}),
    };
  }

  /**
   * 订阅对账快照：已提交 messages（去首条 system）+ 当前轮事件日志 + busy + lastSeq。
   * 前端订阅时拉一次，用同一 reducer 回放 roundLog，再按 seq 应用增量。
   */
  getSnapshot(): NodeSnapshot {
    const msgs = projectNodeHistory(this.messages
      .filter((_, i) => i !== 0) // 去掉首条 system prompt
      .map(m => ({
        ...m,
        ...(this.messageIds.has(m) ? { messageId: this.messageIds.get(m) } : {}),
      })));
    return {
      messages: msgs,
      roundLog: this.events.getRoundLog(),
      busy: this.busy,
      roundSource: this.busy ? this.currentRoundSource : this.pausedMsg?.source ?? this.currentRoundSource,
      ...(this.roundIdentity ? {
        runId: this.roundIdentity.runId,
        roundStartedAt: this.roundIdentity.startedAt,
      } : {}),
      paused: this.isPaused(),
      ...(this.pausedRoundIdentity ? { pausedRunId: this.pausedRoundIdentity.runId } : {}),
      lastSeq: this.events.lastSeq,
      tokenUsage: this.usage.state,
      ...(this.compactionNotice ? { compactionNotice: this.compactionNotice } : {}),
      ...(this.compaction ? { compaction: this.compaction } : {}),
    };
  }

  /**
   * 中止当前轮次（人类点停止按钮，仅 human 轮用）。
   * 注意：envelope 轮不该走这里——它没有"单独取消这一轮"的合法出口，
   * 只能 pause()（暂停后续跑）或 orchestrator.stop()（停整个工作流）。
   */
  canAbortRound(): boolean {
    return this.busy && this.currentRoundSource === 'human' && this.roundAbort !== null
      && !this.roundAbort.signal.aborted;
  }

  abortRound(runId: string): boolean {
    if (!this.canAbortRound() || this.roundIdentity?.runId !== runId) return false;
    this.roundAbort!.abort();
    return true;
  }

  /**
   * 暂停当前信封轮：软中止本轮 react + 扣住信封消息不投递。
   * 续跑见 resume()。abort 是硬切、非挂起——续跑是"重跑本轮"（便宜版，
   * 本轮已攒的 draft 条目丢失、token 沉没），不是断点续传。
   * @returns 是否成功进入暂停（仅 busy 时有效）
   */
  pause(runId: string): boolean {
    if (!this.busy || !this.roundAbort || this.roundAbort.signal.aborted || this.pausedMsg
      || this.currentRoundSource === 'human'
      || this.roundIdentity?.runId !== runId) return false;
    this.pausing = true;
    this.roundAbort.abort();
    return true;
  }

  /** 是否处于已暂停（扣住信封、待续跑）状态 */
  isPaused(): boolean { return this.pausedMsg !== null; }

  /**
   * 续跑：把扣住的信封消息重投队列，在既有上下文上重跑本轮 react。
   * 真封口（complete_task/anomaly）才会触发原 onComplete → 正常投递下游。
   * @returns 是否成功续跑（仅存在扣住消息时有效）
   */
  resume(runId?: string): boolean {
    if (!this.pausedMsg || this.opts.signal.aborted
      || (runId !== undefined && this.pausedRoundIdentity?.runId !== runId)) return false;
    const msg = this.pausedMsg;
    this.pausedMsg = null;
    this.pausedRoundIdentity = null;
    this.push(msg);
    return true;
  }

  /** 强制落盘当前 messages（供 orchestrator stop 时主动调用） */
  async flush(): Promise<void> { await this.persist(); }

  /**
   * 追加一条可压缩的运行事实到当前上下文末尾。
   * 用于运行时注入跨节点事件（例如：会议结束后广播纪要给已激活的参与者节点）。
   * 与 push() 不同：不进队列、不触发 LLM 调用、立刻可见于下一次对话。
   */
  appendSystemMessage(content: string): void {
    // Runtime facts belong to compactable history, not permanent system instructions.
    this.messages.push({ role: 'user', content: `[系统信息：工作流记录]\n${content}` });
    void this.persist();
  }

  /** 注册事件监听器（兼容旧 per-node /events 端点；注册时回放当前轮日志） */
  addEventListener(fn: (ev: NodeRunnerEvent) => void): void {
    this.events.addListener(fn);
  }

  /** 移除事件监听器 */
  removeEventListener(fn: (ev: NodeRunnerEvent) => void): void {
    this.events.removeListener(fn);
  }

  /** 投入消息（人类或信封），自动触发处理 */
  push(msg: QueuedMessage): void {
    this.queue.push({ ...msg, messageId: msg.messageId ?? `tradewind-message-${randomUUID()}` });
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
    this.currentRoundSource = msg.source;
    if (msg.source === 'human') this.compactionNotice = undefined;
    this.compaction = undefined;
    this.events.beginRound();
    this.roundAbort = new AbortController();
    const roundIdentity: NodeRoundIdentity = {
      runId: `tradewind-node-round-${randomUUID()}`,
      source: msg.source,
      startedAt: new Date().toISOString(),
    };
    this.roundIdentity = roundIdentity;
    // 本轮若在服务某方的 contact，记下其源节点——供反向联络的死锁提示区分措辞
    this.currentContactFrom = msg.source === 'contact' ? (msg.contactFrom ?? null) : null;
    let reasoningContent = '';
    const readCompaction = (): CompactionProgress | undefined => this.compaction;
    const emit = (ev: NodeRunnerEvent) => {
      if (ev.type === 'compaction-notice') this.compactionNotice = ev.message;
      if (ev.type === 'compact-start' || ev.type === 'compact-done' || ev.type === 'compact-failed') {
        this.compaction = ev;
      }
      if (ev.type === 'reasoning') reasoningContent += ev.content;
      this.events.emit(ev);
    };
    emit({ type: 'round-start', ...roundIdentity });

    // 追加 user message 到上下文（续跑重投的消息除外——原消息已在上下文里）
    if (!msg._resume && !(msg.source === 'human' && msg.content.trim() === '/compact')) {
      const message: ContextMessage = { role: 'user', content: msg.content };
      this.messages.push(message);
      if (msg.messageId) this.messageIds.set(message, msg.messageId);
      // Every sender uses this event; ACK/SSE/snapshot share one ID for reconciliation.
      emit({ type: 'user-message', content: msg.content, source: msg.source,
        messageId: msg.messageId, timestamp: roundIdentity.startedAt, actor: msg.actor });
    }

    try {
      await this.opts.recordEvent?.('agent-round-started', { ...roundIdentity, activationId: msg.activationId ?? roundIdentity.runId,
        envelopeId: msg.envelopeId, source: msg.source, actor: msg.actor, messageId: msg.messageId,
        sourceNodeId: msg.contactFrom, target: this.opts.nodeId });
      if (msg.source === 'human' && msg.content.trim() === '/compact') {
        await compactNodeManually(this.compactionOptions(emit));
        emit({ type: 'done', outcome: 'completed' });
        return;
      }
      const result = await this.runReAct(emit, msg.source);
      resolveTradewindTermination(result.termination, result.autoOutcome);
      // The loop already committed its exact assistant/tool history. A sealed envelope is a
      // separate delivery projection rather than a replacement for that evidence.
      if (result.autoOutcome) this.messages.push({ role: 'assistant', content: result.content });
      const lastAssistant = [...this.messages].reverse().find(message => message.role === 'assistant');
      if (lastAssistant && reasoningContent && !lastAssistant.reasoningContent) lastAssistant.reasoningContent = reasoningContent;
      if (this.opts.orchestration === 'handoff') await this.persist();
      await this.opts.recordEvent?.('agent-round-finished', { ...roundIdentity, activationId: msg.activationId ?? roundIdentity.runId,
        envelopeId: msg.envelopeId, source: msg.source, actor: msg.actor, messageId: msg.messageId,
        target: this.opts.nodeId, finishedAt: new Date().toISOString() });

      emit({ type: 'answer', content: result.content, rawContent: result.rawContent });
      emit({ type: 'done', outcome: 'completed' });
      // 注意：不在此清空 roundLog。该轮已固化进 messages，
      // 但保留 roundLog 到下一轮 beginRound 才清——确保 done 后、下次 push 前
      // 新订阅者仍能从快照回放完整一轮（messages 提供历史，roundLog 提供本轮细节渲染）。

      // 信封/contact 来源：回调通知系统拿走输出（含自动模式终结门结果）
      if ((msg.source === 'envelope' || msg.source === 'contact') && msg.onComplete) {
        const autoOutcome = (result as { autoOutcome?: 'completed' | 'anomaly' }).autoOutcome;
        msg.onComplete(result.content, { autoOutcome, target: result.target });
      }

      // 实时持久化
      await this.persist();

    } catch (e) {
      const compaction = readCompaction();
      const isAbort = (e as Error).name === 'AbortError'
        || (compaction?.type === 'compact-failed' && compaction.aborted === true);
      if (compaction?.type === 'compact-start') {
        emit({ ...compaction, type: 'compact-failed', updatedAt: Date.now(),
          aborted: isAbort, message: e instanceof Error ? e.message : String(e) });
      }
      const carriesEnvelope = (msg.source === 'envelope' || msg.source === 'contact') && !!msg.onComplete;
      const disposition = classifyRoundInterrupt(isAbort, this.pausing, carriesEnvelope);
      this.pausing = false;

      // ── 暂停：扣住信封消息，绝不 onComplete（否则投垃圾下游）。续跑时重跑本轮。
      if (disposition === 'pause') {
        this.pausedMsg = { ...msg, _resume: true };
        this.pausedRoundIdentity = roundIdentity;
        emit({ type: 'paused' });
        this.busy = false;
        return;
      }

      if (!isAbort) {
        const failure = frameworkTransportErrorFromUnknown(e, 'tradewind.node');
        emit({ type: 'error', message: failure.message, code: failure.code, kind: failure.kind });
      }
      if (disposition === 'fail') {
        msg.onFailure?.(e instanceof Error ? e : new Error(String(e)));
      }
      // 全局停止时只解除等待，调用方会根据 abort 拒绝下游投递。
      if (disposition === 'deliver') {
        msg.onComplete!('[工作流已停止]');
      }
      emit({ type: 'done', outcome: isAbort ? 'stopped' : 'error' });
    } finally {
      this.busy = false;
      this.currentRoundSource = null;
      this.roundAbort = null;
      if (this.roundIdentity?.runId === roundIdentity.runId) this.roundIdentity = null;
    }
  }

  /** 持久化 messages 到磁盘 */
  private async persist(): Promise<void> {
    const directory = this.opts.persistDir;
    if (!directory) return;
    try {
      await this.serializeContextWrite(async () => {
        await fs.mkdir(directory, { recursive: true });
        const target = path.join(directory, 'messages.json');
        await atomicWriteFile(target, JSON.stringify(this.messages, null, 2));
      });
    } catch (error) {
      if (this.opts.orchestration === 'handoff') throw error;
    }
  }

  /** Read the owner at the write boundary so an appended fact cannot persist an obsolete context. */
  private serializeContextWrite(write: () => Promise<void>): Promise<void> {
    const current = this.contextWrites.catch(() => {}).then(write);
    this.contextWrites = current;
    return current;
  }

  private compactionOptions(emit: (ev: NodeRunnerEvent) => void) {
    const signal = this.roundAbort ? AbortSignal.any([this.opts.signal, this.roundAbort.signal]) : this.opts.signal;
    return { dataDir: this.opts.dataDir, model: this.opts.model,
      scopeKey: `tradewind:${this.opts.executionId}:${this.opts.nodeId}`,
      archiveDir: this.opts.compactArchiveDir ?? path.join(this.opts.persistDir
        ?? path.join(this.opts.dataDir, 'tradewind', 'compaction'), 'bak'),
      messages: this.messages, emit,
      initialPromptTokens: this.usage.state.latest?.promptTokens,
      initialEstimateTokens: this.lastRequestEstimate,
      prompt: this.opts.compactionPrompt,
      identity: { workflowId: this.opts.workflowId, executionId: this.opts.executionId,
        nodeId: this.opts.nodeId, agentId: this.opts.agentId },
      signal,
      serialize: (write: () => Promise<void>) => this.serializeContextWrite(write),
      recordEstimate: (estimate: number) => { this.lastRequestEstimate = estimate; },
      persist: async (messages: ContextMessage[], commitSignal?: AbortSignal) => {
        if (!this.opts.persistDir) return;
        await fs.mkdir(this.opts.persistDir, { recursive: true });
        (commitSignal ?? signal).throwIfAborted();
        await atomicWriteFile(path.join(this.opts.persistDir, 'messages.json'), JSON.stringify(messages), commitSignal ?? signal);
      } };
  }

  /**
   * 跑 ReAct 循环。
   * @param source 当前轮来源。信封四件套 + 终结门 + 封口投递仅在信封轮生效
   *               （isEnvelopeRound）；human/contact 轮跑纯 react，答完即止、不投递。
   */
  private async runReAct(emit: (ev: NodeRunnerEvent) => void, source: MessageSource) {
    const { dataDir, model, temperature, signal } = this.opts;
    const toolDefs = await loadAgentToolDefs(dataDir, this.opts.toolNames, this.opts.skillIds, this.opts.toolMode);

    // 是否信封轮：决定挂不挂信封工具 + 终结门（见 isEnvelopeRound 的双平面分离说明）
    const handoff = this.opts.orchestration === 'handoff';
    const envelopeRound = isEnvelopeRound(source, this.opts.native, handoff);

    // 组合信号：orchestrator 全局 abort 或本轮 abort 均可中断
    const roundSignal = this.roundAbort!.signal;
    const effectiveSignal = AbortSignal.any([signal, roundSignal]);
    const roundOpts = { ...this.opts, signal: effectiveSignal };
    if (this.opts.buildSystemPrompt) this.messages[0].content = this.opts.buildSystemPrompt(source);
    const workingContext = [...this.messages];

    // 信封轮：本轮信封草稿（每次 runReAct 一份，随 complete_task 封口交付）。
    // 非信封轮（human/contact）为 null——不攒信封、不投递。
    const draft = envelopeRound ? new EnvelopeDraft(handoff ? this.opts.handoffRoutes ?? [] : undefined) : null;

    // 构建 toolCaller（文本/native 共用同一个执行器）
    const toolCaller: ToolCaller = {
      call: async (tool, rawArgs) => {
        effectiveSignal.throwIfAborted();
        const args = legacyToolArguments(rawArgs);
        // 自动模式信封工具（增/删/扫 + complete_task）：服务端内联执行，改本轮草稿
        if (draft && (ENVELOPE_TOOL_NAMES as readonly string[]).includes(tool)) {
          emit({ type: 'tool-call', tool, args });
          const outcome = execEnvelopeToolOutcome(draft, tool, args);
          emit({ type: 'tool-result', tool, result: outcome.result, ok: outcome.ok });
          return outcome;
        }
        if (tool === 'delegate') {
          return execDelegate(roundOpts, args, emit);
        }
        if (tool === 'contact') {
          return execContact(roundOpts, args, emit, this.currentContactFrom);
        }
        // 长期记忆工具（每轮可用）：引擎侧内联执行，补 source+时间戳
        if ((MEMORY_TOOL_NAMES as readonly string[]).includes(tool)) {
          emit({ type: 'tool-call', tool, args });
          try {
            const result = await execMemoryTool(this.opts.dataDir, this.opts.agentId, 'tradewind', tool, args);
            emit({ type: 'tool-result', tool, result, ok: true });
            return result;
          } catch (e) {
            const err = `记忆工具执行失败: ${(e as Error).message}`;
            emit({ type: 'tool-result', tool, result: err, ok: false });
            return { result: err, ok: false };
          }
        }
        emit({ type: 'tool-call', tool, args: rawArgs });
        try {
          let meta: unknown;
          const outcome = await this.execTool(tool, rawArgs, effectiveSignal, (m) => { meta = m; });
          emit({ type: 'tool-result', tool, ...outcome, meta });
          return outcome;
        } catch (e) {
          const err = `工具执行失败: ${(e as Error).message}`;
          emit({ type: 'tool-result', tool, result: err, ok: false });
          return { result: err, ok: false };
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
        // 记忆工具每轮可用（不限信封轮）——agent 任意阶段都可能想起要记/查经验。
        const memoryDefs = buildMemoryToolDefs();
        // 信封轮：叠加信封四件套 + 启用显式终结门（complete_task）。
        // human/contact 轮：仅基础工具 + 虚拟工具，纯对话、无终结门。
        const nativeToolDefs = envelopeRound
          ? [...toolDefs, ...virtualDefs, ...memoryDefs, ...buildEnvelopeToolDefs(handoff ? this.opts.handoffRoutes ?? [] : undefined)]
          : [...toolDefs, ...virtualDefs, ...memoryDefs];

        const result = await runTradewindReActNative({
          dataDir,
          model,
          temperature,
          messages: workingContext,
          toolDefs: nativeToolDefs,
          toolCaller,
          retainFinalContext: true,
          onEvent: emit,
          onUsageResolved: usage => this.usage.record(usage).then(() => undefined),
          llmTransform: llm => nodeCompactionCaller(llm, this.compactionOptions(emit)),
          signal: effectiveSignal,
          completion: envelopeRound ? { tool: COMPLETE_TASK_TOOL } : undefined,
        });
        return resolveHandoffCompletion(result, draft, handoff && envelopeRound);
      }

      // 文本路径（保持不变）
      const usageRecorder = this.usage;
      const llm: LLMCaller = {
        async call(msgs, _options, onChunk, sig, onReasoning) {
          return captureTokenUsage(() => callLLM({
            dataDir,
            fullModelKey: model,
            messages: msgs,
            options: { temperature },
            onChunk,
            signal: sig,
            onReasoning,
          }), usage => usageRecorder.record(usage));
        },
      };

      const result = await runReActLoop({
        messages: workingContext,
        llm,
        llmTransform: caller => nodeCompactionCaller(caller, this.compactionOptions(emit)),
        // 即使 Agent 没配置普通工具，信风仍有记忆、contact 和信封工具。
        tools: toolCaller,
        allowedTools: [
          ...toolDefs,
          ...buildVirtualToolDefs({
            allowDelegate: this.opts.allowDelegate ?? true,
            contactTargets: this.opts.contactTargets ?? [],
          }),
          ...buildMemoryToolDefs(),
          ...(envelopeRound ? buildEnvelopeToolDefs(handoff ? this.opts.handoffRoutes ?? [] : undefined) : []),
        ].map(tool => tool.name),
        onEvent: (ev) => {
          if (ev.type === 'token') emit({ type: 'token', content: ev.chunk });
          if (ev.type === 'reasoning') emit({ type: 'reasoning', content: ev.chunk });
          if (ev.type === 'usage') emit({ type: 'usage', usage: ev.usage });
        },
        signal: effectiveSignal,
        completion: handoff && envelopeRound ? { tool: COMPLETE_TASK_TOOL } : undefined,
      });
      return resolveHandoffCompletion(result, draft, handoff && envelopeRound);
    } finally {
      // Compaction commits replacement prefixes itself. Retain every new exact message,
      // while preserving runtime facts appended independently during this round.
      const committed = new Set(this.messages);
      this.messages.push(...workingContext.filter(message => !committed.has(message)));
      await this.persist();
    }
  }

  /** 执行普通工具 */
  private async execTool(tool: string, args: Record<string, unknown>, signal: AbortSignal, onMeta?: (meta: unknown) => void) {
    return execToolUnifiedOutcome({
      tool,
      args,
      mediaAccess: { dataDir: this.opts.dataDir, feature: 'tradewind', target: {
        workflowId: this.opts.workflowId, executionId: this.opts.executionId,
        nodeId: this.opts.nodeId, kind: 'node' } },
      agentId: this.opts.agentId,
      workspaceDir: this.opts.workspace,
      sandboxLevel: this.opts.sandboxLevel,
      signal,
      onMeta,
    });
  }
}
