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
  runReActLoopNative,
  SuspendSignal,
  type LLMCaller,
  type ToolCaller,
} from './react-loop';
import { callLLM, type TokenUsage } from '../shared/llm-bridge';
import { loadAgentToolDefs } from '../shared/tool-defs-loader';
import { execListAgents, execCreateWorkflow } from '../shared/workflow-builder';
import { execListWorkflows, execUpdateWorkflow } from '../shared/workflow-editor';
import { buildVirtualToolDefs } from './virtual-tools';
import { execCreateAutomation, execUpdateAutomation, execListAutomations } from '../shared/automation-builder';
import { execTaskBoard, taskboardFile } from '../shared/taskboard';
import fs from 'node:fs/promises';
import path from 'node:path';

// 一次文件改动记录：executor（edit_file/write_file）算好 unified diff 经 meta.diff 回传
type FileChange = { path: string; kind: 'edit' | 'write'; text: string; add: number; del: number };

/** 汇总本轮所有文件改动为一份可读的 code-review 报告（按文件分组，保留改动顺序）。 */
function renderReviewChanges(ledger: FileChange[]): string {
  if (!ledger.length) return '本轮尚无文件改动可复查。';
  const byPath = new Map<string, { add: number; del: number; texts: string[] }>();
  for (const d of ledger) {
    const e = byPath.get(d.path) ?? { add: 0, del: 0, texts: [] };
    e.add += d.add; e.del += d.del;
    if (d.text) e.texts.push(d.text);
    byPath.set(d.path, e);
  }
  let totalAdd = 0, totalDel = 0;
  const blocks: string[] = [];
  for (const [p, e] of byPath) {
    totalAdd += e.add; totalDel += e.del;
    blocks.push(`### ${p}  (+${e.add} / -${e.del})\n${e.texts.join('\n')}`);
  }
  return `本轮改动 ${byPath.size} 个文件，共 +${totalAdd} / -${totalDel} 行：\n\n${blocks.join('\n\n')}`;
}

// ── SSE 事件类型（推送给前端） ────────────────────────────────────

export type ConversationEvent =
  | { type: 'token'; content: string }
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean; meta?: unknown }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, string> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'error'; message: string }
  | { type: 'notice'; message: string }
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
  /** 会话 ID：task_board 假工具据此按会话落盘任务板 */
  sessionId?: string;
  signal?: AbortSignal;
  /**
   * 假工具拦截器（通用扩展点）。
   * 返回非 null 时短路该工具执行，不走 HTTP bridge，直接把返回值当结果。
   * 用于"只截参数不执行"的虚拟工具。
   * 注：潮汐 self-loop 已改用文本标记 [NEXT: ...]，不再依赖此拦截器。
   */
  interceptTool?: (tool: string, args: Record<string, string>) => string | null;
  /**
   * 原生工具调用模式。true = 走 runReActLoopNative（结构化 tool_calls）。
   * 默认 false = 文本协议（向后兼容）。
   */
  native?: boolean;
}

export class SessionRunner {
  private readonly opts: SessionRunnerOpts;
  private busy = false;
  private abortController: AbortController | null = null;
  private suspended = false;
  /** 挂起时保存的上下文（messages + systemPrompt），用于 resume */
  private suspendedState: { messages: ContextMessage[]; systemPrompt: string; pendingToolCallId?: string } | null = null;

  constructor(opts: SessionRunnerOpts) {
    this.opts = opts;
  }

  isBusy(): boolean { return this.busy; }
  isSuspended(): boolean { return this.suspended; }
  /** 绑定的 Agent id（供按-Agent 串行队列取 key） */
  getAgentId(): string { return this.opts.agentId; }

  /** 中止当前执行 */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * 恢复挂起的会话：人类回复了 ask 问题。
   * 原生模式：把回复作为 role:'tool' 配对消息补上（pendingToolCallId）。
   * 文本模式：把回复作为 <result tool="ask"> 文本追加（向后兼容）。
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

    const { messages, systemPrompt, pendingToolCallId } = this.suspendedState;
    this.suspendedState = null;

    // 把人类回复作为工具结果追加：原生 role:'tool' 配对 / 文本 <result> 兜底
    if (pendingToolCallId) {
      messages.push({ role: 'tool', toolCallId: pendingToolCallId, content: answer });
    } else {
      messages.push({ role: 'user', content: `<result tool="ask">${answer}</result>` });
    }

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

    // 本轮文件改动 ledger：edit_file/write_file 经 meta.diff 回传，供 review_changes 汇总回看。
    // 仅内存、仅本次运行（一个用户回合内的多次编辑），不落盘、不跨回合。
    const changeLedger: FileChange[] = [];

    const toolDefs = await loadAgentToolDefs(dataDir, this.opts.toolNames, this.opts.skillIds);
    // 原生模式：把虚拟工具（ask/delegate/list_agents/create_workflow）也作为 schema
    // 注入 tools 参数，否则模型在原生通道看不见它们。执行端 toolCaller 按 name 拦截不变。
    // create_automation 仅在可交互会话（有 sessionId）注入：潮汐无人值守运行不给，避免自我繁殖。
    const nativeToolDefs = [...toolDefs, ...buildVirtualToolDefs(true, !!this.opts.sessionId)];

    const llm: LLMCaller = {
      async call(msgs, _options, onChunk, sig, tools) {
        return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig, tools });
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
        // task_board 假工具：服务端 inline 落盘，meta 走 UI 侧通道刷新置顶面板
        if (tool === 'task_board') {
          onEvent({ type: 'tool-call', tool, args });
          const bf = this.opts.sessionId ? taskboardFile(dataDir, this.opts.agentId, this.opts.sessionId) : null;
          const { result, meta } = execTaskBoard(bf, args);
          onEvent({ type: 'tool-result', tool, result, ok: true, meta });
          return result;
        }
        // 工作流搭建假工具
        if (tool === 'list_agents') {
          onEvent({ type: 'tool-call', tool, args });
          const result = await execListAgents(dataDir);
          onEvent({ type: 'tool-result', tool, result, ok: true });
          return result;
        }
        if (tool === 'create_workflow') {
          onEvent({ type: 'tool-call', tool, args });
          const result = await execCreateWorkflow(dataDir, args);
          const ok = !result.startsWith('创建失败');
          onEvent({ type: 'tool-result', tool, result, ok });
          return result;
        }
        if (tool === 'list_workflows') {
          onEvent({ type: 'tool-call', tool, args });
          const result = await execListWorkflows(dataDir, args);
          onEvent({ type: 'tool-result', tool, result, ok: true });
          return result;
        }
        if (tool === 'update_workflow') {
          onEvent({ type: 'tool-call', tool, args });
          const result = await execUpdateWorkflow(dataDir, args);
          const ok = !result.startsWith('更新失败');
          onEvent({ type: 'tool-result', tool, result, ok });
          return result;
        }
        // create/update_automation：AI 增改潮汐任务（enabled 恒由人控制），信息卡展示；写盘走专用工具+控制面保护
        if (tool === 'create_automation' || tool === 'update_automation') {
          onEvent({ type: 'tool-call', tool, args });
          if (!this.opts.sessionId) {
            // 无人值守（潮汐运行）无 sessionId：禁止自建/自改，避免自我繁殖
            const result = '操作失败：当前不在可交互会话中，潮汐任务须人工在潮汐页管理，禁止在此上下文自建/自改。';
            onEvent({ type: 'tool-result', tool, result, ok: false });
            return result;
          }
          const { result, pending } = tool === 'create_automation'
            ? await execCreateAutomation(dataDir, this.opts.agentId, args)
            : await execUpdateAutomation(dataDir, this.opts.agentId, args);
          onEvent({ type: 'tool-result', tool, result, ok: !result.startsWith('操作失败'), meta: pending ? { pendingAutomation: pending } : undefined });
          return result;
        }
        if (tool === 'list_automations') {
          onEvent({ type: 'tool-call', tool, args });
          const result = await execListAutomations(dataDir);
          onEvent({ type: 'tool-result', tool, result, ok: true });
          return result;
        }
        // review_changes 假工具：汇总本轮 ledger 里的文件改动 diff，供自我 code review
        if (tool === 'review_changes') {
          onEvent({ type: 'tool-call', tool, args });
          const result = renderReviewChanges(changeLedger);
          onEvent({ type: 'tool-result', tool, result, ok: true });
          return result;
        }
        // 直接执行工具，无二次确认
        onEvent({ type: 'tool-call', tool, args });
        try {
          let meta: unknown;
          const result = await this.execTool(tool, args, (m) => { meta = m; });
          // 收集文件改动 diff（edit_file/write_file 经 meta.diff 回传）→ review_changes 汇总
          const diff = (meta as { diff?: FileChange } | undefined)?.diff;
          if (diff?.path) changeLedger.push(diff);
          onEvent({ type: 'tool-result', tool, result, ok: true, meta });
          return result;
        } catch (e) {
          const err = `工具执行失败: ${(e as Error).message}`;
          onEvent({ type: 'tool-result', tool, result: err, ok: false });
          return err;
        }
      },
    };

    const enableTools = toolDefs.length > 0 || !!this.opts.interceptTool;
    // 原生模式（native=true）走 runReActLoopNative（结构化 tool_calls）；
    // 文本模式走 runReActLoop（<action> 协议）。
    const result = this.opts.native
      ? await runReActLoopNative({
          messages: chatMessages,
          llm,
          tools: enableTools ? toolCaller : undefined,
          toolDefs: nativeToolDefs,
          onEvent: (ev) => {
            if (ev.type === 'token') onEvent({ type: 'token', content: ev.chunk });
          },
          // 季风专属：识别 ask 触发的 SuspendSignal，让 core 走挂起分支
          onToolError: (e) => {
            if (e instanceof SuspendSignal) {
              return { reason: 'ask', question: e.question, options: e.options };
            }
            return null;
          },
          signal,
        })
      : await runReActLoop({
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
      this.suspendedState = {
        messages: chatMessages,
        systemPrompt,
        pendingToolCallId: result.suspended.pendingToolCallId,
      };
      onEvent({ type: 'ask', question: result.suspended.question, options: result.suspended.options });
      onEvent({ type: 'done' });
      return { content: '', rawContent: '' };
    }

    onEvent({ type: 'answer', content: result.content, rawContent: result.rawContent });
    if (result.usage) onEvent({ type: 'usage', usage: result.usage });
    onEvent({ type: 'done' });
    return { content: result.content, rawContent: result.rawContent };
  }

  /** 执行普通工具（MCP 工具走 MCP client；其余 HTTP 调 /api/tools/exec） */
  private async execTool(tool: string, args: Record<string, string>, onMeta?: (meta: unknown) => void): Promise<string> {
    // MCP 工具：本地工具 HTTP 执行器不认 mcp: 前缀，必须直接走 MCP client（对齐 cyclone execToolUnified）
    if (tool.startsWith('mcp:')) {
      const { callMcpTool } = await import('../shared/mcp-manager');
      return callMcpTool(tool, args);
    }
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
    const data = await res.json() as { result?: string; error?: string; meta?: unknown };
    if (data.error) throw new Error(data.error);
    if (data.meta !== undefined && data.meta !== null) onMeta?.(data.meta);
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
