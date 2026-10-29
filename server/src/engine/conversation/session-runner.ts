/**
 * 普通会话引擎 — 后端 ReAct 循环
 *
 * 替代前端 streamLoop.ts 的全部职责：
 * - 接收人类消息 → 构建上下文 → 调 LLM → 解析输出
 * - 工具调用（串行）+ delegate（并行）
 * - 续写（finishReason=length）
 * - 通过 SSE 事件流推送给前端
 *
 * 设计：每个活跃会话一个 SessionRunner 实例，存活于 runner registry。
 * 注：危险工具二次确认已移除，ToolDef.dangerous 字段保留为提示词软锁。
 */

import type { ContextMessage } from '../shared/types';
import type { ToolRegistrationProposal } from '../shared/tool-registration.js';
import { applyToolRegistrationAnswer } from '../shared/tool-registration-response.js';
import { formatTextToolResult } from '../shared/text-tool-protocol.js';
import { ConversationInputRuntime } from './input-runtime.js';
import { readInputJournal } from './input-journal.js';
import { inputError } from './input-inbox.js';
import { executeSessionLoop } from './session-loop.js';
import { ConversationContextObservation } from './context-observation.js';
import type { ConversationEvent, SessionRunnerOpts } from './session-runner-contracts.js';

export type { ConversationEvent, SessionRunnerOpts } from './session-runner-contracts.js';

export class SessionRunner {
  private readonly opts: SessionRunnerOpts;
  private busy = false;
  private abortController: AbortController | null = null;
  private suspended = false;
  /** 挂起时保存的上下文（messages + systemPrompt），用于 resume */
  private suspendedState: { messages: ContextMessage[]; systemPrompt: string; pendingToolCallId?: string } | null = null;
  private pendingToolRegistration: ToolRegistrationProposal | null = null;
  private inputRuntime: ConversationInputRuntime | null = null;
  private contextObservation?: ConversationContextObservation;
  getCurrentInput() { return this.contextObservation?.ready ? this.contextObservation.read() : undefined; }
  getInputRuntime(): ConversationInputRuntime | null { return this.inputRuntime; }

  constructor(opts: SessionRunnerOpts) { this.opts = opts; }

  isBusy(): boolean { return this.busy; }
  isSuspended(): boolean { return this.suspended; }
  /** 绑定的 Agent id（供按-Agent 串行队列取 key） */
  getAgentId(): string { return this.opts.agentId; }
  /** 构造时定死的生效模型（供注册表判断季风临时切模型时是否需重建） */
  getModel(): string { return this.opts.model; }

  /** 中止当前执行 */
  abort(): void {
    this.inputRuntime?.stop();
    this.abortController?.abort();
  }

  /**
   * 恢复挂起的会话：人类回复了 ask 问题。
   * 原生模式：把回复作为 role:'tool' 配对消息补上（pendingToolCallId）。
   * 文本模式：把回复作为 JSON 工具结果追加。
   */
  async resume(
    answer: string,
    onEvent: (ev: ConversationEvent) => void,
    inputRunId?: string,
  ): Promise<{ content: string; rawContent: string }> {
    if (!this.suspended || !this.suspendedState) {
      throw new Error('会话未处于挂起状态');
    }
    if (this.busy) throw new Error('会话正在执行中');

    this.busy = true;
    this.suspended = false;
    this.abortController = new AbortController();

    const { messages, systemPrompt, pendingToolCallId } = this.suspendedState;
    this.suspendedState = null;
    const registration = this.pendingToolRegistration;
    this.pendingToolRegistration = null;
    if (registration) {
      await applyToolRegistrationAnswer({
        dataDir: this.opts.dataDir,
        proposal: registration,
        answer,
        messages,
        pendingToolCallId,
        onEvent,
      });
    } else if (pendingToolCallId) {
      messages.push({ role: 'tool', toolCallId: pendingToolCallId, content: answer, origin: 'human' });
    } else {
      messages.push({ role: 'user', content: formatTextToolResult('ask', answer, true), origin: 'human' });
    }

    try {
      return await this.runWithInputs(systemPrompt, messages, onEvent, inputRunId);
    } finally {
      this.busy = false;
      this.abortController = null;
    }
  }

  /**
   * 核心入口：处理一条人类消息。
   * 构建上下文 → 跑 ReAct 循环 → 通过 onEvent 推送事件给前端。
   */
  async chat(
    systemPrompt: string,
    chatMessages: ContextMessage[],
    onEvent: (ev: ConversationEvent) => void,
    inputRunId?: string,
  ): Promise<{ content: string; rawContent: string }> {
    if (this.busy) throw new Error('会话正在执行中');
    this.busy = true;
    this.abortController = new AbortController();

    try {
      return await this.runWithInputs(systemPrompt, chatMessages, onEvent, inputRunId);
    } finally {
      this.busy = false;
      this.abortController = null;
    }
  }

  private async runWithInputs(
    prompt: string, messages: ContextMessage[], emit: (event: ConversationEvent) => void, runId?: string,
  ): Promise<{ content: string; rawContent: string }> {
    if (!runId || !this.opts.sessionId) return this.runLoop(prompt, messages, emit);
    const owner = { agentId: this.opts.agentId, sessionId: this.opts.sessionId, runId };
    const prior = await readInputJournal(this.opts.dataDir, owner);
    if (prior.entries.length || prior.checkpoint) throw inputError('INPUT_RUN_REUSED', 'conflict', '执行标识已使用，请发起新一轮');
    const runtime = new ConversationInputRuntime(this.opts.dataDir, owner, emit);
    this.inputRuntime = runtime;
    runtime.bind(messages);
    let done = false;
    try {
      return await this.runLoop(prompt, messages, event => {
        if (event.type === 'done') done = true;
        else emit(event);
      });
    } finally {
      try { await runtime.finish(); }
      finally { this.inputRuntime = null; }
      if (done) emit({ type: 'done' });
    }
  }

  private async runLoop(
    systemPrompt: string,
    chatMessages: ContextMessage[],
    onEvent: (ev: ConversationEvent) => void,
  ): Promise<{ content: string; rawContent: string }> {
    const signal = this.abortController!.signal;
    this.contextObservation = this.opts.mainAgent && this.opts.sessionId
      ? new ConversationContextObservation(this.opts.dataDir, this.opts.model,
        this.inputRuntime?.owner.runId ?? 'session', estimate => onEvent({ type: 'current-input', estimate })) : undefined;
    const externalAbort = () => this.abort();
    this.opts.signal?.addEventListener('abort', externalAbort, { once: true });
    if (this.opts.signal?.aborted) externalAbort();
    try {
      return await executeSessionLoop({
        options: this.opts,
        systemPrompt,
        messages: chatMessages,
        inputRuntime: this.inputRuntime,
        signal,
        observeContext: this.contextObservation,
        emit: onEvent,
        setPendingRegistration: proposal => { this.pendingToolRegistration = proposal; },
        suspend: state => {
          this.suspended = true;
          this.suspendedState = state;
        },
      });
    } finally {
      this.opts.signal?.removeEventListener('abort', externalAbort);
      try { await this.opts.checkpoint?.(chatMessages); }
      finally { this.contextObservation = undefined; }
    }
  }
}
