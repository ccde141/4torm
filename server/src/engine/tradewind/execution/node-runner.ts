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
import { atomicWriteFile } from '../../shared/atomic-io';
import { callLLM } from '../../shared/llm-bridge';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader';
import {
  runReActLoop,
  type LLMCaller,
  type ToolCaller,
} from './react-loop';
import { runTradewindReActNative } from './native-adapter';
import { buildVirtualToolDefs, buildEnvelopeToolDefs } from './virtual-tools';
import { EnvelopeDraft, execEnvelopeTool, ENVELOPE_TOOL_NAMES, COMPLETE_TASK_TOOL, isEnvelopeRound, classifyRoundInterrupt } from './envelope-draft';
import {
  compactIfNeeded,
  AGENT_COMPACT_THRESHOLD,
  type CompactState,
  type CompactorOpts,
} from './context-compactor';
import { execDelegate, execContact } from './node-runner-tools';
import { execMemoryTool, MEMORY_TOOL_NAMES, buildMemoryToolDefs } from '../../shared/agent-memory';
import { NodeEventEmitter } from '../streaming/node-event-emitter';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── 类型 ──────────────────────────────────────────────────────────

export type MessageSource = 'human' | 'envelope' | 'contact';

export interface QueuedMessage {
  source: MessageSource;
  content: string;
  /**
   * 信封处理完成后的回调（只有 envelope/contact 来源有）。
   * info.autoOutcome：自动模式终结门结果（'completed'/'anomaly'），手动/普通为 undefined。
   */
  onComplete?: (output: string, info?: { autoOutcome?: 'completed' | 'anomaly' }) => void;
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
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean; meta?: unknown }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, string> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'contact-start'; target: string }
  | { type: 'contact-done'; target: string; result: string; ok: boolean }
  | { type: 'user-message'; content: string; source: string }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'compact-start' }
  | { type: 'compact-done'; archivedRounds: number; summaryLength: number }
  | { type: 'compact-warn'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'paused' }
) & {
  /** 进程级单调序号（emit 时注入），前端按此对账去重 */
  seq?: number;
};

/** Agent 节点快照（REST /snapshot 返回，订阅时对账用） */
export interface NodeSnapshot {
  /** 已提交的对话历史（不含首条 system prompt） */
  messages: Array<{ role: string; content: string }>;
  /** 当前轮进行中的有序事件日志（前端用同一 reducer 回放） */
  roundLog: NodeRunnerEvent[];
  /** 当前是否正在处理 */
  busy: boolean;
  /** 是否已暂停（扣住信封、待续跑） */
  paused?: boolean;
  /** 已派发的最大序号（前端只应用 seq > lastSeq 的增量） */
  lastSeq: number;
}

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
  private busy = false;
  private processing = false;
  private readonly events: NodeEventEmitter;
  private readonly compactState: CompactState = { disabled: false, archiveSeq: 0 };
  private roundAbort: AbortController | null = null;
  /** 暂停中：pause() 置位，让 handle 的 catch 把本轮 abort 识别为"暂停"而非"停止/错误"。 */
  private pausing = false;
  /** 暂停时扣住的信封消息（连同 onComplete），续跑时重投。null=未暂停。 */
  private pausedMsg: QueuedMessage | null = null;
  /** 本轮正在服务的 contact 源节点 ID（非 contact 轮为 null）。反向联络死锁提示分流用。 */
  private currentContactFrom: string | null = null;

  constructor(opts: NodeRunnerOpts) {
    this.opts = opts;
    this.events = new NodeEventEmitter(opts.nodeId);
    this.messages.push({ role: 'system', content: opts.systemPrompt });
  }

  isBusy(): boolean { return this.busy; }
  getMessages(): readonly ContextMessage[] { return this.messages; }
  /** 本轮正在服务的 contact 源节点 ID（非 contact 轮为 null）——反向联络死锁提示分流用。 */
  getCurrentContactFrom(): string | null { return this.currentContactFrom; }

  /**
   * 订阅对账快照：已提交 messages（去首条 system）+ 当前轮事件日志 + busy + lastSeq。
   * 前端订阅时拉一次，用同一 reducer 回放 roundLog，再按 seq 应用增量。
   */
  getSnapshot(): NodeSnapshot {
    const msgs = this.messages
      .filter((_, i) => i !== 0) // 去掉首条 system prompt
      .map(m => ({ role: m.role, content: m.content }));
    return {
      messages: msgs,
      roundLog: this.events.getRoundLog(),
      busy: this.busy,
      paused: this.isPaused(),
      lastSeq: this.events.lastSeq,
    };
  }

  /**
   * 中止当前轮次（人类点停止按钮，仅 human 轮用）。
   * 注意：envelope 轮不该走这里——它没有"单独取消这一轮"的合法出口，
   * 只能 pause()（暂停后续跑）或 orchestrator.stop()（停整个工作流）。
   */
  abortRound(): void {
    this.roundAbort?.abort();
  }

  /**
   * 暂停当前信封轮：软中止本轮 react + 扣住信封消息不投递。
   * 续跑见 resume()。abort 是硬切、非挂起——续跑是"重跑本轮"（便宜版，
   * 本轮已攒的 draft 条目丢失、token 沉没），不是断点续传。
   * @returns 是否成功进入暂停（仅 busy 时有效）
   */
  pause(): boolean {
    if (!this.busy || !this.roundAbort) return false;
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
  resume(): boolean {
    if (!this.pausedMsg) return false;
    const msg = this.pausedMsg;
    this.pausedMsg = null;
    this.push(msg);
    return true;
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
    this.events.beginRound();
    this.roundAbort = new AbortController();
    // 本轮若在服务某方的 contact，记下其源节点——供反向联络的死锁提示区分措辞
    this.currentContactFrom = msg.source === 'contact' ? (msg.contactFrom ?? null) : null;
    const emit = (ev: NodeRunnerEvent) => this.events.emit(ev);

    // 追加 user message 到上下文（续跑重投的消息除外——原消息已在上下文里）
    if (!msg._resume) {
      this.messages.push({ role: 'user', content: msg.content });
      // 通知前端（人类消息由 send() 自行插入，无需重复推送）
      if (msg.source !== 'human') {
        emit({ type: 'user-message', content: msg.content, source: msg.source });
      }
    }

    try {
      const result = await this.runReAct(emit, msg.source);
      // 追加 assistant 回复到上下文
      this.messages.push({ role: 'assistant', content: result.rawContent });

      emit({ type: 'answer', content: result.content, rawContent: result.rawContent });
      emit({ type: 'done' });
      // 注意：不在此清空 roundLog。该轮已固化进 messages，
      // 但保留 roundLog 到下一轮 beginRound 才清——确保 done 后、下次 push 前
      // 新订阅者仍能从快照回放完整一轮（messages 提供历史，roundLog 提供本轮细节渲染）。

      // 信封/contact 来源：回调通知系统拿走输出（含自动模式终结门结果）
      if ((msg.source === 'envelope' || msg.source === 'contact') && msg.onComplete) {
        const autoOutcome = (result as { autoOutcome?: 'completed' | 'anomaly' }).autoOutcome;
        msg.onComplete(result.content, { autoOutcome });
      }

      // 实时持久化
      await this.persist();

      // 压缩检查（轮次完整结束后）
      await this.checkAndCompact(result.lastPromptTokens, emit);
    } catch (e) {
      const isAbort = (e as Error).name === 'AbortError';
      const carriesEnvelope = (msg.source === 'envelope' || msg.source === 'contact') && !!msg.onComplete;
      const disposition = classifyRoundInterrupt(isAbort, this.pausing, carriesEnvelope);
      this.pausing = false;

      // ── 暂停：扣住信封消息，绝不 onComplete（否则投垃圾下游）。续跑时重跑本轮。
      if (disposition === 'pause') {
        this.pausedMsg = { ...msg, _resume: true };
        emit({ type: 'paused' });
        this.busy = false;
        return;
      }

      if (!isAbort) {
        emit({ type: 'error', message: (e as Error).message });
      }
      // 全局停止 / 错误 → 信封/contact 来源必须兜底 onComplete，否则下游/发起方永久悬挂。
      // （全局停止时 agent.ts 已提前 return、不会 sendHandoff，此 fallback 无害；
      //  这里只保住 contact 发起方的 await 不悬挂。）
      if (disposition === 'deliver') {
        const fallback = isAbort
          ? '[工作流已停止]'
          : `[错误] ${(e as Error).message}`;
        msg.onComplete!(fallback);
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
      await atomicWriteFile(target, JSON.stringify(this.messages, null, 2));
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

  /**
   * 跑 ReAct 循环。
   * @param source 当前轮来源。信封四件套 + 终结门 + 封口投递仅在信封轮生效
   *               （isEnvelopeRound）；human/contact 轮跑纯 react，答完即止、不投递。
   */
  private async runReAct(emit: (ev: NodeRunnerEvent) => void, source: MessageSource) {
    const { dataDir, model, temperature, signal } = this.opts;
    const toolDefs = await loadAgentToolDefs(dataDir, this.opts.toolNames, this.opts.skillIds);

    // 是否信封轮：决定挂不挂信封工具 + 终结门（见 isEnvelopeRound 的双平面分离说明）
    const envelopeRound = isEnvelopeRound(source, this.opts.native);

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

    // 信封轮：本轮信封草稿（每次 runReAct 一份，随 complete_task 封口交付）。
    // 非信封轮（human/contact）为 null——不攒信封、不投递。
    const draft = envelopeRound ? new EnvelopeDraft() : null;

    // 构建 toolCaller（文本/native 共用同一个执行器）
    const toolCaller: ToolCaller = {
      call: async (tool, args) => {
        // 自动模式信封工具（增/删/扫 + complete_task）：服务端内联执行，改本轮草稿
        if (draft && (ENVELOPE_TOOL_NAMES as readonly string[]).includes(tool)) {
          emit({ type: 'tool-call', tool, args });
          const result = execEnvelopeTool(draft, tool, args);
          emit({ type: 'tool-result', tool, result, ok: true });
          return result;
        }
        if (tool === 'delegate') {
          return execDelegate(this.opts, args, emit);
        }
        if (tool === 'contact') {
          return execContact(this.opts, args, emit, this.currentContactFrom);
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
            return err;
          }
        }
        emit({ type: 'tool-call', tool, args });
        try {
          let meta: unknown;
          const result = await this.execTool(tool, args, (m) => { meta = m; });
          emit({ type: 'tool-result', tool, result, ok: true, meta });
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
        // 记忆工具每轮可用（不限信封轮）——agent 任意阶段都可能想起要记/查经验。
        const memoryDefs = buildMemoryToolDefs();
        // 信封轮：叠加信封四件套 + 启用显式终结门（complete_task）。
        // human/contact 轮：仅基础工具 + 虚拟工具，纯对话、无终结门。
        const nativeToolDefs = envelopeRound
          ? [...toolDefs, ...virtualDefs, ...memoryDefs, ...buildEnvelopeToolDefs()]
          : [...toolDefs, ...virtualDefs, ...memoryDefs];

        return await runTradewindReActNative({
          dataDir,
          model,
          temperature,
          messages: [...this.messages],
          toolDefs: nativeToolDefs,
          toolCaller,
          onEvent: emit,
          signal: combinedAbort.signal,
          completion: envelopeRound ? { tool: COMPLETE_TASK_TOOL } : undefined,
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
  private async execTool(tool: string, args: Record<string, string>, onMeta?: (meta: unknown) => void): Promise<string> {
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
    const data = await res.json() as { result?: string; error?: string; meta?: unknown };
    if (data.error) throw new Error(data.error);
    if (data.meta !== undefined && data.meta !== null) onMeta?.(data.meta);
    return data.result ?? '';
  }
}
