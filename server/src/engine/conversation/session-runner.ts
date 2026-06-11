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
import {
  runReActLoop,
  SuspendSignal,
  type LLMCaller,
  type ToolCaller,
} from './react-loop';
import { callLLM, type TokenUsage } from '../shared/llm-bridge';
import { loadAgentToolDefs } from '../shared/tool-defs-loader';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── SSE 事件类型（推送给前端） ────────────────────────────────────

export type ConversationEvent =
  | { type: 'token'; content: string }
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, string> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'error'; message: string }
  | { type: 'done' };

// ── SessionRunner ────────────────────────────────────────────────

export interface SessionRunnerOpts {
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
  signal?: AbortSignal;
  /**
   * 假工具拦截器（通用扩展点）。
   * 返回非 null 时短路该工具执行，不走 HTTP bridge，直接把返回值当结果。
   * 用于潮汐 self-loop 的 schedule_next 等"只截参数不执行"的工具。
   */
  interceptTool?: (tool: string, args: Record<string, string>) => string | null;
}

export class SessionRunner {
  private readonly opts: SessionRunnerOpts;
  private busy = false;
  private abortController: AbortController | null = null;
  private suspended = false;
  /** 挂起时保存的上下文（messages + systemPrompt），用于 resume */
  private suspendedState: { messages: ContextMessage[]; systemPrompt: string } | null = null;

  constructor(opts: SessionRunnerOpts) {
    this.opts = opts;
  }

  isBusy(): boolean { return this.busy; }
  isSuspended(): boolean { return this.suspended; }

  /** 中止当前执行 */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * 恢复挂起的会话：人类回复了 ask 问题。
   * 把回复作为 <result tool="ask"> 追加到 messages，重新进入 ReAct 循环。
   */
  async resume(
    answer: string,
    onEvent: (ev: ConversationEvent) => void,
  ): Promise<{ content: string; rawContent: string }> {
    if (!this.suspended || !this.suspendedState) {
      throw new Error('会话未处于挂起状态');
    }
    if (this.busy) throw new Error('会话正在执行中');

    this.busy = true;
    this.suspended = false;
    this.abortController = new AbortController();

    const { messages, systemPrompt } = this.suspendedState;
    this.suspendedState = null;

    // 把人类回复作为工具结果追加
    messages.push({ role: 'user', content: `<result tool="ask">${answer}</result>` });

    try {
      return await this.runLoop(systemPrompt, messages, onEvent);
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
  ): Promise<{ content: string; rawContent: string }> {
    if (this.busy) throw new Error('会话正在执行中');
    this.busy = true;
    this.abortController = new AbortController();

    try {
      return await this.runLoop(systemPrompt, chatMessages, onEvent);
    } finally {
      this.busy = false;
      this.abortController = null;
    }
  }

  private async runLoop(
    systemPrompt: string,
    chatMessages: ContextMessage[],
    onEvent: (ev: ConversationEvent) => void,
  ): Promise<{ content: string; rawContent: string }> {
    const { dataDir, model, temperature } = this.opts;
    const signal = this.abortController!.signal;

    const toolDefs = await loadAgentToolDefs(dataDir, this.opts.toolNames, this.opts.skillIds);

    const llm: LLMCaller = {
      async call(msgs, _options, onChunk, sig) {
        return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig });
      },
    };

    const toolCaller: ToolCaller = {
      call: async (tool, args) => {
        // 假工具拦截（潮汐 self-loop schedule_next 等）：短路，不走 HTTP
        if (this.opts.interceptTool) {
          const intercepted = this.opts.interceptTool(tool, args);
          if (intercepted !== null) {
            onEvent({ type: 'tool-call', tool, args });
            onEvent({ type: 'tool-result', tool, result: intercepted, ok: true });
            return intercepted;
          }
        }
        // ask 虚拟工具：抛 SuspendSignal 中断循环
        if (tool === 'ask') {
          const question = args.question || '需要你的确认';
          let options: string[] | undefined;
          if (args.options) {
            try { options = JSON.parse(args.options); } catch {}
          }
          throw new SuspendSignal(question, options);
        }
        if (tool === 'delegate') {
          return await this.execDelegate(args, onEvent);
        }
        // 直接执行工具，无二次确认
        onEvent({ type: 'tool-call', tool, args });
        try {
          const result = await this.execTool(tool, args);
          onEvent({ type: 'tool-result', tool, result, ok: true });
          return result;
        } catch (e) {
          const err = `工具执行失败: ${(e as Error).message}`;
          onEvent({ type: 'tool-result', tool, result: err, ok: false });
          return err;
        }
      },
    };

    const enableTools = toolDefs.length > 0 || !!this.opts.interceptTool;
    const result = await runReActLoop({
      messages: chatMessages,
      llm,
      tools: enableTools ? toolCaller : undefined,
      onEvent: (ev) => {
        if (ev.type === 'token') onEvent({ type: 'token', content: ev.chunk });
      },
      signal,
    });

    // ask 挂起：保存状态，通知前端
    if (result.suspended) {
      this.suspended = true;
      this.suspendedState = { messages: chatMessages, systemPrompt };
      onEvent({ type: 'ask', question: result.suspended.question, options: result.suspended.options });
      onEvent({ type: 'done' });
      return { content: '', rawContent: '' };
    }

    onEvent({ type: 'answer', content: result.content, rawContent: result.rawContent });
    if (result.usage) onEvent({ type: 'usage', usage: result.usage });
    onEvent({ type: 'done' });
    return { content: result.content, rawContent: result.rawContent };
  }

  /** 执行普通工具（HTTP 调 /api/tools/exec） */
  private async execTool(tool: string, args: Record<string, string>): Promise<string> {
    const url = (process.env.TOOL_BRIDGE_URL || 'http://localhost:3001').replace(/\/+$/, '') + '/api/tools/exec';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool,
        args,
        agentId: this.opts.agentId,
        workspaceDirOverride: this.opts.workspace,
        sandboxLevelOverride: this.opts.sandboxLevel,
      }),
      signal: this.abortController?.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json() as { result?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.result ?? '';
  }

  /** 执行 delegate（SubAgent 委托） */
  private async execDelegate(
    args: Record<string, string>,
    onEvent: (ev: ConversationEvent) => void,
  ): Promise<string> {
    const { runSubAgent } = await import('../shared/sub-agent-runner');
    const task = args.task || '';
    const context = args.context || '';
    const subSystemPrompt = args.systemPrompt || '';
    const delegateId = `del-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    onEvent({ type: 'delegate-start', task, delegateId });

    const abortCtrl = new AbortController();
    if (this.abortController) {
      this.abortController.signal.addEventListener('abort', () => abortCtrl.abort(), { once: true });
    }

    const result = await runSubAgent({
      task,
      context,
      systemPrompt: subSystemPrompt,
      agentId: this.opts.agentId,
      dataDir: this.opts.dataDir,
      signal: abortCtrl.signal,
      timeout: 1_200_000,
      maxRounds: 100,
      parentSandboxLevel: this.opts.sandboxLevel,
      emit: (ev) => {
        switch (ev.type) {
          case 'token':
            onEvent({ type: 'delegate-token', delegateId, content: ev.data.t });
            break;
          case 'tool_call':
            onEvent({ type: 'delegate-tool-call', delegateId, tool: ev.data.tool, args: ev.data.args });
            break;
          case 'tool_result':
            onEvent({ type: 'delegate-tool-result', delegateId, tool: ev.data.tool, result: ev.data.result, ok: ev.data.ok });
            break;
        }
      },
    });

    onEvent({ type: 'delegate-done', delegateId, summary: result.summary, status: result.status });
    return `[${result.status}] ${result.summary}`;
  }
}
